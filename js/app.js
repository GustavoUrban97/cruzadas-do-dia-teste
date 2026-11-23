// Inicialização e escolha do puzzle por data e nível.

import { hojeEmBrasilia, dataValida, dataPorExtenso, dataAbreviada, dataCurta, diasEntre, somarDias } from './datas.js';
import { renderizarGrade, renderizarBanco, ajustarTamanho, colocarGabarito } from './grade.js';
import { Tinta } from './tinta.js';
import { Teclado } from './teclado.js';
import { Conferencia } from './conferencia.js';
import { iniciarDiagnostico } from './diagnostico.js';
import { iniciarHistorico } from './historico.js';
import { NIVEIS, NOMES_NIVEIS, nivelValido } from './niveis.js';
import { carregarTinta, salvarTinta, pedirPersistencia, carregarRegistro, atualizarRegistro } from './armazenamento.js';

// Versão do app, mostrada discretamente no cabeçalho.
// IMPORTANTE: precisa ser igual à VERSAO de sw.js, que deve subir a cada mudança
// em HTML/CSS/JS (é o que faz o tablet perceber que há versão nova).
const VERSAO = 21;

// Celular (tela estreita): sem caneta, o jogo é só pelo modo teclado.
// O mesmo limite está no CSS (@media max-width: 599px).
const CELULAR = window.matchMedia('(max-width: 599px)');

const $ = id => document.getElementById(id);
const parametros = new URLSearchParams(location.search);

// ?hoje=AAAA-MM-DD finge que hoje é outra data (só para testar o fluxo de "ontem").
const HOJE_FINGIDO = dataValida(parametros.get('hoje')) ? parametros.get('hoje') : null;
const hoje = () => HOJE_FINGIDO ?? hojeEmBrasilia();

/** Endereço da página para um puzzle, mantendo ?hoje e ?debug. Hoje = sem ?data. */
function endereco(data, nivel) {
  const p = new URLSearchParams(location.search);
  if (data === hoje()) p.delete('data'); else p.set('data', data);
  p.set('nivel', nivel);
  return `${location.pathname}?${p}`;
}

async function buscarJSON(caminho) {
  const resposta = await fetch(caminho, { cache: 'no-cache' });
  if (!resposta.ok) throw new Error(`${caminho}: HTTP ${resposta.status}`);
  return resposta.json();
}

/** Datas que têm puzzle do nível, em ordem (index.json: {"datas": {"AAAA-MM-DD": [níveis]}}). */
function datasDoNivel(indice, nivel) {
  return Object.keys(indice).filter(d => indice[d].includes(nivel)).sort();
}

/**
 * Decide qual arquivo abrir para a data e o nível pedidos.
 * Se não houver puzzle desse nível na data, usa um fallback determinístico:
 * dias desde o primeiro puzzle do nível, ciclando pelos disponíveis.
 */
function escolherPuzzle(data, nivel, indice) {
  const datas = datasDoNivel(indice, nivel);
  if (datas.length === 0) throw new Error(`ainda não há cruzada ${NOMES_NIVEIS[nivel].toLowerCase()} no banco`);
  if (datas.includes(data)) return { arquivo: `${data}-${nivel}`, dataDoArquivo: data, substituto: false };
  const n = datas.length;
  const dias = diasEntre(datas[0], data);
  const escolhida = datas[((dias % n) + n) % n];
  return { arquivo: `${escolhida}-${nivel}`, dataDoArquivo: escolhida, substituto: true };
}

// ---------- Preferências leves (localStorage, sempre com try/catch) ----------

function lerPreferencia(chave, padrao) {
  try { return localStorage.getItem('teste:' + chave) ?? padrao; } catch { return padrao; }
}

function gravarPreferencia(chave, valor) {
  try { localStorage.setItem('teste:' + chave, valor); } catch { /* sem armazenamento: tudo bem */ }
}

// ---------- Barra de ferramentas ----------

