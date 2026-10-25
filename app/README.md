# RedeViva — protótipo (Fase 0)

Protótipo navegável da plataforma de plano de manutenção e inspeção de rede descrita em
[`docs/especificacao-plataforma-manutencao.md`](../docs/especificacao-plataforma-manutencao.md).

> **Dados 100% sintéticos.** Alimentadores, ativos, códigos e valores são fictícios. Não carregue dados reais da distribuidora
> neste repositório (é público) nem nesta versão (sem backend, sem SSO).

## Como rodar

Não há build. Precisa ser servido por HTTP (service worker e câmera não funcionam via `file://`):

```bash
python3 -m http.server 8080
# abrir http://localhost:8080/app/
```

No celular, a instalação como app (PWA) exige HTTPS — por exemplo, publicando no GitHub Pages ou num servidor interno.

## O que já funciona

| Módulo | Requisitos da especificação |
|---|---|
| Mapa com ativos por estado (defeito A/B/C, inspeção vencida/programada, executado, em dia), troncos de alimentador, filtros por camada, alimentador e tipo de equipe | RF-MAP-01 a 05 |
| Seleção de área (2 toques) com inspeção em lote | RF-MAP-04 |
| Mapa offline: cache dos tiles visitados + pré-download da área visível (limite de 200 tiles) | RF-MAP-06 (parcial) |
| Rota até o ativo (abre Google Maps) e alerta de proximidade (150 m, 1 por ativo/dia, só pendências compatíveis com a equipe) | RF-ROT-01, 03, 04 |
| Importação do plano por CSV com validação linha a linha, relatório e download das rejeições; versionamento | RF-PLN-01, 04 |
| Critérios e periodicidades + motor que gera as inspeções devidas (janela de 30 dias) | RF-PLN-02, 03 |
| Inspeção programada, em lote ou avulsa; checklist por tipo de ativo; defeitos com foto obrigatória; manutenção resolvida na hora | RF-INS-01 a 05 |
| Geovalidação (50 m), justificativa obrigatória fora do raio, marca d'água e hash SHA-256 nas fotos | RF-INS-07, 08 |
| Fluxo do defeito: Identificado → Validado → Programado → Executado → Verificado (+ Rejeitado, Cancelado, Devolvido), com permissões por perfil | §3 |
| Matriz defeito × tipo de equipe; atribuição manual e distribuição automática por alimentador | RF-EQP-01 a 03 |
| Score de risco 0–100 (severidade, UCs, DEC/FEC do conjunto, compensação, reincidência) | §6 |
| Painel: aderência, vencidas, backlog, críticos > 7 dias, compensação dos ativos críticos e exposta, lead time, evolução semanal, conjuntos, top 10 por risco, auditoria; exporta CSV e PDF | RF-DSH-01 a 04, 06 |
| Produção da equipe e ranking ponderado por tipo de equipe (com penalidade por rejeição e estorno por reincidência) | RF-EQP-04, 05, §8 |
| Offline-first: tudo grava no IndexedDB do aparelho; fila de sincronização visível; modo offline simulável | RF-INS-06, RNF-01 |

## Interface (rodada de usabilidade moderna)

