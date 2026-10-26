// Regras de negócio da Central de Demandas: perfis, grupos, calendário de dias úteis, radar, situação por prazo e indicadores.
// Sem DOM: as mesmas funções valem no navegador e, no produto, no servidor.
import { hojeISO, somarDias, diasEntre, dataISO } from './util.js';

export const PERFIS = {
  GESTOR: 'Gerência operacional',
  SUPERVISOR: 'Supervisor',
  DEMANDANTE: 'Área demandante',
  AUDITOR: 'Auditoria',
};

export const SETORES = { SUL: 'Setor Sul', NORTE: 'Setor Norte' };
export const AREAS = ['RH', 'Segurança', 'Regulatório', 'Comercial', 'Manutenção', 'Planejamento', 'Financeiro', 'Gerência'];
export const TIPOS = ['RH', 'Segurança', 'Regulatório', 'Comercial', 'Manutenção', 'Gerencial', 'Ritual'];
export const CANAIS = { VOZ: 'Voz', TEXTO: 'Texto', FOTO: 'Foto/print', EMAIL: 'E-mail', FORM: 'Formulário', RITUAL: 'Ritual' };
export const MOTIVOS_RADAR = {
  NOVA_EXIGENCIA: 'Nova exigência (auditoria, regulatório, diretoria)',
  ULTIMA_HORA: 'Pedido de última hora de área central',
  RETRABALHO: 'Retrabalho: pediram de novo ou mudaram o escopo',
  FALHA_OUTRA_AREA: 'Correção de falha de outra área',
  EMERGENCIA: 'Emergência operacional legítima',
};
export const CAMPOS_PENDENCIA = { prazo: 'Prazo', entregavel: 'Entregável', solicitante: 'Quem pediu' };

export const LIMITES = Object.freeze({
  tituloMin: 5, tituloMax: 140, textoMax: 2000, justificativaMin: 5, comentarioMax: 500,
  antecedenciaMin: 5, // dias úteis: abaixo disso o pedido entra como "fora do radar"
  urgenciaParaOntem: 2, // dias úteis: abaixo disso conta como "urgência para ontem" no painel
});

