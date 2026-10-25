// Catálogos e regras de negócio puras (sem DOM). Espelham a especificação §3, §6 e §8.
import { hojeISO, somarDias, diasEntre, uid } from './util.js';

export const TIPOS_ATIVO = {
  POSTE: 'Poste',
  TRAFO: 'Transformador',
  CHAVE_FUSIVEL: 'Chave fusível',
  RELIGADOR: 'Religador',
};

export const CRITERIOS = [
  { id: 'TRAFO_REINCIDENTE', nome: 'Transformador reincidente', periodicidadeDias: 90, peso: 3, tipos: ['TRAFO'] },
  { id: 'CHAVE_FUSIVEL_REINCIDENTE', nome: 'Chave fusível reincidente', periodicidadeDias: 90, peso: 3, tipos: ['CHAVE_FUSIVEL'] },
  { id: 'TRONCO_ALIMENTADOR', nome: 'Tronco de alimentador', periodicidadeDias: 180, peso: 2, tipos: ['POSTE', 'RELIGADOR'] },
  { id: 'VEGETACAO_HISTORICO', nome: 'Trecho com histórico de vegetação', periodicidadeDias: 120, peso: 1, tipos: ['POSTE'] },
];
export const criterio = (id) => CRITERIOS.find((c) => c.id === id);

export const TIPOS_EQUIPE = {
  INSPECAO: 'Inspeção',
  LEVE: 'Manutenção leve',
  PESADA: 'Turma pesada',
  LINHA_VIVA: 'Linha viva',
  PODA: 'Poda',
};

export const CATEGORIAS = {
  ESTRUTURAL: 'Estrutural',
  VEGETACAO: 'Vegetação / poda',
  ELETRICO: 'Elétrico',
  FAUNA: 'Fauna',
};

// equipes: tipos de equipe aptos a executar. resolveNaHora: pode ser baixado na própria inspeção.
export const TIPOS_DEFEITO = [
  { id: 'NINHO', nome: 'Ninho de pássaro na estrutura', categoria: 'FAUNA', severidade: 'C', equipes: ['LEVE', 'LINHA_VIVA', 'INSPECAO'], resolveNaHora: true, atividade: 'Retirada de ninho' },
  { id: 'PODA', nome: 'Vegetação em contato/proximidade da rede', categoria: 'VEGETACAO', severidade: 'B', equipes: ['PODA'], resolveNaHora: false, atividade: 'Poda de vegetação' },
  { id: 'CRUZETA', nome: 'Cruzeta danificada/podre', categoria: 'ESTRUTURAL', severidade: 'A', equipes: ['PESADA', 'LINHA_VIVA'], resolveNaHora: false, atividade: 'Substituição de cruzeta' },
  { id: 'POSTE_DANIFICADO', nome: 'Poste trincado/inclinado', categoria: 'ESTRUTURAL', severidade: 'A', equipes: ['PESADA'], resolveNaHora: false, atividade: 'Substituição/aprumo de poste' },
  { id: 'ESTAI', nome: 'Estai frouxo/rompido', categoria: 'ESTRUTURAL', severidade: 'C', equipes: ['LEVE', 'PESADA'], resolveNaHora: true, atividade: 'Reaperto/substituição de estai' },
  { id: 'ISOLADOR', nome: 'Isolador quebrado/trincado', categoria: 'ELETRICO', severidade: 'B', equipes: ['LINHA_VIVA', 'LEVE'], resolveNaHora: false, atividade: 'Substituição de isolador' },
  { id: 'CONEXAO', nome: 'Conexão aquecida/oxidada', categoria: 'ELETRICO', severidade: 'B', equipes: ['LINHA_VIVA'], resolveNaHora: false, atividade: 'Refazer conexão' },
  { id: 'ATERRAMENTO', nome: 'Aterramento rompido/ausente', categoria: 'ELETRICO', severidade: 'C', equipes: ['LEVE'], resolveNaHora: true, atividade: 'Recomposição de aterramento' },
  { id: 'CHAVE', nome: 'Chave fusível com defeito/elo inadequado', categoria: 'ELETRICO', severidade: 'B', equipes: ['LEVE', 'LINHA_VIVA'], resolveNaHora: false, atividade: 'Manutenção/substituição da chave', ativos: ['CHAVE_FUSIVEL'] },
  { id: 'TRAFO_VAZAMENTO', nome: 'Vazamento de óleo / sobrecarga no trafo', categoria: 'ELETRICO', severidade: 'A', equipes: ['PESADA'], resolveNaHora: false, atividade: 'Substituição/remanejamento de trafo', ativos: ['TRAFO'] },
];
export const tipoDefeito = (id) => TIPOS_DEFEITO.find((t) => t.id === id);
export const tiposDefeitoPara = (tipoAtivo) => TIPOS_DEFEITO.filter((t) => !t.ativos || t.ativos.includes(tipoAtivo));

