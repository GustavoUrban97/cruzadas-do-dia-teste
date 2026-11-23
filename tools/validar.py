#!/usr/bin/env python3
"""Valida todos os puzzles (formato cruzada direta) e regenera puzzles/index.json.

Cada dia tem até três puzzles, um por nível: AAAA-MM-DD-facil.json,
AAAA-MM-DD-media.json e AAAA-MM-DD-dificil.json.

Uso:  python3 tools/validar.py

Sai com código 1 se algum puzzle estiver inválido. A regra de onde cada
resposta começa é a mesma de js/grade.js (DIRECOES); as duas precisam bater.
"""

import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PASTA = RAIZ / "puzzles"
INDICE = PASTA / "index.json"

LARGURA, ALTURA = 13, 17
DICA = "#"
MAX_DICAS_POR_CASA = 2
DICA_LONGA = 24  # caracteres; acima disso só avisa
MAX_LACUNAS = 4  # dicas de completar ("___" ou "(?)") por puzzle; acima disso só avisa

NIVEIS = ("facil", "media", "dificil")  # mesma ordem de js/niveis.js
NOME_ARQUIVO = re.compile(r"^\d{4}-\d{2}-\d{2}-(facil|media|dificil)\.json$")
LINHA_VALIDA = re.compile(r"^[A-Z#]+$")
COR = re.compile(r"^#[0-9a-fA-F]{6}$")

# direcao -> (deslocamento até a 1ª letra, sentido da palavra)
DIRECOES = {
    "direita":       ((0, 1), (0, 1)),
    "baixo":         ((1, 0), (1, 0)),
    "baixo-direita": ((1, 0), (0, 1)),
    "direita-baixo": ((0, 1), (1, 0)),
}


def palavras_da_grade(grade):
    """Todas as palavras (2+ letras) da grade: {(linha, coluna, sentido): palavra}."""
    altura, largura = len(grade), len(grade[0])

    def letra(l, c):
        return 0 <= l < altura and 0 <= c < largura and grade[l][c] != DICA

    palavras = {}
    for l in range(altura):
        for c in range(largura):
            for sentido in ((0, 1), (1, 0)):
                dl, dc = sentido
                if not letra(l, c) or letra(l - dl, c - dc):
                    continue  # não é início de sequência
                palavra, ll, cc = "", l, c
                while letra(ll, cc):
                    palavra += grade[ll][cc]
                    ll, cc = ll + dl, cc + dc
                if len(palavra) >= 2:
                    palavras[(l, c, sentido)] = palavra
    return palavras


