// Painel lateral (bottom sheet no celular): ficha do ativo, formulários de inspeção, defeito e execução.
import { el, $, toast, fmtData, fmtMoeda, fmtNum, diasEntre, hojeISO, distanciaM } from './util.js';
import { estado, ativoPorId, equipeDoUsuario, nomeEquipe, nomeUsuario } from './store.js';
import {
  TIPOS_ATIVO, criterio, CONJUNTOS, tipoDefeito, tiposDefeitoPara, SEVERIDADES, STATUS_DEFEITO,
  STATUS_ABERTOS, TIPOS_EQUIPE, scoreRisco, faixaRisco, estadoAtivo, podeTransicionar, equipesAptas, RAIO_VALIDACAO_M,
} from './dominio.js';
import { concluirInspecao, transicionar, atribuirInspecao, ErroRegra } from './acoes.js';
import { campoFotos, galeria } from './fotos.js';

// ---------- Sheet ----------
let atual = null; // { tipo: 'ativo'|'area'|'form', id }
export const sheetAtual = () => atual;

export function abrirSheet(titulo, corpo, contexto = { tipo: 'form' }) {
  atual = contexto;
  const s = $('#sheet');
  $('#sheet-titulo').textContent = titulo;
  $('#sheet-corpo').replaceChildren(corpo);
  s.hidden = false;
  s.classList.add('sheet--aberto');
  $('#sheet-corpo').scrollTop = 0;
}
export function fecharSheet() {
  atual = null;
  const s = $('#sheet');
  s.classList.remove('sheet--aberto');
  s.hidden = true;
  document.dispatchEvent(new CustomEvent('sheet-fechado'));
}

const pode = (...perfis) => perfis.includes(estado.usuario.perfil);

function tratar(fn) {
  try { fn(); return true; } catch (e) {
    if (e instanceof ErroRegra) toast(e.message, { tipo: 'erro' });
    else { console.error(e); toast('Erro inesperado. Veja o console.', { tipo: 'erro' }); }
    return false;
  }
}

// ---------- Geovalidação (RF-INS-07) ----------
export function validarGeo(alvos) {
  const p = estado.posicao;
  if (!p) return { temPosicao: false, dentroDoRaio: false, distanciaM: null };
  const dist = Math.min(...alvos.map((a) => distanciaM(p.lat, p.lon, a.lat, a.lon)));
  return { temPosicao: true, dentroDoRaio: dist <= RAIO_VALIDACAO_M, distanciaM: Math.round(dist), simulada: !!p.simulada, lat: p.lat, lon: p.lon };
}

function blocoGeo(alvos, exigeJustificativa) {
  const info = el('div', { class: 'geo' });
  const just = el('textarea', { class: 'campo__input', rows: 2, placeholder: 'Justificativa (obrigatória)', maxlength: 500 });
  const wrapJust = el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Justificativa' }), just);
  const atualizar = () => {
    const g = validarGeo(alvos);
    info.className = `geo ${g.dentroDoRaio ? 'geo--ok' : 'geo--alerta'}`;
    info.textContent = !g.temPosicao
      ? 'Sem posição: ative o GPS ou simule a posição no mapa.'
      : g.dentroDoRaio
        ? `Posição validada: ${g.distanciaM} m do ativo${g.simulada ? ' (simulada)' : ''}.`
        : `Você está a ${g.distanciaM} m do ativo (limite ${RAIO_VALIDACAO_M} m).`;
    wrapJust.hidden = g.dentroDoRaio && !exigeJustificativa;
    return g;
  };
  atualizar();
  const timer = setInterval(() => { if (!info.isConnected) clearInterval(timer); else atualizar(); }, 3000);
  return { elemento: el('div', {}, info, wrapJust), geo: atualizar, justificativa: () => just.value };
}

// ---------- Componentes ----------
function chip(texto, classe = '') { return el('span', { class: `chip ${classe}`, text: texto }); }

