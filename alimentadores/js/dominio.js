// Regras e cálculos do Raio-X: períodos, indicadores por alimentador, camadas poste a poste, clusters, blocos de manobra e sugestão de chave.
// Funções puras sobre a base da rede (sem DOM), para poderem ser testadas e reaproveitadas no servidor na Fase 1.
import { hojeISO } from './util.js';

export const PERFIS = {
  GESTOR: 'Gerência operacional',
  ANALISTA: 'Planejamento e qualidade',
  SUPERVISOR: 'Supervisor',
  AUDITOR: 'Auditoria',
};

export const CAUSAS = { VEG: 'Vegetação', DESC: 'Descarga atmosférica', EQUIP: 'Falha de equipamento', ANIMAL: 'Animal', TERCEIRO: 'Terceiros', OUTRA: 'Outra / não identificada' };
// DJ = disjuntor da SE, RL = religador, CS = chave seccionadora (manobra), CF = chave fusível, NA = chave normalmente aberta (interligação).
export const CHAVES = { DJ: 'Disjuntor (SE)', RL: 'Religador', CS: 'Seccionadora', CF: 'Chave fusível', NA: 'Interligação (NA)' };
export const PROTECAO = new Set(['DJ', 'RL', 'CF']); // atuam sozinhas no defeito
export const DIVIDE_BLOCO = new Set(['DJ', 'RL', 'CS', 'CF']);

/** Parâmetros que mudam o resultado ficam juntos e visíveis na tela Dados. */
export const PARAMS = {
  reincidenciaMin: 2, // ocorrências no período para o poste ser reincidente
  chiAltoPercentil: 0.8, // poste com CHI originado acima do percentil 80 dos postes com falha
  clusterMinPostes: 2,
  dicLimiteMesUrbano: 4, // h/mês por UC — sintético, só para estimar compensação quando a base não traz o valor
  dicLimiteMesRural: 8,
  valorHoraUc: 3.2, // R$ por hora de DIC acima do limite, por UC — sintético
};

// ---------------- Períodos ----------------
export function periodos(hoje = hojeISO()) {
  const anoAtual = Number(hoje.slice(0, 4)), anoAnt = anoAtual - 1;
  const mesmoDia = `${anoAnt}${hoje.slice(4, 10)}`;
  return {
    ATUAL: { id: 'ATUAL', rotulo: `${anoAtual} até hoje`, curto: String(anoAtual), ini: `${anoAtual}-01-01`, fim: hoje, ano: anoAtual, parcial: true },
    ANTERIOR_MP: { id: 'ANTERIOR_MP', rotulo: `${anoAnt} mesmo período`, curto: `${anoAnt} m.p.`, ini: `${anoAnt}-01-01`, fim: mesmoDia, ano: anoAnt, parcial: true },
    ANTERIOR: { id: 'ANTERIOR', rotulo: `${anoAnt} ano fechado`, curto: String(anoAnt), ini: `${anoAnt}-01-01`, fim: `${anoAnt}-12-31`, ano: anoAnt, parcial: false },
    DOZE: { id: 'DOZE', rotulo: 'Últimos 12 meses', curto: '12 m', ini: somarAno(hoje, -1), fim: hoje, ano: null, parcial: false },
  };
}
function somarAno(iso, n) { return `${Number(iso.slice(0, 4)) + n}${iso.slice(4, 10)}`; }
export const noPeriodo = (dataIso, p) => { const d = dataIso.slice(0, 10); return d >= p.ini && d <= p.fim; };

/** Compensação: lançamentos mensais (AAAA-MM) ou anuais (AAAA-00). O anual só entra no período que cobre o ano todo ou o ano corrente. */
function compNoPeriodo(c, p) {
  if (c.mes.endsWith('-00')) {
    const ano = Number(c.mes.slice(0, 4));
    return p.ano === ano && (p.id === 'ATUAL' || p.id === 'ANTERIOR');
  }
  const ini = p.ini.slice(0, 7), fim = p.fim.slice(0, 7);
  return c.mes >= ini && c.mes <= fim;
}

