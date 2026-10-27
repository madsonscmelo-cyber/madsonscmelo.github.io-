// Tela Mapa no padrão do RedeViva (app/): o mapa ocupa a tela, os controles flutuam por cima.
// Esquerda: Perguntas, Filtros, Resultados e Mais (botões redondos). Topo direito: alimentador, camadas rápidas
// (Árvore | Acesso | Chaves) e a faixa de filtro ligado com "Limpar". Canto: legenda. Resultados e fichas abrem no painel lateral.
// Leaflet vem do mesmo vendor do RedeViva (../app/vendor/leaflet). Fundo: ruas (OSM), satélite (Esri), terreno (OpenTopoMap) ou nenhum.
import { el, $, preencher, fmtNum, csvStringify, baixarArquivo, hojeISO, toast } from './util.js';
import { estado } from './store.js';
import { CAMADAS, CAUSAS, CHAVES, PERGUNTAS, TIPOS_ACAO, periodos, indexar, statsPostes, st, metricas, clusters, blocos, filtroPostes, montarFiltro, limiarChiAlto, predicados, acaoSugerida } from './dominio.js';
import { abrirSheet, sheetAtual, abrirPoste, abrirCluster, fmt1, fmt2, fmtChi, fmtR, codPoste, kpi, delta, barra, item } from './ui.js';
import { logar } from './auditoria.js';

