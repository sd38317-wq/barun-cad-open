// 현장 패드(밖에서 보기). 링크(/p/<세션ID>#k=<열쇠>&w=<쓰기토큰>)로 열고, 도면은 이 브라우저 안에서만 푼다.
// 7.0 결정: 현장에서는 도면을 고치지 않는다 — 치수·실측, 핀(하자·지시·질문·메모), 펜 표시, 글, 자만. 모아 두었다가
// [사무실로 보내기]로 한 번에 보내고, 사무실 바른 CAD 가 받으면 "사무실 받음"이 뜬다.
// 도면은 구운 묶음(pad-pack.js)을 GPU(pad-gl.js)로 그린다. 점은 꾹 눌러 찍고(확대창), 온스냅은 pad-snap.js.
// 받는 CAD 가 핀·실측 작업을 모르면(설치판이 예전 판) 메모·펜 표시로 바꿔 보낸다 — 서버 배포만으로도 동작한다.
import {packDrawing, encodePadPack, decodePadPack, decodePadSession, INHERIT} from './pad-pack.js';
import {createPadRenderer, paperColor} from './pad-gl.js';
import {createPadSnapper} from './pad-snap.js';
import {openPadJson, openPadBytes, sealPadJson, sealPadBytes, parsePadLocation, randomToken, fromBase64Url, toBase64Url} from './pad-crypto.js';
import {normalizePadBatch, PAD_PROTOCOL_VERSION, isPadAck, isPadReply, normalizeReplyItem} from './pad-ops.js';

const API = '/api/public/cad-pad/sessions/', MAX_OPS = 200, RULER_LENGTH = 420, RULER_HEIGHT = 64, EDGE_PX = 26;
const PRESS_MS = {touch: 300, pen: 120, mouse: 0};
const SNAP_MODES_ALL = ['끝점', '교차점', '수직점', '중간점', '중심점', '사분점', '근처점'];
const KINDS = ['하자', '작업 지시', '질문', '메모'], STATES = ['미해결', '진행 중', '확인 요청', '해결'], PRIOS = ['긴급', '높음', '보통', '낮음'];
const STATE_COLOR = {'미해결': '#f08a3e', '진행 중': '#9dcbe0', '확인 요청': '#e6c35a', '해결': '#7fcf95'};
const PEN_COLORS = [['#f08a3e', '주황'], ['#ff7b6e', '빨강'], ['#9dcbe0', '하늘'], ['#eef0f3', '흰색']];
const ICON = {
  view: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5V4.5a1.5 1.5 0 0 1 3 0V12M14 12V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.6-2.2L3.6 15a1.5 1.5 0 0 1 2.3-1.9L8 15"/>',
  measure: '<path d="M3 12h18M3 8v8M21 8v8M7 12l-2-2M7 12l-2 2M17 12l2-2M17 12l2 2"/>',
  pin: '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3"/>',
  memo: '<path d="M5 5h14M12 5v14M9 19h6"/>',
  ruler: '<path d="M3 16L16 3l5 5L8 21z"/><path d="M7 12l2 2M10 9l2 2M13 6l2 2"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  send: '<path d="M4 12l16-8-6 16-3-7-7-1z"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/>',
};

// ── 작은 DOM 도우미(인라인 style 속성 대신 CSSOM — 패드 화면 CSP 가 style 속성을 막는다) ──
const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key.startsWith('on')) node[key.toLowerCase()] = value;
    else if (key.startsWith('aria') || key === 'role' || key === 'for') node.setAttribute(key.startsWith('aria') ? 'aria-' + key.slice(4).toLowerCase() : key, value === true ? 'true' : String(value));
    else node[key] = value;
  }
  node.append(...children.flat().filter(c => c !== null && c !== undefined && c !== false));
  return node;
};
const svg = name => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.7'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICON[name]; return s; };
const kids = (...a) => a.flat().filter(x => x !== null && x !== undefined && x !== false);
const fmt = n => Math.round(n).toLocaleString('ko-KR');
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
const timeText = date => new Date(date).toLocaleTimeString('ko-KR', {hour: '2-digit', minute: '2-digit'});

if (!document.querySelector('link[data-pad-css]')) document.head.append(el('link', {rel: 'stylesheet', href: new URL('pad.css', import.meta.url).href, dataset: {padCss: ''}}));
const root = document.getElementById('pad-root') || document.body.appendChild(el('div', {id: 'pad-root'}));

// ── 화면 뼈대 ──
const glCanvas = el('canvas', {class: 'layer'}), textCanvas = el('canvas', {class: 'layer text'}), markCanvas = el('canvas', {class: 'layer marks'});
const input = el('div', {class: 'input', ariaLabel: '도면'});
const titleName = el('strong', {textContent: '도면을 받는 중…'}), titleSub = el('span', {textContent: ''});
const themeSeg = el('div', {class: 'seg well', role: 'group', ariaLabel: '보기 방식'});
const themeButtons = [['cad', 'CAD'], ['paper', '종이']].map(([value, label]) => el('button', {type: 'button', class: 'ghost', textContent: label, dataset: {theme: value}, onClick: () => setTheme(value)}));
themeSeg.append(...themeButtons);
const countText = el('span', {class: 'count'});
const sendButton = el('button', {type: 'button', class: 'btn primary send', onClick: () => openSendDialog()}, svg('send'), '사무실로 보내기');
const phoneTheme = el('button', {type: 'button', class: 'icon ghost phone-only', ariaLabel: '종이·CAD 바꾸기', onClick: () => setTheme(theme === 'cad' ? 'paper' : 'cad')}, svg('sun'));
const phoneLayers = el('button', {type: 'button', class: 'icon ghost phone-only', ariaLabel: '레이어', onClick: () => openSheet('layers')}, svg('layers'));
const top = el('header', {class: 'top air'}, el('div', {class: 'title grow'}, titleName, titleSub), themeSeg, el('div', {class: 'sep'}), countText, sendButton, phoneTheme, phoneLayers);
const toolDefs = [['view', '보기'], ['measure', '치수'], ['pin', '핀'], ['pen', '펜'], ['memo', '글', 'tablet-only'], ['ruler', '자', 'tablet-only']];
const toolButtons = new Map();
const tools = el('nav', {class: 'tools air', ariaLabel: '패드 도구'});
for (const [name, label, extra] of toolDefs) {
  const b = el('button', {type: 'button', class: `tool ghost ${extra || ''}`, ariaPressed: 'false', onClick: () => name === 'ruler' ? toggleRuler() : setTool(name)}, svg(name), label);
  toolButtons.set(name, b); tools.append(b);
}
tools.append(el('div', {class: 'sep'}));
const layersTool = el('button', {type: 'button', class: 'tool ghost tablet-only', onClick: () => openSheet('layers')}, svg('layers'), '레이어');
const listTool = el('button', {type: 'button', class: 'tool ghost', onClick: () => openSheet('list')}, svg('list'), '기록');
const undoTool = el('button', {type: 'button', class: 'tool ghost undo tablet-only', ariaLabel: '되돌리기', onClick: () => undo()}, svg('undo'));
tools.append(layersTool, listTool, undoTool);
const zoom = el('div', {class: 'zoom air'},
  el('button', {type: 'button', class: 'ghost', ariaLabel: '확대', textContent: '+', onClick: () => zoomBy(1.6)}), el('div', {class: 'hsep'}),
  el('button', {type: 'button', class: 'ghost', ariaLabel: '축소', textContent: '−', onClick: () => zoomBy(1 / 1.6)}), el('div', {class: 'hsep'}),
  el('button', {type: 'button', class: 'ghost', ariaLabel: '도면 전체 보기', onClick: () => { renderer?.fit(); fullRender(); }}, svg('fit')));
const fab = el('button', {type: 'button', class: 'fab primary', onClick: () => openSendDialog()}, svg('send'), el('span', {textContent: '보내기'}));
const hint = el('div', {class: 'hint air', hidden: true});
const legend = el('div', {class: 'legend air', ariaLabel: '현장 기록 요약', hidden: true});
const toast = el('div', {class: 'toast air', role: 'status', hidden: true});
const ruler = el('div', {class: 'ruler', hidden: true, ariaLabel: '자'}, el('span', {class: 'deg', textContent: '0°'}));
for (let x = 0; x <= RULER_LENGTH; x += 20) ruler.append(el('span', {class: 'tick' + (x % 100 === 0 ? ' long' : ''), style: {left: x + 'px'}}));
const penPalette = el('div', {class: 'air menu', hidden: true, ariaLabel: '펜 설정'});
const sheetHost = el('div');
root.replaceChildren(glCanvas, textCanvas, markCanvas, input, ruler, top, tools, zoom, legend, fab, hint, toast, penPalette, sheetHost);

let toastTimer = 0;
function say(text, error = false) { toast.textContent = text; toast.hidden = false; toast.classList.toggle('error', error); clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 7000 : 3500); }

// ── 상태 ──
let session = null, snapshot = null, pack = null, renderer = null, snapper = null, origin = {x: 0, y: 0};
let theme = 'cad', tool = 'view', penKind = 'pen', penWidth = 1, penColor = 0, penSeen = false;
let drafts = [], sent = [], localSeq = 0, cursor = 0, lastSentSeq = 0, received = 0, receivedAt = '', sending = false;
let snapModes = new Set(loadJson('barun-pad-snap', ['끝점', '교차점', '수직점', '중간점', '중심점', '사분점']));
let tolerance = Number(loadJson('barun-pad-tolerance', 20)) || 20;
let caps = new Set();
// 펜 설정: 펜슬로만 그리기(펜슬을 쓴 뒤 손가락은 화면 이동만) · 누르는 힘 따라 굵기.
const penSettings = {penOnly: true, pressure: true, ...loadJson('barun-pad-pen', {})};
let lasso = null; // {points(세계), picked:Set(draft), menu, moving:{from}}
let measuring = null; // {a, b} 진행 중 치수
let editingPin = null;
const draftKey = () => 'barun-pad-draft:' + session.id, sentKey = () => 'barun-pad-sent:' + session.id;
function loadJson(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } }
function saveJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
const saveDrafts = () => { saveJson(draftKey(), drafts); saveJson(sentKey(), sent); refreshInfo(); paintMarks(); };

// 좌표: 그리기 장치는 모형 원점 기준, 보내는 작업과 저장은 도면 절대 좌표.
const view = () => renderer.view;
const toScreen = p => ({x: (p.x - origin.x) * view().scale + view().ox, y: view().oy - (p.y - origin.y) * view().scale});
const toWorld = s => ({x: (s.x - view().ox) / view().scale + origin.x, y: (view().oy - s.y) / view().scale + origin.y});

