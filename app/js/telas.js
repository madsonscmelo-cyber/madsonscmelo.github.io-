// Telas de lista e gestão: Defeitos, Plano, Painel e Produção.
import { el, svgEl, toast, fmtData, fmtDataHora, fmtMoeda, fmtNum, fmtPct, hojeISO, somarDias, semanaISO, csvParse, csvStringify, baixarArquivo, diasEntre } from './util.js';
import { estado, registrar, ativoPorId, equipeDoUsuario, nomeEquipe, nomeUsuario } from './store.js';
import {
  CRITERIOS, criterio, TIPOS_ATIVO, TIPOS_EQUIPE, CONJUNTOS, STATUS_ABERTOS, STATUS_DEFEITO, tipoDefeito,
  scoreRisco, faixaRisco, indicadores, calcularRanking, pendenciasDaEquipe, gerarInspecoesDevidas,
} from './dominio.js';
import { AREA_CONCESSAO } from './seed.js';
import { cartaoDefeito } from './ui.js';
import { atribuirInspecao, distribuirAutomatico, ErroRegra } from './acoes.js';
import { logar } from './auditoria.js';
import { orcamentoDoMes, projecaoCarteira, mesDe } from './custos.js';
import { secaoPlanosKm, indicadoresKmi, completude } from './planos.js';
import { secaoFalhas, secaoOcorrencias, indicadoresEficacia } from './eficacia.js';
import { ETAPAS, temposPorEtapa, idadeCarteira, taxaAchado, chiEmRisco } from './fluxo.js';
import { garantirHistorico, serie, SERIES } from './historico.js';
import { aderenciaUltimas } from './programacao.js';
import { CATEGORIAS, PARAM } from './dominio.js';

const pode = (...p) => p.includes(estado.usuario.perfil);
const secao = (titulo, ...conteudo) => el('section', { class: 'bloco' }, el('h2', { text: titulo }), ...conteudo);
function tentar(fn) {
  try { return fn(); } catch (e) { toast(e instanceof ErroRegra ? e.message : 'Erro inesperado', { tipo: 'erro' }); if (!(e instanceof ErroRegra)) console.error(e); }
}

// ======================= DEFEITOS =======================
const filtroDef = { grupo: 'abertos', sev: '', equipeTipo: '', alimentador: '', minha: null, status: '' };
const GRUPO_DO_STATUS = { IDENTIFICADO: 'abertos', VALIDADO: 'abertos', PROGRAMADO: 'abertos', EXECUTADO: 'verificar', VERIFICADO: 'fechados', REJEITADO: 'fechados', CANCELADO: 'fechados' };

/** Abre a lista de Defeitos já filtrada (usado pelo funil do Painel, pela tela Hoje e pela busca). */
export function definirFiltroDefeitos({ status = '', sev = '', alimentador = '' } = {}) {
  Object.assign(filtroDef, { status, sev, alimentador, equipeTipo: '', minha: false });
  if (status) filtroDef.grupo = GRUPO_DO_STATUS[status] || 'abertos';
}

export function telaDefeitos(raiz, { abrirNoMapa }) {
  const d = estado.dados, eq = equipeDoUsuario();
  if (filtroDef.minha === null) filtroDef.minha = !!eq;
  const grupos = {
    abertos: (f) => STATUS_ABERTOS.includes(f.status),
    verificar: (f) => f.status === 'EXECUTADO',
    fechados: (f) => ['VERIFICADO', 'REJEITADO', 'CANCELADO'].includes(f.status),
  };
  if (!grupos[filtroDef.grupo]) filtroDef.grupo = 'abertos';
  const minhaSet = eq ? new Set(pendenciasDaEquipe(d, eq).filter((p) => p.tipo === 'defeito').map((p) => p.ref.id)) : null;
  const lista = d.defeitos
    .filter(grupos[filtroDef.grupo])
    .filter((f) => !filtroDef.status || f.status === filtroDef.status)
    .filter((f) => !filtroDef.sev || f.severidade === filtroDef.sev)
    .filter((f) => !filtroDef.equipeTipo || tipoDefeito(f.tipoId)?.equipes.includes(filtroDef.equipeTipo))
    .filter((f) => !filtroDef.alimentador || ativoPorId(f.ativoId)?.alimentador === filtroDef.alimentador)
    .filter((f) => !filtroDef.minha || !minhaSet || minhaSet.has(f.id) || f.execucao?.equipeId === eq.id || f.identificadoPorEquipe === eq.id)
    .map((f) => ({ f, s: scoreRisco(f, ativoPorId(f.ativoId)).total }))
    .sort((a, b) => b.s - a.s);

  const sel = (chave, opcoes) => {
    const s = el('select', { class: 'campo__input', 'aria-label': { grupo: 'Situação', sev: 'Severidade', equipeTipo: 'Tipo de equipe exigida', alimentador: 'Alimentador' }[chave] || chave }, opcoes.map(([v, t]) => el('option', { value: v, text: t, selected: filtroDef[chave] === v })));
    s.addEventListener('change', () => { filtroDef[chave] = s.value; telaDefeitos(raiz, { abrirNoMapa }); });
    return s;
  };
  const alims = [...new Set(d.ativos.map((a) => a.alimentador))].sort();
  const contagem = (g) => d.defeitos.filter(grupos[g]).length;
  const abas = el('div', { class: 'abas', role: 'tablist' }, [['abertos', 'Abertos'], ['verificar', 'A verificar'], ['fechados', 'Fechados']].map(([v, t]) =>
    el('button', { type: 'button', role: 'tab', 'aria-selected': String(filtroDef.grupo === v), class: `abas__btn${filtroDef.grupo === v ? ' ativo' : ''}`, onclick: () => { filtroDef.grupo = v; filtroDef.status = ''; telaDefeitos(raiz, { abrirNoMapa }); } },
      el('span', { text: t }), el('span', { class: 'abas__n', text: contagem(v) }))));
  const ativos = [filtroDef.sev, filtroDef.equipeTipo, filtroDef.alimentador].filter(Boolean).length;
  const mais = el('details', { class: 'mais-filtros', open: ativos > 0 }, el('summary', { text: `Mais filtros${ativos ? ` (${ativos} ativo${ativos > 1 ? 's' : ''})` : ''}` }),
    el('div', { class: 'filtros' },
      sel('sev', [['', 'Todas severidades'], ['A', 'Severidade A'], ['B', 'Severidade B'], ['C', 'Severidade C']]),
      sel('equipeTipo', [['', 'Qualquer equipe'], ...Object.entries(TIPOS_EQUIPE)]),
      sel('alimentador', [['', 'Todos alimentadores'], ...alims.map((a) => [a, a])]),
      el('button', { type: 'button', class: 'btn btn--txt', text: 'Exportar CSV', onclick: () => exportarDefeitos(lista.map((x) => x.f)) })));
  const barra = el('div', { class: 'filtros' }, abas);
  if (filtroDef.status) barra.append(el('button', { type: 'button', class: 'chip chip--filtro', 'aria-label': `Remover filtro: etapa ${STATUS_DEFEITO[filtroDef.status]}`, onclick: () => { filtroDef.status = ''; telaDefeitos(raiz, { abrirNoMapa }); } },
    el('span', { text: `Etapa: ${STATUS_DEFEITO[filtroDef.status]}` }), el('span', { 'aria-hidden': 'true', text: ' ✕' })));
  if (eq) {
    const cb = el('input', { type: 'checkbox', checked: filtroDef.minha });
    cb.addEventListener('change', () => { filtroDef.minha = cb.checked; telaDefeitos(raiz, { abrirNoMapa }); });
    barra.append(el('label', { class: 'campo--check' }, cb, el('span', { text: 'Só da minha equipe' })));
  }

  raiz.replaceChildren(
    el('header', { class: 'tela__topo' }, el('h1', { text: 'Defeitos' }), el('span', { class: 'muted', text: `${lista.length} registro(s) · ordenados por risco` })),
    barra, mais,
    el('div', { class: 'grade-cards' }, lista.length ? lista.map(({ f }) => cartaoDefeito(f, { comAtivo: true, aoAbrirAtivo: abrirNoMapa })) : el('p', { class: 'muted', text: 'Nada encontrado com esses filtros.' })),
  );
}