function configurarFerramentas(tinta, teclado) {
  const botoes = [...document.querySelectorAll('[data-ferramenta]')];
  const escolher = (nome, gravar = true) => {
    tinta.usar(nome);
    teclado.ativar(tinta.ferramenta === 'teclado');
    botoes.forEach(b => b.classList.toggle('ativa', b.dataset.ferramenta === tinta.ferramenta));
    if (gravar) gravarPreferencia('ferramenta', tinta.ferramenta);
  };
  botoes.forEach(b => b.addEventListener('click', () => escolher(b.dataset.ferramenta)));
  // No celular o teclado fica sempre ligado (as ferramentas de caneta nem aparecem);
  // a preferência guardada vale de novo se a tela ficar larga (celular deitado, PC).
  const aplicarTela = () => escolher(CELULAR.matches ? 'teclado' : lerPreferencia('ferramenta', 'caneta'), false);
  aplicarTela();
  CELULAR.addEventListener('change', aplicarTela);

  // Cores da caneta: escolher uma cor também ativa a caneta.
  const cores = [...document.querySelectorAll('[data-cor]')];
  const escolherCor = (cor, ativarCaneta) => {
    tinta.usarCor(cor);
    cores.forEach(b => b.classList.toggle('escolhida', b.dataset.cor === tinta.cor));
    const escolhida = cores.find(b => b.dataset.cor === tinta.cor);
    if (escolhida) $('botao-caneta').style.color = getComputedStyle(escolhida).getPropertyValue('--cor');
    gravarPreferencia('cor', tinta.cor);
    if (ativarCaneta) escolher('caneta');
  };
  cores.forEach(b => b.addEventListener('click', () => escolherCor(b.dataset.cor, true)));
  escolherCor(lerPreferencia('cor', 'preta'), false);

  $('desfazer').addEventListener('click', () => tinta.desfazer());
  $('refazer').addEventListener('click', () => tinta.refazer());

  // Atalhos de teclado (útil no PC): Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const tecla = e.key.toLowerCase();
    if (tecla === 'z' && !e.shiftKey) { e.preventDefault(); tinta.desfazer(); }
    else if (tecla === 'y' || (tecla === 'z' && e.shiftKey)) { e.preventDefault(); tinta.refazer(); }
  });
}

// ---------- Avisos ----------

function mostrarAviso(texto) {
  const aviso = $('aviso');
  aviso.textContent = aviso.hidden || !aviso.textContent ? texto : `${aviso.textContent} ${texto}`;
  aviso.hidden = false;
}

let temporizadorToast = null;
function mostrarToast(texto) {
  const toast = $('toast');
  toast.textContent = texto;
  toast.hidden = false;
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => { toast.hidden = true; }, 3500);
}

// ---------- Salvar a tinta (IndexedDB) ----------

/** Salva os traços e as letras do puzzle; várias mudanças seguidas viram uma gravação só. */
function criarSalvador(data, nivel, tinta) {
  let fila = Promise.resolve();
  let agendado = false;
  let falhou = false;
  return () => {
    if (agendado) return fila;
    agendado = true;
    fila = fila
      .then(() => { agendado = false; return salvarTinta(data, nivel, tinta.exportar(), tinta.exportarLetras()); })
      .catch(erro => {
        agendado = false;
        console.error(erro);
        if (!falhou) mostrarAviso('Atenção: não foi possível salvar a tinta neste aparelho.');
        falhou = true;
      });
    return fila;
  };
}

// ---------- Gesto de voltar ----------

/**
 * Coloca uma entrada extra no histórico depois de um traço. Se o gesto de voltar
 * do Android disparar sem querer, ele consome essa entrada e a página fica onde está.
 * O Chrome só respeita entradas criadas logo após uma ação do usuário (o traço),
 * por isso a proteção é rearmada no fim de cada traço, não dentro do popstate.
 */
function criarProtecaoVoltar() {
  const marca = `${Date.now()}-${Math.random()}`; // distingue de entradas de aberturas anteriores
  let armada = false;
  window.addEventListener('popstate', () => {
    if (armada && !(history.state && history.state.guarda === marca)) {
      armada = false;
      mostrarToast('Gesto de voltar ignorado. Para sair, faça o gesto de novo.');
    }
  });
  return () => {
    if (armada) return;
    try {
      history.pushState({ guarda: marca }, '');
      armada = true;
    } catch { /* sem histórico: tudo bem */ }
  };
}

