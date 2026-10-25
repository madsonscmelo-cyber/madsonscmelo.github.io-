# Especificação Funcional e Técnica — Plataforma de Plano de Manutenção e Inspeção de Rede (v0.1)

> Documento de partida para desenvolvimento. Marcações de confiança: **[CERTEZA]**, **[PROVÁVEL]**, **[SUPOSIÇÃO]**.
> Nome provisório: **RedeViva** (ajustar).

---

## 0. Alertas antes de começar (ler primeiro)

1. **Governança de dados corporativos.** A plataforma vai conter a topologia georreferenciada da rede, ativos críticos, dados de conjuntos elétricos e potencialmente de UCs. Desenvolver e hospedar isso em conta pessoal (GitHub pessoal, nuvem pessoal) fora do ambiente da distribuidora é risco de conformidade com a política de Segurança da Informação do grupo e com a LGPD. **[CERTEZA]** O caminho correto é: protótipo com **dados sintéticos/anonimizados** e, para produção, patrocínio formal de TI/SI corporativa (hospedagem, SSO, homologação).
2. **Não é um app simples — é um sistema de gestão de ativos + GIS de campo.** Sobrepõe funções do GIS corporativo e do SAP PM (notas/ordens de manutenção). **[PROVÁVEL]** Se não for desenhado como camada de execução **integrada** a esses sistemas, vira mais uma base paralela e perde credibilidade na auditoria regulatória. Defina cedo: o app é *sistema de registro* ou *sistema de engajamento* (recomendo engajamento, com o SAP PM como registro oficial).
3. **Alerta de proximidade em segundo plano não funciona em PWA puro no iOS.** **[CERTEZA]** Web apps não têm geolocalização em background/geofencing confiável. Solução: PWA para o núcleo + empacotamento com **Capacitor** (Android/iOS) para geofence, notificações locais e câmera nativa. Em Android corporativo via MDM, a distribuição fica simples.
4. **Campo sem sinal é a regra, não a exceção** (ex.: região de Remanso). **[CERTEZA]** Offline-first (mapas, plano, cadastro de inspeção e fotos) é requisito do MVP, não melhoria futura.
5. **Ranking de equipes pode degradar a qualidade.** Ranking por volume incentiva inspeção superficial e defeito "inflado". O ranking precisa ser ponderado por validação, severidade e taxa de retrabalho (ver §8).

---

## 1. Objetivo e indicadores de sucesso

**Problema:** o plano de manutenção (inspeções periódicas por criticidade + defeitos identificados) está disperso em planilhas e sistemas; o campo não tem visão geográfica do que fazer; a gestão não enxerga evolução, aderência ao plano nem risco regulatório evitado.

**Objetivo:** uma plataforma única, visual e baseada em mapa, que conecte **plano → inspeção → defeito → execução → evidência → resultado (DEC/FEC/compensação)**.

| Indicador | Definição | Meta inicial [SUPOSIÇÃO] |
|---|---|---|
| Aderência ao plano de inspeção | Inspeções realizadas no prazo / programadas no período | ≥ 90% |
| Backlog de defeitos por severidade | Qtde e idade média de defeitos abertos (A/B/C) | Defeito crítico ≤ 7 dias |
| Lead time defeito → execução | Dias entre registro e baixa | Redução de 30% em 6 meses |
| Reincidência pós-manutenção | Falhas no mesmo ativo em 90 dias após baixa | Tendência de queda |
| Compensação evitada (proxy) | Δ compensação (DIC/FIC/DMIC) nos conjuntos/trafos priorizados | Ex.: 25 trafos ≈ R$ 100 mil/mês como linha de base |
| Qualidade do registro | % registros com foto + geolocalização válida + validado | ≥ 95% |

---

## 2. Perfis de acesso (RBAC + escopo territorial)

| Perfil | Pode | Escopo |
|---|---|---|
| **Administrador** | Configurar critérios, periodicidades, tipos de defeito, usuários | Global |
| **Gestor / Planejamento** | Importar plano, priorizar, despachar, aprovar, ver dashboards | Regional/Polo |
| **Supervisor de campo** | Distribuir trabalho entre equipes, validar registros | Base/Polo |
| **Inspetor / Eletricista** (equipe) | Ver mapa e rota, executar inspeção, registrar defeito/manutenção, fotos, ver sua produção | Área atribuída |
| **Auditor / Consulta** | Somente leitura, trilha de auditoria | Conforme designação |

