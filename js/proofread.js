// 誤字・脱字・表記ゆれのチェック（端末内で完結するルールベース）

// [誤, 正, レベル]  level: error(誤字) / warn(要確認) / info(参考：台詞では意図的な場合も)
const TYPOS = [
  ['シュミレーション', 'シミュレーション', 'error'],
  ['コミニュケーション', 'コミュニケーション', 'error'],
  ['コミュニュケーション', 'コミュニケーション', 'error'],
  ['アボガド', 'アボカド', 'error'],
  ['バトミントン', 'バドミントン', 'error'],
  ['キューピット', 'キューピッド', 'error'],
  ['雰因気', '雰囲気', 'error'],
  ['完壁', '完璧', 'error'],
  ['専問', '専門', 'error'],
  ['講議', '講義', 'error'],
  ['検当', '見当', 'error'],
  ['感概', '感慨', 'error'],
  ['幣社', '弊社', 'error'],
  ['貧欲', '貪欲', 'error'],
  ['因念', '因縁', 'error'],
  ['既製事実', '既成事実', 'error'],
  ['異和感', '違和感', 'error'],
  ['意義申し立て', '異議申し立て', 'error'],
  ['責任転化', '責任転嫁', 'error'],
  ['一同に会', '一堂に会', 'error'],
  ['絶対絶命', '絶体絶命', 'error'],
  ['危機一発', '危機一髪', 'error'],
  ['五里夢中', '五里霧中', 'error'],
  ['自我自賛', '自画自賛', 'error'],
  ['短刀直入', '単刀直入', 'error'],
  ['興味深々', '興味津々', 'error'],
  ['無我無中', '無我夢中', 'error'],
  ['意味深重', '意味深長', 'error'],
  ['一つ返事', '二つ返事', 'error'],
  ['始めまして', '初めまして', 'error'],
  ['うる覚え', 'うろ覚え', 'error'],
  ['ふいんき', 'ふんいき', 'warn'],
  ['いやがおうにも', 'いやがうえにも', 'warn'],
  ['的を得', '的を射', 'warn'],
  ['汚名挽回', '汚名返上', 'warn'],
  ['取り付く暇', '取り付く島', 'warn'],
  ['足元をすくわれ', '足をすくわれ', 'warn'],
  ['采配を振るう', '采配を振る', 'warn'],
  ['怒り心頭に達', '怒り心頭に発', 'warn'],
  ['上や下への', '上を下への', 'warn'],
  ['押しも押されぬ', '押しも押されもせぬ', 'warn'],
  ['体調を壊', '体調を崩', 'warn'],
  ['期待倒れ', '期待外れ', 'warn'],
  ['寸暇を惜しまず', '寸暇を惜しんで', 'warn'],
  ['二の舞を踏', '二の足を踏', 'warn'],
  ['ごさいます', 'ございます', 'error'],
  ['ございまう', 'ございます', 'error'],
  ['くたさい', 'ください', 'error'],
  ['おうきい', 'おおきい', 'error'],
  ['とうり', 'とおり', 'warn'],
  ['とうる', 'とおる', 'warn'],
  ['ちじむ', 'ちぢむ', 'error'],
  ['ちじれ', 'ちぢれ', 'error'],
  ['つずく', 'つづく', 'error'],
  ['つずけ', 'つづけ', 'error'],
  ['ちかずく', 'ちかづく', 'error'],
  ['ちかずい', 'ちかづい', 'error'],
  ['いなづま', 'いなずま', 'warn'],
  ['以外と', '意外と', 'info'],
  ['こんにちわ', 'こんにちは', 'info'],
  ['こんばんわ', 'こんばんは', 'info'],
  ['頭痛が痛', '頭が痛', 'info'],
  ['後で後悔', '後悔', 'info'],
  ['被害を被', '被害を受', 'info'],
];

