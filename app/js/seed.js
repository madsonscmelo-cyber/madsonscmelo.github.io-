// Dados 100% sintéticos para o protótipo. Nenhum ativo, código ou valor corresponde à rede real.
import { CONFIG } from './config.js';
import { mulberry32, deslocar, distanciaM, hojeISO, somarDias, uid, semanaISO, proximoDiaUtil } from './util.js';
import { CRITERIOS, tiposDefeitoPara, gerarInspecoesDevidas } from './dominio.js';
import { dividirLinha, comprimentoKm } from './rede.js';

export const VERSAO_SCHEMA = 6;

const SE = [-15.8405, -48.0760]; // subestação fictícia
const ROTAS = {
  'ALM-07': { conjunto: 'CJ-Centro', pts: [SE, [-15.8372, -48.0650], [-15.8346, -48.0520], [-15.8302, -48.0420], [-15.8290, -48.0300]] },
  'ALM-03': { conjunto: 'CJ-Norte', pts: [SE, [-15.8300, -48.0790], [-15.8200, -48.0772], [-15.8122, -48.0702], [-15.8050, -48.0690]] },
  'ALM-11': { conjunto: 'CJ-Sul', pts: [SE, [-15.8500, -48.0722], [-15.8580, -48.0642], [-15.8650, -48.0601], [-15.8722, -48.0520]] },
};
// Área de concessão fictícia usada na validação da importação.
// Área válida para importações vem da configuração da instalação (a da demonstração é sintética).
export const AREA_CONCESSAO = CONFIG.areaConcessao;

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
    { id: 'ROC-01', nome: 'Roçada 01', tipo: 'ROCADA', base: 'Base Sul', disponivel: true },
  ];
  // Senha inicial de demonstração (POLITICA.senhaInicialDemo) com troca obrigatória no primeiro acesso.
  const usuarios = [
    { id: 'u-gestor', matricula: 'G1001', nome: 'Gestão de Planejamento', perfil: 'GESTOR' },
    { id: 'u-sup', matricula: 'S1001', nome: 'Supervisão de Campo', perfil: 'SUPERVISOR' },
    { id: 'u-auditor', matricula: 'A1001', nome: 'Auditoria Interna', perfil: 'AUDITOR' },
    { id: 'u-admin', matricula: 'X1001', nome: 'Administração do Sistema', perfil: 'ADMIN' },
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
    ...Array(5).fill('IDENTIFICADO'), ...Array(9).fill('VALIDADO'), ...Array(6).fill('PROGRAMADO'),
    ...Array(3).fill('EXECUTADO'), ...Array(6).fill('VERIFICADO'),
  ];
  const usados = new Set();
  let nProg = 0, nAtual = 0;
  for (const status of distribuicao) {
    let a;
    do { a = escolher(comCriterio); } while (usados.has(a.id));
    usados.add(a.id);
    const td = escolher(tiposDefeitoPara(a.tipo));
    const [ini, fim] = { VERIFICADO: [30, 60], EXECUTADO: [15, 40] }[status] || [1, 40];
    const criado = somarDias(hoje, -inteiro(ini, fim));
    const equipeIdent = escolher(inspetores).id;
    const d = {
      id: uid('def'), ativoId: a.id, inspecaoId: null, tipoId: td.id, severidade: td.severidade, status,
      descricao: `${td.nome} (registro sintético)`, lat: a.lat, lon: a.lon, criadoEm: `${criado}T13:00:00.000Z`,
      criadoPor: `u-${equipeIdent}`, identificadoPorEquipe: equipeIdent, fotos: [], sintetico: true,
      equipeId: null, historico: [{ status: 'IDENTIFICADO', em: `${criado}T13:00:00.000Z`, por: `u-${equipeIdent}` }],
      ...(td.unidade && td.unidade !== 'un' ? { quantidade: td.unidade === 'm' ? inteiro(8, 30) * 10 : inteiro(1, 6) } : {}),
    };
    const passos = ['VALIDADO', 'PROGRAMADO', 'EXECUTADO', 'VERIFICADO'];
    const alvo = passos.indexOf(status);
    const exec = equipes.find((e) => td.equipes.includes(e.tipo) && e.tipo !== 'INSPECAO') || equipes[2];
    for (let k = 0; k <= alvo; k++) {
      const passo = somarDias(criado, (k + 1) * 3);
      const em = `${passo > hoje ? hoje : passo}T15:00:00.000Z`; // nada no futuro
      if (passos[k] === 'PROGRAMADO') d.equipeId = exec.id;
      if (passos[k] === 'EXECUTADO') {
        // Programado para o dia da execução (conforme) ou 2 dias antes (executado com atraso), em semana já congelada.
        const dataProg = nProg++ % 3 === 2 ? somarDias(em, -2) : em.slice(0, 10);
        d.programacao = { equipeId: exec.id, data: dataProg, semana: semanaISO(dataProg), em, por: 'u-sup' };
        d.execucao = { equipeId: exec.id, atividade: td.atividade, em, por: `u-${exec.id}`, fotos: [], conformeProgramacao: em.slice(0, 10) <= dataProg };
      }
      if (passos[k] === 'VERIFICADO') d.verificadoEm = em;
      d.historico.push({ status: passos[k], em, por: passos[k] === 'EXECUTADO' ? `u-${exec.id}` : 'u-sup' });
    }
    if (status === 'PROGRAMADO') {
      let dia = hoje;
      for (let k = 0; k < nAtual % 7; k++) dia = proximoDiaUtil(dia);
      nAtual++;
      d.programacao = { equipeId: exec.id, data: dia, semana: semanaISO(dia), em: d.historico.at(-1).em, por: 'u-sup' };
    }
    defeitos.push(d);
  }
  // Semanas passadas já congeladas (base da aderência da programação).
  const congelamentos = {};
  for (const f of defeitos.filter((x) => x.execucao && x.programacao)) {
    const c = (congelamentos[f.programacao.semana] ||= { semana: f.programacao.semana, em: `${f.programacao.data}T12:00:00.000Z`, por: 'u-sup', itens: [] });
    c.itens.push({ defeitoId: f.id, data: f.programacao.data, equipeId: f.programacao.equipeId, custo: null });
  }

  const dados = {
    versaoSchema: VERSAO_SCHEMA, geradoEm: new Date().toISOString(),
    equipes, usuarios, ativos, trechos, inspecoes, defeitos,
    planos: [{ versao: 1, nome: 'Plano de Manutenção — ciclo atual (sintético)', em: new Date().toISOString(), por: 'u-gestor', aceitos: ativos.length, rejeitados: 0, origem: 'Carga inicial sintética' }],
    auditoria: [], fila: [], ultimaSync: null,
    congelamentos, parametros: { versoes: [] },
  };
  gerarRedeEPlanos(dados, { rnd, entre, inteiro, escolher, hoje, inspetores });
  gerarInspecoesDevidas(dados, hoje);
  // Parte das inspeções devidas já distribuída às equipes de inspeção.
  dados.inspecoes.filter((i) => i.status === 'PENDENTE').forEach((i, n) => { if (n % 3 !== 0) { i.equipeId = inspetores[n % 2].id; i.status = 'ATRIBUIDA'; } });
  return dados;
}


