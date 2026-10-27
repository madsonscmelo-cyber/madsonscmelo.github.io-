// Orquestração: sessão, navegação por perfil, topo (rede/sincronização), botão voltar e service worker.
import { el, $, $$, toast, fmtDataHora, preencher } from './util.js';
import { estado, eventos, carregar, online, resetarDados } from './store.js';
import { validarConfig, CONFIG } from './config.js';
import { PERFIS } from './dominio.js';
import { fecharSheet } from './ui.js';
import { telaCarteira } from './carteira.js';
import { telaMapa } from './mapa.js';
import { telaPrioridades } from './prioridades.js';
import { telaDados } from './dados.js';
import { logar } from './auditoria.js';
import { POLITICA, iniciarSessao, retomarSessao, encerrarSessao, registrarAtividade, situacaoSessao, revalidarUsuario } from './auth.js';
import { telaLogin, telaTrocaSenha, telaBloqueio, telaAcesso } from './acesso.js';

// Ordem = prioridade na barra inferior (Hick: no máximo 5 por perfil).
const TODOS = ['GESTOR', 'ANALISTA', 'SUPERVISOR', 'AUDITOR'];
const VIEWS = {
  carteira: { rotulo: 'Alimentadores', icone: '📊', perfis: TODOS, render: telaCarteira },
  mapa: { rotulo: 'Mapa', icone: '🗺️', perfis: TODOS, render: telaMapa },
  prioridades: { rotulo: 'Onde agir', icone: '🎯', perfis: ['GESTOR', 'ANALISTA', 'SUPERVISOR'], render: telaPrioridades },
  dados: { rotulo: 'Dados', icone: '📥', perfis: TODOS, render: telaDados },
  acesso: { rotulo: 'Acesso', icone: '🔐', perfis: ['GESTOR', 'AUDITOR'] },
};
// Primeira tela: gestão abre a carteira (onde está o problema); supervisor abre o mapa do próprio conjunto.
const INICIAL = { GESTOR: 'carteira', ANALISTA: 'carteira', SUPERVISOR: 'mapa', AUDITOR: 'carteira' };

let viewAtual = 'carteira';

// ---------------- Sessão ----------------
function entrar(u) {
  iniciarSessao(u);
  aposEntrar();
  toast(`Conectado como ${u.nome} (${PERFIS[u.perfil]}).`);
}

function aposEntrar() {
  $('#login').hidden = true;
  montarNav();
  atualizarTopo();
  history.replaceState({ raiz: true }, '');
  mostrar(INICIAL[estado.usuario.perfil] || 'carteira');
}

function sair(acao = 'LOGOUT', detalhe = {}) {
  encerrarSessao(acao, detalhe);
  fecharSheet();
  $('#menu-usuario').hidden = true;
  $$('.view').forEach((v) => { v.replaceChildren(); v.hidden = true; });
  $('#nav').replaceChildren();
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
  const minhas = Object.entries(VIEWS).filter(([, v]) => v.perfis.includes(estado.usuario.perfil));
  $('#nav').replaceChildren(...minhas.map(([id, v]) => el('button', { type: 'button', class: 'nav__btn', dataset: { view: id }, onclick: () => mostrar(id) },
    el('span', { class: 'nav__ico', text: v.icone, 'aria-hidden': 'true' }), el('span', { text: v.rotulo }))));
}

let extraAtual = {};
function mostrar(id, extra = {}, { historico = true } = {}) {
  if (!VIEWS[id]?.perfis.includes(estado.usuario?.perfil)) {
    logar({ categoria: 'SEGURANCA', acao: 'ACESSO_NEGADO_TELA', resultado: 'NEGADO', detalhe: { tela: id } });
    return false;
  }
  if (id !== viewAtual || $(`#view-${id}`).hidden) logar({ categoria: 'NAVEGACAO', acao: 'TELA_ABERTA', detalhe: { tela: id } });
  viewAtual = id;
  extraAtual = extra;
  // Botão voltar do celular volta para a tela anterior (Jakob), em vez de sair do app.
  if (historico && history.state?.view !== id) history.pushState({ view: id }, '');
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${id}`; });
  $$('.nav__btn').forEach((b) => { b.classList.toggle('ativo', b.dataset.view === id); if (b.dataset.view === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  fecharSheet();
  renderizarAtual();
  $(`#view-${id}`).scrollTop = 0;
  return true;
}

