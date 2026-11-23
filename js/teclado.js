// Modo teclado: alternativa à caneta para preencher a grade.
//
// Com a ferramenta Teclado ativa, tocar numa casa (dedo, caneta ou mouse) a
// seleciona; a palavra selecionada fica destacada e a sua dica aparece na
// faixa acima do teclado. As letras vêm do teclado próprio (na tela, no estilo
// do Termo) ou do teclado físico do PC.
//
// As letras digitadas são guardadas pela Tinta (mesmo registro dos traços e
// mesma sequência de desfazer/refazer); aqui só se escolhe a casa e se mostram
// as letras. Durante o dia nada é conferido. Nos dias passados (gabarito), cada
// letra digitada é marcada como certa ou errada.

import { DIRECOES } from './grade.js';

const DICA = '#';

// direcao da dica -> sentido da palavra (h = horizontal, v = vertical)
const SENTIDO = { 'direita': 'h', 'baixo-direita': 'h', 'baixo': 'v', 'direita-baixo': 'v' };
const SETA = { 'direita': '→', 'baixo': '↓', 'baixo-direita': '↳', 'direita-baixo': '↴' };

// ⌫ apaga, ⇄ troca entre horizontal e vertical
const FILEIRAS = ['QWERTYUIOP', 'ASDFGHJKL⌫', 'ZXCVBNM⇄'];

const chaveDe = (l, c) => `${l},${c}`;

/**
 * Palavras da grade (2+ letras), cada uma com as suas casas e a sua dica.
 * Devolve { palavras, porCasa } — porCasa: "l,c" -> { h: palavra, v: palavra }.
 */
function mapearPalavras(puzzle) {
  const { grade, largura, altura, dicas } = puzzle;
  const letra = (l, c) => l >= 0 && l < altura && c >= 0 && c < largura && grade[l][c] !== DICA;

  const dicaDoInicio = new Map();
  for (const dica of dicas) {
    const { dl, dc } = DIRECOES[dica.direcao] || {};
    if (dl === undefined) continue;
    dicaDoInicio.set(`${chaveDe(dica.linha + dl, dica.coluna + dc)},${SENTIDO[dica.direcao]}`, dica);
  }

  const palavras = [];
  const porCasa = new Map();
  for (let l = 0; l < altura; l++) {
    for (let c = 0; c < largura; c++) {
      for (const [sentido, dl, dc] of [['h', 0, 1], ['v', 1, 0]]) {
        if (!letra(l, c) || letra(l - dl, c - dc)) continue; // não é início
        const casas = [];
        for (let ll = l, cc = c; letra(ll, cc); ll += dl, cc += dc) casas.push([ll, cc]);
        if (casas.length < 2) continue;
        const palavra = { casas, sentido, dica: dicaDoInicio.get(`${chaveDe(l, c)},${sentido}`) || null };
        palavras.push(palavra);
        for (const [ll, cc] of casas) {
          const chave = chaveDe(ll, cc);
          if (!porCasa.has(chave)) porCasa.set(chave, {});
          porCasa.get(chave)[sentido] = palavra;
        }
      }
    }
  }
  return { palavras, porCasa };
}

export class Teclado {
  /**
   * @param {object} opcoes
   *   grade          — elemento da grade (com as casas já desenhadas)
   *   puzzle         — o puzzle aberto
   *   tinta          — a Tinta (guarda as letras)
   *   area           — bloco da faixa da dica + teclado (mostrado só no modo teclado)
   *   faixa          — onde vai a dica atual
   *   anterior, seguinte — botões ◀ ▶ que andam de palavra em palavra
   *   teclas         — onde o teclado na tela é montado
   *   conferir       — true nos dias passados: marca letras certas e erradas
   *   aoResumo(certas, total)       — contagem das letras digitadas (para o gabarito)
   *   aoMudarVisibilidade()         — o teclado apareceu ou sumiu (a grade muda de tamanho)
   */
  constructor({ grade, puzzle, tinta, area, faixa, anterior, seguinte, teclas, conferir = false,
    aoResumo = () => {}, aoMudarVisibilidade = () => {} }) {
    this.grade = grade;
    this.puzzle = puzzle;
    this.tinta = tinta;
    this.area = area;
    this.faixa = faixa;
    this.conferir = conferir;
    this.aoResumo = aoResumo;
    this.aoMudarVisibilidade = aoMudarVisibilidade;
    this.ativo = false;
    this.sel = null; // { l, c, sentido }

    const { palavras, porCasa } = mapearPalavras(puzzle);
    // Ordem do ◀ ▶: pela casa onde cada palavra começa (linha, depois coluna;
    // a horizontal antes da vertical quando começam na mesma casa).
    this.palavras = palavras;
    this.porCasa = porCasa;
    this.casas = new Map(); // "l,c" -> elemento da casa
    for (const casa of grade.querySelectorAll('.casa')) {
      this.casas.set(chaveDe(casa.dataset.linha, casa.dataset.coluna), casa);
    }

    this.montarTeclas(teclas);
    for (const [botao, passo] of [[anterior, -1], [seguinte, 1]]) {
      botao?.addEventListener('pointerdown', e => { e.preventDefault(); this.navegar(passo); });
    }
    document.addEventListener('keydown', e => this.aoTeclaFisica(e));
    this.pintarFaixa();
  }

