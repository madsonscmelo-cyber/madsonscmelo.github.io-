# Avaliação consolidada do RedeViva e da mudança de interface proposta

**Data:** 25/10/2026 · **Versão avaliada:** publicada em `madsonscmelo-cyber.github.io/madsonscmelo.github.io-/app/` · Marcações: **[CERTEZA]**, **[PROVÁVEL]**, **[SUPOSIÇÃO]**

> **Conclusão em uma linha:** a mudança proposta (tela Hoje, funil clicável, linha do tempo) é boa, mas **amplifica dois problemas que a ferramenta já tem**: cores que daltônicos não distinguem e controles sem nome para leitor de tela. Corrigir esses dois primeiro custa pouco e é pré-requisito; o arrastar-e-soltar da programação deve ser adiado.

---

## 1. O que já tinha sido avaliado e o que entrou agora

| Aspecto | Como foi avaliado | Situação |
|---|---|---|
| Segurança (checklist v1.1, OWASP, segredos) | Checklist, Semgrep, gitleaks, 47 testes ponta a ponta | Já avaliado |
| Usabilidade (7 leis) | Guia + testes (alvos 48 px, 360 px, rascunho, progresso) | Já avaliado |
| Offline, PWA | Testes ponta a ponta | Já avaliado |
| **Desempenho e qualidade web** | Skill **web-quality-audit** → Lighthouse 12 no site publicado (celular e computador) | **Novo** |
| **Acessibilidade WCAG 2.1 AA** | axe-core 4.10 em **10 telas autenticadas** (login, mapa, ficha, inspeção, defeitos, programação, painel, plano, acesso, parâmetros) | **Novo** |
| **Cores e daltonismo** | Skill **dataviz** → validador de paleta (separação para daltonismo, contraste) | **Novo** |
| **Crítica visual (celular)** | Skill **design-critique** sobre capturas de 390 px | **Novo** |

Skills instaladas que ainda podem ser usadas depois: **security-review** (revisão de código focada em vulnerabilidades), **engineering:tech-debt / code-review** (saúde do código), **operations:risk-assessment** (riscos do piloto), **compliance-check** (LGPD), **design:ux-copy** (textos da interface) e os agentes **fairmind** de teclado e leitor de tela (dependem de um conector de navegador que não está ativo nesta sessão).

Evidências: `docs/evidencias/lighthouse-resumo.json`, `docs/evidencias/axe-10-telas.json`, `docs/evidencias/critica-mobile.png`.

---

## 2. Resultados das avaliações novas

### 2.1 Desempenho e qualidade web (Lighthouse, site publicado)

| Sinal | Celular | Computador | Leitura |
|---|---|---|---|
| Desempenho | **89** | 99 | Bom; no celular fica abaixo de 90 |
| LCP (maior elemento visível) | **3,2 s** ⚠ (meta 2,5 s) | 1,0 s | O maior elemento é um quadro do mapa (OSM) atrás da tela de login |
| TBT (bloqueio) | 220 ms | 0 ms | Aceitável |
| CLS (layout pulando) | 0 | 0 | Ótimo |
| Boas práticas | 96 | 100 | — |
| SEO | 54 | 54 | **Intencional**: o protótipo pede para não ser indexado. Ignorar |
| Acessibilidade | não calculada | não calculada | Erro interno do axe dentro do Lighthouse → medido à parte (2.2) |

Código: 380 KB de JS e CSS sem minificar (não há etapa de build), 27 KB de JS não usados no carregamento [CERTEZA]. Uma minificação simples reduziria para cerca de um terço [PROVÁVEL].

### 2.2 Acessibilidade (axe-core, 10 telas, WCAG 2.1 AA)

| Gravidade | Regra | Ocorrências | Onde | Correção |
|---|---|---|---|---|
| 🔴 Crítica | Lista de seleção sem nome acessível | 77 | Plano (filtros e coluna de equipe da tabela de inspeções) | `aria-label` em cada lista |
| 🟠 Séria | Área com rolagem horizontal sem acesso por teclado | 13 | Programação, Painel, Plano, Acesso (tabelas) | `tabindex="0"`, `role="region"` e nome na área rolável |
| 🟡 Moderada | Conteúdo fora de região (landmark) | 6 | Login | Envolver o cartão de login em `<main>` |
| ⚪ Menor | Cabeçalho de tabela vazio | 1 | Parâmetros | Texto oculto "Ações" |
| ✅ | **Contraste de texto** | 0 falhas | Todas | — |

