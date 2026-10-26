// Comandos que alteram o estado. Toda regra de permissão é checada aqui (no produto real: no servidor).
import { uid, hojeISO, somarDias, csvParse } from './util.js';
import { estado, registrar, usuarioPorId, removerRascunho, persistir } from './store.js';
import {
  CARGOS, UTDS, PERIODICIDADES, SITUACOES, MOTIVOS_REMANEJAMENTO, LIMITES, regraMesValida,
  ocorrenciaPorChave, precisaAprovacao, ehDiaUtil, versaoAtual, regras,
} from './dominio.js';
import { logar } from './auditoria.js';

const agora = () => new Date().toISOString();
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Toda recusa também vai para o log: permissão negada (segurança) ou dado inválido (validação). */
export class ErroRegra extends Error {
  constructor(mensagem, tipo = 'VALIDACAO') {
    super(mensagem);
    this.tipo = tipo;
    const permissao = tipo === 'PERMISSAO';
    logar({ categoria: permissao ? 'SEGURANCA' : 'VALIDACAO', acao: permissao ? 'ACAO_NEGADA' : 'VALIDACAO_RECUSADA', resultado: permissao ? 'NEGADO' : 'INVALIDO', detalhe: { motivo: mensagem } });
  }
}

function exigirPerfil(perfis, acao) {
  if (!estado.usuario || !perfis.includes(estado.usuario.perfil)) throw new ErroRegra(`Seu perfil não pode ${acao}.`, 'PERMISSAO');
}

/** Segregação por UTD (checklist 3.3): supervisor só age na própria UTD; gerência em todas. */
export function podeGerirUtd(utd) {
  const u = estado.usuario;
  return u?.perfil === 'GESTOR' || (u?.perfil === 'SUPERVISOR' && u.utd === utd);
}

function ocorrencia(chave) {
  const o = ocorrenciaPorChave(estado.dados, chave);
  if (!o) throw new ErroRegra('Atividade não encontrada na agenda.');
  return o;
}

const texto = (v, max = LIMITES.textoMax) => String(v ?? '').trim().slice(0, max + 1);

// ---------- Execução da rotina ----------
/** Conclui uma ocorrência. Só quem é o responsável (R) conclui, e só com a evidência do produto. */
export function concluir(chave, evidencia) {
  exigirPerfil(['COLABORADOR'], 'concluir atividade da rotina');
  const o = ocorrencia(chave), u = estado.usuario;
  if (o.usuarioId !== u.id) throw new ErroRegra('Só o responsável pela atividade pode concluí-la.', 'PERMISSAO');
  if (o.status === 'CONCLUIDA') throw new ErroRegra('Esta atividade já foi concluída.');
  if (o.data > hojeISO()) throw new ErroRegra('Não é possível concluir uma atividade programada para depois de hoje. Remaneje para hoje, se ela foi antecipada.');
  const ev = texto(evidencia, LIMITES.evidenciaMax);
  if (ev.length < LIMITES.evidenciaMin) throw new ErroRegra(`Informe a evidência do produto (mínimo ${LIMITES.evidenciaMin} caracteres): o que foi entregue e onde está.`);
  if (ev.length > LIMITES.evidenciaMax) throw new ErroRegra(`Evidência com mais de ${LIMITES.evidenciaMax} caracteres.`);
  const ex = (estado.dados.execucoes[chave] ||= { remanejamentos: [] });
  const pedidoCancelado = !!ex.pedido;
  delete ex.pedido;
  Object.assign(ex, { concluidaEm: agora(), concluidaPor: u.id, evidencia: ev });
  removerRascunho(`ev:${chave}`);
  registrar('OCORRENCIA_CONCLUIDA', 'ocorrencia', chave, { atividade: o.codigo, data: o.data, dataPrevista: o.dataPrevista, noPrazo: o.data <= o.dataPrevista && !o.remanejada, pedidoCancelado });
  return ocorrenciaPorChave(estado.dados, chave);
}

