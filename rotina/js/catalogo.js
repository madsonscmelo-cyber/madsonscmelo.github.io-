// Catálogo de atividades (com vigência), achados da base e regras gerais (feriados, capacidade).
// Gerência e administrador editam; supervisor e auditoria consultam.
import { el, hojeISO, fmtData, fmtDataHora, csvStringify, baixarArquivo, toast, preencher, anexar } from './util.js';
import { estado, nomeUsuario } from './store.js';
import {
  CARGOS, PERIODICIDADES, SITUACOES, REGRAS_MES, rotuloRegraMes, DIAS_SEMANA, LIMITES, versaoAtual, achados, regras, hhmm,
} from './dominio.js';
import { editarAtividade, registrarAceite, alterarRegras, importarCatalogo, COLUNAS_CSV } from './acoes.js';
import { abrirSheet, fecharSheet, tratar } from './ui.js';
import { logar } from './auditoria.js';

// Estado da tela é por usuário: trocar de login no mesmo aparelho começa do zero (aba, filtros, importação).
const inicial = () => ({ aba: 'atividades', q: '', cargo: '', filtro: '', ultimaImportacao: null, usuario: estado.usuario?.id });
let st = inicial();
const podeEditar = () => ['GESTOR', 'ADMIN'].includes(estado.usuario.perfil);

export function telaCatalogo(raiz, ctx, extra = {}) {
  if (st.usuario !== estado.usuario.id) st = inicial();
  if (extra.aba) st.aba = extra.aba;
  const rerender = () => telaCatalogo(raiz, ctx);
  const ach = achados(estado.dados);
  const nAchados = ach.multiR.length + ach.semA.length + ach.transfSemAceite.length + ach.capCargo.filter((c) => c.pct > 1).length;
  const corpo = el('div', { class: 'painel-aba' });
  preencher(raiz, 
    el('header', { class: 'tela__topo' }, el('h1', { text: 'Catálogo' }), el('span', { class: 'muted', text: `${ach.total} atividades · ${podeEditar() ? 'edição com vigência e motivo' : 'consulta'}` })),
    el('div', { class: 'abas abas--rolavel', role: 'tablist' }, [['atividades', 'Atividades'], ['achados', 'Achados', nAchados], ['regras', 'Regras']].map(([id, t, n]) => el('button', {
      type: 'button', role: 'tab', 'aria-selected': String(st.aba === id), class: `abas__btn${st.aba === id ? ' ativo' : ''}`,
      onclick: () => { st.aba = id; logar({ categoria: 'NAVEGACAO', acao: 'ABA_CATALOGO', detalhe: { aba: id } }); rerender(); },
    }, t, n ? el('span', { class: 'abas__n', text: String(n) }) : null))),
    corpo);
  if (st.aba === 'atividades') abaAtividades(corpo, rerender, ach);
  else if (st.aba === 'achados') abaAchados(corpo, rerender, ach);
  else abaRegras(corpo, rerender);
}

