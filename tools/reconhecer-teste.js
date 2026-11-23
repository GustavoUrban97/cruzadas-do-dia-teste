// Página de teste do reconhecimento (tools/reconhecer.html).
//  - Letras soltas: 26 casas do tamanho das da grade, cada uma pedindo uma letra;
//    mede quantas o modelo dá como certas, erradas ou ilegíveis (acumulado guardado).
//  - Conferir uma cruzada: abre um dia passado com a tinta salva neste aparelho
//    e mostra o resultado de cada casa, como seria no "Terminei".

import {
  carregarModelo, inferir, conferirCasa, conferirLetra, tracosPorCasa, ESPESSURA_PADRAO,
} from '../js/reconhecer.js';
import { renderizarGrade, ajustarTamanho } from '../js/grade.js';
import { Tinta } from '../js/tinta.js';
import { carregarTinta } from '../js/armazenamento.js';
import { hojeEmBrasilia, somarDias } from '../js/datas.js';

const $ = id => document.getElementById(id);
const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const COLUNAS = 13, LINHAS = 2;
const CHAVE_ACUMULADO = 'teste-reconhecer';

const pct = v => `${Math.round(v * 100)}%`;

function lerJSON(chave, padrao) {
  try { return JSON.parse(localStorage.getItem(chave)) ?? padrao; } catch { return padrao; }
}
function gravarJSON(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* tudo bem */ }
}

function embaralhar(lista) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let modelo = null;
const espessura = () => Number($('espessura').value) || ESPESSURA_PADRAO;

// ---------- Abas ----------

for (const botao of document.querySelectorAll('[data-aba]')) {
  botao.addEventListener('click', () => {
    for (const b of document.querySelectorAll('[data-aba]')) b.setAttribute('aria-pressed', String(b === botao));
    $('soltas').hidden = botao.dataset.aba !== 'soltas';
    $('cruzada').hidden = botao.dataset.aba !== 'cruzada';
  });
}

// ---------- Letras soltas ----------

const quadro = $('quadro');
let alvos = [];
let casas = [];
let tracos = [];        // { ferramenta: 'caneta', pontos: [[x, y]] } normalizados no quadro
let atual = null;
let tela, ctx;
let acumulado = lerJSON(CHAVE_ACUMULADO, { total: 0, certa: 0, errada: 0, ilegivel: 0, erros: [] });
let baseRodada = structuredClone(acumulado); // acumulado antes da rodada atual

function montarQuadro() {
  const w = Math.min(58, Math.floor((innerWidth - 48 - 16) / COLUNAS));
  quadro.style.setProperty('--casa-w', `${w}px`);
  quadro.style.setProperty('--casa-h', `${Math.round(w * 1.17)}px`);
  quadro.replaceChildren();
  casas = alvos.map(letra => {
    const casa = document.createElement('div');
    casa.className = 'casa-teste';
    const alvo = document.createElement('span');
    alvo.className = 'alvo';
    alvo.textContent = letra;
    casa.append(alvo);
    quadro.append(casa);
    return casa;
  });
  tela = document.createElement('canvas');
  quadro.append(tela);
  ctx = tela.getContext('2d');
  requestAnimationFrame(redesenhar);
}

function redesenhar() {
  const r = quadro.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  tela.width = Math.round(r.width * dpr);
  tela.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const t of tracos) {
    ctx.beginPath();
    t.pontos.forEach(([x, y], i) => (i ? ctx.lineTo(x * r.width, y * r.height) : ctx.moveTo(x * r.width, y * r.height)));
    if (t.pontos.length === 1) ctx.lineTo(t.pontos[0][0] * r.width + 0.1, t.pontos[0][1] * r.height);
    ctx.stroke();
  }
}

function ponto(e) {
  const r = quadro.getBoundingClientRect();
  return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
}

quadro.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch' || atual) return; // dedo/palma não escreve
  e.preventDefault();
  quadro.setPointerCapture(e.pointerId);
  atual = { id: e.pointerId, traco: { ferramenta: 'caneta', pontos: [ponto(e)] } };
  tracos.push(atual.traco);
});
quadro.addEventListener('pointermove', e => {
  if (!atual || e.pointerId !== atual.id) return;
  const eventos = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of (eventos.length ? eventos : [e])) atual.traco.pontos.push(ponto(ev));
  redesenhar();
});
const soltar = e => { if (atual && e.pointerId === atual.id) { atual = null; redesenhar(); } };
quadro.addEventListener('pointerup', soltar);
quadro.addEventListener('pointercancel', soltar);
quadro.addEventListener('contextmenu', e => e.preventDefault());

function novaRodada() {
  alvos = embaralhar(LETRAS);
  tracos = [];
  baseRodada = structuredClone(acumulado);
  $('resumo-rodada').textContent = '';
  montarQuadro();
}

