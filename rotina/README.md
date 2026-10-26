# Rotina UTD — protótipo (Fase 0)

Agenda individual da rotina da retaguarda das UTDs. Cada pessoa vê o próprio dia e conclui cada atividade com a evidência do produto entregue. O remanejamento exige motivo, e o que sai da janela da periodicidade vai para o supervisor. A aderência é medida por pessoa, por cargo e por UTD.

O app segue o mesmo padrão de segurança e usabilidade do RedeViva (`app/`): login com política de senha, log com cadeia SHA-256, CSP restritiva, interface montada só com `textContent`, as 7 leis de usabilidade e os mesmos testes.

> **Dados 100% sintéticos.** Pessoas, matrículas e o catálogo de demonstração são fictícios. O catálogo real da distribuidora **não** entra neste repositório, que é público. Ele é carregado pela tela **Catálogo → Importar CSV** e fica só no aparelho.

## Como rodar

```bash
python3 -m http.server 8080
# abrir http://localhost:8080/rotina/
```

Senha inicial de todos os usuários: `Rotina@2026`. O app obriga a criar uma senha pessoal no primeiro acesso.

| Matrícula | Perfil | O que faz |
|---|---|---|
| `R1101` … `R1105` | Retaguarda de Juazeiro (01 Téc. Comercial, 02 Téc. Manutenção, 03 Téc. Especialista, 04 Assist. Comercial, 05 Assist. Geral) | Vê o próprio dia, conclui com evidência, remaneja com motivo, registra sob demanda |
| `R12xx` · `R13xx` · `R14xx` | Retaguarda de Jacobina, Senhor do Bonfim e Remanso | Idem |
| `S1001` … `S1004` | Supervisor de Juazeiro, Jacobina, Senhor do Bonfim e Remanso | Decide pedidos e acompanha a aderência **só da própria UTD** |
| `G1001` | Gerência operacional | Tudo nas 4 UTDs; edita catálogo, regras e ocupação; registra aceite de transferência; decide os pedidos dos supervisores |
| `A1001` | Auditoria | Só consulta; integridade do log |
| `X1001` | Administrador | Catálogo, regras e logs |

## O que resolve dos achados da planilha

| Achado | Como o app trata |
|---|---|
| Não há um A (aprovador) definido | Cada atividade tem o campo **Aprova (A)**. A tela **Achados** lista as atividades sem A. O pedido de remanejamento vai ao supervisor da UTD. Se o supervisor é quem pede, o pedido vai à gerência: ninguém aprova o próprio pedido |
| A mesma atividade com mais de um R | Detectado pelo nome normalizado, em **Achados → Mais de um responsável**. A edição permite um só R mais corresponsáveis |
| Periodicidade e duração estimadas | Toda atividade importada entra como **estimada**. Ela só vira validada quando a gerência salva a revisão no catálogo, com motivo |
| Técnico Comercial não cabe na semana | **Achados → Carga × capacidade por cargo**, e carga por pessoa na Equipe e na Agenda (8h48 por dia útil, ajustável em Regras) |
| Transferências "somem" | Atividade marcada para transferir **continua na agenda**, com a etiqueta "em transferência", até a gerência registrar o aceite da área destino. A partir da data efetiva, sai da agenda |
| Agenda por cargo, não por pessoa | **Equipe → Ocupação**: quem ocupa cada cargo em cada UTD. Cargo vago aparece como "vago ⚠" |

## Regras da agenda

- **Calendário**: segunda a sexta. Em feriado, a rotina diária não acontece. A semanal e a quinzenal deslizam para o próximo dia útil. A mensal usa o n-ésimo dia útil (`P1`…`P20`), o último dia útil (`U`) ou um dia fixo (`D28`). No dia fixo, se não for dia útil, a data é antecipada, porque prazo regulatório não pode vencer.
- **Concluir** só a própria atividade, só até a data de hoje, e só com evidência (10 a 500 caracteres). Concluir na data original, sem remanejamento, conta na **aderência**. Concluir depois conta só no **cumprimento**.
- **Remanejar** exige motivo e nova data em dia útil, não no passado. Aplica na hora se estiver dentro da janela e for o 1º remanejamento. Janelas: diária = mesmo dia ou próximo dia útil; semanal = mesma semana; quinzenal = mesma quinzena; mensal = mesmo mês. Fora da janela, ou a partir do 2º remanejamento, vira **pedido ao supervisor**. A recusa exige justificativa.
- **Aderência** = concluídas na data original ÷ programadas até ontem (mais as de hoje já concluídas). **Cumprimento** inclui as remanejadas e as feitas com atraso.
- **Catálogo com vigência**: alterar uma atividade cria uma nova versão, que vale de hoje em diante, com motivo obrigatório. O passado não é recalculado.
- **Sob demanda** não entra na agenda nem na aderência. O registro (minutos e descrição) mede o esforço fora da rotina.

