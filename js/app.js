// 演劇脚本ノート — 画面とデータのつなぎ込み
import * as store from './store.js';
import { renderPages, pageSizePx } from './paginate.js';
import { getReading, isTokenizerRequested, loadTokenizer } from './furigana.js';
import { runCheck, applyFix, applyAll } from './proofread.js';
import { FONTS, fontCss, ensureFont } from './fonts.js';
import { scriptToText, scriptToDocx } from './export.js';
import { $, $$, h, uid, hasKanji, chapterLabel, countOccurrences, formatDate, safeStorage } from './util.js';

let S = null;            // 編集中の脚本
let currentBlockId = null;
let view = 'editor';
let undoStack = [];
let dirty = false;
let saveTimer = null;
let lastIssues = [];

const charById = (id) => S.characters.find((c) => c.id === id);
const blockIndex = (id) => S.blocks.findIndex((b) => b.id === id);

// ============ 保存 ============

function markDirty() {
  dirty = true;
  const st = $('#save-status');
  st.textContent = '編集中…';
  st.classList.add('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 600);
}

function flush() {
  clearTimeout(saveTimer);
  if (!dirty || !S) return;
  try {
    store.saveScript(S);
    dirty = false;
    const st = $('#save-status');
    st.textContent = '保存済み';
    st.classList.remove('saving');
  } catch (e) {
    $('#save-status').textContent = '保存失敗';
    toast('保存できませんでした（端末の空き容量を確認してください）');
  }
}

// 画面が閉じられる・アプリが裏に回る・終了するときに必ず保存
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', flush);
window.addEventListener('blur', flush);

function pushUndo() {
  undoStack.push(JSON.stringify({ blocks: S.blocks, characters: S.characters }));
  if (undoStack.length > 60) undoStack.shift();
  $('#btn-undo').disabled = false;
}

function undo() {
  const snap = undoStack.pop();
  if (!snap) return;
  const d = JSON.parse(snap);
  S.blocks = d.blocks;
  S.characters = d.characters;
  $('#btn-undo').disabled = !undoStack.length;
  markDirty();
  refreshAll();
  toast('元に戻しました');
}

// ============ トースト ============

let toastTimer;
function toast(msg, action, { error = false } = {}) {
  const t = $('#toast');
  t.innerHTML = '';
  t.classList.toggle('error', error);
  t.setAttribute('role', error ? 'alert' : 'status');
  if (error) t.append(h('span', { class: 'toast-icon', 'aria-hidden': 'true' }, '!'));
  t.append(h('span', {}, msg));
  if (action) t.append(h('button', { type: 'button', onclick: () => { t.hidden = true; action.fn(); } }, action.label));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 5000 : error ? 4000 : 2400);
}

const toastError = (msg) => toast(msg, null, { error: true });

// ============ シート ============

function openSheet(title, ...content) {
  $('#sheet-title').textContent = title;
  const body = $('#sheet-body');
  body.innerHTML = '';
  body.append(...content.filter(Boolean));
  $('#sheet').hidden = false;
  $('#sheet-backdrop').hidden = false;
}
function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheet-backdrop').hidden = true;
}

// ============ 画面切り替え ============

