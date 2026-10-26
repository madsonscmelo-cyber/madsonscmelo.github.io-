// Painel lateral/inferior (sheet), cartão de atividade e formulários: concluir, remanejar, decidir pedido, sob demanda.
import { el, $, toast, hojeISO, fmtData, fmtDataHora } from './util.js';
import { estado, nomeUsuario, salvarRascunho, obterRascunho, removerRascunho } from './store.js';
import { PERIODICIDADES, MOTIVOS_REMANEJAMENTO, CARGOS, UTDS, LIMITES, ocorrenciaPorChave, precisaAprovacao, janelaRemanejamento, ehDiaUtil, versaoAtual, dataCurta, hhmm } from './dominio.js';
import { concluir, remanejar, decidirPedido, registrarDemanda, podeGerirUtd, ErroRegra } from './acoes.js';
import { logar } from './auditoria.js';

let atual = null;
export const sheetAtual = () => atual;

export function abrirSheet(titulo, corpo, contexto = { tipo: 'form' }, rodape = null) {
  atual = contexto;
  const s = $('#sheet');
  $('#sheet-titulo').textContent = titulo;
  $('#sheet-corpo').replaceChildren(corpo);
  const r = $('#sheet-rodape');
  r.replaceChildren(...(rodape ? [rodape] : []));
  r.hidden = !rodape;
  if (s.hidden && history.state?.sheet !== true) history.pushState({ sheet: true }, '');
  s.hidden = false;
  $('#sheet-corpo').scrollTop = 0;
}

function fecharInterno() {
  atual = null;
  $('#sheet').hidden = true;
  document.dispatchEvent(new CustomEvent('sheet-fechado'));
}
export function fecharSheet() {
  if ($('#sheet').hidden) return;
  if (history.state?.sheet === true) history.back(); // o popstate fecha
  else fecharInterno();
}
window.addEventListener('popstate', () => { if (!$('#sheet').hidden) fecharInterno(); });

/** Executa um comando; erro de regra vira aviso ao usuário (já registrado no log pela própria ErroRegra). */
export function tratar(fn) {
  try { return fn() ?? true; } catch (e) {
    if (e instanceof ErroRegra) toast(e.message, { tipo: 'erro' });
    else { console.error(e); toast('Não foi possível concluir a ação. Tente novamente.', { tipo: 'erro' }); }
    return false;
  }
}

// ---------- Status e cartão ----------
// Texto + ícone (não só cor): legível para daltônicos e no modo sol.
export const STATUS = {
  CONCLUIDA: { txt: 'Concluída', ico: '✓' },
  AGUARDA: { txt: 'Aguarda supervisor', ico: '⏳' },
  ATRASADA: { txt: 'Atrasada', ico: '!' },
  HOJE: { txt: 'Hoje', ico: '•' },
  PROGRAMADA: { txt: 'Programada', ico: '' },
};

export const chipStatus = (o) => el('span', { class: `chip chip--oc-${o.status.toLowerCase()}` },
  STATUS[o.status].ico ? el('span', { 'aria-hidden': 'true', text: STATUS[o.status].ico }) : null, STATUS[o.status].txt);

const rotuloHorario = (o) => (o.horario === 'CONT' ? 'Contínua' : o.horario || 'Sem horário');

/** Cartão de atividade (agenda e Hoje). Borda = periodicidade, com a sigla em texto. */
export function cartaoOcorrencia(o, { mostrarPessoa = false } = {}) {
  const per = PERIODICIDADES[o.periodicidade];
  return el('button', {
    type: 'button', class: `oc oc--p${o.periodicidade} oc--${o.status.toLowerCase()}`, dataset: { chave: o.chave },
    'aria-label': `${o.nome}. ${per.nome}. ${rotuloHorario(o)}. ${STATUS[o.status].txt}${o.remanejada ? '. Remanejada' : ''}${mostrarPessoa ? `. ${nomeUsuario(o.usuarioId)}` : ''}`,
    onclick: () => abrirOcorrencia(o.chave),
  },
  el('span', { class: 'oc__topo', 'aria-hidden': 'true' },
    el('span', { text: `${rotuloHorario(o)}${o.duracaoMin ? ` · ${hhmm(o.duracaoMin)}` : ''}` }),
    el('span', { class: 'oc__per', title: per.nome, text: per.sigla })),
  el('span', { class: 'oc__nome', 'aria-hidden': 'true', text: o.nome }),
  el('span', { class: 'oc__rod', 'aria-hidden': 'true' }, chipStatus(o),
    o.remanejada ? el('span', { class: 'etiqueta', text: '↷ remanejada' }) : null,
    o.emTransferencia ? el('span', { class: 'etiqueta etiqueta--alerta', text: 'em transferência' }) : null,
    mostrarPessoa ? el('span', { class: 'muted pequeno', text: nomeUsuario(o.usuarioId) }) : null));
}

