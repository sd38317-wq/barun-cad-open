// 문자 원문 코드(MTEXT 서식 코드·TEXT 의 %% 제어 코드) ↔ 화면 문자.
// 501 MTEXT 서식 보존, 502 MTEXT 내보내기 이스케이프, 505 %% 제어 코드.
//
// 바른 CAD 문자 객체는 화면에 보이는 문자(text)를 그대로 갖는다. DXF 에서 온 문자에 서식 코드가 있었다면
// 원문을 codeText 에, 그 원문을 풀었을 때의 문자를 codePlain 에 함께 둔다(exchange.py 가 채운다).
// 사용자가 text 를 고치지 않았으면(codePlain===text) 내보낼 때 원문을 그대로 써서 서식·밑줄을 잃지 않는다.
// 고쳤으면 새 text 를 규칙대로 이스케이프해서 쓴다(AutoCAD 는 원문 코드만 있고 편집하면 코드를 다시 만든다 —
// 우리는 고치지 않은 문자는 바이트 그대로 돌려준다).

/** %% 코드가 바꾸는 글자. 지름은 치수 접두사(geometry.js)와 같은 Ø(U+00D8)로 보인다. */
export const PERCENT_SYMBOLS = Object.freeze({c: 'Ø', d: '°', p: '±'});
const PERCENT_TOGGLES = Object.freeze({u: 'underline', o: 'overline', k: 'strike'});

/**
 * TEXT 원문(%%코드) → 글자 덩어리(run) 배열. run = {text, underline, overline, strike}.
 * %%c ⌀, %%d °, %%p ±, %%% %, %%nnn 문자 코드, %%u/%%o/%%k 밑줄·윗줄·취소선 켜고 끄기.
 */
export function decodePercentCodes(raw) {
 const s = String(raw ?? ''), runs = [];
 let st = {underline: false, overline: false, strike: false}, buf = '';
 const flush = () => { if (buf) runs.push({...st, text: buf}); buf = ''; };
 for (let i = 0; i < s.length; i++) {
  if (s[i] !== '%' || s[i + 1] !== '%' || i + 2 >= s.length) { buf += s[i]; continue; }
  const next = s[i + 2], k = next.toLowerCase();
  const num = /^\d{3}/.exec(s.slice(i + 2, i + 5))?.[0];
  if (num) { buf += String.fromCharCode(Number(num)); i += 4; continue; }
  if (PERCENT_SYMBOLS[k]) { buf += PERCENT_SYMBOLS[k]; i += 2; continue; }
  if (next === '%') { buf += '%'; i += 2; continue; }
  const key = PERCENT_TOGGLES[k];
  if (key) { flush(); st = {...st, [key]: !st[key]}; i += 2; continue; }
  buf += s[i];   // 모르는 %%x 는 AutoCAD 처럼 글자로 둔다
 }
 flush();
 return runs;
}

/** TEXT 원문 → 화면 문자(밑줄 같은 꾸밈은 빠진다). */
export function percentToPlain(raw) {
 const s = String(raw ?? '');
 return s.includes('%%') ? decodePercentCodes(s).map(r => r.text).join('') : s;
}

/**
 * 화면 문자 → TEXT 원문. Ø·⌀·°·± 는 SHX 글꼴에서도 보이게 %% 코드로 쓰고, 글자 % 가 코드로 읽히지 않게
 * 필요한 곳만 %%% 로 바꾼다(혼자 있는 % 는 그대로 — "50%" 가 "50%%%" 로 바뀌지 않는다).
 */
export function encodePercentCodes(text) {
 const s = String(text ?? ''), code = ch => ch === 'Ø' || ch === '⌀' ? '%%c' : ch === '°' ? '%%d' : ch === '±' ? '%%p' : null;
 let out = '';
 for (let i = 0; i < s.length; i++) {
  const ch = s[i], symbol = code(ch);
  if (symbol) { out += symbol; continue; }
  if (ch !== '%') { out += ch; continue; }
  // % 가 다른 % 나 %% 코드와 붙으면 AutoCAD 가 코드로 읽는다 → %%% 로 쓴다.
  const touches = s[i - 1] === '%' || s[i + 1] === '%' || (i + 1 < s.length && code(s[i + 1])) || out.endsWith('%');
  out += touches ? '%%%' : '%';
 }
 return out;
}

/* ── MTEXT ── */