// ---------------- Geometria ----------------
export function distM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------------- Índice do alimentador (topologia em árvore) ----------------
const cache = new Map();
export function limparCache() { cache.clear(); }

/** Monta a árvore do alimentador: filhos, ordem DFS (tin/tout), UCs a jusante, km, ocorrências e compensação por poste. */
export function indexar(rede, alId) {
  const chave = `${rede.versao}|${alId}`;
  if (cache.has(chave)) return cache.get(chave);
  const al = rede.alimentadores.find((a) => a.id === alId);
  if (!al) return null;
  const postes = rede.postes.filter((p) => p.al === alId);
  const porId = new Map(postes.map((p) => [p.id, p]));
  const filhos = new Map(postes.map((p) => [p.id, []]));
  const raizes = [];
  for (const p of postes) {
    if (p.pai && porId.has(p.pai)) filhos.get(p.pai).push(p.id); else raizes.push(p.id);
  }
  // DFS iterativo (alimentador real tem milhares de postes: recursão estoura a pilha).
  const tin = new Map(), tout = new Map(), ordem = [], prof = new Map();
  let t = 0;
  for (const r of raizes) {
    const pilha = [[r, 0, 0]];
    prof.set(r, 0);
    while (pilha.length) {
      const topo = pilha[pilha.length - 1];
      const [id, i] = topo;
      if (i === 0) { tin.set(id, t++); ordem.push(id); }
      const fs = filhos.get(id);
      if (i < fs.length) { topo[1]++; prof.set(fs[i], prof.get(id) + 1); pilha.push([fs[i], 0, 0]); } else { tout.set(id, t); pilha.pop(); }
    }
  }
  const ucsSub = new Map();
  for (let k = ordem.length - 1; k >= 0; k--) {
    const id = ordem[k];
    ucsSub.set(id, (porId.get(id).ucs || 0) + filhos.get(id).reduce((s, f) => s + ucsSub.get(f), 0));
  }
  let km = 0;
  for (const p of postes) if (p.pai && porId.has(p.pai)) km += distM(p, porId.get(p.pai)) / 1000;
  const ocorrencias = rede.ocorrencias.filter((o) => o.al === alId && porId.has(o.poste));
  const ocPorPoste = new Map();
  for (const o of ocorrencias) { if (!ocPorPoste.has(o.poste)) ocPorPoste.set(o.poste, []); ocPorPoste.get(o.poste).push(o); }
  const compPorPoste = new Map();
  for (const c of rede.compensacoes || []) {
    if (!porId.has(c.poste)) continue;
    if (!compPorPoste.has(c.poste)) compPorPoste.set(c.poste, []);
    compPorPoste.get(c.poste).push(c);
  }
  const idx = { al, postes, porId, filhos, raizes, tin, tout, ordem, prof, ucsSub, km, ocorrencias, ocPorPoste, compPorPoste, ucsTotal: postes.reduce((s, p) => s + (p.ucs || 0), 0) };
  idx.jusante = (a, b) => tin.get(a) <= tin.get(b) && tin.get(b) < tout.get(a); // b está a jusante de a (ou é a)
  cache.set(chave, idx);
  return idx;
}

/** Dispositivo de proteção a montante (o que abre no defeito do poste). */
export function protecaoMontante(idx, posteId) {
  let p = idx.porId.get(posteId);
  while (p) {
    if (PROTECAO.has(p.chave)) return p.id;
    p = p.pai ? idx.porId.get(p.pai) : null;
  }
  return idx.raizes[0];
}

// ---------------- Estatística poste a poste ----------------
/** Por poste: ocorrências originadas, CHI e CI originados, horas, causas e compensação no período. */
export function statsPostes(idx, per) {
  const m = new Map();
  const s = (id) => { if (!m.has(id)) m.set(id, { n: 0, chi: 0, ci: 0, horas: 0, causas: {}, comp: 0 }); return m.get(id); };
  for (const o of idx.ocorrencias) {
    if (!noPeriodo(o.data, per)) continue;
    const x = s(o.poste);
    x.n++; x.chi += o.chi; x.ci += o.ucs; x.horas += o.dur;
    x.causas[o.causa] = (x.causas[o.causa] || 0) + o.chi;
  }
  for (const [id, cs] of idx.compPorPoste) for (const c of cs) if (compNoPeriodo(c, per)) s(id).comp += c.valor;
  return m;
}

