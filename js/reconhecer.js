// Reconhecimento das letras escritas à caneta, para conferir a cruzada.
//
// O app sabe a resposta de cada casa, então não precisa descobrir "que letra
// é esta": basta conferir se a tinta da casa parece a letra esperada.
//
// Etapas:
//   1. tracosPorCasa — separa os traços de caneta por casa de letra (lápis,
//      casas de dica e rabiscos que atravessam casas ficam de fora);
//   2. rasterizar    — desenha os traços da casa numa imagem 28×28 do mesmo
//      jeito das letras do EMNIST (com que o modelo foi treinado);
//   3. inferir       — roda a rede (pesos em modelo/letras.*) em JavaScript puro;
//   4. conferirLetra — certa, errada ou ilegível, conforme a probabilidade da
//      letra esperada.
//
// O modelo é treinado por tools/treino/treinar_letras.py (GitHub Actions).

const PASTA_MODELO = new URL('../modelo/', import.meta.url);

// ---------- Modelo ----------

let modeloPromessa = null;

/**
 * Carrega (uma vez) a descrição e os pesos do modelo. `pasta` (opcional, URL)
 * carrega outro modelo, sem guardar, para comparar nas ferramentas de teste.
 */
export function carregarModelo(pasta = null) {
  if (pasta) return lerModelo(pasta);
  if (!modeloPromessa) {
    modeloPromessa = lerModelo(PASTA_MODELO);
    modeloPromessa.catch(() => { modeloPromessa = null; });
  }
  return modeloPromessa;
}

async function lerModelo(pasta) {
  const [descricao, binario] = await Promise.all([
    fetch(new URL('letras.json', pasta)).then(r => { if (!r.ok) throw new Error(`modelo: HTTP ${r.status}`); return r.json(); }),
    fetch(new URL('letras.bin', pasta)).then(r => { if (!r.ok) throw new Error(`modelo: HTTP ${r.status}`); return r.arrayBuffer(); }),
  ]);
  const pesos = decodificarFloat16(new Uint16Array(binario));
  const pegar = ({ inicio, tamanho }) => pesos.subarray(inicio, inicio + tamanho);
  const camadas = descricao.camadas.map(c => (c.pesos ? { ...c, w: pegar(c.pesos), b: pegar(c.vies) } : c));
  // A rede pode ter mais de uma saída por letra (maiúscula e minúscula de
  // desenho diferente, como A e a): `saidas` são as saídas da rede, `classes`
  // as 26 letras e `grupo` diz a letra de cada saída.
  const classes = [...new Set(descricao.classes.toUpperCase())].join('');
  const grupo = Array.from(descricao.classes, l => classes.indexOf(l.toUpperCase()));
  // identifica o modelo (a memória de letras guarda resumos feitos por ele)
  const assinatura = `${descricao.dados}|${descricao.precisao_teste}|${binario.byteLength}`;
  return { ...descricao, saidas: descricao.classes, classes, grupo, camadas, assinatura };
}

function decodificarFloat16(bits) {
  const saida = new Float32Array(bits.length);
  for (let i = 0; i < bits.length; i++) {
    const h = bits[i];
    const sinal = h & 0x8000 ? -1 : 1;
    const exp = (h >> 10) & 0x1f;
    const frac = h & 0x3ff;
    if (exp === 0) saida[i] = sinal * 2 ** -14 * (frac / 1024);
    else if (exp === 31) saida[i] = frac ? NaN : sinal * Infinity;
    else saida[i] = sinal * 2 ** (exp - 15) * (1 + frac / 1024);
  }
  return saida;
}

/** Roda a rede numa imagem 28×28 (Float32Array, fundo 0, tinta 1). Devolve as saídas (logits). */
export function inferir(modelo, imagem) {
  return inferirComResumo(modelo, imagem).logits;
}

/**
 * Como inferir, e devolve também o "resumo" da letra: a penúltima camada da rede
 * (depois do último ReLU), que serve para comparar com letras já confirmadas.
 */
