// Importação da base real (postes, ocorrências, compensações) por CSV, lida e validada no próprio aparelho.
// Nada é enviado: o arquivo vira objeto em memória e é gravado só no IndexedDB deste navegador.
// Nomes de coluna aceitam variações (sem acento, maiúsculas, sinônimos) para o CSV sair direto do SAP/GIS/planilha.
import { CHAVES, CAUSAS } from './dominio.js';

export const LIMITES = { bytes: 40 * 1024 * 1024, linhas: 400000, recusasNoRelatorio: 200 };

const ALIAS = {
  alimentador: ['alimentador', 'alim', 'cod_alimentador', 'circuito'],
  poste: ['poste', 'id_poste', 'cod_poste', 'codigo_poste', 'estrutura', 'ponto'],
  pai: ['poste_pai', 'pai', 'montante', 'poste_montante', 'anterior'],
  lat: ['latitude', 'lat', 'y'],
  lon: ['longitude', 'lon', 'lng', 'long', 'x'],
  conjunto: ['conjunto', 'conj', 'conjunto_aneel'],
  nome: ['nome_alimentador', 'nome', 'descricao_alimentador'],
  se: ['subestacao', 'se'],
  arvore: ['arvore', 'vegetacao', 'veg', 'poda'],
  acesso: ['acesso', 'acesso_dificil', 'dificil_acesso'],
  acessoMotivo: ['acesso_motivo', 'motivo_acesso', 'obs_acesso'],
  chave: ['chave', 'tipo_chave', 'equipamento', 'dispositivo_manobra'],
  trafo: ['trafo', 'transformador', 'cod_trafo', 'et'],
  ucs: ['ucs', 'qtd_ucs', 'clientes', 'consumidores', 'ucs_trafo'],
  data: ['data_hora', 'data', 'inicio', 'dt_inicio'],
  causa: ['causa', 'causa_grupo', 'grupo_causa'],
  dur: ['duracao_h', 'duracao', 'horas', 'dur_h'],
  chi: ['chi'],
  disp: ['dispositivo', 'dispositivo_atuado', 'equipamento_atuado'],
  mes: ['mes', 'competencia', 'mes_ref'],
  ano: ['ano'],
  valor: ['valor', 'valor_rs', 'compensacao', 'compensacao_rs'],
  risco: ['score', 'risco', 'score_risco'], // score de risco do poste 0–100 (classificação poste a poste)
};
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[\s.-]+/g, '_');

/** CSV com ; ou , (detecta pela 1ª linha), aspas e quebra de linha dentro de aspas. */
export function lerCsv(texto) {
  texto = texto.replace(/^﻿/, '');
  const prim = texto.slice(0, texto.indexOf('\n') + 1 || undefined);
  const sep = (prim.match(/;/g) || []).length >= (prim.match(/,/g) || []).length ? ';' : ',';
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c;
    } else if (c === '"' && campo === '') aspas = true; // aspas só abrem no início do campo (RFC 4180)
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.some((x) => x.trim() !== '')) linhas.push(linha);
      linha = [];
      if (linhas.length > LIMITES.linhas + 1) throw new Error(`Arquivo com mais de ${LIMITES.linhas} linhas. Divida por conjunto.`);
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim() !== '')) linhas.push(linha);
  return linhas;
}

function mapearColunas(cab) {
  const n = cab.map(norm), m = {};
  for (const [chave, nomes] of Object.entries(ALIAS)) {
    const i = n.findIndex((c) => nomes.includes(c));
    if (i >= 0) m[chave] = i;
  }
  // Compensação anual na própria planilha de postes: comp_2025, comp_2026, compensacao_2025…
  m.compAnos = n.map((c, i) => [c.match(/^comp(?:ensacao)?_(\d{4})(?:_rs)?$/)?.[1], i]).filter(([a]) => a);
  return m;
}

