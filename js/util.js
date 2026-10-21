// 小さなDOMヘルパーと文字列ユーティリティ

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// h('div', {class: 'x', onclick: fn}, child, 'text', ...)
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') el.value = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export const KANJI_RE = /[㐀-䶿一-鿿豈-﫿々〆ヶ]/;
export const hasKanji = (s) => KANJI_RE.test(s || '');

export function kataToHira(s) {
  return (s || '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

const KANJI_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
export function toKanjiNumber(n) {
  if (n < 10) return KANJI_DIGITS[n];
  if (n < 100) {
    const t = Math.floor(n / 10), o = n % 10;
    return (t === 1 ? '' : KANJI_DIGITS[t]) + '十' + (o ? KANJI_DIGITS[o] : '');
  }
  return String(n);
}

// 章番号の表記
export function chapterLabel(n, format) {
  if (format === 'dai') return `第${n}章`;
  if (format === 'kanji') return `第${toKanjiNumber(n)}章`;
  return `${n}章`;
}

export function countOccurrences(text, word) {
  if (!word) return 0;
  let n = 0, i = 0;
  while ((i = text.indexOf(word, i)) !== -1) { n++; i += word.length; }
  return n;
}

export function formatDate(ts) {
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function safeStorage(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}
