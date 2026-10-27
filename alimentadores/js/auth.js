// Autenticação local da demonstração + política de senha e de sessão.
// Em produção isto é substituído por SSO corporativo (OIDC) com MFA; as regras de bloqueio, expiração e
// trilha de auditoria continuam valendo, mas aplicadas no servidor (checklist de segurança, fase 2).
import { estado, persistir } from './store.js';
import { logar } from './auditoria.js';
import { uid } from './util.js';

// Valores padrão; o Administrador ajusta na tela Parâmetros (grupo Política de acesso), dentro de limites mínimos.
export const POLITICA = {
  senhaMinimo: 10,
  classesMinimas: 3, // de: maiúscula, minúscula, número, símbolo
  historicoSenhas: 3,
  tentativasMaximas: 5,
  bloqueioMinutos: 15,
  falhasPorAparelho: 20,
  inatividadeMinutos: 20,
  sessaoMaximaHoras: 10, // um turno
  iteracoesPbkdf2: 210000,
  senhaInicialDemo: 'Rede@Raiox2026',
  retencaoLogsDias: 365,
};

const COMUNS = ['123456', '12345678', '123456789', '1234567890', 'senha', 'senha123', 'senha@123', 'password', 'qwerty', 'abc123',
  'admin', 'mudar123', 'neoenergia', 'energia', 'redeviva', 'rede@2026', 'rotina', 'rotina@2026', 'demandas', 'demandas@2026', 'alimentador', 'raiox', 'raiox@2026', 'rede@raiox2026', 'supervisor', 'brasil', 'iloveyou', '11111111', '00000000'];
const MSG_INVALIDO = 'Matrícula ou senha inválidas.';
const msgBloqueio = () => `Acesso temporariamente bloqueado após várias tentativas. Aguarde ${POLITICA.bloqueioMinutos} minutos ou procure o gestor.`;
const CHAVE_SESSAO = 'alimentadores-sessao';

export class ErroAuth extends Error {}

const normalizar = (m) => String(m || '').trim().toUpperCase().slice(0, 30);
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const seguranca = () => (estado.dados.seguranca ||= { tentativas: {}, falhasAparelho: [] });

async function derivar(senha, salt, iteracoes) {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(atob(salt), (c) => c.charCodeAt(0)), iterations: iteracoes }, chave, 256);
  return b64(bits);
}