Regra: todo dado é filtrado por **escopo territorial** no backend (Row Level Security), nunca apenas no front.

---

## 3. Modelo de domínio

- **Ativo de rede**: poste, vão/trecho, chave fusível, chave faca/religador, transformador, tronco/ramal de alimentador. Referência ao código do GIS corporativo. Geometria ponto ou linha.
- **Critério de inspeção** (o que marca o ativo para inspeção): *trafo reincidente*, *tronco de alimentador*, *chave fusível reincidente*, *alimentador crítico DEC*, *trecho com histórico de vegetação*, *pior conjunto*, etc. Cada critério tem **periodicidade** (ex.: tronco a cada 6 meses; trafo reincidente a cada 3 meses) e prioridade-base.
- **Plano de manutenção**: conjunto versionado de ativos + critérios + metas por período (importado ou gerado).
- **Inspeção**: *programada* (gerada pela periodicidade) ou **avulsa** (iniciada em campo). Resultado: sem anomalia / com defeitos.
- **Defeito**: identificado na inspeção ou cadastrado diretamente. Categoria (estrutural, vegetação/poda, isolamento, aterramento, ninho de pássaro, cruzeta, conexão, equipamento), **severidade** (A crítico / B / C), **tipo de equipe exigida**, fotos, localização, nível de risco.
- **Tipo de equipe**: leve/manutenção, **turma pesada**, **linha viva**, poda, inspeção. Cada tipo de defeito mapeia um ou mais tipos de equipe aptos.
- **Ordem de execução**: agrupamento de defeitos atribuído a uma equipe (opcionalmente espelha nota/ordem SAP PM).
- **Execução/baixa**: atividade realizada (poda, retirada de ninho, troca de cruzeta...), fotos antes/depois, materiais, horário, equipe. Fecha o defeito após validação.
- **Evidência**: foto com metadados (geo, data/hora, autor, hash).

### Ciclo de vida do defeito
`Identificado → Validado → Priorizado → Programado → Em execução → Executado → Verificado (fechado)` — com possibilidade de `Cancelado (justificativa)` e `Reaberto`.

---

## 4. Fluxo principal

1. Gestor importa/atualiza o **plano** (planilha padrão ou integração GIS) e as marcações de criticidade.
2. O motor de periodicidade gera as **inspeções devidas** no período.
3. Supervisor distribui por **disponibilidade e tipo de equipe**; o sistema sugere agrupamento geográfico.
4. Equipe abre o **mapa**, vê seus pontos, recebe **rota** e **alerta de proximidade** quando passa perto de um ativo/trecho com inspeção ou defeito pendente.
5. Em campo: seleciona o ativo (ou desenha/seleciona uma área), registra inspeção, defeitos, fotos — **offline**.
6. Defeitos entram na fila, recebem **score de risco** e são direcionados ao tipo de equipe adequado (turma pesada, linha viva...).
7. Equipe executa, dá baixa com evidência; supervisor valida.
8. Dashboards consolidam aderência, backlog, produção, ranking e risco evitado.

---

## 5. Requisitos funcionais

Prioridade: **M** = MVP, **F2** = fase 2, **F3** = fase 3.

### 5.1 Mapa (núcleo da experiência)
| ID | Requisito | Prio |
|---|---|---|
| RF-MAP-01 | Mapa base com camadas: ativos, trechos de alimentador, inspeções pendentes, defeitos abertos, executados | M |
| RF-MAP-02 | Simbologia por status e cor por severidade/risco; clusterização em zoom baixo | M |
| RF-MAP-03 | Filtros: alimentador, conjunto, critério, tipo de defeito, tipo de equipe, prazo, severidade | M |
| RF-MAP-04 | Seleção de ativo por toque e **seleção por área** (polígono/laço) para inspeção em lote | M |
| RF-MAP-05 | Posição do usuário em tempo real e "o que está perto de mim" (raio configurável) | M |
| RF-MAP-06 | **Mapas offline** por área de trabalho (download de tiles/vetoriais antes de sair da base) | M |
| RF-MAP-07 | Mapa de calor de defeitos e de risco (gestão) | F2 |
| RF-MAP-08 | Visão Street-level/foto do ativo no popup (última evidência) | F2 |

