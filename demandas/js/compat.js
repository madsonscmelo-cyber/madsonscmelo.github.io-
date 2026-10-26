// Compatibilidade com celulares de navegador mais antigo (script clássico: roda antes do app e mesmo se o app falhar).
// 1) Complementa recursos que o app usa e que só existem em navegadores recentes.
// 2) Se em 6 s o app não montou nem a tela de login, mostra o que fazer, em vez de deixar a tela parada sem resposta.
(function () {
  'use strict';
  if (!Array.prototype.at) {
    Object.defineProperty(Array.prototype, 'at', { configurable: true, writable: true, value: function (i) {
      var n = Math.trunc(i) || 0; if (n < 0) n += this.length; return n < 0 || n >= this.length ? undefined : this[n];
    } });
  }
  if (!String.prototype.at) {
    Object.defineProperty(String.prototype, 'at', { configurable: true, writable: true, value: function (i) {
      var n = Math.trunc(i) || 0; if (n < 0) n += this.length; return n < 0 || n >= this.length ? undefined : this.charAt(n);
    } });
  }
  if (typeof window.structuredClone !== 'function') {
    // O app só clona dados simples (JSON); Blob/fotos não passam por aqui.
    window.structuredClone = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
  }

  function aviso() {
    var login = document.getElementById('login'), nav = document.getElementById('nav');
    var subiu = (login && !login.hidden) || (nav && nav.childElementCount > 0) || document.querySelector('.erro-fatal');
    if (subiu) return;
    var semCripto = !(window.crypto && window.crypto.subtle);
    var caixa = document.createElement('div');
    caixa.className = 'erro-fatal';
    caixa.setAttribute('role', 'alert');
    var t = document.createElement('strong');
    t.textContent = 'A Central de Demandas não conseguiu abrir neste navegador.';
    var p = document.createElement('p');
    p.textContent = semCripto
      ? 'Abra pelo endereço com https:// (o login precisa de conexão segura).'
      : 'Atualize o Chrome (Android) ou o iOS (iPhone) e abra de novo. Se estiver dentro do WhatsApp ou de outro app, toque em "Abrir no navegador".';
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn'; b.textContent = 'Tentar de novo';
    b.addEventListener('click', function () { location.reload(); });
    caixa.appendChild(t); caixa.appendChild(p); caixa.appendChild(b);
    document.body.appendChild(caixa);
  }
  window.addEventListener('load', function () { setTimeout(aviso, 6000); });
})();
