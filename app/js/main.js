// Orquestração: sessão, navegação, GPS, alertas de proximidade, filtros do mapa e service worker.
import { el, $, $$, toast, distanciaM, hojeISO, somarDias, fmtDataHora } from './util.js';
import { estado, eventos, persistir, carregar, registrar, online, sincronizar, resetarDados, equipeDoUsuario, ativoPorId, rascunhosDoUsuario, resumoFila } from './store.js';
import { abrirTrabalhoOffline, config as configOffline, definirMapaLeve } from './offline.js';
import { validarConfig } from './config.js';
import { PERFIS, TIPOS_EQUIPE, TIPOS_ATIVO, PARAM, pendenciasDaEquipe } from './dominio.js';
import { aplicarParametros } from './parametros.js';
import { telaParametros } from './parametros-ui.js';
import { telaProgramacao } from './programacao.js';
import { completarCustosSemValor } from './custos.js';
import * as mapa from './mapa.js';
import { abrirAtivo, abrirArea, abrirFormInspecao, fecharSheet, sheetAtual, retomarRascunho } from './ui.js';
import { telaDefeitos, telaPlano, telaPainel, telaProducao } from './telas.js';
import { criarAtivoAvulso } from './acoes.js';
import { logar } from './auditoria.js';
import { POLITICA, iniciarSessao, retomarSessao, encerrarSessao, registrarAtividade, situacaoSessao, revalidarUsuario } from './auth.js';
import { telaLogin, telaTrocaSenha, telaBloqueio, telaAcesso } from './acesso.js';

const TODOS = ['GESTOR', 'SUPERVISOR', 'EQUIPE'];
// Ordem = prioridade na barra inferior (Hick: no máximo 5 botões; o resto vai para "Mais").
const VIEWS = {
  mapa: { rotulo: 'Mapa', icone: '🗺️', perfis: TODOS },
  defeitos: { rotulo: 'Defeitos', icone: '⚠️', perfis: [...TODOS, 'AUDITOR'], render: telaDefeitos },
  programacao: { rotulo: 'Programação', icone: '🗓️', perfis: ['GESTOR', 'SUPERVISOR', 'AUDITOR'], render: telaProgramacao },
  painel: { rotulo: 'Painel', icone: '📊', perfis: ['GESTOR', 'SUPERVISOR', 'AUDITOR'], render: telaPainel },
  plano: { rotulo: 'Plano', icone: '📋', perfis: ['GESTOR', 'SUPERVISOR'], render: telaPlano },
  producao: { rotulo: 'Produção', icone: '🏆', perfis: TODOS, render: telaProducao },
  parametros: { rotulo: 'Parâmetros', icone: '⚙️', perfis: ['ADMIN', 'GESTOR', 'AUDITOR'] },
  acesso: { rotulo: 'Acesso', icone: '🔐', perfis: ['ADMIN', 'GESTOR', 'AUDITOR'], render: telaAcesso },
};

let viewAtual = 'mapa', selecionado = null, gpsId = null, areaAtiva = null, houveOffline = false;
const alertados = new Set();

// ---------------- Sessão ----------------
/** Login concluído (senha validada e, se exigido, trocada). */
function entrar(u) {
  iniciarSessao(u);
  aposEntrar();
  toast(`Conectado como ${u.nome} (${PERFIS[u.perfil]}).`);
}

function aposEntrar() {
  const u = estado.usuario;
  $('#login').hidden = true;
  mapa.filtros.minhaEquipe = u.perfil === 'EQUIPE';
  montarNav();
  montarFiltros();
  atualizarTopo();
  mostrar(Object.entries(VIEWS).find(([, v]) => v.perfis.includes(u.perfil))[0]);
  setTimeout(() => mapa.mapaLeaflet().invalidateSize(), 50);
}

function sair(acao = 'LOGOUT', detalhe = {}) {
  pararGps();
  encerrarSessao(acao, detalhe);
  estado.posicao = null;
  fecharSheet();
  $('#menu-usuario').hidden = true;
  telaLogin(entrar);
}

