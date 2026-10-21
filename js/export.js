// テキスト（.txt）と Word（.docx）への書き出し
import { chapterLabel, hasKanji } from './util.js';
import { fontById } from './fonts.js';

const charMap = (script) => new Map(script.characters.map((c) => [c.id, c]));
const nameOf = (c) => (c ? c.name : '人物？');

// ルビを付けるかどうか（印刷と同じ設定に従う）
function rubyDecider(script) {
  const seen = new Set();
  return (charId) => {
    const mode = script.settings.ruby;
    const first = !seen.has(charId);
    seen.add(charId);
    return mode === 'all' || (mode === 'first' && first);
  };
}

// ============ テキスト ============

export function scriptToText(script) {
  const st = script.settings;
  const chars = charMap(script);
  const out = [script.title || '無題'];
  if (script.author) out.push(script.author);
  out.push('');

  if (script.characters.length) {
    const hasActors = script.characters.some((c) => c.actor.trim());
    out.push(hasActors ? '【配役】' : '【登場人物】');
    for (const c of script.characters) {
      const role = c.reading && hasKanji(c.name) ? `${c.name}（${c.reading}）` : c.name;
      out.push(hasActors && c.actor.trim() ? `${role}……${c.actor.trim()}` : role);
    }
    out.push('');
  }

  const indent = '　'.repeat(st.directionIndent || 0);
  let chapterNo = 0;
  for (const b of script.blocks) {
    switch (b.type) {
      case 'dialogue': {
        const name = nameOf(chars.get(b.charId));
        const pad = '　'.repeat(name.length + 1);
        out.push(`${name}「${b.text.split('\n').join(`\n${pad}`)}」`);
        break;
      }
      case 'direction':
        out.push(b.text.split('\n').map((l) => indent + l).join('\n'));
        break;
      case 'situation':
        out.push('', b.text.split('\n').map((l) => '　'.repeat(8) + l).join('\n'));
        break;
      case 'chapter':
        chapterNo++;
        out.push('', `${chapterLabel(chapterNo, st.chapterFormat)}　${b.text}`.trim(), '');
        break;
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

// ============ Word (.docx) ============

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Word で指定するフォント名（端末標準は Windows / Mac の代表的な日本語フォントに）
function wordFont(id) {
  if (id === 'serif-system') return '游明朝';
  if (id === 'sans-system') return '游ゴシック';
  return fontById(id).family;
}

export function scriptToDocx(script) {
  const st = script.settings;
  const chars = charMap(script);
  const useRuby = rubyDecider(script);
  const vertical = st.writingMode === 'vertical';
  const sz = Math.round(st.fontSize * 2); // ハーフポイント
  const charTw = st.fontSize * 20;        // 1文字ぶんの幅（twip）

  const textRuns = (text, rpr = '') => text.split('\n').map((line, i) =>
    `${i ? '<w:r><w:br/></w:r>' : ''}<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`).join('');

  const nameRun = (c, ruby) => {
    const base = nameOf(c);
    if (!ruby || !c || !c.reading || !hasKanji(c.name)) return textRuns(base, '<w:b/>');
    const rsz = Math.max(8, Math.round(sz / 2));
    return `<w:r><w:ruby><w:rubyPr><w:rubyAlign w:val="center"/><w:hps w:val="${rsz}"/><w:hpsRaise w:val="${sz}"/><w:hpsBaseText w:val="${sz}"/><w:lid w:val="ja-JP"/></w:rubyPr>`
      + `<w:rt><w:r><w:rPr><w:sz w:val="${rsz}"/><w:szCs w:val="${rsz}"/></w:rPr><w:t>${esc(c.reading)}</w:t></w:r></w:rt>`
      + `<w:rubyBase><w:r><w:rPr><w:b/></w:rPr><w:t>${esc(base)}</w:t></w:r></w:rubyBase></w:ruby></w:r>`;
  };

  const para = (runs, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs}</w:p>`;
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const body = [];

  if (st.printTitlePage) {
    const big = Math.round(sz * 2.6);
    body.push(para('', '<w:spacing w:before="2400"/>'));
    body.push(para(textRuns(script.title || '無題', `<w:b/><w:sz w:val="${big}"/><w:szCs w:val="${big}"/>`), '<w:jc w:val="center"/>'));
    if (script.author) body.push(para(textRuns(script.author, `<w:sz w:val="${Math.round(sz * 1.3)}"/>`), '<w:jc w:val="center"/><w:spacing w:before="600"/>'));
    body.push(pageBreak);
  }

  if (st.printCastPage && script.characters.length) {
    const hasActors = script.characters.some((c) => c.actor.trim());
    const roleW = Math.max(...script.characters.map((c) => c.name.length)) + 5;
    body.push(para(textRuns(hasActors ? '配役' : '登場人物', `<w:b/><w:sz w:val="${Math.round(sz * 1.3)}"/>`), '<w:spacing w:after="240"/>'));
    for (const c of script.characters) {
      const ppr = `<w:tabs><w:tab w:val="left" w:pos="${Math.round(roleW * charTw)}"/></w:tabs><w:ind w:left="${Math.round(2 * charTw)}"/>`;
      body.push(para(nameRun(c, st.ruby !== 'none') + (hasActors ? `<w:r><w:tab/></w:r>${textRuns(c.actor.trim())}` : ''), ppr));
    }
    body.push(pageBreak);
  }

  let chapterNo = 0;
  let hasContent = false;
  for (const b of script.blocks) {
    switch (b.type) {
      case 'dialogue': {
        const c = chars.get(b.charId);
        const n = nameOf(c).length + 1;
        const ind = `<w:ind w:left="${Math.round(n * charTw)}" w:leftChars="${n * 100}" w:hanging="${Math.round(n * charTw)}" w:hangingChars="${n * 100}"/>`;
        body.push(para(nameRun(c, useRuby(b.charId)) + textRuns('「') + textRuns(b.text) + textRuns('」'), ind));
        break;
      }
      case 'direction': {
        const k = st.directionIndent || 0;
        body.push(para(textRuns(b.text), k ? `<w:ind w:left="${Math.round(k * charTw)}" w:leftChars="${k * 100}"/>` : ''));
        break;
      }
      case 'situation':
        body.push(para(''));
        body.push(para(textRuns(b.text), '<w:jc w:val="center"/>'));
        break;
      case 'chapter': {
        chapterNo++;
        const brk = st.chapterPageBreak && hasContent ? '<w:pageBreakBefore/>' : '';
        const label = `${chapterLabel(chapterNo, st.chapterFormat)}${b.text ? `　${b.text}` : ''}`;
        // 縦書きでは「左揃え」が行の頭（上）になる
        body.push(para(textRuns(label, `<w:b/><w:sz w:val="${Math.round(sz * 1.15)}"/>`),
          `${brk}<w:jc w:val="${vertical ? 'left' : 'right'}"/><w:spacing w:before="${hasContent && !brk ? 240 : 0}" w:after="120"/>`));
        break;
      }
    }
    hasContent = true;
  }

  const [w, h] = st.orientation === 'landscape' ? [16838, 11906] : [11906, 16838];
  const footerRef = st.pageNumbers ? '<w:footerReference w:type="default" r:id="rIdFooter"/>' : '';
  const sect = `<w:sectPr>${footerRef}<w:pgSz w:w="${w}" w:h="${h}"${st.orientation === 'landscape' ? ' w:orient="landscape"' : ''}/>`
    + '<w:pgMar w:top="1134" w:right="1134" w:bottom="1247" w:left="1134" w:header="567" w:footer="510" w:gutter="0"/>'
    + (st.pageNumbers && st.printTitlePage ? '<w:pgNumType w:start="0"/><w:titlePg/>' : '')
    + (vertical ? '<w:textDirection w:val="tbRl"/>' : '')
    + '</w:sectPr>';

  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const font = esc(wordFont(st.font));
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '</Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
      + '</Relationships>',
    'docProps/core.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
      + `<dc:title>${esc(script.title || '')}</dc:title><dc:creator>${esc(script.author || '')}</dc:creator>`
      + `<dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:modified>`
      + '</cp:coreProperties>',
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
      + '</Relationships>',
    'word/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>`
      + `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:eastAsia="${font}" w:hAnsi="${font}" w:cs="${font}"/>`
      + `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="ja-JP" w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault>`
      + `<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${Math.round(st.lineHeight * 200)}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
      + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
      + '</w:styles>',
    'word/footer1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:jc w:val="center"/></w:pPr>`
      + '<w:r><w:t xml:space="preserve">- </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
      + '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> -</w:t></w:r></w:p></w:ftr>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body.join('')}${sect}</w:body></w:document>`,
  };
  return new Blob([zip(files)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// ============ 最小限の ZIP（無圧縮） ============

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zip(files) {
  const enc = new TextEncoder();
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameB = enc.encode(name);
    const data = enc.encode(content);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8
    local.setUint16(8, 0, true);      // 無圧縮
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameB.length, true);
    locals.push(new Uint8Array(local.buffer), nameB, data);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, time, true);
    cen.setUint16(14, date, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameB.length, true);
    cen.setUint32(42, offset, true);
    centrals.push(new Uint8Array(cen.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cenSize = centrals.reduce((n, a) => n + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...locals, ...centrals, new Uint8Array(end.buffer)]);
}
