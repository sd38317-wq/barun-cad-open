// 현장 패드 그리기 — 구운 도면 묶음(pad-pack.js)을 WebGL2 로 그린다.
//
// · 선: 집합(모형 공간·블록 정의)마다 선분 버퍼 하나, 놓인 블록은 인스턴스로 같은 버퍼를 다시 그린다.
// · 색·레이어·선 모양: 정점에는 번호만 두고 표(텍스처)에서 찾는다 — 레이어 끄기·종이/CAD 바꾸기는 표만 고친다.
// · 점선: PC 와 같은 화면 px 무늬를 조각 셰이더가 선을 따라 잰 거리로 끊는다.
// · 굵은 선(1.5px 넘음)·폭 있는 폴리선: 선분마다 사각형(삼각형 둘). 대부분인 얇은 선은 가벼운 LINES 그대로.
// · 채운 해치: 스텐실 짝홀 채우기(삼각분할 없음).
// · 글자: 2D 캔버스 겹(그리기 쉬운 크기만). 손가락이 움직이는 동안은 마지막 그림을 옮겨 보여 준다.
// 좌표는 모형 원점(pack.sets[0].origin) 기준. 화면: sx = x*scale + ox, sy = oy - y*scale.
import {flattenInstances, INHERIT, FLAG_CLOSED, FLAG_POINT, FLAG_PAIRS} from './pad-pack.js';

