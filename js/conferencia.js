// Conferência no dia: lê as casas escritas à caneta (em segundo plano, logo
// depois de cada traço) e, quando eu peço, diz quais estão erradas, quais não
// deu para ler e quantas estão vazias — sem mostrar a resposta.
//
// Só contam a caneta e as letras digitadas (modo teclado). O lápis é rascunho,
// e o que está nas casas de dica (riscar a dica resolvida) é ignorado.
// O reconhecimento em si está em js/reconhecer.js; a memória das letras já
// confirmadas neste aparelho, em js/memoria.js.

import { carregarModelo, conferirCasa, tracosPorCasa, ESPESSURA_PADRAO } from './reconhecer.js';
import { obterMemoria } from './memoria.js';

const MARCAS = ['marca-errada', 'marca-ilegivel', 'marca-vazia'];

export class Conferencia {
  /**
   * @param {object} opcoes
   *   puzzle, tinta, grade (elemento da grade com as casas)
   */
  constructor({ puzzle, tinta, grade }) {
    this.puzzle = puzzle;
    this.tinta = tinta;
    this.grade = grade;
    this.modelo = null;
    this.lidas = new Map();     // "l,c" -> { res } (res null = ainda não lida)
    this.assinaturas = new Map(); // "l,c" -> resumo dos traços e da letra (para saber o que mudou)
    this.pendentes = new Set(); // casas a ler
    this.aceitas = new Set();   // ilegíveis que eu disse que estão certas
    this.agendado = false;
    this.casas = new Map();
    for (const casa of grade.querySelectorAll('.casa.letra')) {
      this.casas.set(`${casa.dataset.linha},${casa.dataset.coluna}`, casa);
    }
  }

  /** Carrega o modelo e a memória de letras (sem pressa) e lê o que já estava escrito. */
  async preparar() {
    this.modelo = await carregarModelo();
    await this.ligarMemoria();
    this.aoMudarTinta();
  }

  async ligarMemoria() {
    if (this.memoria !== undefined) return;
    this.memoria = null;
    try {
      this.memoria = await obterMemoria(this.modelo);
    } catch (erro) {
      console.warn(erro);
      return;
    }
    this.memoria.ocupado = () => Boolean(this.tinta.gesto);
    // a memória cresceu (ou foi refeita): lê de novo as casas já lidas
    this.memoria.aoMudar = () => {
      for (const [chave, lida] of this.lidas) { lida.res = null; this.pendentes.add(chave); }
      this.agendar();
    };
  }

  /** Uma cruzada foi resolvida: as casas dela entram na memória (em segundo plano). */
  aprender() {
    this.memoria?.atualizar();
  }

  /** Proporção altura/largura de cada casa como está na tela (a letra não deforma). */
  proporcao() {
    const r = this.grade.getBoundingClientRect();
    if (!r.width || !r.height) return 1.17;
    return (r.height / this.puzzle.altura) / (r.width / this.puzzle.largura);
  }

  /** Traços de caneta de cada casa de letra, como estão agora. */
  tracosAtuais() {
    return tracosPorCasa(this.tinta.exportar(), this.puzzle, this.proporcao());
  }

  /**
   * Depois de cada mudança na tinta (traço, borracha, desfazer, letra digitada):
   * descobre quais casas mudaram, tira a marca delas e agenda a leitura.
   */
  aoMudarTinta() {
    // Proporção fixa aqui: o resumo de cada casa não pode mudar só porque a grade
    // mudou de tamanho (girar a tela, a faixa do resultado aparecer).
    const porCasa = tracosPorCasa(this.tinta.exportar(), this.puzzle, 1);
    for (const chave of this.casas.keys()) {
      const tracos = porCasa.get(chave);
      const assinatura = assinar(tracos) + '|' + this.tinta.letra(chave);
      if ((this.assinaturas.get(chave) ?? '|') === assinatura) continue; // casa não mudou
      this.assinaturas.set(chave, assinatura);
      this.desmarcar(chave);       // reescreveu: a marca da conferência anterior some
      this.aceitas.delete(chave);
      if (tracos) {
        this.lidas.set(chave, { res: null });
        this.pendentes.add(chave);
      } else {
        this.lidas.delete(chave);
        this.pendentes.delete(chave);
      }
    }
    this.agendar();
  }

