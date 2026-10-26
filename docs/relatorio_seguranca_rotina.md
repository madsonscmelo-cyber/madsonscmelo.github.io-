# Relatório de segurança, usabilidade e testes — Rotina UTD (protótipo Fase 0)

**Data:** 26/10/2026 · **Base:** Checklist Universal de Segurança v1.1 (`docs/checklist_seguranca_universal_v1.1.md`) e Guia das 7 leis (`docs/guia_usabilidade_redeviva.md`) · **Branch:** `rotina-retaguarda`

> **Conclusão:** o protótipo está **apto para demonstração e piloto de forma, com dados sintéticos**, e **não apto para produção**. Ele tem o mesmo nível do RedeViva: as travas existem e foram provadas chamando os módulos direto no navegador, mas rodam no aparelho. As fases 2, 3, 4, 5 e 7 **no servidor** bloqueiam a produção até existir backend.
> O catálogo real não está no repositório. Ele foi importado num teste fora do Git: 240 de 240 linhas aceitas.

Legenda: ✅ passou com evidência · ⚠️ problema · ❓ verificar fora do código · ℹ️ não se aplica nesta fase · 🔒 bloqueia produção

---

## Fase 0 — Mapeamento

| Item | Situação atual |
|---|---|
| Stack | HTML + JavaScript (módulos ES), sem framework, sem build e sem dependência externa em tempo de execução (nem CDN, nem fonte web). PWA com service worker |
| Banco | IndexedDB no aparelho (`rotina-utd`): dados no store `kv`, log só de inclusão no store `logs` |
| Autenticação | Local: matrícula + senha (PBKDF2), igual ao RedeViva |
| Hospedagem | Estática (GitHub Pages; `_headers` pronto para Cloudflare Pages/Netlify) |
| Superfície de entrada | Login; evidência de conclusão; formulários de remanejamento, recusa, sob demanda, catálogo, aceite, regras e ocupação; importação de CSV. Nenhum endpoint, RPC ou webhook |

## Resultados

### Fase 1 — Transporte e cabeçalhos
| # | Resultado | Evidência |
|---|---|---|
| 1.3 CSP | ✅ via meta | `default-src 'self'`, sem `unsafe-inline` e sem domínio externo (mais restrita que a do RedeViva, que libera o servidor de mapas). O e2e confirmou que a CSP recusa script injetado |
| 1.4 Anti-clickjacking | ✅ | O app se recusa a rodar em iframe (e2e `1.4`); `frame-ancestors 'none'` + `X-Frame-Options: DENY` em `rotina/_headers` |
| 1.1, 1.2, 1.5, 1.6 no domínio | ❓ | Rodar `bash testes/headers.sh https://…/rotina/` depois de publicar. No GitHub Pages valem as mesmas 4 limitações já registradas para o RedeViva |
| Permissions-Policy | ✅ | Câmera e localização **desligadas** (`geolocation=()`, `camera=()`): o app não usa nenhuma das duas |

### Fase 2 — Autenticação e sessão (login local)
| # | Resultado | Evidência (e2e) |
|---|---|---|
| 2.1 / 2.8 | ✅ | Primeiro acesso obriga criar senha pessoal; senha contendo o nome é recusada |
| 2.2 | ✅ | Matrícula inexistente e senha errada → a mesma mensagem: "Matrícula ou senha inválidas." |
| 2.3 | ✅ | 5 erros bloqueiam a matrícula por 15 min (nem a senha certa entra) |
| 2.5 | ✅ | PBKDF2-SHA-256 com 210.000 iterações e sal por usuário (mesmo `auth.js` do RedeViva) |
| 2.7 | ✅ | 20 min sem uso bloqueiam a tela e pedem a senha; sessão máxima de 10 h |
| 2.10 | ✅ | Usuário bloqueado pelo gestor é derrubado ao voltar ao app |
| 2.9 | ⚠️ demo · 🔒 | O perfil vem da base local. Em produção: do servidor/AD via SSO |

