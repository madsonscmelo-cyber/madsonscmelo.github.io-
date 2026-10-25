// Orquestração: sessão, navegação, GPS, alertas de proximidade, filtros do mapa e service worker.
import { el, $, $$, toast, distanciaM, hojeISO, fmtDataHora } from './util.js';
import { estado, eventos, carregar, registrar, online, sincronizar, resetarDados, equipeDoUsuario, ativoPorId } from './store.js';
import { PERFIS, TIPOS_EQUIPE, TIPOS_ATIVO, RAIO_ALERTA_M, pendenciasDaEquipe } from './dominio.js';
import * as mapa from './mapa.js';
import { abrirAtivo, abrirArea, abrirFormInspecao, fecharSheet, sheetAtual } from './ui.js';
import { telaDefeitos, telaPlano, telaPainel, telaProducao } from './telas.js';
import { criarAtivoAvulso } from './acoes.js';

const TODOS = ['GESTOR', 'SUPERVISOR', 'EQUIPE'];
const VIEWS = {
  mapa: { rotulo: 'Mapa', icone: '🗺️', perfis: TODOS },
  defeitos: { rotulo: 'Defeitos', icone: '⚠️', perfis: TODOS, render: telaDefeitos },
  plano: { rotulo: 'Plano', icone: '📋', perfis: ['GESTOR', 'SUPERVISOR'], render: telaPlano },
  painel: { rotulo: 'Painel', icone: '📊', perfis: ['GESTOR', 'SUPERVISOR'], render: telaPainel },
  producao: { rotulo: 'Produção', icone: '🏆', perfis: TODOS, render: telaProducao },
};

let viewAtual = 'mapa', selecionado = null, gpsId = null, areaAtiva = null, houveOffline = false;
const alertados = new Set();

// ---------------- Sessão (demo) ----------------
function telaLogin() {
  const box = $('#login');
  const grupos = Object.entries(PERFIS).map(([perfil, nome]) => el('div', { class: 'login__grupo' },
    el('h2', { text: nome }),
    el('div', { class: 'login__lista' }, estado.dados.usuarios.filter((u) => u.perfil === perfil).map((u) => {
      const eq = estado.dados.equipes.find((e) => e.id === u.equipeId);
      return el('button', { type: 'button', class: 'login__btn', onclick: () => entrar(u) },
        el('strong', { text: u.nome }), eq ? el('span', { class: 'muted', text: `${TIPOS_EQUIPE[eq.tipo]} · ${eq.base}${eq.disponivel ? '' : ' · indisponível'}` }) : null);
    }))));
  box.replaceChildren(el('div', { class: 'login__cartao' },
    el('div', { class: 'login__marca' }, el('img', { src: 'icon.svg', alt: '', width: 48, height: 48 }), el('div', {}, el('h1', { text: 'RedeViva' }), el('p', { class: 'muted', text: 'Plano de manutenção e inspeção de rede' }))),
    el('p', { class: 'aviso-demo', text: 'Protótipo com dados sintéticos. Em produção o acesso é por SSO corporativo com MFA — aqui você apenas escolhe um perfil para demonstrar as permissões.' }),
    ...grupos));
  box.hidden = false;
}

function entrar(u) {
  estado.usuario = u;
  try { sessionStorage.setItem('redeviva-usuario', u.id); } catch { /* sem storage */ }
  $('#login').hidden = true;
  registrar('LOGIN', 'sessao', u.id, { perfil: u.perfil });
  mapa.filtros.minhaEquipe = u.perfil === 'EQUIPE';
  montarNav();
  montarFiltros();
  atualizarTopo();
  mostrar('mapa');
  setTimeout(() => mapa.mapaLeaflet().invalidateSize(), 50);
  toast(`Conectado como ${u.nome} (${PERFIS[u.perfil]}).`);
}

function sair() {
  registrar('LOGOUT', 'sessao', estado.usuario.id);
  pararGps();
  estado.usuario = null;
  estado.posicao = null;
  try { sessionStorage.removeItem('redeviva-usuario'); } catch { /* sem storage */ }
  fecharSheet();
  telaLogin();
}

