// Tela Programação: carteira priorizada → quadro semanal por equipe, com custo × orçamento, capacidade,
// congelamento da semana e aderência (executado conforme o congelado).
import { el, toast, fmtData, fmtMoeda, fmtPct, hojeISO, proximoDiaUtil, semanaISO, diasDaSemana, deslocarSemana, diasEntre, csvStringify, baixarArquivo } from './util.js';
import { estado, ativoPorId, nomeEquipe, nomeUsuario } from './store.js';
import { tipoDefeito, scoreRisco, faixaRisco, equipesAptas, CATEGORIAS, TIPOS_EQUIPE, PARAM, SEVERIDADES } from './dominio.js';
import { custoDefeito, horasDefeito, orcamentoDoMes, impactoNoOrcamento, projecaoCarteira, mesDe, categoriaDe } from './custos.js';
import { programarDefeito, congelarSemana, congelamento, ErroRegra } from './acoes.js';
import { valor } from './parametros.js';
import { abrirSheet, fecharSheet } from './ui.js';
import { logar } from './auditoria.js';

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const estadoTela = { semana: null, sev: '', categoria: '', dia: null };
const pode = () => ['GESTOR', 'SUPERVISOR'].includes(estado.usuario.perfil);
const mesNome = (mes) => new Date(`${mes}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

function tratar(fn) {
  try { fn(); return true; } catch (e) {
    toast(e instanceof ErroRegra ? e.message : 'Não foi possível concluir.', { tipo: 'erro' });
    if (!(e instanceof ErroRegra)) console.error(e);
    return false;
  }
}

/** Aderência de uma semana congelada: executado até a data e pela equipe congeladas ÷ itens já vencidos. */
export function aderenciaSemana(semana, ref = hojeISO()) {
  const c = congelamento(semana);
  if (!c) return null;
  const porId = new Map(estado.dados.defeitos.map((f) => [f.id, f]));
  let vencidos = 0, conformes = 0;
  const motivos = {};
  for (const i of c.itens) {
    const f = porId.get(i.defeitoId);
    if (!f) continue;
    const exec = f.execucao;
    const ok = exec && exec.em.slice(0, 10) <= i.data && exec.equipeId === i.equipeId;
    if (i.data >= ref && !ok) continue; // ainda no prazo
    vencidos++;
    if (ok) conformes++;
    else {
      const m = (f.reprogramacoes || []).filter((r) => r.de.data === i.data && r.congelada).at(-1)?.motivo;
      const nome = m ? (valor('motivos').find((x) => x.id === m)?.nome || m) : exec ? 'Executado fora da data/equipe' : 'Não executado, sem motivo';
      motivos[nome] = (motivos[nome] || 0) + 1;
    }
  }
  return { semana, itens: c.itens.length, vencidos, conformes, pct: vencidos ? conformes / vencidos : null, motivos, custo: c.itens.reduce((s, i) => s + (i.custo || 0), 0) };
}

/** Aderência acumulada das últimas N semanas congeladas (para o funil do Painel). */
export function aderenciaUltimas(n = 6) {
  const ult = Object.keys(estado.dados.congelamentos || {}).sort().slice(-n).map((s) => aderenciaSemana(s)).filter((x) => x?.vencidos);
  const v = ult.reduce((t, x) => t + x.vencidos, 0), c = ult.reduce((t, x) => t + x.conformes, 0);
  return v ? c / v : null;
}

/** Prazo dos críticos (SLA): defeitos A executados em até N dias da identificação. */
export function slaCriticos(ref = hojeISO()) {
  const as = estado.dados.defeitos.filter((f) => f.severidade === 'A' && !['REJEITADO', 'CANCELADO'].includes(f.status));
  let noPrazo = 0, vencidos = 0;
  for (const f of as) {
    const limite = PARAM.sla.A;
    if (f.execucao) { if (diasEntre(f.criadoEm, f.execucao.em) <= limite) noPrazo++; else vencidos++; }
    else if (diasEntre(f.criadoEm, ref) > limite) vencidos++;
  }
  const base = noPrazo + vencidos;
  return { noPrazo, vencidos, pct: base ? noPrazo / base : null, prazo: PARAM.sla.A };
}

// ---------- Tela ----------
export function telaProgramacao(raiz, { abrirNoMapa }) {
  const d = estado.dados;
  // No fim de semana, abre já na semana seguinte (é a que está sendo programada).
  estadoTela.semana ||= semanaISO([0, 6].includes(new Date().getDay()) ? proximoDiaUtil() : hojeISO());
  const semana = estadoTela.semana, dias = diasDaSemana(semana);
  const uteis = dias.slice(0, PARAM.diasUteisSemana);
  const cong = congelamento(semana);
  const rerender = () => telaProgramacao(raiz, { abrirNoMapa });

  // Cabeçalho da semana
  const nav = el('div', { class: 'semana-nav' },
    el('button', { type: 'button', class: 'btn btn--sec', text: '◀', 'aria-label': 'Semana anterior', onclick: () => { estadoTela.semana = deslocarSemana(semana, -1); rerender(); } }),
    el('div', { class: 'semana-nav__txt' }, el('strong', { text: `Semana ${semana.split('-W')[1]}` }), el('span', { class: 'muted', text: `${fmtData(dias[0])} a ${fmtData(dias[6])}` })),
    el('button', { type: 'button', class: 'btn btn--sec', text: '▶', 'aria-label': 'Próxima semana', onclick: () => { estadoTela.semana = deslocarSemana(semana, 1); rerender(); } }),
    cong ? el('span', { class: 'chip chip--congelada', text: `🔒 Congelada ${fmtData(cong.em)} por ${nomeUsuario(cong.por)}` })
      : pode() ? el('button', { type: 'button', class: 'btn', text: '🔒 Congelar programação da semana', onclick: () => {
        if (!confirm('Congelar a programação desta semana? A aderência passa a ser medida contra esta versão, e mudanças exigirão motivo.')) return;
        if (tratar(() => congelarSemana(semana))) toast('Programação congelada.', { tipo: 'ok' });
      } }) : null);

  // Orçamento do mês da semana (mês da segunda-feira)
  const mes = mesDe(dias[0]);
  const orc = orcamentoDoMes(mes);
  const orcBox = el('section', { class: 'bloco' }, el('h2', { text: `Orçamento de ${mesNome(mes)}` }),
    el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela tabela--orc' },
      el('thead', {}, el('tr', {}, ['Categoria', 'Orçado', 'Realizado', 'Programado', 'Saldo', 'Uso'].map((h) => el('th', { text: h })))),
      el('tbody', {}, [...orc.linhas, { categoria: 'TOTAL', ...orc.total }].map((l) => {
        const uso = l.orcado ? (l.realizado + l.comprometido) / l.orcado : (l.realizado + l.comprometido) ? 2 : 0;
        const barra = el('span', { class: `uso__preench ${uso > 1 ? 'estouro' : uso > 0.85 ? 'alerta' : ''}` });
        barra.style.width = `${Math.min(100, uso * 100)}%`;
        return el('tr', { class: `${l.categoria === 'TOTAL' ? 'tr--total' : ''} ${l.saldo < 0 ? 'tr--negado' : ''}` },
          el('td', { text: CATEGORIAS[l.categoria] || 'Total' }), el('td', { text: fmtMoeda(l.orcado) }), el('td', { text: fmtMoeda(l.realizado) }),
          el('td', { text: fmtMoeda(l.comprometido) }), el('td', { class: l.saldo < 0 ? 'txt-alerta' : '', text: fmtMoeda(l.saldo) }),
          el('td', {}, el('span', { class: 'uso' }, el('span', { class: 'uso__trilho' }, barra), el('span', { class: 'pequeno', text: fmtPct(uso) }))));
      })))),
    el('p', { class: 'muted pequeno', text: 'Programado = custo-padrão (caderno × composição × fator regional) do que está programado no mês e ainda não foi executado. Realizado = custo registrado na execução.' }));

  // Carteira a programar (validados), priorizada por risco
  const aptasPorDefeito = (f) => equipesAptas(d, f).filter((e) => e.tipo !== 'INSPECAO');
  let carteira = d.defeitos.filter((f) => f.status === 'VALIDADO')
    .map((f) => ({ f, a: ativoPorId(f.ativoId), s: scoreRisco(f, ativoPorId(f.ativoId)).total, c: custoDefeito(f), h: horasDefeito(f) }))
    .sort((x, y) => y.s - x.s);
  if (estadoTela.sev) carteira = carteira.filter((x) => x.f.severidade === estadoTela.sev);
  if (estadoTela.categoria) carteira = carteira.filter((x) => categoriaDe(x.f) === estadoTela.categoria);
  const filtroSel = (chave, ops) => {
    const s = el('select', { class: 'campo__input', 'aria-label': chave }, ops.map(([v, t]) => el('option', { value: v, text: t, selected: estadoTela[chave] === v })));
    s.addEventListener('change', () => { estadoTela[chave] = s.value; rerender(); });
    return s;
  };
  const carteiraBox = el('section', { class: 'bloco' },
    el('h2', { text: `Carteira a programar (${carteira.length}) · ${fmtMoeda(carteira.reduce((t, x) => t + x.c.total, 0))}` }),
    el('div', { class: 'filtros' }, filtroSel('sev', [['', 'Todas severidades'], ...Object.entries(SEVERIDADES)]), filtroSel('categoria', [['', 'Todas categorias'], ...Object.entries(CATEGORIAS)])),
    carteira.length ? el('div', { class: 'carteira' }, carteira.map(({ f, a, s, c, h }) => {
      const td = tipoDefeito(f.tipoId);
      const aptas = aptasPorDefeito(f);
      const selEq = el('select', { class: 'campo__input', 'aria-label': 'Equipe' }, aptas.map((e) => el('option', { value: e.id, text: `${e.nome}${e.disponivel ? '' : ' (indisp.)'}` })));
      const selDia = el('select', { class: 'campo__input', 'aria-label': 'Dia' }, uteis.map((dia, i) => el('option', { value: dia, text: `${DIAS[i]} ${fmtData(dia).slice(0, 5)}`, disabled: dia < hojeISO() })));
      const primeiroValido = uteis.find((x) => x >= hojeISO());
      if (primeiroValido) selDia.value = primeiroValido;
      return el('article', { class: `item-carteira card-def--${faixaRisco(s).id}` },
        el('div', { class: 'item-carteira__topo' }, el('span', { class: `score score--${faixaRisco(s).id}`, text: s }),
          el('div', { class: 'card-def__tit' }, el('strong', { text: td?.nome }),
            el('span', { class: 'muted pequeno', text: `${a?.codigo} · ${a?.alimentador} · Sev. ${f.severidade}${c.unidade !== 'un' ? ` · ${c.quantidade} ${c.unidade}` : ''} · ${diasEntre(f.criadoEm, hojeISO())} dia(s)` })),
          el('div', { class: 'item-carteira__custo' }, el('strong', { text: fmtMoeda(c.total) }), el('span', { class: 'muted pequeno', text: `${h.toFixed(1)} h` }))),
        pode() && !cong ? el('div', { class: 'linha' }, selEq, selDia,
          el('button', { type: 'button', class: 'btn', text: 'Programar', disabled: !aptas.length || !primeiroValido, onclick: () => {
            const imp = impactoNoOrcamento(f, selDia.value);
            if (imp.estoura && !confirm(`Orçamento de ${CATEGORIAS[imp.categoria]} em ${mesNome(imp.mes)}: saldo ${fmtMoeda(imp.saldoAntes)} → ${fmtMoeda(imp.saldoDepois)} após programar ${fmtMoeda(imp.custo)}.\n\nProgramar mesmo assim? (fica registrado no log)`)) return;
            if (tratar(() => programarDefeito(f, { equipeId: selEq.value, data: selDia.value }))) {
              if (imp.estoura) logar({ categoria: 'ESCRITA', acao: 'ORCAMENTO_EXCEDIDO_CIENTE', entidade: 'defeito', entidadeId: f.id, detalhe: { categoria: imp.categoria, mes: imp.mes, saldoDepois: imp.saldoDepois } });
              toast(`Programado: ${td?.nome} · ${fmtMoeda(c.total)}`, { tipo: 'ok' });
            }
          } }),
          el('button', { type: 'button', class: 'btn btn--txt', text: 'Mapa', onclick: () => abrirNoMapa(a.id) }))
          : cong ? el('p', { class: 'muted pequeno', text: 'Semana congelada: programe na próxima semana ou reprograme um item com motivo.' }) : null);
    })) : el('p', { class: 'muted', text: 'Nenhum defeito validado aguardando programação.' }));

  // Quadro semanal por equipe
  const programados = d.defeitos.filter((f) => f.programacao?.semana === semana && ['PROGRAMADO', 'EXECUTADO', 'VERIFICADO'].includes(f.status));
  const equipes = d.equipes.filter((e) => e.tipo !== 'INSPECAO');
  const cap = PARAM.horasDiaEquipe * PARAM.diasUteisSemana;
  const quadro = el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela quadro' },
    el('thead', {}, el('tr', {}, el('th', { text: 'Equipe' }), ...uteis.map((dia, i) => el('th', { class: dia === hojeISO() ? 'hoje' : '', text: `${DIAS[i]} ${fmtData(dia).slice(0, 5)}` })), el('th', { text: 'Ocupação' }), el('th', { text: 'Custo' }))),
    el('tbody', {}, equipes.map((e) => {
      const meus = programados.filter((f) => f.programacao.equipeId === e.id);
      const horas = meus.reduce((t, f) => t + horasDefeito(f), 0);
      const custo = meus.reduce((t, f) => t + (f.execucao?.custo?.total ?? custoDefeito(f).total), 0);
      const oc = horas / cap;
      return el('tr', {},
        el('th', { scope: 'row' }, el('div', {}, el('strong', { text: e.nome }), el('div', { class: 'muted pequeno', text: `${TIPOS_EQUIPE[e.tipo]}${e.disponivel ? '' : ' · indisponível'}` }))),
        ...uteis.map((dia) => el('td', { class: dia === hojeISO() ? 'hoje' : '' }, meus.filter((f) => f.programacao.data === dia).map((f) => {
          const feito = !!f.execucao;
          return el('button', { type: 'button', class: `ativ ativ--${f.severidade}${feito ? ' ativ--feita' : ''}`, title: `${tipoDefeito(f.tipoId)?.nome} · ${ativoPorId(f.ativoId)?.codigo}`,
            onclick: () => abrirItem(f, { semana, abrirNoMapa, uteis }) },
            el('span', { text: `${feito ? '✓ ' : ''}${ativoPorId(f.ativoId)?.codigo}` }), el('span', { class: 'ativ__det', text: `${tipoDefeito(f.tipoId)?.atividade || ''}` }));
        }))),
        el('td', { class: oc > 1 ? 'txt-alerta' : '', text: `${horas.toFixed(1)} / ${cap} h (${fmtPct(oc)})` }),
        el('td', { text: fmtMoeda(custo) }));
    }))));

  // Agenda por dia (celular): um dia por vez, lista por equipe. Mesmo conteúdo do quadro, sem rolar 7 colunas.
  if (!uteis.includes(estadoTela.dia)) estadoTela.dia = uteis.includes(hojeISO()) ? hojeISO() : uteis[0];
  const doDia = programados.filter((f) => f.programacao.data === estadoTela.dia);
  const agenda = el('div', { class: 'agenda' },
    el('div', { class: 'agenda__dias', role: 'tablist', 'aria-label': 'Dia da semana' }, uteis.map((dia, i) => {
      const n = programados.filter((f) => f.programacao.data === dia).length;
      return el('button', { type: 'button', role: 'tab', 'aria-selected': String(dia === estadoTela.dia), class: `agenda__dia${dia === estadoTela.dia ? ' ativo' : ''}${dia === hojeISO() ? ' agenda__dia--hoje' : ''}`,
        'aria-label': `${DIAS[i]} ${fmtData(dia)}: ${n} atividade(s)`, onclick: () => { estadoTela.dia = dia; rerender(); } },
        el('span', { text: DIAS[i] }), el('strong', { text: fmtData(dia).slice(0, 2) }), el('span', { class: 'agenda__n', text: n ? String(n) : '·' }));
    })),
    doDia.length ? el('div', { class: 'agenda__lista' }, equipes.filter((e) => doDia.some((f) => f.programacao.equipeId === e.id)).map((e) => el('section', { class: 'agenda__equipe' },
      el('h3', { text: `${e.nome} · ${TIPOS_EQUIPE[e.tipo]}` }),
      el('ul', { class: 'lista' }, doDia.filter((f) => f.programacao.equipeId === e.id).map((f) => el('li', {},
        el('button', { type: 'button', class: `ativ ativ--${f.severidade}${f.execucao ? ' ativ--feita' : ''} ativ--linha`, onclick: () => abrirItem(f, { semana, abrirNoMapa, uteis }) },
          el('span', { text: `${f.execucao ? '✓ ' : ''}${ativoPorId(f.ativoId)?.codigo} · sev. ${f.severidade}` }), el('span', { class: 'ativ__det', text: `${tipoDefeito(f.tipoId)?.nome} · ${horasDefeito(f).toFixed(1)} h · ${fmtMoeda(f.execucao?.custo?.total ?? custoDefeito(f).total)}` }))))))))
      : el('p', { class: 'muted', text: 'Nada programado neste dia.' }));

  // Indicadores
  const ad = aderenciaSemana(semana);
  const ultimas = Object.keys(d.congelamentos || {}).sort().slice(-6).map((s) => aderenciaSemana(s)).filter((x) => x?.vencidos);
  const motivosTot = {};
  ultimas.forEach((x) => Object.entries(x.motivos).forEach(([k, v]) => { motivosTot[k] = (motivosTot[k] || 0) + v; }));
  const sla = slaCriticos();
  const kpi = (r, v, det, c = '', etiqueta = null) => el('div', { class: `kpi ${c}` }, el('span', { class: 'kpi__rotulo', text: r }), el('strong', { class: 'kpi__valor', text: v }),
    etiqueta ? el('span', { class: 'etiqueta', text: etiqueta }) : null, el('span', { class: 'kpi__det', text: det }));
  const adGeral = ultimas.reduce((t, x) => ({ v: t.v + x.vencidos, c: t.c + x.conformes }), { v: 0, c: 0 });
  const proj = projecaoCarteira();
  const indicadores = el('div', { class: 'kpis' },
    // O número fica sempre no lugar do número; o estado da semana vira etiqueta.
    kpi('Aderência da semana', ad?.pct === null || !ad ? '—' : fmtPct(ad.pct), ad ? `${ad.conformes} de ${ad.vencidos} vencidos · ${ad.itens} no congelado` : 'congele para medir', ad && ad.pct !== null && ad.pct < PARAM.metas.aderenciaProgramacao ? 'kpi--alerta' : '',
      !cong ? '🔓 Semana não congelada' : ad?.pct === null ? '🔒 Em andamento' : null),
    kpi('Aderência (últimas semanas)', adGeral.v ? fmtPct(adGeral.c / adGeral.v) : '—', `${ultimas.length} semana(s) congelada(s) · meta ${fmtPct(PARAM.metas.aderenciaProgramacao)}`, adGeral.v && adGeral.c / adGeral.v < PARAM.metas.aderenciaProgramacao ? 'kpi--alerta' : ''),
    kpi(`Defeitos A em até ${sla.prazo} dias`, sla.pct === null ? '—' : fmtPct(sla.pct), `${sla.noPrazo} no prazo · ${sla.vencidos} fora`, sla.pct !== null && sla.pct < PARAM.metas.slaCriticos ? 'kpi--critico' : ''),
    kpi('Carteira sem data', fmtMoeda(proj.reduce((t, p) => t + p.valor, 0)), `${proj.reduce((t, p) => t + p.qtd, 0)} defeito(s) · críticos ${fmtMoeda(proj.reduce((t, p) => t + p.valorCriticos, 0))}`));

  const pareto = Object.entries(motivosTot).sort((a, b) => b[1] - a[1]);

  raiz.replaceChildren(
    el('header', { class: 'tela__topo' }, el('h1', { text: 'Programação' }),
      el('button', { type: 'button', class: 'btn btn--txt', text: 'Exportar semana (CSV)', onclick: () => exportarSemana(semana, programados) })),
    nav, indicadores, orcBox,
    el('section', { class: 'bloco' }, el('h2', { text: 'Quadro da semana' }), el('div', { class: 'so-celular' }, agenda), el('div', { class: 'so-computador' }, quadro),
      el('p', { class: 'muted pequeno', text: 'Toque numa atividade para reprogramar (com motivo, se a semana estiver congelada) ou abrir no mapa.' })),
    carteiraBox,
    pareto.length ? el('section', { class: 'bloco' }, el('h2', { text: 'Por que a programação não foi cumprida (últimas semanas congeladas)' }),
      el('ol', { class: 'pareto' }, pareto.map(([m, n]) => el('li', {}, el('span', { text: m }), el('strong', { text: n }))))) : null,
  );
}

function abrirItem(f, { semana, abrirNoMapa, uteis }) {
  const a = ativoPorId(f.ativoId), td = tipoDefeito(f.tipoId), c = custoDefeito(f);
  const cong = congelamento(semana)?.itens.some((i) => i.defeitoId === f.id);
  const corpo = el('div', { class: 'form' },
    el('div', { class: 'meta' },
      el('div', { class: 'meta__item' }, el('span', { class: 'meta__rotulo', text: 'Ativo' }), el('span', { class: 'meta__valor', text: `${a?.codigo} · ${a?.alimentador}` })),
      el('div', { class: 'meta__item' }, el('span', { class: 'meta__rotulo', text: 'Programado' }), el('span', { class: 'meta__valor', text: `${fmtData(f.programacao.data)} · ${nomeEquipe(f.programacao.equipeId)}` })),
      el('div', { class: 'meta__item' }, el('span', { class: 'meta__rotulo', text: f.execucao ? 'Custo realizado' : 'Custo-padrão' }), el('span', { class: 'meta__valor', text: fmtMoeda(f.execucao?.custo?.total ?? c.total) })),
      el('div', { class: 'meta__item' }, el('span', { class: 'meta__rotulo', text: 'Situação' }), el('span', { class: 'meta__valor', text: f.execucao ? `Executado ${fmtData(f.execucao.em)}${f.execucao.conformeProgramacao ? ' · conforme' : ' · fora do programado'}` : 'A executar' }))),
    el('details', { class: 'bloco-det' }, el('summary', { text: 'Composição do custo' }),
      el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Item', 'Qtd', 'Preço', 'Subtotal'].map((h) => el('th', { text: h })))),
        el('tbody', {}, (f.execucao?.custo || c).itens.map((i) => el('tr', {}, el('td', { text: `${i.codigo} — ${i.descricao}` }), el('td', { text: `${i.qtd} ${i.unidade || ''}` }), el('td', { text: fmtMoeda(i.preco) }), el('td', { text: fmtMoeda(i.subtotal) })))))),
      el('p', { class: 'muted pequeno', text: `Fator regional ${c.fator}` })),
    (f.reprogramacoes || []).length ? el('details', { class: 'bloco-det' }, el('summary', { text: `Reprogramações (${f.reprogramacoes.length})` }),
      el('ul', { class: 'lista' }, f.reprogramacoes.map((r) => el('li', { class: 'lista__item pequeno', text: `${fmtData(r.em)} · ${fmtData(r.de.data)} → ${fmtData(r.para.data)} · ${valor('motivos').find((m) => m.id === r.motivo)?.nome || 'sem motivo (antes do congelamento)'}` })))) : null,
  );
  let rodape = el('button', { type: 'button', class: 'btn btn--grande btn--sec', text: 'Ver no mapa', onclick: () => { fecharSheet(); abrirNoMapa(a.id); } });
  if (!f.execucao && f.status === 'PROGRAMADO' && pode()) {
    const selEq = el('select', { class: 'campo__input' }, equipesAptas(estado.dados, f).filter((e) => e.tipo !== 'INSPECAO').map((e) => el('option', { value: e.id, text: e.nome, selected: e.id === f.programacao.equipeId })));
    const selDia = el('input', { type: 'date', class: 'campo__input', value: f.programacao.data, min: hojeISO() });
    const selMot = el('select', { class: 'campo__input' }, [['', cong ? 'Escolha o motivo (obrigatório)' : 'Motivo (opcional)'], ...valor('motivos').map((m) => [m.id, m.nome])].map(([v, t]) => el('option', { value: v, text: t })));
    corpo.append(el('h3', { text: 'Reprogramar' }),
      el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Equipe' }), selEq),
      el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Nova data' }), selDia),
      el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Motivo' }), selMot));
    rodape = el('div', { class: 'rodape-acoes' },
      el('button', { type: 'button', class: 'btn btn--sec', text: 'Mapa', onclick: () => { fecharSheet(); abrirNoMapa(a.id); } }),
      el('button', { type: 'button', class: 'btn btn--grande', text: 'Salvar reprogramação', onclick: () => {
        if (tratar(() => programarDefeito(f, { equipeId: selEq.value, data: selDia.value, motivo: selMot.value || null }))) { toast('Reprogramado.', { tipo: 'ok' }); fecharSheet(); }
      } }));
  }
  abrirSheet(`${td?.nome} · ${a?.codigo}`, corpo, { tipo: 'form' }, rodape);
}

function exportarSemana(semana, lista) {
  logar({ categoria: 'EXPORTACAO', acao: 'PROGRAMACAO_EXPORTADA', entidade: 'programacao', entidadeId: semana, detalhe: { itens: lista.length } });
  baixarArquivo(`programacao-${semana}.csv`, csvStringify([['data', 'equipe', 'ativo', 'alimentador', 'defeito', 'severidade', 'quantidade', 'unidade', 'horas', 'custo_padrao', 'situacao'],
    ...lista.map((f) => { const c = custoDefeito(f); return [f.programacao.data, nomeEquipe(f.programacao.equipeId), ativoPorId(f.ativoId)?.codigo, ativoPorId(f.ativoId)?.alimentador, tipoDefeito(f.tipoId)?.nome, f.severidade, c.quantidade, c.unidade, horasDefeito(f).toFixed(1), c.total.toFixed(2), f.execucao ? 'executado' : 'a executar']; })]));
}
