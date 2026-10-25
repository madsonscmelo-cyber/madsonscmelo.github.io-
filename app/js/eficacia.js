// Eficácia: cada ocorrência (desarme) com causa evitável é atribuída a UMA etapa que falhou —
// Plano (trecho não inspecionado em dia), Inspeção (inspecionou e não viu), Programação (defeito visto e não executado)
// ou Manutenção (executado e falhou de novo pela mesma causa). Causas não evitáveis ficam fora da conta.
import { el, toast, fmtData, fmtDataHora, fmtNum, fmtPct, hojeISO, somarDias, diasEntre, csvParse, uid, distanciaM } from './util.js';
import { estado, registrar } from './store.js';
import { PARAM, tipoDefeito, CATEGORIAS } from './dominio.js';
import { valor } from './parametros.js';
import { distanciaAteLinha } from './rede.js';
import { trechos, situacaoTrecho, ultimaCompleta } from './planos.js';
import { AREA_CONCESSAO } from './seed.js';
import { ErroRegra } from './acoes.js';

export const PORTOES = {
  PLANO: { nome: 'Plano', desc: 'Trecho não estava inspecionado em dia', acao: 'Capacidade / priorização do plano' },
  INSPECAO: { nome: 'Inspeção', desc: 'Inspecionado, defeito não registrado', acao: 'Qualidade da inspeção / treinamento / drone' },
  PROGRAMACAO: { nome: 'Programação', desc: 'Defeito registrado e não executado', acao: 'Carteira, material, desligamento' },
  MANUTENCAO: { nome: 'Manutenção', desc: 'Executado e desarmou pela mesma causa', acao: 'Qualidade do serviço' },
  EXCLUIDA: { nome: 'Não evitável', desc: 'Causa fora do alcance da manutenção', acao: '—' },
  SEM_LOCAL: { nome: 'Sem localização', desc: 'Longe de qualquer trecho da rede', acao: 'Revisar coordenada no OMS' },
  SEM_CAUSA: { nome: 'Causa desconhecida', desc: 'Código de causa fora da tabela', acao: 'Revisar tabela de causas' },
};

export const causas = () => valor('causas');
const categoriaDoDefeito = (f) => tipoDefeito(f.tipoId)?.categoria;

export function atribuir(oc) {
  const causa = causas().find((c) => c.codigo === oc.causa);
  if (!causa) return { portao: 'SEM_CAUSA' };
  if (!causa.evitavel) return { portao: 'EXCLUIDA', causa };
  const data = oc.dataHora.slice(0, 10), p = [oc.lat, oc.lon], raio = PARAM.raioAtribuicaoM;
  const tr = trechos().map((t) => ({ t, d: distanciaAteLinha(p, t.coords) })).filter((x) => x.d <= raio).sort((a, b) => a.d - b.d)[0]?.t || null;
  const ativos = new Set(estado.dados.ativos.filter((a) => distanciaM(p[0], p[1], a.lat, a.lon) <= raio).map((a) => a.id));
  if (!tr && !ativos.size) return { portao: 'SEM_LOCAL', causa };
  const defs = estado.dados.defeitos.filter((f) => ativos.has(f.ativoId) && categoriaDoDefeito(f) === causa.atividade
    && f.criadoEm.slice(0, 10) <= data && !['REJEITADO', 'CANCELADO'].includes(f.status));
  const exec = defs.filter((f) => f.execucao && f.execucao.em.slice(0, 10) <= data && diasEntre(f.execucao.em, data) <= causa.janelaDias)
    .sort((a, b) => b.execucao.em.localeCompare(a.execucao.em))[0];
  if (exec) return { portao: 'MANUTENCAO', causa, trechoId: tr?.id, defeitoId: exec.id, obs: `executado ${fmtData(exec.execucao.em)}` };
  const aberto = defs.find((f) => !f.execucao || f.execucao.em.slice(0, 10) > data);
  if (aberto) return { portao: 'PROGRAMACAO', causa, trechoId: tr?.id, defeitoId: aberto.id, obs: `aberto há ${diasEntre(aberto.criadoEm, data)} dia(s)${diasEntre(aberto.criadoEm, data) > PARAM.sla[aberto.severidade] ? ' (fora do prazo)' : ''}` };
  if (tr) {
    const sit = situacaoTrecho(tr, data);
    if (!sit.emDia) return { portao: 'PLANO', causa, trechoId: tr.id, obs: sit.ultima ? `última inspeção ${fmtData(sit.ultima.fim)}` : 'nunca inspecionado' };
    const ult = ultimaCompleta(tr.id, data);
    if (ult && diasEntre(ult.fim, data) <= causa.janelaDias) return { portao: 'INSPECAO', causa, trechoId: tr.id, inspecaoId: ult.id, obs: `inspecionado ${fmtData(ult.fim)} sem defeito de ${(CATEGORIAS[causa.atividade] || '').toLowerCase()}` };
    return { portao: 'PLANO', causa, trechoId: tr.id, obs: `periodicidade do plano (${sit.exigencia.periodicidade} d) maior que a janela da causa (${causa.janelaDias} d)` };
  }
  return { portao: 'INSPECAO', causa, obs: 'ativo próximo sem defeito registrado' };
}

