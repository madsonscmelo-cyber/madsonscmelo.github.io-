# Proposta: Raio-X de Alimentadores (desempenho 2025–2026, poste a poste)

## 0. O que precisa ficar claro antes

1. **A base real não está aqui.** A "árvore" de desempenho 2025–2026 montada na conversa anterior não está neste repositório. O app foi construído sobre uma rede **sintética** com o mesmo formato e tem **importação por CSV** para carregar a base real. Antes de carregar, confira se a sua planilha tem as colunas da seção 2. A coluna `poste_pai` é a que mais costuma faltar, e sem ela não existe árvore de manobra.
2. **O repositório e o GitHub Pages são públicos.** Ninguém deve subir CSV da rede no repositório. O `.gitignore` bloqueia esses arquivos, e um teste estático falha se aparecer um. A importação acontece só no navegador e a base fica só no aparelho. Mesmo assim, o login é local: ele protege o aparelho, não a URL. Para uso pela equipe com dado real, o caminho é a Fase 1 (seção 6).
3. **A sugestão de chave é estimativa de 1ª ordem.** Ela diz *onde olhar primeiro*, não *onde instalar*. A decisão de instalação passa por estudo de proteção (coordenação, corrente de curto, telecomando).

## 1. A ideia

Hoje a análise de desempenho mostra o *alimentador*. O plano de manutenção trabalha com o *trecho*. Este app faz a ponte entre os dois:

- **Marcação de campo (poste a poste):** árvore, acesso difícil e chaves. Isso descreve *como a rede é*.
- **Resultado (poste a poste, no período):** ocorrências originadas, CHI, compensação e reincidência. Isso descreve *o que a rede fez*.
- **Cruzamento:** postes vizinhos com a mesma marca viram um **trecho** (cluster). O trecho entra na lista quando tem poste com resultado ruim dentro dele. É isso que transforma "o ALM-06 piorou" em algo como "o trecho de árvore que começa no poste 06-0145 tem 12 postes, 0,9 km e gerou 22,8 mil de CHI por vegetação" (exemplo da base sintética).

## 2. O dado que o app espera

| Por poste (obrigatório) | Por poste (recomendado) | Por ocorrência | Por compensação |
|---|---|---|---|
| alimentador, poste, latitude, longitude | **poste_pai**, árvore (S/N), acesso (S/N) e motivo, chave (DJ/RL/CS/CF/NA), trafo, UCs do trafo | data/hora, poste de origem, causa, UCs interrompidas, duração (ou CHI), dispositivo atuado | poste/trafo, mês (ou ano), valor |

Os pontos que mais derrubam a qualidade da análise, em ordem:

1. **Poste de origem da ocorrência.** Sem ele, o CHI fica no alimentador e não desce para o trecho. Se o sistema só registra o dispositivo atuado, use o dispositivo como origem e trate a análise como "por bloco", não "por poste".
2. **`poste_pai` (topologia).** Sem ela, o app liga os postes na ordem do arquivo, o que só funciona se o arquivo vier ordenado pelo caminho da rede. O GIS normalmente consegue exportar essa relação.
3. **Compensação por transformador e mês.** Valor anual por alimentador não permite achar *onde* ela se repete.

## 3. As camadas e como combinar

| Camada | Tipo | Leitura |
|---|---|---|
| 🌳 Árvore | trecho | Vegetação próxima da rede |
| 🚧 Acesso difícil | trecho (tracejado) | Viatura não chega direto: o problema é o **tempo**, não a falha |
| 🔁 Reincidente | ponto | Poste que originou 2+ ocorrências no período |
| R$ Compensação | ponto (anel = valor) | Trafo que pagou compensação |
| ⚡ CHI alto | ponto (tamanho = CHI) | Acima do P80 do alimentador |
| ⏚ Chaves | sobreposição | DJ, RL, CS, CF, NA |

O filtro tem duas regras:

- **E** é interseção: "árvore **e** acesso" = poda difícil.
- **OU** é união: "árvore **ou** acesso" = tudo que exige logística.

**Causa** e **CHI mínimo** refinam o resultado. A camada de *trecho* desenha o cluster, e as camadas de *ponto* dizem quais postes acendem dentro dele.