/** Remaneja uma ocorrência. Dentro da janela da periodicidade e no 1º remanejamento: aplica. Senão: vira pedido ao supervisor. */
export function remanejar(chave, { para, motivo, texto: obs }) {
  exigirPerfil(['COLABORADOR', 'SUPERVISOR', 'GESTOR'], 'remanejar atividade');
  const d = estado.dados, o = ocorrencia(chave), u = estado.usuario;
  if (u.perfil === 'COLABORADOR' ? o.usuarioId !== u.id : !podeGerirUtd(o.utd)) throw new ErroRegra('Você não pode remanejar atividade de outra pessoa ou de outra UTD.', 'PERMISSAO');
  if (o.status === 'CONCLUIDA') throw new ErroRegra('Atividade concluída não é remanejada.');
  if (o.status === 'AGUARDA') throw new ErroRegra('Já existe um pedido de remanejamento aguardando o supervisor.');
  if (!ISO.test(para || '')) throw new ErroRegra('Informe a nova data.');
  if (para < hojeISO()) throw new ErroRegra('A nova data não pode estar no passado.');
  if (para === o.data) throw new ErroRegra('A nova data é igual à atual.');
  if (!ehDiaUtil(d, para)) throw new ErroRegra('A nova data precisa ser dia útil (sem fim de semana nem feriado).');
  if (!MOTIVOS_REMANEJAMENTO[motivo]) throw new ErroRegra('Escolha o motivo do remanejamento.');
  const t = texto(obs);
  if (motivo === 'OUTRO' && t.length < 10) throw new ErroRegra('Descreva o motivo (mínimo 10 caracteres).');
  if (t.length > LIMITES.textoMax) throw new ErroRegra(`Texto com mais de ${LIMITES.textoMax} caracteres.`);
  const motivosAprovacao = precisaAprovacao(d, o, para);
  const ex = (d.execucoes[chave] ||= { remanejamentos: [] });
  ex.remanejamentos ||= [];
  if (motivosAprovacao.length) {
    ex.pedido = { para, motivo, texto: t, por: u.id, em: agora(), motivosAprovacao };
    registrar('REMANEJAMENTO_SOLICITADO', 'ocorrencia', chave, { atividade: o.codigo, de: o.data, para, motivo, exigeAprovacao: motivosAprovacao });
    return { aplicado: false, motivosAprovacao };
  }
  ex.remanejamentos.push({ de: o.data, para, motivo, texto: t, por: u.id, em: agora(), situacao: 'APLICADO' });
  ex.dataAtual = para;
  registrar('REMANEJAMENTO_APLICADO', 'ocorrencia', chave, { atividade: o.codigo, de: o.data, para, motivo });
  return { aplicado: true, motivosAprovacao: [] };
}

/** Aprova ou recusa um pedido. Supervisor da UTD (ou gerência); nunca o próprio pedido; recusa exige justificativa. */
export function decidirPedido(chave, aprovar, justificativa = '') {
  exigirPerfil(['SUPERVISOR', 'GESTOR'], 'decidir remanejamento');
  const d = estado.dados, o = ocorrencia(chave), u = estado.usuario;
  const ex = d.execucoes[chave];
  if (!ex?.pedido) throw new ErroRegra('Não há pedido pendente para esta atividade.');
  if (!podeGerirUtd(o.utd)) throw new ErroRegra('Pedido de outra UTD.', 'PERMISSAO');
  if (ex.pedido.por === u.id) throw new ErroRegra('Ninguém aprova o próprio pedido: ele vai para a gerência.', 'PERMISSAO');
  const j = texto(justificativa);
  if (!aprovar && j.length < 10) throw new ErroRegra('Informe a justificativa da recusa (mínimo 10 caracteres).');
  const p = ex.pedido;
  delete ex.pedido;
  const reg = { de: o.data, para: p.para, motivo: p.motivo, texto: p.texto, por: p.por, em: p.em, decisao: { por: u.id, em: agora(), justificativa: j } };
  if (aprovar) {
    if (p.para < hojeISO()) { ex.pedido = p; throw new ErroRegra('A data pedida já passou: recuse e peça uma nova data.'); }
    ex.remanejamentos = [...(ex.remanejamentos || []), { ...reg, situacao: 'APLICADO' }];
    ex.dataAtual = p.para;
  } else ex.remanejamentos = [...(ex.remanejamentos || []), { ...reg, situacao: 'RECUSADO' }];
  registrar(aprovar ? 'REMANEJAMENTO_APROVADO' : 'REMANEJAMENTO_RECUSADO', 'ocorrencia', chave, { atividade: o.codigo, para: p.para, solicitante: p.por, justificativa: j });
}

