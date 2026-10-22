// 演劇脚本ノート — 画面とデータのつなぎ込み
import * as store from './store.js';
import { renderPages, pageSizePx } from './paginate.js';
import { getReading, isTokenizerRequested, loadTokenizer } from './furigana.js';
import { runCheck, applyFix, applyAll } from './proofread.js';
import { FONTS, fontCss, ensureFont } from './fonts.js';
import { scriptToText, scriptToDocx } from './export.js';
import { savePdf, getPdf, deletePdf, listPdfs } from './pdfstore.js';
import { openPdf, extractPages } from './pdfjs.js';
import { parsePages } from './pdfparse.js';
import { parseScriptLines, textToLines, docxToLines } from './textparse.js';
import { ALL_ID, GROUP_KINDS, speakerIds, setSpeakers, speakersOf, speakerLabel, inCastList } from './speakers.js';
import { $, $$, h, uid, hasKanji, chapterLabel, countOccurrences, formatDate, safeStorage } from './util.js';

let S = null;            // 編集中の脚本
let currentBlockId = null;
let view = 'editor';
let undoStack = [];
let dirty = false;
let saveTimer = null;
let lastIssues = [];
let extraEditing = null; // メモ・指示を追加したばかりで、まだ空の欄 { id, kind }

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

const charMap = () => new Map(S.characters.map((c) => [c.id, c]));

// セリフの話者の表示（複数なら「・」でつなぐ）
function speakerContent(b) {
  const list = speakersOf(b, charMap());
  if (!list.length) return ['人物？'];
  return list.flatMap((sp, i) => [i ? '・' : null, sp.c ? nameContent(sp.c) : sp.name]).filter(Boolean);
}

// メモ・演技の指示の欄（中身があるか、追加したばかりのときだけ出す）
const EXTRA = {
  memo: { label: 'メモ', placeholder: 'メモ（例：ここで客席を見る）' },
  note: { label: '指示', placeholder: '演技の指示（例：怒りをこらえて／スポットライトで照らす）' },
};
function extraFields(b) {
  return ['memo', 'note'].map((kind) => {
    const editing = extraEditing && extraEditing.id === b.id && extraEditing.kind === kind;
    if (!b[kind] && !editing) return null;
    return h('div', { class: `blk-sub sub-${kind}` },
      h('span', { class: 'sub-label' }, EXTRA[kind].label),
      h('textarea', { class: 'blk-extra', rows: 1, placeholder: EXTRA[kind].placeholder, value: b[kind] || '', 'aria-label': EXTRA[kind].label, dataset: { kind } }));
  });
}

function textArea(b, placeholder) {
  return h('textarea', { class: 'blk-text', rows: 1, placeholder, value: b.text, enterkeyhint: 'enter' });
}

function blockEl(b, chapNums) {
  const more = h('button', { class: 'blk-more', type: 'button', 'data-act': 'menu', 'aria-label': 'この段落のメニュー' }, '⋯');
  switch (b.type) {
    case 'dialogue': {
      const sps = speakersOf(b, charMap());
      const first = sps[0]?.c;
      const missing = !sps.length || sps.some((sp) => sp.id !== ALL_ID && !sp.c);
      return h('div', { class: 'blk blk-dialogue', 'data-id': b.id, style: first ? `--c:${first.color}` : null },
        h('button', { class: 'blk-name' + (missing ? ' missing' : ''), type: 'button', 'data-act': 'change-char', 'aria-label': '話す人物を変更' }, speakerContent(b)),
        h('span', { class: 'q' }, '「'),
        textArea(b, 'セリフ'),
        h('span', { class: 'q q-end' }, '」'),
        extraFields(b),
        more);
    }
    case 'direction':
      return h('div', { class: 'blk blk-direction', 'data-id': b.id, style: `--indent:${S.settings.directionIndent}` }, textArea(b, 'ト書き'), extraFields(b), more);
    case 'situation':
      return h('div', { class: 'blk blk-situation', 'data-id': b.id }, textArea(b, 'シチュエーション（中央に配置）'), extraFields(b), more);
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
  if (ta.closest('.editor.vertical')) {
    ta.style.width = '0';
    ta.style.width = `${ta.scrollWidth}px`;
  } else {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }
}

function renderEditor() {
  const ed = $('#editor');
  const vertical = S.settings.editorWritingMode === 'vertical';
  ed.classList.toggle('vertical', vertical);
  document.body.classList.toggle('ed-vertical', vertical);
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
  if (scroll) {
    // 縦書きでは、書いている列を画面の右寄せに持ってくる
    if (S.settings.editorWritingMode === 'vertical') el.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'smooth' });
    else el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
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
    if (type === 'dialogue') setSpeakers(target, extra.ids || []);
    else { delete target.charId; delete target.charIds; }
  } else {
    target = { id: uid(), type, text: '' };
    if (type === 'dialogue') setSpeakers(target, extra.ids || []);
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
    const ids = b.type === 'dialogue' ? speakerIds(b) : [];
    if (ids.length === 1 && ids[0] !== ALL_ID && !recent.includes(ids[0])) recent.push(ids[0]);
  }
  const ids = S.characters.map((c) => c.id);
  const front = recent.length === 2 ? [recent[1], recent[0]] : recent;
  return { order: [...front, ...ids.filter((id) => !front.includes(id))], next: recent[1] || null };
}

// モブ・脇役・群衆・煽りを作る（同じ名前があればそれを使う）
function groupCharacter(name, kind, inCast) {
  let c = S.characters.find((x) => x.name === name);
  if (!c) {
    c = addCharacter(name);
    c.kind = 'group';
    c.groupKind = kind;
  }
  if (c.kind === 'group') c.inCast = inCast;
  markDirty();
  return c;
}

