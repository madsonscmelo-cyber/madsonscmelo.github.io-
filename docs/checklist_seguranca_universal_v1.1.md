# 🛡️ CHECKLIST UNIVERSAL DE SEGURANÇA E TESTES
### Lista completa para rodar em QUALQUER aplicação (web/mobile + Supabase ou backend equivalente)
**Versão 1.1 — 25/10/2026 · v1.0 (lições do Campo+) + lições do RedeViva (PWA offline-first, hospedagem estática, mapa e fotos de campo)**

> **Novidades da v1.1:** itens 1.9, 4.8, 5.7, 6.8, 6.9, 8.7–8.9, Fase 9 inteira e armadilhas 9–12. Tudo marcado com 🆕.

> **Como usar:** copie esta lista para cada app novo. Execute os testes na ordem.
> Marque cada item com ✅ (passou, com evidência) / ⚠️ (problema) / ❓ (verificar fora) / ℹ️ (não se aplica).
> **Regra de ouro:** regra validada só pela interface não vale — prove cada trava **por API direta** com o token do perfil mais fraco.

---

## FASE 0 — MAPEAMENTO (preencher antes de testar)
- [ ] Stack (framework, versões, libs principais)
- [ ] Banco de dados (host, schema, nº de tabelas, quem acessa)
- [ ] Autenticação (provedor, fluxo de login, onde a sessão vive)
- [ ] Hospedagem (front, back, domínios, staging vs produção)
- [ ] **Superfície de entrada:** todos os endpoints, formulários, uploads, RPCs e webhooks que recebem dados

---

## FASE 1 — TRANSPORTE E CABEÇALHOS

| # | Teste | Como executar | Passa quando |
|---|---|---|---|
| 1.1 | HTTPS forçado | `curl -sI http://DOMINIO` | 301/308 → https |
| 1.2 | HSTS presente | `curl -sI https://DOMINIO \| grep -i strict-transport` | header presente |
| 1.3 | CSP | idem \| grep -i content-security | header presente com default-src 'self' |
| 1.4 | X-Frame-Options / frame-ancestors | idem | DENY/SAMEORIGIN ou frame-ancestors 'none' |
| 1.5 | X-Content-Type-Options | idem | nosniff |
| 1.6 | Referrer-Policy | idem | strict-origin-when-cross-origin (ou mais restrito) |
| 1.7 | CORS restrito | `curl -sI -H "Origin: https://site-malicioso.com" ENDPOINT` | não devolve `access-control-allow-origin: *` para origem estranha |
| 1.8 | Cookies (se usar sessão em cookie) | inspecionar Set-Cookie | HttpOnly + Secure + SameSite=Lax/Strict |
| 1.9 🆕 | Hospedagem estática sem cabeçalhos (ex.: GitHub Pages) | `curl -sI` + tentar abrir o app num `<iframe>` | ou cabeçalhos via `_headers`/config do host, ou o app se recusa a rodar em iframe e a CSP vem por `<meta>` |

## FASE 2 — AUTENTICAÇÃO E SESSÃO

| # | Teste | Como executar | Passa quando |
|---|---|---|---|
| 2.1 | Login válido | fluxo real (browser, não só curl) | sessão criada + redireciona |
| 2.2 | Senha errada | credencial inválida | mensagem ÚNICA, sem revelar se usuário existe |
| 2.3 | Rate limit no login | 6+ tentativas seguidas | 429 a partir do limite (5/15min é bom padrão) |
| 2.4 | Rate limit por IP e por conta | variar conta com mesmo IP / vice-versa | ambos bloqueiam |
| 2.5 | Hash de senha | ver banco/coluna | bcrypt/scrypt/Argon2 — nunca texto puro |
| 2.6 | Logout invalida no servidor | chamar API com token pós-logout | 401 |
| 2.7 | Expiração de sessão | aguardar TTL / conferir config | access curto (≤1h), refresh com rotação |
| 2.8 | Troca/reset de senha | fluxo "esqueci minha senha" | existe + invalida sessões antigas |
| 2.9 | Origem do perfil/role | inspecionar código do front | lido do BANCO via sessão — nunca localStorage/user_metadata |
| 2.10 | Papel relido ao voltar o foco | revogar papel em outro device | app aplica a revogação |

## FASE 3 — AUTORIZAÇÃO (o coração)