export function inferirComResumo(modelo, imagem) {
  let x = imagem;
  let resumo = null;
  let [c, h, w] = modelo.entrada;
  for (const camada of modelo.camadas) {
    if (camada.tipo === 'conv') {
      x = conv3x3(x, c, h, w, camada);
      c = camada.saida;
    } else if (camada.tipo === 'relu') {
      for (let i = 0; i < x.length; i++) if (x[i] < 0) x[i] = 0;
      resumo = x;
    } else if (camada.tipo === 'pool') {
      x = pool2x2(x, c, h, w);
      h = Math.floor(h / 2); w = Math.floor(w / 2);
    } else if (camada.tipo === 'densa') {
      x = densa(x, camada);
    } // 'achatar': x já está na ordem canal, linha, coluna
  }
  return { logits: x, resumo };
}

// Convolução 3×3 com borda de zeros. A entrada ganha a borda uma vez (sem testes
// de limite no laço de dentro) e os 9 pesos de cada filtro ficam em variáveis.
function conv3x3(x, c, h, w, { saida, w: pesos, b: vies }) {
  const W = w + 2, H = h + 2;
  const xp = new Float32Array(c * H * W);
  for (let i = 0; i < c; i++) {
    for (let l = 0; l < h; l++) xp.set(x.subarray((i * h + l) * w, (i * h + l + 1) * w), (i * H + l + 1) * W + 1);
  }
  const y = new Float32Array(saida * h * w);
  for (let o = 0; o < saida; o++) {
    const base = o * h * w;
    y.fill(vies[o], base, base + h * w);
    for (let i = 0; i < c; i++) {
      const p = (o * c + i) * 9;
      const k0 = pesos[p], k1 = pesos[p + 1], k2 = pesos[p + 2];
      const k3 = pesos[p + 3], k4 = pesos[p + 4], k5 = pesos[p + 5];
      const k6 = pesos[p + 6], k7 = pesos[p + 7], k8 = pesos[p + 8];
      const ent = i * H * W;
      for (let l = 0; l < h; l++) {
        let a = ent + l * W;          // linha de cima (na entrada com borda)
        let b = a + W, d = b + W;     // do meio e de baixo
        let s = base + l * w;
        for (let col = 0; col < w; col++, a++, b++, d++, s++) {
          y[s] += k0 * xp[a] + k1 * xp[a + 1] + k2 * xp[a + 2]
                + k3 * xp[b] + k4 * xp[b + 1] + k5 * xp[b + 2]
                + k6 * xp[d] + k7 * xp[d + 1] + k8 * xp[d + 2];
        }
      }
    }
  }
  return y;
}

function pool2x2(x, c, h, w) {
  const h2 = Math.floor(h / 2), w2 = Math.floor(w / 2);
  const y = new Float32Array(c * h2 * w2);
  for (let i = 0; i < c; i++) {
    for (let l = 0; l < h2; l++) {
      for (let col = 0; col < w2; col++) {
        const p = i * h * w + 2 * l * w + 2 * col;
        y[i * h2 * w2 + l * w2 + col] = Math.max(x[p], x[p + 1], x[p + w], x[p + w + 1]);
      }
    }
  }
  return y;
}

function densa(x, { entrada, saida, w: pesos, b: vies }) {
  const y = new Float32Array(saida);
  for (let o = 0; o < saida; o++) {
    let soma = vies[o];
    const linha = o * entrada;
    for (let i = 0; i < entrada; i++) soma += pesos[linha + i] * x[i];
    y[o] = soma;
  }
  return y;
}

/** Saídas da rede -> probabilidade de cada letra (com o modelo, soma as formas da mesma letra). */
export function probabilidades(logits, modelo = null) {
  const max = Math.max(...logits);
  const e = Array.from(logits, v => Math.exp(v - max));
  const soma = e.reduce((a, b) => a + b, 0);
  const p = e.map(v => v / soma);
  if (!modelo?.grupo) return p;
  const porLetra = new Array(modelo.classes.length).fill(0);
  p.forEach((v, i) => { porLetra[modelo.grupo[i]] += v; });
  return porLetra;
}