// 話す人物を選ぶ。onPick には話者IDの配列を渡す（1人・複数人・全員・モブなど）
function openCharPicker({ title, current = [], onPick }) {
  const { order, next } = suggestedOrder();
  const pick = (ids) => { closeSheet(); onPick(ids); };
  const body = h('div');
  let multi = false;
  const chosen = new Set();

  function render() {
    body.innerHTML = '';
    const grid = h('div', { class: 'pick-grid' });
    for (const id of order) {
      const c = charById(id);
      if (!c) continue;
      const on = multi ? chosen.has(id) : current.length === 1 && current[0] === id;
      grid.append(h('button', {
        class: 'pick' + (on ? ' current' : ''),
        type: 'button',
        style: `--c:${c.color}`,
        'aria-pressed': multi ? String(on) : null,
        onclick: () => {
          if (!multi) { pick([c.id]); return; }
          if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
          render();
        },
      },
      multi ? h('span', { class: 'check' }, on ? '✓' : '') : null,
      !multi && id === next ? h('span', { class: 'badge' }, '次はこの人？') : null,
      h('span', { class: 'nm' }, c.name),
      h('span', { class: 'rd' }, [c.kind === 'group' ? (c.groupKind || 'モブ') : c.reading, c.actor && `（${c.actor}）`].filter(Boolean).join(' ') || ' ')));
    }

    if (multi) {
      body.append(
        h('p', { class: 'note' }, '同時に話す人物をすべて選んでください。'),
        S.characters.length ? grid : h('p', { class: 'note' }, 'まだ人物がいません。'),
        h('div', { class: 'row-btns' },
          h('button', { class: 'btn primary', type: 'button', disabled: chosen.size < 1, onclick: () => pick(order.filter((id) => chosen.has(id))) }, `決定（${chosen.size}人）`),
          h('button', { class: 'btn', type: 'button', onclick: () => { multi = false; chosen.clear(); render(); } }, 'やめる')));
      return;
    }

    const special = (label, fn, cls = '') => h('button', { class: `chip ${cls}`, type: 'button', onclick: fn }, label);
    body.append(
      S.characters.length ? grid : h('p', { class: 'note' }, 'まだ人物がいません。名前を入力して追加してください。'),
      h('div', { class: 'chip-row' },
        special('複数人を選ぶ', () => { multi = true; current.filter((id) => id !== ALL_ID).forEach((id) => chosen.add(id)); render(); }),
        special('全員', () => pick([ALL_ID])),
        GROUP_KINDS.map((kind) => special(kind, () => openGroupForm(kind), 'chip-group'))));

    const input = h('input', { type: 'text', placeholder: '新しい人物の名前', enterkeyhint: 'done', autocomplete: 'off' });
    body.append(h('form', {
      class: 'add-row',
      onsubmit: (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) { input.focus(); return; }
        const c = S.characters.find((x) => x.name === name) || addCharacter(name);
        pick([c.id]);
      },
    }, input, h('button', { class: 'btn primary', type: 'submit' }, '追加して選ぶ')));
  }

  // モブ・脇役・群衆・煽り：名前（例：村人A）と「配役に追加」を選ぶ
  function openGroupForm(kind) {
    body.innerHTML = '';
    const nameIn = h('input', { type: 'text', value: kind, placeholder: `${kind}の名前（例：${kind === '群衆' ? '村人たち' : `${kind}A`}）`, autocomplete: 'off' });
    const castCb = h('input', { type: 'checkbox' });
    const existing = S.characters.filter((c) => c.kind === 'group');
    body.append(
      h('p', { class: 'note' }, `「${kind}」のセリフにします。名前は自由に変えられます。`),
      h('label', { class: 'field' }, '名前', nameIn),
      h('label', { class: 'switch-row' }, castCb, '配役に追加（配役表・配役タブに出す）'),
      h('p', { class: 'note' }, 'チェックしない場合は、セリフにだけ使われ、配役表には出ません。'),
      h('div', { class: 'row-btns' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => {
          const name = nameIn.value.trim() || kind;
          pick([groupCharacter(name, kind, castCb.checked).id]);
        } }, '決定'),
        h('button', { class: 'btn', type: 'button', onclick: render }, '戻る')),
      ...(existing.length ? [h('p', { class: 'note' }, `作成済み：${existing.map((c) => c.name).join('、')}（同じ名前を入れるとそれを使います）`)] : []));
  }

  render();
  openSheet(title, body);
}