// Fundos do mapa. Os provedores recebem só a área vista (coordenadas dos tiles), nunca dados da rede. "Sem fundo" = nada sai do aparelho.
// Produção: tiles próprios (PMTiles) — ver docs/proposta-raio-x-alimentadores.md §6.
export const FUNDOS = {
  ruas: { rotulo: 'Ruas', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap', maxZoom: 19 },
  satelite: { rotulo: 'Satélite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Imagens © Esri, Maxar, Earthstar Geographics', maxZoom: 19 },
  terreno: { rotulo: 'Terreno', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap, SRTM · estilo © OpenTopoMap (CC-BY-SA)', maxZoom: 17, subdomains: 'abc' },
  nenhum: { rotulo: 'Sem fundo' },
};
const ABAS = { clusters: 'Trechos', blocos: 'Árvore de manobra', resumo: 'Resumo' };
const RAPIDAS = ['arvore', 'acesso', 'chaves']; // camadas de um toque no topo do mapa
const MAX_MARCADORES = 500; // acima disso os destaques vão para o canvas (desempenho em alimentador grande)

let mapa = null, fundo = null, fundoAtual = '', grupoRede, grupoCamadas, grupoClusters, grupoPontos, grupoMarcas, renderer;
let ultimo = null; // resultado do último cálculo (alimenta o painel de resultados e a legenda)

function garantirMapa() {
  if (mapa) return;
  mapa = L.map($('#mapa'), { zoomControl: false, attributionControl: true }); // linhas em SVG (estilo por classe CSS); postes em canvas
  L.control.zoom({ position: 'bottomright' }).addTo(mapa);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(mapa);
  renderer = L.canvas({ padding: 0.3, tolerance: 10 });
  grupoRede = L.layerGroup().addTo(mapa);
  grupoCamadas = L.layerGroup().addTo(mapa);
  grupoClusters = L.layerGroup().addTo(mapa);
  grupoPontos = L.layerGroup().addTo(mapa);
  grupoMarcas = L.layerGroup().addTo(mapa);
  montarControles();
}

function aplicarFundo() {
  if (!mapa) return;
  const id = FUNDOS[estado.sel.fundo] ? estado.sel.fundo : 'ruas';
  if (id !== fundoAtual) {
    if (fundo) { fundo.remove(); fundo = null; }
    const f = FUNDOS[id];
    if (f.url) fundo = L.tileLayer(f.url, { maxZoom: f.maxZoom, attribution: f.attribution, subdomains: f.subdomains || 'abc', crossOrigin: 'anonymous' }).addTo(mapa);
    mapa.setMaxZoom(f.maxZoom || 19);
    fundoAtual = id;
  }
  const c = $('#mapa').classList;
  c.toggle('mapa--leve', id === 'nenhum');
  c.toggle('mapa--satelite', id === 'satelite'); // rede e trechos ganham contorno claro sobre a imagem
}

// Postes vão em canvas (milhares de pontos): canvas não lê classe CSS, então a cor vai na opção. Mesmas cores do RedeViva.
const ESTILO = {
  base: { color: '#ffffff', fillColor: '#b0bab4', weight: 1.5, fillOpacity: 1 }, // .mk--ok: "sem pendência nesta visão"
  chi: { color: '#ffffff', fillColor: '#c62828', weight: 2, fillOpacity: 1 },
  comp: { color: '#3d2a00', fillColor: '#f2b705', weight: 2, fillOpacity: 1 },
  reinc: { color: '#ffffff', fillColor: '#7b3fb5', weight: 2, fillOpacity: 1 },
  aceso: { color: '#14201a', fillColor: '#ef8a00', weight: 2, fillOpacity: 1 },
  anel: { color: '#b07d00', fillColor: '#f2b705', weight: 2, fillOpacity: 0.12 },
};

/** Segmentos (poste → pai) que atendem a um teste, em formato de multipolyline. */
function segmentos(idx, teste) {
  const out = [];
  for (const p of idx.postes) {
    if (!p.pai || !teste(p)) continue;
    const q = idx.porId.get(p.pai);
    if (q && teste(q)) out.push([[q.lat, q.lon], [p.lat, p.lon]]);
  }
  return out;
}

export const nivelTrecho = (c, lista) => { const mx = lista[0]?.chi || 0; return !mx || !c.chi ? 'baixo' : c.chi >= mx * 0.5 ? 'alto' : c.chi >= mx * 0.15 ? 'medio' : 'baixo'; };
const icone = (cls, txt, tam = 24) => L.divIcon({ html: el('span', { class: cls, text: txt }), className: 'mk-wrap', iconSize: [tam, tam] });
const verCluster = (c) => mapa?.fitBounds(L.latLngBounds(c.postes.map((p) => [p.lat, p.lon])).pad(0.4), { maxZoom: 18 });
const verPoste = (p) => mapa?.setView([p.lat, p.lon], 18);
const registrar = (acao, detalhe = {}) => logar({ categoria: 'LEITURA', acao, entidade: 'alimentador', entidadeId: estado.sel.al, detalhe });
const voltarResultados = () => abrirResultados();
const tocarPoste = (id) => abrirPoste(estado.sel.al, id, verPoste, voltarResultados);

function desenhar(r) {
  const { idx, stats, cfg, lista, sugestoes } = r;
  [grupoRede, grupoCamadas, grupoClusters, grupoPontos, grupoMarcas].forEach((g) => g.clearLayers());
  const ativas = new Set(cfg.camadas);
  // Rede (como o tronco do RedeViva) e camadas de trecho por cima
  L.polyline(segmentos(idx, () => true), { className: 'tronco rede', weight: 5, interactive: false }).addTo(grupoRede);
  if (ativas.has('arvore')) L.polyline(segmentos(idx, (p) => p.veg), { className: 'cam-arvore', weight: 9, interactive: false }).addTo(grupoCamadas);
  if (ativas.has('acesso')) L.polyline(segmentos(idx, (p) => p.acesso === 'DIFICIL'), { className: 'cam-acesso', weight: 9, dashArray: '10 7', interactive: false }).addTo(grupoCamadas);
  // Só com filtro de ponto (CHI, reincidência, compensação, causa) o poste vira marcador; trecho de árvore/acesso já aparece pela linha.
  const comPonto = !!montarFiltro(stats, cfg).ponto;
  // Trechos do filtro: faixa larga + número do ranking. Sem filtro de ponto o número fica só na lista (evita amontoado de selos).
  lista.slice(0, comPonto ? 15 : 40).forEach((c, i) => {
    const set = new Set(c.ids);
    const segs = c.postes.filter((p) => p.pai && set.has(p.pai)).map((p) => { const q = idx.porId.get(p.pai); return [[q.lat, q.lon], [p.lat, p.lon]]; });
    // Cor do trecho = peso no CHI do filtro (alto ≥ 50% do maior, médio ≥ 15%, baixo); o número repete a ordem (cor não é o único sinal).
    const nivel = nivelTrecho(c, lista);
    if (segs.length) L.polyline(segs, { className: `cluster cluster--${nivel}`, weight: 18, interactive: true }).on('click', () => abrirCluster(c, i + 1, verCluster, voltarResultados)).addTo(grupoClusters);
    const m = L.marker([c.centro.lat, c.centro.lon], { keyboard: true, title: `Trecho ${i + 1}: CHI ${fmtChi(c.chi)} — abrir`, zIndexOffset: 900, icon: icone(`mk-cluster mk-cluster--${nivel}`, String(i + 1), 34) });
    m.on('click', () => abrirCluster(c, i + 1, verCluster, voltarResultados));
    if (comPonto) m.addTo(grupoClusters);
  });
  // Postes: cinza "sem pendência"; os que acendem viram marcador com letra (a cor nunca é o único sinal)
  const pr = predicados(stats, limiarChiAlto(stats)), acende = comPonto ? filtroPostes(idx, stats, cfg) : () => false;
  const destaques = [];
  for (const p of idx.postes) {
    const tipo = ativas.has('chiAlto') && pr.chiAlto(p) ? 'chi' : ativas.has('reinc') && pr.reinc(p) ? 'reinc' : ativas.has('comp') && pr.comp(p) ? 'comp' : acende(p) ? 'aceso' : '';
    if (tipo) { destaques.push([p, tipo]); continue; }
    const c = L.circleMarker([p.lat, p.lon], { renderer, radius: 3.5, ...ESTILO.base });
    c.on('click', () => tocarPoste(p.id));
    c.addTo(grupoPontos);
  }
  const LETRA = { chi: '!', reinc: 'R', comp: '$', aceso: '•' };
  const NOME = { chi: 'CHI alto', reinc: 'reincidente', comp: 'compensação', aceso: 'no filtro' };
  for (const [p, tipo] of destaques) {
    if (destaques.length > MAX_MARCADORES) {
      const c = L.circleMarker([p.lat, p.lon], { renderer, radius: 6, ...ESTILO[tipo] });
      c.on('click', () => tocarPoste(p.id));
      c.addTo(grupoPontos);
      continue;
    }
    const m = L.marker([p.lat, p.lon], { keyboard: true, title: `Poste ${codPoste(p)} · ${NOME[tipo]} · CHI ${fmtChi(st(stats, p.id).chi)}`, zIndexOffset: 500, icon: icone(`mk mk--${tipo}`, LETRA[tipo]) });
    m.on('click', () => tocarPoste(p.id));
    m.addTo(grupoMarcas);
  }
  if (ativas.has('comp')) {
    const maxC = Math.max(1, ...[...stats.values()].map((x) => x.comp));
    for (const p of idx.postes) {
      const s = st(stats, p.id);
      if (s.comp > 0) L.circleMarker([p.lat, p.lon], { renderer, radius: 9 + 14 * Math.sqrt(s.comp / maxC), ...ESTILO.anel, interactive: false }).addTo(grupoPontos);
    }
  }
  if (ativas.has('chaves')) {
    for (const p of idx.postes) {
      if (!p.chave) continue;
      const m = L.marker([p.lat, p.lon], { keyboard: true, title: `${CHAVES[p.chave]} no poste ${codPoste(p)}`, zIndexOffset: 1000,
        icon: L.divIcon({ html: el('span', { class: `mk-chave mk-chave--${p.chave.toLowerCase()}`, text: p.chave }), className: 'mk-wrap', iconSize: [30, 22] }) });
      m.on('click', () => tocarPoste(p.id));
      m.addTo(grupoMarcas);
    }
  }
  for (const b of sugestoes) {
    const p = b.sugestao.poste;
    const m = L.marker([p.lat, p.lon], { keyboard: true, title: `Chave sugerida no poste ${codPoste(p)}: evita ~${fmtChi(b.sugestao.chiEvitado)} CHI`, zIndexOffset: 1100, icon: icone('mk-sugestao', '★', 30) });
    m.on('click', () => tocarPoste(p.id));
    m.addTo(grupoMarcas);
  }
}

// ---------------- Controles flutuantes (Hick: 4 botões; o resto fica dentro deles) ----------------
function fecharPaineis(exceto = '') {
  ['#painel-perguntas', '#painel-filtros', '#mapa-mais'].forEach((s) => { const n = $(s); if (n && s !== exceto) n.hidden = true; });
}
function alternar(id) { const n = $(id); const abrir = n.hidden; fecharPaineis(id); n.hidden = !abrir; }

function montarControles() {
  const btn = (ico, rotulo, fn, id) => el('button', { type: 'button', class: 'ctrl', title: rotulo, 'aria-label': rotulo, id, onclick: fn },
    el('span', { text: ico, 'aria-hidden': 'true' }), el('span', { class: 'ctrl__rot', text: rotulo }));
  const mais = el('div', { id: 'mapa-mais', class: 'mapa-mais', hidden: true },
    el('div', { class: 'segmentado fundos', role: 'group', 'aria-label': 'Fundo do mapa' }, Object.entries(FUNDOS).map(([k, f]) => el('button', { type: 'button', class: 'segmentado__op', dataset: { fundo: k }, text: f.rotulo, onclick: () => trocarFundo(k) }))),
    btn('⬇', 'Exportar trechos', () => { fecharPaineis(); exportarTrechos(); }, 'ctrl-exportar'),
    btn('🎯', 'Enquadrar alimentador', () => { fecharPaineis(); if (ultimo) mapa.fitBounds(L.latLngBounds(ultimo.idx.postes.map((p) => [p.lat, p.lon])).pad(0.05)); }, 'ctrl-enquadrar'));
  preencher($('#mapa-ctrl'),
    btn('💬', 'Perguntas', () => alternar('#painel-perguntas'), 'ctrl-perguntas'),
    btn('⚙', 'Filtros', () => alternar('#painel-filtros'), 'ctrl-filtros'),
    btn('📋', 'Resultados', () => { fecharPaineis(); abrirResultados(); }, 'ctrl-resultados'),
    btn('⋯', 'Mais', () => alternar('#mapa-mais'), 'ctrl-mais'),
    mais);
}

function trocarFundo(k) {
  estado.sel.fundo = k;
  try { localStorage.setItem('raiox-fundo', k); } catch { /* sem storage */ }
  aplicarFundo(); atualizarControles();
  logar({ categoria: 'NAVEGACAO', acao: 'FUNDO_MAPA', detalhe: { fundo: k } });
  if (k === 'nenhum') toast('Sem fundo: nada sai do aparelho.');
}

function atualizarControles() {
  const s = estado.sel;
  const n = s.camadas.filter((c) => !RAPIDAS.includes(c)).length + (s.causa ? 1 : 0) + (s.chiMin ? 1 : 0) + (s.modo === 'E' ? 1 : 0) + (s.periodo !== 'ATUAL' ? 1 : 0);
  const rot = (id, txt, ativo) => { const b = $(id); if (!b) return; b.querySelector('.ctrl__rot').textContent = txt; b.setAttribute('aria-label', txt); b.title = txt; b.classList.toggle('ctrl--ativo', !!ativo); };
  const q = PERGUNTAS.find((x) => x.id === s.pergunta);
  rot('#ctrl-perguntas', q ? q.texto : 'Perguntas', !!q);
  rot('#ctrl-filtros', n ? `Filtros (${n})` : 'Filtros', n > 0);
  rot('#ctrl-resultados', ultimo ? `Resultados (${ultimo.lista.length})` : 'Resultados', false);
  document.querySelectorAll('.fundos .segmentado__op').forEach((b) => { const on = b.dataset.fundo === (FUNDOS[s.fundo] ? s.fundo : 'ruas'); b.classList.toggle('ativo', on); b.setAttribute('aria-pressed', String(on)); });
}

/** Topo direito: alimentador, camadas de um toque e a faixa "Filtro: … · Limpar" (filtro ligado sempre visível). */
function montarTopo(P) {
  const s = estado.sel, als = estado.rede.alimentadores;
  const selAl = el('select', { class: 'busca__inp seletor-al', id: 'sel-al', 'aria-label': 'Alimentador', onchange: (e) => { s.al = e.target.value; registrar('ALIMENTADOR_ABERTO'); renderizar({ enquadrar: true }); } },
    als.map((a) => el('option', { value: a.id, text: `${a.id} · ${a.nome}`, selected: a.id === s.al })));
  const rapidas = el('div', { class: 'visoes', role: 'group', 'aria-label': 'Camadas rápidas' }, RAPIDAS.map((k) => {
    const on = s.camadas.includes(k);
    return el('button', { type: 'button', class: `visoes__btn${on ? ' ativo' : ''}`, 'aria-pressed': String(on), dataset: { foco: `r-${k}` }, title: CAMADAS[k].desc,
      text: k === 'acesso' ? 'Acesso' : CAMADAS[k].rotulo, onclick: () => alternarCamada(k) });
  }));
  const ativos = [];
  const q = PERGUNTAS.find((x) => x.id === s.pergunta);
  if (q) ativos.push(q.texto);
  else {
    const cams = s.camadas.map((c) => CAMADAS[c].rotulo);
    if (cams.length) ativos.push(cams.join(s.modo === 'E' ? ' E ' : ' + '));
    if (s.causa) ativos.push(CAUSAS[s.causa]);
    if (s.chiMin) ativos.push(`CHI ≥ ${fmtNum(s.chiMin)}`);
  }
  if (s.periodo !== 'ATUAL') ativos.push(P[s.periodo].rotulo);
  preencher($('#mapa-topo'), selAl, rapidas,
    ativos.length ? el('div', { class: 'filtros-ativos', role: 'status' }, el('span', { class: 'pequeno', text: `Filtro: ${ativos.join(' · ')}` }),
      el('button', { type: 'button', class: 'btn btn--txt', text: 'Limpar', onclick: () => { Object.assign(s, { camadas: [], modo: 'OU', causa: '', chiMin: 0, pergunta: '', periodo: 'ATUAL' }); registrar('FILTROS_LIMPOS'); renderizar(); } })) : null);
}

function alternarCamada(k) {
  const s = estado.sel, on = s.camadas.includes(k);
  s.camadas = on ? s.camadas.filter((x) => x !== k) : [...s.camadas, k];
  s.pergunta = '';
  registrar('CAMADA_ALTERADA', { camada: k, ligada: !on });
  renderizar();
}

function montarPerguntas() {
  const s = estado.sel;
  const q = PERGUNTAS.find((x) => x.id === s.pergunta);
  preencher($('#painel-perguntas'),
    el('strong', { text: 'Perguntas prontas' }),
    el('div', { class: 'perguntas-lista' }, PERGUNTAS.map((x) => el('button', { type: 'button', class: `pergunta${x.id === s.pergunta ? ' ativo' : ''}`, 'aria-pressed': String(x.id === s.pergunta), dataset: { foco: `p-${x.id}` }, text: x.texto, onclick: () => {
      if (s.pergunta === x.id) Object.assign(s, { pergunta: '', camadas: [], causa: '', modo: 'OU' });
      else Object.assign(s, { pergunta: x.id, camadas: [...x.camadas], modo: x.modo, causa: x.causa, chiMin: 0, aba: x.aba });
      registrar('PERGUNTA_PRONTA', { pergunta: x.id, ligada: s.pergunta === x.id });
      $('#painel-perguntas').hidden = true;
      renderizar();
      if (s.pergunta) abrirResultados();
    } }))),
    q ? el('p', { class: 'explica', text: q.explica }) : el('p', { class: 'muted pequeno', text: 'Cada pergunta liga as camadas e o filtro que respondem a uma decisão. Toque de novo para desligar.' }));
}

function montarFiltros(P) {
  const s = estado.sel;
  const cb = (k) => {
    const i = el('input', { type: 'checkbox', checked: s.camadas.includes(k), dataset: { foco: `c-${k}` } });
    i.addEventListener('change', () => alternarCamada(k));
    return el('label', { class: 'campo--check', title: CAMADAS[k].desc }, i, el('span', { text: `${CAMADAS[k].icone} ${CAMADAS[k].rotulo}` }));
  };
  const campo = (rotulo, controle) => el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: rotulo }), controle);
  const mudar = (k, v, acao) => { s[k] = v; s.pergunta = ''; if (acao) registrar(acao, { [k]: v }); renderizar(); };
  preencher($('#painel-filtros'),
    el('strong', { text: 'Camadas' }),
    Object.keys(CAMADAS).map(cb),
    el('div', { class: 'segmentado', role: 'group', 'aria-label': 'Combinar camadas' }, [['OU', 'Qualquer (OU)'], ['E', 'Todas (E)']].map(([v, t]) =>
      el('button', { type: 'button', class: `segmentado__op${s.modo === v ? ' ativo' : ''}`, 'aria-pressed': String(s.modo === v), dataset: { foco: `m-${v}` }, text: t, onclick: () => mudar('modo', v) }))),
    campo('Período', el('select', { class: 'campo__input', id: 'sel-per', onchange: (e) => mudar('periodo', e.target.value, 'PERIODO_ALTERADO') },
      Object.values(P).map((p) => el('option', { value: p.id, text: p.rotulo, selected: p.id === s.periodo })))),
    campo('Causa', el('select', { class: 'campo__input', id: 'sel-causa', onchange: (e) => mudar('causa', e.target.value, 'FILTRO_CAUSA') },
      el('option', { value: '', text: 'Todas as causas' }), Object.entries(CAUSAS).map(([k, v]) => el('option', { value: k, text: v, selected: k === s.causa })))),
    campo('CHI mínimo do trecho', el('input', { class: 'campo__input', id: 'inp-chimin', type: 'number', min: 0, step: 100, inputmode: 'numeric', value: s.chiMin || '', placeholder: '0',
      onchange: (e) => mudar('chiMin', Math.max(0, Number(e.target.value) || 0)) })),
    el('p', { class: 'muted pequeno', text: 'Árvore e acesso desenham o trecho; reincidente, compensação, CHI alto e causa dizem quais postes acendem dentro dele.' }));
}

