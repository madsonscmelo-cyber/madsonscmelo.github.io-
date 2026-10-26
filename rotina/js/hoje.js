// Tela de entrada por perfil: a primeira ação útil, sem procurar número.
// Retaguarda: o dia em ordem de horário, progresso e uma ação principal. Supervisor/gerência: no máximo 3 decisões.
import { el, toast, hojeISO, semanaISO, deslocarSemana, somarDias, fmtPct, preencher } from './util.js';
import { estado, rascunhosDoUsuario, removerRascunho } from './store.js';
import { ocorrencias, colaboradores, indicadores, carga, periodoSemana, achados, pedidosPendentes, dataCurta, UTDS, CARGOS } from './dominio.js';
import { cartaoOcorrencia, abrirConcluir, abrirDemanda } from './ui.js';
import { logar, todosLogs, verificarIntegridade } from './auditoria.js';

const cab = (titulo, sub) => el('header', { class: 'tela__topo' }, el('h1', { text: titulo }), el('span', { class: 'muted', text: sub }));

export function telaHoje(raiz, ctx) {
  const p = estado.usuario.perfil;
  if (p === 'COLABORADOR') hojeColaborador(raiz);
  else if (p === 'AUDITOR') hojeAuditor(raiz);
  else hojeGestao(raiz, ctx);
}

