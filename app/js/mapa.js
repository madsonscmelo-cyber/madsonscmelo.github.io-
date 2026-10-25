// Mapa (Leaflet + OSM). Produção: trocar por MapLibre + tiles vetoriais próprios (PMTiles), ver especificação §11.
/* global L */
import { el, hojeISO, semanaISO } from './util.js';
import { estado, equipeDoUsuario } from './store.js';
import { pendenciasDaEquipe, tipoDefeito, STATUS_ABERTOS, TIPOS_ATIVO } from './dominio.js';
import { CONFIG } from './config.js';
import { trechos as trechosInspecao, situacaoTrecho, areas, areaAtiva, tipoPlano } from './planos.js';

// Servidor de mapas vem da configuração: o servidor público do OpenStreetMap só serve para demonstração
// (a política de uso dele proíbe baixar quadros em massa, que é o que o pacote offline faz).
const URL_TILES = CONFIG.mapa.urlTiles;
const ATRIBUICAO = CONFIG.mapa.atribuicao;
let mapa, camadaRuas, grupoAtivos, grupoTrechos, grupoAreas, grupoTrilha, grupoDesenho, marcadorUsuario, circuloUsuario, retangulo;
let pontosDesenho = [];
// Fundo de ruas só carrega quando o mapa aparece: atrás da tela de login ou da tela Hoje ele só gastava dados
// e virava o "maior elemento" da página (LCP 4,3 s no celular).
let fundoLiberado = false, fundoLeve = false;
let modo = null, cantoA = null, retornos = {};

export const filtros = {
  camadas: { defeitos: true, inspecoes: true, emDia: true, trechos: true, planos: true },
  alimentador: '',
  equipeTipo: '',
  minhaEquipe: false,
  visao: 'defeitos', // uma codificação de cor por vez: defeitos | plano | semana | tudo (equipe)
};

/** Visões do mapa: cada uma mostra uma pergunta só (corrige a mistura de 3 codificações de cor). */
export const VISOES = {
  tudo: { nome: 'Pendências', dica: 'Tudo o que é da sua equipe: defeitos e inspeções' },
  defeitos: { nome: 'Defeitos', dica: 'Defeitos abertos por severidade' },
  plano: { nome: 'Plano', dica: 'Inspeções e trechos pela situação no plano' },
  semana: { nome: 'Semana', dica: 'Programado e executado nesta semana' },
};

// ---------- Índice (recalculado só quando os dados mudam, não a cada arrasto) ----------
let indice = null;
export function dadosMudaram() { indice = null; }
function obterIndice(d) {
  // Também refaz se as listas foram trocadas ou mudaram de tamanho (importação, restauração, testes).
  if (indice && indice.refD === d.defeitos && indice.nD === d.defeitos.length && indice.refI === d.inspecoes && indice.nI === d.inspecoes.length) return indice;
  const defs = new Map(), insp = new Map();
  const add = (m, k, v) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };
  for (const f of d.defeitos) add(defs, f.ativoId, f);
  for (const i of d.inspecoes) if (i.status !== 'CONCLUIDA') add(insp, i.ativoId, i);
  indice = { defs, insp, refD: d.defeitos, nD: d.defeitos.length, refI: d.inspecoes, nI: d.inspecoes.length };
  return indice;
}

/** Estado do ativo dentro da visão escolhida (mesmas regras de estadoAtivo, via índice). */
function estadoNaVisao(ix, a, hoje, semana) {
  const v = filtros.visao;
  const defs = ix.defs.get(a.id) || [], pend = ix.insp.get(a.id) || [];
  const neutro = a.criterios?.length ? { id: 'ok', nome: 'Em dia' } : { id: 'neutro', nome: 'Sem criticidade marcada' };
  const sevAberta = () => { const ab = defs.filter((f) => STATUS_ABERTOS.includes(f.status)); if (!ab.length) return null; const sev = ['A', 'B', 'C'].find((x) => ab.some((f) => f.severidade === x)); return { id: `sev-${sev}`, nome: `Defeito aberto (${sev})` }; };
  const inspecao = () => (pend.some((i) => i.prazo < hoje) ? { id: 'insp-vencida', nome: 'Inspeção vencida' } : pend.length ? { id: 'insp-pendente', nome: 'Inspeção programada' } : null);
  const executado = () => (defs.some((f) => f.status === 'EXECUTADO') ? { id: 'executado', nome: 'Executado — aguarda verificação' } : null);
  if (v === 'tudo') return sevAberta() || inspecao() || executado() || neutro;
  if (v === 'defeitos') return sevAberta() || executado() || neutro;
  if (v === 'plano') return inspecao() || neutro;
  if (defs.some((f) => f.status === 'PROGRAMADO' && f.programacao?.semana === semana)) return { id: 'programada', nome: 'Programado nesta semana' };
  if (defs.some((f) => f.execucao && semanaISO(f.execucao.em.slice(0, 10)) === semana)) return { id: 'executado', nome: 'Executado nesta semana' };
  return neutro;
}

