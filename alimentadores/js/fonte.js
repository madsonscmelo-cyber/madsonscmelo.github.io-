// Base pública: o app busca sozinho, ao abrir, a base do Setor Norte publicada no mesmo site (GitHub Pages, mesma origem).
// Só leitura (GET) de arquivos estáticos; nada é enviado. Cada parte é conferida pelo SHA-256 do manifesto antes de entrar.
// Formato do manifesto (app.json):
//   { "versao": "2026-10-28", "titulo": "Setor Norte", "padrao": "REMANSO",
//     "utds": [ { "id": "REMANSO", "nome": "Remanso", "postes": [{ "arquivo": "postes_REMANSO_p01.csv", "sha256": "…", "bytes": 1 }],
//                 "ocorrencias": [ … ], "compensacoes": [ … ] } ] }
import { CONFIG } from './config.js';
import { montarBase } from './importar.js';

export const temBasePublica = () => !!CONFIG.basePublica;
const pasta = () => CONFIG.basePublica.replace(/[^/]*$/, '');

/** Lê o manifesto. Devolve null quando não há base publicada (404, sem rede): o app segue com a demonstração. */
export async function lerManifesto() {
  if (!temBasePublica()) return null;
  try {
    const r = await fetch(CONFIG.basePublica, { cache: 'no-cache', credentials: 'omit' });
    if (!r.ok) return null;
    const m = await r.json();
    return Array.isArray(m?.utds) && m.utds.length ? m : null;
  } catch { return null; }
}

async function sha256Texto(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Baixa as partes de um tipo, confere o hash de cada uma e junta (o cabeçalho só da primeira parte). */
async function baixarTipo(partes, aoProgresso) {
  let texto = '';
  for (const [i, p] of (partes || []).entries()) {
    if (!/^[\w.-]+\.csv$/.test(p.arquivo)) throw new Error(`Nome de arquivo inválido no manifesto: ${p.arquivo}`);
    const r = await fetch(pasta() + p.arquivo, { cache: 'no-cache', credentials: 'omit' });
    if (!r.ok) throw new Error(`${p.arquivo}: HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    if (p.sha256 && (await sha256Texto(buf)) !== p.sha256) throw new Error(`${p.arquivo}: conteúdo diferente do manifesto (arquivo corrompido ou trocado).`);
    let t = new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '');
    if (i > 0) t = t.slice(t.indexOf('\n') + 1);
    texto += (texto && !texto.endsWith('\n') ? '\n' : '') + t;
    aoProgresso?.(p.bytes || buf.byteLength);
  }
  return texto;
}

/** Monta a base de uma UTD a partir da publicação. Lança erro com mensagem para o usuário. */
export async function carregarUTD(manifesto, utdId, aoProgresso) {
  const u = manifesto.utds.find((x) => x.id === utdId) || manifesto.utds.find((x) => x.id === manifesto.padrao) || manifesto.utds[0];
  const total = ['postes', 'ocorrencias', 'compensacoes'].flatMap((k) => u[k] || []).reduce((s, p) => s + (p.bytes || 0), 0) || 1;
  let feito = 0;
  const prog = (b) => { feito += b; aoProgresso?.(Math.min(1, feito / total)); };
  const [postes, ocorrencias, compensacoes] = [await baixarTipo(u.postes, prog), await baixarTipo(u.ocorrencias, prog), await baixarTipo(u.compensacoes, prog)];
  const { rede, rel } = montarBase({ postes, ocorrencias, compensacoes });
  if (!rede) throw new Error(`A base publicada da UTD ${u.nome} não pôde ser lida: ${rel.avisos.join(' ')}`);
  Object.assign(rede, { origem: 'PUBLICA', versao: `pub-${manifesto.versao}-${u.id}`, utd: u.id, utdNome: u.nome, titulo: manifesto.titulo || 'Base publicada', rel: { aceitas: rel.aceitas, recusadas: rel.recusadas, avisos: rel.avisos } });
  return rede;
}
