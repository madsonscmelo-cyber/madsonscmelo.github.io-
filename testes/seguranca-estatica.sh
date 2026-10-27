#!/usr/bin/env bash
# Checklist de segurança — itens verificáveis no código (fases 6 e 8). Uso: bash testes/seguranca-estatica.sh
set -u
cd "$(dirname "$0")/.."
FALHAS=0
ok()   { echo "✅ $1"; }
falha(){ echo "⚠️  $1"; FALHAS=$((FALHAS+1)); }

# 6.1 Segredos no código publicado
if grep -rnE 'service_role|sbp_[A-Za-z0-9]|eyJhbGciOi|sk-[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC )?PRIVATE KEY' app --exclude-dir=vendor >/dev/null; then
  falha "6.1 possível segredo em app/"; grep -rnE 'service_role|sbp_|eyJhbGciOi|sk-|AKIA|PRIVATE KEY' app --exclude-dir=vendor | head
else ok "6.1 nenhum segredo no código do app"; fi

# 6.2 .env versionado
if git ls-files | grep -E '(^|/)\.env' >/dev/null; then falha "6.2 arquivo .env versionado"; else ok "6.2 nenhum .env versionado"; fi

# 6.3 Sinks de XSS
if grep -nE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function\(' app/js/*.js >/dev/null; then
  falha "6.3 sink de XSS encontrado"; grep -nE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function\(' app/js/*.js
else ok "6.3 nenhum sink de XSS (innerHTML/eval) no app"; fi

# 1.3 CSP declarada
grep -q "Content-Security-Policy" app/index.html && ok "1.3 CSP declarada no index.html (meta)" || falha "1.3 CSP ausente"
grep -q "frame-ancestors 'none'" app/_headers && ok "1.4 frame-ancestors/X-Frame-Options prontos em app/_headers" || falha "1.4 _headers sem frame-ancestors"
grep -q "window.top !== window.self" app/js/main.js && ok "1.4 proteção anti-iframe no código (fallback p/ GitHub Pages)" || falha "1.4 sem proteção anti-iframe"

# 6.6 Dependências com CVE (Leaflet vendorizado) — consulta à base OSV
VER=$(grep -oE 'Leaflet [0-9]+\.[0-9]+\.[0-9]+' app/vendor/leaflet/leaflet.js | head -1 | cut -d' ' -f2)
if command -v curl >/dev/null; then
  R=$(curl -s --max-time 20 -X POST https://api.osv.dev/v1/query -d "{\"package\":{\"name\":\"leaflet\",\"ecosystem\":\"npm\"},\"version\":\"$VER\"}" || true)
  if [ -z "$R" ]; then echo "❓ 6.6 sem acesso à base OSV — verificar leaflet $VER manualmente";
  elif echo "$R" | grep -q '"vulns"'; then falha "6.6 leaflet $VER tem vulnerabilidade conhecida: $(echo "$R" | grep -oE '"id":"[^"]+"' | head -3 | tr '\n' ' ')";
  else ok "6.6 leaflet $VER sem vulnerabilidades conhecidas (OSV)"; fi
fi

# 6.7 Modo demo explícito e falha alta sem configuração
grep -q "throw new Error('Configuração de produção ausente" app/js/config.js && ok "6.7 sem config de produção o app não inicia" || falha "6.7 fallback silencioso para demo"

# 8.5 Compressão de fotos
grep -q "LADO_MAX = 1280" app/js/fotos.js && ok "8.5 fotos redimensionadas para ≤1280 px antes de salvar" || falha "8.5 sem compressão"

# 8.6 Sem date pickers de biblioteca
if grep -rnE 'DatePicker|datepicker' app/js >/dev/null; then falha "8.6 date picker de biblioteca"; else ok "8.6 nenhum date picker de biblioteca"; fi

# Exportação protegida contra CSV injection
grep -q "\^\[=+\\\\-@\]" app/js/util.js && ok "4.x exportação CSV neutraliza fórmulas (=,+,-,@)" || falha "4.x CSV injection"

# ---------------- Rotina UTD (rotina/) — mesmos critérios ----------------
echo; echo "== Rotina UTD =="
if grep -rnE 'service_role|sbp_[A-Za-z0-9]|eyJhbGciOi|sk-[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC )?PRIVATE KEY' rotina >/dev/null; then falha "6.1 possível segredo em rotina/"; else ok "6.1 nenhum segredo no código da rotina"; fi
if grep -nE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function\(' rotina/js/*.js >/dev/null; then
  falha "6.3 sink de XSS na rotina"; grep -nE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function\(' rotina/js/*.js
else ok "6.3 nenhum sink de XSS (innerHTML/eval) na rotina"; fi
grep -q "Content-Security-Policy" rotina/index.html && ok "1.3 CSP declarada no index.html da rotina (meta)" || falha "1.3 CSP ausente na rotina"
grep -q "frame-ancestors 'none'" rotina/_headers && ok "1.4 frame-ancestors/X-Frame-Options prontos em rotina/_headers" || falha "1.4 rotina/_headers sem frame-ancestors"
grep -q "window.top !== window.self" rotina/js/main.js && ok "1.4 proteção anti-iframe na rotina" || falha "1.4 rotina sem proteção anti-iframe"
grep -q "throw new Error('Configuração de produção ausente" rotina/js/config.js && ok "6.7 rotina: sem config de produção o app não inicia" || falha "6.7 rotina: fallback silencioso para demo"
grep -q "\^\[=+\\\\-@\]" rotina/js/util.js && ok "4.8 rotina: exportação CSV neutraliza fórmulas" || falha "4.8 rotina: CSV injection"
if grep -nE "https?://" rotina/index.html rotina/js/*.js | grep -vE "w3.org/2000/svg|exemplo|// " >/dev/null; then falha "rotina: chamada a domínio externo"; grep -nE "https?://" rotina/index.html rotina/js/*.js | grep -vE "w3.org/2000/svg|exemplo|// "; else ok "rotina: nenhum domínio externo (sem CDN, sem fonte, sem API de terceiros)"; fi

# ---------------- Central de Demandas (demandas/) — mesmos critérios ----------------
echo; echo "== Central de Demandas =="
if grep -rnE 'service_role|sbp_[A-Za-z0-9]|eyJhbGciOi|sk-[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC )?PRIVATE KEY' demandas >/dev/null; then falha "6.1 possível segredo em demandas/"; else ok "6.1 nenhum segredo no código da central de demandas"; fi
if grep -nE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function\(' demandas/js/*.js >/dev/null; then
  falha "6.3 sink de XSS na central de demandas"; grep -nE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function\(' demandas/js/*.js
else ok "6.3 nenhum sink de XSS (innerHTML/eval) na central de demandas"; fi
grep -q "Content-Security-Policy" demandas/index.html && ok "1.3 CSP declarada no index.html da central de demandas (meta)" || falha "1.3 CSP ausente na central de demandas"
grep -q "frame-ancestors 'none'" demandas/_headers && ok "1.4 frame-ancestors/X-Frame-Options prontos em demandas/_headers" || falha "1.4 demandas/_headers sem frame-ancestors"
grep -q "window.top !== window.self" demandas/js/main.js && ok "1.4 proteção anti-iframe na central de demandas" || falha "1.4 central de demandas sem proteção anti-iframe"
grep -q "throw new Error('Configuração de produção ausente" demandas/js/config.js && ok "6.7 demandas: sem config de produção o app não inicia" || falha "6.7 demandas: fallback silencioso para demo"
grep -q "\^\[=+\\\\-@\]" demandas/js/util.js && ok "4.8 demandas: exportação CSV neutraliza fórmulas" || falha "4.8 demandas: CSV injection"
grep -q "LADO_MAX = 1280" demandas/js/nova.js && ok "8.5 demandas: imagem anexada reduzida a ≤1280 px e regravada sem EXIF" || falha "8.5 demandas: imagem sem compressão"
if grep -nE "https?://" demandas/index.html demandas/js/*.js | grep -vE "w3.org/2000/svg|exemplo|// " >/dev/null; then falha "demandas: chamada a domínio externo"; grep -nE "https?://" demandas/index.html demandas/js/*.js | grep -vE "w3.org/2000/svg|exemplo|// "; else ok "demandas: nenhum domínio externo (sem CDN, sem fonte, sem API de terceiros)"; fi

# ---------------- Raio-X de Alimentadores (alimentadores/) — mesmos critérios ----------------
echo; echo "== Raio-X de Alimentadores =="
if grep -rnE 'service_role|sbp_[A-Za-z0-9]|eyJhbGciOi|sk-[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC )?PRIVATE KEY' alimentadores >/dev/null; then falha "6.1 possível segredo em alimentadores/"; else ok "6.1 nenhum segredo no código do raio-x"; fi
if grep -nE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function\(' alimentadores/js/*.js >/dev/null; then
  falha "6.3 sink de XSS no raio-x"; grep -nE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function\(' alimentadores/js/*.js
else ok "6.3 nenhum sink de XSS (innerHTML/eval) no raio-x"; fi
grep -q "Content-Security-Policy" alimentadores/index.html && ok "1.3 CSP declarada no index.html do raio-x (meta)" || falha "1.3 CSP ausente no raio-x"
grep -q "frame-ancestors 'none'" alimentadores/_headers && ok "1.4 frame-ancestors/X-Frame-Options prontos em alimentadores/_headers" || falha "1.4 alimentadores/_headers sem frame-ancestors"
grep -q "window.top !== window.self" alimentadores/js/main.js && ok "1.4 proteção anti-iframe no raio-x" || falha "1.4 raio-x sem proteção anti-iframe"
grep -q "throw new Error('Configuração de produção ausente" alimentadores/js/config.js && ok "6.7 raio-x: sem config de produção o app não inicia" || falha "6.7 raio-x: fallback silencioso para demo"
grep -q "\^\[=+\\\\-@\]" alimentadores/js/util.js && ok "4.8 raio-x: exportação CSV neutraliza fórmulas" || falha "4.8 raio-x: CSV injection"
if grep -nE "https?://" alimentadores/index.html alimentadores/js/*.js | grep -vE "w3.org/2000/svg|tile\.openstreetmap\.org|server\.arcgisonline\.com|tile\.opentopomap\.org|exemplo|// " >/dev/null; then falha "raio-x: chamada a domínio externo além dos fundos de mapa"; grep -nE "https?://" alimentadores/index.html alimentadores/js/*.js | grep -vE "w3.org/2000/svg|tile\.openstreetmap\.org|server\.arcgisonline\.com|tile\.opentopomap\.org|exemplo|// "; else ok "raio-x: nenhum domínio externo além dos fundos de mapa (OSM, Esri, OpenTopoMap; sem CDN, fonte ou API de terceiros)"; fi
if grep -nE "fetch\(|XMLHttpRequest|sendBeacon|WebSocket" alimentadores/js/*.js >/dev/null; then falha "raio-x: código que envia dados pela rede"; grep -nE "fetch\(|XMLHttpRequest|sendBeacon|WebSocket" alimentadores/js/*.js; else ok "raio-x: nenhum envio de dados pela rede (a base importada fica no aparelho)"; fi
if git ls-files alimentadores | grep -E '\.csv$' | grep -v '^alimentadores/modelos/' >/dev/null; then falha "raio-x: CSV versionado fora de modelos/ (base real no repositório?)"; else ok "raio-x: nenhum CSV de base versionado fora de modelos/"; fi

echo; [ $FALHAS -eq 0 ] && echo "Resultado: 0 pendências estáticas" || echo "Resultado: $FALHAS pendência(s)"
exit $FALHAS
