// Trabalho offline por alimentador: pacote leve com o recorte de dados + mapa só do corredor da rede.
// Em produção o recorte vem da API (snapshot versionado do alimentador); aqui ele é extraído dos dados locais.
import { el, toast, fmtDataHora, fmtNum, hojeISO, somarDias, deslocar, sha256 } from './util.js';
import { estado, registrar, persistir, equipeDoUsuario, sincronizar, online, resumoFila, emitir } from './store.js';
import { STATUS_ABERTOS, pendenciasDaEquipe } from './dominio.js';
import { abrirSheet } from './ui.js';
import * as mapa from './mapa.js';

export const CACHE_PACOTES = 'redeviva-pacotes';
const ZOOMS = [14, 15, 16, 17];
const FAIXA_M = 200; // largura de cada lado do traçado coberta pelo mapa
const LIMITE_TILES = 250; // política de uso do OpenStreetMap para download offline
const KB_POR_TILE = 18; // média observada em área urbana
const VALIDADE_DIAS = 7;

// ---------- Recorte ----------
function tile(lat, lon, z) {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)];
}

function pontosDoCorredor(alim) {
  const d = estado.dados, pts = [];
  for (const t of d.trechos.filter((x) => x.alimentador === alim)) {
    for (let i = 1; i < t.coords.length; i++) {
      const [a, b] = [t.coords[i - 1], t.coords[i]];
      for (let k = 0; k <= 4; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / 4, a[1] + ((b[1] - a[1]) * k) / 4]);
    }
  }
  d.ativos.filter((a) => a.alimentador === alim).forEach((a) => pts.push([a.lat, a.lon]));
  return pts;
}

/** Tiles que cobrem uma faixa de FAIXA_M em volta do traçado e dos ativos — não o retângulo inteiro. */
export function tilesDoCorredor(alim) {
  const urls = new Set();
  const desloc = [[0, 0], [FAIXA_M, 0], [-FAIXA_M, 0], [0, FAIXA_M], [0, -FAIXA_M], [FAIXA_M, FAIXA_M], [-FAIXA_M, -FAIXA_M], [FAIXA_M, -FAIXA_M], [-FAIXA_M, FAIXA_M]];
  for (const p of pontosDoCorredor(alim)) {
    for (const [dn, de] of desloc) {
      const [lat, lon] = deslocar(p, dn, de);
      for (const z of ZOOMS) { const [x, y] = tile(lat, lon, z); urls.add(mapa.urlTile(z, x, y)); }
    }
  }
  return [...urls];
}

export function recorteDados(alim) {
  const d = estado.dados;
  const ativos = d.ativos.filter((a) => a.alimentador === alim);
  const ids = new Set(ativos.map((a) => a.id));
  return {
    alimentador: alim,
    geradoEm: new Date().toISOString(),
    trechos: d.trechos.filter((t) => t.alimentador === alim),
    ativos,
    inspecoes: d.inspecoes.filter((i) => ids.has(i.ativoId) && i.status !== 'CONCLUIDA'),
    defeitos: d.defeitos.filter((f) => ids.has(f.ativoId) && (STATUS_ABERTOS.includes(f.status) || f.status === 'EXECUTADO'))
      .map(({ historico, ...resto }) => ({ ...resto, historico: historico.slice(-2) })), // histórico completo fica no servidor
  };
}

async function tamanhoCompactado(texto) {
  if (!('CompressionStream' in window)) return null;
  const s = new Blob([texto]).stream().pipeThrough(new CompressionStream('gzip'));
  return (await new Response(s).blob()).size;
}

export async function estimar(alim) {
  const rec = recorteDados(alim);
  const json = JSON.stringify(rec);
  const tiles = tilesDoCorredor(alim);
  return {
    rec, json, tiles,
    bytesDados: new Blob([json]).size,
    bytesGzip: await tamanhoCompactado(json),
    kbMapa: Math.min(tiles.length, LIMITE_TILES) * KB_POR_TILE,
  };
}

