// A4 のページに脚本を割り付ける（縦書き・横書き、用紙の縦・横に対応）
import { h, hasKanji, chapterLabel } from './util.js';
import { fontCss } from './fonts.js';

const PAGE_MM = { portrait: [210, 297], landscape: [297, 210] };
const MARGIN_MM = { top: 20, bottom: 22, side: 20 };
const MM = 96 / 25.4; // 1mm の CSS px

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

  function newPage() {
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
    const body = h('div', {
      class: 'page-body',
      style: {
        top: `${MARGIN_MM.top}mm`,
        bottom: `${MARGIN_MM.bottom}mm`,
        left: `${MARGIN_MM.side}mm`,
        right: `${MARGIN_MM.side}mm`,
      },
    });
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

  for (const block of script.blocks) {
    if (block.type === 'chapter') {
      chapterNo++;
      if (st.chapterPageBreak && body && body.children.length) body = null;
    }
    if (!body) body = newPage();

    let ruby = false;
    if (block.type === 'dialogue') {
      ruby = st.ruby === 'all' || (st.ruby === 'first' && !seen.has(block.charId));
      seen.add(block.charId);
    }
    const splittable = block.type !== 'chapter';
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
          body = newPage();
          continue;
        }
      }
      if (!body.children.length) { body.append(el); break; } // 1ページに収まらない要素はそのまま置く
      body = newPage();
    }
  }

  if (!pages.length) newPage();

  if (st.pageNumbers) {
    const offset = st.printTitlePage ? 1 : 0;
    pages.forEach((p, i) => {
      if (i < offset) return;
      p.append(h('div', { class: 'page-num' }, `- ${i + 1 - offset} -`));
    });
  }
  return pages;
}
