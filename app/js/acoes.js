// Comandos que alteram o estado. Toda regra de permissão é checada aqui (no produto real: no servidor).
import { uid, hojeISO, distanciaM, semanaISO, proximoDiaUtil } from './util.js';
import { custoDefeito } from './custos.js';
import { estado, registrar, ativoPorId, equipeDoUsuario, persistir } from './store.js';
import { podeTransicionar, gerarInspecoesDevidas, tipoDefeito, equipesAptas, PARAM } from './dominio.js';
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
      const av = ativoPorId(ativoId);
      if (av?.provisorio) { delete av.provisorio; registrar('ATIVO_AVULSO_CRIADO', 'ativo', av.id, { lat: av.lat, lon: av.lon, tipo: av.tipo, codigo: av.codigo }); }
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
  // Versão do defeito: o servidor usa para detectar conflito (ex.: técnico reprogramou enquanto a equipe, offline, executou).
  // Regra (docs/regras-sincronizacao.md): execução e verificação de campo prevalecem; reprogramação conflitante vira pendência do técnico.
  const versaoBase = defeito.versao || 0;
  defeito.versao = versaoBase + 1;
  registrar(`DEFEITO_${para}`, 'defeito', defeito.id, { de, para, versaoBase, ...(extra.equipeId ? { equipe: extra.equipeId } : {}) });
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
    const versaoBase = defeito.versao || 0;
    defeito.versao = versaoBase + 1;
    registrar('DEFEITO_REPROGRAMADO', 'defeito', defeito.id, { data, equipe: equipeId, motivo: motivo || null, versaoBase });
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

/** Alimentador sugerido para um ponto: o do ativo mais próximo, só se estiver a até PARAM.raioAtribuicaoM. */
export function alimentadorProximo(lat, lon) {
  let m = { a: null, dist: Infinity };
  for (const a of estado.dados.ativos) { if (a.provisorio) continue; const dist = distanciaM(lat, lon, a.lat, a.lon); if (dist < m.dist) m = { a, dist }; }
  return m.a && m.dist <= PARAM.raioAtribuicaoM ? { alimentador: m.a.alimentador, conjunto: m.a.conjunto, dist: Math.round(m.dist) } : null;
}

/**
 * Ativo avulso nasce PROVISÓRIO: fica no aparelho só enquanto a inspeção estiver em rascunho e só entra no cadastro
 * (log de escrita + fila de sincronização) quando a inspeção é concluída. Descartar o rascunho apaga o provisório.
 * Código único por pessoa e instante (AV-matrícula-carimbo) para não colidir entre aparelhos.
 */
export function criarAtivoAvulso({ lat, lon, tipo = 'POSTE', alimentador }) {
  exigirPerfil(PERFIS_OPERACAO, 'criar ponto avulso');
  if (!['POSTE', 'TRAFO', 'CHAVE_FUSIVEL'].includes(tipo)) throw new ErroRegra('Escolha o tipo do ativo.');
  const prox = alimentadorProximo(lat, lon);
  const alim = alimentador || prox?.alimentador;
  if (!alim) throw new ErroRegra('Escolha o alimentador: não há ativo cadastrado perto deste ponto.');
  const conj = estado.dados.ativos.find((x) => x.alimentador === alim && !x.provisorio)?.conjunto || '—';
  const d = estado.dados, mat = String(estado.usuario.matricula || 'X').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8);
  const a = {
    id: uid('AV'), codigo: `AV-${mat}-${Date.now().toString(36).toUpperCase().slice(-6)}`, tipo, avulso: true, provisorio: true,
    alimentador: alim, conjunto: conj, lat, lon, ucs: 0, comp12m: 0, falhas12m: 0, criterios: [], ultimaInspecao: {},
  };
  d.ativos.push(a);
  logar({ categoria: 'ESCRITA', acao: 'ATIVO_AVULSO_PROVISORIO', entidade: 'ativo', entidadeId: a.id, detalhe: { lat, lon, tipo, alimentador: alim } });
  persistir();
  return a;
}

/** Descarta o avulso provisório (rascunho abandonado). Ativo já confirmado não se apaga por aqui. */
export function descartarAvulso(ativoId, motivo = 'rascunho descartado') {
  const d = estado.dados, i = d.ativos.findIndex((x) => x.id === ativoId && x.provisorio);
  if (i < 0) return false;
  d.ativos.splice(i, 1);
  logar({ categoria: 'ESCRITA', acao: 'ATIVO_AVULSO_DESCARTADO', entidade: 'ativo', entidadeId: ativoId, detalhe: { motivo } });
  persistir();
  return true;
}

/** Ao iniciar: provisórios sem rascunho (aba fechada no meio, aparelho reiniciado) são removidos. */
export function limparAvulsosOrfaos() {
  const usados = new Set(Object.values(estado.dados.rascunhos || {}).flatMap((r) => r.ativoIds || []));
  const orfaos = estado.dados.ativos.filter((a) => a.provisorio && !usados.has(a.id)).map((a) => a.id);
  orfaos.forEach((id) => descartarAvulso(id, 'sem rascunho ao iniciar'));
  return orfaos.length;
}