/** Indicadores dos últimos N dias. */
export function indicadoresEficacia(dias = 180, ref = hojeISO()) {
  const desde = somarDias(ref, -dias);
  const ocs = (estado.dados.ocorrencias || []).filter((o) => o.dataHora.slice(0, 10) >= desde && o.dataHora.slice(0, 10) <= ref).map((o) => ({ ...o, at: atribuir(o) }));
  const porPortao = Object.fromEntries(Object.keys(PORTOES).map((k) => [k, { qtd: 0, chi: 0 }]));
  ocs.forEach((o) => { porPortao[o.at.portao].qtd++; porPortao[o.at.portao].chi += o.chi || 0; });
  const insp = (estado.dados.inspecoesTrecho || []).filter((i) => i.completa && i.fim.slice(0, 10) >= desde);
  const baseInsp = new Set(insp.map((i) => i.trechoId)).size;
  const falhaInsp = new Set(ocs.filter((o) => o.at.portao === 'INSPECAO').map((o) => o.at.trechoId || o.id)).size;
  const execs = estado.dados.defeitos.filter((f) => f.execucao && f.execucao.em.slice(0, 10) >= desde);
  const falhaMan = new Set(ocs.filter((o) => o.at.portao === 'MANUTENCAO').map((o) => o.at.defeitoId)).size;
  const base = baseInsp + execs.length, falhas = falhaInsp + falhaMan;
  const naoId = ocs.filter((o) => o.causa === 'NID').length;
  return {
    dias, ocorrencias: ocs, porPortao,
    eficInspecao: baseInsp ? 1 - falhaInsp / baseInsp : null, baseInsp, falhaInsp,
    eficManutencao: execs.length ? 1 - falhaMan / execs.length : null, baseMan: execs.length, falhaMan,
    eficacia: base ? 1 - falhas / base : null,
    evitaveis: ocs.filter((o) => !['EXCLUIDA', 'SEM_CAUSA'].includes(o.at.portao)).length,
    pctSemCausa: ocs.length ? (naoId + porPortao.SEM_CAUSA.qtd) / ocs.length : 0,
  };
}