function setView(name) {
  view = name;
  safeStorage(() => localStorage.setItem('emgeki:view', name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.body.className = document.body.className.replace(/\bview-\S+/g, '').trim();
  document.body.classList.add(`view-${name}`);
  if (name === 'editor') renderEditor();
  if (name === 'characters') renderCharacters();
  if (name === 'cast') renderCast();
  if (name === 'check') renderCheck(false);
  if (name === 'preview') renderPreview();
  if (name === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

function refreshAll() {
  $('#title-input').value = S.title;
  applyEditorFont();
  setView(view);
}

// ============ エディタ ============

function chapterNumbers() {
  const map = new Map();
  let n = 0;
  for (const b of S.blocks) if (b.type === 'chapter') map.set(b.id, ++n);
  return map;
}

function nameContent(c) {
  if (!c) return '人物？';
  if (c.reading && hasKanji(c.name)) return h('ruby', {}, c.name, h('rt', {}, c.reading));
  return c.name;
}

function textArea(b, placeholder) {
  return h('textarea', { class: 'blk-text', rows: 1, placeholder, value: b.text, enterkeyhint: 'enter' });
}

function blockEl(b, chapNums) {
  const more = h('button', { class: 'blk-more', type: 'button', 'data-act': 'menu', 'aria-label': 'この段落のメニュー' }, '⋯');
  switch (b.type) {
    case 'dialogue': {
      const c = charById(b.charId);
      return h('div', { class: 'blk blk-dialogue', 'data-id': b.id, style: c ? `--c:${c.color}` : null },
        h('button', { class: 'blk-name' + (c ? '' : ' missing'), type: 'button', 'data-act': 'change-char', 'aria-label': '話す人物を変更' }, nameContent(c)),
        h('span', { class: 'q' }, '「'),
        textArea(b, 'セリフ'),
        h('span', { class: 'q q-end' }, '」'),
        more);
    }
    case 'direction':
      return h('div', { class: 'blk blk-direction', 'data-id': b.id, style: `--indent:${S.settings.directionIndent}` }, textArea(b, 'ト書き'), more);
    case 'situation':
      return h('div', { class: 'blk blk-situation', 'data-id': b.id }, textArea(b, 'シチュエーション（中央に配置）'), more);
    case 'chapter':
      return h('div', { class: 'blk blk-chapter', 'data-id': b.id },
        h('span', { class: 'chap-label' }, chapterLabel(chapNums.get(b.id), S.settings.chapterFormat)),
        h('input', { class: 'blk-text', type: 'text', placeholder: '章タイトル（任意）', value: b.text, enterkeyhint: 'done' }),
        more);
  }
  return h('div');
}

const supportsFieldSizing = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('field-sizing', 'content');
function autosize(ta) {
  if (supportsFieldSizing || ta.tagName !== 'TEXTAREA') return;
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
}

function renderEditor() {
  const ed = $('#editor');
  const chapNums = chapterNumbers();
  ed.innerHTML = '';
  for (const b of S.blocks) ed.append(blockEl(b, chapNums));
  $('#editor-empty').hidden = S.blocks.length > 0;
  requestAnimationFrame(() => $$('#editor textarea').forEach(autosize));
}

function focusBlock(id, { atEnd = true, select = null, scroll = true } = {}) {
  const el = $(`#editor [data-id="${id}"]`);
  if (!el) return;
  const field = el.querySelector('.blk-text');
  currentBlockId = id;
  if (!field) return;
  field.focus({ preventScroll: true });
  if (select) field.setSelectionRange(select[0], select[1]);
  else if (atEnd) field.setSelectionRange(field.value.length, field.value.length);
  if (scroll) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function currentBlock() {
  return S.blocks.find((b) => b.id === currentBlockId) || null;
}

// 段落の追加。今の段落が空なら種類を切り替える（例：シチュエーション → セリフで元に戻る）
function insertBlock(type, extra = {}) {
  pushUndo();
  const cur = currentBlock();
  let target;
  if (cur && cur.type !== 'chapter' && type !== 'chapter' && cur.text === '') {
    target = cur;
    target.type = type;
    if (type === 'dialogue') target.charId = extra.charId;
    else delete target.charId;
  } else {
    target = { id: uid(), type, text: '', ...extra };
    const idx = cur ? blockIndex(cur.id) + 1 : S.blocks.length;
    S.blocks.splice(idx, 0, target);
  }
  markDirty();
  renderEditor();
  focusBlock(target.id);
}

function deleteBlock(id, { focusPrev = false } = {}) {
  const i = blockIndex(id);
  if (i < 0) return;
  pushUndo();
  S.blocks.splice(i, 1);
  markDirty();
  renderEditor();
  const prev = S.blocks[i - 1] || S.blocks[0];
  if (focusPrev && prev) focusBlock(prev.id);
  else currentBlockId = prev ? prev.id : null;
}

function moveBlock(id, delta) {
  const i = blockIndex(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= S.blocks.length) return;
  pushUndo();
  const [b] = S.blocks.splice(i, 1);
  S.blocks.splice(j, 0, b);
  markDirty();
  renderEditor();
  focusBlock(id, { atEnd: false });
}

// 会話の流れから次に話しそうな人物を推測して並べる
function suggestedOrder() {
  const end = currentBlock() ? blockIndex(currentBlockId) : S.blocks.length - 1;
  const recent = [];
  for (let i = end; i >= 0 && recent.length < 2; i--) {
    const b = S.blocks[i];
    if (b.type === 'dialogue' && b.charId && !recent.includes(b.charId)) recent.push(b.charId);
  }
  const ids = S.characters.map((c) => c.id);
  const front = recent.length === 2 ? [recent[1], recent[0]] : recent;
  return { order: [...front, ...ids.filter((id) => !front.includes(id))], next: recent[1] || null };
}

function openCharPicker({ title, currentId, onPick }) {
  const { order, next } = suggestedOrder();
  const grid = h('div', { class: 'pick-grid' });
  for (const id of order) {
    const c = charById(id);
    if (!c) continue;
    grid.append(h('button', {
      class: 'pick' + (id === currentId ? ' current' : ''),
      type: 'button',
      style: `--c:${c.color}`,
      onclick: () => { closeSheet(); onPick(c.id); },
    },
    id === next ? h('span', { class: 'badge' }, '次はこの人？') : null,
    h('span', { class: 'nm' }, c.name),
    h('span', { class: 'rd' }, [c.reading, c.actor && `（${c.actor}）`].filter(Boolean).join(' ') || ' ')));
  }
  const input = h('input', { type: 'text', placeholder: '新しい人物の名前', enterkeyhint: 'done', autocomplete: 'off' });
  const add = (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const c = S.characters.find((x) => x.name === name) || addCharacter(name);
    closeSheet();
    onPick(c.id);
  };
  const form = h('form', { class: 'add-row', onsubmit: add }, input, h('button', { class: 'btn primary', type: 'submit' }, '追加して選ぶ'));
  openSheet(title,
    S.characters.length ? grid : h('p', { class: 'note' }, 'まだ人物がいません。名前を入力して追加してください。'),
    form);
  if (!S.characters.length) setTimeout(() => input.focus(), 50);
}

function openBlockMenu(id) {
  const b = S.blocks.find((x) => x.id === id);
  if (!b) return;
  const item = (label, fn, cls = '', sub = '') =>
    h('li', {}, h('button', { type: 'button', class: cls, onclick: () => { closeSheet(); fn(); } }, label, sub ? h('span', { class: 'sub' }, sub) : null));
  const toType = (type) => () => {
    if (type === 'dialogue') {
      openCharPicker({ title: '話す人物を選ぶ', onPick: (cid) => { pushUndo(); b.type = 'dialogue'; b.charId = cid; markDirty(); renderEditor(); focusBlock(b.id); } });
      return;
    }
    pushUndo();
    b.type = type;
    delete b.charId;
    markDirty();
    renderEditor();
    focusBlock(b.id);
  };
  const list = h('ul', { class: 'menu-list' },
    b.type === 'dialogue' ? item('話す人物を変える', () => changeChar(b.id)) : null,
    b.type !== 'dialogue' ? item('セリフにする', toType('dialogue')) : null,
    b.type !== 'direction' ? item('ト書きにする', toType('direction')) : null,
    b.type !== 'situation' ? item('シチュエーションにする', toType('situation')) : null,
    item('上へ移動', () => moveBlock(id, -1)),
    item('下へ移動', () => moveBlock(id, 1)),
    item('この上に段落を追加', () => {
      pushUndo();
      const nb = { id: uid(), type: 'direction', text: '' };
      S.blocks.splice(blockIndex(id), 0, nb);
      markDirty();
      renderEditor();
      focusBlock(nb.id);
      toast('ト書きを追加しました。下のボタンで種類を変えられます');
    }, '', '先頭に書き足すときに'),
    item('この段落を削除', () => {
      deleteBlock(id);
      toast('削除しました', { label: '元に戻す', fn: undo });
    }, 'danger'));
  openSheet('段落', list);
}

function changeChar(id) {
  const b = S.blocks.find((x) => x.id === id);
  if (!b) return;
  openCharPicker({
    title: '話す人物を変える',
    currentId: b.charId,
    onPick: (cid) => { pushUndo(); b.charId = cid; markDirty(); renderEditor(); focusBlock(b.id); },
  });
}

function bindEditor() {
  const ed = $('#editor');
  ed.addEventListener('input', (e) => {
    const field = e.target.closest('.blk-text');
    if (!field) return;
    const b = S.blocks.find((x) => x.id === field.closest('.blk').dataset.id);
    if (!b) return;
    b.text = field.value;
    autosize(field);
    markDirty();
  });
  ed.addEventListener('focusin', (e) => {
    const blk = e.target.closest('.blk');
    if (blk) currentBlockId = blk.dataset.id;
  });
  ed.addEventListener('keydown', (e) => {
    const field = e.target.closest('.blk-text');
    if (!field) return;
    const id = field.closest('.blk').dataset.id;
    // 空の段落で Backspace → 段落を消して前の段落へ
    if (e.key === 'Backspace' && field.value === '' && !e.isComposing) {
      e.preventDefault();
      deleteBlock(id, { focusPrev: true });
    }
    // 章タイトルで Enter → 次にト書きを追加
    if (e.key === 'Enter' && field.tagName === 'INPUT' && !e.isComposing) {
      e.preventDefault();
      field.blur();
    }
  });
  ed.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.blk').dataset.id;
    currentBlockId = id;
    if (btn.dataset.act === 'change-char') changeChar(id);
    if (btn.dataset.act === 'menu') openBlockMenu(id);
  });

  // 挿入バー：ボタンを押してもキーボードが閉じないように
  const bar = $('#insertbar');
  const keepFocus = (e) => { if (e.target.closest('button')) e.preventDefault(); };
  bar.addEventListener('pointerdown', keepFocus);
  bar.addEventListener('mousedown', keepFocus);
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-insert]');
    if (!btn) return;
    const type = btn.dataset.insert;
    if (type === 'dialogue') {
      document.activeElement?.blur?.();
      openCharPicker({ title: '話す人物を選ぶ', onPick: (cid) => insertBlock('dialogue', { charId: cid }) });
    } else {
      insertBlock(type);
    }
  });

  // キーボードが開いている間はタブバーを隠し、挿入バーをキーボードの真上に出す
  const vv = window.visualViewport;
  let baseH = 0;
  let baseW = window.innerWidth;
  const onVV = () => {
    if (window.innerWidth !== baseW) { baseW = window.innerWidth; baseH = 0; } // 画面の回転
    const vh = vv ? vv.height : window.innerHeight;
    baseH = Math.max(baseH, vh);
    const typing = !!document.activeElement?.matches?.('input, textarea, select');
    const open = typing && vh < baseH * 0.8;
    const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    document.documentElement.style.setProperty('--kb', `${open ? kb : 0}px`);
    document.body.classList.toggle('kb-open', open);
  };
  vv?.addEventListener('resize', onVV);
  vv?.addEventListener('scroll', onVV);
  window.addEventListener('resize', onVV);
  document.addEventListener('focusin', () => setTimeout(onVV, 50));
  document.addEventListener('focusout', () => setTimeout(onVV, 50));
}