const contexto = () => ({ irPara: mostrar });

function renderizarAtual() {
  if (!estado.usuario) return;
  const raiz = $(`#view-${viewAtual}`);
  // A tela de logs é lida sob demanda (não a cada alteração de dados), para não recarregar a tabela enquanto se lê.
  if (viewAtual === 'acesso') { if (!raiz.childElementCount || raiz.dataset.usuario !== estado.usuario.id) { raiz.dataset.usuario = estado.usuario.id; telaAcesso(raiz); } return; }
  VIEWS[viewAtual].render(raiz, contexto(), extraAtual);
  extraAtual = {};
}

// ---------------- Topo: rede e sincronização ----------------
function atualizarTopo() {
  const on = online();
  const rede = $('#st-rede');
  rede.textContent = on ? 'Online' : estado.offlineSimulado ? 'Offline (simulado)' : 'Offline';
  rede.className = `chip ${on ? 'chip--ok' : 'chip--alerta'}`;
  // Qual base está aberta é a informação de status que importa aqui (sintética × importada neste aparelho).
  const imp = estado.rede?.origem === 'IMPORTADA';
  const texto = imp ? `Base importada ${fmtDataHora(estado.rede.geradaEm)}` : 'Base sintética (demo)';
  const base = $('#st-sync');
  base.replaceChildren(el('span', { 'aria-hidden': 'true', text: imp ? '📥' : '🧪' }), el('span', { class: 'chip__longo', text: texto }));
  base.title = texto;
  base.setAttribute('aria-label', texto);
  base.className = `chip ${imp ? 'chip--ok' : 'chip--aviso'}`;
  if (estado.usuario) {
    const ini = estado.usuario.nome.split(/\s+/).filter((p) => p.length > 2).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
    $('#btn-usuario').replaceChildren(el('span', { class: 'chip__curto', 'aria-hidden': 'true', text: `${ini} ▾` }), el('span', { class: 'chip__longo', text: `${estado.usuario.nome} ▾` }));
    $('#btn-usuario').setAttribute('aria-label', `Menu do usuário: ${estado.usuario.nome}`);
  }
}

function menuUsuario() {
  const m = $('#menu-usuario');
  if (!m.hidden) { m.hidden = true; return; }
  if (!estado.usuario) return;
  preencher(m, 
    el('div', { class: 'menu__info' }, el('strong', { text: estado.usuario.nome }), el('span', { class: 'muted', text: PERFIS[estado.usuario.perfil] })),
    el('button', { type: 'button', class: 'menu__item', text: 'Alterar minha senha', onclick: () => { m.hidden = true; telaTrocaSenha(estado.usuario, () => {}, false, () => {}); } }),
    el('button', { type: 'button', class: 'menu__item', text: 'Sair', onclick: () => { m.hidden = true; sair(); } }),
    estado.usuario.perfil === 'GESTOR' ? el('button', { type: 'button', class: 'menu__item menu__item--perigo', text: 'Restaurar dados de demonstração', onclick: async () => {
      m.hidden = true;
      if (!confirm('Apagar a base deste aparelho (inclusive a importada), as senhas e voltar para a demonstração? O log de auditoria é mantido.')) return;
      logar({ categoria: 'ADMIN', acao: 'DADOS_DEMO_RESTAURADOS' });
      fecharSheet(); await resetarDados();
      toast('Dados de demonstração restaurados. Entre novamente.', { tipo: 'ok' });
      sair('LOGOUT', { motivo: 'restauração dos dados de demonstração' });
    } }) : null);
  m.hidden = false;
}

/** Modo sol: alto contraste para tela sob luz forte (preferência do aparelho, não sincroniza). */
function aplicarSol(ligado) {
  if (ligado) document.documentElement.dataset.theme = 'sol'; else delete document.documentElement.dataset.theme;
  $('#btn-sol')?.setAttribute('aria-pressed', String(ligado));
  try { localStorage.setItem('raiox-sol', ligado ? '1' : '0'); } catch { /* sem storage: vale só nesta sessão */ }
}

function registrarSw() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW não registrado', e));
}

