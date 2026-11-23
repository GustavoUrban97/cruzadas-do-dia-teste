// Painel "Meu histórico": estatísticas no estilo do Termo, calendário dos dias
// e backup (exportar/importar a tinta e o registro como arquivo JSON).

import { dataValida, somarDias, dataCurta } from './datas.js';
import { lerTudo, gravarBackup } from './armazenamento.js';
import { NOMES_NIVEIS, nivelValido } from './niveis.js';

const $ = id => document.getElementById(id);

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const ROTULOS = {
  'acertei-tudo': 'Acertei tudo',
  'errei-algumas': 'Errei algumas',
  'nao-terminei': 'Não terminei',
  'terminei': 'Terminei (falta avaliar)',
  'jogou': 'Em andamento',
};

// ---------- Cálculo (funções puras) ----------

/**
 * Estado de cada dia jogado num nível: avaliação (automática na conferência,
 * ou manual nos dias de antes dela), se houver; senão "terminei" (marcou o antigo
 * Terminei e não avaliou) ou "jogou" (só tem tinta ou letras). Dia passado que
 * ficou só com tinta, sem resolver, conta como "nao-terminei". Dia sem nada = não jogou.
 * Cada nível tem as suas estatísticas, como no Termo.
 */
export function estadosDosDias({ tinta, registro }, nivel, hoje = null) {
  const estados = new Map();
  for (const t of tinta) {
    if (!t || t.nivel !== nivel || !dataValida(t.data)) continue;
    const letras = t.letras && typeof t.letras === 'object' ? Object.keys(t.letras).length : 0;
    if ((Array.isArray(t.tracos) && t.tracos.length) || letras) estados.set(t.data, 'jogou');
  }
  for (const r of registro) {
    if (!r || r.nivel !== nivel || !dataValida(r.data)) continue;
    if (r.avaliacao && ROTULOS[r.avaliacao]) estados.set(r.data, r.avaliacao);
    else if (r.terminei) estados.set(r.data, 'terminei');
  }
  if (hoje) for (const [data, estado] of estados) if (estado === 'jogou' && data < hoje) estados.set(data, 'nao-terminei');
  return estados;
}

/**
 * Em quantas conferências cada dia resolvido de um nível foi resolvido
 * (registro.conferencias, gravado desde o botão Conferir).
 */
export function conferenciasDosDias(registro, nivel) {
  const mapa = new Map();
  for (const r of registro) {
    if (!r || r.nivel !== nivel || !dataValida(r.data) || !r.resolvido) continue;
    const n = Number(r.conferencias);
    if (Number.isInteger(n) && n >= 1) mapa.set(r.data, n);
  }
  return mapa;
}

// Barras da distribuição, como no Termo (em quantas tentativas). A de "sem
// contagem" (dias avaliados à mão antes do Conferir) só aparece se tiver algum.
const BARRAS = [
  { chave: '1', rotulo: '1ª conferência', cor: 'acertei-tudo' },
  { chave: '2', rotulo: '2ª conferência', cor: 'errei-algumas' },
  { chave: '3', rotulo: '3ª conferência', cor: 'errei-algumas' },
  { chave: '4+', rotulo: '4ª ou mais', cor: 'errei-algumas' },
  { chave: 'sem-contagem', rotulo: 'Errei (sem contagem)', cor: 'errei-algumas', opcional: true },
  { chave: 'nao-terminei', rotulo: 'Não terminei', cor: 'nao-terminei' },
];

/** Em qual barra da distribuição o dia entra (ou null, se ainda não terminou). */
function barraDoDia(estado, n) {
  if (estado === 'acertei-tudo') return '1';
  if (estado === 'nao-terminei') return 'nao-terminei';
  if (estado !== 'errei-algumas') return null;
  if (!n || n < 2) return 'sem-contagem';
  return n >= 4 ? '4+' : String(n);
}