const COMMON_VS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 aPos;
layout(location=1) in uvec4 aMeta;
layout(location=2) in vec3 aRow0;
layout(location=3) in vec3 aRow1;
layout(location=4) in uvec4 aInst;
layout(location=5) in float aDist;
uniform vec2 uScale;
uniform vec2 uOffset;
uniform float uPx;
uniform float uPointSize;
uniform vec2 uViewport;
uniform highp sampler2D uPalette;
uniform highp sampler2D uLayers;
uniform highp sampler2D uStyles;
uniform vec4 uInherit;
out vec4 vColor;
out float vDist;
flat out uint vStyle;
vec4 fetch(highp sampler2D t, uint i) { return texelFetch(t, ivec2(int(i % 4096u), int(i / 4096u)), 0); }
uint pick(uint own, uint inst) { return own == 65534u ? inst : own; }
vec2 place(vec2 p) { return vec2(dot(aRow0.xy, p) + aRow0.z, dot(aRow1.xy, p) + aRow1.z); }
float shownLayer() { uint layer = pick(aMeta.y, aInst.x); return layer == 65534u ? 1.0 : fetch(uLayers, layer).r; }
void setup() {
  uint color = pick(aMeta.x, aInst.y), style = pick(aMeta.z, aInst.z);
  vStyle = style == 65534u ? 0u : style;
  vDist = aDist * length(aRow0.xy) * uPx;
  vColor = color == 65534u ? uInherit : fetch(uPalette, color);
}
`;
const LINE_VS = COMMON_VS + `
void main() {
  setup();
  gl_Position = shownLayer() < 0.5 ? vec4(4.0, 4.0, 4.0, 1.0) : vec4(place(aPos) * uScale + uOffset, 0.0, 1.0);
  gl_PointSize = uPointSize;
}`;
// 굵은 선: 정점마다 다른 끝(aOther)과 옆(aSide)을 받아 화면에서 수직으로 반 폭만큼 민다.
const WIDE_VS = COMMON_VS + `
layout(location=6) in vec2 aOther;
layout(location=7) in float aSide;
void main() {
  setup();
  vec4 st = texelFetch(uStyles, ivec2(int(vStyle) * 3 + 2, 0), 0);
  float hw = st.y > 0.0 ? max(0.5, st.y * length(aRow0.xy) * uPx * 0.5) : st.x * 0.5;
  vec2 p = place(aPos) * uScale + uOffset, q = place(aOther) * uScale + uOffset;
  vec2 d = (q - p) * uViewport * 0.5;
  vec2 n = length(d) > 1e-6 ? normalize(vec2(-d.y, d.x)) : vec2(0.0, 1.0);
  p += n * aSide * hw / (uViewport * 0.5);
  gl_Position = shownLayer() < 0.5 ? vec4(4.0, 4.0, 4.0, 1.0) : vec4(p, 0.0, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
precision highp int;
in vec4 vColor;
in float vDist;
flat in uint vStyle;
uniform float uAlpha;
uniform highp sampler2D uStyles;
out vec4 outColor;
void main() {
  vec4 a = texelFetch(uStyles, ivec2(int(vStyle) * 3, 0), 0), b = texelFetch(uStyles, ivec2(int(vStyle) * 3 + 1, 0), 0);
  if (b.w > 0.5) {
    float d[6] = float[6](a.x, a.y, a.z, a.w, b.x, b.y);
    float t = mod(vDist, b.z), acc = 0.0;
    for (int i = 0; i < 6; i++) {
      if (float(i) >= b.w) break;
      acc += d[i];
      if (t < acc) { if (i % 2 == 1) discard; break; }
    }
  }
  outColor = vec4(vColor.rgb, vColor.a * uAlpha);
}`;

const QUAD_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
uniform vec4 uRect; // 새 화면에서 사진이 놓일 자리(css px): x0, y0, x1, y1
uniform vec2 uSize;
out vec2 vUv;
void main() {
  vec2 p = mix(uRect.xy, uRect.zw, aCorner);
  vUv = vec2(aCorner.x, 1.0 - aCorner.y);
  gl_Position = vec4(p.x / uSize.x * 2.0 - 1.0, 1.0 - p.y / uSize.y * 2.0, 0.0, 1.0);
}`;
const QUAD_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uImage;
out vec4 outColor;
void main() { outColor = texture(uImage, vUv); }`;

/** 종이 보기: 밝은 선(ACI 7 흰색 등)을 어둡게, 나머지는 조금 진하게. */
export function paperColor(hex) {
  const [r, g, b] = rgb(hex), lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum > 0.72) return [0.106, 0.114, 0.133];
  const k = lum > 0.45 ? 0.62 : 0.85;
  return [r * k, g * k, b * k];
}
function rgb(hex) {
  const s = String(hex || '#ffffff').replace('#', '');
  const v = s.length === 3 ? s.split('').map(c => c + c).join('') : s.padEnd(6, 'f');
  return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) / 255);
}
const uniforms = (gl, program, names) => Object.fromEntries(names.map(n => [n, gl.getUniformLocation(program, n)]));
const UNIFORMS = ['uScale', 'uOffset', 'uPx', 'uPointSize', 'uViewport', 'uPalette', 'uLayers', 'uStyles', 'uInherit', 'uAlpha'];

export function createPadRenderer(canvas, pack, {overlay = null, theme = 'cad'} = {}) {
  const gl = canvas.getContext('webgl2', {antialias: true, stencil: true, alpha: false, preserveDrawingBuffer: false});
  if (!gl) throw Error('이 기기에서 WebGL2 를 쓸 수 없습니다.');
  const lineProgram = link(gl, LINE_VS, FS), wideProgram = link(gl, WIDE_VS, FS);
  const lu = uniforms(gl, lineProgram, UNIFORMS), wu = uniforms(gl, wideProgram, UNIFORMS);
  const quad = link(gl, QUAD_VS, QUAD_FS);
  const qu = {rect: gl.getUniformLocation(quad, 'uRect'), size: gl.getUniformLocation(quad, 'uSize'), image: gl.getUniformLocation(quad, 'uImage')};
  const quadVao = gl.createVertexArray(); gl.bindVertexArray(quadVao);
  const qb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);
  const snapshot = {tex: gl.createTexture(), view: null, w: 0, h: 0};
  gl.bindTexture(gl.TEXTURE_2D, snapshot.tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const {header} = pack, placed = flattenInstances(pack);
  const styles = header.styles?.length ? header.styles : [{dash: [], width: 1, cw: 0}];
  const layerCount = Math.max(1, header.layers.length), colorCount = Math.max(1, header.colors.length);
  const layerShown = new Uint8Array(layerCount).map((_, i) => header.layers[i]?.visible === false ? 0 : 255);
  let mode = theme;

  // ── 표(텍스처) ──
  const tex = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return t; };
  const dims = n => [Math.min(n, 4096), Math.ceil(n / 4096)];
  const paletteTex = tex(), layerTex = tex(), styleTex = tex();
  const uploadPalette = () => {
    const [w, h] = dims(colorCount), data = new Uint8Array(w * h * 4);
    header.colors.forEach((hex, i) => { const c = mode === 'paper' ? paperColor(hex) : rgb(hex); data.set([c[0] * 255, c[1] * 255, c[2] * 255, 255], i * 4); });
    gl.bindTexture(gl.TEXTURE_2D, paletteTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  };
  const uploadLayers = () => {
    const [w, h] = dims(layerCount), data = new Uint8Array(w * h);
    data.set(layerShown);
    gl.bindTexture(gl.TEXTURE_2D, layerTex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  };
  {
    // 선 모양 한 줄 = 텍셀 3개: [d0 d1 d2 d3] [d4 d5 주기 개수] [굵기px 폭 0 0]. 무늬는 6칸까지.
    const count = Math.min(styles.length, 1365), data = new Float32Array(count * 12);
    styles.slice(0, count).forEach((s, i) => {
      const dash = (s.dash || []).slice(0, 6), period = dash.reduce((a, b) => a + b, 0);
      dash.forEach((v, k) => { data[i * 12 + k] = v; });
      data[i * 12 + 6] = period; data[i * 12 + 7] = period > 0 ? dash.length : 0;
      data[i * 12 + 8] = s.width || 1; data[i * 12 + 9] = s.cw || 0;
    });
    gl.bindTexture(gl.TEXTURE_2D, styleTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, count * 3, 1, 0, gl.RGBA, gl.FLOAT, data);
  }
  uploadPalette(); uploadLayers();
  const wideStyle = s => s !== INHERIT && styles[s] && (styles[s].cw > 0 || styles[s].width > 1.5);

  // ── 인스턴스: 집합별로 묶는다(집합 0 = 모형 공간 하나) ──
  const zeroLayer = header.layers.findIndex(layer => layer.name === '0');
  const bySet = new Map([[0, [{layer: zeroLayer >= 0 ? zeroLayer : INHERIT, color: INHERIT, style: 0, m: [1, 0, 0, 1, 0, 0]}]]]);
  for (const p of placed) { if (!bySet.has(p.set)) bySet.set(p.set, []); bySet.get(p.set).push(p); }

  // ── 그리기 묶음 ──
  // 블록 정의: 선 버퍼는 한 번, 놓인 자리는 화면 칸(16×16)별 인스턴스 묶음 — 화면 밖 묶음과 1픽셀보다 작은 묶음은 건너뛴다.
  // 모형 공간: 선을 칸별 버퍼로 나눈다(확대했을 때 화면 밖 칸을 건너뛴다).
  const draws = [];
  let vertexTotal = 0;
  const ext = header.extent || header.bounds || {minX: -1, minY: -1, maxX: 1, maxY: 1}, o0 = pack.sets[0].origin;
  const GRID = 16, gx0 = ext.minX - o0.x, gy0 = ext.minY - o0.y, gw = (ext.maxX - ext.minX) / GRID || 1, gh = (ext.maxY - ext.minY) / GRID || 1;
  const cellOf = (x, y) => Math.min(GRID - 1, Math.max(0, Math.floor((x - gx0) / gw))) * GRID + Math.min(GRID - 1, Math.max(0, Math.floor((y - gy0) / gh)));
  const identity = instanceBuffer(gl, bySet.get(0));
  const polyBox = i => {
    const s = pack.poly.start[i] * 2, n = pack.poly.len[i], b = [Infinity, Infinity, -Infinity, -Infinity];
    for (let k = 0; k < n; k++) { const x = pack.xy[s + k * 2], y = pack.xy[s + k * 2 + 1]; if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
    return b;
  };
  // 선분 목록으로 펼친다: visit(a, b, distA, distB) — 닫힌 선은 끝→처음도, 쌍 선은 두 점씩.
  const eachSegment = (i, visit) => {
    const n = pack.poly.len[i], f = pack.poly.flags[i], s = pack.poly.start[i] * 2, xy = pack.xy;
    const len = (a, b) => Math.hypot(xy[b] - xy[a], xy[b + 1] - xy[a + 1]);
    if (f & FLAG_PAIRS) { for (let k = 0; k + 1 < n; k += 2) { const a = s + k * 2, b = a + 2; visit(a, b, 0, len(a, b)); } return; }
    let d = 0;
    for (let k = 0; k + 1 < n; k++) { const a = s + k * 2, b = a + 2, l = len(a, b); visit(a, b, d, d + l); d += l; }
    if (f & FLAG_CLOSED && n > 2) { const a = s + (n - 1) * 2, b = s; visit(a, b, d, d + len(a, b)); }
  };
  const geometry = polys => {
    let lineVerts = 0, pointVerts = 0, wideVerts = 0;
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const i of polys) {
      const n = pack.poly.len[i], f = pack.poly.flags[i], segs = f & FLAG_PAIRS ? n >> 1 : n > 1 ? n - 1 + (f & FLAG_CLOSED && n > 2 ? 1 : 0) : 0;
      if (f & FLAG_POINT) pointVerts += n;
      else if (wideStyle(pack.poly.style[i])) wideVerts += segs * 6;
      else lineVerts += segs * 2;
      const b = polyBox(i); box[0] = Math.min(box[0], b[0]); box[1] = Math.min(box[1], b[1]); box[2] = Math.max(box[2], b[2]); box[3] = Math.max(box[3], b[3]);
    }
    const L = {pos: new Float32Array(lineVerts * 2), meta: new Uint16Array(lineVerts * 4), dist: new Float32Array(lineVerts)};
    const P = {pos: new Float32Array(pointVerts * 2), meta: new Uint16Array(pointVerts * 4), dist: new Float32Array(pointVerts)};
    const W = {pos: new Float32Array(wideVerts * 2), meta: new Uint16Array(wideVerts * 4), dist: new Float32Array(wideVerts), other: new Float32Array(wideVerts * 2), side: new Float32Array(wideVerts)};
    let li = 0, pi = 0, wi = 0;
    const meta = (arr, k, i) => { arr[k * 4] = pack.poly.color[i]; arr[k * 4 + 1] = pack.poly.layer[i]; arr[k * 4 + 2] = pack.poly.style[i]; };
    for (const i of polys) {
      const f = pack.poly.flags[i];
      if (f & FLAG_POINT) {
        const n = pack.poly.len[i], s = pack.poly.start[i] * 2;
        for (let k = 0; k < n; k++) { P.pos[pi * 2] = pack.xy[s + k * 2]; P.pos[pi * 2 + 1] = pack.xy[s + k * 2 + 1]; meta(P.meta, pi, i); pi++; }
        continue;
      }
      if (wideStyle(pack.poly.style[i])) {
        eachSegment(i, (a, b, da, db) => {
          // 사각형: A+ A- B+ / A- B- B+ (B 쪽은 다른 끝이 A 라 옆 부호가 뒤집힌다)
          for (const [p, q, side, d] of [[a, b, 1, da], [a, b, -1, da], [b, a, -1, db], [a, b, -1, da], [b, a, 1, db], [b, a, -1, db]]) {
            W.pos[wi * 2] = pack.xy[p]; W.pos[wi * 2 + 1] = pack.xy[p + 1]; W.other[wi * 2] = pack.xy[q]; W.other[wi * 2 + 1] = pack.xy[q + 1];
            W.side[wi] = side; W.dist[wi] = d; meta(W.meta, wi, i); wi++;
          }
        });
        continue;
      }
      eachSegment(i, (a, b, da, db) => {
        L.pos[li * 2] = pack.xy[a]; L.pos[li * 2 + 1] = pack.xy[a + 1]; L.dist[li] = da; meta(L.meta, li, i); li++;
        L.pos[li * 2] = pack.xy[b]; L.pos[li * 2 + 1] = pack.xy[b + 1]; L.dist[li] = db; meta(L.meta, li, i); li++;
      });
    }
    return {
      box, lineVerts, pointVerts, wideVerts,
      lines: lineVerts ? buffers(gl, L) : null,
      points: pointVerts ? buffers(gl, P) : null,
      wide: wideVerts ? buffers(gl, W) : null,
    };
  };
  const pushDraws = (geo, inst, count, box, size) => {
    if (geo.lines) draws.push({program: 'line', mode: gl.LINES, count: geo.lineVerts, vao: vao(gl, geo.lines, inst), instances: count, box, size});
    if (geo.points) draws.push({program: 'line', mode: gl.POINTS, count: geo.pointVerts, vao: vao(gl, geo.points, inst), instances: count, box, size});
    if (geo.wide) draws.push({program: 'wide', mode: gl.TRIANGLES, count: geo.wideVerts, vao: vao(gl, geo.wide, inst), instances: count, box, size});
    vertexTotal += (geo.lineVerts + geo.pointVerts + geo.wideVerts) * count;
  };
  for (const [setIndex, instances] of bySet) {
    const set = pack.sets[setIndex], [p0, pn] = set.poly;
    if (!pn) continue;
    if (setIndex === 0) {
      const cells = new Map();
      for (let i = p0; i < p0 + pn; i++) { const b = polyBox(i), key = cellOf((b[0] + b[2]) / 2, (b[1] + b[3]) / 2); if (!cells.has(key)) cells.set(key, []); cells.get(key).push(i); }
      for (const polys of cells.values()) { const geo = geometry(polys); pushDraws(geo, identity, 1, geo.box, Infinity); }
      continue;
    }
    const polys = []; for (let i = p0; i < p0 + pn; i++) polys.push(i);
    const geo = geometry(polys), lb = geo.box;
    const groups = new Map();
    for (const p of instances) {
      const wb = transformBox(p.m, lb), key = cellOf((wb[0] + wb[2]) / 2, (wb[1] + wb[3]) / 2);
      if (!groups.has(key)) groups.set(key, {list: [], box: [Infinity, Infinity, -Infinity, -Infinity], size: 0});
      const g = groups.get(key); g.list.push(p);
      g.box = [Math.min(g.box[0], wb[0]), Math.min(g.box[1], wb[1]), Math.max(g.box[2], wb[2]), Math.max(g.box[3], wb[3])];
      g.size = Math.max(g.size, wb[2] - wb[0], wb[3] - wb[1]);
    }
    for (const g of groups.values()) pushDraws(geo, instanceBuffer(gl, g.list), g.list.length, g.box, g.size);
  }

  // ── 채운 해치: 세계 좌표 부채꼴(고리마다 첫 점 중심) — 스텐실 짝홀 ──
  const fills = [];
  {
    const tris = [], meta = [];
    const addFill = (fi, m, instLayer, instColor) => {
      const layer = pack.fill.layer[fi] === INHERIT ? instLayer : pack.fill.layer[fi];
      const color = pack.fill.color[fi] === INHERIT ? instColor : pack.fill.color[fi];
      const first = tris.length / 2, box = [Infinity, Infinity, -Infinity, -Infinity];
      for (let r = 0; r < pack.fill.rings[fi]; r++) {
        const ring = pack.fill.start[fi] + r, s = pack.rings.start[ring] * 2, n = pack.rings.len[ring];
        const at = k => { const x = pack.ringXY[s + k * 2], y = pack.ringXY[s + k * 2 + 1]; const wx = m[0] * x + m[2] * y + m[4], wy = m[1] * x + m[3] * y + m[5]; box[0] = Math.min(box[0], wx); box[1] = Math.min(box[1], wy); box[2] = Math.max(box[2], wx); box[3] = Math.max(box[3], wy); return [wx, wy]; };
        const o = at(0);
        for (let k = 1; k + 1 < n; k++) { tris.push(...o, ...at(k), ...at(k + 1)); for (let t = 0; t < 3; t++) meta.push(color, layer, 0, 0); }
      }
      fills.push({first, count: tris.length / 2 - first, box, layer});
    };
    for (const [setIndex, instances] of bySet) {
      const set = pack.sets[setIndex];
      for (let fi = set.fill[0]; fi < set.fill[0] + set.fill[1]; fi++) for (const p of instances) addFill(fi, p.m, p.layer, p.color);
    }
    if (tris.length) fills.vao = vao(gl, buffers(gl, {pos: new Float32Array(tris), meta: new Uint16Array(meta), dist: new Float32Array(tris.length / 2)}), identity);
  }

  // ── 글자: 펼친 목록 + 격자 색인 ──
  const texts = flattenTexts(pack, bySet);
  const ctx = overlay?.getContext('2d') || null;
  let view = {scale: 1, ox: 0, oy: 0}, size = {w: 1, h: 1, ratio: 1};

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 3), w = canvas.clientWidth, h = canvas.clientHeight;
    size = {w, h, ratio};
    for (const c of [canvas, overlay].filter(Boolean)) {
      const W = Math.max(1, Math.round(w * ratio)), H = Math.max(1, Math.round(h * ratio));
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    }
  }
  function setUniforms(p, u, v, rect) {
    gl.useProgram(p);
    gl.uniform2f(u.uScale, 2 * v.scale / rect.w, 2 * v.scale / rect.h);
    gl.uniform2f(u.uOffset, 2 * (v.ox - rect.x) / rect.w - 1, 1 - 2 * (v.oy - rect.y) / rect.h);
    gl.uniform1f(u.uPx, v.scale);
    gl.uniform1f(u.uPointSize, 2 * size.ratio);
    gl.uniform2f(u.uViewport, rect.w, rect.h);
    const inherit = mode === 'paper' ? [0.106, 0.114, 0.133] : [0.9, 0.914, 0.929];
    gl.uniform4f(u.uInherit, inherit[0], inherit[1], inherit[2], 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, paletteTex); gl.uniform1i(u.uPalette, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, layerTex); gl.uniform1i(u.uLayers, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, styleTex); gl.uniform1i(u.uStyles, 2);
    gl.uniform1f(u.uAlpha, 1);
  }
  /** 장면을 그린다. rect(css px)는 화면 안 그릴 자리(기본 전체), v 는 그 화면 기준 보기. */
  function drawScene(v, rect, {lines = true, fillsOn = true} = {}) {
    const r = size.ratio;
    gl.viewport(Math.round(rect.x * r), Math.round((size.h - rect.y - rect.h) * r), Math.round(rect.w * r), Math.round(rect.h * r));
    const bg = mode === 'paper' ? [0.965, 0.965, 0.953] : [0.09, 0.098, 0.118];
    gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const wb = boxOf(v, rect);
    setUniforms(lineProgram, lu, v, rect);
    if (fills.vao && fillsOn) drawFills(v, wb);
    gl.uniform1f(lu.uAlpha, 1);
    let drawn = 0, current = 'line';
    for (const d of lines ? draws : []) {
      if (d.box[2] < wb[0] || d.box[0] > wb[2] || d.box[3] < wb[1] || d.box[1] > wb[3]) continue;
      if (d.size * v.scale < 0.75) continue;
      if (d.program !== current) { current = d.program; if (current === 'wide') setUniforms(wideProgram, wu, v, rect); else setUniforms(lineProgram, lu, v, rect); }
      gl.bindVertexArray(d.vao); gl.drawArraysInstanced(d.mode, 0, d.count, d.instances); drawn++;
    }
    gl.bindVertexArray(null);
    return drawn;
  }
  function render({textOverlay = true, lines = true, fillsOn = true} = {}) {
    const t0 = performance.now();
    gl.disable(gl.SCISSOR_TEST);
    const drawn = drawScene(view, {x: 0, y: 0, w: size.w, h: size.h}, {lines, fillsOn});
    // 방금 그린 화면을 사진으로 남긴다 — 손가락이 움직이는 동안은 이 사진만 옮긴다(renderMoving).
    gl.bindTexture(gl.TEXTURE_2D, snapshot.tex);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGB, 0, 0, canvas.width, canvas.height, 0); // 바탕 버퍼에 알파가 없다(alpha:false) — RGBA 로 복사하면 오류
    snapshot.view = {...view}; snapshot.w = size.w; snapshot.h = size.h;
    const gpuMs = performance.now() - t0;
    if (ctx && textOverlay) drawTexts();
    return {gpuMs, totalMs: performance.now() - t0, drawn};
  }
  /** 화면 일부(확대창)만 다른 보기로 다시 그린다. 사진은 남기지 않는다. */
  function renderRegion(rect, regionView) {
    const r = size.ratio;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.round(rect.x * r), Math.round((size.h - rect.y - rect.h) * r), Math.round(rect.w * r), Math.round(rect.h * r));
    const drawn = drawScene(regionView, rect);
    gl.disable(gl.SCISSOR_TEST);
    return drawn;
  }
  function drawFills(v, visible) {
    gl.bindVertexArray(fills.vao);
    gl.enable(gl.STENCIL_TEST);
    gl.uniform1f(lu.uAlpha, 0.22);
    for (const f of fills) {
      if (f.layer !== INHERIT && !layerShown[f.layer]) continue;
      if (f.box[2] < visible[0] || f.box[0] > visible[2] || f.box[3] < visible[1] || f.box[1] > visible[3]) continue;
      if ((f.box[2] - f.box[0]) * v.scale < 1 && (f.box[3] - f.box[1]) * v.scale < 1) continue;
      gl.colorMask(false, false, false, false);
      gl.stencilFunc(gl.ALWAYS, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
      gl.drawArrays(gl.TRIANGLES, f.first, f.count);
      gl.colorMask(true, true, true, true);
      gl.stencilFunc(gl.NOTEQUAL, 0, 0xff); gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO);
      gl.drawArrays(gl.TRIANGLES, f.first, f.count);
    }
    gl.disable(gl.STENCIL_TEST);
    gl.bindVertexArray(null);
  }
  /** 움직이는 동안: 마지막 사진을 새 확대·위치로 옮겨 그린다(도면 크기와 상관없이 가볍다). 사진이 없으면 다시 그린다. */
  function renderMoving() {
    if (!snapshot.view || snapshot.w !== size.w || snapshot.h !== size.h) return render({textOverlay: false});
    const t0 = performance.now(), s0 = snapshot.view, k = view.scale / s0.scale;
    gl.viewport(0, 0, canvas.width, canvas.height);
    const bg = mode === 'paper' ? [0.965, 0.965, 0.953] : [0.09, 0.098, 0.118];
    gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(quad); gl.disable(gl.BLEND);
    const x0 = view.ox - s0.ox * k, y0 = view.oy - s0.oy * k;
    gl.uniform4f(qu.rect, x0, y0, x0 + size.w * k, y0 + size.h * k);
    gl.uniform2f(qu.size, size.w, size.h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, snapshot.tex); gl.uniform1i(qu.image, 0);
    gl.bindVertexArray(quadVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.bindVertexArray(null);
    return {gpuMs: performance.now() - t0, totalMs: performance.now() - t0, drawn: 1, moving: true};
  }
  function boxOf(v, rect) {
    return [(rect.x - v.ox) / v.scale, (v.oy - rect.y - rect.h) / v.scale, (rect.x + rect.w - v.ox) / v.scale, (v.oy - rect.y) / v.scale];
  }
  const worldBox = () => boxOf(view, {x: 0, y: 0, w: size.w, h: size.h});
  function drawTexts() {
    const {ratio, w, h} = size;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const box = worldBox(), minPx = 3, cap = 3000;
    let drawn = 0;
    texts.query(box, i => {
      if (drawn >= cap) return false;
      const px = texts.height[i] * view.scale;
      if (px < minPx) return true;
      const layer = texts.layer[i];
      if (layer !== INHERIT && !layerShown[layer]) return true;
      const sx = texts.x[i] * view.scale + view.ox, sy = view.oy - texts.y[i] * view.scale;
      const c = header.colors[texts.color[i]];
      const [r, g, b] = mode === 'paper' ? paperColor(c || '#ffffff') : rgb(c || '#ffffff');
      ctx.fillStyle = `rgb(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0})`;
      ctx.font = `${px}px Pretendard, "Noto Sans KR", sans-serif`;
      const align = texts.align[i];
      ctx.textAlign = align === 1 || align === 3 ? 'center' : align === 2 ? 'right' : 'left';
      ctx.textBaseline = align === 3 ? 'middle' : 'alphabetic';
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(-texts.rot[i]); if (texts.width[i] !== 1) ctx.scale(texts.width[i], 1);
      ctx.fillText(header.strings[texts.str[i]], 0, 0);
      ctx.restore();
      drawn++;
      return true;
    });
    return drawn;
  }

  resize();
  return {
    gl, pack, placed,
    stats: {sets: bySet.size, draws: draws.length, vertices: vertexTotal, fills: fills.length, texts: texts.count, instances: placed.length, styles: styles.length},
    get view() { return view; },
    setView(next) { view = {...view, ...next}; },
    setTheme(next) { mode = next; uploadPalette(); snapshot.view = null; },
    setLayerVisible(index, shown) { layerShown[index] = shown ? 255 : 0; uploadLayers(); snapshot.view = null; },
    layerVisible: index => !!layerShown[index],
    fit(padding = 24) {
      const b = header.extent || header.bounds, o = pack.sets[0].origin;
      if (!b || size.w < 2 * padding || size.h < 2 * padding) return false;
      const w = b.maxX - b.minX || 1, hh = b.maxY - b.minY || 1;
      const scale = Math.min((size.w - padding * 2) / w, (size.h - padding * 2) / hh);
      const cx = (b.minX + b.maxX) / 2 - o.x, cy = (b.minY + b.maxY) / 2 - o.y;
      view = {scale, ox: size.w / 2 - cx * scale, oy: size.h / 2 + cy * scale};
      return true;
    },
    resize, render, renderMoving, renderRegion, drawTexts,
    invalidate() { snapshot.view = null; },
    dispose() { gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}

function instanceBuffer(gl, instances) {
  const f = new Float32Array(instances.length * 6), m = new Uint16Array(instances.length * 4);
  instances.forEach((p, i) => { f.set([p.m[0], p.m[2], p.m[4], p.m[1], p.m[3], p.m[5]], i * 6); m[i * 4] = p.layer; m[i * 4 + 1] = p.color; m[i * 4 + 2] = p.style ?? 0; });
  const fb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, fb); gl.bufferData(gl.ARRAY_BUFFER, f, gl.STATIC_DRAW);
  const mb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, mb); gl.bufferData(gl.ARRAY_BUFFER, m, gl.STATIC_DRAW);
  return {fb, mb};
}
function buffers(gl, arrays) {
  const out = {};
  for (const [key, data] of Object.entries(arrays)) { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); out[key] = b; }
  return out;
}
function vao(gl, geo, inst) {
  const v = gl.createVertexArray(); gl.bindVertexArray(v);
  gl.bindBuffer(gl.ARRAY_BUFFER, geo.pos); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, geo.meta); gl.enableVertexAttribArray(1); gl.vertexAttribIPointer(1, 4, gl.UNSIGNED_SHORT, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, geo.dist); gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 1, gl.FLOAT, false, 0, 0);
  if (geo.other) {
    gl.bindBuffer(gl.ARRAY_BUFFER, geo.other); gl.enableVertexAttribArray(6); gl.vertexAttribPointer(6, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, geo.side); gl.enableVertexAttribArray(7); gl.vertexAttribPointer(7, 1, gl.FLOAT, false, 0, 0);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, inst.fb);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 24, 0); gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 24, 12); gl.vertexAttribDivisor(3, 1);
  gl.bindBuffer(gl.ARRAY_BUFFER, inst.mb);
  gl.enableVertexAttribArray(4); gl.vertexAttribIPointer(4, 4, gl.UNSIGNED_SHORT, 0, 0); gl.vertexAttribDivisor(4, 1);
  gl.bindVertexArray(null);
  return v;
}
function transformBox(m, b) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]]) {
    const wx = m[0] * x + m[2] * y + m[4], wy = m[1] * x + m[3] * y + m[5];
    if (wx < x0) x0 = wx; if (wy < y0) y0 = wy; if (wx > x1) x1 = wx; if (wy > y1) y1 = wy;
  }
  return [x0, y0, x1, y1];
}
function link(gl, vs, fs) {
  const shader = (type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error('셰이더: ' + gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram(); gl.attachShader(p, shader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error('셰이더 연결: ' + gl.getProgramInfoLog(p));
  return p;
}

/** 모형 공간 글자 + 블록 안 글자를 세계 좌표로 펼치고 격자 색인을 붙인다. */
export function flattenTexts(pack, bySet) {
  const xs = [], ys = [], hs = [], rots = [], ws = [], aligns = [], strs = [], layers = [], colors = [];
  for (const [setIndex, instances] of bySet) {
    const set = pack.sets[setIndex], [t0, tn] = set.text;
    for (let i = t0; i < t0 + tn; i++) {
      const x = pack.text.xy[i * 2], y = pack.text.xy[i * 2 + 1];
      for (const p of instances) {
        const m = p.m, scale = Math.hypot(m[0], m[1]), mirror = m[0] * m[3] - m[1] * m[2] < 0;
        xs.push(m[0] * x + m[2] * y + m[4]); ys.push(m[1] * x + m[3] * y + m[5]);
        hs.push(pack.text.height[i] * scale);
        const t = pack.text.rot[i], dx = m[0] * Math.cos(t) + m[2] * Math.sin(t), dy = m[1] * Math.cos(t) + m[3] * Math.sin(t);
        let rot = Math.atan2(dy, dx), align = pack.text.align[i];
        // 뒤집힌 블록 안 글자는 geometry.js 처럼 180° 돌려 읽히게 하고 좌우 맞춤을 바꾼다.
        if (mirror) { rot += Math.PI; align = align === 0 ? 2 : align === 2 ? 0 : align; }
        rots.push(rot); ws.push(pack.text.width[i]); aligns.push(align); strs.push(pack.text.str[i]);
        layers.push(pack.text.layer[i] === INHERIT ? p.layer : pack.text.layer[i]);
        colors.push(pack.text.color[i] === INHERIT ? p.color : pack.text.color[i]);
      }
    }
  }
  const count = xs.length;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < count; i++) { minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]); minY = Math.min(minY, ys[i]); maxY = Math.max(maxY, ys[i]); }
  const cells = 128, cw = (maxX - minX) / cells || 1, ch = (maxY - minY) / cells || 1, grid = new Map();
  for (let i = 0; i < count; i++) {
    const key = Math.min(cells - 1, Math.floor((xs[i] - minX) / cw)) * cells + Math.min(cells - 1, Math.floor((ys[i] - minY) / ch));
    if (!grid.has(key)) grid.set(key, []); grid.get(key).push(i);
  }
  return {
    count, x: Float64Array.from(xs), y: Float64Array.from(ys), height: Float32Array.from(hs), rot: Float32Array.from(rots), width: Float32Array.from(ws),
    align: Uint8Array.from(aligns), str: Uint32Array.from(strs), layer: Uint16Array.from(layers), color: Uint16Array.from(colors),
    query(box, visit) {
      if (!count) return;
      // 글자 높이만큼 상자를 넓히지 않는다 — 기준점이 화면 밖인 글자는 대부분 화면 밖이다.
      const c0 = Math.max(0, Math.floor((box[0] - minX) / cw)), c1 = Math.min(cells - 1, Math.floor((box[2] - minX) / cw));
      const r0 = Math.max(0, Math.floor((box[1] - minY) / ch)), r1 = Math.min(cells - 1, Math.floor((box[3] - minY) / ch));
      for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
        const list = grid.get(c * cells + r);
        if (list) for (const i of list) { const x = xs[i], y = ys[i]; if (x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3] && visit(i) === false) return; }
      }
    },
  };
}
