// Utilitários sem dependência de domínio.
// Regra de segurança do protótipo: nunca montar HTML com texto de usuário.
// Todo conteúdo dinâmico passa por el() / textContent.

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

/** Cria elemento de forma segura. attrs: class, text, on<Evento>, dataset, demais atributos. */
export function el(tag, attrs = {}, ...filhos) {
  const n = document.createElement(tag);
  // Acessibilidade (WCAG 2.1.1): área com rolagem horizontal precisa ser alcançável e nomeada para teclado e leitor de tela.
  if (String(attrs?.class || '').split(' ').includes('tabela-wrap')) {
    n.tabIndex = 0;
    n.setAttribute('role', 'region');
    if (!attrs['aria-label']) n.setAttribute('aria-label', 'Tabela — use as setas para rolar');
  }
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
  // Nome único por tabela (WCAG landmark-unique): usa as primeiras colunas do cabeçalho.
  if (n.getAttribute('aria-label') === 'Tabela — use as setas para rolar') {
    const cols = [...n.querySelectorAll('thead th')].slice(0, 3).map((th) => th.textContent.trim()).filter(Boolean);
    if (cols.length) n.setAttribute('aria-label', `Tabela: ${cols.join(', ')} — use as setas para rolar`);
  }
  return n;
}

/** replaceChildren/append ignorando null/false (filhos condicionais). Sem isso o DOM recebe o texto "null". */
const validos = (filhos) => filhos.flat().filter((f) => f !== null && f !== undefined && f !== false);
export const preencher = (n, ...filhos) => n.replaceChildren(...validos(filhos));
export const anexar = (n, ...filhos) => n.append(...validos(filhos));

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
