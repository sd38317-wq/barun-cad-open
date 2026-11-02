// 단면·상세 제도 대기화면의 스크립트(drafting.html 에서 뺐다). 설치판은 이 파일을 esbuild 로 한 덩어리로 묶어 싣는다(build_desktop.py).
import {drawingData} from '../drafting-wait-data.js';
import {drawEntity} from '../view.js';
import {partialEntity} from '../ai-draw-reveal.js';
const connected = new URLSearchParams(location.search).get('live') === '1';
let live=connected;
let payload,pendingDrawing;
if (connected) {
  payload = await new Promise(resolve => {
    addEventListener('message', ev => {
      if (ev.source !== parent || ev.origin !== location.origin) return;
      if (ev.data?.target === 'barun-wait' && ev.data.cmd === 'drawing') {pendingDrawing=ev.data.value;resolve(pendingDrawing);}
    });
    parent.postMessage({source:'barun-wait',kind:'drafting',event:'request-drawing'}, location.origin);
  });
} else {
  await new Promise((resolve,reject) => { const s=document.createElement('script');s.src='detail_data.js';s.onload=resolve;s.onerror=reject;document.head.appendChild(s); });
}
async function resolveDrawing(value){
  live=!!value?.entities?.length;
  if(live){try{return drawingData(value.entities,value);}catch{live=false;}}
  // 예시 자료(detail_data.js)는 설치판에 싣지 않는다. 없으면 창을 닫게 알리고 멈춘다(CAD 도면은 그대로).
  if(!window.DETAIL)await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='detail_data.js';script.onload=resolve;script.onerror=reject;document.head.appendChild(script);})
    .catch(error=>{parent.postMessage({source:'barun-wait',kind:'drafting',event:'close',reason:'no-example'},location.origin);throw error;});
  return window.DETAIL;
}
let DD = connected ? await resolveDrawing(payload) : window.DETAIL;
while(connected&&pendingDrawing!==payload){payload=pendingDrawing;DD=await resolveDrawing(payload);}
const $ = id => document.getElementById(id);
let currentRunId=payload?.runId;
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const badge = document.createElement('div');
const updateBadge=()=>badge.textContent = live ? '실제 생성 도형 · 공개 순서 연출 · 엔진 실시간 연결 전' : '예시 · 다른 대지 기록 · 엔진 실시간 연결 전';
badge.style.cssText='position:fixed;top:8px;left:12px;right:12px;z-index:100;background:#303b25;color:#efffcf;padding:8px 12px;border:1px solid #bedb71;font:13px sans-serif;pointer-events:none';
document.body.appendChild(badge);updateBadge();

const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const Q = new URLSearchParams(location.search), EMBED = Q.get("embed") === "1";
if (EMBED) document.body.classList.add("embed");
let scaleLabel = Number.isFinite(+DD.scale) && +DD.scale>0 ? `1:${DD.scale}` : "축척 미지정";
const FONT = '"Barun Drawing Korean","NanumGothic","Malgun Gothic",sans-serif';

/* ---------- 도구 모음 ---------- */
const ICON = {select: '<path d="M5 3l12 7-6 1.5L8.5 18z"/>', line: '<path d="M4 19L19 4"/>', pline: '<path d="M3 17l5-9 5 7 6-11"/>', rect: '<rect x="4" y="6" width="16" height="12"/>',
  circle: '<circle cx="12" cy="12" r="8"/>', hatch: '<rect x="4" y="4" width="16" height="16"/><path d="M4 12l8-8M4 20L20 4M12 20l8-8"/>', offset: '<path d="M3 9h18M3 15h18M12 6v12"/>',
  trim: '<path d="M3 12h18M12 4v16M8 8l8 8"/>', copy: '<rect x="4" y="4" width="11" height="11"/><rect x="9" y="9" width="11" height="11"/>', move: '<path d="M12 3v18M3 12h18"/>',
  dim: '<path d="M4 8v8M20 8v8M4 12h16"/>', text: '<path d="M5 5h14M12 5v14"/>', leader: '<path d="M4 18l8-8h8"/><circle cx="4" cy="18" r="1.5"/>', layer: '<path d="M12 4l9 5-9 5-9-5zM3 14l9 5 9-5"/>'};