function applyEditorFont() {
  ensureFont(S.settings.font);
  document.documentElement.style.setProperty('--editor-font', fontCss(S.settings.font));
}

// ============ 登場人物 ============

function nextColor() {
  const used = new Set(S.characters.map((c) => c.color));
  return store.CHAR_COLORS.find((c) => !used.has(c)) || store.CHAR_COLORS[S.characters.length % store.CHAR_COLORS.length];
}

function addCharacter(name) {
  pushUndo();
  const c = { id: uid(), name, reading: '', readingAuto: true, actor: '', color: nextColor() };
  S.characters.push(c);
  markDirty();
  autoReading(c);
  return c;
}

function setDictStatus(text) {
  const el = $('#dict-status');
  el.hidden = !text;
  el.textContent = text || '';
}

function autoReading(c, force = false) {
  if (!S.settings.autoReading && !force) return;
  if (!hasKanji(c.name)) {
    c.reading = '';
    c.readingIncomplete = false;
    return;
  }
  const name = c.name;
  const script = S;
  if (!isTokenizerRequested()) setDictStatus('読み仮名の辞書を読み込んでいます…（初回のみ）');
  getReading(name).then((r) => {
    setDictStatus('');
    if (S !== script || c.name !== name || !S.characters.includes(c)) return;
    c.reading = r.reading;
    c.readingAuto = true;
    c.readingIncomplete = !r.complete;
    markDirty();
    if (view === 'characters') renderCharacters();
    if (view === 'editor') updateEditorNames();
    if (view === 'cast') renderCast();
  }).catch(() => {
    setDictStatus('辞書を読み込めませんでした。読み仮名は手で入力してください。');
  });
}