function montarLegenda() {
  const s = new Set(estado.sel.camadas);
  const leg = (amostra, txt) => el('span', { class: 'leg' }, amostra, txt);
  const mk = (cls, t = '') => el('i', { class: `mk ${cls}`, text: t, 'aria-hidden': 'true' });
  const linha = (cls) => el('i', { class: `leg-linha ${cls}`, 'aria-hidden': 'true' });
  const legenda = $('#legenda'), aberta = legenda.open;
  preencher(legenda, el('summary', { text: 'Legenda' }),
    el('div', { class: 'legenda__grupo' }, el('strong', { text: 'Rede' }), leg(linha('leg-linha--rede'), 'Rede do alimentador'), leg(mk('mk--ok'), 'Poste'),
      s.has('arvore') ? leg(linha('leg-linha--arvore'), 'Árvore') : null, s.has('acesso') ? leg(linha('leg-linha--acesso'), 'Acesso difícil (tracejado)') : null),
    ultimo?.lista.length ? el('div', { class: 'legenda__grupo' }, el('strong', { text: 'Resultado do filtro' }),
      leg(el('i', { class: 'mk-cluster mk-cluster--leg mk-cluster--alto', text: '1', 'aria-hidden': 'true' }), 'Trecho: CHI alto'),
      leg(el('i', { class: 'mk-cluster mk-cluster--leg mk-cluster--medio', text: '2', 'aria-hidden': 'true' }), 'médio'),
      leg(el('i', { class: 'mk-cluster mk-cluster--leg mk-cluster--baixo', text: '3', 'aria-hidden': 'true' }), 'baixo (nº = ranking)'), leg(mk('mk--aceso', '•'), 'Poste que acende no filtro')) : null,
    s.has('chiAlto') || s.has('reinc') || s.has('comp') ? el('div', { class: 'legenda__grupo' }, el('strong', { text: 'Poste' }),
      s.has('chiAlto') ? leg(mk('mk--chi', '!'), 'CHI alto') : null, s.has('reinc') ? leg(mk('mk--reinc', 'R'), 'Reincidente') : null, s.has('comp') ? leg(mk('mk--comp', '$'), 'Compensação (anel = R$)') : null) : null,
    s.has('chaves') || ultimo?.sugestoes.length ? el('div', { class: 'legenda__grupo' }, el('strong', { text: 'Chaves' }),
      s.has('chaves') ? ['DJ', 'RL', 'CS', 'CF', 'NA'].map((c) => leg(el('i', { class: `mk-chave mk-chave--${c.toLowerCase()}`, text: c, 'aria-hidden': 'true' }), CHAVES[c])) : null,
      ultimo?.sugestoes.length ? leg(el('i', { class: 'mk-sugestao mk-sugestao--leg', text: '★', 'aria-hidden': 'true' }), 'Chave sugerida (maior CHI evitado)') : null) : null);
  legenda.open = aberta;
}

