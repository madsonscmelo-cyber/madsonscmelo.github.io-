// Servidor estático mínimo para os testes (sem dependências).
const http = require('http');
const fs = require('fs');
const path = require('path');

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.csv': 'text/csv; charset=utf-8' };

function iniciar(raiz, porta = 0) {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let arq = path.normalize(path.join(raiz, url));
      if (!arq.startsWith(raiz)) { resp.writeHead(403).end(); return; }
      if (fs.existsSync(arq) && fs.statSync(arq).isDirectory()) arq = path.join(arq, 'index.html');
      fs.readFile(arq, (err, buf) => {
        if (err) { resp.writeHead(404).end('404'); return; }
        resp.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream' }).end(buf);
      });
    });
    srv.listen(porta, '127.0.0.1', () => res(srv));
  });
}
module.exports = { iniciar };
