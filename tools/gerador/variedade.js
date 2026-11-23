// Geração com variedade: uma cruzada por vez, cada uma sabendo o que as
// anteriores usaram, e vários trabalhos em paralelo (sementes diferentes) para
// cada cruzada — fica com a primeira grade que fechar sem defeito.
//
// Regras (para um jogo ser diferente do outro):
//  - palavras de 7+ letras (e o plural/singular delas) não se repetem no mês,
//    as de 5–6 letras não se repetem em 14 dias (de 15 a 30 dias, vão para o fim
//    da fila) e as de 5+ não se repetem dentro do lote (nem entre níveis do dia);
//  - curtas de 3–4 letras já usadas noutro nível do mesmo dia vão para o fim da fila;
//  - curtas usadas 7+ vezes nos dias vizinhos (±7) vão para o meio da fila;
//  - curtas gastas (15+ vezes no último mês publicado) ficam de fora;
//  - AMO e AMA ficam de fora (apareciam em quase todo jogo);
//  - numerais e ordinais ficam de fora (perfis.js);
//  - grade com palavra proibida ou com duas formas da mesma palavra (AMARELO/
//    AMARELA, MAR/MARES, EDITOR/EDITORES; tolera um par de 3 letras, como ASA/ASAS)
//    é descartada; o gênero e o número também valem entre as cruzadas do lote.
//  - dia com tema (tools/temas.json): parte das palavras-tema é plantada na grade
//    antes de preencher, e ela precisa ter de "minimo" a "maximo" delas (senão é descartada).
// Apertar mais que isso trava o preenchimento (testado: a média não fecha).

import { listaDoNivel, PERFIS } from './perfis.js';
import { NOMES } from './palavras.js';

const JANELA = 30;     // dias: palavras de 5+ letras não se repetem
const VIZINHOS = 7;    // dias: contagem das curtas
const FORA_DE_VEZ = new Set(['AMO', 'AMA']);
const MIN_LONGA = 7;   // usadas no mês com tantas letras ou mais não voltam
const RECENTE = 14;    // dias: as de 5–6 letras usadas há menos que isso também não voltam
const GASTA = 15;      // curtas usadas tantas vezes no mês ficam de fora

let estado = null;     // estado do gerador (app.js): base, proibidas, puzzles
let publicadas = null; // { inicio, longas: Map palavra → última data, usos: Map, curtas: [{ data, palavras }] }
let ativos = [];
export let ultimaLista = null; // a lista da última cruzada pedida (para conferir pelo console)
export const descartados = []; // motivos dos descartes (para conferir pelo console)

export function iniciarVariedade(est) { estado = est; publicadas = null; }

const somar = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const distancia = (a, b) => Math.abs(new Date(`${a}T12:00:00Z`) - new Date(`${b}T12:00:00Z`)) / 864e5;

/** Lê as cruzadas publicadas do mês antes do lote (as do lote em diante vão ser trocadas). */
async function lerPublicadas(inicio) {
  if (publicadas && publicadas.inicio === inicio) return;
  publicadas = { inicio, longas: new Map(), usos: new Map(), curtas: [] };
  const indice = (await (await fetch('../puzzles/index.json', { cache: 'no-cache' })).json()).datas || {};
  const desde = somar(inicio, -JANELA);
  for (const [data, niveis] of Object.entries(indice)) {
    if (data < desde || data >= inicio) continue;
    for (const nivel of niveis) {
      const p = await (await fetch(`../puzzles/${data}-${nivel}.json`, { cache: 'no-cache' })).json();
      for (const { resposta: w } of p.dicas) {
        if (w.length >= 5 && !(publicadas.longas.get(w) > data)) publicadas.longas.set(w, data); // última vez usada
        publicadas.usos.set(w, (publicadas.usos.get(w) || 0) + 1);
      }
      publicadas.curtas.push({ data, palavras: p.dicas.map(d => d.resposta) });
    }
  }
}