// ── 그리기: 움직이는 동안은 사진 옮기기, 멈추면 다시 그림 ──
let frame = 0, idleTimer = 0, textView = null;
function requestMoving() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (!renderer) return; renderer.renderMoving(); moveTextLayer(); paintMarks(); clearTimeout(idleTimer); idleTimer = setTimeout(fullRender, 120); }); }
function fullRender() {
  if (!renderer) return;
  clearTimeout(idleTimer);
  renderer.render({textOverlay: false});
  textCanvas.style.transform = ''; renderer.drawTexts(); textView = {...view()};
  paintMarks();
}
function moveTextLayer() {
  if (!textView) return;
  const v = view(), k = v.scale / textView.scale;
  textCanvas.style.transform = `translate(${v.ox - textView.ox * k}px, ${v.oy - textView.oy * k}px) scale(${k})`;
}
function zoomBy(k, at = {x: input.clientWidth / 2, y: input.clientHeight / 2}) {
  const v = view(); renderer.setView({scale: v.scale * k, ox: at.x - (at.x - v.ox) * k, oy: at.y - (at.y - v.oy) * k}); requestMoving();
}

// ── 현장 표시 겹(2D): 펜·글·치수·핀·진행 중 손그림·확대창 테두리 ──
const mctx = markCanvas.getContext('2d');
function sizeMarks() {
  const ratio = Math.min(window.devicePixelRatio || 1, 3), w = markCanvas.clientWidth, h = markCanvas.clientHeight;
  if (markCanvas.width !== Math.round(w * ratio) || markCanvas.height !== Math.round(h * ratio)) { markCanvas.width = Math.round(w * ratio); markCanvas.height = Math.round(h * ratio); }
  mctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return {w, h};
}
let stroke = null, press = null, loupe = null;
function paintMarks() {
  if (!renderer) return;
  const {w, h} = sizeMarks();
  mctx.clearRect(0, 0, w, h);
  const paper = theme === 'paper';
  for (const item of sent) drawItem(item, true, paper);
  for (const item of drafts) drawItem(item, false, paper);
  if (stroke?.points.length > 1) drawStroke(stroke.points, strokeStyle(stroke), paper);
  if (lasso?.points.length > 1) {
    mctx.save(); mctx.setLineDash([6, 5]); mctx.strokeStyle = '#9dcbe0'; mctx.fillStyle = 'rgba(157,203,224,.06)'; mctx.lineWidth = 1.4;
    mctx.beginPath(); lasso.points.forEach((q, i) => { const s = toScreen(q); i ? mctx.lineTo(s.x, s.y) : mctx.moveTo(s.x, s.y); }); if (lasso.picked) { mctx.closePath(); mctx.fill(); } mctx.stroke(); mctx.restore();
    if (lasso.picked) for (const d of lasso.picked) for (const q of draftPoints(d)) { const s = toScreen(q); mctx.save(); mctx.fillStyle = '#9dcbe0'; mctx.fillRect(s.x - 2.5, s.y - 2.5, 5, 5); mctx.restore(); }
  }
  if (measuring?.a) drawMeasureLine(measuring.a, measuring.b || press?.point || measuring.a, null, false, paper);
  if (press?.snap) drawSnapGlyph(toScreen(press.point), press.snap.kind);
  if (loupe) drawLoupeFrame();
}
function strokeStyle(item) {
  const color = item.color || PEN_COLORS[0][0];
  return {color, width: [2, 3, 5][item.width ?? 1] * (item.kind === 'hl' ? 4 : 1), alpha: item.kind === 'hl' ? 0.35 : 1};
}
function drawStroke(points, style, paper) {
  mctx.save(); mctx.globalAlpha = style.alpha; mctx.strokeStyle = paper ? darken(style.color) : style.color; mctx.lineWidth = style.width; mctx.lineCap = 'round'; mctx.lineJoin = 'round';
  if (points.some(q => q.p > 0)) {
    // 누르는 힘이 있는 펜 선: 조각마다 굵기를 바꾼다(0.4~1.6배).
    for (let i = 1; i < points.length; i++) {
      const a = toScreen(points[i - 1]), b = toScreen(points[i]), pr = ((points[i - 1].p || 0.5) + (points[i].p || 0.5)) / 2;
      mctx.lineWidth = style.width * (0.4 + 1.2 * pr); mctx.beginPath(); mctx.moveTo(a.x, a.y); mctx.lineTo(b.x, b.y); mctx.stroke();
    }
  } else { mctx.beginPath(); points.forEach((p, i) => { const s = toScreen(p); i ? mctx.lineTo(s.x, s.y) : mctx.moveTo(s.x, s.y); }); mctx.stroke(); }
  mctx.restore();
}
function darken(hex) { const c = paperColor(hex); return `rgb(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0})`; }
function drawItem(item, isSent, paper) {
  if (item.type === 'mark') drawStroke(item.points, strokeStyle(item), paper);
  else if (item.type === 'memo') {
    const s = toScreen(item.at), px = Math.max(12, Math.min(28, (item.height || 250) * view().scale));
    mctx.font = `600 ${px}px ${getComputedStyle(root).fontFamily}`;
    const width = mctx.measureText(item.text).width;
    mctx.fillStyle = paper ? 'rgba(255,241,230,.92)' : 'rgba(46,34,25,.92)'; mctx.strokeStyle = '#f08a3e'; mctx.lineWidth = 1;
    roundRect(s.x - 6, s.y - px - 4, width + 12, px + 10, 6); mctx.fill(); mctx.stroke();
    mctx.fillStyle = paper ? '#8a3a07' : '#ffc79e'; mctx.fillText(item.text, s.x, s.y);
  } else if (item.type === 'measure') drawMeasureLine(item.a, item.b, item, isSent, paper);
  else if (item.type === 'pin') {
    const s = toScreen(item.at), color = STATE_COLOR[item.status] || '#f08a3e', r = 13;
    mctx.save();
    if (editingPin?.id === item.id) { mctx.fillStyle = 'rgba(240,138,62,.18)'; mctx.beginPath(); mctx.arc(s.x, s.y - r - 6, r + 9, 0, Math.PI * 2); mctx.fill(); }
    mctx.fillStyle = color; mctx.beginPath(); mctx.arc(s.x, s.y - r - 6, r, 0, Math.PI * 2); mctx.fill();
    mctx.beginPath(); mctx.moveTo(s.x - 6, s.y - 12); mctx.lineTo(s.x, s.y); mctx.lineTo(s.x + 6, s.y - 12); mctx.fill();
    mctx.fillStyle = '#15171c'; mctx.font = `700 12px ${getComputedStyle(root).fontFamily}`; mctx.textAlign = 'center'; mctx.textBaseline = 'middle';
    mctx.fillText(String(item.no || ''), s.x, s.y - r - 6);
    mctx.restore();
  }
}
function roundRect(x, y, w, h, r) { mctx.beginPath(); mctx.moveTo(x + r, y); mctx.arcTo(x + w, y, x + w, y + h, r); mctx.arcTo(x + w, y + h, x, y + h, r); mctx.arcTo(x, y + h, x, y, r); mctx.arcTo(x, y, x + w, y, r); mctx.closePath(); }
function measureLabel(item) {
  const drawn = Math.hypot(item.b.x - item.a.x, item.b.y - item.a.y);
  if (!item || item.actual == null) return {text: fmt(drawn), over: false};
  const diff = item.actual - drawn;
  return {text: `도면 ${fmt(drawn)} · 실측 ${fmt(item.actual)} · ${signed(diff)}`, over: Math.abs(diff) > (item.tolerance ?? tolerance)};
}
function drawMeasureLine(a, b, item, isSent, paper) {
  const sa = toScreen(a), sb = toScreen(b), label = item ? measureLabel(item) : {text: fmt(Math.hypot(b.x - a.x, b.y - a.y)), over: false};
  const color = label.over ? '#f08a3e' : '#9dcbe0';
  mctx.save(); mctx.strokeStyle = color; mctx.fillStyle = color; mctx.lineWidth = 1.6;
  const ang = Math.atan2(sb.y - sa.y, sb.x - sa.x), nx = -Math.sin(ang) * 7, ny = Math.cos(ang) * 7;
  mctx.beginPath(); mctx.moveTo(sa.x, sa.y); mctx.lineTo(sb.x, sb.y); mctx.moveTo(sa.x - nx, sa.y - ny); mctx.lineTo(sa.x + nx, sa.y + ny); mctx.moveTo(sb.x - nx, sb.y - ny); mctx.lineTo(sb.x + nx, sb.y + ny); mctx.stroke();
  const mx = (sa.x + sb.x) / 2, my = (sa.y + sb.y) / 2;
  mctx.font = `600 12px ${getComputedStyle(root).fontFamily}`;
  const tw = mctx.measureText(label.text).width + 14;
  mctx.translate(mx, my); let r = ang; if (r > Math.PI / 2 || r < -Math.PI / 2) r += Math.PI; mctx.rotate(r);
  mctx.fillStyle = label.over ? (paper ? '#fff1e6' : '#2e2219') : color; roundRect(-tw / 2, -24, tw, 20, 6); mctx.fill();
  if (label.over) { mctx.strokeStyle = color; mctx.lineWidth = 1; mctx.stroke(); }
  mctx.fillStyle = label.over ? (paper ? '#8a3a07' : '#ffc79e') : '#15171c'; mctx.textAlign = 'center'; mctx.textBaseline = 'middle'; mctx.fillText(label.text, 0, -14);
  mctx.restore();
  void isSent;
}
function drawSnapGlyph(s, kind) {
  const r = 7; mctx.save(); mctx.strokeStyle = '#9dcbe0'; mctx.lineWidth = 2; mctx.beginPath();
  if (kind === '끝점') mctx.rect(s.x - r, s.y - r, r * 2, r * 2);
  else if (kind === '중간점') { mctx.moveTo(s.x, s.y - r); mctx.lineTo(s.x + r, s.y + r); mctx.lineTo(s.x - r, s.y + r); mctx.closePath(); }
  else if (kind === '교차점') { mctx.moveTo(s.x - r, s.y - r); mctx.lineTo(s.x + r, s.y + r); mctx.moveTo(s.x + r, s.y - r); mctx.lineTo(s.x - r, s.y + r); }
  else if (kind === '수직점') { mctx.moveTo(s.x - r, s.y + r); mctx.lineTo(s.x + r, s.y + r); mctx.moveTo(s.x, s.y + r); mctx.lineTo(s.x, s.y - r); }
  else if (kind === '중심점') mctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  else if (kind === '사분점') { mctx.moveTo(s.x, s.y - r); mctx.lineTo(s.x + r, s.y); mctx.lineTo(s.x, s.y + r); mctx.lineTo(s.x - r, s.y); mctx.closePath(); }
  else { mctx.moveTo(s.x - r, s.y - r); mctx.lineTo(s.x + r, s.y - r); mctx.lineTo(s.x - r, s.y + r); mctx.lineTo(s.x + r, s.y + r); mctx.closePath(); }
  mctx.stroke(); mctx.restore();
}