// ---------- Atividades ----------
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function abaAtividades(corpo, rerender, ach) {
  const d = estado.dados;
  const multi = new Set(ach.multiR.flatMap((g) => g.ids));
  const busca = el('input', { type: 'search', class: 'campo__input', placeholder: 'Buscar atividade, código ou indicador', value: st.q, maxlength: 60, 'aria-label': 'Buscar no catálogo' });
  busca.addEventListener('change', () => { st.q = busca.value; logar({ categoria: 'LEITURA', acao: 'BUSCA_CATALOGO', detalhe: { texto: st.q } }); rerender(); });
  const selCargo = el('select', { class: 'campo__input', 'aria-label': 'Cargo' }, el('option', { value: '', text: 'Todos os cargos' }), Object.entries(CARGOS).map(([k, t]) => el('option', { value: k, text: t, selected: st.cargo === k })));
  selCargo.addEventListener('change', () => { st.cargo = selCargo.value; rerender(); });
  const selFiltro = el('select', { class: 'campo__input', 'aria-label': 'Situação' }, [['', 'Todas as situações'], ['R', 'Rotina'], ['S', 'Sob demanda'], ['T', 'Transferir'], ['MULTI', 'Com mais de um R'], ['SEMA', 'Sem aprovador (A)'], ['EST', 'Periodicidade/duração estimadas']]
    .map(([v, t]) => el('option', { value: v, text: t, selected: st.filtro === v })));
  selFiltro.addEventListener('change', () => { st.filtro = selFiltro.value; rerender(); });
  const lista = d.atividades.map((a) => ({ a, v: versaoAtual(a) })).filter(({ a, v }) => (!st.cargo || v.cargo === st.cargo)
    && (!st.q || norm(`${a.codigo} ${v.nome} ${v.indicador} ${v.governanca}`).includes(norm(st.q)))
    && (!st.filtro || (st.filtro === 'MULTI' ? multi.has(a.id) : st.filtro === 'SEMA' ? v.situacao !== 'S' && !v.aprovador : st.filtro === 'EST' ? v.situacao !== 'S' && !v.validada : v.situacao === st.filtro)));

  // Importação: lê o arquivo e entrega o texto ao comando (que valida tamanho, colunas e cada linha).
  const arquivo = el('input', { type: 'file', accept: '.csv,text/csv', class: 'sr-only', id: 'importar-csv', 'aria-label': 'Arquivo CSV do catálogo' });
  arquivo.addEventListener('change', async () => {
    const f = arquivo.files?.[0];
    if (!f) return;
    if (f.size > LIMITES.csvBytesMax) { arquivo.value = ''; toast('Arquivo maior que 2 MB.', { tipo: 'erro' }); return; }
    const conteudo = await f.text();
    arquivo.value = '';
    const r = tratar(() => importarCatalogo(conteudo, f.name.slice(0, 80)));
    if (r) { st.ultimaImportacao = r; toast(`${r.aceitos} linha(s) aceita(s), ${r.rejeitados.length} rejeitada(s).`, { tipo: r.rejeitados.length ? 'aviso' : 'ok' }); rerender(); }
  });

  anexar(corpo, 
    el('div', { class: 'filtros' }, busca, selCargo, selFiltro),
    el('div', { class: 'linha' },
      podeEditar() ? el('button', { type: 'button', class: 'btn', text: 'Importar CSV', onclick: () => arquivo.click() }) : null,
      podeEditar() ? arquivo : null,
      el('button', { type: 'button', class: 'btn btn--sec', text: 'Exportar CSV', onclick: () => exportar(d) }),
      el('a', { class: 'btn btn--txt', href: 'modelos/template-catalogo.csv', download: 'template-catalogo.csv', text: 'Baixar modelo' })),
    st.ultimaImportacao ? relatorioImportacao(st.ultimaImportacao) : null,
    el('p', { class: 'pequeno muted', text: `${lista.length} atividade(s)` }),
    el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['Código', 'Atividade', 'Cargo (R)', 'Periodicidade', 'Duração', 'Situação', 'Aprova (A)'].map((h) => el('th', { text: h })))),
      el('tbody', {}, lista.map(({ a, v }) => el('tr', { class: multi.has(a.id) ? 'tr--alerta' : '' },
        el('td', { text: a.codigo }),
        el('td', {}, el('button', { type: 'button', class: 'btn btn--txt', text: v.nome, onclick: () => abrirAtividade(a.id, rerender) }),
          multi.has(a.id) ? el('span', { class: 'etiqueta etiqueta--alerta', text: 'mais de um R' }) : null,
          v.situacao !== 'S' && !v.validada ? el('span', { class: 'etiqueta', text: 'estimada' }) : null),
        el('td', { text: CARGOS[v.cargo] }),
        el('td', { text: `${PERIODICIDADES[v.periodicidade].nome}${v.periodicidade === 'W' || v.periodicidade === 'Q' ? ` · ${DIAS_SEMANA[v.diaSemana] || ''}` : v.periodicidade === 'M' ? ` · ${rotuloRegraMes(v.regraMes)}` : ''}` }),
        el('td', { class: 'num', text: v.duracaoMin ? hhmm(v.duracaoMin) : v.horario === 'CONT' ? 'contínua' : '—' }),
        el('td', { text: `${SITUACOES[v.situacao]}${v.situacao === 'T' ? (a.aceite ? ' (aceita)' : ' (sem aceite)') : ''}` }),
        el('td', { text: v.aprovador ? 'Supervisor' : v.situacao === 'S' ? '—' : 'não definido ⚠' })))))));

}

