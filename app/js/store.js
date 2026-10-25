// Persistência local (IndexedDB), trilha de auditoria e fila de sincronização simulada.
// No produto real a fila é enviada à API; aqui ela só demonstra o comportamento offline-first.
import { uid } from './util.js';
import { gerarSeed, VERSAO_SCHEMA } from './seed.js';

const NOME_DB = 'redeviva';
let dbPromessa;

function abrirDb() {
  dbPromessa ||= new Promise((res, rej) => {
    const r = indexedDB.open(NOME_DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('kv');
      r.result.createObjectStore('fotos');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbPromessa;
}

async function idb(loja, modo, fn) {
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
  posicao: null, // { lat, lon, precisao, simulada, em }
  offlineSimulado: false,
};

export const eventos = new EventTarget();
export const emitir = (nome, detalhe) => eventos.dispatchEvent(new CustomEvent(nome, { detail: detalhe }));

export const online = () => navigator.onLine && !estado.offlineSimulado;
export const equipeDoUsuario = () => estado.dados.equipes.find((e) => e.id === estado.usuario?.equipeId) || null;
export const ativoPorId = (id) => estado.dados.ativos.find((a) => a.id === id);
export const nomeUsuario = (id) => estado.dados.usuarios.find((u) => u.id === id)?.nome || id || '—';
export const nomeEquipe = (id) => estado.dados.equipes.find((e) => e.id === id)?.nome || '—';

export async function carregar() {
  let d = null;
  try { d = await idb('kv', 'readonly', (s) => s.get('dados')); } catch { d = null; }
  estado.dados = d && d.versaoSchema === VERSAO_SCHEMA ? d : gerarSeed();
  await persistir();
}

export function persistir() {
  return idb('kv', 'readwrite', (s) => s.put(estado.dados, 'dados')).catch((e) => console.error('Falha ao salvar', e));
}


export async function salvarFoto(blob) {
  const id = uid('foto');
  await idb('fotos', 'readwrite', (s) => s.put(blob, id));
  return id;
}
export const obterFoto = (id) => idb('fotos', 'readonly', (s) => s.get(id));

export async function resetarDados() {
  await idb('kv', 'readwrite', (s) => s.clear());
  await idb('fotos', 'readwrite', (s) => s.clear());
  estado.dados = gerarSeed();
  await persistir();
  emitir('mudou');
}

// ---------- Rascunhos (efeito Zeigarnik: trabalho iniciado não se perde e fica visível até ser concluído) ----------
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
export function registrar(acao, entidade, entidadeId, detalhe = {}) {
  const em = new Date().toISOString();
  const d = estado.dados;
  d.auditoria.unshift({ id: uid('aud'), em, usuario: estado.usuario?.id, perfil: estado.usuario?.perfil, acao, entidade, entidadeId, detalhe });
  d.auditoria.length = Math.min(d.auditoria.length, 1000);
  d.fila.push({ id: uid('op'), acao, entidade, entidadeId, em });
  // Grava imediatamente: dado de campo não pode depender de a aba continuar aberta.
  persistir();
  emitir('mudou');
  sincronizar();
}

/** Simula o envio da fila ao servidor quando há conexão. */
export function sincronizar() {
  const d = estado.dados;
  if (!online() || !d.fila.length) { emitir('sync'); return; }
  setTimeout(() => {
    if (!online()) return;
    const n = d.fila.length;
    d.fila = [];
    d.ultimaSync = new Date().toISOString();
    persistir();
    emitir('sync', { enviados: n });
  }, 600);
}
