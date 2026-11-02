(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const money = new Intl.NumberFormat('ru-RU');
  const fmt = v => money.format(v) + ' ₽';

  const SERIES_ORDER = ['Edge', 'Vessel', 'Aura', 'Bubble', 'Flow', 'Astra', 'FOLIO'];
  const state = { series: new Set(), type: '', q: '', sort: 'series', max: Infinity };
  let products = [], photos = {}, cfg = null, meta = { hero: {}, src: {} }, tIdx = new Map();
  // время жизни страницы, а не первого удара по клавиатуре: автозаполнение браузера
  // подставляет имя и телефон молча, и заявка улетала бы с filledMs ≈ 0
  const pageStart = Date.now();
  let priceTop = 0, priceCap = 0;
  const cardEls = new Map();                         // серия -> карточка-серия
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

  /* ---------- сетка: карточка = серия ---------- */
  /* Шестьдесят четыре карточки с вырезами из прайса читались как прайс-лист, и мыло
     было видно именно на большом кадре: исходник 34×101 на плитке 260 px — это ×3
     растяжения. В карточке серии большой кадр берётся из каталогов и пресс-съёмки
     (1200–1500 px), а модели уходят в строки по 44 px — там то же разрешение
     выглядит резким, потому что растягивать нечего. */
  /* Ритм сетки модульный: у всех героев одна пропорция, в карточке всегда три строки.
     До 02.11.2026 герой нёс пропорцию своего кадра (1.0…1.571), а строк было до пяти —
     карточки в одном ряду различались на 140+ px, и нижние кромки ряда не сходились. */
  const LIST_MAX = 3, HERO_AR = 1.333;

  /* Миниатюры строк лежат одним спрайтом 8×8 по 96 px: 35 строк первого экрана —
     это один запрос и 37 КБ вместо 35 запросов и 400 КБ. Ячейка берётся по номеру
     модели в products.json, поэтому раскладка не хранится отдельно. */
  const TCELL = 44, TGRID = 8;
  const thumbStyle = id => {
    const i = tIdx.get(id);
    if (i === undefined) return '';
    return `--tx:${-(i % TGRID) * TCELL}px;--ty:${-(i / TGRID | 0) * TCELL}px`;
  };

  function matched() {
    return products.filter(p =>
      (!state.type || p.type === state.type) &&
      p.price <= state.max &&
      (!state.q || (p.sku + ' ' + p.series + ' ' + p.type + ' ' + (p.color || '')).toLowerCase().includes(state.q)));
  }

  /* Группы в том порядке, который задан сортировкой: карточки упорядочиваются по
     своей лучшей цене, а не по первой попавшейся модели. */
  function groups() {
    const list = matched();
    const map = new Map();
    for (const p of list) (map.get(p.series) || map.set(p.series, []).get(p.series)).push(p);
    const rows = [...map.entries()].filter(([s]) => !state.series.size || state.series.has(s));
    const byPrice = state.sort === 'price-asc' ? (a, b) => a[1][0].price - b[1][0].price
      : state.sort === 'price-desc' ? (a, b) => b[1][0].price - a[1][0].price
      : (a, b) => SERIES_ORDER.indexOf(a[0]) - SERIES_ORDER.indexOf(b[0]);
    rows.sort(byPrice);
    const inside = state.sort === 'price-desc' ? (a, b) => b.price - a.price : (a, b) => a.price - b.price;
    for (const [, m] of rows) m.sort(inside);
    return rows;
  }

  const rowHtml = p => `<li><button type="button" class="mrow" data-id="${p.id}"
      aria-label="${p.series} ${p.sku}, ${fmt(p.price)} за единицу">
      <span class="mrow-thumb" style="${thumbStyle(p.id)}"></span>
      <span class="mrow-main"><span class="mrow-sku">${p.sku}</span>
        <span class="mrow-type">${[p.type, p.color].filter(Boolean).join(' · ')}</span></span>
      <span class="mrow-price">${fmt(p.price)}</span></button></li>`;

  /* Карточек девять, и строим мы их один раз: пересобирать сетку на каждый символ
     поиска означало бы выбросить и заново декодировать девять больших кадров. */
  function buildCards() {
    const frag = document.createDocumentFragment();
    for (const s of SERIES_ORDER) {
      const hero = meta.hero[s];
      const el = document.createElement('article');
      el.className = 'scard';
      el.dataset.series = s;
      el.hidden = true;
      el.innerHTML = `<div class="scard-hero${hero && hero.product ? ' is-product' : ''}"
          style="--hero-ar:${hero && hero.product ? hero.ar : HERO_AR}">
          ${hero ? `<img src="${hero.file}" alt="Серия ${s}" width="${hero.w}" height="${hero.h}"
            loading="lazy" fetchpriority="low">` : ''}
        </div>
        <div class="scard-body">
          <div class="scard-top"><h3>${s}</h3><span class="scard-n"></span></div>
          <p class="scard-range"></p>
          <ul class="scard-list"></ul>
          <p class="scard-more"></p>
          <button type="button" class="btn btn-ghost scard-open">Смотреть серию</button>
        </div>`;
      cardEls.set(s, el);
      frag.appendChild(el);
    }
    $('#grid').appendChild(frag);
  }

  const activeCount = () => state.series.size + (state.type ? 1 : 0) +
    (state.q ? 1 : 0) + (state.max < priceCap ? 1 : 0);

  function render() {
    const rows = groups();
    const live = new Set(rows.map(([s]) => s));
    cardEls.forEach((el, s) => { el.hidden = !live.has(s); });
    let nModels = 0;
    for (const [s, models] of rows) {
      const el = cardEls.get(s);
      nModels += models.length;
      const sig = models.map(m => m.id).join();
      if (el.dataset.sig !== sig) {
        el.dataset.sig = sig;
        const prices = models.map(m => m.price);
        const low = Math.min(...prices), high = Math.max(...prices);
        $('.scard-n', el).textContent = `${models.length} ${pl(models.length, ['модель', 'модели', 'моделей'])}`;
        $('.scard-range', el).innerHTML = (low === high ? fmt(low) : 'от ' + fmt(low)) +
          '<small>за единицу</small>';
        $('.scard-list', el).innerHTML = models.slice(0, LIST_MAX).map(rowHtml).join('');
        const rest = models.length - LIST_MAX;
        $('.scard-more', el).innerHTML = rest > 0
          ? `<button type="button" class="link-more" data-open="${s}">ещё ${rest}` +
            ` ${pl(rest, ['модель', 'модели', 'моделей'])}</button>` : '';
      }
      $('#grid').appendChild(el);
    }
    // скрытые карточки дописываем в конец: порядок в DOM = порядок в сетке
    cardEls.forEach((el, s) => { if (!live.has(s)) $('#grid').appendChild(el); });

    const n = activeCount(), nCards = rows.length;
    $('#count').textContent = nModels
      ? // в обороте «N из M» после M всегда родительный падеж множественного числа
        `${nModels} из ${products.length} моделей` +
        ` · ${nCards} ${pl(nCards, ['серия', 'серии', 'серий'])}`
      : 'Ни одной модели под эти фильтры нет';
    $('#barCount').textContent = `${nModels} из ${products.length}`;
    $('#fbCount').hidden = !n;
    $('#fbCount').textContent = n;
    // «Показать 0» звучало как обещание, которого лист не выполнит
    $('#done').textContent = nModels ? `Показать ${nModels}` : 'Готово';
    $('#empty').hidden = nModels > 0;
  }

  /* ---------- постеры серий ---------- */
  /* Исходник постера — 3:4 с типографикой по всему полю, поэтому рамка повторяет
     пропорцию и ничего не режет. Постер витринной серии открывает её карточку;
     Ink и Wellsky в прайсе не числятся — это только образ, клика на них нет. */
  function renderPosters(list) {
    const grid = $('#posterGrid'), sec = $('#posters');
    if (!list || !list.length) { if (sec) sec.hidden = true; return; }
    grid.innerHTML = list.map(p => {
      const img = `<img src="${p.file}" alt="Постер серии ${p.series}" ` +
        `width="${p.w}" height="${p.h}" loading="lazy">`;
      return SERIES_ORDER.includes(p.series)
        ? `<button type="button" class="ppost" data-series="${p.series}"` +
          ` aria-label="Открыть серию ${p.series}">${img}</button>`
        : `<div class="ppost is-plain">${img}</div>`;
    }).join('');
  }

  /* ---------- модалка: серия целиком ---------- */
  /* Кадр задаёт пропорцию сцены: товарный квадрат показывается целиком, интерьер
     заполняет рамку. Диапазон 0.8–1.9 — по реальной выборке: хвосты 0.53 и 2.77
     иначе либо вырезали бы треть сюжета, либо растягивали карточку на весь экран. */
  const stageAr = x => Math.min(1.9, Math.max(.8, x.w && x.h ? x.w / x.h : 4 / 3));
  /* Потолок растяжения выреза: 90 px исходника в строке списка (44 px) выглядят
     резкими, а в сцене на 460 px превращаются в кашу. Ограничиваем показ, а не холст. */
  const capFor = m => !m || m >= 250 ? 1 : m >= 120 ? .75 : .55;

  function shotsFor(s, model) {
    const hero = meta.hero[s];
    const out = [];
    if (model) out.push({ src: 'img/products/' + model.id + '.webp', ar: 1,
      cap: capFor(meta.src[model.id]), alt: `Светильник ${s} ${model.sku}` });
    else if (hero) out.push(hero.product
      ? { src: hero.file, ar: 1, cap: capFor(meta.src[hero.id]), alt: `Серия ${s}` }
      : { src: hero.file, ar: hero.ar, fill: true, alt: `Серия ${s}` });
    for (const x of photos[s] || []) {
      const src = 'img/' + x.file;
      if (out.some(o => o.src === src)) continue;
      out.push({ src, ar: stageAr(x), fill: true, alt: `Серия ${s}, кадр ${out.length + 1}` });
      if (out.length >= 5) break;
    }
    return out;
  }

  let modalReturn = null;

  function openSeries(s, model) {
    const hit = matched().filter(p => p.series === s);
    const rows = (hit.length ? hit : products.filter(p => p.series === s)).slice();
    rows.sort(state.sort === 'price-desc' ? (a, b) => b.price - a.price : (a, b) => a.price - b.price);
    const start = rows.find(p => p.id === model?.id) || null;
    closeSheet();

    const modal = $('#modal'), stage = $('.modal-stage', modal), main = $('#m-main');
    const prices = rows.map(p => p.price), low = Math.min(...prices), high = Math.max(...prices);
    let shots = [], current = null;

    const show = i => {
      const sh = shots[i] || shots[0];
      if (!sh) return;
      main.src = sh.src;
      main.alt = sh.alt || `Серия ${s}`;
      stage.style.setProperty('--ar', sh.ar);
      stage.style.setProperty('--cap', sh.cap || 1);
      stage.classList.toggle('is-fill', !!sh.fill);
      $$('#m-thumbs button', modal).forEach((b, n) => b.setAttribute('aria-current', String(n === i)));
    };

    const pick = p => {
      current = p;
      modal.dataset.id = p ? p.id : '';
      $('#m-series').textContent = `Серия ${s}`;
      $('#m-model').textContent = p ? p.sku : s;
      $('#m-type').textContent = p ? [p.type, p.color].filter(Boolean).join(' · ')
        : `${rows.length} ${pl(rows.length, ['модель', 'модели', 'моделей'])} · ` +
          [...new Set(rows.map(x => x.type))].join(', ');
      $('#m-price').textContent = p ? fmt(p.price) : (low === high ? fmt(low) : 'от ' + fmt(low));
      $('#m-sku').textContent = p ? 'Артикул ' + p.id
        : (low === high ? 'Одна цена' : 'до ' + fmt(high)) + ' · цены из действующего прайса';
      $$('#m-list .mrow', modal).forEach(b =>
        b.setAttribute('aria-current', String(!!p && b.dataset.id === p.id)));
      shots = shotsFor(s, p);
      $('#m-thumbs').innerHTML = shots.map((x, i) =>
        `<button type="button" data-i="${i}" aria-current="${i === 0}"${x.fill ? ' data-fill' : ''}` +
        ` aria-label="Фото ${i + 1} из ${shots.length}"><img src="${x.src}" alt="" loading="lazy"></button>`).join('');
      show(0);
      syncUrl();
    };

    $('#m-list').innerHTML = rows.map(p =>
      `<li><button type="button" class="mrow is-pick" data-id="${p.id}" aria-current="false">
        <span class="mrow-thumb" style="${thumbStyle(p.id)}"></span>
        <span class="mrow-main"><span class="mrow-sku">${p.sku}</span>
          <span class="mrow-type">${[p.type, p.color].filter(Boolean).join(' · ')}</span></span>
        <span class="mrow-price">${fmt(p.price)}</span></button></li>`).join('');
    // повторный тап по выбранной модели возвращает модалку в режим серии
    $('#m-list').onclick = e => {
      const b = e.target.closest('.mrow'); if (!b) return;
      pick(b.dataset.id === current?.id ? null : rows.find(p => p.id === b.dataset.id));
    };
    $('#m-thumbs').onclick = e => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      show(+b.dataset.i);
    };

    modalReturn = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.dataset.series = s;
    pick(start);
    syncUrl();
    $('.modal-card', modal).focus({ preventScroll: true });
  }

  function closeModal() {
    $('#modal').hidden = true;
    $('#modal').dataset.id = '';
    if (!sheetIsOpen()) document.body.style.overflow = '';
    syncUrl();
    const back = modalReturn && modalReturn !== document.body && modalReturn.isConnected
      ? modalReturn : $('.scard:not([hidden]) .scard-open');
    if (back) back.focus({ preventScroll: true });
    modalReturn = null;
  }

  /* ---------- lead form ---------- */
  /* Заявка может быть на конкретную модель, а может на серию целиком — покажем
     и то, и другое одной строкой, без отдельных кнопок «подобрать». */
  function chooseProduct(title, note) {
    $('#f-product').value = note ? `${title} · ${note}` : title;
    $('#chosen').hidden = false;
    $('#chosen').innerHTML = `<span>Заявка на: <b>${title}</b>${note ? ' — ' + note : ''}</span>
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
    const [c, p, s, m, po] = await Promise.all([
      fetch('data/site.config.json').then(r => r.json()).catch(() => null),
      fetch('data/products.json').then(r => r.json()),
      fetch('data/series_photos.json').then(r => r.json()).catch(() => ({})),
      fetch('data/series.json').then(r => r.json()).catch(() => null),
      fetch('data/posters.json').then(r => r.json()).catch(() => [])
    ]);
    cfg = c; products = p; photos = s; if (m) meta = m;
    tIdx = new Map(products.map((x, i) => [x.id, i]));
    const deepId = applyUrl();
    bindQty(); bindMark(); buildFilters(); buildCards(); renderPosters(po); render();
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
      // ссылка на одну серию ведёт к серии целиком, а не к сетке из одной карточки
      if (target) openSeries(target.series, target);
      else if (!deepId && state.series.size === 1) openSeries([...state.series][0]);
    }

    $('#grid').addEventListener('click', e => {
      const row = e.target.closest('.mrow');
      if (row) {
        const p = products.find(x => x.id === row.dataset.id);
        if (p) openSeries(p.series, p);
        return;
      }
      const more = e.target.closest('[data-open]');
      if (more) { openSeries(more.dataset.open); return; }
      const card = e.target.closest('.scard'); if (!card) return;
      if (e.target.closest('.scard-open') || e.target.closest('.scard-hero')) openSeries(card.dataset.series);
    });
    $('#posterGrid').addEventListener('click', e => {
      const p = e.target.closest('.ppost[data-series]');
      if (p) openSeries(p.dataset.series);
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
      const id = $('#modal').dataset.id, s = $('#modal').dataset.series;
      const p = id && products.find(x => x.id === id);
      if (p) {
        chooseProduct(`${p.series} ${p.sku}`, fmt(p.price) + ' за единицу');
      } else if (s) {
        const rows = products.filter(x => x.series === s);
        const low = Math.min(...rows.map(x => x.price));
        chooseProduct(`Серия ${s}`, `${rows.length} ${pl(rows.length, ['модель', 'модели', 'моделей'])}, от ${fmt(low)}`);
      }
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