function linhaMeta(rotulo, valor) {
  return el('div', { class: 'meta__item' }, el('span', { class: 'meta__rotulo', text: rotulo }), el('span', { class: 'meta__valor', text: valor }));
}

function selectDe(opcoes, valor, attrs = {}) {
  const s = el('select', { class: 'campo__input', ...attrs });
  for (const [v, t] of opcoes) s.append(el('option', { value: v, text: t, selected: v === valor }));
  return s;
}

function acaoComTexto(rotulo, placeholder, aoConfirmar, classe = 'btn--sec') {
  const caixa = el('div', { class: 'acao-texto' });
  const btn = el('button', {
    type: 'button', class: `btn ${classe}`, text: rotulo, onclick: () => {
      const inp = el('input', { class: 'campo__input', placeholder, maxlength: 300 });
      caixa.replaceChildren(inp, el('button', { type: 'button', class: `btn ${classe}`, text: 'Confirmar', onclick: () => aoConfirmar(inp.value) }),
        el('button', { type: 'button', class: 'btn btn--txt', text: 'Cancelar', onclick: () => caixa.replaceChildren(btn) }));
      inp.focus();
    },
  });
  caixa.append(btn);
  return caixa;
}

export function cartaoDefeito(f, { comAtivo = false, aoAbrirAtivo } = {}) {
  const d = estado.dados, a = ativoPorId(f.ativoId), td = tipoDefeito(f.tipoId);
  const sc = scoreRisco(f, a), fx = faixaRisco(sc.total);
  const idade = diasEntre(f.criadoEm, hojeISO());
  const card = el('article', { class: `card-def card-def--${fx.id}` });
  card.append(
    el('div', { class: 'card-def__topo' },
      el('span', { class: `score score--${fx.id}`, text: sc.total, title: `Risco ${fx.nome}` }),
      el('div', { class: 'card-def__tit' },
        el('strong', { text: td?.nome || f.tipoId }),
        el('span', { class: 'muted', text: `${comAtivo ? `${a?.codigo} · ${a?.alimentador} · ` : ''}Sev. ${f.severidade} · ${idade} dia(s)` })),
      chip(STATUS_DEFEITO[f.status], `chip--st-${f.status.toLowerCase()}`)),
    el('div', { class: 'card-def__score muted', text: `Severidade ${sc.partes.severidade} · Clientes ${sc.partes.clientes} · DEC/FEC ${sc.partes.continuidade} · Compensação ${sc.partes.compensacao} · Reincidência ${sc.partes.reincidencia}` }),
  );
  if (f.descricao) card.append(el('p', { class: 'card-def__desc', text: f.descricao }));
  const info = [`Exige: ${td?.equipes.map((t) => TIPOS_EQUIPE[t]).join(' / ')}`];
  if (f.equipeId) info.push(`Programado: ${nomeEquipe(f.equipeId)}`);
  if (f.execucao) info.push(`Executado por ${nomeEquipe(f.execucao.equipeId)}${f.execucao.naHora ? ' (na hora)' : ''}`);
  card.append(el('div', { class: 'muted pequeno', text: info.join(' · ') }));

  const fotosBox = el('div');
  card.append(el('button', {
    type: 'button', class: 'btn btn--txt', text: 'Ver fotos e histórico', onclick: (ev) => {
      ev.currentTarget.remove();
      fotosBox.append(
        el('div', { class: 'pequeno', text: 'Identificação' }), galeria(f.fotos),
        ...(f.execucao ? [el('div', { class: 'pequeno', text: 'Execução' }), galeria(f.execucao.fotos)] : []),
        el('ol', { class: 'historico' }, f.historico.map((h) => el('li', { text: `${fmtData(h.em)} — ${STATUS_DEFEITO[h.status]} — ${nomeUsuario(h.por)}${h.obs ? ` (${h.obs})` : ''}` }))),
      );
    },
  }), fotosBox);

  const acoes = el('div', { class: 'card-def__acoes' });
  const u = estado.usuario;
  const exec = (para, extra) => tratar(() => { transicionar(f, para, extra); toast(`Defeito: ${STATUS_DEFEITO[para]}`, { tipo: 'ok' }); });
  if (podeTransicionar(u, f, 'VALIDADO')) {
    const sev = selectDe(Object.entries(SEVERIDADES), f.severidade);
    acoes.append(sev, el('button', { type: 'button', class: 'btn', text: 'Validar', onclick: () => exec('VALIDADO', { severidade: sev.value }) }));
  }
  if (podeTransicionar(u, f, 'REJEITADO')) acoes.append(acaoComTexto('Rejeitar', 'Motivo da rejeição', (j) => exec('REJEITADO', { justificativa: j })));
  if (podeTransicionar(u, f, 'PROGRAMADO') && f.status !== 'EXECUTADO') {
    const aptas = equipesAptas(d, f);
    const sel = selectDe(aptas.map((e) => [e.id, `${e.nome}${e.disponivel ? '' : ' (indisponível)'}`]), f.equipeId || aptas.find((e) => e.disponivel)?.id);
    acoes.append(sel, el('button', { type: 'button', class: 'btn', text: f.status === 'PROGRAMADO' ? 'Reprogramar' : 'Programar', onclick: () => exec('PROGRAMADO', { equipeId: sel.value }) }));
  }
  if (podeTransicionar(u, f, 'EXECUTADO')) acoes.append(el('button', { type: 'button', class: 'btn', text: 'Registrar execução', onclick: () => abrirExecucao(f) }));
  if (podeTransicionar(u, f, 'VERIFICADO')) {
    acoes.append(el('button', { type: 'button', class: 'btn btn--ok', text: 'Verificar e fechar', onclick: () => exec('VERIFICADO') }));
    const aptas = equipesAptas(d, f).map((e) => e.id);
    const retorno = [f.equipeId, f.execucao?.equipeId].find((x) => aptas.includes(x)) || aptas[0];
    acoes.append(acaoComTexto('Devolver', 'Motivo da devolução', (j) => exec('PROGRAMADO', { equipeId: retorno, justificativa: j })));
  }
  if (podeTransicionar(u, f, 'CANCELADO')) acoes.append(acaoComTexto('Cancelar', 'Justificativa do cancelamento', (j) => exec('CANCELADO', { justificativa: j }), 'btn--txt'));
  if (comAtivo && aoAbrirAtivo) acoes.append(el('button', { type: 'button', class: 'btn btn--txt', text: 'Ver no mapa', onclick: () => aoAbrirAtivo(a.id) }));
  if (acoes.childElementCount) card.append(acoes);
  return card;
}

