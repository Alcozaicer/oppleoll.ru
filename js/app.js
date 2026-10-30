(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const money = new Intl.NumberFormat('ru-RU');
  const fmt = v => money.format(v) + ' ₽';

  const SERIES_ORDER = ['Edge', 'Vessel', 'Aura', 'Bubble', 'CRYX', 'Flow', 'Astra', 'Lamino', 'FOLIO'];
  const state = { series: new Set(), type: '', q: '', sort: 'series', max: Infinity };
  let products = [], photos = {}, cfg = null;
  // время жизни страницы, а не первого удара по клавиатуре: автозаполнение браузера
  // подставляет имя и телефон молча, и заявка улетала бы с filledMs ≈ 0
  const pageStart = Date.now();
  let priceTop = 0, priceCap = 0;
  const cardEls = new Map();
  let qt = 0;                                        // недотыганный поиск: сбрасываем при «Сбросить фильтры»
  const priceLabel = v => fmt(v >= priceCap ? priceTop : v);

  /* ---------- config ---------- */
  const rev = s => [...String(s)].reverse().join('');
  const fmtPhone = d => `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;

  function applyConfig() {
    const c = cfg.contacts;
    $$('[data-c="phoneMasked"]').forEach(s => s.textContent = c.phoneMasked);
    $$('[data-c="emailMasked"]').forEach(s => s.textContent = c.emailMasked);
    $$('[data-c-hours]').forEach(s => s.textContent = c.hours);
    $('#legal').textContent = [cfg.legal.entity, `ИНН ${cfg.legal.inn}`, cfg.legal.ogrn && `ОГРН ${cfg.legal.ogrn}`,
      cfg.legal.address].filter(Boolean).join(' · ');
    $('#delivery').textContent = `Поставка: ${cfg.delivery.regions}. ${cfg.delivery.terms}`;
  }

  /* Номер и почта лежат в конфиге перевёрнутыми и становятся ссылкой только после клика.
     Открытым текстом их по-прежнему видно тому, кто исполняет JS, — но сборщики телефонов
     регуляркой по HTML и JSON теперь берут только маску. */
  function bindReveal() {
    $$('[data-reveal]').forEach(a => {
      a.title = 'Нажмите, чтобы показать';
      a.addEventListener('click', e => {
        if (a.dataset.open) return;
        e.preventDefault();
        const c = cfg.contacts, isPhone = a.dataset.reveal === 'phone';
        const value = isPhone ? rev(c.phoneCode) : rev(c.emailCode);
        a.href = (isPhone ? 'tel:' : 'mailto:') + value;
        a.textContent = isPhone ? fmtPhone(value.replace(/\D/g, '')) : value;
        a.dataset.open = '1';
        a.title = isPhone ? 'Позвонить' : 'Написать письмо';
        a.classList.add('is-open');
        a.setAttribute('aria-label', isPhone ? 'Позвонить ' + value : 'Написать на ' + value);
      });
    });
  }

  /* ---------- ссылки на витрину: ?s=Bubble,Edge и ?p=<артикул> ---------- */
  function applyUrl() {
    const q = new URLSearchParams(location.search);
    const s = q.get('s');
    if (s) s.split(',').map(x => x.trim()).filter(x => SERIES_ORDER.includes(x)).forEach(x => state.series.add(x));
    return q.get('p');
  }

  function syncUrl() {
    const q = new URLSearchParams(location.search);
    state.series.size ? q.set('s', [...state.series].join(',')) : q.delete('s');
    const open = $('#modal').hidden ? '' : $('#modal').dataset.id || '';
    open ? q.set('p', open) : q.delete('p');
    const s = q.toString();
    history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash);
  }

  /* ---------- прокрутка ---------- */
  /* Меньше движения — значит и прокрутка мгновенная: CSS-правило `transition:none`
     глушит анимации, но `behavior:'smooth'` из JS ему не подчиняется. */
  const calm = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
  const scrollToEl = (el, after) => {
    el.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
    if (after) setTimeout(after, calm() ? 0 : 600);
  };

  /* ---------- фокус: листовые состояния перехватывают Tab ---------- */  const focusables = root => $$('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])', root)
    .filter(el => !el.disabled && el.type !== 'hidden' && el.offsetParent !== null);

  function trapTab(e, root) {
    const list = focusables(root);
    if (!list.length) return;
    const first = list[0], last = list[list.length - 1], at = document.activeElement;
    if (!root.contains(at)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && (at === first || at === root)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  }

  /* ---------- панель фильтров: на узком экране это нижний лист ---------- */
  const SHEET = '(max-width:860px)';
  const sheetIsOpen = () => $('#toolbar').classList.contains('is-open');
  let sheetReturn = null;

  function openSheet() {
    if (!matchMedia(SHEET).matches || sheetIsOpen()) return;
    sheetReturn = document.activeElement;
    $('#toolbar').classList.add('is-open');
    $('#sheetBack').hidden = false;
    $('#openFilters').setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    $('#toolbar').focus({ preventScroll: true });
  }

  function closeSheet() {
    if (!sheetIsOpen()) return;
    $('#toolbar').classList.remove('is-open');
    $('#sheetBack').hidden = true;
    $('#openFilters').setAttribute('aria-expanded', 'false');
    if ($('#modal').hidden) document.body.style.overflow = '';
    // на iOS тап по кнопке фокус не переносит, поэтому возвращаемся на триггер, а не в никуда
    const back = sheetReturn && sheetReturn !== document.body && sheetReturn.isConnected ? sheetReturn : $('#openFilters');
    back.focus({ preventScroll: true });
    sheetReturn = null;
  }

  /* ---------- filters UI ---------- */
  function buildFilters() {
    const counts = {};
    products.forEach(p => counts[p.series] = (counts[p.series] || 0) + 1);
    const wrap = $('#seriesChips');
    wrap.innerHTML = SERIES_ORDER.filter(s => counts[s]).map(s =>
      `<button type="button" class="chip" data-series="${s}" aria-pressed="${state.series.has(s)}">${s}<span class="n">${counts[s]}</span></button>`
    ).join('');
    wrap.addEventListener('click', e => {
      const b = e.target.closest('[data-series]'); if (!b) return;
      const s = b.dataset.series;
      state.series.has(s) ? state.series.delete(s) : state.series.add(s);
      b.setAttribute('aria-pressed', state.series.has(s));
      syncUrl();
      render();
    });

    const types = [...new Set(products.map(p => p.type))].sort((a, b) => a.localeCompare(b, 'ru'));
    $('#type').insertAdjacentHTML('beforeend', types.map(t => `<option value="${t}">${t}</option>`).join(''));

    const maxP = Math.max(...products.map(p => p.price));
    priceTop = maxP;
    priceCap = Math.ceil(maxP / 10000) * 10000;      // шаг ползунка не должен отрезать верхнюю цену
    const r = $('#maxPrice');
    r.max = priceCap; r.value = priceCap; state.max = priceCap;
    $('#rangeLabel').textContent = priceLabel(priceCap);
    r.addEventListener('input', () => {
      state.max = +r.value;
      $('#rangeLabel').textContent = priceLabel(state.max);
      render();
    });
    $('#type').addEventListener('change', e => { state.type = e.target.value; render(); });
    $('#sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
    // поиск на телефоне печатается по одному символу; перерисовывать сетку на каждый — лишняя работа
    $('#q').addEventListener('input', e => {
      clearTimeout(qt);
      const v = e.target.value.trim().toLowerCase();
      qt = setTimeout(() => { state.q = v; render(); }, 120);
    });
    $('#reset').addEventListener('click', reset);
    $('#reset2').addEventListener('click', reset);
    $('#openFilters').addEventListener('click', () => sheetIsOpen() ? closeSheet() : openSheet());
    $('#closeFilters').addEventListener('click', closeSheet);
    $('#sheetBack').addEventListener('click', closeSheet);
    $('#done').addEventListener('click', closeSheet);
  }

  function reset() {
    clearTimeout(qt);
    const r = $('#maxPrice');
    r.value = priceCap;
    state.max = priceCap;
    state.series.clear(); state.type = ''; state.q = ''; state.sort = 'series';
    $$('.chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
    $('#type').value = ''; $('#q').value = ''; $('#sort').value = 'series';
    $('#rangeLabel').textContent = priceLabel(state.max);
    syncUrl();
    render();
  }

  /* ---------- grid ---------- */
  function visible() {
    let list = products.filter(p =>
      (!state.series.size || state.series.has(p.series)) &&
      (!state.type || p.type === state.type) &&
      p.price <= state.max &&
      (!state.q || (p.sku + ' ' + p.series + ' ' + p.type).toLowerCase().includes(state.q))
    );
    if (state.sort === 'price-asc') list.sort((a, b) => a.price - b.price);
    else if (state.sort === 'price-desc') list.sort((a, b) => b.price - a.price);
    else list.sort((a, b) => SERIES_ORDER.indexOf(a.series) - SERIES_ORDER.indexOf(b.series) || a.price - b.price);
    return list;
  }

  /* Карточки строим один раз: пересобирать innerHTML на каждый символ означает
     выбросить и заново декодировать все 64 картинки, и сетка подмигивает. */
  function buildCards() {
    const frag = document.createDocumentFragment();
    for (const p of products) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'card';
      el.dataset.id = p.id;
      el.setAttribute('aria-label', `${p.series} ${p.sku}${p.color ? ', ' + p.color : ''}, ${fmt(p.price)}`);
      const tile = p.image_kind === 'photo' ? ' photo-tile' : p.image_kind === 'light' ? ' light-tile' : '';
      el.innerHTML = `<span class="card-img${tile}">
          <img src="img/products/${p.id}.webp" alt="Светильник ${p.series} ${p.sku}${p.color ? ', ' + p.color : ''}" loading="lazy">
        </span>
        <span class="card-body">
          <span class="card-series">${p.series}</span>
          <span class="card-model">${p.sku}</span>
          <span class="card-type">${[p.type, p.color].filter(Boolean).join(' · ')}</span>
          <span class="card-price">${fmt(p.price)}<small>за шт.</small></span>
        </span>
        <span class="card-cta">Смотреть</span>
      </button>`;
      frag.appendChild(el);
      cardEls.set(p.id, el);
    }
    $('#grid').appendChild(frag);
  }

  const activeCount = () => state.series.size + (state.type ? 1 : 0) +
    (state.q ? 1 : 0) + (state.max < priceCap ? 1 : 0);

  function render() {
    const list = visible();
    const shown = new Set(list.map(p => p.id));
    cardEls.forEach((el, id) => { el.hidden = !shown.has(id); });
    const frag = document.createDocumentFragment();
    for (const p of list) frag.appendChild(cardEls.get(p.id));
    $('#grid').appendChild(frag);

    const n = activeCount();
    $('#count').textContent = list.length ? `${list.length} из ${products.length} моделей` : 'Ни одной модели под эти фильтры нет';
    $('#barCount').textContent = `${list.length} из ${products.length}`;
    $('#fbCount').hidden = !n;
    $('#fbCount').textContent = n;
    // «Показать 0» звучало как обещание, которого лист не выполнит
    $('#done').textContent = list.length ? `Показать ${list.length}` : 'Готово';
    $('#empty').hidden = list.length > 0;
  }

  /* ---------- modal ---------- */
  /* Кадр задаёт пропорцию сцены: товарный квадрат показывается целиком, интерьер
     заполняет рамку. Диапазон 0.8–1.9 — по реальной выборке: хвосты 0.53 и 2.77
     иначе либо вырезали бы треть сюжета, либо растягивали карточку на весь экран. */
  const stageAr = x => Math.min(1.9, Math.max(.8, x.w && x.h ? x.w / x.h : 4 / 3));

  function galleryFor(p) {
    return [{ src: 'img/products/' + p.id + '.webp', ar: 1 },
            ...(photos[p.series] || []).slice(0, 4)
              .map(x => ({ src: 'img/' + x.file, ar: stageAr(x) }))];
  }

  let modalReturn = null;

  function openModal(p) {
    const shots = galleryFor(p);
    closeSheet();
    $('#m-series').textContent = `Серия ${p.series}`;
    $('#m-model').textContent = p.sku;
    $('#m-type').textContent = [p.type, p.color].filter(Boolean).join(' · ');
    $('#m-price').textContent = fmt(p.price);
    $('#m-sku').textContent = 'Артикул ' + p.id;
    $('#m-main').alt = `Светильник ${p.series} ${p.sku}`;
    $('#m-thumbs').innerHTML = shots.map((s, i) =>
      `<button type="button" data-i="${i}" aria-current="${i === 0}"${i ? ' data-fill' : ''} aria-label="Фото ${i + 1} из ${shots.length}"><img src="${s.src}" alt="" loading="lazy"></button>`).join('');
    const main = $('#m-main'), stage = $('.modal-stage', $('#modal'));
    const show = i => {
      main.src = shots[i].src;
      stage.style.setProperty('--ar', shots[i].ar);
      stage.classList.toggle('is-fill', i > 0);
    };
    modalReturn = document.activeElement;
    $('#modal').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#modal').dataset.id = p.id;
    syncUrl();
    $('.modal-card', $('#modal')).focus({ preventScroll: true });
    show(0);
    $('#m-thumbs').onclick = e => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      $$('button', $('#m-thumbs')).forEach(x => x.setAttribute('aria-current', 'false'));
      b.setAttribute('aria-current', 'true');
      show(+b.dataset.i);
    };
  }

  function closeModal() {
    $('#modal').hidden = true;
    if (!sheetIsOpen()) document.body.style.overflow = '';
    syncUrl();
    const back = modalReturn && modalReturn !== document.body && modalReturn.isConnected
      ? modalReturn : $('.card:not([hidden])');
    if (back) back.focus({ preventScroll: true });
    modalReturn = null;
  }

  /* ---------- lead form ---------- */
  function chooseProduct(p) {
    $('#f-product').value = `${p.series} ${p.sku} · ${fmt(p.price)}`;
    $('#chosen').hidden = false;
    $('#chosen').innerHTML = `<span>Заявка на: <b>${p.series} ${p.sku}</b> — ${fmt(p.price)}</span>
      <button type="button" id="dropChosen" aria-label="Убрать товар">×</button>`;
    $('#dropChosen').onclick = () => { $('#f-product').value = ''; $('#chosen').hidden = true; };
  }

  const clampQty = v => Math.max(1, Math.min(9999, parseInt(v, 10) || 1));

  function bindQty() {
    const inp = $('#f-qty');
    $$('.qty-btn').forEach(b => b.addEventListener('click', () => {
      inp.value = clampQty((parseInt(inp.value, 10) || 0) + +b.dataset.step);
    }));
    inp.addEventListener('blur', () => { inp.value = clampQty(inp.value); });
  }

  function status(msg, cls) {
    const el = $('#formStatus'); el.textContent = msg; el.className = 'form-status ' + (cls || '');
  }

  /* Ошибку показываем не только строкой под кнопкой, но и на самом поле:
     на телефоне статус иногда остаётся за пределами экрана. */
  function bad(el, msg) {
    status(msg, 'err');
    $$('.is-bad', $('#leadForm')).forEach(x => x.classList.remove('is-bad'));
    if (el) { el.classList.add('is-bad'); el.focus({ preventScroll: false }); }
  }

  async function submit(e) {
    e.preventDefault();
    const f = e.target;
    const d = Object.fromEntries(new FormData(f).entries());
    // у формы name/length/action — свои свойства, поля берём через elements
    const el = k => f.elements[k];
    if (!d.name?.trim()) return bad(el('name'), 'Заполните, как к вам обращаться.');
    if (!/[\d\s()+-]{10,}/.test(d.phone || '')) return bad(el('phone'), 'Проверьте телефон — нужно не меньше 10 цифр.');
    if (d.email && !/^[^@\s]+@[^@\s]+\.[a-zа-я]{2,}$/i.test(d.email)) return bad(el('email'), 'Проверьте почту.');
    if (!d.consent) return bad(el('consent'), 'Без согласия на обработку данных заявку отправить нельзя.');
    $$('.is-bad', f).forEach(x => x.classList.remove('is-bad'));

    const btn = $('#submitBtn');
    btn.disabled = true; status('Отправляем…');
    // на предпросмотре (tools/dev_server.py) шлём на локальную заглушку: боевой endpoint
    // в конфиге абсолютный, и локальные проверки улетали бы настоящими заявками на почту
    const endpoint = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '/submit.php' : cfg.lead.endpoint;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
        body: JSON.stringify({
          name: d.name.trim(),
          phone: d.phone.trim(),
          email: (d.email || '').trim(),
          qty: String(clampQty(d.qty)),
          product: (d.product || '').trim(),
          message: (d.message || '').trim(),
          website: d.website || '',
          consent: true,
          filledMs: Date.now() - pageStart,
          page: location.href,
          ts: new Date().toISOString()
        })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) throw new Error(out.error || 'Сервер ответил ошибкой');
      f.reset(); $('#chosen').hidden = true; $('#f-product').value = '';
      status('Заявка отправлена. Свяжемся в рабочее время.', 'ok');
    } catch (err) {
      status('Не удалось отправить: ' + err.message + '. Попробуйте ещё раз.', 'err');
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- знак ---------- */
  /* Клик по логотипу прогоняет дугу по кольцу. При reduce-motion ничего не вешаем:
     анимацию глушит общее правило, `animationend` не приходит, и класс остался бы
     висеть с видимой дугой поверх знака. */
  function bindMark() {
    if (matchMedia('(prefers-reduced-motion:reduce)').matches) return;
    const glyph = $('.logo-glyph');
    if (!glyph) return;
    const link = glyph.closest('a');
    if (!link) return;
    link.addEventListener('click', () => {
      glyph.classList.remove('is-spin');
      glyph.getBoundingClientRect();
      glyph.classList.add('is-spin');
    });
    glyph.addEventListener('animationend', () => glyph.classList.remove('is-spin'));
  }

  /* ---------- boot ---------- */
  /* Русская форма слова: 1 «модель», 3 «модели», 5 «моделей». */
  const pl = (n, f) => f[n % 10 === 1 && n % 100 !== 11 ? 0
    : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 1 : 2];

  async function boot() {
    const [c, p, s] = await Promise.all([
      fetch('data/site.config.json').then(r => r.json()).catch(() => null),
      fetch('data/products.json').then(r => r.json()),
      fetch('data/series_photos.json').then(r => r.json()).catch(() => ({}))
    ]);
    cfg = c; products = p; photos = s;
    const deepId = applyUrl();
    bindQty(); bindMark(); buildFilters(); buildCards(); render();
    /* Выкладка каталога важнее конфига: при частичной загрузке data/ на GitHub Pages
       витрина должна остаться читаемой, а не сложиться вместе с контактами. */
    if (cfg) { applyConfig(); bindReveal(); }
    else {
      $$('[data-reveal]').forEach(a => { a.hidden = true; });
      $('#submitBtn').disabled = true;
      status('Не удалось загрузить контакты и адрес приёмщика. Обновите страницу.', 'err');
    }

    // цифры «о бренде» и строка под h1 считаем из каталога, а не держим в разметке руками
    const prices = products.map(x => x.price);
    const nSer = new Set(products.map(x => x.series)).size, nMod = products.length;
    $('#factSeries').textContent = nSer;
    $('#factModels').textContent = nMod;
    $('#factRange').textContent = `${fmt(Math.min(...prices))} — ${fmt(Math.max(...prices))}`;
    $('#heroLead').textContent = `${nMod} ${pl(nMod, ['модель', 'модели', 'моделей'])} · ` +
      `${nSer} ${pl(nSer, ['серия', 'серии', 'серий'])}. Цены на сайте, поставка под заказ.`;

    if (deepId || state.series.size) {
      $('#catalog').scrollIntoView({ behavior: 'instant', block: 'start' });
      const target = deepId && products.find(x => x.id === deepId);
      if (target) openModal(target);
    }

    $('#grid').addEventListener('click', e => {
      const card = e.target.closest('.card'); if (!card) return;
      openModal(products.find(x => x.id === card.dataset.id));
    });
    $('#modal').addEventListener('click', e => {
      if (e.target.hasAttribute('data-close')) closeModal();
    });
    $('#modal').addEventListener('keydown', e => {
      if (e.key === 'Tab' && !$('#modal').hidden) trapTab(e, $('.modal-card', $('#modal')));
    });
    $('#toolbar').addEventListener('keydown', e => {
      if (e.key === 'Tab' && sheetIsOpen()) trapTab(e, $('#toolbar'));
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (!$('#modal').hidden) closeModal();
      else closeSheet();
    });
    matchMedia(SHEET).addEventListener('change', e => { if (!e.matches) closeSheet(); });
    $('#m-lead').addEventListener('click', () => {
      const p2 = products.find(x => x.id === $('#modal').dataset.id);
      if (p2) chooseProduct(p2);
      closeModal();
      scrollToEl($('#contact'), () => $('#leadForm [name=name]').focus());
    });
    $('#leadForm').addEventListener('submit', submit);
    addEventListener('scroll', () => $('.head').classList.toggle('solid', scrollY > 40), { passive: true });
  }

  boot().catch(err => {
    $('#grid').innerHTML = `<p class="empty">Не удалось загрузить каталог: ${err.message}</p>`;
  });
})();