/** Trechos de inspeção (~1 km), áreas de planos especiais, histórico de inspeção por km e ocorrências sintéticas. */
function gerarRedeEPlanos(dados, { rnd, entre, inteiro, escolher, hoje, inspetores }) {
  const trechosInsp = [];
  for (const t of dados.trechos) {
    dividirLinha(t.coords, 1000).forEach((coords, i) => trechosInsp.push({
      id: `${t.alimentador}-T${String(i + 1).padStart(2, '0')}`, alimentador: t.alimentador, conjunto: t.conjunto, coords, km: Math.round(comprimentoKm(coords) * 100) / 100,
    }));
  }
  dados.trechosInspecao = trechosInsp;

  // Histórico: última inspeção completa de cada trecho (algumas vencidas) e patrulhas parciais.
  dados.inspecoesTrecho = [];
  for (const t of trechosInsp) {
    const dias = inteiro(10, 230);
    const fim = `${somarDias(hoje, -dias)}T11:00:00.000Z`;
    const drone = rnd() < 0.2;
    dados.inspecoesTrecho.push({ id: uid('it'), trechoId: t.id, tipo: drone ? 'DRONE' : 'TERRESTRE', equipeId: escolher(inspetores).id, inicio: fim, fim,
      cobertura: Math.round(entre(0.96, 1) * 1000) / 1000, km: t.km, completa: true, checklist: {}, fotos: [], sintetico: true });
    if (rnd() < 0.3) {
      const c = Math.round(entre(0.3, 0.8) * 100) / 100;
      const em = `${somarDias(hoje, -inteiro(1, 40))}T09:00:00.000Z`;
      dados.inspecoesTrecho.push({ id: uid('it'), trechoId: t.id, tipo: 'PATRULHA', equipeId: 'LEV-01', inicio: em, fim: em, cobertura: c, km: Math.round(t.km * c * 100) / 100, completa: false, checklist: {}, fotos: [], sintetico: true });
    }
  }

  // Áreas de planos especiais (todas fictícias).
  const alim = (a) => trechosInsp.filter((t) => t.alimentador === a);
  const meio = (t) => t.coords[Math.floor(t.coords.length / 2)];
  const bbox = (pts, folga) => {
    const la = pts.map((p) => p[0]), lo = pts.map((p) => p[1]);
    const [a, b, c, d] = [Math.min(...la) - folga, Math.max(...la) + folga, Math.min(...lo) - folga, Math.max(...lo) + folga];
    return [[a, c], [a, d], [b, d], [b, c]];
  };
  const a07 = alim('ALM-07'), a11 = alim('ALM-11'), a03 = alim('ALM-03');
  dados.areasPlano = [
    { id: 'AR-OURO-1', tipoPlano: 'OURO', nome: 'Hospital Regional (fictício) — ALM-07', geometria: { tipo: 'trechos', ids: a07.slice(0, 2).map((t) => t.id) } },
    { id: 'AR-URB-1', tipoPlano: 'URBANO', nome: 'Centro urbano (fictício)', geometria: { tipo: 'poligono', coords: bbox(a07.slice(1, 4).flatMap((t) => t.coords), 0.004) } },
    ...[[a07[2], 'Escola Municipal Exemplo 1'], [a11[1], 'Escola Estadual Exemplo 2'], [a03[3], 'Creche Exemplo 3']].filter(([t]) => t).map(([t, nome], i) => {
      const [la, lo] = meio(t);
      return { id: `AR-ESC-${i + 1}`, tipoPlano: 'ESCOLA', nome, geometria: { tipo: 'circulo', centro: [la + 0.0009, lo + 0.0006], raioM: 200 } };
    }),
    { id: 'AR-EVT-1', tipoPlano: 'EVENTO', nome: 'Micareta (fictícia) — circuito', inicio: somarDias(hoje, 20), fim: somarDias(hoje, 23),
      geometria: { tipo: 'poligono', coords: bbox(a11.slice(2, 4).flatMap((t) => t.coords), 0.002) } },
  ];

  // Ocorrências (desarmes) dos últimos 200 dias — causas com códigos da tabela padrão.
  const causas = ['VEG', 'VEG', 'VEG', 'EST', 'EST', 'CONEX', 'TRAFO', 'CHAVE', 'FAIXA', 'FAUNA', 'DESC', 'DESC', 'ABAL', 'NID', 'OBJ'];
  dados.ocorrencias = [];
  for (let i = 0; i < 22; i++) {
    const t = escolher(trechosInsp);
    const p = escolher(t.coords);
    const causa = escolher(causas);
    const ucs = inteiro(80, 1800);
    const horas = Math.round(entre(0.5, 4) * 10) / 10;
    dados.ocorrencias.push({ id: uid('oc'), dataHora: `${somarDias(hoje, -inteiro(2, 200))}T${String(inteiro(0, 23)).padStart(2, '0')}:10:00.000Z`, alimentador: t.alimentador,
      lat: p[0] + entre(-0.0003, 0.0003), lon: p[1] + entre(-0.0003, 0.0003), causa, ucs, chi: Math.round(ucs * horas), origem: 'sintética' });
  }
}
