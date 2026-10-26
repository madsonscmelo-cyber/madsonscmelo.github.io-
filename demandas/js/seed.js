// Dados de demonstração 100% sintéticos: pessoas, matrículas e demandas abaixo são fictícios.
// As datas são relativas a hoje, para a agenda sempre abrir com atrasadas, vencendo hoje e próximas.
import { hojeISO, somarDias } from './util.js';
import { diasUteis, radarAutomatico, ehDiaUtil } from './dominio.js';

export const VERSAO_SCHEMA = 1;

const USUARIOS = [
  ['G2001', 'Helena Prado', 'GESTOR', {}],
  ['S2101', 'Ana Souza', 'SUPERVISOR', { setor: 'SUL', equipe: ['João Batista', 'Rita Moura', 'Edson Alves'] }],
  ['S2102', 'Bruno Lima', 'SUPERVISOR', { setor: 'SUL', equipe: ['Kátia Ramos', 'Luís Neto', 'Paulo Viana'] }],
  ['S2201', 'Carla Dias', 'SUPERVISOR', { setor: 'NORTE', equipe: ['Sérgio Lopes', 'Vera Cunha', 'Tiago Melo'] }],
  ['S2202', 'Diego Rocha', 'SUPERVISOR', { setor: 'NORTE', equipe: ['Nádia Couto', 'Otávio Reis', 'Bia Santana'] }],
  ['D3001', 'Carlos Pereira', 'DEMANDANTE', { area: 'RH' }],
  ['D3002', 'Paula Nunes', 'DEMANDANTE', { area: 'Segurança' }],
  ['D3003', 'Marcos Teles', 'DEMANDANTE', { area: 'Regulatório' }],
  ['A2001', 'Lia Fontes', 'AUDITOR', {}],
];

