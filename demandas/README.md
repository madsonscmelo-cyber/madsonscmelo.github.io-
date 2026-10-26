# Central de Demandas: protótipo (Fase 0)

Este app centraliza os pedidos que chegam aos supervisores (RH, Segurança, Regulatório, gerência, áreas centrais), que hoje se espalham por e-mail, WhatsApp, áudio e foto. Cada pedido vira um ticket com dono, prazo, origem e histórico. O supervisor vê a própria agenda por faixa de prazo. A gerência vê no painel quem gera demanda sem antecedência, quem entrega no prazo e quanto do trabalho chegou "fora do radar".

O app segue o mesmo padrão de segurança e usabilidade do RedeViva (`app/`) e da Rotina UTD (`rotina/`): login com política de senha, log com cadeia SHA-256, CSP restritiva sem domínio externo, interface montada só com `textContent`, alvos de toque ≥ 48 px e os mesmos testes.

> **Dados 100% sintéticos.** Pessoas, matrículas e demandas de demonstração são fictícias. O que for registrado fica só no aparelho (IndexedDB), nunca no repositório, que é público.

## Como rodar

```bash
python3 -m http.server 8080
# abrir http://localhost:8080/demandas/
```

Senha inicial de todos os usuários: `Demandas@2026`. O app obriga a criar uma senha pessoal no primeiro acesso.

| Matrícula | Perfil | O que faz |
|---|---|---|
| `S2101`, `S2102` | Supervisores · Setor Sul | Registram o que receberam (voz, texto, foto), trabalham os próprios tickets: iniciar, delegar à equipe, marcar fora do radar, concluir |
| `S2201`, `S2202` | Supervisores · Setor Norte | Idem |
| `D3001` · `D3002` · `D3003` | Área demandante (RH, Segurança, Regulatório) | Abrem pedidos para um supervisor ou um grupo e acompanham o atendimento. Completam o dado que faltou |
| `G2001` | Gerência operacional | Envia para qualquer supervisor ou grupo, vê todas as agendas e o painel, cadastra e gera rituais, administra acessos |
| `A2001` | Auditoria | Só consulta agenda, painel e logs |

## Fluxo da nova demanda

1. **Capturar.** O pedido entra do jeito que chegou: ditado (botão 🎙 ou microfone do teclado do celular), texto colado de e-mail ou zap, e foto/print anexada.
2. **Estruturar.** O interpretador monta o formulário: o que fazer, quem pediu, área, para quem, prazo, tipo, entregável e urgência. Ele entende datas relativas ("sexta", "amanhã", "dia 13", "fim do mês") e grupos ("setor sul", "todos os supervisores"). Cada campo deduzido tem um ponto laranja ("confira"). O que falta fica com contorno vermelho.
3. **Assistente.** Pergunta só o que falta, no máximo 3 perguntas. Quando quem registra não sabe o prazo, o entregável ou quem pediu, o botão "Não sei" marca o dado como **pendente com quem pediu**. A demanda é criada mesmo assim e entra no indicador de pedidos incompletos daquela área.
4. **Radar.** O pedido é "fora do radar" quando chega com menos de 5 dias úteis de antecedência ou sem prazo. Quem recebeu pode ajustar, com motivo obrigatório: nova exigência, última hora, retrabalho, falha de outra área ou emergência legítima.
5. **Confirmar.** Para um grupo, o app cria uma demanda-mãe, que é a visão de quem pediu, e um ticket por supervisor.

O pedido começado e não criado fica salvo como rascunho e aparece na agenda ("📝 Pedido começado"). Esse é o efeito Zeigarnik, como na Rotina UTD.

## Regras

- **Supervisor** registra demandas **para si mesmo**. Para mandar a outros supervisores, o pedido vai pela gerência ou pela área demandante. Assim o supervisor não vira despachante de outros supervisores.
- **Trabalhar o ticket** (iniciar, concluir, delegar, radar, reabrir) é do supervisor destinatário. A gerência também pode, para cobrir férias, por exemplo. Delegar só para alguém da própria equipe: a demanda continua sob responsabilidade do supervisor.
- **Pendência** é completada por quem pediu, por quem recebeu ou pela gerência. Na demanda-mãe, o dado vale para todos os tickets do grupo.
- **Cancelar** é de quem pediu ou da gerência, com motivo. **Reabrir** exige motivo.
- **Rituais** (MASP, RAD, DEC/FEC): o calendário pode usar o n-ésimo dia útil, o último dia útil ou um dia fixo. O dia fixo é antecipado quando cai no fim de semana. Gerar de novo não duplica. Ritual cuja data já passou no mês não é gerado, para não nascer atrasado.
- **Faixas da agenda**: Atrasadas → Vencem hoje → Próximos 3 dias → 4 a 5 dias ("dá para antecipar") → Mais adiante → Sem prazo → Concluídas. A faixa aparece em texto e ícone, não só na cor.

