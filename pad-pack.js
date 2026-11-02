// 현장 패드 도면 묶음(BPK1) — 사무실 CAD 가 도면을 한 번 "구워" 보내고, 패드가 그대로 GPU 에 올린다.
//
// 왜: 객체를 JSON 으로 보내면 주동딱지(19만 객체)가 174MB·잠근 상자 35MB 라 서버 한도(12MB)를 넘고,
// 폰이 그 JSON 을 읽는 것도 무리다. 여기서는
//   · 곡선·치수·해치 무늬를 PC 와 같은 코드(gpu-scene.js·hatch-patterns.js)로 미리 선으로 바꾸고,
//   · 공유 블록은 정의를 한 번만 넣고 놓인 자리(위치·각도·배율·뒤집기)만 적고,
//   · 좌표는 0.1 단위 정수의 차분으로 저장해 gzip 이 잘 줄인다.
// 패드에서 도면은 고치지 않으므로(7.0 결정) 편집용 정보는 싣지 않는다.
//
// 모양: "BPK1" · u32 머리 길이 · 머리 JSON(utf8) · 4바이트 맞춤 · 배열들. 배열 목록과 위치는 머리 sections 에 있다.
// 집합(set) 0 은 모형 공간, 1.. 은 공유 블록 정의. 집합마다 원점이 있고 좌표는 원점 기준이다.
import {compileGpuScene} from './gpu-scene.js';
import {hatchFamilies, hatchSegments} from './hatch-patterns.js';
import {hatchRings, materializeSharedDrawingReference} from './geometry.js';
import {linetypeDashPattern} from './view.js';

export const PAD_PACK_MAGIC = 'BPK1';
export const PAD_PACK_VERSION = 1;
/** 색·레이어 칸의 특수 값: 놓인 블록(INSERT)의 것을 따른다(BYBLOCK·레이어 0). */
export const INHERIT = 0xfffe;
/** CURVE: 원·호·타원을 쪼갠 선 — 꼭짓점이 끝점이 아니다(온스냅이 가운데 꼭짓점에 붙지 않게). */
export const FLAG_CLOSED = 1, FLAG_POINT = 2, FLAG_PAIRS = 4, FLAG_CURVE = 8;
const ALIGN = {left: 0, center: 1, right: 2, middle: 3};
const TESSELLATE_SCALE = 0.5; // 0.5mm 오차로 곡선을 쪼갠다(PC 화면 1px≈2mm 확대와 같은 정밀도).
const MAX_HATCH_SEGMENTS = 20000, MAX_TOTAL_HATCH_SEGMENTS = 3_000_000;

