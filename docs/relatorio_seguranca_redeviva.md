# Relatório de segurança e testes — RedeViva (protótipo Fase 0)

**Data:** 25/10/2026 · **Base:** Checklist Universal de Segurança v1.0 (+ itens v1.1 deste repositório) · **Versão testada:** branch `docs/especificacao-plataforma-manutencao`

> **Conclusão:** o protótipo está **apto para demonstração pública com dados sintéticos** e **não apto para produção**.
> As fases 2, 3 (servidor), 4, 5 e 7 não existem neste protótipo porque ele não tem backend. Cada uma delas **bloqueia** a entrada em produção até ser implementada e testada por API direta.

Legenda: ✅ passou com evidência · ⚠️ problema · ❓ verificar fora do código · ℹ️ não se aplica nesta fase · 🔒 bloqueia produção

---

## Fase 0 — Mapeamento

| Item | Situação atual |
|---|---|
| Stack | HTML + JavaScript (módulos ES) sem framework nem build; Leaflet 1.9.4 (vendorizado); PWA com service worker |
| Banco | IndexedDB **no aparelho** (dados sintéticos). Sem banco no servidor |
| Autenticação | Nenhuma real: o usuário escolhe um perfil de demonstração |
| Hospedagem | Estática (GitHub Pages ou Cloudflare Pages/Netlify — ver "Publicação") |
| Superfície de entrada | Importação de CSV, upload de fotos, formulários de inspeção/defeito/execução, busca por código. Nenhum endpoint, RPC ou webhook |

## Resultados

### Fase 1 — Transporte e cabeçalhos (depende da hospedagem)

| # | Resultado | Evidência / ação |
|---|---|---|
| 1.1 HTTPS forçado | ❓ | GitHub Pages e Cloudflare forçam HTTPS (ativar "Enforce HTTPS"). Verificar com `bash testes/headers.sh <url>` após publicar |
| 1.2 HSTS | ❓ | github.io envia HSTS; Cloudflare/Netlify via `app/_headers` |
| 1.3 CSP | ✅ | CSP restritiva no `index.html` (meta) e no `app/_headers`. Sem `unsafe-inline` nem `unsafe-eval` |
| 1.4 Anti-clickjacking | ✅ mitigado | GitHub Pages **não permite** X-Frame-Options; o app se recusa a rodar dentro de iframe (teste e2e `1.4`). Em Cloudflare/Netlify, `_headers` aplica `frame-ancestors 'none'` + `DENY` |
| 1.5 nosniff | ❓ | `_headers`; conferir após publicar |
| 1.6 Referrer-Policy | ✅ | meta `strict-origin-when-cross-origin` + `_headers` |
| 1.7 CORS | ℹ️ | Sem API. Arquivos estáticos públicos |
| 1.8 Cookies | ℹ️ | Não usa cookies |

### Fase 2 — Autenticação e sessão 🔒
ℹ️ Não implementada (escolha de perfil). **Produção:** SSO corporativo (OIDC) com MFA; refazer 2.1–2.10, em especial **2.9** (hoje o perfil vem da lista local — aceitável só em demo).

### Fase 3 — Autorização
| # | Resultado | Evidência |
|---|---|---|
| 3.4 Escopo do usuário comum | ✅ (cliente) | Equipe não vê Plano/Painel; filtro "minha equipe" |
| 3.6 / 3.7 / 3.9 Ações proibidas por chamada direta | ✅ (cliente) | Chamando os módulos direto no navegador como equipe de poda: autovalidar, executar defeito de outra equipe, atribuir inspeção e concluir inspeção sem foto → **todos bloqueados** (teste e2e `3.6/3.7/3.9`) |
| 3.1–3.3, 3.5, 3.8, 3.10–3.13 | 🔒 ℹ️ | Sem servidor. **Produção:** a mesma máquina de estados (`app/js/dominio.js` + `acoes.js`) precisa ser reimplementada no banco (RPC com SECURITY DEFINER e RLS por território) e testada com o token do perfil mais fraco |

> Pela regra de ouro do checklist, as travas no cliente **não contam** para produção — elas existem para a experiência de uso e para documentar as regras que o servidor deverá impor.

### Fase 4 — Validação e integridade
| # | Resultado | Evidência |
|---|---|---|
| 4.1–4.4 (cliente) | ✅ | Importação recusa coordenada fora da área, valor negativo, data futura, critério incompatível, duplicidade (e2e `E2E-1`); textos com `maxlength` |
| 4.5 Payload | ✅ | CSV ≤ 5 MB e ≤ 20.000 linhas |
| Injeção em CSV exportado | ✅ | Células iniciadas por `= + - @` são neutralizadas |
| 4.1–4.7 no banco | 🔒 | Repetir com CHECK constraints no servidor |