const vazio = { n: 0, chi: 0, ci: 0, horas: 0, causas: {}, comp: 0 };
export const st = (stats, id) => stats.get(id) || vazio;

/** Limiar de CHI alto: percentil configurável entre os postes que originaram falha no período. */
export function limiarChiAlto(stats) {
  const v = [...stats.values()].map((x) => x.chi).filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return Infinity;
  return v[Math.min(v.length - 1, Math.floor(v.length * PARAMS.chiAltoPercentil))];
}

// ---------------- Indicadores do alimentador ----------------
export function metricas(idx, per) {
  let chi = 0, ci = 0, n = 0, comp = 0, horasDif = 0, nDif = 0, horasNorm = 0, nNorm = 0;
  const porCausa = {};
  for (const o of idx.ocorrencias) {
    if (!noPeriodo(o.data, per)) continue;
    n++; chi += o.chi; ci += o.ucs;
    porCausa[o.causa] = (porCausa[o.causa] || 0) + o.chi;
    if (idx.porId.get(o.poste)?.acesso === 'DIFICIL') { horasDif += o.dur; nDif++; } else { horasNorm += o.dur; nNorm++; }
  }
  for (const cs of idx.compPorPoste.values()) for (const c of cs) if (compNoPeriodo(c, per)) comp += c.valor;
  const u = idx.ucsTotal || 1;
  const stats = statsPostes(idx, per);
  const reinc = [...stats.values()].filter((x) => x.n >= PARAMS.reincidenciaMin).length;
  return {
    n, chi, ci, comp, dec: chi / u, fec: ci / u, porCausa, reincidentes: reinc,
    durDificil: nDif ? horasDif / nDif : null, durNormal: nNorm ? horasNorm / nNorm : null,
    postes: idx.postes.length, km: idx.km, ucs: idx.ucsTotal,
    pctVeg: idx.postes.filter((p) => p.veg).length / (idx.postes.length || 1),
    pctAcesso: idx.postes.filter((p) => p.acesso === 'DIFICIL').length / (idx.postes.length || 1),
    chaves: idx.postes.filter((p) => p.chave && p.chave !== 'DJ').length,
  };
}

/** Carteira: todos os alimentadores com período atual × mesmo período do ano anterior. */
export function carteira(rede, hoje = hojeISO()) {
  const P = periodos(hoje);
  return rede.alimentadores.map((al) => {
    const idx = indexar(rede, al.id);
    const atual = metricas(idx, P.ATUAL), ant = metricas(idx, P.ANTERIOR_MP), ano = metricas(idx, P.ANTERIOR);
    const delta = (a, b) => (b ? (a - b) / b : null);
    return { al, idx, atual, ant, ano, dChi: delta(atual.chi, ant.chi), dComp: delta(atual.comp, ant.comp), dDec: delta(atual.dec, ant.dec) };
  });
}

// ---------------- Camadas ----------------
export const CAMADAS = {
  arvore: { rotulo: 'Árvore', icone: '🌳', desc: 'Trecho com vegetação próxima da rede (marcação poste a poste)' },
  acesso: { rotulo: 'Acesso difícil', icone: '🚧', desc: 'Poste sem acesso direto de viatura (área rural, sem estrada, área fechada ou de risco)' },
  reinc: { rotulo: 'Reincidente', icone: '🔁', desc: `Poste que originou ${PARAMS.reincidenciaMin} ou mais ocorrências no período` },
  comp: { rotulo: 'Compensação', icone: 'R$', desc: 'Transformador com compensação paga no período' },
  chiAlto: { rotulo: 'CHI alto', icone: '⚡', desc: 'Poste com CHI originado acima do percentil 80 do alimentador' },
  chaves: { rotulo: 'Chaves', icone: '⏚', desc: 'Chaves de manobra e proteção (religador, seccionadora, fusível, NA)' },
};

