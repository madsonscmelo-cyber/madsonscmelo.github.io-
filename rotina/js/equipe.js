// Equipe (supervisor, gerência e auditoria): aderência por pessoa, fila de aprovações, ocupação dos cargos e sob demanda.
import { el, hojeISO, semanaISO, deslocarSemana, fmtData, fmtPct, csvStringify, baixarArquivo, toast, preencher, anexar } from './util.js';
import { estado, nomeUsuario } from './store.js';
import { ocorrencias, colaboradores, indicadores, carga, periodoSemana, pedidosPendentes, MOTIVOS_REMANEJAMENTO, CARGOS, UTDS, dataCurta, hhmm } from './dominio.js';
import { decidirPedido, definirOcupacao, podeGerirUtd } from './acoes.js';
import { abrirOcorrencia, abrirSheet, fecharSheet, tratar } from './ui.js';
import { logar } from './auditoria.js';

const META_ADERENCIA = 0.9;
// Estado da tela é por usuário: trocar de login no mesmo aparelho começa do zero (aba, filtros, importação).
const inicial = () => ({ aba: 'aderencia', semana: null, utd: '', usuario: estado.usuario?.id });
let st = inicial();

function escopo() {
  const u = estado.usuario;
  return colaboradores(estado.dados).filter((x) => (u.perfil === 'SUPERVISOR' ? x.utd === u.utd : !st.utd || x.utd === st.utd));
}

export function telaEquipe(raiz, ctx, extra = {}) {
  if (st.usuario !== estado.usuario.id) st = inicial();
  const u = estado.usuario;
  if (extra.aba) st.aba = extra.aba;
  st.semana ||= semanaISO(hojeISO());
  const pessoas = escopo();
  const nPedidos = pedidosPendentes(estado.dados).filter((o) => pessoas.some((p) => p.id === o.usuarioId)).length;
  const abas = [['aderencia', 'Aderência'], ['aprovacoes', 'Aprovações', nPedidos], ['ocupacao', 'Ocupação'], ['demanda', 'Sob demanda']];
  const rerender = () => telaEquipe(raiz, ctx);
  const filtroUtd = u.perfil === 'SUPERVISOR' ? null : (() => {
    const s = el('select', { class: 'campo__input', 'aria-label': 'UTD' }, el('option', { value: '', text: 'Todas as UTDs' }), Object.entries(UTDS).map(([k, t]) => el('option', { value: k, text: t, selected: st.utd === k })));
    s.addEventListener('change', () => { st.utd = s.value; logar({ categoria: 'NAVEGACAO', acao: 'FILTRO_UTD', detalhe: { utd: s.value } }); rerender(); });
    return s;
  })();
  const corpo = el('div', { class: 'painel-aba' });
  preencher(raiz, 
    el('header', { class: 'tela__topo' }, el('h1', { text: 'Equipe' }), el('span', { class: 'muted', text: u.perfil === 'SUPERVISOR' ? `UTD ${UTDS[u.utd]}` : st.utd ? `UTD ${UTDS[st.utd]}` : 'Todas as UTDs' })),
    filtroUtd ? el('div', { class: 'filtros' }, filtroUtd) : null,
    el('div', { class: 'abas abas--rolavel', role: 'tablist' }, abas.map(([id, t, n]) => el('button', {
      type: 'button', role: 'tab', 'aria-selected': String(st.aba === id), class: `abas__btn${st.aba === id ? ' ativo' : ''}`,
      onclick: () => { st.aba = id; logar({ categoria: 'NAVEGACAO', acao: 'ABA_EQUIPE', detalhe: { aba: id } }); rerender(); },
    }, t, n ? el('span', { class: 'abas__n', text: String(n) }) : null))),
    corpo);
  if (st.aba === 'aderencia') abaAderencia(corpo, pessoas, rerender, ctx);
  else if (st.aba === 'aprovacoes') abaAprovacoes(corpo, pessoas, rerender);
  else if (st.aba === 'ocupacao') abaOcupacao(corpo, rerender);
  else abaDemanda(corpo, pessoas);
}

