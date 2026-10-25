# RedeViva — funcionalidades para controle de ponta a ponta e caminho para produção

Marcações de confiança: **[CERTEZA]**, **[PROVÁVEL]**, **[SUPOSIÇÃO]**.

---

## 1. Funcionalidades adicionais por etapa do processo

O protótipo cobre **inspeção → defeito → execução → verificação**. Para fechar o processo de ponta a ponta faltam as pontas: **antes** (capacidade e programação, incluindo desligamentos e materiais) e **depois** (resultado em DEC/compensação e custo).

| Etapa | Funcionalidade | Por que importa | Fase |
|---|---|---|---|
| **Planejar** | Capacidade × demanda: horas-homem disponíveis por tipo de equipe × horas estimadas do backlog | Mostra se o plano cabe no mês **antes** de prometer aderência | F1 |
| | Gatilho por ocorrência: falha registrada no OMS em trafo/chave gera inspeção avulsa automática e marca reincidência | Transforma o critério "reincidente" de manual em automático | F2 |
| | Priorização por janela regulatória: peso maior para conjunto perto de estourar o limite de DEC no ano | Direciona o esforço para onde ainda dá para salvar o indicador | F2 |
| **Programar** | **Pacote de desligamento**: agrupa os defeitos que exigem desligamento no mesmo trecho/chave em uma única interrupção programada, com UCs afetadas e prazo de aviso aos clientes | Uma interrupção programada também conta no DEC: resolver 5 defeitos num desligamento custa menos que 5 desligamentos | F1 |
| | Roteiro do dia otimizado por proximidade e tipo de equipe | Menos deslocamento, mais execução por turno | F2 |
| | Kit de materiais por ordem (reserva no almoxarifado) | Evita equipe parada por falta de material; liga com os pacotes de ferramental | F2 |
| **Executar** | **APR / checklist de segurança digital (NR-10)** antes de iniciar execução de turma pesada e linha viva | Segurança da equipe e evidência em auditoria | F1 |
| | Check-in/check-out no ativo (horário + GPS) | Tempo real de execução, base para custo e capacidade | F1 |
| | Leitura de QR code/plaqueta do ativo | Elimina erro de ativo (o maior problema de qualidade de cadastro em campo) | F2 |
| | Apontamento de materiais aplicados e de interrupção (início/fim, UCs) | Fecha custo e CHI realizado | F1 |
| | Medições anexas (termografia, corrente do trafo) | Defeito "conexão aquecida" passa a ter número, não só foto | F3 |
| **Controlar qualidade** | Auditoria amostral: sorteio de X% dos registros para revisita do supervisor | Mede a confiabilidade do dado de campo e inibe registro fraco | F1 |
| | Reincidência pós-manutenção por equipe e por causa | Já existe o estorno no ranking; falta o painel | F1 |
| | IA na foto (classificação de defeito, antes × depois) | Reduz validação manual | F3 |
| **Dar visibilidade** | Curva S do plano (físico) e custo realizado × orçado | Linguagem de diretoria | F1 |
| | **Painel regulatório**: DEC/FEC por conjunto × limite, compensação acumulada no ano e projeção | Liga a manutenção ao resultado que a regulação cobra | F2 |
| | **Eficiência: R$ por CHI evitado** por tipo de serviço e por equipe | Mostra onde cada real de manutenção rende mais confiabilidade | F2 |
| | Relatório semanal automático (e-mail/Teams) para gestão | Visibilidade sem precisar abrir o sistema | F2 |
| **Integrar** | SAP PM (notas e ordens), GIS corporativo, OMS (ocorrências) | Evita base paralela; o SAP continua sendo o registro oficial | F2 |

---

## 2. Gamificação dos avulsos com CHI evitado

**Discordância:** premiar "quem tira mais avulso" incentiva três comportamentos ruins [PROVÁVEL]:
1. registrar defeito pequeno ou duvidoso para somar pontos;
2. trocar a inspeção programada (que dá menos pontos) por avulso;
3. registrar como avulso algo que já estava no plano da própria equipe.

**Proposta: "Caçador de risco" — pontua o risco removido, não a quantidade.**

```
CHI evitado (estimado) = UCs a jusante × P(falha em 12 meses | severidade) × duração média de interrupção do alimentador (h)
```

| Severidade | P(falha em 12 meses) — ponto de partida [SUPOSIÇÃO] |
|---|---|
| A | 0,50 |
| B | 0,20 |
| C | 0,05 |

Exemplo: trafo com 120 UCs, defeito A, duração média de 3 h → 120 × 0,5 × 3 = **180 CHI evitados (estimado)**.

> As probabilidades precisam ser **calibradas com o histórico** (ativos com defeito registrado e não corrigido × falhas nos 12 meses seguintes). Sem isso, o número é uma estimativa de ordem de grandeza e deve aparecer assim na tela ("estimado").

**Regras de proteção**

| Regra | Efeito |
|---|---|
| Só pontua defeito **validado** pelo supervisor | Corta o registro duvidoso |
| Rejeição tira pontos | Corta a "pesca" de defeito |
| Avulso em ativo que já tinha inspeção programada **da própria equipe** não pontua como avulso | Evita trocar o plano pelo avulso |
| Bônus de avulso só vale se a aderência ao programado da equipe for ≥ 85% | O plano vem primeiro |
| Teto diário de pontos de avulso | Evita corrida por volume |
| Auditoria amostral dos avulsos premiados | Garante que o defeito existia |
| Ranking separado por tipo de equipe | Linha viva não compete com inspeção |
| Reconhecimento não financeiro no início; premiação em dinheiro só com RH/jurídico | Evita passivo trabalhista |

