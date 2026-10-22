// テキスト・Word の脚本を読み取り、PDF 取り込みと同じ形（parsePages の結果）にする
import { CHAPTER_RE } from './pdfparse.js';

const CAST_HEAD_RE = /^[【\[［]?\s*(配\s*役|登\s*場\s*人\s*物|キャスト)\s*[】\]］]?$/;
const BAD_NAME_END = /[はがをにとのもへでや、。！？…]$/;
const SPEAK_A = /^([^\s　「」『』（）()、。：:]{1,16})[\s　]*「(.*)$/;
const SPEAK_B = /^([^\s　「」：:（）()]{1,10})[\s　]*[：:][\s　]*(.+)$/;
const SPEAK_C = /^([^\s　「」（）()、。]{1,8})[\s　]+(.+)$/;
const EXTRA_RE = /^［(メモ|指示)］(.*)$/;

// lines: [{ text, indent, center }]（indent は行頭の空白の数、center は中央揃え）
export function parseScriptLines(rawLines) {
  const lines = rawLines.map((l) => ({ ...l, text: l.text.replace(/\s+$/, '') }));
  const report = { pages: 0, lines: lines.length, dialogues: 0, directions: 0, chapters: 0, situations: 0, notes: 0, memos: 0, characters: 0, castRows: 0, vertical: false };
  let i = 0;
  const blank = (l) => !l || !l.text.trim();

  // 冒頭：タイトル・作者（最初の空行まで、配役や章が始まる前）
  let title = '', author = '';
  const head = [];
  while (i < lines.length && blank(lines[i])) i++;
  const headStart = i;
  while (i < lines.length && !blank(lines[i]) && head.length < 3) {
    const t = lines[i].text.trim();
    if (CAST_HEAD_RE.test(t) || CHAPTER_RE.test(t) || SPEAK_A.test(t)) break;
    head.push(t);
    i++;
  }
  if (head.length && head.length <= 2) { [title, author = ''] = head; } else { i = headStart; }

  // 配役
  const cast = [];
  while (i < lines.length && blank(lines[i])) i++;
  if (i < lines.length && CAST_HEAD_RE.test(lines[i].text.trim())) {
    i++;
    for (; i < lines.length && !blank(lines[i]); i++) {
      const t = lines[i].text.trim();
      const m = t.match(/^(.+?)(?:[（(]([ぁ-ゖー]+)[)）])?(?:\s*[…‥・.．\-─―\t　]{1,}\s*(.+))?$/);
      if (!m) break;
      cast.push({ name: m[1].trim(), reading: m[2] || '', actor: (m[3] || '').trim() });
    }
  }
  report.castRows = cast.length;

  // 話者らしい名前を数える（ト書きの誤検出を避けるため）
  const counts = { A: new Map(), B: new Map(), C: new Map() };
  for (let k = i; k < lines.length; k++) {
    const t = lines[k].text.trim();
    for (const [key, re] of [['A', SPEAK_A], ['B', SPEAK_B], ['C', SPEAK_C]]) {
      const m = t.match(re);
      if (m && !BAD_NAME_END.test(m[1])) counts[key].set(m[1], (counts[key].get(m[1]) || 0) + 1);
    }
  }
  const castNames = new Set(cast.map((c) => c.name));
  // 「名前「」」「名前：」「名前　」のどの形でも、合わせて2回以上出てくる名前を話者とみなす
  const total = (name) => (counts.A.get(name) || 0) + (counts.B.get(name) || 0) + (counts.C.get(name) || 0);
  // 「名前　セリフ」形式の台本だと分かったら、1回しか出てこない人物も話者とみなす（行頭が字下げされていない行だけ）
  const usesC = [...counts.C.keys()].some((n) => total(n) >= 2 && !BAD_NAME_END.test(n));
  const okName = (key, name, indent = 0) => castNames.has(name)
    || total(name) >= 2
    || (key === 'A' && name.length <= 8 && !/^[ぁ-ゖー]+$/.test(name))
    || (key === 'C' && usesC && indent === 0 && name.length <= 6);

  const blocks = [];
  const names = new Map();
  let cur = null;          // 続きを受け付けているセリフ
  let last = null;         // メモ・指示を付ける先
  let afterBlank = false;

  const push = (b) => {
    blocks.push(b);
    if (b.type !== 'chapter') last = b;
  };

  for (; i < lines.length; i++) {
    const l = lines[i];
    const t = l.text.trim();
    if (!t) { afterBlank = true; if (cur && !cur.open) cur = null; continue; }

    const ex = t.match(EXTRA_RE);
    if (ex && last) {
      if (ex[1] === 'メモ') { last.memo = (last.memo ? `${last.memo}\n` : '') + ex[2]; report.memos++; }
      else { last.note = (last.note ? `${last.note}\n` : '') + ex[2]; report.notes++; }
      continue;
    }

    // 「」が閉じていないセリフの続き
    if (cur && cur.open) {
      let body = t;
      if (/」$/.test(body)) { body = body.slice(0, -1); cur.open = false; }
      cur.block.text += `\n${body}`;
      continue;
    }

    const ch = t.match(CHAPTER_RE);
    if (ch && t.length <= 30) {
      push({ type: 'chapter', text: ch[3].trim() });
      report.chapters++;
      cur = null; afterBlank = false;
      continue;
    }

    let sp = null;
    for (const [key, re] of [['A', SPEAK_A], ['B', SPEAK_B], ['C', SPEAK_C]]) {
      const m = t.match(re);
      if (m && !BAD_NAME_END.test(m[1]) && okName(key, m[1], l.indent) && !(l.indent > 0 && key === 'C')) { sp = { key, name: m[1], rest: m[2] }; break; }
    }
    if (sp) {
      if (!names.has(sp.name)) names.set(sp.name, names.size);
      let body = sp.rest;
      let open = sp.key === 'A';
      if (open && /」$/.test(body)) { body = body.slice(0, -1); open = false; }
      cur = { block: { type: 'dialogue', name: sp.name, text: body, note: '' }, open, key: sp.key };
      push(cur.block);
      report.dialogues++;
      afterBlank = false;
      continue;
    }

    // 行頭が字下げされた行は、直前の「名前：」「名前　」形式のセリフの続き
    if (cur && cur.key !== 'A' && l.indent > 0 && !afterBlank) {
      cur.block.text += `\n${t}`;
      continue;
    }
    cur = null;

    // 中央揃え、または空行のあとで大きく字下げされた行はシチュエーション
    if (l.center || (afterBlank && l.indent >= 6)) {
      push({ type: 'situation', text: t });
      report.situations++;
    } else {
      push({ type: 'direction', text: t });
      report.directions++;
    }
    afterBlank = false;
  }

  const characters = [...cast];
  for (const name of names.keys()) if (!castNames.has(name)) characters.push({ name, reading: '', actor: '' });
  report.characters = characters.length;
  return { title, author, characters, blocks, report };
}

