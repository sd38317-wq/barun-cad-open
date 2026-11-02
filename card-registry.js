// 건축 요소(카드) 명령 등록부. app.js 와 화면 없는 실행기(command-runner.js)가 같은 목록을 쓴다.
// 순서·이름 바꿈·숨김은 app.js 의 예전 등록 순서 그대로다(뒤에 등록한 같은 이름이 앞의 것을 덮는다).
import {lockedImport} from './screen-vault.js';
import {installDoorCards} from './door-card.js';
import {installWallPreset} from './wall-preset.js';
import {installWindowCards} from './window-card.js';
import {installOpeningCard} from './opening-card.js';
import {installStairCards} from './stair-card.js';
import {installParkingCard} from './parking-card.js';
import {installWallFilletCards} from './wall-fillet-card.js';
import {installLayerTools} from './layer-tools.js';
import {installAreaTools} from './area-tools.js';
import {installShapeTools} from './shape-tools.js';
import {installMultiTools} from './multi-tools.js';
import {installCurtainWallCard} from './curtainwall-card.js';
import {installHandrailCard} from './handrail-card.js';
import {installColumnCard} from './column-card.js';
import {installInsulationCard} from './insulation-card.js';
import {installBlockXrefTools} from './block-xref-tools.js';
import {installSymbolTools} from './symbol-tools.js';
import {installDimHatchTools} from './dim-hatch-tools.js';
import {installOutputTools} from './output-tools.js';
import {installEscalatorCards} from './escalator-card.js';
import {installStructureCards} from './structure-card.js';
import {installSiteDrawCards} from './site-draw-card.js';
import {installUnfoldCards} from './unfold-card.js';
import {installGraphicCards} from './graphic-card.js';
import {installHatchTableTools} from './hatch-table-tools.js';
import {installDimSymbolTools} from './dim-symbol-tools.js';
import {installBlockEditTools} from './block-edit-tools.js';
import {installTextEditTools} from './text-edit-tools.js';
import {installSheetPlotTools} from './sheet-plot-tools.js';
import {installEditCalcTools} from './edit-calc-tools.js';
import {installTextCreateTools} from './text-create-tools.js';
import {installTrimTools} from './trim-tools.js';
import {installDrawCards3} from './draw-cards-3.js';
import {installLayerTools4} from './layer-tools-4.js';
import {installMultiTools4} from './multi-tools-4.js';
import {installTrimShapeTools4} from './trim-shape-tools-4.js';
import {installStructureCards4} from './structure-cards-4.js';
import {installBlockTextTools4} from './block-text-tools-4.js';
import {installDimTools4} from './dim-tools-4.js';
import {installTableSheetTools4} from './table-sheet-tools-4.js';
import {installTextEditTools4} from './text-edit-tools-4.js';
import {installAreaSelectTools4} from './area-select-tools-4.js';
import {installSymbolOutputTools4} from './symbol-output-tools-4.js';
import {installPropertyTools} from './property-tools.js';
import {installDraftingTools} from './drafting-tools.js';
import {installAnnotationScale} from './annotation-scale.js';
import {installGridTools} from './grid-tools.js';
import {installDimSequence} from './dim-sequence.js';
import {installMleaderTools} from './mleader-tools.js';
import {installSmartDim} from './smart-dim.js';
import {installDimensionExtra} from './dimension-extra.js';
import {installDimAssoc} from './dim-assoc.js';
import {installSheetEditTools} from './sheet-edit-tools.js';
import {installBlockLibrary} from './block-library.js';
import {installTitleTools} from './title-tools.js';
import {installDetailLibrary} from './detail-library.js';
import {installLayerNumberTools} from './layer-number-tools.js';
import {installWallDetect} from './wall-detect-command.js';
import {installAccessPlan} from './access-plan-command.js';
import {installAccessMarks} from './access-plan-mark.js';
import {installTableDataLink} from './table-datalink.js';
import {installSpellCheck} from './spell-check.js';
import {installTextAnnotation} from './text-annotation-commands.js';
import {installImageCommands} from './image-commands.js';
import {installEditCommandsS4} from './edit-commands-s4.js';

/**
 * @param cardContext 카드 공통 문맥(점·객체·경로 입력, 폼, commit …)
 * @param propertyContext 특성·주석 명령용 확장 문맥. styledDimension 은 치수 명령 두 개에만 더해 넘긴다.
 * @param extra {openArchitecturalDetail} 화면에만 있는 연결(없으면 그 명령을 등록하지 않는다)
 */