function relatorioImportacao(r) {
  return el('section', { class: `bloco${r.rejeitados.length ? ' bloco--aviso' : ''}`, role: 'status' },
    el('h2', { text: `Importação de ${r.arquivo}` }),
    el('p', { text: `${r.aceitos} linha(s) aceita(s) — ${r.criadas} nova(s), ${r.atualizadas} atualizada(s), ${r.semMudanca} sem mudança · ${r.rejeitados.length} rejeitada(s)` }),
    el('p', { class: 'pequeno muted', text: 'Atividades importadas entram como "estimadas" até a gerência validar no catálogo. Vigência a partir de hoje.' }),
    r.rejeitados.length ? el('ul', { class: 'lista' }, r.rejeitados.slice(0, 10).map((x) => el('li', { class: 'lista__item', text: `Linha ${x.linha}${x.codigo ? ` (${x.codigo})` : ''}: ${x.motivo}` }))) : null,
    r.rejeitados.length ? el('button', { type: 'button', class: 'btn btn--sec', text: 'Baixar linhas rejeitadas', onclick: () => {
      logar({ categoria: 'EXPORTACAO', acao: 'REJEICOES_EXPORTADAS', detalhe: { linhas: r.rejeitados.length } });
      baixarArquivo(`rejeitadas-${hojeISO()}.csv`, csvStringify([['linha', 'motivo', ...COLUNAS_CSV], ...r.rejeitados.map((x) => [x.linha, x.motivo, ...x.dados])]));
    } }) : null);
}

function exportar(d) {
  const linhas = d.atividades.map((a) => { const v = versaoAtual(a); return [a.codigo, v.nome, v.governanca, v.indicador, v.cargo, v.coResponsaveis.join(','), v.aprovador, v.periodicidade, v.situacao, v.duracaoMin, v.horario, v.diaSemana, v.regraMes, v.evidencia, v.destino]; });
  logar({ categoria: 'EXPORTACAO', acao: 'CATALOGO_EXPORTADO', detalhe: { atividades: linhas.length } });
  baixarArquivo(`catalogo-rotina-${hojeISO()}.csv`, csvStringify([COLUNAS_CSV, ...linhas]));
}

