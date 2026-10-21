// 名前の読み仮名を形態素解析（kuromoji）で自動取得する
import { hasKanji, kataToHira } from './util.js';

let tokenizerPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.kuromoji) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('kuromoji を読み込めません'));
    document.head.append(s);
  });
}

export function loadTokenizer() {
  if (!tokenizerPromise) {
    tokenizerPromise = loadScript('vendor/kuromoji/kuromoji.js').then(
      () => new Promise((resolve, reject) => {
        window.kuromoji.builder({ dicPath: 'vendor/kuromoji/dict/' }).build((err, t) => (err ? reject(err) : resolve(t)));
      })
    );
    tokenizerPromise.catch(() => { tokenizerPromise = null; });
  }
  return tokenizerPromise;
}

export const isTokenizerRequested = () => tokenizerPromise !== null;

// { reading: 'ひらがな', complete: 読めなかった漢字が無ければ true }
export async function getReading(name) {
  if (!hasKanji(name)) return { reading: '', complete: true };
  const tokenizer = await loadTokenizer();
  let complete = true;
  const reading = tokenizer.tokenize(name).map((t) => {
    if (t.reading && t.reading !== '*') return kataToHira(t.reading);
    if (!hasKanji(t.surface_form)) return kataToHira(t.surface_form);
    complete = false;
    return t.surface_form;
  }).join('');
  return { reading, complete };
}
