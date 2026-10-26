// Tela Nova demanda: captura (voz, texto, foto) → formulário estruturado → assistente pergunta só o que falta → confirmação.
// Nada sai do aparelho, exceto o áudio do ditado, que o próprio navegador envia ao serviço de voz dele (aviso na tela).
import { el, preencher, toast, hojeISO } from './util.js';
import { estado, salvarRascunho, obterRascunho, removerRascunho } from './store.js';
import { AREAS, TIPOS, CANAIS, MOTIVOS_RADAR, CAMPOS_PENDENCIA, LIMITES, grupos, supervisores, radarAutomatico, dataLonga, ehGrupo } from './dominio.js';
import { interpretar, interpretarResposta, perguntasFaltantes } from './interpretador.js';
import { criarDemanda, podeCriar } from './acoes.js';
import { tratar } from './ui.js';
import { logar } from './auditoria.js';

const LADO_MAX = 1280;
const EXEMPLOS = [
  ['Áudio do RH', 'VOZ', 'O Carlos do RH pediu a lista de quem está com exame periódico vencido, pra sexta, todos os supervisores do setor sul.'],
  ['Zap da Segurança', 'FOTO', 'Paula da Segurança mandou no zap: precisa do checklist de EPI das equipes de linha viva assinado até amanhã, urgente, é para auditoria.'],
  ['E-mail do Regulatório', 'EMAIL', 'Recebi e-mail do Regulatório: consolidar justificativas de interrupção acima de 3h do mês para o relatório de DEC/FEC. Prazo dia 13.'],
];

let S = null;
const chave = () => `nova:${estado.usuario.id}`;
function novoEstado() {
  return { texto: '', canal: 'TEXTO', campos: null, confianca: {}, pendencias: [], fila: [], pergunta: null, chat: [], anexo: '', radarManual: '', motivoRadar: '' };
}
function carregarEstado() {
  if (S && S.usuario === estado.usuario.id) return;
  const r = obterRascunho(chave());
  S = { ...novoEstado(), ...(r?.estado || {}), usuario: estado.usuario.id, gravando: false };
}
function guardar() {
  const { gravando, usuario, ...resto } = S;
  if (!resto.texto && !resto.campos) { removerRascunho(chave()); return; }
  salvarRascunho({ chave: chave(), texto: resto.texto, campos: resto.campos, estado: resto });
}

export function telaNova(raiz, ctx) {
  if (!podeCriar()) { preencher(raiz, el('p', { class: 'vazio', text: 'Seu perfil só consulta.' })); return; }
  carregarEstado();
  const render = () => telaNova(raiz, ctx);
  preencher(raiz,
    el('header', { class: 'tela__topo' }, el('h1', { text: 'Nova demanda' }),
      el('span', { class: 'muted', text: estado.usuario.perfil === 'SUPERVISOR' ? 'Registre o que chegou para você, do jeito que chegou' : 'Abra um pedido para um supervisor ou um grupo' })),
    el('div', { class: 'grade-2 nova' },
      el('div', { class: 'grupo' }, painelCaptura(render), S.chat.length ? painelAssistente(render) : null),
      S.campos ? painelFormulario(render, ctx) : el('section', { class: 'bloco' }, el('h2', { text: '2 · Formulário' }),
        el('p', { class: 'muted', text: 'Depois de capturar, o app monta o formulário estruturado e pergunta só o que estiver faltando.' }))));
}

