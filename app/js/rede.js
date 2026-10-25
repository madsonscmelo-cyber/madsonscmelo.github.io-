// Geometria da rede: trechos de inspeção (~1 km), comprimento, cobertura de trajeto e pertença a áreas.
import { distanciaM } from './util.js';

/** Comprimento de uma linha [[lat,lon],...] em km. */
export function comprimentoKm(coords) {
  let m = 0;
  for (let i = 1; i < coords.length; i++) m += distanciaM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  return m / 1000;
}

/** Divide uma linha em segmentos de ~alvoM metros (cortes nos vértices). */
export function dividirLinha(coords, alvoM = 1000) {
  const out = [];
  let atual = [coords[0]], acum = 0;
  for (let i = 1; i < coords.length; i++) {
    acum += distanciaM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
    atual.push(coords[i]);
    if (acum >= alvoM && i < coords.length - 1) { out.push(atual); atual = [coords[i]]; acum = 0; }
  }
  if (atual.length > 1) {
    if (out.length && acum < alvoM * 0.35) out[out.length - 1].push(...atual.slice(1)); // sobra curta junta no anterior
    else out.push(atual);
  }
  return out;
}

/** Pontos a cada passoM ao longo da linha (base do cálculo de cobertura). */
export function amostrar(coords, passoM = 20) {
  const pts = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const [a, b] = [coords[i - 1], coords[i]];
    const n = Math.max(1, Math.round(distanciaM(a[0], a[1], b[0], b[1]) / passoM));
    for (let k = 1; k <= n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return pts;
}

/** Distância (m) de um ponto até uma linha — aproximação plana local, suficiente para centenas de metros. */
export function distanciaAteLinha([lat, lon], coords) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 111320;
  let min = Infinity;
  for (let i = 1; i < coords.length; i++) {
    const ax = (coords[i - 1][1] - lon) * kx, ay = (coords[i - 1][0] - lat) * ky;
    const bx = (coords[i][1] - lon) * kx, by = (coords[i][0] - lat) * ky;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    min = Math.min(min, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return min;
}

/** % do trecho coberto por um trajeto: amostra do trecho com algum ponto do trajeto a até faixaM. */
/** Liga pontos consecutivos do trajeto (logs esparsos de GPS/drone), sem atravessar saltos maiores que maxGapM. */
function densificar(trajeto, passoM = 10, maxGapM = 300) {
  const out = [trajeto[0]];
  for (let i = 1; i < trajeto.length; i++) {
    const [a, b] = [trajeto[i - 1], trajeto[i]];
    const d = distanciaM(a[0], a[1], b[0], b[1]);
    if (d > passoM && d <= maxGapM) {
      const n = Math.ceil(d / passoM);
      for (let k = 1; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    out.push(b);
  }
  return out;
}

export function cobertura(coordsTrecho, trajetoBruto, faixaM = 30) {
  if (!trajetoBruto?.length) return 0;
  const trajeto = densificar(trajetoBruto);
  const amostra = amostrar(coordsTrecho, 20);
  const cos = Math.cos((coordsTrecho[0][0] * Math.PI) / 180);
  const grau = faixaM / 111320;
  const cobertos = amostra.filter(([la, lo]) => trajeto.some(([tl, tn]) => Math.abs(tl - la) < grau && Math.abs(tn - lo) * cos < grau && distanciaM(la, lo, tl, tn) <= faixaM)).length;
  return cobertos / amostra.length;
}

export function pontoNoPoligono([lat, lon], poli) {
  let dentro = false;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const [yi, xi] = poli[i], [yj, xj] = poli[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** Um trecho pertence à área se algum vértice/amostra cai dentro (polígono/círculo) ou se a área lista o trecho. */
export function trechoNaArea(trecho, area) {
  const g = area.geometria;
  if (g.tipo === 'trechos') return g.ids.includes(trecho.id);
  const pts = amostrar(trecho.coords, 100);
  if (g.tipo === 'circulo') return pts.some(([la, lo]) => distanciaM(la, lo, g.centro[0], g.centro[1]) <= g.raioM);
  if (g.tipo === 'poligono') return pts.some((p) => pontoNoPoligono(p, g.coords));
  return false;
}

export function pontoNaArea(p, area) {
  const g = area.geometria;
  if (g.tipo === 'circulo') return distanciaM(p[0], p[1], g.centro[0], g.centro[1]) <= g.raioM;
  if (g.tipo === 'poligono') return pontoNoPoligono(p, g.coords);
  return false;
}

/** Lê um log de voo/trajeto: KML (coordinates lon,lat[,alt]) ou CSV com colunas lat/lon. */
export function lerTrajeto(texto) {
  const pts = [];
  const coordsKml = [...texto.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)];
  if (coordsKml.length) {
    for (const m of coordsKml) for (const tok of m[1].trim().split(/\s+/)) {
      const [lon, lat] = tok.split(',').map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lat, lon]);
    }
    return pts;
  }
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const sep = linhas[0].includes(';') ? ';' : ',';
  const cab = linhas[0].toLowerCase().split(sep).map((c) => c.trim());
  const iLat = cab.findIndex((c) => c.startsWith('lat')), iLon = cab.findIndex((c) => c.startsWith('lon') || c.startsWith('lng'));
  if (iLat < 0 || iLon < 0) return pts;
  for (const l of linhas.slice(1)) {
    const c = l.split(sep);
    const lat = Number(String(c[iLat]).replace(',', '.')), lon = Number(String(c[iLon]).replace(',', '.'));
    if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lat, lon]);
  }
  return pts;
}
