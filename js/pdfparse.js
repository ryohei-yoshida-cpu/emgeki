// PDF から取り出した文字の位置情報を行にまとめ、脚本（セリフ・ト書き・章など）に読み替える。
// ブラウザに依存しない純粋な処理だけを置く。

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// ---------- 1. 文字 → 行 ----------

function toGlyphs(items) {
  return items
    .filter((i) => i.str && i.str.trim())
    .map((i) => {
      const t = i.transform;
      return { str: i.str, x: t[4], y: t[5], size: Math.hypot(t[0], t[1]) || Math.abs(t[3]) || 10, w: i.width || 0 };
    });
}

// ルビ（本文より小さい、かなだけの字）は読み飛ばす
function bodyGlyphs(glyphs) {
  const base = median(glyphs.map((g) => g.size));
  return { base, body: glyphs.filter((g) => g.size >= base * 0.7 || !/^[ぁ-ゖァ-ヺー\s]+$/.test(g.str)) };
}

// 縦書きらしさの票：並び順で隣り合う字が「同じ x で下へ」進むか「同じ y で右へ」進むか
export function orientationVotes(items) {
  const { body } = bodyGlyphs(toGlyphs(items));
  let v = 0, hz = 0;
  for (let k = 1; k < body.length; k++) {
    const a = body[k - 1], b = body[k];
    const s = Math.max(a.size, b.size);
    if (Math.abs(a.x - b.x) < s * 0.35 && a.y - b.y > s * 0.4 && a.y - b.y < s * 3) v++;
    else if (Math.abs(a.y - b.y) < s * 0.35 && b.x > a.x) hz++;
  }
  hz += body.filter((g) => g.str.length > 2 && g.w > g.size * 1.5).length;
  return { v, hz };
}

// 字の少ないページは判定がぶれるので、文書全体の向きを使う
export function decideVertical(votes, docVertical) {
  if (votes.v + votes.hz < 6) return docVertical;
  return votes.v > votes.hz * 1.2;
}

// items: PDF.js の textContent.items、pageHeight: ページの高さ（pt）
export function pageToLines(items, pageWidth, pageHeight, vertical) {
  const glyphs = toGlyphs(items);
  if (!glyphs.length) return { lines: [], vertical };
  const { base, body: all } = bodyGlyphs(glyphs);
  // 縦書きページの中の横書き（ページ番号など）は、それだけで1行として扱う
  const isHorizontalRun = (g) => vertical && [...g.str].length > 1 && g.w > g.size * 1.2;
  const body = all.filter((g) => !isHorizontalRun(g));
  const extra = all.filter(isHorizontalRun).map((g) => ({ text: g.str.trim(), start: pageHeight - g.y, end: pageHeight - g.y + g.size, size: g.size }));

  // 行（縦書きでは列）ごとにまとめる
  const keyOf = (g) => (vertical ? g.x + g.size / 2 : g.y);
  const sorted = [...body].sort((a, b) => keyOf(b) - keyOf(a)); // 縦：右の列から、横：上の行から
  const groups = [];
  for (const g of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.key - keyOf(g)) < base * 0.6) last.items.push(g);
    else groups.push({ key: keyOf(g), items: [g] });
  }

  // 行内の並び：縦は上から（y が大きい順）、横は左から。
  // 大きく離れた部分（演技の指示スペースなど）は別の行として切り出す
  const lines = groups.flatMap((grp) => {
    const its = grp.items.sort((a, b) => (vertical ? b.y - a.y : a.x - b.x));
    const segs = [];
    let seg = null;
    for (const g of its) {
      const start = vertical ? pageHeight - g.y : g.x;
      const len = vertical ? g.size * [...g.str].length : (g.w || g.size * [...g.str].length);
      if (seg && start - seg.end > base * 4) seg = null;
      if (!seg) {
        seg = { text: '', start, end: start, sizes: [], afterGap: segs.length > 0 };
        segs.push(seg);
      } else if (start - seg.end > base * 0.8) {
        seg.text += '　'.repeat(Math.max(1, Math.round((start - seg.end) / base)));
      }
      seg.text += g.str;
      seg.end = start + len;
      seg.sizes.push(g.size);
    }
    return segs.map(({ sizes, ...s }) => ({ ...s, text: s.text.replace(/\s+$/, ''), size: median(sizes) }));
  }).filter((l) => l.text.trim());

  return { lines: [...lines, ...extra], vertical, pageWidth, pageHeight };
}

// ---------- 2. 行 → 脚本 ----------