// ---------- Ficha da ocorrência ----------
const meta = (rotulo, valor) => el('div', { class: 'meta__item' }, el('span', { class: 'meta__rotulo', text: rotulo }), el('span', { class: 'meta__valor', text: valor }));

export function abrirOcorrencia(chave) {
  const o = ocorrenciaPorChave(estado.dados, chave);
  if (!o) { toast('Atividade não encontrada na agenda.', { tipo: 'erro' }); return; }
  const u = estado.usuario, dono = o.usuarioId === u.id, gere = podeGerirUtd(o.utd);
  if (!dono && !gere && u.perfil !== 'AUDITOR') {
    logar({ categoria: 'SEGURANCA', acao: 'ACESSO_NEGADO_OCORRENCIA', resultado: 'NEGADO', entidade: 'ocorrencia', entidadeId: chave });
    toast('Você não tem acesso a esta atividade.', { tipo: 'erro' });
    return;
  }
  logar({ categoria: 'LEITURA', acao: 'OCORRENCIA_CONSULTADA', entidade: 'ocorrencia', entidadeId: chave });
  const ex = o.exec || {};
  const corpo = el('div', { class: 'grupo' },
    el('div', { class: 'ficha__estado' }, chipStatus(o), el('span', { class: 'chip', text: PERIODICIDADES[o.periodicidade].nome }),
      o.remanejada ? el('span', { class: 'etiqueta', text: '↷ remanejada' }) : null),
    o.emTransferencia ? el('p', { class: 'resumo', text: `Marcada para transferir a ${o.destino || 'outra área'}. Sem aceite registrado, continua na sua rotina.` }) : null,
    el('div', { class: 'meta-grupo' }, el('p', { class: 'meta-grupo__tit', text: 'Quando' }), el('div', { class: 'meta' },
      meta('Data', dataCurta(o.data)), meta('Horário', rotuloHorario(o)), meta('Duração', o.duracaoMin ? hhmm(o.duracaoMin) : 'contínua'))),
    el('div', { class: 'meta-grupo' }, el('p', { class: 'meta-grupo__tit', text: 'Quem e o quê' }), el('div', { class: 'meta' },
      meta('Responsável (R)', nomeUsuario(o.usuarioId)), meta('Aprova (A)', o.aprovador ? 'Supervisor da UTD' : 'não definido'), meta('Código', o.codigo))),
    el('p', { class: 'resumo' }, el('span', { class: 'muted', text: 'Produto esperado: ' }), o.evidenciaEsperada || '—'),
    ex.concluidaEm ? el('div', { class: 'bloco-ok' }, el('strong', { text: `✓ Concluída em ${fmtDataHora(ex.concluidaEm)}` }), el('p', { text: ex.evidencia })) : null,
    ex.pedido ? el('div', { class: 'bloco bloco--aviso' }, el('strong', { text: `⏳ Pedido de remanejamento para ${dataCurta(ex.pedido.para)}` }),
      el('p', { class: 'pequeno', text: `${MOTIVOS_REMANEJAMENTO[ex.pedido.motivo]}${ex.pedido.texto ? ` — ${ex.pedido.texto}` : ''}` }),
      el('p', { class: 'pequeno muted', text: `Por ${nomeUsuario(ex.pedido.por)} · precisa do supervisor: ${ex.pedido.motivosAprovacao.join('; ')}` })) : null,
    (ex.remanejamentos || []).length ? el('details', { class: 'bloco-det' }, el('summary', { text: `Histórico de remanejamentos (${ex.remanejamentos.length})` }),
      el('ul', { class: 'lista' }, ex.remanejamentos.map((r) => el('li', { class: 'lista__item' },
        el('span', { text: `${r.situacao === 'APLICADO' ? '↷' : '✕'} ${dataCurta(r.de)} → ${dataCurta(r.para)} · ${MOTIVOS_REMANEJAMENTO[r.motivo]}` }),
        el('span', { class: 'muted pequeno', text: `${r.situacao === 'APLICADO' ? 'aplicado' : 'recusado'}${r.decisao ? ` por ${nomeUsuario(r.decisao.por)}${r.decisao.justificativa ? `: ${r.decisao.justificativa}` : ''}` : ''}` }))))) : null);

  // Uma ação principal por ficha (Hick/Fitts); as demais como texto.
  let rodape = null;
  const podeRemanejar = o.status !== 'CONCLUIDA' && o.status !== 'AGUARDA' && (dono || gere);
  if (ex.pedido && gere && ex.pedido.por !== u.id) {
    rodape = el('div', { class: 'rodape-acoes' },
      el('button', { type: 'button', class: 'btn btn--grande', text: 'Aprovar', onclick: () => { if (tratar(() => decidirPedido(chave, true))) { toast('Remanejamento aprovado.', { tipo: 'ok' }); fecharSheet(); } } }),
      el('button', { type: 'button', class: 'btn btn--sec', text: 'Recusar', onclick: () => abrirRecusa(chave) }));
  } else if (dono && u.perfil === 'COLABORADOR' && o.status !== 'CONCLUIDA' && o.data <= hojeISO()) {
    rodape = el('div', { class: 'rodape-acoes' },
      el('button', { type: 'button', class: 'btn btn--grande', text: 'Concluir', onclick: () => abrirConcluir(chave) }),
      podeRemanejar ? el('button', { type: 'button', class: 'btn btn--sec', text: 'Remanejar', onclick: () => abrirRemanejar(chave) }) : null);
  } else if (podeRemanejar) {
    rodape = el('div', { class: 'rodape-acoes' }, el('button', { type: 'button', class: 'btn btn--grande btn--sec', text: 'Remanejar', onclick: () => abrirRemanejar(chave) }));
  }
  abrirSheet(o.nome, corpo, { tipo: 'ocorrencia', chave }, rodape);
}