export function predicados(stats, limiar) {
  return {
    arvore: (p) => !!p.veg,
    acesso: (p) => p.acesso === 'DIFICIL',
    reinc: (p) => st(stats, p.id).n >= PARAMS.reincidenciaMin,
    comp: (p) => st(stats, p.id).comp > 0,
    chiAlto: (p) => st(stats, p.id).chi > 0 && st(stats, p.id).chi >= limiar,
  };
}

export const CAMADAS_TRECHO = ['arvore', 'acesso']; // marcação contínua de campo: define o trecho
export const CAMADAS_PONTO = ['reinc', 'comp', 'chiAlto']; // resultado poste a poste: qualifica o trecho

/**
 * Filtro das telas: camadas de trecho (árvore, acesso) formam os clusters; camadas de ponto (reincidência, compensação, CHI alto)
 * e a causa dizem quais postes "acendem" dentro deles. E = todas as camadas marcadas; OU = qualquer uma.
 */
export function montarFiltro(stats, { camadas = [], modo = 'OU', causa = '' } = {}) {
  const pr = predicados(stats, limiarChiAlto(stats));
  const tr = camadas.filter((c) => CAMADAS_TRECHO.includes(c)), pt = camadas.filter((c) => CAMADAS_PONTO.includes(c));
  const combinar = (lista) => (p) => (modo === 'E' ? lista.every((c) => pr[c](p)) : lista.some((c) => pr[c](p)));
  const trecho = tr.length ? combinar(tr) : null;
  const pontoCamadas = pt.length ? combinar(pt) : null;
  const ponto = pontoCamadas || causa ? (p) => (!pontoCamadas || pontoCamadas(p)) && (!causa || st(stats, p.id).causas[causa] > 0) : null;
  return { trecho, ponto, ativo: !!(trecho || ponto) };
}

/** Poste que atende ao filtro inteiro (usado para pintar o mapa). */
export function filtroPostes(idx, stats, cfg) {
  const f = montarFiltro(stats, cfg);
  if (!f.ativo) return () => false;
  return (p) => (!f.trecho || f.trecho(p)) && (!f.ponto || f.ponto(p));
}

// ---------------- Clusters ----------------
/**
 * Cluster = trecho contínuo da rede (poste ligado ao poste pai).
 * Com camada de trecho: o cluster é o trecho de árvore/acesso, e só entra se tiver ao menos um poste que acende nas camadas de ponto e na causa.
 * Só com camadas de ponto: agrupa os postes que acendem, aceitando até 3 postes sem marca entre eles (para não picar o trecho).
 */
