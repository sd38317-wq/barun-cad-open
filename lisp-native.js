// 바른 CAD 자체 AutoLISP 엔진 — AutoCAD 없이 .lsp를 읽고 실행한다.
// 이 파일은 도면을 직접 건드리지 않는다. 모든 도면 접근은 host 어댑터를 거친다.
// 그래서 노드에서 host를 흉내 내 단독으로 시험할 수 있다.

/* ── 값 표현 ───────────────────────────────────────────────
   nil        → null
   T / 심볼    → Sym
   문자열      → JS string
   정수        → JS BigInt (32비트로 감는다. (/ 7 2) = 3)
   실수        → JS number
   리스트      → JS 배열 · Cons(앞에 붙인 칸) · View(뒤쪽 조각)
                 cons·cdr 이 목록을 복사하지 않는다. 5만 개 목록도 바로 만든다.
   점 (x y z) → 리스트와 같음
   점 쌍 (a . b) → Dot            (연관 리스트의 (8 . "A-WALL") 같은 것)
   선택 세트   → SelSet
   엔티티 이름 → Ename
   파일 핸들   → FileHandle

   도면 어댑터(host)에는 늘 '보통 JS 값'만 넘긴다. 정수는 number, 리스트는 배열이다.
   그래서 lisp-host.js 는 이 내부 표현을 몰라도 된다.
   ───────────────────────────────────────────────────────── */

export class Sym {
  constructor(name) { this.name = name; this.key = name.toUpperCase() }
  toString() { return this.name }
}
// 심볼은 이름(key)으로 비교한다. 같은 객체여야 하는 것은 T 뿐이라, 표가 너무 커지면 비워도 된다.
// ((read (strcat …)) 를 반복하는 리습이 실행마다 표를 끝없이 키우지 않게 한다.)
const symbols = new Map()
export const sym = (n) => {
  const k = n.toUpperCase()
  if (k === 'T' && symbols.has('T')) return symbols.get('T')
  if (!symbols.has(k)) {
    if (symbols.size > 20000) { const t = symbols.get('T'); symbols.clear(); if (t) symbols.set('T', t) }
    symbols.set(k, new Sym(n))
  }
  return symbols.get(k)
}
export const T = sym('T')

export class Dot {
  constructor(car, cdr) { this.car = car; this.cdr = cdr }
}
export class Ename {
  constructor(id) { this.id = id }
}
// 세션 사본은 ID 목록만 복사한다. 조회 색인은 사본마다 필요할 때 한 번 만든다.
const selectionMembers = new WeakMap()
export class SelSet {
  constructor(ids) { this.ids = ids.slice() }
  has(id) {
    let members = selectionMembers.get(this)
    if (!members) { members = new Set(this.ids); selectionMembers.set(this, members) }
    return members.has(id)
  }
}
export class FileHandle {
  constructor(path, mode) { this.path = path; this.mode = mode; this.lines = []; this.read = 0; this.open = true }
}
export class LispError extends Error {}
/** 답의 형식이 틀린 것(점 자리에 글자 등). AutoCAD 는 이때 같은 질문을 다시 묻는다.
    그래서 *error* 나 vl-catch-all-apply 로 가지 않고, 화면이 답만 지우고 다시 묻는다. */
export class InputError extends LispError { constructor(message) { super(message); this.retry = true } }

/** 앞에 한 칸을 붙인 목록. 뒤 목록을 복사하지 않는다(O(1)). */
export class Cons {
  constructor(car, cdr) { this.car = car; this.cdr = cdr; this.len = 1 + listLength(cdr) }
}
/** 배열 목록의 뒤쪽 조각. (cdr 목록) 이 복사 없이 돌아가게 한다. */
export class View {
  constructor(arr, off) { this.arr = arr; this.off = off }
}

const isList = (v) => Array.isArray(v) || v instanceof Cons || v instanceof View
const isNil = (v) => v === null || v === undefined || (Array.isArray(v) && v.length === 0)
const truthy = (v) => !isNil(v)
const isNum = (v) => typeof v === 'number' || typeof v === 'bigint'
const isInt = (v) => typeof v === 'bigint'
function listLength(v) {
  if (isNil(v)) return 0
  if (Array.isArray(v)) return v.length
  if (v instanceof View) return v.arr.length - v.off
  if (v instanceof Cons) return v.len
  return 0
}
/** 어떤 모양의 목록이든 배열로 읽는다. 결과 배열은 절대 고치지 않는다(공유될 수 있다).
    칸마다 결과를 저장해 두지 않는다 — cdr 로 훑으며 member·last 를 부르는 흔한 관용구가
    칸마다 목록 사본을 남겨 메모리를 제곱으로 먹던 문제(n=2만에 1.7GB)를 막는다. */
export function toArray(v) {
  if (isNil(v)) return []
  if (Array.isArray(v)) return v
  if (v instanceof View) return v.arr.slice(v.off)
  if (v instanceof Cons) {
    const out = []
    let c = v
    while (c instanceof Cons) { out.push(c.car); c = c.cdr }
    if (Array.isArray(c)) for (let i = 0; i < c.length; i++) out.push(c[i])
    else if (c instanceof View) for (let i = c.off; i < c.arr.length; i++) out.push(c.arr[i])
    return out
  }
  throw new LispError('리스트가 필요합니다')
}
/** 복사하지 않고 차례로 훑는다. fn 이 true 를 돌려주면 멈추고 그 위치를 돌려준다(없으면 -1). */
function scan(v, fn) {
  let i = 0, c = v
  while (c instanceof Cons) { if (fn(c.car, i)) return i; i++; c = c.cdr }
  if (Array.isArray(c)) { for (let k = 0; k < c.length; k++, i++) if (fn(c[k], i)) return i }
  else if (c instanceof View) { for (let k = c.off; k < c.arr.length; k++, i++) if (fn(c.arr[k], i)) return i }
  return -1
}
const deepArray = (v) => (isList(v) ? toArray(v).map(deepArray)
  : v instanceof Dot ? new Dot(deepArray(v.car), deepArray(v.cdr)) : v)

/** 도면 어댑터로 넘길 값: 정수 → number, 목록 → 배열(새로 만든다). */
export function toHost(v) {
  if (typeof v === 'bigint') return Number(v)
  if (isList(v)) return toArray(v).map(toHost)
  if (v instanceof Dot) return new Dot(toHost(v.car), toHost(v.cdr))
  return v
}
// DXF 그룹 중 값이 정수인 것. (cdr (assoc 70 e)) 가 INT 여야 (logand …)·(itoa …)·(= … 1) 이 AutoCAD 와 같다.
const INT_GROUP = (c) => (c >= 60 && c <= 99) || (c >= 170 && c <= 179) || (c >= 270 && c <= 289)
  || (c >= 370 && c <= 389) || (c >= 400 && c <= 409) || (c >= 420 && c <= 429) || (c >= 440 && c <= 459)
  || (c >= 1060 && c <= 1071)
const inInt32 = (n) => n >= -2147483648 && n <= 2147483647
const asInt = (n) => (Number.isInteger(n) && inInt32(n) ? BigInt(n) : n)
/** 도면 어댑터가 돌려준 값: 그룹 코드와 정수 그룹 값은 INT 로 바꾼다. 좌표는 실수 그대로. */
export function fromHost(v) {
  if (Array.isArray(v)) return v.map(fromHost)
  if (v instanceof Dot) {
    const code = typeof v.car === 'number' ? v.car : null
    const car = code !== null ? asInt(code) : fromHost(v.car)
    const cdr = code !== null && INT_GROUP(code) && typeof v.cdr === 'number' ? asInt(v.cdr) : fromHost(v.cdr)
    return new Dot(car, cdr)
  }
  return v
}

const num = (v, who) => {
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  throw new LispError(`${who}: 숫자가 필요합니다. 받은 값: ${write(v)}`)
}
const int = (v, who) => {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v))
  throw new LispError(`${who}: 정수가 필요합니다. 받은 값: ${write(v)}`)
}
const wrap32 = (n) => BigInt.asIntN(32, n)
const str = (v, who) => {
  if (typeof v !== 'string') throw new LispError(`${who}: 문자열이 필요합니다. 받은 값: ${write(v)}`)
  return v
}
const pt = (v, who) => {
  const a = isList(v) ? toArray(v) : null
  if (!a || a.length < 2 || !isNum(a[0]) || !isNum(a[1]))
    throw new LispError(`${who}: 점(X Y)이 필요합니다`)
  return [Number(a[0]), Number(a[1]), isNum(a[2]) ? Number(a[2]) : 0]
}

export const car = (v) => {
  if (v instanceof Dot) return v.car
  if (isNil(v)) return null
  if (Array.isArray(v)) return v[0]
  if (v instanceof View) return v.arr[v.off]
  if (v instanceof Cons) return v.car
  throw new LispError(`car: 리스트가 필요합니다. 받은 값: ${write(v)}`)
}
export const cdr = (v) => {
  if (v instanceof Dot) return v.cdr
  if (isNil(v)) return null
  if (Array.isArray(v)) return v.length > 1 ? new View(v, 1) : null
  if (v instanceof View) return v.off + 1 < v.arr.length ? new View(v.arr, v.off + 1) : null
  if (v instanceof Cons) return v.cdr
  throw new LispError(`cdr: 리스트가 필요합니다. 받은 값: ${write(v)}`)
}
export const cons = (a, b) => {
  if (isNil(b)) return [a]
  if (isList(b)) return new Cons(a, b)
  return new Dot(a, b)
}
/** 목록의 i 번째 꼬리(member 가 돌려주는 것). 복사하지 않는다. */
const tailFrom = (v, i) => {
  if (i === 0) return v
  if (Array.isArray(v)) return i < v.length ? new View(v, i) : null
  if (v instanceof View) return v.off + i < v.arr.length ? new View(v.arr, v.off + i) : null
  let out = v
  for (let k = 0; k < i && out !== null; k++) out = cdr(out)
  return out
}

/* ── 읽기 (파서) ──────────────────────────────────────────── */

