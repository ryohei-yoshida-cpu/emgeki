// A4 のページに脚本を割り付ける（縦書き・横書き、用紙の縦・横に対応）
import { h, hasKanji, chapterLabel } from './util.js';
import { fontCss } from './fonts.js';
import { speakersOf, speakerIds, inCastList } from './speakers.js';

const PAGE_MM = { portrait: [210, 297], landscape: [297, 210] };
const MARGIN_MM = { top: 20, bottom: 22, side: 20 };
const MM = 96 / 25.4; // 1mm の CSS px
// メモのスペースの大きさ（行の長さに対する割合）
export const MEMO_FRACTION = { none: 0, small: 1 / 6, medium: 1 / 5, large: 1 / 4 };
const BAND_GAP_MM = 5;   // メモ・指示のスペースと本文のすき間
const NOTE_BAND = 0.2;   // 演技の指示スペース：行の長さの約1/5

// 本文の枠と、メモのスペース（行の頭側）・指示のスペース（行の終わり側）の枠。どれも用紙の端からの距離 mm。
// 縦書きならメモは上・指示は下、横書きならメモは左・指示は右。
export function pageLayout(st) {
  const [pw, ph] = PAGE_MM[st.orientation] || PAGE_MM.portrait;
  const body = { top: MARGIN_MM.top, bottom: MARGIN_MM.bottom, left: MARGIN_MM.side, right: MARGIN_MM.side };
  const vertical = st.writingMode === 'vertical';
  const lineLen = vertical ? ph - body.top - body.bottom : pw - body.left - body.right;
  let memo = null, band = null;
  const memoLen = lineLen * (MEMO_FRACTION[st.memoArea] || 0);
  const noteLen = st.actingNotes ? lineLen * NOTE_BAND : 0;
  if (memoLen) {
    if (vertical) { memo = { ...body, bottom: ph - body.top - memoLen }; body.top += memoLen + BAND_GAP_MM; }
    else { memo = { ...body, right: pw - body.left - memoLen }; body.left += memoLen + BAND_GAP_MM; }
  }
  if (noteLen) {
    if (vertical) { band = { ...body, top: ph - body.bottom - noteLen }; body.bottom += noteLen + BAND_GAP_MM; }
    else { band = { ...body, left: pw - body.right - noteLen }; body.right += noteLen + BAND_GAP_MM; }
  }
  return { body, memo, band, pw, ph };
}

export function pageSizePx(orientation) {
  const [w, hgt] = PAGE_MM[orientation] || PAGE_MM.portrait;
  return { w: w * MM, h: hgt * MM };
}

// 行頭に来てはいけない文字（ページ分割時に前のページへ寄せる）
const NO_LINE_START = '、。，．」』）】〉》！？!?…‥ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ々';

// 縦書きで2桁までの数字を縦中横に
function numberNodes(text, vertical) {
  if (!vertical) return [text];
  return text.split(/(\d+)/).map((part) =>
    /^\d{1,2}$/.test(part) ? h('span', { class: 'tcy' }, part) : part
  );
}

function nameNode(c, withRuby) {
  if (!c) return '（未設定）';
  if (withRuby && c.reading && hasKanji(c.name)) {
    return h('ruby', {}, c.name, h('rt', {}, c.reading));
  }
  return c.name;
}

// 複数の話者は「・」でつなぐ（全員はそのまま）
function speakerNodes(block, chars, rubyFor) {
  const list = speakersOf(block, chars);
  if (!list.length) return ['（未設定）'];
  return list.flatMap((sp, i) => [i ? '・' : null, sp.c ? nameNode(sp.c, rubyFor(sp.id)) : sp.name]).filter(Boolean);
}