// ---------- Virada da meia-noite ----------

/** Confere a data a cada minuto e ao voltar ao app; avisa, sem trocar à força. */
function vigiarVirada(dataAberta, aoTrocar) {
  const conferir = () => {
    if (hoje() === dataAberta) return;
    const faixa = $('novo-puzzle');
    faixa.hidden = false;
    faixa.onclick = aoTrocar;
  };
  setInterval(conferir, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') conferir();
  });
}

// ---------- Service worker: abrir sem internet e avisar de versão nova ----------

/**
 * Registra o sw.js. Quando uma versão nova é publicada, o navegador baixa o sw.js
 * novo, que fica "esperando"; aí mostramos a faixa. Ao tocar, ele assume e a
 * página recarrega já com os arquivos novos. Nunca recarrega sozinho.
 */
function registrarServiceWorker(antesDeRecarregar) {
  if (!('serviceWorker' in navigator)) return;
  let recarregar = false;

  const oferecer = registro => {
    if (!registro.waiting || !navigator.serviceWorker.controller) return;
    const faixa = $('atualizacao');
    faixa.hidden = false;
    faixa.onclick = async () => {
      faixa.disabled = true;
      await antesDeRecarregar();
      recarregar = true;
      registro.waiting.postMessage({ tipo: 'atualizar' });
    };
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recarregar) location.reload();
  });

  navigator.serviceWorker.register('sw.js').then(registro => {
    oferecer(registro);
    registro.addEventListener('updatefound', () => {
      const novo = registro.installing;
      if (!novo) return;
      novo.addEventListener('statechange', () => {
        if (novo.state === 'installed') oferecer(registro);
      });
    });
    // Página aberta por muito tempo: procura versão nova ao voltar para ela.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registro.update().catch(() => {});
    });
  }).catch(erro => console.warn('Service worker não registrado:', erro));
}

/** Busca os puzzles (dos três níveis) dos próximos 7 dias para o service worker guardar (uso offline). */
function precarregarProximos(hoje, indice) {
  for (let i = 1; i <= 7; i++) {
    const dia = somarDias(hoje, i);
    for (const nivel of indice[dia] || []) {
      fetch(`puzzles/${dia}-${nivel}.json`, { cache: 'no-cache' }).catch(() => {});
    }
  }
}

// ---------- Conferência, gabarito e registro do dia ----------

const ROTULOS_ANTIGOS = { 'acertei-tudo': 'Acertei tudo', 'errei-algumas': 'Errei algumas', 'nao-terminei': 'Não terminei' };

/** Como o dia terminou, para a faixa dos dias passados. */
function textoDoDia(registro, passado) {
  if (registro && registro.resolvido) {
    const n = registro.conferencias || 1;
    return `Resolvida na ${n}ª conferência · ${n === 1 ? 'acertei tudo' : 'errei algumas'}`;
  }
  if (registro && registro.desistiu) return 'Desisti · não terminei';
  if (registro && registro.avaliacao) return `Avaliação: ${ROTULOS_ANTIGOS[registro.avaliacao] || registro.avaliacao}`;
  if (registro && registro.terminei) return 'Terminei (sem avaliação)';
  return passado ? 'Ficou sem conferir · não terminei' : '';
}

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

/**
 * Mostra as ações que fazem sentido para o puzzle aberto (data + nível):
 *  - hoje: "Conferir" (com a grade completa, marca erradas e ilegíveis sem mostrar a
 *    resposta e conta uma tentativa; tudo certo resolve o dia; com casas vazias, só
 *    aponta as vazias e não conta), "Desistir" (mostra as respostas) e "Ontem";
 *  - dia passado: gabarito em verde, as casas erradas marcadas e como o dia terminou;
 *  - dia futuro (só em teste): apenas "Hoje".
 * O registro é automático: resolveu na 1ª conferência = acertei tudo; depois de
 * corrigir = errei algumas; desistiu ou não resolveu = não terminei.
 * Editar a tinta de um dia passado não mexe no registro.
 */
