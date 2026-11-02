// ACAD200 712 롤오버 특성 말풍선과 선택 도구 줄.
// AutoCAD: 커서를 올린 객체의 특성 몇 줄을 보여 주고(롤오버), 선택에 따라 리본에 상황 탭을 붙인다(RIBBONCONTEXTSELLIM 넘으면 계산 안 함).
// 바른 CAD 가 더 나은 점:
//  - 포인터가 움직이는 동안에는 아무것도 계산하지 않는다(타이머만 다시 건다). 멈춘 뒤 한 번만 집고(색인 사용), 4줄만 만든다.
//  - 선택 도구 줄은 특성 팔레트가 이미 센 종류별 개수(countTypes)를 그대로 쓴다 → 선택을 한 번 더 훑지 않는다.
export const CONTEXT_TOOLS = Object.freeze({
  text: ['TEXTEDIT', 'TALIGN', 'FINDREPLACE'],
  mtext: ['TEXTEDIT', 'TALIGN', 'FINDREPLACE'],
  hatch: ['HATCHEDIT', 'HATCHMERGE'],
  dimension: ['DIMSTYLE', 'DIMCLEAN', 'DIMTEXTMOVE'],
  block: ['REFEDIT', 'BLOCKREPLACE', 'EXPLODE'],
  polyline: ['PLINEEDIT', 'OFFSET', 'FILLET'],
  line: ['TRIM', 'EXTEND', 'OFFSET'],
});

/** 선택 도구 줄에 둘 명령. counts = [{type, count}] (properties-dock countTypes). 종류가 하나이고 상한 이하일 때만. */
export function contextTools(counts, total, {limit = 2500, known = null} = {}) {
  if (!total || (limit > 0 && total > limit)) return [];
  const types = (counts || []).filter((c) => c.count > 0);
  if (types.length !== 1) return [];
  return (CONTEXT_TOOLS[types[0].type] || []).filter((name) => !known || known.has(name));
}

/** 롤오버 말풍선 줄: 특성 팔레트 칸 앞 4개. */
export function rolloverLines(fields, max = 4) {
  const text = (f) => (Array.isArray(f.options) ? f.options.find(([v]) => String(v) === String(f.value))?.[1] ?? f.value : f.value);
  return (fields || []).filter((f) => f && !f.heading && f.label && f.value !== undefined && f.value !== null && f.value !== '').slice(0, max).map((f) => `${f.label}: ${text(f)}`);
}

/** 멈춤 감지기. move() 는 타이머만 다시 건다(O(1)). 멈추면 onRest(x,y) 한 번. */
export function createRestDetector({delay = 500, onRest, onMove, timers = globalThis}) {
  let timer = 0, last = null;
  return {
    move(x, y) { last = {x, y}; if (timer) timers.clearTimeout(timer); onMove?.(); timer = timers.setTimeout(() => { timer = 0; onRest(last.x, last.y); }, delay); },
    cancel() { if (timer) timers.clearTimeout(timer); timer = 0; },
  };
}