| O quê | Como funciona |
|---|---|
| **Hoje** (tela de entrada) | Gestor/supervisor: no máximo 3 cartões de decisão (críticos sem data, críticos fora do prazo, congelar a semana, verificar execuções, saldo × críticos, gargalo, equipe achando pouco). Equipe: rota do dia na ordem do ponto mais próximo + inspeções em andamento. Auditor: integridade do log, ações negadas e parâmetros alterados na semana. Cada ação tocada vai para o log |
| **Linha do tempo do defeito** | Identificado → Validado → Programado → Executado → Verificado, com data e dias em cada etapa; ⚠ quando a etapa passou do limite. Texto e ícone, não só cor |
| **Painel enxuto** | 4 indicadores do funil em grade 2×2 com tendência de 12 semanas e variação da semana; fluxo em duas faixas (km: plano → em dia → inspecionado; defeitos: identificados → verificados) ligadas pela **taxa de achado por km**; cada etapa abre a lista filtrada; tabela alternativa. O resto fica em abas: Fluxo e gargalo, Execução, Risco, Eficácia, Custos, Ranking, Auditoria. Exportar/Imprimir no fim |
| **Fluxo e gargalo** | Tempo em cada etapa (mediana, conta o que ainda está parado), idade da carteira (≤ 7 / 30 / 90 / > 90 dias por severidade), taxa de achado por equipe (alerta abaixo da metade da média), **CHI em risco (estimado)** = UCs com defeito A/B aberto × duração média (parâmetro) |
| **Foto semanal** | Uma foto dos indicadores por semana guarda o histórico das tendências. Na demonstração, as 11 semanas anteriores são sintéticas e marcadas como tal |
| **Mapa com uma visão por vez** | Defeitos · Plano · Semana (equipe: Pendências · Defeitos · Plano). A legenda mostra só o que vale na visão. Marcadores com letra/ícone (! A, B, C, V, I, P, ✓) e paleta validada para daltonismo |
| **Busca única** | 🔍 no topo ou Ctrl+K, de qualquer tela: ativo, trecho, equipe ou tipo de defeito; setas e Enter |
| **Modo sol** | ☀ no topo: alto contraste para tela ao ar livre (lembrado no aparelho) |
| **Programação no celular** | Agenda por dia (Seg…Sex) com a lista por equipe; a tabela de 7 colunas fica só no computador |
| Detalhes | Carregando… na primeira abertura de cada tela, vibração ao concluir inspeção/execução, topo com ícone + contador e iniciais no celular, selo DEMO no topo (não cobre botões) |

Ficaram para depois do piloto, de propósito: **arrastar-e-soltar** na programação (WCAG 2.2 — 2.5.7 exige alternativa sem arrastar; no celular a agenda por dia já resolve) e **R$ por CHI evitado** (depende de probabilidade de falha calibrada com histórico; hoje seria um número frágil para argumentar orçamento).

## Mapa: desempenho, seleção e cancelamento

| O quê | Como funciona |
|---|---|
| **Volume real** | Desenha só o que está na tela; postes sem pendência só de perto (zoom ≥ 16) e num único canvas; com mais de 250 pendências na tela, agrupa por região com a contagem e a cor do pior estado; o estado de cada ativo vem de um índice refeito só quando os dados mudam. 30 mil postes + 1.500 defeitos com CPU 4× mais lenta: **0,1–0,2 s** (antes: 51 s) |
| **Alvo de toque** | 44 px em volta de cada marcador (o desenho continua 22 px); pontos do canvas aceitam toque a até 14 px |
| **Ativos no mesmo ponto** | Tocar onde há mais de um (trafo no poste) abre a lista para escolher |
| **Modos** (área, avulso, simular) | Faixa fixa com o que fazer e **✕ Cancelar**; o voltar do celular também cancela |
| **Ponto avulso** | Toque só posiciona um alfinete arrastável; escolher tipo e alimentador (sugerido se houver ativo a até 300 m) e **Confirmar**. Sobre ativo já cadastrado, avisa e oferece abrir o existente. Nasce **provisório**: só entra no cadastro e na fila ao concluir a inspeção; descartar o rascunho apaga. Código único `AV-matrícula-carimbo` |
| **Seleção por área** | Lista com caixas para tirar ativos do lote antes de inspecionar |
| **Filtros** | Filtro ligado aparece no mapa ("Filtro: ALM-07 · Limpar") e no botão ("Filtros (1)") |
| **Outras equipes** | Para a equipe, pendências de outras aparecem em cinza; **defeito crítico aparece sempre** (segurança) |
| **Botão voltar** | Volta para a tela anterior; na primeira tela pede um segundo toque para sair |
| **Patrulha** | Pausar/retomar sem perder o trajeto, botões grandes e aviso de que quem dirige não opera |
| **Desenho de área** | Desfazer o último ponto |
| **Importação UTM** | Plano com `utm_e`, `utm_n`, `zona_utm` (SIRGAS 2000, ex.: 24S) convertido para lat/long (erro de milímetros contra a biblioteca PROJ) |
| **Configuração da instalação** (`js/config.js`) | Servidor de mapas, atribuição, pacote offline e retângulo aceito nas importações. Produção com o servidor público do OpenStreetMap **e** pacote offline é recusada na inicialização (a política do OSM proíbe download em massa) |

