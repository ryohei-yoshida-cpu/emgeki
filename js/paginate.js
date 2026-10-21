// A4 のページに脚本を割り付ける（縦書き・横書き、用紙の縦・横に対応）
import { h, hasKanji, chapterLabel } from './util.js';
import { fontCss } from './fonts.js';

const PAGE_MM = { portrait: [210, 297], landscape: [297, 210] };
const MARGIN_MM = { top: 20, bottom: 22, side: 20 };
const MM = 96 / 25.4; // 1mm の CSS px
export const MEMO_FRACTION = { none: 0, small: 0.25, medium: 0.33, large: 0.45 };
const MEMO_GAP_MM = 5;   // メモ欄と本文のすき間
const RULE_MM = 8;       // 罫線の間隔
const NOTE_BAND = 0.2;   // 演技の指示スペース：行の長さの約1/5

// 本文の枠とメモ欄の枠（どちらも用紙の端からの距離 mm）
export function pageLayout(st) {
  const [pw, ph] = PAGE_MM[st.orientation] || PAGE_MM.portrait;
  const body = { top: MARGIN_MM.top, bottom: MARGIN_MM.bottom, left: MARGIN_MM.side, right: MARGIN_MM.side };
  const frac = MEMO_FRACTION[st.memoArea] || 0;
  let memo = null, pos = null, size = 0;
  if (frac) ({ memo, pos, size } = carveMemo(st, body, frac, pw, ph));
  // 演技の指示スペースは行の終わり側（縦書きなら下、横書きなら右）
  let band = null;
  if (st.actingNotes) {
    if (st.writingMode === 'vertical') {
      const len = (ph - body.top - body.bottom) * NOTE_BAND;
      band = { ...body, top: ph - body.bottom - len };
      body.bottom += len + MEMO_GAP_MM;
    } else {
      const len = (pw - body.left - body.right) * NOTE_BAND;
      band = { ...body, left: pw - body.right - len };
      body.right += len + MEMO_GAP_MM;
    }
  }
  return { body, memo, pos, size, band, pw, ph };
}

function carveMemo(st, body, frac, pw, ph) {
  const memo = { ...body };
  const pos = st.memoPosition || 'top';
  const across = pos === 'top' || pos === 'bottom'
    ? ph - MARGIN_MM.top - MARGIN_MM.bottom
    : pw - MARGIN_MM.side * 2;
  const size = across * frac;
  if (pos === 'top') { memo.bottom = ph - body.top - size; body.top += size + MEMO_GAP_MM; }
  if (pos === 'bottom') { memo.top = ph - body.bottom - size; body.bottom += size + MEMO_GAP_MM; }
  if (pos === 'left') { memo.right = pw - body.left - size; body.left += size + MEMO_GAP_MM; }
  if (pos === 'right') { memo.left = pw - body.right - size; body.right += size + MEMO_GAP_MM; }
  return { memo, pos, size };
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
    // 罫線は書く向きに合わせる（縦書きなら縦線、横書きなら横線）。
    // 背景画像は印刷で省かれることがあるので、線は要素の枠線で描く
    const rules = (area) => {
      if (!st.memoRuled) return [];
      const [pw, ph] = PAGE_MM[st.orientation] || PAGE_MM.portrait;
      const extent = vertical ? pw - area.left - area.right : ph - area.top - area.bottom;
      const lines = [];
      for (let d = RULE_MM; d < extent - 1; d += RULE_MM) {
        lines.push(h('div', { class: vertical ? 'rule-v' : 'rule-h', style: vertical ? { right: `${d}mm` } : { top: `${d}mm` } }));
      }
      return lines;
    };
    if (withMemo && layout.memo) {
      page.append(h('div', { class: `memo-area memo-${layout.pos}`, style: inset(layout.memo) },
        rules(layout.memo), h('span', { class: 'memo-label' }, 'メモ')));
    }
    if (withMemo && layout.band) {
      page.append(h('div', { class: `note-band ${vertical ? 'band-bottom' : 'band-right'}`, style: inset(layout.band) },
        rules(layout.band), h('span', { class: 'memo-label' }, '演技の指示')));
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
  if (st.printCastPage && script.characters.length) {
    const hasActors = script.characters.some((c) => c.actor.trim());
    const roleW = Math.max(...script.characters.map((c) => c.name.length)) + 3;
    let body = newPage();
    body.append(h('div', { class: 'p-cast-head' }, hasActors ? '配役' : '登場人物'));
    for (const c of script.characters) {
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

  function makeEl(block, text, head, tail, ruby) {
    switch (block.type) {
      case 'dialogue': {
        const c = chars.get(block.charId);
        return h('div', { class: 'p-dlg' },
          h('span', { class: 'p-name', style: head ? null : { visibility: 'hidden' } }, nameNode(c, ruby), '「'),
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

  // 演技の指示：そのセリフと同じ高さ（縦書きなら同じ列）の指示スペースに置く。前の指示と重なるときはずらす
  function placeNote(anchor, text) {
    const page = anchor.closest('.page');
    const pr = page.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    const b = layout.band;
    const el = h('div', { class: 'p-band-note' }, text);
    if (vertical) {
      let right = pr.right - ar.right;
      if (page._noteEdge != null) right = Math.max(right, page._noteEdge);
      Object.assign(el.style, { right: `${right}px`, top: `${b.top * MM + 2}px`, height: `${(size.h - b.top * MM - b.bottom * MM) - 4}px` });
      page.append(el);
      page._noteEdge = pr.right - el.getBoundingClientRect().left + 2;
    } else {
      let top = ar.top - pr.top;
      if (page._noteEdge != null) top = Math.max(top, page._noteEdge);
      Object.assign(el.style, { top: `${top}px`, left: `${b.left * MM + 4}px`, width: `${(size.w - b.left * MM - b.right * MM) - 6}px` });
      page.append(el);
      page._noteEdge = el.getBoundingClientRect().bottom - pr.top + 2;
    }
  }

  for (const block of script.blocks) {
    if (block.type === 'chapter') {
      chapterNo++;
      if (st.chapterPageBreak && body && body.children.length) body = null;
    }
    if (!body) body = newPage(true);

    let ruby = false;
    if (block.type === 'dialogue') {
      ruby = st.ruby === 'all' || (st.ruby === 'first' && !seen.has(block.charId));
      seen.add(block.charId);
    }
    const splittable = block.type !== 'chapter';
    const note = block.type === 'dialogue' && layout.band && block.note ? block.note.trim() : '';
    let text = block.text;
    let head = true;

    for (;;) {
      const el = makeEl(block, text, head, true, ruby && head);
      body.append(el);
      if (fits(body, el)) {
        if (head && note) placeNote(el, note);
        break;
      }
      el.remove();

      if (splittable && text.length > 1) {
        // 入りきる最大の文字数を二分探索
        let lo = 1, hi = text.length - 1, best = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const t = makeEl(block, text.slice(0, mid), head, false, ruby && head);
          body.append(t);
          const ok = fits(body, t);
          t.remove();
          if (ok) { best = mid; lo = mid + 1; } else hi = mid - 1;
        }
        while (best > 1 && NO_LINE_START.includes(text[best])) best--;
        if (best > 0) {
          const part = makeEl(block, text.slice(0, best), head, false, ruby && head);
          body.append(part);
          if (head && note) placeNote(part, note);
          text = text.slice(best).replace(/^\n/, '');
          head = false;
          body = newPage(true);
          continue;
        }
      }
      if (!body.children.length) { // 1ページに収まらない要素はそのまま置く
        body.append(el);
        if (head && note) placeNote(el, note);
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
