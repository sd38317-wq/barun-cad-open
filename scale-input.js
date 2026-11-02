// ACAD200 716 출력 축척 입력 해석("100", "1:100", "1=100", "2:1", "1/100", 단위 붙은 값).
// AutoCAD -PLOT: ':' 또는 '=' 로 나눠 양쪽을 거리로 읽고(1"=10' 도 받음), 0 이하를 거절한다. 숫자 하나면 (값, 1).
// 바른 CAD 가 더 나은 점:
//  - 숫자 하나는 "1:값" 으로 읽는다(건축 도면은 분모만 말하는 습관 — 100 = 1:100). AutoCAD 는 100 을 100:1 로 읽어 자주 틀린다.
//  - 'mm·cm·m' 단위를 양쪽에 붙일 수 있다(예 "1mm=1m" = 1:1000). 한국어 오류 안내.
//  - 결과는 지금 출력 코드가 쓰는 분모(denominator = 도면/종이) 하나로 넘긴다 → 출력·시트·뷰포트 축척이 같은 함수를 쓴다.
const EPS = 1e-9;
const UNIT_MM = {'': 1, mm: 1, cm: 10, m: 1000, '"': 25.4, in: 25.4, "'": 304.8, ft: 304.8};
const LENGTH = /^(\d+(?:\.\d+)?|\.\d+)(mm|cm|m|in|ft|"|')?$/i;

function readLength(text, fallbackUnit = '') {
  const m = LENGTH.exec(text);
  if (!m) return null;
  return Number(m[1]) * UNIT_MM[(m[2] || fallbackUnit).toLowerCase()];
}

export function parseScaleInput(raw) {
  const t = String(raw ?? '').trim().replace(/\s+/g, '').replace(/：/g, ':');
  if (!t) throw Error('축척을 넣으세요.');
  let paper, model;
  const split = t.match(/^([^:=/]+)[:=/]([^:=/]+)$/);
  if (split) { paper = readLength(split[1]); model = readLength(split[2]); }
  else { paper = 1; model = readLength(t); }
  if (paper === null || model === null || paper === undefined || model === undefined || !Number.isFinite(paper) || !Number.isFinite(model))
    throw Error('축척은 100, 1:100, 1=100, 2:1, 1/50 처럼 넣으세요. 단위(mm·cm·m)를 붙여도 됩니다.');
  if (!(paper > EPS) || !(model > EPS)) throw Error('축척 값은 0보다 커야 합니다.');
  const denominator = model / paper;
  const nice = (n) => Number(n.toPrecision(10));
  const label = denominator >= 1 ? `1:${nice(denominator)}` : `${nice(1 / denominator)}:1`;
  return {paper, model, denominator, label, scale: 1 / denominator};
}

/** 입력 중에 쓰는 너그러운 판: 틀리면 null. */
export function tryParseScale(raw) {
  try { return parseScaleInput(raw); } catch { return null; }
}