/** Registro de atividade sob demanda: mede o esforço, não entra na aderência. */
export function registrarDemanda({ atvId, data, duracaoMin, descricao }) {
  exigirPerfil(['COLABORADOR', 'SUPERVISOR'], 'registrar atividade sob demanda');
  const d = estado.dados, u = estado.usuario;
  const atv = d.atividades.find((a) => a.id === atvId);
  const v = atv && versaoAtual(atv);
  if (!v || v.situacao !== 'S') throw new ErroRegra('Escolha uma atividade sob demanda do catálogo.');
  if (u.perfil === 'COLABORADOR' && v.cargo !== u.cargo) throw new ErroRegra('Atividade de outro cargo.', 'PERMISSAO');
  if (!ISO.test(data || '') || data > hojeISO() || data < somarDias(hojeISO(), -31)) throw new ErroRegra('Data inválida: use um dia dos últimos 31 dias.');
  const min = Number(duracaoMin);
  if (!Number.isInteger(min) || min < 1 || min > LIMITES.duracaoMax) throw new ErroRegra(`Duração em minutos inteiros, de 1 a ${LIMITES.duracaoMax}.`);
  const desc = texto(descricao);
  if (desc.length < 10 || desc.length > LIMITES.textoMax) throw new ErroRegra('Descreva o que foi feito (10 a 300 caracteres).');
  const reg = { id: uid('dm'), atvId, usuarioId: u.id, utd: u.utd, data, duracaoMin: min, descricao: desc, em: agora() };
  d.demandas.push(reg);
  registrar('DEMANDA_REGISTRADA', 'demanda', reg.id, { atividade: atv.codigo, data, duracaoMin: min });
  return reg;
}

// ---------- Catálogo (gerência e administrador) ----------
const CAMPOS = ['nome', 'governanca', 'indicador', 'cargo', 'coResponsaveis', 'aprovador', 'periodicidade', 'situacao', 'duracaoMin', 'horario', 'diaSemana', 'regraMes', 'evidencia', 'destino'];