| # | Teste | Como executar | Passa quando |
|---|---|---|---|
| 3.1 | RLS/escopo em TODAS as tabelas de usuário | listar tabelas × policies | 100% com RLS; 0 policies `using (true)` |
| 3.2 | Policies com `to authenticated` explícito | ler SQL das policies | nenhuma aplica a anon |
| 3.3 | Segregação por unidade/grupo (UTD/tenant) | 2 usuários de grupos diferentes via API | zero sobreposição de dados |
| 3.4 | Escopo do usuário comum | listar recursos com JWT comum | só os dele |
| 3.5 | Escopo do gerente/admin | listar com JWT admin | vê tudo (e só admin vê audit_log) |
| 3.6 | **UPDATE direto via REST** | PATCH no recurso com JWT comum | bloqueado (RLS/trigger) — **reler o registro após 204** (PostgREST 204 = também "0 linhas") |
| 3.7 | **Autoaprovação** | criador decide sobre o próprio pedido via RPC/API | 400 no banco |
| 3.8 | **Valor acima do teto/aprovado** | enviar valor inflado | 400 no banco |
| 3.9 | **Ação sem justificativa obrigatória** | recusar/devolver com texto vazio | 400 no banco |
| 3.10 | Regras de negócio no BANCO | ler código: máquina de estados em RPC SECURITY DEFINER (search_path fixo) | front só esconde botão |
| 3.11 | Agregações segregadas | RPC de dashboard com usuário de um grupo | só dados do grupo dele |
| 3.12 | RPCs auxiliares revogadas | `grant execute` list | auxiliares só pela RPC principal |
| 3.13 | PII restrita | listar cadastro de pessoas com usuário comum | só própria/unidade — nunca diretório aberto |

## FASE 4 — VALIDAÇÃO E INTEGRIDADE

| # | Teste | Como executar | Passa quando |
|---|---|---|---|
| 4.1 | Valores negativos/zero | POST com -1 / 0 nos campos numéricos | 400/CHECK no banco |
| 4.2 | Teto de valor | POST acima do limite | 400 |
| 4.3 | Comprimento de textos | POST com 10.000 chars | 400 (CHECK) |
| 4.4 | Campos obrigatórios do tipo | POST sem campo obrigatório declarado | 400 no banco (não só no front) |
| 4.5 | jsonb/payload gigante | POST > 16 KB | 400 |
| 4.6 | Queries parametrizadas | grep por concatenação SQL / `format()` com input | 0 ocorrências; PostgREST/ORM |
| 4.7 | SQL dinâmico seguro | revisar `format()`/executes | só com %I/%L sobre listas fixas |
| 4.8 🆕 | Injeção em CSV/Excel exportado | exportar registro com texto `=HYPERLINK(...)` | célula sai neutralizada (prefixo `'`) |

## FASE 5 — UPLOADS E ARQUIVOS

| # | Teste | Como executar | Passa quando |
|---|---|---|---|
| 5.1 | Limite de tamanho no SERVIDOR | upload de 50 MB | recusado pela política/banco (não só no front) |
| 5.2 | Whitelist de MIME | upload de .html/.exe renomeado | recusado |
| 5.3 | Bucket privado | GET direto na URL do arquivo | 403 sem assinatura |
| 5.4 | Download só assinado e curto | conferir geração de URL | signed URL com TTL ≤ 5 min |
| 5.5 | Path vinculado ao recurso | upload para pasta de outro recurso | recusado pela política |
| 5.6 | Sem UPDATE/DELETE de arquivo pelo cliente | tentar sobrescrever | sem policy → negado |
| 5.7 🆕 | Metadados de imagem (EXIF/GPS do aparelho) | baixar a foto armazenada e ler o EXIF | EXIF removido; localização só nos campos controlados pelo sistema |

## FASE 6 — FRONT-END

| # | Teste | Como executar | Passa quando |
|---|---|---|---|
| 6.1 | Segredos no bundle | grep `service_role\|sbp_\|eyJhbGciOi\|sk-` em dist/ | 0 ocorrências |
| 6.2 | Segredos no Git | histórico + `git ls-files \| grep .env` | .env fora; secret scanning limpo |
| 6.3 | XSS (sinks) | grep `dangerouslySetInnerHTML\|innerHTML\|eval(` | 0; framework escapa por padrão |
| 6.4 | CSRF | verificar como as chamadas autenticam | Bearer token explícito (imune) ou token anti-CSRF |
| 6.5 | Erros sem detalhes internos | provocar erro de constraint | mensagem amigável, sem stack/query/tabela |
| 6.6 | Dependências sem CVE | `npm audit` | 0 critical/high em RUNTIME (dev-only documentados) |
| 6.7 | Modo demo isolado | build sem config | falha alto — nunca cai em demo silenciosamente |
| 6.8 🆕 | Sem HTML montado com dado do usuário | grep `innerHTML\|insertAdjacentHTML\|document.write` + Semgrep OWASP | 0 ocorrências; UI via `textContent`/framework |
| 6.9 🆕 | Regra testada chamando o módulo/API, não o botão | no console do navegador, chamar a função proibida com o perfil fraco | erro de permissão (e, em produção, 403/400 do servidor) |

## FASE 7 — INFRA E OPERAÇÃO

| # | Teste | Como executar | Passa quando |
|---|---|---|---|
| 7.1 | Backups automáticos | painel do provedor | snapshots recentes + **1 restore testado** |
| 7.2 | Criptografia at rest | painel do provedor | AES-256 ou equivalente |
| 7.3 | Monitoramento | checar APM/alertas | erros JS + logins bloqueados geram alerta |
| 7.4 | Logs de auditoria | tabela audit/history | imutável p/ clientes, visível só a admin |
| 7.5 | Security Advisor / linter do provedor | Dashboard (Supabase/Netlify/etc.) | 0 críticos |
| 7.6 | Rate limit em endpoints caros | bater criação/upload em volume | limitado ou custo controlado |
| 7.7 | CORS/headers dos endpoints serverless | curl na Function | OPTIONS responde; allowlist de origem |

