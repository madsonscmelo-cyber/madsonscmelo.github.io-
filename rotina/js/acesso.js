// Telas de acesso: login, troca de senha, bloqueio por inatividade e administração (usuários, logs, política).
import { el, $, toast, fmtDataHora, csvStringify, baixarArquivo, hojeISO, anexar } from './util.js';
import { estado, resetarDados } from './store.js';
import { CONFIG } from './config.js';
import { PERFIS, CARGOS, UTDS } from './dominio.js';
import {
  POLITICA, ErroAuth, autenticar, trocarSenha, avaliarSenha, desbloquear,
  adminDefinirAtivo, adminRedefinirSenha, adminLiberarTentativas, bloqueioTemporario,
} from './auth.js';
import { logar, consultarLogs, verificarIntegridade, todosLogs, CATEGORIAS_LOG, RESULTADOS_LOG } from './auditoria.js';

const marca = () => el('div', { class: 'login__marca' }, el('img', { src: 'icon.svg', alt: '', width: 48, height: 48 }),
  el('div', {}, el('h1', { text: 'Rotina UTD' }), el('p', { class: 'muted', text: 'Agenda e aderência da rotina da retaguarda' })));

function campoSenha(rotulo, autocomplete) {
  const inp = el('input', { type: 'password', class: 'campo__input', autocomplete, maxlength: 128, required: true });
  const ver = el('button', { type: 'button', class: 'btn btn--txt', text: 'mostrar', 'aria-label': `Mostrar ${rotulo.toLowerCase()}`, onclick: () => {
    inp.type = inp.type === 'password' ? 'text' : 'password';
    ver.textContent = inp.type === 'password' ? 'mostrar' : 'ocultar';
  } });
  return { inp, elemento: el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: rotulo }), el('div', { class: 'campo-senha' }, inp, ver)) };
}

