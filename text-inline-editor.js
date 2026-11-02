// 503 제자리 문자 편집기 보조: 읽기 좋은 최소 크기, 반투명 배경, 한글 조합 중 Enter 무시.
// AutoCAD IPE 는 편집 영역 뒤에 반투명(알파 0xc2 ≈ 76%) 배경을 깔고, 너무 작은 글자는 화면을 옮겨 읽게 한다.
// 바른 CAD 는 화면을 옮기지 않고(작업 중인 보기를 지킨다) 편집 칸만 읽을 수 있는 크기로 키우고 배율을 알려 준다.

/** 편집 칸 글자의 최소 화면 크기(px). 1/100 도면의 작은 글자(3px)도 읽을 수 있게. */
export const MIN_EDIT_PX = 14;
/** 배경 불투명도(AutoCAD 0xc2/0xff). */
export const EDITOR_BACKGROUND_ALPHA = 0xc2 / 0xff;

/**
 * 도면 글자의 실제 화면 크기 → 편집 칸 크기. 작으면 MIN_EDIT_PX 로 키우고 배율 안내 문구를 준다.
 * @returns {{fontSize:number, real:number, magnified:boolean, title:string}}
 */
export function inlineEditorSize(realPx, minPx = MIN_EDIT_PX) {
 const real = Math.max(0.1, Number(realPx) || 0);
 const fontSize = Math.max(minPx, real), magnified = fontSize > real + 1e-9;
 return {fontSize, real, magnified, title: magnified ? `읽기 좋게 크게 표시 중 ×${(fontSize / real).toFixed(1)} · 저장되는 글자 크기는 그대로입니다` : ''};
}

/**
 * 편집 칸 키 처리. 한글·일본어 입력기가 글자를 조합하는 중의 Enter·Esc 는 입력기 몫이라 그대로 둔다
 * (예전에는 "한" 을 조합하던 Enter 가 바로 저장으로 이어져 마지막 글자가 빠졌다).
 * @returns {'compose'|'cancel'|'commit'|null}
 */
export function inlineEditorKeyAction(event) {
 if (event?.isComposing || event?.keyCode === 229) return 'compose';
 if (event?.key === 'Escape') return 'cancel';
 if (event?.key === 'Enter' && !event.shiftKey) return 'commit';
 return null;
}

/** 캔버스 배경색(rgb/rgba/#rrggbb) → 반투명 배경색. 모르는 형식이면 어두운 기본색. */
export function inlineEditorBackground(color) {
 const s = String(color || '').trim();
 let m = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)(?:[\s,\/]+(\d*\.?\d+))?\s*\)$/i.exec(s);
 let rgb = m ? [m[1], m[2], m[3]].map(Number) : null;
 if (m && m[4] !== undefined && Number(m[4]) === 0) rgb = null;   // 투명 배경이면 기본색
 if (!rgb && (m = /^#([0-9a-f]{6})$/i.exec(s))) rgb = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
 if (!rgb) rgb = [16, 24, 32];
 return `rgba(${rgb.map(v => Math.round(v)).join(',')},${EDITOR_BACKGROUND_ALPHA.toFixed(2)})`;
}
