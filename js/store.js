// 脚本データの保存・読み込み（localStorage）
import { uid } from './util.js';

const INDEX_KEY = 'emgeki:index';
const CURRENT_KEY = 'emgeki:current';
const scriptKey = (id) => `emgeki:script:${id}`;

export const DEFAULT_SETTINGS = {
  writingMode: 'vertical',     // vertical(縦書き) | horizontal(横書き)
  orientation: 'landscape',    // portrait(A4縦) | landscape(A4横)
  font: 'serif-system',
  fontSize: 10.5,              // pt
  lineHeight: 1.8,
  directionIndent: 0,          // ト書きの字下げ（0 = 上部に配置）
  ruby: 'all',                 // all | first | none
  chapterFormat: 'plain',      // plain(1章) | dai(第1章) | kanji(第一章)
  chapterPageBreak: true,
  printTitlePage: true,
  printCastPage: true,
  pageNumbers: true,
  autoReading: true,
  memoArea: 'none',            // 演者のメモ欄：none | small | medium | large
  memoPosition: 'top',         // top | bottom | left | right
  memoRuled: true,             // メモ欄に罫線
  actingNotes: false,          // 印刷に「演技の指示」スペースを付ける
  editorWritingMode: 'horizontal', // 書く画面：horizontal | vertical
};

export const CHAR_COLORS = ['#c0392b', '#2471a3', '#1e8449', '#b9770e', '#7d3c98', '#117a65', '#a04000', '#5d6d7e'];

export function newScript(title = '無題の脚本') {
  const now = Date.now();
  return {
    id: uid(),
    version: 1,
    title,
    author: '',
    createdAt: now,
    updatedAt: now,
    settings: { ...DEFAULT_SETTINGS },
    characters: [],
    blocks: [],
    ignored: [],
  };
}

// 古いデータや読み込んだデータの欠けを補う
export function normalize(s) {
  const base = newScript();
  const out = { ...base, ...s };
  out.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
  out.characters = (s.characters || []).map((c, i) => ({
    id: c.id || uid(),
    name: String(c.name || '名前'),
    reading: String(c.reading || ''),
    readingAuto: c.readingAuto !== false,
    actor: String(c.actor || ''),
    color: c.color || CHAR_COLORS[i % CHAR_COLORS.length],
  }));
  const types = new Set(['dialogue', 'direction', 'situation', 'chapter']);
  out.blocks = (s.blocks || [])
    .filter((b) => types.has(b.type))
    .map((b) => ({ id: b.id || uid(), type: b.type, text: String(b.text || ''), ...(b.type === 'dialogue' ? { charId: b.charId || null, note: String(b.note || '') } : {}) }));
  out.ignored = Array.isArray(s.ignored) ? s.ignored : [];
  return out;
}

export function listScripts() {
  try {
    const list = JSON.parse(localStorage.getItem(INDEX_KEY) || '[]');
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch { return []; }
}

function writeIndex(list) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

export function loadScript(id) {
  try {
    const raw = localStorage.getItem(scriptKey(id));
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch { return null; }
}

// 例外（容量オーバーなど）は呼び出し側に投げる
export function saveScript(s) {
  s.updatedAt = Date.now();
  localStorage.setItem(scriptKey(s.id), JSON.stringify(s));
  const list = listScripts().filter((x) => x.id !== s.id);
  list.push({ id: s.id, title: s.title, updatedAt: s.updatedAt });
  writeIndex(list);
  localStorage.setItem(CURRENT_KEY, s.id);
}

export function deleteScript(id) {
  localStorage.removeItem(scriptKey(id));
  writeIndex(listScripts().filter((x) => x.id !== id));
}

export function currentId() {
  try { return localStorage.getItem(CURRENT_KEY); } catch { return null; }
}

export function loadCurrent() {
  const id = currentId();
  const s = id && loadScript(id);
  if (s) return s;
  const first = listScripts()[0];
  return first ? loadScript(first.id) : null;
}
