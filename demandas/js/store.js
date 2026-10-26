// Persistência local (IndexedDB), trilha de auditoria e fila de sincronização simulada.
// No produto real a fila é enviada à API; aqui ela só demonstra o comportamento offline-first.
import { uid } from './util.js';
import { gerarSeed, VERSAO_SCHEMA } from './seed.js';
import { logar } from './auditoria.js';

const NOME_DB = 'central-demandas';
let dbPromessa;

function abrirDb() {
  dbPromessa ||= new Promise((res, rej) => {
    const r = indexedDB.open(NOME_DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      // Log de auditoria: só inclusão (append-only), chave = sequência.
      if (!db.objectStoreNames.contains('logs')) db.createObjectStore('logs', { keyPath: 'seq' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbPromessa;
}

export async function idb(loja, modo, fn) {
  const db = await abrirDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(loja, modo);
    const req = fn(tx.objectStore(loja));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
  });
}

export const estado = {
  dados: null,
  usuario: null,
  offlineSimulado: false,
};

export const eventos = new EventTarget();
export const emitir = (nome, detalhe) => eventos.dispatchEvent(new CustomEvent(nome, { detail: detalhe }));

export const online = () => navigator.onLine && !estado.offlineSimulado;
export const usuarioPorId = (id) => estado.dados.usuarios.find((u) => u.id === id) || null;
export const nomeUsuario = (id) => usuarioPorId(id)?.nome || id || '—';
export const demandaPorId = (id) => estado.dados.demandas.find((x) => x.id === id) || null;

export async function carregar() {
  let d = null;
  try { d = await idb('kv', 'readonly', (s) => s.get('dados')); } catch { d = null; }
  if (d && d.versaoSchema === VERSAO_SCHEMA) estado.dados = d;
  else {
    estado.dados = gerarSeed();
    // Atualização do app: os dados de demonstração são refeitos, mas as contas (senha pessoal, bloqueio pelo gestor)
    // são preservadas pela matrícula. Bloqueios temporários por tentativa não são carregados.
    if (d?.usuarios) {
      const antigos = new Map(d.usuarios.filter((u) => u.matricula).map((u) => [u.matricula, u]));
      for (const u of estado.dados.usuarios) {
        const a = antigos.get(u.matricula);
        if (a) Object.assign(u, { credencial: a.credencial ?? null, senhasAnteriores: a.senhasAnteriores, trocarSenha: a.trocarSenha ?? true, ativo: a.ativo !== false, ultimoAcesso: a.ultimoAcesso });
      }
    }
  }
  await persistir();
}

export function persistir() {
  return idb('kv', 'readwrite', (s) => s.put(estado.dados, 'dados')).catch((e) => console.error('Falha ao salvar', e));
}

export async function resetarDados() {
  await idb('kv', 'readwrite', (s) => s.clear());
  // O log de auditoria NÃO é apagado no reset: a própria restauração fica registrada.
  estado.dados = gerarSeed();
  await persistir();
  emitir('mudou');
}

// ---------- Rascunhos (efeito Zeigarnik: pedido começado não se perde e fica visível até ser criado) ----------
export function salvarRascunho(r) {
  estado.dados.rascunhos ||= {};
  estado.dados.rascunhos[r.chave] = { ...r, usuarioId: estado.usuario.id, atualizadoEm: new Date().toISOString() };
  persistir();
  emitir('rascunho');
}
export function removerRascunho(chave) {
  if (!estado.dados.rascunhos?.[chave]) return;
  delete estado.dados.rascunhos[chave];
  persistir();
  emitir('rascunho');
}
export const obterRascunho = (chave) => estado.dados.rascunhos?.[chave] || null;
export const rascunhosDoUsuario = () => Object.values(estado.dados.rascunhos || {}).filter((r) => r.usuarioId === estado.usuario?.id);

/** Toda mutação passa por aqui: grava auditoria, enfileira para sync e notifica as telas. */
export function registrar(acao, entidade, entidadeId, detalhe = {}, categoria = 'ESCRITA') {
  const em = new Date().toISOString();
  const d = estado.dados;
  logar({ categoria, acao, entidade, entidadeId, detalhe });
  d.fila.push({ id: uid('op'), acao, entidade, entidadeId, em, bytes: JSON.stringify(detalhe).length + 120 });
  // Grava imediatamente: registro não pode depender de a aba continuar aberta.
  persistir();
  emitir('mudou');
  sincronizar();
}

export const resumoFila = () => ({ total: estado.dados.fila.length });

/** Simula o envio da fila ao servidor. */
export function sincronizar() {
  const d = estado.dados;
  const lote = online() ? [...d.fila] : [];
  if (!lote.length) { emitir('sync'); return; }
  setTimeout(() => {
    if (!online()) return;
    const ids = new Set(lote.map((o) => o.id));
    d.fila = d.fila.filter((o) => !ids.has(o.id));
    d.ultimaSync = new Date().toISOString();
    persistir();
    emitir('sync', { enviados: lote.length });
  }, 600);
}