// ---------- Importação (CSV do OMS) ----------
function dataHora(v) {
  const s = String(v || '').trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}T${br[4] || '00'}:${br[5] || '00'}:00` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function importarOcorrencias(texto, arquivo) {
  if (!['GESTOR', 'ADMIN'].includes(estado.usuario.perfil)) throw new ErroRegra('Seu perfil não pode importar ocorrências.', 'PERMISSAO');
  const linhas = csvParse(texto);
  if (linhas.length < 2) throw new ErroRegra('Arquivo vazio.');
  if (linhas.length > 50001) throw new ErroRegra('Limite de 50.000 linhas.');
  const cab = linhas[0].map((c) => c.trim().toLowerCase());
  const col = (n) => cab.indexOf(n);
  const obrig = ['data_hora', 'latitude', 'longitude', 'causa'];
  const faltam = obrig.filter((c) => col(c) < 0);
  if (faltam.length) throw new ErroRegra(`Colunas obrigatórias ausentes: ${faltam.join(', ')}`);
  const codigos = new Set(causas().map((c) => c.codigo));
  const existentes = new Set((estado.dados.ocorrencias || []).map((o) => `${o.dataHora}|${o.lat.toFixed(5)}|${o.lon.toFixed(5)}`));
  const rejeitadas = [];
  let aceitas = 0;
  const num = (v) => Number(String(v ?? '').trim().replace(',', '.'));
  linhas.slice(1).forEach((l, i) => {
    const v = (c) => (col(c) < 0 ? '' : String(l[col(c)] ?? '').trim());
    const dh = dataHora(v('data_hora')), lat = num(v('latitude')), lon = num(v('longitude')), causa = v('causa').toUpperCase();
    const erro = (motivo) => rejeitadas.push({ linha: i + 2, motivo });
    if (!dh) return erro('Data/hora inválida');
    if (dh.slice(0, 10) > hojeISO()) return erro('Data no futuro');
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < AREA_CONCESSAO.latMin || lat > AREA_CONCESSAO.latMax || lon < AREA_CONCESSAO.lonMin || lon > AREA_CONCESSAO.lonMax) return erro('Coordenada inválida ou fora da área');
    if (!codigos.has(causa)) return erro(`Causa fora da tabela: ${causa || '(vazia)'}`);
    const chave = `${dh}|${lat.toFixed(5)}|${lon.toFixed(5)}`;
    if (existentes.has(chave)) return erro('Ocorrência já importada');
    existentes.add(chave);
    (estado.dados.ocorrencias ||= []).push({ id: uid('oc'), dataHora: dh, alimentador: v('alimentador') || '—', lat, lon, causa, ucs: num(v('ucs')) || 0, chi: num(v('chi')) || 0, origem: arquivo });
    aceitas++;
  });
  registrar('OCORRENCIAS_IMPORTADAS', 'ocorrencia', null, { arquivo, aceitas, rejeitadas: rejeitadas.length });
  return { aceitas, rejeitadas };
}

// ---------- Telas ----------
const kpi = (r, v, det, c = '') => el('div', { class: `kpi ${c}` }, el('span', { class: 'kpi__rotulo', text: r }), el('strong', { class: 'kpi__valor', text: v }), el('span', { class: 'kpi__det', text: det }));

/** Funil do Painel: plano → inspeção → programação → eficácia, e onde cada desarme evitável falhou. */
export function secaoFunil({ kmi, completude, aderenciaProg }) {
  const ef = indicadoresEficacia();
  const meta = PARAM.metas;
  const etapas = ['PLANO', 'INSPECAO', 'PROGRAMACAO', 'MANUTENCAO'];
  const max = Math.max(1, ...etapas.map((k) => ef.porPortao[k].qtd));
  return el('section', { class: 'bloco funil' }, el('h2', { text: 'Funil da manutenção (últimos 180 dias)' }),
    el('div', { class: 'kpis' },
      kpi('1 · Aderência ao plano (KMI)', fmtPct(kmi.aderencia), `${kmi.kmEmDia.toFixed(1)} de ${kmi.km.toFixed(1)} km em dia · meta ${fmtPct(meta.aderenciaPlano)}`, kmi.aderencia < meta.aderenciaPlano ? 'kpi--alerta' : ''),
      kpi('2 · Inspeções completas', completude.pct === null ? '—' : fmtPct(completude.pct), `${completude.completas}/${completude.realizadas} em 90 dias · ${completude.kmPatrulhado.toFixed(1)} km só patrulhados`, completude.pct !== null && completude.pct < meta.completude ? 'kpi--alerta' : ''),
      kpi('3 · Aderência da programação', aderenciaProg === null ? '—' : fmtPct(aderenciaProg), `semanas congeladas · meta ${fmtPct(meta.aderenciaProgramacao)}`, aderenciaProg !== null && aderenciaProg < meta.aderenciaProgramacao ? 'kpi--alerta' : ''),
      kpi('4 · Eficácia', ef.eficacia === null ? '—' : fmtPct(ef.eficacia), `inspeção ${ef.eficInspecao === null ? '—' : fmtPct(ef.eficInspecao)} · manutenção ${ef.eficManutencao === null ? '—' : fmtPct(ef.eficManutencao)} · meta ${fmtPct(meta.eficacia)}`, ef.eficacia !== null && ef.eficacia < meta.eficacia ? 'kpi--critico' : '')),
    el('h3', { text: `Onde os desarmes evitáveis falharam (${ef.evitaveis} de ${ef.ocorrencias.length} ocorrências)` }),
    el('div', { class: 'barras' }, etapas.map((k) => {
      const preench = el('span', { class: 'barras__preench alerta' });
      preench.style.width = `${Math.max(2, (ef.porPortao[k].qtd / max) * 100)}%`;
      return el('div', { class: 'barras__linha', title: `${PORTOES[k].desc} → ${PORTOES[k].acao}` }, el('span', { class: 'barras__rot', text: `${PORTOES[k].nome} — ${PORTOES[k].acao}` }),
        el('span', { class: 'barras__trilho' }, preench), el('span', { class: 'barras__val', text: `${ef.porPortao[k].qtd} · ${fmtNum(ef.porPortao[k].chi)} CHI` }));
    })),
    el('p', { class: `pequeno ${ef.pctSemCausa > 0.15 ? 'txt-alerta' : 'muted'}`, text: `Fora da conta: ${ef.porPortao.EXCLUIDA.qtd} não evitáveis · ${ef.porPortao.SEM_LOCAL.qtd} sem localização. Causa não identificada: ${fmtPct(ef.pctSemCausa)} das ocorrências${ef.pctSemCausa > 0.15 ? ' — qualidade do código de causa compromete a eficácia' : ''}.` }),
    el('details', { class: 'bloco-det' }, el('summary', { text: 'Ver ocorrências e a etapa atribuída' }),
      el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Quando', 'Alimentador', 'Causa', 'Etapa que falhou', 'Detalhe', 'CHI'].map((h) => el('th', { text: h })))),
        el('tbody', {}, ef.ocorrencias.sort((a, b) => b.dataHora.localeCompare(a.dataHora)).map((o) => el('tr', {},
          el('td', { text: fmtDataHora(o.dataHora) }), el('td', { text: o.alimentador }), el('td', { text: o.at.causa?.nome || o.causa }),
          el('td', {}, el('span', { class: `chip chip--portao-${o.at.portao.toLowerCase()}`, text: PORTOES[o.at.portao].nome })),
          el('td', { class: 'pequeno', text: [o.at.trechoId, o.at.obs].filter(Boolean).join(' · ') }), el('td', { text: fmtNum(o.chi) }))))))));
}

/** Seção da tela Plano: importar ocorrências do OMS. */
export function secaoOcorrencias() {
  const pode = ['GESTOR', 'ADMIN'].includes(estado.usuario.perfil);
  const inp = el('input', { type: 'file', accept: '.csv,text/csv', class: 'oculto' });
  inp.addEventListener('change', async () => {
    const f = inp.files[0];
    inp.value = '';
    if (!f || f.size > 10 * 1024 * 1024) { toast('Arquivo ausente ou maior que 10 MB.', { tipo: 'erro' }); return; }
    try {
      const r = importarOcorrencias(await f.text(), f.name);
      toast(`Ocorrências: ${r.aceitas} importadas, ${r.rejeitadas.length} rejeitadas${r.rejeitadas.length ? ` (ex.: linha ${r.rejeitadas[0].linha} — ${r.rejeitadas[0].motivo})` : ''}.`, { tipo: r.rejeitadas.length ? 'aviso' : 'ok', duracao: 8000 });
    } catch (e) { toast(e.message, { tipo: 'erro' }); }
  });
  const total = (estado.dados.ocorrencias || []).length;
  return el('section', { class: 'bloco' }, el('h2', { text: 'Ocorrências (OMS)' }),
    el('p', { class: 'muted', text: `${total} ocorrência(s) carregada(s). Cada desarme com causa evitável é atribuído à etapa que falhou (plano, inspeção, programação ou manutenção) — ver o funil no Painel. A tabela de causas fica em Parâmetros.` }),
    el('div', { class: 'linha' },
      pode ? el('button', { type: 'button', class: 'btn', text: '⬆ Importar ocorrências (CSV)', onclick: () => inp.click() }) : null,
      el('a', { class: 'btn btn--txt', href: 'modelos/template-ocorrencias.csv', download: 'template-ocorrencias.csv', text: 'Modelo do CSV' }), inp));
}
