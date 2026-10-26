// Agenda da semana (segunda a sexta). Computador: 5 colunas. Celular: um dia por vez (chips com os dias).
// Remanejar é sempre por toque na atividade → "Remanejar" (sem arrastar: WCAG 2.2, 2.5.7 exige alternativa a arrastar).
import { el, hojeISO, semanaISO, deslocarSemana, fmtData, preencher } from './util.js';
import { estado } from './store.js';
import { ocorrencias, colaboradores, carga, periodoSemana, ehFeriado, regras, versaoAtual, PERIODICIDADES, UTDS, dataCurta, hhmm, DIA_CURTO } from './dominio.js';
import { cartaoOcorrencia, abrirDemanda, rotuloPessoa } from './ui.js';
import { logar } from './auditoria.js';

// Estado da tela é por usuário: trocar de login no mesmo aparelho começa do zero (aba, filtros, importação).
const inicial = () => ({ semana: null, pessoa: null, utd: '', dia: null, usuario: estado.usuario?.id });
let st = inicial();

/** Pessoas que o perfil pode ver na agenda (segregação por UTD). */
function pessoasVisiveis() {
  const u = estado.usuario;
  if (u.perfil === 'COLABORADOR') return [u];
  return colaboradores(estado.dados).filter((x) => u.perfil !== 'SUPERVISOR' || x.utd === u.utd);
}

