// Parâmetros configuráveis com vigência. Cada alteração cria uma nova versão "válida a partir de" uma data;
// versões antigas nunca são apagadas, para que indicadores de períodos passados usem a regra da época.
import { estado, persistir, emitir } from './store.js';
import { logar } from './auditoria.js';
import { hojeISO } from './util.js';
import { PARAM, RISCO, PONTOS, CRITERIOS, TIPOS_DEFEITO, TIPOS_ATIVO, TIPOS_EQUIPE, CATEGORIAS, SEVERIDADES } from './dominio.js';
import { POLITICA } from './auth.js';

const copia = (x) => structuredClone(x);
const mesISO = (desloc = 0) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + desloc); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

// ---------- Valores padrão (todos fictícios) ----------
const CADERNO = [
  ['SRV-PODA-VAO', 'Poda de árvore em rede de distribuição', 'vão', 180],
  ['SRV-ROCADA-M', 'Roçada manual de faixa de servidão', 'm', 2.5],
  ['SRV-CRUZETA', 'Substituição de cruzeta (mão de obra)', 'un', 420],
  ['MAT-CRUZETA', 'Cruzeta 2,4 m', 'un', 260],
  ['MAT-ISOLADOR', 'Isolador pino 15 kV', 'un', 45],
  ['SRV-ISOLADOR', 'Substituição de isolador (mão de obra)', 'un', 120],
  ['SRV-POSTE', 'Substituição de poste (mão de obra)', 'un', 1900],
  ['MAT-POSTE', 'Poste de concreto 11 m', 'un', 1450],
  ['SRV-ESTAI', 'Instalação/reaperto de estai', 'un', 150],
  ['MAT-ESTAI', 'Conjunto de estai', 'un', 95],
  ['SRV-CONEXAO-LV', 'Refazer conexão em linha viva', 'un', 520],
  ['MAT-CONECTOR', 'Conector tipo cunha', 'un', 38],
  ['SRV-ATERR', 'Recomposição de aterramento', 'un', 210],
  ['MAT-ATERR', 'Kit de aterramento', 'un', 85],
  ['SRV-CHAVE', 'Substituição de chave fusível (mão de obra)', 'un', 480],
  ['MAT-CHAVE', 'Chave fusível 15 kV', 'un', 390],
  ['SRV-TRAFO', 'Substituição de transformador (mão de obra)', 'un', 2200],
  ['MAT-TRAFO', 'Recondicionamento/remanejamento de transformador', 'un', 3500],
  ['SRV-NINHO', 'Retirada de ninho', 'un', 90],
  ['SRV-DESLOC', 'Deslocamento de equipe', 'un', 150],
  ['SRV-INSP-KM', 'Inspeção terrestre de rede', 'km', 85],
  ['SRV-INSP-DRONE', 'Inspeção de rede por drone', 'km', 60],
].map(([codigo, descricao, unidade, preco]) => ({ codigo, descricao, unidade, preco }));

// itens: "CÓDIGO:quantidade" separados por ";" — sufixo "/u" multiplica pela quantidade do defeito (vãos, metros).
const COMPOSICOES = [
  ['NINHO', 'Retirada de ninho', 'SRV-NINHO:1; SRV-DESLOC:1'],
  ['PODA', 'Poda por vão', 'SRV-PODA-VAO:1/u; SRV-DESLOC:1'],
  ['ROCADA', 'Roçada por metro', 'SRV-ROCADA-M:1/u; SRV-DESLOC:1'],
  ['CRUZETA', 'Substituição de cruzeta', 'SRV-CRUZETA:1; MAT-CRUZETA:1; MAT-ISOLADOR:3; SRV-DESLOC:1'],
  ['POSTE', 'Substituição de poste', 'SRV-POSTE:1; MAT-POSTE:1; SRV-DESLOC:1'],
  ['ESTAI', 'Estai', 'SRV-ESTAI:1; MAT-ESTAI:1; SRV-DESLOC:1'],
  ['ISOLADOR', 'Substituição de isolador', 'SRV-ISOLADOR:1; MAT-ISOLADOR:1; SRV-DESLOC:1'],
  ['CONEXAO', 'Conexão em linha viva', 'SRV-CONEXAO-LV:1; MAT-CONECTOR:2; SRV-DESLOC:1'],
  ['ATERRAMENTO', 'Aterramento', 'SRV-ATERR:1; MAT-ATERR:1; SRV-DESLOC:1'],
  ['CHAVE', 'Substituição de chave fusível', 'SRV-CHAVE:1; MAT-CHAVE:1; SRV-DESLOC:1'],
  ['TRAFO', 'Substituição de transformador', 'SRV-TRAFO:1; MAT-TRAFO:1; SRV-DESLOC:1'],
].map(([id, nome, itens]) => ({ id, nome, itens }));

