// Dados de demonstração 100% sintéticos: pessoas, matrículas e o catálogo abaixo são fictícios.
// O catálogo real da distribuidora NÃO fica neste repositório (é público): ele entra pela importação de CSV
// e fica só no aparelho (ver README).
import { hojeISO, somarDias, mulberry32 } from './util.js';
import { ocorrencias, colaboradores, precisaAprovacao } from './dominio.js';

export const VERSAO_SCHEMA = 1;

// [cargo, nome, governança, indicador, periodicidade, situação, minutos, horário, dia da semana, regra do mês, evidência esperada, destino da transferência, aprovador (A)]
const CATALOGO = [
  ['TCO', 'Acompanhamento de DESC no início do turno', 'Segurança', 'Taxa de desvios', 'D', 'R', 20, '07:30', '', '', 'Lista de presença do DESC com tema do dia', '', 'SUPERVISOR'],
  ['TCO', 'Controle de produtividade das equipes comerciais (D-1)', 'Comercial', 'Recuperação de energia', 'D', 'R', 30, '08:30', '', '', 'Relatório D-1 enviado ao grupo da UTD', '', 'SUPERVISOR'],
  ['TCO', 'Suporte em tempo real às equipes comerciais', 'Comercial', 'Gestão de equipes', 'D', 'R', 0, 'CONT', '', '', 'Ocorrências tratadas registradas no sistema de despacho', '', ''],
  ['TCO', 'Validação de notas reguladas antes do despacho', 'Comercial', 'Eficácia da demanda', 'D', 'R', 30, '', '', '', 'Notas validadas e programadas no sistema', '', 'SUPERVISOR'],
  ['TCO', 'Monitoramento da aderência da carteira (própria e parceira)', 'Comercial', 'Aderência da programação', 'W', 'R', 60, '', 4, '', 'Planilha de aderência atualizada e enviada', '', 'SUPERVISOR'],
  ['TCO', 'Tratativa de turmas com baixa efetividade no corte', 'Comercial', 'Recebíveis', 'Q', 'R', 90, '', 1, '', 'Ata de feedback com plano de ação por turma', '', 'SUPERVISOR'],
  ['TCO', 'Visita às bases operacionais', 'Gestão UTD', 'Clima organizacional', 'W', 'R', 180, '', 2, '', 'Checklist da visita com fotos e pendências', '', 'SUPERVISOR'],
  ['TCO', 'Reunião de performance do contrato com a parceira', 'Qualidade', 'Qualidade do serviço', 'W', 'R', 180, '', 5, '', 'Ata enviada à parceira com prazos', '', 'SUPERVISOR'],
  ['TCO', 'Criação e envio do MASP do mês', 'Qualidade', 'Gestão de resultados', 'M', 'R', 120, '', '', 'P5', 'MASP enviado à gerência', '', 'SUPERVISOR'],
  ['TCO', 'Reunião de resultados da UTD', 'Gestão UTD', 'Gestão UTD', 'M', 'R', 120, '', '', 'P1', 'Apresentação e lista de presença', '', 'SUPERVISOR'],
  ['TCO', 'Fechamento de projetos de serviços técnicos', 'Qualidade', 'Fechamento de projetos', 'M', 'T', 180, '', '', 'U', 'Projetos encerrados no sistema', 'Qualidade de ativos (QAA)', 'SUPERVISOR'],
  ['TCO', 'Gestão do prazo de notas de perdas', 'Comercial', 'Recuperação de energia', 'W', 'T', 60, '', 2, '', 'Relatório de notas no prazo', 'Planejamento e controle (PCP)', 'SUPERVISOR'],
  ['TCO', 'Crítica da programação de cobrança por ticket médio', 'Comercial', 'Recebíveis', 'Q', 'R', 90, '', 3, '', 'Programação revisada com as maiores dívidas', '', ''],
  ['TCO', 'Acompanhamento de notas improdutivas de perdas', 'Comercial', 'Recuperação de energia', 'W', 'R', 60, '', 3, '', 'Lista de improdutivas tratadas', '', ''],

  ['TMN', 'Validação das ocorrências de maior impacto', 'Qualidade', 'DEC/FEC/Compensações', 'D', 'R', 30, '08:00', '', '', 'Ocorrências validadas com causa e consumidores', '', 'SUPERVISOR'],
  ['TMN', 'Suporte em tempo real às equipes de manutenção', 'Qualidade', 'DEC/FEC/Compensações', 'D', 'R', 0, 'CONT', '', '', 'Apoios registrados no despacho', '', ''],
  ['TMN', 'Acompanhamento de DESC no início do turno', 'Segurança', 'Taxa de desvios', 'D', 'R', 20, '07:30', '', '', 'Lista de presença do DESC', '', 'SUPERVISOR'],
  ['TMN', 'Programação de preventivas nos alimentadores críticos', 'Qualidade', 'DEC/FEC/Compensações', 'Q', 'R', 90, '', 4, '', 'Ordens de preventiva criadas para os alimentadores do top 10', '', 'SUPERVISOR'],
  ['TMN', 'Tratativa de chaves reincidentes', 'Qualidade', 'DEC/FEC/Compensações', 'Q', 'R', 90, '', 1, '', 'Plano por chave reincidente com responsável', '', 'SUPERVISOR'],
  ['TMN', 'Acompanhamento do plano de manutenção', 'Qualidade', 'Carteira de manutenção', 'Q', 'R', 90, '', 4, '', 'Carteira atualizada com aderência ao plano', '', 'SUPERVISOR'],
  ['TMN', 'Dia de campo com as equipes', 'Gestão UTD', 'Segurança', 'W', 'R', 180, '', 2, '', 'Registro do dia de campo com desvios observados', '', 'SUPERVISOR'],
  ['TMN', 'Criação e envio do MASP do mês', 'Qualidade', 'Gestão de resultados', 'M', 'R', 120, '', '', 'P5', 'MASP enviado à gerência', '', 'SUPERVISOR'],
  ['TMN', 'Cadastro de chaves e atualização cadastral', 'Qualidade', 'Cadastro técnico', 'Q', 'T', 90, '', 5, '', 'Cadastro atualizado', 'Cadastro técnico (UTEP)', 'SUPERVISOR'],
  ['TMN', 'Reclamações de ouvidoria', 'Qualidade', 'DEC/FEC/Compensações', 'S', 'S', 60, '', '', '', 'Resposta registrada no protocolo', '', ''],

  ['ESP', 'Gestão do painel de indicadores à vista', 'Gestão UTD', 'Todos os indicadores', 'W', 'R', 60, '', 3, '', 'Painel atualizado (foto)', '', 'SUPERVISOR'],
  ['ESP', 'Controle de produtividade das equipes comerciais (D-1)', 'Comercial', 'Recuperação de energia', 'D', 'R', 30, '08:30', '', '', 'Relatório D-1 enviado ao grupo da UTD', '', 'SUPERVISOR'],
  ['ESP', 'Monitoramento dos alimentadores com maior consumo de DEC/FEC', 'Qualidade', 'DEC/FEC/Compensações', 'D', 'R', 30, '', '', '', 'Lista diária dos alimentadores críticos', '', 'SUPERVISOR'],
  ['ESP', 'Fiscalização de qualidade e segurança em campo', 'Qualidade', 'Segurança / Qualidade', 'W', 'R', 180, '', 4, '', 'Formulário de fiscalização com desvios', '', 'SUPERVISOR'],
  ['ESP', 'Criação e envio do MASP do mês', 'Qualidade', 'Gestão de resultados', 'M', 'R', 120, '', '', 'P5', 'MASP enviado à gerência', '', 'SUPERVISOR'],
  ['ESP', 'Acompanhamento diário de infrações de telemetria', 'Segurança', 'Consulta de segurança', 'D', 'R', 30, '', '', '', 'Infrações tratadas com feedback ao condutor', '', 'SUPERVISOR'],
  ['ESP', 'Crítica da carteira de manutenção para fechamento do mês', 'Qualidade', 'Carteira de manutenção', 'M', 'R', 180, '', '', 'U', 'Carteira criticada e enviada ao planejamento', '', 'SUPERVISOR'],
  ['ESP', 'Fiscalização de horas extras e viagens', 'Gestão UTD', 'Custos operacionais', 'W', 'R', 120, '', 4, '', 'Relatório de horas extras com justificativas', '', ''],
  ['ESP', 'Realização de análise de causa raiz (RCA)', 'Qualidade', 'DEC/FEC/Compensações', 'Q', 'T', 90, '', 5, '', 'RCA publicado', 'Desempenho do sistema', 'SUPERVISOR'],
  ['ESP', 'Apoio na retaguarda durante contingência', 'Qualidade', 'DEC/FEC/Compensações', 'S', 'S', 60, '', '', '', 'Registro do apoio no despacho', '', ''],

  ['ACO', 'Monitoramento do relatório diário da cobrança', 'Comercial', 'Recebíveis', 'D', 'R', 30, '08:00', '', '', 'Relatório diário enviado ao grupo', '', 'SUPERVISOR'],
  ['ACO', 'Controle de produtividade das equipes comerciais (D-1)', 'Comercial', 'Recuperação de energia', 'D', 'R', 30, '08:30', '', '', 'Relatório D-1 enviado ao grupo da UTD', '', 'SUPERVISOR'],
  ['ACO', 'Tratamento de log de erro e workflow', 'Comercial', 'Pendências de tratativa', 'D', 'R', 60, '', '', '', 'Fila de log de erro zerada ou justificada', '', 'SUPERVISOR'],
  ['ACO', 'Reserva de materiais para as equipes', 'Logística', 'Materiais', 'D', 'R', 30, '', '', '', 'Reservas criadas no sistema de materiais', '', 'SUPERVISOR'],
  ['ACO', 'Tratamento de notas reguladas fora do prazo', 'Comercial', 'Eficácia da demanda', 'W', 'R', 60, '', 2, '', 'Justificativas lançadas no portal', '', 'SUPERVISOR'],
  ['ACO', 'Cadastro das escalas das turmas no portal', 'Gestão UTD', 'Aderência da programação', 'M', 'R', 120, '', '', 'P15', 'Escala do mês seguinte publicada', '', 'SUPERVISOR'],
  ['ACO', 'Atualização de e-mails e comunicados', 'Gestão UTD', 'Comunicação', 'D', 'R', 20, '16:45', '', '', 'Caixa da UTD sem pendência do dia', '', ''],
  ['ACO', 'Acompanhamento do contador de vidas salvas', 'Segurança', 'Taxa de desvios', 'W', 'T', 60, '', 4, '', 'Contador atualizado', 'CIPA / Segurança do trabalho', 'SUPERVISOR'],

  ['AGE', 'Acompanhamento de DESC no início do turno', 'Segurança', 'Taxa de desvios', 'D', 'R', 20, '07:30', '', '', 'Lista de presença do DESC', '', 'SUPERVISOR'],
  ['AGE', 'Acompanhamento de DESC do turno da tarde', 'Segurança', 'Taxa de desvios', 'D', 'R', 20, '13:00', '', '', 'Lista de presença do DESC da tarde', '', 'SUPERVISOR'],
  ['AGE', 'Controle de entrega de EPI e EPC', 'Segurança', 'Segurança', 'W', 'R', 60, '', 1, '', 'Fichas de entrega assinadas', '', 'SUPERVISOR'],
  ['AGE', 'Acompanhamento de horas extras', 'Pessoas', 'Custos operacionais', 'W', 'R', 60, '', 5, '', 'Relatório semanal de horas extras', '', 'SUPERVISOR'],
  ['AGE', 'Acompanhamento das ações do plano de clima', 'Pessoas', 'Pesquisa de clima', 'M', 'R', 90, '', '', 'P10', 'Status das ações atualizado', '', 'SUPERVISOR'],
  ['AGE', 'Criação e envio do MASP do mês', 'Qualidade', 'Gestão de resultados', 'M', 'R', 120, '', '', 'P5', 'MASP enviado à gerência', '', ''],
  ['AGE', 'Programação de treinamentos e reciclagens', 'Segurança', 'Treinamentos', 'Q', 'R', 90, '', 4, '', 'Agenda de treinamentos do mês publicada', '', 'SUPERVISOR'],
  ['AGE', 'Apoio a acidentes com terceiros e audiências', 'Gestão UTD', '—', 'S', 'S', 60, '', '', '', 'Relatório entregue ao jurídico', '', ''],
];