export function telaAgenda(raiz, ctx, extra = {}) {
  if (st.usuario !== estado.usuario.id) st = inicial();
  const d = estado.dados, u = estado.usuario, hoje = hojeISO();
  st.semana ||= semanaISO(hoje);
  if (extra.pessoa) st.pessoa = extra.pessoa;
  const todas = pessoasVisiveis();
  const filtradas = todas.filter((x) => !st.utd || x.utd === st.utd);
  if (!filtradas.some((x) => x.id === st.pessoa)) st.pessoa = filtradas[0]?.id || null;
  const pessoa = todas.find((x) => x.id === st.pessoa);
  const per = periodoSemana(st.semana);
  if (!st.dia || !per.dias.includes(st.dia)) st.dia = per.dias.includes(hoje) ? hoje : per.dias[0];

  const rerender = () => telaAgenda(raiz, ctx);
  const mudarSemana = (n) => { st.semana = n === 0 ? semanaISO(hoje) : deslocarSemana(st.semana, n); st.dia = null; logar({ categoria: 'NAVEGACAO', acao: 'AGENDA_SEMANA', detalhe: { semana: st.semana } }); rerender(); };
  const seletores = [];
  if (u.perfil === 'GESTOR') {
    const s = el('select', { class: 'campo__input', 'aria-label': 'UTD' }, el('option', { value: '', text: 'Todas as UTDs' }), Object.entries(UTDS).map(([k, t]) => el('option', { value: k, text: t, selected: st.utd === k })));
    s.addEventListener('change', () => { st.utd = s.value; rerender(); });
    seletores.push(s);
  }
  if (u.perfil !== 'COLABORADOR') {
    const s = el('select', { class: 'campo__input', 'aria-label': 'Pessoa' }, filtradas.map((x) => el('option', { value: x.id, text: rotuloPessoa(x), selected: x.id === st.pessoa })));
    s.addEventListener('change', () => { st.pessoa = s.value; logar({ categoria: 'LEITURA', acao: 'AGENDA_PESSOA', entidade: 'usuario', entidadeId: s.value }); rerender(); });
    seletores.push(s);
  }

  const topo = el('header', { class: 'tela__topo' }, el('h1', { text: 'Agenda' }),
    el('span', { class: 'muted', text: pessoa ? rotuloPessoa(pessoa) : 'Sem pessoas cadastradas na ocupação' }));
  const nav = el('div', { class: 'semana-nav' },
    el('button', { type: 'button', class: 'btn btn--sec', 'aria-label': 'Semana anterior', text: '‹', onclick: () => mudarSemana(-1) }),
    el('span', { class: 'semana-nav__txt', text: `${fmtData(per.dias[0])} a ${fmtData(per.dias[4])}` }),
    el('button', { type: 'button', class: 'btn btn--sec', 'aria-label': 'Próxima semana', text: '›', onclick: () => mudarSemana(1) }),
    st.semana !== semanaISO(hoje) ? el('button', { type: 'button', class: 'btn btn--txt', text: 'Esta semana', onclick: () => mudarSemana(0) }) : null);
  if (!pessoa) { preencher(raiz, topo, el('div', { class: 'filtros' }, ...seletores), el('p', { class: 'vazio', text: 'Ninguém da retaguarda com cargo e UTD cadastrados neste filtro.' })); return; }

  const lista = ocorrencias(d, { ini: per.ini, fim: per.fim, usuarios: [pessoa], hoje });
  const cap = regras(d).capacidadeDiariaMin;
  const c = carga(d, lista, st.semana);

  const chips = el('div', { class: 'agenda__dias', role: 'group', 'aria-label': 'Dia da semana' }, per.dias.map((x) => {
    const n = lista.filter((o) => o.data === x && o.status !== 'CONCLUIDA').length;
    return el('button', { type: 'button', class: `agenda__dia${x === st.dia ? ' ativo' : ''}${x === hoje ? ' agenda__dia--hoje' : ''}`, 'aria-pressed': String(x === st.dia), 'aria-label': `${dataCurta(x)}: ${n} pendente(s)`,
      onclick: () => { st.dia = x; rerender(); } },
    el('span', { text: DIA_CURTO[new Date(`${x}T12:00:00`).getDay()] }), el('strong', { text: x.slice(8) }), el('span', { class: 'agenda__n', text: ehFeriado(d, x) ? 'feriado' : n ? `${n}` : '✓' }));
  }));

  const grade = el('div', { class: 'semana-grade' }, per.dias.map((x) => {
    const doDia = lista.filter((o) => o.data === x);
    const min = doDia.reduce((t, o) => t + o.duracaoMin, 0);
    const feriado = regras(d).feriados.find((f) => f.data === x);
    const barra = el('span', { class: `uso__preench${min > cap ? ' estouro' : min > cap * 0.9 ? ' alerta' : ''}` });
    barra.style.width = `${Math.min(100, Math.round((min / cap) * 100))}%`;
    return el('section', { class: `dia-col${x === st.dia ? ' dia-col--sel' : ''}${x === hoje ? ' dia-col--hoje' : ''}`, 'aria-label': dataCurta(x) },
      el('div', { class: 'dia-col__cab' }, el('strong', { text: dataCurta(x) }),
        el('span', { class: `pequeno${min > cap ? ' txt-alerta' : ' muted'}`, text: `${hhmm(min)} de ${hhmm(cap)}${min > cap ? ' ⚠' : ''}` }),
        el('span', { class: 'uso__trilho', 'aria-hidden': 'true' }, barra)),
      feriado ? el('p', { class: 'etiqueta etiqueta--alerta', text: `Feriado: ${feriado.nome}` }) : null,
      doDia.length ? el('div', { class: 'oc-lista' }, doDia.map((o) => cartaoOcorrencia(o))) : el('p', { class: 'muted pequeno', text: feriado ? 'A rotina semanal desliza para o próximo dia útil.' : 'Sem atividades.' }));
  }));

  // Fora da agenda: sob demanda e transferências (não entram na aderência).
  const vig = d.atividades.map((a) => ({ a, v: versaoAtual(a) })).filter(({ v }) => v.cargo === pessoa.cargo);
  const sob = vig.filter(({ v }) => v.situacao === 'S');
  const transf = vig.filter(({ v }) => v.situacao === 'T');
  const legenda = el('p', { class: 'legenda-agenda pequeno muted' }, 'Sigla no canto do cartão: ', Object.entries(PERIODICIDADES).filter(([k]) => k !== 'S').map(([, p]) => `${p.sigla} = ${p.nome.toLowerCase()}`).join(' · '), '. Carga da semana: ',
    el('strong', { class: c.pct > 1 ? 'txt-alerta' : '', text: `${hhmm(c.min)} de ${hhmm(c.cap)} (${Math.round(c.pct * 100)}%)` }));

  preencher(raiz, topo, seletores.length ? el('div', { class: 'filtros' }, ...seletores) : null, nav, chips, grade, legenda,
    el('div', { class: 'grade-2' },
      el('details', { class: 'bloco' }, el('summary', { class: 'resumo-det', text: `Sob demanda do cargo (${sob.length})` }),
        el('p', { class: 'pequeno muted', text: 'Não entram na agenda nem na aderência. Registre quando acontecer para medir o esforço.' }),
        el('ul', { class: 'lista' }, sob.map(({ v }) => el('li', { class: 'lista__item', text: v.nome }))),
        u.perfil === 'COLABORADOR' ? el('button', { type: 'button', class: 'btn btn--sec', text: 'Registrar sob demanda', onclick: abrirDemanda }) : null),
      el('details', { class: 'bloco' }, el('summary', { class: 'resumo-det', text: `Marcadas para transferência (${transf.length})` }),
        el('p', { class: 'pequeno muted', text: 'Sem aceite da área destino, continuam na agenda (cartão "em transferência"). Com aceite, saem a partir da data efetiva.' }),
        el('ul', { class: 'lista' }, transf.map(({ a, v }) => el('li', { class: 'lista__item' }, el('span', { text: v.nome }),
          el('span', { class: 'pequeno muted', text: a.aceite ? `aceite: sai em ${fmtData(a.aceite.desde)}` : `→ ${v.destino} · sem aceite` })))))));
}