### 2.3 Cores e daltonismo (validador da skill dataviz)

| Conjunto | Resultado | Problema concreto |
|---|---|---|
| Marcadores do mapa (7 estados) | **FALHA** | **Vermelho (defeito A) × verde (em dia): ΔE 4,2 para deuteranopia**, o daltonismo mais comum (cerca de 8% dos homens) [CERTEZA]. Para essa pessoa, o defeito crítico e o ativo em dia têm a mesma cor |
| | **FALHA** | Verde (em dia) × verde-azulado (executado): ΔE 9,4 **mesmo com visão normal** (mínimo 15) |
| | ALERTA | Amarelo (severidade C): contraste 1,8:1 contra o fundo claro (mínimo 3:1) |
| Trechos (em dia / vence / vencido) | **FALHA** | Em dia × vence em 15 dias: ΔE 5,9 para protanopia. "Vencido" se salva porque é tracejado |

Hoje a severidade A só se distingue pela cor e pela pulsação. A forma do marcador indica o tipo de ativo, não a situação.

### 2.4 Crítica visual no celular (390 px)

| Achado | Gravidade | Recomendação |
|---|---|---|
| **Programação: o quadro semanal é uma tabela de 7 colunas; no celular só aparece segunda-feira** | 🔴 | Agenda por dia no celular (abas Seg…Sex, lista por equipe); tabela só no computador |
| Painel: os 4 indicadores do funil empilhados ocupam a tela inteira; as barras do funil ficam espremidas (rótulo em 3 linhas, barra quase some) | 🟡 | Indicadores em grade 2×2 e funil em barras com rótulo acima da barra |
| Painel abre com "Exportar" e "Imprimir" como primeiros elementos | 🟡 | Ação secundária vai para o fim ou para um menu |
| Selo "PROTÓTIPO" cobre conteúdo e botões no canto inferior direito | 🟡 | Mover para o topo ou para o rodapé da tela de login |
| Topo: o aviso de sincronização aparece cortado ("Sem pend…") e o nome do usuário ocupa metade da barra | 🟢 | Ícone com contador; iniciais do usuário |
| Mapa do gestor: marcadores, trechos coloridos e áreas tracejadas usam cor ao mesmo tempo | 🟡 | Uma visão por vez (proposta 5) |
| KPI "não congelada" usa o espaço do número com texto | 🟢 | Número sempre no lugar do número; estado vira etiqueta |
| **Funciona bem:** alvos de 48 px, assistente em etapas com rodapé fixo, busca, contraste de texto, rascunho | ✅ | Manter |

---

## 3. Avaliação da mudança proposta

Cada proposta foi cruzada com usabilidade (7 leis), acessibilidade, cores, desempenho, segurança/logs e esforço.

| # | Proposta | Ganho | Riscos e condições | Esforço | Veredito |
|---|---|---|---|---|---|
| 1 | **Tela Hoje** (3 cartões de decisão por perfil) | Alto: tira o gestor da busca por números (Hick, Fitts) | Não pode virar mais um painel: **no máximo 3 cartões**, só ações permitidas ao perfil, cada ação registrada no log | Baixo–médio | ✅ **Aprovar** |
| 2 | **Funil clicável** | Alto: mostra o fluxo e o gargalo | **Discordância de forma:** o funil mistura unidades (km, defeitos, R$), e taxa de conversão só existe dentro da mesma unidade. Fazer **duas faixas**: km (planejado → inspecionado) e defeitos (achados → programados → executados → verificados), ligadas pela **taxa de achado por km**. Barras horizontais com rótulo direto, tabela alternativa para leitor de tela, nada de diagrama Sankey decorativo | Médio | ✅ **Aprovar com ajuste** |
| 3 | **Linha do tempo do defeito** | Alto: mostra onde o tempo se perde, caso a caso | Etapas com texto e ícone, não só cor | Baixo | ✅ **Aprovar** |
| 4 | **Painel enxuto com tendência** (gráficos pequenos de 12 semanas) | Médio | **Depende de histórico**: hoje os indicadores são calculados na hora, sem foto semanal. É preciso guardar uma foto por semana antes de desenhar a tendência. Os gráficos precisam de dica ao tocar e tabela | Médio | ✅ Aprovar **depois** da foto semanal |
| 5 | **Mapa com uma visão por vez** | Alto: reduz a legenda e resolve parte do problema de cores | Precisa vir junto com **codificação secundária** (ícone "!" no defeito A, relógio na vencida, ✓ no executado) | Médio | ✅ **Aprovar** (junto com a correção de cores) |
| 6 | **Arrastar-e-soltar na programação** | Médio (computador) | **Risco de acessibilidade:** a WCAG 2.2 (2.5.7) exige alternativa sem arrastar; arrastar no celular é ruim | Alto | ⏸ **Adiar**: no celular, agenda por dia com "tocar e escolher dia"; arrastar só como atalho no computador |
| 7a | Indicador **taxa de achado por km** | Alto: antecipa a queda de eficácia | Os dados já existem | Baixo | ✅ Aprovar |
| 7b | **Tempo em cada etapa** e **idade da carteira** | Alto | Vem junto com a linha do tempo | Baixo | ✅ Aprovar |
| 7c | **CHI em risco** | Médio | Deve aparecer como "estimado" [SUPOSIÇÃO de duração média] | Baixo | ✅ Aprovar com rótulo |
| 7d | **R$ por CHI evitado** | Alto, se for verdadeiro | Depende das probabilidades de falha **ainda não calibradas**. Hoje viraria um número frágil num argumento de orçamento | Baixo | ⏸ **Adiar** até calibrar com histórico |
| 8 | Modo sol (alto contraste), busca única, indicação de carregamento | Médio | O modo sol resolve sol forte em campo e ajuda com o contraste do amarelo | Baixo | ✅ Aprovar |

