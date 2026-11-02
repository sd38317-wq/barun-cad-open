import {workflowCommands} from './workflow-names.js';
import {ARCH_LIBRARY,ARCH_LINKS} from './architectural-library.js';
import {validateExtraAliases,hasExtraAlias,AUTOCAD_COMMAND_MAP} from './pgp-aliases.js';
import {S7_COMMANDS} from './s7-command-names.js';
const workflowAliases={
 DIMSCALE:'DSCL',DIMEDIT:'DED',LEADER:'LDR',MULTIOFFSET:'OMO',POLARARRAY:'DAC',SELECTSIMILAR:'SSE',SELECTRANGE:'SERG',SELECTBOUNDARY:'SEBD',SIMPLIFY:'PVR',
 FINDREPLACE:'FRP',TEXTNUMBER:'TXN',TEXTINCREMENT:'TINC',TEXTMERGE:'TMRG',TEXTCOUNT:'TQC',NEARTEXTNAME:'NTN',
 LAYMERGE:'LAMG',LAYSTATE:'LAS',LAYSTANDARD:'LSTD',HATCHMERGE:'HM',LANDHATCH:'LH',
 BREAKMULTI:'BKM',TRIMBOUNDARY:'TRB',MULTIFILLET:'MFL',LENGTHADJUST:'LAD',OBJECTALIGN:'OAL',DIVIDECOPY:'DVCP',ANGLECOPY:'AGC',DOUBLEOFFSET:'DOF',CHAINOFFSET:'COF',PLINEEDIT:'PED',
 TEXTSTYLEMERGE:'TSMG',TEXTAFFIX:'TPX',TEXTSPLIT:'TXS',TEXTMASK:'TXM',ATTRIBUTETEXT:'ATX',DIMAFFIX:'DAX',DIMSTYLEMERGE:'DSMG',DIMEXTENSION:'DEX',DIMTEXTMOVE:'DTMV',QUICKDIM:'QDM',
 TABLEEDIT:'TBE',TABLECELLMERGE:'TCM',TABLESPACING:'TBSP',TABLEALIGN:'TBA',
 BLOCKREPLACE:'BRP',BLOCKCLEAN:'BCL',BLOCKBASE:'BBP',BLOCKCOUNT:'BCT',BLOCKEXPORT:'BEXP',XREFSTYLE:'XRS',XREFBIND:'XRB',
};
export const COMMANDS = [
 ...S7_COMMANDS,   // ACAD200 영역 7(레이어·배치·뷰포트·출력)
 ...[['TALIGN','문자 정렬'],['DIMCLEAN','치수 간격 정리'],['LEN','길이 합계'],['PC','폴리선 닫기']].map(([name,label])=>[name,label,name]),
 ['NUMCALC','숫자 계산','NUMCALC'],
 ['NUMDEC','숫자 계산 소수 자릿수','NDEC'],
 ['CALC','계산기','CAL'],
 ['AREATAKEOFF','폐합 경계 구적표 자동 작도','ATO'],
 ['M2','평을 ㎡로 변경','M2'],
 ['PY','㎡를 평으로 변환','PY'],
 ['APPLOAD','사용자 리습 추가','APPLOAD'],
 ['WALDRAW','벽 그리기 (구성 벽체)','WAL'],
 ['D1','간단문 그리기','D1'],['D2','상세문 그리기','D2'],['D3','상세문 그리기 (설정 2)','D3'],
 ['W1','고정창 그리기','W1'],['W2','미서기창 그리기','W2'],['W3','미서기창 그리기 (설정 2)','W3'],
 ['WO','개구부 그리기','WO'],
 ['STP','계단 평면 그리기','STP'],['STC','계단 입·단면 그리기','STC'],
 ['PK','주차장 구획 그리기','PK'],
 ['FL','L형 벽체 정리','FL'],['FT','T형 벽체 정리','FT'],['FX','X형 벽체 정리','FX'],
 // 1차 병렬 작업(2026-09-21): 카드 CW·DHR·COL + 바른 CAD 리습 유틸 묶음(켜·면적·도형선·멀티)
 ['LFF','선택 객체를 제외한 레이어 동결','LFF'],
 ['LFK','선택 레이어를 제외하고 잠금','LFK'],
 ['LTG','레이어 켜기/끄기 반전','LTG'],
 ['LOS','꺼진 레이어 중에서 선택하여 켜기','LOS'],
 ['LLC','선택 색상 레이어만 끄기','LLC'],
 ['LFC','선택된 색상 레이어만 켜기','LFC'],
 ['ECO','선택 색 객체만 켜기','ECO'],
 ['ECF','선택 색 객체만 끄기','ECF'],
 ['ESO','선택 객체 제외 끔','ESO'],
 ['ELY','선택 레이어 객체 모두 삭제','ELY'],
 ['LCD','색상별 레이어 목록으로 변경','LCD'],
 ['LCM','색 합치기','LCM'],
 ['LTM','선종류 합치기','LTM'],
 ['LQT','레이어별 객체 수 세기','LQT'],
 ['LST','도면의 모든 레이어 목록 작성','LST'],
 ['SLC','객체 색으로 레이어 색 변경','SLC'],
 ['TLL','가까운 문자 레이어를 선 레이어로','TLL'],
 ['TTL','문자 내용으로 레이어 생성','TTL'],
 ['DEE','에너지효율등급용 입면적도 작성','DEE'],
 ['CDN','북측 일조권 검토','CDN'],
 ['COI','숫자에 천단위 콤마 넣기','COI'],
 ['COR','숫자에 천단위 콤마 빼기','COR'],
 ['EDP','소수점 자릿수 수정','EDP'],
 ['INA','색인 숫자 더해서 목록만들기','INA'],
 ['LMA','레벨 복사 숫자 자동 변경','LMA'],
 ['LNA','레벨 숫자 일괄 변경','LNA'],
 ['MAC','중심선선택 면적선 만들기','MAC'],
 ['NUC','숫자에 일괄 계산 적용','NUC'],
 ['QD','두점의 거리를 문자로 표기','QD'],
 ['BA','공유면적 배분, 합산면적 기록','BA'],
 ['HV','사각형 가로X세로와 면적 표기','HV'],
 ['HW','삼각형 가로X세로와 면적 표기','HW'],
 ['ND','첫번째숫자 합/두번째숫자 합','ND'],
 ['NP','N번째 숫자 * N+1번째 숫자','NP'],
 ['NS','첫번째숫자 합-두번째숫자 합','NS'],
 ['3TP','3차원 폴리선을 일반 폴리선으로','TP3'],
 ['2DP','도형안 객체 다른형태 도형에 비추기','DP2'],
 ['BOO','폴리도형 합치기','BOO'],
 ['BS','절단선 기호 그리기','BS'],
 ['CBJ','등고선과 테두리 이어주기','CBJ'],
 ['JUL','교차된 선에 점프선 넣기','JUL'],
 ['PAA','동선 화살표 그리기','PAA'],
 ['PBB','객체 경계 박스 그리기','PBB'],
 ['PEC','자기 자리에서 수직선 그리기','PEC'],
 ['PET','평행선 끝점 잇기','PET'],
 ['PJ','폴리선 변경후 합치기','PJ'],
 ['PW','폴리선 두께 수정','PW'],
 ['PWD','폴리선 두께 주고 외곽선 그리기','PWD'],
 ['UFD','폴리선 펼치기','UFD'],
 ['XLD','객체에 긴 직선 그리기','XLD'],
 ['ZIGZAG','지그재그 폴리선 그리기','ZIGZAG'],
 ['CIN','교차점에 객체 복사','CIN'],
 ['CR','복사 후 회전','CR'],
 ['CTL','현재 레이어로 복사','CTL'],
 ['CNL','새 레이어로 복사','CNL'],
 ['DDE','겹친 객체 삭제','DDE'],
 ['OE','간격띄우기 후 원본 삭제','OE'],
 ['OO','현재 레이어로 간격띄우기','OO'],
 ['OT','허용공차선 띄우기','OT'],
 ['OI','붙어있는선까지 다 간격띄우기','OI'],
 ['RDC','무작위 복사하기','RDC'],
 ['WR','선복구 (중간객체 모두 삭제)','WR'],
 ['CW','커튼월창호 그리기','CW'],
 ['INS','단열재 그리기','INS'],
 // 2차 병렬 작업(2026-09-21): 블럭·기호·치수해치·출력설정 유틸 + 그리기 카드 11개 + 종이공간(없음) 13개
 ['LII','블록 내부 객체 정보 표시','LII'],
 ['REX','외부참조 다시 읽기','REX'],
 ['XRL','외부참조 목록','XRL'],
 ['XRC','외부참조 색 일괄 변경','XRC'],
 ['XRR','외부참조 레이어 설정 초기화','XRR'],
 ['BAD','블록에 객체 포함시키기','BAD'],
 ['BBL','블록의 삽입점들을 선으로 이어주기','BBL'],
 ['BLA','블록 내부 모든 레이어 변경','BLA'],
 ['MFB','블록 상태 변경','MFB'],
 ['CMW','구름형 수정 기호 입체화','CMW'],
 ['ELM','입단면 레벨 기호 그리기','ELM'],
 ['K','케이 기호 그리기','K'],
 ['PLM','평면 레벨 기호 그리기','PLM'],
 ['PPB','상세도 참조 기호 그리기','PPB'],
 ['RD','지붕배수구 기호 그리기','RD'],
 ['SL','경사도 표시','SL'],
 ['VSYM','브이 기호 그리기','VSYM'],
 ['XSYM','엑스 기호 그리기','XSYM'],
 ['XZ','엑스지 기호 그리기','XZ'],
 ['OOL','객체 외곽선 그리기','OOL'],
 ['MTLT','문자포함 선 모양 만들기','MTLT'],
 ['LEX','선 모양 내보내기','LEX'],
 ['LXP','선 모양대로 폭파하기','LXP'],
 ['LDA','지시선 끝점 정렬','LDA'],
 ['CDE','치수 문자 변경','CDE'],
 ['DCV','선형 치수로 변환','DCV'],
 ['DDT','치수보조선 감추기','DDT'],
 ['DSE','치수 모양 수정','DSE'],
 ['CON','콘크리트 해치','CON'],
 ['HEX','해치 내보내기','HEX'],
 ['RND','곡면 표현하기','RND'],
 ['DFS','도곽축척 확인','DFS'],
 ['DTS','날짜기록하기','DTS'],
 ['FLT','높이값 0으로 변경','FLT'],
 ['GEE','그룹 수정','GEE'],
 ['STL','다른 도면에서 가져오기','STL'],
 ['CER','미세하게 틀어진 도면 보정하기','CER'],
 ['PBD','출력용 박스 모두 지우기','PBD'],
 ['SAB','블록 파일로 저장 · 0번 레이어 · 나머지 정리','SAB'],
 ['TBC','배경색 흑/백 전환','TBC'],
 ['EXP','현 작업폴더 탐색기','EXP'],
 ['ON','현도면 다음파일 열기','ON'],
 ['OPA','저장없이 다시열기','OPA'],
 ['BRUNINSTALL','보조명령 설정 초기화','BRUNINSTALL'],
 ['AON','한영자동변환 작동','AON'],
 ['AOFF','한영자동변환 중단','AOFF'],
 ['A0','작업축 각도 직각으로','A0'],
 ['A1','객체 선택으로 작업축 각도 변경','A1'],
 ['FCC','사용 글꼴 모으기','FCC'],
 ['MSL','여러 파일 자동 정리','MSL'],
 ['QQ','도면 일괄 닫기','QQ'],
 ['BRBACKUP','사용자 설정 내보내기','BRBACKUP'],
 ['BRRESTORE','사용자 설정 불러오기','BRRESTORE'],
 ['RLD','출도 도장 넣기','RLD'],
 ['KCI','일자형 주방가구 그리기','KCI'],
 ['KCL','기역자형 주방가구 그리기','KCL'],
 ['MTB1','칸막이 화장실 그리기 1','MTB1'],
 ['MTB2','칸막이 화장실 그리기 2','MTB2'],
 ['EPD','에스컬레이터 평면 그리기','EPD'],
 ['SLP','사면 표시','SLP'],
 ['BLS','보 일람표 작성','BLS'],
 ['TRUSS','트러스 그리기','TRUSS'],
 ['CTR','차량 궤적 그리기','CTR'],
 ['DDB','배수판 그리기','DDB'],
 ['HGRID','바닥난방 파이프 그리기','HGRID'],
 ['DEV','전개도 그리기','DEV'],
 ['ISD','아이소메트릭그리기','ISD'],
 ['PZ','부분 확대도 그리기','PZ'],
 ['CALENDAR','달력 그리기','CALENDAR'],
 ['DKF','태극기 그리기','DKF'],
 ['QRC','큐알 코드 그리기','QRC'],
 // 3차 병렬 작업(2026-09-21): 이름만 매핑이던 95개 + 확인 필요 9개 + 미연결 7개를 실제 기능으로
 ['BPT','블록 해치 패턴 만들기','BPT'],
 ['GDD','줄눈 그리기(입면)','GDD'],
 ['HC','해치 복제','HC'],
 ['HP','해치기준점 변경','HP'],
 ['HPM','해치 문양 그리기','HPM'],
 ['HR','해치 꺼내 쓰기','HR'],
 ['HT','두께 입력 해치','HT'],
 ['RDS','무작위 솔리드해치','RDS'],
 ['SHO','내부객체로 해치선택','SHO'],
 ['TAJ','테이블문자에 폭 자동 변경','TAJ'],
 ['DTT','치수목록을 표로','DTT'],
 ['LSE','지시선 모양 변경','LSE'],
 ['TL','문자열에 지시선 넣기','TL'],
 ['DLA','치수 보조선 정렬','DLA'],
 ['DTM','겹친 치수문자 아래·옆으로 옮기기','DTM'],
 ['DTO','치수 보조 설명글 넣기','DTO'],
 ['CSL','절단면 기호','CSL'],
 ['DDM','다운표시','DDM'],
 ['ESS','전개도 방향','ESS'],
 ['WU','우오수라인 그리기','WU'],
 ['ATC','호를 선택해서 원그리기','ATC'],
 ['R3','3점으로 사각형 그리기','R3'],
 ['OTC','객체 접원 그리기','OTC'],
 ['DH','치수문자 원위치시키기','DH'],
 ['DU','치수 업데이트','DU'],
 ['IL','교차점을 찾아 길이 넣어 주기','IL'],
 ['RS','사각형 솔리드 박스 그리기','RS'],
 ['BCC','블록 레이어','BCC'],
 ['BCO','블록 내부 객체 꺼내기','BCO'],
 ['BNM','블록 이름 쓰기','BNM'],
 ['BRM','블록 내부 객체 삭제','BRM'],
 ['BRN','블록 이름 변경하기','BRN'],
 ['EAR','속성 블록 문자 유지 분해','EAR'],
 ['M2B','다중 삽입된 블록을 일반 블록으로 변경','M2B'],
 ['XCX','외부참조 자르기 분해 후 정리','XCX'],
 ['CV','객체선택, 현재 값을 변경','CV'],
 ['STT','도면초기설정','STT'],
 ['A2M','속성문자를 다행문자로 꺼내기','A2M'],
 ['FTT','필드문자를 일반문자로','FTT'],
 ['MDF','다행문자 특성제거','MDF'],
 ['T2M','문자를 다행문자로 변경','T2M'],
 /* ACAD200 영역 5(문자·주석·치수·지시선·표): 새 명령. 별칭은 이름 그대로(짧은 별칭은 사용자 몫). */
 ['FONTMAP','글꼴 대체표·대체 보고','FONTMAP'],
 ['SHXLOAD','SHX 선 글꼴 폭 읽기','SHXLOAD'],
 ['FIELD','필드 문자 넣기(날짜·파일 이름·면적)','FIELD'],
 ['UPDATEFIELD','필드 다시 계산','UPDATEFIELD'],
 ['ATTSYNC','블록 속성 동기화(배치·정의)','ATTSYNC'],
 ['TEXTALIGN','문자 고르게 정렬','TEXTALIGN'],
 ['OBJECTSCALE','주석 축척 표현 더하기·빼기','OBJECTSCALE'],
 ['CANNOSCALE','현재 주석 축척','CANNOSCALE'],
 ['ANNOAUTOSCALE','주석 축척 자동 더하기 켜기·끄기','ANNOAUTOSCALE'],
 ['ANNOALLVISIBLE','표현 없는 주석 보이기·숨기기','ANNOALLVISIBLE'],
 ['SCALELISTEDIT','축척 목록 편집','SCALELISTEDIT'],
 ['MLEADERALIGN','다중 지시선 정렬','MLEADERALIGN'],
 ['MLEADERCOLLECT','다중 지시선 모으기','MLEADERCOLLECT'],
 ['MLEADERSTYLE','다중 지시선 스타일','MLEADERSTYLE'],
 ['DATALINK','표 엑셀 연결','DATALINK'],
 ['DATALINKUPDATE','엑셀 연결 표 갱신','DATALINKUPDATE'],
 ['DATALINKNOTIFY','엑셀 연결 변경 알림 켜기·끄기','DATALINKNOTIFY'],
 ['TABLESTYLE','표 칸 스타일','TABLESTYLE'],
 ['SPELL','맞춤법 검사','SPELL'],
 ['DIMREASSOCIATE','치수 다시 연관','DIMREASSOCIATE'],
 ['DIMDISASSOCIATE','치수 연관 풀기','DIMDISASSOCIATE'],
 ['TFF','다행문자 테두리 맞춤','TFF'],
 ['FAM','문자 찾아 표시','FAM'],
 ['TC','문자 복사 또는 표 문자 넣기','TC'],
 ['TJ','문자정렬점 변경','TJ'],
 ['TO','문자열을 사각의 중심으로 보내기','TO'],
 ['TOA','문자열을 도형의 중심에 일괄 정렬','TOA'],
 ['TS','문자크기를 변경','TS'],
 ['TSA','문서내 모든 문자 스타일 변경','TSA'],
 ['TSE','여러 문자 연속 편집','TSE'],
 ['TSO','문자열 정렬하기','TSO'],
 ['TST','문자 스타일 변경','TST'],
 ['TSW','문자 서로 교체','TSW'],
 ['TW','문자 폭 변경','TW'],
 ['TEC','문자의 일부 복사','TEC'],
 ['DAS','살아있는 도면 축척 넣기','DAS'],
 ['DBC','도곽 자동 인식 복사','DBC'],
 ['DSB','도곽내부 치수축척 일괄변경','DSB'],
 ['PBS','블록 도곽 경계 확인','PBS'],
 ['PBM','일반 폴리박스에 출력용 박스 그리기','PBM'],
 ['PPP','모형공간 다중출력','PPP'],
 ['RUB','잡석 그리기','RUB'],
 ['LCC','선택 색상 객체 특정 레이어로 변경','LCC'],
 ['LCS','동일 객체 레이어 일괄 변경','LCS'],
 ['LE','객체 선택하여 현재 값을 변경','LE'],
 ['SER','범위 선택','SER'],
 ['LUI','직전 레이어 상태 복구','LUI'],
 ['CB','원 절단하기','CB'],
 ['DMD','최단 거리 표시','DMD'],
 ['PVS','폴리선 정점 변경','PVS'],
 ['MM','시작점에서의 길이 지정','MM'],
 ['OAA','객체를 다른 객체각도에 정렬','OAA'],
 ['OC','폴리선 간격띄우기 후 이어주기','OC'],
 ['RR','참조 회전','RR'],
 ['SS','배율값 기억 연속 크기변경','SS'],
 ['ABC','여러 숫자 연산','ABC'],
 ['DM','폴리선 길이를 메모리로','DM'],
 ['SPN','기호문자별 개수 합산','SPN'],
 ['AHM','구적 직각표시 추가 (구적표 설정 상속)','AHM'],
 ['SAR','부지 구적표 자동 작도','SAR'],
 ['SCA','면적 확대하기','SCA'],
 ['TII','영문/숫자 증가 입력','TII'],
 ['DAT','살아있는 도면 제목 넣기','DAT'],
 ['LTX','등 간격 문자열 쓰기','LTX'],
 ['QT','자주 사용하는 문장 골라쓰기','QT'],
 ['QW','특수문자입력기','QW'],
 ['TIE','숫자증가 (원본유지)','TIE'],
 ['TIN','숫자증가 (비문자 포함)','TIN'],
 ['TIP','숫자증가 (위치지정)','TIP'],
 ['TOO','객체에 붙는 문자 넣기','TOO'],
 ['TTT','문자를 표로 모으기','TTT'],
 ['NUMC','자동 숫자 증가하여 쓰기','NUMC'],
 ['MK','문단에 마스크 표시','MK'],
 ['CUT','닫힌 객체 안의 모든 객체 삭제','CUT'],
 ['FE','길이 남기고 모따기','FE'],
 ['BAT','선자르고 문자넣기','BAT'],
 ['BB','자르고 현재 레이어로 선 넣기','BB'],
 ['BRO','객체위의 객체 끊기','BRO'],
 ['DIB','다이어그램 만들기','DIB'],
 ['DTP','곡선을 직선으로 분할','DTP'],
 ['STB','철골보 평면 그리기','STB'],
 ['DOR','평면문 회전','DOR'],
 ['CEN','중심선 그리기','CEN'],
 ['CEP','폴리선 중심 그리기','CEP'],
 ['ELV','엘리베이터 그리기','ELV'],
 // 4차 병렬 작업(2026-09-21): "부분" 매핑 90건을 원문대로 다시 만든 카드. FR 은 FM 이 흡수, 바른 CAD 리습 B 는 BLOCK 별칭과 겹쳐 BRK, 바른 CAD 연속 중심선 CLI 는 CLN 으로 옮김.
 ['LLL','선택 객체의 레이어 동결','LLL'],
 ['LO','꺼진 레이어 모두 켜기','LO'],
 ['LOO','동결 레이어 모두 해동','LOO'],
 ['LU','선택 객체의 레이어 잠금 풀기','LU'],
 ['LAM','레이어 합치기 (목록 지정)','LAM'],
 ['LC','기준 객체 참조 레이어 변경','LC'],
 ['LCO','레이어 변경 (색·선종류 유지)','LCO'],
 ['LP','레이어 특성 일괄 변경','LP'],
 ['LRN','레이어 이름 변경','LRN'],
 ['LRL','레이어 이름 목록 일괄 변경','LRL'],
 ['DVC','등분 복사','DVC'],
 ['EXL','길이 늘이기·줄이기','EXL'],
 ['JL','선 연결','JL'],
 ['MC','연속 복사','MC'],
 ['OA','객체 정렬','OA'],
 ['OB','양쪽 간격띄우기','OB'],
 ['OM','연속 간격띄우기','OM'],
 ['RM','개별 회전','RM'],
 ['SM','개별 축척','SM'],
 ['FM','여러 선 필렛·모따기','FM'],
 ['STR','연속 잡아끌기','STR'],
 ['XT','자르고 늘리기','XT'],
 ['BRK','다중 끊기','BRK'],
 ['DRL','선 방향 표시·역전','DRL'],
 ['PVL','정점 목록 표 변환','PVL'],
 ['CLI','기둥 배근도 그리기','CLI'],
 ['BLI','보 배근도 그리기','BLI'],
 ['BE','형강 단면 그리기','BE'],
 ['ABX','블록 안 중첩 블록 전부 분해','ABX'],
 ['BAM','블록 만들기·자동 재정의','BAM'],
 ['BCH','블록 일괄 교체','BCH'],
 ['BEX','블록 내보내기','BEX'],
 ['BIN','블록 기준점 변경','BIN'],
 ['BSC','블록 가로세로 축척','BSC'],
 ['TIC','문자 숫자 증가 복사','TIC'],
 ['TX','문자 테두리','TX'],
 ['LX','자동 지시선 넣기','LX'],
 ['CC','치수 연장·만들기','CC'],
 ['DG','치수 간격 조정','DG'],
 ['DLL','치수보조선 길이 통일','DLL'],
 ['DPL','폴리선 자동 치수','DPL'],
 ['DQ','여러 객체 신속 치수','DQ'],
 ['DSC','치수 축척 입력','DSC'],
 ['DSM','치수 모양 합치기','DSM'],
 ['ED','치수 축척 일괄 변경','ED'],
 ['SD','치수선 나누기·합치기','SD'],
 ['TB','표 그리기','TB'],
 ['TBM','표 셀 합치기','TBM'],
 ['TBT','표 안에 문자 넣기','TBT'],
 ['RDT','표 간격 변경','RDT'],
 ['C2E','표를 엑셀로','C2E'],
 ['E2C','엑셀을 표로','E2C'],
 ['BMT','도곽 복사·이동','BMT'],
 ['DBS','도곽 정렬','DBS'],
 ['MDL','도면 목록표 만들기','MDL'],
 ['TN','도곽 도면번호 채번','TN'],
 ['TOB','객체를 블록으로 교체','TOB'],
 ['ABE','속성블록 문자 수정','ABE'],
 ['MSK','다행문자 배경 넣기','MSK'],
 ['CTX','문자 하나씩 확인하며 바꾸기','CTX'],
 ['FAR','문자 여러 쌍 찾아 바꾸기','FAR'],
 ['TAP','문자 앞뒤 넣기·빼기','TAP'],
 ['TD','문자 잘라 붙이기','TD'],
 ['TE','문자 종합 수정','TE'],
 ['TM','문자열 병합','TM'],
 ['TSH','문자 그림자','TSH'],
 ['TSM','문자 모양 병합','TSM'],
 ['TSP','문자열 분리','TSP'],
 ['MRT','폴리선 선택 실별 면적표','MRT'],
 ['CALC00','도면 계산기','CALC00'],
 ['AE','면적 합산 기록','AE'],
 ['CDB','인동 간격 검토','CDB'],
 ['DAR','면적 숫자 넣기','DAR'],
 ['SE','유사 객체 검색·선택','SE'],
 ['SEB','경계 안 종류별 객체 선택','SEB'],
 ['CM','구름 수정 기호','CM'],
 ['SSL','단면 기호','SSL'],
 ['SCB','축척 막대','SCB'],
 ['WSL','창호 기호 집계','WSL'],
 ['BAK','도면 백업','BAK'],
 ['PB','출력 범위 박스','PB'],
 ['PUA','도면 정리','PUA'],
 ['SVS','도곽 자동 인식 분리','SVS'],
 ['SOL','솔리드 해치','SOL'],
 ['LSC','선종류 축척 변경','LSC'],
 ['COM','단축키 참고표','COM'],
 ['CT','객체 내용 복사','CT'],
 ['DHR','난간 그리기','DHR'],
 ['COL','기둥 그리기','COL'],
  ['ARCHLIB','건축 작도 모음','ARCHLIB'],
  ...Object.keys(ARCH_LINKS).map(name=>[name,{WAD:'벽 작도',PL2:'폴리선 작도',CLN:'연속 중심선',R4:'실명 면적 태그',TSD:'건축 심볼',TSD2:'건축 태그',DRAW:'건축 작도',WCT:'벽 접합'}[name],name]),
  ...[['WCD','평행 벽선 중심선'],['WOT','일반 벽선 개구부'],['BLIST','블록 집계'],['TLIST','문자 집계'],['PKN','블록 순서 번호'],['DYNB','동적 블록 값']].map(([name,label])=>[name,label,name]),
  // EED 는 2026-09-21 부터 바른 CAD 리습 에스컬레이터 입면 카드가 갖는다. 작도 모음의 '에너지 입면 전개'는 DEE 이름으로 연다.
  ...Object.entries(ARCH_LIBRARY).map(([name,spec])=>[name,name==='EED'?'에스컬레이터 입면 그리기':spec.label,name]),
  ['XCLIP','블록 표시 범위 자르기','XC'],
  ['INSULATION','경로 단열재','IOD'],
  ['LAYISO','선택 레이어만 표시','LIS'],
  // AutoCAD 특성 패널(2026-09-26 훈민캐드 대조 기반 1)
  ['CHPROP','선택 객체 특성 변경 (색·레이어·선종류)','CHPROP'],
  ['SETBYLAYER','색·선종류를 레이어 따름으로','SBL'],
  ['CECOLOR','현재 색 지정','CECOLOR'],
  ['CELTYPE','현재 선종류 지정','CELTYPE'],
  ['LINETYPE','선종류 목록·도면 선종류 축척','LT'],
  ['DENSITY','선·해치 밀도 함께 조절','DENSITY'],
  ['LUPREC','거리·좌표 표시 자리수','LUPREC'],
  ['STYLE','문자 스타일 · 글꼴','STYLE'],
  ['SHEETEDIT','도곽편집 (도곽 기준 복사·이동·늘리기·지우기)','SHEETEDIT'],
  ['CCV','도곽 기준 복사 (도곽 → 도곽, 축척 보정)','CCV'],
  ['MMV','도곽 기준 이동 (도곽 → 도곽, 축척 보정)','MMV'],
  ['SSV','도곽 안 걸침 창 늘리기','SSV'],
  ['EEV','도곽 영역 지우기 (도곽·표제란 남김)','EEV'],
  ['BLOCKLIB','블록 모음 (가구·위생·주방·차량·조경·기호·사무)','BLOCKLIB'],
  ['LIBEXPORT','블록 라이브러리 내보내기 (사무실 공유 파일)','LIBEXPORT'],
  ['LIBIMPORT','블록 라이브러리 가져오기 (사무실 공유 파일)','LIBIMPORT'],
  ['TITLE','도면 제목 + 축척 (크기 +/− 조정)','TITLE'],
  ['DETAILS','상세 찾기 · 검색·추천·라이브러리','DETAILS'],
  ['FIREDETAILS','방화구획 상세도 (상세 생성기 · 방화구획 상세 한 묶음)','FIREDETAILS'],
  ['INDONG','인동거리 검토 (주동 채광면·측벽 동 사이 거리)','IDG'],
  ['DETAIL','표준 상세도 라이브러리 (벽체·지붕·기초·창호·방수)','DTL'],
  ['DIMSMART','스마트 치수 (선·원·호·각도 자동)','DMS'],
  ['DIMANGULAR','각도 치수 (두 선 또는 호)','DAN'],
  ['DIMARC','호 길이 치수 (호·폴리선 호)','DARC'],
  ['DIMJOGGED','꺾인 반지름 치수','DJO'],
  ['DIMORDINATE','좌표 치수 (X/Y)','DORD'],
  ['DIMBREAK','치수선·보조선 끊기','DBRK'],
  ['MLEADER','다중 지시선 + 재료 목록 (여러 꺾임·여러 줄)','MLD'],
  ['MLEADERLIST','지시선 재료 목록 편집','MLL'],
  ['QMENU','기능군 숫자 메뉴판','QM'],
  ['DIMSEQ','연속치수 (시작점 + 간격 목록)','DIMSEQ'],
  ['GRIDLINE','그리드 통심선 + 번호 기호 (간격 목록)','GRIDLINE'],
  ['GRIDBUBBLE','축선에 번호 기호 붙이기','GRIDBUBBLE'],
  ['ANNOSCALE','주석 축척 맞추기 (문자·치수·기호)','ANNOSCALE'],
  ['SCALETEXT','문자 높이 (용지 높이 × 축척)','SCALETEXT'],
  ['QSELECT','조건 선택 (종류·레이어·색·선종류·스타일)','QSELECT'],
  ['ADDSELECTED','고른 객체와 같은 형식으로 그리기','ADDSELECTED'],
  ['ALIGN','두 쌍 정렬 (이동·회전·축척)','AL'],
  ['ENDMATCH','가까운 끝점 한 점으로 맞추기','ENDMATCH'],
  ['LAYMCUR','객체 레이어를 현재로 · 새 레이어','LAYMCUR'],
  ['LAYNUM','레이어 번호 (번호로 현재 레이어·객체 이동)','LN'],
  ['LAYNUMLIST','레이어 번호표 편집','LNL'],
  ['LAYRENAME','객체로 레이어 이름 바꾸기','LAYRENAME'],
  ['LAYON','모든 레이어 켜기','LON'],
  ['LAYRESTORE','이전 레이어 표시 복원','LRE'],
  ['REFEDIT','선택 블록 내부 편집','REF'],
  ['REFCLOSE','블록 편집 저장','REO'],
  ...workflowCommands.map(([name,label])=>[name,label,workflowAliases[name]||name]),
  ['VERSION','이전 형식으로 저장','VERSION'],
  ['CHAT','AI 대화','CHAT'],
  ['PARCEL','주소로 대지 가져오기','PARCEL'],
  ['CONVERT','DWG DXF 일괄 변환','CONVERT'],
  ['AREAOUTLINE','점 찍어 면적','AREAOUTLINE'],
  ['WALLJOIN','벽 자동 접합','WALLJOIN'],
  ['TRIMEXTEND','연장 자르기','TRIMEXTEND'],
  ['DIMCONTINUE','치수 이어 그리기','DIMCONTINUE'],
  ['WALLCENTER','벽 중심선','WALLCENTER'],
  ['WALLDETECT','벽 찾기','WALLDETECT'],
  ['WALLTRACE','벽체 다시 그리기','WALLTRACE'],
  ['FOREIGNREAD','남의 도면 읽기','FOREIGNREAD'],
  ['ELECLAYOUT','조명·전기 배치','ELECLAYOUT'],
  ['AIREDRAW','AI 도면 다시 만들기','AIREDRAW'],
  ['PLANSET','평면으로 도면 세트','PLANSET'],
  ['OCCTPLAN','평면도 만들기','OCCTPLAN'],
  ['OCCTSECTION','단면도 만들기','OCCTSECTION'],
  ['OCCTELEVATION','입면도 만들기','OCCTELEVATION'],
  ['ACCPLAN','장애인시설 계획도','ACCPLAN'],
  ["PDF", "PDF 출력", "PDF"],
  ["GLOBAL", "전역 설정", "GLOBAL"],
  ["HIDE", "객체 숨기기", "HIDE"],
  ["SHOWALL", "객체 모두 표시", "SHOWALL"],
  ["ISOLATEOBJECTS", "선택 객체만 보이기", "ISOLATEOBJECTS"],
  ["HATCHB", "해치 경계선 뽑기", "HB"],
  ["LAYOFF", "선택 객체 레이어 끄기", "LOF"],
  ["LAYLOCK", "선택 객체 레이어 잠금", "LLK"],
  ["LAYUNLOCK", "레이어 잠금 모두 해제", "LUL"],
  ["SAVEAS", "다른 이름으로 저장", "SAVEAS"],
  ["MIRIBODA", "토지정보 · 법규 검토", "MIRIBODA"],
  ["APARTMENT", "아파트 검토", "APARTMENT"],
  ["ACCESSREVIEW", "편의시설 검토", "ACCESSREVIEW"],
  ["ACCESSINPUT", "선택 객체 편의시설 입력", "ACCESSINPUT"],
  ["ENERGYREGION", "에너지 영역 고르기", "ENERGYREGION"],
  ["RECOGNIZE", "도면 인식 · 개요표·배치·층 평면 읽기와 검산", "RECOGNIZE"],
  ["PERMITBOOK", "인허가 도서 (에너지·편의시설)", "PERMITBOOK"],
  ["STRUCTUREREVIEW", "구조 검토", "STRUCTUREREVIEW"],
  ["EXTENSIONREVIEW", "증축 · 대수선 검토", "EXTENSIONREVIEW"],
  ["STOREYS", "층 관리 · 층고와 바닥 높이", "STOREYS"],
  ["RENOVATION", "리노베이션 · 기존·철거·신설 보기", "RENOVATION"],
  ["FREEZE", "레이어 동결", "FREEZE"],
  ["THAW", "레이어 해동", "THAW"],
  ["SHEET", "도곽 지정", "SHEET"],
  ["SHEETS", "도곽 관리", "SHEETS"],
  ["SHEETNUMBER", "도곽 번호 일괄 변경", "SNO"],
  ["SHEETSCALE", "도곽 축척 일괄 변경", "SSC"],
  ["SHEETALIGN", "도곽 번호순 정렬", "SAL"],
  ["SHEETCOPY", "도곽과 내부 객체 복사", "SCP"],
  ["PLOTBOX", "출력 박스 지정", "PBX"],
  ["SHEETPDF", "도곽 번호순 PDF", "SPF"],
  ["SHEETDXF", "도곽별 DXF 분리", "SDX"],
  ["MULTIFILEEDIT", "여러 도면 일괄 편집", "MFE"],
  ["SHEETLIST", "도면목록표", "SHEETLIST"],
  ["PDFMERGE", "PDF 합치기", "PDFMERGE"],
  ["PDFSPLIT", "PDF 나누기", "PDFSPLIT"],
  ["PDFIMPORT", "PDF 가져오기", "PDFIMPORT"],
  ["IMAGEATTACH", "사진 밑그림 넣기", "IMAGEATTACH"],
  ["IMAGEALIGN", "사진 두 점 맞추기", "IMAGEALIGN"],
  ["SELECT", "선택", "V"],
  ["LINE", "선", "L"],
  ["PLINE", "폴리선", "P"],
  ["RECTANGLE", "사각형", "REC"],
  ["CIRCLE", "원", "CI"],
  ["ARC", "3점 호", "A"],
  ["ELLIPSE", "타원", "EL"],
  ["FILLET", "선 모깎기", "F"],
  ["CHAMFER", "선 모따기", "CHA"],
  ["STRETCH", "꼭짓점 늘리기", "STRT"],
  ["PLOT", "도면 출력", "PLOT"],
  ["COPY", "복사", "C"],
  ["MOVE", "이동", "M"],
  ["ROTATE", "회전", "RO"],
  ["SCALE", "축척", "SC"],
  ["MIRROR", "대칭 복사", "MI"],
  ["OFFSET", "간격띄우기 (오프셋)", "O"],
  ["TRIM", "선 자르기", "TR"],
  ["EXTEND", "선 연장", "EX"],
  ["BREAK", "선 구간 삭제", "BR"],
  ["JOIN", "끝점 연결", "J"],
  ["ARRAY", "직사각 배열", "AR"],
  ["ERASE", "삭제", "E"],
  ["OOPS", "지운 객체 되살리기", "OOPS"],
  ["PASTEBLOCK", "블록으로 붙여넣기", "PASTEBLOCK"],
  ["DRAWORDER", "그리기 순서 (앞으로·뒤로)", "DRAWORDER"],
  ["PURGE", "소거 (미사용 레이어·블록 정의)", "PU"],
  ["OVERKILL", "중복 객체 삭제 (겹친 선 합치기)", "OVERKILL"],
  ["AUDIT", "도면 검사 (오류 고치기)", "AUDIT"],
  ["DELIVERYCHECK", "납품 전 점검 (넘기기 전 도면 정리 한 번에)", "DCHECK"],
  ["WALKIN", "내부 투시도 (평면에서 점 찍어 눈높이로 들어가기)", "WI"],
  // ACAD200 영역 8: 감사 보고서·복구 열기·스크립트·묶어 보내기 목록·외부참조 경로 대응(file-care-commands.js)
  ["AUDITREPORT", "도면 검사 보고서 저장", "AUDITREPORT"],
  ["DWGRECOVER", "손상 도면 복구해서 열기", "DWGRECOVER"],
  ["SCRIPT", "스크립트 파일 실행", "SCR"],
  ["PACK", "묶어 보내기 목록 (참조·글꼴·리습)", "PACK"],
  ["XREFPATHMAP", "외부참조 경로 대응 (다른 PC 경로)", "XPM"],
  ["TEXTTOFRONT", "문자·치수 맨 앞으로", "TEXTTOFRONT"],
  ["HATCHTOBACK", "해치 맨 뒤로", "HATCHTOBACK"],
  ["DIVIDE", "등분 점 찍기", "DIV"],
  ["MEASURE", "길이마다 점 찍기", "ME"],
  ["DONUT", "도넛 그리기", "DO"],
  ["BREAKATPOINT", "한 점에서 끊기", "BREAKATPOINT"],
  // ACAD200 영역 4(그리기·편집): 카드 명령과 AutoCAD 시스템 변수 이름의 설정(edit-commands-s4.js).
  ["LENGTHEN", "길이 바꾸기 (증분·퍼센트·전체·동적)", "LENGTHEN"],
  ["WIPEOUT", "가리기 (뒤 객체 감추기)", "WIPEOUT"],
  ["CENTERMARK", "원 중심 표시 (원본 연결)", "CENTERMARK"],
  ["CENTERLINE", "두 선 중심선 (원본 연결)", "CENTERLINE"],
  ["ARRAYEDIT", "연관 배열 고치기", "ARRAYEDIT"],
  ["AUTOCONSTRAIN", "자동 구속 (수평·수직·끝점 일치)", "AUTOCONSTRAIN"],
  ["DELCONSTRAINT", "구속 지우기", "DELCONSTRAINT"],
  ["GEOMETRYCLEANUP", "작도 오류 검사 (틈·넘침·각도)", "GEOMETRYCLEANUP"],
  ["PASTESPEC", "선택하여 붙여넣기", "PASTESPEC"],
  ["FLATTEN", "높이 없애기 (2D 확인)", "FLATTEN"],
  ["MIRRTEXT", "설정 · MIRROR 문자 방향", "MIRRTEXT"],
  ["OFFSETGAPTYPE", "설정 · OFFSET 바깥 모서리", "OFFSETGAPTYPE"],
  ["ARRAYASSOCIATIVITY", "설정 · ARRAY 연관", "ARRAYASSOCIATIVITY"],
  ["HPASSOC", "설정 · HATCH 연관", "HPASSOC"],
  ["HPISLANDDETECTION", "설정 · HATCH 섬 검출", "HPISLANDDETECTION"],
  ["WIPEOUTFRAME", "설정 · WIPEOUT 테두리", "WIPEOUTFRAME"],
  ["JOINFUZZ", "설정 · JOIN 허용 거리", "JOINFUZZ"],
  ["DIMBASELINE", "기준선 치수", "DBA"],
  ["XLINE", "구성선(무한선)", "XL"],
  ["RAY", "광선", "RAY"],
  ["SPLINE", "스플라인", "SPL"],
  ["REVCLOUD", "구름형 수정 기호", "REVCLOUD"],
  ["BOUNDARY", "닫힌 영역 경계 만들기", "BO"],
  ["PASTEORIG", "원래 좌표에 붙여넣기", "PASTEORIG"],
  ["LIST", "객체 정보 보기", "LI"],
  ["EXPLODE", "분해", "X"],
  ["DIMLINEAR", "수평/수직 치수", "DLI"],
  ["DIMALIGNED", "정렬 치수", "DAL"],
  ["DIMRADIUS", "반지름 치수", "DRA"],
  ["DIMDIAMETER", "지름 치수", "DDI"],
  ["DIMSTYLE", "치수 스타일", "D"],
  ["TEXT", "문자", "T"],
  ["HATCH", "닫힌 영역 해치", "H"],
  ["BLOCK", "블록 만들기", "B"],
  ["WBLOCK", "선택 객체 새 도면 저장", "WB"],
  ["INSERT", "블록 삽입", "I"],
  ["WALL", "직선 벽", "W"],
  ["OPENING", "벽 개구부", "OP"],
  ["DOOR", "문 기호", "DR"],
  ["WINDOW", "창 기호", "WIN"],
  ["STAIR", "직선 계단 기호", "ST"],
  ["DIST", "거리 측정", "DI"],
  ["AREA", "면적 조회", "AA"],
  ["LAYER", "레이어 설정", "LA"],
  ["PROPERTIES", "객체 속성", "PR"],
  // F is the traditional two-line FILLET command.  Use ZE for extents so
  // typing F cannot unexpectedly fit the drawing while filleting.
  ["FIT", "전체 보기", "ZE"],
  ["ZOOM", "줌", "Z"],
  ["PAN", "화면 이동", "PAN"],
  ["REGEN", "화면 다시 그리기", "REGEN"],
  ["UCSICON", "원점 표시(L자) 켜기·끄기", "UCSICON"],
  ["AIDRAWANIM", "AI 그리기 연출 켜기·끄기", "AIDRAWANIM"],
  ["LIMITS", "작업 영역", "LIMITS"],
  ["VIEWRES", "화면 품질(곡선 매끄러움·투명도 표시)", "VIEWRES"],
  ["POINT", "점", "PO"],
  ["ID", "좌표 조회", "ID"],
  ["POLYGON", "정다각형", "POL"],
  ["COPYCLIP", "클립보드 복사", "COPYCLIP"],
  ["CUTCLIP", "클립보드 잘라내기", "CUTCLIP"],
  ["PASTECLIP", "클립보드 붙여넣기", "PASTECLIP"],
  ["COPYBASE", "기준점으로 복사", "COPYBASE"],
  ["MATCHPROP", "속성 일치", "MA"],
  ["UNDO", "실행 취소", "U"],
  ["REDO", "다시 실행", "RE"],
  ["SAVE", "도면 저장", "S"],
  ["BACKUP", "BCAD 백업", "BKUP"],
  ["RECOVER", "지난 작업 도면 되살리기", "RECOVER"],
  ["DRAWINGRECOVERY", "지난 작업 도면 되살리기(복구 목록)", "DRECOVER"],
  ["OPEN", "도면 열기", ""],
  ["DXFOUT", "DXF 내보내기", "DX"],
  ["NEW", "새 도면", "N"],
  ["SETTINGS", "별칭/단축키 설정", "SET"],
  ["HELP", "명령 도움말", "?"],
].map(([name, label, alias]) => ({ name, label, alias }));
export const defaultAliases = () =>
  Object.fromEntries(COMMANDS.map((c) => [c.name, c.alias]));