const RA_NUKI_STEMS = '見|来|食べ|寝|出|着|起き|決め|逃げ|覚え|止め|辞め|変え|信じ|生き|感じ|答え|考え|調べ|教え|借り|降り|浴び|閉じ|続け|受け|助け|分け|避け|開け|上げ|下げ|入れ|任せ|見せ|捨て|建て|育て|耐え|伝え|超え|越え|迎え|数え';

const RULES = [
  {
    id: 'dup-particle',
    level: 'warn',
    re: /([をがのにで])\1+/g,
    // 3文字以上の連続（擬音など）や「ののしる」は対象外
    filter: (m, text) => m[0].length === 2 && !(m[1] === 'の' && text[m.index + 2] === 'し'),
    message: (m) => `助詞「${m[1]}」が重なっています`,
    fix: (m) => m[1],
  },
  {
    id: 'dup-punct',
    level: 'error',
    re: /([、。，．])\1+|、。|。、/g,
    message: () => '句読点が重なっています',
    fix: (m) => (m[0].includes('。') ? '。' : m[1] || '、'),
  },
  {
    id: 'dup-word',
    level: 'warn',
    re: /([一-鿿]{2,})\1/g,
    message: (m) => `「${m[1]}」が続けて2回書かれています`,
    fix: (m) => m[1],
  },
  {
    id: 'halfwidth-kana',
    level: 'error',
    re: /[｡-ﾟ]+/g,
    message: () => '半角カタカナが含まれています',
    fix: (m) => m[0].normalize('NFKC'),
  },
  {
    id: 'halfwidth-mark',
    level: 'info',
    re: /(?<=[぀-ヿ一-鿿])[!?]+|[!?]+(?=[぀-ヿ一-鿿])/g,
    message: () => '半角の「!」「?」です（全角にそろえますか？）',
    fix: (m) => m[0].replace(/!/g, '！').replace(/\?/g, '？'),
  },
  {
    id: 'trailing-space',
    level: 'info',
    re: /[ 　\t]+$/gm,
    message: () => '行末に空白があります',
    fix: () => '',
  },
  {
    id: 'zura',
    level: 'error',
    re: /(?<=[぀-ゟ一-鿿])ずら(?=い|く)/g,
    message: () => '「〜ずらい」は「〜づらい」です',
    fix: () => 'づら',
  },
  {
    id: 'dutsu',
    level: 'warn',
    re: /づつ/g,
    message: () => '「づつ」は現代仮名遣いでは「ずつ」です',
    fix: () => 'ずつ',
  },
  {
    id: 'douri',
    level: 'warn',
    re: /どうり(?!で)/g, // 「どうりで（道理で）」は正しい
    message: () => '「〜どうり」は「〜どおり」です（例：予定どおり）',
    fix: () => 'どおり',
  },
  {
    id: 'yuu',
    level: 'info',
    re: /(と|って)ゆう(?=[のこ。、！？かなだよねっ」]|$)/gm,
    message: () => '「ゆう」は「いう」の誤りかもしれません（台詞の口調なら問題ありません）',
    fix: (m) => `${m[1]}いう`,
  },
  {
    id: 'ra-nuki',
    level: 'info',
    re: new RegExp(`(${RA_NUKI_STEMS})れ(?=る|ない|ます|ません|た|て|なく)`, 'g'),
    message: (m) => `ら抜き言葉「${m[0]}」（台詞なら意図的でも可）`,
    fix: (m) => `${m[1]}られ`,
  },
];

const PAIRS = [['「', '」'], ['『', '』'], ['（', '）'], ['(', ')'], ['【', '】']];

function checkBrackets(text, push) {
  for (const [open, close] of PAIRS) {
    const stack = [];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === open) stack.push(i);
      else if (text[i] === close) {
        if (stack.length) stack.pop();
        else push({ rule: 'bracket', level: 'warn', start: i, end: i + 1, message: `閉じ括弧「${close}」に対応する「${open}」がありません` });
      }
    }
    for (const i of stack) {
      push({ rule: 'bracket', level: 'warn', start: i, end: i + 1, message: `「${open}」が閉じられていません（「${close}」の脱字？）` });
    }
  }
}

