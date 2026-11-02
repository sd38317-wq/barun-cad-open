// 507 SHX 선 글꼴(셰이프) 읽기 — 1단계: 글자별 전진 폭과 선분(획) 목록.
// AutoCAD 는 SHX 를 ldfile/fssrc 로 읽어 글자를 선으로 그린다(한글 빅폰트 whgtxt 등은 TTF 보다 약 1.27배 넓다).
// 바른 CAD 는 Autodesk SHX 를 같이 싣지 않는다(저작권). 사용자 PC 의 AutoCAD Fonts 폴더 등에서 사용자가 고른 파일만 읽는다.
// 결과는 높이 1 기준이라 문자 높이를 곱해 쓴다. 선분은 다음 단계에서 GPU 선 배치에 섞어 그릴 수 있게 [x1,y1,x2,y2] 로 낸다.

/** 16 방향 벡터(셰이프 바이트 하위 4비트). 0 = 동쪽, 반시계로 22.5° 근처씩(실제로는 1:½ 격자). */
const DIRS = [[1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [-0.5, 1], [-1, 1], [-1, 0.5], [-1, 0], [-1, -0.5], [-1, -1], [-0.5, -1], [0, -1], [0.5, -1], [1, -1], [1, -0.5]];
const HEADS = ['AutoCAD-86 shapes 1.0', 'AutoCAD-86 shapes 1.1', 'AutoCAD-86 bigfont 1.0', 'AutoCAD-86 unifont 1.0'];

const s8 = b => (b > 127 ? b - 256 : b);

/**
 * 셰이프 한 개 해석. bytes 는 정의 바이트(이름 뒤부터 끝 0 까지). shapes 는 하위 셰이프(코드 7)용 표.
 * @returns {{advance:number, segments:number[][]}} 셰이프 단위(글꼴 "위 높이" 로 나누기 전)
 */
export function runShape(bytes, {shapes = null, depth = 0} = {}) {
 let x = 0, y = 0, pen = true, scale = 1, i = 0, skip = false;
 const segments = [], stack = [];
 const move = (dx, dy) => {
  const nx = x + dx * scale, ny = y + dy * scale;
  if (!skip) { if (pen && (dx || dy)) segments.push([x, y, nx, ny]); x = nx; y = ny; }
  skip = false;
 };
 const arc = (cx, cy, r, a0, sweep) => {   // 원호를 짧은 선분으로
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 8)));
  let px = cx + r * Math.cos(a0), py = cy + r * Math.sin(a0);
  for (let k = 1; k <= steps; k++) {
   const a = a0 + sweep * k / steps, qx = cx + r * Math.cos(a), qy = cy + r * Math.sin(a);
   if (pen) segments.push([px, py, qx, qy]);
   px = qx; py = qy;
  }
  x = px; y = py;
 };
 const bulgeArc = (dx, dy, bulge) => {      // 끝점(dx,dy)·볼록(-127..127)
  const ex = x + dx * scale, ey = y + dy * scale;
  if (!bulge) { if (pen) segments.push([x, y, ex, ey]); x = ex; y = ey; return; }
  const h = bulge / 127, chord = Math.hypot(ex - x, ey - y); if (chord < 1e-12) return;
  const sweep = 4 * Math.atan(h), r = chord / (2 * Math.sin(Math.abs(sweep) / 2));
  const mx = (x + ex) / 2, my = (y + ey) / 2, d = r * Math.cos(Math.abs(sweep) / 2), nx = -(ey - y) / chord, ny = (ex - x) / chord;
  const side = sweep > 0 ? 1 : -1, cx = mx + nx * d * side, cy = my + ny * d * side;
  arc(cx, cy, r, Math.atan2(y - cy, x - cx), sweep);
  x = ex; y = ey;
 };
 while (i < bytes.length) {
  const b = bytes[i++];
  if (b === 0) break;
  if (b > 0x0f) { const [dx, dy] = DIRS[b & 15], len = b >> 4; move(dx * len, dy * len); continue; }
  const was = skip; skip = false;
  const guard = fn => { if (was) { /* 세로 글꼴 전용 명령은 가로 쓰기에서 건너뛴다 */ } else fn(); };
  switch (b) {
   case 1: guard(() => { pen = true; }); break;
   case 2: guard(() => { pen = false; }); break;
   case 3: { const f = bytes[i++] || 1; guard(() => { scale /= f; }); break; }
   case 4: { const f = bytes[i++] || 1; guard(() => { scale *= f; }); break; }
   case 5: guard(() => { if (stack.length < 4) stack.push([x, y]); }); break;
   case 6: guard(() => { const p = stack.pop(); if (p) { [x, y] = p; } }); break;
   case 7: {
    const code = bytes[i++];
    guard(() => {
     const sub = shapes?.get(code);
     if (sub && depth < 8) {
      const r = runShape(sub, {shapes, depth: depth + 1});
      for (const [a, c, d, e] of r.segments) segments.push([x + a * scale, y + c * scale, x + d * scale, y + e * scale]);
      x += r.advance * scale;
     }
    });
    break;
   }
   case 8: { const dx = s8(bytes[i++]), dy = s8(bytes[i++]); if (was) break; skip = false; move(dx, dy); break; }
   case 9: {
    while (i + 1 < bytes.length) { const dx = s8(bytes[i++]), dy = s8(bytes[i++]); if (!dx && !dy) break; if (!was) move(dx, dy); }
    break;
   }
   case 10: {   // 팔분원 호: 반지름, (부호|시작 팔분|팔분 수)
    const r = bytes[i++], o = bytes[i++];
    if (!was) {
     const ccw = !(o & 0x80), start = (o >> 4) & 7, count = (o & 7) || 8;
     const a0 = start * Math.PI / 4, sweep = (ccw ? 1 : -1) * count * Math.PI / 4, rr = r * scale;
     arc(x - rr * Math.cos(a0), y - rr * Math.sin(a0), rr, a0, sweep);
    }
    break;
   }
   case 11: {   // 분수 호: 시작 오프셋, 끝 오프셋, 반지름(2바이트), 팔분 정보
    const so = bytes[i++], eo = bytes[i++], rh = bytes[i++], rl = bytes[i++], o = bytes[i++];
    if (!was) {
     const ccw = !(o & 0x80), start = (o >> 4) & 7, count = (o & 7) || 8, rr = ((rh << 8) | rl) * scale, dir = ccw ? 1 : -1;
     const a0 = start * Math.PI / 4 + dir * (so / 256) * Math.PI / 4;
     const sweep = dir * (count * Math.PI / 4 - (so / 256) * Math.PI / 4 - (eo ? (1 - eo / 256) * Math.PI / 4 : 0));
     arc(x - rr * Math.cos(a0), y - rr * Math.sin(a0), rr, a0, sweep);
    }
    break;
   }
   case 12: { const dx = s8(bytes[i++]), dy = s8(bytes[i++]), h = s8(bytes[i++]); if (!was) bulgeArc(dx, dy, h); break; }
   case 13: {
    while (i + 1 < bytes.length) { const dx = s8(bytes[i++]), dy = s8(bytes[i++]); if (!dx && !dy) break; const h = s8(bytes[i++]); if (!was) bulgeArc(dx, dy, h); }
    break;
   }
   case 14: skip = true; break;   // 다음 명령은 세로 쓰기 전용
   default: break;
  }
 }
 return {advance: x, segments};
}