// ── 확대창: 손가락 위에 둥근 창, 안은 GPU 가 4배로 다시 그린다 ──
const LOUPE = 120, LOUPE_ZOOM = 4;
function placeLoupe(screenPoint) {
  const lift = 96, x = Math.max(8, Math.min(input.clientWidth - LOUPE - 8, screenPoint.x - LOUPE / 2));
  let y = screenPoint.y - lift - LOUPE; if (y < 76) y = screenPoint.y + lift;
  loupe = {x, y, center: press.point};
}
function renderLoupe() {
  if (!loupe || !renderer) return;
  const v = view(), k = LOUPE_ZOOM, c = loupe.center;
  const cx = loupe.x + LOUPE / 2, cy = loupe.y + LOUPE / 2;
  renderer.renderRegion({x: loupe.x, y: loupe.y, w: LOUPE, h: LOUPE}, {scale: v.scale * k, ox: cx - (c.x - origin.x) * v.scale * k, oy: cy + (c.y - origin.y) * v.scale * k});
}
function drawLoupeFrame() {
  const {x, y} = loupe, r = LOUPE / 2;
  mctx.save();
  // 네모로 그린 확대 영역의 모서리를 바탕색으로 덮어 둥글게 보이게 한다.
  mctx.beginPath(); mctx.rect(x - 1, y - 1, LOUPE + 2, LOUPE + 2); mctx.arc(x + r, y + r, r, 0, Math.PI * 2, true);
  mctx.fillStyle = theme === 'paper' ? '#f6f6f3' : '#17191e'; mctx.fill('evenodd');
  mctx.beginPath(); mctx.arc(x + r, y + r, r, 0, Math.PI * 2); mctx.strokeStyle = 'rgba(154,161,171,.6)'; mctx.lineWidth = 2; mctx.stroke();
  mctx.strokeStyle = 'rgba(157,203,224,.45)'; mctx.lineWidth = 1; mctx.beginPath(); mctx.moveTo(x + r, y + 10); mctx.lineTo(x + r, y + LOUPE - 10); mctx.moveTo(x + 10, y + r); mctx.lineTo(x + LOUPE - 10, y + r); mctx.stroke();
  if (press?.snap) {
    drawSnapGlyph({x: x + r, y: y + r}, press.snap.kind);
    mctx.font = `600 11.5px ${getComputedStyle(root).fontFamily}`; const tw = mctx.measureText(press.snap.kind).width + 16;
    mctx.fillStyle = '#9dcbe0'; roundRect(x + r - tw / 2, y + LOUPE + 6, tw, 22, 7); mctx.fill();
    mctx.fillStyle = '#15171c'; mctx.textAlign = 'center'; mctx.textBaseline = 'middle'; mctx.fillText(press.snap.kind, x + r, y + LOUPE + 17);
  }
  mctx.restore();
}

// ── 꾹 눌러 점 찍기(치수·핀) ──
function snapAt(screenPoint) {
  const raw = toWorld(screenPoint);
  if (!snapper) snapper = createPadSnapper(pack, renderer.placed);
  const from = measuring?.a ? {x: measuring.a.x - origin.x, y: measuring.a.y - origin.y} : null;
  const hit = snapModes.size ? snapper.snap({x: raw.x - origin.x, y: raw.y - origin.y}, {scale: view().scale, modes: snapModes, from, layerShown: i => renderer.layerVisible(i)}) : null;
  return hit ? {point: {x: hit.x + origin.x, y: hit.y + origin.y}, snap: hit} : {point: raw, snap: null};
}
function startPress(e, p) {
  press = {id: e.pointerId, type: e.pointerType, start: p, last: p, active: false, point: null, snap: null};
  const wait = PRESS_MS[e.pointerType] ?? 300;
  const activate = () => { if (!press || press.active) return; press.active = true; updatePress(press.last); };
  if (wait) press.timer = setTimeout(activate, wait); else activate();
}
function updatePress(p) {
  press.last = p;
  if (!press.active) return;
  const hit = snapAt(p); press.point = hit.point; press.snap = hit.snap;
  placeLoupe(p);
  renderer.renderMoving(); renderLoupe(); paintMarks();
}
function finishPress(cancelled) {
  const done = press; press = null; loupe = null;
  clearTimeout(done?.timer);
  fullRender();
  if (!done?.active || cancelled || !done.point) return;
  if (tool === 'measure') {
    if (!measuring?.a || measuring.b) { measuring = {a: done.point, b: null}; showHint('두 번째 점을 꾹 눌러 찍으세요'); paintMarks(); return; }
    measuring.b = done.point; paintMarks(); openMeasureSheet(); return;
  }
  if (tool === 'pin') {
    const pin = {type: 'pin', id: 'pad-' + randomToken(9), at: done.point, no: nextPinNo(), title: '', kind: '하자', status: '미해결', prio: '보통', assignee: '', due: '', note: '', createdAt: new Date().toISOString()};
    drafts.push(pin); saveDrafts(); openPinSheet(pin, true);
  }
}
const nextPinNo = () => 1 + Math.max(0, ...[...sent, ...drafts].filter(d => d.type === 'pin').map(d => d.no || 0));

// ── 손가락·펜 ──
const pointers = new Map();
let gesture = null, lastTap = 0, memoAt = null;
const local = e => { const r = input.getBoundingClientRect(); return {x: e.clientX - r.left, y: e.clientY - r.top}; };
const pair = () => { const ps = [...pointers.values()]; if (ps.length < 2) return null; return {x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2, d: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), a: Math.atan2(ps[1].y - ps[0].y, ps[1].x - ps[0].x) * 180 / Math.PI}; };
const drawsWith = e => e.pointerType === 'pen' || e.pointerType === 'mouse' || !(penSeen && penSettings.penOnly);
const withPressure = (point, e) => (penSettings.pressure && e.pointerType === 'pen' && e.pressure > 0 ? {...point, p: Math.round(e.pressure * 100) / 100} : point);
function hitPin(p) {
  const all = [...drafts, ...sent].filter(d => d.type === 'pin');
  return all.reverse().find(pin => { const s = toScreen(pin.at); return Math.hypot(s.x - p.x, s.y - 19 - p.y) < 22; }) || null;
}
input.onpointerdown = e => {
  e.preventDefault(); if (!renderer) return;
  if (e.pointerType === 'pen') penSeen = true;
  const p = local(e);
  try { input.setPointerCapture(e.pointerId); } catch {}
  pointers.set(e.pointerId, {...p, type: e.pointerType});
  if (pointers.size > 1) {
    if (press) { clearTimeout(press.timer); press = null; loupe = null; }
    stroke = null;
    const g = pair(); gesture = {...g, ruler: [...pointers.values()].every(onRuler), view: {...view()}}; return;
  }
  if (e.pointerType !== 'pen' && onRuler(p)) { rulerState.drag = {from: p, x: rulerState.x, y: rulerState.y}; return; }
  const pin = (tool === 'view' || tool === 'pin' || tool === 'measure') ? hitPin(p) : null;
  if (pin) { gesture = {tapPin: pin, last: p}; return; }
  // 치수·핀은 펜을 쓴 뒤에도 손가락으로 꾹 눌러 온스냅을 잡는다(사용자 10/19). 움직이면 startPress 가 이동으로 바꾼다.
  // 예전에는 펜을 본 뒤 손가락이 아래 두 번 누르기(전체 보기)로 빠져 화면이 통째로 바뀌었다.
  if (tool === 'measure' || tool === 'pin') { startPress(e, p); return; }
  if (tool === 'pen' && drawsWith(e)) {
    if (lasso?.moving) { lasso.moving.from = toWorld(p); lasso.moving.id = e.pointerId; return; }
    if (penKind === 'eraser') { erasing = true; eraseAt(p); return; }
    if (penKind === 'lasso') { closeLasso(); lasso = {id: e.pointerId, points: [toWorld(p)], picked: null}; paintMarks(); return; }
    const edge = rulerEdge(p), at = edge === null ? p : rulerGlobal({x: rulerLocal(p).x, y: edge});
    stroke = {id: e.pointerId, kind: penKind, width: penWidth, color: PEN_COLORS[penColor][0], edge, points: [withPressure(toWorld(at), e)]}; paintMarks(); return;
  }
  if (tool === 'memo' && drawsWith(e)) { memoAt = p; return; }
  const now = Date.now(); if (now - lastTap < 300) { lastTap = 0; renderer.fit(); fullRender(); return; } lastTap = now;
  gesture = {single: true, last: p};
};
// 꾹 누르면 iPad 가 띄우는 복사·선택 메뉴가 누르기를 가로채지 않게 한다.
input.addEventListener('contextmenu', e => e.preventDefault());
// 아이폰은 CSS 만으로는 꾹 누를 때 페이지 전체 선택(파란 칸·복사하기)이 뜬다 — 글 입력 칸 밖의 선택 시작을 막는다.
document.addEventListener('selectstart', e => { const t = e.target.nodeType === 1 ? e.target : e.target.parentElement; if (!t?.closest('input,textarea,[contenteditable]')) e.preventDefault(); });
let erasing = false;
function eraseAt(p) {
  const before = drafts.length;
  drafts = drafts.filter(d => d.type !== 'mark' || !d.points.some(q => { const s = toScreen(q); return Math.hypot(s.x - p.x, s.y - p.y) < 14; }));
  if (drafts.length !== before) saveDrafts();
}
// ── 올가미: 아직 안 보낸 표시를 둘러 고르고 옮기기·색 바꾸기·핀으로 만들기·지우기 ──
const draftPoints = d => d.type === 'mark' ? d.points : d.type === 'measure' ? [d.a, d.b] : [d.at];
function insidePolygon(q, ring) {
  let odd = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a.y > q.y) !== (b.y > q.y) && q.x < (b.x - a.x) * (q.y - a.y) / (b.y - a.y) + a.x) odd = !odd; }
  return odd;
}
function pickLasso() {
  const ring = lasso.points;
  if (ring.length < 3) { closeLasso(); return; }
  lasso.picked = new Set(drafts.filter(d => draftPoints(d).some(q => insidePolygon(q, ring))));
  if (!lasso.picked.size) { say('고른 표시가 없습니다. 아직 보내지 않은 표시만 고를 수 있습니다.'); closeLasso(); return; }
  showLassoMenu();
}
function moveDraft(d, dx, dy) {
  const shift = q => { q.x = Math.round((q.x + dx) * 10) / 10; q.y = Math.round((q.y + dy) * 10) / 10; };
  if (d.type === 'mark') d.points.forEach(shift); else if (d.type === 'measure') { shift(d.a); shift(d.b); } else shift(d.at);
}
function showLassoMenu() {
  lasso.menu?.remove();
  const box = lasso.points.map(toScreen).reduce((b, q) => [Math.min(b[0], q.x), Math.min(b[1], q.y), Math.max(b[2], q.x)], [Infinity, Infinity, -Infinity]);
  const n = lasso.picked.size, all = [...lasso.picked];
  const act = (label, fn, cls = '') => el('button', {type: 'button', class: `ghost ${cls}`, textContent: label, onClick: fn});
  lasso.menu = el('div', {class: 'menu air', role: 'menu', ariaLabel: `고른 표시 ${n}개`, style: {left: Math.max(8, Math.min(input.clientWidth - 360, box[0])) + 'px', top: Math.max(80, box[1] - 52) + 'px'}},
    el('span', {class: 'lbl', textContent: `${n}개`, style: {alignSelf: 'center', padding: '0 8px'}}),
    act('옮기기', () => { lasso.moving = {from: null}; lasso.menu.remove(); showHint('끌어서 옮기세요'); }),
    act('색 바꾸기', () => { for (const d of all) if (d.type === 'mark') d.color = PEN_COLORS[(PEN_COLORS.findIndex(c => c[0] === d.color) + 1) % PEN_COLORS.length][0]; saveDrafts(); }),
    act('핀으로 만들기', () => {
      const pts = all.flatMap(draftPoints), at = {x: pts.reduce((a, q) => a + q.x, 0) / pts.length, y: pts.reduce((a, q) => a + q.y, 0) / pts.length};
      const pin = {type: 'pin', id: 'pad-' + randomToken(9), at: round1(at), no: nextPinNo(), title: '', kind: '하자', status: '미해결', prio: '보통', assignee: '', due: '', note: `표시 ${n}개 묶음`, createdAt: new Date().toISOString()};
      drafts.push(pin); closeLasso(); saveDrafts(); openPinSheet(pin, true);
    }),
    act('지우기', () => { drafts = drafts.filter(d => !lasso.picked.has(d)); closeLasso(); saveDrafts(); }, 'danger'),
    act('닫기', () => closeLasso()));
  root.append(lasso.menu);
  paintMarks();
}
function closeLasso() { lasso?.menu?.remove(); lasso = null; hideHint(); paintMarks(); }

