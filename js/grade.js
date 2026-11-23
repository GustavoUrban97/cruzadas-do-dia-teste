// Renderiza a grade no formato cruzada direta: casas de letra, casas de dica
// (com uma ou duas dicas) e as setas que indicam onde cada resposta começa.
// A tabela DIRECOES é a mesma de tools/validar.py; as duas precisam bater.

const DICA = '#';

// direcao -> deslocamento da casa da dica até a primeira letra
export const DIRECOES = {
  'direita':       { dl: 0, dc: 1 },
  'baixo':         { dl: 1, dc: 0 },
  'baixo-direita': { dl: 1, dc: 0 },
  'direita-baixo': { dl: 0, dc: 1 },
};

// Setas desenhadas num quadrado 10×10 (SVG), traço + ponta.
const SETAS = {
  'direita':       'M1 5 H8 M6 3 L8.5 5 L6 7',
  'baixo':         'M5 1 V8 M3 6 L5 8.5 L7 6',
  'baixo-direita': 'M2 1 V6 H8 M6 4 L8.5 6 L6 8',
  'direita-baixo': 'M1 2 H6 V8 M4 6 L6 8.5 L8 6',
};

function criarSeta(direcao) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 10 10');
  svg.setAttribute('class', `seta seta-${direcao}`);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', SETAS[direcao]);
  svg.append(path);
  return svg;
}

/** Desenha a grade completa do puzzle dentro de `elemento`. */
export function renderizarGrade(elemento, puzzle) {
  const { largura, altura, grade, dicas } = puzzle;
  elemento.style.setProperty('--n-colunas', largura);
  elemento.style.setProperty('--n-linhas', altura);
  elemento.replaceChildren();

  // Agrupa as dicas por casa, mantendo a ordem do arquivo (1ª = metade de cima).
  const dicasPorCasa = new Map();
  for (const dica of dicas) {
    const chave = `${dica.linha},${dica.coluna}`;
    if (!dicasPorCasa.has(chave)) dicasPorCasa.set(chave, []);
    dicasPorCasa.get(chave).push(dica);
  }

  const casas = [];
  for (let l = 0; l < altura; l++) {
    casas.push([]);
    for (let c = 0; c < largura; c++) {
      const casa = document.createElement('div');
      casa.dataset.linha = l;
      casa.dataset.coluna = c;

      if (grade[l][c] === DICA) {
        const lista = dicasPorCasa.get(`${l},${c}`) || [];
        casa.className = lista.length ? 'casa dica' : 'casa preta';
        if (lista.length === 2) casa.classList.add('dupla');
        for (const dica of lista) {
          const texto = document.createElement('div');
          texto.className = 'dica-texto';
          texto.textContent = dica.texto;
          casa.append(texto);
        }
      } else {
        casa.className = 'casa letra';
      }
      casas[l].push(casa);
      elemento.append(casa);
    }
  }

  // Setas: ficam na casa onde a resposta começa, na borda virada para a dica.
  for (const [chave, lista] of dicasPorCasa) {
    const [l, c] = chave.split(',').map(Number);
    lista.forEach((dica, i) => {
      const { dl, dc } = DIRECOES[dica.direcao];
      const alvo = casas[l + dl]?.[c + dc];
      if (!alvo) return;
      const seta = criarSeta(dica.direcao);
      // Casa com duas dicas: a seta que sai pela lateral (→ ou ↴) acompanha a metade
      // da sua dica, para duas setas na mesma casa de letra não ficarem uma por cima da outra.
      if ((dica.direcao === 'direita' || dica.direcao === 'direita-baixo') && lista.length === 2) {
        seta.classList.add(i === 0 ? 'metade-cima' : 'metade-baixo');
      }
      alvo.append(seta);
    });
  }
}

/**
 * Banco: algumas palavras raras da grade, impressas de ponta-cabeça embaixo
 * dela, como ajuda (no jornal elas ficam num canto, invertidas).
 */
export function renderizarBanco(elemento, puzzle) {
  const palavras = Array.isArray(puzzle.banco) ? puzzle.banco : [];
  elemento.replaceChildren();
  elemento.hidden = palavras.length === 0;
  if (!palavras.length) return;
  const span = document.createElement('span');
  const titulo = document.createElement('b');
  titulo.textContent = 'BANCO:';
  span.append(titulo, ` ${palavras.join(' · ')}`);
  elemento.append(span);
}

/**
 * Dimensiona a grade para ocupar o espaço disponível. As casas podem ficar
 * um pouco mais altas que largas (como na revista), até o limite de 1,3.
 * `banco` (opcional) fica embaixo da grade: desconta a altura dele e
 * acompanha a largura da grade. `abaixo` são outros blocos embaixo da grade
 * (o teclado), que também descontam a altura quando visíveis. Um bloco com
 * a variável CSS `--posicao: lado` fica ao lado da grade (paisagem) e
 * desconta a largura, mais o espaço entre as colunas.
 */
export function ajustarTamanho(elemento, area, puzzle, banco = null, abaixo = []) {
  const { width, height } = area.getBoundingClientRect();
  const estilo = getComputedStyle(area);
  let w = width - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight);
  let h = height - parseFloat(estilo.paddingTop) - parseFloat(estilo.paddingBottom);
  for (const bloco of [banco, ...abaixo]) {
    if (!bloco || bloco.hidden) continue;
    const estiloBloco = getComputedStyle(bloco);
    if (estiloBloco.getPropertyValue('--posicao').trim() === 'lado') {
      w -= bloco.offsetWidth + (parseFloat(estilo.columnGap) || 0);
    } else {
      h -= bloco.offsetHeight + (parseFloat(estiloBloco.marginTop) || 0);
    }
  }
  const proporcaoMax = 1.3; // altura / largura de cada casa

  let larguraCasa = w / puzzle.largura;
  let alturaCasa = h / puzzle.altura;
  if (alturaCasa > larguraCasa * proporcaoMax) alturaCasa = larguraCasa * proporcaoMax;
  if (larguraCasa > alturaCasa) larguraCasa = alturaCasa; // nunca mais larga que alta

  elemento.style.width = `${Math.floor(larguraCasa * puzzle.largura)}px`;
  elemento.style.height = `${Math.floor(alturaCasa * puzzle.altura)}px`;
  if (banco) banco.style.width = elemento.style.width;
  encaixarTextos(elemento);
}

/** Diminui a fonte de cada dica até o texto (sem cortar palavras) caber na sua metade da casa. */
function encaixarTextos(elemento) {
  const naoCabe = t => t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1;
  for (const texto of elemento.querySelectorAll('.dica-texto')) {
    texto.style.fontSize = '';
    texto.classList.remove('apertada');
    let tamanho = parseFloat(getComputedStyle(texto).fontSize);
    const minimo = tamanho * 0.55;
    while (naoCabe(texto) && tamanho > minimo) {
      tamanho -= 0.5;
      texto.style.fontSize = `${tamanho}px`;
    }
    if (naoCabe(texto)) texto.classList.add('apertada');
  }
}

/**
 * Coloca as respostas (letras do campo `grade`) em cada casa de letra, para o
 * gabarito de dias passados. Ficam por baixo da tinta; a visibilidade é
 * controlada pela classe `com-gabarito` na grade.
 */
export function colocarGabarito(elemento, puzzle) {
  for (const casa of elemento.querySelectorAll('.casa.letra')) {
    const letra = puzzle.grade[casa.dataset.linha][casa.dataset.coluna];
    const span = document.createElement('span');
    span.className = 'letra-gabarito';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = letra;
    casa.prepend(span);
  }
}