function exportarDefeitos(lista) {
  const linhas = [['id', 'ativo', 'tipo_ativo', 'alimentador', 'conjunto', 'tipo_defeito', 'severidade', 'status', 'score', 'faixa', 'criado_em', 'idade_dias', 'equipe_programada', 'executado_em']];
  for (const f of lista) {
    const a = ativoPorId(f.ativoId), s = scoreRisco(f, a).total;
    linhas.push([f.id, a?.codigo, a?.tipo, a?.alimentador, a?.conjunto, tipoDefeito(f.tipoId)?.nome, f.severidade, STATUS_DEFEITO[f.status], s, faixaRisco(s).nome, f.criadoEm.slice(0, 10), diasEntre(f.criadoEm, hojeISO()), f.equipeId ? nomeEquipe(f.equipeId) : '', f.execucao?.em?.slice(0, 10) || '']);
  }
  baixarArquivo(`defeitos-${hojeISO()}.csv`, csvStringify(linhas));
  registrar('DEFEITOS_EXPORTADOS', 'defeito', null, { registros: lista.length }, 'EXPORTACAO');
}

// ======================= PLANO =======================
const COLUNAS = ['codigo_ativo', 'tipo_ativo', 'latitude', 'longitude', 'alimentador', 'conjunto', 'criterio', 'ultima_inspecao', 'ucs_jusante', 'compensacao_12m_rs'];
let ultimoRelatorio = null;
const filtroInsp = { status: 'abertas', criterio: '' };

function numero(v) {
  if (v === undefined || v === null || String(v).trim() === '') return NaN;
  const s = String(v).trim();
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
}
function data(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : s;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(iso)) ? iso : undefined;
}

/** RF-PLN-01: validação linha a linha; aceita o que é válido e devolve relatório do que foi rejeitado. */
export function importarPlano(texto, nomeArquivo) {
  const d = estado.dados;
  const linhas = csvParse(texto);
  if (!linhas.length) throw new ErroRegra('Arquivo vazio.');
  const cab = linhas[0].map((c) => c.trim().toLowerCase());
  const faltando = COLUNAS.filter((c) => !['ultima_inspecao', 'ucs_jusante', 'compensacao_12m_rs'].includes(c) && !cab.includes(c));
  if (faltando.length) throw new ErroRegra(`Colunas obrigatórias ausentes: ${faltando.join(', ')}`);
  if (linhas.length > 20001) throw new ErroRegra('Limite de 20.000 linhas por importação.');
  const idx = Object.fromEntries(cab.map((c, i) => [c, i]));
  const vistos = new Set(), rejeitados = [];
  let aceitos = 0, novos = 0;
  linhas.slice(1).forEach((l, n) => {
    const v = (c) => (idx[c] === undefined ? '' : String(l[idx[c]] ?? '').trim());
    const linha = n + 2, codigo = v('codigo_ativo').toUpperCase(), tipo = v('tipo_ativo').toUpperCase(), crit = v('criterio').toUpperCase();
    const lat = numero(v('latitude')), lon = numero(v('longitude'));
    const ultima = data(v('ultima_inspecao'));
    const ucs = v('ucs_jusante') ? numero(v('ucs_jusante')) : 0, comp = v('compensacao_12m_rs') ? numero(v('compensacao_12m_rs')) : 0;
    const erro = (motivo) => rejeitados.push({ linha, codigo, motivo });
    if (!/^[A-Z0-9-]{2,30}$/.test(codigo)) return erro('Código do ativo inválido');
    if (!TIPOS_ATIVO[tipo]) return erro(`Tipo de ativo desconhecido: ${tipo || '(vazio)'}`);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return erro('Coordenada não numérica');
    if (lat < AREA_CONCESSAO.latMin || lat > AREA_CONCESSAO.latMax || lon < AREA_CONCESSAO.lonMin || lon > AREA_CONCESSAO.lonMax) return erro('Coordenada fora da área de concessão');
    const c = criterio(crit);
    if (!c) return erro(`Critério inexistente: ${crit || '(vazio)'}`);
    if (!c.tipos.includes(tipo)) return erro(`Critério ${crit} não se aplica a ${TIPOS_ATIVO[tipo]}`);
    if (ultima === undefined) return erro('Data da última inspeção inválida (use AAAA-MM-DD ou DD/MM/AAAA)');
    if (ultima && ultima > hojeISO()) return erro('Última inspeção no futuro');
    if (!Number.isFinite(ucs) || ucs < 0 || !Number.isFinite(comp) || comp < 0) return erro('UCs ou compensação inválidas');
    const chave = `${codigo}|${crit}`;
    if (vistos.has(chave)) return erro('Duplicado no arquivo (ativo + critério)');
    vistos.add(chave);
    let a = d.ativos.find((x) => x.codigo === codigo);
    if (a && a.criterios.includes(crit)) return erro('Ativo já marcado com este critério no plano');
    if (!a) {
      a = { id: codigo, codigo, tipo, alimentador: v('alimentador') || '—', conjunto: v('conjunto') || '—', lat, lon, ucs: 0, comp12m: 0, falhas12m: 0, criterios: [], ultimaInspecao: {} };
      d.ativos.push(a);
      novos++;
    }
    Object.assign(a, { lat, lon, ucs: ucs || a.ucs, comp12m: comp || a.comp12m });
    a.criterios.push(crit);
    if (ultima) a.ultimaInspecao[crit] = ultima;
    aceitos++;
  });
  const geradas = gerarInspecoesDevidas(d);
  const versao = (d.planos.at(-1)?.versao || 0) + 1;
  d.planos.push({ versao, nome: `Importação ${nomeArquivo}`, em: new Date().toISOString(), por: estado.usuario.id, aceitos, rejeitados: rejeitados.length, origem: nomeArquivo });
  registrar('PLANO_IMPORTADO', 'plano', String(versao), { arquivo: nomeArquivo, aceitos, rejeitados: rejeitados.length, novos, inspecoesGeradas: geradas });
  return { aceitos, rejeitados, novos, geradas, versao };
}