input.onpointermove = e => {
  if (!pointers.has(e.pointerId)) return; e.preventDefault();
  const p = local(e), before = pointers.get(e.pointerId); pointers.set(e.pointerId, {...p, type: before.type});
  if (rulerState.drag && pointers.size === 1) { rulerState.x = rulerState.drag.x + p.x - rulerState.drag.from.x; rulerState.y = rulerState.drag.y + p.y - rulerState.drag.from.y; placeRuler(); return; }
  const next = pair();
  if (next && gesture && !gesture.single && !gesture.tapPin) {
    if (gesture.ruler) { rulerState.angle = snapAngle(rulerState.angle + next.a - gesture.a); rulerState.x += next.x - gesture.x; rulerState.y += next.y - gesture.y; placeRuler(); Object.assign(gesture, {x: next.x, y: next.y, a: next.a}); return; }
    const k = next.d / Math.max(1, gesture.d), v0 = gesture.view;
    renderer.setView({scale: v0.scale * k, ox: next.x - (gesture.x - v0.ox) * k, oy: next.y - (gesture.y - v0.oy) * k}); requestMoving(); return;
  }
  if (press?.id === e.pointerId) {
    if (!press.active && Math.hypot(p.x - press.start.x, p.y - press.start.y) > 10 && press.type === 'touch') { clearTimeout(press.timer); press = null; gesture = {single: true, last: p}; return; }
    updatePress(p); return;
  }
  if (gesture?.tapPin) { if (Math.hypot(p.x - gesture.last.x, p.y - gesture.last.y) > 10) gesture = {single: true, last: p}; return; }
  if (gesture?.single) { const v = view(); renderer.setView({ox: v.ox + p.x - gesture.last.x, oy: v.oy + p.y - gesture.last.y}); gesture.last = p; requestMoving(); return; }
  if (erasing) { eraseAt(p); return; }
  if (lasso?.moving?.id === e.pointerId) { const w = toWorld(p), dx = w.x - lasso.moving.from.x, dy = w.y - lasso.moving.from.y; lasso.moving.from = w; for (const d of lasso.picked) moveDraft(d, dx, dy); paintMarks(); return; }
  if (lasso?.id === e.pointerId && !lasso.picked) { lasso.points.push(toWorld(p)); paintMarks(); return; }
  if (stroke?.id === e.pointerId) {
    const at = stroke.edge === null ? p : rulerGlobal({x: rulerLocal(p).x, y: stroke.edge}); stroke.points.push(withPressure(toWorld(at), e));
    if (stroke.edge !== null) { const a = stroke.points[0], b = stroke.points.at(-1); showHint(`${fmt(Math.hypot(b.x - a.x, b.y - a.y))} mm`); }
    paintMarks();
  }
};
function end(e) {
  if (!pointers.has(e.pointerId)) return; pointers.delete(e.pointerId);
  if (rulerState.drag) { rulerState.drag = null; return; }
  if (press?.id === e.pointerId) { finishPress(e.type === 'pointercancel'); return; }
  if (gesture?.tapPin && e.type === 'pointerup') { const pin = gesture.tapPin; gesture = null; openPinSheet(pin, false); return; }
  if (memoAt && e.type === 'pointerup') { openMemo(memoAt); memoAt = null; return; }
  if (erasing) { erasing = false; return; }
  if (lasso?.moving?.id === e.pointerId) { lasso.moving = null; saveDrafts(); showLassoMenu(); return; }
  if (lasso?.id === e.pointerId && !lasso.picked) { pickLasso(); return; }
  if (stroke?.id === e.pointerId) {
    const done = stroke; stroke = null; hideHint();
    if (e.type !== 'pointercancel' && done.points.length > 1) {
      const points = done.edge === null ? done.points : [done.points[0], done.points.at(-1)], step = Math.ceil(points.length / 400);
      drafts.push({type: 'mark', id: 'pad-' + randomToken(9), kind: done.kind, width: done.width, color: done.color, points: points.filter((_, i) => i % step === 0 || i === points.length - 1).map(q => ({x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10, ...(q.p ? {p: q.p} : {})}))});
      saveDrafts();
    } else paintMarks();
  }
  if (!pointers.size) { const wasMoving = gesture && !gesture.tapPin; gesture = null; if (wasMoving) fullRender(); }
}
input.onpointerup = end; input.onpointercancel = end;
input.onlostpointercapture = e => { if (pointers.has(e.pointerId)) end({type: 'pointercancel', pointerId: e.pointerId}); };
input.onwheel = e => { e.preventDefault(); if (renderer) zoomBy(Math.exp(-e.deltaY * 0.0015), local(e)); };

// ── 자 ──
const rulerState = {visible: false, x: 0, y: 0, angle: 0, placed: false, drag: null};
function placeRuler() { ruler.hidden = !rulerState.visible; ruler.style.transform = `translate(${rulerState.x}px,${rulerState.y}px) rotate(${rulerState.angle}deg)`; ruler.firstChild.textContent = Math.round(((rulerState.angle % 360) + 360) % 360) + '°'; }
const rulerLocal = p => { const a = -rulerState.angle * Math.PI / 180, dx = p.x - rulerState.x, dy = p.y - rulerState.y; return {x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a)}; };
const rulerGlobal = q => { const a = rulerState.angle * Math.PI / 180; return {x: rulerState.x + q.x * Math.cos(a) - q.y * Math.sin(a), y: rulerState.y + q.x * Math.sin(a) + q.y * Math.cos(a)}; };
const onRuler = p => { if (!rulerState.visible) return false; const q = rulerLocal(p); return q.x >= 0 && q.x <= RULER_LENGTH && q.y >= 0 && q.y <= RULER_HEIGHT; };
function rulerEdge(p) { if (!rulerState.visible) return null; const q = rulerLocal(p); if (q.x < -20 || q.x > RULER_LENGTH + 20) return null; for (const edge of [0, RULER_HEIGHT]) if (Math.abs(q.y - edge) <= EDGE_PX) return edge; return null; }
const snapAngle = a => { for (const t of [0, 45, 90, 135, 180, 225, 270, 315, 360]) if (Math.abs(((a % 360) + 360) % 360 - t) <= 3) return t % 360; return a; };
function toggleRuler() {
  rulerState.visible = !rulerState.visible;
  if (rulerState.visible && !rulerState.placed) { rulerState.x = (input.clientWidth - RULER_LENGTH) / 2; rulerState.y = input.clientHeight / 2 - RULER_HEIGHT / 2; rulerState.placed = true; }
  const b = toolButtons.get('ruler'); b.classList.toggle('on', rulerState.visible); b.setAttribute('aria-pressed', String(rulerState.visible)); placeRuler();
}

// ── 도구·안내 ──
const HINTS = {measure: '두 점을 꾹 눌러 찍으세요 · 온스냅이 붙습니다', pin: '꾹 눌러 핀을 꽂으세요', memo: '글을 남길 자리를 누르세요', pen: '펜으로 그리세요 · 손가락은 화면 이동'};
function setTool(name) {
  tool = name; stroke = null; measuring = null;
  for (const [key, b] of toolButtons) if (key !== 'ruler') { const on = key === name; b.classList.toggle('on', on); b.classList.toggle('ghost', !on); b.setAttribute('aria-pressed', String(on)); }
  penPalette.hidden = name !== 'pen'; if (name === 'pen') buildPenPalette();
  if (name !== 'pen') { closeLasso(); if (penSettingsBox) { penSettingsBox.remove(); penSettingsBox = null; } }
  if (HINTS[name]) showHint(name === 'pen' && !penSeen ? '손가락이나 펜으로 그리세요 · 두 손가락은 화면 이동' : HINTS[name]); else hideHint();
  if (name !== 'measure' && currentSheet === 'measure') closeSheet();
  paintMarks();
}
function showHint(text) { hint.textContent = text; hint.hidden = false; }
function hideHint() { hint.hidden = true; }
function setTheme(next) {
  theme = next; renderer?.setTheme(next); document.documentElement.dataset.padTheme = next;
  for (const b of themeButtons) { const on = b.dataset.theme === next; b.className = on ? 'on' : 'ghost'; b.setAttribute('aria-pressed', String(on)); }
  saveJson('barun-pad-theme', next); fullRender();
}
let penSettingsBox = null;
function togglePenSettings() {
  if (penSettingsBox) { penSettingsBox.remove(); penSettingsBox = null; buildPenPalette(); return; }
  const row = (key, label) => el('label', {class: 'row ghost'}, el('span', {class: 'meta'}, el('b', {textContent: label})),
    el('input', {type: 'checkbox', checked: penSettings[key], onChange: e => { penSettings[key] = e.target.checked; saveJson('barun-pad-pen', penSettings); }, style: {width: '18px', height: '18px', accentColor: '#9dcbe0'}}));
  penSettingsBox = el('div', {class: 'memo air', role: 'dialog', ariaLabel: '펜 설정', style: {left: '50%', transform: 'translateX(-50%)', bottom: 'calc(max(18px, env(safe-area-inset-bottom)) + 140px)', width: '320px'}},
    row('penOnly', '펜슬로만 그리기 (손가락은 화면 이동)'), row('pressure', '누르는 힘 따라 굵기'),
    el('p', {class: 'lbl', textContent: '손글씨를 글자로: [글] 상자에 펜슬로 쓰면 기기(아이패드 Scribble·갤럭시 S펜)가 글자로 바꿉니다.'}));
  root.append(penSettingsBox); buildPenPalette();
}
function buildPenPalette() {
  const kinds = [['pen', '펜'], ['hl', '형광펜'], ['eraser', '지우개'], ['lasso', '올가미']].map(([k, label]) => el('button', {type: 'button', class: k === penKind ? 'on' : 'ghost', textContent: label, ariaPressed: String(k === penKind), onClick: () => { penKind = k; if (k !== 'lasso') closeLasso(); buildPenPalette(); showHint(k === 'lasso' ? '보내기 전 표시를 둘러 고르세요' : HINTS.pen); }}));
  const widths = [6, 9, 14].map((px, i) => el('button', {type: 'button', class: i === penWidth ? 'on' : 'ghost', ariaLabel: ['가늘게', '보통', '굵게'][i], ariaPressed: String(i === penWidth), onClick: () => { penWidth = i; buildPenPalette(); }}, el('span', {style: {display: 'block', width: px + 'px', height: px + 'px', borderRadius: '50%', background: '#eef0f3'}})));
  const colors = PEN_COLORS.map(([hex, label], i) => el('button', {type: 'button', class: 'ghost', ariaLabel: label, ariaPressed: String(i === penColor), style: {width: '40px', borderRadius: '50%', boxShadow: i === penColor ? 'inset 0 0 0 2px #9dcbe0' : 'none'}, onClick: () => { penColor = i; buildPenPalette(); }}, el('span', {style: {display: 'block', width: '24px', height: '24px', borderRadius: '50%', background: hex, margin: 'auto'}})));
  const extras = [el('button', {type: 'button', class: 'ghost phone-only', textContent: '글', onClick: () => setTool('memo')}), el('button', {type: 'button', class: 'ghost phone-only', textContent: '자', onClick: () => toggleRuler()}),
    el('button', {type: 'button', class: 'ghost', textContent: '설정', ariaExpanded: String(!!penSettingsBox), onClick: () => togglePenSettings()})];
  penPalette.replaceChildren(...kinds, el('div', {class: 'sep'}), ...widths, el('div', {class: 'sep'}), ...colors, ...extras);
  Object.assign(penPalette.style, {left: '50%', transform: 'translateX(-50%)', bottom: 'calc(max(18px, env(safe-area-inset-bottom)) + 80px)'});
}