### 5.2 Rotas e alertas de proximidade
| ID | Requisito | Prio |
|---|---|---|
| RF-ROT-01 | Rota da posição atual ao ponto selecionado (abrir no Google Maps/Waze como fallback) | M |
| RF-ROT-02 | Roteiro otimizado do dia (sequência de pontos) | F2 |
| RF-ROT-03 | **Alerta de proximidade** (geofence) quando a equipe passa a X m de ativo com pendência compatível com seu tipo de equipe | M (app Capacitor) |
| RF-ROT-04 | Controle anti-spam de alertas (silenciar por ativo/dia, só em horário de turno) | M |

### 5.3 Plano de manutenção
| ID | Requisito | Prio |
|---|---|---|
| RF-PLN-01 | Upload do plano via planilha padrão (XLSX/CSV) com validação linha a linha e relatório de erros | M |
| RF-PLN-02 | Cadastro de critérios de inspeção e periodicidades | M |
| RF-PLN-03 | Motor que gera inspeções devidas a partir de critério + última inspeção | M |
| RF-PLN-04 | Versionamento do plano (quem alterou, quando, o quê) | M |
| RF-PLN-05 | Integração com GIS corporativo e SAP PM (notas/ordens) | F2 |
| RF-PLN-06 | Importação de indicadores de continuidade (DEC/FEC por conjunto, DIC/FIC por UC/trafo, histórico de interrupções) | F2 |

### 5.4 Inspeção e defeitos (app de campo)
| ID | Requisito | Prio |
|---|---|---|
| RF-INS-01 | Executar inspeção programada com checklist por tipo de ativo | M |
| RF-INS-02 | Registrar **inspeção avulsa** (fora do plano) com justificativa | M |
| RF-INS-03 | Registrar defeito: categoria, severidade, tipo de equipe exigida, descrição, fotos (mín. 1), geolocalização automática | M |
| RF-INS-04 | Registrar **manutenção realizada na hora** (ex.: retirada de ninho, poda leve) já com baixa | M |
| RF-INS-05 | Retirar/baixar defeitos que estão no plano com foto antes/depois | M |
| RF-INS-06 | Funcionamento 100% offline com fila de sincronização visível | M |
| RF-INS-07 | Validação de qualidade: foto obrigatória, distância máx. entre GPS e ativo (ex.: 50 m), carimbo de data/hora no servidor | M |
| RF-INS-08 | Fotos com marca d'água (data, coordenada, ativo) e compressão | M |
| RF-INS-09 | Ditado por voz para descrição | F3 |
| RF-INS-10 | Sugestão de classificação de defeito por IA a partir da foto | F3 |

### 5.5 Despacho e equipes
| ID | Requisito | Prio |
|---|---|---|
| RF-EQP-01 | Cadastro de equipes, tipo (leve, pesada, linha viva, poda, inspeção), base e disponibilidade | M |
| RF-EQP-02 | Matriz tipo de defeito × tipo de equipe apta | M |
| RF-EQP-03 | Atribuição manual e sugestão automática (proximidade + tipo + carga) | M / F2 |
| RF-EQP-04 | Equipe vê sua **produção** (inspeções, defeitos identificados, executados, pontos) | M |
| RF-EQP-05 | Ranking de equipes ponderado (ver §8) | M |

### 5.6 Gestão e dashboards
| ID | Requisito | Prio |
|---|---|---|
| RF-DSH-01 | Painel do plano: programado × realizado, aderência por critério/alimentador/equipe | M |
| RF-DSH-02 | Backlog de defeitos por severidade, idade, tipo de equipe exigida | M |
| RF-DSH-03 | Curva de evolução (burn-down do plano) | M |
| RF-DSH-04 | Painel de risco: defeitos ordenados por score com impacto DEC e compensação estimada | M |
| RF-DSH-05 | Correlação manutenção × reincidência × compensação (antes/depois) | F2 |
| RF-DSH-06 | Exportação (XLSX/PDF) para reunião de resultados e regulação | M |

---

## 6. Priorização por risco (DEC e compensação)

Proposta de **score de risco (0–100)**, configurável pelo administrador:

```
Score = Severidade (0–40)
      + Impacto em clientes (0–20)    → CHI / nº de UCs a jusante do ativo
      + Criticidade DEC/FEC (0–15)    → conjunto acima da meta ANEEL / alimentador pior
      + Exposição à compensação (0–15)→ R$ compensação histórica (DIC/FIC/DMIC) das UCs a jusante
      + Reincidência (0–10)           → nº falhas no ativo em 12 meses
```

- **[CERTEZA]** Compensação é por UC (violação de DIC/FIC/DMIC/DICRI — PRODIST Módulo 8); por isso o impacto financeiro deve ser calculado a partir das UCs **a jusante** do ativo, não do conjunto inteiro.
- **[PROVÁVEL]** No MVP, sem integração topológica, usar proxy: nº de UCs do trafo/trecho + compensação histórica importada por planilha.
- Faixas: ≥70 crítico (vermelho), 40–69 alto (laranja), 20–39 médio (amarelo), <20 baixo (verde).

---

## 7. Experiência visual (diretrizes)

- **Mapa é a tela inicial** de todos os perfis; listas e dashboards são visões secundárias do mesmo dado.
- Modo **alto contraste/luz solar** e botões grandes (uso com luva, sob sol).
- Máx. 3 toques para registrar um defeito a partir do ativo selecionado.
- Cores semânticas consistentes entre mapa e dashboard (severidade = mesma cor em todo lugar).
- Indicador permanente de status: online/offline, itens pendentes de sincronização.

---

## 8. Ranking de equipes (sem efeito colateral)

Pontuação proposta:
- Inspeção concluída no prazo: peso por criticidade do critério.
- Defeito identificado **validado** pelo supervisor: pontos × severidade. Defeito rejeitado: penaliza.
- Execução/baixa validada: pontos × severidade × tipo de serviço.
- Reincidência no ativo em 90 dias após baixa: estorna pontos.
- Registro sem foto/geo válida: não pontua.

Ranking separado **por tipo de equipe** (não comparar linha viva com inspeção).

---

## 9. Requisitos não funcionais

| ID | Requisito |
|---|---|
| RNF-01 | Offline-first: app de campo opera um turno inteiro sem rede; sincronização incremental e resiliente |
| RNF-02 | Resolução de conflitos: servidor é a fonte de verdade; conflitos de status geram fila para supervisor |
| RNF-03 | Mapa fluido com até 100 mil feições (vector tiles + clusterização) |
| RNF-04 | Disponibilidade 99,5% no horário de operação |
| RNF-05 | Suporte Android 10+ e iOS 16+; navegador desktop para gestão |
| RNF-06 | Fotos comprimidas (~300–500 KB), upload em segundo plano |
| RNF-07 | Acessibilidade WCAG 2.1 AA no módulo web |
| RNF-08 | Observabilidade: logs estruturados, métricas, alertas de falha de sincronização |

---

## 10. Baseline de segurança

Referências: **OWASP ASVS 4.0 nível 2** (web/API), **OWASP MASVS** (app móvel), **LGPD**, política de SI do grupo.

### 10.1 Identidade e acesso
- SSO corporativo (OIDC/SAML — provavelmente Microsoft Entra ID **[SUPOSIÇÃO]**) com **MFA**; nada de senha local em produção.
- RBAC + escopo territorial aplicado no banco (**Row Level Security**).
- Sessão: tokens de curta duração (≤ 15 min) + refresh rotativo; revogação imediata ao desligar usuário.
- Princípio do menor privilégio; contas de serviço separadas por integração.

### 10.2 Dados
- TLS 1.2+ em todo tráfego; HSTS.
- Criptografia em repouso (banco e storage de fotos); chaves gerenciadas (KMS).
- Dados no dispositivo: armazenamento seguro (Keychain/Keystore para tokens; base local criptografada); expiração do cache offline; **remote wipe via MDM**.
- Fotos: remover metadados EXIF sensíveis do original, manter só os campos controlados pelo app; hash SHA-256 para integridade da evidência.
- URLs de fotos assinadas e temporárias (nunca bucket público).

### 10.3 LGPD
- **Geolocalização de empregado é dado pessoal.** **[CERTEZA]** Coletar posição apenas em turno, com finalidade declarada (segurança e execução do serviço), aviso claro no app e política de retenção (ex.: trilha de posição 90 dias).
- Dados de UC/cliente: só agregados no MVP (nº de UCs, R$ compensação), sem nome/CPF.
- Registro de operações de tratamento (ROPA) e avaliação com o DPO.

