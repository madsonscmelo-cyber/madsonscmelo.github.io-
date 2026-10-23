/* =========================================================
   Madson Melo — interações e animações
   Bibliotecas (CDN): GSAP + ScrollTrigger, Lenis
   ========================================================= */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var hasGsap = typeof window.gsap !== 'undefined' && typeof window.ScrollTrigger !== 'undefined';

  // Sem GSAP ou com movimento reduzido: mostra tudo imediatamente.
  if (!hasGsap || reduceMotion) root.classList.add('no-anim');
  root.classList.add('anim-ready');

  /* ---------- Navegação: fundo ao rolar + barra de progresso ---------- */
  var nav = document.querySelector('.nav');
  var bar = document.querySelector('.progress__bar');
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var y = window.scrollY;
      var max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(y / max, 1) : 0) + ')';
      nav.classList.toggle('is-scrolled', y > 40);
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Contadores ---------- */
  function formatCounter(el, value) {
    el.textContent = (el.dataset.prefix || '') + Math.round(value).toLocaleString('pt-BR') + (el.dataset.suffix || '');
  }

  /* ---------- Canvas: malha de rede elétrica ---------- */
  initGrid(document.querySelector('.hero__canvas'));

  /* ---------- Sem animações: encerra aqui ---------- */
  if (!hasGsap || reduceMotion) {
    document.querySelectorAll('.timeline .tl').forEach(function (el) { el.classList.add('is-lit'); });
    return;
  }

  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;
  gsap.registerPlugin(ScrollTrigger);

  /* ---------- Scroll suave (Lenis) ---------- */
  var lenis = null;
  if (typeof window.Lenis !== 'undefined') {
    lenis = new window.Lenis({ duration: 1.1, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
  }

  // Âncoras internas com rolagem suave e compensação do menu fixo
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href');
      var target = id.length > 1 && document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      var offset = id === '#inicio' ? 0 : -(nav.offsetHeight - 1);
      if (lenis) lenis.scrollTo(target, { offset: offset });
      else window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY + offset, behavior: 'smooth' });
      if (id === '#conteudo') target.focus({ preventScroll: true });
    });
  });

  /* ---------- Hero: revelação palavra por palavra ---------- */
  var phrase = document.querySelector('[data-split]');
  splitWords(phrase);
  phrase.style.visibility = 'visible';

  gsap.timeline({ defaults: { ease: 'power3.out' } })
    .to('.hero__name', { opacity: 1, duration: .6 }, 0)
    .from('.hero__name', { y: 16, duration: .6 }, 0)
    .from(phrase.querySelectorAll('.word > span'), { yPercent: 110, duration: .9, stagger: .07 }, .1)
    .to('[data-hero]', { opacity: 1, duration: .7, stagger: .12 }, .5)
    .from('[data-hero]', { y: 20, duration: .7, stagger: .12 }, .5);

  /* ---------- Seções: fade + slide ---------- */
  gsap.utils.toArray('[data-reveal]').forEach(function (el) {
    gsap.fromTo(el, { opacity: 0, y: 40 }, {
      opacity: 1, y: 0, duration: .9, ease: 'power3.out',
      scrollTrigger: { trigger: el, start: 'top 88%', once: true }
    });
  });

  /* ---------- Contadores animados ---------- */
  document.querySelectorAll('.counter').forEach(function (el) {
    var obj = { v: 0 };
    var target = parseFloat(el.dataset.target);
    formatCounter(el, 0);
    gsap.to(obj, {
      v: target, duration: 2, ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 92%', once: true },
      onUpdate: function () { formatCounter(el, obj.v); }
    });
  });

  /* ---------- Timeline: linha que acende ---------- */
  var timeline = document.querySelector('.timeline');
  gsap.to('.timeline__fill', {
    scaleY: 1, ease: 'none',
    scrollTrigger: { trigger: timeline, start: 'top 65%', end: 'bottom 65%', scrub: .4 }
  });
  timeline.querySelectorAll('.tl').forEach(function (item) {
    ScrollTrigger.create({
      trigger: item, start: 'top 65%',
      onEnter: function () { item.classList.add('is-lit'); },
      onLeaveBack: function () { item.classList.remove('is-lit'); }
    });
  });

  /* ---------- Expertise: chips ---------- */
  gsap.fromTo('.chip', { opacity: 0, y: 20, scale: .92 }, {
    opacity: 1, y: 0, scale: 1, duration: .6, ease: 'back.out(1.6)', stagger: .06,
    scrollTrigger: { trigger: '.chips', start: 'top 85%', once: true }
  });

  /* ---------- Interações só para desktop (mouse) ---------- */
  if (finePointer) {
    initTilt();
    initMagnetic();
    initCursor();
  }

  window.addEventListener('load', function () { ScrollTrigger.refresh(); });

  /* =========================================================
     Funções
     ========================================================= */

  function splitWords(el) {
    // Quebra o texto em <span class="word"><span>palavra</span></span>, preservando <em>
    var frag = document.createDocumentFragment();
    Array.prototype.slice.call(el.childNodes).forEach(function (node) {
      var text = node.textContent;
      var wrapper = node.nodeType === 1 ? node.cloneNode(false) : null;
      text.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
        var word = document.createElement('span');
        word.className = 'word';
        var inner = document.createElement('span');
        if (wrapper) {
          var w = wrapper.cloneNode(false);
          w.textContent = part;
          inner.appendChild(w);
        } else {
          inner.textContent = part;
        }
        word.appendChild(inner);
        frag.appendChild(word);
      });
    });
    el.setAttribute('aria-label', el.textContent.trim());
    el.textContent = '';
    el.appendChild(frag);
    el.querySelectorAll('.word').forEach(function (w) { w.setAttribute('aria-hidden', 'true'); });
  }

  function initTilt() {
    var mq = window.matchMedia('(min-width: 900px)');
    document.querySelectorAll('.tilt').forEach(function (card) {
      var rx = gsap.quickTo(card, 'rotationX', { duration: .5, ease: 'power3.out' });
      var ry = gsap.quickTo(card, 'rotationY', { duration: .5, ease: 'power3.out' });
      card.addEventListener('pointermove', function (e) {
        if (!mq.matches) return;
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - .5;
        var py = (e.clientY - r.top) / r.height - .5;
        ry(px * 8);
        rx(-py * 8);
      });
      card.addEventListener('pointerleave', function () { rx(0); ry(0); });
    });
  }

  function initMagnetic() {
    document.querySelectorAll('.magnetic').forEach(function (btn) {
      var xTo = gsap.quickTo(btn, 'x', { duration: .4, ease: 'power3.out' });
      var yTo = gsap.quickTo(btn, 'y', { duration: .4, ease: 'power3.out' });
      btn.addEventListener('pointermove', function (e) {
        var r = btn.getBoundingClientRect();
        xTo((e.clientX - (r.left + r.width / 2)) * .3);
        yTo((e.clientY - (r.top + r.height / 2)) * .3);
      });
      btn.addEventListener('pointerleave', function () { xTo(0); yTo(0); });
    });
  }

  function initCursor() {
    var cursor = document.querySelector('.cursor');
    var dot = cursor.querySelector('.cursor__dot');
    var ring = cursor.querySelector('.cursor__ring');
    var mx = -100, my = -100, rx = -100, ry = -100;
    root.classList.add('has-cursor');

    window.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      mx = e.clientX; my = e.clientY;
      dot.style.transform = 'translate3d(' + mx + 'px,' + my + 'px,0)';
      var t = e.target;
      cursor.classList.toggle('is-hover', !!(t.closest && t.closest('a, button, .tilt, .chip')));
      cursor.classList.toggle('is-light', !!(t.closest && t.closest('.section--light')));
    }, { passive: true });
    document.addEventListener('mouseleave', function () { mx = my = -100; });

    gsap.ticker.add(function () {
      rx += (mx - rx) * .18;
      ry += (my - ry) * .18;
      ring.style.transform = 'translate3d(' + rx + 'px,' + ry + 'px,0)';
    });
  }

  /* ---------- Malha elétrica no canvas ---------- */
  function initGrid(canvas) {
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 0, h = 0, nodes = [], edges = [], pulses = [];
    var pointer = { x: -9999, y: -9999, active: false };
    var running = false, visible = true, rafId = 0;
    var GREEN = '0,195,137', BLUE = '59,130,246';

    function build() {
      var rect = canvas.getBoundingClientRect();
      w = rect.width; h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Grade com variação aleatória = aparência de rede de distribuição
      var spacing = w < 640 ? 78 : 104;
      var cols = Math.ceil(w / spacing) + 1;
      var rows = Math.ceil(h / spacing) + 1;
      nodes = []; edges = []; pulses = [];
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var x = c * spacing + (Math.random() - .5) * spacing * .55;
          var y = r * spacing + (Math.random() - .5) * spacing * .55;
          nodes.push({ x: x, y: y, bx: x, by: y, hub: Math.random() < .12, links: [] });
        }
      }
      function link(a, b) {
        var e = { a: a, b: b, glow: 0 };
        edges.push(e);
        nodes[a].links.push(edges.length - 1);
        nodes[b].links.push(edges.length - 1);
      }
      for (r = 0; r < rows; r++) {
        for (c = 0; c < cols; c++) {
          var i = r * cols + c;
          if (c < cols - 1 && Math.random() < .78) link(i, i + 1);
          if (r < rows - 1 && Math.random() < .7) link(i, i + cols);
          if (c < cols - 1 && r < rows - 1 && Math.random() < .14) link(i, i + cols + 1);
        }
      }
      var count = Math.max(6, Math.round(edges.length / 14));
      for (var p = 0; p < count; p++) pulses.push(newPulse());
    }

    function newPulse() {
      var e = (Math.random() * edges.length) | 0;
      return { edge: e, t: 0, dir: Math.random() < .5 ? 1 : -1, speed: .006 + Math.random() * .01, color: Math.random() < .7 ? GREEN : BLUE };
    }

    function advance(p) {
      // Ao chegar ao fim do trecho, segue por outro trecho conectado ao nó
      var e = edges[p.edge];
      var nodeIdx = p.dir === 1 ? e.b : e.a;
      var options = nodes[nodeIdx].links.filter(function (k) { return k !== p.edge; });
      if (!options.length || Math.random() < .04) { Object.assign(p, newPulse()); return; }
      var next = options[(Math.random() * options.length) | 0];
      p.edge = next;
      p.dir = edges[next].a === nodeIdx ? 1 : -1;
      p.t = 0;
    }

    function draw(animate) {
      ctx.clearRect(0, 0, w, h);
      var i, n, e, a, b;

      // Nós reagem levemente ao ponteiro
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        var tx = n.bx, ty = n.by;
        if (pointer.active) {
          var dx = n.bx - pointer.x, dy = n.by - pointer.y;
          var d2 = dx * dx + dy * dy;
          if (d2 < 32000) {
            var f = (1 - d2 / 32000) * 14 / (Math.sqrt(d2) + 1);
            tx += dx * f; ty += dy * f;
          }
        }
        n.x += (tx - n.x) * .08;
        n.y += (ty - n.y) * .08;
      }

      // Linhas
      ctx.lineWidth = 1;
      for (i = 0; i < edges.length; i++) {
        e = edges[i]; a = nodes[e.a]; b = nodes[e.b];
        var near = 0;
        if (pointer.active) {
          var mx = (a.x + b.x) / 2 - pointer.x, my = (a.y + b.y) / 2 - pointer.y;
          near = Math.max(0, 1 - (mx * mx + my * my) / 40000);
        }
        e.glow *= .94;
        var alpha = .07 + near * .25 + e.glow * .35;
        ctx.strokeStyle = 'rgba(' + (near > .2 ? GREEN : BLUE) + ',' + alpha.toFixed(3) + ')';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }

      // Nós
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        if (!n.links.length) continue;
        ctx.fillStyle = n.hub ? 'rgba(' + GREEN + ',.75)' : 'rgba(230,236,245,.22)';
        ctx.beginPath(); ctx.arc(n.x, n.y, n.hub ? 2.4 : 1.4, 0, 6.283); ctx.fill();
      }

      // Pulsos de luz percorrendo as linhas
      ctx.globalCompositeOperation = 'lighter';
      for (i = 0; i < pulses.length; i++) {
        var p = pulses[i];
        if (animate) {
          p.t += p.speed * (pointer.active ? 1.4 : 1);
          if (p.t >= 1) { edges[p.edge].glow = 1; advance(p); }
        }
        e = edges[p.edge]; a = nodes[e.a]; b = nodes[e.b];
        var t = p.dir === 1 ? p.t : 1 - p.t;
        var x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        var g = ctx.createRadialGradient(x, y, 0, x, y, 14);
        g.addColorStop(0, 'rgba(' + p.color + ',.9)');
        g.addColorStop(1, 'rgba(' + p.color + ',0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, 14, 0, 6.283); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 6.283); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function loop() {
      draw(true);
      rafId = requestAnimationFrame(loop);
    }
    function start() { if (!running && visible && !document.hidden) { running = true; rafId = requestAnimationFrame(loop); } }
    function stop() { running = false; cancelAnimationFrame(rafId); }

    build();
    if (reduceMotion) { draw(false); }
    else {
      // Pausa quando o hero sai da tela ou a aba fica oculta (economia de CPU/bateria)
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (!visible) stop();
        else if (document.readyState === 'complete') start();
      }).observe(canvas);
      document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });

      var hero = canvas.parentElement;
      hero.addEventListener('pointermove', function (e) {
        var r = canvas.getBoundingClientRect();
        pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; pointer.active = true;
      }, { passive: true });
      hero.addEventListener('pointerleave', function () { pointer.active = false; });
      hero.addEventListener('touchend', function () { pointer.active = false; }, { passive: true });
      // Desenha um quadro estático já e só anima após o carregamento da página
      draw(false);
      if (document.readyState === 'complete') start();
      else window.addEventListener('load', start);
    }

    var lastW = window.innerWidth;
    var resizeTimer;
    window.addEventListener('resize', function () {
      // Ignora o resize vertical da barra de endereço no mobile
      if (Math.abs(window.innerWidth - lastW) < 2 && w) return;
      lastW = window.innerWidth;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { build(); if (reduceMotion) draw(false); }, 200);
    });
  }
})();
