// ACAD200 영역 7 사용자 설정(도면이 아니라 이 컴퓨터의 사용자에게 붙는 값).
// 명령 별칭 설정(barun-cad-command-settings-v1)은 엄격하게 검사되므로 건드리지 않고 따로 둔다. BRBACKUP 묶음(725)으로 옮겨진다.
export const PREFS_KEY = 'barun-cad-prefs-v1';
export const STAMP_FIELDS = Object.freeze(['drawing', 'sheet', 'datetime', 'user', 'device', 'paper', 'scale', 'udf1', 'udf2']);
export const PREF_DEFAULTS = Object.freeze({
  layIsoMode: 'off',            // 704 LAYISO: off | lock
  linetypePatterns: 'lin',      // 720 선종류 무늬: lin(.lin 비율) | legacy(예전 어림)
  inputSearchDelay: 0,          // 715 INPUTSEARCHDELAY (ms). 0 = 다음 화면 갱신 때 한 번(치는 동안 쌓인 계산은 버림, 지연 없음)
  propObjLimit: 20000,          // 712 PROPOBJLIMIT (특성 팔레트 전체 계산 상한)
  ribbonContextSelLimit: 2500,  // 712 RIBBONCONTEXTSELLIM (선택 도구 줄, 0 = 제한 없음)
  rolloverTips: false,          // 712 롤오버 특성 말풍선
  previewTheme: 'dark',         // 상세·주동·단위세대 미리보기: dark(어두운 바탕 하늘색 선, 시안 3) | light(흰 바탕)
  detailInsertScale: 'auto',    // 상세 넣을 축척: auto(상세에 적힌 대로) | 분모 숫자 문자열 '5' 등. 마지막에 고른 값(10-25 시안 ⑰)
  autoCorrect: {},              // 715 사용자 자동 교정 기록 {오타: 명령}
  commandUsage: {},             // 715 명령 사용 횟수(같은 점수 안 순서)
  plotStamp: {on: false, fields: ['drawing', 'sheet', 'datetime', 'scale'], corner: 'bottom-left', udf1: '', udf2: '', height: 2.5, offset: {x: 5, y: 3}},
});
const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const plainMap = (v, valueOk) => Object.fromEntries(Object.entries(v && typeof v === 'object' && !Array.isArray(v) ? v : {}).filter(([k, x]) => /^[A-Z0-9_\-가-힣.?]{1,40}$/i.test(k) && valueOk(x)).slice(0, 2000));

export function normalizePrefs(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {}, d = PREF_DEFAULTS;
  const stamp = {...d.plotStamp, ...(r.plotStamp && typeof r.plotStamp === 'object' ? r.plotStamp : {})};
  return {
    layIsoMode: r.layIsoMode === 'lock' ? 'lock' : 'off',
    linetypePatterns: r.linetypePatterns === 'legacy' ? 'legacy' : 'lin',
    inputSearchDelay: clampInt(r.inputSearchDelay ?? d.inputSearchDelay, 0, 10000, d.inputSearchDelay),
    propObjLimit: clampInt(r.propObjLimit ?? d.propObjLimit, 100, 1000000, d.propObjLimit),
    ribbonContextSelLimit: clampInt(r.ribbonContextSelLimit ?? d.ribbonContextSelLimit, 0, 1000000, d.ribbonContextSelLimit),
    rolloverTips: r.rolloverTips === true,
    previewTheme: r.previewTheme === 'light' ? 'light' : 'dark',
    detailInsertScale: Number(r.detailInsertScale) > 0 && Number(r.detailInsertScale) <= 10000 ? String(Number(r.detailInsertScale)) : 'auto',
    autoCorrect: plainMap(r.autoCorrect, (x) => typeof x === 'string' && /^[A-Z0-9_]{1,40}$/.test(x)),
    commandUsage: plainMap(r.commandUsage, (x) => Number.isInteger(x) && x > 0),
    plotStamp: {on: stamp.on === true, fields: (Array.isArray(stamp.fields) ? stamp.fields : []).filter((f) => STAMP_FIELDS.includes(f)), corner: ['bottom-left', 'bottom-right', 'top-left', 'top-right'].includes(stamp.corner) ? stamp.corner : 'bottom-left',
      udf1: String(stamp.udf1 || '').slice(0, 80), udf2: String(stamp.udf2 || '').slice(0, 80), height: Math.max(1, Math.min(10, Number(stamp.height) || 2.5)), offset: {x: Math.max(0, Math.min(50, Number(stamp.offset?.x) || 0)), y: Math.max(0, Math.min(50, Number(stamp.offset?.y) || 0))}},
  };
}
export function loadPrefs(storage) {
  try { return normalizePrefs(JSON.parse(storage?.getItem(PREFS_KEY) || '{}')); } catch { return normalizePrefs({}); }
}
export function savePrefs(storage, prefs) {
  const clean = normalizePrefs(prefs);
  try { storage?.setItem(PREFS_KEY, JSON.stringify(clean)); } catch {}
  return clean;
}
