// 508 문자 폭을 실제 글꼴로 재기(선택 상자·마스크·표 칸·맞춤 공용).
// AutoCAD 는 글꼴 측정(getTextExtents)으로 문자 상자를 구하고 MTEXT 는 저장 때 실제 폭을 채워 둔다.
// 바른 CAD 는 화면이 실제로 그리는 글꼴(text-fonts.js 대응 결과)로 "글자 하나"씩 한 번만 재서 캐시한다:
// 같은 글꼴의 같은 글자는 다시 재지 않으므로 큰 도면에서도 문자 수가 아니라 서로 다른 글자 수만큼만 잰다.
// geometry.js setTextLineMeasurer 로 꽂으면 선택 상자(vertices)·마스크·맞춤이 이 값을 쓴다.
import {fontFamilyFor} from './text-fonts.js';

/** 화면 글꼴 크기 = 문자 높이 × 1.15(view.js·gpu 문자와 같다). 폭 단위는 "높이 1" 기준. */
export const DRAW_EM = 1.15;
const SAMPLE_PX = 100;

/**
 * 측정기 만들기. measure(fontCss, text) → 픽셀 폭(캔버스 measureText). 없으면 null 을 돌려준다.
 * 돌려주는 함수 lineUnits(e, line) 는 geometry.textUnits 와 같은 뜻(높이 1·폭 비율 1 기준 폭).
 */
export function createTextMeasurer(measure, {familyOf = fontFamilyFor} = {}) {
 if (typeof measure !== 'function') return null;
 const families = new Map();   // 'sourceFont\0bigFont' → {family, chars: Map(ch → units)}
 const entry = e => {
  const key = (e?.sourceFont || '') + '\u0000' + (e?.sourceBigFont || '');
  let hit = families.get(key);
  if (!hit) {
   const family = familyOf(e);
   // 같은 CSS 글꼴을 쓰는 다른 이름(romans/simplex 등)은 글자 표를 같이 쓴다.
   const shared = [...families.values()].find(v => v.family === family);
   hit = {family, chars: shared ? shared.chars : new Map()};
   families.set(key, hit);
  }
  return hit;
 };
 const lineUnits = (e, line) => {
  const {family, chars} = entry(e);
  let units = 0;
  for (const ch of String(line ?? '')) {
   let w = chars.get(ch);
   if (w === undefined) {
    const px = Number(measure(`${SAMPLE_PX}px ${family}`, ch));
    w = Number.isFinite(px) && px >= 0 ? px / SAMPLE_PX * DRAW_EM : 0.65;
    chars.set(ch, w);
   }
   units += w;
  }
  return units;
 };
 lineUnits.clear = () => families.clear();       // 웹 글꼴을 다 읽은 뒤 다시 재게
 lineUnits.size = () => [...new Set([...families.values()].map(v => v.chars))].reduce((n, m) => n + m.size, 0);
 return lineUnits;
}

/** 브라우저 캔버스 measureText 로 재는 함수(문서가 없으면 null). */
export function canvasMeasure(doc = globalThis.document) {
 let ctx = null;
 try {
  ctx = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8).getContext('2d') : doc?.createElement?.('canvas')?.getContext?.('2d');
 } catch { ctx = null; }
 if (!ctx) return null;
 return (font, text) => { ctx.font = font; return ctx.measureText(text).width; };
}

/**
 * 문자 상자(문자 기준 좌표, 회전 전): {width, ascent, descent, lines, lineGap}. 그리기와 같은 규칙
 * (줄 간격 1.35, 위 높이 1, 아래 내림 0.25). units 는 geometry.textUnits(측정기가 꽂혀 있으면 실측).
 */
export function textBoxOf(e, units) {
 const lines = String(e?.text ?? '').split('\n'), h = Number(e?.height) || 0, wf = Number(e?.widthFactor) || 1;
 let width = 0.65;
 for (const line of lines) width = Math.max(width, units(e, line));
 return {width: width * h * wf, ascent: h, descent: h * 0.25, lines: lines.length, lineGap: h * 1.35};
}