// 登場人物名の1文字違い（3文字以上の名前）
function checkNames(text, names, push) {
  for (const name of names) {
    if (name.length < 3) continue;
    const L = name.length;
    for (let i = 0; i + L <= text.length; i++) {
      const w = text.slice(i, i + L);
      if (w === name) { i += L - 1; continue; }
      let diff = 0, pos = -1;
      for (let k = 0; k < L && diff < 2; k++) if (w[k] !== name[k]) { diff++; pos = k; }
      if (diff !== 1) continue;
      // 違う1文字が名前の端の場合は別の語の可能性が高いので、内側の違いだけを拾う
      if (pos === 0 || pos === L - 1) continue;
      if (!/[一-鿿゠-ヿ]/.test(w[pos])) continue;
      push({ rule: 'name', level: 'warn', start: i, end: i + L, message: `人物名「${name}」の誤字かもしれません`, suggestion: name });
    }
  }
}

function textIssues(text, ctx) {
  const out = [];
  const push = (x) => out.push({ found: text.slice(x.start, x.end), ...x });

  for (const [wrong, right, level] of TYPOS) {
    let i = 0;
    while ((i = text.indexOf(wrong, i)) !== -1) {
      push({ rule: 'typo', level, start: i, end: i + wrong.length, message: `「${wrong}」→「${right}」`, suggestion: right });
      i += wrong.length;
    }
  }
  for (const r of RULES) {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(text))) {
      if (m[0] === '') { r.re.lastIndex++; continue; }
      if (r.filter && !r.filter(m, text)) continue;
      push({ rule: r.id, level: r.level, start: m.index, end: m.index + m[0].length, message: r.message(m), suggestion: r.fix ? r.fix(m) : null });
    }
  }
  checkBrackets(text, push);
  checkNames(text, ctx.names, push);
  return out;
}

// 形態素解析（kuromoji）の結果から、余分な文字・重複を見つける
function morphIssues(text, tokens) {
  const out = [];
  const pos = (t) => t.word_position - 1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], prev = tokens[i - 1], next = tokens[i + 1];
    const s = t.surface_form;
    const start = pos(t), end = start + s.length;

    // 「変わるる」「食べるる」：現代語では使わない文語の「る・るる」＝余分な文字
    if (t.pos === '助動詞' && (s === 'る' || s === 'るる') && prev && prev.pos === '動詞') {
      const whole = prev.surface_form + s;
      if (prev.conjugated_form === '基本形') {
        out.push({ rule: 'extra-char', level: 'error', start, end, message: `「${whole}」の「${s}」が余分では？`, suggestion: '' });
      } else if (s === 'るる') {
        out.push({ rule: 'extra-char', level: 'error', start, end, message: `「${whole}」は「${prev.surface_form}る」では？`, suggestion: 'る' });
      }
      continue;
    }

    // 「私はは」「わかったた」：同じ助詞・助動詞が続いている（「ははは」のような3回以上は除く）
    if (prev && (t.pos === '助詞' || t.pos === '助動詞') && prev.pos === t.pos && prev.surface_form === s
        && pos(prev) + s.length === start
        && tokens[i - 2]?.surface_form !== s && next?.surface_form !== s) {
      out.push({ rule: 'dup-token', level: 'error', start, end, message: `「${s}」が2回続いています`, suggestion: '' });
      continue;
    }

    // 「行きまます」：動詞と助動詞の間に紛れ込んだ文字
    if (t.pos === 'フィラー' && prev?.pos === '動詞' && next?.pos === '助動詞' && s.length <= 2) {
      out.push({ rule: 'stray-char', level: 'error', start, end, message: `「${prev.surface_form}${s}${next.surface_form}」の「${s}」が余分では？`, suggestion: '' });
    }
  }
  return out.map((x) => ({ ...x, found: text.slice(x.start, x.end) }));
}