// ---------- Ficha do ativo ----------
export function abrirAtivo(id) {
  const d = estado.dados, a = ativoPorId(id);
  if (!a) return;
  const est = estadoAtivo(d, id);
  const cj = CONJUNTOS[a.conjunto];
  const corpo = el('div', { class: 'ficha' });
  corpo.append(
    el('div', { class: 'ficha__estado' }, chip(est.nome, `chip--${est.id}`), a.avulso ? chip('Fora do plano') : null),
    el('div', { class: 'meta' },
      linhaMeta('Alimentador', a.alimentador),
      linhaMeta('Conjunto', cj ? `${a.conjunto} · DEC ${cj.decApurado} / meta ${cj.decMeta}` : a.conjunto),
      linhaMeta('UCs a jusante', fmtNum(a.ucs)),
      linhaMeta('Compensação 12m', fmtMoeda(a.comp12m)),
      linhaMeta('Falhas 12m', String(a.falhas12m)),
      linhaMeta('Critérios', a.criterios.length ? a.criterios.map((c) => criterio(c)?.nome).join(', ') : '—')),
  );

  const pend = d.inspecoes.filter((i) => i.ativoId === id && i.status !== 'CONCLUIDA');
  const acoes = el('div', { class: 'ficha__acoes' },
    el('a', { class: 'btn btn--sec', href: `https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lon}`, target: '_blank', rel: 'noopener noreferrer', text: '🧭 Rota até aqui' }));
  if (pend.length) acoes.append(el('button', { type: 'button', class: 'btn', text: `Inspecionar (${pend.length})`, onclick: () => abrirFormInspecao({ ativos: [a], inspecoes: pend }) }));
  acoes.append(el('button', { type: 'button', class: 'btn btn--sec', text: 'Inspeção avulsa / defeito', onclick: () => abrirFormInspecao({ ativos: [a], inspecoes: [], avulsa: true }) }));
  corpo.append(acoes);

  if (pend.length) {
    corpo.append(el('h3', { text: 'Inspeções programadas' }));
    const lista = el('ul', { class: 'lista' });
    for (const i of pend) {
      const venc = i.prazo < hojeISO();
      const li = el('li', { class: 'lista__item' },
        el('div', {}, el('strong', { text: criterio(i.criterioId)?.nome || 'Avulsa' }),
          el('div', { class: `pequeno ${venc ? 'txt-alerta' : 'muted'}`, text: `Prazo ${fmtData(i.prazo)}${venc ? ' · VENCIDA' : ''} · ${i.equipeId ? nomeEquipe(i.equipeId) : 'sem equipe'}` })));
      if (pode('GESTOR', 'SUPERVISOR')) {
        const sel = selectDe([['', 'Sem equipe'], ...d.equipes.filter((e) => e.tipo === 'INSPECAO').map((e) => [e.id, e.nome])], i.equipeId || '');
        sel.addEventListener('change', () => tratar(() => atribuirInspecao(i.id, sel.value)));
        li.append(sel);
      }
      lista.append(li);
    }
    corpo.append(lista);
  }

  const defs = d.defeitos.filter((f) => f.ativoId === id).sort((x, y) => (STATUS_ABERTOS.includes(y.status) - STATUS_ABERTOS.includes(x.status)) || y.criadoEm.localeCompare(x.criadoEm));
  corpo.append(el('h3', { text: `Defeitos (${defs.length})` }));
  if (!defs.length) corpo.append(el('p', { class: 'muted', text: 'Nenhum defeito registrado.' }));
  defs.forEach((f) => corpo.append(cartaoDefeito(f)));

  const hist = d.inspecoes.filter((i) => i.ativoId === id && i.status === 'CONCLUIDA').sort((x, y) => y.concluidaEm.localeCompare(x.concluidaEm)).slice(0, 5);
  if (hist.length) {
    corpo.append(el('h3', { text: 'Últimas inspeções' }),
      el('ul', { class: 'lista' }, hist.map((i) => el('li', { class: 'lista__item pequeno', text: `${fmtData(i.concluidaEm)} · ${i.tipo === 'AVULSA' ? 'Avulsa' : criterio(i.criterioId)?.nome} · ${nomeEquipe(i.equipeId)} · ${i.resultado === 'COM_DEFEITO' ? 'com defeito' : 'sem anomalia'}${i.geo && !i.geo.dentroDoRaio ? ' · fora do raio' : ''}` }))));
  }
  abrirSheet(`${TIPOS_ATIVO[a.tipo]} ${a.codigo}`, corpo, { tipo: 'ativo', id });
}