### Fase 3 — Autorização (regras provadas chamando os módulos, não só o botão)
| # | Resultado | Evidência (e2e) |
|---|---|---|
| 3.3 Segregação por UTD | ✅ cliente | O supervisor de Jacobina, chamando `decidirPedido` direto num pedido de Juazeiro, recebe "Pedido de outra UTD."; a tabela dele não mostra pessoas de Juazeiro |
| 3.4 Escopo da retaguarda | ✅ cliente | Concluir ou remanejar atividade de outra pessoa, decidir pedido, editar catálogo e alterar ocupação → **todos bloqueados** (e2e `3.6/6.9`) |
| 3.7 Autoaprovação | ✅ cliente | O supervisor pede remanejamento e tenta aprovar → "Ninguém aprova o próprio pedido: ele vai para a gerência." A gerência decide (e2e `3.7b`) |
| 3.9 Ação sem justificativa | ✅ cliente | Concluir sem evidência, remanejar sem motivo, recusar sem justificativa, alterar o catálogo sem motivo e aceite sem registro → recusados |
| Integridade histórica | ✅ cliente | Catálogo com vigência: alteração com data no passado é recusada; a versão de 10 dias atrás continua valendo para aquele período (e2e `CAT-1`) |
| 3.1–3.13 no servidor | 🔒 | Sem backend. Produção: reimplementar `js/acoes.js` como funções no banco (SECURITY DEFINER) com RLS por UTD e testar com o token do perfil mais fraco |

### Fase 4 — Validação e integridade
| # | Resultado | Evidência |
|---|---|---|
| 4.1–4.4 (cliente) | ✅ | Importação recusa cargo inválido, semanal sem dia da semana, duração > 480 min e código repetido: 4 aceitas e 4 rejeitadas (e2e `CAT-2`). Textos com limite de tamanho |
| 4.5 Payload | ✅ | CSV ≤ 2 MB e ≤ 2.000 linhas |
| 4.8 Injeção em CSV exportado | ✅ | Atividade importada com nome `@SUM(A1)…` sai como `'@SUM(A1)…` |
| 4.x no banco | 🔒 | Repetir com CHECK constraints no servidor |

### Fase 5 — Uploads
ℹ️ O app não recebe arquivos de imagem. A evidência é texto. O único arquivo aceito é o CSV do catálogo (tamanho, linhas e colunas validados). Se a evidência passar a ter anexo, aplicar a fase 5 inteira.

### Fase 6 — Front-end
| # | Resultado | Evidência |
|---|---|---|
| 6.1 / 6.2 Segredos | ✅ | `testes/seguranca-estatica.sh` + gitleaks no CI |
| 6.3 / 6.8 XSS | ✅ | Zero `innerHTML`/`eval`; interface só com `textContent`; CI bloqueia esses padrões em `rotina/` |
| 6.5 Erros sem detalhe interno | ✅ | Mensagem genérica ao usuário; detalhe só no console |
| 6.6 Dependências | ✅ | Nenhuma biblioteca em tempo de execução |
| 6.7 Modo demo isolado | ✅ | Sem `apiUrl` fora do modo demo, o app não inicia |
| 6.9 Regra testada no módulo | ✅ | Ver fase 3 |
| Console | ✅ | Sem erro de JavaScript nem violação de CSP em todo o roteiro |

### Fase 7 — Infra 🔒
ℹ️ Sem backend. Produção: backup com restore testado, criptografia em repouso, monitoramento e log oficial em servidor só de inclusão.

### Fase 8 — Mobile/PWA
| # | Resultado | Evidência |
|---|---|---|
| 8.1 360 px | ✅ | 15 telas sem rolagem horizontal |
| 8.2 Alvos ≥ 48 px | ✅ | Medição automática de todos os controles visíveis |
| 8.3 Fila offline | ✅ | O registro fica na fila sem rede e sobe ao reconectar |
| 8.7 Abre sem rede | ✅ | Login exibido com a rede cortada (service worker) |
| 8.9 Voltar do celular | ✅ | Fecha o painel sem sair do app |
| Acessibilidade | ✅ | axe-core (WCAG 2.1 A/AA): 0 violações em 15 telas |

