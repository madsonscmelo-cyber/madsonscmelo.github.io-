// Service worker: app shell em network-first (pega atualização quando há rede; abre sem rede pelo cache).
// Só arquivos do app vão para o Cache Storage: a base da rede (inclusive a importada) fica no IndexedDB, nunca no cache.
// Tiles do OpenStreetMap não são interceptados (origem externa).
const VERSAO = 'raiox-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'css/app.css',
  '../app/vendor/leaflet/leaflet.js', '../app/vendor/leaflet/leaflet.css',
  'js/compat.js', 'js/main.js', 'js/util.js', 'js/store.js', 'js/seed.js', 'js/dominio.js', 'js/importar.js', 'js/ui.js',
  'js/carteira.js', 'js/mapa.js', 'js/prioridades.js', 'js/dados.js', 'js/config.js', 'js/auth.js', 'js/auditoria.js', 'js/acesso.js',
  'modelos/postes.csv', 'modelos/ocorrencias.csv', 'modelos/compensacoes.csv',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('raiox-') && k !== VERSAO).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(fetch(req).then((r) => {
    if (r.ok) { const cp = r.clone(); caches.open(VERSAO).then((c) => c.put(req, cp)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
});
