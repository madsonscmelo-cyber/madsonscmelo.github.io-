#!/usr/bin/env bash
# Checklist fase 1 — transporte e cabeçalhos no domínio publicado. Uso: bash testes/headers.sh https://dominio/caminho/app/
set -u
URL="${1:?informe a URL publicada, ex.: https://usuario.github.io/repo/app/}"
HOST=$(echo "$URL" | sed -E 's#https?://([^/]+).*#\1#')
H=$(curl -sI "$URL")
F=0
chk(){ if echo "$H" | grep -qi "$2"; then echo "✅ $1"; else echo "⚠️  $1 — cabeçalho ausente"; F=$((F+1)); fi; }
CODE=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "http://$HOST/")
case "$CODE" in 301*https*|308*https*) echo "✅ 1.1 HTTP redireciona para HTTPS ($CODE)";; *) echo "⚠️  1.1 HTTP não redireciona para HTTPS ($CODE)"; F=$((F+1));; esac
chk "1.2 HSTS" "strict-transport-security"
chk "1.3 CSP no cabeçalho (além da meta)" "content-security-policy"
if echo "$H" | grep -qiE "x-frame-options|frame-ancestors"; then echo "✅ 1.4 anti-clickjacking no cabeçalho"; else echo "⚠️  1.4 sem X-Frame-Options/frame-ancestors no cabeçalho (mitigado por código)"; F=$((F+1)); fi
chk "1.5 X-Content-Type-Options" "x-content-type-options: nosniff"
chk "1.6 Referrer-Policy" "referrer-policy"
A=$(curl -sI -H "Origin: https://site-malicioso.com" "$URL" | grep -i "access-control-allow-origin" || true)
if echo "$A" | grep -q '\*'; then echo "ℹ️  1.7 CORS '*' em arquivos estáticos públicos (sem API nem dados sensíveis neste domínio)"; else echo "✅ 1.7 CORS não aberto"; fi
echo "ℹ️  1.8 sem cookies de sessão (protótipo sem backend)"
for P in manifest.webmanifest sw.js icon-192.png icon-512.png; do
  C=$(curl -s -o /dev/null -w '%{http_code}' "${URL%/}/$P"); [ "$C" = 200 ] && echo "✅ 8.4 $P → 200" || { echo "⚠️  8.4 $P → $C"; F=$((F+1)); }
done
echo; echo "Pendências: $F"
