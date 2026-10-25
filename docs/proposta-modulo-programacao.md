# Proposta — Módulo de Programação, planos configuráveis e custo (v2)

Para aprovação ("liberar") antes da implementação. Marcações: **[CERTEZA]**, **[PROVÁVEL]**, **[SUPOSIÇÃO]**.

---

## 0. Pontos de atenção antes de aprovar

1. **A eficácia depende da qualidade do código de causa das ocorrências** [CERTEZA]. Se o OMS registra muito "causa desconhecida" ou classifica errado (vegetação × descarga), o indicador mede o cadastro, não a manutenção. Sugestão: começar com as causas mais confiáveis (vegetação, cruzeta/estrutura, trafo, chave/elo) e auditar uma amostra.
2. **"Zero desarme" sem janela e sem filtro de causa é injusto e inalcançável** [PROVÁVEL]. Abalroamento, descarga atmosférica, vandalismo e pipa não são detectáveis na inspeção. A eficácia precisa contar só **causas evitáveis ligadas ao tipo de inspeção ou serviço**, dentro de uma **janela de tempo**.
3. **"KMI" foi entendido como km de rede inspecionada** [SUPOSIÇÃO]. Confirme. Se for outro indicador da empresa, a fórmula do item 2.1 muda.

---

## 1. O processo em 4 portões (funil)

```
 PLANO               INSPEÇÃO                PROGRAMAÇÃO                EFICÁCIA
 km e ativos   →     km inspecionados   →    defeitos críticos    →     sem desarme por
 programados         completos (terrestre    programados e              causa evitável no
 no período          ou drone)               executados no prazo        trecho, na janela
 ─────────────       ─────────────────       ──────────────────         ─────────────────
 Aderência do        Completude da           Aderência da               Eficácia da
 plano (KMI)         inspeção                programação + SLA          inspeção/manutenção
```

Cada desarme que acontecer num trecho do plano é **atribuído a um único portão** que falhou. É isso que separa os indicadores e diz onde agir:

| O que aconteceu antes do desarme | Portão que falhou | Leitura gerencial |
|---|---|---|
| Trecho estava no plano, mas **não foi inspecionado** no prazo | Plano | Faltou capacidade ou priorização |
| Foi inspecionado, **nenhum defeito** daquele tipo registrado | Inspeção (falha de detecção) | Qualidade da inspeção / treinamento / usar drone |
| Defeito registrado, **não executado** no prazo | Programação | Carteira, material, desligamento, capacidade |
| Defeito **executado**, desarme pela mesma causa mesmo assim | Manutenção (falha de execução) | Qualidade do serviço (ex.: poda insuficiente) |
| Causa não evitável (descarga, abalroamento, vandalismo) | Nenhum (excluído) | Fora do controle da manutenção |

---

## 2. Indicadores

### 2.1 Aderência do plano de inspeção (KMI)

```
Aderência do plano = km inspecionados no prazo e completos / km programados com prazo no período
```
- **Rede linear** (tronco, ramal, poda): medida em **km**, com o comprimento calculado do traçado do KMZ.
- **Ativos pontuais** (trafo e chave reincidentes): medida em **unidades**, em indicador paralelo.
- Só conta inspeção **completa** (ver 2.2). Inspeção incompleta aparece como "realizada com pendência" e não soma no indicador.

### 2.2 Completude da inspeção (critério de aceite)

Uma inspeção de trecho é **completa** quando:

| Requisito | Terrestre | Drone |
|---|---|---|
| Cobertura do trecho | Trilha GPS cobre ≥ 95% do km do trecho (faixa de 30 m) | Log de voo (KML/CSV) cobre ≥ 95% do km |
| Checklist | Todos os itens respondidos (OK / não conforme / N/A) | Idem, preenchido pelo analista das imagens |
| Evidência | Foto por vão crítico ou a cada X m | Imagens georreferenciadas do voo |
| Defeitos | Registrados com foto e severidade | Registrados como "detectado por drone" → validação do supervisor |

```
Completude = inspeções completas / inspeções realizadas
```

### 2.3 Aderência da programação