// ---------- Formulário de inspeção (programada, em lote ou avulsa) ----------
const CHECKLIST = {
  POSTE: ['Poste/estrutura íntegro', 'Cruzeta e ferragens', 'Isoladores', 'Condutores e conexões', 'Vegetação afastada da rede', 'Aterramento e estai'],
  RELIGADOR: ['Estrutura e fixação', 'Isoladores e buchas', 'Conexões', 'Painel/sinalização', 'Vegetação afastada da rede'],
  TRAFO: ['Tanque sem vazamento de óleo', 'Buchas e para-raios', 'Conexões MT/BT', 'Aterramento', 'Sem sinais de sobrecarga/aquecimento'],
  CHAVE_FUSIVEL: ['Porta-fusível e elo adequado', 'Contatos sem oxidação', 'Isoladores', 'Fixação na cruzeta'],
};

export function abrirFormInspecao({ ativos, inspecoes, avulsa = false }) {
  const eq = equipeDoUsuario();
  const form = el('form', { class: 'form', novalidate: true });
  const tipos = [...new Set(ativos.map((a) => a.tipo))];
  form.append(el('p', { class: 'muted', text: avulsa
    ? 'Inspeção avulsa: fora da programação do plano. Justificativa obrigatória.'
    : `${inspecoes.length} inspeção(ões) programada(s): ${[...new Set(inspecoes.map((i) => criterio(i.criterioId)?.nome))].join(', ')}` }));

  // Checklist
  const respostas = {};
  const ck = el('fieldset', { class: 'checklist' }, el('legend', { text: ativos.length > 1 ? `Checklist (aplica-se aos ${ativos.length} ativos)` : 'Checklist' }));
  for (const t of tipos) for (const item of CHECKLIST[t]) {
    const chave = `${t}:${item}`;
    respostas[chave] = 'C';
    const s = selectDe([['C', 'Conforme'], ['NC', 'Não conforme'], ['NA', 'N/A']], 'C', { 'aria-label': item });
    s.addEventListener('change', () => { respostas[chave] = s.value; s.classList.toggle('nc', s.value === 'NC'); });
    ck.append(el('label', { class: 'checklist__item' }, el('span', { text: tipos.length > 1 ? `${TIPOS_ATIVO[t]}: ${item}` : item }), s));
  }
  form.append(ck);

  // Defeitos encontrados
  const defeitos = [];
  const listaDef = el('div', { class: 'def-lista' });
  const renderLista = () => listaDef.replaceChildren(...defeitos.map((f, i) => el('div', { class: 'def-chip' },
    el('span', { text: `${tipoDefeito(f.tipoId).nome} · Sev. ${f.severidade}${f.resolvido ? ' · resolvido na hora' : ''}${ativos.length > 1 ? ` · ${ativoPorId(f.ativoId).codigo}` : ''}` }),
    el('button', { type: 'button', class: 'btn btn--txt', text: 'remover', onclick: () => { defeitos.splice(i, 1); renderLista(); } }))));
  const areaNovo = el('div');
  const btnNovo = el('button', { type: 'button', class: 'btn btn--sec', text: '＋ Adicionar defeito / manutenção', onclick: () => abrirNovoDefeito() });

  function abrirNovoDefeito() {
    btnNovo.hidden = true;
    const selAtivo = selectDe(ativos.map((a) => [a.id, `${TIPOS_ATIVO[a.tipo]} ${a.codigo}`]), ativos[0].id);
    const opcoesTipo = () => tiposDefeitoPara(ativoPorId(selAtivo.value).tipo).map((t) => [t.id, `${CATEGORIA_ICONE[t.categoria]} ${t.nome}`]);
    const selTipo = selectDe(opcoesTipo(), null);
    const selSev = selectDe(Object.entries(SEVERIDADES), tipoDefeito(selTipo.value).severidade);
    const desc = el('textarea', { class: 'campo__input', rows: 2, maxlength: 500, placeholder: 'Descrição objetiva (o quê, onde, extensão)' });
    const resolvido = el('input', { type: 'checkbox' });
    const ativ = el('input', { class: 'campo__input', maxlength: 120 });
    const wrapRes = el('label', { class: 'campo campo--check' }, resolvido, el('span', { text: 'Resolvido na hora (manutenção realizada nesta visita)' }));
    const wrapAtiv = el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Atividade realizada' }), ativ);
    const exige = el('div', { class: 'pequeno muted' });
    const fotos = campoFotos({ rotulo: () => `Defeito · ${ativoPorId(selAtivo.value).codigo}`, minimo: 1, titulo: 'Fotos do defeito' });
    const sincronizar = () => {
      const td = tipoDefeito(selTipo.value);
      selSev.value = td.severidade;
      exige.textContent = `Equipe exigida: ${td.equipes.map((t) => TIPOS_EQUIPE[t]).join(' / ')}`;
      const podeResolver = !!eq && (td.resolveNaHora || td.equipes.includes(eq.tipo));
      wrapRes.hidden = !podeResolver;
      if (!podeResolver) resolvido.checked = false;
      ativ.value = td.atividade;
      wrapAtiv.hidden = !resolvido.checked;
    };
    selAtivo.addEventListener('change', () => { selTipo.replaceChildren(...opcoesTipo().map(([v, t]) => el('option', { value: v, text: t }))); sincronizar(); });
    selTipo.addEventListener('change', sincronizar);
    resolvido.addEventListener('change', () => { wrapAtiv.hidden = !resolvido.checked; });
    sincronizar();
    areaNovo.replaceChildren(el('div', { class: 'novo-def' },
      ativos.length > 1 ? el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Ativo' }), selAtivo) : null,
      el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Tipo de defeito' }), selTipo),
      exige,
      el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Severidade' }), selSev),
      el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Descrição' }), desc),
      fotos.elemento, wrapRes, wrapAtiv,
      el('div', { class: 'linha' },
        el('button', { type: 'button', class: 'btn', text: 'Adicionar', onclick: () => {
          if (!fotos.suficiente()) { toast('Inclua ao menos uma foto do defeito.', { tipo: 'erro' }); return; }
          defeitos.push({ ativoId: selAtivo.value, tipoId: selTipo.value, severidade: selSev.value, descricao: desc.value.trim(), fotos: fotos.fotos(), resolvido: resolvido.checked, atividade: ativ.value.trim() });
          areaNovo.replaceChildren(); btnNovo.hidden = false; renderLista();
        } }),
        el('button', { type: 'button', class: 'btn btn--txt', text: 'Cancelar', onclick: () => { areaNovo.replaceChildren(); btnNovo.hidden = false; } }))));
  }
  form.append(el('h3', { text: 'Defeitos encontrados' }), listaDef, areaNovo, btnNovo);

  // Evidência geral + geovalidação
  const fotosInsp = campoFotos({ rotulo: () => (ativos.length > 1 ? `Inspeção em lote (${ativos.length})` : `Inspeção · ${ativos[0].codigo}`), minimo: 1, titulo: 'Foto da inspeção (visão geral)' });
  const geo = blocoGeo(ativos, avulsa);
  const obs = el('textarea', { class: 'campo__input', rows: 2, maxlength: 500, placeholder: 'Observações (opcional)' });
  form.append(el('h3', { text: 'Evidência e localização' }), fotosInsp.elemento, geo.elemento,
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Observações' }), obs),
    el('button', { type: 'submit', class: 'btn btn--grande', text: 'Concluir inspeção' }));

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const ok = tratar(() => concluirInspecao({
      ativoIds: ativos.map((a) => a.id), inspecaoIds: inspecoes.map((i) => i.id), avulsa,
      checklist: respostas, fotos: fotosInsp.fotos(), geo: geo.geo(), justificativa: geo.justificativa(), observacao: obs.value.trim(), defeitos,
    }));
    if (ok) {
      toast(defeitos.length ? `Inspeção concluída com ${defeitos.length} defeito(s).` : 'Inspeção concluída sem anomalia.', { tipo: 'ok' });
      if (ativos.length === 1) abrirAtivo(ativos[0].id); else fecharSheet();
    }
  });
  abrirSheet(avulsa ? `Inspeção avulsa · ${ativos[0].codigo}` : ativos.length > 1 ? `Inspeção em lote · ${ativos.length} ativos` : `Inspeção · ${ativos[0].codigo}`, form);
}

