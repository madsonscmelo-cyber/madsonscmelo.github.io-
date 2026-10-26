// Interpretador local: transforma o que o supervisor falou ou digitou num formulário estruturado e lista o que falta perguntar.
// Roda só no aparelho (nenhum texto sai para serviço externo). No produto, este módulo é trocado por um modelo de linguagem
// hospedado no ambiente corporativo, com a mesma saída: campos, confiança por campo e no máximo 3 perguntas.
import { hojeISO, somarDias } from './util.js';
import { AREAS, TIPOS, grupos, supervisores, ultimoDiaUtil } from './dominio.js';

const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Data em português: 30/10, 30/10/2026, hoje, amanhã, depois de amanhã, sexta, semana que vem, fim do mês, dia 13. */
export function interpretarData(texto, hoje = hojeISO()) {
  const s = semAcento(texto);
  const h = new Date(`${hoje}T12:00:00`);
  let m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) {
    let ano = m[3] ? Number(m[3]) : h.getFullYear();
    if (ano < 100) ano += 2000;
    const d = new Date(ano, Number(m[2]) - 1, Number(m[1]), 12);
    if (d.getMonth() !== Number(m[2]) - 1) return '';
    if (!m[3] && d < h) d.setFullYear(ano + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (/depois de amanha/.test(s)) return somarDias(hoje, 2);
  if (/\bamanha\b/.test(s)) return somarDias(hoje, 1);
  if (/\bhoje\b/.test(s)) return hoje;
  if (/(fim|final) do mes/.test(s)) return ultimoDiaUtil(h.getFullYear(), h.getMonth());
  if (/semana que vem|proxima semana/.test(s)) return somarDias(hoje, 7);
  const dias = [['segunda', 1], ['terca', 2], ['quarta', 3], ['quinta', 4], ['sexta', 5]];
  for (const [nome, w] of dias) {
    if (new RegExp(`\\b${nome}\\b`).test(s)) {
      let n = (w - h.getDay() + 7) % 7;
      if (n === 0) n = 7;
      return somarDias(hoje, n);
    }
  }
  m = s.match(/\bdia (\d{1,2})\b/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 31) {
    let d = new Date(h.getFullYear(), h.getMonth(), Number(m[1]), 12);
    if (d < h) d = new Date(h.getFullYear(), h.getMonth() + 1, Number(m[1]), 12);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return '';
}

function interpretarDestino(d, s, usuario) {
  if (/\bsul\b/.test(s)) return 'grp:SUL';
  if (/\bnorte\b/.test(s)) return 'grp:NORTE';
  if (/todos os supervisores|todos supervisores|toda a operacao/.test(s)) return 'grp:TODOS';
  const pessoa = supervisores(d).find((u) => new RegExp(`\\b${semAcento(u.nome.split(' ')[0])}\\b`).test(s));
  if (pessoa) return pessoa.id;
  if (usuario?.perfil === 'SUPERVISOR' && /\b(eu|mim|comigo|pra mim|para mim)\b/.test(s)) return usuario.id;
  return '';
}

const PALAVRAS_TIPO = [
  ['Segurança', /\b(epi|seguranca|apr|acidente|nr-?10|linha viva|incidente)\b/],
  ['RH', /\b(exame|ferias|ponto|treinamento|banco de horas|escala|clima|pdi)\b/],
  ['Regulatório', /\b(dec|fec|aneel|regulat\w*|interrup\w*|compensac\w*|auditoria)\b/],
  ['Comercial', /\b(fatura|cliente|leitura|corte|religa\w*|perdas|receita|cobranca)\b/],
  ['Manutenção', /\b(manutenc\w*|transformador\w*|poda\w*|chave|religador|subestac\w*)\b/],
  ['Ritual', /\b(masp|rad|fechamento)\b/],
];
const ENTREGAVEIS = ['planilha', 'relatório', 'checklist', 'apresentação', 'formulário', 'lançamento', 'cronograma', 'lista', 'e-mail'];

/**
 * Lê o texto livre. Devolve { campos, confianca, perguntas }.
 * Confiança: "media" = deduzido do texto (o supervisor confere); campo vazio = vira pergunta.
 */
export function interpretar(d, texto, usuario, hoje = hojeISO()) {
  const t = String(texto || '').trim();
  const s = semAcento(t);
  const campos = { descricao: t, urgencia: 'NORMAL' };
  const confianca = {};

  const quem = t.match(/(?:^|\s)(?:[Oo]|[Aa])\s+([A-ZÁÉÍÓÚÂÊÔÃÕ][a-záéíóúâêôãõç]+)\s+(?:do|da|de)\s+([A-Za-zÁ-úç]+)/)
    || t.match(/^([A-ZÁÉÍÓÚ][a-záéíóúç]+)\s+(?:do|da|de)\s+([A-Za-zÁ-úç]+)/);
  if (quem) {
    campos.solicitante = quem[1];
    const area = AREAS.find((a) => semAcento(a).startsWith(semAcento(quem[2]).slice(0, 4)));
    if (area) campos.areaSolicitante = area;
    confianca.solicitante = 'media';
  }
  if (!campos.areaSolicitante) {
    const area = AREAS.find((a) => new RegExp(`\\b${semAcento(a)}\\b`).test(s));
    if (area) campos.areaSolicitante = area;
  }
  if (campos.areaSolicitante) confianca.areaSolicitante = 'media';

  campos.prazo = interpretarData(t, hoje);
  if (campos.prazo) confianca.prazo = 'media';
  campos.destinatario = interpretarDestino(d, s, usuario);
  if (usuario?.perfil === 'SUPERVISOR') campos.destinatario = usuario.id; // supervisor registra o que chegou para ele
  if (campos.destinatario) confianca.destinatario = 'media';

  // Sem palavra-chave, o tipo segue a área de quem pediu (pedido do RH é de RH); sem área, fica Gerencial com confiança baixa.
  const tipo = PALAVRAS_TIPO.find(([, re]) => re.test(s));
  const tipoDaArea = TIPOS.includes(campos.areaSolicitante) ? campos.areaSolicitante : '';
  campos.tipo = tipo ? tipo[0] : tipoDaArea || 'Gerencial';
  confianca.tipo = tipo || tipoDaArea ? 'media' : 'baixa';

  if (/\b(urgente|pra ontem|para ontem|imediat\w*)\b/.test(s)) {
    campos.urgencia = 'URGENTE';
    const j = t.match(/(?:é|e) para ([^.,;]+)|porque ([^.,;]+)/i);
    if (j) campos.justificativa = (j[1] || j[2]).trim();
  }
  const ent = ENTREGAVEIS.find((w) => s.includes(semAcento(w)));
  if (ent) { campos.entregavel = ent; confianca.entregavel = 'media'; }

  let tit = t.split(/[.;\n]/)[0];
  if (tit.includes(':')) tit = tit.slice(tit.lastIndexOf(':') + 1);
  tit = tit.replace(/^.*?\b(pediu|solicitou|mandou)\b\s*/i, '').replace(/^\s*(precisa|preciso|precisamos)\s+(de|do|da|dos|das)?\s*/i, '')
    .replace(/,?\s*(pra|para|até)\s+(hoje|amanhã|amanha|segunda|terça|terca|quarta|quinta|sexta|dia\s+\d+|\d{1,2}\/\d{1,2}).*$/i, '').trim();
  if (tit.length >= 5) { campos.titulo = tit.charAt(0).toUpperCase() + tit.slice(1, 140); confianca.titulo = 'media'; }

  return { campos, confianca, perguntas: perguntasFaltantes(d, campos, [], usuario) };
}

export const PERGUNTAS = {
  titulo: 'O que exatamente precisa ser entregue?',
  destinatario: 'Para quem é: um supervisor ou um grupo (setor Sul, setor Norte, todos)?',
  prazo: 'Qual o prazo? Pode ser uma data ou algo como "sexta" ou "dia 13".',
  solicitante: 'Quem fez o pedido?',
  entregavel: 'Qual o formato da entrega: planilha, e-mail, lançamento em sistema?',
  justificativa: 'Você marcou como urgente. Qual o motivo da urgência?',
};

/** No máximo 3 perguntas, na ordem do que mais bloqueia o trabalho. Campo marcado como pendente não é perguntado de novo. */
export function perguntasFaltantes(d, c, pendencias = [], usuario) {
  const ordem = ['titulo', 'destinatario', 'prazo', 'solicitante', 'entregavel'];
  if (usuario?.perfil === 'DEMANDANTE') ordem.splice(ordem.indexOf('solicitante'), 1);
  const faltam = ordem.filter((k) => !c[k] && !pendencias.includes(k));
  if (c.urgencia === 'URGENTE' && !c.justificativa) faltam.push('justificativa');
  return faltam.slice(0, 3).map((campo) => ({ campo, pergunta: PERGUNTAS[campo] }));
}

/** Lê a resposta a uma pergunta do assistente. Devolve o valor do campo ou '' se não entendeu. */
export function interpretarResposta(d, campo, resposta, usuario, hoje = hojeISO()) {
  const r = String(resposta || '').trim();
  if (!r) return '';
  if (campo === 'prazo') return interpretarData(r, hoje);
  if (campo === 'destinatario') return interpretarDestino(d, semAcento(r), usuario) || (grupos(d)[r] ? r : '');
  return r.slice(0, campo === 'titulo' ? 140 : 300);
}