// ---------- Download ----------
export async function baixarPacote(alim, { comMapa = true, aoProgresso = () => {} } = {}) {
  if (!online()) throw new Error('Sem internet. Baixe o pacote na base, com Wi-Fi.');
  const est = await estimar(alim);
  let ok = 0;
  const urls = comMapa ? est.tiles.slice(0, LIMITE_TILES) : [];
  if (urls.length && 'caches' in window) {
    const cache = await caches.open(CACHE_PACOTES);
    for (let i = 0; i < urls.length; i++) {
      try {
        if (await caches.match(urls[i])) ok++;
        else {
          const r = await fetch(urls[i], { mode: 'cors' });
          if (r.ok) { await cache.put(urls[i], r); ok++; }
        }
      } catch { /* rede instável: segue e informa no fim */ }
      aoProgresso((i + 1) / urls.length);
    }
  }
  const pacote = {
    alimentador: alim, baixadoEm: new Date().toISOString(), validoAte: somarDias(hojeISO(), VALIDADE_DIAS),
    hash: await sha256(new Blob([est.json])), bytesDados: est.bytesDados, bytesGzip: est.bytesGzip,
    tilesTotal: urls.length, tilesOk: ok, tilesForaDoLimite: Math.max(0, est.tiles.length - LIMITE_TILES),
    itens: { ativos: est.rec.ativos.length, inspecoes: est.rec.inspecoes.length, defeitos: est.rec.defeitos.length },
    tiles: urls,
  };
  estado.dados.pacotes ||= {};
  estado.dados.pacotes[alim] = pacote;
  registrar('PACOTE_OFFLINE_BAIXADO', 'pacote', alim, { tiles: `${ok}/${urls.length}`, bytes: est.bytesDados });
  return pacote;
}

export async function removerPacote(alim) {
  const p = estado.dados.pacotes?.[alim];
  if (!p) return;
  const outros = new Set(Object.values(estado.dados.pacotes).filter((x) => x !== p).flatMap((x) => x.tiles || []));
  if ('caches' in window) {
    const cache = await caches.open(CACHE_PACOTES);
    await Promise.all(p.tiles.filter((u) => !outros.has(u)).map((u) => cache.delete(u)));
  }
  delete estado.dados.pacotes[alim];
  registrar('PACOTE_OFFLINE_REMOVIDO', 'pacote', alim);
}

// ---------- Preferências leves ----------
export const config = () => (estado.dados.config ||= { mapaLeve: false, fotosSoWifi: true });
export function definirMapaLeve(v) {
  config().mapaLeve = v;
  mapa.definirFundo(v);
  persistir();
}

