// Persistência local (IndexedDB). Duas chaves: 'dados' (contas, segurança, preferências) e 'rede' (alimentadores, postes,
// ocorrências e compensações). A rede fica separada porque é grande e só muda na importação: login e preferências não a regravam.
// A base importada fica SÓ neste aparelho: não há envio para servidor nesta fase.
import { gerarRede, usuariosSeed, VERSAO_SCHEMA } from './seed.js';
import { limparCache } from './dominio.js';
import { hojeISO } from './util.js';

const NOME_DB = 'raiox-alimentadores';
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
  rede: null,
  usuario: null,
  offlineSimulado: false,
  // Seleção corrente (vale entre telas): alimentador, período e filtro.
  sel: { al: '', periodo: 'ATUAL', camadas: [], modo: 'OU', causa: '', chiMin: 0, aba: 'resumo', fundo: 'ruas' },
};

export const eventos = new EventTarget();
export const emitir = (nome, detalhe) => eventos.dispatchEvent(new CustomEvent(nome, { detail: detalhe }));
export const online = () => navigator.onLine && !estado.offlineSimulado;
export const usuarioPorId = (id) => estado.dados.usuarios.find((u) => u.id === id) || null;

function dadosNovos() {
  return { versaoSchema: VERSAO_SCHEMA, usuarios: usuariosSeed(), seguranca: { tentativas: {}, falhasAparelho: [] }, fila: [], ultimaSync: null };
}

export async function carregar() {
  let d = null, rede = null;
  try { [d, rede] = await Promise.all([idb('kv', 'readonly', (s) => s.get('dados')), idb('kv', 'readonly', (s) => s.get('rede'))]); } catch { d = null; rede = null; }
  if (d && d.versaoSchema === VERSAO_SCHEMA) estado.dados = d;
  else {
    estado.dados = dadosNovos();
    // Atualização do app: contas preservadas pela matrícula (senha pessoal e bloqueio pelo gestor).
    if (d?.usuarios) {
      const antigos = new Map(d.usuarios.filter((u) => u.matricula).map((u) => [u.matricula, u]));
      for (const u of estado.dados.usuarios) {
        const a = antigos.get(u.matricula);
        if (a) Object.assign(u, { credencial: a.credencial ?? null, senhasAnteriores: a.senhasAnteriores, trocarSenha: a.trocarSenha ?? true, ativo: a.ativo !== false, ultimoAcesso: a.ultimoAcesso });
      }
    }
  }
  // Base sintética é refeita a cada dia (datas relativas a hoje). Base importada nunca é trocada sem ação do usuário.
  if (rede?.origem === 'IMPORTADA' || (rede?.origem === 'SINTETICA' && rede.versao?.endsWith(hojeISO()))) estado.rede = rede;
  else { estado.rede = gerarRede(); await salvarRede(); }
  await persistir();
}

export function persistir() {
  return idb('kv', 'readwrite', (s) => s.put(estado.dados, 'dados')).catch((e) => console.error('Falha ao salvar', e));
}

export async function salvarRede() {
  limparCache();
  await idb('kv', 'readwrite', (s) => s.put(estado.rede, 'rede'));
}

/** Troca a base inteira (importação validada). */
export async function substituirRede(rede) {
  estado.rede = rede;
  estado.sel.al = '';
  await salvarRede();
  emitir('mudou');
}

/** Apaga a base importada deste aparelho e volta para a sintética. */
export async function restaurarRedeSintetica() {
  estado.rede = gerarRede();
  estado.sel.al = '';
  await salvarRede();
  emitir('mudou');
}

export async function resetarDados() {
  await idb('kv', 'readwrite', (s) => s.clear());
  // O log de auditoria NÃO é apagado no reset: a própria restauração fica registrada.
  estado.dados = dadosNovos();
  estado.rede = gerarRede();
  await salvarRede();
  await persistir();
  emitir('mudou');
}

export const resumoFila = () => ({ total: estado.dados.fila.length });
// Nesta fase nada é enviado: a fila existe para o topo mostrar o mesmo estado dos outros apps (sempre vazia aqui).
export function sincronizar() { emitir('sync'); }
