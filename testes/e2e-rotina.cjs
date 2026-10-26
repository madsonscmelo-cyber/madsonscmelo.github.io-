// Rotina UTD — teste ponta a ponta + checklist de usabilidade/segurança executável (fases 1.4, 2, 3, 4, 6, 8 e 9).
// Uso: cd testes && npm install && npx playwright install chromium && npm run e2e:rotina
// As regras são provadas chamando os módulos direto no navegador com o perfil mais fraco (checklist 6.9), não só pelo botão.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { iniciar } = require('./servidor.cjs');

const RAIZ = path.resolve(__dirname, '..');
const CSV_ERROS = path.join(RAIZ, 'rotina', 'modelos', 'exemplo-catalogo-com-erros.csv');
const SAIDA = path.join(__dirname, 'saida', 'rotina');
fs.mkdirSync(SAIDA, { recursive: true });
let AXE = null;
try { AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); } catch { /* axe-core opcional: sem ele, o teste de acessibilidade é marcado como não executado */ }

const resultados = [];
function registrar(id, nome, passou, evidencia) {
  resultados.push({ id, nome, passou, evidencia });
  console.log(`${passou ? '✅' : '⚠️ '} ${id} ${nome} — ${evidencia}`);
}

const SENHA_INICIAL = 'Rotina@2026', SENHA_NOVA = 'Turno#Verde2026';