// ── 글(메모) ──
let memoBox = null;
function openMemo(p) {
  memoBox?.remove();
  const field = el('input', {class: 'well', autocomplete: 'off', placeholder: '키보드로 치거나 펜으로 쓰기', ariaLabel: '메모'});
  memoBox = el('form', {class: 'memo air', style: {left: Math.max(8, Math.min(input.clientWidth - 308, p.x)) + 'px', top: Math.max(80, Math.min(input.clientHeight - 150, p.y)) + 'px'}},
    el('span', {class: 'lbl', textContent: '글 남기기'}), field,
    el('div', {class: 'actions'}, el('button', {type: 'button', class: 'btn well', textContent: '닫기', onClick: () => { memoBox.remove(); memoBox = null; }}), el('button', {class: 'btn primary', textContent: '넣기'})));
  memoBox.onsubmit = e => {
    e.preventDefault(); const text = field.value.trim(); if (!text) return;
    const at = toWorld(p);
    drafts.push({type: 'memo', id: 'pad-' + randomToken(9), at: {x: Math.round(at.x), y: Math.round(at.y)}, text, height: Math.round(Math.max(50, 18 / view().scale))});
    memoBox.remove(); memoBox = null; saveDrafts();
  };
  root.append(memoBox); field.focus();
}

// ── 판(시트) ──
let currentSheet = null, sheetNode = null;
function openSheet(name, build) {
  closeSheet(false);
  currentSheet = name;
  const content = build ? build() : name === 'layers' ? layersSheet() : name === 'list' ? listSheet() : null;
  if (!content) return;
  sheetNode = el('aside', {class: 'sheet air', ariaLabel: content.title}, el('span', {class: 'grab', ariaHidden: 'true'}),
    el('header', {}, ...(content.head || [el('h2', {textContent: content.title})]), el('button', {type: 'button', class: 'icon ghost', ariaLabel: '닫기', onClick: () => closeSheet()}, svg('close'))),
    el('div', {class: 'hsep'}), el('div', {class: 'body'}, ...content.body), content.footer ? el('footer', {}, ...content.footer) : null);
  sheetHost.replaceChildren(sheetNode);
  root.classList.add('sheet-open'); hideHint();
}
function closeSheet(resetMeasure = true) {
  if (currentSheet === 'measure' && resetMeasure) { measuring = null; if (tool === 'measure') showHint(HINTS.measure); }
  if (currentSheet === 'pin') editingPin = null;
  currentSheet = null; sheetNode = null; sheetHost.replaceChildren(); root.classList.remove('sheet-open'); paintMarks();
}
const pickRow = (labels, value, onPick, {chips = false, dots = null} = {}) => {
  const wrap = el('div', {class: chips ? 'chips' : 'pick well', role: 'group'});
  const render = current => wrap.replaceChildren(...labels.map(label => el('button', {type: 'button', class: label === current ? 'on' : chips ? 'well' : 'ghost', ariaPressed: String(label === current), onClick: () => { onPick(label); render(label); }}, dots ? el('span', {class: 'dot', style: {background: dots[label]}}) : null, label)));
  render(value); return wrap;
};

function openMeasureSheet() {
  const m = measuring, drawn = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y), angle = ((Math.atan2(m.b.y - m.a.y, m.b.x - m.a.x) * 180 / Math.PI) + 360) % 360;
  const field = el('input', {class: 'big on', inputMode: 'decimal', placeholder: '현장에서 잰 값', ariaLabel: '현장에서 잰 값(mm)', ariaDescribedby: 'pad-diff'});
  const diff = el('div', {class: 'warn', id: 'pad-diff', hidden: true});
  const update = () => {
    const v = Number(field.value.replace(/[^0-9.\-]/g, ''));
    if (!field.value || !Number.isFinite(v)) { diff.hidden = true; return; }
    const d = v - drawn, over = Math.abs(d) > tolerance;
    diff.hidden = false; diff.classList.toggle('ok', !over);
    diff.replaceChildren(el('b', {textContent: `차이 ${signed(d)} mm`}), el('span', {textContent: over ? `허용 ±${tolerance} 넘음` : `허용 ±${tolerance} 안`}));
  };
  field.oninput = update;
  const key = ch => () => { field.value = ch === '⌫' ? field.value.slice(0, -1) : field.value + ch; update(); };
  const keys = el('div', {class: 'keys'}, ...['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', '⌫'].map(ch => el('button', {type: 'button', class: 'well', textContent: ch, ariaLabel: ch === '⌫' ? '한 글자 지우기' : null, onClick: key(ch)})));
  const save = withActual => {
    const v = Number(field.value.replace(/[^0-9.\-]/g, ''));
    if (withActual && !(field.value && Number.isFinite(v))) { say('현장에서 잰 값을 넣으세요.', true); return; }
    drafts.push({type: 'measure', id: 'pad-' + randomToken(9), a: round1(m.a), b: round1(m.b), actual: withActual ? v : null, tolerance});
    measuring = null; closeSheet(false); saveDrafts(); showHint(HINTS.measure);
  };
  openSheet('measure', () => ({
    title: '실측 남기기',
    body: [
      el('div', {class: 'chips', role: 'group', ariaLabel: '온스냅'}, ...SNAP_MODES_ALL.map(mode => el('button', {type: 'button', class: snapModes.has(mode) ? 'on' : 'well', ariaPressed: String(snapModes.has(mode)), textContent: mode, onClick: e => { snapModes.has(mode) ? snapModes.delete(mode) : snapModes.add(mode); saveJson('barun-pad-snap', [...snapModes]); e.currentTarget.className = snapModes.has(mode) ? 'on' : 'well'; e.currentTarget.setAttribute('aria-pressed', String(snapModes.has(mode))); }}))),
      el('div', {class: 'keys', style: {gridTemplateColumns: 'repeat(2,minmax(0,1fr))'}},
        el('div', {class: 'stat well'}, el('span', {class: 'lbl', textContent: '도면 길이'}), el('b', {textContent: fmt(drawn)}), el('small', {textContent: ' mm'})),
        el('div', {class: 'stat well'}, el('span', {class: 'lbl', textContent: '각도'}), el('b', {textContent: Math.round(angle) + '°'}))),
      el('label', {class: 'field'}, el('span', {class: 'lbl', textContent: '현장에서 잰 값'}), field),
      diff, keys,
    ],
    footer: [el('button', {type: 'button', class: 'btn well', textContent: '길이만 표시', onClick: () => save(false)}), el('button', {type: 'button', class: 'btn primary grow', textContent: '실측 남기기', onClick: () => save(true)})],
  }));
}
const round1 = p => ({x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10});

function openPinSheet(pin, isNew) {
  const isDraft = drafts.includes(pin);
  editingPin = pin; paintMarks();
  const v = {...pin};
  const title = el('input', {class: 'well', value: v.title, placeholder: '예: 주방 벽 사이 50 짧음', ariaLabel: '제목'});
  const who = el('input', {class: 'well', value: v.assignee || '', placeholder: '누가', ariaLabel: '담당'});
  const due = el('input', {class: 'well', type: 'date', value: v.due || '', ariaLabel: '기한'});
  const note = el('textarea', {class: 'well', rows: 3, value: v.note || '', placeholder: '설명', ariaLabel: '설명'});
  v.photos = [...(pin.photos || [])];
  const save = () => {
    Object.assign(pin, {title: title.value.trim() || `${v.kind} ${pin.no}`, kind: v.kind, status: v.status, prio: v.prio, assignee: who.value.trim(), due: due.value, note: note.value.trim(), photos: v.photos, updatedAt: new Date().toISOString()});
    if (!isDraft) { pin.changed = true; drafts.push(pin); sent = sent.filter(s => s !== pin); }
    closeSheet(); saveDrafts();
  };
  const remove = () => { drafts = drafts.filter(d => d !== pin); closeSheet(); saveDrafts(); };
  openSheet('pin', () => ({
    title: `핀 ${pin.no}`,
    head: [el('span', {class: 'badge', style: {background: STATE_COLOR[v.status]}, textContent: String(pin.no)}), el('h2', {textContent: `핀 ${pin.no}`}), el('span', {class: 'lbl', textContent: `X ${fmt(pin.at.x)} · Y ${fmt(pin.at.y)}`})],
    body: [
      el('label', {class: 'field'}, el('span', {class: 'lbl', textContent: '제목'}), title),
      el('div', {class: 'field'}, el('span', {class: 'lbl', textContent: '유형'}), pickRow(KINDS, v.kind, x => { v.kind = x; })),
      el('div', {class: 'field'}, el('span', {class: 'lbl', textContent: '상태'}), pickRow(STATES, v.status, x => { v.status = x; }, {chips: true, dots: STATE_COLOR})),
      el('div', {class: 'field'}, el('span', {class: 'lbl', textContent: '급한 정도'}), pickRow(PRIOS, v.prio, x => { v.prio = x; })),
      el('div', {class: 'keys', style: {gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '10px'}},
        el('label', {class: 'field'}, el('span', {class: 'lbl', textContent: '담당'}), who),
        el('label', {class: 'field'}, el('span', {class: 'lbl', textContent: '기한'}), due)),
      el('label', {class: 'field'}, el('span', {class: 'lbl', textContent: '설명'}), note),
      pin.reply ? el('div', {class: 'warn ok'}, el('b', {textContent: `사무실 답 · ${timeText(pin.repliedAt)}`}), el('span', {textContent: pin.reply})) : null,
      caps.has('photo') ? photoField(v) : el('p', {class: 'lbl', textContent: '사진 첨부는 사무실 바른 CAD 를 새 판으로 올리면 쓸 수 있습니다.'}),
    ],
    footer: [isDraft ? el('button', {type: 'button', class: 'btn well danger', textContent: '핀 지우기', onClick: remove}) : null, el('button', {type: 'button', class: 'btn primary grow', textContent: isNew ? '핀 남기기' : '저장', onClick: save})],
  }));
  if (isNew) title.focus();
}

