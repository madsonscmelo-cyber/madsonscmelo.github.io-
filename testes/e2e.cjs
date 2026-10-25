// Teste ponta a ponta + checklist de usabilidade/segurança executável (fases 3, 6 e 8).
// Uso: cd testes && npm install && npx playwright install chromium && npm run e2e
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { iniciar } = require('./servidor.cjs');

const RAIZ = path.resolve(__dirname, '..');
const FOTO = path.join(RAIZ, 'app', 'icon-512.png');
const CSV = path.join(RAIZ, 'app', 'modelos', 'exemplo-plano-com-erros.csv');
const SAIDA = path.join(__dirname, 'saida');
fs.mkdirSync(SAIDA, { recursive: true });

const resultados = [];
function registrar(id, nome, passou, evidencia) {
  resultados.push({ id, nome, passou, evidencia });
  console.log(`${passou ? '✅' : '⚠️ '} ${id} ${nome} — ${evidencia}`);
}

(async () => {
  const srv = await iniciar(RAIZ);
  const BASE = `http://127.0.0.1:${srv.address().port}/app/`;
  const browser = await chromium.launch();
  const erros = [];
  const vigiar = (p) => {
    p.on('console', (m) => { if (m.type() === 'error' && !/tile\.openstreetmap|net::ERR|status of 504/.test(m.text())) erros.push(m.text()); });
    p.on('pageerror', (e) => erros.push(e.message));
  };
  const dados = (p) => p.evaluate(() => new Promise((res) => { const q = indexedDB.open('redeviva'); q.onsuccess = () => { const g = q.result.transaction('kv').objectStore('kv').get('dados'); g.onsuccess = () => res(g.result); }; }));
  const MATRICULAS = { 'Gestão de Planejamento': 'G1001', 'Supervisão de Campo': 'S1001', 'Auditoria Interna': 'A1001', 'Equipe Inspeção 01': 'INS01', 'Equipe Inspeção 02': 'INS02', 'Equipe Turma Pesada 01': 'PES01', 'Equipe Poda 01': 'POD01' };
  const SENHA_INICIAL = 'Rede@2026', SENHA_NOVA = 'Torre#Verde2026';
  const sairDoApp = async (p) => { await p.click('#btn-usuario'); await p.click('.menu__item:has-text("Sair")'); await p.waitForSelector('#login input[autocomplete=username]'); };
  /** Login real: matrícula + senha; no primeiro acesso cria a senha pessoal (política exige troca). */
  const entrar = async (p, nome, { ficarEmHoje = false } = {}) => {
    const mat = MATRICULAS[nome] || nome;
    // Espera o app terminar de iniciar (tela de login ou sessão retomada) antes de decidir.
    await p.waitForFunction(() => !document.querySelector('#login').hidden || document.querySelector('#nav').childElementCount > 0, null, { timeout: 20000 });
    if (await p.locator('#login').isHidden()) await sairDoApp(p);
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
    await p.waitForTimeout(300);
    // O app abre na tela Hoje; a maior parte dos cenários começa no mapa.
    if (!ficarEmHoje && await p.locator('#nav > .nav__btn[data-view=mapa]').count()) { await p.click('#nav > .nav__btn[data-view=mapa]'); await p.waitForTimeout(200); }
  };
  /** Navega pela barra inferior; telas extras ficam no menu "Mais". */
  const irPara = async (p, tela) => {
    const b = p.locator(`#nav > .nav__btn[data-view=${tela}]`);
    if (await b.count()) await b.click();
    else { await p.click('#nav-mais-btn'); await p.click(`#nav-mais .nav__btn[data-view=${tela}]`); }
    await p.waitForTimeout(250);
  };
  const ultimoToast = async (p) => (await p.locator('.toast').allInnerTexts()).at(-1) || '';

  try {
    // ================= Fluxo completo (cenário §14) =================
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    vigiar(p);
    await p.goto(BASE);
    await entrar(p, 'Gestão de Planejamento');

    await irPara(p, 'plano');
    await p.setInputFiles('#view-plano input[type=file]', CSV);
    await p.waitForTimeout(400);
    const rel = await p.locator('#view-plano .bloco').first().innerText();
    registrar('E2E-1', 'Importação do plano valida linha a linha', /6 linha\(s\) aceita\(s\)/.test(rel) && /4 rejeitada/.test(rel), rel.split('\n')[2] || rel.slice(0, 120));

    await entrar(p, 'Equipe Inspeção 01');
    let d = await dados(p);
    const insp = d.inspecoes.find((x) => x.status !== 'CONCLUIDA' && x.equipeId === 'INS-01' && x.criterioId === 'TRAFO_REINCIDENTE');
    const alvo = d.ativos.find((x) => x.id === insp.ativoId);
    await p.fill('.busca__inp', alvo.codigo);
    await p.click(`.busca__item:has-text("${alvo.codigo}")`);
    await p.waitForTimeout(1100);
    registrar('UX-JAKOB', 'Busca por código abre o ativo no mapa', await p.locator('#sheet-titulo').innerText().then((t) => t.includes(alvo.codigo)), alvo.codigo);

    const mk = await p.locator(`.leaflet-marker-icon[title^="Transformador ${alvo.codigo} "]`).boundingBox();
    await p.click('#ctrl-mais');
    await p.click('#ctrl-simular');
    await p.mouse.click(mk.x + mk.width / 2 + 25, mk.y + mk.height / 2);
    await p.waitForTimeout(250);
    const alerta = (await p.locator('.toast--alerta').allInnerTexts()).join(' ');
    registrar('RF-ROT-03', 'Alerta de proximidade dispara para pendência da equipe', /Perto de você/.test(alerta), alerta.replace(/\n/g, ' '));
    await p.click('#ctrl-mais'); await p.click('#ctrl-simular');

    await p.click('#sheet-rodape button:has-text("Inspecionar agora")');
    await p.locator('.segmentado__op--nc').first().click();
    await p.click('#sheet-rodape button:has-text("Próximo")');
    await p.selectOption('.novo-def label:has-text("Tipo de defeito") select', 'TRAFO_VAZAMENTO');
    await p.setInputFiles('.novo-def input[type=file]', FOTO);
    await p.waitForTimeout(500);
    await p.click('.novo-def button:has-text("Adicionar defeito")');
    // Zeigarnik: fecha no meio e retoma pelo aviso no mapa
    await p.click('#sheet-fechar');
    await p.waitForTimeout(250);
    const aviso = await p.locator('.rascunho').innerText().catch(() => '');
    await p.click('.rascunho');
    await p.waitForTimeout(250);
    const etapa = await p.locator('.passo--atual').innerText();
    registrar('UX-ZEIGARNIK', 'Inspeção interrompida vira rascunho e é retomada na mesma etapa', /etapa 2 de 3/.test(aviso) && /Defeitos/.test(etapa), aviso.replace(/\n/g, ' '));

    await p.click('text=＋ Adicionar defeito / manutenção');
    await p.selectOption('.novo-def label:has-text("Tipo de defeito") select', 'NINHO');
    await p.setInputFiles('.novo-def input[type=file]', FOTO);
    await p.waitForTimeout(500);
    await p.check('.novo-def input[type=checkbox]');
    await p.click('.novo-def button:has-text("Adicionar defeito")');
    await p.click('#sheet-rodape button:has-text("Próximo")');
    const larg = await p.locator('.passos__preench').evaluate((n) => n.style.width);
    registrar('UX-GRADIENTE', 'Assistente mostra progresso por etapa', larg === '100%', `barra em ${larg} na etapa 3/3`);
    await p.setInputFiles('#sheet .fotos input[type=file]', FOTO);
    await p.waitForTimeout(500);
    await p.click('#sheet-rodape button:has-text("Concluir inspeção")');
    await p.waitForTimeout(400);
    d = await dados(p);
    const novos = d.defeitos.filter((x) => x.ativoId === alvo.id && !x.sintetico);
    registrar('E2E-2', 'Inspeção gera defeito (turma pesada) e manutenção na hora', novos.some((x) => x.tipoId === 'TRAFO_VAZAMENTO' && x.status === 'IDENTIFICADO') && novos.some((x) => x.tipoId === 'NINHO' && x.status === 'EXECUTADO') && !Object.keys(d.rascunhos || {}).length,
      novos.map((x) => `${x.tipoId}:${x.status}`).join(', '));

    await entrar(p, 'Supervisão de Campo');
    await irPara(p, 'defeitos');
    const card = () => p.locator(`.card-def:has-text("${alvo.codigo}"):has-text("Vazamento")`).first();
    await card().locator('button:has-text("Validar")').click();
    await card().locator('button:has-text("Programar")').click();
    await p.waitForTimeout(300);
    await entrar(p, 'Equipe Turma Pesada 01');
    await irPara(p, 'defeitos');
    await card().locator('button:has-text("Registrar execução")').click();
    await p.setInputFiles('#sheet input[type=file]', FOTO);
    await p.waitForTimeout(500);
    await p.click('#sheet-rodape button');
    const bloqueio = await ultimoToast(p);
    await p.fill('#sheet textarea[placeholder^="Justificativa"]', 'GPS sem sinal no local');
    await p.click('#sheet-rodape button');
    await p.waitForTimeout(300);
    registrar('RF-INS-07', 'Execução fora do raio/sem GPS exige justificativa', /justificativa/i.test(bloqueio), bloqueio);
    await entrar(p, 'Supervisão de Campo');
    await irPara(p, 'defeitos');
    await p.click('.abas__btn:has-text("A verificar")');
    await card().locator('button:has-text("Verificar e fechar")').click();
    await p.waitForTimeout(300);
    d = await dados(p);
    registrar('E2E-3', 'Fluxo Identificado→Validado→Programado→Executado→Verificado', d.defeitos.find((x) => x.ativoId === alvo.id && x.tipoId === 'TRAFO_VAZAMENTO').status === 'VERIFICADO', 'PES-01 executou, supervisor verificou');

    // ================= Fase 3 — autorização (camada cliente, "por API direta") =================
    await entrar(p, 'Equipe Poda 01');
    const nav = (await p.locator('.nav__btn').allInnerTexts()).join(',');
    registrar('3.4', 'Equipe não vê telas de gestão (Plano/Painel)', !/Plano|Painel/.test(nav), nav.replace(/\n/g, ' '));
    const tentativas = await p.evaluate(async () => {
      const { estado } = await import('./js/store.js');
      const acoes = await import('./js/acoes.js');
      const out = [];
      const tenta = (nome, fn) => { try { fn(); out.push(`${nome}: PERMITIDO`); } catch (e) { out.push(`${nome}: bloqueado (${e.message})`); } };
      const ident = estado.dados.defeitos.find((f) => f.status === 'IDENTIFICADO');
      tenta('autovalidar defeito', () => acoes.transicionar(ident, 'VALIDADO'));
      const prog = estado.dados.defeitos.find((f) => f.status === 'PROGRAMADO' && f.equipeId !== 'POD-01');
      tenta('executar defeito de outra equipe', () => acoes.transicionar(prog, 'EXECUTADO', { fotos: [{ id: 'x' }] }));
      tenta('atribuir inspeção', () => acoes.atribuirInspecao(estado.dados.inspecoes[0].id, 'INS-01'));
      tenta('concluir inspeção sem foto', () => acoes.concluirInspecao({ ativoIds: [estado.dados.ativos[0].id], avulsa: true, fotos: [], geo: { dentroDoRaio: true }, justificativa: 'x' }));
      return out;
    });
    registrar('3.6/3.7/3.9', 'Ações proibidas chamadas direto no módulo são bloqueadas', tentativas.every((t) => t.includes('bloqueado')), tentativas.join(' | '));

    // ================= Fase 8 — offline =================
    await entrar(p, 'Supervisão de Campo');
    await p.click('#btn-usuario'); await p.click('text=Simular modo offline');
    await irPara(p, 'plano');
    await p.click('text=Distribuir pendentes automaticamente');
    await p.waitForTimeout(800);
    const fila = await p.locator('#st-sync').innerText();
    await p.click('#btn-usuario'); await p.click('text=Voltar a ficar online');
    await p.waitForTimeout(1200);
    const apos = await p.locator('#st-sync').innerText();
    registrar('8.3', 'Offline: fila local e sincronização ao reconectar', /a enviar/.test(fila) && /Sincronizado/.test(apos), `${fila} → ${apos}`);
    await ctx.close();

    // ================= Fase 2 — autenticação, sessão e logs =================
    const ca = await browser.newContext({ viewport: { width: 1280, height: 820 }, serviceWorkers: 'block' });
    const pa = await ca.newPage();
    vigiar(pa);
    await pa.goto(BASE);
    const tentar = async (mat, senha) => {
      await pa.fill('#login input[autocomplete=username]', mat);
      await pa.fill('#login input[autocomplete=current-password]', senha);
      await pa.click('#login button[type=submit]');
      await pa.waitForFunction(() => document.querySelector('.login__msg')?.textContent || document.querySelector('#login input[autocomplete=new-password]') || document.querySelector('#login').hidden, null, { timeout: 15000 });
      await pa.waitForFunction(() => !document.querySelector('#login button[type=submit]')?.disabled, null, { timeout: 15000 }).catch(() => {});
      await pa.waitForTimeout(150); // a mensagem final pode ser reescrita; ler só depois de o login terminar
      const msg = await pa.locator('.login__msg').first().innerText().catch(() => '');
      await pa.evaluate(() => { const m = document.querySelector('.login__msg'); if (m) m.textContent = ''; });
      return msg;
    };
    const mErrada = await tentar('S1001', 'senhaErrada1!');
    const mInexistente = await tentar('Z9999', 'senhaErrada1!');
    registrar('2.2', 'Senha errada e matrícula inexistente dão a mesma mensagem', mErrada === mInexistente && /inválidas/.test(mErrada), mErrada);
    for (let i = 0; i < 4; i++) await tentar('S1001', `errada${i}X!`);
    const mBloq = await tentar('S1001', SENHA_INICIAL);
    registrar('2.3', 'Bloqueio após 5 tentativas (nem a senha certa entra)', /bloqueado/.test(mBloq), mBloq);

    await pa.reload();
    await pa.fill('#login input[autocomplete=username]', 'INS01');
    await pa.fill('#login input[autocomplete=current-password]', SENHA_INICIAL);
    await pa.click('#login button[type=submit]');
    await pa.waitForSelector('#login input[autocomplete=new-password]');
    const [s1, s2] = await pa.locator('#login input[autocomplete=new-password]').all();
    await s1.fill('abc12345'); await s2.fill('abc12345');
    await pa.click('#login button[type=submit]');
    await pa.waitForTimeout(400);
    const mFraca = await pa.locator('.login__msg').innerText();
    registrar('2.x', 'Política recusa senha fraca na troca obrigatória', /fora da política/.test(mFraca), mFraca.slice(0, 90));
    await s1.fill(SENHA_NOVA); await s2.fill(SENHA_NOVA);
    await pa.click('#login button[type=submit]');
    await pa.waitForFunction(() => document.querySelector('#login').hidden, null, { timeout: 15000 });
    pa.__trocadas = new Set(['INS01']);
    const da = await dados(pa);
    const ui = da.usuarios.find((u) => u.matricula === 'INS01');
    const json = JSON.stringify(da);
    registrar('2.5', 'Senha guardada só como hash PBKDF2 com sal (nunca em texto)', ui.credencial?.hash && ui.credencial.salt && ui.credencial.iteracoes >= 210000 && !json.includes(SENHA_NOVA), `PBKDF2 ${ui.credencial?.iteracoes} iterações · texto da senha ausente dos dados`);

    // Inatividade: atividade "antiga" → tela bloqueia; desbloqueio pede a senha
    await pa.evaluate(() => { const k = 'redeviva-sessao'; const s = JSON.parse(sessionStorage.getItem(k)); s.atividade -= 21 * 60000; sessionStorage.setItem(k, JSON.stringify(s)); document.dispatchEvent(new Event('visibilitychange')); });
    await pa.waitForTimeout(300);
    const bloqueada = await pa.locator('#login h2').innerText().catch(() => '');
    await pa.fill('#login input[autocomplete=current-password]', SENHA_NOVA);
    await pa.click('#login button[type=submit]');
    await pa.waitForFunction(() => document.querySelector('#login').hidden, null, { timeout: 15000 });
    registrar('2.7', 'Inatividade bloqueia a tela e o desbloqueio exige senha', /inatividade/.test(bloqueada), bloqueada);

    // Logout invalida a sessão: recarregar volta ao login
    await sairDoApp(pa);
    await pa.reload();
    await pa.waitForTimeout(500);
    registrar('2.6', 'Logout encerra a sessão (recarregar exige login)', await pa.locator('#login input[autocomplete=username]').isVisible(), 'tela de login após recarregar');

    // Gestor bloqueia um usuário → login dele é recusado; auditor só lê
    await entrar(pa, 'Gestão de Planejamento');
    await irPara(pa, 'acesso');
    await pa.click('.abas__btn:has-text("Usuários")');
    await pa.locator('tr:has-text("POD01") button:has-text("Bloquear")').click();
    await pa.waitForTimeout(300);
    await sairDoApp(pa);
    const mBloqueado = await tentar('POD01', SENHA_INICIAL);
    registrar('2.10', 'Usuário bloqueado pelo gestor não entra (mensagem genérica)', /inválidas/.test(mBloqueado), mBloqueado);
    await entrar(pa, 'Auditoria Interna');
    const navAud = (await pa.locator('.nav__btn').allInnerTexts()).join(',').replace(/\n/g, ' ');
    const audTenta = await pa.evaluate(async () => {
      const auth = await import('./js/auth.js'); const { estado } = await import('./js/store.js');
      try { auth.adminDefinirAtivo(estado.dados.usuarios[0], false); return 'PERMITIDO'; } catch (e) { return `bloqueado (${e.message})`; }
    });
    registrar('3.5', 'Auditoria só consulta (sem mapa/plano; administração negada)', !/Mapa|Plano/.test(navAud) && /Acesso/.test(navAud) && audTenta.startsWith('bloqueado'), `${navAud} · admin: ${audTenta}`);

    // Logs: tudo registrado, sem senha, íntegro e à prova de adulteração
    const logs = await pa.evaluate(async () => (await import('./js/auditoria.js')).todosLogs());
    const cats = [...new Set(logs.map((l) => l.categoria))].sort();
    const acoes = new Set(logs.map((l) => l.acao));
    const esperadas = ['LOGIN_FALHA', 'BLOQUEIO_POR_TENTATIVAS', 'LOGIN_DURANTE_BLOQUEIO', 'SENHA_ALTERADA', 'LOGIN_SUCESSO', 'SESSAO_BLOQUEADA_INATIVIDADE', 'SESSAO_DESBLOQUEADA', 'LOGOUT', 'TELA_ABERTA', 'USUARIO_BLOQUEADO', 'ADMIN_NEGADO', 'SENHA_RECUSADA_POLITICA'];
    const faltam = esperadas.filter((a) => !acoes.has(a));
    registrar('LOG-1', 'Ações de usuário registradas no log (login, bloqueios, senha, navegação, admin, negações)', !faltam.length, faltam.length ? `faltam: ${faltam.join(', ')}` : `${logs.length} registros · categorias: ${cats.join(', ')}`);
    const vazou = JSON.stringify(logs).includes(SENHA_NOVA) || JSON.stringify(logs).includes(SENHA_INICIAL) || JSON.stringify(logs).includes('senhaErrada1!');
    registrar('LOG-2', 'Nenhuma senha (certa ou errada) aparece no log', !vazou, vazou ? 'SENHA NO LOG' : 'varredura do log inteiro');
    const integ = await pa.evaluate(async () => (await import('./js/auditoria.js')).verificarIntegridade());
    const adulterado = await pa.evaluate(async () => {
      const { idb } = await import('./js/store.js'); const a = await import('./js/auditoria.js');
      const r = await idb('logs', 'readonly', (s) => s.get(3));
      r.acao = 'LOGIN_SUCESSO'; r.resultado = 'OK';
      await idb('logs', 'readwrite', (s) => s.put(r));
      return a.verificarIntegridade();
    });
    registrar('LOG-3', 'Cadeia de hash detecta registro adulterado', integ.ok && !adulterado.ok, `antes: íntegro (${integ.total}) · depois de alterar o registro 3: ${adulterado.motivo}`);
    await ca.close();

    // ================= Recuperação de acesso na demonstração =================
    const cr = await browser.newContext({ serviceWorkers: 'block' });
    const pr = await cr.newPage();
    vigiar(pr);
    pr.on('dialog', (d) => d.accept());
    await pr.goto(BASE);
    await entrar(pr, 'Gestão de Planejamento');
    // Atualização do app (versão de dados muda): a senha pessoal tem de sobreviver
    await pr.evaluate(async () => { const { estado, persistir } = await import('./js/store.js'); estado.dados.versaoSchema = 1; await persistir(); });
    await sairDoApp(pr);
    await pr.reload();
    await pr.fill('#login input[autocomplete=username]', 'g1001');
    await pr.fill('#login input[autocomplete=current-password]', SENHA_NOVA);
    await pr.click('#login button[type=submit]');
    await pr.waitForTimeout(1500);
    const manteve = await pr.locator('#login').isHidden();
    registrar('2.11', 'Atualização dos dados de demonstração preserva a senha pessoal', manteve, manteve ? 'entrou com a senha pessoal após a atualização' : await pr.locator('.login__msg').innerText());
    await sairDoApp(pr);
    for (let i = 0; i < 5; i++) {
      await pr.fill('#login input[autocomplete=username]', 'G1001');
      await pr.fill('#login input[autocomplete=current-password]', `Errada${i}#xyz`);
      await pr.click('#login button[type=submit]');
      await pr.waitForTimeout(700);
    }
    const msgBloq = await pr.locator('.login__msg').innerText();
    await pr.click('summary:has-text("Não consigo entrar")');
    await pr.click('button:has-text("Restaurar a demonstração neste aparelho")');
    await pr.waitForTimeout(800);
    await pr.fill('#login input[autocomplete=username]', 'G1001');
    await pr.fill('#login input[autocomplete=current-password]', SENHA_INICIAL);
    await pr.click('#login button[type=submit]');
    await pr.waitForSelector('#login input[autocomplete=new-password]', { timeout: 15000 }).catch(() => {});
    const voltou = await pr.locator('#login input[autocomplete=new-password]').count() > 0;
    registrar('2.12', 'Matrícula bloqueada: "Não consigo entrar" restaura a demonstração e a senha inicial volta a valer', /bloqueado/.test(msgBloq) && voltou, `bloqueio: "${msgBloq.slice(0, 50)}…" → senha inicial aceita após restaurar`);
    await cr.close();

    // ================= Parâmetros, custos e programação =================
    const cp = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
    const pp = await cp.newPage();
    vigiar(pp);
    pp.on('dialog', (d) => d.accept());
    await pp.goto(BASE);
    await entrar(pp, 'X1001');
    const resParam = await pp.evaluate(async () => {
      const P = await import('./js/parametros.js'); const { PARAM } = await import('./js/dominio.js'); const { hojeISO } = await import('./js/util.js');
      const out = {};
      try { P.salvarVersao('geral', { ...P.valor('geral'), raioValidacaoM: 80 }, '2020-01-01', 'teste'); out.passado = 'ACEITO'; } catch (e) { out.passado = e.message; }
      try { P.salvarVersao('geral', { ...P.valor('geral'), raioValidacaoM: 1 }, hojeISO(), 'teste'); out.limite = 'ACEITO'; } catch (e) { out.limite = e.message; }
      P.salvarVersao('geral', { ...P.valor('geral'), raioValidacaoM: 80 }, hojeISO(), 'Ajuste para área rural');
      out.aplicado = PARAM.raioValidacaoM;
      // Orçamento de Estrutural do mês atual reduzido para forçar o aviso de estouro
      const mes = hojeISO().slice(0, 7);
      const orc = P.valor('orcamento').map((o) => (o.mes === mes && o.categoria === 'ESTRUTURAL' ? { ...o, valor: 100 } : o));
      P.salvarVersao('orcamento', orc, hojeISO(), 'Teste de estouro');
      out.versoes = P.versoes('geral').length + P.versoes('orcamento').length;
      return out;
    });
    registrar('PARAM-1', 'Parâmetro novo vale na hora; vigência no passado e valor fora do limite são recusados', /passado/.test(resParam.passado) && /mínimo/.test(resParam.limite) && resParam.aplicado === 80,
      `passado: "${resParam.passado}" · limite: "${resParam.limite}" · raio em vigor ${resParam.aplicado} m`);

    await entrar(pp, 'Gestão de Planejamento');
    const gestorCaderno = await pp.evaluate(async () => { const P = await import('./js/parametros.js'); try { P.salvarVersao('caderno', P.valor('caderno'), (await import('./js/util.js')).hojeISO(), 'x'); return 'PERMITIDO'; } catch (e) { return e.message; } });
    registrar('PARAM-2', 'Gestor edita orçamento, mas caderno de preços só o Administrador', /não pode alterar/.test(gestorCaderno), gestorCaderno);

    const custo = await pp.evaluate(async () => {
      const { custoDefeito } = await import('./js/custos.js'); const { estado } = await import('./js/store.js');
      const a = estado.dados.ativos.find((x) => x.conjunto === 'CJ-Sul');
      return custoDefeito({ tipoId: 'PODA', ativoId: a.id, quantidade: 4 });
    });
    registrar('CUSTO-1', 'Custo-padrão = caderno × composição × extensão × fator regional', Math.abs(custo.total - (4 * 180 + 150) * 1.15) < 0.01,
      `Poda de 4 vãos no CJ-Sul: (4 × R$ 180 + R$ 150 deslocamento) × 1,15 = R$ ${custo.total.toFixed(2)}`);

    await entrar(pp, 'Supervisão de Campo');
    await irPara(pp, 'programacao');
    const alvoProg = await pp.locator('.item-carteira').filter({ hasText: /Cruzeta|Poste|Estai/ }).first();
    const nomeAlvo = (await alvoProg.locator('strong').first().innerText());
    const codAlvo = (await alvoProg.locator('.muted.pequeno').first().innerText()).split(' · ')[0];
    await alvoProg.locator('button:has-text("Programar")').click();
    await pp.waitForTimeout(400);
    const logsProg = await pp.evaluate(async () => (await (await import('./js/auditoria.js')).todosLogs()).map((l) => l.acao));
    registrar('PROG-1', 'Programar acima do orçamento pede confirmação e fica registrado', logsProg.includes('ORCAMENTO_EXCEDIDO_CIENTE') && logsProg.includes('DEFEITO_PROGRAMADO'), `${nomeAlvo} em ${codAlvo}`);
    const quadroTem = await pp.locator('.quadro .ativ', { hasText: codAlvo }).count();
    await pp.click('button:has-text("Congelar programação da semana")');
    await pp.waitForTimeout(300);
    await pp.locator('.quadro .ativ', { hasText: codAlvo }).first().click();
    const amanha = await pp.evaluate(async () => { const u = await import('./js/util.js'); return u.proximoDiaUtil(u.proximoDiaUtil()); });
    await pp.fill('#sheet input[type=date]', amanha);
    await pp.click('#sheet-rodape button:has-text("Salvar reprogramação")');
    const semMotivo = await ultimoToast(pp);
    await pp.selectOption('#sheet select >> nth=1', { index: 4 });
    await pp.click('#sheet-rodape button:has-text("Salvar reprogramação")');
    await pp.waitForTimeout(300);
    const repr = await pp.evaluate(async (cod) => { const { estado } = await import('./js/store.js'); const a = estado.dados.ativos.find((x) => x.codigo === cod); const f = estado.dados.defeitos.find((x) => x.ativoId === a.id && x.status === 'PROGRAMADO'); return f.reprogramacoes?.at(-1); }, codAlvo);
    registrar('PROG-2', 'Semana congelada: reprogramar exige motivo e o motivo fica gravado', quadroTem > 0 && /motivo/.test(semMotivo) && repr?.motivo && repr.congelada, `sem motivo: "${semMotivo}" · gravado: ${repr?.motivo} (${repr?.de.data} → ${repr?.para.data})`);
    await pp.screenshot({ path: path.join(SAIDA, 'programacao.png'), fullPage: true });
    await cp.close();

    // ================= Plano por km, patrulha, drone, áreas e eficácia =================
    const ck = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
    const pk = await ck.newPage();
    vigiar(pk);
    pk.on('dialog', (d) => d.accept());
    await pk.goto(BASE);
    await entrar(pk, 'Equipe Inspeção 01');
    const kmiAntes = await pk.evaluate(async () => (await import('./js/planos.js')).indicadoresKmi()[0]);
    const alvoT = await pk.evaluate(async () => { const P = await import('./js/planos.js'); return P.trechos().find((t) => P.situacaoTrecho(t).id === 'vencido')?.id; });
    await pk.evaluate(async (id) => (await import('./js/trilha.js')).abrirTrecho(id), alvoT);
    await pk.click('#sheet-rodape button:has-text("Iniciar inspeção do trecho")');
    await pk.click('#trilha-painel button:has-text("Simular caminhada")');
    await pk.waitForFunction(() => /cobertura (9[5-9]|100)%/.test(document.querySelector('#trilha-painel')?.textContent || ''), null, { timeout: 15000 });
    await pk.click('#trilha-painel button:has-text("Concluir")');
    for (const g of await pk.locator('#sheet .segmentado').all()) await g.locator('.segmentado__op').first().click();
    await pk.setInputFiles('#sheet .fotos input[type=file]', FOTO);
    await pk.waitForTimeout(500);
    await pk.click('#sheet-rodape button:has-text("Salvar inspeção do trecho")');
    await pk.waitForTimeout(400);
    const kmiDepois = await pk.evaluate(async (id) => { const P = await import('./js/planos.js'); return { kmi: P.indicadoresKmi()[0], sit: P.situacaoTrecho(P.trechoPorId(id)).id, ult: P.ultimaCompleta(id) }; }, alvoT);
    registrar('KMI-1', 'Inspeção de trecho com trajeto GPS: cobertura ≥ 95% + checklist + foto conta no KMI', kmiDepois.sit === 'emdia' && kmiDepois.ult?.completa && kmiDepois.kmi.kmEmDia > kmiAntes.kmEmDia,
      `${alvoT}: cobertura ${(kmiDepois.ult?.cobertura * 100).toFixed(0)}% · km em dia ${kmiAntes.kmEmDia.toFixed(1)} → ${kmiDepois.kmi.kmEmDia.toFixed(1)} · aderência ${(kmiAntes.aderencia * 100).toFixed(0)}% → ${(kmiDepois.kmi.aderencia * 100).toFixed(0)}%`);

    // Cobertura baixa: vira parcial e não conta
    const alvo2 = await pk.evaluate(async () => { const P = await import('./js/planos.js'); return P.trechos().find((t) => P.situacaoTrecho(t).id === 'vencido')?.id; });
    const parcial = await pk.evaluate(async (id) => {
      const T = await import('./js/trilha.js'); const P = await import('./js/planos.js');
      T.iniciarTrilha('TRECHO', id);
      await new Promise((r) => T.simularPercurso(id, { fracao: 0.5, aoTerminar: r }));
      return { antes: P.indicadoresKmi()[0].kmEmDia };
    }, alvo2);
    await pk.click('#trilha-painel button:has-text("Concluir")');
    await pk.click('#sheet-rodape button:has-text("Salvar inspeção do trecho")');
    await pk.waitForTimeout(300);
    const parcialDepois = await pk.evaluate(async (id) => { const P = await import('./js/planos.js'); const i = P.inspecoesDoTrecho(id)[0]; return { completa: i.completa, cob: i.cobertura, km: P.indicadoresKmi()[0].kmEmDia }; }, alvo2);
    registrar('KMI-2', 'Trajeto que cobre só parte do trecho fica como parcial e não soma no KMI', !parcialDepois.completa && Math.abs(parcialDepois.km - parcial.antes) < 0.01, `${alvo2}: cobertura ${(parcialDepois.cob * 100).toFixed(0)}% → parcial`);

    // Patrulha da emergência
    const patrulha = await pk.evaluate(async () => {
      const P = await import('./js/planos.js');
      const antes = P.indicadoresKmi()[0].kmEmDia;
      window.__simularPatrulha();
      await new Promise((r) => setTimeout(r, 2500));
      return { antes };
    });
    await pk.click('#trilha-painel button:has-text("Encerrar patrulha")');
    await pk.waitForTimeout(300);
    const patDepois = await pk.evaluate(async () => { const { estado } = await import('./js/store.js'); const P = await import('./js/planos.js'); const novos = estado.dados.inspecoesTrecho.filter((i) => i.tipo === 'PATRULHA' && !i.sintetico); return { n: novos.length, km: novos.reduce((t, i) => t + i.km, 0), completas: novos.filter((i) => i.completa).length, kmEmDia: P.indicadoresKmi()[0].kmEmDia }; });
    const temCompletar = await pk.locator('#sheet button:has-text("Completar como inspeção")').count();
    registrar('PAT-1', 'Patrulha registra km por trecho, não conta no KMI e oferece completar como inspeção', patDepois.n >= 1 && patDepois.completas === 0 && Math.abs(patDepois.kmEmDia - patrulha.antes) < 0.01 && temCompletar > 0,
      `${patDepois.n} trecho(s) · ${patDepois.km.toFixed(2)} km patrulhados · ${temCompletar} com cobertura para virar inspeção`);
    await pk.click('#sheet-fechar');

    // Drone: importa o log de voo de exemplo
    await pk.evaluate(async () => (await import('./js/trilha.js')).abrirTrecho('ALM-07-T03'));
    const [fc] = await Promise.all([pk.waitForEvent('filechooser'), pk.click('#sheet button:has-text("Importar voo de drone")')]);
    await fc.setFiles(path.join(RAIZ, 'app', 'modelos', 'exemplo-voo-drone-ALM-07-T03.kml'));
    await pk.waitForSelector('#sheet-titulo:has-text("Voo de drone")');
    for (const g of await pk.locator('#sheet .segmentado').all()) await g.locator('.segmentado__op').first().click();
    await pk.setInputFiles('#sheet .fotos input[type=file]', FOTO);
    await pk.waitForTimeout(500);
    const textoCob = await pk.locator('#sheet .geo').first().innerText();
    await pk.click('#sheet-rodape button:has-text("Salvar inspeção do trecho")');
    await pk.waitForTimeout(300);
    const drone = await pk.evaluate(async () => (await import('./js/planos.js')).inspecoesDoTrecho('ALM-07-T03')[0]);
    registrar('DRONE-1', 'Voo de drone importado (KML) vira inspeção com cobertura calculada', drone.tipo === 'DRONE' && drone.completa, `${textoCob.split('.')[0]} · tipo ${drone.tipo}`);

    // Áreas de plano e eficácia (gestor)
    await entrar(pk, 'Gestão de Planejamento');
    const areaRes = await pk.evaluate(async () => {
      const P = await import('./js/planos.js');
      const out = {};
      const t = P.trechos()[5]; const c = t.coords[0];
      try { P.criarArea({ tipoPlano: 'EVENTO', nome: 'Show sem data', geometria: { tipo: 'circulo', centro: c, raioM: 300 } }); out.semData = 'ACEITO'; } catch (e) { out.semData = e.message; }
      try { P.criarArea({ tipoPlano: 'ESCOLA', nome: 'Escola longe', geometria: { tipo: 'circulo', centro: [-15.70, -47.80], raioM: 100 } }); out.longe = 'ACEITO'; } catch (e) { out.longe = e.message; }
      const a = P.criarArea({ tipoPlano: 'ESCOLA', nome: 'Escola de teste', geometria: { tipo: 'circulo', centro: c, raioM: 200 } });
      out.trechos = P.trechos().filter((x) => P.areasDoTrecho(x.id).includes(a)).length;
      out.exig = P.exigencia(t).periodicidade;
      return out;
    });
    registrar('PLANO-1', 'Área de escola (raio) entra no plano com periodicidade própria; evento sem data e área fora da rede são recusados', areaRes.trechos >= 1 && areaRes.exig <= 60 && /início e fim/.test(areaRes.semData) && /nenhum trecho/.test(areaRes.longe),
      `${areaRes.trechos} trecho(s) na área · exigência ${areaRes.exig} dias`);

    await irPara(pk, 'plano');
    await pk.setInputFiles('#view-plano input[type=file] >> nth=1', path.join(RAIZ, 'app', 'modelos', 'template-ocorrencias.csv'));
    await pk.waitForTimeout(400);
    const efic = await pk.evaluate(async (id) => {
      const E = await import('./js/eficacia.js'); const P = await import('./js/planos.js'); const { estado } = await import('./js/store.js');
      const imp = estado.dados.ocorrencias.filter((o) => o.origem === 'template-ocorrencias.csv');
      const desc = imp.find((o) => o.causa === 'DESC');
      const t = P.trechoPorId(id); const m = t.coords[Math.floor(t.coords.length / 2)];
      const recente = E.atribuir({ dataHora: new Date().toISOString(), lat: m[0], lon: m[1], causa: 'EST' });
      const ind = E.indicadoresEficacia();
      const soma = Object.values(ind.porPortao).reduce((s, x) => s + x.qtd, 0);
      return { importadas: imp.length, desc: desc ? E.atribuir(desc).portao : null, recente: recente.portao, soma, total: ind.ocorrencias.length, eficacia: ind.eficacia };
    }, alvoT);
    registrar('EFIC-1', 'Ocorrências importadas e atribuídas: não evitável fica fora; trecho recém-inspecionado não cai em "Plano"', efic.importadas === 2 && efic.desc === 'EXCLUIDA' && efic.recente !== 'PLANO' && efic.soma === efic.total,
      `${efic.importadas} importadas · descarga → ${efic.desc} · desarme estrutural no trecho inspecionado hoje → ${efic.recente} · eficácia ${(efic.eficacia * 100).toFixed(0)}%`);
    await irPara(pk, 'painel');
    registrar('FUNIL-1', 'Painel mostra os 4 indicadores do funil (Plano → Inspeção → Programação → Eficácia) com tendência', await pk.locator('.kpis--2x2 .kpi--tend').count() === 4 && await pk.locator('.kpis--2x2 svg.spark').count() === 4, (await pk.locator('.kpis--2x2 .kpi__rotulo').allInnerTexts()).join(' · '));
    await pk.click('#aba-painel-eficacia');
    registrar('FUNIL-2', 'Aba Eficácia mostra em que etapa cada desarme evitável falhou', await pk.locator('#painel-aba-conteudo .funil .barras__linha').count() === 4, (await pk.locator('#painel-aba-conteudo .barras__rot').allInnerTexts()).join(' · ').slice(0, 160));
    await pk.screenshot({ path: path.join(SAIDA, 'funil.png'), fullPage: true });
    await ck.close();

    // ================= Trabalho offline por alimentador =================
    const ctxo = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const po = await ctxo.newPage();
    vigiar(po);
    await po.goto(BASE);
    await po.waitForFunction(() => navigator.serviceWorker.ready.then(() => true));
    await po.reload();
    await entrar(po, 'Equipe Inspeção 01');
    await po.click('#ctrl-mais');
    await po.click('#ctrl-offline');
    await po.selectOption('#sheet select', 'ALM-07');
    await po.waitForTimeout(400);
    const estim = (await po.locator('#sheet .meta-grupo').innerText()).replace(/\n/g, ' ');
    await po.click('#sheet-rodape button');
    await po.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Pacote ALM-07/.test(t.textContent)), null, { timeout: 90000 });
    let dpo = await dados(po);
    const pac = dpo.pacotes['ALM-07'];
    registrar('OFF-1', 'Pacote do alimentador: recorte leve de dados + mapa só do corredor', pac.bytesDados < 150 * 1024 && pac.tilesTotal <= 250 && pac.tilesOk > 0,
      `${pac.itens.ativos} ativos, ${pac.itens.inspecoes} inspeções, ${pac.itens.defeitos} defeitos · dados ${Math.round(pac.bytesDados / 1024)} KB (${Math.round((pac.bytesGzip || 0) / 1024)} KB gzip) · mapa ${pac.tilesOk}/${pac.tilesTotal} quadros`);
    console.log('   estimativa exibida:', estim);

    // Sem rede de verdade: recarrega e o mapa do corredor vem do pacote
    await ctxo.setOffline(true);
    await po.reload();
    await po.waitForSelector('#login input[autocomplete=username], .nav__btn', { timeout: 10000 });
    if (await po.locator('#login').isVisible()) await entrar(po, 'Equipe Inspeção 01');
    else await irPara(po, 'mapa');
    await po.fill('#view-mapa .busca__inp', 'P-07-010');
    await po.click('.busca__item');
    await po.waitForTimeout(2500);
    const quadros = await po.locator('.leaflet-tile-loaded').count();
    registrar('OFF-2', 'Sem internet, o mapa do corredor abre a partir do pacote', quadros > 0, `${quadros} quadros de mapa carregados offline`);

    // Mapa leve: zero quadros, rede continua visível
    await po.evaluate(async () => (await import('./js/offline.js')).definirMapaLeve(true));
    await po.waitForTimeout(300);
    const quadrosLeve = await po.locator('.leaflet-tile').count();
    const marcadores = await po.locator('.mk-wrap').count();
    registrar('OFF-3', 'Mapa leve mostra só a rede, sem baixar fundo', quadrosLeve === 0 && marcadores > 0, `${marcadores} ativos visíveis, ${quadrosLeve} quadros de fundo`);
    await po.evaluate(async () => (await import('./js/offline.js')).definirMapaLeve(false));

    // Rede móvel: registros sobem, fotos esperam o Wi-Fi
    await ctxo.setOffline(false);
    const filaRede = await po.evaluate(async () => {
      const st = await import('./js/store.js');
      st.estado.redeMovelSimulada = true;
      await st.salvarFoto(new Blob([new Uint8Array(40000)], { type: 'image/jpeg' }));
      st.registrar('TESTE_REGISTRO', 'teste', 'x');
      await new Promise((r) => setTimeout(r, 1200));
      const em4g = st.resumoFila();
      st.estado.redeMovelSimulada = false;
      st.sincronizar();
      await new Promise((r) => setTimeout(r, 1200));
      return { em4g, wifi: st.resumoFila() };
    });
    registrar('OFF-4', 'Na rede móvel os registros sobem e as fotos aguardam o Wi-Fi', filaRede.em4g.dados === 0 && filaRede.em4g.fotos >= 1 && filaRede.wifi.total === 0,
      `4G: ${filaRede.em4g.dados} registros / ${filaRede.em4g.fotos} foto(s) na fila → Wi-Fi: ${filaRede.wifi.total}`);
    await ctxo.close();

    // ================= Fase 8 — PWA, recarga sem rede, anti-iframe =================
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    vigiar(p2);
    await p2.goto(BASE);
    await p2.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true));
    const arquivos = [];
    for (const f of ['manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png', 'icon.svg']) arquivos.push(`${f}:${(await p2.request.get(BASE + f)).status()}`);
    registrar('8.4', 'PWA instalável: manifest, service worker e ícones', arquivos.every((a) => a.endsWith(':200')), arquivos.join(' '));
    await p2.waitForTimeout(800);
    await ctx2.setOffline(true);
    await p2.reload();
    await p2.waitForSelector('#login input[autocomplete=username]', { timeout: 8000 }).catch(() => {});
    registrar('8.3b', 'App abre sem rede (service worker)', await p2.locator('#login input[autocomplete=username]').count() > 0, 'recarregado com rede cortada');
    await ctx2.setOffline(false);
    await p2.setContent(`<iframe src="${BASE}" width="600" height="400"></iframe>`);
    await p2.waitForTimeout(1500);
    const txtFrame = await p2.frames()[1]?.locator('body').innerText().catch(() => '') || '';
    registrar('1.4', 'App se recusa a rodar dentro de iframe (clickjacking)', /não pode ser aberto dentro de outra página/.test(txtFrame), txtFrame.slice(0, 80));
    await ctx2.close();


    // ================= Interface: Hoje, fluxo, mapa por visão, busca única, modo sol =================
    const cg = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block' });
    const g = await cg.newPage();
    vigiar(g);
    g.on('dialog', (dl) => dl.accept());
    await g.goto(BASE);
    await entrar(g, 'Gestão de Planejamento', { ficarEmHoje: true });
    const abriuHoje = await g.locator('#view-hoje').isVisible();
    const cartoes = await g.locator('#view-hoje .hoje-card').count();
    const titulos = await g.locator('#view-hoje .hoje-card__tit').allInnerTexts();
    registrar('HOJE-1', 'Gestor entra na tela Hoje com no máximo 3 decisões', abriuHoje && cartoes >= 1 && cartoes <= 3, `${cartoes} cartão(ões): ${titulos.join(' · ')}`);
    await g.locator('#view-hoje .hoje-card button').first().click();
    await g.waitForTimeout(400);
    const logHoje = await g.evaluate(async () => (await (await import('./js/auditoria.js')).todosLogs()).filter((l) => l.acao === 'HOJE_ACAO').length);
    const foiPara = await g.evaluate(() => [...document.querySelectorAll('.view')].find((v) => !v.hidden)?.id);
    registrar('HOJE-2', 'Ação do cartão leva à tela certa e fica no log', logHoje >= 1 && foiPara !== 'view-hoje', `foi para ${foiPara} · ${logHoje} registro(s) HOJE_ACAO`);

    // Linha do tempo e indicadores de fluxo
    const fl = await g.evaluate(async () => {
      const F = await import('./js/fluxo.js'); const { estado } = await import('./js/store.js');
      const f = estado.dados.defeitos.find((x) => x.status === 'VERIFICADO');
      const lt = F.linhaDoTempo(f);
      const tp = F.temposPorEtapa(); const id = F.idadeCarteira(); const tx = F.taxaAchado(); const chi = F.chiEmRisco();
      const abertos = estado.dados.defeitos.filter((x) => ['IDENTIFICADO', 'VALIDADO', 'PROGRAMADO'].includes(x.status)).length;
      return { feitas: lt.etapas.filter((e) => e.feito).length, total: lt.total, gargalo: tp.gargalo?.nome, somaIdade: id.reduce((t, x) => t + x.total, 0), abertos, taxa: tx.media, chi: chi.chi, ucs: chi.ucs, h: chi.duracaoH };
    });
    registrar('FLUXO-1', 'Linha do tempo, tempo por etapa, idade da carteira e CHI em risco consistentes', fl.feitas === 5 && fl.somaIdade === fl.abertos && fl.taxa > 0 && Math.abs(fl.chi - fl.ucs * fl.h) < 1e-6,
      `verificado: 5/5 etapas em ${fl.total} d · gargalo ${fl.gargalo} · carteira ${fl.somaIdade}/${fl.abertos} · ${fl.taxa?.toFixed(2)} def/km · CHI ${Math.round(fl.chi)} = ${fl.ucs} UCs × ${fl.h} h`);
    await irPara(g, 'defeitos');
    const tl = await g.locator('.card-def .tl').first().locator('.tl__passo').count();
    const tlSr = await g.locator('.card-def .tl .sr-only').first().innerText();
    registrar('FLUXO-2', 'Cartão do defeito mostra a linha do tempo em 5 etapas, com texto para leitor de tela', tl === 5 && /em \d{2}\/\d{2}\/\d{4}/.test(tlSr), `${tl} etapas · "${tlSr}"`);

    // Funil clicável: etapa → lista filtrada
    await irPara(g, 'painel');
    const verBtn = g.locator('.funil2__etapa', { hasText: 'Programado' }).locator('.btn--mini');
    const rot = await verBtn.innerText();
    await verBtn.click();
    await g.waitForTimeout(400);
    const chipFiltro = await g.locator('#view-defeitos .chip--filtro').innerText().catch(() => '');
    const nCards = await g.locator('#view-defeitos .card-def').count();
    registrar('FUNIL-3', 'Etapa do funil abre a lista de Defeitos já filtrada', /Programado/.test(chipFiltro) && `Ver ${nCards}` === rot, `${rot} → ${nCards} cartão(ões) · filtro "${chipFiltro.trim()}"`);
    const hist = await g.evaluate(async () => { const H = await import('./js/historico.js'); const s = H.serie('kmi'); return { n: s.pontos.length, validos: s.pontos.filter((p) => p.valor !== null).length, sint: s.sintetico }; });
    registrar('HIST-1', 'Foto semanal: 12 semanas de tendência (anteriores marcadas como sintéticas)', hist.n === 12 && hist.validos === 12 && hist.sint, `${hist.validos}/${hist.n} semanas · sintético: ${hist.sint}`);

    // Mapa: uma visão por vez, legenda adaptada
    await irPara(g, 'mapa');
    const contar = () => g.evaluate(() => ({ sev: document.querySelectorAll('.leaflet-marker-pane .mk--sev-A, .leaflet-marker-pane .mk--sev-B, .leaflet-marker-pane .mk--sev-C').length, insp: document.querySelectorAll('.leaflet-marker-pane .mk--insp-vencida, .leaflet-marker-pane .mk--insp-pendente').length,
      trechoCor: document.querySelectorAll('.tronco--vencido, .tronco--vencendo, .tronco--emdia').length, legenda: [...document.querySelectorAll('.legenda__grupo[data-visoes]')].filter((x) => !x.hidden).map((x) => x.querySelector('strong').textContent) }));
    const vDef = await contar();
    await g.click('.visoes__btn:has-text("Plano")'); await g.waitForTimeout(300);
    const vPlano = await contar();
    registrar('MAPA-1', 'Mapa mostra uma codificação de cor por vez (Defeitos × Plano) e a legenda acompanha', vDef.sev > 0 && vDef.insp === 0 && vDef.trechoCor === 0 && vPlano.sev === 0 && vPlano.insp > 0 && vPlano.trechoCor > 0 && vDef.legenda.join() !== vPlano.legenda.join(),
      `Defeitos: ${vDef.sev} marcadores de severidade, ${vDef.insp} de inspeção, legenda [${vDef.legenda}] · Plano: ${vPlano.insp} de inspeção, ${vPlano.trechoCor} trechos coloridos, legenda [${vPlano.legenda}]`);
    await g.click('.visoes__btn:has-text("Defeitos")');

    // Busca única (Ctrl+K)
    await irPara(g, 'painel');
    await g.keyboard.press('Control+k');
    await g.fill('#busca-global .busca__inp', 'ALM-07-T03');
    await g.keyboard.press('Enter');
    await g.waitForTimeout(700);
    const sheetTit = await g.locator('#sheet-titulo').innerText().catch(() => '');
    registrar('BUSCA-1', 'Ctrl+K busca trecho de qualquer tela e abre a ficha no mapa', (await g.locator('#view-mapa').isVisible()) && /ALM-07-T03/.test(sheetTit), `ficha: "${sheetTit}"`);
    await g.keyboard.press('Control+k');
    await g.fill('#busca-global .busca__inp', 'poda');
    const tipos = await g.locator('#busca-global .busca__item .muted').allInnerTexts();
    await g.fill('#busca-global .busca__inp', 'ninho');
    tipos.push(...await g.locator('#busca-global .busca__item .muted').allInnerTexts());
    await g.keyboard.press('Escape');
    registrar('BUSCA-2', 'Busca encontra equipe e tipo de defeito pelo nome', tipos.some((t) => /Equipe/.test(t)) && tipos.some((t) => /Defeito/.test(t)) && await g.locator('#busca-global').isHidden(), tipos.slice(0, 4).join(' | '));

    // Modo sol
    await g.click('#btn-sol');
    const sol = await g.evaluate(() => ({ tema: document.documentElement.dataset.theme, fundo: getComputedStyle(document.body).backgroundColor, salvo: localStorage.getItem('redeviva-sol') }));
    await g.reload();
    await g.waitForTimeout(800);
    const solDepois = await g.evaluate(() => document.documentElement.dataset.theme);
    registrar('SOL-1', 'Modo sol liga alto contraste e é lembrado no aparelho', sol.tema === 'sol' && sol.fundo === 'rgb(255, 255, 255)' && solDepois === 'sol', `tema ${sol.tema} · fundo ${sol.fundo} · após recarregar: ${solDepois}`);
    await g.click('#btn-sol');
    await cg.close();

    // ================= Fase 8 — 360 px e alvos de toque ≥ 48 px =================
    const ctx3 = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const m = await ctx3.newPage();
    vigiar(m);
    await m.goto(BASE);
    const estouros = [], pequenos = [];
    const medir = async (tela) => {
      await m.waitForTimeout(250);
      const sw = await m.evaluate(() => document.documentElement.scrollWidth);
      if (sw > 360) estouros.push(`${tela}:${sw}px`);
      const ruins = await m.evaluate(() => [...document.querySelectorAll('button, a.btn, input:not([type=file]):not([type=hidden]), select, textarea, summary')]
        .filter((n) => n.offsetParent !== null && !n.closest('.leaflet-control-attribution, .leaflet-marker-icon'))
        .map((n) => ({ n, r: n.getBoundingClientRect() }))
        .filter(({ n, r }) => (n.type === 'checkbox' ? Math.max(r.height, n.closest('label')?.getBoundingClientRect().height || 0) : r.height) < 47.5)
        .map(({ n, r }) => `${n.tagName.toLowerCase()}${n.className ? '.' + String(n.className).split(' ')[0] : ''}(${Math.round(r.height)}px "${(n.textContent || n.placeholder || n.type || '').trim().slice(0, 18)}")`));
      ruins.forEach((x) => pequenos.push(`${tela}: ${x}`));
      await m.screenshot({ path: path.join(SAIDA, `360-${tela}.png`) });
    };
    await medir('login');
    await entrar(m, 'Equipe Inspeção 02', { ficarEmHoje: true });
    await medir('hoje-equipe');
    const paradas = await m.locator('#view-hoje .rota__item').count();
    registrar('HOJE-3', 'Equipe abre na rota do dia (paradas na ordem do mais próximo)', paradas > 0, `${paradas} parada(s) · ${await m.locator('#view-hoje .tela__topo .muted').innerText()}`);
    await irPara(m, 'mapa');
    await medir('mapa');
    await m.click('#ctrl-mais'); await medir('mapa-mais'); await m.click('#ctrl-mais');
    await m.click('#ctrl-filtros'); await medir('filtros'); await m.click('#ctrl-filtros');
    const dm = await dados(m);
    const pm = dm.inspecoes.find((i) => i.status !== 'CONCLUIDA' && i.equipeId === 'INS-02');
    await m.fill('.busca__inp', dm.ativos.find((a) => a.id === pm.ativoId).codigo);
    await medir('busca');
    await m.locator('.busca__item').first().tap();
    await m.waitForTimeout(900);
    await medir('ficha');
    await m.click('#sheet-rodape button');
    await medir('form-etapa1');
    await m.click('#sheet-rodape button:has-text("Próximo")');
    await m.click('text=＋ Adicionar defeito / manutenção');
    await medir('form-etapa2');
    await m.goBack();
    await m.waitForTimeout(300);
    registrar('8.9', 'Botão voltar do celular fecha o painel sem sair do app', await m.locator('#sheet').isHidden() && m.url().includes('/app/'), m.url());
    await irPara(m, 'defeitos'); await medir('defeitos');
    await irPara(m, 'producao'); await medir('producao');
    await entrar(m, 'Gestão de Planejamento', { ficarEmHoje: true });
    await medir('hoje-gestor');
    await irPara(m, 'painel'); await medir('painel');
    await irPara(m, 'plano'); await medir('plano');
    await irPara(m, 'acesso'); await m.waitForTimeout(500); await medir('acesso');
    await irPara(m, 'programacao'); await m.waitForTimeout(400); await medir('programacao');
    const agendaVisivel = await m.locator('#view-programacao .agenda').isVisible();
    const tabelaVisivel = await m.locator('#view-programacao .quadro').isVisible();
    await m.locator('#view-programacao .agenda__dia').nth(1).click(); await m.waitForTimeout(300);
    const diaSel = await m.locator('#view-programacao .agenda__dia.ativo').getAttribute('aria-label');
    registrar('AGENDA-1', 'Programação no celular: agenda por dia em vez da tabela de 7 colunas', agendaVisivel && !tabelaVisivel && /Ter/.test(diaSel), `agenda visível, tabela oculta · dia escolhido: ${diaSel}`);
    await irPara(m, 'parametros'); await m.waitForTimeout(400); await medir('parametros');
    registrar('8.1', 'Viewport 360 px sem rolagem horizontal', !estouros.length, estouros.join(', ') || '17 telas verificadas');
    registrar('8.2', 'Alvos de toque ≥ 48 px', !pequenos.length, pequenos.length ? `${pequenos.length} abaixo: ${pequenos.slice(0, 6).join('; ')}` : 'todos os controles visíveis ≥ 48 px');
    await ctx3.close();

    registrar('6.x', 'Sem erros de JavaScript nem violações de CSP no console', !erros.length, erros.slice(0, 3).join(' | ') || 'console limpo');
  } catch (e) {
    registrar("E2E", "Execução do roteiro", false, e.message.split("\n").slice(0, 6).join(" | "));
  } finally {
    await browser.close();
    srv.close();
  }
  const falhas = resultados.filter((r) => !r.passou).length;
  fs.writeFileSync(path.join(SAIDA, 'resultado-e2e.json'), JSON.stringify({ quando: new Date().toISOString(), resultados }, null, 2));
  console.log(`\n${resultados.length - falhas}/${resultados.length} verificações aprovadas.`);
  process.exit(falhas ? 1 : 0);
})();