const MAX_INT = 2147483647
export function read(source) {
  source = String(source ?? '')
  const forms = []
  let i = 0
  const n = source.length
  const lineAt = (pos) => { let line = 1; for (let k = 0; k < pos && k < n; k++) if (source.charCodeAt(k) === 10) line++; return line }
  const fail = (message, pos = i, tail = '번째 줄') => { throw new LispError(`${message} (${lineAt(pos)}${tail})`) }
  const ws = () => {
    while (i < n) {
      const c = source[i]
      if (c === ';' && source[i + 1] === '|') {                 // Visual LISP 블록 주석 ;| … |;
        const end = source.indexOf('|;', i + 2)
        if (end < 0) fail('블록 주석 ;| 이 |; 로 닫히지 않았습니다', i)
        i = end + 2
      } else if (c === '#' && source[i + 1] === '|') {           // #| … |# 블록 주석
        const end = source.indexOf('|#', i + 2)
        if (end < 0) fail('블록 주석 #| 이 |# 로 닫히지 않았습니다', i)
        i = end + 2
      } else if (c === ';') { while (i < n && source[i] !== '\n') i++ }
      else if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\v' || c === '\u00a0' || c === '\u0000' || c === '\ufeff') i++
      else break
    }
  }
  const atom = (tok) => {
    if (/^[-+]?\d+$/.test(tok)) {
      const v = parseInt(tok, 10)
      return v >= -MAX_INT - 1 && v <= MAX_INT ? BigInt(v) : v   // 32비트를 넘는 정수 표기는 AutoLISP 처럼 실수가 된다
    }
    if (/^[-+]?(\d+\.\d*|\.\d+|\d+)(e[-+]?\d+)?$/i.test(tok)) return parseFloat(tok)
    if (tok.toUpperCase() === 'NIL') return null
    return sym(tok)
  }
  const escape = () => {
    const e = source[i + 1]
    if (e === undefined) { i++; return '' }
    if (e === 'n') { i += 2; return '\n' }
    if (e === 't') { i += 2; return '\t' }
    if (e === 'r') { i += 2; return '\r' }
    if (e === 'e') { i += 2; return '\u001b' }
    if (/[0-7]/.test(e)) {                                          // \nnn 8진수
      const m = source.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)[0]
      i += 1 + m.length
      return String.fromCharCode(parseInt(m, 8))
    }
    if ((e === 'U' || e === 'u') && source[i + 2] === '+') {       // \U+XXXX 유니코드
      const m = source.slice(i + 3, i + 7)
      if (/^[0-9a-fA-F]{4}$/.test(m)) { i += 7; return String.fromCharCode(parseInt(m, 16)) }
    }
    i += 2
    return e
  }
  function form() {
    ws()
    if (i >= n) return undefined
    const c = source[i]
    if (c === "'") {
      const at = i
      i++
      const q = form()
      if (q === undefined) fail("따옴표(') 뒤에 값이 없습니다", at)
      return [sym('quote'), q]
    }
    if (c === '(') {
      const start = i
      i++
      const items = []
      let dotted, hasDot = false
      for (;;) {
        ws()
        if (i >= n) fail('괄호가 닫히지 않았습니다', start, '번째 줄에서 연 괄호')
        if (source[i] === ')') { i++; break }
        if (source[i] === '.' && /[\s()"';]/.test(source[i + 1] || ' ')) {
          const at = i
          if (!items.length) fail('점 표기(.) 앞에 값이 없습니다', at)
          i++
          ws()
          if (i >= n || source[i] === ')') fail('점 표기(.) 뒤에 값이 없습니다', at)
          dotted = form(); hasDot = true
          ws()
          if (i >= n) fail('괄호가 닫히지 않았습니다', start, '번째 줄에서 연 괄호')
          if (source[i] !== ')') fail('점 표기(.) 뒤에는 값이 하나만 와야 합니다', i)
          i++
          break
        }
        items.push(form())
      }
      if (hasDot) {
        // (a . b) / (a b . c) / (a . (b c)) — 뒤가 목록이면 그냥 목록이다
        if (isNil(dotted)) return items
        if (isList(dotted)) return items.concat(toArray(dotted))
        let out = dotted
        for (let k = items.length - 1; k >= 0; k--) out = new Dot(items[k], out)
        return out
      }
      return items.length ? items : null
    }
    if (c === ')') fail('닫는 괄호가 남습니다')
    if (c === '"') {
      const start = i
      i++
      let out = ''
      while (i < n && source[i] !== '"') {
        if (source[i] === '\\') out += escape()
        else out += source[i++]
      }
      if (i >= n) fail('문자열의 닫는 따옴표(")가 없습니다', start, '번째 줄에서 시작한 문자열')
      i++
      return out
    }
    let tok = ''
    while (i < n && !/[\s()"';]/.test(source[i])) tok += source[i++]
    return atom(tok)
  }
  try {
    for (;;) {
      ws()
      if (i >= n) break
      const f = form()
      if (f === undefined) break
      forms.push(f)
    }
  } catch (e) {
    if (e instanceof RangeError) throw new LispError('괄호가 너무 깊게 겹쳐 있어 읽을 수 없습니다.')
    throw e
  }
  return forms
}

/* ── 출력 ─────────────────────────────────────────────────── */

/** AutoLISP 이 실수를 보여 주는 방식: 유효숫자 6자리, 1.0 · 0.333333 · 1.0e+008 */
export function formatReal(v) {
  if (v === 0) return '0.0'
  if (Number.isNaN(v)) return '-1.#IND'
  if (!Number.isFinite(v)) return v > 0 ? '1.#INF' : '-1.#INF'
  const m = Number(v.toPrecision(6))
  const e = Math.floor(Math.log10(Math.abs(m)))
  const trim = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '.0') : s + '.0')
  if (e < -4 || e >= 6) {
    const mantissa = trim((m / 10 ** e).toFixed(5))
    return mantissa + 'e' + (e < 0 ? '-' : '+') + String(Math.abs(e)).padStart(3, '0')
  }
  return trim(m.toFixed(Math.max(0, 5 - e)))
}
const quoteString = (s) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"'

/** 값을 글자로. escape=true 는 prin1(따옴표·이스케이프), false 는 princ(맨 바깥 문자열은 그대로). */
export function write(v, escape = true) {
  if (v === null || v === undefined) return 'nil'
  if (v === T) return 'T'
  if (v instanceof Sym) return v.name.toUpperCase()
  if (typeof v === 'string') return escape ? quoteString(v) : v
  if (typeof v === 'bigint') return String(v)
  if (typeof v === 'number') return formatReal(v)
  if (v instanceof Dot) {
    const parts = [write(v.car)]
    let rest = v.cdr
    while (rest instanceof Dot) { parts.push(write(rest.car)); rest = rest.cdr }
    if (isList(rest)) return '(' + parts.concat(toArray(rest).map(x => write(x))).join(' ') + ')'
    return '(' + parts.join(' ') + ' . ' + write(rest) + ')'
  }
  if (v instanceof Ename) return '<Entity name: ' + v.id + '>'
  if (v instanceof SelSet) return '<Selection set: ' + v.ids.length + '>'
  if (v instanceof FileHandle) return '#<file "' + v.path + '">'
  if (v instanceof Lambda) return '#<USUBR ' + String(v.name).toUpperCase() + '>'
  if (v instanceof CaughtError) return '#<%catch-all-apply-error%>'
  if (typeof v === 'function') return '#<SUBR ' + (v.lispName || '') + '>'
  if (isList(v)) return '(' + toArray(v).map(x => write(x)).join(' ') + ')'
  return String(v)
}
const display = (v) => write(v, false)

/* ── 환경 ─────────────────────────────────────────────────────
   AutoLISP 은 동적 범위다. 함수가 불리는 동안 그 함수의 인자·지역 변수가
   '전역 이름'을 잠시 덮고, 끝나면 되돌린다. 그래서 호출된 도우미 함수가
   부른 쪽의 지역 변수를 본다((defun f (x) (g)) (defun g () x)).
   이름표는 하나(global)뿐이고, 함수 호출이 값을 저장했다 되돌린다. */

class Env {
  constructor() { this.vars = new Map() }
  get(name) { return this.vars.get(String(name).toUpperCase()) }
  has(name) { return this.vars.has(String(name).toUpperCase()) }
  setExisting(name, value) {
    const k = String(name).toUpperCase()
    if (!this.vars.has(k)) return false
    this.vars.set(k, value)
    return true
  }
  define(name, value) { this.vars.set(String(name).toUpperCase(), value) }
}

class Lambda {
  constructor(params, locals, body, name) {
    this.params = params; this.locals = locals; this.body = body; this.name = name || 'lambda'
    this.keys = params.concat(locals).map(n => n.toUpperCase())
  }
}
class ExitSignal { constructor(value) { this.value = value } }
class CaughtError { constructor(message) { this.message = message } }
const UNBOUND = Symbol('unbound')

const fatal = (message) => { const e = new LispError(message); e.fatal = true; return e }
const isStackOverflow = (e) => e instanceof RangeError && /call stack|too much recursion/i.test(e.message || '')
// 문자열·배열이 자바스크립트 한도를 넘은 것((repeat 40 (setq s (strcat s s))) 같은 것). 영문 RangeError 를 그대로 보이지 않는다.
const isTooLarge = (e) => e instanceof RangeError && !isStackOverflow(e)
/** *error* 에 넘기지 않는 것: 입력 요청(화면이 물어야 함)·시간/단계 한도·자바스크립트 한도. */
/* 큰 도면 리습은 얼려 둔 원본 객체를 나눠 쓴다(lisp-panel.js runNative). 그 객체를 제자리에서 고치려 하면
   자바스크립트가 TypeError 를 낸다. 이것은 리습의 오류가 아니라 '전체 복사로 다시 돌라'는 신호이므로
   *error*·vl-catch-all-apply 가 삼키지 못하게 바깥으로 내보낸다. */
export const isCowViolation = (e) => e instanceof TypeError && /read[- ]only|not extensible|Cannot (assign|add|delete|define|redefine)|frozen/i.test(e?.message || '')
const notForHandler = (e) => needsInput(e) || e?.retry || e?.fatal || e instanceof RangeError || isCowViolation(e)
const needsInput = (e) => !!(e && e.ask)

/* ── 인터프리터 ───────────────────────────────────────────── */

export class Interpreter {
  constructor(host, options = {}) {
    this.host = host
    this.global = new Env()
    this.output = []
    this.commands = new Map()   // C:NAME -> Lambda
    this.steps = 0
    // 멈춤의 기준은 시간이다. 단계 수 한도는 정상적인 큰 반복(200만 회 등)을 끊지 않을 만큼 크게 둔다.
    this.maxSteps = options.maxSteps || 1_000_000_000
    // 화면 스레드에서 돌 때는 20초, 리습 전용 Worker 에서 돌 때는 패널이 60초로 늘린다(중지 버튼이 있다).
    this.timeLimitMs = options.timeLimitMs || 20_000
    this.catchDepth = 0         // vl-catch-all-apply 안에서는 *error* 를 부르지 않는다(그쪽이 잡는다)
    this.handledError = null    // *error* 처리기가 받아 끝낸 오류 문구
    this.startedAt = Date.now()
    this.depth = 0
    this.peakDepth = 0
    this.global.define('T', T)
    this.global.define('PI', Math.PI)
    this.global.define('PAUSE', String.fromCharCode(92))   // (command ... pause) — 사람이 화면에서 찍는 자리
    this.builtins = buildBuiltins(this)
  }

  /** MCP 세션은 기존 상태의 사본에서 실행하고 성공한 사본만 보관한다. 호스트·내장 함수는 이번 실행 것을 쓴다. */
  copyStateFrom(previous) {
    const seen = new Map(), pending = []
    const builtins = new Map(Object.entries(previous.builtins).map(([key, value]) => [value, this.builtins[key]]))
    const copy = value => {
      this.tick()
      if (!value || typeof value !== 'object') return typeof value === 'function' ? (builtins.get(value) || value) : value
      if (value instanceof Sym) return sym(value.name)
      if (seen.has(value)) return seen.get(value)
      const out = Array.isArray(value) ? [] : value instanceof Map ? new Map() : Object.create(Object.getPrototypeOf(value))
      seen.set(value, out)
      pending.push([value, out])
      return out
    }
    this.global.vars = copy(previous.global.vars)
    this.commands = copy(previous.commands)
    // 긴 Cons 목록은 엔진이 원래 지원한다. 재귀 호출로 복사하면 JS 스택이 먼저 넘는다.
    while (pending.length) {
      const [value, out] = pending.pop()
      if (value instanceof Map) for (const [key, item] of value) out.set(copy(key), copy(item))
      else for (const key of Object.keys(value)) out[key] = copy(value[key])
    }
  }

