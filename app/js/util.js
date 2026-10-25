// Utilitários sem dependência de domínio.
// Regra de segurança do protótipo: nunca montar HTML com texto de usuário.
// Todo conteúdo dinâmico passa por el() / textContent.

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

/** Cria elemento de forma segura. attrs: class, text, on<Evento>, dataset, demais atributos. */
export function el(tag, attrs = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style') throw new Error('Use classes CSS (CSP bloqueia style inline).');
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, String(v));
  }
  for (const f of filhos.flat()) {
    if (f === null || f === undefined || f === false) continue;
    n.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return n;
}

export function svgEl(tag, attrs = {}, ...filhos) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  for (const f of filhos.flat()) if (f) n.append(f instanceof Node ? f : document.createTextNode(String(f)));
  return n;
}

export function uid(prefixo) {
  const r = globalThis.crypto?.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(16).slice(2, 10);
  return `${prefixo}-${r}`;
}

/** Distância em metros (haversine). */
export function distanciaM(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Desloca um ponto em metros (norte, leste). */
export function deslocar([lat, lon], norteM, lesteM) {
  return [lat + norteM / 111320, lon + lesteM / (111320 * Math.cos(lat * Math.PI / 180))];
}

export const hojeISO = () => dataISO(new Date());
export const dataISO = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export function somarDias(iso, dias) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return dataISO(d);
}
export function diasEntre(isoA, isoB) {
  return Math.round((new Date(`${isoB.slice(0, 10)}T12:00:00`) - new Date(`${isoA.slice(0, 10)}T12:00:00`)) / 86400000);
}

const fmtD = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDH = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtR = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const fmtN = new Intl.NumberFormat('pt-BR');
export const fmtData = (iso) => (iso ? fmtD.format(new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)) : '—');
export const fmtDataHora = (iso) => (iso ? fmtDH.format(new Date(iso)) : '—');
export const fmtMoeda = (v) => fmtR.format(v || 0);
export const fmtNum = (v) => fmtN.format(v || 0);
export const fmtPct = (v) => `${Math.round((v || 0) * 100)}%`;

/** Gerador pseudoaleatório determinístico (dados sintéticos reproduzíveis). */
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** CSV com separador detectado (; ou ,) e suporte a aspas. */
export function csvParse(texto) {
  const t = texto.replace(/^﻿/, '');
  const primeira = t.split(/\r?\n/, 1)[0] || '';
  const sep = (primeira.match(/;/g) || []).length > (primeira.match(/,/g) || []).length ? ';' : ',';
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.some((x) => x.trim() !== '')) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim() !== '')) linhas.push(linha);
  return linhas;
}

export function csvStringify(linhas) {
  // Prefixa fórmulas para evitar CSV injection ao abrir no Excel.
  const cel = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + linhas.map((l) => l.map(cel).join(';')).join('\r\n');
}

export function baixarArquivo(nome, conteudo, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([conteudo], { type: mime }));
  const a = el('a', { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function toast(msg, { tipo = 'info', acao, duracao = 4500 } = {}) {
  const caixa = $('#toasts');
  const t = el('div', { class: `toast toast--${tipo}`, role: 'status' }, el('span', { text: msg }));
  if (acao) t.append(el('button', { class: 'toast__btn', text: acao.texto, onclick: () => { acao.fn(); t.remove(); } }));
  caixa.append(t);
  setTimeout(() => t.remove(), duracao);
}

export async function sha256(blob) {
  if (!globalThis.crypto?.subtle) return null;
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Semanas (ISO 8601: começa na segunda) ----------
export function semanaISO(iso) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  const dia = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dia + 3);
  const ano = d.getFullYear();
  const primeira = new Date(`${ano}-01-04T12:00:00`);
  const n = 1 + Math.round(((d - primeira) / 86400000 - 3 + ((primeira.getDay() + 6) % 7)) / 7);
  return `${ano}-W${String(n).padStart(2, '0')}`;
}
export function diasDaSemana(semana) {
  const [ano, w] = semana.split('-W').map(Number);
  const jan4 = new Date(`${ano}-01-04T12:00:00`);
  const seg = new Date(jan4);
  seg.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (w - 1) * 7);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(seg); d.setDate(seg.getDate() + i); return dataISO(d); });
}
export const deslocarSemana = (semana, n) => semanaISO(somarDias(diasDaSemana(semana)[0], 7 * n));
export function proximoDiaUtil(iso = hojeISO()) {
  let d = somarDias(iso, 1);
  while ([0, 6].includes(new Date(`${d}T12:00:00`).getDay())) d = somarDias(d, 1);
  return d;
}