// Detalhe por zoom: afastado mostra só o que pede ação (agrupado); postes sem pendência só de perto.
const ZOOM_NEUTROS = 16, ZOOM_EQUIPAMENTOS = 15, LIMITE_MARCADORES = 250, CELULA_PX = 64, RAIO_VIZINHO_PX = 22;
let renderPontos, grupoPontos, pino = null, marcaCanto = null, selecionado = null, pendente = false, desenhados = [];

export function iniciarMapa(container, cb) {
  retornos = cb;
  mapa = L.map(container, { zoomControl: false, preferCanvas: false }).setView([-15.836, -48.058], 14);
  L.control.zoom({ position: 'bottomright' }).addTo(mapa);
  camadaRuas = L.tileLayer(URL_TILES, { maxZoom: 19, crossOrigin: 'anonymous', attribution: ATRIBUICAO });
  // Pontos sem pendência: um único canvas (milhares de pontos sem criar milhares de elementos na página).
  renderPontos = L.canvas({ padding: 0.25, tolerance: 14 });
  grupoAreas = L.layerGroup().addTo(mapa);
  grupoTrechos = L.layerGroup().addTo(mapa);
  grupoPontos = L.layerGroup().addTo(mapa);
  grupoTrilha = L.layerGroup().addTo(mapa);
  grupoDesenho = L.layerGroup().addTo(mapa);
  grupoAtivos = L.layerGroup().addTo(mapa);
  mapa.on('click', aoClicar);
  let t = null;
  mapa.on('moveend', () => { clearTimeout(t); t = setTimeout(desenhar, 60); });
  return mapa;
}

export const mapaLeaflet = () => mapa;

function aoClicar(ev) {
  const { lat, lng } = ev.latlng;
  if (modo === 'simular') {
    retornos.onSimular?.({ lat, lon: lng });
  } else if (modo === 'avulso') {
    // Nada é criado no toque: o alfinete aparece, pode ser arrastado e só vira ativo ao confirmar.
    colocarPino(ev.latlng);
  } else if (modo === 'desenho') {
    pontosDesenho.push([lat, lng]);
    redesenharDesenho();
    retornos.onDesenho?.(pontosDesenho.slice());
  } else if (modo === 'area') {
    if (!cantoA) {
      cantoA = ev.latlng;
      marcaCanto = L.circleMarker(cantoA, { radius: 7, className: 'desenho-vertice', interactive: false }).addTo(mapa);
      retornos.onCanto?.(1);
    } else {
      const b = L.latLngBounds(cantoA, ev.latlng);
      definirModo(null);
      desenharArea(b);
      retornos.onArea?.(b);
    }
  }
}

function colocarPino(ll) {
  if (!pino) {
    pino = L.marker(ll, { draggable: true, autoPan: true, zIndexOffset: 3000, keyboard: true, title: 'Posição do ativo avulso (arraste para ajustar)',
      icon: L.divIcon({ html: el('div', { class: 'pino', 'aria-hidden': 'true' }), className: 'mk-wrap', iconSize: [44, 44], iconAnchor: [22, 42] }) }).addTo(mapa);
    pino.on('dragend', () => retornos.onPino?.(posicaoPino()));
  } else pino.setLatLng(ll);
  retornos.onPino?.(posicaoPino());
}
export const posicaoPino = () => (pino ? { lat: pino.getLatLng().lat, lon: pino.getLatLng().lng } : null);
function removerPino() { if (pino) { pino.remove(); pino = null; } }