const cString = (u8, at) => { let end = at; while (end < u8.length && u8[end] !== 0) end++; return {text: new TextDecoder('latin1').decode(u8.subarray(at, end)), next: end + 1}; };

/**
 * SHX 파일 → {kind, name, above, below, glyphs: Map(code → {advance, segments})}. advance·segments 는 높이 1(위 높이) 기준.
 * 일반 셰이프 글꼴·유니코드 글꼴(unifont)·빅폰트(한글 whgtxt 등, 2바이트 코드)를 읽는다.
 */
export function parseShx(buffer) {
 const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
 const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
 const head = new TextDecoder('latin1').decode(u8.subarray(0, Math.min(40, u8.length)));
 const kind = HEADS.find(h => head.startsWith(h));
 if (!kind) throw Error('SHX 글꼴 파일이 아닙니다(머리글을 모릅니다).');
 let off = head.indexOf('\x1a') + 1; if (off <= 0) throw Error('SHX 머리글 끝(0x1A)을 찾지 못했습니다.');
 const raw = new Map();      // code → bytes(이름 뒤)
 let name = '', above = 1, below = 0;
 const defBytes = bytes => { const {text, next} = cString(bytes, 0); return {text, body: bytes.subarray(next)}; };
 if (kind.includes('unifont')) {
  const count = dv.getUint32(off, true), infoLen = dv.getUint16(off + 4, true); off += 6;
  const info = u8.subarray(off, off + infoLen); off += infoLen;
  const {text, next} = cString(info, 0); name = text; above = info[next] || 1; below = info[next + 1] || 0;
  for (let k = 1; k < count && off + 4 <= u8.length; k++) {
   const code = dv.getUint16(off, true), len = dv.getUint16(off + 2, true); off += 4;
   raw.set(code, defBytes(u8.subarray(off, off + len)).body); off += len;
  }
 } else if (kind.includes('bigfont')) {
  // 빅폰트: 색인 개수, 셰이프 수, 이스케이프 범위 수와 범위, 색인(코드·길이·파일 위치).
  // 앞 두 칸 중 어느 것이 색인 개수인지 파일마다 해석이 엇갈려, 둘 다 읽어 보고 맞는 색인이 많은 쪽을 쓴다.
  const ranges = dv.getUint16(off + 4, true), indexAt = off + 6 + ranges * 4;
  const readIndex = entries => {
   const found = new Map(); let fontName = '', up = 1, down = 0;
   for (let k = 0, at0 = indexAt; k < entries && at0 + 8 <= u8.length; k++, at0 += 8) {
    const code = dv.getUint16(at0, true), len = dv.getUint16(at0 + 2, true), at = dv.getUint32(at0 + 4, true);
    if (!len || at < indexAt || at + len > u8.length) continue;
    const {text, body} = defBytes(u8.subarray(at, at + len));
    if (code === 0) { fontName = text; up = body[0] || 1; down = body[1] || 0; } else found.set(code, body);
   }
   return {found, fontName, up, down};
  };
  const best = [dv.getUint16(off, true), dv.getUint16(off + 2, true)].map(readIndex).sort((a, b) => b.found.size - a.found.size)[0];
  for (const [code, body] of best.found) raw.set(code, body);
  name = best.fontName; above = best.up; below = best.down;
 } else {
  off += 4;   // 처음·끝 번호
  const count = dv.getUint16(off, true); off += 2;
  const index = [];
  for (let k = 0; k < count; k++, off += 4) index.push([dv.getUint16(off, true), dv.getUint16(off + 2, true)]);
  for (const [code, len] of index) {
   const {text, body} = defBytes(u8.subarray(off, off + len)); off += len;
   if (code === 0) { name = text; above = body[0] || 1; below = body[1] || 0; } else raw.set(code, body);
  }
 }
 const glyphs = new Map();
 for (const [code, bytes] of raw) {
  const r = runShape(bytes, {shapes: raw});
  glyphs.set(code, {advance: r.advance / above, segments: r.segments.map(s => s.map(v => v / above))});
 }
 return {kind: kind.includes('bigfont') ? 'bigfont' : kind.includes('unifont') ? 'unifont' : 'shapes', name, above, below, glyphs};
}

