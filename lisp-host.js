import {standardLayerForName} from './layer-standards.js';
// 자체 리습 엔진과 바른 CAD 도면을 잇는 어댑터.
// AutoLISP 는 도면을 'DXF 그룹코드 연관 리스트'로 본다. 바른 CAD 는 {type,points,...} 객체로 본다.
// 이 파일이 그 둘을 왕복 변환하고, entmake/ssget/getvar 같은 호출을 실제 문서에 연결한다.
//
// 문서는 이 어댑터가 들고 있는 복사본이다. 리습이 끝나면 호출자가 결과를 비교해 반영한다.
// 그래서 실행 중에는 원본 도면이 절대 바뀌지 않는다.
//
// 엔진(lisp-native.js)은 여기로 늘 '보통 JS 값'만 넘긴다. 숫자는 number, 목록은 배열이다.

import * as G from './geometry.js'
import { Ename, SelSet, Dot, FileHandle, LispError, InputError, sym, T, cons, wcmatch, isCowViolation } from './lisp-native.js'

const randomId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : 'e' + Math.abs(Date.now() ^ (performance.now() * 1e6)).toString(36) + Math.abs(performance.now() * 1e3 | 0).toString(36))
// 리습이 건축 요소 명령을 부르면 멈췄다가 처음부터 다시 돈다(command-runner.js). 다시 돌아도 같은 객체가 같은 id 를 갖도록
// 실행마다 정한 씨앗(idSeed)으로 차례대로 id 를 만든다. 씨앗이 없으면 예전처럼 무작위.
let nextId = randomId
const uuid = () => nextId()
export const seededIds = (seed) => { const hex = String(seed).replace(/[^0-9a-f]/gi, '').toLowerCase().padEnd(20, '0').slice(0, 20); let n = 0
  return () => { const t = hex + (n++).toString(16).padStart(12, '0'); return `${t.slice(0, 8)}-${t.slice(8, 12)}-${t.slice(12, 16)}-${t.slice(16, 20)}-${t.slice(20)}` } }

/* ── DXF 연관 리스트 ↔ 바른 CAD 엔티티 ───────────────────── */

const pt3 = (p) => [p.x, p.y, 0]
const toPoint = (v) => {
  if (Array.isArray(v) && typeof v[0] === 'number') return { x: v[0], y: typeof v[1] === 'number' ? v[1] : 0 }
  throw new LispError('점 좌표가 필요합니다')
}
const dot = (code, value) => new Dot(code, value)

/** 연관 리스트에서 코드 하나를 찾는다. */
/** (cons 10 점) 은 점이 리스트라서 (10 x y z) 가 된다. 쌍이 아니면 뒤 전부가 값이다. */
const valueOf = (item) => item instanceof Dot ? item.cdr : (item.length === 2 ? item[1] : item.slice(1))
const codeOf = (item) => item instanceof Dot ? item.car : (Array.isArray(item) ? item[0] : null)

export function group(list, code) {
  if (!Array.isArray(list)) return null
  for (const item of list) if (codeOf(item) === code) return valueOf(item)
  return null
}
const hasGroup = (list, code) => Array.isArray(list) && list.some(item => codeOf(item) === code)
/** 같은 코드가 여러 번 나오는 경우(폴리선 정점 등) 전부 모은다. */
export function groupAll(list, code) {
  const out = []
  if (!Array.isArray(list)) return out
  for (const item of list) if (codeOf(item) === code) out.push(valueOf(item))
  return out
}

const DEG = 180 / Math.PI
// AutoLISP 은 각도를 늘 라디안으로 다룬다. 도면 안에서는 도(度)로 저장하므로 경계에서 바꾼다.
const toRad = (deg) => (Number(deg) || 0) * Math.PI / 180
const toDeg = (rad) => (Number(rad) || 0) * 180 / Math.PI

/* ── ACI 색 번호 ↔ 화면 색 ────────────────────────────────── */
// AutoCAD 표준 색 번호 1~255. ezdxf 의 표를 그대로 옮겼다. 7번만 어두운 화면에 맞춰 흰색 대신 밝은 회색을 쓴다.
const ACI_RGB = [0xff0000,0xffff00,0x00ff00,0x00ffff,0x0000ff,0xff00ff,0xffffff,0x808080,0xc0c0c0,0xff0000,0xff7f7f,0xa50000,0xa55252,0x7f0000,0x7f3f3f,0x4c0000,0x4c2626,0x260000,0x261313,0xff3f00,0xff9f7f,0xa52900,0xa56752,0x7f1f00,0x7f4f3f,0x4c1300,0x4c2f26,0x260900,0x261713,0xff7f00,0xffbf7f,0xa55200,0xa57c52,0x7f3f00,0x7f5f3f,0x4c2600,0x4c3926,0x261300,0x261c13,0xffbf00,0xffdf7f,0xa57c00,0xa59152,0x7f5f00,0x7f6f3f,0x4c3900,0x4c4226,0x261c00,0x262113,0xffff00,0xffff7f,0xa5a500,0xa5a552,0x7f7f00,0x7f7f3f,0x4c4c00,0x4c4c26,0x262600,0x262613,0xbfff00,0xdfff7f,0x7ca500,0x91a552,0x5f7f00,0x6f7f3f,0x394c00,0x424c26,0x1c2600,0x212613,0x7fff00,0xbfff7f,0x52a500,0x7ca552,0x3f7f00,0x5f7f3f,0x264c00,0x394c26,0x132600,0x1c2613,0x3fff00,0x9fff7f,0x29a500,0x67a552,0x1f7f00,0x4f7f3f,0x134c00,0x2f4c26,0x092600,0x172613,0x00ff00,0x7fff7f,0x00a500,0x52a552,0x007f00,0x3f7f3f,0x004c00,0x264c26,0x002600,0x132613,0x00ff3f,0x7fff9f,0x00a529,0x52a567,0x007f1f,0x3f7f4f,0x004c13,0x264c2f,0x002609,0x135817,0x00ff7f,0x7fffbf,0x00a552,0x52a57c,0x007f3f,0x3f7f5f,0x004c26,0x264c39,0x002613,0x13581c,0x00ffbf,0x7fffdf,0x00a57c,0x52a591,0x007f5f,0x3f7f6f,0x004c39,0x264c42,0x00261c,0x135858,0x00ffff,0x7fffff,0x00a5a5,0x52a5a5,0x007f7f,0x3f7f7f,0x004c4c,0x264c4c,0x002626,0x135858,0x00bfff,0x7fdfff,0x007ca5,0x5291a5,0x005f7f,0x3f6f7f,0x00394c,0x26427e,0x001c26,0x135858,0x007fff,0x7fbfff,0x0052a5,0x527ca5,0x003f7f,0x3f5f7f,0x00264c,0x26397e,0x001326,0x131c58,0x003fff,0x7f9fff,0x0029a5,0x5267a5,0x001f7f,0x3f4f7f,0x00134c,0x262f7e,0x000926,0x131758,0x0000ff,0x7f7fff,0x0000a5,0x5252a5,0x00007f,0x3f3f7f,0x00004c,0x26267e,0x000026,0x131358,0x3f00ff,0x9f7fff,0x2900a5,0x6752a5,0x1f007f,0x4f3f7f,0x13004c,0x2f267e,0x090026,0x171358,0x7f00ff,0xbf7fff,0x5200a5,0x7c52a5,0x3f007f,0x5f3f7f,0x26004c,0x39267e,0x130026,0x1c1358,0xbf00ff,0xdf7fff,0x7c00a5,0x9152a5,0x5f007f,0x6f3f7f,0x39004c,0x42264c,0x1c0026,0x581358,0xff00ff,0xff7fff,0xa500a5,0xa552a5,0x7f007f,0x7f3f7f,0x4c004c,0x4c264c,0x260026,0x581358,0xff00bf,0xff7fdf,0xa5007c,0xa55291,0x7f005f,0x7f3f6f,0x4c0039,0x4c2642,0x26001c,0x581358,0xff007f,0xff7fbf,0xa50052,0xa5527c,0x7f003f,0x7f3f5f,0x4c0026,0x4c2639,0x260013,0x58131c,0xff003f,0xff7f9f,0xa50029,0xa55267,0x7f001f,0x7f3f4f,0x4c0013,0x4c262f,0x260009,0x581317,0x000000,0x656565,0x666666,0x999999,0xcccccc,0xffffff]
const ACI = new Proxy({}, {
  get(_, key) {
    const n = Number(key)
    if (n === 7) return '#d8d8d8'
    if (!Number.isInteger(n) || n < 1 || n > 255) return undefined
    return '#' + ACI_RGB[n - 1].toString(16).padStart(6, '0')
  },
  has(_, key) { const n = Number(key); return Number.isInteger(n) && n >= 1 && n <= 255 },
})
/** ACI 번호(1~255) → 화면 색(#rrggbb). 범위 밖이면 undefined. 7번은 어두운 화면용 밝은 회색. */
export const aciColor = (n) => ACI[n]
/** 화면 색(#rrggbb) → ACI 번호. 딱 맞는 번호가 없으면 가장 가까운 번호. */
export function aciOf(color) {
  const hex = String(color || '').trim().toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(hex)) return null
  if (hex === '#d8d8d8' || hex === '#ffffff') return 7
  const rgb = parseInt(hex.slice(1), 16)
  const exact = ACI_RGB.indexOf(rgb)
  if (exact >= 0) return exact + 1
  const r = rgb >> 16, g = (rgb >> 8) & 255, b = rgb & 255
  let best = 7, gap = Infinity
  ACI_RGB.forEach((c, i) => {
    const d = (r - (c >> 16)) ** 2 + (g - ((c >> 8) & 255)) ** 2 + (b - (c & 255)) ** 2
    if (d < gap) { gap = d; best = i + 1 }
  })
  return best
}
/** 그룹 62 → 엔티티 color. 256(BYLAYER)·0(BYBLOCK) 은 '색 없음' 이다. */
const colorFrom62 = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 256 || n === 0) return null
  return ACI[Math.abs(Math.trunc(n))] || null
}

/** 사각형은 네 꼭짓점으로 저장한다. 두 점짜리(예전 형식)도 읽는다. */
const rectangleRing = (e) => (Array.isArray(e.points) && e.points.length >= 4)
  ? e.points.map(p => ({ x: p.x, y: p.y }))
  : G.rectangle(e.points[0], e.points[1])

/** 바른 CAD 엔티티 → DXF 연관 리스트 */
export function entityToDxf(e, layerName) {
  const base = [dot(-1, new Ename(e.id)), dot(5, e.id), dot(8, layerName || '0')]
  // 색을 따로 준 객체만 62 가 있다(AutoCAD: BYLAYER 면 62 가 없다).
  if (e.color) base.push(dot(62, e.aci ?? aciOf(e.color) ?? 7))
  switch (e.type) {
    case 'line':
      return [dot(0, 'LINE'), ...base, dot(100, 'AcDbEntity'), dot(100, 'AcDbLine'),
        dot(10, pt3(e.points[0])), dot(11, pt3(e.points[1]))]
    case 'circle':
      return [dot(0, 'CIRCLE'), ...base, dot(100, 'AcDbEntity'), dot(100, 'AcDbCircle'),
        dot(10, pt3(e.center)), dot(40, e.radius)]
    case 'arc':
      return [dot(0, 'ARC'), ...base, dot(100, 'AcDbEntity'), dot(100, 'AcDbCircle'),
        dot(10, pt3(e.center)), dot(40, e.radius),
        dot(100, 'AcDbArc'), dot(50, toRad(e.startAngle)), dot(51, toRad(e.endAngle))]
    case 'text':
      return [dot(0, 'TEXT'), ...base, dot(100, 'AcDbEntity'), dot(100, 'AcDbText'),
        dot(10, pt3(e.position)), dot(40, e.height || 0), dot(1, e.text || ''),
        dot(50, toRad(e.rotation)), dot(7, e.textStyle || 'Standard'),
        dot(41, e.widthFactor ?? 1), dot(51, toRad(e.oblique)),
        dot(72, { left: 0, center: 1, right: 2 }[e.align] ?? 0),
        dot(73, { bottom: 1, middle: 2, top: 3 }[e.vertical] ?? 0),
        dot(11, pt3(e.alignPoint || e.position))]
    case 'point':
      return [dot(0, 'POINT'), ...base, dot(100, 'AcDbEntity'), dot(100, 'AcDbPoint'),
        dot(10, pt3(e.position))]
    case 'rectangle':
    case 'polyline': {
      // 사각형은 네 꼭짓점 그대로 내보낸다. 예전에는 points[0]·points[1] 을 대각 모서리로 보고
      // (0 0)(4000 0)(4000 0)(0 0) 같은 찌그러진 폴리선을 내보내 PC(닫기)가 도형을 망가뜨렸다.
      const pts = e.type === 'rectangle' ? rectangleRing(e) : e.points
      return [dot(0, 'LWPOLYLINE'), ...base, dot(100, 'AcDbEntity'), dot(100, 'AcDbPolyline'),
        dot(90, pts.length), dot(70, (e.closed || e.type === 'rectangle') ? 1 : 0),
        ...pts.map(p => dot(10, [p.x, p.y]))]
    }
    case 'dimension': {
      // 리습이 치수를 읽으려면 그룹 70(종류) 10(치수선) 11(문자) 13·14(보조선)가 필요하다.
      const [a, b, third] = e.points || []
      const kind = { linear: 0, aligned: 1, angular: 2, diameter: 3, radius: 4, ordinateX: 6, ordinateY: 6 }[e.mode] ?? 1
      return [dot(0, 'DIMENSION'), ...base, dot(100, 'AcDbEntity'), dot(100, 'AcDbDimension'),
        dot(70, kind), dot(10, pt3(third || b || { x: 0, y: 0 })), dot(11, pt3(G.mul(G.add(a || { x: 0, y: 0 }, b || { x: 0, y: 0 }), .5))),
        dot(13, pt3(a || { x: 0, y: 0 })), dot(14, pt3(b || { x: 0, y: 0 })),
        dot(40, e.textHeight || 0), dot(1, e.textOverride || '')]
    }
    case 'block':
      // 블록은 INSERT 다. 이름이 없으면 리습이 수량을 셀 수 없다.
      return [dot(0, 'INSERT'), ...base, dot(100, 'AcDbEntity'), dot(100, 'AcDbBlockReference'),
        dot(2, e.name || ''), dot(10, pt3(e.position || e.origin || { x: 0, y: 0 })),
        dot(41, e.scale ?? 1), dot(42, e.scale ?? 1), dot(50, toRad(e.rotation))]
    case 'wall': {
      // 바른 CAD 고유 벽. 중심선(10·11)과 두께(40)를 읽을 수 있게 내보낸다. 리습으로 고치지는 않는다.
      const [a, b] = e.points || []
      return [dot(0, 'WALL'), ...base, dot(100, 'AcDbEntity'),
        dot(10, pt3(a || { x: 0, y: 0 })), dot(11, pt3(b || a || { x: 0, y: 0 })), dot(40, Number(e.thickness) || 0)]
    }
    default:
      // 아직 왕복이 안 되는 종류. 읽기는 되게 최소한만 내보낸다.
      return [dot(0, String(e.type || '').toUpperCase()), ...base]
  }
}