function abrirAtividade(atvId, rerender) {
  const d = estado.dados, a = d.atividades.find((x) => x.id === atvId), v = versaoAtual(a);
  logar({ categoria: 'LEITURA', acao: 'ATIVIDADE_CONSULTADA', entidade: 'atividade', entidadeId: a.codigo });
  const historico = el('details', { class: 'bloco-det' }, el('summary', { text: `Versões (${a.versoes.length})` }),
    el('ul', { class: 'lista' }, [...a.versoes].reverse().map((x) => el('li', { class: 'lista__item' },
      el('span', { text: `Desde ${fmtData(x.desde)} · ${PERIODICIDADES[x.periodicidade].nome} · ${x.duracaoMin} min · ${CARGOS[x.cargo]}` }),
      el('span', { class: 'pequeno muted', text: `${x.motivo} — ${nomeUsuario(x.por)}, ${fmtDataHora(x.em)}` })))));
  if (!podeEditar()) {
    abrirSheet(v.nome, el('div', { class: 'grupo' },
      el('p', { class: 'resumo', text: `${a.codigo} · ${CARGOS[v.cargo]} · ${PERIODICIDADES[v.periodicidade].nome} · ${v.duracaoMin} min · ${SITUACOES[v.situacao]}` }),
      el('p', {}, el('span', { class: 'muted', text: 'Produto esperado: ' }), v.evidencia || '—'),
      el('p', { class: 'pequeno muted', text: 'Alterações no catálogo são feitas pela gerência, com motivo e data de vigência.' }), historico), { tipo: 'atividade' });
    return;
  }
  const campo = (rotulo, n) => el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: rotulo }), n);
  const sel = (opcoes, valor) => el('select', { class: 'campo__input' }, opcoes.map(([k, t]) => el('option', { value: k, text: t, selected: String(valor) === String(k) })));
  const f = {
    nome: el('input', { class: 'campo__input', value: v.nome, maxlength: LIMITES.nomeMax }),
    cargo: sel(Object.entries(CARGOS), v.cargo),
    aprovador: sel([['SUPERVISOR', 'Supervisor da UTD'], ['', 'Não definido']], v.aprovador),
    periodicidade: sel(Object.entries(PERIODICIDADES).map(([k, p]) => [k, p.nome]), v.periodicidade),
    situacao: sel(Object.entries(SITUACOES), v.situacao),
    duracaoMin: el('input', { type: 'number', class: 'campo__input', min: 0, max: LIMITES.duracaoMax, step: 5, value: v.duracaoMin, inputmode: 'numeric' }),
    horario: el('input', { class: 'campo__input', value: v.horario, maxlength: 5, placeholder: 'HH:MM, CONT ou vazio' }),
    diaSemana: sel([['', '—'], ...Object.entries(DIAS_SEMANA)], v.diaSemana),
    regraMes: sel([['', '—'], ...Object.entries(REGRAS_MES), ...(v.regraMes && !REGRAS_MES[v.regraMes] ? [[v.regraMes, rotuloRegraMes(v.regraMes)]] : [])], v.regraMes),
    evidencia: el('input', { class: 'campo__input', value: v.evidencia, maxlength: 200 }),
    destino: el('input', { class: 'campo__input', value: v.destino, maxlength: 120, placeholder: 'Área que vai assumir' }),
  };
  const desde = el('input', { type: 'date', class: 'campo__input', min: hojeISO(), value: hojeISO() });
  const motivo = el('textarea', { class: 'campo__input', rows: 2, maxlength: LIMITES.textoMax, placeholder: 'Ex.: validado com o time da UTD em 28/10 (único R)' });
  const corpo = el('div', { class: 'form' },
    el('p', { class: 'pequeno muted', text: `${a.codigo} · A alteração vale a partir da data de vigência; o passado não é recalculado.` }),
    campo('Atividade', f.nome),
    el('div', { class: 'linha' }, campo('Cargo responsável (R)', f.cargo), campo('Aprova (A)', f.aprovador)),
    el('div', { class: 'linha' }, campo('Periodicidade', f.periodicidade), campo('Situação', f.situacao)),
    el('div', { class: 'linha' }, campo('Duração (min)', f.duracaoMin), campo('Horário', f.horario)),
    el('div', { class: 'linha' }, campo('Dia (semanal/quinzenal)', f.diaSemana), campo('Regra do mês', f.regraMes)),
    campo('Produto esperado (evidência)', f.evidencia), campo('Área destino (se transferir)', f.destino),
    el('div', { class: 'linha' }, campo('Vigência a partir de', desde)),
    campo('Motivo da alteração (obrigatório)', motivo), historico);
  abrirSheet(v.nome, corpo, { tipo: 'atividade' }, el('button', { type: 'button', class: 'btn btn--grande', text: v.validada ? 'Salvar nova versão' : 'Validar e salvar', onclick: () => {
    const campos = Object.fromEntries(Object.entries(f).map(([k, n]) => [k, n.value]));
    campos.duracaoMin = Number(campos.duracaoMin);
    if (tratar(() => editarAtividade(a.id, campos, { desde: desde.value, motivo: motivo.value }))) { toast('Nova versão salva no catálogo.', { tipo: 'ok' }); fecharSheet(); rerender(); }
  } }));
}

