// Painel lateral/inferior (sheet), formatação e fichas: poste, cluster e bloco de manobra.
import { el, $, fmtMoeda, fmtNum } from './util.js';
import { estado } from './store.js';
import { CAUSAS, CHAVES, PARAMS, periodos, indexar, statsPostes, st, protecaoMontante, acaoSugerida, TIPOS_ACAO, noPeriodo } from './dominio.js';
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

// ---------------- Formatação ----------------
const f1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt1 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : f1.format(v));
export const fmt2 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : f2.format(v));
export const fmtChi = (v) => fmtNum(Math.round(v || 0));
export const fmtR = (v) => fmtMoeda(v || 0);
export const codPoste = (p) => p?.cod || p?.id || '—';

/** Variação contra o ano anterior. Nos indicadores de continuidade, subir é ruim: a seta diz o sentido e a palavra diz se é bom. */
export function delta(d) {
  if (d === null || d === undefined || !Number.isFinite(d)) return el('span', { class: 'delta delta--neutro', text: 'sem base' });
  const p = Math.round(d * 100);
  if (p === 0) return el('span', { class: 'delta delta--neutro', text: '= estável' });
  const pior = p > 0;
  return el('span', { class: `delta ${pior ? 'delta--ruim' : 'delta--bom'}`, text: `${pior ? '▲' : '▼'} ${Math.abs(p)}% ${pior ? 'pior' : 'melhor'}` });
}

export const kpi = (rotulo, valor, det, extra = null, cls = '') => el('div', { class: `kpi ${cls}` },
  el('span', { class: 'kpi__rotulo', text: rotulo }), el('strong', { class: 'kpi__valor', text: valor }), extra, det ? el('span', { class: 'kpi__det', text: det }) : null);

export const item = (r, v) => el('div', { class: 'meta__item' }, el('span', { class: 'meta__rotulo', text: r }), el('span', { class: 'meta__valor', text: v }));

export function barra(frac, cor = '') {
  const p = el('span', { class: `barras__preench ${cor}` });
  p.style.width = `${Math.max(0, Math.min(100, Math.round(frac * 100)))}%`; // CSSOM: permitido pela CSP (só o atributo style inline é bloqueado)
  return el('span', { class: 'barras__trilho', 'aria-hidden': 'true' }, p);
}

export function etiquetas(p, s) {
  return el('div', { class: 'ficha__estado' },
    p.veg ? el('span', { class: 'etq etq--arvore', text: '🌳 Árvore' }) : null,
    p.acesso === 'DIFICIL' ? el('span', { class: 'etq etq--acesso', text: `🚧 Acesso difícil${p.acessoMotivo ? `: ${p.acessoMotivo}` : ''}` }) : null,
    p.chave ? el('span', { class: 'etq etq--chave', text: `⏚ ${CHAVES[p.chave]}` }) : null,
    s.n >= PARAMS.reincidenciaMin ? el('span', { class: 'etq etq--reinc', text: `🔁 Reincidente (${s.n})` }) : null,
    s.comp > 0 ? el('span', { class: 'etq etq--comp', text: `R$ Compensação ${fmtR(s.comp)}` }) : null);
}

