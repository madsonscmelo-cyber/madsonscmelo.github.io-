// Comandos que alteram o estado. Toda regra de permissão é checada aqui (no produto real: no servidor).
import { uid, hojeISO, distanciaM, semanaISO, proximoDiaUtil } from './util.js';
import { custoDefeito } from './custos.js';
import { estado, registrar, ativoPorId, equipeDoUsuario } from './store.js';
import { podeTransicionar, gerarInspecoesDevidas, tipoDefeito, equipesAptas } from './dominio.js';
import { logar } from './auditoria.js';

const agora = () => new Date().toISOString();

/** Toda recusa também vai para o log: permissão negada (segurança) ou dado inválido (validação). */
export class ErroRegra extends Error {
  constructor(mensagem, tipo = 'VALIDACAO') {
    super(mensagem);
    this.tipo = tipo;
    const permissao = tipo === 'PERMISSAO';
    logar({ categoria: permissao ? 'SEGURANCA' : 'VALIDACAO', acao: permissao ? 'ACAO_NEGADA' : 'VALIDACAO_RECUSADA', resultado: permissao ? 'NEGADO' : 'INVALIDO', detalhe: { motivo: mensagem } });
  }
}

const PERFIS_OPERACAO = ['GESTOR', 'SUPERVISOR', 'EQUIPE'];
function exigirPerfil(perfis, acao) {
  if (!estado.usuario || !perfis.includes(estado.usuario.perfil)) throw new ErroRegra(`Seu perfil não pode ${acao}.`, 'PERMISSAO');
}

/** Conclui inspeções (programadas ou avulsa) com os defeitos encontrados. */
export function concluirInspecao({ ativoIds, inspecaoIds = [], avulsa, checklist, fotos, geo, justificativa, observacao, defeitos = [] }) {
  exigirPerfil(PERFIS_OPERACAO, 'registrar inspeção');
  const d = estado.dados, u = estado.usuario, eq = equipeDoUsuario(), em = agora();
  if (!fotos?.length) throw new ErroRegra('Foto obrigatória na inspeção.');
  if (!geo.dentroDoRaio && !justificativa?.trim()) throw new ErroRegra('Posição fora do raio de validação: informe a justificativa.');
  if (avulsa && !justificativa?.trim()) throw new ErroRegra('Inspeção avulsa exige justificativa.');
  if (defeitos.some((f) => !f.fotos?.length)) throw new ErroRegra('Cada defeito precisa de ao menos uma foto.');
  if (Object.values(checklist || {}).includes('NC') && !defeitos.length) throw new ErroRegra('Há item não conforme no checklist: registre o defeito correspondente.');
  const resultado = defeitos.length ? 'COM_DEFEITO' : 'SEM_ANOMALIA';
  const base = { status: 'CONCLUIDA', concluidaEm: em, concluidaPor: u.id, resultado, checklist, fotos, geo, justificativa, observacao };
  const criadas = [];

  if (avulsa) {
    for (const ativoId of ativoIds) {
      const i = { id: uid('insp'), ativoId, criterioId: null, tipo: 'AVULSA', prazo: hojeISO(), equipeId: eq?.id || null, criadaEm: em, ...base };
      d.inspecoes.push(i);
      criadas.push(i);
    }
  } else {
    for (const id of inspecaoIds) {
      const i = d.inspecoes.find((x) => x.id === id);
      if (!i || i.status === 'CONCLUIDA') continue;
      Object.assign(i, base, { equipeId: eq?.id || i.equipeId });
      const a = ativoPorId(i.ativoId);
      if (a && i.criterioId) a.ultimaInspecao[i.criterioId] = hojeISO();
      criadas.push(i);
    }
  }
  if (!criadas.length) throw new ErroRegra('Nenhuma inspeção pendente para concluir.');

  for (const f of defeitos) {
    const td = tipoDefeito(f.tipoId);
    const alvo = criadas.find((i) => i.ativoId === f.ativoId) || criadas[0];
    const a = ativoPorId(alvo.ativoId);
    const def = {
      id: uid('def'), ativoId: a.id, inspecaoId: alvo.id, tipoId: td.id, severidade: f.severidade, descricao: f.descricao,
      lat: a.lat, lon: a.lon, criadoEm: em, criadoPor: u.id, identificadoPorEquipe: eq?.id || null, fotos: f.fotos,
      ...(f.quantidade ? { quantidade: f.quantidade } : {}),
      equipeId: null, status: 'IDENTIFICADO', historico: [{ status: 'IDENTIFICADO', em, por: u.id }],
    };
    if (f.resolvido) {
      def.status = 'EXECUTADO';
      def.equipeId = eq?.id || null;
      def.execucao = { equipeId: eq?.id || null, atividade: f.atividade || td.atividade, em, por: u.id, fotos: f.fotos, naHora: true };
      def.execucao.custo = custoDefeito(def, { data: em.slice(0, 10) });
      def.historico.push({ status: 'EXECUTADO', em, por: u.id, obs: 'Resolvido na própria inspeção' });
    }
    d.defeitos.push(def);
    registrar('DEFEITO_REGISTRADO', 'defeito', def.id, { tipo: td.id, severidade: def.severidade, naHora: !!f.resolvido });
  }
  gerarInspecoesDevidas(d);
  criadas.forEach((i) => registrar(avulsa ? 'INSPECAO_AVULSA' : 'INSPECAO_CONCLUIDA', 'inspecao', i.id, { ativo: i.ativoId, resultado, foraDoRaio: !geo.dentroDoRaio }));
  return criadas;
}