function abaAderencia(corpo, pessoas, rerender, ctx) {
  const d = estado.dados, hoje = hojeISO();
  let per = periodoSemana(st.semana), lista = ocorrencias(d, { ini: per.ini, fim: per.fim, usuarios: pessoas, hoje }), ind = indicadores(lista, hoje);
  // Primeira abertura no início da semana (ainda sem base): mostra a semana passada, que já tem resultado.
  if (!st.semanaEscolhida && !ind.programadas) {
    st.semana = deslocarSemana(st.semana, -1);
    per = periodoSemana(st.semana); lista = ocorrencias(d, { ini: per.ini, fim: per.fim, usuarios: pessoas, hoje }); ind = indicadores(lista, hoje);
  }
  st.semanaEscolhida = true;
  const variasUtds = new Set(pessoas.map((p) => p.utd)).size > 1;
  const linhas = pessoas.map((p) => {
    const l = lista.filter((o) => o.usuarioId === p.id);
    return { p, i: indicadores(l, hoje), c: carga(d, l, st.semana) };
  }).sort((a, b) => (a.i.aderencia ?? 2) - (b.i.aderencia ?? 2));
  const mudar = (n) => { st.semana = n === 0 ? semanaISO(hoje) : deslocarSemana(st.semana, n); rerender(); };
  const kpi = (rotulo, valor, det, ruim) => el('div', { class: `kpi${ruim ? ' kpi--alerta' : ''}` }, el('span', { class: 'kpi__rotulo', text: rotulo }), el('strong', { class: 'kpi__valor', text: valor }), el('span', { class: 'kpi__det', text: det }));
  const pct = (v) => (v === null ? '—' : fmtPct(v));
  anexar(corpo, 
    el('div', { class: 'semana-nav' },
      el('button', { type: 'button', class: 'btn btn--sec', 'aria-label': 'Semana anterior', text: '‹', onclick: () => mudar(-1) }),
      el('span', { class: 'semana-nav__txt', text: `${fmtData(per.dias[0])} a ${fmtData(per.dias[4])}` }),
      el('button', { type: 'button', class: 'btn btn--sec', 'aria-label': 'Próxima semana', text: '›', onclick: () => mudar(1) }),
      st.semana !== semanaISO(hoje) ? el('button', { type: 'button', class: 'btn btn--txt', text: 'Esta semana', onclick: () => mudar(0) }) : null),
    // Miller: 4 indicadores; só ganha cor o que está fora da meta (Von Restorff).
    el('div', { class: 'kpis kpis--2x2' },
      kpi('Aderência', pct(ind.aderencia), `${ind.noPrazo} de ${ind.programadas} na data original · meta ${fmtPct(META_ADERENCIA)}`, ind.aderencia !== null && ind.aderencia < META_ADERENCIA),
      kpi('Cumprimento', pct(ind.cumprimento), `${ind.concluidas} concluídas, inclusive remanejadas`),
      kpi('Remanejadas', String(ind.remanejadas), `${ind.aguardando} aguardando supervisor`),
      kpi('Atrasadas', String(ind.atrasadas), 'não concluídas e com data vencida', ind.atrasadas > 0)),
    el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['Pessoa', 'Cargo', variasUtds ? 'UTD' : null, 'Programadas', 'Aderência', 'Cumprimento', 'Remanejadas', 'Atrasadas', 'Carga'].filter(Boolean).map((h) => el('th', { text: h })))),
      el('tbody', {}, linhas.map(({ p, i, c }) => el('tr', { class: i.aderencia !== null && i.aderencia < META_ADERENCIA ? 'tr--alerta' : '' },
        el('td', {}, el('button', { type: 'button', class: 'btn btn--txt', text: p.nome, onclick: () => { logar({ categoria: 'LEITURA', acao: 'AGENDA_PESSOA', entidade: 'usuario', entidadeId: p.id }); ctx.irPara('agenda', { pessoa: p.id }); } })),
        el('td', { text: CARGOS[p.cargo] }), variasUtds ? el('td', { text: UTDS[p.utd] }) : null, el('td', { class: 'num', text: String(i.programadas) }),
        el('td', { class: 'num', text: `${pct(i.aderencia)}${i.aderencia !== null && i.aderencia < META_ADERENCIA ? ' ⚠' : ''}` }), el('td', { class: 'num', text: pct(i.cumprimento) }),
        el('td', { class: 'num', text: String(i.remanejadas) }), el('td', { class: 'num', text: String(i.atrasadas) }),
        el('td', { class: `num${c.pct > 1 ? ' txt-alerta' : ''}`, text: `${Math.round(c.pct * 100)}%${c.pct > 1 ? ' ⚠' : ''}` })))))),
    el('p', { class: 'pequeno muted', text: 'Aderência = concluídas na data original, sem remanejamento ÷ programadas até ontem (mais as de hoje já concluídas). Cumprimento inclui as remanejadas e as feitas com atraso. Carga = minutos programados na semana ÷ capacidade (8h48 por dia útil).' }),
    el('button', { type: 'button', class: 'btn btn--sec', text: 'Exportar CSV', onclick: () => {
      logar({ categoria: 'EXPORTACAO', acao: 'ADERENCIA_EXPORTADA', detalhe: { semana: st.semana, pessoas: linhas.length } });
      baixarArquivo(`aderencia-${st.semana}.csv`, csvStringify([['semana', 'pessoa', 'cargo', 'utd', 'programadas', 'no_prazo', 'concluidas', 'aderencia', 'cumprimento', 'remanejadas', 'atrasadas', 'carga_min', 'capacidade_min'],
        ...linhas.map(({ p, i, c }) => [st.semana, p.nome, CARGOS[p.cargo], UTDS[p.utd], i.programadas, i.noPrazo, i.concluidas, pct(i.aderencia), pct(i.cumprimento), i.remanejadas, i.atrasadas, c.min, c.cap])]));
    } }));
}