async function configurarDia({ data, nivel, arquivo, irPara, puzzle, conferencia, teclado }) {
  const diaDeHoje = hoje();
  const passado = data < diaDeHoje;

  let registro = null;
  try {
    registro = await carregarRegistro(data, nivel);
  } catch (erro) {
    console.error(erro);
  }

  const gravar = async mudancas => {
    try {
      registro = await atualizarRegistro(data, nivel, { puzzle: arquivo, ...mudancas });
      return true;
    } catch (erro) {
      console.error(erro);
      mostrarAviso('Atenção: não foi possível salvar o registro neste aparelho.');
      return false;
    }
  };

  if (data !== diaDeHoje) {
    const botao = $('ir-hoje');
    botao.hidden = false;
    botao.addEventListener('click', () => irPara(diaDeHoje));
  }

  // Respostas em verde, por baixo da tinta (dias passados, ou hoje depois de desistir).
  let gabaritoPronto = false;
  const mostrarGabarito = () => {
    const grade = $('grade');
    $('avaliacao-texto').textContent = textoDoDia(registro, passado);
    $('avaliacao').hidden = false;
    if (gabaritoPronto) return;
    gabaritoPronto = true;
    if (!grade.querySelector('.letra-gabarito')) colocarGabarito(grade, puzzle);
    teclado.conferir = true; // letras digitadas: certa em verde claro, errada riscada
    teclado.atualizarLetras(Object.keys(teclado.tinta.exportarLetras()));
    const alternar = $('alternar-gabarito');
    const mostrar = visivel => {
      grade.classList.toggle('com-gabarito', visivel);
      $('avaliacao').classList.toggle('com-gabarito', visivel); // resumo das letras digitadas
      // "Ocultar gabarito" — no celular só "Ocultar", para a faixa caber numa linha.
      const resto = document.createElement('span');
      resto.className = 'sem-celular';
      resto.textContent = ' gabarito';
      alternar.replaceChildren(visivel ? 'Ocultar' : 'Mostrar', resto);
      gravarPreferencia('gabarito', visivel ? 'mostrar' : 'ocultar');
    };
    mostrar(lerPreferencia('gabarito', 'mostrar') !== 'ocultar');
    alternar.addEventListener('click', () => mostrar(!grade.classList.contains('com-gabarito')));
  };

  if (data === diaDeHoje) {
    const botao = $('conferir');
    const encerrado = () => Boolean(registro && (registro.resolvido || registro.desistiu));
    const pintar = () => {
      botao.textContent = registro && registro.resolvido ? '✓ Resolvida' : (registro && registro.desistiu ? 'Desisti' : 'Conferir');
      botao.setAttribute('aria-pressed', String(Boolean(registro && registro.resolvido)));
      botao.disabled = encerrado();
    };
    pintar();
    botao.hidden = false;
    if (registro && registro.desistiu) mostrarGabarito();

    const faixa = $('resultado');
    let ultimo = null; // resultado da última conferência

    const resolver = async () => {
      const n = (registro && registro.conferencias) || 1;
      const agora = new Date().toISOString();
      const ok = await gravar({
        resolvido: true, resolvidoEm: agora, terminei: true, termineiEm: agora,
        avaliacao: n === 1 ? 'acertei-tudo' : 'errei-algumas', avaliadoEm: agora,
      });
      if (!ok) return;
      faixa.hidden = true;
      conferencia.limparMarcas();
      conferencia.aprender(); // as letras desta cruzada entram na memória de letras
      mostrarToast(n === 1 ? 'Tudo certo de primeira! 🎉' : `Tudo certo! 🎉 Resolvida na ${n}ª conferência.`);
      pintar();
    };

    const mostrarResultado = () => {
      const { erradas, ilegiveis } = ultimo;
      const partes = [];
      if (erradas.length) partes.push(plural(erradas.length, 'errada', 'erradas'));
      if (ilegiveis.length) partes.push(`${plural(ilegiveis.length, 'casa', 'casas')} que não consegui ler`);
      $('resultado-texto').textContent = partes.join(' · ');
      $('aceitar-ilegiveis').hidden = ilegiveis.length === 0;
      faixa.hidden = false;
    };

    botao.addEventListener('click', async () => {
      if (encerrado()) return;
      botao.disabled = true;
      botao.textContent = 'Conferindo…';
      try {
        ultimo = await conferencia.conferir();
      } catch (erro) {
        console.error(erro);
        mostrarAviso('Não foi possível conferir agora (o reconhecimento de letras não carregou).');
        pintar();
        return;
      }
      // Grade incompleta: não confere nada nem gasta tentativa; só aponta as vazias.
      if (ultimo.vazias.length) {
        conferencia.marcar({ vazias: ultimo.vazias });
        $('resultado-texto').textContent =
          `${ultimo.vazias.length === 1 ? 'Falta 1 casa' : `Faltam ${ultimo.vazias.length} casas`} · o lápis não conta`;
        $('aceitar-ilegiveis').hidden = true;
        faixa.hidden = false;
        pintar();
        return;
      }
      const ok = await gravar({ conferencias: ((registro && registro.conferencias) || 0) + 1 });
      if (!ok) { pintar(); return; }
      if (!ultimo.erradas.length && !ultimo.ilegiveis.length) {
        await resolver();
      } else {
        conferencia.marcar(ultimo);
        mostrarResultado();
        pintar();
      }
    });

    // O reconhecimento não leu, mas a letra está certa: conta como certa.
    $('aceitar-ilegiveis').addEventListener('click', async () => {
      if (!ultimo) return;
      conferencia.aceitar(ultimo.ilegiveis);
      ultimo = { ...ultimo, ilegiveis: [] };
      if (!ultimo.erradas.length && !ultimo.vazias.length) await resolver();
      else mostrarResultado();
    });

    $('desistir').addEventListener('click', async () => {
      if (!confirm('Desistir e ver as respostas? O dia conta como "não terminei".')) return;
      const agora = new Date().toISOString();
      const ok = await gravar({ desistiu: true, desistiuEm: agora, avaliacao: 'nao-terminei', avaliadoEm: agora });
      if (!ok) return;
      faixa.hidden = true;
      conferencia.limparMarcas();
      mostrarGabarito();
      pintar();
    });

    $('fechar-resultado').addEventListener('click', () => { faixa.hidden = true; });

    const ontem = somarDias(diaDeHoje, -1);
    const botaoOntem = $('ir-ontem');
    botaoOntem.hidden = false;
    botaoOntem.addEventListener('click', () => irPara(ontem));
    lembrarOntem(ontem, nivel, irPara);
  }

  if (passado) {
    mostrarGabarito();
    // Marca as casas erradas do jeito que ficaram (quando o modelo carregar).
    conferencia.conferir()
      .then(res => conferencia.marcar({ erradas: res.erradas, ilegiveis: [] }))
      .catch(erro => console.error(erro));
  }
}