// ---------- 1 · Captura ----------
let reconhecimento = null;
function painelCaptura(render) {
  const area = el('textarea', { class: 'campo__input', rows: 4, maxlength: LIMITES.textoMax, id: 'nova-texto',
    placeholder: 'Ex.: O Carlos do RH pediu a lista de exames vencidos pra sexta, todos os supervisores do setor sul.' });
  area.value = S.texto;
  area.addEventListener('input', () => { S.texto = area.value; guardar(); });

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = el('button', { type: 'button', class: `btn btn--mic${S.gravando ? ' gravando' : ''}`, 'aria-pressed': String(!!S.gravando),
    'aria-label': S.gravando ? 'Parar o ditado' : 'Ditar por voz', disabled: !SR, text: S.gravando ? '■ Parar' : '🎙 Falar' });
  mic.addEventListener('click', () => alternarDitado(area, render));

  const foto = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'sr-only', id: 'nova-foto' });
  foto.addEventListener('change', async () => {
    const f = foto.files?.[0];
    if (!f) return;
    try {
      S.anexo = await comprimir(f);
      S.canal = 'FOTO';
      guardar();
      logar({ categoria: 'ESCRITA', acao: 'IMAGEM_ANEXADA', detalhe: { kb: Math.round(S.anexo.length * 0.75 / 1024) } });
      render();
    } catch { toast('Não foi possível ler a imagem. Use JPG ou PNG.', { tipo: 'erro' }); }
  });
  const canal = el('select', { class: 'campo__input', 'aria-label': 'Como o pedido chegou' },
    Object.entries(CANAIS).filter(([k]) => k !== 'RITUAL').map(([k, v]) => el('option', { value: k, text: v, selected: S.canal === k })));
  canal.addEventListener('change', () => { S.canal = canal.value; guardar(); if (S.campos) render(); });

  const estruturar = el('button', { type: 'button', class: 'btn', text: S.campos ? 'Estruturar de novo' : 'Estruturar demanda', onclick: () => {
    S.texto = area.value.trim();
    if (S.texto.length < 10) { toast('Descreva o pedido com pelo menos uma frase.', { tipo: 'aviso' }); area.focus(); return; }
    const r = interpretar(estado.dados, S.texto, estado.usuario);
    S.campos = r.campos; S.confianca = r.confianca; S.pendencias = []; S.radarManual = ''; S.motivoRadar = '';
    S.fila = r.perguntas; S.chat = [{ de: 'bot', t: 'Montei o formulário a partir do que você contou. Confira ao lado.' }];
    proximaPergunta();
    if (!S.pergunta) S.chat.push({ de: 'bot', t: 'Encontrei todos os dados obrigatórios. Revise e confirme.' });
    logar({ categoria: 'ESCRITA', acao: 'PEDIDO_ESTRUTURADO', detalhe: { canal: S.canal, faltando: r.perguntas.map((p) => p.campo) } });
    guardar();
    render();
  } });

  return el('section', { class: 'bloco grupo' },
    el('h2', { text: '1 · Capturar' }),
    el('label', { class: 'campo', for: 'nova-texto' }, el('span', { class: 'campo__rotulo', text: 'Descreva o pedido como chegou para você' }), area),
    el('div', { class: 'linha' }, mic, el('label', { class: 'btn btn--sec', for: 'nova-foto', text: '📷 Foto ou print' }), foto, canal, estruturar),
    el('p', { class: 'muted pequeno', text: SR
      ? 'Ditado: o navegador envia o áudio ao serviço de voz dele (no Chrome, do Google). Não dite CPF, endereço nem dados de clientes. O microfone do teclado do celular também funciona.'
      : 'Este navegador não oferece ditado. Use o microfone do teclado do celular para falar dentro da caixa de texto.' }),
    S.anexo ? el('div', { class: 'linha' }, el('img', { class: 'fotos__mini', src: S.anexo, alt: 'Imagem anexada' }),
      el('span', { class: 'muted pequeno', text: 'A imagem fica anexada ao pedido. Ela não é lida automaticamente: descreva o pedido no texto.' }),
      el('button', { type: 'button', class: 'btn btn--txt', text: 'Remover imagem', onclick: () => { S.anexo = ''; guardar(); render(); } })) : null,
    el('div', {}, el('span', { class: 'muted pequeno', text: 'Testar com um exemplo: ' }), el('div', { class: 'linha' }, EXEMPLOS.map(([nome, c, t]) =>
      el('button', { type: 'button', class: 'chip chip--btn chip--ex', text: nome, onclick: () => { S.texto = t; S.canal = c; guardar(); render(); } })))),
    S.texto || S.campos ? el('button', { type: 'button', class: 'btn btn--txt', text: 'Descartar e começar de novo', onclick: () => { S = { ...novoEstado(), usuario: estado.usuario.id }; removerRascunho(chave()); render(); } }) : null);
}