function hojeColaborador(raiz) {
  const d = estado.dados, u = estado.usuario, hoje = hojeISO();
  const doDia = ocorrencias(d, { ini: hoje, fim: hoje, usuarios: [u], hoje });
  const atrasadas = ocorrencias(d, { ini: somarDias(hoje, -14), fim: hoje, usuarios: [u], hoje }).filter((o) => o.status === 'ATRASADA');
  const feitas = doDia.filter((o) => o.status === 'CONCLUIDA').length;
  const pendentes = doDia.filter((o) => o.status !== 'CONCLUIDA');
  const proxima = [...atrasadas, ...pendentes.filter((o) => o.status === 'HOJE')][0];

  const preench = el('span', { class: 'progresso-dia__preench' });
  preench.style.width = `${doDia.length ? Math.round((feitas / doDia.length) * 100) : 0}%`;
  const rascunhos = rascunhosDoUsuario();
  preencher(raiz, 
    cab(`Hoje · ${dataCurta(hoje)}`, `${CARGOS[u.cargo] || 'Sem cargo'} · ${UTDS[u.utd] || 'sem UTD'}`),
    !u.cargo ? el('p', { class: 'vazio', text: 'Você ainda não tem cargo e UTD na ocupação. Peça à gerência para cadastrar: é isso que monta a sua agenda.' }) : null,
    el('div', { class: 'progresso-dia', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': doDia.length, 'aria-valuenow': feitas, 'aria-label': 'Progresso do dia' },
      el('div', { class: 'progresso-dia__txt' }, el('strong', { text: `Hoje: ${feitas} de ${doDia.length}` }),
        el('span', { class: 'muted', text: doDia.length - feitas ? `faltam ${doDia.length - feitas}` : doDia.length ? 'rotina do dia cumprida' : 'nada programado para hoje' })),
      el('span', { class: 'progresso-dia__trilho' }, preench)),
    ...rascunhos.slice(0, 2).map((r) => el('div', { class: 'rascunho-linha' },
      el('button', { type: 'button', class: 'rascunho', onclick: () => { logar({ categoria: 'NAVEGACAO', acao: 'RASCUNHO_RETOMADO', entidade: 'ocorrencia', entidadeId: r.ocorrencia }); abrirConcluir(r.ocorrencia); } },
        el('span', { text: `📝 Evidência começada: ${r.titulo}` }), el('strong', { text: 'Continuar' })),
      el('button', { type: 'button', class: 'rascunho__x', 'aria-label': `Descartar rascunho de ${r.titulo}`, text: '✕', onclick: () => {
        if (!confirm(`Descartar o texto da evidência de "${r.titulo}"?`)) return;
        removerRascunho(r.chave);
        logar({ categoria: 'ESCRITA', acao: 'RASCUNHO_DESCARTADO', entidade: 'ocorrencia', entidadeId: r.ocorrencia });
        hojeColaborador(raiz);
      } }))),
    atrasadas.length ? el('section', { class: 'bloco bloco--critico' },
      el('h2', { text: `! Atrasadas nos últimos 14 dias (${atrasadas.length})` }),
      el('div', { class: 'oc-lista' }, atrasadas.slice(0, 3).map((o) => cartaoOcorrencia(o))),
      atrasadas.length > 3 ? el('p', { class: 'pequeno muted', text: `+${atrasadas.length - 3} na Agenda.` }) : null) : null,
    el('section', { class: 'bloco' }, el('h2', { text: 'Rotina de hoje' }),
      doDia.length ? el('div', { class: 'oc-lista' }, doDia.map((o) => cartaoOcorrencia(o))) : el('p', { class: 'muted', text: 'Sem atividades de rotina hoje.' })),
    el('div', { class: 'rodape-fixo' },
      proxima ? el('button', { type: 'button', class: 'btn btn--grande', onclick: () => abrirConcluir(proxima.chave) }, el('span', { class: 'rodape-fixo__txt', text: `Concluir: ${proxima.nome}` }))
        : el('p', { class: 'muted rodape-fixo__fim', text: doDia.length ? '✓ Nada pendente hoje.' : 'Sem rotina hoje.' }),
      el('button', { type: 'button', class: 'btn btn--txt', text: 'Registrar sob demanda', onclick: abrirDemanda })));
}

/** Supervisor e gerência: até 3 cartões de decisão, ordenados pela urgência. */
function hojeGestao(raiz, ctx) {
  const d = estado.dados, u = estado.usuario, hoje = hojeISO(), per = periodoSemana(semanaISO(hoje));
  const pessoas = colaboradores(d).filter((x) => u.perfil !== 'SUPERVISOR' || x.utd === u.utd);
  const semana = ocorrencias(d, { ini: per.ini, fim: per.fim, usuarios: pessoas, hoje });
  // Segunda-feira cedo a semana ainda não tem base: mostra a semana passada, dizendo que é ela.
  let ind = indicadores(semana, hoje), rotuloSemana = 'Semana';
  if (!ind.programadas) {
    const ant = periodoSemana(deslocarSemana(per.semana, -1));
    ind = indicadores(ocorrencias(d, { ini: ant.ini, fim: ant.fim, usuarios: pessoas, hoje }), hoje);
    rotuloSemana = 'Semana passada';
  }
  // Atrasadas: não concluídas nos últimos 14 dias (não só nesta semana).
  const atrasadas = ocorrencias(d, { ini: somarDias(hoje, -14), fim: hoje, usuarios: pessoas, hoje }).filter((o) => o.status === 'ATRASADA');
  const nPedidos = pedidosPendentes(d).filter((o) => pessoas.some((x) => x.id === o.usuarioId) && o.exec.pedido.por !== u.id).length;
  const sobrecarga = pessoas.map((x) => ({ x, c: carga(d, semana.filter((o) => o.usuarioId === x.id), per.semana) })).filter((y) => y.c.pct > 1);
  const ach = achados(d, hoje);
  const acao = (rotulo, tela, extra) => () => { logar({ categoria: 'NAVEGACAO', acao: 'HOJE_ACAO', detalhe: { rotulo } }); ctx.irPara(tela, extra); };
  const cartoes = [];
  if (nPedidos) cartoes.push({ nivel: 'critico', n: nPedidos, tit: 'Remanejamentos aguardando você', txt: 'Até a decisão, a atividade fica na data original e conta como atrasada se passar.', btn: 'Decidir agora', fn: acao('aprovacoes', 'equipe', { aba: 'aprovacoes' }) });
  if (atrasadas.length) cartoes.push({ nivel: 'alerta', n: atrasadas.length, tit: 'Atividades atrasadas (últimos 14 dias)', txt: `${new Set(atrasadas.map((o) => o.usuarioId)).size} pessoa(s). Concluir com evidência ou remanejar com motivo.`, btn: 'Ver por pessoa', fn: acao('atrasadas', 'equipe', { aba: 'aderencia' }) });
  if (sobrecarga.length) cartoes.push({ nivel: 'alerta', n: sobrecarga.length, tit: 'Pessoas com carga acima da capacidade', txt: sobrecarga.slice(0, 2).map((y) => `${y.x.nome} ${fmtPct(y.c.pct)}`).join(' · '), btn: 'Rever no catálogo', fn: acao('sobrecarga', 'catalogo', { aba: 'achados' }) });
  if (u.perfil === 'GESTOR' && ach.transfSemAceite.length) cartoes.push({ nivel: 'info', n: ach.transfSemAceite.length, tit: 'Transferências sem aceite da área destino', txt: 'Continuam sendo feitas pela retaguarda até o aceite.', btn: 'Registrar aceites', fn: acao('transferencias', 'catalogo', { aba: 'achados' }) });
  if (ach.multiR.length) cartoes.push({ nivel: 'info', n: ach.multiR.length, tit: 'Atividades com mais de um responsável (R)', txt: 'Esforço duplicado na agenda. Defina um único R.', btn: 'Ver achados', fn: acao('multiR', 'catalogo', { aba: 'achados' }) });

  preencher(raiz, 
    cab(`Hoje · ${dataCurta(hoje)}`, u.perfil === 'SUPERVISOR' ? `UTD ${UTDS[u.utd]} · ${pessoas.length} pessoa(s)` : `${Object.keys(UTDS).length} UTDs · ${pessoas.length} pessoa(s)`),
    el('p', { class: 'resumo', text: `${rotuloSemana}: aderência ${ind.aderencia === null ? '—' : fmtPct(ind.aderencia)} · cumprimento ${ind.cumprimento === null ? '—' : fmtPct(ind.cumprimento)} · ${ind.remanejadas} remanejada(s)` }),
    cartoes.length ? el('div', { class: 'hoje-cards' }, cartoes.slice(0, 3).map((c) => el('article', { class: `hoje-card hoje-card--${c.nivel}` },
      el('div', { class: 'hoje-card__cab' }, el('span', { class: 'hoje-card__nivel', text: c.nivel === 'critico' ? 'Decidir hoje' : c.nivel === 'alerta' ? 'Atenção' : 'Para acompanhar' }), el('strong', { class: 'hoje-card__num', text: String(c.n) })),
      el('h2', { class: 'hoje-card__tit', text: c.tit }), el('p', { class: 'pequeno muted', text: c.txt }),
      el('button', { type: 'button', class: 'btn', text: c.btn, onclick: c.fn }))))
      : el('p', { class: 'vazio', text: 'Nenhuma decisão pendente. A equipe está em dia.' }),
    cartoes.length > 3 ? el('p', { class: 'pequeno muted', text: `+${cartoes.length - 3} ponto(s) de acompanhamento nas telas Equipe e Catálogo.` }) : null);
}

async function hojeAuditor(raiz) {
  preencher(raiz, cab(`Hoje · ${dataCurta(hojeISO())}`, 'Auditoria'), el('p', { class: 'carregando', role: 'status', text: 'Carregando…' }));
  const logs = await todosLogs();
  const semana = Date.now() - 7 * 86400000;
  const negadas = logs.filter((l) => l.resultado === 'NEGADO' && Date.parse(l.em) > semana);
  const catalogo = logs.filter((l) => ['ATIVIDADE_ALTERADA', 'CATALOGO_IMPORTADO', 'REGRAS_ALTERADAS', 'OCUPACAO_ALTERADA', 'TRANSFERENCIA_ACEITA'].includes(l.acao) && Date.parse(l.em) > semana);
  const decisoes = logs.filter((l) => ['REMANEJAMENTO_APROVADO', 'REMANEJAMENTO_RECUSADO'].includes(l.acao) && Date.parse(l.em) > semana);
  const integ = el('strong', { class: 'hoje-card__num', text: '…' });
  const card = (nivel, n, tit, txt) => el('article', { class: `hoje-card hoje-card--${nivel}` },
    el('div', { class: 'hoje-card__cab' }, el('span', { class: 'hoje-card__nivel', text: tit }), typeof n === 'string' ? el('strong', { class: 'hoje-card__num', text: n }) : n), el('p', { class: 'pequeno muted', text: txt }));
  preencher(raiz, cab(`Hoje · ${dataCurta(hojeISO())}`, 'Auditoria'),
    el('div', { class: 'hoje-cards' },
      card('info', integ, 'Integridade do log', 'Cadeia SHA-256 recalculada agora.'),
      card(negadas.length ? 'alerta' : 'info', String(negadas.length), 'Ações negadas (7 dias)', 'Tentativas fora da permissão, inclusive autoaprovação.'),
      card('info', String(catalogo.length + decisoes.length), 'Mudanças de regra e decisões (7 dias)', `${catalogo.length} no catálogo/ocupação · ${decisoes.length} decisões de remanejamento`)));
  const r = await verificarIntegridade();
  integ.textContent = r.ok ? '✓ íntegro' : '✗ violado';
  logar({ categoria: 'SEGURANCA', acao: 'INTEGRIDADE_VERIFICADA', resultado: r.ok ? 'OK' : 'ERRO', detalhe: r });
  if (!r.ok) toast(`Log violado: ${r.motivo}`, { tipo: 'erro', duracao: 10000 });
}
