# Raio-X de Alimentadores: protótipo (Fase 0)

Mapa de desempenho 2025–2026 dos alimentadores, poste a poste. Você liga e desliga as camadas (árvore, acesso difícil, reincidência, compensação, CHI alto e chaves). O app agrupa os postes em trechos contínuos (clusters) e monta a árvore de manobra, com os blocos entre chaves. Para cada bloco, ele estima onde uma chave nova evitaria mais CHI. Perguntas prontas transformam o filtro em decisão: onde podar, onde o acesso alonga a interrupção, onde falta chave, onde a compensação se repete e quem é reincidente.

A proposta analítica completa e o roteiro de uso estão em [`docs/proposta-raio-x-alimentadores.md`](../docs/proposta-raio-x-alimentadores.md).

O app segue o mesmo padrão de segurança e usabilidade do RedeViva (`app/`), da Rotina UTD (`rotina/`) e da Central de Demandas (`demandas/`):

- login com política de senha;
- log com cadeia SHA-256;
- CSP restritiva;
- interface montada só com `textContent`;
- alvos de toque ≥ 48 px;
- os mesmos testes.

> **Dados 100% sintéticos.** Os alimentadores, postes, ocorrências e valores da demonstração são fictícios. A base real é importada por CSV **no próprio navegador**, gravada só no IndexedDB do aparelho e nunca vai para o repositório, que é público, nem para servidor. O `.gitignore` bloqueia `*.csv` dentro de `alimentadores/`, exceto os modelos.

## Como rodar

```bash
python3 -m http.server 8080
# abrir http://localhost:8080/alimentadores/
```

Senha inicial de todos os usuários: `Rede@Raiox2026`. O app obriga a criar uma senha pessoal no primeiro acesso.

| Matrícula | Perfil | O que faz |
|---|---|---|
| `G4001` | Gerência operacional | Tudo: carteira, mapa, onde agir, importa e apaga base, administra acessos e logs |
| `P4101` | Planejamento e qualidade | Carteira, mapa, onde agir, importa base |
| `S4201` · `S4202` | Supervisores (CJ Norte, CJ Sul) | Carteira, mapa e onde agir, abrindo no próprio conjunto. Não importam base |
| `A4001` | Auditoria | Consulta e logs |

## Telas

| Tela | Para que serve |
|---|---|
| **Alimentadores** | DEC, FEC, CHI e compensação do ano até hoje contra o mesmo período do ano anterior. Matriz CHI × compensação: o quadrante de cima à direita é a prioridade 1. Ranking com % de postes com árvore e com acesso difícil e chaves/km. Exporta CSV |
| **Mapa** | Um alimentador por vez. Tem camadas liga/desliga, filtro E/OU, causa, CHI mínimo e período (ano atual, mesmo período do ano anterior, ano anterior fechado, 12 meses). Três abas: **Resumo** (KPIs, duração média com acesso difícil × normal, CHI por causa), **Trechos** (clusters numerados no mapa e na lista, com a ação sugerida) e **Árvore de manobra** (blocos DJ → RL/CS → CF com CHI originado e ★ chave sugerida). Toque no poste mostra a ficha com ocorrências, proteção a montante e UCs a jusante |
| **Onde agir** | Aplica a mesma pergunta a todos os alimentadores e gera uma lista única por CHI ou compensação, com o Pareto do top 10. "Ver no mapa" abre o trecho. Exporta a carteira de ações |
| **Dados** | Mostra a base carregada (sintética ou importada), importa com relatório linha a linha, apaga a base importada e lista os parâmetros dos cálculos |
| **Acesso** | Usuários, logs com verificação de integridade e política (mesmo módulo dos outros apps) |

## Importação: formato

Os nomes de coluna aceitam variações sem acento e com sinônimos (`lat`/`latitude`, `vegetacao`/`arvore`, `religador`/`RL`…). O separador pode ser `;` ou `,`. Os números podem vir com vírgula decimal. Os modelos estão em `modelos/`.

| Arquivo | Colunas | Obrigatório |
|---|---|---|
| `postes.csv` | `alimentador; poste; poste_pai; latitude; longitude; arvore (S/N); acesso (S/N); acesso_motivo; chave (DJ/RL/CS/CF/NA); trafo; ucs; conjunto; nome_alimentador; comp_2025; comp_2026` | Sim (`alimentador`, `poste`, `latitude`, `longitude`) |
| `ocorrencias.csv` | `data_hora; alimentador; poste (origem); causa; ucs; duracao_h (ou chi); dispositivo` | Não (sem ela, CHI/DEC/reincidência ficam zerados) |
| `compensacoes.csv` | `alimentador; poste (do trafo); mes (AAAA-MM) ou ano; valor` | Não |

Regras de validação:

- **Topologia.** `poste_pai` liga cada poste ao poste a montante, e é isso que forma a árvore. Sem a coluna, os postes são ligados na ordem do arquivo, com aviso. Pai inexistente vira início de trecho, e ciclo é quebrado; os dois casos geram aviso.
- **Recusas.** São recusados: coordenada fora do Brasil, chave desconhecida, poste repetido, data inválida, ocorrência em poste que não existe, e duração ausente ou acima de 240 h. O relatório mostra a linha e o motivo.
- **Limites.** Até 40 MB e 400 mil linhas por arquivo.

## Cálculos

| Indicador | Regra |
|---|---|
| DEC / FEC | Σ CHI / UCs do alimentador · Σ CI / UCs, no período |
| Reincidente | Poste que originou 2 ou mais ocorrências no período |
| CHI alto | CHI originado no poste ≥ percentil 80 dos postes com falha no alimentador |
| Trecho (cluster) | Árvore e acesso formam o trecho contínuo, com tolerância de 1 poste sem marca. Reincidência, compensação, CHI alto e causa acendem postes dentro dele, e o trecho só entra se tiver poste aceso. Só com camadas de ponto, junta postes acesos a até 3 postes de distância |
| Bloco de manobra | Do poste com chave (DJ, RL, CS, CF) até as próximas chaves a jusante |
| Chave sugerida | CHI evitado(X) = Σ ocorrências a jusante de X no bloco × (UCs que caíram − UCs a jusante de X) × duração. É estimativa de 1ª ordem: não considera recomposição por manobra nem coordenação de proteção |
| Compensação | Base importada: valor do arquivo, mensal ou anual. Base sintética: DIC mensal do trafo acima do limite × UCs × valor da hora |

## Segurança e privacidade

| Item | Como está |
|---|---|
| Base real | Lida no navegador (`File.text()`), gravada só no IndexedDB. Nenhum `fetch`/XHR/beacon no código, e o teste estático falha se aparecer um. O log guarda contagens da importação, nunca o conteúdo |
| Login, sessão, log | Iguais aos outros apps: PBKDF2-SHA-256 com 210 mil iterações, bloqueio após 5 erros, sessão de 20 min sem uso e 10 h no máximo, log só de inclusão e encadeado |
| Permissões | Importar e apagar base é só gerência e planejamento. A checagem é feita no comando (`importar()`), não só no botão, e a negação vai para o log |
| XSS e CSV injection | Nenhum `innerHTML`. Texto vindo do CSV aparece literal. A exportação prefixa `= + - @` |
| CSP | `default-src 'self'`. A única origem externa é `tile.openstreetmap.org`, para o fundo de ruas. O fundo pode ser desligado, e então nada sai do aparelho |
| Fundo de ruas | Ao buscar os tiles, o OSM recebe a área do mapa sendo vista, mas não recebe dados da rede. Para base sensível, desligue o fundo ou, na Fase 1, use tiles próprios |
| Limite honesto | O endereço do GitHub Pages é público e o login é local: ele protege o aparelho, não substitui SSO. A base real só deve ser carregada em aparelho corporativo e apagada ao terminar |

## Testes

```bash
bash testes/seguranca-estatica.sh
cd testes && npm install && npx playwright install chromium && npm run e2e:alimentadores
```

Resultado atual: **29/29** verificações ponta a ponta e 0 pendências estáticas. A bateria cobre:

- camadas e foco preservado;
- perguntas prontas;
- E/OU como interseção e união;
- fórmula do CHI evitado;
- importação com validação e relatório;
- XSS e CSV injection;
- permissão no comando;
- integridade do log;
- anti-iframe;
- acessibilidade: 0 violações no axe-core (WCAG 2.1 AA) em 10 telas a 360 px, alvos de toque ≥ 48 px e nenhuma rolagem horizontal.

O CI (`.github/workflows/seguranca-app.yml`) cobre `alimentadores/`.

## Estrutura

```
alimentadores/
  index.html, manifest.webmanifest, sw.js, _headers, icon*
  css/app.css          base visual dos outros apps + camadas, mapa, matriz e árvore de manobra
  modelos/             CSV de exemplo para importação (únicos CSV versionados)
  js/
    main.js            sessão, navegação por perfil, topo (base sintética × importada), voltar, service worker
    dominio.js         períodos, árvore do alimentador (DFS), indicadores, camadas, clusters, blocos, chave sugerida, perguntas
    seed.js            gerador determinístico da rede sintética (8 alimentadores, ~3 mil postes)
    importar.js        leitura de CSV, aliases de coluna, validação, topologia e relatório
    carteira.js mapa.js prioridades.js dados.js   telas
    ui.js              sheet, formatação, fichas de poste e trecho
    store.js auditoria.js auth.js acesso.js util.js compat.js config.js   mesma base dos outros apps
```

Leaflet é carregado de `../app/vendor/leaflet` (a mesma cópia auditada do RedeViva).
