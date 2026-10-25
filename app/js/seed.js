// Dados 100% sintéticos para o protótipo. Nenhum ativo, código ou valor corresponde à rede real.
import { mulberry32, deslocar, distanciaM, hojeISO, somarDias, uid } from './util.js';
import { CRITERIOS, tiposDefeitoPara, gerarInspecoesDevidas } from './dominio.js';

export const VERSAO_SCHEMA = 4;

const SE = [-15.8405, -48.0760]; // subestação fictícia
const ROTAS = {
  'ALM-07': { conjunto: 'CJ-Centro', pts: [SE, [-15.8372, -48.0650], [-15.8346, -48.0520], [-15.8302, -48.0420], [-15.8290, -48.0300]] },
  'ALM-03': { conjunto: 'CJ-Norte', pts: [SE, [-15.8300, -48.0790], [-15.8200, -48.0772], [-15.8122, -48.0702], [-15.8050, -48.0690]] },
  'ALM-11': { conjunto: 'CJ-Sul', pts: [SE, [-15.8500, -48.0722], [-15.8580, -48.0642], [-15.8650, -48.0601], [-15.8722, -48.0520]] },
};
// Área de concessão fictícia usada na validação da importação.
export const AREA_CONCESSAO = { latMin: -16.06, latMax: -15.50, lonMin: -48.29, lonMax: -47.31 };

function amostrar(pts, passoM) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const n = Math.max(1, Math.round(distanciaM(a[0], a[1], b[0], b[1]) / passoM));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