/**
 * Algum puzzle de ontem escrito e que ficou sem resolver (nem desistir): mostra
 * um lembrete discreto para ver o gabarito. O nível aberto tem preferência.
 */
async function lembrarOntem(ontem, nivelAberto, irPara) {
  const ordem = [nivelAberto, ...NIVEIS.filter(n => n !== nivelAberto)];
  for (const nivel of ordem) {
    try {
      const [registro, folha] = await Promise.all([carregarRegistro(ontem, nivel), carregarTinta(ontem, nivel)]);
      if (registro && (registro.resolvido || registro.desistiu || registro.avaliacao)) continue;
      const escreveu = folha.tracos.length > 0 || Object.keys(folha.letras).length > 0;
      if (!escreveu) continue;
      const faixa = $('lembrete-ontem');
      faixa.textContent = `Ontem (${NOMES_NIVEIS[nivel]}) ficou sem conferir · toque para ver o gabarito`;
      faixa.hidden = false;
      faixa.onclick = () => irPara(ontem, nivel);
      return;
    } catch (erro) {
      console.error(erro);
      return;
    }
  }
}

/** Nível a abrir: ?nivel=, senão o último usado, senão "media". */
function nivelInicial() {
  const pedido = parametros.get('nivel');
  if (nivelValido(pedido)) return pedido;
  const salvo = lerPreferencia('nivel', 'media');
  return nivelValido(salvo) ? salvo : 'media';
}

// ---------- Início ----------

