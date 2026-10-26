// Regras de negócio puras: catálogo com vigência, calendário de dias úteis, motor da agenda, indicadores e achados.
// Nada aqui altera estado; as mudanças passam por acoes.js (que checa permissão e registra no log).
import { somarDias, diasDaSemana, semanaISO, hojeISO } from './util.js';

export const PERFIS = {
  GESTOR: 'Gerência operacional',
  SUPERVISOR: 'Supervisor da UTD',
  COLABORADOR: 'Retaguarda',
  AUDITOR: 'Auditoria',
  ADMIN: 'Administrador',
};

export const CARGOS = {
  TCO: 'Técnico Comercial',
  TMN: 'Técnico de Manutenção',
  ESP: 'Técnico Especialista',
  ACO: 'Assistente Comercial',
  AGE: 'Assistente Geral',
};

export const UTDS = { JUA: 'Juazeiro', JAC: 'Jacobina', SBF: 'Senhor do Bonfim', REM: 'Remanso' };

/** Periodicidade: nome, sigla curta (texto no cartão, não só cor) e janela de remanejamento sem aprovação. */
export const PERIODICIDADES = {
  D: { nome: 'Diária', sigla: 'D', janela: 'no mesmo dia ou no próximo dia útil' },
  W: { nome: 'Semanal', sigla: 'S', janela: 'dentro da mesma semana' },
  Q: { nome: 'Quinzenal', sigla: 'Q', janela: 'dentro da mesma quinzena' },
  M: { nome: 'Mensal', sigla: 'M', janela: 'dentro do mesmo mês' },
  S: { nome: 'Sob demanda', sigla: '—', janela: 'não entra na agenda' },
};

export const SITUACOES = { R: 'Rotina', S: 'Sob demanda', T: 'Transferir para outra área' };

export const REGRAS_MES = { P1: '1º dia útil', P2: '2º dia útil', P5: '5º dia útil', P10: '10º dia útil', P15: '15º dia útil', U: 'Último dia útil' };
/** Regra do mês: Pn = n-ésimo dia útil (1 a 20), U = último dia útil, Dnn = dia fixo do calendário (prazo regulatório: antecipa se não for útil). */
export const regraMesValida = (r) => r === 'U' || /^P([1-9]|1\d|20)$/.test(r) || /^D([1-9]|[12]\d|3[01])$/.test(r);
export const rotuloRegraMes = (r) => REGRAS_MES[r] || (!regraMesValida(r) ? '—' : r[0] === 'D' ? `Dia ${r.slice(1)} (antecipa se não for útil)` : `${r.slice(1)}º dia útil`);