/** Checklist 2.7 e 2.10: inatividade bloqueia a tela, fim do turno encerra, bloqueio feito pelo gestor derruba a sessão. */
let telaBloqueada = false;
function vigiarSessao() {
  if (!estado.usuario || telaBloqueada) return;
  if (!revalidarUsuario()) { sair('SESSAO_REVOGADA', { motivo: 'usuário bloqueado pelo gestor' }); toast('Seu acesso foi bloqueado pelo gestor.', { tipo: 'erro' }); return; }
  const s = situacaoSessao();
  if (s === 'turno-excedido') { sair('SESSAO_ENCERRADA_TURNO', { horas: POLITICA.sessaoMaximaHoras }); toast('Sessão encerrada: limite do turno.', { tipo: 'aviso' }); }
  else if (s === 'inativa') {
    telaBloqueada = true;
    logar({ categoria: 'AUTENTICACAO', acao: 'SESSAO_BLOQUEADA_INATIVIDADE', entidade: 'sessao', entidadeId: estado.sessaoId, detalhe: { minutos: POLITICA.inatividadeMinutos } });
    telaBloqueio(() => { telaBloqueada = false; }, () => { telaBloqueada = false; sair(); });
  }
}

// ---------------- Navegação ----------------
function montarNav() {
  const nav = $('#nav');
  const minhas = Object.entries(VIEWS).filter(([, v]) => v.perfis.includes(estado.usuario.perfil));
  const visiveis = minhas.length > 5 ? minhas.slice(0, 4) : minhas;
  const extras = minhas.length > 5 ? minhas.slice(4) : [];
  const botao = ([id, v]) => el('button', { type: 'button', class: 'nav__btn', dataset: { view: id }, onclick: () => { const m = $('#nav-mais'); if (m) m.hidden = true; mostrar(id); } },
    el('span', { class: 'nav__ico', text: v.icone, 'aria-hidden': 'true' }), el('span', { text: v.rotulo }));
  nav.replaceChildren(...visiveis.map(botao));
  if (extras.length) {
    const menu = el('div', { id: 'nav-mais', class: 'nav-mais', hidden: true }, extras.map(botao));
    nav.append(el('button', { type: 'button', class: 'nav__btn', id: 'nav-mais-btn', dataset: { extras: extras.map(([id]) => id).join(',') }, 'aria-haspopup': 'menu', onclick: () => { menu.hidden = !menu.hidden; } },
      el('span', { class: 'nav__ico', text: '☰', 'aria-hidden': 'true' }), el('span', { text: 'Mais' })), menu);
  }
}

function mostrar(id) {
  if (!VIEWS[id]?.perfis.includes(estado.usuario.perfil)) {
    logar({ categoria: 'SEGURANCA', acao: 'ACESSO_NEGADO_TELA', resultado: 'NEGADO', detalhe: { tela: id } });
    return false;
  }
  if (id !== viewAtual || !$(`#view-${id}`).dataset.aberta) logar({ categoria: 'NAVEGACAO', acao: 'TELA_ABERTA', detalhe: { tela: id } });
  $$('.view').forEach((v) => { delete v.dataset.aberta; });
  $(`#view-${id}`).dataset.aberta = '1';
  viewAtual = id;
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${id}`; });
  $$('.nav__btn').forEach((b) => b.classList.toggle('ativo', b.dataset.view === id || (b.dataset.extras || '').split(',').includes(id)));
  if (id !== 'mapa') fecharSheet();
  renderizarAtual();
  if (id === 'mapa') setTimeout(() => mapa.mapaLeaflet().invalidateSize(), 30);
  if (id === 'acesso') telaAcesso($('#view-acesso'));
  if (id === 'parametros') telaParametros($('#view-parametros'));
  return true;
}

function renderizarAtual() {
  if (!estado.usuario) return;
  mapa.renderizar(selecionado);
  renderizarTopoMapa();
  const v = VIEWS[viewAtual];
  // A tela de logs é lida sob demanda (não a cada alteração de dados), para não recarregar a tabela enquanto se lê.
  if (v.render && viewAtual !== 'acesso') v.render($(`#view-${viewAtual}`), { abrirNoMapa });
  const s = sheetAtual();
  if (s?.tipo === 'ativo') abrirAtivo(s.id);
  else if (s?.tipo === 'area' && areaAtiva) abrirArea(mapa.ativosNaArea(areaAtiva), limparArea);
}

