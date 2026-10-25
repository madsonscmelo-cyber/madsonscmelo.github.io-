// Tela Parâmetros: edição por grupo, com vigência, motivo e histórico de versões.
import { el, toast, fmtData, fmtDataHora, hojeISO, csvParse } from './util.js';
import { estado, nomeUsuario } from './store.js';
import { ESQUEMA, valor, versoes, podeEditar, salvarVersao, ErroParametro } from './parametros.js';

const ORDEM = ['orcamento', 'caderno', 'composicoes', 'fatores', 'tiposDefeito', 'criterios', 'tiposPlano', 'causas', 'motivos', 'metas', 'geral', 'risco', 'ranking', 'seguranca'];
const estadoTela = { grupo: 'orcamento', rascunho: null, rascunhoGrupo: null };

export function telaParametros(raiz) {
  const visiveis = ORDEM.filter((g) => g !== 'seguranca' || estado.usuario.perfil === 'ADMIN' || estado.usuario.perfil === 'AUDITOR');
  if (!visiveis.includes(estadoTela.grupo)) estadoTela.grupo = visiveis[0];
  const grupo = estadoTela.grupo, esq = ESQUEMA[grupo];
  const editavel = podeEditar(grupo);
  if (estadoTela.rascunhoGrupo !== grupo || !estadoTela.rascunho) { estadoTela.rascunho = valor(grupo); estadoTela.rascunhoGrupo = grupo; }
  const r = estadoTela.rascunho;
  const rerender = () => telaParametros(raiz);

  const seletor = el('select', { class: 'campo__input', 'aria-label': 'Grupo de parâmetros' }, visiveis.map((g) => el('option', { value: g, selected: g === grupo, text: `${ESQUEMA[g].titulo}${podeEditar(g) ? '' : ' (consulta)'}` })));
  seletor.addEventListener('change', () => { estadoTela.grupo = seletor.value; estadoTela.rascunho = null; rerender(); });

  const entrada = (c, atual, aoMudar) => {
    if (c.tipo === 'bool') {
      const i = el('input', { type: 'checkbox', checked: !!atual, disabled: !editavel, 'aria-label': c.rotulo });
      i.addEventListener('change', () => aoMudar(i.checked));
      return i;
    }
    if (c.tipo === 'selecao') {
      const s = el('select', { class: 'campo__input', disabled: !editavel, 'aria-label': c.rotulo }, c.opcoes().map(([k, t]) => el('option', { value: k, text: t, selected: k === atual })));
      s.addEventListener('change', () => aoMudar(s.value));
      return s;
    }
    const i = el('input', {
      class: 'campo__input', disabled: !editavel, 'aria-label': c.rotulo,
      type: c.tipo === 'numero' ? 'number' : c.tipo === 'mes' ? 'month' : 'text', step: c.tipo === 'numero' ? 'any' : undefined, min: c.min, max: c.max,
      value: Array.isArray(atual) ? atual.join(', ') : atual ?? '',
      title: c.tipo === 'multi' ? `Separe por vírgula: ${c.opcoes().map(([k]) => k).join(', ')}` : undefined,
    });
    i.addEventListener('change', () => aoMudar(i.value));
    return i;
  };

  let editor;
  if (esq.tipo === 'objeto') {
    editor = el('div', { class: 'param-obj' }, esq.campos.map((c) => el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: c.rotulo }), entrada(c, r[c.chave], (v) => { r[c.chave] = v; }))));
  } else {
    const corpo = el('tbody', {}, r.map((linha, i) => el('tr', {},
      ...esq.campos.map((c) => el('td', {}, entrada(c, linha[c.chave], (v) => { linha[c.chave] = v; }))),
      editavel ? el('td', {}, el('button', { type: 'button', class: 'btn btn--txt', text: 'remover', 'aria-label': `Remover linha ${i + 1}`, onclick: () => { r.splice(i, 1); rerender(); } })) : null)));
    editor = el('div', {},
      el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela tabela--param' },
        el('thead', {}, el('tr', {}, ...esq.campos.map((c) => el('th', { text: c.rotulo, title: c.tipo === 'multi' ? c.opcoes().map(([k]) => k).join(', ') : '' })), editavel ? el('th', {}, el('span', { class: 'sr-only', text: 'Ações' })) : null)), corpo)),
      editavel ? el('div', { class: 'linha' },
        el('button', { type: 'button', class: 'btn btn--sec', text: '＋ Adicionar linha', onclick: () => { r.push(Object.fromEntries(esq.campos.map((c) => [c.chave, c.tipo === 'numero' ? 0 : c.tipo === 'multi' ? [] : c.tipo === 'bool' ? false : c.tipo === 'selecao' ? c.opcoes()[0][0] : '']))); rerender(); } }),
        esq.importavel ? importador(grupo, esq, rerender) : null) : null);
  }

  const vig = el('input', { type: 'date', class: 'campo__input', value: hojeISO(), min: hojeISO() });
  const motivo = el('input', { class: 'campo__input', maxlength: 300, placeholder: 'Ex.: reajuste contratual de outubro' });
  const salvar = editavel ? el('section', { class: 'bloco' }, el('h2', { text: 'Publicar nova versão' }),
    el('div', { class: 'param-salvar' },
      el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Vale a partir de' }), vig),
      el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Motivo da alteração' }), motivo),
      el('button', { type: 'button', class: 'btn', text: 'Salvar versão', onclick: () => {
        try {
          salvarVersao(grupo, r, vig.value, motivo.value);
          estadoTela.rascunho = null;
          toast(`${esq.titulo}: nova versão válida a partir de ${fmtData(vig.value)}.`, { tipo: 'ok' });
          rerender();
        } catch (e) { toast(e instanceof ErroParametro ? e.message : 'Não foi possível salvar.', { tipo: 'erro', duracao: 7000 }); if (!(e instanceof ErroParametro)) console.error(e); }
      } }),
      el('button', { type: 'button', class: 'btn btn--txt', text: 'Descartar alterações', onclick: () => { estadoTela.rascunho = null; rerender(); } })),
    el('p', { class: 'muted pequeno', text: 'A versão anterior continua valendo até a data escolhida. Indicadores de períodos passados não são recalculados.' })) : null;

  const hist = versoes(grupo);
  raiz.replaceChildren(
    el('header', { class: 'tela__topo' }, el('h1', { text: 'Parâmetros' }), el('span', { class: 'muted', text: 'Tudo que é regra, com vigência e histórico' })),
    el('div', { class: 'filtros' }, seletor, el('span', { class: `chip ${editavel ? 'chip--ok' : ''}`, text: editavel ? 'Você pode editar' : 'Somente consulta' })),
    el('section', { class: 'bloco' }, el('h2', { text: esq.titulo }), esq.ajuda ? el('p', { class: 'muted', text: esq.ajuda }) : null, editor),
    salvar,
    el('section', { class: 'bloco' }, el('h2', { text: `Histórico de versões (${hist.length})` }),
      hist.length ? el('ul', { class: 'lista' }, hist.map((v) => el('li', { class: 'lista__item' },
        el('div', {}, el('strong', { text: `Vale a partir de ${fmtData(v.vigencia)}${v.vigencia > hojeISO() ? ' · agendada' : ''}` }),
          el('div', { class: 'pequeno muted', text: `${fmtDataHora(v.em)} · ${nomeUsuario(v.por)} · ${v.motivo}` })))))
        : el('p', { class: 'muted', text: 'Usando os valores padrão (nenhuma versão publicada ainda).' })));
}

