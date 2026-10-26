// Tela Painel: carga e pontualidade por supervisor e, principalmente, o comportamento de quem gera demanda.
import { el, preencher, fmtPct, baixarArquivo, csvStringify, hojeISO } from './util.js';
import { estado, nomeUsuario } from './store.js';
import { CANAIS, MOTIVOS_RADAR, LIMITES, STATUS, indicadores, dataCurta, grupos } from './dominio.js';
import { abrirDemanda } from './ui.js';
import { logar } from './auditoria.js';

const kpi = (r, v, d, c = '') => el('div', { class: `kpi ${c}` }, el('span', { class: 'kpi__rotulo', text: r }), el('strong', { class: 'kpi__valor', text: v }), el('span', { class: 'kpi__det', text: d }));

/** Barra horizontal: rótulo (opcional), trilho e valor. Largura via CSSOM (a CSP só proíbe o atributo style no HTML). */
function barra(rotulo, frac, valor, cor = '') {
  const preench = el('span', { class: `barras__preench ${cor}` });
  preench.style.width = `${Math.max(0, Math.min(100, Math.round(frac * 100)))}%`;
  return el('div', { class: `barras__linha${rotulo ? '' : ' barras__linha--cel'}` }, rotulo ? el('span', { text: rotulo }) : null,
    el('span', { class: 'barras__trilho', 'aria-hidden': 'true' }, preench), el('span', { class: 'barras__val', text: valor }));
}
const barras = (pares, cor) => {
  const mx = Math.max(1, ...pares.map(([, v]) => v));
  return pares.length ? el('div', { class: 'barras' }, pares.map(([r, v]) => barra(r, v / mx, String(v), cor))) : el('p', { class: 'vazio', text: 'Sem dados.' });
};