function abrirNoMapa(ativoId) {
  const a = ativoPorId(ativoId);
  if (!a || !VIEWS.mapa.perfis.includes(estado.usuario.perfil) || !mostrar('mapa')) return;
  logar({ categoria: 'LEITURA', acao: 'ATIVO_CONSULTADO', entidade: 'ativo', entidadeId: a.id });
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
  const f = resumoFila();
  sync.textContent = f.total ? `${f.dados ? `${f.dados} registro(s)` : ''}${f.dados && f.fotos ? ' · ' : ''}${f.fotos ? `${f.fotos} foto(s)` : ''} a enviar` : d.ultimaSync ? `Sincronizado ${fmtDataHora(d.ultimaSync)}` : 'Sem pendências';
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
      logar({ categoria: 'SISTEMA', acao: estado.offlineSimulado ? 'MODO_OFFLINE_SIMULADO' : 'MODO_ONLINE' });
      if (estado.offlineSimulado) aoFicarOffline();
      toast(estado.offlineSimulado ? 'Modo offline: registros ficam na fila local.' : 'Online: enviando fila.');
    } }),
    el('button', { type: 'button', class: 'menu__item', text: estado.redeMovelSimulada ? 'Voltar ao Wi-Fi' : 'Simular rede móvel (4G)', onclick: () => {
      estado.redeMovelSimulada = !estado.redeMovelSimulada; m.hidden = true; sincronizar();
      logar({ categoria: 'SISTEMA', acao: estado.redeMovelSimulada ? 'REDE_MOVEL_SIMULADA' : 'REDE_WIFI' });
      toast(estado.redeMovelSimulada ? 'Rede móvel: registros sobem, fotos aguardam o Wi-Fi.' : 'Wi-Fi: enviando fotos pendentes.');
    } }),
    el('button', { type: 'button', class: 'menu__item', text: 'Alterar minha senha', onclick: () => { m.hidden = true; telaTrocaSenha(estado.usuario, () => {}, false, () => {}); } }),
    el('button', { type: 'button', class: 'menu__item', text: 'Sair', onclick: () => { m.hidden = true; sair(); } }),
    estado.usuario.perfil === 'GESTOR' ? el('button', { type: 'button', class: 'menu__item menu__item--perigo', text: 'Restaurar dados de demonstração', onclick: async () => {
      m.hidden = true;
      if (!confirm('Apagar todos os registros locais e restaurar os dados sintéticos?')) return;
      logar({ categoria: 'ADMIN', acao: 'DADOS_DEMO_RESTAURADOS' });
      const usuarioAtual = estado.usuario;
      limparArea(); fecharSheet(); await resetarDados();
      toast('Dados de demonstração restaurados. Entre novamente.', { tipo: 'ok' });
      if (usuarioAtual) sair('LOGOUT', { motivo: 'restauração dos dados de demonstração' });
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
  logar({ categoria: 'NAVEGACAO', acao: 'GPS_ATIVADO' });
  let primeira = true;
  gpsId = navigator.geolocation.watchPosition((pos) => {
    aplicarPosicao({ lat: pos.coords.latitude, lon: pos.coords.longitude, precisao: pos.coords.accuracy, simulada: false });
    if (primeira) { primeira = false; mapa.focar(pos.coords.latitude, pos.coords.longitude, 16); }
  }, (err) => {
    toast(`GPS: ${err.code === 1 ? 'permissão negada' : 'sem sinal'}. Use "Simular posição" para a demonstração.`, { tipo: 'aviso' });
    logar({ categoria: 'SISTEMA', acao: 'GPS_FALHOU', resultado: 'ERRO', detalhe: { motivo: err.code === 1 ? 'permissão negada' : 'sem sinal' } });
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
    if (dist > PARAM.raioAlertaM || alertados.has(`${a.id}|${hoje}`)) continue;
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
  logar({ categoria: 'LEITURA', acao: 'ALERTA_PROXIMIDADE', entidade: 'ativo', entidadeId: r.a.id, detalhe: { distanciaM: Math.round(r.dist), pontos: lista.length } });
  navigator.vibrate?.(200);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification('RedeViva — pendência próxima', { body: msg, icon: 'icon.svg', tag: r.a.id }); } catch { /* alguns navegadores exigem SW */ }
  }
}

// ---------------- Controles e filtros do mapa ----------------
// Hick: 3 ações frequentes visíveis; as eventuais ficam em "Mais".
function montarControles() {
  const btn = (ico, rotulo, fn, id) => el('button', { type: 'button', class: 'ctrl', title: rotulo, 'aria-label': rotulo, id, onclick: fn }, el('span', { text: ico, 'aria-hidden': 'true' }), el('span', { class: 'ctrl__rot', text: rotulo }));
  const mais = el('div', { id: 'mapa-mais', class: 'mapa-mais', hidden: true },
    btn('🎯', 'Simular posição', () => { fecharMais(); pararGps(); mapa.definirModo('simular'); }, 'ctrl-simular'),
    btn('＋', 'Ponto avulso', () => { fecharMais(); mapa.definirModo('avulso'); }, 'ctrl-avulso'),
    btn('📦', 'Trabalho offline', () => { fecharMais(); abrirTrabalhoOffline(); }, 'ctrl-offline'));
  $('#mapa-ctrl').replaceChildren(
    btn('📍', 'Minha posição', iniciarGps, 'ctrl-gps'),
    btn('▭', 'Selecionar área', () => mapa.definirModo('area'), 'ctrl-area'),
    btn('⚙', 'Filtros', () => { const f = $('#painel-filtros'); f.hidden = !f.hidden; fecharMais(); }, 'ctrl-filtros'),
    btn('⋯', 'Mais', () => { mais.hidden = !mais.hidden; $('#painel-filtros').hidden = true; }, 'ctrl-mais'),
    mais);
}
const fecharMais = () => { const m = $('#mapa-mais'); if (m) m.hidden = true; };

// Jakob (busca como em apps de mapa) + Gradiente de meta (progresso do dia) + Zeigarnik (trabalho em andamento).
function renderizarTopoMapa() {
  const topo = $('#mapa-topo');
  if (!topo || !estado.usuario) return;
  if (!topo.querySelector('.busca')) topo.append(montarBusca());
  topo.querySelector('.progresso-dia')?.remove();
  topo.querySelectorAll('.rascunho').forEach((n) => n.remove());
  const eq = equipeDoUsuario();
  if (eq) {
    const p = progressoDoDia(eq);
    const preench = el('span', { class: 'progresso-dia__preench' });
    preench.style.width = `${p.total ? Math.round((p.feitas / p.total) * 100) : 0}%`;
    topo.append(el('div', { class: 'progresso-dia', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': p.total, 'aria-valuenow': p.feitas, 'aria-label': 'Progresso do dia' },
      el('div', { class: 'progresso-dia__txt' }, el('strong', { text: `Hoje: ${p.feitas} de ${p.total}` }),
        el('span', { class: 'muted', text: p.total - p.feitas ? `faltam ${p.total - p.feitas}` : p.total ? 'meta do dia cumprida 🎉' : 'sem pendências na semana' })),
      el('span', { class: 'progresso-dia__trilho' }, preench)));
  }
  for (const r of rascunhosDoUsuario().slice(0, 2)) {
    topo.append(el('button', { type: 'button', class: 'rascunho', onclick: () => retomarRascunho(r) },
      el('span', { text: `📝 ${r.titulo} — parou na etapa ${r.etapa + 1} de 3` }), el('strong', { text: 'Continuar' })));
  }
}

/** Meta do dia = já feito hoje + pendências da equipe com prazo até 7 dias (inclui vencidas) + defeitos programados. */
function progressoDoDia(eq) {
  const d = estado.dados, hoje = hojeISO(), limite = somarDias(hoje, 7);
  const feitas = d.inspecoes.filter((i) => i.equipeId === eq.id && i.status === 'CONCLUIDA' && i.concluidaEm.slice(0, 10) === hoje).length
    + d.defeitos.filter((f) => f.execucao?.equipeId === eq.id && f.execucao.em.slice(0, 10) === hoje && !f.execucao.naHora).length;
  const pend = pendenciasDaEquipe(d, eq).filter((p) => (p.tipo === 'inspecao' ? p.ref.prazo <= limite && p.ref.equipeId === eq.id : p.ref.status === 'PROGRAMADO')).length;
  return { feitas, total: feitas + pend };
}

function montarBusca() {
  const lista = el('div', { class: 'busca__res', role: 'listbox' });
  const inp = el('input', { type: 'search', class: 'busca__inp', placeholder: '🔍 Buscar ativo (ex.: TR-07-03)', 'aria-label': 'Buscar ativo pelo código', autocomplete: 'off', maxlength: 30 });
  const fechar = () => { lista.replaceChildren(); inp.value = ''; };
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toUpperCase();
    if (q.length < 2) { lista.replaceChildren(); return; }
    const achados = estado.dados.ativos.filter((a) => a.codigo.includes(q)).slice(0, 6);
    lista.replaceChildren(...(achados.length ? achados.map((a) => el('button', { type: 'button', class: 'busca__item', role: 'option', onclick: () => { logar({ categoria: 'LEITURA', acao: 'BUSCA_ATIVO', detalhe: { termo: inp.value.trim() } }); fechar(); inp.blur(); abrirNoMapa(a.id); } },
      el('strong', { text: a.codigo }), el('span', { class: 'muted', text: `${TIPOS_ATIVO[a.tipo]} · ${a.alimentador}` }))) : [el('div', { class: 'busca__vazio muted', text: 'Nenhum ativo com esse código.' })]));
  });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') lista.querySelector('.busca__item')?.click(); });
  return el('div', { class: 'busca' }, inp, lista);
}

function montarFiltros() {
  const f = mapa.filtros, d = estado.dados;
  const cb = (rotulo, get, set) => {
    const i = el('input', { type: 'checkbox', checked: get() });
    i.addEventListener('change', () => { set(i.checked); mapa.renderizar(selecionado); logar({ categoria: 'NAVEGACAO', acao: 'FILTRO_MAPA', detalhe: { filtro: rotulo, valor: i.checked } }); });
    return el('label', { class: 'campo--check' }, i, el('span', { text: rotulo }));
  };
  const sel = (rotulo, opcoes, chave) => {
    const s = el('select', { class: 'campo__input' }, opcoes.map(([v, t]) => el('option', { value: v, text: t, selected: f[chave] === v })));
    s.addEventListener('change', () => { f[chave] = s.value; mapa.renderizar(selecionado); logar({ categoria: 'NAVEGACAO', acao: 'FILTRO_MAPA', detalhe: { filtro: chave, valor: s.value } }); });
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
  if (modo) logar({ categoria: 'NAVEGACAO', acao: 'MODO_MAPA', detalhe: { modo } });
  ['simular', 'area', 'avulso'].forEach((m) => $(`#ctrl-${m}`)?.classList.toggle('ctrl--ativo', modo === m));
  $('#ctrl-mais')?.classList.toggle('ctrl--ativo', modo === 'simular' || modo === 'avulso');
}

/** Sem internet: se não há pacote baixado, sugere o mapa leve para não ficar com o fundo cinza. */
function aoFicarOffline() {
  houveOffline = true;
  if (configOffline().mapaLeve) return;
  const temPacote = Object.keys(estado.dados.pacotes || {}).length > 0;
  toast(temPacote ? 'Sem internet: usando o pacote offline. Registros ficam na fila.' : 'Sem internet e sem pacote baixado: use o mapa leve (só a rede).', {
    tipo: 'aviso', duracao: 8000, acao: temPacote ? undefined : { texto: 'Mapa leve', fn: () => definirMapaLeve(true) },
  });
}

// ---------------- Service worker ----------------
function registrarSw() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW não registrado', e));
  }
}