/** 문자 코드 → SHX 셰이프 번호. 빅폰트는 CP949(한글 완성형) 2바이트 코드를 쓴다 — 표는 encodeCp949 로 받는다. */
export function shapeCodeFor(ch, font, encodeCp949 = null) {
 const cp = ch.codePointAt(0);
 if (font.kind === 'bigfont') { const code = encodeCp949?.(ch); return code ?? null; }
 return cp;
}

/**
 * 한 줄 폭(높이 1 기준). 글꼴(일반)과 빅폰트를 같이 쓰는 스타일(romans.shx,whgtxt.shx)처럼 fonts 를 앞에서부터 찾는다.
 * 없는 글자는 null 을 돌려줘 부르는 쪽이 다른 측정으로 넘어가게 한다.
 */
export function shxLineUnits(line, fonts, encodeCp949 = null) {
 let units = 0;
 for (const ch of String(line ?? '')) {
  if (ch === ' ') { const sp = fonts.map(f => f.glyphs.get(32)).find(Boolean); units += sp ? sp.advance : 0.5; continue; }
  const g = fonts.map(f => f.glyphs.get(shapeCodeFor(ch, f, encodeCp949))).find(Boolean);
  if (!g) return null;
  units += g.advance;
 }
 return units;
}

/** 저장용 폭 표(코드 → 폭, 소수 4자리). 선분은 크니 저장하지 않는다. */
export function advanceTable(font) {
 return {name: font.name, kind: font.kind, above: font.above, advances: Object.fromEntries([...font.glyphs].map(([c, g]) => [c, Math.round(g.advance * 1e4) / 1e4]))};
}
/** 저장한 폭 표 → shxLineUnits 가 받는 글꼴. */
export function fontFromAdvanceTable(t) {
 return {name: t?.name || '', kind: t?.kind || 'shapes', above: t?.above || 1, below: 0, glyphs: new Map(Object.entries(t?.advances || {}).map(([c, a]) => [Number(c), {advance: Number(a), segments: []}]))};
}

let cp949Table = null;
/**
 * 한글 빅폰트용 CP949 부호기(글자 → 2바이트 코드). 브라우저 TextDecoder('euc-kr') 로 한 번 표를 만든다(처음 한 번 약 2만 4천 칸).
 * 표를 만들 수 없는 곳이면 null.
 */
export function cp949Encoder() {
 if (!cp949Table) {
  let decoder; try { decoder = new TextDecoder('euc-kr'); } catch { return null; }
  cp949Table = new Map();
  const pair = new Uint8Array(2);
  for (let lead = 0x81; lead <= 0xfe; lead++) for (let trail = 0x41; trail <= 0xfe; trail++) {
   pair[0] = lead; pair[1] = trail;
   const ch = decoder.decode(pair);
   if (ch.length === 1 && ch !== '\ufffd' && !cp949Table.has(ch)) cp949Table.set(ch, (lead << 8) | trail);
  }
 }
 return ch => cp949Table.get(ch) ?? null;
}
