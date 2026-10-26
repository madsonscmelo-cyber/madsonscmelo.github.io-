// Central de Demandas — teste ponta a ponta + checklist de usabilidade/segurança executável (fases 2, 3, 4, 6 e 8).
// Uso: cd testes && npm install && npx playwright install chromium && npm run e2e:demandas
// As regras são provadas chamando os módulos direto no navegador com o perfil mais fraco (checklist 6.9), não só pelo botão.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { iniciar } = require('./servidor.cjs');

const RAIZ = path.resolve(__dirname, '..');
const SAIDA = path.join(__dirname, 'saida', 'demandas');
fs.mkdirSync(SAIDA, { recursive: true });
let AXE = null;
try { AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); } catch { /* axe-core opcional: sem ele, o teste de acessibilidade é marcado como não executado */ }

const resultados = [];
function registrar(id, nome, passou, evidencia) {
  resultados.push({ id, nome, passou, evidencia });
  console.log(`${passou ? '✅' : '⚠️ '} ${id} ${nome} — ${evidencia}`);
}

const SENHA_INICIAL = 'Demandas@2026', SENHA_NOVA = 'Turno#Azul2026x';

(async () => {
  const srv = await iniciar(RAIZ);
  const BASE = `http://127.0.0.1:${srv.address().port}/demandas/`;
  const browser = await chromium.launch();
  const erros = [];
  const vigiar = (p) => {
    p.on('console', (m) => { if (m.type() === 'error' && !/net::ERR|Failed to load resource/.test(m.text())) erros.push(m.text()); });
    p.on('pageerror', (e) => erros.push(e.message));
    p.on('dialog', (d) => d.accept());
  };
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
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block', acceptDownloads: true });
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
    const mErrada = await msgLogin('S2102', 'SenhaErrada#1');
    registrar('2.2', 'Senha errada e matrícula inexistente têm a mesma mensagem', mInexistente === mErrada && /inválidas/.test(mErrada), `"${mErrada}"`);

    await p.fill('#login input[autocomplete=username]', 'S2101'); await p.fill('#login input[autocomplete=current-password]', SENHA_INICIAL);
    await p.click('#login button[type=submit]');
    await p.waitForSelector('#login input[autocomplete=new-password]');
    const [n1, n2] = await p.locator('#login input[autocomplete=new-password]').all();
    await n1.fill('Souza#2026abc'); await n2.fill('Souza#2026abc');
    await p.click('#login button[type=submit]');
    await p.waitForTimeout(400);
    const recusaNome = await p.locator('.login__msg').innerText();
    await n1.fill(SENHA_NOVA); await n2.fill(SENHA_NOVA);
    await p.click('#login button[type=submit]');
    await p.waitForFunction(() => document.querySelector('#login').hidden, null, { timeout: 15000 });
    p.__trocadas = new Set(['S2101']);
    registrar('2.1/2.8', 'Primeiro acesso obriga criar senha pessoal; senha com o nome é recusada', /matrícula nem seu nome/.test(recusaNome), `recusa: "${recusaNome.slice(0, 70)}"`);
    await p.waitForTimeout(300);

    // ================= Supervisor: agenda por prazo =================
    const titulos = await p.locator('#view-agenda .faixa h2').allInnerTexts();
    const nAtras = await p.locator('#view-agenda .dm--atrasada').count();
    registrar('AG-1', 'Supervisor abre na própria agenda, com Atrasadas e Vencem hoje no topo', titulos[0] === 'Atrasadas' && titulos[1] === 'Vencem hoje' && nAtras >= 1,
      `faixas: ${titulos.join(' › ')} · ${nAtras} atrasada(s)`);
    const soMinhas = await mod(p, async () => { const { estado } = await import('./js/store.js'); const D = await import('./js/dominio.js');
      return D.demandasVisiveis(estado.dados, estado.usuario).every((x) => x.destinatario === estado.usuario.id); });
    registrar('3.1', 'Supervisor só vê os próprios tickets', soMinhas, 'todas as demandas visíveis têm a supervisora como destinatária');

    // ================= Nova demanda: captura → formulário → assistente → criar =================
    await irPara(p, 'nova');
    await p.fill('#nova-texto', 'O Carlos do RH pediu os dados de produtividade por turma pra amanhã.');
    await irPara(p, 'agenda');
    const rasc = await p.locator('#view-agenda .rascunho').innerText().catch(() => '');
    await p.click('#view-agenda .rascunho button');
    await p.waitForTimeout(200);
    const recuperado = await p.locator('#nova-texto').inputValue();
    registrar('UX-ZEIGARNIK', 'Pedido começado vira rascunho, aparece na agenda e é retomado', /começado/.test(rasc) && /produtividade/.test(recuperado), `"${rasc.replace(/\n/g, ' ')}"`);

    await p.click('button:has-text("Estruturar demanda")');
    await p.waitForTimeout(200);
    const form = await mod(p, async () => {
      const q = (r) => [...document.querySelectorAll('#view-nova .campo')].find((c) => c.querySelector('.campo__rotulo')?.textContent.includes(r))?.querySelector('input,select')?.value;
      return { titulo: q('O que precisa'), quem: q('Quem pediu'), area: q('Área'), prazo: q('Prazo'), tipo: q('Tipo') };
    });
    const pergunta = (await p.locator('.chat__msg').allInnerTexts()).at(-1);
    const amanha = await mod(p, async () => (await import('./js/util.js')).somarDias((await import('./js/util.js')).hojeISO(), 1));
    registrar('NOVA-1', 'Texto livre vira formulário: quem pediu, área, prazo relativo e tipo deduzidos', form.quem === 'Carlos' && form.area === 'RH' && form.prazo === amanha && form.tipo === 'RH',
      `${JSON.stringify(form)}`);
    registrar('NOVA-2', 'Assistente pergunta só o que falta (entregável)', /formato da entrega/.test(pergunta), `"${pergunta}"`);
    await p.click('button:has-text("Não sei, deixar pendente")');
    await p.waitForTimeout(200);
    const radarTxt = await p.locator('#view-nova .radar').innerText();
    await p.click('#view-nova button:has-text("Confirmar e criar")');
    await p.waitForTimeout(300);
    const criada = await mod(p, async () => { const { estado } = await import('./js/store.js'); return estado.dados.demandas.at(-1); });
    registrar('NOVA-3', '"Não sei" vira pendência com quem pediu; prazo curto entra fora do radar', criada.pendencias.includes('entregavel') && criada.nasceuIncompleta && criada.radar === 'FORA' && /Fora do radar/.test(radarTxt),
      `pendências: ${criada.pendencias} · radar: ${criada.radar} (${criada.motivoRadarTexto})`);
    registrar('NOVA-4', 'Ao criar, o rascunho some e a demanda aparece na agenda', await p.locator(`#view-agenda .dm[data-id="${criada.id}"]`).count() === 1 && !(await p.locator('#view-agenda .rascunho').count()), criada.titulo);

    // Ficha: delegar, radar, concluir pela interface
    await p.click(`#view-agenda .dm[data-id="${criada.id}"]`);
    await p.click('#sheet button:has-text("Delegar")');
    await p.selectOption('#sheet select', 'Rita Moura');
    await p.click('#sheet-rodape button:has-text("Salvar")');
    await p.waitForTimeout(200);
    await p.click('#sheet button:has-text("Ajustar radar")');
    await p.click('#sheet-rodape button:has-text("Salvar")');
    const semMotivo = await ultimoToast(p);
    await p.selectOption('#sheet select', 'ULTIMA_HORA');
    await p.click('#sheet-rodape button:has-text("Salvar")');
    await p.waitForTimeout(200);
    await p.click('#sheet .ficha__acoes button:has-text("Concluir")');
    await p.fill('#sheet textarea', 'Planilha enviada ao RH por e-mail');
    await p.click('#sheet-rodape button:has-text("Concluir")');
    await p.waitForTimeout(300);
    const fim = await mod(p, async (id) => { const { estado } = await import('./js/store.js'); return estado.dados.demandas.find((x) => x.id === id); }, criada.id);
    registrar('FICHA-1', 'Delegar para a equipe, marcar motivo do radar (obrigatório) e concluir ficam no histórico', fim.delegadoPara === 'Rita Moura' && fim.motivoRadar === 'ULTIMA_HORA' && fim.status === 'CONCLUIDA' && /motivo/.test(semMotivo) && fim.historico.length >= 4,
      `histórico: ${fim.historico.map((h) => h.acao).join(' › ')}`);
    await p.keyboard.press('Escape');

    // Permissões chamando os módulos direto (como um atacante pelo console)
    const negados = await mod(p, async () => {
      const A = await import('./js/acoes.js'); const { estado } = await import('./js/store.js');
      const tentar = (fn) => { try { fn(); return 'PERMITIDO'; } catch (e) { return e.message; } };
      const minha = estado.dados.demandas.find((x) => x.destinatario === estado.usuario.id && x.status === 'ABERTA');
      return {
        enviarParaOutro: tentar(() => A.criarDemanda({ titulo: 'Pedido forjado pelo console', destinatario: 'u-s2201', prazo: '2099-01-01', solicitante: 'X' })),
        concluirDeOutro: tentar(() => A.concluir('dem-ex03')),
        delegarDeOutro: tentar(() => A.delegar('dem-ex03', 'Sérgio Lopes')),
        delegarForaDaEquipe: tentar(() => A.delegar(minha.id, 'Pessoa de fora')),
        gerarRituais: tentar(() => A.gerarRituais(2030, 0)),
        criarRitual: tentar(() => A.criarRitual({ nome: 'Ritual forjado', regra: 'DIA_UTIL', n: 2 })),
      };
    });
    registrar('3.6/6.9', 'Supervisor pelo console: enviar a outro, concluir/delegar de outro, delegar fora da equipe, rituais → bloqueados',
      Object.values(negados).every((v) => v !== 'PERMITIDO'), Object.entries(negados).map(([k, v]) => `${k}: ${v.slice(0, 32)}`).join(' | '));

    // XSS: título com HTML é exibido como texto
    await mod(p, async () => (await import('./js/acoes.js')).criarDemanda({ titulo: '<img src=x onerror="window.__xss=1">Teste', destinatario: (await import('./js/store.js')).estado.usuario.id, prazo: '2099-01-01', solicitante: '<b>x</b>' }));
    await p.waitForTimeout(300);
    const xss = await mod(p, () => ({ img: document.querySelectorAll('#view-agenda .dm img').length, flag: !!window.__xss, txt: [...document.querySelectorAll('#view-agenda .dm__titulo')].some((n) => n.textContent.includes('<img')) }));
    registrar('6.3', 'Texto com HTML vira texto na tela (sem injeção)', !xss.img && !xss.flag && xss.txt, `img: ${xss.img} · script executado: ${xss.flag} · exibido como texto: ${xss.txt}`);
    await fecharToasts(p);

    // ================= Área demandante: pedido para grupo =================
    await entrar(p, 'D3001');
    registrar('DEM-1', 'Área demandante abre direto em Nova demanda', !(await p.locator('#view-nova').isHidden()), 'primeira tela: Nova demanda');
    await p.fill('#nova-texto', 'Lista de quem tem férias vencendo até o fim do ano, todos os supervisores, planilha, dia 20.');
    await p.click('button:has-text("Estruturar demanda")');
    await p.waitForTimeout(200);
    const btnGrupo = await p.locator('#view-nova button:has-text("Confirmar e criar")').innerText();
    await p.click('#view-nova button:has-text("Confirmar e criar")');
    await p.waitForTimeout(300);
    const grupo = await mod(p, async () => {
      const { estado } = await import('./js/store.js');
      const mae = estado.dados.demandas.filter((x) => x.ehMae).at(-1);
      return { mae: mae.titulo, area: mae.areaSolicitante, quem: mae.solicitante, filhas: estado.dados.demandas.filter((x) => x.maeId === mae.id).length, id: mae.id };
    });
    const meus = await p.locator('#view-agenda .dm').count();
    registrar('DEM-2', 'Pedido para grupo: 1 demanda-mãe para quem pediu e 1 ticket por supervisor; área e nome vêm do login',
      grupo.filhas === 4 && /4 tickets/.test(btnGrupo) && grupo.area === 'RH' && grupo.quem === 'Carlos Pereira' && meus >= 1, `${grupo.filhas} tickets · "${btnGrupo}" · ${meus} pedido(s) em Meus pedidos`);
    const demNeg = await mod(p, async () => {
      const A = await import('./js/acoes.js'); const { estado } = await import('./js/store.js');
      const tentar = (fn) => { try { fn(); return 'PERMITIDO'; } catch (e) { return e.message; } };
      return { concluirTicket: tentar(() => A.concluir(estado.dados.demandas.find((x) => x.maeId).id)), gerarRituais: tentar(() => A.gerarRituais(2030, 0)) };
    });
    const verPainel = await p.locator('#nav .nav__btn[data-view=painel]').count();
    registrar('3.4', 'Área demandante não trabalha tickets, não gera rituais e não vê o painel', Object.values(demNeg).every((v) => v !== 'PERMITIDO') && !verPainel, Object.values(demNeg).map((v) => v.slice(0, 40)).join(' | '));

    // Pendência completada na mãe vale para todos os tickets do grupo
    await mod(p, async () => (await import('./js/acoes.js')).criarDemanda({ titulo: 'Confirmar participantes do treinamento de liderança', destinatario: 'grp:SUL', pendencias: ['prazo'] }));
    const idMae = await mod(p, async () => (await import('./js/store.js')).estado.dados.demandas.filter((x) => x.ehMae).at(-1).id);
    const prazoNovo = await mod(p, async () => (await import('./js/util.js')).somarDias((await import('./js/util.js')).hojeISO(), 10));
    await mod(p, async (a) => (await import('./js/acoes.js')).completarPendencia(a.id, 'prazo', a.prazo), { id: idMae, prazo: prazoNovo });
    const prop = await mod(p, async (id) => (await import('./js/store.js')).estado.dados.demandas.filter((x) => x.maeId === id).map((x) => ({ prazo: x.prazo, pend: x.pendencias.length })), idMae);
    registrar('PEND-1', 'Prazo completado por quem pediu vale para todos os tickets do grupo', prop.length === 2 && prop.every((x) => x.prazo === prazoNovo && !x.pend), JSON.stringify(prop));

    // ================= Gerência: painel, rituais, auditoria =================
    await entrar(p, 'G2001');
    const painel = await p.locator('#view-painel').innerText();
    registrar('PAINEL-1', 'Gerência abre no painel com antecedência, urgência para ontem e fora do radar por área', /Quem gera demanda/.test(painel) && /Antecedência média/i.test(painel) && /Fora do radar/i.test(painel) && /Taxa de imprevisto/i.test(painel),
      'tabela por área, por supervisor, motivos, tipos, canais e grupos');
    const rit = await mod(p, async () => {
      const A = await import('./js/acoes.js'); const { estado } = await import('./js/store.js');
      const h = new Date(); const ano = h.getFullYear() + 1;
      const r1 = A.gerarRituais(ano, 2), r2 = A.gerarRituais(ano, 2);
      const sup = estado.dados.usuarios.filter((u) => u.perfil === 'SUPERVISOR').length;
      return { r1, r2, esperado: sup * estado.dados.rituais.length };
    });
    registrar('RIT-1', 'Rituais geram 1 ticket por supervisor e ritual; gerar de novo não duplica', rit.r1.criados === rit.esperado && rit.r2.criados === 0, `1ª: ${rit.r1.criados} · 2ª: ${rit.r2.criados}`);
    const ritPassado = await mod(p, async () => { const A = await import('./js/acoes.js'); return A.gerarRituais(2020, 0); });
    registrar('RIT-2', 'Ritual com data já passada não é gerado (não nasce atrasado)', ritPassado.criados === 0 && ritPassado.passados > 0, JSON.stringify(ritPassado));

    await irPara(p, 'acesso');
    await p.waitForTimeout(400);
    await p.click('button:has-text("Verificar integridade")');
    await p.waitForTimeout(800);
    const integ = await p.locator('.kpi', { hasText: 'Integridade' }).innerText();
    const acoesLog = await mod(p, async () => { const { todosLogs } = await import('./js/auditoria.js'); return [...new Set((await todosLogs()).map((r) => r.acao))]; });
    const precisa = ['LOGIN_FALHA', 'LOGIN_SUCESSO', 'DEMANDA_CRIADA', 'DEMANDA_DELEGADA', 'RADAR_AJUSTADO', 'DEMANDA_CONCLUIDA', 'PENDENCIA_COMPLETADA', 'CONCLUIR_NEGADO', 'DESTINO_NEGADO', 'RITUAIS_GERADOS'];
    const faltam = precisa.filter((a) => !acoesLog.includes(a));
    registrar('5.x', 'Log com cadeia SHA-256 íntegra e com as ações do roteiro (inclusive as negadas)', /íntegro/.test(integ) && !faltam.length, faltam.length ? `faltam: ${faltam.join(', ')}` : `${acoesLog.length} tipos de ação registrados · ${integ.replace(/\n/g, ' ')}`);

    // Anti-iframe e CSP
    const html = fs.readFileSync(path.join(RAIZ, 'demandas', 'index.html'), 'utf8');
    const fr = await ctx.newPage();
    await fr.setContent(`<iframe src="${BASE}" width="400" height="300"></iframe>`);
    await fr.waitForTimeout(1500);
    const dentro = await fr.frames()[1]?.evaluate(() => document.body.innerText).catch(() => '');
    registrar('1.3/1.4', 'CSP sem domínio externo e recusa abrir dentro de iframe', /Content-Security-Policy/.test(html) && !/https?:\/\//.test(html) && /não pode ser aberta dentro de outra página/.test(dentro || ''), `iframe: "${(dentro || '').slice(0, 60)}"`);
    await fr.close();
    await ctx.close();

    // ================= Fase 8 — celular 360 px, alvos de toque e acessibilidade =================
    const cm = await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const m = await cm.newPage();
    vigiar(m);
    await m.goto(BASE);
    const estouros = [], pequenos = [], a11y = [];
    const medir = async (tela) => {
      await m.waitForTimeout(300);
      await fecharToasts(m);
      const sw = await m.evaluate(() => Math.max(...[...document.querySelectorAll('.view:not([hidden]), #login:not([hidden]), #sheet:not([hidden])')].map((n) => n.scrollWidth), document.documentElement.scrollWidth));
      if (sw > 360) estouros.push(`${tela}:${sw}px`);
      const ruins = await m.evaluate(() => [...document.querySelectorAll('button, a.btn, input:not([type=file]):not([type=hidden]), select, textarea, summary, label.btn')]
        .filter((n) => n.offsetParent !== null && !n.closest('.sr-only'))
        .map((n) => ({ n, r: n.getBoundingClientRect() }))
        .filter(({ n, r }) => (n.type === 'checkbox' ? Math.max(r.height, n.closest('label')?.getBoundingClientRect().height || 0) : r.height) < 47.5)
        .map(({ n, r }) => `${n.tagName.toLowerCase()}${n.className ? '.' + String(n.className).split(' ')[0] : ''}(${Math.round(r.height)}px "${(n.textContent || n.placeholder || n.type || '').trim().slice(0, 18)}")`));
      ruins.forEach((x) => pequenos.push(`${tela}: ${x}`));
      if (AXE) {
        if (!(await m.evaluate(() => !!window.axe))) await m.evaluate(AXE);
        const v = await m.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] })).violations.map((x) => `${x.id}(${x.nodes.length})`));
        v.forEach((x) => a11y.push(`${tela}: ${x}`));
      }
      await m.screenshot({ path: path.join(SAIDA, `360-${tela}.png`) });
    };
    await m.waitForSelector('#login input[autocomplete=username]');
    await medir('login');
    await entrar(m, 'S2102');
    await medir('agenda-supervisor');
    await m.locator('#view-agenda .dm').first().tap();
    await medir('ficha');
    await m.goBack(); await m.waitForTimeout(300);
    registrar('8.9', 'Botão voltar do celular fecha o painel sem sair do app', await m.locator('#sheet').isHidden() && m.url().includes('/demandas/'), m.url());
    await irPara(m, 'nova');
    await m.click('.chip--ex >> nth=2');
    await m.click('button:has-text("Estruturar demanda")');
    await medir('nova-estruturada');
    await irPara(m, 'rituais'); await medir('rituais-supervisor');
    await entrar(m, 'G2001');
    await medir('painel');
    await irPara(m, 'rituais'); await medir('rituais-gerencia');
    await irPara(m, 'agenda'); await medir('agenda-gerencia');
    await irPara(m, 'acesso'); await m.waitForTimeout(400); await medir('acesso');
    registrar('8.1', 'Viewport 360 px sem rolagem horizontal', !estouros.length, estouros.join(', ') || '10 telas verificadas');
    registrar('8.2', 'Alvos de toque ≥ 48 px', !pequenos.length, pequenos.length ? `${pequenos.length} abaixo: ${pequenos.slice(0, 6).join('; ')}` : 'todos os controles visíveis ≥ 48 px');
    registrar('A11Y', 'axe-core (WCAG 2.1 A/AA) sem violações nas telas', AXE ? !a11y.length : false, AXE ? (a11y.slice(0, 8).join('; ') || '0 violações em 10 telas') : 'axe-core não instalado (npm install em testes/)');
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