export function telaPlano(raiz, ctx) {
  const { abrirNoMapa, abrirTrechoNoMapa, desenharNoMapa } = ctx;
  const d = estado.dados, ind = indicadores(d);
  const atual = d.planos.at(-1);
  const input = el('input', { type: 'file', accept: '.csv,text/csv', class: 'oculto' });
  input.addEventListener('change', async () => {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('Arquivo maior que 5 MB.', { tipo: 'erro' }); return; }
    const texto = await f.text();
    const res = tentar(() => importarPlano(texto, f.name));
    if (res) {
      ultimoRelatorio = res;
      telaPlano(raiz, ctx);
      toast(`Plano v${res.versao}: ${res.aceitos} aceitos, ${res.rejeitados.length} rejeitados, ${res.geradas} inspeções geradas.`, { tipo: res.rejeitados.length ? 'aviso' : 'ok', duracao: 7000 });
    }
  });
  const acoes = el('div', { class: 'linha' },
    pode('GESTOR') ? el('button', { type: 'button', class: 'btn', text: '⬆ Importar plano (CSV)', onclick: () => input.click() }) : null,
    el('a', { class: 'btn btn--sec', href: 'modelos/template-plano.csv', download: 'template-plano.csv', text: 'Baixar template' }),
    el('a', { class: 'btn btn--txt', href: 'modelos/exemplo-plano-com-erros.csv', download: 'exemplo-plano-com-erros.csv', text: 'Exemplo para teste' }),
    pode('GESTOR', 'SUPERVISOR') ? el('button', { type: 'button', class: 'btn btn--sec', text: 'Distribuir pendentes automaticamente', onclick: () => {
      const n = tentar(() => distribuirAutomatico());
      if (n !== undefined) toast(n ? `${n} inspeções distribuídas.` : 'Não havia inspeções sem equipe.', { tipo: 'ok' });
    } }) : null,
    input);

  const rel = ultimoRelatorio ? secao(`Relatório da importação v${ultimoRelatorio.versao}`,
    el('p', { text: `${ultimoRelatorio.aceitos} linha(s) aceita(s) · ${ultimoRelatorio.novos} ativo(s) novo(s) · ${ultimoRelatorio.geradas} inspeção(ões) gerada(s) · ${ultimoRelatorio.rejeitados.length} rejeitada(s)` }),
    ultimoRelatorio.rejeitados.length ? tabela(['Linha', 'Código', 'Motivo'], ultimoRelatorio.rejeitados.map((r) => [r.linha, r.codigo || '—', r.motivo])) : null,
    ultimoRelatorio.rejeitados.length ? el('button', { type: 'button', class: 'btn btn--sec', text: 'Baixar rejeições', onclick: () => logar({ categoria: 'EXPORTACAO', acao: 'REJEICOES_EXPORTADAS' }) && baixarArquivo('rejeicoes-importacao.csv', csvStringify([['linha', 'codigo', 'motivo'], ...ultimoRelatorio.rejeitados.map((r) => [r.linha, r.codigo, r.motivo])])) }) : null,
  ) : null;

  const linhasCrit = CRITERIOS.map((c) => {
    const pc = ind.porCriterio.find((x) => x.criterio.id === c.id);
    return [c.nome, `${c.periodicidadeDias} dias`, d.ativos.filter((a) => a.criterios.includes(c.id)).length, pc.devidas, pc.noPrazo, pc.vencidas, fmtPct(pc.devidas ? pc.noPrazo / pc.devidas : 1)];
  });

  // Inspeções programadas
  const grupos = {
    abertas: (i) => i.status !== 'CONCLUIDA',
    sem: (i) => i.status === 'PENDENTE',
    vencidas: (i) => i.status !== 'CONCLUIDA' && i.prazo < hojeISO(),
    concluidas: (i) => i.status === 'CONCLUIDA',
  };
  const insp = d.inspecoes.filter(grupos[filtroInsp.status]).filter((i) => !filtroInsp.criterio || i.criterioId === filtroInsp.criterio)
    .sort((a, b) => a.prazo.localeCompare(b.prazo));
  const selF = (chave, ops) => {
    const s = el('select', { class: 'campo__input', 'aria-label': { status: 'Situação da inspeção', criterio: 'Critério' }[chave] || chave }, ops.map(([v, t]) => el('option', { value: v, text: t, selected: filtroInsp[chave] === v })));
    s.addEventListener('change', () => { filtroInsp[chave] = s.value; telaPlano(raiz, ctx); });
    return s;
  };
  const tb = el('tbody');
  for (const i of insp.slice(0, 150)) {
    const a = ativoPorId(i.ativoId);
    const tdEq = el('td');
    if (pode('GESTOR', 'SUPERVISOR') && i.status !== 'CONCLUIDA') {
      const s = el('select', { class: 'campo__input campo__input--mini', 'aria-label': `Equipe da inspeção de ${a?.codigo}` }, [['', '—'], ...d.equipes.filter((e) => e.tipo === 'INSPECAO').map((e) => [e.id, e.nome])].map(([v, t]) => el('option', { value: v, text: t, selected: (i.equipeId || '') === v })));
      s.addEventListener('change', () => tentar(() => atribuirInspecao(i.id, s.value)));
      tdEq.append(s);
    } else tdEq.textContent = i.equipeId ? nomeEquipe(i.equipeId) : '—';
    tb.append(el('tr', { class: i.status !== 'CONCLUIDA' && i.prazo < hojeISO() ? 'tr--alerta' : '' },
      el('td', {}, el('button', { type: 'button', class: 'btn btn--txt', text: a?.codigo, onclick: () => abrirNoMapa(a.id) })),
      el('td', { text: i.tipo === 'AVULSA' ? 'Avulsa' : criterio(i.criterioId)?.nome }),
      el('td', { text: a?.alimentador }),
      el('td', { text: fmtData(i.prazo) }),
      el('td', { text: i.status === 'CONCLUIDA' ? `Concluída ${fmtData(i.concluidaEm)}` : i.prazo < hojeISO() ? 'Vencida' : i.status === 'ATRIBUIDA' ? 'Atribuída' : 'Sem equipe' }),
      tdEq));
  }

  raiz.replaceChildren(
    el('header', { class: 'tela__topo' }, el('h1', { text: 'Plano de manutenção' }),
      el('span', { class: 'muted', text: `Versão ${atual.versao} · ${atual.nome} · ${fmtDataHora(atual.em)}` })),
    acoes, rel,
    secaoPlanosKm({ abrirTrechoNoMapa, desenharNoMapa }),
    secaoOcorrencias(),
    secao('Critérios e periodicidade (ativos pontuais)', tabela(['Critério', 'Periodicidade', 'Ativos', 'Devidas até hoje', 'No prazo', 'Vencidas', 'Aderência'], linhasCrit)),
    secao('Inspeções', el('div', { class: 'filtros' },
      selF('status', [['abertas', 'Em aberto'], ['sem', 'Sem equipe'], ['vencidas', 'Vencidas'], ['concluidas', 'Concluídas']]),
      selF('criterio', [['', 'Todos critérios'], ...CRITERIOS.map((c) => [c.id, c.nome])]),
      el('span', { class: 'muted', text: `${insp.length} inspeção(ões)${insp.length > 150 ? ' · exibindo 150' : ''}` })),
    el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['Ativo', 'Critério', 'Alimentador', 'Prazo', 'Situação', 'Equipe'].map((h) => el('th', { text: h })))), tb))),
    secao('Versões do plano', tabela(['Versão', 'Origem', 'Data', 'Responsável', 'Aceitos', 'Rejeitados'], [...d.planos].reverse().map((p) => [p.versao, p.origem, fmtDataHora(p.em), nomeUsuario(p.por), p.aceitos, p.rejeitados]))),
  );
}

