// Persistência local no IndexedDB, uma entrada por puzzle (data + nível):
//  - tinta:    os traços e as letras digitadas (modo teclado);
//  - registro: o que aconteceu (terminei, avaliação do gabarito);
//  - memoria:  resumo das letras escritas nas cruzadas resolvidas (js/memoria.js).
//    Sai da tinta e do registro, então não entra no backup: é refeita sozinha.
// Chave das lojas: [data, nivel], ex.: ['2026-11-20', 'facil'].
// Se o armazenamento falhar, o app continua funcionando (só não guarda),
// e quem chama recebe o erro para avisar o usuário.

const BANCO = 'cruzadas-do-dia-teste';
const VERSAO_BANCO = 4;          // 1: tinta · 2: + registro · 3: chave com nível · 4: + memoria
const CHAVE = ['data', 'nivel'];
const NIVEL_ANTIGO = 'media';     // o que foi salvo antes dos três níveis vira "Média"
const LOJA_TINTA = 'tinta';       // { data, nivel, tracos: [...], letras: {"l,c": "A"}, atualizado }
const LOJA_REGISTRO = 'registro'; // { data, nivel, puzzle, terminei, termineiEm, avaliacao, avaliadoEm }
const LOJA_MEMORIA = 'memoria';   // { data, nivel, modelo, tinta (atualizado), exemplos: [{ letra, resumo }] }

let bancoAberto = null;

/**
 * Cria a loja com a chave [data, nivel]. Se ela já existe com a chave antiga
 * (só a data), copia tudo para a loja nova marcando o nível "media".
 */
function prepararLoja(banco, transacaoDeAtualizacao, nome) {
  if (!banco.objectStoreNames.contains(nome)) {
    banco.createObjectStore(nome, { keyPath: CHAVE });
    return;
  }
  const antiga = transacaoDeAtualizacao.objectStore(nome);
  if (Array.isArray(antiga.keyPath)) return; // já está no formato novo
  const leitura = antiga.getAll();
  leitura.onsuccess = () => {
    banco.deleteObjectStore(nome);
    const nova = banco.createObjectStore(nome, { keyPath: CHAVE });
    for (const item of leitura.result) nova.put({ ...item, nivel: item.nivel || NIVEL_ANTIGO });
  };
}

function abrir() {
  if (bancoAberto) return bancoAberto;
  bancoAberto = new Promise((resolver, rejeitar) => {
    let pedido;
    try {
      pedido = indexedDB.open(BANCO, VERSAO_BANCO);
    } catch (erro) {
      rejeitar(erro);
      return;
    }
    // Cria o que falta e migra o que já existe (nada salvo se perde).
    pedido.onupgradeneeded = () => {
      for (const loja of [LOJA_TINTA, LOJA_REGISTRO, LOJA_MEMORIA]) prepararLoja(pedido.result, pedido.transaction, loja);
    };
    pedido.onsuccess = () => {
      const banco = pedido.result;
      // Outra aba abriu uma versão mais nova do banco: fecha esta conexão para não travá-la.
      banco.onversionchange = () => { banco.close(); bancoAberto = null; };
      resolver(banco);
    };
    pedido.onerror = () => rejeitar(pedido.error);
    // Outra aba com a versão antiga aberta segura a atualização do banco (às vezes sem
    // nem disparar "blocked"). Se não abrir em alguns segundos, desiste para a página
    // não travar; quem chama avisa e não grava por cima de nada.
    setTimeout(() => rejeitar(new Error('IndexedDB bloqueado por outra aba do Cruzadas aberta')), 8000);
  });
  bancoAberto.catch(() => { bancoAberto = null; }); // permite tentar de novo depois
  return bancoAberto;
}

function transacao(nomeLoja, modo, operacao) {
  return abrir().then(banco => new Promise((resolver, rejeitar) => {
    const tx = banco.transaction(nomeLoja, modo);
    const pedido = operacao(tx.objectStore(nomeLoja));
    tx.oncomplete = () => resolver(pedido ? pedido.result : undefined);
    tx.onerror = () => rejeitar(tx.error);
    tx.onabort = () => rejeitar(tx.error || new Error('transação abortada'));
  }));
}

// ---------- Tinta (traços e letras digitadas) ----------

