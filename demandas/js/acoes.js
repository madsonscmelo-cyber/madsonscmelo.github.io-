// Comandos que alteram estado. Cada um checa permissão, valida a entrada, grava o histórico da demanda e registra no log.
// No produto, a mesma máquina de regras roda no servidor; aqui ela também protege contra chamadas feitas pelo console.
import { uid, hojeISO } from './util.js';
import { estado, registrar, demandaPorId, usuarioPorId, nomeUsuario } from './store.js';
import { logar } from './auditoria.js';
import {
  AREAS, TIPOS, CANAIS, MOTIVOS_RADAR, CAMPOS_PENDENCIA, LIMITES, grupos, ehGrupo, supervisores,
  diasUteis, radarAutomatico, dataRitual, ativa,
} from './dominio.js';

export class ErroRegra extends Error {
  constructor(mensagem, { acao = 'REGRA_VIOLADA', resultado = 'INVALIDO', detalhe = {} } = {}) {
    super(mensagem);
    logar({ categoria: resultado === 'NEGADO' ? 'SEGURANCA' : 'VALIDACAO', acao, resultado, detalhe: { ...detalhe, mensagem } });
  }
}

const eu = () => {
  if (!estado.usuario) throw new ErroRegra('Sessão encerrada. Entre novamente.', { acao: 'SEM_SESSAO', resultado: 'NEGADO' });
  return estado.usuario;
};
const negar = (acao, detalhe) => { throw new ErroRegra('Você não tem permissão para esta ação.', { acao, resultado: 'NEGADO', detalhe }); };
const texto = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const dataValida = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(`${iso}T12:00:00`));

export const podeCriar = (u = estado.usuario) => ['GESTOR', 'SUPERVISOR', 'DEMANDANTE'].includes(u?.perfil);
/** Quem trabalha o ticket: o supervisor destinatário. A gerência também pode agir (cobertura de férias, por exemplo). */
export const podeTrabalhar = (dem, u = estado.usuario) => !!u && !dem.ehMae && (dem.destinatario === u.id || u.perfil === 'GESTOR');
/** Quem completa a pendência: quem pediu, quem recebeu ou a gerência. */
export const podeCompletar = (dem, u = estado.usuario) => !!u && (dem.criadoPor === u.id || dem.destinatario === u.id || u.perfil === 'GESTOR');
export const podeCancelar = (dem, u = estado.usuario) => !!u && (dem.criadoPor === u.id || u.perfil === 'GESTOR');

function historico(dem, acao, detalhe = '') {
  (dem.historico ||= []).push({ em: new Date().toISOString(), por: estado.usuario.id, acao, detalhe: String(detalhe).slice(0, 200) });
}

function exigirDemanda(id, acao) {
  const dem = demandaPorId(id);
  if (!dem) throw new ErroRegra('Demanda não encontrada.', { acao, detalhe: { id } });
  return dem;
}

/**
 * Cria a demanda a partir do formulário estruturado. Para grupo: uma demanda-mãe (visão de quem pediu)
 * e um ticket por supervisor do grupo. Devolve a lista de ids criados.
 */