### 10.4 Aplicação e API
- Validação de entrada no servidor (schema), proteção contra injeção, XSS, CSRF, IDOR (checagem de escopo em todo endpoint).
- Upload: validação de tipo real (magic bytes), tamanho máximo, varredura antivírus.
- Rate limiting e proteção contra força bruta.
- Cabeçalhos de segurança (CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy).
- Segredos fora do código (cofre/variáveis de ambiente); nunca em repositório.
- Trilha de auditoria imutável: quem criou/alterou/validou/cancelou cada inspeção e defeito.

### 10.5 Pipeline (o "script" de segurança)
Rodar em todo PR/CI:
| Verificação | Ferramenta sugerida |
|---|---|
| Vazamento de segredos | gitleaks |
| SAST | Semgrep (regras OWASP) |
| Dependências (SCA) | npm audit / OSV-Scanner / Dependabot |
| Contêiner/IaC | Trivy |
| DAST (homologação) | OWASP ZAP baseline |
| Mobile | MobSF (análise do APK/IPA) |

Antes da produção: pentest independente e aceite da SI corporativa.

---

## 11. Arquitetura proposta

```
[App de campo: PWA React + Capacitor]──┐
   MapLibre GL • IndexedDB/SQLite      │  HTTPS / OIDC
   fila offline • geofence nativo      │
                                       ▼
[Web gestão: React + MapLibre]──► [API (NestJS/Node ou similar)]──► [PostgreSQL + PostGIS]
                                       │                              (RLS por território)
                                       ├──► [Object storage de fotos (privado)]
                                       ├──► [Servidor de tiles vetoriais (PMTiles/Martin)]
                                       ├──► [Roteamento: OSRM/Valhalla ou API comercial]
                                       └──► [Integrações F2: GIS corporativo, SAP PM, OMS/ADMS]
```

Racional:
- **PostGIS** [CERTEZA]: consultas espaciais nativas (o que está a X m, ativos dentro do polígono, trechos a jusante).
- **MapLibre GL** [PROVÁVEL]: open source, vetorial, suporta offline com PMTiles, sem custo por carregamento.
- **Capacitor**: um único código para web e app, liberando geofence/câmera/background.
- Alternativa de prototipagem rápida: Supabase (Postgres + PostGIS + auth + storage + RLS) — **apenas para protótipo com dados sintéticos**.

---

## 12. Modelo de dados (núcleo)

| Tabela | Campos principais |
|---|---|
| `ativo` | id, codigo_gis, tipo, alimentador, conjunto, geom (Point/LineString), ucs_jusante, atributos (jsonb) |
| `criterio_inspecao` | id, nome, periodicidade_dias, prioridade_base, ativo |
| `ativo_criterio` | ativo_id, criterio_id, desde, origem (import/manual) |
| `plano` | id, nome, periodo, versao, status, importado_por, importado_em |
| `inspecao` | id, ativo_id, plano_id, tipo (programada/avulsa), status, prazo, equipe_id, iniciada_em, concluida_em, geom_registro, resultado |
| `tipo_defeito` | id, categoria, descricao, severidade_padrao |
| `tipo_defeito_equipe` | tipo_defeito_id, tipo_equipe_id |
| `defeito` | id, inspecao_id, ativo_id, tipo_defeito_id, severidade, score_risco, status, geom, descricao, criado_por |
| `ordem_execucao` | id, equipe_id, status, data_programada, ref_sap |
| `execucao` | id, defeito_id, ordem_id, atividade, materiais (jsonb), executada_em, validada_por |
| `equipe` | id, nome, tipo_equipe_id, base, regional, disponibilidade |
| `usuario` | id, sso_subject, perfil, equipe_id, escopo_territorial |
| `evidencia` | id, entidade, entidade_id, url_privada, hash, lat, lon, capturada_em, autor |
| `indicador_continuidade` | conjunto/ativo, periodo, dec, fec, compensacao_rs |
| `auditoria` | id, usuario, acao, entidade, antes (jsonb), depois (jsonb), em, ip |

---

## 13. Template de importação do plano (MVP)