/** Texto do dia no calendário. */
function rotuloDoDia(estado, n) {
  if (!estado) return 'não jogou';
  if ((estado === 'acertei-tudo' || estado === 'errei-algumas') && n) return `resolvida na ${n}ª conferência`;
  return ROTULOS[estado].toLowerCase();
}

const terminou = estado =>estado === 'acertei-tudo' || estado === 'errei-algumas' || estado === 'terminei';

/** Números do painel. Só contam dias até hoje. */
export function calcularEstatisticas(estados, hoje, conferencias = new Map()) {
  const dias = [...estados.keys()].filter(d => d <= hoje).sort();
  const contagem = { 'acertei-tudo': 0, 'errei-algumas': 0, 'nao-terminei': 0 };
  const porBarra = Object.fromEntries(BARRAS.map(b => [b.chave, 0]));
  for (const d of dias) {
    const e = estados.get(d);
    if (e in contagem) contagem[e]++;
    const barra = barraDoDia(e, conferencias.get(d));
    if (barra) porBarra[barra]++;
  }
  const distribuicao = BARRAS
    .filter(b => !b.opcional || porBarra[b.chave] > 0)
    .map(b => ({ ...b, quantidade: porBarra[b.chave] }));
  const barraDeHoje = barraDoDia(estados.get(hoje), conferencias.get(hoje));
  const avaliados = contagem['acertei-tudo'] + contagem['errei-algumas'] + contagem['nao-terminei'];

  // Sequência atual: para trás a partir de hoje; hoje ainda em andamento não quebra.
  let atual = 0;
  let d = terminou(estados.get(hoje)) ? hoje : somarDias(hoje, -1);
  while (terminou(estados.get(d))) { atual++; d = somarDias(d, -1); }

  // Melhor sequência: maior trecho de dias seguidos terminados.
  let melhor = 0, trecho = 0, anterior = null;
  for (const dia of dias) {
    if (!terminou(estados.get(dia))) { trecho = 0; anterior = dia; continue; }
    trecho = anterior && somarDias(anterior, 1) === dia && trecho > 0 ? trecho + 1 : 1;
    melhor = Math.max(melhor, trecho);
    anterior = dia;
  }

  return {
    jogados: dias.length,
    porcentagem: avaliados ? Math.round((contagem['acertei-tudo'] / avaliados) * 100) : 0,
    atual,
    melhor: Math.max(melhor, atual),
    contagem,
    distribuicao,
    barraDeHoje,
  };
}

// ---------- Painel ----------

/**
 * Liga o botão do cabeçalho ao painel.
 *  - hoje():        data de hoje (AAAA-MM-DD), respeitando ?hoje= nos testes;
 *  - antesDeLer():  grava a tinta aberta, para o dia atual entrar na conta;
 *  - nivel:         nível aberto (a aba que aparece primeiro);
 *  - irPara(data, nivel): abre o puzzle daquele dia e nível;
 *  - aoImportar():  chamado depois de importar (a página para de salvar e recarrega);
 *  - temas:         { data: nome do tema } (do puzzles/index.json), marcados no calendário.
 */