Regras de conflito na sincronização (para o servidor do piloto): [`docs/regras-sincronizacao.md`](../docs/regras-sincronizacao.md).

## Login e logs

- Entrar com **matrícula + senha**. Senha inicial de demonstração: `Rede@2026` (o app obriga a criar uma senha pessoal no primeiro acesso).
- Matrículas: `G1001` gestor · `S1001` supervisor · `A1001` auditoria · `X1001` administrador · equipes `INS01`, `INS02`, `LEV01`, `LEV02`, `PES01`, `LV01`, `POD01`, `ROC01`.
- Política: senha ≥ 10 caracteres com 3 de 4 tipos, sem matrícula/nome, sem repetir as 3 últimas; 5 erros bloqueiam por 15 min; bloqueio após 20 min parado; sessão máxima de 10 h.
- **Tudo é registrado**: tela **🔐 Acesso** (gestor e auditoria) mostra o log com filtros, exportação, verificação de integridade (cadeia SHA-256) e a gestão de usuários (bloquear, redefinir senha, liberar tentativas).
- Limite do protótipo: login e logs ficam no aparelho. Em produção: SSO corporativo com MFA e logs enviados a servidor só de inclusão/SIEM.

## Programação, custos e orçamento

- **🗓️ Programação** (gestor e supervisor; auditoria consulta):
  - carteira de defeitos validados por risco, com **custo-padrão** e horas de cada um;
  - quadro da semana por equipe e dia, com ocupação (horas) e custo;
  - **orçamento do mês por categoria** (Estrutural, Poda, Roçada, Elétrico, Fauna): orçado, realizado, programado e saldo. Programar algo que estoura o saldo pede confirmação e fica no log;
  - **congelar a semana**: depois disso, mudar data ou equipe exige motivo; a aderência mede o que foi executado conforme o congelado; Pareto dos motivos;
  - prazo dos críticos (defeito A executado em até N dias) e valor da carteira ainda sem data.
- **Custo-padrão** = itens do caderno de serviços × quantidade da composição × extensão (vãos de poda, metros de roçada) × fator regional do conjunto. Na execução o custo é gravado com os preços do dia (custo realizado).
- **Painel**: bloco "Custo e orçamento" com saldo do mês e quanto custaria a carteira sem data (só críticos e total).

## Plano por km, patrulha, drone e eficácia

- **Trechos de ~1 km** gerados a partir do traçado (no real: do KMZ). No mapa, cada trecho tem a cor da situação no plano: em dia, vence em 15 dias, vencido. Toque no trecho abre a ficha.
- **Tipos de plano** (Parâmetros → Tipos de plano): base (rede inteira), trecho ouro, área urbana, segurança em escolas (raio), evento (com início e fim; inspeção até N dias antes) e especial. Cada trecho segue a exigência mais rígida dos planos em que está.
- **Cadastro de áreas** (gestor): na tela Plano, marcando trechos, ou no mapa (**⋯ Mais → ✏️ Desenhar área de plano**): um ponto vira círculo (escola), 3+ pontos viram polígono (urbano, evento).
- **Inspeção de trecho com trajeto GPS**: "Iniciar inspeção do trecho" grava o caminho e mostra a cobertura ao vivo. Só é **completa** (conta no KMI) com cobertura ≥ 95%, checklist respondido e foto; senão fica parcial. Botão "Simular caminhada (demo)" para demonstração.
- **Patrulha da emergência** (**⋯ Mais → 🚨 Modo patrulha**): grava o trajeto e registra km patrulhado por trecho; não conta no KMI, mas trechos com cobertura suficiente podem ser completados como inspeção.
- **Drone**: na ficha do trecho, "Importar voo de drone" (KML ou CSV com lat/lon) — exemplo em `modelos/exemplo-voo-drone-ALM-07-T03.kml`.
- **KMI** (tela Plano): por plano — km em dia ÷ km do plano, km inspecionado e só patrulhado no mês, lista de trechos vencidos.
- **Ocorrências (OMS)**: importação CSV (`modelos/template-ocorrencias.csv`); cada desarme com causa evitável é atribuído à etapa que falhou — plano, inspeção, programação ou manutenção — pela tabela de causas × atividade e janelas (Parâmetros → Causas).
- **Painel → Funil da manutenção**: aderência ao plano (KMI) → inspeções completas → aderência da programação → eficácia, com gráfico de onde os desarmes evitáveis falharam e alerta de qualidade do código de causa.