export const DIAS_SEMANA = { 1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta' };
export const DIA_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const MOTIVOS_REMANEJAMENTO = {
  EMERGENCIA: 'Atendimento emergencial / contingência',
  REUNIAO: 'Reunião convocada pela gestão',
  AUSENCIA: 'Ausência, folga ou treinamento',
  SISTEMA: 'Sistema ou relatório indisponível',
  DEPENDENCIA: 'Depende de informação de outra área',
  OUTRO: 'Outro (descrever)',
};

export const LIMITES = Object.freeze({
  evidenciaMin: 10, evidenciaMax: 500, textoMax: 300, nomeMax: 200, duracaoMax: 480,
  csvBytesMax: 2 * 1024 * 1024, csvLinhasMax: 2000,
});

export class ErroDominio extends Error {}

// ---------- Regras com vigência (feriados, capacidade) ----------
export const regras = (d) => d.regras.at(-1).valores;

// ---------- Calendário ----------
const diaSemana = (iso) => new Date(`${iso}T12:00:00`).getDay();
export const ehFeriado = (d, iso) => regras(d).feriados.some((f) => f.data === iso);
export const ehDiaUtil = (d, iso) => { const w = diaSemana(iso); return w >= 1 && w <= 5 && !ehFeriado(d, iso); };
export function proximoUtil(d, iso) {
  let x = iso;
  for (let i = 0; i < 15 && !ehDiaUtil(d, x); i++) x = somarDias(x, 1);
  return x;
}
export const diasUteisDaSemana = (d, semana) => diasDaSemana(semana).filter((x) => ehDiaUtil(d, x));

function nEsimoUtilDoMes(d, ano, mes, n) {
  let x = `${ano}-${String(mes).padStart(2, '0')}-01`, conta = 0, ultimo = null;
  while (Number(x.slice(5, 7)) === mes) {
    if (ehDiaUtil(d, x)) { conta++; ultimo = x; if (conta === n) return x; }
    x = somarDias(x, 1);
  }
  return ultimo; // n maior que os dias úteis do mês: usa o último
}

/** Dia fixo do calendário (limitado ao fim do mês); se não for útil, antecipa para o dia útil anterior (prazo não pode vencer). */
function diaFixoDoMes(d, ano, mes, dia) {
  let x = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  while (Number(x.slice(5, 7)) !== mes) x = somarDias(x, -1); // dia 31 em mês de 30 dias
  for (let i = 0; i < 15 && !ehDiaUtil(d, x); i++) x = somarDias(x, -1);
  return x;
}

// ---------- Catálogo com vigência: nada é recalculado para trás ----------
/** Versão da atividade válida na data (a última com início de vigência até a data). */
export function versaoEm(atv, iso) {
  let v = null;
  for (const x of atv.versoes) if (x.desde <= iso) v = x;
  return v;
}
export const versaoAtual = (atv) => atv.versoes.at(-1);

/** Transferência com aceite registrado tira a atividade da agenda a partir da data efetiva. */
const transferida = (atv, iso) => !!atv.aceite && atv.aceite.desde <= iso;

/** Datas da atividade num intervalo: { nominal, data }. data = dia em que ela cai depois de deslizar feriado. */
export function datasDaAtividade(d, atv, ini, fim) {
  const out = [];
  const add = (nominal, data) => {
    if (data < ini || data > fim) return;
    const v = versaoEm(atv, nominal);
    if (!v || !['R', 'T'].includes(v.situacao) || transferida(atv, data)) return;
    out.push({ nominal, data, v });
  };
  // Candidatos a partir de duas semanas antes: o deslize de feriado pode trazer uma data de antes do intervalo.
  const inicio = somarDias(ini, -14);
  for (let x = inicio; x <= fim; x = somarDias(x, 1)) {
    const v = versaoEm(atv, x);
    if (!v) continue;
    const w = diaSemana(x);
    if (v.periodicidade === 'D') { if (ehDiaUtil(d, x)) add(x, x); }
    else if (v.periodicidade === 'W') { if (w === Number(v.diaSemana)) add(x, proximoUtil(d, x)); }
    else if (v.periodicidade === 'Q') {
      const n = Number(semanaISO(x).split('-W')[1]);
      if (w === Number(v.diaSemana) && n % 2 === 0) add(x, proximoUtil(d, x));
    }
  }
  // Mensal: um alvo por mês do intervalo, calculado direto (o dia 1 pode estar bem antes do intervalo).
  for (let m = `${inicio.slice(0, 7)}-01`; m <= fim; m = somarDias(`${m.slice(0, 7)}-28`, 4).slice(0, 7) + '-01') {
    const v = versaoEm(atv, m) || versaoEm(atv, fim);
    if (v?.periodicidade !== 'M') continue;
    const ano = Number(m.slice(0, 4)), mes = Number(m.slice(5, 7));
    const alvo = v.regraMes === 'U' ? nEsimoUtilDoMes(d, ano, mes, 99)
      : String(v.regraMes).startsWith('D') ? diaFixoDoMes(d, ano, mes, Number(v.regraMes.slice(1)))
        : nEsimoUtilDoMes(d, ano, mes, Number(String(v.regraMes || 'P1').slice(1)) || 1);
    if (alvo && versaoEm(atv, alvo)?.periodicidade === 'M') add(alvo, alvo);
  }
  return out;
}

export const chaveOcorrencia = (atvId, usuarioId, nominal) => `${atvId}|${usuarioId}|${nominal}`;

/** Quem faz a rotina: pessoas da retaguarda com cargo e UTD cadastrados (ocupação). */
export const colaboradores = (d) => d.usuarios.filter((u) => u.perfil === 'COLABORADOR' && u.cargo && u.utd && u.ativo !== false);

/**
 * Agenda calculada: uma ocorrência por atividade × ocupante do cargo × data.
 * O que foi feito (conclusão, remanejamento, pedido ao supervisor) fica em d.execucoes, pela chave.
 */
export function ocorrencias(d, { ini, fim, usuarios = colaboradores(d), hoje = hojeISO() }) {
  const out = [];
  // Busca também datas originais até 31 dias antes: remanejamento pode trazer a ocorrência para dentro do intervalo.
  const datas = d.atividades.map((atv) => [atv, datasDaAtividade(d, atv, somarDias(ini, -31), fim)]);
  for (const u of usuarios) {
    for (const [atv, lista] of datas) {
      for (const { nominal, data, v } of lista) {
        if (v.cargo !== u.cargo) continue;
        const chave = chaveOcorrencia(atv.id, u.id, nominal);
        const ex = d.execucoes[chave] || null;
        const atual = ex?.dataAtual || data;
        if (atual < ini || atual > fim) continue;
        out.push(montar(atv, v, u, nominal, data, atual, ex, chave, hoje));
      }
    }
  }
  return out.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : ordemHorario(a) - ordemHorario(b)));
}

