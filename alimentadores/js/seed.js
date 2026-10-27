// Dados de demonstração 100% sintéticos: alimentadores, postes, ocorrências, compensações e pessoas são fictícios.
// O gerador é determinístico (mesma semente = mesma rede) e cria perfis didáticos: alimentador arborizado, rural de acesso
// difícil sem chaves, transformadores reincidentes, um que melhorou e um que piorou em relação ao ano anterior.
import { hojeISO, somarDias } from './util.js';
import { PARAMS, PROTECAO } from './dominio.js';

export const VERSAO_SCHEMA = 1;

const USUARIOS = [
  ['G4001', 'Helena Prado', 'GESTOR', {}],
  ['P4101', 'Rafael Costa', 'ANALISTA', {}],
  ['S4201', 'Ana Souza', 'SUPERVISOR', { conjunto: 'CJ Norte' }],
  ['S4202', 'Carla Dias', 'SUPERVISOR', { conjunto: 'CJ Sul' }],
  ['A4001', 'Lia Fontes', 'AUDITOR', {}],
];

export function usuariosSeed() {
  return USUARIOS.map(([matricula, nome, perfil, extra]) => ({
    id: `u-${matricula.toLowerCase()}`, matricula, nome, perfil, ...extra, ativo: true, credencial: null, trocarSenha: true,
  }));
}