export const SEVERIDADES = { A: 'A — Crítico', B: 'B — Alto', C: 'C — Moderado' };

export const STATUS_DEFEITO = {
  IDENTIFICADO: 'Identificado',
  VALIDADO: 'Validado',
  PROGRAMADO: 'Programado',
  EXECUTADO: 'Executado (aguarda verificação)',
  VERIFICADO: 'Verificado / fechado',
  REJEITADO: 'Rejeitado',
  CANCELADO: 'Cancelado',
};
export const STATUS_ABERTOS = ['IDENTIFICADO', 'VALIDADO', 'PROGRAMADO'];

export const PERFIS = {
  GESTOR: 'Gestor / Planejamento',
  SUPERVISOR: 'Supervisor de campo',
  EQUIPE: 'Equipe de campo',
  AUDITOR: 'Auditoria (somente leitura)',
};

export const RAIO_VALIDACAO_M = 50;
export const RAIO_ALERTA_M = 150;
export const JANELA_PROGRAMACAO_DIAS = 30;

// Indicadores de continuidade sintéticos por conjunto (DEC/FEC em horas/vezes, 12 meses).
export const CONJUNTOS = {
  'CJ-Centro': { decMeta: 8.5, decApurado: 10.4, fecMeta: 6.0, fecApurado: 6.9 },
  'CJ-Norte': { decMeta: 9.0, decApurado: 7.8, fecMeta: 6.5, fecApurado: 5.1 },
  'CJ-Sul': { decMeta: 10.0, decApurado: 11.2, fecMeta: 7.0, fecApurado: 7.6 },
};

// ---------- Score de risco (§6) ----------
const PESO_SEV = { A: 40, B: 25, C: 10 };

export function scoreRisco(defeito, ativo) {
  const cj = CONJUNTOS[ativo?.conjunto];
  const partes = {
    severidade: PESO_SEV[defeito.severidade] || 0,
    clientes: Math.min(20, Math.round(((ativo?.ucs || 0) / 500) * 20)),
    continuidade: cj ? (cj.decApurado > cj.decMeta ? 15 : 5) : 0,
    compensacao: Math.min(15, Math.round(((ativo?.comp12m || 0) / 50000) * 15)),
    reincidencia: Math.min(10, Math.round((ativo?.falhas12m || 0) * 2.5)),
  };
  return { total: Object.values(partes).reduce((a, b) => a + b, 0), partes };
}

export function faixaRisco(score) {
  if (score >= 70) return { id: 'critico', nome: 'Crítico' };
  if (score >= 40) return { id: 'alto', nome: 'Alto' };
  if (score >= 20) return { id: 'medio', nome: 'Médio' };
  return { id: 'baixo', nome: 'Baixo' };
}

// ---------- Motor de periodicidade (RF-PLN-03) ----------
/** Gera inspeções programadas devidas para cada par ativo×critério sem inspeção em aberto. */
export function gerarInspecoesDevidas(dados, ref = hojeISO()) {
  const abertas = new Set(dados.inspecoes.filter((i) => i.status !== 'CONCLUIDA').map((i) => `${i.ativoId}|${i.criterioId}`));
  const limite = somarDias(ref, JANELA_PROGRAMACAO_DIAS);
  let geradas = 0;
  for (const a of dados.ativos) {
    for (const cid of a.criterios || []) {
      const c = criterio(cid);
      if (!c || abertas.has(`${a.id}|${cid}`)) continue;
      const ultima = a.ultimaInspecao?.[cid];
      const prazo = ultima ? somarDias(ultima, c.periodicidadeDias) : ref;
      if (prazo > limite) continue;
      dados.inspecoes.push({
        id: uid('insp'), ativoId: a.id, criterioId: cid, tipo: 'PROGRAMADA', status: 'PENDENTE',
        prazo, equipeId: null, criadaEm: new Date().toISOString(),
      });
      geradas++;
    }
  }
  return geradas;
}

