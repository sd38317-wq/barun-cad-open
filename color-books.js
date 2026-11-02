// ACAD200 721 사용자 색 견본집(색상표).
// AutoCAD: Color/*.acb(PANTONE·RAL·DIC) 16권을 싣고, 색 객체에 bookName·colorName 을 붙인다. RGB 는 파일 안에서 가려져 있다.
// 바른 CAD 가 더 나은 점:
//  - 사용권이 있는 상업 견본집은 싣지 않는다. 사용자가 가진 CSV 또는 RGB 가 드러난 .acb(XML)를 불러와 쓴다.
//  - 견본집은 사용자 설정(localStorage)에 두어 모든 도면에서 쓰고, BRBACKUP 묶음으로 옮길 수 있다(725).
//  - 색 이름으로 찾을 수 있고(부분 일치·대소문자 무시), 같은 색은 한 번만 넣는다.
export const COLOR_BOOKS_KEY = 'barun-colorbooks-v1';
const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(Number(v)) || 0));
const hexOf = (r, g, b) => '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');

/** CSV: 이름,R,G,B (머리글·빈 줄·# 주석 무시). 또는 이름,#RRGGBB */
export function parseColorBookCsv(text, book = '사용자') {
  const out = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cells = line.split(/[,;\t]/).map((s) => s.trim());
    if (cells.length >= 4 && cells.slice(1, 4).every((c) => /^\d{1,3}$/.test(c))) out.push({book, name: cells[0], hex: hexOf(cells[1], cells[2], cells[3])});
    else if (cells.length >= 2 && /^#?[0-9a-f]{6}$/i.test(cells[1])) out.push({book, name: cells[0], hex: '#' + cells[1].replace('#', '').toLowerCase()});
  }
  return dedupe(out);
}
/** RGB 가 드러난 .acb(XML): <bookName>, <colorEntry><colorName>..</colorName><RGB8><red>..</red>.. 만 읽는다. 가려진 RGB8Encrypt 는 읽지 않는다. */
export function parseAcbXml(text) {
  const xml = String(text ?? '');
  if (/<RGB8Encrypt>/i.test(xml) && !/<RGB8>/i.test(xml)) throw Error('이 견본집은 색 값이 가려져 있어 읽을 수 없습니다. CSV(이름,R,G,B)로 바꿔 불러오세요.');
  const book = (/<bookName>([^<]*)<\/bookName>/i.exec(xml)?.[1] || '견본집').trim();
  const out = [];
  for (const m of xml.matchAll(/<colorEntry>([\s\S]*?)<\/colorEntry>/gi)) {
    const body = m[1], name = /<colorName>([^<]*)<\/colorName>/i.exec(body)?.[1]?.trim();
    const pick = (tag) => /<(?:RGB8)>[\s\S]*?<\/RGB8>/i.test(body) ? Number(new RegExp(`<${tag}>(\\d+)</${tag}>`, 'i').exec(body)?.[1]) : NaN;
    const r = pick('red'), g = pick('green'), b = pick('blue');
    if (name && [r, g, b].every(Number.isFinite)) out.push({book, name, hex: hexOf(r, g, b)});
  }
  if (!out.length) throw Error('견본집에서 색을 찾지 못했습니다.');
  return dedupe(out);
}
function dedupe(list) {
  const seen = new Set();
  return list.filter((c) => { const key = c.book + '\u0000' + c.name.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}

export function loadColorBooks(storage) {
  try { const raw = JSON.parse(storage?.getItem(COLOR_BOOKS_KEY) || '[]'); return Array.isArray(raw) ? raw.filter((c) => c && typeof c.name === 'string' && /^#[0-9a-f]{6}$/i.test(c.hex)) : []; } catch { return []; }
}
/** 같은 견본집 이름이면 바꾼다(다시 불러오기). */
export function mergeColorBook(existing, incoming) {
  const books = new Set(incoming.map((c) => c.book));
  return [...existing.filter((c) => !books.has(c.book)), ...incoming];
}
export function saveColorBooks(storage, list) { storage?.setItem(COLOR_BOOKS_KEY, JSON.stringify(list)); return list; }
export function searchColorBooks(list, query, limit = 50) {
  const q = String(query ?? '').trim().toLowerCase();
  return (q ? list.filter((c) => c.name.toLowerCase().includes(q) || c.book.toLowerCase().includes(q) || c.hex === q) : list).slice(0, limit);
}
