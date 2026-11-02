// ACAD200 영역 3 — 선택·입력 세부 설정(AutoCAD 시스템 변수에 해당). 설정을 몰라도 맞게 동작하는 기본값을 두고,
// 기본 동작을 바꾼 항목은 여기서 예전 동작으로 되돌릴 수 있다. 저장은 이 PC 의 localStorage 하나.
export const INPUT_PREFS_KEY='barun-input-prefs-v1';
export const INPUT_PREF_DEFAULTS=Object.freeze({
  pressClassifier:true,     // 301 클릭·끌기 판정(시간+거리). 끄면 예전(마우스 0.5px 즉시 끌기)
  lassoSelect:false,        // 302 빈 곳 누른 채 끌기 = 올가미. 끄면 사각 창(예전)
  selectionPreview:3,       // 303 호버 미리보기 비트: 1 대기 중, 2 명령의 선택 단계
  windowPreview:true,       // 304 선택창 미리 강조
  windowPreviewLimit:20000, // 304 후보가 이보다 많으면 미리보기 생략
  selectionCycling:2,       // 305 겹친 객체: 2 목록 표시(예전), 1 목록 없이 Shift+Space 순환만, 0 끔
  gripObjLimit:100,         // 307 고른 객체가 이보다 많으면 그립 숨김. 0 = 한도 없음(예전)
  gripHover:true,           // 309 호버 그립 색·구간 가운데 그립
  osnapOptions:3,           // 314 스냅에서 빼기: 1 해치, 2 치수 보조선
  trackPauseMs:100,         // 315 추적점 얻기까지 머무는 시간
  polarAddAngles:'',        // 316 추가 각도(쉼표로)
  polarRelative:false,      // 316 직전 선분 기준 상대 각
  polarDistance:0,          // 316 극좌표 거리 단위(0 끔)
  dynPiCoords:0,            // 317 동적 입력 두 번째 점부터: 0 상대(AutoCAD), 1 절대(예전)
  typeAhead:true,           // 319 바쁠 때 클릭·Enter 줄 세우기
  shortcutMenuMs:300,       // 320 명령 중 오른쪽 단추를 이만큼 누르면 옵션 메뉴(0 = 늘 Enter, 예전)
  dblclkEdit:true,          // 321 더블클릭 편집
  hatchPickMode:'weak',     // 322 무늬 해치 빈칸: weak 다른 객체 없을 때만, drawn 안 집힘(AutoCAD), interior 예전
  selectSimilarMode:130,    // 325 비슷한 객체: 1 색, 2 레이어, 4 선종류, 64 스타일, 128 이름 (종류는 늘 같음)
});
const CHOICES={hatchPickMode:['weak','drawn','interior']};
const NUMBER_RANGES={selectionPreview:[0,3],windowPreviewLimit:[0,1000000],selectionCycling:[-2,2],gripObjLimit:[0,32767],osnapOptions:[0,7],trackPauseMs:[1,2000],polarDistance:[0,1e9],dynPiCoords:[0,1],shortcutMenuMs:[0,5000],selectSimilarMode:[0,255]};
/** 저장값을 기본값과 합치고 범위를 벗어난 값·모르는 키는 버린다. */
export function normalizeInputPrefs(raw){
  const out={...INPUT_PREF_DEFAULTS};
  if(!raw||typeof raw!=='object')return out;
  for(const [key,fallback] of Object.entries(INPUT_PREF_DEFAULTS)){
    if(!(key in raw))continue;
    const value=raw[key];
    if(typeof fallback==='boolean'){if(typeof value==='boolean')out[key]=value;}
    else if(typeof fallback==='number'){const n=Number(value),[lo,hi]=NUMBER_RANGES[key]||[-Infinity,Infinity];if(Number.isFinite(n)&&n>=lo&&n<=hi)out[key]=n;}
    else if(typeof value==='string'&&(!CHOICES[key]||CHOICES[key].includes(value)))out[key]=value.slice(0,200);
  }
  return out;
}
export function loadInputPrefs(storage){try{return normalizeInputPrefs(JSON.parse(storage?.getItem(INPUT_PREFS_KEY)||'null'));}catch{return {...INPUT_PREF_DEFAULTS};}}
export function saveInputPrefs(storage,prefs){try{storage?.setItem(INPUT_PREFS_KEY,JSON.stringify(normalizeInputPrefs(prefs)));return true;}catch{return false;}}