// ---------- Login ----------
export function telaLogin(aoEntrar) {
  const box = $('#login');
  const mat = el('input', { class: 'campo__input', autocomplete: 'username', autocapitalize: 'characters', maxlength: 30, required: true, placeholder: 'Ex.: R1101' });
  const senha = campoSenha('Senha', 'current-password');
  const msg = el('p', { class: 'login__msg', role: 'alert' });
  const botao = el('button', { type: 'submit', class: 'btn btn--grande', text: 'Entrar' });
  const form = el('form', { class: 'form login__form', novalidate: true },
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Matrícula' }), mat), senha.elemento, msg, botao);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    msg.textContent = '';
    if (!mat.value.trim() || !senha.inp.value) { msg.textContent = 'Informe matrícula e senha.'; return; }
    botao.disabled = true;
    botao.textContent = 'Verificando…';
    try {
      const r = await autenticar(mat.value, senha.inp.value);
      senha.inp.value = '';
      if (r.precisaTrocar) telaTrocaSenha(r.usuario, () => aoEntrar(r.usuario), true);
      else aoEntrar(r.usuario);
    } catch (e) {
      msg.textContent = e instanceof ErroAuth ? e.message : 'Não foi possível entrar. Tente novamente.';
      if (!(e instanceof ErroAuth)) console.error(e);
      senha.inp.value = '';
      senha.inp.focus();
    } finally {
      botao.disabled = false;
      botao.textContent = 'Entrar';
    }
  });

  const demo = el('details', { class: 'login__demo' }, el('summary', { text: 'Usuários de demonstração' }),
    el('p', { class: 'pequeno', text: `Senha inicial de todos: ${POLITICA.senhaInicialDemo} — o sistema exige trocar no primeiro acesso. Toque para preencher a matrícula.` }),
    // Gestão primeiro e, da retaguarda, só a UTD de Juazeiro (as demais seguem o mesmo padrão de matrícula).
    el('div', { class: 'login__lista' }, estado.dados.usuarios.filter((u) => u.perfil !== 'COLABORADOR' || u.utd === 'JUA').map((u) =>
      el('button', { type: 'button', class: 'login__btn', onclick: () => { mat.value = u.matricula; senha.inp.focus(); } },
        el('strong', { text: `${u.matricula} · ${u.nome}` }), el('span', { class: 'muted', text: u.perfil === 'COLABORADOR' ? `${CARGOS[u.cargo]} · ${UTDS[u.utd]}` : PERFIS[u.perfil] })))),
    el('p', { class: 'pequeno muted', text: 'Retaguarda das outras UTDs: R12xx Jacobina, R13xx Senhor do Bonfim, R14xx Remanso (01 Téc. Comercial, 02 Téc. Manutenção, 03 Téc. Especialista, 04 Assist. Comercial, 05 Assist. Geral).' }));

  // Só na demonstração: sem servidor não há "esqueci a senha"; a saída é restaurar os dados deste aparelho.
  const ajuda = CONFIG.modo === 'demo' ? el('details', { class: 'login__demo' }, el('summary', { text: 'Não consigo entrar' }),
    el('ul', { class: 'pequeno regras-ajuda' },
      el('li', { text: `Se nunca entrou neste aparelho (ou ele foi restaurado), use a senha inicial ${POLITICA.senhaInicialDemo}.` }),
      el('li', { text: 'Se já criou sua senha, use a sua senha pessoal (a matrícula pode ser digitada em minúsculas).' }),
      el('li', { text: `Após ${POLITICA.tentativasMaximas} erros a matrícula fica bloqueada por ${POLITICA.bloqueioMinutos} minutos. O gestor ou o administrador podem liberar antes.` })),
    el('button', { type: 'button', class: 'btn btn--sec btn--largo', text: 'Restaurar a demonstração neste aparelho', onclick: async () => {
      if (!confirm(`Apagar os dados de demonstração deste aparelho e voltar todas as matrículas para a senha inicial (${POLITICA.senhaInicialDemo})? O log de auditoria é mantido.`)) return;
      logar({ categoria: 'SEGURANCA', acao: 'DEMO_RESTAURADA_NA_TELA_DE_LOGIN', resultado: 'OK' });
      await resetarDados();
      toast(`Demonstração restaurada. Entre com a senha inicial ${POLITICA.senhaInicialDemo}.`, { tipo: 'ok', duracao: 8000 });
      telaLogin(aoEntrar);
    } })) : null;

  box.replaceChildren(el('div', { class: 'login__cartao' }, marca(),
    el('p', { class: 'aviso-demo', text: 'Protótipo com dados sintéticos. Em produção o acesso é pelo login corporativo (SSO) com MFA.' }),
    form, demo, ajuda,
    el('p', { class: 'pequeno muted', text: `Acesso monitorado: todas as ações são registradas. ${POLITICA.tentativasMaximas} tentativas erradas bloqueiam a matrícula por ${POLITICA.bloqueioMinutos} minutos.` })));
  box.hidden = false;
  mat.focus();
}