export function renderPages(script, host) {
  const st = script.settings;
  const vertical = st.writingMode === 'vertical';
  const size = pageSizePx(st.orientation);
  const chars = new Map(script.characters.map((c) => [c.id, c]));
  const pages = [];

  host.innerHTML = '';

  const layout = pageLayout(st);

  function newPage(withMemo = false) {
    const page = h('div', {
      class: `page ${vertical ? 'vertical' : 'horizontal'} ${st.orientation}`,
      style: {
        width: `${size.w}px`,
        height: `${size.h}px`,
        fontFamily: fontCss(st.font),
        fontSize: `${st.fontSize}pt`,
        lineHeight: String(st.lineHeight),
      },
    });
    page.style.setProperty('--indent', String(st.directionIndent || 0));
    page.style.setProperty('--lh', String(st.lineHeight));
    const box = withMemo ? layout.body : { top: MARGIN_MM.top, bottom: MARGIN_MM.bottom, left: MARGIN_MM.side, right: MARGIN_MM.side };
    const inset = (b) => ({ top: `${b.top}mm`, bottom: `${b.bottom}mm`, left: `${b.left}mm`, right: `${b.right}mm` });
    // 本文との境に1本線を引く（設定でなしにもできる）
    const lined = st.memoRuled ? ' lined' : '';
    if (withMemo && layout.memo) {
      page.append(h('div', { class: `memo-area ${vertical ? 'memo-top' : 'memo-left'}${lined}`, style: inset(layout.memo) },
        h('span', { class: 'memo-label' }, 'メモ')));
    }
    if (withMemo && layout.band) {
      page.append(h('div', { class: `note-band ${vertical ? 'band-bottom' : 'band-right'}${lined}`, style: inset(layout.band) },
        h('span', { class: 'memo-label' }, '演技の指示')));
    }
    const body = h('div', { class: 'page-body', style: inset(box) });
    page.append(body);
    host.append(page);
    pages.push(page);
    return body;
  }

  function fits(body, el) {
    const b = body.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (vertical) return r.left >= b.left - 0.5 && r.bottom <= b.bottom + 0.5;
    return r.bottom <= b.bottom + 0.5 && r.right <= b.right + 0.5;
  }

  // ---- 表紙 ----
  if (st.printTitlePage) {
    const body = newPage();
    body.classList.add('title-body');
    body.append(
      h('div', { class: 'p-title-wrap' },
        h('div', { class: 'p-title' }, script.title || '無題'),
        script.author ? h('div', { class: 'p-author' }, script.author) : null)
    );
  }

  // ---- 配役表（登場人物） ----
  const castChars = script.characters.filter(inCastList);
  if (st.printCastPage && castChars.length) {
    const hasActors = castChars.some((c) => c.actor.trim());
    const roleW = Math.max(...castChars.map((c) => c.name.length)) + 3;
    let body = newPage();
    body.append(h('div', { class: 'p-cast-head' }, hasActors ? '配役' : '登場人物'));
    for (const c of castChars) {
      const row = h('div', { class: 'p-cast-row' },
        h('span', { class: 'p-cast-role', style: hasActors ? { inlineSize: `${roleW}em` } : null }, nameNode(c, st.ruby !== 'none')),
        hasActors ? h('span', { class: 'p-cast-actor' }, c.actor || '') : null);
      body.append(row);
      if (!fits(body, row)) {
        row.remove();
        body = newPage();
        body.append(row);
      }
    }
  }

  // ---- 本文 ----
  let body = null;
  const seen = new Set();
  let chapterNo = 0;

  function makeEl(block, text, head, tail, rubyFor) {
    switch (block.type) {
      case 'dialogue': {
        return h('div', { class: 'p-dlg' },
          h('span', { class: 'p-name', style: head ? null : { visibility: 'hidden' } }, speakerNodes(block, chars, rubyFor), '「'),
          h('span', { class: 'p-text' }, text, tail ? '」' : ''));
      }
      case 'direction':
        return h('div', { class: 'p-dir' + (head ? '' : ' cont') }, text);
      case 'situation':
        return h('div', { class: 'p-sit' + (head ? '' : ' cont') }, text);
      case 'chapter':
        return h('div', { class: 'p-chap' },
          numberNodes(chapterLabel(chapterNo, st.chapterFormat), vertical),
          text ? h('span', { class: 'p-chap-title' }, text) : null);
      default:
        return h('div', {}, text);
    }
  }

  // メモ・演技の指示：その段落と同じ高さ（縦書きなら同じ列）のスペースに置く。前のものと重なるときはずらす
  function placeInBand(anchor, text, b, key) {
    const page = anchor.closest('.page');
    const pr = page.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    const edges = page._bandEdges || (page._bandEdges = {});
    const el = h('div', { class: 'p-band-note' }, text);
    if (vertical) {
      let right = pr.right - ar.right;
      if (edges[key] != null) right = Math.max(right, edges[key]);
      Object.assign(el.style, { right: `${right}px`, top: `${b.top * MM + 2}px`, height: `${(size.h - b.top * MM - b.bottom * MM) - 4}px` });
      page.append(el);
      edges[key] = pr.right - el.getBoundingClientRect().left + 2;
    } else {
      let top = ar.top - pr.top;
      if (edges[key] != null) top = Math.max(top, edges[key]);
      Object.assign(el.style, { top: `${top}px`, left: `${b.left * MM + 4}px`, width: `${(size.w - b.left * MM - b.right * MM) - 6}px` });
      page.append(el);
      edges[key] = el.getBoundingClientRect().bottom - pr.top + 2;
    }
  }

  function placeExtras(anchor, block) {
    if (layout.memo && block.memo && block.memo.trim()) placeInBand(anchor, block.memo.trim(), layout.memo, 'memo');
    if (layout.band && block.note && block.note.trim()) placeInBand(anchor, block.note.trim(), layout.band, 'note');
  }

  for (const block of script.blocks) {
    if (block.type === 'chapter') {
      chapterNo++;
      if (st.chapterPageBreak && body && body.children.length) body = null;
    }
    if (!body) body = newPage(true);

    // ルビ：話者ごとに「毎回」か「初登場のみ」
    const rubyIds = new Set();
    if (block.type === 'dialogue') {
      for (const id of speakerIds(block)) {
        if (st.ruby === 'all' || (st.ruby === 'first' && !seen.has(id))) rubyIds.add(id);
        seen.add(id);
      }
    }
    const rubyHead = (id) => rubyIds.has(id);
    const noRuby = () => false;
    const splittable = block.type !== 'chapter';
    let text = block.text;
    let head = true;

    for (;;) {
      const el = makeEl(block, text, head, true, head ? rubyHead : noRuby);
      body.append(el);
      if (fits(body, el)) {
        if (head) placeExtras(el, block);
        break;
      }
      el.remove();

      if (splittable && text.length > 1) {
        // 入りきる最大の文字数を二分探索
        let lo = 1, hi = text.length - 1, best = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const t = makeEl(block, text.slice(0, mid), head, false, head ? rubyHead : noRuby);
          body.append(t);
          const ok = fits(body, t);
          t.remove();
          if (ok) { best = mid; lo = mid + 1; } else hi = mid - 1;
        }
        while (best > 1 && NO_LINE_START.includes(text[best])) best--;
        if (best > 0) {
          const part = makeEl(block, text.slice(0, best), head, false, head ? rubyHead : noRuby);
          body.append(part);
          if (head) placeExtras(part, block);
          text = text.slice(best).replace(/^\n/, '');
          head = false;
          body = newPage(true);
          continue;
        }
      }
      if (!body.children.length) { // 1ページに収まらない要素はそのまま置く
        body.append(el);
        if (head) placeExtras(el, block);
        break;
      }
      body = newPage(true);
    }
  }

  if (!pages.length) newPage(true);

  if (st.pageNumbers) {
    const offset = st.printTitlePage ? 1 : 0;
    pages.forEach((p, i) => {
      if (i < offset) return;
      p.append(h('div', { class: 'page-num' }, `- ${i + 1 - offset} -`));
    });
  }
  return pages;
}