function limparMarcas() {
  for (const casa of casas) {
    casa.classList.remove('conf-certa', 'conf-errada', 'conf-ilegivel');
    casa.querySelectorAll('.rotulo-resultado, .miniatura').forEach(el => el.remove());
  }
}

function conferirQuadro() {
  if (!modelo) return;
  limparMarcas();
  const r = quadro.getBoundingClientRect();
  const proporcao = (r.height / LINHAS) / (r.width / COLUNAS);
  const falsoPuzzle = { largura: COLUNAS, altura: LINHAS, grade: ['A'.repeat(COLUNAS), 'A'.repeat(COLUNAS)] };
  const porCasa = tracosPorCasa(tracos, falsoPuzzle, proporcao);
  const rodada = { total: 0, certa: 0, errada: 0, ilegivel: 0, erros: [] };
  alvos.forEach((esperada, i) => {
    const t = porCasa.get(`${Math.floor(i / COLUNAS)},${i % COLUNAS}`);
    if (!t) return;
    const res = conferirCasa(modelo, t, esperada, espessura());
    if (!res) return;
    rodada.total++;
    rodada[res.resultado]++;
    if (res.resultado !== 'certa') {
      rodada.erros.push(`${esperada}→${res.lida} (${pct(res.confianca)}; ${esperada} ${pct(res.pEsperada)})`);
    }
    marcar(casas[i], res);
  });
  // A rodada substitui a sua própria contribuição anterior (pode conferir de novo após corrigir).
  acumulado = {
    total: baseRodada.total + rodada.total,
    certa: baseRodada.certa + rodada.certa,
    errada: baseRodada.errada + rodada.errada,
    ilegivel: baseRodada.ilegivel + rodada.ilegivel,
    erros: [...rodada.erros, ...baseRodada.erros].slice(0, 40),
  };
  gravarJSON(CHAVE_ACUMULADO, acumulado);
  $('resumo-rodada').innerHTML = rodada.total
    ? `Esta rodada: <b>${rodada.certa} de ${rodada.total}</b> certas · ${rodada.errada} erradas · ${rodada.ilegivel} ilegíveis`
    : 'Nada escrito ainda.';
  mostrarAcumulado();
}

function marcar(casa, res) {
  casa.classList.add(`conf-${res.resultado}`);
  const rotulo = document.createElement('span');
  rotulo.className = 'rotulo-resultado';
  rotulo.textContent = `${res.lida} ${pct(res.confianca)}`;
  casa.append(rotulo);
  if (res.imagem) casa.append(miniatura(res.imagem));
}

function miniatura(imagem) {
  const c = document.createElement('canvas');
  c.className = 'miniatura';
  c.width = 28; c.height = 28;
  const g = c.getContext('2d');
  const dados = g.createImageData(28, 28);
  for (let i = 0; i < 784; i++) {
    const v = 255 - Math.round(imagem[i] * 255);
    dados.data.set([v, v, v, 255], i * 4);
  }
  g.putImageData(dados, 0, 0);
  return c;
}

function mostrarAcumulado() {
  const a = acumulado;
  $('resumo-total').innerHTML = a.total
    ? `Acumulado: <b>${a.certa} de ${a.total} certas (${pct(a.certa / a.total)})</b> · ` +
      `${a.errada} erradas (${pct(a.errada / a.total)}) · ${a.ilegivel} ilegíveis (${pct(a.ilegivel / a.total)})`
    : 'Acumulado: nenhuma letra conferida ainda.';
  $('lista-erros').textContent = a.erros.length ? `Últimas que não deram certa: ${a.erros.join(' · ')}` : '';
}

$('conferir').addEventListener('click', conferirQuadro);
$('limpar').addEventListener('click', () => { tracos = []; limparMarcas(); redesenhar(); });
$('desfazer-teste').addEventListener('click', () => { tracos.pop(); redesenhar(); });
$('nova-rodada').addEventListener('click', novaRodada);
$('zerar').addEventListener('click', () => {
  acumulado = { total: 0, certa: 0, errada: 0, ilegivel: 0, erros: [] };
  baseRodada = structuredClone(acumulado);
  gravarJSON(CHAVE_ACUMULADO, acumulado);
  mostrarAcumulado();
});
$('espessura').value = ESPESSURA_PADRAO;
$('espessura-valor').textContent = ESPESSURA_PADRAO.toFixed(2);
$('espessura').addEventListener('input', () => { $('espessura-valor').textContent = espessura().toFixed(2); });
$('miniaturas').addEventListener('change', () => quadro.classList.toggle('sem-miniaturas', !$('miniaturas').checked));
quadro.classList.add('sem-miniaturas');
addEventListener('resize', () => requestAnimationFrame(redesenhar));

// ---------- Conferir uma cruzada ----------