function openBlockMenu(id) {
  const b = S.blocks.find((x) => x.id === id);
  if (!b) return;
  const item = (label, fn, cls = '', sub = '') =>
    h('li', {}, h('button', { type: 'button', class: cls, onclick: () => { closeSheet(); fn(); } }, label, sub ? h('span', { class: 'sub' }, sub) : null));
  const toType = (type) => () => {
    if (type === 'dialogue') {
      openCharPicker({ title: '話す人物を選ぶ', onPick: (ids) => { pushUndo(); b.type = 'dialogue'; setSpeakers(b, ids); markDirty(); renderEditor(); focusBlock(b.id); } });
      return;
    }
    pushUndo();
    b.type = type;
    delete b.charId;
    delete b.charIds;
    markDirty();
    renderEditor();
    focusBlock(b.id);
  };
  const list = h('ul', { class: 'menu-list' },
    b.type === 'dialogue' ? item('話す人物を変える', () => changeChar(b.id)) : null,
    b.type !== 'chapter' && !b.note ? item('演技の指示を追加', () => addExtra(b.id, 'note'), '', '例：怒りをこらえて／スポットライトで照らす') : null,
    b.type !== 'chapter' && b.note ? item('演技の指示を消す', () => removeExtra(b, 'note')) : null,
    b.type !== 'chapter' && !b.memo ? item('メモを追加', () => addExtra(b.id, 'memo'), '', 'ページの上のメモ欄に入ります') : null,
    b.type !== 'chapter' && b.memo ? item('メモを消す', () => removeExtra(b, 'memo')) : null,
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

// メモ・演技の指示を追加。印刷にそのスペースが無ければ付ける
function addExtra(id, kind) {
  extraEditing = { id, kind };
  if (kind === 'note' && !S.settings.actingNotes) {
    S.settings.actingNotes = true;
    markDirty();
    toast('印刷に「演技の指示」のスペースを付けました（設定で変えられます）');
  }
  if (kind === 'memo' && S.settings.memoArea === 'none') {
    S.settings.memoArea = 'medium';
    markDirty();
    toast('印刷に「メモ」のスペースを付けました（設定で変えられます）');
  }
  renderEditor();
  const ta = $(`#editor [data-id="${id}"] .blk-extra[data-kind="${kind}"]`);
  if (ta) {
    ta.focus({ preventScroll: true });
    ta.closest('.blk').scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
}

function removeExtra(b, kind) {
  pushUndo();
  b[kind] = '';
  markDirty();
  renderEditor();
  toast(kind === 'note' ? '演技の指示を消しました' : 'メモを消しました', { label: '元に戻す', fn: undo });
}

function changeChar(id) {
  const b = S.blocks.find((x) => x.id === id);
  if (!b) return;
  openCharPicker({
    title: '話す人物を変える',
    current: speakerIds(b),
    onPick: (ids) => { pushUndo(); setSpeakers(b, ids); markDirty(); renderEditor(); focusBlock(b.id); },
  });
}

function bindEditor() {
  const ed = $('#editor');
  ed.addEventListener('input', (e) => {
    const extra = e.target.closest('.blk-extra');
    if (extra) {
      const nb = S.blocks.find((x) => x.id === extra.closest('.blk').dataset.id);
      if (nb) { nb[extra.dataset.kind] = extra.value; autosize(extra); markDirty(); }
      return;
    }
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
  // 空のまま離れた指示欄はしまう
  ed.addEventListener('focusout', (e) => {
    const extra = e.target.closest('.blk-extra');
    if (!extra || extra.value.trim()) return;
    const kind = extra.dataset.kind;
    const b = S.blocks.find((x) => x.id === extra.closest('.blk').dataset.id);
    if (b) b[kind] = '';
    if (extraEditing && extraEditing.id === b?.id && extraEditing.kind === kind) extraEditing = null;
    setTimeout(() => extra.closest('.blk-sub')?.remove(), 0);
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
      openCharPicker({ title: '話す人物を選ぶ', onPick: (ids) => insertBlock('dialogue', { ids }) });
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
    if (!b) return;
    const btn = el.querySelector('.blk-name');
    btn.innerHTML = '';
    btn.append(...speakerContent(b));
  });
}

function lineCount(charId) {
  return S.blocks.filter((b) => b.type === 'dialogue' && speakerIds(b).includes(charId)).length;
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
      c.kind === 'group' ? h('label', { class: 'card-row switch-row small-switch' },
        h('input', { type: 'checkbox', checked: !!c.inCast, onchange: (e) => { c.inCast = e.target.checked; markDirty(); } }),
        `${c.groupKind || 'モブ'}・配役に追加（配役表に出す）`) : null,
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
  const hidden = S.characters.filter((c) => !inCastList(c));
  for (const c of S.characters.filter(inCastList)) {
    const input = h('input', { class: 'grow', type: 'text', value: c.actor, placeholder: '演じる人の名前', list: 'actor-options', 'aria-label': `${c.name}の演者`, enterkeyhint: 'done' });
    input.addEventListener('input', () => { c.actor = input.value; markDirty(); });
    input.addEventListener('change', () => renderActorSummary());
    list.append(h('li', { class: 'card' },
      h('div', { class: 'card-row' },
        h('span', { class: 'cast-role', style: `--c:${c.color}` }, nameContent(c)),
        h('span', { class: 'meta' }, '演者'),
        input)));
  }
  if (hidden.length) {
    list.append(h('li', { class: 'note' }, `配役に出していない役：${hidden.map((c) => c.name).join('、')}（「人物」タブの「配役に追加」で出せます）`));
  }
  renderActorSummary();
  syncSettingInputs();
}

function renderActorSummary() {
  const box = $('#actor-summary');
  box.innerHTML = '';
  const byActor = new Map();
  for (const c of S.characters.filter(inCastList)) {
    const a = c.actor.trim() || '（未定）';
    if (!byActor.has(a)) byActor.set(a, []);
    byActor.get(a).push(c);
  }
  if (!byActor.size) { box.append(h('p', { class: 'note' }, 'まだ配役がありません。')); return; }
  const chapters = chapterOfBlocks();
  const rows = [...byActor.entries()].map(([a, cs]) => {
    const lines = cs.reduce((n, c) => n + lineCount(c.id), 0);
    const chs = new Set();
    for (const b of S.blocks) if (b.type === 'dialogue' && cs.some((c) => speakerIds(b).includes(c.id))) chs.add(chapters.get(b.id));
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
    const who = b?.type === 'dialogue' ? speakerLabel(b, charMap()) : { direction: 'ト書き', situation: 'シチュエーション', chapter: '章' }[b?.type];
    list.append(h('li', { class: 'check-item' },
      h('div', { class: 'msg' }, h('span', { class: `lv lv-${is.level}` }, LV[is.level]), is.message),
      h('div', { class: 'ctx' }, h('span', { class: 'who' }, `${who}：`), is.context.before, is.end > is.start ? h('mark', {}, is.context.hit) : null, is.context.after),
      h('div', { class: 'acts' },
        is.suggestion != null ? h('button', { class: 'btn small primary', type: 'button', onclick: () => fixOne(is) }, is.suggestion === '' ? '削除する' : `「${is.suggestion}」に直す`) : null,
        is.rule === 'same-speaker' && charById(is.altCharId) ? h('button', { class: 'btn small primary', type: 'button', onclick: () => setSpeaker(is.blockId, is.altCharId) }, `「${charById(is.altCharId).name}」に変える`) : null,
        is.rule === 'same-speaker' ? h('button', { class: 'btn small', type: 'button', onclick: () => openCharPicker({ title: '話す人物を選ぶ', current: speakerIds(b), onPick: (ids) => setSpeaker(is.blockId, ids) }) }, '人物を選ぶ') : null,
        h('button', { class: 'btn small', type: 'button', onclick: () => jumpTo(is) }, '本文へ'),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => ignoreIssue(is) }, '無視'))));
  }
}

function setSpeaker(blockId, ids) {
  const b = S.blocks.find((x) => x.id === blockId);
  if (!b) return;
  pushUndo();
  setSpeakers(b, Array.isArray(ids) ? ids : [ids]);
  markDirty();
  toast(`「${speakerLabel(b, charMap())}」に変えました`, { label: '元に戻す', fn: () => { undo(); renderCheck(true); } });
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
    if (key === 'editorWritingMode') toast(v === 'vertical' ? '脚本画面を縦書きにしました' : '脚本画面を横書きにしました');
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
  $$('[data-go-preview]').forEach((b) => b.addEventListener('click', () => setView('preview')));
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

function downloadBlob(filename, blob, { quiet = false } = {}) {
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  if (!quiet) toast(`「${filename}」を保存しました`);
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

// このアプリのデータ（バックアップ）なら読み込んで true。違う中身なら false
function tryImportAppData(text) {
  let data;
  try { data = JSON.parse(text); } catch { return false; }
  if (!data || !Array.isArray(data.blocks)) return false;
  openNewScript(store.normalize({ ...data, id: uid() }));
  toast(`「${S.title}」を読み込みました`);
  return true;
}

function openNewScript(s) {
  flush();
  S = s;
  try { store.saveScript(S); } catch { toastError('脚本を保存できませんでした（端末の空き容量を確認してください）'); }
  undoStack = [];
  lastIssues = [];
  currentBlockId = null;
  $('#btn-undo').disabled = true;
  refreshAll();
  setView('editor');
}

function importJson(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  file.text().then((text) => {
    if (!tryImportAppData(text)) throw new Error('形式が違います');
  }).catch(() => toastError('読み込めませんでした（このアプリのバックアップファイルを選んでください）'));
}

// ============ 脚本の一覧 ============

async function openScriptList() {
  flush();
  // PDFモードで読み込んだ脚本も、ふつうの脚本と一緒に並べる（開くとPDFで表示）
  let pdfs = [];
  try { pdfs = (await listPdfs()).filter((p) => !p.scriptId); } catch { /* PDF が読めなくても脚本の一覧は出す */ }
  const entries = [
    ...store.listScripts().map((m) => ({ kind: 'script', id: m.id, title: m.title, at: m.updatedAt })),
    ...pdfs.map((p) => ({ kind: 'pdf', id: p.id, title: p.name, at: p.addedAt, pages: p.pages })),
  ].sort((a, b) => b.at - a.at);
  const list = h('ul', { class: 'menu-list' });
  for (const e of entries) {
    const isCur = e.kind === 'script' && e.id === S.id;
    list.append(h('li', {}, h('button', {
      type: 'button',
      class: 'script-item' + (isCur ? ' current' : ''),
      onclick: () => {
        closeSheet();
        if (e.kind === 'pdf') openPdfViewer(e.id);
        else if (!isCur) openScript(e.id);
      },
    },
    e.kind === 'pdf' ? h('span', { class: 'pdf-badge' }, 'PDF') : null,
    e.title || '無題',
    h('span', { class: 'sub' }, e.kind === 'pdf' ? `${e.pages}ページ・${formatDate(e.at)}` : formatDate(e.at)))));
  }
  const actions = h('div', { class: 'row-btns wrap' },
    h('button', { class: 'btn primary', type: 'button', onclick: () => { closeSheet(); createScript(); } }, '＋ 新しい脚本'),
    h('button', { class: 'btn', type: 'button', onclick: () => { closeSheet(); duplicateScript(); } }, '複製'),
    h('button', { class: 'btn', type: 'button', onclick: () => { closeSheet(); openPdfImportChooser(); } }, 'PDFから読み込む'),
    h('button', { class: 'btn danger', type: 'button', onclick: () => { closeSheet(); removeScript(); } }, 'この脚本を削除'));
  const sourceBtn = S.sourcePdfId
    ? h('button', { class: 'btn', type: 'button', onclick: () => { closeSheet(); openPdfViewer(S.sourcePdfId); } }, '元のPDFを見る')
    : null;
  if (sourceBtn) actions.append(sourceBtn);
  const exportRow = h('div', { class: 'row-btns wrap' },
    h('button', { class: 'btn', type: 'button', onclick: () => { closeSheet(); exportText(); } }, 'テキスト（.txt）'),
    h('button', { class: 'btn', type: 'button', onclick: () => { closeSheet(); exportDocx(); } }, 'Word（.docx）'));
  const guide = h('p', { class: 'sheet-guide' }, h('a', { href: 'guide.html' }, '📖 使い方ガイド'));
  openSheet('脚本の一覧', actions, h('p', { class: 'sheet-label' }, 'この脚本をファイルに保存'), exportRow, h('p', { class: 'sheet-label' }, '脚本を切り替える'), list, guide);
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

// ============ PDF の読み込み ============

let pdfImportMode = 'view';

function openPdfImportChooser() {
  const card = (mode, title, desc, warn) => h('button', {
    class: 'mode-card', type: 'button',
    onclick: () => { pdfImportMode = mode; closeSheet(); $('#pdf-file').click(); },
  }, h('b', {}, title), h('span', {}, desc), warn ? h('span', { class: 'warn' }, warn) : null);
  openSheet('過去の脚本をPDFから読み込む',
    card('view', 'PDFモード（そのまま読む）',
      '元のPDFをこの端末に保存します。左上の ☰ の「脚本を切り替える」からいつでも開いて読めます。内容の編集はできません。'),
    card('edit', 'PDF＋修正モード（取り込んで編集する）',
      'PDFの文字を読み取り、セリフ・ト書き・章・人物を新しい脚本として取り込みます。元のPDFも保存され、左上の ☰ の「元のPDFを見る」から見比べられます。',
      '⚠ レイアウトが崩れたり、名前やセリフが正しく取り込めない場合があります。取り込み後に内容を確認してください。'));
}

async function storePdf(rec) {
  try {
    await savePdf(rec);
    return true;
  } catch {
    toastError('PDFを保存できませんでした（端末の空き容量を確認してください）');
    return false;
  }
}

async function onPdfChosen(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { toastError('PDFファイルを選んでください'); return; }
  processPdfFile(file, pdfImportMode);
}

async function processPdfFile(file, mode) {
  const bar = h('div');
  const msg = h('p', { class: 'note' }, 'PDFを開いています…');
  openSheet(mode === 'edit' ? 'PDFを取り込んでいます' : 'PDFを読み込んでいます', msg, h('div', { class: 'progress' }, bar));

  let data, pdf;
  try {
    data = await file.arrayBuffer();
    pdf = await openPdf(data);
  } catch (err) {
    closeSheet();
    toastError(err?.name === 'PasswordException' ? 'パスワード付きのPDFは読み込めません' : 'PDFを開けませんでした（ファイルが壊れていないか確認してください）');
    return;
  }
  const name = file.name.replace(/\.pdf$/i, '');
  const rec = { id: uid(), name, pages: pdf.numPages, size: data.byteLength, addedAt: Date.now(), scriptId: null, data };

  if (mode === 'view') {
    pdf.destroy();
    closeSheet();
    if (!(await storePdf(rec))) return;
    openSheet('PDFを読み込みました',
      h('p', {}, `「${rec.name}」を読み込みました。左上の ☰ の「脚本を切り替える」から、いつでも開けます。`),
      storageWarning(),
      h('div', { class: 'row-btns' }, h('button', { class: 'btn primary', type: 'button', onclick: () => { closeSheet(); openPdfViewer(rec.id); } }, 'PDFを開く')));
    return;
  }

  let extracted;
  try {
    extracted = await extractPages(pdf, (p, n) => {
      bar.style.width = `${Math.round((p / n) * 100)}%`;
      msg.textContent = `文字を読み取っています…（${p} / ${n}ページ）`;
    });
  } catch {
    closeSheet();
    toastError('PDFの文字を読み取れませんでした');
    return;
  } finally {
    pdf.destroy();
  }

  if (extracted.chars < 10) {
    openSheet('文字を読み取れませんでした',
      h('p', {}, 'このPDFには文字の情報がありません（紙をスキャンした画像のPDFなど）。そのため脚本としては取り込めません。'),
      h('div', { class: 'row-btns wrap' },
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          closeSheet();
          if (await storePdf(rec)) openPdfViewer(rec.id);
        } }, 'PDFモードで保存して読む'),
        h('button', { class: 'btn', type: 'button', onclick: closeSheet }, 'やめる')));
    return;
  }

  const parsed = parsePages(extracted.pages);
  const s = scriptFromPdf(parsed, extracted, name);
  s.sourcePdfId = rec.id;
  rec.scriptId = s.id;
  const saved = await storePdf(rec);
  if (!saved) s.sourcePdfId = null;

  openNewScript(s);
  S.characters.forEach((c) => { if (!c.reading) autoReading(c); });
  showImportResult('PDF', parsed.report, saved ? rec : null);
}

// 取り込んだPDFは端末のブラウザ内に保存しているので、消える条件を知らせる
function storageWarning() {
  return h('div', { class: 'warn-box' },
    '⚠ このPDFはアプリの中にコピーして保存しています。元のファイルを移動・削除しても表示できますが、',
    h('b', {}, 'ブラウザの閲覧データ（サイトデータ）を消去したり、ホーム画面に追加したアプリを削除すると表示されなくなる'),
    'ため、注意してください。元のPDFは手元にも残しておくと安心です。');
}

function scriptFromPdf(parsed, extracted, fallbackTitle) {
  const s = store.newScript(parsed.title || fallbackTitle);
  s.author = parsed.author || '';
  if (extracted) { // PDF のときは、元の向きに合わせる
    s.settings.writingMode = parsed.report.vertical ? 'vertical' : 'horizontal';
    s.settings.orientation = extracted.landscape ? 'landscape' : 'portrait';
  }
  if (parsed.report.notes) s.settings.actingNotes = true;
  if (parsed.report.memos) s.settings.memoArea = 'medium';
  // 「全員」「教授・裕二」のような話者は、人物を増やさず全員・複数人として扱う
  const plain = new Set(parsed.characters.map((c) => c.name));
  const isCombined = (name) => name === '全員' || (name.includes('・') && name.split('・').every((n) => plain.has(n)));
  const idByName = new Map();
  s.characters = parsed.characters.filter((c) => !isCombined(c.name)).map((c, i) => {
    const id = uid();
    idByName.set(c.name, id);
    return { id, name: c.name, reading: c.reading || '', readingAuto: !c.reading, actor: c.actor || '', color: store.CHAR_COLORS[i % store.CHAR_COLORS.length] };
  });
  s.blocks = parsed.blocks.map((b) => {
    const extra = b.type === 'chapter' ? {} : { note: b.note || '', memo: b.memo || '' };
    if (b.type !== 'dialogue') return { id: uid(), type: b.type, text: b.text, ...extra };
    const block = { id: uid(), type: 'dialogue', text: b.text, ...extra };
    if (b.name === '全員') setSpeakers(block, [ALL_ID]);
    else if (!idByName.has(b.name) && b.name.includes('・')) setSpeakers(block, b.name.split('・').map((n) => idByName.get(n)).filter(Boolean));
    else setSpeakers(block, [idByName.get(b.name)].filter(Boolean));
    return block;
  });
  return s;
}

function showImportResult(source, r, rec) {
  const names = S.characters.map((c) => c.name).join('、');
  openSheet(`${source}から取り込みました`,
    h('div', { class: 'warn-box' },
      `⚠ ${source}からの取り込みは完全ではありません。レイアウトが崩れたり、名前・セリフ・ト書きの区別が正しくない箇所があるかもしれません。`,
      rec ? '元のPDFと見比べて確認してください（左上の ☰ の「元のPDFを見る」からも開けます）。' : '内容を確認してください。'),
    rec ? storageWarning() : null,
    r.dialogues === 0 ? h('p', { class: 'warn-text' }, 'セリフの形（「名前「セリフ」」「名前　セリフ」など）を見つけられなかったため、すべてト書きとして取り込んでいます。') : null,
    h('ul', { class: 'result-list' },
      r.pages ? h('li', {}, `${r.pages}ページを読み取りました（${r.vertical ? '縦書き' : '横書き'}として判定）`) : null,
      h('li', {}, `人物：${S.characters.length}人${names ? `（${names}）` : ''}`),
      h('li', {}, `セリフ：${r.dialogues}・ト書き：${r.directions}・章：${r.chapters}・シチュエーション：${r.situations}`),
      r.notes ? h('li', {}, `演技の指示：${r.notes}（設定の「演技の指示」をオンにしました）`) : null,
      r.memos ? h('li', {}, `メモ：${r.memos}（設定の「メモのスペース」をオンにしました）`) : null),
    h('div', { class: 'row-btns wrap' },
      rec ? h('button', { class: 'btn', type: 'button', onclick: () => { closeSheet(); openPdfViewer(rec.id); } }, '元のPDFと見比べる') : null,
      h('button', { class: 'btn primary', type: 'button', onclick: closeSheet }, '確認する')));
}

// ============ 右上の「共有」：共有書き出し・共有取り込み ============

function openShareMenu() {
  flush();
  openSheet('共有',
    h('button', { class: 'mode-card share-card', type: 'button', onclick: openShareSheet },
      h('b', {}, '共有書き出し（LINE・ドライブ保存）'),
      h('span', {}, 'この脚本をファイルにして、LINE で送ったり、Google ドライブ・MEGA などの好きな場所に保存したりできます。')),
    h('button', { class: 'mode-card', type: 'button', onclick: openShareImport },
      h('b', {}, '共有取り込み'),
      h('span', {}, 'LINE で受け取ったファイルや、ドライブ・MEGA に保存したファイルを、新しい脚本として取り込みます。')));
}

function openShareImport() {
  const android = /Android/i.test(navigator.userAgent);
  openSheet('共有取り込み',
    h('p', {}, '取り込むファイルを選んでください。今の脚本はそのまま残り、新しい脚本として追加されます。'),
    h('ul', { class: 'result-list' },
      h('li', {}, h('b', {}, 'このアプリのデータ'), '（.json／共有で .txt になったものも可）…そのまま元どおりに開けます'),
      h('li', {}, h('b', {}, 'Word（.docx）・テキスト（.txt）'), '…文字を読み取って取り込みます'),
      h('li', {}, h('b', {}, 'PDF'), '…PDFモード／PDF＋修正モードを選べます')),
    h('div', { class: 'warn-box' }, '⚠ Word・テキスト・PDF からの取り込みは、レイアウトが崩れたり、名前やセリフが正しく取り込めない場合があります。'),
    h('div', { class: 'row-btns' }, h('button', { class: 'btn primary', type: 'button', onclick: () => $('#share-file').click() }, 'ファイルを選ぶ')),
    h('p', { class: 'note' }, android
      ? 'LINE で受け取ったファイルは、LINE のファイルを開いて共有ボタン →「演劇脚本」を選ぶと、直接取り込めます（ホーム画面に追加している場合）。'
      : 'LINE で受け取ったファイルは、いったん「"ファイル"に保存」してから、ここで選んでください。ドライブ・MEGA のファイルは、選ぶ画面の「ブラウズ」などから開けます。'));
}

async function importSharedFile(file) {
  const name = file.name || '共有された脚本';
  const lower = name.toLowerCase();
  const base = name.replace(/\.(emgeki\.)?(json|txt|docx|pdf)$/i, '') || '共有された脚本';
  closeSheet();
  try {
    if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
      chooseSharedPdfMode(file);
      return;
    }
    if (lower.endsWith('.docx')) {
      const lines = await docxToLines(await file.arrayBuffer());
      importParsed('Word', parseScriptLines(lines), base);
      return;
    }
    if (/\.(json|txt)$/.test(lower) || (file.type || '').startsWith('text/') || file.type === 'application/json') {
      const text = await file.text();
      if (tryImportAppData(text)) return;
      if (lower.endsWith('.json')) { toastError('このアプリのデータではないため、読み込めませんでした'); return; }
      importParsed('テキスト', parseScriptLines(textToLines(text)), base);
      return;
    }
    toastError('対応していないファイルです（このアプリのデータ・Word・テキスト・PDFを選んでください）');
  } catch {
    toastError('ファイルを読み込めませんでした（壊れていないか確認してください）');
  }
}

function chooseSharedPdfMode(file) {
  const card = (mode, title, desc) => h('button', { class: 'mode-card', type: 'button', onclick: () => { closeSheet(); processPdfFile(file, mode); } }, h('b', {}, title), h('span', {}, desc));
  openSheet('PDFの取り込み方',
    card('view', 'PDFモード（そのまま読む）', 'PDFを保存して読むだけです。'),
    card('edit', 'PDF＋修正モード（取り込んで編集する）', '文字を読み取って脚本として取り込みます。レイアウトが崩れることがあります。'));
}

function importParsed(source, parsed, fallbackTitle) {
  if (!parsed.blocks.length) { toastError('脚本の内容を読み取れませんでした'); return; }
  openNewScript(scriptFromPdf(parsed, null, fallbackTitle));
  S.characters.forEach((c) => { if (!c.reading) autoReading(c); });
  showImportResult(source, parsed.report, null);
}

// Android：LINE などの共有メニューから送られたファイル（サービスワーカーが一時保存）を取り込む
async function receiveSharedFile() {
  if (!new URLSearchParams(location.search).has('shared')) return;
  history.replaceState(null, '', location.pathname);
  try {
    const cache = await caches.open('emgeki-share');
    const res = await cache.match('shared-file');
    if (!res) { toastError('共有されたファイルが見つかりませんでした'); return; }
    await cache.delete('shared-file');
    const name = decodeURIComponent(res.headers.get('X-File-Name') || 'shared.txt');
    const blob = await res.blob();
    importSharedFile(new File([blob], name, { type: blob.type }));
  } catch {
    toastError('共有されたファイルを読み込めませんでした');
  }
}

const SHARE_FORMATS = {
  backup: { label: 'このアプリのデータ（おすすめ）', desc: '相手もこのアプリの「設定 → バックアップを読み込む」で、そのまま開いて続きを書けます。', ext: '.emgeki.json', mime: 'application/json' },
  docx: { label: 'Word（.docx）', desc: 'Word・Google ドキュメントなどで読めます。表紙・配役表・ルビ入り。', ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  txt: { label: 'テキスト（.txt）', desc: 'どの端末でも開けるいちばん軽い形式です。', ext: '.txt', mime: 'text/plain' },
};

// 選んだ形式のファイルを作る（共有シートはタップの直後に開く必要があるので、ここは同期処理）
function makeShareFile(format) {
  const f = SHARE_FORMATS[format];
  let blob;
  if (format === 'backup') blob = new Blob([JSON.stringify(S, null, 2)], { type: f.mime });
  else if (format === 'docx') blob = scriptToDocx(S);
  else blob = new Blob([scriptToText(S)], { type: 'text/plain;charset=utf-8' });
  return new File([blob], `${fileBase()}${f.ext}`, { type: f.mime });
}

function canShareFiles() {
  try {
    return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] }));
  } catch { return false; }
}

