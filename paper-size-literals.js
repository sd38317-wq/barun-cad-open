// 표기 크기 숫자 박기 검사(사장님 2026-10-25 "아예 강제해서 절대 못 하게"): 생성기 코드에 글자·기호 크기를 숫자로 새로 박으면
// 시험(drawing-generator.test.js)이 실패한다. 이미 있는 자리는 test-fixtures/paper-size-literals.json 에 이유와 개수로만 허용(줄이기만 가능).
// 새 표기는 paper-sizes.js 의 paperMm(standard, 키, 축척)으로 쓴다.
import fs from 'node:fs';
import path from 'node:path';
export const PAPER_LITERAL_PATTERNS = {
  literalRadius: /radius:\s*\d{2,}(?![\d.]*\s*\*)/g,       // 원 반지름을 도면 mm 숫자로
  literalHeight: /\bheight:\s*\d{2,}(?![\d.]*\s*\*)/g,     // 글자 높이(또는 그림 높이)를 숫자로
  literalSize: /\bsize:\s*\d{2,}(?![\d.]*\s*\*)/g,         // 기호 크기를 숫자로
  modelTimesUnit: /\b\d{2,}\s*\*\s*UU?\b/g,                // 1/100 기준 도면 mm × 축척 비율(예전 520*U·300*U)
  textMultiple: /\b(?:th|K\.th|h)\s*\*\s*\d*\.?\d+/g,       // 글자 높이의 배수(th*1.5 같은 크기·간격)
  rawTextTable: /annotation\.(?:textHeight|titleHeight)\[/g // 축척별 글자 표 직접 읽기(paperSizes 로)
};
export const PAPER_LITERAL_FILES = (root) => ['drawing-generator.js', ...fs.readdirSync(path.join(root, 'drawing-details')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'test-knowledge.js').map((f) => 'drawing-details/' + f)];
export function countPaperLiterals(root) {
  const out = {};
  for (const f of PAPER_LITERAL_FILES(root)) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    out[f] = Object.fromEntries(Object.entries(PAPER_LITERAL_PATTERNS).map(([k, re]) => [k, (src.match(re) || []).length]).filter(([, n]) => n));
  }
  return out;
}