// ---------- Tela ----------
const kb = (b) => (b === null || b === undefined ? '—' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export async function abrirTrabalhoOffline() {
  const d = estado.dados, eq = equipeDoUsuario();
  const alims = [...new Set(d.trechos.map((t) => t.alimentador))].sort();
  const minhas = eq ? pendenciasDaEquipe(d, eq) : [];
  const contar = (a) => minhas.filter((p) => d.ativos.find((x) => x.id === p.ativoId)?.alimentador === a).length;
  const sugerido = eq ? alims.reduce((m, a) => (contar(a) > contar(m) ? a : m), alims[0]) : alims[0];

  const sel = el('select', { class: 'campo__input', 'aria-label': 'Alimentador' }, alims.map((a) => el('option', { value: a, selected: a === sugerido, text: `${a}${eq ? ` · ${contar(a)} pendência(s) suas` : ''}` })));
  const comMapa = el('input', { type: 'checkbox', checked: true });
  const resumo = el('div', { class: 'meta-grupo' });
  const barra = el('div', { class: 'passos__barra', hidden: true }, el('span', { class: 'passos__preench' }));
  const botao = el('button', { type: 'button', class: 'btn btn--grande', text: 'Baixar pacote' });
  let est;

  const atualizarEstimativa = async () => {
    est = await estimar(sel.value);
    const p = d.pacotes?.[sel.value];
    resumo.replaceChildren(el('h3', { class: 'meta-grupo__tit', text: `O que vai para o aparelho — ${sel.value}` }),
      el('div', { class: 'meta' },
        item('Ativos', fmtNum(est.rec.ativos.length)), item('Inspeções pendentes', fmtNum(est.rec.inspecoes.length)), item('Defeitos abertos', fmtNum(est.rec.defeitos.length)),
        item('Dados', `${kb(est.bytesDados)}${est.bytesGzip ? ` (${kb(est.bytesGzip)} compactado)` : ''}`),
        item('Mapa do corredor', comMapa.checked ? `~${kb(est.kbMapa * 1024)} · ${Math.min(est.tiles.length, LIMITE_TILES)} quadros` : 'mapa leve (0 KB)'),
        item('Situação', p ? `baixado ${fmtDataHora(p.baixadoEm)}` : 'não baixado')));
    botao.textContent = `${p ? 'Atualizar' : 'Baixar'} pacote do ${sel.value}`;
  };
  sel.addEventListener('change', atualizarEstimativa);
  comMapa.addEventListener('change', atualizarEstimativa);

  botao.addEventListener('click', async () => {
    botao.disabled = true;
    barra.hidden = false;
    try {
      const p = await baixarPacote(sel.value, { comMapa: comMapa.checked, aoProgresso: (f) => { barra.firstChild.style.width = `${Math.round(f * 100)}%`; } });
      toast(p.tilesTotal && p.tilesOk < p.tilesTotal
        ? `Pacote ${p.alimentador} salvo, mas só ${p.tilesOk} de ${p.tilesTotal} quadros de mapa baixaram. Tente de novo com Wi-Fi.`
        : `Pacote ${p.alimentador} pronto para uso sem internet.`, { tipo: p.tilesTotal && p.tilesOk < p.tilesTotal ? 'aviso' : 'ok', duracao: 7000 });
      abrirTrabalhoOffline();
    } catch (e) {
      toast(e.message, { tipo: 'erro' });
      botao.disabled = false;
    }
  });

  const pacotes = Object.values(d.pacotes || {});
  const lista = el('ul', { class: 'lista' }, pacotes.map((p) => {
    const vencido = p.validoAte < hojeISO();
    return el('li', { class: 'lista__item' },
      el('div', {}, el('strong', { text: p.alimentador }),
        el('div', { class: `pequeno ${vencido ? 'txt-alerta' : 'muted'}`, text: `${fmtDataHora(p.baixadoEm)} · ${p.itens.ativos} ativos · mapa ${p.tilesOk}/${p.tilesTotal} · ${kb(p.bytesDados)}${vencido ? ' · VENCIDO, atualize' : ` · válido até ${p.validoAte.split('-').reverse().join('/')}`}` })),
      el('button', { type: 'button', class: 'btn btn--txt', text: 'Remover', onclick: async () => { await removerPacote(p.alimentador); abrirTrabalhoOffline(); } }));
  }));

  const leve = el('input', { type: 'checkbox', checked: config().mapaLeve });
  leve.addEventListener('change', () => definirMapaLeve(leve.checked));
  const wifi = el('input', { type: 'checkbox', checked: config().fotosSoWifi });
  wifi.addEventListener('change', () => { config().fotosSoWifi = wifi.checked; persistir(); sincronizar(); });
  const f = resumoFila();

  const corpo = el('div', { class: 'form' },
    el('p', { class: 'muted', text: 'Baixe na base, com Wi-Fi. Em campo, tudo o que você registrar fica no aparelho e é enviado sozinho quando houver sinal.' }),
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Alimentador' }), sel),
    el('label', { class: 'campo--check' }, comMapa, el('span', { text: 'Incluir mapa de ruas do corredor (só a faixa de 200 m em volta da rede)' })),
    resumo, barra,
    pacotes.length ? el('h3', { text: 'Pacotes neste aparelho' }) : null, pacotes.length ? lista : null,
    el('h3', { text: 'Economia de dados' }),
    el('label', { class: 'campo--check' }, leve, el('span', { text: 'Mapa leve: só a rede, sem fundo de ruas (não usa internet)' })),
    el('label', { class: 'campo--check' }, wifi, el('span', { text: 'Enviar fotos só no Wi-Fi (registros sempre vão primeiro)' })),
    el('div', { class: 'resumo', text: f.total ? `Na fila: ${f.dados} registro(s) (${kb(f.bytesDados)}) · ${f.fotos} foto(s) (${kb(f.bytesFotos)})` : 'Fila de envio vazia.' }),
  );
  abrirSheet('Trabalho offline', corpo, { tipo: 'form' }, botao);
  await atualizarEstimativa();
  emitir('sync');
}

function item(rotulo, valor) {
  return el('div', { class: 'meta__item' }, el('span', { class: 'meta__rotulo', text: rotulo }), el('span', { class: 'meta__valor', text: valor }));
}