  print(text) {
    this.output.push(text)
    if (this.output.length > 20000) this.output.splice(0, 10000)
  }

  /** 모든 단계가 여기를 지난다. 시간 검사도 여기서 한다 — 예전에는 eval 에서만 검사해 (while T) 처럼
      한 바퀴에 단계가 둘씩 늘면 4096 배수를 늘 건너뛰어 시간 한도가 걸리지 않았다. */
  tick() {
    if (++this.steps > this.maxSteps) throw fatal('실행 단계가 너무 많아(10억 단계) 중지했습니다. 끝나지 않는 반복이 없는지 확인하세요.')
    if ((this.steps & 1023) === 0) this.checkTime()
  }

  checkTime() {
    if (Date.now() - this.startedAt > this.timeLimitMs)
      throw fatal(`실행 시간이 ${this.timeLimitMs >= 1000 ? Math.round(this.timeLimitMs / 1000) : (this.timeLimitMs / 1000).toFixed(1)}초를 넘어 중지했습니다. 끝나지 않는 반복이나 아주 큰 목록 처리가 없는지 확인하세요.`)
  }

  /** 자바스크립트 한도 오류(스택 넘침·너무 긴 문자열)를 한국어 오류로 바꾼다. */
  guard(fn) {
    try { return fn() }
    catch (e) {
      if (isStackOverflow(e)) {
        const depth = this.peakDepth
        this.depth = 0
        throw new LispError(`재귀(함수가 자기 자신을 부르는 것)가 너무 깊습니다(약 ${depth}단계에서 멈춤). 반복문(while·repeat·foreach)으로 바꾸거나 목록을 나눠 처리하세요.`)
      }
      if (isTooLarge(e)) throw fatal('문자열이나 목록이 너무 커져(프로그램 한도 초과) 중지했습니다. 끝없이 이어 붙이는 반복이 없는지 확인하세요.')
      throw e
    }
  }

  /** 파일 하나를 읽어 최상위 식을 차례로 돈다. 최상위 (exit) 는 그 파일만 멈춘다. */
  load(source) {
    return this.loadForms(read(source))
  }
  loadForms(forms) {
    return this.guard(() => {
      let last = null
      try { for (const f of forms) last = this.eval(f) }
      catch (e) {
        if (e instanceof ExitSignal) { this.exited = true; return null }
        // 최상위 식의 오류도 AutoCAD 처럼 *error* 에 알린다(입력 요청·시간 초과는 제외).
        if (!e?.lispHandled && !notForHandler(e)) this.callErrorHandler(e instanceof Error ? e.message : String(e))
        throw e
      }
      return last
    })
  }

  /** 리습에 *error* 가 정의돼 있으면 AutoCAD 처럼 오류 문구를 넘겨 부른다. */
  callErrorHandler(message) {
    const handler = this.global.get('*ERROR*')
    if (!(handler instanceof Lambda) || this.inErrorHandler) return false
    this.inErrorHandler = true
    try { this.apply(handler, [message]) }
    catch (e) { if (needsInput(e) || isCowViolation(e)) throw e }   // 처리기 안의 오류는 AutoCAD 처럼 삼킨다 — 얼린 원본을 고치려던 오류는 결과가 반쯤 적용되지 않게 그대로 올린다
    finally { this.inErrorHandler = false }
    return true
  }

  /** 오류가 난 그 자리(지역 변수가 아직 살아 있을 때)에서 *error* 를 부른다. 한 번만 부르고 표시해 둔다. */
  notifyError(e) {
    if (!e || e.lispHandled || this.catchDepth > 0 || this.inErrorHandler) return
    if (!(e instanceof ExitSignal) && notForHandler(e)) return
    if (!(this.global.get('*ERROR*') instanceof Lambda)) return      // 바깥 함수의 지역 *error* 가 있을 수 있어 표시는 하지 않는다
    this.callErrorHandler(e instanceof ExitSignal ? 'quit / exit abort' : (e instanceof Error ? e.message : String(e)))
    try { e.lispHandled = true } catch { }
  }

  /** 명령·식 실행의 바깥 틀. *error* 가 받아 끝낸 오류는 AutoCAD 처럼 '명령 끝' 으로 본다(오류 창을 띄우지 않는다). */
  run(body) {
    this.handledError = null
    try { return this.guard(body) }
    catch (e) {
      if (e instanceof ExitSignal) {
        this.exited = true
        if (!e.lispHandled) this.callErrorHandler('quit / exit abort')
        return null
      }
      if (needsInput(e) || e?.retry || isCowViolation(e)) throw e
      const message = e instanceof Error ? e.message : String(e)
      if (e?.lispHandled) { this.handledError = message; return null }
      // 스택 넘침은 풀린 뒤에야 처리기를 부를 수 있다(지역 변수는 이미 되돌아가 있다).
      if (!e?.fatal && this.callErrorHandler(message)) { this.handledError = message; return null }
      throw e
    }
  }

  callCommand(name) {
    const key = ('C:' + name).toUpperCase()
    const fn = this.commands.get(key) || this.global.get(key) || this.commands.get(String(name).toUpperCase())
    if (!(fn instanceof Lambda)) throw new LispError(`명령 ${name} 을(를) 찾을 수 없습니다. 파일이 로드되었는지 확인하세요.`)
    return this.run(() => this.apply(fn, []))
  }

  /** 명령창에 적은 (+ 1 2) 같은 식을 돈다. 마지막 식의 값을 돌려준다. */
  evaluate(source) {
    const forms = read(source)
    return this.run(() => { let last = null; for (const f of forms) last = this.eval(f); return last })
  }

  definedCommands() {
    return [...this.commands.keys()].filter(k => k.startsWith('C:')).map(k => k.slice(2))
  }

  symbolValue(s) {
    const v = this.global.vars.get(s.key)
    if (v !== undefined) return v
    const b = this.builtins[s.key]
    if (b) return b
    return null                                          // AutoLISP: 미정의 변수는 nil
  }

  eval(form) {
    // if·cond·progn 의 마지막 식은 새 자바스크립트 호출 없이 이 반복에서 이어 돈다(꼬리 위치).
    // 재귀 리습 한 단계가 쓰는 스택이 줄어 더 깊은 재귀를 허용한다.
    for (;;) {
    this.tick()
    if (form === null || form === undefined) return null
    const t = typeof form
    if (t === 'number' || t === 'string' || t === 'bigint') return form
    if (form instanceof Sym) return this.symbolValue(form)
    if (!Array.isArray(form)) {
      if (form instanceof Cons || form instanceof View) { form = deepArray(form); continue }
      return form                                         // Dot · Ename · 선택셋은 그 자체가 값
    }
    if (!form.length) return null
    const head = form[0]
    if (head instanceof Sym) {
      const key = head.key
      if (key === 'IF') { form = truthy(this.eval(form[1])) ? form[2] : (form.length > 3 ? form[3] : null); continue }
      if (key === 'PROGN') {
        if (form.length < 2) return null
        for (let k = 1; k < form.length - 1; k++) this.eval(form[k])
        form = form[form.length - 1]; continue
      }
      if (key === 'COND') {
        let next = null, found = false
        for (let k = 1; k < form.length && !found; k++) {
          const clause = form[k]
          if (!Array.isArray(clause) || !clause.length) continue
          const test = this.eval(clause[0])
          if (truthy(test)) {
            found = true
            if (clause.length === 1) return test
            for (let j = 1; j < clause.length - 1; j++) this.eval(clause[j])
            next = clause[clause.length - 1]
          }
        }
        if (!found) return null
        form = next; continue
      }
      const special = SPECIALS[head.key]
      if (special) return special.call(this, form)
      const fn = this.global.vars.get(head.key)
      if (!callable(fn)) {
        // 사용자가 같은 이름 변수를 nil 이나 숫자로 두었어도 기본 함수는 부를 수 있게 둔다(관대하게).
        const b = this.builtins[head.key]
        if (b) {
          const args = new Array(form.length - 1)
          for (let k = 1; k < form.length; k++) args[k - 1] = this.eval(form[k])
          return b(args)
        }
        if (fn === undefined || fn === null)
          throw new LispError(`함수 ${head.name.toUpperCase()} 이(가) 정의되지 않았습니다. 철자와 불러온 리습 파일을 확인하세요.`)
        throw new LispError(`${head.name.toUpperCase()} 은(는) 함수가 아닙니다. 값: ${write(fn)}`)
      }
      const args = new Array(form.length - 1)
      for (let k = 1; k < form.length; k++) args[k - 1] = this.eval(form[k])
      return this.apply(fn, args)
    }
    const fn = this.eval(head)
    const args = new Array(form.length - 1)
    for (let k = 1; k < form.length; k++) args[k - 1] = this.eval(form[k])
    return this.apply(fn, args)
    }
  }

  apply(fn, args) {
    if (fn instanceof Lambda) {
      const vars = this.global.vars, keys = fn.keys, np = fn.params.length
      const saved = new Array(keys.length)
      for (let k = 0; k < keys.length; k++) saved[k] = vars.has(keys[k]) ? vars.get(keys[k]) : UNBOUND
      for (let k = 0; k < keys.length; k++) vars.set(keys[k], k < np ? (k < args.length ? args[k] : null) : null)
      if (++this.depth > this.peakDepth) this.peakDepth = this.depth
      try {
        let out = null
        for (const b of fn.body) out = this.eval(b)
        return out
      } catch (e) {
        // 지역 변수를 되돌리기 전에 처리기를 부른다. (defun c:x (/ *error* os) (defun *error* …) …) 관용구가 이것에 기댄다.
        this.notifyError(e)
        throw e
      } finally {
        this.depth--
        for (let k = keys.length - 1; k >= 0; k--) {
          if (saved[k] === UNBOUND) vars.delete(keys[k]); else vars.set(keys[k], saved[k])
        }
      }
    }
    if (typeof fn === 'function') return fn(args)
    if (isList(fn)) {
      const form = deepArray(fn)
      if (form.length && form[0] instanceof Sym && ['LAMBDA', 'FUNCTION', 'QUOTE'].includes(form[0].key)) {
        // '(lambda (x) ...) 처럼 따옴표 붙은 형태를 그대로 호출하는 경우
        if (form[0].key === 'LAMBDA') return this.apply(SPECIALS.LAMBDA.call(this, form), args)
        return this.apply(this.eval(form[1]), args)
      }
    }
    if (fn instanceof Sym) {                      // (apply 'car ...) 처럼 심볼로 넘어온 경우
      const v = this.global.vars.get(fn.key)
      if (callable(v)) return this.apply(v, args)
      const b = this.builtins[fn.key]
      if (b) return b(args)
      throw new LispError(`함수 ${fn.key} 이(가) 정의되지 않았습니다. 철자와 불러온 리습 파일을 확인하세요.`)
    }
    throw new LispError('호출할 수 없는 값입니다: ' + write(fn))
  }
}
const callable = (v) => v instanceof Lambda || typeof v === 'function'
  || (Array.isArray(v) && v.length > 0 && v[0] instanceof Sym && v[0].key === 'LAMBDA')