function openShareSheet() {
  flush();
  let format = 'backup';
  const radios = Object.entries(SHARE_FORMATS).map(([key, f]) => h('label', { class: 'format-row' },
    h('input', { type: 'radio', name: 'share-format', value: key, checked: key === format, onchange: () => { format = key; } }),
    h('span', {}, h('b', {}, f.label), h('small', {}, f.desc))));

  const shareBtn = canShareFiles()
    ? h('button', { class: 'btn primary', type: 'button', onclick: () => shareScriptFile(makeShareFile(format)) }, '共有する（LINE・ドライブなど）')
    : null;
  const saveBtn = h('button', { class: 'btn', type: 'button', onclick: () => saveScriptFileAs(makeShareFile(format)) },
    window.showSaveFilePicker ? '保存先を選んで保存' : '端末に保存');

  openSheet('共有書き出し',
    h('p', { class: 'sheet-label' }, '形式'),
    h('div', { class: 'format-list' }, radios),
    h('div', { class: 'row-btns wrap' }, shareBtn, saveBtn),
    h('p', { class: 'note' },
      shareBtn
        ? '「共有する」を押すと共有メニューが開きます。LINE を選ぶとトークに送れ、ドライブ・MEGA・「ファイルに保存」などを選ぶと保存先のフォルダを指定できます（出てくる先は、端末に入っているアプリによります）。'
        : 'この端末のブラウザは共有メニューに対応していないため、ファイルとして保存します。保存したファイルを LINE やドライブで送ってください。'));
}