## FASE 8 — MOBILE/PWA (se aplicável)

| # | Teste | Como executar | Passa quando |
|---|---|---|---|
| 8.1 | Viewport 360px sem estouro | browser 360×740 nas telas principais | layout íntegro |
| 8.2 | Alvos de toque | inspecionar CSS | botões/inputs ≥ 48px |
| 8.3 | Offline: fila local + sync | criar sem sinal → reconectar | pedido sincroniza sozinho |
| 8.4 | PWA instalável | manifest + SW + ícones | todos 200 no domínio final |
| 8.5 | Anexos comprimidos | foto grande no upload | comprimida antes (≤ ~1280px) |
| 8.6 | DatePicker nativo | testar campo de data | `<input type="date">` (openui DatePicker não opera via automação) |
| 8.7 🆕 | App abre sem rede | carregar, cortar a rede, recarregar | telas principais abrem pelo service worker |
| 8.8 🆕 | Medição automática de alvos | script mede altura de botões/campos visíveis em cada tela | 0 controles < 48 px |
| 8.9 🆕 | Botão voltar do celular | abrir painel/modal e apertar voltar | fecha o painel, não sai do app |

## 🆕 FASE 9 — DADOS NO APARELHO E PRIVACIDADE (apps offline-first)

| # | Teste | Como executar | Passa quando |
|---|---|---|---|
| 9.1 | Dados locais por usuário | logar A, criar dados, trocar para B | B não vê dados de A; logout limpa IndexedDB/cache de A |
| 9.2 | Remote wipe | política MDM / comando do servidor | dados locais apagados em aparelho perdido |
| 9.3 | Geolocalização só em uso | revisar código e permissões do app | sem rastreamento em segundo plano fora do turno; finalidade informada (LGPD) |
| 9.4 | Cache do service worker | listar Cache Storage | só arquivos do app/mapa; nenhum dado de negócio ou resposta autenticada |
| 9.5 | Fila offline íntegra | criar sem sinal, fechar o app, reabrir, reconectar | nada perdido nem duplicado |
| 9.6 | Conflito de sincronização | editar o mesmo registro em 2 aparelhos offline | servidor decide e registra; nada é sobrescrito em silêncio |

---

## PONTOS DE VERIFICAÇÃO FORA DO CÓDIGO (onde olhar)
| O quê | Onde conferir |
|---|---|
| Backups + restore | Painel do provedor → Database → Backups |
| Criptografia at rest | Painel → Settings → Infrastructure |
| Secret scanning do Git | GitHub → Security → Secret scanning |
| Security Advisor | Supabase Dashboard → Security Advisor |
| TTL de sessão/refresh | Supabase Dashboard → Auth → Sessions |
| Rate limit da plataforma | Painel do provedor (se houver) |

---

## CRITÉRIOS DE PRONTO
- [ ] Fases 1–8 executadas, cada item com evidência anotada
- [ ] 0 críticos e 0 altos abertos
- [ ] Médios com plano aprovado ou corrigidos
- [ ] Login E2E no navegador OK no domínio final
- [ ] Relatório salvo em artifacts/relatorio_seguranca_{APP}.md

## ARMADILHAS QUE JÁ NOS PEGARAM (não repita)
1. **PostgREST 204 ≠ sucesso** — pode ser "0 linhas afetadas"; sempre reler o registro.
2. **Seed não dispara triggers** — testar notificação/histórico com transição real.
3. **Usuário criado por SQL direto em auth.users não loga** — criar via Admin API (GoTrue exige identities).
4. **Rate limit testado com limpeza no meio** — não limpar a tabela de tentativas durante o teste.
5. **CORS: curl funciona, browser não** — testar login E2E no navegador.
6. **Grants interdependentes quebram deploy SQL** — ordem: tabelas → RPCs → funções/RLS → grants.
7. **Trigger de auditoria explode em DELETE** — `new.id` não existe; tratar com record único.
8. **DatePicker openui inoperante em automação** — usar input nativo.
9. 🆕 **GitHub Pages não envia X-Frame-Options nem CSP própria** — CSP por `<meta>` não cobre `frame-ancestors`; bloquear iframe no código ou usar host com `_headers`.
10. 🆕 **Debounce na gravação local perde dado de campo** — gravar no IndexedDB a cada ação, não "daqui a pouco".
11. 🆕 **Menu do topo atrás do painel** — conferir z-index de cabeçalho × bottom sheet em todo perfil.
12. 🆕 **Base OSV vazia ≠ pacote auditado** — validar a consulta com um pacote sabidamente vulnerável antes de confiar no "0 achados".