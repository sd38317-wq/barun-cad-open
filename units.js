// ACAD200 714 단위(UNITS)와 삽입 단위 경고(INSUNITS).
// AutoCAD: LUNITS·LUPREC·AUNITS·AUPREC·ANGBASE·ANGDIR·INSUNITS 를 도면에 두고, 단위가 다른 블록을 넣을 때 경고한다(스크립트 중엔 안 함).
// 바른 CAD 가 더 나은 점:
//  - 저장 단위는 언제나 mm 하나다(단위 바꾸다 도면이 1000배 커지는 사고 없음). UNITS 는 "보이는 형식" 만 바꾼다.
//  - 단위가 다른 도면을 넣을 때 "m 도면 → mm 로 1000배" 처럼 한국어로 배율을 미리 계산해 보여 준다.
//  - 단위 없음(0)은 묻지 않고 1배로 넣는다(AutoCAD 도 INSUNITSDEFSOURCE 를 쓴다).

/* DXF $INSUNITS 코드 → mm. 0 = 단위 없음. */
export const INSUNITS_MM = Object.freeze({0: 1, 1: 25.4, 2: 304.8, 3: 1609344, 4: 1, 5: 10, 6: 1000, 7: 1e6, 8: 2.54e-5, 9: 0.0254, 10: 914.4, 11: 1e-7, 12: 1e-6, 13: 1e-3, 14: 100, 15: 10000, 16: 100000, 17: 1e12, 18: 1.495978707e14, 19: 9.4607304725808e18, 20: 3.0856776e19});
export const INSUNITS_LABEL = Object.freeze({0: '단위 없음', 1: '인치', 2: '피트', 4: '밀리미터', 5: '센티미터', 6: '미터', 7: '킬로미터', 14: '데시미터'});
export const DEFAULT_UNITS = Object.freeze({lunits: 2, luprec: 0, aunits: 0, auprec: 0, angbase: 0, angdir: 0, insunits: 4});
export const LUNITS = Object.freeze({1: '공학(지수)', 2: '십진', 3: '공학(피트-인치)', 4: '건축(피트-인치 분수)', 5: '분수'});
export const AUNITS = Object.freeze({0: '십진 도', 1: '도/분/초', 2: '그라드', 3: '라디안'});

export function normalizeUnits(raw = {}) {
  const u = {...DEFAULT_UNITS, ...(raw || {})};
  const int = (v, lo, hi, name) => { const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) throw Error(`${name} 값은 ${lo}~${hi} 정수입니다.`); return n; };
  return {lunits: int(u.lunits, 1, 5, '길이 형식'), luprec: int(u.luprec, 0, 8, '길이 정밀도'), aunits: int(u.aunits, 0, 3, '각도 형식'), auprec: int(u.auprec, 0, 8, '각도 정밀도'),
    angbase: Number.isFinite(Number(u.angbase)) ? ((Number(u.angbase) % 360) + 360) % 360 : 0, angdir: u.angdir ? 1 : 0, insunits: int(u.insunits, 0, 20, '삽입 단위')};
}

export function insertScale(sourceUnits, targetUnits = 4) {
  const a = INSUNITS_MM[sourceUnits], b = INSUNITS_MM[targetUnits];
  if (!sourceUnits || a === undefined || b === undefined) return 1;   // 단위 없음·모름 = 그대로
  return a / b;
}
/** 삽입 배율을 정한다. 같은 단위·단위 없음이면 묻지 않음. 스크립트·리습 중이면 묻지 않고 맞춘다(AutoCAD 와 같음). */
export async function confirmInsertUnits(sourceUnits, {targetUnits = 4, scriptActive = false, ask}) {
  const s = insertScale(sourceUnits, targetUnits);
  if (Math.abs(s - 1) < 1e-12) return {scale: 1, asked: false};
  if (scriptActive || typeof ask !== 'function') return {scale: s, asked: false};
  const from = INSUNITS_LABEL[sourceUnits] || `단위 ${sourceUnits}`, to = INSUNITS_LABEL[targetUnits] || `단위 ${targetUnits}`;
  const ok = await ask(`넣을 도면은 ${from} 단위입니다. 이 도면(${to})에 맞게 ${formatNumber(s)}배로 넣을까요? 아니면 1배로 넣습니다.`);
  return {scale: ok ? s : 1, asked: true};
}
const formatNumber = (n) => (Math.abs(n) >= 1 ? Number(n.toPrecision(10)).toLocaleString('ko-KR') : String(Number(n.toPrecision(6))));