export function gerarSeed() {
  const rnd = mulberry32(20261025);
  const entre = (a, b) => a + rnd() * (b - a);
  const inteiro = (a, b) => Math.floor(entre(a, b + 1));
  const escolher = (arr) => arr[Math.floor(rnd() * arr.length)];
  const hoje = hojeISO();

  const equipes = [
    { id: 'INS-01', nome: 'Inspeção 01', tipo: 'INSPECAO', base: 'Base Oeste', disponivel: true },
    { id: 'INS-02', nome: 'Inspeção 02', tipo: 'INSPECAO', base: 'Base Oeste', disponivel: true },
    { id: 'LEV-01', nome: 'Manutenção 01', tipo: 'LEVE', base: 'Base Oeste', disponivel: true },
    { id: 'LEV-02', nome: 'Manutenção 02', tipo: 'LEVE', base: 'Base Sul', disponivel: false },
    { id: 'PES-01', nome: 'Turma Pesada 01', tipo: 'PESADA', base: 'Base Oeste', disponivel: true },
    { id: 'LV-01', nome: 'Linha Viva 01', tipo: 'LINHA_VIVA', base: 'Base Oeste', disponivel: true },
    { id: 'POD-01', nome: 'Poda 01', tipo: 'PODA', base: 'Base Sul', disponivel: true },
  ];
  // Senha inicial de demonstração (POLITICA.senhaInicialDemo) com troca obrigatória no primeiro acesso.
  const usuarios = [
    { id: 'u-gestor', matricula: 'G1001', nome: 'Gestão de Planejamento', perfil: 'GESTOR' },
    { id: 'u-sup', matricula: 'S1001', nome: 'Supervisão de Campo', perfil: 'SUPERVISOR' },
    { id: 'u-auditor', matricula: 'A1001', nome: 'Auditoria Interna', perfil: 'AUDITOR' },
    ...equipes.map((e) => ({ id: `u-${e.id}`, matricula: e.id.replace('-', ''), nome: `Equipe ${e.nome}`, perfil: 'EQUIPE', equipeId: e.id })),
  ].map((u) => ({ ...u, ativo: true, credencial: null, trocarSenha: true }));

  const ativos = [];
  const trechos = [];
  for (const [alim, r] of Object.entries(ROTAS)) {
    const pts = amostrar(r.pts, 150);
    const sufixo = alim.slice(4);
    trechos.push({ id: `tr-${alim}`, alimentador: alim, conjunto: r.conjunto, tipo: 'TRONCO', coords: pts });
    pts.slice(1).forEach((p, i) => {
      const veg = alim === 'ALM-11' && i % 4 === 1;
      ativos.push({
        id: `P-${sufixo}-${String(i + 1).padStart(3, '0')}`, codigo: `P-${sufixo}-${String(i + 1).padStart(3, '0')}`,
        tipo: i === Math.floor(pts.length / 2) ? 'RELIGADOR' : 'POSTE', alimentador: alim, conjunto: r.conjunto,
        lat: p[0], lon: p[1], ucs: Math.max(150, Math.round(3200 * (1 - i / pts.length))),
        comp12m: Math.round(entre(0, 6000)), falhas12m: inteiro(0, 1),
        criterios: ['TRONCO_ALIMENTADOR', ...(veg ? ['VEGETACAO_HISTORICO'] : [])], ultimaInspecao: {},
      });
    });
    const reincidentes = { 'ALM-07': 15, 'ALM-11': 6, 'ALM-03': 4 }[alim];
    const totalTrafos = reincidentes + 5;
    for (let k = 0; k < totalTrafos; k++) {
      const base = pts[inteiro(2, pts.length - 1)];
      const ang = entre(0, Math.PI * 2), dist = entre(60, 260);
      const p = deslocar(base, Math.sin(ang) * dist, Math.cos(ang) * dist);
      const reinc = k < reincidentes;
      ativos.push({
        id: `TR-${sufixo}-${String(k + 1).padStart(2, '0')}`, codigo: `TR-${sufixo}-${String(k + 1).padStart(2, '0')}`,
        tipo: 'TRAFO', alimentador: alim, conjunto: r.conjunto, lat: p[0], lon: p[1],
        ucs: inteiro(40, 180), comp12m: reinc ? Math.round(entre(30000, 66000)) : Math.round(entre(0, 4000)),
        falhas12m: reinc ? inteiro(3, 8) : inteiro(0, 1), criterios: reinc ? ['TRAFO_REINCIDENTE'] : [], ultimaInspecao: {},
      });
    }
    for (let k = 0; k < 4; k++) {
      const base = pts[inteiro(3, pts.length - 2)];
      const p = deslocar(base, entre(-90, 90), entre(-90, 90));
      const reinc = k < 2;
      ativos.push({
        id: `CF-${sufixo}-${k + 1}`, codigo: `CF-${sufixo}-${k + 1}`, tipo: 'CHAVE_FUSIVEL', alimentador: alim, conjunto: r.conjunto,
        lat: p[0], lon: p[1], ucs: inteiro(150, 600), comp12m: Math.round(entre(2000, 25000)), falhas12m: reinc ? inteiro(3, 6) : 0,
        criterios: reinc ? ['CHAVE_FUSIVEL_REINCIDENTE'] : [], ultimaInspecao: {},
      });
    }
  }

  // Histórico de inspeções concluídas (base para aderência e ranking).
  const inspecoes = [];
  const inspetores = equipes.filter((e) => e.tipo === 'INSPECAO');
  for (const a of ativos) {
    for (const cid of a.criterios) {
      const c = CRITERIOS.find((x) => x.id === cid);
      const ultima = somarDias(hoje, -inteiro(Math.round(c.periodicidadeDias * 0.4), Math.round(c.periodicidadeDias * 1.25)));
      a.ultimaInspecao[cid] = ultima;
      const atraso = rnd() < 0.15 ? inteiro(3, 20) : -inteiro(0, 10);
      inspecoes.push({
        id: uid('insp'), ativoId: a.id, criterioId: cid, tipo: 'PROGRAMADA', status: 'CONCLUIDA',
        prazo: somarDias(ultima, -atraso), equipeId: escolher(inspetores).id, concluidaEm: `${ultima}T10:00:00.000Z`,
        resultado: 'SEM_ANOMALIA', sintetico: true,
      });
    }
  }

  // Defeitos em diferentes estágios do fluxo.
  const defeitos = [];
  const comCriterio = ativos.filter((a) => a.criterios.length);
  const distribuicao = [
    ...Array(6).fill('IDENTIFICADO'), ...Array(6).fill('VALIDADO'), ...Array(5).fill('PROGRAMADO'),
    ...Array(2).fill('EXECUTADO'), ...Array(4).fill('VERIFICADO'),
  ];
  const usados = new Set();
  for (const status of distribuicao) {
    let a;
    do { a = escolher(comCriterio); } while (usados.has(a.id));
    usados.add(a.id);
    const td = escolher(tiposDefeitoPara(a.tipo));
    const criado = somarDias(hoje, -inteiro(status === 'VERIFICADO' ? 30 : 1, status === 'VERIFICADO' ? 60 : 40));
    const equipeIdent = escolher(inspetores).id;
    const d = {
      id: uid('def'), ativoId: a.id, inspecaoId: null, tipoId: td.id, severidade: td.severidade, status,
      descricao: `${td.nome} (registro sintético)`, lat: a.lat, lon: a.lon, criadoEm: `${criado}T13:00:00.000Z`,
      criadoPor: `u-${equipeIdent}`, identificadoPorEquipe: equipeIdent, fotos: [], sintetico: true,
      equipeId: null, historico: [{ status: 'IDENTIFICADO', em: `${criado}T13:00:00.000Z`, por: `u-${equipeIdent}` }],
    };
    const passos = ['VALIDADO', 'PROGRAMADO', 'EXECUTADO', 'VERIFICADO'];
    const alvo = passos.indexOf(status);
    const exec = equipes.find((e) => td.equipes.includes(e.tipo) && e.tipo !== 'INSPECAO') || equipes[2];
    for (let k = 0; k <= alvo; k++) {
      const em = `${somarDias(criado, (k + 1) * 3)}T15:00:00.000Z`;
      if (passos[k] === 'PROGRAMADO') d.equipeId = exec.id;
      if (passos[k] === 'EXECUTADO') d.execucao = { equipeId: exec.id, atividade: td.atividade, em, por: `u-${exec.id}`, fotos: [] };
      if (passos[k] === 'VERIFICADO') d.verificadoEm = em;
      d.historico.push({ status: passos[k], em, por: passos[k] === 'EXECUTADO' ? `u-${exec.id}` : 'u-sup' });
    }
    defeitos.push(d);
  }

  const dados = {
    versaoSchema: VERSAO_SCHEMA, geradoEm: new Date().toISOString(),
    equipes, usuarios, ativos, trechos, inspecoes, defeitos,
    planos: [{ versao: 1, nome: 'Plano de Manutenção — ciclo atual (sintético)', em: new Date().toISOString(), por: 'u-gestor', aceitos: ativos.length, rejeitados: 0, origem: 'Carga inicial sintética' }],
    auditoria: [], fila: [], ultimaSync: null,
  };
  gerarInspecoesDevidas(dados, hoje);
  // Parte das inspeções devidas já distribuída às equipes de inspeção.
  dados.inspecoes.filter((i) => i.status === 'PENDENTE').forEach((i, n) => { if (n % 3 !== 0) { i.equipeId = inspetores[n % 2].id; i.status = 'ATRIBUIDA'; } });
  return dados;
}