## 4. Como usar os dados a seu favor: perguntas prontas

| Pergunta | Filtro | Decisão que ela sustenta | Indicador de sucesso |
|---|---|---|---|
| **Onde podar primeiro?** | árvore **E** CHI alto, causa vegetação | Ordem do plano de poda por CHI evitável, antes do período chuvoso | CHI por vegetação no trecho, ano contra ano |
| **Onde o acesso alonga a interrupção?** | acesso **E** CHI alto | Chave telecomandada ou religador no início do trecho, base avançada, rota mapeada. Aqui manutenção sozinha não resolve | Duração média com acesso difícil × normal (aba Resumo) |
| **Onde falta chave?** | árvore de manobra | Blocos com maior CHI originado e posição da ★ chave nova. Com acesso difícil, prefira telecomandada | CHI evitado estimado × CHI medido depois da instalação |
| **Onde a compensação se repete?** | compensação **E** reincidente | Transformador: termografia, balanceamento, troca. É dinheiro que volta todo mês | R$ de compensação do trafo mês a mês |
| **Quem é reincidente?** | reincidente | Análise de causa (MASP) por ponto | Nº de postes reincidentes no período |

Rotina sugerida:

- **Semanal (supervisor):** Mapa do próprio conjunto → "Onde podar primeiro?" e "Quem é reincidente?" → abrir os 3 primeiros trechos → incluir na programação.
- **Mensal (gerência):** Alimentadores → matriz CHI × R$ (quadrante de cima à direita) → Onde agir, ordenado por compensação → Pareto do top 10 → priorizar no plano e no orçamento. É o mesmo raciocínio de risco × retorno da recuperação de energia, aplicado à continuidade.
- **Os 25 transformadores com R$ 100 mil/mês de compensação:** importe a compensação mensal por trafo e use "Onde a compensação se repete?" em Onde agir. A lista mostra quais estão em trecho de árvore (a ação é poda), em acesso difícil (a ação é chave) ou isolados (a ação é o próprio trafo). Isso separa os 25 em três carteiras com dono e custo diferentes.

## 5. O que o protótipo entrega

O protótipo tem cinco telas:

- **Alimentadores:** ano até hoje × mesmo período do ano anterior, matriz e ranking.
- **Mapa:** camadas, perguntas, trechos e árvore de manobra.
- **Onde agir:** a carteira de ações de todos os alimentadores.
- **Dados:** importação com relatório linha a linha.
- **Acesso:** usuários e logs.

O protótipo também segue o padrão de segurança dos outros apps:

- login com política de senha;
- log encadeado;
- CSP;
- nenhum envio de dados.

Ele passou em 29 verificações automatizadas, incluindo acessibilidade WCAG 2.1 AA a 360 px. Detalhes em [`alimentadores/README.md`](../alimentadores/README.md).

## 6. Caminho para produção (Fase 1)

| Hoje (protótipo) | Produção |
|---|---|
| CSV importado no aparelho | Carga diária do GIS (topologia e marcação) e do sistema de ocorrências e compensação, em banco com PostGIS |
| Login local | SSO corporativo (OIDC) com MFA, perfis por conjunto com RLS |
| Tiles do OpenStreetMap | Tiles próprios (PMTiles) no ambiente corporativo |
| CHI evitado de 1ª ordem | Incluir recomposição por manobra (NA) e validar com a área de proteção |
| Marcação de árvore e acesso estática | Atualizada pela inspeção do RedeViva (`app/`): o poste inspecionado atualiza a camada |

## 7. Próximos passos

1. **Validar o formato da base real.** Exportar 1 alimentador e importar na tela Dados. O relatório linha a linha mostra o que falta.
2. **Calibrar os parâmetros com a regulação** (pauta do PDI): limiar de reincidência, percentil de CHI alto e regra de compensação.
3. **Escolher 2 alimentadores-piloto** (um urbano arborizado e um rural de acesso difícil) e comparar o que o app aponta com o que a equipe de campo já sabe. Se o app não acertar os trechos conhecidos, o problema está no dado de origem da ocorrência, não no mapa.
