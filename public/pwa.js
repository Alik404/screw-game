// The site as an app: register the service worker, and on the home page offer to install it
// (the browser's own prompt where there is one; on an iPhone, how to add it from the share menu).
(function () {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }
  const box = document.getElementById('pt-install');
  if (!box) return;
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (standalone) return;
  let dismissed = false;
  try { dismissed = localStorage.getItem('pwa.dismissed') === '1'; } catch (e) { /* no storage */ }
  if (dismissed) return;
  const btn = box.querySelector('[data-install]');
  const close = box.querySelector('[data-close]');
  const note = box.querySelector('[data-note]');
  close.addEventListener('click', function () {
    box.hidden = true;
    try { localStorage.setItem('pwa.dismissed', '1'); } catch (e) { /* no storage */ }
  });
  let prompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    prompt = e;
    box.hidden = false;
  });
  btn.addEventListener('click', function () {
    if (!prompt) return;
    prompt.prompt();
    prompt.userChoice.then(function () { box.hidden = true; prompt = null; });
  });
  window.addEventListener('appinstalled', function () { box.hidden = true; });
  // iPhone and iPad: no prompt; show how
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) {
    btn.hidden = true;
    note.textContent = 'اضغط زر المشاركة ⬆️ ثم "إضافة إلى الشاشة الرئيسية" حتى تصير الألعاب تطبيق على جهازك.';
    box.hidden = false;
  }
})();