// [id, título, área, solicitante, tipo, destinatário, abre (dias), prazo (dias), canal, urgência, justificativa, entregável, status, concluiu (dias), motivo manual, pendências, delegado, criado por]
const DEMANDAS = [
  ['ex01', 'Lista de colaboradores com exame periódico vencido', 'RH', 'Carlos Pereira', 'RH', 'S2101', -6, -1, 'VOZ', 'NORMAL', '', 'planilha', 'ABERTA', null, '', [], '', 'S2101'],
  ['ex02', 'Checklist de EPI das equipes de linha viva assinado', 'Segurança', 'Paula Nunes', 'Segurança', 'S2102', -1, 0, 'FOTO', 'URGENTE', 'Auditoria interna na quinta', 'checklist', 'ANDAMENTO', null, 'ULTIMA_HORA', [], 'Kátia Ramos', 'S2102'],
  ['ex03', 'Justificativas de interrupções acima de 3h para DEC/FEC', 'Regulatório', 'Marcos Teles', 'Regulatório', 'S2201', -10, 2, 'EMAIL', 'NORMAL', '', 'relatório', 'ABERTA', null, '', [], '', 'D3003'],
  ['ex04', 'Plano de ação de perdas não técnicas do conjunto Norte II', 'Comercial', 'Juliana Reis', 'Comercial', 'S2202', -3, 1, 'TEXTO', 'URGENTE', 'Reunião com a diretoria', 'apresentação', 'ABERTA', null, 'NOVA_EXIGENCIA', [], '', 'S2202'],
  ['ex05', 'Escala de sobreaviso de novembro', 'RH', 'Carlos Pereira', 'RH', 'S2101', -8, 4, 'FORM', 'NORMAL', '', 'planilha', 'ABERTA', null, '', [], '', 'D3001'],
  ['ex06', 'Revisar ordens de religação fora do prazo', 'Comercial', 'Juliana Reis', 'Comercial', 'S2102', -2, -1, 'VOZ', 'NORMAL', '', 'lançamento', 'ABERTA', null, 'FALHA_OUTRA_AREA', [], '', 'S2102'],
  ['ex07', 'Inventário de ferramental das equipes de emergência', 'Gerência', 'Helena Prado', 'Gerencial', 'S2201', -12, 3, 'TEXTO', 'NORMAL', '', 'planilha', 'ABERTA', null, '', [], '', 'G2001'],
  ['ex08', 'Confirmar presença das equipes no treinamento NR-10', 'Segurança', 'Paula Nunes', 'Segurança', 'S2202', -9, 5, 'EMAIL', 'NORMAL', '', 'e-mail', 'ABERTA', null, '', [], '', 'D3002'],
  ['ex09', 'Reenviar base de clientes eletrodependentes no novo layout', 'Comercial', 'Juliana Reis', 'Comercial', 'S2101', -1, 1, 'FOTO', 'NORMAL', '', '', 'ABERTA', null, 'RETRABALHO', ['entregavel'], '', 'S2101'],
  ['ex10', 'Validar consumo de material do mês', 'Financeiro', 'Sônia Prado', 'Gerencial', 'S2102', -15, -5, 'EMAIL', 'NORMAL', '', 'planilha', 'CONCLUIDA', -6, '', [], '', 'S2102'],
  ['ex11', 'Relatório de ocorrências com terceiros', 'Segurança', 'Paula Nunes', 'Segurança', 'S2201', -14, -3, 'TEXTO', 'NORMAL', '', 'relatório', 'CONCLUIDA', -1, '', [], '', 'D3002'],
  ['ex12', 'Programação de podas preventivas', 'Planejamento', 'Rafael Costa', 'Manutenção', 'S2202', -20, -7, 'FORM', 'NORMAL', '', 'cronograma', 'CONCLUIDA', -8, '', [], '', 'S2202'],
  ['ex13', 'Atualizar banco de horas da equipe', 'RH', 'Carlos Pereira', 'RH', 'S2201', -4, -2, 'VOZ', 'NORMAL', '', 'lançamento', 'CONCLUIDA', -2, 'ULTIMA_HORA', [], '', 'S2201'],
  ['ex14', 'Diagnóstico dos 25 transformadores com compensação', 'Regulatório', 'Marcos Teles', 'Regulatório', 'S2101', -7, 9, 'TEXTO', 'NORMAL', '', 'relatório', 'ABERTA', null, '', [], '', 'D3003'],
  ['ex15', 'Dados de produtividade por turma para o PDI', 'RH', 'Carlos Pereira', 'RH', 'S2202', 0, null, 'VOZ', 'NORMAL', '', 'planilha', 'ABERTA', null, '', ['prazo'], '', 'S2202'],
  ['ex16', 'Evidências de inspeção de subestação para auditoria', 'Regulatório', 'Marcos Teles', 'Regulatório', 'S2102', -2, 0, 'EMAIL', 'URGENTE', 'Auditoria da agência reguladora', 'relatório', 'ABERTA', null, 'NOVA_EXIGENCIA', [], '', 'D3003'],
];

/** Desloca em dias e cai sempre em dia útil: no passado recua até sexta, no futuro avança até segunda. */
function util(hoje, dias) {
  let x = somarDias(hoje, dias);
  while (!ehDiaUtil(x)) x = somarDias(x, dias > 0 ? 1 : -1);
  return x;
}