export function criarDemanda(f) {
  const u = eu();
  if (!podeCriar(u)) negar('CRIAR_DEMANDA_NEGADO');
  const d = estado.dados, hoje = hojeISO();
  const invalido = (m, campo) => { throw new ErroRegra(m, { acao: 'DEMANDA_RECUSADA', detalhe: { campo } }); };
  const pendencias = [...new Set((f.pendencias || []).filter((p) => CAMPOS_PENDENCIA[p]))];

  const titulo = texto(f.titulo, LIMITES.tituloMax);
  if (titulo.length < LIMITES.tituloMin) invalido(`Descreva o que precisa ser feito (mínimo ${LIMITES.tituloMin} letras).`, 'titulo');
  const gs = grupos(d);
  const destinatario = String(f.destinatario || '');
  if (ehGrupo(destinatario) ? !gs[destinatario]?.membros.length : !supervisores(d).some((s) => s.id === destinatario)) invalido('Escolha para quem é a demanda.', 'destinatario');
  if (u.perfil === 'SUPERVISOR' && destinatario !== u.id) {
    throw new ErroRegra('Supervisor registra demandas recebidas por ele. Para enviar a outros supervisores, peça à gerência.', { acao: 'DESTINO_NEGADO', resultado: 'NEGADO', detalhe: { destinatario } });
  }
  const prazo = String(f.prazo || '');
  if (prazo && !dataValida(prazo)) invalido('Prazo inválido.', 'prazo');
  if (prazo && prazo < hoje) invalido('O prazo não pode estar no passado.', 'prazo');
  if (!prazo && !pendencias.includes('prazo')) invalido('Informe o prazo ou deixe pendente com quem pediu.', 'prazo');
  const urgencia = f.urgencia === 'URGENTE' ? 'URGENTE' : 'NORMAL';
  const justificativa = texto(f.justificativa, 300);
  if (urgencia === 'URGENTE' && justificativa.length < LIMITES.justificativaMin) invalido('Pedido urgente precisa de justificativa.', 'justificativa');
  const canal = CANAIS[f.canal] && f.canal !== 'RITUAL' ? f.canal : 'TEXTO';
  const auto = radarAutomatico({ canal, abertura: hoje, prazo });
  const manual = f.radarManual === 'FORA' || f.radarManual === 'PLANEJADA' ? f.radarManual : '';
  const radar = manual || auto.radar;
  const motivoRadar = radar === 'FORA' && manual ? String(f.motivoRadar || '') : '';
  if (manual === 'FORA' && !MOTIVOS_RADAR[motivoRadar]) invalido('Escolha o motivo de a demanda não estar no seu radar.', 'motivoRadar');

  const area = u.perfil === 'DEMANDANTE' ? u.area : AREAS.includes(f.areaSolicitante) ? f.areaSolicitante : '';
  const solicitante = u.perfil === 'DEMANDANTE' ? u.nome : texto(f.solicitante, 80);
  if (!solicitante && !pendencias.includes('solicitante')) invalido('Informe quem pediu ou deixe pendente.', 'solicitante');
  const anexo = typeof f.anexo === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(f.anexo) && f.anexo.length < 700000 ? f.anexo : '';

  const agora = new Date().toISOString();
  const base = {
    titulo, descricao: texto(f.descricao, LIMITES.textoMax), solicitante, areaSolicitante: area,
    prazo, abertura: hoje, urgencia, justificativa: urgencia === 'URGENTE' ? justificativa : '', entregavel: texto(f.entregavel, 80),
    tipo: TIPOS.includes(f.tipo) ? f.tipo : 'Gerencial', canal, radar, radarAuto: !manual, motivoRadar,
    motivoRadarTexto: radar === 'FORA' && !manual ? auto.motivo : '', pendencias, nasceuIncompleta: pendencias.length > 0,
    status: 'ABERTA', concluidaEm: '', comentarioConclusao: '', delegadoPara: '', criadoPor: u.id, criadoEm: agora,
    antecedencia: diasUteis(hoje, prazo), anexo,
  };
  const criados = [];
  if (ehGrupo(destinatario)) {
    const mae = { ...base, id: uid('dem'), destinatario, grupo: destinatario, ehMae: true, maeId: null, anexo,
      historico: [{ em: agora, por: u.id, acao: 'Criou para grupo', detalhe: `${gs[destinatario].nome} (${gs[destinatario].membros.length})` }] };
    d.demandas.push(mae);
    criados.push(mae.id);
    for (const sid of gs[destinatario].membros) {
      const filha = { ...base, id: uid('dem'), destinatario: sid, ehMae: false, maeId: mae.id, anexo: '', historico: [{ em: agora, por: u.id, acao: 'Criou', detalhe: 'pedido para grupo' }] };
      d.demandas.push(filha);
      criados.push(filha.id);
    }
  } else {
    const dem = { ...base, id: uid('dem'), destinatario, ehMae: false, maeId: null, historico: [{ em: agora, por: u.id, acao: 'Criou', detalhe: `via ${CANAIS[canal].toLowerCase()}` }] };
    d.demandas.push(dem);
    criados.push(dem.id);
  }
  registrar('DEMANDA_CRIADA', 'demanda', criados[0], {
    destino: ehGrupo(destinatario) ? gs[destinatario].nome : nomeUsuario(destinatario), tickets: ehGrupo(destinatario) ? criados.length - 1 : 1,
    canal, radar, urgencia, pendencias,
  });
  return criados;
}

export function iniciar(id) {
  const dem = exigirDemanda(id, 'INICIAR');
  if (!podeTrabalhar(dem)) negar('INICIAR_NEGADO', { id });
  if (dem.status !== 'ABERTA') throw new ErroRegra('Só uma demanda aberta pode ser iniciada.', { acao: 'INICIAR', detalhe: { id, status: dem.status } });
  dem.status = 'ANDAMENTO';
  historico(dem, 'Iniciou');
  registrar('DEMANDA_INICIADA', 'demanda', id);
}

export function concluir(id, comentario = '') {
  const dem = exigirDemanda(id, 'CONCLUIR');
  if (!podeTrabalhar(dem)) negar('CONCLUIR_NEGADO', { id });
  if (!ativa(dem)) throw new ErroRegra('Esta demanda já está encerrada.', { acao: 'CONCLUIR', detalhe: { id, status: dem.status } });
  dem.status = 'CONCLUIDA';
  dem.concluidaEm = new Date().toISOString();
  dem.comentarioConclusao = texto(comentario, LIMITES.comentarioMax);
  historico(dem, 'Concluiu', dem.comentarioConclusao);
  registrar('DEMANDA_CONCLUIDA', 'demanda', id, { noPrazo: !dem.prazo || hojeISO() <= dem.prazo });
}