/** Liga/desliga um modo. Cancelar = chamar de novo com o mesmo modo, ou definirModo(null). */
export function definirModo(novo) {
  modo = novo === null || modo === novo ? null : novo;
  cantoA = null;
  if (marcaCanto) { marcaCanto.remove(); marcaCanto = null; }
  if (modo !== 'avulso') removerPino();
  container().classList.toggle('mapa--modo', !!modo);
  if (modo !== 'desenho') limparDesenho();
  retornos.onModo?.(modo);
  return modo;
}
export const modoAtual = () => modo;
const container = () => mapa.getContainer();

function redesenharDesenho() {
  grupoDesenho.clearLayers();
  pontosDesenho.forEach((p) => L.circleMarker(p, { radius: 6, className: 'desenho-vertice', interactive: false }).addTo(grupoDesenho));
  if (pontosDesenho.length >= 2) L.polygon(pontosDesenho, { className: 'desenho-area', interactive: false }).addTo(grupoDesenho);
}
export function limparDesenho() { pontosDesenho = []; grupoDesenho?.clearLayers(); }
export const pontosDoDesenho = () => pontosDesenho.slice();
export function desfazerPontoDesenho() { pontosDesenho.pop(); redesenharDesenho(); retornos.onDesenho?.(pontosDesenho.slice()); }

/** Trajeto em gravação (inspeção de trecho, patrulha ou voo de drone). */
export function desenharTrilha(pts) {
  if (!grupoTrilha) return;
  grupoTrilha.clearLayers();
  if (pts?.length > 1) L.polyline(pts, { className: 'trilha', interactive: false }).addTo(grupoTrilha);
}

export function desenharArea(bounds) {
  limparArea();
  retangulo = L.rectangle(bounds, { className: 'area-selecao', weight: 2 }).addTo(mapa);
}
export function limparArea() {
  if (retangulo) { retangulo.remove(); retangulo = null; }
}

// Alvo de toque de 44 px (Fitts), mesmo com o desenho de 22 px.
function icone(ativo, est, sel, outro) {
  const n = el('div', { class: `mk mk--${ativo.tipo.toLowerCase()} mk--${est.id}${outro ? ' mk--outro' : ''}${sel ? ' mk--sel' : ''}` });
  return L.divIcon({ html: n, className: 'mk-wrap mk-wrap--alvo', iconSize: [44, 44] });
}
function iconeGrupo(qtd, pior) {
  const n = el('div', { class: `mk-grupo mk-grupo--${pior}` }, el('span', { text: qtd > 999 ? `${Math.round(qtd / 100) / 10}k` : String(qtd) }));
  return L.divIcon({ html: n, className: 'mk-wrap mk-wrap--alvo', iconSize: [48, 48] });
}
const PESO = { 'sev-A': 6, 'insp-vencida': 5, 'sev-B': 4, programada: 3, 'insp-pendente': 3, 'sev-C': 2, executado: 1 };

/** Pedido de redesenho: se o mapa não está visível, só marca como pendente (desenha ao abrir). */
export function renderizar(selecionadoId) {
  if (!mapa) return;
  selecionado = selecionadoId ?? null;
  if (container().offsetParent === null) { pendente = true; return; }
  desenhar();
}
export function renderizarPendente() { if (pendente) { pendente = false; desenhar(); } }

let contador = 0;
export const estatisticaDesenho = () => ({ desenhos: contador, elementos: desenhados.length });