Indicadores para mostrar: **CHI evitado (estimado)** e **compensação em risco removida (R$)** por equipe, com os avulsos validados como destaque.

---

## 3. O que é preciso para rodar em produção

### 3.1 Dados

| Dado | Fonte provável | Situação | Observação |
|---|---|---|---|
| Traçado dos alimentadores (tronco e ramais) | **KMZ que você tem** | ✅ disponível | Precisa conferir o que vem dentro (ver 3.2) |
| Ativos com código: postes, trafos, chaves, religadores | GIS corporativo (exportação shapefile/CSV) | ❓ | **O KMZ normalmente não traz isso com o código do GIS** [PROVÁVEL] |
| Alimentador e conjunto de cada ativo | GIS | ❓ | Pode ser derivado do KMZ por proximidade, com validação |
| UCs por trafo e a jusante de cada ativo | GIS/comercial (contagem agregada) | ❓ | Só a contagem; nenhum dado de cliente |
| Plano de manutenção (ativo × critério × última inspeção) | **Plano que você tem** | ✅ disponível | Converter para o template `app/modelos/template-plano.csv` |
| Defeitos/notas abertas | SAP PM | ❓ | Carga inicial para não começar do zero |
| Compensação 12 meses por trafo/UC (agregada) | Área de qualidade/regulação | ❓ | Alimenta o score de risco |
| DEC/FEC por conjunto e limites | Regulação | ❓ | Planilha basta no início |
| Duração média de interrupção por alimentador | OMS | ❓ | Para o CHI evitado |
| Catálogo oficial de defeitos e severidades | Manutenção | ❓ | Reaproveitar o padrão existente |
| Equipes, tipos, bases e usuários | Operação / RH | ❓ | Matrícula e e-mail corporativo (para o SSO) |

### 3.2 O que conferir no KMZ (5 minutos no Google Earth)

1. Abrir o KMZ → clicar em um traçado e ver se aparece uma tabela de atributos (código do alimentador, trecho, fase, bitola).
2. Ver se há **pontos** (postes, trafos, chaves) ou só **linhas**.
3. Ver se os pontos têm o **código do GIS/SAP** (ex.: número da plaqueta ou do trafo).
4. Verificar se há um KMZ por alimentador ou um único arquivo com vários.

| Se o KMZ tiver... | Então |
|---|---|
| Só linhas | Usamos para o traçado e para o recorte do mapa offline; os ativos vêm do GIS |
| Linhas + pontos com código | Dá para carregar ativos direto do KMZ e cruzar com o plano pelo código |
| Pontos sem código | Serve só como referência visual; precisa do GIS |

### 3.3 Sistema (Fase 1)

| Componente | Proposta | Bloqueia produção? |
|---|---|---|
| Banco | PostgreSQL + PostGIS, com RLS por território | Sim |
| API e regras | Máquina de estados do defeito e permissões no servidor (hoje estão no navegador) | Sim |
| Login | SSO corporativo (Microsoft Entra ID) com MFA; perfil pelo grupo do AD | Sim |
| Fotos | Armazenamento privado, URL assinada de curta duração | Sim |
| Hospedagem | Ambiente corporativo homologado (não o GitHub Pages público) | Sim |
| Mapa | Servidor de mapas próprio (PMTiles da área de concessão), sem limite de download offline | Sim, para áreas rurais extensas |
| Aparelhos | Android corporativo com MDM (instalação, remote wipe) | Recomendado |
| App nativo (Capacitor) | Alerta de proximidade com o app fechado | Não (pode vir depois) |
| Integração SAP PM | Exportação CSV no início; integração em F2 | Não |

### 3.4 Governança

1. **Patrocínio de TI e Segurança da Informação**: hospedagem, SSO, pentest antes da produção.
2. **LGPD**: registro do tratamento (ROPA) com o DPO; geolocalização da equipe só em turno, com finalidade declarada.
3. **Dono do processo**: Operação (você) define critérios, catálogo e metas; TI opera a plataforma.
4. **Checklist de segurança v1.1**: fases 2, 3, 4, 5, 7 e 9 refeitas contra o servidor.

### 3.5 Sequência sugerida [SUPOSIÇÃO de prazos]

| Semana | Entrega |
|---|---|
| 1 | Conferir KMZ e exportações do GIS; fechar catálogo de defeitos e critérios |
| 2 | Importador KMZ → traçado e ativos; plano no template; validação dos dados de um polo |
| 3–6 | Backend, SSO, fotos privadas, regras no servidor (com TI) |
| 7–8 | Pentest, checklist de segurança, treinamento |
| 9–10 | Piloto com 1 polo e 3–5 equipes |
| 11–12 | Ajustes e decisão de expansão (critérios de go/no-go da especificação) |

Equipe mínima [SUPOSIÇÃO]: 1 desenvolvedor full stack, 1 analista de dados/GIS em meio período, apoio de TI/SI e um ponto focal da operação.