/** DXF 연관 리스트 → 바른 CAD 엔티티 (layerId 는 이름→id 해석기, fallbackLayer 는 8 이 없을 때 쓸 현재 레이어 이름) */
export function dxfToEntity(list, layerId, fallbackLayer = '0') {
  const kind = String(group(list, 0) || '').toUpperCase()
  if (kind === 'LAYER') {
    // 그룹 6 은 선종류다. 이걸 버리면 통심선·벽중심선이 실선으로 만들어진다.
    // 레이어 레코드에는 그룹 8 이 없다. 여기서 layerId 를 부르면 "0" 레이어가 덤으로 생긴다.
    const aci = Number(group(list, 62))
    return {
      __layer: true, name: String(group(list, 2) || '새 레이어'), color: Math.abs(aci) || 7, off: aci < 0,
      linetype: String(group(list, 6) || 'CONTINUOUS').toUpperCase(),
      locked: !!(Number(group(list, 70)) & 4), frozen: !!(Number(group(list, 70)) & 1),
      truecolor: hasGroup(list, 420) ? '#' + (Number(group(list, 420)) & 0xffffff).toString(16).padStart(6, '0') : null,
      lineweight: hasGroup(list, 370) && Number(group(list, 370)) >= 0 ? Number(group(list, 370)) / 100 : null,
      plot: !hasGroup(list, 290) || !!Number(group(list, 290)),
    }
  }
  // 그룹 8 이 없으면 AutoCAD 처럼 현재 레이어(CLAYER)에 만든다.
  const layer = layerId(String(group(list, 8) ?? fallbackLayer ?? '0'))
  const common = { id: uuid(), layer }
  if (hasGroup(list, 62)) {
    const color = colorFrom62(group(list, 62))
    if (color) { common.color = color; common.aci = Math.abs(Math.trunc(Number(group(list, 62)))) } else common.__bylayer = true
  }
  switch (kind) {
    case 'LINE':
      return { ...common, type: 'line', points: [toPoint(group(list, 10)), toPoint(group(list, 11))] }
    case 'CIRCLE':
      return { ...common, type: 'circle', center: toPoint(group(list, 10)), radius: Number(group(list, 40)) || 0 }
    case 'ARC':
      return {
        ...common, type: 'arc', center: toPoint(group(list, 10)), radius: Number(group(list, 40)) || 0,
        startAngle: toDeg(group(list, 50)), endAngle: toDeg(group(list, 51)),
      }
    case 'TEXT':
    case 'MTEXT': {
      const raw = String(group(list, 1) || '')
      return {
        ...common, type: 'text', position: toPoint(group(list, 10)),
        height: Number(group(list, 40)) || 0,
        // MTEXT 서식 코드는 자체 엔진이 해석하지 않는다. 줄바꿈만 살린다.
        text: kind === 'MTEXT' ? raw.replace(/\\P/g, '\n').replace(/\\[A-Za-z][^;]*;/g, '') : raw,
        rotation: toDeg(group(list, 50)),
        align: ['left', 'center', 'right'][Number(group(list, 72)) || 0],
        vertical: [undefined, 'bottom', 'middle', 'top'][Number(group(list, 73)) || 0],
        textStyle: group(list, 7) ? String(group(list, 7)) : undefined,
        widthFactor: group(list, 41) != null ? Number(group(list, 41)) : undefined,
      }
    }
    case 'POINT':
      return { ...common, type: 'point', position: toPoint(group(list, 10)) }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const pts = groupAll(list, 10).map(toPoint)
      if (pts.length < 2) throw new LispError('폴리선에는 점이 둘 이상 필요합니다')
      return { ...common, type: 'polyline', points: pts, closed: !!(Number(group(list, 70)) & 1) }
    }
    case 'DIMENSION': {
      const modes = ['linear', 'aligned', 'angular', 'diameter', 'radius', 'aligned', 'ordinateX']
      const a = group(list, 13), b = group(list, 14), line = group(list, 10)
      return {
        ...common, type: 'dimension', mode: modes[Number(group(list, 70)) & 7] || 'aligned',
        points: [toPoint(a), toPoint(b), toPoint(line)],
        textHeight: Number(group(list, 40)) || undefined,
        textOverride: group(list, 1) ? String(group(list, 1)) : undefined,
      }
    }
    case 'INSERT':
      return {
        ...common, type: 'block', name: String(group(list, 2) || ''),
        position: toPoint(group(list, 10)), scale: Number(group(list, 41)) || 1,
        rotation: toDeg(group(list, 50)),
      }
    default:
      throw new LispError(`${kind || '알 수 없는'} 객체는 이 엔진이 아직 만들지 못합니다.`)
  }
}

/* ── 좌표 글자 읽기 ────────────────────────────────────────
   X,Y · X,Y,Z · @dX,dY(마지막 점 기준) · 거리<각도 · @거리<각도 · 1e3,2 */
const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?'
const COORD = new RegExp(`^\\s*(@)?\\s*(?:(${NUM})\\s*(?:,\\s*(${NUM})(?:\\s*,\\s*(${NUM}))?|<\\s*(${NUM})))?\\s*$`)
/** 좌표 글자 → [x y z]. 좌표가 아니면 null. base 는 @ 가 가리키는 마지막 점. */
export function parseCoordinate(text, base = [0, 0, 0]) {
  const m = COORD.exec(String(text ?? ''))
  if (!m) return null
  const relative = !!m[1]
  if (m[2] === undefined) return relative ? [base[0] || 0, base[1] || 0, base[2] || 0] : null   // "@" 만 = 마지막 점
  let x, y, z = 0
  if (m[5] !== undefined) {                              // 거리<각도(도)
    const d = Number(m[2]), a = Number(m[5]) * Math.PI / 180
    x = d * Math.cos(a); y = d * Math.sin(a)
  } else {
    if (m[3] === undefined) return null                  // 숫자 하나는 좌표가 아니다
    x = Number(m[2]); y = Number(m[3]); z = m[4] !== undefined ? Number(m[4]) : 0
  }
  if (relative) { x += base[0] || 0; y += base[1] || 0; z += base[2] || 0 }
  return [x, y, z]
}

/* ── (command "…") 로 부를 수 있는 명령 ────────────────────
   여기 없는 이름을 쓰는 리습은 패널이 실행 전에 걸러 AutoCAD 쪽으로 넘긴다. */
export const SILENT_COMMANDS = ['LINETYPE', 'REGEN', 'REDRAW', 'ZOOM', 'UCS', 'CMDECHO', 'SETVAR',
  'UNDO', 'OSNAP', 'VIEW', 'LIMITS', 'SNAP', 'GRID', 'FILLMODE', 'ATTDIA', 'DIMSTYLE', 'GRAPHSCR', 'TEXTSCR']
export const DRAWING_COMMANDS = ['LINE', 'PLINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'POLYGON', 'RECTANG', 'RECTANGLE',
  'TEXT', 'DTEXT', 'POINT', 'OFFSET', 'ERASE', 'DELETE', 'MOVE', 'COPY', 'ROTATE', 'CHPROP', 'CHANGE', 'PEDIT',
  'TRIM', 'FILLET', 'EXPLODE', 'AREA', 'LAYER', 'LAYOFF', 'LAYON', 'LAYLCK', 'LAYLOCK', 'LAYULK', 'LAYUNLOCK',
  'DXFOUT', 'SAVEAS', 'STYLE', 'BOUNDARY', 'JUSTIFYTEXT', 'HATCHEDIT', 'SELECTSIMILAR']
export const SUPPORTED_COMMANDS = new Set([...SILENT_COMMANDS, ...DRAWING_COMMANDS])

const WALL_FACE_MESSAGE = '바른 CAD 벽 객체(두께가 있는 벽)의 면은 리습으로 지우거나 옮기거나 레이어·색을 바꿀 수 없어 그대로 두었습니다. 문·창 개구부(면 일부를 끊는 것)만 벽에 반영합니다. 그 밖의 편집은 벽을 EXPLODE 로 선으로 바꾼 뒤 실행하세요.'

/* ── 호스트 ───────────────────────────────────────────────── */

