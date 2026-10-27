// Tela Mapa: um alimentador por vez, poste a poste, com camadas liga/desliga (árvore, acesso, reincidência, compensação,
// CHI alto, chaves), filtro combinado (E/OU, causa, CHI mínimo), perguntas prontas e os resultados em lista:
// resumo, clusters (trechos) e a árvore de manobra (blocos entre chaves com a sugestão de chave nova).
// Leaflet vem do mesmo vendor do RedeViva (../app/vendor/leaflet). O fundo de ruas (OSM) é opcional e só carrega se ligado.
import { el, preencher, fmtNum, csvStringify, baixarArquivo, hojeISO } from './util.js';
import { estado } from './store.js';
import { CAMADAS, CAUSAS, CHAVES, PERGUNTAS, TIPOS_ACAO, periodos, indexar, statsPostes, st, metricas, clusters, blocos, filtroPostes, montarFiltro, limiarChiAlto, predicados, acaoSugerida } from './dominio.js';
import { abrirPoste, abrirCluster, fmt1, fmt2, fmtChi, fmtR, codPoste, kpi, delta, barra, item } from './ui.js';
import { logar } from './auditoria.js';

const URL_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATRIBUICAO = '© OpenStreetMap';
const ABAS = { resumo: 'Resumo', clusters: 'Trechos', blocos: 'Árvore de manobra' };

let mapa = null, fundo = null, grupoRede, grupoCamadas, grupoClusters, grupoPontos, grupoChaves, renderer, containerAtual = null;

function garantirMapa(container) {
  if (mapa && containerAtual === container) return;
  if (mapa) { mapa.remove(); mapa = null; }
  containerAtual = container;
  mapa = L.map(container, { zoomControl: false, attributionControl: true }); // linhas em SVG (estilo por classe CSS); postes em canvas
  L.control.zoom({ position: 'bottomright' }).addTo(mapa);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(mapa);
  renderer = L.canvas({ padding: 0.3, tolerance: 10 });
  grupoRede = L.layerGroup().addTo(mapa);
  grupoCamadas = L.layerGroup().addTo(mapa);
  grupoClusters = L.layerGroup().addTo(mapa);
  grupoPontos = L.layerGroup().addTo(mapa);
  grupoChaves = L.layerGroup().addTo(mapa);
}

function aplicarFundo() {
  if (!mapa) return;
  if (estado.sel.fundo && !fundo) fundo = L.tileLayer(URL_TILES, { maxZoom: 19, attribution: ATRIBUICAO, crossOrigin: 'anonymous' }).addTo(mapa);
  if (!estado.sel.fundo && fundo) { fundo.remove(); fundo = null; }
  containerAtual?.classList.toggle('mapa--sem-fundo', !estado.sel.fundo);
}