const numeroBR = (v) => { const t = String(v ?? '').trim(); return t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t; };

/** Importa o caderno por CSV (código; descrição; unidade; preço) para o rascunho — só vale depois de salvar a versão. */
function importador(grupo, esq, rerender) {
  const inp = el('input', { type: 'file', accept: '.csv,text/csv', class: 'oculto' });
  inp.addEventListener('change', async () => {
    const f = inp.files[0];
    inp.value = '';
    if (!f || f.size > 2 * 1024 * 1024) { toast('Arquivo ausente ou maior que 2 MB.', { tipo: 'erro' }); return; }
    const linhas = csvParse(await f.text());
    const cab = linhas[0].map((c) => c.trim().toLowerCase());
    const idx = Object.fromEntries(esq.campos.map((c) => [c.chave, cab.findIndex((h) => h.startsWith(c.chave.slice(0, 5)) || h.startsWith(c.rotulo.toLowerCase().slice(0, 5)))]));
    if (Object.values(idx).some((i) => i < 0)) { toast(`Cabeçalho esperado: ${esq.campos.map((c) => c.chave).join(';')}`, { tipo: 'erro', duracao: 7000 }); return; }
    estadoTela.rascunho = linhas.slice(1).map((l) => Object.fromEntries(esq.campos.map((c) => [c.chave, c.tipo === 'numero' ? numeroBR(l[idx[c.chave]]) : l[idx[c.chave]]])));
    toast(`${estadoTela.rascunho.length} linhas carregadas. Revise e salve a versão.`, { tipo: 'ok' });
    rerender();
  });
  return el('span', {}, el('button', { type: 'button', class: 'btn btn--sec', text: '⬆ Importar CSV', onclick: () => inp.click() }), inp,
    el('a', { class: 'btn btn--txt', href: 'modelos/template-caderno.csv', download: 'template-caderno.csv', text: 'Modelo do CSV' }));
}