function tabela(cabecalho, linhas) {
  return el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
    el('thead', {}, el('tr', {}, cabecalho.map((h) => el('th', { text: h })))),
    el('tbody', {}, linhas.map((l) => el('tr', {}, l.map((c) => el('td', { text: c ?? '—' })))))));
}

// ======================= PAINEL =======================
function kpi(rotulo, valor, detalhe, classe = '') {
  return el('div', { class: `kpi ${classe}` }, el('span', { class: 'kpi__rotulo', text: rotulo }), el('strong', { class: 'kpi__valor', text: valor }), detalhe ? el('span', { class: 'kpi__det', text: detalhe }) : null);
}

function barras(itens, { max, formato = (v) => v, classe = '' } = {}) {
  const m = max ?? Math.max(1, ...itens.map((i) => i.valor));
  return el('div', { class: `barras ${classe}` }, itens.map((i) => {
    const preench = el('span', { class: `barras__preench ${i.classe || ''}` });
    preench.style.width = `${Math.max(2, (i.valor / m) * 100)}%`;
    return el('div', { class: 'barras__linha' }, el('span', { class: 'barras__rot', text: i.rotulo }), el('span', { class: 'barras__trilho' }, preench), el('span', { class: 'barras__val', text: formato(i.valor) }));
  }));
}