export function reabrir(id, motivo) {
  const dem = exigirDemanda(id, 'REABRIR');
  if (!podeTrabalhar(dem)) negar('REABRIR_NEGADO', { id });
  if (dem.status !== 'CONCLUIDA') throw new ErroRegra('Só uma demanda concluída pode ser reaberta.', { acao: 'REABRIR', detalhe: { id } });
  const m = texto(motivo, 300);
  if (m.length < 5) throw new ErroRegra('Informe o motivo da reabertura.', { acao: 'REABRIR', detalhe: { id } });
  dem.status = 'ABERTA';
  dem.concluidaEm = '';
  historico(dem, 'Reabriu', m);
  registrar('DEMANDA_REABERTA', 'demanda', id, { motivo: m });
}

export function delegar(id, pessoa) {
  const dem = exigirDemanda(id, 'DELEGAR');
  if (!podeTrabalhar(dem)) negar('DELEGAR_NEGADO', { id });
  if (!ativa(dem)) throw new ErroRegra('Esta demanda já está encerrada.', { acao: 'DELEGAR', detalhe: { id } });
  const equipe = usuarioPorId(dem.destinatario)?.equipe || [];
  if (pessoa && !equipe.includes(pessoa)) throw new ErroRegra('Escolha alguém da equipe do supervisor.', { acao: 'DELEGAR', detalhe: { id } });
  dem.delegadoPara = pessoa || '';
  historico(dem, pessoa ? 'Delegou' : 'Retirou delegação', pessoa);
  registrar(pessoa ? 'DEMANDA_DELEGADA' : 'DELEGACAO_RETIRADA', 'demanda', id, { para: pessoa });
}

export function ajustarRadar(id, radar, motivo) {
  const dem = exigirDemanda(id, 'RADAR');
  if (!podeTrabalhar(dem)) negar('RADAR_NEGADO', { id });
  if (radar === 'FORA' && !MOTIVOS_RADAR[motivo]) throw new ErroRegra('Escolha o motivo.', { acao: 'RADAR', detalhe: { id } });
  if (radar !== 'FORA' && radar !== 'PLANEJADA') throw new ErroRegra('Opção inválida.', { acao: 'RADAR', detalhe: { id } });
  dem.radar = radar;
  dem.radarAuto = false;
  dem.motivoRadar = radar === 'FORA' ? motivo : '';
  dem.motivoRadarTexto = '';
  historico(dem, radar === 'FORA' ? 'Marcou fora do radar' : 'Marcou como planejada', radar === 'FORA' ? MOTIVOS_RADAR[motivo] : '');
  registrar('RADAR_AJUSTADO', 'demanda', id, { radar, motivo });
}

/** Completa um dado que chegou faltando. Na demanda-mãe, o valor vale também para os tickets do grupo. */
export function completarPendencia(id, campo, valor) {
  const dem = exigirDemanda(id, 'PENDENCIA');
  if (!podeCompletar(dem)) negar('PENDENCIA_NEGADA', { id });
  if (!dem.pendencias?.includes(campo)) throw new ErroRegra('Este dado não está pendente.', { acao: 'PENDENCIA', detalhe: { id, campo } });
  let v = texto(valor, 120);
  if (campo === 'prazo') {
    if (!dataValida(v) || v < hojeISO()) throw new ErroRegra('Informe uma data válida, a partir de hoje.', { acao: 'PENDENCIA', detalhe: { id, campo } });
  } else if (v.length < 2) throw new ErroRegra('Informe o dado.', { acao: 'PENDENCIA', detalhe: { id, campo } });
  const alvos = dem.ehMae ? [dem, ...estado.dados.demandas.filter((x) => x.maeId === dem.id)] : [dem];
  for (const x of alvos) {
    x[campo] = v;
    x.pendencias = (x.pendencias || []).filter((p) => p !== campo);
    if (campo === 'prazo') x.antecedencia = diasUteis(x.abertura, v);
    historico(x, 'Completou pendência', `${CAMPOS_PENDENCIA[campo]}: ${v}`);
  }
  registrar('PENDENCIA_COMPLETADA', 'demanda', id, { campo, tickets: alvos.length });
}