const TOOLS = [["select", "선택"], 0, ["line", "선"], ["pline", "폴리선"], ["rect", "사각형"], ["circle", "원"], ["hatch", "해치"], 0, ["offset", "간격띄우기"], ["trim", "자르기"], ["copy", "복사"], ["move", "이동"], 0, ["dim", "치수"], ["leader", "지시선"], ["text", "문자"], ["layer", "레이어"]];
const toolEl = {};
TOOLS.forEach(t => { if (!t) { const s = document.createElement("div"); s.className = "sep"; $("tools").appendChild(s); return; }
  const d = document.createElement("div"); d.className = "tool"; d.innerHTML = `<svg viewBox="0 0 24 24">${ICON[t[0]]}</svg><span>${t[1]}</span>`; $("tools").appendChild(d); toolEl[t[0]] = d; });
let curTool = "";
function setTool(t) { if (t === curTool) return; if (toolEl[curTool]) toolEl[curTool].classList.remove("on"); curTool = t; if (toolEl[t]) toolEl[t].classList.add("on"); }

/* ---------- 작업 시간표: 상세마다 [다가가기] → 구조체 → 마감층 → 해치 → 치수 → 지시선 → 제목 ---------- */
const LAYER = {struct: ["A-DETL", "#ffffff"], finish: ["A-DETL", "#ffffff"], hatch: ["A-DETL-PATT", "#808080"], dims: ["A-DIM", "#9ec5ff"], notes: ["A-TEXT", "#ffffff"], title: ["A-ANNO-TITL", "#ffffff"], etc: ["A-DETL", "#ffffff"]};
const GNAME = {struct: "구조체", finish: "마감층", hatch: "해치", dims: "치수", notes: "지시선", title: "제목", etc: "기타"};
const BASE = {struct: .9, finish: .55, hatch: .75, dims: .42, title: .45};
const len = pts => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };
const TL = [];
let TOTAL, PLAY_RATE, ENTS, N_ENT, GTOT;
const matName = {concrete: "철근콘크리트", lean: "버림 콘크리트", gravel: "잡석", insulation: "단열재", membrane: "방수층", mortar: "몰탈", board: "보드", brick: "벽돌"};
function rebuild(){
TL.length=0;let t=0;
DD.details.forEach((d, di) => {
  TL.push({kind: "cam", t0: t, d: .9, to: d.bounds, detail: di}); t += .9;
  const L = d.layers || [], STRUCT = ["concrete", "lean", "gravel"], struct = L.filter(l => STRUCT.includes(l.mat)), fin = L.filter(l => !STRUCT.includes(l.mat));
  const totalThk = L.reduce((a, l) => a + (+l.thk || 0), 0);
  const SAY = {
    struct: live ? "실제 구조체·기준선 공개" : `구조체부터: ${struct.map(l => `${l.name} ${l.thk}`).join(" · ") || "구조층"} 절단 윤곽을 굵게 그립니다.`,
    finish: live ? "실제 단열·방수·마감층 공개" : `${fin.map(l => `${l.name} ${l.thk}`).join(" → ")} 순서로 층을 붙여요.`,
    hatch: live ? "실제 도형의 재료 해치 공개" : `재료 해치: ${[...new Set((d.groups.find(g => g.key === "hatch") || {items: []}).items.map(h => h.pn))].join(" · ")}`,
    dims: live ? "실제 도형에 포함된 치수를 공개합니다." : `층 두께 연속치수와 전체 치수(합계 ${totalThk})를 기입해요.`,
    notes: live ? "실제 도형의 지시선·문자 공개" : "재료 지시선: THK·재료명을 층 순서대로 적어요.",
    title: `제목 ${safe(d.title)} · ${scaleLabel}`};
  TL.push({kind: "say", t0: t, html: `<b>${safe(d.title)}</b> 상세를 그릴게요.`, detail: di, start: true});
  d.groups.forEach(g => {
    if (!g.items.length) return;
    TL.push({kind: "say", t0: t, html: SAY[g.key] || g.label, detail: di, group: g.key});
    g.items.forEach(e => {
      e.len = e.p ? len(e.p) : 0;
      let dur = g.key === "notes" ? (e.type === "text" ? .12 + e.s.length * .02 : e.role === "dot" ? .07 : .35) : g.key === "title" ? (e.type === "text" ? .3 + e.s.length * .015 : .3) : (BASE[g.key] || .3);
      if (g.key === "finish" && e.len) dur = clamp(.3 + e.len / 6000, .3, .8);
      TL.push({kind: "ent", t0: t, d: dur, e, g: g.key, detail: di}); t += dur;
    });
    t += .15;
  });
  t += .3;
});
TL.push({kind: "cam", t0: t, d: 1.3, to: DD.sheet, detail: -1}); t += 1.3;
TOTAL = t; PLAY_RATE = live ? TOTAL / 8 : 1; ENTS = TL.filter(x => x.kind === "ent"); N_ENT = ENTS.length;
GTOT = {}; ENTS.forEach(x => { const k = x.detail + "|" + x.g; GTOT[k] = (GTOT[k] || 0) + 1; });

/* ---------- 해치 무늬 선(실제 무늬 정의) 미리 계산 ---------- */
function hatchSegs(e) {
  if (e.solid || !e.lines || !e.lines.length) return null;
  const xs = e.p.map(p => p[0]), ys = e.p.map(p => p[1]), bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const O = e.origin || [0, 0], segs = [];
  e.lines.forEach(l => {
    const a = l.a * Math.PI / 180, u = [Math.cos(a), Math.sin(a)], n = [-u[1], u[0]], sp = (l.o[0] * n[0] + l.o[1] * n[1]) * e.ps;
    if (Math.abs(sp) < 1e-3) return;
    const b0 = [O[0] + l.b[0] * e.ps, O[1] + l.b[1] * e.ps], c = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]]];
    const pn = c.map(p => (p[0] - b0[0]) * n[0] + (p[1] - b0[1]) * n[1]), pu = c.map(p => (p[0] - b0[0]) * u[0] + (p[1] - b0[1]) * u[1]);
    const k0 = Math.floor(Math.min(...pn) / sp), k1 = Math.ceil(Math.max(...pn) / sp), along = (l.o[0] * u[0] + l.o[1] * u[1]) * e.ps;
    for (let k = Math.min(k0, k1); k <= Math.max(k0, k1) && segs.length < 3000; k++) {
      const s = [b0[0] + n[0] * sp * k + u[0] * along * k, b0[1] + n[1] * sp * k + u[1] * along * k];
      const lo = Math.min(...pu) - Math.abs(along * k) - 50, hi = Math.max(...pu) + Math.abs(along * k) + 50;
      segs.push({a: [s[0] + u[0] * lo, s[1] + u[1] * lo], b: [s[0] + u[0] * hi, s[1] + u[1] * hi], dash: l.d.map(v => Math.abs(v) * e.ps)});
    }
  });
  return segs;
}
ENTS.forEach(x => { if (x.e.type === "hatch") x.e.segs = hatchSegs(x.e); });
}
rebuild();