async function shareScriptFile(file) {
  // Android の Chrome などは共有できるファイルの種類が限られるので、送れる形に替える
  if (!navigator.canShare({ files: [file] })) {
    const asText = new File([file], file.name.replace(/\.json$/, '.txt'), { type: 'text/plain' });
    if (file.name.endsWith('.json') && navigator.canShare({ files: [asText] })) {
      file = asText;
    } else {
      closeSheet();
      toastError('この形式は共有メニューで送れないため、端末に保存しました');
      downloadBlob(file.name, file, { quiet: true });
      return;
    }
  }
  try {
    await navigator.share({ files: [file], title: S.title || '脚本' });
    closeSheet();
    toast('共有しました');
  } catch (e) {
    if (e && e.name === 'AbortError') return; // 共有メニューを閉じただけ
    closeSheet();
    toastError('共有できなかったため、端末に保存しました');
    downloadBlob(file.name, file, { quiet: true });
  }
}

// 保存先を選べる環境（パソコンの Chrome・Edge など）では保存ダイアログを出す。ほかは通常のダウンロード
async function saveScriptFileAs(file) {
  if (!window.showSaveFilePicker) { closeSheet(); downloadBlob(file.name, file); return; }
  const ext = file.name.slice(file.name.indexOf('.'));
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: file.name,
      types: [{ description: '脚本ファイル', accept: { [file.type]: [ext.endsWith('.json') ? '.json' : ext] } }],
    });
    const w = await handle.createWritable();
    await w.write(file);
    await w.close();
    closeSheet();
    toast(`「${handle.name}」に保存しました`);
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    closeSheet();
    downloadBlob(file.name, file);
  }
}