// ---------- Achados ----------
function abaAchados(corpo, rerender, ach) {
  const ehGestor = estado.usuario.perfil === 'GESTOR';
  const item = (titulo, n, txt, conteudo, nivel = '') => el('section', { class: `bloco${nivel ? ` bloco--${nivel}` : ''}` },
    el('h2', {}, `${titulo} `, el('span', { class: 'abas__n', text: String(n) })), el('p', { class: 'pequeno muted', text: txt }), conteudo);
  const barras = el('div', { class: 'barras' }, ach.capCargo.map((c) => {
    const p = el('span', { class: `barras__preench${c.pct > 1 ? ' alerta' : ' ok'}` });
    p.style.width = `${Math.min(100, Math.round(c.pct * 100))}%`;
    return el('div', { class: 'barras__linha' }, el('span', { text: CARGOS[c.cargo] }), el('span', { class: 'barras__trilho' }, p),
      el('span', { class: `barras__val${c.pct > 1 ? ' txt-alerta' : ''}`, text: `${Math.round(c.pct * 100)}%${c.pct > 1 ? ' ⚠' : ''}` }));
  }));
  anexar(corpo, 
    item('Mais de um responsável (R)', ach.multiR.length, 'A mesma atividade aparece em mais de um cargo: vira esforço duplicado na agenda. Defina um único R e mova os demais para corresponsáveis.',
      el('ul', { class: 'lista' }, ach.multiR.map((g) => el('li', { class: 'lista__item' }, el('span', { text: g.nome }), el('span', { class: 'pequeno muted', text: g.cargos.map((c) => CARGOS[c]).join(' · ') })))), ach.multiR.length ? 'aviso' : ''),
    item('Carga programada × capacidade por cargo (esta semana)', ach.capCargo.filter((c) => c.pct > 1).length, 'Acima de 100%: ou as durações estão altas, ou é efeito do R duplicado. Resolva os dois juntos.', barras),
    item('Sem aprovador (A)', ach.semA.length, 'Sem A, ninguém aprova remanejamento nem responde pela aderência da atividade.',
      el('ul', { class: 'lista' }, ach.semA.slice(0, 12).map(({ a, v }) => el('li', { class: 'lista__item' }, el('span', { text: `${a.codigo} · ${v.nome}` }), el('span', { class: 'pequeno muted', text: CARGOS[v.cargo] }))))),
    item('Periodicidade e duração ainda estimadas', ach.estimadas.length, `${ach.estimadas.length} de ${ach.rotina} atividades de rotina com periodicidade e minutos propostos, não validados com o time. Validar no catálogo (gerência) muda o status.`, null),
    item('Transferências sem aceite da área destino', ach.transfSemAceite.length, 'Enquanto não houver aceite, continuam na agenda da retaguarda (cartão "em transferência").',
      el('ul', { class: 'lista' }, ach.transfSemAceite.map(({ a, v }) => el('li', { class: 'lista__item' },
        el('span', { text: `${v.nome} → ${v.destino}` }),
        ehGestor ? el('button', { type: 'button', class: 'btn btn--sec', text: 'Registrar aceite', onclick: () => abrirAceite(a.id, rerender) }) : el('span', { class: 'pequeno muted', text: CARGOS[v.cargo] }))))),
  );
}