// 入力中のフォーカスを崩さずに、セリフの名前表示だけ更新
function updateEditorNames() {
  $$('#editor .blk-dialogue').forEach((el) => {
    const b = S.blocks.find((x) => x.id === el.dataset.id);
    const c = b && charById(b.charId);
    const btn = el.querySelector('.blk-name');
    btn.innerHTML = '';
    btn.append(nameContent(c));
  });
}

function lineCount(charId) {
  return S.blocks.filter((b) => b.type === 'dialogue' && b.charId === charId).length;
}

function renameCharacter(c, newName) {
  const old = c.name;
  if (!newName || newName === old) return false;
  pushUndo();
  c.name = newName;
  const hits = S.blocks.reduce((n, b) => n + countOccurrences(b.text, old), 0);
  if (hits > 0 && confirm(`本文（セリフ・ト書き）の中の「${old}」${hits}箇所も「${newName}」に置き換えますか？`)) {
    for (const b of S.blocks) b.text = b.text.split(old).join(newName);
  }
  if (c.readingAuto) autoReading(c);
  markDirty();
  toast(`「${old}」を「${newName}」に変更しました`);
  return true;
}

function deleteCharacter(c) {
  const n = lineCount(c.id);
  const msg = n ? `「${c.name}」のセリフが${n}個あります。削除すると、それらのセリフは「人物？」になります。削除しますか？` : `「${c.name}」を削除しますか？`;
  if (!confirm(msg)) return;
  pushUndo();
  S.characters = S.characters.filter((x) => x !== c);
  markDirty();
  renderCharacters();
  toast('削除しました', { label: '元に戻す', fn: undo });
}

function renderCharacters() {
  const list = $('#char-list');
  list.innerHTML = '';
  if (!S.characters.length) {
    list.append(h('li', { class: 'note' }, 'まだ登場人物がいません。上の欄から追加するか、脚本画面の「セリフ」ボタンからでも追加できます。'));
  }
  S.characters.forEach((c, i) => {
    const nameIn = h('input', { class: 'name-input grow', type: 'text', value: c.name, 'aria-label': '名前', enterkeyhint: 'done' });
    nameIn.addEventListener('change', () => {
      const v = nameIn.value.trim();
      if (!v) { nameIn.value = c.name; return; }
      if (S.characters.some((x) => x !== c && x.name === v)) { toast('同じ名前の人物がすでにいます'); nameIn.value = c.name; return; }
      if (renameCharacter(c, v)) renderCharacters();
    });
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) nameIn.blur(); });
    const readIn = h('input', { class: 'grow', type: 'text', value: c.reading, placeholder: hasKanji(c.name) ? 'よみがな' : '（漢字が無いので不要）', 'aria-label': '読み仮名' });
    readIn.addEventListener('input', () => { c.reading = readIn.value.trim(); c.readingAuto = false; c.readingIncomplete = false; markDirty(); });
    const dot = h('button', { class: 'color-dot', type: 'button', style: `--c:${c.color}`, 'aria-label': '色を変える', onclick: () => {
      const k = store.CHAR_COLORS.indexOf(c.color);
      c.color = store.CHAR_COLORS[(k + 1) % store.CHAR_COLORS.length];
      markDirty();
      dot.style.setProperty('--c', c.color);
    } });
    list.append(h('li', { class: 'card' },
      h('div', { class: 'card-row' }, dot, nameIn,
        h('button', { class: 'mini-btn', type: 'button', 'aria-label': '上へ', disabled: i === 0, onclick: () => moveChar(i, -1) }, '↑'),
        h('button', { class: 'mini-btn', type: 'button', 'aria-label': '下へ', disabled: i === S.characters.length - 1, onclick: () => moveChar(i, 1) }, '↓')),
      h('div', { class: 'card-row' }, h('span', { class: 'lbl' }, 'よみ'), readIn,
        h('button', { class: 'mini-btn', type: 'button', onclick: () => autoReadingButton(c) }, '自動')),
      c.readingIncomplete ? h('div', { class: 'card-row warn-text' }, '一部の漢字が読めませんでした。読みを確認してください。') : null,
      h('div', { class: 'card-row' },
        h('span', { class: 'meta grow' }, `セリフ ${lineCount(c.id)}個`, c.actor ? ` ・ 配役：${c.actor}` : ''),
        h('button', { class: 'mini-btn danger', type: 'button', onclick: () => deleteCharacter(c) }, '削除'))));
  });
}

