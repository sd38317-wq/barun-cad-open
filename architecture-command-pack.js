import {toolCardIconSvg} from './tool-card-icons.js';
import {referenceCommands} from './별도개발/건축CAD보조명령/src/reference-command-catalog.js';
import {referenceCommandIconSvg} from './별도개발/건축CAD보조명령/src/reference-command-icons.js';
import {COMMANDS,resolveCommand,defaultAliases,registerManualLabels} from './commands.js';
import {MENU_CATALOG} from './menu-catalog.js';

// 바른 CAD 리습 aliases frequently collide with Barun CAD aliases.  This table is
// deliberately explicit: a label was checked before a native command was
// assigned.  Never infer a native command from an alias alone.
const NATIVE_COMMANDS=Object.freeze({
 'COM':'COM','CT':'CT','CV':'CV','STT':'STT','(=,-,*,/)':'CALC00',
 'FR':'FM','FM':'FM','XT':'XT','B':'BRK','CB':'CB',
 'STR':'STR','DMD':'DMD','DRL':'DRL','PC':'PC','PV':'PLINEEDIT',
 'PVL':'PVL','PVR':'SIMPLIFY','PVS':'PVS','PVV':'PLINEEDIT','00':'CALC00','ABC':'ABC','LIS':'LEN',
 'MRT':'MRT','AE':'AE','CDB':'CDB','DAR':'DAR','DM':'DM','M2':'M2',
 'PY':'PY','AHM':'AHM','SPN':'SPN','SAR':'SAR','SCA':'SCA', 'DAC':'POLARARRAY','DVC':'DVC','EXL':'EXL','JL':'JL','MC':'MC',
 'MII':'MIRROR','MM':'MM','OA':'OA','OAA':'OAA','OB':'OB','OC':'OC','OM':'OM',
 'RM':'RM','RR':'RR','SM':'SM','SS':'SS',
 'CLI':'CLI','BLI':'BLI','COL':'COL','STB':'STB','BE':'BE',
 'D1':'D1','D2, D3':'D2','DOR':'DOR','W1':'W1','W2,W3':'W2','WO':'WO','FL':'FL','FT':'FT','FX':'FX',
 'CEN':'CEN','CEP':'CEP','ELV':'ELV','INS':'INS','PK':'PK','STC':'STC','STP':'STP','WAL':'WALDRAW',
 // 2차 병렬 작업(2026-09-21) 유틸·카드·종이공간
 'DTP':'DTP', 'DIB':'DIB', 'BRO':'BRO', 'BB':'BB', 'BAT':'BAT', 'FE':'FE', 'CUT':'CUT', 'CALENDAR':'CALENDAR','DKF':'DKF','QRC':'QRC', 'LII':'LII','REX':'REX', 'XRL':'XRL','XRC':'XRC','XRR':'XRR', 'BAD':'BAD','BBL':'BBL','BLA':'BLA', 'MFB':'MFB','CMW':'CMW','ELM':'ELM','K':'K','PLM':'PLM','PPB':'PPB','RD':'RD','SL':'SL','V':'VSYM','X':'XSYM','XZ':'XZ','OOL':'OOL','MTLT':'MTLT','LEX':'LEX','LXP':'LXP','LDA':'LDA','CDE':'CDE','DCV':'DCV','DDT':'DDT','DSE':'DSE','CON':'CON','HEX':'HEX','RND':'RND','DFS':'DFS','DTS':'DTS','FLT':'FLT','GEE':'GEE','STL':'STL','CER':'CER','PBD':'PBD','SAB':'SAB','TBC':'TBC','EXP':'EXP','ON':'ON','OPA':'OPA','xiUnintall':'BRUNINSTALL','AON':'AON','AOFF':'AOFF','A0':'A0','A1':'A1','FCC':'FCC','MSL':'MSL','QQ':'QQ','xiBackup':'BRBACKUP','xiRestore':'BRRESTORE','RLD':'RLD','KCI':'KCI','KCL':'KCL','MTB1':'MTB1','MTB2':'MTB2','EED':'EED','EPD':'EPD','SLP':'SLP','BLS':'BLS','TRUSS':'TRUSS','CTR':'CTR','DDB':'DDB','HGRID':'HGRID','DEV':'DEV','ISD':'ISD','PZ':'PZ', 
 // 1차 병렬 작업(2026-09-21) 카드·유틸 묶음
 'LFF':'LFF','LFK':'LFK','LTG':'LTG','LOS':'LOS','LLC':'LLC','LFC':'LFC','ECO':'ECO','ECF':'ECF','ESO':'ESO', 'ELY':'ELY','LCD':'LCD','LCM':'LCM', 'LTM':'LTM','LQT':'LQT','LST':'LST','SLC':'SLC','TLL':'TLL','TTL':'TTL','DEE':'DEE',  'CDN':'CDN','COI':'COI','COR':'COR','EDP':'EDP','INA':'INA','LMA':'LMA','LNA':'LNA','MAC':'MAC','NUC':'NUC','QD':'QD','BA':'BA','HV':'HV','HW':'HW','ND':'ND','NP':'NP','NS':'NS','3TP':'3TP','2DP':'2DP','BOO':'BOO','BS':'BS','CBJ':'CBJ','JUL':'JUL','PAA':'PAA','PBB':'PBB','PEC':'PEC','PET':'PET','PJ':'PJ','PW':'PW','PWD':'PWD','UFD':'UFD','XLD':'XLD','ZIGZAG':'ZIGZAG','CIN':'CIN','CR':'CR','CTL':'CTL','CNL':'CNL','DDE':'DDE', 'OE':'OE','OO':'OO','OT':'OT','OI':'OI','RDC':'RDC', 'WR':'WR','CW':'CW','DHR':'DHR',
 'ABX':'ABX','BAM':'BAM','BCC':'BCC','BCO':'BCO','BEX':'BEX','BCH':'BCH',
 'BIN':'BIN','BNM':'BNM','BRM':'BRM','BRN':'BRN','BSC':'BSC','EAR':'EAR','M2B':'M2B', 'MX':'XCLIP','XCX':'XCX',
 'A2M':'A2M','ABE':'ABE','FTT':'FTT','MDF':'MDF','MSK':'MSK','T2M':'T2M','TFF':'TFF',
 'CTX':'CTX','FAM':'FAM','FAR':'FAR','TAP':'TAP','TC':'TC','TD':'TD','TE':'TE',
 'TEC':'TEC','TJ':'TJ','TM':'TM','TO':'TO','TOA':'TOA','TS':'TS','TSA':'TSA','TSE':'TSE',
 'TSH':'TSH','TSO':'TSO','TSP':'TSP','TST':'TST','TSW':'TSW','TW':'TW','TSM':'TSM','SE':'SE',
 'SEB':'SEB','SER':'SER','LF':'LAYISO','LL':'LAYOFF','LLL':'LLL','LK':'LAYLOCK','LO':'LO','LOO':'LOO',
 'LUI':'LUI','LU':'LU','LUK':'LAYUNLOCK','EOO':'SHOWALL','ESF':'HIDE','LAM':'LAM',
 'LC':'LC','LCC':'LCC','LCO':'LCO','LCS':'LCS','LE':'LE','LP':'LP','LRN':'LRN','LRL':'LRL',
 'TII':'TII','DAT':'DAT','LTX':'LTX','NUMC':'NUMC','QT':'QT','QW':'QW','TIC':'TIC','TIE':'TIE','TIN':'TIN',
 'TIP':'TIP','TOO':'TOO','TTT':'TTT','TX':'TX','CM':'CM','CSL':'CSL','DDM':'DDM','ESS':'ESS','SCB':'SCB','SSL':'SSL','WSL':'WSL','WU':'WU',
 'BAK':'BAK', 'PB':'PB','PBM':'PBM','PPP':'PPP','PUA':'PUA','SVS':'SVS','MK':'MK','RUB':'RUB','SOL':'SOL',
 'LSE':'LSE','TL':'TL','CC':'CC','DG':'DG','DH':'DH','DLA':'DLA','DLL':'DLL','DPL':'DPL','DQ':'DQ','DSC':'DSC',
 'DSM':'DSM','DTM':'DTM','DTO':'DTO','DTT':'DTT','DU':'DU','ED':'ED','IL':'IL','LX':'LX','SD':'SD',
 'BPT':'BPT','C2E':'C2E','E2C':'E2C','GDD':'GDD','HB':'HATCHB','HC':'HC','HM':'HATCHMERGE','HP':'HP','HPM':'HPM','HR':'HR','HT':'HT','RDS':'RDS','SHO':'SHO','RDT':'RDT','TAJ':'TAJ','TB':'TB',
 'TBM':'TBM','TBT':'TBT','BMT':'BMT','DAS':'DAS','DBC':'DBC','DBS':'DBS',
 'DSB':'DSB','MDL':'MDL','PBS':'PBS','TN':'TN','TOB':'TOB',
 'R3':'R3','RS':'RS','ATC':'ATC','OTC':'OTC','LSC':'LSC'
});