/** Valida e normaliza os campos de uma atividade. Lança ErroRegra com a primeira falha. */
export function validarAtividade(c, { registrarLog = true } = {}) {
  const falha = (m) => { if (registrarLog) throw new ErroRegra(m); const e = new Error(m); e.validacao = true; throw e; };
  const nome = texto(c.nome, LIMITES.nomeMax);
  if (nome.length < 3 || nome.length > LIMITES.nomeMax) falha(`Nome da atividade com 3 a ${LIMITES.nomeMax} caracteres.`);
  if (!CARGOS[c.cargo]) falha('Cargo responsável (R) inválido: use TCO, TMN, ESP, ACO ou AGE.');
  const co = [...new Set((Array.isArray(c.coResponsaveis) ? c.coResponsaveis : String(c.coResponsaveis || '').split(/[,/ ]+/)).map((x) => String(x).trim().toUpperCase()).filter(Boolean))];
  if (co.some((x) => !CARGOS[x])) falha('Corresponsável com cargo inválido.');
  if (co.includes(c.cargo)) falha('O cargo responsável não pode ser também corresponsável.');
  if (!PERIODICIDADES[c.periodicidade]) falha('Periodicidade inválida: use D, W, Q, M ou S.');
  if (!SITUACOES[c.situacao]) falha('Situação inválida: use R (rotina), S (sob demanda) ou T (transferir).');
  if (c.situacao === 'S' && c.periodicidade !== 'S') falha('Situação sob demanda (S) exige periodicidade S.');
  if (c.situacao === 'R' && c.periodicidade === 'S') falha('Rotina precisa de periodicidade D, W, Q ou M (S é sob demanda).');
  const dur = Number(c.duracaoMin);
  if (!Number.isInteger(dur) || dur < 0 || dur > LIMITES.duracaoMax) falha(`Duração em minutos inteiros, de 0 a ${LIMITES.duracaoMax} (0 = acompanhamento contínuo).`);
  const horario = String(c.horario || '').trim().toUpperCase();
  if (horario && horario !== 'CONT' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(horario)) falha('Horário no formato HH:MM, CONT (contínuo) ou vazio.');
  const dia = c.diaSemana === '' || c.diaSemana === undefined || c.diaSemana === null ? '' : Number(c.diaSemana);
  if (['W', 'Q'].includes(c.periodicidade) && !(dia >= 1 && dia <= 5)) falha('Semanal e quinzenal exigem o dia da semana (1 = segunda … 5 = sexta).');
  const regraMes = String(c.regraMes || '').trim().toUpperCase();
  if (c.periodicidade === 'M' && !regraMesValida(regraMes)) falha('Mensal exige a regra do mês: P1 a P20 (n-ésimo dia útil), U (último dia útil) ou D1 a D31 (dia fixo, antecipa se não for útil).');
  if (!['', 'SUPERVISOR'].includes(c.aprovador || '')) falha('Aprovador (A) inválido: use SUPERVISOR ou deixe vazio.');
  const destino = texto(c.destino, 120);
  if (c.situacao === 'T' && destino.length < 3) falha('Transferência exige a área destino.');
  const evidencia = texto(c.evidencia, 200);
  if (c.situacao !== 'S' && evidencia.length < 5) falha('Informe o produto esperado (evidência) com pelo menos 5 caracteres.');
  return {
    nome, governanca: texto(c.governanca, 80), indicador: texto(c.indicador, 120), cargo: c.cargo, coResponsaveis: co,
    aprovador: c.aprovador || '', periodicidade: c.periodicidade, situacao: c.situacao, duracaoMin: dur, horario,
    diaSemana: ['W', 'Q'].includes(c.periodicidade) ? dia : '', regraMes: c.periodicidade === 'M' ? regraMes : '',
    evidencia, destino: c.situacao === 'T' ? destino : '',
  };
}

/** Nova versão da atividade com início de vigência (hoje ou futuro). O passado não é recalculado. */
export function editarAtividade(atvId, campos, { desde = hojeISO(), motivo } = {}) {
  exigirPerfil(['GESTOR', 'ADMIN'], 'alterar o catálogo');
  const atv = estado.dados.atividades.find((a) => a.id === atvId);
  if (!atv) throw new ErroRegra('Atividade não encontrada.');
  if (!ISO.test(desde) || desde < hojeISO()) throw new ErroRegra('A vigência começa hoje ou numa data futura (o passado não é recalculado).');
  const m = texto(motivo);
  if (m.length < 10) throw new ErroRegra('Informe o motivo da alteração (mínimo 10 caracteres).');
  const ant = versaoAtual(atv);
  const nova = { ...validarAtividade({ ...ant, ...campos }), desde, motivo: m, por: estado.usuario.id, em: agora(), validada: true };
  const mudou = CAMPOS.filter((k) => JSON.stringify(ant[k]) !== JSON.stringify(nova[k]));
  if (!mudou.length && ant.validada) throw new ErroRegra('Nada foi alterado.');
  if (ant.desde === desde) atv.versoes[atv.versoes.length - 1] = nova; else atv.versoes.push(nova);
  registrar('ATIVIDADE_ALTERADA', 'atividade', atv.codigo, { desde, motivo: m, campos: mudou.length ? mudou : ['validada'], antes: Object.fromEntries(mudou.map((k) => [k, ant[k]])), depois: Object.fromEntries(mudou.map((k) => [k, nova[k]])) });
  return atv;
}