function autoReadingButton(c) {
  if (!hasKanji(c.name)) {
    const kind = /^[\u3041-\u309F\u30FC\s・]+$/.test(c.name) ? 'ひらがな' : '漢字を含まない名前';
    toastError(`「${c.name}」は${kind}なので、読み仮名は付けられません`);
    return;
  }
  c.readingAuto = true;
  autoReading(c, true);
  toast('読み仮名を取得しています…');
}

function moveChar(i, d) {
  const j = i + d;
  if (j < 0 || j >= S.characters.length) return;
  pushUndo();
  const [c] = S.characters.splice(i, 1);
  S.characters.splice(j, 0, c);
  markDirty();
  renderCharacters();
}

// ============ 配役 ============

function renderCast() {
  const list = $('#cast-list');
  list.innerHTML = '';
  const actors = [...new Set(S.characters.map((c) => c.actor.trim()).filter(Boolean))];
  const dl = h('datalist', { id: 'actor-options' }, actors.map((a) => h('option', { value: a })));
  list.append(dl);
  if (!S.characters.length) list.append(h('li', { class: 'note' }, '先に「人物」タブで登場人物を追加してください。'));
  for (const c of S.characters) {
    const input = h('input', { class: 'grow', type: 'text', value: c.actor, placeholder: '演じる人の名前', list: 'actor-options', 'aria-label': `${c.name}の演者`, enterkeyhint: 'done' });
    input.addEventListener('input', () => { c.actor = input.value; markDirty(); });
    input.addEventListener('change', () => renderActorSummary());
    list.append(h('li', { class: 'card' },
      h('div', { class: 'card-row' },
        h('span', { class: 'cast-role', style: `--c:${c.color}` }, nameContent(c)),
        h('span', { class: 'meta' }, '演者'),
        input)));
  }
  renderActorSummary();
  syncSettingInputs();
}

function renderActorSummary() {
  const box = $('#actor-summary');
  box.innerHTML = '';
  const byActor = new Map();
  for (const c of S.characters) {
    const a = c.actor.trim() || '（未定）';
    if (!byActor.has(a)) byActor.set(a, []);
    byActor.get(a).push(c);
  }
  if (!byActor.size) { box.append(h('p', { class: 'note' }, 'まだ配役がありません。')); return; }
  const chapters = chapterOfBlocks();
  const rows = [...byActor.entries()].map(([a, cs]) => {
    const lines = cs.reduce((n, c) => n + lineCount(c.id), 0);
    const chs = new Set();
    for (const b of S.blocks) if (b.type === 'dialogue' && cs.some((c) => c.id === b.charId)) chs.add(chapters.get(b.id));
    const chText = [...chs].filter((x) => x > 0).map((n) => chapterLabel(n, S.settings.chapterFormat)).join('・');
    return h('tr', {}, h('td', {}, h('b', {}, a)), h('td', {}, cs.map((c) => c.name).join('、')), h('td', {}, `${lines}`), h('td', {}, chText || '—'));
  });
  box.append(h('table', { class: 'actor-table' },
    h('thead', {}, h('tr', {}, h('th', {}, '演者'), h('th', {}, '役'), h('th', {}, 'セリフ数'), h('th', {}, '出番の章'))),
    h('tbody', {}, rows)));
}

function chapterOfBlocks() {
  const map = new Map();
  let n = 0;
  for (const b of S.blocks) { if (b.type === 'chapter') n++; map.set(b.id, n); }
  return map;
}

// ============ 校正 ============

let checkTokenizer = null;

// 文法的なチェックには辞書が要るので、読み込んでから全体を調べる
async function startCheck() {
  const btn = $('#btn-run-check');
  if (!checkTokenizer) {
    btn.disabled = true;
    $('#check-summary').textContent = '辞書を準備しています…（初回は少し時間がかかります）';
    try {
      checkTokenizer = await loadTokenizer();
    } catch {
      toastError('辞書を読み込めなかったため、簡易チェックのみ行います');
    }
    btn.disabled = false;
  }
  renderCheck(true);
}