const CATEGORIA_ICONE = { ESTRUTURAL: '🏗', VEGETACAO: '🌳', ELETRICO: '⚡', FAUNA: '🐦' };

// ---------- Execução do defeito ----------
export function abrirExecucao(f) {
  const a = ativoPorId(f.ativoId), td = tipoDefeito(f.tipoId);
  const form = el('form', { class: 'form', novalidate: true });
  const ativ = el('input', { class: 'campo__input', value: td.atividade, maxlength: 120 });
  const mat = el('textarea', { class: 'campo__input', rows: 2, maxlength: 300, placeholder: 'Ex.: 1 cruzeta 2,4 m, 2 isoladores pino' });
  const fotos = campoFotos({ rotulo: () => `Execução · ${a.codigo}`, minimo: 1, titulo: 'Foto depois do serviço' });
  const geo = blocoGeo([a], false);
  form.append(
    el('p', { class: 'muted', text: `${td.nome} · Sev. ${f.severidade} · ${a.codigo}` }),
    el('div', { class: 'pequeno', text: 'Foto de identificação (antes):' }), galeria(f.fotos),
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Atividade realizada' }), ativ),
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Materiais aplicados' }), mat),
    fotos.elemento, geo.elemento,
    el('button', { type: 'submit', class: 'btn btn--grande', text: 'Registrar execução' }));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const g = geo.geo();
    if (!g.dentroDoRaio && !geo.justificativa().trim()) { toast('Fora do raio: informe a justificativa.', { tipo: 'erro' }); return; }
    if (tratar(() => transicionar(f, 'EXECUTADO', { atividade: ativ.value.trim(), materiais: mat.value.trim(), fotos: fotos.fotos(), geo: g, justificativa: g.dentroDoRaio ? undefined : geo.justificativa() }))) {
      toast('Execução registrada. Aguarda verificação do supervisor.', { tipo: 'ok' });
      abrirAtivo(a.id);
    }
  });
  abrirSheet(`Execução · ${a.codigo}`, form);
}