function alternarDitado(area, render) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (S.gravando && reconhecimento) { reconhecimento.stop(); return; }
  try {
    reconhecimento = new SR();
    reconhecimento.lang = 'pt-BR';
    reconhecimento.interimResults = true;
    reconhecimento.continuous = true;
    const base = area.value.trim();
    let final = '';
    reconhecimento.onresult = (e) => {
      let parcial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += `${e.results[i][0].transcript} `; else parcial += e.results[i][0].transcript;
      }
      area.value = `${base ? `${base} ` : ''}${final}${parcial}`.slice(0, LIMITES.textoMax);
      S.texto = area.value;
    };
    reconhecimento.onerror = (e) => {
      toast(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Microfone não liberado. Permita o microfone ou use o ditado do teclado.' : 'Não deu para captar o áudio. Tente de novo.', { tipo: 'aviso' });
    };
    reconhecimento.onend = () => { S.gravando = false; S.canal = 'VOZ'; guardar(); logar({ categoria: 'ESCRITA', acao: 'DITADO_ENCERRADO', detalhe: { caracteres: S.texto.length } }); render(); };
    reconhecimento.start();
    S.gravando = true;
    logar({ categoria: 'ESCRITA', acao: 'DITADO_INICIADO' });
    render();
  } catch { S.gravando = false; toast('O ditado não está disponível neste navegador.', { tipo: 'aviso' }); }
}

/** Redimensiona para no máximo 1280 px e regrava em JPEG: some o EXIF (inclusive localização) e o arquivo fica leve. */
function comprimir(arquivo) {
  return new Promise((res, rej) => {
    if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type) || arquivo.size > 15 * 1024 * 1024) { rej(new Error('tipo')); return; }
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, LADO_MAX / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('leitura')); };
    img.src = url;
  });
}

// ---------- Assistente: perguntas sobre o que falta ----------
function proximaPergunta() {
  S.pergunta = null;
  while (S.fila.length) {
    const p = S.fila.shift();
    if (!S.campos[p.campo] && !S.pendencias.includes(p.campo)) { S.pergunta = p; S.chat.push({ de: 'bot', t: p.pergunta }); return; }
  }
  const fim = 'Pronto. Revise o formulário e confirme.';
  if (S.chat.length > 1 && S.chat.at(-1).t !== fim) S.chat.push({ de: 'bot', t: fim });
}

function painelAssistente(render) {
  const entrada = el('input', { class: 'campo__input', maxlength: 300, 'aria-label': 'Sua resposta', placeholder: 'Responda aqui…', id: 'nova-resposta' });
  const form = el('form', { class: 'linha chat__form', novalidate: true }, entrada, el('button', { type: 'submit', class: 'btn', text: 'Enviar' }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const p = S.pergunta, r = entrada.value.trim();
    if (!p || !r) return;
    S.chat.push({ de: 'eu', t: r });
    const v = interpretarResposta(estado.dados, p.campo, r, estado.usuario);
    if (v) { S.campos[p.campo] = v; S.confianca[p.campo] = 'alta'; proximaPergunta(); }
    else S.chat.push({ de: 'bot', t: p.campo === 'prazo' ? 'Não entendi a data. Tente "sexta", "dia 13" ou 30/10.' : 'Não entendi. Pode reformular?' });
    guardar();
    render();
    document.getElementById('nova-resposta')?.focus();
  });
  const naoSei = S.pergunta && CAMPOS_PENDENCIA[S.pergunta.campo]
    ? el('button', { type: 'button', class: 'btn btn--txt', text: 'Não sei, deixar pendente com quem pediu', onclick: () => {
      const c = S.pergunta.campo;
      S.pendencias = [...new Set([...S.pendencias, c])];
      S.chat.push({ de: 'eu', t: 'Não sei' }, { de: 'bot', t: `Marquei "${CAMPOS_PENDENCIA[c]}" como pendente com ${S.campos.solicitante || 'quem pediu'}. Isso entra no indicador de pedidos incompletos.` });
      proximaPergunta(); guardar(); render();
    } }) : null;
  return el('section', { class: 'bloco grupo', 'aria-label': 'Assistente' },
    el('h2', { text: 'Assistente' }),
    el('div', { class: 'chat', role: 'log', 'aria-live': 'polite' }, S.chat.map((m) => el('p', { class: `chat__msg chat__msg--${m.de}`, text: m.t }))),
    S.pergunta ? form : null, naoSei);
}