function renderCheck(run) {
  const list = $('#check-list');
  const sum = $('#check-summary');
  $('#btn-clear-ignored').hidden = !S.ignored.length;
  if (!run && !lastIssues.length) {
    list.innerHTML = '';
    sum.textContent = S.blocks.length ? '「チェックする」を押すと、脚本全体を調べます。' : '脚本がまだ空です。';
    $('#btn-fix-all').hidden = true;
    return;
  }
  lastIssues = runCheck(S, checkTokenizer);
  list.innerHTML = '';
  const fixable = lastIssues.filter((x) => x.suggestion != null && x.level !== 'info');
  $('#btn-fix-all').hidden = !fixable.length;
  $('#btn-fix-all').textContent = `まとめて修正（${fixable.length}件）`;
  if (!lastIssues.length) {
    sum.textContent = '問題は見つかりませんでした。';
    return;
  }
  const counts = { error: 0, warn: 0, info: 0 };
  lastIssues.forEach((x) => counts[x.level]++);
  sum.textContent = `${lastIssues.length}件：誤字 ${counts.error}・要確認 ${counts.warn}・参考 ${counts.info}`;
  const LV = { error: '誤字', warn: '要確認', info: '参考' };
  for (const is of lastIssues) {
    const b = S.blocks.find((x) => x.id === is.blockId);
    const who = b?.type === 'dialogue' ? (charById(b.charId)?.name || '人物？') : { direction: 'ト書き', situation: 'シチュエーション', chapter: '章' }[b?.type];
    list.append(h('li', { class: 'check-item' },
      h('div', { class: 'msg' }, h('span', { class: `lv lv-${is.level}` }, LV[is.level]), is.message),
      h('div', { class: 'ctx' }, h('span', { class: 'who' }, `${who}：`), is.context.before, is.end > is.start ? h('mark', {}, is.context.hit) : null, is.context.after),
      h('div', { class: 'acts' },
        is.suggestion != null ? h('button', { class: 'btn small primary', type: 'button', onclick: () => fixOne(is) }, is.suggestion === '' ? '削除する' : `「${is.suggestion}」に直す`) : null,
        is.rule === 'same-speaker' && charById(is.altCharId) ? h('button', { class: 'btn small primary', type: 'button', onclick: () => setSpeaker(is.blockId, is.altCharId) }, `「${charById(is.altCharId).name}」に変える`) : null,
        is.rule === 'same-speaker' ? h('button', { class: 'btn small', type: 'button', onclick: () => openCharPicker({ title: '話す人物を選ぶ', currentId: b.charId, onPick: (cid) => setSpeaker(is.blockId, cid) }) }, '人物を選ぶ') : null,
        h('button', { class: 'btn small', type: 'button', onclick: () => jumpTo(is) }, '本文へ'),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => ignoreIssue(is) }, '無視'))));
  }
}

function setSpeaker(blockId, charId) {
  const b = S.blocks.find((x) => x.id === blockId);
  if (!b) return;
  pushUndo();
  b.charId = charId;
  markDirty();
  toast(`「${charById(charId)?.name}」に変えました`, { label: '元に戻す', fn: () => { undo(); renderCheck(true); } });
  renderCheck(true);
}

function fixOne(is) {
  pushUndo();
  if (applyFix(S, is)) { markDirty(); toast('修正しました', { label: '元に戻す', fn: () => { undo(); renderCheck(true); } }); }
  else toast('本文が変わっているため修正できませんでした');
  renderCheck(true);
}

function ignoreIssue(is) {
  S.ignored.push(is.ignoreKey);
  markDirty();
  renderCheck(true);
}