export function cancelar(id, motivo) {
  const dem = exigirDemanda(id, 'CANCELAR');
  if (!podeCancelar(dem)) negar('CANCELAR_NEGADO', { id });
  if (!ativa(dem) && !dem.ehMae) throw new ErroRegra('Esta demanda já está encerrada.', { acao: 'CANCELAR', detalhe: { id } });
  const m = texto(motivo, 300);
  if (m.length < 5) throw new ErroRegra('Informe o motivo do cancelamento.', { acao: 'CANCELAR', detalhe: { id } });
  const alvos = dem.ehMae ? [dem, ...estado.dados.demandas.filter((x) => x.maeId === dem.id && ativa(x))] : [dem];
  for (const x of alvos) { x.status = 'CANCELADA'; historico(x, 'Cancelou', m); }
  registrar('DEMANDA_CANCELADA', 'demanda', id, { motivo: m, tickets: alvos.length });
}

// ---------- Rituais (só gerência cadastra e gera) ----------
const exigirGestor = (acao) => { if (eu().perfil !== 'GESTOR') negar(acao); };

export function criarRitual(r) {
  exigirGestor('RITUAL_NEGADO');
  const nome = texto(r.nome, 80);
  if (nome.length < 3) throw new ErroRegra('Dê um nome ao ritual.', { acao: 'RITUAL_RECUSADO' });
  const regra = ['DIA_UTIL', 'ULTIMO_UTIL', 'DIA_FIXO'].includes(r.regra) ? r.regra : null;
  const n = Number.parseInt(r.n, 10);
  if (!regra) throw new ErroRegra('Escolha quando o ritual acontece.', { acao: 'RITUAL_RECUSADO' });
  if (regra === 'DIA_UTIL' && !(n >= 1 && n <= 20)) throw new ErroRegra('O dia útil vai de 1 a 20.', { acao: 'RITUAL_RECUSADO' });
  if (regra === 'DIA_FIXO' && !(n >= 1 && n <= 31)) throw new ErroRegra('O dia do mês vai de 1 a 31.', { acao: 'RITUAL_RECUSADO' });
  const novo = { id: uid('rit'), nome, descricao: texto(r.descricao, 160), regra, n: regra === 'ULTIMO_UTIL' ? 1 : n, tipo: TIPOS.includes(r.tipo) ? r.tipo : 'Ritual' };
  estado.dados.rituais.push(novo);
  registrar('RITUAL_CRIADO', 'ritual', novo.id, { nome, regra, n: novo.n });
  return novo.id;
}

export function removerRitual(id) {
  exigirGestor('RITUAL_NEGADO');
  const i = estado.dados.rituais.findIndex((r) => r.id === id);
  if (i < 0) throw new ErroRegra('Ritual não encontrado.', { acao: 'RITUAL_REMOVER' });
  const [r] = estado.dados.rituais.splice(i, 1);
  registrar('RITUAL_REMOVIDO', 'ritual', id, { nome: r.nome });
}

/**
 * Gera um ticket por supervisor e ritual no mês. Id determinístico: gerar de novo não duplica.
 * Ritual cuja data já passou não é gerado: nasceria atrasado e distorceria a pontualidade. Devolve { criados, passados }.
 */
export function gerarRituais(ano, mes) {
  exigirGestor('RITUAL_NEGADO');
  const d = estado.dados, hoje = hojeISO(), agora = new Date().toISOString();
  const competencia = `${ano}${String(mes + 1).padStart(2, '0')}`;
  let n = 0, passados = 0;
  for (const r of d.rituais) {
    const prazo = dataRitual(r, ano, mes);
    if (prazo < hoje) { passados++; continue; }
    for (const s of supervisores(d)) {
      const id = `rit-${r.id}-${competencia}-${s.id}`;
      if (d.demandas.some((x) => x.id === id)) continue;
      d.demandas.push({
        id, titulo: r.nome, descricao: r.descricao || '', solicitante: 'Calendário de rituais', areaSolicitante: 'Gerência', destinatario: s.id,
        prazo, abertura: hoje, urgencia: 'NORMAL', justificativa: '', entregavel: r.descricao || '', tipo: r.tipo, canal: 'RITUAL',
        radar: 'PLANEJADA', radarAuto: true, motivoRadar: '', motivoRadarTexto: '', pendencias: [], nasceuIncompleta: false,
        status: 'ABERTA', concluidaEm: '', comentarioConclusao: '', delegadoPara: '', criadoPor: estado.usuario.id, criadoEm: agora,
        antecedencia: diasUteis(hoje, prazo), ehMae: false, maeId: null, ritualId: r.id,
        historico: [{ em: agora, por: estado.usuario.id, acao: 'Gerou pelo ritual', detalhe: `${r.nome} · ${competencia.slice(4)}/${ano}` }],
      });
      n++;
    }
  }
  registrar('RITUAIS_GERADOS', 'ritual', competencia, { tickets: n, rituaisJaVencidos: passados });
  return { criados: n, passados };
}
