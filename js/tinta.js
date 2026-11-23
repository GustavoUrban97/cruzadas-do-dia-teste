// Camada de tinta sobre a grade: captura da S Pen, desenho, borracha,
// desfazer/refazer. O app não reconhece a escrita; só guarda os traços.
//
// Três canvas transparentes empilhados sobre a grade:
//   base   — traços terminados (redesenhado só quando algo é apagado/desfeito)
//   traco  — o traço em andamento, desenhado aos pedacinhos (só o trecho novo)
//   extra  — círculo da borracha (e a previsão, se ligada); limpo a cada quadro
//
// Os traços são guardados em coordenadas normalizadas (0–1) relativas à grade,
// para continuarem no mesmo quadrado ao girar a tela.

export const FERRAMENTAS = {
  // largura em fração da largura da grade
  caneta: { cor: '#1a1a1a', largura: 0.0034 },
  lapis:  { cor: '#8a867e', largura: 0.0022 },
};

// Cores da caneta (tons de caneta esferográfica, não de tela). O lápis é sempre cinza.
export const CORES_CANETA = {
  preta:    '#1a1a1a',
  azul:     '#1f3d8f',
  vermelha: '#b3261e',
};

/** Estilo (cor + largura) de um traço; traços antigos sem cor saem pretos. */
function estiloDo(traco) {
  const base = FERRAMENTAS[traco.ferramenta] || FERRAMENTAS.caneta;
  if (traco.ferramenta !== 'caneta') return base;
  return { ...base, cor: CORES_CANETA[traco.cor] || CORES_CANETA.preta };
}
const RAIO_BORRACHA = 0.014; // fração da largura da grade

// Botões que transformam a caneta em borracha enquanto pressionados.
const BOTAO_BORRACHA = 32;  // ponta-borracha (buttons & 32)
const BOTAO_LATERAL = 2;    // botão lateral da S Pen / botão direito do mouse (buttons & 2)

const parametros = new URLSearchParams(location.search);

// Modo de baixa latência (desynchronized): no Tab S9 ele deixa a parte transparente
// do canvas PRETA, cobrindo a grade. Fica desligado; dá para testar com ?baixalatencia=1.
const BAIXA_LATENCIA = parametros.get('baixalatencia') === '1';

// Previsão de pontos do Chrome: desenha uns milissegundos à frente da caneta, mas o
// "traço futuro" aparece e some de um jeito perceptível. Desligada; ?previsao=1 liga.
const PREVISAO = parametros.get('previsao') === '1';

// ---------- Pincel: transforma pontos da caneta em tinta ----------
//
// O traço é desenhado como forma preenchida: a cada amostra, um círculo do raio
// daquele ponto e a "ponte" tangente até o círculo anterior. Assim a espessura
// varia suavemente, sem emendas. A curva passa pelos pontos médios (curva
// quadrática), a pressão é suavizada e o começo do traço afina levemente.
// O mesmo pincel desenha ao vivo e redesenha traços salvos, então o resultado
// é idêntico nos dois casos.

const PASSO = 1.2;            // px entre amostras da curva
const SUAVIZAR_PRESSAO = 0.3; // 0–1: quanto cada ponto novo puxa a pressão
const AFINAR_INICIO = 5;      // o começo afina ao longo de N larguras de caneta

class Pincel {
  constructor(ctx, estilo, larguraGrade) {
    this.ctx = ctx;
    this.cor = estilo.cor;
    this.base = estilo.largura * larguraGrade; // espessura média em px
    this.pts = [];        // pontos de entrada (px) com pressão suavizada
    this.ultimo = null;   // última amostra desenhada {x, y, r}
    this.percorrido = 0;  // comprimento já desenhado (para afinar o início)
    this.pressao = null;
  }

  raio(pressao) {
    const afinar = Math.min(1, this.percorrido / (AFINAR_INICIO * this.base));
    return this.base * (0.6 + 0.8 * pressao) * (0.55 + 0.45 * afinar) / 2;
  }