Funciona com uma **programação semanal congelada**: a carteira da semana é fechada num dia fixo (ex.: sexta, 12h), e a aderência é medida contra essa versão.

```
Aderência da programação = atividades executadas conforme programado (data e equipe) / atividades programadas na versão congelada
SLA dos críticos          = defeitos A executados em ≤ 7 dias (B em ≤ 30 dias) / defeitos A (B) identificados no período
```
- Toda reprogramação exige **motivo**: falta de material, desligamento negado, chuva, equipe deslocada para emergência, acesso, cliente. Isso gera o Pareto de motivos.
- Item não programado executado na semana entra como "fora da programação": não melhora nem piora a aderência, mas aparece no painel.

### 2.4 Eficácia da inspeção e da manutenção

```
Eficácia = 1 − (trechos/ativos com desarme por causa evitável relacionada, na janela / trechos/ativos inspecionados ou mantidos no período)
```

**Matriz causa × tipo de inspeção ou serviço** (o que cada atividade "garante"):

| Atividade | Causas de desarme que contam contra ela | Janela sugerida [SUPOSIÇÃO] |
|---|---|---|
| Poda | Vegetação / árvore / galho | 180 dias |
| Inspeção estrutural (terrestre ou drone) | Cruzeta, poste, isolador, conexão, ferragem | 180 dias |
| Inspeção de trafo reincidente | Falha/queima de trafo, sobrecarga, bucha | 90 dias |
| Inspeção de chave fusível reincidente | Chave, elo, cartucho | 90 dias |
| Execução de defeito (qualquer) | Mesma causa no mesmo ativo/vão | 90 dias |

**Exemplo:** poda executada no trecho T em 10/09. Desarme por **vegetação** no mesmo trecho em 20/10 → falha da **manutenção** (poda) → reduz a eficácia da poda e estorna os pontos da equipe. Se o desarme fosse por **descarga atmosférica**, não conta.

---

## 3. O que muda na ferramenta

| # | Funcionalidade | Detalhe |
|---|---|---|
| 1 | **Plano por km** | Trechos do KMZ com comprimento; critério e periodicidade por trecho; meta de km/mês por polo |
| 2 | **Inspeção completa** | Trilha GPS gravada durante a inspeção; cobertura calculada sobre o traçado; checklist completo obrigatório |
| 3 | **Modo drone** | Tipo de inspeção "drone"; importação do log de voo; registro de defeitos pelo analista; validação do supervisor |
| 4 | **Tela Programação** | Carteira priorizada pelo score (com CHI/compensação); quadro semanal por equipe com capacidade (horas-homem); agrupamento por desligamento; botão "congelar programação"; reprogramar com motivo |
| 5 | **Importação de ocorrências** | CSV do OMS: data/hora, alimentador, equipamento atuado/trecho, causa, UCs, CHI. Atribuição automática do portão que falhou (tabela do item 1) |
| 6 | **Painel do funil** | 4 indicadores por polo/alimentador/conjunto; tendência mensal; Pareto de desarmes por portão; Pareto de motivos de reprogramação |
| 7 | **Ranking ajustado** | Pontos de eficácia: trecho sem desarme evitável na janela pontua; desarme atribuído à equipe estorna |

---

## 4. Dados necessários

| Dado | Fonte | Para quê |
|---|---|---|
| KMZ dos alimentadores (traçado) | Você já tem | km do plano e cobertura da inspeção |
| Plano de inspeção por trecho/ativo | Você já tem | Denominador do indicador 2.1 |
| Ocorrências com causa e local | OMS (exportação) | Eficácia (2.4) |
| Tabela de causas evitáveis × atividade | Operação define (item 2.4) | Regra de atribuição |
| Horas-homem por equipe e tempo-padrão por tipo de serviço | Operação | Capacidade da programação |
| Logs de voo e imagens do drone | Fornecedor/equipe de drone | Inspeção por drone |

---

## 5. Metas iniciais sugeridas [SUPOSIÇÃO — calibrar com 3 meses de histórico]