// ---------- Política de senha ----------
export function avaliarSenha(senha, usuario) {
  const classes = [/[A-Z]/, /[a-z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(senha)).length;
  const baixa = senha.toLowerCase();
  const pessoais = [usuario?.matricula, ...(usuario?.nome || '').split(/\s+/)].filter((x) => x && x.length >= 3).map((x) => x.toLowerCase());
  return [
    { regra: `Pelo menos ${POLITICA.senhaMinimo} caracteres`, ok: senha.length >= POLITICA.senhaMinimo },
    { regra: 'Ao menos 3 de: maiúscula, minúscula, número, símbolo', ok: classes >= POLITICA.classesMinimas },
    { regra: 'Não contém sua matrícula nem seu nome', ok: !pessoais.some((p) => baixa.includes(p)) },
    { regra: 'Não é uma senha comum nem a senha inicial', ok: !COMUNS.includes(baixa) && senha !== POLITICA.senhaInicialDemo },
  ];
}

// ---------- Login ----------
export async function autenticar(matricula, senha) {
  if (!globalThis.crypto?.subtle) throw new ErroAuth('Este navegador não oferece criptografia segura (use HTTPS).');
  const mat = normalizar(matricula);
  const sg = seguranca();
  const agora = Date.now(), janela = POLITICA.bloqueioMinutos * 60000;
  sg.falhasAparelho = sg.falhasAparelho.filter((t) => agora - t < janela);
  if (sg.falhasAparelho.length >= POLITICA.falhasPorAparelho) {
    logar({ categoria: 'SEGURANCA', acao: 'APARELHO_BLOQUEADO', resultado: 'NEGADO', usuario: mat, detalhe: { falhas: sg.falhasAparelho.length } });
    throw new ErroAuth(msgBloqueio());
  }
  const t = (sg.tentativas[mat] ||= { n: 0, bloqueadoAte: 0 });
  if (t.bloqueadoAte > agora) {
    logar({ categoria: 'SEGURANCA', acao: 'LOGIN_DURANTE_BLOQUEIO', resultado: 'NEGADO', usuario: mat });
    throw new ErroAuth(msgBloqueio());
  }
  const u = estado.dados.usuarios.find((x) => x.matricula === mat);
  let ok = false;
  if (u && u.ativo !== false) {
    ok = u.credencial
      ? (await derivar(senha, u.credencial.salt, u.credencial.iteracoes)) === u.credencial.hash
      : senha === POLITICA.senhaInicialDemo;
  } else {
    await derivar(senha, 'AAAAAAAAAAAAAAAAAAAAAA==', POLITICA.iteracoesPbkdf2); // mesmo tempo de resposta: não revela se a matrícula existe
  }
  if (!ok) {
    t.n++;
    sg.falhasAparelho.push(agora);
    logar({ categoria: 'AUTENTICACAO', acao: 'LOGIN_FALHA', resultado: 'NEGADO', usuario: mat, detalhe: { tentativa: t.n, motivo: !u ? 'matrícula inexistente' : u.ativo === false ? 'usuário bloqueado' : 'senha incorreta' } });
    if (t.n >= POLITICA.tentativasMaximas) {
      t.bloqueadoAte = agora + janela;
      t.n = 0;
      logar({ categoria: 'SEGURANCA', acao: 'BLOQUEIO_POR_TENTATIVAS', resultado: 'NEGADO', usuario: mat, detalhe: { minutos: POLITICA.bloqueioMinutos } });
    }
    await persistir();
    throw new ErroAuth(t.bloqueadoAte > agora ? msgBloqueio() : MSG_INVALIDO);
  }
  delete sg.tentativas[mat];
  await persistir();
  return { usuario: u, precisaTrocar: !u.credencial || !!u.trocarSenha };
}

export async function trocarSenha(u, nova, confirmacao) {
  const recusar = (motivo, mensagem) => {
    logar({ categoria: 'VALIDACAO', acao: 'SENHA_RECUSADA_POLITICA', resultado: 'INVALIDO', entidade: 'usuario', entidadeId: u.id, usuario: u.id, detalhe: { motivo } });
    return new ErroAuth(mensagem);
  };
  if (nova !== confirmacao) throw recusar('confirmação diferente', 'As duas senhas não conferem.');
  const falhas = avaliarSenha(nova, u).filter((r) => !r.ok);
  if (falhas.length) throw recusar(falhas.map((f) => f.regra).join('; '), `Senha fora da política: ${falhas.map((f) => f.regra.toLowerCase()).join('; ')}.`);
  const anteriores = [u.credencial, ...(u.senhasAnteriores || [])].filter(Boolean).slice(0, POLITICA.historicoSenhas);
  for (const c of anteriores) {
    if ((await derivar(nova, c.salt, c.iteracoes)) === c.hash) throw recusar('senha repetida', `Não reutilize nenhuma das últimas ${POLITICA.historicoSenhas} senhas.`);
  }
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await derivar(nova, salt, POLITICA.iteracoesPbkdf2);
  u.credencial = { salt, hash, iteracoes: POLITICA.iteracoesPbkdf2, alteradaEm: new Date().toISOString() };
  u.senhasAnteriores = anteriores.map(({ salt: s, hash: h, iteracoes: i }) => ({ salt: s, hash: h, iteracoes: i }));
  u.trocarSenha = false;
  await persistir();
  logar({ categoria: 'AUTENTICACAO', acao: 'SENHA_ALTERADA', entidade: 'usuario', entidadeId: u.id, usuario: u.id });
}

// ---------- Sessão ----------
export function iniciarSessao(u) {
  estado.usuario = u;
  estado.sessaoId = uid('ses');
  const agora = Date.now();
  u.ultimoAcesso = new Date(agora).toISOString();
  persistir();
  try { sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify({ usuarioId: u.id, sessaoId: estado.sessaoId, inicio: agora, atividade: agora })); } catch { /* sem storage: sessão só em memória */ }
  logar({ categoria: 'AUTENTICACAO', acao: 'LOGIN_SUCESSO', entidade: 'sessao', entidadeId: estado.sessaoId, detalhe: { perfil: u.perfil } });
}

function lerSessao() {
  try { return JSON.parse(sessionStorage.getItem(CHAVE_SESSAO) || 'null'); } catch { return null; }
}

/** Retoma a sessão após recarregar a página, se ainda válida (mesma aba, dentro dos limites). */
export function retomarSessao() {
  const s = lerSessao();
  if (!s) return null;
  const u = estado.dados.usuarios.find((x) => x.id === s.usuarioId);
  const motivo = !u || u.ativo === false ? 'USUARIO_INATIVO' : Date.now() - s.inicio > POLITICA.sessaoMaximaHoras * 3600000 ? 'TURNO_EXCEDIDO'
    : Date.now() - s.atividade > POLITICA.inatividadeMinutos * 60000 ? 'INATIVIDADE' : null;
  if (motivo) {
    logar({ categoria: 'AUTENTICACAO', acao: 'SESSAO_EXPIRADA', usuario: s.usuarioId, entidade: 'sessao', entidadeId: s.sessaoId, detalhe: { motivo } });
    try { sessionStorage.removeItem(CHAVE_SESSAO); } catch { /* ignora */ }
    return null;
  }
  estado.usuario = u;
  estado.sessaoId = s.sessaoId;
  logar({ categoria: 'AUTENTICACAO', acao: 'SESSAO_RETOMADA', entidade: 'sessao', entidadeId: s.sessaoId });
  return u;
}