/** (defun 이름 (인자 / 지역) …) 의 인자 목록을 나눈다. */
function splitArgs(argList) {
  const items = argList === null || argList === undefined ? [] : (isList(argList) ? toArray(argList) : [argList])
  const params = [], locals = []
  let seenSlash = false
  for (const a of items) {
    const t = a instanceof Sym ? a.name : String(a)
    if (t === '/') { seenSlash = true; continue }
    if (t.startsWith('/')) { seenSlash = true; if (t.length > 1) locals.push(t.slice(1)); continue }
    ;(seenSlash ? locals : params).push(t)
  }
  return { params, locals }
}

const SPECIALS = {
  QUOTE(form) { return form[1] === undefined ? null : form[1] },
  FUNCTION(form) { return form[1] instanceof Sym ? this.symbolValue(form[1]) : this.eval(form[1]) },
  IF(form) {
    if (truthy(this.eval(form[1]))) return this.eval(form[2])
    return form.length > 3 ? this.eval(form[3]) : null
  },
  COND(form) {
    for (let k = 1; k < form.length; k++) {
      const clause = form[k]
      if (!Array.isArray(clause) || !clause.length) continue
      const test = this.eval(clause[0])
      if (truthy(test)) {
        let out = test
        for (let j = 1; j < clause.length; j++) out = this.eval(clause[j])
        return out
      }
    }
    return null
  },
  PROGN(form) {
    let out = null
    for (let k = 1; k < form.length; k++) out = this.eval(form[k])
    return out
  },
  AND(form) {
    for (let k = 1; k < form.length; k++) if (!truthy(this.eval(form[k]))) return null
    return T
  },
  OR(form) {
    for (let k = 1; k < form.length; k++) if (truthy(this.eval(form[k]))) return T
    return null
  },
  WHILE(form) {
    let out = null
    for (;;) {
      this.tick()
      if (!truthy(this.eval(form[1]))) break
      for (let k = 2; k < form.length; k++) out = this.eval(form[k])
    }
    return out
  },
  REPEAT(form) {
    const count = this.eval(form[1])
    if (!isNum(count)) throw new LispError(`repeat: 반복 횟수는 정수여야 합니다. 받은 값: ${write(count)}`)
    const times = Math.trunc(Number(count))
    let out = null
    for (let c = 0; c < times; c++) {
      this.tick()
      for (let k = 2; k < form.length; k++) out = this.eval(form[k])
    }
    return out
  },
  FOREACH(form) {
    if (!(form[1] instanceof Sym)) throw new LispError('foreach: 변수 이름이 필요합니다')
    const key = form[1].key
    const items = toArray(this.eval(form[2]) ?? null)
    const vars = this.global.vars
    const saved = vars.has(key) ? vars.get(key) : UNBOUND
    let out = null
    try {
      for (const it of items) {
        this.tick()
        vars.set(key, it)
        for (let k = 3; k < form.length; k++) out = this.eval(form[k])
      }
    } finally { if (saved === UNBOUND) vars.delete(key); else vars.set(key, saved) }
    return out
  },
  SETQ(form) {
    let out = null
    for (let k = 1; k < form.length; k += 2) {
      const target = form[k]
      if (!(target instanceof Sym)) throw new LispError(`setq: 변수 이름이 필요합니다. 받은 값: ${write(target)}`)
      if (target === T) throw new LispError('T 는 바꿀 수 없는 상수입니다.')
      out = k + 1 < form.length ? this.eval(form[k + 1]) : null
      this.global.vars.set(target.key, out)
    }
    return out
  },
  DEFUN(form) {
    const nameSym = form[1]
    if (!(nameSym instanceof Sym)) throw new LispError('defun: 함수 이름이 필요합니다')
    const { params, locals } = splitArgs(form[2])
    const fn = new Lambda(params, locals, form.slice(3), nameSym.name)
    this.global.vars.set(nameSym.key, fn)
    if (nameSym.key.startsWith('C:')) this.commands.set(nameSym.key, fn)
    return nameSym
  },
  LAMBDA(form) {
    const { params, locals } = splitArgs(form[1])
    return new Lambda(params, locals, form.slice(2))
  },
  'VL-CATCH-ALL-APPLY'(form) {
    const fn = this.eval(form[1])
    const list = toArray(this.eval(form[2]) ?? null)
    const depth = this.depth
    this.catchDepth++
    try { return this.apply(fn, list) }
    catch (e) {
      // 입력 부족·시간 초과·메모리 한도는 리습이 잡을 수 있는 오류가 아니다. 화면이 질문하거나 실행을 멈춰야 한다.
      if (e instanceof ExitSignal || needsInput(e) || e?.retry || e?.fatal || isTooLarge(e) || isCowViolation(e)) throw e
      this.depth = depth
      if (isStackOverflow(e)) return new CaughtError('재귀가 너무 깊습니다')
      return new CaughtError(e instanceof Error ? e.message : String(e))
    }
    finally { this.catchDepth-- }
  },
}
SPECIALS['DEFUN-Q'] = SPECIALS.DEFUN

export { CaughtError, ExitSignal, Lambda, Env }

/* ── 기본 함수 ────────────────────────────────────────────── */

const gcdOf = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a }
/** AutoLISP wcmatch 패턴 → 정규식 목록. # 숫자 · @ 글자 · . 글자·숫자 아닌 것 · * ? [..] [~..] ~(부정) ` (이스케이프) , (또는) */
export function wildcard(pattern, flags = 'u') {
  const parts = []
  let cur = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '`' && i + 1 < pattern.length) { cur += c + pattern[++i]; continue }
    if (c === ',') { parts.push(cur); cur = ''; continue }
    cur += c
  }
  parts.push(cur)
  return parts.map(p => {
    let negate = false
    if (p[0] === '~') { negate = true; p = p.slice(1) }
    let re = ''
    for (let i = 0; i < p.length; i++) {
      const c = p[i]
      if (c === '`') { re += (p[i + 1] ?? '').replace(/[.*+?^${}()|[\]\\\-]/g, '\\$&'); i++ }
      else if (c === '#') re += '\\p{N}'
      else if (c === '@') re += '\\p{L}'
      else if (c === '.') re += '[^\\p{L}\\p{N}]'
      else if (c === '*') re += '.*'
      else if (c === '?') re += '.'
      else if (c === '[') {
        const end = p.indexOf(']', i + 1)
        if (end < 0) { re += '\\['; continue }
        let body = p.slice(i + 1, end)
        const not = body[0] === '~'
        if (not) body = body.slice(1)
        re += '[' + (not ? '^' : '') + body.replace(/[\\\]^]/g, '\\$&') + ']'
        i = end
      }
      else re += c.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')
    }
    return { negate, re: new RegExp('^' + re + '$', flags + 's') }
  })
}
export const wcmatch = (text, pattern, ignoreCase = false) =>
  wildcard(String(pattern), ignoreCase ? 'ui' : 'u').some(({ negate, re }) => re.test(String(text)) !== negate)

const REAL_VARS = new Set(['TEXTSIZE', 'DIMSCALE', 'LTSCALE', 'CELTSCALE', 'FILLETRAD', 'VIEWSIZE', 'AREA', 'PERIMETER',
  'DIMTXT', 'DIMASZ', 'DIMEXE', 'DIMEXO', 'DIMGAP', 'DIMDLI', 'DIMDLE', 'DIMLFAC', 'DIMTSZ', 'DIMCEN', 'DIMTM', 'DIMTP',
  'ELEVATION', 'THICKNESS', 'OFFSETDIST', 'PDSIZE', 'CHAMFERA', 'CHAMFERB', 'CHAMFERC', 'CHAMFERD', 'HPSCALE', 'HPANG',
  'SNAPANG', 'ANGBASE', 'TRACEWID', 'PLINEWID', 'CANNOSCALEVALUE', 'CMLSCALE', 'LENSLENGTH', 'USERR1', 'USERR2', 'USERR3',
  'USERR4', 'USERR5', 'TEXTHEIGHT', 'PSLTSCALE', 'MSLTSCALE', 'HPSPACE', 'DONUTID', 'DONUTOD', 'SKETCHINC', 'CMLSCALE'])
const UNITS = {
  MM: 1, MILLIMETER: 1, MILLIMETERS: 1, MILLIMETRE: 1, CM: 10, CENTIMETER: 10, CENTIMETERS: 10, M: 1000, METER: 1000, METERS: 1000,
  METRE: 1000, KM: 1e6, KILOMETER: 1e6, KILOMETERS: 1e6, IN: 25.4, INCH: 25.4, INCHES: 25.4, FT: 304.8, FOOT: 304.8, FEET: 304.8,
  YD: 914.4, YARD: 914.4, YARDS: 914.4, MILE: 1609344, MILES: 1609344,
}
const ANGLE_UNITS = { DEGREE: 180 / Math.PI, DEGREES: 180 / Math.PI, DEG: 180 / Math.PI, RADIAN: 1, RADIANS: 1, RAD: 1, GRAD: 200 / Math.PI, GRADS: 200 / Math.PI }