### Fase 5 — Uploads
| # | Resultado | Evidência |
|---|---|---|
| Whitelist de tipo e tamanho (cliente) | ✅ | Só JPEG/PNG/WebP/HEIC ≤ 25 MB; foto recodificada (EXIF descartado), ≤ 1280 px, hash SHA-256 |
| 5.1–5.6 no servidor | 🔒 | Bucket privado, URL assinada ≤ 5 min, path vinculado ao recurso, sem UPDATE/DELETE pelo cliente |

### Fase 6 — Front-end
| # | Resultado | Evidência |
|---|---|---|
| 6.1 Segredos no código | ✅ | `testes/seguranca-estatica.sh` |
| 6.2 Segredos no Git | ✅ | Nenhum `.env`; gitleaks no CI |
| 6.3 XSS | ✅ | Zero `innerHTML`/`eval`; interface montada só com `textContent`; Semgrep (OWASP Top 10): 0 achados |
| 6.4 CSRF | ℹ️ | Sem chamadas autenticadas |
| 6.5 Erros sem detalhes | ✅ | Mensagens genéricas ao usuário; detalhe só no console |
| 6.6 Dependências | ✅ | Leaflet 1.9.4: nenhuma vulnerabilidade na base OSV |
| 6.7 Modo demo isolado | ✅ | `app/js/config.js`: fora do modo demo, sem `apiUrl` o app **não inicia** |

### Fase 7 — Infra e operação 🔒
ℹ️ Sem infraestrutura de backend. Produção: backups com restore testado, criptografia em repouso, monitoramento, auditoria imutável no servidor (hoje a trilha existe, mas fica no aparelho).

### Fase 8 — Mobile/PWA
| # | Resultado | Evidência |
|---|---|---|
| 8.1 360 px sem estouro | ✅ | 12 telas medidas (`scrollWidth` = 360) |
| 8.2 Alvos ≥ 48 px | ✅ | Medição automática de todos os botões, campos, selects e resumos visíveis |
| 8.3 Offline: fila + sync | ✅ | Fila local → sincroniza ao reconectar; app abre com rede cortada |
| 8.4 PWA instalável | ✅ local / ❓ domínio final | manifest, sw.js e ícones → 200 |
| 8.5 Fotos comprimidas | ✅ | ≤ 1280 px, JPEG 72% |
| 8.6 Date picker nativo | ℹ️ | Sem campos de data no app de campo |
| 8.9 Botão voltar | ✅ | Fecha o painel sem sair do app (e2e `8.9`) |
| Pacote offline por alimentador | ✅ | Recorte de 26 KB + mapa do corredor; abre sem internet; fotos retidas em rede móvel (e2e `OFF-1` a `OFF-4`) |

### Fase 9 (nova, v1.1) — Dados no aparelho e privacidade
| # | Resultado | Evidência / ação |
|---|---|---|
| 9.1 Dado local some ao trocar de usuário | ⚠️ | Hoje os dados ficam no IndexedDB para todos os perfis (é demo). Produção: dados por usuário + limpeza no logout + remote wipe (MDM) |
| 9.2 Localização só em uso | ✅ | GPS só liga com toque do usuário; não há rastreamento em segundo plano |
| 9.3 Metadados de foto | ✅ | EXIF original descartado; só os campos controlados pelo app (data, coordenada, equipe) vão na marca d'água |
| 9.4 Cache do service worker | ✅ | Só arquivos do app e quadros de mapa; o recorte de dados do pacote fica no IndexedDB, não no Cache Storage |

## Como reexecutar

```bash
bash testes/seguranca-estatica.sh                 # fases 1.3/1.4, 6 e 8 (estático)
cd testes && npm install && npx playwright install chromium && npm run e2e   # 22 verificações ponta a ponta
bash testes/headers.sh https://SEU-DOMINIO/app/   # fase 1, após publicar
```

O pipeline `.github/workflows/seguranca-app.yml` roda gitleaks, Semgrep e a checagem de padrões inseguros a cada push.

## Critérios de pronto

| Critério | Demo | Produção |
|---|---|---|
| Fases 1–9 com evidência | ✅ (fase 1 após publicar) | 🔒 fases 2, 3, 4, 5, 7 e 9.1 |
| 0 críticos / 0 altos abertos | ✅ no escopo do protótipo | 🔒 |
| Login E2E no domínio final | ℹ️ | 🔒 |
