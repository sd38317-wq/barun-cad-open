// 시험용: 계단을 법규에 맞는 크기로 키운 모델 사본(사장님 확정 2026-10-25 — 계단 법규 부적합이면 한 벌 전체를 그리지 않는다).
// BUILDIT 표본(공동주택 한 줄 1,125 < 1,200)처럼 계단이 작은 표본으로 계단과 상관없는 시험을 돌릴 때 쓴다.
// 계단 윤곽의 짧은 변·긴 변을 조금씩 늘려 생성기 자신의 검토(stairGeometry.checks)가 모두 적합이 될 때까지 키운다.
import {stairGeometry, stairReviewRules, stairPartition} from '../drawing-generator.js';

export function legalStairs(model, standard) {
  const m = structuredClone(model);
  for (const e of m.elements.filter((x) => x.kind === 'stair' && x.outline?.length)) {
    const s = m.stories.find((x) => x.id === e.story);if (!s) continue;
    for (let i = 0; i < 80; i++) {
      const G = stairGeometry(e, s.height, stairReviewRules(m, standard.stair, s), stairPartition(m, e));
      if (G.checks.every((c) => c.ok)) break;
      const xs = e.outline.map((p) => p[0]), ys = e.outline.map((p) => p[1]), x1 = Math.max(...xs), y1 = Math.max(...ys);
      const growX = G.long ? 100 : 50, growY = G.long ? 50 : 100;
      e.outline = e.outline.map(([x, y]) => [x === x1 ? x + growX : x, y === y1 ? y + growY : y]);
    }
  }
  return m;
}
