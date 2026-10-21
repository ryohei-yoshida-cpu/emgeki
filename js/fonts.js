// フォント一覧と Google Fonts の遅延読み込み

const SERIF = '"Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif JP", "Noto Serif CJK JP", serif';
const SANS = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", YuGothic, "Noto Sans JP", "Noto Sans CJK JP", sans-serif';

export const FONTS = [
  { id: 'serif-system', label: '明朝（端末の標準）', css: SERIF },
  { id: 'sans-system', label: 'ゴシック（端末の標準）', css: SANS },
  { id: 'noto-serif', label: 'Noto Serif JP（明朝）', family: 'Noto Serif JP', gf: 'Noto+Serif+JP:wght@400;700', fallback: SERIF },
  { id: 'noto-sans', label: 'Noto Sans JP（ゴシック）', family: 'Noto Sans JP', gf: 'Noto+Sans+JP:wght@400;700', fallback: SANS },
  { id: 'shippori', label: 'しっぽり明朝', family: 'Shippori Mincho', gf: 'Shippori+Mincho:wght@400;700', fallback: SERIF },
  { id: 'biz-mincho', label: 'BIZ UDP明朝（読みやすい明朝）', family: 'BIZ UDPMincho', gf: 'BIZ+UDPMincho:wght@400;700', fallback: SERIF },
  { id: 'biz-gothic', label: 'BIZ UDPゴシック（読みやすいゴシック）', family: 'BIZ UDPGothic', gf: 'BIZ+UDPGothic:wght@400;700', fallback: SANS },
  { id: 'zen-maru', label: 'Zen丸ゴシック', family: 'Zen Maru Gothic', gf: 'Zen+Maru+Gothic:wght@400;700', fallback: SANS },
  { id: 'klee', label: 'クレー（手書き風）', family: 'Klee One', gf: 'Klee+One:wght@400;600', fallback: SERIF },
  { id: 'yuji', label: '佑字 肅（筆文字）', family: 'Yuji Syuku', gf: 'Yuji+Syuku', fallback: SERIF },
];

export function fontById(id) {
  return FONTS.find((f) => f.id === id) || FONTS[0];
}

export function fontCss(id) {
  const f = fontById(id);
  return f.css || `"${f.family}", ${f.fallback}`;
}

const loading = new Map();

// フォントを読み込み、使える状態になるまで待つ（最大4秒）
export function ensureFont(id) {
  const f = fontById(id);
  if (!f.gf) return Promise.resolve();
  if (loading.has(f.id)) return loading.get(f.id);
  const p = new Promise((resolve) => {
    const done = () => resolve();
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${f.gf}&display=swap`;
    link.onload = () => {
      document.fonts.load(`16px "${f.family}"`, 'あ漢字「」').then(done, done);
    };
    link.onerror = done;
    document.head.append(link);
    setTimeout(done, 4000);
  });
  loading.set(f.id, p);
  return p;
}