// 구조 보기용 레이어 이름(A- 표준·한글·흔한 영문): 벽·기둥·창·문·계단·구조.
const MAIN_LAYER = /(WALL|COL|GLAZ|WIN|DOOR|STAIR|STR|CONC|벽|기둥|창|문|계단|구조)/i;
function photoField(v) {
  const grid = el('div', {class: 'photos'}), count = el('span', {class: 'lbl'});
  const pickFile = el('input', {type: 'file', accept: 'image/*', hidden: true});
  pickFile.setAttribute('capture', 'environment');
  pickFile.onchange = async () => {
    const file = pickFile.files?.[0]; pickFile.value = '';
    if (!file) return;
    try { const blob = await shrinkPhoto(file), id = 'local-' + randomToken(9); await store.putPhoto(id, blob); v.photos.push({id, local: true}); render(); }
    catch (error) { say(error.message || '사진을 넣지 못했습니다.', true); }
  };
  const render = () => {
    count.textContent = `${v.photos.length} / 10`;
    grid.replaceChildren(...v.photos.map(ph => {
      const box = el('div', {class: 'ph', role: 'img', ariaLabel: '현장 사진'});
      photoBlob(ph).then(blob => { const img = el('img', {alt: '현장 사진', src: URL.createObjectURL(blob)}); box.replaceWith(img); }).catch(() => { box.textContent = '사진 없음'; });
      return box;
    }), v.photos.length < 10 ? el('button', {type: 'button', class: 'on', onClick: () => pickFile.click()}, '찍기') : null);
  };
  render();
  return el('div', {class: 'field'}, el('div', {class: 'actions', style: {justifyContent: 'space-between'}}, el('span', {class: 'lbl', textContent: '사진'}), count), grid, pickFile);
}
function layersSheet() {
  const layers = pack.header.layers.map((layer, i) => ({...layer, i})).filter(l => l.name);
  const list = el('div', {class: 'list'});
  const search = el('input', {placeholder: '이름으로 찾기', ariaLabel: '레이어 찾기'});
  const count = el('span', {class: 'lbl'});
  const render = () => {
    const q = search.value.trim().toLowerCase();
    const shown = layers.filter(l => !q || l.name.toLowerCase().includes(q));
    count.textContent = `${layers.length}개 중 ${layers.filter(l => renderer.layerVisible(l.i)).length}개 보임`;
    list.replaceChildren(...kids(shown.slice(0, 400).map(l => {
      const on = renderer.layerVisible(l.i);
      return el('button', {type: 'button', class: `row ghost ${on ? '' : 'off'}`, ariaPressed: String(on), onClick: () => { renderer.setLayerVisible(l.i, !on); fullRender(); render(); }},
        el('span', {class: 'dot', style: {background: l.color, opacity: on ? 1 : 0.35}}),
        el('span', {class: 'meta'}, el('b', {textContent: l.name})), svg(on ? 'eye' : 'eyeOff'));
    }), shown.length > 400 ? el('p', {class: 'lbl', textContent: `${shown.length - 400}개 더 — 이름으로 찾으세요`}) : null));
  };
  search.oninput = render; render();
  return {
    title: '레이어',
    head: [el('h2', {textContent: '레이어'}), count],
    body: [
      el('label', {class: 'search well'}, svg('search'), search),
      el('div', {class: 'chips'},
        el('button', {type: 'button', class: 'well', textContent: '모두 보기', onClick: () => { layers.forEach(l => renderer.setLayerVisible(l.i, true)); fullRender(); render(); }}),
        el('button', {type: 'button', class: 'well', textContent: '벽·창·문만', onClick: () => { layers.forEach(l => renderer.setLayerVisible(l.i, MAIN_LAYER.test(l.name))); fullRender(); render(); }})),
      el('p', {class: 'lbl', textContent: '끈 레이어는 이 패드에서만 숨습니다 · 사무실 도면은 그대로'}),
      list,
    ],
  };
}
const PRIO_RANK = {'긴급': 0, '높음': 1, '보통': 2, '낮음': 3};
const isOverdue = pin => pin.due && pin.status !== '해결' && pin.due < new Date().toISOString().slice(0, 10);
function listSheet() {
  let filter = null, prio = null, overdue = false, sort = loadJson('barun-pad-sort', '급한 순');
  const query = el('input', {placeholder: '제목·담당·설명으로 찾기', ariaLabel: '기록 찾기'});
  const sortSelect = el('select', {class: 'well', ariaLabel: '정렬', style: {height: '36px', borderRadius: '10px', padding: '0 8px'}}, ...['급한 순', '기한 순', '최근 고친 순', '번호 순'].map(v => el('option', {value: v, textContent: v, selected: v === sort})));
  const sorters = {
    '급한 순': (a, b) => (PRIO_RANK[a.prio] ?? 9) - (PRIO_RANK[b.prio] ?? 9) || (a.no || 0) - (b.no || 0),
    '기한 순': (a, b) => (a.due || '9999') .localeCompare(b.due || '9999') || (a.no || 0) - (b.no || 0),
    '최근 고친 순': (a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')),
    '번호 순': (a, b) => (a.no || 0) - (b.no || 0),
  };
  const pins = () => [...sent, ...drafts].filter(d => d.type === 'pin').sort(sorters[sort] || sorters['번호 순']);
  const list = el('div', {class: 'list'}), chips = el('div', {class: 'chips', role: 'group', ariaLabel: '상태로 거르기'}), prios = el('div', {class: 'chips', role: 'group', ariaLabel: '급한 정도로 거르기'});
  const render = () => {
    const q = query.value.trim().toLowerCase(), all = pins();
    const shown = all.filter(p => (!filter || p.status === filter) && (!prio || p.prio === prio) && (!overdue || isOverdue(p)) && (!q || [p.title, p.assignee, p.note, p.kind].some(v => String(v || '').toLowerCase().includes(q))));
    chips.replaceChildren(...STATES.map(s => el('button', {type: 'button', class: filter === s ? 'on' : 'well', ariaPressed: String(filter === s), onClick: () => { filter = filter === s ? null : s; render(); }}, el('span', {class: 'dot', style: {background: STATE_COLOR[s]}}), `${s} ${all.filter(p => p.status === s).length}`)),
      el('button', {type: 'button', class: overdue ? 'on' : 'well', ariaPressed: String(overdue), onClick: () => { overdue = !overdue; render(); }}, el('span', {class: 'dot', style: {background: '#ff9b8f'}}), `기한 지남 ${all.filter(isOverdue).length}`));
    prios.replaceChildren(...PRIOS.map(s => el('button', {type: 'button', class: prio === s ? 'on' : 'well', ariaPressed: String(prio === s), onClick: () => { prio = prio === s ? null : s; render(); }}, `${s} ${all.filter(p => p.prio === s).length}`)));
    const measures = [...sent, ...drafts].filter(d => d.type === 'measure');
    list.replaceChildren(...kids(shown.map(pin => el('button', {type: 'button', class: 'row ghost', onClick: () => { goTo(pin.at); openPinSheet(pin, false); }},
      el('span', {class: 'badge', style: {background: STATE_COLOR[pin.status]}, textContent: String(pin.no)}),
      el('span', {class: 'meta'}, el('b', {textContent: pin.title || `${pin.kind} ${pin.no}`}), el('span', {textContent: [pin.kind, pin.prio, pin.assignee, pin.due && (isOverdue(pin) ? `기한 지남 ${pin.due}` : `기한 ${pin.due}`), pin.reply && `사무실: ${pin.reply}`, drafts.includes(pin) ? '보낼 것' : '보냄'].filter(Boolean).join(' · ')})))),
      shown.length ? null : el('p', {class: 'empty', textContent: all.length ? '맞는 핀이 없습니다.' : '아직 핀이 없습니다. [핀]으로 꾹 눌러 꽂으세요.'}),
      measures.length ? el('div', {class: 'hsep'}) : null,
      ...measures.map(m => { const l = measureLabel(m); return el('button', {type: 'button', class: 'row ghost', onClick: () => { goTo({x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2}); closeSheet(); }}, svg('measure'), el('span', {class: 'meta'}, el('b', {textContent: l.text}), el('span', {textContent: (l.over ? '허용 넘음 · ' : '') + (drafts.includes(m) ? '보낼 것' : '보냄')}))); })));
  };
  query.oninput = render;
  sortSelect.onchange = () => { sort = sortSelect.value; saveJson('barun-pad-sort', sort); render(); };
  render();
  return {title: '현장 기록', body: [el('div', {class: 'actions', style: {justifyContent: 'stretch'}}, el('label', {class: 'search well grow'}, svg('search'), query), sortSelect), chips, prios, list]};
}
function goTo(p) { const v = view(); const s = toScreen(p); renderer.setView({ox: v.ox + input.clientWidth / 2 - s.x, oy: v.oy + input.clientHeight / 2 - s.y}); fullRender(); }

function undo() {
  if (measuring?.a) { measuring = null; paintMarks(); return; }
  if (drafts.length) { drafts.pop(); saveDrafts(); } else say('되돌릴 것이 없습니다. 이미 보낸 것은 사무실에서 지웁니다.');
}

// ── 위 줄 정보 ──
function refreshInfo() {
  if (!session) return;
  const left = Date.parse(session.expiresAt) - Date.now(), hours = Math.max(0, Math.floor(left / 3600000)), minutes = Math.max(0, Math.floor(left / 60000) % 60);
  const time = left <= 0 ? '링크 끝남' : hours ? `${hours}시간 남음` : `${minutes}분 남음`;
  const ack = lastSentSeq && received >= lastSentSeq ? ` · 사무실 받음 ${receivedAt}` : lastSentSeq ? ' · 사무실 확인 기다리는 중' : '';
  titleSub.textContent = `${session.receivedText} · ${time}${ack}`;
  countText.replaceChildren('보낼 것 ', el('strong', {textContent: String(drafts.length)}));
  // 왼쪽 아래 요약: 상태별 핀 수 · 허용 넘은 실측(있는 것만)
  const all = [...sent, ...drafts], pins = all.filter(d => d.type === 'pin'), over = all.filter(d => d.type === 'measure' && measureLabel(d).over).length;
  const rows = STATES.map(st => [st, pins.filter(p => p.status === st).length, STATE_COLOR[st], false]).filter(r => r[1]);
  if (over) rows.push(['실측 허용 넘음', over, '#f08a3e', true]);
  legend.hidden = !rows.length;
  legend.replaceChildren(...rows.map(([label, n, color, bar]) => el('div', {}, el('i', {class: bar ? 'bar' : '', style: {background: color}}), `${label} ${n}`)));
  const can = drafts.length && !sending && session.writeToken;
  sendButton.disabled = !can; fab.disabled = !can; fab.lastChild.textContent = drafts.length ? `보내기 ${drafts.length}` : '보내기';
}

// ── 현장 사진: 찍기 → 줄여서 이 기기에 → 보낼 때 잠가서 창고에 올리고 핀에는 자리·지문만 ──
async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file, {imageOrientation: 'from-image'});
  const k = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)), w = Math.round(bitmap.width * k), h = Math.round(bitmap.height * k);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h); bitmap.close?.();
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('사진을 줄이지 못했습니다.')), 'image/jpeg', 0.8));
}
const hexSha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
class StoreOff extends Error {}
async function uploadPhoto(localId) {
  const blob = await store.photo(localId);
  if (!blob) throw Error('이 기기에 사진이 없습니다.');
  const text = await sealPadBytes(new Uint8Array(await blob.arrayBuffer()), session.key, session.id), bytes = fromBase64Url(text), sha256 = await hexSha(bytes);
  const post = (path, body) => fetch(API + session.id + path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({writeToken: session.writeToken, ...body})});
  const made = await post('/blobs', {bytes: bytes.length, sha256});
  if (made.status === 503 || made.status === 404 || made.status === 405) throw new StoreOff('서버의 사진 창고가 아직 준비되지 않았습니다.');
  if (!made.ok) throw Error(`사진 자리를 받지 못했습니다(${made.status}).`);
  const {blobId, uploadUrl} = await made.json();
  const put = await fetch(uploadUrl, {method: 'PUT', body: bytes});
  if (!put.ok) throw Error(`사진을 올리지 못했습니다(${put.status}).`);
  const ready = await post(`/blobs/${blobId}/ready`, {});
  if (!ready.ok) throw Error(`사진 확인에 실패했습니다(${ready.status}).`);
  await store.putPhoto(blobId, blob);
  return {id: blobId, sha256};
}
async function photoBlob(photo) {
  const local = await store.photo(photo.id);
  if (local) return local;
  const r = await fetch(`${API}${session.id}/blobs/${photo.id}`, {headers: {'x-pad-token': session.writeToken}, cache: 'no-store'});
  if (!r.ok) throw Error('사진을 받지 못했습니다.');
  const {downloadUrl} = await r.json(), data = await fetch(downloadUrl);
  if (!data.ok) throw Error('사진을 받지 못했습니다.');
  const jpeg = await openPadBytes(toBase64Url(new Uint8Array(await data.arrayBuffer())), session.key, session.id), blob = new Blob([jpeg], {type: 'image/jpeg'});
  await store.putPhoto(photo.id, blob);
  return blob;
}
// 보내기 전에 핀의 이 기기 사진(local)을 올린다. 서버 창고가 아직이면 사진은 이 기기에 두고 핀은 보낸다.
async function uploadPinPhotos(items) {
  let kept = 0;
  for (const pin of items.filter(d => d.type === 'pin' && d.photos?.some(ph => ph.local))) {
    const next = [];
    for (const ph of pin.photos) {
      if (!ph.local) { next.push(ph); continue; }
      try { next.push(await uploadPhoto(ph.id)); }
      catch (error) { if (!(error instanceof StoreOff)) throw error; next.push(ph); kept++; }
    }
    pin.photos = next; saveJson(draftKey(), drafts);
  }
  return kept;
}

