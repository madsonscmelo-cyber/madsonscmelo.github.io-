// Tela Agenda: o que o supervisor tem que entregar, por faixa de prazo. Gerência vê todos (com filtro); área demandante vê os próprios pedidos.
import { el, preencher } from './util.js';
import { estado, rascunhosDoUsuario } from './store.js';
import { FAIXAS, demandasVisiveis, faixa, ativa, supervisores } from './dominio.js';
import { cartaoDemanda } from './ui.js';

const filtro = { supervisor: '', mostrarEncerradas: false };

export function telaAgenda(raiz, ctx) {
  const u = estado.usuario;
  const ehGestao = u.perfil === 'GESTOR' || u.perfil === 'AUDITOR';
  let lista = demandasVisiveis(estado.dados, u);
  if (u.perfil === 'DEMANDANTE') lista = lista.filter((x) => x.status !== 'CANCELADA' || filtro.mostrarEncerradas);
  if (ehGestao && filtro.supervisor) lista = lista.filter((x) => x.destinatario === filtro.supervisor);

  const grupos = Object.fromEntries(Object.keys(FAIXAS).map((k) => [k, []]));
  for (const x of lista) grupos[faixa(x)].push(x);
  for (const k of Object.keys(grupos)) grupos[k].sort((a, b) => (a.prazo || '9').localeCompare(b.prazo || '9'));
  grupos.CONCLUIDA.sort((a, b) => (b.concluidaEm || '').localeCompare(a.concluidaEm || ''));
  const abertas = lista.filter(ativa);

  const kpi = (r, v, c = '') => el('div', { class: `kpi ${c}` }, el('span', { class: 'kpi__rotulo', text: r }), el('strong', { class: 'kpi__valor', text: String(v) }));
  const secao = (k, dica, max) => {
    const itens = grupos[k];
    if (!itens.length && !['ATRASADA', 'HOJE'].includes(k)) return null;
    return el('section', { class: 'faixa', 'aria-labelledby': `fx-${k}` },
      el('div', { class: 'faixa__cab' }, el('h2', { id: `fx-${k}`, text: FAIXAS[k].txt }), el('span', { class: 'faixa__n', text: String(itens.length) }), dica ? el('span', { class: 'muted pequeno', text: dica }) : null),
      itens.length ? el('div', { class: 'dm-lista' }, itens.slice(0, max || 200).map((x) => cartaoDemanda(x, { mostrarDestino: u.perfil !== 'SUPERVISOR' })))
        : el('p', { class: 'vazio', text: k === 'ATRASADA' ? 'Nada atrasado.' : 'Nada vence hoje.' }));
  };

  const filtros = ehGestao ? el('div', { class: 'filtros' }, (() => {
    const s = el('select', { class: 'campo__input', 'aria-label': 'Ver agenda de' }, el('option', { value: '', text: 'Todos os supervisores' }),
      supervisores(estado.dados).map((x) => el('option', { value: x.id, text: x.nome, selected: filtro.supervisor === x.id })));
    s.addEventListener('change', () => { filtro.supervisor = s.value; telaAgenda(raiz, ctx); });
    return s;
  })()) : null;

  const rascunho = rascunhosDoUsuario().find((r) => r.chave === `nova:${u.id}` && (r.texto || r.campos?.titulo));
  const vazio = !lista.length;
  preencher(raiz,
    el('header', { class: 'tela__topo' },
      el('h1', { text: u.perfil === 'DEMANDANTE' ? 'Meus pedidos' : u.perfil === 'SUPERVISOR' ? 'Minha agenda de demandas' : 'Agenda dos supervisores' }),
      u.perfil !== 'AUDITOR' ? el('button', { type: 'button', class: 'btn', text: '+ Nova demanda', onclick: () => ctx.irPara('nova') }) : null),
    rascunho ? el('div', { class: 'rascunho' }, el('span', { text: '📝 Pedido começado e não criado' }), el('button', { type: 'button', class: 'btn btn--txt', text: 'Continuar', onclick: () => ctx.irPara('nova') })) : null,
    filtros,
    el('div', { class: 'kpis' },
      kpi('Atrasadas', grupos.ATRASADA.length, grupos.ATRASADA.length ? 'kpi--critico' : 'kpi--ok'),
      kpi('Vencem hoje', grupos.HOJE.length, grupos.HOJE.length ? 'kpi--alerta' : ''),
      kpi('Próximos 5 dias', grupos.D3.length + grupos.D5.length),
      kpi('Abertas', abertas.length),
      kpi('Fora do radar', abertas.filter((x) => x.radar === 'FORA').length)),
    vazio ? el('div', { class: 'bloco' }, el('h2', { text: 'Nenhuma demanda por aqui' }),
      el('p', { class: 'muted', text: u.perfil === 'DEMANDANTE' ? 'Os pedidos que você abrir aparecem aqui, com o andamento de cada supervisor.' : 'As demandas aparecem aqui, agrupadas por prazo. Registre a primeira em Nova demanda, falando ou digitando.' })) : null,
    secao('ATRASADA'), secao('HOJE'), secao('D3'), secao('D5', 'dá para antecipar'), secao('DEPOIS'), secao('SEM_PRAZO', 'cobrar o prazo de quem pediu'),
    secao('CONCLUIDA', 'mais recentes', 8),
    u.perfil === 'DEMANDANTE' ? el('label', { class: 'campo--check' }, (() => {
      const c = el('input', { type: 'checkbox', checked: filtro.mostrarEncerradas });
      c.addEventListener('change', () => { filtro.mostrarEncerradas = c.checked; telaAgenda(raiz, ctx); });
      return c;
    })(), el('span', { text: 'Mostrar pedidos cancelados' })) : null,
    filtro.mostrarEncerradas ? secao('CANCELADA') : null);
}
