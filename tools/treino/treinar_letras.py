#!/usr/bin/env python3
"""Treina o modelo de letras usado para conferir a escrita à caneta.

Roda no GitHub Actions (.github/workflows/treinar-letras.yml), não no app.
Dados: EMNIST ByMerge, só as letras, baixado pelo torchvision direto do NIST.
Ali a maiúscula e a minúscula de desenho diferente são classes separadas
(A e a, R e r, B e b...; as de desenho igual, como C/c e O/o, ficam juntas):
37 saídas. O app soma as duas formas de cada letra (js/reconhecer.js). No
EMNIST Letters, usado antes, o "a" de bolinha e o A de forma eram a mesma
classe, e a rede aprendia pior o A de forma das cruzadas.
O treino sorteia as imagens com o mesmo peso para cada letra (o ByMerge tem
muito mais "e" que "z").

Saída, na pasta modelo/:
  letras.json              arquitetura, ordem das classes e onde está cada peso
  letras.bin               pesos em float16 little-endian, na ordem do json
  letras-verificacao.json  imagens de teste com as saídas esperadas, para
                           conferir se a inferência em JavaScript bate com esta

A rede é pequena de propósito: roda em JavaScript puro (js/reconhecer.js),
sem framework, em menos de 1 s para a grade inteira no tablet.

Entrada: imagem 28×28 em pé (o EMNIST vem transposto; aqui é desvirado),
fundo 0 e tinta 1, letra centralizada como no EMNIST (caixa da tinta num
quadrado com 2 px de margem).
"""

import json
import random
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader
from torchvision import datasets, transforms

RAIZ = Path(__file__).resolve().parents[2]
DADOS = RAIZ / "dados"
SAIDA = RAIZ / "modelo"
LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
# saídas da rede, na ordem do ByMerge sem os dígitos (rótulos 10 a 46)
CLASSES = LETRAS + "abdefghnqrt"
GRUPO = torch.tensor([LETRAS.index(c.upper()) for c in CLASSES])  # saída -> letra

ROTULOS = len(CLASSES)
EPOCAS = 10
POR_EPOCA = 260_000   # imagens sorteadas por época
LOTE = 256

torch.manual_seed(0)
random.seed(0)
torch.set_num_threads(max(1, torch.get_num_threads()))


class Desvirar:
    """O EMNIST guarda as imagens transpostas; deixa a letra em pé."""
    def __call__(self, x):
        return x.transpose(1, 2)


class EspessuraAleatoria:
    """Varia a grossura do traço (canetas diferentes): engrossa ou afina um pouco."""
    def __call__(self, x):
        r = random.random()
        if r < 0.3:
            grossa = F.max_pool2d(x[None], 3, 1, 1)[0]
            x = torch.maximum(x, grossa * random.uniform(0.5, 0.9))
        elif r < 0.5:
            x = x ** random.uniform(1.5, 2.5)
        return x


O = CLASSES.index("O")


def por_letra(saida):
    """Probabilidade de cada uma das 26 letras: soma a maiúscula e a minúscula."""
    p = F.softmax(saida, 1)
    return torch.zeros(len(p), len(LETRAS)).index_add_(1, GRUPO, p)


def abrir_laco(x):
    """Apaga uma fatia do contorno, vista do centro da tinta: o O que não fechou.

    A abertura tem de 20° a 70°, quase sempre em cima (onde a caneta começa e
    termina o O); às vezes em qualquer lugar. Aberturas maiores já são U ou C.
    """
    img = x[0]
    peso = img.sum()
    if peso < 1:
        return x
    altura, largura = img.shape
    ys = torch.arange(altura, dtype=img.dtype)[:, None].expand(altura, largura)
    xs = torch.arange(largura, dtype=img.dtype)[None, :].expand(altura, largura)
    cy = (img * ys).sum() / peso
    cx = (img * xs).sum() / peso
    angulo = torch.rad2deg(torch.atan2(ys - cy, xs - cx))   # -90° = em cima (y cresce para baixo)
    if random.random() < 0.8:
        centro = -90 + random.gauss(0, 35)
    else:
        centro = random.uniform(-180, 180)
    meia = random.uniform(20, 70) / 2
    diferenca = (angulo - centro + 180) % 360 - 180
    fatia = diferenca.abs() <= meia
    return (img * ~fatia)[None]


def falhar_traco(x):
    """Uma falhinha no traço (a caneta levantou um instante): zera um ponto de tinta."""
    img = x[0]
    tinta = (img > 0.5).nonzero()
    if not len(tinta):
        return x
    y, xx = tinta[random.randrange(len(tinta))].tolist()
    img = img.clone()
    img[max(0, y - 1):y + 1, max(0, xx - 1):xx + 1] = 0
    return img[None]