// ---------------- Render ----------------
function calcular() {
  const s = estado.sel, P = periodos(), per = P[s.periodo];
  const idx = indexar(estado.rede, s.al), stats = statsPostes(idx, per);
  const cfg = { camadas: s.camadas, modo: s.modo, causa: s.causa, chiMin: s.chiMin };
  const lista = clusters(idx, stats, cfg), listaBlocos = blocos(idx, stats, per);
  const sugestoes = s.aba === 'blocos' || s.camadas.includes('chaves') ? listaBlocos.filter((b) => b.sugestao).slice(0, 5) : [];
  return { P, per, idx, stats, cfg, lista, listaBlocos, sugestoes };
}

function renderizar({ enquadrar = false } = {}) {
  const ativo = document.activeElement;
  const foco = ativo?.dataset?.foco || (ativo?.id && ativo.closest?.('#view-mapa') ? `#${ativo.id}` : '');
  ultimo = calcular();
  montarTopo(ultimo.P); montarPerguntas(); montarFiltros(ultimo.P); montarLegenda(); atualizarControles();
  aplicarFundo();
  desenhar(ultimo);
  if (enquadrar) mapa.fitBounds(L.latLngBounds(ultimo.idx.postes.map((p) => [p.lat, p.lon])).pad(0.05));
  // Re-render preserva o foco do teclado (quem liga uma camada continua no mesmo controle).
  if (foco) (foco.startsWith('#') ? $(foco) : document.querySelector(`#view-mapa [data-foco="${foco}"]`))?.focus();
  if (sheetAtual()?.tipo === 'resultados') abrirResultados();
  estado.sel.alDesenhado = estado.sel.al;
}