function prng(semente) {
  let a = semente >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// [id, nome, conjunto, SE, tipo U/R/M, rumo (graus), postes no tronco, ramais, árvore, acesso, falhas/ano, fator do ano atual, religador no tronco, seccionadoras no tronco]
const PERFIS_AL = [
  ['ALM-01', 'Centro Comercial', 'CJ Norte', 'N', 'U', 20, 120, 4, 0.20, 0.02, 34, 1.0, true, 3],
  ['ALM-02', 'Jardim das Mangueiras', 'CJ Norte', 'N', 'U', 95, 140, 5, 0.55, 0.05, 52, 1.05, true, 2],
  ['ALM-03', 'Serra Velha (rural)', 'CJ Norte', 'N', 'R', 160, 170, 4, 0.30, 0.55, 40, 1.1, false, 1],
  ['ALM-04', 'Distrito Industrial', 'CJ Norte', 'N', 'M', 250, 130, 4, 0.15, 0.10, 38, 1.0, true, 2],
  ['ALM-05', 'Vila Nova', 'CJ Sul', 'S', 'U', 340, 110, 4, 0.25, 0.03, 44, 0.55, true, 3],
  ['ALM-06', 'Cachoeira (rural)', 'CJ Sul', 'S', 'R', 60, 180, 5, 0.50, 0.45, 48, 1.15, false, 1],
  ['ALM-07', 'Lagoa Seca', 'CJ Sul', 'S', 'M', 140, 150, 4, 0.30, 0.20, 36, 1.9, true, 2],
  ['ALM-08', 'Parque Residencial', 'CJ Sul', 'S', 'U', 220, 120, 4, 0.18, 0.02, 22, 0.9, true, 3],
];
const SES = { N: { nome: 'SE Norte', lat: -15.792, lon: -48.085 }, S: { nome: 'SE Sul', lat: -15.885, lon: -48.020 } };
const MOTIVOS_ACESSO = ['Sem estrada (trilha)', 'Propriedade fechada', 'Área alagável', 'Área de risco', 'Mata fechada'];

export function gerarRede(hoje = hojeISO(), semente = 20252026) {
  const r = prng(semente);
  const entre = (a, b) => a + r() * (b - a);
  const inteiro = (a, b) => Math.floor(entre(a, b + 1));
  const alimentadores = [], postes = [], ocorrencias = [], compensacoes = [];
  const anoAtual = Number(hoje.slice(0, 4)), ini = `${anoAtual - 1}-01-01`;
  const diasTotal = Math.round((new Date(`${hoje}T12:00:00`) - new Date(`${ini}T12:00:00`)) / 86400000);

  for (const [id, nome, conjunto, se, tipo, rumo, nTronco, nRamais, pVeg, pAcesso, falhasAno, fatorAtual, temRL, nCS] of PERFIS_AL) {
    alimentadores.push({ id, nome, conjunto, se: SES[se].nome, tipo: { U: 'Urbano', R: 'Rural', M: 'Misto' }[tipo] });
    const vao = tipo === 'U' ? 40 : tipo === 'R' ? 85 : 60; // metros entre postes
    const meus = [];
    const novo = (pai, lat, lon, ramal) => {
      const p = { id: `${id.slice(4)}-${String(meus.length + 1).padStart(4, '0')}`, al: id, pai: pai?.id || '', lat, lon, ramal, veg: 0, acesso: '', acessoMotivo: '', chave: '', trafo: '', ucs: 0 };
      meus.push(p);
      return p;
    };
    const andar = (de, ang) => {
      const rad = (ang * Math.PI) / 180, d = vao * entre(0.85, 1.15);
      return [de.lat + (d * Math.cos(rad)) / 111320, de.lon + (d * Math.sin(rad)) / (111320 * Math.cos((de.lat * Math.PI) / 180))];
    };
    // Tronco
    const raiz = novo(null, SES[se].lat + entre(-0.001, 0.001), SES[se].lon + entre(-0.001, 0.001), 'T');
    raiz.chave = 'DJ';
    const tronco = [raiz];
    let ang = rumo;
    for (let i = 1; i < nTronco; i++) {
      ang += entre(-9, 9);
      if (i % 25 === 0) ang += entre(-30, 30);
      const [la, lo] = andar(tronco[i - 1], ang);
      tronco.push(novo(tronco[i - 1], la, lo, 'T'));
    }
    tronco[tronco.length - 1].chave = 'NA';
    if (temRL) tronco[Math.floor(nTronco * entre(0.3, 0.45))].chave = 'RL';
    for (let k = 1; k <= nCS; k++) { const q = tronco[Math.floor((nTronco * k) / (nCS + 1)) + inteiro(-4, 4)]; if (q && !q.chave) q.chave = 'CS'; }
    // Ramais (com chave fusível na saída) e sub-ramais
    const sequencias = [tronco];
    const criarRamal = (base, angBase, tam, nivel) => {
      const seq = [];
      let a = angBase, ant = base;
      for (let i = 0; i < tam; i++) {
        a += entre(-10, 10);
        const [la, lo] = andar(ant, a);
        const p = novo(ant, la, lo, `R${sequencias.length}`);
        seq.push(p); ant = p;
      }
      seq[0].chave = 'CF';
      sequencias.push(seq);
      if (nivel === 0 && tam > 30 && r() < 0.7) {
        const b = seq[Math.floor(tam * entre(0.35, 0.7))];
        criarRamal(b, a + (r() < 0.5 ? 70 : -70), inteiro(12, 30), 1);
      }
    };
    for (let k = 0; k < nRamais; k++) {
      const base = tronco[Math.floor(nTronco * entre(0.12, 0.9))];
      criarRamal(base, ang + (k % 2 ? 80 : -80) + entre(-20, 20), inteiro(tipo === 'R' ? 40 : 25, tipo === 'R' ? 95 : 60), 0);
    }
    // Marcação poste a poste: árvore e acesso em trechos contínuos (como sai do levantamento de campo)
    for (const seq of sequencias) {
      for (let i = 0; i < seq.length; i++) {
        if (r() < pVeg / 9) { const l = inteiro(5, 22); for (let j = i; j < Math.min(seq.length, i + l); j++) seq[j].veg = 1; i += l; }
      }
      for (let i = 0; i < seq.length; i++) {
        const peso = pAcesso * (0.4 + (i / seq.length) * 1.4); // acesso piora na ponta do ramal
        if (r() < peso / 10) {
          const l = inteiro(6, 26), motivo = MOTIVOS_ACESSO[inteiro(0, MOTIVOS_ACESSO.length - 1)];
          for (let j = i; j < Math.min(seq.length, i + l); j++) { seq[j].acesso = 'DIFICIL'; seq[j].acessoMotivo = motivo; }
          i += l;
        }
      }
    }
    // Transformadores
    let nt = 0;
    meus.forEach((p, i) => {
      if (i < 3 || p.chave === 'NA') return;
      const passo = tipo === 'U' ? 3 : tipo === 'R' ? 6 : 4;
      if (i % passo === 0) {
        nt++;
        p.trafo = `TR-${id.slice(4)}-${String(nt).padStart(3, '0')}`;
        p.ucs = tipo === 'U' ? inteiro(30, 95) : tipo === 'R' ? inteiro(4, 22) : inteiro(12, 60);
      }
    });
    postes.push(...meus);

    // Topologia auxiliar para as ocorrências
    const porId = new Map(meus.map((p) => [p.id, p]));
    const filhos = new Map(meus.map((p) => [p.id, []]));
    meus.forEach((p) => { if (p.pai) filhos.get(p.pai).push(p.id); });
    const sub = new Map();
    for (let k = meus.length - 1; k >= 0; k--) { const p = meus[k]; sub.set(p.id, p.ucs + filhos.get(p.id).reduce((s, f) => s + sub.get(f), 0)); }
    const trafosAbaixo = new Map();
    for (let k = meus.length - 1; k >= 0; k--) {
      const p = meus[k];
      trafosAbaixo.set(p.id, [...(p.trafo ? [p.id] : []), ...filhos.get(p.id).flatMap((f) => trafosAbaixo.get(f))]);
    }
    const protecao = (p) => { while (p && !PROTECAO.has(p.chave)) p = porId.get(p.pai); return p || raiz; };
    // Pontos quentes: postes que vão concentrar falhas (reincidência)
    const quentes = new Set();
    for (let k = 0; k < Math.max(3, Math.round(meus.length / 70)); k++) quentes.add(meus[inteiro(5, meus.length - 1)].id);
    const risco = meus.map((p) => 0.15 + (p.veg ? 1.6 : 0) + (p.trafo ? 0.5 : 0) + (quentes.has(p.id) ? 22 : 0) + (p.acesso ? 0.3 : 0));
    const soma = risco.reduce((a, b) => a + b, 0);
    const sortear = () => { let x = r() * soma; for (let i = 0; i < meus.length; i++) { x -= risco[i]; if (x <= 0) return meus[i]; } return meus[meus.length - 1]; };

    const dicMes = new Map(); // trafo|AAAA-MM -> horas
    for (let d = 0; d <= diasTotal; d++) {
      const data = somarDias(ini, d), mes = Number(data.slice(5, 7)), ano = Number(data.slice(0, 4));
      const chuva = [10, 11, 12, 1, 2, 3].includes(mes) ? 1.7 : 0.55; // período chuvoso
      const taxaDia = (falhasAno * 0.75 / 365) * chuva * (ano === anoAtual ? fatorAtual : 1);
      let k = 0;
      for (let x = r(); x < taxaDia && k < 6; x += r(), k++) {
        const p = sortear();
        const causa = p.veg && r() < 0.62 ? 'VEG' : (() => { const y = r(); return y < 0.3 ? 'DESC' : y < 0.6 ? 'EQUIP' : y < 0.75 ? 'ANIMAL' : y < 0.85 ? 'TERCEIRO' : y < 0.93 ? 'VEG' : 'OUTRA'; })();
        const soTrafo = causa === 'EQUIP' && p.trafo && r() < 0.6;
        const disp = soTrafo ? p : protecao(p);
        const ucs = soTrafo ? p.ucs : sub.get(disp.id);
        if (!ucs) continue;
        const base = tipo === 'U' ? 1.1 : tipo === 'R' ? 2.2 : 1.6;
        const dur = Math.round(base * (p.acesso ? 2.1 : 1) * (causa === 'VEG' ? 1.35 : 1) * Math.exp(entre(-0.6, 0.6)) * 100) / 100;
        const hora = String(inteiro(0, 23)).padStart(2, '0'), min = String(inteiro(0, 59)).padStart(2, '0');
        ocorrencias.push({ id: `OC-${id.slice(4)}-${ocorrencias.length + 1}`, al: id, poste: p.id, data: `${data}T${hora}:${min}`, causa, ucs, dur, chi: Math.round(ucs * dur * 10) / 10, disp: disp.id });
        for (const t of soTrafo ? [p.id] : trafosAbaixo.get(disp.id)) {
          const ch = `${t}|${data.slice(0, 7)}`;
          dicMes.set(ch, (dicMes.get(ch) || 0) + dur);
        }
      }
    }
    // Compensação estimada por transformador e mês (DIC mensal acima do limite × UCs × valor da hora)
    const lim = tipo === 'R' ? PARAMS.dicLimiteMesRural : PARAMS.dicLimiteMesUrbano;
    for (const [ch, horas] of dicMes) {
      if (horas <= lim) continue;
      const [t, mes] = ch.split('|');
      const p = porId.get(t);
      compensacoes.push({ poste: t, mes, valor: Math.round((horas - lim) * p.ucs * PARAMS.valorHoraUc * 100) / 100 });
    }
  }
  return { versao: `demo-${semente}-${hoje}`, origem: 'SINTETICA', geradaEm: new Date().toISOString(), alimentadores, postes, ocorrencias, compensacoes };
}