/* ---------- 화면·카메라 ---------- */
const cv = $("cv"), g = cv.getContext("2d");
const ink=document.createElement('canvas'), inkCtx=ink.getContext('2d');
let inkKey='', inked=new Set(), lastPaint=0;
let W = 0, H = 0, SCALE = 1, cam = {...DD.sheet}, V = {s: 1, ox: 0, oy: 0};
function fitApp() { if (EMBED) return; SCALE = Math.min(innerWidth / 1600, innerHeight / 1000); $("app").style.transform = `translate(${(innerWidth - 1600 * SCALE) / 2}px,${(innerHeight - 1000 * SCALE) / 2}px) scale(${SCALE})`; }
function size() { const r = Math.min(2, (devicePixelRatio || 1) * (EMBED ? 1 : Math.max(SCALE, .6))); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * r; cv.height = H * r; g.setTransform(r, 0, 0, r, 0, 0); }
function view() { const vw = cam.maxX - cam.minX, vh = cam.maxY - cam.minY, s = Math.min((W - 60) / vw, (H - 90) / vh); return {s, ox: W / 2 - (cam.minX + vw / 2) * s, oy: H / 2 - 10 + (cam.minY + vh / 2) * s}; }
const X = p => [V.ox + p[0] * V.s, V.oy - p[1] * V.s];
const pad = (b, k) => { const w = b.maxX - b.minX, h = b.maxY - b.minY; return {minX: b.minX - w * k, maxX: b.maxX + w * k, minY: b.minY - h * k, maxY: b.maxY + h * k}; };
function camAt(time) {
  let c = {...DD.sheet};
  for (const x of TL) { if (x.kind !== "cam" || x.t0 > time) continue; const k = ease(clamp((time - x.t0) / x.d, 0, 1)), to = x.detail >= 0 ? pad(x.to, .12) : x.to;
    c = {minX: lerp(c.minX, to.minX, k), minY: lerp(c.minY, to.minY, k), maxX: lerp(c.maxX, to.maxX, k), maxY: lerp(c.maxY, to.maxY, k)}; }
  return c;
}