/** Duas formas da mesma palavra na grade, palavra proibida ou nomes próprios demais. Devolve o motivo ou null. */
export function defeito(dicas, nivel = null, tema = null) {
  const ws = dicas.map(d => d.resposta);
  const doTema = w => Boolean(tema && tema.todas.has(w)); // as palavras-tema valem mesmo se proibidas ou nomes
  const proibida = ws.find(w => !doTema(w) && estado.proibidas && estado.proibidas.has(w));
  if (proibida) return `proibida ${proibida}`;
  if (tema) {
    const n = ws.filter(doTema).length;
    if (n < tema.minimo) return `tema: só ${n} de ${tema.minimo}`;
    if (n > tema.maximo) return `tema: ${n}, mais que ${tema.maximo}`;
  }
  const nomes = ws.filter(w => NOMES.has(w) && !doTema(w));
  if (nivel && nomes.length > (PERFIS[nivel].nomes ?? 0)) return `nomes demais: ${nomes.join(" ")}`;
  const curtos = [];
  for (const a of ws) for (const b of ws) {
    if (a >= b) continue;
    const curta = a.length <= b.length ? a : b, longa = curta === a ? b : a;
    if (curta.length < 3) continue;
    const sufixo = longa.startsWith(curta) ? longa.slice(curta.length) : null;
    const fim = curta.at(-1);
    if (sufixo !== null && (
      (sufixo === 'S' && 'AEIOU'.includes(fim)) ||        // ASA/ASAS
      (sufixo === 'ES' && 'RZLS'.includes(fim)) ||        // MAR/MARES
      (sufixo === 'M' && (fim === 'A' || fim === 'E')) || // ERA/ERAM
      (sufixo === 'R' && fim === 'A') ||                  // ORA/ORAR
      (['AM', 'RAM'].includes(sufixo) && curta.length >= 4))) {
      if (curta.length >= 4) return `${a}/${b}`;
      curtos.push(`${a}/${b}`);
      if (curtos.length >= 2) return curtos.join(' ');
      continue;
    }
    const fins = new Set([a.at(-1), b.at(-1)]);
    if (curta.length >= 4 && a.length === b.length && a.slice(0, -1) === b.slice(0, -1) && fins.has('O') && fins.has('A')) return `${a}/${b}`;
    // gênero e número com 4+ letras: EDITOR/EDITORA/EDITORES, AMARGO/AMARGAS, LISA/LISOS
    if (curta.length >= 4 && raiz(a).length >= 3 && raiz(a) === raiz(b)) return `${a}/${b}`;
  }
  return null;
}

/** Tira plural e gênero: EDITORES → EDITOR, EDITORA → EDITOR, AMARGOS → AMARG, LISOS → LIS. */
function raiz(w) {
  if (w.endsWith('S')) w = w.slice(0, -1);
  if (w.endsWith('E') && 'RLZS'.includes(w.at(-2))) w = w.slice(0, -1);
  if ((w.endsWith('A') || w.endsWith('O')) && w.length > 3) w = w.slice(0, -1);
  return w;
}

/**
 * Formas de gênero e número a partir da raiz (sobram algumas que não existem; não faz mal).
 * Só as de 5+ letras: bloquear as curtas (a "cola" da grade) trava o preenchimento.
 */
const formas = w => { const r = raiz(w); return [w, ...['', 'S', 'A', 'AS', 'O', 'OS', 'E', 'ES'].map(f => r + f)].filter(f => f.length >= 5); };

/**
 * Palavras a evitar nesta cruzada (cada uma com o plural/singular):
 *  - duro (ficam de fora): as de 5+ letras do resto do lote (outros níveis do
 *    mesmo dia, outros dias); as publicadas de 7+ letras do mês; as de 5–6
 *    letras publicadas nos últimos 14 dias; as de 3–4 letras gastas (15+ vezes no mês);
 *  - mole (vão para o fim da fila): as de 5–6 letras publicadas há 15–30 dias.
 */
function evitarPara(arquivo, data) {
  const duro = new Set(), mole = new Set();
  const variar = (w, alvo) => { alvo.add(w); alvo.add(w + 'S'); if (w.endsWith('S')) alvo.add(w.slice(0, -1)); };
  for (const [w, ultima] of publicadas.longas) {
    if (w.length >= MIN_LONGA) formas(w).forEach(f => duro.add(f)); // COREANO ontem → nem COREANA hoje
    else variar(w, distancia(ultima, data) <= RECENTE ? duro : mole);
  }
  for (const [w, n] of publicadas.usos) if (w.length >= 3 && w.length <= 4 && n >= GASTA) duro.add(w);
  for (const [a, p] of estado.puzzles) if (a !== arquivo) p.dicas.forEach(d => d.resposta.length >= 5 && formas(d.resposta).forEach(f => duro.add(f)));
  for (const w of duro) mole.delete(w);
  return { duro, mole };
}

/** Ordem das curtas: novas → muito usadas nos vizinhos → do mesmo dia e gastas. */
function ordenar(lista, data, arquivo) {
  const fontes = [...publicadas.curtas, ...[...estado.puzzles].filter(([a]) => a !== arquivo)
    .map(([, p]) => ({ data: p.data, palavras: p.dicas.map(d => d.resposta) }))];
  const vizinhas = new Map(), mesmoDia = new Set(), mes = new Map();
  for (const f of fontes) {
    for (const w of f.palavras) {
      if (w.length < 3 || w.length > 4) continue;
      if (f.data < publicadas.inicio) mes.set(w, (mes.get(w) || 0) + 1);
      if (distancia(f.data, data) > VIZINHOS) continue;
      vizinhas.set(w, (vizinhas.get(w) || 0) + 1);
      if (f.data === data) mesmoDia.add(w);
    }
  }
  const tardia = w => mesmoDia.has(w) || (mes.get(w) || 0) >= 15;
  const meio = w => (vizinhas.get(w) || 0) >= 7;
  return [
    ...lista.filter(w => !tardia(w) && !meio(w)),
    ...lista.filter(w => !tardia(w) && meio(w)),
    ...lista.filter(tardia),
  ];
}

