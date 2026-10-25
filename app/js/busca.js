// Busca única (Ctrl+K ou 🔍 no topo): ativo, trecho, defeito ou equipe, de qualquer tela.
import { el, $ } from './util.js';
import { estado, ativoPorId } from './store.js';
import { TIPOS_ATIVO, TIPOS_EQUIPE, STATUS_DEFEITO, tipoDefeito } from './dominio.js';
import { logar } from './auditoria.js';

const normal = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Até 8 resultados, na ordem: ativo, trecho, equipe, defeito. Termo com menos de 2 letras não busca. */
export function resultadosBusca(termo, limite = 8) {
  const q = normal(termo).trim();
  if (q.length < 2) return [];
  const d = estado.dados, out = [];
  for (const a of d.ativos) if (normal(a.codigo).includes(q)) out.push({ tipo: 'ativo', id: a.id, titulo: a.codigo, sub: `${TIPOS_ATIVO[a.tipo]} · ${a.alimentador}` });
  for (const t of d.trechosInspecao || []) if (normal(t.id).includes(q)) out.push({ tipo: 'trecho', id: t.id, titulo: t.id, sub: `Trecho · ${t.km.toFixed(2).replace('.', ',')} km · ${t.alimentador}` });
  for (const e of d.equipes) if (normal(e.nome).includes(q) || normal(e.id).includes(q)) out.push({ tipo: 'equipe', id: e.id, titulo: e.nome, sub: `Equipe · ${TIPOS_EQUIPE[e.tipo] || e.tipo}` });
  for (const f of d.defeitos) {
    const a = ativoPorId(f.ativoId), nome = tipoDefeito(f.tipoId)?.nome || f.tipoId;
    if (normal(f.id).includes(q) || normal(f.tipoId).includes(q) || normal(nome).includes(q)) out.push({ tipo: 'defeito', id: f.id, ativoId: f.ativoId, titulo: `${nome} — ${a?.codigo || ''}`, sub: `Defeito · sev. ${f.severidade} · ${STATUS_DEFEITO[f.status]}` });
    if (out.length > 60) break;
  }
  const ordem = { ativo: 0, trecho: 1, equipe: 2, defeito: 3 };
  return out.sort((x, y) => ordem[x.tipo] - ordem[y.tipo]).slice(0, limite);
}

const ICONE = { ativo: '📍', trecho: '〰', equipe: '👷', defeito: '⚠' };

/** Abre o resultado no lugar certo para o perfil (auditor não tem mapa: vai para a lista). */
export function abrirResultado(r, ctx) {
  logar({ categoria: 'LEITURA', acao: 'BUSCA_ABERTA', entidade: r.tipo, entidadeId: r.id });
  const temMapa = estado.usuario.perfil !== 'AUDITOR';
  if (r.tipo === 'ativo') return temMapa ? ctx.abrirNoMapa(r.id) : ctx.irPara('defeitos');
  if (r.tipo === 'trecho') return temMapa ? ctx.abrirTrechoNoMapa(r.id) : ctx.irPara('painel');
  if (r.tipo === 'defeito') return temMapa ? ctx.abrirNoMapa(r.ativoId) : ctx.irPara('defeitos');
  return ctx.irPara(['GESTOR', 'SUPERVISOR', 'AUDITOR'].includes(estado.usuario.perfil) ? 'programacao' : 'producao');
}

/** Lista de resultados com teclado (setas, Enter) — usada na busca global e na do mapa. */
export function listaResultados(inp, ctx, aoEscolher = () => {}) {
  const lista = el('div', { class: 'busca__res', role: 'listbox', id: `res-${Math.random().toString(36).slice(2, 7)}`, 'aria-label': 'Resultados da busca' });
  inp.setAttribute('role', 'combobox');
  inp.setAttribute('aria-controls', lista.id);
  inp.setAttribute('aria-expanded', 'false');
  inp.setAttribute('aria-autocomplete', 'list');
  let itens = [], foco = -1;
  const marcar = () => lista.querySelectorAll('.busca__item').forEach((b, i) => { b.setAttribute('aria-selected', String(i === foco)); if (i === foco) inp.setAttribute('aria-activedescendant', b.id); });
  const escolher = (r) => { aoEscolher(); abrirResultado(r, ctx); };
  inp.addEventListener('input', () => {
    itens = resultadosBusca(inp.value); foco = itens.length ? 0 : -1;
    inp.setAttribute('aria-expanded', String(inp.value.trim().length >= 2));
    lista.replaceChildren(...(inp.value.trim().length < 2 ? [] : itens.length ? itens.map((r, i) => el('button', { type: 'button', class: 'busca__item', role: 'option', id: `${lista.id}-${i}`, tabIndex: -1, onclick: () => escolher(r) },
      el('span', { class: 'busca__ico', 'aria-hidden': 'true', text: ICONE[r.tipo] }), el('strong', { text: r.titulo }), el('span', { class: 'muted', text: r.sub })))
      : [el('div', { class: 'busca__vazio muted', role: 'status', text: 'Nada encontrado. Busque pelo código (TR-07-03), trecho (ALM-07-T03), equipe ou tipo de defeito.' })]));
    marcar();
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!itens.length) return; e.preventDefault(); foco = (foco + (e.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length; marcar(); }
    else if (e.key === 'Enter' && itens[foco]) { e.preventDefault(); escolher(itens[foco]); }
  });
  return lista;
}

let anterior = null;
export function abrirBusca(ctx) {
  const caixa = $('#busca-global');
  if (!caixa || !estado.usuario) return;
  anterior = document.activeElement;
  const inp = el('input', { type: 'search', class: 'busca__inp', placeholder: 'Ativo, trecho, defeito ou equipe', 'aria-label': 'Buscar ativo, trecho, defeito ou equipe', autocomplete: 'off', maxlength: 40 });
  const fechar = () => { caixa.hidden = true; caixa.replaceChildren(); anterior?.focus?.(); };
  const lista = listaResultados(inp, ctx, fechar);
  caixa.replaceChildren(el('div', { class: 'busca-global__caixa' },
    el('div', { class: 'busca-global__cab' }, inp, el('button', { type: 'button', class: 'btn btn--txt', text: 'Fechar', onclick: fechar })),
    lista, el('p', { class: 'muted pequeno', text: '↑ ↓ para escolher · Enter para abrir · Esc para fechar' })));
  caixa.onclick = (e) => { if (e.target === caixa) fechar(); };
  caixa.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } };
  caixa.hidden = false;
  inp.focus();
  logar({ categoria: 'NAVEGACAO', acao: 'BUSCA_GLOBAL_ABERTA' });
}