  adicionar({ x, y, p }) {
    this.pressao = this.pressao === null ? p : this.pressao + SUAVIZAR_PRESSAO * (p - this.pressao);
    const pt = { x, y, p: this.pressao };
    this.pts.push(pt);
    const n = this.pts.length;
    if (n === 1) {
      this.ultimo = { x, y, r: this.raio(pt.p) };
      this.circulo(this.ultimo);
    } else if (n === 2) {
      const a = this.pts[0];
      this.reta(a, meio(a, pt));
    } else {
      const z = this.pts[n - 3], a = this.pts[n - 2];
      this.curva(meio(z, a), a, meio(a, pt));
    }
  }

  terminar() {
    const n = this.pts.length;
    if (n >= 2) {
      const a = this.pts[n - 2], b = this.pts[n - 1];
      this.reta(meio(a, b), b);
    }
  }

  reta(a, b) { this.curva(a, meio(a, b), b); }

  /** Amostra a curva quadrática a→c (controle b) e preenche cada pedacinho. */
  curva(a, b, c) {
    const comprimento = Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y);
    const passos = Math.max(1, Math.ceil(comprimento / PASSO));
    for (let i = 1; i <= passos; i++) {
      const t = i / passos, u = 1 - t;
      const x = u * u * a.x + 2 * u * t * b.x + t * t * c.x;
      const y = u * u * a.y + 2 * u * t * b.y + t * t * c.y;
      const p = u * u * a.p + 2 * u * t * b.p + t * t * c.p;
      this.percorrido += Math.hypot(x - this.ultimo.x, y - this.ultimo.y);
      const amostra = { x, y, r: this.raio(p) };
      this.ponte(this.ultimo, amostra);
      this.circulo(amostra);
      this.ultimo = amostra;
    }
  }

  circulo({ x, y, r }) {
    const ctx = this.ctx;
    ctx.fillStyle = this.cor;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Quadrilátero tangente aos dois círculos (une as amostras sem emenda). */
  ponte(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d <= Math.abs(a.r - b.r) || d < 0.01) return; // um círculo contém o outro
    const ux = dx / d, uy = dy / d;
    const s = (a.r - b.r) / d, c = Math.sqrt(1 - s * s);
    // normais das duas tangentes externas
    const n1x = ux * s - uy * c, n1y = uy * s + ux * c;
    const n2x = ux * s + uy * c, n2y = uy * s - ux * c;
    const ctx = this.ctx;
    ctx.fillStyle = this.cor;
    ctx.beginPath();
    ctx.moveTo(a.x + a.r * n1x, a.y + a.r * n1y);
    ctx.lineTo(b.x + b.r * n1x, b.y + b.r * n1y);
    ctx.lineTo(b.x + b.r * n2x, b.y + b.r * n2y);
    ctx.lineTo(a.x + a.r * n2x, a.y + a.r * n2y);
    ctx.closePath();
    ctx.fill();
  }
}

const meio = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, p: (a.p + b.p) / 2 });

// ---------- Camadas ----------

function criarCamada(classe, rapida) {
  const canvas = document.createElement('canvas');
  canvas.className = `tinta ${classe}`;
  const ctx = canvas.getContext('2d', rapida && BAIXA_LATENCIA ? { desynchronized: true } : {});
  return { canvas, ctx };
}