// ---------- Troca de senha ----------
export function telaTrocaSenha(u, aoConcluir, obrigatoria = false, aoCancelar) {
  const box = $('#login');
  const nova = campoSenha('Nova senha', 'new-password');
  const conf = campoSenha('Repita a nova senha', 'new-password');
  const regras = el('ul', { class: 'regras' });
  const msg = el('p', { class: 'login__msg', role: 'alert' });
  const atualizar = () => regras.replaceChildren(...avaliarSenha(nova.inp.value, u).map((r) => el('li', { class: r.ok ? 'ok' : '', text: `${r.ok ? '✓' : '○'} ${r.regra}` })),
    el('li', { class: nova.inp.value && nova.inp.value === conf.inp.value ? 'ok' : '', text: `${nova.inp.value && nova.inp.value === conf.inp.value ? '✓' : '○'} As duas senhas conferem` }));
  nova.inp.addEventListener('input', atualizar);
  conf.inp.addEventListener('input', atualizar);
  atualizar();
  const botao = el('button', { type: 'submit', class: 'btn btn--grande', text: 'Salvar nova senha' });
  const form = el('form', { class: 'form login__form', novalidate: true }, nova.elemento, conf.elemento, regras, msg, botao,
    !obrigatoria && aoCancelar ? el('button', { type: 'button', class: 'btn btn--txt', text: 'Cancelar', onclick: () => { box.hidden = true; aoCancelar(); } }) : null);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    botao.disabled = true;
    try {
      await trocarSenha(u, nova.inp.value, conf.inp.value);
      box.hidden = true;
      toast('Senha alterada.', { tipo: 'ok' });
      aoConcluir();
    } catch (e) {
      msg.textContent = e instanceof ErroAuth ? e.message : 'Não foi possível salvar a senha.';
    } finally { botao.disabled = false; }
  });
  box.replaceChildren(el('div', { class: 'login__cartao' }, marca(),
    el('h2', { text: obrigatoria ? `Olá, ${u.nome}. Crie sua senha pessoal` : 'Alterar minha senha' }),
    el('p', { class: 'muted', text: obrigatoria ? 'Primeiro acesso ou senha redefinida pelo gestor: a troca é obrigatória.' : 'A senha nova não pode repetir as últimas 3.' }),
    form));
  box.hidden = false;
  nova.inp.focus();
}

// ---------- Bloqueio por inatividade ----------
export function telaBloqueio(aoDesbloquear, aoSair) {
  const box = $('#login');
  const senha = campoSenha('Senha', 'current-password');
  const msg = el('p', { class: 'login__msg', role: 'alert' });
  const form = el('form', { class: 'form login__form', novalidate: true }, senha.elemento, msg,
    el('button', { type: 'submit', class: 'btn btn--grande', text: 'Desbloquear' }),
    el('button', { type: 'button', class: 'btn btn--txt', text: 'Sair e entrar com outro usuário', onclick: aoSair }));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await desbloquear(senha.inp.value);
      box.hidden = true;
      aoDesbloquear();
    } catch (e) {
      msg.textContent = e instanceof ErroAuth ? e.message : 'Não foi possível desbloquear.';
      senha.inp.value = '';
    }
  });
  box.replaceChildren(el('div', { class: 'login__cartao' }, marca(),
    el('h2', { text: '🔒 Sessão bloqueada por inatividade' }),
    el('p', { class: 'muted', text: `${estado.usuario?.nome} · sem uso por mais de ${POLITICA.inatividadeMinutos} minutos. Seu trabalho em andamento foi preservado.` }),
    form));
  box.hidden = false;
  senha.inp.focus();
}

// ---------- Tela "Acesso": logs, usuários e política ----------
const estadoTela = { aba: 'logs', filtros: { usuario: '', categoria: '', resultado: '', texto: '' }, limite: 200, integridade: null };

export async function telaAcesso(raiz) {
  const ehGestor = estado.usuario.perfil === 'GESTOR';
  if (estadoTela.aba === 'usuarios' && !ehGestor) estadoTela.aba = 'logs';
  const abas = el('div', { class: 'abas', role: 'tablist' }, [['logs', 'Logs de auditoria'], ...(ehGestor ? [['usuarios', 'Usuários']] : []), ['politica', 'Política']].map(([id, t]) =>
    el('button', { type: 'button', role: 'tab', 'aria-selected': String(estadoTela.aba === id), class: `abas__btn${estadoTela.aba === id ? ' ativo' : ''}`, text: t, onclick: () => { estadoTela.aba = id; telaAcesso(raiz); } })));
  const corpo = el('div');
  raiz.replaceChildren(el('header', { class: 'tela__topo' }, el('h1', { text: 'Acesso e auditoria' }), el('span', { class: 'muted', text: 'Toda ação de usuário fica registrada' })), abas, corpo);
  if (estadoTela.aba === 'logs') await abaLogs(corpo, raiz);
  else if (estadoTela.aba === 'usuarios') abaUsuarios(corpo, raiz);
  else abaPolitica(corpo);
}