function feetInches(mm, prec, fraction) {
  const sign = mm < 0 ? '-' : '', inches = Math.abs(mm) / 25.4, feet = Math.floor(inches / 12), rest = inches - feet * 12;
  if (!fraction) return `${sign}${feet}'-${rest.toFixed(prec)}"`;
  const den = 2 ** Math.min(8, prec || 0) || 1, whole = Math.floor(rest), num = Math.round((rest - whole) * den);
  return `${sign}${feet}'-${whole}${num ? ` ${num}/${den}` : ''}"`;
}
/** 길이(mm) 표시. lunits 2 십진(기본), 1 지수, 3 피트-인치 십진, 4 피트-인치 분수, 5 분수. */
export function formatLength(mm, units = {}) {
  const {lunits = 2, luprec = 0} = units, v = Number(mm);
  if (!Number.isFinite(v)) return '';
  if (lunits === 1) return v.toExponential(luprec).replace('e', 'E');
  if (lunits === 3) return feetInches(v, luprec, false);
  if (lunits === 4) return feetInches(v, luprec, true);
  if (lunits === 5) { const den = 2 ** Math.min(8, luprec || 0) || 1, whole = Math.trunc(v), num = Math.round(Math.abs(v - whole) * den); return num ? `${whole} ${num}/${den}` : String(whole); }
  return v.toFixed(luprec);
}
/** 각도(도, 0도=동쪽·반시계) 표시. angbase·angdir 을 반영한다. */
export function formatAngle(deg, units = {}) {
  const {aunits = 0, auprec = 0, angbase = 0, angdir = 0} = units;
  let a = Number(deg) - angbase; if (angdir) a = -a; a = ((a % 360) + 360) % 360;
  if (aunits === 3) return (a * Math.PI / 180).toFixed(auprec) + 'r';
  if (aunits === 2) return (a * 400 / 360).toFixed(auprec) + 'g';
  if (aunits === 1) { const d = Math.floor(a), mRaw = (a - d) * 60, m = Math.floor(mRaw), s = (mRaw - m) * 60; return auprec <= 0 ? `${d}°` : auprec <= 2 ? `${d}°${m}'` : `${d}°${m}'${s.toFixed(Math.max(0, auprec - 4))}"`; }
  return a.toFixed(auprec) + '°';
}
/** UNITS 창 미리보기 문장(AutoCAD updateSampleDisplay 와 같은 역할). */
export const unitsSample = (units) => `길이 ${formatLength(1234.5678, units)} · 각도 ${formatAngle(45.5, units)}`;

/* 단위 없는(INSUNITS=0) 원본을 넣을 때: 예전에는 거절만 했다. 이제 사용자가 고른 단위로 배율을 정한다. */
export const UNITLESS_CHOICES = Object.freeze({mm: 1, cm: 10, m: 1000});
export function unitlessImportScale(report, choice) {
  if (!report?.unitless) return 1;
  const s = UNITLESS_CHOICES[choice];
  if (!s) throw Error('원본 DXF 에 단위가 없습니다. "단위 없는 원본은" 칸에서 mm·cm·m 중 하나를 고르세요(대지·배치도는 보통 m).');
  return s;
}

// 623 INSUNITS: 다른 도면·라이브러리 블록을 넣을 때 단위를 자동으로 맞춘다.
// AutoCAD: 단위 코드 0~24, factor = 미터환산(원본)/미터환산(대상). 단위 없음(0)이면 INSUNITSDEFSOURCE/TARGET 설정.
// 우리 문서는 언제나 mm 이므로 대상은 4(mm)다. 원본 단위를 모르면 mm 로 보되, 크기로 보아 m·cm 로 그린 것 같으면 알려 준다(조용히 틀리지 않게).
export const MM_PER_UNIT=Object.freeze({1:25.4,2:304.8,3:1609344,4:1,5:10,6:1000,7:1e6,8:2.54e-5,9:0.0254,10:914.4,11:1e-7,12:1e-6,13:1e-3,14:100,15:1e4,16:1e5,17:1e12,18:1.495978707e14,19:9.4607e18,20:3.0857e19,21:304.8006096012192,22:25.400050800101603,23:914.4018288036576,24:1609347.2186944373});
export const UNIT_NAMES=Object.freeze({0:'단위 없음',1:'인치',2:'피트',3:'마일',4:'mm',5:'cm',6:'m',7:'km',8:'마이크로인치',9:'밀',10:'야드',11:'옹스트롬',12:'나노미터',13:'마이크로미터',14:'데시미터',15:'데카미터',16:'헥토미터',17:'기가미터',18:'천문단위',19:'광년',20:'파섹',21:'US 측량 피트',22:'US 측량 인치',23:'US 측량 야드',24:'US 측량 마일'});
const NAMED={mm:4,millimeter:4,cm:5,m:6,meter:6,km:7,inch:1,in:1,ft:2,feet:2,foot:2};
export function unitCode(value){
  if(value==null||value==='')return 0;
  if(typeof value==='number')return Number.isInteger(value)&&value>=0&&value<=24?value:0;
  const text=String(value).trim().toLowerCase();if(/^\d+$/.test(text))return unitCode(Number(text));
  return NAMED[text]??0;
}
/** 원본 단위 → 대상 단위 배율. 0(없음)은 기본값(기본 mm)으로 본다. */
export function unitConversion(fromCode,toCode=4,{defaultSource=4,defaultTarget=4}={}){
  const from=unitCode(fromCode)||defaultSource,to=unitCode(toCode)||defaultTarget;
  if(!(from in MM_PER_UNIT)||!(to in MM_PER_UNIT))throw Error('지원하지 않는 단위입니다.');
  return MM_PER_UNIT[from]/MM_PER_UNIT[to];
}
/** 단위 없는 원본의 어림: 범위가 아주 작으면 m 로 그린 도면일 가능성을 알려 준다(자동으로 바꾸지는 않는다). */
export function unitHint(bounds,code){
  if(unitCode(code)||!bounds)return null;
  const span=Math.max(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY);
  if(span>0&&span<50)return '원본 단위가 없고 크기가 작습니다(가로·세로 '+span.toFixed(2)+'). m 로 그린 도면이면 원본 단위를 m 로 고르세요.';
  return null;
}