/** Aceite da área destino: a atividade sai da agenda a partir da data efetiva. Até lá, continua na rotina. */
export function registrarAceite(atvId, { desde, obs }) {
  exigirPerfil(['GESTOR'], 'registrar aceite de transferência');
  const atv = estado.dados.atividades.find((a) => a.id === atvId);
  const v = atv && versaoAtual(atv);
  if (!v || v.situacao !== 'T') throw new ErroRegra('Só atividades marcadas para transferência recebem aceite.');
  if (atv.aceite) throw new ErroRegra('Esta transferência já tem aceite registrado.');
  if (!ISO.test(desde || '') || desde < hojeISO()) throw new ErroRegra('A data efetiva é hoje ou futura.');
  const o = texto(obs);
  if (o.length < 10) throw new ErroRegra('Registre como foi o aceite (quem aceitou e por qual meio), mínimo 10 caracteres.');
  atv.aceite = { desde, em: agora(), por: estado.usuario.id, destino: v.destino, obs: o };
  registrar('TRANSFERENCIA_ACEITA', 'atividade', atv.codigo, { destino: v.destino, desde });
}

/** Regras gerais (feriados e capacidade), com vigência e motivo. */
export function alterarRegras({ capacidadeDiariaMin, feriados }, motivo) {
  exigirPerfil(['GESTOR', 'ADMIN'], 'alterar as regras da agenda');
  const cap = Number(capacidadeDiariaMin);
  if (!Number.isInteger(cap) || cap < 240 || cap > 600) throw new ErroRegra('Capacidade diária entre 240 e 600 minutos.');
  const lista = (feriados || []).map((f) => ({ data: String(f.data || ''), nome: texto(f.nome, 60) }));
  if (lista.some((f) => !ISO.test(f.data) || f.nome.length < 3)) throw new ErroRegra('Feriado precisa de data e nome.');
  if (new Set(lista.map((f) => f.data)).size !== lista.length) throw new ErroRegra('Feriado repetido.');
  const m = texto(motivo);
  if (m.length < 10) throw new ErroRegra('Informe o motivo da alteração (mínimo 10 caracteres).');
  const ant = regras(estado.dados);
  estado.dados.regras.push({ desde: hojeISO(), motivo: m, por: estado.usuario.id, em: agora(), valores: { capacidadeDiariaMin: cap, feriados: lista.sort((a, b) => (a.data < b.data ? -1 : 1)) } });
  registrar('REGRAS_ALTERADAS', 'regras', null, { motivo: m, antes: { capacidade: ant.capacidadeDiariaMin, feriados: ant.feriados.length }, depois: { capacidade: cap, feriados: lista.length } });
}

/** Ocupação: quem ocupa cada cargo em cada UTD. É o que transforma a agenda do cargo em agenda individual. */
export function definirOcupacao(usuarioId, { utd, cargo }) {
  exigirPerfil(['GESTOR', 'ADMIN'], 'alterar a ocupação dos cargos');
  const alvo = usuarioPorId(usuarioId);
  if (!alvo || alvo.perfil !== 'COLABORADOR') throw new ErroRegra('Só pessoas da retaguarda têm cargo na rotina.');
  if (!UTDS[utd] || !CARGOS[cargo]) throw new ErroRegra('UTD ou cargo inválido.');
  const antes = { utd: alvo.utd, cargo: alvo.cargo };
  if (antes.utd === utd && antes.cargo === cargo) throw new ErroRegra('Nada foi alterado.');
  alvo.utd = utd;
  alvo.cargo = cargo;
  registrar('OCUPACAO_ALTERADA', 'usuario', alvo.id, { antes, depois: { utd, cargo } }, 'ADMIN');
}

// ---------- Importação do catálogo por CSV ----------
export const COLUNAS_CSV = ['codigo', 'atividade', 'governanca', 'indicador', 'cargo_r', 'corresponsaveis', 'aprovador_a', 'periodicidade', 'situacao', 'duracao_min', 'horario', 'dia_semana', 'regra_mes', 'evidencia', 'destino_transferencia'];