// Postes vão em canvas (milhares de pontos): canvas não lê classe CSS, então a cor vai na opção. Paleta = tokens do app.css.
const ESTILO = {
  base: { color: '#5b6577', fillColor: '#ffffff', weight: 1.2, fillOpacity: 1 },
  chi: { color: '#7f1010', fillColor: '#c62828', weight: 1.5, fillOpacity: 0.85 },
  comp: { color: '#5c3b00', fillColor: '#f2b705', weight: 1.5, fillOpacity: 0.95 },
  reinc: { color: '#3d1b63', fillColor: '#7b3fb5', weight: 1.5, fillOpacity: 0.9 },
  aceso: { color: '#141b2b', weight: 2.5 },
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

function desenhar(idx, stats, cfg, lista, aoTocarPoste, aoTocarCluster, sugestoes) {
  [grupoRede, grupoCamadas, grupoClusters, grupoPontos, grupoChaves].forEach((g) => g.clearLayers());
  const ativas = new Set(cfg.camadas);
  // Rede base
  L.polyline(segmentos(idx, () => true), { className: 'rede', weight: 2.5, interactive: false }).addTo(grupoRede);
  // Camadas de trecho: linhas contínuas por cima da rede
  if (ativas.has('arvore')) L.polyline(segmentos(idx, (p) => p.veg), { className: 'cam-arvore', weight: 7, interactive: false }).addTo(grupoCamadas);
  if (ativas.has('acesso')) L.polyline(segmentos(idx, (p) => p.acesso === 'DIFICIL'), { className: 'cam-acesso', weight: 7, dashArray: '8 6', interactive: false }).addTo(grupoCamadas);
  // Clusters do filtro: contorno largo + número do ranking
  lista.slice(0, 40).forEach((c, i) => {
    const set = new Set(c.ids);
    const segs = c.postes.filter((p) => p.pai && set.has(p.pai)).map((p) => { const q = idx.porId.get(p.pai); return [[q.lat, q.lon], [p.lat, p.lon]]; });
    if (segs.length) L.polyline(segs, { className: 'cluster', weight: 16, interactive: false }).addTo(grupoClusters);
    const m = L.marker([c.centro.lat, c.centro.lon], { keyboard: true, title: `Trecho ${i + 1}: CHI ${fmtChi(c.chi)} — abrir`, zIndexOffset: 900,
      icon: L.divIcon({ html: el('span', { class: 'mk-cluster', text: String(i + 1) }), className: 'mk-wrap', iconSize: [34, 34] }) });
    m.on('click', () => aoTocarCluster(c, i + 1));
    m.addTo(grupoClusters);
  });
  // Postes: cinza; com destaque quando acendem no filtro ou nas camadas de ponto
  const lim = limiarChiAlto(stats), pr = predicados(stats, lim), acende = filtroPostes(idx, stats, cfg);
  const maxChi = Math.max(1, ...[...stats.values()].map((s) => s.chi));
  for (const p of idx.postes) {
    const s = st(stats, p.id);
    let estilo = ESTILO.base, raio = 2.5;
    if (ativas.has('chiAlto') && pr.chiAlto(p)) { estilo = ESTILO.chi; raio = 5 + 9 * Math.sqrt(s.chi / maxChi); }
    else if (ativas.has('comp') && pr.comp(p)) { estilo = ESTILO.comp; raio = 6; }
    else if (ativas.has('reinc') && pr.reinc(p)) { estilo = ESTILO.reinc; raio = 6; }
    if (acende(p)) { estilo = { ...estilo, ...ESTILO.aceso }; raio = Math.max(raio, 6); }
    const c = L.circleMarker([p.lat, p.lon], { renderer, radius: raio, ...estilo });
    c.on('click', () => aoTocarPoste(p.id));
    c.addTo(grupoPontos);
  }
  // Compensação: anel proporcional ao valor
  if (ativas.has('comp')) {
    const maxC = Math.max(1, ...[...stats.values()].map((s) => s.comp));
    for (const p of idx.postes) {
      const s = st(stats, p.id);
      if (s.comp > 0) L.circleMarker([p.lat, p.lon], { renderer, radius: 7 + 14 * Math.sqrt(s.comp / maxC), ...ESTILO.anel, interactive: false }).addTo(grupoPontos);
    }
  }
  // Chaves de manobra
  if (ativas.has('chaves')) {
    for (const p of idx.postes) {
      if (!p.chave) continue;
      const m = L.marker([p.lat, p.lon], { keyboard: true, title: `${CHAVES[p.chave]} no poste ${codPoste(p)}`, zIndexOffset: 1000,
        icon: L.divIcon({ html: el('span', { class: `mk-chave mk-chave--${p.chave.toLowerCase()}`, text: p.chave }), className: 'mk-wrap', iconSize: [30, 22] }) });
      m.on('click', () => aoTocarPoste(p.id));
      m.addTo(grupoChaves);
    }
  }
  // Sugestões de chave nova (árvore de manobra)
  for (const b of sugestoes) {
    const p = b.sugestao.poste;
    const m = L.marker([p.lat, p.lon], { keyboard: true, title: `Chave sugerida no poste ${codPoste(p)}: evita ~${fmtChi(b.sugestao.chiEvitado)} CHI`, zIndexOffset: 1100,
      icon: L.divIcon({ html: el('span', { class: 'mk-sugestao', text: '★' }), className: 'mk-wrap', iconSize: [30, 30] }) });
    m.on('click', () => aoTocarPoste(p.id));
    m.addTo(grupoChaves);
  }
}

export function telaMapa(raiz, ctx, extra = {}) {
  const sel = estado.sel;
  const als = estado.rede.alimentadores;
  if (!als.length) { preencher(raiz, el('div', { class: 'tela' }, el('p', { class: 'vazio', text: 'Base sem alimentadores. Importe a base na tela Dados.' }))); return; }
  if (!als.some((a) => a.id === sel.al)) sel.al = (estado.usuario.conjunto && als.find((a) => a.conjunto === estado.usuario.conjunto)?.id) || als[0].id;
  const P = periodos(), per = P[sel.periodo];
  const idx = indexar(estado.rede, sel.al);
  const stats = statsPostes(idx, per);
  const cfg = { camadas: sel.camadas, modo: sel.modo, causa: sel.causa, chiMin: sel.chiMin };
  const lista = clusters(idx, stats, cfg);
  const listaBlocos = blocos(idx, stats, per);
  const verSugestoes = sel.aba === 'blocos' || sel.camadas.includes('chaves');
  const sugestoes = verSugestoes ? listaBlocos.filter((b) => b.sugestao).slice(0, 5) : [];
  const atualizar = () => telaMapa(raiz, ctx);
  const registrarFiltro = (acao, detalhe) => logar({ categoria: 'LEITURA', acao, entidade: 'alimentador', entidadeId: sel.al, detalhe });

  // ---------- Controles ----------
  const selAl = el('select', { class: 'campo__input', id: 'sel-al', onchange: (e) => { sel.al = e.target.value; registrarFiltro('ALIMENTADOR_ABERTO', {}); atualizar(); } },
    als.map((a) => el('option', { value: a.id, text: `${a.id} · ${a.nome}`, selected: a.id === sel.al })));
  const selPer = el('select', { class: 'campo__input', id: 'sel-per', onchange: (e) => { sel.periodo = e.target.value; atualizar(); } },
    Object.values(P).map((p) => el('option', { value: p.id, text: p.rotulo, selected: p.id === sel.periodo })));

  const perguntas = el('div', { class: 'perguntas', role: 'group', 'aria-label': 'Perguntas prontas' }, PERGUNTAS.map((q) => el('button', { type: 'button', dataset: { foco: `p-${q.id}` }, class: `chip chip--btn chip--pergunta${sel.pergunta === q.id ? ' ativo' : ''}`, 'aria-pressed': String(sel.pergunta === q.id), text: q.texto, onclick: () => {
    if (sel.pergunta === q.id) Object.assign(sel, { pergunta: '', camadas: [], causa: '', modo: 'OU' });
    else Object.assign(sel, { pergunta: q.id, camadas: [...q.camadas], modo: q.modo, causa: q.causa, chiMin: 0, aba: q.aba });
    registrarFiltro('PERGUNTA_PRONTA', { pergunta: q.id, ligada: sel.pergunta === q.id });
    atualizar();
    // No celular o mapa fica acima do painel: depois de escolher a pergunta, mostra a resposta no mapa.
    if (sel.pergunta && matchMedia('(max-width: 860px)').matches) raiz.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  } })));
  const camadas = el('div', { class: 'camadas', role: 'group', 'aria-label': 'Camadas do mapa' }, Object.entries(CAMADAS).map(([k, c]) => {
    const on = sel.camadas.includes(k);
    return el('button', { type: 'button', dataset: { foco: `c-${k}` }, class: `camada camada--${k}${on ? ' ativo' : ''}`, 'aria-pressed': String(on), title: c.desc, onclick: () => {
      sel.camadas = on ? sel.camadas.filter((x) => x !== k) : [...sel.camadas, k];
      sel.pergunta = '';
      registrarFiltro('CAMADA_ALTERADA', { camada: k, ligada: !on });
      atualizar();
    } }, el('span', { class: 'camada__ico', 'aria-hidden': 'true', text: c.icone }), el('span', { text: c.rotulo }));
  }));
  const modo = el('div', { class: 'segmentado', role: 'group', 'aria-label': 'Combinar camadas' }, [['OU', 'Qualquer camada (OU)'], ['E', 'Todas as camadas (E)']].map(([v, t]) =>
    el('button', { type: 'button', dataset: { foco: `m-${v}` }, class: `segmentado__op${sel.modo === v ? ' ativo' : ''}`, 'aria-pressed': String(sel.modo === v), text: t, onclick: () => { sel.modo = v; sel.pergunta = ''; atualizar(); } })));
  const causa = el('select', { class: 'campo__input', id: 'sel-causa', onchange: (e) => { sel.causa = e.target.value; sel.pergunta = ''; registrarFiltro('FILTRO_CAUSA', { causa: sel.causa }); atualizar(); } },
    el('option', { value: '', text: 'Todas as causas' }), Object.entries(CAUSAS).map(([k, v]) => el('option', { value: k, text: v, selected: k === sel.causa })));
  const chiMin = el('input', { class: 'campo__input', id: 'inp-chimin', type: 'number', min: 0, step: 100, inputmode: 'numeric', value: sel.chiMin || '', placeholder: '0',
    onchange: (e) => { sel.chiMin = Math.max(0, Number(e.target.value) || 0); atualizar(); } });
  const fundoBtn = el('button', { type: 'button', class: 'btn btn--sec btn--mini', 'aria-pressed': String(sel.fundo), text: sel.fundo ? 'Fundo de ruas: ligado' : 'Fundo de ruas: desligado', onclick: () => {
    sel.fundo = !sel.fundo; try { localStorage.setItem('raiox-fundo', sel.fundo ? '1' : '0'); } catch { /* sem storage */ }
    aplicarFundo(); fundoBtn.textContent = sel.fundo ? 'Fundo de ruas: ligado' : 'Fundo de ruas: desligado'; fundoBtn.setAttribute('aria-pressed', String(sel.fundo));
  } });
  const limpar = el('button', { type: 'button', class: 'btn btn--txt btn--mini', text: 'Limpar filtros', onclick: () => { Object.assign(sel, { camadas: [], modo: 'OU', causa: '', chiMin: 0, pergunta: '' }); atualizar(); } });
  const q = PERGUNTAS.find((x) => x.id === sel.pergunta);

  // ---------- Resultados ----------
  const M = metricas(idx, per), MA = metricas(idx, P.ANTERIOR_MP);
  const verCluster = (c) => { mapa?.fitBounds(L.latLngBounds(c.postes.map((p) => [p.lat, p.lon])).pad(0.4), { maxZoom: 18 }); };
  const verPoste = (p) => mapa?.setView([p.lat, p.lon], 18);
  const tocarPoste = (id) => abrirPoste(sel.al, id, verPoste);
  const tocarCluster = (c, rank) => abrirCluster(c, rank, verCluster);
  const abas = el('div', { class: 'abas', role: 'tablist' }, Object.entries(ABAS).map(([k, v]) => el('button', { type: 'button', role: 'tab', dataset: { foco: `a-${k}` }, class: `abas__btn${sel.aba === k ? ' ativo' : ''}`, 'aria-selected': String(sel.aba === k), id: `aba-${k}`,
    onclick: () => { sel.aba = k; atualizar(); } }, v, k === 'clusters' ? el('span', { class: 'abas__n', text: String(lista.length) }) : null)));
  let conteudo;
  const trocarAl = (id) => { sel.al = id; registrarFiltro('ALIMENTADOR_ABERTO', { origem: 'sugestao-estado-vazio' }); atualizar(); };
  if (sel.aba === 'clusters') conteudo = abaClusters(lista, montarFiltro(stats, cfg).ativo, tocarCluster, idx, per, () => ondeTem(cfg, per, sel.al), trocarAl);
  else if (sel.aba === 'blocos') conteudo = abaBlocos(idx, listaBlocos, tocarPoste);
  else conteudo = abaResumo(idx, M, MA, P, per);

  const painel = el('div', { class: 'mapa-painel' },
    el('div', { class: 'grade-campos' },
      el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Alimentador' }), selAl),
      el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Período' }), selPer)),
    el('h2', { class: 'painel__tit', text: 'Perguntas prontas' }), perguntas,
    q ? el('p', { class: 'explica', text: q.explica }) : null,
    el('h2', { class: 'painel__tit', text: 'Camadas' }), camadas,
    el('details', { class: 'mais-filtros', open: !!(sel.causa || sel.chiMin || sel.modo === 'E') },
      el('summary', { text: 'Combinar e filtrar' }),
      modo,
      el('div', { class: 'grade-campos' },
        el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Causa' }), causa),
        el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'CHI mínimo do trecho' }), chiMin)),
      el('p', { class: 'muted pequeno', text: 'Árvore e acesso desenham o trecho; reincidência, compensação, CHI alto e causa dizem quais postes acendem dentro dele. Só com camadas de ponto, os postes próximos viram um trecho.' })),
    el('div', { class: 'linha' }, fundoBtn, limpar),
    legenda(sel.camadas, verSugestoes),
    abas, el('div', { role: 'tabpanel', 'aria-labelledby': `aba-${sel.aba}`, class: 'painel-aba' }, conteudo));

  // Reaproveita o contêiner do mapa entre renderizações (o Leaflet não pode ser recriado a cada filtro).
  let caixaMapa = raiz.querySelector('.mapa-caixa');
  if (!caixaMapa) caixaMapa = el('div', { class: 'mapa-caixa', id: 'mapa', role: 'region', 'aria-label': 'Mapa do alimentador. As mesmas informações estão nas listas do painel.' });
  const enquadrar = raiz.dataset.al !== sel.al || extra.enquadrar;
  // Re-render preserva a rolagem do painel e o foco do teclado (quem liga uma camada continua no mesmo botão).
  const rolagem = raiz.querySelector('.mapa-painel')?.scrollTop || 0;
  const foco = document.activeElement?.dataset?.foco || (document.activeElement?.id && raiz.contains(document.activeElement) ? `#${document.activeElement.id}` : '');
  preencher(raiz, el('div', { class: 'mapa-layout' }, painel, caixaMapa));
  painel.scrollTop = rolagem;
  if (foco) (foco.startsWith('#') ? raiz.querySelector(foco) : raiz.querySelector(`[data-foco="${foco}"]`))?.focus();
  garantirMapa(caixaMapa);
  aplicarFundo();
  mapa.invalidateSize();
  desenhar(idx, stats, cfg, lista, tocarPoste, tocarCluster, sugestoes);
  if (enquadrar || !raiz.dataset.al) mapa.fitBounds(L.latLngBounds(idx.postes.map((p) => [p.lat, p.lon])).pad(0.05));
  raiz.dataset.al = sel.al;
  if (extra.cluster) { const c = lista.find((x) => x.idCluster === extra.cluster); if (c) { verCluster(c); tocarCluster(c, lista.indexOf(c) + 1); } }
  if (extra.poste) { const p = idx.porId.get(extra.poste); if (p) { verPoste(p); tocarPoste(p.id); } }
  setTimeout(() => mapa?.invalidateSize(), 60);
}