class ComAberturas(torch.utils.data.Dataset):
    """Aumentos que dependem da letra: metade dos O ganham uma abertura; em
    qualquer letra, às vezes, uma falhinha no traço."""
    def __init__(self, base):
        self.base = base

    def __len__(self):
        return len(self.base)

    def __getitem__(self, i):
        x, y = self.base[i]
        if y == O and random.random() < 0.5:
            x = abrir_laco(x)
        if random.random() < 0.2:
            x = falhar_traco(x)
        return x, y


class Rede(nn.Module):
    # conv 3×3 (mesmo tamanho) + ReLU + max-pool 2×2, três vezes; depois duas densas.
    def __init__(self):
        super().__init__()
        self.c1 = nn.Conv2d(1, 32, 3, padding=1)
        self.c2 = nn.Conv2d(32, 64, 3, padding=1)
        self.c3 = nn.Conv2d(64, 64, 3, padding=1)
        self.d1 = nn.Linear(64 * 3 * 3, 128)
        self.d2 = nn.Linear(128, ROTULOS)
        self.drop = nn.Dropout(0.3)

    def forward(self, x):
        x = F.max_pool2d(F.relu(self.c1(x)), 2)   # 28 -> 14
        x = F.max_pool2d(F.relu(self.c2(x)), 2)   # 14 -> 7
        x = F.max_pool2d(F.relu(self.c3(x)), 2)   # 7 -> 3
        x = x.flatten(1)                          # ordem C, H, W
        x = self.drop(F.relu(self.d1(x)))
        return self.d2(x)


def carregar():
    base = [transforms.ToTensor(), Desvirar()]
    treino_tf = transforms.Compose(base + [
        # deformação elástica: entorta a letra de leve e ao acaso (o topo do A
        # fica redondo ou pontudo, a barra inclina), para aceitar jeitos de
        # escrever que não estão no EMNIST
        transforms.RandomApply([transforms.ElasticTransform(alpha=40.0, sigma=5.0)], p=0.5),
        transforms.RandomAffine(degrees=12, translate=(0.08, 0.08), scale=(0.85, 1.1), shear=12),
        EspessuraAleatoria(),
    ])
    teste_tf = transforms.Compose(base)

    def letras(treinar, tf):
        # ByMerge: 0–9 são dígitos (ficam de fora); 10–46 são as letras
        ds = datasets.EMNIST(DADOS, split="bymerge", train=treinar, download=True,
                             transform=tf, target_transform=lambda y: y - 10)
        indices = (ds.targets >= 10).nonzero().flatten()
        return torch.utils.data.Subset(ds, indices.tolist()), GRUPO[ds.targets[indices] - 10]

    treino, letra_treino = letras(True, treino_tf)
    teste, letra_teste = letras(False, teste_tf)
    # mesmo peso para cada letra (somando maiúscula e minúscula)
    contagem = torch.bincount(letra_treino, minlength=len(LETRAS)).float()
    pesos = (1 / contagem)[letra_treino]
    sorteio = torch.utils.data.WeightedRandomSampler(pesos, POR_EPOCA, replacement=True)
    # o EMNIST Letters (rótulos 1 a 26) fica só para comparar com o modelo antigo
    antigo = datasets.EMNIST(DADOS, split="letters", train=False, download=True,
                             transform=teste_tf, target_transform=lambda y: y - 1)
    return ComAberturas(treino), sorteio, teste, letra_teste, antigo


def avaliar(rede, carregador, detalhar=False, rotulo_e_saida=True):
    """Acerto nas 26 letras (maiúscula e minúscula somadas). `rotulo_e_saida`:
    o rótulo do carregador é uma saída da rede (ByMerge) e vira letra aqui."""
    rede.eval()
    certas = total = 0
    certas_top3 = 0
    acertos = torch.zeros(len(LETRAS))
    quantos = torch.zeros(len(LETRAS))
    with torch.no_grad():
        for x, y in carregador:
            saida = por_letra(rede(x))
            if rotulo_e_saida:
                y = GRUPO[y]
            acertou = saida.argmax(1) == y
            certas += acertou.sum().item()
            certas_top3 += (saida.topk(3, 1).indices == y[:, None]).any(1).sum().item()
            total += len(y)
            acertos.index_add_(0, y, acertou.float())
            quantos.index_add_(0, y, torch.ones(len(y)))
    if detalhar:
        print("por letra: " + " ".join(f"{LETRAS[i]} {acertos[i] / quantos[i]:.3f}"
                                       for i in range(len(LETRAS))), flush=True)
    return certas / total, certas_top3 / total