const CATEGORY_VISUALS=Object.freeze({
 '기타':'settings','자르기 및 끌기':'cut','도형 및 선':'polyline','면적 및 계산':'area',
 '열기, 닫기 및 설정':'folder','멀티도구':'transform','그리기':'draw','블럭 및 외부참조':'block',
 '문자 수정':'text-edit','선택':'select','레이어':'layers','종이공간':'layout',
 '문자 생성 및 증가':'text-add','기호':'symbol','출력 및 저장':'print','치수':'dimension',
 '해치 및 표':'hatch','도곽 관련':'sheet','도형 및 기호':'shape'
});

const PATHS=Object.freeze({
 settings:'<circle cx="32" cy="32" r="8"/><path d="M32 8v8m0 32v8M8 32h8m32 0h8M15 15l6 6m22 22 6 6M49 15l-6 6M21 43l-6 6"/>',
 cut:'<path d="M10 16l44 32M10 48l44-32"/><circle cx="16" cy="50" r="6"/><circle cx="16" cy="14" r="6"/>',
 polyline:'<path d="M8 48l14-30 17 27 17-29"/><circle cx="8" cy="48" r="3"/><circle cx="22" cy="18" r="3"/><circle cx="39" cy="45" r="3"/><circle cx="56" cy="16" r="3"/>',
 area:'<path d="M11 49L18 15l32 6 5 31z"/><path d="M21 41h22M25 34h14"/>',
 folder:'<path d="M7 19h20l6 7h24v28H7z"/><path d="M7 26h50"/>',
 transform:'<rect x="18" y="18" width="28" height="28"/><path d="M7 32h50M32 7v50m20-20 5-5-5-5M37 12l-5-5-5 5"/>',
 draw:'<path d="M9 51l12-3 32-32-9-9-32 32zM38 13l9 9M9 51l9-9"/>',
 block:'<rect x="9" y="9" width="46" height="46"/><rect x="19" y="19" width="26" height="26"/><path d="M9 24h10M45 40h10"/>',
 'text-edit':'<path d="M10 14h30M25 14v36M15 50h20"/><path d="M39 39l13-13 6 6-13 13-9 3z"/>',
 select:'<path d="M11 8l15 42 7-15 15-7z"/><path d="M37 38l14 14"/>',
 layers:'<path d="M7 24l25-14 25 14-25 14zM7 34l25 14 25-14M7 44l25 14 25-14"/>',
 layout:'<rect x="8" y="10" width="48" height="44"/><rect x="14" y="16" width="31" height="25"/><path d="M48 16v25M14 47h34"/>',
 'text-add':'<path d="M8 15h31M23 15v35M13 50h20"/><path d="M49 29v24M37 41h24"/>',
 symbol:'<circle cx="32" cy="32" r="22"/><path d="M32 10v44M10 32h44M20 20l24 24M44 20L20 44"/>',
 print:'<path d="M17 24V8h30v16M16 47H8V25h48v22h-8M17 39h30v17H17z"/><path d="M46 31h4"/>',
 dimension:'<path d="M9 18v28m46-28v28M9 32h46M9 32l7-5m-7 5 7 5M55 32l-7-5m7 5-7 5"/>',
 hatch:'<path d="M10 51L51 10M10 35l25-25M28 54l26-26"/><rect x="8" y="8" width="48" height="48"/><path d="M36 38h20M46 28v20"/>',
 sheet:'<rect x="8" y="7" width="48" height="50"/><path d="M39 42h17M39 49h17M16 17h31v17H16z"/>',
 shape:'<circle cx="22" cy="24" r="13"/><rect x="28" y="30" width="26" height="22"/><path d="M9 54l14-17 12 17"/>'
});


