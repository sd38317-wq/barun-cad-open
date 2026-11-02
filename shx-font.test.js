// shx-font.js 시험 — 507 SHX 셰이프 해석(직접 만든 작은 SHX 파일로).
import test from 'node:test';
import assert from 'node:assert/strict';
import {cp949Encoder, runShape, parseShx, shxLineUnits, advanceTable, fontFromAdvanceTable} from './shx-font.js';

const enc = s => [...s].map(c => c.charCodeAt(0));
const u16 = v => [v & 255, v >> 8];
const u32 = v => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
/** 일반 셰이프 글꼴: 0 번(이름·위 높이·아래)과 글자들. */
function shapesFile(defs, above = 4) {
 const all = [[0, [...enc('TEST'), 0, above, 1, 0, 0]], ...defs.map(([code, name, bytes]) => [code, [...enc(name), 0, ...bytes, 0]])];
 const head = [...enc('AutoCAD-86 shapes 1.0\r\n\x1a')];
 const index = all.flatMap(([code, bytes]) => [...u16(code), ...u16(bytes.length)]);
 return new Uint8Array([...head, ...u16(0), ...u16(255), ...u16(all.length), ...index, ...all.flatMap(([, b]) => b)]);
}

test('벡터 바이트: 길이·16방향, 펜 올림은 선분을 남기지 않고 전진 폭만 더한다', () => {
 // 0x40 = 길이4 동쪽(그림), 2 펜 올림, 0x20 = 길이2 동쪽
 const r = runShape(Uint8Array.from([0x44, 0x4c, 0x40, 2, 0x20, 0]));
 assert.equal(r.advance, 6);
 assert.deepEqual(r.segments, [[0, 0, 0, 4], [0, 4, 0, 0], [0, 0, 4, 0]]);
});

test('코드 8 (dx,dy)·3/4 배율·5/6 위치 저장·14 세로 전용 건너뛰기', () => {
 const r = runShape(Uint8Array.from([4, 2, 8, 3, 0xfe, 3, 2, 5, 0x14, 6, 14, 8, 50, 50, 0]));
 assert.equal(r.advance, 6);
 assert.deepEqual(r.segments[0], [0, 0, 6, -4]);
 assert.equal(r.segments.length, 2);
});

test('코드 12 볼록 호는 끝점에서 끝나고, 7 하위 셰이프는 이어 붙는다', () => {
 const arc = runShape(Uint8Array.from([12, 4, 0, 127, 0]));
 assert.ok(Math.abs(arc.advance - 4) < 1e-9);
 assert.ok(arc.segments.length >= 4);
 assert.ok(Math.max(...arc.segments.flatMap(s => [Math.abs(s[1]), Math.abs(s[3])])) > 1.9);   // 반원: 높이 2
 const shapes = new Map([[65, Uint8Array.from([0x30, 0])]]);
 assert.equal(runShape(Uint8Array.from([7, 65, 7, 65, 0]), {shapes}).advance, 6);
});

test('일반 SHX 파일: 위 높이로 나눈 폭(높이 1 기준)과 저장 표 왕복', () => {
 const font = parseShx(shapesFile([[65, 'A', [0x42, 0x4e, 2, 0x20]], [32, 'SP', [2, 0x30]]], 4));
 assert.equal(font.kind, 'shapes'); assert.equal(font.name, 'TEST'); assert.equal(font.above, 4);
 assert.equal(font.glyphs.get(65).advance, 10 / 4);
 assert.equal(shxLineUnits('A A', [font]), (10 + 3 + 10) / 4);
 assert.equal(shxLineUnits('AB', [font]), null);                  // 없는 글자는 다른 측정으로 넘긴다
 const back = fontFromAdvanceTable(JSON.parse(JSON.stringify(advanceTable(font))));
 assert.equal(shxLineUnits('A A', [back]), (10 + 3 + 10) / 4);
});

test('빅폰트(2바이트 코드)와 일반 글꼴을 같이 쓰고, 모르는 파일은 한국어 오류', () => {
 const head = [...enc('AutoCAD-86 bigfont 1.0\r\n\x1a')];
 const defs = [[0, [...enc('HAN'), 0, 8, 2, 0]], [0xb0a1, [...enc(''), 0, 0x80, 0]]];   // 가(CP949 B0A1): 폭 8
 const indexAt = head.length + 6 + 4, dataAt = indexAt + defs.length * 8;
 let at = dataAt; const index = defs.flatMap(([code, b]) => { const r = [...u16(code), ...u16(b.length), ...u32(at)]; at += b.length; return r; });
 const file = new Uint8Array([...head, ...u16(defs.length), ...u16(defs.length), ...u16(1), ...u16(0x81), ...u16(0xfe), ...index, ...defs.flatMap(([, b]) => b)]);
 const big = parseShx(file);
 assert.equal(big.kind, 'bigfont'); assert.equal(big.name, 'HAN');
 assert.equal(big.glyphs.get(0xb0a1).advance, 1);
 const latin = parseShx(shapesFile([[65, 'A', [0x40]]], 4));
 assert.equal(shxLineUnits('가A', [latin, big], ch => (ch === '가' ? 0xb0a1 : null)), 2);
 assert.throws(() => parseShx(new Uint8Array(enc('not a font'))), /SHX 글꼴 파일이 아닙니다/);
});

test('CP949 부호기: 가 = B0A1, 힝 = C8FE', () => {
 const encode = cp949Encoder();
 assert.equal(encode('가'), 0xb0a1); assert.equal(encode('힝'), 0xc8fe); assert.equal(encode('A'), null);
});