class Grow {
  constructor(Type, size = 1024) { this.Type = Type; this.a = new Type(size); this.n = 0; }
  push(v) { if (this.n === this.a.length) { const b = new this.Type(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = v; }
  get length() { return this.n; }
  done() { return this.a.subarray(0, this.n); }
}

const finite = Number.isFinite;

/**
 * 도면(또는 패드 스냅샷: {units, layers, entities, sharedBlocks})을 묶음으로 굽는다.
 * 반환 {header, arrays} — encodePadPack 으로 바이트를 만든다.
 */
export function packDrawing(doc, {quantum = 0.1, name = '', revision = ''} = {}) {
  const q = Number(quantum) > 0 ? Number(quantum) : 0.1;
  const layerIndex = new Map(), layers = [];
  for (const layer of doc.layers || []) {
    layerIndex.set(layer.id, layers.length);
    layers.push({id: layer.id, name: layer.name || '', color: layer.color || '#ffffff', visible: layer.visible !== false && !layer.frozen});
  }
  const zeroLayer = (doc.layers || []).find(layer => layer.name === '0')?.id;
  const colorIndex = new Map(), colors = [];
  const colorOf = hex => { const key = String(hex || '#ffffff').toLowerCase(); if (!colorIndex.has(key)) { colorIndex.set(key, colors.length); colors.push(key); } return colorIndex.get(key); };
  const stringIndex = new Map(), strings = [];
  const stringOf = text => { const key = String(text ?? ''); if (!stringIndex.has(key)) { stringIndex.set(key, strings.length); strings.push(key); } return stringIndex.get(key); };

  const A = {
    polyLayer: new Grow(Uint16Array), polyColor: new Grow(Uint16Array), polyStyle: new Grow(Uint16Array), polyFlags: new Grow(Uint8Array), polyLen: new Grow(Uint32Array), polyXY: new Grow(Int32Array, 1 << 16),
    instSet: new Grow(Uint32Array), instLayer: new Grow(Uint16Array), instColor: new Grow(Uint16Array), instStyle: new Grow(Uint16Array), instXY: new Grow(Int32Array), instRot: new Grow(Float32Array), instScale: new Grow(Float32Array), instFlags: new Grow(Uint8Array),
    textLayer: new Grow(Uint16Array), textColor: new Grow(Uint16Array), textXY: new Grow(Int32Array), textHeight: new Grow(Float32Array), textRot: new Grow(Float32Array), textWidth: new Grow(Float32Array), textAlign: new Grow(Uint8Array), textStr: new Grow(Uint32Array),
    fillLayer: new Grow(Uint16Array), fillColor: new Grow(Uint16Array), fillRings: new Grow(Uint32Array), ringLen: new Grow(Uint32Array), ringXY: new Grow(Int32Array),
    curveKind: new Grow(Uint8Array), curveLayer: new Grow(Uint16Array), curveXY: new Grow(Int32Array), curveR: new Grow(Float32Array), curveA0: new Grow(Float32Array), curveA1: new Grow(Float32Array),
  };
  const stats = {items: 0, skipped: 0, clipped: 0, hatchSegments: 0, hatchDense: 0, unsupported: 0};
  // 선 모양 표: 점선 무늬(화면 px, PC 와 같은 linetypeDashPattern) · 굵기 px · 폭(도면 단위, 폭 있는 폴리선).
  // 0 번은 실선 1px. BYBLOCK 선 종류는 INHERIT — 놓인 블록의 모양을 따른다.
  const layerById = new Map((doc.layers || []).map(layer => [layer.id, layer]));
  const styleIndex = new Map([['|1|0', 0]]), styles = [{dash: [], width: 1, cw: 0}];
  const styleOf = (source, item = source) => {
    const layerRecord = layerById.get(source?.layer);
    let type = item?.linetype ?? source?.linetype;
    if (!type || /^bylayer$/i.test(type)) type = layerRecord?.linetype || 'CONTINUOUS';
    if (/^byblock$/i.test(type)) return INHERIT;
    let weight = Number(item?.lineweight ?? source?.lineweight);
    if (!(weight >= 0)) weight = Number(layerRecord?.lineweight);
    if (!(weight >= 0)) weight = 0.25;
    const widthValue = Number(item?.constantWidth ?? source?.constantWidth);
    const cw = widthValue > 0 ? widthValue : 0;
    const dash = linetypeDashPattern(type, Number(item?.linetypeScale ?? source?.linetypeScale) || 1).map(v => Math.round(v * 100) / 100);
    const width = cw > 0 ? 0 : Math.max(1, Math.min(3, Math.round(weight * 8) / 2));
    const key = dash.join(',') + '|' + width + '|' + cw;
    if (!styleIndex.has(key)) { styleIndex.set(key, styles.length); styles.push({dash, width, cw}); }
    return styleIndex.get(key);
  };
  let hatchBudget = MAX_TOTAL_HATCH_SEGMENTS;

  const blockNames = Object.keys(doc.sharedBlocks || {});
  const blockIndex = new Map(blockNames.map((key, i) => [key, i + 1]));
  const modelBounds = boundsOf(doc.entities || []);
  const extent = denseExtent(doc.entities || []) || modelBounds;
  const modelOrigin = modelBounds ? {x: round(((modelBounds.minX + modelBounds.maxX) / 2), 1000), y: round(((modelBounds.minY + modelBounds.maxY) / 2), 1000)} : {x: 0, y: 0};

  const sets = [];
  const writeSet = (name, entities, origin) => {
    const set = {name, origin, poly: [A.polyLen.length, 0], inst: [A.instSet.length, 0], text: [A.textStr.length, 0], fill: [A.fillRings.length, 0], curve: [A.curveKind.length, 0]};
    const qx = x => Math.round((x - origin.x) / q), qy = y => Math.round((y - origin.y) / q);
    const entityOf = new Map();
    const plain = [];
    const remember = e => { entityOf.set(e.id, e); for (const child of e.entities || []) remember(child); };
    for (const e of entities) {
      if (e.sharedBlock && e.clip?.enabled) {
        // 일부만 보이게 잘린 블록은 그 자리에 풀어서 굽는 단계에서 자른다(드물다 — 주동딱지 2만 개 중 24개).
        const inline = materializeSharedDrawingReference(doc, e);
        remember(inline); plain.push(inline); continue;
      }
      if (e.sharedBlock) {
        const target = blockIndex.get(e.sharedBlock);
        if (!target || !e.position) { stats.skipped++; continue; }
        A.instSet.push(target);
        A.instLayer.push(layerOf(e.layer));
        A.instColor.push(colorField(e));
        A.instStyle.push(styleOf(e));
        A.instXY.push(qx(e.position.x)); A.instXY.push(qy(e.position.y));
        A.instRot.push((Number(e.rotation) || 0) * Math.PI / 180);
        A.instScale.push(Number(e.scale) || 1);
        A.instFlags.push(e.mirror === true ? 1 : 0);
        continue;
      }
      remember(e);
      plain.push(e);
      if ((e.type === 'circle' || e.type === 'arc') && e.center && finite(e.radius)) {
        A.curveKind.push(e.type === 'circle' ? 1 : 2);
        A.curveLayer.push(layerOf(e.layer));
        A.curveXY.push(qx(e.center.x)); A.curveXY.push(qy(e.center.y));
        A.curveR.push(e.radius);
        // 도면 모델의 호 각도는 도(°) — 묶음에는 라디안으로 둔다(gpu-scene.js 와 같은 변환).
        A.curveA0.push(e.type === 'arc' ? (Number(e.startAngle) || 0) * Math.PI / 180 : 0);
        A.curveA1.push(e.type === 'arc' ? (Number(e.endAngle) || 0) * Math.PI / 180 : Math.PI * 2);
      }
    }
    const compiled = compileGpuScene(plain, {scale: TESSELLATE_SCALE, origin: {x: 0, y: 0}, polylineLod: false});
    stats.unsupported += compiled.unsupported?.length || 0;
    for (const item of compiled.items) {
      stats.items++;
      if (item.clipMasks?.length) stats.clipped++;
      const source = entityOf.get(item.sourceId) || item.entity || item.curve || null;
      const layer = layerOf(source?.layer);
      const color = source && isByBlock(source) ? INHERIT : colorOf(item.color);
      const masks = item.clipMasks?.length ? item.clipMasks : null;
      if (item.type === 'polyline' || item.type === 'point') {
        const points = item.type === 'point' ? [item.position] : item.points;
        if (!points?.length) { stats.skipped++; continue; }
        const style = item.type === 'point' ? 0 : styleOf(source, item);
        if (masks) {
          // 블록 일부만 보이기(XCLIP): 굽는 자리에서 잘라 둔다 — 패드는 그대로 그린다.
          if (item.type === 'point') { if (insideMasks(points[0].x, points[0].y, masks)) writePoly(layer, color, FLAG_POINT, points, qx, qy); continue; }
          const pieces = clipToMasks(points, item.closed, masks);
          if (pieces.length) writePoly(layer, color, FLAG_PAIRS | (item.curve ? FLAG_CURVE : 0), pieces, qx, qy, style);
          continue;
        }
        writePoly(layer, color, item.type === 'point' ? FLAG_POINT : (item.closed ? FLAG_CLOSED : 0) | (item.curve ? FLAG_CURVE : 0), points, qx, qy, style);
      } else if (item.type === 'text') {
        const e = item.entity || {};
        const p = item.position || e.position;
        if (!p || !String(e.text ?? '').length) { stats.skipped++; continue; }
        if (masks && !insideMasks(p.x, p.y, masks)) continue;
        A.textLayer.push(layer); A.textColor.push(color);
        A.textXY.push(qx(p.x)); A.textXY.push(qy(p.y));
        A.textHeight.push(Number(e.height) || 0);
        A.textRot.push((Number(e.rotation) || 0) * Math.PI / 180);
        A.textWidth.push(Number(e.widthFactor) || 1);
        A.textAlign.push(ALIGN[e.align] ?? 0);
        A.textStr.push(stringOf(e.text));
      } else if (item.type === 'hatch') {
        writeHatch(item.entity, layer, color, qx, qy);
      } else stats.skipped++;
    }
    set.poly[1] = A.polyLen.length - set.poly[0];
    set.inst[1] = A.instSet.length - set.inst[0];
    set.text[1] = A.textStr.length - set.text[0];
    set.fill[1] = A.fillRings.length - set.fill[0];
    set.curve[1] = A.curveKind.length - set.curve[0];
    sets.push(set);
  };

  function layerOf(id) {
    if (id === undefined || id === null) return INHERIT;
    if (zeroLayer !== undefined && id === zeroLayer) return INHERIT;
    return layerIndex.get(id) ?? INHERIT;
  }
  function colorField(e) { return isByBlock(e) ? INHERIT : colorOf(e.color); }
  function writePoly(layer, color, flags, points, qx, qy, style = 0) {
    A.polyLayer.push(layer); A.polyColor.push(color); A.polyStyle.push(style); A.polyFlags.push(flags); A.polyLen.push(points.length);
    let px = 0, py = 0;
    for (const p of points) { const x = qx(p.x), y = qy(p.y); A.polyXY.push(x - px); A.polyXY.push(y - py); px = x; py = y; }
  }
  function writeHatch(e, layer, color, qx, qy) {
    const rings = hatchRings(e);
    if (!rings.length) { stats.skipped++; return; }
    if (e.solid) {
      A.fillLayer.push(layer); A.fillColor.push(color); A.fillRings.push(rings.length);
      for (const ring of rings) {
        A.ringLen.push(ring.length);
        let px = 0, py = 0;
        for (const p of ring) { const x = qx(p.x), y = qy(p.y); A.ringXY.push(x - px); A.ringXY.push(y - py); px = x; py = y; }
      }
      return;
    }
    // 무늬 해치: 무늬 선분만(경계 안쪽, 짝홀 규칙). 경계선은 그리지 않는다 — CAD 도 해치 경계를 따로 그리지 않는다.
    const box = boundsOfPoints(rings.flat());
    const {segments, dense} = hatchSegments(hatchFamilies(e), box, {maxSegments: Math.min(MAX_HATCH_SEGMENTS, hatchBudget)});
    if (dense) { stats.hatchDense++; return; }
    const clipped = [];
    for (const [x0, y0, x1, y1] of segments) clipSegment(x0, y0, x1, y1, rings, clipped);
    if (!clipped.length) return;
    hatchBudget -= clipped.length / 4; stats.hatchSegments += clipped.length / 4;
    const points = [];
    for (let i = 0; i < clipped.length; i += 2) points.push({x: clipped[i], y: clipped[i + 1]});
    writePoly(layer, color, FLAG_PAIRS, points, qx, qy);
  }

  writeSet('', doc.entities || [], modelOrigin);
  for (const key of blockNames) {
    const definition = doc.sharedBlocks[key];
    const origin = definition.origin && finite(definition.origin.x) ? {x: definition.origin.x, y: definition.origin.y} : {x: 0, y: 0};
    writeSet(key, definition.entities || [], origin);
  }

  const header = {
    magic: PAD_PACK_MAGIC, v: PAD_PACK_VERSION, name: String(name || ''), revision: String(revision || ''),
    units: doc.units || 'mm', quantum: q, bounds: modelBounds, extent, layers, styles, colors, strings, sets, stats,
  };
  const arrays = {};
  for (const [key, grow] of Object.entries(A)) arrays[key] = grow.done();
  return {header, arrays};
}

/**
 * 패드 상자(잠그기 전 내용): "BPS1" · u32 머리 길이 · 머리 JSON(이름·판·단위·만든 시각·CAD 가 받는 작업 등) · 도면 묶음(BPK1).
 * 예전 CAD 는 JSON 스냅샷을 보낸다 — decodePadSession 은 그때 null 을 돌려준다.
 */
export const PAD_SESSION_MAGIC = 'BPS1';
export function encodePadSession(meta, packBytes) {
  const head = new TextEncoder().encode(JSON.stringify(meta)), start = align4(8 + head.length);
  const out = new Uint8Array(start + packBytes.length);
  out.set(new TextEncoder().encode(PAD_SESSION_MAGIC), 0);
  new DataView(out.buffer).setUint32(4, head.length, true);
  out.set(head, 8); out.set(packBytes, start);
  return out;
}
export function decodePadSession(bytes) {
  if (bytes.length < 8 || new TextDecoder().decode(bytes.subarray(0, 4)) !== PAD_SESSION_MAGIC) return null;
  const headLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  return {meta: JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headLength))), pack: bytes.subarray(align4(8 + headLength))};
}

