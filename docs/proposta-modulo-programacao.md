# Proposta — Módulo de Programação e funil Plano → Inspeção → Programação → Eficácia

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

## 6. Decisões para liberar

| # | Decisão | Opções / recomendação |
|---|---|---|
| 1 | O que é "KMI" | km de rede inspecionada (assumido) ou outro |
| 2 | Janelas da eficácia | Recomendo 180 dias para poda e estrutura; 90 dias para trafo e chave |
| 3 | Lista de causas evitáveis | Validar a matriz do item 2.4 com a tabela de causas do OMS |
| 4 | Congelamento da programação | Dia e hora (recomendo sexta, 12h) e quem congela (supervisor) |
| 5 | Drone | Quem analisa as imagens e em quanto tempo os defeitos entram no sistema |
| 6 | Fonte das ocorrências | Exportação CSV do OMS no início; integração depois |

---

## 7. Implementação proposta [SUPOSIÇÃO de prazo]

| Etapa | Entrega | Duração |
|---|---|---|
| 1 | Plano por km (trechos com comprimento) + indicador 2.1 + completude com trilha GPS | 1 semana |
| 2 | Tela Programação (carteira, quadro semanal, congelamento, motivos) + indicadores 2.3 | 1 semana |
| 3 | Importação de ocorrências + matriz de causas + eficácia 2.4 + atribuição por portão | 1 semana |
| 4 | Modo drone + painel do funil + ranking ajustado + testes | 1 semana |

No protótipo, tudo com dados sintéticos (inclusive ocorrências), para validar a regra com a equipe antes de usar dados reais.