// ---------- Seleção de área ----------
export function abrirArea(ativos, aoLimpar) {
  const d = estado.dados, eq = equipeDoUsuario();
  const ids = new Set(ativos.map((a) => a.id));
  let pend = d.inspecoes.filter((i) => ids.has(i.ativoId) && i.status !== 'CONCLUIDA');
  if (eq) pend = pend.filter((i) => i.equipeId === eq.id || (!i.equipeId && eq.tipo === 'INSPECAO'));
  const abertos = d.defeitos.filter((f) => ids.has(f.ativoId) && STATUS_ABERTOS.includes(f.status));
  const comPend = ativos.filter((a) => pend.some((i) => i.ativoId === a.id));
  const corpo = el('div', { class: 'ficha' },
    el('div', { class: 'meta' },
      linhaMeta('Ativos na área', String(ativos.length)),
      linhaMeta('Inspeções pendentes', String(pend.length)),
      linhaMeta('Defeitos abertos', String(abertos.length)),
      linhaMeta('UCs envolvidas', fmtNum(ativos.reduce((s, a) => s + a.ucs, 0)))),
    el('div', { class: 'ficha__acoes' },
      comPend.length ? el('button', { type: 'button', class: 'btn', text: `Inspeção em lote (${pend.length})`, onclick: () => abrirFormInspecao({ ativos: comPend, inspecoes: pend }) }) : null,
      el('button', { type: 'button', class: 'btn btn--txt', text: 'Limpar seleção', onclick: () => { aoLimpar(); fecharSheet(); } })),
    el('ul', { class: 'lista' }, comPend.map((a) => el('li', { class: 'lista__item pequeno' },
      el('button', { type: 'button', class: 'btn btn--txt', text: `${TIPOS_ATIVO[a.tipo]} ${a.codigo}`, onclick: () => abrirAtivo(a.id) }),
      el('span', { class: 'muted', text: pend.filter((i) => i.ativoId === a.id).map((i) => criterio(i.criterioId)?.nome).join(', ') })))),
  );
  if (!comPend.length) corpo.append(el('p', { class: 'muted', text: 'Nenhuma inspeção pendente para você nesta área.' }));
  abrirSheet('Área selecionada', corpo, { tipo: 'area' });
}