// ---- PDF ビューア ----

const viewer = { pdf: null, id: null, zoom: 1, observer: null, token: 0 };

async function openPdfViewer(id) {
  const v = $('#pdf-viewer');
  if (v.hidden) history.pushState({ pdfViewer: true }, '');
  v.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#pdf-pages').innerHTML = '';
  $('#pdf-viewer-title').textContent = '読み込み中…';
  const token = ++viewer.token;
  let rec = null;
  try { rec = await getPdf(id); } catch { /* 下で扱う */ }
  if (token !== viewer.token) return;
  if (!rec) { closePdfViewer(); toastError('PDFが見つかりませんでした'); return; }
  $('#pdf-viewer-title').textContent = rec.name;
  viewer.id = id;
  viewer.zoom = 1;
  try {
    viewer.pdf?.destroy();
    viewer.pdf = await openPdf(rec.data);
  } catch {
    closePdfViewer();
    toastError('PDFを開けませんでした');
    return;
  }
  if (token !== viewer.token) return;
  layoutPdfPages();
}

async function layoutPdfPages() {
  const pdf = viewer.pdf;
  const box = $('#pdf-pages');
  const scrollRatio = box.scrollHeight ? box.scrollTop / box.scrollHeight : 0;
  box.innerHTML = '';
  viewer.observer?.disconnect();
  const width = Math.min(box.clientWidth - 16, 900) * viewer.zoom;
  viewer.observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      viewer.observer.unobserve(en.target);
      renderPdfPage(en.target, pdf);
    }
  }, { root: box, rootMargin: '600px 0px' });
  const vp1 = (await pdf.getPage(1)).getViewport({ scale: 1 });
  if (pdf !== viewer.pdf) return;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = h('div', { class: 'pdf-page', style: { width: `${width}px`, height: `${(width * vp1.height) / vp1.width}px` }, dataset: { page: String(n) } });
    box.append(page, h('div', { class: 'pdf-label' }, `${n} / ${pdf.numPages}`));
    viewer.observer.observe(page);
  }
  box.scrollTop = scrollRatio * box.scrollHeight;
}