// ── 보내기 ──
// 받는 CAD 가 모르는 작업(핀·실측)은 예전 작업(메모·펜 표시)으로 바꾼다. 화면에 남기는 것은 원래 항목 그대로.
function opsFor(item) {
  if (item.type === 'mark') return [{type: 'mark', id: item.id, points: item.points, ...(item.kind === 'hl' ? {note: '형광펜'} : {})}];
  if (item.type === 'memo') return [{type: 'memo', id: item.id, at: item.at, text: item.text, ...(item.height ? {height: item.height} : {})}];
  if (item.type === 'measure') {
    const drawn = Math.hypot(item.b.x - item.a.x, item.b.y - item.a.y);
    if (caps.has('measure')) return [{type: 'measure', id: item.id, a: item.a, b: item.b, drawn: Math.round(drawn * 10) / 10, ...(item.actual != null ? {actual: item.actual, tolerance: item.tolerance} : {})}];
    const text = item.actual == null ? `치수 ${fmt(drawn)}` : `실측 ${fmt(item.actual)} · 도면 ${fmt(drawn)} · ${signed(item.actual - drawn)}`;
    const mid = {x: Math.round((item.a.x + item.b.x) / 2), y: Math.round((item.a.y + item.b.y) / 2)};
    return [{type: 'mark', id: item.id, points: [item.a, item.b], note: text}, {type: 'memo', id: item.id + '-t', at: mid, text}];
  }
  if (item.type === 'pin') {
    const photos = (item.photos || []).filter(ph => !ph.local).map(({id, sha256}) => ({id, sha256}));
    if (caps.has('pin')) return [{type: 'pin', id: item.id, at: item.at, no: item.no, title: item.title, kind: item.kind, status: item.status, prio: item.prio, assignee: item.assignee, due: item.due, note: item.note, ...(photos.length ? {photos} : {})}];
    const head = `[${item.kind}·${item.status}·${item.prio}] ${item.no}. ${item.title}`;
    const tail = [item.note, item.assignee && `담당 ${item.assignee}`, item.due && `기한 ${item.due}`].filter(Boolean).join(' / ');
    return [{type: 'memo', id: item.id + (item.changed ? '-' + randomToken(4) : ''), at: {x: Math.round(item.at.x), y: Math.round(item.at.y)}, text: (tail ? `${head} — ${tail}` : head).slice(0, 480)}];
  }
  return [];
}
function openSendDialog() {
  if (!drafts.length || sending) return;
  if (!session.writeToken) { say('보기 전용 링크입니다. 표시를 보내려면 사무실에서 받은 링크 전체로 여세요.', true); return; }
  const groups = [['pin', '핀'], ['measure', '실측'], ['mark', '펜 표시'], ['memo', '글']].map(([type, label]) => ({type, label, items: drafts.filter(d => d.type === type)})).filter(g => g.items.length);
  const checks = new Map(groups.map(g => [g.type, true]));
  const steps = el('ol', {class: 'steps', ariaLabel: '보내는 과정'}, ...['패드에서 잠금|끝까지 암호화', '서버에 올림|', '사무실 받음|기다리는 중'].map(s => { const [a, b] = s.split('|'); return el('li', {}, el('i'), a, el('small', {textContent: b})); }));
  const over = drafts.filter(d => d.type === 'measure' && measureLabel(d).over).length;
  const go = el('button', {type: 'button', class: 'btn primary', textContent: `${drafts.length}개 보내기`});
  const scrim = el('div', {class: 'scrim', onClick: e => { if (e.target === scrim && !sending) scrim.remove(); }},
    el('section', {class: 'dialog air', role: 'dialog', ariaModal: 'true', ariaLabelledby: 'pad-send-title'},
      el('div', {}, el('h2', {id: 'pad-send-title', textContent: '사무실로 보내기'}), el('p', {textContent: `${snapshot.name} · 지난번 보낸 뒤 새로 생긴 것만`})),
      el('div', {class: 'checks well'}, ...groups.map(g => { const box = el('input', {type: 'checkbox', checked: true, onChange: e => { checks.set(g.type, e.target.checked); const n = drafts.filter(d => checks.get(d.type)).length; go.textContent = `${n}개 보내기`; go.disabled = !n; }}); return el('label', {}, box, el('span', {class: 'grow', textContent: g.label}), el('span', {textContent: `${g.items.length}개${g.type === 'measure' && over ? ` · 허용 넘음 ${over}` : ''}`})); })),
      caps.has('pin') ? null : el('p', {textContent: '사무실 바른 CAD 가 예전 판이면 핀·실측은 메모와 펜 표시로 들어갑니다.'}),
      steps,
      el('div', {class: 'actions'}, el('button', {type: 'button', class: 'btn well', textContent: '나중에', onClick: () => { if (!sending) scrim.remove(); }}), go),
      lastSentSeq ? el('p', {textContent: received >= lastSentSeq ? `지난번: 사무실 받음 ${receivedAt}` : '지난번 보낸 것: 사무실 확인 기다리는 중'}) : null));
  go.onclick = async () => {
    const chosen = drafts.filter(d => checks.get(d.type));
    const mark = i => steps.children[i].classList.add('done');
    const ok = await send(chosen, mark);
    if (ok) { mark(2); setTimeout(() => scrim.remove(), 900); }
  };
  root.append(scrim);
}
async function send(items, mark = () => {}) {
  if (!items.length || sending) return false;
  sending = true; refreshInfo();
  try {
    const kept = caps.has('photo') ? await uploadPinPhotos(items) : 0;
    if (kept) say(`사진 ${kept}장은 서버 창고가 준비되기 전이라 이 기기에만 남겼습니다.`);
    let queue = items.slice();
    while (queue.length) {
      // 서버는 묶음 하나를 64KB 까지 받는다 — 넘으면 반씩 나눠 보낸다
      let count = Math.min(MAX_OPS, queue.length), chunk, ciphertext;
      for (;;) {
        chunk = queue.slice(0, count);
        const ops = chunk.flatMap(opsFor).slice(0, MAX_OPS);
        const batch = normalizePadBatchLoose({v: PAD_PROTOCOL_VERSION, seq: localSeq + 1, baseRevision: session.revision, ops});
        ciphertext = await sealPadJson(batch, session.key, session.id);
        if (ciphertext.length <= 60000 || count === 1) break;
        count = Math.ceil(count / 2);
      }
      if (ciphertext.length > 60000) throw Error('표시 하나가 너무 깁니다. 되돌리기로 지우고 짧게 나눠 그리세요.');
      mark(0); localSeq++;
      const response = await fetch(API + session.id + '/ops', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({writeToken: session.writeToken, ciphertext})});
      if (!response.ok) throw Error(response.status === 404 ? '링크가 끝났거나 회수되었습니다.' : response.status === 429 ? '이 링크로 보낼 수 있는 횟수를 다 썼습니다. 사무실에 새 링크를 부탁하세요.' : '보내지 못했습니다(' + response.status + '). 잠시 뒤 다시 누르세요.');
      mark(1);
      const {seq} = await response.json(); lastSentSeq = Math.max(lastSentSeq, seq || 0);
      for (const item of chunk) { item.changed = false; sent.push(item); }
      drafts = drafts.filter(d => !chunk.includes(d)); queue = queue.slice(chunk.length); saveDrafts();
    }
    say(`보냈습니다(${timeText(Date.now())}). 사무실 바른 CAD 가 받으면 "사무실 받음"이 뜹니다.`);
    return true;
  } catch (error) { say(error.message, true); return false; }
  finally { sending = false; refreshInfo(); }
}
// 새 작업 종류(pin·measure)는 받는 CAD 가 안다고 밝혔을 때만 보낸다(opsFor). 예전 종류는 여기서 그대로 검사한다.
function normalizePadBatchLoose(batch) {
  const known = batch.ops.filter(op => op.type === 'mark' || op.type === 'memo');
  if (known.length === batch.ops.length) return normalizePadBatch(batch);
  normalizePadBatch({...batch, ops: known.length ? known : [{type: 'memo', id: 'pad-check', at: {x: 0, y: 0}, text: '.'}]});
  return batch;
}