async function abaLogs(corpo, raiz) {
  const f = estadoTela.filtros;
  const todos = await todosLogs();
  const dia = Date.now() - 86400000;
  const recentes = todos.filter((r) => Date.parse(r.em) > dia);
  const lista = await consultarLogs(f);
  const nomes = Object.fromEntries(estado.dados.usuarios.map((u) => [u.id, `${u.matricula} · ${u.nome}`]));
  const sel = (chave, opcoes) => {
    const s = el('select', { class: 'campo__input', 'aria-label': chave }, opcoes.map(([v, t]) => el('option', { value: v, text: t, selected: f[chave] === v })));
    s.addEventListener('change', () => { f[chave] = s.value; estadoTela.limite = 200; telaAcesso(raiz); });
    return s;
  };
  const busca = el('input', { type: 'search', class: 'campo__input', placeholder: 'Buscar ação, registro, detalhe', value: f.texto, maxlength: 60 });
  busca.addEventListener('change', () => { f.texto = busca.value; telaAcesso(raiz); });

  const integ = estadoTela.integridade;
  const kpi = (r, v, d, c = '') => el('div', { class: `kpi ${c}` }, el('span', { class: 'kpi__rotulo', text: r }), el('strong', { class: 'kpi__valor', text: v }), el('span', { class: 'kpi__det', text: d }));
  anexar(corpo, 
    el('div', { class: 'kpis' },
      kpi('Registros no log', String(todos.length), `desde ${todos[0] ? fmtDataHora(todos[0].em) : '—'}`),
      kpi('Falhas de login (24 h)', String(recentes.filter((r) => r.acao === 'LOGIN_FALHA').length), `${recentes.filter((r) => r.acao === 'BLOQUEIO_POR_TENTATIVAS').length} bloqueio(s) por tentativas`, recentes.some((r) => r.acao === 'BLOQUEIO_POR_TENTATIVAS') ? 'kpi--alerta' : ''),
      kpi('Ações negadas (24 h)', String(recentes.filter((r) => r.resultado === 'NEGADO' && r.categoria === 'SEGURANCA').length), 'tentativas fora da permissão'),
      kpi('Integridade', integ ? (integ.ok ? '✓ íntegro' : '✗ violado') : 'não verificada', integ ? (integ.ok ? `${integ.total} registros conferidos` : integ.motivo) : 'cadeia de hash SHA-256', integ && !integ.ok ? 'kpi--critico' : '')),
    el('div', { class: 'linha' },
      el('button', { type: 'button', class: 'btn', text: 'Verificar integridade', onclick: async () => {
        estadoTela.integridade = await verificarIntegridade();
        logar({ categoria: 'SEGURANCA', acao: 'INTEGRIDADE_VERIFICADA', resultado: estadoTela.integridade.ok ? 'OK' : 'ERRO', detalhe: estadoTela.integridade });
        telaAcesso(raiz);
      } }),
      el('button', { type: 'button', class: 'btn btn--sec', text: 'Exportar CSV', onclick: () => {
        logar({ categoria: 'EXPORTACAO', acao: 'LOGS_EXPORTADOS', detalhe: { registros: lista.length, filtros: f } });
        baixarArquivo(`logs-rotina-${hojeISO()}.csv`, csvStringify([['seq', 'quando', 'usuario', 'perfil', 'sessao', 'categoria', 'acao', 'entidade', 'registro', 'resultado', 'detalhe', 'dispositivo', 'online', 'hash_anterior', 'hash'],
          ...lista.map((r) => [r.seq, r.em, r.usuario, r.perfil, r.sessao, r.categoria, r.acao, r.entidade, r.entidadeId, r.resultado, JSON.stringify(r.detalhe), r.dispositivo, r.online, r.hashAnterior, r.hash])]));
      } })),
    el('div', { class: 'filtros' },
      sel('usuario', [['', 'Todos os usuários'], ...estado.dados.usuarios.map((u) => [u.id, `${u.matricula} · ${u.nome}`])]),
      sel('categoria', [['', 'Todas as categorias'], ...Object.entries(CATEGORIAS_LOG)]),
      sel('resultado', [['', 'Todos os resultados'], ...Object.entries(RESULTADOS_LOG)]),
      busca),
    el('p', { class: 'muted pequeno', text: `${lista.length} registro(s)${lista.length > estadoTela.limite ? ` · exibindo ${estadoTela.limite}` : ''}` }),
    el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela tabela--logs' },
      el('thead', {}, el('tr', {}, ['#', 'Quando', 'Usuário', 'Categoria', 'Ação', 'Registro', 'Resultado', 'Aparelho'].map((h) => el('th', { text: h })))),
      el('tbody', {}, lista.slice(0, estadoTela.limite).map((r) => el('tr', { class: r.resultado !== 'OK' ? `tr--${r.resultado.toLowerCase()}` : '', title: JSON.stringify(r.detalhe) },
        el('td', { text: r.seq }), el('td', { text: fmtDataHora(r.em) }), el('td', { text: nomes[r.usuario] || r.usuario || '—' }),
        el('td', { text: CATEGORIAS_LOG[r.categoria] || r.categoria }), el('td', { text: r.acao }),
        el('td', { text: [r.entidade, r.entidadeId].filter(Boolean).join(' ') || '—' }),
        el('td', {}, el('span', { class: `chip chip--res-${r.resultado.toLowerCase()}`, text: RESULTADOS_LOG[r.resultado] || r.resultado })),
        el('td', { class: 'pequeno', text: `${r.dispositivo}${r.online ? '' : ' · offline'}` })))))),
    lista.length > estadoTela.limite ? el('button', { type: 'button', class: 'btn btn--txt', text: 'Mostrar mais 200', onclick: () => { estadoTela.limite += 200; telaAcesso(raiz); } }) : null,
  );
}