export function runCheck(script, tokenizer = null) {
  const names = script.characters.map((c) => c.name);
  const ignored = new Set(script.ignored);
  const issues = [];
  for (const b of script.blocks) {
    let text = b.text;
    const found = textIssues(text, { names });
    if (tokenizer && text) {
      for (const m of morphIssues(text, tokenizer.tokenize(text))) {
        // 既存のルールと同じ箇所を指摘している場合は重ねない
        if (!found.some((f) => f.start < m.end && m.start < f.end)) found.push(m);
      }
    }
    if (b.type === 'dialogue') {
      if (!text.trim()) found.push({ rule: 'empty', level: 'warn', start: 0, end: 0, found: '', message: 'セリフが空です（脱字？）', suggestion: null });
      if (!b.charId || !script.characters.some((c) => c.id === b.charId)) {
        found.push({ rule: 'nochar', level: 'warn', start: 0, end: 0, found: '', message: '話す人物が設定されていません', suggestion: null });
      }
      if (text.startsWith('「')) found.push({ rule: 'double-quote', level: 'warn', start: 0, end: 1, found: '「', message: '「」は自動で付きます。先頭の「は不要です', suggestion: '' });
      if (text.endsWith('」') && !text.slice(0, -1).includes('「')) {
        found.push({ rule: 'double-quote', level: 'warn', start: text.length - 1, end: text.length, found: '」', message: '「」は自動で付きます。末尾の」は不要です', suggestion: '' });
      }
    }
    // 括弧チェックは、セリフの自動「」と二重チェックにならないように重複を除く
    const uniq = new Map();
    for (const f of found) {
      const key = `${f.rule}:${f.start}:${f.end}`;
      if (uniq.has(key)) continue;
      if (f.rule === 'bracket' && found.some((g) => g.rule === 'double-quote' && g.start === f.start)) continue;
      uniq.set(key, f);
    }
    for (const f of uniq.values()) {
      const ignoreKey = `${b.id}|${f.rule}|${f.found}`;
      if (ignored.has(ignoreKey)) continue;
      issues.push({ ...f, blockId: b.id, ignoreKey, context: context(text, f.start, f.end) });
    }
  }
  const order = { error: 0, warn: 1, info: 2 };
  return issues.sort((a, b) => order[a.level] - order[b.level]);
}

function context(text, s, e) {
  const a = Math.max(0, s - 12), z = Math.min(text.length, e + 12);
  return { before: (a > 0 ? '…' : '') + text.slice(a, s), hit: text.slice(s, e), after: text.slice(e, z) + (z < text.length ? '…' : '') };
}

// 1件の修正を適用。適用できたら true
export function applyFix(script, issue) {
  if (issue.suggestion == null) return false;
  const b = script.blocks.find((x) => x.id === issue.blockId);
  if (!b || b.text.slice(issue.start, issue.end) !== issue.found) return false;
  b.text = b.text.slice(0, issue.start) + issue.suggestion + b.text.slice(issue.end);
  return true;
}

// 修正可能なものをまとめて適用（同じブロック内は後ろから、重なりは飛ばす）
export function applyAll(script, issues) {
  const byBlock = new Map();
  for (const is of issues) {
    if (is.suggestion == null) continue;
    if (!byBlock.has(is.blockId)) byBlock.set(is.blockId, []);
    byBlock.get(is.blockId).push(is);
  }
  let n = 0;
  for (const list of byBlock.values()) {
    list.sort((a, b) => b.start - a.start);
    let limit = Infinity;
    for (const is of list) {
      if (is.end > limit) continue;
      if (applyFix(script, is)) { n++; limit = is.start; }
    }
  }
  return n;
}
