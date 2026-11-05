(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const money = new Intl.NumberFormat('ru-RU');
  /* В data/products.json лежит ровно та цена, что показана на витрине: вверх до тысячи
     (55 044 → 56 000), округление сделано на сборке (tools/public_data.py). Точных
     прайсовых цен на сайте нет вообще — витрина не должна выгружаться как прайс-лист. */
  const fmt = v => money.format(v) + ' ₽';

  const SERIES_ORDER = ['Edge', 'Vessel', 'Aura', 'Bubble', 'Flow', 'Astra', 'FOLIO'];
  const state = { series: new Set(), type: '', q: '', sort: 'series', max: Infinity };
  let products = [], photos = {}, cfg = null, meta = { hero: {}, src: {} }, tIdx = new Map();
  let stext = {};                       // короткие описания серий для режима галереи
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

  /* Резерв на случай, если data/site.config.json не придёт (отказ сети, кэш, сырой
     выкатываемый JSON). Заявка — единственная работа витрины, поэтому телефон, почта и
     адрес приёмщика живут и в скрипте: без конфига форма остаётся отправляемой, а
     контакт — открываемым. Коды перевёрнуты как в конфиге, регулярка по HTML/JS
     по-прежнему видит только маску. */
  const FALLBACK = {
    contacts: {
      phoneCode: '95114789997+', phoneMasked: '+7 (999) •••-••-••',
      emailCode: 'ur.sur-elppo@vomorg.i', emailMasked: 'почта · показать',
      hours: 'Пн–Пт 9:00–19:00'
    },
    lead: { endpoint: 'https://api.oppleoll.ru/submit.php' }
  };

  function applyConfig() {
    const c = cfg.contacts;
    $$('[data-c="phoneMasked"]').forEach(s => s.textContent = c.phoneMasked);
    $$('[data-c="emailMasked"]').forEach(s => s.textContent = c.emailMasked);
    $$('[data-c-hours]').forEach(s => s.textContent = c.hours);
    // реквизиты есть только в конфиге: без него не выдумываем и не чистим
    const L = cfg.legal;
    if (L) $('#legal').textContent = [L.entity, `ИНН ${L.inn}`, L.ogrn && `ОГРН ${L.ogrn}`,
      L.address].filter(Boolean).join(' · ');
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

  /* ---------- история бренда: кадры листаются, текст справа продолжается ---------- */
  /* Класс .story--bound вешается здесь, а не в разметке: без JS (и без наблюдателя)
     секция остаётся столбцом «кадр — подпись» и абзацы идут следом, то есть читается. */
  function bindStory() {
    const story = $('#story');
    if (!story || !('IntersectionObserver' in window)) return;
    const frames = $$('.sframe', story), paras = $$('.spar', story);
    if (!frames.length || frames.length !== paras.length) return;
    const show = i => {
      frames.forEach((f, n) => f.classList.toggle('on', n === i));
      paras.forEach((p, n) => p.classList.toggle('on', n === i));
    };
    story.classList.add('story--bound');
    show(0);
    /* Полоса пересобирается под ориентацию ленты: на десктопе кадры едут по вертикали
       и активен тот, что в середине экрана, на узком — горизонтальная лента, и тогда
       корнем наблюдателя должен быть сам скролл-контейнер, а полосой — его центр. */
    let io = null;
    const rebind = () => {
      if (io) io.disconnect();
      const strip = matchMedia('(max-width:1000px)').matches;
      io = new IntersectionObserver(
        entries => entries.forEach(e => { if (e.isIntersecting) show(frames.indexOf(e.target)); }),
        strip ? { root: $('.story-media', story), rootMargin: '0px -40% 0px -40%' }
              : { rootMargin: '-45% 0px -45% 0px' });
      frames.forEach(f => io.observe(f));
    };
    rebind();
    matchMedia('(max-width:1000px)').addEventListener('change', rebind);
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

  /* Оставить одну серию в фильтре: из галереи постера человек приходит в витрину
     уже с готовой выборкой, а не со всей сеткой. */
  function filterToSeries(s) {
    state.series.clear(); state.series.add(s);
    $$('#seriesChips .chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.series === s)));
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

  /* Короткий sku из прайса неоднозначен: MZX600 — и Edge, и Aura, MZD400 — Astra,
     Aura и Bubble. Показываем полный код модели, а sku оставляем в поиске:
     по «MZX600» находится вся линейка, по «MZX600-D48LTTYY-001» — одна модель. */
  const codeOf = p => p.code || p.sku;

  function matched() {
    return products.filter(p =>
      (!state.type || p.type === state.type) &&
      p.price <= state.max &&
      (!state.q || (codeOf(p) + ' ' + p.sku + ' ' + p.series + ' ' + p.type + ' ' + (p.color || '')).toLowerCase().includes(state.q)));
  }

  /* Группы в том порядке, который задан сортировкой: карточки упорядочиваются по
     своей лучшей цене, а не по первой попавшейся модели. До 02.11.2026 ключом было
     a[1][0].price — цена модели, оказавшейся первой в products.json, и порядок
     расходился с подписью «от …» на четырёх карточках из семи. */
  function groups() {
    const list = matched();
    const map = new Map();
    for (const p of list) (map.get(p.series) || map.set(p.series, []).get(p.series)).push(p);
    const rows = [...map.entries()].filter(([s]) => !state.series.size || state.series.has(s));
    const low = m => Math.min(...m.map(p => p.price));
    const byPrice = state.sort === 'price-asc' ? (a, b) => low(a[1]) - low(b[1])
      : state.sort === 'price-desc' ? (a, b) => low(b[1]) - low(a[1])
      : (a, b) => SERIES_ORDER.indexOf(a[0]) - SERIES_ORDER.indexOf(b[0]);
    rows.sort(byPrice);
    const inside = state.sort === 'price-desc' ? (a, b) => b.price - a.price : (a, b) => a.price - b.price;
    for (const [, m] of rows) m.sort(inside);
    return rows;
  }

  const rowHtml = p => `<li><button type="button" class="mrow" data-id="${p.id}"
      aria-label="${p.series} ${codeOf(p)}, ${fmt(p.price)} за единицу">
      <span class="mrow-thumb" style="${thumbStyle(p.id)}"></span>
      <span class="mrow-main"><span class="mrow-sku">${codeOf(p)}</span>
        <span class="mrow-type">${[p.type, p.color].filter(Boolean).join(' · ')}</span></span>
      <span class="mrow-price">${fmt(p.price)}</span></button></li>`;

  /* Карточек девять, и строим мы их один раз: пересобирать сетку на каждый символ
     поиска означало бы выбросить и заново декодировать девять больших кадров.
     С 03.11.2026 сетка.series уже лежит в index.html (tools/prerender_static.py), чтобы
     каталог видел робот без JavaScript, поэтому здесь карточки сначала подхватываются
     из разметки и только если их нет — создаются. data-sig в статике намеренно нет:
     первую перерисовку скрипт делает всегда и гарантированно показывает то, что в JSON. */
  function buildCards() {
    const frag = document.createDocumentFragment();
    for (const s of SERIES_ORDER) {
      const hero = meta.hero[s];
      const pre = $(`#grid .scard[data-series="${s}"]`);
      if (pre) { cardEls.set(s, pre); continue; }
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
    /* на телефоне счётчик живёт в залипающей строке: без активных фильтров
       «55 из 55» — шум, поэтому там просто оборот каталога */
    $('#barCount').textContent = n ? `${nModels} из ${products.length}` :
      `${products.length} ${pl(products.length, ['модель', 'модели', 'моделей'])}`;
    $('#fbCount').hidden = !n;
    $('#fbCount').textContent = n;
    // «Показать 0» звучало как обещание, которого лист не выполнит
    $('#done').textContent = nModels ? `Показать ${nModels}` : 'Готово';
    $('#empty').hidden = nModels > 0;
  }

  /* ---------- постеры серий ---------- */
  /* Исходник постера — 3:4 с типографикой по всему полю, поэтому рамка повторяет
     пропорцию и ничего не режет. Постер = вход в серию: открывает её галерею и
     короткое описание, без цен и списка моделей — цены живут только в витрине.
     Плиток-картинок без клика здесь нет: за каждой стоит серия. */
  function renderPosters(list) {
    const grid = $('#posterGrid'), sec = $('#posters');
    if (!list || !list.length) { if (sec) sec.hidden = true; return; }
    grid.innerHTML = list.map(p =>
      `<button type="button" class="ppost" data-series="${p.series}"` +
      ` aria-label="Открыть серию ${p.series}: галерея и описание">` +
      `<img src="${p.file}" alt="Постер серии ${p.series}" ` +
      `width="${p.w}" height="${p.h}" loading="lazy"></button>`).join('');
  }

  /* ---------- модалка: серия целиком ---------- */
  /* Кадр задаёт пропорцию сцены: товарный квадрат показывается целиком, интерьер
     заполняет рамку. Диапазон 0.8–1.9 — по реальной выборке: хвосты 0.53 и 2.77
     иначе либо вырезали бы треть сюжета, либо растягивали карточку на весь экран. */
  const stageAr = x => Math.min(1.9, Math.max(.8, x.w && x.h ? x.w / x.h : 4 / 3));
  /* Потолок растяжения выреза: 90 px исходника в строке списка (44 px) выглядят
     резкими, а в сцене на 460 px превращаются в кашу. Ограничиваем показ, а не холст. */
  const capFor = m => !m || m >= 250 ? 1 : m >= 120 ? .75 : .55;
  /* Витринной серии хватает пяти кадров: список моделей в модалке и так длинный.
     В режиме галереи (клик по постеру) ленты — единственное содержимое, поэтому
     там всегда максимум кадров, даже если серия есть в прайсе. */
  const shotCap = (s, info) => info ? 8 : (products.some(p => p.series === s) ? 5 : 8);

  function shotsFor(s, model, info) {
    const hero = meta.hero[s];
    // герой карточки — это кроп одного из кадров ленты; показывать его дважды смыслa нет
    const heroFrom = hero && (hero.from || '').replace(/^img\//, '');
    const out = [];
    if (model) out.push({ src: 'img/products/' + model.id + '.webp', ar: 1,
      cap: capFor(meta.src[model.id]), alt: `Светильник ${s} ${codeOf(model)}` });
    else if (hero) out.push(hero.product
      ? { src: hero.file, ar: 1, cap: capFor(meta.src[hero.id]), alt: `Серия ${s}` }
      : { src: hero.file, ar: hero.ar, fill: true, alt: `Серия ${s}` });
    for (const x of photos[s] || []) {
      const src = 'img/' + x.file;
      if (out.some(o => o.src === src) || x.file === heroFrom) continue;
      out.push({ src, ar: stageAr(x), fill: true, alt: `Серия ${s}, кадр ${out.length + 1}` });
      if (out.length >= shotCap(s, info)) break;
    }
    return out;
  }

  let modalReturn = null;

  function openSeries(s, model, info) {
    const hit = matched().filter(p => p.series === s);
    const rows = (hit.length ? hit : products.filter(p => p.series === s)).slice();
    rows.sort(state.sort === 'price-desc' ? (a, b) => b.price - a.price : (a, b) => a.price - b.price);
    const start = rows.find(p => p.id === model?.id) || null;
    // серии вне прайса: моделей нет, показываем только съёмку и уводим цену с адресом
    const brand = !rows.length;
    closeSheet();

    const modal = $('#modal'), stage = $('.modal-stage', modal), main = $('#m-main');
    const prices = rows.map(p => p.price), low = Math.min(...prices), high = Math.max(...prices);
    const txt = stext[s];
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
      modal.classList.toggle('is-info', !!info);
      $('#m-series').textContent = `Серия ${s}`;
      $('#m-model').textContent = p ? codeOf(p) : s;
      $('#m-type').textContent = info ? (txt ? txt.line : '')
        : p ? [p.type, p.color].filter(Boolean).join(' · ')
          : brand ? 'Поставка под заказ — цену сообщим по заявке'
            : `${rows.length} ${pl(rows.length, ['модель', 'модели', 'моделей'])} · ` +
              [...new Set(rows.map(x => x.type))].join(', ');
      if (info) $('#m-about-text').innerHTML = (txt ? txt.about : []).map(x => `<p>${x}</p>`).join('');
      $('#m-to-vitrine').hidden = brand;
      $('.m-price', modal).hidden = brand || info;
      $('#m-price').textContent = p ? fmt(p.price) : (low === high ? fmt(low) : 'от ' + fmt(low));
      $$('#m-list .mrow', modal).forEach(b =>
        b.setAttribute('aria-current', String(!!p && b.dataset.id === p.id)));
      shots = shotsFor(s, p, info);
      $('#m-sku').textContent = info
        ? `${shots.length} ${pl(shots.length, ['кадр', 'кадра', 'кадров'])} из презентаций и съёмки серии`
        : p ? 'Артикул ' + p.id
          : brand ? 'Кадры из съёмки серии'
            : (low === high ? 'Одна цена' : 'до ' + fmt(high));
      $('#m-thumbs').innerHTML = shots.map((x, i) =>
        `<button type="button" data-i="${i}" aria-current="${i === 0}"${x.fill ? ' data-fill' : ''}` +
        ` aria-label="Фото ${i + 1} из ${shots.length}"><img src="${x.src}" alt="" loading="lazy"></button>`).join('');
      show(0);
      syncUrl();
    };

    $('#m-list').hidden = brand || info;
    $('#m-list').innerHTML = rows.map(p =>
      `<li><button type="button" class="mrow is-pick" data-id="${p.id}" aria-current="false">
        <span class="mrow-thumb" style="${thumbStyle(p.id)}"></span>
        <span class="mrow-main"><span class="mrow-sku">${codeOf(p)}</span>
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
    /* Из галереи постера — в витрину с этой же серией: ссылка фильтрует сетку
       и закрывает модалку, цены при этом остаются только на витрине. */
    $('#m-to-vitrine').onclick = e => {
      e.preventDefault();
      closeModal();
      filterToSeries(s);
      scrollToEl($('#catalog'));
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

  /* ---------- портрет автора ---------- */
  /* Отдельное окно, а не reuse модалки товара: здесь нет серии, галереи и заявки,
     и тащить в модалку ещё один режим означало бы ветку на каждый её шаг. */
  let creditReturn = null;

  function openCredit() {
    creditReturn = document.activeElement;
    const photo = $('#creditPhoto');
    if (!photo.dataset.loaded) { photo.src = photo.dataset.src; photo.dataset.loaded = '1'; }
    $('#credit').hidden = false;
    document.body.style.overflow = 'hidden';
    $('.credit-card', $('#credit')).focus({ preventScroll: true });
  }

  function closeCredit() {
    if ($('#credit').hidden) return;
    $('#credit').hidden = true;
    if ($('#modal').hidden && !sheetIsOpen()) document.body.style.overflow = '';
    const back = creditReturn && creditReturn !== document.body && creditReturn.isConnected
      ? creditReturn : $('#creditOpen');
    back.focus({ preventScroll: true });
    creditReturn = null;
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

  /* Ошибка должна прервать чтение, а не дождаться следующей паузы: скринридер
     с aria-live="polite" молчал, пока человек уже жал кнопку повторно. */
  function status(msg, cls) {
    const el = $('#formStatus');
    el.textContent = msg;
    el.className = 'form-status ' + (cls || '');
    el.setAttribute('role', cls === 'err' ? 'alert' : 'status');
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
    // считаем цифры, а не длину строки: «+7 (___) ___-__-__» из placeholder — тоже 10+ символов
    if ((d.phone || '').replace(/\D/g, '').length < 10)
      return bad(el('phone'), 'Проверьте телефон — нужно не меньше 10 цифр.');
    if (d.email && !/^[^@\s]+@[^@\s]+\.[a-zа-я]{2,}$/i.test(d.email)) return bad(el('email'), 'Проверьте почту.');
    if (!d.consent) return bad(el('consent'), 'Без согласия на обработку данных заявку отправить нельзя.');
    $$('.is-bad', f).forEach(x => x.classList.remove('is-bad'));

    const btn = $('#submitBtn');
    btn.disabled = true; status('Отправляем…');
    // на предпросмотре (tools/dev_server.py) шлём на локальную заглушку: боевой endpoint
    // в конфиге абсолютный, и локальные проверки улетали бы настоящими заявками на почту
    const endpoint = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '/submit.php' : cfg.lead.endpoint;
    /* Без таймаута «Отправляем…» висело сколько угодно: браузер ждёт ответа, кнопка
       неактивна, а человек не знает — ушла заявка или нет. */
    const ac = new AbortController();
    const kill = setTimeout(() => ac.abort(), 15000);
    try {
      const res = await fetch(endpoint, {
        signal: ac.signal,
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
      if (res.status === 429) throw new Error('такая заявка уже принята — подождите минуту.');
      if (!res.ok || !out.ok) throw new Error(out.error ||
        (res.status >= 500 ? 'приёмник заявок не ответил, попробуйте ещё раз' : `сервер ответил ${res.status}`));
      f.reset(); $('#chosen').hidden = true; $('#f-product').value = '';
      status('Заявка отправлена. Свяжемся в рабочее время.', 'ok');
    } catch (err) {
      /* Данные не трогаем: форма остаётся заполненной, повтор — один тап. */
      const why = ac.signal.aborted
        ? 'сервер не ответил за 15 секунд, проверьте связь и отправьте ещё раз'
        : err.name === 'TypeError'
          ? 'нет связи с приёмником заявок — отправьте ещё раз или позвоните, телефон открывает клик по маске'
          : err.message;
      status('Заявка НЕ отправлена: ' + why.replace(/\.$/, '') + '.', 'err');
    } finally {
      clearTimeout(kill);
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

  /* Каталог не должен утаскивать за собой форму: если products.json не пришёл,
     сетку не строим и предлагаем повторить, а контакты, постеры и заявка работают. */
  function showCatalogError() {
    $('#grid').innerHTML = '<p class="empty">Не удалось загрузить каталог. ' +
      '<button type="button" class="link-reset" id="retryCat">Повторить</button></p>';
    $('#retryCat').onclick = () => location.reload();
    $('#heroLead').textContent = 'Каталог не загрузился — попробуйте обновить страницу.';
  }

  async function boot() {
    const [c, p, s, m, po, tx] = await Promise.all([
      fetch('data/site.config.json').then(r => r.json()).catch(() => null),
      fetch('data/products.json').then(r => r.json()).catch(() => null),
      fetch('data/series_photos.json').then(r => r.json()).catch(() => ({})),
      fetch('data/series.json').then(r => r.json()).catch(() => null),
      fetch('data/posters.json').then(r => r.json()).catch(() => []),
      fetch('data/series_text.json').then(r => r.json()).catch(() => ({}))
    ]);
    cfg = c || FALLBACK;
    products = Array.isArray(p) ? p : [];
    photos = s || {}; if (m) meta = m;
    stext = tx || {};
    tIdx = new Map(products.map((x, i) => [x.id, i]));
    const deepId = applyUrl();
    bindQty(); bindMark();
    if (products.length) { buildFilters(); buildCards(); render(); }
    else showCatalogError();
    renderPosters(po);
    applyConfig(); bindReveal(); bindStory();

    // счётчик под h1 и строка каталога считаются из данных, а не держатся в разметке руками
    if (products.length) {
      const nSer = new Set(products.map(x => x.series)).size, nMod = products.length;
      $('#heroLead').textContent = `${nMod} ${pl(nMod, ['модель', 'модели', 'моделей'])} · ` +
        `${nSer} ${pl(nSer, ['серия', 'серии', 'серий'])}. Цены на сайте, поставка под заказ.`;
      $('#catTotal').textContent = `${nMod} ${pl(nMod, ['модель', 'модели', 'моделей'])} · ` +
        `${nSer} ${pl(nSer, ['серия', 'серии', 'серий'])}`;
    }

    if (products.length && (deepId || state.series.size)) {
      $('#catalog').scrollIntoView({ behavior: 'instant', block: 'start' });
      const target = deepId && products.find(x => x.id === deepId);
      // ссылка на одну серию ведёт к серии целиком, а не к сетке из одной карточки
      if (target) openSeries(target.series, target);
      else if (!deepId && state.series.size === 1) openSeries([...state.series][0]);
    }

    /* Режим правки кадров (служебный, до разбора дублей). Код грузится только если в
       адресе лежит верный токен, поэтому посетителю ни скрипт, ни оверлей не достаются. */
    if (new URLSearchParams(location.search).get('review') === 'kadr-2491')
      import('./review.js').catch(() => {});

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
      if (p) openSeries(p.dataset.series, null, true);
    });
    $('#modal').addEventListener('click', e => {
      if (e.target.hasAttribute('data-close')) closeModal();
    });
    $('#creditOpen').addEventListener('click', openCredit);
    $('#credit').addEventListener('click', e => {
      if (e.target.hasAttribute('data-credit-close')) closeCredit();
    });
    /* Tab слушаем на document, а не на самом окне: ловушка на #modal и #toolbar
       срабатывала только когда фокус уже был внутри, и Shift+Tab из шапки уходил
       за спину модалки — пользователь оставался с неактивной кнопкой где-то под затемнённым фоном. */
    document.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        if (!$('#credit').hidden) trapTab(e, $('.credit-card', $('#credit')));
        else if (!$('#modal').hidden) trapTab(e, $('.modal-card', $('#modal')));
        else if (sheetIsOpen()) trapTab(e, $('#toolbar'));
      } else if (e.key === 'Escape') {
        if (!$('#credit').hidden) closeCredit();
        else if (!$('#modal').hidden) closeModal();
        else closeSheet();
      }
    });
    matchMedia(SHEET).addEventListener('change', e => { if (!e.matches) closeSheet(); });
    $('#m-lead').addEventListener('click', () => {
      const id = $('#modal').dataset.id, s = $('#modal').dataset.series;
      const p = id && products.find(x => x.id === id);
      if (p) {
        chooseProduct(`${p.series} ${codeOf(p)}`,
          [p.color, fmt(p.price) + ' за единицу'].filter(Boolean).join(' · '));
      } else if (s) {
        const rows = products.filter(x => x.series === s);
        if (!rows.length) { chooseProduct(`Серия ${s}`, 'поставка под заказ'); }
        else {
          const low = Math.min(...rows.map(x => x.price));
          chooseProduct(`Серия ${s}`,
            `${rows.length} ${pl(rows.length, ['модель', 'модели', 'моделей'])}, от ${fmt(low)}`);
        }
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
