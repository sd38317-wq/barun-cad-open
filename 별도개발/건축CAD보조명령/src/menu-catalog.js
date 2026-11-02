const command=(id,label,alias,status='ready',description='')=>({id,label,alias,status,description,integration:{enabled:false,target:null}});

export const menuCatalog=[
 {
  id:'text-dimension-table',label:'문자·치수·표',icon:'文',
  sections:[
   {label:'문자',commands:[command('TEXTSTYLEMERGE','문자 스타일 통일','TSM'),command('TEXTAFFIX','접두·접미어','TPX'),command('TEXTSPLIT','문자 나누기','TXS'),command('TEXTMASK','배경 가리기','TXM'),command('ATTRIBUTETEXT','블록 속성 문자','ATX')]},
   {label:'치수',commands:[command('QUICKDIM','빠른 연속 치수','QDM'),command('DIMAFFIX','치수 접두·접미어','DAX'),command('DIMSTYLEMERGE','치수 스타일 통일','DSM'),command('DIMEXTENSION','보조선·간격','DEX'),command('DIMTEXTMOVE','치수 문자 위치','DTM')]},
   {label:'표',commands:[command('TABLEEDIT','표 내용 편집','TBE'),command('TABLECELLMERGE','셀 병합·해제','TCM'),command('TABLESPACING','표 간격','TSP'),command('TABLEALIGN','표 문자 정렬','TBA')]}
  ]
 },
 {
  id:'line-polyline',label:'선·폴리선',icon:'⌁',
  sections:[{label:'편집',commands:[command('BREAKMULTI','여러 선 구간 끊기','BKM'),command('TRIMBOUNDARY','기준 경계 자르기','TRB'),command('MULTIFILLET','연속 모깎기','MFL'),command('LENGTHADJUST','길이 조절','LAD'),command('OBJECTALIGN','정렬·등간격','OAL'),command('DOUBLEOFFSET','양쪽 오프셋','DOF'),command('CHAINOFFSET','연속 오프셋','COF'),command('PLINEEDIT','폴리선 정점 편집','PED')]}]
 },
 {
  id:'layer-hatch-select',label:'레이어·해치·선택',icon:'▱',
  sections:[
   {label:'레이어',commands:[command('LAYMERGE','레이어 합치기','LAM'),command('LAYSTATE','레이어 상태','LAS'),command('LAYSTANDARD','표준 레이어','LSTD')]},
   {label:'해치·선택',commands:[command('HATCHMERGE','해치 합치기','HM'),command('LANDHATCH','지목 해치','LH'),command('SELECTSIMILAR','같은 조건 선택','SSE'),command('SELECTRANGE','범위 선택','SER'),command('SELECTBOUNDARY','경계 안 선택','SEB')]}
  ]
 },
 {
  id:'sheet-output-file',label:'도곽·출력·파일',icon:'▣',
  sections:[
   {label:'도곽',commands:[command('SHEETNUMBER','번호 일괄 변경','SNO'),command('SHEETSCALE','축척·용지 변경','SSC'),command('SHEETALIGN','번호순 정렬','SAL'),command('SHEETCOPY','도곽 복사','SCP')]},
   {label:'출력·파일',commands:[command('PLOTBOX','출력 박스','PBX'),command('SHEETPDF','번호순 PDF','SPF'),command('SHEETDXF','도곽별 DXF','SDX'),command('MULTIFILEEDIT','여러 도면 편집','MFE')]}
  ]
 },
 {
  id:'block-xref',label:'블록·외부참조',icon:'◇',
  sections:[
   {label:'블록',commands:[command('BLOCKREPLACE','블록 교체','BRP'),command('BLOCKCLEAN','미사용 블록 정리','BCL'),command('BLOCKBASE','삽입점 지정','BBP'),command('BLOCKCOUNT','블록 수량표','BCT'),command('BLOCKEXPORT','블록 DXF','BEX')]},
   {label:'외부참조',commands:[command('XREFSTYLE','색상·레이어','XRS'),command('XREFBIND','일반 블록 결합','XRB'),command('XREFCLIP','표시 범위','XRC','prototype')]}
  ]
 },
 {
  id:'layout-viewport',label:'배치·뷰포트',icon:'▤',
  sections:[
   {label:'배치',commands:[command('LAYOUTTAB','배치 탭 관리','LYT','prototype'),command('MODELTOPAPER','모형→종이공간','M2P','prototype'),command('PAPERTOMODEL','종이→모형공간','P2M','prototype')]},
   {label:'뷰포트',commands:[command('VIEWPORTCREATE','뷰포트 만들기','VPC','prototype'),command('VIEWPORTSCALE','뷰포트 축척','VPS','prototype'),command('VIEWPORTLAYER','뷰포트 레이어','VPL','prototype')]}
  ]
 },
 {
  id:'architecture-structure',label:'건축·구조 자동작도',icon:'⌂',
  sections:[
   {label:'건축 상세·산정',commands:[command('VEHICLEPATH','차량 궤적','VTR','prototype'),command('CURTAINWALL','커튼월','CWL','prototype'),command('ESCALATOR','에스컬레이터','ESC','prototype'),command('DOORWINDOWDETAIL','상세 문·창','DWD','prototype'),command('STAIRSECTION','계단 단면','STS','prototype'),command('PARKINGLAYOUT','주차 구획','PKL','prototype'),command('RAMPPROFILE','경사로 단면','RMP','prototype'),command('ROOFSLOPE','지붕 구배','RSL','prototype'),command('EGRESSPATH','피난 동선 길이','EGP','prototype'),command('OPENINGSCHEDULE','창호 일람표','OSG','prototype'),command('GRIDSYSTEM','그리드 축선','GRS','prototype'),command('SECTIONMARKER','단면 기호','SCM','prototype'),command('LEVELMARKER','레벨 표기','LVM','prototype'),command('SUNSHADOW','일조 그림자','SSH','prototype'),command('BUILDINGSEPARATION','건물 간 최단거리','BDS','prototype'),command('AREALEDGER','구적표','ALG','prototype'),command('SALEAREA','전용·공용면적 배분','SAA','prototype')]},
   {label:'대지·면적',commands:[command('SITEAREA','대지면적','SAR','prototype'),command('BUILDINGAREA','건축면적','BUA','prototype'),command('GROSSFLOORAREA','연면적','GFA','prototype'),command('COVERAGERATIO','건폐율','BCR','prototype'),command('FLOORAREARATIO','용적률','FAR','prototype'),command('LANDSCAPEAREA','조경면적','LSA','prototype'),command('ROOMTAG','실명 태그','RTG','prototype'),command('ROOMAREASCHEDULE','실별 면적표','RAS','prototype'),command('ROOMSYNC','면적표 동기화','RMS','prototype'),command('SETBACKENVELOPE','사용자 이격선','SBE','prototype')]},
   {label:'연동·검산',commands:[command('AREALABEL','구적 번호','ARL','prototype'),command('FLOORAREASCHEDULE','층별 면적표','FAS','prototype'),command('BUILDINGSUMMARY','건축개요표','BGS','prototype'),command('AREAREVISION','면적 변경 비교','ARV','prototype'),command('OPENINGNUMBER','창호 번호','OPN','prototype'),command('OPENINGSCHEDULESYNC','창호표 동기화','OSS','prototype'),command('ROOMARTIFACTSYNC','실명·면적표 동기화','RYS','prototype'),command('OPENINGWALLLINK','벽 개구부 연결','OWL','prototype'),command('RELATIONAUDIT','연관관계 검산','RLA','prototype'),command('QUANTITYSUMMARY','수량 집계','QTS','prototype')]},
   {label:'구조 상세',commands:[command('REBARDETAIL','보 배근 상세','RBD','prototype'),command('COLUMNREBAR','기둥 배근 상세','CRD','prototype'),command('SLABREBAR','슬래브 배근 상세','SRD','prototype'),command('HSTEELSECTION','H형강 단면','HSS','prototype')]}
  ]
 },
 {
  id:'productivity-expansion',label:'문자·도형·선택 확장',icon:'＋',
  sections:[
   {label:'문자·표 확장',commands:[command('TEXTROTATION','문자 회전 통일','TRN','prototype'),command('TEXTREPLACE','문자 찾아 바꾸기','TRP','prototype'),command('TEXTJOIN','문자 합치기','TJN','prototype'),command('TEXTSEQUENCE','문자 순번','TSQ','prototype'),command('TEXTNUMBERINCREMENT','문자 숫자 증감','TNI','prototype'),command('TEXTDISTRIBUTE','문자 등간격','TDS','prototype'),command('TEXTCASE','영문 대소문자','TCS','prototype'),command('POSITIONNUMBER','위치순 번호','PSN','prototype'),command('DIMROUNDING','치수 반올림','DMR','prototype'),command('TABLETRANSPOSE','표 행열 전환','TTR','prototype')]},
   {label:'도형·선 확장',commands:[command('LINEEXTENDTO','교차선까지 연장','LET','prototype'),command('LINETRIMAT','교차선에서 자르기','LTA','prototype'),command('LINEBREAKSEGMENT','거리로 구간 끊기','LBS','prototype'),command('COLLINEARJOIN','공선 연결','CLJ','prototype'),command('CHAMFERCORNER','모서리 모따기','CFC','prototype'),command('POLYLINELENGTH','폴리선 길이','PLL','prototype'),command('PERIMETERAREA','둘레·면적','PRA','prototype'),command('DIVIDEPOINTS','등분점','DVP','prototype'),command('CHAINAGE','누가거리','CHN','prototype'),command('INTERSECTIONDETECT','교차점 검출','IXD','prototype'),command('POLYLINESIMPLIFY','폴리선 단순화','PLS','prototype'),command('BOUNDSDISTRIBUTE','도형 등간격 배분','BDT','prototype')]},
   {label:'레이어·선택 확장',commands:[command('LAYERRENAME','레이어 이름 변경','LRN','prototype'),command('LAYERSTANDARDAUDIT','레이어 표준 검산','LSAU','prototype'),command('LAYERCOLORPLAN','레이어 색상 계획','LCP','prototype'),command('LAYERWEIGHTPLAN','레이어 선가중치 계획','LWP','prototype'),command('LAYERSTATESTORE','레이어 상태 저장','LSS','prototype'),command('UNUSEDLAYERFREEZE','미사용 레이어 동결','ULF','prototype'),command('SELECTDUPLICATE','중복 객체 선택','SDP','prototype'),command('SELECTSHORT','짧은 객체 선택','SST','prototype'),command('SELECTOPENPLINE','열린 폴리선 선택','SOP','prototype'),command('SELECTIONSTATS','선택 객체 통계','SLS','prototype')]},
   {label:'도곽·블록 확장',commands:[command('SHEETRENAME','도곽 이름 계획','SHRN','prototype'),command('SHEETINDEX','도면목록표','SHI','prototype'),command('OUTPUTCOLLISION','출력 파일 충돌 검산','OTC','prototype'),command('BATCHOUTPUTPLAN','일괄 출력 계획','BOP','prototype'),command('DRAWINGSPLITPLAN','도곽별 분리 계획','DSP','prototype'),command('BLOCKATTRIBUTE','블록 속성표','BAT','prototype'),command('BLOCKDUPAUDIT','중복 블록 검산','BDA','prototype'),command('XREFPATHAUDIT','외부참조 경로 검산','XPA','prototype')]}
  ]
 },
 {
  id:'building-check-expansion',label:'건축 실무 검산',icon:'✓',
  sections:[{label:'사용자 기준 검산',commands:[command('DOORCLEARWIDTH','문 유효폭','DCW','prototype'),command('STAIRRISERCHECK','계단 단높이','SRC','prototype'),command('RAMPLANDING','경사로 참 계획','RLD','prototype'),command('CORRIDORWIDTH','복도 폭 검산','CDW','prototype'),command('ROOMCOMPACTNESS','실 형상 효율','RCP','prototype'),command('DAYLIGHTRATIO','실 채광비','DLR','prototype'),command('WINDOWWALLRATIO','창면적비','WWR','prototype'),command('FACADEPANEL','외장 패널표','FPN','prototype'),command('COLUMNGRIDCHECK','기둥 축선 검산','CGC','prototype'),command('VERTICALCIRCULATION','수직동선표','VCS','prototype')]}]
 },
 {
  id:'structural-expansion',label:'구조 상세 확장',icon:'▦',
  sections:[{label:'구조 작도·물량',commands:[command('FOOTINGPLAN','독립기초 평면','FTP','prototype'),command('PILECAPPLAN','말뚝기초 평면','PCP','prototype'),command('WALLREBARDETAIL','벽체 배근 상세','WRD','prototype'),command('REBARCUTLIST','철근 절단표','RCL','prototype'),command('REBARWEIGHT','철근 중량표','RWT','prototype'),command('STEELPLATEDETAIL','강판 상세','SPD','prototype'),command('BOLTGROUP','볼트군 배치','BGT','prototype'),command('BASEPLATE','베이스플레이트 상세','BPL','prototype'),command('CONCRETEVOLUME','콘크리트 체적표','CVL','prototype'),command('FORMWORKAREA','거푸집 면적표','FWA','prototype'),command('BEAMOPENINGCHECK','보 개구부 검토','BOC','prototype'),command('SLABOPENINGREBAR','슬래브 개구부 보강','SOR','prototype'),command('COLUMNSCHEDULE','기둥 일람표','CSG','prototype'),command('BEAMSCHEDULE','보 일람표','BSG','prototype'),command('MATERIALTAKEOFF','자재 물량표','MTO','prototype')]}]
 },
 {
  id:'symbol-expansion',label:'도면 기호 확장',icon:'◎',
  sections:[{label:'기호·상세',commands:[command('NORTHARROW','북쪽 화살표','NAR','prototype'),command('SCALEBAR','축척 막대','SCB','prototype'),command('SLOPEARROW','구배 화살표','SLA','prototype'),command('REVISIONCLOUD','개정 구름','RVC','prototype'),command('DETAILBUBBLE','상세 참조 기호','DTB','prototype'),command('ELEVATIONVIEWMARK','입면 방향 기호','EVM','prototype'),command('ROOMFINISHTAG','실 마감 기호','RFT','prototype'),command('MATERIALTAG','재료 기호','MTG','prototype'),command('KEYPLANHIGHLIGHT','키플랜 강조','KPH','prototype'),command('DEMOLITIONMARK','철거 표시','DMM','prototype'),command('CENTERLINECROSS','중심선 십자','CLC','prototype'),command('COORDINATEMARK','좌표 표기','CRM','prototype'),command('GRIDDIMCHAIN','축간 치수 연쇄','GDC','prototype'),command('SECTIONCUTPATTERN','단면 해치 패턴','SCT','prototype'),command('BREAKLINESYMBOL','생략선 기호','BLS','prototype')]}]
 },
 {
  id:'quality-expansion',label:'도면 데이터 검산',icon:'!',
  sections:[{label:'무결성·변경 검산',commands:[command('CLASHDETECT2D','2D 충돌 검토','CD2','prototype'),command('CLEARANCECHECK','이격거리 검토','CLR','prototype'),command('DUPLICATEMARK','중복 번호 검토','DMA','prototype'),command('SEQUENCEGAP','순번 누락 검토','SQG','prototype'),command('UNITAUDIT','단위 일관성 검토','UNA','prototype'),command('COORDINATERANGE','좌표 범위 검토','CRA','prototype'),command('GEOMETRYBOUNDS','도형 크기 검토','GBA','prototype'),command('LAYERREFERENCE','레이어 참조 검토','LRA','prototype'),command('ORPHANASSET','고아 자산 검토','OAA','prototype'),command('SCHEDULEBALANCE','일람표 수량 균형','SBA','prototype'),command('REVISIONHISTORY','개정 이력 요약','RVH','prototype'),command('CHANGEAPPROVAL','변경 승인 계획','CAP','prototype'),command('DOCUMENTSNAPSHOT','문서 스냅샷','DCS','prototype'),command('REQUESTIDGUARD','요청 ID 중복 방지','RID','prototype'),command('VALIDATIONREPORT','통합 검증 보고서','VLR','prototype')]}]
 }
];

export const allCommands=catalog=>catalog.flatMap(group=>group.sections.flatMap(section=>section.commands.map(item=>({...item,groupId:group.id,groupLabel:group.label,sectionLabel:section.label}))));
