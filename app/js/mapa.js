// Mapa (Leaflet + OSM). Produção: trocar por MapLibre + tiles vetoriais próprios (PMTiles), ver especificação §11.
/* global L */
import { el, toast, hojeISO, semanaISO } from './util.js';
import { estado, equipeDoUsuario } from './store.js';
import { estadoAtivo, pendenciasDaEquipe, tipoDefeito, STATUS_ABERTOS, TIPOS_ATIVO } from './dominio.js';
import { trechos as trechosInspecao, situacaoTrecho, areas, areaAtiva, tipoPlano } from './planos.js';

const URL_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
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

/** Estado do ativo dentro da visão escolhida. */
function estadoNaVisao(d, a) {
  const v = filtros.visao;
  if (v === 'tudo') return estadoAtivo(d, a.id);
  const neutro = a.criterios?.length ? { id: 'ok', nome: 'Em dia' } : { id: 'neutro', nome: 'Sem criticidade marcada' };
  if (v === 'defeitos') {
    const abertos = d.defeitos.filter((f) => f.ativoId === a.id && STATUS_ABERTOS.includes(f.status));
    if (abertos.length) { const sev = ['A', 'B', 'C'].find((x) => abertos.some((f) => f.severidade === x)); return { id: `sev-${sev}`, nome: `Defeito aberto (${sev})` }; }
    if (d.defeitos.some((f) => f.ativoId === a.id && f.status === 'EXECUTADO')) return { id: 'executado', nome: 'Executado — aguarda verificação' };
    return neutro;
  }
  if (v === 'plano') {
    const pend = d.inspecoes.filter((i) => i.ativoId === a.id && i.status !== 'CONCLUIDA');
    const hoje = hojeISO();
    if (pend.some((i) => i.prazo < hoje)) return { id: 'insp-vencida', nome: 'Inspeção vencida' };
    if (pend.length) return { id: 'insp-pendente', nome: 'Inspeção programada' };
    return neutro;
  }
  const semana = semanaISO(hojeISO());
  const doAtivo = d.defeitos.filter((f) => f.ativoId === a.id);
  if (doAtivo.some((f) => f.status === 'PROGRAMADO' && f.programacao?.semana === semana)) return { id: 'programada', nome: 'Programado nesta semana' };
  if (doAtivo.some((f) => f.execucao && semanaISO(f.execucao.em.slice(0, 10)) === semana)) return { id: 'executado', nome: 'Executado nesta semana' };
  return neutro;
}

export function iniciarMapa(container, cb) {
  retornos = cb;
  mapa = L.map(container, { zoomControl: false, preferCanvas: false }).setView([-15.836, -48.058], 14);
  L.control.zoom({ position: 'bottomright' }).addTo(mapa);
  camadaRuas = L.tileLayer(URL_TILES, {
    maxZoom: 19, crossOrigin: 'anonymous',
    attribution: '&copy; OpenStreetMap',
  });
  grupoAreas = L.layerGroup().addTo(mapa);
  grupoTrechos = L.layerGroup().addTo(mapa);
  grupoTrilha = L.layerGroup().addTo(mapa);
  grupoDesenho = L.layerGroup().addTo(mapa);
  grupoAtivos = L.layerGroup().addTo(mapa);
  mapa.on('click', aoClicar);
  return mapa;
}

export const mapaLeaflet = () => mapa;

function aoClicar(ev) {
  const { lat, lng } = ev.latlng;
  if (modo === 'simular') {
    retornos.onSimular?.({ lat, lon: lng });
  } else if (modo === 'avulso') {
    definirModo(null);
    retornos.onPontoAvulso?.({ lat, lon: lng });
  } else if (modo === 'desenho') {
    pontosDesenho.push([lat, lng]);
    redesenharDesenho();
    retornos.onDesenho?.(pontosDesenho.slice());
  } else if (modo === 'area') {
    if (!cantoA) {
      cantoA = ev.latlng;
      toast('Agora toque no canto oposto da área.');
    } else {
      const b = L.latLngBounds(cantoA, ev.latlng);
      cantoA = null;
      definirModo(null);
      desenharArea(b);
      retornos.onArea?.(b);
    }
  }
}

export function definirModo(novo) {
  modo = modo === novo ? null : novo;
  cantoA = null;
  container().classList.toggle('mapa--modo', !!modo);
  retornos.onModo?.(modo);
  if (modo !== 'desenho') limparDesenho();
  const dicas = { desenho: 'Desenho de área: toque nos vértices do polígono (ou um único ponto para círculo) e depois em Concluir.', area: 'Seleção de área: toque em dois cantos.', avulso: 'Toque no mapa onde está o ponto da inspeção avulsa.', simular: 'Simulação de posição: toque no mapa para mover a equipe.' };
  if (modo) toast(dicas[modo]);
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

function icone(ativo, est, selecionado) {
  const n = el('div', { class: `mk mk--${ativo.tipo.toLowerCase()} mk--${est.id}${selecionado ? ' mk--sel' : ''}` });
  // Marcador com estado que exige ação é maior e traz letra/ícone; em dia/neutro fica pequeno e discreto.
  const acao = !['ok', 'neutro'].includes(est.id);
  const tam = acao ? 22 : ativo.tipo === 'POSTE' ? 12 : 16;
  return L.divIcon({ html: n, className: 'mk-wrap', iconSize: [tam, tam] });
}

export function renderizar(selecionadoId) {
  if (!mapa) return;
  const d = estado.dados;
  grupoTrechos.clearLayers();
  grupoAtivos.clearLayers();
  grupoAreas.clearLayers();
  const visao = filtros.visao;
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
  if (ts.length && filtros.camadas.trechos) {
    // Trechos de inspeção (~1 km) coloridos pela situação no plano; toque abre a ficha do trecho.
    for (const t of ts) {
      if (filtros.alimentador && t.alimentador !== filtros.alimentador) continue;
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
  const relevantes = filtros.minhaEquipe && eq ? new Set(pendenciasDaEquipe(d, eq).map((p) => p.ativoId)) : null;
  for (const a of d.ativos) {
    if (filtros.alimentador && a.alimentador !== filtros.alimentador) continue;
    if (relevantes && !relevantes.has(a.id)) continue;
    const est = estadoNaVisao(d, a);
    const cat = est.id.startsWith('sev-') || est.id === 'programada' ? 'defeitos' : est.id.startsWith('insp-') ? 'inspecoes' : 'emDia';
    if (!filtros.camadas[cat]) continue;
    if (filtros.equipeTipo && !d.defeitos.some((f) => f.ativoId === a.id && STATUS_ABERTOS.includes(f.status)
      && tipoDefeito(f.tipoId)?.equipes.includes(filtros.equipeTipo))) continue;
    const m = L.marker([a.lat, a.lon], {
      icon: icone(a, est, a.id === selecionadoId),
      title: `${TIPOS_ATIVO[a.tipo]} ${a.codigo} — ${est.nome}`,
      keyboard: true,
      zIndexOffset: cat === 'defeitos' ? 1000 : cat === 'inspecoes' ? 500 : 0,
    });
    m.on('click', (ev) => { L.DomEvent.stopPropagation(ev); if (!modo) retornos.onAtivo?.(a.id); });
    m.addTo(grupoAtivos);
  }
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