def validar_puzzle(caminho):
    """Retorna (puzzle ou None, erros, avisos)."""
    erros, avisos = [], []
    try:
        puzzle = json.loads(caminho.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        return None, [f"JSON inválido: {e}"], avisos

    for campo in ("id", "data", "nivel", "titulo", "largura", "altura", "grade", "dicas"):
        if campo not in puzzle:
            erros.append(f"campo obrigatório ausente: {campo}")
    if erros:
        return puzzle, erros, avisos

    if puzzle["nivel"] not in NIVEIS:
        erros.append(f"nivel inválido: {puzzle['nivel']} (use {', '.join(NIVEIS)})")
    esperado = f"{puzzle['data']}-{puzzle['nivel']}"
    if caminho.stem != esperado:
        erros.append(f"nome do arquivo ({caminho.stem}) diferente de data-nivel ({esperado})")

    grade = puzzle["grade"]
    if (puzzle["largura"], puzzle["altura"]) != (LARGURA, ALTURA):
        erros.append(f"tamanho deve ser {LARGURA}×{ALTURA} (largura × altura)")
    if not isinstance(grade, list) or len(grade) != ALTURA:
        return puzzle, erros + [f"a grade precisa ter {ALTURA} linhas"], avisos
    for i, linha in enumerate(grade):
        if len(linha) != LARGURA:
            erros.append(f"linha {i}: tem {len(linha)} casas, deveria ter {LARGURA}")
        elif not LINHA_VALIDA.match(linha):
            erros.append(f"linha {i} (\"{linha}\"): use só A-Z maiúsculas sem acento e #")
    if erros:
        return puzzle, erros, avisos

    palavras = palavras_da_grade(grade)
    cobertas = {}
    por_casa = {}

    dicas = puzzle["dicas"]
    if not isinstance(dicas, list):
        return puzzle, erros + ["dicas precisa ser uma lista"], avisos

    for i, dica in enumerate(dicas):
        l, c = dica.get("linha"), dica.get("coluna")
        direcao = dica.get("direcao")
        nome = f"dica ({l},{c}) {direcao}"
        if not (isinstance(l, int) and isinstance(c, int) and 0 <= l < ALTURA and 0 <= c < LARGURA):
            erros.append(f"dica {i}: linha/coluna fora da grade")
            continue
        if grade[l][c] != DICA:
            erros.append(f"{nome}: a casa ({l},{c}) não é casa de dica (#)")
            continue
        if direcao not in DIRECOES:
            erros.append(f"{nome}: direção inválida (use {', '.join(DIRECOES)})")
            continue

        por_casa[(l, c)] = por_casa.get((l, c), 0) + 1

        texto = str(dica.get("texto", "")).strip()
        if not texto:
            erros.append(f"{nome}: texto da dica vazio")
        elif len(texto) > DICA_LONGA:
            avisos.append(f"{nome}: dica com {len(texto)} caracteres pode não caber (\"{texto}\")")

        (ol, oc), sentido = DIRECOES[direcao]
        inicio = (l + ol, c + oc, sentido)
        palavra = palavras.get(inicio)
        if palavra is None:
            erros.append(f"{nome}: a seta não aponta para o início de uma palavra de 2+ letras")
            continue
        if inicio in cobertas:
            erros.append(f"{nome}: a palavra {palavra} já tem dica em {cobertas[inicio]}")
        cobertas[inicio] = nome
        if dica.get("resposta") != palavra:
            erros.append(f"{nome}: resposta \"{dica.get('resposta')}\" não bate com a grade (\"{palavra}\")")

    for (l, c), n in por_casa.items():
        if n > MAX_DICAS_POR_CASA:
            erros.append(f"casa ({l},{c}) tem {n} dicas (máximo {MAX_DICAS_POR_CASA})")

    for (l, c, sentido), palavra in sorted(palavras.items()):
        if (l, c, sentido) not in cobertas:
            onde = "horizontal" if sentido == (0, 1) else "vertical"
            erros.append(f"palavra {palavra} ({onde}, começa em {l},{c}) está sem dica")

    contagem = {}
    for palavra in palavras.values():
        contagem[palavra] = contagem.get(palavra, 0) + 1
    repetidas = sorted(p for p, n in contagem.items() if n > 1)
    if repetidas:
        erros.append(f"palavra repetida no puzzle: {', '.join(repetidas)}")

    # dica de completar ("___" ou "(?)"): poucas, como nas revistas (pedido de 21/11)
    lacunas = sum(1 for d in dicas if "___" in str(d.get("texto", "")) or "(?)" in str(d.get("texto", "")))
    if lacunas > MAX_LACUNAS:
        avisos.append(f"{lacunas} dicas de completar (\"___\"); o ideal é no máximo {MAX_LACUNAS}")

    # banco (opcional): palavras de ajuda, todas precisam estar na grade
    banco = puzzle.get("banco", [])
    if not isinstance(banco, list) or not all(isinstance(p, str) for p in banco):
        erros.append("banco deve ser uma lista de palavras")
    else:
        fora = [p for p in banco if p not in contagem]
        if fora:
            erros.append(f"banco tem palavra que não está na grade: {', '.join(fora)}")
        if len(set(banco)) != len(banco):
            erros.append("banco tem palavra repetida")
        if len(banco) > 6:
            avisos.append(f"banco com {len(banco)} palavras pode não caber embaixo da grade")

    # tema (opcional): {"nome": "...", "cor": "#rrggbb"}; os níveis do dia têm o mesmo nome
    tema = puzzle.get("tema")
    if tema is not None:
        if not isinstance(tema, dict) or not isinstance(tema.get("nome"), str) or not tema["nome"].strip():
            erros.append('tema deve ser {"nome": "...", "cor": "#rrggbb"}')
        elif "cor" in tema and not COR.match(str(tema["cor"])):
            erros.append(f"cor do tema inválida: {tema['cor']} (use #rrggbb)")

    return puzzle, erros, avisos


def main():
    arquivos = sorted(p for p in PASTA.glob("*.json") if p.name != INDICE.name)
    problemas = 0
    niveis_por_data = {}
    temas = {}  # data -> nome do tema (o app marca no calendário)
    ids = {}

    for caminho in arquivos:
        erros = []
        if not NOME_ARQUIVO.match(caminho.name):
            erros.append("nome do arquivo deve ser AAAA-MM-DD-nivel.json (nivel: facil, media ou dificil)")
        puzzle, erros_puzzle, avisos = validar_puzzle(caminho)
        erros += erros_puzzle

        if puzzle and "id" in puzzle:
            if puzzle["id"] in ids:
                erros.append(f"id {puzzle['id']} repetido (também em {ids[puzzle['id']]})")
            ids.setdefault(puzzle["id"], caminho.name)

        print(f"{'✗' if erros else '✓'} {caminho.name}")
        for erro in erros:
            print(f"    - {erro}")
        for aviso in avisos:
            print(f"    ! {aviso}")
        if erros:
            problemas += 1
        else:
            niveis_por_data.setdefault(puzzle["data"], []).append(puzzle["nivel"])
            if isinstance(puzzle.get("tema"), dict):
                temas.setdefault(puzzle["data"], puzzle["tema"]["nome"])

    if problemas:
        print(f"\n{problemas} puzzle(s) com problema. index.json não foi atualizado.")
        return 1

    # {"datas": {"AAAA-MM-DD": ["facil", "media", "dificil"]}}, datas e níveis em ordem,
    # mais {"temas": {"AAAA-MM-DD": "nome"}} só se algum dia tiver tema
    indice = {
        data: sorted(niveis, key=NIVEIS.index)
        for data, niveis in sorted(niveis_por_data.items())
    }
    total = sum(len(n) for n in indice.values())
    conteudo = json.dumps({"datas": indice}, ensure_ascii=False, indent=2) + "\n"
    INDICE.write_text(conteudo, encoding="utf-8", newline="\n")
    print(f"\n{total} puzzle(s) válido(s) em {len(indice)} dia(s). puzzles/index.json atualizado.")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