export function aliasProfile(name){
 const aliases=defaultAliases();
 if(name==='office'||name==='standard')Object.assign(aliases,{FIT:'ZE',FILLET:'F',PLINE:'PL',PAN:'P',SAVE:'',STRETCH:'S'});
 if(name==='standard')Object.assign(aliases,{COPY:'CO',CIRCLE:'C'});
 return aliases;
}
export const defaultHotkeys = () => ({
  SAVE: "Ctrl+S",
  OPEN: "Ctrl+O",
  NEW: "Ctrl+N",
  UNDO: "Ctrl+Z",
  REDO: "Ctrl+Y",
  ERASE: "Delete",
  FIT: "Home",
  SETTINGS: "Ctrl+,",
  SELECT: "",
});
export function validateSettings(s) {
  if (
    !s ||
    s.version !== 1 ||
    !s.aliases ||
    typeof s.aliases !== "object" ||
    !s.hotkeys ||
    typeof s.hotkeys !== "object"
  )
    throw Error("설정 파일 형식이 올바르지 않습니다.");
  const names = new Set(COMMANDS.map((c) => c.name)),
    used = new Map();
  for (const name of names) {
    if (s.aliases[name] !== undefined && typeof s.aliases[name] !== "string")
      throw Error("별칭은 문자열이어야 합니다.");
    const alias = (
      s.aliases[name] ?? COMMANDS.find((c) => c.name === name).alias
    )
      .trim()
      .toUpperCase();
    if (alias && !/^[A-Z][A-Z0-9_]{0,19}$|^\?$/.test(alias))
      throw Error(name + ": 별칭은 영문으로 시작하는 1~20자입니다.");
    if (alias && names.has(alias) && alias !== name)
      throw Error(alias + "는 다른 정식 명령 이름입니다.");
    if (alias && used.has(alias)) {
      // 겹친 상대를 화면이 바로 열어 고칠 수 있도록 이름을 함께 실어 보낸다.
      const clash = Error(`${alias}: ${used.get(alias)}와 ${name}의 별칭이 겹칩니다.`);
      clash.conflict = { kind: 'alias', value: alias, holder: used.get(alias), wanted: name };
      throw clash;
    }
    if (alias) used.set(alias, name);
    s.aliases[name] = alias;
  }
  // 명령 하나에 별칭 여러 개(settings.extraAliases, 없어도 된다): 같은 규칙으로 대표 별칭과 함께 겹침을 본다.
  validateExtraAliases(s, names);
  const keys = new Map(),
    reserved = new Set([
      "ESCAPE",
      "ENTER",
      "SPACE",
      "TAB",
      "CTRL+A",
      "CTRL+9",
      "F3",
      "F7",
      "F8",
      "F9",
    ]);
  for (const [name, key] of Object.entries(s.hotkeys)) {
    if (!names.has(name) || typeof key !== "string")
      throw Error("단축키 명령/형식 오류");
    const parts = key.toUpperCase().split("+"),
      base = parts.pop(),
      mods = parts;
    if (new Set(mods).size !== mods.length) throw Error("중복된 조합키입니다.");
    const k = [
      ...["CTRL", "ALT", "SHIFT"].filter((m) => mods.includes(m)),
      base,
    ].join("+");
    if (mods.some((m) => !["CTRL", "ALT", "SHIFT"].includes(m)))
      throw Error("Ctrl/Alt/Shift 조합을 사용하세요.");
    s.hotkeys[name] = k;
    if (
      k &&
      (!/^(CTRL\+|ALT\+|SHIFT\+)*(?:[A-Z0-9,]|DELETE|HOME|END|F(?:[1-9]|1[0-2]))$/.test(
        k,
      ) ||
        reserved.has(k))
    )
      throw Error(name + ": 단축키 형식 또는 예약 키 오류");
    if (k.length === 1)
      throw Error(
        "단일 문자는 별칭으로 사용하세요. 단축키는 Ctrl/Alt 조합을 권장합니다.",
      );
    if (k && keys.has(k)) {
      const clash = Error(key + " 단축키가 중복됩니다.");
      clash.conflict = { kind: 'hotkey', value: k, holder: keys.get(k), wanted: name };
      throw clash;
    }
    if (k) keys.set(k, name);
  }
  return s;
}
// 한글로 치는 명령. 라벨 완전일치 외에 자주 쓰는 짧은 말과 옛 용어(켜=레이어, 블럭=블록, 옵셋=간격띄우기)를 받는다.
export const KOREAN_COMMANDS={
  "평면도만들기":"OCCTPLAN","평면으로도면세트":"PLANSET","도면세트":"PLANSET","실시도면":"PLANSET","단면도만들기":"OCCTSECTION","입면도만들기":"OCCTELEVATION",
  "호길이치수":"DIMARC","꺾인반지름":"DIMJOGGED","꺾인반지름치수":"DIMJOGGED","좌표치수":"DIMORDINATE","치수끊기":"DIMBREAK","문회전":"DOR",
  "장애인시설계획도":"ACCPLAN","편의시설계획도":"ACCPLAN","벽":"WALL","벽찾기":"WALLDETECT","벽체다시그리기":"WALLTRACE","남의도면읽기":"FOREIGNREAD","조명배치":"ELECLAYOUT","전기배치":"ELECLAYOUT","콘센트배치":"ELECLAYOUT","도면읽기":"FOREIGNREAD","벽다시그리기":"WALLTRACE","도면다시만들기":"AIREDRAW","다시만들기":"AIREDRAW","문":"DOOR","창":"WINDOW","계단":"STAIR","해치":"HATCH","저장":"SAVE","열기":"OPEN","치수":"DIMLINEAR","지우기":"ERASE","삭제":"ERASE","자르기":"TRIM","연장":"EXTEND","전체보기":"FIT","숨기기":"HIDE","동결":"FREEZE",
  "레이어":"LAYER","켜":"LAYER","레이어설정":"LAYER","도면층":"LAYER","레이어번호":"LAYNUM","번호레이어":"LAYNUM","레이어번호표":"LAYNUMLIST",
  "숫자계산":"NUMCALC","계산":"NUMCALC","계산기":"CALC","계산기창":"CALC","사칙연산":"NUMCALC",
  "선":"LINE","직선":"LINE","폴리선":"PLINE","사각형":"RECTANGLE","네모":"RECTANGLE","원":"CIRCLE","호":"ARC","타원":"ELLIPSE","점":"POINT","다각형":"POLYGON",
  "복사":"COPY","이동":"MOVE","회전":"ROTATE","축척":"SCALE","대칭":"MIRROR","간격띄우기":"OFFSET","오프셋":"OFFSET","옵셋":"OFFSET","끊기":"BREAK","연결":"JOIN","배열":"ARRAY","분해":"EXPLODE","폭파":"EXPLODE","모깎기":"FILLET","모따기":"CHAMFER","늘리기":"STRETCH",
  "도곽편집":"SHEETEDIT","도곽복사":"CCV","도곽이동":"MMV","도곽늘리기":"SSV","도곽지우기":"EEV","블록모음":"BLOCKLIB","블록라이브러리":"BLOCKLIB","가구":"BLOCKLIB","위생":"BLOCKLIB","위생기구":"BLOCKLIB","주방":"BLOCKLIB","차량":"BLOCKLIB","조경":"BLOCKLIB","수목":"BLOCKLIB","방위표":"BLOCKLIB","라이브러리내보내기":"LIBEXPORT","블록공유":"LIBEXPORT","라이브러리가져오기":"LIBIMPORT","블록가져오기":"LIBIMPORT","제목":"TITLE","도면제목":"TITLE","도면명":"TITLE","상세":"DETAIL","상세도":"DETAIL","표준상세":"DETAIL","상세도면":"DETAIL","스마트치수":"DIMSMART","자동치수":"DIMSMART","NT":"MLEADER","다중지시선":"MLEADER","재료지시선":"MLEADER","재료목록":"MLEADERLIST","지시선목록":"MLEADERLIST","메뉴판":"QMENU","WW":"QMENU","간격치수":"DIMSEQ","그리드":"GRIDLINE","통심":"GRIDLINE","통심선":"GRIDLINE","GT":"GRIDLINE","그리드기호":"GRIDBUBBLE","GTP":"GRIDBUBBLE","축척맞춤":"ANNOSCALE","주석축척":"ANNOSCALE","문자크기":"SCALETEXT","문자스타일":"STYLE","글꼴":"STYLE","자리수":"LUPREC","소수점":"LUPREC","조건선택":"QSELECT","빠른선택":"QSELECT","정렬":"ALIGN","끝점맞춤":"ENDMATCH","밀도":"DENSITY","현재레이어":"LAYMCUR","같은형식":"ADDSELECTED",
  "특성변경":"CHPROP","색변경":"CHPROP","현재색":"CECOLOR","현재선종류":"CELTYPE","선종류":"LINETYPE","레이어따름":"SETBYLAYER","바이레이어":"SETBYLAYER",
  "문자":"TEXT","글자":"TEXT","블록":"BLOCK","블럭":"BLOCK","삽입":"INSERT","거리":"DIST","면적":"AREA","속성":"PROPERTIES",
  "줌":"ZOOM","확대":"ZOOM","이동보기":"PAN","화면이동":"PAN","다시그리기":"REGEN",
  "되돌리기":"UNDO","실행취소":"UNDO","취소":"SELECT","다시실행":"REDO",
  "출력":"PLOT","인쇄":"PLOT","피디에프":"PDF","새도면":"NEW","설정":"SETTINGS","도움말":"HELP","도움":"HELP","선택":"SELECT",
  // 2026-10-27 뺀 동봉 리습의 한글 이름 → 같은 일을 하는 기본 건축 명령. 실·번호·길이처럼 흔한 낱말은 넣지 않는다(제안 목록이 어지러워짐).
  "레이어표준":"LAYSTANDARD","자동레이어":"LTG","꺾인벽":"WALDRAW","직선이중벽":"WALDRAW","벽트림":"FT","리습그리드":"GRIDLINE","기둥":"COL","리습문":"D1","리습창":"W1","면적문자":"AREAOUTLINE","면적표":"ROOMSCHEDULE","리습정렬":"TALIGN","치수정리":"DIMCLEAN","도각":"SHEET","내보내기":"DXFOUT",
  "트림":"TRIM","문넣기":"D1","창넣기":"W1",
};
/* 2026-10-27 뺀 동봉 리습의 영문 명령 → 같은 일을 하는 기본 건축 명령. */
export const RETIRED_LISP_COMMANDS=Object.freeze({WALL2:'WALDRAW',PWALL:'WALDRAW',WALLTRIM:'FT',GRID:'GRIDLINE',COL2:'COL',DOOR2:'D1',WIND:'W1',ROOM2:'ROOM',AREA2:'AREAOUTLINE',AREATABLE:'ROOMSCHEDULE',NUM:'TIP',TAG:'TSD2',PJ2:'PJ',PC2:'PC',LEN2:'LEN',TALIGN2:'TALIGN',TFIND:'FINDREPLACE',BLKCNT:'BLOCKCOUNT',DIMCLEAN2:'DIMCLEAN',TITLE2:'SHEET',DXFOUT2:'DXFOUT',LAYSTD:'LAYSTANDARD',LAYCMD:'LTG',BCIRCLE:'CIRCLE',BBOX:'RECTANGLE',BNUMBER:'TIP',BLENGTH:'LEN'});
/* 2026-09-24 용어 통일(켜→레이어, 블럭→블록, 옵셋→간격띄우기, 오타 정정) 이전의 라벨. 옛 이름을 쳐도 풀리고 검색어에도 포함한다. */
export const LEGACY_LABELS = Object.freeze({
  NUMCALC:'도면 숫자 사칙연산',EDP:'소숫점 자릿수 수정',OE:'옵셋 후 원본삭제',OO:'현재 켜로 옵셋하기',CTL:'현재 켜로 복사',CNL:'새 켜로 복사',LII:'블럭 내부 객체 정보 표시',
  XRR:'외부참조 켜설정 초기화',BAD:'블럭에 객체 포함시키기',BBL:'블럭의 삽입점들을 선으로 이어주기',BLA:'블럭 내부 모든 켜 변경',CMW:'구름형 수정 마트 입체화',STL:'다른 도면에서 훔쳐오기',
  CER:'미세한게 틀어진 도면 보정하기',SAB:'블럭 파일로 저장 · 0번 켜 · 나머지 퍼지',BLS:'보 스케쥴작성',CTR:'차량 퀘적 그리기',BPT:'블럭 해치 패턴 만들기',BCC:'블럭 켜',BCO:'블럭내부 객체 꺼내기',
  BNM:'블럭이름 쓰기',BRM:'블럭 내부 객체 삭제',BRN:'블럭 이름 변경하기',EAR:'특성블럭 문자 유지 폭파',M2B:'다중삽입된 블럭을 일반블럭으로 변경',XCX:'외부참조 자르기 폭파 후 정리',PBS:'블럭도곽 경계 확인',
  LCC:'선택 색상 객체 특정 켜로 변경',LCS:'동일객체 켜 일괄변경',LUI:'직전 켜상태 복구',OC:'폴리선 옵셋후 이어주기',DIB:'다이아그램 만들기',LLL:'선택 객체의 켜 얼림',LO:'꺼진 켜 모두 켜기',LOO:'얼린 켜 모두 녹이기',
  LU:'선택 객체의 켜 잠금 풀기',LAM:'켜 합치기',LC:'기준 객체 참조 켜 변경',LCO:'켜 변경 (색·선종류 유지)',LP:'켜 특성 일괄 변경',LRN:'켜 이름 변경',LRL:'켜 이름 목록 일괄 변경',LFF:'선택객체를 제외한 얼림',
  LFK:'선택 켜를 제외하고 잠금',LTG:'켜 ON/OFF 반전',LOS:'꺼진 켜 중에서 선택하여 켜기',LLC:'선택 색상만 끄기',ELY:'선택켜 객체 모두 삭제',LCD:'위명령 목록에서 선택',LTM:'선모양 합치기',LQT:'켜 숫자 세기',
  LST:'도면의 모든 켜 리스트 작성',SLC:'색 축출로 켜색 변경',TLL:'가까운 문자켜를 선켜로',TTL:'문자내용으로 켜 생성',OFFSET:'오프셋',VERSION:'하위 버전 저장',XLD:'객체에 무한선 그리기',BB:'자르고 현재켜로 선 넣기',
});
const LEGACY_LABEL_LOOKUP = new Map(Object.entries(LEGACY_LABELS).map(([name, label]) => [label.replace(/\s/g, "").toUpperCase(), name]));
/* 건축 설계도구(architecture-command-pack.js)가 매뉴얼 원래 이름(예: "켜 병합하기")을 등록한다 — 도우미·문서의 옛 이름을
   명령창에 쳐도 같은 명령이 실행되게 한다(2026-09-24 비평 8). 이미 다른 명령 이름·라벨인 것은 등록하지 않는다. */