Colunas mínimas: `codigo_ativo`, `tipo_ativo`, `latitude`, `longitude` (ou WKT), `alimentador`, `conjunto`, `criterio` (ex.: TRAFO_REINCIDENTE), `ultima_inspecao`, `ucs_jusante`, `compensacao_12m_rs`.
Regras: coordenada dentro da área de concessão, critério existente, sem duplicidade ativo+critério; relatório de rejeições baixável.

---

## 14. Cenário de validação ponta a ponta (aceite do MVP)

**Contexto:** Alimentador fictício `ALM-07`, conjunto `CJ-Centro` acima da meta de DEC. Plano contém 25 transformadores reincidentes (≈ R$ 100 mil/mês de compensação, linha de base) e o tronco do alimentador.

| # | Passo | Resultado esperado |
|---|---|---|
| 1 | Gestor importa planilha com 25 trafos (critério TRAFO_REINCIDENTE, 90 dias) + tronco ALM-07 (180 dias). 2 linhas com coordenada inválida | 26 registros aceitos, 2 rejeitados com motivo; inspeções devidas geradas |
| 2 | Supervisor atribui inspeções do tronco à Equipe Inspeção-01 | Itens aparecem no mapa da equipe |
| 3 | Equipe baixa mapa offline da área e sai da base sem sinal | Mapa e pendências disponíveis offline |
| 4 | Ao passar a 150 m de um trafo reincidente pendente, recebe alerta | Notificação única; abrir leva ao ativo |
| 5 | Registra inspeção: 1 ninho de pássaro (retirado na hora) e 1 cruzeta comprometida (estrutural, sev. A, exige turma pesada), com fotos | Ninho: manutenção com baixa. Cruzeta: defeito aberto, score ≥ 70, roteado para turma pesada |
| 6 | Tenta registrar foto a 300 m do ativo | Sistema bloqueia ou exige justificativa |
| 7 | Volta à área com sinal | Sincronização automática; nada perdido; horário de servidor registrado |
| 8 | Registra inspeção **avulsa** num poste fora do plano com vegetação na rede | Defeito de poda criado, roteado para equipe de poda |
| 9 | Turma pesada executa a troca da cruzeta com foto antes/depois; supervisor valida | Defeito fechado; pontos lançados no ranking da turma pesada |
| 10 | Gestor abre dashboard | Aderência do plano, backlog atualizado, risco reduzido no CJ-Centro, produção por equipe |
| 11 | Usuário de outra regional tenta acessar defeito do ALM-07 pela URL | Acesso negado (403) e evento auditado |
| 12 | Usuário desligado no SSO tenta usar o app | Sessão revogada no próximo refresh; dados locais expirados |

---

## 15. Roadmap sugerido

| Fase | Escopo | Duração [SUPOSIÇÃO] |
|---|---|---|
| **0 — Protótipo navegável** | Mapa com dados sintéticos, fluxo de inspeção/defeito, sem integração | 2–3 semanas |
| **1 — MVP piloto** | Itens "M": importação de plano, offline, fotos, alertas (Android), despacho, dashboards básicos, segurança baseline. Piloto com 1 polo e 3–5 equipes | 8–12 semanas |
| **2 — Integração** | GIS, SAP PM, indicadores de continuidade, roteiro otimizado, correlação com compensação | +3 meses |
| **3 — Inteligência** | IA em fotos, previsão de falha (reaproveitar experiência SAP PA/modelagem preditiva), priorização dinâmica | contínuo |

Critério de go/no-go do piloto: aderência ≥ 85%, ≥ 95% de registros válidos, zero incidente de segurança, adoção por todas as equipes do piloto.

---

## 16. Questões em aberto (decidir antes da Fase 1)

1. Sistema de registro oficial dos defeitos: SAP PM ou esta plataforma?
2. Hospedagem e SSO: TI corporativa vai patrocinar? Qual nuvem homologada?
3. Fonte da base de ativos e topologia (GIS corporativo exporta? formato?).
4. Lista oficial de critérios de inspeção e periodicidades (existe norma interna?).
5. Catálogo de tipos de defeito e severidade já usado pela manutenção (reaproveitar para não criar padrão paralelo).
6. Dispositivos: Android corporativo com MDM? iOS também?
7. Regras de ranking: haverá premiação? (impacta governança e RH)
8. Fonte e granularidade dos dados de compensação (por UC, por trafo, por conjunto?).