export function installCardCommands(cardContext,propertyContext,{styledDimension,openArchitecturalDetail}={}){
 const cardCommands={};
 const wallPreset=installWallPreset(cardContext);
 cardCommands.WALDRAW=wallPreset;cardCommands.WAL=wallPreset;
 Object.assign(cardCommands,installDoorCards(cardContext),installWindowCards(cardContext),installOpeningCard(cardContext),installStairCards(cardContext),installParkingCard(cardContext),installWallFilletCards(cardContext));
 // multi-tools 의 CV 는 바른 CAD 리습의 다른 명령(현재 값 변경)과 이름이 겹쳐 뺀다.
 {const multi=installMultiTools(cardContext);delete multi.CV;Object.assign(cardCommands,installLayerTools(cardContext),installAreaTools(cardContext),installShapeTools(cardContext),multi,installCurtainWallCard(cardContext),installHandrailCard(cardContext),installColumnCard(cardContext),installInsulationCard(cardContext));}
 // V·X 는 SELECT·EXPLODE 의 별칭이라 카드 이름을 바꾼다. xi* 는 명령 이름 규칙(대문자)에 맞춘다.
 {const output=installOutputTools(cardContext),symbols=installSymbolTools(cardContext);
  for(const [from,to] of [['V','VSYM'],['X','XSYM']]){symbols[to]=symbols[from];delete symbols[from];}
  for(const [from,to] of [['xiUnintall','BRUNINSTALL'],['xiBackup','BRBACKUP'],['xiRestore','BRRESTORE']]){if(output[from]){output[to]=output[from];delete output[from];}}
  Object.assign(cardCommands,installBlockXrefTools(cardContext),symbols,installDimHatchTools(cardContext),output,installEscalatorCards(cardContext),installStructureCards(cardContext),installSiteDrawCards(cardContext),installUnfoldCards(cardContext),installGraphicCards(cardContext));
  if(openArchitecturalDetail)cardCommands.DEE=()=>openArchitecturalDetail('EED');}
 Object.assign(cardCommands,installHatchTableTools(cardContext),installDimSymbolTools(cardContext),installBlockEditTools(cardContext),installTextEditTools(cardContext),installSheetPlotTools(cardContext),installEditCalcTools(cardContext),installTextCreateTools(cardContext),installTrimTools(cardContext),installDrawCards3(cardContext));
 // FR 은 FM 카드가 흡수(같은 기능), 리습 B 는 BLOCK 별칭과 겹쳐 BRK.
 {const t4=installTrimShapeTools4(cardContext);t4.BRK=t4.B;delete t4.B;delete cardCommands.FR;
  Object.assign(cardCommands,installLayerTools4(cardContext),installMultiTools4(cardContext),t4,installStructureCards4(cardContext),installBlockTextTools4(cardContext),installDimTools4(cardContext),installTableSheetTools4(cardContext),installTextEditTools4(cardContext),installAreaSelectTools4(cardContext),installSymbolOutputTools4(cardContext));
  cardCommands.FR=cardCommands.FM;cardCommands.WLIST=cardCommands.WSL;}
 Object.assign(cardCommands,installPropertyTools(propertyContext),installDraftingTools(propertyContext),installAnnotationScale(propertyContext),installGridTools(propertyContext),installDimSequence({...propertyContext,styledDimension}),installMleaderTools(propertyContext),installSmartDim({...propertyContext,styledDimension}),installDimensionExtra({...propertyContext,styledDimension}),installSheetEditTools(propertyContext),installBlockLibrary(propertyContext),installTitleTools(propertyContext),installDetailLibrary(propertyContext));
 Object.assign(cardCommands,installDimAssoc(propertyContext)); // 연관 치수: DIMREASSOCIATE·DIMDISASSOCIATE (ACAD200 514)
 Object.assign(cardCommands,installLayerNumberTools(cardContext),installWallDetect(propertyContext));
 // 도면 다시 만들기는 실행할 때만 읽는다(3D 밀고 당기기와 같은 지연 모듈).
 cardCommands.AIREDRAW=async (...args)=>{
  const {installDrawingSet}=await import('./drawing-set-command.js');
  return installDrawingSet(propertyContext).AIREDRAW(...args);
 };
 // 평면으로 도면 세트: 층별 평면 박스 → 설계 JSON → 도면 한 벌. 실행할 때만 읽는다.
 cardCommands.PLANSET=async (...args)=>{
  const {installPlanSet}=await lockedImport('planset-command.js');
  return installPlanSet(propertyContext).PLANSET(...args);
 };
 // 벽체 다시 그리기: 사무소 평면의 벽 레이어 선 → 우리 벽(A-WALL-*)·창·문
 cardCommands.WALLTRACE=async (...args)=>{
  const {installWallTrace}=await lockedImport('planset-command.js');
  return installWallTrace(propertyContext).WALLTRACE(...args);
 };
 // 남의 도면 읽기: 다른 사무소 층 평면 → 벽(임의 각도)·창·문·실·바닥 윤곽(벽 중심선 면적)
 cardCommands.FOREIGNREAD=async (...args)=>{
  const {installForeignRead}=await lockedImport('planset-command.js');
  return installForeignRead(propertyContext).FOREIGNREAD(...args);
 };
 // 조명·전기 배치: 실마다 조명·스위치·콘센트·감지기 + 집계표
 cardCommands.ELECLAYOUT=async (...args)=>{
  const {installElectricalLayout}=await lockedImport('planset-command.js');
  return installElectricalLayout(propertyContext).ELECLAYOUT(...args);
 };
 // The OCCT command module, Worker and WASM stay outside the startup import graph.
 for(const name of ['OCCTPLAN','OCCTSECTION','OCCTELEVATION']) cardCommands[name]=async()=>{
  const {installOcctCommands}=await import('./occt-commands.js');
  return installOcctCommands(propertyContext)[name]();
 };
 Object.assign(cardCommands,installAccessPlan(propertyContext),installAccessMarks(cardContext));
 Object.assign(cardCommands,installTextAnnotation(propertyContext)); // 글꼴 대체·SHX·필드·ATTSYNC·TEXTALIGN (ACAD200 506·507·512·521·523)
 Object.assign(cardCommands,installTableDataLink(propertyContext),installSpellCheck(propertyContext)); // 엑셀 연결 표·칸 모양(ACAD200 520), 맞춤법(524)
 // ACAD200 영역 4: LENGTHEN·WIPEOUT·CENTERMARK·CENTERLINE·ARRAYEDIT·AUTOCONSTRAIN·GEOMETRYCLEANUP·PASTESPEC·FLATTEN·설정(MIRRTEXT 등).
 Object.assign(cardCommands,installEditCommandsS4(propertyContext));
 Object.assign(cardCommands,installImageCommands(propertyContext));
 return cardCommands;
}