export function transicionar(defeito, para, extra = {}) {
  const u = estado.usuario, em = agora();
  if (!podeTransicionar(u, defeito, para)) throw new ErroRegra('Seu perfil não pode executar esta ação.', 'PERMISSAO');
  if (para === 'PROGRAMADO') {
    if (!equipesAptas(estado.dados, defeito).some((e) => e.id === extra.equipeId)) throw new ErroRegra('Equipe não é apta para este tipo de defeito.');
    const data = extra.data || defeito.programacao?.data || proximoDiaUtil();
    exigirMotivoSeCongelado(defeito, extra.equipeId, data, extra.motivo);
    defeito.equipeId = extra.equipeId;
    defeito.programacao = { equipeId: extra.equipeId, data, semana: semanaISO(data), em, por: u.id };
  }
  if (['REJEITADO', 'CANCELADO'].includes(para) && !extra.justificativa?.trim()) throw new ErroRegra('Informe a justificativa.');
  if (para === 'PROGRAMADO' && defeito.status === 'EXECUTADO' && !extra.justificativa?.trim()) throw new ErroRegra('Informe o motivo da devolução.');
  if (para === 'EXECUTADO') {
    if (!extra.fotos?.length) throw new ErroRegra('Foto do serviço executado é obrigatória.');
    const q = Number(extra.quantidade) || undefined;
    if (q) defeito.quantidadeExecutada = q;
    defeito.execucao = { equipeId: u.equipeId, atividade: extra.atividade, materiais: extra.materiais, em, por: u.id, fotos: extra.fotos, geo: extra.geo,
      custo: custoDefeito(defeito, { data: em.slice(0, 10), quantidade: q }),
      conformeProgramacao: !!defeito.programacao && em.slice(0, 10) <= defeito.programacao.data && u.equipeId === defeito.programacao.equipeId };
  }
  if (para === 'VERIFICADO') defeito.verificadoEm = em;
  if (extra.severidade && para === 'VALIDADO') defeito.severidade = extra.severidade;
  const de = defeito.status;
  defeito.status = para;
  defeito.historico.push({ status: para, em, por: u.id, obs: extra.justificativa || (extra.equipeId ? `Equipe ${extra.equipeId}` : undefined) });
  registrar(`DEFEITO_${para}`, 'defeito', defeito.id, { de, para, ...(extra.equipeId ? { equipe: extra.equipeId } : {}) });
}

// ---------- Programação ----------
export const congelamento = (semana) => estado.dados.congelamentos?.[semana] || null;

/** Mudar data/equipe de item de semana congelada exige motivo (base do Pareto de reprogramação). */
function exigirMotivoSeCongelado(defeito, equipeId, data, motivo) {
  const p = defeito.programacao;
  if (!p || defeito.status !== 'PROGRAMADO') return;
  const cong = congelamento(p.semana);
  const noCongelado = cong?.itens.some((i) => i.defeitoId === defeito.id);
  const mudou = p.data !== data || p.equipeId !== equipeId;
  if (noCongelado && mudou && !motivo) throw new ErroRegra('Programação congelada: informe o motivo da reprogramação.');
  if (mudou) {
    (defeito.reprogramacoes ||= []).push({ em: agora(), por: estado.usuario.id, de: { data: p.data, equipeId: p.equipeId }, para: { data, equipeId }, motivo: motivo || null, congelada: !!noCongelado });
  }
}