// 사무실 받음 확인 + 다시 열었을 때 보낸 것 다시 그리기
// 사무실 답: 핀 상태와 답 글을 이 기기 기록에 넣는다(보낸 핀을 그 자리에서 고친다).
function applyReply(items) {
  let n = 0;
  for (const raw of items || []) {
    let item; try { item = normalizeReplyItem(raw); } catch { continue; }
    const pin = [...sent, ...drafts].find(d => d.type === 'pin' && d.id === item.id);
    if (!pin || (pin.repliedAt && pin.repliedAt >= item.at)) continue;
    Object.assign(pin, item.status ? {status: item.status} : {}, item.text ? {reply: item.text} : {}, {repliedAt: item.at});
    n++;
  }
  if (n) saveDrafts();
  return n;
}
async function pull() {
  if (!session?.writeToken || !navigator.onLine) return;
  let replies = 0;
  try {
    for (;;) {
      const page = await fetch(`${API}${session.id}/ops?after=${cursor}`, {headers: {'x-pad-token': session.writeToken}, cache: 'no-store'}); if (!page.ok) return;
      const {ops} = await page.json(); if (!ops?.length) break;
      for (const item of ops) {
        cursor = item.seq;
        try {
          const value = await openPadJson(item.ciphertext, session.key, session.id);
          if (isPadAck(value)) { if (value.ack.received >= received) { received = value.ack.received; receivedAt = timeText(value.ack.at); } continue; }
          if (isPadReply(value)) { replies += applyReply(value.reply.items); continue; }
          localSeq = Math.max(localSeq, Number(value.seq) || 0); lastSentSeq = Math.max(lastSentSeq, item.seq);
          for (const op of value.ops || []) if (!sent.some(s => s.id === op.id || op.id.startsWith(s.id + '-'))) sent.push(displayItem(op));
        } catch {}
      }
      if (ops.length < 100) break;
    }
  } catch {}
  if (replies) say(`사무실 답 ${replies}건이 왔습니다. [기록]에서 보세요.`);
  refreshInfo(); paintMarks();
}
function displayItem(op) {
  if (op.type === 'pin') return {...op, type: 'pin'};
  if (op.type === 'measure') return {type: 'measure', id: op.id, a: op.a, b: op.b, actual: op.actual ?? null, tolerance: op.tolerance ?? tolerance};
  if (op.type === 'mark') return {type: 'mark', id: op.id, points: op.points, kind: op.note === '형광펜' ? 'hl' : 'pen'};
  return {type: 'memo', id: op.id, at: op.at, text: op.text, height: op.height};
}

// ── 이 기기 보관: 잠긴 상자와 열쇠를 링크 기간 동안 IndexedDB 에 둔다(인터넷 없는 현장에서 다시 열기) ──
const store = {
  db: null,
  async open() {
    if (this.db || !('indexedDB' in window)) return this.db;
    this.db = await new Promise(resolve => {
      const req = indexedDB.open('barun-pad', 2);
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', {keyPath: 'id'}); if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos'); };
      req.onsuccess = () => resolve(req.result); req.onerror = () => resolve(null);
    });
    return this.db;
  },
  async run(mode, fn, name = 'sessions') { const db = await this.open(); if (!db) return null; return new Promise(resolve => { const tx = db.transaction(name, mode), req = fn(tx.objectStore(name)); tx.oncomplete = () => resolve(req?.result ?? null); tx.onerror = () => resolve(null); }); },
  // 사진: 이 기기에 찍은 원본(줄인 JPEG)을 둔다 — 올린 뒤에도 다시 받지 않고 보여 준다.
  photo(id) { return this.run('readonly', s => s.get(id), 'photos'); },
  putPhoto(id, blob) { return this.run('readwrite', s => s.put(blob, id), 'photos'); },
  get(id) { return this.run('readonly', s => s.get(id)); },
  put(value) { return this.run('readwrite', s => s.put(value)); },
  async sweep() { const all = await this.run('readonly', s => s.getAll()) || []; for (const v of all) if (Date.parse(v.expiresAt) <= Date.now()) await this.run('readwrite', s => s.delete(v.id)); },
};

// ── 열기 ──
async function open() {
  await store.sweep().catch(() => {});
  const where = parsePadLocation(window.location.pathname, window.location.hash);
  if (!where.id) { say('링크가 완전하지 않습니다. 사무실에서 받은 링크 전체를 여세요.', true); return; }
  const saved = await store.get(where.id).catch(() => null);
  const key = where.key || saved?.key, writeToken = where.writeToken || saved?.writeToken || '';
  if (!key) { say('링크가 완전하지 않습니다. 사무실에서 받은 링크 전체를 여세요.', true); return; }
  // 열쇠가 주소창·방문 기록에 남지 않게 # 뒤를 지운다(열쇠는 이 기기 보관소에만 남는다).
  history.replaceState(null, '', window.location.pathname);
  let ciphertext = null, expiresAt = saved?.expiresAt, offline = false;
  try {
    const response = await fetch(API + where.id, {cache: 'no-store'});
    if (response.status === 404) { say('링크가 끝났거나 회수되었습니다.', true); return; }
    if (!response.ok) throw Error(String(response.status));
    const got = await response.json();
    expiresAt = got.expiresAt;
    if (got.ciphertext) ciphertext = got.ciphertext;
    else if (got.downloadUrl) {
      // 큰 도면: 파일 창고에서 잠근 바이트를 바로 받는다(서버를 거치지 않는다). 지문으로 온전한지 본다.
      titleName.textContent = `도면 ${(got.bytes / 1048576).toFixed(1)}MB 를 받는 중…`;
      const data = await fetch(got.downloadUrl);
      if (!data.ok) throw Error(String(data.status));
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (got.sha256 && (await hexSha(bytes)) !== got.sha256) { say('받은 도면이 깨졌습니다. 다시 열어 주세요.', true); return; }
      ciphertext = toBase64Url(bytes);
    } else throw Error('도면 응답 형식이 올바르지 않습니다.');
  } catch {
    if (!saved?.ciphertext) { say('도면을 받지 못했습니다. 인터넷 연결을 확인하세요.', true); return; }
    ciphertext = saved.ciphertext; offline = true;
  }
  titleName.textContent = '도면을 푸는 중…';
  // 새 CAD 는 구운 묶음(BPS1)을, 예전 CAD 는 JSON 스냅샷을 보낸다.
  const opened = await openPadBytes(ciphertext, key, where.id), boxed = decodePadSession(opened);
  snapshot = boxed ? boxed.meta : JSON.parse(new TextDecoder().decode(opened));
  await store.put({id: where.id, key, writeToken, ciphertext, expiresAt, name: snapshot.name, savedAt: new Date().toISOString()}).catch(() => {});
  session = {id: where.id, key, writeToken, revision: snapshot.revision, expiresAt, receivedText: `${timeText(snapshot.createdAt || Date.now())} 받음`};
  caps = new Set(Array.isArray(snapshot.capabilities) ? snapshot.capabilities : []);
  titleName.textContent = '도면을 준비하는 중…';
  await new Promise(r => setTimeout(r, 0));
  pack = boxed ? decodePadPack(boxed.pack) : decodePadPack(encodePadPack(packDrawing({units: snapshot.units, layers: (snapshot.layers || []).map(l => ({visible: true, ...l})), entities: snapshot.entities || [], sharedBlocks: snapshot.sharedBlocks}, {name: snapshot.name, revision: snapshot.revision})));
  origin = pack.sets[0].origin;
  renderer = createPadRenderer(glCanvas, pack, {overlay: textCanvas, theme: 'cad'});
  drafts = loadJson(draftKey(), []).filter(d => d && ['mark', 'memo', 'pin', 'measure'].includes(d.type));
  sent = loadJson(sentKey(), []).filter(d => d && d.type);
  titleName.textContent = snapshot.name; document.title = `${snapshot.name} · 바른 CAD 패드`;
  renderer.fit();
  setTheme(loadJson('barun-pad-theme', 'cad') === 'paper' ? 'paper' : 'cad');
  setTool('view');
  for (const node of [tools, sendButton, fab, countText]) node.hidden = !session.writeToken;
  say(offline ? '인터넷 없이 이 기기에 보관한 도면을 열었습니다. 연결되면 보낼 수 있습니다.' : session.writeToken ? `${snapshot.name} · 치수·핀·펜으로 남기고 [사무실로 보내기]` : `${snapshot.name} · 보기 전용`);
  refreshInfo(); fullRender();
  if (!offline) await pull(); // 안내 뒤에 받는다 — 사무실 답 알림이 안내에 덮이지 않게
  // 온스냅 색인을 한가할 때 미리 만든다(큰 도면은 처음 꾹 누를 때 잠깐 멈추지 않게).
  setTimeout(() => { if (!snapper && renderer) { snapper = createPadSnapper(pack, renderer.placed); snapper.snap({x: 0, y: 0}, {scale: view().scale, modes: snapModes}); } }, 1500);
  let ticks = 0;
  setInterval(() => { refreshInfo(); ticks++; const waiting = lastSentSeq && received < lastSentSeq, hasPins = sent.some(d => d.type === 'pin'); if (document.visibilityState === 'visible' && (waiting || (hasPins && ticks % 3 === 0))) pull(); }, 10000);
}
// 창 resize 만 들으면 아이폰 주소창이 접히고 펴질 때 그림 칸 크기가 바뀐 걸 놓쳐 도면이 위아래로 늘어나 보인다(11/2) — 칸 크기를 직접 지켜본다.
new ResizeObserver(() => { if (renderer) { renderer.resize(); fullRender(); } }).observe(glCanvas);
window.addEventListener('online', () => pull());
open().catch(error => { titleName.textContent = '열지 못함'; say(error.message || '도면을 열지 못했습니다.', true); });

// 다른 모듈이 안 쓰는 값 경고 막기
void INHERIT;