// ---------- Fluxo do defeito (§3) ----------
// [de, para, perfis permitidos]
const TRANSICOES = [
  ['IDENTIFICADO', 'VALIDADO', ['SUPERVISOR', 'GESTOR']],
  ['IDENTIFICADO', 'REJEITADO', ['SUPERVISOR', 'GESTOR']],
  ['VALIDADO', 'PROGRAMADO', ['SUPERVISOR', 'GESTOR']],
  ['PROGRAMADO', 'PROGRAMADO', ['SUPERVISOR', 'GESTOR']],
  ['PROGRAMADO', 'EXECUTADO', ['EQUIPE']],
  ['EXECUTADO', 'VERIFICADO', ['SUPERVISOR', 'GESTOR']],
  ['EXECUTADO', 'PROGRAMADO', ['SUPERVISOR', 'GESTOR']],
  ['IDENTIFICADO', 'CANCELADO', ['GESTOR']],
  ['VALIDADO', 'CANCELADO', ['GESTOR']],
  ['PROGRAMADO', 'CANCELADO', ['GESTOR']],
];

export function podeTransicionar(usuario, defeito, para) {
  const t = TRANSICOES.find(([de, p]) => de === defeito.status && p === para);
  if (!t || !t[2].includes(usuario.perfil)) return false;
  if (para === 'EXECUTADO') return defeito.equipeId === usuario.equipeId;
  return true;
}

export function equipesAptas(dados, defeito) {
  const td = tipoDefeito(defeito.tipoId);
  return dados.equipes.filter((e) => td?.equipes.includes(e.tipo));
}

// ---------- Estado visual do ativo no mapa ----------
export function estadoAtivo(dados, ativoId, ref = hojeISO()) {
  const defs = dados.defeitos.filter((d) => d.ativoId === ativoId);
  const abertos = defs.filter((d) => STATUS_ABERTOS.includes(d.status));
  if (abertos.length) {
    const sev = abertos.some((d) => d.severidade === 'A') ? 'A' : abertos.some((d) => d.severidade === 'B') ? 'B' : 'C';
    return { id: `sev-${sev}`, nome: `Defeito aberto (${sev})` };
  }
  const pend = dados.inspecoes.filter((i) => i.ativoId === ativoId && i.status !== 'CONCLUIDA');
  if (pend.some((i) => i.prazo < ref)) return { id: 'insp-vencida', nome: 'Inspeção vencida' };
  if (pend.length) return { id: 'insp-pendente', nome: 'Inspeção programada' };
  if (defs.some((d) => d.status === 'EXECUTADO')) return { id: 'executado', nome: 'Executado — aguarda verificação' };
  const a = dados.ativos.find((x) => x.id === ativoId);
  return a?.criterios?.length ? { id: 'ok', nome: 'Em dia' } : { id: 'neutro', nome: 'Sem criticidade marcada' };
}

/** Pendências que fazem sentido para uma equipe (base do alerta de proximidade e do filtro "minha equipe"). */
export function pendenciasDaEquipe(dados, equipe) {
  if (!equipe) return [];
  const itens = [];
  for (const i of dados.inspecoes) {
    if (i.status === 'CONCLUIDA') continue;
    if (i.equipeId === equipe.id || (!i.equipeId && equipe.tipo === 'INSPECAO')) itens.push({ tipo: 'inspecao', ativoId: i.ativoId, ref: i });
  }
  for (const d of dados.defeitos) {
    if (d.status === 'PROGRAMADO' && d.equipeId === equipe.id) itens.push({ tipo: 'defeito', ativoId: d.ativoId, ref: d });
    else if (d.status === 'VALIDADO' && tipoDefeito(d.tipoId)?.equipes.includes(equipe.tipo)) itens.push({ tipo: 'defeito', ativoId: d.ativoId, ref: d });
  }
  return itens;
}

// ---------- Ranking ponderado (§8) ----------
export const PONTOS = {
  inspecaoBase: 1, // + peso do critério quando no prazo
  inspecaoAtrasada: 1,
  defeitoValidado: { A: 10, B: 6, C: 3 },
  defeitoRejeitado: -3,
  execucao: { A: 15, B: 9, C: 5 },
};