async function renderPdfPage(el, pdf) {
  try {
    const page = await pdf.getPage(Number(el.dataset.page));
    const cssW = parseFloat(el.style.width);
    const vp0 = page.getViewport({ scale: 1 });
    el.style.height = `${(cssW * vp0.height) / vp0.width}px`;
    let scale = (cssW / vp0.width) * Math.min(window.devicePixelRatio || 1, 2.5);
    const maxPixels = 12e6; // 大きすぎるキャンバスはスマホで描けないので抑える
    if (vp0.width * vp0.height * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (vp0.width * vp0.height));
    const vp = page.getViewport({ scale });
    const canvas = h('canvas', { width: Math.floor(vp.width), height: Math.floor(vp.height) });
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    el.innerHTML = '';
    el.append(canvas);
  } catch {
    if (pdf === viewer.pdf) el.textContent = 'このページを表示できませんでした';
  }
}

function closePdfViewer(fromHistory = false) {
  const v = $('#pdf-viewer');
  if (v.hidden) return;
  v.hidden = true;
  viewer.token++;
  document.body.style.overflow = '';
  viewer.observer?.disconnect();
  viewer.pdf?.destroy();
  viewer.pdf = null;
  $('#pdf-pages').innerHTML = '';
  if (!fromHistory && history.state?.pdfViewer) history.back();
}