/** Recalcula uma ocorrência a partir da chave (atividade|pessoa|data original). null se a chave não corresponde à agenda. */
export function ocorrenciaPorChave(d, chave, hoje = hojeISO()) {
  const [atvId, usuarioId, nominal] = String(chave).split('|');
  const atv = d.atividades.find((a) => a.id === atvId), u = d.usuarios.find((x) => x.id === usuarioId);
  if (!atv || !u || !/^\d{4}-\d{2}-\d{2}$/.test(nominal || '')) return null;
  const x = datasDaAtividade(d, atv, nominal, somarDias(nominal, 20)).find((y) => y.nominal === nominal && y.v.cargo === u.cargo);
  if (!x) return null;
  const ex = d.execucoes[chave] || null;
  return montar(atv, x.v, u, nominal, x.data, ex?.dataAtual || x.data, ex, chave, hoje);
}

/** Pedidos de remanejamento aguardando decisão (qualquer data). */
export function pedidosPendentes(d, hoje = hojeISO()) {
  return Object.entries(d.execucoes).filter(([, ex]) => ex.pedido).map(([chave]) => ocorrenciaPorChave(d, chave, hoje)).filter(Boolean)
    .sort((a, b) => (a.exec.pedido.em < b.exec.pedido.em ? -1 : 1));
}

function montar(atv, v, u, nominal, dataPrevista, data, ex, chave, hoje) {
  const remanejada = !!ex?.remanejamentos?.some((r) => r.situacao === 'APLICADO');
  const status = ex?.concluidaEm ? 'CONCLUIDA' : ex?.pedido ? 'AGUARDA' : data < hoje ? 'ATRASADA' : data === hoje ? 'HOJE' : 'PROGRAMADA';
  return {
    chave, atvId: atv.id, codigo: atv.codigo, nome: v.nome, periodicidade: v.periodicidade, duracaoMin: Number(v.duracaoMin) || 0,
    horario: v.horario || '', evidenciaEsperada: v.evidencia || '', situacao: v.situacao, emTransferencia: v.situacao === 'T',
    destino: v.destino || '', aprovador: v.aprovador || '',
    usuarioId: u.id, utd: u.utd, cargo: u.cargo, nominal, dataPrevista, data, exec: ex, remanejada, status,
    noPrazo: !!ex?.concluidaEm && ex.concluidaEm.slice(0, 10) <= dataPrevista && !remanejada,
  };
}

/** Horário fixo primeiro ("07:30"), depois as contínuas e as sem horário. */
export function ordemHorario(o) {
  if (/^\d{2}:\d{2}$/.test(o.horario)) return Number(o.horario.replace(':', ''));
  return o.horario === 'CONT' ? 2400 : 2500;
}

/** Janela em que o remanejamento não precisa de aprovação (depende da periodicidade). */
export function janelaRemanejamento(d, o) {
  const p = o.dataPrevista;
  if (o.periodicidade === 'D') return { ini: p, fim: proximoUtil(d, somarDias(p, 1)) };
  if (o.periodicidade === 'W') { const dias = diasDaSemana(semanaISO(p)); return { ini: dias[0], fim: dias[6] }; }
  if (o.periodicidade === 'Q') { const dias = diasDaSemana(semanaISO(o.nominal)); return { ini: dias[0], fim: somarDias(dias[0], 13) }; }
  const ini = `${p.slice(0, 7)}-01`;
  let fim = ini;
  while (somarDias(fim, 1).slice(0, 7) === p.slice(0, 7)) fim = somarDias(fim, 1);
  return { ini, fim };
}

