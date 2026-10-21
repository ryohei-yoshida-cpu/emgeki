// A4 のページに脚本を割り付ける（縦書き・横書き、用紙の縦・横に対応）
import { h, hasKanji, chapterLabel } from './util.js';
import { fontCss } from './fonts.js';

const PAGE_MM = { portrait: [210, 297], landscape: [297, 210] };
const MARGIN_MM = { top: 20, bottom: 22, side: 20 };
const MM = 96 / 25.4; // 1mm の CSS px
export const MEMO_FRACTION = { none: 0, small: 0.25, medium: 0.33, large: 0.45 };
const MEMO_GAP_MM = 5;   // メモ欄と本文のすき間
const RULE_MM = 8;       // 罫線の間隔

// 本文の枠とメモ欄の枠（どちらも用紙の端からの距離 mm）
export function pageLayout(st) {
  const [pw, ph] = PAGE_MM[st.orientation] || PAGE_MM.portrait;
  const body = { top: MARGIN_MM.top, bottom: MARGIN_MM.bottom, left: MARGIN_MM.side, right: MARGIN_MM.side };
  const frac = MEMO_FRACTION[st.memoArea] || 0;
  if (!frac) return { body, memo: null };
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
  return { body, memo, pos, size };
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
    const box = withMemo && layout.memo ? layout.body : { top: MARGIN_MM.top, bottom: MARGIN_MM.bottom, left: MARGIN_MM.side, right: MARGIN_MM.side };
    const inset = (b) => ({ top: `${b.top}mm`, bottom: `${b.bottom}mm`, left: `${b.left}mm`, right: `${b.right}mm` });
    if (withMemo && layout.memo) {
      // 罫線は書く向きに合わせる（縦書きなら縦線、横書きなら横線）
      const ruled = st.memoRuled
        ? `repeating-linear-gradient(${vertical ? 'to left' : 'to bottom'}, transparent 0 calc(${RULE_MM}mm - 0.6px), #c8c8c8 calc(${RULE_MM}mm - 0.6px) ${RULE_MM}mm)`
        : 'none';
      page.append(h('div', { class: `memo-area memo-${layout.pos}`, style: { ...inset(layout.memo), backgroundImage: ruled } },
        h('span', { class: 'memo-label' }, 'メモ')));
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
      case 'note':
        return h('div', { class: 'p-note', style: { paddingInlineStart: `${block.indent}em` } }, `（${text}）`);
      case 'chapter':
        return h('div', { class: 'p-chap' },
          numberNodes(chapterLabel(chapterNo, st.chapterFormat), vertical),
          text ? h('span', { class: 'p-chap-title' }, text) : null);
      default:
        return h('div', {}, text);
    }
  }

  // 演技の指示はセリフの直後に置く小さな段落として扱う
  const items = [];
  for (const b of script.blocks) {
    items.push(b);
    if (b.type === 'dialogue' && st.actingNotes && b.note && b.note.trim()) {
      const c = chars.get(b.charId);
      items.push({ type: 'note', text: b.note.trim(), indent: (c ? c.name.length : 6) + 1 });
    }
  }

  for (const block of items) {
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
    const splittable = block.type !== 'chapter' && block.type !== 'note';
    let text = block.text;
    let head = true;

    for (;;) {
      const el = makeEl(block, text, head, true, ruby && head);
      body.append(el);
      if (fits(body, el)) break;
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
          body.append(makeEl(block, text.slice(0, best), head, false, ruby && head));
          text = text.slice(best).replace(/^\n/, '');
          head = false;
          body = newPage(true);
          continue;
        }
      }
      if (!body.children.length) { body.append(el); break; } // 1ページに収まらない要素はそのまま置く
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
