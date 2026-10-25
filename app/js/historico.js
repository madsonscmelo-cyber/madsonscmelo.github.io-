// Foto semanal dos indicadores: base das tendências (12 semanas) do Painel e da tela Hoje.
// A semana corrente é atualizada a cada leitura; semanas encerradas ficam congeladas.
// Sem histórico real (demonstração), as 11 semanas anteriores são geradas e marcadas como sintéticas.
import { hojeISO, semanaISO, deslocarSemana, mulberry32 } from './util.js';
import { estado, persistir } from './store.js';
import { indicadores, STATUS_ABERTOS } from './dominio.js';
import { indicadoresKmi, completude } from './planos.js';
import { indicadoresEficacia } from './eficacia.js';
import { aderenciaUltimas } from './programacao.js';
import { taxaAchado, chiEmRisco } from './fluxo.js';
import { logar } from './auditoria.js';

export const SEMANAS_TENDENCIA = 12;

/** Indicadores-chave: os 4 do funil e os de risco. `pct` = proporção 0–1; `menor` = quanto menor, melhor. */
export const SERIES = {
  kmi: { nome: 'Aderência ao plano (KMI)', pct: true },
  completude: { nome: 'Inspeções completas', pct: true },
  aderenciaProg: { nome: 'Aderência da programação', pct: true },
  eficacia: { nome: 'Eficácia', pct: true },
  abertos: { nome: 'Defeitos abertos', menor: true },
  criticosVelhos: { nome: 'Críticos fora do prazo', menor: true },
  taxaAchado: { nome: 'Taxa de achado (def./km)' },
  chiRisco: { nome: 'CHI em risco (estimado)', menor: true },
};

export function medirAgora(ref = hojeISO()) {
  const d = estado.dados, ind = indicadores(d, ref);
  return {
    kmi: indicadoresKmi(ref)[0]?.aderencia ?? null,
    completude: completude(90, ref).pct,
    aderenciaProg: aderenciaUltimas(),
    eficacia: indicadoresEficacia(180, ref).eficacia,
    abertos: d.defeitos.filter((f) => STATUS_ABERTOS.includes(f.status)).length,
    criticosVelhos: ind.criticosVelhos,
    taxaAchado: taxaAchado(90, ref).media,
    chiRisco: Math.round(chiEmRisco().chi),
  };
}

function semente(txt) { let h = 2166136261; for (const c of txt) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

/** Garante a foto da semana corrente e, sem histórico, as semanas anteriores sintéticas. */
export function garantirHistorico(ref = hojeISO()) {
  const d = estado.dados;
  const h = (d.historicoSemanal ||= {});
  const semana = semanaISO(ref);
  const nova = !h[semana];
  const agora = medirAgora(ref);
  h[semana] = { semana, em: new Date().toISOString(), valores: agora, sintetico: false };
  const reais = Object.values(h).filter((x) => !x.sintetico).length;
  if (reais < SEMANAS_TENDENCIA && !Object.values(h).some((x) => x.sintetico)) {
    // Demonstração: trajetória plausível até o valor atual (ruído determinístico por semana). Nunca usado em produção.
    for (let k = 1; k < SEMANAS_TENDENCIA; k++) {
      const s = deslocarSemana(semana, -k);
      if (h[s]) continue;
      const rnd = mulberry32(semente(s));
      const valores = {};
      for (const [chave, cfg] of Object.entries(SERIES)) {
        const v = agora[chave];
        if (v === null || v === undefined) { valores[chave] = null; continue; }
        const tendencia = (cfg.menor ? 1 : -1) * 0.012 * k; // melhora gradual até hoje
        const ruido = (rnd() - 0.5) * 0.06;
        let x = cfg.pct ? v + tendencia + ruido : v * (1 + (cfg.menor ? 1 : -1) * 0.03 * k + ruido * 2);
        if (cfg.pct) x = Math.min(1, Math.max(0, x));
        valores[chave] = cfg.pct || chave === 'taxaAchado' ? Math.round(x * 1000) / 1000 : Math.max(0, Math.round(x));
      }
      h[s] = { semana: s, em: null, valores, sintetico: true };
    }
  }
  // Mantém só as últimas 52 semanas no aparelho.
  Object.keys(h).sort().slice(0, -52).forEach((s) => delete h[s]);
  if (nova) logar({ categoria: 'SISTEMA', acao: 'FOTO_SEMANAL_INDICADORES', entidade: 'indicador', entidadeId: semana, detalhe: agora });
  persistir();
  return h;
}

/** Série das últimas N semanas (mais antiga → atual) e variação contra a semana anterior. */
export function serie(chave, n = SEMANAS_TENDENCIA, ref = hojeISO()) {
  const h = estado.dados.historicoSemanal || {};
  const atual = semanaISO(ref);
  const pontos = [];
  for (let k = n - 1; k >= 0; k--) {
    const s = deslocarSemana(atual, -k);
    pontos.push({ semana: s, valor: h[s]?.valores?.[chave] ?? null, sintetico: !!h[s]?.sintetico });
  }
  const validos = pontos.filter((p) => p.valor !== null);
  const ult = validos.at(-1), ant = validos.at(-2);
  const delta = ult && ant ? ult.valor - ant.valor : null;
  const cfg = SERIES[chave];
  const melhorou = delta === null || delta === 0 ? null : cfg?.menor ? delta < 0 : delta > 0;
  return { pontos, delta, melhorou, sintetico: pontos.some((p) => p.sintetico) };
}
