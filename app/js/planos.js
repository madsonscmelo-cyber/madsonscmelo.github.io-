// Planos por km: tipos de plano (base, trecho ouro, urbano, escolas, evento, especial), áreas, situação de cada trecho e KMI.
import { el, toast, fmtData, fmtNum, fmtPct, hojeISO, somarDias, diasEntre, uid } from './util.js';
import { estado, registrar } from './store.js';
import { PARAM } from './dominio.js';
import { valor } from './parametros.js';
import { trechoNaArea } from './rede.js';
import { ErroRegra } from './acoes.js';

export const tiposPlano = () => valor('tiposPlano');
export const tipoPlano = (id) => tiposPlano().find((t) => t.id === id);
export const trechos = () => estado.dados.trechosInspecao || [];
export const trechoPorId = (id) => trechos().find((t) => t.id === id);
export const areas = () => estado.dados.areasPlano || [];

/** Área ativa numa data: eventos só valem entre (início − antecedência) e fim. */
export function areaAtiva(a, ref = hojeISO()) {
  if (a.tipoPlano !== 'EVENTO') return true;
  const ant = tipoPlano('EVENTO')?.periodicidadeDias || 30;
  return ref >= somarDias(a.inicio, -ant) && ref <= a.fim;
}

let cachePertenca = null, cacheChave = '';
/** Mapa trechoId → áreas que o contêm (cache invalidado quando áreas/trechos mudam). */
export function areasDoTrecho(trechoId) {
  const chave = `${areas().length}|${areas().map((a) => a.id).join(',')}|${trechos().length}`;
  if (chave !== cacheChave) {
    cachePertenca = new Map(trechos().map((t) => [t.id, areas().filter((a) => trechoNaArea(t, a))]));
    cacheChave = chave;
  }
  return cachePertenca.get(trechoId) || [];
}

export const inspecoesDoTrecho = (id) => (estado.dados.inspecoesTrecho || []).filter((i) => i.trechoId === id).sort((a, b) => b.fim.localeCompare(a.fim));
export const ultimaCompleta = (id, ate = '9999') => inspecoesDoTrecho(id).find((i) => i.completa && i.fim.slice(0, 10) <= ate) || null;

/** Exigência mais rígida que vale para o trecho: menor periodicidade entre o plano base e as áreas ativas. */
export function exigencia(trecho, ref = hojeISO()) {
  const base = tipoPlano('BASE');
  let req = { periodicidade: base?.periodicidadeDias || 180, plano: base?.nome || 'Plano base', tipo: 'BASE', limiteMinimo: null };
  for (const a of areasDoTrecho(trecho.id).filter((x) => areaAtiva(x, ref))) {
    const tp = tipoPlano(a.tipoPlano);
    if (!tp) continue;
    if (a.tipoPlano === 'EVENTO') {
      // Evento: precisa de inspeção completa feita depois de (início − antecedência).
      const desde = somarDias(a.inicio, -tp.periodicidadeDias);
      if (!req.limiteMinimo || desde > req.limiteMinimo) req = { ...req, limiteMinimo: desde, plano: `${tp.nome}: ${a.nome}`, tipo: 'EVENTO' };
    } else if (tp.periodicidadeDias < req.periodicidade) req = { ...req, periodicidade: tp.periodicidadeDias, plano: `${tp.nome}: ${a.nome}`, tipo: a.tipoPlano };
  }
  return req;
}

/** Situação do trecho: em dia, vence em breve (≤ 15 dias) ou vencido. */
export function situacaoTrecho(trecho, ref = hojeISO()) {
  const req = exigencia(trecho, ref);
  const ult = ultimaCompleta(trecho.id, ref);
  const venceEm = ult ? somarDias(ult.fim, req.periodicidade) : ref;
  const atendeEvento = !req.limiteMinimo || (ult && ult.fim.slice(0, 10) >= req.limiteMinimo);
  const emDia = !!ult && venceEm >= ref && atendeEvento;
  const id = !emDia ? 'vencido' : diasEntre(ref, venceEm) <= 15 ? 'vencendo' : 'emdia';
  return { id, emDia, venceEm: atendeEvento ? venceEm : ref, ultima: ult, exigencia: req };
}

/**
 * KMI por plano: km em dia ÷ km do plano (aderência), km inspecionados completos e km só patrulhados no mês.
 * Plano BASE = rede inteira; cada área ativa é um plano à parte.
 */