export class Tinta {
  /**
   * @param {HTMLElement} papel  elemento que envolve a grade (recebe os eventos)
   * @param {object} opcoes
   *   aoMudar()              — fim de cada traço/apagada/desfazer/refazer (para salvar)
   *   aoMudarHistorico(podeDesfazer, podeRefazer)
   *   aoTerminarGesto()      — caneta levantada (momento com "ativação do usuário")
   *   aoTocarCasa(x, y)      — modo teclado: toque (dedo, caneta ou mouse) em x, y normalizados
   *   aoMudarLetras(chaves)  — as letras digitadas dessas casas ("linha,coluna") mudaram
   *   colunas, linhas        — tamanho da grade (para a borracha achar a casa de cada letra)
   */
  constructor(papel, {
    aoMudar = () => {}, aoMudarHistorico = () => {}, aoTerminarGesto = () => {},
    aoTocarCasa = () => {}, aoMudarLetras = () => {}, colunas = 13, linhas = 17,
  } = {}) {
    this.papel = papel;
    this.aoMudar = aoMudar;
    this.aoMudarHistorico = aoMudarHistorico;
    this.aoTerminarGesto = aoTerminarGesto;
    this.aoTocarCasa = aoTocarCasa;
    this.aoMudarLetras = aoMudarLetras;
    this.colunas = colunas;
    this.linhas = linhas;

    this.base = criarCamada('tinta-base', false);
    this.traco = criarCamada('tinta-traco', true);
    this.extra = criarCamada('tinta-extra', true);
    papel.append(this.base.canvas, this.traco.canvas, this.extra.canvas);

    this.tracos = [];        // { ferramenta, cor?, pontos: [[x, y, pressao]], caixa, apagado }
    this.letras = new Map(); // letras digitadas (modo teclado): "linha,coluna" -> "A"
    // Cada ação: { tracos: [...], apagar: bool, letras: [{ chave, antes, depois }] }.
    // Traços e letras ficam na mesma sequência de desfazer/refazer.
    this.historico = [];
    this.refazerPilha = [];
    this.toque = null;       // modo teclado: toque em andamento (vira seleção ao soltar)
    this.ferramenta = 'caneta';
    this.cor = 'preta';      // cor da caneta (chave de CORES_CANETA)
    this.gesto = null;       // gesto em andamento (um ponteiro por vez)
    this.quadroPedido = false;
    this.w = 1; this.h = 1;

    papel.addEventListener('pointerdown', e => this.aoPressionar(e));
    papel.addEventListener('pointermove', e => this.aoMover(e));
    papel.addEventListener('pointerup', e => this.aoSoltar(e));
    papel.addEventListener('pointercancel', e => this.aoSoltar(e));
    papel.addEventListener('contextmenu', e => e.preventDefault()); // botão lateral/direito

    // Tamanho: já agora, e de novo sempre que a grade mudar (girar a tela etc.).
    this.redimensionar();
    this.observador = new ResizeObserver(() => this.redimensionar());
    this.observador.observe(papel);
    window.addEventListener('resize', () => this.redimensionar());
  }

  // ---------- Tamanho ----------

  redimensionar() {
    const ret = this.papel.getBoundingClientRect();
    if (!ret.width || !ret.height) return;
    const dpr = window.devicePixelRatio || 1;
    const largura = Math.round(ret.width * dpr), altura = Math.round(ret.height * dpr);
    if (this.base.canvas.width === largura && this.base.canvas.height === altura) return; // nada mudou
    this.w = ret.width; this.h = ret.height;
    for (const { canvas, ctx } of [this.base, this.traco, this.extra]) {
      canvas.width = largura;
      canvas.height = altura;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.redesenharBase();
  }

  redesenharBase() {
    const { ctx } = this.base;
    ctx.clearRect(0, 0, this.w, this.h);
    for (const t of this.tracos) if (!t.apagado) this.tracarCompleto(ctx, t);
  }

  // ---------- Entrada ----------

  ehBorracha(e) {
    return this.ferramenta === 'borracha'
      || (e.buttons & (BOTAO_BORRACHA | BOTAO_LATERAL)) !== 0
      || e.button === 5 || e.button === 2;
  }

  pontoDe(e) {
    const ret = this.papel.getBoundingClientRect();
    let p = e.pressure;
    if (e.pointerType !== 'pen' || !p) p = 0.5; // mouse: pressão fixa
    return { x: e.clientX - ret.left, y: e.clientY - ret.top, p };
  }

  aoPressionar(e) {
    // Modo teclado: tocar (com qualquer coisa) seleciona a casa, sem desenhar.
    // A ponta-borracha e o botão lateral continuam apagando.
    if (this.ferramenta === 'teclado' && !this.gesto && !this.ehBorracha(e)) {
      e.preventDefault();
      this.toque = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, longe: false }; // vale o último toque
      return;
    }
    if (e.pointerType === 'touch') return;      // dedo/palma nunca desenha
    if (this.gesto) return;                      // já tem um traço em andamento
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    this.redimensionar();                        // garantia: camada do tamanho da grade
    try { this.papel.setPointerCapture(e.pointerId); } catch { /* segue sem captura */ }
    this.gesto = { pointerId: e.pointerId, modo: null, pendentes: [], previstos: [] };
    this.iniciarModo(this.ehBorracha(e) ? 'apagar' : 'desenhar');
    this.gesto.pendentes.push(this.pontoDe(e));
    this.pedirQuadro();
  }