/** {header, arrays} → Uint8Array. */
export function encodePadPack({header, arrays}) {
  const sections = [];
  let offset = 0;
  for (const [name, array] of Object.entries(arrays)) {
    offset = align4(offset);
    sections.push({name, type: typeName(array), offset, length: array.length});
    offset += array.byteLength;
  }
  const head = new TextEncoder().encode(JSON.stringify({...header, sections}));
  const start = align4(8 + head.length);
  const out = new Uint8Array(start + align4(offset));
  out.set(new TextEncoder().encode(PAD_PACK_MAGIC), 0);
  new DataView(out.buffer).setUint32(4, head.length, true);
  out.set(head, 8);
  for (const section of sections) {
    const array = arrays[section.name];
    out.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), start + section.offset);
  }
  return out;
}

/**
 * 바이트 → 그리기용 자료. 좌표는 집합 원점 기준 실수(Float64Array, x,y 번갈아)로 푼다.
 * 반환 {header, sets, poly:{layer,color,flags,start,len}, xy, inst, text, fill:{layer,color,rings}, rings:{start,len}, ringXY, curve}
 */
export function decodePadPack(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 8 || new TextDecoder().decode(u8.subarray(0, 4)) !== PAD_PACK_MAGIC) throw Error('도면 묶음 형식이 아닙니다.');
  const headLength = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + headLength)));
  if (header.v !== PAD_PACK_VERSION) throw Error(`도면 묶음 판 ${header.v} 은(는) 이 패드가 읽지 못합니다.`);
  const start = align4(8 + headLength);
  // 바이트가 4바이트 경계에 놓이도록 한 번 복사한다(전송 버퍼가 어긋날 수 있다).
  const body = (u8.byteOffset + start) % 4 === 0 ? u8 : u8.slice();
  const base = body === u8 ? u8.byteOffset + start : start;
  const a = {};
  for (const s of header.sections) {
    const Type = TYPES[s.type];
    if (!Type) throw Error('도면 묶음에 모르는 배열 형식이 있습니다.');
    a[s.name] = new Type(body.buffer, base + s.offset, s.length);
  }
  // 선 모양 칸이 없는 예전 묶음(점선 넣기 전)도 연다: 모두 실선 1px.
  a.polyStyle ||= new Uint16Array(a.polyLen.length); a.instStyle ||= new Uint16Array(a.instSet.length);
  const q = header.quantum;
  const polyStart = new Uint32Array(a.polyLen.length);
  const xy = new Float64Array(a.polyXY.length);
  undelta(a.polyLen, a.polyXY, xy, polyStart, q);
  const ringStart = new Uint32Array(a.ringLen.length);
  const ringXY = new Float64Array(a.ringXY.length);
  undelta(a.ringLen, a.ringXY, ringXY, ringStart, q);
  const fillStart = new Uint32Array(a.fillRings.length);
  for (let i = 0, k = 0; i < a.fillRings.length; i++) { fillStart[i] = k; k += a.fillRings[i]; }
  const scale = arr => Float64Array.from(arr, v => v * q);
  return {
    header, sets: header.sets,
    poly: {layer: a.polyLayer, color: a.polyColor, style: a.polyStyle, flags: a.polyFlags, len: a.polyLen, start: polyStart}, xy,
    inst: {set: a.instSet, layer: a.instLayer, color: a.instColor, style: a.instStyle, xy: scale(a.instXY), rot: a.instRot, scale: a.instScale, flags: a.instFlags},
    text: {layer: a.textLayer, color: a.textColor, xy: scale(a.textXY), height: a.textHeight, rot: a.textRot, width: a.textWidth, align: a.textAlign, str: a.textStr},
    fill: {layer: a.fillLayer, color: a.fillColor, rings: a.fillRings, start: fillStart},
    rings: {len: a.ringLen, start: ringStart}, ringXY,
    curve: {kind: a.curveKind, layer: a.curveLayer, xy: scale(a.curveXY), r: a.curveR, a0: a.curveA0, a1: a.curveA1},
  };
}

