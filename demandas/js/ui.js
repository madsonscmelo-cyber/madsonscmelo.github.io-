// Painel lateral/inferior (sheet), cartão de demanda e ficha com as ações: iniciar, concluir, delegar, radar, pendência, reabrir e cancelar.
import { el, $, toast, fmtDataHora } from './util.js';
import { estado, demandaPorId, nomeUsuario, usuarioPorId } from './store.js';
import { CANAIS, MOTIVOS_RADAR, CAMPOS_PENDENCIA, FAIXAS, STATUS, LIMITES, grupos, ehGrupo, faixa, quando, dataCurta, dataLonga, ativa } from './dominio.js';
import { iniciar, concluir, delegar, ajustarRadar, completarPendencia, reabrir, cancelar, podeTrabalhar, podeCompletar, podeCancelar, ErroRegra } from './acoes.js';
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

export const nomeDestino = (chave) => (ehGrupo(chave) ? grupos(estado.dados)[chave]?.nome || 'Grupo' : nomeUsuario(chave));

// ---------- Chips (texto + ícone, não só cor) ----------
export const chipFaixa = (dem) => {
  const f = faixa(dem);
  return el('span', { class: `chip chip--f-${f.toLowerCase()}` }, FAIXAS[f].ico ? el('span', { 'aria-hidden': 'true', text: FAIXAS[f].ico }) : null,
    f === 'CONCLUIDA' || f === 'CANCELADA' ? STATUS[dem.status] : quando(dem));
};
export const chipRadar = (dem) => (dem.radar === 'FORA'
  ? el('span', { class: 'chip chip--fora', title: MOTIVOS_RADAR[dem.motivoRadar] || dem.motivoRadarTexto || '' }, el('span', { 'aria-hidden': 'true', text: '◌' }), 'Fora do radar')
  : el('span', { class: 'chip chip--ok' }, el('span', { 'aria-hidden': 'true', text: '◉' }), 'Planejada'));

/** Cartão da agenda. Borda esquerda = faixa de prazo, sempre repetida em texto no chip. */
export function cartaoDemanda(dem, { mostrarDestino = false } = {}) {
  const f = faixa(dem);
  return el('button', {
    type: 'button', class: `dm dm--${f.toLowerCase()}`, dataset: { id: dem.id },
    'aria-label': `${dem.titulo}. ${FAIXAS[f].txt}: ${quando(dem)}. Pedido por ${dem.solicitante || 'não informado'}.${dem.radar === 'FORA' ? ' Fora do radar.' : ''}${dem.urgencia === 'URGENTE' ? ' Urgente.' : ''}${dem.pendencias?.length ? ' Com pendência.' : ''}`,
    onclick: () => abrirDemanda(dem.id),
  },
  el('span', { class: 'dm__topo', 'aria-hidden': 'true' },
    el('span', { class: 'dm__titulo', text: dem.titulo }),
    el('span', { class: 'dm__prazo', text: dataCurta(dem.prazo) })),
  el('span', { class: 'dm__meta', 'aria-hidden': 'true' },
    chipFaixa(dem),
    dem.urgencia === 'URGENTE' ? el('span', { class: 'chip chip--urgente', text: 'Urgente' }) : null,
    chipRadar(dem),
    dem.pendencias?.length ? el('span', { class: 'chip chip--pend', text: `Pendente: ${dem.pendencias.map((p) => CAMPOS_PENDENCIA[p]).join(', ')}` }) : null,
    dem.status === 'ANDAMENTO' ? el('span', { class: 'etiqueta', text: 'em andamento' }) : null,
    dem.delegadoPara ? el('span', { class: 'etiqueta', text: `com ${dem.delegadoPara}` }) : null,
    dem.exemplo ? el('span', { class: 'etiqueta etiqueta--ex', text: 'exemplo' }) : null),
  el('span', { class: 'dm__rod muted', 'aria-hidden': 'true', text: `${dem.solicitante || 'Solicitante pendente'} · ${dem.areaSolicitante || '—'} · ${CANAIS[dem.canal] || dem.canal}${mostrarDestino ? ` · para ${nomeDestino(dem.destinatario)}` : ''}` }));
}

// ---------- Ficha ----------
const meta = (rotulo, valor) => el('div', { class: 'meta__item' }, el('span', { class: 'meta__rotulo', text: rotulo }), el('span', { class: 'meta__valor', text: valor || '—' }));

