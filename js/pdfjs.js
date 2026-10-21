// PDF.js の読み込みと、PDF からの文字の取り出し
import { orientationVotes, decideVertical, pageToLines } from './pdfparse.js';

const BASE = new URL('../vendor/pdfjs/', import.meta.url).href;
let libPromise = null;

export function loadPdfjs() {
  if (!libPromise) {
    libPromise = import(`${BASE}pdf.min.js`).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `${BASE}pdf.worker.min.js`;
      return lib;
    });
    libPromise.catch(() => { libPromise = null; });
  }
  return libPromise;
}

// data は ArrayBuffer。PDF.js は渡したバッファを使い切るので複製して渡す
export async function openPdf(data) {
  const lib = await loadPdfjs();
  return lib.getDocument({
    data: new Uint8Array(data.slice(0)),
    cMapUrl: `${BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${BASE}standard_fonts/`,
    isEvalSupported: false,
  }).promise;
}

// 全ページを行に分ける（向きは文書全体の傾向も見て決める）
export async function extractPages(pdf, onProgress) {
  const raw = [];
  let chars = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    chars += tc.items.reduce((n, i) => n + (i.str ? i.str.trim().length : 0), 0);
    raw.push({ items: tc.items, w: vp.width, h: vp.height, votes: orientationVotes(tc.items) });
    onProgress?.(p, pdf.numPages);
  }
  const tot = raw.reduce((a, r) => ({ v: a.v + r.votes.v, hz: a.hz + r.votes.hz }), { v: 0, hz: 0 });
  const docVertical = tot.v > tot.hz;
  const pages = raw.map((r) => pageToLines(r.items, r.w, r.h, decideVertical(r.votes, docVertical)));
  const first = raw[0];
  return { pages, chars, landscape: first ? first.w > first.h : false };
}