// ---------------- Fichas ----------------
/** Rodapé fixo da ficha (Fitts): voltar para a lista de resultados + ação principal. */
function rodape(aoVoltar, principal) {
  if (!aoVoltar && !principal) return null;
  return el('div', { class: 'rodape-acoes' },
    aoVoltar ? el('button', { type: 'button', class: 'btn btn--sec', text: '← Resultados', onclick: aoVoltar }) : null,
    principal ? el('button', { type: 'button', class: 'btn btn--largo', text: principal[0], onclick: principal[1] }) : null);
}
export function abrirPoste(alId, posteId, aoVerNoMapa, aoVoltar) {
  const idx = indexar(estado.rede, alId);
  const p = idx?.porId.get(posteId);
  if (!p) return;
  const per = periodos()[estado.sel.periodo];
  const stats = statsPostes(idx, per), s = st(stats, p.id);
  const prot = idx.porId.get(protecaoMontante(idx, p.id));
  const ocs = (idx.ocPorPoste.get(p.id) || []).filter((o) => noPeriodo(o.data, per)).sort((a, b) => b.data.localeCompare(a.data));
  logar({ categoria: 'LEITURA', acao: 'POSTE_CONSULTADO', entidade: 'poste', entidadeId: codPoste(p), detalhe: { alimentador: alId } });
  abrirSheet(`Poste ${codPoste(p)}`, el('div', {},
    etiquetas(p, s),
    el('div', { class: 'meta' },
      item('Alimentador', `${idx.al.id} · ${idx.al.nome}`), item('Período', per.rotulo),
      item('Transformador', p.trafo ? `${p.trafo} · ${fmtNum(p.ucs)} UCs` : '—'), item('UCs a jusante', fmtNum(idx.ucsSub.get(p.id))),
      item('Proteção a montante', prot ? `${CHAVES[prot.chave] || 'Início'} no poste ${codPoste(prot)}` : '—'),
      p.risco !== undefined ? item('Score de risco do poste', `${p.risco} de 100${p.risco >= 60 ? ' · crítico' : ''}`) : null,
      item('Ocorrências originadas', String(s.n)), item('CHI originado', fmtChi(s.chi)), item('Compensação', fmtR(s.comp))),
    el('h3', { text: `Ocorrências no período (${ocs.length})` }),
    ocs.length ? el('ul', { class: 'lista' }, ocs.slice(0, 30).map((o) => el('li', { class: 'lista__item' },
      el('strong', { text: `${o.data.slice(8, 10)}/${o.data.slice(5, 7)}/${o.data.slice(0, 4)} ${o.data.slice(11, 16)}` }),
      el('span', { text: ` · ${CAUSAS[o.causa] || o.causa} · ${fmtNum(o.ucs)} UCs · ${fmt2(o.dur)} h · CHI ${fmtChi(o.chi)}` })))) : el('p', { class: 'vazio', text: 'Nenhuma ocorrência originada neste poste no período.' })),
  { tipo: 'poste', al: alId, id: posteId },
  rodape(aoVoltar, aoVerNoMapa ? ['Centralizar no mapa', () => aoVerNoMapa(p)] : null));
}

export function abrirCluster(c, rank, aoVerNoMapa, aoVoltar) {
  const acao = acaoSugerida(c);
  const causas = Object.entries(c.causas).sort((a, b) => b[1] - a[1]);
  const totalCausas = causas.reduce((s, [, v]) => s + v, 0) || 1;
  logar({ categoria: 'LEITURA', acao: 'CLUSTER_CONSULTADO', entidade: 'cluster', entidadeId: c.idCluster, detalhe: { postes: c.ids.length } });
  abrirSheet(`Trecho ${rank ? `#${rank} ` : ''}· ${c.al.id}`, el('div', {},
    el('p', { class: 'acao-sug' }, el('span', { class: `etq etq--acao-${acao.tipo.toLowerCase()}`, text: TIPOS_ACAO[acao.tipo] }), ' ', acao.texto),
    el('div', { class: 'meta' },
      item('Começa no poste', codPoste(c.montante)), item('Postes no trecho', `${c.ids.length} (${fmt1(c.km)} km)`),
      item('CHI originado', fmtChi(c.chi)), item('Compensação', fmtR(c.comp)),
      item('Ocorrências', String(c.n)), item('Postes reincidentes', String(c.reinc)),
      item('Com árvore', `${Math.round(c.veg * 100)}% dos postes`), item('Acesso difícil', `${Math.round(c.acesso * 100)}% dos postes`),
      item('UCs nos transformadores do trecho', fmtNum(c.ucs)), item('Postes que acendem no filtro', String(c.acesos.length))),
    causas.length ? el('div', {}, el('h3', { text: 'CHI por causa' }), el('div', { class: 'barras' }, causas.map(([k, v]) => el('div', { class: 'barras__linha' },
      el('span', { text: CAUSAS[k] || k }), barra(v / totalCausas, k === 'VEG' ? 'ok' : 'alerta'), el('span', { class: 'barras__val', text: `${Math.round((v / totalCausas) * 100)}%` }))))) : null),
  { tipo: 'cluster', id: c.idCluster },
  rodape(aoVoltar, aoVerNoMapa ? ['Ver trecho no mapa', () => aoVerNoMapa(c)] : null));
}