/* ── 실제 구현 상태(2026-09-24, 5.0.4 검토 반영) ──
   예전 집계는 NATIVE_COMMANDS 에 이름만 있으면 "완료(official)"로 셌다(검토 P11 · "완료 362 · 미완료 0").
   이제 본체 명령에 연결됐더라도 실행하면 "제공하지 않습니다/할 일이 없습니다" 안내만 하는 명령은 따로 두고
   미완료로 센다. 이 목록은 architecture-command-status.test.js 가 카드 모듈을 실제로 실행해 "안내만 하는 명령"을
   찾아 서로 같은지 확인한다(구현하면 여기서 빼야 시험이 통과한다). */
/* 2026-09-24 현재: 이번 검토에서 안내만 하던 20개(A0 A1 FCC MSL HEX HP HPM MTLT LEX BAK AON AOFF GEE STL FLT ON OPA 3TP FTT TFF)가
   모두 실제 동작으로 바뀌어 비어 있다. 안내만 하는 명령을 새로 두면 여기에 넣어야 시험이 통과한다. */
export const GUIDANCE_ONLY_ALIASES=Object.freeze(new Set([]));

/* ── 메뉴와 같은 이름·실제로 칠 명령(한 곳에서 정한다) ──
   도우미 목록 이름은 메뉴·F1 검색·명령창이 쓰는 COMMANDS 라벨(commands.js)을 그대로 쓴다(검토 U-M4: 이름 불일치 100여 개).
   매뉴얼 원래 이름은 manualLabel 로 남겨 검색에 쓴다. 카드 코드는 명령창에 쳤을 때 이 카드가 실제로 실행되는 이름을
   보여 준다(B→BRK, LIS→LEN, V→VSYM, X→XSYM 처럼 매뉴얼 별칭이 다른 바른 CAD 명령과 겹치는 경우). */