const MANUAL_LABEL_LOOKUP = new Map();
export function registerManualLabels(entries) {
  for (const [label, name] of entries || []) {
    const key = String(label || "").replace(/\s/g, "").toUpperCase();
    if (key && name && !MANUAL_LABEL_LOOKUP.has(key)) MANUAL_LABEL_LOOKUP.set(key, name);
  }
}
/* 한글 명령 목록에서 이 명령을 가리키는 낱말들(검색어용). */
export function koreanNamesFor(name) {
  return Object.entries(KOREAN_COMMANDS).filter(([, target]) => target === name).map(([word]) => word);
}
/* 명령창 입력의 접두어: AutoCAD 식 투명 명령('ZOOM)과 명령창판(-LAYER)은 접두어를 떼고 같은 명령으로 본다. */
export function stripCommandPrefix(text) {
  return String(text ?? "").trim().replace(/^['\-]+(?=[A-Za-z가-힣ㄱ-ㅣ?])/, "");
}
/* AutoCAD 에서 매일 치는 이름 중 바른 CAD 이름이 다른 것(pgp 대응표에 없는 것만). */
const AUTOCAD_TYPED_NAMES = Object.freeze({JOG:'DIMJOGGED',DARC:'DIMARC',DJO:'DIMJOGGED',DORD:'DIMORDINATE',DBRK:'DIMBREAK',DIM:'DIMSMART',LAYFRZ:'FREEZE',LAYTHW:'THAW',LTSCALE:'LINETYPE'});
// 아래 대응표 끝의 PV·PVV·MII·MX·LF·LL·LK·LUK·EOO·ESF: 바른 리습 매뉴얼 별칭(명령 목록에 적혀 있었지만 치면 아무것도 안 되던 것,
// 2026-10-27 설명서 시험). 다른 명령과 겹치지 않는 것만 넣었다. 대응표는 한 줄로 둔다(dimension-extra-integration 시험이 읽는다).
export function resolveCommand(text, settings) {
  const key = stripCommandPrefix(text).toUpperCase();
  const compact = key.replace(/\s/g, "");
  return (
    COMMANDS.find((c) => c.name === key)?.name ||
    COMMANDS.find((c) => c.label.replace(/\s/g, "") === compact)?.name ||
    COMMANDS.find((c) => hasExtraAlias(settings, c.name, key))?.name ||
    COMMANDS.find((c) => settings.aliases[c.name] === key && key)?.name ||
    KOREAN_COMMANDS[compact] ||
    RETIRED_LISP_COMMANDS[key] ||
    LEGACY_LABEL_LOOKUP.get(compact) ||
    MANUAL_LABEL_LOOKUP.get(compact) ||
    ({LISP:'APPLOAD',PL:'PLINE',CO:'COPY',CP:'COPY',FIL:'FILLET',RECTANG:'RECTANGLE',POL:'POLYGON',QSAVE:'SAVE',PRINT:'PLOT',REDRAW:'REGEN',R:'REGEN',CH:'PROPERTIES',MO:'PROPERTIES',DDMODIFY:'PROPERTIES',DDEDIT:'TEXTEDIT',HE:'HATCHEDIT',ARRAYRECT:'ARRAY',ARRAYPOLAR:'POLARARRAY',DC:'DIMCONTINUE',DCO:'DIMCONTINUE',PE:'PLINEEDIT',PEDIT:'PLINEEDIT',DT:'TEXT',DTEXT:'TEXT',LS:'LIST',PV:'PLINEEDIT',PVV:'PLINEEDIT',MII:'MIRROR',MX:'XCLIP',LF:'LAYISO',LL:'LAYOFF',LK:'LAYLOCK',LUK:'LAYUNLOCK',EOO:'SHOWALL',ESF:'HIDE'})[key] ||
    // AutoCAD 명령 이름을 그대로 쳐도 같은 일을 하는 바른 CAD 명령으로(.pgp 가져오기에만 쓰던 대응표를 명령창에도).
    AUTOCAD_COMMAND_MAP[key] || AUTOCAD_TYPED_NAMES[key] ||
    null
  );
}
/* 한 글자 오타(레이러→레이어)를 잡기 위한 편집 거리. 짧은 문자열에만 쓰므로 단순 구현으로 충분하다. */
function editDistance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length];
}
/* 알 수 없는 입력에 붙일 "비슷한 명령" 추천. 이름·별칭·라벨의 앞부분 일치 → 포함 → 라벨 낱말 포함 순으로 최대 count개. */
export function suggestCommands(text, settings, count = 4) {
  const out = [];
  for (const {command} of scoreCommands(text, settings)) { out.push(command); if (out.length >= count) break; }
  return out;
}
/* 점수 매긴 제안 목록(이름 중복 제거, 순위순). 0 앞부분 · 1 라벨 낱말 · 2 중간·한글 · 3 한 글자 틀림. */
export function scoreCommands(text, settings) {
  const raw = String(text ?? "").trim(), key = raw.toUpperCase(), compact = key.replace(/\s/g, "");
  if (!compact) return [];
  const aliases = settings?.aliases || {};
  const scored = [];
  COMMANDS.forEach((c, index) => {
    const alias = String(aliases[c.name] ?? c.alias ?? "").toUpperCase(), label = c.label.replace(/\s/g, "").toUpperCase();
    let score = null;
    if (c.name.startsWith(key) || (alias && alias.startsWith(key))) score = 0;
    else if (label.startsWith(compact) || c.label.toUpperCase().split(/[\s()·,/]+/).some(word => word && word.startsWith(compact))) score = 1;
    else if (compact.length >= 2 && (c.name.includes(key) || label.includes(compact))) score = 2;
    else if (compact.length >= 2 && Object.entries(KOREAN_COMMANDS).some(([word, name]) => name === c.name && (word.includes(compact) || compact.includes(word)))) score = 2;
    else if (compact.length >= 2 && (editDistance(label, compact) <= 1 || editDistance(c.name, key) <= 1 || Object.entries(KOREAN_COMMANDS).some(([word, name]) => name === c.name && editDistance(word, compact) <= 1))) score = 3;
    if (score !== null) scored.push({ score, index, command: c });
  });
  // 같은 순위면 기본 명령(카탈로그 뒤쪽: LINE·LAYER·COPY …)을 보조명령 카드보다 먼저 보여 준다.
  scored.sort((a, b) => a.score - b.score || b.index - a.index);
  const seen = new Set(), out = [];
  for (const item of scored) { if (seen.has(item.command.name)) continue; seen.add(item.command.name); out.push(item); }
  return out;
}
/* ACAD200 715 자동완성·자동 교정(INPUTSEARCH·AutoCorrect).
   AutoCAD: 맞춤법 엔진으로 고친 후보(점수 65 이상)를 실제 명령만 남기고, 사용자가 고른 교정을 사용자 DB 에 쌓는다.
   더 나은 점: 사용자가 같은 오타에서 고른 명령은 다음부터 1위(학습). 같은 점수 안에서는 자주 쓴 명령이 먼저.
   점수 단계(앞부분 > 낱말 > 중간 > 오타)는 지키므로 학습이 정확한 앞부분 일치를 밀어내지 않는다(학습한 것만 예외). */