| Indicador | Meta |
|---|---|
| Aderência do plano (KMI) | ≥ 95% |
| Completude da inspeção | ≥ 95% |
| Aderência da programação | ≥ 90% |
| SLA defeito A ≤ 7 dias | 100% |
| Eficácia (causas evitáveis, janela da matriz) | ≥ 90% |

---

## 6. Inspeção oportunista pelas equipes de emergência

Equipes de emergência rodam a rede todos os dias. O app passa a deixar qualquer equipe ligar o **modo patrulha**: a trilha GPS é gravada e o sistema calcula quantos km de cada trecho do plano foram percorridos.

| Situação | Como conta |
|---|---|
| Patrulha que cumpre o critério de inspeção completa (cobertura ≥ 95% do trecho + checklist + fotos) | **Conta no plano** (KMI), como qualquer inspeção |
| Patrulha parcial (só passou pelo trecho, sem checklist completo) | Vira **km patrulhado**, indicador separado; **não** soma no KMI |
| Defeito visto na patrulha | Entra no fluxo normal (identificado → validado → programado) |

> Discordância preventiva: deixar o "km rodado" da emergência contar direto no KMI infla a aderência sem inspeção de verdade [PROVÁVEL]. Por isso só conta quando cumpre o mesmo critério de completude.

---

## 7. Tipos de plano configuráveis

Cada plano passa a ter um **tipo**, uma **área** (trechos, ativos ou um polígono desenhado no mapa) e suas próprias regras. Exemplos:

| Tipo de plano | Área | Regras típicas | Vigência |
|---|---|---|---|
| **Trecho ouro** | Trechos que alimentam cargas críticas (hospital, indústria, maior CHI) | Periodicidade curta, inspeção completa obrigatória, SLA de defeito mais curto | Permanente |
| **Área urbana** | Polígono urbano | Periodicidade e checklist urbanos | Permanente |
| **Segurança — escolas** | Raio configurável em volta de cada escola (ex.: 200 m) | Checklist de segurança (cabo baixo, poste inclinado, estrutura acessível); defeito de risco a terceiros sempre severidade A | Permanente |
| **Evento** (ex.: micareta) | Polígono do circuito + vias de acesso | Inspeção antes do evento, plantão durante, prazo de execução até a véspera | Data de início e fim |
| **Plano especial** | Livre | Tudo configurável | Com ou sem data |

Um mesmo trecho pode estar em mais de um plano (ex.: trecho ouro dentro de área urbana). O indicador é calculado **por plano**, e o painel permite ver cada um separado ou todos juntos.

---

## 8. Administração de parâmetros

Tudo o que é regra vira parâmetro, com tela de administração, **vigência** (data a partir da qual vale) e registro no log.

| Grupo | Parâmetros |
|---|---|
| Planos | Tipos de plano, áreas e polígonos, raio de escolas, vigência de eventos, metas por plano |
| Inspeção | Critérios, periodicidades, checklists por tipo de ativo e por tipo de plano, cobertura mínima (%), faixa do trajeto (m), fotos mínimas, raio de validação (m) |
| Defeitos | Catálogo, categorias, severidade padrão, equipes aptas, "resolve na hora", prazo (SLA) por severidade |
| Programação | Dia/hora de congelamento, motivos de reprogramação, horas-homem por equipe, tempo-padrão por serviço |
| Eficácia | Matriz causa × atividade, janelas (dias), causas excluídas |
| Risco | Pesos do score (severidade, clientes, DEC/FEC, compensação, reincidência), faixas de cor |
| Ranking | Pontos por tipo de ação, estornos, teto diário, regras do Caçador de risco |
| Campo | Raio do alerta de proximidade, validade do pacote offline, fotos só no Wi-Fi |
| Custos | Caderno de serviços, composições por defeito, fatores regionais (item 9) |

**Regras de governança dos parâmetros**
1. **Vigência obrigatória** [CERTEZA de necessidade]: mudar uma meta ou uma janela **não recalcula o passado**. O indicador de setembro continua com a regra de setembro. Sem isso, os números históricos mudam a cada ajuste e perdem credibilidade.
2. Toda alteração fica no log (quem, quando, valor anterior e novo).
3. Parâmetros de segurança (política de senha, bloqueios, sessão) ficam num grupo separado, só com perfil de administrador de segurança.
4. Perfil novo: **Administrador** (parâmetros) separado de **Gestor** (operação).