function abrirAceite(atvId, rerender) {
  const a = estado.dados.atividades.find((x) => x.id === atvId), v = versaoAtual(a);
  const desde = el('input', { type: 'date', class: 'campo__input', min: hojeISO(), value: hojeISO() });
  const obs = el('textarea', { class: 'campo__input', rows: 2, maxlength: LIMITES.textoMax, placeholder: 'Quem aceitou, quando e por qual meio (e-mail, ata)' });
  abrirSheet(`Aceite: ${v.nome}`, el('div', { class: 'form' },
    el('p', { class: 'resumo', text: `Destino: ${v.destino}` }),
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Sai da agenda da retaguarda a partir de' }), desde),
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Registro do aceite (obrigatório)' }), obs)),
  { tipo: 'aceite' }, el('button', { type: 'button', class: 'btn btn--grande', text: 'Registrar aceite', onclick: () => {
    if (tratar(() => registrarAceite(atvId, { desde: desde.value, obs: obs.value }))) { toast('Aceite registrado.', { tipo: 'ok' }); fecharSheet(); rerender(); }
  } }));
}

// ---------- Regras ----------
function abaRegras(corpo, rerender) {
  const d = estado.dados, r = regras(d);
  const lista = r.feriados.map((f) => ({ ...f }));
  const cap = el('input', { type: 'number', class: 'campo__input', min: 240, max: 600, step: 1, value: r.capacidadeDiariaMin, disabled: !podeEditar(), inputmode: 'numeric' });
  const ul = el('ul', { class: 'lista' });
  const desenhar = () => ul.replaceChildren(...lista.map((f, i) => el('li', { class: 'lista__item' }, el('span', { text: `${fmtData(f.data)} · ${f.nome}` }),
    podeEditar() ? el('button', { type: 'button', class: 'btn btn--txt', text: 'Remover', 'aria-label': `Remover feriado ${f.nome}`, onclick: () => { lista.splice(i, 1); desenhar(); } }) : null)));
  desenhar();
  const novaData = el('input', { type: 'date', class: 'campo__input', 'aria-label': 'Data do feriado' });
  const novoNome = el('input', { class: 'campo__input', maxlength: 60, placeholder: 'Nome do feriado', 'aria-label': 'Nome do feriado' });
  const motivo = el('textarea', { class: 'campo__input', rows: 2, maxlength: LIMITES.textoMax, placeholder: 'Ex.: feriado municipal de Juazeiro incluído' });
  anexar(corpo, 
    el('section', { class: 'bloco' }, el('h2', { text: 'Capacidade e feriados' }),
      el('p', { class: 'pequeno muted', text: 'Em feriado a rotina diária não acontece; a semanal e a quinzenal deslizam para o próximo dia útil; a mensal conta só dias úteis.' }),
      el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: `Capacidade por dia útil (min) — hoje ${hhmm(r.capacidadeDiariaMin)}` }), cap),
      el('h3', { text: 'Feriados' }), ul,
      podeEditar() ? el('div', { class: 'linha' }, novaData, novoNome, el('button', { type: 'button', class: 'btn btn--sec', text: 'Adicionar', onclick: () => {
        if (!novaData.value || novoNome.value.trim().length < 3) { toast('Informe data e nome do feriado.', { tipo: 'erro' }); return; }
        lista.push({ data: novaData.value, nome: novoNome.value.trim() }); novaData.value = ''; novoNome.value = ''; desenhar();
      } })) : null,
      podeEditar() ? el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Motivo da alteração (obrigatório)' }), motivo) : null,
      podeEditar() ? el('button', { type: 'button', class: 'btn', text: 'Salvar regras', onclick: () => {
        if (tratar(() => alterarRegras({ capacidadeDiariaMin: Number(cap.value), feriados: lista }, motivo.value))) { toast('Regras atualizadas.', { tipo: 'ok' }); rerender(); }
      } }) : el('p', { class: 'pequeno muted', text: 'Somente gerência e administrador alteram as regras.' })),
    el('section', { class: 'bloco' }, el('h2', { text: 'Histórico' }), el('ul', { class: 'lista' }, [...d.regras].reverse().map((x) => el('li', { class: 'lista__item' },
      el('span', { text: `Desde ${fmtData(x.desde)} · ${x.valores.capacidadeDiariaMin} min/dia · ${x.valores.feriados.length} feriado(s)` }),
      el('span', { class: 'pequeno muted', text: `${x.motivo} — ${nomeUsuario(x.por)}` }))))),
  );
}