function abaUsuarios(corpo, raiz) {
  const executar = (fn) => { try { fn(); toast('Alteração registrada no log.', { tipo: 'ok' }); telaAcesso(raiz); } catch (e) { toast(e.message, { tipo: 'erro' }); } };
  anexar(corpo, el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
    el('thead', {}, el('tr', {}, ['Matrícula', 'Nome', 'Perfil', 'Situação', 'Senha', 'Último acesso', 'Ações'].map((h) => el('th', { text: h })))),
    el('tbody', {}, estado.dados.usuarios.map((u) => {
      const temp = bloqueioTemporario(u);
      const situacao = u.ativo === false ? 'Bloqueado pelo gestor' : temp ? `Bloqueio por tentativas até ${fmtDataHora(temp.toISOString())}` : 'Ativo';
      const acoes = el('div', { class: 'linha' });
      if (u.id !== estado.usuario.id) {
        acoes.append(el('button', { type: 'button', class: 'btn btn--txt', text: u.ativo === false ? 'Desbloquear' : 'Bloquear', onclick: () => executar(() => adminDefinirAtivo(u, u.ativo === false)) }),
          el('button', { type: 'button', class: 'btn btn--txt', text: 'Redefinir senha', onclick: () => { if (confirm(`Redefinir a senha de ${u.nome}? A pessoa terá de criar uma nova no próximo acesso.`)) executar(() => adminRedefinirSenha(u)); } }));
      }
      if (temp) acoes.append(el('button', { type: 'button', class: 'btn btn--txt', text: 'Liberar tentativas', onclick: () => executar(() => adminLiberarTentativas(u)) }));
      return el('tr', { class: u.ativo === false || temp ? 'tr--alerta' : '' },
        el('td', { text: u.matricula }), el('td', { text: u.nome }), el('td', { text: PERFIS[u.perfil] }), el('td', { text: situacao }),
        el('td', { text: u.credencial ? `alterada ${fmtDataHora(u.credencial.alteradaEm)}` : 'inicial (troca pendente)' }),
        el('td', { text: u.ultimoAcesso ? fmtDataHora(u.ultimoAcesso) : '—' }), el('td', {}, acoes));
    })))));
}

