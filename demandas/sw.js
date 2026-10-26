// Service worker: app shell em network-first (pega atualização quando há rede; abre sem rede pelo cache).
// Só arquivos do app vão para o Cache Storage: nenhum dado de negócio (esses ficam no IndexedDB). Checklist 9.4.
const VERSAO = 'demandas-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'css/app.css',
  'js/compat.js', 'js/main.js', 'js/util.js', 'js/store.js', 'js/seed.js', 'js/dominio.js', 'js/interpretador.js', 'js/acoes.js', 'js/ui.js',
  'js/agenda.js', 'js/nova.js', 'js/rituais.js', 'js/painel.js', 'js/config.js', 'js/auth.js', 'js/auditoria.js', 'js/acesso.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('demandas-') && k !== VERSAO).map((k) => caches.delete(k))))
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