function desenhar() {
  if (!mapa) return;
  pendente = false;
  contador++;
  const d = estado.dados, ix = obterIndice(d), z = mapa.getZoom(), vb = mapa.getBounds().pad(0.2);
  const s0 = vb.getSouth(), n0 = vb.getNorth(), w0 = vb.getWest(), e0 = vb.getEast();
  const naTela = (lat, lon) => lat >= s0 && lat <= n0 && lon >= w0 && lon <= e0;
  grupoTrechos.clearLayers(); grupoAtivos.clearLayers(); grupoAreas.clearLayers(); grupoPontos.clearLayers();
  desenhados = [];
  const visao = filtros.visao, hoje = hojeISO(), semana = semanaISO(hoje);
  if (filtros.camadas.planos && ['plano', 'tudo'].includes(visao)) {
    for (const a of areas().filter((x) => areaAtiva(x))) {
      const g = a.geometria;
      const dica = el('span', { text: `${tipoPlano(a.tipoPlano)?.nome || a.tipoPlano}: ${a.nome}` });
      const op = { className: `area-plano area-plano--${a.tipoPlano.toLowerCase()}`, interactive: true };
      if (g.tipo === 'circulo') L.circle(g.centro, { ...op, radius: g.raioM }).bindTooltip(dica).addTo(grupoAreas);
      else if (g.tipo === 'poligono') L.polygon(g.coords, op).bindTooltip(dica).addTo(grupoAreas);
    }
  }
  const ts = trechosInspecao();
  const tocaTela = (coords) => coords.some(([la, lo]) => naTela(la, lo));
  if (ts.length && filtros.camadas.trechos) {
    for (const t of ts) {
      if ((filtros.alimentador && t.alimentador !== filtros.alimentador) || !tocaTela(t.coords)) continue;
      const sit = ['plano', 'tudo'].includes(visao) ? situacaoTrecho(t) : { id: 'base' };
      const linha = L.polyline(t.coords, { className: `tronco tronco--${sit.id}`, weight: sit.id === 'base' ? 5 : 7 });
      linha.on('click', (ev) => { L.DomEvent.stopPropagation(ev); if (!modo) retornos.onTrecho?.(t.id); });
      linha.addTo(grupoTrechos);
    }
  } else {
    for (const t of d.trechos) {
      if (filtros.alimentador && t.alimentador !== filtros.alimentador) continue;
      L.polyline(t.coords, { className: `tronco tronco--${t.alimentador.toLowerCase()}`, weight: 5, interactive: false }).addTo(grupoTrechos);
    }
  }
  const eq = equipeDoUsuario();
  const minhas = filtros.minhaEquipe && eq ? new Set(pendenciasDaEquipe(d, eq).map((p) => p.ativoId)) : null;
  const acoes = [];
  for (const a of d.ativos) {
    if (!naTela(a.lat, a.lon)) continue;
    if (filtros.alimentador && a.alimentador !== filtros.alimentador) continue;
    const est = estadoNaVisao(ix, a, hoje, semana);
    const cat = est.id.startsWith('sev-') || est.id === 'programada' ? 'defeitos' : est.id.startsWith('insp-') ? 'inspecoes' : 'emDia';
    if (!filtros.camadas[cat]) continue;
    if (filtros.equipeTipo && !(ix.defs.get(a.id) || []).some((f) => STATUS_ABERTOS.includes(f.status) && tipoDefeito(f.tipoId)?.equipes.includes(filtros.equipeTipo))) continue;
    // Equipe: o que é de outra equipe aparece em cinza; defeito crítico aparece sempre (segurança).
    const outro = !!(minhas && !minhas.has(a.id) && est.id !== 'sev-A' && a.id !== selecionado);
    if (cat === 'emDia' && est.id !== 'executado') {
      if (a.id !== selecionado && z < (a.tipo === 'POSTE' ? ZOOM_NEUTROS : ZOOM_EQUIPAMENTOS)) continue;
      const pt = L.circleMarker([a.lat, a.lon], { renderer: renderPontos, radius: a.tipo === 'POSTE' ? 4 : 6, className: `pt pt--${a.tipo.toLowerCase()}`,
        color: '#ffffff', weight: 1.5, fillColor: est.id === 'ok' ? '#8f9b95' : '#c3ccc7', fillOpacity: 1 });
      pt.on('click', (ev) => { L.DomEvent.stopPropagation(ev); tocouAtivo(a.id, ev.latlng); });
      pt.addTo(grupoPontos);
      desenhados.push({ id: a.id, lat: a.lat, lon: a.lon });
      continue;
    }
    if (outro && z < ZOOM_EQUIPAMENTOS) continue;
    acoes.push({ a, est, outro, cat });
  }
  // Muitos marcadores na tela: agrupa por célula de 64 px e mostra a contagem com a cor do pior estado.
  if (acoes.length > LIMITE_MARCADORES && z < 18) {
    const celulas = new Map();
    for (const x of acoes) {
      const p = mapa.latLngToLayerPoint([x.a.lat, x.a.lon]);
      const k = `${Math.floor(p.x / CELULA_PX)}|${Math.floor(p.y / CELULA_PX)}`;
      const c = celulas.get(k);
      if (c) c.push(x); else celulas.set(k, [x]);
    }
    for (const grupo of celulas.values()) {
      if (grupo.length === 1) { marcador(grupo[0]); continue; }
      const pior = grupo.reduce((m, x) => ((PESO[x.est.id] || 0) > (PESO[m] || 0) ? x.est.id : m), grupo[0].est.id);
      const lat = grupo.reduce((t, x) => t + x.a.lat, 0) / grupo.length, lon = grupo.reduce((t, x) => t + x.a.lon, 0) / grupo.length;
      const m = L.marker([lat, lon], { icon: iconeGrupo(grupo.length, pior), keyboard: true, title: `${grupo.length} ativos com pendência — toque para aproximar`, zIndexOffset: 800 + (PESO[pior] || 0) * 10 });
      m.on('click', (ev) => { L.DomEvent.stopPropagation(ev); if (!modo) mapa.fitBounds(L.latLngBounds(grupo.map((x) => [x.a.lat, x.a.lon])).pad(0.3), { maxZoom: 18 }); });
      m.addTo(grupoAtivos);
    }
  } else acoes.forEach(marcador);
}