function jumpTo(is) {
  setView('editor');
  requestAnimationFrame(() => {
    focusBlock(is.blockId, { select: [is.start, is.end], scroll: false });
    const el = $(`#editor [data-id="${is.blockId}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1500);
  });
}

// ============ プレビュー・印刷 ============

let previewToken = 0;
async function renderPreview() {
  const token = ++previewToken;
  updateSegButtons();
  updatePageStyle();
  const container = $('#pages');
  if (!container.children.length) container.append(h('p', { class: 'note' }, 'ページを作っています…'));
  await ensureFont(S.settings.font);
  if (token !== previewToken) return;
  buildPages();
}

function buildPages() {
  const measure = $('#measure');
  const pages = renderPages(S, measure);
  const container = $('#pages');
  container.innerHTML = '';
  const { w, h: ph } = pageSizePx(S.settings.orientation);
  const avail = Math.min(container.clientWidth || window.innerWidth, 760) - 20;
  const scale = Math.min(1, avail / w);
  for (const p of pages) {
    const wrap = h('div', { class: 'page-wrap', style: { width: `${w * scale}px`, height: `${ph * scale}px` } });
    p.style.transform = `scale(${scale})`;
    wrap.append(p);
    container.append(wrap);
  }
  measure.innerHTML = '';
  $('#page-count').textContent = `全${pages.length}ページ`;
}

function updatePageStyle() {
  $('#page-style').textContent = `@page { size: A4 ${S.settings.orientation}; margin: 0; }`;
}

function updateSegButtons() {
  $$('[data-seg]').forEach((b) => b.classList.toggle('on', S.settings[b.dataset.seg] === b.dataset.value));
}

async function printNow() {
  flush();
  await renderPreview();
  setTimeout(() => window.print(), 60);
}

window.addEventListener('beforeprint', () => {
  updatePageStyle();
  if (view !== 'preview') buildPages();
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (view === 'preview') buildPages(); }, 250);
});

// ============ 設定 ============

function syncSettingInputs() {
  $$('[data-setting]').forEach((el) => {
    const v = S.settings[el.dataset.setting];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = String(v);
  });
}

function renderSettings() {
  $('#set-title').value = S.title;
  $('#set-author').value = S.author;
  syncSettingInputs();
  updateFontSample();
}

function updateFontSample() {
  const s = $('#font-sample');
  s.style.fontFamily = fontCss(S.settings.font);
  ensureFont(S.settings.font);
}

function bindSettings() {
  const sel = $('#font-select');
  for (const f of FONTS) sel.append(h('option', { value: f.id }, f.label));

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-setting]');
    if (!el) return;
    const key = el.dataset.setting;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.type === 'number') v = Number(v);
    S.settings[key] = v;
    markDirty();
    syncSettingInputs();
    if (key === 'font') { applyEditorFont(); updateFontSample(); }
    if (key === 'autoReading' && v) S.characters.filter((c) => c.readingAuto && !c.reading).forEach((c) => autoReading(c));
  });

  $('#set-title').addEventListener('input', (e) => { S.title = e.target.value; $('#title-input').value = S.title; markDirty(); });
  $('#set-author').addEventListener('input', (e) => { S.author = e.target.value; markDirty(); });

  $$('[data-seg]').forEach((b) => b.addEventListener('click', () => {
    S.settings[b.dataset.seg] = b.dataset.value;
    markDirty();
    renderPreview();
  }));

  $('#btn-export').addEventListener('click', exportJson);
  $('#btn-export-txt').addEventListener('click', exportText);
  $('#btn-export-docx').addEventListener('click', exportDocx);
  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', importJson);
}

function download(filename, text, type) {
  saveFile(filename, text instanceof Blob ? text : new Blob([text], { type }));
}

// iPhone は共有シートから「ファイルに保存」できるようにし、それ以外は普通にダウンロード
function saveFile(filename, blob) {
  if (isIOS() && navigator.canShare) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).catch((e) => { if (e.name !== 'AbortError') downloadBlob(filename, blob); });
      return;
    }
  }
  downloadBlob(filename, blob);
}

function downloadBlob(filename, blob) {
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast(`「${filename}」を保存しました`);
}

const fileBase = () => (S.title || '脚本').replace(/[\\/:*?"<>|]/g, '_');

function exportJson() {
  flush();
  download(`${fileBase()}.emgeki.json`, JSON.stringify(S, null, 2), 'application/json');
}

function exportText() {
  flush();
  download(`${fileBase()}.txt`, scriptToText(S), 'text/plain;charset=utf-8');
}

function exportDocx() {
  flush();
  download(`${fileBase()}.docx`, scriptToDocx(S));
}

function importJson(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  file.text().then((text) => {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.blocks)) throw new Error('形式が違います');
    const s = store.normalize({ ...data, id: uid() });
    flush();
    S = s;
    store.saveScript(S);
    undoStack = [];
    lastIssues = [];
    refreshAll();
    toast(`「${S.title}」を読み込みました`);
  }).catch(() => toast('読み込めませんでした（このアプリのバックアップファイルを選んでください）'));
}

// ============ 脚本の一覧 ============

function openScriptList() {
  flush();
  const list = h('ul', { class: 'menu-list' });
  for (const meta of store.listScripts()) {
    const isCur = meta.id === S.id;
    list.append(h('li', {}, h('button', {
      type: 'button',
      class: 'script-item' + (isCur ? ' current' : ''),
      onclick: () => { closeSheet(); if (!isCur) openScript(meta.id); },
    }, meta.title || '無題', h('span', { class: 'sub' }, formatDate(meta.updatedAt)))));
  }
  const actions = h('div', { class: 'row-btns wrap' },
    h('button', { class: 'btn primary', type: 'button', onclick: () => { closeSheet(); createScript(); } }, '＋ 新しい脚本'),
    h('button', { class: 'btn', type: 'button', onclick: () => { closeSheet(); duplicateScript(); } }, '複製'),
    h('button', { class: 'btn danger', type: 'button', onclick: () => { closeSheet(); removeScript(); } }, 'この脚本を削除'));
  const exportRow = h('div', { class: 'row-btns wrap' },
    h('button', { class: 'btn', type: 'button', onclick: () => { closeSheet(); exportText(); } }, 'テキスト（.txt）'),
    h('button', { class: 'btn', type: 'button', onclick: () => { closeSheet(); exportDocx(); } }, 'Word（.docx）'));
  openSheet('脚本の一覧', actions, h('p', { class: 'sheet-label' }, 'この脚本をファイルに保存'), exportRow, h('p', { class: 'sheet-label' }, '脚本を切り替える'), list);
}

function openScript(id) {
  const s = store.loadScript(id);
  if (!s) { toast('開けませんでした'); return; }
  S = s;
  store.saveScript(S);
  undoStack = [];
  lastIssues = [];
  currentBlockId = null;
  $('#btn-undo').disabled = true;
  refreshAll();
}

function createScript() {
  flush();
  S = store.newScript();
  store.saveScript(S);
  undoStack = [];
  lastIssues = [];
  currentBlockId = null;
  $('#btn-undo').disabled = true;
  setView('editor');
  $('#title-input').value = '';
  $('#title-input').focus();
}

function duplicateScript() {
  flush();
  const copy = store.normalize(JSON.parse(JSON.stringify(S)));
  copy.id = uid();
  copy.title = `${S.title}（コピー）`;
  copy.createdAt = Date.now();
  store.saveScript(copy);
  openScript(copy.id);
  toast('複製しました');
}

function removeScript() {
  if (!confirm(`「${S.title}」を削除します。元に戻せません。よろしいですか？`)) return;
  store.deleteScript(S.id);
  const next = store.listScripts()[0];
  if (next) openScript(next.id);
  else createScript();
  toast('削除しました');
}

// ============ ホーム画面に追加 ============

let installPrompt = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function updateInstallButton() {
  $('#btn-install').hidden = isStandalone();
}

const SHARE_ICON = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.innerHTML = '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5v10h14V11h-1"/>';
  return svg;
};

async function installApp() {
  // Android の Chrome などはそのまま追加の確認画面を出せる
  if (installPrompt) {
    const p = installPrompt;
    installPrompt = null;
    p.prompt();
    await p.userChoice.catch(() => null);
    return;
  }
  const key = (...c) => h('span', { class: 'key' }, ...c);
  let steps;
  if (isIOS()) {
    steps = [
      h('li', {}, 'Safari で開いた状態で、画面下（iPadは右上）の共有ボタン ', key(SHARE_ICON()), ' を押します。'),
      h('li', {}, 'メニューを下へスクロールして ', key('ホーム画面に追加'), ' を押します。'),
      h('li', {}, '右上の ', key('追加'), ' を押すと、ホーム画面にアイコンができます。'),
    ];
  } else {
    steps = [
      h('li', {}, 'ブラウザ右上のメニュー ', key('⋮'), ' を開きます。'),
      h('li', {}, key('ホーム画面に追加'), ' または ', key('アプリをインストール'), ' を押します。'),
      h('li', {}, '確認画面で ', key('追加'), '（または ', key('インストール'), '）を押します。'),
    ];
  }
  openSheet('ホーム画面に追加',
    h('p', { class: 'note' }, 'ホーム画面から開くと、アプリのように全画面で使え、電波がなくても書けます。'),
    h('ol', { class: 'install-steps' }, steps),
    isIOS() ? h('p', { class: 'note' }, 'Chrome など Safari 以外で開いている場合も、共有ボタンから同じように追加できます（iOS 16.4 以降）。') : null);
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  updateInstallButton();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  updateInstallButton();
  toast('ホーム画面に追加しました');
});

// ============ 起動 ============

function init() {
  S = store.loadCurrent();
  if (!S) {
    S = store.newScript();
    try { store.saveScript(S); } catch { /* 保存不可でも編集は続けられる */ }
  }
  $('#title-input').value = S.title;
  $('#title-input').addEventListener('input', (e) => { S.title = e.target.value; markDirty(); });
  $('#title-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) e.target.blur(); });
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-install').addEventListener('click', installApp);
  updateInstallButton();
  $('#btn-scripts').addEventListener('click', openScriptList);
  $('#sheet-close').addEventListener('click', closeSheet);
  $('#sheet-backdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  $$('.tabbar button').forEach((b) => b.addEventListener('click', () => { flush(); setView(b.dataset.tab); }));

  $('#add-char-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#add-char-name');
    const name = input.value.trim();
    if (!name) return;
    if (S.characters.some((c) => c.name === name)) { toast('同じ名前の人物がすでにいます'); return; }
    addCharacter(name);
    input.value = '';
    renderCharacters();
  });

  $('#btn-run-check').addEventListener('click', startCheck);
  $('#btn-fix-all').addEventListener('click', () => {
    pushUndo();
    const n = applyAll(S, lastIssues.filter((x) => x.level !== 'info'));
    markDirty();
    renderCheck(true);
    toast(`${n}件を修正しました`, { label: '元に戻す', fn: () => { undo(); renderCheck(true); } });
  });
  $('#btn-clear-ignored').addEventListener('click', () => { S.ignored = []; markDirty(); renderCheck(true); });
  $('#btn-print').addEventListener('click', printNow);
  $('#btn-cast-preview').addEventListener('click', () => {
    if (!S.settings.printCastPage) { S.settings.printCastPage = true; markDirty(); }
    setView('preview');
  });

  bindEditor();
  bindSettings();
  applyEditorFont();
  const saved = safeStorage(() => localStorage.getItem('emgeki:view'), null);
  setView(saved && $(`.view[data-view="${saved}"]`) ? saved : 'editor');

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