// ---------- Concluir com evidência (rascunho automático: Zeigarnik) ----------
export function abrirConcluir(chave) {
  const o = ocorrenciaPorChave(estado.dados, chave);
  const chaveRasc = `ev:${chave}`;
  const ta = el('textarea', { class: 'campo__input', rows: 4, maxlength: LIMITES.evidenciaMax, placeholder: `Ex.: ${o.evidenciaEsperada || 'relatório enviado ao grupo da UTD às 8h10'}`, 'aria-describedby': 'ev-dica' });
  ta.value = obterRascunho(chaveRasc)?.texto || '';
  const cont = el('span', { class: 'pequeno muted', 'aria-live': 'polite' });
  const contar = () => { cont.textContent = `${ta.value.trim().length} de no mínimo ${LIMITES.evidenciaMin} caracteres`; };
  // Grava a cada digitação (sem esperar): evidência começada não se perde se o app fechar.
  ta.addEventListener('input', () => {
    contar();
    if (ta.value.trim()) salvarRascunho({ chave: chaveRasc, ocorrencia: chave, titulo: o.nome, texto: ta.value });
    else removerRascunho(chaveRasc);
  });
  contar();
  const corpo = el('div', { class: 'form' },
    el('p', { class: 'resumo' }, el('span', { class: 'muted', text: 'Produto esperado: ' }), o.evidenciaEsperada || '—'),
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Evidência do produto (obrigatória)' }), ta),
    el('p', { id: 'ev-dica', class: 'pequeno muted', text: 'Diga o que foi entregue e onde está (sistema, e-mail, grupo, pasta). É o que o supervisor confere.' }),
    cont);
  abrirSheet(`Concluir: ${o.nome}`, corpo, { tipo: 'concluir', chave }, el('button', { type: 'button', class: 'btn btn--grande', text: 'Concluir com evidência', onclick: () => {
    const r = tratar(() => concluir(chave, ta.value));
    if (r) {
      navigator.vibrate?.(60);
      toast(r.noPrazo ? 'Concluída na data. Conta na aderência.' : 'Concluída fora da data original: conta no cumprimento, não na aderência.', { tipo: 'ok' });
      fecharSheet();
    }
  } }));
  ta.focus();
}