// ---------- Traços -> imagem como o EMNIST ----------

// Grossura do traço em relação ao maior lado da letra. No EMNIST o traço
// fica com uns 2–3 px numa letra de ~24 px.
export const ESPESSURA_PADRAO = 0.1;
const LADO = 128;       // resolução de trabalho (como os formulários originais do NIST)
const MARGEM = 2;       // px de folga em volta da letra, nessa resolução

let telaTrabalho = null;
let telaFinal = null;

/**
 * Desenha os traços (listas de pontos [x, y], em qualquer unidade, mesma escala
 * nos dois eixos) e devolve a imagem 28×28 (Float32Array) ou null se não há tinta.
 */
export function rasterizar(tracos, espessura = ESPESSURA_PADRAO) {
  const pontos = tracos.flat();
  if (!pontos.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pontos) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const tamanho = Math.max(x1 - x0, y1 - y0, 1e-6);

  // 1. Desenha a letra com o maior lado em ~80% da tela de trabalho.
  telaTrabalho ??= new OffscreenCanvas(LADO, LADO);
  const ctx = telaTrabalho.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, LADO, LADO);
  const escala = (LADO * 0.8) / tamanho;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  ctx.save();
  ctx.filter = 'blur(1px)'; // o EMNIST passa um desfoque gaussiano antes de reduzir
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, espessura * LADO * 0.8);
  for (const traco of tracos) {
    const px = ([x, y]) => [LADO / 2 + (x - cx) * escala, LADO / 2 + (y - cy) * escala];
    ctx.beginPath();
    if (traco.length === 1) {
      const [a, b] = px(traco[0]);
      ctx.arc(a, b, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.moveTo(...px(traco[0]));
    for (let i = 1; i < traco.length; i++) ctx.lineTo(...px(traco[i]));
    ctx.stroke();
  }
  ctx.restore();

  // 2. Caixa da tinta (com o desfoque).
  const dados = ctx.getImageData(0, 0, LADO, LADO).data;
  let a0 = LADO, b0 = LADO, a1 = -1, b1 = -1;
  for (let y = 0; y < LADO; y++) {
    for (let x = 0; x < LADO; x++) {
      if (dados[(y * LADO + x) * 4 + 3] > 8) {
        if (x < a0) a0 = x; if (x > a1) a1 = x;
        if (y < b0) b0 = y; if (y > b1) b1 = y;
      }
    }
  }
  if (a1 < 0) return null;

  // 3. Quadrado com a letra centralizada e 2 px de margem, reduzido a 28×28.
  const w = a1 - a0 + 1, h = b1 - b0 + 1;
  const lado = Math.max(w, h) + 2 * MARGEM;
  telaFinal ??= new OffscreenCanvas(28, 28);
  const fim = telaFinal.getContext('2d', { willReadFrequently: true });
  fim.clearRect(0, 0, 28, 28);
  fim.imageSmoothingEnabled = true;
  fim.imageSmoothingQuality = 'high';
  const k = 28 / lado;
  fim.drawImage(telaTrabalho, a0, b0, w, h,
    (lado - w) / 2 * k, (lado - h) / 2 * k, w * k, h * k);
  const pequeno = fim.getImageData(0, 0, 28, 28).data;
  const imagem = new Float32Array(28 * 28);
  let maximo = 0;
  for (let i = 0; i < imagem.length; i++) {
    imagem[i] = pequeno[i * 4 + 3] / 255;
    if (imagem[i] > maximo) maximo = imagem[i];
  }
  if (maximo > 0) for (let i = 0; i < imagem.length; i++) imagem[i] /= maximo;
  return imagem;
}

// ---------- Tinta da grade -> traços por casa ----------

/**
 * Agrupa os traços de caneta por casa de letra.
 * `tracos`: os traços salvos (pontos normalizados 0–1 em relação à grade).
 * `proporcao`: altura / largura de cada casa na tela (para a letra não deformar).
 * Devolve Map "linha,coluna" -> lista de traços em unidades de casa
 * (x em larguras de casa, y em larguras de casa também).
 */
export function tracosPorCasa(tracos, puzzle, proporcao = 1) {
  const { largura: colunas, altura: linhas, grade } = puzzle;
  const porCasa = new Map();
  for (const t of tracos) {
    if (t.ferramenta !== 'caneta' || !t.pontos?.length) continue; // lápis é rascunho
    const pts = t.pontos.map(([x, y]) => [x * colunas, y * linhas]);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 - x0 > 1.3 || y1 - y0 > 1.3) continue; // risco que atravessa casas
    const c = Math.floor((x0 + x1) / 2), l = Math.floor((y0 + y1) / 2);
    if (l < 0 || l >= linhas || c < 0 || c >= colunas || grade[l][c] === '#') continue;
    const chave = `${l},${c}`;
    if (!porCasa.has(chave)) porCasa.set(chave, []);
    porCasa.get(chave).push(pts.map(([x, y]) => [x, y * proporcao]));
  }
  return porCasa;
}