def exportar(rede, teste, precisao, precisao_top3):
    SAIDA.mkdir(exist_ok=True)
    rede.eval()
    camadas, blocos, deslocamento = [], [], 0

    def guardar(tensor):
        nonlocal deslocamento
        dados = tensor.detach().cpu().numpy().astype("<f2").ravel()
        inicio = deslocamento
        blocos.append(dados.tobytes())
        deslocamento += dados.size
        return {"inicio": inicio, "tamanho": int(dados.size)}

    for conv in (rede.c1, rede.c2, rede.c3):
        camadas.append({
            "tipo": "conv", "entrada": conv.in_channels, "saida": conv.out_channels, "k": 3,
            "pesos": guardar(conv.weight), "vies": guardar(conv.bias),  # pesos [saida, entrada, k, k]
        })
        camadas.append({"tipo": "relu"})
        camadas.append({"tipo": "pool"})
    camadas.append({"tipo": "achatar"})
    camadas.append({"tipo": "densa", "entrada": rede.d1.in_features, "saida": rede.d1.out_features,
                    "pesos": guardar(rede.d1.weight), "vies": guardar(rede.d1.bias)})  # [saida, entrada]
    camadas.append({"tipo": "relu"})
    camadas.append({"tipo": "densa", "entrada": rede.d2.in_features, "saida": rede.d2.out_features,
                    "pesos": guardar(rede.d2.weight), "vies": guardar(rede.d2.bias)})

    (SAIDA / "letras.bin").write_bytes(b"".join(blocos))
    descricao = {
        "versao": 1,
        "dados": "EMNIST ByMerge (NIST), só letras",
        "formato": "float16-le",
        "entrada": [1, 28, 28],
        "classes": CLASSES,   # o app junta as saídas pela letra maiúscula
        "precisao_teste": round(precisao, 4),
        "precisao_teste_top3": round(precisao_top3, 4),
        "camadas": camadas,
    }
    (SAIDA / "letras.json").write_text(json.dumps(descricao, indent=1) + "\n", encoding="utf-8")

    # Algumas imagens de teste com a saída do PyTorch (pesos já arredondados para
    # float16, iguais aos que o JavaScript vai ler), para conferir a inferência em JS.
    with torch.no_grad():
        for p in rede.parameters():
            p.copy_(p.half().float())
        exemplos = []
        for i in range(0, len(teste), len(teste) // 40):
            x, y = teste[i]
            saida = rede(x[None])[0]
            exemplos.append({
                "letra": CLASSES[y].upper(),
                "imagem": [round(v, 3) for v in x[0].ravel().tolist()],
                "saida": [round(v, 4) for v in saida.tolist()],
            })
    (SAIDA / "letras-verificacao.json").write_text(json.dumps(exemplos) + "\n", encoding="utf-8")


def main():
    inicio = time.time()
    treino, sorteio, teste, letra_teste, antigo = carregar()
    print(f"treino: {len(treino)} letras ({POR_EPOCA} sorteadas por época) · "
          f"teste: {len(teste)} letras", flush=True)
    print("teste por letra: " + " ".join(f"{LETRAS[i]} {n}" for i, n in enumerate(
        torch.bincount(letra_teste, minlength=len(LETRAS)).tolist())), flush=True)
    carregador = DataLoader(treino, batch_size=LOTE, sampler=sorteio, num_workers=2)
    carregador_teste = DataLoader(teste, batch_size=1024, num_workers=2)
    carregador_antigo = DataLoader(antigo, batch_size=1024, num_workers=2)

    rede = Rede()
    otimizador = torch.optim.AdamW(rede.parameters(), lr=2e-3, weight_decay=1e-4)
    agenda = torch.optim.lr_scheduler.OneCycleLR(otimizador, max_lr=3e-3,
                                                 total_steps=EPOCAS * len(carregador))
    for epoca in range(1, EPOCAS + 1):
        rede.train()
        for x, y in carregador:
            otimizador.zero_grad()
            perda = F.cross_entropy(rede(x), y, label_smoothing=0.05)
            perda.backward()
            otimizador.step()
            agenda.step()
        precisao, top3 = avaliar(rede, carregador_teste, detalhar=epoca == EPOCAS)
        print(f"época {epoca}: teste {precisao:.4f} (top-3 {top3:.4f}) · {time.time() - inicio:.0f} s", flush=True)

    # o mesmo teste do modelo antigo (EMNIST Letters: 94,5%), para comparar
    antiga, antiga3 = avaliar(rede, carregador_antigo, detalhar=True, rotulo_e_saida=False)
    print(f"teste do EMNIST Letters: {antiga:.4f} (top-3 {antiga3:.4f})", flush=True)

    exportar(rede, teste, precisao, top3)
    print(f"modelo salvo em {SAIDA} · {time.time() - inicio:.0f} s")


if __name__ == "__main__":
    main()