export function pararVariedade() { ativos.forEach(w => w.terminate()); ativos = []; }

/**
 * Palavras-tema desta cruzada (dia com tema, tools/temas.json). Uma parte
 * sorteada é plantada na grade antes de preencher (esqueleto.js, semear) e vai
 * para a frente da fila; as outras ficam no lugar de sempre (tirá-las da lista
 * trava a grade: muitas são curtas comuns, como ARCO). As de 5+ letras já usadas
 * noutro nível do dia não entram; a regra do mês não vale para elas.
 *  - tema: { palavras: [...], minimo: { nivel: n }, maximo: { nivel: n } }.
 */
function palavrasDoTema(tema, arquivo, nivel) {
  const doLote = new Set();
  for (const [a, p] of estado.puzzles) if (a !== arquivo) p.dicas.forEach(d => d.resposta.length >= 5 && formas(d.resposta).forEach(f => doLote.add(f)));
  const todas = new Set(tema.palavras);
  const livres = [...todas].filter(w => w.length >= 2 && w.length <= PERFIS[nivel].maxLetras && !doLote.has(w) && !FORA_DE_VEZ.has(w));
  for (let i = livres.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [livres[i], livres[j]] = [livres[j], livres[i]]; }
  // as de 4–7 letras primeiro: cruzam melhor (as longas, com letras fixas, travam a grade)
  livres.sort((a, b) => (a.length < 4 || a.length > 7) - (b.length < 4 || b.length > 7));
  const minimo = tema.minimo?.[nivel] ?? 4;
  return { todas, frente: livres.slice(0, 3 * minimo), minimo, maximo: tema.maximo?.[nivel] ?? minimo + 4 };
}

/**
 * Gera uma cruzada (data + nível) com n trabalhos em paralelo. Devolve o
 * puzzle (sem id nem título) ou null se nenhum trabalho conseguiu.
 * tema (opcional): ver palavrasDoTema; a grade precisa ter de minimo a maximo palavras-tema.
 */
export async function gerarUma(data, nivel, inicio, n = 8, tema = null) {
  await lerPublicadas(inicio);
  const arquivo = `${data}-${nivel}`;
  // as de 5–6 letras usadas há 15–30 dias só vão para o fim da fila: são as que
  // cruzam com tudo, e proibir todas trava a grade com palavras longas
  const { duro, mole } = evitarPara(arquivo, data);
  const ordem = ordenar(listaDoNivel(estado.base, nivel, duro, estado.verbais).filter(w => !FORA_DE_VEZ.has(w) && !duro.has(w)), data, arquivo);
  let lista = [...ordem.filter(w => !mole.has(w)), ...ordem.filter(w => mole.has(w))];
  const doTema = tema && palavrasDoTema(tema, arquivo, nivel);
  // todas as palavras-tema na frente da fila (sem tirar nenhuma da lista), as plantadas primeiro
  if (doTema) {
    const frente = [...new Set([...doTema.frente, ...doTema.todas])].filter(w => w.length <= PERFIS[nivel].maxLetras);
    const naFrente = new Set(frente);
    lista = [...frente, ...lista.filter(w => !naFrente.has(w))];
  }
  ultimaLista = lista;
  pararVariedade();
  return new Promise(resolver => {
    let feito = false, falhas = 0, descartes = 0;
    const lancar = () => {
      const w = new Worker('gerador/trabalhador.js', { type: 'module' });
      ativos.push(w);
      w.onmessage = ({ data: m }) => {
        if (m.log || feito) return;
        const motivo = !m.falhou && defeito(m.pronto.dicas, nivel, doTema);
        if (motivo) {
          descartados.push(`${arquivo}: ${motivo}`);
          // grade com defeito: descarta e põe outro trabalho no lugar
          w.terminate();
          if (++descartes <= 40) { lancar(); return; }
          m = { falhou: true };
        }
        if (m.falhou) { if (++falhas === n) { feito = true; resolver(null); } return; }
        feito = true;
        pararVariedade();
        resolver({ data, nivel, semente: m.pronto.semente, grade: m.pronto.grade, dicas: m.pronto.dicas, descartes });
      };
      w.postMessage({ id: arquivo, lista, perfil: PERFIS[nivel], semente: Math.floor(Math.random() * 1e8), tentativas: 400,
        tema: doTema ? { palavras: doTema.frente, quantas: Math.min(3, Math.max(2, doTema.minimo - 1)), todas: [...doTema.todas] } : null });
    };
    for (let k = 0; k < n; k++) lancar();
  });
}