const COMMAND_BY_NAME=new Map(COMMANDS.map(command=>[command.name,command]));
const DEFAULT_ALIAS_SETTINGS=Object.freeze({aliases:defaultAliases()});
export function architectureCommandCode(alias,nativeCommand){
 if(!nativeCommand)return alias;
 const typable=/^[A-Za-z0-9]+$/.test(String(alias||''));
 if(typable&&resolveCommand(alias,DEFAULT_ALIAS_SETTINGS)===nativeCommand)return String(alias).toUpperCase();
 const core=COMMAND_BY_NAME.get(nativeCommand);
 if(core?.alias&&resolveCommand(core.alias,DEFAULT_ALIAS_SETTINGS)===nativeCommand)return core.alias;
 return nativeCommand;
}
const manualLabelOf=command=>({
 COM:'바른 CAD 단축키 설정',xiSetup:'바른 CAD 사용환경 설정',xiUnintall:'보조명령 설정 초기화',LX:'지시선 넣기'
}[command.alias]||String(command.label).replace(/바른 CAD 리습/gi,'바른 CAD').replace(/^Xi\s+/i,'바른 '));

/* 2026-09-21 숨김 → 2026-10-10 사용자 승인으로 삭제: 바른 CAD 구조상 만들 수 없는 29개(종이공간 13·파일·블럭창고 5·외부참조 4·켜 필터·순서 3·필드·입면적표·멀티라인·솔리드 순서 4).
   매뉴얼 원본 목록(reference-command-catalog.js 394행)은 출처 기록이라 그대로 두고, 앱 목록·카드 코드에서만 뺀다. */
export const REMOVED_REFERENCE_ALIASES=Object.freeze(new Set(["P2M","TRN","VPP","VPS","VA","VGL","VL","VLL","VMO","VR","VSD","VU","VUU","FFO","ZAE","IB","OL","Q1","QWB","xiSetup","B2X","CX","MFX","RBP","DOL","LFD","LFG","MLC","SB"]));
export const architectureSourceCommands=Object.freeze(referenceCommands.filter(command=>!REMOVED_REFERENCE_ALIASES.has(command.alias)).map(command=>{
 const nativeCommand=NATIVE_COMMANDS[command.alias]||null;
 const manualLabel=manualLabelOf(command);
 const commandCode=architectureCommandCode(command.alias,nativeCommand);
 const guidanceOnly=Boolean(nativeCommand)&&GUIDANCE_ONLY_ALIASES.has(command.alias);
 return Object.freeze({
  ...command,
  aliases:Object.freeze([...new Set([commandCode,...(command.aliases||[command.alias])])]),
  label:COMMAND_BY_NAME.get(nativeCommand)?.label||manualLabel,
  manualLabel,
  commandCode,
  nativeCommand,
  availability:nativeCommand?'native':'guided',
  implementation:Object.freeze({...(command.implementation||{}),cadIntegrated:Boolean(nativeCommand),status:!nativeCommand?'unconnected':guidanceOnly?'guidance':'complete'}),
  releaseStatus:!nativeCommand?'unavailable':guidanceOnly?'guidance':'official',
  visual:CATEGORY_VISUALS[command.category]||'shape'
 });
}));