function abaPolitica(corpo) {
  const P = POLITICA;
  const item = (t, d) => el('li', {}, el('strong', { text: t }), el('span', { text: ` — ${d}` }));
  anexar(corpo, 
    el('section', { class: 'bloco' }, el('h2', { text: 'Política de acesso' }), el('ul', { class: 'politica' },
      item('Senha', `mínimo ${P.senhaMinimo} caracteres, ${P.classesMinimas} de 4 tipos (maiúscula, minúscula, número, símbolo), sem matrícula/nome, sem senhas comuns, sem repetir as últimas ${P.historicoSenhas}`),
      item('Armazenamento da senha', `nunca em texto: PBKDF2-SHA-256 com ${P.iteracoesPbkdf2.toLocaleString('pt-BR')} iterações e sal aleatório por usuário`),
      item('Primeiro acesso', 'senha inicial obrigatoriamente trocada; o mesmo vale após redefinição pelo gestor'),
      item('Tentativas', `${P.tentativasMaximas} erros bloqueiam a matrícula por ${P.bloqueioMinutos} min; ${P.falhasPorAparelho} erros no mesmo aparelho bloqueiam o aparelho; mensagem única que não revela se a matrícula existe`),
      item('Sessão', `bloqueio após ${P.inatividadeMinutos} min sem uso (trabalho em andamento preservado); encerramento após ${P.sessaoMaximaHoras} h (um turno); fechar a aba encerra a sessão`),
      item('Perfil relido', 'ao voltar ao app o usuário é revalidado: bloqueio feito pelo gestor vale na hora'),
      item('Permissões', 'gerência administra acessos e catálogo; supervisor só vê e decide na própria UTD; retaguarda só conclui e remaneja a própria agenda; ninguém aprova o próprio pedido; auditoria só consulta; toda ação fora da permissão é recusada e registrada'))),
    el('section', { class: 'bloco' }, el('h2', { text: 'Política de logs' }), el('ul', { class: 'politica' },
      item('O que é registrado', 'login e logout (com sucesso ou falha), bloqueios, troca de senha, telas abertas, agendas e atividades consultadas, conclusões com evidência, remanejamentos, pedidos e decisões, registros sob demanda, alterações de catálogo, regras e ocupação, importações, exportações, mudanças de preferência, ações negadas, erros de validação e erros do sistema'),
      item('Campos', 'sequência, data/hora, usuário, perfil, sessão, categoria, ação, registro afetado, resultado, detalhe, aparelho, online/offline e hash'),
      item('Proteção', 'registro só de inclusão, encadeado por SHA-256: alterar ou apagar qualquer linha é detectado na verificação de integridade'),
      item('Privacidade (LGPD)', 'senhas e credenciais nunca entram no log; o app não usa localização; acesso aos logs só para gerência e auditoria, e a própria consulta fica registrada'),
      item('Retenção', `${P.retencaoLogsDias} dias (definir com Segurança da Informação e DPO)`),
      item('Restauração dos dados de demonstração', 'não apaga o log'))),
    el('section', { class: 'bloco' }, el('h2', { text: 'Limites deste protótipo' }), el('ul', { class: 'politica' },
      item('Login', 'é local ao aparelho. Em produção: SSO corporativo com MFA (Microsoft Entra ID), sem senha guardada no app'),
      item('Logs', 'ficam no aparelho e quem controla o navegador pode apagá-los ou reconstruir a cadeia. Em produção: envio contínuo para servidor só de inclusão/SIEM, que é a cópia oficial'),
      item('Permissões', 'checadas no navegador; em produção, no servidor com RLS'))));
}
