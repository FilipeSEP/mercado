// Service worker da Lista do Mercado: guarda os arquivos do app no celular
// pra ele abrir mesmo sem internet. Os dados em si (lista) ficam no localStorage
// e no Supabase, não aqui.

// Mude esse número quando quiser forçar todo mundo a baixar tudo de novo.
const CACHE = 'mercado-v2';

const ARQUIVOS = [
  './',
  'index.html',
  'app.js',
  'styles.css',
  'supabase-config.js',
  'vendor/supabase.js',
  'manifest.json',
  'img/favicon.svg',
  'img/favicon-32.png',
  'img/icon-192.png',
  'img/icon-512.png',
  'img/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all(ARQUIVOS.map(url => cache.add(url).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(nomes => Promise.all(nomes.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function fetchComTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  // cache: 'no-cache' = sempre confere com o servidor, pra atualizações chegarem logo
  return fetch(url, { cache: 'no-cache', signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// Arquivos do próprio app: tenta a internet (até 4s); se falhar, usa o que está guardado
async function redeDepoisCache(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetchComTimeout(req.url, 4000);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const guardado = await cache.match(req, { ignoreSearch: true });
    if (guardado) return guardado;
    if (req.mode === 'navigate') {
      const pagina = (await cache.match('index.html')) || (await cache.match('./'));
      if (pagina) return pagina;
    }
    throw e;
  }
}

// Fontes do Google: usa o que está guardado e atualiza por trás
async function guardadoEAtualiza(req) {
  const cache = await caches.open(CACHE);
  const guardado = await cache.match(req);
  const buscando = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => guardado);
  return guardado || buscando;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Chamadas ao Supabase (banco/login) nunca passam pelo cache
  if (url.hostname.endsWith('.supabase.co')) return;

  if (url.origin === self.location.origin) {
    event.respondWith(redeDepoisCache(req));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(guardadoEAtualiza(req));
  }
});