export function indicadoresKmi(ref = hojeISO()) {
  const mes = ref.slice(0, 7);
  const its = estado.dados.inspecoesTrecho || [];
  const calc = (lista, nome, tipo, area) => {
    const km = lista.reduce((t, x) => t + x.km, 0);
    const emDia = lista.filter((x) => situacaoTrecho(x, ref).emDia).reduce((t, x) => t + x.km, 0);
    const ids = new Set(lista.map((x) => x.id));
    const doMes = its.filter((i) => ids.has(i.trechoId) && i.fim.slice(0, 7) === mes);
    return { nome, tipo, area, trechos: lista.length, km, kmEmDia: emDia, aderencia: km ? emDia / km : 1,
      kmInspecionadoMes: doMes.filter((i) => i.completa).reduce((t, i) => t + i.km, 0),
      kmPatrulhadoMes: doMes.filter((i) => !i.completa).reduce((t, i) => t + i.km, 0) };
  };
  const out = [calc(trechos(), tipoPlano('BASE')?.nome || 'Plano base', 'BASE', null)];
  for (const a of areas().filter((x) => areaAtiva(x, ref))) out.push(calc(trechos().filter((t) => areasDoTrecho(t.id).includes(a)), `${tipoPlano(a.tipoPlano)?.nome}: ${a.nome}`, a.tipoPlano, a));
  return out;
}

/** Completude: inspeções completas ÷ realizadas (terrestre, drone e patrulha) nos últimos N dias. */
export function completude(dias = 90, ref = hojeISO()) {
  const desde = somarDias(ref, -dias);
  const r = (estado.dados.inspecoesTrecho || []).filter((i) => i.fim.slice(0, 10) >= desde && i.tipo !== 'PATRULHA');
  const pat = (estado.dados.inspecoesTrecho || []).filter((i) => i.fim.slice(0, 10) >= desde && i.tipo === 'PATRULHA');
  return { realizadas: r.length, completas: r.filter((i) => i.completa).length, pct: r.length ? r.filter((i) => i.completa).length / r.length : null,
    kmPatrulhado: pat.reduce((t, i) => t + i.km, 0), drone: r.filter((i) => i.tipo === 'DRONE').length };
}

// ---------- Cadastro de áreas ----------
export function criarArea({ tipoPlano: tp, nome, geometria, inicio, fim }) {
  if (!['GESTOR', 'ADMIN'].includes(estado.usuario.perfil)) throw new ErroRegra('Seu perfil não pode cadastrar planos.', 'PERMISSAO');
  if (!tipoPlano(tp) || tp === 'BASE') throw new ErroRegra('Escolha o tipo de plano.');
  if (!nome?.trim()) throw new ErroRegra('Dê um nome à área (ex.: nome da escola ou do evento).');
  if (tp === 'EVENTO' && (!inicio || !fim || fim < inicio)) throw new ErroRegra('Evento precisa de data de início e fim.');
  const a = { id: uid('AR'), tipoPlano: tp, nome: nome.trim().slice(0, 120), geometria, ...(tp === 'EVENTO' ? { inicio, fim } : {}), criadoEm: new Date().toISOString(), criadoPor: estado.usuario.id };
  const qtd = trechos().filter((t) => trechoNaArea(t, a)).length;
  if (!qtd) throw new ErroRegra('A área não alcança nenhum trecho da rede.');
  (estado.dados.areasPlano ||= []).push(a);
  registrar('AREA_PLANO_CRIADA', 'plano', a.id, { tipo: tp, nome: a.nome, trechos: qtd, geometria: geometria.tipo });
  return a;
}

export function removerArea(id) {
  if (!['GESTOR', 'ADMIN'].includes(estado.usuario.perfil)) throw new ErroRegra('Seu perfil não pode remover planos.', 'PERMISSAO');
  const i = areas().findIndex((a) => a.id === id);
  if (i < 0) return;
  const [a] = estado.dados.areasPlano.splice(i, 1);
  registrar('AREA_PLANO_REMOVIDA', 'plano', id, { nome: a.nome });
}

