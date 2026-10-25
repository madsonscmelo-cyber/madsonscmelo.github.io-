// Persistência local (IndexedDB), trilha de auditoria e fila de sincronização simulada.
// No produto real a fila é enviada à API; aqui ela só demonstra o comportamento offline-first.
import { uid } from './util.js';
import { gerarSeed, VERSAO_SCHEMA } from './seed.js';
import { logar } from './auditoria.js';

const NOME_DB = 'redeviva';
let dbPromessa;

function abrirDb() {
  dbPromessa ||= new Promise((res, rej) => {
    const r = indexedDB.open(NOME_DB, 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('fotos')) db.createObjectStore('fotos');
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


export async function salvarFoto(blob) {
  const id = uid('foto');
  await idb('fotos', 'readwrite', (s) => s.put(blob, id));
  // Foto entra na fila separada dos registros: o texto sobe primeiro, a foto pode esperar o Wi-Fi.
  estado.dados.fila.push({ id: uid('op'), tipo: 'foto', entidadeId: id, bytes: blob.size, em: new Date().toISOString() });
  logar({ categoria: 'ESCRITA', acao: 'FOTO_CAPTURADA', entidade: 'foto', entidadeId: id, detalhe: { bytes: blob.size } });
  persistir();
  emitir('sync');
  return id;
}
export const obterFoto = (id) => idb('fotos', 'readonly', (s) => s.get(id));

export async function resetarDados() {
  await idb('kv', 'readwrite', (s) => s.clear());
  await idb('fotos', 'readwrite', (s) => s.clear());
  // O log de auditoria NÃO é apagado no reset: a própria restauração fica registrada.
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
export function registrar(acao, entidade, entidadeId, detalhe = {}, categoria = 'ESCRITA') {
  const em = new Date().toISOString();
  const d = estado.dados;
  d.auditoria.unshift({ id: uid('aud'), em, usuario: estado.usuario?.id, perfil: estado.usuario?.perfil, acao, entidade, entidadeId, detalhe });
  d.auditoria.length = Math.min(d.auditoria.length, 300); // cache recente para as telas; o log completo fica no store 'logs'
  logar({ categoria, acao, entidade, entidadeId, detalhe });
  d.fila.push({ id: uid('op'), tipo: 'dados', acao, entidade, entidadeId, em, bytes: JSON.stringify(detalhe).length + 120 });
  // Grava imediatamente: dado de campo não pode depender de a aba continuar aberta.
  persistir();
  emitir('mudou');
  sincronizar();
}

export function resumoFila() {
  const f = estado.dados.fila;
  const dados = f.filter((o) => o.tipo === 'dados'), fotos = f.filter((o) => o.tipo === 'foto');
  const soma = (l) => l.reduce((t, o) => t + (o.bytes || 0), 0);
  return { total: dados.length + fotos.length, dados: dados.length, fotos: fotos.length, bytesDados: soma(dados), bytesFotos: soma(fotos) };
}

/** Wi-Fi ou rede desconhecida = libera fotos; rede móvel informada pelo navegador = segura as fotos. */
export function redeMovel() {
  if (estado.redeMovelSimulada) return true;
  const c = navigator.connection;
  return !!c && (c.type === 'cellular' || ['slow-2g', '2g', '3g'].includes(c.effectiveType));
}

/** Simula o envio da fila ao servidor: registros sempre primeiro; fotos só fora da rede móvel, se configurado. */
export function sincronizar() {
  const d = estado.dados;
  const segurarFotos = (d.config?.fotosSoWifi ?? true) && redeMovel();
  const lote = online() ? d.fila.filter((o) => o.tipo !== 'foto' || !segurarFotos) : [];
  if (!lote.length) { emitir('sync'); return; }
  setTimeout(() => {
    if (!online()) return;
    const ids = new Set(lote.map((o) => o.id));
    d.fila = d.fila.filter((o) => !ids.has(o.id));
    d.ultimaSync = new Date().toISOString();
    persistir();
    emitir('sync', { enviados: lote.length, fotosRetidas: d.fila.filter((o) => o.tipo === 'foto').length });
  }, 600);
}