// Pessoas fictícias: uma por cargo em cada UTD.
const NOMES = {
  JUA: ['Paulo Teixeira', 'Rita Moura', 'Caio Brandão', 'Lívia Prado', 'Sônia Reis'],
  JAC: ['Hugo Farias', 'Nara Lopes', 'Ivo Matos', 'Bia Fontes', 'Edu Sales'],
  SBF: ['Davi Rocha', 'Lara Queiroz', 'Otto Ramos', 'Mel Cardoso', 'Ana Viana'],
  REM: ['Rui Pacheco', 'Íris Campos', 'Teo Dantas', 'Clara Neves', 'Guto Lima'],
};
const ORDEM_CARGOS = ['TCO', 'TMN', 'ESP', 'ACO', 'AGE'];
const ORDEM_UTDS = ['JUA', 'JAC', 'SBF', 'REM'];

export function gerarSeed() {
  const hoje = hojeISO();
  const inicioCatalogo = somarDias(hoje, -60);
  const rnd = mulberry32(20261026);

  const usuarios = [
    { id: 'u-g1001', matricula: 'G1001', nome: 'Gerência Operacional Norte', perfil: 'GESTOR' },
    ...ORDEM_UTDS.map((utd, i) => ({ id: `u-s100${i + 1}`, matricula: `S100${i + 1}`, nome: `Supervisão ${['Juazeiro', 'Jacobina', 'Senhor do Bonfim', 'Remanso'][i]}`, perfil: 'SUPERVISOR', utd })),
    { id: 'u-a1001', matricula: 'A1001', nome: 'Auditoria Interna', perfil: 'AUDITOR' },
    { id: 'u-x1001', matricula: 'X1001', nome: 'Administrador do Sistema', perfil: 'ADMIN' },
  ];
  ORDEM_UTDS.forEach((utd, i) => ORDEM_CARGOS.forEach((cargo, j) => {
    usuarios.push({ id: `u-r1${i + 1}0${j + 1}`, matricula: `R1${i + 1}0${j + 1}`, nome: NOMES[utd][j], perfil: 'COLABORADOR', utd, cargo });
  }));
  for (const u of usuarios) Object.assign(u, { ativo: true, credencial: null, trocarSenha: true });

  const atividades = CATALOGO.map(([cargo, nome, governanca, indicador, periodicidade, situacao, duracaoMin, horario, diaSemana, regraMes, evidencia, destino, aprovador], i) => ({
    id: `at-${String(i + 1).padStart(3, '0')}`,
    codigo: `AT-${String(i + 1).padStart(3, '0')}`,
    aceite: null,
    versoes: [{
      desde: inicioCatalogo, nome, governanca, indicador, cargo, periodicidade, situacao, duracaoMin, horario, diaSemana, regraMes,
      evidencia, destino, aprovador, coResponsaveis: [],
      // Periodicidade e minutos de demonstração são propostas (não validadas com o time): aparecem nos Achados.
      validada: i % 4 === 0, motivo: 'Carga inicial (demonstração)', por: 'u-x1001', em: `${inicioCatalogo}T08:00:00.000Z`,
    }],
  }));
  // Uma transferência já aceita pela área destino (mostra a atividade saindo da agenda a partir da data efetiva).
  const aceita = atividades.find((a) => a.versoes[0].nome.startsWith('Cadastro de chaves'));
  aceita.aceite = { desde: somarDias(hoje, -7), em: `${somarDias(hoje, -9)}T10:00:00.000Z`, por: 'u-g1001', destino: aceita.versoes[0].destino, obs: 'Aceite por e-mail do coordenador da área destino' };

  const d = {
    versaoSchema: VERSAO_SCHEMA,
    criadoEm: new Date().toISOString(),
    usuarios,
    atividades,
    execucoes: {},
    demandas: [],
    regras: [{
      desde: inicioCatalogo, motivo: 'Carga inicial', por: 'u-x1001',
      valores: {
        capacidadeDiariaMin: 528, // 8h48 por dia útil
        feriados: [
          { data: '2026-11-02', nome: 'Finados' }, { data: '2026-11-20', nome: 'Consciência Negra' },
          { data: '2026-12-25', nome: 'Natal' }, { data: '2027-01-01', nome: 'Confraternização Universal' },
        ],
      },
    }],
    rascunhos: {},
    fila: [],
    ultimaSync: null,
  };

  // Histórico sintético das duas semanas anteriores (até ontem), para a aderência aparecer funcionando.
  const ontem = somarDias(hoje, -1);
  const passado = ocorrencias(d, { ini: somarDias(hoje, -14), fim: ontem, usuarios: colaboradores(d), hoje });
  for (const o of passado) {
    const r = rnd();
    if (r < 0.07) continue; // atrasada (não feita)
    const ex = { concluidaEm: null, concluidaPor: o.usuarioId, evidencia: `${o.evidenciaEsperada} (registro de demonstração)`, remanejamentos: [], sintetico: true };
    if (r < 0.15) {
      // Remanejada para o próximo dia útil e concluída lá.
      const para = somarDias(o.data, 1) <= ontem ? somarDias(o.data, 1) : o.data;
      if (precisaAprovacao(d, o, para).length === 0 && para !== o.data) {
        ex.remanejamentos.push({ de: o.data, para, motivo: 'EMERGENCIA', texto: 'Contingência na rede', por: o.usuarioId, em: `${o.data}T09:00:00.000Z`, situacao: 'APLICADO' });
        ex.dataAtual = para;
      }
    }
    const dia = ex.dataAtual || (r < 0.22 ? somarDias(o.data, 1) : o.data);
    if (dia > ontem) continue;
    ex.concluidaEm = `${dia}T${String(8 + Math.floor(rnd() * 9)).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}:00.000Z`;
    d.execucoes[o.chave] = ex;
  }
  // Pedidos pendentes de aprovação (remanejamento fora da janela) para a fila do supervisor.
  const futuras = ocorrencias(d, { ini: hoje, fim: somarDias(hoje, 4), usuarios: colaboradores(d).filter((u) => u.cargo === 'TCO'), hoje })
    .filter((o) => o.periodicidade === 'D').slice(0, 3);
  futuras.forEach((o, i) => {
    d.execucoes[o.chave] = { remanejamentos: [], pedido: { para: somarDias(o.data, 7), motivo: i ? 'REUNIAO' : 'AUSENCIA', texto: i ? 'Reunião regional convocada' : 'Treinamento de NR-10 em Salvador', por: o.usuarioId, em: new Date().toISOString(), motivosAprovacao: ['fora da janela da periodicidade diária'] }, sintetico: true };
  });
  d.demandas.push({ id: 'dm-1', atvId: atividades.find((a) => a.versoes[0].nome.startsWith('Reclamações')).id, usuarioId: 'u-r1102', data: somarDias(hoje, -3), duracaoMin: 90, descricao: 'Resposta a reclamação de ouvidoria sobre interrupção', em: `${somarDias(hoje, -3)}T15:00:00.000Z`, sintetico: true });
  return d;
}
