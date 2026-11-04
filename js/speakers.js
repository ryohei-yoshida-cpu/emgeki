// セリフの話者：1人・複数人・全員・モブなどのまとめ役をひとまとめに扱う

export const ALL_ID = '__all__';                           // 「全員」
export const GROUP_KINDS = ['モブ', '脇役', '群衆', '煽り']; // 配役に出すかを選べる役

// セリフの話者IDの配列（1人なら charId、複数なら charIds）
export function speakerIds(b) {
  if (Array.isArray(b.charIds) && b.charIds.length) return b.charIds;
  return b.charId ? [b.charId] : [];
}

export function setSpeakers(b, ids) {
  b.charId = ids[0] || null;
  if (ids.length > 1) b.charIds = [...ids];
  else delete b.charIds;
}

// 同じ話者の組み合わせかを比べるためのキー
export const speakerKey = (b) => [...speakerIds(b)].sort().join('+');

// [{ id, c, name }]（c は登場人物。全員や消えた人物は null）
export function speakersOf(b, charMap) {
  return speakerIds(b).map((id) => {
    if (id === ALL_ID) return { id, c: null, name: '全員' };
    const c = charMap.get(id) || null;
    return { id, c, name: c ? c.name : '人物？' };
  });
}

export const speakerLabel = (b, charMap) => speakersOf(b, charMap).map((s) => s.name).join('・') || '人物？';

// 配役表・配役タブに出す人物か（モブなどは「配役に追加」したときだけ）
export const inCastList = (c) => c.kind !== 'group' || !!c.inCast;

// 本文中の人物名：《@人物ID》で保存し、表示・印刷のときに今の名前に置き換える。
// 名前を変えても本文が自動でついてくる
export const NAME_TOKEN_RE = /《@([A-Za-z0-9_-]+)》/g;
export const nameToken = (id) => `《@${id}》`;

export function resolveNames(text, charMap) {
  return (text || '').replace(NAME_TOKEN_RE, (m, id) => (charMap.get(id) ? charMap.get(id).name : '人物？'));
}

// 書く画面では《名前》と見せる。保存するときは、人物と同じ名前の《》を《@ID》に戻す
export function tokensToDisplay(text, charMap) {
  return (text || '').replace(NAME_TOKEN_RE, (m, id) => `《${charMap.get(id) ? charMap.get(id).name : '人物？'}》`);
}

export function displayToTokens(text, characters) {
  return (text || '').replace(/《([^《》\n@]+)》/g, (m, name) => {
    const c = characters.find((x) => x.name === name);
    return c ? nameToken(c.id) : m;
  });
}

// 印刷・書き出し用：本文・メモ・指示の名前リンクを今の名前にした段落
export function resolveBlock(b, charMap) {
  const r = { ...b, text: resolveNames(b.text, charMap) };
  if (b.note) r.note = resolveNames(b.note, charMap);
  if (b.memo) r.memo = resolveNames(b.memo, charMap);
  return r;
}