function abaAprovacoes(corpo, pessoas) {
  const u = estado.usuario;
  const pend = pedidosPendentes(estado.dados).filter((o) => pessoas.some((p) => p.id === o.usuarioId));
  if (!pend.length) { anexar(corpo, el('p', { class: 'vazio', text: 'Nenhum pedido de remanejamento aguardando decisão.' })); return; }
  anexar(corpo, el('p', { class: 'pequeno muted', text: 'Pedidos fora da janela da periodicidade ou a partir do 2º remanejamento. Ninguém aprova o próprio pedido.' }),
    el('ul', { class: 'lista lista--pedidos' }, pend.map((o) => {
      const p = o.exec.pedido, proprio = p.por === u.id, pode = podeGerirUtd(o.utd) && !proprio;
      return el('li', { class: 'pedido' },
        el('div', { class: 'pedido__txt' },
          el('strong', { text: o.nome }),
          el('span', { text: `${nomeUsuario(o.usuarioId)} · ${dataCurta(o.data)} → ${dataCurta(p.para)}` }),
          el('span', { class: 'pequeno muted', text: `${MOTIVOS_REMANEJAMENTO[p.motivo]}${p.texto ? ` — ${p.texto}` : ''}` }),
          el('span', { class: 'pequeno muted', text: `Precisa de aprovação: ${p.motivosAprovacao.join('; ')}` })),
        el('div', { class: 'linha' },
          pode ? el('button', { type: 'button', class: 'btn', text: 'Aprovar', onclick: () => { if (tratar(() => decidirPedido(o.chave, true))) toast('Aprovado.', { tipo: 'ok' }); } }) : null,
          el('button', { type: 'button', class: 'btn btn--sec', text: pode ? 'Ver / recusar' : 'Ver', onclick: () => abrirOcorrencia(o.chave) }),
          proprio ? el('span', { class: 'etiqueta', text: 'seu pedido: aguarda a gerência' }) : null));
    })));
}