export function iniciarHistorico({ hoje, nivel, antesDeLer, irPara, aoImportar, temas = {} }) {
  const painel = $('historico');
  const abas = [...document.querySelectorAll('[data-aba-nivel]')];
  let aba = nivel;       // nível mostrado no painel
  let dados = { tinta: [], registro: [] };
  let mesVisto = null;   // 'AAAA-MM'
  let estados = new Map();
  let conferencias = new Map(); // data -> em quantas conferências resolveu
  let primeiroMes = null;
  $('legenda-tema').hidden = Object.keys(temas).length === 0;

  const mostrarAba = novaAba => {
    aba = novaAba;
    abas.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.abaNivel === aba)));
    const diaDeHoje = hoje();
    estados = estadosDosDias(dados, aba, diaDeHoje);
    conferencias = conferenciasDosDias(dados.registro, aba);
    const datas = [...estados.keys()].filter(d => d <= diaDeHoje).sort();
    primeiroMes = (datas[0] || diaDeHoje).slice(0, 7);
    if (!mesVisto || mesVisto < primeiroMes) mesVisto = diaDeHoje.slice(0, 7);
    desenharEstatisticas(calcularEstatisticas(estados, diaDeHoje, conferencias));
    desenharCalendario();
  };

  const abrir = async () => {
    try { await antesDeLer(); } catch { /* segue com o que houver */ }
    $('historico-erro').textContent = '';
    try {
      dados = await lerTudo();
    } catch (erro) {
      console.error(erro);
      dados = { tinta: [], registro: [] };
      $('historico-erro').textContent = 'Não foi possível ler o histórico neste aparelho.';
    }
    mesVisto = hoje().slice(0, 7);
    mostrarAba(aba);
    if (!painel.open) painel.showModal();
  };

  abas.forEach(b => b.addEventListener('click', () => mostrarAba(b.dataset.abaNivel)));

  const desenharCalendario = () => {
    const diaDeHoje = hoje();
    const mesDeHoje = diaDeHoje.slice(0, 7);
    const [ano, mes] = mesVisto.split('-').map(Number);
    const nome = MESES[mes - 1];
    $('mes-nome').textContent = `${nome[0].toUpperCase()}${nome.slice(1)} de ${ano}`;
    $('mes-anterior').disabled = mesVisto <= primeiroMes;
    $('mes-seguinte').disabled = mesVisto >= mesDeHoje;

    const grade = $('calendario');
    grade.replaceChildren();
    for (const inicial of ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']) {
      const s = document.createElement('span');
      s.className = 'cal-semana';
      s.textContent = inicial;
      grade.append(s);
    }
    const primeiro = `${mesVisto}-01`;
    const semana = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay(); // 0 = domingo
    for (let i = 0; i < semana; i++) grade.append(document.createElement('span'));

    for (let dia = primeiro; dia.startsWith(mesVisto); dia = somarDias(dia, 1)) {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'cal-dia';
      botao.textContent = String(Number(dia.slice(8)));
      const estado = estados.get(dia);
      if (estado) botao.classList.add(`estado-${estado}`);
      if (dia === diaDeHoje) botao.classList.add('hoje');
      if (temas[dia]) botao.classList.add('com-tema');
      if (dia > diaDeHoje) {
        botao.disabled = true;
      } else {
        botao.title = `${dataCurta(dia)} (${NOMES_NIVEIS[aba]}): ${rotuloDoDia(estado, conferencias.get(dia))}${temas[dia] ? ` · tema: ${temas[dia]}` : ""}`;
        const destino = dia;
        botao.addEventListener('click', () => { painel.close(); irPara(destino, aba); });
      }
      grade.append(botao);
    }
  };

  const mudarMes = passo => {
    const [ano, mes] = mesVisto.split('-').map(Number);
    const d = new Date(Date.UTC(ano, mes - 1 + passo, 1));
    mesVisto = d.toISOString().slice(0, 7);
    desenharCalendario();
  };

  $('abrir-historico').addEventListener('click', abrir);
  $('fechar-historico').addEventListener('click', () => painel.close());
  $('mes-anterior').addEventListener('click', () => mudarMes(-1));
  $('mes-seguinte').addEventListener('click', () => mudarMes(1));
  // Tocar fora do quadro (no fundo escurecido) fecha.
  painel.addEventListener('click', e => { if (e.target === painel) painel.close(); });

  $('exportar').addEventListener('click', async () => {
    try {
      await antesDeLer();
      await exportar(hoje());
    } catch (erro) {
      console.error(erro);
      alert(`Não foi possível exportar: ${erro.message}`);
    }
  });

  const escolher = $('arquivo-backup');
  $('importar').addEventListener('click', () => escolher.click());
  escolher.addEventListener('change', async () => {
    const arquivo = escolher.files[0];
    escolher.value = '';
    if (!arquivo) return;
    try {
      const backup = lerBackup(await arquivo.text());
      const itens = [...backup.tinta, ...backup.registro];
      const puzzles = new Set(itens.map(x => `${x.data}-${x.nivel}`)).size;
      const datas = [...new Set(itens.map(x => x.data))].sort();
      if (datas.length === 0) { alert('O arquivo não tem nenhum dia salvo.'); return; }
      const ok = confirm(
        `O arquivo tem ${puzzles} puzzle(s) de ${datas.length} dia(s), de ${formatar(datas[0])} a ${formatar(datas.at(-1))}.\n\n` +
        'Esses puzzles serão substituídos neste aparelho pelo que está no arquivo; os outros continuam como estão.\n\nContinuar?');
      if (!ok) return;
      await aoImportar(() => gravarBackup(backup));
    } catch (erro) {
      console.error(erro);
      alert(`Não foi possível importar: ${erro.message}`);
    }
  });
}

