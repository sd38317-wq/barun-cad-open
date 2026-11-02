// 상세도 장(A-5xx) 안 글끼리 겹침 찾기(시험용, 2026-10-30). 글 폭 = 글자 폭 단위(textLineUnits) × 높이
import {textLineUnits} from '../geometry.js';
const textBox = (e) => {const h = e.height || 0, w = textLineUnits(e.text || '') * h * (e.widthFactor || 1), a = e.position, x0 = e.align === 'center' ? a.x - w / 2 : e.align === 'right' ? a.x - w : a.x;return [x0, a.y, x0 + w, a.y + h];};
export function detailTextOverlaps(doc) {
  const out = [];
  for (const sh of doc.sheets.filter((s) => /^A-5/.test(s.number))) {
    const b = sh.bounds, ts = doc.entities.filter((e) => e.type === 'text' && e.position && !e.sheetDecoration && e.text?.trim() && e.position.x >= b.minX && e.position.x <= b.maxX && e.position.y >= b.minY && e.position.y <= b.maxY).map((e) => [e, textBox(e)]);
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
      const [[e, a], [f, c]] = [ts[i], ts[j]], m = 0.2 * Math.min(e.height, f.height);
      if (Math.min(a[2], c[2]) - Math.max(a[0], c[0]) > m && Math.min(a[3], c[3]) - Math.max(a[1], c[1]) > m) out.push(`${sh.number}: ${e.text} | ${f.text}`);
    }
  }
  return out;
}