export function telaPainel(raiz) {
  const I = indicadores(estado.dados);
  const exportar = el('button', { type: 'button', class: 'btn btn--sec', text: 'Exportar demandas (CSV)', onclick: () => {
    const linhas = estado.dados.demandas.filter((x) => !x.ehMae);
    logar({ categoria: 'EXPORTACAO', acao: 'DEMANDAS_EXPORTADAS', detalhe: { registros: linhas.length } });
    baixarArquivo(`demandas-${hojeISO()}.csv`, csvStringify([
      ['id', 'titulo', 'area_solicitante', 'solicitante', 'supervisor', 'tipo', 'canal', 'abertura', 'prazo', 'antecedencia_du', 'urgencia', 'radar', 'motivo_radar', 'pendencias', 'status', 'concluida_em', 'delegada_a'],
      ...linhas.map((x) => [x.id, x.titulo, x.areaSolicitante, x.solicitante, nomeUsuario(x.destinatario), x.tipo, CANAIS[x.canal], x.abertura, x.prazo, x.antecedencia, x.urgencia,
        x.radar, MOTIVOS_RADAR[x.motivoRadar] || x.motivoRadarTexto, (x.pendencias || []).join('|'), STATUS[x.status], (x.concluidaEm || '').slice(0, 10), x.delegadoPara])]));
  } });

  preencher(raiz,
    el('header', { class: 'tela__topo' }, el('h1', { text: 'Painel de demandas' }), exportar),
    el('div', { class: 'kpis' },
      kpi('Tickets abertos', String(I.abertos), `${I.pedidos} pedidos originais`),
      kpi('Atrasados', String(I.atrasados), `${fmtPct(I.abertos ? I.atrasados / I.abertos : 0)} do que está aberto`, I.atrasados ? 'kpi--critico' : 'kpi--ok'),
      kpi('Entregues no prazo', fmtPct(I.concluidos ? I.noPrazo / I.concluidos : 0), `${I.noPrazo} de ${I.concluidos} concluídos`),
      kpi('Taxa de imprevisto', fmtPct(I.taxaImprevisto), 'pedidos fora do radar', I.taxaImprevisto > 0.4 ? 'kpi--alerta' : ''),
      kpi('Pedidos incompletos', fmtPct(I.incompletos), 'nasceram com pendência de quem pediu')),

    el('section', { class: 'bloco' },
      el('h2', { text: 'Quem gera demanda e como' }),
      el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Área', 'Pedidos', 'Antecedência média', 'Urgência para ontem', 'Fora do radar', 'Incompletos'].map((t) => el('th', { text: t })))),
        el('tbody', {}, I.areas.map((a) => el('tr', { class: a.fora >= 0.5 ? 'tr--alerta' : '' },
          el('td', {}, el('strong', { text: a.area })), el('td', { class: 'num', text: String(a.pedidos) }),
          el('td', { class: 'num', text: a.antecedenciaMedia === null ? '—' : `${a.antecedenciaMedia.toFixed(1)} d.u.` }),
          el('td', {}, barra('', a.paraOntem, fmtPct(a.paraOntem), 'critico')),
          el('td', {}, barra('', a.fora, fmtPct(a.fora), 'alerta')),
          el('td', { class: 'num', text: fmtPct(a.incompletos) })))))),
      el('p', { class: 'muted pequeno', text: `Urgência para ontem: pedidos marcados como urgentes ou com menos de ${LIMITES.urgenciaParaOntem} dias úteis de antecedência. Fora do radar: menos de ${LIMITES.antecedenciaMin} dias úteis ou marcado por quem recebeu. d.u. = dias úteis.` })),

    el('div', { class: 'grade-2' },
      el('section', { class: 'bloco' }, el('h2', { text: 'Carga e pontualidade por supervisor' }),
        el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {}, ['Supervisor', 'Abertas', 'Atrasadas', 'No prazo', 'Antecipou', 'Fora do radar'].map((t) => el('th', { text: t })))),
          el('tbody', {}, I.supervisores.map((s) => el('tr', { class: s.atrasadas ? 'tr--alerta' : '' },
            el('td', {}, el('strong', { text: s.nome }), el('div', { class: 'muted pequeno', text: s.setor })),
            el('td', { class: 'num', text: String(s.abertas) }), el('td', { class: 'num', text: String(s.atrasadas) }),
            el('td', { class: 'num', text: s.noPrazo === null ? '—' : fmtPct(s.noPrazo) }), el('td', { class: 'num', text: String(s.antecipou) }),
            el('td', { class: 'num', text: String(s.foraAbertas) }))))))),
      el('section', { class: 'bloco' }, el('h2', { text: 'Por que não estava no radar' }), barras(I.motivos, 'alerta'))),

    el('div', { class: 'grade-2' },
      el('section', { class: 'bloco' }, el('h2', { text: 'Pedidos por tipo' }), barras(I.tipos)),
      el('section', { class: 'bloco' }, el('h2', { text: 'Por canal de entrada' }), barras(I.canais),
        el('p', { class: 'muted pequeno', text: 'Quanto ainda chega por voz, zap ou foto e precisou ser formalizado por quem recebeu.' }))),

    I.maes.length ? el('section', { class: 'bloco' }, el('h2', { text: 'Pedidos para grupos: atendimento' }),
      el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Pedido', 'Grupo', 'Prazo', 'Atendimento', 'Atrasados'].map((t) => el('th', { text: t })))),
        el('tbody', {}, I.maes.map((m) => el('tr', {},
          el('td', {}, el('button', { type: 'button', class: 'btn btn--txt', text: m.mae.titulo, onclick: () => abrirDemanda(m.mae.id) }), el('div', { class: 'muted pequeno', text: `${m.mae.solicitante} · ${m.mae.areaSolicitante}` })),
          el('td', { text: grupos(estado.dados)[m.mae.grupo]?.nome || '—' }), el('td', { class: 'num', text: dataCurta(m.mae.prazo) }),
          el('td', {}, barra('', m.total ? m.concluidas / m.total : 0, `${m.concluidas}/${m.total}`, 'ok')),
          el('td', { class: 'num', text: String(m.atrasadas) }))))))) : null);
}