let ultimaGravacao = 0;
export function registrarAtividade() {
  const s = lerSessao();
  if (!s || Date.now() - ultimaGravacao < 15000) return;
  ultimaGravacao = Date.now();
  s.atividade = ultimaGravacao;
  try { sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(s)); } catch { /* ignora */ }
}

export function situacaoSessao() {
  const s = lerSessao();
  if (!s) return estado.usuario ? 'ok' : 'sem-sessao';
  if (Date.now() - s.inicio > POLITICA.sessaoMaximaHoras * 3600000) return 'turno-excedido';
  if (Date.now() - s.atividade > POLITICA.inatividadeMinutos * 60000) return 'inativa';
  return 'ok';
}

export function encerrarSessao(acao = 'LOGOUT', detalhe = {}) {
  if (estado.usuario) logar({ categoria: 'AUTENTICACAO', acao, entidade: 'sessao', entidadeId: estado.sessaoId, detalhe });
  try { sessionStorage.removeItem(CHAVE_SESSAO); } catch { /* ignora */ }
  estado.usuario = null;
  estado.sessaoId = null;
}

/** Desbloqueio da tela após inatividade: exige a senha do mesmo usuário. */
export async function desbloquear(senha) {
  const u = estado.usuario;
  const { usuario } = await autenticar(u.matricula, senha);
  if (usuario.id !== u.id) throw new ErroAuth(MSG_INVALIDO);
  const s = lerSessao();
  if (s) { s.atividade = Date.now(); try { sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(s)); } catch { /* ignora */ } }
  logar({ categoria: 'AUTENTICACAO', acao: 'SESSAO_DESBLOQUEADA', entidade: 'sessao', entidadeId: estado.sessaoId });
}

/** Checklist 2.10: relê o usuário ao voltar o foco; bloqueio ou troca de perfil feitos pelo gestor valem na hora. */
export function revalidarUsuario() {
  if (!estado.usuario) return true;
  const u = estado.dados.usuarios.find((x) => x.id === estado.usuario.id);
  if (!u || u.ativo === false) return false;
  estado.usuario = u;
  return true;
}

// ---------- Administração (só gestor) ----------
function exigirGestor() {
  if (!['GESTOR'].includes(estado.usuario?.perfil)) {
    logar({ categoria: 'SEGURANCA', acao: 'ADMIN_NEGADO', resultado: 'NEGADO' });
    throw new ErroAuth('Somente a gerência administra acessos.');
  }
}

export function adminDefinirAtivo(alvo, ativo) {
  exigirGestor();
  if (alvo.id === estado.usuario.id) throw new ErroAuth('Você não pode bloquear o próprio acesso.');
  alvo.ativo = ativo;
  persistir();
  logar({ categoria: 'ADMIN', acao: ativo ? 'USUARIO_DESBLOQUEADO' : 'USUARIO_BLOQUEADO', entidade: 'usuario', entidadeId: alvo.id });
}

export function adminRedefinirSenha(alvo) {
  exigirGestor();
  if (alvo.credencial) alvo.senhasAnteriores = [alvo.credencial, ...(alvo.senhasAnteriores || [])].slice(0, POLITICA.historicoSenhas);
  alvo.credencial = null; // volta a aceitar só a senha inicial, com troca obrigatória no próximo acesso
  alvo.trocarSenha = true;
  delete seguranca().tentativas[alvo.matricula];
  persistir();
  logar({ categoria: 'ADMIN', acao: 'SENHA_REDEFINIDA', entidade: 'usuario', entidadeId: alvo.id, detalhe: { exigeTroca: true } });
}

export function adminLiberarTentativas(alvo) {
  exigirGestor();
  delete seguranca().tentativas[alvo.matricula];
  persistir();
  logar({ categoria: 'ADMIN', acao: 'BLOQUEIO_TEMPORARIO_LIBERADO', entidade: 'usuario', entidadeId: alvo.id });
}

export const bloqueioTemporario = (u) => {
  const t = seguranca().tentativas[u.matricula];
  return t && t.bloqueadoAte > Date.now() ? new Date(t.bloqueadoAte) : null;
};