  // ---------- Mostrar / esconder ----------

  ativar(sim) {
    if (sim === this.ativo) return;
    this.ativo = sim;
    this.area.hidden = !sim;
    document.body.classList.toggle('modo-teclado', sim);
    this.pintarSelecao();
    this.aoMudarVisibilidade();
  }

  // ---------- Teclado na tela ----------

  montarTeclas(elemento) {
    elemento.replaceChildren();
    for (const fileira of FILEIRAS) {
      const linha = document.createElement('div');
      linha.className = 'teclado-fileira';
      for (const tecla of fileira) {
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'tecla';
        botao.textContent = tecla;
        if (tecla === '⌫') {
          botao.classList.add('tecla-larga');
          botao.setAttribute('aria-label', 'Apagar');
        } else if (tecla === '⇄') {
          botao.classList.add('tecla-larga');
          botao.setAttribute('aria-label', 'Trocar direção');
          botao.title = 'Trocar entre horizontal e vertical';
        }
        // pointerdown + preventDefault: responde na hora e não tira o foco de nada.
        botao.addEventListener('pointerdown', e => {
          e.preventDefault();
          if (tecla === '⌫') this.apagar();
          else if (tecla === '⇄') this.alternar();
          else this.digitar(tecla);
        });
        linha.append(botao);
      }
      elemento.append(linha);
    }
  }

  // ---------- Teclado físico (PC) ----------

