// Memória de letras: o reconhecimento aprende a letra de quem joga, neste aparelho.
//
// Numa cruzada resolvida, toda casa escrita estava certa (inclusive as que o
// reconhecimento não leu e eu disse que estavam certas). Essas casas viram
// exemplos confirmados. Na leitura de uma casa nova, a rede é misturada com os
// exemplos mais parecidos. Assim um A de topo redondo, raro nos dados do treino,
// passa a ser lido depois de alguns dias.
//
// Nada sai do aparelho. O que fica guardado (loja "memoria" do IndexedDB) é o
// resumo de cada letra (a penúltima camada da rede), por cruzada. Ele sai da
// tinta e do registro: se o modelo mudar, a tinta de um dia resolvido for editada
// ou um backup entrar, é refeito sozinho, sem pressa, em segundo plano.
// Testado com a tinta de 13 cruzadas (2.107 casas): a rede sozinha deixava 21
// ilegíveis; com a memória, 9. Letra errada marcada como errada: 87% → 94%.

import { inferirComResumo, rasterizar, tracosPorCasa } from './reconhecer.js';
import { lerTudo, lerMemoria, gravarMemoria, apagarMemoria } from './armazenamento.js';

const RECENTES = 30;    // cruzadas resolvidas mais recentes que entram na memória
const POR_LETRA = 80;   // exemplos guardados por letra (os mais recentes)
const MINIMO = 26;      // com menos exemplos que isso, vale só a rede
const K = 10;           // exemplos mais parecidos que votam
const TAU = 0.05;       // quanto o mais parecido pesa mais que os outros
const PESO = 1;         // peso da memória em relação à rede
const PROPORCAO = 1.17; // altura/largura da casa (retrato no tablet)
const PASTA_PUZZLES = new URL('../puzzles/', import.meta.url);

const chave = item => `${item.data}|${item.nivel}`;
const esperar = ms => new Promise(r => setTimeout(r, ms));

function normalizar(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, x => x / n);
}

function produto(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

class MemoriaDeLetras {
  constructor(modelo) {
    this.modelo = modelo;
    this.exemplos = [];          // { i (índice da letra), resumo (normalizado) }
    this.ocupado = () => false;  // escrevendo agora? (a atualização espera)
    this.aoMudar = null;         // chamado quando a memória muda (reler as casas)
    this.rodando = null;
    this.deNovo = false;
  }

  /** Probabilidades da rede -> misturadas com o voto dos exemplos mais parecidos. */
  ajustar(probs, resumo) {
    if (this.exemplos.length < MINIMO) return probs;
    const r = normalizar(resumo);
    const melhores = []; // [semelhança, letra], do menor para o maior
    for (const ex of this.exemplos) {
      const s = produto(ex.resumo, r);
      if (melhores.length === K && s <= melhores[0][0]) continue;
      if (melhores.length === K) melhores.shift();
      let j = 0;
      while (j < melhores.length && melhores[j][0] < s) j++;
      melhores.splice(j, 0, [s, ex.i]);
    }
    const voto = new Array(probs.length).fill(0);
    let soma = 0;
    for (const [s, i] of melhores) { const w = Math.exp((s - 1) / TAU); voto[i] += w; soma += w; }
    if (!soma) return probs;
    return probs.map((v, i) => (v + PESO * voto[i] / soma) / (1 + PESO));
  }

  /** Monta a lista de exemplos com as entradas guardadas (deste modelo), as mais recentes primeiro. */
  montar(itens) {
    const deste = itens.filter(m => m.modelo === this.modelo.assinatura)
      .sort((a, b) => chave(b).localeCompare(chave(a)));
    const porLetra = {};
    const exemplos = [];
    for (const item of deste) {
      for (const { letra, resumo } of item.exemplos) {
        const i = this.modelo.classes.indexOf(letra);
        if (i < 0 || (porLetra[i] = (porLetra[i] || 0) + 1) > POR_LETRA) continue;
        exemplos.push({ i, resumo });
      }
    }
    this.exemplos = exemplos;
  }

  /** Confere se a memória está em dia com as cruzadas resolvidas (em segundo plano). */
  atualizar() {
    if (this.rodando) { this.deNovo = true; return this.rodando; }
    this.rodando = this.refazer()
      .catch(erro => console.warn('memória de letras:', erro))
      .finally(() => {
        this.rodando = null;
        if (this.deNovo) { this.deNovo = false; this.atualizar(); }
      });
    return this.rodando;
  }

  async refazer() {
    const { tinta, registro } = await lerTudo();
    const registros = new Map(registro.map(r => [chave(r), r]));
    const resolvidas = tinta
      .filter(t => t.tracos?.length && registros.get(chave(t))?.resolvido)
      .sort((a, b) => chave(b).localeCompare(chave(a)))
      .slice(0, RECENTES);
    const guardadas = new Map((await lerMemoria()).map(m => [chave(m), m]));

    // as que saíram das mais recentes (ou deixaram de estar resolvidas) saem da memória
    const ficam = new Set(resolvidas.map(chave));
    const sair = [...guardadas.values()].filter(m => !ficam.has(chave(m)));
    let mudou = sair.length > 0;
    if (sair.length) {
      await apagarMemoria(sair.map(m => [m.data, m.nivel]));
      sair.forEach(m => guardadas.delete(chave(m)));
    }

    for (const t of resolvidas) {
      const g = guardadas.get(chave(t));
      if (g && g.modelo === this.modelo.assinatura && g.tinta === t.atualizado) continue; // em dia
      const reg = registros.get(chave(t));
      const arquivo = typeof reg.puzzle === 'string' ? reg.puzzle : `${t.data}-${t.nivel}`;
      let puzzle;
      try {
        const resposta = await fetch(new URL(`${arquivo}.json`, PASTA_PUZZLES));
        if (!resposta.ok) continue;
        puzzle = await resposta.json();
      } catch { continue; } // sem rede e fora do cache: fica para depois
      const exemplos = [];
      for (const [casa, tracos] of tracosPorCasa(t.tracos, puzzle, PROPORCAO)) {
        // uma casa por vez, sem atrapalhar um traço em andamento
        do await esperar(this.ocupado() ? 300 : 4); while (this.ocupado());
        const imagem = rasterizar(tracos);
        if (!imagem) continue;
        const [l, c] = casa.split(',').map(Number);
        const { resumo } = inferirComResumo(this.modelo, imagem);
        exemplos.push({ letra: puzzle.grade[l][c], resumo: normalizar(resumo) });
      }
      const item = { data: t.data, nivel: t.nivel, modelo: this.modelo.assinatura, tinta: t.atualizado, exemplos };
      await gravarMemoria(item);
      guardadas.set(chave(item), item);
      mudou = true;
    }

    if (mudou) {
      this.montar([...guardadas.values()]);
      this.aoMudar?.();
    }
  }
}

let memoriaPromessa = null;

/**
 * A memória de letras deste aparelho (uma só, para o modelo carregado): lê o que
 * está guardado e, em segundo plano, põe em dia com as cruzadas resolvidas.
 */
export function obterMemoria(modelo) {
  if (!memoriaPromessa) {
    memoriaPromessa = (async () => {
      const memoria = new MemoriaDeLetras(modelo);
      try {
        memoria.montar(await lerMemoria());
      } catch (erro) {
        console.warn('memória de letras:', erro); // sem IndexedDB: vale só a rede
        return memoria;
      }
      setTimeout(() => memoria.atualizar(), 3000);
      return memoria;
    })();
  }
  return memoriaPromessa;
}