/** 모형 공간에 놓인 블록을 끝까지 펼친 목록(중첩 포함): [{set, layer, color, style, m:[a,b,c,d,e,f], mirror}] — 점 p → (a·x+c·y+e, b·x+d·y+f). */
export function flattenInstances(pack, {limit = 2_000_000} = {}) {
  const out = [];
  const {inst, sets} = pack;
  const visit = (setIndex, m, layer, color, style, mirror, depth) => {
    const set = sets[setIndex];
    for (let i = set.inst[0]; i < set.inst[0] + set.inst[1]; i++) {
      if (out.length >= limit || depth > 32) return;
      const r = inst.rot[i], s = inst.scale[i], flip = inst.flags[i] & 1 ? -1 : 1;
      const cos = Math.cos(r) * s, sin = Math.sin(r) * s;
      const local = [cos * flip, sin * flip, -sin, cos, inst.xy[i * 2], inst.xy[i * 2 + 1]];
      const target = inst.set[i], to = sets[target];
      // 정의 원점만큼 먼저 빼고(정의 좌표는 이미 원점 기준) 놓인 자리로 옮긴다 — geometry.js sharedDrawingExpander 와 같다.
      const placed = multiply(m, local);
      const childLayer = inst.layer[i] === INHERIT ? layer : inst.layer[i];
      const childColor = inst.color[i] === INHERIT ? color : inst.color[i];
      const childStyle = inst.style[i] === INHERIT ? style : inst.style[i];
      const childMirror = mirror !== (flip < 0);
      out.push({set: target, layer: childLayer, color: childColor, style: childStyle, m: placed, mirror: childMirror});
      if (to.inst[1]) visit(target, placed, childLayer, childColor, childStyle, childMirror, depth + 1);
    }
  };
  // 모형 공간의 레이어 0 은 그 이름의 레이어 그대로(끄면 숨는다). 블록 안 레이어 0 은 놓인 블록을 따른다.
  const zero = pack.header.layers.findIndex(layer => layer.name === '0');
  visit(0, [1, 0, 0, 1, 0, 0], zero >= 0 ? zero : INHERIT, INHERIT, 0, false, 0);
  return out;
}

