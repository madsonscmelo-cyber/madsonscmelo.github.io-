// Fluxo do defeito: linha do tempo de cada defeito, tempo por etapa (gargalo), idade da carteira e taxa de achado por km.
import { el, fmtData, hojeISO, somarDias, diasEntre } from './util.js';
import { estado, nomeEquipe } from './store.js';
import { PARAM, STATUS_ABERTOS } from './dominio.js';

export const ETAPAS = [
  { status: 'IDENTIFICADO', nome: 'Identificado', curto: 'Ident.', limite: null },
  { status: 'VALIDADO', nome: 'Validado', curto: 'Valid.', limite: 2 },
  { status: 'PROGRAMADO', nome: 'Programado', curto: 'Progr.', limite: 5 },
  { status: 'EXECUTADO', nome: 'Executado', curto: 'Exec.', limite: null }, // limite = prazo da severidade
  { status: 'VERIFICADO', nome: 'Verificado', curto: 'Verif.', limite: 3 },
];

const mediana = (l) => { if (!l.length) return null; const s = [...l].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Datas de cada etapa (primeira vez que o defeito chegou nela) e dias gastos desde a etapa anterior. */
export function linhaDoTempo(f, ref = hojeISO()) {
  const quando = {};
  for (const h of f.historico || []) if (!quando[h.status]) quando[h.status] = h.em;
  quando.IDENTIFICADO ||= f.criadoEm;
  const encerrado = ['REJEITADO', 'CANCELADO'].includes(f.status);
  let anterior = quando.IDENTIFICADO, atual = null;
  const etapas = ETAPAS.map((e, i) => {
    const em = quando[e.status] || null;
    const dias = i && em ? diasEntre(anterior, em) : 0;
    const limite = e.status === 'EXECUTADO' ? PARAM.sla[f.severidade] : e.limite;
    const r = { ...e, em, dias, limite, feito: !!em, estourou: !!(i && em && limite !== null && dias > limite) };
    if (em) anterior = em;
    else if (!atual && !encerrado) atual = r;
    return r;
  });
  if (atual) {
    atual.atual = true;
    atual.diasParado = diasEntre(anterior, ref);
    atual.estourou = atual.limite !== null && atual.diasParado > atual.limite;
  }
  return { etapas, atual, encerrado, total: diasEntre(quando.IDENTIFICADO, quando.VERIFICADO || ref) };
}

/** Linha do tempo em forma de passos, com texto e ícone (não depende só de cor). */
export function elementoLinhaDoTempo(f) {
  const lt = linhaDoTempo(f);
  return el('ol', { class: 'tl', 'aria-label': `Linha do tempo do defeito: ${lt.total} dia(s) no fluxo` },
    lt.etapas.map((e, i) => el('li', { class: `tl__passo${e.feito ? ' tl__passo--feito' : ''}${e.atual ? ' tl__passo--atual' : ''}${e.estourou ? ' tl__passo--atraso' : ''}` },
      el('span', { class: 'tl__marca', 'aria-hidden': 'true', text: e.feito ? '✓' : e.atual ? '●' : '' }),
      el('span', { class: 'tl__nome', text: e.curto }),
      el('span', { class: 'tl__info', text: e.feito ? (i ? `${e.dias} d${e.estourou ? ' ⚠' : ''}` : fmtData(e.em).slice(0, 5)) : e.atual ? `há ${e.diasParado} d${e.estourou ? ' ⚠' : ''}` : '' }),
      el('span', { class: 'sr-only', text: e.feito ? `${e.nome} em ${fmtData(e.em)}${i ? `, ${e.dias} dias depois da etapa anterior` : ''}${e.estourou ? ', acima do limite' : ''}` : e.atual ? `Aguardando ${e.nome.toLowerCase()} há ${e.diasParado} dias${e.estourou ? ', acima do limite' : ''}` : `${e.nome}: pendente` }))));
}

/** Mediana de dias por etapa nos últimos N dias e a etapa gargalo (maior mediana em relação ao limite). */
export function temposPorEtapa(dias = 180, ref = hojeISO()) {
  const desde = somarDias(ref, -dias);
  const defs = estado.dados.defeitos.filter((f) => f.criadoEm.slice(0, 10) >= desde && !['REJEITADO', 'CANCELADO'].includes(f.status));
  const out = ETAPAS.slice(1).map((e) => ({ ...e, valores: [] }));
  for (const f of defs) {
    const lt = linhaDoTempo(f, ref);
    lt.etapas.slice(1).forEach((e, i) => {
      if (e.feito) out[i].valores.push(e.dias);
      else if (e.atual) out[i].valores.push(e.diasParado); // parado conta: gargalo real inclui o que ainda não saiu
    });
  }
  const linhas = out.map((e) => ({ status: e.status, nome: e.nome, mediana: mediana(e.valores), n: e.valores.length, limite: e.status === 'EXECUTADO' ? PARAM.sla.B : e.limite }));
  const gargalo = linhas.filter((l) => l.mediana !== null).sort((a, b) => (b.mediana / (b.limite || 1)) - (a.mediana / (a.limite || 1)))[0] || null;
  return { linhas, gargalo };
}

export function idadeCarteira(ref = hojeISO()) {
  const faixas = [['até 7 dias', 0, 7], ['8 a 30 dias', 8, 30], ['31 a 90 dias', 31, 90], ['mais de 90 dias', 91, Infinity]].map(([nome, a, b]) => ({ nome, a, b, A: 0, B: 0, C: 0, total: 0 }));
  for (const f of estado.dados.defeitos.filter((x) => STATUS_ABERTOS.includes(x.status))) {
    const d = diasEntre(f.criadoEm, ref);
    const fx = faixas.find((x) => d >= x.a && d <= x.b);
    fx[f.severidade]++; fx.total++;
  }
  return faixas;
}

/**
 * Taxa de achado = defeitos validados identificados pela equipe ÷ km inspecionados completos pela equipe (N dias).
 * Equipe que roda muito km e acha pouco é o sinal antecipado de inspeção superficial — antes do desarme.
 */
export function taxaAchado(dias = 90, ref = hojeISO()) {
  const desde = somarDias(ref, -dias);
  const km = {}, achados = {};
  for (const i of estado.dados.inspecoesTrecho || []) if (i.completa && i.equipeId && i.fim.slice(0, 10) >= desde) km[i.equipeId] = (km[i.equipeId] || 0) + i.km;
  for (const f of estado.dados.defeitos) {
    if (!f.identificadoPorEquipe || f.criadoEm.slice(0, 10) < desde || ['IDENTIFICADO', 'REJEITADO', 'CANCELADO'].includes(f.status)) continue;
    achados[f.identificadoPorEquipe] = (achados[f.identificadoPorEquipe] || 0) + 1;
  }
  const equipes = [...new Set([...Object.keys(km), ...Object.keys(achados)])].map((id) => ({ id, nome: nomeEquipe(id), km: km[id] || 0, achados: achados[id] || 0, taxa: km[id] ? (achados[id] || 0) / km[id] : null }));
  const kmT = equipes.reduce((t, e) => t + e.km, 0), achT = equipes.reduce((t, e) => t + e.achados, 0);
  const media = kmT ? achT / kmT : null;
  // Alerta: equipe com ≥ 2 km no período e taxa abaixo de metade da média.
  equipes.forEach((e) => { e.alerta = media !== null && e.km >= 2 && e.taxa !== null && e.taxa < media / 2; });
  return { dias, equipes: equipes.sort((a, b) => (a.taxa ?? 99) - (b.taxa ?? 99)), media, km: kmT, achados: achT };
}

/**
 * CHI em risco (ESTIMADO) = Σ UCs dos ativos com defeito A/B aberto × duração média de interrupção (parâmetro).
 * É exposição se o ativo falhar, não previsão: a probabilidade de falha ainda não está calibrada.
 */
export function chiEmRisco() {
  const ativos = new Map();
  for (const f of estado.dados.defeitos) if (STATUS_ABERTOS.includes(f.status) && f.severidade !== 'C') {
    const a = estado.dados.ativos.find((x) => x.id === f.ativoId);
    if (a) ativos.set(a.id, a);
  }
  const ucs = [...ativos.values()].reduce((s, a) => s + (a.ucs || 0), 0);
  return { ativos: ativos.size, ucs, duracaoH: PARAM.duracaoMediaH, chi: ucs * PARAM.duracaoMediaH };
}