function marcador({ a, est, outro, cat }) {
  const m = L.marker([a.lat, a.lon], {
    icon: icone(a, est, a.id === selecionado, outro),
    title: `${TIPOS_ATIVO[a.tipo]} ${a.codigo} — ${est.nome}${outro ? ' (outra equipe)' : ''}`,
    keyboard: true,
    zIndexOffset: outro ? 100 : cat === 'defeitos' ? 1000 : cat === 'inspecoes' ? 500 : 0,
  });
  m.on('click', (ev) => { L.DomEvent.stopPropagation(ev); tocouAtivo(a.id, ev.latlng); });
  m.addTo(grupoAtivos);
  desenhados.push({ id: a.id, lat: a.lat, lon: a.lon });
}

/** Toque num ativo: se houver outros no mesmo ponto da tela, pergunta qual (transformador e poste juntos). */
function tocouAtivo(id, ll) {
  if (modo) { aoClicar({ latlng: ll }); return; }
  const p = mapa.latLngToContainerPoint(ll);
  const perto = [...new Set(desenhados.filter((x) => mapa.latLngToContainerPoint([x.lat, x.lon]).distanceTo(p) <= RAIO_VIZINHO_PX).map((x) => x.id))];
  if (perto.length > 1) retornos.onVarios?.(perto.includes(id) ? [id, ...perto.filter((x) => x !== id)] : perto);
  else retornos.onAtivo?.(id);
}

export function focar(lat, lon, zoom = 17) {
  mapa?.flyTo([lat, lon], Math.max(mapa.getZoom(), zoom), { duration: 0.6 });
}

export function definirPosicao(p) {
  if (!mapa || !p) return;
  const ll = [p.lat, p.lon];
  if (!marcadorUsuario) {
    marcadorUsuario = L.marker(ll, { icon: L.divIcon({ html: el('div', { class: 'eu' }), className: 'mk-wrap', iconSize: [22, 22] }), interactive: false, zIndexOffset: 2000 }).addTo(mapa);
    circuloUsuario = L.circle(ll, { radius: p.precisao || 15, className: 'eu-precisao', interactive: false }).addTo(mapa);
  } else {
    marcadorUsuario.setLatLng(ll);
    circuloUsuario.setLatLng(ll).setRadius(p.precisao || 15);
  }
}

export function ativosNaArea(bounds) {
  return estado.dados.ativos.filter((a) => bounds.contains([a.lat, a.lon]));
}

export const urlTile = (z, x, y) => URL_TILES.replace('{z}', z).replace('{x}', x).replace('{y}', y);

/** Mapa leve: só a rede desenhada, sem fundo de ruas (não consome internet). */
export function definirFundo(leve) {
  fundoLeve = !!leve;
  if (!mapa) return;
  if ((fundoLeve || !fundoLiberado) && mapa.hasLayer(camadaRuas)) camadaRuas.remove();
  if (!fundoLeve && fundoLiberado && !mapa.hasLayer(camadaRuas)) camadaRuas.addTo(mapa);
  container().classList.toggle('mapa--leve', fundoLeve);
}
/** Chamado quando a tela do mapa é aberta pela primeira vez. */
export function liberarFundo() {
  if (fundoLiberado) return;
  fundoLiberado = true;
  definirFundo(fundoLeve);
}