function zoomPdf(factor) {
  if (!viewer.pdf) return;
  viewer.zoom = Math.min(3, Math.max(0.5, viewer.zoom * factor));
  layoutPdfPages();
}

async function deleteViewedPdf() {
  if (!viewer.id || !confirm('このPDFを端末から削除しますか？（取り込んだ脚本は消えません）')) return;
  const id = viewer.id;
  try { await deletePdf(id); } catch { toastError('削除できませんでした'); return; }
  if (S.sourcePdfId === id) { S.sourcePdfId = null; markDirty(); }
  closePdfViewer();
  toast('PDFを削除しました');
}

window.addEventListener('popstate', () => closePdfViewer(true));

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
  $('#btn-more').addEventListener('click', openShareMenu);
  $('#share-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importSharedFile(f); });
  $('#btn-import-pdf').addEventListener('click', openPdfImportChooser);
  $('#pdf-file').addEventListener('change', onPdfChosen);
  $('#pdf-close').addEventListener('click', () => closePdfViewer());
  $('#pdf-zoom-in').addEventListener('click', () => zoomPdf(1.25));
  $('#pdf-zoom-out').addEventListener('click', () => zoomPdf(0.8));
  $('#pdf-delete').addEventListener('click', deleteViewedPdf);
  updateInstallButton();
  $('#btn-scripts').addEventListener('click', openScriptList);
  $('#sheet-close').addEventListener('click', closeSheet);
  $('#sheet-backdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('#pdf-viewer').hidden) closePdfViewer(); else closeSheet(); } });

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

  receiveSharedFile();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
