// 보조명령 카드 공통 입력 검사·파일 내보내기 도우미(2026-09-24, 5.0.4 검토 D 영역).
// - isChecked: 폼 체크박스 값 판정. app.js form() 은 켜진 체크박스를 'on' 으로 보낸다(2026-09-24 수정, 꺼지면 키 없음).
//   다른 경로(시험·옛 설정·select 예/아니오)도 받도록 on·true·yes·1·불리언 true 를 켜짐으로 읽는다. 빈칸은 꺼짐.
// - boundedInteger/boundedNumber: 개수·분할 수·간격처럼 반복 횟수를 정하는 입력에 상한을 둔다.
//   상한이 없으면 1e15 같은 값이 그대로 반복문에 들어가 렌더러가 멈춘다(검토 보고 P2).
// - assertGeneratedCount: 간격/길이로 계산된 반복 횟수가 상한을 넘으면 한국어로 막는다.
// - downloadText: 카드에서 .pat/.lin/.txt/.bcad 같은 텍스트 파일을 내려받게 한다(브라우저·Electron 공통).

export const MAX_GENERATED_ITEMS = 5000;

export function isChecked(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  if (typeof value === 'number') return value !== 0;
  return ['on', 'true', 'yes', '1', 'y', 'checked'].includes(String(value).trim().toLowerCase());
}

const plainLabel = (label) => String(label || '값');

export function boundedInteger(value, {min = 1, max, label} = {}) {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (String(value ?? '').trim() === '' || !Number.isFinite(n)) throw Error(`${plainLabel(label)}에는 숫자를 입력하세요.`);
  if (!Number.isInteger(n) || n < min || (max !== undefined && n > max))
    throw Error(`${plainLabel(label)}은(는) ${min}~${max} 사이의 정수로 입력하세요.`);
  return n;
}

export function boundedNumber(value, {min = -Infinity, max = Infinity, label, exclusiveMin = false} = {}) {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (String(value ?? '').trim() === '' || !Number.isFinite(n)) throw Error(`${plainLabel(label)}에는 숫자를 입력하세요.`);
  if ((exclusiveMin ? n <= min : n < min) || n > max) {
    const low = exclusiveMin ? `${min}보다 크고` : `${min} 이상`;
    throw Error(`${plainLabel(label)}은(는) ${low} ${max} 이하로 입력하세요.`);
  }
  return n;
}

export function assertGeneratedCount(count, label, max = MAX_GENERATED_ITEMS) {
  if (!Number.isFinite(count) || count > max)
    throw Error(`${plainLabel(label)}이(가) 너무 많습니다(최대 ${max}개). 간격을 늘리거나 개수를 줄이세요.`);
  return count;
}

export function safeFileName(name, fallback = 'barun-cad') {
  const cleaned = String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().replace(/^\.+/, '');
  return (cleaned || fallback).slice(0, 120);
}

/** AI 연결 실행기(화면 없는 일꾼)가 명령을 돌리는 동안만 있다: 파일·클립보드·이어서 부를 명령을 모아 화면이 이어서 처리한다(command-runner.js followUps). */
export const commandFollowUps = () => globalThis.__barunCommandFollowUps || null;

export function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
  const doc = globalThis.document, later = commandFollowUps();
  if (later && !doc?.createElement) { later.downloads.push({filename, text: String(text), type}); return filename; }
  if (!doc?.createElement || typeof globalThis.Blob !== 'function' || !globalThis.URL?.createObjectURL)
    throw Error('이 화면에서는 파일을 내려받을 수 없습니다.');
  const blob = new Blob([text], {type});
  const url = URL.createObjectURL(blob), a = doc.createElement('a');
  a.href = url; a.download = filename;
  doc.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL?.(url), 4000);
  return filename;
}

/** 클립보드 쓰기·읽기. AI 연결 실행기에서는 쓰기는 모아 두고(화면이 이어서 씀), 읽기는 화면이 미리 읽어 넘긴 글을 쓴다. */
export async function clipboardWrite(text) {
  const later = commandFollowUps();
  if (later && !globalThis.navigator?.clipboard) { later.clipboard = String(text); return; }
  await navigator.clipboard.writeText(text);
}
export async function clipboardRead() {
  const later = commandFollowUps();
  if (later && !globalThis.navigator?.clipboard) {
    if (typeof later.clipboardIn === 'string') return later.clipboardIn;
    throw Error('클립보드 내용을 받지 못했습니다.');
  }
  return navigator.clipboard.readText();
}