function graficoSemanas(semanas) {
  const W = 640, H = 200, pad = 28, n = semanas.length;
  const max = Math.max(1, ...semanas.flatMap((s) => [s.programadas, s.concluidas]));
  const bw = (W - pad * 2) / n;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H + 24}`, class: 'grafico', role: 'img', 'aria-label': 'Inspeções programadas e concluídas por semana' });
  for (let k = 0; k <= 4; k++) {
    const y = H - (k / 4) * (H - pad);
    svg.append(svgEl('line', { x1: pad, x2: W - pad, y1: y, y2: y, class: 'grafico__grade' }), svgEl('text', { x: 2, y: y + 4, class: 'grafico__eixo' }, String(Math.round((max * k) / 4))));
  }
  semanas.forEach((s, i) => {
    const x = pad + i * bw;
    const h1 = (s.programadas / max) * (H - pad), h2 = (s.concluidas / max) * (H - pad);
    svg.append(
      svgEl('rect', { x: x + bw * 0.14, y: H - h1, width: bw * 0.34, height: h1, rx: 3, class: 'grafico__prog' }, svgEl('title', {}, `Programadas: ${s.programadas}`)),
      svgEl('rect', { x: x + bw * 0.52, y: H - h2, width: bw * 0.34, height: h2, rx: 3, class: 'grafico__conc' }, svgEl('title', {}, `Concluídas: ${s.concluidas}`)),
      svgEl('text', { x: x + bw / 2, y: H + 16, 'text-anchor': 'middle', class: 'grafico__eixo' }, s.rotulo));
  });
  return el('div', {}, svg, el('div', { class: 'legenda-inline' }, el('span', { class: 'leg leg--prog', text: 'Programadas (prazo na semana)' }), el('span', { class: 'leg leg--conc', text: 'Concluídas' })));
}

// Painel enxuto: 4 indicadores do funil (com tendência de 12 semanas), o fluxo em duas faixas e o resto em abas.
// Leis aplicadas: Miller (4 números no topo), Hick (detalhe só quando pedido, em abas), Von Restorff (só o que piorou ganha destaque).
const ABAS_PAINEL = [
  ['fluxo', 'Fluxo e gargalo'], ['execucao', 'Execução'], ['risco', 'Risco'], ['eficacia', 'Eficácia'], ['custos', 'Custos'], ['ranking', 'Ranking'], ['auditoria', 'Auditoria'],
];
const estadoPainel = { aba: 'fluxo' };

const fmtValor = (cfg, v) => (v === null || v === undefined ? '—' : cfg.pct ? fmtPct(v) : cfg.dec ? v.toFixed(2).replace('.', ',') : fmtNum(v));
const fmtDelta = (cfg, d) => (cfg.pct ? `${d > 0 ? '+' : ''}${Math.round(d * 100)} p.p.` : `${d > 0 ? '+' : ''}${cfg.dec ? d.toFixed(2).replace('.', ',') : fmtNum(d)}`);

/** Gráfico de linha pequeno (12 semanas) com dica por ponto e descrição textual. */
function sparkline(s, cfg) {
  const W = 132, H = 34, p = 4;
  const val = s.pontos.map((x) => x.valor);
  const nums = val.filter((v) => v !== null);
  if (nums.length < 2) return el('span', { class: 'muted pequeno', text: 'sem histórico' });
  const min = Math.min(...nums), max = Math.max(...nums), amp = max - min || 1;
  const xy = (i, v) => [p + (i * (W - 2 * p)) / (val.length - 1), H - p - ((v - min) / amp) * (H - 2 * p)];
  const pts = val.map((v, i) => (v === null ? null : xy(i, v))).filter(Boolean);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'spark', role: 'img',
    'aria-label': `${cfg.nome}, ${val.length} semanas: de ${fmtValor(cfg, nums[0])} para ${fmtValor(cfg, nums.at(-1))}${s.sintetico ? ' (semanas anteriores sintéticas)' : ''}` },
    svgEl('polyline', { points: pts.map((q) => q.join(',')).join(' '), class: 'spark__linha' }));
  s.pontos.forEach((q, i) => {
    if (q.valor === null) return;
    const [x, y] = xy(i, q.valor);
    const ult = i === s.pontos.length - 1;
    svg.append(svgEl('circle', { cx: x, cy: y, r: ult ? 3.5 : 6, class: ult ? 'spark__ult' : 'spark__alvo' }, svgEl('title', {}, `${q.semana}: ${fmtValor(cfg, q.valor)}${q.sintetico ? ' (sintético)' : ''}`)));
  });
  return svg;
}

function kpiTendencia(chave, valor, meta, detalhe, irPara) {
  const cfg = SERIES[chave], s = serie(chave);
  const abaixo = meta !== null && valor !== null && (cfg.menor ? valor > meta : valor < meta);
  const delta = s.delta === null || Math.abs(s.delta) < 1e-9 ? el('span', { class: 'kpi__delta', text: '= semana anterior' })
    : el('span', { class: `kpi__delta ${s.melhorou ? 'kpi__delta--bom' : 'kpi__delta--ruim'}`, text: `${s.delta > 0 ? '▲' : '▼'} ${fmtDelta(cfg, s.delta)} na semana · ${s.melhorou ? 'melhorou' : 'piorou'}` });
  return el('button', { type: 'button', class: `kpi kpi--tend${abaixo ? ' kpi--alerta' : ''}`, onclick: irPara, 'aria-label': `${cfg.nome}: ${fmtValor(cfg, valor)}. ${detalhe}. Abrir detalhe` },
    el('span', { class: 'kpi__rotulo', text: cfg.nome }),
    el('span', { class: 'kpi__linha' }, el('strong', { class: 'kpi__valor', text: fmtValor(cfg, valor) }), sparkline(s, cfg)),
    abaixo ? el('span', { class: 'etiqueta etiqueta--alerta', text: `⚠ abaixo da meta ${fmtValor(cfg, meta)}` }) : meta !== null ? el('span', { class: 'kpi__det', text: `meta ${fmtValor(cfg, meta)}` }) : null,
    delta, el('span', { class: 'kpi__det', text: detalhe }));
}

/** Contagem dos defeitos (últimos N dias) que já chegaram a cada etapa e quantos estão parados nela agora. */
function faixaDefeitos(dias = 180, ref = hojeISO()) {
  const desde = somarDias(ref, -dias);
  const defs = estado.dados.defeitos.filter((f) => f.criadoEm.slice(0, 10) >= desde);
  return ETAPAS.map((e) => ({
    ...e,
    chegaram: defs.filter((f) => e.status === 'IDENTIFICADO' || (f.historico || []).some((h) => h.status === e.status)).length,
    agora: estado.dados.defeitos.filter((f) => f.status === e.status).length,
  }));
}

/** Fluxo em duas faixas: km (planejado → inspecionado) e defeitos (achados → verificados), ligadas pela taxa de achado. */
function secaoFluxo({ irPara }) {
  const kmi = indicadoresKmi()[0], tx = taxaAchado(90);
  const kmFaixa = [
    { nome: 'No plano', valor: kmi.km, det: `${kmi.trechos} trechos` },
    { nome: 'Em dia', valor: kmi.kmEmDia, det: `inspeção completa dentro da periodicidade` },
    { nome: 'Inspecionado (90 d)', valor: tx.km, det: 'só inspeções completas; patrulha não conta' },
  ];
  const defs = faixaDefeitos();
  const linha = (rotulo, valor, max, base, det, acao, rotAcao) => {
    const preench = el('span', { class: 'funil2__preench' });
    preench.style.width = `${Math.max(2, (valor / (max || 1)) * 100)}%`;
    return el('li', { class: 'funil2__etapa' },
      el('div', { class: 'funil2__cab' }, el('strong', { text: rotulo }),
        el('span', { class: 'funil2__num', text: `${typeof valor === 'number' && !Number.isInteger(valor) ? `${valor.toFixed(1).replace('.', ',')} km` : fmtNum(valor)}${base ? ` · ${fmtPct(valor / base)} da anterior` : ''}` })),
      el('span', { class: 'funil2__trilho', 'aria-hidden': 'true' }, preench),
      el('div', { class: 'funil2__rod' }, el('span', { class: 'muted pequeno', text: det }), acao ? el('button', { type: 'button', class: 'btn btn--txt btn--mini', text: rotAcao, onclick: acao }) : null));
  };
  const maxKm = kmFaixa[0].valor, maxDef = defs[0].chegaram;
  const vaiDefeitos = (st) => () => { definirFiltroDefeitos({ status: st }); irPara('defeitos'); };
  return el('section', { class: 'bloco' }, el('h2', { text: 'Fluxo da manutenção' }),
    el('div', { class: 'funil2' },
      el('div', { class: 'funil2__faixa' }, el('h3', { text: 'Rede (km, plano base)' }),
        el('ol', { class: 'funil2__lista' }, kmFaixa.map((k, i) => linha(k.nome, k.valor, maxKm, i ? kmFaixa[i - 1].valor : null, k.det, i === 1 ? () => irPara('plano') : null, 'Ver trechos no Plano')))),
      el('div', { class: 'funil2__ponte', role: 'note' },
        el('span', { class: 'funil2__seta', 'aria-hidden': 'true', text: '→' }),
        el('strong', { text: tx.media === null ? 'Taxa de achado: —' : `Taxa de achado: ${tx.media.toFixed(2).replace('.', ',')} defeito(s)/km` }),
        el('span', { class: 'muted pequeno', text: `${tx.achados} defeitos validados em ${tx.km.toFixed(1).replace('.', ',')} km inspecionados (90 dias)` })),
      el('div', { class: 'funil2__faixa' }, el('h3', { text: 'Defeitos (criados nos últimos 180 dias)' }),
        el('ol', { class: 'funil2__lista' }, defs.map((e, i) => linha(e.nome, e.chegaram, maxDef, i ? defs[i - 1].chegaram : null,
          e.status === 'VERIFICADO' ? 'fechados com verificação' : `${e.agora} parado(s) nesta etapa agora`,
          e.agora ? vaiDefeitos(e.status) : null, `Ver ${e.agora}`))))),
    el('details', { class: 'bloco-det' }, el('summary', { text: 'Ver o fluxo em tabela' }),
      tabela(['Faixa', 'Etapa', 'Quantidade', '% da etapa anterior', 'Parados agora'], [
        ...kmFaixa.map((k, i) => ['Rede', k.nome, `${k.valor.toFixed(1).replace('.', ',')} km`, i ? fmtPct(k.valor / (kmFaixa[i - 1].valor || 1)) : '—', '—']),
        ...defs.map((e, i) => ['Defeitos', e.nome, e.chegaram, i ? fmtPct(e.chegaram / (defs[i - 1].chegaram || 1)) : '—', e.status === 'VERIFICADO' ? '—' : e.agora])])));
}

function abaFluxo() {
  const tp = temposPorEtapa(), idade = idadeCarteira(), tx = taxaAchado(90), chi = chiEmRisco();
  const maxIdade = Math.max(1, ...idade.map((f) => f.total));
  return el('div', {},
    el('div', { class: 'grade-2' },
      secao('Tempo em cada etapa (mediana, 180 dias)',
        tp.gargalo ? el('p', { class: 'geo geo--alerta', text: `Gargalo: ${tp.gargalo.nome.toLowerCase()} — mediana de ${tp.gargalo.mediana} dia(s)${tp.gargalo.limite ? ` para limite de ${tp.gargalo.limite}` : ''}.` }) : null,
        tabela(['Etapa', 'Mediana (dias)', 'Limite (dias)', 'Defeitos'], tp.linhas.map((l) => [`até ${l.nome.toLowerCase()}`, l.mediana === null ? '—' : String(l.mediana).replace('.', ','), l.limite ?? '—', l.n])),
        el('p', { class: 'muted pequeno', text: 'Conta os dias desde a etapa anterior. Defeito parado entra com os dias que já está esperando — o gargalo real inclui o que ainda não saiu. "Até executado" usa o prazo da severidade B como referência.' })),
      secao('Idade da carteira aberta',
        el('div', { class: 'barras' }, idade.map((f) => {
          const pr = el('span', { class: `barras__preench${f.b === Infinity || f.a > 30 ? ' alerta' : ''}` });
          pr.style.width = `${Math.max(2, (f.total / maxIdade) * 100)}%`;
          return el('div', { class: 'barras__linha' }, el('span', { class: 'barras__rot', text: f.nome }), el('span', { class: 'barras__trilho' }, pr), el('span', { class: 'barras__val', text: `${f.total} (A ${f.A} · B ${f.B} · C ${f.C})` }));
        })))),
    el('div', { class: 'grade-2' },
      secao('Taxa de achado por equipe (90 dias)',
        el('p', { class: 'muted pequeno', text: 'Defeitos validados ÷ km inspecionados completos. Equipe que roda muito km e acha pouco é o primeiro sinal de inspeção superficial — antes do desarme.' }),
        tabela(['Equipe', 'km completos', 'Defeitos validados', 'Defeitos/km', 'Sinal'], tx.equipes.map((e) => [e.nome, e.km.toFixed(1).replace('.', ','), e.achados, e.taxa === null ? '—' : e.taxa.toFixed(2).replace('.', ','), e.alerta ? '⚠ abaixo da metade da média' : '—']))),
      secao('CHI em risco (estimado)',
        el('p', { class: 'kpi__valor', text: `${fmtNum(Math.round(chi.chi))} CHI` }),
        el('p', { class: 'muted pequeno', text: `${fmtNum(chi.ucs)} UCs em ${chi.ativos} ativo(s) com defeito A ou B aberto × ${String(chi.duracaoH).replace('.', ',')} h de duração média (parâmetro). É a exposição se esses ativos falharem, não uma previsão: a probabilidade de falha ainda não está calibrada [SUPOSIÇÃO]. Por isso o "R$ por CHI evitado" ficou para depois do piloto.` }))));
}

export function telaPainel(raiz, ctx) {
  const { abrirNoMapa } = ctx;
  const irPara = ctx.irPara || (() => {});
  const d = estado.dados, ind = indicadores(d);
  garantirHistorico();
  const kmi = indicadoresKmi()[0], comp = completude(), adProg = aderenciaUltimas(), ef = indicadoresEficacia(), meta = PARAM.metas;
  const abas = ABAS_PAINEL.filter(([id]) => id !== 'auditoria' || pode('GESTOR', 'AUDITOR'));
  if (!abas.some(([id]) => id === estadoPainel.aba)) estadoPainel.aba = 'fluxo';
  const abrirAba = (id) => { estadoPainel.aba = id; logar({ categoria: 'NAVEGACAO', acao: 'PAINEL_ABA', detalhe: { aba: id } }); telaPainel(raiz, ctx); raiz.querySelector(`#aba-painel-${id}`)?.focus(); };

  const conteudoAba = {
    fluxo: abaFluxo,
    execucao: () => el('div', {},
      el('div', { class: 'kpis' },
        kpi('Aderência — ativos críticos', fmtPct(ind.aderencia), `trafos/chaves/postes: ${ind.devidas} inspeções devidas`, ind.aderencia >= meta.aderenciaPlano ? '' : 'kpi--alerta'),
        kpi('Inspeções vencidas', fmtNum(ind.vencidas), 'prazo expirado sem execução', ind.vencidas ? 'kpi--alerta' : ''),
        kpi('Lead time defeito→execução', `${ind.leadTime.toFixed(1)} d`, `idade média do backlog ${ind.idadeMedia.toFixed(1)} d`),
        kpi('Aguardando verificação', fmtNum(ind.aguardandoVerificacao), 'executados sem validação do supervisor')),
      el('div', { class: 'grade-2' },
        secao('Evolução do plano (8 semanas)', graficoSemanas(ind.semanas)),
        secao('Aderência por critério', barras(ind.porCriterio.map((p) => ({ rotulo: p.criterio.nome, valor: p.devidas ? p.noPrazo / p.devidas : 1, classe: p.devidas && p.noPrazo / p.devidas < 0.9 ? 'alerta' : 'ok' })), { max: 1, formato: fmtPct })),
        secao('Backlog por tipo de equipe exigida', barras(Object.entries(ind.porEquipeTipo).map(([k, v]) => ({ rotulo: TIPOS_EQUIPE[k], valor: v })))))),
    risco: () => {
      const top = d.defeitos.filter((f) => STATUS_ABERTOS.includes(f.status))
        .map((f) => ({ f, a: ativoPorId(f.ativoId), s: scoreRisco(f, ativoPorId(f.ativoId)).total })).sort((x, y) => y.s - x.s).slice(0, 10);
      const porConj = Object.entries(CONJUNTOS).map(([nome, c]) => {
        const abertos = d.defeitos.filter((f) => STATUS_ABERTOS.includes(f.status) && ativoPorId(f.ativoId)?.conjunto === nome);
        const compC = [...new Set(abertos.filter((f) => f.severidade !== 'C').map((f) => f.ativoId))].reduce((s, id) => s + (ativoPorId(id)?.comp12m || 0), 0) / 12;
        return [nome, `${c.decApurado} / ${c.decMeta}`, `${c.fecApurado} / ${c.fecMeta}`, c.decApurado > c.decMeta ? 'Acima da meta' : 'Dentro da meta', abertos.length, fmtMoeda(compC)];
      });
      return el('div', {},
        el('div', { class: 'kpis' },
          kpi('Críticos > 7 dias', fmtNum(ind.criticosVelhos), 'meta: zero', ind.criticosVelhos ? 'kpi--critico' : ''),
          kpi('Defeitos abertos', fmtNum(ind.abertos), `A ${ind.porSev.A} · B ${ind.porSev.B} · C ${ind.porSev.C}`),
          kpi('Compensação exposta', fmtMoeda(ind.compExpostaMes), `/mês · ${ind.ativosExpostos} ativo(s) com defeito A/B aberto`),
          kpi('Compensação dos ativos críticos', fmtMoeda(ind.compCriticosMes), `/mês · ${ind.ativosCriticos} trafos/chaves reincidentes no plano`)),
        secao('Top 10 defeitos por risco', el('ol', { class: 'top-risco' }, top.map(({ f, a, s }) => el('li', {},
          el('span', { class: `score score--${faixaRisco(s).id}`, text: s }),
          el('button', { type: 'button', class: 'btn btn--txt', text: `${tipoDefeito(f.tipoId)?.nome} — ${a?.codigo} (${a?.alimentador})`, onclick: () => abrirNoMapa(a.id) }),
          el('span', { class: 'muted pequeno', text: `${STATUS_DEFEITO[f.status]} · ${fmtNum(a?.ucs)} UCs · ${fmtMoeda(a?.comp12m)} comp. 12m` }))))),
        secao('Conjuntos — continuidade e exposição', tabela(['Conjunto', 'DEC apurado / meta', 'FEC apurado / meta', 'Situação', 'Defeitos abertos', 'Compensação exposta/mês'], porConj)));
    },
    eficacia: () => secaoFalhas(),
    custos: secaoCustos,
    ranking: () => secao('Ranking das equipes (ponderado)', rankingTabelas(calcularRanking(d))),
    auditoria: () => secao('Trilha de auditoria (últimos 40 eventos)', tabela(['Quando', 'Usuário', 'Ação', 'Entidade'], d.auditoria.slice(0, 40).map((x) => [fmtDataHora(x.em), nomeUsuario(x.usuario), x.acao, `${x.entidade}${x.entidadeId ? ` ${x.entidadeId}` : ''}`]))),
  };

  const tablist = el('div', { class: 'abas abas--rolavel', role: 'tablist', 'aria-label': 'Detalhes do painel' }, abas.map(([id, nome]) => el('button', {
    type: 'button', role: 'tab', id: `aba-painel-${id}`, 'aria-selected': String(estadoPainel.aba === id), 'aria-controls': 'painel-aba-conteudo',
    tabIndex: estadoPainel.aba === id ? 0 : -1, class: `abas__btn${estadoPainel.aba === id ? ' ativo' : ''}`, text: nome, onclick: () => abrirAba(id) })));
  tablist.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = abas.findIndex(([id]) => id === estadoPainel.aba);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? abas.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + abas.length) % abas.length;
    abrirAba(abas[j][0]);
  });
  const sintetico = serie('kmi').sintetico;

  raiz.replaceChildren(
    el('header', { class: 'tela__topo' }, el('h1', { text: 'Painel do plano' }), el('span', { class: 'muted', text: `Semana ${semanaISO(hojeISO()).slice(5)} · toque num indicador para ver o detalhe` })),
    el('div', { class: 'kpis kpis--2x2' },
      kpiTendencia('kmi', kmi.aderencia, meta.aderenciaPlano, `${kmi.kmEmDia.toFixed(1).replace('.', ',')} de ${kmi.km.toFixed(1).replace('.', ',')} km em dia`, () => irPara('plano')),
      kpiTendencia('completude', comp.pct, meta.completude, `${comp.completas}/${comp.realizadas} em 90 dias`, () => abrirAba('fluxo')),
      kpiTendencia('aderenciaProg', adProg, meta.aderenciaProgramacao, 'executado conforme a semana congelada', () => irPara('programacao')),
      kpiTendencia('eficacia', ef.eficacia, meta.eficacia, `${ef.evitaveis} desarme(s) evitável(is) em 180 dias`, () => abrirAba('eficacia'))),
    sintetico ? el('p', { class: 'muted pequeno', text: 'Tendência: semanas anteriores à primeira foto real são sintéticas (demonstração). Em produção, a foto semanal acumula o histórico real.' }) : null,
    secaoFluxo({ irPara }),
    tablist,
    el('div', { id: 'painel-aba-conteudo', role: 'tabpanel', 'aria-labelledby': `aba-painel-${estadoPainel.aba}`, class: 'painel-aba' }, conteudoAba[estadoPainel.aba]()),
    el('footer', { class: 'linha painel-rodape' },
      el('button', { type: 'button', class: 'btn btn--sec', text: 'Exportar defeitos (CSV)', onclick: () => exportarDefeitos(d.defeitos) }),
      el('button', { type: 'button', class: 'btn btn--sec', text: 'Imprimir / PDF', onclick: () => { logar({ categoria: 'EXPORTACAO', acao: 'PAINEL_IMPRESSO' }); window.print(); } })),
  );
}