// 설정 창 칸. [키, 종류, 이름, 도움말, 고를 값]
export const INPUT_PREF_FIELDS=[
  ['pressClassifier','check','클릭·끌기 판정(시간+거리)','짧게 누르면 몇 px 밀려도 클릭, 잠깐 누른 뒤 움직이면 끌기. 끄면 0.5px 만 움직여도 끌기(예전).'],
  ['lassoSelect','check','누른 채 끌면 올가미 선택','빈 곳을 누른 채 끌면 지나간 길로 고릅니다. Space 로 창·걸침·울타리를 바꿉니다.'],
  ['selectionPreview','select','마우스를 올리면 집힐 객체 표시','',[[3,'항상'],[1,'명령 없을 때만'],[2,'명령의 선택 단계만'],[0,'끔']]],
  ['windowPreview','check','선택창에 걸릴 객체 미리 표시','상자를 끄는 동안 걸리는 객체와 개수를 보여 줍니다.'],
  ['selectionCycling','select','겹친 객체','',[[2,'목록 표시'],[1,'목록 없이 Shift+Space 로 돌리기'],[0,'끔'],[-2,'끔(켜면 목록)'],[-1,'끔(켜면 돌리기)']]],
  ['gripObjLimit','number','그립 표시 한도(개)','이보다 많이 고르면 그립을 숨겨 화면이 빨라집니다. 0 은 한도 없음.'],
  ['gripHover','check','그립 강조·구간 가운데 그립','마우스를 올린 그립을 다른 색으로, 폴리선 구간 가운데에 그립을 더합니다. 그립 위 오른쪽 클릭 = 그립 메뉴.'],
  ['osnapOptions','select','스냅에서 뺄 것','',[[3,'해치·치수 보조선'],[1,'해치만'],[2,'치수 보조선만'],[0,'빼지 않음']]],
  ['polarAddAngles','text','극좌표 추가 각도','예: 15, 75 (쉼표로)'],
  ['polarRelative','check','극좌표를 직전 선분 기준으로',''],
  ['polarDistance','number','극좌표 거리 단위(mm)','0 이면 끔. 예: 100 이면 100 단위로 길이가 붙습니다.'],
  ['dynPiCoords','select','동적 입력 두 번째 점','',[[0,'상대 좌표(AutoCAD) · #X,Y 는 절대'],[1,'절대 좌표(예전) · @X,Y 는 상대']]],
  ['typeAhead','check','바쁠 때 클릭·Enter 기억','계산이 끝나면 차례로 처리합니다. Esc 는 지웁니다.'],
  ['shortcutMenuMs','number','오른쪽 단추 길게 = 옵션 메뉴(ms)','명령 중 오른쪽 단추를 이만큼 누르고 있으면 옵션 메뉴, 짧게는 Enter. 0 은 늘 Enter.'],
  ['dblclkEdit','check','더블클릭으로 편집','문자=제자리 편집, 블록=블록 편집, 해치=해치 편집, 폴리선=정점 편집.'],
  ['hatchPickMode','select','무늬 해치 빈칸을 누르면','무늬 선·경계는 늘 집힙니다. 칠한 해치는 늘 안쪽이 집힙니다.',[['weak','다른 객체가 없을 때만 해치'],['drawn','집지 않음(선택창, AutoCAD)'],['interior','해치(예전)']]],
  ['selectSimilarMode','select','비슷한 객체 선택 기준','',[[130,'종류+레이어+이름'],[2,'종류+레이어'],[0,'종류만'],[131,'종류+레이어+이름+색'],[134,'종류+레이어+이름+선종류']]],
];
/** root 안에 설정 칸을 만든다. onChange(prefs) 는 바뀔 때마다. 반환: 다시 채우기 함수. */
export function renderInputPrefControls(root,getPrefs,onChange,doc=root?.ownerDocument||globalThis.document){
  if(!root||!doc)return ()=>{};
  root.replaceChildren();const inputs=new Map();
  for(const [key,kind,label,help,choices] of INPUT_PREF_FIELDS){
    const wrap=doc.createElement('label');wrap.className=kind==='check'?'input-pref check':'field compact input-pref';
    let input;
    if(kind==='select'){input=doc.createElement('select');for(const [value,text] of choices){const o=doc.createElement('option');o.value=String(value);o.textContent=text;input.append(o);}}
    else{input=doc.createElement('input');input.type=kind==='check'?'checkbox':kind==='number'?'number':'text';if(kind==='number')input.min='0';}
    input.dataset.inputPref=key;if(help)wrap.title=help;
    if(kind==='check')wrap.append(input,doc.createTextNode(label));else wrap.append(doc.createTextNode(label),input);
    input.addEventListener('change',()=>{
      const prefs={...getPrefs()};
      prefs[key]=kind==='check'?input.checked:(kind==='text'||typeof INPUT_PREF_DEFAULTS[key]==='string')?input.value:Number(input.value);
      onChange(normalizeInputPrefs(prefs));fill();
    });
    inputs.set(key,{input,kind});root.append(wrap);
  }
  const fill=()=>{const prefs=getPrefs();for(const [key,{input,kind}] of inputs){if(kind==='check')input.checked=!!prefs[key];else input.value=String(prefs[key]);}};
  fill();return fill;
}