(async () => {
  const srv = await iniciar(RAIZ);
  const BASE = `http://127.0.0.1:${srv.address().port}/rotina/`;
  const browser = await chromium.launch();
  const erros = [];
  const vigiar = (p) => {
    p.on('console', (m) => { if (m.type() === 'error' && !/net::ERR|Failed to load resource/.test(m.text())) erros.push(m.text()); });
    p.on('pageerror', (e) => erros.push(e.message));
  };
  /** Executa código no navegador com os módulos do app (como um atacante faria pelo console). */
  const mod = (p, fn, arg) => p.evaluate(fn, arg);
  const sair = async (p) => { await p.click('#btn-usuario'); await p.click('.menu__item:has-text("Sair")'); await p.waitForSelector('#login input[autocomplete=username]'); };
  const entrar = async (p, mat) => {
    await p.waitForFunction(() => !document.querySelector('#login').hidden || document.querySelector('#nav').childElementCount > 0, null, { timeout: 20000 });
    if (await p.locator('#login').isHidden()) await sair(p);
    p.__trocadas ||= new Set();
    await p.fill('#login input[autocomplete=username]', mat);
    await p.fill('#login input[autocomplete=current-password]', p.__trocadas.has(mat) ? SENHA_NOVA : SENHA_INICIAL);
    await p.click('#login button[type=submit]');
    await p.waitForFunction(() => document.querySelector('#login').hidden || document.querySelector('#login input[autocomplete=new-password]') || document.querySelector('.login__msg')?.textContent, null, { timeout: 15000 });
    if (await p.locator('#login input[autocomplete=new-password]').count()) {
      const [n1, n2] = await p.locator('#login input[autocomplete=new-password]').all();
      await n1.fill(SENHA_NOVA); await n2.fill(SENHA_NOVA);
      await p.click('#login button[type=submit]');
      await p.waitForFunction(() => document.querySelector('#login').hidden, null, { timeout: 15000 });
      p.__trocadas.add(mat);
    }
    await p.waitForTimeout(250);
  };
  const irPara = async (p, tela) => { await p.click(`#nav .nav__btn[data-view=${tela}]`); await p.waitForTimeout(250); };
  const ultimoToast = async (p) => (await p.locator('.toast').allInnerTexts()).at(-1) || '';
  const fecharToasts = (p) => p.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, serviceWorkers: 'block', acceptDownloads: true });
    const p = await ctx.newPage();
    vigiar(p);
    await p.goto(BASE);

    // ================= Fase 2 — autenticação =================
    await p.waitForSelector('#login input[autocomplete=username]');
    const msgLogin = async (mat, senha) => {
      await p.fill('#login input[autocomplete=username]', mat); await p.fill('#login input[autocomplete=current-password]', senha);
      await p.click('#login button[type=submit]');
      await p.waitForFunction(() => document.querySelector('.login__msg')?.textContent, null, { timeout: 15000 });
      return p.locator('.login__msg').innerText();
    };
    const mInexistente = await msgLogin('Z9999', 'qualquer');
    const mErrada = await msgLogin('R1102', 'SenhaErrada#1');
    registrar('2.2', 'Senha errada e matrícula inexistente têm a mesma mensagem', mInexistente === mErrada && /inválidas/.test(mErrada), `"${mErrada}"`);

    await p.fill('#login input[autocomplete=username]', 'R1101'); await p.fill('#login input[autocomplete=current-password]', SENHA_INICIAL);
    await p.click('#login button[type=submit]');
    await p.waitForSelector('#login input[autocomplete=new-password]');
    const [n1, n2] = await p.locator('#login input[autocomplete=new-password]').all();
    await n1.fill('Paulo#2026abc'); await n2.fill('Paulo#2026abc');
    await p.click('#login button[type=submit]');
    await p.waitForTimeout(400);
    const recusaNome = await p.locator('.login__msg').innerText();
    await n1.fill(SENHA_NOVA); await n2.fill(SENHA_NOVA);
    await p.click('#login button[type=submit]');
    await p.waitForFunction(() => document.querySelector('#login').hidden, null, { timeout: 15000 });
    p.__trocadas = new Set(['R1101']);
    registrar('2.1/2.8', 'Primeiro acesso obriga criar senha pessoal; senha com o nome é recusada', /matrícula nem seu nome/.test(recusaNome), `recusa: "${recusaNome.slice(0, 80)}" · depois entrou com a senha pessoal`);
    await p.waitForTimeout(300);

    // ================= Colaborador: Hoje, concluir, rascunho, progresso =================
    const hojeTxt = await p.locator('#view-hoje').innerText();
    const nItens = await p.locator('#view-hoje .bloco:not(.bloco--critico) .oc').count();
    registrar('HOJE-1', 'Retaguarda abre no dia, em ordem de horário, com progresso e uma ação principal', /Hoje: 0 de \d+/.test(hojeTxt) && nItens > 0 && await p.locator('#view-hoje .rodape-fixo .btn--grande').count() === 1,
      `${nItens} atividade(s) · "${(hojeTxt.match(/Hoje: \d+ de \d+/) || [''])[0]}" · 1 botão principal`);

    const alvo = await mod(p, async () => {
      const { estado } = await import('./js/store.js'); const D = await import('./js/dominio.js'); const { hojeISO } = await import('./js/util.js');
      return D.ocorrencias(estado.dados, { ini: hojeISO(), fim: hojeISO(), usuarios: [estado.usuario] }).find((o) => o.status === 'HOJE' && o.horario !== 'CONT')?.chave;
    });
    await p.click(`#view-hoje .bloco:not(.bloco--critico) .oc[data-chave="${alvo}"]`);
    await p.click('#sheet-rodape button:has-text("Concluir")');
    await p.click('#sheet-rodape button:has-text("Concluir com evidência")');
    const semEv = await ultimoToast(p);
    await p.fill('#sheet textarea', 'Relatório D-1 enviado');
    await p.click('#sheet-fechar');
    await p.waitForTimeout(400);
    const aviso = await p.locator('#view-hoje .rascunho').innerText().catch(() => '');
    await p.click('#view-hoje .rascunho');
    const recuperado = await p.locator('#sheet textarea').inputValue();
    registrar('UX-ZEIGARNIK', 'Evidência começada vira rascunho, aparece no Hoje e é retomada', /Evidência começada/.test(aviso) && recuperado === 'Relatório D-1 enviado', `"${aviso.replace(/\n/g, ' ')}" → "${recuperado}"`);
    await p.fill('#sheet textarea', 'Relatório D-1 enviado ao grupo da UTD às 08h40');
    await p.click('#sheet-rodape button:has-text("Concluir com evidência")');
    await p.waitForTimeout(400);
    const okConc = await ultimoToast(p);
    const exConc = await mod(p, async (c) => { const { estado } = await import('./js/store.js'); return estado.dados.execucoes[c]; }, alvo);
    registrar('ROT-1', 'Concluir exige evidência do produto; com evidência conclui e conta na aderência', /evidência do produto/.test(semEv) && !!exConc?.concluidaEm && /aderência/.test(okConc), `sem evidência: "${semEv.slice(0, 60)}" · com evidência: "${okConc}"`);
    const prog = await p.locator('#view-hoje .progresso-dia').innerText();
    registrar('UX-GRADIENTE', 'Progresso do dia avança ao concluir', /Hoje: 1 de \d+/.test(prog), prog.replace(/\n/g, ' '));

    // ================= Remanejamento =================
    const dados = await mod(p, async () => {
      const { estado } = await import('./js/store.js'); const D = await import('./js/dominio.js'); const U = await import('./js/util.js');
      const hoje = U.hojeISO(), per = D.periodoSemana(U.semanaISO(hoje));
      const lista = D.ocorrencias(estado.dados, { ini: hoje, fim: per.fim, usuarios: [estado.usuario] });
      const diaria = lista.find((o) => o.periodicidade === 'D' && o.status === 'HOJE' && o.horario !== 'CONT');
      const semanal = lista.find((o) => o.periodicidade === 'W' && o.status !== 'CONCLUIDA' && o.status !== 'AGUARDA');
      const proxUtil = D.proximoUtil(estado.dados, U.somarDias(hoje, 1));
      const semanaQueVem = D.proximoUtil(estado.dados, U.somarDias(per.ini, 8));
      return { diaria: diaria?.chave, semanal: semanal?.chave, proxUtil, semanaQueVem, depois: D.proximoUtil(estado.dados, U.somarDias(proxUtil, 1)) };
    });
    await p.evaluate((c) => import('./js/ui.js').then((u) => u.abrirOcorrencia(c)), dados.diaria);
    await p.click('#sheet-rodape button:has-text("Remanejar")');
    await p.fill('#sheet input[type=date]', dados.proxUtil);
    await p.dispatchEvent('#sheet input[type=date]', 'change');
    await p.click('#sheet-rodape button');
    const semMotivo = await ultimoToast(p);
    await p.selectOption('#sheet select', 'REUNIAO');
    const avisoJanela = await p.locator('#sheet .resumo[role=status]').innerText();
    await p.click('#sheet-rodape button');
    await p.waitForTimeout(300);
    const r1 = await mod(p, async (c) => { const { estado } = await import('./js/store.js'); const D = await import('./js/dominio.js'); return D.ocorrenciaPorChave(estado.dados, c); }, dados.diaria);
    registrar('ROT-2', 'Remanejar exige motivo; dentro da janela da periodicidade aplica na hora', /motivo/.test(semMotivo) && /aplica na hora/.test(avisoJanela) && r1.data === dados.proxUtil && r1.remanejada,
      `sem motivo: "${semMotivo}" · ${avisoJanela} · nova data ${r1.data}`);
    const r2 = await mod(p, async (a) => (await import('./js/acoes.js')).remanejar(a.c, { para: a.d, motivo: 'SISTEMA' }), { c: dados.diaria, d: dados.depois });
    const r3 = await mod(p, async (a) => (await import('./js/acoes.js')).remanejar(a.c, { para: a.d, motivo: 'AUSENCIA' }), { c: dados.semanal, d: dados.semanaQueVem });
    registrar('ROT-3', '2º remanejamento e remanejamento fora da janela viram pedido ao supervisor', !r2.aplicado && /2º remanejamento/.test(r2.motivosAprovacao.join()) && !r3.aplicado && /fora da janela/.test(r3.motivosAprovacao.join()),
      `2º: ${r2.motivosAprovacao.join('; ')} · fora: ${r3.motivosAprovacao.join('; ')}`);
    const negados = await mod(p, async (a) => {
      const A = await import('./js/acoes.js'); const { estado } = await import('./js/store.js'); const D = await import('./js/dominio.js'); const U = await import('./js/util.js');
      const tentar = (fn) => { try { fn(); return 'PERMITIDO'; } catch (e) { return e.message; } };
      const outra = D.ocorrencias(estado.dados, { ini: U.hojeISO(), fim: U.hojeISO(), usuarios: D.colaboradores(estado.dados).filter((x) => x.id === 'u-r1102') })[0];
      return {
        concluirDeOutro: tentar(() => A.concluir(outra.chave, 'Evidência forjada pelo console')),
        remanejarDeOutro: tentar(() => A.remanejar(outra.chave, { para: a.d, motivo: 'SISTEMA' })),
        autoaprovar: tentar(() => A.decidirPedido(a.c, true)),
        editarCatalogo: tentar(() => A.editarAtividade(estado.dados.atividades[0].id, { duracaoMin: 5 }, { motivo: 'tentativa pelo console' })),
        ocupacao: tentar(() => A.definirOcupacao('u-r1102', { utd: 'JAC', cargo: 'TCO' })),
      };
    }, { c: dados.semanal, d: dados.proxUtil });
    registrar('3.6/6.9', 'Retaguarda chamando os módulos direto: concluir/remanejar de outro, decidir, editar catálogo e ocupação → bloqueados',
      Object.values(negados).every((v) => v !== 'PERMITIDO'), Object.entries(negados).map(([k, v]) => `${k}: ${v.slice(0, 40)}`).join(' | '));
    await fecharToasts(p);

    // ================= Supervisor: aprovações, autoaprovação, segregação =================
    await entrar(p, 'S1001');
    const cartao = await p.locator('#view-hoje .hoje-card').first().innerText();
    registrar('HOJE-2', 'Supervisor abre em até 3 decisões, a mais urgente primeiro', /aguardando você/.test(cartao) && await p.locator('#view-hoje .hoje-card').count() <= 3, cartao.split('\n').slice(0, 3).join(' · '));
    await p.click('#view-hoje .hoje-card >> nth=0 >> button');
    await p.waitForTimeout(300);
    const nPend = await p.locator('#view-equipe .pedido').count();
    // Aprova o 2º remanejamento da diária pela interface
    await p.locator('#view-equipe .pedido', { hasText: r1.nome }).locator('button:has-text("Aprovar")').first().click();
    await p.waitForTimeout(300);
    const aprov = await mod(p, async (c) => { const { estado } = await import('./js/store.js'); const D = await import('./js/dominio.js'); return D.ocorrenciaPorChave(estado.dados, c); }, dados.diaria);
    const recusa = await mod(p, async (c) => { const A = await import('./js/acoes.js'); try { A.decidirPedido(c, false, ''); return 'PERMITIDO'; } catch (e) { return e.message; } }, dados.semanal);
    await mod(p, async (c) => (await import('./js/acoes.js')).decidirPedido(c, false, 'Semana que vem tem fechamento; mantenha a data'), dados.semanal);
    const recusada = await mod(p, async (c) => { const { estado } = await import('./js/store.js'); return estado.dados.execucoes[c].remanejamentos.at(-1); }, dados.semanal);
    registrar('ROT-4', 'Supervisor aprova pela fila; recusa exige justificativa e fica no histórico', aprov.data === dados.depois && /justificativa/.test(recusa) && recusada.situacao === 'RECUSADO',
      `${nPend} pedido(s) na fila · aprovado → ${aprov.data} · recusa vazia: "${recusa}" · recusa registrada`);
    const auto = await mod(p, async (a) => {
      const A = await import('./js/acoes.js'); const { estado } = await import('./js/store.js'); const D = await import('./js/dominio.js'); const U = await import('./js/util.js');
      const o = D.ocorrencias(estado.dados, { ini: U.hojeISO(), fim: U.hojeISO(), usuarios: D.colaboradores(estado.dados).filter((x) => x.id === 'u-r1103') }).find((x) => x.status === 'HOJE');
      A.remanejar(o.chave, { para: a.d, motivo: 'REUNIAO' });
      A.remanejar(o.chave, { para: a.d2, motivo: 'REUNIAO' }).aplicado;
      try { A.decidirPedido(o.chave, true); return { r: 'PERMITIDO' }; } catch (e) { return { r: e.message, chave: o.chave }; }
    }, { d: dados.proxUtil, d2: dados.depois });
    registrar('3.7', 'Ninguém aprova o próprio pedido (supervisor pede e tenta aprovar)', /próprio pedido/.test(auto.r), auto.r);
    const equipeTxt = await p.locator('#view-equipe').innerText();
    await entrar(p, 'S1002');
    const seg = await mod(p, async (c) => {
      const A = await import('./js/acoes.js'); const { estado } = await import('./js/store.js'); const D = await import('./js/dominio.js');
      let decidir; try { A.decidirPedido(c, true); decidir = 'PERMITIDO'; } catch (e) { decidir = e.message; }
      return { decidir, podeJUA: A.podeGerirUtd('JUA'), pessoas: D.colaboradores(estado.dados).length };
    }, auto.chave);
    await irPara(p, 'equipe');
    const telaJac = await p.locator('#view-equipe table').innerText();
    registrar('3.3', 'Segregação por UTD: supervisor de Jacobina não decide pedido de Juazeiro nem vê a equipe de lá', seg.decidir !== 'PERMITIDO' && !seg.podeJUA && !/Juazeiro/.test(telaJac) && /Juazeiro/.test(equipeTxt),
      `decidir: "${seg.decidir}" · tabela de Jacobina sem pessoas de Juazeiro`);

    // ================= Gerência: aprova pedido do supervisor, catálogo, importação, transferência, feriado =================
    await entrar(p, 'G1001');
    const gerApr = await mod(p, async (c) => { const A = await import('./js/acoes.js'); try { A.decidirPedido(c, true); return 'OK'; } catch (e) { return e.message; } }, auto.chave);
    registrar('3.7b', 'Pedido do supervisor vai para a gerência e ela decide', gerApr === 'OK', gerApr);

    const edit = await mod(p, async () => {
      const A = await import('./js/acoes.js'); const { estado } = await import('./js/store.js'); const D = await import('./js/dominio.js'); const U = await import('./js/util.js');
      const atv = estado.dados.atividades.find((a) => D.versaoAtual(a).periodicidade === 'Q' && D.versaoAtual(a).situacao === 'R');
      let semMotivo; try { A.editarAtividade(atv.id, { periodicidade: 'W' }, { motivo: '' }); semMotivo = 'PERMITIDO'; } catch (e) { semMotivo = e.message; }
      let passado; try { A.editarAtividade(atv.id, { periodicidade: 'W' }, { desde: U.somarDias(U.hojeISO(), -3), motivo: 'Tentativa de mudar o passado' }); passado = 'PERMITIDO'; } catch (e) { passado = e.message; }
      const antes = D.versaoEm(atv, U.somarDias(U.hojeISO(), -10)).periodicidade;
      A.editarAtividade(atv.id, { periodicidade: 'W', duracaoMin: 45 }, { motivo: 'Validado com o time da UTD: semanal, 45 min' });
      return { semMotivo, passado, antes, depoisPassado: D.versaoEm(atv, U.somarDias(U.hojeISO(), -10)).periodicidade, agora: D.versaoAtual(atv).periodicidade, versoes: atv.versoes.length, validada: D.versaoAtual(atv).validada };
    });
    registrar('CAT-1', 'Catálogo com vigência: exige motivo, não altera o passado, nova versão vale de hoje em diante', /motivo/.test(edit.semMotivo) && /passado/.test(edit.passado) && edit.antes === 'Q' && edit.depoisPassado === 'Q' && edit.agora === 'W' && edit.validada,
      `sem motivo: recusado · vigência no passado: recusada · há 10 dias: ${edit.depoisPassado} · hoje: ${edit.agora} · ${edit.versoes} versões`);

    await irPara(p, 'catalogo');
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#view-catalogo button:has-text("Importar CSV")')]);
    await fc.setFiles(CSV_ERROS);
    await p.waitForTimeout(500);
    const rel = await p.locator('#view-catalogo section[role=status]').innerText();
    registrar('CAT-2', 'Importação do catálogo valida linha a linha (cargo, dia, duração, código repetido)', /4 linha\(s\) aceita\(s\)/.test(rel) && /4 rejeitada/.test(rel), rel.split('\n').find((l) => /aceita/.test(l)));
    await p.fill('#view-catalogo input[type=search]', 'fórmula');
    await p.press('#view-catalogo input[type=search]', 'Enter');
    await p.waitForTimeout(200);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#view-catalogo button:has-text("Exportar CSV")')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    registrar('4.8', 'CSV exportado neutraliza fórmula (célula iniciada por @ = + -)', csv.includes("'@SUM(A1)") && !/;@SUM/.test(csv), "célula exportada como '@SUM(A1)…");

    const transf = await mod(p, async () => {
      const A = await import('./js/acoes.js'); const { estado } = await import('./js/store.js'); const D = await import('./js/dominio.js'); const U = await import('./js/util.js');
      const atv = estado.dados.atividades.find((a) => D.versaoAtual(a).situacao === 'T' && !a.aceite && D.versaoAtual(a).periodicidade === 'W');
      const per = D.periodoSemana(U.deslocarSemana(U.semanaISO(U.hojeISO()), 1));
      const naAgenda = () => D.ocorrencias(estado.dados, { ini: per.ini, fim: per.fim }).filter((o) => o.atvId === atv.id).length;
      const antes = naAgenda();
      const etiqueta = D.ocorrencias(estado.dados, { ini: per.ini, fim: per.fim }).find((o) => o.atvId === atv.id)?.emTransferencia;
      let semObs; try { A.registrarAceite(atv.id, { desde: U.hojeISO(), obs: '' }); semObs = 'PERMITIDO'; } catch (e) { semObs = e.message; }
      A.registrarAceite(atv.id, { desde: U.hojeISO(), obs: 'Aceite por e-mail do coordenador da área destino' });
      return { antes, depois: naAgenda(), etiqueta, semObs };
    });
    registrar('TRANSF-1', 'Transferência sem aceite continua na agenda (marcada); com aceite registrado sai', transf.antes > 0 && transf.etiqueta && transf.depois === 0 && /aceite/.test(transf.semObs),
      `semana que vem: ${transf.antes} ocorrência(s) antes do aceite → ${transf.depois} depois`);

    const fer = await mod(p, async () => {
      const A = await import('./js/acoes.js'); const { estado } = await import('./js/store.js'); const D = await import('./js/dominio.js'); const U = await import('./js/util.js');
      const per = D.periodoSemana(U.deslocarSemana(U.semanaISO(U.hojeISO()), 1));
      const seg = per.dias[0], ter = per.dias[1];
      const r = D.regras(estado.dados);
      // Garante feriado na segunda que vem (a regra é gravada mesmo se ele já existir: nova versão com motivo).
      A.alterarRegras({ capacidadeDiariaMin: r.capacidadeDiariaMin, feriados: D.ehFeriado(estado.dados, seg) ? r.feriados : [...r.feriados, { data: seg, nome: 'Feriado de teste' }] }, 'Teste automatizado: feriado na segunda');
      const u = D.colaboradores(estado.dados).find((x) => x.id === 'u-r1105'); // Assistente Geral: EPI e EPC toda segunda
      const l = D.ocorrencias(estado.dados, { ini: per.ini, fim: per.fim, usuarios: [u] });
      const epi = l.find((o) => o.nome.startsWith('Controle de entrega de EPI'));
      return { seg, segunda: l.filter((o) => o.data === seg).length, epiData: epi?.data, ter, diariasTer: l.filter((o) => o.data === ter && o.periodicidade === 'D').length };
    });
    registrar('FERIADO-1', 'Feriado: rotina diária não acontece e a semanal desliza para o próximo dia útil', fer.segunda === 0 && fer.epiData === fer.ter && fer.diariasTer > 0, `${fer.seg} sem atividades · semanal de segunda foi para ${fer.epiData}`);

    await p.click('#view-catalogo .abas__btn:has-text("Achados")');
    await p.waitForTimeout(200);
    const ach = await p.locator('#view-catalogo').innerText();
    registrar('ACHADOS-1', 'Achados mostram R duplicado, carga por cargo, sem A, estimadas e transferências sem aceite', /Mais de um responsável/.test(ach) && /Carga programada/.test(ach) && /Sem aprovador/.test(ach) && /estimadas/.test(ach) && /sem aceite/.test(ach), 'as 5 seções presentes');

    // ================= Logs: cobertura, sem senha, integridade, adulteração =================
    const logs = await mod(p, async () => (await (await import('./js/auditoria.js')).todosLogs()));
    const acoes = new Set(logs.map((l) => l.acao));
    const esperadas = ['LOGIN_FALHA', 'LOGIN_SUCESSO', 'SENHA_ALTERADA', 'SENHA_RECUSADA_POLITICA', 'OCORRENCIA_CONCLUIDA', 'REMANEJAMENTO_APLICADO', 'REMANEJAMENTO_SOLICITADO', 'REMANEJAMENTO_APROVADO', 'REMANEJAMENTO_RECUSADO', 'ACAO_NEGADA', 'ATIVIDADE_ALTERADA', 'CATALOGO_IMPORTADO', 'CATALOGO_EXPORTADO', 'TRANSFERENCIA_ACEITA', 'REGRAS_ALTERADAS', 'TELA_ABERTA'];
    const faltam = esperadas.filter((a) => !acoes.has(a));
    registrar('LOG-1', 'Log cobre login, conclusão, remanejamento, decisões, negações, catálogo, importação e exportação', !faltam.length, faltam.length ? `faltam: ${faltam.join(', ')}` : `${logs.length} registros · ${acoes.size} tipos de ação`);
    const texto = JSON.stringify(logs);
    registrar('LOG-2', 'Nenhuma senha (certa ou errada) no log', ![SENHA_INICIAL, SENHA_NOVA, 'SenhaErrada#1', 'Paulo#2026abc'].some((s) => texto.includes(s)), 'varredura do log inteiro');
    const integ = await mod(p, async () => (await import('./js/auditoria.js')).verificarIntegridade());
    const adult = await mod(p, async () => {
      const { idb } = await import('./js/store.js'); const a = await import('./js/auditoria.js');
      const r = await idb('logs', 'readonly', (s) => s.get(3));
      r.detalhe = { adulterado: true };
      await idb('logs', 'readwrite', (s) => s.put(r));
      return a.verificarIntegridade();
    });
    registrar('LOG-3', 'Cadeia SHA-256 íntegra e adulteração detectada', integ.ok && !adult.ok && /registro 3/.test(adult.motivo), `antes: ${integ.total} íntegros · depois: "${adult.motivo}"`);

    // ================= Sessão: inatividade e revogação =================
    await entrar(p, 'R1104');
    await p.evaluate(() => { const k = 'rotina-sessao'; const s = JSON.parse(sessionStorage.getItem(k)); s.atividade -= 21 * 60000; sessionStorage.setItem(k, JSON.stringify(s)); document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(400);
    const bloqueio = await p.locator('#login').innerText();
    registrar('2.7', 'Inatividade (20 min) bloqueia a tela e pede a senha', /bloqueada por inatividade/.test(bloqueio), bloqueio.split('\n').find((l) => /bloqueada/.test(l)));
    await p.fill('#login input[autocomplete=current-password]', SENHA_NOVA);
    await p.click('#login button[type=submit]');
    await p.waitForFunction(() => document.querySelector('#login').hidden);
    await p.evaluate(async () => { const { estado } = await import('./js/store.js'); estado.dados.usuarios.find((u) => u.matricula === 'R1104').ativo = false; document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(400);
    registrar('2.10', 'Usuário bloqueado pelo gestor é derrubado ao voltar ao app', await p.locator('#login input[autocomplete=username]').isVisible(), 'sessão encerrada e tela de login');
    await p.evaluate(async () => { const { estado, persistir } = await import('./js/store.js'); estado.dados.usuarios.find((u) => u.matricula === 'R1104').ativo = true; await persistir(); });

    // ================= Offline simulado: fila e sincronização =================
    await entrar(p, 'R1101');
    await p.click('#btn-usuario'); await p.click('.menu__item:has-text("Simular modo offline")');
    await mod(p, async () => {
      const A = await import('./js/acoes.js'); const { estado } = await import('./js/store.js');
      const atv = estado.dados.atividades.find((a) => a.versoes.at(-1).situacao === 'S' && a.versoes.at(-1).cargo === 'TCO') || null;
      if (!atv) estado.dados.atividades.push({ id: 'at-teste-s', codigo: 'AT-T01', aceite: null, versoes: [{ ...estado.dados.atividades[0].versoes[0], nome: 'Apoio sob demanda (teste)', periodicidade: 'S', situacao: 'S', desde: '2020-01-01' }] });
      A.registrarDemanda({ atvId: atv?.id || 'at-teste-s', data: (await import('./js/util.js')).hojeISO(), duracaoMin: 40, descricao: 'Apoio a cliente com reclamação na base' });
    });
    await p.waitForTimeout(800);
    const filaOff = await p.locator('#st-sync').getAttribute('aria-label');
    await p.click('#btn-usuario'); await p.click('.menu__item:has-text("Voltar a ficar online")');
    await p.waitForTimeout(1200);
    const filaOn = await p.locator('#st-sync').getAttribute('aria-label');
    registrar('8.3', 'Sem rede o registro fica na fila local e sobe ao reconectar', /a enviar/.test(filaOff) && /Sincronizado/.test(filaOn), `${filaOff} → ${filaOn}`);

    // ================= 1.4 anti-iframe =================
    const pf = await ctx.newPage();
    await pf.setContent(`<iframe src="${BASE}" width="400" height="300"></iframe>`);
    await pf.waitForTimeout(1500);
    const txtFrame = await pf.frames()[1].locator('body').innerText().catch(() => '');
    registrar('1.4', 'App se recusa a rodar dentro de iframe (clickjacking)', /não pode ser aberta dentro de outra página/.test(txtFrame), txtFrame.slice(0, 80));
    await pf.close();
    await ctx.close();

    // ================= 2.3 bloqueio por tentativas =================
    const cb = await browser.newContext({ serviceWorkers: 'block' });
    const pb = await cb.newPage(); vigiar(pb);
    await pb.goto(BASE);
    await pb.waitForSelector('#login input[autocomplete=username]');
    for (let i = 0; i < 5; i++) {
      await pb.fill('#login input[autocomplete=username]', 'R1405'); await pb.fill('#login input[autocomplete=current-password]', `Errada#${i}x`);
      await pb.click('#login button[type=submit]');
      await pb.waitForFunction(() => document.querySelector('.login__msg')?.textContent, null, { timeout: 15000 });
      await pb.waitForTimeout(150);
    }
    await pb.fill('#login input[autocomplete=username]', 'R1405'); await pb.fill('#login input[autocomplete=current-password]', SENHA_INICIAL);
    await pb.click('#login button[type=submit]');
    await pb.waitForTimeout(1200);
    const msgBloq = await pb.locator('.login__msg').innerText();
    registrar('2.3', '5 erros bloqueiam a matrícula por 15 min (nem a senha certa entra)', /bloqueado/.test(msgBloq), msgBloq);
    await cb.close();

    // ================= 8.7 / 9.4 app abre sem rede; cache só com arquivos do app =================
    const co = await browser.newContext();
    const po = await co.newPage(); vigiar(po);
    await po.goto(BASE);
    await po.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated', null, { timeout: 20000 });
    await po.reload(); await po.waitForTimeout(800);
    await co.setOffline(true);
    await po.reload();
    const abriu = await po.locator('#login input[autocomplete=username]').isVisible({ timeout: 8000 }).catch(() => false);
    const cache = await po.evaluate(async () => { const out = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname); return out; });
    await co.setOffline(false);
    registrar('8.7', 'App abre sem rede pelo service worker', abriu, abriu ? 'login exibido offline' : 'não abriu');
    registrar('9.4', 'Cache Storage só com arquivos do app (sem dados de negócio)', cache.length > 0 && cache.every((u) => /\/rotina\/((js|css|modelos)\/[\w.-]+|[\w.-]*)$/.test(u)), `${cache.length} arquivos, todos do app`);
    await co.close();

    // ================= Fase 8 — 360 px, alvos de toque, voltar; acessibilidade =================
    const cm = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const m = await cm.newPage(); vigiar(m);
    await m.goto(BASE);
    const estouros = [], pequenos = [], a11y = [];
    const medir = async (tela) => {
      await m.waitForTimeout(250);
      const sw = await m.evaluate(() => document.documentElement.scrollWidth);
      if (sw > 360) estouros.push(`${tela}:${sw}px`);
      const ruins = await m.evaluate(() => [...document.querySelectorAll('button, a.btn, input:not([type=file]):not([type=hidden]), select, textarea, summary')]
        .filter((n) => n.offsetParent !== null && !n.closest('.sr-only'))
        .map((n) => ({ n, r: n.getBoundingClientRect() }))
        .filter(({ n, r }) => (n.type === 'checkbox' ? Math.max(r.height, n.closest('label')?.getBoundingClientRect().height || 0) : r.height) < 47.5)
        .map(({ n, r }) => `${n.tagName.toLowerCase()}${n.className ? '.' + String(n.className).split(' ')[0] : ''}(${Math.round(r.height)}px "${(n.textContent || n.placeholder || n.type || '').trim().slice(0, 18)}")`));
      ruins.forEach((x) => pequenos.push(`${tela}: ${x}`));
      if (AXE) {
        // Injetado pelo protocolo de depuração: a CSP do app (corretamente) recusa script inline.
        if (!(await m.evaluate(() => !!window.axe))) await m.evaluate(AXE);
        const v = await m.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] })).violations.map((x) => `${x.id}(${x.nodes.length})`));
        v.forEach((x) => a11y.push(`${tela}: ${x}`));
      }
      await m.screenshot({ path: path.join(SAIDA, `360-${tela}.png`) });
    };
    await m.waitForSelector('#login input[autocomplete=username]');
    await medir('login');
    await entrar(m, 'R1102');
    await medir('hoje-retaguarda');
    await irPara(m, 'agenda'); await medir('agenda-retaguarda');
    const diasVis = await m.locator('#view-agenda .dia-col').evaluateAll((ns) => ns.filter((n) => n.offsetParent !== null).length);
    await m.locator('#view-agenda .agenda__dia').nth(2).click(); await m.waitForTimeout(200);
    const diaSel = await m.locator('#view-agenda .agenda__dia.ativo').getAttribute('aria-label');
    registrar('AGENDA-1', 'Agenda no celular: um dia por vez, troca pelos chips', diasVis === 1 && /^Qua/.test(diaSel), `1 coluna visível · dia escolhido: ${diaSel}`);
    await m.locator('#view-agenda .dia-col--sel .oc').first().tap();
    await m.waitForTimeout(300);
    await medir('ficha');
    await m.goBack(); await m.waitForTimeout(300);
    registrar('8.9', 'Botão voltar do celular fecha o painel sem sair do app', await m.locator('#sheet').isHidden() && m.url().includes('/rotina/'), m.url());
    await entrar(m, 'S1003');
    await medir('hoje-supervisor');
    await irPara(m, 'equipe'); await medir('equipe');
    await m.click('.abas__btn:has-text("Aprovações")'); await medir('aprovacoes');
    await m.click('.abas__btn:has-text("Ocupação")'); await medir('ocupacao');
    await irPara(m, 'agenda'); await medir('agenda-supervisor');
    await entrar(m, 'G1001');
    await irPara(m, 'catalogo'); await medir('catalogo');
    await m.click('.abas__btn:has-text("Achados")'); await medir('achados');
    await m.click('.abas__btn:has-text("Regras")'); await medir('regras');
    await m.click('.abas__btn:has-text("Atividades")');
    await m.locator('#view-catalogo tbody .btn--txt').first().tap(); await m.waitForTimeout(300); await medir('editar-atividade');
    await m.goBack(); await m.waitForTimeout(200);
    await irPara(m, 'acesso'); await m.waitForTimeout(400); await medir('acesso');
    registrar('8.1', 'Viewport 360 px sem rolagem horizontal', !estouros.length, estouros.join(', ') || '15 telas verificadas');
    registrar('8.2', 'Alvos de toque ≥ 48 px', !pequenos.length, pequenos.length ? `${pequenos.length} abaixo: ${pequenos.slice(0, 6).join('; ')}` : 'todos os controles visíveis ≥ 48 px');
    registrar('A11Y', 'axe-core (WCAG 2.1 A/AA) sem violações nas telas', AXE ? !a11y.length : false, AXE ? (a11y.slice(0, 8).join('; ') || '0 violações em 15 telas') : 'axe-core não instalado (npm install em testes/)');
    await cm.close();

    registrar('6.x', 'Sem erros de JavaScript nem violações de CSP no console', !erros.length, erros.slice(0, 3).join(' | ') || 'console limpo');
  } catch (e) {
    registrar('E2E', 'Execução do roteiro', false, e.message.split('\n').slice(0, 6).join(' | '));
  } finally {
    await browser.close();
    srv.close();
  }
  const falhas = resultados.filter((r) => !r.passou).length;
  fs.writeFileSync(path.join(SAIDA, 'resultado-e2e.json'), JSON.stringify({ quando: new Date().toISOString(), resultados }, null, 2));
  console.log(`\n${resultados.length - falhas}/${resultados.length} verificações aprovadas.`);
  process.exit(falhas ? 1 : 0);
})();
