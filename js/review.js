/* Служебный режим правки кадров. Подгружается из app.js только когда в адресе стоит
   ?review=<токен>, поэтому обычному посетителю ни этот файл, ни интерфейс не достаются.
   Отметки живут в localStorage этого браузера: витрина статическая, сохранений на сервере
   нет, поэтому результат — текст из кнопки «Скопировать список», который владелец
   присылает мне, а правки вносит сборка. Файл временный, снимается вместе с хуком в app.js. */

const KEY = 'oll.review.v1';
const KIND = { g: 'кадр галереи', h: 'герой карточки', p: 'постер', c: 'вырезка модели' };
const TARGETS = '.scard-hero img, #m-thumbs img, .ppost img, #m-main';

const store = JSON.parse(localStorage.getItem(KEY) || '{}');

const rel = (img) => {
  const src = img.currentSrc || img.src || '';
  if (!src) return '';
  try { return decodeURIComponent(new URL(src, location.href).pathname).replace(/^\/?img\//, ''); }
  catch { return ''; }
};

function idOf(img) {
  const r = rel(img);
  // модалка до первого открытия держит пиксель-заглушку в src, её отмечать нельзя
  if (!/^(series|posters|heroes|products)\//.test(r)) return null;
  const host = img.closest('[data-series]');
  const series = host ? host.dataset.series : '';
  const kind = img.closest('.ppost') ? 'p'
    : (img.closest('.scard-hero') || r.startsWith('heroes/')) ? 'h'
      : r.startsWith('products/') ? 'c' : 'g';
  return `${kind}|${series}|${r}`;
}

const save = () => localStorage.setItem(KEY, JSON.stringify(store));

function decorate() {
  for (const img of document.querySelectorAll(TARGETS)) {
    const id = idOf(img);
    if (!id) continue;
    const box = img.parentElement;
    box.classList.add('rv-rel');
    let x = box.querySelector(':scope > .rv-x');
    if (!x) {
      x = document.createElement('span');
      x.className = 'rv-x';
      box.appendChild(x);
    }
    x.dataset.id = id;
    const off = !!store[id];
    x.classList.toggle('is-on', off);
    x.setAttribute('aria-label', off ? 'Вернуть кадр' : 'Убрать кадр');
    x.title = off ? 'вернуть кадр' : 'убрать кадр';
    box.classList.toggle('rv-off', off);
  }
  renderPanel();
}

function toggle(id) {
  if (store[id]) delete store[id]; else store[id] = true;
  save();
  decorate();
}

function lines() {
  const rows = Object.keys(store).map((id) => {
    const [k, s, r] = id.split('|');
    return { head: s || '—', kind: KIND[k] || k, r };
  });
  rows.sort((a, b) => (a.head + a.kind + a.r).localeCompare(b.head + b.kind + b.r, 'ru'));
  return rows.map(x => `${x.head} | ${x.kind} | ${x.r}`);
}

function report() {
  const d = new Date();
  const stamp = `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const list = lines();
  return `# правка кадров OLL · отмечено ${list.length} · ${stamp}\n` + list.join('\n');
}

async function copyList(btn) {
  const text = report();
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    ok = document.execCommand('copy');
    ta.remove();
  }
  showText(ok ? 'Скопировано. Если вставить не выходит — сохраните .txt.'
              : 'В буфер не легло: выделите текст в поле ниже и нажмите Ctrl+C.');
  btn.textContent = ok ? 'Скопировано' : 'Не скопировалось';
  setTimeout(() => { btn.textContent = 'Скопировать список'; }, 2600);
}

function saveFile() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([report()], { type: 'text/plain;charset=utf-8' }));
  a.download = 'pravki-kadrov.txt';
  a.click();
  showText('Файл pravki-kadrov.txt сохранён (обычно в «Загрузках»).');
}

/* Поле с готовым списком: буфер обмена в некоторых браузерах закрыт политиками, а
   текст в поле можно выделить мышью и скопировать вручную. */
function showText(msg) {
  const ta = $('#rvText'), p = $('#rvMsg');
  ta.value = report();
  ta.hidden = false;
  p.textContent = msg;
  ta.select();
}

let panel = null;

function renderPanel() {
  if (!panel) return;
  const ids = Object.keys(store);
  $('#rvN').textContent = ids.length;
  $('#rvList').innerHTML = ids.length
    ? ids.map(id => {
        const [k, s, r] = id.split('|');
        return `<li><button type="button" data-id="${id}">` +
          `<b>${s || '—'}</b> ${KIND[k] || k}<span>${r.split('/').pop()}</span><i>вернуть</i></button></li>`;
      }).join('')
    : '<li class="rv-empty">Пока ничего не отмечено. Нажмите ✕ на любом кадре.</li>';
}

const $ = (s) => document.querySelector(s);

function mountPanel() {
  panel = document.createElement('section');
  panel.className = 'rv-panel';
  panel.setAttribute('aria-label', 'Правка кадров');
  panel.innerHTML =
    `<header class="rv-head"><span>Правка кадров</span><b id="rvN">0</b>` +
    `<button type="button" id="rvMin" title="свернуть/развернуть">▾</button></header>` +
    `<div class="rv-body"><ul id="rvList"></ul>` +
    `<div class="rv-actions"><button type="button" class="btn rv-copy" id="rvCopy">Скопировать список</button>` +
    `<button type="button" class="btn btn-ghost" id="rvSave">Скачать .txt</button>` +
    `<button type="button" class="btn btn-ghost" id="rvShow">Показать текст</button>` +
    `<button type="button" class="btn btn-ghost" id="rvWipe">Отменить всё</button></div>` +
    `<textarea id="rvText" rows="8" readonly hidden spellcheck="false"></textarea>` +
    `<p class="rv-msg" id="rvMsg"></p>` +
    `<p class="rv-note">Отметки видны только вам и только в этом браузере. Скопируйте список или` +
    ` сохраните .txt — удалённые кадры уберёт сборка, картинки останутся на диске.</p></div>`;
  document.body.appendChild(panel);
  panel.querySelector('#rvCopy').onclick = (e) => copyList(e.currentTarget);
  panel.querySelector('#rvSave').onclick = saveFile;
  panel.querySelector('#rvShow').onclick = () => showText('Текст ниже: выделите и скопируйте.');
  panel.querySelector('#rvWipe').onclick = () => {
    if (!Object.keys(store).length) return;
    if (!confirm('Снять все отметки?')) return;
    Object.keys(store).forEach(k => delete store[k]);
    save();
    decorate();
  };
  panel.querySelector('#rvMin').onclick = () => {
    panel.classList.toggle('is-min');
    panel.dataset.userMin = panel.classList.contains('is-min') ? '1' : '';
  };
  panel.querySelector('#rvList').onclick = e => {
    const b = e.target.closest('button[data-id]');
    if (b) toggle(b.dataset.id);
  };
}

document.addEventListener('click', e => {
  const x = e.target.closest('.rv-x');
  if (!x) return;
  e.preventDefault();
  e.stopPropagation();
  toggle(x.dataset.id);
}, true);

const style = document.createElement('link');
style.rel = 'stylesheet';
style.href = 'css/review.css';
document.head.appendChild(style);

document.documentElement.classList.add('rv-mode');
mountPanel();
decorate();

let queued = 0;
const mo = new MutationObserver(() => {
  if (queued) return;
  queued = requestAnimationFrame(() => { queued = 0; decorate(); });
});
['grid', 'modal', 'posterGrid'].forEach(id => {
  const el = document.getElementById(id);
  if (el) mo.observe(el, { childList: true, subtree: true });
});