function buildBuiltins(interp) {
  const B = {}
  const def = (names, fn) => { for (const n of names.split(' ')) { const k = n.toUpperCase(); if (!fn.lispName) fn.lispName = k; B[k] = fn } }
  const H = () => interp.host
  const both = (a, b) => isInt(a) && isInt(b)

  // 산술 — 정수끼리는 정수(32비트), 하나라도 실수면 실수
  const add = (x, y) => (both(x, y) ? wrap32(x + y) : Number(x) + Number(y))
  const sub = (x, y) => (both(x, y) ? wrap32(x - y) : Number(x) - Number(y))
  const mul = (x, y) => (both(x, y) ? wrap32(x * y) : Number(x) * Number(y))
  const div = (x, y) => {
    if (Number(y) === 0) throw new LispError('0으로 나눌 수 없습니다')
    return both(x, y) ? wrap32(x / y) : Number(x) / Number(y)
  }
  const numeric = (v, who) => { if (!isNum(v)) num(v, who); return v }
  def('+', a => a.reduce((s, v) => add(s, numeric(v, '+')), 0n))
  def('-', a => (a.length === 0 ? 0n : a.length === 1 ? sub(isInt(a[0]) ? 0n : 0, numeric(a[0], '-')) : a.slice(1).reduce((s, v) => sub(s, numeric(v, '-')), numeric(a[0], '-'))))
  def('*', a => a.reduce((s, v) => mul(s, numeric(v, '*')), 1n))
  def('/', a => (a.length === 0 ? 0n : a.length === 1 ? numeric(a[0], '/') : a.slice(1).reduce((s, v) => div(s, numeric(v, '/')), numeric(a[0], '/'))))
  def('1+', a => add(numeric(a[0], '1+'), 1n))
  def('1-', a => sub(numeric(a[0], '1-'), 1n))
  def('abs', a => { const v = numeric(a[0], 'abs'); return isInt(v) ? wrap32(v < 0n ? -v : v) : Math.abs(v) })
  const pick = (a, who, better) => {
    if (!a.length) throw new LispError(`${who}: 숫자가 필요합니다`)
    const real = a.some(v => !isInt(numeric(v, who)))
    let best = a[0]
    for (const v of a) if (better(Number(v), Number(best))) best = v
    return real ? Number(best) : best
  }
  def('max', a => pick(a, 'max', (x, y) => x > y))
  def('min', a => pick(a, 'min', (x, y) => x < y))
  def('rem', a => a.slice(1).reduce((s, v) => {
    numeric(v, 'rem')
    if (Number(v) === 0) throw new LispError('0으로 나눌 수 없습니다')
    return both(s, v) ? s % v : Number(s) % Number(v)
  }, numeric(a[0], 'rem')))
  def('expt', a => {
    const x = numeric(a[0], 'expt'), y = numeric(a[1], 'expt')
    if (both(x, y) && y >= 0n && y <= 62n) return wrap32(x ** y)
    if (both(x, y) && y > 62n) return wrap32(x ** 62n) === 0n ? 0n : wrap32(x ** (y % 64n))   // 32비트로 감긴 값(대개 0)
    if (both(x, y) && y < 0n) {                     // 정수의 음수 거듭제곱은 정수 나눗셈이라 0 (1·-1 제외)
      if (x === 0n) throw new LispError('0으로 나눌 수 없습니다')
      return x === 1n ? 1n : x === -1n ? ((-y) % 2n === 0n ? 1n : -1n) : 0n
    }
    return Math.pow(Number(x), Number(y))
  })
  def('sqrt', a => { const v = num(a[0], 'sqrt'); if (v < 0) throw new LispError('sqrt: 음수의 제곱근은 없습니다'); return Math.sqrt(v) })
  def('sin', a => Math.sin(num(a[0], 'sin')))
  def('cos', a => Math.cos(num(a[0], 'cos')))
  def('atan', a => (a.length > 1 ? Math.atan2(num(a[0], 'atan'), num(a[1], 'atan')) : Math.atan(num(a[0], 'atan'))))
  def('exp', a => Math.exp(num(a[0], 'exp')))
  def('log', a => { const v = num(a[0], 'log'); if (v <= 0) throw new LispError('log: 0보다 큰 수가 필요합니다'); return Math.log(v) })
  def('float', a => num(a[0], 'float'))
  def('fix', a => { const v = numeric(a[0], 'fix'); if (isInt(v)) return v; const t = Math.trunc(v); return Math.abs(t) <= MAX_INT ? BigInt(t) : t })
  def('gcd', a => gcdOf(int(a[0], 'gcd'), int(a[1], 'gcd')))
  def('logand', a => (a.length ? a.reduce((s, v) => s & int(v, 'logand'), -1n) : 0n))
  def('logior', a => a.reduce((s, v) => s | int(v, 'logior'), 0n))
  def('~', a => wrap32(~int(a[0], '~')))
  def('lsh', a => { const v = int(a[0], 'lsh'), n = Number(a.length > 1 ? int(a[1], 'lsh') : 0n); return wrap32(n >= 0 ? v << BigInt(n) : BigInt.asUintN(32, v) >> BigInt(-n)) })
  def('boole', a => {
    const op = Number(int(a[0], 'boole'))
    return a.slice(2).reduce((s, v) => {
      const y = int(v, 'boole')
      let r = 0n
      if (op & 1) r |= ~s & ~y
      if (op & 2) r |= ~s & y
      if (op & 4) r |= s & ~y
      if (op & 8) r |= s & y
      return wrap32(r)
    }, int(a[1], 'boole'))
  })
  const cmp = (f, loose) => (a) => {
    for (let i = 0; i + 1 < a.length; i++) {
      const x = a[i], y = a[i + 1]
      let ok
      if (typeof x === 'string' && typeof y === 'string') ok = f(x < y ? -1 : x > y ? 1 : 0, 0)
      else if (isNum(x) && isNum(y)) ok = f(Number(x), Number(y))
      else if (loose) ok = f(eqv(x, y) ? 0 : 1, 0)   // = / /= 는 종류가 달라도 예외 없이 비교
      else ok = f(num(x, 'compare'), num(y, 'compare'))
      if (!ok) return null
    }
    return T
  }
  def('=', cmp((x, y) => x === y, true))
  def('/=', cmp((x, y) => x !== y, true))
  def('<', cmp((x, y) => x < y))
  def('>', cmp((x, y) => x > y))
  def('<=', cmp((x, y) => x <= y))
  def('>=', cmp((x, y) => x >= y))

  // 술어
  function eqv(x, y) {
    if (x === y) return true
    if (isNum(x) && isNum(y)) return Number(x) === Number(y)
    if (x instanceof Sym && y instanceof Sym) return x.key === y.key
    if (x instanceof Ename && y instanceof Ename) return x.id === y.id
    return false
  }
  function deepEq(x, y, fuzz = 0) {
    if (fuzz > 0 && isNum(x) && isNum(y)) return Math.abs(Number(x) - Number(y)) <= fuzz
    if (eqv(x, y)) return true
    if (isNil(x) && isNil(y)) return true
    if (typeof x === 'string' || typeof y === 'string') return false
    if (x instanceof Dot && y instanceof Dot) return deepEq(x.car, y.car, fuzz) && deepEq(x.cdr, y.cdr, fuzz)
    if (x instanceof SelSet && y instanceof SelSet) return x.ids.length === y.ids.length && x.ids.every((v, i) => v === y.ids[i])
    // (10 . (x y z)) 와 (10 x y z) 는 같은 목록이다
    const lx = x instanceof Dot && isList(x.cdr) ? cons(x.car, x.cdr) : x
    const ly = y instanceof Dot && isList(y.cdr) ? cons(y.car, y.cdr) : y
    if (isList(lx) && isList(ly)) {
      const ax = toArray(lx), ay = toArray(ly)
      return ax.length === ay.length && ax.every((v, i) => deepEq(v, ay[i], fuzz))
    }
    return false
  }
  interp.equal = deepEq
  def('eq', a => (a[0] === a[1] || (isNil(a[0]) && isNil(a[1])) || (a[0] instanceof Ename && a[1] instanceof Ename && a[0].id === a[1].id)
    || (a[0] instanceof Sym && a[1] instanceof Sym && a[0].key === a[1].key) ? T : null))
  def('equal', a => (deepEq(a[0], a[1], a.length > 2 ? num(a[2], 'equal') : 0) ? T : null))
  def('null not', a => (isNil(a[0]) ? T : null))
  def('boundp', a => {
    const s = a[0]
    if (!(s instanceof Sym)) return null
    const v = interp.global.vars.get(s.key)
    return (v !== undefined && v !== null) || interp.builtins[s.key] ? T : null
  })
  def('numberp', a => (isNum(a[0]) ? T : null))
  def('listp', a => (isNil(a[0]) || isList(a[0]) || a[0] instanceof Dot ? T : null))
  def('vl-consp', a => ((isList(a[0]) && !isNil(a[0])) || a[0] instanceof Dot ? T : null))
  def('atom', a => ((isList(a[0]) && !isNil(a[0])) || a[0] instanceof Dot ? null : T))
  def('minusp', a => (isNum(a[0]) && Number(a[0]) < 0 ? T : null))
  def('zerop', a => (isNum(a[0]) && Number(a[0]) === 0 ? T : null))
  def('vl-symbolp', a => (a[0] instanceof Sym ? T : null))
  def('vl-stringp', a => (typeof a[0] === 'string' ? T : null))
  def('type', a => {
    const v = a[0]
    if (isNil(v)) return null
    if (typeof v === 'bigint') return sym('INT')
    if (typeof v === 'number') return sym('REAL')
    if (typeof v === 'string') return sym('STR')
    if (v instanceof Sym) return sym('SYM')
    if (v instanceof Ename) return sym('ENAME')
    if (v instanceof SelSet) return sym('PICKSET')
    if (v instanceof FileHandle) return sym('FILE')
    if (v instanceof Lambda) return sym('USUBR')
    if (typeof v === 'function') return sym('SUBR')
    if (v instanceof CaughtError) return sym('VL-CATCH-ALL-APPLY-ERROR')
    return sym('LIST')
  })

  // 리스트
  def('car', a => car(a[0]))
  def('cdr', a => cdr(a[0]))
  for (const path of ['aa', 'ad', 'da', 'dd', 'aaa', 'aad', 'ada', 'add', 'daa', 'dad', 'dda', 'ddd', 'addd', 'dddd']) {
    // caddr = car(cdr(cdr x)) — 이름의 오른쪽 글자부터 적용한다
    def('c' + path + 'r', a => { let v = a[0]; for (let k = path.length - 1; k >= 0; k--) v = path[k] === 'a' ? car(v) : cdr(v); return v })
  }
  def('cons', a => cons(a[0], a[1]))
  def('set', a => {
    if (!(a[0] instanceof Sym)) throw new LispError(`set: 변수 이름(심볼)이 필요합니다. 받은 값: ${write(a[0])}`)
    if (a[0] === T) throw new LispError('T 는 바꿀 수 없는 상수입니다.')
    interp.global.vars.set(a[0].key, a[1] ?? null)
    return a[1] ?? null
  })
  def('list', a => (a.length ? a : null))
  def('vl-list*', a => {
    if (!a.length) return null
    let out = a[a.length - 1]
    for (let k = a.length - 2; k >= 0; k--) out = cons(a[k], out)
    return out
  })
  def('length', a => {
    if (isNil(a[0])) return 0n
    if (!isList(a[0])) throw new LispError(`length: 리스트가 필요합니다. 받은 값: ${write(a[0])}`)
    return BigInt(listLength(a[0]))
  })
  def('vl-list-length', a => (isNil(a[0]) ? 0n : isList(a[0]) ? BigInt(listLength(a[0])) : null))
  def('nth', a => {
    const i = Number(int(a[0], 'nth')); const l = a[1]
    if (!isList(l) || i < 0) return null
    let hit = null
    scan(l, (v, k) => { if (k === i) { hit = v; return true } return false })
    return hit
  })
  def('last', a => { if (!isList(a[0])) return a[0] instanceof Dot ? a[0].cdr : null; let out = null; scan(a[0], v => { out = v; return false }); return out })
  def('reverse', a => (isList(a[0]) ? toArray(a[0]).slice().reverse() : a[0]))
  def('append', a => {
    const out = []
    for (const l of a) { if (isNil(l)) continue; if (isList(l)) { const arr = toArray(l); for (let k = 0; k < arr.length; k++) out.push(arr[k]) } else out.push(l) }
    return out.length ? out : null
  })
  def('member', a => {
    const l = a[1]
    if (!isList(l)) return null
    const i = scan(l, v => deepEq(v, a[0]))
    return i < 0 ? null : tailFrom(l, i)
  })
  const memberIf = (want) => (a) => {
    const l = a[1]
    if (!isList(l)) return null
    const i = scan(l, v => truthy(interp.apply(a[0], [v])) === want)
    return i < 0 ? null : tailFrom(l, i)
  }
  def('vl-member-if', memberIf(true))
  def('vl-member-if-not', memberIf(false))
  def('assoc', a => {
    const l = a[1], key = a[0]
    if (!isList(l)) return null
    // (assoc 10 e) 처럼 숫자 키는 '둘 다 숫자이고 값이 같다' 가 deepEq 와 같은 결과다. 큰 도면에서 수백만 번 불려 바로 비교한다.
    const numeric = isNum(key), wanted = numeric ? Number(key) : 0
    let hit = null
    scan(l, item => {
      const k = item instanceof Dot ? item.car : (isList(item) && !isNil(item) ? car(item) : undefined)
      if (k !== undefined && (numeric ? isNum(k) && Number(k) === wanted : deepEq(k, key))) { hit = item; return true }
      return false
    })
    return hit
  })
  def('subst', a => {
    const [neu, old, l] = a
    if (!isList(l)) return l
    return toArray(l).map(v => (deepEq(v, old) ? neu : v))
  })
  def('vl-position', a => {
    const l = a[1]
    if (!isList(l)) return null
    const i = scan(l, v => deepEq(v, a[0]))
    return i < 0 ? null : BigInt(i)
  })
  def('mapcar', a => {
    const fn = a[0]
    const lists = a.slice(1).map(l => (isNil(l) ? [] : isList(l) ? toArray(l) : [l]))
    const n = lists.length ? Math.min(...lists.map(l => l.length)) : 0
    const out = new Array(n)
    for (let i = 0; i < n; i++) out[i] = interp.apply(fn, lists.map(l => l[i]))
    return n ? out : null
  })
  const listArg = (v) => (isNil(v) ? [] : isList(v) ? toArray(v) : null)
  def('vl-remove', a => { const l = listArg(a[1]); if (!l) return a[1]; const out = l.filter(v => !deepEq(v, a[0])); return out.length ? out : null })
  def('vl-remove-if', a => { const l = listArg(a[1]); if (!l) return a[1]; const out = l.filter(v => !truthy(interp.apply(a[0], [v]))); return out.length ? out : null })
  def('vl-remove-if-not', a => { const l = listArg(a[1]); if (!l) return a[1]; const out = l.filter(v => truthy(interp.apply(a[0], [v]))); return out.length ? out : null })
  def('vl-some', a => {
    const lists = a.slice(1).map(l => listArg(l) || [])
    const n = lists.length ? Math.min(...lists.map(l => l.length)) : 0
    for (let i = 0; i < n; i++) { const r = interp.apply(a[0], lists.map(l => l[i])); if (truthy(r)) return r }
    return null
  })
  def('vl-every', a => {
    const lists = a.slice(1).map(l => listArg(l) || [])
    const n = lists.length ? Math.min(...lists.map(l => l.length)) : 0
    for (let i = 0; i < n; i++) if (!truthy(interp.apply(a[0], lists.map(l => l[i])))) return null
    return T
  })
  const order = (fn) => (x, y) => (truthy(interp.apply(fn, [x, y])) ? -1 : truthy(interp.apply(fn, [y, x])) ? 1 : 0)
  def('vl-sort', a => { const l = listArg(a[0]); if (!l) return a[0]; const out = l.slice().sort(order(a[1])); return out.length ? out : null })
  def('vl-sort-i', a => {
    const l = listArg(a[0])
    if (!l || !l.length) return null
    const cmpItems = order(a[1])
    return l.map((v, i) => i).sort((x, y) => cmpItems(l[x], l[y])).map(i => BigInt(i))
  })
  def('acad_strlsort', a => { const l = listArg(a[0]); if (!l) return null; if (!l.every(v => typeof v === 'string')) return null; return l.slice().sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)) })
  def('apply', a => interp.apply(a[0], listArg(a[1]) || [a[1]]))
  def('eval', a => interp.eval(deepArray(a[0])))
  def('vl-catch-all-error-p', a => (a[0] instanceof CaughtError ? T : null))
  def('vl-catch-all-error-message', a => (a[0] instanceof CaughtError ? a[0].message : ''))

  // 문자열
  // + 로 잇는다. join 은 매번 전체를 복사해서 문자열을 계속 늘리는 반복이 제곱으로 느려진다.
  def('strcat', a => { let out = ''; for (const v of a) out += v === null ? '' : typeof v === 'string' ? v : display(v); return out })
  def('strlen', a => BigInt(a.reduce((s, v) => s + str(v, 'strlen').length, 0)))
  def('substr', a => {
    const s = str(a[0], 'substr'); const start = Math.max(1, Number(int(a[1], 'substr')))
    const len = a.length > 2 && !isNil(a[2]) ? Math.max(0, Number(int(a[2], 'substr'))) : undefined
    return len === undefined ? s.slice(start - 1) : s.substr(start - 1, len)
  })
  def('strcase', a => (a.length > 1 && truthy(a[1]) ? str(a[0], 'strcase').toLowerCase() : str(a[0], 'strcase').toUpperCase()))
  def('itoa', a => String(int(a[0], 'itoa')))
  // 범위를 넘는 글자는 감지 않고 끝값으로 맞춘다(AutoCAD 와 같음).
  def('atoi', a => { const m = str(a[0], 'atoi').trim().match(/^[-+]?\d+/); if (!m) return 0n; const v = BigInt(m[0]); return v > 2147483647n ? 2147483647n : v < -2147483648n ? -2147483648n : v })
  def('atof', a => { const m = str(a[0], 'atof').trim().match(/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i); return m ? parseFloat(m[0]) : 0 })
  def('chr', a => String.fromCodePoint(Number(int(a[0], 'chr'))))
  def('ascii', a => BigInt(str(a[0], 'ascii').codePointAt(0) || 0))
  def('vl-string->list', a => { const out = [...str(a[0], 'vl-string->list')].map(ch => BigInt(ch.codePointAt(0))); return out.length ? out : null })
  def('vl-list->string', a => (listArg(a[0]) || []).map(c => String.fromCodePoint(Number(int(c, 'vl-list->string')))).join(''))
  def('vl-string-elt', a => {
    const s = str(a[0], 'vl-string-elt'), i = Number(int(a[1], 'vl-string-elt'))
    if (i < 0 || i >= s.length) throw new LispError('vl-string-elt: 위치가 문자열 밖입니다')
    return BigInt(s.charCodeAt(i))
  })
  def('vl-string-mismatch', a => {
    let s1 = str(a[0], 'vl-string-mismatch'), s2 = str(a[1], 'vl-string-mismatch')
    s1 = s1.slice(a.length > 2 && isNum(a[2]) ? Number(a[2]) : 0); s2 = s2.slice(a.length > 3 && isNum(a[3]) ? Number(a[3]) : 0)
    if (a.length > 4 && truthy(a[4])) { s1 = s1.toUpperCase(); s2 = s2.toUpperCase() }
    let i = 0
    while (i < s1.length && i < s2.length && s1[i] === s2[i]) i++
    return BigInt(i)
  })
  const LUPREC = () => { try { const v = H()?.getvar?.('LUPREC'); return isNum(v) ? Number(v) : 4 } catch { return 4 } }
  def('rtos', a => {
    const v = num(a[0], 'rtos')
    const mode = a.length > 1 && isNum(a[1]) ? Number(a[1]) : 2
    const prec = Math.max(0, Math.min(15, a.length > 2 && isNum(a[2]) ? Number(a[2]) : LUPREC()))
    if (mode === 1) return v.toExponential(prec).replace(/e([+-])(\d)$/, 'E$10$2').replace('e', 'E')
    return v.toFixed(prec)
  })
  def('angtos', a => {
    // AutoCAD 처럼 각도를 0 이상 한 바퀴 미만으로 맞춘 뒤 쓴다: (angtos -1.5708) → "270"
    const turn = Math.PI * 2
    let v = num(a[0], 'angtos') % turn
    if (v < 0) v += turn
    if (Math.abs(v - turn) < 1e-12) v = 0
    const mode = a.length > 1 && isNum(a[1]) ? Number(a[1]) : 0
    const prec = Math.max(0, Math.min(8, a.length > 2 && isNum(a[2]) ? Number(a[2]) : 0))
    const deg = v * 180 / Math.PI
    const dms = (d) => {                                   // 도·분·초: 45d30'15"
      let whole = Math.floor(d + 1e-9), minutes = (d - whole) * 60, m = Math.floor(minutes + 1e-9), s = (minutes - m) * 60
      if (prec <= 2) { s = 0; if (prec === 0) m = Math.round(minutes); if (m === 60) { whole++; m = 0 } }
      if (prec === 0) return `${whole}d`
      if (prec <= 2) return `${whole}d${m}'`
      const sec = s.toFixed(Math.max(0, prec - 4))
      return `${whole}d${m}'${sec}"`
    }
    if (mode === 1) return dms(deg)
    if (mode === 2) return (v * 200 / Math.PI).toFixed(prec) + 'g'
    if (mode === 3) return v.toFixed(prec) + 'r'
    if (mode === 4) {                                     // 측량 방식: N 45d E
      const bearing = ((90 - deg) % 360 + 360) % 360      // 북에서 시계 방향
      if (Math.abs(bearing) < 1e-9) return 'N'
      if (Math.abs(bearing - 90) < 1e-9) return 'E'
      if (Math.abs(bearing - 180) < 1e-9) return 'S'
      if (Math.abs(bearing - 270) < 1e-9) return 'W'
      const ns = bearing < 90 || bearing > 270 ? 'N' : 'S', ew = bearing < 180 ? 'E' : 'W'
      const off = ns === 'N' ? (ew === 'E' ? bearing : 360 - bearing) : (ew === 'E' ? 180 - bearing : bearing - 180)
      return `${ns} ${dms(off)} ${ew}`
    }
    return deg.toFixed(prec)
  })
  def('distof', a => { const t = str(a[0], 'distof').trim(); return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t) ? parseFloat(t) : null })
  def('angtof', a => {
    const t = str(a[0], 'angtof').trim(), mode = a.length > 1 && isNum(a[1]) ? Number(a[1]) : 0
    const m = t.match(/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?[dDrRgG]?$/)
    if (!m) return null
    const v = parseFloat(t)
    return mode === 3 ? v : mode === 2 ? v * Math.PI / 200 : v * Math.PI / 180
  })
  def('cvunit', a => {
    const v = a[0], from = String(a[1] ?? '').trim().toUpperCase(), to = String(a[2] ?? '').trim().toUpperCase()
    const scale = UNITS[from] && UNITS[to] ? UNITS[from] / UNITS[to] : ANGLE_UNITS[from] && ANGLE_UNITS[to] ? ANGLE_UNITS[to] / ANGLE_UNITS[from] : null
    if (scale === null) return null
    if (isNum(v)) return Number(v) * scale
    if (isList(v)) return toArray(v).map(x => num(x, 'cvunit') * scale)
    return null
  })
  def('read', a => {
    const forms = read(str(a[0], 'read'))
    return forms.length ? forms[0] : null
  })
  def('vl-princ-to-string', a => display(a[0]))
  def('vl-prin1-to-string', a => write(a[0]))
  def('vl-symbol-name', a => (a[0] instanceof Sym ? a[0].name.toUpperCase() : str(a[0], 'vl-symbol-name')))
  def('vl-symbol-value', a => (a[0] instanceof Sym ? interp.symbolValue(a[0]) : null))
  def('wcmatch', a => (wcmatch(str(a[0], 'wcmatch'), str(a[1], 'wcmatch')) ? T : null))
  def('snvalid', a => (/^[^<>\/\\":;?*|,=`]+$/.test(str(a[0], 'snvalid')) ? T : null))
  def('vl-string-search', a => {
    const i = str(a[1], 'vl-string-search').indexOf(str(a[0], 'vl-string-search'), a.length > 2 ? Number(int(a[2], 'vl-string-search')) : 0)
    return i < 0 ? null : BigInt(i)
  })
  def('vl-string-subst', a => {
    const [neu, old, s] = [str(a[0], 'vl-string-subst'), str(a[1], 'vl-string-subst'), str(a[2], 'vl-string-subst')]
    const i = s.indexOf(old, a.length > 3 ? Number(int(a[3], 'vl-string-subst')) : 0)
    return i < 0 ? s : s.slice(0, i) + neu + s.slice(i + old.length)
  })
  def('vl-string-translate', a => {
    const from = str(a[0], 'vl-string-translate'), to = str(a[1], 'vl-string-translate'), s = str(a[2], 'vl-string-translate')
    let out = ''
    for (const ch of s) { const i = from.indexOf(ch); out += i >= 0 && i < to.length ? to[i] : ch }
    return out
  })
  def('vl-string-trim', a => {
    const set = str(a[0], 'vl-string-trim'), s = str(a[1], 'vl-string-trim')
    let b = 0, e = s.length
    while (b < e && set.includes(s[b])) b++
    while (e > b && set.includes(s[e - 1])) e--
    return s.slice(b, e)
  })
  def('vl-string-left-trim', a => {
    const set = str(a[0], 'vl-string-left-trim'), s = str(a[1], 'vl-string-left-trim')
    let b = 0
    while (b < s.length && set.includes(s[b])) b++
    return s.slice(b)
  })
  def('vl-string-right-trim', a => {
    const set = str(a[0], 'vl-string-right-trim'), s = str(a[1], 'vl-string-right-trim')
    let e = s.length
    while (e > 0 && set.includes(s[e - 1])) e--
    return s.slice(0, e)
  })
  def('vl-string-position', a => {
    const ch = String.fromCharCode(Number(int(a[0], 'vl-string-position')))
    const s = str(a[1], 'vl-string-position')
    const from = a.length > 2 && isNum(a[2]) ? Number(a[2]) : 0
    const back = a.length > 3 && truthy(a[3])
    const i = back ? s.lastIndexOf(ch) : s.indexOf(ch, from)
    return i < 0 ? null : BigInt(i)
  })
  const fileName = (v, who) => str(v, who).replace(/\//g, '\\')
  def('vl-filename-base', a => { const n = fileName(a[0], 'vl-filename-base').split('\\').pop(); const d = n.lastIndexOf('.'); return d > 0 ? n.slice(0, d) : n })
  def('vl-filename-extension', a => { const n = fileName(a[0], 'vl-filename-extension').split('\\').pop(); const d = n.lastIndexOf('.'); return d > 0 ? n.slice(d) : null })
  def('vl-filename-directory', a => { const p = fileName(a[0], 'vl-filename-directory'); const d = p.lastIndexOf('\\'); return d >= 0 ? p.slice(0, d) : '' })
  let temp = 0
  def('vl-filename-mktemp', a => `바른CAD임시\\${(a.length && typeof a[0] === 'string' ? a[0] : 'lisp$')}${String(++temp).padStart(3, '0')}.tmp`)

  // 출력·흐름
  def('princ', a => { if (a.length && a[0] !== null) interp.print(display(a[0])); else if (a.length) interp.print('nil'); return a.length ? a[0] : null })
  def('prin1', a => { if (a.length) interp.print(write(a[0])); return a.length ? a[0] : null })
  def('print', a => { if (a.length) interp.print('\n' + write(a[0]) + ' '); return a.length ? a[0] : null })
  def('terpri', () => { interp.print('\n'); return null })
  def('prompt', a => { interp.print(display(a[0])); return null })
  def('alert', a => { interp.print('\n[알림] ' + display(a[0])); (interp.alerts ||= []).push(display(a[0])); return null })
  def('exit quit', a => { throw new ExitSignal(a.length ? a[0] : null) })
  def('vl-exit-with-error', a => { throw new LispError(display(a[0])) })
  def('vl-exit-with-value', a => { throw new ExitSignal(a[0]) })
  def('vl-load-com vl-bt gc setfunhelp textpage vlax-release-object', () => null)
  def('ver', () => 'Visual LISP 2.0 (ko) · 바른 CAD 자체 엔진')
  def('vports', () => [[1n, [0, 0], [1, 1]]])
  def('xdroom', () => 16383n)
  def('xdsize', a => BigInt(Math.min(16383, display(a[0]).length * 2)))
  def('regapp', a => (typeof a[0] === 'string' ? a[0] : null))
  def('tablet menucmd startapp namedobjdict dictsearch dictnext vl-directory-files vl-registry-read vl-registry-write', () => null)

  // 기하
  def('polar', a => {
    const p = pt(a[0], 'polar'); const ang = num(a[1], 'polar'); const d = num(a[2], 'polar')
    return [p[0] + Math.cos(ang) * d, p[1] + Math.sin(ang) * d, p[2]]
  })
  def('angle', a => {
    const p = pt(a[0], 'angle'); const q = pt(a[1], 'angle')
    const v = Math.atan2(q[1] - p[1], q[0] - p[0])
    return v < 0 ? v + Math.PI * 2 : v
  })
  def('distance', a => {
    const p = pt(a[0], 'distance'); const q = pt(a[1], 'distance')
    return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])
  })
  def('inters', a => {
    const [p1, p2, p3, p4] = [pt(a[0], 'inters'), pt(a[1], 'inters'), pt(a[2], 'inters'), pt(a[3], 'inters')]
    const bounded = a.length < 5 || truthy(a[4])
    const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1], d2x = p4[0] - p3[0], d2y = p4[1] - p3[1]
    const den = d1x * d2y - d1y * d2x
    if (Math.abs(den) < 1e-12) return null
    const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / den
    const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / den
    if (bounded && (t < -1e-12 || t > 1 + 1e-12 || u < -1e-12 || u > 1 + 1e-12)) return null
    return [p1[0] + d1x * t, p1[1] + d1y * t, 0]
  })
  def('trans', a => (isList(a[0]) ? toArray(a[0]).map(v => (isNum(v) ? Number(v) : v)) : a[0]))
  def('vlax-3d-point', a => (a.length === 1 ? pt(a[0], 'vlax-3d-point') : [num(a[0], 'vlax-3d-point'), num(a[1], 'vlax-3d-point'), a.length > 2 ? num(a[2], 'vlax-3d-point') : 0]))
  def('vlax-safearray->list vlax-variant-value vlax-make-variant', a => a[0] ?? null)
  def('vlax-make-safearray', () => null)
  def('vlax-safearray-fill', a => a[1] ?? null)

  // 호스트 위임 — 도면·입력·파일
  // 인자는 리습이 준 것만, 보통 JS 값으로 넘긴다(정수 → number, 목록 → 배열).
  // 환경 객체를 덧붙이면 (entnext) 처럼 '인자 없음' 으로 갈라지는 함수가 엉뚱한 가지로 빠진다.
  const host = (method, arity, after = fromHost) => (a) => {
    const h = H()
    if (!h || typeof h[method] !== 'function')
      throw new LispError(`${method} 은(는) 이 엔진에서 아직 지원하지 않습니다.`)
    const args = a.slice(0, arity === undefined ? a.length : arity).map(toHost)
    return after(h[method](...args))
  }
  const asIntResult = (v) => (typeof v === 'number' ? asInt(v) : fromHost(v))
  def('entmake', host('entmake'))
  def('entmakex', host('entmakex'))
  // 호스트가 같은 목록(얼린 원본의 entget 캐시)을 주면 변환한 리습 목록도 다시 쓴다.
  const hostLists = new WeakMap()
  const fromHostCached = (v) => {
    if (!Array.isArray(v)) return fromHost(v)
    let out = hostLists.get(v)
    if (out === undefined) { out = fromHost(v); hostLists.set(v, out) }
    return out
  }
  def('entget', host('entget', undefined, fromHostCached))
  def('entmod', host('entmod'))
  def('entdel', host('entdel'))
  def('entlast', host('entlast'))
  def('entnext', host('entnext'))
  def('entupd', host('entupd'))
  def('entsel', host('entsel'))
  def('nentsel', host('entsel'))
  def('nentselp', host('nentselp'))
  def('handent', host('handent'))
  def('tblobjname', host('tblobjname'))
  def('ssget', host('ssget'))
  def('ssgetfirst', host('ssgetfirst'))
  def('sssetfirst', host('sssetfirst'))
  def('sslength', a => (a[0] instanceof SelSet ? BigInt(a[0].ids.length) : 0n))
  def('ssname', a => {
    const s = a[0], i = Number(int(a[1], 'ssname'))
    return s instanceof SelSet && i >= 0 && i < s.ids.length ? new Ename(s.ids[i]) : null
  })
  def('ssadd', a => {
    if (!a.length || isNil(a[0])) return new SelSet([])
    const s = a[1] instanceof SelSet ? a[1] : new SelSet([])
    if (a[0] instanceof Ename && !s.has(a[0].id)) { s.ids.push(a[0].id); selectionMembers.get(s).add(a[0].id) }
    return s
  })
  def('ssdel', a => {
    const s = a[1]
    if (!(s instanceof SelSet) || !(a[0] instanceof Ename) || !s.has(a[0].id)) return null
    s.ids = s.ids.filter(id => id !== a[0].id); selectionMembers.delete(s)
    return s
  })
  def('ssmemb', a => {
    const s = a[1]
    return s instanceof SelSet && a[0] instanceof Ename && s.has(a[0].id) ? a[0] : null
  })
  def('getvar', a => {
    const h = H()
    if (!h?.getvar) throw new LispError('getvar 은(는) 이 엔진에서 아직 지원하지 않습니다.')
    const name = String(toHost(a[0]) ?? '').toUpperCase()
    const v = h.getvar(name)
    if (typeof v === 'number' && Number.isInteger(v) && !REAL_VARS.has(name)) return asInt(v)
    return fromHost(v)
  })
  def('setvar', host('setvar'))
  def('getenv getcfg', host('getenv'))
  def('setenv setcfg', host('setenv'))
  def('tblsearch', host('tblsearch'))
  def('tblnext', host('tblnext'))
  def('command vl-cmdf command-s', host('command'))
  def('getpoint', host('getpoint'))
  def('getcorner', host('getcorner'))
  def('getreal', host('getreal'))
  def('getint', host('getint', undefined, asIntResult))
  def('getstring', host('getstring'))
  def('getkword', host('getkword'))
  def('getdist', host('getdist'))
  def('getangle getorient', host('getangle'))
  def('initget', host('initget'))
  def('getfiled', host('getfiled'))
  def('textbox', host('textbox'))
  def('grread', host('grread', undefined, (v) => (Array.isArray(v) ? [asInt(v[0]), typeof v[1] === 'number' ? asInt(v[1]) : fromHost(v[1])] : v)))
  def('osnap', host('osnap'))
  def('open', host('fileOpen'))
  def('close', host('fileClose'))
  def('write-line', host('writeLine'))
  def('write-char', host('writeChar'))
  def('read-line', host('readLine'))
  def('read-char', host('readChar', undefined, asIntResult))
  def('findfile vl-file-existentp', host('findfile'))
  def('vl-file-delete', host('fileDelete'))
  def('vl-file-size', host('fileSize', undefined, asIntResult))
  def('vl-file-directory-p', () => null)
  def('load', a => {
    const h = H()
    const name = String(a[0] ?? '')
    const source = h?.loadLisp ? h.loadLisp(name) : null
    if (typeof source !== 'string') {
      if (a.length > 1) return a[1]
      throw new LispError(`load: 파일 ${name} 을(를) 찾지 못했습니다. 리습 관리에 등록한 파일만 불러올 수 있습니다.`)
    }
    return interp.load(source)
  })
  // ACAD200-819: (autoload "파일" '("CMD" …)) — 파일을 바로 읽지 않고 명령마다 작은 대리 함수만 둔다. 처음 부를 때
  // 등록한 리습에서 그 파일을 찾아 읽고 진짜 명령을 부른다. 이미 정의된 명령은 건드리지 않는다.
  def('autoload', a => {
    const file = String(a[0] ?? '')
    const names = Array.isArray(a[1]) ? a[1] : a[1] == null ? [] : [a[1]]
    for (const item of names) {
      const cmd = String(item instanceof Sym ? item.name : item ?? '').toUpperCase()
      if (!/^[A-Z0-9_\-]+$/.test(cmd) || interp.commands.has('C:' + cmd)) continue
      interp.eval(read(`(defun C:${cmd} () (br:autoload-run ${JSON.stringify(file)} ${JSON.stringify(cmd)}))`)[0])
    }
    return null
  })
  def('br:autoload-run', a => {
    const file = String(a[0] ?? ''), cmd = String(a[1] ?? '').toUpperCase(), key = 'C:' + cmd
    const stub = interp.commands.get(key)
    const h = H(), source = h?.loadLisp ? h.loadLisp(file) : null
    if (typeof source !== 'string') throw new LispError(`${cmd}: 자동 불러오기 파일 ${file} 을(를) 찾지 못했습니다. 리습 관리에 그 파일을 등록하세요.`)
    interp.load(source)
    const real = interp.commands.get(key)
    if (!real || real === stub) throw new LispError(`${file} 에 ${cmd} 명령 정의가 없습니다.`)
    return interp.apply(real, [])
  })
  def('grclear grtext grvecs', () => null)

  // 커브
  for (const m of ['getStartPoint', 'getEndPoint', 'getStartParam', 'getEndParam', 'getPointAtParam',
    'getDistAtParam', 'getParamAtPoint', 'getDistAtPoint', 'getClosestPointTo', 'getArea', 'isClosed',
    'getFirstDeriv', 'getSecondDeriv']) {
    def('vlax-curve-' + m, host('curve' + m[0].toUpperCase() + m.slice(1)))
  }
  def('vlax-ename->vla-object vlax-vla-object->ename', a => a[0])

  // ActiveX 얇은 대역 — 리습이 흔히 쓰는 '레이어 만들고 색 주고 객체 읽고 고치기'만 연결한다.
  def('vlax-get-acad-object', host('comAcadObject'))
  def('vla-get-activedocument', host('comAcadObject'))
  def('vla-get-modelspace vla-get-paperspace vla-get-block', host('comModelSpace'))
  def('vla-get-layers', host('comLayers'))
  def('vla-item', host('comLayerItem'))
  def('vla-add', host('comLayerAdd'))
  def('vla-put-color', host('comPutColor'))
  def('vla-put-layer', host('comPutLayer'))
  def('vla-copy', host('comCopy'))
  def('vla-startundomark vla-endundomark', host('comUndoMark'))
  def('vla-addline', host('comAddLine'))
  def('vla-addcircle', host('comAddCircle'))
  def('vla-delete', host('comDelete'))
  for (const p of ['Layer', 'TextString', 'Length', 'Area', 'ObjectName', 'Color', 'StartPoint', 'EndPoint', 'Center', 'Radius', 'Name', 'Handle'])
    def('vla-get-' + p.toLowerCase(), a => fromHost(H()?.comGet ? H().comGet(toHost(a[0]), p) : null))
  for (const p of ['TextString', 'Color', 'Layer'])
    def('vla-put-' + p.toLowerCase(), a => { H()?.comPut?.(toHost(a[0]), p, toHost(a[1])); return null })
  def('vlax-get-property vlax-get', a => fromHost(H()?.comGet ? H().comGet(toHost(a[0]), String(toHost(a[1]))) : null))
  def('vlax-put-property vlax-put', a => { H()?.comPut?.(toHost(a[0]), String(toHost(a[1])), toHost(a[2])); return null })
  def('vlax-invoke vlax-invoke-method', a => {
    const method = String(toHost(a[1]) ?? '').toUpperCase()
    const rest = a.slice(2).map(toHost)
    const h = H()
    if (method === 'ADDLINE' && h?.comAddLine) return fromHost(h.comAddLine(toHost(a[0]), ...rest))
    if (method === 'ADDCIRCLE' && h?.comAddCircle) return fromHost(h.comAddCircle(toHost(a[0]), ...rest))
    if (method === 'DELETE' && h?.comDelete) return fromHost(h.comDelete(toHost(a[0])))
    throw new LispError(`ActiveX 메서드 ${method} 은(는) 자체 엔진이 아직 모릅니다.`)
  })
  // 화면 제어는 바른 CAD 가 알아서 다시 그리므로 할 일이 없다.
  def('redraw graphscr textscr grdraw', () => null)

  return B
}