## Importar o catálogo real

Use **Catálogo → Baixar modelo** (`modelos/template-catalogo.csv`). As colunas são separadas por `;` e a primeira linha é o cabeçalho:

`codigo; atividade; governanca; indicador; cargo_r (TCO|TMN|ESP|ACO|AGE); corresponsaveis; aprovador_a (SUPERVISOR|vazio); periodicidade (D|W|Q|M|S); situacao (R|S|T); duracao_min; horario (HH:MM|CONT|vazio); dia_semana (1-5); regra_mes (P1…P20|U|D1…D31); evidencia; destino_transferencia`

Cada linha é validada. As linhas recusadas aparecem com o motivo e podem ser baixadas em CSV. Limites: 2 MB e 2.000 linhas.

## Usabilidade (as 7 leis, como no RedeViva)

| Lei | Onde está |
|---|---|
| Fitts | Ação principal larga e fixa no rodapé ("Concluir: próxima atividade"). Todo alvo ≥ 48 px |
| Hick | Barra inferior com no máximo 5 telas por perfil. Uma ação principal por painel. Filtros em listas |
| Zeigarnik | A evidência começada é salva a cada letra e aparece no Hoje: "📝 Evidência começada — Continuar" |
| Jakob | O botão voltar do celular fecha o painel. Painel que sobe de baixo. Agenda semanal no padrão de calendário |
| Gradiente de meta | "Hoje: X de Y · faltam N" com barra de progresso |
| Von Restorff | Vermelho só para o que está atrasado. A periodicidade aparece como sigla em texto (D/S/Q/M), não só pela cor |
| Miller | 4 indicadores na Equipe. Ficha em 2 grupos de 3 (Quando / Quem e o quê). No máximo 3 decisões no Hoje do supervisor |

Remanejar é sempre por toque, sem arrastar. O WCAG 2.2 (2.5.7) exige alternativa ao arrastar, e no celular arrastar entre dias não funciona bem.

## Testes

```bash
bash testes/seguranca-estatica.sh
cd testes && npm install && npx playwright install chromium && npm run e2e:rotina
```

Resultado atual: **36/36** verificações ponta a ponta, 0 pendências estáticas e 0 violações de acessibilidade (axe-core, WCAG 2.1 AA, 15 telas a 360 px). O relatório está em [`docs/relatorio_seguranca_rotina.md`](../docs/relatorio_seguranca_rotina.md).

## O que é simulado (e como fica no produto)

| No protótipo | No produto (Fase 1) |
|---|---|
| Login local (matrícula + senha) | SSO corporativo (OIDC) com MFA |
| Dados e permissões no navegador de cada aparelho | API + banco compartilhado (PostgreSQL com RLS por UTD), com a mesma máquina de regras de `js/acoes.js` reimplementada no servidor |
| Fila de sincronização sem servidor | API com sincronização e conflito decidido no servidor |
| Log no aparelho (com cadeia de hash) | Envio contínuo a servidor só de inclusão / SIEM |
| Catálogo importado por CSV | Mesmo CSV, carregado no servidor por quem tem papel de gerência |

## Estrutura

```
rotina/
  index.html, manifest.webmanifest, sw.js, _headers, icon*
  css/app.css        base visual do RedeViva + estilos da agenda
  js/
    main.js          sessão, navegação por perfil, topo, voltar, service worker
    dominio.js       calendário, catálogo com vigência, motor da agenda, janelas, indicadores, achados
    acoes.js         comandos que alteram estado (permissão, validação e log em cada um)
    ui.js            painel, cartão de atividade, concluir, remanejar, decidir, sob demanda
    hoje.js agenda.js equipe.js catalogo.js   telas
    store.js auditoria.js auth.js acesso.js util.js compat.js config.js   mesma base do RedeViva
    seed.js          dados sintéticos
  modelos/           modelo do catálogo e exemplo com erros
```