## Parâmetros (⚙️)

Tudo que é regra é editável, com **data de início de vigência**, motivo e histórico; nada é recalculado para trás:
orçamento mensal, caderno de serviços (com importação CSV), composições de custo, fator regional, tipos de defeito, critérios de inspeção, motivos de reprogramação, metas e prazos, campo e programação, pesos do risco, pontuação do ranking e política de acesso (com limites mínimos protegidos).
O **Administrador** (`X1001`) edita tudo; o **gestor** edita orçamento, metas e motivos; auditoria consulta. Toda alteração vai para o log.

## Trabalho offline por alimentador

Menu **⋯ Mais → 📦 Trabalho offline** (fazer na base, com Wi-Fi):

- **Recorte de dados do alimentador**: ativos, inspeções pendentes e defeitos abertos, com histórico resumido. Exemplo ALM-07: 58 ativos, 31 inspeções e 8 defeitos = **26 KB (4 KB compactado)**.
- **Mapa só do corredor**: faixa de 200 m em volta da rede, zooms 14–17. Exemplo ALM-07: 95 quadros ≈ **1,7 MB** (um retângulo cobrindo o mesmo alimentador seria várias vezes maior). Limite de 250 quadros por pacote.
- **Mapa leve**: só a rede desenhada, sem fundo de ruas, **0 KB**. É oferecido automaticamente quando a conexão cai sem pacote baixado.
- **Envio em duas filas**: os registros (texto, poucos KB) sobem assim que houver qualquer sinal; as fotos podem esperar o Wi-Fi.
- Pacote vale 7 dias; depois disso aparece como vencido para ser atualizado.

## Usabilidade (as 7 leis)

Aplicadas e testadas — detalhes em [`docs/guia_usabilidade_redeviva.md`](../docs/guia_usabilidade_redeviva.md):
ação principal única e larga no rodapé (Fitts), menos opções por tela (Hick), rascunho automático com aviso "continuar" (Zeigarnik),
busca e botão voltar como nos apps de mapa (Jakob), assistente em 3 etapas e progresso do dia (Gradiente de meta),
destaque só para o crítico (Von Restorff) e informação em blocos de 3–4 (Miller).

## Testes

```bash
bash testes/seguranca-estatica.sh
cd testes && npm install && npx playwright install chromium && npm run e2e
```
Resultado atual: 72/72 verificações ponta a ponta (inclui carga de 30 mil postes com CPU 4× mais lenta), 0 pendências estáticas e 0 violações de acessibilidade (axe-core, 17 telas) — relatório em [`docs/relatorio_seguranca_redeviva.md`](../docs/relatorio_seguranca_redeviva.md).

## Roteiro de demonstração (cenário §14 da especificação)