const STACK_SPLIT = /[\/#^]/;
const readArg = (s, i) => { const end = s.indexOf(';', i); return end < 0 ? [s.slice(i), s.length - 1] : [s.slice(i, end), end]; };
const stackPart = v => v.replace(/\\(.)/g, '$1');

/**
 * MTEXT 원문 → run 배열. run = {text, height, font, bold, italic, aci, widthFactor, underline, overline, strike, …}
 * 줄바꿈은 {br:true}, 쌓기(\S위/아래;)는 {stack:{top,bottom,kind}} run 이다.
 * base 는 문자 객체의 기본값({height, font, widthFactor, aci}). 모르는 코드는 버리고 글자는 남긴다.
 */
export function parseMtextRuns(raw, base = {}) {
 const s = String(raw ?? ''), runs = [], stack = [];
 let st = {...base}, buf = '';
 const flush = () => { if (buf) runs.push({...st, text: buf}); buf = ''; };
 for (let i = 0; i < s.length; i++) {
  const ch = s[i];
  if (ch === '{') { flush(); stack.push({...st}); continue; }
  if (ch === '}') { flush(); st = stack.pop() || {...base}; continue; }
  if (ch === '%' && s[i + 1] === '%' && i + 2 < s.length) {   // MTEXT 도 %%c·%%d·%%p 를 받는다
   const k = s[i + 2].toLowerCase();
   if (PERCENT_SYMBOLS[k]) { buf += PERCENT_SYMBOLS[k]; i += 2; continue; }
  }
  if (ch !== '\\') { buf += ch; continue; }
  const k = s[++i];
  if (k === undefined) break;
  if (k === '\\' || k === '{' || k === '}') { buf += k; continue; }
  if (k === 'P' || k === 'X') { flush(); runs.push({...st, text: '', br: true}); continue; }
  if (k === 'N') { flush(); runs.push({...st, text: '', br: true, column: true}); continue; }
  if (k === '~') { buf += ' '; continue; }
  if (k === 'U' && s[i + 1] === '+' && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) { buf += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16)); i += 5; continue; }
  if ('LlOoKk'.includes(k)) { flush(); st[{l: 'underline', o: 'overline', k: 'strike'}[k.toLowerCase()]] = k === k.toUpperCase(); continue; }
  if (!'HfFCcWQTApS'.includes(k)) { buf += k; continue; }   // 모르는 코드는 글자 하나로(뒤 글자를 먹지 않는다)
  const [arg, end] = readArg(s, i + 1); i = end; flush();
  if (k === 'H') { const n = parseFloat(arg); if (Number.isFinite(n) && n > 0) st.height = /x$/i.test(arg) ? (st.height || 1) * n : n; }
  else if (k === 'f' || k === 'F') {
   const [face, ...opts] = arg.split('|');
   st.font = face; st.bold = opts.includes('b1'); st.italic = opts.includes('i1');
  }
  else if (k === 'C') { const n = Number(arg); if (Number.isInteger(n)) st.aci = n; }
  else if (k === 'c') { const n = Number(arg); if (Number.isInteger(n)) st.trueColor = n; }
  else if (k === 'W') { const n = parseFloat(arg); if (n > 0) st.widthFactor = n; }
  else if (k === 'Q') { const n = parseFloat(arg); if (Number.isFinite(n)) st.oblique = n; }
  else if (k === 'T') { const n = parseFloat(arg); if (Number.isFinite(n)) st.tracking = n; }
  else if (k === 'A') { const n = Number(arg); if ([0, 1, 2].includes(n)) st.valign = ['bottom', 'middle', 'top'][n]; }
  else if (k === 'S') {
   const m = /^(.*?)(?<!\\)([\/#^])(.*)$/.exec(arg);
   const top = stackPart(m ? m[1] : arg), bottom = stackPart(m ? m[3] : ''), kind = m ? m[2] : '/';
   runs.push({...st, text: '', stack: {top, bottom, kind}});
  }
  // \p(문단)·그 밖의 코드는 서식만 있고 글자가 없다 — 버린다.
 }
 flush();
 return runs;
}

/** run 배열 → 화면 문자. 쌓기는 "위/아래"(# 는 /, ^ 는 위첨자·아래첨자라 공백). */
export function runsToPlain(runs) {
 let out = '';
 for (const r of runs || []) {
  if (r.br) out += '\n';
  else if (r.stack) out += r.stack.kind === '^' ? `${r.stack.top}${r.stack.bottom ? ' ' + r.stack.bottom : ''}` : `${r.stack.top}/${r.stack.bottom}`;
  else out += r.text;
 }
 return out;
}

/** MTEXT 원문 → 화면 문자. */
export const mtextToPlain = raw => runsToPlain(parseMtextRuns(raw));

/** 평문 → MTEXT 원문. \ { } 를 글자로 남게 이스케이프한 뒤 줄바꿈을 \P 로(순서가 중요하다). */
export function plainToMtext(text) {
 return String(text ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/\{/g, '\\{').replace(/\}/g, '\\}')
  .replace(/\r?\n/g, '\\P');
}

/** 내보낼 MTEXT 원문: 고치지 않은 문자는 원문 그대로, 고친 문자는 새로 이스케이프. */
export function textForMtextExport(e) {
 return typeof e?.codeText === 'string' && e.codeKind === 'mtext' && e.codePlain === e.text ? e.codeText : plainToMtext(e?.text);
}

/** 내보낼 TEXT 원문: 고치지 않은 문자는 원문(%%u 밑줄 등) 그대로, 고친 문자는 %% 코드로. */
export function textForTextExport(e) {
 return typeof e?.codeText === 'string' && e.codeKind === 'text' && e.codePlain === e.text ? e.codeText : encodePercentCodes(e?.text);
}

/** 원문이 고쳐진 문자인지(원문을 더 이상 믿을 수 없는지). */
export const codeTextStale = e => typeof e?.codeText === 'string' && e.codePlain !== e.text;

/**
 * 명령창·편집기에서 입력한 문자: AutoCAD 습관(%%c, %%d, %%p, %%%)을 받아 화면 문자로 바꾼다.
 * %%u 같은 꾸밈 코드는 글자가 없으니 지운다. 코드가 없으면 그대로 돌려준다(비용 0).
 */
export function normalizeTypedText(text) {
 const s = String(text ?? '');
 return s.includes('%%') ? percentToPlain(s) : s;
}