// The production picker presents commands, not repeated manual rows. Keep the
// full source list above for traceability and merge only exact functional
// duplicates here so favorites, recent history and shortcut editing stay
// unambiguous.
/* 한 본체 명령에는 도우미 카드 하나만 둔다(2026-09-24 비평 2). 이름을 메뉴 라벨로 통일하자 FR/FM(→FM), PV/PVV(→PED),
   00/(=,-,*,/)(→CALC00), LII(두 분류)가 같은 이름·같은 동작 카드 두 장으로 보였다. 카드 코드가 매뉴얼 별칭과 같은 것(없으면
   먼저 나온 것)을 남기고, 빠진 카드의 매뉴얼 별칭·이름은 남은 카드의 검색어로 옮기며 저장된 즐겨찾기·단축키도 옮긴다. */
const visibleSource=architectureSourceCommands;
const keeperByNative=new Map();
for(const command of visibleSource){
 if(!command.nativeCommand)continue;
 const current=keeperByNative.get(command.nativeCommand);
 if(!current||(current.alias!==current.commandCode&&command.alias===command.commandCode))keeperByNative.set(command.nativeCommand,command);
}
const seenCommandKeys=new Map(),mergedIds={},mergedFrom=new Map();
const keptCommands=visibleSource.filter(command=>{
 const key=[command.category,command.label,command.alias].join('');
 const keeper=command.nativeCommand?keeperByNative.get(command.nativeCommand):null;
 const kept=seenCommandKeys.get(key)||(keeper&&keeper.id!==command.id?keeper.id:null);
 if(kept){mergedIds[command.id]=kept;(mergedFrom.get(kept)||mergedFrom.set(kept,[]).get(kept)).push(command);return false;}
 seenCommandKeys.set(key,command.id);
 return true;
});
export const architectureReferenceCommands=Object.freeze(keptCommands.map(command=>{
 const merged=mergedFrom.get(command.id);
 if(!merged)return command;
 return Object.freeze({...command,aliases:Object.freeze([...new Set([...command.aliases,...merged.map(m=>m.alias)])]),mergedManualLabels:Object.freeze(merged.map(m=>m.manualLabel))});
}));
/* 매뉴얼 원래 이름(합쳐진 카드 이름 포함)을 명령창 이름으로 등록한다. 다른 명령으로 이미 풀리는 이름은 건너뛴다(비평 8). */
registerManualLabels(architectureReferenceCommands.flatMap(command=>command.nativeCommand?[command.manualLabel,...(command.mergedManualLabels||[])].filter(label=>{
 const resolved=resolveCommand(label,DEFAULT_ALIAS_SETTINGS);return !resolved||resolved===command.nativeCommand;
}).map(label=>[label,command.nativeCommand]):[]));
/** 합쳐져 목록에서 빠진 명령 id → 남은 명령 id. 즐겨찾기·최근·단축키 저장값을 옮겨 사용자 설정을 보존한다. */
export const ARCHITECTURE_MERGED_COMMAND_IDS=Object.freeze(mergedIds);

export const architectureReferenceCategories=Object.freeze([...new Set(architectureReferenceCommands.map(command=>command.category))]);

/* 2026-10-06 사용자 지시 "102개 빼고 다 숨겨놔"(고르기 화면의 추천 101개): 이 카드만 건축 설계도구·명령 검색·건축 탭에 보인다.
   지우지 않는다 — 명령 이름을 직접 치면 그대로 실행되고, 건축 설계도구의 '숨긴 카드 보기'로 언제든 다시 보인다. */