export function importarCatalogo(conteudo, nomeArquivo = 'catalogo.csv') {
  exigirPerfil(['GESTOR', 'ADMIN'], 'importar o catálogo');
  if (conteudo.length > LIMITES.csvBytesMax) throw new ErroRegra('Arquivo maior que 2 MB.');
  const linhas = csvParse(conteudo);
  if (linhas.length < 2) throw new ErroRegra('Arquivo sem linhas de atividade.');
  if (linhas.length - 1 > LIMITES.csvLinhasMax) throw new ErroRegra(`Arquivo com mais de ${LIMITES.csvLinhasMax} linhas.`);
  const cab = linhas[0].map((h) => h.trim().toLowerCase());
  const faltam = COLUNAS_CSV.filter((c) => !cab.includes(c));
  if (faltam.length) throw new ErroRegra(`Colunas ausentes: ${faltam.join(', ')}. Use o modelo.`);
  const idx = Object.fromEntries(COLUNAS_CSV.map((c) => [c, cab.indexOf(c)]));
  const d = estado.dados, hoje = hojeISO(), vistos = new Set();
  const r = { arquivo: nomeArquivo, aceitos: 0, criadas: 0, atualizadas: 0, semMudanca: 0, rejeitados: [] };
  linhas.slice(1).forEach((l, i) => {
    const val = (c) => String(l[idx[c]] ?? '').trim();
    const codigo = val('codigo').toUpperCase();
    try {
      if (!/^[A-Z0-9-]{2,20}$/.test(codigo)) throw new Error('Código vazio ou inválido (letras, números e hífen, até 20).');
      if (vistos.has(codigo)) throw new Error('Código repetido no arquivo.');
      vistos.add(codigo);
      const campos = validarAtividade({
        nome: val('atividade'), governanca: val('governanca'), indicador: val('indicador'), cargo: val('cargo_r').toUpperCase(),
        coResponsaveis: val('corresponsaveis'), aprovador: val('aprovador_a').toUpperCase(), periodicidade: val('periodicidade').toUpperCase(),
        situacao: val('situacao').toUpperCase(), duracaoMin: val('duracao_min'), horario: val('horario'), diaSemana: val('dia_semana'),
        regraMes: val('regra_mes'), evidencia: val('evidencia'), destino: val('destino_transferencia'),
      }, { registrarLog: false });
      const base = { ...campos, desde: hoje, motivo: `Importação ${nomeArquivo}`, por: estado.usuario.id, em: agora(), validada: false };
      const existente = d.atividades.find((a) => a.codigo === codigo);
      if (!existente) {
        d.atividades.push({ id: uid('at'), codigo, aceite: null, versoes: [base] });
        r.criadas++;
      } else {
        const ant = versaoAtual(existente);
        if (CAMPOS.every((k) => JSON.stringify(ant[k]) === JSON.stringify(campos[k]))) r.semMudanca++;
        else { if (ant.desde === hoje) existente.versoes[existente.versoes.length - 1] = base; else existente.versoes.push(base); r.atualizadas++; }
      }
      r.aceitos++;
    } catch (e) {
      r.rejeitados.push({ linha: i + 2, codigo, motivo: e.message, dados: l });
    }
  });
  if (r.aceitos) persistir();
  registrar('CATALOGO_IMPORTADO', 'catalogo', nomeArquivo, { aceitos: r.aceitos, criadas: r.criadas, atualizadas: r.atualizadas, rejeitados: r.rejeitados.length });
  if (r.rejeitados.length) logar({ categoria: 'VALIDACAO', acao: 'IMPORTACAO_LINHAS_RECUSADAS', resultado: 'INVALIDO', entidade: 'catalogo', entidadeId: nomeArquivo, detalhe: { linhas: r.rejeitados.slice(0, 20).map((x) => `${x.linha}: ${x.motivo}`) } });
  return r;
}
