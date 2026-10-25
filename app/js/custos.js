// Custos: custo-padrão (caderno × composição × fator regional), custo realizado e orçamento × comprometido × realizado.
import { estado, ativoPorId } from './store.js';
import { tipoDefeito, CATEGORIAS, STATUS_ABERTOS } from './dominio.js';
import { valor } from './parametros.js';
import { hojeISO } from './util.js';

export const mesDe = (iso) => (iso ? iso.slice(0, 7) : null);

/** "SRV-X:1; MAT-Y:2/u" → [{ codigo, qtd, porUnidade }] */
export function lerItens(texto = '') {
  return texto.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    const [codigo, q = '1'] = p.split(':').map((x) => x.trim());
    return { codigo: codigo.toUpperCase(), qtd: Number(q.replace('/u', '').replace(',', '.')) || 0, porUnidade: /\/u$/i.test(q) };
  });
}

export function quantidadeDo(defeito) {
  const td = tipoDefeito(defeito.tipoId);
  return Number(defeito.quantidade) || td?.quantidadePadrao || 1;
}

/** Custo-padrão de um defeito numa data (preços e fatores vigentes naquela data). */
export function custoDefeito(defeito, { data = hojeISO(), quantidade } = {}) {
  const td = tipoDefeito(defeito.tipoId);
  const caderno = new Map(valor('caderno', data).map((i) => [i.codigo, i]));
  const comp = valor('composicoes', data).find((c) => c.id === (td?.composicao || defeito.tipoId));
  const ativo = ativoPorId(defeito.ativoId);
  const fator = valor('fatores', data).find((f) => f.conjunto === ativo?.conjunto)?.fator || 1;
  const q = quantidade ?? quantidadeDo(defeito);
  const itens = lerItens(comp?.itens).map((it) => {
    const c = caderno.get(it.codigo);
    const qtd = it.porUnidade ? it.qtd * q : it.qtd;
    return { codigo: it.codigo, descricao: c?.descricao || '(item fora do caderno)', unidade: c?.unidade, qtd, preco: c?.preco || 0, subtotal: qtd * (c?.preco || 0) * fator };
  });
  const semPreco = itens.filter((i) => !i.preco).map((i) => i.codigo);
  return { total: Math.round(itens.reduce((s, i) => s + i.subtotal, 0) * 100) / 100, itens, fator, quantidade: q, unidade: td?.unidade || 'un', semPreco, semComposicao: !comp };
}

/** Horas estimadas (para a capacidade da programação). */
export function horasDefeito(defeito) {
  const td = tipoDefeito(defeito.tipoId);
  return Math.max(0.5, (td?.horasPadrao || 2) * (td?.unidade && td.unidade !== 'un' ? quantidadeDo(defeito) : 1));
}

export const categoriaDe = (defeito) => tipoDefeito(defeito.tipoId)?.categoria || 'ESTRUTURAL';

/**
 * Orçamento de um mês por categoria:
 *  realizado    = custo snapshot das execuções do mês
 *  comprometido = custo-padrão do que está programado no mês e ainda não foi executado
 *  saldo        = orçado − realizado − comprometido
 */
export function orcamentoDoMes(mes) {
  // A tabela de orçamento já é indexada por mês: vale sempre a versão em vigor hoje (ajustes de orçamento no meio do mês contam).
  const orc = valor('orcamento').filter((o) => o.mes === mes);
  const linhas = Object.fromEntries(Object.keys(CATEGORIAS).map((k) => [k, { categoria: k, orcado: 0, realizado: 0, comprometido: 0 }]));
  orc.forEach((o) => { if (linhas[o.categoria]) linhas[o.categoria].orcado += Number(o.valor) || 0; });
  for (const f of estado.dados.defeitos) {
    const l = linhas[categoriaDe(f)];
    if (!l) continue;
    if (f.execucao?.custo && mesDe(f.execucao.em) === mes && f.status !== 'CANCELADO') l.realizado += f.execucao.custo.total;
    else if (f.status === 'PROGRAMADO' && mesDe(f.programacao?.data) === mes) l.comprometido += custoDefeito(f).total;
  }
  const lista = Object.values(linhas).map((l) => ({ ...l, saldo: l.orcado - l.realizado - l.comprometido }));
  const total = lista.reduce((t, l) => ({ orcado: t.orcado + l.orcado, realizado: t.realizado + l.realizado, comprometido: t.comprometido + l.comprometido, saldo: t.saldo + l.saldo }), { orcado: 0, realizado: 0, comprometido: 0, saldo: 0 });
  return { mes, linhas: lista, total };
}

/** Carteira ainda sem data (identificados e validados): quanto custaria resolver tudo. */
export function projecaoCarteira() {
  const porCat = Object.fromEntries(Object.keys(CATEGORIAS).map((k) => [k, { categoria: k, qtd: 0, valor: 0, criticos: 0, valorCriticos: 0 }]));
  for (const f of estado.dados.defeitos) {
    if (!['IDENTIFICADO', 'VALIDADO'].includes(f.status)) continue;
    const c = porCat[categoriaDe(f)];
    const v = custoDefeito(f).total;
    c.qtd++; c.valor += v;
    if (f.severidade === 'A') { c.criticos++; c.valorCriticos += v; }
  }
  return Object.values(porCat);
}

/** Impacto de programar um defeito num mês: saldo da categoria antes e depois. */
export function impactoNoOrcamento(defeito, data) {
  const mes = mesDe(data);
  const o = orcamentoDoMes(mes).linhas.find((l) => l.categoria === categoriaDe(defeito));
  const custo = custoDefeito(defeito).total;
  const jaConta = defeito.status === 'PROGRAMADO' && mesDe(defeito.programacao?.data) === mes;
  const depois = o.saldo - (jaConta ? 0 : custo);
  return { mes, categoria: o.categoria, custo, orcado: o.orcado, saldoAntes: o.saldo, saldoDepois: depois, estoura: depois < 0 };
}

export const abertosComCusto = () => estado.dados.defeitos.filter((f) => STATUS_ABERTOS.includes(f.status));

/** Completa o custo das execuções e congelamentos da carga sintética (feito após os parâmetros carregarem). */
export function completarCustosSemValor() {
  let n = 0;
  for (const f of estado.dados.defeitos) {
    if (f.execucao && !f.execucao.custo) { f.execucao.custo = custoDefeito(f, { data: f.execucao.em.slice(0, 10) }); n++; }
  }
  for (const c of Object.values(estado.dados.congelamentos || {})) {
    for (const i of c.itens) if (i.custo === null) { const f = estado.dados.defeitos.find((x) => x.id === i.defeitoId); i.custo = f ? custoDefeito(f).total : 0; n++; }
  }
  return n;
}