// ---------- Conferir ----------

// Limites (ajustados com a página de teste tools/reconhecer.html).
export const LIMITES = {
  certa: 0.2,      // a letra esperada com pelo menos essa probabilidade: certa
  certaParecida: 0.1, // idem, quando a lida é uma das PARECIDAS da esperada
  errada: 0.7,     // outra letra com essa certeza...
  esperadaMax: 0.05, // ...e a esperada abaixo disso: errada
};

// Letras que um traço meio torto da esperada vira com facilidade. Lida uma
// dessas no lugar da esperada, a casa fica no máximo ilegível, nunca errada
// (o O que não fechou em cima vira U ou J; aberto do lado, C).
const PARECIDAS = {
  O: 'UCJDGQ',
};

/**
 * Confere uma letra. Devolve { resultado: 'certa' | 'errada' | 'ilegivel',
 * lida, confianca, esperada, pEsperada, top3 }.
 */
export function conferirLetra(modelo, probs, esperada) {
  const classes = modelo.classes;
  const ordem = probs.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]);
  const [pTopo, iTopo] = ordem[0];
  const iEsperada = classes.indexOf(esperada);
  const pEsperada = iEsperada >= 0 ? probs[iEsperada] : 0;
  let resultado = 'ilegivel';
  const parecida = (PARECIDAS[esperada] || '').includes(classes[iTopo]);
  if (iTopo === iEsperada || pEsperada >= LIMITES.certa) resultado = 'certa';
  else if (parecida && pEsperada >= LIMITES.certaParecida) resultado = 'certa';
  else if (pTopo >= LIMITES.errada && pEsperada < LIMITES.esperadaMax && !parecida) resultado = 'errada';
  return {
    resultado,
    lida: classes[iTopo],
    confianca: pTopo,
    esperada,
    pEsperada,
    top3: ordem.slice(0, 3).map(([p, i]) => [classes[i], p]),
  };
}

/**
 * Atalho: traços de uma casa -> resultado da conferência (ou null se a casa está vazia).
 * Com a `memoria` (js/memoria.js), a leitura também compara a letra com as já
 * confirmadas neste aparelho.
 */
export function conferirCasa(modelo, tracosDaCasa, esperada, espessura = ESPESSURA_PADRAO, memoria = null) {
  const imagem = rasterizar(tracosDaCasa, espessura);
  if (!imagem) return null;
  const { logits, resumo } = inferirComResumo(modelo, imagem);
  let probs = probabilidades(logits, modelo);
  if (memoria) probs = memoria.ajustar(probs, resumo);
  return { ...conferirLetra(modelo, probs, esperada), imagem };
}
