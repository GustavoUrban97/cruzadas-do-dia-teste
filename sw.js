// Service worker: guarda os arquivos da página no aparelho (abre sem internet)
// e controla as versões (avisa quando há versão nova, em vez de misturar
// arquivos novos com antigos do cache do navegador).
//
// IMPORTANTE: suba VERSAO (e a VERSAO de js/app.js) a cada mudança em
// HTML, CSS ou JS. É a mudança deste arquivo que faz o tablet perceber
// que existe versão nova e mostrar "Atualização disponível".

const VERSAO = 'v21';
const CACHE_CASCO = `teste-casco-${VERSAO}`;
const CACHE_PUZZLES = 'teste-puzzles';

// "Casco" da página: tudo que não é puzzle.
const CASCO = [
  './',
  'index.html',
  'css/estilo.css',
  'js/app.js',
  'js/datas.js',
  'js/grade.js',
  'js/tinta.js',
  'js/teclado.js',
  'js/conferencia.js',
  'js/reconhecer.js',
  'js/memoria.js',
  'modelo/letras.json',
  'modelo/letras.bin',
  'js/armazenamento.js',
  'js/diagnostico.js',
  'js/historico.js',
  'js/niveis.js',
];

self.addEventListener('install', evento => {
  evento.waitUntil(
    caches.open(CACHE_CASCO).then(cache =>
      // cache: 'reload' ignora o cache HTTP do navegador e busca do servidor.
      cache.addAll(CASCO.map(url => new Request(url, { cache: 'reload' })))
    )
  );
  // Não assume sozinho: espera o usuário tocar em "Atualização disponível".
});

self.addEventListener('message', evento => {
  if (evento.data && evento.data.tipo === 'atualizar') self.skipWaiting();
});

self.addEventListener('activate', evento => {
  evento.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes
      .filter(nome => nome.startsWith('teste-casco-') && nome !== CACHE_CASCO)
      .map(nome => caches.delete(nome)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', evento => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return;

  // Puzzles e index.json: rede primeiro (pega puzzle novo assim que houver push),
  // cópia guardada se estiver sem internet.
  if (url.pathname.includes('/puzzles/')) {
    evento.respondWith(redePrimeiro(pedido));
    return;
  }

  // Página do jogo (com qualquer ?data=, ?debug=...): sempre o index.html guardado.
  // Outras páginas do site (tools/gerador.html, tools/reconhecer.html) vêm da rede.
  const raiz = new URL('./', self.location).pathname;
  if (pedido.mode === 'navigate' && url.pathname !== raiz && url.pathname !== `${raiz}index.html`) return;
  if (pedido.mode === 'navigate') {
    evento.respondWith(
      caches.match('index.html', { cacheName: CACHE_CASCO }).then(r => r || fetch(pedido))
    );
    return;
  }

  // Demais arquivos do casco: cópia guardada desta versão; se faltar, rede.
  evento.respondWith(
    caches.match(pedido, { ignoreSearch: true, cacheName: CACHE_CASCO }).then(r => r || fetch(pedido))
  );
});

async function redePrimeiro(pedido) {
  const cache = await caches.open(CACHE_PUZZLES);
  const chave = pedido.url.split('?')[0];
  try {
    const resposta = await fetch(pedido, { cache: 'no-cache' });
    if (resposta.ok) await cache.put(chave, resposta.clone());
    return resposta;
  } catch (erro) {
    const guardada = await cache.match(chave);
    if (guardada) return guardada;
    throw erro;
  }
}