export function suggestCommandsRanked(text, settings, count = 8, {autoCorrect = {}, usage = {}} = {}) {
  const key = String(text ?? '').trim().toUpperCase();
  if (!key) return [];
  const learned = autoCorrect?.[key];
  const scored = scoreCommands(text, settings);
  if (learned && !scored.some((s) => s.command.name === learned)) { const c = COMMANDS.find((x) => x.name === learned); if (c) scored.push({score: 4, index: -1, command: c}); }
  const rank = (s) => (s.command.name === learned ? -1 : s.score);
  return scored.map((s, i) => ({s, i})).sort((a, b) => rank(a.s) - rank(b.s) || Math.min(50, usage[b.s.command.name] || 0) - Math.min(50, usage[a.s.command.name] || 0) || a.i - b.i).slice(0, count).map((x) => x.s.command);
}
/** 사용자가 제안에서 고른 명령을 기억한다(오타 → 명령). 정확히 친 이름·별칭은 기억하지 않는다. 최대 500개(오래된 것부터 버림). */
export function learnCorrection(autoCorrect, typed, chosen, settings = null) {
  const key = String(typed ?? '').trim().toUpperCase();
  if (!key || !chosen || key === chosen || key.length > 40) return autoCorrect || {};
  if (settings && resolveCommand(key, settings) === chosen) return autoCorrect || {};
  const next = {...(autoCorrect || {})};
  delete next[key]; next[key] = chosen;
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - 500))) delete next[k];
  return next;
}
export function recordCommandUsage(usage, name) {
  if (!name) return usage || {};
  const next = {...(usage || {}), [name]: Math.min(1e6, ((usage || {})[name] || 0) + 1)};
  const keys = Object.keys(next);
  if (keys.length > 1000) for (const k of keys.sort((a, b) => next[a] - next[b]).slice(0, keys.length - 1000)) delete next[k];
  return next;
}
/* 명령 진행 중(좌표·거리·각도 단계)에도 끼어들 수 있는 투명 명령. 그 밖의 명령은 Esc로 끝낸 뒤 실행한다. */
/* UNDO/REDO 는 투명 명령이 아니다: 명령 도중의 U 는 그 명령의 옵션(마지막 점 취소)이고, 도면 되돌리기는 다른 작업을 지운다.
   DIST/ID 는 진행 중인 명령을 끝내므로(측정 뒤 복귀하지 않음) 투명 명령에 넣지 않는다. */
