// Service worker: app shell em network-first (pega atualização quando há rede) e tiles em cache-first.
const VERSAO = 'redeviva-v6';
const TILES = 'redeviva-tiles';
const PACOTES = 'redeviva-pacotes'; // mapas dos pacotes offline: nunca aparados automaticamente
const MAX_TILES = 1500;
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'css/app.css',
  'vendor/leaflet/leaflet.css', 'vendor/leaflet/leaflet.js',
  'js/main.js', 'js/util.js', 'js/store.js', 'js/seed.js', 'js/dominio.js', 'js/mapa.js', 'js/ui.js', 'js/telas.js', 'js/acoes.js', 'js/fotos.js', 'js/offline.js', 'js/config.js', 'js/auth.js', 'js/auditoria.js', 'js/acesso.js', 'js/parametros.js', 'js/parametros-ui.js', 'js/custos.js', 'js/programacao.js', 'js/rede.js', 'js/planos.js', 'js/trilha.js', 'js/eficacia.js',
  'modelos/template-plano.csv', 'modelos/exemplo-plano-com-erros.csv', 'modelos/template-caderno.csv', 'modelos/template-ocorrencias.csv', 'modelos/exemplo-voo-drone-ALM-07-T03.kml',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => ![VERSAO, TILES, PACOTES].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function aparar(cache) {
  const ks = await cache.keys();
  for (let i = 0; i < ks.length - MAX_TILES; i++) await cache.delete(ks[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await caches.match(req.url); // procura no cache geral e nos pacotes
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok) { c.put(req.url, r.clone()); aparar(c); }
      return r;
    }).catch(() => new Response('', { status: 504 })));
    return;
  }
  if (url.origin !== self.location.origin) return;
  e.respondWith(fetch(req).then((r) => {
    if (r.ok) { const cp = r.clone(); caches.open(VERSAO).then((c) => c.put(req, cp)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
});