// ---------------- Início ----------------
async function iniciar() {
  // Checklist 1.4: GitHub Pages não permite o cabeçalho X-Frame-Options; recusa rodar dentro de iframe (clickjacking).
  if (window.top !== window.self) {
    document.body.replaceChildren(el('p', { class: 'erro-fatal', text: 'Por segurança, o RedeViva não pode ser aberto dentro de outra página.' }));
    return;
  }
  validarConfig();
  await carregar();
  aplicarParametros();
  if (completarCustosSemValor()) persistir();
  registrarSw();
  mapa.iniciarMapa($('#mapa'), {
    onAtivo: (id) => { logar({ categoria: 'LEITURA', acao: 'ATIVO_CONSULTADO', entidade: 'ativo', entidadeId: id }); selecionado = id; mapa.renderizar(id); abrirAtivo(id); },
    onArea: (b) => { areaAtiva = b; const ativos = mapa.ativosNaArea(b); logar({ categoria: 'LEITURA', acao: 'AREA_SELECIONADA', detalhe: { ativos: ativos.length } }); abrirArea(ativos, limparArea); },
    onPontoAvulso: (p) => {
      let a;
      try { a = criarAtivoAvulso(p); } catch (e) { toast(e.message, { tipo: 'erro' }); return; }
      selecionado = a.id;
      abrirFormInspecao({ ativos: [a], inspecoes: [], avulsa: true });
    },
    onSimular: (p) => aplicarPosicao({ ...p, precisao: 5, simulada: true }),
    onModo: aoModo,
  });
  mapa.definirFundo(configOffline().mapaLeve);
  montarControles();
  $('#sheet-fechar').addEventListener('click', fecharSheet);
  $('#btn-usuario').addEventListener('click', menuUsuario);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { fecharMais(); if (mapa.modoAtual()) mapa.definirModo(mapa.modoAtual()); else fecharSheet(); } });
  document.addEventListener('sheet-fechado', () => { if (selecionado) { selecionado = null; mapa.renderizar(null); } });
  eventos.addEventListener('mudou', () => { aplicarParametros(); if (completarCustosSemValor()) persistir(); renderizarAtual(); atualizarTopo(); });
  eventos.addEventListener('rascunho', renderizarTopoMapa);
  eventos.addEventListener('sync', (e) => {
    atualizarTopo();
    if (e.detail?.enviados && houveOffline) {
      houveOffline = false;
      toast(`Conexão restabelecida: ${e.detail.enviados} item(ns) enviado(s)${e.detail.fotosRetidas ? ` · ${e.detail.fotosRetidas} foto(s) aguardam Wi-Fi` : ''}.`, { tipo: 'ok' });
    }
  });
  window.addEventListener('online', () => { atualizarTopo(); sincronizar(); });
  window.addEventListener('offline', () => { aoFicarOffline(); atualizarTopo(); });
  setInterval(sincronizar, 15000);

  // Sessão: atividade, inatividade, fim de turno e revalidação ao voltar ao app.
  ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, registrarAtividade, { passive: true }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') vigiarSessao(); });
  setInterval(vigiarSessao, 30000);
  window.addEventListener('error', (e) => logar({ categoria: 'SISTEMA', acao: 'ERRO_APLICACAO', resultado: 'ERRO', detalhe: { mensagem: e.message } }));
  window.addEventListener('unhandledrejection', (e) => logar({ categoria: 'SISTEMA', acao: 'ERRO_APLICACAO', resultado: 'ERRO', detalhe: { mensagem: String(e.reason?.message || e.reason) } }));
  logar({ categoria: 'SISTEMA', acao: 'APP_INICIADO', detalhe: { instalado: matchMedia('(display-mode: standalone)').matches } });

  if (retomarSessao()) aposEntrar(); else telaLogin(entrar);
}

iniciar().catch((e) => {
  console.error(e);
  // Checklist 6.5: sem detalhes internos para o usuário (o detalhe fica no console).
  document.body.append(el('p', { class: 'erro-fatal', text: 'Falha ao iniciar o aplicativo. Recarregue a página ou acione o suporte.' }));
});