### Fase 9 — Dados no aparelho e privacidade
| # | Resultado | Evidência |
|---|---|---|
| 9.1 Dados por usuário | ⚠️ demo · 🔒 | Como no RedeViva, os dados de demonstração ficam no IndexedDB do aparelho para todos os perfis. O estado de tela (aba, filtros) já é reiniciado ao trocar de usuário |
| 9.3 Localização | ✅ | O app não usa GPS nem câmera (bloqueados no `_headers`) |
| 9.4 Cache do service worker | ✅ | 25 arquivos no Cache Storage, todos do app; nenhum dado de negócio |

### Logs de auditoria
| # | Resultado | Evidência |
|---|---|---|
| LOG-1 Cobertura | ✅ | Login, troca e recusa de senha, telas, atividades consultadas, conclusões, remanejamentos, pedidos, aprovações, recusas, negações, catálogo, importação, exportação, aceite, regras e ocupação: 25 tipos de ação no roteiro |
| LOG-2 Sem senha | ✅ | Varredura do log inteiro |
| LOG-3 Integridade | ✅ | Cadeia SHA-256 íntegra; alterar o registro 3 é detectado |
| LOG-5 Cópia oficial | 🔒 | Como no RedeViva: o log no aparelho pode ser apagado por quem controla o navegador |

## Usabilidade — verificações automáticas

| Lei | Teste | Resultado |
|---|---|---|
| Fitts | `HOJE-1`, `8.2` | ✅ Uma ação principal fixa no rodapé; todos os alvos ≥ 48 px |
| Hick | `HOJE-2` | ✅ Supervisor abre em até 3 decisões |
| Zeigarnik | `UX-ZEIGARNIK` | ✅ A evidência começada é retomada pelo aviso no Hoje |
| Jakob | `8.9`, `AGENDA-1` | ✅ Voltar fecha o painel; agenda de um dia por vez no celular |
| Gradiente de meta | `UX-GRADIENTE` | ✅ "Hoje: 1 de 5 · faltam 4" depois de concluir |
| Von Restorff / Miller | Revisão visual (capturas em `testes/saida/rotina/`) | ✅ Vermelho só para atrasada; 4 indicadores; ficha em 2 grupos de 3 |

## Defeitos encontrados e corrigidos durante a construção
1. **Texto "null" na tela.** Filhos condicionais passados a `replaceChildren`/`append` viravam o texto "null". Foi corrigido com `preencher`/`anexar` em `util.js`. **O mesmo padrão existe no RedeViva** (menu do usuário para perfis que não são gestor; lista de logs com até 200 registros). A correção é de uma linha por chamada.
2. **Estado de tela vazando entre usuários.** A aba e os filtros abertos por um usuário apareciam para o próximo no mesmo aparelho. Agora o estado de cada tela é reiniciado quando o login muda.

## Como reexecutar

```bash
bash testes/seguranca-estatica.sh
cd testes && npm install && npx playwright install chromium && npm run e2e:rotina   # 36 verificações
bash testes/headers.sh https://SEU-DOMINIO/rotina/                                  # fase 1, depois de publicar
```

## Critérios de pronto

| Critério | Demo / piloto de forma | Produção |
|---|---|---|
| Fases 1–9 com evidência | ✅ (fase 1 no domínio depois de publicar) | 🔒 fases 2, 3, 4, 7 e 9.1 no servidor |
| 0 críticos / 0 altos abertos | ✅ no escopo do protótipo | 🔒 |
| Dado real | Só importado no aparelho, nunca no Git | Banco corporativo com RLS por UTD |