// ---------------- Navegação ----------------
function montarNav() {
  const nav = $('#nav');
  nav.replaceChildren(...Object.entries(VIEWS).filter(([, v]) => v.perfis.includes(estado.usuario.perfil)).map(([id, v]) =>
    el('button', { type: 'button', class: 'nav__btn', dataset: { view: id }, onclick: () => mostrar(id) }, el('span', { class: 'nav__ico', text: v.icone, 'aria-hidden': 'true' }), el('span', { text: v.rotulo }))));
}

function mostrar(id) {
  if (!VIEWS[id]?.perfis.includes(estado.usuario.perfil)) return;
  viewAtual = id;
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${id}`; });
  $$('.nav__btn').forEach((b) => b.classList.toggle('ativo', b.dataset.view === id));
  if (id !== 'mapa') fecharSheet();
  renderizarAtual();
  if (id === 'mapa') setTimeout(() => mapa.mapaLeaflet().invalidateSize(), 30);
}

function renderizarAtual() {
  if (!estado.usuario) return;
  mapa.renderizar(selecionado);
  const v = VIEWS[viewAtual];
  if (v.render) v.render($(`#view-${viewAtual}`), { abrirNoMapa });
  const s = sheetAtual();
  if (s?.tipo === 'ativo') abrirAtivo(s.id);
  else if (s?.tipo === 'area' && areaAtiva) abrirArea(mapa.ativosNaArea(areaAtiva), limparArea);
}

function abrirNoMapa(ativoId) {
  const a = ativoPorId(ativoId);
  if (!a) return;
  mostrar('mapa');
  selecionado = a.id;
  mapa.renderizar(selecionado);
  mapa.focar(a.lat, a.lon);
  abrirAtivo(a.id);
}

function limparArea() {
  areaAtiva = null;
  mapa.limparArea();
}

// ---------------- Topo: rede e sincronização ----------------
function atualizarTopo() {
  const on = online(), d = estado.dados;
  const rede = $('#st-rede');
  rede.textContent = on ? 'Online' : estado.offlineSimulado ? 'Offline (simulado)' : 'Offline';
  rede.className = `chip ${on ? 'chip--ok' : 'chip--alerta'}`;
  const sync = $('#st-sync');
  sync.textContent = d.fila.length ? `${d.fila.length} pendente(s) de envio` : d.ultimaSync ? `Sincronizado ${fmtDataHora(d.ultimaSync)}` : 'Sem pendências';
  sync.className = `chip ${d.fila.length ? 'chip--aviso' : ''}`;
  if (estado.usuario) $('#btn-usuario').textContent = `${estado.usuario.nome} ▾`;
}

function menuUsuario() {
  const m = $('#menu-usuario');
  if (!m.hidden) { m.hidden = true; return; }
  m.replaceChildren(
    el('div', { class: 'menu__info' }, el('strong', { text: estado.usuario.nome }), el('span', { class: 'muted', text: PERFIS[estado.usuario.perfil] })),
    el('button', { type: 'button', class: 'menu__item', text: estado.offlineSimulado ? 'Voltar a ficar online' : 'Simular modo offline', onclick: () => {
      estado.offlineSimulado = !estado.offlineSimulado; m.hidden = true; atualizarTopo(); sincronizar();
      if (estado.offlineSimulado) houveOffline = true;
      toast(estado.offlineSimulado ? 'Modo offline: registros ficam na fila local.' : 'Online: enviando fila.');
    } }),
    el('button', { type: 'button', class: 'menu__item', text: 'Trocar usuário / perfil', onclick: () => { m.hidden = true; sair(); } }),
    estado.usuario.perfil === 'GESTOR' ? el('button', { type: 'button', class: 'menu__item menu__item--perigo', text: 'Restaurar dados de demonstração', onclick: async () => {
      m.hidden = true;
      if (!confirm('Apagar todos os registros locais e restaurar os dados sintéticos?')) return;
      limparArea(); fecharSheet(); await resetarDados(); toast('Dados de demonstração restaurados.', { tipo: 'ok' });
    } }) : null);
  m.hidden = false;
}