### Correções obrigatórias antes da mudança (a mudança aumenta o problema se não forem feitas)

| Prioridade | Correção | Por que antes |
|---|---|---|
| P1 | **Paleta do mapa com codificação secundária**: trocar o verde "em dia" por um tom distinguível (ex.: azul-acinzentado), ícone na severidade A, amarelo mais escuro com borda | Funil, Hoje e mapa por visão vão usar as mesmas cores de status |
| P1 | **77 listas sem nome + 13 tabelas roláveis sem teclado** | As telas novas reaproveitam os mesmos componentes |
| P2 | **Agenda por dia na Programação (celular)** | O supervisor programa pelo celular |
| P2 | Selo de protótipo e topo | Sobreposição com os botões novos |
| P3 | Minificação do JS e LCP no celular abaixo de 2,5 s | Não bloqueia a mudança |

---

## 4. Plano sugerido

| Etapa | Conteúdo | Duração [SUPOSIÇÃO] |
|---|---|---|
| 1 | Correções P1 (cores com codificação secundária, acessibilidade) + linha do tempo + taxa de achado por km + tempo por etapa | 1 semana |
| 2 | Tela Hoje + funil em duas faixas + mapa com uma visão por vez + modo sol | 1 semana |
| 3 | Foto semanal dos indicadores + painel enxuto com tendência + agenda por dia no celular | 1 semana |
| Depois do piloto | Arrastar no computador, R$ por CHI evitado (após calibrar) | — |

## 5. Como saber se a mudança deu certo

| Medida | Meta |
|---|---|
| Acessibilidade (axe, 10 telas) | 0 crítico, 0 sério |
| Validador de cores (status do mapa) | Separação para daltonismo ≥ 8, ou ≥ 6 com codificação secundária |
| Lighthouse celular | Desempenho ≥ 90; LCP ≤ 2,5 s |
| Tempo do gestor até a primeira ação útil ao abrir o app | Medir antes e depois; meta < 10 s |
| Teste com 5 usuários de campo (encontra a maior parte dos problemas de usabilidade [PROVÁVEL]) | ≥ 4 de 5 concluem "achar a pendência do dia" sem ajuda |
| Testes automatizados | Continuam 100% aprovados |

---

## 6. Execução do plano (25/10/2026) — o que foi feito e o que mudou nas medidas

As três semanas do plano foram implementadas e publicadas. Itens adiados de propósito continuam adiados (ver 6.3).

### 6.1 Medidas antes × depois