function desenharEstatisticas({ jogados, porcentagem, atual, melhor, distribuicao, barraDeHoje }) {
  $('est-jogados').textContent = jogados;
  $('est-porcentagem').textContent = porcentagem;
  $('est-atual').textContent = atual;
  $('est-melhor').textContent = melhor;

  const maior = Math.max(1, ...distribuicao.map(b => b.quantidade));
  const lista = $('distribuicao');
  lista.replaceChildren();
  for (const { chave, rotulo: texto, cor, quantidade } of distribuicao) {
    const linha = document.createElement('div');
    linha.className = 'dist-linha';
    if (chave === barraDeHoje) linha.classList.add('hoje'); // o dia de hoje, como no Termo
    const rotulo = document.createElement('span');
    rotulo.className = 'dist-rotulo';
    rotulo.textContent = texto;
    const trilho = document.createElement('span');
    trilho.className = 'dist-trilho';
    const barra = document.createElement('span');
    barra.className = `dist-barra estado-${cor}`;
    barra.style.width = `${Math.max(8, (quantidade / maior) * 100)}%`;
    barra.textContent = quantidade;
    trilho.append(barra);
    linha.append(rotulo, trilho);
    lista.append(linha);
  }
}

const formatar = iso => `${dataCurta(iso)}/${iso.slice(0, 4)}`;

// ---------- Backup ----------

async function exportar(hoje) {
  const { tinta, registro } = await lerTudo();
  const conteudo = JSON.stringify({
    app: 'cruzadas-do-dia',
    formato: 3,            // 2: cada entrada tem "nivel" · 3: + letras digitadas (modo teclado)
    exportadoEm: new Date().toISOString(),
    tinta,
    registro,
  });
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `cruzadas-backup-${hoje}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Lê e confere um arquivo de backup; devolve só as entradas válidas. */
export function lerBackup(texto) {
  let dados;
  try { dados = JSON.parse(texto); } catch { throw new Error('o arquivo não é um JSON válido'); }
  if (!dados || dados.app !== 'cruzadas-do-dia' || !Array.isArray(dados.tinta) || !Array.isArray(dados.registro)) {
    throw new Error('não parece um backup do Cruzadas do Dia');
  }
  if (![1, 2, 3].includes(dados.formato)) throw new Error(`formato de backup desconhecido (${dados.formato})`);
  // Formato 1 (antes dos três níveis): tudo era o puzzle que hoje é a "Média".
  const comNivel = item => (dados.formato === 1 ? { ...item, nivel: 'media' } : item);
  const valido = item => item && typeof item === 'object' && dataValida(item.data) && nivelValido(item.nivel);
  const tinta = dados.tinta.map(comNivel).filter(t => valido(t) && Array.isArray(t.tracos));
  const registro = dados.registro.map(comNivel).filter(valido);
  return { tinta, registro };
}