/* ── 호출 검사 ─────────────────────────────────────────────
   문자열 검색이 아니라 실제로 파싱한 뒤 '호출 자리'만 센다.
   람다·defun 의 인자 목록과 인용된 데이터를 호출로 오인하지 않는다. */
const SPECIAL_FORMS = new Set(['QUOTE', 'FUNCTION', 'IF', 'COND', 'PROGN', 'AND', 'OR',
  'WHILE', 'REPEAT', 'FOREACH', 'SETQ', 'SET', 'DEFUN', 'DEFUN-Q', 'LAMBDA', 'VL-CATCH-ALL-APPLY'])

/* ── 명령 단위 검사 ────────────────────────────────────────
   정의마다 '무엇을 부르는지'를 따로 담아 두고, 실행할 명령에서 출발해
   실제로 닿는 함수만 따라간다. 쓰지도 않는 명령 때문에 막히지 않는다. */
const COMMAND_CALLS = new Set(['COMMAND', 'COMMAND-S', 'VL-CMDF'])

export function scanByFunction(source) {
  const forms = Array.isArray(source) ? source : read(source)
  const defined = new Set()
  const owners = new Map()                                   // 정의 이름 → {calls, commands}
  const top = { calls: new Set(), commands: new Map() }
  const bucket = (name) => {
    if (!owners.has(name)) owners.set(name, { calls: new Set(), commands: new Map() })
    return owners.get(name)
  }
  const bind = (argList) => {
    const items = argList === null ? [] : (Array.isArray(argList) ? argList : [argList])
    return items.map(a => (a instanceof Sym ? a.name.toUpperCase().replace(/^\//, '') : '')).filter(Boolean)
  }
  function walk(form, scope, into) {
    if (!Array.isArray(form) || !form.length) return
    const head = form[0]
    if (head instanceof Sym) {
      const key = head.name.toUpperCase()
      if (key === 'QUOTE') return
      if (key === 'DEFUN' || key === 'DEFUN-Q') {
        const name = form[1] instanceof Sym ? form[1].name.toUpperCase() : ''
        if (name) defined.add(name)
        const inner = new Set([...scope, ...bind(form[2])])
        const mine = name ? bucket(name) : into
        for (let i = 3; i < form.length; i++) walk(form[i], inner, mine)
        return
      }
      if (key === 'LAMBDA') {
        const inner = new Set([...scope, ...bind(form[1])])
        for (let i = 2; i < form.length; i++) walk(form[i], inner, into)
        return
      }
      if (key === 'FOREACH') {
        const inner = new Set([...scope, form[1] instanceof Sym ? form[1].name.toUpperCase() : ''])
        walk(form[2], scope, into)
        for (let i = 3; i < form.length; i++) walk(form[i], inner, into)
        return
      }
      if (key === 'SETQ') {
        for (let i = 2; i < form.length; i += 2) walk(form[i], scope, into)
        return
      }
      if (key === 'COND') {
        // 절의 첫 요소는 조건식이다. (cond (T ...)) 의 T 를 호출로 세면 안 된다.
        for (let i = 1; i < form.length; i++)
          if (Array.isArray(form[i])) for (const item of form[i]) walk(item, scope, into)
        return
      }
      if (COMMAND_CALLS.has(key) && form.length > 1) {
        const first = form[1]
        const name = typeof first === 'string' ? first.replace(/^[_.]+/, '').toUpperCase() : '(변수로 정한 명령)'
        if (name) into.commands.set(name, (into.commands.get(name) || 0) + 1)
      }
      if (!SPECIAL_FORMS.has(key) && !scope.has(key)) into.calls.add(key)
    } else walk(head, scope, into)
    for (let i = 1; i < form.length; i++) walk(form[i], scope, into)
  }
  for (const f of forms) walk(f, new Set(), top)
  return { defined, owners, top }
}

/** 이 명령 하나를 돌리려면 무엇이 필요한지. commandName 이 없으면 파일 전체를 본다.
    includeTop=false 는 최상위 식(불러올 때 도는 것)을 빼고 본다 — 파일마다 따로 검사할 때 쓴다. */
export function requirementsFor(source, commandName, { includeTop = true } = {}) {
  const { defined, owners, top } = scanByFunction(source)
  const calls = new Set(), commands = new Map()
  const soak = (from) => {
    for (const c of from.calls) calls.add(c)
    for (const [name, n] of from.commands) commands.set(name, (commands.get(name) || 0) + n)
  }
  if (includeTop) soak(top)                                  // 최상위 식은 불러올 때 무조건 돈다
  const wanted = commandName ? 'C:' + String(commandName).toUpperCase().replace(/^C:/, '') : null
  if (wanted && owners.has(wanted)) {
    const seen = new Set([wanted]), stack = [wanted]
    while (stack.length) {
      const here = owners.get(stack.pop())
      if (!here) continue
      soak(here)
      for (const next of here.calls) if (owners.has(next) && !seen.has(next)) { seen.add(next); stack.push(next) }
    }
  } else {
    for (const one of owners.values()) soak(one)             // 명령을 못 찾으면 안전하게 전부 본다
  }
  return { defined, calls, commands }
}

export function scanCalls(source) {
  const { defined, owners, top } = scanByFunction(source)
  const called = new Map()
  for (const from of [top, ...owners.values()]) for (const c of from.calls) called.set(c, (called.get(c) || 0) + 1)
  return { defined, called }
}

let knownNames = null
const known = () => knownNames || (knownNames = new Set(Object.keys(new Interpreter(null).builtins)))

/** 이 엔진으로 돌릴 수 없는 호출을 추려 돌려준다. commandName 을 주면 그 명령이 닿는 곳만 본다. */
export function unsupportedCalls(source, commandName, options) {
  const { defined, calls } = requirementsFor(source, commandName, options)
  const out = []
  for (const name of calls)
    if (!known().has(name) && !SPECIAL_FORMS.has(name) && !defined.has(name)
      && !name.startsWith('BR:'))   // br:ok / br:fail 은 패널이 실행 시 넣어 준다
      out.push({ name, count: 1 })
  return out
}

/** (command "…") 로 부르는 명령 이름을 모은다. 이름을 변수로 넘기면 미리 알 수 없다. */
export function usedCommands(source, commandName, options) {
  return [...requirementsFor(source, commandName, options).commands].map(([name, count]) => ({ name, count }))
}

export function supportedFunctions() {
  return [...known()].sort()
}
