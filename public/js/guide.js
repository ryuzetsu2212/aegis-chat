function setLang(lang) {
  document.getElementById('lang-id').style.display = lang === 'id' ? '' : 'none';
  document.getElementById('lang-en').style.display = lang === 'en' ? '' : 'none';
  document.getElementById('btnID').className = lang === 'id' ? 'on' : '';
  document.getElementById('btnEN').className = lang === 'en' ? 'on' : '';
  localStorage.setItem('aegis_guide_lang', lang);
}

(function() {
  var saved = localStorage.getItem('aegis_guide_lang');
  if (!saved) {
    saved = (navigator.language || 'id').toLowerCase().startsWith('id') ? 'id' : 'en';
  }
  setLang(saved);
})();

// Dipindah dari atribut onclick agar lolos CSP script-src 'self'
document.getElementById('btnID').addEventListener('click', function() { setLang('id'); });
document.getElementById('btnEN').addEventListener('click', function() { setLang('en'); });
document.getElementById('toTop').addEventListener('click', function() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
window.addEventListener('scroll', function() {
  document.getElementById('toTop').style.display = window.scrollY > 300 ? 'block' : 'none';
});
if (window.self !== window.top) document.body.classList.add('in-iframe');