export function telaMapa(raiz, ctx, extra = {}) {
  const s = estado.sel, als = estado.rede.alimentadores;
  if (!als.length) { toast('Base sem alimentadores. Importe a base na tela Dados.', { tipo: 'aviso' }); return; }
  if (!als.some((a) => a.id === s.al)) s.al = (estado.usuario.conjunto && als.find((a) => a.conjunto === estado.usuario.conjunto)?.id) || als[0].id;
  const primeira = !mapa;
  garantirMapa();
  mapa.invalidateSize();
  renderizar({ enquadrar: primeira || s.alDesenhado !== s.al || extra.enquadrar });
  setTimeout(() => mapa?.invalidateSize(), 60);
  if (extra.cluster) { const i = ultimo.lista.findIndex((x) => x.idCluster === extra.cluster); if (i >= 0) { verCluster(ultimo.lista[i]); abrirCluster(ultimo.lista[i], i + 1, verCluster, voltarResultados); } }
  if (extra.poste) { const p = ultimo.idx.porId.get(extra.poste); if (p) { verPoste(p); tocarPoste(p.id); } }
}

// ---------------- Painel de resultados (sheet lateral, como a ficha do RedeViva) ----------------
function abrirResultados() {
  if (!ultimo) return;
  const s = estado.sel, { idx, P, per, lista, listaBlocos } = ultimo;
  const abas = el('div', { class: 'abas', role: 'tablist' }, Object.entries(ABAS).map(([k, v]) => el('button', { type: 'button', role: 'tab', id: `aba-${k}`, class: `abas__btn${s.aba === k ? ' ativo' : ''}`, 'aria-selected': String(s.aba === k),
    onclick: () => { s.aba = k; renderizar(); abrirResultados(); $(`#aba-${k}`)?.focus(); } }, v, k === 'clusters' ? el('span', { class: 'abas__n', text: String(lista.length) }) : null)));
  let conteudo;
  if (s.aba === 'blocos') conteudo = abaBlocos(idx, listaBlocos);
  else if (s.aba === 'resumo') conteudo = abaResumo(metricas(idx, per), metricas(idx, P.ANTERIOR_MP), P, per);
  else conteudo = abaClusters(lista, montarFiltro(ultimo.stats, ultimo.cfg).ativo, idx, per);
  abrirSheet(`${idx.al.id} · ${idx.al.nome}`, el('div', {}, el('p', { class: 'muted pequeno', text: `${idx.al.conjunto} · ${per.rotulo}` }), abas,
    el('div', { role: 'tabpanel', 'aria-labelledby': `aba-${s.aba}`, class: 'painel-aba' }, conteudo)), { tipo: 'resultados' });
}