const ontem = somarDias(hojeEmBrasilia(), -1);
$('dia').value = ontem;
$('dia').max = ontem; // nunca hoje nem dias futuros (as respostas aparecem)

$('abrir').addEventListener('click', async () => {
  const dia = $('dia').value, nivel = $('nivel').value;
  $('resumo-cruzada').textContent = 'Conferindo…';
  $('erros-cruzada').textContent = '';
  try {
    if (!dia || dia > ontem) throw new Error('escolha um dia passado');
    const resposta = await fetch(`../puzzles/${dia}-${nivel}.json`, { cache: 'no-cache' });
    if (!resposta.ok) throw new Error(`não há cruzada ${nivel} em ${dia}`);
    const puzzle = await resposta.json();
    const { tracos: salvos, letras } = await carregarTinta(dia, nivel);

    const grade = $('grade-cruzada'), folha = $('folha-cruzada'), papel = $('papel-cruzada');
    renderizarGrade(grade, puzzle);
    const w = Math.min(58, Math.floor((innerWidth - 48) / puzzle.largura));
    folha.style.width = `${w * puzzle.largura + 4}px`;
    folha.style.height = `${Math.round(w * 1.17) * puzzle.altura + 4}px`;
    ajustarTamanho(grade, folha, puzzle);
    papel.querySelectorAll('canvas').forEach(c => c.remove());
    const tinta = new Tinta(papel, { colunas: puzzle.largura, linhas: puzzle.altura });
    tinta.importar(salvos, {});

    const r = grade.getBoundingClientRect();
    const proporcao = (r.height / puzzle.altura) / (r.width / puzzle.largura);
    const porCasa = tracosPorCasa(salvos, puzzle, proporcao);
    const conta = { certa: 0, errada: 0, ilegivel: 0, vazia: 0, digitada: 0 };
    const erros = [];
    for (const casa of grade.querySelectorAll('.casa.letra')) {
      const { linha: l, coluna: c } = casa.dataset;
      const esperada = puzzle.grade[l][c];
      const chave = `${l},${c}`;
      let res = null;
      if (letras[chave]) {
        conta.digitada++;
        res = { resultado: letras[chave] === esperada ? 'certa' : 'errada', lida: letras[chave], confianca: 1, pEsperada: 0 };
      } else if (porCasa.has(chave)) {
        res = conferirCasa(modelo, porCasa.get(chave), esperada, espessura());
      }
      if (!res) { conta.vazia++; continue; }
      conta[res.resultado]++;
      if (res.resultado !== 'certa') erros.push(`${esperada}→${res.lida} (${pct(res.confianca)})`);
      marcar(casa, res);
    }
    const escritas = conta.certa + conta.errada + conta.ilegivel;
    $('resumo-cruzada').innerHTML = escritas
      ? `<b>${conta.certa} de ${escritas}</b> certas · ${conta.errada} erradas · ${conta.ilegivel} ilegíveis` +
        ` · ${conta.vazia} vazias${conta.digitada ? ` · ${conta.digitada} digitadas` : ''}`
      : 'Não há tinta de caneta salva neste aparelho para esse dia e nível.';
    $('erros-cruzada').textContent = erros.length ? `Não deram certa: ${erros.join(' · ')}` : '';
  } catch (erro) {
    console.error(erro);
    $('resumo-cruzada').textContent = `Não deu para conferir: ${erro.message}.`;
  }
});

// ---------- Início ----------

novaRodada();
mostrarAcumulado();
try {
  modelo = await carregarModelo();
  const pct1 = v => `${(v * 100).toFixed(1).replace('.', ',')}%`;
  $('modelo-info').textContent = `Modelo: ${modelo.dados} · acerta ${pct1(modelo.precisao_teste)} das letras ` +
    `do conjunto de teste sem saber qual era a esperada (a certa entre as 3 mais prováveis: ${pct1(modelo.precisao_teste_top3)}).`;
} catch (erro) {
  console.error(erro);
  $('modelo-info').textContent = `Não foi possível carregar o modelo (${erro.message}).`;
}

/** Para conferir no console: a inferência em JavaScript bate com a do treino? */
window.verificarModelo = async () => {
  const exemplos = await (await fetch('../modelo/letras-verificacao.json')).json();
  let maiorDiferenca = 0, iguais = 0;
  for (const ex of exemplos) {
    const saida = inferir(modelo, Float32Array.from(ex.imagem));
    saida.forEach((v, i) => { maiorDiferenca = Math.max(maiorDiferenca, Math.abs(v - ex.saida[i])); });
    const js = saida.indexOf(Math.max(...saida));
    const py = ex.saida.indexOf(Math.max(...ex.saida));
    if (js === py) iguais++;
  }
  return { exemplos: exemplos.length, mesmaLetra: iguais, maiorDiferenca };
};
window.conferirLetra = conferirLetra;