| Medida | Meta (seção 5) | Antes | Depois | Situação |
|---|---|---|---|---|
| Acessibilidade (axe-core, WCAG 2.1 AA + boas práticas) | 0 crítico, 0 sério | 77 críticas, 13 sérias, 6 moderadas, 1 menor (10 telas) | **0 violações em 16 telas** (inclui Hoje, abas do painel, busca, mapa por visão, modo sol) | ✅ [CERTEZA] |
| Paleta dos estados no mapa (validador dataviz) | ΔE ≥ 8, ou ≥ 6 com codificação secundária | FALHA: vermelho × verde ΔE 4,2 (deuteranopia) | **Pior par 11,3** (normal) · modo sol: 7,5 com letra/ícone no marcador | ✅ [CERTEZA] |
| Lighthouse celular, site publicado | Desempenho ≥ 90; LCP ≤ 2,5 s | 89 · LCP 3,2 s | **98–99 · LCP 2,0–2,1 s** (3 execuções) · boas práticas 100 | ✅ [CERTEZA] |
| Testes automatizados | 100% aprovados | 47/47 | **60/60** (13 novos: Hoje, fluxo, funil clicável, tendência, mapa por visão, busca, modo sol, agenda no celular) | ✅ [CERTEZA] |
| Tempo do gestor até a primeira ação útil | < 10 s | — | Abre direto em Hoje com 3 decisões e o botão da ação [PROVÁVEL] | ⏳ medir com usuários |
| Teste com 5 usuários de campo | ≥ 4 de 5 | — | — | ⏳ não feito — depende do piloto |

Evidências: `docs/evidencias/axe-16-telas.json`, `docs/evidencias/lighthouse-depois.json`.

**O ganho de LCP não veio de minificação.** Os quadros do mapa carregavam atrás da tela de login e viravam o maior elemento da página. Agora o fundo de ruas só carrega quando o mapa é aberto — economiza dados móveis em campo e resolveu o LCP sem etapa de build. A minificação continua recomendada para o ambiente de produção, mas deixou de ser necessária para a meta.

### 6.2 Entregue

| Semana | Entrega |
|---|---|
| 1 | Paleta validada + letra/ícone nos marcadores (! A, B, C, V, I, P, ✓) · acessibilidade (listas nomeadas, tabelas roláveis com teclado e nome único, login em região) · **linha do tempo do defeito** · **tempo por etapa** (mediana, conta o que está parado) · **idade da carteira** · **taxa de achado por km** (por equipe, alerta abaixo da metade da média) · **CHI em risco (estimado)** com duração média parametrizável |
| 2 | **Tela Hoje** (gestor/supervisor: até 3 decisões; equipe: rota do dia; auditor: integridade do log, negações, parâmetros alterados) · **funil em duas faixas** (km e defeitos) ligadas pela taxa de achado, etapa → lista filtrada, tabela alternativa · **mapa com uma visão por vez** e legenda adaptada · **modo sol** · **busca única** (Ctrl+K) · carregando e vibração |
| 3 | **Foto semanal** dos indicadores (12 semanas) · **painel enxuto** (4 indicadores 2×2 com tendência e variação; resto em abas; exportar no fim) · **agenda por dia** na Programação do celular · número sempre no lugar do número · topo com ícone + contador e iniciais · selo DEMO no topo · preconnect |

### 6.3 Adiado e por quê (sem mudança de posição)

| Item | Motivo |
|---|---|
| Arrastar-e-soltar na programação | WCAG 2.2 (2.5.7) exige alternativa sem arrastar; no celular a agenda por dia com "tocar e escolher" já resolve. Avaliar como atalho de computador depois do piloto |
| R$ por CHI evitado | A probabilidade de falha por tipo de defeito não está calibrada. O app mostra **CHI em risco (estimado)** — exposição, não previsão — e diz isso na tela |

### 6.4 Riscos que continuam abertos

| Risco | Por quê importa | O que fazer |
|---|---|---|
| **Tendência com semanas sintéticas** | As 11 semanas anteriores à primeira foto real são geradas para a demonstração. Em produção, o histórico começa vazio | A tela avisa. No ambiente protegido, carregar o histórico real dos indicadores ou aceitar 12 semanas até a tendência ter valor |
| **Taxa de achado depende de "equipe que identificou"** | Defeito lançado pelo supervisor em nome da equipe distorce a taxa | Exigir a equipe de origem no lançamento e auditar no piloto |
| **CHI em risco usa duração média única** | 2,5 h é [SUPOSIÇÃO]; o real varia por conjunto e tipo de falha | Trocar pelo TMA por conjunto quando o OMS estiver integrado |
| **Cartões do Hoje são regras fixas com peso** | A ordem reflete o meu julgamento de prioridade, não o seu | Revisar os pesos com o time no piloto; se divergir, levar os pesos para Parâmetros |
| Teste com usuários não feito | Medida de usabilidade real só com gente de campo | 5 usuários × tarefa "achar a pendência do dia", antes de ampliar |