export function clusters(idx, stats, cfg = {}) {
  const f = montarFiltro(stats, cfg);
  if (!f.ativo) return [];
  const base = f.trecho || f.ponto, salto = f.trecho ? 1 : 3;
  const marca = new Set(idx.postes.filter(base).map((p) => p.id));
  const pai = new Map();
  const achar = (x) => { while (pai.get(x) !== x) { pai.set(x, pai.get(pai.get(x))); x = pai.get(x); } return x; };
  const unir = (a, b) => { const ra = achar(a), rb = achar(b); if (ra !== rb) pai.set(ra, rb); };
  for (const id of marca) pai.set(id, id);
  for (const id of marca) {
    let p = idx.porId.get(id), passos = 0;
    while (p?.pai && passos <= salto) {
      const q = idx.porId.get(p.pai);
      if (!q) break;
      if (marca.has(q.id)) { unir(id, q.id); break; }
      p = q; passos++;
    }
  }
  const grupos = new Map();
  for (const id of marca) { const r = achar(id); if (!grupos.has(r)) grupos.set(r, []); grupos.get(r).push(id); }
  const out = [];
  for (const ids of grupos.values()) {
    const ps = ids.map((i) => idx.porId.get(i));
    const acesos = f.trecho && f.ponto ? ps.filter(f.ponto) : ps;
    if (!acesos.length) continue;
    let chi = 0, n = 0, comp = 0, ucs = 0, km = 0;
    const causas = {};
    for (const p of ps) {
      const s = st(stats, p.id);
      chi += s.chi; n += s.n; comp += s.comp; ucs += p.ucs || 0;
      for (const [c, v] of Object.entries(s.causas)) causas[c] = (causas[c] || 0) + v;
      if (p.pai && marca.has(p.pai)) km += distM(p, idx.porId.get(p.pai)) / 1000;
    }
    if (cfg.chiMin && chi < cfg.chiMin) continue;
    // Ponto de referência: o poste mais a montante do cluster (onde a equipe chega primeiro).
    const montante = ps.reduce((a, b) => (idx.tin.get(a.id) <= idx.tin.get(b.id) ? a : b));
    const centro = ps.reduce((a, p) => ({ lat: a.lat + p.lat / ps.length, lon: a.lon + p.lon / ps.length }), { lat: 0, lon: 0 });
    const causaPrinc = Object.entries(causas).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    out.push({ ids, postes: ps, acesos: acesos.map((p) => p.id), n, chi, comp, ucs, km, causas, causaPrinc, montante, centro, al: idx.al, idCluster: `${idx.al.id}-${montante.id}`,
      veg: ps.filter((p) => p.veg).length / ps.length, acesso: ps.filter((p) => p.acesso === 'DIFICIL').length / ps.length,
      reinc: ps.filter((p) => st(stats, p.id).n >= PARAMS.reincidenciaMin).length });
  }
  return out.filter((c) => c.ids.length >= PARAMS.clusterMinPostes || c.chi > 0 || c.comp > 0)
    .sort((a, b) => b.chi - a.chi || b.comp - a.comp || b.ids.length - a.ids.length);
}

/** Ação recomendada a partir do perfil do cluster (o que mais pesa no CHI e no trecho). */
export function acaoSugerida(c) {
  if (c.veg >= 0.5 && (c.causaPrinc === 'VEG' || !c.causaPrinc)) return { tipo: 'PODA', texto: c.acesso >= 0.5 ? 'Poda com logística de acesso (roçada do caminho, autorização do proprietário, equipe leve)' : 'Poda programada no trecho (priorizar antes do período chuvoso)' };
  if (c.acesso >= 0.5) return { tipo: 'ACESSO', texto: 'Reduzir tempo de deslocamento: chave telecomandada ou religador no início do trecho, base avançada e rota de acesso mapeada' };
  if (c.comp > 0 && c.n >= PARAMS.reincidenciaMin) return { tipo: 'TRAFO', texto: 'Transformador reincidente com compensação: inspeção termográfica, balanceamento de carga ou troca' };
  if (c.causaPrinc === 'DESC') return { tipo: 'PROTECAO', texto: 'Descarga atmosférica recorrente: para-raios e aterramento no trecho' };
  if (c.causaPrinc === 'EQUIP') return { tipo: 'MANUTENCAO', texto: 'Falha de equipamento recorrente: inspeção detalhada e substituição preventiva' };
  if (c.causaPrinc === 'ANIMAL') return { tipo: 'PROTECAO', texto: 'Animal: protetores de bucha e cobertura de partes vivas' };
  return { tipo: 'ANALISE', texto: 'Analisar causa raiz (MASP) antes de definir a ação' };
}
export const TIPOS_ACAO = { PODA: 'Poda', ACESSO: 'Acesso / chave', TRAFO: 'Transformador', PROTECAO: 'Proteção', MANUTENCAO: 'Manutenção', ANALISE: 'Análise de causa', CHAVE: 'Nova chave' };

// ---------------- Blocos de manobra ----------------
/**
 * Bloco = trecho entre uma chave e as próximas chaves a jusante. É a menor parte da rede que se isola numa manobra.
 * Para cada bloco: UCs dentro dele, UCs a jusante, CHI originado e a melhor posição para uma chave nova (maior CHI evitado).
 */
