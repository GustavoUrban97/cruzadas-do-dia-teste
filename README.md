# Cruzadas do Dia

Palavras cruzadas diárias no estilo **cruzada direta** (dicas dentro da grade, com setas), para resolver à caneta (S Pen) no Galaxy Tab S9, como na revista. Grade de 13×17, três cruzadas novas por dia (fácil, média e difícil), trocando à meia-noite de Brasília.

Página web estática (HTML, CSS e JavaScript puro), publicada no GitHub Pages e usada direto no Chrome do tablet. Abre sem internet e avisa quando há versão nova.

## Rodar localmente

Os módulos JavaScript não funcionam abrindo o `index.html` direto do disco; é preciso um servidor:

```bash
python3 -m http.server 8000
```

Abra `http://localhost:8000`. Para abrir um dia específico: `http://localhost:8000/?data=2026-11-07`.

## Gerar puzzles

Com o servidor local rodando, abra `http://localhost:8000/tools/gerador.html` (Chrome ou Edge no PC):

1. Escolha o primeiro dia (já vem o dia seguinte ao último publicado), quantos dias e os níveis, e toque em **Gerar**. Cada cruzada sai com um esqueleto próprio e as dicas em branco.
2. Toque em **Copiar lista de palavras**, escreva as dicas (à mão ou com uma IA) num JSON `{"facil": {"PALAVRA": "texto"}, ...}`, cole no campo e toque em **Aplicar dicas**.
3. **Salvar na pasta puzzles…** grava os arquivos e o `index.json`. Depois é só validar e fazer commit.

Palavra ruim num puzzle gerado? Acrescente em `tools/proibidas.txt` e gere de novo.

## Adicionar puzzles à mão

1. Cada dia tem três cruzadas, uma por nível: crie `puzzles/AAAA-MM-DD-facil.json`, `-media.json` e `-dificil.json` seguindo o formato de `puzzles/2026-11-07-media.json` (com o campo `"nivel"`): grade 13×17, `#` = casa de dica, letras maiúsculas sem acento. Cada dica diz em que casa fica (`linha`, `coluna`) e a direção da seta (`direita`, `baixo`, `baixo-direita` ou `direita-baixo`); no máximo 2 dicas por casa. Detalhes no `CLAUDE.md`.
2. Rode `python3 tools/validar.py`. Ele confere se toda palavra tem dica, se as setas e respostas batem com a grade e regenera `puzzles/index.json`.
3. Faça commit e push. O GitHub Actions valida de novo a cada push.

## Usar no tablet

Abra https://gustavourban97.github.io/cruzadas-do-dia/ no Chrome. A tinta fica salva neste aparelho e neste navegador.

- Quando aparecer **"Atualização disponível"**, toque para recarregar com a versão nova.
- O ícone de gráfico abre **Meu histórico**: estatísticas, calendário (tocar num dia abre aquele puzzle) e backup. Exporte o backup de vez em quando: a tinta fica só neste aparelho.
- `?debug=1` no fim do endereço mostra os eventos da caneta (diagnóstico).
- `?data=AAAA-MM-DD` abre um dia específico (dias passados mostram o gabarito).
- `?nivel=facil|media|dificil` abre um nível (o app lembra o último usado).
- `?hoje=AAAA-MM-DD` finge que hoje é outra data (para testar).

## Publicar uma versão nova

A cada mudança em HTML, CSS ou JS, suba a `VERSAO` em `sw.js` e em `js/app.js` (as duas iguais). É isso que faz o tablet perceber a versão nova.