export const TRANSPARENT_COMMANDS = new Set(["ZOOM", "PAN", "FIT", "REGEN", "HELP", "SELECT", "LAYER", "SETTINGS"]);
const COMMAND_STAGES = new Set(["idle", "select"]);
const OPTION_LETTERS = new Set(["R", "F"]);
export function parsePoint(text, base, { relativeDefault = false } = {}) {
  // 오토캐드: #x,y·*x,y 는 절대좌표, '@' 하나는 마지막 점, x,y,z 의 z 는 2D 도면이라 버린다.
  // relativeDefault: 동적 입력이 켜진 두 번째 점부터는 접두사 없는 x,y·길이<각도 도 상대(AutoCAD DYNPICOORDS=0).
  text = String(text).trim();
  const absolute = /^[#*]/.test(text);
  if (absolute) text = text.slice(1);
  const relative = text.startsWith("@") || (!absolute && !!relativeDefault && !!base),
    raw = text.startsWith("@") ? text.slice(1) : text;
  let x, y;
  if (relative && !base) throw Error("먼저 기준점을 지정하세요.");
  if (relative && !raw.trim()) return { x: base.x, y: base.y };
  const sep = raw.includes("<") ? "<" : ",",
    parts = sep === "," && raw.split(",").length === 3 ? raw.split(",").slice(0, 2) : raw.split(sep);
  if (parts.length !== 2 || parts.some((x) => !x.trim()))
    throw Error("좌표는 X,Y 또는 @DX,DY / @길이<각도 형식입니다.");
  const nums = parts.map(Number);
  if (!nums.every(Number.isFinite)) throw Error("유효한 숫자를 입력하세요.");
  if (sep === "<") {
    x = nums[0] * Math.cos((nums[1] * Math.PI) / 180);
    y = nums[0] * Math.sin((nums[1] * Math.PI) / 180);
  } else [x, y] = nums;
  return { x: x + (relative ? base.x : 0), y: y + (relative ? base.y : 0) };
}
export function classifyInput(value, state, settings) {
  if (state === "text" || state === "name") return { kind: "text", value };
  if (!value.trim()) return { kind: "enter" };
  // 좌표·거리·각도 단계에서는 투명 명령만 실행한다. 오타(abc)가 엉뚱한 명령(ABC)을 실행하지 않도록 값으로 돌려주되 어떤 명령과 겹쳤는지 알린다.
  const allowAll = COMMAND_STAGES.has(state);
  // 명령 도중의 한 글자 R·F 는 그 명령의 옵션(회전·첫 점 등)이다. 화면 다시 그리기·전체 보기는 'R·'F 로(오토캐드 투명 명령 표기).
  if (!allowAll && OPTION_LETTERS.has(value.trim().toUpperCase())) return { kind: "value", value: value.trim() };
  const cmd = resolveCommand(value, settings);
  if (cmd) {
    if (allowAll || TRANSPARENT_COMMANDS.has(cmd)) return { kind: "command", value: cmd };
    return { kind: "value", value: value.trim(), blockedCommand: cmd };
  }
  const converted = preprocessImeCommand(value, state, settings);
  if (converted.command) {
    if (allowAll || TRANSPARENT_COMMANDS.has(converted.command)) return { kind: 'command', value: converted.command, conversion: `${value.trim()} → ${converted.text.toLowerCase()}` };
    return { kind: "value", value: value.trim(), blockedCommand: converted.command };
  }
  return { kind: "value", value: value.trim() };
}

const JAMO_KEYS = {
  'ㅂ':'q','ㅈ':'w','ㄷ':'e','ㄱ':'r','ㅅ':'t','ㅛ':'y','ㅕ':'u','ㅑ':'i','ㅐ':'o','ㅔ':'p',
  'ㅁ':'a','ㄴ':'s','ㅇ':'d','ㄹ':'f','ㅎ':'g','ㅗ':'h','ㅓ':'j','ㅏ':'k','ㅣ':'l',
  'ㅋ':'z','ㅌ':'x','ㅊ':'c','ㅍ':'v','ㅠ':'b','ㅜ':'n','ㅡ':'m',
  'ㅃ':'Q','ㅉ':'W','ㄸ':'E','ㄲ':'R','ㅆ':'T','ㅒ':'O','ㅖ':'P',
  'ㄳ':'rt','ㄵ':'sw','ㄶ':'sg','ㄺ':'fr','ㄻ':'fa','ㄼ':'fq','ㄽ':'ft','ㄾ':'fx','ㄿ':'fv','ㅀ':'fg','ㅄ':'qt',
  'ㅘ':'hk','ㅙ':'ho','ㅚ':'hl','ㅝ':'nj','ㅞ':'np','ㅟ':'nl','ㅢ':'ml',
};
const INITIALS=[...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'];
const VOWELS=[...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'];
const FINALS=['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];
// AON/AOFF 보조명령(output-tools.js)이 켜고 끄는 한영 자동 변환 스위치. 값이 'off' 일 때만 끈다.
export const IME_AUTOCONVERT_KEY='barun-ime-autoconvert';
export function imeAutoConvertEnabled(storage=globalThis.localStorage){try{return storage?.getItem?.(IME_AUTOCONVERT_KEY)!=='off';}catch{return true;}}
// No execution or side effects: a failed lookup leaves the original input intact.
export function preprocessImeCommand(value, state, settings) {
  const unchanged={text:value,command:null};
  if(!imeAutoConvertEnabled())return unchanged;
  if(['text','name','number','angle','corner-size','polygon-sides'].includes(state)||/[0-9,@<>]/.test(value)||!/[ㄱ-ㅣ가-힣]/.test(value)||resolveCommand(value,settings))return unchanged;
  const text=hangulToQwerty(value.trim());
  return {text,command:resolveCommand(text,settings)};
}
// 도면 위에서 친 키 중 명령창으로 옮길 글자(아니면 null). 맥은 도면 위에서도 한글 입력기가 켜져 있어
// L 이 'ㅣ' 로 오므로 한글 낱자·글자도 옮긴다 — 명령창이 preprocessImeCommand 로 영문 명령으로 바꾼다.
export function typedCommandKey(e) {
  if(e.ctrlKey||e.altKey||e.metaKey)return null;
  return /^[\x20-\x7eㄱ-ㆎ가-힣]$/.test(e.key)?e.key:null;
}
// 맥 한글 입력기는 조합 중 누른 Space 를 keydown(isComposing) 대신 글자로 넣는다. 끝의 공백 하나 = Space 실행.
// 문자·이름을 받는 단계에서는 공백이 글자라 그대로 둔다. 실행할 값(공백 뗀 것) 또는 null.
export function trailingSpaceSubmit(value, state) {
  if(['text','name'].includes(state)||!/\S $/.test(value))return null;
  return value.slice(0,-1);
}
/** 명령 안 옵션 입력(ZOOM E·FILLET T 등): 한글 낱자만 친 것(ㄷ·ㅔ·ㅁㄴ)은 영문 글자로 읽는다.
 *  대기(SELECT)는 명령 해석이, 문자·이름 입력 단계는 글자 그대로. '변위'·'ㄷ자'처럼 음절이 있으면 바꾸지 않는다. */
const IME_KEEP_PHASES = new Set(['text', 'name', 'dim-text', 'dim-mtext', 'area-label']);
export function imeOptionValue(value, mode, phase) {
  const text = String(value ?? '');
  if (mode === 'SELECT' || IME_KEEP_PHASES.has(phase) || !/^\s*[ㄱ-ㅣ]+\s*$/.test(text)) return text;
  return text.replace(/[ㄱ-ㅣ]+/g, hangulToQwerty);
}
export function hangulToQwerty(value) {
  return [...value].map(ch=>{
    const syllable=ch.codePointAt(0)-0xAC00;
    if(syllable>=0&&syllable<11172){
      return [INITIALS[Math.floor(syllable/588)],VOWELS[Math.floor(syllable%588/28)],FINALS[syllable%28]].map(j=>JAMO_KEYS[j]||'').join('');
    }
    return JAMO_KEYS[ch]||ch;
  }).join('');
}
export function keyChord(e) {
  return [
    e.ctrlKey || e.metaKey ? "CTRL" : null,
    e.altKey ? "ALT" : null,
    e.shiftKey ? "SHIFT" : null,
    e.key.toUpperCase(),
  ]
    .filter(Boolean)
    .join("+");
}