// ---------------- Posição e alertas de proximidade ----------------
function aplicarPosicao(p) {
  estado.posicao = { ...p, em: new Date().toISOString() };
  mapa.definirPosicao(estado.posicao);
  checarProximidade();
}

function iniciarGps() {
  if (!('geolocation' in navigator)) { toast('GPS indisponível neste dispositivo.', { tipo: 'erro' }); return; }
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  if (gpsId !== null) { if (estado.posicao) mapa.focar(estado.posicao.lat, estado.posicao.lon, 16); return; }
  let primeira = true;
  gpsId = navigator.geolocation.watchPosition((pos) => {
    aplicarPosicao({ lat: pos.coords.latitude, lon: pos.coords.longitude, precisao: pos.coords.accuracy, simulada: false });
    if (primeira) { primeira = false; mapa.focar(pos.coords.latitude, pos.coords.longitude, 16); }
  }, (err) => {
    toast(`GPS: ${err.code === 1 ? 'permissão negada' : 'sem sinal'}. Use "Simular posição" para a demonstração.`, { tipo: 'aviso' });
    pararGps();
  }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  toast('Buscando sua posição…');
}
function pararGps() {
  if (gpsId !== null) navigator.geolocation.clearWatch(gpsId);
  gpsId = null;
}

/** RF-ROT-03/04: um alerta por ativo por dia, só para pendências compatíveis com a equipe logada. */
function checarProximidade() {
  const eq = equipeDoUsuario(), p = estado.posicao;
  if (!eq || !p) return;
  const hoje = hojeISO();
  const porAtivo = new Map();
  for (const item of pendenciasDaEquipe(estado.dados, eq)) {
    const a = ativoPorId(item.ativoId);
    if (!a) continue;
    const dist = distanciaM(p.lat, p.lon, a.lat, a.lon);
    if (dist > RAIO_ALERTA_M || alertados.has(`${a.id}|${hoje}`)) continue;
    const reg = porAtivo.get(a.id) || { a, dist, itens: [] };
    reg.itens.push(item);
    porAtivo.set(a.id, reg);
  }
  const lista = [...porAtivo.values()].sort((x, y) => x.dist - y.dist);
  if (!lista.length) return;
  lista.forEach((r) => alertados.add(`${r.a.id}|${hoje}`));
  const r = lista[0];
  const desc = r.itens.map((i) => (i.tipo === 'inspecao' ? 'inspeção' : 'defeito')).join(' + ');
  const msg = `Perto de você (${Math.round(r.dist)} m): ${TIPOS_ATIVO[r.a.tipo]} ${r.a.codigo} — ${desc}${lista.length > 1 ? ` · +${lista.length - 1} ponto(s)` : ''}`;
  toast(msg, { tipo: 'alerta', duracao: 9000, acao: { texto: 'Abrir', fn: () => abrirNoMapa(r.a.id) } });
  navigator.vibrate?.(200);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification('RedeViva — pendência próxima', { body: msg, icon: 'icon.svg', tag: r.a.id }); } catch { /* alguns navegadores exigem SW */ }
  }
}

// ---------------- Controles e filtros do mapa ----------------
function montarControles() {
  const btn = (ico, rotulo, fn, id) => el('button', { type: 'button', class: 'ctrl', title: rotulo, 'aria-label': rotulo, id, onclick: fn }, el('span', { text: ico, 'aria-hidden': 'true' }), el('span', { class: 'ctrl__rot', text: rotulo }));
  $('#mapa-ctrl').replaceChildren(
    btn('📍', 'Minha posição', iniciarGps),
    btn('🎯', 'Simular posição', () => { pararGps(); mapa.definirModo('simular'); }, 'ctrl-simular'),
    btn('▭', 'Selecionar área', () => mapa.definirModo('area'), 'ctrl-area'),
    btn('＋', 'Ponto avulso', () => mapa.definirModo('avulso'), 'ctrl-avulso'),
    btn('⬇', 'Mapa offline', () => mapa.baixarAreaOffline()),
    btn('⚙', 'Filtros', () => { const f = $('#painel-filtros'); f.hidden = !f.hidden; }));
}