// ---------- Remanejar (motivo obrigatório; fora da janela ou 2º vez → supervisor) ----------
export function abrirRemanejar(chave) {
  const d = estado.dados, o = ocorrenciaPorChave(d, chave), hoje = hojeISO();
  const j = janelaRemanejamento(d, o);
  const data = el('input', { type: 'date', class: 'campo__input', min: hoje, value: '' });
  const motivo = el('select', { class: 'campo__input' }, el('option', { value: '', text: 'Escolha o motivo…' }), Object.entries(MOTIVOS_REMANEJAMENTO).map(([k, t]) => el('option', { value: k, text: t })));
  const obs = el('textarea', { class: 'campo__input', rows: 2, maxlength: LIMITES.textoMax, placeholder: 'Detalhe (obrigatório se o motivo for "Outro")' });
  const aviso = el('p', { class: 'resumo', role: 'status' });
  const botao = el('button', { type: 'button', class: 'btn btn--grande', text: 'Remanejar' });
  const atualizar = () => {
    const x = data.value;
    if (!x) { aviso.textContent = `Sem aprovação: ${PERIODICIDADES[o.periodicidade].janela} (${fmtData(j.ini)} a ${fmtData(j.fim)}), uma vez.`; botao.textContent = 'Remanejar'; return; }
    if (!ehDiaUtil(d, x)) { aviso.textContent = '⚠ Escolha um dia útil (sem fim de semana nem feriado).'; return; }
    const m = precisaAprovacao(d, o, x);
    aviso.textContent = m.length ? `⏳ Vai para o supervisor: ${m.join('; ')}. Até a decisão, a atividade fica na data atual.` : '✓ Dentro da janela: aplica na hora.';
    botao.textContent = m.length ? 'Enviar ao supervisor' : 'Remanejar';
  };
  data.addEventListener('change', atualizar);
  atualizar();
  botao.addEventListener('click', () => {
    const r = tratar(() => remanejar(chave, { para: data.value, motivo: motivo.value, texto: obs.value }));
    if (!r) return;
    toast(r.aplicado ? `Remanejada para ${dataCurta(data.value)}.` : 'Pedido enviado ao supervisor.', { tipo: 'ok' });
    fecharSheet();
  });
  abrirSheet(`Remanejar: ${o.nome}`, el('div', { class: 'form' },
    el('p', { class: 'pequeno muted', text: `Hoje está em ${dataCurta(o.data)}${o.data !== o.dataPrevista ? ` (data original ${dataCurta(o.dataPrevista)})` : ''}.` }),
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Nova data' }), data),
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Motivo (obrigatório)' }), motivo),
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Detalhe' }), obs),
    aviso), { tipo: 'remanejar', chave }, botao);
}

function abrirRecusa(chave) {
  const ta = el('textarea', { class: 'campo__input', rows: 3, maxlength: LIMITES.textoMax, placeholder: 'Por que o remanejamento não pode ser feito?' });
  abrirSheet('Recusar remanejamento', el('div', { class: 'form' },
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Justificativa (obrigatória)' }), ta),
    el('p', { class: 'pequeno muted', text: 'A atividade continua na data atual e a pessoa vê a justificativa.' })),
  { tipo: 'recusa', chave }, el('button', { type: 'button', class: 'btn btn--grande', text: 'Recusar pedido', onclick: () => {
    if (tratar(() => decidirPedido(chave, false, ta.value))) { toast('Pedido recusado.', { tipo: 'ok' }); fecharSheet(); }
  } }));
  ta.focus();
}

// ---------- Sob demanda ----------
export function abrirDemanda() {
  const d = estado.dados, u = estado.usuario;
  const opcoes = d.atividades.map((a) => ({ a, v: versaoAtual(a) })).filter(({ v }) => v.situacao === 'S' && (u.perfil !== 'COLABORADOR' || v.cargo === u.cargo));
  if (!opcoes.length) { toast('Nenhuma atividade sob demanda no catálogo do seu cargo.', { tipo: 'aviso' }); return; }
  const atv = el('select', { class: 'campo__input' }, opcoes.map(({ a, v }) => el('option', { value: a.id, text: `${v.nome}${u.perfil !== 'COLABORADOR' ? ` (${CARGOS[v.cargo]})` : ''}` })));
  const data = el('input', { type: 'date', class: 'campo__input', max: hojeISO(), value: hojeISO() });
  const min = el('input', { type: 'number', class: 'campo__input', min: 1, max: LIMITES.duracaoMax, step: 1, value: 60, inputmode: 'numeric' });
  const desc = el('textarea', { class: 'campo__input', rows: 3, maxlength: LIMITES.textoMax, placeholder: 'O que foi feito e para quem' });
  abrirSheet('Registrar sob demanda', el('div', { class: 'form' },
    el('p', { class: 'pequeno muted', text: 'Sob demanda não entra na aderência: serve para medir quanto tempo a retaguarda gasta fora da rotina.' }),
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Atividade' }), atv),
    el('div', { class: 'linha' }, el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Data' }), data),
      el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Minutos' }), min)),
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Descrição' }), desc)),
  { tipo: 'demanda' }, el('button', { type: 'button', class: 'btn btn--grande', text: 'Registrar', onclick: () => {
    if (tratar(() => registrarDemanda({ atvId: atv.value, data: data.value, duracaoMin: Number(min.value), descricao: desc.value }))) { toast('Registro salvo.', { tipo: 'ok' }); fecharSheet(); }
  } }));
}

export const rotuloPessoa = (u) => `${u.nome} · ${CARGOS[u.cargo] || '—'} · ${UTDS[u.utd] || '—'}`;