export function createHost(doc, options = {}) {
  nextId = options.idSeed ? seededIds(options.idSeed) : randomId
  const bridge = options.bridge || null   // {names:Set, done:[결과…], calls:0} — 바른 CAD 건축 요소 명령으로 넘기는 다리
  const inputs = (options.inputs || []).slice()   // 패널에서 미리 받아둔 입력 줄
  let cursor = 0
  const files = new Map(Object.entries(options.files || {}))
  const env = new Map()
  const notes = []                                 // 실행 뒤 사용자에게 알릴 것(잠긴 레이어 건너뜀 등)
  const note = (text) => { if (!notes.includes(text)) notes.push(text) }
  // 리습이 흔히 읽는 시스템 변수. 비어 있으면 (* 0.02 (getvar "DIMSCALE")) 같은 첫 줄에서 바로 죽는다.
  const vars = {
    CMDECHO: 0, OSMODE: 0, CLAYER: '0', TEXTSIZE: options.textHeight || 250, DWGPREFIX: '', CMDACTIVE: 0,
    DIMSCALE: 1, LTSCALE: 1, CELTSCALE: 1, USERI1: 0, USERR1: 0, FILLETRAD: 0, TEXTSTYLE: 'Standard',
    CLAYOUT: 'Model', TILEMODE: 1, ANGBASE: 0, ANGDIR: 0, AUNITS: 0, LUNITS: 2, LUPREC: 4, AUPREC: 0,
    DWGNAME: options.drawingName || '도면.dxf', PICKBOX: 3, SNAPMODE: 0, ORTHOMODE: 0, MEASUREMENT: 1,
    EXTMIN: [0, 0, 0], EXTMAX: [0, 0, 0], VIEWSIZE: 1000, VIEWCTR: [0, 0, 0], SCREENSIZE: [1920, 1080],
    LASTPOINT: [0, 0, 0], SECURELOAD: 1, FILEDIA: 0, PICKFIRST: 1,
    ...(options.vars || {}),
  }
  let rule = { bits: 0, keywords: [] }   // initget 로 걸어 둔 규칙. 다음 질문 한 번에만 쓴다.
  let lastEntity = null
  let lastSelection = []     // (ssget "_P") 가 쓰는 직전 선택
  let preselected = (options.preselected || []).slice()
  let pickfirstUsed = false  // 미리 고른 것은 첫 (ssget) 이 묻지 않고 가져간다(AutoCAD PICKFIRST)
  const cursors = new Map()  // tblnext 가 표마다 어디까지 읽었는지

  const entities = () => doc.entities
  let layerIndex = null, layerIndexOf = null, layerIndexLength = -1
  const layerById = (id) => {
    const list = doc.layers
    if (layerIndexOf !== list || layerIndexLength !== list.length) { layerIndex = new Map(list.map(l => [l.id, l])); layerIndexOf = list; layerIndexLength = list.length }
    const hit = layerIndex.get(id)
    if (hit && hit.id === id) return hit   // 레이어는 push 로만 늘고 객체째 고친다(길이·배열이 같으면 색인이 맞다)
    return list.find(l => l.id === id)
  }
  const nameOf = (layerIdValue) => (layerById(layerIdValue) || {}).name || '0'
  const locked = (e) => !!layerById(e?.layer)?.locked
  const layerId = (name) => {
    const found = doc.layers.find(l => l.name === name)
    if (found) return found.id
    const made = { id: uuid(), name, color: '#d8d8d8', visible: true, locked: false, lineweight: 0.25, linetype: 'CONTINUOUS',...(standardLayerForName(name)||{}) }
    doc.layers.push(made)
    return made.id
  }
  const ename = (e) => new Ename(e.id)

  /* ── 바른 CAD 벽의 두 면을 LINE 처럼 보여 준다 ─────────────
     DOOR·WIND·LEN 처럼 (ssget "_X" '((0 . "LINE"))) 로 벽선을 찾는 리습이 벽 객체도 찾게 한다.
     면을 줄이고(entmod) 나머지를 다시 만드는(entmake) DOOR·WIND 의 방식은 벽의 개구부로 바꿔 넣는다. */
  const faceCache = new Map()
  const facesOf = (wall) => {
    const key = wall.id + ':' + JSON.stringify([wall.points, wall.thickness])
    if (faceCache.has(key)) return faceCache.get(key)
    const [a, b] = wall.points || []
    let faces = []
    if (a && b && G.dist(a, b) > 1e-9 && Number(wall.thickness) > 0) {
      const u = G.unit(G.sub(b, a)), n = G.mul(G.normal(u), Number(wall.thickness) / 2)
      faces = [G.add, G.sub].map((shift, i) => ({
        id: wall.id + '#' + i, type: 'line', layer: wall.layer,
        points: [shift(a, n), shift(b, n)], __wall: wall.id, __face: i,
      }))
    }
    faceCache.set(key, faces)
    return faces
  }
  const wallFaces = () => entities().filter(e => e.type === 'wall').flatMap(facesOf)
  /* 19만 객체 도면에서 entget·entmod·entdel·entnext 가 부를 때마다 목록 전체를 훑으면
     (BLKCNT 가 블록 1만 5천 개를 읽는 데 2분 넘게 걸렸다) id → 자리 색인으로 바로 찾는다.
     doc.entities 는 push·splice·재할당으로 바뀌므로 찾은 자리의 id 를 늘 확인한다.
     어긋나면 색인을 다시 만들고, 색인에 없는 id 는 예전처럼 훑어서 찾는다(결과는 예전과 같다). */
  const dxfCache = new WeakMap()
  // entdel 로 지운 객체의 "다음 객체" id. AutoCAD 에서는 지운 객체로도 entnext 가 되므로 (지우며 도는 반복이 한 번에 멈추지 않게) 기억한다.
  const deletedNext = new Map()
  let idIndex = null, idIndexOf = null
  const rebuildIdIndex = (list) => { idIndex = new Map(); for (let i = 0; i < list.length; i++) idIndex.set(list[i].id, i); idIndexOf = list }
  const indexOfId = (id) => {
    const list = doc.entities
    if (!idIndex || idIndexOf !== list) rebuildIdIndex(list)
    let at = idIndex.get(id)
    if (at !== undefined && list[at]?.id === id) return at
    if (at !== undefined) {
      // entdel 의 splice 는 뒤 객체를 앞으로 당긴다. 색인을 매번 다시 만들면 지우기 반복이 k × n 이 된다(19만 도면에서 60초 초과).
      // 적힌 자리에서 앞쪽으로 조금만 훑어 찾고, 못 찾을 때만 다시 만든다.
      for (let i = Math.min(at, list.length - 1), stop = Math.max(0, at - 4096); i >= stop; i--) if (list[i]?.id === id) { idIndex.set(id, i); return i }
      rebuildIdIndex(list); at = idIndex.get(id); if (at !== undefined && list[at]?.id === id) return at
    }
    at = list.findIndex(e => e.id === id)
    if (at >= 0) idIndex.set(id, at)
    return at
  }
  /* 큰 도면 리습은 얼려 둔 원본 객체를 나눠 쓴다(lisp-panel.js runNative). 속성을 바꾸는 명령(CHPROP·JUSTIFYTEXT 등)은
     제자리에서 고치지 않고 같은 자리에 얕은 복사본을 넣어 그것을 고친다. 이번 실행에서 이미 복사한 것이면 그 복사본을 쓴다. */
  const writable = (e) => {
    if (!e || !Object.isFrozen(e)) return e
    const at = indexOfId(e.id)
    if (at < 0) return e
    const current = doc.entities[at]
    if (current !== e && !Object.isFrozen(current)) return current
    const copy = { ...current }
    doc.entities[at] = copy
    if (lastEntity === current) lastEntity = copy
    return copy
  }
  const byId = (id) => {
    const at = indexOfId(id), found = at >= 0 ? doc.entities[at] : undefined
    if (found || typeof id !== 'string' || !id.includes('#')) return found
    const [wallId, face] = id.split('#')
    const wall = doc.entities.find(e => e.id === wallId && e.type === 'wall')
    return wall ? facesOf(wall)[Number(face)] : undefined
  }
  const faceEdits = new Map()          // 벽 면 id → 남길 구간들 [[t0,t1]...]
  const faceParam = (face, p) => {
    const [a, b] = face.points, d = G.sub(b, a), len2 = G.dot(d, d)
    return len2 ? G.dot(G.sub(p, a), d) / len2 : 0
  }
  const onFace = (face, p, tolerance = 0.5) => {
    const t = faceParam(face, p)
    if (t < -1e-6 || t > 1 + 1e-6) return false
    const [a, b] = face.points
    return G.dist(G.add(a, G.mul(G.sub(b, a), t)), p) <= tolerance
  }
  /** 모든 수정 명령 앞에서 거른다: 잠긴 레이어 객체와 벽 면은 건너뛰고 알림에 남긴다(AutoCAD 처럼 명령 자체는 멈추지 않는다).
      벽 하나 때문에 '선 정리' 리습 전체가 실패하지 않게 한다. */
  const editable = (targets) => {
    const out = [], lockedOnes = [], faces = []
    for (const e of targets) {
      if (!e) continue
      if (e.__wall) faces.push(e)
      else if (locked(e)) lockedOnes.push(e)
      else out.push(e)
    }
    if (lockedOnes.length) note(`잠긴 레이어의 객체 ${lockedOnes.length}개는 바꾸지 않았습니다.`)
    if (faces.length) note(`바른 CAD 벽 객체의 면 ${faces.length}개는 건너뛰었습니다. 벽 편집은 벽을 EXPLODE 로 선으로 바꾼 뒤 실행하세요.`)
    return out
  }
  /** 리습이 끝날 때 벽 면에 낸 틈을 벽의 개구부(openings)로 넣는다. */
  const applyWallOpenings = () => {
    const byWall = new Map()
    for (const [faceId, kept] of faceEdits) {
      const [wallId] = faceId.split('#')
      const merged = kept.map(([s, e]) => [Math.max(0, Math.min(s, e)), Math.min(1, Math.max(s, e))]).sort((x, y) => x[0] - y[0])
      const removed = []
      let at = 0
      for (const [s, e] of merged) { if (s > at + 1e-9) removed.push([at, s]); at = Math.max(at, e) }
      if (at < 1 - 1e-9) removed.push([at, 1])
      if (!byWall.has(wallId)) byWall.set(wallId, [])
      byWall.get(wallId).push(...removed)
    }
    faceEdits.clear()
    for (const [wallId, gaps] of byWall) {
      const wall = doc.entities.find(e => e.id === wallId)
      if (!wall || !gaps.length) continue
      if (locked(wall)) { note('잠긴 레이어의 벽에는 개구부를 내지 않았습니다.'); continue }
      const all = [...(wall.openings || []), ...gaps].filter(([s, e]) => e - s > 1e-6).sort((x, y) => x[0] - y[0])
      const out = []
      for (const [s, e] of all) {
        const last = out[out.length - 1]
        if (last && s <= last[1] + 1e-9) last[1] = Math.max(last[1], e)
        else out.push([s, e])
      }
      writable(wall).openings = out
      note(`바른 CAD 벽에 개구부 ${gaps.length > 1 ? '(양쪽 면)' : ''}를 냈습니다.`)
    }
  }

  let loading = false        // 파일을 불러오는 동안에는 질문하지 않는다(명령의 답을 먹지 않게)
  const take = (what, prompt = '') => {
    if (loading) {
      const error = new LispError(`파일을 불러오는 동안에는 ${what}을(를) 물을 수 없습니다.`)
      error.ask = { what, prompt: String(prompt || ''), step: 0, duringLoad: true }
      throw error
    }
    if (cursor >= inputs.length) {
      // 화면 쪽이 이 정보로 "무엇을 어떻게 적을지" 한 가지씩 묻는다.
      const error = new LispError(`입력이 모자랍니다. ${what}을(를) 입력값 칸에 한 줄 더 적어 주세요.`)
      error.ask = { what, prompt: String(prompt || ''), step: inputs.length + 1 }
      throw error
    }
    return String(inputs[cursor++])
  }
  // (getpoint "\n시작점: ") 처럼 마지막 문자열 인자가 리습의 안내문이다.
  const promptOf = (args) => { const s = (args || []).filter(a => typeof a === 'string'); return s.length ? s[s.length - 1] : '' }
  const blank = (v) => { const t = String(v ?? '').trim(); return !t || t === '<Enter>' }
  const coordinate = (text) => parseCoordinate(text, vars.LASTPOINT)
  const asPoint = (text) => {
    const p = coordinate(text)
    if (!p) throw new InputError(`좌표는 X,Y 형식입니다(X,Y,Z · @dX,dY · 거리<각도 도 됩니다). 받은 값: ${text}`)
    // (getvar "LASTPOINT") 는 '마지막으로 찍은 점'이다. 면적 리습이 문자 넣을 자리로 쓴다.
    vars.LASTPOINT = p
    return [...p]
  }
  // 화면에서 사람이 찍는 자리(pause)와 grread 가 읽을 값.
  // 뒤에서 도는 엔진에는 화면이 없으므로 입력값 칸의 다음 줄을 그 자리에 넣는다.
  const answer = (what) => {
    const text = take(what)
    if (blank(text)) return ''
    if (coordinate(text)) return asPoint(text)
    const value = Number(text)
    return text.trim() !== '' && Number.isFinite(value) ? value : text
  }
  /** initget 규칙을 꺼낸다. AutoLISP 은 바로 다음 질문 한 번에만 쓰고 지운다. */
  const useRule = () => { const r = rule; rule = { bits: 0, keywords: [] }; return r }
  /** 걸어 둔 낱말 중 답과 맞는 것. 대문자 약어(Close → C)와 앞부분 일치를 받는다. */
  const keywordOf = (r, text) => {
    const answered = String(text ?? '').trim().replace(/^_/, '')
    if (!answered || !r.keywords.length || coordinate(answered)) return null   // 좌표는 낱말이 아니다
    const up = answered.toUpperCase()
    return r.keywords.find(k => k.toUpperCase() === up)
      || r.keywords.find(k => k.replace(/[^A-Z]/g, '') && k.replace(/[^A-Z]/g, '') === up)
      || r.keywords.find(k => k.toUpperCase().startsWith(up)) || null
  }
  const choices = (r) => r.keywords.length ? ` 또는 보기(${r.keywords.join('/')})` : ''
  /** 질문 하나: 낱말 → 빈 값 → 값 읽기 → initget 비트 검사. 규칙 위반은 '받은 값:' 으로 끝나 화면이 같은 질문을 다시 묻는다. */
  const ask = (what, args, parse) => {
    const r = useRule()
    const text = take(what, promptOf(args))
    const k = keywordOf(r, text)
    if (k) return k
    if (blank(text)) {
      if (r.bits & 1) throw new InputError(`값을 비워 둘 수 없습니다${choices(r)}. 받은 값: (빈 값)`)
      return null
    }
    let value
    try { value = parse(text.trim(), r) }
    catch (error) {
      if (r.bits & 128) return text                    // 아무 입력이나 받기
      if (r.keywords.length && error instanceof LispError && /받은 값:/.test(error.message))
        throw new InputError(error.message.replace(/\. 받은 값:/, `${choices(r)}. 받은 값:`))
      throw error
    }
    const n = typeof value === 'number' ? value : null
    if (n !== null && (r.bits & 2) && n === 0) throw new InputError(`0 은 입력할 수 없습니다${choices(r)}. 받은 값: ${text}`)
    if (n !== null && (r.bits & 4) && n < 0) throw new InputError(`음수는 입력할 수 없습니다${choices(r)}. 받은 값: ${text}`)
    return value
  }
  const realOf = (text) => {
    const v = Number(text)
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text) || !Number.isFinite(v)) throw new InputError(`숫자를 입력하세요. 받은 값: ${text}`)
    return v
  }
  // 실행 전에 파이썬(ezdxf·shapely)이 찾아 둔 닫힌 영역. (command "BOUNDARY" 내부점) 이 쓴다.
  // (command) 다리는 동기라 서버를 그 자리에서 부를 수 없다. 그래서 미리 받아 둔다.
  const regions = (options.regions || [])
    .map(r => ({
      ring: (r.ring || []).map(p => ({ x: Number(p[0] ?? p.x), y: Number(p[1] ?? p.y) })),
      holes: (r.holes || []).map(h => h.map(p => ({ x: Number(p[0] ?? p.x), y: Number(p[1] ?? p.y) }))),
      area: Number(r.area) || 0,
    }))
    .filter(r => r.ring.length >= 3)
  /** 그 점을 품는 가장 작은 영역. 구멍 안쪽이면 그 영역이 아니다. */
  const regionAt = (p) => regions
    .filter(r => G.inside(p, r.ring) && !r.holes.some(h => G.inside(p, h)))
    .sort((a, b) => a.area - b.area)[0] || null

  /* 커브 계산 — geometry.js 를 그대로 쓴다 */
  const curveOf = (v) => {
    const e = v instanceof Ename ? byId(v.id) : v
    if (!e) throw new LispError('객체를 찾을 수 없습니다')
    return e
  }
  const segmentsOf = (e) => e.type === 'rectangle' ? [...G.segments({ ...e, points: rectangleRing(e) })] : [...G.segments(e)]
  // 원·호는 선분이 없다. 호 길이를 직접 잰다. 예전에는 0 이라 LEN 이 틀린 총합을 냈다.
  const lengthOf = (e) => {
    if (e.type === 'circle') return 2 * Math.PI * e.radius
    if (e.type === 'arc') {
      const sweep = ((e.endAngle - e.startAngle) % 360 + 360) % 360 || 360
      return 2 * Math.PI * e.radius * sweep / 360
    }
    if (e.type === 'ellipse') return G.ellipsePoints(e).reduce((s, q, i, all) => i ? s + G.dist(all[i - 1], q) : 0, 0)
    return segmentsOf(e).reduce((s, [a, b]) => s + G.dist(a, b), 0)
  }
  const pointAtDistance = (e, d) => {
    let left = d
    for (const [a, b] of segmentsOf(e)) {
      const len = G.dist(a, b)
      if (left <= len || len === 0) return G.add(a, G.mul(G.unit(G.sub(b, a)), Math.max(0, left)))
      left -= len
    }
    const last = segmentsOf(e).at(-1)
    return last ? last[1] : { x: 0, y: 0 }
  }
  const closestOn = (e, q) => {
    let best = null, bd = Infinity
    for (const [a, b] of segmentsOf(e)) {
      const d = G.sub(b, a), dd = G.dot(d, d)
      const t = dd ? Math.max(0, Math.min(1, G.dot(G.sub(q, a), d) / dd)) : 0
      const c = G.add(a, G.mul(d, t)), gap = G.dist(c, q)
      if (gap < bd) { bd = gap; best = c }
    }
    return best || { x: 0, y: 0 }
  }

  /* ── 명령 다리 ────────────────────────────────────────────
     AutoCAD 는 명령마다 정해진 순서로 값을 받는다. 그 순서를 그대로 읽어 도면에 반영한다. */
  /* ── 건축 요소 명령 다리 ──
     k번째 호출에 기억한 결과가 있으면 도면에 끼워 넣고 계속한다. 없으면 멈춘다(BridgeSuspend) —
     바깥(lisp-panel runNativeBridged)이 그 자리 도면으로 명령을 돌려 결과를 기억하고 처음부터 다시 부른다. */
  const bridgeInputs = (args) => {
    const inputs = { points: [], paths: [], numbers: [], entities: [] }
    for (const v of args) {
      if (v === '' || v === null || v === undefined) continue
      if (isPoint(v)) { const p = xy(v); inputs.points.push({ x: p.x, y: p.y }); continue }
      if (typeof v === 'number' || typeof v === 'bigint') { inputs.numbers.push(Number(v)); continue }
      if (v instanceof Ename) { inputs.entities.push(String(v.id).split('#')[0]); continue }
      if (v instanceof SelSet) { inputs.selection = v.ids.map(id => String(id).split('#')[0]); continue }
      if (Array.isArray(v) && v.length && v.every(isPoint)) { inputs.paths.push(v.map(p => { const q = xy(p); return { x: q.x, y: q.y } })); continue }
      if (Array.isArray(v) && v.length && v.every(x => x instanceof Dot && typeof x.car === 'string')) { inputs.form = { ...(inputs.form || {}), ...Object.fromEntries(v.map(x => [x.car, typeof x.cdr === 'bigint' ? Number(x.cdr) : x.cdr])) }; continue }
      throw new LispError(`(command "${bridgeName}") 에 넘긴 값을 알 수 없습니다: ${typeof v === 'string' ? '"' + v + '"' : String(v)}. 점·숫자·객체·선택셋·점 목록·(("키" . 값)) 목록만 받습니다.`)
    }
    return inputs
  }
  let bridgeName = ''
  const bridgeCommand = (name, rest) => {
    finishPline(true)
    const k = bridge.calls++, done = bridge.done[k]
    bridgeName = name
    if (!done) {
      const e = new LispError(`(command "${name}") — 바른 CAD 건축 요소 명령으로 실행합니다.`)
      e.fatal = true; e.bridgeSuspend = { k, name, inputs: bridgeInputs(rest), clayer: String(vars.CLAYER || '0') }; e.document = doc
      throw e
    }
    if (done.name !== name) throw Object.assign(new LispError(`리습을 다시 돌리는 중 명령 순서가 달라졌습니다(${done.name} → ${name}). 다시 실행하세요.`), { fatal: true })
    const removed = new Set(done.removed), changed = new Map(done.changed.map(e => [e.id, e]))
    doc.entities = doc.entities.filter(e => !removed.has(e.id)).map(e => changed.get(e.id) || e).concat(done.added)
    doc.layers = done.layers
    if (done.added.length) lastEntity = doc.entities.at(-1)
    return null
  }
  const born = (entity) => { entity.id = uuid(); doc.entities.push(entity); lastEntity = entity; return entity }
  // (command "LINE" "0,0" "100,0" "") 처럼 좌표를 글자로 주는 리습이 흔하다. 글자 좌표도 점이다.
  const isPoint = (v) => (Array.isArray(v) && typeof v[0] === 'number') || (typeof v === 'string' && !!coordinate(v))
  const isEnd = (v) => v === '' || v === null || v === undefined || (Array.isArray(v) && !v.length)
  const word = (v) => (typeof v === 'string' ? v.replace(/^[_.]+/, '').toUpperCase() : null)
  const xy = (v) => {
    if (typeof v === 'string') { const p = asPoint(v); return { x: p[0], y: p[1] } }
    vars.LASTPOINT = [v[0], v[1] || 0, v[2] || 0]
    return { x: v[0], y: v[1] || 0 }
  }
  const numberOf = (v) => typeof v === 'number' ? v : (typeof v === 'string' && /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i.test(v) ? Number(v) : null)
  // 화면이 없으니 '집는 상자' 대신 도면 크기에 비례한 허용오차를 쓴다.
  // 1mm 로 고정하면 좌표를 눈대중으로 적은 순간 조용히 아무것도 안 잡힌다.
  let tolerance = null
  const pickTolerance = () => {
    if (tolerance !== null) return tolerance
    const b = G.bounds(entities())
    tolerance = b ? Math.max(1, Math.hypot(b.maxX - b.minX, b.maxY - b.minY) * 0.002) : 1
    return tolerance
  }
  const nearestIn = (pool, p) => {
    let best = null, gap = Infinity
    for (const e of pool) { const d = G.entityDistance(e, p); if (d < gap) { gap = d; best = e } }
    return best && gap <= pickTolerance() ? best : null
  }
  const nearest = (p, quiet = false) => {
    const best = nearestIn(entities(), p)
    if (!best) {
      if (quiet) return null
      throw new LispError(`좌표 ${Math.round(p.x)},${Math.round(p.y)} 근처에서 객체를 찾지 못했습니다.`)
    }
    return best
  }
  // (entsel) 은 (객체 찍은점) 쌍을 돌려준다. 그 쌍을 객체 자리에 그대로 넘기는 리습이 많다.
  const pair = (v) => Array.isArray(v) && v[0] instanceof Ename ? byId(v[0].id) : null
  const one = (v) => v instanceof Ename ? byId(v.id)
    : v instanceof SelSet ? byId(v.ids[0])
      : pair(v) || (isPoint(v) ? nearest(xy(v)) : null)
  /** 상자 안(창) 또는 상자에 걸친(걸침) 객체. */
  const inBox = (a, b, crossing, pool = entities()) => {
    const box = { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) }
    return pool.filter(e => {
      const r = G.bounds([e])
      if (!r) return false
      return crossing
        ? r.maxX >= box.minX && r.minX <= box.maxX && r.maxY >= box.minY && r.minY <= box.maxY
        : r.minX >= box.minX - 1e-6 && r.maxX <= box.maxX + 1e-6 && r.minY >= box.minY - 1e-6 && r.maxY <= box.maxY + 1e-6
    })
  }
  /** 선택 묶음을 빈 응답(Enter)까지 모은다.
      선택셋·객체이름·좌표·ALL·Last·Previous·창(W)·걸침(C)·빼기(R)를 받는다.
      모르는 옵션은 조용히 넘기지 않는다. 예전에는 그래서 (ERASE ALL R 객체) 가 전부를 지웠다. */
  const gather = (args, at, mine = []) => {
    const picked = new Map()
    let removing = false
    const put = (list) => { for (const e of list) removing ? picked.delete(e.id) : picked.set(e.id, e) }
    while (at < args.length && !isEnd(args[at])) {
      const v = args[at++]
      if (v instanceof Ename) { const e = byId(v.id); if (e) put([e]) }
      else if (v instanceof SelSet) put(v.ids.map(byId).filter(Boolean))
      else if (pair(v)) put([pair(v)])
      else if (isPoint(v)) { const e = nearest(xy(v)); if (e) put([e]) }
      else {
        const option = word(v)
        if (option === 'R') removing = true
        else if (option === 'A') removing = false
        else if (option === 'ALL') put(entities())
        else if (option === 'L') put(lastEntity ? [lastEntity] : [])
        else if (option === 'P') put(entities().filter(e => lastSelection.includes(e.id)))
        else if (option === 'W' || option === 'C') {
          const a = args[at], b = args[at + 1]
          if (!isPoint(a) || !isPoint(b)) throw new LispError(`선택 옵션 ${option} 에는 두 점이 필요합니다.`)
          at += 2
          put(inBox(xy(a), xy(b), option === 'C'))
        }
        else if (option === 'F') {
          const fence = []
          while (isPoint(args[at])) fence.push(xy(args[at++]))
          if (fence.length < 2) throw new LispError('울타리 선택에는 두 점 이상이 필요합니다.')
          const hit = new Set()
          for (let i = 0; i + 1 < fence.length; i++) {
            const seg = { type: 'line', points: [fence[i], fence[i + 1]] }
            for (const e of entities()) if (G.intersections(e, seg).length) hit.add(e)
          }
          put([...hit])
        }
        else if (mine.includes(option)) continue          // 명령 자신의 옵션이라 선택과 무관하다
        else if (option) throw new LispError(`선택 방식 "${option}" 은(는) 자체 엔진이 아직 모릅니다.`)
      }
    }
    lastSelection = [...picked.keys()]
    return [[...picked.values()], at + 1]
  }
  /** 인자에 들어 있는 객체만 모은다. 선택 옵션 글자가 섞여 있어도 걸리지 않는다. */
  const collect = (args) => {
    const out = []
    for (const v of args) {
      if (v instanceof SelSet) out.push(...v.ids.map(byId).filter(Boolean))
      else if (v instanceof Ename) { const e = byId(v.id); if (e) out.push(e) }
      else if (pair(v)) out.push(pair(v))
      else if (isPoint(v)) { const e = nearest(xy(v), true); if (e) out.push(e) }
    }
    return [...new Set(out)]
  }
  /** 점을 이어받아 목록으로 만든다. "C" 를 만나면 닫힌 도형이다. */
  const path = (args, at) => {
    const points = []; let closed = false
    while (at < args.length && !isEnd(args[at])) {
      const v = args[at++]
      if (isPoint(v)) points.push(xy(v))
      else if (word(v) === 'C') { closed = true; break }
    }
    return [points, closed]
  }
  const drop = (list) => { const kill = new Set(list.map(e => e.id)); doc.entities = doc.entities.filter(e => !kill.has(e.id)) }
  const swap = (old, made) => {
    const at = doc.entities.findIndex(e => e.id === old.id)
    const next = { ...made, id: old.id, layer: old.layer }
    if (at >= 0) doc.entities[at] = next; else doc.entities.push(next)
    lastEntity = next
    return next
  }
  const strip = (e) => e.type === 'line' ? [e.points[0], e.points[1]]
    : (e.type === 'polyline' && Array.isArray(e.points)) ? e.points.slice() : null
  /** PEDIT 접합: 끝점이 맞닿는 선·폴리선을 하나로 잇는다. */
  const joinPieces = (targets, fuzz) => {
    const pieces = targets.map(e => ({ e, pts: strip(e) })).filter(x => x.pts && x.pts.length >= 2)
    if (pieces.length < 2) return null
    const near = (a, b) => G.dist(a, b) <= Math.max(fuzz, 1e-6)
    const head = pieces.shift()
    let chain = head.pts, used = [head.e], merged = true
    while (merged && pieces.length) {
      merged = false
      for (let i = 0; i < pieces.length; i++) {
        const s = pieces[i].pts
        if (near(chain.at(-1), s[0])) chain = chain.concat(s.slice(1))
        else if (near(chain.at(-1), s.at(-1))) chain = chain.concat(s.slice(0, -1).reverse())
        else if (near(chain[0], s.at(-1))) chain = s.slice(0, -1).concat(chain)
        else if (near(chain[0], s[0])) chain = s.slice(1).reverse().concat(chain)
        else continue
        used.push(pieces[i].e); pieces.splice(i, 1); merged = true; break
      }
    }
    return used.length > 1 ? { chain, used } : null
  }

  /** 레이어 이름 패턴(* 포함)에 맞는 레이어들. */
  const layersLike = (pattern) => {
    const text = String(pattern ?? '*').trim()
    if (!text || text === '*') return doc.layers.slice()
    const rule = new RegExp('^' + text.split(',').map(s => s.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')).join('|') + '$', 'i')
    return doc.layers.filter(l => rule.test(l.name))
  }
  const others = (list) => list.filter(l => l.name !== vars.CLAYER)   // 현재 레이어는 끄지 않는다(AutoCAD 와 같음)
  const layersOf = (targets) => [...new Set(targets.map(e => e.layer))].map(id => doc.layers.find(l => l.id === id)).filter(Boolean)

  /* ── 문자 상자와 정렬 ──────────────────────────────────────
     화면 그리기(view.js)는 넣는 점 + 가로정렬 + 글자 밑선 기준이다. 여기서도 같은 규칙을 쓴다. */
  const textLines = (e) => String(e.text ?? '').split('\n')
  const textBox = (e) => {
    const lines = textLines(e), height = Number(e.height) || Number(vars.TEXTSIZE) || 1
    return {
      width: Math.max(...lines.map(s => s.length), 0) * height * 0.65 * (Number(e.widthFactor) || 1),
      top: height,
      bottom: -height * (lines.length - 1) * 1.35,
    }
  }
  const leftOffset = (align, width) => align === 'center' ? -width / 2 : align === 'right' ? -width : 0
  // AutoCAD 정렬 코드. 두 글자는 (세로,가로), 한 글자는 글자 밑선 기준이다.
  const JUSTIFY = {
    L: ['left', null], C: ['center', null], R: ['right', null], M: ['center', 'middle'],
    A: ['left', null], F: ['left', null],
    TL: ['left', 'top'], TC: ['center', 'top'], TR: ['right', 'top'],
    ML: ['left', 'middle'], MC: ['center', 'middle'], MR: ['right', 'middle'],
    BL: ['left', 'bottom'], BC: ['center', 'bottom'], BR: ['right', 'bottom'],
  }
  /** 글자는 그 자리에 두고 정렬 기준만 바꾼다(AutoCAD JUSTIFYTEXT 와 같다). */
  const justified = (e, code) => {
    const pair = JUSTIFY[String(code).toUpperCase()]
    if (!pair) throw new LispError(`정렬 코드 "${code}" 를 모릅니다. TL·TC·TR·ML·MC·MR·BL·BC·BR·L·C·R·M 중에서 쓰세요.`)
    const [align, vertical] = pair
    const box = textBox(e), left = leftOffset(e.align, box.width)
    const world = (p) => G.add(e.position, G.polar(G.len(p), G.angle(p) + (Number(e.rotation) || 0)))
    // 정렬점(그룹 11)은 새 기준 자리다. 넣는 점은 글자가 안 움직이도록 함께 옮긴다.
    const spot = {
      x: left + (align === 'center' ? box.width / 2 : align === 'right' ? box.width : 0),
      y: vertical === 'top' ? box.top : vertical === 'middle' ? (box.top + box.bottom) / 2 : vertical === 'bottom' ? box.bottom : 0,
    }
    return { align, vertical: vertical || undefined, alignPoint: world(spot), position: world({ x: left - leftOffset(align, box.width), y: 0 }) }
  }

  /* ── 폴리선의 호 구간 ──────────────────────────────────────
     AutoCAD 폴리선은 직선과 호를 한 객체에 섞는다. 바른 폴리선은 호를 담지 못하므로
     호를 잘게 편 점으로 잇는다. 한 덩어리로 남겨야 뒤따르는 (entlast)·COPY·PEDIT 가 그대로 동작한다. */
  // 2mm 보다 짧은 현은 도면에서 보이지 않는다. 작은 호(구름마크 물결 같은 것)를 헛되이 쪼개지 않게 막는다.
  const shortestChord = 2 / ({ mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[String(doc.units || 'mm').toLowerCase()] || 1)
  const arcRun = (arc, from) => {
    const sweep = ((arc.endAngle - arc.startAngle) % 360 + 360) % 360 || 360
    // 현과 호 사이 벌어짐이 반지름의 0.2% 를 넘지 않게 나눈다(약 7도). 다만 아주 짧은 호는 덜 쪼갠다.
    const fine = Math.ceil(sweep / (2 * Math.acos(0.998) * DEG))
    const coarse = Math.ceil(arc.radius * sweep / DEG / shortestChord)
    const steps = Math.min(64, Math.max(2, Math.min(fine, coarse)))
    const all = Array.from({ length: steps + 1 }, (_, i) => G.add(arc.center, G.polar(arc.radius, arc.startAngle + sweep * i / steps)))
    // arcThrough 는 반시계가 되도록 시작·끝을 바꿀 수 있다. 진행 방향에 맞춰 되돌린다.
    return (G.dist(all[0], from) <= G.dist(all.at(-1), from) ? all : all.reverse()).slice(1)
  }
  /** 직전 진행 방향에 접하면서 a 에서 b 로 가는 호. 일직선이면 null. */
  const tangentArc = (a, dir, b) => {
    const perpendicular = G.normal(dir), gap = G.sub(a, b)
    const denominator = 2 * G.dot(gap, perpendicular)
    if (Math.abs(denominator) < 1e-9) return null
    const center = G.add(a, G.mul(perpendicular, -G.dot(gap, gap) / denominator))
    const radius = G.dist(center, a)
    if (!(radius > 1e-9)) return null
    const start = G.angle(G.sub(a, center))
    const sweep = G.normalizeAngle(G.angle(G.sub(b, center)) - start) - (G.cross(G.sub(a, center), dir) > 0 ? 0 : 360)
    try { return G.arcThrough(a, G.add(center, G.polar(radius, start + sweep / 2)), b) } catch { return null }
  }

  /* 그리는 중인 폴리선.
     AutoCAD 의 PLINE 은 Enter 를 받기 전까지 살아 있어서, 리습이 (command 점) 이나 (command "C") 로
     점을 하나씩 이어 찍는다. 구름마크(REV)처럼 점 개수를 미리 모르는 리습이 그 방식을 쓴다. */
  let pending = null
  const finishPline = (quiet = false) => {
    if (!pending) return
    const shape = pending.entity
    pending = null
    if (shape.points.length >= 2) return
    drop([shape])
    if (lastEntity === shape) lastEntity = null
    if (!quiet) throw new LispError('PLINE 에는 점이 둘 이상 필요합니다.')
  }
  /** 그리는 중인 폴리선에 점·옵션을 이어 붙인다. 끝나는 응답을 만나면 마무리한다. */
  const plineStep = (args, at) => {
    const shape = pending.entity, points = shape.points
    const lineTo = (p) => { if (!points.length || G.dist(points.at(-1), p) > 1e-9) points.push(p) }
    const heading = () => {
      for (let i = points.length - 1; i > 0; i--) {
        const step = G.sub(points[i], points[i - 1])
        if (G.len(step) > 1e-9) return step
      }
      return null
    }
    const arcTo = (p) => {
      const from = points.at(-1)
      if (!from) throw new LispError('PLINE 호 구간은 시작점 뒤에 와야 합니다.')
      let arc = null
      if (pending.second) { try { arc = G.arcThrough(from, pending.second, p) } catch { arc = null } pending.second = null }
      else { const step = heading(); arc = step ? tangentArc(from, step, p) : null }
      if (arc) points.push(...arcRun(arc, from))   // 일직선이면 호가 아니라 직선이다
      else lineTo(p)
    }
    while (at < args.length) {
      const value = args[at++]
      if (isEnd(value)) { finishPline(); return }
      if (isPoint(value)) { const p = xy(value); pending.arcMode ? arcTo(p) : lineTo(p); continue }
      const option = word(value)
      if (option === 'A') { pending.arcMode = true; pending.second = null }
      else if (option === 'L') { pending.arcMode = false; pending.second = null }
      else if (option === 'S') {
        // 호의 두 번째 점 — 다음 점이 지나갈 자리, 그 다음이 끝점이다.
        if (!isPoint(args[at])) throw new LispError('PLINE 호의 두 번째 점이 필요합니다.')
        pending.second = xy(args[at++])
      }
      else if (option === 'C' || option === 'CL') { shape.closed = true; finishPline(); return }
      else if (option === 'W' || option === 'H') {
        // 선폭. 바른 폴리선은 폭을 담지 않는다. 시작폭·끝폭을 읽고 넘어간다(여기서 끝나면 안 된다).
        if (at < args.length) at++
        if (at < args.length && (isEnd(args[at]) || typeof args[at] === 'number' || /^-?[\d.]+$/.test(String(args[at])))) at++
      }
      else if (option === 'U') points.pop()        // 호 구간은 여러 점이라 되돌리기가 대략적이다
      else if (option) throw new LispError(`PLINE 옵션 "${option}" 은(는) 자체 엔진이 아직 모릅니다.`)
    }
  }

  function runCommand(raw, args) {
    // -LAYER 처럼 앞에 붙는 대시는 '명령창 방식' 이라는 뜻일 뿐, 다른 명령이 아니다.
    const name = raw.replace(/^-/, '')
    // pause("\\")는 '여기서 사람이 화면에서 찍는다'는 뜻이다.
    // 화면이 없으니 입력값 칸의 다음 줄을 그 자리에 넣는다(실시간 추적 대신 적어 둔 좌표를 쓴다).
    if (args.some(v => v === '\\'))
      args = args.map(v => v === '\\' ? answer(`(command "${name}") 이(가) 화면에서 찍기를 기다리는 값`) : v)
    if (!name) return null                                      // (command) · (command "") = 취소·Enter
    if (SILENT_COMMANDS.includes(name)) return null
    switch (name) {
      case 'LINE': {
        const [points, closed] = path(args, 0)
        if (points.length < 2) throw new LispError('LINE 에는 점이 둘 이상 필요합니다.')
        const ring = closed ? [...points, points[0]] : points
        for (let i = 0; i + 1 < ring.length; i++)
          born({ type: 'line', layer: layerId(vars.CLAYER), points: [ring[i], ring[i + 1]] })
        return null
      }
      case 'PLINE': {
        // 직선 구간(L)과 호 구간(A)을 오가는 상태 기계다.
        // A 다음 S 는 '지나갈 점 + 끝점'(세 점 호), S 가 없으면 직전 방향에 접하는 호다.
        // 객체는 지금 만든다. 그래야 바로 뒤의 (entlast) 가 이 폴리선을 집는다.
        finishPline(true)
        pending = { arcMode: false, second: null, entity: born({ type: 'polyline', layer: layerId(vars.CLAYER), points: [], closed: false }) }
        plineStep(args, 0)
        return null
      }
      case 'CIRCLE': {
        if (!isPoint(args[0])) throw new LispError('CIRCLE 은 중심 좌표부터 받습니다.')
        const center = xy(args[0]), second = args[1]
        // 반지름은 숫자·숫자 글자("5")·둘레 위 점 모두 받는다. (rtos …) 결과를 그대로 넘기는 리습이 많다.
        const radius = numberOf(second) ?? (isPoint(second) ? G.dist(center, xy(second)) : NaN)
        if (!(radius > 0)) throw new LispError('CIRCLE 반지름을 읽지 못했습니다.')
        born({ type: 'circle', layer: layerId(vars.CLAYER), center, radius })
        return null
      }
      case 'ARC': {
        const [points] = path(args, 0)
        if (points.length < 3) throw new LispError('ARC 는 시작·중간·끝 세 점 방식만 지원합니다.')
        born({ ...G.arcThrough(points[0], points[1], points[2]), layer: layerId(vars.CLAYER) })
        return null
      }
      case 'RECTANG': case 'RECTANGLE': {
        const [points] = path(args, 0)
        if (points.length < 2) throw new LispError('RECTANG 에는 두 모서리 좌표가 필요합니다.')
        const [a, b] = points
        if (Math.abs(a.x - b.x) < 1e-9 || Math.abs(a.y - b.y) < 1e-9) throw new LispError('RECTANG 의 두 모서리가 가로나 세로로 겹칩니다. 폭과 높이가 0보다 커야 합니다.')
        // 도면 엔진은 사각형을 네 꼭짓점으로 저장한다(engine.js 검사). 두 점으로 만들면 적용할 때 '객체 좌표 오류' 가 났다.
        born({ type: 'rectangle', layer: layerId(vars.CLAYER), points: G.rectangle(a, b) })
        return null
      }
      case 'TEXT': case 'DTEXT': {
        // AutoCAD 가 묻는 순서 그대로 읽는다: [J 정렬 | S 글꼴] → 넣을 점 → 글자높이 → 회전 → 글자.
        // 순서대로 읽어야 "12.34" 같은 숫자 모양 글자를 회전각으로 잘못 먹지 않는다.
        let at = 0, code = null
        while (at < args.length) {
          const option = word(args[at])
          if (option === 'J' && args[at + 1] != null) { code = word(args[at + 1]); at += 2 }
          else if (option === 'S' && args[at + 1] != null) at += 2
          else break
        }
        const position = isPoint(args[at]) ? xy(args[at++]) : null
        if (!position) throw new LispError('TEXT 는 넣을 좌표가 필요합니다.')
        const height = numberOf(args[at]); if (height !== null) at++
        const rotation = numberOf(args[at]); if (rotation !== null) at++
        const text = args.slice(at).find(v => typeof v === 'string' && !isEnd(v))
        const made = { type: 'text', layer: layerId(vars.CLAYER), position, height: height || vars.TEXTSIZE, rotation: rotation || 0, text: text || '' }
        if (code) {
          // 정렬을 주면 찍은 점이 그 기준 자리가 된다. 글자를 그 자리에 맞춰 옮긴다.
          const fixed = justified({ ...made, align: 'left', vertical: undefined }, code)
          Object.assign(made, fixed, { position: G.add(fixed.position, G.sub(position, fixed.alignPoint)), alignPoint: { ...position } })
        }
        born(made)
        return null
      }
      case 'POINT': {
        const [points] = path(args, 0)
        if (!points.length) throw new LispError('POINT 는 좌표가 필요합니다.')
        born({ type: 'point', layer: layerId(vars.CLAYER), position: points[0] })
        return null
      }
      case 'OFFSET': {
        // 거리 → (대상, 방향점) 쌍의 반복 → Enter. 방향점을 선택으로 오해하지 않도록 직접 읽는다.
        const distance = Math.abs(Number(args[0]))
        if (!(distance > 0)) throw new LispError('OFFSET 거리는 0보다 커야 합니다.')
        let at = 1, made = 0
        while (at < args.length && !isEnd(args[at])) {
          const chosen = (args[at] instanceof SelSet
            ? args[at].ids.map(byId).filter(Boolean)     // 선택셋이면 전부 간격띄운다
            : [one(args[at])].filter(Boolean)).map(e => e.__wall ? { type: 'line', layer: e.layer, points: e.points } : e)
          if (!chosen.length) { at++; continue }
          const side = args[at + 1]
          if (!isPoint(side)) throw new LispError('OFFSET 방향을 가리킬 좌표가 필요합니다.')
          for (const target of chosen)
            for (const shape of [G.offsetEntity(target.type === 'rectangle' ? { ...target, points: rectangleRing(target) } : target, distance, xy(side))].flat())
              born({ ...shape, layer: target.layer })
          made += chosen.length; at += 2
        }
        if (!made) throw new LispError('OFFSET 할 객체를 찾지 못했습니다.')
        return null
      }
      case 'ERASE': case 'DELETE': {
        const [picked] = gather(args, 0)
        if (!picked.length) throw new LispError('지울 객체를 찾지 못했습니다.')
        const targets = editable(picked)
        drop(targets); lastEntity = null
        return null
      }
      case 'MOVE': case 'COPY': {
        const [picked, after] = gather(args, 0)
        if (!picked.length) throw new LispError(name + ' 할 객체를 찾지 못했습니다.')
        const targets = name === 'MOVE' ? editable(picked) : picked.filter(e => !e.__wall)
        const rest = args.slice(after - 1)
        // (command "MOVE" ss "" "_D" 변위) — 변위 방식
        const d = rest.findIndex(v => word(v) === 'D' || word(v) === 'DISPLACEMENT')
        let base, destinations
        if (d >= 0) {
          const shift = rest.slice(d + 1).find(isPoint)
          if (!shift) throw new LispError(name + ' 변위(D) 에는 X,Y 변위가 필요합니다.')
          const s = xy(shift)
          base = [0, 0]; destinations = [[s.x, s.y]]
        } else {
          const points = rest.filter(isPoint).map(v => { const p = xy(v); return [p.x, p.y] })
          if (points.length < 2) throw new LispError(name + ' 에는 기준점과 도착점이 필요합니다.')
          base = points[0]
          // COPY 는 도착점을 여러 번 받을 수 있다. 예전에는 첫 하나만 쓰고 나머지를 버렸다.
          destinations = name === 'MOVE' ? points.slice(1, 2) : points.slice(1)
        }
        for (const to of destinations) {
          const dx = to[0] - base[0], dy = to[1] - base[1]
          for (const e of targets) {
            const moved = G.translate(e, dx, dy)
            if (name === 'MOVE') swap(e, moved); else born({ ...moved, layer: e.layer })
          }
        }
        return null
      }
      case 'ROTATE': {
        const [picked, after] = gather(args, 0)
        const rest = args.slice(after - 1)
        const base = rest.find(isPoint), degrees = Number(rest.map(numberOf).find(v => v !== null))
        if (!picked.length || !base || !Number.isFinite(degrees)) throw new LispError('ROTATE 에는 대상·기준점·각도가 필요합니다.')
        for (const e of editable(picked)) swap(e, G.rotate(e, xy(base), degrees))
        return null
      }
      case 'CHPROP': case 'CHANGE': {
        const [picked, after] = gather(args, 0)
        if (!picked.length) throw new LispError('속성을 바꿀 객체를 찾지 못했습니다.')
        const targets = editable(picked).map(writable)
        for (let i = after - 1; i < args.length; i++) {
          const option = word(args[i])
          if (!option || isEnd(args[i])) continue
          if (option === 'LA' && args[i + 1] != null) { const id = layerId(String(args[++i])); for (const e of targets) e.layer = id }
          else if (option === 'C' && args[i + 1] != null) {
            const value = args[++i]
            const color = word(value) === 'BYLAYER' ? null : ACI[Number(value)]
            for (const e of targets) if (color) { e.color = color; e.aci = Number(value) } else { delete e.color; delete e.aci }
          }
          else if (option === 'LT' && args[i + 1] != null) { const lt = String(args[++i]).toUpperCase(); for (const e of targets) e.linetype = lt === 'BYLAYER' ? undefined : lt }
          else if (option === 'LW' && args[i + 1] != null) { const w = Number(args[++i]); for (const e of targets) e.lineweight = w > 0 ? w / 100 : undefined }
          else if (option === 'T' || option === 'E') { i++ }      // 두께·높이는 2D 도면에 뜻이 없다
          else throw new LispError(`CHPROP 의 "${option}" 옵션은 자체 엔진이 아직 모릅니다.`)
        }
        lastEntity = targets.at(-1)
        return null
      }
      case 'PEDIT': {
        // 고르는 순서가 두 가지다. (PEDIT "_M" 선택 "" "_Y" "_J" 0.0 "") 는 여러 개를 한꺼번에,
        // (PEDIT "l" "j" 선택 "" "") 는 하나를 고른 뒤 붙일 것들을 고른다.
        // 둘 다 받으려고 순서를 따지지 않고 '인자에 나온 객체 전부'를 대상으로, 나머지 글자를 옵션으로 본다.
        const targets = [], options = [], numbers = []
        for (const v of args) {
          if (v instanceof SelSet) targets.push(...v.ids.map(byId).filter(Boolean))
          else if (v instanceof Ename) { const e = byId(v.id); if (e) targets.push(e) }
          else if (pair(v)) targets.push(pair(v))
          else if (isPoint(v)) { const e = nearest(xy(v), true); if (e) targets.push(e) }
          else if (typeof v === 'number') numbers.push(v)
          else if (typeof v === 'string' && !isEnd(v)) {
            const option = word(v)
            if (option === 'L' && lastEntity) targets.push(lastEntity)
            else if (option === 'P') targets.push(...entities().filter(e => lastSelection.includes(e.id)))
            else if (option === 'ALL') targets.push(...entities())
            else options.push(option)
          }
        }
        const found = [...new Set(targets)]
        if (!found.length) throw new LispError('PEDIT 할 선·폴리선을 찾지 못했습니다.')
        const picked = editable(found)
        if (options.includes('J')) {
          const fuzz = Number(options.find(v => Number.isFinite(Number(v)))) || numbers[0] || 0
          // 떨어져 있는 무리가 여럿이면 무리마다 하나씩 만든다. 예전에는 첫 무리만 붙이고 조용히 끝냈다.
          let left = picked.slice()
          for (;;) {
            const joined = joinPieces(left, fuzz)
            if (!joined) break
            drop(joined.used)
            born({ type: 'polyline', layer: joined.used[0].layer, points: joined.chain, closed: false })
            left = left.filter(e => !joined.used.includes(e))
          }
          // 붙일 게 없는 것은 잘못이 아니다(한 개만 골랐거나 이미 폴리선이거나).
          return null
        }
        if (options.includes('C'))
          for (const e of picked) if (e.type === 'polyline') writable(e).closed = true
        lastEntity = picked.at(-1)
        return null
      }
      case 'ELLIPSE': {
        // (command "ELLIPSE" "C" 중심 장축끝 단축길이)
        const rest = args.filter(v => !isEnd(v))
        const centerFirst = word(rest[0]) === 'C'
        const points = rest.filter(isPoint).map(xy)
        const numbers = rest.map(v => (isPoint(v) ? null : numberOf(v))).filter(v => v !== null)
        if (!centerFirst || !points.length) throw new LispError('ELLIPSE 는 중심(C) 방식만 지원합니다.')
        const center = points[0]
        const major = points[1] ? G.sub(points[1], center) : { x: numbers[0] || 0, y: 0 }
        const minor = points[2] ? G.dist(points[2], center) : (numbers.at(-1) || 0)
        const half = G.dist(major, { x: 0, y: 0 })
        if (!(half > 0) || !(minor > 0)) throw new LispError('ELLIPSE 의 장축·단축 길이를 읽지 못했습니다.')
        born({ type: 'ellipse', layer: layerId(vars.CLAYER), center, majorAxis: major, ratio: minor / half, startParam: 0, endParam: Math.PI * 2 })
        return null
      }
      case 'POLYGON': {
        // (command "POLYGON" 변수 중심 "I"|"C" 한점)
        const rest = args.filter(v => !isEnd(v))
        const sides = Number(rest.find(v => typeof v === 'number' || /^\d+$/.test(String(v))))
        const points = rest.filter(isPoint).map(xy)
        if (!(sides >= 3) || points.length < 2) throw new LispError('POLYGON 에는 변 수·중심·한 점이 필요합니다.')
        const [center, edge] = points
        const inscribed = !rest.some(v => word(v) === 'C')
        const radius = G.dist(center, edge) / (inscribed ? 1 : Math.cos(Math.PI / sides))
        const start = Math.atan2(edge.y - center.y, edge.x - center.x)
        const ring = Array.from({ length: sides }, (_, i) => {
          const a = start + (i * 2 * Math.PI) / sides
          return { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) }
        })
        born({ type: 'polyline', layer: layerId(vars.CLAYER), points: ring, closed: true })
        return null
      }
      case 'FILLET': {
        // 반지름은 FILLETRAD 시스템 변수를 따른다. (command "FILLET" "R" 값) 으로 먼저 바꾸기도 한다.
        const rest = args.filter(v => !isEnd(v))
        const at = rest.findIndex(v => word(v) === 'R')
        if (at >= 0) { vars.FILLETRAD = Number(rest[at + 1]) || 0; if (rest.length <= at + 2) return null }
        const picked = editable(rest.map(one).filter(Boolean))
        if (picked.length < 2) throw new LispError('FILLET 에는 직선 두 개가 필요합니다.')
        const made = [G.corner(picked[0], picked[1], Number(vars.FILLETRAD) || 0)].flat().filter(Boolean)
        if (made.length >= 2) { swap(picked[0], made[0]); swap(picked[1], made[1]) }
        for (const extra of made.slice(2)) born({ ...extra, layer: picked[0].layer })
        return null
      }
      case 'EXPLODE': {
        const [picked] = gather(args, 0)
        if (!picked.length) throw new LispError('분해할 객체를 찾지 못했습니다.')
        for (const e of editable(picked)) {
          // 사각형·폴리선은 선으로, 블록·치수·벽은 화면에 보이는 조각으로 나눈다.
          // 사각형은 네 꼭짓점 그대로 쓴다(두 점짜리 예전 형식도 읽는다). 예전에는 길이 0 선이 나왔다.
          const ring = e.type === 'rectangle' ? rectangleRing(e)
            : (e.type === 'polyline' && Array.isArray(e.points)) ? e.points.slice() : null
          const closed = e.type === 'rectangle' || e.closed
          const parts = ring
            ? ring.map((p, i) => [p, ring[(i + 1) % ring.length]])
              .slice(0, closed ? ring.length : ring.length - 1)
              .filter(([a, b]) => G.dist(a, b) > 1e-9)
              .map(points => ({ type: 'line', points }))
            : G.primitives(e).filter(part => part !== e)
          if (!parts.length) continue
          drop([e])
          for (const part of parts) born({ ...part, layer: part.layer || e.layer })
        }
        return null
      }
      case 'DXFOUT': case 'SAVEAS': {
        // 파일 쓰기는 리습 창이 맡는다. 여기서는 '어떤 이름으로 내보내 달라'만 남긴다.
        host.exportRequest = String(args.find(v => typeof v === 'string' && !isEnd(v)) || '')
        return null
      }
      case 'STYLE': {
        // 글꼴 설정은 도면 모양을 바꾸지 않는다. 이름만 현재 글꼴로 기억한다.
        const name = args.find(v => typeof v === 'string' && !isEnd(v) && !word(v).startsWith('-'))
        if (name) vars.TEXTSTYLE = String(name)
        return null
      }
      case 'AREA': {
        // (command "AREA" "E"|"O" 객체) → 면적·둘레를 시스템 변수에 담는다. 도면은 바뀌지 않는다.
        const target = args.map(v => (word(v) === 'L' && lastEntity) ? lastEntity : one(v)).find(Boolean)
        if (!target) throw new LispError('면적을 잴 객체를 찾지 못했습니다.')
        const ring = target.type === 'rectangle' ? rectangleRing(target) : G.vertices(target)
        vars.AREA = Math.abs(G.polygonArea(ring))
        vars.PERIMETER = segmentsOf(target).reduce((sum, [a, b]) => sum + G.dist(a, b), 0)
        return null
      }
      case 'LAYER': {
        const rest = args.filter(v => v !== null && v !== undefined)
        for (let i = 0; i < rest.length; i++) {
          const option = word(rest[i]), value = rest[i + 1]
          if (!option) continue
          if (['S', 'SET', 'M', 'MAKE', 'N', 'NEW'].includes(option) && value != null) {
            for (const piece of String(value).split(',')) if (piece.trim()) layerId(piece.trim())
            if (['S', 'SET', 'M', 'MAKE'].includes(option)) vars.CLAYER = String(value).split(',')[0].trim()
            i++
          }
          else if (['OFF', 'OF', 'F', 'FREEZE'].includes(option)) { for (const l of others(layersLike(value))) l.visible = false; i++ }
          else if (['ON', 'T', 'THAW'].includes(option)) { for (const l of layersLike(value)) l.visible = true; i++ }
          else if (['LO', 'LOCK'].includes(option)) { for (const l of layersLike(value)) l.locked = true; i++ }
          else if (['U', 'UNLOCK'].includes(option)) { for (const l of layersLike(value)) l.locked = false; i++ }
          else if (['LT', 'LTYPE'].includes(option) && rest[i + 2] != null) {
            const lt = String(value).toUpperCase()
            for (const l of layersLike(rest[i + 2])) l.linetype = lt
            i += 2
          }
          else if (['C', 'COLOR'].includes(option) && rest[i + 2] != null) {
            const color = ACI[Number(value)]
            if (color) for (const l of layersLike(rest[i + 2])) { l.color = color; l.aci = Number(value) }
            i += 2
          }
        }
        return null
      }
      case 'LAYOFF': case 'LAYON': case 'LAYLCK': case 'LAYLOCK': case 'LAYULK': case 'LAYUNLOCK': {
        // 객체를 집으면 그 객체의 레이어, "*" 를 주면 현재 레이어를 뺀 전부.
        const wild = args.some(v => typeof v === 'string' && v.includes('*'))
        const [picked] = gather(args.filter(v => !(typeof v === 'string' && v.includes('*'))), 0)
        const targets = wild ? others(doc.layers.slice()) : layersOf(picked)
        if (!targets.length) throw new LispError(name + ' 대상 레이어를 찾지 못했습니다.')
        for (const l of targets) {
          if (name === 'LAYOFF') l.visible = false
          else if (name === 'LAYON') l.visible = true
          else if (name === 'LAYULK' || name === 'LAYUNLOCK') l.locked = false
          else l.locked = true
        }
        return null
      }
      case 'TRIM': {
        const [boundaries, after] = gather(args, 0)
        if (!boundaries.length) throw new LispError('TRIM 에는 경계 객체가 필요합니다.')
        const rest = args.slice(after - 1)
        let picks = []
        if (rest.some(v => word(v) === 'F')) {
          // 울타리(_F): 두 점을 잇는 선이 지나가는 곳을 자른다.
          const points = rest.filter(isPoint).map(xy)
          if (points.length < 2) throw new LispError('TRIM 울타리에는 두 점이 필요합니다.')
          for (let i = 0; i + 1 < points.length; i++) {
            const fence = { type: 'line', points: [points[i], points[i + 1]] }
            for (const e of entities())
              for (const hit of G.intersections(e, fence)) picks.push(hit)
          }
          if (!picks.length) throw new LispError('울타리가 지나가는 자를 대상이 없습니다.')
        } else {
          picks = rest.filter(isPoint).map(xy)
          if (!picks.length) throw new LispError('TRIM 에는 자를 위치를 찍어야 합니다.')
        }
        let cut = 0, walls = 0, lockedHits = 0
        const wallAt = (p) => entities().some(e => e.type === 'wall' && e.points?.length >= 2
          && G.distanceToSegment(p, e.points[0], e.points[1]) <= Number(e.thickness || 0) / 2 + pickTolerance())
        for (const point of picks) {
          const target = nearest(point, true)
          if (!target || target.type === 'wall') { if (!target && !wallAt(point)) continue; walls++; continue }
          if (locked(target)) { lockedHits++; continue }
          const cutters = boundaries.filter(b => b.id !== target.id).map(b => (b.__wall ? { type: 'line', points: b.points } : b))
          if (!cutters.length) continue
          let parts
          try { parts = [G.cutEntity(target, cutters, point)].flat().filter(Boolean) }
          catch (e) { if (isCowViolation(e)) throw e; continue }   // 이 자리에서 못 자르는 건 넘어간다(원본 보호 신호는 넘기지 않는다)
          cut++
          if (!parts.length) { drop([target]); continue }
          swap(target, parts[0])
          for (const extra of parts.slice(1)) born({ ...extra, layer: target.layer })
        }
        if (walls) note(`바른 CAD 벽 객체 ${walls}곳은 자르지 않았습니다. 벽은 만나는 곳을 스스로 정리합니다.`)
        if (lockedHits) note(`잠긴 레이어의 객체 ${lockedHits}곳은 자르지 않았습니다.`)
        if (!cut) {
          if (walls) throw new LispError('울타리가 지나간 것은 바른 CAD 벽 객체뿐입니다. 벽 객체는 WALLTRIM 으로 자르지 않습니다(벽끼리 만나는 곳은 자동 정리됩니다). 선으로 그린 벽선에 쓰거나, 벽을 EXPLODE 로 선으로 바꾼 뒤 실행하세요.')
          if (lockedHits) throw new LispError('자를 객체가 모두 잠긴 레이어에 있습니다. 레이어 잠금을 푼 뒤 다시 실행하세요.')
          throw new LispError('자를 곳을 찾지 못했습니다. 경계선이 대상 선을 실제로 가로지르는지 확인하세요.')
        }
        return null
      }
      case 'BOUNDARY': {
        // (command "-boundary" 내부점 "") — 찍은 점을 품는 닫힌 영역을 폴리선으로 만든다.
        // 영역 찾기는 실행 전에 파이썬(ezdxf·shapely)이 끝내 두었다. AutoCAD 는 쓰지 않는다.
        const picks = []
        for (let at = 0; at < args.length && !isEnd(args[at]); at++) if (isPoint(args[at])) picks.push(xy(args[at]))
        if (!picks.length) throw new LispError('BOUNDARY 에는 영역 안쪽 좌표가 필요합니다.')
        if (!regions.length) throw new LispError('닫힌 영역을 하나도 찾지 못했습니다. 선이 끊긴 곳이 없는지 확인하세요.')
        for (const p of picks) {
          const found = regionAt(p)
          if (!found) throw new LispError(`좌표 ${Math.round(p.x)},${Math.round(p.y)} 는 닫힌 영역 안이 아닙니다. 영역 안쪽을 찍었는지 확인하세요.`)
          // 바깥 고리만 만든다. 구멍까지 만들면 뒤따르는 (entlast)·(entdel) 이 엉뚱한 것을 집는다.
          born({ type: 'polyline', layer: layerId(vars.CLAYER), points: found.ring.map(q => ({ ...q })), closed: true })
        }
        return null
      }
      case 'JUSTIFYTEXT': {
        // (command "justifytext" ss "" "mc") — 글자는 그 자리에 두고 정렬 기준만 바꾼다.
        const [targets, after] = gather(args, 0)
        const code = args.slice(after - 1).find(v => typeof v === 'string' && !isEnd(v))
        const texts = targets.filter(e => e.type === 'text')
        if (!texts.length) throw new LispError('JUSTIFYTEXT 로 정렬할 문자를 찾지 못했습니다.')
        for (const e of editable(texts)) Object.assign(writable(e), justified(e, code || 'L'))
        return null
      }
      case 'HATCHEDIT': {
        // (command "-hatchedit" ss "b" "p" "y") — 해치에서 경계 폴리선을 뽑는다(HATCHB 와 같은 일).
        // 해치는 바깥 경계를 points, 안쪽 구멍을 loops 로 갖는다. 둘 다 닫힌 폴리선으로 만든다.
        const hatches = collect(args).filter(e => e.type === 'hatch')
        if (!hatches.length) throw new LispError('경계선을 뽑을 해치를 찾지 못했습니다.')
        let made = 0
        for (const h of hatches)
          for (const ring of [h.points, ...(h.loops || [])])
            if (ring && ring.length >= 3) {
              born({ type: 'polyline', layer: layerId(vars.CLAYER), points: ring.map(q => ({ x: q.x, y: q.y })), closed: true })
              made++
            }
        if (!made) throw new LispError('해치에서 쓸 수 있는 경계를 찾지 못했습니다.')
        return null
      }
      case 'SELECTSIMILAR': {
        // 고른 것과 같은 종류·같은 레이어인 객체를 모아 둔다. 뒤에 오는 (ssget "_P") 가 그걸 집는다.
        const seeds = collect(args)
        const base = seeds.length ? seeds
          : entities().filter(e => lastSelection.includes(e.id) || preselected.includes(e.id))
        if (!base.length) throw new LispError('비슷한 것을 찾을 기준 객체가 없습니다. 도면에서 먼저 고른 뒤 실행하세요.')
        const kinds = new Set(base.map(e => e.type + ' · ' + e.layer))
        lastSelection = entities().filter(e => kinds.has(e.type + ' · ' + e.layer)).map(e => e.id)
        return null
      }
      default:
        throw new LispError(`(command "${name}") 은(는) 자체 엔진이 아직 옮기지 못했습니다.`)
    }
  }

  /* ── ssget 필터 ────────────────────────────────────────────
     (0 . "LINE,ARC") (8 . "A-*") (2 . "DOOR") (62 . 1) (1 . "*평*") 같은 그룹 비교,
     (-4 . "<OR") … (-4 . "OR>") 논리 묶음, (-4 . ">=") (40 . 100) 같은 크기 비교를 한다.
     글자는 AutoCAD 처럼 와일드카드·대소문자 무시로 비교한다. */
  const compileFilter = (filter) => {
    const items = filter.map(item => [codeOf(item), valueOf(item)])
    let i = 0
    const relation = (op, have, want) => {
      if (typeof want === 'string') return typeof have === 'string' && wcmatch(have, want, true) === (op !== '!=' && op !== '/=' && op !== '<>')
      if (Array.isArray(want)) {
        if (!Array.isArray(have)) return false
        const ops = String(op || '=').split(',').map(s => s.trim())
        return want.every((w, k) => {
          const o = ops[Math.min(k, ops.length - 1)] || '='
          return o === '*' || relation(o, Number(have[k] ?? 0), Number(w))
        })
      }
      const a = Number(have), b = Number(want)
      if (!Number.isFinite(a)) return false
      switch (op) {
        case '*': return true
        case '!=': case '/=': case '<>': return Math.abs(a - b) > 1e-9
        case '<': return a < b
        case '<=': return a <= b + 1e-9
        case '>': return a > b
        case '>=': return a >= b - 1e-9
        case '&': return (a & b) !== 0
        case '&=': return (a & b) === b
        default: return Math.abs(a - b) <= 1e-9
      }
    }
    const test = (code, want, op) => (list) => {
      let values = groupAll(list, code)
      if (!values.length && code === 62) values = [256]                 // 색을 안 준 객체는 BYLAYER(256)
      if (!values.length && code === 8) values = ['0']
      return values.some(have => relation(op, have, want))
    }
    const block = (end) => {
      const preds = []
      let op = '='
      while (i < items.length) {
        const [code, value] = items[i++]
        if (code === -4) {
          const tag = String(value).trim().toUpperCase()
          const open = /^<(AND|OR|XOR|NOT)$/.exec(tag)
          if (open) {
            const inner = block(open[1] + '>')
            const kind = open[1]
            preds.push(kind === 'AND' ? (l) => inner.every(p => p(l))
              : kind === 'OR' ? (l) => inner.some(p => p(l))
                : kind === 'XOR' ? (l) => inner.filter(p => p(l)).length === 1
                  : (l) => !inner.every(p => p(l)))
            continue
          }
          if (/^(AND|OR|XOR|NOT)>$/.test(tag)) {
            if (tag !== end) throw new LispError(`ssget 필터의 (-4 . "${tag}") 짝이 맞지 않습니다.`)
            return preds
          }
          op = String(value).trim()
          continue
        }
        preds.push(test(code, value, op))
        op = '='
      }
      if (end) throw new LispError(`ssget 필터에서 (-4 . "<${end.slice(0, -1)}") 가 닫히지 않았습니다.`)
      return preds
    }
    const preds = block(null)
    return (list) => preds.every(p => p(list))
  }
  /** 이 필터가 LINE 을 찾는가(벽 면을 후보에 넣을지 정한다). */
  const wantsLines = (filter) => {
    if (!filter) return false
    const kinds = groupAll(filter, 0).map(String)
    return kinds.some(k => wcmatch('LINE', k, true)) && !kinds.some(k => wcmatch('WALL', k, true))
  }

  /** 화면 선택을 대신한다. 한 번에 하나씩 묻는다.
      ALL·전체 → 도면 전체 · X,Y → 그 자리 객체 · X1,Y1 X2,Y2 → 창(왼→오)·걸침(오→왼)
      L → 마지막 · P → 이전 선택 · 선택 → 미리 고른 것 · Enter → 끝.
      미리 고른 것이 있으면 첫 (ssget) 은 묻지 않고 그것을 쓴다(AutoCAD PICKFIRST). 이때 다음 질문의 답을 먹지 않는다. */
  const choose = (pool, single = false) => {
    if (!pickfirstUsed && preselected.length && !/^(?:[_.]*ALL|전체|\*)$/i.test(String(inputs[cursor] || '').trim())) {
      pickfirstUsed = true
      const mine = pool.filter(e => preselected.includes(e.id) || (e.__wall && preselected.includes(e.__wall)))
      if (mine.length) return mine
    }
    pickfirstUsed = true
    const picked = new Map()
    const said = typeof options.recentOutput === 'function' ? String(options.recentOutput() || '').split('\n').map(s => s.trim()).filter(Boolean).pop() || '' : ''
    const guide = 'ALL=전체 · X,Y=그 자리 객체(도면에서 찍기) · X1,Y1 X2,Y2=창 · Enter=선택 끝'
    for (;;) {
      const prompt = picked.size ? `객체 ${picked.size}개 선택됨. 더 고르거나 Enter 로 끝내세요. ${guide}` : `${said ? said + ' · ' : ''}객체 선택: ${guide}`
      const line = take('선택할 객체 위의 점', prompt).trim()
      if (blank(line)) break
      const key = line.replace(/^[_.]+/, '').toUpperCase()
      if (['ALL', '전체', '*'].includes(key)) {
        for (const e of pool) picked.set(e.id, e)
        // 예전 입력 방식(_ALL 다음 줄에 Enter)도 받는다. 이미 적어 둔 Enter 만 먹고, 새로 묻지는 않는다.
        if (cursor < inputs.length && blank(inputs[cursor])) cursor++
        break
      }
      if (['선택', 'I', 'P', '이전', 'L', '마지막'].includes(key)) {
        const list = ['선택', 'I'].includes(key) ? pool.filter(e => preselected.includes(e.id) || (e.__wall && preselected.includes(e.__wall)))
          : ['P', '이전'].includes(key) ? pool.filter(e => lastSelection.includes(e.id))
            : [lastEntity || entities().at(-1)].filter(Boolean)
        if (!list.length) throw new InputError(`고를 객체가 없습니다. 받은 값: ${line}`)
        for (const e of list) picked.set(e.id, e)
        if (single) break
        continue
      }
      const box = line.match(/^(?:([WC])\s+)?(\S+)[\s;/]+(\S+)$/i)
      const a = box && coordinate(box[2]), b = box && coordinate(box[3])
      if (a && b) {
        const crossing = box[1] ? box[1].toUpperCase() === 'C' : b[0] < a[0]
        const inside = inBox({ x: a[0], y: a[1] }, { x: b[0], y: b[1] }, crossing, pool)
        if (!inside.length) throw new InputError(`그 ${crossing ? '걸침' : '창'} 안에 고를 객체가 없습니다. 받은 값: ${line}`)
        for (const e of inside) picked.set(e.id, e)
        if (single) break
        continue
      }
      const p = coordinate(line)
      if (p) {
        vars.LASTPOINT = p
        const hit = nearestIn(pool, { x: p[0], y: p[1] })
        if (!hit) throw new InputError(`그 자리 근처에서 고를 수 있는 객체를 찾지 못했습니다. 객체 위를 찍거나 ALL 을 입력하세요. 받은 값: ${line}`)
        picked.set(hit.id, hit)
        if (single) break
        continue
      }
      throw new InputError(`선택 방식을 알 수 없습니다. ALL, X,Y 좌표, 두 점(창), L(마지막), P(이전), Enter 중에서 입력하세요. 받은 값: ${line}`)
    }
    return [...picked.values()]
  }

  /** 레이어 표 레코드(tblobjname·entget·entmod 가 다룬다). */
  const layerRecord = (l) => [dot(-1, new Ename('@layer:' + l.name)), dot(0, 'LAYER'), dot(2, l.name),
    dot(70, (l.locked ? 4 : 0) | (l.frozen ? 1 : 0)), dot(62, (l.visible === false ? -1 : 1) * (aciOf(l.color) ?? l.aci ?? 7)), dot(6, l.linetype || 'CONTINUOUS'),
    ...(l.color && l.colorMode !== 'aci' ? [dot(420, parseInt(l.color.replace('#', ''), 16))] : []),
    dot(370, Math.round((l.lineweight ?? .25) * 100)), dot(290, l.plot === false ? 0 : 1)]

  const comTarget = (v) => v instanceof Ename ? byId(v.id) : null
  const comLayer = (v) => {
    const name = v && v.name ? String(v.name).replace(/^LAYER:/i, '') : typeof v === 'string' ? v.replace(/^LAYER:/i, '') : null
    return name ? doc.layers.find(l => l.name === name) : null
  }

  const host = {
    /* ── 도면 객체 ── */
    entmake(list) {
      const made = dxfToEntity(list, layerId, vars.CLAYER)
      if (made.__layer) {
        if (!doc.layers.some(l => l.name === made.name)) {
          const standard = standardLayerForName(made.name)
          const color = standard?.color || made.truecolor || ACI[made.color] || '#d8d8d8'
          doc.layers.push({ id: uuid(), name: made.name, visible: !made.off, locked: made.locked, frozen: made.frozen,
            lineweight: made.lineweight ?? .25, plot: made.plot, linetype: made.linetype || 'CONTINUOUS', ...(standard || {}),
            color, aci: aciOf(color) ?? made.color, colorMode: standard || made.truecolor ? 'truecolor' : 'aci' })
        }
        return list
      }
      delete made.__bylayer
      // 벽 면을 줄인 뒤(entmod) 남은 조각을 다시 만드는 것(DOOR·WIND)은 새 선이 아니라 벽이 남길 구간이다.
      if (made.type === 'line' && faceEdits.size) {
        for (const faceId of faceEdits.keys()) {
          const face = byId(faceId)
          if (face && onFace(face, made.points[0]) && onFace(face, made.points[1])) {
            faceEdits.get(faceId).push([faceParam(face, made.points[0]), faceParam(face, made.points[1])])
            return list
          }
        }
        // 양쪽 벽 면을 잇는 마구리선은 벽 객체가 스스로 그린다.
        const ends = made.points.map(p => [...faceEdits.keys()].map(byId).find(face => face && onFace(face, p)))
        if (ends[0] && ends[1] && ends[0].__wall === ends[1].__wall && ends[0].__face !== ends[1].__face) return list
      }
      doc.entities.push(made); lastEntity = made
      return list
    },
    entmakex(list) { const before = lastEntity; const r = host.entmake(list); return group(list, 0) === 'LAYER' || lastEntity === before ? r && T : ename(lastEntity) },
    entget(v) {
      if (!(v instanceof Ename)) return null
      if (String(v.id).startsWith('@layer:')) {
        const l = doc.layers.find(x => x.name === String(v.id).slice(7))
        return l ? layerRecord(l) : null
      }
      const e = byId(v.id)
      if (!e) return null
      // 얼린 원본은 바뀌지 않으므로 같은 객체를 다시 읽으면 만든 목록을 그대로 준다(DIMCLEAN 은 치수마다 앞의 모든 치수를 다시 읽는다).
      // 레이어 이름은 이번 실행에서 바뀔 수 있어 함께 확인한다. 리습 목록은 제자리에서 바뀌지 않는다.
      const layerName = nameOf(e.layer)
      if (!Object.isFrozen(e)) return entityToDxf(e, layerName)
      const hit = dxfCache.get(e)
      if (hit && hit.layerName === layerName) return hit.list
      const list = entityToDxf(e, layerName)
      dxfCache.set(e, { layerName, list })
      return list
    },
    entmod(list) {
      const handle = group(list, -1)
      const id = handle instanceof Ename ? handle.id : group(list, 5)
      if (String(id).startsWith('@layer:')) {
        const l = doc.layers.find(x => x.name === String(id).slice(7))
        if (!l) throw new LispError('바꿀 레이어를 찾을 수 없습니다')
        const next = dxfToEntity([...list, dot(0, 'LAYER')].filter((item, i, all) => codeOf(item) !== 0 || i === all.length - 1), layerId, vars.CLAYER)
        if (next.name && next.name !== l.name && !doc.layers.some(x => x.name === next.name)) l.name = next.name
        if (hasGroup(list, 62)) { l.color = ACI[next.color] || l.color; l.aci = next.color; l.visible = !next.off }
        if (hasGroup(list, 420)) { l.color = next.truecolor; l.colorMode = 'truecolor'; l.aci = aciOf(l.color) ?? 7 }
        else if (hasGroup(list, 62)) l.colorMode = 'aci'
        if (hasGroup(list, 370) && next.lineweight != null) l.lineweight = next.lineweight
        if (hasGroup(list, 290)) l.plot = next.plot
        if (hasGroup(list, 70)) { l.locked = next.locked; l.frozen = next.frozen }
        if (hasGroup(list, 6)) l.linetype = next.linetype
        return list
      }
      const face = byId(id)
      if (face?.__wall) {
        // 벽 면을 줄이는 것(DOOR·WIND 가 벽선을 끊는 방식)은 벽의 개구부로 바꿔 넣는다. 면 밖으로 옮기는 것은 못 한다.
        const a = toPoint(group(list, 10)), b = toPoint(group(list, 11))
        const s = faceParam(face, a), e = faceParam(face, b)
        // 면 밖으로 옮기거나, 선은 그대로 두고 레이어·색만 바꾸려는 것은 벽에 할 수 없다 → nil + 알림(잠긴 레이어와 같은 방식)
        if (!onFace(face, a) || !onFace(face, b) || (Math.min(s, e) < 1e-6 && Math.max(s, e) > 1 - 1e-6)) { note(WALL_FACE_MESSAGE); return null }
        faceEdits.set(face.id, [[s, e]])
        return list
      }
      const index = indexOfId(id)
      if (index < 0) throw new LispError('바꿀 객체를 찾을 수 없습니다')
      const before = doc.entities[index]
      // AutoCAD 는 잠긴 레이어의 객체를 고치지 않고 nil 을 돌려준다.
      if (locked(before)) { note('잠긴 레이어의 객체는 바꾸지 않았습니다.'); return null }
      const updated = dxfToEntity(list, layerId, nameOf(before.layer))
      if (updated.__layer) return list
      // DXF 로 왕복하지 않는 속성(선굵기·선종류·이름 등)은 원래 값을 지켜야 한다.
      // 예전에는 PC(닫기) 한 번에 빨간 파선이 기본색 실선으로 돌아갔다.
      // 62 가 없으면 색은 그대로, 62 가 256(BYLAYER)이면 색을 뗀다.
      const next = { ...before, ...updated, id }
      if (updated.__bylayer) { delete next.color; delete next.aci }
      delete next.__bylayer
      if (!hasGroup(list, 8)) next.layer = before.layer
      // 네 꼭짓점을 그대로 둔 채 닫기만 한 사각형은 사각형으로 남긴다.
      if (before.type === 'rectangle' && next.type === 'polyline' && next.closed && next.points.length === 4
        && next.points.every((p, i) => G.dist(p, rectangleRing(before)[i]) < 1e-9)) { next.type = 'rectangle'; delete next.closed; next.points = rectangleRing(before) }
      doc.entities[index] = next
      return list
    },
    entdel(v) {
      const id = v instanceof Ename ? v.id : null
      const e = byId(id)
      if (e?.__wall) { note(WALL_FACE_MESSAGE); return null }
      if (e && locked(e)) { note('잠긴 레이어의 객체는 지우지 않았습니다.'); return null }
      const index = indexOfId(id)
      if (index < 0) return null
      deletedNext.set(id, doc.entities[index + 1]?.id ?? null)
      doc.entities.splice(index, 1)
      return v
    },
    entlast() { return lastEntity ? ename(lastEntity) : (entities().length ? ename(entities().at(-1)) : null) },
    entnext(v) {
      if (!v) return entities().length ? ename(entities()[0]) : null
      const i = indexOfId(v.id)
      if (i < 0 && deletedNext.has(v.id)) {
        // 지운 객체: 지울 때 뒤에 있던 객체(그것도 지웠으면 그다음)로 이어 간다.
        let next = deletedNext.get(v.id), guard = 0
        while (next != null && indexOfId(next) < 0 && deletedNext.has(next) && guard++ < 1e6) next = deletedNext.get(next)
        const at = next != null ? indexOfId(next) : -1
        return at >= 0 ? ename(doc.entities[at]) : null
      }
      return i >= 0 && i + 1 < entities().length ? ename(entities()[i + 1]) : null
    },
    entupd() { return T },
    entsel(...a) {
      const text = take('선택할 객체 위의 점', promptOf(a))
      if (blank(text)) return null        // Enter = 안 고름. 리습이 '내부점 선택' 같은 다른 길로 간다.
      if (['L', '마지막'].includes(text.trim().replace(/^[_.]+/, '').toUpperCase())) {   // _L = 마지막으로 만든 객체
        const last = lastEntity || entities()[entities().length - 1]   // AutoCAD 의 entlast: 이번에 만든 것이 없으면 도면의 마지막 객체
        if (!last) return null
        const p = last.position || last.center || last.points?.[0] || { x: 0, y: 0 }
        return [ename(last), [p.x, p.y, 0]]
      }
      const pick = asPoint(text)
      const q = { x: pick[0], y: pick[1] }
      let best = null, bd = Infinity
      for (const e of entities()) { const d = G.entityDistance(e, q); if (d < bd) { bd = d; best = e } }
      return best ? [ename(best), pick] : null
    },
    /** (nentselp [안내] [점]) — 점을 주면 묻지 않고 그 자리의 객체를 고른다. */
    nentselp(...a) {
      const given = a.find(v => Array.isArray(v) && typeof v[0] === 'number')
      if (!given) return host.entsel(...a)
      const best = nearestIn(entities(), { x: given[0], y: given[1] })
      return best ? [ename(best), [given[0], given[1], 0]] : null
    },
    handent(h) { const e = byId(String(h)); return e ? ename(e) : null },
    tblobjname(table, name) {
      if (String(table).toUpperCase() !== 'LAYER') return null
      return doc.layers.some(l => l.name === String(name)) ? new Ename('@layer:' + String(name)) : null
    },

    /* ── 선택 세트 ── */
    ssget(...args) {
      // 필터는 (0 . "LINE") 형태의 연관 리스트. 모드는 "_X"(도면 전체) "_I"(미리 고른 것) 등.
      // 점 목록(다각형·울타리)은 WP·CP·F 방식일 때만 온다. 그 밖의 '목록의 목록' 은 필터다.
      // 예전에는 (cons 10 점) 으로 시작하는 필터를 다각형으로 잘못 읽어 전부를 골랐다.
      const pointMode = args.some(a => typeof a === 'string' && /^[_.]*(WP|CP|F)$/i.test(a))
      const polygonArg = pointMode ? args.find(a => Array.isArray(a) && a.length && a.every(p => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number' && p.length <= 3)) : null
      const filter = args.find(a => a !== polygonArg && Array.isArray(a) && a.length && (a[0] instanceof Dot || Array.isArray(a[0])))
      const modes = args.filter(a => typeof a === 'string').map(s => s.replace(/^[_.]+/, '').toUpperCase())
      const boxPoints = args.filter(a => Array.isArray(a) && typeof a[0] === 'number').map(v => ({ x: v[0], y: v[1] || 0 }))
      const polygon = polygonArg
      const pool = wantsLines(filter) ? entities().concat(wallFaces()) : entities()
      const mine = () => pool.filter(e => preselected.includes(e.id) || (e.__wall && preselected.includes(e.__wall)))
      const single = modes.some(m => m.includes(':S'))
      let list
      if (modes.includes('I')) list = mine()
      else if (modes.includes('X') || modes.includes('A')) list = pool.slice()
      else if (modes.includes('P')) list = pool.filter(e => lastSelection.includes(e.id))
      else if (modes.includes('L')) list = lastEntity ? [lastEntity] : []
      else if ((modes.includes('WP') || modes.includes('CP')) && polygon) {
        const ring = polygon.map(p => ({ x: p[0], y: p[1] }))
        list = pool.filter(e => {
          const vs = e.type === 'rectangle' ? rectangleRing(e) : G.vertices(e)
          return modes.includes('WP') ? vs.length && vs.every(p => G.inside(p, ring)) : vs.some(p => G.inside(p, ring))
        })
      }
      else if (modes.includes('W') || modes.includes('C')) {
        // 창·걸침: 넘어온 두 점이 만드는 상자 안(또는 걸친) 객체를 고른다.
        list = boxPoints.length >= 2 ? inBox(boxPoints[0], boxPoints[1], modes.includes('C'), pool) : []
      }
      else if (modes.includes('F')) {
        const fence = polygon ? polygon.map(p => ({ x: p[0], y: p[1] })) : boxPoints
        const hit = new Set()
        for (let i = 0; i + 1 < fence.length; i++) {
          const seg = { type: 'line', points: [fence[i], fence[i + 1]] }
          for (const e of pool) if (G.intersections(e, seg).length) hit.add(e)
        }
        list = [...hit]
      }
      else if (boxPoints.length === 1) list = [nearestIn(pool, boxPoints[0])].filter(Boolean)   // (ssget 점)
      else list = choose(filter ? pool.filter(e => compileFilter(filter)(entityToDxf(e, nameOf(e.layer)))) : pool, single)
      if (filter) {
        const pass = compileFilter(filter)
        list = list.filter(e => pass(entityToDxf(e, nameOf(e.layer))))
      }
      lastSelection = list.map(e => e.id)
      return list.length ? new SelSet(lastSelection) : null
    },
    ssgetfirst() { return [null, preselected.length ? new SelSet(preselected) : null] },
    sssetfirst(_grips, pickset) {
      preselected = pickset instanceof SelSet ? pickset.ids.slice() : []
      pickfirstUsed = false
      return [null, pickset instanceof SelSet ? pickset : null]
    },

    /* ── 시스템 변수 · 테이블 ── */
    getvar(name) { const v = vars[String(name).toUpperCase()]; return v === undefined ? null : v },
    setvar(name, value) {
      const key = String(name).toUpperCase()
      if (key === 'CLAYER' && typeof value === 'string' && !doc.layers.some(l => l.name === value) && standardLayerForName(value)) layerId(value)
      if (key === 'CLAYER' && typeof value === 'string' && !doc.layers.some(l => l.name === value))
        throw new LispError(`레이어 ${value} 가 없습니다. 먼저 만든 뒤 현재 레이어로 정하세요.`)
      vars[key] = value
      return value
    },
    getenv(name) { const v = env.get(String(name).toUpperCase()); return v === undefined ? null : v },
    setenv(name, value) { env.set(String(name).toUpperCase(), String(value ?? '')); return String(value ?? '') },
    tblsearch(table, name) {
      const t = String(table).toUpperCase()
      if (t === 'LAYER') {
        const l = doc.layers.find(x => x.name.toUpperCase() === String(name).toUpperCase())
        return l ? layerRecord(l).slice(1) : null
      }
      if (t === 'LTYPE') return ['CONTINUOUS', 'DASHED', 'CENTER', 'HIDDEN', 'BYLAYER', 'BYBLOCK'].includes(String(name).toUpperCase())
        ? [dot(0, 'LTYPE'), dot(2, String(name).toUpperCase())] : null
      if (t === 'BLOCK') return entities().some(e => e.type === 'block' && e.name === name) ? [dot(0, 'BLOCK'), dot(2, String(name))] : null
      if (t === 'STYLE') return String(name).toUpperCase() === String(vars.TEXTSTYLE).toUpperCase() || String(name).toUpperCase() === 'STANDARD' ? [dot(0, 'STYLE'), dot(2, String(name))] : null
      return null
    },
    // 표 훑기. 두 번째 인자가 참이면 처음부터 다시 시작한다(AutoLISP 규칙).
    tblnext(name, rewind) {
      const table = String(name || '').toUpperCase()
      const rows = table === 'LAYER'
        ? doc.layers.map(l => layerRecord(l).slice(1))
        : table === 'BLOCK'
          ? [...new Set(entities().filter(e => e.type === 'block' && e.name).map(e => e.name))]
            .map(n => [dot(0, 'BLOCK'), dot(2, n)])
          : []
      if (rewind) cursors.set(table, 0)
      const at = cursors.get(table) || 0
      if (at >= rows.length) return null
      cursors.set(table, at + 1)
      return rows[at]
    },

    /* ── 사용자 입력 (화면이 한 가지씩 물어 받은 값을 순서대로 쓴다) ── */
    // (initget 비트 "낱말들") — 1 빈값 금지 · 2 0 금지 · 4 음수 금지 · 128 아무 입력. 낱말은 점·숫자 대신 답할 수 있다.
    initget(...a) {
      rule = {
        bits: Number(a.find(x => typeof x === 'number') || 0),
        keywords: a.filter(x => typeof x === 'string').flatMap(s => s.split(/\s+/)).filter(Boolean).filter(k => !k.startsWith('_')),
      }
      return null
    },
    // Enter 만 친 답(빈 줄)은 nil 이다. 점을 이어 찍다가 Enter 로 끝내는 리습이 여기에 기댄다.
    getpoint(...a) { return ask('점', a, asPoint) },
    getcorner(...a) { return ask('반대쪽 모서리 점', a, asPoint) },
    getreal(...a) { return ask('숫자', a, realOf) },
    getdist(...args) {
      return ask('거리', args, (s) => {
        const q = coordinate(s)
        if (q) {                                        // 거리는 좌표로도 답할 수 있다
          const base = args.find(a => Array.isArray(a) && typeof a[0] === 'number')
          return base ? Math.hypot(q[0] - base[0], q[1] - base[1]) : Math.hypot(q[0], q[1])
        }
        if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) throw new InputError(`거리를 숫자나 X,Y 로 입력하세요. 받은 값: ${s}`)
        return Number(s)
      })
    },
    getint(...a) {
      return ask('정수', a, (s) => {
        if (!/^[-+]?\d+$/.test(s)) throw new InputError(`정수를 입력하세요. 받은 값: ${s}`)
        const v = Number(s)
        if (Math.abs(v) > 32767) throw new InputError(`정수는 -32768~32767 사이로 입력하세요. 받은 값: ${s}`)
        return v
      })
    },
    getangle(...a) {
      return ask('각도', a, (s) => {
        const q = coordinate(s)
        const base = a.find(v => Array.isArray(v) && typeof v[0] === 'number')
        if (q && base) return Math.atan2(q[1] - base[1], q[0] - base[0])
        return realOf(s) * Math.PI / 180
      })
    },
    getstring(...a) {
      rule = { bits: 0, keywords: [] }
      // (getstring T "안내") 만 빈칸을 받는다. T 가 없으면 AutoCAD 처럼 첫 빈칸에서 끊는다.
      const spaces = a.length > 1 && a[0] !== null && a[0] !== undefined && typeof a[0] !== 'string'
      const s = take('문자', promptOf(a))
      if (s === '<Enter>') return ''
      return spaces ? s : s.trim().split(/\s+/)[0] || ''
    },
    getkword(...a) {
      const r = useRule()
      const s = take('선택어', promptOf(a)).trim()
      if (!s || s === '<Enter>') {
        if (r.bits & 1) throw new InputError(`보기 중 하나를 고르세요(${r.keywords.join('/')}). 받은 값: (빈 값)`)
        return null
      }
      const hit = keywordOf(r, s)
      if (hit) return hit
      if (!r.keywords.length || (r.bits & 128)) return s
      throw new InputError(`보기 중 하나를 고르세요(${r.keywords.join('/')}). 받은 값: ${s}`)
    },
    getfiled(...a) { return take('파일 경로', promptOf(a)) },

    /* ── 명령 실행 ── */
    command(...args) {
      const name = String(typeof args[0] === 'string' ? args[0] : '').replace(/^[_.]+/, '').toUpperCase()
      // 폴리선을 그리는 중이면 점·옵션은 그 폴리선의 몫이다.
      // (command 점) · (command "S" …) · (command "C") · (command "") 가 모두 여기로 온다.
      if (pending && args.length && (isPoint(args[0]) || !(SUPPORTED_COMMANDS.has(name.replace(/^-/, '')) || bridge?.names.has(name)))) { plineStep(args, 0); return null }
      if (!args.length) { finishPline(true); return null }          // (command) = 취소
      const rest = args.slice(1)
      // AutoCAD 표준 이름이 아니고 바른 CAD 건축 요소 명령이면 그 명령을 실행한다(기본 명령 이름이 먼저).
      if (bridge && !SUPPORTED_COMMANDS.has(name.replace(/^-/, '')) && bridge.names.has(name)) return bridgeCommand(name, rest)
      // 바깥에서 준 처리기가 먼저다. undefined 를 돌려주면 기본 다리로 넘어간다.
      if (options.command) { const answered = options.command(name, rest); if (answered !== undefined) return answered }
      if (name !== 'PLINE') finishPline(true)      // 다른 명령이 시작되면 그리던 폴리선은 거기서 끝이다
      return runCommand(name, rest)
    },
    /** 리습이 끝났을 때 호출한다. 마무리 응답을 못 받은 폴리선을 정리하고 벽 개구부를 넣는다. */
    finish() { finishPline(true); applyWallOpenings(); return null },

    /* ── 커브 ── */
    curveGetStartPoint(v) { const e = curveOf(v); return pt3(segmentsOf(e)[0]?.[0] || e.center || { x: 0, y: 0 }) },
    curveGetEndPoint(v) { const e = curveOf(v); const s = segmentsOf(e); return pt3(s.at(-1)?.[1] || e.center || { x: 0, y: 0 }) },
    curveGetStartParam() { return 0 },
    curveGetEndParam(v) { return lengthOf(curveOf(v)) },
    curveGetPointAtParam(v, d) { return pt3(pointAtDistance(curveOf(v), Number(d) || 0)) },
    curveGetDistAtParam(v, d) { return Number(d) || 0 },
    curveGetParamAtPoint(v, p) { return host.curveGetDistAtPoint(v, p) },
    curveGetDistAtPoint(v, p) {
      const e = curveOf(v), q = toPoint(p)
      let acc = 0
      for (const [a, b] of segmentsOf(e)) {
        const len = G.dist(a, b), c = closestOn({ type: 'line', points: [a, b] }, q)
        if (G.dist(c, q) < 1e-6) return acc + G.dist(a, c)
        acc += len
      }
      return acc
    },
    curveGetClosestPointTo(v, p) { return pt3(closestOn(curveOf(v), toPoint(p))) },
    curveGetArea(v) {
      const e = curveOf(v)
      if (e.type === 'circle') return Math.PI * e.radius ** 2
      if (e.type === 'ellipse') return Math.PI * G.dist(e.majorAxis, { x: 0, y: 0 }) ** 2 * (e.ratio || 1)
      // 사각형은 네 꼭짓점을 그대로 잰다(두 점짜리 예전 형식도 편다).
      const ring = e.type === 'rectangle' ? rectangleRing(e) : G.vertices(e)
      return ring.length >= 3 ? Math.abs(G.polygonArea(ring)) : 0
    },
    curveIsClosed(v) {
      const e = curveOf(v)
      return (e.closed || ['circle', 'rectangle', 'hatch'].includes(e.type)
        || (e.type === 'ellipse' && (e.endParam ?? Math.PI * 2) - (e.startParam || 0) >= Math.PI * 2 - 1e-9)) ? T : null
    },

    /* ── 파일 ──
       보안상 디스크에는 쓰지 않는다. 실행 동안만 있는 메모리 속 파일이다.
       실행이 끝나면 리습 창이 '저장할지' 묻는다(outputFiles). */
    fileOpen(path, mode) {
      const key = String(path), how = String(mode || 'r').toLowerCase()
      if (how.startsWith('r')) {
        if (!files.has(key)) return null                        // AutoLISP: 없는 파일을 읽으려 하면 nil
        const h = new FileHandle(key, how)
        h.lines = files.get(key).split('\n')
        return h
      }
      const h = new FileHandle(key, how)
      if (how.startsWith('a') && files.has(key)) h.lines = files.get(key).split('\n')
      files.set(key, h.lines.join('\n'))
      return h
    },
    fileClose(h) {
      if (h instanceof FileHandle) { if (!h.mode.startsWith('r')) files.set(h.path, h.lines.join('\n')); h.open = false }
      return null
    },
    writeLine(text, h) {
      if (!(h instanceof FileHandle) || h.mode.startsWith('r') || !h.open) throw new LispError('write-line 에는 쓰기로 연 파일이 필요합니다')
      h.lines.push(typeof text === 'string' ? text : String(text))
      files.set(h.path, h.lines.join('\n'))
      return text
    },
    writeChar(code, h) {
      if (!(h instanceof FileHandle) || h.mode.startsWith('r') || !h.open) throw new LispError('write-char 에는 쓰기로 연 파일이 필요합니다')
      const ch = String.fromCharCode(Number(code))
      if (ch === '\n') h.lines.push('')
      else { if (!h.lines.length) h.lines.push(''); h.lines[h.lines.length - 1] += ch }
      files.set(h.path, h.lines.join('\n'))
      return code
    },
    readLine(h) {
      if (!(h instanceof FileHandle)) return null
      return h.read < h.lines.length ? h.lines[h.read++] : null
    },
    readChar(h) {
      if (!(h instanceof FileHandle)) return null
      const text = h.lines.join('\n')
      h.charAt = h.charAt || 0
      return h.charAt < text.length ? text.charCodeAt(h.charAt++) : null
    },
    findfile(p) { return files.has(String(p)) ? String(p) : null },
    fileDelete(p) { return files.delete(String(p)) ? T : null },
    fileSize(p) { return files.has(String(p)) ? new TextEncoder().encode(files.get(String(p))).length : null },
    outputFiles: () => Object.fromEntries(files),
    loadLisp(name) { return typeof options.loadLisp === 'function' ? options.loadLisp(String(name)) : null },

    /* ── ActiveX 얇은 대역 ── */
    // 실제 COM 이 아니라, 리습이 흔히 쓰는 '레이어 만들고 색 주고 객체 읽고 고치기'만 흉내낸다.
    comAcadObject() { return sym('*ACAD*') },
    comModelSpace() { return sym('*MODELSPACE*') },
    comLayers() { return sym('*LAYERS*') },
    comLayerItem(_, name) { return sym('LAYER:' + name) },
    comLayerAdd(_, name) { layerId(String(name)); return sym('LAYER:' + name) },
    comPutColor(target, color) { host.comPut(target, 'Color', color); return null },
    comPutLayer(target, layerRef) { host.comPut(target, 'Layer', layerRef); return null },
    comCopy(v) {
      const e = comTarget(v)
      if (!e || e.__wall) return null
      const copy = { ...structuredClone(e), id: uuid() }
      doc.entities.push(copy); lastEntity = copy
      return ename(copy)
    },
    comUndoMark() { return null },
    comAddLine(_, a, b) {
      return ename(born({ type: 'line', layer: layerId(vars.CLAYER), points: [toPoint(a), toPoint(b)] }))
    },
    comAddCircle(_, c, r) {
      if (!(Number(r) > 0)) throw new LispError('AddCircle 반지름은 0보다 커야 합니다.')
      return ename(born({ type: 'circle', layer: layerId(vars.CLAYER), center: toPoint(c), radius: Number(r) }))
    },
    comDelete(v) {
      const e = comTarget(v)
      if (!e) return null
      if (editable([e]).length) drop([e])
      return null
    },
    comGet(target, property) {
      const p = String(property).toUpperCase()
      const layer = comLayer(target)
      if (layer && !(target instanceof Ename)) {
        if (p === 'NAME') return layer.name
        if (p === 'COLOR') return layer.aci ?? aciOf(layer.color) ?? 7
        return null
      }
      const e = comTarget(target)
      if (!e) return null
      const dxf = entityToDxf(e, nameOf(e.layer))
      switch (p) {
        case 'LAYER': return nameOf(e.layer)
        case 'TEXTSTRING': return e.type === 'text' ? String(e.text ?? '') : null
        case 'LENGTH': return lengthOf(e)
        case 'AREA': return host.curveGetArea(target)
        case 'OBJECTNAME': return 'AcDb' + ({ LINE: 'Line', CIRCLE: 'Circle', ARC: 'Arc', TEXT: 'Text', LWPOLYLINE: 'Polyline', INSERT: 'BlockReference', DIMENSION: 'Dimension', POINT: 'Point' }[String(group(dxf, 0))] || String(group(dxf, 0)))
        case 'COLOR': return e.color ? (e.aci ?? aciOf(e.color)) : 256
        case 'STARTPOINT': return host.curveGetStartPoint(target)
        case 'ENDPOINT': return host.curveGetEndPoint(target)
        case 'CENTER': return e.center ? pt3(e.center) : null
        case 'RADIUS': return e.radius ?? null
        case 'NAME': return e.name ?? null
        case 'HANDLE': return e.id
        default: throw new LispError(`ActiveX 속성 ${property} 은(는) 자체 엔진이 아직 모릅니다.`)
      }
    },
    comPut(target, property, value) {
      const p = String(property).toUpperCase()
      const layer = comLayer(target)
      if (layer && !(target instanceof Ename)) {
        if (p === 'COLOR' && ACI[Number(value)]) { layer.color = ACI[Number(value)]; layer.aci = Number(value) }
        return null
      }
      const found = comTarget(target)
      if (!found) return null
      if (!editable([found]).length) return null
      const e = writable(found)
      if (p === 'LAYER') e.layer = layerId(String(value && value.name ? value.name : value).replace(/^LAYER:/i, ''))
      else if (p === 'TEXTSTRING' && e.type === 'text') e.text = String(value ?? '')
      else if (p === 'COLOR') { const c = colorFrom62(value); if (c) { e.color = c; e.aci = Number(value) } else { delete e.color; delete e.aci } }
      else throw new LispError(`ActiveX 속성 ${property} 은(는) 자체 엔진이 아직 바꾸지 못합니다.`)
      return null
    },

    // AutoLISP textbox 는 넣는 점에서 본 글자 상자를 (왼아래 오른위) 로 돌려준다.
    // 예전에는 0 만 돌려줘서 이 값으로 표식을 그리는 리습이 찌그러진 도형을 만들었다.
    textbox(list) {
      const found = list instanceof Ename ? byId(list.id) : null
      const box = textBox(found || {
        text: String(group(list, 1) ?? ''),
        height: Number(group(list, 40)) || vars.TEXTSIZE,
        widthFactor: Number(group(list, 41)) || 1,
      })
      return [[0, box.bottom, 0], [box.width, box.top, 0]]
    },
    // (grread T) 는 마우스를 실시간으로 읽는다. 뒤에서 도는 엔진에는 대응물이 없다.
    // 실시간 추적 대신 입력값 칸의 다음 줄을 '찍은 점'으로 돌려준다.
    // 좌표를 적으면 (5 (x y 0)) — 마우스가 움직였다는 뜻이고, 글자를 적으면 (2 글쇠코드) 다.
    grread() {
      const value = answer('grread 가 읽을 좌표(또는 글쇠 한 글자)')
      if (Array.isArray(value)) return [5, value]
      const text = String(value)
      return [2, text ? text.charCodeAt(0) : 13]
    },
    osnap(p) { return p },

    /* 진행 상황 */
    consumed: () => cursor,
    remaining: () => inputs.length - cursor,
    notes: () => notes.slice(),
    setLoading: (on) => { loading = !!on },
  }
  if(options.restricted)for(const name of ['fileOpen','fileDelete','fileSize','findfile','getfiled']){
    host[name]=()=>{throw new LispError('AI 리습은 파일에 접근할 수 없습니다: '+name)}
  }
  return host
}