const num = (v) => { const s = String(v ?? '').trim().replace(/\s/g, ''); if (!s) return NaN; return Number(/,\d+$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')); };
const sim = (v) => /^(s|sim|1|x|true|y|yes|dificil)$/i.test(norm(v));
const texto = (v, max = 40) => String(v ?? '').trim().slice(0, max);

function lerChave(v) {
  const s = norm(v);
  if (!s) return '';
  if (CHAVES[s.toUpperCase()]) return s.toUpperCase();
  if (/religador|^rl/.test(s)) return 'RL';
  if (/seccionad|faca|^cs|^sec/.test(s)) return 'CS';
  if (/fusiv|^cf|^fu/.test(s)) return 'CF';
  if (/disjunt|^dj/.test(s)) return 'DJ';
  if (/^na$|normal(mente)?_aberta|interliga/.test(s)) return 'NA';
  return null;
}
function lerCausa(v) {
  const s = norm(v);
  if (!s) return 'OUTRA';
  if (CAUSAS[s.toUpperCase()]) return s.toUpperCase();
  if (/programad|construcao|manutencao_prevent|desligamento_para/.test(s)) return 'PROG';
  if (/veget|arvor|galho|poda/.test(s)) return 'VEG';
  if (/descarga|raio|atmosf/.test(s)) return 'DESC';
  if (/equip|falha|isolador|cruzeta|trafo|conector|cabo|deterior|envelhec|material|corrosao|sobrecarga/.test(s)) return 'EQUIP';
  if (/anima|inseto|passaro|ave|gamba|cobra|abelha/.test(s)) return 'ANIMAL';
  if (/chuva|vento|fenomeno|tempestade|inundac|queimada/.test(s)) return 'CLIMA';
  if (/terceir|abalroa|vandal|furto|pipa|caminhao/.test(s)) return 'TERCEIRO';
  return 'OUTRA';
}
/** Aceita AAAA-MM-DD[ HH:MM] e DD/MM/AAAA[ HH:MM]. Devolve AAAA-MM-DDTHH:MM ou null. */
export function lerData(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return valida(m[1], m[2], m[3], m[4], m[5]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return valida(m[3], m[2], m[1], m[4], m[5]);
  return null;
}
function valida(a, me, d, h = '0', mi = '0') {
  const dt = new Date(Number(a), Number(me) - 1, Number(d));
  if (dt.getMonth() !== Number(me) - 1 || dt.getDate() !== Number(d) || Number(h) > 23 || Number(mi) > 59) return null;
  return `${a}-${String(me).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

function relatorio() {
  return { aceitas: 0, recusadas: 0, recusas: [], avisos: [] };
}
function recusar(rel, arquivo, linha, motivo) {
  rel.recusadas++;
  if (rel.recusas.length < LIMITES.recusasNoRelatorio) rel.recusas.push({ arquivo, linha, motivo });
}

/**
 * Monta a base a partir dos textos CSV. postes é obrigatório; ocorrências e compensações são opcionais.
 * Devolve { rede, rel } — rede null quando nada pôde ser aproveitado.
 */
export function montarBase({ postes: txtPostes, ocorrencias: txtOc = '', compensacoes: txtComp = '' }) {
  const rel = relatorio();
  const linhasP = lerCsv(txtPostes);
  if (linhasP.length < 2) { rel.avisos.push('Planilha de postes vazia.'); return { rede: null, rel }; }
  const mp = mapearColunas(linhasP[0]);
  const falta = ['alimentador', 'poste', 'lat', 'lon'].filter((k) => mp[k] === undefined);
  if (falta.length) { rel.avisos.push(`Planilha de postes sem as colunas obrigatórias: ${falta.join(', ')}.`); return { rede: null, rel }; }

  const alimentadores = new Map(), postes = [], porId = new Map(), compensacoes = [];
  const semPai = new Map();
  for (let i = 1; i < linhasP.length; i++) {
    const l = linhasP[i], g = (k) => (mp[k] === undefined ? '' : l[mp[k]]);
    const al = texto(g('alimentador'), 30), id = texto(g('poste'), 40);
    const lat = num(g('lat')), lon = num(g('lon'));
    if (!al || !id) { recusar(rel, 'postes', i + 1, 'alimentador ou poste vazio'); continue; }
    if (!(lat >= -34 && lat <= 6 && lon >= -74 && lon <= -28)) { recusar(rel, 'postes', i + 1, `coordenada fora do Brasil (${g('lat')}; ${g('lon')})`); continue; }
    const chave = lerChave(g('chave'));
    if (chave === null) { recusar(rel, 'postes', i + 1, `tipo de chave desconhecido: "${texto(g('chave'))}" (use DJ, RL, CS, CF ou NA)`); continue; }
    const pid = `${al}|${id}`;
    if (porId.has(pid)) { recusar(rel, 'postes', i + 1, `poste ${id} repetido no ${al}`); continue; }
    const ucs = num(g('ucs')), risco = num(g('risco'));
    const p = { id: pid, cod: id, al, pai: texto(g('pai'), 40), lat, lon, veg: sim(g('arvore')) ? 1 : 0,
      acesso: sim(g('acesso')) ? 'DIFICIL' : '', acessoMotivo: texto(g('acessoMotivo'), 60), chave, trafo: texto(g('trafo'), 30), ucs: Number.isFinite(ucs) && ucs > 0 ? Math.round(ucs) : 0 };
    if (risco >= 0 && risco <= 100) p.risco = Math.round(risco);
    postes.push(p); porId.set(pid, p);
    if (!alimentadores.has(al)) alimentadores.set(al, { id: al, nome: texto(g('nome'), 60) || al, conjunto: texto(g('conjunto'), 40) || '—', se: texto(g('se'), 40) || '—', tipo: '—' });
    if (!p.pai) semPai.set(al, (semPai.get(al) || 0) + 1);
    for (const [ano, col] of mp.compAnos) { const v = num(l[col]); if (v > 0) compensacoes.push({ poste: pid, mes: `${ano}-00`, valor: v }); }
    rel.aceitas++;
  }
  // Topologia: pai referenciado pelo código do poste dentro do mesmo alimentador.
  // Sem a coluna poste_pai: liga na ordem do arquivo. Com a coluna presente e vazia (camada só de pontos, ex.: chaves do SIG),
  // não inventa ligação: os pontos ficam soltos e o app avisa que não há topologia.
  if (mp.pai !== undefined && semPai.size) {
    const soltos = [...semPai.values()].reduce((a, b) => a + b, 0);
    if (soltos === postes.length) rel.avisos.push('Base sem topologia (poste_pai vazio): os pontos aparecem no mapa, mas trechos contínuos e árvore de manobra precisam do poste a montante.');
  }
  for (const [al, n] of mp.pai === undefined ? semPai : []) {
    const doAl = postes.filter((p) => p.al === al);
    if (n === doAl.length && doAl.length > 1) {
      rel.avisos.push(`${al}: sem coluna poste_pai. Os postes foram ligados na ordem do arquivo; revise se o arquivo não estiver ordenado pelo caminho da rede.`);
      for (let k = 1; k < doAl.length; k++) doAl[k].pai = doAl[k - 1].id;
    }
  }
  let paiInexistente = 0, ciclos = 0;
  for (const p of postes) {
    if (!p.pai || p.pai.includes('|')) continue;
    const ref = `${p.al}|${p.pai}`;
    if (porId.has(ref)) p.pai = ref; else { p.pai = ''; paiInexistente++; }
  }
  // Quebra ciclos (pai do pai … volta para o próprio poste): o poste vira início de trecho.
  const estadoV = new Map();
  for (const p of postes) {
    const caminho = [];
    let q = p;
    while (q && !estadoV.has(q.id)) { estadoV.set(q.id, 1); caminho.push(q); q = q.pai ? porId.get(q.pai) : null; }
    if (q && estadoV.get(q.id) === 1 && caminho.includes(q)) { q.pai = ''; ciclos++; }
    for (const c of caminho) estadoV.set(c.id, 2);
  }
  if (paiInexistente) rel.avisos.push(`${paiInexistente} poste(s) apontam para um poste pai que não está no arquivo: viraram início de trecho.`);
  if (ciclos) rel.avisos.push(`${ciclos} ciclo(s) na ligação poste → pai foram quebrados.`);
  const semUcs = [...alimentadores.values()].filter((a) => !postes.some((p) => p.al === a.id && p.ucs > 0)).map((a) => a.id);
  if (semUcs.length) rel.avisos.push(`${semUcs.length === alimentadores.size ? 'Nenhum alimentador tem' : `${semUcs.length} alimentador(es) sem`} UCs nos postes${semUcs.length === alimentadores.size ? '' : ` (${semUcs.slice(0, 5).join(', ')}${semUcs.length > 5 ? '…' : ''})`}: DEC/FEC e UCs a jusante ficam zerados. Inclua a coluna ucs nos postes com transformador.`);

  // Ocorrências
  const ocorrencias = [];
  let semLocal = 0;
  if (txtOc.trim()) {
    const lo = lerCsv(txtOc), mo = mapearColunas(lo[0] || []);
    const faltaO = ['data', 'alimentador', 'poste', 'ucs'].filter((k) => mo[k] === undefined);
    if (mo.dur === undefined && mo.chi === undefined) faltaO.push('duracao_h ou chi');
    if (faltaO.length) rel.avisos.push(`Planilha de ocorrências ignorada: faltam as colunas ${faltaO.join(', ')}.`);
    else {
      for (let i = 1; i < lo.length; i++) {
        const l = lo[i], g = (k) => (mo[k] === undefined ? '' : l[mo[k]]);
        const al = texto(g('alimentador'), 30), cod = texto(g('poste'), 40), data = lerData(g('data')), pid = cod ? `${al}|${cod}` : '', ucs = num(g('ucs'));
        let dur = num(g('dur'));
        const chi = num(g('chi'));
        if (!data) { recusar(rel, 'ocorrencias', i + 1, `data inválida: "${texto(g('data'))}"`); continue; }
        // Poste vazio = ocorrência sem local (entra no DEC/CHI do alimentador, não em trecho). Poste preenchido tem de existir.
        if (!alimentadores.has(al)) { recusar(rel, 'ocorrencias', i + 1, `alimentador ${al || '(vazio)'} não existe na planilha de postes`); continue; }
        if (pid && !porId.has(pid)) { recusar(rel, 'ocorrencias', i + 1, `poste ${cod} não existe na planilha de postes do ${al}`); continue; }
        if (!(ucs > 0)) { recusar(rel, 'ocorrencias', i + 1, 'ucs vazio ou zero'); continue; }
        if (!(dur > 0) && chi > 0) dur = chi / ucs;
        if (!(dur > 0) || dur > 240) { recusar(rel, 'ocorrencias', i + 1, 'duração ausente, zero ou acima de 240 h'); continue; }
        const disp = texto(g('disp'), 40);
        if (!pid) semLocal++;
        ocorrencias.push({ id: `OC-${i}`, al, poste: pid, data, causa: lerCausa(g('causa')), ucs: Math.round(ucs), dur: Math.round(dur * 100) / 100,
          chi: Math.round((chi > 0 ? chi : ucs * dur) * 10) / 10, disp: disp && porId.has(`${al}|${disp}`) ? `${al}|${disp}` : '' });
        rel.aceitas++;
      }
    }
    if (semLocal) rel.avisos.push(`${semLocal} ocorrência(s) sem poste de origem: entram no DEC/FEC e no CHI do alimentador, mas não em trechos nem na chave sugerida.`);
  } else rel.avisos.push('Sem planilha de ocorrências: o mapa mostra a marcação de campo (árvore, acesso, chaves), mas CHI, DEC/FEC e reincidência ficam zerados.');

  // Compensações por mês ou por ano
  if (txtComp.trim()) {
    const lc = lerCsv(txtComp), mc = mapearColunas(lc[0] || []);
    const faltaC = ['alimentador', 'poste', 'valor'].filter((k) => mc[k] === undefined);
    if (mc.mes === undefined && mc.ano === undefined) faltaC.push('mes ou ano');
    if (faltaC.length) rel.avisos.push(`Planilha de compensações ignorada: faltam as colunas ${faltaC.join(', ')}.`);
    else {
      for (let i = 1; i < lc.length; i++) {
        const l = lc[i], g = (k) => (mc[k] === undefined ? '' : l[mc[k]]);
        const al = texto(g('alimentador'), 30), cod = texto(g('poste'), 40), pid = cod ? `${al}|${cod}` : '', valor = num(g('valor'));
        const mesTxt = String(g('mes') || '').trim(), anoTxt = String(g('ano') || '').trim();
        const mes = /^\d{4}-\d{2}$/.test(mesTxt) ? mesTxt : /^\d{2}\/\d{4}$/.test(mesTxt) ? `${mesTxt.slice(3)}-${mesTxt.slice(0, 2)}` : /^\d{4}$/.test(anoTxt) ? `${anoTxt}-00` : null;
        if (!alimentadores.has(al)) { recusar(rel, 'compensacoes', i + 1, `alimentador ${al || '(vazio)'} não existe na planilha de postes`); continue; }
        if (pid && !porId.has(pid)) { recusar(rel, 'compensacoes', i + 1, `poste ${cod} não existe no ${al}`); continue; }
        if (!mes) { recusar(rel, 'compensacoes', i + 1, 'mês (AAAA-MM ou MM/AAAA) ou ano (AAAA) inválido'); continue; }
        if (!(valor > 0)) { recusar(rel, 'compensacoes', i + 1, 'valor vazio ou zero'); continue; }
        compensacoes.push({ al, poste: pid, mes, valor }); // poste vazio = compensação do alimentador sem trafo identificado
        rel.aceitas++;
      }
    }
  }

  if (!postes.length) return { rede: null, rel };
  const versao = `imp-${Date.now()}`;
  return { rede: { versao, origem: 'IMPORTADA', geradaEm: new Date().toISOString(), alimentadores: [...alimentadores.values()], postes, ocorrencias, compensacoes }, rel };
}