export function abrirDemanda(id) {
  const dem = demandaPorId(id);
  if (!dem) { fecharSheet(); return; }
  const u = estado.usuario;
  const visivel = u.perfil === 'GESTOR' || u.perfil === 'AUDITOR' || dem.destinatario === u.id || dem.criadoPor === u.id;
  if (!visivel) { logar({ categoria: 'SEGURANCA', acao: 'FICHA_NEGADA', resultado: 'NEGADO', entidade: 'demanda', entidadeId: id }); toast('Você não tem acesso a esta demanda.', { tipo: 'erro' }); return; }
  if (sheetAtual()?.id !== id) logar({ categoria: 'LEITURA', acao: 'DEMANDA_CONSULTADA', entidade: 'demanda', entidadeId: id });

  const filhas = dem.ehMae ? estado.dados.demandas.filter((x) => x.maeId === dem.id) : [];
  const corpo = el('div', { class: 'grupo' },
    el('div', { class: 'ficha__estado' }, chipFaixa(dem), dem.urgencia === 'URGENTE' ? el('span', { class: 'chip chip--urgente', text: 'Urgente' }) : null, chipRadar(dem),
      dem.status === 'ANDAMENTO' ? el('span', { class: 'etiqueta', text: 'em andamento' }) : null, dem.exemplo ? el('span', { class: 'etiqueta etiqueta--ex', text: 'exemplo fictício' }) : null),
    el('div', { class: 'meta-grupo' }, el('h3', { class: 'meta-grupo__tit', text: 'Quando' }), el('div', { class: 'meta' },
      meta('Prazo', dataLonga(dem.prazo)), meta('Aberta em', dataCurta(dem.abertura)), meta('Antecedência', dem.antecedencia === null || dem.antecedencia === undefined ? '—' : `${dem.antecedencia} dia(s) útil(eis)`))),
    el('div', { class: 'meta-grupo' }, el('h3', { class: 'meta-grupo__tit', text: 'Quem e o quê' }), el('div', { class: 'meta' },
      meta('Pediu', `${dem.solicitante || 'pendente'} · ${dem.areaSolicitante || '—'}`), meta('Para', nomeDestino(dem.destinatario)), meta('Entregável', dem.entregavel),
      meta('Tipo', dem.tipo), meta('Canal', CANAIS[dem.canal]), meta('Delegada a', dem.delegadoPara))),
    dem.urgencia === 'URGENTE' ? el('p', { class: 'resumo', text: `Por que é urgente: ${dem.justificativa}` }) : null,
    dem.radar === 'FORA' ? el('p', { class: 'resumo resumo--fora', text: `Fora do radar: ${MOTIVOS_RADAR[dem.motivoRadar] || dem.motivoRadarTexto || 'marcado pelo supervisor'}` }) : null,
    dem.descricao ? el('details', { class: 'bloco-det' }, el('summary', { text: 'Como o pedido chegou' }), el('p', { class: 'citacao', text: dem.descricao })) : null,
    dem.anexo ? el('figure', { class: 'anexo' }, el('img', { src: dem.anexo, alt: 'Imagem anexada ao pedido (foto ou print)' }), el('figcaption', { class: 'muted pequeno', text: 'Imagem anexada ao pedido' })) : null,
    filhas.length ? el('section', {}, el('h3', { text: `Atendimento do grupo: ${filhas.filter((x) => x.status === 'CONCLUIDA').length} de ${filhas.filter((x) => x.status !== 'CANCELADA').length}` }),
      el('ul', { class: 'lista' }, filhas.map((x) => el('li', { class: 'lista__item' }, el('span', { text: nomeUsuario(x.destinatario) }), chipFaixa(x))))) : null,
    formPendencias(dem),
    dem.comentarioConclusao ? el('p', { class: 'resumo', text: `Na conclusão: ${dem.comentarioConclusao}` }) : null,
    acoes(dem),
    el('details', { class: 'bloco-det' }, el('summary', { text: `Histórico (${(dem.historico || []).length})` }),
      el('ol', { class: 'historico' }, (dem.historico || []).slice().reverse().map((h) => el('li', {},
        el('strong', { text: h.acao }), el('span', { class: 'muted', text: ` · ${nomeUsuario(h.por)} · ${fmtDataHora(h.em)}` }), h.detalhe ? el('div', { class: 'pequeno', text: h.detalhe }) : null)))));
  abrirSheet(dem.titulo, corpo, { tipo: 'demanda', id });
}

function formPendencias(dem) {
  if (!dem.pendencias?.length) return null;
  const pode = podeCompletar(dem) && (ativa(dem) || dem.ehMae);
  return el('section', { class: 'pendencias' },
    el('h3', { text: 'Dados pendentes com quem pediu' }),
    el('p', { class: 'muted pequeno', text: 'O pedido chegou sem estes dados. Isso entra no indicador de pedidos incompletos da área.' }),
    ...dem.pendencias.map((campo) => {
      const inp = el('input', { class: 'campo__input', type: campo === 'prazo' ? 'date' : 'text', maxlength: 120, 'aria-label': CAMPOS_PENDENCIA[campo], disabled: !pode });
      const f = el('form', { class: 'linha', novalidate: true }, el('label', { class: 'campo cresce' }, el('span', { class: 'campo__rotulo', text: CAMPOS_PENDENCIA[campo] }), inp),
        pode ? el('button', { type: 'submit', class: 'btn btn--sec', text: 'Completar' }) : null);
      f.addEventListener('submit', (e) => { e.preventDefault(); if (tratar(() => completarPendencia(dem.id, campo, inp.value))) toast('Dado completado.', { tipo: 'ok' }); });
      return f;
    }));
}

