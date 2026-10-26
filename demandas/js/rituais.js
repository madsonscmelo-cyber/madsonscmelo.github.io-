// Tela Rituais: entregas cíclicas (MASP, RAD, fechamentos). A gerência cadastra e gera os tickets do mês; o supervisor consulta.
import { el, preencher, toast, hojeISO } from './util.js';
import { estado } from './store.js';
import { TIPOS, REGRAS_RITUAL, rotuloRegra, proximaDataRitual, dataCurta, supervisores } from './dominio.js';
import { criarRitual, removerRitual, gerarRituais } from './acoes.js';
import { tratar } from './ui.js';

export function telaRituais(raiz, ctx) {
  const gestor = estado.usuario.perfil === 'GESTOR';
  const render = () => telaRituais(raiz, ctx);
  const h = new Date(`${hojeISO()}T12:00:00`);
  const meses = [0, 1].map((i) => new Date(h.getFullYear(), h.getMonth() + i, 1, 12));
  const nomeMes = (d) => d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const lista = estado.dados.rituais.length
    ? el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['Ritual', 'Quando', 'Próxima data', gestor ? '' : null].filter((x) => x !== null).map((t) => el('th', { text: t })))),
      el('tbody', {}, estado.dados.rituais.map((r) => el('tr', {},
        el('td', {}, el('strong', { text: r.nome }), r.exemplo ? el('span', { class: 'etiqueta etiqueta--ex', text: 'exemplo' }) : null, el('div', { class: 'muted pequeno', text: r.descricao || '' })),
        el('td', { text: rotuloRegra(r) }), el('td', { class: 'num', text: dataCurta(proximaDataRitual(r)) }),
        gestor ? el('td', {}, el('button', { type: 'button', class: 'btn btn--txt', text: 'Remover', 'aria-label': `Remover ${r.nome}`, onclick: () => {
          if (confirm(`Remover o ritual "${r.nome}"? Os tickets já gerados continuam na agenda.`) && tratar(() => removerRitual(r.id))) toast('Ritual removido.', { tipo: 'ok' });
        } })) : null)))))
    : el('p', { class: 'vazio', text: 'Nenhum ritual cadastrado. A gerência cadastra MASP, RAD e fechamentos.' });

  const gerar = gestor ? el('div', { class: 'linha' }, meses.map((m, i) => el('button', { type: 'button', class: `btn${i ? ' btn--sec' : ''}`, text: `Gerar tickets de ${nomeMes(m)}`, onclick: () => {
    const r = tratar(() => gerarRituais(m.getFullYear(), m.getMonth()));
    if (!r) return;
    const aviso = r.passados ? ` ${r.passados} ritual(is) com data já passada neste mês não foram gerados.` : '';
    toast(r.criados ? `${r.criados} ticket(s) criados para ${supervisores(estado.dados).length} supervisores.${aviso}` : `Nenhum ticket novo: os deste mês já existem.${aviso}`, { tipo: r.criados ? 'ok' : 'info', duracao: 7000 });
  } }))) : null;

  preencher(raiz,
    el('header', { class: 'tela__topo' }, el('h1', { text: 'Rituais do mês' }), el('span', { class: 'muted', text: 'Cada ritual vira um ticket por supervisor, com o prazo calculado em dias úteis' })),
    el('div', { class: 'grade-2' },
      el('section', { class: 'bloco grupo' }, el('h2', { text: 'Cadastrados' }), lista, gerar,
        gestor ? el('p', { class: 'muted pequeno', text: 'Gerar de novo não duplica: cada ticket tem um código por ritual, mês e supervisor.' }) : null),
      gestor ? formRitual(render) : el('section', { class: 'bloco' }, el('h2', { text: 'Como funciona' }),
        el('p', { class: 'muted', text: 'A gerência gera os tickets no início do mês. Eles aparecem na sua agenda como planejados, com o prazo de cada fechamento.' }))));
}

function formRitual(render) {
  const nome = el('input', { class: 'campo__input', maxlength: 80, required: true, placeholder: 'Ex.: Fechamento do RAD' });
  const desc = el('input', { class: 'campo__input', maxlength: 160, placeholder: 'Ex.: Relatório de análise de desempenho do setor' });
  const regra = el('select', { class: 'campo__input' }, Object.entries(REGRAS_RITUAL).map(([k, v]) => el('option', { value: k, text: v })));
  const n = el('input', { class: 'campo__input', type: 'number', min: 1, max: 31, value: 5, inputmode: 'numeric' });
  const tipo = el('select', { class: 'campo__input' }, TIPOS.map((t) => el('option', { value: t, text: t, selected: t === 'Ritual' })));
  const campoN = el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Número (dia útil ou dia do mês)' }), n);
  regra.addEventListener('change', () => { campoN.hidden = regra.value === 'ULTIMO_UTIL'; });
  const f = el('form', { class: 'bloco form', novalidate: true },
    el('h2', { text: 'Novo ritual' }),
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Nome' }), nome),
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'O que entregar' }), desc),
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Quando' }), regra), campoN,
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Tipo' }), tipo),
    el('button', { type: 'submit', class: 'btn', text: 'Cadastrar ritual' }));
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    if (tratar(() => criarRitual({ nome: nome.value, descricao: desc.value, regra: regra.value, n: n.value, tipo: tipo.value }))) { toast('Ritual cadastrado.', { tipo: 'ok' }); render(); }
  });
  return f;
}