function exportarTrechos() {
  if (!ultimo?.lista.length) { toast('Nenhum trecho no filtro atual para exportar. Escolha uma pergunta ou ligue uma camada.', { tipo: 'aviso' }); return; }
  const { idx, lista, per } = ultimo;
  logar({ categoria: 'EXPORTACAO', acao: 'TRECHOS_EXPORTADOS', entidade: 'alimentador', entidadeId: idx.al.id, detalhe: { trechos: lista.length, camadas: estado.sel.camadas } });
  baixarArquivo(`trechos-${idx.al.id}-${hojeISO()}.csv`, csvStringify([['rank', 'alimentador', 'poste_inicio', 'postes', 'km', 'chi', 'compensacao', 'ocorrencias', 'reincidentes', 'pct_arvore', 'pct_acesso', 'causa_principal', 'acao_sugerida', 'periodo', 'postes_do_trecho'],
    ...lista.map((c, i) => [i + 1, idx.al.id, codPoste(c.montante), c.ids.length, fmt2(c.km), Math.round(c.chi), Math.round(c.comp), c.n, c.reinc, Math.round(c.veg * 100), Math.round(c.acesso * 100), CAUSAS[c.causaPrinc] || '', acaoSugerida(c).texto, per.rotulo, c.postes.map(codPoste).join(' ')])]));
}