## Painel da gerência

| Indicador | Para que serve |
|---|---|
| Antecedência média por área (dias úteis) | Mostra quem pede em cima da hora |
| Urgência para ontem por área | Pedidos urgentes ou com menos de 2 dias úteis |
| Fora do radar por área e por motivo | Separa urgência legítima de desorganização (retrabalho, falha de outra área) |
| Pedidos incompletos por área | Pedidos que nasceram sem prazo, entregável ou solicitante |
| Por supervisor: abertas, atrasadas, % no prazo, antecipou | Mostra carga e pontualidade. Use para balancear carga antes de usar para cobrar |
| Pedidos para grupos | Atendimento de cada pedido ("3 de 4") |
| Tipos e canais de entrada | Quanto ainda chega por zap, voz ou foto |

A exportação em CSV neutraliza fórmulas (proteção contra CSV injection).

## Segurança e privacidade

| Item | Como está |
|---|---|
| Login | Matrícula e senha com política (10+ caracteres, 3 classes, sem nome nem matrícula, sem senha comum). PBKDF2-SHA-256 com 210 mil iterações. Bloqueio após 5 erros. Mensagem única para senha errada e matrícula inexistente |
| Sessão | Bloqueia após 20 min sem uso e encerra após 10 h. Fechar a aba encerra |
| Permissões | Checadas em cada comando (`js/acoes.js`), inclusive quando chamado pelo console. Toda ação negada é registrada |
| Log | Só inclusão, encadeado por SHA-256, com verificação de integridade na tela Acesso. O texto dos pedidos e as senhas não entram no log |
| XSS | Nenhum `innerHTML`. Todo texto vai por `textContent`. O teste injeta `<img onerror>` no título e confere que aparece como texto |
| CSP | `default-src 'self'`, sem CDN, sem fonte externa e sem API de terceiros. Recusa abrir dentro de iframe |
| Imagem anexada | Reduzida a ≤ 1280 px e regravada em JPEG. Isso remove os metadados (EXIF, inclusive localização) |
| Ditado | Usa o reconhecimento de voz do navegador. **No Chrome, o áudio é processado pelo serviço do Google.** Por isso a tela pede para não ditar CPF, endereço ou dados de clientes. Em produção, o ditado precisa ser homologado com Segurança da Informação, ou trocado por transcrição no ambiente corporativo |

## O que é simulado (e como fica no produto)

| No protótipo | No produto (Fase 1) |
|---|---|
| Cada aparelho tem a própria base: o pedido do RH não chega ao celular do supervisor | API e banco compartilhado (PostgreSQL com RLS por perfil e setor), com as regras de `js/acoes.js` reimplementadas no servidor |
| Interpretador por regras no aparelho (`js/interpretador.js`) | Modelo de linguagem hospedado no ambiente corporativo, com a mesma saída: campos, confiança por campo e até 3 perguntas. Pode ler a foto ou o print |
| Login local | SSO corporativo (OIDC) com MFA |
| Captura só pelo app | Caixa de e-mail dedicada (encaminhar = abrir rascunho) e canal no Teams |
| Log no aparelho | Envio contínuo a servidor só de inclusão / SIEM |

## Testes

```bash
bash testes/seguranca-estatica.sh
cd testes && npm install && npx playwright install chromium && npm run e2e:demandas
```

Resultado atual: **26/26** verificações ponta a ponta e 0 pendências estáticas. Também passam 0 violações de acessibilidade (axe-core, WCAG 2.1 AA, 10 telas a 360 px), alvos de toque ≥ 48 px e nenhuma rolagem horizontal. O CI (`.github/workflows/seguranca-app.yml`) cobre `demandas/`: gitleaks, Semgrep, sintaxe, proibição de `innerHTML`/`eval` e CSP.

## Estrutura

```
demandas/
  index.html, manifest.webmanifest, sw.js, _headers, icon*
  css/app.css          base visual do RedeViva/Rotina + estilos da central
  js/
    main.js            sessão, navegação por perfil, topo, voltar, service worker
    dominio.js         perfis, grupos, dias úteis, radar, faixas de prazo, indicadores
    interpretador.js   texto livre → formulário estruturado + perguntas do que falta
    acoes.js           comandos que alteram estado (permissão, validação, histórico e log em cada um)
    ui.js              painel lateral, cartão de demanda, ficha e formulários das ações
    agenda.js nova.js rituais.js painel.js   telas
    store.js auditoria.js auth.js acesso.js util.js compat.js config.js   mesma base do RedeViva/Rotina
    seed.js            dados sintéticos (datas relativas a hoje)
```