export function calcularRanking(dados) {
  const linhas = new Map(dados.equipes.map((e) => [e.id, {
    equipe: e, pontos: 0, inspecoes: 0, defeitosValidados: 0, defeitosRejeitados: 0, execucoes: 0, estornos: 0,
  }]));
  for (const i of dados.inspecoes) {
    const r = linhas.get(i.equipeId);
    if (!r || i.status !== 'CONCLUIDA') continue;
    r.inspecoes++;
    const noPrazo = i.tipo === 'AVULSA' || i.concluidaEm.slice(0, 10) <= i.prazo;
    const peso = criterio(i.criterioId)?.peso || 1;
    r.pontos += noPrazo ? PONTOS.inspecaoBase + peso : PONTOS.inspecaoAtrasada;
  }
  for (const d of dados.defeitos) {
    const r = linhas.get(d.identificadoPorEquipe);
    if (r) {
      if (d.status === 'REJEITADO') { r.defeitosRejeitados++; r.pontos += PONTOS.defeitoRejeitado; }
      else if (!['IDENTIFICADO', 'CANCELADO'].includes(d.status)) { r.defeitosValidados++; r.pontos += PONTOS.defeitoValidado[d.severidade]; }
    }
    const re = linhas.get(d.execucao?.equipeId);
    if (re && d.status === 'VERIFICADO') {
      re.execucoes++;
      re.pontos += PONTOS.execucao[d.severidade];
      const reincidiu = dados.defeitos.some((o) => o !== d && o.ativoId === d.ativoId && o.criadoEm > d.verificadoEm
        && diasEntre(d.verificadoEm, o.criadoEm) <= 90 && o.status !== 'REJEITADO');
      if (reincidiu) { re.estornos++; re.pontos -= PONTOS.execucao[d.severidade]; }
    }
  }
  const porTipo = {};
  for (const r of linhas.values()) (porTipo[r.equipe.tipo] ||= []).push(r);
  for (const k of Object.keys(porTipo)) porTipo[k].sort((a, b) => b.pontos - a.pontos);
  return porTipo;
}

// ---------- Indicadores do painel (§1, RF-DSH) ----------
export function indicadores(dados, ref = hojeISO()) {
  const progr = dados.inspecoes.filter((i) => i.tipo === 'PROGRAMADA');
  const devidas = progr.filter((i) => i.prazo <= ref);
  const noPrazo = (i) => i.status === 'CONCLUIDA' && i.concluidaEm.slice(0, 10) <= i.prazo;
  const vencidas = progr.filter((i) => i.status !== 'CONCLUIDA' && i.prazo < ref);
  const abertos = dados.defeitos.filter((d) => STATUS_ABERTOS.includes(d.status));
  const ativoPorId = new Map(dados.ativos.map((a) => [a.id, a]));

  const porSev = { A: 0, B: 0, C: 0 };
  abertos.forEach((d) => porSev[d.severidade]++);
  const idadeMedia = abertos.length ? abertos.reduce((s, d) => s + diasEntre(d.criadoEm, ref), 0) / abertos.length : 0;
  const criticosVelhos = abertos.filter((d) => d.severidade === 'A' && diasEntre(d.criadoEm, ref) > 7).length;

  const porEquipeTipo = Object.fromEntries(Object.keys(TIPOS_EQUIPE).map((k) => [k, 0]));
  abertos.forEach((d) => { porEquipeTipo[tipoDefeito(d.tipoId)?.equipes[0]]++; });

  const ativosExpostos = new Set(abertos.filter((d) => d.severidade !== 'C').map((d) => d.ativoId));
  const compExpostaMes = [...ativosExpostos].reduce((s, id) => s + (ativoPorId.get(id)?.comp12m || 0), 0) / 12;

  const criticos = dados.ativos.filter((a) => a.criterios.some((c) => c.endsWith('_REINCIDENTE')));
  const compCriticosMes = criticos.reduce((s, a) => s + (a.comp12m || 0), 0) / 12;

  const porCriterio = CRITERIOS.map((c) => {
    const dv = devidas.filter((i) => i.criterioId === c.id);
    return { criterio: c, devidas: dv.length, noPrazo: dv.filter(noPrazo).length, vencidas: vencidas.filter((i) => i.criterioId === c.id).length };
  });

  const semanas = [];
  for (let s = 7; s >= 0; s--) {
    const fim = somarDias(ref, -7 * s), ini = somarDias(fim, -6);
    semanas.push({
      rotulo: ini.slice(8, 10) + '/' + ini.slice(5, 7),
      programadas: progr.filter((i) => i.prazo >= ini && i.prazo <= fim).length,
      concluidas: dados.inspecoes.filter((i) => i.status === 'CONCLUIDA' && i.concluidaEm.slice(0, 10) >= ini && i.concluidaEm.slice(0, 10) <= fim).length,
    });
  }

  const fechados = dados.defeitos.filter((d) => d.status === 'VERIFICADO' && d.execucao?.em);
  const leadTime = fechados.length ? fechados.reduce((s, d) => s + diasEntre(d.criadoEm, d.execucao.em), 0) / fechados.length : 0;

  return {
    aderencia: devidas.length ? devidas.filter(noPrazo).length / devidas.length : 1,
    devidas: devidas.length, vencidas: vencidas.length,
    abertos: abertos.length, porSev, idadeMedia, criticosVelhos, porEquipeTipo,
    compExpostaMes, ativosExpostos: ativosExpostos.size, compCriticosMes, ativosCriticos: criticos.length, porCriterio, semanas, leadTime,
    aguardandoVerificacao: dados.defeitos.filter((d) => d.status === 'EXECUTADO').length,
  };
}