export function programarDefeito(defeito, { equipeId, data, motivo }) {
  exigirPerfil(['GESTOR', 'SUPERVISOR'], 'programar defeitos');
  if (!data) throw new ErroRegra('Escolha o dia da programação.');
  if (defeito.status === 'PROGRAMADO') {
    if (!equipesAptas(estado.dados, defeito).some((e) => e.id === equipeId)) throw new ErroRegra('Equipe não é apta para este tipo de defeito.');
    exigirMotivoSeCongelado(defeito, equipeId, data, motivo);
    defeito.equipeId = equipeId;
    defeito.programacao = { ...defeito.programacao, equipeId, data, semana: semanaISO(data), em: agora(), por: estado.usuario.id };
    registrar('DEFEITO_REPROGRAMADO', 'defeito', defeito.id, { data, equipe: equipeId, motivo: motivo || null });
    return;
  }
  transicionar(defeito, 'PROGRAMADO', { equipeId, data, motivo });
}

/** Fecha a versão da semana: a aderência é medida contra esta foto. */
export function congelarSemana(semana) {
  exigirPerfil(['GESTOR', 'SUPERVISOR'], 'congelar a programação');
  const d = estado.dados;
  d.congelamentos ||= {};
  if (d.congelamentos[semana]) throw new ErroRegra('Esta semana já está congelada.');
  const itens = d.defeitos.filter((f) => f.status === 'PROGRAMADO' && f.programacao?.semana === semana)
    .map((f) => ({ defeitoId: f.id, data: f.programacao.data, equipeId: f.programacao.equipeId, custo: custoDefeito(f).total }));
  if (!itens.length) throw new ErroRegra('Não há atividades programadas nesta semana.');
  d.congelamentos[semana] = { semana, em: agora(), por: estado.usuario.id, itens };
  registrar('PROGRAMACAO_CONGELADA', 'programacao', semana, { itens: itens.length, custo: itens.reduce((s, i) => s + i.custo, 0) });
}

export function atribuirInspecao(inspecaoId, equipeId) {
  if (!['GESTOR', 'SUPERVISOR'].includes(estado.usuario.perfil)) throw new ErroRegra('Sem permissão.', 'PERMISSAO');
  const i = estado.dados.inspecoes.find((x) => x.id === inspecaoId);
  i.equipeId = equipeId || null;
  i.status = equipeId ? 'ATRIBUIDA' : 'PENDENTE';
  registrar('INSPECAO_ATRIBUIDA', 'inspecao', i.id, { equipe: equipeId });
}

/** Distribui inspeções sem equipe entre as equipes de inspeção disponíveis, mantendo cada alimentador numa equipe. */
export function distribuirAutomatico() {
  if (!['GESTOR', 'SUPERVISOR'].includes(estado.usuario.perfil)) throw new ErroRegra('Sem permissão.', 'PERMISSAO');
  const d = estado.dados;
  const eqs = d.equipes.filter((e) => e.tipo === 'INSPECAO' && e.disponivel);
  if (!eqs.length) throw new ErroRegra('Nenhuma equipe de inspeção disponível.');
  const porAlim = {};
  let n = 0, k = 0;
  for (const i of d.inspecoes.filter((x) => x.status === 'PENDENTE')) {
    const alim = ativoPorId(i.ativoId)?.alimentador || '-';
    porAlim[alim] ||= eqs[k++ % eqs.length].id;
    i.equipeId = porAlim[alim];
    i.status = 'ATRIBUIDA';
    n++;
  }
  if (n) registrar('DISTRIBUICAO_AUTOMATICA', 'plano', null, { inspecoes: n });
  return n;
}

export function criarAtivoAvulso({ lat, lon }) {
  exigirPerfil(PERFIS_OPERACAO, 'criar ponto avulso');
  const d = estado.dados;
  const proximo = d.ativos.reduce((m, a) => {
    const dist = distanciaM(lat, lon, a.lat, a.lon);
    return dist < m.dist ? { a, dist } : m;
  }, { a: null, dist: Infinity }).a;
  const a = {
    id: uid('AV'), codigo: `AV-${String(d.ativos.filter((x) => x.avulso).length + 1).padStart(3, '0')}`, tipo: 'POSTE', avulso: true,
    alimentador: proximo?.alimentador || '—', conjunto: proximo?.conjunto || '—', lat, lon, ucs: 0, comp12m: 0, falhas12m: 0,
    criterios: [], ultimaInspecao: {},
  };
  d.ativos.push(a);
  registrar('ATIVO_AVULSO_CRIADO', 'ativo', a.id, { lat, lon });
  return a;
}
