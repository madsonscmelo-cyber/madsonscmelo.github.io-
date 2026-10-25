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
Resultado atual: 18/18 verificações ponta a ponta e 0 pendências estáticas — relatório em [`docs/relatorio_seguranca_redeviva.md`](../docs/relatorio_seguranca_redeviva.md).

## Roteiro de demonstração (cenário §14 da especificação)

1. Entre como **Gestão de Planejamento** → **Painel**: aderência, compensação dos ativos críticos (≈ R$ 100 mil/mês nos trafos e chaves reincidentes), top 10 por risco.
2. **Plano** → *Importar plano (CSV)* → use *Exemplo para teste*: 6 linhas aceitas e 4 rejeitadas (fora da área, coordenada inválida, duplicada, critério incompatível).
3. Menu do usuário → *Trocar usuário* → **Equipe Inspeção 01** → busque um trafo pelo código (ex.: `TR-07-03`).
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
| Tiles do OpenStreetMap (limite de uso) | Servidor de tiles próprio (PMTiles) com download offline por área de trabalho |
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
    main.js      sessão, navegação, GPS, alertas, filtros
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
