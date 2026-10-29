(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const money = new Intl.NumberFormat('ru-RU');
  const fmt = v => money.format(v) + ' ₽';

  const SERIES_ORDER = ['Edge', 'Vessel', 'Aura', 'Bubble', 'CRYX', 'Flow', 'Astra', 'Lamino', 'FOLIO'];
  const state = { series: new Set(), type: '', q: '', sort: 'series', max: Infinity };
  let products = [], photos = {}, cfg = null, formStart = 0;
  let priceTop = 0, priceCap = 0;
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
    $('#updated').textContent = new Date().toLocaleDateString('ru-RU');
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
    $('#q').addEventListener('input', e => { state.q = e.target.value.trim().toLowerCase(); render(); });
    $('#reset').addEventListener('click', reset);
    $('#reset2').addEventListener('click', reset);
  }

  function reset() {
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

  function render() {
    const list = visible();
    $('#grid').innerHTML = list.map(p => `
      <button type="button" class="card" data-id="${p.id}" aria-label="${p.series} ${p.sku}, ${fmt(p.price)}">
        <span class="card-img ${p.image_kind === 'photo' ? 'photo-tile' : ''}">
          <img src="img/products/${p.id}.png" alt="Светильник ${p.series} ${p.sku}" loading="lazy">
        </span>
        <span class="card-body">
          <span class="card-series">${p.series}</span>
          <span class="card-model">${p.sku}</span>
          <span class="card-type">${p.type}</span>
          <span class="card-price">${fmt(p.price)}<small>за шт.</small></span>
        </span>
        <span class="card-cta">Смотреть</span>
      </button>`).join('');
    $('#count').textContent = `${list.length} из ${products.length} моделей`;
    $('#empty').hidden = list.length > 0;
  }

  /* ---------- modal ---------- */
  function galleryFor(p) {
    const shots = (photos[p.series] || []).slice(0, 4).map(x => 'img/' + x.file);
    return [{ src: 'img/products/' + p.id + '.png', label: p.sku, contain: true },
            ...shots.map(s => ({ src: s, contain: false }))];
  }

  function openModal(p) {
    const shots = galleryFor(p);
    $('#m-series').textContent = `Серия ${p.series}`;
    $('#m-model').textContent = p.sku;
    $('#m-type').textContent = [p.type, p.color].filter(Boolean).join(' · ');
    $('#m-price').textContent = fmt(p.price);
    $('#m-sku').textContent = 'Артикул ' + p.id;
    $('#m-thumbs').innerHTML = shots.map((s, i) =>
      `<button type="button" data-i="${i}" aria-current="${i === 0}"><img src="${s.src}" alt="" loading="lazy"></button>`).join('');
    const main = $('#m-main');
    main.src = shots[0].src;
    main.dataset.mode = 'contain';
    $('#modal').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#modal').dataset.id = p.id;
    syncUrl();
    $('#m-thumbs').onclick = e => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      $$('button', $('#m-thumbs')).forEach(x => x.setAttribute('aria-current', 'false'));
      b.setAttribute('aria-current', 'true');
      main.src = shots[+b.dataset.i].src;
    };
  }

  function closeModal() { $('#modal').hidden = true; document.body.style.overflow = ''; syncUrl(); }

  /* ---------- lead form ---------- */
  function chooseProduct(p) {
    $('#f-product').value = `${p.series} ${p.sku} · ${fmt(p.price)}`;
    $$('[name=intent]').forEach(r => r.checked = r.value === 'Модель из витрины');
    $('#chosen').hidden = false;
    $('#chosen').innerHTML = `<span>Заявка на: <b>${p.series} ${p.sku}</b> — ${fmt(p.price)}</span>
      <button type="button" id="dropChosen" aria-label="Убрать товар">×</button>`;
    $('#dropChosen').onclick = () => { $('#f-product').value = ''; $('#chosen').hidden = true; };
  }

  function bindQty() {
    const inp = $('#f-qty');
    const clamp = v => Math.max(1, Math.min(9999, v));
    $$('.qty-btn').forEach(b => b.addEventListener('click', () => {
      inp.value = clamp((parseInt(inp.value, 10) || 0) + +b.dataset.step);
    }));
    inp.addEventListener('blur', () => { inp.value = clamp(parseInt(inp.value, 10) || 1); });
  }

  function status(msg, cls) {
    const el = $('#formStatus'); el.textContent = msg; el.className = 'form-status ' + (cls || '');
  }

  async function submit(e) {
    e.preventDefault();
    const f = e.target;
    const d = Object.fromEntries(new FormData(f).entries());
    if (!d.name?.trim()) return status('Заполните, как к вам обращаться.', 'err');
    if (!/[\d\s()+-]{10,}/.test(d.phone || '')) return status('Проверьте телефон — нужно не меньше 10 цифр.', 'err');
    if (d.email && !/^[^@\s]+@[^@\s]+\.[a-zа-я]{2,}$/i.test(d.email)) return status('Проверьте почту.', 'err');
    if (!d.consent) return status('Без согласия на обработку данных заявку отправить нельзя.', 'err');

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
          qty: (d.qty || '').trim(),
          product: (d.product || '').trim(),
          // обработчик знает только фиксированный набор полей, поэтому выбор из
          // «Что подбираем» едет первой строкой комментария, а не новым полем
          message: [(d.intent || '').trim(), (d.message || '').trim()].filter(Boolean).join(' — '),
          website: d.website || '',
          consent: true,
          filledMs: formStart ? Date.now() - formStart : 0,
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

  /* ---------- boot ---------- */
  async function boot() {
    const [c, p, s] = await Promise.all([
      fetch('data/site.config.json').then(r => r.json()),
      fetch('data/products.json').then(r => r.json()),
      fetch('data/series_photos.json').then(r => r.json()).catch(() => ({}))
    ]);
    cfg = c; products = p; photos = s;
    const deepId = applyUrl();
    applyConfig(); bindReveal(); bindQty(); buildFilters(); render();
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
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
    $('#m-lead').addEventListener('click', () => {
      const p2 = products.find(x => x.id === $('#modal').dataset.id);
      if (p2) chooseProduct(p2);
      closeModal();
      $('#contact').scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => $('#leadForm [name=name]').focus(), 600);
    });
    $('#leadForm').addEventListener('submit', submit);
    $('#leadForm').addEventListener('input', () => { if (!formStart) formStart = Date.now(); });
    addEventListener('scroll', () => $('.head').classList.toggle('solid', scrollY > 40), { passive: true });
  }

  boot().catch(err => {
    $('#grid').innerHTML = `<p class="empty">Не удалось загрузить каталог: ${err.message}</p>`;
  });
})();
