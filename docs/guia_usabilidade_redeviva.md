# Guia de usabilidade — as 7 leis aplicadas ao app de campo

Versão revisada das 7 leis para o contexto de equipes de distribuição (sol forte, luva, uma mão ocupada, pouco sinal, pressa). Cada lei tem **a regra prática**, **onde está no RedeViva** e **como testar**.

| # | Lei | Regra prática para o campo | Onde está no RedeViva | Como testar |
|---|---|---|---|---|
| 1 | **Fitts** — alvo maior e mais perto = toque mais rápido e certo | Ação principal **larga, no rodapé** (alcance do polegar). Todo alvo ≥ 48 px; com luva, prefira 56 px na ação principal | Botão principal fixo no rodapé do painel (56 px); botões e campos de 48 px; checklist com botões **OK / Não conforme / N/A** no lugar de listas suspensas | `testes/e2e.cjs` mede todos os controles visíveis (8.2) |
| 2 | **Hick** — mais opções = decisão mais lenta | **Uma** ação principal por tela; secundárias discretas; listas longas agrupadas | Ação principal escolhida pelo contexto (Continuar › Inspecionar › Registrar execução › Avulsa); mapa com 4 botões (eventuais em "Mais"); defeitos em 3 abas + "Mais filtros"; tipos de defeito agrupados por categoria | Contar opções por tela: ≤ 4 visíveis no mapa, 1 preenchida por painel |
| 3 | **Zeigarnik** — tarefa inacabada puxa para a conclusão | Nunca perder trabalho iniciado e **mostrar** o que ficou pela metade | Inspeção vira rascunho a cada toque; aviso "📝 parou na etapa 2 de 3 — Continuar" no mapa e na ficha do ativo | e2e `UX-ZEIGARNIK`: fecha no meio e retoma na mesma etapa |
| 4 | **Jakob** — o usuário espera o padrão que já conhece | Copiar padrões dos apps de mapa e de celular | Busca por código no topo (como apps de mapa); painel que sobe de baixo, com alça; botão **voltar** do celular fecha o painel; "Rota" abre o Google Maps/Waze | e2e `UX-JAKOB`; testar o voltar do Android |
| 5 | **Gradiente de meta** — perto do fim, mais motivação | Mostrar **progresso** da tarefa e do dia | Assistente em 3 etapas com barra (Checklist → Defeitos → Evidência); barra "Hoje: X de Y · faltam N" para a equipe | e2e `UX-GRADIENTE` |
| 6 | **Von Restorff** — o que se destaca é lembrado; se tudo se destaca, nada se destaca | Reservar cor forte e movimento para o **crítico** | Só defeito de severidade A pulsa; só a próxima ação do fluxo é preenchida; no painel, só os indicadores fora da meta ganham cor; no máximo 3 avisos na tela | Revisão visual: 1 elemento animado, 1 botão preenchido por tela |
| 7 | **Miller** — memória curta é limitada | Agrupar em blocos de 3–4 e pedir **uma decisão por vez** | Ficha do ativo em 2 grupos de 3 (Rede / Impacto); painel em 2 grupos de 4 indicadores (Execução / Risco); legenda em 4 grupos; inspeção em etapas | Nenhum bloco com mais de 4–6 itens sem agrupamento |

## Regras derivadas (para novas telas)

1. Antes de desenhar uma tela, defina **qual é a única ação principal** dela. Se houver duas, é porque são duas telas.
2. Ação principal sempre no rodapé, larga, preenchida. Ações secundárias como contorno ou texto.
3. Formulário com mais de 7 campos vira assistente em etapas, com barra de progresso.
4. Todo formulário de campo salva rascunho automaticamente.
5. Cor vermelha e animação só para risco crítico. Verde só para "concluído".
6. Alvos de toque ≥ 48 px; testar a 360 px de largura e sob luz forte (contraste mínimo WCAG AA).