const ARCHITECTURE_SHOWN_CARDS=Object.freeze({
 '기타':['STT'],
 '자르기 및 끌기':['FL','FT','FX','XT','B','BB'],
 '도형 및 선':['PC','PJ','PW'],
 '면적 및 계산':['AE','DAR','LIS','M2','PY','QD','BA','HV','SAR'],
 '멀티도구':['CR','CTL','DDE','OB','OC','OE','OO'],
 '그리기':['COL','D1','W1','WO','CEN','ELV','INS','PK','STP','WAL'],
 '블럭 및 외부참조':['BAM','BCO','BEX','BIN','BRN'],
 '문자 수정':['FAR','TC','TE','TJ','TM','TOA','TS','TSO'],
 '레이어':['LF','LTG','LL','LK','LO','LOO','LUI','LU','LUK','LAM','LC','LCO','LRN'],
 '문자 생성 및 증가':['NUMC','QT','QW','TIC','TIE'],
 '기호':['CM','ELM','PLM','SCB','SSL'],
 '출력 및 저장':['BAK','PB','PPP','PUA','RLD','A0','A1','AON','AOFF','SOL','TBC'],
 '치수':['CC','CDE','DG','DH','DLA','DLL','DPL','DQ','DSC'],
 '해치 및 표':['C2E','CON','E2C','HM','HP','TB'],
 '도곽 관련':['DBC','MDL','TN']
});
const SHOWN_CARD_KEYS=new Set(Object.entries(ARCHITECTURE_SHOWN_CARDS).flatMap(([category,aliases])=>aliases.map(alias=>category+'|'+alias)));
export const architectureCardShown=command=>SHOWN_CARD_KEYS.has(command.category+'|'+command.alias);
/* 숨긴 카드가 자기 이름으로 가진 명령(TIN 등)만 명령 검색·건축 탭에서 뺀다. MIRROR·HIDE 같은 본체 명령, 남긴 카드가 쓰는
   명령, 건축 밖 탭에 정식으로 실린 명령(SE 등)은 그대로 보인다. */
const shownCardCommandNames=new Set(architectureReferenceCommands.filter(architectureCardShown).flatMap(command=>[command.nativeCommand,command.commandCode]));
const otherTabCommandNames=new Set(Object.entries(MENU_CATALOG).filter(([tab])=>tab!=='arch').flatMap(([,menu])=>menu.sections.flatMap(section=>section.commands)));
export const ARCHITECTURE_HIDDEN_COMMAND_NAMES=Object.freeze(new Set(architectureReferenceCommands
 .filter(command=>!architectureCardShown(command)&&command.nativeCommand&&command.nativeCommand===command.alias)
 .map(command=>command.nativeCommand)
 .filter(name=>!shownCardCommandNames.has(name)&&!otherTabCommandNames.has(name))));

export function architectureCommandIconSvg(command,{compact=false}={}){
 const alias=command.commandCode||command.aliases?.[0]||command.alias||command.command||'CAD';
 const normalized={...command,id:command.id||`BARUN-${alias}`,alias,aliases:command.aliases||[alias],label:command.label||alias,category:command.category||'그리기'};
 return referenceCommandIconSvg(normalized,{compact}).replace('class="reference-command-icon','class="architecture-command-icon reference-command-icon');
}
export const architectureCardIconSvg=(command,options)=>toolCardIconSvg(command)||architectureCommandIconSvg(command,options);

export function architectureCommandSearchText(command){
 return [command.alias,...(command.aliases||[]),command.commandCode,command.label,command.manualLabel,...(command.mergedManualLabels||[]),command.category,command.nativeCommand].filter(Boolean).join(' ').toLocaleLowerCase('ko');
}

/** 도우미 목록 상태 표시(정식 기능 / 안내만 / 미연결). */
export function architectureReleaseLabel(command){
 return command?.releaseStatus==='official'?'정식 기능':command?.releaseStatus==='guidance'?'안내만(미완료)':'미연결';
}

/* 집계: native = 본체 명령에 연결된 수(이름 매핑), official = 실제로 동작하는 수(완료),
   guidanceOnly = 연결됐지만 안내만 하는 수, unavailable/guided = 완료가 아닌 전체(미완료 = 안내만 + 미연결). */
export function architectureCommandSummary(){
 const native=architectureReferenceCommands.filter(command=>command.availability==='native').length;
 const official=architectureReferenceCommands.filter(command=>command.releaseStatus==='official').length;
 const guidanceOnly=architectureReferenceCommands.filter(command=>command.releaseStatus==='guidance').length;
 return {
  total:architectureReferenceCommands.length,
  sourceTotal:architectureSourceCommands.length,
  removed:REMOVED_REFERENCE_ALIASES.size,
  duplicatesRemoved:architectureSourceCommands.length-architectureReferenceCommands.length,
  native,
  unconnected:architectureReferenceCommands.length-native,
  guidanceOnly,
  official,
  guided:architectureReferenceCommands.length-official,
  unavailable:architectureReferenceCommands.length-official,
  categories:architectureReferenceCategories.length
 };
}

export const architectureNativeCommandMap=NATIVE_COMMANDS;