const PAGE_NUM_RE = /^[\s\-－–—ー]*[0-9０-９]+[\s\-－–—ー]*$/;
const CHAPTER_RE = /^(?:第\s*)?([0-9０-９]+|[一二三四五六七八九十百〇]+)\s*(章|場|幕|景)\s*(.*)$/;
const CAST_HEAD_RE = /^(配\s*役|登\s*場\s*人\s*物|キャスト|CAST|Cast)\s*$/;
const NOTE_RE = /^[（(](.+)[)）]$/;
const BAD_NAME_END = /[はがをにとのもへでや、。！？…]$/;

function stripPrefix(name) {
  return name.replace(/^[\s　]+|[\s　]+$/g, '');
}

// pages: pageToLines の結果の配列
export function parsePages(pages) {
  const report = { pages: pages.length, lines: 0, dialogues: 0, directions: 0, chapters: 0, situations: 0, notes: 0, characters: 0, castRows: 0, vertical: false };
  const all = [];
  pages.forEach((p, pi) => {
    // ページの本文の左右（上下）端
    const longLines = p.lines.filter((l) => [...l.text].length > 6 && !l.afterGap);
    const minStart = Math.min(...(longLines.length ? longLines : p.lines).map((l) => l.start));
    const maxEnd = Math.max(...(longLines.length ? longLines : p.lines).map((l) => l.end));
    for (const l of p.lines) {
      const t = l.text.trim();
      if (PAGE_NUM_RE.test(t) || /^[\-－–—ー\s]+$/.test(t) || t === 'メモ' || t === '演技の指示') continue;
      all.push({ ...l, text: t, page: pi, minStart, maxEnd });
    }
  });
  report.lines = all.length;
  report.vertical = pages.filter((p) => p.vertical).length > pages.length / 2;

  let title = '', author = '';
  let idx = 0;

  // 表紙：1ページ目が数行しかないとき
  if (pages.length > 1) {
    const firstPage = all.filter((l) => l.page === 0);
    if (firstPage.length && firstPage.length <= 4 && !firstPage.some((l) => CAST_HEAD_RE.test(l.text))) {
      title = firstPage[0].text.replace(/\s+/g, '');
      author = firstPage[1] ? firstPage[1].text : '';
      idx = firstPage.length;
    }
  }

  // 配役表
  const cast = [];
  const castHead = all.findIndex((l, i) => i >= idx && CAST_HEAD_RE.test(l.text));
  const skip = new Set();
  if (castHead !== -1) {
    skip.add(castHead);
    for (let i = castHead + 1; i < all.length && all[i].page === all[castHead].page; i++) {
      if (CHAPTER_RE.test(all[i].text)) break;
      const m = all[i].text.match(/^(.+?)(?:[（(]([ぁ-ゖー]+)[)）])?(?:[\s　…‥・.．\-─―]{1,})(.+)$/);
      const nameOnly = all[i].text.match(/^([^\s　]+?)(?:[（(]([ぁ-ゖー]+)[)）])?$/);
      if (m) cast.push({ name: stripPrefix(m[1]), reading: m[2] || '', actor: stripPrefix(m[3].replace(/^[…‥・.．\-─―]+/, '')) });
      else if (nameOnly) cast.push({ name: nameOnly[1], reading: nameOnly[2] || '', actor: '' });
      else break;
      skip.add(i);
    }
  }
  report.castRows = cast.length;

  // 話者らしい名前を数える（ト書きの誤検出を避けるため、何度も出てくる名前だけ採用）
  const SPEAK_A = /^([^\s　「」『』（）()、。：:]{1,12})[\s　]*「(.*)$/;
  const SPEAK_B = /^([^\s　「」：:（）()]{1,10})[\s　]*[：:][\s　]*(.+)$/;
  const SPEAK_C = /^([^\s　「」（）()、。]{1,8})[\s　]+(.+)$/;
  const counts = { A: new Map(), B: new Map(), C: new Map() };
  for (let i = idx; i < all.length; i++) {
    if (skip.has(i)) continue;
    for (const [k, re] of [['A', SPEAK_A], ['B', SPEAK_B], ['C', SPEAK_C]]) {
      const m = all[i].text.match(re);
      if (m && !BAD_NAME_END.test(m[1]) && !CHAPTER_RE.test(all[i].text)) counts[k].set(m[1], (counts[k].get(m[1]) || 0) + 1);
    }
  }
  const castNames = new Set(cast.map((c) => c.name));
  const okName = (k, name) => castNames.has(name)
    || (k === 'A' && (counts.A.get(name) || 0) >= 2)
    // 「名前「」の形は、ひらがなだけでない短い名前なら1回でも採用（「そして「…」のような誤検出を避ける）
    || (k === 'A' && name.length <= 6 && !/^[ぁ-ゖー]+$/.test(name))
    || (k === 'B' && (counts.B.get(name) || 0) >= 2)
    || (k === 'C' && (counts.C.get(name) || 0) >= 3);

  function matchSpeaker(text) {
    for (const [k, re] of [['A', SPEAK_A], ['B', SPEAK_B], ['C', SPEAK_C]]) {
      const m = text.match(re);
      if (m && !BAD_NAME_END.test(m[1]) && okName(k, m[1])) return { kind: k, name: m[1], rest: m[2], prefixLen: text.length - m[2].length };
    }
    return null;
  }

  const blocks = [];
  const names = new Map(); // name -> 登場順
  let cur = null;           // 続きを受け付けているセリフ
  let noteLine = null;      // 演技の指示スペースに書かれた、直前の指示の行
  let lastDir = null;       // 折り返しで続いているかもしれないト書き

  const isCentered = (l) => {
    const span = l.maxEnd - l.minStart;
    if (span <= 0) return false;
    const lead = l.start - l.minStart, trail = l.maxEnd - l.end;
    return lead > span * 0.15 && trail > span * 0.15 && Math.abs(lead - trail) < span * 0.08;
  };
  const wrapped = (l) => l.maxEnd - l.end < l.size * 2.2; // 行末まで埋まっている＝折り返し

  for (let i = idx; i < all.length; i++) {
    if (skip.has(i)) continue;
    const l = all[i];
    const text = l.text;

    // 演技の指示スペース（行の終わり側に離れて書かれた部分）
    const inBand = l.maxEnd > l.minStart && (l.start - l.minStart) / (l.maxEnd - l.minStart) > 0.6;
    if (l.afterGap && cur && !cur.block.note) {
      cur.block.note = text;
      noteLine = l;
      report.notes++;
      continue;
    }
    if (noteLine && cur && inBand && Math.abs(l.start - noteLine.start) < l.size * 1.5) {
      cur.block.note += text;
      noteLine = l;
      continue;
    }
    if (l.afterGap && inBand) continue; // どのセリフの指示か分からないものは読み飛ばす

    const ch = text.match(CHAPTER_RE);
    if (ch && text.length <= 30) {
      blocks.push({ type: 'chapter', text: ch[3].trim() });
      report.chapters++;
      cur = null; lastDir = null;
      continue;
    }

    const sp = matchSpeaker(text);
    if (sp) {
      if (!names.has(sp.name)) names.set(sp.name, names.size);
      let body = sp.rest;
      let open = sp.kind === 'A';
      if (open && /」\s*$/.test(body)) { body = body.replace(/」\s*$/, ''); open = false; }
      noteLine = null;
      cur = { block: { type: 'dialogue', name: sp.name, text: body, note: '' }, open, kind: sp.kind,
        textStart: l.start + sp.prefixLen * l.size, lastLine: l };
      blocks.push(cur.block);
      report.dialogues++;
      lastDir = null;
      continue;
    }

    // セリフの下の（演技の指示）
    const note = text.match(NOTE_RE);
    if (cur && note && !cur.open && !cur.block.note && Math.abs(l.start - cur.textStart) < l.size * 1.5) {
      cur.block.note = note[1];
      report.notes++;
      continue;
    }

    // セリフの続き
    if (cur) {
      const aligned = Math.abs(l.start - cur.textStart) < l.size * 1.2;
      if (cur.open || (cur.kind !== 'A' && aligned)) {
        let body = text;
        const closes = cur.open && /」\s*$/.test(body);
        if (closes) body = body.replace(/」\s*$/, '');
        cur.block.text += (wrapped(cur.lastLine) ? '' : '\n') + body;
        cur.lastLine = l;
        if (closes) cur.open = false;
        continue;
      }
    }
    cur = null;

    if (isCentered(l)) {
      blocks.push({ type: 'situation', text });
      report.situations++;
      lastDir = null;
      continue;
    }

    // ト書き（前の行が行末まで埋まっていれば同じ段落の折り返し）
    if (lastDir && wrapped(lastDir.lastLine) && Math.abs(l.start - lastDir.lastLine.start) < l.size * 4.5) {
      lastDir.block.text += text;
      lastDir.lastLine = l;
      continue;
    }
    const block = { type: 'direction', text };
    blocks.push(block);
    report.directions++;
    lastDir = { block, lastLine: l };
  }

  // 人物：配役表の順 → 本文に出てきた順
  const characters = [...cast];
  for (const name of names.keys()) if (!castNames.has(name)) characters.push({ name, reading: '', actor: '' });
  report.characters = characters.length;

  return { title, author, characters, blocks, report };
}