function legenda(camadas, sugestoes) {
  const it = (cls, txt) => el('span', { class: 'leg-it' }, el('span', { class: `leg-amostra ${cls}`, 'aria-hidden': 'true' }), txt);
  return el('details', { class: 'legenda-mapa' }, el('summary', { text: 'Legenda' }),
    el('div', { class: 'legenda__grupo' },
      it('leg-rede', 'Rede'), camadas.includes('arvore') ? it('leg-arvore', 'Trecho com árvore') : null, camadas.includes('acesso') ? it('leg-acesso', 'Acesso difícil (tracejado)') : null,
      it('leg-cluster', 'Trecho do filtro (número = ranking por CHI)'), it('leg-aceso', 'Poste que acende no filtro'),
      camadas.includes('chiAlto') ? it('leg-chi', 'CHI alto (tamanho = CHI)') : null, camadas.includes('reinc') ? it('leg-reinc', 'Reincidente') : null,
      camadas.includes('comp') ? it('leg-comp', 'Compensação (anel = R$)') : null,
      camadas.includes('chaves') ? el('span', { class: 'leg-it' }, el('span', { class: 'mk-chave mk-chave--rl', text: 'RL', 'aria-hidden': 'true' }), 'Chave: DJ disjuntor, RL religador, CS seccionadora, CF fusível, NA interligação') : null,
      sugestoes ? el('span', { class: 'leg-it' }, el('span', { class: 'mk-sugestao', text: '★', 'aria-hidden': 'true' }), 'Chave sugerida (maior CHI evitado)') : null));
}