/* ---------- 그리기 ---------- */
const COL = {outline: "#f1f3f5", pattern: "rgba(160,170,182,.75)", membrane: "#7d8b99", dim: "#9ec5ff", text: "#e6e9ed", title: "#ffffff", leader: "#d7dce2"};
function polyPath(c, pts, t = 1, closed = false) {
  const P = closed ? pts.concat([pts[0]]) : pts;
  c.beginPath();
  if (t >= 1) { P.forEach((p, i) => { const [x, y] = X(p); i ? c.lineTo(x, y) : c.moveTo(x, y); }); return X(P[P.length - 1]); }
  let need = len(P) * t, [px, py] = X(P[0]); c.moveTo(px, py);
  for (let i = 1; i < P.length && need > 0; i++) { const l = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]), f = Math.min(1, need / (l || 1)); [px, py] = X([lerp(P[i - 1][0], P[i][0], f), lerp(P[i - 1][1], P[i][1], f)]); c.lineTo(px, py); need -= l; }
  return [px, py];
}
const fmtN = (v, p = 0) => String(+(+v).toFixed(p));
function drawEnt(c, x, t = 1) {
  const e = x.e; let tip = null;
  if (e.native) {
    const part = partialEntity(e.native, t);
    if (part.entity) {
      c.save();
      for (const mask of e.native.clipMasks || []) {
        c.beginPath(); if(mask.inverted)c.rect(-1e9,-1e9,2e9,2e9);
        mask.points.forEach((p,i)=>{const q=X([p.x,p.y]);i?c.lineTo(...q):c.moveTo(...q);});
        c.closePath();c.clip('evenodd');
      }
      drawEntity(c, part.entity, p => ({x:V.ox+p.x*V.s,y:V.oy-p.y*V.s}), V.s,
        e.native._displayColor || e.native.color || COL.outline, x.g === 'struct' ? 2 : 1);
      c.restore();
    }
    return part.pen ? X([part.pen.x,part.pen.y]) : null;
  }
  if (e.type === "polyline" || e.type === "line") {
    c.setLineDash([]); c.lineCap = "round"; c.lineJoin = "round";
    if (e.role === "leader") { c.strokeStyle = COL.leader; c.lineWidth = 1; }
    else if (e.role === "title") { c.strokeStyle = COL.title; c.lineWidth = e.trole === "underline" ? 2.2 : 1; }
    else { c.strokeStyle = COL.outline; c.lineWidth = x.g === "struct" ? 2.6 : 1.4; }
    tip = polyPath(c, e.p, t, !!e.closed); c.stroke();
  } else if (e.type === "hatch") {
    c.save(); c.beginPath(); e.p.forEach((p, i) => { const [a, b] = X(p); i ? c.lineTo(a, b) : c.moveTo(a, b); }); c.closePath();
    if (e.role === "dot") { c.fillStyle = COL.leader; c.fill(); c.restore(); return X(e.p[0]); }
    c.clip();
    const xs = e.p.map(p => X(p)[0]), ys = e.p.map(p => X(p)[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), sweep = lerp(x0, x1, t);
    c.beginPath(); c.rect(x0 - 2, Math.min(...ys) - 2, sweep - x0 + 2, Math.max(...ys) - Math.min(...ys) + 4); c.clip();
    if (e.solid || !e.segs) { c.fillStyle = COL.membrane; c.fillRect(x0 - 2, Math.min(...ys) - 2, x1 - x0 + 4, Math.max(...ys) - Math.min(...ys) + 4); }
    else { c.strokeStyle = COL.pattern; c.lineWidth = .8; c.lineCap = "round";
      e.segs.forEach(sg => { c.setLineDash(sg.dash.length ? sg.dash.map((v, i) => i % 2 === 0 ? Math.max(v * V.s, .01) : Math.max(v * V.s, 1)) : []); c.beginPath(); c.moveTo(...X(sg.a)); c.lineTo(...X(sg.b)); c.stroke(); });
      c.setLineDash([]); }
    c.restore(); tip = [sweep, (Math.min(...ys) + Math.max(...ys)) / 2];
  } else if (e.type === "dimension") {
    const [p0, p1, p2] = e.p, hor = e.mode !== "vertical";
    const a = hor ? [p0[0], p2[1]] : [p2[0], p0[1]], b = hor ? [p1[0], p2[1]] : [p2[0], p1[1]], val = hor ? Math.abs(p1[0] - p0[0]) : Math.abs(p1[1] - p0[1]);
    c.strokeStyle = COL.dim; c.fillStyle = COL.dim; c.lineWidth = 1; c.setLineDash([]);
    const k = ease(t);
    c.globalAlpha = Math.min(1, k * 3); c.beginPath(); c.moveTo(...X(p0)); c.lineTo(...X(a)); c.moveTo(...X(p1)); c.lineTo(...X(b)); c.stroke(); c.globalAlpha = 1;
    if (k > .2) { const q = clamp((k - .2) / .5, 0, 1), m = [lerp(a[0], b[0], q), lerp(a[1], b[1], q)]; c.beginPath(); c.moveTo(...X(a)); c.lineTo(...X(m)); c.stroke(); tip = X(m); }
    if (k > .7) [a, b].forEach(p => { const [x, y] = X(p); c.beginPath(); c.moveTo(x - 4, y + 4); c.lineTo(x + 4, y - 4); c.stroke(); });
    if (k > .8) { const tp = e.tp || [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [x, y] = X(tp); c.font = `${Math.max(9, e.th * V.s)}px ${FONT}`; c.textAlign = "left"; c.textBaseline = "alphabetic"; c.save(); c.translate(x, y); if (!hor) c.rotate(-Math.PI / 2); c.fillText(fmtN(val, e.prec), 0, 0); c.restore(); }
  } else if (e.type === "text") {
    const n = Math.ceil(e.s.length * t), [x, y] = X(e.p[0]), px = Math.max(8, e.h * V.s);
    c.save(); c.translate(x, y); c.rotate(-(e.rot || 0) * Math.PI / 180); c.font = `${e.trole === "title" ? "700 " : ""}${px}px ${FONT}`;
    c.fillStyle = e.role === "title" ? COL.title : COL.text; c.textAlign = e.align === "center" ? "center" : e.align === "right" ? "right" : "left"; c.textBaseline = "alphabetic";
    c.fillText(e.s.slice(0, n), 0, 0); const w = c.measureText(e.s.slice(0, n)).width; c.restore(); tip = [x + (e.align === "left" || !e.align ? w : 0), y];
  }
  return tip;
}

/* ---------- 진행 ---------- */
let T = 0, SPEED = +(Q.get("speed") || 1), paused = false, lastNow = 0, doneSay = new Set(), stepMsg = null, finished = false, curDetail = -1, shown = -1;
function log(html) { const l = $("log"), d = document.createElement("div"); d.innerHTML = html; l.appendChild(d); while (l.children.length > 6) l.removeChild(l.firstChild); }
function chat(html, cls = "a") { const m = $("msgs"), d = document.createElement("div"); d.className = "m " + cls; d.innerHTML = html; m.appendChild(d); while (m.children.length > 12) m.removeChild(m.firstChild); return d; }
function closeStep() { if (stepMsg) { const pg = stepMsg.querySelector(".pg"); if (pg) pg.remove(); stepMsg.innerHTML += ' <span style="color:var(--accent)">✓</span>'; stepMsg = null; } }
function post(ev, extra = {}) { try { if (parent !== window) parent.postMessage({source: "barun-wait", kind: "drafting", event: ev, runId:currentRunId, ...extra}, "*"); } catch (e) {} }
function steps(di) { $("steps").innerHTML = DD.details.map((d, i) => `<span class="${di < 0 || i < di ? "ok" : i === di ? "on" : ""}">${di < 0 || i < di ? "✓ " : ""}${safe(d.part)}</span>`).join(""); }
function reset() {
  T = 0; doneSay = new Set(); stepMsg = null; finished = false; curDetail = -1; shown = -1; cam = {...DD.sheet};
  inkKey=""; inked.clear();
  ENTS.forEach(x => { x._logged = false; });
  $("log").innerHTML = ""; $("msgs").innerHTML = ""; $("again").classList.remove("on"); $("aiState").textContent = "AI 제도 중"; $("cmdState").textContent = "AI 제도";
  chat(live ? "실제 생성 결과의 제도 순서 보기" : "외벽·지붕·지하외벽·기초 단면 상세 그려줘. 1:20으로", "u");
  chat(`<b>${live ? "도형 묶음" : "단면 상세"} ${DD.details.length}개</b>를 그릴게요. 생성 결과를 사용하며 공개 순서는 연출입니다. 엔진 실시간 걸음이 아닙니다.`);
  log(`<span class="c">AI 제도</span> 시작 · 상세 ${DD.details.length}개 · 객체 ${N_ENT}개`); steps(0); post("ready", {total: N_ENT, seconds: live ? 8 : TOTAL, source:"presentation"});
}
function frame(now) {
  if(now-lastPaint<1000/30){schedule();return;}lastPaint=now;
  const rdt = Math.min(.1, (now - (lastNow || now)) / 1000); lastNow = now;
  if (document.hidden || paused) return;           // 숨은 동안 그리지 않음
  if (W < 50 || H < 50) { size(); return schedule(); }
  if (!paused && !finished) T += rdt * SPEED * PLAY_RATE;
  cam = camAt(T); V = view();
  g.fillStyle = "#1d2126"; g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(255,255,255,.03)"; g.lineWidth = 1; const gs = 100 * V.s;
  if (gs > 6) { for (let x = V.ox % gs; x < W; x += gs) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); } for (let y = V.oy % gs; y < H; y += gs) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } }
  DD.details.forEach((d, i) => { const a = X([d.bounds.minX - 80, d.bounds.maxY + 80]), b = X([d.bounds.maxX + 80, d.bounds.minY - 80]); g.setLineDash([4, 4]); g.strokeStyle = i === curDetail && !finished ? "rgba(190,219,113,.5)" : "rgba(255,255,255,.07)"; g.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); g.setLineDash([]); });
  const inkView=[W,H,V.s,V.ox,V.oy].join();
  if(inkKey!==inkView){inkKey=inkView;inked.clear();ink.width=W;ink.height=H;}
  let active = null, tip = null, n = 0;
  for (const x of TL) {
    if (x.t0 > T) break;
    if (x.kind === "say" && !doneSay.has(x)) {
      doneSay.add(x); closeStep();
      if (x.start) { curDetail = x.detail; steps(x.detail); $("viewSub").textContent = `${DD.details[x.detail].title} · ${scaleLabel} · mm`; chat(x.html); post("progress", {detail: x.detail, title: DD.details[x.detail].title}); }
      else { stepMsg = chat(`${x.html}<span class="pg"><i style="width:0%"></i></span>`); const [ln, cl] = LAYER[x.group] || ["0", "#fff"]; $("layerName").textContent = ln; $("layerColor").style.borderColor = cl; $("layersel").classList.add("on"); setTimeout(() => $("layersel").classList.remove("on"), 350); log(`<span class="c">LAYER</span> 현재 → ${safe(ln)}`); }
    }
    if (x.kind !== "ent") continue;
    const k = clamp((T - x.t0) / x.d, 0, 1);
    if (k >= 1) { if(!inked.has(x)){drawEnt(inkCtx, x);inked.add(x);} n++; continue; }
    active = x;
  }
  g.drawImage(ink,0,0);
  if(active)tip=drawEnt(g,active,ease(clamp((T-active.t0)/active.d,0,1)));
  if (n !== shown) { shown = n; $("count").textContent = `객체 ${n}개`; }
  if (active) {
    const e = active.e, tool = e.type === "hatch" ? (e.role === "dot" ? "leader" : "hatch") : e.type === "dimension" ? "dim" : e.type === "text" ? "text" : e.role === "leader" ? "leader" : e.type === "line" ? "line" : "pline";
    setTool(tool);
    if (!active._logged) { active._logged = true;
      const f = p => `${fmtN(p[0])},${fmtN(p[1])}`;
      const c = e.native ? [String(e.native.type).toUpperCase(), " · 실제 도형 · " + (e.native.layerName || e.native.layer || "")] : e.type === "hatch" ? (e.role === "dot" ? ["DONUT", " 지시점"] : ["HATCH", ` ${e.pn || "SOLID"}${e.solid ? "" : " · 축척 " + e.ps}`]) : e.type === "dimension" ? ["DIMLINEAR", ` ${e.mode === "vertical" ? "세로" : "가로"} · ${e.role === "total" ? "전체" : "층"} 치수`] :
        e.type === "text" ? ["TEXT", ` "${e.s.slice(0, 24)}" h=${e.h}`] : e.role === "leader" ? ["LEADER", ` ${e.p.length}점`] : ["PLINE", ` ${matName[e.mat] || ""} ${e.p.length}점 · 시작 ${f(e.p[0])}`];
      $("cmdNow").textContent = c[0]; $("cmdArg").textContent = c[1]; log(`<span class="c">${safe(c[0])}</span>${safe(c[1])}`);
      $("now").textContent = `${DD.details[active.detail].part} · ${GNAME[active.g] || ""}`; }
    if (stepMsg) { const k2 = active.detail + "|" + active.g, done = ENTS.filter(q => q.detail === active.detail && q.g === active.g && q.t0 + q.d <= T).length, i = stepMsg.querySelector(".pg i"); if (i) i.style.width = `${done / GTOT[k2] * 100}%`; }
    if (tip) { const [x, y] = tip; g.strokeStyle = "rgba(230,233,237,.7)"; g.lineWidth = 1; g.beginPath(); g.moveTo(x - 14, y); g.lineTo(x + 14, y); g.moveTo(x, y - 14); g.lineTo(x, y + 14); g.stroke();
      g.strokeStyle = "rgba(190,219,113,1)"; g.strokeRect(x - 4, y - 4, 8, 8);
      const gr = g.createRadialGradient(x, y, 0, x, y, 16); gr.addColorStop(0, "rgba(190,219,113,.4)"); gr.addColorStop(1, "rgba(190,219,113,0)"); g.fillStyle = gr; g.fillRect(x - 16, y - 16, 32, 32);
      $("xy").textContent = `X ${fmtN((x - V.ox) / V.s)} · Y ${fmtN((V.oy - y) / V.s)} mm`; }
  }
  if (!finished && T >= TOTAL) {
    finished = true; closeStep(); setTool("select"); $("cmdNow").textContent = ""; $("cmdArg").textContent = ""; $("cmdState").textContent = "선택 · 대기"; $("aiState").textContent = "제도 완료 · 검토 대기";
    chat(`<b>${live ? "도형 묶음" : "단면 상세"} ${DD.details.length}개 생성 완료</b> · 객체 ${N_ENT}개 · ${scaleLabel}\n표시한 도형은 생성 결과입니다. 실제 사양은 도면에서 검토해 주세요.`);
    log('<span class="c">AI 제도</span> 완료 · 검토 대기'); steps(-1); $("now").textContent = "완료 · 검토 대기"; $("count").textContent = `객체 ${N_ENT}개`;
    $("again").classList.add("on"); post("done", {total: N_ENT});
  }
  if (!finished) schedule();
}
$("again").onclick = () => { reset(); wake(); };
// 캐드에서 조종: iframe.contentWindow.postMessage({target:'barun-wait', cmd:'pause'|'resume'|'restart'|'speed'|'seek', value}, '*')
let drawingSeq=0;
addEventListener("message", async ev => { const m = ev.data || {}; if (ev.source !== parent || ev.origin !== location.origin || m.target !== "barun-wait") return;
  if(m.cmd==='drawing'){
    const seq=++drawingSeq,next=await resolveDrawing(m.value);
    if(seq!==drawingSeq)return;
    currentRunId=m.value?.runId;DD=next;scaleLabel=Number.isFinite(+DD.scale)&&+DD.scale>0?`1:${DD.scale}`:'축척 미지정';
    updateBadge();rebuild();reset();wake();return;
  }
  if (m.cmd === "pause") paused = true; if (m.cmd === "resume") paused = false; if (m.cmd === "restart") reset(); if (m.cmd === "speed") SPEED = [1,2,4].includes(+m.value) ? +m.value : 1; if (m.cmd === "seek") { reset(); T = Math.max(0, Math.min(TOTAL, +m.value || 0)); } wake(); });
let raf=0;
function schedule() { cancelAnimationFrame(raf); if (!document.hidden && !paused) raf=requestAnimationFrame(frame); }
function wake() { lastNow=0; schedule(); }
addEventListener('visibilitychange', wake);
addEventListener("resize", () => { fitApp(); size(); wake(); });
addEventListener("keydown", ev => {if(ev.key==="Escape"){ev.preventDefault();post("close");}});
document.fonts.load(`12px ${FONT}`).finally(() => { fitApp(); size(); reset(); if (Q.get("t")) T = +Q.get("t"); wake(); });