function abaResumo(M, MA, P, per) {
  const causas = Object.entries(M.porCausa).sort((a, b) => b[1] - a[1]);
  const tot = causas.reduce((s, [, v]) => s + v, 0) || 1;
  const comparar = per.id === 'ATUAL';
  return el('div', {},
    el('div', { class: 'kpis kpis--compacto' },
      kpi('DEC', `${fmt2(M.dec)} h`, comparar ? `${P.ANTERIOR_MP.curto}: ${fmt2(MA.dec)} h` : per.rotulo, comparar ? delta(MA.chi ? (M.chi - MA.chi) / MA.chi : null) : null),
      kpi('FEC', fmt2(M.fec), comparar ? `${P.ANTERIOR_MP.curto}: ${fmt2(MA.fec)}` : per.rotulo, comparar ? delta(MA.ci ? (M.ci - MA.ci) / MA.ci : null) : null),
      kpi('CHI', fmtChi(M.chi), `${M.n} ocorrências`),
      kpi('Compensação', fmtR(M.comp), `${M.reincidentes} postes reincidentes`)),
    el('div', { class: 'meta' },
      item('Postes / km', `${fmtNum(M.postes)} · ${fmt1(M.km)} km`), item('UCs', fmtNum(M.ucs)),
      item('Postes com árvore', `${Math.round(M.pctVeg * 100)}%`), item('Postes com acesso difícil', `${Math.round(M.pctAcesso * 100)}%`),
      item('Duração média — acesso difícil', M.durDificil === null ? '—' : `${fmt2(M.durDificil)} h`), item('Duração média — acesso normal', M.durNormal === null ? '—' : `${fmt2(M.durNormal)} h`)),
    M.durDificil && M.durNormal && M.durDificil > M.durNormal * 1.3 ? el('p', { class: 'bloco bloco--aviso pequeno', text: `No acesso difícil a interrupção dura ${fmt1(M.durDificil / M.durNormal)}× mais. Ali o ganho de CHI vem de reduzir o tempo (chave telecomandada, religador, base avançada), não só de evitar a falha.` }) : null,
    el('h3', { text: 'CHI por causa' }),
    causas.length ? el('div', { class: 'barras' }, causas.map(([k, v]) => el('div', { class: 'barras__linha' }, el('span', { text: CAUSAS[k] || k }), barra(v / tot, k === 'VEG' ? 'ok' : ''), el('span', { class: 'barras__val', text: `${Math.round((v / tot) * 100)}%` }))))
      : el('p', { class: 'vazio', text: 'Sem ocorrências no período.' }));
}

/** Estado vazio útil: em quais outros alimentadores o mesmo filtro tem resposta (Jakob: não deixar o usuário num beco). */
function ondeTem(cfg, per, alAtual) {
  return estado.rede.alimentadores.filter((a) => a.id !== alAtual).map((a) => {
    const idx = indexar(estado.rede, a.id), lista = clusters(idx, statsPostes(idx, per), cfg);
    return { al: a, n: lista.length, chi: lista.reduce((s, c) => s + c.chi, 0) };
  }).filter((x) => x.n).sort((a, b) => b.chi - a.chi).slice(0, 3);
}