  aoMover(e) {
    const toque = this.toque;
    if (toque && e.pointerId === toque.pointerId
        && Math.hypot(e.clientX - toque.x, e.clientY - toque.y) > 12) toque.longe = true; // arrastou: não é toque
    const g = this.gesto;
    if (!g || e.pointerId !== g.pointerId) return;
    // Apertou/soltou o botão lateral no meio do gesto: troca de modo.
    const modo = this.ehBorracha(e) ? 'apagar' : 'desenhar';
    if (modo !== g.modo) {
      this.processarPendentes();
      this.encerrarModo();
      this.iniciarModo(modo);
    }
    const eventos = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of (eventos.length ? eventos : [e])) g.pendentes.push(this.pontoDe(ev));
    if (PREVISAO && e.getPredictedEvents) g.previstos = e.getPredictedEvents().map(ev => this.pontoDe(ev));
    this.pedirQuadro();
  }

  aoSoltar(e) {
    const toque = this.toque;
    if (toque && e.pointerId === toque.pointerId) {
      this.toque = null;
      if (e.type === 'pointerup' && !toque.longe) {
        const ret = this.papel.getBoundingClientRect();
        this.aoTocarCasa((e.clientX - ret.left) / ret.width, (e.clientY - ret.top) / ret.height);
      }
      return;
    }
    const g = this.gesto;
    if (!g || e.pointerId !== g.pointerId) return;
    this.processarPendentes();
    this.encerrarModo();
    this.extra.ctx.clearRect(0, 0, this.w, this.h);
    this.gesto = null;
    this.aoTerminarGesto();
  }

  // ---------- Modos (desenhar / apagar) ----------

  iniciarModo(modo) {
    const g = this.gesto;
    g.modo = modo;
    if (modo === 'desenhar') {
      const ferramenta = this.ferramenta === 'borracha' ? 'caneta' : this.ferramenta;
      g.traco = { ferramenta, pontos: [], caixa: null, apagado: false };
      if (ferramenta === 'caneta') g.traco.cor = this.cor;
      g.pincel = new Pincel(this.traco.ctx, estiloDo(g.traco), this.w);
    } else {
      g.apagados = new Set();
      g.letrasApagadas = [];
      g.ultimo = null;
    }
  }

  encerrarModo() {
    const g = this.gesto;
    if (g.modo === 'desenhar') {
      const t = g.traco;
      this.traco.ctx.clearRect(0, 0, this.w, this.h);
      if (t.pontos.length) {
        t.caixa = caixaDe(t.pontos);
        this.tracos.push(t);
        this.tracarCompleto(this.base.ctx, t);
        this.registrar({ tracos: [t], apagar: false, letras: [] });
      }
    } else if (g.apagados.size || g.letrasApagadas.length) {
      this.registrar({ tracos: [...g.apagados], apagar: true, letras: g.letrasApagadas });
    }
  }

  registrar(acao) {
    this.historico.push(acao);
    this.refazerPilha = [];
    this.notificar();
  }

  notificar() {
    this.aoMudarHistorico(this.historico.length > 0, this.refazerPilha.length > 0);
    this.aoMudar();
  }

  // ---------- Quadro a quadro ----------

  pedirQuadro() {
    if (this.quadroPedido) return;
    this.quadroPedido = true;
    requestAnimationFrame(() => {
      this.quadroPedido = false;
      if (!this.gesto) return;
      this.processarPendentes();
      this.desenharExtra();
    });
  }

  processarPendentes() {
    const g = this.gesto;
    if (!g || !g.pendentes.length) return;
    const pontos = g.pendentes;
    g.pendentes = [];
    if (g.modo === 'desenhar') {
      for (const pt of pontos) {
        g.traco.pontos.push([round4(pt.x / this.w), round4(pt.y / this.h), round3(pt.p)]);
        g.pincel.adicionar(pt); // só o trecho novo
      }
    } else {
      let mudou = false;
      for (const pt of pontos) {
        if (this.apagarEm(g.ultimo || pt, pt, g.apagados)) mudou = true;
        this.apagarLetraEm(pt, g.letrasApagadas);
        g.ultimo = pt;
      }
      if (mudou) this.redesenharBase();
    }
  }

  desenharExtra() {
    const g = this.gesto;
    const ctx = this.extra.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    if (g.modo === 'desenhar') {
      if (!PREVISAO || !g.previstos.length || !g.pincel.ultimo) return;
      const ult = g.pincel.ultimo;
      ctx.strokeStyle = g.pincel.cor;
      ctx.lineWidth = ult.r * 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ult.x, ult.y);
      for (const pt of g.previstos) ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
    } else if (g.ultimo) {
      ctx.strokeStyle = 'rgba(90, 86, 80, 0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(g.ultimo.x, g.ultimo.y, RAIO_BORRACHA * this.w, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** Desenha um traço inteiro com o mesmo pincel do desenho ao vivo. */
  tracarCompleto(ctx, t) {
    const pincel = new Pincel(ctx, estiloDo(t), this.w);
    for (const [x, y, p] of t.pontos) pincel.adicionar({ x: x * this.w, y: y * this.h, p });
    pincel.terminar();
  }

  // ---------- Borracha (apaga o traço inteiro tocado) ----------

  apagarEm(de, ate, apagados) {
    const r = RAIO_BORRACHA * this.w;
    let mudou = false;
    // amostra o caminho da borracha a cada meio raio, para não pular traços finos
    const passos = Math.max(1, Math.ceil(Math.hypot(ate.x - de.x, ate.y - de.y) / (r / 2)));
    for (const t of this.tracos) {
      if (t.apagado) continue;
      const [x0, y0, x1, y1] = t.caixa;
      for (let k = 0; k <= passos; k++) {
        const x = de.x + (ate.x - de.x) * k / passos;
        const y = de.y + (ate.y - de.y) * k / passos;
        if (x < x0 * this.w - r || x > x1 * this.w + r || y < y0 * this.h - r || y > y1 * this.h + r) continue;
        if (this.tocaTraco(t, x, y, r)) {
          t.apagado = true;
          apagados.add(t);
          mudou = true;
          break;
        }
      }
    }
    return mudou;
  }

  /** A borracha passando perto do meio de uma casa apaga a letra digitada dela. */
  apagarLetraEm(pt, apagadas) {
    if (!this.letras.size) return;
    const cx = pt.x / this.w * this.colunas, cy = pt.y / this.h * this.linhas;
    const c = Math.floor(cx), l = Math.floor(cy);
    if (Math.abs(cx - c - 0.5) > 0.32 || Math.abs(cy - l - 0.5) > 0.32) return; // longe da letra
    const chave = `${l},${c}`;
    const antes = this.letras.get(chave);
    if (!antes) return;
    this.letras.delete(chave);
    apagadas.push({ chave, antes, depois: null });
    this.aoMudarLetras([chave]);
  }

  tocaTraco(t, x, y, r) {
    const pts = t.pontos;
    if (pts.length === 1) return Math.hypot(pts[0][0] * this.w - x, pts[0][1] * this.h - y) <= r;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0] * this.w, ay = pts[i - 1][1] * this.h;
      const bx = pts[i][0] * this.w, by = pts[i][1] * this.h;
      if (distSegmento(x, y, ax, ay, bx, by) <= r) return true;
    }
    return false;
  }

  // ---------- Ferramentas, desfazer, refazer ----------

  usar(ferramenta) {
    if (ferramenta in FERRAMENTAS || ferramenta === 'borracha' || ferramenta === 'teclado') this.ferramenta = ferramenta;
    this.toque = null;
  }

  // ---------- Letras digitadas (modo teclado) ----------

  letra(chave) { return this.letras.get(chave) || ''; }

  /** Põe (ou apaga, com letra vazia) a letra de uma casa; entra no desfazer. */
  definirLetra(chave, letra) {
    const antes = this.letras.get(chave) || null;
    const depois = letra || null;
    if (antes === depois) return;
    this.aplicarLetra(chave, depois);
    this.aoMudarLetras([chave]);
    this.registrar({ tracos: [], apagar: false, letras: [{ chave, antes, depois }] });
  }

  aplicarLetra(chave, letra) {
    if (letra) this.letras.set(chave, letra); else this.letras.delete(chave);
  }

  /** Volta (ou refaz) as letras de uma ação e avisa quem mostra as letras. */
  aplicarLetras(acao, desfazendo) {
    if (!acao.letras || !acao.letras.length) return;
    const lista = desfazendo ? [...acao.letras].reverse() : acao.letras;
    for (const m of lista) this.aplicarLetra(m.chave, desfazendo ? m.antes : m.depois);
    this.aoMudarLetras(acao.letras.map(m => m.chave));
  }

  usarCor(cor) {
    if (cor in CORES_CANETA) this.cor = cor;
  }

  desfazer() {
    if (this.gesto) return;
    const acao = this.historico.pop();
    if (!acao) return;
    for (const t of acao.tracos) t.apagado = !acao.apagar;
    this.aplicarLetras(acao, true);
    this.refazerPilha.push(acao);
    this.redesenharBase();
    this.notificar();
  }

  refazer() {
    if (this.gesto) return;
    const acao = this.refazerPilha.pop();
    if (!acao) return;
    for (const t of acao.tracos) t.apagado = acao.apagar;
    this.aplicarLetras(acao, false);
    this.historico.push(acao);
    this.redesenharBase();
    this.notificar();
  }

  // ---------- Salvar / carregar ----------

  /** Traços visíveis, prontos para salvar. */
  exportar() {
    return this.tracos.filter(t => !t.apagado)
      .map(({ ferramenta, cor, pontos }) => (cor ? { ferramenta, cor, pontos } : { ferramenta, pontos }));
  }

  /** Letras digitadas, prontas para salvar: {"linha,coluna": "A"}. */
  exportarLetras() {
    return Object.fromEntries(this.letras);
  }

  /** Substitui a tinta pelos traços e letras salvos (o histórico de desfazer começa do zero). */
  importar(tracos, letras = {}) {
    this.letras = new Map(Object.entries(letras || {})
      .filter(([chave, letra]) => /^\d+,\d+$/.test(chave) && /^[A-Z]$/.test(letra)));
    this.aoMudarLetras([...this.letras.keys()]);
    this.tracos = (tracos || [])
      .filter(t => t && Array.isArray(t.pontos) && t.pontos.length)
      .map(t => {
        const ferramenta = t.ferramenta in FERRAMENTAS ? t.ferramenta : 'caneta';
        const traco = { ferramenta, pontos: t.pontos, caixa: caixaDe(t.pontos), apagado: false };
        if (ferramenta === 'caneta' && t.cor in CORES_CANETA) traco.cor = t.cor;
        return traco;
      });
    this.historico = [];
    this.refazerPilha = [];
    this.aoMudarHistorico(false, false);
    this.redesenharBase();
  }
}

// ---------- utilitários ----------

function caixaDe(pontos) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pontos) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

function distSegmento(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const round3 = v => Math.round(v * 1000) / 1000;
const round4 = v => Math.round(v * 10000) / 10000;