/** 보고서 위치도용: 묶음의 모든 선(블록 펼침 포함)을 절대 좌표 선분 [x0,y0,x1,y1,...] 으로. 점·글자 제외, limit 개에서 멈춘다. */
export function packSegments(pack, {limit = 60000} = {}) {
  const out = [], o = pack.sets[0].origin, placed = [{set: 0, m: [1, 0, 0, 1, 0, 0]}, ...flattenInstances(pack)];
  for (const p of placed) {
    const set = pack.sets[p.set], m = p.m;
    for (let i = set.poly[0]; i < set.poly[0] + set.poly[1]; i++) {
      const n = pack.poly.len[i], f = pack.poly.flags[i], s = pack.poly.start[i] * 2;
      if (f & FLAG_POINT || n < 2) continue;
      const at = k => { const x = pack.xy[s + k * 2], y = pack.xy[s + k * 2 + 1]; return [m[0] * x + m[2] * y + m[4] + o.x, m[1] * x + m[3] * y + m[5] + o.y]; };
      const step = f & FLAG_PAIRS ? 2 : 1, end = f & FLAG_PAIRS ? n - 1 : n - 1 + (f & FLAG_CLOSED && n > 2 ? 1 : 0);
      for (let k = 0; k < end; k += step) {
        if (out.length >= limit * 4) return out;
        const a = at(k), b = at((k + 1) % n);
        out.push(Math.round(a[0]), Math.round(a[1]), Math.round(b[0]), Math.round(b[1]));
      }
    }
  }
  return out;
}