async function iniciar() {
  $("versao").textContent = `v${VERSAO} · teste`;
  if (parametros.get('debug') === '1') iniciarDiagnostico(VERSAO);

  // Antes de recarregar para uma versão nova, grava a tinta (trocado abaixo).
  let salvarAntesDeSair = async () => {};
  registrarServiceWorker(() => salvarAntesDeSair());

  // ?data=AAAA-MM-DD abre um dia específico (útil para testar).
  const pedida = parametros.get('data');
  const data = dataValida(pedida) ? pedida : hoje();
  const nivel = nivelInicial();
  gravarPreferencia('nivel', nivel);

  // "domingo, 15 de novembro" + " de 2026" (o ano some em telas estreitas, para caber).
  // No celular aparece só a forma curta: "dom, 15/11".
  const extenso = dataPorExtenso(data);
  const corte = extenso.lastIndexOf(' de ');
  const longa = document.createElement('span');
  longa.className = 'data-longa';
  const ano = document.createElement('span');
  ano.className = 'ano';
  ano.textContent = extenso.slice(corte);
  longa.append(extenso.slice(0, corte), ano);
  const curta = document.createElement('span');
  curta.className = 'data-curta';
  curta.textContent = dataAbreviada(data);
  $('data-extenso').replaceChildren(longa, curta);
  $('data-extenso').title = extenso;

  // Seletor de nível: marca o aberto; trocar grava a tinta e abre o mesmo dia no outro nível.
  let irPara = (destino, destinoNivel = nivel) => location.assign(endereco(destino, destinoNivel));
  for (const botao of document.querySelectorAll('[data-nivel]')) {
    botao.setAttribute('aria-pressed', String(botao.dataset.nivel === nivel));
    botao.addEventListener('click', () => {
      if (botao.dataset.nivel !== nivel) irPara(data, botao.dataset.nivel);
    });
  }

  try {
    const { datas: indice, temas = {} } = await buscarJSON('puzzles/index.json');
    if (!indice || Array.isArray(indice) || Object.keys(indice).length === 0) {
      throw new Error('puzzles/index.json está vazio ou no formato antigo');
    }

    const { arquivo, dataDoArquivo, substituto } = escolherPuzzle(data, nivel, indice);
    const puzzle = await buscarJSON(`puzzles/${arquivo}.json`);

    $('edicao').textContent = `Nº ${puzzle.id} · ${puzzle.titulo}`;
    $('edicao').title = `Nº ${puzzle.id} · ${puzzle.titulo}`;
    if (substituto) {
      mostrarAviso(`Sem cruzada ${NOMES_NIVEIS[nivel].toLowerCase()} nova para ${data === hoje() ? 'hoje' : 'este dia'}, ` +
        `mostrando a de ${dataCurta(dataDoArquivo)}. O banco precisa de puzzles novos.`);
    }

    // Dia com tema: as casas de dica (e a faixa da dica) ganham a cor do tema.
    if (puzzle.tema && /^#[0-9a-f]{6}$/i.test(puzzle.tema.cor || '')) {
      document.documentElement.style.setProperty('--casa-dica', puzzle.tema.cor);
    }
    renderizarGrade($('grade'), puzzle);
    renderizarBanco($('banco'), puzzle);
    if (data < hoje()) colocarGabarito($('grade'), puzzle); // como no jornal: só no dia seguinte
    const ajustar = () => ajustarTamanho($('grade'), $('folha'), puzzle, $('banco'), [$('area-teclado')]);
    ajustar();
    // Girar a tela ou redimensionar a janela: recalcula o tamanho das casas.
    new ResizeObserver(() => requestAnimationFrame(ajustar)).observe($('folha'));

    // Tinta salva deste puzzle (antes de liberar a caneta, para nada ser sobrescrito).
    let salvos = { tracos: [], letras: {} };
    let leuTinta = true;
    try {
      salvos = await carregarTinta(data, nivel);
    } catch (erro) {
      console.error(erro);
      leuTinta = false;
      mostrarAviso(String(erro.message).includes('bloqueado')
        ? 'Há outra aba do Cruzadas aberta com a versão antiga: feche-a e recarregue esta.'
        : 'Atenção: não foi possível ler a tinta salva neste aparelho.');
    }

    const armarVoltar = criarProtecaoVoltar();
    let persistenciaPedida = false;
    let salvar = () => {};
    let teclado = null;
    let conferencia = null;

    const tinta = new Tinta($('papel'), {
      colunas: puzzle.largura,
      linhas: puzzle.altura,
      aoTocarCasa: (x, y) => teclado && teclado.tocar(x, y),       // modo teclado
      aoMudarLetras: chaves => teclado && teclado.atualizarLetras(chaves),
      aoMudarHistorico: (podeDesfazer, podeRefazer) => {
        $('desfazer').disabled = !podeDesfazer;
        $('refazer').disabled = !podeRefazer;
      },
      aoMudar: () => {                  // ao fim de cada traço, apagada, desfazer, refazer
        salvar();
        if (conferencia) conferencia.aoMudarTinta(); // lê em segundo plano as casas que mudaram
      },
      aoTerminarGesto: () => {
        armarVoltar();
        if (!persistenciaPedida) { persistenciaPedida = true; pedirPersistencia(); }
      },
    });
    // Modo teclado: seleção de casa, teclado na tela, faixa da dica atual.
    teclado = new Teclado({
      grade: $('grade'),
      puzzle,
      tinta,
      area: $('area-teclado'),
      faixa: $('dica-atual'),
      anterior: $('dica-anterior'),
      seguinte: $('dica-seguinte'),
      teclas: $('teclado'),
      conferir: data < hoje(),               // gabarito: marca letras digitadas certas e erradas
      aoResumo: (certas, total) => {
        const resumo = $('resumo-letras');
        resumo.hidden = total === 0;
        resumo.textContent = `Letras digitadas: ${certas} de ${total} certas`;
      },
      aoMudarVisibilidade: ajustar,
    });
    tinta.importar(salvos.tracos, salvos.letras);
    // Conferência (hoje e dias passados; dia futuro, só em teste, não confere).
    if (data <= hoje()) {
      conferencia = new Conferencia({ puzzle, tinta, grade: $('grade') });
      // O modelo de letras carrega sem pressa, depois que a folha já está na tela.
      setTimeout(() => conferencia.preparar().catch(erro => console.error(erro)), 800);
    }
    // Se não deu para ler a tinta guardada, não grava por cima dela (perderia o que já estava lá).
    salvar = leuTinta ? criarSalvador(data, nivel, tinta) : async () => {};
    salvarAntesDeSair = () => salvar();
    configurarFerramentas(tinta, teclado);
    precarregarProximos(hojeEmBrasilia(), indice);

    // Trocar de dia ou de nível (Ontem / Hoje / lembrete / seletor): grava a tinta antes de sair.
    irPara = async (destino, destinoNivel = nivel) => {
      await salvar();
      location.assign(endereco(destino, destinoNivel));
    };
    configurarDia({ data, nivel, arquivo, irPara: (d, n) => irPara(d, n), puzzle, conferencia, teclado });

    // Painel "Meu histórico" (estatísticas, calendário, backup), aberto no nível atual.
    iniciarHistorico({
      hoje,
      nivel,
      antesDeLer: () => salvar(),
      irPara: (d, n) => irPara(d, n),
      temas,
      aoImportar: async gravarBackup => {
        // Para de salvar a tinta aberta, senão ela gravaria por cima do puzzle importado.
        await salvar();
        const salvarAnterior = salvar;
        salvar = async () => {};
        try {
          await gravarBackup();
        } catch (erro) {
          salvar = salvarAnterior;
          throw erro;
        }
        location.reload();
      },
    });

    // Ao sair do app (trocar de app, apagar a tela), garante a última gravação.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') salvar();
    });

    // Aberto como "hoje": avisa quando virar o dia em Brasília.
    if (!dataValida(pedida)) {
      vigiarVirada(data, async () => {
        await salvar();
        location.replace(endereco(hoje(), nivel));
      });
    }
  } catch (erro) {
    console.error(erro);
    $('folha').innerHTML = '';
    const p = document.createElement('p');
    p.className = 'erro';
    p.textContent = `Não foi possível carregar o puzzle (${erro.message}).`;
    $('folha').append(p);
  }
}

iniciar();
