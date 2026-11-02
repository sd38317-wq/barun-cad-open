const ELECTRON_REMOTE_PREFIX=/^Error invoking remote method ['"][^'"]+['"]:\s*/i;
const ERROR_PREFIX=/^(?:Error|Exception|DOMException):\s*/i;

const TRANSLATIONS=[
  [/Failed to get ['"]documents['"] path/i,'문서 폴더 위치를 찾지 못했습니다. 저장 위치를 직접 선택하거나 Windows 문서 폴더 설정을 확인하세요.'],
  [/Failed to get ['"]downloads['"] path/i,'다운로드 폴더 위치를 찾지 못했습니다. Windows 폴더 설정을 확인하세요.'],
  [/Failed to get ['"]desktop['"] path/i,'바탕 화면 위치를 찾지 못했습니다. Windows 폴더 설정을 확인하세요.'],
  [/EACCES|EPERM|permission denied|access is denied/i,'파일 또는 폴더에 접근할 권한이 없습니다. 저장 위치와 권한을 확인하세요.'],
  [/ENOSPC|disk (?:is )?full|no space left/i,'저장 공간이 부족합니다. 디스크 여유 공간을 확보하세요.'],
  [/ENOENT|no such file or directory|file not found/i,'필요한 파일이나 폴더를 찾지 못했습니다. 경로를 확인하세요.'],
  [/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network error|Failed to fetch|fetch failed/i,'로컬 처리 엔진에 연결하지 못했습니다. 잠시 후 다시 시도하세요.'],
  [/invalid json|unexpected token.*json|malformed json/i,'파일 내용이 올바르지 않아 읽지 못했습니다.'],
  // A38(10-20): 예전엔 "원인을 확인하지 못했습니다" 만 떠 한글 코드 문제인 줄 알 수 없었다.
  [/codec can't (?:de|en)code|UnicodeDecodeError|UnicodeEncodeError/i,'도면 글자의 문자 코드(한글 코드)를 읽지 못했습니다. 도면을 DXF 2018 이나 BCAD 로 다시 저장한 뒤 시도하세요.'],
  [/out of memory|allocation failed|heap limit/i,'메모리가 부족해 작업을 완료하지 못했습니다. 도면을 정리한 뒤 다시 시도하세요.'],
  [/operation (?:was )?(?:cancelled|canceled)|aborted/i,'작업을 취소했습니다.'],
  // AI(MCP) 도면 연결 확인 오류. 영어라 기본 문구('작업을 완료하지 못했습니다')로 숨던 것을 원인과 다음 할 일로 알린다.
  [/CAD target changed/i,'그 사이 도면이 바뀌었습니다(target changed). cad_get_document 로 다시 읽은 뒤 미리보기부터 다시 하세요.'],
  [/CAD editor is busy/i,'CAD 화면이 다른 작업(명령 실행·도면 전환) 중입니다(editor busy). 끝난 뒤 다시 시도하세요.'],
  [/CAD request (?:is invalid or )?expired/i,'요청 시간이 지났습니다(request expired). cad_get_document 로 다시 읽고 처음부터 다시 하세요.'],
  [/Expected revision differs/i,'도면 판 번호가 미리보기 때와 다릅니다(revision differs). cad_get_document 로 다시 읽고 미리보기부터 다시 하세요.'],
  [/CAD current properties changed/i,'현재 레이어·색 같은 설정이 미리보기 뒤 바뀌었습니다. cad_preview 를 다시 부른 뒤 그 결과로 실행하세요.'],
];

const TECHNICAL_DETAIL=/\b(?:Error|Exception|TypeError|RangeError|ReferenceError|undefined|null|NaN|Cannot|cannot|failed|Failed|invalid|Invalid|unexpected|Unexpected|crashed|timeout|timed out|E[A-Z]{3,})\b|\bat\s+\S+\s*\(|\bis not a function\b|\bof undefined\b/;
/* 콜론 뒤 상세가 "내부 오류 문장"인지, 사용자에게 보여 줄 값(파일 이름·블록 이름·입력값)인지 가른다. */
export function looksTechnical(detail){
  const text=String(detail??'').trim();
  if(!text)return false;
  if(/[가-힣]/.test(text))return false;
  if(TECHNICAL_DETAIL.test(text))return true;
  for(const [pattern] of TRANSLATIONS)if(pattern.test(text))return true;
  // 영문 단어가 여럿 이어진 긴 문장은 기술 메시지로 본다. 짧은 이름·값(DOOR-01, "FL+3,000", A-WALL)은 그대로 보여 준다.
  return /^[A-Za-z][A-Za-z\s.,'()-]{39,}$/.test(text)||text.split(/\s+/).filter(word=>/^[A-Za-z]{3,}$/.test(word)).length>=4;
}
export function technicalErrorMessage(value){
  const source=value instanceof Error?value.message:value;
  return String(source??'').replace(ELECTRON_REMOTE_PREFIX,'').replace(ERROR_PREFIX,'').replace(/\s+/g,' ').trim();
}

export function userErrorMessage(value,fallback='작업을 완료하지 못했습니다. 다시 시도하세요.'){
  const raw=technicalErrorMessage(value);
  if(!raw)return fallback;
  for(const [pattern,message] of TRANSLATIONS)if(pattern.test(raw))return message;

  // "도면 열기 실패: <영문 내부 오류>"처럼 이미 붙은 한글 문맥은 살리고
  // 영문 기술 상세만 사용자 화면에서 감춘다.
  // 단, '레벨 문자를 읽을 수 없습니다: "FL+3,000"' 이나 '블록 이름을 찾을 수 없습니다: DOOR-01' 처럼
  // 콜론 뒤가 사용자에게 보여 줘야 할 값(짧고 기술 오류 낱말이 없음)이면 그대로 둔다.
  const contextual=raw.match(/^([^:]{1,80}[가-힣][^:]{0,80}):\s*(.+)$/);
  if(contextual){
    const detail=contextual[2];
    if(!looksTechnical(detail))return raw;
    return `${contextual[1]}: ${userErrorMessage(detail,'원인을 확인하지 못했습니다. 다시 시도하세요.')}`;
  }

  // 프로그램이 직접 만든 한글 안내는 명령명·확장자 같은 영문 약어가 있어도 유지한다.
  if(/[가-힣]/.test(raw))return raw;
  return fallback;
}
