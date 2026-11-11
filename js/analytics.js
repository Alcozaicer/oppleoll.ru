/* Аналитика витрины: Яндекс.Метрика включается только после согласия посетителя
   и только когда в data/site.config.json задан номер счётчика (analytics.metrika).
   Пока номера нет, файл инертен: ни плашки, ни запросов — вид сайта не меняется.
   Подключён на главной и на страницах серий; корень сайта выводится из адреса
   самого скрипта, поэтому один файл работает с любой вложенности. */
(() => {
  const KEY = 'oll_cookie_ok';
  const root = document.currentScript.src.replace(/js\/analytics\.js.*$/, '');

  const load = id => {
    ((m, e, t, r, i, k, a) => {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
      m[i].l = 1 * new Date();
      k = e.createElement(t); a = e.getElementsByTagName(t)[0];
      k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
    window.ym(id, 'init', {
      clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: true
    });
  };

  const bar = id => {
    const el = document.createElement('div');
    el.className = 'cookiebar';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Согласие на аналитику');
    el.innerHTML =
      '<p>Мы используем cookie для аналитики посещений — это помогает делать витрину удобнее. ' +
      '<a href="' + root + 'privacy.html">Подробнее</a></p>' +
      '<button type="button" class="cookiebar-ok">Ок</button>';
    el.querySelector('.cookiebar-ok').addEventListener('click', () => {
      try { localStorage.setItem(KEY, '1'); } catch (e) { /* приватный режим */ }
      el.remove();
      load(id);
    });
    document.body.appendChild(el);
  };

  fetch(root + 'data/site.config.json')
    .then(r => r.json())
    .then(cfg => {
      const id = cfg && cfg.analytics && cfg.analytics.metrika;
      if (!/^\d+$/.test(String(id || ''))) return;
      let ok = null;
      try { ok = localStorage.getItem(KEY); } catch (e) { /* приватный режим: спросим снова */ }
      if (ok) load(id); else bar(id);
    })
    .catch(() => { /* нет конфига — нет аналитики */ });
})();