function abaClusters(lista, ativo, idx, per) {
  if (!ativo) return el('p', { class: 'vazio', text: 'Escolha uma pergunta pronta ou ligue uma camada (árvore, acesso, reincidente, compensação ou CHI alto) para formar os trechos.' });
  if (!lista.length) {
    const outros = ondeTem(ultimo.cfg, per, idx.al.id);
    return el('div', { class: 'vazio' }, el('p', { text: `Nenhum trecho atende ao filtro no ${idx.al.id} (${per.rotulo}).` }),
      outros.length ? el('div', {}, el('p', { class: 'pequeno', text: 'Onde o mesmo filtro tem resposta:' }),
        el('div', { class: 'linha' }, outros.map((x) => el('button', { type: 'button', class: 'btn btn--sec btn--mini', text: `${x.al.id}: ${x.n} trecho(s) · CHI ${fmtChi(x.chi)}`,
          onclick: () => { estado.sel.al = x.al.id; registrar('ALIMENTADOR_ABERTO', { origem: 'sugestao-estado-vazio' }); renderizar({ enquadrar: true }); } })))) : null);
  }
  const total = lista.reduce((s, c) => s + c.chi, 0);
  return el('div', {},
    el('div', { class: 'linha linha--entre' }, el('p', { class: 'muted pequeno', text: `${lista.length} trecho(s) · CHI somado ${fmtChi(total)}` }),
      el('button', { type: 'button', class: 'btn btn--sec btn--mini', text: 'Exportar (CSV)', onclick: exportarTrechos })),
    el('ol', { class: 'trechos' }, lista.slice(0, 60).map((c, i) => {
      const a = acaoSugerida(c);
      return el('li', {}, el('button', { type: 'button', class: 'trecho', onclick: () => { verCluster(c); abrirCluster(c, i + 1, verCluster, voltarResultados); } },
        el('span', { class: `trecho__n mk-cluster--${nivelTrecho(c, lista)}`, text: String(i + 1) }),
        el('span', { class: 'trecho__txt' },
          el('strong', { text: `Poste ${codPoste(c.montante)} · ${c.ids.length} postes · ${fmt1(c.km)} km` }),
          el('span', { class: 'muted pequeno', text: `CHI ${fmtChi(c.chi)} · ${fmtR(c.comp)} · ${c.n} ocorr. · ${CAUSAS[c.causaPrinc] || 'sem falha'}` }),
          el('span', { class: `etq etq--acao-${a.tipo.toLowerCase()}`, text: TIPOS_ACAO[a.tipo] }))));
    })));
}

/** Árvore de manobra: blocos entre chaves, indentados pela hierarquia (DJ → RL/CS → CF), com CHI originado e chave sugerida. */
function abaBlocos(idx, lista) {
  const tocar = (id) => { verPoste(idx.porId.get(id)); tocarPoste(id); };
  const blocoDe = new Map();
  lista.forEach((b) => b.membros.forEach((m) => blocoDe.set(m, b)));
  const pai = (b) => (b.cabeca.pai ? blocoDe.get(b.cabeca.pai) : null);
  const nivel = (b) => { let n = 0, x = pai(b); while (x && n < 6) { n++; x = pai(x); } return n; };
  const filhos = new Map(lista.map((b) => [b, []]));
  const raizes = [];
  lista.forEach((b) => { const p = pai(b); if (p) filhos.get(p).push(b); else raizes.push(b); });
  const ordem = [];
  const visitar = (b) => { ordem.push(b); filhos.get(b).sort((x, y) => idx.tin.get(x.cabeca.id) - idx.tin.get(y.cabeca.id)).forEach(visitar); };
  raizes.forEach(visitar);
  const maxChi = Math.max(1, ...lista.map((b) => b.chi));
  const sug = lista.filter((b) => b.sugestao).sort((a, b) => b.sugestao.chiEvitado - a.sugestao.chiEvitado);
  return el('div', {},
    sug.length ? el('div', { class: 'bloco bloco--destaque' }, el('h3', { text: '★ Onde uma chave nova mais evita CHI' }),
      el('ol', { class: 'lista' }, sug.slice(0, 5).map((b) => el('li', { class: 'lista__item' },
        el('button', { type: 'button', class: 'btn btn--txt', text: `Poste ${codPoste(b.sugestao.poste)}`, onclick: () => tocar(b.sugestao.poste.id) }),
        el('span', { text: ` · evita ~${fmtChi(b.sugestao.chiEvitado)} CHI (${b.sugestao.ocorrencias} ocorrências a jusante) · bloco de ${CHAVES[b.cabeca.chave] || 'início'} ${codPoste(b.cabeca)}${b.pctAcesso > 0.3 ? ' · acesso difícil: prefira telecomandada' : ''}` })))),
      el('p', { class: 'muted pequeno', text: 'Estimativa de 1ª ordem: um defeito a jusante da chave nova deixa de desligar as UCs entre ela e a proteção atual. Não considera recomposição por manobra nem coordenação; confirme com estudo de proteção.' }))
      : el('p', { class: 'muted pequeno', text: 'Nenhum bloco com ocorrências suficientes (2+) para sugerir chave nova no período.' }),
    el('ul', { class: 'arvore-manobra' }, ordem.map((b) => el('li', { class: `no no--n${Math.min(nivel(b), 4)}` },
      el('button', { type: 'button', class: 'no__btn', onclick: () => tocar(b.cabeca.id) },
        el('span', { class: `mk-chave mk-chave--${(b.cabeca.chave || 'dj').toLowerCase()}`, text: b.cabeca.chave || 'INÍCIO' }),
        el('span', { class: 'no__txt' },
          el('strong', { text: `${codPoste(b.cabeca)} · ${b.membros.length} postes · ${fmt1(b.km)} km · ${fmtNum(b.ucs)} UCs (${fmtNum(b.ucsJusante)} a jusante)` }),
          el('span', { class: 'muted pequeno', text: `CHI originado ${fmtChi(b.chi)} · ${b.n} ocorr. · árvore ${Math.round(b.pctVeg * 100)}% · acesso difícil ${Math.round(b.pctAcesso * 100)}%${b.temNA ? ' · tem interligação NA' : ''}` }),
          barra(b.chi / maxChi, b.chi / maxChi > 0.6 ? 'alerta' : '')))))));
}
