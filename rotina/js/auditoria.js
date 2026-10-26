// Log de auditoria: toda ação de usuário vira um registro só de inclusão, encadeado por hash (SHA-256).
// Cada registro guarda o hash do anterior; alterar ou apagar qualquer linha quebra a cadeia e é detectado em verificarIntegridade().
// Limite honesto: no aparelho, quem controla o navegador pode reconstruir a cadeia inteira. Em produção os registros
// são enviados a um servidor só de inclusão / SIEM, que é a cópia que vale para auditoria.
import { idb, estado } from './store.js';
import { sha256 } from './util.js';

export const CATEGORIAS_LOG = {
  AUTENTICACAO: 'Autenticação',
  NAVEGACAO: 'Navegação',
  LEITURA: 'Consulta',
  ESCRITA: 'Alteração de dados',
  EXPORTACAO: 'Exportação',
  ADMIN: 'Administração de acesso',
  SEGURANCA: 'Segurança',
  VALIDACAO: 'Validação',
  SISTEMA: 'Sistema',
};
export const RESULTADOS_LOG = { OK: 'Sucesso', NEGADO: 'Negado', INVALIDO: 'Inválido', ERRO: 'Erro' };

const SENSIVEL = /senha|password|token|segredo|secret|salt|credencial/i;
let ultimo; // { seq, hash } — undefined até carregar
let cadeia = Promise.resolve();

/** Remove campos sensíveis e limita tamanho — log não pode virar vazamento. */
function limpar(v, prof = 0) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') return v.length > 300 ? `${v.slice(0, 300)}…` : v;
  if (typeof v !== 'object') return v;
  if (prof > 3) return '[…]';
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => limpar(x, prof + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = SENSIVEL.test(k) ? '[omitido]' : limpar(x, prof + 1);
  return out;
}

function dispositivo() {
  const ua = navigator.userAgent;
  const so = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Outro';
  const nav = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Outro';
  return `${so} · ${nav}${navigator.standalone || matchMedia('(display-mode: standalone)').matches ? ' · app instalado' : ''}`;
}

const hashDe = ({ hash, ...base }) => sha256(new Blob([JSON.stringify(base)]));

async function carregarUltimo() {
  const n = await idb('logs', 'readonly', (s) => s.count());
  const r = n ? await idb('logs', 'readonly', (s) => s.get(n)) : null;
  ultimo = r ? { seq: r.seq, hash: r.hash } : null;
}

/**
 * Registra uma ação. Chamadas são serializadas para manter a sequência e a cadeia de hash.
 * categoria: chave de CATEGORIAS_LOG · resultado: chave de RESULTADOS_LOG.
 */
export function logar({ categoria, acao, entidade = null, entidadeId = null, detalhe = {}, resultado = 'OK', usuario }) {
  const base = {
    em: new Date().toISOString(),
    usuario: usuario ?? estado.usuario?.id ?? null,
    perfil: estado.usuario?.perfil ?? null,
    sessao: estado.sessaoId ?? null,
    categoria, acao, entidade,
    entidadeId: entidadeId === null || entidadeId === undefined ? null : String(entidadeId),
    resultado,
    detalhe: limpar(detalhe),
    dispositivo: dispositivo(),
    online: navigator.onLine && !estado.offlineSimulado,
  };
  cadeia = cadeia.then(async () => {
    if (ultimo === undefined) await carregarUltimo();
    const reg = { seq: (ultimo?.seq || 0) + 1, ...base, hashAnterior: ultimo?.hash || 'GENESIS' };
    reg.hash = await hashDe(reg);
    await idb('logs', 'readwrite', (s) => s.add(reg)); // add (não put): nunca sobrescreve um registro existente
    ultimo = { seq: reg.seq, hash: reg.hash };
  }).catch((e) => console.error('Falha ao gravar log de auditoria', e));
  return cadeia;
}

export const aguardarLogs = () => cadeia;

export async function todosLogs() {
  await cadeia;
  return idb('logs', 'readonly', (s) => s.getAll());
}

export async function consultarLogs({ usuario = '', categoria = '', resultado = '', texto = '' } = {}) {
  const t = texto.trim().toLowerCase();
  return (await todosLogs()).reverse().filter((r) => (!usuario || r.usuario === usuario)
    && (!categoria || r.categoria === categoria) && (!resultado || r.resultado === resultado)
    && (!t || `${r.acao} ${r.entidade} ${r.entidadeId} ${JSON.stringify(r.detalhe)}`.toLowerCase().includes(t)));
}

/** Recalcula a cadeia inteira. Detecta registro alterado, removido ou fora de ordem. */
export async function verificarIntegridade() {
  const todos = (await todosLogs()).sort((a, b) => a.seq - b.seq);
  let anterior = 'GENESIS';
  for (let i = 0; i < todos.length; i++) {
    const r = todos[i];
    if (r.seq !== i + 1) return { ok: false, total: todos.length, quebraEm: i + 1, motivo: `registro ${i + 1} ausente (sequência pula para ${r.seq})` };
    if (r.hashAnterior !== anterior) return { ok: false, total: todos.length, quebraEm: r.seq, motivo: `encadeamento rompido no registro ${r.seq}` };
    if ((await hashDe(r)) !== r.hash) return { ok: false, total: todos.length, quebraEm: r.seq, motivo: `conteúdo do registro ${r.seq} foi alterado` };
    anterior = r.hash;
  }
  return { ok: true, total: todos.length };
}