function padrao() {
  const orcamento = [];
  const base = { ESTRUTURAL: 30000, VEGETACAO: 9000, ROCADA: 6000, ELETRICO: 22000, FAUNA: 1500 };
  for (const m of [mesISO(0), mesISO(1), mesISO(2)]) for (const [categoria, valor] of Object.entries(base)) orcamento.push({ mes: m, categoria, valor });
  return {
    geral: { raioValidacaoM: PARAM.raioValidacaoM, raioAlertaM: PARAM.raioAlertaM, janelaProgramacaoDias: PARAM.janelaProgramacaoDias, horasDiaEquipe: PARAM.horasDiaEquipe, diasUteisSemana: PARAM.diasUteisSemana,
      coberturaMinPct: 95, faixaTrilhaM: 30, raioEscolaM: 200, raioAtribuicaoM: 300 },
    metas: { aderenciaPlano: 95, completude: 95, aderenciaProgramacao: 90, slaCriticos: 100, eficacia: 90, slaA: 7, slaB: 30, slaC: 90 },
    tiposPlano: [
      ['BASE', 'Plano base (rede inteira)', 180, 'Periodicidade padrão de toda a rede'],
      ['OURO', 'Trecho ouro', 60, 'Cargas críticas e maior CHI'],
      ['URBANO', 'Área urbana', 90, 'Polígono urbano'],
      ['ESCOLA', 'Segurança — escolas', 60, 'Raio em volta de escolas; risco a terceiros é severidade A'],
      ['EVENTO', 'Evento', 30, 'Inspecionar até N dias antes do início; vale só entre início e fim'],
      ['ESPECIAL', 'Plano especial', 120, 'Livre'],
    ].map(([id, nome, periodicidadeDias, descricao]) => ({ id, nome, periodicidadeDias, descricao })),
    causas: [
      ['VEG', 'Vegetação / árvore na rede', true, 'VEGETACAO', 180],
      ['FAIXA', 'Vegetação baixa / queimada na faixa', true, 'ROCADA', 180],
      ['EST', 'Estrutura (cruzeta, poste, isolador)', true, 'ESTRUTURAL', 180],
      ['CONEX', 'Conexão / condutor', true, 'ELETRICO', 180],
      ['TRAFO', 'Falha de transformador', true, 'ELETRICO', 90],
      ['CHAVE', 'Chave / elo fusível', true, 'ELETRICO', 90],
      ['FAUNA', 'Animal / ninho', true, 'FAUNA', 90],
      ['DESC', 'Descarga atmosférica', false, 'NENHUMA', 0],
      ['ABAL', 'Abalroamento de poste', false, 'NENHUMA', 0],
      ['VAND', 'Vandalismo / furto', false, 'NENHUMA', 0],
      ['OBJ', 'Pipa / objeto estranho', false, 'NENHUMA', 0],
      ['NID', 'Causa não identificada', false, 'NENHUMA', 0],
    ].map(([codigo, nome, evitavel, atividade, janelaDias]) => ({ codigo, nome, evitavel, atividade, janelaDias })),
    risco: copia(RISCO),
    ranking: { inspecaoBase: PONTOS.inspecaoBase, inspecaoAtrasada: PONTOS.inspecaoAtrasada, defeitoValidadoA: 10, defeitoValidadoB: 6, defeitoValidadoC: 3, defeitoRejeitado: -3, execucaoA: 15, execucaoB: 9, execucaoC: 5 },
    criterios: copia(CRITERIOS),
    tiposDefeito: copia(TIPOS_DEFEITO),
    caderno: copia(CADERNO),
    composicoes: copia(COMPOSICOES),
    fatores: [{ conjunto: 'CJ-Centro', fator: 1 }, { conjunto: 'CJ-Norte', fator: 1.05 }, { conjunto: 'CJ-Sul', fator: 1.15 }],
    orcamento,
    motivos: ['Falta de material', 'Desligamento não autorizado', 'Chuva / condição climática', 'Equipe deslocada para emergência', 'Acesso ao local', 'Cliente / terceiros', 'Repriorização da gestão']
      .map((nome, i) => ({ id: `M${i + 1}`, nome })),
    seguranca: { senhaMinimo: POLITICA.senhaMinimo, historicoSenhas: POLITICA.historicoSenhas, tentativasMaximas: POLITICA.tentativasMaximas, bloqueioMinutos: POLITICA.bloqueioMinutos, inatividadeMinutos: POLITICA.inatividadeMinutos, sessaoMaximaHoras: POLITICA.sessaoMaximaHoras },
  };
}
const PADRAO = padrao();