function multiply(m, n) {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
function undelta(lens, deltas, out, starts, q) {
  let k = 0;
  for (let i = 0; i < lens.length; i++) {
    starts[i] = k / 2;
    let x = 0, y = 0;
    for (let j = 0; j < lens[i]; j++) { x += deltas[k]; y += deltas[k + 1]; out[k] = x * q; out[k + 1] = y * q; k += 2; }
  }
}
/** 선분을 고리들(짝홀 규칙) 안쪽 조각으로 자른다. 결과는 out 에 x0,y0,x1,y1 로 붙인다. */
function clipSegment(x0, y0, x1, y1, rings, out) {
  const dx = x1 - x0, dy = y1 - y0, ts = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const ex = b.x - a.x, ey = b.y - a.y, den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((a.x - x0) * ey - (a.y - y0) * ex) / den, u = ((a.x - x0) * dy - (a.y - y0) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u < 1) ts.push(t);
    }
  }
  ts.sort((p, r) => p - r);
  let inside = insideRings(x0 + dx * (ts.length ? ts[0] / 2 : 0.5), y0 + dy * (ts.length ? ts[0] / 2 : 0.5), rings), prev = 0;
  ts.push(1);
  for (const t of ts) {
    if (inside && t > prev) out.push(x0 + dx * prev, y0 + dy * prev, x0 + dx * t, y0 + dy * t);
    inside = !inside; prev = t;
  }
}
/** 잘라 보이기 틀(clipMasks: [{points, inverted}]) 모두를 만족하는가 — 보통 틀은 안쪽, 뒤집힌 틀은 바깥쪽만. */
function insideMasks(x, y, masks) {
  for (const mask of masks) if (insideRings(x, y, [mask.points]) === !!mask.inverted) return false;
  return true;
}
/** 선을 틀 안쪽 조각들로 자른다. 반환: 점 목록(두 점씩 한 조각). */
function clipToMasks(points, closed, masks) {
  const out = [], n = points.length, end = n - 1 + (closed && n > 2 ? 1 : 0);
  for (let i = 0; i < end; i++) {
    const a = points[i], b = points[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y, ts = [0, 1];
    for (const mask of masks) {
      const ring = mask.points;
      for (let k = 0; k < ring.length; k++) {
        const c = ring[k], d = ring[(k + 1) % ring.length], ex = d.x - c.x, ey = d.y - c.y, den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / den, u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / den;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
      }
    }
    ts.sort((p, r) => p - r);
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k], t1 = ts[k + 1];
      if (t1 - t0 < 1e-9) continue;
      const mid = (t0 + t1) / 2;
      if (!insideMasks(a.x + dx * mid, a.y + dy * mid, masks)) continue;
      out.push({x: a.x + dx * t0, y: a.y + dy * t0}, {x: a.x + dx * t1, y: a.y + dy * t1});
    }
  }
  return out;
}
function insideRings(x, y, rings) {
  let odd = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) odd = !odd;
  }
  return odd;
}
function isByBlock(e) { return String(e.colorMode || '').toLowerCase() === 'byblock'; }
function boundsOf(entities) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = p => { if (p && finite(p.x) && finite(p.y)) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; } };
  for (const e of entities) { add(e.position); add(e.center); for (const p of e.points || []) add(p); }
  return minX <= maxX ? {minX, minY, maxX, maxY} : null;
}
function boundsOfPoints(points) { return boundsOf([{points}]); }
/** 멀리 떨어진 쓰레기 객체를 빼고 대부분이 모인 범위(객체 기준점의 0.5~99.5%, 10% 여유) — "전체 보기"용. */
function denseExtent(entities) {
  const xs = [], ys = [];
  for (const e of entities) { const p = e.position || e.center || e.points?.[0]; if (p && finite(p.x) && finite(p.y)) { xs.push(p.x); ys.push(p.y); } }
  if (xs.length < 20) return null;
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const at = (a, t) => a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * t)))];
  const minX = at(xs, 0.005), maxX = at(xs, 0.995), minY = at(ys, 0.005), maxY = at(ys, 0.995);
  const mx = (maxX - minX) * 0.1 || 1, my = (maxY - minY) * 0.1 || 1;
  return {minX: minX - mx, minY: minY - my, maxX: maxX + mx, maxY: maxY + my};
}
function round(v, step) { return Math.round(v / step) * step; }
function align4(n) { return (n + 3) & ~3; }
const TYPES = {i32: Int32Array, u32: Uint32Array, u16: Uint16Array, u8: Uint8Array, f32: Float32Array};
function typeName(array) {
  for (const [name, Type] of Object.entries(TYPES)) if (array instanceof Type) return name;
  throw Error('지원하지 않는 배열 형식');
}