function abaOcupacao(corpo, rerender) {
  const d = estado.dados, u = estado.usuario, pode = ['GESTOR', 'ADMIN'].includes(u.perfil);
  const utds = u.perfil === 'SUPERVISOR' ? [u.utd] : st.utd ? [st.utd] : Object.keys(UTDS);
  anexar(corpo, el('p', { class: 'pequeno muted', text: 'Quem ocupa cada cargo em cada UTD. É o que transforma a agenda do cargo em agenda individual. Mudança fica no log.' }),
    el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['UTD', ...Object.values(CARGOS)].map((h) => el('th', { text: h })))),
      el('tbody', {}, utds.map((utd) => el('tr', {}, el('th', { scope: 'row', text: UTDS[utd] }), Object.keys(CARGOS).map((c) => {
        const ocup = d.usuarios.filter((x) => x.perfil === 'COLABORADOR' && x.utd === utd && x.cargo === c);
        return el('td', {}, ocup.length ? ocup.map((x) => pode
          ? el('button', { type: 'button', class: 'btn btn--txt', text: x.nome, 'aria-label': `Alterar ocupação de ${x.nome}`, onclick: () => abrirOcupacao(x, rerender) })
          : el('span', { text: x.nome })) : el('span', { class: 'txt-alerta', text: 'vago ⚠' }));
      })))))));
}

function abrirOcupacao(x, rerender) {
  const utd = el('select', { class: 'campo__input' }, Object.entries(UTDS).map(([k, t]) => el('option', { value: k, text: t, selected: x.utd === k })));
  const cargo = el('select', { class: 'campo__input' }, Object.entries(CARGOS).map(([k, t]) => el('option', { value: k, text: t, selected: x.cargo === k })));
  abrirSheet(`Ocupação: ${x.nome}`, el('div', { class: 'form' },
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'UTD' }), utd),
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Cargo' }), cargo),
    el('p', { class: 'pequeno muted', text: 'A agenda da pessoa passa a ser a do novo cargo a partir de agora. O histórico já concluído fica como está.' })),
  { tipo: 'ocupacao' }, el('button', { type: 'button', class: 'btn btn--grande', text: 'Salvar', onclick: () => {
    if (tratar(() => definirOcupacao(x.id, { utd: utd.value, cargo: cargo.value }))) { toast('Ocupação alterada.', { tipo: 'ok' }); fecharSheet(); rerender(); }
  } }));
}

function abaDemanda(corpo, pessoas) {
  const d = estado.dados;
  const regs = d.demandas.filter((r) => pessoas.some((p) => p.id === r.usuarioId)).sort((a, b) => (a.data < b.data ? 1 : -1));
  const total = regs.reduce((t, r) => t + r.duracaoMin, 0);
  anexar(corpo, el('p', { class: 'resumo', text: `${regs.length} registro(s) · ${hhmm(total)} fora da rotina` }),
    regs.length ? el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['Data', 'Pessoa', 'Atividade', 'Minutos', 'Descrição'].map((h) => el('th', { text: h })))),
      el('tbody', {}, regs.map((r) => el('tr', {}, el('td', { text: fmtData(r.data) }), el('td', { text: nomeUsuario(r.usuarioId) }),
        el('td', { text: d.atividades.find((a) => a.id === r.atvId)?.versoes.at(-1).nome || '—' }), el('td', { class: 'num', text: String(r.duracaoMin) }), el('td', { text: r.descricao }))))))
      : el('p', { class: 'vazio', text: 'Nenhum registro sob demanda.' }));
}