---

## 9. Módulo de custos — caderno de serviços

### 9.1 Estrutura

| Elemento | Conteúdo |
|---|---|
| **Caderno de serviços** (importado por planilha) | Código do item, descrição, unidade (un, m, vão, km, h), preço unitário, contrato/empreiteira, regional, vigência |
| **Composição por tipo de defeito** | Lista de itens do caderno × quantidade-padrão. Ex.: "Substituição de cruzeta" = 1 cruzeta + 1 serviço de troca + 2 isoladores + deslocamento |
| **Custo de inspeção** | R$/km terrestre, R$/km drone, R$/ativo pontual |
| **Fator regional** | Multiplicador por polo/regional (urbano × rural, distância de base) |

### 9.2 O que o sistema calcula

| Cálculo | Fórmula |
|---|---|
| **Custo-padrão do defeito** | Σ (quantidade-padrão × preço vigente) × fator regional |
| **Custo realizado** | Itens apontados na execução × preço vigente na data |
| **Projeção da carteira** | Σ custo-padrão dos defeitos abertos, por mês programado, severidade, alimentador e plano |
| **Custo do plano de inspeção** | km programados × R$/km (terrestre ou drone) + ativos × R$/ativo |
| **Orçado × realizado** | Por mês, polo, plano e tipo de serviço |
| **Eficiência** | R$ por CHI evitado e R$ por compensação evitada, por tipo de serviço e por plano |

### 9.3 Cuidados

- **Média esconde variação** [PROVÁVEL]: poda urbana alta custa várias vezes a poda rural baixa. Por isso composição por tipo + fator regional, e não uma média única por defeito.
- **Preço do caderno é dado de contrato** [CERTEZA]: não pode ir para a versão pública. No protótipo, só preços fictícios.
- A projeção vira compromisso de orçamento só depois de calibrada com o realizado de 2–3 meses.

---

## 10. Decisões para liberar

| # | Decisão | Recomendação |
|---|---|---|
| 1 | O que é "KMI" | km de rede inspecionada |
| 2 | Janelas da eficácia | 180 dias poda/estrutura; 90 dias trafo/chave |
| 3 | Causas evitáveis | Validar a matriz do item 2.4 com os códigos do OMS |
| 4 | Congelamento da programação | Sexta, 12h, pelo supervisor |
| 5 | Drone | Quem analisa as imagens e em quanto tempo |
| 6 | Ocorrências | Planilha do OMS no início |
| 7 | Patrulha da emergência | Só conta no KMI se cumprir a inspeção completa (recomendado) |
| 8 | Tipos de plano iniciais | Trecho ouro, urbano, escolas (raio 200 m), evento, especial |
| 9 | Perfil Administrador | Separado do Gestor (recomendado) |
| 10 | Caderno de serviços | Formato da planilha atual (colunas) para eu montar o importador |

---

## 11. Implementação proposta [SUPOSIÇÃO de prazo]

> **Situação em 25/10/2026:** etapas **1** (parâmetros com vigência + Administrador), **4** (tela Programação) e **6** (caderno, composições, custo-padrão/realizado, orçamento × realizado) **entregues** no protótipo. Próximas: 2, 3 e 5.

| Etapa | Entrega | Duração |
|---|---|---|
| 1 | Administração de parâmetros com vigência + perfil Administrador | 1 semana |
| 2 | Tipos de plano e áreas (trechos, polígonos, raio de escolas, eventos) + plano por km | 1 semana |
| 3 | Inspeção completa com trilha GPS + modo patrulha + modo drone | 1 semana |
| 4 | Tela Programação (carteira, quadro semanal, congelamento, motivos) | 1 semana |
| 5 | Ocorrências + matriz de causas + eficácia + painel do funil | 1 semana |
| 6 | Caderno de serviços, composições, custo-padrão/realizado, projeção e orçado × realizado | 1 semana |

Tudo com dados e preços fictícios no protótipo.
