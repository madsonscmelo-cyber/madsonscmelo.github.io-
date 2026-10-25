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

echo; [ $FALHAS -eq 0 ] && echo "Resultado: 0 pendências estáticas" || echo "Resultado: $FALHAS pendência(s)"
exit $FALHAS