export function blocos(idx, stats, per) {
  const lista = [];
  const cabecas = idx.ordem.filter((id) => idx.raizes.includes(id) || DIVIDE_BLOCO.has(idx.porId.get(id).chave));
  const ehCabeca = new Set(cabecas);
  for (const cab of cabecas) {
    const membros = [];
    const pilha = [cab];
    while (pilha.length) {
      const id = pilha.pop();
      membros.push(id);
      for (const f of idx.filhos.get(id)) if (!ehCabeca.has(f)) pilha.push(f);
    }
    const set = new Set(membros);
    let chi = 0, n = 0, ucs = 0, dif = 0, veg = 0, km = 0, temNA = false;
    for (const id of membros) {
      const p = idx.porId.get(id), s = st(stats, id);
      chi += s.chi; n += s.n; ucs += p.ucs || 0;
      if (p.acesso === 'DIFICIL') dif++;
      if (p.veg) veg++;
      if (p.chave === 'NA') temNA = true;
      if (p.pai && set.has(p.pai)) km += distM(p, idx.porId.get(p.pai)) / 1000;
    }
    const cabP = idx.porId.get(cab);
    lista.push({ cabeca: cabP, membros, n, chi, ucs, ucsJusante: idx.ucsSub.get(cab), km, temNA,
      pctAcesso: dif / membros.length, pctVeg: veg / membros.length, sugestao: sugerirChave(idx, membros, cab, per) });
  }
  return lista.sort((a, b) => b.chi - a.chi);
}

/**
 * Chave nova no poste X do bloco: um defeito a jusante de X passa a desligar só as UCs a jusante de X.
 * CHI evitado(X) = Σ ocorrências originadas a jusante de X (dentro do bloco) × (UCs que caíram − UCs a jusante de X) × duração.
 * É uma estimativa de primeira ordem: não considera manobra de recomposição nem coordenação de proteção.
 */
export function sugerirChave(idx, membros, cab, per) {
  const oc = [];
  for (const id of membros) for (const o of idx.ocPorPoste.get(id) || []) if (noPeriodo(o.data, per)) oc.push(o);
  if (oc.length < 2) return null;
  let melhor = null;
  for (const x of membros) {
    if (x === cab) continue;
    const ux = idx.ucsSub.get(x);
    let evitado = 0, nAbaixo = 0;
    for (const o of oc) {
      if (!idx.jusante(x, o.poste)) continue;
      nAbaixo++;
      evitado += Math.max(0, o.ucs - ux) * o.dur;
    }
    if (nAbaixo >= 2 && (!melhor || evitado > melhor.chiEvitado)) melhor = { poste: idx.porId.get(x), chiEvitado: evitado, ocorrencias: nAbaixo, ucsJusante: ux };
  }
  return melhor && melhor.chiEvitado > 0 ? melhor : null;
}

// ---------------- Perguntas prontas (filtros salvos que respondem uma decisão) ----------------
export const PERGUNTAS = [
  { id: 'podar', texto: 'Onde podar primeiro?', camadas: ['arvore', 'chiAlto'], modo: 'E', causa: 'VEG', aba: 'clusters',
    explica: 'Trechos com árvore em que o poste originou CHI alto por vegetação. É a lista de poda com retorno em CHI.' },
  { id: 'acesso', texto: 'Onde o acesso alonga a interrupção?', camadas: ['acesso', 'chiAlto'], modo: 'E', causa: '', aba: 'clusters',
    explica: 'Trechos de acesso difícil com CHI alto. Ali o CHI vem da duração: a resposta é chave telecomandada, religador ou base avançada, não só manutenção.' },
  { id: 'chave', texto: 'Onde falta chave?', camadas: ['chaves'], modo: 'OU', causa: '', aba: 'blocos',
    explica: 'Blocos de manobra ordenados pelo CHI originado, com a posição de chave nova que mais evita CHI.' },
  { id: 'compensacao', texto: 'Onde a compensação se repete?', camadas: ['comp', 'reinc'], modo: 'E', causa: '', aba: 'clusters',
    explica: 'Transformadores que pagaram compensação e são reincidentes. É dinheiro que volta todo mês se nada mudar.' },
  { id: 'reincidente', texto: 'Quem é reincidente?', camadas: ['reinc'], modo: 'OU', causa: '', aba: 'clusters',
    explica: `Postes que originaram ${PARAMS.reincidenciaMin} ou mais ocorrências no período, agrupados em trechos.` },
];