1. Entre como `G1001` (**Gestão de Planejamento**, senha inicial `Rede@2026`, crie a sua) → abre em **Hoje** com as 3 decisões do dia → **Painel**: funil, fluxo em duas faixas e, na aba *Risco*, compensação dos ativos críticos (≈ R$ 100 mil/mês nos trafos e chaves reincidentes) e top 10 por risco.
2. **Plano** → *Importar plano (CSV)* → use *Exemplo para teste*: 6 linhas aceitas e 4 rejeitadas (fora da área, coordenada inválida, duplicada, critério incompatível).
3. Menu do usuário → *Sair* → entre como `INS01` (**Equipe Inspeção 01**) → busque um trafo pelo código (ex.: `TR-07-03`).
4. **⋯ Mais → 🎯 Simular posição** e toque no mapa perto do trafo: aparece o alerta de proximidade.
5. **Inspecionar agora** → marque *Não conforme* → adicione *Vazamento de óleo* (vai para turma pesada) e um *Ninho* "resolvido na hora". Feche no meio: o aviso 📝 *Continuar* aparece no mapa. Termine com a foto geral → *Concluir*.
6. Menu → *Simular modo offline* antes de concluir para ver a fila de sincronização; volte para online e ela é enviada.
7. **Supervisão de Campo** → **Defeitos** → *Validar* → *Programar* (só aparecem equipes aptas).
8. **Equipe Turma Pesada 01** → **Defeitos** → *Registrar execução* com foto.
9. **Supervisão de Campo** → aba *A verificar* → *Verificar e fechar* → veja o ranking em **Produção**.

## O que é simulado (e como fica no produto)

| No protótipo | No produto (Fase 1) |
|---|---|
| Escolha de perfil na tela inicial | SSO corporativo (OIDC) com MFA |
| Permissões checadas no navegador | Checadas na API + Row Level Security por território no PostgreSQL |
| Fila de sincronização sem servidor | API com sync incremental e resolução de conflitos |
| Tiles do OpenStreetMap (limite de 250 quadros por pacote) | Servidor de mapas próprio (PMTiles): um arquivo por alimentador/polo, sem limite de uso |
| Alerta de proximidade com o app aberto | Geofence nativo via Capacitor (funciona com o app em segundo plano) |
| Indicadores de continuidade fixos | Integração com OMS/ADMS, GIS e SAP PM |

## Segurança já aplicada no protótipo

- CSP restritiva (só scripts do próprio domínio; nada de `eval` ou HTML inline); interface montada só com `textContent` (sem `innerHTML`).
- Fotos recodificadas (o EXIF original é descartado), com marca d'água e hash SHA-256; tipo e tamanho validados.
- CSV exportado protegido contra injeção de fórmulas; importação com limites de tamanho e linhas.
- Toda mutação gera registro na trilha de auditoria.
- Pipeline `.github/workflows/seguranca-app.yml`: gitleaks (segredos), Semgrep (JavaScript, OWASP Top 10, segredos) e bloqueio de padrões inseguros.

## Estrutura

```
app/
  index.html, manifest.webmanifest, sw.js, icon*.{svg,png}
  css/app.css
  js/
    main.js      sessão, navegação, GPS, alertas, filtros, visões do mapa, modo sol
    hoje.js      tela Hoje (decisões do gestor, rota da equipe, alertas do auditor)
    fluxo.js     linha do tempo, tempo por etapa, idade da carteira, taxa de achado, CHI em risco
    historico.js foto semanal dos indicadores (tendências)
    busca.js     busca única (Ctrl+K)
    dominio.js   catálogos, score de risco, motor de periodicidade, fluxo, ranking, indicadores
    acoes.js     comandos que alteram estado (com checagem de permissão)
    store.js     IndexedDB, auditoria, fila de sincronização
    seed.js      gerador de dados sintéticos
    mapa.js      Leaflet: camadas, modos (área, avulso, simular), mapa offline
    ui.js        ficha do ativo, formulários de inspeção/defeito/execução
    telas.js     Defeitos, Plano (importação), Painel, Produção
    fotos.js     captura, compressão, marca d'água, hash
  modelos/       template e exemplo de CSV do plano
  vendor/leaflet Leaflet 1.9.4 (BSD-2)
```