export function gerarSeed(hoje = hojeISO()) {
  const usuarios = USUARIOS.map(([matricula, nome, perfil, extra]) => ({
    id: `u-${matricula.toLowerCase()}`, matricula, nome, perfil, ...extra, ativo: true, credencial: null, trocarSenha: true,
  }));
  const id = (m) => `u-${m.toLowerCase()}`;
  const base = (abertura, prazo, canal) => {
    const auto = radarAutomatico({ canal, abertura, prazo });
    return { antecedencia: diasUteis(abertura, prazo), auto };
  };
  const demandas = DEMANDAS.map(([cod, titulo, area, solicitante, tipo, dest, ab, pz, canal, urg, just, ent, status, conc, motivo, pend, deleg, por]) => {
    const abertura = util(hoje, ab), prazo = pz === null ? '' : util(hoje, pz);
    const { antecedencia, auto } = base(abertura, prazo, canal);
    const radar = motivo ? 'FORA' : auto.radar;
    return {
      id: `dem-${cod}`, titulo, descricao: '', solicitante, areaSolicitante: area, destinatario: id(dest), prazo, abertura,
      urgencia: urg, justificativa: just, entregavel: ent, tipo, canal, radar, radarAuto: !motivo,
      motivoRadar: motivo, motivoRadarTexto: radar === 'FORA' && !motivo ? auto.motivo : '',
      pendencias: pend, nasceuIncompleta: pend.length > 0, status,
      concluidaEm: conc === null ? '' : `${util(hoje, conc)}T15:00:00.000Z`, comentarioConclusao: '',
      delegadoPara: deleg, criadoPor: id(por), criadoEm: `${abertura}T09:00:00.000Z`, antecedencia,
      ehMae: false, maeId: null, exemplo: true,
      historico: [{ em: `${abertura}T09:00:00.000Z`, por: id(por), acao: 'Criou', detalhe: `via ${canal.toLowerCase()}` }],
    };
  });

  // Pedido para grupo: uma demanda-mãe (visão de quem pediu e do painel) e um ticket por supervisor.
  const ab = util(hoje, -4), pz = util(hoje, 1);
  const { antecedencia, auto } = base(ab, pz, 'EMAIL');
  const comum = {
    titulo: 'Pesquisa de clima: garantir 80% de resposta das equipes', descricao: '', solicitante: 'Carlos Pereira', areaSolicitante: 'RH',
    prazo: pz, abertura: ab, urgencia: 'NORMAL', justificativa: '', entregavel: 'confirmação por e-mail', tipo: 'RH', canal: 'EMAIL',
    radar: auto.radar, radarAuto: true, motivoRadar: '', motivoRadarTexto: auto.radar === 'FORA' ? auto.motivo : '', pendencias: [], nasceuIncompleta: false,
    comentarioConclusao: '', delegadoPara: '', criadoPor: id('D3001'), criadoEm: `${ab}T09:00:00.000Z`, antecedencia, exemplo: true,
  };
  demandas.push({ ...comum, id: 'dem-ex20', destinatario: 'grp:TODOS', grupo: 'grp:TODOS', ehMae: true, maeId: null, status: 'ABERTA', concluidaEm: '',
    historico: [{ em: comum.criadoEm, por: comum.criadoPor, acao: 'Criou para grupo', detalhe: 'Todos os supervisores da operação (4)' }] });
  [['S2101', 'CONCLUIDA', -1], ['S2102', 'ABERTA', null], ['S2201', 'CONCLUIDA', 0], ['S2202', 'ABERTA', null]].forEach(([m, st, c], i) => {
    demandas.push({ ...comum, id: `dem-ex2${i + 1}`, destinatario: id(m), ehMae: false, maeId: 'dem-ex20', status: st,
      concluidaEm: c === null ? '' : `${util(hoje, c)}T15:00:00.000Z`, historico: [{ em: comum.criadoEm, por: comum.criadoPor, acao: 'Criou', detalhe: 'pedido para grupo' }] });
  });

  const rituais = [
    { id: 'rit-masp', nome: 'MASP do mês', descricao: 'Análise e plano de ação do principal desvio do setor', regra: 'DIA_UTIL', n: 5, tipo: 'Ritual', exemplo: true },
    { id: 'rit-rad', nome: 'Fechamento do RAD', descricao: 'Relatório de análise de desempenho do setor', regra: 'DIA_UTIL', n: 3, tipo: 'Ritual', exemplo: true },
    { id: 'rit-decfec', nome: 'Fechamento de indicadores DEC/FEC', descricao: 'Validar interrupções e causas do mês', regra: 'ULTIMO_UTIL', n: 1, tipo: 'Regulatório', exemplo: true },
  ];
  return { versaoSchema: VERSAO_SCHEMA, usuarios, demandas, rituais, rascunhos: {}, fila: [], ultimaSync: null, seguranca: { tentativas: {}, falhasAparelho: [] } };
}