  aoTeclaFisica(e) {
    if (!this.ativo || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return; // painel do histórico aberto
    const tecla = e.key;
    // Letras com acento ou cedilha viram a letra simples (padrão das cruzadas).
    const simples = tecla.length === 1 ? tecla.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase() : '';
    let tratou = true;
    if (/^[A-Z]$/.test(simples)) this.digitar(simples);
    else if (tecla === 'Backspace') this.apagar();
    else if (tecla === 'Delete') this.apagarAtual();
    else if (tecla === ' ') this.alternar();
    else if (tecla === 'ArrowLeft') this.mover(0, -1);
    else if (tecla === 'ArrowRight') this.mover(0, 1);
    else if (tecla === 'ArrowUp') this.mover(-1, 0);
    else if (tecla === 'ArrowDown') this.mover(1, 0);
    else tratou = false;
    if (tratou) e.preventDefault();
  }

  // ---------- Seleção ----------

  /** Toque na grade (x, y normalizados entre 0 e 1). */
  tocar(x, y) {
    const { largura, altura, grade } = this.puzzle;
    const cx = x * largura, cy = y * altura;
    const c = Math.floor(cx), l = Math.floor(cy);
    if (l < 0 || l >= altura || c < 0 || c >= largura) return;
    if (grade[l][c] !== DICA) {
      this.selecionarCasa(l, c);
      return;
    }
    // Casa de dica: seleciona a palavra da dica tocada (metade de cima ou de baixo).
    const lista = this.puzzle.dicas.filter(d => d.linha === l && d.coluna === c);
    if (!lista.length) return;
    const dica = lista.length === 2 && cy - l >= 0.5 ? lista[1] : lista[0];
    const { dl, dc } = DIRECOES[dica.direcao];
    this.sel = { l: l + dl, c: c + dc, sentido: SENTIDO[dica.direcao] };
    this.pintarSelecao();
  }

  selecionarCasa(l, c) {
    const palavras = this.porCasa.get(chaveDe(l, c)) || {};
    const mesma = this.sel && this.sel.l === l && this.sel.c === c;
    let sentido = this.sel ? this.sel.sentido : 'h';
    if (mesma) sentido = sentido === 'h' ? 'v' : 'h';  // tocar de novo troca a direção
    if (!palavras[sentido]) sentido = palavras.h ? 'h' : (palavras.v ? 'v' : sentido);
    this.sel = { l, c, sentido };
    this.pintarSelecao();
  }

  palavraAtual() {
    if (!this.sel) return null;
    return (this.porCasa.get(chaveDe(this.sel.l, this.sel.c)) || {})[this.sel.sentido] || null;
  }

  alternar() {
    if (!this.sel) return;
    const palavras = this.porCasa.get(chaveDe(this.sel.l, this.sel.c)) || {};
    const outro = this.sel.sentido === 'h' ? 'v' : 'h';
    if (palavras[outro]) {
      this.sel.sentido = outro;
      this.pintarSelecao();
    }
  }

  /** ◀ ▶: vai para a palavra anterior/seguinte, na primeira casa vazia dela. */
  navegar(passo) {
    const n = this.palavras.length;
    if (!n) return;
    const atual = this.palavras.indexOf(this.palavraAtual());
    const i = atual === -1 ? (passo > 0 ? 0 : n - 1) : (atual + passo + n) % n;
    const palavra = this.palavras[i];
    const [l, c] = palavra.casas.find(([ll, cc]) => !this.tinta.letra(chaveDe(ll, cc))) || palavra.casas[0];
    this.sel = { l, c, sentido: palavra.sentido };
    this.pintarSelecao();
  }

  /** Setas: anda até a próxima casa de letra naquela direção. */
  mover(dl, dc) {
    const { largura, altura, grade } = this.puzzle;
    if (!this.sel) return;
    const sentido = dc ? 'h' : 'v';
    let { l, c } = this.sel;
    for (l += dl, c += dc; l >= 0 && l < altura && c >= 0 && c < largura; l += dl, c += dc) {
      if (grade[l][c] !== DICA) {
        const palavras = this.porCasa.get(chaveDe(l, c)) || {};
        this.sel = { l, c, sentido: palavras[sentido] ? sentido : this.sel.sentido };
        this.pintarSelecao();
        return;
      }
    }
  }

  // ---------- Escrever ----------

  digitar(letra) {
    if (!this.sel) return;
    this.tinta.definirLetra(chaveDe(this.sel.l, this.sel.c), letra);
    // Avança para a próxima casa vazia da palavra; se não houver, para a casa seguinte.
    const palavra = this.palavraAtual();
    if (!palavra) return;
    const i = this.indiceNaPalavra(palavra);
    const resto = palavra.casas.slice(i + 1);
    const vazia = resto.find(([l, c]) => !this.tinta.letra(chaveDe(l, c)));
    const destino = vazia || resto[0];
    if (destino) {
      this.sel = { ...this.sel, l: destino[0], c: destino[1] };
      this.pintarSelecao();
    }
  }

  /** ⌫: apaga a letra da casa; se ela já estiver vazia, volta uma casa e apaga. */
  apagar() {
    if (!this.sel) return;
    const chave = chaveDe(this.sel.l, this.sel.c);
    if (this.tinta.letra(chave)) {
      this.tinta.definirLetra(chave, '');
      return;
    }
    const palavra = this.palavraAtual();
    if (!palavra) return;
    const i = this.indiceNaPalavra(palavra);
    if (i <= 0) return;
    const [l, c] = palavra.casas[i - 1];
    this.sel = { ...this.sel, l, c };
    this.tinta.definirLetra(chaveDe(l, c), '');
    this.pintarSelecao();
  }

  apagarAtual() {
    if (this.sel) this.tinta.definirLetra(chaveDe(this.sel.l, this.sel.c), '');
  }

  indiceNaPalavra(palavra) {
    return palavra.casas.findIndex(([l, c]) => l === this.sel.l && c === this.sel.c);
  }

  // ---------- Desenho ----------

  pintarSelecao() {
    for (const casa of this.grade.querySelectorAll('.sel-palavra, .sel-casa')) {
      casa.classList.remove('sel-palavra', 'sel-casa');
    }
    if (this.ativo && this.sel) {
      const palavra = this.palavraAtual();
      if (palavra) for (const [l, c] of palavra.casas) this.casas.get(chaveDe(l, c))?.classList.add('sel-palavra');
      this.casas.get(chaveDe(this.sel.l, this.sel.c))?.classList.add('sel-casa');
    }
    this.pintarFaixa();
  }

  pintarFaixa() {
    const palavra = this.palavraAtual();
    this.faixa.replaceChildren();
    if (!palavra || !palavra.dica) {
      this.faixa.classList.add('vazia');
      this.faixa.textContent = this.sel ? 'Casa sem palavra' : 'Toque numa casa para começar';
      return;
    }
    this.faixa.classList.remove('vazia');
    const seta = document.createElement('span');
    seta.className = 'dica-atual-seta';
    seta.textContent = SETA[palavra.dica.direcao];
    this.faixa.append(seta, palavra.dica.texto);
  }

  /** Mostra as letras digitadas dessas casas (chamado pela Tinta a cada mudança). */
  atualizarLetras(chaves) {
    const grade = this.puzzle.grade;
    for (const chave of chaves) {
      const casa = this.casas.get(chave);
      if (!casa || !casa.classList.contains('letra')) continue;
      const letra = this.tinta.letra(chave);
      let span = casa.querySelector('.letra-digitada');
      if (!letra) {
        span?.remove();
        casa.classList.remove('digitada', 'certa', 'errada');
        continue;
      }
      if (!span) {
        span = document.createElement('span');
        span.className = 'letra-digitada';
        span.setAttribute('aria-hidden', 'true');
        casa.append(span);
      }
      span.textContent = letra;
      casa.classList.add('digitada');
      if (this.conferir) {
        const certa = grade[casa.dataset.linha][casa.dataset.coluna] === letra;
        casa.classList.toggle('certa', certa);
        casa.classList.toggle('errada', !certa);
      }
    }
    if (this.conferir) this.resumir();
  }

  resumir() {
    let certas = 0, total = 0;
    for (const casa of this.grade.querySelectorAll('.casa.digitada')) {
      total++;
      if (casa.classList.contains('certa')) certas++;
    }
    this.aoResumo(certas, total);
  }
}