/** Orçamento do mês e quanto custaria a carteira sem data (referência para decidir o que programar). */
function secaoCustos() {
  const mes = mesDe(hojeISO()), o = orcamentoDoMes(mes), proj = projecaoCarteira();
  const linhas = o.linhas.map((l) => {
    const p = proj.find((x) => x.categoria === l.categoria);
    return [CATEGORIAS[l.categoria], fmtMoeda(l.orcado), fmtMoeda(l.realizado), fmtMoeda(l.comprometido), fmtMoeda(l.saldo), `${fmtMoeda(p.valor)} (${p.qtd})`, p.criticos ? `${fmtMoeda(p.valorCriticos)} (${p.criticos})` : '—'];
  });
  linhas.push(['Total', fmtMoeda(o.total.orcado), fmtMoeda(o.total.realizado), fmtMoeda(o.total.comprometido), fmtMoeda(o.total.saldo),
    fmtMoeda(proj.reduce((t, p) => t + p.valor, 0)), fmtMoeda(proj.reduce((t, p) => t + p.valorCriticos, 0))]);
  const caberia = o.total.saldo >= proj.reduce((t, p) => t + p.valorCriticos, 0);
  return secao(`Custo e orçamento — ${new Date(`${mes}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`,
    tabela(['Categoria', 'Orçado', 'Realizado', 'Programado', 'Saldo', 'Carteira sem data', 'Só críticos (A)'], linhas),
    el('p', { class: `geo ${caberia ? 'geo--ok' : 'geo--alerta'}`, text: caberia
      ? 'O saldo do mês cobre todos os defeitos críticos ainda sem data.'
      : `O saldo do mês (${fmtMoeda(o.total.saldo)}) não cobre os críticos sem data — priorize na Programação ou revise o orçamento.` }));
}

function rankingTabelas(rk, destaque) {
  const tabelas = Object.entries(rk).map(([tipo, linhas]) => el('div', { class: 'ranking' },
    el('h3', { text: TIPOS_EQUIPE[tipo] }),
    el('div', { class: 'tabela-wrap', 'aria-label': `Ranking — ${TIPOS_EQUIPE[tipo]}` }, el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['#', 'Equipe', 'Pontos', 'Insp.', 'Def. válidos', 'Rejeit.', 'Execuções', 'Estornos'].map((h) => el('th', { text: h })))),
      el('tbody', {}, linhas.map((r, i) => el('tr', { class: r.equipe.id === destaque ? 'tr--destaque' : '' },
        [i + 1, r.equipe.nome, r.pontos, r.inspecoes, r.defeitosValidados, r.defeitosRejeitados, r.execucoes, r.estornos].map((c) => el('td', { text: c })))))))));
  return el('div', {},
    el('div', { class: 'grade-2' }, tabelas),
    el('p', { class: 'muted pequeno', text: 'Pontua: inspeção no prazo (1 + peso do critério), defeito validado (A10/B6/C3), execução verificada (A15/B9/C5). Penaliza: defeito rejeitado (−3) e reincidência no ativo em até 90 dias após a baixa (estorno).' }));
}

// ======================= PRODUÇÃO =======================
export function telaProducao(raiz, { abrirNoMapa }) {
  const d = estado.dados, eq = equipeDoUsuario(), rk = calcularRanking(d);
  if (!eq) {
    raiz.replaceChildren(el('header', { class: 'tela__topo' }, el('h1', { text: 'Produção das equipes' })), rankingTabelas(rk));
    return;
  }
  const linhas = rk[eq.tipo] || [];
  const pos = linhas.findIndex((r) => r.equipe.id === eq.id);
  const r = linhas[pos];
  const pend = pendenciasDaEquipe(d, eq);
  const minhas = d.auditoria.filter((x) => x.usuario === estado.usuario.id).slice(0, 15);
  raiz.replaceChildren(
    el('header', { class: 'tela__topo' }, el('h1', { text: `Minha produção — ${eq.nome}` }), el('span', { class: 'muted', text: TIPOS_EQUIPE[eq.tipo] })),
    el('div', { class: 'kpis' },
      kpi('Posição no ranking', `${pos + 1}º de ${linhas.length}`, TIPOS_EQUIPE[eq.tipo], pos === 0 ? 'kpi--ok' : ''),
      kpi('Pontos', fmtNum(r?.pontos), 'ponderados por severidade e validação'),
      kpi('Inspeções concluídas', fmtNum(r?.inspecoes)),
      kpi('Defeitos validados', fmtNum(r?.defeitosValidados), `${r?.defeitosRejeitados || 0} rejeitado(s)`),
      kpi('Execuções verificadas', fmtNum(r?.execucoes), `${r?.estornos || 0} estorno(s) por reincidência`, r?.estornos ? 'kpi--alerta' : '')),
    secao(`Minhas pendências (${pend.length})`, el('ul', { class: 'lista' }, pend.slice(0, 60).map((p) => {
      const a = ativoPorId(p.ativoId);
      const txt = p.tipo === 'inspecao' ? `Inspeção · ${criterio(p.ref.criterioId)?.nome} · prazo ${fmtData(p.ref.prazo)}` : `Defeito · ${tipoDefeito(p.ref.tipoId)?.nome} · ${STATUS_DEFEITO[p.ref.status]}`;
      return el('li', { class: 'lista__item' }, el('button', { type: 'button', class: 'btn btn--txt', text: `${a?.codigo}`, onclick: () => abrirNoMapa(a.id) }), el('span', { class: 'pequeno', text: txt }));
    }))),
    secao('Minhas últimas ações', minhas.length ? tabela(['Quando', 'Ação', 'Registro'], minhas.map((x) => [fmtDataHora(x.em), x.acao, x.entidadeId])) : el('p', { class: 'muted', text: 'Nenhuma ação nesta sessão ainda.' })),
    secao('Ranking do meu tipo de equipe', rankingTabelas({ [eq.tipo]: linhas }, eq.id)),
  );
}