  /** Lê uma casa por vez, sem atrapalhar um traço em andamento. */
  agendar() {
    if (this.agendado || !this.modelo || !this.pendentes.size) return;
    this.agendado = true;
    setTimeout(() => {
      this.agendado = false;
      if (this.tinta.gesto) { this.agendar(); return; } // escrevendo: espera
      const [chave] = this.pendentes;
      this.lerCasa(chave);
      this.agendar();
    }, this.tinta.gesto ? 120 : 0);
  }

  lerCasa(chave, porCasa = null) {
    this.pendentes.delete(chave);
    const lida = this.lidas.get(chave);
    if (!lida || !this.modelo) return;
    const tracos = (porCasa || this.tracosAtuais()).get(chave);
    if (!tracos) { this.lidas.delete(chave); return; }
    const [l, c] = chave.split(',').map(Number);
    lida.res = conferirCasa(this.modelo, tracos, this.puzzle.grade[l][c], ESPESSURA_PADRAO, this.memoria);
  }

  /**
   * Confere a grade inteira agora. Devolve
   * { certas, erradas: [...], ilegiveis: [...], vazias: [...], total }.
   */
  async conferir() {
    if (!this.modelo) this.modelo = await carregarModelo();
    await this.ligarMemoria();
    this.aoMudarTinta();
    const porCasa = this.tracosAtuais();
    for (const chave of [...this.pendentes]) this.lerCasa(chave, porCasa); // termina o que faltava

    const resultado = { certas: 0, erradas: [], ilegiveis: [], vazias: [], total: this.casas.size };
    for (const chave of this.casas.keys()) {
      const [l, c] = chave.split(',').map(Number);
      const esperada = this.puzzle.grade[l][c];
      const digitada = this.tinta.letra(chave);
      let estado;
      if (digitada) estado = digitada === esperada ? 'certa' : 'errada';
      else if (this.lidas.get(chave)?.res) estado = this.lidas.get(chave).res.resultado;
      else estado = 'vazia';
      if (estado === 'ilegivel' && this.aceitas.has(chave)) estado = 'certa';
      if (estado === 'certa') resultado.certas++;
      else if (estado === 'errada') resultado.erradas.push(chave);
      else if (estado === 'ilegivel') resultado.ilegiveis.push(chave);
      else resultado.vazias.push(chave);
    }
    return resultado;
  }

  /** As ilegíveis passam a contar como certas (o reconhecimento errou). */
  aceitar(chaves) {
    for (const chave of chaves) { this.aceitas.add(chave); this.desmarcar(chave); }
  }

  marcar({ erradas = [], ilegiveis = [], vazias = [] }) {
    this.limparMarcas();
    for (const chave of erradas) this.casas.get(chave)?.classList.add('marca-errada');
    for (const chave of ilegiveis) this.casas.get(chave)?.classList.add('marca-ilegivel');
    for (const chave of vazias) this.casas.get(chave)?.classList.add('marca-vazia');
  }

  desmarcar(chave) {
    this.casas.get(chave)?.classList.remove(...MARCAS);
  }

  limparMarcas() {
    for (const casa of this.casas.values()) casa.classList.remove(...MARCAS);
  }
}

/** Resumo dos traços de uma casa: muda quando um traço entra, sai ou é desfeito. */
function assinar(tracos) {
  if (!tracos) return '';
  return tracos.map(t => `${t.length}:${t[0][0].toFixed(3)},${t[0][1].toFixed(3)}`).join(';');
}