// ---------- 2 · Formulário estruturado ----------
function painelFormulario(render, ctx) {
  const c = S.campos, u = estado.usuario;
  const ponto = (k) => el('span', { class: `conf conf--${S.confianca[k] || 'manual'}`, title: `Confiança: ${{ alta: 'alta', media: 'média — confira', baixa: 'baixa — confira' }[S.confianca[k]] || 'preenchido por você'}`, 'aria-hidden': 'true' });
  const falta = (k) => !c[k] && !S.pendencias.includes(k);
  const botao = el('button', { type: 'button', class: 'btn btn--grande', text: 'Confirmar e criar' });
  const motivoNecessario = () => S.radarManual === 'FORA' && !S.motivoRadar;
  const atualizarBotao = () => {
    const ok = c.titulo?.trim().length >= LIMITES.tituloMin && c.destinatario && (c.prazo || S.pendencias.includes('prazo'))
      && (c.urgencia !== 'URGENTE' || (c.justificativa || '').trim().length >= LIMITES.justificativaMin) && !motivoNecessario();
    botao.disabled = !ok;
    const g = ehGrupo(c.destinatario) ? grupos(estado.dados)[c.destinatario] : null;
    botao.textContent = g ? `Confirmar e criar (${g.membros.length} tickets)` : 'Confirmar e criar';
  };
  const campoTexto = (k, rotulo, attrs = {}) => {
    const i = el('input', { class: 'campo__input', value: c[k] || '', maxlength: k === 'titulo' ? LIMITES.tituloMax : 120, ...attrs });
    i.addEventListener('input', () => { c[k] = i.value; S.confianca[k] = 'alta'; atualizarBotao(); guardar(); });
    return el('label', { class: `campo${falta(k) && k !== 'justificativa' ? ' campo--falta' : ''}` }, el('span', { class: 'campo__rotulo' }, ponto(k), rotulo,
      S.pendencias.includes(k) ? el('span', { class: 'chip chip--pend', text: 'pendente com quem pediu' }) : null), i);
  };
  const seletor = (k, rotulo, opcoes, aoMudar) => {
    const s = el('select', { class: 'campo__input' }, opcoes.map(([v, t]) => (Array.isArray(t)
      ? el('optgroup', { label: v }, t.map(([v2, t2]) => el('option', { value: v2, text: t2, selected: c[k] === v2 })))
      : el('option', { value: v, text: t, selected: c[k] === v }))));
    s.addEventListener('change', () => { c[k] = s.value; S.confianca[k] = 'alta'; guardar(); if (aoMudar) aoMudar(); else atualizarBotao(); });
    return el('label', { class: `campo${falta(k) ? ' campo--falta' : ''}` }, el('span', { class: 'campo__rotulo' }, ponto(k), rotulo), s);
  };

  const gs = grupos(estado.dados);
  const destinos = u.perfil === 'SUPERVISOR' ? [[u.id, `${u.nome} (você)`]]
    : [['', 'Escolha…'], ['Grupos', Object.entries(gs).map(([k, g]) => [k, `${g.nome} (${g.membros.length})`])], ['Pessoas', supervisores(estado.dados).map((s) => [s.id, s.nome])]];

  const prazo = el('input', { type: 'date', class: 'campo__input', value: c.prazo || '', min: hojeISO() });
  prazo.addEventListener('change', () => { c.prazo = prazo.value; S.confianca.prazo = 'alta'; S.pendencias = S.pendencias.filter((p) => p !== 'prazo' || !prazo.value); guardar(); render(); });

  const auto = radarAutomatico({ canal: S.canal, abertura: hojeISO(), prazo: c.prazo });
  const radarFinal = S.radarManual || auto.radar;
  const radarSel = el('select', { class: 'campo__input' }, [['', 'Usar o cálculo automático'], ['PLANEJADA', 'Estava no meu radar'], ['FORA', 'Não estava no meu radar']]
    .map(([v, t]) => el('option', { value: v, text: t, selected: S.radarManual === v })));
  radarSel.addEventListener('change', () => { S.radarManual = radarSel.value; if (S.radarManual !== 'FORA') S.motivoRadar = ''; guardar(); render(); });
  const motivoSel = el('select', { class: 'campo__input' }, el('option', { value: '', text: 'Escolha o motivo' }), Object.entries(MOTIVOS_RADAR).map(([k, v]) => el('option', { value: k, text: v, selected: S.motivoRadar === k })));
  motivoSel.addEventListener('change', () => { S.motivoRadar = motivoSel.value; guardar(); atualizarBotao(); });

  botao.addEventListener('click', () => {
    const ids = tratar(() => criarDemanda({ ...c, canal: S.canal, pendencias: S.pendencias, radarManual: S.radarManual, motivoRadar: S.motivoRadar, anexo: S.anexo }));
    if (!ids) return;
    toast(ids.length > 1 ? `Pedido criado para ${ids.length - 1} supervisores.` : 'Demanda criada.', { tipo: 'ok' });
    S = { ...novoEstado(), usuario: estado.usuario.id };
    removerRascunho(chave());
    ctx.irPara('agenda');
  });
  atualizarBotao();

  return el('section', { class: 'bloco grupo' },
    el('h2', { text: '2 · Confira antes de criar' }),
    el('p', { class: 'muted pequeno' }, el('span', { class: 'conf conf--media', 'aria-hidden': 'true' }), ' deduzido do texto, confira · ',
      el('span', { class: 'conf conf--alta', 'aria-hidden': 'true' }), ' confirmado · contorno vermelho = falta preencher'),
    el('div', { class: 'form form--2' },
      campoTexto('titulo', 'O que precisa ser feito', { required: true }),
      u.perfil === 'DEMANDANTE' ? null : campoTexto('solicitante', 'Quem pediu'),
      u.perfil === 'DEMANDANTE' ? null : seletor('areaSolicitante', 'Área de quem pediu', [['', '—'], ...AREAS.map((a) => [a, a])]),
      seletor('destinatario', 'Para quem', destinos, render),
      el('label', { class: `campo${falta('prazo') ? ' campo--falta' : ''}` }, el('span', { class: 'campo__rotulo' }, ponto('prazo'), 'Prazo',
        c.prazo ? el('span', { class: 'muted', text: ` · ${dataLonga(c.prazo)}` }) : null,
        S.pendencias.includes('prazo') ? el('span', { class: 'chip chip--pend', text: 'pendente com quem pediu' }) : null), prazo),
      seletor('tipo', 'Tipo', TIPOS.filter((t) => t !== 'Ritual').map((t) => [t, t])),
      campoTexto('entregavel', 'Entregável', { placeholder: 'planilha, e-mail, lançamento…' }),
      seletor('urgencia', 'Urgência', [['NORMAL', 'Normal'], ['URGENTE', 'Urgente']], render),
      c.urgencia === 'URGENTE' ? campoTexto('justificativa', 'Por que é urgente (obrigatório)') : null),
    el('div', { class: `radar radar--${radarFinal.toLowerCase()}` },
      el('p', { class: 'radar__linha' }, el('strong', { text: radarFinal === 'FORA' ? '◌ Fora do radar' : '◉ Planejada' }), el('span', { class: 'muted', text: ` · cálculo automático: ${auto.motivo}` })),
      el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Ajuste de quem recebeu' }), radarSel),
      S.radarManual === 'FORA' ? el('label', { class: `campo${S.motivoRadar ? '' : ' campo--falta'}` }, el('span', { class: 'campo__rotulo', text: 'Motivo' }), motivoSel) : null),
    S.pendencias.length ? el('p', { class: 'resumo', text: `Vai nascer com pendência de: ${S.pendencias.map((p) => CAMPOS_PENDENCIA[p]).join(', ')}.` }) : null,
    botao,
    S.fila.length || S.pergunta ? null : (() => {
      const faltam = perguntasFaltantes(estado.dados, c, S.pendencias, u);
      return faltam.length ? el('button', { type: 'button', class: 'btn btn--txt', text: 'Perguntar o que ainda falta', onclick: () => { S.fila = faltam; proximaPergunta(); guardar(); render(); } }) : null;
    })());
}