function acoes(dem) {
  const caixa = el('div', { class: 'ficha__acoes' });
  const trabalha = podeTrabalhar(dem);
  if (trabalha && dem.status === 'ABERTA') caixa.append(el('button', { type: 'button', class: 'btn btn--sec', text: 'Iniciar', onclick: () => { if (tratar(() => iniciar(dem.id))) toast('Marcada como em andamento.', { tipo: 'ok' }); } }));
  if (trabalha && ativa(dem)) {
    caixa.append(
      el('button', { type: 'button', class: 'btn', text: 'Concluir', onclick: () => formConcluir(dem) }),
      el('button', { type: 'button', class: 'btn btn--sec', text: 'Delegar', onclick: () => formDelegar(dem) }),
      el('button', { type: 'button', class: 'btn btn--sec', text: dem.radar === 'FORA' ? 'Ajustar radar' : 'Não estava no radar', onclick: () => formRadar(dem) }));
  }
  if (trabalha && dem.status === 'CONCLUIDA') caixa.append(el('button', { type: 'button', class: 'btn btn--sec', text: 'Reabrir', onclick: () => formMotivo(dem, 'Reabrir', 'Por que reabrir?', reabrir, 'Reaberta.') }));
  if (podeCancelar(dem) && (ativa(dem) || (dem.ehMae && dem.status !== 'CANCELADA'))) caixa.append(el('button', { type: 'button', class: 'btn btn--txt btn--perigo', text: 'Cancelar pedido', onclick: () => formMotivo(dem, 'Cancelar pedido', 'Por que cancelar?', cancelar, 'Pedido cancelado.') }));
  return caixa.childElementCount ? caixa : null;
}

function subForm(dem, titulo, campos, aoSalvar, rotulo = 'Salvar') {
  const msg = el('p', { class: 'login__msg', role: 'alert' });
  const f = el('form', { class: 'form', novalidate: true }, el('p', { class: 'muted', text: dem.titulo }), ...campos, msg);
  const rodape = el('div', { class: 'rodape-acoes' },
    el('button', { type: 'button', class: 'btn btn--sec', text: 'Voltar', onclick: () => abrirDemanda(dem.id) }),
    el('button', { type: 'button', class: 'btn btn--grande', text: rotulo, onclick: () => f.requestSubmit() }));
  f.addEventListener('submit', (e) => { e.preventDefault(); if (tratar(aoSalvar)) abrirDemanda(dem.id); });
  abrirSheet(titulo, f, { tipo: 'form', id: dem.id }, rodape);
  f.querySelector('input,select,textarea')?.focus();
}

function formConcluir(dem) {
  const c = el('textarea', { class: 'campo__input', rows: 3, maxlength: LIMITES.comentarioMax, placeholder: 'Ex.: planilha enviada por e-mail ao RH às 10h' });
  subForm(dem, 'Concluir demanda', [el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Como foi entregue (opcional)' }), c)],
    () => { concluir(dem.id, c.value); toast('Demanda concluída.', { tipo: 'ok' }); }, 'Concluir');
}

function formDelegar(dem) {
  const equipe = usuarioPorId(dem.destinatario)?.equipe || [];
  const s = el('select', { class: 'campo__input' }, el('option', { value: '', text: 'Ninguém (fica comigo)' }), equipe.map((p) => el('option', { value: p, text: p, selected: dem.delegadoPara === p })));
  subForm(dem, 'Delegar para a equipe', [el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Quem vai executar' }), s),
    el('p', { class: 'muted pequeno', text: 'A demanda continua na sua agenda e sob sua responsabilidade. A delegação fica no histórico.' })],
  () => { delegar(dem.id, s.value); toast(s.value ? `Delegada a ${s.value}.` : 'Delegação retirada.', { tipo: 'ok' }); });
}

function formRadar(dem) {
  const s = el('select', { class: 'campo__input' }, el('option', { value: '', text: 'Escolha o motivo' }), Object.entries(MOTIVOS_RADAR).map(([k, v]) => el('option', { value: k, text: v, selected: dem.motivoRadar === k })));
  const campos = [el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Por que não estava no seu radar?' }), s),
    el('p', { class: 'muted pequeno', text: 'O motivo vai para o painel da gerência por área demandante. Retrabalho e falha de outra área separam urgência legítima de desorganização.' })];
  if (dem.radar === 'FORA') campos.push(el('button', { type: 'button', class: 'btn btn--txt', text: 'Na verdade estava no radar', onclick: () => { if (tratar(() => ajustarRadar(dem.id, 'PLANEJADA'))) { toast('Marcada como planejada.', { tipo: 'ok' }); abrirDemanda(dem.id); } } }));
  subForm(dem, 'Fora do radar', campos, () => { ajustarRadar(dem.id, 'FORA', s.value); toast('Marcada como fora do radar.', { tipo: 'ok' }); });
}

function formMotivo(dem, titulo, rotulo, fn, ok) {
  const t = el('textarea', { class: 'campo__input', rows: 3, maxlength: 300, required: true });
  subForm(dem, titulo, [el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: rotulo }), t)], () => { fn(dem.id, t.value); toast(ok, { tipo: 'ok' }); }, titulo);
}