function abaResumo(idx, M, MA, P, per) {
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

function abaClusters(lista, ativo, tocar, idx, per, sugerir, trocarAl) {
  if (!ativo) return el('p', { class: 'vazio', text: 'Ligue uma camada (árvore, acesso, reincidente, compensação ou CHI alto) ou escolha uma pergunta pronta para formar os trechos.' });
  if (!lista.length) {
    const outros = sugerir();
    return el('div', { class: 'vazio' }, el('p', { text: `Nenhum trecho atende ao filtro no ${idx.al.id} (${per.rotulo}).` }),
      outros.length ? el('div', {}, el('p', { class: 'pequeno', text: 'Onde o mesmo filtro tem resposta:' }),
        el('div', { class: 'linha' }, outros.map((x) => el('button', { type: 'button', class: 'btn btn--sec btn--mini', text: `${x.al.id}: ${x.n} trecho(s) · CHI ${fmtChi(x.chi)}`, onclick: () => trocarAl(x.al.id) })))) : null);
  }
  const exportar = el('button', { type: 'button', class: 'btn btn--sec btn--mini', text: 'Exportar trechos (CSV)', onclick: () => {
    logar({ categoria: 'EXPORTACAO', acao: 'TRECHOS_EXPORTADOS', entidade: 'alimentador', entidadeId: idx.al.id, detalhe: { trechos: lista.length, camadas: estado.sel.camadas } });
    baixarArquivo(`trechos-${idx.al.id}-${hojeISO()}.csv`, csvStringify([['rank', 'alimentador', 'poste_inicio', 'postes', 'km', 'chi', 'compensacao', 'ocorrencias', 'reincidentes', 'pct_arvore', 'pct_acesso', 'causa_principal', 'acao_sugerida', 'periodo', 'postes_do_trecho'],
      ...lista.map((c, i) => [i + 1, idx.al.id, codPoste(c.montante), c.ids.length, fmt2(c.km), Math.round(c.chi), Math.round(c.comp), c.n, c.reinc, Math.round(c.veg * 100), Math.round(c.acesso * 100), CAUSAS[c.causaPrinc] || '', acaoSugerida(c).texto, per.rotulo, c.postes.map(codPoste).join(' ')])]));
  } });
  const total = lista.reduce((s, c) => s + c.chi, 0);
  return el('div', {},
    el('div', { class: 'linha linha--entre' }, el('p', { class: 'muted pequeno', text: `${lista.length} trecho(s) · CHI somado ${fmtChi(total)}` }), exportar),
    el('ol', { class: 'trechos' }, lista.slice(0, 60).map((c, i) => {
      const a = acaoSugerida(c);
      return el('li', {}, el('button', { type: 'button', class: 'trecho', onclick: () => tocar(c, i + 1) },
        el('span', { class: 'trecho__n', text: String(i + 1) }),
        el('span', { class: 'trecho__txt' },
          el('strong', { text: `Poste ${codPoste(c.montante)} · ${c.ids.length} postes · ${fmt1(c.km)} km` }),
          el('span', { class: 'muted pequeno', text: `CHI ${fmtChi(c.chi)} · ${fmtR(c.comp)} · ${c.n} ocorr. · ${CAUSAS[c.causaPrinc] || 'sem falha'}` }),
          el('span', { class: `etq etq--acao-${a.tipo.toLowerCase()}`, text: TIPOS_ACAO[a.tipo] }))));
    })));
}

/** Árvore de manobra: blocos entre chaves, indentados pela hierarquia (DJ → RL/CS → CF), com CHI originado e chave sugerida. */
function abaBlocos(idx, lista, tocarPoste) {
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
        el('button', { type: 'button', class: 'btn btn--txt', text: `Poste ${codPoste(b.sugestao.poste)}`, onclick: () => tocarPoste(b.sugestao.poste.id) }),
        el('span', { text: ` · evita ~${fmtChi(b.sugestao.chiEvitado)} CHI (${b.sugestao.ocorrencias} ocorrências a jusante) · bloco de ${CHAVES[b.cabeca.chave] || 'início'} ${codPoste(b.cabeca)}${b.pctAcesso > 0.3 ? ' · acesso difícil: prefira telecomandada' : ''}` })))),
      el('p', { class: 'muted pequeno', text: 'Estimativa de 1ª ordem: um defeito a jusante da chave nova deixa de desligar as UCs entre ela e a proteção atual. Não considera recomposição por manobra nem coordenação; confirme com estudo de proteção.' }))
      : el('p', { class: 'muted pequeno', text: 'Nenhum bloco com ocorrências suficientes (2+) para sugerir chave nova no período.' }),
    el('ul', { class: 'arvore-manobra' }, ordem.map((b) => {
      const li = el('li', { class: `no no--n${Math.min(nivel(b), 4)}` },
        el('button', { type: 'button', class: 'no__btn', onclick: () => tocarPoste(b.cabeca.id) },
          el('span', { class: `mk-chave mk-chave--${(b.cabeca.chave || 'dj').toLowerCase()}`, text: b.cabeca.chave || 'INÍCIO' }),
          el('span', { class: 'no__txt' },
            el('strong', { text: `${codPoste(b.cabeca)} · ${b.membros.length} postes · ${fmt1(b.km)} km · ${fmtNum(b.ucs)} UCs (${fmtNum(b.ucsJusante)} a jusante)` }),
            el('span', { class: 'muted pequeno', text: `CHI originado ${fmtChi(b.chi)} · ${b.n} ocorr. · árvore ${Math.round(b.pctVeg * 100)}% · acesso difícil ${Math.round(b.pctAcesso * 100)}%${b.temNA ? ' · tem interligação NA' : ''}` }),
            barra(b.chi / maxChi, b.chi / maxChi > 0.6 ? 'alerta' : ''))));
      return li;
    })));
}