export const STATUS = { ABERTA: 'Aberta', ANDAMENTO: 'Em andamento', CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada' };

export const supervisores = (d) => d.usuarios.filter((u) => u.perfil === 'SUPERVISOR' && u.ativo !== false);

/** Grupos de destino. Os membros saem do cadastro, então um supervisor novo entra no grupo sem mudar código. */
export function grupos(d) {
  const sup = supervisores(d);
  return {
    'grp:SUL': { nome: 'Supervisores · Setor Sul', membros: sup.filter((u) => u.setor === 'SUL').map((u) => u.id) },
    'grp:NORTE': { nome: 'Supervisores · Setor Norte', membros: sup.filter((u) => u.setor === 'NORTE').map((u) => u.id) },
    'grp:TODOS': { nome: 'Todos os supervisores da operação', membros: sup.map((u) => u.id) },
  };
}
export const ehGrupo = (chave) => String(chave || '').startsWith('grp:');

// ---------- Calendário ----------
const diaSemana = (iso) => new Date(`${iso}T12:00:00`).getDay();
export const ehDiaUtil = (iso) => { const w = diaSemana(iso); return w >= 1 && w <= 5; };

/** Dias úteis entre a abertura (exclusive) e o prazo (inclusive). Prazo no mesmo dia ou antes = 0. */
export function diasUteis(abertura, prazo) {
  if (!abertura || !prazo) return null;
  if (prazo <= abertura) return 0;
  let n = 0;
  for (let x = somarDias(abertura, 1); x <= prazo; x = somarDias(x, 1)) if (ehDiaUtil(x)) n++;
  return n;
}

export function nEsimoDiaUtil(ano, mes, n) {
  let x = dataISO(new Date(ano, mes, 1, 12)), c = 0;
  for (;;) { if (ehDiaUtil(x) && ++c === n) return x; x = somarDias(x, 1); }
}
export function ultimoDiaUtil(ano, mes) {
  let x = dataISO(new Date(ano, mes + 1, 0, 12));
  while (!ehDiaUtil(x)) x = somarDias(x, -1);
  return x;
}
export const REGRAS_RITUAL = { DIA_UTIL: 'Nº dia útil do mês', ULTIMO_UTIL: 'Último dia útil do mês', DIA_FIXO: 'Dia fixo do mês' };
export function rotuloRegra(r) {
  if (r.regra === 'DIA_UTIL') return `${r.n}º dia útil do mês`;
  if (r.regra === 'ULTIMO_UTIL') return 'Último dia útil do mês';
  return `Todo dia ${r.n} (antecipa se não for útil)`;
}
/** Data do ritual no mês. Dia fixo que cai em fim de semana é antecipado: prazo de fechamento não pode vencer. */
export function dataRitual(r, ano, mes) {
  if (r.regra === 'DIA_UTIL') return nEsimoDiaUtil(ano, mes, Number(r.n));
  if (r.regra === 'ULTIMO_UTIL') return ultimoDiaUtil(ano, mes);
  const ultimo = new Date(ano, mes + 1, 0).getDate();
  let x = dataISO(new Date(ano, mes, Math.min(Number(r.n), ultimo), 12));
  while (!ehDiaUtil(x)) x = somarDias(x, -1);
  return x;
}
export function proximaDataRitual(r, hoje = hojeISO()) {
  const h = new Date(`${hoje}T12:00:00`);
  const x = dataRitual(r, h.getFullYear(), h.getMonth());
  return x >= hoje ? x : dataRitual(r, h.getFullYear(), h.getMonth() + 1);
}

// ---------- Radar e situação ----------
export function radarAutomatico({ canal, abertura, prazo }) {
  if (canal === 'RITUAL') return { radar: 'PLANEJADA', motivo: 'Ritual cadastrado' };
  const du = diasUteis(abertura, prazo);
  if (du === null) return { radar: 'FORA', motivo: 'Chegou sem prazo definido' };
  return du < LIMITES.antecedenciaMin
    ? { radar: 'FORA', motivo: `${du} dia(s) útil(eis) de antecedência (mínimo ${LIMITES.antecedenciaMin})` }
    : { radar: 'PLANEJADA', motivo: `${du} dias úteis de antecedência` };
}

/** Faixa da agenda. Texto e ícone acompanham a cor (legível para daltônicos e no modo sol). */
export const FAIXAS = {
  ATRASADA: { txt: 'Atrasadas', ico: '!' },
  HOJE: { txt: 'Vencem hoje', ico: '•' },
  D3: { txt: 'Próximos 3 dias', ico: '' },
  D5: { txt: 'Em 4 a 5 dias', ico: '' },
  DEPOIS: { txt: 'Mais adiante', ico: '' },
  SEM_PRAZO: { txt: 'Sem prazo', ico: '?' },
  CONCLUIDA: { txt: 'Concluídas', ico: '✓' },
  CANCELADA: { txt: 'Canceladas', ico: '✕' },
};
export function faixa(dem, hoje = hojeISO()) {
  if (dem.status === 'CONCLUIDA') return 'CONCLUIDA';
  if (dem.status === 'CANCELADA') return 'CANCELADA';
  if (!dem.prazo) return 'SEM_PRAZO';
  const n = diasEntre(hoje, dem.prazo);
  if (n < 0) return 'ATRASADA';
  if (n === 0) return 'HOJE';
  if (n <= 3) return 'D3';
  if (n <= 5) return 'D5';
  return 'DEPOIS';
}
export const ativa = (dem) => dem.status === 'ABERTA' || dem.status === 'ANDAMENTO';
export const noPrazo = (dem) => dem.status === 'CONCLUIDA' && (!dem.prazo || (dem.concluidaEm || '').slice(0, 10) <= dem.prazo);

// ---------- Visibilidade por perfil ----------
/** Tickets de trabalho (um por supervisor). A demanda-mãe de um grupo só aparece no painel e para quem pediu. */
export function demandasVisiveis(d, u) {
  if (!u) return [];
  if (u.perfil === 'GESTOR' || u.perfil === 'AUDITOR') return d.demandas.filter((x) => !x.ehMae);
  if (u.perfil === 'SUPERVISOR') return d.demandas.filter((x) => !x.ehMae && x.destinatario === u.id);
  if (u.perfil === 'DEMANDANTE') return d.demandas.filter((x) => x.criadoPor === u.id && !x.maeId);
  return [];
}

// ---------- Indicadores do painel ----------
const pct = (a, b) => (b ? a / b : 0);
export function indicadores(d, hoje = hojeISO()) {
  const tickets = d.demandas.filter((x) => !x.ehMae && x.status !== 'CANCELADA');
  const pedidos = d.demandas.filter((x) => !x.maeId && x.status !== 'CANCELADA');
  const abertos = tickets.filter(ativa);
  const atrasados = abertos.filter((x) => faixa(x, hoje) === 'ATRASADA');
  const concluidos = tickets.filter((x) => x.status === 'CONCLUIDA');
  const fora = pedidos.filter((x) => x.radar === 'FORA');

  const porArea = {};
  for (const p of pedidos) (porArea[p.areaSolicitante || 'Não informada'] ||= []).push(p);
  const areas = Object.entries(porArea).map(([area, lista]) => {
    const ants = lista.map((x) => x.antecedencia).filter((x) => x !== null && x !== undefined);
    return {
      area, pedidos: lista.length,
      antecedenciaMedia: ants.length ? ants.reduce((a, b) => a + b, 0) / ants.length : null,
      paraOntem: pct(lista.filter((x) => x.urgencia === 'URGENTE' || (x.antecedencia ?? 99) < LIMITES.urgenciaParaOntem).length, lista.length),
      fora: pct(lista.filter((x) => x.radar === 'FORA').length, lista.length),
      incompletos: pct(lista.filter((x) => x.nasceuIncompleta).length, lista.length),
    };
  }).sort((a, b) => b.fora - a.fora || b.pedidos - a.pedidos);

  const sup = supervisores(d).map((u) => {
    const meus = tickets.filter((x) => x.destinatario === u.id);
    const conc = meus.filter((x) => x.status === 'CONCLUIDA');
    return {
      id: u.id, nome: u.nome, setor: SETORES[u.setor] || '—',
      abertas: meus.filter(ativa).length,
      atrasadas: meus.filter((x) => ativa(x) && faixa(x, hoje) === 'ATRASADA').length,
      noPrazo: conc.length ? pct(conc.filter(noPrazo).length, conc.length) : null,
      antecipou: conc.filter((x) => x.prazo && (x.concluidaEm || '').slice(0, 10) < x.prazo).length,
      foraAbertas: meus.filter((x) => ativa(x) && x.radar === 'FORA').length,
    };
  }).sort((a, b) => b.atrasadas - a.atrasadas || b.abertas - a.abertas);

  const contar = (lista, f) => {
    const m = {};
    for (const x of lista) { const k = f(x); if (k) m[k] = (m[k] || 0) + 1; }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  const maes = d.demandas.filter((x) => x.ehMae && x.status !== 'CANCELADA').map((m) => {
    const filhas = d.demandas.filter((x) => x.maeId === m.id && x.status !== 'CANCELADA');
    return { mae: m, total: filhas.length, concluidas: filhas.filter((x) => x.status === 'CONCLUIDA').length, atrasadas: filhas.filter((x) => ativa(x) && faixa(x, hoje) === 'ATRASADA').length };
  });

  return {
    abertos: abertos.length, atrasados: atrasados.length, pedidos: pedidos.length,
    concluidos: concluidos.length, noPrazo: concluidos.filter(noPrazo).length,
    taxaImprevisto: pct(fora.length, pedidos.length),
    incompletos: pct(pedidos.filter((x) => x.nasceuIncompleta).length, pedidos.length),
    areas, supervisores: sup, maes,
    motivos: contar(fora, (x) => MOTIVOS_RADAR[x.motivoRadar] || 'Antecedência curta (automático)'),
    tipos: contar(pedidos, (x) => x.tipo),
    canais: contar(pedidos, (x) => CANAIS[x.canal] || x.canal),
  };
}

export const DIA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const DIA_LONGO = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const dataCurta = (iso) => (iso ? `${DIA_CURTO[diaSemana(iso)]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}` : 'sem prazo');
export const dataLonga = (iso) => (iso ? `${DIA_LONGO[diaSemana(iso)]}, ${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : 'sem prazo');
export function quando(dem, hoje = hojeISO()) {
  if (dem.status === 'CONCLUIDA') return `concluída ${dataCurta((dem.concluidaEm || '').slice(0, 10))}`;
  if (dem.status === 'CANCELADA') return 'cancelada';
  if (!dem.prazo) return 'sem prazo';
  const n = diasEntre(hoje, dem.prazo);
  return n < 0 ? `${-n} dia(s) de atraso` : n === 0 ? 'vence hoje' : `em ${n} dia(s)`;
}