/** Seção da tela Plano: KMI por plano + áreas cadastradas + cadastro por seleção de trechos. */
export function secaoPlanosKm({ abrirTrechoNoMapa, desenharNoMapa }) {
  const ind = indicadoresKmi(), comp = completude();
  const podeEditar = ['GESTOR', 'ADMIN'].includes(estado.usuario.perfil);
  const linhas = ind.map((p) => el('tr', { class: p.aderencia < PARAM.metas.aderenciaPlano ? 'tr--alerta' : '' },
    el('td', { text: p.nome }), el('td', { text: fmtNum(p.trechos) }), el('td', { text: `${p.km.toFixed(1)} km` }), el('td', { text: `${p.kmEmDia.toFixed(1)} km` }),
    el('td', {}, el('strong', { text: fmtPct(p.aderencia) })), el('td', { text: `${p.kmInspecionadoMes.toFixed(1)} km` }), el('td', { text: `${p.kmPatrulhadoMes.toFixed(1)} km` })));
  const lista = el('ul', { class: 'lista' }, areas().map((a) => {
    const tp = tipoPlano(a.tipoPlano);
    const n = trechos().filter((t) => areasDoTrecho(t.id).includes(a)).length;
    return el('li', { class: 'lista__item' },
      el('div', {}, el('strong', { text: a.nome }), el('div', { class: 'pequeno muted', text: `${tp?.nome || a.tipoPlano} · ${n} trecho(s) · ${a.geometria.tipo === 'circulo' ? `raio ${a.geometria.raioM} m` : a.geometria.tipo}${a.tipoPlano === 'EVENTO' ? ` · ${fmtData(a.inicio)} a ${fmtData(a.fim)}${areaAtiva(a) ? '' : ' (inativo hoje)'}` : ''}` })),
      podeEditar ? el('button', { type: 'button', class: 'btn btn--txt', text: 'Remover', onclick: () => { if (confirm(`Remover o plano "${a.nome}"?`)) { try { removerArea(a.id); } catch (e) { toast(e.message, { tipo: 'erro' }); } } } }) : null);
  }));

  // Cadastro por seleção de trechos (útil para trecho ouro)
  const form = podeEditar ? (() => {
    const selTipo = el('select', { class: 'campo__input' }, tiposPlano().filter((t) => t.id !== 'BASE').map((t) => el('option', { value: t.id, text: t.nome })));
    const nome = el('input', { class: 'campo__input', maxlength: 120, placeholder: 'Ex.: Hospital X, Escola Y, Carnaval 2027' });
    const ini = el('input', { type: 'date', class: 'campo__input' }), fim = el('input', { type: 'date', class: 'campo__input' });
    const datas = el('div', { class: 'linha', hidden: true }, el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Início' }), ini), el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Fim' }), fim));
    selTipo.addEventListener('change', () => { datas.hidden = selTipo.value !== 'EVENTO'; });
    const marcados = new Set();
    const caixas = el('div', { class: 'trechos-sel' }, [...new Set(trechos().map((t) => t.alimentador))].map((alim) => el('fieldset', { class: 'checklist' }, el('legend', { text: alim }),
      trechos().filter((t) => t.alimentador === alim).map((t) => {
        const cb = el('input', { type: 'checkbox' });
        cb.addEventListener('change', () => { if (cb.checked) marcados.add(t.id); else marcados.delete(t.id); });
        return el('label', { class: 'campo--check' }, cb, el('span', { text: `${t.id} (${t.km.toFixed(2)} km)` }));
      }))));
    return el('details', { class: 'bloco-det' }, el('summary', { text: '＋ Cadastrar plano especial' }),
      el('div', { class: 'form' },
        el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Tipo de plano' }), selTipo),
        el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Nome' }), nome), datas,
        el('p', { class: 'muted pequeno', text: 'Escolha os trechos abaixo, ou desenhe a área no mapa (polígono para área urbana/evento; um ponto vira círculo, ideal para escola).' }),
        el('div', { class: 'linha' },
          el('button', { type: 'button', class: 'btn btn--sec', text: '✏️ Desenhar no mapa', onclick: () => desenharNoMapa({ tipoPlano: selTipo.value, nome: nome.value, inicio: ini.value, fim: fim.value }) })),
        caixas,
        el('button', { type: 'button', class: 'btn', text: 'Salvar plano com os trechos marcados', onclick: () => {
          try { criarArea({ tipoPlano: selTipo.value, nome: nome.value, geometria: { tipo: 'trechos', ids: [...marcados] }, inicio: ini.value, fim: fim.value }); toast('Plano cadastrado.', { tipo: 'ok' }); } catch (e) { toast(e.message, { tipo: 'erro' }); }
        } })));
  })() : null;

  const vencidos = trechos().map((t) => ({ t, s: situacaoTrecho(t) })).filter((x) => x.s.id !== 'emdia').sort((a, b) => a.s.venceEm.localeCompare(b.s.venceEm));
  return el('section', { class: 'bloco' }, el('h2', { text: 'Plano por km (KMI)' }),
    el('p', { class: 'muted pequeno', text: `Aderência = km com inspeção completa dentro da periodicidade ÷ km do plano. Completa = cobertura ≥ ${PARAM.coberturaMinPct}% do trecho + checklist + foto. Patrulha parcial não conta. Inspeções completas nos últimos 90 dias: ${comp.pct === null ? '—' : fmtPct(comp.pct)} (${comp.completas}/${comp.realizadas}, ${comp.drone} por drone).` }),
    el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['Plano', 'Trechos', 'Extensão', 'Em dia', 'Aderência', 'Inspecionado no mês', 'Só patrulhado no mês'].map((h) => el('th', { text: h })))),
      el('tbody', {}, linhas))),
    el('h3', { text: `Trechos vencidos ou vencendo em 15 dias (${vencidos.length})` }),
    el('ul', { class: 'lista' }, vencidos.slice(0, 30).map(({ t, s }) => el('li', { class: 'lista__item pequeno' },
      el('button', { type: 'button', class: 'btn btn--txt', text: `${t.id} · ${t.km.toFixed(2)} km`, onclick: () => abrirTrechoNoMapa(t.id) }),
      el('span', { class: s.id === 'vencido' ? 'txt-alerta' : 'muted', text: `${s.id === 'vencido' ? 'Vencido' : `Vence ${fmtData(s.venceEm)}`} · ${s.exigencia.plano}` })))),
    el('h3', { text: `Planos especiais (${areas().length})` }), lista, form);
}