function montarFiltros() {
  const f = mapa.filtros, d = estado.dados;
  const cb = (rotulo, get, set) => {
    const i = el('input', { type: 'checkbox', checked: get() });
    i.addEventListener('change', () => { set(i.checked); mapa.renderizar(selecionado); });
    return el('label', { class: 'campo--check' }, i, el('span', { text: rotulo }));
  };
  const sel = (rotulo, opcoes, chave) => {
    const s = el('select', { class: 'campo__input' }, opcoes.map(([v, t]) => el('option', { value: v, text: t, selected: f[chave] === v })));
    s.addEventListener('change', () => { f[chave] = s.value; mapa.renderizar(selecionado); });
    return el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: rotulo }), s);
  };
  $('#painel-filtros').replaceChildren(
    el('strong', { text: 'Camadas' }),
    cb('Defeitos abertos', () => f.camadas.defeitos, (v) => { f.camadas.defeitos = v; }),
    cb('Inspeções programadas/vencidas', () => f.camadas.inspecoes, (v) => { f.camadas.inspecoes = v; }),
    cb('Ativos em dia / sem criticidade', () => f.camadas.emDia, (v) => { f.camadas.emDia = v; }),
    estado.usuario.perfil === 'EQUIPE' ? cb('Só pendências da minha equipe', () => f.minhaEquipe, (v) => { f.minhaEquipe = v; }) : null,
    sel('Alimentador', [['', 'Todos'], ...[...new Set(d.ativos.map((a) => a.alimentador))].sort().map((a) => [a, a])], 'alimentador'),
    sel('Defeito exige equipe', [['', 'Qualquer'], ...Object.entries(TIPOS_EQUIPE)], 'equipeTipo'),
  );
}

function aoModo(modo) {
  ['simular', 'area', 'avulso'].forEach((m) => $(`#ctrl-${m}`)?.classList.toggle('ctrl--ativo', modo === m));
}

// ---------------- Service worker ----------------
function registrarSw() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW não registrado', e));
  }
}

// ---------------- Início ----------------
async function iniciar() {
  await carregar();
  registrarSw();
  mapa.iniciarMapa($('#mapa'), {
    onAtivo: (id) => { selecionado = id; mapa.renderizar(id); abrirAtivo(id); },
    onArea: (b) => { areaAtiva = b; abrirArea(mapa.ativosNaArea(b), limparArea); },
    onPontoAvulso: (p) => {
      const a = criarAtivoAvulso(p);
      selecionado = a.id;
      abrirFormInspecao({ ativos: [a], inspecoes: [], avulsa: true });
    },
    onSimular: (p) => aplicarPosicao({ ...p, precisao: 5, simulada: true }),
    onModo: aoModo,
  });
  montarControles();
  $('#sheet-fechar').addEventListener('click', fecharSheet);
  $('#btn-usuario').addEventListener('click', menuUsuario);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (mapa.modoAtual()) mapa.definirModo(mapa.modoAtual()); else fecharSheet(); } });
  document.addEventListener('sheet-fechado', () => { if (selecionado) { selecionado = null; mapa.renderizar(null); } });
  eventos.addEventListener('mudou', () => { renderizarAtual(); atualizarTopo(); });
  eventos.addEventListener('sync', (e) => {
    atualizarTopo();
    if (e.detail?.enviados && houveOffline) { houveOffline = false; toast(`Conexão restabelecida: ${e.detail.enviados} registro(s) sincronizado(s).`, { tipo: 'ok' }); }
  });
  window.addEventListener('online', () => { atualizarTopo(); sincronizar(); });
  window.addEventListener('offline', () => { houveOffline = true; atualizarTopo(); });
  setInterval(sincronizar, 15000);

  let salvo = null;
  try { salvo = sessionStorage.getItem('redeviva-usuario'); } catch { /* sem storage */ }
  const u = estado.dados.usuarios.find((x) => x.id === salvo);
  if (u) entrar(u); else telaLogin();
}

iniciar().catch((e) => {
  console.error(e);
  document.body.append(el('p', { class: 'erro-fatal', text: `Falha ao iniciar: ${e.message}` }));
});