export function textToLines(text) {
  return text.replace(/\r\n?/g, '\n').split('\n').map((s) => {
    const indent = (s.match(/^[\s　]*/) || [''])[0].length;
    return { text: s.slice(indent), indent, center: false };
  });
}

// Word（.docx）から段落ごとの文字を取り出す（ルビの読みは除く）
export async function docxToLines(arrayBuffer) {
  const xml = await readZipEntry(new Uint8Array(arrayBuffer), 'word/document.xml');
  if (!xml) throw new Error('Word の本文が見つかりません');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const out = [];
  for (const p of doc.getElementsByTagNameNS(W, 'p')) {
    let text = '';
    const walk = (node) => {
      for (const n of node.childNodes) {
        if (n.nodeType !== 1) continue;
        if (n.localName === 'rt') continue; // ルビの読み
        if (n.localName === 't') text += n.textContent;
        else if (n.localName === 'tab') text += '　';
        else if (n.localName === 'br' && n.getAttribute('w:type') !== 'page') text += '\n';
        else walk(n);
      }
    };
    walk(p);
    const jc = p.getElementsByTagNameNS(W, 'jc')[0];
    const ind = p.getElementsByTagNameNS(W, 'ind')[0];
    const indent = ind ? Math.round((Number(ind.getAttributeNS(W, 'leftChars') || ind.getAttribute('w:leftChars') || 0)) / 100) : 0;
    const center = jc && (jc.getAttributeNS(W, 'val') || jc.getAttribute('w:val')) === 'center';
    // 段落内の改行は、セリフの続きとして字下げした行に分ける
    text.split('\n').forEach((s, k) => out.push({ text: s, indent: k ? Math.max(indent, 1) : indent, center: !!center }));
    if (!text.trim()) out.push({ text: '', indent: 0, center: false });
  }
  return out;
}

// ZIP から1つのファイルを取り出す（無圧縮と deflate に対応）
async function readZipEntry(bytes, wanted) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let k = bytes.length - 22; k >= Math.max(0, bytes.length - 65557); k--) {
    if (dv.getUint32(k, true) === 0x06054b50) { eocd = k; break; }
  }
  if (eocd < 0) throw new Error('ZIP ではありません');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (name === wanted) {
      const lNameLen = dv.getUint16(local + 26, true);
      const lExtraLen = dv.getUint16(local + 28, true);
      const data = bytes.subarray(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + csize);
      if (method === 0) return dec.decode(data);
      if (method === 8) {
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return dec.decode(await new Response(stream).arrayBuffer());
      }
      throw new Error('対応していない圧縮形式です');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}