/** Diz se o remanejamento precisa do supervisor (e por quê). */
export function precisaAprovacao(d, o, novaData) {
  const motivos = [];
  const j = janelaRemanejamento(d, o);
  if (novaData < j.ini || novaData > j.fim) motivos.push(`fora da janela da periodicidade ${PERIODICIDADES[o.periodicidade].nome.toLowerCase()} (${PERIODICIDADES[o.periodicidade].janela})`);
  const jaFeitos = (o.exec?.remanejamentos || []).filter((r) => r.situacao === 'APLICADO').length;
  if (jaFeitos >= 1) motivos.push(`${jaFeitos + 1}º remanejamento da mesma ocorrência`);
  return motivos;
}

// ---------- Indicadores ----------
export function indicadores(lista, hoje = hojeISO()) {
  // Base = programadas até ontem + as de hoje já concluídas: o que ainda está no prazo hoje não conta como falha.
  const base = lista.filter((o) => o.dataPrevista < hoje || (o.dataPrevista === hoje && o.status === 'CONCLUIDA'));
  const noPrazo = base.filter((o) => o.noPrazo).length;
  const concluidas = base.filter((o) => o.status === 'CONCLUIDA').length;
  return {
    programadas: base.length, noPrazo, concluidas,
    aderencia: base.length ? noPrazo / base.length : null,
    cumprimento: base.length ? concluidas / base.length : null,
    remanejadas: lista.filter((o) => o.remanejada).length,
    atrasadas: lista.filter((o) => o.status === 'ATRASADA').length,
    aguardando: lista.filter((o) => o.status === 'AGUARDA').length,
  };
}

/** Carga = minutos programados na semana ÷ capacidade (minutos por dia útil × dias úteis). Contínuas (0 min) não somam. */
export function carga(d, lista, semana) {
  const dias = diasUteisDaSemana(d, semana).length;
  const cap = dias * regras(d).capacidadeDiariaMin;
  const min = lista.reduce((t, o) => t + o.duracaoMin, 0);
  return { min, cap, pct: cap ? min / cap : 0 };
}

// ---------- Achados do catálogo (o que impede a rotina de ser gerenciável) ----------
const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function achados(d, hoje = hojeISO()) {
  const vig = d.atividades.map((a) => ({ a, v: versaoEm(a, hoje) || versaoAtual(a) })).filter((x) => x.v);
  const rotina = vig.filter((x) => x.v.situacao !== 'S');
  const porNome = new Map();
  for (const x of vig) {
    const k = normalizar(x.v.nome);
    porNome.set(k, [...(porNome.get(k) || []), x]);
  }
  const multiR = [...porNome.values()].filter((g) => new Set(g.map((x) => x.v.cargo)).size > 1)
    .map((g) => ({ nome: g[0].v.nome, cargos: [...new Set(g.map((x) => x.v.cargo))], ids: g.map((x) => x.a.id) }));
  const semA = rotina.filter((x) => !x.v.aprovador);
  const estimadas = rotina.filter((x) => !x.v.validada);
  const transfSemAceite = vig.filter((x) => x.v.situacao === 'T' && !x.a.aceite);
  const semana = semanaISO(hoje);
  const dias = diasDaSemana(semana);
  const capCargo = Object.keys(CARGOS).map((c) => {
    const min = d.atividades.reduce((t, a) => t + datasDaAtividade(d, a, dias[0], dias[6]).filter((x) => x.v.cargo === c).reduce((s, x) => s + (Number(x.v.duracaoMin) || 0), 0), 0);
    const cap = diasUteisDaSemana(d, semana).length * regras(d).capacidadeDiariaMin;
    return { cargo: c, min, cap, pct: cap ? min / cap : 0 };
  });
  return { multiR, semA, estimadas, transfSemAceite, capCargo, total: vig.length, rotina: rotina.length };
}

/** Período da semana corrente ou deslocada, já com os dias úteis. */
export function periodoSemana(semana) {
  const dias = diasDaSemana(semana);
  return { semana, ini: dias[0], fim: dias[6], dias: dias.slice(0, 5) };
}

export const hhmm = (min) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`;
export const dataCurta = (iso) => `${DIA_CURTO[new Date(`${iso}T12:00:00`).getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