// ---------- Esquema (tela de administração e validação) ----------
const opc = (obj) => () => Object.entries(obj);
const ADM = ['ADMIN'], ADM_GESTOR = ['ADMIN', 'GESTOR'];
export const ESQUEMA = {
  orcamento: { titulo: 'Orçamento mensal', tipo: 'tabela', editores: ADM_GESTOR, ajuda: 'Valor disponível por mês e categoria. A Programação compara o custo programado com este orçamento.', campos: [
    { chave: 'mes', rotulo: 'Mês', tipo: 'mes' },
    { chave: 'categoria', rotulo: 'Categoria', tipo: 'selecao', opcoes: opc(CATEGORIAS) },
    { chave: 'valor', rotulo: 'Valor (R$)', tipo: 'numero', min: 0 }] },
  caderno: { titulo: 'Caderno de serviços', tipo: 'tabela', editores: ADM, ajuda: 'Preço unitário de cada item (serviço ou material). Use a importação CSV para substituir o caderno inteiro.', importavel: true, campos: [
    { chave: 'codigo', rotulo: 'Código', tipo: 'texto', obrigatorio: true },
    { chave: 'descricao', rotulo: 'Descrição', tipo: 'texto', obrigatorio: true },
    { chave: 'unidade', rotulo: 'Unidade', tipo: 'texto' },
    { chave: 'preco', rotulo: 'Preço (R$)', tipo: 'numero', min: 0 }] },
  composicoes: { titulo: 'Composições de custo', tipo: 'tabela', editores: ADM, ajuda: 'Itens do caderno por serviço, no formato CÓDIGO:quantidade; use /u para multiplicar pela extensão do defeito (ex.: SRV-PODA-VAO:1/u).', campos: [
    { chave: 'id', rotulo: 'Código', tipo: 'texto', obrigatorio: true },
    { chave: 'nome', rotulo: 'Nome', tipo: 'texto' },
    { chave: 'itens', rotulo: 'Itens', tipo: 'itens' }] },
  fatores: { titulo: 'Fator regional de custo', tipo: 'tabela', editores: ADM, ajuda: 'Multiplicador do custo-padrão por conjunto (ex.: área rural distante = 1,15).', campos: [
    { chave: 'conjunto', rotulo: 'Conjunto', tipo: 'texto', obrigatorio: true },
    { chave: 'fator', rotulo: 'Fator', tipo: 'numero', min: 0.5, max: 3 }] },
  tiposDefeito: { titulo: 'Tipos de defeito', tipo: 'tabela', editores: ADM, ajuda: 'Catálogo usado em campo, na programação e no custo.', campos: [
    { chave: 'id', rotulo: 'Código', tipo: 'texto', obrigatorio: true },
    { chave: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
    { chave: 'categoria', rotulo: 'Categoria', tipo: 'selecao', opcoes: opc(CATEGORIAS) },
    { chave: 'severidade', rotulo: 'Severidade', tipo: 'selecao', opcoes: opc(SEVERIDADES) },
    { chave: 'equipes', rotulo: 'Equipes aptas', tipo: 'multi', opcoes: opc(TIPOS_EQUIPE) },
    { chave: 'resolveNaHora', rotulo: 'Resolve na hora', tipo: 'bool' },
    { chave: 'atividade', rotulo: 'Atividade', tipo: 'texto' },
    { chave: 'composicao', rotulo: 'Composição', tipo: 'texto' },
    { chave: 'unidade', rotulo: 'Unidade', tipo: 'texto' },
    { chave: 'quantidadePadrao', rotulo: 'Qtd. padrão', tipo: 'numero', min: 0 },
    { chave: 'horasPadrao', rotulo: 'Horas/unid.', tipo: 'numero', min: 0 }] },
  criterios: { titulo: 'Critérios de inspeção', tipo: 'tabela', editores: ADM, ajuda: 'O que marca um ativo para inspeção e a periodicidade.', campos: [
    { chave: 'id', rotulo: 'Código', tipo: 'texto', obrigatorio: true },
    { chave: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
    { chave: 'periodicidadeDias', rotulo: 'Periodicidade (dias)', tipo: 'numero', min: 1 },
    { chave: 'peso', rotulo: 'Peso', tipo: 'numero', min: 0 },
    { chave: 'tipos', rotulo: 'Tipos de ativo', tipo: 'multi', opcoes: opc(TIPOS_ATIVO) }] },
  tiposPlano: { titulo: 'Tipos de plano', tipo: 'tabela', editores: ADM_GESTOR, ajuda: 'Periodicidade de inspeção de cada tipo de plano (no evento: quantos dias antes do início a inspeção precisa estar feita).', campos: [
    { chave: 'id', rotulo: 'Código', tipo: 'texto', obrigatorio: true },
    { chave: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
    { chave: 'periodicidadeDias', rotulo: 'Periodicidade (dias)', tipo: 'numero', min: 1 },
    { chave: 'descricao', rotulo: 'Descrição', tipo: 'texto' }] },
  causas: { titulo: 'Causas de ocorrência × atividade', tipo: 'tabela', editores: ADM, ajuda: 'Base da eficácia: só causas evitáveis contam, contra a atividade relacionada e dentro da janela (dias após a inspeção/serviço).', campos: [
    { chave: 'codigo', rotulo: 'Código', tipo: 'texto', obrigatorio: true },
    { chave: 'nome', rotulo: 'Causa', tipo: 'texto', obrigatorio: true },
    { chave: 'evitavel', rotulo: 'Evitável', tipo: 'bool' },
    { chave: 'atividade', rotulo: 'Atividade relacionada', tipo: 'selecao', opcoes: () => [...Object.entries(CATEGORIAS), ['NENHUMA', 'Nenhuma']] },
    { chave: 'janelaDias', rotulo: 'Janela (dias)', tipo: 'numero', min: 0, max: 730 }] },
  motivos: { titulo: 'Motivos de reprogramação', tipo: 'tabela', editores: ADM_GESTOR, campos: [
    { chave: 'id', rotulo: 'Código', tipo: 'texto', obrigatorio: true },
    { chave: 'nome', rotulo: 'Motivo', tipo: 'texto', obrigatorio: true }] },
  metas: { titulo: 'Metas e prazos', tipo: 'objeto', editores: ADM_GESTOR, campos: [
    { chave: 'aderenciaPlano', rotulo: 'Meta de aderência ao plano (%)', tipo: 'numero', min: 0, max: 100 },
    { chave: 'completude', rotulo: 'Meta de inspeções completas (%)', tipo: 'numero', min: 0, max: 100 },
    { chave: 'aderenciaProgramacao', rotulo: 'Meta de aderência à programação (%)', tipo: 'numero', min: 0, max: 100 },
    { chave: 'eficacia', rotulo: 'Meta de eficácia (%)', tipo: 'numero', min: 0, max: 100 },
    { chave: 'slaCriticos', rotulo: 'Meta de defeitos A no prazo (%)', tipo: 'numero', min: 0, max: 100 },
    { chave: 'slaA', rotulo: 'Prazo para executar defeito A (dias)', tipo: 'numero', min: 1 },
    { chave: 'slaB', rotulo: 'Prazo para executar defeito B (dias)', tipo: 'numero', min: 1 },
    { chave: 'slaC', rotulo: 'Prazo para executar defeito C (dias)', tipo: 'numero', min: 1 }] },
  geral: { titulo: 'Campo e programação', tipo: 'objeto', editores: ADM, campos: [
    { chave: 'raioValidacaoM', rotulo: 'Raio de validação da posição (m)', tipo: 'numero', min: 10, max: 500 },
    { chave: 'raioAlertaM', rotulo: 'Raio do alerta de proximidade (m)', tipo: 'numero', min: 30, max: 2000 },
    { chave: 'janelaProgramacaoDias', rotulo: 'Antecedência para gerar inspeções (dias)', tipo: 'numero', min: 1, max: 120 },
    { chave: 'horasDiaEquipe', rotulo: 'Horas produtivas por equipe/dia', tipo: 'numero', min: 1, max: 12 },
    { chave: 'diasUteisSemana', rotulo: 'Dias úteis na semana', tipo: 'numero', min: 1, max: 7 },
    { chave: 'coberturaMinPct', rotulo: 'Cobertura mínima do trecho para inspeção completa (%)', tipo: 'numero', min: 50, max: 100 },
    { chave: 'faixaTrilhaM', rotulo: 'Faixa do trajeto em volta da rede (m)', tipo: 'numero', min: 5, max: 200 },
    { chave: 'raioEscolaM', rotulo: 'Raio padrão em volta de escolas (m)', tipo: 'numero', min: 50, max: 2000 },
    { chave: 'raioAtribuicaoM', rotulo: 'Distância máxima para ligar ocorrência a trecho/ativo (m)', tipo: 'numero', min: 50, max: 2000 }] },
  risco: { titulo: 'Pesos do score de risco', tipo: 'objeto', editores: ADM, campos: Object.keys(RISCO).map((k) => ({ chave: k, rotulo: k, tipo: 'numero', min: 0 })) },
  ranking: { titulo: 'Pontuação do ranking', tipo: 'objeto', editores: ADM, campos: Object.keys(PADRAO.ranking).map((k) => ({ chave: k, rotulo: k, tipo: 'numero' })) },
  seguranca: { titulo: 'Política de acesso', tipo: 'objeto', editores: ADM, ajuda: 'Limites mínimos protegidos: não é possível afrouxar abaixo do permitido.', campos: [
    { chave: 'senhaMinimo', rotulo: 'Tamanho mínimo da senha', tipo: 'numero', min: 8, max: 64 },
    { chave: 'historicoSenhas', rotulo: 'Senhas anteriores que não podem repetir', tipo: 'numero', min: 1, max: 10 },
    { chave: 'tentativasMaximas', rotulo: 'Tentativas antes do bloqueio', tipo: 'numero', min: 3, max: 10 },
    { chave: 'bloqueioMinutos', rotulo: 'Minutos de bloqueio', tipo: 'numero', min: 5, max: 1440 },
    { chave: 'inatividadeMinutos', rotulo: 'Bloqueio por inatividade (min)', tipo: 'numero', min: 5, max: 60 },
    { chave: 'sessaoMaximaHoras', rotulo: 'Duração máxima da sessão (h)', tipo: 'numero', min: 1, max: 12 }] },
};

// ---------- Versões ----------
const repo = () => (estado.dados.parametros ||= { versoes: [] });

/** Valor vigente de um grupo numa data (padrão: hoje). */
export function valor(grupo, data = hojeISO()) {
  const v = repo().versoes.filter((x) => x.grupo === grupo && x.vigencia <= data).sort((a, b) => (a.vigencia === b.vigencia ? a.em.localeCompare(b.em) : a.vigencia.localeCompare(b.vigencia))).at(-1);
  if (!v) return copia(PADRAO[grupo]);
  // Grupos de campos: completa com o padrão campos criados depois da versão salva.
  return ESQUEMA[grupo]?.tipo === 'objeto' ? { ...copia(PADRAO[grupo]), ...copia(v.valores) } : copia(v.valores);
}
export const versoes = (grupo) => repo().versoes.filter((x) => x.grupo === grupo).sort((a, b) => b.em.localeCompare(a.em));
export const podeEditar = (grupo) => ESQUEMA[grupo]?.editores.includes(estado.usuario?.perfil);

export class ErroParametro extends Error {}

function validarCampo(c, v, onde) {
  if (c.tipo === 'numero') {
    const n = Number(v);
    if (v === '' || v === null || Number.isNaN(n)) throw new ErroParametro(`${onde}: "${c.rotulo}" precisa ser número.`);
    if (c.min !== undefined && n < c.min) throw new ErroParametro(`${onde}: "${c.rotulo}" mínimo ${c.min}.`);
    if (c.max !== undefined && n > c.max) throw new ErroParametro(`${onde}: "${c.rotulo}" máximo ${c.max}.`);
    return n;
  }
  if (c.tipo === 'bool') return v === true || v === 'true';
  if (c.tipo === 'multi') {
    const lista = (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim().toUpperCase()).filter(Boolean);
    const validos = c.opcoes().map(([k]) => k);
    const fora = lista.filter((x) => !validos.includes(x));
    if (fora.length) throw new ErroParametro(`${onde}: "${c.rotulo}" não aceita ${fora.join(', ')} (use: ${validos.join(', ')}).`);
    return lista;
  }
  const s = String(v ?? '').trim().slice(0, 300);
  if (c.tipo === 'selecao' && !c.opcoes().some(([k]) => k === s)) throw new ErroParametro(`${onde}: "${c.rotulo}" inválido (${s || 'vazio'}).`);
  if (c.obrigatorio && !s) throw new ErroParametro(`${onde}: "${c.rotulo}" é obrigatório.`);
  if (c.tipo === 'mes' && !/^\d{4}-\d{2}$/.test(s)) throw new ErroParametro(`${onde}: mês no formato AAAA-MM.`);
  if (c.tipo === 'itens' && s && !s.split(';').every((p) => /^\s*[A-Z0-9-]+\s*:\s*\d+([.,]\d+)?(\/u)?\s*$/i.test(p))) throw new ErroParametro(`${onde}: itens no formato CÓDIGO:quantidade; use /u para multiplicar pela extensão.`);
  return s;
}

export function salvarVersao(grupo, valores, vigencia, motivo) {
  const esq = ESQUEMA[grupo];
  if (!esq) throw new ErroParametro('Grupo inexistente.');
  if (!podeEditar(grupo)) {
    logar({ categoria: 'SEGURANCA', acao: 'PARAMETRO_NEGADO', resultado: 'NEGADO', entidade: 'parametro', entidadeId: grupo });
    throw new ErroParametro('Seu perfil não pode alterar este grupo de parâmetros.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigencia || '')) throw new ErroParametro('Informe a data de início da vigência.');
  if (vigencia < hojeISO()) throw new ErroParametro('A vigência não pode começar no passado (o histórico não é recalculado).');
  if (!motivo?.trim()) throw new ErroParametro('Informe o motivo da alteração.');
  let limpos;
  if (esq.tipo === 'tabela') {
    if (!Array.isArray(valores) || !valores.length) throw new ErroParametro('A tabela não pode ficar vazia.');
    limpos = valores.map((linha, i) => ({ ...linha, ...Object.fromEntries(esq.campos.map((c) => [c.chave, validarCampo(c, linha[c.chave], `Linha ${i + 1}`)])) }));
    const chave = esq.campos[0].chave;
    if (esq.campos[0].obrigatorio) {
      const vistos = new Set();
      for (const l of limpos) { if (vistos.has(l[chave])) throw new ErroParametro(`Código repetido: ${l[chave]}.`); vistos.add(l[chave]); }
    }
  } else {
    limpos = Object.fromEntries(esq.campos.map((c) => [c.chave, validarCampo(c, valores[c.chave], esq.titulo)]));
  }
  const anterior = valor(grupo, vigencia);
  const versao = { id: `${grupo}-${Date.now()}`, grupo, vigencia, em: new Date().toISOString(), por: estado.usuario.id, motivo: motivo.trim().slice(0, 300), valores: limpos };
  repo().versoes.push(versao);
  persistir();
  logar({ categoria: 'ADMIN', acao: 'PARAMETRO_ALTERADO', entidade: 'parametro', entidadeId: grupo, detalhe: { vigencia, motivo: versao.motivo, resumo: resumoMudanca(esq, anterior, limpos) } });
  aplicarParametros();
  emitir('mudou');
  return versao;
}

function resumoMudanca(esq, antes, depois) {
  if (esq.tipo === 'tabela') return { linhasAntes: antes.length, linhasDepois: depois.length };
  return Object.fromEntries(esq.campos.filter((c) => antes[c.chave] !== depois[c.chave]).map((c) => [c.chave, { de: antes[c.chave], para: depois[c.chave] }]));
}

/** Aplica os valores vigentes hoje nos objetos de domínio usados pelo app. */
export function aplicarParametros() {
  const g = valor('geral'), m = valor('metas');
  Object.assign(PARAM, g, { sla: { A: m.slaA, B: m.slaB, C: m.slaC }, metas: { aderenciaPlano: m.aderenciaPlano / 100, completude: m.completude / 100, aderenciaProgramacao: m.aderenciaProgramacao / 100, slaCriticos: m.slaCriticos / 100, eficacia: m.eficacia / 100 } });
  Object.assign(RISCO, valor('risco'));
  const r = valor('ranking');
  Object.assign(PONTOS, { inspecaoBase: r.inspecaoBase, inspecaoAtrasada: r.inspecaoAtrasada, defeitoRejeitado: r.defeitoRejeitado,
    defeitoValidado: { A: r.defeitoValidadoA, B: r.defeitoValidadoB, C: r.defeitoValidadoC }, execucao: { A: r.execucaoA, B: r.execucaoB, C: r.execucaoC } });
  CRITERIOS.splice(0, CRITERIOS.length, ...valor('criterios'));
  TIPOS_DEFEITO.splice(0, TIPOS_DEFEITO.length, ...valor('tiposDefeito').map((t) => ({ ...t, ativos: t.ativos?.length ? t.ativos : undefined })));
  Object.assign(POLITICA, valor('seguranca'));
}
