// Esqueleto (posição das casas de dica) e preenchimento da grade 13×17.
// Regra de ouro da cruzada direta: toda palavra (2+ letras) tem uma casa de
// dica com seta para o seu início; toda casa de dica tem ao menos uma dica.

export const L = 13, A = 17;
// Quanto a folga nas cruzadas pesa contra a preferência da lista ao escolher a palavra.
export let PESO_FOLGA = 3;
export const pesoFolga = v => { PESO_FOLGA = v; };
// Quanto uma palavra-tema (dia com tema) passa na frente das outras candidatas.
const BONUS_TEMA = 40;

/** Gerador pseudoaleatório com semente (mulberry32): mesma semente, mesmo puzzle. */
export function rng(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sequências de letras da grade (g[r][c] === true é casa de dica). */
export function sequencias(g) {
  const out = [];
  for (const [dl, dc] of [[0, 1], [1, 0]]) {
    for (let r = 0; r < A; r++) for (let c = 0; c < L; c++) {
      if (g[r][c]) continue;
      const pr = r - dl, pc = c - dc;
      if (pr >= 0 && pc >= 0 && !g[pr][pc]) continue; // não é início
      const casas = [];
      let rr = r, cc = c;
      while (rr < A && cc < L && !g[rr][cc]) { casas.push([rr, cc]); rr += dl; cc += dc; }
      out.push({ dir: dc ? 'H' : 'V', casas });
    }
  }
  return out;
}

/**
 * Atribui as dicas: primeiro as retas (direita / baixo), depois as com curva
 * (direita-baixo / baixo-direita) só para palavras que ficaram sem dica.
 * Máximo de 2 dicas por casa.
 */
export function atribuirDicas(g) {
  const letra = (r, c) => r >= 0 && r < A && c >= 0 && c < L && !g[r][c];
  const inicios = new Set();
  for (const s of sequencias(g)) {
    if (s.casas.length < 2) continue;
    const [r, c] = s.casas[0];
    inicios.add(`${r},${c},${s.dir}`);
  }
  const cobertas = new Set();
  const dicas = [];
  const porCasa = {};
  const usar = (r, c, direcao, chave) => {
    if (cobertas.has(chave) || !inicios.has(chave) || (porCasa[r + ',' + c] || 0) >= 2) return;
    cobertas.add(chave);
    porCasa[r + ',' + c] = (porCasa[r + ',' + c] || 0) + 1;
    dicas.push({ linha: r, coluna: c, direcao, chave });
  };
  for (let r = 0; r < A; r++) for (let c = 0; c < L; c++) {
    if (!g[r][c]) continue;
    if (letra(r, c + 1)) usar(r, c, 'direita', `${r},${c + 1},H`);
    if (letra(r + 1, c)) usar(r, c, 'baixo', `${r + 1},${c},V`);
  }
  for (let r = 0; r < A; r++) for (let c = 0; c < L; c++) {
    if (!g[r][c]) continue;
    if (letra(r, c + 1)) usar(r, c, 'direita-baixo', `${r},${c + 1},V`);
    if (letra(r + 1, c)) usar(r, c, 'baixo-direita', `${r + 1},${c},H`);
  }
  let semDica = 0;
  for (const k of inicios) if (!cobertas.has(k)) semDica++;
  let dicasVazias = 0;
  for (let r = 0; r < A; r++) for (let c = 0; c < L; c++) if (g[r][c] && !porCasa[r + ',' + c]) dicasVazias++;
  return { dicas, semDica, dicasVazias };
}

/** "Feiura" do esqueleto; 0 = pronto. */
function custo(g, perfil) {
  let s = 0, duas = 0, tres = 0, quatro = 0;
  const contagem = Array.from({ length: A }, () => Array(L).fill(0)); // em quantas palavras cada letra está
  for (const seq of sequencias(g)) {
    const n = seq.casas.length;
    if (n > perfil.maxLetras) s += (n - perfil.maxLetras) * 2;
    if (n === 2) duas++;
    if (n === 3) tres++;
    if (n === 4) quatro++;
    if (n >= 2) for (const [r, c] of seq.casas) contagem[r][c]++;
  }
  if (duas > perfil.maxDuas) s += duas - perfil.maxDuas;
  if (tres > (perfil.maxTres ?? Infinity)) s += tres - perfil.maxTres;
  if (quatro > (perfil.maxQuatro ?? Infinity)) s += (quatro - perfil.maxQuatro) * 0.5;
  let dicas = 0, simples = 0;
  for (let r = 0; r < A; r++) for (let c = 0; c < L; c++) {
    if (!g[r][c]) {
      if (contagem[r][c] === 0) s += 4;                          // letra sem palavra
      else if (contagem[r][c] === 1 && r > 0 && c > 0) simples++; // miolo: letra de uma palavra só
      continue;
    }
    dicas++;
    if (r >= 1 && c >= 1) { // evita blocos de casas de dica no miolo
      if (c + 2 < L && g[r][c + 1] && g[r][c + 2]) s += 2;
      if (r + 2 < A && g[r + 1][c] && g[r + 2][c]) s += 2;
      if (c + 1 < L && r + 1 < A && g[r][c + 1] && g[r + 1][c] && g[r + 1][c + 1]) s += 2;
    }
  }
  if (dicas > perfil.alvoDicas) s += (dicas - perfil.alvoDicas) * 0.5;
  if (simples > perfil.simples) s += (simples - perfil.simples) * 0.6;
  const { semDica, dicasVazias } = atribuirDicas(g);
  return s + semDica * 3 + dicasVazias * 2;
}

/**
 * Sorteia um esqueleto: bordas e miolo aleatórios, ajustados por recozimento
 * simulado até o custo zerar. Devolve null se não convergir.
 */
export function gerarEsqueleto(rand, perfil, passos = 40000, inicial = null, travadas = null, temp0 = 2) {
  const g = inicial ? inicial.map(l => l.slice()) : Array.from({ length: A }, (_, r) => Array.from({ length: L }, (_, c) =>
    (r === 0 && c === 0) || ((r === 0 || c === 0) && rand() < 0.55) || (r > 0 && c > 0 && rand() < perfil.densidade)));
  const todas = [];
  for (let r = 0; r < A; r++) for (let c = 0; c < L; c++) if ((r || c) && !(travadas && travadas.has(r * L + c))) todas.push([r, c]);
  const bordas = todas.filter(([r, c]) => r === 0 || c === 0);
  let atual = custo(g, perfil);
  let temp = temp0;
  for (let p = 0; p < passos && atual > 0; p++) {
    const fonte = rand() < 0.15 ? bordas : todas;
    const [r, c] = fonte[Math.floor(rand() * fonte.length)];
    g[r][c] = !g[r][c];
    const novo = custo(g, perfil);
    if (novo <= atual || rand() < Math.exp((atual - novo) / temp)) atual = novo;
    else g[r][c] = !g[r][c];
    temp = Math.max(0.05, temp * 0.9998);
  }
  return atual === 0 ? g : null;
}

/**
 * Preenche o esqueleto com palavras da lista (busca com retrocesso; escolhe
 * sempre a vaga com menos opções). A lista vem em ordem de preferência.
 */
export function preencher(g, palavras, rand, limiteNos = 80000, inicial = null, preferidas = null) {
  const vagas = sequencias(g).filter(s => s.casas.length >= 2);
  const ind = indexar(palavras);
  // inicial: letras já fixas (conserto local); vagas completas não mudam
  const atual = inicial ? inicial.map(l => l.slice()) : Array.from({ length: A }, () => Array(L).fill(''));
  const atribuida = new Array(vagas.length).fill(-1);
  let fixas = 0;
  vagas.forEach((v, i) => {
    const p = v.casas.map(([r, c]) => atual[r][c]).join('');
    if (p.length === v.casas.length) { atribuida[i] = -2; ind.bloquear(p, +1); fixas++; }
  });

  /** Bitset das palavras que cabem na vaga (tamanho certo, letras já postas, ainda livres). */
  const mascara = i => {
    const casas = vagas[i].casas, t = ind.porTamanho[casas.length];
    if (!t) return null;
    const m = t.livres.slice();
    for (let k = 0; k < casas.length; k++) {
      const ch = atual[casas[k][0]][casas[k][1]];
      if (!ch) continue;
      const b = t.bits[k][ch.charCodeAt(0) - 65];
      for (let x = 0; x < m.length; x++) m[x] &= b[x];
    }
    return m;
  };

  // cruzada[i][casa] = a outra vaga que passa por aquela casa da vaga i
  const daCasa = {};
  vagas.forEach((v, i) => v.casas.forEach(([r, c]) => (daCasa[r * L + c] ||= []).push(i)));
  const cruzada = vagas.map((v, i) => {
    const m = {};
    v.casas.forEach(([r, c]) => { const o = daCasa[r * L + c].find(j => j !== i); if (o !== undefined) m[r * L + c] = o; });
    return m;
  });

  // falhas[i]: quantas vezes a vaga i ficou sem opção (onde a grade trava)
  const falhas = new Array(vagas.length).fill(0);
  let nos = 0, menor = Infinity;
  const buscar = restantes => {
    if (restantes < menor) menor = restantes;
    if (restantes === 0) return true;
    if (++nos > limiteNos) return false;
    // a vaga com menos opções primeiro (se alguma ficou sem opção, volta)
    let melhor = -1, menos = Infinity, mMelhor = null;
    for (let i = 0; i < vagas.length; i++) {
      if (atribuida[i] !== -1) continue;
      const m = mascara(i);
      const n = m ? contar(m) : 0;
      if (n < menos) { menos = n; melhor = i; mMelhor = m; if (n === 0) { falhas[i]++; return false; } }
    }
    // Candidatas: as primeiras da lista têm preferência (com um pouco de sorte),
    // mas cada uma é testada antes — as que deixam uma vaga cruzada sem opção
    // saem, e as que deixam mais opções nas cruzadas sobem na fila.
    const t = ind.porTamanho[vagas[melhor].casas.length];
    const casas = vagas[melhor].casas;
    const avaliadas = [];
    bitsLigados(mMelhor, 60).forEach((j, k) => {
      const id = t.ids[j], p = palavras[id];
      const novas = [];
      casas.forEach(([r, c], q) => { if (!atual[r][c]) { atual[r][c] = p[q]; novas.push([r, c]); } });
      ind.bloquear(p, +1);
      let folga = 0;
      for (const [r, c] of novas) {
        const j2 = cruzada[melhor][r * L + c];
        if (j2 === undefined || atribuida[j2] !== -1) continue;
        const n = contar(mascara(j2));
        if (n === 0) { folga = -1; break; }
        folga += Math.log(n + 1);
      }
      ind.bloquear(p, -1);
      for (const [r, c] of novas) atual[r][c] = '';
      // dia com tema: palavra-tema que cabe passa na frente (se não travar as cruzadas)
      if (folga >= 0) avaliadas.push([id, k * (0.3 + rand()) - PESO_FOLGA * folga - (preferidas && preferidas.has(p) ? BONUS_TEMA : 0)]);
    });
    if (!avaliadas.length) falhas[melhor]++;
    const ordem = avaliadas.sort((a, b) => a[1] - b[1]).map(x => x[0]).slice(0, 12);
    for (const id of ordem) {
      const p = palavras[id];
      const novas = [];
      casas.forEach(([r, c], k) => { if (!atual[r][c]) { atual[r][c] = p[k]; novas.push([r, c]); } });
      ind.bloquear(p, +1); atribuida[melhor] = id;
      if (buscar(restantes - 1)) return true;
      ind.bloquear(p, -1); atribuida[melhor] = -1;
      for (const [r, c] of novas) atual[r][c] = '';
      if (nos > limiteNos) return false;
    }
    return false;
  };
  const ok = buscar(vagas.length - fixas);
  return { ok, nos, menor, total: vagas.length - fixas, letras: atual, falhas: vagas.map((v, i) => ({ casas: v.casas, n: falhas[i] })) };
}

/**
 * Formas da mesma palavra que não podem aparecer juntas na grade: a própria,
 * plural/singular, -M/-R/-AM/-RAM (ERA/ERAM, ORA/ORAR) e masculino/feminino.
 */
export function variantes(w) {
  const v = new Set([w]);
  const por = x => x.length >= 2 && v.add(x);
  for (const suf of ['S', 'ES', 'M', 'R', 'AM', 'RAM']) {
    por(w + suf);
    if (w.endsWith(suf)) por(w.slice(0, -suf.length));
  }
  if (w.length >= 4 && /[OA]$/.test(w)) por(w.slice(0, -1) + (w.endsWith('O') ? 'A' : 'O'));
  if (w.length >= 5 && /[OA]S$/.test(w)) por(w.slice(0, -2) + (w.at(-2) === 'O' ? 'A' : 'O') + 'S');
  return v;
}

/**
 * Índice das palavras para o preenchimento: por tamanho, um bitset por
 * (posição, letra) — "palavras de 6 letras com A na 2ª" vira um E de bits, sem
 * percorrer a lista. "livres" tira as já usadas e as variantes delas.
 */
function indexar(palavras) {
  const porTamanho = {}, onde = new Map();
  palavras.forEach((p, i) => {
    const t = (porTamanho[p.length] ||= { ids: [] });
    onde.set(p, [t, t.ids.length]);
    t.ids.push(i);
  });
  for (const [n, t] of Object.entries(porTamanho)) {
    const w = Math.ceil(t.ids.length / 32);
    t.bits = Array.from({ length: +n }, () => Array.from({ length: 26 }, () => new Uint32Array(w)));
    t.livres = new Uint32Array(w);
    t.bloqueio = new Uint8Array(t.ids.length);
    t.ids.forEach((id, j) => {
      const p = palavras[id];
      for (let k = 0; k < p.length; k++) t.bits[k][p.charCodeAt(k) - 65][j >> 5] |= 1 << (j & 31);
      t.livres[j >> 5] |= 1 << (j & 31);
    });
  }
  const bloquear = (p, delta) => {
    for (const x of variantes(p)) {
      const pos = onde.get(x);
      if (!pos) continue;
      const [t, j] = pos;
      t.bloqueio[j] += delta;
      if (t.bloqueio[j]) t.livres[j >> 5] &= ~(1 << (j & 31));
      else t.livres[j >> 5] |= 1 << (j & 31);
    }
  };
  return { porTamanho, bloquear };
}

function contar(m) {
  let n = 0;
  for (let x = 0; x < m.length; x++) {
    let v = m[x] - ((m[x] >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    n += (((v + (v >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
  }
  return n;
}

function bitsLigados(m, limite) {
  const out = [];
  for (let x = 0; x < m.length && out.length < limite; x++) {
    let v = m[x];
    while (v && out.length < limite) { const b = 31 - Math.clz32(v & -v); out.push(x * 32 + b); v &= v - 1; }
  }
  return out;
}

/**
 * Conserto local: apaga as palavras ruins (e as que as cruzam) e preenche só
 * esse pedaço de novo, mantendo o esqueleto e o resto da grade.
 * Devolve { g, letras } ou null se não achar substitutas.
 */
export function consertar(grade, ruins, palavras, rand) {
  const g = grade.map(l => [...l].map(ch => ch === '#'));
  const letras = grade.map(l => [...l].map(ch => (ch === '#' ? '' : ch)));
  const seqs = sequencias(g).filter(s => s.casas.length >= 2);
  const palavraDe = s => s.casas.map(([r, c]) => letras[r][c]).join('');
  const ruinsSeq = seqs.filter(s => ruins.has(palavraDe(s)));
  if (!ruinsSeq.length) return null;
  // casas a apagar: as das palavras ruins; se não der, também as das que cruzam
  const apagar = new Set(ruinsSeq.flatMap(s => s.casas.map(([r, c]) => r + ',' + c)));
  const tentar = casas => {
    const inicial = letras.map((l, r) => l.map((ch, c) => (casas.has(r + ',' + c) ? '' : ch)));
    const res = preencher(g, palavras, rand, 20000, inicial);
    return res.ok ? { g, letras: res.letras } : null;
  };
  // se não achar, alarga o pedaço apagado: as palavras que cruzam, depois as que cruzam essas
  let area = apagar;
  for (let anel = 0; anel <= 2; anel++) {
    const r = tentar(area);
    if (r) return r;
    const maior = new Set(area);
    for (const s of seqs) if (s.casas.some(([rr, c]) => area.has(rr + ',' + c))) s.casas.forEach(([rr, c]) => maior.add(rr + ',' + c));
    area = maior;
  }
  return null;
}

/** Grade (strings com #) + dicas com resposta e texto em branco. */
export function montar(g, letras) {
  const grade = letras.map((linha, r) => linha.map((x, c) => (g[r][c] ? '#' : x)).join(''));
  const palavra = (r, c, dl, dc) => { let s = ''; while (r < A && c < L && !g[r][c]) { s += letras[r][c]; r += dl; c += dc; } return s; };
  const ordem = { 'direita': 0, 'direita-baixo': 0, 'baixo': 1, 'baixo-direita': 1 }; // → em cima, ↓ embaixo
  const dicas = atribuirDicas(g).dicas.map(({ linha, coluna, direcao, chave }) => {
    const [r, c, sentido] = chave.split(',');
    const resposta = sentido === 'H' ? palavra(+r, +c, 0, 1) : palavra(+r, +c, 1, 0);
    return { linha, coluna, direcao, texto: '', resposta };
  });
  dicas.sort((a, b) => a.linha - b.linha || a.coluna - b.coluna || ordem[a.direcao] - ordem[b.direcao]);
  return { grade, dicas };
}

/**
 * Esqueleto + preenchimento com reparo. Quando a grade trava sempre na mesma
 * vaga, põe uma casa de dica no meio dela (como quem monta a cruzada à mão),
 * reajusta o esqueleto em volta e tenta de novo. Assim as casas de dica vão
 * só para onde fazem falta e o resto da grade fica com palavras longas.
 * Devolve { g, letras, reparos } ou null.
 */
export function gerarCruzada(rand, perfil, lista, { tentativas = 4, reparos = 10, nos = 1500, tema = null } = {}) {
  let g = gerarEsqueleto(rand, perfil);
  if (!g) return null;
  const travadas = new Set();
  let perf = { ...perfil };
  for (let rodada = 0; rodada <= reparos; rodada++) {
    const soma = new Map();
    // dia com tema: o mesmo plantio em todas as tentativas da rodada (o reparo
    // precisa ver as falhas no mesmo lugar para saber onde pôr a casa de dica)
    const inicial = tema ? semear(g, tema.palavras, tema.quantas, rand, lista) : null;
    for (let k = 0; k < tentativas; k++) {
      const r = preencher(g, lista, rand, nos, inicial, tema && tema.preferidas);
      if (r.ok) return { g, letras: r.letras, reparos: rodada };
      for (const f of r.falhas) {
        if (!f.n || f.casas.length < 3) continue;
        const chave = f.casas[0].join(',') + ',' + f.casas.length + (f.casas[1][0] === f.casas[0][0] ? 'H' : 'V');
        const s = soma.get(chave) || { casas: f.casas, n: 0 };
        s.n += f.n;
        soma.set(chave, s);
      }
    }
    if (rodada === reparos) break;
    const pior = [...soma.values()].sort((a, b) => b.n - a.n)[0];
    if (!pior) break;
    // uma casa do meio da vaga; de preferência sem sobrar pedaço de 2 a 4 letras
    // (um pedaço de 1 letra não é palavra: aquela letra fica só com a outra dica)
    const n = pior.casas.length;
    const meio = [];
    for (let q = 1; q < n - 1; q++) meio.push(q);
    const curto = x => x >= 2 && x <= 4;
    const boas = meio.filter(q => !curto(q) && !curto(n - q - 1));
    const opcoes = boas.length ? boas : meio;
    const [r, c] = pior.casas[opcoes[Math.floor(rand() * opcoes.length)]];
    g[r][c] = true;
    travadas.add(r * L + c);
    const folga = rodada % 3 === 2 ? 1 : 0; // a cada 3 rodadas, aceita uma curta a mais
    perf = { ...perf, alvoDicas: perf.alvoDicas + 1, maxTres: (perf.maxTres ?? 99) + folga, maxQuatro: (perf.maxQuatro ?? 99) + 2 * folga };
    const g2 = gerarEsqueleto(rand, perf, 6000, g, travadas, 0.3);
    if (!g2) break;
    g = g2;
  }
  return null;
}

/**
 * Dia com tema: planta palavras-tema em vagas sorteadas do tamanho certo, antes
 * de preencher (na frente da fila elas quase nunca cabem nas vagas já cruzadas).
 * As plantadas ficam espalhadas: nenhuma vaga cruzada passa por duas delas
 * (palavras-tema coladas lado a lado travam o preenchimento). Devolve as
 * letras (A×L, '' nas casas livres) para o "inicial" de preencher.
 */
export function semear(g, palavras, quantas, rand, lista) {
  const atual = Array.from({ length: A }, () => Array(L).fill(''));
  const vagas = sequencias(g).filter(s => s.casas.length >= 2);
  const usadas = new Set(), vetadas = new Set();
  const porTamanho = {};
  for (const w of lista) (porTamanho[w.length] ||= []).push(w);
  // a vaga ainda tem ao menos 5 palavras que cabem (com as letras já plantadas)?
  const temOpcoes = o => {
    const padrao = o.casas.map(([r, c]) => atual[r][c]);
    let n = 0;
    for (const w of porTamanho[padrao.length] || []) if (padrao.every((ch, k) => !ch || ch === w[k]) && ++n >= 5) return true;
    return false;
  };
  const ordem = palavras.slice();
  for (let i = ordem.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [ordem[i], ordem[j]] = [ordem[j], ordem[i]]; }
  // a vaga perpendicular que passa por (r, c) já tem letra plantada?
  const cruzaPlantada = (r, c, dir) => vagas.some(o => o.dir !== dir && o.casas.some(([rr, cc]) => rr === r && cc === c) &&
    o.casas.some(([rr, cc]) => atual[rr][cc]));
  let postas = 0;
  for (const p of ordem) {
    if (postas >= quantas) break;
    if (vetadas.has(p)) continue; // variante de uma já plantada (JOIA/JOIAS)
    const cabem = vagas.filter((v, i) => !usadas.has(i) && v.casas.length === p.length &&
      v.casas.every(([r, c]) => !cruzaPlantada(r, c, v.dir)));
    // sorteia uma vaga; desiste dela se alguma vaga cruzada ficar sem opção
    for (let i = cabem.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [cabem[i], cabem[j]] = [cabem[j], cabem[i]]; }
    for (const v of cabem) {
      v.casas.forEach(([r, c], k) => { atual[r][c] = p[k]; });
      const cruzadas = vagas.filter(o => o.dir !== v.dir && o.casas.some(([r, c]) => v.casas.some(([rr, cc]) => rr === r && cc === c)));
      if (cruzadas.every(temOpcoes)) {
        usadas.add(vagas.indexOf(v));
        variantes(p).forEach(x => vetadas.add(x));
        postas++;
        break;
      }
      v.casas.forEach(([r, c]) => { atual[r][c] = ''; });
    }
  }
  return atual;
}