/**
 * Folha salva do puzzle (data + nível): { tracos: [...], letras: {"linha,coluna": "A"} }.
 * Sem nada salvo ainda: listas vazias.
 */
export async function carregarTinta(data, nivel) {
  const salvo = await transacao(LOJA_TINTA, 'readonly', loja => loja.get([data, nivel]));
  return {
    tracos: (salvo && Array.isArray(salvo.tracos)) ? salvo.tracos : [],
    letras: (salvo && salvo.letras && typeof salvo.letras === 'object') ? salvo.letras : {},
  };
}

/** Grava (substitui) os traços e as letras digitadas do puzzle. */
export function salvarTinta(data, nivel, tracos, letras = {}) {
  return transacao(LOJA_TINTA, 'readwrite', loja =>
    loja.put({ data, nivel, tracos, letras, atualizado: new Date().toISOString() }));
}

// ---------- Registro ----------

/** Registro do puzzle, ou null se nada foi marcado. */
export async function carregarRegistro(data, nivel) {
  return (await transacao(LOJA_REGISTRO, 'readonly', loja => loja.get([data, nivel]))) || null;
}

/** Junta `mudancas` ao registro do puzzle (lê e grava na mesma transação). Devolve o registro novo. */
export function atualizarRegistro(data, nivel, mudancas) {
  let novo;
  return transacao(LOJA_REGISTRO, 'readwrite', loja => {
    const leitura = loja.get([data, nivel]);
    leitura.onsuccess = () => {
      novo = {
        data, nivel, terminei: false, termineiEm: null, avaliacao: null, avaliadoEm: null,
        ...leitura.result, ...mudancas,
      };
      loja.put(novo);
    };
    return null;
  }).then(() => novo);
}

// ---------- Memória de letras ----------

/** Todas as entradas da memória de letras. */
export function lerMemoria() {
  return transacao(LOJA_MEMORIA, 'readonly', loja => loja.getAll());
}

export function gravarMemoria(item) {
  return transacao(LOJA_MEMORIA, 'readwrite', loja => loja.put(item));
}

/** Apaga as entradas [data, nivel] da lista. */
export function apagarMemoria(chaves) {
  return transacao(LOJA_MEMORIA, 'readwrite', loja => { chaves.forEach(k => loja.delete(k)); return null; });
}

// ---------- Tudo de uma vez (histórico e backup) ----------

/** Todas as entradas de tinta e de registro: { tinta: [...], registro: [...] }. */
export function lerTudo() {
  return abrir().then(banco => new Promise((resolver, rejeitar) => {
    const tx = banco.transaction([LOJA_TINTA, LOJA_REGISTRO], 'readonly');
    const tinta = tx.objectStore(LOJA_TINTA).getAll();
    const registro = tx.objectStore(LOJA_REGISTRO).getAll();
    tx.oncomplete = () => resolver({ tinta: tinta.result, registro: registro.result });
    tx.onerror = () => rejeitar(tx.error);
    tx.onabort = () => rejeitar(tx.error || new Error('transação abortada'));
  }));
}

/**
 * Grava as entradas de um backup numa transação só (ou entra tudo, ou nada).
 * Cada puzzle (data + nível) do backup substitui o mesmo puzzle deste aparelho; os outros ficam.
 */
export function gravarBackup({ tinta, registro }) {
  return abrir().then(banco => new Promise((resolver, rejeitar) => {
    const tx = banco.transaction([LOJA_TINTA, LOJA_REGISTRO], 'readwrite');
    const lojaTinta = tx.objectStore(LOJA_TINTA);
    const lojaRegistro = tx.objectStore(LOJA_REGISTRO);
    tinta.forEach(item => lojaTinta.put(item));
    registro.forEach(item => lojaRegistro.put(item));
    tx.oncomplete = () => resolver();
    tx.onerror = () => rejeitar(tx.error);
    tx.onabort = () => rejeitar(tx.error || new Error('transação abortada'));
  }));
}

/**
 * Pede ao navegador para não apagar os dados sozinho quando faltar espaço.
 * O Chrome decide (costuma aceitar para sites instalados/muito usados).
 */
export async function pedirPersistencia() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* sem suporte: tudo bem */ }
  return false;
}