// ---------------- Início ----------------
async function iniciar() {
  // Checklist 1.4: GitHub Pages não permite o cabeçalho X-Frame-Options; recusa rodar dentro de iframe (clickjacking).
  if (window.top !== window.self) {
    document.body.replaceChildren(el('p', { class: 'erro-fatal', text: 'Por segurança, o Raio-X de Alimentadores não pode ser aberto dentro de outra página.' }));
    return;
  }
  validarConfig();
  await carregar();
  registrarSw();
  $('#sheet-fechar').addEventListener('click', fecharSheet);
  $('#btn-usuario').addEventListener('click', menuUsuario);
  try { estado.sel.fundo = localStorage.getItem('raiox-fundo') !== '0'; } catch { /* sem storage */ }
  let sol = false;
  try { sol = localStorage.getItem('raiox-sol') === '1'; } catch { /* sem storage */ }
  aplicarSol(sol);
  $('#btn-sol').addEventListener('click', () => {
    const ligar = document.documentElement.dataset.theme !== 'sol';
    aplicarSol(ligar);
    logar({ categoria: 'NAVEGACAO', acao: ligar ? 'MODO_SOL_LIGADO' : 'MODO_SOL_DESLIGADO' });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#menu-usuario').hidden = true; fecharSheet(); } });
  document.addEventListener('click', (e) => { const m = $('#menu-usuario'); if (!m.hidden && !e.target.closest('.topo__usuario')) m.hidden = true; });
  let tentouSair = 0;
  window.addEventListener('popstate', (e) => {
    if (!estado.usuario || !$('#login').hidden) return;
    const st = e.state || {};
    if (st.raiz) {
      // Na primeira tela: avisa antes de sair (2º voltar em até 3 s sai de verdade).
      if (Date.now() - tentouSair < 3000) { history.back(); return; }
      tentouSair = Date.now();
      toast('Toque voltar de novo para sair do app.');
      history.pushState({ view: viewAtual }, '');
      return;
    }
    if (st.view && st.view !== viewAtual) mostrar(st.view, {}, { historico: false });
  });
  eventos.addEventListener('mudou', () => { renderizarAtual(); atualizarTopo(); });
  eventos.addEventListener('sync', atualizarTopo);
  window.addEventListener('online', atualizarTopo);
  window.addEventListener('offline', atualizarTopo);

  // Sessão: atividade, inatividade, fim de turno e revalidação ao voltar ao app.
  ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, registrarAtividade, { passive: true }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') vigiarSessao(); });
  setInterval(vigiarSessao, 30000);
  window.addEventListener('error', (e) => logar({ categoria: 'SISTEMA', acao: 'ERRO_APLICACAO', resultado: 'ERRO', detalhe: { mensagem: e.message } }));
  window.addEventListener('unhandledrejection', (e) => logar({ categoria: 'SISTEMA', acao: 'ERRO_APLICACAO', resultado: 'ERRO', detalhe: { mensagem: String(e.reason?.message || e.reason) } }));
  logar({ categoria: 'SISTEMA', acao: 'APP_INICIADO', detalhe: { instalado: matchMedia('(display-mode: standalone)').matches } });

  // Demonstração: link de recuperação (…/alimentadores/?restaurar-demo) zera os dados e senhas deste aparelho.
  const url = new URL(location.href);
  if (CONFIG.modo === 'demo' && url.searchParams.has('restaurar-demo')) {
    url.searchParams.delete('restaurar-demo');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    if (confirm(`Restaurar a demonstração neste aparelho? Todas as matrículas voltam para a senha inicial ${POLITICA.senhaInicialDemo} e os registros de teste são apagados (o log de auditoria é mantido).`)) {
      logar({ categoria: 'SEGURANCA', acao: 'DEMO_RESTAURADA_POR_LINK' });
      try { sessionStorage.clear(); } catch { /* sem storage */ }
      await resetarDados();
      telaLogin(entrar);
      toast(`Demonstração restaurada. Entre com a matrícula e a senha inicial ${POLITICA.senhaInicialDemo}.`, { tipo: 'ok', duracao: 10000 });
      return;
    }
  }
  if (retomarSessao()) aposEntrar(); else telaLogin(entrar);
}

iniciar().catch((e) => {
  console.error(e);
  // Checklist 6.5: sem detalhes internos para o usuário (o detalhe fica no console).
  document.body.append(el('p', { class: 'erro-fatal', text: 'Falha ao iniciar o aplicativo. Recarregue a página; se continuar, abra no Chrome ou Safari atualizado (não dentro de outro app) ou acione o suporte.' }));
});
