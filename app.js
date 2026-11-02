import {remapRoadEvidence} from './parcel-road.js';
import {createSiteContext,roadEvidenceFromContext,compareSiteContext,mergeSiteContext,SITE_DRAW_OPTIONS} from './site-context.js';
import {appendLoadRevealDelta} from './site-plan-wait.js';
import {planReveal} from './ai-draw-reveal.js';
import {createRevealPlayer,revealDisplayEntities} from './ai-draw-reveal-player.js';
import {mountWaitStage} from './wait-stage.js';
import {mountDrawingOpenWait} from './drawing-open-preview.js';
import {standardLayerForName,layerTooltip} from './layer-standards.js';
import {indongRequest,applyIndongMarks} from './indong-client.js';
import {prepareLegacyLayerMigration,migrateDrawingTabLayers,layerMigrationNotice} from './layer-migration.js';
import {DrawingTabs,openDrawingRecovery,startsFresh,recoveryOffer,showRecoveryDialog,restorableDrawingWorkspace,isEmptyDrawingTab,drawingPathKey} from './drawing-tabs.js';
let wallEditorPromise;
function ensureWallEditor(){return wallEditorPromise??=import('./drawing-set-command.js').then(module=>{selectedWallGrips=module.createWallGripCache();wallCenterlines=module.createWallCenterlineCache();render();return module;}).catch(error=>{wallEditorPromise=undefined;throw error;});}
let selectedWallGrips=(doc,e)=>{if(!e.drawingSet)return null;void ensureWallEditor().catch(error=>toast(error.message,true));return [];};
let wallCenterlines=sets=>{if(sets&&Object.keys(sets).length)void ensureWallEditor().catch(error=>toast(error.message,true));return [];};
import {fontFamilyFor} from './text-fonts.js';
import {justifiedText,withJustifiedAnchors,TEXT_JUSTIFY as TEXT_JUSTIFY_KEYS,isFitJustify,JUSTIFY_PROMPT} from './text-justify.js';
import {normalizeTypedText} from './text-codes.js';
import {inlineEditorSize,inlineEditorKeyAction,inlineEditorBackground} from './text-inline-editor.js';
import {createTextMeasurer,canvasMeasure} from './text-measure.js';
import {createFieldController,setActiveFieldController,FIELDEVAL} from './text-fields.js';
import {fontNoticeOnOpen} from './text-annotation-commands.js';
// 508: 선택 상자·마스크·표 칸·맞춤 폭을 실제로 그리는 글꼴로 잰다(글꼴·글자마다 한 번, 캐시). 웹 글꼴을 다 읽으면 다시 잰다.
{const lineUnits=createTextMeasurer(canvasMeasure());if(lineUnits){G.setTextLineMeasurer(lineUnits);try{document.fonts?.addEventListener?.('loadingdone',()=>lineUnits.clear());}catch{}}}
// 512: 필드 문자 — 원본 객체를 고친 명령 끝에 그 필드만 다시 계산(같은 되돌리기 한 단계), 열기·저장·출력 때 전부.
const fieldSync=createFieldController({doc:()=>engine.doc,lookup:ids=>entitiesById(engine.doc.entities,ids),execute:c=>execute(c),mergeLastUndo:p=>engine.mergeLastUndo(p),
 context:()=>({now:new Date(),filePath:typeof filePath==='string'?filePath:''}),key:()=>documents?.activeId});
setActiveFieldController(fieldSync);
import {OverlapSelection,createOverlapPanel} from './overlap-selection.js';
import {pickDisplayEntity,pickDistance} from './display-picking.js';
import {createGpuController} from './gpu-controller.js';
import {gpuViewPending} from './gpu-view-safety.js';
import {createDisplayQuality} from './display-quality.js';   // ACAD200 108~124 화면 품질·압박·임포스터
import {drawOrderGpuEdit} from './gpu-draw-order.js';
import {linetypeScaleGpuEdit} from './gpu-linetype-scale.js';
import {MatrixSnapshot,previewAffine} from './preview-matrix.js';
import {CanvasMipCache} from './raster-mip-cache.js';
import {createImageRenderer} from './image-render.js';
import {snapIntersections} from './snap-intersections.js';
import {entitiesById,pointerDelta,commitEntities,entityIndex,warmEntityIndex} from './entity-index.js';
import {lowMemCheck} from './low-memory.js';
import {receiveImportStream,importSizeNotice,documentRequestBody,watchImportQueue,documentWeight} from './import-stream.js';
import {MENU_CATALOG,MENU_COMPAT_ALIASES,MENU_INSTALLED_COMMANDS,matchesMenuQuery} from './menu-catalog.js';
import {installTablet} from './tablet-control.js';
import {createTabletPad} from './tablet-pad.js';
import {installPadShare,installPadMenu} from './pad-share.js';
import {technicalErrorMessage,userErrorMessage} from './user-error.js';
import {installCadAccountWindow} from './shared-account-adapter.js';
let tabletPad=null;   // 사무실 패드(같은 와이파이): 펜 표시·스케치·마우스·글 — tablet-pad.js
let fieldRecordHighlight=null;  // AI가 고른 현장 핀: 화면에만 표시
let padOverlay=[];  // 패드 원격 수정: [밖에서 고친 것] 창의 반영 미리보기(도면에 저장 안 됨)

import {installLiveCheck,createReview3DOpener} from './live-check.js';
import {energyRegionFields,energyRegionSpec,energyRegionLabel,makeEnergyRegion,setEnergyRegion} from './energy-regions.js';
let liveCheck;
let fileImportQueue=[];
let resolveDrawingWorkspaceReady;const drawingWorkspaceReady=new Promise(resolve=>{resolveDrawingWorkspaceReady=resolve;});
// 이전 변위(H67 · 훈민 CC/MM, AutoCAD COPY <변위>): MOVE·COPY 가 마지막으로 옮긴 방향·거리. 명령이 끝나도 기억해 기준점에서 Enter/P 로 다시 쓴다.
let lastDisplacement=null;
// 명령이 끝날 때 한 번 부를 일(reset 에서 비운다). reset 이 초기화 중에도 불리므로 맨 위에 둔다.
const commandEndHooks=[];
let drawingTabBar=null, drawingTabList=null, drawingTabStatus=null, restoringTabs=false, tabsRecovered=false, lastSessionWorkspace=null, keepPreviousWorkspace=false, recoveryOfferPending=null;
let documents=null, switchingDrawing=false, recoveryStore=null, recoveryTimer=null, recoveryIdleId=null, recoveryPending=false, recoveryWrite=Promise.resolve(), recoveryBlocked=false;
import { plotSVG, plotPDFJob, embedPlotImages, PLOT_STANDARD_SCALES, multiPagePlotFit } from "./plot.js";
import {openLayerManagerDialog} from './layer-manager.js';   // ACAD200 701·702·706·707
import {createS7Tools} from './acad200-s7.js';                 // ACAD200 영역 7 명령
import {loadColorBooks} from './color-books.js';               // ACAD200 721
import {tryParseScale} from './scale-input.js';                // ACAD200 716
import {createRestDetector,rolloverLines} from './rollover-tip.js';   // ACAD200 712
import { DrawingEngine, newDrawingDocument, styleEditIds } from "./engine.js";
import * as G from "./geometry.js";
import {visibilityCacheKeys,retainVisibleEntities} from './viewport-visibility.js';
import {
  COMMANDS,
  defaultAliases,
  aliasProfile,
  defaultHotkeys,
  validateSettings,
  resolveCommand,
  RETIRED_LISP_COMMANDS,
  suggestCommands,
  koreanNamesFor,
  LEGACY_LABELS,
  hangulToQwerty,
  preprocessImeCommand, typedCommandKey, trailingSpaceSubmit, imeOptionValue,
  parsePoint,
  classifyInput,
  keyChord,
} from "./commands.js";
import {rankCommandSearch,searchEnterDecision} from './command-search.js';
import {parsePgp,planPgpImport,applyPgpPlan,serializePgp,aliasMapFromSettings,aliasFieldText,putAliasField,fieldTokens,withoutAliasToken,migrateAliasSettings,pgpImportSummary,aliasesOf} from './pgp-aliases.js';
import {historyShortcutAction} from './command-history-shortcut.js';
import {checkboxState} from './form-controls.js';
import {calculatorShortcut} from './calculator-shortcut.js';
import {createQuestionQueue} from './lisp-question-queue.js';
import { drawEntity, crossing, getCanvasPalette, linetypeDashPattern, screenLineweightPx, drawUcsIcon } from "./view.js";
/** 미리보기 그림판을 '화면에 보이는 크기'에 맞춘다.
    예전에는 그림판 속을 600×260 으로 고정해 두고 화면에서는 다른 크기로 늘여 보여 줬다.
    가로로 눌리고 세로로 늘어나 원이 타원이 되고 그림이 작아 보였다. */
function fitPreviewCanvas(canvas){
  // clientWidth/Height 는 '화면에 자리잡은 크기'다. width 속성을 바꿔도 흔들리지 않아
  // 크기를 맞추다 서로를 다시 바꾸는 되먹임에 빠지지 않는다.
  const width=Math.max(1,canvas.clientWidth||Math.round(canvas.getBoundingClientRect().width)||300);
  const height=Math.max(1,canvas.clientHeight||Math.round(canvas.getBoundingClientRect().height)||200);
  const ratio=Math.min(3,window.devicePixelRatio||1);
  if(canvas.width!==Math.round(width*ratio)||canvas.height!==Math.round(height*ratio)){
    canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
  }
  const context=canvas.getContext('2d');
  context.setTransform(ratio,0,0,ratio,0,0);
  context.clearRect(0,0,width,height);
  return {context,width,height};
}
import { symbol } from "./symbols.js";
import { createStudio,tableBlock,engineToken,forbiddenError } from "./studio.js";
import { lockedImport } from "./screen-vault.js";
import {mountOutputWait} from "./output-wait.js";
import {installWorkflows} from './workflows.js';
import {installFileWorkflows} from './file-workflows.js';
import {installFileCareCommands} from './file-care-commands.js';
import {needsVersionPreview,versionLossMessage,drawingThumbnail,recoveryCandidate,pdfLayerName,createTypoLearner,autoCorrected} from './file-care.js';
import {connectBridge} from './bridge-client.js';
import {reloadLayerKnowledge} from './layer-knowledge.js';
import {reloadLayerRanking} from './layer-ranking.js';
import {installChat} from './chat.js';
import {commitAIChange} from './ai-commit.js';
import {notifyAIChange} from './ai-work-band.js';
import {AI_DIALOG_COMMANDS,stageActions,assertLibraryFirst,actionContext,importParcelAction} from './ai-actions.js';
import {installBatchConverter} from './batch-converter.js';
import {installLisp} from './lisp-panel.js';
import {ARCHITECTURE_LISP} from './architecture-lisp-catalog.js';
import {installWallPreset} from './wall-preset.js';
import {markCardRepeat} from './card-kit.js';
import './door-card.js';
import './window-card.js';
import './opening-card.js';
import './stair-card.js';
import './parking-card.js';
import './wall-fillet-card.js';
import './layer-tools.js';
import './area-tools.js';
import './shape-tools.js';
import './multi-tools.js';
import './curtainwall-card.js';
import './handrail-card.js';
import './column-card.js';
import './insulation-card.js';
import './block-xref-tools.js';
import './symbol-tools.js';
import './dim-hatch-tools.js';
import {handleOutputRequest,createOutputCloseReservation,runOutputCommand,qqResultMessage} from './output-tools.js';
import './escalator-card.js';
import './structure-card.js';
import './site-draw-card.js';
import './unfold-card.js';
import './graphic-card.js';
import './hatch-table-tools.js';
import './dim-symbol-tools.js';
import './block-edit-tools.js';
import './text-edit-tools.js';
import './sheet-plot-tools.js';
import {unregisteredPlotBoxes,plotBoxSheetSpec} from './sheet-plot-tools.js';
import './edit-calc-tools.js';
import './text-create-tools.js';
import './trim-tools.js';
import './draw-cards-3.js';
import './layer-tools-4.js';
import {parseLayerNumberCommand,runLayerNumberInput,layerNumberIndex,sortLayersForDisplay} from './layer-number-tools.js';
import {installCardCommands} from './card-registry.js';
import {wallDetectionPreview} from './wall-detect-command.js';
let wallDetectionOverlay=null;
import './multi-tools-4.js';
import './trim-shape-tools-4.js';
import './structure-cards-4.js';
import './block-text-tools-4.js';
import './dim-tools-4.js';
import './table-sheet-tools-4.js';
import './text-edit-tools-4.js';
import './area-select-tools-4.js';
import './symbol-output-tools-4.js';
import {blockStorageShared,recordRecentBlock,insertNameList} from './side-docs.js';
import {sharedDefinitionForInsert,promptlessAttributes,installBlockDataTools,groupPickEnabled,groupMemberIds} from './block-data-tools.js';
import {nestedPaths,openWorkSet,closeWorkSet,beditTarget,editableDefinitions} from './block-workset.js';
import {buildSharedRefIndex} from './shared-blocks.js';
import {planPurge,purgeCommand,planOverkill,overkillCommand,planAudit,auditFixCommand,auditSummary,wblockDocument} from './drawing-cleanup.js';
import {coreExtents} from './extent-core.js';
import {planDeliveryCheck} from './delivery-check.js';
// ACAD200 영역 4(그리기·편집): 설정(시스템 변수)·순수 계산·카드 명령은 edit-commands-s4.js, 여기는 연결만.
import * as S4 from './edit-commands-s4.js';
import {installNumberCalculator} from './number-calculator.js?v=20261012-1';
import {installExpressionCalculator} from './expression-calculator.js';
import {areaTakeoffEntities,takeoffBoundary} from './area-takeoff.js';
import {areaConversionChanges} from './area-conversion.js';
import {architecture,wallOpening,rebuildArchitecture,insulationPath,insulationSourcePath,analyzeDrawingLayers,analyzeRankedDrawingLayers,layerDictionaryFromDecisions,BARUN_LAYERS,standardLayerForLabel} from './architecture.js';
import {suggestLayerFamily,buildNameGroups,applyNameGroup,dictionaryFromNameGroups,splitNameGroup,nameGroupState,rememberTarget,describeDictionary,layerDictionaryEntry} from './layer-name-groups.js';
import {checkDrawing,pickGroup,rememberAllowed,CHECK_GROUPS,serverChecks,mergeWallLayers,foreignAdditions,MERGED_WALL_LAYER} from './drawing-check.js';
import {STATUTORY_LIMITS} from './livecheck-auto.js';
import {applyReviewRepair} from './review-panel.js';
import {ARCH_LIBRARY,ARCH_LINKS,architecturalDetail,detailDefaults,parallelWallPair,wallLineOpening,architecturalCounts,nativeDraftingEdits,nativeLength} from './architectural-library.js';
import {architectureReferenceCommands,architectureReferenceCategories,architectureCardIconSvg as architectureCommandIconSvg,architectureCommandSearchText,architectureReleaseLabel,architectureCardShown,ARCHITECTURE_HIDDEN_COMMAND_NAMES} from './architecture-command-pack.js';
import {ARCHITECTURE_HOWTO,MANUAL_BASE} from './architecture-howto-data.js';
// 고르기에서 빼 둔 건축 카드도 '숨긴 카드 보기'를 켜면 검색·건축 탭·설계도구에 다시 나온다(명령 직접 입력은 늘 실행).
const ARCH_SHOW_HIDDEN_KEY='barun-arch-show-hidden-cards';
let showHiddenArchCards=(()=>{try{return localStorage.getItem(ARCH_SHOW_HIDDEN_KEY)==='1';}catch{return false;}})();
const archCardHiddenName=name=>!showHiddenArchCards&&ARCHITECTURE_HIDDEN_COMMAND_NAMES.has(name);
import {getSnapAngle,orthoSnap,snapAngleLabel,SNAP_ANGLE_EVENT} from './snap-angle.js';
import {QUICK_TOOLS_ORDER_KEY,orderedQuickGroups,moveQuickTool} from './quick-tools-order.js';
import {loadAssistState,saveAssistState,toggleAssistFavorite,moveAssistFavorite,recordAssistRecent,normalizeAssistHotkey,validateAssistHotkeys} from './architecture-assist-state.js';

let architectureAssistState=loadAssistState({storage:localStorage,commands:architectureReferenceCommands});
// 상단 즐겨찾기 줄 다시 그리기. 명령 검색 초기화 때 실제 함수로 바뀐다(그 전 호출은 할 일 없음).
let refreshFavoriteToolbar=()=>{};
if(!architectureAssistState.favorites.length){
 try{
  const legacy=JSON.parse(localStorage.getItem('barun-tool-favorites-v2')||'[]');
  if(Array.isArray(legacy)&&legacy.length)architectureAssistState=saveAssistState({storage:localStorage,commands:architectureReferenceCommands,state:{...architectureAssistState,favorites:legacy}});
 }catch{}
}

const BARUN_BETA_MODE=new URLSearchParams(location.search).get('beta')==='5';
if(BARUN_BETA_MODE){
 document.documentElement.dataset.beta='5';
 document.title='바른 CAD Beta 5';
 const brand=document.querySelector('.brand-copy');
 if(brand&&!brand.querySelector('.beta-badge')){const badge=document.createElement('span');badge.className='beta-badge';badge.textContent='BETA 5';brand.append(badge);}
}

import {installSitePlan} from './site-plan-panel.js';
import {installMiriboda} from './miriboda-panel.js';
import {installApartment} from './apartment-panel.js';
import {installPermitBook} from './permit-book.js';
import {silsiPanelElement} from './silsi-panel.js';
import {installStructureReview} from './structure-review.js';
import {installDrawingRecognition} from './drawing-recognition.js';
import {downloadText} from './card-input.js';
import {installExtensionReview} from './extension-review.js';
import {installDesignCases} from './design-cases-panel.js';
import {installStoreys} from './storeys.js';
import {installRenovation} from './renovation.js';
import {installNewBuild} from './new-build.js';
import {installPlanWorkflow,PLAN_TAB_LABEL,PLAN_PANEL_ID} from './plan-workflow-panel.js';
import {installRailAutoHide} from './rail-autohide.js';
import {detectCornerCuts,statutoryCornerDistance,applyApprovedCornerCuts} from './parcel-corner.js';
import {normalizeDimStyles,getDimStyle,createDimStyle,updateDimStyle,deleteDimStyle,setCurrentDimStyle,applyDimStyle,DIM_PRESETS,dimPresetValues,restyleDimensions} from './dimension-style.js';
import {estimatedRoadWidthM,estimatedFrontageM,deadEndRoadRequirement,roadDisplayEntities,frontageRoads} from './parcel-road.js';
import './property-tools.js';
import './drafting-tools.js';
import './annotation-scale.js';
import './grid-tools.js';
import './dim-sequence.js';
import './mleader-tools.js';
import {buildSmartDimension} from './smart-dim.js';
import {withDimAssoc,radialAssoc,assocFromPicks,lookupIn,snapSource} from './dim-assoc.js';
import {dimensionPreview,installDimensionEditing} from './dimension-preview.js';
import {renderDimensionBreakPreview} from './dimension-break-preview.js';
import {prepareDimensionExport} from './dimension-export.js';
import './sheet-edit-tools.js';
import './block-library.js';
import './title-tools.js';
import './detail-library.js';
import {quickMenuModel,readRecent,recordRecent,openQuickMenu} from './quick-menu.js';
import {hatchPatternFields,hatchPatternChoices,GPU_HATCH_RASTER} from './hatch-patterns.js';import {notifyLinkedTables} from './table-datalink.js';
// ACAD200 영역 3(선택·스냅·입력·그립): 판단은 input-assist.js 묶음에, app.js 에는 연결만 둔다.
import * as IA from './input-assist.js';
const assist=IA.createInputAssist({storage:typeof localStorage!=='undefined'?localStorage:null});
import {installColorPicker,hasMixedColor} from './color-picker.js';import {buildPropertyPalette} from './properties-palette.js';import {installPropertiesDock} from './properties-dock.js';import {applyCurrentProperties,emptyCurrentProperties,isDefaultCurrent,describeColor,linetypeChoices,parseColor,colorChanges,parseLinetype,colorOfEntity,COLOR_NAMES,linetypeLabel,linetypeSample,STANDARD_LINETYPES,LINEWEIGHTS,parseLineweight} from './cad-properties.js';
function massFootprints(entities) {
  return entities.filter(e => e.type === 'wall').flatMap(e => G.wallPolygons(e)).filter(p => p.length >= 3);
}
function inferLayerWalls(entities, layerIds) {
  const polygons=[],lines=[];
  for(const e of entities){
    if(!layerIds.has(e.layer)||e.type==='wall')continue;
    // 콘크리트 벽을 해치(채움)로 그린 도면: 해치 경계 중 벽처럼 얇은 루프를 벽 외곽으로 쓴다(닫힌 폴리선과 같은 두께 기준).
    if(e.type==='hatch'){
      for(const ring of G.hatchRings(e)){
        const area=Math.abs(G.polygonArea(ring)),perimeter=ring.reduce((s,p,i)=>s+G.dist(p,ring[(i+1)%ring.length]),0);
        if(perimeter>0&&2*area/perimeter>=50&&2*area/perimeter<=600)polygons.push(ring);
      }
      continue;
    }
    if((e.type==='rectangle'||e.type==='polyline'&&e.closed)&&e.points?.length>=3){
      const area=Math.abs(G.polygonArea(e.points));
      const perimeter=G.segments(e).reduce((s,[a,b])=>s+G.dist(a,b),0);
      // Reject broad closed outlines: these may be rooms, slabs or sites.
      if(perimeter>0&&2*area/perimeter>=50&&2*area/perimeter<=600)polygons.push(e.points);
    }else if(e.type==='line'||e.type==='polyline'){
      for(const [a,b] of G.segments(e))if(G.dist(a,b)>=300)lines.push({a,b,layer:e.layer});
    }
  }
  const used=new Set();
  for(let i=0;i<lines.length;i++){
    if(used.has(i))continue;
    const a=lines[i],length=G.dist(a.a,a.b),u=G.mul(G.sub(a.b,a.a),1/length),n={x:-u.y,y:u.x};let best=null;
    for(let j=i+1;j<lines.length;j++){
      if(used.has(j)||lines[j].layer!==a.layer)continue;
      const b=lines[j],v=G.sub(b.b,b.a),vl=G.len(v);
      if(Math.abs(G.dot(u,v)/vl)<0.9998)continue;
      const offset=G.dot(G.sub(b.a,a.a),n),distance=Math.abs(offset);
      if(distance<50||distance>600)continue;
      const t0=G.dot(G.sub(b.a,a.a),u),t1=G.dot(G.sub(b.b,a.a),u),lo=Math.max(0,Math.min(t0,t1)),hi=Math.min(length,Math.max(t0,t1));
      if(hi-lo<300||(hi-lo)/Math.min(length,vl)<0.7)continue;
      if(!best||distance<best.distance)best={j,lo,hi,offset,distance};
    }
    if(best){const p=G.add(a.a,G.mul(u,best.lo)),q=G.add(a.a,G.mul(u,best.hi)),d=G.mul(n,best.offset);polygons.push([p,q,G.add(q,d),G.add(p,d)]);used.add(i);used.add(best.j);}
  }
  return polygons;
}

function classifyWallLayer(name,entities,polygons) {
  if(!polygons.length)return {auto:false,reason:'벽체 형태 없음'};
  if(/furn|fur(?:[-_\s]|$)|가구|text|dim|leader|문자|치수|주석|door|window|창호|단열|insul|hatch|해치|grid|중심|기준선|입면|조경|심벌|symbol|defpoints|(?:^|[-_\s])(?:wd|wid|cen|ele|site|hat|sym)(?:$|[-_\s])/i.test(name))return {auto:false,reason:'비벽체 용도 제외'};
  const named=/wall|벽|partition|칸막이|concrete|콘크리트|조적|masonry|(?:^|[-_\s])con(?:$|[-_\s])/i.test(name);
  const long=polygons.filter(ps=>Math.max(...ps.map((p,i)=>G.dist(p,ps[(i+1)%ps.length])))>=1000).length;
  const eligible=entities.filter(e=>['line','polyline','rectangle'].includes(e.type)).length;
  const shape=long>=3&&long/polygons.length>=0.7&&polygons.length*2/Math.max(1,eligible)>=0.35;
  return {auto:named||shape,reason:named?'벽체 레이어명 + 형상':shape?'반복된 긴 벽체 형상':'벽체 근거 부족'};
}
function installSharedAccount(studio){
  // 공통 "계정 및 업데이트" 창(shared/account-window, 중앙 판). 주 헤더 단추 #shared-account는 언제나 이 창을 연다.
  // window.barunOpenAccountUpdate(options)·window.barunRenderUpdate(status)는 설치 함수가 그대로 제공한다.
  return installCadAccountWindow({studio,onError:message=>toast(message,true)});
}
function installParcel(studio){
  const dialog=document.createElement('dialog');dialog.id='parcel-dialog';
  dialog.innerHTML='<div class="dialog-header"><h2>주소로 대지 가져오기</h2><button class="parcel-close">닫기 ×</button></div><details><summary>토지 연결 설정 · 바른 계정</summary><p>기존 바른 서비스 계정으로 연결합니다. 비밀번호는 저장하지 않으며 로그인 세션만 Windows에 암호화해 보관합니다.</p><label>이메일 (관리자 비밀번호 로그인은 비움)<input class="parcel-email" type="email" autocomplete="username"></label><label>비밀번호<input class="parcel-password" type="password" autocomplete="current-password"></label><button class="parcel-login">연결</button></details><div class="parcel-search-row"><input class="parcel-query" aria-label="대지 주소" placeholder="예: 부산 사리로 64-1"><button class="parcel-search">주소 검색</button></div><label>검색된 주소<select class="parcel-candidates" aria-label="대지 주소 후보"></select></label><div class="parcel-search-row"><label>삽입 X(mm)<input class="parcel-x" type="number" value="0"></label><label>삽입 Y(mm)<input class="parcel-y" type="number" value="0"></label></div><label><input class="parcel-around" type="checkbox" checked>주변 도로·인접 필지도 가져오기</label><label>주변 범위 (m · 대지 경계 바깥)<input class="parcel-range" type="number" min="5" max="200" value="30"></label><section class="road-condition"><strong>도로 조건</strong><div class="parcel-search-row"><label>형태<select class="road-kind"><option value="normal">일반도로</option><option value="dead-end">막다른도로</option></select></label><label>막다른도로 길이(m)<input class="road-length" type="number" min="0" step="0.1" value="15" disabled></label></div><label><input class="road-rural" type="checkbox" disabled>35m 이상 · 도시지역이 아닌 읍·면</label><label><input class="road-terrain" type="checkbox" disabled>지형적 조건으로 지정·공고된 구간</label><p class="road-result">도로 경계를 조회하면 추정폭·접도 길이·필요폭을 도면에 표시합니다.</p></section><button class="parcel-fetch">경계 조회</button><div class="parcel-preview"></div><section class="corner-review" hidden><strong>도로 가각전제 검토</strong><p>도로폭을 입력하면 예정선과 제외면적을 계산합니다. 체크한 후보만 승인 반영됩니다.</p><div class="corner-list"></div></section><p class="parcel-status" role="status">주소를 검색하고 해당 필지를 선택하세요.</p><button class="parcel-insert primary" disabled>대지경계·도로·주변필지 추가</button>';
  document.body.append(dialog);const find=s=>dialog.querySelector(s);let prepared=null,inFlight=false;const pickedParcels=new Map();
  const drawBox=document.createElement('fieldset');drawBox.innerHTML='<legend>넣을 정보</legend>';for(const [key,label] of Object.entries({boundary:'대지 경계',road:'도로',dimensions:'치수',info:'정보표',neighbors:'주변 필지',roadHatch:'도로 해치',sunLine:'일조선'})){const l=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.dataset.siteDraw=key;input.checked=SITE_DRAW_OPTIONS[key];input.style.accentColor='#9dcbe0';l.append(input,document.createTextNode(label));drawBox.append(l);}find('.parcel-fetch').before(drawBox);
  const drawOptions=()=>Object.fromEntries([...drawBox.querySelectorAll('input')].map(e=>[e.dataset.siteDraw,e.checked]));
  const roadEvidenceBox=document.createElement('section');find('.road-result').after(roadEvidenceBox);
  const reload=document.createElement('dialog');reload.id='parcel-reload-dialog';reload.innerHTML='<div class="dialog-header"><h2>대지 다시 불러오기 비교</h2><button type="button" class="reload-cancel">닫기 ×</button></div><p>변경된 항목만 표시합니다. 선택한 새 조회값만 반영하며, 선택하지 않은 설계자 값은 유지합니다.</p><div class="reload-items"></div><button type="button" class="reload-apply primary">선택한 값 반영</button>';document.body.append(reload);
  const compareReload=rows=>new Promise(resolve=>{const list=reload.querySelector('.reload-items'),table=document.createElement('table'),head=document.createElement('tr');list.replaceChildren(table);for(const title of ['반영할 항목','원조회값','현재·설계자 값','새 조회값']){const th=document.createElement('th');th.textContent=title;head.append(th);}table.append(head);const display=v=>v==null?'—':typeof v==='object'&&Object.hasOwn(v,'value')?v.value==null?'—'+(v.sourceRef?.raw!=null?` (조회 ${v.sourceRef.raw}${v.sourceRef.unit||v.unit||''} · 미확인)`:''):String(v.value)+(v.unit||''):typeof v==='object'?JSON.stringify(v):String(v);for(const row of rows){const tr=document.createElement('tr'),td=document.createElement('td'),label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.dataset.key=row.key;label.append(check,document.createTextNode(`${row.pnu} · ${row.key}`));td.append(label);tr.append(td);for(const value of [row.original,row.designer,row.fresh]){const cell=document.createElement('td'),text=display(value);if(text.length>160){const details=document.createElement('details'),summary=document.createElement('summary'),full=document.createElement('pre');summary.textContent=text.slice(0,120)+'…';full.textContent=text;details.append(summary,full);cell.append(details);}else cell.textContent=text;tr.append(cell);}table.append(tr);}const finish=value=>{reload.close();resolve(value);};reload.querySelector('.reload-cancel').onclick=()=>finish(null);reload.oncancel=e=>{e.preventDefault();finish(null);};reload.querySelector('.reload-apply').onclick=()=>finish([...list.querySelectorAll('input:checked')].map(e=>e.dataset.key));reload.showModal();});
  find('.parcel-candidates').size=4;
  const parcelPickRow=document.createElement('div');parcelPickRow.className='parcel-search-row parcel-pick-row';parcelPickRow.innerHTML='<button class="parcel-add" type="button">선택한 필지 담기</button><span class="parcel-picked-count">선택 0/10</span>';
  const parcelPicked=document.createElement('div');parcelPicked.className='parcel-picked';parcelPicked.setAttribute('aria-label','가져올 필지');find('.parcel-candidates').closest('label').after(parcelPickRow,parcelPicked);
  find('.parcel-fetch').textContent='선택한 대지 경계 조회';
  const legalReview=document.createElement('section');legalReview.className='parcel-legal-review';legalReview.hidden=true;legalReview.innerHTML='<strong>대지 기본 검토</strong><div class="parcel-legal-list"></div>';find('.parcel-status').before(legalReview);
  const status=text=>find('.parcel-status').textContent=text;
  const roadOptions=()=>({deadEnd:find('.road-kind').value==='dead-end',deadEndLengthM:Number(find('.road-length').value),nonUrbanTownship:find('.road-rural').checked,terrainException:find('.road-terrain').checked});
  find('.road-kind').onchange=()=>{const on=find('.road-kind').value==='dead-end';find('.road-length').disabled=find('.road-rural').disabled=find('.road-terrain').disabled=!on;};
  const invalidate=()=>{prepared=null;find('.parcel-insert').disabled=true;find('.parcel-preview').replaceChildren();find('.corner-review').hidden=true;find('.corner-list').replaceChildren();legalReview.hidden=true;legalReview.querySelector('.parcel-legal-list').replaceChildren();};
  const task=async fn=>{if(inFlight)return;inFlight=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){status(userErrorMessage(e));}finally{inFlight=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);find('.parcel-insert').disabled=!prepared;}};
  find('.parcel-close').onclick=()=>dialog.close();
  const account=document.createElement('dialog');account.id='account-dialog';
  account.innerHTML='<div class="dialog-header"><h2>바른 계정 로그인</h2><button class="account-close">닫기 ×</button></div><p>회원으로 로그인하면 주소로 대지·도로 경계를 가져와 CAD에서 편집할 수 있습니다.</p><div class="account-fields"></div><p class="account-status" role="status"></p><div class="account-actions"><a href="https://barunarc.co.kr/join" target="_blank" rel="noopener noreferrer">회원가입 · 건축사사무소</a><button class="account-logout">로그아웃</button></div><p class="account-note">가입은 바른 웹사이트에서 진행합니다. 가입 후 이 창에서 로그인하세요. 기본 CAD 편집은 로그인 없이 사용할 수 있습니다.</p>';
  document.body.append(account);
  const accountFields=account.querySelector('.account-fields');for(const cls of ['.parcel-email','.parcel-password'])accountFields.append(find(cls).closest('label'));const loginButton=find('.parcel-login');loginButton.textContent='로그인';accountFields.append(loginButton);dialog.querySelector('details').remove();
  const accountStatus=message=>account.querySelector('.account-status').textContent=message;
  let continueToParcel=false,accountBusy=false;
  const showAccount=()=>{if(!account.open)account.showModal();account.querySelector('.parcel-email').focus();};
  account.querySelector('.account-close').onclick=()=>{continueToParcel=false;account.close();};
  async function refreshAccount(){
    try{
      const r=await studio.api('parcel',{action:'status'});
      const identity=[r.officeName,r.userName].filter(Boolean).join(' · ');
      accountFields.hidden=!!r.connected;
      account.querySelector('h2').textContent=r.connected?'내 계정':'바른 계정 로그인';
      account.querySelector('.account-logout').hidden=!r.connected;
      account.querySelector('.account-actions a').hidden=!!r.connected;
      account.querySelector('.account-note').hidden=!!r.connected;
      accountStatus(r.connected?(identity?identity+' · 로그인됨':'로그인됨 · 사무소 정보를 불러오지 못했습니다.'):r.message||'바른 계정으로 로그인하세요.');
      window.dispatchEvent(new CustomEvent('barun-parcel-account',{detail:{connected:!!r.connected}}));   // 계획 탭의 로그인 표시를 맞춘다
      return r.connected;
    }catch(e){accountStatus(userErrorMessage(e));return false;}
  }
  loginButton.onclick=async()=>{if(accountBusy)return;accountBusy=true;loginButton.disabled=true;accountStatus('로그인 중…');const password=account.querySelector('.parcel-password').value;account.querySelector('.parcel-password').value='';try{await studio.api('parcel',{action:'login',email:account.querySelector('.parcel-email').value,password});await refreshAccount();account.close();if(continueToParcel){continueToParcel=false;dialog.showModal();find('.parcel-query').focus();}}catch(e){accountStatus(userErrorMessage(e));}finally{accountBusy=false;loginButton.disabled=false;}};
  account.querySelector('.account-logout').onclick=async()=>{if(accountBusy)return;accountBusy=true;try{await studio.api('parcel',{action:'logout'});await refreshAccount();account.querySelector('.parcel-email').value='';}catch(e){accountStatus(userErrorMessage(e));}finally{accountBusy=false;}};
  account.addEventListener('keydown',e=>{e.stopPropagation();if(!e.isComposing&&e.key==='Enter'&&e.target.matches('input')){e.preventDefault();loginButton.click();}});
  account.addEventListener('cancel',()=>{continueToParcel=false;});
  refreshAccount();
  find('.parcel-search').onclick=()=>task(async()=>{invalidate();find('.parcel-candidates').replaceChildren();status('주소 검색 중…');const r=await studio.api('parcel',{action:'search',query:find('.parcel-query').value});for(const row of r.results){const option=document.createElement('option');option.value=row.pnu;option.textContent=[row.roadAddress,row.jibunAddress].filter(Boolean).join(' / ');find('.parcel-candidates').append(option);}status(r.results.length?`${r.results.length}개 주소 · 지번을 확인한 뒤 경계를 조회하세요.`:'검색 결과가 없습니다. 시·군·구를 포함해 입력하세요.');});
  const renderPicked=()=>{parcelPicked.replaceChildren();for(const [pnu,label] of pickedParcels){const chip=document.createElement('span');chip.className='parcel-chip';chip.append(document.createTextNode(label));const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='필지 빼기';remove.onclick=()=>{pickedParcels.delete(pnu);invalidate();renderPicked();};chip.append(remove);parcelPicked.append(chip);}find('.parcel-picked-count').textContent=`선택 ${pickedParcels.size}/10`;};
  find('.parcel-add').onclick=()=>{const option=find('.parcel-candidates').selectedOptions[0];if(!option){status('검색 결과에서 필지를 선택하세요.');return;}if(!pickedParcels.has(option.value)&&pickedParcels.size>=10){status('한 번에 최대 10필지까지 가져올 수 있습니다.');return;}pickedParcels.set(option.value,option.textContent);invalidate();renderPicked();status(`${pickedParcels.size}필지를 담았습니다. 다른 주소를 검색해 계속 추가할 수 있습니다.`);};
  for(const selector of ['.parcel-x','.parcel-y','.parcel-around','.parcel-range'])find(selector).addEventListener('change',invalidate);
  find('.parcel-fetch').onclick=()=>task(async()=>{invalidate();const selected=[...pickedParcels.keys()];if(!selected.length){const option=find('.parcel-candidates').selectedOptions[0];if(option){pickedParcels.set(option.value,option.textContent);renderPicked();selected.push(option.value);}}if(!selected.length)throw Error('가져올 필지를 한 개 이상 담으세요.');status(`${selected.length}필지와 주변 경계 조회 중…`);const r=await studio.api('parcel',{action:'fetch',pnus:selected,x:Number(find('.parcel-x').value),y:Number(find('.parcel-y').value),surroundings:find('.parcel-around').checked,contextMeters:Number(find('.parcel-range').value),crs:'EPSG:5187',...(engine.doc.drawingGeo?.crs==='EPSG:5187'?{originM:engine.doc.drawingGeo.originM}:{})});prepared=r;
    roadEvidenceBox.replaceChildren();const detected=roadEvidenceFromContext(createSiteContext(r.entities,{info:Object.values(r.landInfoByPnu||{})[0]}));prepared.roadEdges=detected.map(e=>({...e}));for(const [i,edge] of prepared.roadEdges.entries()){const label=document.createElement('label'),legal=document.createElement('select'),width=document.createElement('input');label.append(document.createTextNode(`접도변 ${edge.ringIdx+1}-${edge.index+1} · 현황 추정 ${edge.measuredWidthM??'—'}m `));for(const [value,text] of [['unknown','법적 지위 미확인'],['confirmed','법적 도로 확인'],['not-road','도로 아님']]){const o=document.createElement('option');o.value=value;o.textContent=text;legal.append(o);}width.type='number';width.min='0.1';width.step='0.1';width.placeholder='확인한 폭(m)';width.setAttribute('aria-label',`접도변 ${i+1} 확인 폭(m)`);legal.onchange=()=>edge.legalStatus=legal.value;width.oninput=()=>edge.confirmedWidthM=width.value===''?null:Number(width.value);label.append(legal,width);roadEvidenceBox.append(label);}
    const b=G.bounds(r.entities),ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');const w=Math.max(1,b.maxX-b.minX),h=Math.max(1,b.maxY-b.minY),padding=Math.max(w,h)*.05;svg.setAttribute('viewBox',`${b.minX-padding} ${-b.maxY-padding} ${w+2*padding} ${h+2*padding}`);svg.setAttribute('aria-label','가져올 대지 경계 미리보기');
    for(const e of r.entities){const line=document.createElementNS(ns,'polygon');line.setAttribute('points',e.points.map(p=>`${p.x},${-p.y}`).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke',e.parcelRole==='site'?'#ffd479':e.parcelRole==='road'?'#91b4c9':'#506574');line.setAttribute('stroke-width','1.5');line.setAttribute('vector-effect','non-scaling-stroke');svg.append(line);}find('.parcel-preview').append(svg);
    const corners=detectCornerCuts(r.entities),review=find('.corner-review'),list=find('.corner-list');review.hidden=false;
    if(!corners.length){list.textContent=r.counts.road?'두 도로가 만나는 대지 모퉁이를 찾지 못했습니다. 도로 경계를 확인하세요.':'주변 도로 자료가 없어 자동 판정할 수 없습니다.';}
    const redraw=()=>{svg.querySelectorAll('.corner-preview').forEach(n=>n.remove());let total=0,approved=0;for(const row of list.querySelectorAll('.corner-row')){const corner=corners[Number(row.dataset.index)],widths=[...row.querySelectorAll('input[type=number]')].map(n=>Number(n.value)),rule=statutoryCornerDistance(widths[0],widths[1],corner.angleDeg),decision=row.querySelector('input[type=checkbox]');decision.disabled=!rule.distanceM;row.querySelector('output').textContent=rule.distanceM?`${rule.distanceM}m 전제 · 약 ${(rule.distanceM**2*Math.sin(corner.angleDeg*Math.PI/180)/2).toFixed(2)}㎡ 제외`:rule.status;if(!rule.distanceM)decision.checked=false;if(decision.checked){approved++;total+=rule.distanceM**2*Math.sin(corner.angleDeg*Math.PI/180)/2;const a=G.add(corner.vertex,G.mul(G.unit(G.sub(corner.previous,corner.vertex)),rule.distanceM*1000)),b=G.add(corner.vertex,G.mul(G.unit(G.sub(corner.next,corner.vertex)),rule.distanceM*1000)),line=document.createElementNS(ns,'polyline');line.classList.add('corner-preview');line.setAttribute('points',`${a.x},${-a.y} ${b.x},${-b.y}`);line.setAttribute('fill','none');line.setAttribute('stroke','#9dcbe0');line.setAttribute('stroke-width','3');line.setAttribute('vector-effect','non-scaling-stroke');svg.append(line);}}
      find('.parcel-insert').textContent=approved?`승인한 가각전제 ${approved}곳 포함 · 대지 추가`:'대지경계·도로·주변필지 추가';find('.parcel-insert').dataset.cornerArea=String(total);};
    // BC-02: 외부 자료(도로 이름)는 innerHTML 대신 DOM 으로 만든다.
    corners.forEach((corner,index)=>{const row=document.createElement('div');row.className='corner-row';row.dataset.index=index;const approve=document.createElement('label'),check=document.createElement('input');check.type='checkbox';approve.append(check,document.createTextNode(`후보 ${index+1} 승인`));const angle=document.createElement('span');angle.textContent=`교차각 ${corner.angleDeg.toFixed(1)}°`;row.append(approve,angle);for(const road of [corner.roadLabels[0],corner.roadLabels[1]]){const label=document.createElement('label'),width=document.createElement('input');width.type='number';width.min='0.1';width.step='0.1';width.placeholder='확인';label.append(document.createTextNode(`${road} 폭(m)`),width);row.append(label);}const out=document.createElement('output');out.textContent='도로폭 확인 필요';row.append(out);row.addEventListener('input',redraw);list.append(row);});redraw();prepared.cornerCandidates=corners;
    const widths=frontageRoads(r.entities).map(estimatedRoadWidthM).filter(Number.isFinite),frontage=estimatedFrontageM(r.entities),roadRule=roadOptions().deadEnd?deadEndRoadRequirement(roadOptions().deadEndLengthM,roadOptions()):null;
    find('.road-result').textContent=`접도 추정 ${frontage.toFixed(2)}m / 기준 2m · 도로 추정폭 ${widths.length?widths.map(w=>w.toFixed(2)+'m').join(', '):'확인 필요'}${roadRule?` · 막다른도로 필요폭 ${roadRule.requiredWidthM??'—'}m (${roadRule.label})`:''}`;
    legalReview.hidden=false;legalReview.querySelector('.parcel-legal-list').replaceChildren(...[['warn',`접도 추정 ${frontage.toFixed(2)}m / 기준 2m`],['warn',`도로폭 ${widths.length?'지적경계 추정':'공적자료 확인'}`],[r.landInfoByPnu&&Object.values(r.landInfoByPnu).every(v=>!v.error)?'ok':'warn',`용도지역·지구 ${r.landInfoByPnu?'조회':'확인 필요'}`],['warn','지구단위계획·도시계획시설 확인'],['warn','문화재·군사·항공·재해·농지·산지 확인']].map(([cls,text])=>{const span=document.createElement('span');span.className=cls;span.textContent=text;return span;}));
    status(`선택 ${r.pnus?.length||1}필지 · 대지 ${r.counts.site} · 도로 ${r.counts.road} · 인접 ${r.counts.neighbor} 경계 · 가각전제 후보 ${corners.length}곳. ${r.warnings.join(' ')}`);
  });
  find('.parcel-insert').onclick=()=>task(async()=>{if(!prepared)return;
    const approvals=[...find('.corner-list').querySelectorAll('.corner-row')].map(row=>{const corner=prepared.cornerCandidates[Number(row.dataset.index)],widths=[...row.querySelectorAll('input[type=number]')].map(n=>Number(n.value)),rule=statutoryCornerDistance(widths[0],widths[1],corner.angleDeg);return {...corner,widths,distanceM:rule.distanceM,approved:row.querySelector('input[type=checkbox]').checked};});
    const options=drawOptions(),result=applyApprovedCornerCuts(prepared.entities,approvals),updatedRoadEdges=remapRoadEvidence(result.entities,prepared.roadEdges),entities=[...result.entities,...roadDisplayEntities(prepared.entities,{...roadOptions(),roadEdges:updatedRoadEdges})];
    if(options.dimensions)for(const e of result.entities.filter(e=>e.parcelRole==='site'))for(const [a,b] of G.segments(e)){const mid=G.mul(G.add(a,b),.5);entities.push({type:'dimension',mode:'aligned',points:[{...a},{...b},{x:mid.x,y:mid.y+800}],parcelRole:'site-dimension'});}
    const contexts={},rows=[],existing=new Map(),commands=[];for(const pnu of new Set(prepared.entities.filter(e=>e.parcelRole==='site').map(e=>e.attributes?.pnu))){const raw=prepared.landInfoByPnu?.[pnu]||prepared.entities.find(e=>e.attributes?.pnu===pnu)?.attributes?.landInfo||{pnu};const fresh=createSiteContext(prepared.entities.filter(e=>e.parcelRole!=='site'||e.attributes?.pnu===pnu),{info:raw,cornerDeductionM2:Math.max(0,(createSiteContext(prepared.entities.filter(e=>e.parcelRole==='site'&&e.attributes?.pnu===pnu)).areas.polygonAreaM2.sourceRef?.raw??0)-(createSiteContext(result.entities.filter(e=>e.parcelRole==='site'&&e.attributes?.pnu===pnu)).areas.polygonAreaM2.sourceRef?.raw??0)),drawOptions:options,roadEdges:updatedRoadEdges.filter(edge=>prepared.entities.filter(e=>e.parcelRole==='site'&&e.attributes?.ring!=='hole')[edge.ringIdx]?.attributes?.pnu===pnu).map(edge=>({...edge,ringIdx:prepared.entities.filter(e=>e.parcelRole==='site'&&e.attributes?.ring!=='hole'&&e.attributes?.pnu===pnu).indexOf(prepared.entities.filter(e=>e.parcelRole==='site'&&e.attributes?.ring!=='hole')[edge.ringIdx])}))});contexts[pnu]=fresh;const sites=G.parcelEntities(engine.doc.entities).filter(e=>e.parcelRole==='site'&&e.attributes?.pnu===pnu);const table=engine.doc.entities.find(e=>e.siteInfoTableId==='site-info:'+pnu);if(sites.length||table){const current=sites[0]?.attributes?.siteContext||table?.siteContext||createSiteContext(sites,{info:sites[0]?.attributes?.landInfo}),original=sites[0]?.attributes?.siteSourceContext||table?.siteSourceContext||current;existing.set(pnu,{current,fresh,sites});for(const row of compareSiteContext(original,current,fresh))rows.push({...row,pnu,key:pnu+':'+row.key});const source=sites[0]?.attributes?.siteSourceGeometry??sites.map(e=>e.points),next=prepared.entities.filter(e=>e.parcelRole==='site'&&e.attributes?.pnu===pnu).map(e=>e.points);if(sites.length&&(JSON.stringify(source)!==JSON.stringify(next)||JSON.stringify(source)!==JSON.stringify(sites.map(e=>e.points))))rows.push({pnu,key:pnu+':geometry',original:source,designer:sites.map(e=>e.points),fresh:next});}}
    const selected=rows.length?await compareReload(rows):[];if(selected===null)return;
    for(const [pnu,{current,fresh,sites}] of existing){const keys=selected.filter(k=>k.startsWith(pnu+':')).map(k=>k.slice(pnu.length+1)),merged=mergeSiteContext(current,fresh,keys);if(keys.includes('geometry')){commands.push({type:'parcel.geometry',pnu,entities:entities.filter(e=>e.attributes?.pnu===pnu&&e.parcelRole==='site'),siteContext:merged});}commands.push({type:'parcel.info',info:{...merged.landInfo,pnu},siteContext:merged,sourceContext:fresh,drawOptions:options});}
    const newEntities=entities.filter(e=>!existing.has(e.attributes?.pnu));if(newEntities.some(e=>e.parcelRole==='site'))commands.unshift({type:'parcel.import',entities:newEntities,...(prepared.drawingGeo?{drawingGeo:prepared.drawingGeo}:{}),drawOptions:options,siteContexts:contexts});
    if(commands.length){const ids=execute({type:'batch',commands});setSelected(ids);fit();}prepared=null;dialog.close();toast('선택한 대지 정보 반영 완료 · 조회값은 확인 전 상태입니다.');
  });
  dialog.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter'&&e.target===find('.parcel-query')){e.preventDefault();find('.parcel-search').click();}});
  const open=async()=>{if(!await refreshAccount()){continueToParcel=true;showAccount();return;}dialog.showModal();find('.parcel-query').focus();};studio.handlers.PARCEL=open;
  // 계획 탭의 [바른 계정 로그인]: 이메일 로그인 창만 연다(대지 가져오기 창으로 이어가지 않는다).
  // 로그인은 하나: 오른쪽 위 공통 계정 창([계정 연결] — 카카오·구글). 예전 이메일 창은 그 창이 없을 때만.
  studio.context.openParcelLogin=()=>{continueToParcel=false;if(typeof window.barunOpenAccountUpdate==='function'){window.barunOpenAccountUpdate();return;}refreshAccount();showAccount();};
  studio.context.openParcel=async(query='',options={})=>{find('.parcel-query').value=query;if(options.contextMeters!==undefined)find('.parcel-range').value=options.contextMeters;if(options.surroundings!==undefined)find('.parcel-around').checked=options.surroundings;await open();if(query&&dialog.open)find('.parcel-search').click();};
  const button=document.createElement('button');button.textContent='대지 가져오기';button.dataset.menuNative='PARCEL';button.onclick=open;document.querySelector('#canvas-tools').prepend(button);
}
function installMassView({engine,selected,toast}) {
  const button=document.createElement('button');button.textContent='3D 매스';button.id='mass-view-open';
  document.querySelector('#canvas-tools').prepend(button);
  const panel=document.createElement('section');panel.id='mass-view';panel.hidden=true;
  panel.innerHTML='<div class="mass-controls"><strong>3D 매스 · 벽체만</strong><label>높이(m) <input aria-label="매스 높이(m)" type="number" min="0.1" max="1000" step="0.5" value="3"></label><button class="mass-fit">전체 보기</button><button class="mass-close">2D 도면으로</button></div><canvas aria-label="3D 매스 보기"></canvas><p>벽체만 표시 · 선택하지 않으면 전체 벽체 표시 · 드래그 회전 · 휠 확대 · 도면 단위 mm · 실제 건축 모델이 아닌 높이 미리보기</p>';
  document.querySelector('.viewport').append(panel);
  const layersBox=document.createElement('details');layersBox.className='mass-layer-options';
  const layersTitle=document.createElement('summary');layersTitle.textContent='벽체 레이어 선택';layersBox.append(layersTitle);
  const layerPopover=document.createElement('div');layerPopover.className='mass-layer-popover';layersBox.append(layerPopover);
  const layerChoices=document.createElement('div');layerChoices.className='mass-layer-list';layerPopover.append(layerChoices);panel.querySelector('.mass-controls').append(layersBox);
  const analysisStatus=document.createElement('span');layerPopover.append(analysisStatus);
  const autoAnalyze=document.createElement('button');autoAnalyze.textContent='벽체 자동 분석';panel.querySelector('.mass-controls').append(autoAnalyze);
  const autoStatus=document.createElement('span');autoStatus.className='mass-auto-status';autoStatus.setAttribute('role','status');panel.querySelector('.mass-controls').after(autoStatus);
  const applyLayers=document.createElement('button');applyLayers.textContent='선택 완료 · 모델 보기';layerPopover.append(applyLayers);
  applyLayers.onclick=()=>{layersBox.open=false;zoom=1;draw();};
  panel.addEventListener('pointerdown',e=>{if(!layersBox.contains(e.target))layersBox.open=false;});
  let sourceEntities=[];
  const rebuild=()=>{const ids=new Set([...layerChoices.querySelectorAll('input:checked')].map(e=>e.value));const native=massFootprints(sourceEntities),inferred=inferLayerWalls(sourceEntities,ids);footprints=[...native,...inferred];analysisStatus.textContent=`벽체 ${native.length}개 · 추정 ${inferred.length}개 (원본 유지)`;const names=engine.doc.layers.filter(l=>ids.has(l.id)).map(l=>l.name);autoStatus.textContent=`${names.length?names.join(', '):'기존 벽체'} · ${native.length+inferred.length}개 표시 · 추정 결과는 레이어 선택에서 조정`;draw();};
  const canvas=panel.querySelector('canvas'),ctx=canvas.getContext('2d');let footprints=[],angle=-0.6,tilt=0.55,zoom=1,drag=null;
  function draw(){
    if(panel.hidden)return;
    const w=canvas.clientWidth,h=canvas.clientHeight,dpr=devicePixelRatio||1;canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#111d26';ctx.fillRect(0,0,w,h);
    if(!footprints.length){ctx.fillStyle='#bdd1dc';ctx.font='13px sans-serif';ctx.fillText('벽체 후보 없음 · 레이어를 선택해 주세요.',12,35);return;}
    const height=Number(panel.querySelector('input').value)*1000;if(!Number.isFinite(height)||height<=0)return;
    const all=footprints.flat(),xs=all.map(p=>p.x),ys=all.map(p=>p.y),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
    const project=(p,z)=>{const x=p.x-cx,y=p.y-cy,u=x*Math.cos(angle)-y*Math.sin(angle),v=x*Math.sin(angle)+y*Math.cos(angle);return {x:u,y:v*Math.sin(tilt)-z*Math.cos(tilt),depth:v*Math.cos(tilt)+z*Math.sin(tilt)};};
    const corners=all.flatMap(p=>[project(p,0),project(p,height)]),px=corners.map(p=>p.x),py=corners.map(p=>p.y),minX=Math.min(...px),maxX=Math.max(...px),minY=Math.min(...py),maxY=Math.max(...py),scale=Math.min(Math.max(10,w-24)/Math.max(1,maxX-minX),Math.max(10,h-24)/Math.max(1,maxY-minY))*zoom;
    const faces=[];for(const ps of footprints){faces.push({ps:ps.map(p=>project(p,height)),top:true});for(let i=0;i<ps.length;i++){const a=ps[i],b=ps[(i+1)%ps.length];faces.push({ps:[project(a,0),project(b,0),project(b,height),project(a,height)],top:false});}}
    faces.sort((a,b)=>a.ps.reduce((s,p)=>s+p.depth,0)/a.ps.length-b.ps.reduce((s,p)=>s+p.depth,0)/b.ps.length);
    for(const face of faces){ctx.beginPath();face.ps.forEach((p,i)=>{const x=w/2+(p.x-(minX+maxX)/2)*scale,y=h/2+(p.y-(minY+maxY)/2)*scale;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.closePath();ctx.fillStyle=face.top?'#b4d6df':'#527c92';ctx.fill();ctx.strokeStyle='#d2edf6';ctx.lineWidth=1;ctx.stroke();}
  }
  button.onclick=()=>{
    const ids=selected();sourceEntities=engine.doc.entities.filter(e=>!ids.size||ids.has(e.id)).filter(e=>{const l=engine.doc.layers.find(l=>l.id===e.layer);return l?.visible!==false&&!l?.frozen;});
    layerChoices.replaceChildren();
    for(const layer of engine.doc.layers){
      const es=sourceEntities.filter(e=>e.layer===layer.id);if(!es.length)continue;
      const polygons=inferLayerWalls(es,new Set([layer.id])),geometric=polygons.length;
      const verdict=classifyWallLayer(layer.name,es,polygons);
      const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.value=layer.id;check.checked=verdict.auto;check.onchange=rebuild;
      label.append(check,document.createTextNode(`${layer.name} · 후보 ${geometric}개 · ${verdict.auto?'자동 선택 · ':''}${verdict.reason}`));layerChoices.append(label);
    }
    panel.hidden=false;zoom=1;rebuild();layersBox.open=false;
  };
  autoAnalyze.onclick=()=>button.onclick();
  panel.querySelector('.mass-close').onclick=()=>panel.hidden=true;panel.querySelector('.mass-fit').onclick=()=>{zoom=1;draw();};panel.querySelector('input').oninput=draw;
  canvas.onpointerdown=e=>{drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);};canvas.onpointermove=e=>{if(!drag)return;angle+=(e.clientX-drag.x)*0.01;tilt=Math.max(0.1,Math.min(1.4,tilt+(e.clientY-drag.y)*0.01));drag={x:e.clientX,y:e.clientY};draw();};canvas.onpointerup=canvas.onpointercancel=()=>drag=null;canvas.onwheel=e=>{e.preventDefault();zoom=Math.max(0.2,Math.min(5,zoom*Math.exp(-e.deltaY*0.001)));draw();};
  panel.addEventListener('keydown',e=>e.stopPropagation());new ResizeObserver(draw).observe(canvas);
}


const $ = (id) => document.getElementById(id),
  engine = new DrawingEngine(),
  canvas = $("canvas"),
  ctx = canvas.getContext("2d");
// 앱을 켜자마자 보이는 첫 도면도 새 도면이다 — 바른 표준 레이어를 갖추고 시작한다.
engine.doc = newDrawingDocument();
let sceneRevision=0, sceneKey=null, sceneHighlights=null, selectionRevision=0,gpuEdit=null;
// AI presentation is armed only at the existing AI commit boundary.
let aiRevealArm=0, aiReveal=null, aiRevealSerial=0, aiRevealStage=null, aiDrawRevealSetting=null, aiRevealPointerTail=null;
const aiRevealAppendLoads=[];
function beginAIReveal({appendLoad=false}={}){aiRevealArm++;aiRevealAppendLoads.push(appendLoad);}
function endAIReveal({fit=false}={}){aiRevealArm=Math.max(0,aiRevealArm-1);aiRevealAppendLoads.pop();if(fit)setAIRevealFinalFit();return !!aiReveal;}
function aiDrawRevealEnabled(){if(aiDrawRevealSetting===null)try{aiDrawRevealSetting=localStorage.getItem('barun.aiDrawReveal')!=='0';}catch{aiDrawRevealSetting=true;}return aiDrawRevealSetting;}
// UCSICON: 원점 L자 표시 켜고 끄기(오토캐드와 같은 명령). 이 컴퓨터에 기억한다.
let ucsIconSetting=null;
function ucsIconOn(){if(ucsIconSetting===null)try{ucsIconSetting=localStorage.getItem('barun.ucsIcon')!=='0';}catch{ucsIconSetting=true;}return ucsIconSetting;}
function finishAIReveal(){
  if(!aiReveal)return;
  const reveal=aiReveal;aiReveal=null;
  const follow=reveal.player?.followCamera!==false;
  reveal.player?.destroy();reveal.layoutObserver?.disconnect();
  if(follow&&reveal.finalView&&!reveal.handoff){scale=reveal.finalView.scale;origin={...reveal.finalView.origin};viewMoving=false;}
  sceneKey=null;sceneHighlights=null;
  if(reveal.handoff)for(const surface of [reveal.handoff.from,reveal.handoff.to])surface.width=surface.height=0;
  // gpuEdit was kept untouched while the previous document was displayed.
  reveal.stage.setProgress(reveal.plan.total,reveal.plan.total);
  reveal.stage.finish({label:'완료'});render();
  if(typeof pendingEngineCheckpoint!=='undefined'&&pendingEngineCheckpoint)scheduleEngineUiRefresh();
  // 한 벌의 다음 장: 끝까지 그린 장만 다음으로 넘어간다(건너뛰기·화면 조작이면 남은 장도 그대로 보인다)
  if(reveal.completed&&aiRevealQueue)setTimeout(()=>{if(aiRevealQueue&&!aiReveal)startAIRevealPhase();},400);
  else aiRevealQueue=null;
}
function completeAIReveal(){
  const reveal=aiReveal;
  if(!reveal)return;
  reveal.completed=true;
  if(typeof gpuView==='undefined'){finishAIReveal();return;}
  if(reveal.player.followCamera&&reveal.finalView){scale=reveal.finalView.scale;origin={...reveal.finalView.origin};}
  viewMoving=false;sceneKey=null;
  // Keep the existing resolved Canvas display styles and hatchFamilies path.
  // Only rasterization differs from the native GPU hatch shader (notably dots).
  paintAIRevealFrame();
  if(!gpuView.stats.active){finishAIReveal();return;}
  const from=document.createElement('canvas'),to=document.createElement('canvas');
  from.width=to.width=canvas.width;from.height=to.height=canvas.height;
  from.getContext('2d').drawImage(canvas,0,0);
  reveal.handoff={from,to,start:null,view:[width,height,scale,origin.x,origin.y,canvas.width,canvas.height].join()};
  sceneKey=null;render();
}
function paintAIRevealHandoff(){
  const reveal=aiReveal,transition=reveal.handoff;
  if(transition.view!==[width,height,scale,origin.x,origin.y,canvas.width,canvas.height].join()){
    finishAIReveal();return;
  }
  // Install and paint the real final scene through the normal renderer. Its
  // scene cache contains final pixels only, never the blended presentation.
  aiReveal=null;
  try{paintFrameInner();}finally{aiReveal=reveal;}
  const pending=gpuView.buildPending||gpuViewPending({...gpuView.stats,displayedDoc:gpuView.displayedDoc},
    {doc:reveal.doc,revision:sceneRevision,width,height,scale,origin,pixelRatio:canvas.width/width});
  const now=performance.now();
  if(!pending&&transition.start===null)transition.start=now;
  const fraction=transition.start===null?0:Math.min(1,(now-transition.start)/200);
  const target=transition.to.getContext('2d');
  target.clearRect(0,0,canvas.width,canvas.height);target.drawImage(canvas,0,0);
  // Both surfaces have transparent pixels. Add weighted premultiplied colors
  // instead of drawing full-strength GPU ink under fading Canvas ink.
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.globalAlpha=1-fraction;ctx.drawImage(transition.from,0,0);
  ctx.globalCompositeOperation='lighter';ctx.globalAlpha=fraction;ctx.drawImage(transition.to,0,0);ctx.restore();
  if(fraction===1)finishAIReveal();else render();
}
function aiRevealFitView(box,view,whole=false){
  if(!box||![box.minX,box.minY,box.maxX,box.maxY].every(Number.isFinite))return null;
  const rect=whole?{left:45,right:view.width-45,top:45,bottom:view.fitHeight-45}:
    {left:view.width*.08,right:view.width*.92,top:view.revealTop,bottom:view.fitHeight-view.height*.08};
  const nextScale=Math.max(1e-8,Math.min(500,Math.min(Math.max(20,rect.right-rect.left)/Math.max(1,box.maxX-box.minX),
    Math.max(20,rect.bottom-rect.top)/Math.max(1,box.maxY-box.minY))));
  return {scale:nextScale,origin:{x:(rect.left+rect.right)/2-(box.minX+box.maxX)/2*nextScale,
    y:(rect.top+rect.bottom)/2+(box.minY+box.maxY)/2*nextScale}};
}
function aiRevealBounds(plan){
  let box=null;
  for(const {bounds:b} of plan.clusters||[])if(b&&[b.minX,b.minY,b.maxX,b.maxY].every(Number.isFinite))
    box=box?{minX:Math.min(box.minX,b.minX),minY:Math.min(box.minY,b.minY),maxX:Math.max(box.maxX,b.maxX),maxY:Math.max(box.maxY,b.maxY)}:{...b};
  return box;
}
function setAIRevealFinalFit(){
  if(aiRevealQueue)return;   // 한 벌 연출 중에는 장마다 도곽에 고정한 시점을 '전체 보기'로 덮지 않는다
  if(aiReveal)aiReveal.finalView=aiRevealFitView(G.bounds(visible().filter(entity=>!entity.construction)),aiReveal.getView(),true);
  if(aiReveal?.finalView&&aiFollowView&&mode==='SELECT'&&phase==='idle'&&!drag){scale=aiReveal.finalView.scale;origin={...aiReveal.finalView.origin};viewMoving=false;render();}
}
function captureAIRevealPointer(e,type){
  let tail=aiRevealPointerTail;
  const stamp=Number.isFinite(e.timeStamp)?e.timeStamp:0;
  if(type==='pointerdown'&&tail){
    const continuous=e.button===tail.button&&e.pointerId===tail.pointerId&&stamp>=tail.stamp&&stamp-tail.stamp<=500&&
      Math.hypot((e.clientX??0)-tail.x,(e.clientY??0)-tail.y)<=4;
    if(continuous&&tail.pending.has('dblclick'))tail.pending=new Set(['dblclick']);
    else aiRevealPointerTail=tail=null;
  }
  if(tail&&stamp>tail.expires)aiRevealPointerTail=tail=null;
  if(tail&&tail.pending.has(type)&&e.button===tail.button&&(e.pointerId==null||e.pointerId===tail.pointerId)){
    tail.pending.delete(type);
    if(type==='pointerup')tail.expires=stamp+800;
    if(!tail.pending.size)aiRevealPointerTail=null;
    e.preventDefault();e.stopImmediatePropagation();return true;
  }
  if(type!=='pointerdown'||!aiReveal)return false;
  if(e.button===1||(e.button===0&&mode==='PAN')){aiReveal.player.stopCamera();finishAIReveal();return false;}
  aiRevealPointerTail={pointerId:e.pointerId,button:e.button,stamp,expires:Infinity,x:e.clientX??0,y:e.clientY??0,
    pending:new Set(['pointerup','click','auxclick','contextmenu','dblclick'])};
  e.preventDefault();e.stopImmediatePropagation();finishAIReveal();return true;
}
let draftingWaitModule=null, draftingWaitSerial=0;
function revealDraftingResult(doc, added){
  const serial=draftingWaitSerial;
  if(aiRevealQueue)return;   // 도면 한 벌은 장마다 연출 중 — 단면·상세 대기 화면이 그 연출을 끝내 버리지 않게
  if(document.hidden||!added?.length||added.length>4000||doc.entities.length>200000)return;
  if(!added.some(e=>e.detail||e.detailRole||['details','section','set','all'].includes(doc.drawingSets?.[e.drawingSet?.id]?.kind)))return;
  if(!aiDrawRevealEnabled())return;
  (draftingWaitModule ||= import('./drafting-wait-frame.js')).then(frame=>{
    if(serial!==draftingWaitSerial||engine.doc!==doc||document.hidden||!aiDrawRevealEnabled())return;
    const display=revealDisplayEntities(doc,added);
    const detail=added.length===1?added[0]:null;
    frame.showDraftingWait(canvas.closest('.viewport'),display,{title:detail?.attributes?.title||'단면·상세',
      scale:detail?.detail?.category?detail.detail.scale:null,enabled:aiDrawRevealEnabled,
      onReady:()=>{if(serial===draftingWaitSerial&&aiReveal)finishAIReveal();}});
  }).catch(error=>{draftingWaitModule=null;console.warn('[drafting-wait]',error);});
}
// 도면 한 벌(도곽이 있는 AI 결과)은 장마다 차례로 연출한다(사용자 2026-10-25): 그 장 도곽을 화면에 꽉 채워 고정하고,
// 도곽 안을 중심선부터 그린 뒤 다음 장(목록 → 평면 층마다 → 입면 → 단면 → 창호도 → 상세). 연출은 끌 수 없다.
let aiRevealQueue=null;
function revealSheetPhases(doc,added){
  const ids=new Set(added.map(e=>e.id)),bySheet=new Map();
  for(const e of added)if(e.sheetId){if(!bySheet.has(e.sheetId))bySheet.set(e.sheetId,[]);bySheet.get(e.sheetId).push(e);}
  if(!bySheet.size)return null;
  const number=new Map((doc.sheets||[]).map(sh=>[sh.id,String(sh.number||'')]));
  const order=[...bySheet.keys()].sort((a,b)=>(number.get(a)||'').localeCompare(number.get(b)||'',undefined,{numeric:true}));
  const phases=order.map(id=>({sheetId:id,entities:bySheet.get(id)}));
  const loose=added.filter(e=>!e.sheetId);if(loose.length)phases.push({sheetId:null,entities:loose});
  return {phases,ids};
}
function startAIRevealPhase(){
  const q=aiRevealQueue;if(!q)return;
  while(q.index<q.phases.length){
    const {sheetId,entities}=q.phases[q.index],later=new Set(q.phases.slice(q.index).flatMap(p=>p.entities.map(e=>e.id)));
    // 이 장 도곽(sheetDecoration)은 바탕으로 먼저 보이고, 도곽 안 그림만 그려 나간다
    const frame=entities.filter(e=>e.sheetDecoration),body=entities.filter(e=>!e.sheetDecoration);
    for(const e of frame)later.delete(e.id);
    const base={...engine.doc,entities:engine.doc.entities.filter(e=>!later.has(e.id))};
    q.index++;
    // 도곽 크기 = 장 기록의 테두리(도곽은 블록이라 글자·선만 재면 표제란 쪽으로 치우쳤다)
    const box=(engine.doc.sheets||[]).find(sh=>sh.id===sheetId)?.bounds||G.bounds(entities.filter(e=>e.type!=='block'));
    if(body.length&&runAIReveal(base,`${q.beforeRevision}:${sheetId||'rest'}`,body,{sheetBox:box,hiddenIds:later}))return;
  }
  aiRevealQueue=null;render();
}
function startAIReveal(previousDoc,beforeRevision,added){
  aiRevealQueue=null;finishAIReveal();
  if(mode!=='SELECT'||phase!=='idle'||drag)return;
  if(!added.length||engine.doc.entities.length>200000||document.hidden)return;
  const sheets=revealSheetPhases(engine.doc,added);
  if(sheets){aiRevealQueue={phases:sheets.phases,beforeRevision,index:0};startAIRevealPhase();return;}
  if(!aiDrawRevealEnabled())return;
  runAIReveal(previousDoc,beforeRevision,added);
}
function runAIReveal(previousDoc,beforeRevision,added,{sheetBox=null,hiddenIds=null}={}){
  if(!added.length||added.length>4000)return false;
  const display=revealDisplayEntities(engine.doc,added);
  if(!display?.length)return false;
  const plan=planReveal(display,{totalEntities:engine.doc.entities.length});
  if(!plan.durationMs||plan.immediate)return false;
  aiRevealStage?.destroy();aiRevealStage=null;
  let stage,reveal;
  try{
    cancelPointerInteraction('ai-reveal');
    stage=mountWaitStage(canvas.closest('.viewport'),{kind:'drafting',onSkip:()=>{aiRevealQueue=null;finishAIReveal();},
      onDestroy:()=>{if(aiRevealStage===stage)aiRevealStage=null;}});
    aiRevealStage=stage;
    reveal={doc:engine.doc,previousDoc,beforeRevision,display,plan,stage,hiddenIds:hiddenIds||new Set(added.map(e=>e.id)),serial:++aiRevealSerial};
    aiReveal=reveal;sceneKey=null;clearOverlapSelection();
    const band=[stage.element,...stage.element.querySelectorAll('.barun-wait-stage__detail,.barun-wait-stage__note')];
    let layout;
    const measure=()=>{
      const bottom=Math.max(...band.map(element=>element.getBoundingClientRect().bottom));
      layout={fitHeight:fitHeight(),revealTop:bottom-canvas.getBoundingClientRect().top+16};
    };
    measure();
    const getView=()=>({scale,origin:{...origin},width,height,...layout,pixelRatio:canvas.width/width});
    reveal.getView=getView;
    const initial=getView(),box=aiRevealBounds(plan);
    const sufficientlyVisible=box&&box.minX*scale+origin.x>=width*.08&&box.maxX*scale+origin.x<=width*.92&&
      origin.y-box.maxY*scale>=initial.revealTop&&origin.y-box.minY*scale<=initial.fitHeight-height*.08&&
      (box.maxX-box.minX)*(box.maxY-box.minY)*scale**2>=width*initial.fitHeight*.15;
    reveal.finalView=sheetBox?aiRevealFitView(sheetBox,initial,true):plan.clusters?.length===1&&sufficientlyVisible?initial:aiRevealFitView(box,initial);
    // 한 벌의 장: 시점을 그 장 도곽에 꽉 채워 고정하고 그 안을 그린다(사용자 2026-10-25 "도곽을 전체화면으로 고정하고 그리는 거다")
    if(sheetBox&&reveal.finalView){scale=reveal.finalView.scale;origin={...reveal.finalView.origin};viewMoving=false;}
    if(typeof ResizeObserver!=='undefined'){
      reveal.layoutObserver=new ResizeObserver(measure);
      for(const element of [...band,canvas,document.querySelector('.command-panel')].filter(Boolean))reveal.layoutObserver.observe(element);
    }
    reveal.player=createRevealPlayer({plan:{...plan,durationMs:plan.durationMs-(typeof gpuView!=='undefined'&&gpuView.stats.active?200:0)},stage,createCanvas:()=>document.createElement('canvas'),getView,
      setView:view=>{scale=view.scale;origin=view.origin;viewMoving=!!view.moving;},
      draw:(target,e)=>drawEntity(target,e,screen,scale,e._displayColor||e.color||layerMap().get(e.layer)?.color,
        screenLineweightPx(e._displayLineweight??e.lineweight??0.25),false,false,null,gpuView.stats.active?GPU_HATCH_RASTER:null),
      render,onFinish:()=>{if(aiReveal?.serial===reveal.serial)completeAIReveal();}});
    reveal.player.stopCamera();   // Fit the AI result once, immediately at commit.
    render();
    return true;
  }catch(error){
    if(aiReveal===reveal)finishAIReveal();
    reveal?.layoutObserver?.disconnect();stage?.destroy();
    if(aiRevealStage===stage)aiRevealStage=null;
    throw error;
  }
}
function paintAIRevealFrame(){
  const reveal=aiReveal;
  if(reveal.handoff){paintAIRevealHandoff();return;}
  const palette=getCanvasPalette(),ratio=canvas.width/width;
  paintBasemap();placeInlineText?.();ctx.clearRect(0,0,width,height);
  const key=JSON.stringify(['ai-reveal',reveal.serial,width,height,canvas.width,canvas.height,scale,origin.x,origin.y,$('grid').checked,num('spacing',100),palette,gpuView.key]);
  const options={doc:reveal.previousDoc,revision:reveal.beforeRevision,edit:null,width,height,scale,origin,pixelRatio:ratio,
    hiddenTextId:inlineTextEntityId,completeDisplay:()=>null,moving:viewMoving||drag?.kind==='pan',sceneKey:documents?.activeId??null};
  const pending=()=>gpuView.buildPending||gpuViewPending({...gpuView.stats,displayedDoc:gpuView.displayedDoc},options);
  if(key===sceneKey&&gpuView.buildPending){gpuView.draw(ctx,options);if(!gpuView.buildPending)sceneKey=null;}
  if(key===sceneKey){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(sceneCanvas,0,0);ctx.restore();}
  else{
    if(hasImages())imageRenderer.draw(ctx,visible().filter(e=>!reveal.hiddenIds.has(e.sourceId??e.id)),screen,scale,{width,height,background:palette.background});
    if($('grid').checked){
      let step=Math.max(.001,Math.min(1e9,num('spacing',100)))*scale;while(step<14)step*=10;while(step>160)step/=10;
      ctx.fillStyle=palette.grid;
      for(let x=((origin.x%step)+step)%step;x<width;x+=step)for(let y=((origin.y%step)+step)%step;y<height;y+=step)ctx.fillRect(Math.round(x),Math.round(y),1,1);
    }
    if(ucsIconOn())drawUcsIcon(ctx,origin,width,fitHeight(),palette.muted);
    const gpuDrawn=gpuView.draw(ctx,options);
    if(!gpuDrawn)for(const e of viewportDrawingEntities()){
      if(reveal.hiddenIds.has(e.sourceId??e.id)||e.id===inlineTextEntityId)continue;
      drawEntity(ctx,e,screen,scale,e._displayColor||e.color||layerMap().get(e.layer)?.color,
        screenLineweightPx(e._displayLineweight??e.lineweight??.25));
    }
    if(!pending()){
      if(sceneCanvas.width!==canvas.width||sceneCanvas.height!==canvas.height){sceneCanvas.width=canvas.width;sceneCanvas.height=canvas.height;}
      else sceneCtx.clearRect(0,0,sceneCanvas.width,sceneCanvas.height);
      sceneCtx.drawImage(canvas,0,0);sceneKey=key;sceneHighlights=null;
    }
  }
  // Presentation ink is independent of the previous GPU scene becoming ready.
  reveal.player.paint(ctx);
}

let propertiesDock=null;   // 특성 팔레트(Ctrl+1). 열려 있을 때만 고른 객체가 바뀌면 잠깐 뒤 한 번 다시 계산한다.
// 도면 탭을 바꾼 첫 화면: 이전 도면 그림 대신 빈 화면과 "도면을 그리는 중"을 먼저 보여 주고, 무거운 그리기는 다음 차례에 한다.
let tabSwitchCover=false;
// 점을 묻는 중에 END·MID·INT 등을 치면 다음 한 점에만 그 객체 스냅을 쓴다(오토캐드 스냅 지정 입력).
let osnapOnce=null;
// 블록 제자리 편집(REFEDIT) 중이면 블록 밖 객체 id 묶음. 이 객체들은 고를 수 없고 화면에서 흐리게 보인다.
let blockEditOutside=null;
let viewMoving=false, viewMovingTimer=0;   // 줌이 연속되는 동안은 장면 캐시를 만들지 않는다.
// 상태 일관성: 두 복구 저장소(localStorage 문서 · IndexedDB 작업공간)에 편집 리비전을 남겨 어느 쪽이 최신인지 비교한다.
const stampRecovery=(key,revision)=>{try{localStorage.setItem(key,String(revision));}catch{}};
const readRecoveryStamp=key=>{try{return Number(localStorage.getItem(key))||0;}catch{return 0;}};
const startupRecoveryRevisions={local:readRecoveryStamp('barun-cad-recovery-rev'),workspace:readRecoveryStamp('barun-cad-workspace-rev')};
// 성능: 선택 집합을 매 프레임 직렬화하지 않도록, 바뀔 때마다 리비전 번호만 올린다.
class SelectionSet extends Set {
 constructor(values){super(typeof blockEditOutside!=='undefined'&&blockEditOutside&&values?[...values].filter(v=>!blockEditOutside.has(v)):values);selectionRevision++;}
 add(value){if(typeof blockEditOutside!=='undefined'&&blockEditOutside?.has(value))return this;if(this.has(value))return this;selectionRevision++;if(typeof assist!=='undefined')assist.steps.record('+',value);super.add(value);if(!SelectionSet.expanding&&typeof groupPickEnabled==='function'&&groupPickEnabled())this.groupPeers(value,id=>this.add(id));return this;}
 delete(value){if(!this.has(value))return false;selectionRevision++;if(typeof assist!=='undefined')assist.steps.record('-',value);super.delete(value);if(!SelectionSet.expanding&&typeof groupPickEnabled==='function'&&groupPickEnabled())this.groupPeers(value,id=>this.delete(id));return true;}
 // 306: 여러 개를 한 번에 — 리비전은 한 번만 올린다(ALL·창 선택 수만 개).
 // 621: 그룹 고르기가 켜져 있으면 넣은 객체의 그룹 이름마다 한 번씩만 같은 그룹 객체를 함께 넣는다(그룹 없는 도면은 비용 없음).
 addMany(ids){const outside=typeof blockEditOutside!=='undefined'?blockEditOutside:null,steps=typeof assist!=='undefined'?assist.steps:null;let added=0;const groupPick=!SelectionSet.expanding&&typeof groupPickEnabled==='function'&&groupPickEnabled(),map=groupPick&&typeof entityMap==='function'?entityMap():null,groups=map?new Set():null;
  const put=id=>{if(outside?.has(id)||this.has(id))return;super.add(id);steps?.record('+',id);added++;if(groups){const group=map.get(id)?.group;if(typeof group==='string'&&group.trim())groups.add(group);}};
  for(const id of ids)put(id);
  if(groups?.size){SelectionSet.expanding=true;try{for(const group of groups)for(const id of groupMemberIds(engine.doc.entities,group))put(id);}finally{SelectionSet.expanding=false;}}
  if(added)selectionRevision++;return added;}
 // 621 PICKSTYLE: 고른 객체에 그룹 이름이 있을 때만 같은 그룹 객체를 함께 넣고 뺀다(그룹 없는 객체는 비용 없음).
 groupPeers(value,apply){const entity=typeof entityMap==='function'?entityMap().get(value):null;if(!entity||typeof entity.group!=='string'||!entity.group.trim())return;SelectionSet.expanding=true;try{for(const id of groupMemberIds(engine.doc.entities,entity.group))if(id!==value)apply(id);}finally{SelectionSet.expanding=false;}}
 clear(){if(this.size)selectionRevision++;return super.clear();}
}
// 성능: 레이어 선형 탐색을 없애기 위한 id→레이어 Map. visible()과 같은 리비전으로 다시 만든다.
let layerMapRevision=-1,layerMapCache=new Map();
const layerMap=()=>{
  if(layerMapRevision!==sceneRevision){layerMapCache=new Map(engine.doc.layers.map(l=>[l.id,l]));layerMapRevision=sceneRevision;}
  return layerMapCache;
};
const sceneCanvas=document.createElement('canvas'),sceneCtx=sceneCanvas.getContext('2d');
const gpuView=createGpuController({onChange:()=>{if(!gpuView.buildPending)sceneKey=null;render();}});
const displayQuality=createDisplayQuality();displayQuality.attachInput(canvas);   // ACAD200 117: new input ends long build/refine slices early
let matrixPreviewState=null,matrixPreviewBounds=null;const matrixSnapshot=new MatrixSnapshot(),basemapMips=new CanvasMipCache({onReady:()=>{basemapKey='';render();}});   // ACAD200 122·123
function waitingForGpuView(){return gpuViewPending({...gpuView.stats,displayedDoc:gpuView.displayedDoc},{width,height,scale,origin,pixelRatio:canvas.width/width,doc:engine.doc,revision:sceneRevision});}
const settingsKey = "barun-cad-command-settings-v1";
const aiFollowViewKey = "barun-cad-ai-follow-view-v1";
let aiFollowView = (()=>{try{const value=localStorage.getItem(aiFollowViewKey);return value===null||value==='1';}catch{return true;}})();
let settingsError = "";
let s7Tools=null;   // ACAD200 영역 7 명령·설정(acad200-s7.js). cardContext 뒤에서 만든다(초기화 중 run() 이 불러도 TDZ 없게 여기서 선언).
let settings = {
  version: 1,
  aliases: defaultAliases(),
  hotkeys: defaultHotkeys(),
};
// 항목 하나가 새 명령 이름과 겹쳤다고 해서 애써 만든 단축키 전체를 잃으면 안 된다.
// 한 개씩 넣어 보며 받아들일 수 있는 것만 살리고, 버린 것은 이름을 알려 준다.
function repairSettings(raw) {
  try {
    return { settings: validateSettings(structuredClone(raw)), dropped: [] };
  } catch {}
  const draft = { version: 1, aliases: {}, hotkeys: {}, extraAliases: {} };
  const dropped = [];
  for (const kind of ["aliases", "hotkeys", "extraAliases"])
    for (const [name, value] of Object.entries(raw?.[kind] || {})) {
      const trial = structuredClone(draft);
      trial[kind][name] = value;
      try {
        validateSettings(structuredClone(trial));
        draft[kind][name] = value;
      } catch {
        dropped.push(`${name}=${value}`);
      }
    }
  return { settings: validateSettings(draft), dropped };
}
try {
  const stored = localStorage.getItem(settingsKey);
  if (stored) {
    const repaired = repairSettings(migrateAliasSettings(JSON.parse(stored)));
    settings = repaired.settings;
    // Older defaults assigned F to FIT and FIL to FILLET. Migrate only that
    // untouched pair so a user's deliberate custom aliases remain intact.
    if (settings.aliases.FIT === 'F' && settings.aliases.FILLET === 'FIL') {
      settings.aliases.FIT = 'ZE';
      settings.aliases.FILLET = 'F';
    }
    if (repaired.dropped.length)
      settingsError =
        "쓸 수 없게 된 단축키 " +
        repaired.dropped.length +
        "개만 뺐습니다(" +
        repaired.dropped.join(", ") +
        "). 나머지 설정은 그대로입니다.";
  }
} catch (error) {
  settingsError =
    "저장된 명령 설정을 읽지 못해 기본값을 사용합니다: " + userErrorMessage(error);
}
let width = 0,
  height = 0,
  scale = 0.1,
  origin = { x: 180, y: 330 },
  selected = new SelectionSet(),
  activeLayer = "default",
  currentProperties = emptyCurrentProperties(),   // 현재 색·선종류·선종류 축척·선굵기(CECOLOR·CELTYPE…). 비어 있으면 ByLayer.
  mode = "SELECT",
  phase = "idle",
  points = [],
  params = {},
  cursor = null,
  rawCursor = null,
  drag = null,
  space = false,
  tab = "file",
  dirty = false,
  fileName = window.cadDesktop?.initialDrawingName || "새 도면",
  filePath = "",      // 이 탭 도면의 실제 파일 경로(연 파일·저장한 파일). Ctrl+S 는 같은 형식이면 묻지 않고 여기에 덮어쓴다.
  nextOpenFilePath = "",
  lastCommand = null,
  api = null,
  busy = false,
  outputCloseHeld = false,
  toastTimer,
  formApply = null;
const inputHistory = [];
let historyIndex = 0,
  needsInitialFit = true, hiddenFitPending = false, hiddenFitTimer = 0;
let cadClipboard = null, previousSelection = [], zoomHistory = [], spaceDragged = false;
// 도면 칸마다 프로세스: 다른 칸에서 복사한 CAD 객체도 붙여넣을 수 있게 앱 본체가 건네준다.
globalThis.window?.cadDesktop?.onCadClipboard?.(data=>{cadClipboard=data;});
// Kept inline because the local CAD HTTP allow-list must remain compatible
// with already-running desktop engines.  The testable counterparts live in
// input-manager.js.
class InteractionEpoch {
 constructor(){this.value=0;this.reason='startup';}
 next(reason='command-transition'){this.reason=reason;return ++this.value;}
 tag(value={}){return {...value,interactionEpoch:this.value};}
 accepts(value){return !!value&&value.interactionEpoch===this.value;}
}
class InputDiagnostics {
 constructor({enabled=false,limit=1000,clock=()=>performance.now()}={}){this.enabled=enabled;this.limit=limit;this.clock=clock;this.origin=clock();this.entries=[];}
 setEnabled(value){this.enabled=!!value;return this.enabled;}
 clear(){this.entries.length=0;this.origin=this.clock();}
 record(event,data={}){if(!this.enabled)return null;const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?{x:p.x,y:p.y}:null,entry={timestampMs:Number((this.clock()-this.origin).toFixed(3)),event,eventTimestamp:Number.isFinite(data.eventTimestamp)?data.eventTimestamp:null,command:data.command||'SELECT',previousState:data.previousState||'',nextState:data.nextState||data.previousState||'',screen:point(data.screen),world:point(data.world),accepted:data.accepted!==false,reason:data.reason||'',processingMs:Number((data.processingMs||0).toFixed(3))};this.entries.push(entry);if(this.entries.length>this.limit)this.entries.splice(0,this.entries.length-this.limit);return entry;}
 recent(count=200){return this.entries.slice(-Math.max(0,count)).map(entry=>structuredClone(entry));}
}
const interaction=new InteractionEpoch();
let lastCanvasPointerId=null,lastSelectDown=null,selectDoubleClickEpoch=-1;
const inputDebugEnabled=(()=>{try{return new URLSearchParams(location.search).get('input-debug')==='1'||localStorage.getItem('barun-input-debug')==='1';}catch{return false;}})();
const inputDiagnostics=new InputDiagnostics({enabled:inputDebugEnabled});
const inputState=()=>`${mode}.${phase}${typeof drag!=='undefined'&&drag?.kind?'+'+drag.kind+(drag.awaitingCorner?'(corner)':''):''}`;
function traceInput(event,data={}){return inputDiagnostics.record(event,{command:mode,previousState:inputState(),nextState:inputState(),...data});}
function releaseLastPointerCapture(){
  if(lastCanvasPointerId!==null&&canvas.hasPointerCapture?.(lastCanvasPointerId)){
    try{canvas.releasePointerCapture(lastCanvasPointerId);}catch{}
  }
}
function cancelPointerInteraction(reason='command-transition'){
  if(drag?.previewFrame)cancelAnimationFrame(drag.previewFrame);
  releaseLastPointerCapture();drag=null;interaction.next(reason);
}
function rememberView(){zoomHistory.push({scale,origin:{...origin}});if(zoomHistory.length>30)zoomHistory.shift();}
// 화면 맞춤에 쓸 높이: 아래 명령창이 캔버스 위에 떠 있으면 그 윗변까지만 쓴다(도면 아래가 명령창에 가리지 않게).
function fitHeight(){
 try{const c=canvas.getBoundingClientRect(),p=document.querySelector('.command-panel')?.getBoundingClientRect();
  if(p&&p.height>0&&p.top>c.top&&p.top<c.bottom&&p.left<c.right&&p.right>c.left)return Math.max(height*.4,p.top-c.top);}catch{}
 return height;
}
// 오른쪽 칸(계획·실시 등, .right-workspace)은 도면 위에 떠 있다. 맞춤은 그 칸 왼쪽까지만 쓴다 — 예전엔 표·대지가 칸 밑에 숨었다(2026-10-28).
function fitWidth(){
 try{const c=canvas.getBoundingClientRect(),p=document.querySelector('.right-workspace')?.getBoundingClientRect();
  if(p&&p.width>0&&p.left>c.left&&p.left<c.right&&p.top<c.bottom&&p.bottom>c.top)return Math.max(width*.4,p.left-c.left);}catch{}
 return width;
}
function fitBox(b){rememberView();const h=fitHeight(),w=fitWidth();scale=Math.max(1e-8,Math.min(500,Math.min(Math.max(20,w-60)/Math.max(1,b.maxX-b.minX),Math.max(20,h-60)/Math.max(1,b.maxY-b.minY))));origin={x:w/2-(b.minX+b.maxX)/2*scale,y:h/2+(b.minY+b.maxY)/2*scale};render();}
// 검토 A3: 화면 따라가기가 꺼져 있으면 아무것도 잡지 않는다. 켜져 있어도 카메라는 어디가 바뀌었는지만 알면 되므로 객체 전체가 아니라 범위만 비교한다(큰 도면에서 AI 명령마다 도면 전체를 두 번 직렬화하던 것).
function captureAIChange(){if(!aiFollowView)return null;return engine.doc.entities.map(entity=>{const bounds=G.bounds([entity]);return {entity:{id:entity.id},bounds,signature:bounds?bounds.minX+','+bounds.minY+','+bounds.maxX+','+bounds.maxY:''};});}
function followAIChange(change={}){
 if(!aiFollowView||mode!=='SELECT'||phase!=='idle'||drag||(!change.aiCommit&&busy))return;
 const before=new Map((change.before||[]).map(item=>[item.entity.id,item]));
 const after=new Map((change.after||captureAIChange()).map(item=>[item.entity.id,item]));
 const changedBefore=[],changedAfter=[];
 for(const [id,item] of before)if(!after.has(id)||after.get(id).signature!==item.signature)changedBefore.push(item.bounds);
 for(const [id,item] of after)if(!before.has(id)||before.get(id).signature!==item.signature)changedAfter.push(item.bounds);
 if(!changedBefore.length&&!changedAfter.length)return;
 const boxes=(changedAfter.length?changedAfter:changedBefore).filter(Boolean);
 // 검토 A4: Math.min(...배열) 은 객체가 아주 많으면 인자 한도를 넘어 예외 — 도면은 이미 바뀌었는데 AI 에 실패로 전달됐다.
 const box=boxes.length?boxes.reduce((a,b)=>({minX:Math.min(a.minX,b.minX),minY:Math.min(a.minY,b.minY),maxX:Math.max(a.maxX,b.maxX),maxY:Math.max(a.maxY,b.maxY)})):null;
 if(!box)return;
 const dx=Math.max(1,box.maxX-box.minX)*.1,dy=Math.max(1,box.maxY-box.minY)*.1;
 aiReveal?.player?.stopCamera();
 fitBox({minX:box.minX-dx,maxX:box.maxX+dx,minY:box.minY-dy,maxY:box.maxY+dy});
 if(aiReveal?.finalView)aiReveal.finalView={scale,origin:{...origin}};
}
function copySelection(base){
  if(!selected.size)throw Error('복사할 객체를 선택하세요.');
  // A DWG INSERT can be a compact reference into doc.sharedBlocks.  Keeping
  // only that reference makes Ctrl+V fail in another drawing (and after New),
  // because the target document does not own the source definition table.
  // Store portable, fully resolved geometry in the CAD clipboard instead.
  const portable=entity=>{
    const copy=entity.sharedBlock
      ? G.materializeSharedDrawingReference(engine.doc,entity)
      : structuredClone(entity);
    if(copy.entities)copy.entities=copy.entities.map(portable);
    return copy;
  };
  const entities=chosen().map(portable),b=G.bounds(entities);
  // ACAD200-422: 쓰는 레이어만 담고(예전에는 레이어 표 전체), 운영체제 클립보드에도 바른 CAD 형식·글·그림으로 쓴다(다른 창·문서에 붙이기).
  cadClipboard={entities,layers:S4.usedLayers(entities,engine.doc.layers),base:base||{x:b.minX,y:b.minY}};
  globalThis.window?.cadDesktop?.shareCadClipboard?.(cadClipboard);
  {const payload=cadClipboard;S4.selectionPng(entities).then(png=>S4.writeSystemClipboard(payload,{png})).catch(()=>{});}
  toast(`${entities.length}개 CAD 클립보드에 복사`);
}
/* 표시 자리수(AutoCAD LUPREC): 거리·좌표·속성 표시. 기본 2자리, 이 PC 에 기억한다. 도면 값 자체는 바꾸지 않는다. */
// 저장값이 없으면 2자리(Number(null) 은 0 이라 예전엔 LUPREC 를 한 번도 안 쓴 사용자에게 12.34㎡ 가 12㎡ 로 보였다).
let displayPrecision=(()=>{try{const raw=localStorage.getItem('barun-luprec');if(raw==null||String(raw).trim()==='')return 2;const v=Number(raw);return Number.isInteger(v)&&v>=0&&v<=8?v:2;}catch{return 2;}})();
function setDisplayPrecision(value){const v=Number(value);if(!Number.isInteger(v)||v<0||v>8)throw Error('표시 자리수는 0~8 사이의 정수입니다.');displayPrecision=v;try{localStorage.setItem('barun-luprec',String(v));}catch{}return v;}
const fmt = (n) => Number(n.toFixed(displayPrecision)).toLocaleString("ko-KR",{maximumFractionDigits:displayPrecision}),
  coordText = (n) => String(Number(Number(n).toFixed(displayPrecision))),   // 좌표·변위 표시: 천 단위 쉼표가 X,Y 구분 쉼표와 헷갈리지 않게
  screen = (p) => ({ x: origin.x + p.x * scale, y: origin.y - p.y * scale }),
  world = (p) => ({ x: (p.x - origin.x) / scale, y: (origin.y - p.y) / scale });
const styledDimension=entity=>applyDimStyle(entity,getDimStyle(engine.doc));
const commandVisualCategory={file:'출력 및 저장',work:'도형 및 선',arch:'그리기',convert:'멀티도구',settings:'기타',ai:'기타'};
/* 기본 작도·편집 명령은 분류별 공통 그림 대신 명령 모양을 그린다(원·간격띄우기·사각형이 모두 "선" 아이콘으로 보이던 문제). */
const BASIC_COMMAND_ICONS={
 CALC:'<rect x="5.5" y="3.5" width="13" height="17" rx="1.6"/><rect x="8" y="6" width="8" height="3.2" rx=".6"/><g fill="currentColor" stroke="none"><circle cx="8.6" cy="12.4" r="1"/><circle cx="12" cy="12.4" r="1"/><circle cx="15.4" cy="12.4" r="1"/><circle cx="8.6" cy="16.4" r="1"/><circle cx="12" cy="16.4" r="1"/><circle cx="15.4" cy="16.4" r="1"/></g>',
 LINE:'<path d="M5 19 19 5" stroke-linecap="round"/><circle cx="5" cy="19" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="5" r="1.6" fill="currentColor" stroke="none"/>',
 PLINE:'<path d="M4 18 9 7l4 8 7-10" stroke-linejoin="round" stroke-linecap="round"/>',
 RECTANGLE:'<rect x="4.5" y="6.5" width="15" height="11" rx="1"/>',
 CIRCLE:'<circle cx="12" cy="12" r="7.5"/><path d="M12 12h7.5" stroke-dasharray="1.5 1.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
 ARC:'<path d="M5 17a8 8 0 0 1 14 0" stroke-linecap="round"/>',
 HATCH:'<rect x="4.5" y="4.5" width="15" height="15" rx="1"/><path d="M4.5 12.5 12.5 4.5M4.5 19.5 19.5 4.5M11.5 19.5l8-8" stroke-width="1.1"/>',
 OFFSET:'<path d="M5 16.5h14" stroke-linecap="round"/><path d="M5 9.5h14" stroke-linecap="round" stroke-dasharray="2.5 2"/><path d="M12 15v-4m0 0-1.6 1.6M12 11l1.6 1.6" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.2"/>',
 TRIM:'<path d="M4 8h16M4 16h16" stroke-linecap="round"/><path d="M12 4v16" stroke-dasharray="2 2"/><path d="M14.5 10.5 9.5 13.5M9.5 10.5l5 3" stroke-width="1.2" stroke-linecap="round"/>',
 COPY:'<rect x="4" y="4" width="10" height="10" rx="1"/><rect x="10" y="10" width="10" height="10" rx="1" fill="rgba(255,255,255,.08)"/>',
 MOVE:'<path d="M12 4v16M4 12h16" stroke-linecap="round"/><path d="m9.5 6.5 2.5-2.5 2.5 2.5M9.5 17.5 12 20l2.5-2.5M6.5 9.5 4 12l2.5 2.5M17.5 9.5 20 12l-2.5 2.5" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.2"/>',
 ROTATE:'<path d="M17.5 10A6.5 6.5 0 1 0 18.5 14" stroke-linecap="round"/><path d="M18 6v4.5h-4.5" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.2"/>',
 DIMLINEAR:'<path d="M4 15h16" stroke-linecap="round"/><path d="M4 10v10M20 10v10" stroke-width="1.1"/><path d="m7 15-2.5-1.5v3zM17 15l2.5-1.5v3z" fill="currentColor" stroke="none"/><path d="M9.5 8h5" stroke-linecap="round" stroke-width="1.1"/>',
 TEXT:'<path d="M5 6h14M12 6v13M9 19h6" stroke-linecap="round"/>',
 BLOCK:'<path d="M12 3.5 20 7.5v9l-8 4-8-4v-9z" stroke-linejoin="round"/><path d="M12 11.5 20 7.5M12 11.5v9M12 11.5 4 7.5" stroke-width="1.1"/>',
 LAYER:'<path d="m12 4 8 4.5-8 4.5-8-4.5z" stroke-linejoin="round"/><path d="m4 13 8 4.5 8-4.5M4 17l8 4.5 8-4.5" stroke-width="1.1" stroke-linejoin="round"/>',
 SELECT:'<path d="M6 4.5 18 12l-5 1.5-2.5 5z" stroke-linejoin="round"/>',
};
function currentCommandIconSvg(name,command){
 if(BASIC_COMMAND_ICONS[name])return `<svg class="architecture-command-icon reference-command-icon basic-command-icon compact" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${BASIC_COMMAND_ICONS[name]}</svg>`;
 const home=Object.entries(MENU_CATALOG).find(([,menu])=>menu.sections.some(section=>section.commands.includes(name)))?.[0]||'work';
 const alias=settings?.aliases?.[name]||name;
 return architectureCommandIconSvg({id:`BARUN-${name}`,alias,label:command?.label||name,category:commandVisualCategory[home]||'기타'},{compact:true});
}
let visibleRevision=-1,visibleDoc=null,visibleScaleBucket=null,visibleViewportKey='',visibleCache=[],visibleGeneration=0,renderSpatialRevision=-1,renderSpatial=null,entityLookupRevision=-1,entityLookup=null;
const visible = () => {
    const heavy=engine.doc.entities.length>50000;
    const padding=heavy?80:0,a=world({x:-padding,y:height+padding}),b=world({x:width+padding,y:-padding});
    const viewBox=heavy?{minX:a.x,minY:a.y,maxX:b.x,maxY:b.y}:null;
    const {scaleKey:scaleBucket,viewportKey}=visibilityCacheKeys({heavy,scale,viewMoving,a,b,width,height,lodBand:viewMoving&&typeof displayQuality!=='undefined'?displayQuality.lodBand:0});
    if(visibleRevision!==sceneRevision||visibleScaleBucket!==scaleBucket||visibleViewportKey!==viewportKey){
      const viewChanged=visibleScaleBucket!==scaleBucket||visibleViewportKey!==viewportKey;
      let entities=engine.doc.entities;
      if(heavy){if(renderSpatialRevision!==sceneRevision){renderSpatial=G.spatialIndex(entities);renderSpatialRevision=sceneRevision;}entities=renderSpatial.query(viewBox);}
      const priorGeneration=visibleGeneration;
      visibleCache=G.visibleEntities(engine.doc,{inPlace:true,lodScale:heavy?scale:0,lodPixels:heavy?(typeof displayQuality!=='undefined'?displayQuality.blockPixels(viewMoving):viewMoving?96:36):0,viewBox,entities});visibleDoc=engine.doc;visibleRevision=sceneRevision;visibleScaleBucket=scaleBucket;visibleViewportKey=viewportKey;visibleGeneration++;
      // execute() may already have incrementally inserted appended primitives
      // into the pick index.  Preserve that ready index across this cache
      // generation change instead of rebuilding it in the next click.
      if(!viewChanged&&nearby.objectsRevision===sceneRevision&&nearby.objectsGeneration===priorGeneration)nearby.objectsGeneration=visibleGeneration;
    }return visibleCache;
  },
  editable = () =>
    visible().filter(
      (e) => !layerMap().get(e.layer)?.locked,   // 성능: 레이어 선형 탐색 대신 Map 조회
    ),
  // Ctrl+A·선택 ALL: 큰 도면(5만 개 초과)의 visible() 은 화면 안만 돌려줘 전체 선택이 일부만 됐다
  // (10/30 주동딱지 196,820 중 33,046). 화면·축소와 상관없이 도면 전체에서 레이어 규칙만으로 고른다.
  allSelectableIds = () => {
    const layers = layerMap(), ids = [];
    for (const e of engine.doc.entities) {
      const layer = layers.get(e.layer);
      if (!e.hidden && layer?.visible && !layer.frozen && !layer.locked) ids.push(e.id);
    }
    return ids;
  },
  entityMap=()=>{
    // Committed arrays share entity-index.js's map, which follows each edit with a
    // pointer diff (and is warmed when a drawing opens): rebuilding a map of a
    // 1.9M-object drawing after every edit held the first selection for 0.3-0.5 s.
    const index=typeof entityIndex==='function'?entityIndex(engine.doc.entities):null;
    if(index)return index.map;
    if(entityLookupRevision!==sceneRevision){entityLookup=new Map(engine.doc.entities.map(entity=>[entity.id,entity]));entityLookupRevision=sceneRevision;}
    return entityLookup;
  },
  fresh_chosen = () => selected.size?[...selected].map(id=>entityMap().get(id)).filter(Boolean):[],
  // 306: 같은 선택·같은 도면이면 지난 배열을 그대로(그립 그리기가 매 프레임 부른다). 받은 배열은 고치지 말 것.
  chosen = () => {
    const c=chosen.cache||(chosen.cache={revision:-1,scene:-1,entities:null,list:[]});
    if(c.revision!==selectionRevision||c.scene!==sceneRevision||c.entities!==engine.doc.entities){c.list=fresh_chosen();c.revision=selectionRevision;c.scene=sceneRevision;c.entities=engine.doc.entities;}
    return c.list;
  };
const num = (id, fallback) => {
  const n = Number($(id).value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
function log(message, error = false) {
  message=error?userErrorMessage(message):String(message);
  const history = $("history"), className = error ? "err" : "result";
  const last = history.lastElementChild;
  // 같은 동작을 다시 눌러도 동일한 오류를 명령창에 계속 쌓지 않는다.
  if (last?.textContent === String(message) && last.className === className) {
    history.scrollTop = history.scrollHeight;
    return;
  }
  const row = document.createElement("div");
  row.textContent = message;
  row.className = className;
  history.append(row);
  while (history.children.length > 100) history.firstChild.remove();
  history.scrollTop = history.scrollHeight;
}
function toast(message, error = false) {
  const shown=error?userErrorMessage(message):String(message);
  if(error&&shown!==String(message))console.error('[바른 CAD 내부 오류]',technicalErrorMessage(message));
  log(shown, error);
  $("toast").textContent = shown;
  $("toast").style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").style.display = "none"), 3800);
}
window.addEventListener('unhandledrejection',event=>{
  console.error('[바른 CAD 처리되지 않은 오류]',technicalErrorMessage(event.reason));
  toast(event.reason,true);event.preventDefault();
});
window.addEventListener('error',event=>{
  if(!event.error)return;
  console.error('[바른 CAD 화면 오류]',technicalErrorMessage(event.error));
  toast(event.error,true);
});
let drawingLoadStarted=0,drawingLoadTimer=null,drawingOpenWait=null;
const drawingPerformanceLog=[];
function rememberDrawingPerformance(name,report){
 const entry={recordedAt:new Date().toISOString(),name,sourceFormat:report.sourceFormat,cacheHit:!!report.cacheHit,engine:report.converterDetails||null,timings_ms:{...(report.timings_ms||{}),...(report.clientTimings_ms||{})}};
 drawingPerformanceLog.push(entry);while(drawingPerformanceLog.length>20)drawingPerformanceLog.shift();
 try{localStorage.setItem('barun-drawing-performance-v1',JSON.stringify(drawingPerformanceLog));}catch{}
 console.info('[Barun CAD drawing performance]',entry);
}
function updateDrawingLoad(stage,percent=null,detail='',phase=null){
 const overlay=$('drawing-load-overlay');if(!overlay)return;
 overlay.hidden=false;if(drawingOpenWait){drawingOpenWait.update(stage,percent,detail,phase);return;}$('drawing-load-stage').textContent=stage;$('drawing-load-detail').textContent=detail;
 const progress=$('drawing-load-progress');if(Number.isFinite(percent)){progress.value=Math.max(0,Math.min(100,percent));}else progress.removeAttribute('value');
}
function drawingOpenErrorMessage(error){
 const raw=String(error?.message||error||'').replace(/\s+/g,' ').trim();
 if(/Int16|too large or too small|acadsharp/i.test(raw))return 'DWG 기본 엔진이 읽지 못한 값이 있습니다. 보조 엔진으로 다시 열어 주세요.';
 if(raw.startsWith('{')||raw.includes('{"failed"'))return '도면 변환을 완료하지 못했습니다. 원본 CAD에서 다른 이름으로 저장한 사본을 확인해 주세요.';
 return userErrorMessage(raw,'도면을 열지 못했습니다. 파일 형식과 도면 상태를 확인하세요.');
}
function beginDrawingLoad(name){if(drawingOpenWait)return;drawingOpenWait=mountDrawingOpenWait($('drawing-load-overlay'));drawingLoadStarted=Date.now();$('drawing-load-elapsed').textContent='0초';$('drawing-load-title').textContent='도면 여는 중 · '+name;updateDrawingLoad('파일을 확인하고 있습니다.',null,'','check');clearInterval(drawingLoadTimer);drawingLoadTimer=setInterval(()=>{if(document.hidden)return;$('drawing-load-elapsed').textContent=Math.max(0,Math.round((Date.now()-drawingLoadStarted)/1000))+'초';},500);}
function endDrawingLoad(){drawingOpenWait?.finish();drawingOpenWait?.destroy();drawingOpenWait=null;clearInterval(drawingLoadTimer);drawingLoadTimer=null;const overlay=$('drawing-load-overlay');if(overlay)overlay.hidden=true;}
window.cadDesktop?.onImportProgress?.(status=>{if(!status||!drawingOpenWait)return;const total=Number(status.total)||0,received=Number(status.received)||0,percent=total?received/total*100:null;updateDrawingLoad(status.stage||'변환 결과를 받는 중입니다.',percent,total?`${(received/1048576).toFixed(1)} / ${(total/1048576).toFixed(1)} MB`:'',received>0?'read':'convert');});
/* 새로 만드는 객체에 현재 특성(CECOLOR·CELTYPE·CELTSCALE·CELWEIGHT)을 채운다. 객체가 스스로 정한 값은 덮지 않는다. */
function withCurrentProperties(c){
  // 패드에서 온 객체(복사본·선·표시)는 패드가 정한 특성 그대로 넣는다.
  if(!c||c.keepProperties||isDefaultCurrent(currentProperties))return c;
  // 현재 선종류(CELTYPE)로 붙인 CENTER 는 "중심선 레이어로 자동 분류" 근거가 아니다(AutoCAD 는 레이어를 바꾸지 않는다) — 엔진에 알린다.
  const fromCurrent=currentProperties.linetype?{currentLinetype:currentProperties.linetype}:{};
  if(c.type==='add'&&c.entity)return {...c,...fromCurrent,entity:applyCurrentProperties([c.entity],currentProperties)[0]};
  if(c.type==='addMany'&&Array.isArray(c.entities))return {...c,...fromCurrent,entities:applyCurrentProperties(c.entities,currentProperties)};
  // 자동 분류(문자·치수 → 주석 레이어)는 레이어 색이 보이게 객체 색을 지운다. 현재 색(CECOLOR)으로 넣은 색만은 남긴다.
  if(c.type==='add.classified'&&Array.isArray(c.entities)){const keep=currentProperties.color&&currentProperties.color.mode!=='bylayer'?colorChanges(currentProperties.color):null;return {...c,entities:applyCurrentProperties(c.entities,currentProperties),...(keep?{keepColor:keep}:{})};}
  // 보조명령 카드는 삭제+추가를 batch 로 넣는다(ctx.commit) — 안쪽 추가 명령에도 현재 특성을 채운다.
  if(c.type==='batch'&&Array.isArray(c.commands))return {...c,commands:c.commands.map(withCurrentProperties)};
  return c;
}
function incrementalAppendCommand(c){
  const entities=c?.type==='add'?[c.entity]:['addMany','add.classified'].includes(c?.type)?c.entities:null;
  const linked=e=>e&&(e.type==='wall'||e.type==='block'||Array.isArray(e.entities)||e.hostWall||e.roomBoundary||e.scheduleKind);
  return !!entities&&!c.centerlineId&&!entities.some(linked);
}
/* 되돌리기·다시 실행은 이력의 문서를 통째로 바꿔 끼우지만, 가벼운 편집의 이력끼리는 객체를 그대로 나눠 쓴다.
   달라진 객체만 골라 화면·선택 색인을 고치면 19만 객체 도면에서 Ctrl+Z 뒤 첫 클릭이 1초 가까이 멈추지 않는다.
   전체 복사 편집을 되돌리면 모든 객체가 달라지므로 그때는 예전처럼 다시 만든다. */
const HISTORY_DELTA_LIMIT=20000;
function historyDelta(before,after){
  // Neighbouring history snapshots usually differ by a few objects in order:
  // a pointer diff finds them without hashing every object twice.
  const quick=typeof pointerDelta==='function'?pointerDelta(before,after,HISTORY_DELTA_LIMIT):null;
  if(quick)return quick;
  const beforeSet=new Set(before),added=[];
  for(const entity of after)if(!beforeSet.has(entity)&&added.push(entity)>HISTORY_DELTA_LIMIT)return null;
  const afterSet=new Set(after),removed=[];
  for(const entity of before)if(!afterSet.has(entity)&&removed.push(entity)>HISTORY_DELTA_LIMIT)return null;
  return {removed,added};
}
/* 211: 되돌리기·다시 실행은 그 단계를 실행할 때 남긴 차이(engine.lastExecution.delta)를 그대로 쓴다 — 두 배열을 다시 비교하지 않는다.
   셈이 맞지 않거나(남긴 차이가 틀렸을 가능성) 기록이 없으면 예전 비교로. 큰 스타일 편집(rebuild)도 7.0.11 처럼 포인터 비교로 바뀐 것만 고친다
   (전체 다시 그리기는 되돌리기 멈춤을 0.05초 → 1.2초로 늘렸다, 2026-10-16 A/B). */
function recordedHistoryDelta(execution,before,after){
  const d=execution?.delta;
  if(d&&d.removed.length+d.added.length<=HISTORY_DELTA_LIMIT&&after.length===before.length-d.removed.length+d.added.length)return d;
  return historyDelta(before,after);
}
function withLayerDelta(delta,before,after){
  const changed=G.changedDisplayLayers(before.layers,after.layers);
  if(!changed.size)return delta;
  const affected=G.entitiesUsingLayers(after,changed,new Set(delta.added));
  if(!affected.length)return delta;
  if(delta.removed.length+delta.added.length+2*affected.length>HISTORY_DELTA_LIMIT)return null;
  return {removed:[...delta.removed,...affected],added:[...delta.added,...affected]};
}
function mergePendingGpuEdit(pending,current){
  if(!pending?.lightweight)return current;
  const removed=new Set(pending.removed),added=new Set(pending.added),again=new Set(current.added);
  // An object removed and added by the same edit is displayed again (a layer
  // it reads changed): relative to the base it is new or displayed again.
  for(const e of current.removed)if(again.has(e)){if(!added.has(e)){removed.add(e);added.add(e);}}else if(!added.delete(e))removed.add(e);
  const redisplayed=new Set(current.removed);
  for(const e of current.added)if(!redisplayed.has(e)&&!removed.delete(e))added.add(e);
  return {...current,previousDoc:pending.previousDoc,previousRevision:pending.previousRevision,removed:[...removed],added:[...added]};
}
/* 223: 편집이 쌓여 공간 색인의 차이 부분(지운 표시·덧붙인 작은 트리)이 바탕의 25%를 넘으면, 입력이 없는 틈에 바탕을 한 번 다시 짓는다.
   AutoCAD 의 rebuildModified 처럼 평소에는 바뀐 것만 고치고, 전체 재작성은 드물게·쉴 때만 한다(입력 중에는 절대 하지 않는다). */
let spatialCompactionPending=false;
function scheduleSpatialCompaction(){
  if(spatialCompactionPending||typeof requestIdleCallback!=='function')return;
  spatialCompactionPending=true;const index=renderSpatial;
  const attempt=()=>requestIdleCallback(deadline=>{
    if(renderSpatial!==index||renderSpatialRevision!==sceneRevision||!index?.needsCompaction?.()){spatialCompactionPending=false;return;}
    if(busy||(typeof recoveryInputActive==='function'&&recoveryInputActive())||deadline.timeRemaining()<40){attempt();return;}
    renderSpatial=G.spatialIndex(engine.doc.entities);spatialCompactionPending=false;
  },{timeout:30000});
  attempt();
}
function execute(c) {
  const outer=!execute.depth;execute.depth=(execute.depth||0)+1;
  try{
  if(outer&&typeof draftingWaitSerial!=='undefined'){draftingWaitSerial++;if(draftingWaitModule)draftingWaitModule.then(frame=>frame.closeDraftingWait()).catch(()=>{});}
  if(outer&&typeof aiReveal!=='undefined'&&aiReveal)finishAIReveal();
  c=withCurrentProperties(c);
  if(typeof withJustifiedAnchors==='function')c=withJustifiedAnchors(c,ids=>entitiesById(engine.doc.entities,ids));   // 504 맞춤 문자: 높이·내용을 바꿔도 맞춤점 고정(바뀐 문자만)
  const previousDoc=engine.doc,beforeRevision=sceneRevision,appendOnly=incrementalAppendCommand(c),pendingGpuEdit=gpuEdit;
  // 레이어·색만 바꾸는 편집도 바뀐 객체만 갈아 끼운다(예전에는 도면 전체가 사라졌다 다시 그려졌다).
  const styleIds=appendOnly||typeof styleEditIds!=='function'?null:styleEditIds(c);
  const updateIds=c?.type==='update'?c.ids:c?.type==='updateMany'&&Array.isArray(c.updates)?c.updates.map(update=>update?.id):null;
  const removableIds=appendOnly?[]:styleIds||(c?.type==='delete'||['move','rotate','scale','trim','extend','fillet','chamfer','transform'].includes(c?.type)||c?.type==='mirror'&&c.eraseSource
    ?(c.ids||[c.id]).filter(Boolean):updateIds?updateIds.filter(Boolean):[]);
  // MIRROR first turns selected shared references into editable blocks (new
  // objects with the same ids): it takes the exact pointer diff below instead.
  const cacheDelta=appendOnly||!!styleIds||!!updateIds||['copy','offset','move','rotate','scale','trim','extend','fillet','chamfer','delete','transform','transform.copy'].includes(c?.type);
  const removeSet=new Set(removableIds),removedBefore=cacheDelta&&removeSet.size?(typeof entitiesById==='function'?entitiesById(engine.doc.entities,removeSet):engine.doc.entities.filter(entity=>removeSet.has(entity.id))):[];
  const history=c?.type==='undo'||c?.type==='redo',entitiesBefore=engine.doc.entities,layersBefore=engine.doc.layers;
  const ids = engine.execute(c);
  // Full synchronization may replace walls, openings, joins, room tags or
  // schedules which are absent from `ids`. Promote cache revisions only when
  // the engine itself proves this was a safe scoped copy-on-write update,
  // or when undo/redo swapped in a snapshot that differs by few objects.
  let delta=null;
  if(engine.lastExecution?.layerOnly)delta={removed:[],added:[]};
  else if(cacheDelta&&engine.lastExecution?.lightweight){
    const idSet=new Set([...(ids||[]),...(engine.lastExecution?.linked||[])]);delta={removed:removedBefore,added:typeof entitiesById==='function'?entitiesById(engine.doc.entities,idSet):engine.doc.entities.filter(entity=>idSet.has(entity.id))};
    // 연관 해치·중심선·구속이 같은 명령에서 다시 계산한 객체(engine.lastExecution.linked): 옛 모양도 화면에서 뺀다.
    const linked=engine.lastExecution?.linked;if(linked?.length){const old=new Set(linked.filter(id=>!removeSet.has(id)));if(old.size)delta.removed=[...removedBefore,...(typeof entitiesById==='function'?entitiesById(entitiesBefore,old):entitiesBefore.filter(entity=>old.has(entity.id)))];}
  }else if(engine.lastExecution?.lightweight)delta=historyDelta(entitiesBefore,engine.doc.entities);   // INSERT, EXPLODE, BLOCK, ARRAY, STRETCH: an exact pointer diff
  else if(history&&engine.lastExecution?.history&&typeof recordedHistoryDelta==='function'&&(engine.doc.entities!==entitiesBefore||engine.doc.layers!==layersBefore))delta=engine.doc.entities===entitiesBefore?{removed:[],added:[]}:recordedHistoryDelta(engine.lastExecution,entitiesBefore,engine.doc.entities);
  else if((history||c?.type==='lisp.apply')&&(engine.doc.entities!==entitiesBefore||engine.doc.layers!==layersBefore))delta=engine.doc.entities===entitiesBefore?{removed:[],added:[]}:historyDelta(entitiesBefore,engine.doc.entities);
  // 209: 가벼운 편집의 정확한 객체 차이를 되돌리기 단계에 남긴다(레이어 표 차이를 더하기 전, 순수한 객체 차이).
  if(delta&&!history&&engine.lastExecution?.lightweight&&typeof engine.noteStepDelta==='function')engine.noteStepDelta(previousDoc,engine.doc,delta);
  // A changed layer table: the kept objects whose display reads a changed
  // layer are displayed again (removed and added as the same object), the
  // rest keep their display. Layer on/off no longer rebuilds the drawing.
  if(delta&&engine.doc.layers!==layersBefore)delta=withLayerDelta(delta,previousDoc,engine.doc);
  // ACAD200 120: the same objects only reordered (DRAWORDER front/back or its undo):
  // display caches rebuild their order; the GPU only changes those objects' depths.
  if(delta&&!engine.lastExecution?.layerOnly&&(c?.type==='draworder'||history)&&typeof drawOrderGpuEdit==='function'){const order=drawOrderGpuEdit({before:entitiesBefore,after:engine.doc.entities,delta,pending:pendingGpuEdit,previousDoc,previousRevision:beforeRevision});if(order){delta=null;gpuEdit=order.gpuEdit;}}
  // ACAD200 119: only the drawing LTSCALE changed: canvas caches rebuild (their dash scale), the GPU rescales dash uniforms.
  if(typeof linetypeScaleGpuEdit==='function'){const lt=linetypeScaleGpuEdit({before:entitiesBefore,after:engine.doc.entities,beforeDoc:previousDoc,afterDoc:engine.doc,pending:pendingGpuEdit,previousDoc,previousRevision:beforeRevision});if(lt){delta=null;gpuEdit=lt.gpuEdit;}}
  if(delta){
    const {removed,added}=delta;
    if(outer&&typeof liveCheck!=='undefined')liveCheck?.notifyDelta(delta,previousDoc);
    // Rendering and hit testing use the same fully resolved display objects.
    // A shared block can contain tens of thousands of children; resolve once
    // per delta, lazily, only if one of the ready caches needs the additions.
    let addedDisplay;
    const resolveAddedDisplay=(_entities=added,byId=nearby.sharedCopies)=>addedDisplay??=(()=>{
      const sourceIds=c.ids||removed.map(e=>e.id),reuseDisplays=[];
      // Small shared references are not retained by default: register the
      // displayed tree of each copied/moved one so its copies translate it.
      const before=added.length?new Map(removed.map(e=>[e.id,e])):null;
      for(const id of sourceIds){const display=byId?.get(id);if(!display)continue;reuseDisplays.push(display);if(before&&display.sharedBlock&&typeof G.registerSharedDisplay==='function'){const canonical=before.get(id)||(typeof entityMap==='function'?entityMap().get(id):null);if(canonical)G.registerSharedDisplay(previousDoc,canonical,display);}}
      return G.visibleEntities(engine.doc,{inPlace:true,lodScale:0,viewBox:null,entities:added,reuseDisplays});
    })();
    if(visibleRevision===beforeRevision&&(engine.lastExecution?.lightweight||history)){
      const retained=retainVisibleEntities(previousDoc,engine.doc,visibleCache,removed,added,
        resolveAddedDisplay,{changedLayers:G.changedDisplayLayers,usesLayers:G.entityUsesLayers});
      if(retained){
        const generation=visibleGeneration;visibleCache=retained;visibleDoc=engine.doc;visibleRevision=sceneRevision;visibleGeneration++;
        if(nearby.objectsGeneration===generation)nearby.objectsGeneration=visibleGeneration;
      }
    }
    // History swaps immutable snapshots. The renderer additionally verifies
    // metadata, unchanged references and painter order before accepting this
    // delta, so a small undo/redo can retain the existing GPU scene too.
    if(engine.lastExecution?.lightweight||history)gpuEdit=mergePendingGpuEdit(pendingGpuEdit,{previousDoc,previousRevision:beforeRevision,lightweight:true,removed,added});
    if(renderSpatialRevision===beforeRevision&&renderSpatial?.insert){renderSpatial.remove?.(removed);renderSpatial.insert(added);renderSpatialRevision=sceneRevision;if(renderSpatial.needsCompaction?.()&&typeof scheduleSpatialCompaction==='function')scheduleSpatialCompaction();}
    if(nearby.objectsRevision===beforeRevision&&nearby.objects?.insert){
      // 집기·스냅 색인은 화면이 그리는 객체를 담는다: DWG 공유 블록은 저장 객체가 아니라 화면용 복사본이다.
      // 옛 복사본은 id 로 찾아 빼고, 새 객체는 화면과 같은 규칙(숨김·꺼진/동결 레이어 제외, 공유 블록 복사본)으로 넣는다.
      // (예전에는 저장 객체를 넣고 빼서 옮긴 와셔가 옛 자리에서 잡히고 새 자리에서 안 잡혔다.)
      const copies=nearby.sharedCopies||new Map(),stale=[];
      for(const entity of removed){stale.push(entity);const copy=entity?.sharedBlock?copies.get(entity.id):null;if(copy){stale.push(copy);copies.delete(entity.id);}}
      const fresh=resolveAddedDisplay();
      for(const entity of fresh)if(entity.sharedBlock)copies.set(entity.id,entity);
      nearby.objects.remove?.(stale);nearby.objects.insert(fresh);nearby.sharedCopies=copies;nearby.objectsRevision=sceneRevision;
    }
    if(entityLookupRevision===beforeRevision&&entityLookup){for(const entity of removed)entityLookup.delete(entity.id);for(const entity of added)entityLookup.set(entity.id,entity);entityLookupRevision=sceneRevision;}
  }
  // 연관 치수(ACAD200 514): 이번 명령으로 원본이 지워져 끊긴 치수가 생기면 알린다(엔진이 센 수 · 도면을 훑지 않음).
  if(engine.lastExecution?.assocLost)toast(`원본이 지워져 치수 ${engine.lastExecution.assocLost}개의 연관이 끊겼습니다 · DIMREASSOCIATE 로 다시 이을 수 있습니다.`);
  const commandDoc=engine.doc;
  if(typeof fieldSync!=='undefined')try{fieldSync.afterCommand(c,ids);}catch(error){console.warn('[field]',error);}   // 512 필드(바뀐 원본만)
  let draftingAdded=null;
  // 끄기 설정은 일반 AI 편집에만. 도면 묶음(drawingSets)이 새로 생기거나 바뀐 결과는 설정과 상관없이 연출한다(사용자 2026-10-25 연출 필수)
  if(outer&&typeof aiRevealArm!=='undefined'&&aiRevealArm>0&&(aiDrawRevealEnabled()||engine.doc.drawingSets!==previousDoc?.drawingSets)&&!document.hidden&&engine.doc.entities.length<=200000)try{
    const reuseDelta=delta&&commandDoc===engine.doc;
    // Chat staging and Workers clone retained objects. Compare IDs for their
    // completed documents so those copies cannot hide genuinely new geometry.
    const appendLoad=c.type==='load'||c.type==='lisp.apply';
    let revealDelta=appendLoad?appendLoadRevealDelta(entitiesBefore,engine.doc.entities):reuseDelta?delta:historyDelta(entitiesBefore,engine.doc.entities);
    if(!appendLoad&&!reuseDelta&&engine.doc.layers!==layersBefore)revealDelta=withLayerDelta(revealDelta,previousDoc,engine.doc);
    draftingAdded=revealDelta.added;
    if(!revealDelta.removed.length&&revealDelta.added.length){
      const previousIds=new Set(entitiesBefore.map(entity=>entity.id));
      if(!revealDelta.added.some(entity=>previousIds.has(entity.id)))startAIReveal(previousDoc,beforeRevision,revealDelta.added);
    }
  }catch(error){finishAIReveal();aiRevealStage?.destroy();aiRevealStage=null;console.warn('[ai-reveal]',error);}
  if(outer&&!history&&typeof draftingWaitSerial!=='undefined'){
    const fresh=draftingAdded||delta?.added||[];
    if(fresh.some(e=>e.detail||e.detailRole||['details','section','set','all'].includes(engine.doc.drawingSets?.[e.drawingSet?.id]?.kind))){
      const oldIds=new Set(entitiesBefore.map(e=>e.id));
      revealDraftingResult(engine.doc,fresh.filter(e=>!oldIds.has(e.id)));
    }
  }
  return ids || [];
  }finally{execute.depth--;}
}
/* 화면 어딘가에는 프로그램 판 번호가 보여야 한다(문의·업데이트 확인용). 상태 표시줄 오른쪽 끝에 "바른 CAD 5.0.4" 로 작게 둔다.
   판 번호는 package.json 에서 읽는다(서버·Electron 모두 정적 파일로 제공). 못 읽으면 표시하지 않는다. */
let appVersion='';
async function showAppVersion(){
  try{
    const response=await fetch('package.json',{cache:'no-store'});
    if(!response.ok)return;
    const pkg=await response.json();
    if(typeof pkg?.version!=='string'||!/^\d+\.\d+/.test(pkg.version))return;
    appVersion=pkg.version;
    if(window.cad)window.cad.appVersion=appVersion;
    const footer=document.querySelector('footer');
    const helpTitle=document.querySelector('#help-dialog h2');if(helpTitle&&!/\d\.\d/.test(helpTitle.textContent))helpTitle.textContent+=` · 바른 CAD ${appVersion}`;
    if(!footer||document.getElementById('app-version'))return;
    const label=document.createElement('span');label.id='app-version';label.className='app-version';label.textContent=`바른 CAD ${appVersion}`;label.dataset.short=`v${appVersion}`;label.title='프로그램 판 번호 '+appVersion;
    footer.append(label);
  }catch{}
}
showAppVersion();
window.cad = {
  execute,
  getDocument: () => structuredClone(engine.doc),
  getSettings: () => structuredClone(settings),
  performance: {recent:()=>structuredClone(drawingPerformanceLog),clear:()=>{drawingPerformanceLog.length=0;localStorage.removeItem('barun-drawing-performance-v1');}},
  input: {
    recent:count=>inputDiagnostics.recent(count),
    clear:()=>inputDiagnostics.clear(),
    enabled:()=>inputDiagnostics.enabled,
    setEnabled:value=>{try{localStorage.setItem('barun-input-debug',value?'1':'0');}catch{}return inputDiagnostics.setEnabled(value);},
  },
  version: 3,
};
function setSelected(ids) {
  selected = new SelectionSet(ids);
  if(typeof liveCheck!=='undefined')liveCheck?.selectionChanged([...selected],entitiesById(engine.doc.entities,selected).map(e=>e.reviewObjectId).filter(Boolean));
  scheduleEngineUiRefresh();
}
function addEntities(entities,options={}) {
  const layer = engine.doc.layers.find((l) => l.id === activeLayer);
  if (!layer?.visible || layer.locked)
    throw Error(
      "현재 레이어가 숨김/잠금 상태입니다. 다른 레이어를 선택하세요.",
    );
  return execute({
    type: "add.classified",centerlineId:options.centerlineId,
    entities: entities.map((e) => ({ ...e, layer: e.layer || activeLayer })),
  });
}
let toolButtonsKey = '';
function toolButtons() {
  const key = JSON.stringify([tab,mode,settings.aliases,showHiddenArchCards]);
  if (toolButtonsKey === key) return;
  toolButtonsKey = key;
  const root = $("tool-buttons");
  // Keep installed controls discoverable during lazy imports even after a tab
  // switch. Their original nodes own callbacks; never clone them.
  if(toolButtons.archTools){toolButtons.archTools.hidden=true;document.body.append(toolButtons.archTools);}
  root.replaceChildren();
  const addButton=(name,target=root)=>{
    const c = COMMANDS.find((c) => c.name === name)||MENU_INSTALLED_COMMANDS[name];
    if(!c)return;
    const
      b = document.createElement("button"),
      icon = document.createElement("b"),
      label = document.createElement("span"),
      key = document.createElement("kbd");
    b.dataset.command = name;
    b.className = mode === name ? "active" : "";
    icon.innerHTML=currentCommandIconSvg(name,c);
    label.textContent = c.label;
    key.textContent = settings.aliases[name] || (name==="SAVE"?settings.hotkeys?.SAVE||"":"");
    b.title = c.label+' · '+name + (settings.aliases[name] ? " · " + settings.aliases[name] + " + Enter" : "");
    b.dataset.menuSearch=commandSearchTerms({...c,name});
    b.append(icon, label, key);
    target.append(b);return b;
  };
  const menu=MENU_CATALOG[tab];
  if(menu){
    const details=document.createElement('details');details.className='ribbon-menu ribbon-catalog'+(tab==='file'?' file-dropdown':'');
    // Keep a real summary so Chromium does not synthesize its visible "세부정보"
    // label. The tab button opens this menu, so this native trigger stays inert.
    const summary=document.createElement('summary');summary.className='ribbon-catalog-trigger';summary.textContent=menu.label+' 도구';summary.tabIndex=-1;summary.setAttribute('aria-hidden','true');details.append(summary);
    const panel=document.createElement('div');panel.className='ribbon-catalog-panel';panel.setAttribute('aria-label',menu.label+' 도구');
    const heading=document.createElement('div');heading.className='ribbon-catalog-heading';
    const search=document.createElement('input');search.type='search';search.placeholder=menu.label+' 도구 검색 · 명령 / 이름 / 별칭';search.setAttribute('aria-label',menu.label+' 도구 검색');
    const close=document.createElement('button');close.type='button';close.className='catalog-close';close.textContent='닫기 ×';close.onclick=()=>{details.open=false;document.querySelector(`[data-tab="${tab}"]`)?.focus();};heading.append(search,close);
    const contents=document.createElement('div');contents.className='ribbon-catalog-sections';
    const addSection=label=>{const section=document.createElement('section'),title=document.createElement('h3'),items=document.createElement('div');section.className='ribbon-catalog-section';title.textContent=label;items.className='ribbon-catalog-items';section.append(title,items);contents.append(section);return items;};
    const installedNatives=new Set();
    if(tab==='arch'&&toolButtons.archTools){const items=addSection('대지·설계 실행');toolButtons.archTools.hidden=false;items.append(toolButtons.archTools);for(const button of toolButtons.archTools.querySelectorAll('[data-menu-native]')){const c=COMMANDS.find(c=>c.name===button.dataset.menuNative);if(c){installedNatives.add(c.name);button.dataset.menuSearch=commandSearchTerms(c);button.title=c.label+' · '+c.name;}}}
    for(const [name,installed] of Object.entries(MENU_INSTALLED_COMMANDS))if(installed.tabs.includes(tab))addButton(name,addSection('AI 설계'));
    const sections=tab==='file'?[{label:'파일',commands:['NEW','OPEN','SAVE','SAVEAS','BACKUP','RECOVER']}]:menu.sections;
    for(const section of sections){const items=addSection(section.label);for(const name of section.commands)if(!installedNatives.has(name)&&!(tab==='arch'&&archCardHiddenName(name)))addButton(name,items);if(!items.children.length)items.parentElement.remove();}
    const empty=document.createElement('p');empty.className='ribbon-catalog-empty';empty.textContent='일치하는 도구가 없습니다.';empty.hidden=true;
    const filter=()=>{
      let count=0;
      for(const section of contents.children){let matches=0;for(const button of section.querySelectorAll('button')){button.hidden=!matchesMenuQuery([button.dataset.menuSearch,button.textContent,button.title].filter(Boolean).join(' '),search.value);if(!button.hidden)matches++;}section.hidden=matches===0;count+=matches;}
      empty.hidden=count>0;
    };
    search.addEventListener('input',filter);search.addEventListener('keydown',event=>event.stopPropagation());
    contents.addEventListener('click',event=>{if(event.target.closest('button'))details.open=false;});
    details.addEventListener('toggle',()=>{const tabButton=document.querySelector(`[data-tab="${tab}"]`);tabButton?.setAttribute('aria-expanded',String(details.open));if(details.open){for(const other of document.querySelectorAll('.ribbon-catalog[open]'))if(other!==details)other.open=false;search.value='';filter();if(details.classList.contains('file-dropdown'))contents.querySelector('button')?.focus();else search.focus();}});
    panel.append(heading,contents,empty);details.append(panel);root.append(details);
  }
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll('.quick-tools [data-command]').forEach(b=>b.classList.toggle('active',b.dataset.command===mode));
}
// options: {exclude:{ids,keep,source}} 끌고 있는 객체 빼기(312), {collect:[]} 조리개 안 이름 스냅 후보 모두 모으기(313).
function snap(p) {
  const options=arguments[1]||{};   // 두 번째 인자(선택): 시험이 'function snap(p)' 로 이 함수를 찾는다
  snap.lastPoint={x:p.x,y:p.y};
  const ia=typeof assist!=='undefined'?assist:null;
  // 313: Tab 으로 고른 후보는 커서가 그 조리개 안에 있는 동안 유지된다(클릭도 그 점).
  const cycled=ia&&!options.collect?ia.snapCycle.current(p):null;
  if(cycled){const point={x:cycled.x,y:cycled.y,label:cycled.label,snapped:true,cycled:true};return typeof snapSource==="function"&&cycled.entityId!=null?snapSource(point,cycled.entityId):point;}   // 연관 치수: Tab 으로 고른 점도 원본 id
  const result=snapCore(p,options,ia);
  // 318: 카드·리습이 등록한 입력점 필터·모니터(없으면 그대로, 비용 0).
  return ia&&ia.inputPoints.active&&!options.collect?ia.inputPoints.compute(p,result,{mode,phase}).computed:result;
}
function snapCore(p,options={},ia=null) {
  let result = { ...p };
  // 스냅한 객체 id 를 숨은 속성으로 붙인다(dim-assoc.js snapSource · 연관 치수용). 앱 밖에서 잘라 돌리는 시험에는 없어도 된다.
  const tagSource=typeof snapSource==="function"?snapSource:point=>point;
  const tolerance = (ia?IA.apertureRadiusPx(num("snap-tolerance", 16),ia.lastPointerType):Math.max(4, Math.min(40, num("snap-tolerance", 16)))) / scale;   // 311
  const once=typeof osnapOnce!=='undefined'?osnapOnce:null;
  const collect=Array.isArray(options.collect)?options.collect:null,prune=!collect,exclude=options.exclude||null;
  const voted=ia&&ia.inputPoints.monitors.size?ia.inputPoints.excludedIds({mode,phase}):null;   // 312 모니터 투표
  const ignore=ia?IA.snapIgnores(ia.prefs.osnapOptions,once):null;   // 314 해치·치수 보조선
  let parent=null;
  if ($("osnap").checked||once) {
    let best = tolerance,
      found = null;
    const snapOptions=Object.fromEntries(['nearest','intersection','perpendicular','tangent','end','mid','center','quadrant','node','insert'].map(key=>[key,once?key===once:!!$('snap-'+key)?.checked]));
    const curves=[],near=[];
    let nearestFound=null,nearestBest=tolerance;
    const candidate=(point,label,entity,isNearest=false)=>{
      if(collect&&!isNearest&&Math.abs(point.x-p.x)<tolerance&&Math.abs(point.y-p.y)<tolerance){const d=G.dist(point,p);if(d<tolerance&&G.visiblePoint(entity,point))collect.push({x:point.x,y:point.y,label,d,entityId:parent?.id??entity?.id??null});}
      const limit=isNearest?nearestBest:best;
      if(Math.abs(point.x-p.x)>=limit||Math.abs(point.y-p.y)>=limit)return;
      const d=G.dist(point,p);
      if(d>=limit||!G.visiblePoint(entity,point))return;
      if(isNearest){nearestBest=d;nearestFound=tagSource({...point,label},entity);}
      else {best=d;found=tagSource({...point,label},entity);}
    };
    const accept=entity=>{
      if(exclude?.ids?.has(entity.id)||voted?.has(entity.id)||(ignore?.hatch&&entity.type==='hatch'&&!entity.solidFace))return false;
      if(prune&&found&&!G.snapBlockMayContain(entity,p,best))return false;
      parent=entity;return true;
    };
    for (const v of nearby(p,tolerance,true,accept)) {
        if(ignore&&((ignore.hatch&&v.type==='hatch'&&!v.solidFace)||(ignore.extension&&v.type==='line'&&IA.isDimensionExtension(parent,v.points))))continue;
        if(prune&&found&&!G.snapGeometryMayContain(v,p,best))continue;
        let local=G.snapGeometry(v,p,found&&prune?best:tolerance);
        // 타원은 근처점·교차점·수직점에 쓸 선분이 없었다(AutoCAD NEA·INT·PER 는 타원도 잡는다).
        if(v.type==='ellipse'){const r=found&&prune?best:tolerance;local={points:[],segments:G.segments({points:G.ellipsePoints(v,128)}).filter(s=>G.distanceToSegment(p,...s)<r)};}
        // 곡선을 잘게 나눈 폴리선(SPLINE·기울어진 원/호/타원 가져오기): AutoCAD 처럼 끝점은 양 끝, 중간점은 곡선 길이의 절반 하나.
        const curve=v.type==='polyline'&&(v.spline||v.curveApprox);
        if (snapOptions.nearest && !found && v.type !== 'text') {
          if (['circle','arc'].includes(v.type)) {
            const a=G.angle(G.sub(p,v.center));
            if(v.type==='circle'||G.angleOnArc(a,v.startAngle,v.endAngle)) candidate(G.add(v.center,G.polar(v.radius,a)),'근처점',v,true);
          } else for(const [a,b] of local.segments) {
            const d=G.sub(b,a),t=Math.max(0,Math.min(1,G.dot(G.sub(p,a),d)/(G.dot(d,d)||1)));
            candidate(G.add(a,G.mul(d,t)),'근처점',v,true);
          }
        }
        if(snapOptions.intersection&&['circle','arc'].includes(v.type)&&G.entityDistance(v,p)<tolerance)curves.push(v);
        // 수직점·접점(AutoCAD PER·TAN): 선·폴리선을 이어 찍는 중이면 직전 점에서 그은 수직의 발과 원·호의 접점.
        const snapFrom=points?.length&&!['SELECT','MOVE','COPY','ROTATE','SCALE','MIRROR','STRETCH'].includes(mode)?points.at(-1):null;
        if(snapFrom&&snapOptions.perpendicular&&v.type!=='text'){
          if(['circle','arc'].includes(v.type)){const d=G.sub(snapFrom,v.center);if(G.len(d)>G.EPS)for(const s of [1,-1]){const a=G.angle(G.mul(d,s));if(v.type==='circle'||G.angleOnArc(a,v.startAngle,v.endAngle))candidate(G.add(v.center,G.polar(v.radius,a)),'수직점',v);}}
          else for(const [a,b] of local.segments){const d=G.sub(b,a),dd=G.dot(d,d);if(dd<G.EPS)continue;const t=G.dot(G.sub(snapFrom,a),d)/dd;if(t>=-1e-9&&t<=1+1e-9)candidate(G.add(a,G.mul(d,t)),'수직점',v);}
        }
        if(snapFrom&&snapOptions.tangent&&['circle','arc'].includes(v.type)){
          const d=G.sub(snapFrom,v.center),distance=G.len(d);
          if(distance>v.radius+G.EPS){const base=G.angle(d),spread=Math.acos(v.radius/distance)*180/Math.PI;for(const a of [base+spread,base-spread])if(v.type==='circle'||G.angleOnArc(a,v.startAngle,v.endAngle))candidate(G.add(v.center,G.polar(v.radius,a)),'접점',v);}
        }
        // 노드(점 객체)·삽입점(문자·블록·점의 기준점) — 오토캐드 NOD·INS
        if(snapOptions.node&&v.type==='point'&&v.position)candidate(v.position,'노드',v);
        if(snapOptions.insert&&['text','mtext','block','point'].includes(v.type)&&v.position)candidate(v.position,'삽입점',v);
        if (snapOptions.end && v.points && !["text","mtext"].includes(v.type))
          for (const point of curve?(v.closed?[]:[v.points[0],v.points.at(-1)]):local.points)
            candidate(point,'끝점',v);
        // Zero distance cannot be beaten, including by a later intersection.
        if(prune&&best===0)return tagSource({...found,snapped:true},found.snapEntityId);
        if(snapOptions.mid&&curve&&!v.closed)candidate(G.halfwayPoint(v.points),'중점',v);
        if (snapOptions.mid && !curve && !["circle","arc","ellipse"].includes(v.type))
          // Reuse this entity's aperture query. candidate() still rejects
          // points outside the current (possibly reduced) best distance.
          for (const [a, b] of local.segments)
            candidate(G.mul(G.add(a,b),.5),'중점',v);
        if(v.type==='ellipse'){
          const start=v.startParam||0,end=v.endParam??Math.PI*2,tau=Math.PI*2;
          const sweep=((end-start)%tau+tau)%tau||tau;
          const at=t=>G.add(v.center,G.add(G.mul(v.majorAxis,Math.cos(t)),G.mul(G.normal(v.majorAxis),v.ratio*Math.sin(t))));
          if(snapOptions.end&&sweep<tau-1e-9)for(const t of [start,start+sweep])candidate(at(t),'끝점',v);
          if(snapOptions.mid&&sweep<tau-1e-9)candidate(at(start+sweep/2),'중점',v);
          if(snapOptions.quadrant)for(const t of [0,Math.PI/2,Math.PI,Math.PI*1.5])if(((t-start)%tau+tau)%tau<=sweep+1e-9)candidate(at(t),'사분점',v);
        }
        if (v.center) {
          if (snapOptions.center && G.visiblePoint(v,v.center))
            candidate(v.center,'중심',v);
            if(v.type==='arc') {
            if(snapOptions.end) for(const angle of [v.startAngle,v.endAngle]) candidate(G.add(v.center,G.polar(v.radius,angle)),'끝점',v);
            if(snapOptions.mid) {
              const sweep=((v.endAngle-v.startAngle)%360+360)%360;
              candidate(G.add(v.center,G.polar(v.radius,v.startAngle+sweep/2)),'중점',v);
            }
          }
          if (snapOptions.quadrant && ['circle','arc'].includes(v.type))
            for(const angle of [0,90,180,270]) if(v.type==='circle'||G.angleOnArc(angle,v.startAngle,v.endAngle))
              candidate(G.add(v.center,G.polar(v.radius,angle)),'사분점',v);
        }
        if(prune&&best===0)return tagSource({...found,snapped:true},found.snapEntityId);
        if (snapOptions.intersection)
          for (const segment of local.segments)
            if (
              G.distanceToSegment(p, ...segment) < (prune?best:tolerance)
            )
              near.push(Object.assign(segment,{clipMasks:v.clipMasks},curve||v.type==='ellipse'?{curveOf:v}:null));
      }
    // An intersection farther than an already valid named anchor cannot win.
    // Use that exact distance for the broad phase instead of solving every
    // crossing inside the full aperture at overview zoom. Equal-distance
    // intersections still lose to the earlier named anchor, as before.
    // 312: 그립으로 늘리는 폴리선은 빠졌지만 움직이지 않는 꼭짓점은 끝점 후보로 남긴다.
    if(snapOptions.end&&exclude?.keep?.length)for(const q of exclude.keep)candidate(q,'끝점',exclude.source||{});
    for(const point of snapIntersections(near,curves,p,prune?best:tolerance)){
      const d=G.dist(point,p);
      if(collect)collect.push({x:point.x,y:point.y,label:point.label||'교차점',d,entityId:null});
      if(d<best){best=d;found=point;}
    }
    // Named anchors take priority over the less specific nearest-point snap.
    if (!found) found=nearestFound;
    if (found) return tagSource({ ...found, snapped: true },found.snapEntityId);
  }
  // 315: 객체 스냅 추적. 얻은 추적점(최대 7개)의 가로·세로(극좌표면 그 각도) 선, 극좌표 선과의 교차.
  if(ia&&!collect&&ia.tracking.points.length&&$('otrack')?.checked&&typeof polarAngles==='function'){
    const base=typeof params!=='undefined'?params?.fromBase??points?.at?.(-1):null,polarOn=!!$('polar')?.checked;
    const tracked=ia.tracking.align(p,tolerance,{angles:polarOn?polarAngles():[0,90],extraLines:polarOn&&base&&Number.isFinite(base.x)?polarAngles().map(angle=>({base,angle:angle+polarRelativeAngle()})):[]});
    if(tracked)return {...tracked,label:'추적'};
  }
  if ($("snap").checked) {
    const step = Math.max(0.001, Math.min(1e9, num("spacing", 100)));
    result = {
      x: Math.round(p.x / step) * step,
      y: Math.round(p.y / step) * step,
    };
  }
  return orthogonalInput(polarInput(result,p));
}
// 극좌표 추적(F10, 오토캐드 POLARANG): 직전 점에서 증분 각도 근처로 커서가 가면 그 각도 선 위로 붙인다.
// 직교가 켜져 있으면 직교가 이긴다. 객체 스냅이 잡히면 스냅이 이긴다(위에서 먼저 돌아간다). 계산은 커서당 한 번(O(1)).
// 316: 각도 목록 = 증분 각의 배수 ∪ 추가 각도(설정), 상대 각(직전 선분 기준), 극좌표 거리 단위. 기본 설정이면 예전과 같은 점.
function polarAngles(){const prefs=typeof assist!=='undefined'?assist.prefs:null;return IA.polarAngleList(Number($('polar-angle')?.value)||90,prefs?.polarAddAngles||'');}
function polarRelativeAngle(){
 if(typeof assist==='undefined'||!assist.prefs.polarRelative||!(points?.length>1))return 0;
 const a=points.at(-2),b=points.at(-1);return G.dist(a,b)>G.EPS?G.angle(G.sub(b,a)):0;
}
function polarInput(point,raw){
 if(!$('polar')?.checked||$('ortho')?.checked)return point;
 if(ORTHO_EXEMPT_MODES.has(mode)||ORTHO_EXEMPT_PHASES.has(phase))return point;
 const base=params?.fromBase??points.at(-1);if(!base||!Number.isFinite(base.x))return point;
 const d=G.sub(raw,base),len=G.len(d);if(len<=G.EPS)return point;
 const tolerance=Math.max(4,Math.min(40,num("snap-tolerance",16)))/scale;
 if(typeof IA!=='undefined'&&typeof assist!=='undefined'){
  const hit=IA.polarTrack(base,raw,{angles:polarAngles(),tol:tolerance,relative:polarRelativeAngle(),distanceUnit:assist.prefs.polarDistance});
  return hit?{x:hit.x,y:hit.y,polar:{base:{...base},angle:hit.angle}}:point;
 }
 const step=Number($('polar-angle')?.value)||90,angle=G.angle(d),target=Math.round(angle/step)*step;
 const along=G.polar(1,target),projected=G.add(base,G.mul(along,G.dot(d,along)));
 if(G.dot(d,along)<=0||G.dist(projected,raw)>tolerance)return point;
 return {...projected,polar:{base:{...base},angle:((target%360)+360)%360}};
}
// 직교(F8). 오토캐드와 같은 규칙이다.
// · 기준점은 마지막으로 찍은 점이다(폴리선·선의 두 번째 구간부터도 직전 점을 기준으로 삼는다).
// · 커서를 가까운 축에 그대로 투영한다. 길이는 그 축 성분이지 커서까지의 거리가 아니다.
// · 정확한 객체 스냅은 직교보다 우선한다. 스냅이 없을 때만 축에 투영한다.
// · 점을 찍는 단계가 아닌 곳(객체 선택·영역 창·화면 이동)에는 걸지 않는다.
// RECTANGLE 은 오토캐드처럼 예외다 — 두 모서리를 모두 축에 가두면 폭이나 높이가 0이 돼 그려지지 않는다.
const ORTHO_EXEMPT_MODES=new Set(['SELECT','PAN','ZOOM','PLOTWINDOW','PLANPLACE','XCLIP','HATCH','MATCHPROP','RECTANGLE']);
const ORTHO_EXEMPT_PHASES=new Set(['select','window','pick','offset-object','insulation-select','wall-center-pick','hatch-inside','zoom-window','dim-object','dim-pick','rotate-ref']);
// 기존 객체를 고르는 단계는 공통으로 작은 선택 상자만 쓴다.
// 점·좌표·거리 방향을 지정하는 단계에서만 십자선을 보여 준다.
const OBJECT_PICK_PHASES=new Set(['select','window','pick','offset-object','insulation-select','wall-center-pick','dim-object','dim-pick','xline-offset-pick']);
// 객체를 집는 단계는 십자선 대신 선택 상자(오토캐드 pickbox)를 보이고 스냅하지 않는다.
// 단계 이름이 없는 집기(계산기 숫자, 리습·카드 객체 선택, 원 TTR, 참조 선 고르기 등)도 여기서 함께 본다.
// studio 는 파일 뒤쪽에서 만들어진다 — 그 전에 그리기가 불려도 오류 없이 '계산기 없음'으로 본다.
function numberCalculatorState(){try{return studio.numberCalculator||null;}catch{return null;}}
function objectPickStep(currentMode){
 if(numberCalculatorState()?.picking)return true;
 if(currentMode==='PICKENTITY')return true;
 if(currentMode==='REVCLOUD')return !!params?.cloudObject;
 if(currentMode==='CIRCLE')return params?.circleMode==='TTR'&&(params.ttr?.length||0)<2;
 if(currentMode==='ROTATE')return ['ref-line','new-line'].includes(params?.rotateRef?.stage);
 if(['DIMRADIUS','DIMDIAMETER'].includes(currentMode))return !params?.circle;
 if(currentMode==='AHM')return !points.length;
 return false;
}
function objectPickCursor(currentMode=mode,currentPhase=phase){
 return currentMode==='SELECT'&&!numberCalculatorState()?.placing||currentMode==='MATCHPROP'||OBJECT_PICK_PHASES.has(currentPhase)||objectPickStep(currentMode);
}
function idleSelectionCrosshair(currentMode=mode,currentPhase=phase){
 return currentMode==='SELECT'&&currentPhase==='idle'&&!numberCalculatorState()?.active;
}
// Shift 를 누르는 동안 직교를 반대로(오토캐드 임시 직교). 점 입력 단계에서만 의미가 있다(선택 단계는 아래에서 빠진다).
let shiftOrthoHeld=false;
if(typeof addEventListener==='function'){
 addEventListener('keydown',e=>{if(e.key==='Shift')shiftOrthoHeld=true;},true);
 addEventListener('keyup',e=>{if(e.key==='Shift')shiftOrthoHeld=false;},true);
 addEventListener('blur',()=>{shiftOrthoHeld=false;});
}
function orthogonalInput(point,direction=point){
 if(!$('ortho')?.checked===!(typeof shiftOrthoHeld!=='undefined'&&shiftOrthoHeld))return point;
 if(ORTHO_EXEMPT_MODES.has(mode)||ORTHO_EXEMPT_PHASES.has(phase))return point;
 const base=points.at(-1);
 if(!base||!Number.isFinite(base.x)||!Number.isFinite(base.y))return point;
 const snapAngle=typeof getSnapAngle==='function'?getSnapAngle():0; /* A1 작업 각도(SNAPANG, snap-angle.js) */
 if(snapAngle)return orthoSnap(base,point,direction,snapAngle);
 const dx=direction.x-base.x,dy=direction.y-base.y;
 return Math.abs(dx)>=Math.abs(dy)?{...point,x:point.x,y:base.y}:{...point,x:base.x,y:point.y};
}

function nearby(p,tolerance,primitives=false,accept=null){
 // 연출 중에도 스냅은 그대로 찾는다(10/23: 연출이 남으면 스냅이 통째로 꺼졌다). 연출을 끝내는 건 누르기·명령 시작 쪽이 한다 — 커서만 움직여 연출이 끊기지 않게.
 const box={minX:p.x-tolerance,minY:p.y-tolerance,maxX:p.x+tolerance,maxY:p.y+tolerance};
 if(typeof sceneRevision==='undefined'){const es=visible();return G.spatialIndex(primitives?es.flatMap(e=>G.querySnapPrimitives(e,box)):es).query(box);}
 // Small drawings: visible() also advances the generation checked below.
 const currentVisible=engine.doc.entities.length>50000?null:visible();
 // AutoCAD처럼 먼저 최상위 공간 인덱스로 화면의 작은 후보군만 찾는다.
 // 축소 표시 중인 대형 블록을 전부 선분으로 풀지 않아 마우스 이동이 멈추지 않는다.
 // 대형 도면은 화면 밖 객체를 visible()에서 제외한다. 팬/줌 뒤에는 sceneRevision이
 // 그대로여도 화면 후보가 달라지므로 visibleGeneration까지 맞춰야 보이는 객체를 고를 수 있다.
 if(nearby.objectsRevision!==sceneRevision||nearby.objectsGeneration!==pickGeneration()){setNearbyObjects(currentVisible||pickCandidates());nearby.objectsRevision=sceneRevision;nearby.objectsGeneration=pickGeneration();}
 const objects=nearby.objects.query(box);
 if(!primitives)return objects;
 // 고른 블록·치수의 기준점(삽입점·정의점)은 그림 상자 밖일 수 있다. 상자를 키우면 큰 도면 스냅이 느려지므로 고른 것(32개까지 — 큰 선택 이동 때 스냅마다 다 훑지 않게)만 따로 넣는다.
 if(typeof selected!=='undefined'&&selected?.size&&selected.size<=32&&typeof entityMap==='function'){const have=new Set(objects.map(e=>e.sourceId??e.id));for(const id of selected){if(have.has(id))continue;const e=entityMap().get(id);if(e&&(e.type==='block'||e.type==='dimension'))objects.push(e);}}
 // 스냅 때마다 후보 블록 전체를 평탄화하고 새 인덱스를 만드는 일을 피한다.
 // 화면 축소용 블록 생략은 원본 끝점·교차점 스냅을 생략하는 근거가 아니다.
 // 커서 근처의 후보 블록만 정밀 표시 복사본을 만들고 같은 화면 세대에서 재사용한다.
 const precise=nearby.preciseBlocks||(nearby.preciseBlocks=new WeakMap());
 if(accept)return (function*(){
  for(const entity of objects){
   let exact=entity;
   if(entity.type==='block'){
    if(!precise.has(entity))precise.set(entity,G.preciseSnapBlock(engine.doc,entity));
    exact=precise.get(entity);
   }
   if(exact&&accept(exact))yield* G.querySnapPrimitives(exact,box);
  }
 })();
 return objects.flatMap(entity=>{
   if(entity.type!=='block')return G.querySnapPrimitives(entity,box);
   if(!precise.has(entity))precise.set(entity,G.preciseSnapBlock(engine.doc,entity));
   const exact=precise.get(entity);return exact?G.querySnapPrimitives(exact,box):[];
 });
}
// Snap and pick candidates. Large drawings cull visible() to the viewport for
// display, but picking uses the same whole-document set smaller drawings use,
// resolved once per revision: pan and zoom then never invalidate the pick index
// (rebuilding it for each new view cost ~1 s on a 190k-object plan).
let pickSetRevision=-1,pickSet=[];
function pickCandidates(){
 if(engine.doc.entities.length<=50000)return visible();
 if(pickSetRevision!==sceneRevision){pickSet=G.visibleEntities(engine.doc,{inPlace:true,lodScale:0,viewBox:null});pickSetRevision=sceneRevision;}
 return pickSet;
}
function pickGeneration(){return engine.doc.entities.length>50000?-1:visibleGeneration;}
// pickCandidates() for a large drawing, resolved a few thousand entities per
// task so opening never blocks input for seconds. Same result as the one-shot
// call: visibleEntities visits every top-level entity independently.
async function preparePickCandidatesAsync(onProgress){
 const doc=engine.doc,revision=sceneRevision,all=doc.entities;
 if(all.length<=50000||pickSetRevision===revision)return;
 const list=[],step=4000;
 for(let i=0;i<all.length;i+=step){
  for(const entity of G.visibleEntities(doc,{inPlace:true,lodScale:0,viewBox:null,entities:all.slice(i,i+step)}))list.push(entity);
  onProgress?.(Math.min(all.length,i+step),all.length);
  await loadTask();
  if(engine.doc!==doc||sceneRevision!==revision)return;
 }
 pickSet=list;pickSetRevision=revision;
}
// Medium drawings (up to 50,000 objects) display the whole document, so the
// first fit()/visible() expanded every shared block at once: 3 s of held input
// on a 7,800-object plan whose blocks hold 850k primitives. Expand and retain
// them a few at a time before the tab opens; visible() then finds the retained
// trees (geometry.js registers those with 128+ children).
// The retained trees are held only weakly until visible() adopts them, so the
// caller keeps the returned list alive until the tab has opened; otherwise the
// GC that follows this much allocation collects them and fit() expands again.
async function prepareSharedDisplayAsync(doc,onProgress){
 const displays=[];
 if(!doc?.sharedBlocks||doc.entities.length>50000)return displays;
 const shared=doc.entities.filter(entity=>entity?.sharedBlock);if(!shared.length)return displays;
 let sliceStart=performance.now();
 for(let i=0;i<shared.length;i++){
  for(const display of G.visibleEntities(doc,{inPlace:true,lodScale:0,viewBox:null,entities:[shared[i]]}))displays.push(display);
  if(performance.now()-sliceStart>=24){
   onProgress?.(i+1,shared.length);
   await loadTask();
   sliceStart=performance.now();
  }
 }
 return displays;
}
const GPU_BUILD_PHASES=['prepare','compile','items','lines','finish'];
const GPU_BUILD_LABELS={prepare:'화면용 도형을 펼치고 있습니다.',compile:'화면 도형을 준비하고 있습니다.',items:'선·해치·문자를 정리하고 있습니다.',lines:'GPU 버퍼를 만들고 있습니다.',finish:'첫 화면을 마무리하고 있습니다.'};
/* 집기 색인을 새로 만들 때 공유 블록 화면 복사본도 id 로 기억한다(편집 뒤 부분 갱신에서 옛 복사본을 빼려고). */
function setNearbyObjects(list){nearby.objects=G.spatialIndex(list);nearby.preciseBlocks=new WeakMap();const copies=new Map();for(const entity of list)if(entity?.sharedBlock)copies.set(entity.id,entity);nearby.sharedCopies=copies;}
function warmNearbyIndex(entities=null){
 // Large drawings pick from the whole-document set, not the culled view.
 if(engine.doc.entities.length>50000)entities=null;
 const revision=sceneRevision,generation=pickGeneration();
 if(nearby.objectsRevision===revision&&nearby.objectsGeneration===generation)return;
 if(warmNearbyIndex.revision===revision&&warmNearbyIndex.generation===generation)return;
 warmNearbyIndex.revision=revision;warmNearbyIndex.generation=generation;
 const build=()=>{
   if(revision!==sceneRevision||generation!==pickGeneration()||(nearby.objectsRevision===revision&&nearby.objectsGeneration===generation))return;
   setNearbyObjects(entities||pickCandidates());nearby.objectsRevision=revision;nearby.objectsGeneration=generation;
  };
 if(typeof requestIdleCallback==='function')requestIdleCallback(build,{timeout:80});else setTimeout(build,0);
}
function prepareNearbyIndexNow(entities=pickCandidates()){
 if(nearby.objectsRevision!==sceneRevision||nearby.objectsGeneration!==pickGeneration()){setNearbyObjects(entities);nearby.objectsRevision=sceneRevision;nearby.objectsGeneration=pickGeneration();}
 warmNearbyIndex.revision=sceneRevision;warmNearbyIndex.generation=pickGeneration();
}
// 선택 상자에 걸릴 수 있는 후보만 공간 인덱스에서 추린다. 잠금 레이어 제외 규칙은 editable()과 같다.
function boxCandidates(box){
 const half=Math.max(box.maxX-box.minX,box.maxY-box.minY)/2;
 const center={x:(box.minX+box.maxX)/2,y:(box.minY+box.maxY)/2};
 return nearby(center,half).filter(e=>!layerMap().get(e.layer)?.locked);
}
function pick(p, options = {}) {
  const tolerance = Math.max(4,Math.min(30,num('pickbox-size',10))) / 2 / scale;
  return pickDisplayEntity(nearby(p,tolerance),p,tolerance,options,e=>layerMap().get(e.layer)?.locked||(typeof blockEditOutside!=='undefined'&&!!blockEditOutside?.has(e.id)));
}
const overlapCycle=new OverlapSelection();
let overlapPanel=null,overlapCandidates=[],overlapContext=null;
function clearOverlapSelection(){overlapCycle.clear();overlapCandidates=[];overlapContext=null;overlapPanel?.hide();}
function selectOverlapCandidate(id){
  if(!overlapContext||overlapContext.key!==`${sceneRevision}:${interaction.value}:${mode}:${phase}`){clearOverlapSelection();return;}
  const hit=overlapCandidates.find(entity=>entity.id===id);if(!hit)return;
  const ids=overlapCycle.select(id);if(!ids)return;
  setSelected(ids);previousSelection=[...selected];
  if(mode==='FILLET'){
    params.cornerPicks??={};for(const candidate of overlapCandidates)if(!selected.has(candidate.id))delete params.cornerPicks[candidate.id];
    params.cornerPicks[id]={...overlapContext.world};
  }
  overlapPanel.show(overlapCandidates,layerMap(),id);render();canvas.focus();
}
function handleOverlapSelection(point,pixel,event){
  const radius=Math.max(4,Math.min(30,num('pickbox-size',10)))/2/scale;
  const candidates=nearby(point,radius).toReversed().filter(entity=>!layerMap().get(entity.layer)?.locked)
    .map(entity=>({entity,distance:pickDistance(entity,point,radius)}))
    .filter(item=>item.distance<radius).sort((a,b)=>a.distance-b.distance).map(item=>item.entity);
  if(candidates.length<2||params.removeSelection){clearOverlapSelection();return null;}
  const key=`${sceneRevision}:${interaction.value}:${mode}:${phase}`;
  const hit=overlapCycle.pick(candidates,pixel,key,mode==='SELECT'&&!event.shiftKey?new Set():selected,event.shiftKey);
  const byId=new Map(candidates.map(entity=>[entity.id,entity]));
  overlapCandidates=overlapCycle.ids.map(id=>byId.get(id));overlapContext={key,world:{...point}};
  overlapPanel??=createOverlapPanel({document,onSelect:selectOverlapCandidate,onClose:clearOverlapSelection});
  overlapPanel.show(overlapCandidates,layerMap(),hit.id);return hit;
}
function distancePoint(value, base, directionPoint) {
  const delta=directionPoint?G.sub(directionPoint,base):{x:1,y:0};
  return G.add(base,G.mul(G.len(delta)>G.EPS?G.unit(delta):{x:1,y:0},Number(value)));
}
function stretchDraft(destination) {
  return G.stretchEntities(engine.doc.entities,params.targets||[],G.sub(destination,points[0]));
}
function nearPlacementWall(p){return visible().filter(e=>e.type==='wall').map(e=>({e,d:G.distanceToSegment(p,...e.points)})).filter(({e,d})=>d<=e.thickness/2+12/scale).sort((a,b)=>a.d-b.d)[0]?.e;}
function placementArchitecture(p){
  if(params.hostLines)return placementOnWallLines(p).entity;
  if(params.library){const spec=ARCH_LIBRARY[params.library];if(['DOOR','WINDOW'].includes(spec.kind)){const wall=nearPlacementWall(p);if(wall){if(engine.doc.layers.find(l=>l.id===wall.layer)?.locked)throw Error('벽 레이어가 잠겨 있습니다.');return {...wallOpening(spec.kind,params.options,wall,p,activeLayer),libraryCommand:params.library};}}return architecturalDetail(params.library,{...params.options,x:p.x,y:p.y},activeLayer);}
  if(['DOOR','WINDOW'].includes(params.kind)){
    const wall=nearPlacementWall(p);
    if(wall){if(engine.doc.layers.find(l=>l.id===wall.layer)?.locked)throw Error('연동 벽 레이어가 잠겨 있습니다.');return wallOpening(params.kind,params.options,wall,p,activeLayer);}
  }
  return architecture(params.kind,{...params.options,x:p.x,y:p.y},activeLayer);
}
function placementOnWallLines(p){const es=engine.selected(params.hostLines),pair=parallelWallPair(es),length=G.dist(...pair.center),width=params.options.width;if(width>length)throw Error('창호 폭이 벽선 공통 길이보다 큽니다.');const offset=Math.max(0,Math.min(length-width,G.dot(G.sub(p,pair.center[0]),pair.u))),base=G.add(pair.center[0],G.mul(pair.u,offset));return {entity:architecturalDetail(params.library,{...params.options,x:base.x,y:base.y,rotation:G.angle(pair.u),depth:Math.abs(pair.offset)},activeLayer),parts:wallLineOpening(es,offset,width),sources:es};}
function draft() {
  const calculatorDraft=typeof numberCalculatorState==='function'&&numberCalculatorState()?.draft?.(cursor);if(calculatorDraft)return calculatorDraft;
  if(phase==='select'&&params?.selectPoly?.points?.length&&cursor){const ps=[...params.selectPoly.points,cursor];return [{type:'polyline',points:ps,closed:params.selectPoly.kind!=='F'&&ps.length>2,linetype:'DASHED'}];}
  if(drag?.kind==='trim-fence')return [{type:'line',points:[drag.startWorld,drag.currentWorld],linetype:'DASHED'}];
  if(['TRIM','EXTEND'].includes(mode)&&params.fencePoints?.length&&cursor)return [{type:'line',points:[params.fencePoints[0],cursor],linetype:'DASHED'}];
  if(mode==='PLOTWINDOW'&&points.length&&cursor)return [{type:'rectangle',points:G.rectangle(points[0],cursor)}];
  // 계획안 놓기: 계획안 왼쪽 아래가 마우스 끝에 붙어 따라다닌다
  if(mode==='PLANPLACE'&&cursor&&params.planPlace){const {entities,base}=params.planPlace;return entities.map(e=>previewTransformEntity(e,'translate',{dx:cursor.x-base.x,dy:cursor.y-base.y}));}
  if(drag?.kind==='entity-grip'||drag?.kind==='object-move')return drag.preview||[];
  if(mode==='XCLIP'&&points.length&&cursor)return [{type:'polyline',closed:true,points:params.clipPolygon?[...points,cursor]:G.rectangle(points[0],cursor)}];

  if(mode==='INSULATION'&&points.length&&cursor){try{
    const value=$('coordinate').value.trim(),end=Number(value)>0&&Number.isFinite(Number(value))?distancePoint(value,points.at(-1),cursor):cursor;
    return [insulationPath([...points,end],params.depth,params.side,false,activeLayer)];
  }catch{return [];}}

  if(mode==='AREA' && phase==='area-label' && cursor)return [{type:'text',position:cursor,text:params.areaText,height:params.height,rotation:0}];
  if(mode==='ARCHPLACE'&&cursor){try{return [placementArchitecture(cursor)];}catch{return [];}}
  if(mode==='PICKPATH'){if(!params.preview)return [];try{return params.preview(points,cursor)||[];}catch{return [];}}
  // PDFIMPORT: 쪽 왼쪽 아래가 커서에 오게 미리보기. 객체가 많으면 둘레 사각형만.
  if(mode==='PDFIMPORT'&&phase==='point'&&cursor&&params.pdfEntities){const list=params.pdfEntities,dx=cursor.x,dy=cursor.y;
    if(list.length<=2000)return list.map(e=>previewTransformEntity(e,'translate',{dx,dy}));
    const b=params.pdfBounds;return b?[{type:'rectangle',points:G.rectangle({x:b.minX+dx,y:b.minY+dy},{x:b.maxX+dx,y:b.maxY+dy})}]:[];}
  if(mode==='PASTECLIP'&&cursor&&cadClipboard){const {entities,base}=cadClipboard,dx=cursor.x-base.x,dy=cursor.y-base.y;
    if(entities.length<=2000)return entities.map(e=>previewTransformEntity(e,'translate',{dx,dy}));
    const b=G.bounds(entities);return b?[{type:'rectangle',points:G.rectangle({x:b.minX+dx,y:b.minY+dy},{x:b.maxX+dx,y:b.maxY+dy})}]:[];}
  if(mode==='GRIP'&&cursor){if(params.grip?.aiWall)return wallGripPreview(params.grip,cursor);if(params.op==='stretch'){const source=engine.doc.entities.find(e=>e.id===params.gripId);if(source?.type==='dimension')return dimensionPreview(p=>{const cmd=gripCommandFor(p);return cmd.type==='stretch'?G.stretchEntities([source],cmd.targets,{x:cmd.dx,y:cmd.dy}):{...structuredClone(source),...cmd.changes};})(cursor);return [{type:'line',points:[points[0],cursor],linetype:'DASHED'}];}
    const op=params.op,base=points[0];return chosen().map(e=>previewTransformEntity(e,op==='move'?'translate':op,op==='move'?{dx:cursor.x-base.x,dy:cursor.y-base.y}:op==='rotate'?{base,degrees:G.angle(G.sub(cursor,base))}:op==='scale'?{base,factor:Math.max(G.EPS,G.dist(base,cursor))}:{a:base,b:cursor}));}
  if(mode==='DONUT'&&phase==='point'&&cursor)return [donutEntity(cursor)];
  if(mode==='SPLINE'&&points.length&&cursor)return [{type:'polyline',closed:false,points:splinePoints([...points,cursor])}];
  if(mode==='XLINE'&&params.bisect&&cursor){if(points.length<2)return points.length?[{type:'line',points:[points[0],cursor],linetype:'DASHED'}]:[];const d=G.add(G.unit(G.sub(points[1],points[0])),G.unit(G.sub(cursor,points[0])));return G.len(d)>G.EPS?[constructionLine(points[0],d,false)]:[];}
  if(mode==='XLINE'&&String(phase).startsWith('xline-offset'))return [];
  if(mode==='XLINE'&&cursor&&(points.length||(params.xlineMode&&params.xlineMode!=='B'))){try{return [constructionLine(params.xlineMode&&params.xlineMode!=='B'?cursor:points[0],xlineDirection(cursor),false)];}catch{return [];}}
  if(mode==='RAY'&&cursor&&points.length){try{return [constructionLine(points[0],G.sub(cursor,points[0]),true)];}catch{return [];}}
  if(mode==='REVCLOUD'&&params.cloudPolygon&&cursor&&points.length)return [{type:'polyline',closed:points.length>=2,points:[...points,cursor],linetype:'DASHED'}];
  if(mode==='REVCLOUD'&&cursor&&points.length&&Math.abs(cursor.x-points[0].x)>G.EPS&&Math.abs(cursor.y-points[0].y)>G.EPS)return [cloudPoints(G.rectangle(points[0],cursor))];
  if(mode==='CIRCLE'&&params.circleMode&&cursor&&params.circlePoints?.length){const c=circleFromPoints([...params.circlePoints,cursor]);return c?[c]:[];}
  if(mode==='POLYGON'&&points.length&&cursor&&phase==='point'){try{return [polygonEntity(points[0],cursor)];}catch{return [];}}
  if(['DIMCONTINUE','DIMBASELINE'].includes(mode)&&params.baseDim&&phase==='point')return dimensionPreview(chainDimension)(cursor);
  if(['DIMRADIUS','DIMDIAMETER'].includes(mode)&&params.circle)return dimensionPreview(radialDimension)(cursor);
  if (!points.length || !cursor) return [];
  const a = points[0],
    p = { x: cursor.x, y: cursor.y };
  try {
    if(mode==='STRETCH') {
      const value=$('coordinate').value.trim();
      return stretchDraft(Number(value)>0&&Number.isFinite(Number(value))?distancePoint(value,a,p):p);
    }
    if (mode === "ELLIPSE" && params.ellipseDraft) { const d=params.ellipseDraft,at=S4.ellipseAngleOfPoint(d,p); return params.ellipseStart==null?[d,{type:'line',points:[d.center,p],linetype:'DASHED'}]:[S4.ellipseArc(d,params.ellipseStart,at)]; }
    if (mode === "ELLIPSE" && points.length === 1) return [{ type: "line", points: [a, p] }];
    if (mode === "ELLIPSE" && points.length === 2)
      return [
        {
          type: "ellipse",
          center: points[0],
          majorAxis: G.sub(points[1], points[0]),
          ratio: Math.min(
            1,
            G.dist(points[0], p) / G.dist(points[0], points[1]),
          ),
        },
      ];
    if(mode==='AHM')return [{type:'polyline',points:[...points,p],closed:false,linetype:'DASHED',color:'#b995ff'}];
    if (mode === "CIRCLE")
      return [{ type: "circle", center: a, radius: G.dist(a, p)/(params.diameter?2:1) }];
    if (mode === "RECTANGLE")
      return phase==='point'?[rectangleEntity(a, rectangleCorner(a, p))]:[];
    // PLINE 폭(W)은 그리는 동안에도 실제 두께로 보여 준다(예전엔 끝낼 때까지 가는 선이라 폭이 안 들어간 줄 알았다)
    const plineWidth=mode==='PLINE'&&!params.areaOutline?(params.plineWidth??run.plineWidth??0):0,widthOf=plineWidth>0?{constantWidth:plineWidth}:{};
    if(mode==='PLINE'&&['pline-arc','pline-arc-dend'].includes(phase)){const arc=tangentArc(points.at(-1),phase==='pline-arc-dend'?params.plineArcDir:plineTangent(),p);if(arc)return [{type:'polyline',points:points.slice(Math.max(0,points.length-400)),...widthOf},plineWidth>0?{type:'polyline',points:Array.from({length:48},(_,i)=>G.add(arc.center,G.polar(arc.radius,arc.startAngle+(((arc.endAngle-arc.startAngle)%360+360)%360)*i/47))),...widthOf}:{...arc,...widthOf}];}
    if (["LINE", "PLINE", "DIST"].includes(mode))
      return [{ type: "polyline", points: [...points, p], ...widthOf }];
    if (mode === "ARC"){
      const arc=arcFromInput([...points,p]);
      return arc?[arc]:[{ type: "line", points: [points.at(-1), p] }];
    }
    if (mode === "WALL")
      return [
        configuredWall(a,p,params),
      ];
    if (["MOVE", "COPY"].includes(mode)) {
      const targets=chosen();
      if(typeof heavyTranslateSelection==='function'&&heavyTranslateSelection(targets)){
        const ids=targets.map(e=>e.id);
        if(translateSnapshot?.mode!==mode||translateSnapshot.ids.join(',')!==ids.join(','))translateSnapshot={mode,ids};
        return [];
      }
      // 작은 대상은 객체 미리보기로 그린다. 예전 큰 대상의 그림(translateSnapshot)을 남겨 두면
      // drawTranslateSnapshot 이 그 대상(건물 한 줄·도면 묶음)까지 커서를 따라 그려 도면 전체가 움직이는 것처럼 보였다.
      if(typeof translateSnapshot!=='undefined'&&translateSnapshot)translateSnapshot=null;
      return targets.map((e) => previewTransformEntity(e,'translate',{dx:p.x-a.x,dy:p.y-a.y}));
    }
    if (mode === "ROTATE"){
      const ref=params.rotateRef;
      if(ref&&ref.stage!=='new')return [];
      const targets=chosen(),values={base:a,degrees:ref?rotateDelta(G.angle(G.sub(p,a))):G.angle(G.sub(p,a))};
      if(typeof heavyMatrixPreview==='function'&&heavyMatrixPreview(targets,'rotate',values))return [];
      return targets.map((e) => previewTransformEntity(e,'rotate',values));
    }
    if (mode === "SCALE"){
      // 찍은 점(기준점·참조 두 점·새 길이 첫 점)을 화면에 남기고, 두 점을 잇는 중이면 고무줄 선을 보인다.
      const ref=params.scaleRef,size=6/scale,mark=q=>[{type:'line',points:[{x:q.x-size,y:q.y-size},{x:q.x+size,y:q.y+size}]},{type:'line',points:[{x:q.x-size,y:q.y+size},{x:q.x+size,y:q.y-size}]}];
      const marks=[a,ref?.a,ref?.b,ref?.n1].filter(Boolean).flatMap(mark);
      const from=ref?.stage==='ref2'?ref.a:ref?.stage==='new2'?ref.n1:null;
      if(from)marks.push({type:'line',points:[from,p],linetype:'DASHED'});
      if(ref&&!['new','new2'].includes(ref.stage))return marks;
      const factor=ref?G.dist(ref.stage==='new2'?ref.n1:a,p)/ref.length:G.dist(a,p);
      if(factor>G.EPS&&typeof heavyMatrixPreview==='function'&&heavyMatrixPreview(chosen(),'scale',{base:a,factor}))return marks;
      return [...marks,...(factor>G.EPS?chosen().map((e) => previewTransformEntity(e,'scale',{base:a,factor})):[])];
    }
    if (mode === "MIRROR") return typeof heavyMatrixPreview==='function'&&heavyMatrixPreview(chosen(),'mirror',{a,b:params.mirrorB||p})?[]:chosen().map((e) => previewTransformEntity(e,'mirror',{a,b:params.mirrorB||p}));
    if (mode === "TEXT")
      return [
        {
          type: "text",
          position: a,
          text: phase === "text" ? $("coordinate").value || "문자" : "문자",
          height: params.height || num("text-height", 150),
          rotation: phase==='text-rotation'?G.angle(G.sub(p,a)):(params.rotation||0),
          ...((run.textWidth||1)!==1?{widthFactor:run.textWidth}:{}),
        },
      ];
    if (["DIMLINEAR", "DIMALIGNED"].includes(mode)) {
      if(points.length===1&&phase==='point')return [{type:'line',points:[a,p]}];
      if(points.length===2)return dimensionPreview(draftLinearDimension)(p);
    }
    if (["DOOR", "WINDOW", "STAIR"].includes(mode))
      return [symbol(mode, params, a, G.angle(G.sub(p, a)), activeLayer)];
  } catch {
    return [];
  }
  return [];
}
// 하단 상태줄: 고른 객체가 있으면 '선택 N개 · 객체 M개'
function showSelectionCount(){
  const total=engine.doc.entities.length;
  const gripHidden=typeof assist!=='undefined'&&selected.size&&!IA.gripsShown(selected.size,assist.prefs.gripObjLimit);   // 307
  $("stats").textContent=selected.size?`선택 ${selected.size.toLocaleString()}개 · 객체 ${total.toLocaleString()}개${gripHidden?` · 그립 숨김(${assist.prefs.gripObjLimit}개 넘음)`:''}`:`객체 ${total}개`;
}
/* ── ACAD200 영역 3 연결부. 판단은 input-assist.js 묶음(시험 있음), 여기서는 app.js 상태에 잇기만 한다.
   함수 선언만 둔다(시험이 app.js 일부를 잘라 돌릴 때 이 블록 밖 코드가 깨지지 않도록). ── */
// 308·309: 고른 객체의 그립(+폴리선 구간 가운데 그립). 그리기와 집기가 같은 목록을 쓴다.
function entityGrips(e){
  const base=(e.drawingSet&&typeof selectedWallGrips==='function'?selectedWallGrips(engine.doc,e):null)||G.editingGrips(e);
  return assist.prefs.gripHover?[...base,...IA.segmentGrips(e)]:base;
}
function gripsVisibleNow(){return IA.gripsShown(selected.size,assist.prefs.gripObjLimit);}
// 308: 선택·도면이 바뀔 때 한 번 색인, 클릭·호버는 커서 둘레만 질의. 한도(307)를 넘으면 null.
function gripIndexNow(){
  const index=assist.gripIndex;
  if(index.wallFn!==selectedWallGrips){index.invalidate();index.wallFn=selectedWallGrips;}
  return index.ensure(`${selectionRevision}:${sceneRevision}:${assist.prefs.gripHover?1:0}:${engine.doc.entities.length}`,()=>{
    const list=[];
    for(const entity of chosen()){if(layerMap().get(entity.layer)?.locked||entity.clip?.enabled)continue;for(const grip of entityGrips(entity))list.push({entity,grip});}
    return list;
  });
}
function gripHitAt(p,w,e){
  if(!w||!gripsVisibleNow())return null;
  return gripIndexNow().at(w,p,screen,scale,IA.gripPickRadiusPx(e?.pointerType||assist.lastPointerType));
}
// 308: 그립 그리기도 같은 색인에서 화면 안 그립만 꺼낸다(예전: 매 프레임 고른 객체의 그립 전부를 훑음).
function paintGrips(palette){
  for(const e of chosen())if(e.clip?.enabled&&!layerMap().get(e.layer)?.locked){
    drawEntity(ctx,{type:'polyline',closed:true,points:drag?.kind==='clip-grip'&&drag.id===e.id?drag.points:e.clip.points},screen,scale,palette.selection,1,true);
    for(const point of e.clip.points)paintGrip(screen(point),{kind:'clip'},palette,false,false);
  }
  const index=gripIndexNow(),a=world({x:-6,y:height+6}),b=world({x:width+6,y:-6});
  assist.hotGrips.sync(selectionRevision);
  for(const i of index.index?.query({minX:Math.min(a.x,b.x),minY:Math.min(a.y,b.y),maxX:Math.max(a.x,b.x),maxY:Math.max(a.y,b.y)})||[]){
    const {entity,grip}=index.list[i];if(entity.id===inlineTextEntityId)continue;
    paintGrip(screen(grip.point),grip,palette,grip.kind==='vertex'&&assist.hotGrips.has(entity.id,grip.index),gripMatches(assist.hoverGrip,entity,grip));
  }
}
function paintGrip(s,grip,palette,hot,hover){
  const half=grip.kind==='segment'?4:5;
  ctx.fillStyle=hot?'#ff4545':hover?palette.snap:grip.kind==='segment'?palette.gripEdge:palette.grip;ctx.strokeStyle=grip.kind==='segment'?palette.grip:palette.gripEdge;ctx.lineWidth=1;
  ctx.fillRect(s.x-half,s.y-half,half*2,half*2);ctx.strokeRect(s.x-half,s.y-half,half*2,half*2);
}
function sameGripHit(a,b){return a===b||(!!a&&!!b&&a.entity.id===b.entity.id&&a.grip.kind===b.grip.kind&&a.grip.index===b.grip.index&&a.grip.point.x===b.grip.point.x&&a.grip.point.y===b.grip.point.y);}
function gripMatches(hit,entity,grip){return !!hit&&hit.entity.id===entity.id&&hit.grip.kind===grip.kind&&hit.grip.index===grip.index&&hit.grip.point.x===grip.point.x&&hit.grip.point.y===grip.point.y;}
// 310·309: 끄는 그립의 명령 — 뜨거운 그립 묶음 → 구간·정점 확장 동작 → 기본 그립 명령 순.
function gripDragCommand(source,d,point){
  if(typeof assist==='undefined')return G.gripCommand(source,d.grip,point);
  assist.hotGrips.sync(selectionRevision);
  const hot=assist.hotGrips.command(d,point);if(hot){d.hotUsed=true;return hot;}
  return IA.extendedGripCommand(source,d.grip,point,d.op||'stretch')??G.gripCommand(source,d.grip,point);
}
// 312: 끌거나 늘리는 객체는 스냅 후보에서 뺀다(폴리선의 움직이지 않는 꼭짓점은 남김).
function dragSnapOptions(d){
  if(typeof assist==='undefined'||!d)return undefined;
  // 끄는 동안(같은 도면 리비전) 제외 묶음을 다시 만들지 않는다.
  if(d.snapOptionsCache&&d.snapOptionsCache.scene===sceneRevision)return d.snapOptionsCache.value;
  const value=dragSnapOptionsFresh(d);
  d.snapOptionsCache={scene:sceneRevision,value};
  return value;
}
function dragSnapOptionsFresh(d){
  const source=d.kind==='object-move'?null:entityMap().get(d.id)||null;
  let movingIndices=null;
  if(d.grip?.kind==='segment'&&source?.points)movingIndices=[d.grip.index,(d.grip.index+1)%source.points.length];
  else if(d.grip?.kind==='vertex'&&assist.hotGrips.has(d.id,d.grip.index))movingIndices=[...assist.hotGrips.map.get(d.id)];
  const exclusion=IA.dragSnapExclusion(movingIndices?{...d,movingIndices}:d,source);
  if(exclusion&&d.grip?.kind==='vertex'&&assist.hotGrips.has(d.id,d.grip.index))for(const id of assist.hotGrips.map.keys())exclusion.ids.add(id);
  return exclusion?{exclude:exclusion}:undefined;
}
function currentSnapOptions(){
  if(typeof assist==='undefined')return undefined;
  if(drag&&['entity-grip','object-move'].includes(drag.kind))return dragSnapOptions(drag);
  if(mode==='GRIP'&&params?.gripId&&params.op==='stretch'&&params.grip&&!params.grip.aiWall){params.snapTarget??={kind:'grip-mode',id:params.gripId,grip:params.grip};return dragSnapOptions(params.snapTarget);}
  return undefined;
}
// 303·309: 커서가 멈추면 집힐 객체를 한 번 집고(바뀔 때만 다시 그림), 그립 위면 그 그립을 강조.
function assistPointerMove(e,p){
  if(typeof assist==='undefined')return;
  if(e.pointerType)assist.lastPointerType=e.pointerType;
  const allowed=IA.hoverAllowed({mode,phase,busy,dragging:!!drag,buttons:e.buttons|0,pref:assist.prefs.selectionPreview,objectPick:objectPickCursor()});
  // 큰 도면에서 호버가 집기 색인을 처음 만들지 않게 — 색인이 준비됐을 때만(아니면 한가할 때 데워 둔다).
  const indexReady=nearby.objectsRevision===sceneRevision&&nearby.objectsGeneration===pickGeneration();
  if(allowed&&!indexReady)warmNearbyIndex();
  assist.hover.schedule(allowed&&indexReady,()=>rawCursor?pick(rawCursor)?.id??null:null,render,p);
  const grip=mode==='SELECT'&&phase==='idle'&&!drag&&assist.prefs.gripHover&&selected.size?gripHitAt(p,rawCursor,e):null;
  if(!sameGripHit(grip,assist.hoverGrip)){assist.hoverGrip=grip;render();}
}
// 303·304: 강조 그리기. 블록은 경계 상자만(큰 블록을 매 프레임 펼치지 않는다).
function paintAssistEntity(entity,color,dashed=true){
  if(entity.type==='block'||(entity.points?.length||0)>5000){const b=G.entitySpatialBounds?.(entity);if(!b)return;const a=screen({x:b.minX,y:b.maxY}),c=screen({x:b.maxX,y:b.minY});ctx.save();ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.setLineDash([6,4]);ctx.strokeRect(a.x,a.y,c.x-a.x,c.y-a.y);ctx.restore();return;}
  drawEntity(ctx,entity,screen,scale,color,2,dashed,true);
}
function paintHoverPreview(palette){
  if(typeof assist==='undefined'||drag)return;
  const id=assist.hover.id;if(id==null||selected.has(id))return;
  const entity=entityMap().get(id);if(entity)paintAssistEntity(entity,palette.selection);
}
function selectionBoxOf(d){const a=world(selectionAnchor(d)),b=world(d.current);return {minX:Math.min(a.x,b.x),minY:Math.min(a.y,b.y),maxX:Math.max(a.x,b.x),maxY:Math.max(a.y,b.y)};}
function windowPreviewAllowed(d){
  if(typeof assist==='undefined'||!assist.prefs.windowPreview||!d?.current||d.lasso||d.pendingHit)return false;
  if(!(mode==='SELECT'||phase==='select'))return false;
  if(!d.secondCorner&&!d.awaitingCorner&&d.press&&!d.press.dragging)return false;
  return G.dist(selectionAnchor(d),d.current)>=4;
}
// 304: 선택창을 끄는 동안 걸릴 객체(6ms 씩 나눠 계산, 2만 개 넘으면 생략)와 개수.
function paintWindowPreview(d,palette){
  if(!windowPreviewAllowed(d))return;
  const a=selectionAnchor(d),b=d.current,forced=params?.forceWindow,cross=forced?forced==='C':b.x<a.x,preview=assist.windowPreview,box=selectionBoxOf(d);
  // 끄는 동안은 상자가 80ms 멈출 때까지 기다린다 — 매 프레임 후보를 다시 뽑지 않는다.
  const key=IA.windowKey(box,cross),now=performance.now();
  if(d.previewKey!==key){d.previewKey=key;d.previewSince=now;}
  if(preview.key!==key&&now-d.previewSince<80){clearTimeout(paintWindowPreview.timer);paintWindowPreview.timer=setTimeout(render,90);return;}
  const done=preview.update(box,cross,boxCandidates,(entity,candidateBox,crossMode)=>IA.windowSelects(entity,candidateBox,crossMode,{G,crossing}));
  if(!done)render();
  let drawn=0;
  if(!preview.skipped)for(const id of preview.ids){if(drawn>=800)break;if(selected.has(id)&&!d.shift)continue;const entity=entityMap().get(id);if(entity){paintAssistEntity(entity,d.shift?'#ff4545':palette.selection);drawn++;}}
  const label=`${cross?'걸침':'창'} ${preview.skipped?'후보가 많아 미리보기 생략':preview.ids.length.toLocaleString()+(done?'':'…')+'개'}`;
  ctx.save();ctx.font='12px "Segoe UI", sans-serif';ctx.fillStyle=palette.muted;ctx.fillText(label,b.x+12,b.y+18);ctx.restore();
}
function windowPreviewResult(box,cross){return typeof assist!=='undefined'&&assist.prefs.windowPreview?assist.windowPreview.result(box,cross):null;}
// 302: 올가미 — 빈 곳에서 누른 채 끌기가 끌기로 판정되면 길을 모은다.
function assistLassoMove(e,p){
  if(typeof assist==='undefined'||!assist.prefs.lassoSelect||!drag||drag.kind!=='selection')return;
  if(!drag.lasso){
    if(drag.secondCorner||drag.awaitingCorner||drag.pendingHit||!drag.press||!(e.buttons&1)||!(mode==='SELECT'||phase==='select')||params?.forceWindow)return;
    if(!drag.press.update(e.timeStamp,p))return;
    drag.lasso=new IA.LassoPath(drag.startWorld||world(drag.start),selectionAnchor(drag));
  }
  drag.lasso.add(world(p),p);
}
function paintLasso(d,palette){
  const l=d.lasso,kind=l.effectiveKind,pts=[...l.points.map(screen),d.current];
  ctx.save();ctx.lineWidth=1.5;ctx.strokeStyle=kind==='CP'?palette.crossing:kind==='F'?palette.snap:palette.window;ctx.setLineDash(kind==='WP'?[]:[5,4]);
  ctx.beginPath();pts.forEach((q,i)=>i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y));if(kind!=='F'){ctx.closePath();ctx.fillStyle=kind==='CP'?'rgba(24,170,73,0.25)':'rgba(50,130,230,0.18)';ctx.fill();}ctx.stroke();
  ctx.setLineDash([]);ctx.font='12px "Segoe UI", sans-serif';ctx.fillStyle=palette.muted;ctx.fillText(`올가미 ${IA.LASSO_LABELS[kind]} · Space 로 바꾸기`,d.current.x+12,d.current.y+18);ctx.restore();
}
function finishLasso(l,remove){
  const kind=l.effectiveKind,poly=l.points;
  if(poly.length<(kind==='F'?2:3))return 0;
  const hits=IA.polygonSelectionHits(boxCandidates(IA.polygonBounds(poly)),kind,poly,G);
  if(remove)for(const e of hits)selected.delete(e.id);else selected.addMany(hits.map(e=>e.id));
  if(selected.size)previousSelection=[...selected];
  log(`올가미(${IA.LASSO_LABELS[kind]}) ${hits.length}개 ${remove?'뺌':'선택'}`);
  return hits.length;
}
// 301: 누르기마다 판정기 하나. 설정을 끄면 예전 거리 문턱을 쓴다.
function attachPress(e,p){
  if(typeof assist==='undefined'||!assist.prefs.pressClassifier||!drag||drag.press||drag.pointerId!==e.pointerId||drag.secondCorner)return;
  if(['selection','entity-grip','object-move'].includes(drag.kind))drag.press=IA.PressClassifier.forEvent(e,p);
}
// 324: SI(하나 고르면 끝).
function afterSelectionGesture(){
  if(typeof params==='undefined'||!params?.singleSelect||phase!=='select'||mode==='SELECT'||!selected.size||drag)return;
  params.singleSelect=false;safe(()=>finish());
}
// 319: 바쁜 동안 누른 클릭·Enter 는 줄을 세웠다가 끝나면 같은 처리기로 다시 보낸다(같은 도면 탭, 3초 안).
function queueBusyInput(e,w){
  if(typeof assist==='undefined'||!assist.prefs.typeAhead||e.button!==0||!w)return false;
  const ok=assist.queue.push({type:'click',world:{x:w.x,y:w.y},pointerId:e.pointerId,pointerType:e.pointerType||'mouse',shiftKey:!!e.shiftKey,ctrlKey:!!e.ctrlKey,metaKey:!!e.metaKey,altKey:!!e.altKey,tab:documents?.activeId??null});
  if(ok)assist.queue.whenIdle(()=>busy,replayQueuedInput,{isCurrent:item=>item.tab===(documents?.activeId??null)});
  return ok;
}
function queueBusySubmit(value){
  if(typeof assist==='undefined'||!assist.prefs.typeAhead)return false;
  const ok=assist.queue.push({type:'submit',value:String(value??''),keyboard:!!submit.keyboard,tab:documents?.activeId??null});
  if(ok)assist.queue.whenIdle(()=>busy,replayQueuedInput,{isCurrent:item=>item.tab===(documents?.activeId??null)});
  return ok;
}
function replayQueuedInput(item){
  if(item.type==='submit'){const input=$('coordinate');if(!input.value.trim()||input.value===item.value){input.value=item.value;submit.keyboard=item.keyboard;try{submit();}finally{submit.keyboard=false;}}return !busy;}
  const s=screen(item.world),r=canvas.getBoundingClientRect();
  const base={bubbles:true,cancelable:true,clientX:r.left+s.x,clientY:r.top+s.y,pointerId:item.pointerId,pointerType:item.pointerType,isPrimary:true,button:0,shiftKey:item.shiftKey,ctrlKey:item.ctrlKey,metaKey:item.metaKey,altKey:item.altKey};
  canvas.dispatchEvent(new PointerEvent('pointerdown',{...base,buttons:1}));
  canvas.dispatchEvent(new PointerEvent('pointerup',{...base,buttons:0}));
  return !busy;
}
// 320: 명령 중 오른쪽 단추를 길게 = 프롬프트 옵션 메뉴. 309: 그립 위 오른쪽 클릭 = 그립 메뉴.
function commandOptionMenuItems(){
  const items=[{label:'확인 (Enter)',key:'↵',run:()=>finish()},{label:'취소',key:'Esc',run:()=>cancelSelection()}];
  const options=IA.promptOptions(instruction());
  if(options.length)items.push('-',...options.map(o=>({label:o.label,key:o.key,run:typedOption(o.key)})));
  return items;
}
function gripMenuItems(hit){return IA.gripMenuOps(hit.entity,hit.grip).map(op=>({label:IA.GRIP_OP_LABELS[op],run:()=>startGripOp(hit,op)}));}
function startGripOp(hit,op){
  if(op==='remove-vertex'){execute(IA.extendedGripCommand(hit.entity,hit.grip,hit.grip.point,'remove-vertex'));return;}
  reset();mode='GRIP';phase='point';params={gripId:hit.entity.id,grip:hit.grip,op:'stretch',gripOp:op};points=[{...hit.grip.point}];updatePrompt();render();
}
// 321: 더블클릭 편집 표. 꺼져 있으면 고르기만 한다.
function doubleClickEdit(hit){
  const action=typeof assist==='undefined'?(hit.type==='text'?'text-inline':hit.type==='block'?'block-edit':'properties')
    :IA.doubleClickAction(hit,{enabled:assist.prefs.dblclkEdit,locked:!!layerMap().get(hit.layer)?.locked,blockEditing:typeof blockEdit!=='undefined'&&!!blockEdit});
  if(action==='none')return false;
  if(action==='text-inline')editTextInline(hit);
  else if(action==='block-edit'){if(typeof blockEdit!=='undefined'&&blockEdit)editProperties();else safe(()=>startBlockEdit());}
  else if(action.startsWith('command:'))run(action.slice(8));
  else if(typeof propertiesDock!=='undefined'&&propertiesDock&&['line','circle','arc','ellipse','spline','point','xline','ray'].includes(hit.type)&&!hit.parameters&&!hit.libraryCommand){if(propertiesDock.open)propertiesDock.notify(true);else propertiesDock.toggle(true);}   // 선·원 등: AutoCAD 처럼 오른쪽 특성 창(상세 편집은 창의 단추)
  else editProperties();
  return true;
}
// 313·302·305·319: 키 — Tab(스냅 후보 돌리기), Space(올가미 종류), Shift+Space(겹친 객체 미리보기 돌리기), Esc(입력 줄 비우기).
function assistKeyDown(e){
  if(typeof assist==='undefined'||e.isComposing||e.ctrlKey||e.metaKey||e.altKey||document.querySelector('dialog[open]'))return;
  if(e.key==='Escape'){assist.queue.clear();assist.snapCycle.clear();if(assist.hover.pinned){assist.hover.clear();render();}return;}
  if(e.key===' '&&drag?.kind==='selection'&&drag.lasso){
    e.preventDefault();e.stopImmediatePropagation();if(!e.repeat){const kind=drag.lasso.cycle();toast(`올가미 · ${IA.LASSO_LABELS[kind]}`);render();}return;
  }
  if(e.key===' '&&e.shiftKey&&rawCursor&&!drag&&((mode==='SELECT'&&phase==='idle')||phase==='select')&&assist.prefs.selectionPreview){
    const radius=Math.max(4,Math.min(30,num('pickbox-size',10)))/2/scale;
    const ids=nearby(rawCursor,radius).toReversed().filter(entity=>!layerMap().get(entity.layer)?.locked).map(entity=>({id:entity.id,d:pickDistance(entity,rawCursor,radius)})).filter(x=>x.d<radius).sort((a,b)=>a.d-b.d).map(x=>x.id);
    if(assist.hover.cycle(ids,screen(rawCursor))){e.preventDefault();e.stopImmediatePropagation();toast(`겹친 객체 ${ids.indexOf(assist.hover.id)+1}/${ids.length} · 클릭하면 이것을 고릅니다`);render();}
    return;
  }
  if(e.key==='Tab'&&!e.shiftKey&&rawCursor&&mode!=='SELECT'&&!objectPickCursor()&&$('osnap')?.checked&&!$('coordinate').value.trim()){
    const cycle=assist.snapCycle;
    if(!cycle.active){const list=[];snap(rawCursor,{...(currentSnapOptions()||{}),collect:list});if(cycle.start(rawCursor,list,IA.apertureRadiusPx(num('snap-tolerance',16),assist.lastPointerType)/scale)<2){cycle.clear();return;}}
    e.preventDefault();e.stopImmediatePropagation();
    const chosenCandidate=cycle.next();cursor=snap(rawCursor,currentSnapOptions());
    log(`스냅 후보 ${cycle.index+1}/${cycle.list.length}: ${chosenCandidate.label}`);render();
  }
}
let renderPending = false;
let frameWaiters=[];

// 마우스는 한 화면(1/60초) 사이에 이벤트를 여러 번(고속 마우스는 십여 번) 보낸다. 이벤트마다 스냅을 계산하면
// 무거운 도면에서 그 계산이 쌓여 커서·점 끌기가 늦게 따라온다. 스냅은 그리기 직전에 최신 위치로 한 번만 계산한다.
let pendingCursorSnap=false;
function flushCursorSnap(){
  if(!pendingCursorSnap)return;pendingCursorSnap=false;
  if(!rawCursor||drag)return;
  const pickOnly=objectPickCursor();
  cursor=pickOnly?{...rawCursor}:snap(rawCursor,typeof currentSnapOptions==='function'?currentSnapOptions():undefined);
  if(!pickOnly&&typeof assist!=='undefined'&&$('otrack')?.checked)assist.tracking.hover(cursor,render);   // 315 추적점 얻기
  $("position").textContent = `X ${fmt(cursor.x)} · Y ${fmt(cursor.y)}`;
}
let reviewSelectionRevision=-1;
function render() {
  if(typeof propertiesDock!=='undefined'&&propertiesDock)propertiesDock.notify();   // 열쇠(선택·도면 리비전) 비교만 한다. 바뀌었으면 잠깐 뒤 한 번 계산.
  if(typeof liveCheck!=='undefined'&&liveCheck&&reviewSelectionRevision!==selectionRevision){reviewSelectionRevision=selectionRevision;liveCheck.selectionChanged([...selected],entitiesById(engine.doc.entities,selected).map(e=>e.reviewObjectId).filter(Boolean));}
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {renderPending=false;try{if(typeof flushCursorSnap==='function')flushCursorSnap();paintFrame();const waiters=frameWaiters.splice(0);waiters.forEach(({resolve})=>resolve());}catch(error){const waiters=frameWaiters.splice(0);waiters.forEach(({reject})=>reject(error));throw error;}});
}
function waitForPaint(){return new Promise((resolve,reject)=>{frameWaiters.push({resolve,reject});render();});}
// Keep viewport culling separate from visible(): selection, fit and commands
// still need the full visible-layer drawing for medium-sized documents.
function viewportDrawingEntities() {
  const entities=visible();
  if(entities.length<1000||engine.doc.entities.length>50000)return entities;
  // Reuse the pick index, including its incremental edit updates. Panning and
  // zooming change only this query, not the shared-block display geometry.
  prepareNearbyIndexNow(entities);
  const a=world({x:-80,y:height+80}),b=world({x:width+80,y:-80});
  return nearby.objects.query({minX:a.x,minY:a.y,maxX:b.x,maxY:b.y});
}
// Reuse only a current, fully resolved cache. Never expand blocks merely to
// supply this hint, and never submit a cropped or simplified viewport cache.
function completeGpuDisplay() {
  // Large drawings cull visible() to the view, but their whole-document pick
  // set is exactly the complete display the GPU compiles (no cull, no LOD), so
  // one expansion of every shared block serves both.
  if(engine.doc.entities.length>50000)return typeof pickCandidates==='function'?{doc:engine.doc,revision:sceneRevision,entities:pickCandidates()}:null;
  if(visibleDoc!==engine.doc||visibleRevision!==sceneRevision||visibleScaleBucket!==0||visibleViewportKey!=='')return null;
  return {doc:visibleDoc,revision:visibleRevision,entities:visibleCache};
}
// 도면 뒤 배경 지도: 계획 탭이 그림과 아핀(도면 mm → 그림 화소)을 넘긴다. 도면마다 따로 두고(WeakMap),
// 지도가 없는 도면은 조회 한 번 말고는 비용이 없다. 화면이 그대로면 다시 그리지 않는다.
const backgroundMaps=new WeakMap();let basemapCanvas=null,basemapKey='';
function paintBasemap(){
  const map=backgroundMaps.get(engine.doc);
  if(!map){if(basemapKey&&basemapCanvas){basemapCanvas.getContext('2d').clearRect(0,0,basemapCanvas.width,basemapCanvas.height);basemapKey='';}return;}
  if(!map.img.complete||!map.img.naturalWidth)return;
  const key=[map.id,canvas.width,canvas.height,scale,origin.x,origin.y].join();if(key===basemapKey)return;basemapKey=key;
  if(!basemapCanvas){basemapCanvas=document.createElement('canvas');basemapCanvas.className='basemap-layer';basemapCanvas.setAttribute('aria-hidden','true');canvas.before(basemapCanvas);}
  if(basemapCanvas.width!==canvas.width||basemapCanvas.height!==canvas.height){basemapCanvas.width=canvas.width;basemapCanvas.height=canvas.height;}
  const c=basemapCanvas.getContext('2d'),r=canvas.width/width,[a,b,cc,d,e,f]=map.affine,det=a*d-b*cc;
  c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,basemapCanvas.width,basemapCanvas.height);
  // 화면 = 보기(mm) , 그림 = A(mm) → 화면 = 보기·A⁻¹(그림)
  c.setTransform(r*scale,0,0,-r*scale,r*origin.x,r*origin.y);
  c.transform(d/det,-b/det,-cc/det,a/det,(cc*f-d*e)/det,(b*e-a*f)/det);
  c.imageSmoothingQuality='high';
  // ACAD200 122: zoomed out, draw a prepared half/quarter... copy (mip) of a large
  // map instead of resampling the full image on every view change.
  const onScreen=r*scale/Math.sqrt(Math.abs(det)||1),level=onScreen>0&&onScreen<.5?Math.min(8,Math.floor(Math.log2(1/onScreen))):0;
  const mips=typeof basemapMips!=='undefined'?basemapMips:null,mip=level&&mips?mips.acquire(map.id,map.img,level):null;mips?.incrementAge();
  if(mip){c.scale(mip.scale,mip.scale);c.drawImage(mip.canvas,0,0);}else c.drawImage(map.img,0,0);
}
function paintFrame() {
  if (!width || !height) return;
  const quality=typeof displayQuality!=='undefined'?displayQuality:null;
  quality?.beginFrame({interactive:viewMoving||drag?.kind==='pan',doc:engine.doc});
  try{paintFrameInner();}finally{quality?.endFrame();}
}
// 사진 있는지는 도면 판마다 한 번 본다. visible() 을 부르지 않아 사진 없는 큰 도면의 GPU 설치를 기다리게 하지 않는다.
let imagePresenceDoc=null,imagePresenceRevision=-1,imagePresence=false;
function hasImages(){
  if(imagePresenceDoc!==engine.doc||imagePresenceRevision!==sceneRevision){imagePresence=engine.doc.entities.some(e=>e.type==='image');imagePresenceDoc=engine.doc;imagePresenceRevision=sceneRevision;}
  return imagePresence;
}
const imageRenderer=createImageRenderer({onReady:()=>{sceneKey=null;render();}});
function paintFrameInner() {
  if(typeof aiReveal!=='undefined'&&aiReveal){paintAIRevealFrame();return;}
  paintBasemap();
  if(typeof tabSwitchCover!=='undefined'&&tabSwitchCover){
    tabSwitchCover=false;const palette=getCanvasPalette();
    ctx.save();ctx.setTransform(canvas.width/width,0,0,canvas.width/width,0,0);ctx.fillStyle=palette.background;ctx.fillRect(0,0,width,height);
    ctx.fillStyle=palette.muted;ctx.font='14px "Segoe UI", sans-serif';ctx.textAlign='center';ctx.fillText('도면을 그리는 중…',width/2,height/2);ctx.restore();
    sceneKey=null;setTimeout(render,30);return;
  }
  placeInlineText?.();   // 글자 편집 칸이 열려 있으면 이번 화면의 글자 위치·크기에 맞춘다(바뀐 게 없으면 할 일 없음).
  const palette=getCanvasPalette();
  // 성능: 선택 집합·강조 집합을 펼치지 않는다. 선택은 리비전 번호로, 강조는 Set 교체 여부(참조 비교)로 판별한다.
  const key=JSON.stringify([sceneRevision,width,height,canvas.width,canvas.height,scale,origin.x,origin.y,$('grid').checked,num('spacing',100),engine.doc.limits,palette,selectionRevision,gpuView.key,inlineTextEntityId]);
  const highlights=liveCheck?.highlights||null;
  const gpuOptions={doc:engine.doc,revision:sceneRevision,edit:gpuEdit,width,height,scale,origin,pixelRatio:canvas.width/width,hiddenTextId:inlineTextEntityId,completeDisplay:completeGpuDisplay,moving:viewMoving||drag?.kind==='pan',sceneKey:documents?.activeId??null,lod:typeof displayQuality!=='undefined'?displayQuality.strategy({building:gpuView.buildPending,memoryPressure:gpuView.stats?.gpuMemoryPressure||0}):null};
  // Cached frames must still advance installation. Only completion invalidates
  // their pixels; selection is resolved once against the completed scene.
  if(key===sceneKey&&highlights===sceneHighlights&&gpuView.buildPending){
    gpuView.draw(ctx,gpuOptions);if(!gpuView.buildPending)sceneKey=null;
  }
  ctx.clearRect(0, 0, width, height);
  if(key===sceneKey&&highlights===sceneHighlights){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(sceneCanvas,0,0);ctx.restore();}else{
  if(hasImages())imageRenderer.draw(ctx,visible(),screen,scale,{width,height,background:palette.background});
  if(!waitingForGpuView()){
  if ($("grid").checked) {
    let s = Math.max(0.001, Math.min(1e9, num("spacing", 100))) * scale;
    while (s < 14) s *= 10;
    while (s > 160) s /= 10;
    ctx.fillStyle = palette.grid;
    for (let x = ((origin.x % s) + s) % s; x < width; x += s)
      for (let y = ((origin.y % s) + s) % s; y < height; y += s)
        ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  if(ucsIconOn())drawUcsIcon(ctx,origin,width,fitHeight(),palette.muted);
  const limits=engine.doc.limits;
  if(limits?.enabled){
    const a=screen({x:limits.minX,y:limits.maxY}),b=screen({x:limits.maxX,y:limits.minY});
    ctx.save();ctx.strokeStyle='#e5b85c';ctx.lineWidth=1;ctx.setLineDash([8,5]);ctx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);ctx.setLineDash([]);ctx.fillStyle='#e5b85c';ctx.font='11px Segoe UI';ctx.fillText('작업 영역',a.x+6,a.y+15);ctx.restore();
  }
  }
  // 성능: visible()이 이미 레이어 color/linetype/lineweight를 객체에 합쳐 주므로 레이어 선형 탐색을 하지 않는다.
  const gpuDrawn=gpuView.draw(ctx,gpuOptions);
  if(gpuDrawn&&!gpuView.stats.workerPending)gpuEdit=null;
  const selectionPending=gpuView.buildPending||waitingForGpuView();
  const frameEntities=gpuDrawn?(selectionPending?[]:selected.size||highlights?.size?visible().filter(e=>selected.has(e.id)||highlights?.has(e.id)):[]):viewportDrawingEntities();
  const drawingBox=gpuDrawn?{minX:(-4-origin.x)/scale,maxX:(width+4-origin.x)/scale,minY:(origin.y-height-4)/scale,maxY:(origin.y+4)/scale}:null;
  const gpuSelected=gpuDrawn&&!selectionPending?gpuView.drawSelection(ctx,frameEntities.filter(e=>e.id!==inlineTextEntityId),selected,highlights,scale,width,height):new Set();
  if(typeof displayQuality!=='undefined')displayQuality.beginObjects(ctx);   // ACAD200 111: tiny-block boxes are stroked together below
  for (const e of frameEntities) {
    if(e.id===inlineTextEntityId)continue;
    if(e.type==='image'&&!selected.has(e.id)&&!highlights?.has(e.id))continue;
    if(gpuSelected.has(e.id))continue;
    // Selection keeps the object's resolved color; width and grips mark the
    // selection so the overlap list's layer swatch does not contradict it.
    const color = highlights?.has(e.id) ? '#ff4545' : e._displayColor||e.color||layerMap().get(e.layer)?.color;
    drawEntity(
      ctx,
      e,
      screen,
      scale,
      color,
      selected.has(e.id)
        ? 2.3
        : screenLineweightPx(e._displayLineweight ?? e.lineweight ?? 0.25),
      false,highlights?.has(e.id),drawingBox,
    );
  }
  if(typeof displayQuality!=='undefined')displayQuality.endObjects(ctx);
  if(typeof blockEditOutside!=='undefined'&&blockEditOutside&&!selectionPending)paintBlockEditFocus(palette,drawingBox);
  // 성능: 팬/줌이 진행 중이면 다음 프레임 키가 반드시 달라져 캐시가 적중하지 않으므로 기록을 건너뛴다.
  // (6.0.14 A/B: GPU 작업 중 화면 기억을 끄면 탭 전환 뒤 큰 도면의 회전·축척이 0.12→0.4초로 느려져 되돌렸다.)
  if(drag?.kind==='pan'||viewMoving){sceneKey=null;sceneHighlights=null;}
  else{
   if(sceneCanvas.width!==canvas.width||sceneCanvas.height!==canvas.height){sceneCanvas.width=canvas.width;sceneCanvas.height=canvas.height;}
   else sceneCtx.clearRect(0,0,sceneCanvas.width,sceneCanvas.height);
   sceneCtx.drawImage(canvas,0,0);sceneKey=key;sceneHighlights=highlights;
  }
  }
  if(gpuView.buildPending||waitingForGpuView())return;
  tabletPad?.paint(ctx,screen,scale,drawEntity);
  if(typeof fieldRecordHighlight!=='undefined'&&fieldRecordHighlight){  // 시험은 이 함수만 떼어 돌린다(padOverlay 와 같은 막음)
   const p=screen(fieldRecordHighlight.at);ctx.save();ctx.strokeStyle='#ff5d5d';ctx.fillStyle='#ff5d5d';ctx.lineWidth=3;ctx.setLineDash([]);ctx.beginPath();ctx.arc(p.x,p.y,14,0,Math.PI*2);ctx.stroke();ctx.font='bold 16px sans-serif';ctx.fillText('핀 '+(fieldRecordHighlight.no??''),p.x+20,p.y-12);ctx.restore();
  }
  if(typeof padOverlay!=='undefined')for(const e of padOverlay)drawEntity(ctx,e,screen,scale,'#ff5d5d',2,true,true);
  for(const e of liveCheck?.overlay||[])drawEntity(ctx,e,screen,scale,e.color||'#ff4545',1,false,true);
  if(wallDetectionOverlay){
    const a=world({x:0,y:height}),b=world({x:width,y:0}),box={minX:a.x,minY:a.y,maxX:b.x,maxY:b.y};
    for(const index of wallDetectionOverlay){
      const bounds=index.bounds;
      if(index.paths&&bounds.minX>=box.minX&&bounds.minY>=box.minY&&bounds.maxX<=box.maxX&&bounds.maxY<=box.maxY){
        const zero=screen({x:0,y:0});ctx.save();ctx.translate(zero.x,zero.y);ctx.scale(scale,-scale);ctx.lineWidth=1.4/scale;
        for(const path of index.paths){ctx.strokeStyle=ctx.fillStyle=path.color;ctx.setLineDash(path.dashed?[6/scale,4/scale]:[]);ctx.globalAlpha=.22;ctx.fill(path.fill);ctx.globalAlpha=1;ctx.stroke(path.stroke);}ctx.restore();
      }else for(const e of index.query(box))drawEntity(ctx,e,screen,scale,e.color,1.4,false,true,drawingBox);
    }
  }
  for (const e of draft())
    drawEntity(ctx, e, screen, scale, e.type==='dimension'?'#9dcbe0':palette.draft, 1.4, e.type!=='dimension', e.type==='dimension');
  if(typeof drawTranslateSnapshot==='function')drawTranslateSnapshot(palette.draft);
  if(typeof drawMatrixPreview==='function')drawMatrixPreview(palette.draft);
  const centerlines=engine.doc.drawingSets?wallCenterlines(engine.doc.drawingSets):[];
  if(centerlines.length && engine.doc.layers.find((l)=>l.name==='A-WALL-CENTER-NOPLOT')?.visible!==false){
    ctx.save();ctx.strokeStyle='#9dcbe0';ctx.lineWidth=1;ctx.setLineDash([12,3,2,3]);
    for(const line of centerlines){const [a,b]=line.map(screen);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
    ctx.restore();
  }
  const assistOn=typeof assist!=='undefined';
  if(assistOn)paintHoverPreview(palette);   // 303
  // 307: 고른 객체가 한도(기본 100)를 넘으면 그립을 그리지 않는다. 309: 호버 그립은 다른 색, 구간 가운데 그립은 작게. 310: 뜨거운 그립은 빨강.
  if(assistOn){if(selected.size&&gripsVisibleNow())paintGrips(palette);}
  else for(const e of chosen()){
    if(e.id===inlineTextEntityId)continue;
    if(layerMap().get(e.layer)?.locked)continue;
    if(e.clip?.enabled)drawEntity(ctx,{type:'polyline',closed:true,points:drag?.kind==='clip-grip'&&drag.id===e.id?drag.points:e.clip.points},screen,scale,palette.selection,1,true);
    for(const p of (e.clip?.enabled?e.clip.points:((e.drawingSet?selectedWallGrips(engine.doc,e):null) || G.editingGrips(e)).map(g=>g.point))){
      const s=screen(p);if(s.x<-6||s.y<-6||s.x>width+6||s.y>height+6)continue;
      ctx.fillStyle=palette.grip;ctx.strokeStyle=palette.gripEdge;ctx.lineWidth=1;
      ctx.fillRect(s.x-5,s.y-5,10,10);ctx.strokeRect(s.x-5,s.y-5,10,10);
    }
  }
  const windowDrag=drag?.kind==="selection"?drag:drag?.kind==='pan'&&drag.suspended?.kind==="selection"&&drag.suspended.awaitingCorner?{...drag.suspended,current:drag.last}:null;
  if(assistOn&&windowDrag?.lasso&&windowDrag.current)paintLasso(windowDrag,palette);   // 302
  else if(assistOn&&windowDrag?.current)paintWindowPreview(windowDrag,palette);       // 304
  if (windowDrag?.current&&!windowDrag.lasso) {
    const a = windowDrag.startWorld?screen(windowDrag.startWorld):windowDrag.start,
      b = windowDrag.current;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = b.x < a.x ? palette.crossing : palette.window;
    ctx.fillStyle = b.x < a.x ? "rgba(24,170,73,0.38)" : "rgba(50,130,230,0.25)";
    ctx.setLineDash(b.x < a.x ? [5, 4] : []);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.setLineDash([]);
    ctx.restore();
  }
  let cursorTipBottom=null;   // 커서 옆 길이·각도 안내의 아래 끝 — 명령 이름 표시를 그 밑으로 내린다(겹침 방지)
  if (cursor) {
    const p = screen(cursor);
    ctx.strokeStyle = cursor.snapped ? palette.snap : palette.cursor;
    ctx.lineWidth = 1;
    const pickBox=objectPickCursor();
    if(pickBox){const size=Math.max(4,Math.min(30,num('pickbox-size',10)));ctx.strokeRect(p.x-size/2,p.y-size/2,size,size);}
    if(!pickBox||idleSelectionCrosshair()){
    const arm=Math.max(4,Math.max(width,height)*Math.max(1,Math.min(100,num('crosshair-size',5)))/200);
    ctx.beginPath();
    ctx.moveTo(p.x - arm, p.y);
    ctx.lineTo(p.x + arm, p.y);
    ctx.moveTo(p.x, p.y - arm);
    ctx.lineTo(p.x, p.y + arm);
    ctx.stroke();
    }
    if(assistOn&&!pickBox&&$('otrack')?.checked&&(cursor.tracking||assist.tracking.points.length))IA.drawObjectTracking(ctx,screen,{points:assist.tracking.points,tracking:cursor.tracking,cursor,color:palette.snap});   // 315
    if(cursor.polar&&!cursor.snapped&&!pickBox){
      const b=screen(cursor.polar.base),dir={x:Math.cos(cursor.polar.angle*Math.PI/180),y:-Math.sin(cursor.polar.angle*Math.PI/180)},far=Math.hypot(width,height);
      ctx.save();ctx.strokeStyle=palette.snap;ctx.lineWidth=1;ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x+dir.x*far,b.y+dir.y*far);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle=palette.snap;ctx.fillText(`극좌표: ${fmt(G.dist(cursor.polar.base,cursor))} < ${fmt(cursor.polar.angle)}°`,p.x+15,p.y-12);ctx.restore();
    }
    if (cursor.snapped&&!pickBox) {
      const marker=screen(cursor);
      ctx.save();ctx.lineWidth=2;ctx.beginPath();
      const x=marker.x,y=marker.y,r=6;
      if(cursor.label==='중점'){ctx.moveTo(x,y-r);ctx.lineTo(x+r,y+r);ctx.lineTo(x-r,y+r);ctx.closePath();}
      else if(cursor.label==='중심'){ctx.arc(x,y,r,0,Math.PI*2);}
      else if(cursor.label.includes('교차점')){ctx.moveTo(x-r,y-r);ctx.lineTo(x+r,y+r);ctx.moveTo(x+r,y-r);ctx.lineTo(x-r,y+r);}
      else if(cursor.label==='사분점'){ctx.moveTo(x,y-r);ctx.lineTo(x+r,y);ctx.lineTo(x,y+r);ctx.lineTo(x-r,y);ctx.closePath();}
      else if(cursor.label==='근처점'){ctx.moveTo(x-r,y-r);ctx.lineTo(x+r,y-r);ctx.lineTo(x-r,y+r);ctx.lineTo(x+r,y+r);ctx.closePath();}
      else ctx.rect(x-r,y-r,r*2,r*2);
      ctx.stroke();ctx.restore();
      ctx.fillStyle = palette.snap;
      ctx.fillText(cursor.label, marker.x + 15, marker.y - 12);
    }
    if(points.length&&dynamicInputReady()){
      const base=params.fromBase??points.at(-1),typed=$('coordinate').value.trim(),locked=params.dynLength>0;
      const len=locked?fmt(params.dynLength):(typed&&Number.isFinite(Number(typed))?typed:fmt(G.dist(base,cursor))),ang=locked?(typed||fmt(((G.angle(G.sub(cursor,base))%360)+360)%360)):fmt(((G.angle(G.sub(cursor,base))%360)+360)%360);
      ctx.save();ctx.font='11px "Malgun Gothic", sans-serif';const text=`${typeof assist!=='undefined'?(assist.prefs.dynPiCoords!==1?'상대 · ':'절대 · '):''}길이 ${len}${locked?' 🔒':''}  ·  각도 ${ang}°  (Tab)`,w=ctx.measureText(text).width+12,x=Math.min(p.x+18,width-w-4),y=Math.min(p.y+26,height-22);
      ctx.fillStyle=palette.hintBackground;ctx.fillRect(x,y,w,18);ctx.strokeStyle=palette.hintBorder;ctx.strokeRect(x,y,w,18);ctx.fillStyle=palette.hintText;ctx.textBaseline='middle';ctx.fillText(text,x+6,y+9);ctx.restore();cursorTipBottom=y+18;
    }
    else if (points.length) {
      ctx.fillStyle = palette.measure;
      ctx.fillText(
        fmt(mode==='STRETCH'&&$('coordinate').value.trim()&&Number.isFinite(Number($('coordinate').value))?Math.abs(Number($('coordinate').value)):G.dist(points.at(-1), cursor)) + " mm",
        p.x + 15,
        p.y + 20,
      );
      cursorTipBottom=p.y+24;
    }
  }
  const hintPoint=cursor||lastDrawingPointer;
  const typedHint=$('coordinate').value.trim();
  // 카드가 점·객체를 받는 동안(PICKPATH·PICKENTITY)에는 내부 이름 대신 부른 명령 이름을 보인다 (A37)
  const hintCommand=mode==='SELECT'?(typedHint?resolveCommand(typedHint,settings):null):['PICKPATH','PICKENTITY'].includes(mode)?(lastCommand||null):mode==='PLOTWINDOW'?(params?.windowPrompt||INTERNAL_MODE_LABELS.PLOTWINDOW):mode;
  if(hintPoint && hintCommand){
    const p=screen(hintPoint);ctx.save();ctx.font='10px "Malgun Gothic", sans-serif';
    const text=hintCommand,w=Math.min(width-12,ctx.measureText(text).width+12),x=Math.max(6,Math.min(p.x+28,width-w-6)),y=Math.max(6,Math.min(cursorTipBottom!==null?cursorTipBottom+4:p.y+28,height-26));
    ctx.fillStyle=palette.hintBackground;ctx.fillRect(x,y,w,20);ctx.strokeStyle=palette.hintBorder;ctx.strokeRect(x,y,w,20);ctx.fillStyle=palette.hintText;ctx.textBaseline='middle';ctx.fillText(text,x+6,y+10,w-12);ctx.restore();
  }
  $("zoom").textContent = Math.round((scale / 0.1) * 100) + "%";
}
function instruction() {
 if(params?.dynLength>0&&phase==='point')return `각도 입력 · 길이 ${fmt(params.dynLength)} 고정 · Enter`;
 if(mode==='EYEPOINT')return params.prompt||'자리 지정 · Esc 취소';
 if(mode==='PLOTWINDOW'){const what=params?.windowPrompt||'출력 영역';return points.length?what+'의 반대쪽 모서리 지정 · Esc 취소':what+'의 첫 모서리 지정 · Esc 취소';}
 if(mode==='PICKENTITY')return params.prompt||'객체를 클릭하세요 · Esc 취소';
 if(mode==='PICKPATH')return (params.prompt||'점을 이어 찍으세요')+(points.length?` · ${points.length}점`:'');
 if(mode==='WALL'&&phase==='wall-center-pick')return '벽 · 도면의 기존 중심선 클릭 · 빈 곳은 생성 안 함 · Esc 종료';
 if(mode==='HATCH'&&phase==='hatch-inside')return (params.hatchStyle?(params.hatchStyle.separate?'해치 추가 · 다른 닫힌 영역 안쪽 클릭 · Enter·Esc 종료':'같은 해치에 영역 더하기 · 다른 닫힌 영역 안쪽 클릭 · Enter·Esc 종료'):'해치 · 닫힌 영역 안쪽 클릭 → 무늬·색상·스케일 선택 · Esc 취소')+' 또는 [객체 선택(S)/원점(O)/연관(A)/섬(I)/간격 허용(G)/설정(T)]'+hatchOptionStatus();
 if(mode==='HATCH'&&phase==='hatch-origin')return `해치 원점 지정 <${run.hatchOrigin?fmt(run.hatchOrigin.x)+','+fmt(run.hatchOrigin.y):'기본 0,0'}> · 클릭 또는 X,Y · D 기본값 · Enter 그대로`;
 if(mode==='HATCH'&&phase==='hatch-gap')return `간격 허용 값 입력(0~5000 도면 단위) <${fmt(Number(run.hatchGapTolerance)||0)}> · 이 길이 이하로 끊긴 경계는 이어서 찾습니다`;
 if(mode==='HATCH'&&phase==='select'&&params.hatchSelect)return hatchSelectPrompt();
 if(mode==='WOT')return '개구부: 평행 벽선 두 개 또는 벽 하나 선택 → Enter';
  if(['COPYCLIP','CUTCLIP'].includes(mode)&&phase==='select')return (mode==='CUTCLIP'?'잘라낼':'복사할')+' 객체 선택 · 클릭·드래그 후 Enter 또는 우클릭';
  if(mode==='XCLIP')return phase==='select'?'XCLIP: 블록 선택 후 Space':params.clipPolygon?'다각형 꼭짓점 클릭 · Space 완료 · U 마지막 점 취소':points.length?'표시할 사각형의 반대쪽 모서리':'첫 모서리 · P 다각형 / I 반전 / OFF 해제 / ON 켜기 / D 삭제';

  if(mode==='INSULATION')return phase==='insulation-thickness'?`단열재 두께 <100> mm · ${params.sourceIds?.length?params.sourceIds.length+'개 선택 경로 변환':'새 경로 그리기'}`:phase==='insulation-select'?'변환할 선·폴리선·호·원 클릭 · Esc 취소':`단열재 ${params.depth} mm · 점을 이어 찍기 · S 기존 선 선택 · L 왼쪽/R 오른쪽/M 중심 · U 한 점 취소 · C 닫기 · Space 완료`;

  if(mode==='AREA' && phase==='area-label')return `${params.areaText} · 문자 위치 지정`;
  if(mode==='AHM')return points.length?'구적 경계점을 계속 찍고 Enter/Space로 완료 · U 마지막 점 취소 · Esc 종료':'폐합 객체를 클릭하거나 구적 경계의 첫 점을 찍으세요';
  if (mode === "ZOOM") return phase==='zoom-window'?'ZOOM: 확대할 영역 드래그':phase==='zoom-center'?'ZOOM: 화면 가운데로 둘 점 지정':'윈도우 구석 지정 또는 [전체(A)/중심(C)/범위(E)/이전(P)/윈도우(W)/객체(O)] 또는 배율(2X)';
  if(mode==='ARCHPLACE')return `${params.label} · 위치 클릭으로 배치 · 반복 배치 가능 · Esc 종료`;
  if(mode==='PAN')return 'PAN: 왼쪽 버튼으로 화면 이동 · Esc/Enter 종료';
  if(mode==='POINT'||mode==='ID')return mode==='POINT'?'점 위치 지정 · Esc 종료':'좌표를 조회할 점 지정';
  if(mode==='GRIP'&&params.gripBasePending)return `** ${GRIP_LABELS[params.op]} ** 기준점 지정`;
  if(mode==='GRIP')return `** ${GRIP_LABELS[params.op]}${params.gripCopy?' (복사)':''} ** 점 지정 또는 [기준점(B)/복사(C)/명령 취소(U)/종료(X)] · 숫자=${params.op==='rotate'?'각도':params.op==='scale'?'비율':'거리'} · Space 다음(${GRIP_LABELS[GRIP_OPS[(GRIP_OPS.indexOf(params.op)+1)%GRIP_OPS.length]]}) · Esc 취소`;
  if(mode==='XLINE'&&params.bisect)return ['각도 꼭짓점 지정','각도 시작점 지정','각도 끝점 지정 · Enter 종료'][Math.min(points.length,2)];
  if(mode==='XLINE'&&phase==='xline-offset-dist')return `간격띄우기 거리 또는 [통과(T)] <${run.xlineOffset==null?'T':run.xlineOffset==='T'?'통과':fmt(run.xlineOffset)}>`;
  if(mode==='XLINE'&&phase==='xline-offset-pick')return '선 객체 선택 · Enter 종료';
  if(mode==='XLINE'&&phase==='xline-offset-side')return params.xlineOffset==='T'?'통과점 지정':'간격띄울 쪽 지정';
  if(mode==='XLINE')return phase==='xline-angle'?'구성선 각도 입력':params.xlineMode&&params.xlineMode!=='B'?'통과점 지정 · Enter 종료':points.length?'통과점 지정 · Enter 종료':'점 지정 또는 [수평(H)/수직(V)/각도(A)]';
  if(mode==='RAY')return points.length?'통과점 지정 · Enter 종료':'시작점 지정';
  if(mode==='SPLINE')return points.length?`다음 점 입력 또는 [닫기(C)/명령 취소(U)] · Enter 완료 (${points.length}점)`:'첫 번째 점 지정';
  if(mode==='REVCLOUD')return phase==='revcloud-arc'?`호 길이 지정 <${fmt(cloudArc())}>`:params.cloudObject?'구름으로 바꿀 닫힌 객체 선택':params.cloudFreehand?(points.length?`커서를 경계를 따라 움직이세요 · 첫 점 가까이 오면 닫힘 · Enter 닫기 (${points.length}점)`:'프리핸드 구름의 첫 점 지정'):params.cloudPolygon?(points.length?`다음 점 지정 · Enter 닫기 (${points.length}점)`:'다각형 구름의 첫 점 지정'):points.length?'반대 구석 지정':`첫 번째 구석점 지정 또는 [호 길이(A)/객체(O)/다각형(P)/프리핸드(F)] · 호 길이 ${fmt(cloudArc())}${run.revcloudArc?'':' (화면 크기에 맞춘 값)'}`;
  if(mode==='BOUNDARY')return '내부 점 선택 · Enter 종료';
  if(['DIMLINEAR','DIMALIGNED','DIMRADIUS','DIMDIAMETER'].includes(mode)&&phase==='dim-text')return '치수 문자 입력 (<> = 측정값)';
  if(['DIMLINEAR','DIMALIGNED','DIMRADIUS','DIMDIAMETER'].includes(mode)&&phase==='dim-mtext')return '여러 줄 치수 문자 입력 (\\P = 줄바꿈, <> = 측정값)';
  if(phase==='dim-text-angle')return '치수 문자 각도 지정';
  if(phase==='dim-rotation')return '회전 치수선 각도 지정';
  if(['DIMCONTINUE','DIMBASELINE'].includes(mode))return phase==='dim-pick'?`${mode==='DIMCONTINUE'?'연속':'기준'} 치수 선택`:'두 번째 치수보조선 원점 지정 · Enter 종료';
  if(mode==='DONUT')return phase==='donut-inner'?`도넛의 내부 지름 지정 <${fmt(run.donut?.inner??10)}>`:phase==='donut-outer'?`도넛의 외부 지름 지정 <${fmt(run.donut?.outer??100)}>`:'도넛의 중심 지정 · Enter 종료';
  if(['DIVIDE','MEASURE'].includes(mode)&&phase==='number')return (mode==='DIVIDE'?'세그먼트의 개수 입력':'세그먼트의 길이 지정')+(params.divideBlock?` · 블록 ${params.divideBlock.name}${params.divideBlock.align?' 정렬':''}`:' 또는 [블록(B)]');
  if(mode==='POLYGON')return phase==='polygon-sides'?`다각형 변 개수 <${run.polygonSides||4}>`:phase==='polygon-ic'?'옵션 입력 [원에 내접(I)/원에 외접(C)] <I>':params.polygonEdge?(points.length?'모서리의 두 번째 끝점 지정':'모서리의 첫 번째 끝점 지정'):points.length?`원의 반지름 지정(${params.circumscribed?'외접':'내접'}) · 숫자 또는 클릭`:'다각형 중심점 지정 또는 [모서리(E)]';
  if(mode==='PDFIMPORT')return phase==='pdf-page'?`PDF 쪽 번호 입력 <1> · ${params.pdfName||''}`:phase==='pdf-scale'?'축척 입력 <1> (1 = PDF 실제 크기, 1pt = 0.3528 mm)':phase==='pdf-loading'?'PDF 읽는 중…':'삽입점 지정 (PDF 쪽 왼쪽 아래 기준) · Esc 취소';
  if(mode==='PASTECLIP')return '붙여넣을 기준점 지정';
  if(mode==='PLANPLACE')return `${params.planPlace?.title||'계획안'}을 놓을 자리 클릭 (왼쪽 아래 기준) · Esc 취소`;
  if(mode==='MATCHPROP')return (params.source?'대상 객체 선택(클릭하면 바로 적용, 선택창은 Enter 로 적용) 또는 [설정(S)] · Enter 종료':'원본 객체 선택')+(run.matchFlags&&run.matchFlags.length<S4.ALL_MATCH_FLAGS.length?' · '+S4.matchSettingsLine(run.matchFlags):'');
  if (busy) return "파일 변환 중입니다. 작업이 끝나면 안내합니다.";
  if (phase === "window")
    return `STRETCH: 늘릴 끝점을 사각 선택 (${selected.size}개) · Space/Enter 선택 완료 · Shift 제외`;
  if (mode === "STRETCH")
    return phase==='stretch-displacement' ? `변위 X,Y 입력 <${run.lastStretch?`${fmt(run.lastStretch.x)},${fmt(run.lastStretch.y)}`:'0,0'}>` : points.length ? "방향 지정 → 거리 입력 → Space/Enter · F8 직교 · 클릭으로도 확정" : "기준점 지정 또는 [변위(D)] <변위>";
  if (["FILLET", "CHAMFER"].includes(mode)) return cornerPrompt();
  if (phase === "select")
    return mode === 'ERASE' ? 'ERASE' : `${mode}: 클릭·드래그로 선택 추가 (${selected.size}개) · Space/Enter 확정 · Shift 선택 제외`;
  const n = points.length;
  if (mode === "ELLIPSE")
    return params.ellipseDraft?(params.ellipseStart==null?"타원 호의 시작 각도 지정(장축 기준, 점 또는 도)":`타원 호의 끝 각도 지정 (시작 ${fmt(params.ellipseStart)}°)`):n===2&&params.ellipseRotation?"장축 둘레로 회전 각도 지정(0~89.4)":(params.ellipseCenter?["타원의 중심 지정", "축의 끝점 지정", "다른 축으로 거리 지정 또는 [회전(R)]"]:[params.ellipseArc?"타원 호의 축 끝점 지정 또는 [중심(C)]":"타원의 축 끝점 지정 또는 [호(A)/중심(C)]", "축의 다른 끝점 지정", "다른 축으로 거리 지정 또는 [회전(R)]"])[n];
  const text = {
    SELECT: "",
    LINE: n ? "끝점 또는 @길이<각도 · Enter로 종료" : "선의 시작점",
    PLINE: phase==='pline-arc' ? "호의 끝점 지정 또는 [각도(A)/중심(CE)/닫기(CL)/방향(D)/반폭(H)/선(L)/반지름(R)/두 번째 점(S)/명령 취소(U)/폭(W)]" : phase==='pline-arc-center' ? "호의 중심점 지정" : phase==='pline-arc-radius' ? `호의 반지름 지정 <${fmt(run.plineArcRadius??1000)}>` : phase==='pline-arc-angle' ? `사이각 지정(반시계 +) <${fmt(run.plineArcAngle??90)}>` : phase==='pline-arc-dir' ? "호 시작 방향 지정" : phase==='pline-arc-cend' ? "호의 끝점 지정(중심 기준)" : phase==='pline-arc-rend' ? "호의 끝점 지정(반지름)" : phase==='pline-arc-aend' ? "호의 끝점 지정(사이각)" : phase==='pline-arc-dend' ? "호의 끝점 지정(방향)" : phase==='pline-arc-mid' ? "호의 두 번째 점 지정" : phase==='pline-arc-end' ? "호의 끝점 지정" : phase==='pline-length' ? (params.plineValue==='width'||params.plineValue==='halfwidth' ? `${params.plineWidthStart===undefined?'시작':'끝'} ${params.plineValue==='halfwidth'?'반폭':'폭'} <${(params.plineWidthStart===undefined?(params.plineWidth??run.plineWidth??0):params.plineWidthStart)/(params.plineValue==='halfwidth'?2:1)}> · Enter 그대로` : "선분 길이 입력") : n ? "다음 점 · A 호 / H 반폭 / L 길이 / W 폭 / U 취소 / C 닫기" : "폴리선 시작점",
    RECTANGLE: phase==='rect-chamfer1' ? `첫 번째 모따기 거리 <${fmt(run.rectChamfer?.[0]||0)}>` : phase==='rect-chamfer2' ? `두 번째 모따기 거리 <${fmt(run.rectChamfer?.[1]??run.rectChamfer?.[0]??0)}>` : phase==='rect-fillet' ? `모깎기 반지름 <${fmt(run.rectFillet||0)}>` : phase==='rect-linewidth' ? `선 폭 <${fmt(run.rectLineWidth||0)}>` : phase==='rect-area' ? `면적 입력 <${fmt(run.rectArea||100000)}>` : phase==='rect-area-lw' ? '[길이(L)/폭(W)] 기준으로 계산 <L>' : phase==='rect-area-value' ? `직사각형의 ${params.rectAreaBy==='W'?'폭':'길이'} 입력` : phase==='rect-length' ? `직사각형의 길이 지정 <${fmt(run.rectDims?.length||0)}>` : phase==='rect-width' ? `직사각형의 폭 지정 <${fmt(run.rectDims?.width||0)}>` : phase==='rect-rotation' ? `회전 각도 지정 <${fmt(run.rectRotation||0)}> · 숫자 또는 점` : n&&params.rectDims?.width!=null ? '사각형이 놓일 쪽 클릭' : n ? (!params.rectWidth&&!params.rectSquare?'다른 구석점 지정 또는 [치수(D)/회전(R)] · ':'')+(params.rectWidth!=null?`세로 (커서 방향 ${params.rectSign?.x<0?'←':'→'} 가로 ${fmt(params.rectWidth)}) · 숫자 입력`:params.rectSquare?"정사각형 한 변 (커서 방향) · 숫자 또는 점":"반대 꼭짓점 · @폭,높이 · 숫자 = 가로(커서 방향) · Q 정사각형") : `첫 번째 구석점 지정 또는 [모따기(C)/모깎기(F)/폭(W)]${rectStyleLabel()}`,
    CIRCLE: params.circleMode==='TTR' ? (params.ttr?.length<2?`원의 ${params.ttr?.length?'두':'첫'} 번째 접점이 놓일 객체 지정`:`원의 반지름 지정 <${fmt(run.lastCircleRadius||0)}>`) : params.circleMode ? `${params.circleMode==='2P'?'지름 끝점':'원 위의 점'} ${(params.circlePoints?.length||0)+1}` : n ? `${params.diameter?'지름':'반지름'} 지정${params.diameter?'':' 또는 [지름(D)]'}${run.lastCircleRadius?` <${fmt(params.diameter?run.lastCircleRadius*2:run.lastCircleRadius)}>`:''}` : "원 중심점 지정 또는 [3점(3P)/2점(2P)/접선 접선 반지름(T)]",
    ARC: arcPrompt(n),
    // 여러 객체를 옮길 때는 개수를 앞에 보인다(글자 하나만 고른 줄 알았는데 주변이 같이 끌려오는 혼동 방지).
    COPY: (selected.size>1?`객체 ${selected.size.toLocaleString()}개 · `:"")+(phase==='copy-array' ? "배열할 항목 수 입력" : n ? (params.arrayCount?`두 번째 점 지정 또는 [맞춤(F)] · 항목 ${params.arrayCount}개${params.arrayFit?' 맞춤':''}`:params.copied?"두 번째 점 지정 또는 [배열(A)/종료(E)/명령 취소(U)] <종료>":"두 번째 점 지정 또는 [배열(A)] <첫 번째 점을 변위로 사용>") : "복사 기준점"+(lastDisplacement?` · Enter/P = 이전 @${coordText(lastDisplacement.dx)},${coordText(lastDisplacement.dy)}`:'')),
    MOVE: (selected.size>1?`객체 ${selected.size.toLocaleString()}개 · `:"")+(n ? "두 번째 점 지정 또는 <첫 번째 점을 변위로 사용>" : "이동 기준점"+(lastDisplacement?` · Enter/P = 이전 @${coordText(lastDisplacement.dx)},${coordText(lastDisplacement.dy)}`:'')),
    ROTATE: !n ? "회전 기준점" : !params.rotateRef ? `회전 각도 지정 또는 [복사(C)/참조(R)] <${fmt(run.rotateAngle||0)}>${params.copyMode?' · 복사 켬':''}` : ({ref1:`참조: 지금 선의 첫 끝점 클릭 · 각도 숫자 · L 선 선택 <${fmt(run.rotateRefAngle||0)}>`,ref2:"참조: 둘째 끝점 클릭","ref-line":"지금 각도로 쓸 선 클릭",new:"새 각도: 숫자(예 0·90) · 방향 점 클릭 · L 맞출 선 선택","new-line":"맞출 선 클릭"})[params.rotateRef.stage],
    SCALE: !n ? "축척 기준점" : !params.scaleRef ? `축척 비율 지정 또는 [복사(C)/참조(R)] <${fmt(run.scaleFactor||1)}>${params.copyMode?' · 복사 켬':''}` : ({ref1:`참조 길이: 숫자 또는 첫 점${run.scaleRefLength?` <${fmt(run.scaleRefLength)}>`:''}`,ref2:'참조 길이: 둘째 점',new:'새 길이: 숫자 또는 기준점에서 점 클릭 또는 [점(P)]',new1:'새 길이: 첫 점',new2:'새 길이: 둘째 점'})[params.scaleRef.stage],
    MIRROR: phase==='mirror-erase' ? "원본 객체를 지우시겠습니까? [예(Y)/아니오(N)] <N>" : n ? "대칭선의 두 번째 점" : "대칭선의 첫 번째 점",
    OFFSET: phase === "number" ? `간격띄우기 거리 지정 또는 [통과점(T)/지우기(E)/레이어(L)/모서리(G)] <${run.offsetDistance?fmt(run.offsetDistance):'통과점'}> (원본 지우기=${run.offsetErase?'예':'아니오'}, 레이어=${run.offsetLayer==='C'?'현재':'원본'}, 모서리=${['연장','호','모따기'][S4.editVar('OFFSETGAPTYPE')]})` : phase === "offset-erase" ? `간격띄우기 후 원본을 지우시겠습니까? [예(Y)/아니오(N)] <${run.offsetErase?'Y':'N'}>` : phase === "offset-layer" ? `간격띄우기 객체의 레이어 [현재(C)/원본(S)] <${run.offsetLayer==='C'?'C':'S'}>` : params.through&&phase!=='offset-object' ? "통과점 지정 또는 [종료(E)/다중(M)/명령 취소(U)]" : phase === "offset-object" ? "간격띄우기할 객체 선택 또는 [종료(E)/명령 취소(U)] · Enter 종료" : `간격띄울 쪽의 점 지정 또는 [종료(E)/다중(M)/명령 취소(U)]${params.offsetMultiple?' · 다중':''}`,
    TRIM: params.trimErase ? "지울 객체 선택 · Enter 로 자르기로 돌아감" : params.fencePoints ? (params.fencePoints.length?"울타리 끝점 지정":"울타리 첫 점 지정") : `${params.quickTrim ? "자를 객체 선택" : "자를 구간 선택(경계 고정)"} 또는 [울타리(F)/지우기(R)/모드(O)/명령 취소(U)] · Shift+클릭 = 연장 · 빈 곳에서 끌면 울타리`,
    EXTEND: params.trimErase ? "지울 객체 선택 · Enter 로 연장으로 돌아감" : params.fencePoints ? (params.fencePoints.length?"울타리 끝점 지정":"울타리 첫 점 지정") : `${params.quickTrim ? "연장할 객체 끝 쪽 선택" : "연장할 선 끝 쪽 선택(경계 고정)"} 또는 [울타리(F)/지우기(R)/모드(O)/명령 취소(U)] · Shift+클릭 = 자르기 · 빈 곳에서 끌면 울타리`,
    BREAK: n ? "두 번째 끊기점 지정 또는 [첫 점(F)] · @ = 같은 점에서 나누기" : "첫 번째 끊기점 지정",
    BREAKATPOINT: "끊기점 지정",
    ARRAY: `행,열,X간격,Y간격 입력 (예: 3,4,1500,1200) 또는 [연관(AS)] · 지금 ${S4.editVar('ARRAYASSOCIATIVITY')===1?'연관 배열 하나(ARRAYEDIT 로 고침)':'낱개 사본'}`,
    DIMLINEAR:
      phase === "dim-object"
        ? "치수 기입할 객체 선택"
        : n === 2
        ? `치수선 위치 지정 또는 [여러 줄 문자(M)/문자(T)/각도(A)/수평(H)/수직(V)/회전(R)]${params.dimForce?` · ${params.dimForce==='horizontal'?'수평':'수직'} 고정`:''}`
        : n
          ? "두 번째 치수보조선 원점 지정"
          : "첫 번째 치수보조선 원점 지정 또는 <객체 선택>",
    DIMALIGNED:
      phase === "dim-object" ? "치수 기입할 객체 선택" : n === 2 ? "치수선 위치 지정 또는 [여러 줄 문자(M)/문자(T)/각도(A)]" : n ? "두 번째 치수보조선 원점 지정" : "첫 번째 치수보조선 원점 지정 또는 <객체 선택>",
    DIMRADIUS: params.circle ? "치수선 위치 지정 또는 [여러 줄 문자(M)/문자(T)/각도(A)]" : "원 또는 호 선택",
    DIMDIAMETER: params.circle ? "치수선 위치 지정 또는 [여러 줄 문자(M)/문자(T)/각도(A)]" : "원 또는 호 선택",
    TEXT:
      phase === "text"
        ? "문자 입력 · Enter 다음 줄 · 빈 Enter 끝"
        : phase === "text-rotation"
          ? `문자의 회전 각도 지정 <${fmt(run.textRotation||0)}>`
        : phase === "number"
          ? `문자 높이 <${num("text-height", 150)}> · Enter 기본값`
        : phase === "text-width"
          ? `글자 폭 비율 지정(1 = 기본, 0.8 = 좁게) <${fmt(run.textWidth||1)}>`
        : phase === "text-justify"
          ? `옵션 입력 [왼쪽(L)/중심(C)/오른쪽(R)/맞춤(A)/채움(F)/중간(M)/맨위왼쪽(TL)/맨위중심(TC)/맨위오른쪽(TR)/중간왼쪽(ML)/중간중심(MC)/중간오른쪽(MR)/맨아래왼쪽(BL)/맨아래중심(BC)/맨아래오른쪽(BR)] <${run.textJustify||'L'}>`
          : isFitJustify(run.textJustify)
            ? (points.length ? `문자 기준선의 두 번째 끝점 지정 (${run.textJustify==='A'?'맞춤: 두 점 사이에 맞게 높이를 정합니다':'채움: 높이를 두고 두 점 사이에 맞게 폭을 늘립니다'})` : `문자 기준선의 첫 번째 끝점 지정 또는 [자리맞추기(J)/폭(W)] (자리맞추기 ${run.textJustify})${(run.textWidth||1)!==1?` (폭 ${fmt(run.textWidth)})`:''}`)
          : `문자 ${run.textJustify&&run.textJustify!=='L'?'맞춤점':'시작점'} 지정 또는 [자리맞추기(J)/폭(W)]${run.textJustify&&run.textJustify!=='L'?` (자리맞추기 ${run.textJustify})`:''}${(run.textWidth||1)!==1?` (폭 ${fmt(run.textWidth)})`:''}`,
    OVERKILL: phase === "overkill-endtoend" ? `끝과 끝이 닿은 같은 직선 위의 선도 합치기 [예(Y)/아니오(N)] <${params.overkill?.endToEnd?'Y':'N'}>` : phase === "overkill-tolerance" ? `공차 지정 <${fmt(params.overkill?.tolerance??0.01)}>` : phase === "overkill-layer" ? `레이어 무시 [예(Y)/아니오(N)] <${params.overkill?.ignoreLayer?'Y':'N'}>` : "중복을 정리할 객체 선택 · 선택 없이 Enter = 도면 전체",
    AUDIT: "오류를 고치시겠습니까? [예(Y)/아니오(N)] <N>",
    DRAWORDER: phase === "draworder-option" ? "객체 순서 [객체 위(A)/객체 아래(U)/맨 앞(F)/맨 뒤(B)] <B>" : phase === "draworder-ref" ? "기준 객체 선택 · Enter" : "순서를 바꿀 객체 선택 · Enter",
    BLOCK:
      phase === "name"
        ? "블록 이름 입력 (명령이 아닌 이름으로 처리)"
        : phase === "block-redefine"
          ? `블록 "${params.name}" 이(가) 이미 있습니다. 재정의하시겠습니까? [예(Y)/아니오(N)] <N>`
        : phase === "block-mode"
          ? `원래 객체를 [유지(R)/블록으로 변환(C)/삭제(D)] <${({R:'유지',C:'변환',D:'삭제'})[run.blockMode||'C']}>`
          : "블록 기준점",
    INSERT:
      phase === "name"
        ? (typeof insertNameList==='function'?"블록 이름 입력(최근 순): " + insertNameList(engine.doc.blocks):"블록 이름 입력: " + engine.doc.blocks.map((b) => b.name).join(", "))
        : phase === "insert-scale" ? `축척 비율 <${fmt(run.insertScale??1)}>`
        : phase === "insert-rotation" ? `회전 각도 또는 방향 점 <${fmt(run.insertRotation??0)}>`
        : "블록 삽입점",
    WALL:
      phase === "number"
        ? `벽 두께 <${num("wall-width", 200)}> · Enter 기본값`
        : n
          ? (params.centered===false?"다음 벽면 점 · Enter 종료":"다음 중심선 점 · Enter 종료")
          : (params.centered===false?"벽 왼쪽 면 시작점":"벽 중심선 시작점"),
    OPENING:
      phase === "number"
        ? "개구부 폭 <900>"
        : "벽 위 개구부 중심점 · 문 기호는 별도 배치",
    DOOR:
      phase === "number"
        ? "문 폭 <900>"
        : phase === "angle"
          ? "문 회전 각도 <0> 또는 방향 클릭"
          : "문 경첩 삽입점 · 벽을 찍으면 방향·개구부 자동 연결",
    WINDOW:
      phase === "number"
        ? "창 폭 <1200>"
        : phase === "angle"
          ? "창 회전 각도 <0> 또는 방향 클릭"
          : "창 시작점 · 벽을 찍으면 방향·개구부 자동 연결",
    STAIR:
      phase === "number"
        ? "계단 폭,디딤판 깊이,단수 <1200,280,12>"
        : phase === "angle"
          ? "계단 회전 각도 <0> 또는 방향 클릭"
          : "계단 시작점",
    DIST: n ? "거리 측정 끝점" : "거리 측정 시작점",
  };
  return text[mode] ?? "명령/별칭을 입력하세요.";
}
let syncInsulationButtons=()=>{};     // 건축 요소 패널이 자기 단추 표시를 여기에 건다
/** 정상 종료 표시. 이 자리를 밟았으면 다음에 켤 때 새 도면으로 시작한다.
    강제 종료·정전은 여기까지 오지 못하므로 그때는 예전처럼 자동 복구한다. */
const markCleanExit=()=>{try{localStorage.setItem('barun-cad-clean-exit','1');}catch{}};
/* 켤 때 한 번만 판단한다. 복구 갈래가 둘(도면 탭·마지막 작업)이라 같은 기준을 써야 한다.
   sessionStorage 는 새로고침에는 남고 앱을 새로 켜면 비어 있다. */
const freshLaunch=(()=>{try{const had=sessionStorage.getItem('barun-cad-session')==='1';sessionStorage.setItem('barun-cad-session','1');return !had;}catch{return false;}})();
const closedCleanly=(()=>{try{const value=localStorage.getItem('barun-cad-clean-exit')==='1';localStorage.removeItem('barun-cad-clean-exit');return value;}catch{return false;}})();
/** 앱을 새로 켠 경우. 종료 방식과 관계없이 빈 도면으로 시작하고 복구본은 RECOVER에 보관한다. */
const startFresh=startsFresh({freshLaunch,closedCleanly});
let lastSessionDocument=null;   // 자동으로 열지 않고 보관해 둔 마지막 작업(RECOVER 로 되살린다)
let engineRecovery=null,recoverFromEngine=()=>{};   // 엔진에 남은 대용량 복구본 정보(시각·dirty)와 되살리기 함수
/* 명령창 제목 옆 상태: "선 · 점 지정"처럼 한글 명령 이름과 단계로 보여 준다. 정식 명령이 아닌 내부 모드는 이름을 풀어 쓴다. */
const INTERNAL_MODE_LABELS={SELECT:'선택',PICKPATH:'보조명령',PICKENTITY:'보조명령',PLOTWINDOW:'출력 영역',PLANPLACE:'계획안 놓기',ARCHPLACE:'건축 요소 배치',AHM:'구적 경계',WOT:'벽선 개구부',XCLIP:'블록 표시 범위',INSULATION:'단열재',PASTECLIP:'붙여넣기',COPYBASE:'기준점 복사',MATCHPROP:'속성 일치',ZOOM:'줌',PAN:'화면 이동'};
function activeCommandLabel(){
  const command=COMMANDS.find(c=>c.name===mode);
  // 카드(보조명령)가 점·객체를 받는 동안에는 그 카드 이름을 보여 준다.
  const card=['PICKPATH','PICKENTITY'].includes(mode)&&lastCommand?(COMMANDS.find(c=>c.name===lastCommand)?.label||lastCommand):null;
  const name=card||(mode==='PLOTWINDOW'&&params?.windowPrompt)||INTERNAL_MODE_LABELS[mode]||command?.label||mode;
  if(mode==='SELECT'&&phase==='idle')return `${name} · 대기`;
  return `${name} · ${stageLabel(phase)}`;
}
/* 프롬프트의 [라벨(키)/…] 옵션을 누를 수 있는 단추로(오토캐드 명령행 옵션 클릭). */
function renderPrompt(text){
 const box=$('prompt');if(!box)return;
 if(typeof document==='undefined'||!box.append||!/\[[^\]]+\]/.test(text)){box.textContent=text;return;}
 box.textContent='';let last=0;const re=/\[([^\]]+)\]/g;let m;
 while((m=re.exec(text))){
  box.append(text.slice(last,m.index),'[');
  m[1].split('/').forEach((part,i)=>{
   if(i)box.append('/');
   const key=part.match(/\(([^)]+)\)\s*$/)?.[1];
   if(!key){box.append(part);return;}
   const b=document.createElement('button');b.type='button';b.className='prompt-option';b.textContent=part;
   b.onclick=()=>{$('coordinate').value=key;submit();canvas.focus();};box.append(b);
  });
  box.append(']');last=re.lastIndex;
 }
 box.append(text.slice(last));
}
/* 명령창 자동 완성: 명령이 없을 때 치는 동안 후보(별칭·이름·한글)를 보여 준다. ↑↓ 로 고르고 Enter, 누르면 실행. */
let commandSuggestBox=null,commandSuggestItems=[],commandSuggestIndex=-1;
function hideCommandSuggest(){if(commandSuggestBox)commandSuggestBox.hidden=true;commandSuggestItems=[];commandSuggestIndex=-1;}
function updateCommandSuggest(){
 const input=$('coordinate'),text=input.value.trim();
 if(mode!=='SELECT'||!text||/^[\d@#*.,<(+\-]/.test(text)){hideCommandSuggest();return;}
 const exact=resolveCommand(text,settings),list=[];
 for(const c of [exact&&COMMANDS.find(x=>x.name===exact),...(typeof s7Tools==='object'&&s7Tools?s7Tools.suggest(text,settings,8):suggestCommands(text,settings,8))])if(c&&!list.some(x=>x.name===c.name))list.push(c);
 commandSuggestItems=list.slice(0,8);commandSuggestIndex=-1;
 if(!commandSuggestItems.length){hideCommandSuggest();return;}
 if(!commandSuggestBox){commandSuggestBox=document.createElement('div');commandSuggestBox.className='command-suggest';commandSuggestBox.setAttribute('role','listbox');input.closest('.command-input')?.append(commandSuggestBox);}
 commandSuggestBox.replaceChildren(...commandSuggestItems.map((c,i)=>{
  const b=document.createElement('button');b.type='button';b.setAttribute('role','option');
  const alias=settings.aliases[c.name]&&settings.aliases[c.name]!==c.name?settings.aliases[c.name]:'';
  b.innerHTML='';const k=document.createElement('b');k.textContent=alias?`${alias}  ${c.name}`:c.name;const l=document.createElement('span');l.textContent=c.label;b.append(k,l);
  b.onmousedown=e=>{e.preventDefault();if(typeof s7Tools==='object'&&s7Tools)s7Tools.learn(text,c.name);input.value=c.name;hideCommandSuggest();submit();};
  return b;
 }));
 commandSuggestBox.hidden=false;
}
function commandSuggestKey(e){
 if(!commandSuggestBox||commandSuggestBox.hidden||!commandSuggestItems.length)return false;
 if(e.key==='ArrowDown'||e.key==='ArrowUp'){
  e.preventDefault();const n=commandSuggestItems.length;commandSuggestIndex=e.key==='ArrowDown'?(commandSuggestIndex+1)%n:(commandSuggestIndex<=0?n-1:commandSuggestIndex-1);
  [...commandSuggestBox.children].forEach((b,i)=>b.setAttribute('aria-selected',String(i===commandSuggestIndex)));return true;
 }
 if(e.key==='Enter'&&commandSuggestIndex>=0){const chosenName=commandSuggestItems[commandSuggestIndex].name;if(typeof s7Tools==='object'&&s7Tools)s7Tools.learn($('coordinate').value,chosenName);$('coordinate').value=chosenName;hideCommandSuggest();return false;}
 if(e.key==='Escape'){hideCommandSuggest();e.preventDefault();return true;}
 if(e.key==='Enter'||e.key===' ')hideCommandSuggest();
 return false;
}
/* 동적 입력은 점을 묻는 단계에서만(객체 선택·문자·이름·값 단계 제외), F12 로 끈다. */
function dynamicInputReady(){
 if(typeof $!=='function'||$('dynamic-input')?.checked===false)return false;
 return mode!=='SELECT'&&phase==='point'&&!!(params?.fromBase||points.length)&&!objectPickCursor();
}
function updatePrompt() {
  syncInsulationButtons();
  $("coordinate").placeholder =
    `${settings.aliases.COPY || "COPY"} ↵ 복사 · ${settings.aliases.CIRCLE || "CIRCLE"} ↵ 원 · X,Y / @DX,DY`;
  renderPrompt(instruction());
  $("active-command").textContent = activeCommandLabel();
  $("finish").disabled = mode === "SELECT";
  toolButtons();
}
function convertInsulation(ids,depth,side='center') {
  const sources=engine.selected(ids);
  if(!sources.length)throw Error('먼저 변환할 선·폴리선·호·원을 선택하세요.');
  const entities=sources.map(source=>{const path=insulationSourcePath(source,depth);return {...insulationPath(path.points,depth,side,path.closed,source.layer),...(source.color?{color:source.color}:{}),...(source.lineweight!==undefined?{lineweight:source.lineweight}:{})};});
  execute({type:'batch',commands:[{type:'delete',ids},{type:'addMany',entities}]});
  setSelected(engine.doc.entities.slice(-entities.length).map(e=>e.id));reset();
  toast('선택한 경로 '+entities.length+'개를 단열재로 변환했습니다. Ctrl+Z로 원래 선 복원');
}
function reset() {
  if(mode==='EYEPOINT'&&!reset.keepEyePoint)settleEyePoint(null);
  clearOverlapSelection();
  if(typeof osnapOnce!=='undefined')osnapOnce=null;
  if(typeof assist!=='undefined'){assist.tracking.clear();assist.snapCycle.clear();assist.steps.clear();assist.hover.clear();assist.windowPreview.reset();}   // 315·313·324·303 명령이 끝나면 비운다
  const pendingCancel=params?.onCancel;if(pendingCancel)params.onCancel=null;
  dropViewState();
  if(typeof cancelPointerInteraction==='function')cancelPointerInteraction('reset');else drag=null;
  space = false;
  mode = "SELECT";
  phase = "idle";
  points = [];
  params = {};
  $("coordinate").value = "";
  if(pendingCancel)setTimeout(pendingCancel,0);
  updatePrompt();
  render();
  // 명령이 끝나면(Enter·Esc·완료) 한 번 부를 일(ADDSELECTED 가 바꿔 둔 현재 레이어·특성 되돌리기 등).
  if(typeof commandEndHooks!=='undefined'&&commandEndHooks.length){const hooks=commandEndHooks.splice(0);for(const hook of hooks){try{hook();}catch(error){console.error('[명령 종료 처리]',error);}}}
}
function afterCommand(fn){if(mode==='SELECT'){fn();return;}commandEndHooks.push(fn);}
/* 투명 줌·초점이동 동안 멈춰 두는 명령 상태. 카드 입력(PICKPATH 등)의 params 에는 미리보기·resolve 함수가 있어
   structuredClone 이 안 되므로 값만 복제하고 함수는 그대로 든다. 멈춰 둔 입력은 줌이 끝나면 이어지고, 다른 명령이나 Esc 로 버려지면 취소된다. */
function cloneParams(p){const out={};for(const [k,v] of Object.entries(p||{})){if(typeof v==='function'){out[k]=v;continue;}try{out[k]=structuredClone(v);}catch{out[k]=v;}}return out;}
function dropViewState(){const saved=run.viewState;delete run.viewState;const cancel=saved?.params?.onCancel;if(cancel){saved.params.onCancel=null;setTimeout(cancel,0);}}
function beginView(name){
 const saved=run.viewState||(mode!=='SELECT'?{mode,phase,points:structuredClone(points),params:cloneParams(params),drag:drag?.kind==='selection'?structuredClone(drag):null}:null);
 if(saved&&params?.onCancel&&saved.params?.onCancel===params.onCancel)params.onCancel=null;
 reset.keepEyePoint=saved?.mode==='EYEPOINT';try{reset();}finally{reset.keepEyePoint=false;}run.viewState=saved;mode=name;phase=name==='ZOOM'?'zoom':'point';updatePrompt();render();canvas.focus();
}
function endView(){
 const saved=run.viewState;delete run.viewState;reset();
 if(saved){({mode,phase,points,params}=saved);drag=saved.drag?(typeof interaction!=='undefined'?interaction.tag(saved.drag):saved.drag):null;updatePrompt();render();}
 canvas.focus();
}
function cancelStep(){
 if(['ZOOM','PAN'].includes(mode)){endView();return;}
 if(mode==='PLINE'&&points.length>=2&&!params.areaOutline&&!drag){finish(false);return;}
 if(mode!=='SELECT'||drag){reset();refresh();return;}
 cancelSelection();
}
function cancelSelection() {
  if(selected.size)previousSelection=[...selected];
  selected.clear();
  reset();
  refresh();
}
function requireSelection() {
  if (!selected.size) {
    phase = "select";
    return false;
  }
  if (!["TRIM", "EXTEND", "AREA", "PROPERTIES"].includes(mode))
    engine.selected([...selected]);
  return true;
}
/* XLINE·RAY: 오토캐드 무한선은 형식이 따로 없어, 도면 크기의 10배(최소 100 m)까지 뻗은 선으로 둔다(construction 표시). */
function constructionLine(p0,dir,ray){
 const u=G.unit(dir);if(!Number.isFinite(u.x)||G.len(dir)<=G.EPS)throw Error('다른 점을 지정하세요.');
 if(params.lineReach==null){const b=G.bounds(engine.doc.entities.filter(e=>!e.construction));params.lineReach=Math.max(100000,b?Math.max(b.maxX-b.minX,b.maxY-b.minY)*10:0);}
 const L=params.lineReach;return {type:'line',construction:true,points:[ray?p0:G.add(p0,G.mul(u,-L)),G.add(p0,G.mul(u,L))]};
}
/* XLINE O 의 기준 선분: 선·구성선은 두 끝점, 폴리선은 찍은 곳에서 가장 가까운 구간. */
function xlineSourceSegment(e,p){
 if(e.type==='line'&&e.points?.length>=2)return [e.points[0],e.points[1]];
 if(['polyline','rectangle'].includes(e.type)&&e.points?.length>=2){let best=null,bd=Infinity;const ps=e.points,n=ps.length,closed=e.closed||e.type==='rectangle';for(let i=0;i<(closed?n:n-1);i++){const a=ps[i],b=ps[(i+1)%n],d=G.distanceToSegment(p,a,b);if(d<bd){bd=d;best=[a,b];}}return best;}
 return null;
}
function xlineDirection(p){const m=params.xlineMode;if(m==='H')return {x:1,y:0};if(m==='V')return {x:0,y:1};if(m==='A')return G.polar(1,params.xlineAngle||0);return G.sub(p,points[0]);}
/* SPLINE: 맞춤점을 지나는 매끈한 곡선(Catmull-Rom). 진짜 NURBS 형식이 없어 잘게 나눈 폴리선으로 둔다. */
function splinePoints(list,closed=false){
 if(list.length<3)return list.slice();
 const pts=closed?[list.at(-1),...list,list[0],list[1]]:[list[0],...list,list.at(-1)],out=[];
 for(let i=1;i<pts.length-2;i++){const [p0,p1,p2,p3]=[pts[i-1],pts[i],pts[i+1],pts[i+2]];
  for(let s=0;s<16;s++){const t=s/16,t2=t*t,t3=t2*t;out.push({x:.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),y:.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3)});}}
 if(!closed)out.push(list.at(-1));return out;
}
/* REVCLOUD: 닫힌 경계를 따라 바깥으로 볼록한 호를 잇는다(직사각형·다각형 P·객체 O). 호 길이는 기억한다.
   ACAD200-410: 호는 2차 베지어 근사 대신 정확한 원호(폴리선 호 구간 arcRuns) — DXF 에는 호 하나가 bulge 정점 하나로 간다.
   호 길이를 정하지 않았으면 화면 폭의 1/40(작은 상세도·큰 배치도 모두 알맞게). */
function cloudArc(){if(run.revcloudArc)return run.revcloudArc;const a=world({x:0,y:height}),b=world({x:width,y:0});return S4.defaultCloudArc({minX:a.x,minY:a.y,maxX:b.x,maxY:b.y});}
function cloudPoints(ring){return S4.cloudFromRing(ring,cloudArc());}
function entityRing(e){
 if(e.type==='circle')return Array.from({length:72},(_,i)=>G.add(e.center,G.polar(e.radius,i*5)));
 if(e.type==='rectangle'||(e.type==='polyline'&&e.closed))return e.points.slice();
 throw Error('닫힌 폴리선·사각형·원을 선택하세요.');
}
/* BOUNDARY 경계 집합(ACAD200-412): 예전에는 클릭마다 도면 전체를 DXF 로 만들어 서버가 다시 읽고 모든 곡선을 폈다.
   이제 화면(색인 질의) 안 객체를 꺾은선으로만 보낸다. 찾은 경계가 범위에 걸치면(밖의 선이 더 잘게 나눌 수 있음) 범위를 두 배씩
   넓혀 다시 찾고(최대 3번), 그래도 안 되면 예전처럼 도면 전체. 훑는 양: 도면 전체 → 화면 범위 후보. */
async function boundaryRequest(point,snapshot){
 const hidden=new Set(snapshot.layers.filter(l=>l.visible===false||l.frozen).map(l=>l.id)),a=world({x:0,y:height}),b=world({x:width,y:0});
 let box={minX:Math.min(a.x,point.x),minY:Math.min(a.y,point.y),maxX:Math.max(b.x,point.x),maxY:Math.max(b.y,point.y)};
 if(renderSpatialRevision!==sceneRevision){renderSpatial=G.spatialIndex(snapshot.entities);renderSpatialRevision=sceneRevision;}
 for(let round=0;round<4;round++){
  const entities=renderSpatial.query(box),whole=entities.length>=snapshot.entities.length;
  let paths;try{paths=S4.boundaryPaths(entities,{hiddenLayers:hidden});}catch{break;}
  try{const found=await request('/api/hatch-boundary',{paths,point});if(whole||S4.boundaryInside(found,box))return found;}
  catch(error){if(whole||!/닫힌 영역을 찾지 못했습니다/.test(error?.message||''))throw error;}
  box=S4.growBox(box,2);
 }
 return request('/api/hatch-boundary',{document:snapshot,point});
}
async function boundaryAt(point){
 const snapshot=engine.doc;busy=true;
 try{const b=await boundaryRequest(point,snapshot);
  if(engine.doc!==snapshot)throw Error('도면이 바뀌었습니다. 다시 클릭하세요.');
  const rings=[b.points,...(b.loops||[])].filter(r=>r?.length>=3);
  addEntities(rings.map(points=>({type:'polyline',closed:true,points})));log(`경계 ${rings.length}개를 만들었습니다.`);
 }finally{busy=false;updatePrompt();}
}
/* ELLIPSE 호(A): 시작 각도 → 끝 각도(장축 기준, 반시계). 두 번째 값을 받으면 타원 호 하나를 넣는다. */
function ellipseArcStep(deg){
 if(!Number.isFinite(deg))throw Error('각도를 숫자로 입력하거나 점을 찍으세요.');
 if(params.ellipseStart==null){params.ellipseStart=deg;updatePrompt();render();return;}
 addEntities([S4.ellipseArc(params.ellipseDraft,params.ellipseStart,deg)]);reset();
}
/* DIVIDE/MEASURE(ACAD200-418): 타원·호 폴리선도 따라 걷고(curve-edit walkPoints), B(블록)면 각 자리에 블록을 넣는다(정렬이면 진행 방향으로). */
function divideOrMeasure(value){
 const word=String(value).trim().toUpperCase();
 if(['B','BLOCK'].includes(word)){
  const names=engine.doc.blocks.map(b=>b.name);if(!names.length)throw Error('도면에 블록 정의가 없습니다. BLOCK 으로 먼저 만드세요.');
  form(`${mode} · 블록 넣기(B)`,[{name:'name',label:'넣을 블록',options:names.map(n=>[n,n]),value:params.divideBlock?.name||names[0]},{name:'align',label:'객체 방향으로 블록 돌리기',type:'checkbox',value:params.divideBlock?.align??true}],v=>{params.divideBlock={name:v.name,align:v.align===true||v.align==='true'||v.align==='on'};updatePrompt();canvas.focus();});
  return;
 }
 const found=S4.divideMeasurePlan(params.target,mode,value);
 if(params.divideBlock){const {name,align}=params.divideBlock;execute(S4.divideBlockCommand(found,name,align,activeLayer));log(`블록 ${name} ${found.length}개를 넣었습니다${align?'(객체 방향으로 정렬)':''}.`);reset();return;}
 addEntities(found.map(({point})=>({type:'point',position:point})));log(`점 ${found.length}개를 찍었습니다.`);reset();
}
/* DONUT: 안지름·바깥지름 → 중심 클릭마다 도넛(폭 있는 닫힌 폴리선). 안지름 0 이면 꽉 찬 원. */
function donutEntity(center){
 const inner=run.donut?.inner??10,outer=run.donut?.outer??100,radius=(inner+outer)/4,width=(outer-inner)/2;
 return {type:'polyline',closed:true,constantWidth:width,points:Array.from({length:72},(_,i)=>G.add(center,G.polar(radius,i*5)))};
}
/* LIST(LI): 고른 객체의 종류·레이어·색·길이·면적을 명령 기록에 보여 준다(오토캐드 LIST). */
function listSelection(){
 for(const e of chosen()){
  const layer=layerMap().get(e.layer)?.name||e.layer,parts=[`${e.type}`,`레이어 ${layer}`,`색 ${e.color||'ByLayer'}`];
  if(e.type==='line'&&e.points?.length===2)parts.push(`길이 ${fmt(G.dist(e.points[0],e.points[1]))}`,`각도 ${fmt(G.angle(G.sub(e.points[1],e.points[0])))}°`);
  if(e.type==='circle')parts.push(`반지름 ${fmt(e.radius)}`,`둘레 ${fmt(2*Math.PI*e.radius)}`,`면적 ${fmt(Math.PI*e.radius**2)}`);
  if(e.type==='arc')parts.push(`반지름 ${fmt(e.radius)}`);
  if(['polyline','rectangle'].includes(e.type)&&e.points?.length){const segs=G.segments(e)||[];parts.push(`길이 ${fmt(segs.reduce((s,[a,b])=>s+G.dist(a,b),0))}`);if(e.closed||e.type==='rectangle')parts.push(`면적 ${fmt(Math.abs(G.polygonArea(e.points)))}`);}
  if(e.type==='text')parts.push(`"${String(e.text).slice(0,40)}"`,`높이 ${fmt(e.height)}`);
  if(e.type==='block')parts.push(`블록 ${e.name||''}`);
  log('LIST · '+parts.join(' · '));
 }
}
function startSelected() {
  if(mode==='LIST'){if(!requireSelection())return;listSelection();reset();return;}
  if(['DIVIDE','MEASURE'].includes(mode)){if(!requireSelection())return;if(selected.size!==1)throw Error('객체 하나를 선택하세요.');params.target=chosen()[0];phase='number';return;}
  if(mode==='WBLOCK'){if(!requireSelection())return;const ids=[...selected];reset();writeBlock(ids);return;}
  // TRIM·EXTEND: 표준 모드 — 경계를 클릭·드래그로 고르고 Enter. 아무것도 안 고르고 Enter 면 모든 선이 경계(빠른 모드).
  if(['COPYCLIP','CUTCLIP'].includes(mode)){
    if(!requireSelection())return;
    const cut=mode==='CUTCLIP',count=selected.size;copySelection();
    if(cut){execute({type:'delete',ids:[...selected]});selected.clear();}
    reset();refresh();log(`${count}개 객체를 ${cut?'잘라냈습니다':'복사했습니다'} · Ctrl+V 로 붙여넣기`);return;
  }
  if(['TALIGN','DIMCLEAN','LEN','PC'].includes(mode)){
    if(!requireSelection())return;
    const command=mode;reset();nativeDraftingDialog(command);return;
  }
 if(mode==='WOT'){if(!selected.size)return;run('WOT');return;}
  if(mode==='XCLIP'){if(!selected.size){phase='select';return;}const es=engine.selected([...selected]);if(es.some(e=>e.type!=='block'))throw Error('블록만 선택하세요.');params.clipIds=es.map(e=>e.id);phase='point';points=[];return;}

  if (!requireSelection()) return;
  if(['M2','PY'].includes(mode)){
    const direction=mode==='M2'?'py-to-m2':'m2-to-py',label=mode==='M2'?'평 → ㎡':'㎡ → 평',commands=[];
    for(const entity of chosen()){
      try{commands.push({type:'update',ids:[entity.id],changes:areaConversionChanges(entity,direction)});}catch{}
    }
    if(!commands.length)throw Error('변환할 숫자가 있는 문자 또는 문자 블록을 선택하세요.');
    execute({type:'batch',commands});toast(`${label} · ${commands.length}개 문자를 변환했습니다. Ctrl+Z로 되돌릴 수 있습니다.`);reset();return;
  }
  if(['FILLET','CHAMFER'].includes(mode)){runCorner({ids:[...selected],pickPoints:params.cornerPicks});return;}
  if (["MOVE", "COPY", "ROTATE", "SCALE", "MIRROR", "BREAK", "BREAKATPOINT"].includes(mode))
    phase = "point";
  else if (["OFFSET", "ARRAY", "OPENING", "FILLET", "CHAMFER"].includes(mode))
    phase = "number";
  else if (["TRIM", "EXTEND"].includes(mode)) {
    params.boundaries = [...selected];
    phase = "pick";
  } else if (mode === "BLOCK") phase = "name";
  else if (["DIMRADIUS", "DIMDIAMETER"].includes(mode)) {
    if (selected.size !== 1 || !['circle','arc'].includes(chosen()[0].type))
      throw Error("원 또는 호 하나를 선택하세요.");
    params.circle = structuredClone(chosen()[0]);
    phase = "point";
  } else if (mode === "ERASE") {
    run.lastErased=structuredClone(chosen()); // OOPS 로 되살린다
    execute({ type: "delete", ids: [...selected] });
    selected.clear();
    reset();
  } else if (mode === "EXPLODE" || mode === "JOIN") {
    // JOIN: 허용 거리 = JOINFUZZ(기본 0.001mm). 결과 종류(선·호·원·폴리선)는 엔진이 정하고 못 이은 개수를 알려 준다.
    const ids = execute({ type: mode.toLowerCase(), ids: [...selected], ...(mode==='JOIN'?{tolerance:S4.editVar('JOINFUZZ')}:{}) });
    if(mode==='EXPLODE'&&engine.lastExplodeSkipped)log(`${engine.lastExplodeSkipped}개는 분해할 수 없어 그대로 두었습니다.`);
    if(mode==='JOIN'&&engine.lastJoinReport){const r=engine.lastJoinReport;log(`JOIN · ${r.joined}개를 ${r.made}개(${({line:'선',arc:'호',circle:'원',polyline:'폴리선'})[r.kind]||r.kind})로 이었습니다${r.left?` · ${r.left}개는 끝점이 안 닿아 그대로(허용 거리 JOINFUZZ)`:''}.`);}
    commandDone(ids);
    reset();
  } else if (mode === "HATCH") {
    // 해치 객체 선택(S): 닫힌 폴리선·사각형·원·타원·닫힌 스플라인(폴리선)·벽·해치 경계를 해치 하나의 루프로(안에 든 경계는 섬).
    const {boundary,accepted,rejected}=G.hatchSelectionBoundary(chosen());
    const why=[...new Set(rejected.map(r=>r.reason))].slice(0,4).join('·');
    log(`해치 경계: ${accepted.length}개 사용${rejected.length?` · ${rejected.length}개 제외(${why})`:''}`);
    params.hatchSelect=false;phase='hatch-inside';setSelected([]);
    if(!boundary)throw Error(`닫힌 경계가 없습니다(${why||'선택 없음'}). 닫힌 폴리선·사각형·원·타원을 고르세요.`);
    const island=S4.islandModeOf();
    pickHatch(null,{...S4.islandFilter(boundary,island),...(S4.editVar('HPASSOC')===1&&!rejected.length?{boundaryIds:accepted,islandMode:island}:{})});
    return;
  } else if (mode === "AREA") {
    let area = 0,
      perimeter = 0;
    for (const e of chosen()) {
      if (e.type === "circle") {
        area += Math.PI * e.radius ** 2;
        perimeter += 2 * Math.PI * e.radius;
      } else if (e.type === "hatch") {
        // 여러 영역 해치: 영역 합 − 구멍(짝홀 규칙), 둘레는 모든 경계 루프 합(AutoCAD 해치 특성의 면적·둘레와 같게).
        area += G.hatchArea(e);
        for (const points of G.hatchRings(e))
          perimeter += G.segments({ points, closed: true }).reduce((n, [a, b]) => n + G.dist(a, b), 0);
      } else {
        const ps =
          e.type === "wall"
            ? G.wallPolygons(e)
            : ["rectangle", "hatch"].includes(e.type) ||
                (e.type === "polyline" && e.closed)
              ? [e.points]
              : null;
        if (!ps) throw Error("닫힌 영역/원/벽을 선택하세요.");
        for (const points of ps) {
          area += G.polygonArea(points);
          perimeter += G.segments({ points, closed: true }).reduce(
            (n, [a, b]) => n + G.dist(a, b),
            0,
          );
        }
        for (const loop of e.loops || []) area -= G.polygonArea(loop);
      }
    }
    toast(
      `면적 ${fmt(area / 1e6)} m² (${fmt(area)} mm²) · 둘레 ${fmt(perimeter)} mm · 중첩 영역은 합산`,
    );
    params.areaText = `${Number((area / 1e6).toFixed(2))}m²`;
    params.height = num("text-height", 150);
    phase = 'area-label';
    updatePrompt();render();
  } else if (mode === "PROPERTIES") {
    editProperties();
    reset();
  }
}
const selectionCommands = new Set([
  'TALIGN','DIMCLEAN','LEN','PC','COPYCLIP','CUTCLIP','WBLOCK',
  /* M2·PY 는 2026-09-21 4차부터 바른 CAD 리습 카드(area-select-tools-4)가 맡는다 */
  "XCLIP",
  "COPY",
  "MOVE",
  "ROTATE",
  "SCALE",
  "MIRROR",
  "OFFSET",
  "TRIM",
  "EXTEND",
  "BREAK",
  "BREAKATPOINT",
  "ARRAY",
  "ERASE",
  "LIST",
  "DIVIDE",
  "MEASURE",
  "EXPLODE",
  "JOIN",
  "HATCH",
  "BLOCK",
  "OPENING",
  "AREA",
  "PROPERTIES",
  "FILLET",
  "CHAMFER",
]);
function nativeDraftingDialog(command){
 const ids=[...selected];
 const apply=options=>{
  const edits=nativeDraftingEdits(command,engine.selected(ids),options);
  if(edits.length)execute({type:'batch',commands:edits});
  refresh();toast(`${command} · ${edits.length}개 수정`);
 };
 if(command==='PC'){apply({});return;}
 if(command==='TALIGN'){
  const text=chosen().find(e=>e.type==='text');if(!text)throw Error('정렬할 문자를 선택하세요.');
  form('문자 정렬 · 삽입점 기준',[
   {name:'axis',label:'맞출 좌표',value:'X',options:[['X','X 좌표 같게 (세로 정렬)'],['Y','Y 좌표 같게 (가로 정렬)']]},
   {name:'value',label:'기준 좌표 (mm)',type:'number',value:text.position.x}
  ],apply);return;
 }
 if(command==='DIMCLEAN'){
  form('치수 간격 정리 · 측정 끝점 유지',[{name:'gap',label:'최소 간격 (mm · 0 = 자동: 첫·끝 치수를 두고 사이를 고르게)',type:'number',value:150}],async options=>{
   const source=engine.selected(ids),edits=nativeDraftingEdits(command,source,options);
   const proposed=source.map(e=>{const change=edits.find(edit=>edit.ids?.includes(e.id));return change?{...e,...change.changes}:e;});
   const at=await pickPointOnce({prompt:'DIMSPACE · 간격 정리 결과 확인 · 클릭하여 적용 · Esc 취소',preview:dimensionPreview(()=>proposed)});
   if(at)apply(options);
  });return;
 }
 const result=nativeLength(chosen()),label=`길이 합계 ${Number(result.length.toFixed(3))} mm`;
 toast(`${label} · ${result.count}개${result.ignored?' · 제외 '+result.ignored+'개':''}${result.approximate?' · 타원은 근사값':''}`);
 form(label,[
  {name:'insert',label:'도면에 합계 문자 넣기',value:'no',options:[['no','합계만 확인'],['yes','문자 넣기']]},
  {name:'x',label:'문자 X (mm)',type:'number',value:0},
  {name:'y',label:'문자 Y (mm)',type:'number',value:0}
 ],v=>{if(v.insert!=='yes')return;const x=Number(v.x),y=Number(v.y);if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('문자 좌표를 확인하세요.');addEntities([{type:'text',text:label,position:{x,y},height:num('text-height',150)}]);refresh();});
}
let isolatedLayerState=null;
// Space/Enter/우클릭 반복이 파일·대화상자·되돌리기 명령을 다시 실행하지 않도록 기록에서 뺀다.
// 보조명령 카드 명령(문·창·개구부·계단·주차·벽 정리). 카드 모듈이 아래에서 채운다. run() 이 초기화 중에도 불리므로 미리 비워 둔다.
const cardCommands={};
/* ── 보조명령 카드 실행 공통 처리 ──
   1) 되돌리기 한 번: 카드가 객체마다 execute/commit 을 여러 번 불러도(LC·LCO·SLC·TLL·TTL·TII·NUMC·TIP·TX·CC·BBL·BLA·MFB …)
      실행 전 문서를 기억해 두고 끝나면 그 사이에 쌓인 되돌리기 단계를 하나로 합친다. 폼 [적용]·숫자 입력 뒤에 이어지는
      비동기 작업도 각각 시작 시점을 기준으로 합친다.
   2) 오류 안내: 동기 throw 와 비동기 거부를 모두 잡아 한국어 안내(userErrorMessage)로 보여 준다. 전역 unhandledrejection 으로 새지 않는다. */
/* 되돌리기 묶음은 엔진의 transaction(engine.js beginTransaction/endTransaction)으로 한다.
   묶음 안의 execute 는 되돌리기 더미를 쓰지 않으므로 100단계 상한을 넘겨도 한 번에 시작 문서로 돌아간다. */
function beginCardWork(){engine.beginTransaction();}
function endCardWork(){return engine.endTransaction();}
function failCardWork(){const result=engine.rollbackTransaction();if(result.rolledBack){const alive=new Set(engine.doc.entities.map(e=>e.id));setSelected([...selected].filter(id=>alive.has(id)));refresh();}return result;}
function reportCardError(name,error){
 if(error==null)return;
 console.error('[바른 CAD 보조명령 오류]',name,technicalErrorMessage(error));
 toast(error,true);
}
function runCardCommand(name){
 const command=cardCommands[name];
 beginCardWork();
 let result;
 try{result=command();}catch(error){failCardWork();reportCardError(name,error);return;}
 if(result&&typeof result.then==='function')result.then(()=>endCardWork(),error=>{failCardWork();reportCardError(name,error);});
 else endCardWork();
}
/* 카드 폼의 [적용] 콜백 감싸기: 적용 시작 시점부터의 변경을 한 단계로 합치고, 폼이 이미 닫힌(점 찍기로 넘어간) 뒤의 오류는 토스트로 알린다. */
function cardFormApply(onApply){
 return values=>{
  const session=form.session;
  beginCardWork();
  let result;
  try{result=onApply(values);}catch(error){failCardWork();throw error;}
  if(!(result&&typeof result.then==='function')){endCardWork();return result;}
  return result.then(value=>{endCardWork();return value;},error=>{
   failCardWork();
   if($('form-dialog').open&&form.session===session)throw error;
   reportCardError('form',error);
  });
 };
}
const NO_REPEAT=new Set(['NUMDEC','WALDRAW','SELECT','ZOOM','PAN','FIT','REGEN','LIMITS','NEW','OPEN','SAVE','SAVEAS','DXFOUT','MIRIBODA','SETTINGS','HELP','LAYER','PLOT','PDF','APPLOAD','NUMCALC','CALC','REFEDIT','REFCLOSE']);
function createAreaTakeoff(boundary){
 const result=areaTakeoffEntities(boundary,{layer:activeLayer,textHeight:num('text-height',150),precision:3});
 const ids=addEntities(result.entities);setSelected(ids);reset();
 toast(`구적도 ${result.triangles.length}개 삼각형 · 합계 ${result.areaM2.toLocaleString('ko-KR',{maximumFractionDigits:3})}㎡ / ${result.py.toLocaleString('ko-KR',{maximumFractionDigits:3})}평 · Ctrl+Z로 되돌릴 수 있습니다.`);
}
function lowMemoryGuardEnabled(){try{return globalThis.localStorage?.getItem('barunLowMemoryGuard')!=='off';}catch{return true;}}
function run(name) {
 if(!name)return;
 if(typeof aiReveal!=='undefined'&&aiReveal)finishAIReveal();
 if(busy){traceInput('command',{accepted:false,reason:'busy',nextState:inputState()});return;}
 // 206: 명령 시작 때 힙 사용률을 본다(값 두 개 읽기). 85%를 넘으면 복구본을 먼저 남기고, 무거운 명령은 막는다. localStorage barunLowMemoryGuard=off 로 끈다.
 if(typeof lowMemCheck==='function'&&!lowMemCheck(name,{toast:(text,error)=>typeof toast==='function'&&toast(text,error),flushRecovery:()=>typeof flushDrawingRecovery==='function'?flushDrawingRecovery():null,enabled:lowMemoryGuardEnabled()}))return;
 if(typeof typoRan==='function')typoRan(name);   // ACAD200-821
 globalThis.window?.cadDesktop?.noteCommand?.(name);   // 검토 B9: 창이 죽었을 때 기록에 '직전 명령'을 남기려고 셸에 알린다(명령 이름만)
 clearOverlapSelection();
 // The legacy workflow name remains loadable for old macros, but it must use
 // the single interactive calculator instead of reopening the obsolete form.
 if(name==='CALCULATE')name='NUMCALC';
 // PROPERTIES(PR·CH·MO·DDMODIFY·Ctrl+1) = 특성 팔레트 열기/닫기(오토캐드처럼 열어 둔 채 작업). 예전 편집 창은 더블클릭·'상세 편집'.
 if(name==='PROPERTIES'&&typeof propertiesDock!=='undefined'&&propertiesDock){lastCommand=name;propertiesDock.toggle();if(!propertiesDock.open)canvas.focus();return;}
 // 블록 제자리 편집 중에 파일 저장·열기·출력을 하면 먼저 블록으로 다시 묶는다(꺼낸 상태로 저장되지 않게).
 if(typeof blockEdit!=='undefined'&&blockEdit&&['SAVE','SAVEAS','QSAVE','DXFOUT','DWGOUT','PLOT','PDF','OPEN','NEW','CLOSE'].includes(name)){try{closeBlockEdit(true);}catch(error){toast(userErrorMessage(error),true);return;}}
 if(typeof s7Tools==='object'&&s7Tools)s7Tools.recordUsage(name);   // ACAD200 715: 같은 점수 안에서 자주 쓴 명령이 먼저
 if(!NO_REPEAT.has(name))lastCommand=name;
 if(typeof cancelPointerInteraction==='function')cancelPointerInteraction('run:'+name);else drag=null;
 if(['ZOOM','PAN'].includes(name)){beginView(name);return;}
 if(!['FIT','REGEN'].includes(name))dropViewState();
 if(name==='WALL'){wallSettings();return;}
 if(name==='HATCH'){reset();mode='HATCH';phase='hatch-inside';lastCommand=name;run.hatchIsland=S4.islandModeOf();updatePrompt();toast('해치를 넣을 닫힌 영역 안쪽을 클릭하세요.');canvas.focus();return;}
 if(typeof clearTimeout==='function'&&typeof toastTimer!=='undefined')clearTimeout(toastTimer);if($('toast')?.style)$('toast').style.display='none';
 if(name==='PPP'){plotDialog({multi:true});return;}
 if(name==='APPLOAD'){studio.handlers.APPLOAD?.();return;}
 if(name==='NUMCALC'){studio.numberCalculator.open();return;}
 if(name==='NUMDEC'){const calc=studio.numberCalculator,current=calc.places();form('숫자 계산 소수 자릿수',[{name:'places',label:'결과 소수 자릿수',value:current===null?'auto':String(current),options:[['auto','자동 · 고른 숫자에 맞춤(151.25 → 2자리)'],...[0,1,2,3,4,5,6].map(n=>[String(n),n?`${n}자리`:'0 · 정수'])]}],v=>{calc.setPlaces(v.places);toast(`숫자 계산 소수 자릿수: ${v.places==='auto'?'자동':v.places+'자리'}`);});return;}
 if(name==='CALC'){studio.expressionCalculator.toggle();return;}
 if(name==='AREATAKEOFF'){ /* 2026-09-21: 바른 CAD 리습 AHM 카드(직각표시 추가)에 이름을 내주고 바른 CAD 자체 구적은 AREATAKEOFF */
  safe(()=>{const selectedBoundaries=chosen();if(selectedBoundaries.length>1)throw Error('구적할 폐합 객체 하나만 선택하세요.');if(selectedBoundaries.length){createAreaTakeoff(takeoffBoundary(selectedBoundaries[0]));return;}reset();mode='AHM';phase='point';points=[];lastCommand=name;updatePrompt();render();canvas.focus();});return;
 }
 if(name==='LIMITS'){limitsDialog();return;}
 if(name==='VIEWRES'||name==='TRANSPARENCYDISPLAY'){viewresDialog();return;}   // ACAD200 114·121
 if(name==='DIMSTYLE'){dimStyleDialog();return;}
  if(['BLIST','WLIST','TLIST'].includes(name)){safe(()=>{const rows=architecturalCounts(chosen().length?chosen():visible(),name);if(rows.length<2)throw Error('집계할 기호가 없습니다. 대상 객체를 선택해 다시 실행하세요.');form(name+' · 선택 객체 집계',[{name:'x',label:'표 삽입 X',type:'number',value:0},{name:'y',label:'표 삽입 Y',type:'number',value:0}],v=>{const x=Number(v.x),y=Number(v.y);if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('삽입 좌표를 확인하세요.');addEntities([tableBlock(rows,{x,y,height:num('text-height',150),layer:activeLayer,name:name+' 집계'})]);});});return;}
  if(name==='PKN'){safe(()=>{const ids=chosen().filter(e=>e.type==='block'&&!e.table).map(e=>e.id);if(!ids.length)throw Error('번호를 넣을 블록을 먼저 선택하세요.');form('블록 순서 번호 · X좌표 순',[{name:'start',label:'시작 번호',type:'number',value:1},{name:'step',label:'증가값',type:'number',value:1}],cardFormApply(v=>{const start=Number(v.start),step=Number(v.step);if(!Number.isInteger(start)||!Number.isInteger(step)||step===0)throw Error('번호와 증가값은 정수이고 증가값은 0이 아니어야 합니다.');execute({type:'shared.materialize',ids});const es=engine.selected(ids).sort((a,b)=>(a.position?.x??G.bounds([a]).minX)-(b.position?.x??G.bounds([b]).minX));execute({type:'batch',commands:es.map((e,i)=>{const b=G.bounds([e]),value=String(start+i*step);return {type:'update',ids:[e.id],changes:{attributes:{...e.attributes,number:value},entities:[...e.entities.filter(x=>!x.numberLabel),{type:'text',layer:e.layer,text:value,position:{x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2},height:num('text-height',150),align:'center',numberLabel:true}]}};})});}));});return;}
  if(name==='DYNB'){
   void import('./dynamic-block.js').then(({dynamicDefinition,dynamicEditor,dynamicEditorValues,dynamicChanges})=>safe(()=>{
    const ref=chosen().find(e=>e.type==='block'&&e.dynamic);
    if(!ref)throw Error('동적 블록 참조를 하나 선택하세요.');
    const found=dynamicDefinition(engine.doc,ref);
    if(!found)throw Error('이 블록의 동적 블록 정의가 도면에 없습니다.');
    const editor=dynamicEditor(found.definition.dynamic,ref.dynamic.values||{});
    form('동적 블록 · '+found.source,editor.fields,cardFormApply(v=>{
     const values=dynamicEditorValues(editor.params,v);
     execute({type:'update',ids:[ref.id],changes:dynamicChanges(engine.doc,ref,values)});
    }));
   })).catch(error=>toast(userErrorMessage(error),true));return;
  }
  if(ARCH_LINKS[name]){run(ARCH_LINKS[name]);if(name==='CLN')params.centerline=true;return;}
  if(name==='WCD'){safe(()=>{const es=chosen();if(es.every(e=>e.type==='wall')&&es.length){run('WALLCENTER');return;}const wall=parallelWallPair(es);addEntities([{type:'line',points:wall.center,linetype:'CENTER'}]);});return;}
  if(name==='WOT'){if(!chosen().length){reset();mode='WOT';phase='select';updatePrompt();canvas.focus();return;}safe(()=>{const es=chosen();if(es.length===1&&es[0].type==='wall'){run('OPENING');return;}const pair=parallelWallPair(es),ids=es.map(e=>e.id);form('평행 벽선 개구부 · 원본 선 분할',[{name:'offset',label:'공통 벽 구간 시작에서 거리 (mm)',value:0,type:'number'},{name:'width',label:'개구부 폭 (mm)',value:Math.min(900,pair.hi-pair.lo),type:'number'}],v=>{const result=wallLineOpening(engine.selected(ids),Number(v.offset),Number(v.width));execute({type:'batch',commands:[{type:'delete',ids},{type:'addMany',entities:result}]});});});return;}
  if(name==='WALDRAW'){openWallPreset();return;}
  if(cardCommands[name]){runCardCommand(name);return;}
  if(name==='ARCHLIB'||name==='BUILDING'){architectureCatalog();return;}
  if(ARCH_LIBRARY[name]){openArchitecturalDetail(name);return;}
  if (busy) return;
  if(!cursor&&lastDrawingPointer)cursor={...lastDrawingPointer};
  run.recent=[...(run.recent||[]),name].slice(-5);
  try {
    // 오토캐드처럼: 고른 객체가 없으면 객체를 고르게 하고 Enter 에 분리한다.
    if(name==='LAYISO'){if(!selected.size){reset();mode='LAYISO';phase='select';lastCommand=name;updatePrompt();canvas.focus();return;}isolateSelectedLayers();return;}
    // LAYON 은 켜기만(동결은 THAW 로 따로 푼다 · 오토캐드와 같게).
    if(name==='LAYON'){engine.execute({type:'batch',commands:engine.doc.layers.map(l=>({type:'layer.update',id:l.id,changes:{visible:true}}))});refresh();return;}
    if(name==='LAYRESTORE'&&typeof s7Tools==='object'&&s7Tools&&(engine.doc.layerStates?.['*LAYISO']||isolatedLayerState)){s7Tools.unisolate(isolatedLayerState);isolatedLayerState=null;refresh();return;}
    if(name==='LAYRESTORE'){if(!isolatedLayerState)throw Error('복원할 레이어 표시 상태가 없습니다.');engine.execute({type:'batch',commands:isolatedLayerState.filter(l=>engine.doc.layers.some(a=>a.id===l.id)).map(l=>({type:'layer.update',id:l.id,changes:{visible:l.visible,frozen:!!l.frozen}}))});isolatedLayerState=null;refresh();return;}
    if(name==='REFEDIT'){startBlockEdit();return;}
    if(name==='BEDIT'){blockEditorDialog();return;}
    if(name==='REFCLOSE'){if(typeof blockEdit!=='undefined'&&blockEdit)closeBlockEdit(true);else toast('편집 중인 블록이 없습니다.');return;}
    if (name === "PDF") { plotDialog(); return; }
    // 연속·기준 치수는 화면에서 바로 찍는다(예전 좌표 입력 창 대신).
    if(name==='DIMCONTINUE'||name==='DIMBASELINE'){
      const preset=chosen().find(e=>e.type==='dimension'&&LINEAR_DIM_MODES.includes(e.mode)),base=preset||linearDimension(run.lastDimId);
      reset();mode=name;phase=base?'point':'dim-pick';params.baseDim=base;lastCommand=name;updatePrompt();canvas.focus();return;
    }
    if (studio.run(name)) return;
    if(name==='AIDRAWANIM'){draftingWaitSerial++;if(draftingWaitModule)draftingWaitModule.then(frame=>frame.closeDraftingWait()).catch(()=>{});const enabled=!aiDrawRevealEnabled();aiDrawRevealSetting=enabled;try{localStorage.setItem('barun.aiDrawReveal',enabled?'1':'0');}catch{}if(typeof aiReveal!=='undefined'&&aiReveal)finishAIReveal();log('AI 그리기 연출 '+(enabled?'켬':'끔'));return;}
    if(name==='REGEN'){sceneKey=null;render();return;}
    if(name==='UCSICON'){ucsIconSetting=!ucsIconOn();try{localStorage.setItem('barun.ucsIcon',ucsIconSetting?'1':'0');}catch{}sceneKey=null;render();log('원점 표시(UCSICON) '+(ucsIconSetting?'켬':'끔'));return;}
    if(name==='INSULATION'){const sourceIds=chosen().filter(e=>['line','polyline','rectangle','arc','circle'].includes(e.type)).map(e=>e.id);reset();mode=name;phase='insulation-thickness';params={depth:100,side:'center',sourceIds};lastCommand=name;updatePrompt();render();return;}
    // 고른 객체가 있으면 바로 복사. 없으면 오토캐드처럼 '객체 선택' → 클릭·드래그로 고르고 Enter·우클릭으로 복사한다(startSelected).
    if(name==='PASTEBLOCK'){if(!cadClipboard)throw Error('먼저 Ctrl+C로 CAD 객체를 복사하세요.');reset();mode='PASTECLIP';phase='point';params.asBlock=true;lastCommand=name;updatePrompt();canvas.focus();return;}
    if(name==='PASTEORIG'){if(!cadClipboard)throw Error('먼저 Ctrl+C로 CAD 객체를 복사하세요.');reset();mode='PASTECLIP';phase='point';accept({...cadClipboard.base});return;}
    // 그리기 순서: 문자·치수 맨 앞, 해치 맨 뒤는 바로. DRAWORDER 는 고른 객체를 [위(A)/아래(U)/맨 앞(F)/맨 뒤(B)] <B>.
    if(name==='TEXTTOFRONT'||name==='HATCHTOBACK'){const types=name==='TEXTTOFRONT'?['text','mtext','dimension']:['hatch'];const ids=engine.doc.entities.filter(e=>types.includes(e.type)).map(e=>e.id);if(!ids.length)throw Error(name==='TEXTTOFRONT'?'문자·치수가 없습니다.':'해치가 없습니다.');execute({type:'draworder',ids,position:name==='TEXTTOFRONT'?'front':'back'});log(`${ids.length}개 ${name==='TEXTTOFRONT'?'맨 앞으로':'맨 뒤로'}`);refresh();return;}
    if(name==='DRAWORDER'){if(!selected.size){reset();mode=name;phase='select';lastCommand=name;updatePrompt();canvas.focus();return;}params.drawIds=[...selected];reset();mode=name;params.drawIds=[...selected];phase='draworder-option';lastCommand=name;updatePrompt();return;}
    // AutoCAD 소거·중복 객체 삭제·도면 검사(drawing-cleanup.js 가 계획, 실행은 batch 한 번 = 되돌리기 한 단계).
    if(name==='PURGE'){purgeDialog();return;}
    if(name==='OVERKILL'){const ids=selected.size?[...selected]:null;reset();mode=name;lastCommand=name;params.overkill={ids,tolerance:run.overkillTolerance??0.01,ignoreLayer:!!run.overkillIgnoreLayer,endToEnd:!!run.overkillEndToEnd};phase=ids?'overkill-tolerance':'select';updatePrompt();canvas.focus();return;}
    if(name==='AUDIT'){startAudit();return;}
    if(name==='DELIVERYCHECK'){deliveryCheckDialog();return;}
    if(name==='WALKIN'){openReview3D('walk').catch(e=>toast(e.message,true));return;}
    if(name==='OOPS'){if(!run.lastErased?.length)throw Error('되살릴 지운 객체가 없습니다.');addEntities(run.lastErased.map(({id,...rest})=>rest));log(`${run.lastErased.length}개를 되살렸습니다.`);run.lastErased=null;return;}
    if(['COPYCLIP','CUTCLIP'].includes(name)&&selected.size){
      copySelection();if(name==='CUTCLIP'){execute({type:'delete',ids:[...selected]});selected.clear();refresh();}return;
    }
    // PDF 가져오기(오토캐드 PDFIMPORT): 파일 → 쪽 번호 → 축척 → 삽입점. 벡터만 객체로, 그림은 건너뛴다.
    if(name==='PDFIMPORT'){
      studio.pickFiles('.pdf',false,async files=>{const file=files[0];if(!file)return;
        if(file.size>150_000_000)throw Error('PDF 파일은 150 MB 이하만 가져올 수 있습니다.');
        const data=await studio.b64(file);
        reset();mode='PDFIMPORT';phase='pdf-page';params={pdfData:data,pdfName:file.name,pdfPage:1,pdfScale:1};lastCommand=name;updatePrompt();render();canvas.focus();});
      return;
    }
    if(name==='PASTECLIP'){
      if(!cadClipboard)throw Error('먼저 Ctrl+C로 CAD 객체를 복사하세요.');
      reset();mode=name;phase='point';updatePrompt();return;
    }
    if(name==='COPYBASE'){
      if(!selected.size)throw Error('복사할 객체를 먼저 선택하세요.');
      reset();mode=name;phase='point';updatePrompt();return;
    }
    if(['XLINE','RAY','SPLINE','REVCLOUD','BOUNDARY'].includes(name)){reset();mode=name;phase='point';lastCommand=name;updatePrompt();canvas.focus();return;}
    if(name==='DONUT'){reset();mode=name;phase='donut-inner';lastCommand=name;updatePrompt();canvas.focus();return;}
    if(name==='MATCHPROP'&&selected.size===1){const source=structuredClone(chosen()[0]);reset();mode=name;params.source=source;phase='select';lastCommand=name;updatePrompt();canvas.focus();return;}
    if(['PAN','POINT','ID','POLYGON','MATCHPROP'].includes(name)){
      reset();mode=name;phase=name==='POLYGON'?'polygon-sides':'point';lastCommand=name;updatePrompt();canvas.focus();return;
    }
    if (name === "SELECT") {
      cancelSelection();
      return;
    }
    if (name === "SAVE" || name === "DXFOUT") {
      saveNow();                   // 이름이 정해진 도면은 묻지 않고 바로 저장
      return;
    }
    if (name === "SAVEAS") {
      openSaveDialog(true);
      return;
    }
    if (name === "BACKUP") {
      backup();
      return;
    }
    if (name === "OPEN") {
      if(window.cadDesktop?.pickDrawingFiles){
        window.cadDesktop.pickDrawingFiles().then(paths=>openExternalDrawingPaths(paths)).catch(error=>toast('도면 열기 실패: '+error.message,true));
      }else $("file").click();
      return;
    }
    if (name === "SETTINGS") {
      showSettings();
      return;
    }
    if (name === "HELP") {
      showHelp();
      return;
    }
    if (name === "LAYER") {
      // 오토캐드 LAYER = 레이어 관리자. 예전 현재 레이어 설정 창은 -LAYER 로 남긴다.
      if(String($('coordinate')?.value||'').trim().startsWith('-'))editLayers();else openLayerManager();
      return;
    }
    if (name === "PLOT" || name === "PDF") {
      plotDialog();
      return;
    }
    if (name === "ZOOM") { reset(); mode="ZOOM"; phase="zoom"; lastCommand="ZOOM"; updatePrompt(); render(); return; }
    if(name==='OFFSET'){reset();mode='OFFSET';phase='number';lastCommand=name;updatePrompt();canvas.focus();return;}
    if (name === "FIT") {
      fit();
      return;
    }
    if (name === "UNDO" || name === "REDO") {
      reset();
      execute({ type: name.toLowerCase() });
      return;
    }
    if (name === "NEW") {
      openDrawingTab(newDrawingDocument(), nextDrawingName(), false);
      return;
    }
    const areaOutline=name==='AREAOUTLINE';
    if(areaOutline)name='PLINE';
    if(mode==='EYEPOINT')settleEyePoint(null);
    mode = name;
    phase = "point";
    points = [];
    params = {areaOutline};
    log("명령: " + name);
    $("coordinate").value = "";
    // 미리 고른 객체가 있으면 그 객체 전체를 늘리기 대상으로(오토캐드 PICKFIRST), 없으면 걸침 선택창부터.
    if (name === "STRETCH") {const pre=chosen();if(pre.length){params.targets=pre.map(e=>({id:e.id,indices:(e.points||[]).map((_,i)=>i),center:!!e.center,position:!!e.position}));phase='point';}else{phase = "window";selected.clear();params.targets=[];}}
    // FILLET·CHAMFER 는 오토캐드처럼 미리 고른 객체를 쓰지 않는다(첫 번째·두 번째 객체를 찍게). 예전에는 고른 두 선을 바로 깎아 의도와 다르게 바뀌었다.
    else if (['FILLET','CHAMFER'].includes(name)) { setSelected([]); phase = 'select'; }
    else if (['DIMRADIUS','DIMDIAMETER'].includes(name)) {const pre=chosen();if(pre.length===1&&['circle','arc'].includes(pre[0].type))params.circle=structuredClone(pre[0]);}
    else if (selectionCommands.has(name)) startSelected();
    else if (["WALL", "DOOR", "WINDOW", "STAIR"].includes(name))
      phase = "number";
    else if (name === "INSERT") {
      if (!engine.doc.blocks.length)
        throw Error("블록 정의가 없습니다. 먼저 BLOCK으로 만드세요.");
      phase = "name";
    }
    updatePrompt();
    render();
    // 도구막대 버튼으로 명령을 시작해도 다음 클릭과 Enter는 도면 명령으로 받는다.
    // 버튼에 초점이 남으면 Enter가 버튼을 다시 눌러 명령이 재시작되는 문제가 생긴다.
    canvas.focus();
  } catch (e) {
    toast(e.message, true);
    reset();
  }
}
function draftLinearDimension(p) {
  return styledDimension({type:'dimension',points:[...points.map(q=>({x:q.x,y:q.y})),{x:p.x,y:p.y}],mode:dimensionMode(points[0],points[1],p),
    ...(Number.isFinite(params.dimAxisAngle)?{axisAngle:params.dimAxisAngle}:{}),
    ...(Number.isFinite(params.dimTextAngle)?{textRotation:params.dimTextAngle}:{}),
    ...(params.dimText!==undefined?{text:params.dimText}:{})});
}
function radialDimension(p) {
  const e=params.circle;
  if(G.dist(e.center,p)<=G.EPS)throw Error('치수선 위치를 중심 밖에 지정하세요.');
  return styledDimension({...buildSmartDimension({kind:mode==='DIMRADIUS'?'radius':'diameter',...e},p),
    ...(params.dimText!==undefined?{text:params.dimText}:{}),
    ...(Number.isFinite(params.dimTextAngle)?{textRotation:params.dimTextAngle}:{})});
}
function selectDimensionObject(p) {
  const hit=pick(p);if(!hit)throw Error('선을 클릭하세요.');
  let best=null,d=Infinity;
  for(const seg of G.segments(hit)||[]){const k=G.entityDistance({type:'line',points:seg},p);if(k<d){d=k;best=seg;}}
  if(hit.type==='circle')best=[G.add(hit.center,{x:-hit.radius,y:0}),G.add(hit.center,{x:hit.radius,y:0})];
  if(!best||G.dist(...best)<=G.EPS)throw Error('길이가 있는 선·폴리선·원을 클릭하세요.');
  points=best.map(q=>snapSource({x:q.x,y:q.y},hit.id));phase='point';updatePrompt();render();
}
function dimensionOption(value, option=value.trim().toUpperCase()) {
  if(!(['DIMLINEAR','DIMALIGNED'].includes(mode)&&points.length===2)&&!(['DIMRADIUS','DIMDIAMETER'].includes(mode)&&params.circle))return false;
  option=({MTEXT:'M',TEXT:'T',ANGLE:'A',HORIZONTAL:'H',VERTICAL:'V',ROTATED:'R'})[option]||option;
  if(['dim-text','dim-mtext'].includes(phase)){params.dimText=phase==='dim-mtext'?value.replaceAll('\\P','\n'):value;phase='point';return true;}
  if(['dim-text-angle','dim-rotation'].includes(phase)){
    const angle=Number(value);if(!value.trim()||!Number.isFinite(angle))throw Error('각도를 숫자로 입력하세요.');
    if(phase==='dim-text-angle')params.dimTextAngle=angle;
    else {params.dimAxisAngle=angle;params.dimForce='horizontal';}
    phase='point';return true;
  }
  if(['M','T'].includes(option)){phase=option==='M'?'dim-mtext':'dim-text';return true;}
  if(option==='A'){phase='dim-text-angle';return true;}
  if(mode==='DIMLINEAR'&&option==='R'){phase='dim-rotation';return true;}
  if(mode==='DIMLINEAR'&&['H','V'].includes(option)){params.dimForce=option==='H'?'horizontal':'vertical';delete params.dimAxisAngle;return true;}
  return false;
}
function dimensionMode(a, b, p) {
  if (mode === "DIMALIGNED") return "aligned";
  if (typeof params !== "undefined" && params?.dimForce) return params.dimForce; // H/V 옵션
  const loX = Math.min(a.x, b.x),
    hiX = Math.max(a.x, b.x),
    loY = Math.min(a.y, b.y),
    hiY = Math.max(a.y, b.y);
  if (Math.abs(a.x - b.x) < G.EPS) return "vertical";
  if (Math.abs(a.y - b.y) < G.EPS) return "horizontal";
  return p.y < loY || p.y > hiY
    ? "horizontal"
    : p.x < loX || p.x > hiX
      ? "vertical"
      : "horizontal";
}
function hatchBoundaryDocument(point){
 const doc=engine.doc;if(doc.entities.length<=20000||typeof G.spatialIndex!=='function')return doc;
 const a=world({x:0,y:height}),b=world({x:width,y:0}),w=Math.max(b.x-a.x,1),h=Math.max(b.y-a.y,1);
 const box={minX:Math.min(a.x,point.x)-w*.5,minY:Math.min(a.y,point.y)-h*.5,maxX:Math.max(b.x,point.x)+w*.5,maxY:Math.max(b.y,point.y)+h*.5};
 if(renderSpatialRevision!==sceneRevision){renderSpatial=G.spatialIndex(doc.entities);renderSpatialRevision=sceneRevision;}
 const entities=renderSpatial.query(box);
 return entities.length>=doc.entities.length?doc:{...doc,entities};
}
/* HATCH 옵션(AutoCAD 「내부 점 선택 또는 [객체 선택(S)/원점(O)/연관(A)/간격 허용(G)/설정(T)]」). 처리했으면 true. */
function hatchOption(option){
 if(busy)return false;
 if(phase==='hatch-gap'){
  if(option!==''){const v=Number(option.replace(/,/g,''));if(!Number.isFinite(v)||v<0||v>5000)throw Error('간격 허용 값은 0 이상 5000 이하 숫자입니다.');run.hatchGapTolerance=v;
   log(v?`간격 허용 ${fmt(v)} — 이 길이 이하로 끊긴 경계는 이어서 찾습니다.`:'간격 허용 0 — 완전히 닫힌 경계만 찾습니다.');}
  phase='hatch-inside';return true;
 }
 if(phase==='hatch-origin'){
  if(['D','DEFAULT'].includes(option)){run.hatchOrigin=null;log('해치 원점: 기본(0,0)');phase='hatch-inside';return true;}
  if(option===''){phase='hatch-inside';return true;}
  return false; // X,Y 좌표는 일반 점 입력으로 accept → applyHatchOrigin
 }
 if(phase!=='hatch-inside')return false;
 if(['S','SELECT'].includes(option)){setSelected([]);params.hatchSelect=true;phase='select';log('해치 경계 객체 선택: 닫힌 폴리선·사각형·원·타원을 클릭·드래그로 고르고 Enter');return true;}
 if(['O','ORIGIN'].includes(option)){phase='hatch-origin';return true;}
 if(['G','GAP'].includes(option)){phase='hatch-gap';return true;}
 if(['T','SETTINGS'].includes(option)){
  // 다음 영역(또는 객체 선택)에서 무늬·색상·축척 창을 다시 연다. 지금까지 만든 해치는 그대로 두고 새 해치로 시작한다.
  params.hatchStyle=null;params.hatchId=null;params.hatchDoc=null;log('설정: 다음 영역을 클릭하거나 객체를 고르면 무늬·색상·축척 창이 열립니다.');return true;
 }
 // 연관(A, HPASSOC): 객체 선택(S)으로 만든 해치는 경계를 고치면 따라간다(엔진이 같은 명령 안에서 다시 계산). 섬(I, HPISLANDDETECTION).
 if(['A','ASSOCIATIVE'].includes(option)){const next=1-S4.editVar('HPASSOC');S4.setEditVar('HPASSOC',next);log(next?'연관 해치: 객체 선택(S)으로 만든 해치가 경계를 따라갑니다.':'연관 해치 끔: 경계를 고쳐도 해치는 그대로입니다.');return true;}
 if(['I','ISLAND'].includes(option)){const next=(S4.editVar('HPISLANDDETECTION')+1)%3;S4.setEditVar('HPISLANDDETECTION',next);run.hatchIsland=S4.islandModeOf(next);log(`섬 검출: ${['일반(섬 안 섬은 다시 채움)','바깥만','섬 무시(전부 채움)'][next]}`);return true;}
 return false;
}
function hatchOptionStatus(){
 const parts=[];if(run.hatchOrigin)parts.push(`원점 ${fmt(run.hatchOrigin.x)},${fmt(run.hatchOrigin.y)}`);if(S4.editVar('HPASSOC')!==1)parts.push('연관 끔');if(S4.editVar('HPISLANDDETECTION'))parts.push(['','섬 바깥만','섬 무시'][S4.editVar('HPISLANDDETECTION')]);if(Number(run.hatchGapTolerance)>0)parts.push(`간격 허용 ${fmt(Number(run.hatchGapTolerance))}`);
 return parts.length?` · ${parts.join(' · ')}`:'';
}
function hatchSelectPrompt(){
 const n=selected.size;if(n>2000)return `해치 경계 객체 선택 (${n}개) · Enter 해치 만들기 · Shift 선택 제외`;
 let bad=0;for(const e of engine.selected([...selected]))if(!G.hatchSelectable(e))bad++;
 return `해치 경계 객체 선택: 닫힌 경계 ${n-bad}개${bad?` · 열린 객체 ${bad}개는 빠짐`:''} · 클릭·드래그로 추가 · Enter 해치 만들기 · Shift 선택 제외`;
}
/* O 원점: 다음 해치의 무늬 기준점. 이 명령에서 이미 만든 해치가 있으면 그 해치 무늬도 이 점에 맞춘다(되돌리기 한 단계). */
function applyHatchOrigin(p){
 if(!Number.isFinite(p?.x)||!Number.isFinite(p?.y))throw Error('원점 좌표를 확인하세요.');
 run.hatchOrigin={x:p.x,y:p.y};phase='hatch-inside';
 const current=params.hatchId&&!params.hatchStyle?.separate?engine.doc.entities.find(e=>e.id===params.hatchId&&e.type==='hatch'):null;
 if(current&&params.hatchStyle&&!current.solid){
  const v=params.hatchStyle,fields=hatchPatternFields(v.pattern,{scale:Number(v.scale),angle:Number(v.angle),origin:run.hatchOrigin});
  execute({type:'update',ids:[current.id],changes:{...fields,origin:{...run.hatchOrigin}}});params.hatchDoc=engine.doc;
 }
 log(`해치 원점: ${fmt(p.x)}, ${fmt(p.y)}`);updatePrompt();render();canvas.focus();
}
async function pickHatch(point,given=null){
 if(busy)return;
 const session=params;
 /* 한 번의 HATCH 명령에서 찍은 영역은 해치 하나(여러 경계 루프)로 묶는다 — AutoCAD 기본("개별 해치 작성" 끔)과 같다.
    선택·특성·Ctrl+Z 가 해치 하나 단위로 움직이고, 무늬 기준점이 같아 칸이 달라도 무늬가 이어진다. */
 const sessionHatch=()=>session.hatchId&&!session.hatchStyle?.separate?engine.doc.entities.find(e=>e.id===session.hatchId&&e.type==='hatch')||null:null;
 const existing=sessionHatch();
 if(!given&&existing&&G.hatchContains(existing,point)){toast('이미 이 해치에 들어간 영역입니다. 다른 영역을 클릭하거나 Enter 로 끝내세요.');return;}
 // 가볍게: 도면 바뀜은 객체 동일성으로 본다(엔진은 바뀔 때마다 새 도면 객체). 예전에는 찍을 때마다 도면 전체를 JSON 으로 세 번 만들었다.
 const snapshot=engine.doc;busy=true;if(!given)toast('닫힌 해치 경계를 찾는 중…');
 const hatchRun=typeof run==='function'?run:{};
 try{
  let boundary=given;
  if(!boundary){
   // 간격 허용(G · AutoCAD HPGAPTOL): 0 이 아니면 그 길이 이하로 끊긴 경계를 서버가 이어서 찾는다.
   const gap=Number(hatchRun.hatchGapTolerance)||0,body=document=>gap>0?{document,point,gapTolerance:gap}:{document,point};
   // 큰 도면은 오토캐드처럼 지금 화면(넉넉히 넓힌 범위)의 객체만 보내고, 경계를 못 찾으면 전체로 다시 찾는다.
   const local=typeof hatchBoundaryDocument==='function'?hatchBoundaryDocument(point):snapshot;
   try{boundary=await request('/api/hatch-boundary',body(local));}
   catch(error){if(local===snapshot)throw error;boundary=await request('/api/hatch-boundary',body(snapshot));}
  }
  if(mode!=='HATCH'||params!==session||engine.doc!==snapshot)return;
  if(!given&&hatchRun.hatchIsland==='ignore'&&boundary?.loops?.length)boundary={...boundary,loops:[]}; // 섬 무시(I)
  busy=false;
  const build=v=>{const origin=hatchRun.hatchOrigin?{x:hatchRun.hatchOrigin.x,y:hatchRun.hatchOrigin.y}:null; // 원점(O · AutoCAD HPORIGIN)
   const fields=hatchPatternFields(v.pattern,{scale:Number(v.scale),angle:Number(v.angle),origin});for(const key of Object.keys(fields))if(fields[key]==null)delete fields[key];
   return {type:'hatch',...boundary,...fields,...(origin&&!fields.solid?{origin}:{}),color:v.color,layer:activeLayer};};
  const applyHatch=v=>{
    if(typeof run==='function')run.hatchDefaults={pattern:v.pattern,scale:v.scale,angle:v.angle}; // 다음 HATCH 의 기본값(오토캐드 HPNAME·HPSCALE·HPANG)
   if(mode!=='HATCH'||params!==session||engine.doc!==snapshot)throw Error('도면이나 명령이 변경되었습니다. 영역을 다시 선택하세요.');
   session.hatchStyle={...v};
   const current=sessionHatch();
   if(current){
    const before=engine.doc;
    // 연관 해치에 영역을 더하면: 둘 다 객체 선택이면 원본 목록을 합치고, 아니면 연결을 끊는다(더한 영역이 사라지지 않게).
    const assoc=current.boundaryIds?{boundaryIds:boundary.boundaryIds?[...new Set([...current.boundaryIds,...boundary.boundaryIds])]:null}:{};
    execute({type:'update',ids:[current.id],changes:{...G.mergeHatchBoundary(current,boundary),...assoc}});
    if(session.hatchDoc===before)engine.mergeLastUndo(before);
    setSelected([current.id]);
   }else{
    const ids=addEntities([build(v)]);setSelected(ids);session.hatchId=ids[0];
   }
   session.hatchDoc=engine.doc;updatePrompt();render();canvas.focus();
   const count=current?G.hatchRegions(engine.doc.entities.find(e=>e.id===current.id)||current).length:1;
   toast(current?`같은 해치에 영역을 더했습니다(영역 ${count}개 · 해치 1개). 다음 영역을 클릭하거나 Enter 로 끝냅니다.`:'해치를 추가했습니다. 다음 영역을 클릭하면 같은 해치에 더해집니다. Enter·Esc 로 끝냅니다.');
  };
  if(session.hatchStyle){applyHatch(session.hatchStyle);return;}
  form('해치 선택 · 무늬 / 색상 / 스케일',[
   {name:'pattern',label:'해치 무늬 (표준 172종)',value:(typeof run==='function'?run.hatchDefaults:null)?.pattern||'lines',options:hatchPatternChoices()},
   {name:'color',label:'해치 색상',type:'color',value:engine.doc.layers.find(l=>l.id===activeLayer)?.color||'#79d4ff'},
   {name:'scale',label:'축척 (바른 사선·교차선: 1 = 간격 100mm · 표준 무늬: 도면 축척값, 1:100 이면 100)',type:'number',value:(typeof run==='function'?run.hatchDefaults:null)?.scale??1},
   {name:'angle',label:'각도 (도) · 표준 무늬는 무늬 자체 각도에 더함(ANSI31 은 0 이 45° 사선)',type:'number',value:(typeof run==='function'?run.hatchDefaults:null)?.angle??45},
   {name:'separate',label:'영역마다 따로 해치 만들기 (AutoCAD 「개별 해치 작성」 · 기본 끔: 한 번에 찍은 영역은 해치 하나)',type:'checkbox',value:false}
  ],applyHatch);
  const submit=$('form-dialog').querySelector('[type="submit"]');if(submit)submit.textContent='적용 후 계속 추가';
  // 바른 사선(lines)은 각도 45 가 사선, 표준 무늬(ANSI31 등)는 무늬 자체가 이미 기울어 있어 0 이 맞다. 바꿀 때 각도를 맞춰 준다.
  {const form=typeof $==='function'?$('property-form'):null,patternField=form?.elements.pattern,angleField=form?.elements.angle;
   patternField?.addEventListener('change',()=>{const simple=['lines','cross'].includes(String(patternField.value).toLowerCase());if(!simple&&angleField.value==='45')angleField.value='0';else if(simple&&angleField.value==='0')angleField.value='45';angleField.dispatchEvent(new Event('input',{bubbles:true}));});}
  const preview=document.createElement('canvas');preview.width=600;preview.height=240;preview.style.cssText='width:100%;max-height:240px;background:#101820';preview.setAttribute('aria-label','해치 미리보기');$('form-fields').prepend(preview);
  const redraw=()=>{try{const values=Object.fromEntries(new FormData($('property-form'))),entity=build(values),box=fitPreviewCanvas(preview),b=G.bounds([entity]);
   const k=Math.min((box.width-32)/Math.max(1,b.maxX-b.minX),(box.height-32)/Math.max(1,b.maxY-b.minY));
   drawEntity(box.context,entity,p=>({x:box.width/2+(p.x-(b.minX+b.maxX)/2)*k,y:box.height/2-(p.y-(b.minY+b.maxY)/2)*k}),k,entity.color);
   $('form-error').textContent='';}catch(e){$('form-error').textContent=userErrorMessage(e);}};
  for(const input of $('form-fields').querySelectorAll('input,select'))input.addEventListener('input',redraw);redraw();
  requestAnimationFrame(redraw);
  if(window.ResizeObserver)new ResizeObserver(()=>redraw()).observe(preview);
 }catch(e){toast(e.message,true);}finally{busy=false;}
}
/* RECTANGLE 반대 꼭짓점(H62 · 훈민 4B/4BB): 가로를 숫자로 넣었으면 세로만 커서로, 정사각형이면 긴 쪽 길이로 맞춘다. */
function rectangleCorner(a,p){
 // D(치수): 길이·폭이 정해졌으면 클릭한 쪽(사분면)으로만 정한다(오토캐드).
 if(params?.rectDims?.width!=null){const u=rectAxes(),d=G.sub(p,a),sx=(d.x*u.x.x+d.y*u.x.y)<0?-1:1,sy=(d.x*u.y.x+d.y*u.y.y)<0?-1:1;return G.add(a,G.add(G.mul(u.x,sx*params.rectDims.length),G.mul(u.y,sy*params.rectDims.width)));}
 if(params?.rectWidth!=null)return {x:a.x+(params.rectSign?.x||1)*params.rectWidth,y:p.y};
 if(params?.rectSquare){const dx=p.x-a.x,dy=p.y-a.y,side=Math.max(Math.abs(dx),Math.abs(dy));return {x:a.x+(dx<0?-1:1)*side,y:a.y+(dy<0?-1:1)*side};}
 return p;
}
/* REC R(회전): 사각형 축 방향(회전 0 이면 x·y 축). */
function rectAxes(){const r=(params?.rectRotation??run.rectRotation??0)*Math.PI/180;return {x:{x:Math.cos(r),y:Math.sin(r)},y:{x:-Math.sin(r),y:Math.cos(r)}};}
function rectStyleLabel(){const parts=[];if(run.rectFillet)parts.push(`모깎기 ${fmt(run.rectFillet)}`);if(run.rectChamfer?.[0])parts.push(`모따기 ${fmt(run.rectChamfer[0])}×${fmt(run.rectChamfer[1]??run.rectChamfer[0])}`);if(run.rectLineWidth)parts.push(`폭 ${fmt(run.rectLineWidth)}`);return parts.length?` (${parts.join(', ')})`:'';}
/* 기억한 모깎기·모따기·선 폭을 사각형에 입힌다(모서리가 변보다 크면 그 모서리는 그대로). */
function styledRectangle(entity){
 let e=entity;
 if(run.rectFillet>0||run.rectChamfer?.[0]>0){
  const poly={...e,type:'polyline',closed:true},chamfer=!(run.rectFillet>0);
  e=G.polylineCorners(poly,chamfer?run.rectChamfer[0]:run.rectFillet,chamfer,chamfer?{size2:run.rectChamfer[1]??run.rectChamfer[0]}:{}).entity;
 }
 if(run.rectLineWidth>0)e={...e,type:'polyline',closed:true,constantWidth:run.rectLineWidth};
 return e;
}
function rectangleEntity(a,corner){
 const rot=params?.rectRotation??run.rectRotation??0;
 if(!rot)return {type:'rectangle',points:G.rectangle(a,corner)};
 const u=rectAxes(),d=G.sub(corner,a),lx=d.x*u.x.x+d.y*u.x.y,ly=d.x*u.y.x+d.y*u.y.y;
 return {type:'polyline',closed:true,points:[a,G.add(a,G.mul(u.x,lx)),G.add(a,G.add(G.mul(u.x,lx),G.mul(u.y,ly))),G.add(a,G.mul(u.y,ly))]};
}
/* MOVE·COPY 기준점에서 Enter/P: 마지막으로 옮긴 방향·거리를 그대로 한 번 더. */
function repeatDisplacement(){
 const {dx,dy}=lastDisplacement,sources=[...selected];
 if(!sources.length)throw Error('옮길 객체를 선택하세요.');
 const copy=mode==='COPY',ids=execute({type:copy?'copy':'move',ids:sources,dx,dy});
 log(`${copy?'복사':'이동'} · 이전 변위 @${coordText(dx)},${coordText(dy)}`);
 commandDone(copy?sources:ids);reset();
}
/* ROTATE R(참조, 오토캐드 Reference): 지금 각도(두 끝점 또는 L 선) → 새 각도(숫자·방향 점·L 맞출 선).
   회전량 = 새 각도 - 참조 각도. 선으로 고른 각도는 방향이 없으므로 가장 작은 회전(±90° 안)으로 맞춘다. */
function rotateByReference(newAngle,undirected=false){
 const delta=rotateDelta(newAngle,undirected),base=points[0];
 const ids=transformSelection('rotate',{base,angle:delta});reset();commandDone(ids);log(`참조 회전 ${fmt(delta)}°`);
}
function pickedLineAngle(p){
 const hit=pick(p);if(!hit)throw Error('선을 클릭하세요.');
 let best=null,distance=Infinity;
 for(const segment of G.segments(hit)||[]){const d=G.entityDistance({type:'line',points:segment},p);if(d<distance){distance=d;best=segment;}}
 if(!best||G.len(G.sub(best[1],best[0]))<G.EPS)throw Error('직선이나 폴리선을 클릭하세요.');
 return G.angle(G.sub(best[1],best[0]));
}
function acceptRotateReference(p){
 const r=params.rotateRef;
 if(r.stage==='ref1'){r.a=p;r.stage='ref2';}
 else if(r.stage==='ref2'){if(G.len(G.sub(p,r.a))<G.EPS)throw Error('두 점이 같습니다. 다른 끝점을 찍으세요.');r.refAngle=G.angle(G.sub(p,r.a));run.rotateRefAngle=r.refAngle;r.stage='new';phase='point';}
 else if(r.stage==='ref-line'){r.refAngle=pickedLineAngle(p);r.undirected=true;r.stage='new';phase='point';}
 else if(r.stage==='new-line'){rotateByReference(pickedLineAngle(p),true);return;}
 else if(r.stage==='new'){rotateByReference(G.angle(G.sub(p,points[0])));return;}
 updatePrompt();render();
}
/* 수정 명령이 끝나면 선택을 푼다(오토캐드). 결과 객체는 '이전 선택(P)'으로 다시 고를 수 있다. */
function commandDone(ids){previousSelection=[...(ids||[])];if(typeof selected!=='undefined'&&selected)selected.clear();}
/* DIMCONTINUE(DCO)·DIMBASELINE(DBA): 마지막 선형 치수(없으면 고른 치수)에서 클릭마다 이어 그린다(오토캐드). */
const LINEAR_DIM_MODES=['horizontal','vertical','aligned'];
function linearDimension(id){const e=engine.doc.entities.find(x=>x.id===id);return e?.type==='dimension'&&LINEAR_DIM_MODES.includes(e.mode)?e:null;}
function chainDimension(p){
 const base=params.baseDim,[p1,p2,loc]=base.points;
 let ps;
 if(mode==='DIMCONTINUE')ps=[p2,p,loc];
 else{
  const step=((params.baselineStep||0)+1)*(base.textHeight||getDimStyle(engine.doc)?.textHeight||150)*(base.scale||1)*2.5;
  const u=G.polar(1,base.axisAngle??(base.mode==='horizontal'?0:base.mode==='vertical'?90:G.angle(G.sub(p2,p1)))),n=G.normal(u),side=Math.sign(G.dot(G.sub(loc,p1),n)||1);
  ps=[p1,p,G.add(loc,G.mul(n,side*step))];
 }
 if(G.dist(ps[0],ps[1])<=G.EPS)throw Error('두 치수점이 같습니다.');
 const entity={...base,id:undefined,text:'',points:ps.map(q=>({x:q.x,y:q.y}))};
 delete entity.textPosition;delete entity.textTemplate;
 return entity;
}
function acceptChainDimension(p){
 if(phase==='dim-pick'){const hit=pick(p);if(!hit||hit.type!=='dimension'||!LINEAR_DIM_MODES.includes(hit.mode))throw Error('선형 치수를 클릭하세요.');params.baseDim=hit;phase='point';updatePrompt();render();return;}
 const entity=chainDimension(p);
 // 연관(ACAD200 513): 이어지는 첫 점은 기준 치수의 그 점 연관을 물려받고, 새 점은 스냅한 객체에 잇는다. 기준 치수의 끊기·끊김 표시는 물려받지 않는다.
 for(const key of ['assoc','assocLost','breakMode','breakBy'])delete entity[key];
 {const inherited=params.baseDim.assoc?.[mode==='DIMCONTINUE'?1:0]||null,picked=assocFromPicks([p],lookupIn(engine.doc.entities))?.[0]||null;if(inherited||picked)entity.assoc=[inherited,picked];}
 const ids=addEntities([entity]);
 if(mode==='DIMCONTINUE')params.baseDim=engine.doc.entities.find(e=>e.id===ids?.[0])||params.baseDim;
 else params.baselineStep=(params.baselineStep||0)+1;
 run.lastDimId=ids?.[0];updatePrompt();render();
}
/* 뜨거운 그립: 모드별 명령. 신축은 그 그립, 나머지는 고른 객체 전체를 그립 점 기준으로. */
const GRIP_OPS=['stretch','move','rotate','scale','mirror'],GRIP_LABELS={stretch:'신축',move:'이동',rotate:'회전',scale:'축척',mirror:'대칭'};
function gripCommandFor(p,value=null){
 const base=points[0],ids=[...selected],op=params.op;
 if(op==='stretch'){const source=engine.doc.entities.find(e=>e.id===params.gripId);if(!source)throw Error('그립 객체가 없습니다.');return typeof gripDragCommand==='function'?gripDragCommand(source,{id:params.gripId,grip:params.grip,op:params.gripOp},p):G.gripCommand(source,params.grip,p);}   // 309·310
 if(op==='move')return {type:'move',ids,dx:p.x-base.x,dy:p.y-base.y};
 if(op==='rotate')return {type:'rotate',ids,base,angle:value??G.angle(G.sub(p,base))};
 if(op==='scale'){const factor=value??G.dist(base,p);if(!(factor>0))throw Error('축척 비율은 0보다 커야 합니다.');return {type:'scale',ids,base,factor};}
 return {type:'mirror',ids,a:base,b:p,mirrText:S4.editVar('MIRRTEXT')};
}
function acceptGrip(p,value=null){
 if(params.grip?.aiWall){
  if(params.op !== 'stretch' || params.gripCopy || params.gripBasePending)throw Error('AI 벽은 끝점·이동·두께 손잡이를 사용하세요.');
  const grip=params.grip;reset();applyWallGrip(grip,p);return;
 }
 // 기준점(B): 다음 점을 기준점으로만 쓴다.
 if(params.gripBasePending){points=[{...p}];params.gripBasePending=false;updatePrompt();render();return;}
 // 복사(C): 원본은 두고 복사본에 같은 변환을 한다. 명령에 머문다(오토캐드 다중 복사).
 if(params.gripCopy){
  const ids=[...selected],base=points[0],op=params.op;
  if(op==='stretch')throw Error('신축 복사는 지원하지 않습니다. Space 로 이동·회전·축척·대칭을 고르세요.');
  engine.beginTransaction?.();
  try{
   if(op==='move')execute({type:'copy',ids,dx:p.x-base.x,dy:p.y-base.y});
   else{const copies=execute({type:'copy',ids,dx:0,dy:0});const command=gripCommandFor(p,value);execute({...command,ids:copies});}
  }finally{engine.endTransaction?.();}
  params.gripDone=(params.gripDone||0)+1;setSelected(ids.filter(id=>engine.doc.entities.some(e=>e.id===id)));updatePrompt();render();return;
 }
 const command=gripCommandFor(p,value);const ids=[...selected];reset();execute(command);setSelected(ids.filter(id=>engine.doc.entities.some(e=>e.id===id)));
}
/* ROTATE·SCALE 의 C(복사): 원본은 두고 복사본을 돌리거나 키운다(오토캐드). 복사+변환은 되돌리기 한 번. */
function transformSelection(type,values){
 let ids=[...selected];
 if(!params.copyMode)return execute({type,ids,...values});
 engine.beginTransaction?.();
 try{ids=execute({type:'copy',ids,dx:0,dy:0});return execute({type,ids,...values});}
 finally{engine.endTransaction?.();}
}
/* ROTATE 참조: 회전량. 선(L)으로 고른 각도는 방향이 없으므로 가장 작은 회전(±90°)으로. 미리보기와 실행이 같은 계산을 쓴다. */
function mirrorFinish(erase){
 // MIRRTEXT(기본 0): 문자는 읽히는 방향으로 놓는다. 1 이면 예전처럼 거울 글자(MIRRTEXT 명령으로 바꿈).
 const ids=execute({type:'mirror',ids:[...selected],a:points[0],b:params.mirrorB,mirrText:S4.editVar('MIRRTEXT'),...(erase?{eraseSource:true}:{})});reset();commandDone(ids);
}
function rotateDelta(newAngle,undirected=false){
 const r=params.rotateRef;let delta=newAngle-(r?.refAngle||0);
 if(undirected||r?.undirected){delta=((delta%180)+180)%180;if(delta>90)delta-=180;}
 return delta;
}
/* SCALE 참조(R): 참조 길이(숫자 또는 두 점) → 새 길이(숫자, 기준점에서 찍은 점, 또는 P 뒤 두 점 — 오토캐드 Points). */
function acceptScaleReference(p){
 const r=params.scaleRef;
 if(r.stage==='ref1'){r.a=p;r.stage='ref2';}
 else if(r.stage==='ref2'){r.b=p;const length=G.dist(r.a,p);if(length<=G.EPS)throw Error('두 점이 같습니다.');r.length=length;run.scaleRefLength=length;r.stage='new';phase='point';}
 else if(r.stage==='new'){scaleByFactor(G.dist(points[0],p)/r.length);return;}
 else if(r.stage==='new1'){r.n1=p;r.stage='new2';}
 else if(r.stage==='new2'){const length=G.dist(r.n1,p);if(length<=G.EPS)throw Error('두 점이 같습니다.');scaleByFactor(length/r.length);return;}
 updatePrompt();render();
}
function scaleByFactor(factor){
 if(!(factor>0)||!Number.isFinite(factor))throw Error('축척 비율은 0보다 커야 합니다.');
 run.scaleFactor=factor;const base=points[0];const ids=transformSelection('scale',{base,factor});reset();commandDone(ids);log(`축척 ${fmt(factor)}`);
}
/* ARC: 오토캐드 방식들. 3P(기본: 시작·두 번째·끝), SCE(시작·중심·끝), CSE(중심·시작·끝), SER(시작·끝·반지름).
   중심을 쓰는 방식은 시작에서 끝까지 반시계 방향(오토캐드 기본). */
function arcFromInput(list){
 const mode=params.arcMode||'3P';
 const polar=(c,s,e)=>{const r=G.dist(c,s);if(r<=G.EPS)return null;return {type:'arc',center:c,radius:r,startAngle:G.angle(G.sub(s,c)),endAngle:G.angle(G.sub(e,c))};};
 if(mode==='3P')return list.length>=3?G.arcThrough(list[0],list[1],list[2]):null;
 if(mode==='SCE')return list.length>=3?polar(list[1],list[0],list[2]):null;
 if(mode==='CSE')return list.length>=3?polar(list[0],list[1],list[2]):null;
 if(mode==='TAN'&&list.length>=2)return tangentArc(list[0],params.arcTangent,list[1]);
 // 시작·중심·각도/현 길이(SCA·SCL), 중심·시작·각도/현 길이(CSA·CSL): 반시계(음수면 시계)로 돈다.
 if(['SCA','SCL','CSA','CSL'].includes(mode)&&list.length>=2&&Number.isFinite(params.arcValue)){
  const [s,c]=mode[0]==='S'?[list[0],list[1]]:[list[1],list[0]],r=G.dist(c,s);if(r<=G.EPS)return null;
  let sweep=params.arcValue;if(mode.endsWith('L')){if(Math.abs(params.arcValue)>2*r)return null;sweep=2*Math.asin(Math.abs(params.arcValue)/(2*r))*180/Math.PI*Math.sign(params.arcValue||1);}
  const a0=G.angle(G.sub(s,c)),a1=a0+sweep;return sweep>=0?{type:'arc',center:c,radius:r,startAngle:a0,endAngle:a1}:{type:'arc',center:c,radius:r,startAngle:a1,endAngle:a0};
 }
 // 시작·끝·사이각(SEA): 중심은 현의 수직이등분선 위.
 if(mode==='SEA'&&list.length>=2&&Number.isFinite(params.arcValue)){
  const [s,e]=list,d=G.dist(s,e),A=params.arcValue;if(d<=G.EPS||!A||Math.abs(A)>=360)return null;
  const r=d/(2*Math.sin(Math.abs(A)*Math.PI/360)),u=G.unit(G.sub(e,s)),mid={x:(s.x+e.x)/2,y:(s.y+e.y)/2},h=r*Math.cos(Math.abs(A)*Math.PI/360),n=A>0?{x:-u.y,y:u.x}:{x:u.y,y:-u.x},c=G.add(mid,G.mul(n,h)),a0=G.angle(G.sub(s,c)),a1=G.angle(G.sub(e,c));
  return A>0?{type:'arc',center:c,radius:r,startAngle:a0,endAngle:a1}:{type:'arc',center:c,radius:r,startAngle:a1,endAngle:a0};
 }
 // 시작·끝·방향(SED): 시작점에서 그 방향에 접하고 끝점을 지나는 호.
 if(mode==='SED'&&list.length>=3)return tangentArc(list[0],G.unit(G.sub(list[2],list[0])),list[1]);
 if(mode==='SER'&&list.length>=2&&params.arcRadius){
  const [s,e]=list,r=params.arcRadius,d=G.dist(s,e);if(d<=G.EPS||r<d/2-G.EPS)return null;
  const mid={x:(s.x+e.x)/2,y:(s.y+e.y)/2},u=G.unit(G.sub(e,s)),k=Math.sqrt(Math.max(0,r*r-d*d/4));
  return polar(G.add(mid,G.mul({x:-u.y,y:u.x},k)),s,e);
 }
 return null;
}
/* 시작점 S 에서 방향 t 에 접하고 E 를 지나는 호(오토캐드 LINE/ARC 이어 그리기). 엔진의 호는 시작각→끝각 반시계. */
function tangentArc(s,t,e){
 if(!t)return null;const d=G.sub(e,s),n={x:-t.y,y:t.x},nd=G.dot(n,d);
 if(Math.abs(nd)<=G.EPS||G.len(d)<=G.EPS)return null;
 const r=G.dot(d,d)/(2*nd),c=G.add(s,G.mul(n,r)),a0=G.angle(G.sub(s,c)),a1=G.angle(G.sub(e,c));
 return nd>0?{type:'arc',center:c,radius:Math.abs(r),startAngle:a0,endAngle:a1}:{type:'arc',center:c,radius:Math.abs(r),startAngle:a1,endAngle:a0};
}
/* 방금 그린 선·호의 끝점과 진행 방향 — 다음 LINE/ARC 첫 프롬프트 Enter 가 여기서 잇는다. */
function rememberDrawEnd(point,direction){if(point&&direction&&G.len(direction)>G.EPS)run.lastDrawEnd={point:{x:point.x,y:point.y},direction:G.unit(direction)};}
function arcEndDirection(arc,end){
 const at=a=>G.add(arc.center,G.polar(arc.radius,a)),r=a=>a*Math.PI/180;
 if(G.dist(at(arc.endAngle),end)<=G.dist(at(arc.startAngle),end))return {x:-Math.sin(r(arc.endAngle)),y:Math.cos(r(arc.endAngle))};
 return {x:Math.sin(r(arc.startAngle)),y:-Math.cos(r(arc.startAngle))};
}
function arcPrompt(n){
 const mode=params.arcMode||'3P';
 if(mode==='TAN')return '호의 끝점 지정(이전 선·호에 접하게 이어 그리기)';
 if(['SCA','CSA','SEA'].includes(mode)&&n>=2)return '사이각 지정(반시계 +, 시계 -)';
 if(['SCL','CSL'].includes(mode)&&n>=2)return '현의 길이 지정';
 if(mode==='SED'&&n>=2)return '호의 시작점 접선 방향 지정';
 if(['SCE','CSE'].includes(mode)&&n===2)return `호의 끝점 지정 또는 [각도(A)/현 길이(L)]`;
 if(mode==='SER'&&n===2)return `호의 반지름 지정 또는 [각도(A)/방향(D)]`;
 if(mode==='CSE')return ['호의 중심점 지정','호의 시작점 지정','호의 끝점 지정'][n];
 if(mode==='SCE')return ['호의 시작점 지정','호의 중심점 지정','호의 끝점 지정'][n];
 if(mode==='SER')return n<2?['호의 시작점 지정','호의 끝점 지정'][n]:`호의 반지름 지정${params.arcRadius?'':''}`;
 return ['호의 시작점 지정 또는 [중심(C)]','호의 두 번째 점 지정 또는 [중심(C)/끝(E)]','호의 끝점 지정'][n];
}
/* CIRCLE 2P(지름 양 끝)·3P(둘레 세 점) — 2P 는 두 점, 3P 는 세 점이 모이면 원을 만든다. */
function circleFromPoints(list){
 if(params.circleMode==='2P'&&list.length>=2){const [a,b]=list;const r=G.dist(a,b)/2;return r>G.EPS?{type:'circle',center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},radius:r}:null;}
 if(params.circleMode==='3P'&&list.length>=3){const arc=G.arcThrough(list[0],list[1],list[2]);return arc?.radius>G.EPS?{type:'circle',center:arc.center,radius:arc.radius}:null;}
 return null;
}
/* POLYGON: 내접(I)은 클릭한 점이 꼭짓점, 외접(C)은 클릭한 점이 변의 가운데(오토캐드). */
function polygonFromEdge(a,b){
 const n=params.sides||4,len=G.dist(a,b);if(len<=G.EPS)throw Error('모서리 길이는 양수여야 합니다.');
 const u=G.unit(G.sub(b,a)),pts=[{...a}];let cur={...b},dir=u;
 for(let i=1;i<n;i++){pts.push(cur);dir=G.polar(1,G.angle(dir)+360/n);cur=G.add(cur,G.mul(dir,len));}
 return {type:'polyline',closed:true,points:pts};
}
function polygonEntity(center,p){
 const n=params.sides||4,d=G.dist(center,p);if(d<=G.EPS)throw Error('반지름은 양수여야 합니다.');
 const angle=G.angle(G.sub(p,center)),radius=params.circumscribed?d/Math.cos(Math.PI/n):d,start=params.circumscribed?angle+180/n:angle;
 return {type:'polyline',closed:true,points:Array.from({length:n},(_,i)=>G.add(center,G.polar(radius,start+i*360/n)))};
}
function isolateSelectedLayers(){
 // ACAD200 704: 끄기/잠그고 흐리게 두 방식, 분리 전 상태는 도면(*LAYISO)에 저장 → 저장·다시 열어도 LAYUNISO 로 되돌린다. 되돌리기 한 번.
 if(typeof s7Tools==='object'&&s7Tools){const ids=new Set((typeof entitiesById==='function'?entitiesById(engine.doc.entities,selected):engine.doc.entities.filter(e=>selected.has(e.id))).map(e=>e.layer));const r=s7Tools.isolate(ids);isolatedLayerState=null;refresh();log(`레이어 분리(${r.mode==='lock'?'잠그고 흐리게':'끄기'}) · ${r.isolated}개 · LAYUNISO 로 되돌림 · 방식은 LAYISOSET`);return;}
 const ids=new Set(engine.doc.entities.filter(e=>selected.has(e.id)).map(e=>e.layer));if(!ids.size)throw Error('객체를 먼저 선택하세요.');
 if(!isolatedLayerState)isolatedLayerState=engine.doc.layers.map(l=>({id:l.id,visible:l.visible,frozen:l.frozen}));
 engine.execute({type:'batch',commands:engine.doc.layers.map(l=>({type:'layer.update',id:l.id,changes:{visible:ids.has(l.id),frozen:ids.has(l.id)?false:!!l.frozen}}))});
 refresh();log(`레이어 분리 · ${ids.size}개만 표시 · LAYUNISO 로 되돌림`);
}
/* BLOCK: 정의를 만들거나(재정의면 같은 이름 삽입본도 새 모양으로) 원래 객체를 유지·변환·삭제한다. 되돌리기 한 번. */
function createBlockFromSelection(code){
 const name=params.name,base=params.blockBase,ids=[...selected],modeName={R:'retain',C:'convert',D:'delete'}[code];
 const oldDef=params.redefine?engine.doc.blocks.find(b=>b.name===name):null;
 // 601·607: 기본은 공유 정의(정의 1개 + 참조). 예전 사본형 블록을 재정의할 때와 BLOCKSTORAGE=copy 이면 예전 방식.
 const shared=typeof blockStorageShared==='function'&&blockStorageShared()&&!(oldDef&&!oldDef.sharedBlock);
 const commands=[{type:'block.create',ids,base,name,mode:modeName,redefine:!!params.redefine,...(shared?{shared:true}:{})}];
 let updated=0,skipped=0;
 if(oldDef&&!shared&&typeof blockSimilarity==='function'){
  const newLocal=engine.selected(ids).map(e=>G.translate(structuredClone(e),-base.x,-base.y));
  for(const other of engine.doc.entities){
   if(other.type!=='block'||other.sharedBlock||other.name!==name||ids.includes(other.id))continue;
   const t=blockSimilarity(oldDef.entities,other.entities);if(!t){skipped++;continue;}
   commands.push({type:'update',ids:[other.id],changes:{entities:newLocal.map(e=>applyBlockSimilarity(e,t))}});updated++;
  }
 }
 if(shared&&oldDef)updated=buildSharedRefIndex(engine.doc).top.get(name)?.size||0;
 const result=execute(commands.length>1?{type:'batch',commands}:commands[0]);
 reset();if(modeName==='convert')setSelected(Array.isArray(result)?result.filter(id=>engine.doc.entities.some(e=>e.id===id&&e.type==='block')):[]);
 log(`블록 "${name}" ${oldDef?'재정의':'정의'}${updated?` · 삽입본 ${updated}개 갱신`:''}${skipped?` · 모양이 달라 ${skipped}개는 그대로`:''}`);
}
function insertBlockWith(factor,angle){
 run.insertRotation=angle;
 const name=params.name,position=points[0],definition=typeof sharedDefinitionForInsert==='function'?sharedDefinitionForInsert(engine.doc,name):null;
 const place=attributes=>{const ids=execute({type:"block.insert",name,position,layer:activeLayer,factor,angle,...(attributes&&Object.keys(attributes).length?{attributes}:{})});if(typeof recordRecentBlock==='function')recordRecentBlock(name);setSelected(ids);};
 reset();
 // 611: 속성 정의가 있으면 값을 묻는다(상수는 묻지 않고, 사전설정은 기본값). 묻는 것이 없으면 바로 넣는다.
 const asks=(definition?.entities||[]).filter(e=>e?.attdef&&!e.attdef.constant&&!e.attdef.preset);
 if(!asks.length){place(definition?promptlessAttributes(definition.entities):null);return;}
 form(`블록 속성 입력 · ${name}`,asks.map(e=>({name:e.attdef.tag,label:e.attdef.prompt||e.attdef.tag,value:e.attdef.default??''})),values=>{
  for(const e of asks)if(e.attdef.verify&&String(values[e.attdef.tag]??'')==='')throw Error(`${e.attdef.prompt||e.attdef.tag}: 값을 확인하세요.`);
  place({...promptlessAttributes(definition.entities),...values});
 });
}
/* 속성 일치(MATCHPROP): 공통(레이어·색·선종류·선종류 축척·굵기·투명도) + 같은 종류끼리 문자·해치·치수 모양.
   원본에 있는 값만 옮긴다(원본이 ByLayer 면 대상도 ByLayer). 한 번의 편집 = 되돌리기 한 번. */
/* 설정(S, ACAD200-421): 켠 항목만 옮긴다(run.matchFlags, 기본 전부). 문자는 한 줄·여러 줄 문자끼리도, 폴리선 폭도 옮긴다. */
function matchChanges(src,target){
 return S4.matchChangesFor(src,target,run.matchFlags||S4.ALL_MATCH_FLAGS);
}
function matchSettingsForm(){
 const on=new Set(run.matchFlags||S4.ALL_MATCH_FLAGS);
 form('MATCHPROP · 옮길 특성 설정(S)',S4.ALL_MATCH_FLAGS.map(flag=>({name:flag,label:S4.MATCH_FLAGS[flag].label,type:'checkbox',value:on.has(flag)})),v=>{run.matchFlags=S4.ALL_MATCH_FLAGS.filter(flag=>v[flag]===true||v[flag]==='true'||v[flag]==='on');log(S4.matchSettingsLine(run.matchFlags));updatePrompt();canvas.focus();});
}
function applyMatchProperties(targets){
 const src=params.source,list=targets.filter(t=>t&&t.id!==src?.id&&!(typeof layerMap==='function'&&layerMap().get(t.layer)?.locked));
 if(!src||!list.length)return;
 if(list.length===1){execute({type:'update',ids:[list[0].id],changes:matchChanges(src,list[0])});return;}
 execute({type:'updateMany',updates:list.map(t=>({id:t.id,changes:matchChanges(src,t)}))});
 log(`속성 일치 · ${list.length}개`);
}
/* FILLET·CHAMFER 설정(오토캐드): 반지름·두 거리·거리+각도 방식(E)·자르기(T)·다중(M)·폴리선(P). 값은 다음 실행에도 기억한다. */
const CORNER_PHASES=new Set(['corner-size','corner-size2','corner-len','corner-angle','corner-trim']);
function cornerState(){
 const c=(run.corner??={FILLET:{radius:run.cornerSize?.FILLET??0,trim:true},CHAMFER:{d1:run.cornerSize?.CHAMFER??0,d2:null,length:0,angle:45,method:'D',trim:true}});
 return c[mode]||c.FILLET;
}
function cornerPrompt(){
 const s=cornerState(),F=mode==='FILLET',trim=s.trim===false?'아니오':'예',multi=params.cornerMultiple?' · 다중':'';
 if(phase==='corner-size')return F?`모깎기 반지름 <${fmt(params.cornerSize??s.radius)}>`:`첫 번째 모따기 거리 <${fmt(s.d1)}>`;
 if(phase==='corner-size2')return `두 번째 모따기 거리 <${fmt(s.d2??s.d1)}>`;
 if(phase==='corner-len')return `첫 번째 선의 모따기 길이 <${fmt(s.length)}>`;
 if(phase==='corner-angle')return `첫 번째 선에서의 모따기 각도 <${fmt(s.angle)}>`;
 if(phase==='corner-trim')return `자르기 모드 [자르기(T)/자르지 않기(N)] <${s.trim===false?'N':'T'}>`;
 const first=params.polyFirst||selected.size?'두 번째 객체 선택 (Shift+클릭 = 0으로 잇기)':params.cornerPoly?'2D 폴리선 선택':'첫 번째 객체 선택';
 const opts=F?'[명령 취소(U)/폴리선(P)/반지름(R)/자르기(T)/다중(M)]':'[명령 취소(U)/폴리선(P)/거리(D)/각도(A)/자르기(T)/방식(E)/다중(M)]';
 const now=F?`반지름=${fmt(params.cornerSize??s.radius)}`:s.method==='A'?`길이=${fmt(s.length)}, 각도=${fmt(s.angle)}`:`거리1=${fmt(s.d1)}, 거리2=${fmt(s.d2??s.d1)}`;
 return `${first} 또는 ${opts} (${now}, 자르기=${trim}${multi})`;
}
function cornerOption(option){
 const s=cornerState(),F=mode==='FILLET';
 if(['R','RADIUS'].includes(option)&&F){phase='corner-size';return true;}
 if(['D','DISTANCE'].includes(option)){phase='corner-size';return true;}
 if(['A','ANGLE'].includes(option)&&!F){phase='corner-len';return true;}
 if(['E','METHOD'].includes(option)&&!F){s.method=s.method==='A'?'D':'A';log(`모따기 방식: ${s.method==='A'?'거리+각도':'두 거리'}`);return true;}
 if(['T','TRIM'].includes(option)){phase='corner-trim';return true;}
 if(['M','MULTIPLE'].includes(option)){params.cornerMultiple=!params.cornerMultiple;return true;}
 if(['P','POLYLINE'].includes(option)){params.cornerPoly=true;return true;}
 if(['U','UNDO'].includes(option)){if(!params.cornerDone)throw Error('되돌릴 모서리가 없습니다.');execute({type:'undo'});params.cornerDone--;return true;}
 return false;
}
function acceptCornerValue(value){
 const s=cornerState(),blank=!String(value??'').trim(),F=mode==='FILLET';
 if(phase==='corner-trim'){const o=String(value||'').trim().toUpperCase();if(blank||['T','TRIM','Y'].includes(o))s.trim=true;else if(['N','NO','NOTRIM'].includes(o))s.trim=false;else throw Error('T(자르기) 또는 N(자르지 않기)을 입력하세요.');phase='select';updatePrompt();return;}
 const n=blank?null:numeric(value);if(n!=null&&n<0)throw Error('0 이상의 값을 입력하세요.');
 if(phase==='corner-size'){
  if(F){const r=n??(params.cornerSize??s.radius);params.cornerSize=s.radius=r;(run.cornerSize??={}).FILLET=r;phase='select';}
  else{s.d1=n??s.d1;(run.cornerSize??={}).CHAMFER=s.d1;s.method='D';phase='corner-size2';}
 }else if(phase==='corner-size2'){s.d2=n??(s.d2??s.d1);phase='select';}
 else if(phase==='corner-len'){s.length=n??s.length;phase='corner-angle';}
 else if(phase==='corner-angle'){const a=n??s.angle;if(!(a>0&&a<180))throw Error('각도는 0~180 사이입니다.');s.angle=a;s.method='A';phase='select';}
 updatePrompt();render();
}
function runCorner(target,zero=false){
 const s=cornerState(),F=mode==='FILLET';
 const command={type:mode.toLowerCase(),...target,trim:s.trim!==false};
 if(F)command.size=zero?0:(params.cornerSize??s.radius);
 else if(zero){command.size=0;command.size2=0;}
 else if(s.method==='A'){command.size=s.length;command.chamferAngle=s.angle;}
 else{command.size=s.d1;command.size2=s.d2??s.d1;}
 const ids=execute(command);
 if(params.cornerMultiple){params.cornerDone=(params.cornerDone||0)+1;params.cornerPicks={};params.polyFirst=null;params.cornerPoly=false;setSelected([]);updatePrompt();render();return ids;}
 commandDone(ids);reset();return ids;
}
/* 같은 폴리선 위의 두 점이 이웃한 두 구간에 있으면 그 사이 꼭짓점 번호. */
function sharedPolylineVertex(e,a,b){
 const ps=e.points||[],n=ps.length,closed=!!(e.closed||e.type==='rectangle'),count=closed?n:n-1;
 const nearest=p=>{let best=-1,bd=Infinity;for(let i=0;i<count;i++){const d=G.distanceToSegment(p,ps[i],ps[(i+1)%n]);if(d<bd){bd=d;best=i;}}return best;};
 const i=nearest(a),j=nearest(b);if(i<0||j<0||i===j)return null;
 if((i+1)%n===j&&(closed||j<count))return j;if((j+1)%n===i&&(closed||i<count))return i;return null;
}
/* TRIM·EXTEND 공통(오토캐드): Shift 를 누른 채 찍으면 반대 동작, 울타리(끌기·F)는 걸린 객체를 한 번에(되돌리기 한 번). */
function trimOperation(){const flip=typeof shiftOrthoHeld!=='undefined'&&shiftOrthoHeld;return (mode==='TRIM')!==flip?'trim':'extend';}
/* 빠른 TRIM 경계 후보(ACAD200-401): 예전에는 찍을 때마다 화면 객체 전체 id 를 넘겨 엔진이 모두와 교차를 계산했다.
   이제 집기 색인(nearby)에서 대상 상자(연장이면 화면까지 늘린 상자)와 겹치는 것만. 훑는 양: 화면 객체 수 → 상자 안 후보 수. */
function quickTrimBoundaries(id,p,op){
 const target=engine.selected([id])[0];if(!target)return [];
 if(typeof nearby!=='function'||typeof world!=='function')return editable().map(e=>e.id).filter(x=>x!==id); // 화면 없는 실행(시험·스크립트)
 nearby(p,0);
 const a=world({x:0,y:height}),b=world({x:width,y:0}),box=S4.quickBoundaryBox(target,op,{minX:a.x,minY:a.y,maxX:b.x,maxY:b.y});
 return box&&nearby.objects?.query?S4.quickBoundaryIds(nearby.objects.query(box),target):editable().map(e=>e.id);
}
function trimOne(id,p,op){
 const boundaries=params.quickTrim?quickTrimBoundaries(id,p,op):params.boundaries;
 try{execute({type:op,id,boundaryIds:boundaries.filter(b=>b!==id),pick:p});}
 catch(error){
  // 빠른 TRIM: 어떤 선과도 만나지 않는 객체는 통째로 지운다(오토캐드).
  if(!(op==='trim'&&params.quickTrim&&/교차점이 없습니다/.test(error?.message||'')))throw error;
  execute({type:'delete',ids:[id]});
 }
}
function trimOption(option){
 if(['U','UNDO'].includes(option)){if(!params.trimDone)throw Error('되돌릴 작업이 없습니다.');execute({type:'undo'});params.trimDone--;return true;}
 if(['R','ERASE'].includes(option)){params.trimErase=true;params.fencePoints=null;return true;}
 if(['F','FENCE'].includes(option)){params.fencePoints=[];params.trimErase=false;return true;}
 if(['O','MODE'].includes(option)){
  if(params.quickTrim){params.quickTrim=false;params.boundaries=[];phase='select';setSelected([]);log('표준 모드: 경계를 고르고 Enter');}
  else{params.quickTrim=true;params.boundaries=[];phase='pick';setSelected([]);log('빠른 모드: 대상과 만나는 선이 모두 경계 (이번 명령만)');}
  return true;
 }
 return false;
}
/* 울타리 선분 a-b 와 만나는 객체를 찾아, 만난 점을 찍은 것처럼 자르거나 연장한다. */
function fenceTrim(a,b,op){
 const minX=Math.min(a.x,b.x),maxX=Math.max(a.x,b.x),minY=Math.min(a.y,b.y),maxY=Math.max(a.y,b.y),hits=[];
 const segHit=(p,q)=>{const r=G.lineIntersection(a,b,p,q);return r&&r.t>=-1e-9&&r.t<=1+1e-9&&r.u>=-1e-9&&r.u<=1+1e-9?r.point:null;};
 for(const e of editable()){
  if(typeof layerMap==='function'&&layerMap().get(e.layer)?.locked)continue;
  let point=null;
  if(e.points?.length>=2&&['line','polyline','rectangle'].includes(e.type)){
   const ps=e.points,closed=e.closed||e.type==='rectangle';let ex0=Infinity,ex1=-Infinity,ey0=Infinity,ey1=-Infinity;
   for(const q of ps){ex0=Math.min(ex0,q.x);ex1=Math.max(ex1,q.x);ey0=Math.min(ey0,q.y);ey1=Math.max(ey1,q.y);}
   if(ex1<minX||ex0>maxX||ey1<minY||ey0>maxY)continue;
   for(let i=0;i<ps.length-(closed?0:1)&&!point;i++)point=segHit(ps[i],ps[(i+1)%ps.length]);
  }else if(e.center&&e.radius&&['circle','arc'].includes(e.type)){
   if(e.center.x+e.radius<minX||e.center.x-e.radius>maxX||e.center.y+e.radius<minY||e.center.y-e.radius>maxY)continue;
   const d=G.sub(b,a),f=G.sub(a,e.center),A=G.dot(d,d),B=2*G.dot(f,d),C=G.dot(f,f)-e.radius*e.radius,disc=B*B-4*A*C;
   if(A>G.EPS&&disc>=0)for(const t of [(-B-Math.sqrt(disc))/(2*A),(-B+Math.sqrt(disc))/(2*A)]){if(t<0||t>1)continue;const q=G.add(a,G.mul(d,t));if(e.type==='circle'||G.angleOnArc(G.angle(G.sub(q,e.center)),e.startAngle,e.endAngle)){point=q;break;}}
  }
  if(point)hits.push({id:e.id,point});
 }
 if(!hits.length)throw Error('울타리에 걸린 객체가 없습니다.');
 engine.beginTransaction?.();let done=0;
 try{for(const h of hits){if(!engine.doc.entities.some(e=>e.id===h.id))continue;try{trimOne(h.id,h.point,op);done++;}catch{}}}
 finally{engine.endTransaction?.();}
 if(done)params.trimDone=(params.trimDone||0)+1;
 log(`울타리 ${op==='trim'?'자르기':'연장'} · ${done}개`);
}
/* 폴리선 호 모드: 직전 구간 방향(없으면 마지막으로 그린 선·호 방향, 그것도 없으면 +X)과 호를 점으로 나눠 붙이기. */
function plineTangent(){
 if(points.length>=2){const d=G.sub(points.at(-1),points.at(-2));if(G.len(d)>G.EPS)return G.unit(d);}
 return run.lastDrawEnd?.direction||{x:1,y:0};
}
function appendPlineArc(arc,end,ccw){
 if(!arc)throw Error('호를 만들 수 없는 점입니다. 다른 점을 찍으세요.');
 const s0=points.at(-1),a0=G.angle(G.sub(s0,arc.center)),a1=G.angle(G.sub(end,arc.center));
 // 방향: 지정이 없으면 시작점에서의 접선이 직전 방향과 맞는 쪽(접선 호).
 if(ccw===undefined){const t=plineTangent(),ccwT={x:-Math.sin(a0*Math.PI/180),y:Math.cos(a0*Math.PI/180)};ccw=G.dot(t,ccwT)>=0;}
 const sweep=ccw?((a1-a0)%360+360)%360:-(((a0-a1)%360+360)%360),steps=Math.max(8,Math.ceil(Math.abs(sweep)));
 (params.plineSegments??=[]).push(points.length);
 for(let i=1;i<=steps;i++)points.push(i===steps?{x:end.x,y:end.y}:G.add(arc.center,G.polar(arc.radius,a0+sweep*i/steps)));
}
/* TEXT 자리맞추기(오토캐드 J): 가로는 문자 정렬(left/center/right), 세로(맨위·중간)는 기준선을 높이만큼 내려 그 점에 맞춘다. */
// 504: 자리맞추기 15종(A 맞춤·F 채움 포함). 맞춤점(alignPoint)·justify 를 저장해 높이를 바꿔도 맞춤점이 고정된다(text-justify.js).
function textPlacement(point,height,rotation,text='',second=null){
 return justifiedText({point,second,height,rotation,key:run.textJustify||'L',text,widthFactor:run.textWidth||1});
}
/* CIRCLE TTR(접선·접선·반지름): 두 객체를 반지름만큼 띄운 곡선(선은 평행선, 원은 R±r 원)의 교점이 중심 후보.
   두 객체를 찍은 점에 가장 가까운 후보를 고른다(오토캐드처럼 찍은 쪽의 원). 폴리선은 찍은 곳의 구간. */
function tangentTangentRadius(a,b,r){
 const offsets=({entity:e,pick})=>{
  if(['circle','arc'].includes(e.type))return [{c:e.center,r:e.radius+r},...(Math.abs(e.radius-r)>G.EPS?[{c:e.center,r:Math.abs(e.radius-r)}]:[])];
  let s=e.points;if(e.type!=='line'){const ps=e.points,n=ps.length,closed=e.closed||e.type==='rectangle';let best=null,bd=Infinity;for(let i=0;i<(closed?n:n-1);i++){const d=G.distanceToSegment(pick,ps[i],ps[(i+1)%n]);if(d<bd){bd=d;best=[ps[i],ps[(i+1)%n]];}}s=best;}
  if(!s)return [];const u=G.unit(G.sub(s[1],s[0])),n={x:-u.y,y:u.x};
  return [1,-1].map(k=>({p:G.add(s[0],G.mul(n,k*r)),d:u}));
 };
 const meet=(x,y)=>{
  if(x.d&&y.d){const q=G.lineIntersection(x.p,G.add(x.p,x.d),y.p,G.add(y.p,y.d));return q?[q.point]:[];}
  if(x.c&&y.c){const d=G.dist(x.c,y.c);if(d<=G.EPS||d>x.r+y.r+1e-9||d<Math.abs(x.r-y.r)-1e-9)return [];const t=(x.r*x.r-y.r*y.r+d*d)/(2*d),h=Math.sqrt(Math.max(0,x.r*x.r-t*t)),u=G.unit(G.sub(y.c,x.c)),m=G.add(x.c,G.mul(u,t)),n={x:-u.y,y:u.x};return [G.add(m,G.mul(n,h)),G.add(m,G.mul(n,-h))];}
  const L=x.d?x:y,C=x.d?y:x,f=G.sub(L.p,C.c),B=2*G.dot(f,L.d),cc=G.dot(f,f)-C.r*C.r,disc=B*B-4*cc;
  if(disc<0)return [];return [(-B-Math.sqrt(disc))/2,(-B+Math.sqrt(disc))/2].map(t=>G.add(L.p,G.mul(L.d,t)));
 };
 const candidates=[];for(const x of offsets(a))for(const y of offsets(b))candidates.push(...meet(x,y));
 if(!candidates.length)return null;
 const score=c=>G.dist(c,a.pick)+G.dist(c,b.pick);
 const center=candidates.reduce((best,c)=>score(c)<score(best)?c:best);
 return {type:'circle',center,radius:r};
}
/* F·WP·CP 선택: 꼭짓점(곡선은 G.vertices 의 점)으로 판정한다. WP=모두 안, CP=하나라도 안이거나 테두리와 만남, F=선분과 만남. */
function applySelectPolygon(){
 const {kind,points:poly}=params.selectPoly;params.selectPoly=null;
 if(poly.length<(kind==='F'?2:3)){updatePrompt();render();throw Error(kind==='F'?'울타리 점을 2개 이상 찍으세요.':'다각형 점을 3개 이상 찍으세요.');}
 const edges=[];for(let i=0;i<poly.length-(kind==='F'?1:0);i++)edges.push([poly[i],poly[(i+1)%poly.length]]);
 const cross=(a,b)=>edges.some(([c,d])=>{const r=G.lineIntersection(a,b,c,d);return r&&r.t>=0&&r.t<=1&&r.u>=0&&r.u<=1;});
 let added=0;
 // 302·306: 다각형 경계 상자 안 후보만(공간 색인). 예전에는 도면 전체를 훑었다.
 for(const e of typeof boxCandidates==='function'&&typeof IA!=='undefined'?boxCandidates(IA.polygonBounds(poly)):editable()){
  const vs=G.vertices(e)||[];if(!vs.length)continue;
  let hit=false;
  if(kind==='WP')hit=vs.every(v=>G.inside(v,poly));
  else{
   if(kind==='CP')hit=vs.some(v=>G.inside(v,poly));
   for(let i=0;!hit&&i<vs.length-1;i++)hit=cross(vs[i],vs[i+1]);
   if(!hit&&kind==='CP'&&vs.length===1)hit=G.inside(vs[0],poly);
  }
  if(hit&&!selected.has(e.id)){(params.removeSelection?selected.delete(e.id):selected.add(e.id));added++;}
 }
 if(selected.size)previousSelection=[...selected];
 log(`${added}개 선택`);updatePrompt();refresh();
}
function accept(p) {
 if(mode==='GRIP'){osnapOnce=null;acceptGrip(p);return;}
 if(mode==='XLINE'&&params.bisect){osnapOnce=null;if(points.length<2){points.push(p);updatePrompt();render();return;}const [v,s]=points,d=G.add(G.unit(G.sub(s,v)),G.unit(G.sub(p,v)));if(G.len(d)<=G.EPS)throw Error('두 방향이 반대라 이등분선이 없습니다.');addEntities([constructionLine(v,d,false)]);return;}
 if(mode==='XLINE'&&phase==='xline-offset-pick'){osnapOnce=null;const hit=pick(p,{locked:true});const seg=hit&&xlineSourceSegment(hit,p);if(!seg)throw Error('선·폴리선·구성선을 선택하세요.');params.xlineSource=seg;phase='xline-offset-side';updatePrompt();render();return;}
 if(mode==='XLINE'&&phase==='xline-offset-side'){osnapOnce=null;const [a,b]=params.xlineSource,u=G.unit(G.sub(b,a)),n={x:-u.y,y:u.x},side=G.dot(G.sub(p,a),n)>=0?1:-1;const base=params.xlineOffset==='T'?p:G.add(a,G.mul(n,side*params.xlineOffset));addEntities([constructionLine(base,u,false)]);phase='xline-offset-pick';updatePrompt();render();return;}
 if(mode==='XLINE'){osnapOnce=null;if(params.xlineMode&&params.xlineMode!=='B'){addEntities([constructionLine(p,xlineDirection(p),false)]);return;}if(!points.length){points=[p];updatePrompt();return;}addEntities([constructionLine(points[0],xlineDirection(p),false)]);return;}
 if(mode==='RAY'){osnapOnce=null;if(!points.length){points=[p];updatePrompt();return;}addEntities([constructionLine(points[0],G.sub(p,points[0]),true)]);return;}
 if(mode==='SPLINE'){osnapOnce=null;run.lastPoint=p;if(!points.length||G.dist(points.at(-1),p)>G.EPS)points.push(p);updatePrompt();render();return;}
 if(mode==='REVCLOUD'){osnapOnce=null;
  if(params.cloudObject){const hit=pick(p);if(!hit)throw Error('객체를 클릭하세요.');addEntities([cloudPoints(entityRing(hit))]);execute({type:'delete',ids:[hit.id]});reset();return;}
  if(params.cloudPolygon){points.push(p);updatePrompt();render();return;}
  if(!points.length){points=[p];updatePrompt();return;}
  const [a]=points;if(Math.abs(p.x-a.x)<=G.EPS||Math.abs(p.y-a.y)<=G.EPS)throw Error('면적이 있는 사각형을 지정하세요.');
  addEntities([cloudPoints(G.rectangle(a,p))]);reset();return;}
 if(mode==='BOUNDARY'){osnapOnce=null;boundaryAt(p).catch(error=>toast(userErrorMessage(error),true));return;}
 if(['DIMCONTINUE','DIMBASELINE'].includes(mode)){osnapOnce=null;acceptChainDimension(p);return;}
 if(mode==='ZOOM'&&phase==='zoom-center'){rememberView();origin={x:width/2-p.x*scale,y:height/2+p.y*scale};endView();render();return;}
 osnapOnce=null;run.lastPoint={x:p.x,y:p.y};
 if(mode==='BREAKATPOINT'&&phase==='point'){if(selected.size!==1)throw Error('끊을 객체(선·폴리선·원·호·타원) 하나를 선택하세요.');commandDone(execute({type:'break',id:[...selected][0],a:p,b:p}));reset();return;}
 if(mode==='ROTATE'&&params?.rotateRef&&points.length){acceptRotateReference(p);return;}
 if(mode==='SCALE'&&params?.scaleRef&&points.length){acceptScaleReference(p);return;}
 if(mode==='MIRROR'&&phase==='mirror-erase'){mirrorFinish(false);return;}
 if(mode==='CIRCLE'&&params?.circleMode==='TTR'){
  if((params.ttr?.length||0)>=2)throw Error('반지름을 입력하세요.');
  const hit=pick(p,{locked:true});if(!hit||!['line','polyline','rectangle','circle','arc'].includes(hit.type))throw Error('선·폴리선·원·호를 선택하세요.');
  (params.ttr??=[]).push({entity:structuredClone(hit),pick:{...p}});updatePrompt();render();return;
 }
 if(mode==='CIRCLE'&&params?.circleMode){
  (params.circlePoints??=[]).push(p);const circle=circleFromPoints(params.circlePoints);
  if(circle){run.lastCircleRadius=circle.radius;addEntities([circle]);reset();return;}
  if(params.circleMode==='2P'&&params.circlePoints.length>=2||params.circlePoints.length>=3)throw Error('원을 만들 수 없는 점입니다(한 직선 위). 다시 찍으세요.');
  updatePrompt();render();return;
 }
 if(mode==='POLYGON'&&phase==='polygon-ic'){params.circumscribed=false;phase='point';}
 if(params?.fromState==='base'){params.fromBase={x:p.x,y:p.y};params.fromState='offset';log('간격 · @X,Y 또는 @거리<각도 를 입력하세요(기준점에서)');render();return;}
 if(params?.fromState==='offset'){params.fromState=null;params.fromBase=null;}
 if(Array.isArray(params?.m2p)){
  params.m2p.push({x:p.x,y:p.y});
  if(params.m2p.length<2){log('두 점의 중간 · 둘째 점을 찍으세요');render();return;}
  const [a,b]=params.m2p;params.m2p=null;p={x:(a.x+b.x)/2,y:(a.y+b.y)/2};log(`중간점 ${fmt(p.x)}, ${fmt(p.y)}`);
 }
 if(mode==='EYEPOINT'){reset.keepEyePoint=true;try{reset();}finally{reset.keepEyePoint=false;}settleEyePoint(p);return;}   // 내부 투시도: 찍은 자리로 들어간다
 if(mode==='PLOTWINDOW'){if(!points.length){points=[p];updatePrompt();return;}const a=points[0],values=params.plotValues,onWindow=params.onWindow;reset();if(onWindow){safe(()=>onWindow(a,p));refresh();return;}plotDialog({...values,scope:'window',minX:Math.min(a.x,p.x),minY:Math.min(a.y,p.y),maxX:Math.max(a.x,p.x),maxY:Math.max(a.y,p.y)});return;}
 if(mode==='WALL'&&phase==='wall-center-pick')throw Error('좌표 입력 대신 도면의 기존 중심선 위를 클릭하세요.');
 if(mode==='PICKENTITY')throw Error('좌표 대신 도면의 객체를 클릭하세요.');
  if(mode==='HATCH'&&phase==='hatch-inside'){pickHatch(p);return;}
  if(mode==='HATCH'&&phase==='hatch-origin'){applyHatchOrigin(p);return;}
  if(mode==='HATCH'&&phase==='hatch-gap')throw Error('간격 허용 값을 숫자로 입력하세요(0~5000).');
  if (
    !Number.isFinite(p.x) ||
    !Number.isFinite(p.y) ||
    Math.abs(p.x) > 1e12 ||
    Math.abs(p.y) > 1e12
  )
    throw Error("좌표 범위를 확인하세요.");
  p = { x: p.x, y: p.y };
  const a = points[0],
    n = points.length;
  if(['DIMLINEAR','DIMALIGNED'].includes(mode)&&phase==='dim-object'){selectDimensionObject(p);return;}
  if(['DIMLINEAR','DIMALIGNED','DIMRADIUS','DIMDIAMETER'].includes(mode)&&phase.startsWith('dim-'))throw Error('아래 명령창에 치수 문자/각도를 입력하세요.');
  if(mode==='PICKPATH'){if(!points.length||G.dist(points.at(-1),p)>G.EPS)points.push(p);if(params.maxPoints&&points.length>=params.maxPoints){settlePick({points:points.slice(),closed:false});return;}updatePrompt();render();return;}
  if(mode==='AHM'){
    if(!points.length){
      const hit=pick(p);
      if(hit&&(['rectangle','hatch'].includes(hit.type)||hit.type==='polyline'&&hit.closed)){createAreaTakeoff(takeoffBoundary(hit));return;}
    }
    if(!points.length||G.dist(points.at(-1),p)>G.EPS)points.push(p);
    updatePrompt();render();return;
  }
  if(mode==='XCLIP'&&phase!=='select'){
    if(params.clipPolygon){points.push(p);updatePrompt();render();return;}
    if(!n){points=[p];updatePrompt();render();return;}
    if(Math.abs(p.x-a.x)<G.EPS||Math.abs(p.y-a.y)<G.EPS)throw Error('면적이 있는 사각형을 지정하세요.');
    execute({type:'xclip',ids:params.clipIds,points:G.rectangle(a,p)});reset();return;
  }
  if(mode==='INSULATION'){
    if(phase==='insulation-thickness')throw Error('먼저 두께를 입력하세요.');
    if(phase==='insulation-select'){
      const hit=pick(p);if(!hit)throw Error('변환할 선을 클릭하세요.');
      convertInsulation([hit.id],params.depth,params.side);return;
    }
    if(!points.length||G.dist(points.at(-1),p)>1e-7)points.push(p);
    updatePrompt();render();return;
  }
  if(mode==='ARCHPLACE'){if(params.hostLines){const {entity,parts,sources}=placementOnWallLines(p);execute({type:'linewall.place',ids:params.hostLines,entity,parts,sources});reset();return;}addEntities([placementArchitecture(p)]);if(!params.library)run.placementRepeat={command:lastCommand,params:structuredClone(params)};updatePrompt();render();return;}
  if(mode==='POINT'){addEntities([{type:'point',position:p}]);return;}
  if(mode==='DONUT'){if(phase!=='point')throw Error('먼저 지름을 입력하세요(Enter = 기본값).');addEntities([donutEntity(p)]);return;}
  if(mode==='ID'){toast(`X ${fmt(p.x)} · Y ${fmt(p.y)} mm`);reset();return;}
  if(mode==='COPYBASE'){copySelection(p);reset();return;}
  if(mode==='PLANPLACE'&&params.planPlace){const {resolve}=params.planPlace;params.onCancel=null;params.planPlace=null;reset();resolve({x:p.x,y:p.y});return;}
  if(mode==='PDFIMPORT'){
    if(phase!=='point'||!params.pdfEntities)throw Error(phase==='pdf-loading'?'PDF를 읽는 중입니다. 잠시 기다리세요.':'먼저 쪽 번호와 축척을 입력하세요.');
    const list=params.pdfEntities,report=params.pdfReport||{};let ids;
    // 레이어 만들기와 객체 추가를 되돌리기 한 번으로 묶는다.
    engine.beginTransaction?.();
    try{
      // ACAD200-820: PDF 레이어(OCG)가 있으면 PDF-<이름> 레이어로 나눠 넣는다. 없으면 예전처럼 PDF-IMPORT 하나.
      const layerIds=new Map(),layerNameFor=typeof pdfLayerName==='function'?pdfLayerName:()=>'PDF-IMPORT';
      for(const name of new Set(list.map(e=>layerNameFor(e.pdfLayer)))){
        let layer=engine.doc.layers.find(l=>l.name===name);
        if(!layer){execute(name==='PDF-IMPORT'?{type:'layer.add',name:'PDF-IMPORT',color:'#ffffff'}:{type:'layer.add',name,color:'#ffffff'});layer=engine.doc.layers.find(l=>l.name===name);}
        if(layer.locked)throw Error(name+' 레이어가 잠겨 있습니다.');
        layerIds.set(name,layer.id);
      }
      ids=execute({type:'addMany',entities:list.map(({pdfLayer,...e})=>({...G.translate(e,p.x,p.y),layer:layerIds.get(layerNameFor(pdfLayer))}))});
    }finally{engine.endTransaction?.();}
    if(ids?.length&&ids.length<=5000)setSelected(ids);
    log(`PDF 가져오기: ${params.pdfName||''} ${report.page||params.pdfPage}쪽 · 객체 ${list.length}개 → PDF-IMPORT 레이어`);
    reset();return;
  }
  if(mode==='PASTECLIP'){
    const entities=cadClipboard.entities.map(e=>{const item=G.translate(e,p.x-cadClipboard.base.x,p.y-cadClipboard.base.y);delete item.id;delete item.hostWall;delete item.openingLinks;return item;});
    // 붙여넣은 객체만 더한다(예전에는 도면 전체를 복사해 다시 불러와 큰 도면에서 느렸다). 없는 레이어는 이름으로 만들고, 전체가 되돌리기 한 번.
    const layerFor=id=>{const source=cadClipboard.layers?.find(l=>l.id===id);let layer=engine.doc.layers.find(l=>source?l.name===source.name:l.id===id);
      if(!layer&&source){execute({type:'layer.add',name:source.name,color:source.color,lineweight:source.lineweight,linetype:source.linetype});layer=engine.doc.layers.find(l=>l.name===source.name);}
      layer??=engine.doc.layers.find(l=>l.id===activeLayer)||engine.doc.layers[0];
      if(layer.locked)throw Error('붙여넣을 레이어가 잠겨 있습니다: '+layer.name);return layer.id;};
    engine.beginTransaction?.();
    try{
      const remap=e=>{const item={...e,layer:layerFor(e.layer)};if(item.entities)item.entities=item.entities.map(remap);return item;};
      let ids=execute({type:'addMany',entities:entities.map(remap)});
      // 블록으로 붙여넣기(Ctrl+Shift+V, 오토캐드 PASTEBLOCK): 붙인 객체를 이름이 자동인 블록 하나로.
      if(params.asBlock&&ids?.length){let n=1;while(engine.doc.blocks.some(b=>b.name===`A$C${n}`))n++;ids=execute({type:'block.create',ids,base:p,name:`A$C${n}`});}
      setSelected(ids);
    }finally{engine.endTransaction?.();}
    reset();return;
  }
  if(mode==='POLYGON'){
    if(phase==='polygon-sides')throw Error('먼저 변 개수를 입력하세요.');
    // 모서리(E): 한 변의 두 끝점으로 정다각형(반시계 방향으로 쌓는다).
    if(params.polygonEdge){if(!n){points=[p];updatePrompt();render();return;}addEntities([polygonFromEdge(a,p)]);reset();return;}
    if(!n){points=[p];phase='polygon-ic';updatePrompt();return;}
    addEntities([polygonEntity(a,p)]);reset();return;
  }
  if(mode==='MATCHPROP'){
    const hit=pick(p,{locked:!params.source});if(!hit)throw Error('객체를 클릭하세요.');
    if(!params.source){params.source=structuredClone(hit);phase='select';setSelected([]);updatePrompt();render();return;}
    applyMatchProperties([hit]);return;
  }
  if(mode==='AREA' && phase==='area-label'){
    addEntities([{type:'text',position:p,text:params.areaText,height:params.height,rotation:0}]);
    reset();return;
  }
  if (phase === "select" || mode === "SELECT")
    throw Error("먼저 객체를 선택하거나 작도 명령을 실행하세요.");
  if (phase === "pick") {
    if(Array.isArray(params.fencePoints)){params.fencePoints.push({...p});if(params.fencePoints.length<2){updatePrompt();render();return;}const [a,b]=params.fencePoints;params.fencePoints=null;fenceTrim(a,b,trimOperation());updatePrompt();render();return;}
    if(params.trimErase){const hit=pick(p,{locked:true});if(!hit)throw Error('지울 객체를 클릭하세요.');execute({type:'delete',ids:[hit.id]});params.trimDone=(params.trimDone||0)+1;updatePrompt();render();return;}
    const hit = pick(p, { exclude: params.quickTrim?[]:params.boundaries });
    if (!hit) throw Error("경계가 아닌 대상 직선을 클릭하세요.");
    trimOne(hit.id,p,trimOperation());
    params.trimDone=(params.trimDone||0)+1;
    updatePrompt();
    render();
    return;
  }
  if (mode === "OFFSET") {
    if (phase === "number") throw Error("먼저 오프셋 거리를 입력하세요.");
    if(phase==='offset-object'){const hit=pick(p);if(!hit)throw Error('오프셋할 객체를 클릭하세요.');setSelected([hit.id]);phase='point';updatePrompt();return;}
    const through=params.through?chosen()[0]:null,sources=[...selected];
    // 지우기(E)·레이어(L) 설정까지 한 묶음(되돌리기 한 번).
    engine.beginTransaction?.();let created;
    try{
      created=execute({type:"offset",ids:sources,distance:through?G.entityDistance(through,p):params.distance,side:p,gapType:S4.editVar('OFFSETGAPTYPE')}); // 바깥 모서리: OFFSETGAPTYPE(0 연장·1 호·2 모따기)
      if(run.offsetLayer==='C'&&created?.length)execute({type:'update',ids:created,changes:{layer:activeLayer}});
      if(run.offsetErase&&!params.offsetMultiple)execute({type:'delete',ids:sources});
    }finally{engine.endTransaction?.();}
    params.offsetDone=(params.offsetDone||0)+1;
    // 다중(M): 방금 만든 객체에서 같은 거리로 계속 간격띄우기.
    if(params.offsetMultiple&&created?.length){setSelected(created);updatePrompt();render();return;}
    selected.clear();phase="offset-object";updatePrompt();render();
    return;
  }
  if (mode === "OPENING") {
    if (phase === "number") throw Error("먼저 개구부 폭을 입력하세요.");
    if (selected.size !== 1) throw Error("벽 하나를 선택하세요.");
    execute({
      type: "wall.opening",
      id: [...selected][0],
      position: p,
      width: params.width,
    });
    reset();
    return;
  }
  if (["DIMRADIUS", "DIMDIAMETER"].includes(mode)) {
    if(!params.circle){
      const pre=chosen().length===1&&['circle','arc'].includes(chosen()[0].type)?chosen()[0]:null,hit=pre||pick(p);
      if(!hit||!['circle','arc'].includes(hit.type))throw Error('원 또는 호를 클릭하세요.');
      params.circle=structuredClone(hit);if(!pre){updatePrompt();render();return;}
    }
    {const dim=radialDimension(p),assoc=radialAssoc(params.circle,dim);addEntities([assoc?{...dim,assoc}:dim]);}
    reset();
    return;
  }
  if (["DOOR", "WINDOW", "STAIR"].includes(mode)) {
    if (phase === "number") throw Error("먼저 폭/치수를 입력하세요.");
    if (!n) {
      const wall=mode==='STAIR'?null:nearPlacementWall(p);
      if(wall){if(engine.doc.layers.find(l=>l.id===wall.layer)?.locked)throw Error('연동 벽 레이어가 잠겨 있습니다.');addEntities([wallOpening(mode,params,wall,p,activeLayer)]);reset();return;}
      points = [p];
      phase = "angle";
    } else {
      addEntities([symbol(mode, params, a, G.angle(G.sub(p, a)), activeLayer)]);
      reset();
    }
    updatePrompt();
    render();
    return;
  }
  if (mode === "TEXT") {
    if (phase === "text-rotation") {params.rotation=run.textRotation=G.angle(G.sub(p,points[0]));phase="text";updatePrompt();return;}
    if (phase === "text-width") {updatePrompt();return;}
    if (phase === "text" || phase === "number")
      throw Error("아래 명령창에 문자 높이/내용을 입력하세요.");
    // 504 맞춤(A)·채움(F): 두 끝점을 받는다. 각도는 두 점이 정하고, 맞춤은 높이도 정하므로 바로 문자 입력으로.
    if (isFitJustify(run.textJustify) && points.length === 1) {
      if (G.dist(points[0], p) <= G.EPS) throw Error("두 번째 끝점은 첫 번째 점과 달라야 합니다.");
      points = [points[0], p]; params.rotation = G.angle(G.sub(p, points[0]));
      if (run.textJustify === 'A') { params.height = num("text-height", 150); phase = "text"; } else phase = "number";
    } else {
      points = [p];
      phase = isFitJustify(run.textJustify) ? "point" : "number";
    }
  } else if (mode === "INSERT") {
    if (phase === "name") throw Error("먼저 블록 이름을 입력하세요.");
    // 오토캐드: 삽입점 → 축척 <1> → 회전 <0>. 회전 단계에서 점을 찍으면 삽입점에서 그 점 방향 각도.
    if (phase === "insert-scale") throw Error("축척 비율을 입력하거나 Enter 를 누르세요.");
    if (phase === "insert-rotation") { insertBlockWith(run.insertScale??1, G.angle(G.sub(p, points[0]))); return; }
    points=[p];phase="insert-scale";updatePrompt();render();
  } else if (mode === "BLOCK") {
    if (phase === "name" || phase === "block-redefine") throw Error("먼저 블록 이름을 입력하세요.");
    if (phase === "block-mode") throw Error("R·C·D 중 하나를 입력하세요.");
    params.blockBase = p; phase = "block-mode"; updatePrompt(); render();
  } else if (["ROTATE", "SCALE"].includes(mode) && n) {
    if (mode === "SCALE"){scaleByFactor(G.dist(a,p));return;}
    const angle=G.angle(G.sub(p, a));run.rotateAngle=angle;
    const ids=transformSelection('rotate',{base:a,angle});reset();commandDone(ids);
  } else if (!n) {
    if (mode === "WALL" && phase === "number")
      throw Error("먼저 벽 두께를 입력하세요.");
    points.push(p);
  } else if (mode === "PLINE") {
    if(phase==='pline-arc'||phase==='pline-arc-dend'){appendPlineArc(tangentArc(points.at(-1),phase==='pline-arc-dend'?params.plineArcDir:plineTangent(),p),p);phase='pline-arc';updatePrompt();render();return;}
    if(phase==='pline-arc-center'){params.plineArcCenter=p;phase='pline-arc-cend';updatePrompt();render();return;}
    if(phase==='pline-arc-cend'){const c=params.plineArcCenter,s0=points.at(-1),r=G.dist(c,s0);if(r<=G.EPS)throw Error('중심이 시작점과 같습니다.');const e=G.add(c,G.polar(r,G.angle(G.sub(p,c))));appendPlineArc({type:'arc',center:c,radius:r,startAngle:G.angle(G.sub(s0,c)),endAngle:G.angle(G.sub(e,c))},e,true);phase='pline-arc';updatePrompt();render();return;}
    if(phase==='pline-arc-rend'){const s0=points.at(-1),r=run.plineArcRadius,d=G.dist(s0,p);if(d<=G.EPS||r<d/2-G.EPS)throw Error('반지름이 현의 절반보다 작습니다.');const t=plineTangent(),u=G.unit(G.sub(p,s0)),left=G.cross?G.cross(t,G.sub(p,s0))>=0:(t.x*(p.y-s0.y)-t.y*(p.x-s0.x))>=0,mid={x:(s0.x+p.x)/2,y:(s0.y+p.y)/2},k=Math.sqrt(Math.max(0,r*r-d*d/4)),n=left?{x:-u.y,y:u.x}:{x:u.y,y:-u.x},c=G.add(mid,G.mul(n,k));appendPlineArc({type:'arc',center:c,radius:r,startAngle:G.angle(G.sub(s0,c)),endAngle:G.angle(G.sub(p,c))},p,left);phase='pline-arc';updatePrompt();render();return;}
    if(phase==='pline-arc-aend'){const s0=points.at(-1),A=run.plineArcAngle,d=G.dist(s0,p);if(d<=G.EPS||Math.abs(A)<1e-6||Math.abs(A)>=360)throw Error('사이각은 0이 아니고 360 미만입니다.');const r=d/(2*Math.sin(Math.abs(A)*Math.PI/360)),u=G.unit(G.sub(p,s0)),mid={x:(s0.x+p.x)/2,y:(s0.y+p.y)/2},h=r*Math.cos(Math.abs(A)*Math.PI/360)*(Math.abs(A)>180?-1:1),n=A>0?{x:-u.y,y:u.x}:{x:u.y,y:-u.x},c=G.add(mid,G.mul(n,h));appendPlineArc({type:'arc',center:c,radius:r,startAngle:G.angle(G.sub(s0,c)),endAngle:G.angle(G.sub(p,c))},p,A>0);phase='pline-arc';updatePrompt();render();return;}
    if(phase==='pline-arc-dir'){const d=G.sub(p,points.at(-1));if(G.len(d)<=G.EPS)throw Error('방향 점이 시작점과 같습니다.');params.plineArcDir=G.unit(d);phase='pline-arc-dend';updatePrompt();render();return;}
    if(phase==='pline-arc-mid'){params.arcMid=p;phase='pline-arc-end';updatePrompt();render();return;}
    if(phase==='pline-arc-end'){
      const startPoint=points.at(-1),arc=G.arcThrough(startPoint,params.arcMid,p),start=G.angle(G.sub(startPoint,arc.center)),end=G.angle(G.sub(p,arc.center)),mid=G.angle(G.sub(params.arcMid,arc.center)),forward=G.angleOnArc(mid,start,end),sweep=((forward?end-start:start-end)%360+360)%360,steps=Math.max(8,Math.ceil(sweep));
      (params.plineSegments??=[]).push(points.length);
      for(let i=1;i<=steps;i++)points.push(G.add(arc.center,G.polar(arc.radius,start+(forward?1:-1)*sweep*i/steps)));
      delete params.arcMid;phase=params.plineArc?'pline-arc':'point';
    }else if (G.dist(points.at(-1), p) > G.EPS){(params.plineSegments??=[]).push(points.length);points.push(p);}
  } else if (mode === "ELLIPSE") {
    if(params.ellipseDraft){ellipseArcStep(S4.ellipseAngleOfPoint(params.ellipseDraft,p));return;}
    if (n === 1) {
      if (G.dist(a, p) < G.EPS) throw Error("축 길이는 양수입니다.");
      // 오토캐드 기본: 축의 두 끝점(중심 = 가운데). C 옵션이면 중심점 → 축 끝점.
      if(params.ellipseCenter)points.push(p);else points=[{x:(a.x+p.x)/2,y:(a.y+p.y)/2},p];
    } else {
      let axis = G.sub(points[1], points[0]),
        other = G.dist(points[0], p);
      if (other <= G.EPS) throw Error("다른 축의 길이는 양수입니다.");
      // 다른 축이 더 길면 그쪽이 장축이 된다(오토캐드처럼 오류 내지 않음).
      let ratio = other / G.len(axis);
      if (ratio > 1) { const u = G.unit(axis); axis = G.mul({x:-u.y,y:u.x}, other); ratio = 1 / ratio; }
      const made={type:"ellipse",center:points[0],majorAxis:axis,ratio,startParam:0,endParam:Math.PI*2};
      // 호(A): 타원을 정한 뒤 시작·끝 각도를 받아 매개변수만 채운다(AutoCAD ELLIPSE 호).
      if(params.ellipseArc){params.ellipseDraft=made;params.ellipseStart=null;updatePrompt();render();return;}
      addEntities([made]);
      reset();
    }
  } else if (mode === "ARC") {
    points.push(p);
    if(['SCA','SCL','CSA','CSL','SEA'].includes(params.arcMode)&&points.length>2){points.pop();throw Error('값(각도 또는 길이)을 입력하세요.');}
    const need=['SER','TAN'].includes(params.arcMode)?2:3;
    if (points.length >= need && params.arcMode!=='SER') {
      const arc=arcFromInput(points);if(!arc){points.pop();throw Error('호를 만들 수 없는 점입니다. 다른 점을 찍으세요.');}
      addEntities([arc]);if(typeof rememberDrawEnd==='function')rememberDrawEnd(p,arcEndDirection(arc,p));
      reset();
    } else updatePrompt();
  } else if (["DIMLINEAR", "DIMALIGNED"].includes(mode)) {
    if(points.length===1&&G.dist(points[0],p)<=G.EPS)throw Error('두 치수점이 같습니다. 서로 다른 점을 지정하세요.');
    if(points.length===2){
      const dimIds=addEntities([withDimAssoc(draftLinearDimension(p),points,engine.doc.entities)]);
      run.lastDimId=dimIds?.[0];   // DIMCONTINUE·DIMBASELINE 의 기준
      reset();
    }else points.push(p);
  } else if (mode === "CIRCLE") {
    if (G.dist(a, p) <= G.EPS) throw Error("반지름은 양수여야 합니다.");
    const radius=G.dist(a, p)/(params.diameter?2:1);run.lastCircleRadius=radius;
    addEntities([{ type: "circle", center: a, radius }]);
    reset();
  } else if (mode === "RECTANGLE") {
    if(phase==='rect-rotation'){params.rectRotation=run.rectRotation=G.angle(G.sub(p,a));phase='point';updatePrompt();render();return;}
    const corner=rectangleCorner(a,p),entity=rectangleEntity(a,corner),pts=entity.points;
    if (G.dist(pts[0],pts[1])<=G.EPS || G.dist(pts[1],pts[2])<=G.EPS)
      throw Error("사각형의 폭과 높이를 지정하세요.");
    addEntities([styledRectangle(entity)]);
    reset();
  } else if (mode === "LINE") {
    if(!params.lineStart)params.lineStart={...a};
    // Advance the command before geometry/history/UI work.  A second click
    // arriving immediately after this one therefore belongs to the next LINE
    // segment, never to the state that produced the first segment.
    points = [p];
    updatePrompt();render();
    params.lineSteps??=[];params.lineSteps.push({a:{...a},ids:addEntities([{ type: "line", points: [a, p] }])});if(typeof rememberDrawEnd==='function')rememberDrawEnd(p,G.sub(p,a));
  } else if (mode === "WALL") {
    points = [p];
    updatePrompt();render();
    addEntities([
      configuredWall(a,p,params),
    ]);
  } else if (["MOVE", "COPY"].includes(mode)) {
    if(mode==='COPY'&&!params.copySources)params.copySources=[...selected];
    // COPY A(배열): 같은 간격으로 n-1 개(F 면 그 거리 안에 고르게). 되돌리기는 한 번.
    const count=mode==='COPY'?params.arrayCount:0;
    const ids = count>1 ? execute({type:'batch',commands:Array.from({length:count-1},(_,i)=>{const k=params.arrayFit?(i+1)/(count-1):i+1;return {type:'copy',ids:params.copySources,dx:(p.x-a.x)*k,dy:(p.y-a.y)*k};})}) : execute({
      type: mode.toLowerCase(),
      ids: mode==='COPY'?params.copySources:[...selected],
      dx: p.x - a.x,
      dy: p.y - a.y,
    });
    if(mode==='COPY'){(params.copySteps??=[]).push(ids);params.arrayCount=0;params.arrayFit=false;}
    lastDisplacement={dx:p.x-a.x,dy:p.y-a.y};
    if(mode==='COPY'){setSelected(params.copySources);params.copied=true;}
    else {commandDone(ids);reset();}
  } else if (mode === "STRETCH") {
    commandDone(
      execute({
        type: "stretch",
        targets: params.targets,
        dx: p.x - a.x,
        dy: p.y - a.y,
      }),
    );
    run.lastStretch={x:p.x-a.x,y:p.y-a.y}; // 다음 STRETCH 변위(D)의 Enter 기본값(AutoCAD updateDefaultDisplacement)
    reset();
  } else if (mode === "MIRROR") {
    // 오토캐드: 둘째 점 뒤 "원본 객체를 지우시겠습니까? [예(Y)/아니오(N)] <N>"
    params.mirrorB=p;phase='mirror-erase';updatePrompt();render();
  } else if (mode === "BREAK") {
    if (selected.size !== 1) throw Error("끊을 객체(선·폴리선·원·호·타원) 하나를 선택하세요.");
    commandDone(execute({ type: "break", id: [...selected][0], a, b: p }));
    reset();
  } else if (mode === "DIST") {
    toast(
      `거리 ${fmt(G.dist(a, p))} mm · ΔX ${fmt(p.x - a.x)} · ΔY ${fmt(p.y - a.y)} · 각도 ${fmt(G.angle(G.sub(p, a)))}°`,
    );
    reset();
  }
  cursor = p;
  updatePrompt();
  render();
}
// PDFIMPORT 명령을 실행했을 때만 엔진에 PDF 한 쪽을 보낸다. 기다리는 사이 Esc·다른 명령이면 결과를 버린다.
async function loadPdfImport(){
  const request=params;phase='pdf-loading';updatePrompt();
  try{
    const r=await studio.api('pdf-import',{data:request.pdfData,page:request.pdfPage-1,scale:request.pdfScale,text:true});
    if(mode!=='PDFIMPORT'||params!==request)return;
    const rep=r.report||{},entities=r.entities||[];
    const notes=[];
    if(rep.images)notes.push(`래스터 그림 ${rep.images}개는 가져오지 않았습니다.`);
    if(rep.shadings)notes.push(`그라데이션 칠 ${rep.shadings}개는 가져오지 않았습니다.`);
    if(rep.truncated)notes.push(`객체가 너무 많아 처음 ${entities.length}개만 가져옵니다.`);
    if(!entities.length){reset();toast(['이 쪽에는 가져올 벡터 객체가 없습니다(스캔 PDF 는 그림이라 객체로 바꿀 수 없습니다).',...notes].join(' '),true);return;}
    request.pdfData=null;request.pdfEntities=entities;request.pdfBounds=G.bounds(entities);request.pdfReport=rep;phase='point';
    log(`PDF ${rep.page}/${rep.pages}쪽 · 선 ${rep.lines} · 폴리선 ${rep.polylines} · 원 ${rep.circles} · 문자 ${rep.texts}${rep.filled?` (칠한 도형 ${rep.filled}개는 외곽선으로)`:''}`);
    if(notes.length)toast(notes.join(' '));
    updatePrompt();render();
  }catch(error){if(mode==='PDFIMPORT'&&params===request)reset();toast(userErrorMessage(error),true);}
}
function numeric(text) {
  const n = Number(text);
  if (!text.trim() || !Number.isFinite(n))
    throw Error("유효한 숫자를 입력하세요.");
  return n;
}
/* 예/아니오 답(Y·YES·예·ㅛ / N·NO·아니오·ㅜ). 빈 Enter 는 기본값. */
function yesNo(value, fallback) {
  const answer = String(value ?? "").trim().toUpperCase();
  if (!answer) return !!fallback;
  if (["Y", "YES", "예", "ㅛ"].includes(answer)) return true;
  if (["N", "NO", "아니오", "아니요", "ㅜ"].includes(answer)) return false;
  throw Error("예(Y) 또는 아니오(N)를 입력하세요.");
}
const lockedLayerIds = () => new Set(engine.doc.layers.filter(l => l.locked).map(l => l.id));
/* PURGE(소거): 지울 미사용 레이어·블록 정의를 먼저 보여 주고, 확인하면 한 번에(되돌리기 한 단계) 지운다. */
function purgeDialog() {
  const preview = emptyGeometry => planPurge(engine.doc, { currentLayer: activeLayer, emptyGeometry });
  const plan = preview(true), base = preview(false);
  if (!plan.total) { toast("소거할 미사용 레이어·블록 정의·빈 객체가 없습니다."); return; }
  const list = (names, none) => names.length ? names.slice(0, 200).join(", ") + (names.length > 200 ? ` 외 ${names.length - 200}개` : "") : none;
  form("소거 · PURGE", [
    { name: "layers", label: `미사용 레이어 ${base.layers.length}개`, type: "textarea", value: list(base.layers.map(l => l.name), "(없음)"), readonly: true },
    { name: "blocks", label: `미사용 블록 정의 ${base.blocks.length}개`, type: "textarea", value: list(base.blocks, "(없음)"), readonly: true },
    { name: "shared", label: `안 쓰는 공유 블록 정의 ${base.sharedKeys.length}개 (중첩 포함)`, type: "textarea", value: list(base.sharedNames, "(없음)"), readonly: true },
    { name: "emptyGeometry", label: `길이 0 선·빈 문자 ${plan.eraseIds.length}개도 삭제`, value: "no", options: [["no", "아니오"], ["yes", "예"]] },
  ], values => {
    const final = preview(values.emptyGeometry === "yes"), command = purgeCommand(final);
    if (!command) throw Error("소거할 항목이 없습니다.");
    execute(command); refresh();
    const message = `소거 · 레이어 ${final.layers.length}개, 블록 정의 ${final.blocks.length + final.sharedKeys.length}개${final.eraseIds.length ? `, 빈 객체 ${final.eraseIds.length}개` : ""} 삭제 · Ctrl+Z 로 되돌리기`;
    log(message); toast(message);
  });
  const submit = $("form-dialog").querySelector('.dialog-actions [type="submit"]'); if (submit) submit.textContent = "모두 소거";
}
/* OVERKILL: 중복 객체 삭제·같은 직선 위 겹친 선 합치기. */
function runOverkill(options) {
  const plan = planOverkill(engine.doc, { ids: options.ids, tolerance: options.tolerance, ignoreLayer: options.ignoreLayer, endToEnd: !!options.endToEnd, lockedLayers: lockedLayerIds() });
  reset();
  const command = overkillCommand(plan);
  if (!command) { log("OVERKILL · 중복 객체가 없습니다."); toast("중복 객체가 없습니다."); return; }
  execute(command); setSelected([]); refresh();
  const message = `OVERKILL · 중복 ${plan.duplicates}개 삭제, 겹친 선 ${plan.merged}개 합침 · Ctrl+Z 로 되돌리기`;
  log(message); toast(message);
}
/* 납품 전 점검(DELIVERYCHECK): 넘기기 전에 볼 것을 한 창에서. 항목마다 [골라 보기]·[고치기], 아래 단추는 고칠 수 있는 것 모두.
   검사는 delivery-check.js(기존 AUDIT·OVERKILL·GEOMETRYCLEANUP + A- 레이어·A3 글자 기준), 고치기는 항목마다 되돌리기 한 단계. */
function deliveryCheckDialog(){
  let saved={};try{saved=JSON.parse(localStorage.getItem('barun-plot-settings')||'{}');}catch{}
  const denominatorOf=()=>{const v=Number(fields.querySelector('[name=denominator]')?.value);return v>0?v:100;};
  const plan=()=>planDeliveryCheck(engine.doc,{lockedLayers:lockedLayerIds(),denominator:denominatorOf()});
  const fix=item=>{const command=item.fix?.();if(!command)return false;(item.key==='audit'?engine.execute.bind(engine):execute)(command);return true;};   // AUDIT 은 엔진에 바로(applyAuditFix 와 같음)
  form('납품 전 점검',[{name:'denominator',label:'출력 축척 1:',type:'number',value:Number(saved.denominator)>0?Number(saved.denominator):100}],()=>{
    let fixed=0;for(const key of ['audit','overkill','angle','ends']){const item=plan().items.find(i=>i.key===key);if(item?.fix&&fix(item))fixed++;}   // 하나 고칠 때마다 다시 검사한 도면으로(기울기는 선 끝과 함께 고친다)
    setSelected([]);const left=plan().items.filter(i=>i.count).map(i=>i.title);
    toast(fixed?`납품 전 점검 · ${fixed}개 항목을 고쳤습니다${left.length?` (남은 것: ${left.join(', ')})`:''} · Ctrl+Z 로 하나씩 되돌리기`:'납품 전 점검 · 자동으로 고칠 것이 없습니다.');
  });
  const dialog=$('form-dialog'),fields=$('form-fields'),list=document.createElement('div');list.className='delivery-check';fields.append(list);
  const submit=dialog.querySelector('.dialog-actions [type="submit"]');if(submit)submit.textContent='고칠 수 있는 것 모두 고치기';
  const draw=()=>{
    const r=plan();
    list.replaceChildren(...r.items.map(item=>{
      const row=document.createElement('div'),head=document.createElement('div'),why=document.createElement('div'),actions=document.createElement('div');
      row.className='delivery-check-row'+(item.count?' has-issue':'');head.className='delivery-check-title';why.className='delivery-check-why';actions.className='delivery-check-actions';
      head.textContent=`${item.title}  ${item.count?item.count+'건':'통과'}`;why.textContent=item.why;
      const button=(label,run)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=run;actions.append(b);};
      if(item.count&&item.ids.length)button('골라 보기',()=>{dialog.close();setSelected(item.ids);render();toast(`${item.title} ${item.ids.length}개를 골랐습니다.`);});
      if(item.fix)button('고치기',()=>{if(fix(item)){refresh();toast(`고침: ${item.title} · Ctrl+Z 로 되돌리기`);}draw();});
      row.append(head,why,actions);return row;
    }));
  };
  fields.querySelector('[name=denominator]')?.addEventListener('change',draw);
  draw();
}
/* AUDIT: 검사 결과를 알리고 고칠지 묻는다. */
function startAudit() {
  const plan = planAudit(engine.doc);
  log("AUDIT · " + auditSummary(plan));
  if (!plan.problems) { toast("AUDIT · 고칠 오류가 없습니다." + (plan.blockReferences ? ` (정의 없는 블록 참조 ${plan.blockReferences}개는 참조 안에 그림이 있어 그대로 둡니다)` : "")); return; }
  reset(); mode = "AUDIT"; phase = "audit-fix"; lastCommand = "AUDIT"; params.auditPlan = plan; updatePrompt(); canvas.focus();
}
function applyAuditFix(plan) {
  const command = auditFixCommand(engine.doc, plan);
  if (!command) { log("AUDIT · 고칠 오류가 없습니다."); return; }
  // 다시 넣는 객체에 현재 색·선종류를 덧입히지 않도록 엔진에 바로 보낸다(LAYON 과 같은 방식). batch 하나 = 되돌리기 한 단계.
  engine.execute(command); setSelected([]); refresh();
  const r = plan.report, message = `AUDIT · 고침: 레이어 ${r.missingLayer}개를 0 레이어로, 잘못된 좌표 ${r.badNumber}개·길이 0 선 ${r.zeroLength}개 삭제, 중복 ID ${r.duplicateIds}개 새 ID · Ctrl+Z 로 되돌리기`;
  log(message); toast(message);
}
function acceptValue(value) {
  if(mode==='PDFIMPORT'&&phase!=='point'){
    if(phase==='pdf-page'){const page=value.trim()?numeric(value):1;if(!Number.isInteger(page)||page<1)throw Error('쪽 번호는 1 이상의 정수입니다.');params.pdfPage=page;phase='pdf-scale';updatePrompt();return;}
    if(phase==='pdf-scale'){const factor=value.trim()?numeric(value):1;if(factor<=0)throw Error('축척은 양수입니다.');params.pdfScale=factor;loadPdfImport();return;}
    throw Error('PDF를 읽는 중입니다. 잠시 기다리세요.');
  }
  if(mode==='INSULATION'&&phase==='insulation-thickness'){const depth=numeric(value);if(depth<=0)throw Error('두께는 양수입니다.');params.depth=depth;if(params.sourceIds?.length){convertInsulation(params.sourceIds,depth,params.side);return;}phase='point';updatePrompt();render();return;}

  if(CORNER_PHASES.has(phase)){acceptCornerValue(value);return;}
  if(['DIVIDE','MEASURE'].includes(mode)&&phase==='number'){divideOrMeasure(value);return;}
  if(mode==='DONUT'&&['donut-inner','donut-outer'].includes(phase)){
    const v=numeric(value);if(v<0||(phase==='donut-outer'&&v<=0))throw Error('지름은 0 이상(바깥은 0보다 큼)입니다.');
    run.donut={...(run.donut||{inner:10,outer:100}),[phase==='donut-inner'?'inner':'outer']:v};
    if(phase==='donut-outer'&&run.donut.outer<=run.donut.inner)throw Error('바깥지름이 안지름보다 커야 합니다.');
    phase=phase==='donut-inner'?'donut-outer':'point';updatePrompt();return;
  }
  if(mode==='POLYGON'){
    if(phase==='polygon-sides'){const sides=numeric(value);if(!Number.isInteger(sides)||sides<3||sides>1024)throw Error('변 개수는 3~1024 정수입니다.');params.sides=run.polygonSides=sides;phase='point';updatePrompt();return;}
    if(phase==='polygon-ic')throw Error('I(내접) 또는 C(외접)를 입력하세요.');
    // 숫자 반지름: 밑변이 수평이 되게(내접은 꼭짓점을 -90+180/n°, 외접은 변 가운데를 -90°에).
    if(points.length&&!value.includes(',')){const radius=numeric(value);if(radius<=0)throw Error('반지름은 양수입니다.');const n=params.sides||4;accept(G.add(points[0],G.polar(radius,params.circumscribed?-90:-90+180/n)));return;}
  }
  if (phase === "name") {
    if (!value.trim()) throw Error("이름이 비어 있습니다.");
    params.name = value.trim();
    if (
      mode === "INSERT" &&
      !engine.doc.blocks.some((b) => b.name === params.name)
    )
      throw Error("존재하지 않는 블록 이름입니다.");
    phase = mode === "BLOCK" && engine.doc.blocks.some((b) => b.name === params.name) ? "block-redefine" : "point";
    updatePrompt();
    return;
  }
  // STRETCH 변위(D): X,Y 를 이동량으로 바로 쓴다.
  if (mode === "STRETCH" && phase === "point" && !points.length && ['D','DISPLACEMENT','변위'].includes(value.trim().toUpperCase())) { phase='stretch-displacement'; $('coordinate').value=''; updatePrompt(); return; }
  if (mode === "STRETCH" && phase === "stretch-displacement") {
    const d=parsePoint(value.replace(/^@/,''),{x:0,y:0});
    commandDone(execute({type:"stretch",targets:params.targets,dx:d.x,dy:d.y}));run.lastStretch={x:d.x,y:d.y};reset();return;
  }
  if (mode === "INSERT" && phase === "insert-scale") {
    const factor = value.trim() ? numeric(value) : (run.insertScale ?? 1);
    if (!(factor > 0)) throw Error("축척 비율은 0보다 커야 합니다.");
    run.insertScale = factor; phase = "insert-rotation"; updatePrompt(); render(); return;
  }
  if (mode === "INSERT" && phase === "insert-rotation") {
    insertBlockWith(run.insertScale ?? 1, value.trim() ? numeric(value) : (run.insertRotation ?? 0)); return;
  }
  if (mode === "OVERKILL" && phase === "overkill-tolerance") {
    const tolerance = value.trim() ? numeric(value) : (params.overkill.tolerance ?? 0.01);
    if (!(tolerance > 0)) throw Error("공차는 0보다 커야 합니다.");
    params.overkill.tolerance = tolerance; run.overkillTolerance = tolerance; phase = "overkill-layer"; updatePrompt(); return;
  }
  if (mode === "OVERKILL" && phase === "overkill-layer") {
    const answer = yesNo(value, params.overkill.ignoreLayer);
    params.overkill.ignoreLayer = answer; run.overkillIgnoreLayer = answer; phase = "overkill-endtoend"; updatePrompt(); return;
  }
  if (mode === "OVERKILL" && phase === "overkill-endtoend") {
    const answer = yesNo(value, !!params.overkill.endToEnd);
    params.overkill.endToEnd = answer; run.overkillEndToEnd = answer; runOverkill(params.overkill); return;
  }
  if (mode === "AUDIT" && phase === "audit-fix") {
    const fix = yesNo(value, false), plan = params.auditPlan; reset();
    if (fix) applyAuditFix(plan); else log("AUDIT · 고치지 않았습니다.");
    return;
  }
  if (mode === "DRAWORDER" && phase === "draworder-option") {
    const o = (value.trim().toUpperCase() || 'B')[0], position = { A: 'above', U: 'below', F: 'front', B: 'back' }[o];
    if (!position) throw Error("A(위)·U(아래)·F(맨 앞)·B(맨 뒤) 중 하나를 입력하세요.");
    if (position === 'above' || position === 'below') { params.drawPosition = position; setSelected([]); phase = 'select'; log('기준 객체를 고르고 Enter'); updatePrompt(); return; }
    execute({ type: 'draworder', ids: params.drawIds, position }); reset(); refresh(); return;
  }
  if (mode === "BLOCK" && phase === "block-redefine") {
    const o = value.trim().toUpperCase();
    if (['Y','YES','예'].includes(o)) { params.redefine = true; phase = "point"; updatePrompt(); return; }
    throw Error("다른 이름으로 다시 BLOCK 을 실행하세요.");
  }
  if (mode === "BLOCK" && phase === "block-mode") {
    const o = (value.trim().toUpperCase() || run.blockMode || 'C')[0];
    if (!['R','C','D'].includes(o)) throw Error("R(유지)·C(변환)·D(삭제) 중 하나를 입력하세요.");
    run.blockMode = o; createBlockFromSelection(o); return;
  }
  if (mode === "TEXT" && phase === "text-justify") {
    const o = value.trim().toUpperCase() || (run.textJustify || 'L');
    if (!TEXT_JUSTIFY_KEYS[o]) throw Error(JUSTIFY_PROMPT+" 중 하나를 입력하세요.");
    run.textJustify = o; phase = "point"; points = []; updatePrompt(); return;
  }
  if (mode === "TEXT" && phase !== "text" && phase !== "number" && phase !== "text-rotation" && !points.length && ['J','JUSTIFY','자리맞추기'].includes(value.trim().toUpperCase())) { phase = "text-justify"; updatePrompt(); return; }
  // 글자 폭 비율(AutoCAD 스타일 폭과 같은 값) — 이 명령에서 쓰는 동안 기억한다. 맞춤·채움은 두 점으로 폭이 정해진다.
  if (mode === "TEXT" && phase !== "text" && phase !== "number" && phase !== "text-rotation" && phase !== "text-width" && !points.length && ['W','WIDTH','폭'].includes(value.trim().toUpperCase())) { phase = "text-width"; updatePrompt(); return; }
  if (mode === "TEXT" && phase === "text-width") {
    const w = value.trim() === '' ? (run.textWidth || 1) : Number(value);
    if (!(w > 0 && w <= 10)) throw Error("글자 폭 비율은 0보다 크고 10 이하입니다(예: 0.8).");
    run.textWidth = w; phase = "point"; points = []; updatePrompt(); return;
  }
  if (mode === "TEXT" && phase === "text-rotation") {
    params.rotation = run.textRotation = numeric(value);phase = "text";updatePrompt();return;
  }
  if (phase === "text") {
    if (!value.trim()) {reset();return;}
    const rotation=params.rotation||0;
    // 505: AutoCAD 습관대로 %%c·%%d·%%p 를 입력해도 Ø·°·± 로 넣는다.
    const typed=normalizeTypedText(value.replace(/\\n/g, "\n"));
    const fit=mode==='TEXT'&&isFitJustify(run.textJustify)&&points.length>1;
    addEntities([
      {
        type: "text",
        text: typed,
        height: params.height,
        rotation,
        ...(mode==='TEXT'&&(run.textWidth||1)!==1?{widthFactor:run.textWidth}:{}),
        // 맞춤점·자리맞추기(맞춤·채움이면 높이·폭 비율·각도도) — 위 값보다 뒤에 둬야 계산한 값이 남는다.
        ...textPlacement(points[0], params.height, rotation, typed, fit?points[1]:null),
      },
    ]);
    if(fit){reset();return;}
    // 오토캐드 DTEXT: Enter 마다 다음 줄(줄 간격 = 높이 × 1.667)로 내려가 계속 입력, 빈 Enter 로 끝.
    if(mode==='TEXT'){points=[G.add(points[0],G.polar(params.height*1.667,rotation-90))];$('coordinate').value='';updatePrompt();render();return;}
    reset();
    return;
  }
  if (phase === "window") throw Error("먼저 사각 선택 후 Space/Enter로 선택을 완료하세요.");
  if (phase === "select")
    throw Error("화면에서 객체를 선택한 뒤 Enter를 누르세요.");
  if (["FILLET", "CHAMFER"].includes(mode)) {
    setSelected(
      execute({
        type: mode.toLowerCase(),
        ids: [...selected],
        size: numeric(value),
      }),
    );
    reset();
    return;
  }
  if (mode === "ARRAY") {
    // 연관(AS): ARRAYASSOCIATIVITY 를 바꾼다(1 연관 배열 하나 · 0 낱개 사본, 다음 실행에도 기억).
    if(['AS','ASSOCIATIVE'].includes(value.trim().toUpperCase())){const next=1-S4.editVar('ARRAYASSOCIATIVITY');S4.setEditVar('ARRAYASSOCIATIVITY',next);log(next?'연관 배열: 결과를 배열 하나로 만들고 ARRAYEDIT 로 간격·개수를 고칩니다.':'낱개 사본: 예전처럼 사본을 하나씩 만듭니다.');$('coordinate').value='';updatePrompt();return;}
    const values = value.split(",").map(numeric);
    if (values.length !== 4) throw Error("행,열,X간격,Y간격으로 입력하세요.");
    const associative=S4.editVar('ARRAYASSOCIATIVITY')===1;
    setSelected(
      execute({
        type: "array",
        ids: [...selected],
        rows: values[0],
        columns: values[1],
        dx: values[2],
        dy: values[3],
        associative,
      }),
    );
    if(associative&&engine.lastArrayAssociative)log('연관 배열 하나로 만들었습니다 · ARRAYEDIT 로 간격·개수 고치기 · EXPLODE 로 낱개로 풀기 · AS 로 예전 방식');
    reset();
    return;
  }
  if (
    phase === "number" &&
    ["WALL", "OPENING", "OFFSET", "TEXT", "DOOR", "WINDOW", "STAIR"].includes(
      mode,
    )
  ) {
    if (mode === "STAIR") {
      const a = value.split(",").map(numeric);
      if (
        a.length !== 3 ||
        a[0] <= 0 ||
        a[1] <= 0 ||
        !Number.isInteger(a[2]) ||
        a[2] < 2 ||
        a[2] > 100
      )
        throw Error("폭,디딤판 깊이,단수(2~100)로 입력하세요.");
      params = { width: a[0], run: a[1], count: a[2] };
    } else {
      const n = numeric(value);
      if (n <= 0) throw Error("값은 0보다 커야 합니다.");
      if (mode === "OFFSET") params.distance = run.offsetDistance = n;
      else if (mode === "TEXT") params.height = n;
      else params.width = n;
      params.depth = num("wall-width", 200);
    }
    phase = mode === "TEXT" ? (isFitJustify(run.textJustify)&&points.length>1?"text":"text-rotation") : mode==='OFFSET'&&!selected.size?'offset-object':"point";
    updatePrompt();
    return;
  }
  if (phase === "angle") {
    addEntities([symbol(mode, params, points[0], numeric(value), activeLayer)]);
    reset();
    return;
  }
  if (["ROTATE", "SCALE"].includes(mode) && points.length) {
    const n = numeric(value);
    if(mode==='SCALE'){if(params.scaleRef?.stage==='ref1'){params.scaleRef.length=n;run.scaleRefLength=n;params.scaleRef.stage='new';phase='point';updatePrompt();render();return;}scaleByFactor(params.scaleRef?.stage?.startsWith('new')?n/params.scaleRef.length:n);return;}
    run.rotateAngle=n;
    const ids=transformSelection('rotate',{base:points[0],angle:n});reset();commandDone(ids);
    return;
  }
  if (mode === "ELLIPSE" && params.ellipseDraft) { const deg = numeric(value); $('coordinate').value=''; ellipseArcStep(deg); return; }
  if (mode === "ELLIPSE" && points.length === 2 && ['R','ROTATION','회전'].includes(value.trim().toUpperCase())) { params.ellipseRotation=true; $('coordinate').value=''; updatePrompt(); return; }
  // 회전(R): 원을 장축 둘레로 기울인 모양 — 단축 = 장축 × cos(각도) (오토캐드).
  if (mode === "ELLIPSE" && points.length === 2 && params.ellipseRotation) {
    const angle = numeric(value);
    if (!(angle >= 0 && angle <= 89.4)) throw Error("회전 각도는 0~89.4 사이입니다.");
    const minor = G.dist(points[0], points[1]) * Math.cos(angle * Math.PI / 180);
    accept(G.add(points[0], { x: Math.max(minor, G.EPS * 10), y: 0 }));
    return;
  }
  if (mode === "ELLIPSE" && points.length === 2 && !value.includes(",")) {
    const r = numeric(value);
    if (r <= 0) throw Error("단축 반지름은 양수입니다.");
    accept(G.add(points[0], { x: r, y: 0 }));
    return;
  }
  if (
    mode === "CIRCLE" &&
    points.length &&
    !value.includes(",") &&
    !value.includes("<")
  ) {
    const r = numeric(value);
    if (r <= 0) throw Error("반지름은 양수여야 합니다.");
    accept({ x: points[0].x + r, y: points[0].y });
    return;
  }
  if (mode === "SELECT") {
    // ACAD200-821: 이 사용자가 같은 오타 뒤에 같은 명령을 3번 고르면 다음부터 바로 고친다(기록은 이 PC 에만).
    const corrected=typeof typoCorrection==='function'?typoCorrection(value):null;
    if(corrected){log(`자동 고침: ${String(value).trim()} → ${corrected}`);run(corrected);return;}
    if(typeof typoUnknown==='function')typoUnknown(value);
    const similar=suggestCommands(value,settings,4);
    const hint=similar.length?` 비슷한 명령: ${similar.map(c=>`${c.label}(${settings.aliases[c.name]||c.name})`).join(', ')}`:'';
    throw Error(`알 수 없는 명령입니다: ${String(value).trim()}.${hint} · 전체 목록은 HELP 또는 ?`);
  }
  if(params?.dynLength>0&&value.trim()!==''&&Number.isFinite(Number(value))&&(params.fromBase||points.length)){const base=params.fromBase??points.at(-1),length=params.dynLength;params.dynLength=null;accept(G.add(base,G.polar(length,Number(value))));return;}
  // 직접 거리 입력: 점을 묻는 단계에서 숫자만 치면 기준점(FROM 기준점 또는 직전 점)에서 커서 방향으로 그 거리(오토캐드는 모든 점 입력에서 된다).
  if((params?.fromBase||points.length)&&mode!=='RECTANGLE'&&Number(value)>0&&Number.isFinite(Number(value))){
    const base=params?.fromBase??points.at(-1),delta=cursor?G.sub(cursor,base):{x:1,y:0},direction=G.len(delta)>G.EPS?G.unit(delta):{x:1,y:0};accept(G.add(base,G.mul(direction,Number(value))));return;
  }
  // 317: 동적 입력이 켜진 두 번째 점부터 키보드로 친 X,Y·길이<각도 는 직전 점 기준(AutoCAD DYNPICOORDS=0). #X,Y 는 절대.
  const relativeDefault=!!submit.keyboard&&typeof assist!=='undefined'&&assist.prefs.dynPiCoords!==1&&dynamicInputReady();
  if(relativeDefault&&!/^[#*@]/.test(String(value).trim())){let shown=true;try{shown=localStorage.getItem('barun-dyn-relative-notice')==='1';if(!shown)localStorage.setItem('barun-dyn-relative-notice','1');}catch{}if(!shown)toast('동적 입력: 두 번째 점부터 X,Y 는 직전 점 기준(상대)입니다. 절대 좌표는 #X,Y — 설정 › 선택·입력 세부 설정에서 바꿀 수 있습니다.');}
  accept(parsePoint(value, params?.fromBase ?? points.at(-1) ?? run.lastPoint, {relativeDefault}));
}
function finish(close = false) {
  if(mode==='PDFIMPORT'){if(phase==='pdf-page'||phase==='pdf-scale'){acceptValue('');return;}throw Error(phase==='pdf-loading'?'PDF를 읽는 중입니다. 잠시 기다리세요.':'삽입점을 클릭하거나 X,Y 를 입력하세요. Esc 취소');}
  if(mode==='PICKPATH'){if(params.options?.includes('')){settlePick({option:''});return;}const need=params.minPoints||2;if(points.length<need)throw Error(`점을 ${need}개 이상 찍으세요.`);settlePick({points:points.slice(),closed:!!close});return;}
  if(mode==='PICKENTITY'){if(params.allowNone){settlePick({option:params.allowNone});return;}throw Error('도면의 객체를 클릭하세요.');}
  if(mode==='AHM'){
    if(points.length<3)throw Error('구적 경계점을 3개 이상 찍거나 폐합 객체를 선택하세요.');
    createAreaTakeoff(points);return;
  }
  if(mode==='XCLIP'&&phase!=='select'&&params.clipPolygon){execute({type:'xclip',ids:params.clipIds,points});reset();return;}
  if(mode==='INSULATION'){
    if(phase==='insulation-thickness'){acceptValue('100');return;}
    if(phase==='insulation-select')throw Error('변환할 선을 클릭하세요.');
    addEntities([insulationPath(points,params.depth,params.side,close,activeLayer)]);run.insulationSettings={depth:params.depth,side:params.side};lastCommand='INSULATION';reset();return;
  }

  if(mode==='STRETCH'&&phase==='window'){
    if(drag?.awaitingCorner)throw Error('선택 사각형의 반대쪽 모서리를 클릭하세요.');
    if(!params.targets?.length)throw Error('늘릴 끝점이 포함되도록 사각 선택하세요.');
    phase='point';points=[];updatePrompt();render();return;
  }
  if(mode==='STRETCH'&&points.length&&cursor){accept(cursor);return;}
  if(mode==='STRETCH'&&phase==='point'&&!points.length){phase='stretch-displacement';updatePrompt();return;}
  if(mode==='STRETCH'&&phase==='stretch-displacement'){if(run.lastStretch&&params.targets?.length){commandDone(execute({type:'stretch',targets:params.targets,dx:run.lastStretch.x,dy:run.lastStretch.y}));}reset();return;}
  if(mode==="OFFSET"&&phase==="offset-object"){reset();return;}
  if(mode==='OFFSET'&&['offset-erase','offset-layer'].includes(phase)){phase='number';updatePrompt();return;}
  if(mode==='OFFSET'&&phase==='point'&&params.offsetMultiple){params.offsetMultiple=false;selected.clear();phase='offset-object';updatePrompt();render();return;}
  if(['PAN','ZOOM'].includes(mode)){endView();return;}
  if(phase==='select'&&params?.selectPoly){applySelectPolygon();return;}
  if(typeof CORNER_PHASES!=='undefined'&&CORNER_PHASES.has(phase)){acceptCornerValue('');return;}
  if(mode==='DRAWORDER'&&phase==='select'&&params.drawPosition){if(!selected.size)throw Error('기준 객체를 선택하세요.');execute({type:'draworder',ids:params.drawIds,position:params.drawPosition,refIds:[...selected]});reset();refresh();return;}
  if(mode==='DRAWORDER'&&phase==='select'){if(!selected.size){reset();return;}params.drawIds=[...selected];phase='draworder-option';updatePrompt();return;}
  if(mode==='DRAWORDER'&&phase==='draworder-option'){acceptValue('');return;}
  if(mode==='OVERKILL'&&phase==='select'){params.overkill.ids=selected.size?[...selected]:null;phase='overkill-tolerance';updatePrompt();return;}
  if((mode==='OVERKILL'&&String(phase).startsWith('overkill-'))||(mode==='AUDIT'&&phase==='audit-fix')){acceptValue('');return;}
  if(mode==='LAYISO'&&phase==='select'){if(selected.size)isolateSelectedLayers();reset();return;}
  if(mode==='INSERT'&&['insert-scale','insert-rotation'].includes(phase)){acceptValue('');return;}
  if(mode==='MATCHPROP'&&phase==='select'&&selected.size){const targets=chosen();setSelected([]);applyMatchProperties(targets);updatePrompt();render();return;}
  if(['MATCHPROP','POINT','ID'].includes(mode)){reset();return;}
  if(mode==='POLYGON'&&phase==='polygon-sides'){acceptValue(String(run.polygonSides||4));return;}
  if(mode==='POLYGON'&&phase==='polygon-ic'){params.circumscribed=false;phase='point';updatePrompt();render();return;}
  // 원 반지름 단계의 빈 Enter = 마지막 반지름(오토캐드 <기본값>).
  if(mode==='CIRCLE'&&params.circleMode==='TTR'&&params.ttr?.length===2){$('coordinate').value='';submit();return;}
  if(mode==='CIRCLE'&&points.length&&!params.circleMode&&run.lastCircleRadius){accept(G.add(points[0],{x:run.lastCircleRadius*(params.diameter?2:1),y:0}));return;}
  if(mode==='AREA'&&phase==='area-label'){log(params.areaText);reset();return;}
  if(mode==='GRIP'){params.op=GRIP_OPS[(GRIP_OPS.indexOf(params.op)+1)%GRIP_OPS.length];updatePrompt();render();return;}
  if(mode==='SPLINE'){if(points.length>=2)addEntities([S4.splineEntity(points,false)]);reset();return;} // 맞춤점을 남겨 그립으로 고치고 DXF 로는 SPLINE
  if(mode==='XLINE'&&phase==='xline-offset-dist'){params.xlineOffset=run.xlineOffset??'T';phase='xline-offset-pick';updatePrompt();render();return;}
  if(mode==='REVCLOUD'&&params.cloudPolygon&&points.length>=3){addEntities([cloudPoints(points)]);reset();return;}
  if(['XLINE','RAY','BOUNDARY','REVCLOUD'].includes(mode)){reset();return;}
  if(['DIMCONTINUE','DIMBASELINE'].includes(mode)){if(phase==='point'&&!params.baseDim)phase='dim-pick';else reset();updatePrompt();return;}
  if(mode==='DONUT'){if(phase==='donut-inner'){acceptValue(String(run.donut?.inner??10));return;}if(phase==='donut-outer'){acceptValue(String(run.donut?.outer??100));return;}reset();return;}
  if(['DIVIDE','MEASURE'].includes(mode)&&phase==='number')throw Error(mode==='DIVIDE'?'등분 수를 입력하세요.':'길이를 입력하세요.');
  if(['DIMLINEAR','DIMALIGNED'].includes(mode)&&!points.length&&phase!=='dim-object'){phase='dim-object';updatePrompt();render();return;}
  if(mode==='BLOCK'&&phase==='block-mode'){acceptValue('');return;}
  if(mode==='BLOCK'&&phase==='block-redefine'){reset();return;}
  if(mode==='TEXT'&&phase==='text-justify'){acceptValue('');return;}
  if(mode==='TEXT'&&phase==='text-width'){acceptValue('');return;}
  if(mode==='TEXT'&&phase==='text-rotation'){acceptValue(String(run.textRotation||0));return;}
  if(mode==='TEXT'&&phase==='text'){reset();return;}
  if(mode==='COPY'&&params.copied){reset();return;}
  if(['MOVE','COPY'].includes(mode)&&phase==='point'&&points.length===1&&!params.copied){const a=points[0];accept(G.add(a,a));return;}
  if(mode==='MIRROR'&&phase==='mirror-erase'){mirrorFinish(false);return;}
  // 참조(R) 첫 값에서 Enter = 지난 참조 각·길이(AutoCAD updateDefaultReferenceAngle/Length 처럼 기억).
  if(mode==='ROTATE'&&params.rotateRef?.stage==='ref1'){params.rotateRef.refAngle=run.rotateRefAngle||0;params.rotateRef.stage='new';phase='point';updatePrompt();render();return;}
  if(mode==='SCALE'&&params.scaleRef?.stage==='ref1'&&run.scaleRefLength>0){params.scaleRef.length=run.scaleRefLength;params.scaleRef.stage='new';phase='point';updatePrompt();render();return;}
  if(mode==='ROTATE'&&phase==='point'&&points.length&&!params.rotateRef){acceptValue(String(run.rotateAngle||0));return;}
  if(mode==='SCALE'&&phase==='point'&&points.length&&!params.scaleRef){acceptValue(String(run.scaleFactor||1));return;}
  if(mode==='OFFSET'&&phase==='number'){if(run.offsetDistance)acceptValue(String(run.offsetDistance));else{params.through=true;phase=selected.size?'point':'offset-object';updatePrompt();}return;}
  if(['MOVE','COPY'].includes(mode)&&phase!=='select'&&!points.length&&lastDisplacement&&selected.size){repeatDisplacement();return;}
  if(mode==='HATCH'&&['hatch-origin','hatch-gap'].includes(phase)){hatchOption('');updatePrompt();render();return;}
  if(mode==='HATCH'&&phase==='select'&&params.hatchSelect&&!selected.size){params.hatchSelect=false;phase='hatch-inside';updatePrompt();render();return;}
  if (phase === "select") {
    if (!selected.size){
      if(['TRIM','EXTEND'].includes(mode)){params.boundaries=[];params.quickTrim=true;phase='pick';updatePrompt();return;}
      throw Error("객체를 선택하세요.");
    }
    startSelected();
    updatePrompt();
    render();
    return;
  }
  if (mode === "PLINE") {
    if(params.areaOutline)close=true;
    if (points.length < 2&&!close&&!params.areaOutline){reset();return;}
    if (points.length < 2) throw Error("폴리선에 두 점 이상 필요합니다.");
    if (close && points.length < 3)
      throw Error("닫힌 폴리선에는 세 점 이상 필요합니다.");
    const plineWidth=params.areaOutline?0:(params.plineWidth??run.plineWidth??0);
    const entities=[{ type: "polyline", points: [...points], closed: close,...(plineWidth>0?{constantWidth:plineWidth}:{}),...(params.centerline?{linetype:'CENTER'}:{}) }];
    if(params.areaOutline){const area=Math.abs(G.polygonArea(points))/1e6;entities.push({type:'text',position:points[0],text:area.toFixed(3)+' ㎡ / '+(area*121/400).toFixed(3)+' 평',height:num('text-height',150)});}
    addEntities(entities);
    reset();
    return;
  }
  if (phase === "number") {
    const defaults = {
      TEXT: num("text-height", 150),
      WALL: num("wall-width", 200),
      DOOR: 900,
      WINDOW: 1200,
      OPENING: 900,
      STAIR: "1200,280,12",
    };
    if (defaults[mode] !== undefined) {
      acceptValue(String(defaults[mode]));
      return;
    }
  }
  if (phase === "angle") {
    acceptValue("0");
    return;
  }
  if (mode === "SELECT") {
    if(run.placementRepeat?.command===lastCommand){reset();mode='ARCHPLACE';phase='point';params=structuredClone(run.placementRepeat.params);updatePrompt();render();canvas.focus();return;}
    // 사칙연산: 마친 뒤 빈 Space·Enter 는 같은 연산자 계산기를 다시 연다(+ 로 열었으면 +)
    if(lastCommand==='NUMCALC'){studio.numberCalculator.open(run.lastCalculatorOperator);return;}
    if(lastCommand==='INSULATION'&&run.insulationSettings){reset();mode='INSULATION';phase='point';params={...run.insulationSettings};updatePrompt();render();canvas.focus();return;}
    if(lastCommand){if(cardCommands[lastCommand])markCardRepeat();run(lastCommand);}
    return;
  }
  // 오토캐드: LINE·ARC 첫 프롬프트에서 Enter = 마지막으로 그린 선·호의 끝에서 이어 그린다(ARC 는 접하게).
  if(mode==='LINE'&&!points.length&&run.lastDrawEnd){points=[{...run.lastDrawEnd.point}];params.lineStart={...points[0]};updatePrompt();render();return;}
  if(mode==='ARC'&&!points.length&&run.lastDrawEnd){params.arcMode='TAN';params.arcTangent=run.lastDrawEnd.direction;points=[{...run.lastDrawEnd.point}];updatePrompt();render();return;}
  if(['TRIM','EXTEND'].includes(mode)&&phase==='pick'&&(params.trimErase||params.fencePoints)){params.trimErase=false;params.fencePoints=null;updatePrompt();render();return;}
  if (["LINE", "WALL", "TRIM", "EXTEND"].includes(mode)) {
    // TRIM·EXTEND: 경계로 고른 선을 끝낼 때 놓는다(오토캐드처럼 · 안 놓으면 다음 MOVE·ERASE 가 그 기준선을 집어 감)
    if (["TRIM", "EXTEND"].includes(mode)) setSelected([]);
    reset();
    return;
  }
  // HATCH: Enter·Space·오른쪽 클릭으로 영역 고르기를 끝낸다(AutoCAD 와 같게). 찍은 영역은 이미 해치 하나로 들어가 있다.
  if (mode === "HATCH" && phase === "hatch-inside" && !busy) {
    // A40: 작업 중 표시하려고 고른 새 해치를 끝낼 때 놓는다(안 놓으면 다음 BLOCK·MOVE 가 그 해치를 집어 감)
    if (params.hatchId) setSelected([]);
    reset();
    return;
  }
  throw Error("안내된 좌표/값을 먼저 입력하세요.");
}
function calculatorOperatorFromInput(value){
  return ({'+':'+','-':'-','*':'*','/':'/','×':'*','÷':'/'})[String(value??'').trim()]||null;
}
/* 연산자 계산기 단축 규칙은 calculator-shortcut.js 에 있다(대기 상태에서만, '-' 는 -LAYER 입력을 위해 즉시 열지 않음). */
function submit() {
  if (busy) {if(typeof queueBusySubmit==='function')queueBusySubmit($("coordinate").value);return;}   // 319
  // 맥 한글 자판: 명령 안에서 낱자로 친 옵션(ㄷ=E·ㅔ=P·ㅁㄴ=AS)은 영문으로 읽는다(ZOOM 처럼 아래 옵션 해석 전에 끝나는 명령 포함)
  const value = imeOptionValue($("coordinate").value, mode, phase);
  const requestedCalculatorOperator=calculatorShortcut({text:value,mode,phase,busy,trigger:'submit'});
  if(requestedCalculatorOperator){
    if(value.trim()){inputHistory.push(value);historyIndex=inputHistory.length;log('❯ '+value);}
    $('coordinate').value='';studio.numberCalculator.open(requestedCalculatorOperator);return;
  }
 if(mode==='SELECT'&&studio.lisp?.isExpression?.(value)){log('❯ '+value.trim());studio.lisp.evaluate(value.trim());$('coordinate').value='';return;}/* (+ 1 2) 같은 리습 식 */
 if(mode==='SELECT'&&studio.lisp?.hasCommand(value.trim())&&(!resolveCommand(value.trim(),settings)||Object.hasOwn(RETIRED_LISP_COMMANDS,value.trim().toUpperCase()))){   // 옛 동봉 리습 이름(NUM·TAG·WALL2 …)은 같은 이름의 등록 리습이 먼저
studio.lisp.open({command:value.trim(),autoRun:true});$('coordinate').value='';return;}
 /* H12·H07 레이어 번호: LN3 · 레이어3 · 레이어번호 3 · LAYNUM 3 A 처럼 명령 이름 뒤에 번호를 붙여 바로 실행한다(되돌리기 한 단계, Space/Enter 반복은 LAYNUM). */
 if(mode==='SELECT'&&typeof parseLayerNumberCommand==='function'&&/\d/.test(value)&&!resolveCommand(value.trim(),settings)){const layerNo=parseLayerNumberCommand(value);if(layerNo){inputHistory.push(value);historyIndex=inputHistory.length;log('❯ '+value.trim());$('coordinate').value='';lastCommand='LAYNUM';beginCardWork();try{runLayerNumberInput(cardContext,layerNo);}catch(error){reportCardError('LAYNUM',error);}finally{endCardWork();}refresh();return;}}
  if(mode === "ZOOM") { safe(()=>{
    const option=value.trim().toUpperCase();
    // 2026-10-27 맥판 시험: 창 확대(W)·가운데(C) 단계에서 좌표를 쳐도 배율로 읽어 거절했다. 점이면 구석·가운데 점으로 받는다.
    if((phase==='zoom-window'||phase==='zoom-center')&&/\d/.test(option)&&!/^[\d.]+X$/.test(option)){
      const p=parsePoint(value,params.zoomCorner??run.lastPoint);$('coordinate').value='';
      if(phase==='zoom-center'){rememberView();origin={x:width/2-p.x*scale,y:height/2+p.y*scale};endView();render();return;}
      if(!params.zoomCorner){params.zoomCorner=p;log('❯ '+value.trim());return;}
      const a=params.zoomCorner;fitBox({minX:Math.min(a.x,p.x),maxX:Math.max(a.x,p.x),minY:Math.min(a.y,p.y),maxY:Math.max(a.y,p.y)});endView();return;
    }
    if(['W','WINDOW',''].includes(option)){phase='zoom-window';$('coordinate').value='';updatePrompt();canvas.focus();return;}
    if(['P','PREVIOUS'].includes(option)){const previous=zoomHistory.pop();if(!previous)throw Error('이전 화면이 없습니다.');scale=previous.scale;origin=previous.origin;render();}
    else if(["E","EXTENTS"].includes(option))fit();
    // A: 도면 범위와 작업 영역(LIMITS) 중 큰 쪽 · O: 고른 객체 · C: 클릭한 점을 화면 가운데로
    else if(["A","ALL"].includes(option)){const b=G.bounds(engine.doc.entities),l=engine.doc.limits?.enabled?engine.doc.limits:null;const box=l&&b?{minX:Math.min(b.minX,l.minX),minY:Math.min(b.minY,l.minY),maxX:Math.max(b.maxX,l.maxX),maxY:Math.max(b.maxY,l.maxY)}:l||b;if(box)fitBox(box);else fit();}
    else if(["O","OBJECT"].includes(option)){const b=G.bounds(chosen());if(!b)throw Error('먼저 확대할 객체를 선택하세요.');fitBox(b);}
    else if(["C","CENTER"].includes(option)){phase='zoom-center';$('coordinate').value='';updatePrompt();canvas.focus();return;}
    else {const factor=Number(option.replace(/X$/,''));if(!(factor>0&&Number.isFinite(factor)))throw Error('E/P/W/A/O/C 또는 배율(2X)을 입력하세요.');zoom(factor);}
    endView();});return; }
  try {
    // 한글 자판 상태로 친 옵션(ㅕ=U, ㅊ=C, ㅁ=A)은 명령 해석보다 먼저 옵션으로 본다.
    const typed=value.trim(),option=(/^[ㄱ-ㅣ가-힣]+$/.test(typed)?hangulToQwerty(typed):typed).toUpperCase();
    if(['PICKPATH','PICKENTITY'].includes(mode)&&params.options?.includes(option)){settlePick({option});$('coordinate').value='';return;}
    if(dimensionOption(value,option)){$('coordinate').value='';updatePrompt();render();return;}
    // HATCH 옵션: [객체 선택(S)/원점(O)/연관(A)/간격 허용(G)/설정(T)] · 원점·간격 값 입력.
    if(mode==='HATCH'&&hatchOption(option)){$('coordinate').value='';updatePrompt();render();canvas.focus();return;}
    // AutoCAD 두 점 중간(M2P·MTP): 점을 묻는 중에 치면 다음 두 점의 가운데를 그 점으로 쓴다(보조선 없이).
    // AutoCAD FROM(FRO): 기준점을 찍고, 그 점에서 @간격으로 다음 점을 정한다.
    if(['FRO','FROM'].includes(option)&&mode!=='SELECT'&&!['select','text','window'].includes(phase)){if(!params)params={};params.fromState='base';params.fromBase=null;$('coordinate').value='';log('FROM 기준점을 찍으세요');canvas.focus();return;}
    if(['M2P','MTP','M2','중간점'].includes(option)&&mode!=='SELECT'&&!['select','text','window'].includes(phase)){params.m2p=[];$('coordinate').value='';log('두 점의 중간 · 첫 점을 찍으세요');canvas.focus();return;}
    if(mode==='AHM'&&['U','UNDO'].includes(option)){points.pop();$('coordinate').value='';updatePrompt();render();canvas.focus();return;}
    const ONCE_SNAPS={END:'end',ENDP:'end',MID:'mid',INT:'intersection',CEN:'center',PER:'perpendicular',TAN:'tangent',NEA:'nearest',QUA:'quadrant',NOD:'node',NODE:'node',INS:'insert'};
    if(mode!=='SELECT'&&!['select','text','name','number'].includes(phase)&&ONCE_SNAPS[option]){osnapOnce=ONCE_SNAPS[option];log(`다음 점: ${option} 스냅`);$('coordinate').value='';canvas.focus();render();return;}
    if(['ROTATE','SCALE'].includes(mode)&&points.length&&phase==='point'&&['C','COPY'].includes(option)){params.copyMode=!params.copyMode;log(params.copyMode?'복사본을 만들어 변환합니다(원본 유지).':'복사 끔');$('coordinate').value='';updatePrompt();render();return;}
    if(mode==='SCALE'&&params.scaleRef?.stage==='new'&&['P','POINTS'].includes(option)){params.scaleRef.stage='new1';$('coordinate').value='';updatePrompt();render();return;}
    if(mode==='SCALE'&&points.length&&!params.scaleRef&&['R','REFERENCE'].includes(option)){params.scaleRef={stage:'ref1'};phase='rotate-ref';$('coordinate').value='';updatePrompt();render();return;}
    if(mode==='MIRROR'&&phase==='mirror-erase'&&['Y','YES','N','NO',''].includes(option)){$('coordinate').value='';mirrorFinish(option[0]==='Y');return;}
    if(mode==='OFFSET'&&phase==='number'&&['E','ERASE'].includes(option)){phase='offset-erase';$('coordinate').value='';updatePrompt();return;}
    if(mode==='MATCHPROP'&&['S','SETTINGS'].includes(option)){$('coordinate').value='';matchSettingsForm();return;}
    if(mode==='OFFSET'&&phase==='number'&&['G','GAP','GAPTYPE'].includes(option)){const next=(S4.editVar('OFFSETGAPTYPE')+1)%3;S4.setEditVar('OFFSETGAPTYPE',next);log(`바깥 모서리(OFFSETGAPTYPE) = ${next} · ${['선을 늘려 만나게','둥글게(호)','모따기'][next]}`);$('coordinate').value='';updatePrompt();return;}
    if(mode==='OFFSET'&&phase==='number'&&['L','LAYER'].includes(option)){phase='offset-layer';$('coordinate').value='';updatePrompt();return;}
    if(mode==='OFFSET'&&phase==='offset-erase'){if(['Y','YES'].includes(option))run.offsetErase=true;else if(['N','NO'].includes(option))run.offsetErase=false;else if(option)throw Error('Y 또는 N 을 입력하세요.');phase='number';$('coordinate').value='';updatePrompt();return;}
    if(mode==='OFFSET'&&phase==='offset-layer'){if(['C','CURRENT'].includes(option))run.offsetLayer='C';else if(['S','SOURCE'].includes(option))run.offsetLayer='S';else if(option)throw Error('C 또는 S 를 입력하세요.');phase='number';$('coordinate').value='';updatePrompt();return;}
    if(mode==='OFFSET'&&['point','offset-object'].includes(phase)&&['E','EXIT'].includes(option)){reset();return;}
    if(mode==='OFFSET'&&phase==='point'&&['M','MULTIPLE'].includes(option)){params.offsetMultiple=true;$('coordinate').value='';updatePrompt();return;}
    if(mode==='OFFSET'&&['point','offset-object'].includes(phase)&&['U','UNDO'].includes(option)){if(!params.offsetDone)throw Error('되돌릴 간격띄우기가 없습니다.');execute({type:'undo'});params.offsetDone--;if(params.offsetMultiple){const last=engine.doc.entities.at(-1);setSelected(last?[last.id]:[]);}$('coordinate').value='';updatePrompt();render();return;}
    if(mode==='OFFSET'&&phase==='number'&&['T','THROUGH'].includes(option)){params.through=true;phase=selected.size?'point':'offset-object';$('coordinate').value='';updatePrompt();return;}
    if(phase==='select'&&mode!=='SELECT'&&['W','WINDOW','C','CROSSING'].includes(option)){params.forceWindow=option[0];log(option[0]==='W'?'창 선택: 완전히 들어간 객체만':'걸침 선택: 닿은 객체 모두');$('coordinate').value='';canvas.focus();return;}
    // 선택 옵션 F(울타리)·WP(창 다각형)·CP(걸침 다각형): 점을 찍고 Enter.
    if(phase==='select'&&mode!=='SELECT'&&!['FILLET','CHAMFER'].includes(mode)&&['F','FENCE','WP','WPOLYGON','CP','CPOLYGON'].includes(option)){params.selectPoly={kind:option.startsWith('F')?'F':option.startsWith('W')?'WP':'CP',points:[]};$('coordinate').value='';log({F:'울타리',WP:'창 다각형',CP:'걸침 다각형'}[params.selectPoly.kind]+' · 점을 찍고 Enter');updatePrompt();render();return;}
    if(phase==='select'&&mode!=='SELECT'&&['L','LAST'].includes(option)){const last=editable().at(-1);if(last)selected.add(last.id);$('coordinate').value='';refresh();canvas.focus();return;}
    if(mode==='ROTATE'&&points.length&&!params.rotateRef&&['R','REFERENCE','참조'].includes(option)){params.rotateRef={stage:'ref1'};phase='rotate-ref';$('coordinate').value='';updatePrompt();render();return;}
    if(mode==='ROTATE'&&params.rotateRef){
      const r=params.rotateRef;
      if(['L','LINE'].includes(option)&&(r.stage==='ref1'||r.stage==='new')){r.stage=r.stage==='ref1'?'ref-line':'new-line';phase='rotate-ref';$('coordinate').value='';updatePrompt();render();return;}
      if(value.trim()!==''&&Number.isFinite(Number(value))){
        $('coordinate').value='';
        if(r.stage==='ref1'){r.refAngle=Number(value);run.rotateRefAngle=r.refAngle;r.stage='new';phase='point';updatePrompt();render();return;}
        if(r.stage==='new'){rotateByReference(Number(value));return;}
      }
    }
    // 폴리선 호 모드(오토캐드): A 로 들어가 L 로 나올 때까지 접선 호가 기본. 호 모드 안의 A 는 사이각.
    if(mode==='PLINE'&&points.length&&phase==='pline-arc'&&['A','ANGLE','CE','CENTER','CL','CLOSE','D','DIRECTION','L','LINE','R','RADIUS','S','SECOND'].includes(option)){
      const o=option;$('coordinate').value='';
      if(['L','LINE'].includes(o)){params.plineArc=false;phase='point';}
      else if(['S','SECOND'].includes(o))phase='pline-arc-mid';
      else if(['CE','CENTER'].includes(o))phase='pline-arc-center';
      else if(['R','RADIUS'].includes(o))phase='pline-arc-radius';
      else if(['A','ANGLE'].includes(o))phase='pline-arc-angle';
      else if(['D','DIRECTION'].includes(o))phase='pline-arc-dir';
      else if(['CL','CLOSE'].includes(o)){if(points.length<2)throw Error('닫으려면 구간이 하나 이상 있어야 합니다.');appendPlineArc(tangentArc(points.at(-1),plineTangent(),points[0]),points[0]);points.pop();finish(true);return;}
      updatePrompt();render();return;
    }
    if(mode==='PLINE'&&['pline-arc-radius','pline-arc-angle'].includes(phase)&&(value.trim()===''||Number.isFinite(Number(value)))){
      const n=value.trim()===''?null:Number(value);$('coordinate').value='';
      if(phase==='pline-arc-radius'){const r=n??run.plineArcRadius??1000;if(!(r>0))throw Error('반지름은 양수입니다.');run.plineArcRadius=r;phase='pline-arc-rend';}
      else{run.plineArcAngle=n??run.plineArcAngle??90;phase='pline-arc-aend';}
      updatePrompt();render();return;
    }
    if(mode==='PLINE'&&points.length&&['A','ARC','H','HALFWIDTH','L','LENGTH','W','WIDTH'].includes(option)){
      if(['A','ARC'].includes(option)){params.plineArc=true;phase='pline-arc';}
      else {params.plineValue=option[0]==='H'?'halfwidth':option[0]==='W'?'width':'length';phase='pline-length';}
      $('coordinate').value='';updatePrompt();render();return;
    }
    if(mode==='PLINE'&&phase==='pline-length'&&Number.isFinite(Number(value))&&(params.plineValue==='length'?Number(value)>0:Number(value)>=0)){
      const amount=Number(value);
      if(params.plineValue==='width'||params.plineValue==='halfwidth'){
        // 오토캐드처럼 시작 폭 → 끝 폭 두 번 묻는다. 빈 Enter 는 앞 값 그대로(시작은 지금 폭, 끝은 시작 폭).
        // 예전에는 한 번만 물어서 두 번째 200 이 '커서 방향 200 길이 선분'으로 그려졌다.
        const factor=params.plineValue==='halfwidth'?2:1,blank=String(value??'').trim()==='';
        if(params.plineWidthStart===undefined){params.plineWidthStart=blank?(params.plineWidth??run.plineWidth??0):amount*factor;$('coordinate').value='';updatePrompt();render();return;}
        const end=blank?params.plineWidthStart:amount*factor;
        if(end!==params.plineWidthStart)log(`시작·끝 폭이 다른 가변 폭은 아직 지원하지 않아 끝 폭 ${end/factor}${factor===2?'(반폭)':''}로 그립니다.`);
        params.plineWidth=run.plineWidth=end;delete params.plineWidthStart;phase=params.plineArc?'pline-arc':'point';
        log(`폴리선 폭 ${end}`);
      }
      else {const base=points.at(-1),delta=cursor?G.sub(cursor,base):points.length>1?G.sub(base,points.at(-2)):{x:1,y:0},direction=G.len(delta)>G.EPS?G.unit(delta):{x:1,y:0};(params.plineSegments??=[]).push(points.length);points.push(G.add(base,G.mul(direction,amount)));phase='point';}
      delete params.plineValue;$('coordinate').value='';updatePrompt();render();return;
    }
    if(mode==='XCLIP'&&phase!=='select'&&['ON','OFF','D','DELETE','N','NEW','P','R','I','U'].includes(option)){
      if(['P','R','U'].includes(option)){if(option==='U')points.pop();else{params.clipPolygon=option==='P';points=[];}$('coordinate').value='';updatePrompt();render();return;}
      if(['N','NEW'].includes(option)){points=[];$('coordinate').value='';updatePrompt();render();return;}
      execute({type:'xclip',ids:params.clipIds,operation:option==='I'?'invert':option==='OFF'?'off':option==='ON'?'on':'delete'});reset();return;
    }
    if(mode==='INSULATION'&&phase!=='insulation-thickness'&&['S','L','R','M','U','C'].includes(option)){
      if(option==='S'){points=[];phase='insulation-select';}
      if(['L','R','M'].includes(option))params.side={L:'left',R:'right',M:'center'}[option];
      if(option==='U')points.pop();if(option==='C')finish(true);
      $('coordinate').value='';updatePrompt();render();canvas.focus();return;
    }
    if(mode==='TEXT'&&phase==='text-justify'){acceptValue(option);$('coordinate').value='';return;}
    if(['TRIM','EXTEND'].includes(mode)&&(phase==='pick'||phase==='select'&&['O','MODE'].includes(option))&&trimOption(option)){$('coordinate').value='';updatePrompt();render();return;}
    if(['FILLET','CHAMFER'].includes(mode)&&phase==='select'&&cornerOption(option)){$('coordinate').value='';updatePrompt();render();return;}
    if(CORNER_PHASES.has(phase)){acceptValue(value);$('coordinate').value='';return;}
    if(mode==='SELECT'&&option==='ALL'){setSelected(allSelectableIds());$('coordinate').value='';refresh();return;}
    // 324: 선택 옵션 U(방금 고른 것 되돌리기)·SI(하나 고르면 끝)·BOX·AU·M(지금 기본 동작).
    if(phase==='select'&&mode!=='SELECT'&&typeof assist!=='undefined'&&IA.selectionOption(option)){
      const kind=IA.selectionOption(option);$('coordinate').value='';
      if(kind==='undo'){const count=assist.steps.undo(selected);if(!count)throw Error('되돌릴 선택이 없습니다.');log(`선택 되돌림 · ${selected.size}개 남음`);}
      else if(kind==='single'){params.singleSelect=true;log('하나만 고르면 바로 다음 단계로 갑니다.');}
      else log('기본 선택 방식: 클릭=객체, 빈 곳=창');
      updatePrompt();refresh();canvas.focus();return;
    }
    if(phase==='select'&&['ALL','P','PREVIOUS','R','REMOVE','A','ADD','L','LAST'].includes(option)&&typeof assist!=='undefined'){if(!assist.steps.active)assist.steps.start();assist.steps.begin();}
    if(phase==='select'&&['ALL','P','PREVIOUS','R','REMOVE','A','ADD'].includes(option)){
      if(option==='ALL'){const ids=allSelectableIds();if(selected.addMany)selected.addMany(ids);else for(const id of ids)selected.add(id);}   // 306 리비전 한 번
      else if(['P','PREVIOUS'].includes(option)){const available=new Set(editable().map(e=>e.id));for(const id of previousSelection)if(available.has(id))selected.add(id);}
      else params.removeSelection=['R','REMOVE'].includes(option);
      $('coordinate').value='';refresh();canvas.focus();return;
    }
    if(mode==='PICKPATH'&&['C','CLOSE','U','UNDO'].includes(option)){if(['U','UNDO'].includes(option))points.pop();else finish(true);$('coordinate').value='';updatePrompt();render();return;}
    if(['LINE','PLINE'].includes(mode)&&['C','CLOSE','U','UNDO'].includes(option)){
      if(['U','UNDO'].includes(option)){
        if(mode==='PLINE'){const length=params.plineSegments?.pop();if(length)points.length=length;else if(points.length>1)points.pop();phase='point';delete params.arcMid;}
        else {const step=params.lineSteps?.pop();if(step){execute({type:'undo'});points=[step.a];}}
      }else if(mode==='PLINE')finish(true);
      else {if(!params.lineStart||!params.lineSteps?.length)throw Error('선을 먼저 그리세요.');if(G.dist(points[0],params.lineStart)>G.EPS)addEntities([{type:'line',points:[points[0],params.lineStart]}]);reset();}
      $('coordinate').value='';updatePrompt();render();return;
    }
    if(['MOVE','COPY'].includes(mode)&&phase!=='select'&&!points.length&&['P','PREVIOUS','이전'].includes(option)){if(!lastDisplacement)throw Error('이전에 옮긴 방향·거리가 없습니다.');$('coordinate').value='';repeatDisplacement();return;}
    // RECTANG 첫 점 옵션(오토캐드): 모따기·모깎기·선 폭은 다음 사각형에도 기억(0 이면 끔). 둘째 점의 A 는 면적으로.
    if(mode==='RECTANGLE'&&!points.length&&phase==='point'&&['C','CHAMFER','F','FILLET','W','WIDTH'].includes(option)){phase=option[0]==='C'?'rect-chamfer1':option[0]==='F'?'rect-fillet':'rect-linewidth';$('coordinate').value='';updatePrompt();return;}
    if(mode==='RECTANGLE'&&points.length&&phase==='point'&&['A','AREA'].includes(option)){phase='rect-area';$('coordinate').value='';updatePrompt();return;}
    if(mode==='RECTANGLE'&&phase==='rect-area-lw'){params.rectAreaBy=['W','WIDTH'].includes(option)?'W':'L';phase='rect-area-value';$('coordinate').value='';updatePrompt();return;}
    if(mode==='RECTANGLE'&&['rect-chamfer1','rect-chamfer2','rect-fillet','rect-linewidth','rect-area','rect-area-value'].includes(phase)){
      const blank=!value.trim(),n=Number(value);$('coordinate').value='';if(!blank&&!(n>=0))throw Error('0 이상의 숫자를 입력하세요.');
      if(phase==='rect-chamfer1'){run.rectChamfer=[blank?(run.rectChamfer?.[0]||0):n,run.rectChamfer?.[1]];if(run.rectChamfer[0])run.rectFillet=0;phase='rect-chamfer2';updatePrompt();return;}
      if(phase==='rect-chamfer2'){run.rectChamfer=[run.rectChamfer[0],blank?(run.rectChamfer[1]??run.rectChamfer[0]):n];phase='point';updatePrompt();return;}
      if(phase==='rect-fillet'){run.rectFillet=blank?(run.rectFillet||0):n;if(run.rectFillet)run.rectChamfer=null;phase='point';updatePrompt();return;}
      if(phase==='rect-linewidth'){run.rectLineWidth=blank?(run.rectLineWidth||0):n;phase='point';updatePrompt();return;}
      if(phase==='rect-area'){const v=blank?(run.rectArea||0):n;if(!(v>0))throw Error('면적은 0보다 커야 합니다.');run.rectArea=v;phase='rect-area-lw';updatePrompt();return;}
      if(phase==='rect-area-value'){if(!(n>0))throw Error('0보다 큰 값을 입력하세요.');const other=run.rectArea/n,length=params.rectAreaBy==='W'?other:n,width=params.rectAreaBy==='W'?n:other;
        const u=rectAxes(),a0=points[0],corner=G.add(a0,G.add(G.mul(u.x,length),G.mul(u.y,width)));addEntities([styledRectangle(rectangleEntity(a0,corner))]);reset();return;}
    }
    if(mode==='RECTANGLE'&&points.length&&phase==='point'&&['D','DIMENSIONS'].includes(option)){params.rectDims={};phase='rect-length';$('coordinate').value='';updatePrompt();return;}
    if(mode==='RECTANGLE'&&points.length&&phase==='point'&&['R','ROTATION'].includes(option)){phase='rect-rotation';$('coordinate').value='';updatePrompt();render();return;}
    if(mode==='RECTANGLE'&&['rect-length','rect-width','rect-rotation'].includes(phase)){
      const blank=!value.trim(),n=Number(value);$('coordinate').value='';
      if(phase==='rect-rotation'){params.rectRotation=run.rectRotation=blank?(run.rectRotation||0):n;if(!Number.isFinite(params.rectRotation))throw Error('각도를 숫자로 입력하세요.');phase='point';updatePrompt();render();return;}
      const key=phase==='rect-length'?'length':'width',v=blank?run.rectDims?.[key]:n;if(!(v>0))throw Error('0보다 큰 값을 입력하세요.');
      params.rectDims[key]=v;run.rectDims={...(run.rectDims||{}),[key]:v};phase=key==='length'?'rect-width':'point';updatePrompt();render();
      if(phase==='point')log('사각형이 놓일 쪽을 클릭하세요');return;
    }
    if(mode==='RECTANGLE'&&points.length&&['Q','SQUARE','정사각형','ㅂ'].includes(option)){params.rectSquare=true;params.rectWidth=null;$('coordinate').value='';updatePrompt();render();canvas.focus();return;}
    if(mode==='RECTANGLE'&&points.length&&typed&&/^\d+(\.\d+)?$/.test(typed)&&Number(typed)>0){
      const n=Number(typed),a=points[0],toward=cursor||{x:a.x+1,y:a.y+1},sx=toward.x<a.x?-1:1,sy=toward.y<a.y?-1:1;
      $('coordinate').value='';log('❯ '+typed);
      if(params.rectSquare)accept({x:a.x+sx*n,y:a.y+sy*n});
      else if(params.rectWidth==null){params.rectWidth=n;params.rectSign={x:sx};updatePrompt();render();}
      else accept({x:a.x+params.rectSign.x*params.rectWidth,y:a.y+sy*n});
      canvas.focus();return;
    }
    if(mode==='BREAK'&&points.length===1&&['F','FIRST'].includes(value.trim().toUpperCase())){points=[];$('coordinate').value='';updatePrompt();render();return;}
    if(mode==='BREAK'&&points.length===1&&['@'].includes(value.trim())){$('coordinate').value='';accept({...points[0]});return;}
    if(mode==='GRIP'&&['B','BASE','C','COPY','U','UNDO','X','EXIT'].includes(option)){
      $('coordinate').value='';
      if(option[0]==='B')params.gripBasePending=true;
      else if(option[0]==='C')params.gripCopy=true;
      else if(option[0]==='U'){if(!params.gripDone)throw Error('되돌릴 복사가 없습니다.');execute({type:'undo'});params.gripDone--;}
      else {const ids=[...selected];reset();setSelected(ids);}
      updatePrompt();render();return;
    }
    if(mode==='GRIP'&&value.trim()&&Number.isFinite(Number(value))){const n=Number(value);$('coordinate').value='';
      if(['rotate','scale'].includes(params.op)){acceptGrip(points[0],n);return;}
      const base=points[0],toward=cursor&&G.dist(cursor,base)>G.EPS?G.unit(G.sub(cursor,base)):{x:1,y:0};acceptGrip(G.add(base,G.mul(toward,n)));return;}
    if(mode==='XLINE'&&!points.length&&['B','BISECT'].includes(option)){params.xlineMode='B';params.bisect=true;$('coordinate').value='';updatePrompt();render();return;}
    if(mode==='XLINE'&&!points.length&&['O','OFFSET'].includes(option)){params.xlineMode='O';phase='xline-offset-dist';$('coordinate').value='';updatePrompt();render();return;}
    if(mode==='XLINE'&&phase==='xline-offset-dist'){const t=['T','THROUGH','통과'].includes(option)||(!value.trim()&&run.xlineOffset==='T');const d=t?'T':(value.trim()?numeric(value):run.xlineOffset);if(d!=='T'&&!(d>0))throw Error('간격띄우기 거리는 양수이거나 T(통과)입니다.');params.xlineOffset=run.xlineOffset=d;phase='xline-offset-pick';$('coordinate').value='';updatePrompt();render();return;}
    if(mode==='XLINE'&&!points.length&&['H','V','A'].includes(option)){params.xlineMode=option;$('coordinate').value='';if(option==='A'){phase='xline-angle';}updatePrompt();render();return;}
    if(mode==='XLINE'&&phase==='xline-angle'){const a=Number(value);$('coordinate').value='';if(!Number.isFinite(a))throw Error('각도를 숫자로 입력하세요.');params.xlineAngle=a;phase='point';updatePrompt();return;}
    if(mode==='SPLINE'&&['C','CLOSE'].includes(option)&&points.length>=3){$('coordinate').value='';addEntities([S4.splineEntity(points,true)]);reset();return;}
    if(mode==='SPLINE'&&['U','UNDO'].includes(option)){points.pop();$('coordinate').value='';updatePrompt();render();return;}
    if(mode==='REVCLOUD'&&!points.length&&['A','ARC'].includes(option)){phase='revcloud-arc';$('coordinate').value='';updatePrompt();return;}
    if(mode==='REVCLOUD'&&phase==='revcloud-arc'){const a=Number(value);$('coordinate').value='';if(!(a>0))throw Error('호 길이는 0보다 커야 합니다.');run.revcloudArc=a;phase='point';updatePrompt();return;}
    if(mode==='REVCLOUD'&&!points.length&&['O','OBJECT'].includes(option)){params.cloudObject=true;$('coordinate').value='';updatePrompt();return;}
    if(mode==='REVCLOUD'&&!points.length&&['P','POLYGONAL'].includes(option)){params.cloudPolygon=true;$('coordinate').value='';updatePrompt();return;}
    if(mode==='REVCLOUD'&&!points.length&&['F','FREEHAND'].includes(option)){params.cloudFreehand=true;params.cloudPolygon=true;$('coordinate').value='';updatePrompt();return;}
    if(mode==='COPY'&&points.length===1&&['A','ARRAY'].includes(option)){phase='copy-array';$('coordinate').value='';updatePrompt();return;}
    if(mode==='COPY'&&phase==='copy-array'){const n=Number(value);$('coordinate').value='';if(!Number.isInteger(n)||n<2||n>10000)throw Error('배열할 항목 수는 2 이상의 정수입니다.');params.arrayCount=n;phase='point';updatePrompt();render();return;}
    if(mode==='COPY'&&points.length===1&&params.arrayCount&&['F','FIT'].includes(option)){params.arrayFit=true;$('coordinate').value='';updatePrompt();return;}
    if(mode==='COPY'&&params.copied&&['U','UNDO'].includes(option)){const last=params.copySteps?.pop();$('coordinate').value='';if(!last?.length)throw Error('취소할 복사가 없습니다.');execute({type:'delete',ids:last});updatePrompt();render();return;}
    if(mode==='COPY'&&params.copied&&['E','EXIT'].includes(option)){$('coordinate').value='';reset();return;}
    if(mode==='ARC'&&['C','CE','CENTER'].includes(option)&&points.length<=1&&(params.arcMode||'3P')==='3P'){params.arcMode=points.length?'SCE':'CSE';$('coordinate').value='';updatePrompt();render();return;}
    if(mode==='ARC'&&['E','END'].includes(option)&&points.length===1&&(params.arcMode||'3P')==='3P'){params.arcMode='SER';$('coordinate').value='';updatePrompt();render();return;}
    if(mode==='ARC'&&points.length===2&&['SCE','CSE'].includes(params.arcMode)&&['A','ANGLE','L','LENGTH'].includes(option)){params.arcMode=params.arcMode.slice(0,2)+option[0];$('coordinate').value='';updatePrompt();render();return;}
    if(mode==='ARC'&&points.length===2&&params.arcMode==='SER'&&['A','ANGLE','D','DIRECTION'].includes(option)){params.arcMode=option[0]==='A'?'SEA':'SED';$('coordinate').value='';updatePrompt();render();return;}
    if(mode==='ARC'&&points.length===2&&['SCA','SCL','CSA','CSL','SEA'].includes(params.arcMode)&&value.trim()&&Number.isFinite(Number(value))){params.arcValue=Number(value);const arc=arcFromInput(points);$('coordinate').value='';if(!arc)throw Error('이 값으로는 호를 만들 수 없습니다.');addEntities([arc]);if(typeof rememberDrawEnd==='function')rememberDrawEnd(arc.center&&G.add(arc.center,G.polar(arc.radius,arc.endAngle)),arcEndDirection(arc,G.add(arc.center,G.polar(arc.radius,arc.endAngle))));reset();return;}
    if(mode==='ARC'&&params.arcMode==='SER'&&points.length===2&&value.trim()&&Number(value)>0){params.arcRadius=Number(value);const arc=arcFromInput(points);$('coordinate').value='';if(!arc)throw Error('반지름이 현의 절반보다 작습니다.');addEntities([arc]);reset();return;}
    if(mode==='ELLIPSE'&&!points.length&&['C','CENTER'].includes(option)){params.ellipseCenter=true;$('coordinate').value='';updatePrompt();return;}
    if(mode==='ELLIPSE'&&!points.length&&['A','ARC'].includes(option)){params.ellipseArc=true;$('coordinate').value='';updatePrompt();return;}
    if(mode==='CIRCLE'&&!points.length&&!params.circleMode&&['T','TTR'].includes(option)){params.circleMode='TTR';params.ttr=[];$('coordinate').value='';updatePrompt();render();return;}
    if(mode==='CIRCLE'&&params.circleMode==='TTR'&&params.ttr?.length===2&&(value.trim()===''||Number(value)>0)){const r=value.trim()===''?run.lastCircleRadius:Number(value);$('coordinate').value='';if(!(r>0))throw Error('반지름을 입력하세요.');const circle=tangentTangentRadius(params.ttr[0],params.ttr[1],r);if(!circle)throw Error('이 반지름으로는 두 객체에 접하는 원이 없습니다.');run.lastCircleRadius=r;addEntities([circle]);reset();return;}
    if(mode==='CIRCLE'&&!points.length&&!params.circleMode&&['2P','3P'].includes(option)){params.circleMode=option;params.circlePoints=[];$('coordinate').value='';updatePrompt();render();return;}
    if(mode==='CIRCLE'&&points.length&&['D','DIAMETER'].includes(option)){params.diameter=true;$('coordinate').value='';updatePrompt();render();return;}
    if(mode==='CIRCLE'&&params.diameter&&Number(value)>0){acceptValue(String(Number(value)));$('coordinate').value='';return;}
    if(mode==='POLYGON'&&phase==='polygon-sides'){acceptValue(value.trim()||String(run.polygonSides||4));$('coordinate').value='';return;}
    if(mode==='POLYGON'&&phase==='point'&&!points.length&&['E','EDGE','모서리'].includes(option)){params.polygonEdge=true;$('coordinate').value='';updatePrompt();render();return;}
    if(mode==='POLYGON'&&phase==='polygon-ic'&&['I','C',''].includes(option)){params.circumscribed=option==='C';phase='point';$('coordinate').value='';updatePrompt();render();return;}
    if (value.trim()) {
      inputHistory.push(value);
      historyIndex = inputHistory.length;
      log("❯ " + value);
    }
    if (mode === "PLINE" && /^CLOSE$/i.test(value.trim())) {
      finish(true);
    } else {
      const classified = classifyInput(value, phase, settings);
      if (classified.conversion) log(classified.conversion);
      if (classified.kind === "command") run(classified.value);
      else if (classified.kind === "enter") finish();
      else if (classified.blockedCommand && !looksLikeCoordinateValue(classified.value) && classified.value.trim().length > 1) { /* 한 글자(T·D·U…)는 명령 옵션이 우선이라 acceptValue 로 보낸다 */
        const blocked=COMMANDS.find(c=>c.name===classified.blockedCommand);
        throw Error(`지금은 ${stageLabel(phase)} 단계입니다. '${classified.value.trim()}' 은(는) ${blocked?.label||classified.blockedCommand}(${classified.blockedCommand}) 명령이라 실행하지 않았습니다. 명령을 바꾸려면 Esc 로 먼저 끝내세요.`);
      }
      else acceptValue(classified.value);
    }
    if (phase !== "text" || value.trim()) $("coordinate").value = "";
    if (phase === "select" || phase === "window") canvas.focus();
    updatePrompt();
    render();
  } catch (error) {
    // 오류가 난 입력은 지운다. 남겨 두면 다음 입력이 뒤에 이어 붙어 같은 오류가 반복된다(문자 입력 단계는 유지).
    if (phase !== "text") $("coordinate").value = "";
    toast(error.message, true);
  }
}
/* Ctrl+Z / Ctrl+Y: 명령이 없으면 도면 되돌리기, 점을 잇는 명령 중이면 그 명령의 U(마지막 점 취소), 그 밖의 명령 중이면 명령만 취소. 규칙은 command-history-shortcut.js */
function historyShortcut(name){
  const decision=historyShortcutAction({name,mode,phase,points,lineSteps:params?.lineSteps||[]});
  // Ctrl+Z/Y 는 Space 반복 대상(마지막 명령)을 바꾸지 않는다. 명령창에 친 U·REDO 는 Space 로 이어서 반복된다.
  if(decision.action==='document'){const repeat=lastCommand;run(name);lastCommand=repeat;return;}
  if(decision.action==='step'){$('coordinate').value='U';submit();return;}
  if(decision.action==='cancel')cancelStep();
  if(decision.message)log(decision.message);
}
/* 명령 단계 이름(명령창 상태 표시와 안내문에 쓴다). */
const STAGE_LABELS={idle:'대기','pdf-page':'쪽 번호 입력','pdf-scale':'축척 입력','pdf-loading':'PDF 읽는 중',select:'객체 선택',point:'점 지정',number:'값 입력',angle:'각도 입력',window:'영역 지정',text:'문자 입력',name:'이름 입력','corner-size':'크기 입력','polygon-sides':'변 개수 입력','pline-length':'길이 입력','pline-arc-mid':'호 중간점 지정','zoom-window':'확대 영역 지정',zoom:'줌','offset-object':'객체 지정','hatch-inside':'영역 안쪽 지정','wall-center-pick':'중심선 지정',pick:'객체 지정','insulation-thickness':'두께 입력','insulation-select':'객체 선택','area-label':'문자 위치 지정','hatch-origin':'원점 지정','hatch-gap':'값 입력'};
function stageLabel(value){return STAGE_LABELS[value]||String(value||'').replace(/-/g,' ');}
/* 좌표·값처럼 보이는 입력은 명령 이름과 겹쳐도 값으로 받는다(예: 별칭 'E' 가 있어도 '1e3' 은 숫자). */
function looksLikeCoordinateValue(value){return /^[-+@0-9.<,\s]+$/.test(String(value||'').trim());}

/** 레이어 칸에 보여 줄 값. 오토캐드와 같은 규칙이다.
    고른 게 없으면 지금 그리는 레이어, 고른 것이 모두 한 레이어면 그 레이어,
    여러 레이어가 섞였으면 빈칸이다. 보여 주기만 할 뿐 그리는 레이어를 바꾸지는 않는다. */
function shownLayer() {
  if (!selected.size) return activeLayer;
  // Look up only the selected objects (id map, O(selection)); scanning the
  // whole drawing per refresh cost tens of ms on 200k-object plans.
  const layers = new Set();
  const picked=typeof entityMap==='function'?[...selected].map(id=>entityMap().get(id)).filter(Boolean):engine.doc.entities.filter(e=>selected.has(e.id));
  for (const e of picked) {
    layers.add(e.layer);
    if(layers.size>1)return '';
  }
  return layers.size === 1 ? [...layers][0] : '';
}
/* 선종류 이름·견본은 레이어 선종류와 객체 선종류가 같은 표(cad-properties.js)를 쓴다. */
function layerLinetypeLabel(value='CONTINUOUS') {return linetypeLabel(value);}
function layerLinetypeOptionLabel(value='CONTINUOUS') {return `${linetypeSample(value)}  ${linetypeLabel(value)}`;}
function updateLayerLinePreview(preview,{color,linetype,lineweight}) {
  const weight=Math.max(.05,Math.min(5,Number(lineweight)||.25)),line=preview.querySelector('line'),label=preview.querySelector('small');
  line.setAttribute('stroke',color||'#ffffff');
  line.setAttribute('stroke-width',String(Math.max(1,Math.min(3,weight*4))));
  const dash=linetypeDashPattern(linetype);
  if(dash.length)line.setAttribute('stroke-dasharray',dash.join(' '));else line.removeAttribute('stroke-dasharray');
  label.textContent=`${layerLinetypeLabel(linetype)} · ${weight.toFixed(2)} mm`;
}
function layerKindLabel(layer) {
  return standardLayerForName(layer?.name)?.label||'사용자';
}
function layerStateLabel(layer) {
  return layer?.locked?'잠김':layer?.frozen?'동결':layer?.visible===false?'숨김':'';
}
function closeCurrentLayerChooser({focus=false}={}) {
  const popover=document.getElementById('current-layer-popover'),trigger=document.getElementById('current-layer-trigger');
  if(!popover||!trigger)return;
  popover.hidden=true;trigger.setAttribute('aria-expanded','false');
  if(focus)trigger.focus();
}
/* 레이어 창의 눈·자물쇠·되돌리기 그림(고정 문자열, 2026-10-26 레이어 창 시안). */
const LAYER_ICON=body=>`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const LAYER_ICON_EYE=LAYER_ICON('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
const LAYER_ICON_EYE_OFF=LAYER_ICON('<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/>');
const LAYER_ICON_LOCK=LAYER_ICON('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>');
const LAYER_ICON_UNLOCK=LAYER_ICON('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>');
const LAYER_ICON_UNDO=LAYER_ICON('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>');
function rebuildCurrentLayerChooser() {
  const list=document.getElementById('current-layer-list'),search=document.getElementById('current-layer-search'),select=document.getElementById('current-layer-select');
  if(!list||!select)return;
  const query=(search?.value||'').trim().toLocaleLowerCase('ko'),shown=shownLayer(),layerNumbers=layerNumberIndex(localStorage);
  list.replaceChildren();
  for(const layer of sortLayersForDisplay(engine.doc.layers,layerNumbers)){
    const type=layerLinetypeLabel(layer.linetype),kind=layerKindLabel(layer),state=layerStateLabel(layer);
    const no=layerNumbers.get(String(layer.name).toLowerCase());
    if(query&&!`${no?`${no}번 LN${no} `:''}${layer.name} ${kind} ${type} ${layer.color} ${state}`.toLocaleLowerCase('ko').includes(query))continue;
    const row=document.createElement('div');row.className='current-layer-option';row.dataset.layerId=layer.id;row.setAttribute('role','option');row.setAttribute('aria-selected',String(layer.id===shown));row.title=layerTooltip(layer);
    const pick=document.createElement('button');pick.type='button';pick.className='current-layer-pick';pick.setAttribute('aria-label',`${layer.name} 레이어 선택`);
    const swatch=document.createElement('span');swatch.className='current-layer-swatch';swatch.style.setProperty('--layer-color',layer.color);
    const copy=document.createElement('span');copy.className='current-layer-option-copy';
    const name=document.createElement('strong');name.textContent=layer.name;name.title=layerTooltip(layer);name.style.color=layer.color;
    const meta=document.createElement('small');meta.textContent=[kind,`${layer.lineweight??0.25} mm`,layer.color.toUpperCase(),state].filter(Boolean).join(' · ');
    copy.append(name,meta);pick.append(swatch,copy);
    if(no){const badge=document.createElement('span');badge.className='current-layer-number';badge.textContent=String(no);badge.title=`${no}번 레이어 · 명령창에 LN${no} 또는 레이어${no}`;badge.setAttribute('aria-label',`${no}번`);badge.style.cssText='flex:none;min-width:1.7em;padding:0 .35em;border-radius:.8em;background:#2b3645;color:#d7e3f4;font:600 11px/1.7 system-ui,sans-serif;text-align:center';pick.prepend(badge);}
    pick.onclick=()=>{select.value=layer.id;select.dispatchEvent(new Event('change',{bubbles:true}));closeCurrentLayerChooser();};
    // 표시·잠금은 눈·자물쇠 그림 단추(사장님 10-26 레이어 창 시안: 글 단추 '해제'가 칸을 많이 차지했다).
    const layerOn=layer.visible!==false&&!layer.frozen;
    const visibility=document.createElement('button');visibility.type='button';visibility.className='current-layer-visibility';visibility.innerHTML=layerOn?LAYER_ICON_EYE:LAYER_ICON_EYE_OFF;visibility.setAttribute('aria-pressed',String(layerOn));
    visibility.setAttribute('aria-label',`${layer.name} 표시`);visibility.title=layer.frozen?'동결됨 · 누르면 동결 해제하고 켜기':layerOn?`${layer.name} 끄기`:`${layer.name} 켜기`;
    visibility.onclick=()=>safe(()=>execute({type:'layer.update',id:layer.id,changes:{visible:!layerOn,...(!layerOn?{frozen:false}:{})}}));
    const lock=document.createElement('button');lock.type='button';lock.className='current-layer-lock';lock.innerHTML=layer.locked?LAYER_ICON_LOCK:LAYER_ICON_UNLOCK;lock.title=layer.locked?`${layer.name} 잠금 풀기`:`${layer.name} 잠그기(지워지지 않게)`;lock.setAttribute('aria-label',`${layer.name} 잠금`);lock.setAttribute('aria-pressed',String(!!layer.locked));
    lock.onclick=()=>safe(()=>execute({type:'layer.update',id:layer.id,changes:{locked:!layer.locked}}));
    const editors=document.createElement('span');editors.className='current-layer-editors';
    const controls=document.createElement('span');controls.className='current-layer-editor-controls';
    const preview=document.createElement('span');preview.className='current-layer-line-preview';preview.setAttribute('aria-label',`${layer.name} 선 모양 미리보기`);
    const previewSvg=document.createElementNS('http://www.w3.org/2000/svg','svg');previewSvg.setAttribute('viewBox','0 0 180 20');previewSvg.setAttribute('aria-hidden','true');
    const previewLine=document.createElementNS('http://www.w3.org/2000/svg','line');previewLine.setAttribute('x1','5');previewLine.setAttribute('y1','10');previewLine.setAttribute('x2','175');previewLine.setAttribute('y2','10');previewLine.setAttribute('vector-effect','non-scaling-stroke');
    const previewLabel=document.createElement('small');previewSvg.append(previewLine);preview.append(previewSvg,previewLabel);
    const previewState={color:layer.color,linetype:layer.linetype||'CONTINUOUS',lineweight:layer.lineweight??.25};
    const redrawPreview=()=>updateLayerLinePreview(preview,previewState);redrawPreview();
    const color=document.createElement('input');color.type='color';color.value=layer.color;color.setAttribute('aria-label',`${layer.name} 색상 변경`);color.title=`${layer.name} 색상 · ${layer.color.toUpperCase()}`;
    color.oninput=event=>{swatch.style.setProperty('--layer-color',event.target.value);name.style.color=event.target.value;previewState.color=event.target.value;redrawPreview();};
    color.onchange=event=>safe(()=>{execute({type:'layer.update',id:layer.id,changes:{color:event.target.value}});log(`${layer.name} 색상을 ${event.target.value.toUpperCase()}로 변경했습니다. Ctrl+Z 로 되돌립니다.`);});
    const linetype=document.createElement('select');linetype.setAttribute('aria-label',`${layer.name} 선종류 변경`);linetype.title=`${layer.name} 선종류`;
    const types=[...new Set([layer.linetype||'CONTINUOUS',...STANDARD_LINETYPES.map(l=>l.name)])];   // 표준 acadiso 선종류 전체(객체 선종류와 같은 목록)
    for(const value of types){const option=document.createElement('option');option.value=value;option.textContent=layerLinetypeOptionLabel(value);linetype.append(option);}linetype.value=layer.linetype||'CONTINUOUS';
    linetype.oninput=event=>{previewState.linetype=event.target.value;redrawPreview();};
    linetype.onchange=event=>safe(()=>{execute({type:'layer.update',id:layer.id,changes:{linetype:event.target.value}});log(`${layer.name} 선종류를 ${layerLinetypeLabel(event.target.value)}으로 변경했습니다. Ctrl+Z 로 되돌립니다.`);});
    const lineweight=document.createElement('select');lineweight.setAttribute('aria-label',`${layer.name} 선두께 변경`);lineweight.title=`${layer.name} 선두께 (mm)`;
    const weights=[...new Set([layer.lineweight??.25,.05,.09,.13,.15,.18,.20,.25,.30,.35,.40,.50,.53,.60,.70,.80,1,1.2,1.4,1.58,2,2.11])].sort((a,b)=>a-b);
    for(const value of weights){const option=document.createElement('option');option.value=String(value);option.textContent=`${Number(value).toFixed(2)} mm`;lineweight.append(option);}lineweight.value=String(layer.lineweight??.25);
    lineweight.oninput=event=>{previewState.lineweight=Number(event.target.value);redrawPreview();};
    lineweight.onchange=event=>safe(()=>{const value=Number(event.target.value);if(!Number.isFinite(value)||value<.05||value>5)throw Error('선두께는 0.05~5.00 mm 사이여야 합니다.');execute({type:'layer.update',id:layer.id,changes:{lineweight:value}});log(`${layer.name} 선두께를 ${value.toFixed(2)} mm로 변경했습니다. Ctrl+Z 로 되돌립니다.`);});
    for(const control of [linetype,lineweight])control.addEventListener('keydown',event=>event.stopPropagation());controls.append(color,linetype,lineweight);editors.append(controls,preview);row.append(pick,visibility,lock,editors);
    list.append(row);
  }
  if(!list.children.length){const empty=document.createElement('p');empty.className='current-layer-empty';empty.textContent='일치하는 레이어가 없습니다.';list.append(empty);}
}
/* AutoCAD 홈 탭 '특성' 패널: 색·선종류 선택기. 선택한 객체가 있으면 그 객체(CHPROP), 없으면 이후 그릴 객체(CECOLOR·CELTYPE)를 바꾼다. */
const PROPERTY_OTHER='__other__';
function colorKey(spec){if(!spec||spec.mode==='bylayer')return 'BYLAYER';if(spec.mode==='byblock')return 'BYBLOCK';if(spec.mode==='aci'&&spec.aci>=1&&spec.aci<=9)return String(spec.aci);return 'CUSTOM';}
function rebuildPropertyStrip(){
  const colorSelect=document.getElementById('current-color-select'),linetypeSelect=document.getElementById('current-linetype-select');
  if(!colorSelect||!linetypeSelect)return;
  // 목록을 새로 채워도 지금 고른 값은 그대로 둔다(선종류 칸을 누를 때 색·굵기 칸이 첫 항목으로 돌아가던 문제).
  const keep=[colorSelect,linetypeSelect,document.getElementById('current-lineweight-select')].map(select=>select?.value);
  const colorItems=[['BYLAYER','ByLayer'],['BYBLOCK','ByBlock'],...Object.entries(COLOR_NAMES).map(([n,name])=>[n,n+' '+name]),['CUSTOM','다른 색'],[PROPERTY_OTHER,'다른 색 고르기…']];
  colorSelect.replaceChildren(...colorItems.map(([value,label])=>{const o=document.createElement('option');o.value=value;o.textContent=label;if(value==='CUSTOM')o.hidden=true;return o;}));
  const lt=[...linetypeChoices(engine.doc).map(([value])=>[value,value==='BYLAYER'?'선종류 ByLayer':`${linetypeSample(value)}  ${linetypeLabel(value)}`]),['BYBLOCK','선종류 ByBlock']];
  linetypeSelect.replaceChildren(...lt.map(([value,label])=>{const o=document.createElement('option');o.value=value;o.textContent=label;return o;}));
  const lineweightSelect=document.getElementById('current-lineweight-select');
  if(lineweightSelect)lineweightSelect.replaceChildren(...[['BYLAYER','굵기 ByLayer'],...LINEWEIGHTS.map(w=>[String(w),w.toFixed(2)+' mm'])].map(([value,label])=>{const o=document.createElement('option');o.value=value;o.textContent=label;return o;}));
  [colorSelect,linetypeSelect,lineweightSelect].forEach((select,i)=>{if(select&&keep[i]!=null&&[...select.options].some(o=>o.value===keep[i]))select.value=keep[i];});
}
function syncPropertyStrip(){
  const colorSelect=document.getElementById('current-color-select'),linetypeSelect=document.getElementById('current-linetype-select');
  if(!colorSelect||!linetypeSelect)return;
  if(!colorSelect.options.length||!linetypeSelect.options.length)rebuildPropertyStrip();
  const sel=chosen();
  const colorOf=sel.length?[...new Set(sel.map(e=>colorKey(colorOfEntity(e))))]:[colorKey(currentProperties.color)];
  const linetypeOf=sel.length?[...new Set(sel.map(e=>e.linetype?String(e.linetype).toUpperCase():'BYLAYER'))]:[currentProperties.linetype||'BYLAYER'];
  colorSelect.value=colorOf.length===1?colorOf[0]:'';
  if(linetypeOf.length===1&&![...linetypeSelect.options].some(o=>o.value===linetypeOf[0])){
    rebuildPropertyStrip();
    // 목록에 없는 이름(가져온 도면의 선종류 정의 없음 등)은 한 번만 덧붙여, 화면을 새로 그릴 때마다 전체를 다시 훑지 않게 한다.
    if(![...linetypeSelect.options].some(o=>o.value===linetypeOf[0])){const o=document.createElement('option');o.value=linetypeOf[0];o.textContent=linetypeOf[0];linetypeSelect.append(o);}
  }
  linetypeSelect.value=linetypeOf.length===1?linetypeOf[0]:'';
  const lineweightSelect=document.getElementById('current-lineweight-select');
  if(lineweightSelect){const weights=sel.length?[...new Set(sel.map(e=>e.lineweight==null?'BYLAYER':String(e.lineweight)))]:[currentProperties.lineweight==null?'BYLAYER':String(currentProperties.lineweight)];if(weights.length===1&&![...lineweightSelect.options].some(o=>o.value===weights[0])){const o=document.createElement('option');o.value=weights[0];o.textContent=Number(weights[0]).toFixed(2)+' mm';lineweightSelect.append(o);}lineweightSelect.value=weights.length===1?weights[0]:'';}
  const objectTitle=document.getElementById('current-object-title');if(objectTitle)objectTitle.textContent=sel.length?`선택 객체 ${sel.length}개`:'이후 그릴 객체';
  const sample=sel.length?(colorOf.length===1?colorOfEntity(sel[0]):null):currentProperties.color;   // 비어 있으면 ByLayer 또는 여러 색
  colorSelect.title=(sel.length?`선택 ${sel.length}개의 색`:`현재 색(CECOLOR): ${describeColor(currentProperties.color)}`)+' · 바꾸면 '+(sel.length?'선택 객체':'이후 그릴 객체')+'에 적용';
  colorSelect.parentElement?.style.setProperty('--property-color',sample?.color||'transparent');
  linetypeSelect.title=(sel.length?`선택 ${sel.length}개의 선종류`:`현재 선종류(CELTYPE): ${currentProperties.linetype||'ByLayer'}`)+' · 바꾸면 '+(sel.length?'선택 객체':'이후 그릴 객체')+'에 적용';
}
function changeFromPropertyStrip(kind,value){
  const sel=selected.size?engine.doc.entities.filter(e=>selected.has(e.id)):[];
  if(value===PROPERTY_OTHER){syncPropertyStrip();run(sel.length?'CHPROP':'CECOLOR');return;}
  if(kind==='color'){
    const spec=parseColor(value);
    if(sel.length){const ok=sel.filter(e=>!layerMap().get(e.layer)?.locked);if(!ok.length)throw Error('선택한 객체가 모두 잠긴 레이어에 있습니다.');execute({type:'update',ids:ok.map(e=>e.id),changes:colorChanges(spec)});log(`${ok.length}개 색을 ${describeColor(spec)}(으)로 바꿨습니다. Ctrl+Z 로 되돌립니다.`);}
    else{currentProperties={...currentProperties,color:spec.mode==='bylayer'?null:spec};log(`현재 색: ${describeColor(spec)}`);}
  }else if(kind==='lineweight'){
    const lineweight=parseLineweight(value);
    if(sel.length){const ok=sel.filter(e=>!layerMap().get(e.layer)?.locked);if(!ok.length)throw Error('선택한 객체가 모두 잠긴 레이어에 있습니다.');execute({type:'update',ids:ok.map(e=>e.id),changes:{lineweight}});log(`${ok.length}개 선굵기를 ${lineweight==null?'ByLayer':lineweight+' mm'}(으)로 바꿨습니다. Ctrl+Z 로 되돌립니다.`);}
    else{currentProperties={...currentProperties,lineweight};log(`현재 선굵기: ${lineweight==null?'ByLayer':lineweight+' mm'}`);}
  }else{
    const linetype=parseLinetype(value,engine.doc);
    if(sel.length){const ok=sel.filter(e=>!layerMap().get(e.layer)?.locked);if(!ok.length)throw Error('선택한 객체가 모두 잠긴 레이어에 있습니다.');execute({type:'update',ids:ok.map(e=>e.id),changes:{linetype}});log(`${ok.length}개 선종류를 ${linetype||'ByLayer'}(으)로 바꿨습니다. Ctrl+Z 로 되돌립니다.`);}
    else{currentProperties={...currentProperties,linetype};log(`현재 선종류: ${linetype||'ByLayer'}`);}
  }
  syncPropertyStrip();
}
function entityColorText(e){if(e?.colorMode==='byblock')return 'BYBLOCK';if(!e?.color)return 'BYLAYER';if(e.colorMode==='aci'&&e.aci)return String(e.aci);return e.color;}
function syncCurrentLayerChooser(layerOverride) {
  const trigger=document.getElementById('current-layer-trigger'),select=document.getElementById('current-layer-select');
  if(!trigger||!select)return;
  const swatch=trigger.querySelector('.current-layer-swatch'),name=trigger.querySelector('strong'),meta=trigger.querySelector('small'),footer=document.getElementById('current-layer-footer'),shown=layerOverride===undefined?shownLayer():layerOverride,layer=engine.doc.layers.find(item=>item.id===shown);
  select.value=shown;
  if(layer){
    swatch.style.setProperty('--layer-color',layer.color);swatch.classList.remove('is-mixed');
    name.textContent=layer.name;name.style.color=layer.color;
    meta.textContent=`${layerKindLabel(layer)} · ${layerLinetypeLabel(layer.linetype)}`;
  }else{
    swatch.style.removeProperty('--layer-color');swatch.classList.add('is-mixed');
    name.textContent='여러 레이어';name.style.removeProperty('color');
    meta.textContent=`${selected.size}개 선택 · 적용할 레이어 선택`;
  }
  if(footer)footer.textContent=selected.size?`선택 객체 ${selected.size}개를 고른 레이어로 일괄 변경합니다.`:'새로 그리는 객체에 사용할 현재 레이어를 선택합니다.';
  for(const row of document.querySelectorAll('#current-layer-list .current-layer-option'))row.setAttribute('aria-selected',String(row.dataset.layerId===shown));
}
function refresh() {
  const visibleEntities=visible();
  // 도면 변경 뒤 첫 클릭에서 공간 인덱스를 만들지 않도록 화면이 안정되는 동안 미리 준비한다.
  warmNearbyIndex(visibleEntities);
  // Drop selections that are no longer displayed: deleted, hidden, or on an
  // off/frozen layer. Check the selected objects themselves; large drawings
  // cull visible() to the viewport, which must not deselect objects panned
  // off screen, and a Set of every visible id cost O(document) per refresh.
  if(selected.size){
    for(const id of selected){const e=entityMap().get(id),layer=e&&layerMap().get(e.layer);if(!e||e.hidden||!layer?.visible||layer.frozen)selected.delete(id);}
  }

  if (!engine.doc.layers.some((l) => l.id === activeLayer))
    activeLayer = engine.doc.layers[0].id;
  // 성능: 레이어 구성이 그대로면 목록 DOM을 다시 만들지 않는다(엔티티만 바뀐 편집에서는 통계만 갱신).
  const layerSignature=JSON.stringify([activeLayer,engine.doc.layers.map(l=>[l.id,l.name,l.label,l.color,l.linetype,l.lineweight,l.visible,l.locked,l.frozen])]);
  const layersChanged=layerSignature!==refresh.layerSignature;
  refresh.layerSignature=layerSignature;
  const currentLayerSelect=document.getElementById('current-layer-select');
  if(currentLayerSelect&&(layersChanged||currentLayerSelect.options.length!==engine.doc.layers.length+1)){
    const blank=document.createElement('option');blank.value='';blank.textContent='';   // 여러 레이어가 섞였을 때 보여 줄 빈칸
    currentLayerSelect.replaceChildren(blank,...engine.doc.layers.map(l=>{
      const option=document.createElement('option');option.value=l.id;
      option.textContent=l.name+(l.locked?' · 잠김':l.frozen?' · 동결':!l.visible?' · 숨김':'');
      return option;
    }));
  }
  // 고른 객체의 레이어를 보여 준다. 선택을 풀면 다시 지금 그리는 레이어로 돌아온다.
  if(currentLayerSelect)currentLayerSelect.value=shownLayer();
  // The chooser is rebuilt when it opens; a closed one is emptied instead of
  // rebuilt (160 layer rows cost ~130 ms of every layer on/off or new layer).
  if(layersChanged){if(document.getElementById('current-layer-popover')?.hidden===false)rebuildCurrentLayerChooser();else document.getElementById('current-layer-list')?.replaceChildren();}
  syncCurrentLayerChooser();
  syncPropertyStrip();
  showSelectionCount();
  $("count").textContent = `${selected.size} 선택`;
  $("object-properties-panel")?.classList.toggle("has-selection",selected.size>0);
  if(typeof propertiesDock!=='undefined'&&propertiesDock)propertiesDock.notify();
  $("properties").replaceChildren();
  const es = chosen(),
    row = (a, b) => {
      const r = document.createElement("div");
      r.className = "row";
      const label = document.createElement("span"),
        value = document.createElement("strong");
      label.textContent = a;
      value.textContent = b;
      r.append(label, value);
      $("properties").append(r);
    };
  if (es.length === 1) {
    const e = es[0],
      b = G.bounds(es);
    row("형식", e.type.toUpperCase());
    row("레이어", engine.doc.layers.find((l) => l.id === e.layer).name);
    if (e.radius) row("반지름", fmt(e.radius) + " mm");
    if (e.thickness) row("벽 두께", fmt(e.thickness) + " mm");
    if ((e.linetype || e._displayLinetype || '').toUpperCase() !== 'CONTINUOUS') row("선종류 축척", fmt(e.linetypeScale || 1));
    if (e.text !== undefined) row("문자", e.text);
    if (b) {
      row("폭", fmt(b.maxX - b.minX) + " mm");
      row("높이", fmt(b.maxY - b.minY) + " mm");
    }
    const p = e.center || e.position || e.points?.[0];
    if (p) {
      row("기준 X", fmt(p.x));
      row("기준 Y", fmt(p.y));
    }
    if (e.type === "line") row("길이", fmt(G.dist(...e.points)) + " mm");
    if (e.type === "block") row("블록", e.name);
  } else
    $("properties").textContent = es.length
      ? `${es.length}개 선택 · ${settings.aliases.COPY || "COPY"} 입력 후 Enter로 복사`
      : "객체를 선택하면 실제 좌표와 치수를 표시합니다.";
  document
    .querySelectorAll("[data-command=UNDO]")
    .forEach((b) => (b.disabled = !engine.undoStack.length));
  document
    .querySelectorAll("[data-command=REDO]")
    .forEach((b) => (b.disabled = !engine.redoStack.length));
  updatePrompt();
  render();
}
// 성능: 편집마다 도면 전체를 동기 기록하면 입력이 멈춘다. 1초 유휴 뒤 한 번만 쓰고, 종료 시 flushLocalRecovery로 마무리한다.
let localRecoveryTimer=0,lastRecoveryInteraction=0;
for(const event of ['pointermove','pointerdown','keydown','wheel'])document.addEventListener(event,()=>{lastRecoveryInteraction=performance.now();},{capture:true,passive:true});
function recoveryInputActive(){return performance.now()-lastRecoveryInteraction<1000;}
// Background recovery writes run in small slices. While the user is working
// they wait between slices instead of taking frames from zoom, pan or commands;
// an explicit flush (tab close, page hide) clears the flag and runs straight on.
let recoveryBackground=false;
// setTimeout(0) is clamped to 4 ms once nested, which turned a few thousand
// recovery pages into tens of seconds. A message task still yields to input
// and painting between slices without that clamp.
const recoveryYieldChannel=typeof MessageChannel==='function'?new MessageChannel():null,recoveryYieldWaiters=[];
if(recoveryYieldChannel)recoveryYieldChannel.port1.onmessage=()=>recoveryYieldWaiters.shift()?.();
// 도면 열기 단계 쉬기: 보이면 다음 그리기(rAF)까지, 창이 가려지거나 최소화되면 크롬이 rAF 를 멈추고 타이머를 1초로 늦추므로 메시지 작업으로
// — 대표가 다른 창을 보는 동안 큰 도면 열기가 멈춰 있던 것(7.0.41 설치 확인 2026-11-02). 보이는 동안은 예전과 같다.
function loadPaint(){return document.hidden?recoveryNextTask():new Promise(resolve=>{let done=false;const finish=()=>{if(!done){done=true;resolve();}};requestAnimationFrame(finish);setTimeout(finish,250);});}
function loadTask(){return document.hidden?recoveryNextTask():new Promise(resolve=>setTimeout(resolve,0));}
function recoveryNextTask(){return recoveryYieldChannel?new Promise(resolve=>{recoveryYieldWaiters.push(resolve);recoveryYieldChannel.port2.postMessage(0);}):new Promise(resolve=>setTimeout(resolve,0));}
function recoveryPause(){return new Promise(resolve=>{const step=()=>{if(recoveryBackground&&(busy||recoveryInputActive()))setTimeout(step,150);else recoveryNextTask().then(resolve);};step();});}
// A fresh launch checks and keeps the previous session in the background;
// recovery writes wait for it so the new workspace never overwrites it.
let recoveryStartup=null;
// Weight counts objects inside blocks too (see import-stream documentWeight).
const recoveryWeights=new WeakMap();
const recoveryWeight=doc=>{if(!doc)return 0;let weight=recoveryWeights.get(doc);if(weight===undefined){weight=typeof documentWeight==='function'?documentWeight(doc,50001):(doc?.entities?.length||0);recoveryWeights.set(doc,weight);}return weight;};
function oversizedActiveDocument(){return recoveryWeight(engine.doc)>50000;}
function scheduleLocalRecovery(){
 clearTimeout(localRecoveryTimer);localRecoveryTimer=0;
 // The workspace store already saves this document and its last undo state.
 // Avoid serializing the same large drawing into synchronous localStorage too.
 // Keep the legacy recovery path when IndexedDB is unavailable or fails.
 if(oversizedActiveDocument()||(documents&&recoveryStore&&!recoveryBlocked&&!hasOversizedRecoveryDocument()))return;
 localRecoveryTimer=setTimeout(()=>{if((typeof aiReveal!=='undefined'&&aiReveal)||recoveryInputActive())scheduleLocalRecovery();else flushLocalRecovery();},1000);
}
function flushLocalRecovery(){
   if(typeof finishAIReveal==='function')finishAIReveal();
  clearTimeout(localRecoveryTimer);localRecoveryTimer=0;
  if(oversizedActiveDocument())return;
  try{
    localStorage.setItem("barun-cad-recovery-v2", JSON.stringify(engine.doc));
    stampRecovery("barun-cad-recovery-rev", sceneRevision);
  } catch {
    toast("임시 저장 공간이 부족합니다. DXF/BCAD 파일로 저장하세요.", true);
  }
}
let engineRefreshFrame=0,pendingEngineCheckpoint=false;
function scheduleEngineUiRefresh(){
  if(engineRefreshFrame)return;
  engineRefreshFrame=requestAnimationFrame(()=>{
    engineRefreshFrame=0;refresh();
    const checkpoint=pendingEngineCheckpoint&&(typeof aiReveal==='undefined'||!aiReveal);if(checkpoint)pendingEngineCheckpoint=false;
    if(checkpoint&&documents){documents.checkpoint();renderDrawingTabs();scheduleDrawingRecovery();}
    if(checkpoint)scheduleLocalRecovery();
  });
}
engine.onChange(() => {
  gpuEdit=null;
  if(typeof aiReveal!=='undefined'&&aiReveal&&engine.doc!==aiReveal.doc)finishAIReveal();
  clearOverlapSelection();
  sceneRevision++;
  if(!switchingDrawing)dirty = true;
  $("dirty").textContent = dirty ? "●" : "";
  if(!switchingDrawing)pendingEngineCheckpoint=true;
  scheduleEngineUiRefresh();
});
document.fonts?.load('16px "Barun Drawing Korean"').then(()=>{sceneKey=null;render();}).catch(()=>{});
function safe(fn) {
  safe.lastError = null;
  try {
    return fn();
  } catch (e) {
    safe.lastError = e;
    toast(e.message, true);
    return null;
  }
}
function localPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
// 드래그 미리보기는 도면 전체를 복제하지 않는다. 대형 DWG에서 매 프레임마다
// structuredClone(engine.doc)와 전 객체 JSON 비교를 하면 포인터보다 그림이 늦게 따라왔다.
// 실제 명령과 같은 변환을 선택 객체(및 벽 연동 객체)에만 적용한다.
// 선택용 UI만 그린다. 출력·DXF·엔진 객체에는 중심선을 넣지 않는다.
function wallGripPreview(grip,point){
 const ps=grip.path.map((p)=>({...p}));
 if(grip.role==='start'||grip.role==='end')ps[grip.role==='start'?0:1]={...point};
 else if(grip.role==='move'){const dx=point.x-grip.point.x,dy=point.y-grip.point.y;ps.forEach((p)=>{p.x+=dx;p.y+=dy;});}
 const out=[{type:'line',points:ps,color:'#9dcbe0'}];
 if(grip.role==='thickness')out.push({type:'line',points:[{x:(ps[0].x+ps[1].x)/2,y:(ps[0].y+ps[1].y)/2},point],color:'#9dcbe0'});
 return out;
}
async function applyWallGrip(grip,point){
 try{const {commitWallGrip}=await ensureWallEditor();await commitWallGrip({doc:()=>engine.doc,execute,setSelected,refresh,toast,regenerateDrawingSet},grip,point);}catch(error){toast(error.message,true);render();}
}
function moveDragPreview(command){
 if(!drag.moveCache){
  const initial=engine.selected(command.ids),selectedIds=new Set(initial.map(e=>e.id)),wallIds=new Set(initial.filter(e=>e.type==='wall').map(e=>e.id));
  const related=engine.doc.entities.filter(e=>!selectedIds.has(e.id)&&(wallIds.has(e.hostWall)||selectedIds.has(e.roomBoundary)));
  const targets=[...initial,...related],needsWalls=targets.some(e=>e.hostWall&&!wallIds.has(e.hostWall));
  drag.moveCache={targets,wallIds,walls:needsWalls?engine.doc.entities.filter(e=>e.type==='wall'):[]};
 }
 const {targets,wallIds,walls}=drag.moveCache;
 if(drag.bitmapPreview===undefined)drag.bitmapPreview=typeof heavyTranslateSelection==='function'&&!walls.length&&targets.length===command.ids.length&&heavyTranslateSelection(targets);
 if(drag.bitmapPreview)return [];
 return targets.map(e=>{
  if(e.hostWall&&!wallIds.has(e.hostWall))return rebuildArchitecture(G.translate(e,command.dx,command.dy),{},walls);
  return previewTransformEntity(e,'translate',{dx:command.dx,dy:command.dy});
 });
}
// MOVE/COPY/끌기에서 큰 대상(공유 블록, 자식 800개 넘는 블록, 수백 개 선택)은 외곽 사각형 대신
// 실제 모양을 한 번 그림으로 떠 두고 그 그림만 옮겨 그린다(AutoCAD 처럼 대상이 마우스를 따라온다).
// 매 프레임 비용은 그림 한 장이다. 화면을 옮기거나 확대하면, 또는 너무 멀리 끌면 다시 뜬다.
let translateSnapshot=null;
// 공유 블록은 집기 색인이 이미 펼쳐 둔 화면을 쓴다(10/30 주동딱지 COPY: 12,205개를 다시 펼치느라 3.7초).
function previewShape(entity){
 if(!entity.sharedBlock)return entity;
 const shown=nearby.objectsRevision===sceneRevision?nearby.sharedCopies?.get(entity.id):null;
 return shown&&shown.position?.x===entity.position?.x&&shown.position?.y===entity.position?.y?shown:G.resolveSharedDrawingReference(engine.doc,entity);
}
function heavyTranslateSelection(entities){
 if(entities.length>300)return true;
 for(const entity of entities){
  if(entity.sharedBlock)return true;
  if(entity.type!=='block')continue;
  let count=0;const stack=[...(entity.entities||[])];
  while(stack.length&&count<=800){const child=stack.pop();count++;if(child?.entities)stack.push(...child.entities);}
  if(count>800)return true;
 }
 return false;
}
function translatePreviewState(){
 if(drag?.kind==='object-move'&&drag.command?.type==='move'&&drag.bitmapPreview)return {ids:drag.command.ids,dx:drag.command.dx,dy:drag.command.dy};
 if(['MOVE','COPY'].includes(mode)&&points.length&&cursor&&translateSnapshot?.mode===mode){const a=points[0];return {ids:translateSnapshot.ids,dx:cursor.x-a.x,dy:cursor.y-a.y};}
 return null;
}
function drawTranslateSnapshot(color){
 const state=translatePreviewState();if(!state)return;
 try{
 const ratio=canvas.width/width,key=[state.ids.length,state.ids[0],scale,origin.x,origin.y,canvas.width,canvas.height,sceneRevision].join('|');
 let snap=translateSnapshot?.canvas&&translateSnapshot.key===key?translateSnapshot:null;
 const far=snap&&(Math.abs((state.dx-snap.dx)*scale)>width*.35||Math.abs((state.dy-snap.dy)*scale)>height*.35);
 if(!snap||far){
  const target=snap?.canvas||translateSnapshot?.canvas||document.createElement('canvas');
  target.width=canvas.width;target.height=canvas.height;
  const octx=target.getContext('2d');octx.setTransform(ratio,0,0,ratio,0,0);octx.clearRect(0,0,width,height);
  const at=p=>screen({x:p.x+state.dx,y:p.y+state.dy});
  const tl=world({x:0,y:0}),br=world({x:width,y:height}),pad=8/scale;
  const box={minX:Math.min(tl.x,br.x)-state.dx-pad,maxX:Math.max(tl.x,br.x)-state.dx+pad,minY:Math.min(tl.y,br.y)-state.dy-pad,maxY:Math.max(tl.y,br.y)-state.dy+pad};
  for(const entity of engine.selected(state.ids)){
   let shown=entity;try{shown=previewShape(entity);}catch{}
   drawEntity(octx,shown,at,scale,color,1.4,true,false,box);
  }
  snap=translateSnapshot={...(translateSnapshot||{}),canvas:target,key,dx:state.dx,dy:state.dy};
 }
 ctx.save();ctx.setTransform(1,0,0,1,0,0);
 ctx.drawImage(snap.canvas,Math.round((state.dx-snap.dx)*scale*ratio),Math.round(-(state.dy-snap.dy)*scale*ratio));
 ctx.restore();
 }catch(error){translateSnapshot=translateSnapshot&&{mode:translateSnapshot.mode,ids:translateSnapshot.ids};console.warn('move preview',error);}
}
// MOVE/COPY/ROTATE 중에는 마우스가 움직일 때마다 선택 블록의 모든 자식을
// 새 객체로 복제하지 않는다. 그리기 좌표만 바꾸는 얇은 래퍼를 사용한다.
// 큰 블록은 외곽선으로 미리 보여 주고 최종 클릭 때만 실제 형상을 변환한다.
// ACAD200 123: ROTATE·SCALE·MIRROR of a large selection (the MOVE bitmap rule) draws one
// snapshot of the selection with a transform matrix per frame instead of
// re-drawing every object (preview-matrix.js). Small selections keep the wrappers.
function heavyMatrixPreview(targets,operation,values){
 if(!targets.length||typeof heavyTranslateSelection!=='function'||!heavyTranslateSelection(targets)){matrixPreviewState=null;return false;}
 const ids=targets.map(e=>e.id),key=ids.length+'|'+ids[0]+'|'+ids.at(-1)+'|'+sceneRevision;
 if(matrixPreviewBounds?.key!==key)matrixPreviewBounds={key,bounds:G.bounds(targets)};
 matrixPreviewState={mode,ids,key,affine:previewAffine(operation,values)};return true;
}
function drawMatrixPreview(color){
 const state=matrixPreviewState;if(!state)return;
 if(state.mode!==mode||matrixPreviewBounds?.key!==state.key){matrixPreviewState=null;matrixSnapshot.clear();return;}
 try{
  const ratio=canvas.width/width,key=[state.key,scale,origin.x,origin.y,canvas.width,canvas.height,color].join('|');
  matrixSnapshot.draw(ctx,{key,bounds:matrixPreviewBounds.bounds,view:{scale,origin,ratio},affine:state.affine,paint:(octx,box)=>{
   for(const entity of engine.selected(state.ids)){let shown=entity;try{shown=previewShape(entity);}catch{}drawEntity(octx,shown,screen,scale,color,1.4,true,false,box);}
  }});
 }catch(error){matrixPreviewState=null;console.warn('matrix preview',error);}
}
function previewTransformEntity(entity,operation,values){
 let source=entity;
 if(entity.type==='block'){
  let count=0,stack=[...(entity.entities||[])];
  while(stack.length&&count<=800){const child=stack.pop();count++;if(child?.entities)stack.push(...child.entities);}
  if(entity.sharedBlock||count>800){
   const bounds=entity._renderBounds||G.bounds(entity.entities||[]);
   if(bounds)source={type:'polyline',closed:true,points:G.rectangle({x:bounds.minX,y:bounds.minY},{x:bounds.maxX,y:bounds.maxY})};
  }
 }
 return {type:'preview-transform',source,operation,...values};
}
function gripDragPreview(command){
 if(command.type==='move')return moveDragPreview(command);
 if(command.type==='stretch'){
  if(!drag.stretchSources){
   const ids=new Set(G.stretchEntities(engine.doc.entities,command.targets,{x:0,y:0}).map(e=>e.id));
   drag.stretchSources=engine.doc.entities.filter(e=>ids.has(e.id));
  }
  return G.stretchEntities(drag.stretchSources,command.targets,{x:command.dx,y:command.dy});
 }
 if(command.type==='update')return engine.selected(command.ids).map(e=>Object.assign(structuredClone(e),structuredClone(command.changes)));
 if(command.type==='opening.grip'){
  const e=engine.selected(command.ids)[0],wall=engine.doc.entities.find(w=>w.id===e.hostWall);
  if(!wall)throw Error('연결된 벽이 없습니다.');
  const a=wall.points[0],u=G.unit(G.sub(wall.points[1],a)),length=G.dist(...wall.points),start=G.dot(G.sub(e.position,a),u),end=start+e.openingWidth;
  const at=Math.max(0,Math.min(length,G.dot(G.sub(command.point,a),u))),nextStart=command.end==='opening-start'?Math.min(at,end-1):start,nextEnd=command.end==='opening-end'?Math.max(at,start+1):end;
  const rebuilt=wallOpening(e.category,{...e.parameters,width:nextEnd-nextStart},wall,G.add(a,G.mul(u,nextStart)),e.layer);
  return [{...e,...rebuilt,id:e.id,attributes:{...e.attributes,...rebuilt.attributes}}];
 }
 throw Error('지원하지 않는 드래그 미리보기입니다.');
}
function previewDrag(point){
 if(drag?.grip?.aiWall){drag.command={type:'ai-wall-grip',grip:drag.grip,point};drag.preview=wallGripPreview(drag.grip,point);drag.error=null;return;}
 if(!drag||!['entity-grip','object-move'].includes(drag.kind))return;
 try{
  const source=engine.doc.entities.find(e=>e.id===drag.id),command=drag.kind==='entity-grip'?(typeof gripDragCommand==='function'?gripDragCommand(source,drag,point):G.gripCommand(source,drag.grip,point)):{type:'move',ids:drag.ids,dx:point.x-drag.base.x,dy:point.y-drag.base.y};
  drag.preview=gripDragPreview(command);drag.command=command;drag.error=null;
 }catch(error){drag.command=null;drag.preview=[];drag.error=error.message;}
}
// No hold timer: mouse/pen enters drag on the first meaningful movement.
// Touch keeps a small guard because a finger produces several pixels of
// contact jitter even when the user intends a tap.
const DRAG_THRESHOLD_MOUSE=.5,DRAG_THRESHOLD_TOUCH=3;
const pointerDragThreshold=e=>e?.pointerType==='touch'?DRAG_THRESHOLD_TOUCH:DRAG_THRESHOLD_MOUSE;
// A selection window's first corner is a drawing point, so panning or zooming to
// another part of the drawing and clicking there selects everything in between.
function selectionAnchor(d){return d?.startWorld?screen(d.startWorld):d?.start;}
// A command's selection step does not commit an object on press: released in
// place it selects that object, moved (button held or not) it becomes a window.
// Enter/Space arriving before the release settles it as that object click.
function settlePendingSelectionClick(){
 if(drag?.kind!=='selection'||!drag.pendingHit||drag.secondCorner)return;
 if(G.dist(selectionAnchor(drag),drag.current)>=Math.max(4,drag.threshold??.5))return;
 const id=drag.pendingHit,remove=drag.shift;drag=null;
 if(remove)selected.delete(id);else selected.add(id);
 if(selected.size)previousSelection=[...selected];
}
function schedulePreviewDrag(point){
 if(!drag)return;
 drag.pendingPoint=point;
 if(drag.previewFrame)return;
 drag.previewFrame=requestAnimationFrame(()=>{
  if(!drag)return;
  drag.previewFrame=0;
  const target=drag.pendingPoint;
  if(target){previewDrag(snap(target,typeof dragSnapOptions==='function'?dragSnapOptions(drag):undefined));render();}   // 312
 });
}
function beginPan(e,p) {
  if(typeof aiReveal!=='undefined'&&aiReveal)aiReveal.player.stopCamera();
  rememberView();
  const suspended=drag?.kind==='selection'?drag:null;
  const pan={kind:'pan',pointerId:e.pointerId,start:p,last:p,origin:{...origin},button:e.button===0?0:1,suspended};
  drag=typeof interaction!=='undefined'?interaction.tag(pan):pan;
  if(space)spaceDragged=true;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
}
// Escape ends only the presentation, before menus or command cancellation see it.
if(typeof document!=='undefined') document.addEventListener('keydown',e=>{if(e.key==='Escape'&&typeof aiReveal!=='undefined'&&aiReveal){e.preventDefault();e.stopImmediatePropagation();finishAIReveal();}},true);
// Suppress Chromium's native middle-button autoscroll before it steals the gesture.
canvas.addEventListener('mousedown',e=>{if(e.button===1)e.preventDefault();});
canvas.addEventListener('auxclick',e=>{if(e.button===1)e.preventDefault();});
// Only the opt-in Worker path can display a completed, older camera while a
// newer frame is rendering. Preserve navigation, but never edit unseen points.
for(const type of ['pointerdown','pointermove','pointerup','click','auxclick','contextmenu','dblclick'])canvas.addEventListener(type,e=>{
  if(typeof captureAIRevealPointer==='function'&&captureAIRevealPointer(e,type))return;
  if(typeof aiReveal!=='undefined'&&aiReveal)return;
  if(!waitingForGpuView())return;
  if(type==='pointerdown'&&(e.button===1||(e.button===0&&mode==='PAN')))return;
  if((type==='pointermove'||type==='pointerup')&&drag?.kind==='pan')return;
  e.preventDefault();e.stopImmediatePropagation();
  if(type==='pointerup'){
    if(drag?.previewFrame)cancelAnimationFrame(drag.previewFrame);
    drag=null;
    if(canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId);
  }
  render();
},true);
let inlineTextInput=null,inlineTextEntityId=null,finishInlineText=null,placeInlineText=null;
function editTextInline(entity){
  finishInlineText?.(true);
  const input=document.createElement('textarea');let fontSize=1,placed='';
  input.className='drawing-text-editor';input.value=entity.text;input.rows=Math.max(1,entity.text.split('\n').length);
  input.style.fontFamily=fontFamilyFor(entity);input.wrap='off';
  const resizeEditor=()=>{
   const lines=input.value.split('\n');ctx.save();ctx.font=`${fontSize}px ${fontFamilyFor(entity)}`;
   let longest=0;for(const line of lines)longest=Math.max(longest,ctx.measureText(line).width);ctx.restore();
   input.style.minWidth='0';input.style.width=Math.ceil(Math.max(fontSize*.6,longest)+8)+'px';
   input.style.height=Math.ceil(Math.max(1,lines.length)*fontSize*1.35+2)+'px';
  };
  // 편집 칸은 도면 글자 위에 겹쳐 그 글자를 대신 보여 준다. 편집 중 확대·축소·화면 이동이 있으면
  // 처음 자리·크기에 남아 다른 칸을 덮으므로, 화면을 그릴 때마다 글자의 지금 화면 위치·크기로 다시 맞춘다.
  // 503: 아주 작은 글자도 읽을 수 있게 편집 칸 글자는 14px 이상(배율 안내, 설정 inlineTextMinPx:0 이면 예전처럼 실제 크기), 반투명 배경은 설정 inlineTextBackground:true 일 때만(편집 칸 투명은 승인된 필수 품질 기준 INLINE_TEXT_COMPACT_TRANSPARENT).
  let editorSettings={};try{editorSettings=JSON.parse(localStorage.getItem('barun-cad-global')||'{}')||{};}catch{}
  if(editorSettings.inlineTextBackground===true)input.style.setProperty('background',inlineEditorBackground(getComputedStyle(canvas).backgroundColor),'important');
  const place=()=>{
   const p=screen(entity.position),fit=inlineEditorSize(entity.height*scale*1.15,Number.isFinite(editorSettings.inlineTextMinPx)?editorSettings.inlineTextMinPx:undefined),size=fit.fontSize,key=p.x+','+p.y+','+size;
   if(key===placed)return;placed=key;fontSize=size;input.title=fit.title;
   input.style.left=p.x+'px';input.style.top=(p.y-fontSize)+'px';input.style.fontSize=fontSize+'px';
   input.style.transformOrigin=`0 ${fontSize}px`;input.style.transform=`translateX(${entity.align==='center'?'-50%':entity.align==='right'?'-100%':'0'}) rotate(${-(entity.rotation||0)}deg) scaleX(${Math.max(.01,entity.widthFactor||1)})`;
   resizeEditor();
  };place();input.addEventListener('input',resizeEditor);
  canvas.parentElement.append(input);inlineTextInput=input;inlineTextEntityId=entity.id;placeInlineText=place;let done=false;
  const finish=save=>{if(done)return;done=true;const value=normalizeTypedText(input.value);input.remove();inlineTextInput=null;inlineTextEntityId=null;finishInlineText=null;placeInlineText=null;if(save&&value!==entity.text)safe(()=>execute({type:'update',ids:[entity.id],changes:{text:value}}));canvas.focus();render();};
  finishInlineText=finish;render();
  input.addEventListener('pointerdown',event=>event.stopPropagation());
  input.addEventListener('dblclick',event=>event.stopPropagation());
  input.addEventListener('keydown',event=>{event.stopPropagation();const action=inlineEditorKeyAction(event);if(action==='cancel'){event.preventDefault();finish(false);}else if(action==='commit'){event.preventDefault();finish(true);}});
  input.addEventListener('blur',()=>finish(true));input.focus();input.select();
}
canvas.addEventListener('dblclick',e=>{
  // 두 번째 클릭이 그립 위였으면 뜨거운 그립으로 들어가 있다 — 더블클릭이면 그립을 풀고 그 객체 편집으로(글자 제자리 편집 등).
  if(!busy&&mode==='GRIP'&&params?.gripId&&e.button===0){
    const hit=engine.doc.entities.find(x=>x.id===params.gripId);reset();
    if(hit){e.preventDefault();drag=null;setSelected([hit.id]);if(typeof doubleClickEdit==='function')doubleClickEdit(hit);else if(hit.type==='text')editTextInline(hit);else if(hit.type==='block'&&!(typeof blockEdit!=='undefined'&&blockEdit))safe(()=>startBlockEdit());else editProperties();}
    return;
  }
  if(busy||mode!=='SELECT'||selectDoubleClickEpoch!==interaction.value)return;
  if(e.shiftKey)return; // Rapid Shift-clicks cycle candidates; never open an editor.
  if(e.button===1){
    e.preventDefault();drag=null;fit();toast('도면 전체를 화면에 맞췄습니다.');return;
  }
  if(e.button!==0)return;
  const hit=overlapCandidates.find(entity=>entity.id===overlapCycle.ids[overlapCycle.index])||pick(world(localPoint(e)));
  if(!hit)return;
  e.preventDefault();drag=null;setSelected([hit.id]);
  if(typeof doubleClickEdit==='function'){doubleClickEdit(hit);return;}   // 321 종류별 편집 표
  if(hit.type==='text')editTextInline(hit);
  else if(hit.type==='block'&&!(typeof blockEdit!=='undefined'&&blockEdit))safe(()=>startBlockEdit());
  else editProperties();
});
canvas.addEventListener("pointerdown", (e) => {
  if(typeof flushCursorSnap==='function')flushCursorSnap();
  const started=performance.now(),previousState=inputState();
  let accepted=false,reason='';
  canvas.focus();
  const p = localPoint(e);
  const w=world(p),capture=()=>{lastCanvasPointerId=e.pointerId;try{canvas.setPointerCapture(e.pointerId);}catch{}};
  try{
    // 휠 두 번 누르기 = 전체 보기(오토캐드). 브라우저는 가운데 단추 dblclick 을 보내지 않아 직접 잰다. 명령 중에도 된다.
    if(e.button===1){
      const now=performance.now(),last=canvas._middleDown;canvas._middleDown={time:now,x:p.x,y:p.y};
      if(last&&now-last.time<400&&Math.hypot(p.x-last.x,p.y-last.y)<8&&typeof fit==='function'){canvas._middleDown=null;e.preventDefault();drag=null;fit();accepted=true;return;}
    }
    if (e.button === 1 || (e.button === 0 && mode==='PAN')) {
      beginPan(e,p);if(drag)Object.assign(drag,interaction.tag({pointerId:e.pointerId}));accepted=true;return;
    }
    if(e.button===2&&typeof assist!=='undefined')assist.rightDown={t:e.timeStamp};   // 320 오른쪽 단추 누른 시각
    if (busy){reason='busy';if(typeof queueBusyInput==='function'&&queueBusyInput(e,w))reason='queued';return;}   // 319
    if (e.button !== 0){reason='non-primary-button';return;}
    if(typeof assist!=='undefined'){if(e.pointerType)assist.lastPointerType=e.pointerType;if(phase==='select'){if(!assist.steps.active)assist.steps.start();assist.steps.begin();}}   // 324 선택 단계 기록
    if(mode==='SELECT'){
      const now=Number.isFinite(e.timeStamp)?e.timeStamp:performance.now();
      if(lastSelectDown?.epoch===interaction.value&&now-lastSelectDown.time<=500)selectDoubleClickEpoch=interaction.value;
      else selectDoubleClickEpoch=-1;
      lastSelectDown={epoch:interaction.value,time:now};
    }else{lastSelectDown=null;selectDoubleClickEpoch=-1;}
    if(mode==='PICKENTITY'){safe(()=>{const hit=pick(w,{exclude:params.types?engine.doc.entities.filter(e=>!params.types.includes(e.type)).map(e=>e.id):[]});if(!hit)throw Error(params.types?'대상이 되는 객체 위를 클릭하세요.':'객체 위를 클릭하세요.');settlePick(params.withPoint?{entity:hit,point:{...w}}:hit);});accepted=!safe.lastError;reason=safe.lastError?'error: '+safe.lastError.message:'';return;}
    if(mode==='WALL'&&phase==='wall-center-pick'){safe(()=>pickWallCenterline(w));accepted=!safe.lastError;reason=safe.lastError?'error: '+safe.lastError.message:'';return;}
    if(mode==='SELECT'){for(const entity of chosen()){if(!entity.clip?.enabled)continue;const index=entity.clip.points.findIndex(q=>G.dist(screen(q),p)<=9);if(index>=0){drag=interaction.tag({kind:'clip-grip',pointerId:e.pointerId,id:entity.id,index,points:structuredClone(entity.clip.points)});capture();accepted=true;return;}}}
    if(drag&&!interaction.accepts(drag)){drag=null;}
    if (drag?.kind === "selection" && drag.awaitingCorner) {
      drag.current = p;drag.secondCorner = true;drag.pointerId=e.pointerId;capture();accepted=true;return;
    }
    // 310: 대기 중 Shift+그립 클릭 = 그 정점을 뜨거운 묶음에 넣고 빼기(AutoCAD 여러 뜨거운 그립).
    if(mode==='SELECT'&&phase==='idle'&&e.shiftKey&&typeof gripHitAt==='function'){const gh=gripHitAt(p,w,e);if(gh&&(assist.hotGrips.sync(selectionRevision),assist.hotGrips.toggle(gh.entity.id,gh.grip))){drag=interaction.tag({kind:'selection-click',pointerId:e.pointerId});capture();render();accepted=true;return;}}
    // 305: 겹친 객체 목록은 설정이 2(기본)일 때만. Shift+Space 로 돌려 고정한 호버 후보가 있으면 그것을 집는다.
    const pinnedHover=typeof assist!=='undefined'&&!e.shiftKey?assist.hover.pinnedId(p):null;
    const overlapHit=(mode==='SELECT'||phase==='select')?(pinnedHover!=null?entityMap().get(pinnedHover)||null:(typeof assist==='undefined'||IA.selectionCyclingMode(assist.prefs.selectionCycling)===2)?handleOverlapSelection(w,p,e):null):null;
    if(pinnedHover!=null)assist.hover.clear();
    if(overlapHit&&e.shiftKey){
      selectOverlapCandidate(overlapHit.id);
      drag=interaction.tag({kind:'selection-click',pointerId:e.pointerId});capture();accepted=true;return;
    }
    // Selection commands commit a direct hit on pointerdown.  Enter/Space may
    // therefore follow immediately without racing the matching pointerup.
    if(phase==='select'&&params.selectPoly){params.selectPoly.points.push({...w});drag=interaction.tag({kind:'selection-click',pointerId:e.pointerId});capture();render();accepted=true;return;}
    if(phase==='select'){
      const hit=overlapHit||pick(w,{locked:true});
      // 현장에서 와 겹쳐만 보이는 빨간 표시(도면 객체 아님)도 지우기로 찍으면 지운다.
      if(!hit&&mode==='ERASE'&&padOverlay.length){const mark=pickDisplayEntity(padOverlay,w,Math.max(4,Math.min(30,num('pickbox-size',10)))/2/scale);const what=mark&&padShare.discard(mark.id);if(what){log('현장 표시를 지웠습니다: '+what);drag=interaction.tag({kind:'selection-click',pointerId:e.pointerId});capture();render();accepted=true;return;}}
      // 속성 일치: 대상 클릭은 고르지 않고 바로 적용(오토캐드). 선택창으로 고른 것은 Enter 에 적용.
      // BREAK: 객체를 찍은 점이 첫 번째 끊기점(오토캐드). 바로 두 번째 점을 묻는다. F 로 첫 점을 다시 찍을 수 있다.
      if(hit&&mode==='BREAK'&&!e.shiftKey){setSelected([hit.id]);phase='point';points=[{x:w.x,y:w.y}];drag=interaction.tag({kind:'selection-click',pointerId:e.pointerId});capture();updatePrompt();render();accepted=true;return;}
      if(hit&&mode==='MATCHPROP'&&params.source&&!e.shiftKey){safe(()=>applyMatchProperties([hit]));drag=interaction.tag({kind:'selection-click',pointerId:e.pointerId});capture();render();accepted=!safe.lastError;return;}
      if(hit&&!['FILLET','CHAMFER'].includes(mode)){
        drag=interaction.tag({kind:"selection",pointerId:e.pointerId,start:p,startWorld:w,current:p,shift:e.shiftKey||params.removeSelection,threshold:pointerDragThreshold(e),pendingHit:hit.id});
        capture();render();accepted=true;return;
      }
      if(hit){
        // FILLET·CHAMFER: Shift+클릭은 빼기가 아니라 "반지름/거리 0 으로 잇기"(오토캐드). 이미 고른 선을 Shift 로 누르면 빼기.
        const filletZero=['FILLET','CHAMFER'].includes(mode)&&e.shiftKey&&!selected.has(hit.id);
        // 폴리선: P 옵션이면 모든 꼭짓점, 아니면 같은 폴리선의 이웃한 두 구간을 차례로 찍은 꼭짓점 하나.
        if(['FILLET','CHAMFER'].includes(mode)&&['polyline','rectangle'].includes(hit.type)&&!e.shiftKey){
          safe(()=>{
            if(params.cornerPoly){runCorner({polylineId:hit.id});return;}
            const first=params.polyFirst;
            if(first?.id===hit.id){const vertex=sharedPolylineVertex(hit,first.point,w);params.polyFirst=null;if(vertex==null)throw Error('같은 폴리선의 이웃한 두 구간을 찍으세요.');runCorner({polylineId:hit.id,vertices:[vertex]},filletZero||first.zero);return;}
            // 다른 객체(선·호·다른 폴리선)를 먼저 골랐으면 두 객체 모깎기 — 폴리선끼리는 하나로 이어진다(ACAD200-403, curve-edit.js cornerAny).
            const other=first?first.id:(selected.size===1&&!selected.has(hit.id)?[...selected][0]:null);
            if(other){const picks={...(params.cornerPicks||{}),[hit.id]:{...w}};if(first)picks[first.id]=first.point;params.polyFirst=null;runCorner({ids:[other,hit.id],pickPoints:picks},filletZero||!!first?.zero);return;}
            params.polyFirst={id:hit.id,point:{...w},zero:filletZero};setSelected([hit.id]);updatePrompt();
          });
          drag=interaction.tag({kind:'selection-click',pointerId:e.pointerId});capture();render();accepted=!safe.lastError;reason=safe.lastError?'error: '+safe.lastError.message:'';return;
        }
        const remove=(e.shiftKey&&!filletZero)||params.removeSelection;
        if(remove)selected.delete(hit.id);else selected.add(hit.id);
        if(['FILLET','CHAMFER'].includes(mode)){params.cornerPicks??={};if(remove)delete params.cornerPicks[hit.id];else params.cornerPicks[hit.id]={...w};}
        if(selected.size)previousSelection=[...selected];
        // FILLET's default workflow is two clicks: the first and second
        // individual lines are the corner inputs.  A zero radius trims both
        // lines to their intersection immediately, matching the CAD F flow.
        // Keep the normal selection/Enter workflow available through R.
        if(['FILLET','CHAMFER'].includes(mode)&&!remove&&selected.size===2){
          const lines=chosen();
          if(params.polyFirst)params.cornerPicks[params.polyFirst.id]=params.polyFirst.point;
          if(lines.length===2&&lines.every(entity=>['line','arc','circle','polyline'].includes(entity.type))){
            safe(()=>runCorner({ids:lines.map(entity=>entity.id),pickPoints:params.cornerPicks},filletZero));
            if(safe.lastError){selected.delete(hit.id);delete params.cornerPicks[hit.id];render();}
            accepted=!safe.lastError;reason=safe.lastError?'error: '+safe.lastError.message:'';
            return;
          }
        }
        drag=interaction.tag({kind:'selection-click',pointerId:e.pointerId});capture();render();accepted=true;return;
      }
    }
    // Ctrl+클릭: 기존 선택을 지우지 않고 한 개씩 더한다(이미 골라진 것은 뺀다). 몇 개인지 바로 보인다.
    if(mode==='SELECT'&&(e.ctrlKey||e.metaKey)&&!e.shiftKey&&!e.altKey){
      const hit=overlapHit||pick(w);
      if(hit){
        if(selected.has(hit.id))selected.delete(hit.id);else{selected.add(hit.id);syncCurrentLayerChooser(hit.layer);}
        if(selected.size)previousSelection=[...selected];
        if(typeof showSelectionCount==='function')showSelectionCount();
        drag=interaction.tag({kind:'selection-click',pointerId:e.pointerId});capture();render();accepted=true;return;
      }
    }
    // 진행 중인 선택창이 우선이므로 그립·객체 끌기 판정은 그 뒤에 둔다.
    if(mode==='SELECT'&&!e.shiftKey){
      // 307·308: 그립은 색인에서 커서 둘레만 찾는다(고른 객체가 한도를 넘으면 그립 없음).
      if(typeof gripHitAt==='function'){const gh=gripHitAt(p,w,e);if(gh){drag=interaction.tag({kind:'entity-grip',pointerId:e.pointerId,id:gh.entity.id,grip:gh.grip,start:p,threshold:pointerDragThreshold(e)});capture();accepted=true;return;}}
      else for(const entity of chosen()){
        if(layerMap().get(entity.layer)?.locked)continue;   // 성능: 레이어 선형 탐색 대신 Map 조회
        const grips=typeof selectedWallGrips==='function'?selectedWallGrips(engine.doc,entity):null;
        const grip=(grips || G.editingGrips(entity)).find(g=>G.dist(screen(g.point),p)<=9);
        if(grip){drag=interaction.tag({kind:'entity-grip',pointerId:e.pointerId,id:entity.id,grip,start:p,threshold:pointerDragThreshold(e)});capture();accepted=true;return;}
      }
      const hit=overlapHit||pick(w);
      if(hit&&!hit.lineWallHost){
        // 오토캐드처럼: 이미 고른 객체를 끌면 이동, 아직 안 고른 객체는 끌어도 움직이지 않는다.
        // 놓은 자리에서 떼면 선택에 더하고(PICKADD), 움직이면 그 점에서 시작하는 선택창이 된다.
        if(!selected.has(hit.id)){
          syncCurrentLayerChooser(hit.layer);
          drag=interaction.tag({kind:"selection",pointerId:e.pointerId,start:p,startWorld:w,current:p,shift:false,threshold:pointerDragThreshold(e),pendingHit:hit.id});
          capture();render();accepted=true;return;
        }
        drag=interaction.tag({kind:'object-move',pointerId:e.pointerId,id:hit.id,ids:[...selected],base:w,start:p,threshold:pointerDragThreshold(e)});
        capture();accepted=true;return;
      }
    }
    if (mode === "SELECT" || phase === "select" || phase === "window" || phase==='zoom-window') {
      drag=interaction.tag({kind:"selection",pointerId:e.pointerId,start:p,startWorld:w,current:p,shift:e.shiftKey||params.removeSelection,threshold:pointerDragThreshold(e),pressedAt:e.timeStamp});
      capture();accepted=true;
    } else if(['TRIM','EXTEND'].includes(mode)&&phase==='pick'&&!params.trimErase&&!params.fencePoints&&!pick(w,{locked:true})){
      drag=interaction.tag({kind:'trim-fence',pointerId:e.pointerId,start:p,startWorld:w,currentWorld:w});capture();accepted=true;
    } else {safe(() => accept(mode==='HATCH'&&phase!=='hatch-origin'||objectPickCursor()?w:snap(w,typeof currentSnapOptions==='function'?currentSnapOptions():undefined)));accepted=!safe.lastError;reason=safe.lastError?'error: '+safe.lastError.message:'';}
  }finally{
    if(typeof attachPress==='function')attachPress(e,p);   // 301
    traceInput('pointerdown',{eventTimestamp:e.timeStamp,previousState,nextState:inputState(),screen:p,world:w,accepted,reason:reason||(accepted?'':'not-accepted'),processingMs:performance.now()-started});
  }
});
canvas.addEventListener("pointermove", (e) => {
  const p = localPoint(e);
  rawCursor=world(p);
  // REVCLOUD 프리핸드(F): 커서가 호 길이만큼 움직일 때마다 점 하나(O(1)), 첫 점 가까이 오면 닫는다.
  if(mode==='REVCLOUD'&&params.cloudFreehand&&points.length){const step=S4.freehandStep(points,rawCursor,cloudArc());if(step.points!==points){points=step.points;if(step.closed){safe(()=>{addEntities([cloudPoints(points)]);reset();});}else updatePrompt();}}
  if(drag?.kind==='entity-grip'||drag?.kind==='object-move'){
   if(!(e.buttons&1)){drag=null;render();return;}
   if(drag.press?drag.press.update(e.timeStamp,p):G.dist(p,drag.start)>=(drag.threshold??DRAG_THRESHOLD_MOUSE))schedulePreviewDrag(world(p));   // 301
   else if(drag.command||drag.error){drag.command=null;drag.preview=[];drag.error=null;drag.pendingPoint=null;render();}
   return;}
  if(drag?.kind==='clip-grip'){drag.points[drag.index]=world(p);render();return;}
  if(drag?.kind==='trim-fence'){drag.currentWorld=world(p);render();return;}
  // Chorded mouse buttons need not produce another pointerdown event.
  if((e.buttons&4)&&drag?.kind!=='pan')beginPan(e,p);
  if (drag?.kind === "pan") {
    if(typeof e.buttons==='number'&&!(e.buttons&(drag.button===1?4:1))){drag=drag.suspended||null;render();return;}
    origin = {
      x: drag.origin.x + p.x - drag.start.x,
      y: drag.origin.y + p.y - drag.start.y,
    };
    drag.last=p;
    render();
    return;
  }
  if (drag?.kind === "selection") {
    drag.current = p;
    cursor = world(p);
    if(typeof assistLassoMove==='function')assistLassoMove(e,p);   // 302
    render();
    return;
  }
  cursor = {...rawCursor};if(typeof flushCursorSnap==='function')pendingCursorSnap=true;else cursor=objectPickCursor()?world(p):snap(world(p));
  if(typeof assistPointerMove==='function')assistPointerMove(e,p);   // 303·309
  render();
});
canvas.addEventListener("pointerup", (e) => {
  const started=performance.now(),previousState=inputState(),screenPoint=localPoint(e),worldPoint=world(screenPoint);
  let accepted=true,reason='';
  safe.lastError=null;
  try{
  if(drag&&(!interaction.accepts(drag)||(drag.pointerId!==undefined&&drag.pointerId!==e.pointerId))){
    accepted=false;reason=!interaction.accepts(drag)?'stale-interaction':'different-pointer';drag=null;return;
  }
  if(drag?.kind==='selection-click'){
    drag=null;if(canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId);
    scheduleEngineUiRefresh();return;
  }
  if(drag?.kind==='trim-fence'){
    const fence=drag;drag=null;if(canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId);
    if(G.dist(localPoint(e),fence.start)<DRAG_THRESHOLD_MOUSE){render();return;}
    safe(()=>fenceTrim(fence.startWorld,worldPoint,trimOperation()));updatePrompt();render();return;
  }
  if(drag?.kind==='entity-grip'||drag?.kind==='object-move'){
    const pending=drag;
    if(pending.previewFrame)cancelAnimationFrame(pending.previewFrame);
    if(pending.press?!pending.press.isClick(e.timeStamp,localPoint(e)):G.dist(localPoint(e),pending.start)>=(pending.threshold??DRAG_THRESHOLD_MOUSE))previewDrag(snap(world(localPoint(e)),typeof dragSnapOptions==='function'?dragSnapOptions(pending):undefined));   // 301·312
    else{pending.command=null;pending.preview=[];pending.error=null;}
    drag=null;if(pending.command?.type==='ai-wall-grip')applyWallGrip(pending.command.grip,pending.command.point);else if(pending.command){safe(()=>execute(pending.command));if(pending.hotUsed&&typeof assist!=='undefined')assist.hotGrips.clear();}else if(pending.error)toast(pending.error,true);
    else if(pending.kind==='entity-grip'&&typeof reset==='function'){reset();mode='GRIP';phase='point';params={gripId:pending.id,grip:pending.grip,op:'stretch'};points=[{...pending.grip.point}];updatePrompt();render();}
     if(canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId);scheduleEngineUiRefresh();return;
  }
  if(drag?.kind==='clip-grip'){const pending=drag;drag=null;safe(()=>execute({type:'xclip',ids:[pending.id],points:pending.points}));if(canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId);render();return;}
  if(drag?.kind==='pan'){
    const suspended=drag.suspended;drag=suspended||null;
    if(canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId);
    render();return;
  }
  if (drag?.kind === "selection" && drag.lasso && typeof finishLasso==='function') {   // 302 올가미
    const lasso=drag.lasso,remove=drag.shift;drag=null;
    if(canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId);
    safe(()=>finishLasso(lasso,remove));scheduleEngineUiRefresh();return;
  }
  if (drag?.kind === "selection") {
    const a = drag.startWorld?screen(drag.startWorld):drag.start,
      b = localPoint(e),
      // A released corner click needs its own jitter tolerance. The .5px
      // object-move threshold otherwise commits a tiny box on the first click.
      threshold=Math.max(4,drag.threshold??.5),
      // 빠르게 "탁" 친 클릭은 누르는 사이 손이 몇 px 밀려도 클릭이다(0.22초 안에 떼고 24px 안).
      // 이걸 끌기로 보면 떼는 순간 선택창이 닫혀 "명령 직후 바로 친 선택창이 안 따라온다".
      quickTap=Number.isFinite(drag.pressedAt)&&Number.isFinite(e.timeStamp)&&e.timeStamp-drag.pressedAt<220&&G.dist(a,b)<24,
      multiple = drag.shift,
      // 대기 상태에서도 클릭·선택창은 선택에 더한다(오토캐드 PICKADD). Shift 는 빼기, Esc 는 모두 풀기.
      accumulating = phase === "select" || phase === "window" || mode === "SELECT";
    if(phase==='zoom-window'){
      if(G.dist(a,b)<4&&!drag.secondCorner){drag.awaitingCorner=true;drag.current=b;render();return;}
      const p=world(a),q=world(b);fitBox({minX:Math.min(p.x,q.x),maxX:Math.max(p.x,q.x),minY:Math.min(p.y,q.y),maxY:Math.max(p.y,q.y)});endView();return;
    }
    // Empty-space click starts a persistent two-corner selection window.
    // Holding and dragging remains supported by the same selection path.
    // 301: 판정기가 있으면 시간+거리로 클릭인지 본다(두 번째 모서리 클릭은 예전대로).
    const pressClick=drag.press&&!drag.secondCorner?drag.press.isClick(e.timeStamp,b):null;
    if (!drag.secondCorner && (pressClick??(G.dist(a,b) < threshold || quickTap)) && (phase === "window" || !drag.pendingHit&&!pick(world(b), {locked:true}))) {
      drag.awaitingCorner = true;
      drag.current = b;
      render();
      return;
    }
    if (!multiple && !accumulating) selected.clear();
    if (pressClick??(G.dist(a, b) < threshold)) {
      // The object pressed (the overlap cycle's choice included) is the one released in place.
      const hit = drag.pendingHit?{id:drag.pendingHit}:pick(world(b), { locked: true });
      if (hit) {
        if (multiple && accumulating) selected.delete(hit.id);
        else if (multiple && selected.has(hit.id)) selected.delete(hit.id);
        else selected.add(hit.id);
      }
    } else {
      const p = world(a),
        q = world(b),
        box = {
          minX: Math.min(p.x, q.x),
          minY: Math.min(p.y, q.y),
          maxX: Math.max(p.x, q.x),
          maxY: Math.max(p.y, q.y),
        },
        forced = typeof params!=='undefined'?params?.forceWindow:null,
        cross = forced ? forced==='C' : b.x < a.x;
      if(forced)delete params.forceWindow;
      if(drag.pendingHit&&typeof clearOverlapSelection==='function')clearOverlapSelection();
      // 304: 끄는 동안 다 계산해 둔 같은 상자의 결과가 있으면 그대로 쓴다(두 번 계산하지 않음).
      const ready=typeof windowPreviewResult==='function'&&phase!=='window'?windowPreviewResult(box,cross):null;
      if(ready){if(multiple&&accumulating){for(const id of ready)selected.delete(id);}else if(selected.addMany)selected.addMany(ready);else for(const id of ready)selected.add(id);}
      // 공간 후보를 추린 뒤 실제 선택창과의 포함·교차 여부를 검사한다.
      else for (const ent of typeof boxCandidates==='function'?boxCandidates(box):editable()) {
        const eb = G.bounds([ent]);
        if (
          eb &&
          (cross
            ? crossing(ent, box)
            : eb.minX >= box.minX &&
              eb.maxX <= box.maxX &&
              eb.minY >= box.minY &&
              eb.maxY <= box.maxY)
        )
          if (multiple && accumulating) selected.delete(ent.id);
          else selected.add(ent.id);
      }
    }
    if (phase === "window") {
      const p = world(a),
        q = world(b),
        inside = (v) =>
          v.x >= Math.min(p.x, q.x) &&
          v.x <= Math.max(p.x, q.x) &&
          v.y >= Math.min(p.y, q.y) &&
          v.y <= Math.max(p.y, q.y);
      const stretchBox={minX:Math.min(p.x,q.x),minY:Math.min(p.y,q.y),maxX:Math.max(p.x,q.x),maxY:Math.max(p.y,q.y)};
      const incoming = (typeof boxCandidates==='function'?boxCandidates(stretchBox):editable()).flatMap((e) => {
        const target = {
          id: e.id,
          indices: (e.points || [])
            .map((v, i) => (inside(v) ? i : -1))
            .filter((i) => i >= 0),
          center: e.center && inside(e.center),
          position: e.position && inside(e.position),
          // 호: 중심이 창 밖이고 끝점만 들어오면 그 끝만 늘린다(현 높이 유지, geometry.js stretchArcEnd).
          arcEnds: e.type==='arc'&&!inside(e.center)?['start','end'].filter(k=>inside(G.add(e.center,G.polar(e.radius,k==='start'?e.startAngle:e.endAngle)))):[],
        };
        return target.indices.length || target.center || target.position || target.arcEnds.length
          ? [target]
          : [];
      });
      const targets=new Map((params.targets||[]).map(t=>[t.id,t]));
      for(const t of incoming){
        const prior=targets.get(t.id);
        if(multiple){
          if(!prior)continue;
          prior.indices=prior.indices.filter(i=>!t.indices.includes(i));
          prior.center=prior.center&&!t.center;prior.position=prior.position&&!t.position;prior.arcEnds=(prior.arcEnds||[]).filter(k=>!t.arcEnds.includes(k));
          if(!prior.indices.length&&!prior.center&&!prior.position&&!prior.arcEnds.length)targets.delete(t.id);
        }else targets.set(t.id,{...t,indices:[...new Set([...(prior?.indices||[]),...t.indices])],center:!!(prior?.center||t.center),position:!!(prior?.position||t.position),arcEnds:[...new Set([...(prior?.arcEnds||[]),...t.arcEnds])]});
      }
      params.targets=[...targets.values()];selected.clear();for(const id of targets.keys())selected.add(id);
      if(!incoming.length&&!multiple)toast('창 안에 이동할 끝점이 없습니다. 블록 내부는 EXPLODE 후 선택하세요.',true);
    }
    drag = null;
    if(selected.size)previousSelection=[...selected];
    scheduleEngineUiRefresh();
  } else drag = null;
  }finally{
    if(typeof assist!=='undefined')assist.windowPreview.reset();
    if(typeof afterSelectionGesture==='function')afterSelectionGesture();   // 324 SI
    if(safe.lastError){accepted=false;reason='error: '+safe.lastError.message;}
    traceInput('pointerup',{eventTimestamp:e.timeStamp,previousState,nextState:inputState(),screen:screenPoint,world:worldPoint,accepted,reason,processingMs:performance.now()-started});
  }
});
canvas.addEventListener("pointercancel", () => {
  cancelPointerInteraction('pointercancel');
  render();
});
canvas.addEventListener('lostpointercapture',()=>{if(drag?.kind==='pan'){drag=drag.suspended?interaction.tag(drag.suspended):null;render();}else if(drag&&!interaction.accepts(drag))drag=null;});
canvas.addEventListener("pointerleave", () => {
  if (!drag) {
    cursor = null;rawCursor=null;
    render();
  }
});
/* 도면 우클릭 메뉴. 항목 하나 = {label, key?, run} 또는 '-'(구분선). Esc·바깥 클릭·스크롤이면 닫는다. */
let canvasMenu=null;
function closeCanvasMenu(){if(!canvasMenu)return;canvasMenu.remove();canvasMenu=null;canvas.focus();}
function showCanvasMenu(x,y,items){
 closeCanvasMenu();
 const menu=document.createElement('div');menu.className='canvas-menu';menu.setAttribute('role','menu');
 for(const item of items){
  if(item==='-'){menu.append(document.createElement('hr'));continue;}
  const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitem');b.textContent=item.label;
  if(item.key){const k=document.createElement('kbd');k.textContent=item.key;b.append(k);}
  b.onclick=()=>{closeCanvasMenu();safe(item.run);};menu.append(b);
 }
 document.body.append(menu);
 const r=menu.getBoundingClientRect();menu.style.left=Math.max(4,Math.min(x,innerWidth-r.width-4))+'px';menu.style.top=Math.max(4,Math.min(y,innerHeight-r.height-4))+'px';
 canvasMenu=menu;menu.querySelector('button')?.focus();
}
if(typeof document!=='undefined'){
 document.addEventListener('pointerdown',e=>{if(canvasMenu&&!canvasMenu.contains(e.target))closeCanvasMenu();},true);
 document.addEventListener('keydown',e=>{if(canvasMenu&&e.key==='Escape'){e.preventDefault();e.stopPropagation();closeCanvasMenu();}},true);
}
const typedOption=keyword=>()=>{$('coordinate').value=keyword;submit();};
const runFromMenu=name=>()=>run(name);
function snapMenuItems(){
 return [{label:'두 점 중간',key:'M2P',run:typedOption('M2P')},{label:'기준점에서(FROM)',key:'FRO',run:typedOption('FRO')},'-',
  ...[['끝점','END'],['중간점','MID'],['교차점','INT'],['중심','CEN'],['사분점','QUA'],['접점','TAN'],['수직','PER'],['노드','NOD'],['삽입점','INS'],['근처점','NEA']].map(([label,key])=>({label,key,run:typedOption(key)}))];
}
function idleMenuItems(){
 const label=name=>COMMANDS.find(c=>c.name===name)?.label||name,items=[];
 if(lastCommand)items.push({label:`반복: ${label(lastCommand)}`,key:'Enter',run:runFromMenu(lastCommand)});
 const recent=[...new Set((run.recent||[]).slice().reverse())].filter(n=>n!==lastCommand).slice(0,4);
 for(const name of recent)items.push({label:`최근: ${label(name)}`,run:runFromMenu(name)});
 if(items.length)items.push('-');
 if(selected.size){
  for(const [name,key] of [['MOVE','M'],['COPY','CO'],['ROTATE','RO'],['SCALE','SC'],['MIRROR','MI'],['ERASE','Del']])items.push({label:label(name),key,run:runFromMenu(name)});
  items.push('-',{label:'잘라내기',key:'Ctrl+X',run:runFromMenu('CUTCLIP')},{label:'복사(클립보드)',key:'Ctrl+C',run:runFromMenu('COPYCLIP')},{label:'속성',key:'Ctrl+1',run:runFromMenu('PROPERTIES')},{label:'선택 해제',key:'Esc',run:()=>{setSelected([]);render();}});
 }else{
  items.push({label:'붙여넣기',key:'Ctrl+V',run:runFromMenu('PASTECLIP')},{label:'실행 취소',key:'Ctrl+Z',run:runFromMenu('UNDO')},{label:'다시 실행',key:'Ctrl+Y',run:runFromMenu('REDO')},'-',{label:'전체 보기',key:'Z E',run:()=>fit()},{label:'빠른 선택',run:runFromMenu('QSELECT')});
 }
 return items;
}
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  // Shift+우클릭: 오토캐드 임시 스냅 메뉴(점을 묻는 중에만).
  if(e.shiftKey&&mode!=='SELECT'&&!['select','window','text','name','number'].includes(phase)){showCanvasMenu(e.clientX,e.clientY,snapMenuItems());return;}
  const rightDown=typeof assist!=='undefined'?assist.rightDown:null;if(rightDown)assist.rightDown=null;
  // 309: 그립 위 오른쪽 클릭 = 그 그립의 메뉴(신축·정점 추가·정점 삭제).
  if(mode==='SELECT'&&phase==='idle'&&typeof assist!=='undefined'&&assist.hoverGrip){const items=gripMenuItems(assist.hoverGrip);if(items.length){showCanvasMenu(e.clientX,e.clientY,items);return;}}
  // 명령 없이 우클릭: 바로가기 메뉴(반복·최근·편집). 메뉴만 열고 아무것도 저절로 실행하지 않는다.
  if(mode==='SELECT'&&phase==='idle'){showCanvasMenu(e.clientX,e.clientY,idleMenuItems());return;}
  // 320: 명령 중 오른쪽 단추를 길게 누르면 지금 프롬프트의 옵션 메뉴, 짧게는 Enter(설정 0 이면 늘 Enter).
  if(rightDown&&IA.classifyRightClick(e.timeStamp-rightDown.t,assist.prefs.shortcutMenuMs)==='menu'){showCanvasMenu(e.clientX,e.clientY,commandOptionMenuItems());return;}
  // 작도 중에는 AutoCAD 의 Enter 처럼 현재 단계를 마친다.
  safe(() => finish());
});
function zoom(factor, p = { x: width / 2, y: height / 2 }) {
  if(typeof aiReveal!=='undefined'&&aiReveal)aiReveal.player.stopCamera();
  rememberView();
  const w = world(p);
  scale = Math.max(1e-8, Math.min(500, scale * factor));
  origin = { x: p.x - w.x * scale, y: p.y + w.y * scale };
  if(drag?.kind==='pan'){drag.start=drag.last;drag.origin={...origin};}
  viewMoving=true;clearTimeout(viewMovingTimer);viewMovingTimer=setTimeout(()=>{viewMoving=false;render();},180);
  render();
}
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    zoom(Math.exp(-e.deltaY * 0.0012), localPoint(e));
  },
  { passive: false },
);
function fit({all=false}={}) {
  // 숨은·최소화된 칸은 캔버스 크기가 0 이라 맞추면 도면이 점이 되고, 펼치는 도중 크기로 맞추면 일부만 보인다 — 크기가 자리 잡은 뒤 맞춘다(2026-11-02).
  if(!width||!height){needsInitialFit=true;hiddenFitPending=true;return;}
  rememberView();
  // 구성선·광선(XLINE·RAY)은 범위 계산에서 뺀다(오토캐드와 같게 · 아주 긴 선이라 전체 보기가 망가진다).
  const shown=visible(),list=shown.some(e=>e.construction)?shown.filter(e=>!e.construction):shown,h=fitHeight();
  // 멀리 떨어진 부스러기 몇 개 때문에 본 도면이 점이 되지 않게 본 도면만 맞추고, 뺀 것은 알림으로 알린다(extent-core.js).
  const extent=all?{core:G.bounds(list),farCount:0}:coreExtents(list,G.vertices),b=extent.core;
  if(extent.farCount)farObjectsNotice(extent.far);
  if (b) {
    scale = Math.max(
      1e-8,
      Math.min(
        500,
        Math.min(
          Math.max(20, width - 90) / Math.max(1, b.maxX - b.minX),
          Math.max(20, h - 90) / Math.max(1, b.maxY - b.minY),
        ),
      ),
    );
    origin = {
      x: width / 2 - ((b.minX + b.maxX) / 2) * scale,
      y: h / 2 + ((b.minY + b.maxY) / 2) * scale,
    };
  } else {
    scale = 0.1;
    origin = { x: width / 2, y: height / 2 };
  }
  render();
}
// 전체 보기에서 뺀 '멀리 떨어진 객체' 알림: 골라 보기(지울지 판단) · 모두 보기(빼지 않고 맞춤).
function farObjectsNotice(far){
  const box=$("toast"),text=document.createElement('span'),actions=document.createElement('span');
  text.textContent=`본 도면에서 멀리 떨어진 객체 ${far.length}개는 화면 맞춤에서 뺐습니다.`;
  actions.className='toast-actions';
  const button=(label,run)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>{box.style.display='none';run();};return b;};
  actions.append(button('골라 보기',()=>{setSelected(far.map(e=>e.id).filter(Boolean));render();toast(`멀리 떨어진 객체 ${far.length}개를 골랐습니다. 필요 없으면 지우세요.`);}),button('모두 보기',()=>fit({all:true})));
  log(text.textContent);box.replaceChildren(text,actions);box.style.display='block';
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>(box.style.display='none'),9000);
}
// ACAD200 114·121: 곡선 매끄러움(VIEWRES, 기본 1000)과 투명도 표시(TRANSPARENCYDISPLAY). 도면에 저장되고 되돌리기된다.
function viewresDialog(){
 const doc=engine.doc;
 form('화면 품질 · VIEWRES',[
  {name:'viewres',label:'곡선 매끄러움(1~20000, 기본 1000 · 클수록 매끄럽고 느림)',type:'number',value:doc.viewres??1000},
  {name:'transparency',label:'객체 투명도 표시',value:doc.transparencyDisplay===false?'no':'yes',options:[['yes','표시'],['no','끔 · 모두 불투명']]},
 ],values=>{
  const viewres=Number(values.viewres);
  if(!Number.isFinite(viewres)||viewres<1||viewres>20000)throw Error('곡선 매끄러움은 1~20000 사이 숫자여야 합니다.');
  execute({type:'document.update',changes:{viewres:Math.round(viewres),transparencyDisplay:values.transparency!=='no'}});render();
 });
}
function limitsDialog(){
 const current=engine.doc.limits||{enabled:false,minX:0,minY:0,maxX:42000,maxY:29700};
 form('작업 영역 · LIMITS',[
  {name:'enabled',label:'작업 영역 표시',value:current.enabled?'yes':'no',options:[['yes','표시'],['no','숨김']]},
  ...[['minX','왼쪽 X'],['minY','아래 Y'],['maxX','오른쪽 X'],['maxY','위 Y']].map(([name,label])=>({name,label,type:'number',value:current[name]})),
  {name:'fit',label:'적용 후 영역 맞춤',value:'yes',options:[['yes','화면에 맞춤'],['no','현재 화면 유지']]}
 ],values=>{
  const next={enabled:values.enabled==='yes',minX:Number(values.minX),minY:Number(values.minY),maxX:Number(values.maxX),maxY:Number(values.maxY)};
  if(!Object.values(next).slice(1).every(Number.isFinite)||next.maxX<=next.minX||next.maxY<=next.minY)throw Error('작업 영역의 왼쪽·아래 값보다 오른쪽·위 값이 커야 합니다.');
  execute({type:'document.update',changes:{limits:next}});
  if(values.fit==='yes')fitBox(next);else render();
 });
}
function dimStyleDialog(){
 const normalized=normalizeDimStyles(engine.doc),names=Object.keys(normalized.dimStyles),current=normalized.currentDimStyle,style=normalized.dimStyles[current];
 form('치수 스타일 관리자 · DIMSTYLE',[
  {name:'action',label:'작업',value:'update',options:[['update','선택 스타일 수정'],['create','새 스타일 만들기'],['current','현재 스타일로 지정'],['apply','선택 치수에 적용'],['delete','선택 스타일 삭제']]},
  {name:'styleName',label:'대상 스타일',value:current,options:names.map(name=>[name,name+(name===current?' · 현재':'')])},
  {name:'newName',label:'새 스타일 이름',value:'ARCH'},
  {name:'preset',label:'용도 프리셋 (고르면 아래 값을 축척에 맞춰 채움)',value:'',options:[['','직접 입력'],...Object.entries(DIM_PRESETS).map(([key,p])=>[key,p.label])]},
  {name:'presetScale',label:'프리셋 축척 1:',type:'number',value:(()=>{try{return Number(JSON.parse(localStorage.getItem('barun-cad-global')||'{}').denominator)||100;}catch{return 100;}})()},
  {name:'textHeight',label:'문자 높이 (mm)',type:'number',value:style.textHeight},
  {name:'precision',label:'소수 자릿수',type:'number',value:style.precision},
  {name:'arrowType',label:'치수 끝 모양',value:style.arrowType||'closed-filled',options:[['closed-filled','채운 화살표'],['closed','빈 화살표'],['open','열린 화살표'],['tick','건축용 사선(틱)'],['dot','점']]},
  {name:'arrowSize',label:'화살표 크기 (mm)',type:'number',value:style.arrowSize},
  {name:'extensionOffset',label:'보조선 시작 간격 (mm)',type:'number',value:style.extensionOffset},
  {name:'extensionOvershoot',label:'보조선 돌출 길이 (mm)',type:'number',value:style.extensionOvershoot},
  {name:'textGap',label:'문자 여백 (mm)',type:'number',value:style.textGap},
  {name:'scale',label:'전체 치수 축척',type:'number',value:style.scale}
 ],values=>{
  const valuesOf=()=>{const v={};for(const key of ['textHeight','precision','arrowSize','extensionOffset','extensionOvershoot','textGap','scale'])v[key]=Number(values[key]);v.arrowType=values.arrowType||'closed-filled';if(!Number.isInteger(v.precision)||v.precision<0||v.precision>8)throw Error('소수 자릿수는 0~8 정수입니다.');if(['textHeight','arrowSize','scale'].some(k=>!(v[k]>0))||['extensionOffset','extensionOvershoot','textGap'].some(k=>v[k]<0))throw Error('치수 스타일 값을 확인하세요.');return v;};
  let next={...engine.doc,...normalized};
  if(values.action==='create'){next=createDimStyle(next,values.newName,valuesOf());next=setCurrentDimStyle(next,values.newName.trim());}
  else if(values.action==='update')next=updateDimStyle(next,values.styleName,valuesOf());
  else if(values.action==='current')next=setCurrentDimStyle(next,values.styleName);
  else if(values.action==='delete')next=deleteDimStyle(next,values.styleName);
  else if(values.action==='apply'){
    const ids=chosen().filter(e=>e.type==='dimension').map(e=>e.id);if(!ids.length)throw Error('적용할 치수를 먼저 선택하세요.');
    const selectedStyle=getDimStyle(next,values.styleName);execute({type:'batch',commands:ids.map(id=>({type:'update',ids:[id],changes:applyDimStyle({},selectedStyle,{overwrite:true})}))});return;
  }
  // 515: 스타일을 고치면 그 스타일을 쓰는 치수 중 재정의하지 않은 값만 따라 바뀐다(표와 함께 되돌리기 한 번).
  const restyled=values.action==='update'&&typeof restyleDimensions==='function'?restyleDimensions(next,engine.doc.entities,values.styleName,{...engine.doc,...normalized}):[];
  const styleCommand={type:'document.update',changes:{dimStyles:next.dimStyles,currentDimStyle:next.currentDimStyle}};
  execute(restyled.length?{type:'batch',commands:[styleCommand,{type:'updateMany',updates:restyled}]}:styleCommand);
  toast('치수 스타일을 저장했습니다: '+next.currentDimStyle+(restyled.length?` · 치수 ${restyled.length}개에 반영(따로 바꾼 값은 유지)`:''));
 });
 const selector=$('form-fields').querySelector('[name=styleName]');
 const presetInput=$('form-fields').querySelector('[name=preset]'),presetScale=$('form-fields').querySelector('[name=presetScale]');
 const fillPreset=()=>{if(!presetInput?.value)return;const scaleValue=Number(presetScale?.value);if(!(scaleValue>0))return;const values=dimPresetValues(presetInput.value,scaleValue);for(const key of ['textHeight','precision','arrowSize','extensionOffset','extensionOvershoot','textGap','scale']){const input=$('form-fields').querySelector(`[name=${key}]`);if(input)input.value=values[key];}const nameInput=$('form-fields').querySelector('[name=newName]');if(nameInput)nameInput.value=`${DIM_PRESETS[presetInput.value].label.split(' ')[0]} 1-${scaleValue}`;const action=$('form-fields').querySelector('[name=action]'),presetName=nameInput?.value;if(action){if(normalized.dimStyles[presetName]){action.value='update';if(selector)selector.value=presetName;}else action.value='create';}};   // 같은 이름 프리셋 스타일이 있으면 그 스타일을 고친다(선택돼 있던 다른 스타일을 덮지 않게)
 presetInput?.addEventListener('change',fillPreset);presetScale?.addEventListener('input',fillPreset);
 selector?.addEventListener('change',()=>{const selected=normalized.dimStyles[selector.value];if(!selected)return;for(const key of ['textHeight','precision','arrowSize','extensionOffset','extensionOvershoot','textGap','scale']){const input=$('form-fields').querySelector(`[name=${key}]`);if(input)input.value=selected[key];}});
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-command]");
  if (b) run(b.dataset.command);
  const t = e.target.closest("[data-tab]");
  if (t) {
    tab = t.dataset.tab;
    toolButtons();
    const catalog = $("tool-buttons").querySelector(".ribbon-catalog");
    if (catalog) {
      if(catalog.classList.contains('file-dropdown')){
        const rect=t.getBoundingClientRect(),panel=catalog.querySelector('.ribbon-catalog-panel');
        panel.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-268))+'px';panel.style.top=(rect.bottom+6)+'px';
        panel.style.maxHeight=Math.max(80,window.innerHeight-rect.bottom-14)+'px';
      }
      catalog.open = !catalog.open;
    }
  }
  if(!t&&!e.target.closest('.ribbon-catalog'))document.querySelectorAll('.ribbon-catalog[open]').forEach(menu=>menu.open=false);
  const close = e.target.closest("[data-close]");
  if (close) $(close.dataset.close).close();
});
// Capture Escape before input fields, IME handlers and sidebar propagation guards.
canvas.addEventListener('pointerdown',e=>{lastCanvasPointerId=e.pointerId;},true);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&aiReveal)finishAIReveal();});
window.addEventListener('blur',()=>{if(aiReveal)finishAIReveal();});
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  if(aiReveal){e.preventDefault();e.stopImmediatePropagation();finishAIReveal();return;}
  const started=performance.now(),previousState=inputState();
  e.preventDefault();e.stopImmediatePropagation();
  if(typeof propertiesDock!=='undefined'&&propertiesDock?.escape(e.target))return;   // 특성 팔레트 칸: 고치던 값을 되돌린다
  const dialogs=[...document.querySelectorAll('dialog[open]')];
  const dialog=dialogs.at(-1);
  if(dialog){if(!dialog.dispatchEvent(new Event('cancel',{cancelable:true})))return;dialog.close();canvas.focus();return;}
  // 글자 제자리 편집 중 Esc = 저장하지 않고 닫기(예전에는 포커스가 옮겨 가며 blur 로 저장됐다).
  if(inlineTextInput&&finishInlineText){finishInlineText(false);canvas.focus();return;}
  const openMenu=document.querySelector('.ribbon-catalog[open]');
  if(openMenu){openMenu.open=false;document.querySelector(`[data-tab="${tab}"]`)?.focus();return;}
  const layerChooser=document.getElementById('current-layer-popover');
  if(layerChooser&&!layerChooser.hidden){closeCurrentLayerChooser({focus:true});return;}
  if(lastCanvasPointerId!==null&&canvas.hasPointerCapture?.(lastCanvasPointerId))canvas.releasePointerCapture(lastCanvasPointerId);
  document.querySelectorAll('.ribbon-menu[open]').forEach(menu=>menu.open=false);
  // 취소할 명령·선택이 없을 때 Esc = 패드 펜 표시 지우기(A9)
  if(mode==='SELECT'&&!drag&&!selected.size&&tabletPad?.hasMarks){tabletPad.clearMarks();canvas.focus();return;}
  cancelStep();canvas.focus();
  traceInput('keydown',{eventTimestamp:e.timeStamp,previousState,nextState:inputState(),accepted:true,reason:'escape',processingMs:performance.now()-started});
},true);
$("coordinate").addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  if (typeof commandSuggestKey === 'function' && commandSuggestKey(e)) return;
  // 동적 입력(오토캐드 F12): 점을 묻는 중 길이를 치고 Tab → 각도를 치고 Enter = 직전 점에서 그 길이·각도의 점.
  if (e.key === 'Tab' && !e.shiftKey && dynamicInputReady() && Number(e.target.value) > 0) {
    e.preventDefault(); params.dynLength = Number(e.target.value); e.target.value = ''; updatePrompt(); render(); return;
  }
  if(typeof flushCursorSnap==='function')flushCursorSnap();
  const requestedCalculatorOperator=calculatorShortcut({text:e.key,mode,phase,busy,inputValue:e.target.value,selectionCount:selected.size,trigger:'key'});
  if(requestedCalculatorOperator&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
    e.preventDefault();e.stopPropagation();studio.numberCalculator.open(requestedCalculatorOperator);return;
  }
  if (e.key === "Enter" || (e.key === " " && !["text", "name"].includes(phase))) {
    e.preventDefault();
    if(typeof settlePendingSelectionClick==='function')settlePendingSelectionClick();
    submit.keyboard=true;try{submit();}finally{submit.keyboard=false;}   // 317 키보드로 친 좌표만 상대 기본
  }
  if (e.key === "Escape") {
    e.preventDefault();
    cancelSelection();
    canvas.focus();
  }
  if (e.key === "ArrowUp" && inputHistory.length) {
    e.preventDefault();
    historyIndex = Math.max(0, historyIndex - 1);
    e.target.value = inputHistory[historyIndex];
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    historyIndex = Math.min(inputHistory.length, historyIndex + 1);
    e.target.value = inputHistory[historyIndex] || "";
  }
});
$("coordinate").oninput = (e) => {
  // 맥 한글 입력기: 조합 중 Space 가 keydown 으로 오지 않고 공백 글자로 들어온다 → Space 와 같이 실행.
  const spaced = e.isComposing ? null : trailingSpaceSubmit(e.target.value, phase);
  if (spaced !== null) { e.target.value = spaced; if(typeof settlePendingSelectionClick==='function')settlePendingSelectionClick(); submit.keyboard=true;try{submit();}finally{submit.keyboard=false;} return; }
  render(); if (typeof updateCommandSuggest === 'function') { if (s7Tools) s7Tools.scheduleSuggest(updateCommandSuggest); else updateCommandSuggest(); } };
$("coordinate").addEventListener('blur', () => setTimeout(() => { if (typeof hideCommandSuggest === 'function' && document.activeElement !== $('coordinate')) hideCommandSuggest(); }, 150));
$("enter").onclick = submit;
$("finish").onclick = () => safe(() => finish());
$("clear-history").onclick = () => $("history").replaceChildren();
$("zoom-in").onclick = () => zoom(1.3);
$("zoom-out").onclick = () => zoom(1 / 1.3);
const keyInputStarts=new WeakMap();
if(typeof assistKeyDown==='function')document.addEventListener('keydown',e=>assistKeyDown(e),true);
document.addEventListener('keydown',e=>{
  safe.lastError=null;
  keyInputStarts.set(e,{started:performance.now(),previousState:inputState()});
},true);
document.addEventListener("keydown", (e) => {
  const assistKey={F3:'osnap',F7:'grid',F8:'ortho',F9:'snap',F10:'polar',F11:'otrack',F12:'dynamic-input'}[e.key.toUpperCase()];
  if(assistKey&&!e.isComposing&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!document.querySelector('dialog[open]')){
    e.preventDefault();if(!e.repeat){const node=$(assistKey);node.checked=!node.checked;/* 직교와 극좌표는 오토캐드처럼 하나만 켜진다 */const other=assistKey==='polar'?$('ortho'):assistKey==='ortho'?$('polar'):null;if(other&&other!==node&&node.checked)other.checked=false;draftingChanged();}return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toUpperCase() === "P") {
    e.preventDefault();
    if (!e.repeat && !document.querySelector("dialog[open]")) run("PLOT");
    return;
  }
  // 명령창에 포커스가 있어도 입력이 비어 있으면 Ctrl+Z / Ctrl+Y 는 도면 되돌리기·다시 실행이다(글자가 있으면 글자 편집 취소).
  if(!e.isComposing&&!document.querySelector("dialog[open]")&&e.target===$("coordinate")&&!e.target.value&&(e.ctrlKey||e.metaKey)&&!e.altKey){
    const chord=keyChord(e),historyCommand=Object.entries(settings.hotkeys).find(([name,v])=>['UNDO','REDO'].includes(name)&&v&&v.toUpperCase()===chord)?.[0];
    if(historyCommand){e.preventDefault();historyShortcut(historyCommand);return;}
    // Ctrl+C/X/V 도 같다: 명령창이 비어 있으면 CAD 객체 복사·붙여넣기(새 도면을 열면 명령창에 포커스가 가 있어
    // 예전에는 Ctrl+V 가 글자 붙여넣기로 새어 나갔다). 붙여넣을 CAD 객체가 없으면 평소 글자 붙여넣기.
    const clip={'CTRL+C':'COPYCLIP','CTRL+X':'CUTCLIP','CTRL+V':'PASTECLIP','CTRL+SHIFT+C':'COPYBASE'}[chord];
    if(clip&&(clip!=='PASTECLIP'||cadClipboard)){e.preventDefault();canvas.focus();run(clip);return;}
  }
  if (
    e.isComposing ||
    document.querySelector("dialog[open]") ||
    e.target.matches("input,textarea,select")
  )
    return;
  const key = e.key.toUpperCase();
  if (key === "ESCAPE") {
    e.preventDefault();
    cancelSelection();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === "A") {
    e.preventDefault();
    setSelected(allSelectableIds());
    return;
  }
  // Ctrl+1: 특성 팔레트 열기/닫기(AutoCAD 와 같은 단축키). run('PROPERTIES') 가 팔레트를 토글한다.
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && key === "1") {
    e.preventDefault();
    if (!e.repeat) run("PROPERTIES");
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === "9") {
    e.preventDefault();
    $("coordinate").focus();
    return;
  }
  const toggle = { F3: "osnap", F7: "grid", F8: "ortho", F9: "snap", F10: "polar", F11: "otrack", F12: "dynamic-input" }[key];
  if (toggle) {
    e.preventDefault();
    $(toggle).checked = !$(toggle).checked;
    draftingChanged();
    return;
  }
  const chord = keyChord(e);
  const clipboardCommand={'CTRL+C':'COPYCLIP','CTRL+X':'CUTCLIP','CTRL+V':'PASTECLIP','CTRL+SHIFT+C':'COPYBASE','CTRL+SHIFT+V':'PASTEBLOCK'}[chord];
  if(clipboardCommand){e.preventDefault();run(clipboardCommand);return;}
  const found = Object.entries(settings.hotkeys).find(
    ([, v]) => v.toUpperCase() === chord,
  );
  if (found) {
    e.preventDefault();
    if(['UNDO','REDO'].includes(found[0]))historyShortcut(found[0]);else run(found[0]);
    return;
  }
  if(typeof flushCursorSnap==='function')flushCursorSnap();
  const requestedCalculatorOperator=calculatorShortcut({text:e.key,mode,phase,busy,inputValue:$('coordinate').value,selectionCount:selected.size,trigger:'key'});
  if(requestedCalculatorOperator&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
    e.preventDefault();studio.numberCalculator.open(requestedCalculatorOperator);return;
  }
  const assistId=Object.entries(architectureAssistState.hotkeys).find(([,value])=>value===normalizeAssistHotkey(chord))?.[0];
  if(assistId){
    const spec=architectureReferenceCommands.find(command=>command.id===assistId);
    if(spec){e.preventDefault();launchArchitectureReference(spec);return;}
  }
  if (key === " ") {
    e.preventDefault();if(!e.repeat){if(typeof settlePendingSelectionClick==='function')settlePendingSelectionClick();safe(()=>finish());}return;
  }
  if (key === "ENTER") {
    e.preventDefault();
    if(typeof settlePendingSelectionClick==='function')settlePendingSelectionClick();
    safe(() => finish());
    return;
  }
  const typed = typedCommandKey(e);   // 맥: 한글 입력 상태의 'ㅣ' 도 명령창으로(명령창이 LINE 으로 바꾼다)
  if (typed) {
    e.preventDefault();
    $("coordinate").focus();
    $("coordinate").value += typed;
    render();
  }
});
document.addEventListener("keyup", (e) => {
  const started=performance.now(),previousState=inputState();
  if (e.key === " ") {const repeat=space&&!spaceDragged&&mode==='SELECT'&&!drag;space=false;spaceDragged=false;if(repeat)safe(()=>finish());}
  traceInput('keyup',{eventTimestamp:e.timeStamp,previousState,nextState:inputState(),accepted:!busy&&!safe.lastError,reason:busy?'busy':safe.lastError?'error: '+safe.lastError.message:'',processingMs:performance.now()-started});
});
// Registered after the command keyboard handler so the trace contains the
// resulting state, not only the state at dispatch time.
document.addEventListener('keydown',e=>{
  const inputStart=keyInputStarts.get(e)||{started:performance.now(),previousState:inputState()};
  traceInput('keydown',{eventTimestamp:e.timeStamp,previousState:inputStart.previousState,nextState:inputState(),accepted:!busy&&!safe.lastError,reason:busy?'busy':safe.lastError?'error: '+safe.lastError.message:'',processingMs:performance.now()-inputStart.started});
  keyInputStarts.delete(e);
});
window.addEventListener("blur", () => {
  space = false;
  drag = null;
});
function draftingChanged(){
  if(cursor&&snap.lastPoint&&mode!=='SELECT')cursor=snap(snap.lastPoint);
  const ids=['grid','snap','osnap','ortho','snap-end','snap-mid','snap-center','snap-quadrant','snap-intersection','snap-nearest','snap-perpendicular','snap-tangent','snap-node','snap-insert','polar','dynamic-input','otrack'];
  const values=Object.fromEntries(ids.filter(id=>$(id)).map(id=>[id,!!$(id).checked]));
  if(typeof assist!=='undefined'&&!$('otrack')?.checked)assist.tracking.clear();   // 315 추적 끄면 추적점도 비움
  values.spacing=$('spacing').value;values.tolerance=$('snap-tolerance').value;if($('polar-angle'))values.polarAngle=$('polar-angle').value;values.crosshairSize=$('crosshair-size').value;values.pickboxSize=$('pickbox-size').value;
  try{localStorage.setItem('barun-drafting-settings',JSON.stringify(values));}catch{}
  syncDraftingButtons();
  if(rawCursor)cursor=objectPickCursor()?{...rawCursor}:snap(rawCursor);
  render();
}
// 탭 전환처럼 체크박스 값만 바뀌는 경우에도 상태표시줄 버튼 표시를 맞추려고 따로 뺐다(전역 설정은 덮어쓰지 않는다).
function syncDraftingButtons(){
  for(const id of ['osnap','ortho','snap','polar','otrack']){
    const node=$(id),button=$('quick-'+id);
    if(node&&button){button.setAttribute('aria-pressed',String(node.checked));button.textContent=({ortho:'직교 F8',polar:'극좌표 F10',osnap:'객체 스냅 F3',otrack:'객체 추적 F11',snap:'그리드 스냅 F9'})[id]+' '+(node.checked?'켜짐':'꺼짐')+(id==='ortho'?snapAngleLabel():'');}
  }
}
window.addEventListener(SNAP_ANGLE_EVENT,()=>syncDraftingButtons()); /* A1 작업 각도(도면 탭별)를 직교 단추에 표시 */
try{
  const saved=JSON.parse(localStorage.getItem('barun-drafting-settings')||'null');
  if(saved){if(Number(saved.crosshairSize)>=1&&Number(saved.crosshairSize)<=100)$('crosshair-size').value=saved.crosshairSize;if(Number(saved.pickboxSize)>=4&&Number(saved.pickboxSize)<=30)$('pickbox-size').value=saved.pickboxSize;for(const id of ['grid','snap','osnap','ortho','snap-end','snap-mid','snap-center','snap-quadrant','snap-intersection','snap-nearest','snap-perpendicular','snap-tangent','snap-node','snap-insert','polar','dynamic-input','otrack'])if(typeof saved[id]==='boolean'&&$(id))$(id).checked=saved[id];
    if(Number(saved.spacing)>0)$('spacing').value=saved.spacing;
    if(Number(saved.tolerance)>=4&&Number(saved.tolerance)<=40)$('snap-tolerance').value=saved.tolerance;
    if($('polar-angle')&&['90','45','30','22.5','15','10','5'].includes(String(saved.polarAngle)))$('polar-angle').value=String(saved.polarAngle);
  }
}catch{}
$('crosshair-size').oninput=()=>{const n=Number($('crosshair-size').value);if(n>=1&&n<=100)draftingChanged();};
$('pickbox-size').onchange=()=>{const n=Number($('pickbox-size').value);$('pickbox-size').value=Number.isFinite(n)?Math.max(4,Math.min(30,n)):10;draftingChanged();};
$('snap-tolerance').onchange=()=>{const n=Number($('snap-tolerance').value);$('snap-tolerance').value=Number.isFinite(n)?Math.max(4,Math.min(40,n)):16;draftingChanged();};
for (const id of [
  'snap-nearest','snap-perpendicular','snap-tangent','snap-node','snap-insert','polar','polar-angle','dynamic-input','otrack',
  "grid",
  "snap",
  "osnap",
  "ortho",
  "snap-end",
  "snap-mid",
  "snap-center",
  "snap-quadrant",
  "snap-intersection",
])
  if($(id))$(id).onchange = draftingChanged;
// ACAD200 영역 3: 선택·입력 세부 설정 칸(설정 창 › 작도 보조 아래). 바뀌면 바로 적용·저장.
if($('input-prefs-body'))IA.renderInputPrefControls($('input-prefs-body'),()=>assist.prefs,next=>{assist.setPrefs(next);assist.gripIndex.invalidate();showSelectionCount();render();});
$("spacing").onchange = () => {
  const n = Number($("spacing").value);
  if (!Number.isFinite(n) || n < 0.001 || n > 1e9) {
    $("spacing").value = 100;
    toast("간격은 0.001~1,000,000,000 mm입니다.", true);
  }
  draftingChanged();
};
function sizeCanvas() {
  const r = canvas.getBoundingClientRect(),
    ratio = window.devicePixelRatio || 1;
  width = r.width;
  height = r.height;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
// 숨은 도면 칸(다른 칸이 앞이거나 창 최소화)은 그리지 않는다 → 화면 크기 버퍼(화면·장면 기억·WebGL 그리기 버퍼·지도)를 놓는다.
// 4K 화면에서 숨은 칸마다 GPU 프로세스에 약 0.5 GB 가 남아 65칸이면 28 GB 였다(2026-10-13). 도형·글자 자료는 두어 돌아올 때 다시 짓지 않는다.
// 잠깐 오가는 칸은 그대로 둔다(돌아오면 그림이 바로 있다). 놓은 칸은 돌아올 때 한 번 다시 그린다.
const HIDDEN_SURFACE_RELEASE_MS = 5000;
let hiddenSurfaceTimer = 0, surfacesReleased = false;
function releaseHiddenSurfaces() {
  if (!document.hidden) return;
  gpuView.releaseSurfaces(); sceneCanvas.width = sceneCanvas.height = 0; sceneKey = null;
  canvas.width = canvas.height = 1;
  if (basemapCanvas) { basemapCanvas.width = basemapCanvas.height = 0; basemapKey = ''; }
  surfacesReleased = true;
}
document.addEventListener('visibilitychange', () => {
  clearTimeout(hiddenSurfaceTimer);
  if (document.hidden) { hiddenSurfaceTimer = setTimeout(releaseHiddenSurfaces, HIDDEN_SURFACE_RELEASE_MS); return; }
  if (surfacesReleased) { surfacesReleased = false; sizeCanvas(); render(); }
  if (hiddenFitPending && needsInitialFit) fitWhenSettled();
});
// 숨은 채 미룬 맞춤: 펼치는 동안 크기가 여러 번 바뀌므로 0.15초 조용해진 마지막 크기로 한 번 맞춘다.
// 큰 도면(5만 개 초과)의 visible() 은 지금 화면 근처만 주므로 숨은 채 맞추면 일부만 잡혔다(설치 확인: 펼치면 1%, [도면 맞춤] 한 번 더 하면 전체)
// — 끝까지 줄인 뒤 두 번 맞춰 전체로 모은다. 숨은 채 연 도면은 열기에서 맞췄어도 다시 보일 때 이렇게 다시 맞춘다.
function fitWhenSettled(){clearTimeout(hiddenFitTimer);hiddenFitTimer=setTimeout(()=>{if(document.hidden||!needsInitialFit)return;sizeCanvas();if(width&&height){needsInitialFit=false;hiddenFitPending=false;scale=1e-8;origin={x:width/2,y:height/2};fit();fit();}},150);}
new ResizeObserver(() => {
  sizeCanvas();
  if (needsInitialFit && width && height) {
    if (hiddenFitPending) { fitWhenSettled(); render(); return; }
    needsInitialFit = false;
    fit();
  } else render();
}).observe(canvas);

function download(data, name, type = "application/json") {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function backup() {
 if(typeof aiReveal!=='undefined'&&aiReveal)finishAIReveal();
  if(busy)return false;busy=true;
  try{
   // 1: 5만 객체를 넘는 도면은 JSON.stringify 가 문자열 한도에 걸린다 → 줄 단위 요청으로 엔진이 경로에 직접 쓴다.
   if(studio.isLargeDocument?.(engine.doc)){const revisionBefore=sceneRevision;await studio.saveLargeDocument(engine.doc,fileName+'.bcad','bcad');if(sceneRevision===revisionBefore){dirty=false;$('dirty').textContent='';documents?.checkpoint();renderDrawingTabs();scheduleDrawingRecovery();}toast('BCAD 백업 저장 완료');return true;}
   // 215: 저장 뒤 "그 사이 바뀌었나"는 문서를 한 번 더 글자로 만들지 않고 문서 포인터·장면 번호로 본다(문서는 이력 불변이다).
   const savedDoc=engine.doc,savedRevision=sceneRevision,snapshot=JSON.stringify(savedDoc,null,2);const blob=new Blob([snapshot]);await studio.output(await studio.b64(blob),fileName+'.bcad','application/json');if(engine.doc===savedDoc&&sceneRevision===savedRevision){dirty=false;$('dirty').textContent='';documents?.checkpoint();renderDrawingTabs();scheduleDrawingRecovery();}toast('BCAD 백업 저장 완료');return true;}catch(e){toast(e.message,true);return false;}finally{busy=false;updatePrompt();}
}
async function connect() {
  try {
    const r = await fetch("/api/status");
    if (!r.ok) throw Error("최신 도면 엔진을 다시 실행하세요.");
    const status = await r.json();
    api = { ...status, token: await engineToken(status) };
    $("server-state").textContent = api.dxf
      ? "DXF 엔진 · " +
        (api.converters.bundled
          ? "DWG: 내장 엔진"
          : "DWG 내장 엔진 복구 필요")
      : "DXF 엔진 설치 필요";
    if (!api.dxf) log(api.error, true);
  } catch (error) {
    $("server-state").textContent = "서버 재시작 필요";
    log(error.message, true);
  }
}
async function request(path, data) {
  if (!api?.token) await connect();
  if (!api?.dxf)
    throw Error(api?.error || "실행.cmd로 최신 서버를 실행하세요.");
  if((path==='/api/export'&&!data?.dryRun)||path==='/api/pdf')return studio.requestOutput(path.slice(5),data);
  if(path==='/api/export' && data?.document && data.format!=='bcad')data={...data,document:prepareDimensionExport(data.document)};
  const encodeStarted=path==='/api/export'?(globalThis.performance?.now?.()??Date.now()):0;
  const encoded = documentRequestBody(data);   // S1: 5만 객체 초과 문서는 줄 단위 Blob(문자열 한도 회피)
  const clientSerialize=path==='/api/export'?(globalThis.performance?.now?.()??Date.now())-encodeStarted:0;
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": encoded.contentType, "X-CAD-Token": api.token },
    body: encoded.body,
  });
  if (r.status === 403) {   // S3: 새 토큰을 다시 받는다. code 가 붙은 403(로그인 필요 등)은 재시작이 아니다(studio.js 와 같은 판정).
    const error = await forbiddenError(r);
    if (error.code === 'ENGINE_RESTARTED') api = null;
    throw error;
  }
  const result = await r.json();
  if (!r.ok) throw Error(result.error || "파일 변환 실패");
  if(path==='/api/export')result.timings_ms={...(result.timings_ms||{}),client_serialize:clientSerialize};
  return result;
}
async function requestDrawingImport(extension,bytes) {
  if (!api?.token) await connect();
  if (!api?.dxf) throw Error(api?.error || "도면 엔진을 다시 시작하세요.");
  let lastError;
  for(let attempt=0;attempt<2;attempt++){
    try{
      const r=await fetch('/api/import',{
        method:'POST',headers:{'Content-Type':'application/octet-stream','X-CAD-Token':api.token,'X-CAD-Import':extension},body:bytes,
      });
      // S1: 줄 단위 스트림 수신(대용량 결과도 한 문자열로 만들지 않는다)
      const result=await receiveImportStream(r,drawingOpenWait?.streamOptions);
      if(!r.ok)throw Error(result.error||'파일 변환 실패');
      if(result.report)result.report.cacheHit=r.headers.get('X-Barun-Import-Cache')==='hit';
      return result;
    }catch(error){lastError=error;if(attempt===0)continue;}
  }
  throw Error('도면 읽기 응답이 두 번 중단되었습니다. CAD를 다시 시작한 뒤 재시도하세요. '+lastError.message);
}
// 저장은 오토캐드와 같은 규칙이다.
//  · 저장(Ctrl+S) — 묻지 않고 지금 이름·형식 그대로 저장. 단, 아직 이름이 '새 도면'이면 창을 띄운다.
//  · 다른 이름으로 저장 — 언제나 창을 띄운다.
let saveDialogEl = null,
  saveFormat = "dxf", // 마지막으로 저장한 형식. 다음 저장도 같은 형식으로 간다.
  dxfVersion = "2018", // DXF 버전도 탭마다 기억한다.
  dwgVersion = "2018"; // DWG 로 저장할 때 고른 버전. 형식처럼 다음 저장이 기억한다.
const SAVE_FORMATS = ["dxf", "dwg", "bcad"], DWG_VERSIONS = ["2018", "2013", "2010", "2004", "2000"];
const DXF_VERSIONS = ["2018", "2013", "2010", "2007", "2004", "2000"];
const docExtension = () => "." + (SAVE_FORMATS.includes(saveFormat) ? saveFormat : "dxf");
function updateDocName() {
  $("doc-name").textContent = fileName + docExtension();
}
/** DWG 저장은 엔진 안의 변환기(도면 변환 창과 같은 것)가 있어야 한다. 없으면 이유를, 있으면 '' 를 돌려준다. */
function dwgSaveProblem() {
  if (api && api.dxf && api.converters && !api.converters.bundled)
    return "이 실행에는 내장 DWG 변환 엔진이 없어 DWG로 저장할 수 없습니다. DXF로 저장하거나 바른 CAD 설치 파일로 복구하세요.";
  return "";
}
function saveInFormat(format) {
 if(typeof aiReveal!=='undefined'&&aiReveal)finishAIReveal();
  if(typeof fieldSync!=='undefined')try{fieldSync.refresh(FIELDEVAL.save,{saveDate:new Date()});}catch{}   // 512: 저장할 때 필드
  if(typeof layerNoticeOnce==='function')layerNoticeOnce('save');   // ACAD200 707 LAYERNOTIFY: 저장 막지 않고 알리기만
  return format === "bcad" ? backup() : format === "dwg" ? saveDWG() : saveDXF();
}
/** 이름이 정해져 있으면 묻지 않고 저장한다. 아직 '새 도면'이면 이름부터 받는다. */
async function saveActiveDrawing() {
 if(typeof aiReveal!=='undefined'&&aiReveal)finishAIReveal();
  if (/^새 도면(\s|$)/.test(fileName)) return await openSaveDialog(true);
  return await saveInFormat(saveFormat);
}
function saveNow() {
  if (busy) return;
  safe(() => saveActiveDrawing());
}
function openSaveDialog(saveAs = false) {
 if(typeof aiReveal!=='undefined'&&aiReveal)finishAIReveal();
  if (busy) return Promise.resolve(false);
  if (!saveDialogEl) {
    saveDialogEl = document.createElement("dialog");
    saveDialogEl.className = "save-dialog";
    saveDialogEl.innerHTML = `<div class="dialog-header"><h2>도면 저장</h2><button class="save-close" type="button">닫기 ×</button></div>
      <label>파일 이름 <input class="save-name" autocomplete="off" spellcheck="false" aria-label="저장할 파일 이름"></label>
      <fieldset class="save-format"><legend>형식 · 보통은 그대로 두세요</legend>
        <label><input type="radio" name="save-format" value="dxf" checked> <b>DXF 도면</b> <select class="save-dxf-version" aria-label="DXF 버전">${DXF_VERSIONS.map((v) => `<option value="${v}">${v}${v === "2000" ? " · 구버전 호환" : ""}</option>`).join("")}</select> <span>기본. 오토캐드 등 다른 캐드에서 그대로 열립니다</span></label>
        <label class="save-dwg-row"><input type="radio" name="save-format" value="dwg"> <b>DWG 도면</b> <select class="save-dwg-version" aria-label="DWG 버전">${DWG_VERSIONS.map((v) => `<option value="${v}">${v}${["2004", "2000"].includes(v) ? " · 한글 불가" : ""}</option>`).join("")}</select> <span>오토캐드 기본 형식. DXF로 만든 뒤 내장 엔진('도면 변환'과 같은 것)으로 DWG로 바꿉니다. 버전은 받는 쪽 오토캐드에 맞추세요</span></label>
        <label><input type="radio" name="save-format" value="ifc"> <b>IFC 내보내기</b> <span>BIM 프로그램(아키캐드·레빗 등)용 사본. 지금 도면의 이름·형식은 그대로입니다</span></label>
        <label><input type="radio" name="save-format" value="bcad"> <b>BCAD 백업</b> <span>바른 CAD 전용. 문·창 개구부처럼 DXF가 못 담는 것까지 통째로 보관할 때만 쓰세요</span></label>
      </fieldset>
      <p class="save-note"></p>
      <div class="dialog-actions"><button class="save-confirm primary" type="button">저장</button><button class="save-close" type="button">취소</button></div>`;
    document.body.append(saveDialogEl);
    saveDialogEl.addEventListener("keydown", (e) => e.stopPropagation());
    saveDialogEl.addEventListener("close", () => canvas.focus());
    for (const close of saveDialogEl.querySelectorAll(".save-close"))
      close.onclick = () => saveDialogEl.close();
    const confirm = async () => {
      const note = saveDialogEl.querySelector(".save-note");
      // 사용자가 확장자까지 적는 일이 흔하다. 떼고 받지 않으면 평면도.dxf.dxf 가 된다.
      const name = saveDialogEl.querySelector(".save-name").value.trim().replace(/\.(dxf|dwg|bcad|json|ifc)$/i, "");
      if (!name) { note.textContent = "파일 이름을 입력하세요."; return false; }
      if (/[\\/:*?"<>|]/.test(name)) { note.textContent = '파일 이름에 \\ / : * ? " < > | 는 쓸 수 없습니다.'; return false; }
      const clash = documents?.tabs.some((t) => t.id !== documents.activeId && t.name === name);
      if (clash) { note.textContent = `이미 "${name}" 도면이 열려 있습니다. 다른 이름을 쓰세요.`; return false; }
      const format = saveDialogEl.querySelector("[name=save-format]:checked").value;
      // IFC 는 도면 저장이 아니라 사본 내보내기 — 이름·형식·저장 상태를 바꾸지 않는다
      if (format === "ifc") { saveDialogEl.__saving = true; saveDialogEl.close(); try { await exportIfc(name); return false; /* 사본 내보내기는 도면 저장이 아니다 — 닫기 전 저장 묻기에서 저장한 것으로 치면 안 된다 */ } catch (e) { toast("IFC 내보내기 실패: " + userErrorMessage(e), true); return false; } finally { saveDialogEl.__saving = false; } }
      if (format === "dwg" && dwgSaveProblem()) { note.textContent = dwgSaveProblem(); return false; }
      // ACAD200-806: 구버전으로 저장하면 단순화되는 것을 저장 전에 보여 준다. 한 번 더 누르면 그대로 저장한다.
      const pickedVersion = format === "dxf" ? saveDialogEl.querySelector(".save-dxf-version").value : format === "dwg" ? saveDialogEl.querySelector(".save-dwg-version").value : "2018";
      if (typeof needsVersionPreview === "function" && needsVersionPreview({ format, version: pickedVersion, large: !!studio.isLargeDocument?.(engine.doc) }) && saveDialogEl.__lossAck !== format + pickedVersion) {
        try {
          const preview = await request("/api/export", { document: engine.doc, version: "R" + pickedVersion, dryRun: true });
          const message = versionLossMessage(preview, { format, version: pickedVersion });
          if (message) { saveDialogEl.__lossAck = preview.ok === false ? null : format + pickedVersion; note.textContent = message; return false; }
        } catch { /* 미리 보기가 안 되면 저장을 막지 않는다 */ }
      }
      const wasName = fileName, wasFormat = saveFormat, wasVersion = dwgVersion, wasDxfVersion = dxfVersion, renamed = name !== fileName;
      fileName = name;
      saveFormat = format;
      if (format === "dxf") dxfVersion = saveDialogEl.querySelector(".save-dxf-version").value;
      if (format === "dwg") dwgVersion = saveDialogEl.querySelector(".save-dwg-version").value;
      if (renamed) renderDrawingTabs();
      updateDocName();
      // 창은 바로 닫되, 그 닫힘이 '취소'로 읽히면 안 된다.
      // dialog.close() 의 닫힘 알림은 저장이 끝나기 전에 오므로, 저장 중임을 표시해 둔다.
      saveDialogEl.__saving = true;
      saveDialogEl.close();
      const saved = await safe(() => saveInFormat(format));
      saveDialogEl.__saving = false;
      if (saved === true) {
        documents?.checkpoint();
        scheduleDrawingRecovery();          // 강제 종료해도 새 이름으로 복구되게
        return true;
      }
      // 저장이 안 됐으면 이름을 되돌린다. 실패한 이름으로 굳으면 다음 저장까지 틀어진다.
      fileName = wasName;
      saveFormat = wasFormat;
      dwgVersion = wasVersion;
      dxfVersion = wasDxfVersion;
      updateDocName();
      renderDrawingTabs();
      return false;
    };
    saveDialogEl.querySelector(".save-confirm").onclick = () => { confirm().then((ok) => saveDialogEl.__done?.(ok)); };
    saveDialogEl.querySelector(".save-name").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); saveDialogEl.querySelector(".save-confirm").click(); }
    });
    saveDialogEl.querySelector(".save-dxf-version").addEventListener("change", () => {
      saveDialogEl.querySelector("[value=dxf]").checked = true;
    });
    // 버전을 고르면 DWG 를 고른 것이다(목록은 label 안에 있어도 단추를 대신 눌러 주지 않는다).
    saveDialogEl.querySelector(".save-dwg-version").addEventListener("change", () => {
      const dwg = saveDialogEl.querySelector("[value=dwg]");
      if (!dwg.disabled) dwg.checked = true;
    });
  }
  // 변환 엔진이 없는 실행(엔진 복구 필요)에서는 DWG 를 고를 수 없게 하고 이유를 보인다.
  const dwgProblem = dwgSaveProblem(), dwgRadio = saveDialogEl.querySelector("[value=dwg]");
  dwgRadio.disabled = !!dwgProblem;
  saveDialogEl.querySelector(".save-dwg-version").disabled = !!dwgProblem;
  saveDialogEl.querySelector(".save-dwg-row").title = dwgProblem;
  saveDialogEl.querySelector(".save-dwg-version").value = DWG_VERSIONS.includes(dwgVersion) ? dwgVersion : "2018";
  saveDialogEl.querySelector(".save-dxf-version").value = DXF_VERSIONS.includes(dxfVersion) ? dxfVersion : "2018";
  saveDialogEl.__lossAck = null;
  const field = saveDialogEl.querySelector(".save-name");
  field.value = fileName;
  // 닫히거나 저장이 끝날 때까지 기다렸다가 결과를 알려 준다(모두 저장·종료 저장이 이 값을 본다).
  const done = new Promise((resolve) => {
    saveDialogEl.__done = (ok) => { saveDialogEl.__done = null; resolve(ok === true); };
  });
  saveDialogEl.addEventListener("close", () => { if (!saveDialogEl.__saving) saveDialogEl.__done?.(false); }, { once: true });
  saveDialogEl.querySelector(".save-note").textContent = (studio.getFolder()
    ? "프로젝트 폴더에 저장합니다."
    : "저장 위치는 브라우저 다운로드 설정을 따릅니다.") + (dwgProblem ? " " + dwgProblem : "");
  saveDialogEl.querySelector(`[value=${saveFormat === "dwg" && dwgProblem ? "dxf" : SAVE_FORMATS.includes(saveFormat) ? saveFormat : "dxf"}]`).checked = true;
  saveDialogEl.querySelector('.dialog-header h2').textContent = saveAs ? '다른 이름으로 저장' : '도면 저장';
  saveDialogEl.showModal();
  field.focus();
  field.select();          // 바로 새 이름을 칠 수 있어야 한다
  return done;
}
function saveDXF() { return saveDrawingExport("dxf"); }
/** DWG 저장: 엔진이 DXF 저장과 똑같이 DXF 를 만든 뒤 내장 변환 엔진으로 DWG 로 바꿔 돌려준다(중간 파일은 엔진 임시 폴더에서 지운다). */
function saveDWG() { return saveDrawingExport("dwg"); }
/* WBLOCK(오토캐드): 고른 객체만 담은 새 DWG 를 저장한다. 레이어·블록 정의·문자 스타일은 지금 도면 것을 그대로 쓰고 좌표도 그대로 둔다.
   DWG 변환 엔진이 없으면 DXF 로 저장한다. 지금 도면과 열린 파일 경로는 바꾸지 않는다. */
async function writeBlock(ids) {
  if (busy) return;
  // 622: 고른 객체가 쓰는 레이어·공유 정의만 담는다(예전: 도면의 레이어·정의 전부).
  const keep = new Set(ids), document = wblockDocument(engine.doc, engine.doc.entities.filter(e => keep.has(e.id)));
  if (!document.entities.length) { toast("저장할 객체를 선택하세요.", true); return; }
  const format = dwgSaveProblem() ? "dxf" : "dwg", version = DWG_VERSIONS.includes(dwgVersion) ? dwgVersion : "2018";
  const name = `${(fileName || "도면").replace(/\.(dxf|dwg|bcad)$/i, "")}_WBLOCK.${format}`;
  busy = true; updatePrompt();
  try {
    const options = format === "dwg" ? {dwgVersion: version} : {dxfVersion: DXF_VERSIONS.includes(dxfVersion) ? dxfVersion : "2018"};
    const saved = studio.isLargeDocument?.(document)
      ? (await studio.saveLargeDocument(document, name, format, options))?.path
      : await studio.output((await request("/api/export", format === "dwg" ? {document, format: "dwg", dwgVersion: version} : {document, version: "R" + options.dxfVersion})).data, name, format === "dwg" ? "application/acad" : "application/dxf");
    if (saved !== false) toast(`객체 ${document.entities.length}개를 새 ${format.toUpperCase()} 로 저장했습니다.`);
  } catch (error) { toast(error.message || String(error), true); }
  finally { busy = false; updatePrompt(); }
}
async function saveDrawingExport(format = "dxf") {
 if(typeof aiReveal!=='undefined'&&aiReveal)finishAIReveal();
  if (busy) return false;
  const problem = format === "dwg" ? dwgSaveProblem() : "";
  if (problem) { toast(problem, true); return false; }
  busy = true;
  updatePrompt();
  try {
    const savedTabId=documents?.activeId,savedName=fileName,version=DWG_VERSIONS.includes(dwgVersion)?dwgVersion:"2018",dxf=DXF_VERSIONS.includes(dxfVersion)?dxfVersion:"2018";
    const label = format === "dwg" ? `DWG(${version})` : "DXF";
    // 엔진 문서는 고칠 때마다 새 문서로 바뀌는 불변 값이라 복사하지 않고 그대로 보낸다(큰 도면에서 저장 순간 수백 MB·1초 이상 들던 복사 제거).
    const snapshot = engine.doc;
    if (format === "dwg") toast(`DWG(${version})로 바꾸고 있습니다. 도면이 크면 시간이 걸립니다.`);
    // 1: 5만 객체를 넘는 도면은 줄 단위 요청 + 엔진이 경로에 직접 저장(base64 응답·JSON.stringify 없음)
    let result;
    const now=()=>globalThis.performance?.now?.()??Date.now(),saveStarted=now(),timings_ms={};
    const large = !!studio.isLargeDocument?.(snapshot);
    const currentPath = typeof filePath === 'string' ? filePath : '', targetPath = !saveDialogEl?.__saving && currentPath.toLowerCase().endsWith('.'+format) ? currentPath : '';
    let savedPath = '';
    // ACAD200-815: DXF 에는 미리보기 그림(THUMBNAILIMAGE)을 넣는다 — 객체를 최대 2만 5천 개만 훑어 도면 크기와 무관하게 짧다.
    let thumbnail = "";
    const thumbnailStarted=now();
    if (format === "dxf") { try { thumbnail = bytesToBase64(drawingThumbnail(snapshot)); } catch { thumbnail = ""; } }
    timings_ms.thumbnail=now()-thumbnailStarted;
    const exportStarted=now();
    if (large) { result = await studio.saveLargeDocument(snapshot, savedName + "." + format, format, { ...(format === "dwg" ? { dwgVersion: version } : { dxfVersion: dxf }), ...(targetPath ? { targetPath } : {}), ...(thumbnail ? { thumbnail } : {}) }); savedPath = result?.path || ''; }
    else {
      result = await request("/api/export", format === "dwg" ? { document: snapshot, format: "dwg", dwgVersion: version } : { document: snapshot, version: "R" + dxf, ...(thumbnail ? { thumbnail } : {}) });
      Object.assign(timings_ms,result.timings_ms||{},{export_roundtrip:now()-exportStarted});
      savedPath = await studio.output(result.data, savedName + "." + format, format === "dwg" ? "application/acad" : "application/dxf", targetPath, {timings_ms,saveResult:result}) || '';
    }
    if(large)Object.assign(timings_ms,result.timings_ms||{});
    if (savedPath && typeof filePath === 'string' && (!documents || documents.activeId === savedTabId)) { filePath = savedPath; try { padShare.drawingSaved(currentPath, savedPath); } catch {} }   // 현장 기록 폴더도 도면을 따라간다
    if ((!documents||documents.activeId===savedTabId)&&engine.doc === snapshot) {
      dirty = false;
      $("dirty").textContent = "";
      const recoveryStart=now();
      documents?.checkpoint();renderDrawingTabs();scheduleDrawingRecovery();
      timings_ms.recovery_schedule=now()-recoveryStart;
      timings_ms.recovery_cleanup=0;   // Recovery IO is queued; no recovery file is removed during save.
    }
    // 저장되면 "저장했습니다"만 알린다. 선종류 대체 같은 세부 안내는 화면에 늘어놓지 않고(개발자 콘솔에만),
    // 실제로 빠진 객체(dwg.lost)나 고른 DXF 버전으로 저장되지 않은 경우·담지 못한 특수 문자는 경고로 보여 준다.
    timings_ms.client_save_total=now()-saveStarted;result.timings_ms=timings_ms;
    console.debug?.("[Barun CAD save performance]",{timings_ms,format,backup_method:result.backup_method,replace_attempts:result.replace_attempts});
    const warnings = result.warnings || [];
    if(warnings.length)console.info('저장 세부 안내', warnings);
    const versionWarning = format === "dxf" ? warnings.filter(w => w.includes("IMAGE") || w.includes("고른 버전으로 저장되지 않았습니다") || w.startsWith("2000·2004 DXF 에는 일부 특수 문자(")).join(' ') : "";
    const downgradeNotice = format === "dxf" ? warnings.filter(w => w.startsWith("구버전(")).join(' ') : "";
    const lost = result.dwg?.lost;
    toast((studio.getFolder()?`프로젝트 폴더에 ${label}를 저장했습니다.`:`${label} 파일을 저장했습니다.`) + (lost?` 일부 객체를 ${label}에 담지 못했습니다(${typeof lost==='number'?lost+'개':'확인 필요'}).`:'') + (versionWarning ? ` ${versionWarning}` : '') + (downgradeNotice ? ` ${downgradeNotice}` : ''), !!(lost || versionWarning));
    return true;   // 저장 중 도면이 또 바뀌었어도 '이번 저장'은 성공이다
  } catch (e) {
    toast(e.message, true);
    return false;
  } finally {
    busy = false;
    updatePrompt();
  }
}
function bytesToBase64(bytes) {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 32768)
    raw += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(raw);
}

// A tab's resolved display list (expanded shared blocks) stays with its
// document while another tab is shown, so switching back does not expand every
// shared block again (3 s on a full plan) after the collector dropped them.
// One entry per tab (its latest document): keyed by document, every undo
// snapshot captured at a checkpoint would pin a display tree of its own.
const tabDisplayCaches=new Map();
function captureDrawingTab(){
  if(typeof finishAIReveal==='function')finishAIReveal();
 if(documents?.activeId!=null&&visibleDoc===engine.doc&&visibleRevision===sceneRevision&&visibleScaleBucket===0&&visibleViewportKey===''){
  tabDisplayCaches.set(documents.activeId,{doc:engine.doc,entities:visibleCache});
  for(const id of tabDisplayCaches.keys())if(!documents.tabs.some(tab=>tab.id===id))tabDisplayCaches.delete(id);
 }
 const controls={};for(const id of ['grid','snap','osnap','ortho','spacing','text-height','wall-width','snap-end','snap-mid','snap-center','snap-quadrant','snap-intersection','snap-nearest','snap-perpendicular','snap-tangent','snap-node','snap-insert']){const node=$(id);if(node)controls[id]=node.type==='checkbox'?node.checked:node.value;}
 return {name:fileName,filePath,saveFormat,dwgVersion,dxfVersion,doc:engine.doc,undoStack:engine.undoStack,redoStack:engine.redoStack,dirty,project:studio.getProjectState(),view:{scale,origin:{...origin},selected:[...selected],activeLayer,currentProperties:structuredClone(currentProperties),zoomHistory:structuredClone(zoomHistory),previousSelection:[...previousSelection],isolatedLayerState:structuredClone(isolatedLayerState),controls}};
}
// An opened or switched-to document is history-immutable like any committed
// one: index it while the user looks at it, not inside the first edit.
function adoptEntityArray(entities){
 commitEntities(entities);
 const warm=()=>{
  if(engine.doc.entities!==entities)return;
  if(typeof warmEntityIndex==='function')warmEntityIndex(entities,{isCurrent:()=>engine.doc.entities===entities}).catch(()=>{});
  else entityIndex(entities);
 };
 if(typeof requestIdleCallback==='function')requestIdleCallback(warm,{timeout:2000});else setTimeout(warm,0);
}
function applyDrawingTab(tab){
 if(typeof aiReveal!=='undefined'&&aiReveal)finishAIReveal();
 switchingDrawing=true;
 try{
  const migration=migrateDrawingTabLayers(tab);if(migration.changed||migration.skipped?.length)log(layerMigrationNotice(migration));
  reset();engine.abortTransaction();/* 진행 중이던 카드 묶음은 이 탭에서 끝낸다. 다른 탭 이력에 섞지 않는다 */engine.doc=G.ensureSharedDrawingReferenceBounds(tab.doc);engine.undoStack=tab.undoStack||[];engine.redoStack=tab.redoStack||[];adoptEntityArray(engine.doc.entities);
  fileName=tab.name;filePath=tab.filePath||'';saveFormat=SAVE_FORMATS.includes(tab.saveFormat)?tab.saveFormat:'dxf';dwgVersion=DWG_VERSIONS.includes(tab.dwgVersion)?tab.dwgVersion:'2018';dxfVersion=DXF_VERSIONS.includes(tab.dxfVersion)?tab.dxfVersion:'2018';dirty=!!tab.dirty;const view=tab.view||{};
  scale=Number.isFinite(view.scale)&&view.scale>0?view.scale:.1;origin=view.origin?{...view.origin}:{x:180,y:330};selected=new SelectionSet((view.selected||[]).filter(id=>engine.doc.entities.some(e=>e.id===id)));
  activeLayer=engine.doc.layers.some(l=>l.id===view.activeLayer)?view.activeLayer:engine.doc.layers.find(l=>l.visible&&!l.locked)?.id||engine.doc.layers[0].id;
  currentProperties={...emptyCurrentProperties(),...(view.currentProperties||{})};
  zoomHistory=structuredClone(view.zoomHistory||[]);isolatedLayerState=structuredClone(view.isolatedLayerState||null);lastDrawingPointer=null;previousSelection=[...(view.previousSelection||[])];tabletPad?.reset();fieldRecordHighlight=null;cursor=null;rawCursor=null;needsInitialFit=false;
  if(tab.project)studio.setProjectState(tab.project);
  for(const [id,value]of Object.entries(view.controls||{})){const node=$(id);if(node){if(node.type==='checkbox')node.checked=!!value;else node.value=value;}}
  syncDraftingButtons();   // 상태표시줄 직교/객체스냅/그리드스냅 표시를 새 탭 값에 맞춘다.
  updateDocName();$('dirty').textContent=dirty?'●':'';
  tabSwitchCover=true;gpuEdit=null;
  engine.emit();
  const kept=tabDisplayCaches.get(tab.id);
  if(kept?.doc===engine.doc&&engine.doc.entities.length<=50000){visibleCache=kept.entities;visibleDoc=engine.doc;visibleRevision=sceneRevision;visibleScaleBucket=0;visibleViewportKey='';visibleGeneration++;}
 }finally{switchingDrawing=false;}
 window.dispatchEvent(new CustomEvent('cad-document-switched',{detail:{id:tab.id,name:tab.name}}));
}
function tabSwitchAllowed({allowDialog=false,allowBusy=false,allowAI=false}={}){
 if(outputCloseHeld)throw Error('도면 닫기를 확인하는 중입니다. 잠시 뒤 다시 실행하세요.');
 if(restoringTabs||busy&&!allowBusy)throw Error('도면을 읽거나 저장하고 있습니다. 완료 후 전환하세요.');
 if(!allowAI&&studio.context.isAIWorking?.())throw Error('현재 도면의 AI 작업이 끝나거나 중지된 뒤 탭을 전환하세요.');
 if(!allowDialog&&document.querySelector('dialog[open]'))throw Error('열려 있는 설정·검토 창을 닫은 뒤 도면을 전환하세요.');
}
function restoreRecoveredDrawing(doc){
 const migration=prepareLegacyLayerMigration(doc);execute({type:'load',document:migration.doc});engine.undoStack=migration.before?[migration.before]:[];engine.redoStack=[];if(documents?.active)documents.active.legacyLayersChecked=true;
 if(migration.changed||migration.skipped?.length){const notice=layerMigrationNotice(migration);log(notice);toast(notice);}
}
/* 파일 하나 고르기(취소면 null). Electron 은 window.prompt 가 없어 입력은 폼·파일 창으로 받는다. */
function pickOneFile(accept=''){return new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept=accept;input.style.display='none';document.body.append(input);let done=false;const finish=file=>{if(done)return;done=true;input.remove();resolve(file||null);};input.onchange=()=>finish(input.files?.[0]);input.addEventListener('cancel',()=>finish(null));input.click();});}
/* ACAD200 707: 확인 안 된 새 레이어 알림. 막지 않고 한 번 알린다(같은 도면·같은 개수면 다시 알리지 않음). */
let layerNoticeKey='';
function layerNoticeOnce(action){try{const notice=s7Tools?.layerNotice(action);if(!notice)return;const key=action+'|'+fileName+'|'+notice.message;if(key===layerNoticeKey)return;layerNoticeKey=key;toast(notice.message+' 레이어 관리자의 "새 레이어(확인 전)" 필터에서 확인하세요.',true);log(notice.message);}catch{}}
function nextDrawingName(){const allocated=window.cadDesktop?.allocateDrawingName?.(documents?.tabs.map(t=>t.name)||[]);if(allocated)return allocated;let n=1;while(documents?.tabs.some(t=>t.name==='새 도면 '+n))n++;return '새 도면 '+n;}
function openDrawingTab(doc,name,modified=false,options={}){
 tabSwitchAllowed(options);const migration=options.layerMigration||prepareLegacyLayerMigration(doc);doc=migration.doc;if(migration.changed)modified=true;if(!options.engineValidated||migration.changed)engine.validate(doc);
 if(options.replaceEmpty){documents.checkpoint();for(const tab of [...documents.tabs])if(isEmptyDrawingTab(tab))documents.remove(tab.id);}
 const baseName=name;let suffix=2;while(documents.tabs.some(t=>t.name===name))name=baseName+' ('+(suffix++)+')';
 // 파일에서 연 도면이면 그 경로를 기억한다. DWG 로 열었으면 다음 저장도 DWG(오토캐드처럼 같은 파일에).
 const openedPath=options.filePath??nextOpenFilePath;nextOpenFilePath='';
 const openedFormat=/\.(bcad|json)$/i.test(openedPath)?'bcad':/\.dwg$/i.test(openedPath)&&!dwgSaveProblem()?'dwg':'dxf';
 const tab=documents.open({name,filePath:openedPath,...(openedPath?{saveFormat:openedFormat}:{}),doc:options.adoptDocument?doc:structuredClone(doc),dirty:modified,legacyLayersChecked:true,undoStack:migration.before?[migration.before]:[],redoStack:[],project:studio.getProjectState(),view:{scale:.1,origin:{x:180,y:330},selected:[],activeLayer:doc.layers.find(l=>l.visible&&!l.locked)?.id||doc.layers[0].id}});
 if(migration.changed||migration.skipped?.length){const notice=layerMigrationNotice(migration);log(notice);toast(notice);}fit();documents.checkpoint();scheduleDrawingRecovery();
 /* ACAD200 520: 엑셀 연결 표가 있는 도면만 원본 시각을 한 번 확인해 바뀐 표를 알린다(표 없으면 엔진에 묻지 않음). */
 globalThis.setTimeout?.(()=>{try{notifyLinkedTables(doc,(route,data)=>studio.context.api(route,data),m=>{log(m);toast(m);}).catch(()=>{});}catch{}},0);
 /* ACAD200 506·512: 대신 그린 글꼴을 한 번 알리고(끄기 가능), 필드는 연 때 값으로. 도면을 한 번 훑는다 — 열 때만. */
 globalThis.setTimeout?.(()=>{try{fontNoticeOnOpen(engine.doc,{storage:localStorage,toast,measure:canvasMeasure()});fieldSync.rebuild();fieldSync.refresh(FIELDEVAL.open);}catch(error){console.warn('[open-check]',error);}},0);
 return tab;
}
function selectDrawingTab(id){tabSwitchAllowed();documents.select(id);canvas.focus();}
// 도면 탭 오른쪽 클릭: 그 탭을 닫기·저장·다른 이름으로 저장(저장은 그 탭을 앞으로 꺼낸 뒤 늘 쓰던 저장 명령으로).
// 검토 B3: 저장은 비동기라 safe() 가 잡지 못한다 — 실패(명령 중이라 탭 못 바꿈·저장 실패)를 알림으로.
const tabMenuRun=run=>()=>Promise.resolve().then(run).catch(error=>toast(error?.message||String(error),true));
function drawingTabMenuItems(id){const on=run=>tabMenuRun(()=>{selectDrawingTab(id);return run();});return [{label:'닫기',run:tabMenuRun(()=>closeDrawingTab(id))},{label:'저장',run:on(()=>saveNow())},{label:'다른 이름으로 저장',run:on(()=>openSaveDialog(true))}];}
let otherWindows=null,reportedDrawings='',docViewActive=true;   // 도면 칸마다 프로세스: 이 칸이 지금 보이는 칸인가
globalThis.window?.cadDesktop?.onWindows?.(state=>{otherWindows=state;renderDrawingTabs();
 // 이 칸이 앞에 나오면 패드도 이 칸으로(패드는 보고 있는 도면을 따라간다, A15)
 const nowActive=!!state?.windows?.find(w=>w.id===state.self)?.active,became=nowActive&&!docViewActive;docViewActive=nowActive;
 if(nowActive)try{tablet.activate();}catch{}
 if(became)try{padShare.activated();}catch{}});
function drawingOpenState(){
 documents.checkpoint();
 return {busy:busy||outputCloseHeld||restoringTabs||!!fileImportQueue.length||!!studio.context.isAIWorking?.(),conversation:!!studio.context.hasAIConversation?.(),drawings:documents.tabs.map(tab=>({id:tab.id,name:tab.name,filePath:tab.filePath||'',dirty:!!tab.dirty,active:tab.id===documents.activeId,empty:isEmptyDrawingTab(tab)}))};
}
function reportDrawingStates(){
 const desk=globalThis.window?.cadDesktop;if(!documents||!desk?.reportDrawings)return;
 const own=documents.tabs.map(t=>({id:t.id,name:t.name,filePath:t.filePath||'',large:recoveryWeight(t.doc)>50000,dirty:!!t.dirty,active:t.id===documents.activeId})),ownSig=JSON.stringify(own);
 if(ownSig!==reportedDrawings){reportedDrawings=ownSig;desk.reportDrawings(own);}
}
function renderDrawingTabs(){
 if(!drawingTabList||!documents)return;drawingTabList.replaceChildren();
 // 도면 칸마다 프로세스: 다른 칸(창 안 다른 프로세스)의 도면도 이 탭 줄에 칸 순서대로 함께 보인다. 누르면 그 칸으로, × 는 그 칸 닫기.
 const desk=globalThis.window?.cadDesktop,windows=desk?.onWindows&&otherWindows?.windows?.length>1?otherWindows.windows:null;
 reportDrawingStates();
 const otherTab=w=>{const wrapper=document.createElement('div');wrapper.className='drawing-tab other-window';const button=document.createElement('button');button.type='button';button.setAttribute('role','tab');button.setAttribute('aria-selected','false');const d=(w.drawings||[]).find(x=>x.active)||w.drawings?.[0];const name=d?.name||w.title;button.title=name+' · 다른 도면 창';button.textContent=name+(w.state==='crashed'?' · 멈춤':d?.dirty?' ●':'');button.onclick=()=>desk.selectWindow(w.id);const close=document.createElement('button');close.type='button';close.className='drawing-tab-close';close.textContent='×';close.setAttribute('aria-label',name+' 닫기');close.onclick=()=>desk.closeWindow(w.id);button.oncontextmenu=e=>{e.preventDefault();showCanvasMenu(e.clientX,e.clientY,[{label:'닫기',run:()=>desk.closeWindow(w.id)},...(w.state==='crashed'?[]:[{label:'저장',run:()=>desk.windowCommand(w.id,'SAVE')},{label:'다른 이름으로 저장',run:()=>desk.windowCommand(w.id,'SAVEAS')}])]);};wrapper.append(button,close);drawingTabList.append(wrapper);};
 const ownTabs=()=>{for(const tab of documents.tabs){const wrapper=document.createElement('div');wrapper.className='drawing-tab'+(tab.id===documents.activeId?' active':'');const button=document.createElement('button');button.type='button';button.setAttribute('role','tab');button.setAttribute('aria-selected',String(tab.id===documents.activeId));button.dataset.drawingId=tab.id;button.title=tab.name+(tab.project?.folder?'\n'+tab.project.folder:'');button.textContent=tab.name+(tab.dirty?' ●':'');button.onclick=()=>safe(()=>selectDrawingTab(tab.id));const close=document.createElement('button');close.type='button';close.className='drawing-tab-close';close.textContent='×';close.setAttribute('aria-label',tab.name+' 닫기');close.onclick=()=>closeDrawingTab(tab.id);button.oncontextmenu=e=>{e.preventDefault();showCanvasMenu(e.clientX,e.clientY,drawingTabMenuItems(tab.id));};wrapper.append(button,close);drawingTabList.append(wrapper);}};
 if(windows)for(const w of windows){if(w.id===otherWindows.self)ownTabs();else otherTab(w);}else ownTabs();
 if(drawingTabStatus)drawingTabStatus.textContent=windows?`${documents.tabs.length+windows.length-1}개 도면`:`${documents.tabs.length} / ${documents.limit}`;
 const all=drawingTabBar.querySelector('.drawing-save-all');if(all)all.hidden=documents.tabs.length<2;   // 한 장이면 '저장'과 같은 뜻
 drawingTabList.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest',inline:'nearest'});
}
let largeRecoveryNotice=false;
function hasOversizedRecoveryDocument(){return !!documents?.tabs.some(tab=>recoveryWeight(tab.doc)>50000);}
function scheduleDrawingRecovery(){
 if(!documents||restoringTabs||documents.tabs.every(tab=>recoveryWeight(tab.doc)>50000)){recoveryPending=false;return;}recoveryPending=true;clearTimeout(recoveryTimer);if(recoveryIdleId!==null&&typeof cancelIdleCallback==='function'){cancelIdleCallback(recoveryIdleId);recoveryIdleId=null;}
 const write=()=>{if((typeof aiReveal!=='undefined'&&aiReveal)||busy||recoveryInputActive()){scheduleDrawingRecovery();return;}const run=()=>{recoveryIdleId=null;if((typeof aiReveal!=='undefined'&&aiReveal)||busy||recoveryInputActive()){scheduleDrawingRecovery();return;}flushDrawingRecovery({background:true}).catch(()=>{});};if(typeof requestIdleCallback==='function')recoveryIdleId=requestIdleCallback(run,{timeout:5000});else run();};
 recoveryTimer=setTimeout(write,busy?5000:1000);
}
async function flushDrawingRecovery({background=false}={}){
 if(recoveryStartup)await recoveryStartup;
 recoveryBackground=background;
 clearTimeout(recoveryTimer);recoveryTimer=null;if(recoveryIdleId!==null&&typeof cancelIdleCallback==='function'){cancelIdleCallback(recoveryIdleId);recoveryIdleId=null;}if(!documents)return;
 if(typeof finishAIReveal==='function')finishAIReveal();
 documents.checkpoint();reportDrawingStates(); // 숨은 칸은 화면 프레임 없이 복구 저장만 해도 dirty/경로를 main에 알린다.
 // 감사 3: 대용량 탭만 칸별 복구에서 뺀다(엔진 대용량 복구가 맡음). 나머지 탭은 계속 저장해야 충돌 때 잃지 않는다.
 const oversized=hasOversizedRecoveryDocument();
 if(oversized){
  if(!largeRecoveryNotice&&documents.tabs.some(tab=>recoveryWeight(tab.doc)>50000&&tab.dirty)){largeRecoveryNotice=true;toast('대용량 도면은 자동 복구를 2분마다 합니다. 작업 중 수시로 저장하세요.');}
  if(documents.tabs.every(tab=>recoveryWeight(tab.doc)>50000)){recoveryPending=false;return;}
 }
 if(!recoveryStore){recoveryBlocked=true;throw Error('다중 도면 복구 저장소를 사용할 수 없습니다. 각 도면을 파일로 저장하세요.');}
 const full=documents.snapshot(),kept=oversized?full.tabs.filter(tab=>recoveryWeight(tab.doc)<=50000):full.tabs,snapshot=oversized?{...full,tabs:kept,activeId:kept.some(tab=>tab.id===full.activeId)?full.activeId:kept[0]?.id}:full,revision=sceneRevision;recoveryPending=true;
 // S2: 새로 켠 빈 작업공간이 내용 있는 직전 복구본을 덮어쓰지 않는다. 편집·열기로 내용이 생기면 그때부터 쓴다.
 if(keepPreviousWorkspace){if(!snapshot.tabs.some(tab=>tab.dirty||(tab.doc?.entities?.length||0)>0)){recoveryPending=false;return;}keepPreviousWorkspace=false;}
 // The recovery adapter captures mutable headers synchronously and streams
 // immutable geometry into bounded records. Its lock serializes snapshots.
 const write=recoveryStore.write(snapshot);recoveryWrite=write;
 try{await write;stampRecovery('barun-cad-workspace-rev',revision);if(recoveryWrite===write&&!recoveryTimer){recoveryPending=false;recoveryBlocked=false;}}catch(error){recoveryBlocked=true;scheduleLocalRecovery();toast('다중 도면 자동 복구 저장 실패. 도면을 파일로 저장하세요.',true);throw error;}
}
async function closeDrawingTab(id,{allowAI=false}={}){
 if(typeof aiReveal!=='undefined'&&aiReveal)finishAIReveal();
 try{tabSwitchAllowed({allowAI});documents.checkpoint();const target=documents.tabs.find(t=>t.id===id);if(!target)return;
   // 마지막 내부 탭은 빈 도면으로 바꾸지 않고 main 에서 그 칸 프로세스를 닫는다.
   if(documents.tabs.length===1&&window.cadDesktop?.windowShortcut){await window.cadDesktop.windowShortcut('close');return;}
  // 다른 탭을 닫으려고 잠시 전환했더라도 원래 작업하던 탭으로 되돌린다(saveAllDrawings와 같은 방식).
  const original=documents.activeId;
  const restoreActive=()=>{if(documents.activeId!==original&&documents.tabs.some(t=>t.id===original))documents.select(original);};
  if(target.dirty){const choice=await chooseDrawingClose(target.name);if(choice==='cancel')return;if(choice==='save'){documents.select(id);if(!await saveActiveDrawing()){restoreActive();return;}}}
  documents.remove(id);if(!documents.tabs.length)documents.open({name:nextDrawingName(),doc:newDrawingDocument(),dirty:false,undoStack:[],redoStack:[],project:studio.getProjectState(),view:{}});
  restoreActive();
  await flushDrawingRecovery();
 }catch(error){toast(error.message,true);}
}
function chooseDrawingClose(name){return new Promise(resolve=>{
 const dialog=document.createElement('dialog');dialog.className='drawing-close-dialog';const heading=document.createElement('h2');heading.textContent=name+' 저장';const note=document.createElement('p');note.textContent='변경한 도면을 저장한 뒤 닫으시겠습니까?';dialog.append(heading,note);let answered=false;const done=value=>{if(answered)return;answered=true;dialog.close();dialog.remove();resolve(value);};
 for(const [label,value]of [['저장 후 닫기','save'],['저장하지 않고 닫기','discard'],['취소','cancel']]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>done(value);dialog.append(b);}
 dialog.oncancel=e=>{e.preventDefault();done('cancel');};document.body.append(dialog);dialog.showModal();
});}
async function saveAllDrawings(){
 try{tabSwitchAllowed({allowDialog:true});documents.checkpoint();const original=documents.activeId,ids=documents.dirtyTabs().map(t=>t.id);
  // 탭마다 제 이름·제 형식으로 저장한다. 예전에는 전부 DXF 로 밀어 넣고 이름도 묻지 않았다.
  try{for(const id of ids){documents.select(id);if(!await saveActiveDrawing())return false;}}finally{if(documents.tabs.some(t=>t.id===original))documents.select(original);}
  await flushDrawingRecovery();return !documents.dirtyTabs().length;
 }catch(error){toast(error.message,true);return false;}
}
async function initializeDrawingTabs(){
 restoringTabs=true;await studio.projectReady;
 drawingTabBar=document.createElement('nav');drawingTabBar.className='drawing-tabs-bar';drawingTabBar.setAttribute('aria-label','열린 도면');drawingTabList=document.createElement('div');drawingTabList.className='drawing-tabs-list';drawingTabList.setAttribute('role','tablist');drawingTabList.setAttribute('aria-label','도면 작업 탭');const saveAll=document.createElement('button');saveAll.textContent='모두 저장';saveAll.className='drawing-save-all';saveAll.onclick=()=>saveAllDrawings();drawingTabStatus=document.createElement('span');drawingTabStatus.className='drawing-tabs-count';drawingTabBar.append(drawingTabList,saveAll,drawingTabStatus);document.querySelector('.canvas-toolbar').after(drawingTabBar);
 documents=new DrawingTabs({capture:captureDrawingTab,apply:applyDrawingTab,onChange:()=>{renderDrawingTabs();scheduleDrawingRecovery();gpuView.retainScenes?.(documents.tabs.map(tab=>tab.id));}});
 const initial={...captureDrawingTab(),id:crypto.randomUUID()};documents.tabs=[initial];documents.activeId=initial.id;
 // 앱을 새로 켜면 빈 도면으로 시작한다. 업데이트 재시작·비정상 종료도 같은 기준을 쓴다.
 // 판단은 켤 때 한 번 해 둔 startFresh 를 쓴다(도면 탭 복구와 마지막 작업 복구가 같은 기준을 따라야 한다).
 let restoreFailed=false,restoreFiles=[];
  const checkPreviousSession=async()=>{
 try{recoveryStore=await openDrawingRecovery(indexedDB,{yield:recoveryPause});const saved=await recoveryStore.read();
  // 2: 엔진에 남은 대용량 복구본(시각·dirty)도 후보에 넣어 더 새로운 쪽을 고른다(내용은 받지 않는다).
  const engineSources=await studio.api('restore',{probe:true}).then(r=>r?.sources||[]).catch(()=>[]);
  engineRecovery=engineSources.find(s=>s.kind==='large'&&s.dirty)||null;
  if(window.cadDesktop?.restoreWindow&&startFresh){
    // 구판 숫자 목록도 빈 새 도면은 걸러 내고 파일/미저장 탭만 되살린다.
    const recorded=window.cadDesktop.restoreDrawings||[];
    const matching=recorded.length&&saved?{...saved,tabs:saved.tabs.filter(tab=>recorded.some(d=>tab.filePath?d.filePath===tab.filePath&&!d.large&&!d.reopen:d.dirty&&d.name===tab.name&&!d.large&&!d.reopen))}:saved;
    const restorable=restorableDrawingWorkspace(matching),tabs=restorable?.tabs||[];
    // 엔진 복구 API는 칸 식별자가 없다. 공용 복구본을 이 칸에 자동 적용하지 않는다.
    if(recorded.some(d=>d.dirty&&d.large)){keepPreviousWorkspace=true;throw Error('미저장 대용량 도면은 칸별 복구본을 확인할 수 없습니다. RECOVER로 확인하세요.');}
    restoreFiles=recorded.filter(d=>d.filePath&&!d.dirty&&!tabs.some(tab=>tab.filePath===d.filePath)).map(d=>d.filePath);
    if(recorded.some(d=>d.dirty&&!tabs.some(tab=>d.filePath?tab.filePath===d.filePath:tab.dirty&&tab.name===d.name))){keepPreviousWorkspace=true;throw Error('저장하지 않은 도면 일부의 복구본을 찾지 못했습니다. RECOVER로 확인하세요.');}
    if(tabs.length){
     const renamed=tabs.map((tab,index)=>!tab.filePath&&/^새 도면(?:\s*\d+)?$/.test(tab.name)?{...tab,name:index===0?window.cadDesktop.initialDrawingName:nextDrawingName()}:tab);
     documents.restore({...restorable,tabs:renamed},doc=>engine.validate(doc));tabsRecovered=true;
    }
    return;
   }
   const offer=recoveryOffer({saved,startFresh,closedCleanly,engine:engineRecovery?.fileNewer?null:engineRecovery});   /* 검토 A8: 도면 파일이 더 새로운 복구본은 자동으로 권하지 않고 RECOVER 에서만 */
  if(offer.source==='engine')lastSessionWorkspace=null;
  if(offer.action==='keep'||offer.action==='offer'){
   // S2: 버리지도, 덮어쓰지도 않는다. 직전 세션을 별도 세대(last-session)로 남기고, 편집이 생기기 전에는 current 를 그대로 둔다.
   lastSessionWorkspace=saved;keepPreviousWorkspace=true;
   await (recoveryStore.preserveCurrentSession||recoveryStore.preserveLastSession)(saved).catch(()=>{});
   if(offer.action==='offer')recoveryOfferPending=offer;
   else log('새 도면으로 시작했습니다. 저장하지 않은 지난 작업 도면 '+offer.count+'개는 보관해 두었습니다(최근 3세대 유지) · 명령창에 RECOVER');
  }
  else if(offer.action==='restore'){documents.restore(saved,doc=>engine.validate(doc));tabsRecovered=true;log('열린 도면 '+documents.tabs.length+'개를 복구했습니다.');
  // 작업공간 복구본보다 마지막 편집본이 최신이면 조용히 버리지 않고 알린다.
  if(startupRecoveryRevisions.local>startupRecoveryRevisions.workspace){log('마지막 편집본이 복구된 작업공간보다 최신입니다. 빠진 작업이 없는지 확인하세요.',true);toast('마지막 편집 일부가 복구본에 없을 수 있습니다.',true);}
 }
  else if(startFresh){const older=await recoveryStore.readLastSession?.().catch(()=>null);if(older?.tabs?.length)lastSessionWorkspace=older;}
 }catch(error){restoreFailed=true;keepPreviousWorkspace=true;recoveryBlocked=true;log('다중 도면 복구 확인 실패: '+error.message,true);}
 };
 // 새 실행은 빈 도면으로 시작한다: 지난 세션 확인·보관(대형 도면이면 수백 MB)이 메뉴·도면 화면을 막지 않게 뒤에서 한다.
 // 같은 창 새로고침은 탭을 되살려야 하므로 예전처럼 기다린다.
 if(startFresh&&!window.cadDesktop?.restoreWindow)recoveryStartup=checkPreviousSession().finally(()=>{recoveryStartup=null;});else await checkPreviousSession();
 restoringTabs=false;renderDrawingTabs();
  const reopenPreviousFiles=async()=>{
   if(!restoreFailed&&restoreFiles.length){for(const file of restoreFiles)await openExternalDrawingPaths([file],{local:true});if(restoreFiles.some(file=>!documents.tabs.some(tab=>tab.filePath===file)))restoreFailed=true;}
   window.cadDesktop?.workspaceReady?.({empty:!documents.tabs.some(tab=>tab.dirty||tab.filePath),failed:restoreFailed});
  };
  // 지난 도면 다시 열기(큰 도면은 십여 초)는 메뉴·화면이 다 그려진 뒤에 한다. 기다리면 그동안 정리 전 메뉴 목록이 날것으로 보였다(10/21).
  if(!restoreFailed&&restoreFiles.length)drawingWorkspaceReady.then(()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)))).then(reopenPreviousFiles).catch(error=>log('지난 도면 다시 열기 실패: '+error.message,true));
  else await reopenPreviousFiles();
 const flushAfterCheck=()=>{if(recoveryStore&&!recoveryBlocked&&!keepPreviousWorkspace)return flushDrawingRecovery().catch(()=>{});};
 if(!recoveryStartup)await flushAfterCheck();
 // 정상 종료로 안 열어 둔 지난 작업을 손으로 되살린다.
 // 엔진에 남은 복구본(대용량은 줄 단위 스트림으로 온다)을 되살린다. 2: 시작 대화상자와 RECOVER 가 함께 쓴다.
 recoverFromEngine=()=>studio.api('restore',{}).then(saved=>{
   if(!saved?.document)return log('되살릴 지난 작업이 없습니다.',true);
   engineRecovery=null;
   restoreRecoveredDrawing(saved.document);
   dirty=true;$('dirty').textContent='●';refresh();fit();
   log('지난 작업을 되살렸습니다.');
  }).catch(error=>log('되살리지 못했습니다: '+error.message,true));
 studio.handlers.RECOVER=()=>safe(()=>{
  if(recoveryStartup){log('지난 작업을 확인하고 있습니다. 잠시 뒤 이어서 되살립니다.');recoveryStartup.then(()=>studio.handlers.RECOVER());return;}
  if(documents.tabs.some(t=>t.dirty))throw Error('저장하지 않은 도면이 있습니다. 먼저 저장한 뒤 되살리세요.');
  // 2: 엔진의 대용량 복구본이 보관본보다 새로우면 그것부터 되살린다.
  if(engineRecovery&&Number(engineRecovery.savedAt)>Number(lastSessionWorkspace?.savedAt||0)){recoverFromEngine();return;}
  if(lastSessionWorkspace?.tabs?.length){
   const saved=lastSessionWorkspace;lastSessionWorkspace=null;lastSessionDocument=null;
   documents.restore(saved,doc=>engine.validate(doc));tabsRecovered=true;
   renderDrawingTabs();scheduleDrawingRecovery();
   log('지난 작업 도면 '+documents.tabs.length+'개를 되살렸습니다.');return;
  }
  if(lastSessionDocument){
   // 탭 기록이 없고 마지막 작업만 남은 경우.
   restoreRecoveredDrawing(JSON.parse(lastSessionDocument));lastSessionDocument=null;
   dirty=true;$('dirty').textContent='●';fit();
   log('지난 작업을 되살렸습니다.');return;
  }
  // 마지막 갈래: 앱이 서버에 남겨 둔 복구본.
  recoverFromEngine();
 });
 // 218: AutoCAD 의 DRAWINGRECOVERY(지난 작업 되살리기)와 이름을 맞춘다. 예전 RECOVER 도 그대로 같은 일을 한다.
 studio.handlers.DRAWINGRECOVERY=()=>studio.handlers.RECOVER();
 // S2: 정상 종료가 아니었으면 사용자가 고르기 전까지 아무것도 덮어쓰지 않고 묻는다.
 const showPendingRecoveryOffer=()=>{if(recoveryOfferPending){const offer=recoveryOfferPending;recoveryOfferPending=null;showRecoveryDialog({count:offer.count,names:offer.names,rows:offer.rows,onRecover:()=>offer.source==='engine'?recoverFromEngine():studio.handlers.RECOVER(),onFresh:()=>{recoveryStore?.clearCurrent?.().catch(()=>{});log('새 도면으로 시작했습니다. 지난 작업 도면 '+offer.count+'개는 보관해 두었습니다 · 명령창에 RECOVER');}});}};
 if(recoveryStartup)recoveryStartup.then(flushAfterCheck).then(showPendingRecoveryOffer);else showPendingRecoveryOffer();
 // 계획안을 마우스 끝에 띄워 두고 클릭한 점을 돌려준다(Esc 는 취소 오류).
studio.context.placePlan=({entities,base,title=''})=>new Promise((resolve,reject)=>{reset();mode='PLANPLACE';phase='point';params={planPlace:{entities,base,title,resolve},onCancel:()=>reject(Error('계획안 놓기를 취소했습니다.'))};updatePrompt();render();canvas.focus();});
studio.context.hasDrawingWorkspace=()=>tabsRecovered||documents.tabs.length>1||documents.active?.dirty;
 studio.context.isSwitchingDrawing=()=>switchingDrawing;
 studio.context.getDrawingId=()=>documents.activeId;
 // 배경 지도 {image,affine,layer} 또는 null(끄기). 지금 도면에만 붙는다.
 studio.context.setBackgroundMap=map=>{
  if(!map){backgroundMaps.delete(engine.doc);basemapKey='x';render();return;}
  const img=new Image();const entry={id:Date.now()+Math.random(),img,affine:map.affine,layer:map.layer,label:map.label||'',attribution:map.attribution};
  img.onload=()=>{basemapKey='';render();};img.src=map.image;backgroundMaps.set(engine.doc,entry);basemapKey='';render();
 };
 // 계획 탭 ⑥: 대지 주변 3D 창(지금 도면 기준).
 studio.context.openSite3D=async(opts={})=>(await import('./site-3d.js')).openSite3D({doc:engine.doc,host:document.querySelector('.viewport'),toast,download,zoning:opts.zoning||null,radius:opts.radius||500});
 studio.context.getBackgroundMap=()=>{const m=backgroundMaps.get(engine.doc);return m?{layer:m.layer,label:m.label,attribution:m.attribution}:null;};
 // 계획 탭 ⑤ 대지분석: 도판 SVG·PNG 저장.
 studio.context.download=download;
 studio.context.normalizeBridgeCommand=withCurrentProperties;
 // AI·리습이 건축 요소 명령을 화면 없이 부를 때(command-runner.js): 지금 레이어와 실행 뒤 선택.
 studio.context.getActiveLayer=()=>activeLayer;studio.context.setSelectedIds=ids=>setSelected(ids);
 // AI "눈"(cad_view_drawing scope=screen): 지금 화면에 보이는 도면 영역(mm).
 studio.context.getViewWindow=()=>({minX:-origin.x/scale,maxX:(width-origin.x)/scale,minY:(origin.y-height)/scale,maxY:origin.y/scale});
 studio.context.isDocumentBusy=()=>busy||restoringTabs;
 studio.context.openDrawing=(doc,name)=>openDrawingTab(doc,name||nextDrawingName(),false,{allowDialog:true});
 // AI/MCP cad_close_document: 이 창의 지금 도면을 닫는다. 저장 안 한 변경은 묻지 않고 거부한다(AI 가 대신 '저장 안 함'을 고르지 않게).
 // 실제 닫기(after)는 결과가 엔진에 닿은 뒤 — 마지막 도면이면 창(프로세스)째 닫혀 메모리를 돌려준다.
 studio.context.closeDrawingForBridge=({allowAI=false}={})=>{
  if(busy||restoringTabs||fileImportQueue.length)throw Error('도면을 읽거나 복구하는 중이라 닫지 않았습니다. 잠시 뒤 다시 하세요.');
  documents.checkpoint();const tab=documents.active;
  if(!tab)throw Error('닫을 도면이 없습니다.');
  if(tab.dirty)throw Error('저장되지 않은 변경이 있어 닫지 않았습니다. cad_save 로 저장한 뒤 닫거나 그대로 두세요.');
  // 실제 닫기(closeDrawingTab)가 막힐 조건을 먼저 본다 — 열린 복구·설정 창 때문에 뒤에서 조용히 안 닫히는데 AI 에게는 '닫음'으로 알리던 것(7.0.41 설치 확인 2026-11-02).
  tabSwitchAllowed({allowAI});
  const sessionClosed=documents.tabs.length===1&&!!window.cadDesktop?.windowShortcut;
  return {result:{closed:true,session_closed:sessionClosed,drawingPath:tab.filePath||'',drawingName:tab.name},after:()=>closeDrawingTab(tab.id,{allowAI})};
 };
 window.cad.drawings={list:()=>{documents.checkpoint();return documents.tabs.map(({id,name,dirty})=>({id,name,dirty}));},active:()=>documents.activeId,select:selectDrawingTab,open:(doc,name)=>openDrawingTab(doc,name||nextDrawingName(),false),flush:flushDrawingRecovery};
 canvas.addEventListener('pointerup',scheduleDrawingRecovery);canvas.addEventListener('wheel',scheduleDrawingRecovery,{passive:true});
 // 여기까지 왔다는 건 정상 종료(또는 새로고침)라는 뜻이다. 강제 종료·정전은 이 자리를 못 밟는다.
 window.addEventListener('pagehide',()=>{if(localRecoveryTimer)flushLocalRecovery();flushDrawingRecovery().catch(()=>{});markCleanExit();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){if(localRecoveryTimer)flushLocalRecovery();flushDrawingRecovery().catch(()=>{});}});
 document.addEventListener('keydown',e=>{if(!e.ctrlKey||e.altKey||e.isComposing||document.querySelector('dialog[open]'))return;
  // 도면 칸마다 프로세스: 칸 안에 도면이 하나뿐이면 Ctrl+Tab·Ctrl+W 는 칸(창 안 탭)을 바꾸거나 닫고, Ctrl+Shift+S 는 모든 칸을 저장한다.
  const windowShortcut=globalThis.window?.cadDesktop?.windowShortcut;
  if(e.key==='Tab'){e.preventDefault();e.stopImmediatePropagation();if(windowShortcut&&documents.tabs.length<2){windowShortcut(e.shiftKey?'prev':'next');return;}safe(()=>{const i=documents.tabs.findIndex(t=>t.id===documents.activeId);selectDrawingTab(documents.tabs[(i+(e.shiftKey?-1:1)+documents.tabs.length)%documents.tabs.length].id);});}
  else if(e.key.toLowerCase()==='w'){e.preventDefault();e.stopImmediatePropagation();if(windowShortcut&&documents.tabs.length<2){windowShortcut('close');return;}closeDrawingTab(documents.activeId);}
  else if(e.key.toLowerCase()==='s'){e.preventDefault();e.stopImmediatePropagation();if(e.shiftKey&&windowShortcut)windowShortcut('saveAll');else if(e.shiftKey)saveAllDrawings();else saveNow();}
 },true);
}
// Shared picker/drop entry: preserve the active import and existing drawing tabs.
async function openDrawingFiles(input,{local=false}={}){
 let files=[...input];if(!files.length)return;
 const finishUnopened=items=>{for(const file of items)if(file.path)window.cadDesktop?.fileOpenFinished?.({path:file.path,ok:false});};
 // 탐색기·열기·끌어 놓기 모두 main의 빈 칸 재사용/중복 경로 검사로 보낸다.
 if(!local&&globalThis.window?.cadDesktop?.openInNewWindows){
  const paths=files.map(file=>file.path||window.cadDesktop.filePath?.(file)).filter(Boolean);
  if(paths.length===files.length){await window.cadDesktop.openInNewWindows(paths).catch(error=>toast('도면 열기 실패: '+error.message,true));return;}
 }
 if(busy||fileImportQueue.length){finishUnopened(files);toast('현재 도면 열기를 마친 뒤 파일을 추가해 주세요.',true);return;}
 if(files.some(file=>! /\.(dxf|dwg|bcad|json)$/i.test(file.name))){finishUnopened(files);toast('DWG, DXF, BCAD 도면 파일을 넣어 주세요. 다른 형식은 먼저 DXF로 변환해야 합니다.',true);return;}
 documents.checkpoint();
 const seen=new Set();files=files.filter(file=>{const key=drawingPathKey(file.path);if(!key)return true;const opened=documents.tabs.find(tab=>drawingPathKey(tab.filePath)===key);if(opened){selectDrawingTab(opened.id);for(const tab of [...documents.tabs])if(isEmptyDrawingTab(tab))documents.remove(tab.id);scheduleDrawingRecovery();finishUnopened([file]);return false;}if(seen.has(key))return false;seen.add(key);return true;});
 if(!files.length)return;
 const emptyCount=documents.tabs.filter(isEmptyDrawingTab).length;
 if(files.length>documents.limit-documents.tabs.length+emptyCount){finishUnopened(files);toast('최대 10개 도면을 열 수 있습니다. 열 파일 수를 줄이거나 사용하지 않는 탭을 닫으세요.',true);return;}
 fileImportQueue=files;await readNextDrawingFile();
}

async function importPreparedDrawingPath(target,{selected=false,recover=false}={}){
 const preparedStarted=performance.now();
 const prepare=selected?window.cadDesktop?.prepareSelectedDrawingImport:window.cadDesktop?.prepareDrawingImport;
 if(!prepare)return window.cadDesktop.importDrawingPath(target);
 const request=await prepare(target);
 if(request?.lock?.readOnly)toast(request.lock.message,true);   // 802: 다른 사람(AutoCAD 포함)이 연 도면
 const fetchStarted=performance.now();
 updateDrawingLoad(request.extension==='.dwg'?'DWG 변환 엔진을 시작하고 있습니다.':'DXF 분석 엔진을 시작하고 있습니다.',null,importSizeNotice({bytes:request.size||0}),'convert');   // S1: 변환 전에 크기 경고
 const stopQueueWatch=watchImportQueue({onProgress:p=>updateDrawingLoad(p.stage,null,importSizeNotice({bytes:request.size||0}))});   // S7: 앞선 변환 대기 안내
 let response;try{response=await fetch(request.endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-CAD-Token':request.token},body:JSON.stringify({path:request.path,extension:request.extension,...(recover?{recover:true}:{})})});}finally{stopQueueWatch();}
 const bodyStarted=performance.now();
 updateDrawingLoad('도면 객체를 화면에 전달하고 있습니다.',null,importSizeNotice({bytes:request.size||0}),'read');
 // S1: 줄 단위 스트림으로 받는다 — 100 MB 급 DXF(결과 600 MB+)도 한 문자열로 만들지 않는다.
 const result=await receiveImportStream(response,drawingOpenWait?.streamOptions);
 const parseStarted=performance.now();
 if(!response.ok)throw Error(result.error||'파일 변환 실패');
 result.report.cacheHit=response.headers.get('X-Barun-Import-Cache')==='hit';
 result.report.clientTimings_ms={prepare_request:Math.round((fetchStarted-preparedStarted)*1000)/1000,fetch_and_transfer:Math.round((bodyStarted-fetchStarted)*1000)/1000,body_read:Math.round((parseStarted-bodyStarted)*1000)/1000,json_parse:Math.round((performance.now()-parseStarted)*1000)/1000};
 return result;
}
// ACAD200-809: 복구해서 열기 — 같은 창에서 복구 읽기로 연다(원본 파일은 바꾸지 않는다).
let lastFailedOpen=null;
function openRecoveredDrawing({name,path,file}){
 const target=path||(file&&window.cadDesktop?.filePath?.(file))||'';
 if(!target||!window.cadDesktop?.prepareSelectedDrawingImport)throw Error('복구해서 열기는 데스크톱 앱에서 경로가 있는 도면만 할 수 있습니다.');
 lastFailedOpen=null;
 return openDrawingFiles([{name:name||target.split(/[\\/]/).at(-1),size:0,path:target,nativeImport:()=>importPreparedDrawingPath(target,{selected:true,recover:true})}],{local:true});
}
async function openExternalDrawingPaths(paths,options={}){
   const files=[];
  for(const target of paths||[]){
   try{
    const name=target.split(/[\\/]/).at(-1);
    if(window.cadDesktop?.importDrawingPath&&/\.(dxf|dwg)$/i.test(name)){
     files.push({name,size:0,path:target,nativeImport:()=>importPreparedDrawingPath(target)});continue;
    }
    const item=await window.cadDesktop.readExternalFile(target);
    const binary=atob(item.data);const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    files.push({name:item.name,size:item.size,path:target,arrayBuffer:async()=>bytes.buffer,text:async()=>new TextDecoder().decode(bytes)});
   }catch(error){window.cadDesktop?.fileOpenFinished?.({path:target,ok:false});toast('도면 열기 실패: '+drawingOpenErrorMessage(error),true);}
  }
   if(files.length)await openDrawingFiles(files,options);
}
if(window.cadDesktop?.externalReady&&window.cadDesktop?.readExternalFile){
 const receive=async paths=>{await drawingWorkspaceReady;return openExternalDrawingPaths(paths,{local:true});};
 window.cadDesktop.onExternalOpen(receive);
 window.cadDesktop.externalReady().then(receive).catch(error=>toast('도면 연결 실패: '+error.message,true));
}
$("file").multiple=true;
$("file").onchange=async event=>{
 const files=[...event.target.files];event.target.value='';await openDrawingFiles(files);
};
document.addEventListener('dragover',event=>{
 if(!Array.from(event.dataTransfer?.types||[]).includes('Files'))return;
 event.preventDefault();event.dataTransfer.dropEffect='copy';
});
document.addEventListener('drop',event=>{
 if(!Array.from(event.dataTransfer?.types||[]).includes('Files')&&!event.dataTransfer?.files?.length)return;
 event.preventDefault();
 void openDrawingFiles(event.dataTransfer.files);
});
// End shared picker/drop entry.
async function readNextDrawingFile(){
 const file=fileImportQueue.shift();if(!file)return;
 const openingPath=file.path||(window.cadDesktop?.filePath&&file instanceof File?window.cadDesktop.filePath(file):'')||'';let importSucceeded=false;
  const openStarted=performance.now();
  busy = true;
  beginDrawingLoad(file.name);
  updatePrompt();
  try {
    const nativeImport=file.nativeImport||(window.cadDesktop?.prepareSelectedDrawingImport&&window.cadDesktop?.filePath&&/\.(dxf|dwg)$/i.test(file.name)?()=>importPreparedDrawingPath(window.cadDesktop.filePath(file),{selected:true}):window.cadDesktop?.importDrawingFile&&/\.(dxf|dwg)$/i.test(file.name)?()=>window.cadDesktop.importDrawingFile(file):null);
    if(!nativeImport&&file.size>250_000_000)throw Error("브라우저에서는 250 MB 이하의 도면을 선택하세요.");
    const ext = "." + file.name.split(".").at(-1).toLowerCase();
    if ([".bcad", ".json"].includes(ext)) {
      updateDrawingLoad('BCAD 내용을 읽고 검사하고 있습니다.',null,'','read');
      const doc = JSON.parse(await file.text());
      engine.validate(doc);
      nextOpenFilePath=file.path||(window.cadDesktop?.filePath&&file instanceof File?window.cadDesktop.filePath(file):'')||'';
      importSucceeded=await applyDrawingImport(
        {
          document: doc,
          report: {
            sourceFormat: "BCAD 백업",
            imported: doc.entities.length,
            sourceUnits: 4,
            unitScaleToMM: 1,
            nativeMetadata: true,
            skipped: {},
            converted: {},
            warnings: [],
          },
        },
        file.name,
      );
    } else if ([".dxf", ".dwg"].includes(ext)) {
      if (!nativeImport&&file.size > 250_000_000)
        throw Error("브라우저에서는 250 MB 이하의 도면을 선택하세요.");
      toast(
        ext === ".dwg"
          ? "DWG를 로컬 변환 엔진에서 읽고 있습니다."
          : "DXF 도형과 단위를 분석하고 있습니다.",
      );
      updateDrawingLoad(ext==='.dwg'?'DWG를 DXF로 변환하고 있습니다.':'DXF 객체와 문자 정보를 분석하고 있습니다.',null,'파일 크기와 객체 수에 따라 시간이 걸릴 수 있습니다.','convert');
      const result = nativeImport ? await nativeImport() : await requestDrawingImport(ext,await file.arrayBuffer());
      result.report.clientTimings_ms={...(result.report.clientTimings_ms||{}),open_started_at:openStarted};
      updateDrawingLoad('분석 결과와 객체 목록을 준비하고 있습니다.',null,'','read');
      nextOpenFilePath=file.path||(window.cadDesktop?.filePath&&file instanceof File?window.cadDesktop.filePath(file):'')||'';
      importSucceeded=(await applyDrawingImport(result, file.name))===true;
      if(importSucceeded)studio.context.afterDrawingOpened?.(result.report);
    } else
      throw Error(
        "지원 형식은 DXF, DWG(변환기 필요), BCAD 백업입니다. DXG 확장자는 DXF인지 확인하세요.",
      );
  } catch (e) {
    nextOpenFilePath='';lastFailedOpen=openingPath&&typeof recoveryCandidate==='function'&&recoveryCandidate(file.name,e)?{name:file.name,path:openingPath}:null;
    toast("열기 실패: " + drawingOpenErrorMessage(e)+(lastFailedOpen?' · 손상된 도면이면 DWGRECOVER 로 복구해서 열 수 있습니다(원본 유지).':''), true);
  } finally {
    endDrawingLoad();
    busy = false;
    if(!importSucceeded)nextOpenFilePath='';
    if(openingPath)window.cadDesktop?.fileOpenFinished?.({path:openingPath,ok:importSucceeded===true});
    updatePrompt();
    if(fileImportQueue.length)setTimeout(()=>readNextDrawingFile(),0);
  }
}
async function applyDrawingImport(result, name) {
    const p = { ...result, name };let doc = p.document;
    // Unspecified units retain the previous default: one drawing unit is one mm.
    const applyStarted=performance.now(),clientTimings=p.report.clientTimings_ms||(p.report.clientTimings_ms={});
    S4.rememberImportReport(p.report); // FLATTEN 이 "열 때 높이를 눌렀다"는 기록을 보여 준다
    beginDrawingLoad(p.name);drawingOpenWait?.streamProgress({stage:'도면 객체를 받았습니다.',entities:doc.entities.length,expected:doc.entities.length,percent:1});drawingOpenWait?.setLayers(doc.layers);drawingOpenWait?.onEntities?.(doc.entities,doc.entities.length);updateDrawingLoad('편집 가능한 객체로 준비하고 있습니다.',null,`${p.report.imported.toLocaleString()}개 객체`,'blocks');
    toast(`${p.report.imported.toLocaleString()}개 객체를 화면에 올리고 있습니다.`);
    // Let the progress message paint before validation/rendering starts.
    await loadPaint();await loadPaint();
    let opened=false;
    try {
      const blockStarted=performance.now();
      const keepSharedReferences=!!doc.sharedBlocks;
      if(keepSharedReferences){
        updateDrawingLoad('반복 블록 참조를 빠르게 준비하고 있습니다.',null,`${doc.entities.length.toLocaleString()}개 참조`,'blocks');
        G.prepareSharedDrawingReferences(doc);
      }else await G.expandSharedDrawingBlocksAsync(doc,{chunkSize:1000,pause:loadPaint,onProgress:(done,total)=>updateDrawingLoad('반복 블록과 편집 객체를 준비하고 있습니다.',total?done/total*100:null,`${done.toLocaleString()} / ${total.toLocaleString()}개`)});
      clientTimings.block_prepare=Math.round((performance.now()-blockStarted)*1000)/1000;
      updateDrawingLoad('도면 크기와 첫 화면 위치를 계산하고 있습니다.',null,`${doc.entities.length.toLocaleString()}개 객체`,'screen');
      await loadPaint();
      updateDrawingLoad('도면 구조와 편집 가능 여부를 검사하고 있습니다.',null,`${doc.entities.length.toLocaleString()}개 객체`);
      await loadPaint();const renderPrepareStarted=performance.now();engine.validate(doc);
      const importedName=p.name.replace(/\.(dxf|dwg|bcad|json)$/i, "");
      // Layer names are settled before the shared display trees are retained:
      // their style key includes the layer table.
      const migration=prepareLegacyLayerMigration(doc);doc=migration.doc;
      const sharedDisplayStarted=performance.now();
      const sharedDisplays=await prepareSharedDisplayAsync(doc,(done,total)=>updateDrawingLoad('반복 블록 화면을 준비하고 있습니다.',total?done/total*100:null,`${done.toLocaleString()} / ${total.toLocaleString()}개`));
      clientTimings.shared_display=Math.round((performance.now()-sharedDisplayStarted)*1000)/1000;
      openDrawingTab(doc,importedName,!!migration.changed,{layerMigration:migration,allowDialog:true,allowBusy:true,replaceEmpty:true,adoptDocument:true,engineValidated:true});
      sharedDisplays.length=0;   // visible() now holds the retained trees
      clientTimings.render_prepare=Math.round((performance.now()-renderPrepareStarted)*1000)/1000;
      updateDrawingLoad('빠른 선택을 위한 화면 인덱스를 준비하고 있습니다.',null,`${doc.entities.length.toLocaleString()}개 객체`);
      await loadPaint();const selectionIndexStarted=performance.now();
      // Large drawings: resolve the whole-document pick set in slices; the GPU
      // build then reuses it instead of expanding every shared block again.
      await preparePickCandidatesAsync((done,total)=>updateDrawingLoad('선택·스냅 후보를 준비하고 있습니다.',total?done/total*100:null,`${done.toLocaleString()} / ${total.toLocaleString()}개`));
      prepareNearbyIndexNow();
      clientTimings.selection_index=Math.round((performance.now()-selectionIndexStarted)*1000)/1000;
      // 가려진 창은 그리지 않으므로 첫 화면은 다시 보일 때 그린다 — 도면 열기(MCP 포함)는 여기서 끝낸다.
      if(!document.hidden)await waitForPaint();else{needsInitialFit=true;hiddenFitPending=true;}
      // A heavy first scene is built across frames; report its progress.
      for(let frames=0;!document.hidden&&gpuView.stats.workerPending&&gpuView.stats.buildProgress&&frames<100000;frames++){
        const b=gpuView.stats.buildProgress,label=GPU_BUILD_LABELS[b.phase]||'첫 화면을 준비하고 있습니다.';
        updateDrawingLoad(label,b.total?b.done/b.total*100:null,b.total?`${b.done.toLocaleString()} / ${b.total.toLocaleString()}`:'');
        await waitForPaint();
      }
      clientTimings.first_valid_frame_from_open=Math.round((performance.now()-(clientTimings.open_started_at||applyStarted))*1000)/1000;
      opened=true;
      updateDrawingLoad('첫 화면을 표시했습니다.',100);
      const decompositionNotes=[];
      if(p.report.decomposed?.ACAD_TABLE)decompositionNotes.push(`표 ${p.report.decomposed.ACAD_TABLE.toLocaleString()}개 → 선·글자로 바꿈`);
      if(p.report.decomposed?.REGION)decompositionNotes.push(`영역(REGION) ${p.report.decomposed.REGION.toLocaleString()}개 → 닫힌 폴리선으로 바꿈`);
      // 배치 탭에만 있는 글자는 모형 공간만 그리는 이 화면에 안 보인다(10-25 글자 전수 검사) → 열 때 알린다. 배치는 원본 그대로 보존된다.
      const paperText=(p.report.paperSpaceText?.layouts||[]).filter(l=>l.text||l.dimension||l.leader);
      if(paperText.length)decompositionNotes.push(`배치 탭에만 있는 글자 ${paperText.reduce((n,l)=>n+l.text,0).toLocaleString()}개·치수 ${paperText.reduce((n,l)=>n+l.dimension,0).toLocaleString()}개는 화면에 보이지 않습니다(${paperText.map(l=>l.name).join(', ')} · 원본 배치는 보존)`);
      toast("도면 가져오기 완료. 원본 파일은 보존되었습니다."+(decompositionNotes.length?' · '+decompositionNotes.join(' · '):''));
    } catch(error) {
      toast('열기 실패: '+error.message,true);
    } finally {
      if(opened){clientTimings.first_editable_from_open=Math.round((performance.now()-(clientTimings.open_started_at||applyStarted))*1000)/1000;rememberDrawingPerformance(p.name,p.report);}
    }
    return opened;
}

function commandSearchTerms(c){return [c.name,c.label,LEGACY_LABELS[c.name],...koreanNamesFor(c.name),...aliasesOf(settings,c.name),settings.hotkeys[c.name],{WINDOW:'창문 창호',DOOR:'출입문 문짝',STRETCH:'스트레치 스크레치 늘이기 늘리기',INSULATION:'단열재 단열제',SETTINGS:'설정 단축키 별칭',ISOLATEOBJECTS:'객체만 보이기 객체만 켜기 선택만 남기기 격리 isolate',HIDE:'감추기 끄기 숨김',SHOWALL:'모두 켜기 다시 보이기 숨김 해제 격리 해제 unisolate',LAYISO:'레이어만 켜기 레이어 격리 isolate'}[c.name],c.name.startsWith('DIM')?'치수선 치수':''].filter(Boolean).join(' ');}
const visibleCommands=()=>COMMANDS.filter(c=>!Object.hasOwn(MENU_COMPAT_ALIASES,c.name));
function filterCommands(rootId,searchId,countId){
 const query=$(searchId).value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);let matches=0;
 const rows=[...$(rootId).children].filter(row=>!row.classList.contains('help-group-title'));
 for(const row of rows){const text=(row.textContent+' '+(row.dataset.searchTerms||'')+' '+[...row.querySelectorAll('input')].map(i=>i.value).join(' ')).toLocaleLowerCase();row.hidden=!query.every(word=>text.includes(word));if(!row.hidden)matches++;}
 // 분류 제목은 보이는 항목이 하나라도 있을 때만 남긴다.
 for(const title of $(rootId).querySelectorAll('.help-group-title')){const key=title.dataset.helpGroup;title.hidden=!rows.some(row=>row.dataset.helpGroup===key&&!row.hidden);}
 $(countId).textContent=matches?`${matches}개 명령`:'검색 결과가 없습니다. 다른 이름이나 별칭으로 검색하세요.';
}
$('settings-search').oninput=()=>filterCommands('alias-rows','settings-search','settings-search-count');
$('help-search').oninput=()=>filterCommands('help-content','help-search','help-search-count');
// 도움말 '설명서 열기' 줄: 설명서·리습 단축키는 홈페이지에 있다. 인터넷이 없으면 열지 않고 알린다(2026-10-28 시안 승인).
document.querySelector('#help-dialog .help-manual')?.addEventListener('click',e=>{if(e.target.closest('a')&&navigator.onLine===false){e.preventDefault();toast('인터넷 연결 뒤 다시 누르세요 — 설명서는 홈페이지(barunarc.co.kr)에 있습니다.',true);}});
function settingsRows(value) {
  $("alias-rows").replaceChildren();
  for (const c of visibleCommands()) {
    const tr = document.createElement("tr");
    tr.dataset.searchTerms=commandSearchTerms(c);
    for (const text of [c.name, c.label]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    for (const [key, val] of [
      ["alias", aliasFieldText(value, c.name)],
      ["hotkey", value.hotkeys[c.name] || ""],
    ]) {
      const td = document.createElement("td"),
        input = document.createElement("input");
      input.dataset.commandName = c.name;
      input.dataset.setting = key;
      input.value = val;
      input.setAttribute(
        "aria-label",
        c.name + " " + (key === "alias" ? "별칭" : "단축키"),
      );
      // 고친 자리에서 Enter 로 바로 저장한다. 겹침을 고칠 때 마우스로 내려갈 필요가 없다.
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          $("settings-save").click();
        }
      });
      // 저장할 때까지 기다리지 않고, 치는 순간 겹치는 칸을 표시한다.
      input.addEventListener("input", markSettingsClashes);
      td.append(input);
      tr.append(td);
    }
    $("alias-rows").append(tr);
  }
}
function showSettings() {
 if(!document.getElementById('ai-follow-view-setting')){
  const label=document.createElement('label');label.id='ai-follow-view-setting';label.style.display='block';
  const input=document.createElement('input');input.type='checkbox';input.checked=aiFollowView;input.onchange=()=>{aiFollowView=input.checked;try{localStorage.setItem(aiFollowViewKey,aiFollowView?'1':'0');}catch{}};
  label.append(input,' AI가 그릴 때 결과를 화면에 맞추기');$('settings-search').before(label);
 }
 if(!document.getElementById('alias-profile')){
  const label=document.createElement('label');label.textContent='단축 프로필 ';const select=document.createElement('select');select.id='alias-profile';select.setAttribute('aria-label','단축 프로필');
  for(const [value,text] of [['','현재 설정 유지'],['office','한국사무소 · C 복사 / CI 원 / F 모깎기 / P 팬 / S 늘리기'],['standard','일반 제도 · C 원 / CO 복사 / F 모깎기 / P 팬 / S 늘리기'],['legacy','기존 바른CAD 기본값']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
  select.onchange=()=>{if(select.value){settingsRows({aliases:aliasProfile(select.value),hotkeys:settings.hotkeys});$('settings-error').textContent='프로필을 채웠습니다. 저장을 눌러 적용하세요. 기존 설정은 저장 전까지 유지됩니다.';}};
  label.append(select);$('settings-search').before(label);
 }
 $('alias-profile').value='';
  $('settings-search').value='';settingsRows(settings);$('settings-search').oninput();
  $("settings-error").textContent = "";
  $("settings-dialog").showModal();$("settings-search").focus();
}
function showCommandShortcut(commandName) {
  showSettings();
  const rows=[...$("alias-rows").children];
  for(const row of rows)row.hidden=row.children[0]?.textContent!==commandName;
  $("settings-search-count").textContent=`${commandName} 명령의 별칭과 즉시 단축키를 수정합니다.`;
  const alias=[...document.querySelectorAll('[data-setting="alias"]')].find(input=>input.dataset.commandName===commandName);
  requestAnimationFrame(()=>{alias?.focus();alias?.select();});
}
$("settings-default").onclick = () => {
  settingsRows({ aliases: defaultAliases(), hotkeys: defaultHotkeys() });
  $("settings-error").textContent =
    "기본값을 채웠습니다. 저장을 눌러 적용하세요.";
};
// 설정 창 칸 → 저장 초안. 별칭 칸의 "C, CP"는 첫 것이 대표 별칭(aliases), 나머지는 extraAliases.
function settingsDraftFromFields() {
  const draft = { version: 1, aliases: {}, hotkeys: {} };
  document.querySelectorAll("[data-setting]").forEach((e) => {
    if (e.dataset.setting === "alias") putAliasField(draft, e.dataset.commandName, e.value);
    else draft.hotkeys[e.dataset.commandName] = e.value.trim();
  });
  return draft;
}
$("settings-save").onclick = () => {
  try {
    const draft = settingsDraftFromFields();
    validateSettings(draft);
    localStorage.setItem(settingsKey, JSON.stringify(draft));
    settings = draft;
    $("settings-dialog").close();
    toolButtons();
    toast("명령 별칭/단축키를 저장했습니다. 다음 실행에서도 복구됩니다.");
  } catch (e) {
    $("settings-error").textContent = userErrorMessage(e);
    if (e.conflict) showSettingsConflict(e.conflict);
  }
};
// 설정 창에서 같은 값을 쓴 칸을 표시한다. 저장을 눌러 보기 전에 눈으로 알 수 있어야 한다.
function markSettingsClashes() {
  let clashes = 0;
  for (const kind of ["alias", "hotkey"]) {
    const fields = [...document.querySelectorAll(`[data-setting=${kind}]`)];
    const owners = new Map();
    for (const field of fields)
      for (const key of fieldTokens(kind, field.value))
        owners.set(key, [...(owners.get(key) || []), field]);
    for (const field of fields) {
      const group = [...new Set(fieldTokens(kind, field.value).flatMap((key) => owners.get(key) || []))];
      const clash = group.length > 1;
      field.classList.toggle("clash", clash);
      field.setAttribute("aria-invalid", String(clash));
      field.title = clash
        ? group.map((f) => f.dataset.commandName).join(", ") + " 가 같은 값을 씁니다."
        : "";
      if (clash) clashes++;
    }
  }
  const note = $("settings-error");
  if (clashes) note.dataset.clash = "1";
  else if (note.dataset.clash) { note.textContent = ""; delete note.dataset.clash; }
  return clashes;
}
// 겹쳤을 때 '겹칩니다'만 말하고 끝내지 않는다. 겹친 두 명령만 남겨 보여 주고,
// 비우거나 다른 값으로 바꿔 바로 저장할 수 있게 한다.
function showSettingsConflict({ kind, value, holder, wanted }) {
  const what = kind === "alias" ? "별칭" : "단축키";
  const fieldOf = (name) =>
    [...document.querySelectorAll(`[data-setting=${kind}]`)].find(
      (input) => input.dataset.commandName === name,
    );
  // 검사기는 먼저 만난 쪽을 '주인'이라고 부르지만, 사용자가 방금 바꾼 쪽이 진짜 '새 주인'이다.
  const savedText = (name) => (kind === "alias" ? aliasFieldText(settings, name) : settings.hotkeys[name] || "");
  const same = (a, b) => fieldTokens(kind, a).join(",") === fieldTokens(kind, b).join(",");
  const justTyped = [holder, wanted].find((name) => !same(fieldOf(name)?.value, savedText(name)));
  const owner = justTyped === holder ? wanted : holder;   // 자리를 비켜 줘야 하는 쪽
  const taker = justTyped || wanted;                      // 그 값을 갖고 싶어 하는 쪽

  // 검색으로 거르면 글자가 들어간 명령이 수십 개 나온다. 겹치는 둘만 남긴다.
  $("settings-search").value = "";
  for (const row of $("alias-rows").children)
    row.hidden = ![owner, taker].includes(row.children[0].textContent);
  $("settings-search-count").textContent = `겹치는 명령 2개 · 검색창에 입력하면 전체 목록으로 돌아갑니다`;

  const field = fieldOf(owner);
  const box = $("settings-error");
  box.textContent = `${value} ${what}은 ${owner}가 쓰고 있습니다. ${taker}에 주려면 ${owner}의 ${what}을 바꾸거나 비우세요. 고친 뒤 Enter를 누르면 저장됩니다.`;
  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = kind === "alias" ? `${owner}에서 ${value} 빼기` : `${owner} ${what} 비우기`;
  clear.onclick = () => {
    if (field) field.value = kind === "alias" ? withoutAliasToken(field.value, value) : "";
    $("settings-save").click();
  };
  box.append(" ", clear);
  box.dataset.clash = "1";
  if (field) {
    field.focus();
    field.select();
  }
  markSettingsClashes();
}
$("settings-export").onclick = () =>
  download(JSON.stringify(settings, null, 2), "바른CAD_명령설정.json");
$("settings-import").onclick = () => $("settings-file").click();
$("settings-file").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    const data = validateSettings(migrateAliasSettings(JSON.parse(await file.text())));
    settingsRows(data);
    $("settings-error").textContent = "가져온 설정을 확인한 뒤 저장하세요.";
  } catch (err) {
    $("settings-error").textContent = userErrorMessage(err);
  } finally {
    e.target.value = "";
  }
};
/* AutoCAD 단축키 파일(acad.pgp) 가져오기·내보내기(pgp-aliases.js). JSON 가져오기/내보내기 옆에 둔다.
   가져오기는 설정 창 칸에 합쳐 보여 주기만 하고, 저장은 '검사 후 저장'으로 한다(JSON 가져오기와 같다). */
{
  const note = document.createElement("p");
  note.className = "muted";
  note.textContent = "별칭은 쉼표로 여러 개 넣을 수 있습니다(예: C, CP). AutoCAD acad.pgp 파일을 가져오거나 내보낼 수 있습니다.";
  $("settings-search").before(note);
  const pgpFile = document.createElement("input");
  pgpFile.type = "file";
  pgpFile.id = "settings-pgp-file";
  pgpFile.accept = ".pgp,.txt";
  pgpFile.hidden = true;
  const importPgp = document.createElement("button"), exportPgp = document.createElement("button");
  importPgp.id = "settings-pgp-import";
  importPgp.textContent = "acad.pgp 가져오기";
  exportPgp.id = "settings-pgp-export";
  exportPgp.textContent = "acad.pgp 내보내기";
  $("settings-export").after(importPgp, exportPgp);
  $("settings-file").after(pgpFile);
  exportPgp.onclick = () =>
    download(serializePgp(aliasMapFromSettings(settings, visibleCommands().map((c) => c.name))), "바른CAD_acad.pgp", "text/plain;charset=utf-8");
  importPgp.onclick = () => pgpFile.click();
  pgpFile.onchange = async (e) => {
    try {
      const file = e.target.files[0];
      if (!file) return;
      const parsed = parsePgp(await file.text());
      if (!parsed.entries.length) throw Error('acad.pgp 에서 "별칭, *명령" 줄을 찾지 못했습니다.');
      const base = validateSettings(settingsDraftFromFields());
      const plan = planPgpImport(parsed.entries, {
        commands: COMMANDS.map((c) => c.name),
        current: base,
        protectedNames: Object.keys(MENU_INSTALLED_COMMANDS),
        redirect: MENU_COMPAT_ALIASES,
        origin: parsed.origin,
        resolve: (alias) => resolveCommand(alias, base),
      });
      const show = (takeOver) => {
        settingsRows(validateSettings(applyPgpPlan(base, plan, { takeOver })));
        $("settings-search").value = "";
        $("settings-search").oninput();
        const box = $("settings-error");
        box.textContent = pgpImportSummary(parsed, plan, { takeOver }) + " 확인한 뒤 '검사 후 저장'을 누르세요.";
        const taken = plan.conflicts.filter((item) => item.takeable).length;
        if (taken && !takeOver) {
          const move = document.createElement("button");
          move.type = "button";
          move.textContent = `겹친 별칭 ${taken}개도 acad.pgp 대로 옮기기`;
          move.onclick = () => show(true);
          box.append(" ", move);
        }
      };
      show(false);
    } catch (err) {
      $("settings-error").textContent = userErrorMessage(err);
      if (err.conflict) showSettingsConflict(err.conflict);
    } finally {
      e.target.value = "";
    }
  };
}
/* 도움말 분류: 메뉴 카탈로그(파일·작업·건축…)의 절 이름을 그대로 쓴다. 기본 작도·편집 명령을 먼저, 보조명령 카드는 뒤에 둔다.
   카탈로그에 없는 명령은 "그 밖의 명령"으로 모은다. */
const HELP_GROUP_ORDER=['work','file','arch','convert','settings','ai'];
function helpGroups(){
  const commands=visibleCommands(),byName=new Map(commands.map(c=>[c.name,c])),placed=new Set(),groups=[];
  const menus=Object.entries(MENU_CATALOG).sort(([a],[b])=>{const ia=HELP_GROUP_ORDER.indexOf(a),ib=HELP_GROUP_ORDER.indexOf(b);return (ia<0?99:ia)-(ib<0?99:ib);});
  for(const [key,menu] of menus)for(const section of menu.sections||[]){
    const list=section.commands.map(name=>byName.get(name)).filter(c=>c&&!placed.has(c.name));
    if(!list.length)continue;
    list.forEach(c=>placed.add(c.name));
    groups.push({key:`${key}-${groups.length}`,title:`${menu.label} · ${section.label}`,commands:list});
  }
  const rest=commands.filter(c=>!placed.has(c.name));
  if(rest.length)groups.push({key:'etc',title:'그 밖의 명령',commands:rest});
  return groups;
}
function showHelp() {
  const root = $("help-content");
  root.className = "help-grid help-grouped";
  root.replaceChildren();
  for (const group of helpGroups()) {
    const heading=document.createElement("h3");heading.className="help-group-title";heading.textContent=`${group.title} · ${group.commands.length}개`;heading.dataset.helpGroup=group.key;
    root.append(heading);
    for (const c of group.commands) {
      const b = document.createElement("button"),
        code = document.createElement("code"),
        label = document.createElement("span");
      b.dataset.searchTerms=commandSearchTerms(c);b.dataset.helpGroup=group.key;
      code.textContent = `${aliasFieldText(settings, c.name) || "—"} · ${c.name}`;
      label.textContent = c.label;
      b.append(code, label);
      b.onclick = () => {
        $("help-dialog").close();
        run(c.name);
      };
      root.append(b);
    }
  }
  $("help-search").value="";$("help-search").oninput();$("help-dialog").showModal();$("help-search").focus();
}
function form(title, fields, onApply, onCancel=null) {
  form.session=(form.session??0)+1;form.onCancel=typeof onCancel==='function'?onCancel:null;
  const dialog=$('form-dialog');dialog.classList.remove('architectural-detail','plot-settings-dialog');
  const formActions=dialog.querySelector('.dialog-actions'),submit=formActions.querySelector('[type="submit"]');
  formActions.querySelectorAll('[data-temporary-form-action]').forEach(button=>button.remove());
  if(submit)submit.textContent='적용';
  $("form-title").textContent = title;
  $("form-fields").replaceChildren();
  $("form-error").textContent = "";
  let advancedBody = null;
  for (const field of fields) {
    // 구역 제목(field.heading)과 접이식 "고급" 묶음(field.advanced), 읽기 전용 줄(field.readonly)은 속성 창이 쓴다.
    if (field.heading) {
      const heading = document.createElement("div");
      heading.className = "form-heading";
      heading.setAttribute("role", "heading");
      heading.setAttribute("aria-level", "3");
      heading.textContent = field.heading;
      $("form-fields").append(heading);
      continue;
    }
    const label = document.createElement("label");
    label.className = "form-row" + (field.readonly ? " is-readonly" : "");
    const text = document.createElement("span");
    text.textContent = field.label;
    const control = document.createElement(
      field.type === "textarea"
        ? "textarea"
        : field.options
          ? "select"
          : "input",
    );
    control.name = field.name;
    control.setAttribute("aria-label", field.label);
    if (field.options)
      for (const [value, title] of field.options) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = title;
        control.append(option);
      }
    else if (field.type !== "textarea") {
      control.type = field.type || "text";
      if (field.type === "number") control.step = "any";
    }
    if (control.type === "checkbox") {
      // 체크박스 규칙은 form-controls.js(checked 는 field.value 로, value 는 항상 'on').
      const state = checkboxState(field);
      control.checked = state.checked;
      control.value = state.value;
    } else control.value = field.value ?? "";
    if (field.placeholder) control.placeholder = field.placeholder;
    if (field.readonly) { control.readOnly = true; control.setAttribute("aria-readonly", "true"); if (control.tagName === "SELECT") control.disabled = true; }
    label.append(text, control);
    if (field.advanced) {
      if (!advancedBody) {
        const details = document.createElement("details");
        details.className = "form-advanced";
        const summary = document.createElement("summary");
        summary.textContent = typeof field.advanced === "string" ? field.advanced : "고급 (위치)";
        advancedBody = document.createElement("div");
        advancedBody.className = "form-advanced-body";
        details.append(summary, advancedBody);
        $("form-fields").append(details);
      }
      advancedBody.append(label);
    } else $("form-fields").append(label);
  }
  formApply = onApply;
  if(!dialog.open)dialog.showModal();
}
$("property-form").onsubmit = async (e) => {
  e.preventDefault();
  const session=form.session;form.appliedSession=session;
  try {
    await formApply(Object.fromEntries(new FormData(e.target)));
    if(session!==form.session)return;
    $("form-dialog").close();
    refresh();
  } catch (error) {
    if(session!==form.session)return;
    form.appliedSession=null;
    $("form-error").textContent = userErrorMessage(error);
  }
};
function openArchitecturalDetail(command,existing=null){
 if(!existing)lastCommand=command;
 if(command==='TBOX'&&!existing&&chosen().length&&chosen().every(e=>e.type==='text')){const ids=chosen().map(e=>e.id);form('선택 문자에 테두리 그리기',[{name:'padding',label:'문자 바깥 여백 (mm)',type:'number',value:chosen()[0].height/2}],v=>{const padding=Number(v.padding);if(!Number.isFinite(padding)||padding<0)throw Error('여백은 0 이상입니다.');const es=engine.selected(ids);addEntities(es.map(e=>{const b=G.bounds([e]);return {type:'polyline',closed:true,layer:e.layer,points:G.rectangle({x:b.minX-padding,y:b.minY-padding},{x:b.maxX+padding,y:b.maxY+padding})};}));});return;}

 const hostLines=!existing&&['DOD','WID'].includes(command)&&chosen().length===2&&chosen().every(e=>e.type==='line')?chosen().map(e=>e.id):null;if(hostLines)parallelWallPair(engine.selected(hostLines));
 let recent={};try{recent=JSON.parse(localStorage.getItem('barun-detail-'+command)||'{}');}catch{}
 const spec=ARCH_LIBRARY[command],saved=existing?.parameters||{},base={...detailDefaults(command),...recent,...saved,...(!existing&&command==='EED'&&chosen().length?{positions:[...new Set(chosen().flatMap(G.vertices).map(p=>p.x))].sort((a,b)=>a-b).join(',')}:{})},fields=spec.fields.map(f=>({...f,value:base[f.name]}));
 fields.push({name:'rotation',label:'회전 (도)',type:'number',value:base.rotation||0});
 const build=values=>{const options={...base,...values,x:existing?.position?.x||0,y:existing?.position?.y||0};if(existing?.lineWallHost||hostLines){const pair=parallelWallPair(existing?.lineWallHost?.sources||engine.selected(hostLines));options.rotation=G.angle(pair.u);options.depth=Math.abs(pair.offset);}if(existing?.hostWall){const wall=engine.doc.entities.find(e=>e.id===existing.hostWall);if(wall)return {...wallOpening(spec.kind,options,wall,existing.position,existing.layer),libraryCommand:command};}return architecturalDetail(command,options,existing?.layer||(command==='EED'&&engine.doc.layers.find(l=>l.name==='A-ELEV-VIEW')?.id)||activeLayer);};
 const read=()=>Object.fromEntries(fields.map(f=>{const input=$('form-fields').querySelector(`[name="${f.name}"]`);return [f.name,f.type==='number'?Number(input.value):input.value];}));
 form(spec.label+(existing?' 수정':hostLines?' · 선택한 벽선에 개구부와 함께 삽입':' · 설정 후 도면 클릭'),fields,()=>{if(command==='EED'&&!existing)ensureLayerByName('A-ELEV-VIEW','#9ad0ff'); /* 에너지 입면 전개는 입면 레이어(바른 레이어 세트) */const values=read(),entity=build(values);try{localStorage.setItem('barun-detail-'+command,JSON.stringify(values));}catch{}if(existing?.lineWallHost){const host=existing.lineWallHost,current=engine.selected(host.parts.map(e=>e.id));if(JSON.stringify(current.map(e=>e.points))!==JSON.stringify(host.parts.map(e=>e.points)))throw Error('연결 벽선이 별도로 수정되었습니다. 기존 개구부를 확인한 뒤 창호를 다시 배치하세요.');const pair=parallelWallPair(host.sources);if(G.distanceToSegment(existing.position,...pair.center)>.01)throw Error('창호가 원래 벽선에서 이동했습니다. 다시 배치하세요.');const offset=G.dot(G.sub(existing.position,pair.center[0]),pair.u),parts=wallLineOpening(host.sources,offset,values.width).map(e=>({...e,id:crypto.randomUUID()}));const rebuilt=architecturalDetail(command,{...values,x:existing.position.x,y:existing.position.y,rotation:G.angle(pair.u),depth:Math.abs(pair.offset)},existing.layer),{type,...changes}=rebuilt;changes.lineWallHost={sources:host.sources,parts:structuredClone(parts)};execute({type:'linewall.place',ids:[...host.parts.map(e=>e.id),existing.id],doorId:existing.id,entity:{...existing,...changes},parts,sources:host.sources});}else if(existing){const {type,id,...changes}=entity;execute({type:'update',ids:[existing.id],changes});}else{reset();mode='ARCHPLACE';phase='point';params={library:command,kind:spec.kind||command,label:spec.label,options:values,hostLines};updatePrompt();render();canvas.focus();}});
 $('form-dialog').classList.add('architectural-detail');
 const preview=document.createElement('canvas');preview.width=600;preview.height=260;preview.style.cssText='width:100%;max-height:260px;background:#101820';preview.setAttribute('aria-label','건축 작도 미리보기');$('form-fields').prepend(preview);const direction=document.createElement('p');direction.className='detail-direction';direction.textContent='기준점: 경첩/삽입 위치 · 회전 0°: 오른쪽 진행 · 왼쪽 열림: 위쪽';preview.after(direction);
 const redraw=()=>{try{const entity=build(read()),box=fitPreviewCanvas(preview),b=G.bounds([entity]);
  const k=Math.min((box.width-32)/Math.max(1,b.maxX-b.minX),(box.height-32)/Math.max(1,b.maxY-b.minY));
  drawEntity(box.context,entity,p=>({x:box.width/2+(p.x-(b.minX+b.maxX)/2)*k,y:box.height/2-(p.y-(b.minY+b.maxY)/2)*k}),k,'#afe7d1');
  $('form-error').textContent='';}catch(e){$('form-error').textContent=userErrorMessage(e);}};
 // 화면에 자리를 잡은 뒤의 실제 크기로 한 번 더 그린다. 처음 그릴 때는 아직 크기가 0 일 수 있다.
 requestAnimationFrame(redraw);
 if(window.ResizeObserver)new ResizeObserver(()=>redraw()).observe(preview);
 if(existing?.lineWallHost||hostLines){const pair=parallelWallPair(existing?.lineWallHost?.sources||engine.selected(hostLines));for(const [name,value] of [['rotation',G.angle(pair.u)],['depth',Math.abs(pair.offset)]]){const input=$('form-fields').querySelector(`[name="${name}"]`);if(input){input.value=value;input.disabled=true;input.title='선택한 벽선의 방향과 두께를 따릅니다.';}}}
 for(const input of $('form-fields').querySelectorAll('input,select'))input.addEventListener('input',redraw);redraw();
}
function editArchitecture(e){
 const kind=e.parameters.kind,o=e.parameters,fields=[],number=(name,label,value)=>fields.push({name,label,value,type:'number'}),choice=(name,label,value,options)=>fields.push({name,label,value,options});
 fields.push({name:'mark',label:'번호 / 이름',value:o.mark||e.attributes?.mark||''});
 if(kind!=='STAIR'){
  choice('style','종류',o.style||(kind==='DOOR'?'single':'fixed'),kind==='DOOR'?[['single','외여닫이'],['double','양개 여닫이'],['unequal','비대칭 양개'],['sliding','겹침 미닫이'],['doubleSliding','양쪽 미닫이'],['pocket','포켓도어'],['folding','접이문']]:[['fixed','고정창'],['sliding','미닫이창'],['casement','여닫이창'],['awning','프로젝트창'],['tiltTurn','틸트앤턴']]);
  choice('hand','경첩 위치',o.hand||'left',[['left','왼쪽'],['right','오른쪽']]);choice('side','열림 방향',o.side||'positive',[['positive','기준선 왼쪽'],['negative','기준선 오른쪽']]);
  number('height','창호 높이 (mm)',o.height||(kind==='DOOR'?2100:1500));number('sill','하부 높이 (mm)',o.sill??(kind==='WINDOW'?900:0));number('frameWidth','틀 폭 (mm)',o.frameWidth??40);
 }
 if(kind==='DOOR'){number('leafThickness','문짝 두께 (mm)',o.leafThickness??40);number('openingAngle','열림 각도 (도)',o.openingAngle??90);number('leafRatio','비대칭 주문짝 비율 (0.2~0.8)',o.leafRatio??.7);choice('frameType','문틀 표현',o.frameType||'rebated',[['rebated','턱 있는 상세 문틀'],['plain','단순 사각 문틀']]);choice('threshold','문턱',o.threshold||'none',[['none','없음'],['sill','문턱 표시']]);}
 if(kind==='STAIR'){number('gap','ㄷ자 중앙 간격 (mm)',o.gap??100);number('nosing','논슬립 폭 (0: 없음)',o.nosing??30);number('railWidth','난간 평면 폭 (mm)',o.railWidth??38);choice('rails','난간 표시',o.rails||'both',[['both','양쪽'],['left','첫째 측'],['right','반대 측'],['none','없음']]);choice('direction','방향 문자',o.direction||'up',[['up','UP'],['down','DN']]);}
 number('width','폭 (mm)',o.width||e.attributes?.width||1200);
 if(!e.hostWall)number('depth','두께 (mm)',o.depth||200);
 if(kind==='STAIR'){choice('layout','계단 형태',o.layout||'straight',[['straight','직선'],['l','ㄱ자'],['u','ㄷ자']]);choice('floorSource','층고 기준',o.floorSource||'manual',[['manual','아래 입력값'],['global','3D 기본 층고와 함께 변경']]);number('floorHeight','층고 (mm)',o.floorHeight||engine.doc.reviewSettings?.floorHeight||3000);number('targetRiser','목표 단높이 (mm)',o.targetRiser||170);number('run','디딤판 (mm)',o.run||280);number('landing','참 깊이 (mm)',o.landing||o.width||1200);}
 const values=()=>{const result=Object.fromEntries(fields.map(f=>{const input=$('form-fields').querySelector(`[name="${f.name}"]`);return [f.name,f.type==='number'?Number(input.value):input.value];}));if(kind==='STAIR'){const input=$('form-fields').querySelector('[name="floorHeight"]');input.disabled=result.floorSource==='global';if(input.disabled){result.floorHeight=engine.doc.reviewSettings?.floorHeight||3000;input.value=result.floorHeight;}}return result;};
 form(kind==='DOOR'?'문 편집':kind==='WINDOW'?'창 편집':'계단 편집',fields,v=>{const changes=Object.fromEntries(fields.map(f=>[f.name,f.type==='number'?Number(v[f.name]):v[f.name]]));execute({type:'architecture.update',ids:[e.id],changes});});
 const preview=document.createElement('canvas');preview.width=600;preview.height=300;preview.style.cssText='width:100%;max-height:240px;background:#101820';preview.setAttribute('aria-label','건축 요소 변경 미리보기');$('form-fields').append(preview);
 const redraw=()=>{try{const draft=rebuildArchitecture(e,values(),engine.doc.entities.filter(w=>w.type==='wall')),b=G.bounds([draft]),k=Math.min(540/Math.max(1,b.maxX-b.minX),240/Math.max(1,b.maxY-b.minY)),ctx=preview.getContext('2d');ctx.clearRect(0,0,600,300);drawEntity(ctx,draft,p=>({x:300+(p.x-(b.minX+b.maxX)/2)*k,y:150-(p.y-(b.minY+b.maxY)/2)*k}),k,'#9bdec7');$('form-error').textContent=kind==='STAIR'?`${draft.parameters.count}단 · 단높이 ${draft.parameters.riser?.toFixed(1)||'—'} mm`:e.hostWall?'적용하면 벽 개구부도 함께 변경됩니다.':'';}catch(err){$('form-error').textContent=userErrorMessage(err);}};
 for(const input of $('form-fields').querySelectorAll('input,select'))input.addEventListener('input',redraw);redraw();
}
function editProperties() {
  if(chosen().length===1&&ARCH_LIBRARY[chosen()[0].libraryCommand]){openArchitecturalDetail(chosen()[0].libraryCommand,chosen()[0]);return;}
  const insulation=chosen().length===1&&chosen()[0].parameters?.kind==='INSULATION'?chosen()[0]:null;
  if(insulation?.parameters.path){form('단열재 경로 유지 · 두께 / 방향 수정',[{name:'depth',label:'단열재 두께 (mm)',type:'number',value:insulation.parameters.depth},{name:'side',label:'경로 기준 배치',value:insulation.parameters.side||'center',options:[['center','중심'],['left','왼쪽'],['right','오른쪽']]}],v=>{const rebuilt=insulationPath(insulation.parameters.path,Number(v.depth),v.side,insulation.parameters.closed,insulation.layer,insulation.parameters.waveSign||1);const {type,...changes}=rebuilt;execute({type:'update',ids:[insulation.id],changes});});return;}
  if (!selected.size) {
    toast("객체를 먼저 선택하세요.", true);
    return;
  }
  if(chosen().length===1&&['DOOR','WINDOW','STAIR'].includes(chosen()[0].parameters?.kind)){editArchitecture(chosen()[0]);return;}
  const es = chosen(),
    e = es[0],
    colorMixed = hasMixedColor(es, entityColorText),
    linetypes = linetypeChoices(engine.doc);
  for (const x of es) {
    const v = x.linetype ? String(x.linetype).toUpperCase() : null;
    if (v && !linetypes.some(([k]) => k === v)) linetypes.push([v, String(x.linetype)]);
  }
  // 고른 객체 종류에 맞는 항목만(properties-palette.js). 여러 값은 비워 두고, 고치지 않은 항목은 바꾸지 않는다.
  const palette = buildPropertyPalette(es, {
    layers: engine.doc.layers.filter((l) => !l.locked).map((l) => [l.id, l.name]),
    layerName: (id) => engine.doc.layers.find((l) => l.id === id)?.name || id,
    linetypes,
    colorText: entityColorText,
  });
  const fields = palette.fields.filter((f) => !(f.heading && f.advanced));
  if (es.length === 1 && e.type === "wall" && e.openings?.length)
    fields.push({
      name: "clearOpenings",
      label: "모든 개구부 복원",
      value: "no",
      options: [
        ["no", "유지"],
        ["yes", "복원"],
      ],
    });
  form("객체 속성 편집", fields, (values) => {
    const commands = palette.commands(values);
    if (values.clearOpenings === "yes") commands.push({ type: "update", ids: [e.id], changes: { openings: [] } });
    if (commands.length) execute({ type: "batch", commands });  // 한 번의 batch = 되돌리기 한 번
  });
  // 색 칸 아래에 색 선택기(ByLayer·ByBlock·표준 9색·전체 255색·트루컬러)를 붙인다. 값은 색 칸으로만 오간다.
  installColorPicker($("form-fields").querySelector('[name="color"]'), { layerColor: engine.doc.layers.find((l) => l.id === e.layer)?.color, mixed: colorMixed, books: loadColorBooks(localStorage) });
}
$("edit-properties").onclick = editProperties;
let propertiesDockLinetypes=null;
propertiesDock=installPropertiesDock(document.querySelector('.viewport'),{
  selection:()=>chosen(),
  revision:()=>selected.size?`s${selectionRevision}:${sceneRevision}`:`e${sceneRevision}:${activeLayer}:${JSON.stringify(currentProperties)}`,
  context:()=>{
    if(propertiesDockLinetypes?.revision!==sceneRevision)propertiesDockLinetypes={revision:sceneRevision,list:linetypeChoices(engine.doc)};
    return {layers:engine.doc.layers.filter(l=>!l.locked).map(l=>[l.id,l.name]),layerName:id=>engine.doc.layers.find(l=>l.id===id)?.name||id,linetypes:propertiesDockLinetypes.list,colorText:entityColorText};
  },
  current:()=>({current:currentProperties,activeLayer}),
  lockedLayer:id=>!!layerMap().get(id)?.locked,
  execute:command=>execute(command),
  applyCurrent:(name,raw)=>{
    if(name==='layer'){const l=engine.doc.layers.find(x=>x.id===raw);if(!l)throw Error('레이어가 없습니다.');if(l.frozen)throw Error('동결된 레이어는 현재 레이어로 할 수 없습니다.');activeLayer=raw;syncCurrentLayerChooser(raw);refresh();return;}
    if(name==='linetypeScale'){const n=Number(String(raw).trim());if(!String(raw).trim()||!(n>0)||n>10000)throw Error('선종류 축척은 0보다 크고 10,000 이하여야 합니다.');currentProperties={...currentProperties,linetypeScale:n===1?null:n};syncPropertyStrip();log(`현재 선종류 축척: ${n}`);return;}
    if(['color','linetype','lineweight'].includes(name))changeFromPropertyStrip(name,raw);
  },
  openDetail:()=>editProperties(),
  // ACAD200 712: PROPOBJLIMIT 설정값 · 선택 도구 줄(RIBBONCONTEXTSELLIM)
  cap:()=>s7Tools?.dockCap(),contextTools:(counts,total)=>s7Tools?.contextTools(counts,total)||[],runCommand:name=>{run(name);},
  error:message=>log(message,true),
  focusCanvas:()=>canvas.focus(),
  // 오른쪽 작업 막대가 접혔으면 가장자리 띠(8px · 마우스로 펼친 탭 띠는 팔레트 위로 잠깐 겹친다)만, 펼쳐졌으면 막대 전체 폭만큼 비켜 선다.
  rightInset:()=>{const bar=document.querySelector('.right-workspace');if(bar&&!bar.dataset.propertiesDockWatch&&typeof MutationObserver==='function'){bar.dataset.propertiesDockWatch='1';new MutationObserver(()=>propertiesDock.place()).observe(bar,{attributes:true,attributeFilter:['class','hidden']});}if(!bar||document.body.classList.contains('workspace-focus')||getComputedStyle(bar).display==='none')return 0;if(bar.classList.contains('is-collapsed'))return bar.classList.contains('rail-autohide')?8:(bar.querySelector('.sidebar-tabs')?.getBoundingClientRect().width||0);return bar.getBoundingClientRect().width;},
});
engine.onChange(()=>propertiesDock.notify(),{batched:true});   // 213: 카드 묶음 안에서는 끝에서 한 번   // 되돌리기·다른 곳의 편집도 바로(열쇠 비교만)
if(typeof MutationObserver==='function')new MutationObserver(()=>propertiesDock.place()).observe(document.body,{attributes:true,attributeFilter:['class']});   // 전체화면 집중 모드 들고 날 때
$("add-layer").onclick = () =>
  form(
    "새 레이어",
    [
      {
        name: "name",
        label: "레이어 이름",
        value: "Layer_" + (engine.doc.layers.length + 1),
      },
      { name: "color", label: "색상", type: "color", value: "#ffd479" },
    ],
    (v) => {
      execute({ type: "layer.add", name: v.name.trim(), color: v.color });
      activeLayer = engine.doc.layers.at(-1).id;
    },
  );
/* 레이어 관리자(오토캐드 LAYER 특성 관리자): 모든 레이어를 표로 보고 켜기·동결·잠금·색·선종류·굵기·인쇄를 바로 바꾼다.
   여러 줄을 고른 채(클릭·Ctrl·Shift) 토글을 누르면 고른 줄 전체에 적용. 바꿀 때마다 한 번의 편집(되돌리기 한 번). */
let layerManagerDialog=null;const layerManagerState={};
function openLayerManager(){
 // ACAD200 701·702·706·707: 표·필터·객체째 삭제·새 레이어 확인은 layer-manager.js 가 그린다(여기는 연결만).
 layerManagerDialog=openLayerManagerDialog({engine,execute,refresh,safe,toast,canvas,activeLayer:()=>activeLayer,setActiveLayer:id=>{activeLayer=id;if(typeof syncCurrentLayerChooser==='function')syncCurrentLayerChooser(id);}},layerManagerState);
}
function editLayers() {
  const l = engine.doc.layers.find((l) => l.id === activeLayer);
  form(
    "현재 레이어 설정 · " + l.name,
    [
      { name: "name", label: "이름", value: l.name },
      { name: "color", label: "색상", type: "color", value: l.color },
      {
        name: "weight",
        label: "선굵기 mm",
        type: "number",
        value: l.lineweight ?? 0.25,
      },
      {
        name: "linetype",
        label: "선종류",
        value: l.linetype || "CONTINUOUS",
        options: ["CONTINUOUS", "DASHED", "CENTER", "HIDDEN"].map((s) => [
          s,
          s,
        ]),
      },
      {
        name: "locked",
        label: "편집 잠금",
        value: l.locked ? "yes" : "no",
        options: [
          ["no", "해제"],
          ["yes", "잠금"],
        ],
      },
      {
        name: "visible",
        label: "표시",
        value: l.visible ? "yes" : "no",
        options: [
          ["yes", "표시"],
          ["no", "숨김"],
        ],
      },
      {
        name: "frozen",
        label: "동결",
        value: l.frozen ? "yes" : "no",
        options: [["no","해동"],["yes","동결"]],
      },
      {
        name: "plot", label: "출력", value: l.plot===false?'no':'yes', options: [['yes','출력 포함'],['no','화면에만 표시']],
      },
      {
        name: "remove",
        label: "빈 레이어 삭제",
        value: "no",
        options: [
          ["no", "유지"],
          ["yes", "삭제"],
        ],
      },
    ],
    (v) => {
      if (v.remove === "yes") {
        execute({ type: "layer.delete", id: l.id });
        return;
      }
      const weight = numeric(v.weight);
      if (weight < 0 || weight > 2.11) throw Error("선굵기는 0~2.11 mm입니다.");
      execute({
        type: "layer.update",
        id: l.id,
        changes: {
          name: v.name.trim(),
          color: v.color,
          lineweight: weight,
          linetype: v.linetype,
          locked: v.locked === "yes",
          visible: v.visible === "yes",
          frozen: v.frozen === "yes",
          plot: v.plot === "yes",
        },
      });
    },
  );
}
window.addEventListener("beforeunload", (e) => {
  if(typeof aiReveal!=='undefined'&&aiReveal)finishAIReveal();
  markCleanExit();                              // pagehide 가 안 오는 경우가 있어 여기서도 표시한다.
  if(localRecoveryTimer)flushLocalRecovery();   // 디바운스 대기 중인 마지막 편집을 남기고 닫는다.
  if(documents){
    documents.checkpoint();
    if(!documents.dirtyTabs().length&&(window.cadDesktop?.windowShortcut||!recoveryPending&&!recoveryBlocked))return;
    e.preventDefault();e.returnValue="";return;
  }
  if (!dirty) return;
  // Older installed shells cannot show Electron's save/close confirmation.
  // Persist the complete editable drawing synchronously before allowing exit.
  if (!window.cadDesktop) {
    try {
      const snapshot=JSON.stringify(engine.doc);
      localStorage.setItem("barun-cad-recovery-v2",snapshot);
      stampRecovery("barun-cad-recovery-rev",sceneRevision);
      if(localStorage.getItem("barun-cad-recovery-v2")===snapshot)return;
    } catch(error) {
      toast("자동 복구 저장 실패: DXF 또는 BCAD로 저장한 뒤 닫으세요.",true);
    }
  }
  e.preventDefault();
  e.returnValue = "";
});
const studio=installBlockDataTools(installFileWorkflows(installWorkflows(createStudio({engine,form,execute,styledDimension,pickPoint:pickPointOnce,pickPath:pickPathOnce,beginAIReveal,endAIReveal,beginOutputWait:options=>aiDrawRevealEnabled()?mountOutputWait(canvas.closest('.viewport'),options):null,openDrawing:(doc,name)=>openDrawingTab(doc,name||nextDrawingName(),false,{allowDialog:true}),selected:()=>selected,activeLayer:()=>activeLayer,toast,download,refresh,fit,getCommandSettings:()=>settings,restoreCommandSettings:value=>{settings=validateSettings(value);localStorage.setItem(settingsKey,JSON.stringify(settings));}}))));
studio.context.windowSelf=()=>otherWindows?.self;   // 이 도면 칸의 데스크톱 창 id(미리가 그리기 전에 제 칸을 앞으로 꺼낼 때)
studio.context.inputPrefs=()=>assist.prefs;   // 325 SELECTSIMILAR 기준(SELECTSIMILARMODE)
studio.context.pickPoint=pickPointOnce;studio.context.pickPath=pickPathOnce;studio.context.pickEntity=pickEntityOnce;
// ACAD200 영역 8: SCRIPT·DWGRECOVER·AUDITREPORT·PACK·XREFPATHMAP 와 열린 뒤 자동 감사(file-care-commands.js). 여기는 연결만.
const fileCare=installFileCareCommands(studio,{log:message=>log(message),drawingName:()=>fileName,submitInput:text=>{$('coordinate').value=text;submit();},
 waitIdle:()=>new Promise(resolve=>{const step=()=>busy?setTimeout(step,30):resolve();step();}),lastFailedOpen:()=>lastFailedOpen,openRecovered:item=>openRecoveredDrawing(item)});
studio.context.afterDrawingOpened=fileCare.afterDrawingOpened;
studio.context.isCommandIdle=()=>mode==='SELECT'&&!busy;          // 811: 큰 도면 복구 전송은 명령이 끝나 조용할 때만
studio.context.recoveryInputActive=recoveryInputActive;
// ACAD200-821: 오타 학습 기록(설정 형식과 따로 둔다 — 설정 검사에 걸려 지워지지 않게). 명령 실행 함수는 아래 세 함수만 부른다.
// var: 모듈이 다 읽히기 전에 명령이 불려도(TDZ) 멈추지 않게 — 그때는 배우기만 건너뛴다.
var TYPO_KEY='barun-auto-correct',typoLearner=createTypoLearner();
var typoState=(()=>{try{return JSON.parse(localStorage.getItem(TYPO_KEY)||'{}')||{};}catch{return {};}})();
function typoRan(name){if(!typoLearner)return;const learned=typoLearner.ran(name,typoState);if(learned!==typoState){typoState=learned;try{localStorage.setItem(TYPO_KEY,JSON.stringify(typoState));}catch{}}}
function typoCorrection(value){if(!typoLearner)return null;const corrected=autoCorrected(typoState,value);if(corrected)typoLearner.clear();return corrected;}
function typoUnknown(value){if(typoLearner)typoLearner.unknown(value,suggestCommands(value,settings,8).map(c=>c.name));}
studio.context.startInsulation=(depth=100,action='auto')=>{if(!Number.isFinite(depth)||depth<=0)throw Error('단열재 두께는 양수입니다.');const ids=chosen().filter(e=>['line','polyline','rectangle','arc','circle'].includes(e.type)).map(e=>e.id);if(action!=='draw'&&ids.length){convertInsulation(ids,depth);return;}reset();mode='INSULATION';phase=action==='select'?'insulation-select':'point';params={depth,side:'center'};lastCommand='INSULATION';run.insulationSettings={...params};updatePrompt();render();canvas.focus();};
studio.context.getActionContext=async()=>({...actionContext(engine.doc,selected,activeLayer,run.recent||[]),sitePlan:studio.context.sitePlanContext?.(),landInfo:studio.context.miribodaContext?.(),liveCheck:liveCheck?await liveCheck.check(engine.doc):null});
studio.context.actionSnapshot=()=>JSON.stringify({documentId:documents?.activeId,revision:sceneRevision,doc:engine.doc,selected:[...selected],activeLayer});
studio.context.selectEntities=ids=>setSelected(ids);
/* 대지 경계가 도면에 들어와 있는가. AI 가 '대지부터 가져오자' 하고 멈춘 뒤 이어갈지 판단하는 근거다. */
studio.context.hasSite=()=>!!G.findParcelEntity(engine.doc.entities,e=>e.parcelRole==='site','site');
/* 주소로 대지를 가져온다. AI 를 거치지 않고 신축설계 같은 흐름이 직접 부를 수 있다. */
studio.context.importSite=(query,options={})=>{
 const snapshot=studio.context.actionSnapshot();
 return importParcelAction({query,surroundings:options.surroundings??true,contextMeters:options.contextMeters??30},
  {api:(...args)=>studio.api(...args),open:(q,o)=>studio.context.openParcel(q,o),
   unchanged:()=>snapshot===studio.context.actionSnapshot(),
   geo:engine.doc.drawingGeo,commit:(entities,drawingGeo)=>{beginAIReveal();try{const ids=execute({type:'parcel.import',entities,...(drawingGeo?{drawingGeo}:{})});setSelected(ids);fit();}finally{endAIReveal();}}});
};
studio.context.newDrawingTab=name=>openDrawingTab(newDrawingDocument(),name||nextDrawingName(),false,{allowDialog:true});
studio.context.zoomToBounds=b=>{if(b)fitBox(b);};   // ACAD200 522: FINDREPLACE 찾기 결과로 확대
studio.context.captureAIChange=()=>captureAIChange();
studio.context.followAIChange=change=>followAIChange(change);
studio.context.applyActions=async(plan,snapshot,{repair=false,isCancelled=()=>false,authorization}={})=>{
 if(isCancelled())throw Error('요청을 중지했습니다.');
 // 질문·빈 계획은 도면을 바꾸지 않으므로 스냅숏을 따지지 않는다(도구가 이미 그린 뒤 빈 답이 '도면이 변경되어'로 끝나지 않게)
 if(plan.ask!==null)return plan.ask;
 if(!plan.actions.length)return plan.note||'도면 변경 없이 답변했습니다.';
 const request={id:authorization?.requestId,args:{},expires_at:authorization?.expiresAt};
 const assertCurrent=()=>{if(isCancelled())throw Error('요청을 중지했습니다.');if(snapshot!==studio.context.actionSnapshot())throw Error('도면이 변경되어 실행하지 않았습니다. 다시 요청하세요.');};
 const guarded=apply=>commitAIChange(studio.context,request,assertCurrent,apply);
 await guarded(()=>{});
 const saveOptions={aiRequestId:authorization?.requestId,aiRecipient:authorization?.recipient,aiExpiresAt:authorization?.expiresAt,aiRequestEpoch:studio.context.getAIRequestEpoch?.()};
 if(snapshot!==studio.context.actionSnapshot())throw Error('요청 후 도면이 변경되었습니다. 현재 도면으로 다시 요청하세요.');
 if(plan.actions.some(a=>a.cmd==='open_tool')){const a=plan.actions[0];if(plan.actions.length!==1||!AI_DIALOG_COMMANDS.includes(a.args.command)||Object.keys(a.args).some(k=>k!=='command'))throw Error('지원하는 설정창 하나를 지정하세요.');await studio.context.runAICommand(a.args.command,{assertCurrent,request,saveOptions});return '설정창 작업을 처리했습니다.';}
 if(plan.actions.some(a=>a.cmd==='parcel_import')){
  if(plan.actions.length!==1)throw Error('대지를 먼저 가져온 다음 설계 작업을 요청하세요.');
  return importParcelAction(plan.actions[0].args,{api:(...args)=>studio.api(...args),open:(q,o)=>{if(isCancelled())throw Error('요청을 중지했습니다.');return studio.context.openParcel(q,o);},unchanged:()=>!isCancelled()&&snapshot===studio.context.actionSnapshot(),geo:engine.doc.drawingGeo,commit:(entities,drawingGeo)=>guarded(()=>{const ids=execute({type:'parcel.import',entities,...(drawingGeo?{drawingGeo}:{})});setSelected(ids);fit();})});
 }
 if(plan.actions.some(a=>a.cmd.startsWith('site_plan.'))){
  if(plan.actions.length!==1)throw Error('배치 생성·재검증은 다른 편집과 분리해 실행하세요.');
  const {cmd,args}=plan.actions[0];
  if(cmd==='site_plan.generate'&&Object.keys(args).every(k=>k==='program'))return studio.context.sitePlanGenerate(args.program,undefined,guarded);
  if(cmd==='site_plan.validate'&&!Object.keys(args).length)return studio.context.sitePlanValidate(guarded);
  throw Error('배치 명령 인자를 확인하세요.');
 }
 await assertLibraryFirst((...args)=>studio.api(...args),engine.doc,plan,{activeLayer});
 const staged=stageActions(engine,plan,{selected:[...selected],activeLayer});
 const beforeCheck=liveCheck?await liveCheck.check(engine.doc):null,afterCheck=liveCheck?await liveCheck.check(staged.document):null;
 if(repair&&liveCheck&&!await liveCheck.confirmRepair(staged.document,plan))throw Error('위반 수정 실행을 취소했습니다.');
 if(isCancelled())throw Error('요청을 중지했습니다.');
 if(snapshot!==studio.context.actionSnapshot())throw Error('도면이 변경되어 실행하지 않았습니다. 다시 요청하세요.');
 busy=true;
 try{
  if(staged.save)await studio.saveLargeDocument(staged.document,staged.save,'dxf',{saveOptions});
  // 가볍게: 바뀐 게 있는지는 미리 실행한 엔진의 기록으로 안다(예전에는 도면 두 벌을 통째로 JSON 비교).
  await guarded(()=>{if(staged.changed??(JSON.stringify(staged.document)!==JSON.stringify(engine.doc))){const apply=()=>execute({type:'load',document:staged.document});if(repair)applyReviewRepair(engine,apply);else apply();}});
  if(staged.changed&&plan.actions.some(a=>a.cmd==='materials_set'))notifyAIChange(studio.context,'cad_set_materials',request.id);
  activeLayer=staged.activeLayer;setSelected(staged.selected);if(staged.fit){if(aiReveal)setAIRevealFinalFit();else fit();}
  run.recent=[...(run.recent||[]),...plan.actions.map(a=>a.cmd)].slice(-5);
  if(afterCheck){const key=f=>f.type+':'+f.objectIds.join(',')+':'+f.message,old=new Set(beforeCheck.findings.map(key));const added=afterCheck.findings.filter(f=>f.severity==='error'&&!old.has(key(f)));if(added.length)plan.note=[plan.note,...added.map(f=>f.message)].filter(Boolean).join(' · ');liveCheck.refresh();}
  return staged.summary;
 }finally{busy=false;refresh();}
};
// Load Three and install the viewport only when the user requests 3D.
studio.context.inferLayerWalls=inferLayerWalls;
studio.context.runAICommand=async(command,{assertCurrent=()=>{},request,saveOptions={},inputs=request?.args?.inputs||{}}={})=>{
 if(busy||restoringTabs)throw Error('도면 파일 처리가 끝난 뒤 다시 실행하세요.');
 const name=resolveCommand(command,settings)||(Object.hasOwn(studio.handlers,command)?command:null);
 if(!name)throw Error('지원하는 CAD 화면 명령이 아닙니다. 리습은 cad_lisp_run을 사용하세요.');
 if(name==='OPEN'&&window.cadDesktop?.pickDrawingFiles&&window.cadDesktop?.openInNewWindows){return window.cadDesktop.pickDrawingFiles().then(async paths=>{if(!paths.length)return {started:false,cancelled:true};await commitAIChange(studio.context,request,assertCurrent,()=>{});await window.cadDesktop.openInNewWindows(paths);return {started:true,command:name,requested:true};});}
 if(['SAVE','QSAVE','SAVEAS','DXFOUT','DWGOUT','BACKUP'].includes(name)){
  if(typeof aiReveal!=='undefined'&&aiReveal)finishAIReveal();
  const snapshot=engine.doc,format=name==='BACKUP'?'bcad':name==='DWGOUT'?'dwg':name==='DXFOUT'?'dxf':saveFormat;
  await commitAIChange(studio.context,request,assertCurrent,()=>{});
  const result=await studio.saveLargeDocument(snapshot,fileName+'.'+format,format,{dwgVersion,dxfVersion,saveOptions,...(name!=='SAVEAS'&&filePath?.toLowerCase().endsWith('.'+format)?{targetPath:filePath}:{})});
  await commitAIChange(studio.context,request,()=>{assertCurrent();if(engine.doc!==snapshot)throw Error('저장 중 도면이 변경되었습니다.');},()=>{filePath=result.path;dirty=false;$('dirty').textContent='';documents?.checkpoint();renderDrawingTabs();scheduleDrawingRecovery();});
  return {started:true,saved:true,command:name,path:result.path};
 }
 if(['MSL','QQ'].includes(name)&&studio.context.runOutputCommand){
  const outputDocument=engine.doc,outputId=documents.activeId,outputRevision=sceneRevision;
  const check=()=>{assertCurrent();if(engine.doc!==outputDocument||documents.activeId!==outputId||sceneRevision!==outputRevision)throw Error('도면이 변경되어 실행하지 않았습니다. 다시 요청하세요.');};
  const result=await studio.context.runOutputCommand(name,inputs,{afterDelivery:studio.context.afterBridgeDelivery?fn=>studio.context.afterBridgeDelivery(fn,{requestId:request.id}):undefined,
   beforeOutput:async()=>{await studio.context.authorizeAIRequest?.(request);check();},
   beforeOutputClose:async()=>{if(typeof studio.context.authorizeOutputClose!=='function')throw Error('도면 닫기 권한을 확인할 수 없습니다.');await studio.context.authorizeOutputClose(request);check();},
   commitOutput:apply=>commitAIChange(studio.context,request,check,apply)});
  return {started:result.applied===true,command:name,...result};
 }
 if(name==='NEW'){await commitAIChange(studio.context,request,assertCurrent,()=>{});openDrawingTab(newDrawingDocument(),nextDrawingName(),false,{allowDialog:true,allowAI:true});return {started:true,command:name};}
 if(['PDF','PLOT','SHEET','SHEETS'].includes(name)){
  const result=await commitAIChange(studio.context,request,assertCurrent,()=>studio.handlers[name==='PLOT'?'PDF':name]({commit:apply=>commitAIChange(studio.context,request,assertCurrent,apply),saveOptions}));
  return {started:result?.cancelled!==true,command:name,...result,...(result?.completed&&['PDF','PLOT'].includes(name)?{saved:true}:{})};
 }
 const {createCommandClient,scriptedCommandNames}=await import('./command-runner.js');
 if(scriptedCommandNames().includes(name)){
  const snapshot=engine.doc,runner=createCommandClient();
  try{
   const result=await runner.run(snapshot,name,{selection:[...selected]},{activeLayer,signal:studio.context.getAIRequestSignal?.(request)});
   await commitAIChange(studio.context,request,()=>{assertCurrent();if(engine.doc!==snapshot)throw Error('명령 실행 중 도면이 바뀌었습니다.');},()=>{execute({type:'lisp.apply',document:result.document});setSelected(result.selection||[]);refresh();});
   if(result.followUps)await studio.context.applyCommandFollowUps?.(result.followUps); // 파일·클립보드·설정·이어서 열 창(설명서 시험 2026-10-27)
   return {started:true,applied:true,command:name,added:result.added,removed:result.removed};
  }finally{runner.stop();}
 }
 if(!['UNDO','REDO','FIT','ZOOM','PAN','REGEN','SELECT','APPLOAD','SETTINGS','HELP','LAYER','CONVERT','NUMCALC','CALC','MIRIBODA'].includes(name))throw Error('이 명령은 cad_run_command 또는 전용 CAD 도구로 실행하세요.');
 await commitAIChange(studio.context,request,assertCurrent,()=>run(name));
 if(name==='UNDO'||name==='REDO')notifyAIChange(studio.context,name==='UNDO'?'cad_undo':'cad_redo',request?.id);
 return {started:true,command:name,awaiting_user:true};
};
studio.context.refreshLispLibrary=()=>studio.lisp?.refresh();
studio.context.isDrawingDirty=()=>dirty;
studio.context.completeBridgeSave=path=>{
 if(typeof path!=='string'||!path)throw Error('저장한 파일 경로가 없습니다.');
 filePath=path;fileName=path.replace(/\\/g,'/').split('/').pop().replace(/\.dxf$/i,'');saveFormat='dxf';
 dirty=false;$('dirty').textContent='';documents?.checkpoint();renderDrawingTabs();scheduleDrawingRecovery();
 return {drawingPath:filePath,drawingName:fileName,folder:studio.context.getDrawingFolder(),dirty:false,saved:true};
};
studio.context.getDrawingPath=()=>filePath;
studio.context.getDrawingFolder=()=>{if(!filePath)return '';const value=String(filePath).replace(/\\/g,'/');const index=value.lastIndexOf('/');return index>0?value.slice(0,index):'';};
studio.context.getDrawingName=()=>fileName;
// IFC 저장(BIM 프로그램용): AI 도면(설계 JSON)이 있으면 그 설계로 바닥판·지붕·난간벽·계단까지, 없으면 2D 도면의 벽·문·창·실.
// 무거운 외부 도구 없이 글자로 직접 쓴다(ifc-writer.js). 계단 수치는 도면 기준(열쇠 묶음)이 있어야 한다.
async function exportIfc(name,{onProgress,signal}={}){
 const {ifcTextAsync,modelIfcPayloadAsync}=await lockedImport('ifc-writer.js');
 const wait=!onProgress&&aiDrawRevealEnabled()?(await import('./wait-model-progress.js')).startModelWait(canvas.closest('.viewport'),{title:'IFC 만들기',phases:[{key:'prepare',label:'층·벽 준비'},{key:'objects',label:'객체 쓰기'}]}):null;
 const work={onProgress:onProgress||wait?.push,signal};
 try {
 const {modelWorkAbort}=await import('./model-work.js');modelWorkAbort(signal);
 const sets=Object.values(engine.doc.drawingSets||{}).filter(s=>s.model&&s.kind!=='details'),base=(name||fileName||'바른CAD').replace(/\.[^.]+$/,'');
 let payload,note='';
 if(sets.length){
  let knowledge={};try{const r=await fetch('/drawing-knowledge.json',{cache:'no-store'});if(r.ok)knowledge=await r.json();}catch{}
  const record=sets.find(s=>s.kind==='set')||sets.at(-1);
  payload=await modelIfcPayloadAsync(record.model,{standard:knowledge.standard,assemblies:knowledge.assemblies,name:base},work);
  if(!knowledge.standard)note=' · 계단은 도면 기준을 열 수 없어 뺐습니다([계정 연결] 뒤 다시)';
 }else {const {ifcPayloadAsync}=await import('./bim-envelope.js');payload=await ifcPayloadAsync(engine.doc,{},work);}
 const result=await ifcTextAsync({...payload,fileName:base},{},work);
 const bytes=await studio.b64(new Blob([result.text]));modelWorkAbort(signal);
 await studio.output(bytes,result.filename,'application/x-step');
 toast(result.summary+note);
 } finally {wait?.destroy();}
}
studio.context.exportIfc=exportIfc;
studio.context.regenerateDrawingSet=regenerateDrawingSet;
const pushPull3D=async request=>{
 const {pushPullDrawingSet}=await import('./drawing-set-command.js');
 return pushPullDrawingSet({doc:()=>engine.doc,execute,form,regenerateDrawingSet,setSelected,refresh,toast},request);
};
/** 평면에서 점 하나를 받는다(취소·다른 명령이면 null). 내부 투시도가 쓴다. */
let eyePointWaiter=null;
function settleEyePoint(value){const done=eyePointWaiter;eyePointWaiter=null;done?.(value);}
function pickPlanPoint(prompt){settleEyePoint(null);return new Promise(resolve=>{reset();eyePointWaiter=resolve;mode='EYEPOINT';phase='point';params={prompt};updatePrompt();canvas.focus();});}
const openReview3D=createReview3DOpener({engine,toast,download,pickPlanPoint,pushPull:pushPull3D,inferLayerWalls,editEntity:id=>{setSelected([id]);editProperties();},exportIfc:work=>exportIfc(undefined,work),waitEnabled:aiDrawRevealEnabled,openStoreys:()=>studio.handlers?.STOREYS?.()},()=>import('./review-3d.js'));
const review3DButton=document.createElement('button');review3DButton.id='review-3d-toggle';review3DButton.textContent='3D 모델링';review3DButton.setAttribute('aria-expanded','false');
review3DButton.onclick=async()=>{try{
 await openReview3D();
}catch(error){toast('3D 열기 실패: '+error.message,true);}};
// 사무실 패드: 펜이 가리킨 화면(frame)의 보기 그대로 좌표를 옮긴다 — GPU 화면이 늦어도 획을 버리지 않는다(A19).
tabletPad=createTabletPad({
 view:()=>({origin:{...origin},scale,width,height}),screen,editable,pick:p=>pick(p),setSelected:ids=>setSelected(ids),render:()=>render(),
 toast:message=>toast(message),entities:ids=>engine.selected(ids),execute:c=>{execute(c);render();},activeLayer:()=>activeLayer,
 textHeight:()=>num('text-height',150),ensureLayer:ensureLayerByName,cloud:(ring,arc)=>{const keep=run.revcloudArc;run.revcloudArc=arc;try{return cloudPoints(ring);}finally{run.revcloudArc=keep;}},
 architecturalDetail:(command,options)=>architecturalDetail(command,options,activeLayer),parallelWallPair,wallLineOpening,
 undo:()=>safe(()=>execute({type:'undo'})),commandActive:()=>mode!=='SELECT',
 command:text=>{const input=$('coordinate');input.value=text;input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));},
 askAi:text=>{const box=document.getElementById('ai-message'),send=document.getElementById('ai-send');if(!box||!send){toast('AI 대화 창을 찾지 못했습니다.',true);return;}box.value=text;send.click();return box.value==='';},
 voice:()=>document.getElementById('ai-conversation')?.click(),
 pointer:(type,p)=>{const r=canvas.getBoundingClientRect();canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,clientX:r.left+p.x,clientY:r.top+p.y,button:0,buttons:type==='pointerup'?0:1,pointerId:4242,pointerType:'mouse',isPrimary:true}));},
 applyView:e=>{if(Number.isFinite(e.factor)&&e.factor>0&&e.factor!==1)zoom(Math.max(.05,Math.min(20,e.factor)),{x:(e.x??.5)*width,y:(e.y??.5)*height});if(Number.isFinite(e.dx)||Number.isFinite(e.dy)){origin.x+=Math.max(-3,Math.min(3,e.dx||0))*width;origin.y+=Math.max(-3,Math.min(3,e.dy||0))*height;render();}tablet.refresh();},
 infoChanged:()=>tablet?.pushInfo()});
const tablet=installTablet({api:studio.api,toast,onDisconnect:()=>tabletPad.clearMarks(),onEvent:e=>{lastDrawingPointer=null;tabletPad.handle(e);},
 pad:tabletPad,view:()=>({origin:{...origin},scale,width,height}),drawingName:()=>documents.active?.name||fileName||'도면'});
studio.context.getPadSketches=()=>tabletPad.getSketches();
studio.context.focusFieldRecord=record=>{
 fieldRecordHighlight={at:{...record.at},no:record.no};
 fitBox({minX:record.at.x-2500,minY:record.at.y-2000,maxX:record.at.x+2500,maxY:record.at.y+2000});
};
const padShare=installPadShare({engine,api:studio.api,output:(data,name,type)=>studio.output(data,name,type),toast,active:()=>docViewActive,execute:c=>{execute({...c,keepProperties:true});render();},drawingName:()=>documents.active?.name||'도면',
 filePath:()=>typeof filePath==='string'?filePath:'',docKey:()=>documents?.activeId||'',
 viewBox:()=>({minX:-origin.x/scale,maxX:(width-origin.x)/scale,minY:(origin.y-height)/scale,maxY:origin.y/scale}),focus:p=>{if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))return;rememberView();origin={x:width/2-p.x*scale,y:height/2+p.y*scale};endView();render();},setOverlay:list=>{padOverlay=list;render();}});
// 위 막대: 사무실에서 보기·밖에서 보기·현장 기록을 [패드 ▾] 하나로(10/21).
installPadMenu();
let lastDrawingPointer=null;
canvas.addEventListener('pointermove',()=>{if(cursor)lastDrawingPointer={x:cursor.x,y:cursor.y};});
/* ACAD200 712 롤오버 특성: 켜 두었을 때만, 포인터가 0.5초 멈추면 한 번 집어(색인) 특성 4줄을 보인다. 움직이는 동안은 타이머만 다시 건다. */
{let tip=null;const rest=createRestDetector({delay:500,onMove:()=>{if(tip)tip.hidden=true;},onRest:(x,y)=>{
 if(!s7Tools?.prefs().rolloverTips||mode!=='SELECT'||drag||!cursor)return;
 const e=pick(cursor);if(!e)return;
 const lines=rolloverLines(buildPropertyPalette([e],{layers:engine.doc.layers.map(l=>[l.id,l.name]),layerName:id=>layerMap().get(id)?.name||id,linetypes:[],colorText:entityColorText}).fields);
 if(!lines.length)return;
 if(!tip){tip=document.createElement('div');tip.className='rollover-tip';tip.setAttribute('role','tooltip');document.body.append(tip);}
 tip.textContent=lines.join('\n');tip.style.left=Math.min(innerWidth-300,x+16)+'px';tip.style.top=Math.min(innerHeight-120,y+16)+'px';tip.hidden=false;}});
 canvas.addEventListener('pointermove',ev=>{if(s7Tools?.prefs().rolloverTips)rest.move(ev.clientX,ev.clientY);});
 canvas.addEventListener('pointerleave',()=>{rest.cancel();if(tip)tip.hidden=true;});}
studio.context.getInteractionContext=()=>({
 units:engine.doc.units,selectedCount:selected.size,selectedIds:[...selected].slice(0,100),selectionTruncated:selected.size>100,
 selectedObjects:engine.doc.entities.filter(e=>selected.has(e.id)).slice(0,20).map(e=>({id:e.id,type:e.type,layer:e.layer,points:e.points?.slice(0,8).map(p=>({...p})),pointCount:e.points?.length,width:e.width,radius:e.radius})),
 ...tabletPad.context(), pointer:lastDrawingPointer,pointedObjectId:lastDrawingPointer?pick(lastDrawingPointer)?.id:null,
 // AI 설계가 그린 계획안 목록: "1안 층수를 바꿔줘" 같은 말이 어느 객체인지 AI 가 알게 한다.
 plans:(engine.doc.planAlternatives||[]).map(p=>({title:p.title,summary:p.summary,sitePlanId:p.sitePlanId,entityIds:engine.doc.entities.filter(e=>e.sitePlanId===p.sitePlanId).slice(0,40).map(e=>e.id)})),
 activeCommand:mode,capturedAt:new Date().toISOString()
});
// 복구 갈래가 셋이다(도면 탭 · 마지막 작업 · 로컬 앱 복구). 모두 이 값을 보고 같이 판단한다.
studio.context.startedFresh=()=>startFresh;
try {
  const recovery =
    localStorage.getItem("barun-cad-recovery-v2") ||
    localStorage.getItem("barun-cad-recovery");
  // 정상 종료 뒤 새로 켠 것이면 지난 작업을 열지 않는다. 버리지는 않고 RECOVER 로 되살릴 수 있게 둔다.
  if (recovery && startFresh) {
    lastSessionDocument = recovery;
  } else if (recovery) {
    restoreRecoveredDrawing(JSON.parse(recovery));
    dirty = true;
    $("dirty").textContent = "●";
    log("마지막 로컬 작업을 복구했습니다. 기존 BCAD v1도 열 수 있습니다.");
    if (width && height) fit();
  }
} catch (e) {
  log("임시 복구 실패: " + e.message, true);
}
log(
  `DXF 기본 저장 · COPY=${settings.aliases.COPY || "COPY"} / CIRCLE=${settings.aliases.CIRCLE || "CIRCLE"} · 별칭 뒤 Enter · 설정에서 변경 가능`,
);
if (settingsError) log(settingsError, true);
await initializeDrawingTabs();
window.cadDesktop?.onDrawingStateRequested?.(drawingOpenState);
window.cadDesktop?.onSelectDrawingFile?.(file=>{const tab=documents.tabs.find(tab=>drawingPathKey(tab.filePath)===drawingPathKey(file));if(tab)safe(()=>{selectDrawingTab(tab.id);for(const empty of [...documents.tabs])if(isEmptyDrawingTab(empty))documents.remove(empty.id);scheduleDrawingRecovery();});});
resolveDrawingWorkspaceReady();
refresh();
connect();
connectBridge(studio);
// 로그인으로 핵심 자산(레이어 정리 지식·법규 검사) 열쇠를 받으면 지식을 새로 읽는다(vault_gate.py · shared-account-adapter.js).
window.addEventListener('barun-protected-unlocked',async()=>{try{const ok=(await Promise.all([reloadLayerKnowledge(),reloadLayerRanking()])).every(Boolean);if(ok)toast('로그인 확인 · 레이어 정리 지식과 법규 검사를 켰습니다.');}catch(e){toast('핵심 자료를 다시 읽지 못했습니다: '+userErrorMessage(e),true);}});
installChat(studio);
liveCheck=installLiveCheck({engine,getDrawingInfo:()=>({name:fileName,revision:sceneRevision}),getSelectedIds:()=>[...selected],render,toast,download,form,openReview3D,zoomObjects:ids=>{const es=entitiesById(engine.doc.entities,new Set(ids)),b=G.bounds(es);if(!b)return;setSelected(ids);scale=Math.min(width/Math.max(1,b.maxX-b.minX),height/Math.max(1,b.maxY-b.minY))*.8;origin={x:width/2-(b.minX+b.maxX)/2*scale,y:height/2+(b.minY+b.maxY)/2*scale};render();}});
document.querySelector('.sidebar-tabs')?.append(review3DButton);
window.cadLiveCheck=liveCheck;
studio.context.zoomObjects=ids=>{const b=G.bounds(engine.doc.entities.filter(e=>ids.includes(e.id)));if(!b)return;setSelected(ids);scale=Math.min(width/Math.max(1,b.maxX-b.minX),height/Math.max(1,b.maxY-b.minY))*.8;origin={x:width/2-(b.minX+b.maxX)/2*scale,y:height/2+(b.minY+b.maxY)/2*scale};render();};
studio.context.siteAnalyzeComplete=analysis=>liveCheck.setAnalysis(analysis);
studio.handlers.REVIEWTABLE=()=>liveCheck.insertReviewTable();
studio.handlers.ACCESSREVIEW=()=>liveCheck.openAccess();
// 에너지절약계획서 영역: 출력 창의 [윈도우 <]와 같은 두 점 찍기로 개요·층·입면·단면·창호 일람표 범위를 도면에 기억한다(AI 도구 cad_energy_regions 가 읽음).
studio.handlers.ENERGYREGION=preset=>form('에너지 영역 고르기 · 출력처럼 윈도우',energyRegionFields(preset),values=>{const spec=energyRegionSpec(values);makeEnergyRegion(spec,{x:0,y:0},{x:1,y:1});const label=energyRegionLabel(spec);reset();mode='PLOTWINDOW';phase='point';params={windowPrompt:label+' 영역',onWindow:(a,b)=>{setEnergyRegion(engine,makeEnergyRegion(spec,a,b));toast(label+' 영역 저장 · AI가 읽을 수 있습니다');}};updatePrompt();canvas.focus();});
studio.handlers.ACCESSINPUT=()=>liveCheck.editAccess();
studio.handlers.SITE_ANALYZE=()=>document.querySelector('.lc-import').click();
installParcel(studio);
installSharedAccount(studio);
installStoreys(studio);
installRenovation(studio);
/* 자동 배치는 계획 엔진(plan-layout.js)이 626KB 다. 3D 와 같은 이유로 누를 때 불러온다. */
(()=>{
  const tools=document.querySelector('#canvas-tools');
  if(!tools)return;
  const stub=document.createElement('button');stub.textContent='배치·평면 자동생성';stub.title='대지 안에서 법규·주차를 검토하고 배치도와 평면도를 생성';stub.id='auto-plan-open';
  tools.prepend(stub);
  let loading=false;
  stub.onclick=async()=>{
    if(loading)return;
    loading=true;stub.textContent='여는 중…';
    try{
      const {installAutoPlan}=await lockedImport('auto-plan.js');
      stub.remove();
      installAutoPlan(studio);
      document.getElementById('auto-plan-open')?.click();
    }catch(error){
      stub.textContent='배치·평면 자동생성';toast('자동 배치를 불러오지 못했습니다: '+error.message,true);
    }finally{loading=false;}
  };
})();
installSitePlan(studio);
installMiriboda(studio);
installApartment(studio);
// 인허가 도서 창(에너지·장애인편의시설 두 탭) — 공통 검토 패널 단추와 명령 PERMITBOOK 으로 연다.
installPermitBook(studio,{getFilePath:()=>filePath});
// 실시 탭 구조 검토·증축·대수선 검토 창(통과 시안 ⑪⑫).
const drawingRecognition=installDrawingRecognition(studio);installStructureReview(studio);installExtensionReview(studio);
{const b=document.createElement('button');b.textContent='인허가 도서 (에너지·편의시설)';b.onclick=()=>studio.handlers.PERMITBOOK();document.querySelector('.livecheck-panel')?.append(b);}
installDesignCases(studio);
// 상세 찾기: 처음 열 때만 모듈/색인을 불러온다. 편집·선택 루프에는 계산을 붙이지 않는다.
const librarySearchPromises={};
studio.context.getDetailReviewStore=()=>liveCheck?.reviews;
studio.context.detailCanvas=canvas;
studio.context.detailWorldPoint=event=>world(localPoint(event));
studio.context.pickDetailPoint=()=>pickPointOnce('상세를 넣을 위치를 클릭하세요 · Esc 취소');
studio.context.isDetailBusy=()=>busy||restoringTabs||engine.inTransaction?.()||phase!=='idle';
studio.context.isDetailIdle=()=>!busy&&!restoringTabs&&phase==='idle';
studio.context.getDetailCommand=()=>mode==='SELECT'?(lastCommand||''):mode;
studio.context.getDetailRevision=()=>sceneRevision;
studio.context.getDetailFailedChecks=()=>liveCheck?.result?.findings?.filter(f=>f.severity==='error').map(f=>({...f,ok:false,lawId:f.ruleId}))||[];
studio.context.getDetailDenominator=()=>studio.context.getSettings?.().denominator||100;
studio.context.focusDetailUse=use=>{const at=use.referenceAt||use.at;if(Array.isArray(at)&&at.length>=2)fitBox({minX:at[0]-2500,minY:at[1]-2000,maxX:at[0]+2500,maxY:at[1]+2000});else if(at&&Number.isFinite(at.x))fitBox({minX:at.x-2500,minY:at.y-2000,maxX:at.x+2500,maxY:at.y+2000});else if(use.entityId){setSelected([use.entityId]);fit(engine.selected([use.entityId]));}};
// 자료 창은 셋: 상세 찾기(상세도만)·주동 찾기·단위세대 찾기. 같은 잠근 모듈에서 창만 따로 만든다.
const loadLibrarySearch=mode=>librarySearchPromises[mode] ||= lockedImport('detail-search-panel.js').then(module=>module.createDetailSearch(studio,{mode,storage:localStorage})).catch(error=>{delete librarySearchPromises[mode];throw error;});
const loadDetailSearch=()=>loadLibrarySearch('detail');
studio.handlers.DETAILS=async()=>{await (await loadDetailSearch()).open();};
// 실시 '방화구획 상세도': 상세 생성기에서 이름에 '방화구획'이 든 방화 상세를 도면 오른쪽 빈 곳에 한 묶음으로(실행 취소 한 단계). AI 의 cad_generate_details 와 같은 생성기.
studio.handlers.FIREDETAILS=async()=>{
 const {listDetails,detailGroups}=await lockedImport('drawing-details/registry.js'),ids=listDetails().filter(d=>d.group==='fire'&&/방화구획/.test(detailGroups.fire[d.id]?.name||'')).map(d=>d.id);
 if(!ids.length)throw Error('상세 생성기에 방화구획 상세가 없습니다.');
 const source=engine.doc,b=G.bounds(source.entities),r=await regenerateDrawingSet(source,undefined,{kind:'details',ids,origin:{x:b?b.maxX+10000:0,y:b?b.maxY:0}});
 if(engine.doc!==source)throw Error('도면이 변경되었습니다. 방화구획 상세도를 다시 실행하세요.');
 const list=r.document?.drawingSets?.[r.setId]?.selected||[],drawn=list.filter(p=>p.entityIds?.length).length,later=list.filter(p=>p.status==='작성 예정').length;   // 결과의 상세 목록은 도면 묶음 기록(selected)에 있다. 표준판을 못 받은 상세는 '작성 예정' 자리만 — 빈 묶음은 넣지 않는다
 if(!r.added?.length||!drawn)throw Error('방화구획 상세 '+ids.length+'개가 모두 "작성 예정"입니다 — 상세 표준판(바른 서버)을 받지 못해 그리지 않았습니다. 로그인·연결을 확인한 뒤 다시 실행하세요.');
 engine.execute({type:'lisp.apply',document:r.document});setSelected(r.added||[]);toast(`방화구획 상세 ${drawn}개를 도면 오른쪽에 그렸습니다(상세 생성기)${later?` · 함께 붙는 상세 ${later}개는 바른 서버 표준판을 받아야 그려집니다(작성 예정)`:''}. Ctrl+Z 로 되돌립니다.`);
};
// 인동거리 검토: 계산·규칙은 설계 엔진 서버에서(로그인 필요). CAD 는 놓인 주동의 외곽 점을 보내고 받은 표시만 A-INDG-CHCK 에 그린다.
studio.handlers.INDONG=()=>form('인동거리 검토 · 로그인 필요 · 설계 엔진 서버 계산',[{name:'floors',label:'기본 층수 (주동 블록에 FLOORS 속성이 있으면 그 값)',type:'number',value:20},{name:'floorHeight',label:'층고 (m)',type:'number',value:2.9}],async options=>{
 const floors=Number(options.floors),floorHeight=Number(options.floorHeight);
 if(!(floors>0)||!(floorHeight>0)){toast('층수와 층고는 0보다 커야 합니다.',true);return;}
 const document=engine.doc,request=indongRequest(document,{floors,floorHeight});
 if(!request.buildings.length){toast('도면에 주동 라이브러리에서 넣은 주동이 없습니다.',true);return;}
 let result;try{result=await studio.api('indong',request);}catch(error){toast(error.message||'인동 검토 요청 실패',true);return;}
 if(engine.doc!==document){toast('검토 중 도면이 바뀌어 표시를 넣지 않았습니다. 다시 실행하세요.',true);return;}
 const {document:next}=applyIndongMarks(document,result);
 execute({type:'lisp.apply',document:next});setSelected([]);refresh();
 const skipped=result.skipped?.length?` · 못 잰 주동 ${result.skipped.length}동`:'';
 toast(`인동 검토: 주동 ${result.buildings??0}동 · 마주보는 면 ${result.rows?.length??0}곳 · 부족 ${result.short??0}곳${skipped} (빨강 = 부족)`,(result.short||0)>0);
});
studio.context.suggestDetails=async options=>(await loadDetailSearch()).suggest(options);

let loadedPlotStyle=null;try{loadedPlotStyle=JSON.parse(localStorage.getItem('barun-custom-plot')||'null');}catch{}
function plotDialog(initial={}) {
 if(typeof fieldSync!=='undefined')try{fieldSync.refresh(FIELDEVAL.plot,{plotDate:new Date()});}catch{}   // 512: 출력할 때 필드
 let saved={};try{saved=JSON.parse(localStorage.getItem('barun-plot-settings')||'{}');}catch{}
 Object.assign(saved,initial);
 // 체크박스는 'on'/'off' 로 저장한다(꺼 둔 칸이 다음에 기본값으로 되살아나지 않게). 옛 설정의 'yes'/'no' 도 읽는다.
 const on=(name,fallback)=>saved[name]===undefined?fallback:['on','yes',true].includes(saved[name]);
 const field=(name,label,value,options)=>({name,label,value:saved[name]??value,...(options?{options}:{type:'number'})});
 const check=(name,label,fallback)=>({name,label,type:'checkbox',value:on(name,fallback)});
 const CHECKS=['fit','center','scaleLineweights','lineweights','plotStyles','darkenLight','mirror'];
 const PDF_DEVICE='__pdf__',SVG_DEVICE='__svg__';
 const SCALES=PLOT_STANDARD_SCALES;
 const PAPERS={A4:[210,297],A3:[297,420],A2:[420,594],A1:[594,841],A0:[841,1189]};
 // 화면표시: 창을 연 순간의 도면 화면 범위
 const corner=[world({x:0,y:0}),world({x:width,y:height})],displayWindow={minX:Math.min(corner[0].x,corner[1].x),minY:Math.min(corner[0].y,corner[1].y),maxX:Math.max(corner[0].x,corner[1].x),maxY:Math.max(corner[0].y,corner[1].y)};
 const readRaw=()=>{const raw=Object.fromEntries(new FormData(propertyForm));// Disabled controls are omitted by FormData; retain the displayed scale, copies and offsets for output.
  for(const name of ['denominator','scalePreset','copies','offsetX','offsetY'])raw[name]=fields.querySelector(`[name="${name}"]`)?.value;
  for(const name of CHECKS)raw[name]=fields.querySelector(`[name="${name}"]`)?.checked?'on':'off';return raw;};
 const persist=raw=>{try{localStorage.setItem('barun-plot-settings',JSON.stringify(raw));}catch{}};
 const normalizePlotValues=raw=>{
 // ACAD200 716: 축척 칸은 100 · 1:100 · 1=100 · 2:1 · 1/50 을 모두 받는다(결과는 분모 하나).
  const values={...raw,denominator:tryParseScale(raw.denominator)?.denominator??Number(raw.denominator),fit:raw.fit==='on',lineweights:raw.lineweights==='on',center:raw.center!=='off',offsetX:Number(raw.offsetX)||0,offsetY:Number(raw.offsetY)||0,mirror:raw.mirror==='on',scaleLineweights:raw.scaleLineweights==='on'};
  if(values.scope==='window')values.window=Object.fromEntries(['minX','minY','maxX','maxY'].map(key=>[key,Number(raw[key])]));
  if(values.scope==='display')values.window={...displayWindow};
  if(raw.plotStyles==='off')values.colorMode='color';   // 플롯 스타일로 플롯을 끄면 도면 색 그대로
  if(values.colorMode==='ctb'&&!loadedPlotStyle)values.colorMode='auto';
  return values;
 };
 const plotDocument=values=>values.scope==='selection'?{...engine.doc,entities:chosen()}:engine.doc;
 // 인쇄 불가 여백: 프린터가 못 찍는 가장자리와 도곽 여유를 위해 기본 10 mm. 0 은 테두리까지 꽉 채운다.
 const plotMargin=values=>{const raw=String(values.margin??'').trim();if(raw==='')return 10;const margin=Number(raw);if(!Number.isFinite(margin)||margin<0)throw Error('용지 여백은 0 이상의 숫자(mm)로 입력하세요.');return margin;};
 const plotOptions=values=>({...values,standardScales:SCALES,plotStyle:loadedPlotStyle,margin:plotMargin(values),darkenLightColors:values.darkenLight==='on',title:fileName,stamp:s7Tools?.plotStamp({fileName,denominator:values.denominator,paper:values.paper,device:printerSelect?.selectedOptions?.[0]?.textContent||''})||undefined});   // ACAD200 723 플롯 스탬프
 const multiPages=[];
 const pageValues=(raw,page)=>({...normalizePlotValues({...raw,scope:'window',minX:page.bounds.minX,minY:page.bounds.minY,maxX:page.bounds.maxX,maxY:page.bounds.maxY,paper:page.paper||raw.paper,denominator:page.denominator||raw.denominator,...multiPagePlotFit(page.bounds,page.paper||raw.paper,page.denominator||raw.denominator,Number(raw.margin)||0)}),window:page.bounds});
 const selectedPages=()=>multiMode.checked?multiPages.filter(page=>page.selected):[];
 const tileOf=raw=>['A4','A3'].includes(raw.tile)?{paper:raw.tile,overlap:Number(raw.tileOverlap)}:null;   // 나눠 찍기: 큰 용지를 A4·A3 여러 장으로(pdf_service.render_tiled)
 const savePDF=async raw=>{const selected=selectedPages();if(multiMode.checked&&!selected.length)throw Error('다중 플롯에서 PDF로 저장할 페이지를 하나 이상 선택하세요.');const tile=tileOf(raw);if(tile&&selected.length)throw Error('나눠 찍기는 한 장 출력에서만 됩니다. 다중 플롯을 끄세요.');let job=selected.length?{action:'plots',pages:selected.map(page=>{const values=pageValues(raw,page);return plotPDFJob(plotDocument(values),{...plotOptions(values),bookmark:page.title});})}:plotPDFJob(plotDocument(normalizePlotValues(raw)),plotOptions(normalizePlotValues(raw)));if(tile)job={...job,tile};const result=await studio.api('pdf',job);await studio.output(result.data,fileName+(tile?`_${tile.paper}나눠찍기.pdf`:'_plot.pdf'),'application/pdf');persist(raw);toast(tile?`${tile.paper} 나눠 찍기 PDF를 저장했습니다. 첫 장 안내대로 "실제 크기"로 인쇄하세요.`:'PDF 파일을 저장했습니다.');};
 const saveSVG=async raw=>{const pages=selectedPages();if(multiMode.checked&&!pages.length)throw Error('다중 플롯에서 SVG로 저장할 페이지를 하나 이상 선택하세요.');const page=pages[Math.min(previewIndex,pages.length-1)],values=page?pageValues(raw,page):normalizePlotValues(raw);download(await embedPlotImages(plotSVG(plotDocument(values),plotOptions(values))),fileName+'_plot.svg','image/svg+xml');persist(raw);toast(pages.length>1?'SVG 는 한 장씩 저장합니다. 미리보기 중인 페이지를 저장했습니다.':'SVG 파일을 저장했습니다.');};
 const printDrawing=async raw=>{if(!window.cadDesktop?.printDrawing)throw Error('이 실행에서는 프린터로 바로 보낼 수 없습니다. 프린터/플로터에서 PDF로 저장을 고르세요.');const pages=selectedPages();if(multiMode.checked&&!pages.length)throw Error('다중 플롯에서 출력할 페이지를 하나 이상 선택하세요.');const payload=pages.length?{pages:pages.map(page=>{const values=pageValues(raw,page);return {svg:plotSVG(plotDocument(values),plotOptions(values)),paper:values.paper,orientation:raw.orientation};}),printerName:raw.printerName||undefined,copies:Number(raw.copies)}:{svg:plotSVG(plotDocument(normalizePlotValues(raw)),plotOptions(normalizePlotValues(raw))),paper:raw.paper,orientation:raw.orientation,printerName:raw.printerName||undefined,copies:Number(raw.copies)};if(payload.pages)for(const page of payload.pages)page.svg=await embedPlotImages(page.svg);else payload.svg=await embedPlotImages(payload.svg);await window.cadDesktop.printDrawing(payload);persist(raw);toast('프린터로 전송했습니다.');};
 // 확인: 프린터/플로터에서 고른 장치로 보낸다(실제 프린터 · PDF로 저장 · SVG로 저장).
 const plotNow=async()=>{if(typeof layerNoticeOnce==='function')layerNoticeOnce('plot');const raw=readRaw();if(raw.printerName===PDF_DEVICE||tileOf(raw))return savePDF(raw);if(raw.printerName===SVG_DEVICE)return saveSVG(raw);return printDrawing(raw);};
 const savedScale=Number(saved.denominator||100);
 form('도면 출력 - 모형',[
  field('printerName','이름',''),
  field('paper','용지 크기','A3',Object.entries(PAPERS).map(([name,[a,b]])=>[name,`ISO ${name} (${a.toFixed(2)} × ${b.toFixed(2)} MM)`])),
  field('copies','복사 매수',1),
  field('scope','플롯 대상','all',[['display','화면표시'],['all','범위'],['window','윈도우'],['selection','선택한 객체']]),
  ...['minX','minY','maxX','maxY'].map((name,i)=>field(name,['왼쪽 X','아래 Y','오른쪽 X','위 Y'][i],[0,0,10000,7000][i])),
  field('offsetX','X (mm)',0),
  field('offsetY','Y (mm)',0),
  check('center','플롯의 중심',true),
  field('margin','인쇄 불가 여백 (mm)',10),
  check('fit','용지에 맞춤',true),
  {name:'scalePreset',label:'축척',value:SCALES.includes(savedScale)?String(savedScale):'custom',options:[['custom','사용자'],...SCALES.map(n=>[String(n),'1:'+n])]},
  field('denominator','1 밀리미터 =',100),
  check('scaleLineweights','선가중치 축척 (1:100 기준 비례)',false),
  field('colorMode','플롯 스타일 테이블','auto',[['auto','없음 (자동 보정)'],['mono','monochrome (흑백)'],['gray','회색조'],['color','도면 색상 그대로'],['ctb','CTB 파일 · 사용자 설정']]),
  check('lineweights','객체의 선가중치 플롯',true),
  check('plotStyles','플롯 스타일로 플롯',true),
  check('darkenLight','밝은 색 진하게 (노랑·하늘색을 흰 종이에서 읽히게)',false),
  field('orientation','도면 방향','landscape',[['portrait','세로'],['landscape','가로']]),
  check('mirror','대칭으로 플롯 (180° 회전)',false),
  field('tile','작은 프린터로 나눠 찍기','off',[['off','끄기 (한 장)'],['A4','A4 여러 장'],['A3','A3 여러 장']]),
  field('tileOverlap','붙임 겹침 (mm)',10),
 ],plotNow);
 const dialog=$('form-dialog'),fields=$('form-fields'),propertyForm=$('property-form');dialog.classList.add('plot-settings-dialog');
 // AutoCAD 플롯 창처럼 세 줄: 왼쪽(장치·용지·영역·간격) · 가운데(미리보기·매수·축척) · 오른쪽(펜·옵션·방향)
 const settingsPane=document.createElement('div');settingsPane.className='plot-settings-pane plot-col plot-col-left';
 const middleCol=document.createElement('div');middleCol.className='plot-col plot-col-middle';const rightCol=document.createElement('div');rightCol.className='plot-col plot-col-right';
 const previewPane=document.createElement('section');previewPane.className='plot-preview-pane';previewPane.setAttribute('aria-label','출력 미리보기');
 middleCol.append(previewPane);fields.append(settingsPane,middleCol,rightCol);   // 먼저 붙여 두어야 아래에서 옮긴 입력칸도 fields 에서 찾힌다
 const row=name=>fields.querySelector(`[name="${name}"]`)?.closest('.form-row');
 const section=(title,names,col=settingsPane)=>{const box=document.createElement('section'),heading=document.createElement('h3'),grid=document.createElement('div');box.className='plot-settings-section';heading.textContent=title;grid.className='plot-settings-grid';for(const name of names){const r=row(name);if(r){if(fields.querySelector(`[name="${name}"]`).type==='checkbox')r.classList.add('plot-check');grid.append(r);}}if(title)box.append(heading);box.append(grid);col.append(box);return box;};
 section('프린터/플로터',['printerName']);
 section('용지 크기',['paper']);
 const areaSection=section('플롯 영역',['scope','minX','minY','maxX','maxY']);
 const areaButton=document.createElement('button');areaButton.type='button';areaButton.className='plot-window-pick';areaButton.onclick=()=>{const values=readRaw();dialog.close();reset();mode='PLOTWINDOW';phase='point';params={plotValues:values};updatePrompt();canvas.focus();};areaSection.append(areaButton);
 section('플롯 간격띄우기 (인쇄 가능 영역 기준)',['offsetX','offsetY','center','margin']);
 section('',['copies'],middleCol);
 section('플롯 축척',['fit','scalePreset','denominator','scaleLineweights'],middleCol);
 const colorSection=section('플롯 스타일 테이블 (펜 지정)',['colorMode'],rightCol);
 section('플롯 옵션',['lineweights','plotStyles','darkenLight'],rightCol);
 const orientationSection=section('도면 방향',['orientation','mirror'],rightCol);
 section('나눠 찍기 (플로터 없이 큰 도면)',['tile','tileOverlap'],rightCol);
 // 도면 방향은 AutoCAD 처럼 세로/가로 단추로 고른다
 {const select=fields.querySelector('[name=orientation]'),group=document.createElement('div');group.className='plot-radio-group';group.setAttribute('role','radiogroup');group.setAttribute('aria-label','도면 방향');for(const [value,label] of [['portrait','세로'],['landscape','가로']]){const item=document.createElement('label');item.className='plot-radio';const radio=document.createElement('input');radio.type='radio';radio.name='orientation';radio.value=value;radio.checked=select.value===value;item.append(radio,' '+label);group.append(item);}select.closest('.form-row').replaceWith(group);orientationSection.querySelector('.plot-settings-grid').prepend(group);}
 let ready=false;
 const printerInput=settingsPane.querySelector('[name=printerName]');
 const printerSelect=document.createElement('select');printerSelect.name='printerName';printerSelect.setAttribute('aria-label','프린터/플로터');printerInput?.replaceWith(printerSelect);
 const fileDevices=()=>[[PDF_DEVICE,'PDF로 저장'],[SVG_DEVICE,'SVG로 저장']].map(([value,textContent])=>Object.assign(document.createElement('option'),{value,textContent}));
 const showPrinters=list=>{const printers=Array.isArray(list)?list:[];printerSelect.replaceChildren(...printers.map(printer=>Object.assign(document.createElement('option'),{value:printer.name,textContent:printer.displayName||printer.name})),...fileDevices());const values=[...printerSelect.options].map(o=>o.value);printerSelect.value=values.includes(saved.printerName)?saved.printerName:(printers.find(p=>p.isDefault)||printers[0])?.name||PDF_DEVICE;if(ready)drawPlotPreview();};
 showPrinters([]);Promise.resolve().then(()=>window.cadDesktop?.listPrinters?.()).then(showPrinters).catch(()=>showPrinters([]));
 const multiPlot=document.createElement('details');multiPlot.className='plot-multipPlot';const multiBody=document.createElement('div');multiBody.className='plot-multipPlot-body';const multiMode=document.createElement('input');multiMode.type='checkbox';multiMode.id='plot-multi-mode';multiMode.checked=!!initial.multi;multiPlot.open=!!initial.multi;const multiLabel=document.createElement('label');multiLabel.htmlFor=multiMode.id;multiLabel.append(multiMode,' 다중 플롯 사용');multiBody.append(multiLabel,document.createElement('p'));const pageList=document.createElement('div');pageList.className='plot-page-list';multiBody.append(pageList);multiPlot.append(Object.assign(document.createElement('summary'),{textContent:'다중 플롯'}),multiBody);fields.append(multiPlot);multiPlot.hidden=!initial.multi;
 const sheets=Array.isArray(engine.doc.sheets)?engine.doc.sheets:[];const boxes=unregisteredPlotBoxes(engine.doc.entities,engine.doc.layers);for(const sheet of sheets)if(sheet.bounds)multiPages.push({id:sheet.id||sheet.number,title:sheet.title||sheet.number||'시트',bounds:sheet.bounds,paper:sheet.paper||saved.paper||'A3',denominator:sheet.denominator||100,selected:!!initial.multi});for(const box of boxes){const spec=plotBoxSheetSpec(box.bounds,saved.paper||'A3');multiPages.push({id:box.id,title:'출력 박스',bounds:box.bounds,paper:spec.paper,denominator:spec.denominator,selected:!!initial.multi});}
 // PPP(모형공간 다중출력)는 도곽·출력 박스를 모두 골라 둔 채로 연다. 하나도 없으면 다중 플롯을 켜 두면 '페이지를 고르세요'로 막히므로 한 장 출력으로 연다(2026-10-27 맥판 시험).
 if(initial.multi&&!multiPages.length){multiMode.checked=false;multiPlot.open=false;toast('PPP · 도곽(SHEET)도 PB 출력 박스도 없어 한 장 출력으로 엽니다. 여러 장을 한 번에 찍으려면 먼저 PB 로 출력 박스를 그리세요.');}
 const renderPageList=()=>{pageList.replaceChildren(...multiPages.map((page,index)=>{const row=document.createElement('div');row.className='plot-page-row';const check=document.createElement('input');check.type='checkbox';check.checked=page.selected;check.onchange=()=>{page.selected=check.checked;drawPlotPreview();};const name=document.createElement('span');name.textContent=`${index+1}. ${page.title}`;const paper=document.createElement('select');for(const value of ['A4','A3','A2','A1','A0']){const option=document.createElement('option');option.value=value;option.textContent=value;option.selected=value===page.paper;paper.append(option);}paper.onchange=()=>{page.paper=paper.value;drawPlotPreview();};const scale=document.createElement('input');scale.type='number';scale.min='1';scale.value=page.denominator||100;scale.setAttribute('aria-label','페이지 축척');scale.onchange=()=>{page.denominator=Math.max(1,Number(scale.value)||100);drawPlotPreview();};const up=document.createElement('button');up.type='button';up.textContent='↑';up.onclick=()=>{if(index){[multiPages[index-1],multiPages[index]]=[multiPages[index],multiPages[index-1]];renderPageList();drawPlotPreview();}};const down=document.createElement('button');down.type='button';down.textContent='↓';down.onclick=()=>{if(index<multiPages.length-1){[multiPages[index],multiPages[index+1]]=[multiPages[index+1],multiPages[index]];renderPageList();drawPlotPreview();}};row.append(check,name,paper,scale,up,down);return row;}));};renderPageList();
 const autoNote=document.createElement('p');autoNote.className='plot-auto-note';autoNote.textContent='CTB가 없으면 화면용 밝은 색을 인쇄에 맞게 어둡게 바꾸고, 객체 용도에 따라 선굵기를 자동 적용합니다. 원본 도면은 변경하지 않습니다.';colorSection.append(autoNote);
 const ctb=document.createElement('input');ctb.type='file';ctb.accept='.ctb,.stb';ctb.setAttribute('aria-label','CTB·STB 플롯 스타일 파일');   // ACAD200 717: 이름 기준 STB 도
 const ctbRow=document.createElement('div');ctbRow.className='plot-ctb-row';const ctbStatus=document.createElement('span');ctbStatus.textContent=loadedPlotStyle?.name||'CTB 미선택 · 자동 보정으로 출력';
 ctb.onchange=async()=>{try{const file=ctb.files[0];if(!file)return;if(file.size>2000000)throw Error('CTB·STB 파일은 2MB 이하만 지원합니다.');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(const b of bytes)binary+=String.fromCharCode(b);loadedPlotStyle=await studio.api('plot-style',{name:file.name,data:btoa(binary)});ctbStatus.textContent=loadedPlotStyle.name;fields.querySelector('[name=colorMode]').value='ctb';redrawPlot();}catch(e){toast(e.message,true);}};
 const previewHeading=document.createElement('div');previewHeading.className='plot-preview-heading';const previewTitle=document.createElement('div');const previewH=document.createElement('h3');previewH.textContent='출력 미리보기';const previewP=document.createElement('p');previewP.textContent='실시간 미리보기 · 점선 = 인쇄 가능 영역';previewTitle.append(previewH,previewP);const prevButton=document.createElement('button');prevButton.type='button';prevButton.textContent='이전';const nextButton=document.createElement('button');nextButton.type='button';nextButton.textContent='다음';const fitButton=document.createElement('button');fitButton.type='button';fitButton.textContent='맞춤';const liveBadge=document.createElement('strong');liveBadge.textContent='실시간';previewHeading.append(previewTitle,prevButton,nextButton,fitButton,liveBadge);
 const live=document.createElement('div');live.className='plot-live';live.setAttribute('aria-label','출력 설정 실시간 미리보기');
 let previewZoom=1,previewIndex=0,previewX=0,previewY=0,previewDrag=null;
 const transformPreview=()=>{const svg=live.querySelector('svg');if(svg)svg.style.transform=`translate(${previewX}px,${previewY}px) scale(${previewZoom})`;};
 live.addEventListener('wheel',event=>{event.preventDefault();previewZoom=Math.min(5,Math.max(.25,previewZoom*(event.deltaY<0?1.1:.9)));transformPreview();},{passive:false});
 live.addEventListener('pointerdown',event=>{if(event.button!==0)return;previewDrag={x:event.clientX-previewX,y:event.clientY-previewY};live.setPointerCapture(event.pointerId);});
 live.addEventListener('pointermove',event=>{if(previewDrag){previewX=event.clientX-previewDrag.x;previewY=event.clientY-previewDrag.y;transformPreview();}});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])live.addEventListener(type,()=>{previewDrag=null;});
 const selectPreviewPage=delta=>{const pages=selectedPages();if(!pages.length)return;previewIndex=(previewIndex+delta+pages.length)%pages.length;drawPlotPreview();};
 prevButton.onclick=()=>selectPreviewPage(-1);nextButton.onclick=()=>selectPreviewPage(1);fitButton.onclick=()=>{previewZoom=1;previewX=previewY=0;transformPreview();};
 const summary=document.createElement('div');summary.className='plot-preview-summary';previewPane.append(live,previewHeading,summary);
 const input=name=>fields.querySelector(`[name="${name}"]`);
 const readPlotValues=()=>{const raw=readRaw(),fit=raw.fit==='on',center=raw.center!=='off';
  for(const key of ['minX','minY','maxX','maxY'])row(key).hidden=true;   // 좌표 숫자는 출력하는 사람이 볼 필요가 없다. 윈도우 < 단추가 채운다.
  areaButton.hidden=raw.scope!=='window';
  {const w=Math.abs(Number(raw.maxX)-Number(raw.minX))/1000,h=Math.abs(Number(raw.maxY)-Number(raw.minY))/1000;areaButton.textContent=w>0&&h>0?`윈도우 < · ${w.toLocaleString('ko-KR',{maximumFractionDigits:1})} × ${h.toLocaleString('ko-KR',{maximumFractionDigits:1})} m`:'윈도우 < · 도면에서 두 점 지정';}
  input('offsetX').disabled=input('offsetY').disabled=center;
  input('scalePreset').disabled=input('denominator').disabled=fit;
  input('copies').disabled=raw.printerName===PDF_DEVICE||raw.printerName===SVG_DEVICE;
  ctbRow.hidden=raw.colorMode!=='ctb';autoNote.hidden=raw.colorMode!=='auto'||raw.plotStyles==='off';input('colorMode').disabled=raw.plotStyles==='off';
  return raw;};
 input('scalePreset').addEventListener('change',()=>{const value=input('scalePreset').value;if(value!=='custom')input('denominator').value=value;});
 {const d=input('denominator');d.type='text';d.inputMode='decimal';d.placeholder='100 · 1:100 · 2:1';d.setAttribute('aria-label','출력 축척 (100, 1:100, 1=100, 2:1)');}
 input('denominator').addEventListener('input',()=>{const parsed=tryParseScale(input('denominator').value),value=parsed?String(+parsed.denominator.toFixed(6)):'';input('scalePreset').value=SCALES.map(String).includes(value)?value:'custom';});
 let fullPlotPreviewAllowed=false;
 const drawPlotPreview=()=>{const raw=readPlotValues(),pages=selectedPages();previewIndex=Math.min(previewIndex,Math.max(0,pages.length-1));const selected=pages[previewIndex],values=selected?pageValues(raw,selected):normalizePlotValues(raw);prevButton.disabled=nextButton.disabled=pages.length<2;
 // 큰 도면은 출력 영역을 정하기 전에 도면 전체를 미리보기로 그리지 않는다(창을 여는 데 수 초 걸렸다). 누르면 그린다.
 if(!fullPlotPreviewAllowed&&!values.window&&values.scope!=='selection'&&studio.isLargeDocument?.(engine.doc)){const note=document.createElement('div');note.className='plot-preview-deferred';note.append(Object.assign(document.createElement('p'),{textContent:'큰 도면이라 전체 미리보기는 누를 때만 그립니다. 보통은 플롯 대상을 화면표시나 윈도우로 골라 부분만 출력하세요.'}));const full=Object.assign(document.createElement('button'),{type:'button',textContent:'전체 미리보기'});full.onclick=()=>{fullPlotPreviewAllowed=true;drawPlotPreview();};note.append(full);live.replaceChildren(note);summary.replaceChildren();$('form-error').textContent='';return;}
 try{const options=plotOptions(values);live.innerHTML=plotSVG(plotDocument(values),options);
  // 인쇄 가능 영역(여백 안쪽)을 점선으로 겹쳐 보인다. 출력물에는 들어가지 않는다.
  const svg=live.querySelector('svg'),box=svg?.viewBox?.baseVal;if(svg&&box&&options.margin>0){const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');Object.entries({x:options.margin,y:options.margin,width:box.width-2*options.margin,height:box.height-2*options.margin,fill:'none',stroke:'#d33','stroke-width':.3,'stroke-dasharray':'2 1.5',class:'plot-printable-area'}).forEach(([k,v])=>rect.setAttribute(k,v));svg.append(rect);}
  const used=Number(svg?.getAttribute('data-plot-denominator'));
  if(!selected&&values.fit&&Number.isFinite(used)){input('denominator').value=String(Number(used.toFixed(3)));input('scalePreset').value=SCALES.includes(used)?String(used):'custom';}   // 용지에 맞춤일 때 실제 축척(1 mm = N 단위)을 보인다
  transformPreview();const styleLabel=raw.plotStyles==='off'?'플롯 스타일 끔 · 도면 색상':raw.colorMode==='ctb'?(loadedPlotStyle?.name||'CTB 없음 · 자동 보정'):input('colorMode').selectedOptions[0]?.textContent;
  const device=printerSelect.selectedOptions[0]?.textContent||'';
  summary.replaceChildren(...[device,`${selected?`${previewIndex+1}/${pages.length} · ${selected.title}`:raw.paper} · ${raw.orientation==='landscape'?'가로':'세로'}${raw.mirror==='on'?' · 대칭':''}`,'1 : '+Number((selected?values.denominator:used||values.denominator).toFixed(3)),styleLabel,svg?.getAttribute('data-fit-warning')].filter(Boolean).map(text=>Object.assign(document.createElement('span'),{textContent:text})));$('form-error').textContent='';}catch(error){const message=userErrorMessage(error);live.textContent=message;$('form-error').textContent=message;}};
 // 숫자 입력 중에는 레이아웃만 즉시 갱신하고 SVG는 짧게 모아 다시 그린다.
 let plotPreviewTimer=0;
 const redrawPlot=()=>{readPlotValues();clearTimeout(plotPreviewTimer);plotPreviewTimer=setTimeout(()=>{if(live.isConnected)drawPlotPreview();},80);};
 const custom=document.createElement('button');custom.type='button';custom.textContent='파일 없이 출력색·굵기 설정';
 custom.onclick=()=>{
  const dialog=document.createElement('dialog');dialog.className='livecheck-settings';const heading=document.createElement('h3');heading.textContent='색상별 출력 설정';dialog.append(heading);
  const palette={1:'#ff0000',2:'#ffff00',3:'#00ff00',4:'#00ffff',5:'#0000ff',6:'#ff00ff',7:'#ffffff'},names=['빨강','노랑','초록','청록','파랑','자홍','흰색'],rows=[];
  for(const [aci,color] of Object.entries(palette)){const row=document.createElement('label');row.style.cssText='display:flex;gap:12px;align-items:center;margin:10px 0';const label=document.createElement('span');label.textContent=names[Number(aci)-1];label.style.color=color;
   const output=document.createElement('input');output.type='color';output.value=loadedPlotStyle?.styles?.[aci]?.color||'#000000';output.setAttribute('aria-label',label.textContent+' 출력색');
   const weight=document.createElement('input');weight.type='number';weight.min='.01';weight.max='5';weight.step='.05';weight.value=loadedPlotStyle?.styles?.[aci]?.lineweight||.25;weight.setAttribute('aria-label',label.textContent+' 선굵기 mm');row.append(label,output,weight,document.createTextNode('mm'));dialog.append(row);rows.push({aci,output,weight});
  }
  const error=document.createElement('p'),save=document.createElement('button'),cancel=document.createElement('button');save.textContent='저장';cancel.textContent='취소';cancel.onclick=()=>dialog.close();
   save.onclick=()=>{if(rows.some(r=>!Number.isFinite(Number(r.weight.value))||Number(r.weight.value)<=0||Number(r.weight.value)>5)){error.textContent='선굵기는 0보다 크고 5mm 이하여야 합니다.';return;}loadedPlotStyle={name:'사용자 출력 설정',palette,styles:Object.fromEntries(rows.map(r=>[r.aci,{color:r.output.value,lineweight:Number(r.weight.value),screen:100}]))};try{localStorage.setItem('barun-custom-plot',JSON.stringify(loadedPlotStyle));}catch{}ctbStatus.textContent=loadedPlotStyle.name;fields.querySelector('[name=colorMode]').value='ctb';redrawPlot();dialog.close();};
   dialog.append(error,save,cancel);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
  };
 ctbRow.append(ctb,ctbStatus,custom);colorSection.append(ctbRow);
 for(const control of fields.querySelectorAll('input,select')){control.addEventListener('input',redrawPlot);control.addEventListener('change',redrawPlot);}
 const actions=dialog.querySelector('.dialog-actions'),okButton=actions.querySelector('[type=submit]');okButton.textContent='확인';
 // 미리보기...: 지금 미리보기를 화면 가득 크게 본다
 const bigPreview=document.createElement('button');bigPreview.type='button';bigPreview.dataset.temporaryFormAction='';bigPreview.className='plot-big-preview';bigPreview.textContent='미리보기...';
 bigPreview.onclick=()=>{let markup='';try{const raw=readRaw(),pages=selectedPages(),page=pages[Math.min(previewIndex,pages.length-1)],values=page?pageValues(raw,page):normalizePlotValues(raw);markup=plotSVG(plotDocument(values),plotOptions(values)).replaceAll('plot-window','plot-window-full');}catch(error){$('form-error').textContent=userErrorMessage(error);return;}const view=document.createElement('dialog');view.className='plot-full-preview';const close=Object.assign(document.createElement('button'),{type:'button',textContent:'닫기'});close.onclick=()=>view.close();const holder=document.createElement('div');holder.className='plot-full-preview-page';holder.innerHTML=markup;view.append(close,holder);view.addEventListener('close',()=>view.remove());view.addEventListener('keydown',e=>e.stopPropagation());document.body.append(view);view.showModal();};
 const cancelButton=document.createElement('button');cancelButton.type='button';cancelButton.dataset.temporaryFormAction='';cancelButton.textContent='취소';cancelButton.onclick=()=>dialog.close();
 const multiButton=document.createElement('button');multiButton.type='button';multiButton.dataset.temporaryFormAction='';multiButton.textContent='다중 플롯...';multiButton.onclick=()=>{multiPlot.hidden=!multiPlot.hidden;multiPlot.open=!multiPlot.hidden;if(!multiPlot.hidden&&multiPages.length&&!multiMode.checked){multiMode.checked=true;drawPlotPreview();}};
 actions.prepend(bigPreview);okButton.before(multiButton);actions.append(cancelButton);ready=true;drawPlotPreview();
}

// App workspace fullscreen intentionally does not use the browser Fullscreen API:
// Escape cancels CAD commands, and only the on-screen button exits this layout.
function setWorkspaceFocus(value){document.body.classList.toggle('workspace-focus',value);$('workspace-fullscreen-exit').hidden=!value;canvas.focus();window.cadDesktop?.setFullscreen?.(value).catch(error=>toast('창 전체화면 변경 실패: '+error.message,true));}
$('workspace-fullscreen').onclick=()=>setWorkspaceFocus(true);
$('workspace-fullscreen-exit').onclick=()=>setWorkspaceFocus(false);
{
 const control=document.createElement('label');control.className='command-opacity-control';control.textContent='배경 농도';
 const slider=document.createElement('input');slider.type='range';slider.min='15';slider.max='100';slider.step='5';slider.value='70';slider.setAttribute('aria-label','명령창 배경 농도');
 try{const saved=Number(localStorage.getItem('barun-command-opacity'));if(saved>=15&&saved<=100)slider.value=String(saved);}catch{}
 const applyOpacity=()=>{const alpha=Number(slider.value)/100;document.body.style.setProperty('--command-bg-alpha',String(alpha));document.body.style.setProperty('--command-bg-top',String(alpha*.3));document.body.style.setProperty('--command-bg-bottom',String(alpha));slider.setAttribute('aria-valuetext',slider.value+'%');};
 slider.oninput=()=>{applyOpacity();try{localStorage.setItem('barun-command-opacity',slider.value);}catch{}};slider.addEventListener('keydown',event=>event.stopPropagation());
 control.append(slider);document.querySelector('.command-title').append(control);applyOpacity();
 // 명령창은 도면 위에 겹쳐 있다(style.css). 도면 아래쪽 안내 문구가 가리지 않게 명령창 높이를 알려 준다.
 const watchDock=(tries=0)=>{const dock=document.querySelector('.drawing-column>.input-dock');if(!dock){if(tries<50)setTimeout(()=>watchDock(tries+1),100);return;}
  const column=dock.parentElement,update=()=>column.style.setProperty('--command-dock-h',Math.ceil(dock.getBoundingClientRect().height)+'px');
  update();if(typeof ResizeObserver==='function')new ResizeObserver(update).observe(dock);};
 watchDock();
}

// 앱을 닫을 때 데스크톱이 저장을 요청한다. 그 자리도 정상 종료다.
// 다른 칸의 탭 메뉴에서 고른 저장·다른 이름으로 저장(main 이 이 칸을 앞으로 꺼낸 뒤 보낸다).
window.cadDesktop?.onRunCommand?.(name=>{if(name==='SAVE')tabMenuRun(()=>saveNow())();else if(name==='SAVEAS')tabMenuRun(()=>openSaveDialog(true))();});
if(window.cadDesktop)window.cadDesktop.onSaveRequested(async()=>{const ok=await saveAllDrawings();markCleanExit();return ok;});
// 칸 닫기는 본체가 beforeunload 없이 닫는다(desktop-docs.cjs remove) → [저장 안 함]으로 닫을 때 여기서 정상 종료 표시를 남긴다. 저장 쪽은 onSaveRequested 가 남긴다.
if(window.cadDesktop?.onCloseChoiceRequested)window.cadDesktop.onCloseChoiceRequested(({closing,scope})=>new Promise(resolve=>{
  // 자동 정리는 지금도 손대지 않은 빈 칸일 때만 허용한다. 편집/읽기 중이면 조용히 유지한다.
  if(scope==='empty'){const state=drawingOpenState();resolve(!state.busy&&state.drawings.length&&state.drawings.every(tab=>tab.empty)?'discard':'cancel');return;}
  // 빈 도면과 저장된 도면은 복구 타이머 때문에 저장 확인을 띄우지 않는다.
  if(documents?!documents.dirtyTabs().length:!dirty){resolve('discard');return;}
 const dialog=document.createElement('dialog');dialog.className='close-confirm';
 const finish=choice=>{if(!dialog.isConnected)return;dialog.close();dialog.remove();resolve(choice);};
 dialog.innerHTML=`<div class="dialog-header"><h2>${scope==='window'?'도면 창 닫기':closing?'CAD 종료':'도면 다시 열기'}</h2><button type="button" class="close-x" aria-label="취소">×</button></div><p class="close-question">변경한 도면을 저장할까요?</p><p class="close-note">변경된 도면을 차례로 저장합니다.</p><div class="dialog-actions"><button type="button" data-choice="cancel">취소</button><button type="button" data-choice="discard">저장 안 함</button><button type="button" class="primary" data-choice="save">${scope==='window'?'저장 후 닫기':closing?'저장 후 종료':'저장 후 다시 열기'}</button></div>`;
 dialog.querySelector('.close-x').onclick=()=>finish('cancel');
 dialog.querySelectorAll('[data-choice]').forEach(button=>button.onclick=()=>finish(button.dataset.choice));
 dialog.addEventListener('cancel',event=>{event.preventDefault();finish('cancel');});
 document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-choice="save"]').focus();
}).then(choice=>{if(closing&&choice==='discard')markCleanExit();return choice;}));
/* 공통 계정 및 업데이트 창을 연다. */
if(window.cadDesktop?.checkUpdate){
  window.cadDesktop.onUpdateStatus?.(status=>window.barunRenderUpdate?.(status));
}

// One stable application shell: top categories, a persistent ribbon and familiar CAD quick tools.
{
 const workspace=document.querySelector('.workspace'),tools=document.querySelector('.tools'),inspector=document.querySelector('.inspector'),buttons=document.getElementById('tool-buttons');
 tools.id='top-ribbon';workspace.before(tools);tools.replaceChildren();
 const ribbonBody=document.createElement('div');ribbonBody.className='ribbon-body';
 const headerContext=document.createElement('div');headerContext.className='header-context drawing-context-bar';headerContext.setAttribute('aria-label','도면 레이어와 작도 보조');
 // 파일·작업·건축·변환은 주 메뉴에만 두고, 도면 상태 도구는 바로 아래의 독립된 줄에 둔다.
 ribbonBody.append(buttons);tools.append(ribbonBody);const header=document.querySelector('body>header');header.after(headerContext);

 installBatchConverter(studio);
 studio.expressionCalculator=installExpressionCalculator({canvas,nearby:(p,tolerance)=>nearby(p,tolerance),screen,worldPoint:e=>world(localPoint(e)),scale:()=>scale});
 studio.numberCalculator=installNumberCalculator({canvas,visible,chosen,worldPoint:e=>world(localPoint(e)),scale:()=>scale,idle:()=>mode==='SELECT'&&phase==='idle'&&!busy,reset,toast,announce:message=>log('명령: '+message),status:message=>log(message),started:op=>{lastCommand='NUMCALC';run.lastCalculatorOperator=op;},setSelection:setSelected,insertResult:entity=>{const layer=engine.doc.layers.find(item=>item.id===entity.layer);if(!layer||layer.locked||layer.visible===false||layer.frozen)entity.layer=activeLayer;const ids=execute({type:'add',entity});setSelected(ids);return ids;}});
 installLisp(studio,{engine,selected:()=>selected,activeLayer:()=>activeLayer,ask:askLispInput,pickPoint:()=>pickPointOnce('리습에 전달할 좌표를 도면에서 클릭하세요. Esc로 취소합니다.'),apply:doc=>{execute({type:'lisp.apply',document:doc});setSelected([]);refresh();fit();}});
 installNewBuild(studio);

 const layerLabel=document.createElement('div');layerLabel.className='current-layer-control';
 const layerCaption=document.createElement('span');layerCaption.className='current-layer-caption';layerCaption.textContent='레이어';
 const layerSelect=document.createElement('select');layerSelect.id='current-layer-select';layerSelect.hidden=true;layerSelect.tabIndex=-1;layerSelect.setAttribute('aria-hidden','true');
 layerSelect.onchange=()=>safe(()=>{
  const target=layerSelect.value;if(!target){refresh();return;}
  if(selected.size){const layer=layerMap().get(target);if(!layer||layer.locked||layer.frozen||layer.visible===false)throw Error('잠기거나 숨긴 레이어로는 옮길 수 없습니다.');const ids=[...selected];execute({type:'update',ids,changes:{layer:target}});log(ids.length+'개를 '+layer.name+' 레이어로 옮겼습니다. Ctrl+Z 로 되돌립니다.');}
  else activeLayer=target;refresh();canvas.focus();
 });
 const layerTrigger=document.createElement('button');layerTrigger.type='button';layerTrigger.id='current-layer-trigger';layerTrigger.className='current-layer-trigger';layerTrigger.setAttribute('aria-haspopup','listbox');layerTrigger.setAttribute('aria-expanded','false');layerTrigger.title='레이어 색상·종류를 확인하고 현재 레이어 또는 선택 객체의 레이어를 변경';
 const triggerSwatch=document.createElement('span');triggerSwatch.className='current-layer-swatch';
 const triggerCopy=document.createElement('span');triggerCopy.className='current-layer-trigger-copy';const triggerName=document.createElement('strong');const triggerMeta=document.createElement('small');triggerCopy.append(triggerName,triggerMeta);
 const triggerArrow=document.createElement('span');triggerArrow.className='current-layer-arrow';triggerArrow.textContent='⌄';layerTrigger.append(triggerSwatch,triggerCopy,triggerArrow);
 const layerPopover=document.createElement('div');layerPopover.id='current-layer-popover';layerPopover.className='current-layer-popover';layerPopover.hidden=true;
 const layerSearch=document.createElement('input');layerSearch.type='search';layerSearch.id='current-layer-search';layerSearch.placeholder='레이어 이름·종류·색상 검색';layerSearch.setAttribute('aria-label','레이어 검색');
 const layerList=document.createElement('div');layerList.id='current-layer-list';layerList.className='current-layer-list';layerList.setAttribute('role','listbox');layerList.setAttribute('aria-label','레이어 목록');
 const layerHeading=document.createElement('div');layerHeading.className='current-layer-heading';
 const layerTitle=document.createElement('strong');layerTitle.textContent='레이어';
 const layerManage=document.createElement('button');layerManage.type='button';layerManage.textContent='관리';layerManage.onclick=()=>{closeCurrentLayerChooser();run('LAYER');};
 const layerAdd=document.getElementById('add-layer');layerHeading.append(layerTitle,layerManage,layerAdd);
 const layerColumns=document.createElement('div');layerColumns.className='current-layer-columns';
 for(const text of ['현재 · 레이어','표시','잠금','색 · 선종류 · 굵기']){const label=document.createElement('span');label.textContent=text;layerColumns.append(label);}
 /* 고른 객체의 레이어 끄기·이것만 보기·잠그기(사장님 10-26 "선택 레이어만 끄는 기능이 안 보이는데 보통 여기 있잖아 · 안 보이게 있고 안 지워지게 있고").
    명령은 이미 있다(LAYOFF·LAYISO·LAYLOCK / LAYON·LAYUNLOCK·LAYRESTORE). 객체를 안 골랐으면 명령이 고르라고 알린다(LAYISO 는 바로 고르기). */
 const layerTools=document.createElement('div');layerTools.className='current-layer-tools';layerTools.setAttribute('role','group');layerTools.setAttribute('aria-label','고른 객체의 레이어');
 layerTools.title='고른 객체의 레이어를 끄기·이것만 보기·잠그기 (객체를 먼저 고르세요)';
 const layerTool=(label,icon,command,title,main)=>{const b=document.createElement('button');b.type='button';b.className='current-layer-tool'+(main?' main':'');b.innerHTML=icon+'<span></span>';b.lastChild.textContent=label;b.title=`${title} (${command})`;b.onclick=()=>{closeCurrentLayerChooser();run(command);};return b;};
 const layerToolsSep=document.createElement('i');layerToolsSep.className='current-layer-tools-sep';layerToolsSep.setAttribute('aria-hidden','true');
 layerTools.append(layerTool('끄기',LAYER_ICON_EYE_OFF,'LAYOFF','고른 객체의 레이어를 끕니다',true),layerTool('이것만',LAYER_ICON_EYE,'LAYISO','고른 객체의 레이어만 남기고 나머지를 끕니다',true),layerTool('잠그기',LAYER_ICON_LOCK,'LAYLOCK','고른 객체의 레이어를 잠가 지워지거나 움직이지 않게 합니다',true),layerToolsSep,
  layerTool('모두 켜기',LAYER_ICON_EYE,'LAYON','꺼 둔 레이어를 모두 켭니다'),layerTool('잠금 풀기',LAYER_ICON_UNLOCK,'LAYUNLOCK','잠근 레이어를 모두 풉니다'),layerTool('되돌리기',LAYER_ICON_UNDO,'LAYRESTORE','이것만 보기 전 레이어 표시로 되돌립니다'));
 const layerFooter=document.createElement('p');layerFooter.id='current-layer-footer';layerFooter.className='current-layer-footer';
 /* 객체 특성(AutoCAD 특성 패널): 레이어 설정과 별개로 객체마다 붙는 색·선종류·선굵기. 선택 객체가 있으면 그 객체를, 없으면 이후 그릴 객체(CECOLOR·CELTYPE·CELWEIGHT)를 바꾼다. */
 const objectProps=document.createElement('div');objectProps.className='current-object-properties';objectProps.setAttribute('role','group');objectProps.setAttribute('aria-label','객체 특성');
 const objectTitle=document.createElement('strong');objectTitle.id='current-object-title';objectTitle.textContent='이후 그릴 객체';
 const objectHint=document.createElement('small');objectHint.textContent='객체 특성 · ByLayer = 아래 레이어 설정을 따름';
 const objectColor=document.createElement('label');objectColor.className='current-property-color';const colorSwatch=document.createElement('i');colorSwatch.setAttribute('aria-hidden','true');const colorSelect=document.createElement('select');colorSelect.id='current-color-select';colorSelect.setAttribute('aria-label','객체 색');objectColor.append(colorSwatch,colorSelect);
 const linetypeSelect=document.createElement('select');linetypeSelect.id='current-linetype-select';linetypeSelect.setAttribute('aria-label','객체 선종류');
 const lineweightSelect=document.createElement('select');lineweightSelect.id='current-lineweight-select';lineweightSelect.setAttribute('aria-label','객체 선굵기');
 colorSelect.onchange=()=>safe(()=>changeFromPropertyStrip('color',colorSelect.value));
 linetypeSelect.onchange=()=>safe(()=>changeFromPropertyStrip('linetype',linetypeSelect.value));
 lineweightSelect.onchange=()=>safe(()=>changeFromPropertyStrip('lineweight',lineweightSelect.value));
 linetypeSelect.addEventListener('pointerdown',()=>{const keep=linetypeSelect.value;rebuildPropertyStrip();linetypeSelect.value=keep;});
 const objectHead=document.createElement('div');objectHead.className='current-object-head';objectHead.append(objectTitle,objectHint);
 const objectRow=document.createElement('div');objectRow.className='current-object-row';objectRow.append(objectColor,linetypeSelect,lineweightSelect);
 objectProps.append(objectHead,objectRow);
 layerPopover.append(layerHeading,layerSearch,layerTools,objectProps,layerColumns,layerList,layerFooter);
 layerTrigger.onclick=()=>{const opening=layerPopover.hidden;layerPopover.hidden=!opening;layerTrigger.setAttribute('aria-expanded',String(opening));if(opening){rebuildCurrentLayerChooser();syncCurrentLayerChooser();layerSearch.focus();layerSearch.select();}};
 layerSearch.oninput=rebuildCurrentLayerChooser;
 layerPopover.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();closeCurrentLayerChooser({focus:true});}});
 document.addEventListener('pointerdown',e=>{if(!layerLabel.contains(e.target))closeCurrentLayerChooser();});
 layerLabel.append(layerCaption,layerSelect,layerTrigger,layerPopover);
 const organizeButton=document.createElement('button');organizeButton.type='button';organizeButton.className='organize-layer';organizeButton.innerHTML='<b>✦</b><span>자동정리</span>';organizeButton.title='레이어 자동 분류 미리보기 · 승인 후 적용';organizeButton.onclick=()=>layerReviewDialog();
 headerContext.append(layerLabel,organizeButton);rebuildPropertyStrip();syncPropertyStrip();

 const assistDialog=document.createElement('dialog');assistDialog.className='drafting-dialog';assistDialog.setAttribute('aria-label','설정 · 작도 보조와 도면 출력');
 const heading=document.createElement('h2');heading.textContent='작도 보조 · 도면 설정';const closeAssist=document.createElement('button');closeAssist.textContent='닫기';closeAssist.onclick=()=>assistDialog.close();
 inspector.classList.remove('ribbon-popover');assistDialog.append(heading,inspector,closeAssist);document.body.append(assistDialog);
 assistDialog.addEventListener('close',()=>canvas.focus());
 // 상태표시줄 단추는 기능 키 순서(F3 객체 스냅·F8 직교·F9 그리드 스냅·F10 극좌표·F11 객체 추적). 예전 순서는 기능을 붙여 넣은 순서였을 뿐이다.
 const assistButtons=document.createElement('div');assistButtons.className='drafting-quick cad-statusbar';
 for(const id of ['osnap','ortho','snap','polar','otrack']){
  const button=document.createElement('button');button.type='button';button.id='quick-'+id;
  button.title='왼쪽 클릭: 켜기/끄기 · 오른쪽 클릭: 설정';
  button.setAttribute('aria-haspopup','dialog');
  button.onclick=()=>{$(id).checked=!$(id).checked;draftingChanged();};
  button.oncontextmenu=event=>{
   event.preventDefault();event.stopPropagation();
   if(!assistDialog.open)assistDialog.showModal();
   const target=$(id==='osnap'?'snap-intersection':id==='snap'?'spacing':'ortho');
   target?.scrollIntoView({block:'center'});target?.focus({preventScroll:true});
  };
  assistButtons.append(button);
 }
 document.querySelector('footer').insertBefore(assistButtons,$('position'));draftingChanged();

 const quickBar=document.createElement('aside');quickBar.className='quick-tools';quickBar.setAttribute('aria-label','빠른 작도 도구');
 const quickToggle=document.createElement('button');quickToggle.type='button';quickToggle.className='quick-tools-toggle';quickToggle.innerHTML='<b aria-hidden="true">‹</b><span>도구 접기</span>';
 const setQuickToolsCollapsed=value=>{quickBar.classList.toggle('is-collapsed',value);quickToggle.setAttribute('aria-expanded',String(!value));quickToggle.setAttribute('aria-label',value?'빠른 작도 도구 열기':'빠른 작도 도구 접기');quickToggle.title=quickToggle.getAttribute('aria-label');quickToggle.querySelector('b').textContent=value?'›':'‹';quickToggle.querySelector('span').textContent=value?'열기':'도구 접기';try{localStorage.setItem('barun-quick-tools-collapsed',value?'1':'0');}catch{}requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));};
 quickToggle.onclick=()=>setQuickToolsCollapsed(!quickBar.classList.contains('is-collapsed'));quickBar.append(quickToggle);
 const quickGroups=[['SELECT'],['LINE','PLINE','RECTANGLE','CIRCLE','HATCH'],['OFFSET','TRIM','COPY','MOVE','ROTATE'],['DIMLINEAR','TEXT','BLOCK','LAYER','DETAILS'],['CALC']];
 // 좁은 빠른 도구 칸(96px)에서 잘리지 않도록 짧은 이름을 쓴다. 전체 이름은 title 로 보인다.
 const quickLabels={HATCH:'해치',OFFSET:'간격띄우기',TRIM:'자르기',DIMLINEAR:'치수',BLOCK:'블록',LAYER:'레이어',RECTANGLE:'사각형',CALC:'계산기',DETAILS:'상세 찾기'};
 // 버튼은 끌어서 순서·묶음을 바꿀 수 있고(Alt+↑↓ 도 같음), 바꾼 순서는 저장된다.
 let quickOrder=quickGroups;try{quickOrder=orderedQuickGroups(quickGroups,JSON.parse(localStorage.getItem(QUICK_TOOLS_ORDER_KEY)||'null'));}catch{}
 const quickGroupEls=[];let quickDragName=null;
 const saveQuickOrder=next=>{quickOrder=next;try{localStorage.setItem(QUICK_TOOLS_ORDER_KEY,JSON.stringify(next));}catch{}};
 const clearQuickDrop=()=>quickBar.querySelectorAll('.is-drop-before,.is-drop-after,.is-drop-end').forEach(n=>n.classList.remove('is-drop-before','is-drop-after','is-drop-end'));
 const quickDropTarget=event=>{const button=event.target.closest?.('.quick-tools button[data-command]:not(.quick-more)'),group=quickGroupEls.indexOf(event.target.closest?.('.quick-tools>div'));if(group<0)return null;if(!button||button.dataset.command===quickDragName)return {group,target:null,before:true};const box=button.getBoundingClientRect();return {group,target:button.dataset.command,before:event.clientY<box.top+box.height/2,button};};
 const placeQuickButton=(name,next)=>{const button=quickBar.querySelector(`button[data-command="${name}"]`);next.forEach((names,index)=>{const at=names.indexOf(name);if(at<0)return;const after=quickGroupEls[index].querySelector(`button[data-command="${names[at+1]}"]`);quickGroupEls[index].insertBefore(button,after||null);});saveQuickOrder(next);};
 for(const names of quickOrder){const group=document.createElement('div');quickGroupEls.push(group);for(const name of names){const c=COMMANDS.find(item=>item.name===name),button=document.createElement('button'),icon=document.createElement('b'),label=document.createElement('span');button.dataset.command=name;button.draggable=true;button.title=(c?.label||name)+(settings.aliases[name]?' · '+settings.aliases[name]:'')+' · 끌어서 순서 바꾸기';icon.innerHTML=currentCommandIconSvg(name,c);label.textContent=quickLabels[name]||c?.label||name;button.append(icon,label);group.append(button);}quickBar.append(group);}
 quickBar.addEventListener('dragstart',event=>{const button=event.target.closest?.('button[data-command]');if(!button||!button.draggable)return;quickDragName=button.dataset.command;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',quickDragName);button.classList.add('is-dragging');});
 quickBar.addEventListener('dragover',event=>{if(!quickDragName)return;const drop=quickDropTarget(event);if(!drop)return;event.preventDefault();event.dataTransfer.dropEffect='move';clearQuickDrop();if(drop.button)drop.button.classList.add(drop.before?'is-drop-before':'is-drop-after');else quickGroupEls[drop.group].classList.add('is-drop-end');});
 quickBar.addEventListener('drop',event=>{if(!quickDragName)return;const drop=quickDropTarget(event);clearQuickDrop();if(!drop)return;event.preventDefault();placeQuickButton(quickDragName,moveQuickTool(quickOrder,quickDragName,drop));});
 quickBar.addEventListener('dragend',()=>{quickBar.querySelector('.is-dragging')?.classList.remove('is-dragging');clearQuickDrop();quickDragName=null;});
 quickBar.addEventListener('keydown',event=>{const button=event.target.closest?.('button[data-command]');if(!event.altKey||!['ArrowUp','ArrowDown'].includes(event.key)||!button?.draggable)return;event.preventDefault();event.stopPropagation();const name=button.dataset.command,flat=quickOrder.flatMap((names,group)=>names.map(item=>({item,group}))),at=flat.findIndex(x=>x.item===name),other=flat[at+(event.key==='ArrowUp'?-1:1)];if(!other)return;placeQuickButton(name,moveQuickTool(quickOrder,name,{group:other.group,target:other.item,before:event.key==='ArrowUp'}));button.focus();});
 const more=document.createElement('button');more.dataset.command='HELP';more.className='quick-more';more.innerHTML='<b>•••</b><span>더보기</span>';quickBar.append(more);
 const drawingRow=document.querySelector('.drawing-row'),drawingColumn=document.querySelector('.drawing-column');if(drawingRow&&drawingColumn)drawingRow.insertBefore(quickBar,drawingColumn);
 let quickToolsInitiallyCollapsed=false;try{quickToolsInitiallyCollapsed=localStorage.getItem('barun-quick-tools-collapsed')==='1';}catch{}setQuickToolsCollapsed(quickToolsInitiallyCollapsed);

 const search=document.getElementById('global-command-search'),searchResults=document.getElementById('global-command-results'),searchBox=search.closest('.command-search');
 const searchCommands=visibleCommands();let searchMatches=[],searchActive=-1;
 const favoriteKey='barun-command-favorites-v1';
 let commandFavorites=new Set();
 try{const saved=JSON.parse(localStorage.getItem(favoriteKey)||'[]');if(Array.isArray(saved))commandFavorites=new Set(saved.filter(name=>typeof name==='string'&&searchCommands.some(c=>c.name===name)));}catch{}

 const closeSearchResults=({clear=false,focusCanvas=false}={})=>{searchResults.hidden=true;searchResults.replaceChildren();search.setAttribute('aria-expanded','false');search.removeAttribute('aria-activedescendant');searchMatches=[];searchActive=-1;if(clear)search.value='';if(focusCanvas)canvas.focus();};
 const setSearchActive=index=>{if(!searchMatches.length)return;searchActive=(index+searchMatches.length)%searchMatches.length;const buttons=[...searchResults.querySelectorAll('.command-search-result')];for(const [i,button] of buttons.entries()){const active=i===searchActive;button.classList.toggle('is-active',active);button.setAttribute('aria-selected',String(active));}const active=buttons[searchActive];if(active){search.setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest'});}};
 const runSearchCommand=command=>{closeSearchResults({clear:true});if(command.architecture){launchArchitectureReference(command.architecture);return;}run(command.name);};
 const favoriteToolbar=document.createElement('div');favoriteToolbar.className='command-favorite-toolbar';favoriteToolbar.setAttribute('role','group');favoriteToolbar.setAttribute('aria-label','즐겨찾기 명령');document.querySelector('header .tool-tabs').after(favoriteToolbar);
 // 건축 설계도구 ☆ 즐겨찾기도 검색창 즐겨찾기 목록에 함께 보인다(상단 줄과 같은 순서).
 const architectureFavoriteEntries=()=>architectureAssistState.favorites.map(id=>architectureReferenceCommands.find(spec=>spec.id===id)).filter(Boolean).map(spec=>({architecture:spec,name:spec.commandCode||spec.alias,label:spec.label}));
 const renderFavoriteToolbar=()=>{
  // 건축 설계도구 카드의 ☆ 즐겨찾기도 일반 명령 즐겨찾기처럼 이 줄에 버튼으로 둔다(일반 명령 다음, 즐겨찾기 순서대로).
  const architectureFavorites=architectureAssistState.favorites.map(id=>architectureReferenceCommands.find(spec=>spec.id===id)).filter(Boolean);
  favoriteToolbar.replaceChildren();favoriteToolbar.hidden=!commandFavorites.size&&!architectureFavorites.length;
  for(const name of commandFavorites){
   const command=searchCommands.find(item=>item.name===name);if(!command)continue;
   const button=document.createElement('button');button.type='button';button.className='command-favorite-tool';
   button.title=command.label+(settings.aliases[name]?' · '+settings.aliases[name]:'');button.setAttribute('aria-label',command.label);
   button.innerHTML=currentCommandIconSvg(name,command);
   button.onclick=()=>{runSearchCommand(command);canvas.focus();};favoriteToolbar.append(button);
  }
  for(const spec of architectureFavorites){
   const button=document.createElement('button');button.type='button';button.className='command-favorite-tool architecture-favorite-tool';
   const code=spec.commandCode||spec.alias,hotkey=architectureAssistState.hotkeys[spec.id];
   button.title=spec.label+(code?' · '+code:'')+(hotkey?' · '+hotkey:'');button.setAttribute('aria-label',spec.label);
   button.innerHTML=architectureCommandIconSvg(spec);
   button.onclick=()=>{launchArchitectureReference(spec);canvas.focus();};favoriteToolbar.append(button);
  }
 };
 refreshFavoriteToolbar=renderFavoriteToolbar;
 renderFavoriteToolbar();
 /* 검색 순위: 이름·별칭 완전일치(0) > 라벨 완전일치(1) > 이름·별칭 앞부분(2) > 라벨 앞부분·낱말 시작(3) > 포함(4).
    같은 순위 안에서는 카탈로그 순서를 지킨다. 50개 자르기는 순위를 매긴 뒤에 하므로 완전일치가 잘려 나가지 않는다. */
 const searchScores=new Map();
 /* 순위·Enter 판정은 command-search.js. 명령창과 같은 해석(resolveCommand + 한글 자판 보정)으로 풀리는 입력은 항상 1위. */
 const resolveSearchQuery=query=>resolveCommand(query,settings)||preprocessImeCommand(query,'idle',settings).command||null;
 const renderSearchResults=()=>{
  const query=search.value.trim();searchResults.replaceChildren();searchActive=-1;searchScores.clear();
  search.removeAttribute('aria-activedescendant');
  searchMatches=query?rankCommandSearch(searchCommands,query,{aliases:settings.aliases,resolve:resolveSearchQuery,terms:commandSearchTerms}).filter(item=>!archCardHiddenName(item.command.name)).map(item=>{searchScores.set(item.command,item.score);return item.command;}):[...[...commandFavorites].map(name=>searchCommands.find(c=>c.name===name)).filter(Boolean),...architectureFavoriteEntries()];
  if(!query){const heading=document.createElement('strong');heading.className='command-favorites-heading';heading.textContent='★ 즐겨찾기';searchResults.append(heading);}
  for(const [index,c] of searchMatches.entries()){
   const row=document.createElement('div');row.className='command-search-row';
   const button=document.createElement('button'),label=document.createElement('strong'),meta=document.createElement('small');
   button.type='button';button.id=`global-command-result-${index}`;button.className='command-search-result';button.dataset.command=c.name;button.setAttribute('role','option');button.setAttribute('aria-selected','false');label.textContent=c.label;
   const alias=settings.aliases[c.name];meta.textContent=c.architecture?['건축 설계도구',c.name,architectureAssistState.hotkeys[c.architecture.id]].filter(Boolean).join(' · '):[alias?`별칭 ${alias}`:'',`명령 ${c.name}`].filter(Boolean).join(' · ');button.append(label,meta);
   if(!c.architecture&&settings.hotkeys[c.name]){const hotkey=document.createElement('kbd');hotkey.textContent=settings.hotkeys[c.name];button.append(hotkey);}
   button.addEventListener('pointerenter',()=>setSearchActive(index));button.addEventListener('click',event=>{event.stopPropagation();runSearchCommand(c);});
   button.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();if(c.architecture)return;closeSearchResults({clear:true});showCommandShortcut(c.name);});
   const star=document.createElement('button');star.type='button';star.className='command-search-favorite';
   const updateStar=()=>{const saved=c.architecture?architectureAssistState.favorites.includes(c.architecture.id):commandFavorites.has(c.name);star.textContent=saved?'★':'☆';star.setAttribute('aria-pressed',String(saved));star.setAttribute('aria-label',c.label+(saved?' 즐겨찾기 해제':' 즐겨찾기 추가'));star.title=star.getAttribute('aria-label');};updateStar();
   star.addEventListener('keydown',event=>event.stopPropagation());
   star.onclick=event=>{event.stopPropagation();if(c.architecture){persistArchitectureAssistState(toggleAssistFavorite(architectureAssistState,c.architecture.id));renderSearchResults();search.focus();return;}const next=new Set(commandFavorites);if(next.has(c.name))next.delete(c.name);else next.add(c.name);try{localStorage.setItem(favoriteKey,JSON.stringify([...next]));commandFavorites=next;}catch{toast('즐겨찾기를 저장하지 못했습니다.',true);return;}renderFavoriteToolbar();if(query)updateStar();else{renderSearchResults();search.focus();}};
   row.append(button,star);searchResults.append(row);
  }
  if(!searchMatches.length){const empty=document.createElement('p');empty.className='command-search-empty';empty.textContent=query?'검색 결과가 없습니다.':'검색한 명령 옆 ☆를 누르면 여기에 모입니다.';searchResults.append(empty);}
  const hint=document.createElement('small');hint.className='command-search-hint';hint.textContent='클릭: 실행 · 우클릭: 단축키 수정 · ☆: 즐겨찾기';searchResults.append(hint);searchResults.hidden=false;search.setAttribute('aria-expanded','true');
 };
 /* Enter 는 사용자가 ↑↓ 로 고른 항목, 또는 분명한 1위(완전일치 / 결과 하나 / 유일한 앞부분 일치)만 실행한다.
    LA→BLA, 복사→LMA 처럼 부분일치 첫 항목이 실행되던 문제를 막고, 애매하면 첫 항목을 강조만 한다. */
 const searchRun=()=>{
  if(!search.value.trim()){if(searchActive>=0&&searchMatches[searchActive])runSearchCommand(searchMatches[searchActive]);return;}
  if(searchResults.hidden)renderSearchResults();
  const decision=searchEnterDecision(searchMatches.map(command=>({command,score:searchScores.get(command)})),searchActive);
  if(decision.action==='run'){runSearchCommand(decision.command);return;}
  if(decision.action==='hint'){setSearchActive(0);toast('일치하는 명령이 여러 개입니다. ↑↓ 로 고른 뒤 Enter 하거나 정확한 이름·별칭을 입력하세요.');return;}
  toast('일치하는 명령이 없습니다. 도움말에서 전체 명령을 확인하세요.',true);closeSearchResults({clear:true});run('HELP');
 };
 search.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='ArrowDown'){e.preventDefault();if(searchResults.hidden)renderSearchResults();setSearchActive(searchActive+1);}else if(e.key==='ArrowUp'){e.preventDefault();if(searchResults.hidden)renderSearchResults();setSearchActive(searchActive<0?searchMatches.length-1:searchActive-1);}else if(e.key==='Enter'){e.preventDefault();searchRun();}else if(e.key==='Escape'){e.preventDefault();closeSearchResults({clear:true,focusCanvas:true});}});
 search.addEventListener('input',renderSearchResults);search.addEventListener('focus',renderSearchResults);
 document.addEventListener('pointerdown',event=>{if(!searchBox.contains(event.target))closeSearchResults();});
 document.addEventListener('keydown',e=>{if(e.key==='F1'){e.preventDefault();search.focus();search.select();renderSearchResults();}});
 document.addEventListener('pointerdown',event=>{for(const menu of document.querySelectorAll('.ribbon-catalog[open]'))if(!menu.contains(event.target))menu.open=false;});
 toolButtons();requestAnimationFrame(()=>fit());refresh();
}










// Architecture actions stay in their category; real view controls stay in the status area.
{
 const tools=document.getElementById('canvas-tools');
 const views=document.querySelector('.canvas-view-tools');
 if(tools&&views){
  tools.remove();toolButtons.archTools=tools;
  const order=['대지 가져오기','설계 사례','배치·평면 자동생성','3D 매스'];
  [...tools.children].sort((a,b)=>order.indexOf(a.textContent)-order.indexOf(b.textContent)).forEach(b=>tools.append(b));
  const viewRow=document.createElement('div');viewRow.className='view-tools-row';viewRow.append(views);
  const footer=document.querySelector('footer'),dock=footer.querySelector('.cad-statusbar');
  // 화면·스냅 단추는 좌표나 상태 문자열보다 먼저 고정한다. 뒤쪽 숫자 길이가 바뀌어도 이 묶음은 움직이지 않는다.
  footer.prepend(viewRow);if(dock)viewRow.after(dock);
  document.querySelector('.canvas-toolbar-actions')?.remove();
  toolButtonsKey='';toolButtons();
 }
}
document.documentElement.dataset.theme='dark';

// Auxiliary tools share one vertical rail and preserve existing controls.
(function installAuxiliaryPanels(){
 const rail=document.querySelector('.sidebar-tabs'),row=document.querySelector('.drawing-row');if(!rail)return;
 const ai=document.getElementById('ai-sidebar-toggle'),check=rail.querySelector('.livecheck-toggle'),panels=[];
 function addPanel(label,id,content){
  const panel=document.createElement('aside');panel.className='aux-panel';panel.id=id;panel.hidden=true;
  const title=document.createElement('strong');title.textContent=label;panel.append(title,content);row.insertBefore(panel,rail);
  const button=document.createElement('button');button.textContent=label;button.setAttribute('aria-controls',id);button.setAttribute('aria-expanded','false');rail.insertBefore(button,check);
  button.onclick=()=>{const opening=panel.hidden;if(ai.getAttribute('aria-expanded')==='true')ai.click();document.querySelector('.livecheck-panel').hidden=true;for(const item of panels){item.panel.hidden=true;item.button.setAttribute('aria-expanded','false');}panel.hidden=!opening;button.setAttribute('aria-expanded',String(opening));};
  panels.push({panel,button});return panel;
 }
 // 2026-09-30 사용자 지시: '속성' 탭을 없애고 '계획'으로 바꾼다. 객체 속성 요약(#properties)은 refresh()가 계속 쓰므로 DOM 에 숨겨 둔다.
 // 속성 편집 창은 그대로: 객체 더블클릭 · PROPERTIES(PR·CH·MO·'속성') 명령 · Ctrl+1 · 설정 메뉴 · 빠른 메뉴 '색·선'.
 {const section=document.getElementById('properties').closest('section'),holder=document.createElement('div');holder.id='object-properties-holder';holder.hidden=true;holder.style.display='none';holder.append(section);document.body.append(holder);}
 const planWorkflow=installPlanWorkflow(studio,{errorMessage:error=>{const text=String(error?.message||error||'');return /^[가-힣]/.test(text)?text:userErrorMessage(error);}});
 const planPanel=addPanel(PLAN_TAB_LABEL,PLAN_PANEL_ID,planWorkflow.element);
 document.getElementById('layers').closest('section').remove();
 const cards=document.createElement('div');cards.className='building-cards';
 // 건축 칸은 카드 4줄(2026-10-27 확정 시안 docs/mockup-arch-shortcuts-2026-10-27): 선 기호 · 이름(다섯 자) · 찾기 →.
 // 도면 그림·설명·분류 꼬리표·바로 실행 단추(벽·문·창…)는 넣지 않는다 — 명령(WAL·D1·W1·PLINE·STP·ELV·MASS)과 더블클릭 편집은 그대로 쓴다.
 // 건축단축키는 명령·단축키 목록(건축 설계도구, ARCHLIB)을 연다.
 const ARCH_ROW_ICONS={keys:'<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 9.5h1M9.5 9.5h1M13 9.5h1M16.5 9.5h1M6 12.5h1M9.5 12.5h1M13 12.5h1M16.5 12.5h1M8 15.2h8"/>',detail:'<path d="M5 3v18M8 3v18M11 3v18M11 8h8M11 16h8M5 6l3-3M5 10l3-3M5 14l3-3M5 18l3-3"/>',site:'<rect x="3" y="3" width="18" height="18" rx="1.5" stroke-dasharray="2 2"/><rect x="6" y="6" width="5" height="9"/><rect x="13" y="9" width="5" height="9"/>',unit:'<rect x="3" y="4" width="18" height="16"/><path d="M12 4v9M3 13h13M16 13v7M12 16a3 3 0 0 1 3-3"/>'};
 const libraryLauncher=(label,icon,run)=>{const b=document.createElement('button');b.type='button';b.className='building-assist-launcher arch-row-card';b.setAttribute('aria-haspopup','dialog');b.innerHTML='<span class="arch-row-icon"><svg viewBox="0 0 24 24" aria-hidden="true">'+ARCH_ROW_ICONS[icon]+'</svg></span><strong></strong><em>찾기 →</em>';b.querySelector('strong').textContent=label;b.onclick=()=>Promise.resolve(run()).catch(error=>toast(error.message||String(error),true));cards.append(b);};
 libraryLauncher('건축단축키','keys',()=>architectureCatalog());
 libraryLauncher('건축상세도','detail',async()=>(await loadDetailSearch()).open(false,{group:'',scope:['wall','window','floor','roof','stair','fire','parking','access','interior','steel']}));
 libraryLauncher('아파트배치','site',async()=>(await loadLibrarySearch('jutong')).open(false,{group:'jutong',scope:['jutong']}));
 libraryLauncher('단위평면도','unit',async()=>(await loadLibrarySearch('unit')).open(false,{group:'unit',scope:['unit']}));
 const body=document.createElement('div');body.append(cards);addPanel('건축 요소','building-side-panel',body);
 // 실시 탭(통과 시안 ①⑧): 실시 도면 명령과 인허가 검토(장애인 편의시설·에너지절약계획 → 인허가 도서 창)를 한 칸에.
 {const silsi=silsiPanelElement({run,open:to=>to.startsWith('permit:')?studio.handlers.PERMITBOOK?.(to.slice(7)):studio.handlers[to]?.(),recognition:{state:()=>drawingRecognition.state(),open:()=>drawingRecognition.open()}});drawingRecognition.onChange(()=>silsi.refresh());addPanel('실시','silsi-side-panel',silsi);}
 for(const button of [ai,check])button.addEventListener('click',()=>{for(const item of panels){item.panel.hidden=true;item.button.setAttribute('aria-expanded','false');}});
 rail.querySelector(`[aria-controls="${PLAN_PANEL_ID}"]`)?.addEventListener('click',()=>{if(!planPanel.hidden)planWorkflow.render();});
 // 아파트 검토는 계획 탭 ⑤ '아파트'에서 한다(2026-10-21). 도면 위 [아파트 검토]·APARTMENT 가 이 탭을 연다.
 studio.context.openPlanApartment=()=>{if(planPanel.hidden)rail.querySelector(`[aria-controls="${PLAN_PANEL_ID}"]`)?.click();planWorkflow.focusApartment();};
 const right=document.createElement('aside');right.className='right-workspace';right.setAttribute('aria-label','AI와 도면 정보');
 row.append(right);right.append(rail);
 for(const panel of [document.getElementById('ai-history-panel'),document.querySelector('.livecheck-panel'),...panels.map(item=>item.panel)])if(panel)right.append(panel);
 const tabNames=new Map([[ai,'AI 대화'],[check,'검수']]);for(const item of panels)tabNames.set(item.button,item.button.textContent==='건축 요소'?'건축':item.button.textContent);
 for(const [button,label] of tabNames){if(!button)continue;button.textContent=label;button.setAttribute('aria-label',label);button.dataset.panelTab=label;}
 // 탭 줄(통과 시안 ①⑮): AI 대화 · 건축 · 계획 · 실시 · 3D 모델링 · 보내기. 검수 탭 단추는 숨기고, 그 칸(입력 기준 검사)은
 // 계획 탭 마지막 단계 '법규 검사'가 연다. 검수 칸 자체와 그 안의 편의시설 검토 단추는 그대로 둔다.
 if(check)check.hidden=true;
 studio.context.openLawCheck=()=>{if(check&&document.querySelector('.livecheck-panel')?.hidden)check.click();};
 // 탭 순서는 보내기 단추를 붙이는 miriboda-panel.js 가 마지막에 맞춘다.
 const updateRight=()=>{const open=[...right.querySelectorAll(':scope > aside')].some(panel=>!panel.hidden);right.classList.toggle('is-collapsed',!open);};
 rail.addEventListener('click',()=>setTimeout(updateRight));new MutationObserver(updateRight).observe(right,{attributes:true,subtree:true,attributeFilter:['hidden','aria-expanded']});updateRight();
 // 2026-09-30 사용자 지시 "마우스 가면 열리는 형식으로": 패널이 닫혀 있으면 탭 띠를 가장자리 띠로 접고, 마우스·초점·터치로 펼친다.
 studio.railAutoHide=installRailAutoHide(right);
})();


// 사무소 레이어 사전: 정리한 레이어 이름 → 분류. 다음 도면에서 같은 이름이면 그대로 추천한다(공용 설정이라 도면 창끼리도 같이 쓴다).
const LAYER_DICTIONARY_KEY='barun-layer-dictionary-v1';
const loadLayerDictionary=()=>{try{const v=JSON.parse(localStorage.getItem(LAYER_DICTIONARY_KEY)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return {};}};
function layerReviewDialog(){
 const snapshot=JSON.stringify(engine.doc),decisions=analyzeRankedDrawingLayers(engine.doc,{dictionary:loadLayerDictionary()}),byId=new Map(decisions.map(d=>[d.id,d]));
 // Confident results are ready to apply; ambiguous proposals need review.
 decisions.forEach(d=>d.accepted=!!d.label&&d.accepted);
 // 이름 묶음 확인(2026-10-21 대표 결정): 자동으로 못 정한 것을 레이어 이름 묶음(WALL1·WALL2 …)으로 모아 직원이 묶음마다 한 번 확인한다.
 // 제안은 자동으로 옮기지 않는다. "모두 맞음" 단추는 어느 탭에도 두지 않는다(오분류 방지). 확인한 묶음은 사무소 사전에 이름# 으로 기억한다.
 // 사용성 비평(아스트라·아르곤, 2026-10-21): 확인 ≠ 적용 ≠ 기억을 말로 나누고, 적용 단추는 늘 보이게, 줄은 제자리, 묶음은 펼칠 수 있게.
 const autoIds=new Set(decisions.filter(d=>d.accepted).map(d=>d.id));
 const nameGroups=buildNameGroups(engine.doc,decisions,loadLayerDictionary()).map(g=>({...g,label:g.suggestion?.label||'',kept:false,remember:false}));
 let focus=null,tab='names',picked=null;const manualIds=new Set();
 // 도면 확인(2026-10-22 대표 결정, 시안 docs/시안-도면확인-2026-10-22): 첫 화면은 기능이 읽는 것을 도면 위에 색칠하고 빠진 것(!)만 짚게 한다.
 // 짚은 것은 그 선 묶음만 옮기는 것이 기본, 기억은 기본이 '이번 도면만'. 레이어 이름 목록(이름 묶음·종류별)은 '레이어별로 자세히 보기' 안.
 let view='check',marks={},zoneChoice='',pickKey=null,pick=null,hoverIds=null;const rememberPicks=[];
 const dialog=document.createElement('dialog');dialog.className='layer-review-dialog';
 dialog.innerHTML=`<h2>도면 확인</h2><p>확인한 것은 <b>적용 예정</b>일 뿐, 아래 <b>도면에 적용</b>을 눌러야 도면이 바뀝니다. 적용한 뒤에도 Ctrl+Z 로 한 번에 되돌립니다.</p><div class="lr-summary" aria-live="polite"></div><div class="lr-toolbar"><button class="fit">도면 전체</button><button class="focus">이 종류 확대</button><button class="original" aria-pressed="false">원본 보기</button><button class="orig-off" type="button" hidden>원본 끄기</button><span class="lr-hint">휠 확대 · 드래그 이동 · 선을 클릭해 수정</span></div><div class="lr-strip" role="status" hidden></div><div class="layer-review-body"><div class="lr-canvas"><canvas width="1000" height="650" aria-label="레이어 분류 미리보기"></canvas><div class="lr-pick-banner" role="status" hidden></div><div class="lr-pick-pop" hidden></div><div class="lr-legend" aria-hidden="true"></div></div><div class="lr-side"><div class="lr-check"></div><div class="lr-tabs"><button class="lr-back" type="button">‹ 도면 확인</button><button class="lr-tab" data-tab="names" aria-pressed="true">이름 묶음으로 확인</button><button class="lr-tab" data-tab="kinds" aria-pressed="false">종류별 보기</button></div><div class="lr-names"></div><div class="lr-groups" hidden></div><div class="lr-group-actions" hidden><p class="lr-caption"></p><button class="exclude">이 종류 적용 제외</button></div><div class="lr-object"><strong>선을 클릭하면 여기서 수정할 수 있습니다.</strong><p class="lr-reason"></p><label>1. 수정할 객체<select class="lr-object-list" aria-label="수정할 객체 목록"></select></label><label>2. 옮길 레이어</label><select class="lr-category-select" aria-label="선택한 선의 분류"></select><button class="keep">선택한 선은 원본 유지</button></div></div></div><details class="lr-changes-box"><summary>적용될 레이어 변경 목록</summary><div class="lr-changes" style="max-height:100px;overflow:auto;font-size:12px"></div></details><div class="lr-dict" hidden></div><div class="lr-footer"><p class="layer-review-status"></p><div class="dialog-actions"><button class="lr-dict-open" type="button">기억한 이름 관리</button><button class="cancel">변경 없이 닫기</button><button class="apply primary">0개 도면에 적용</button></div></div>`;
 document.body.append(dialog);
 const q=x=>dialog.querySelector(x),preview=q('canvas'),ctx=preview.getContext('2d'),colors=new Map(BARUN_LAYERS.filter(l=>l.label!=='검토필요').map(l=>[l.label,l.color]));
 const layers=new Map(engine.doc.layers.map(l=>[l.id,l])),entities=engine.doc.entities.filter(e=>layers.get(e.layer)?.visible!==false&&!layers.get(e.layer)?.frozen&&!e.hidden);
 let group='?',chosen=null,original=false,k=1,ox=0,oy=0,drag=null;
 const screen=p=>({x:p.x*k+ox,y:oy-p.y*k}),world=p=>({x:(p.x-ox)/k,y:(oy-p.y)/k});
 function fit(es){const b=G.bounds(es);if(!b)return;k=Math.min(940/Math.max(1,b.maxX-b.minX),590/Math.max(1,b.maxY-b.minY));ox=500-(b.minX+b.maxX)/2*k;oy=325+(b.minY+b.maxY)/2*k;}
 const inGroup=d=>!!d&&(group==='?'?!!d.label&&d.confidence<.9&&!d.accepted:(d.label||'')===group);
 function paint(){ctx.clearRect(0,0,1000,650);if(view==='check')paintCheck();else for(const e of entities){const d=byId.get(e.id),focused=!!focus?.has(e.id),active=focus?focused:inGroup(d);const color=original?(e.color||layers.get(e.layer).color):e.id===chosen?'#ffffff':focused?'#9b7cf0':active?(colors.get(d.label)||'#b8c7d0'):'#39444c';drawEntity(ctx,e,screen,k,color,!original&&e.id===chosen?3:focused?2.4:active?1.8:1);}
 const n=decisions.filter(d=>d.accepted&&d.label).length;q('.apply').textContent=n+'개 도면에 적용';q('.apply').disabled=!n;summary(n);
 const changes=new Map();for(const d of decisions.filter(d=>d.accepted&&d.label)){const e=engine.doc.entities.find(e=>e.id===d.id);const from=layers.get(e?.layer)?.name||'기본';const target=standardLayerForLabel(d.label)?.name||d.label;const key=from+' → '+target;changes.set(key,(changes.get(key)||0)+1);}q('.lr-changes').replaceChildren(...[...changes].map(([label,count])=>{const row=document.createElement('div');row.textContent=label+' · '+count+'개';return row;}));
 const items=decisions.filter(inGroup);q('.lr-caption').textContent=group==='?'?`확인 필요 ${items.length}개 · 나머지 확실한 분류는 자동 선택되었습니다.`:group?`${group} 후보 ${items.length}개가 강조되어 있습니다.`:`분류하지 못한 ${items.length}개는 그대로 둡니다.`;q('.exclude').disabled=!group||!items.length;
 const list=q('.lr-object-list');list.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='도면에서 클릭하거나 여기서 객체 선택';list.append(placeholder);for(const item of decisions.filter(inGroup)){const e=engine.doc.entities.find(e=>e.id===item.id),o=document.createElement('option');o.value=item.id;o.textContent=(list.options.length)+' · '+(e?.text||e?.name||e?.type||'객체')+' · '+(layers.get(e?.layer)?.name||'');list.append(o);}list.value=chosen||'';
 const d=byId.get(chosen);q('.lr-object strong').textContent=d?`선택한 객체 · ${d.label||'미분류'}`:'선을 클릭하면 여기서 수정할 수 있습니다.';q('.lr-reason').textContent=d?d.reason+(d.candidates?' · 후보: '+d.candidates.slice(0,3).map(c=>`${c.label||'미분류'} ${(c.score*100).toFixed(1)}%`).join(', ')+' (모델점수, 정확도 아님)':''):'';q('.lr-category-select').disabled=!d;q('.lr-category-select').value=d?.label||'';q('.keep').disabled=!d;
 if(view==='check')checkPanel();
 }
 // ── 도면 확인 ──
 const PICK_LABEL={wall:'벽체',window:'창호',door:'문',stair:'계단',site:'대지',building:'건물 1층 외곽',bline:'건축선'},NEED_CLOSED=new Set(['site','building','bline']);
 const KIND_COLOR={wall:'#ebebeb',window:'#50aaff',door:'#5ad278',stair:'#ffaa3c',room:'#c882ff',site:'#ff6b6b',building:'#f0a35a',bline:'#ffdc3c'};
 const KIND_NAME={wall:'벽',window:'창',door:'문',stair:'계단',room:'실 이름',site:'대지',building:'건물 외곽'};
 const check=()=>server.state==='ok'?serverResult():checkDrawing(engine.doc,decisions,{marks,zone:zoneChoice});
 // 받침 있는 낱말 뒤 조사: 창을·벽을 / 계단으로·대지로(ㄹ 받침은 로)
 const final=w=>{const c=String(w).charCodeAt(String(w).length-1)-0xAC00;return c>=0&&c<11172?c%28:0;},eul=w=>w+(final(w)?'을':'를'),ro=w=>w+(final(w)&&final(w)!==8?'으로':'로');
 const closedShape=e=>e&&(e.type==='rectangle'||(e.type==='polyline'||e.type==='hatch')&&e.closed&&e.points?.length>=3);
 // ── 남의 도면 읽기(바른 서버)와 합침 (2026-10-22 대표 결정: 로그인 상태면 다시 그려 더하기, 벽 레이어는 서버 1등을 제안 → 직원 확정 → 다시 읽기,
 //    건물 외곽은 벽 중심선, 층마다 체크 목록. 로그인 안 됨·서버 실패면 아래 레이어 옮기기 그대로) ──
 const WALL_LABELS=CHECK_GROUPS[0].items[0].labels,m2s=a=>(a/1e6).toFixed(1);
 let server={state:'loading',read:null,message:'',floor:0,wallSource:'server',wallNames:null,marks:{},roomNames:{},ms:0},hideOriginal=false,hoverPoly=null;
 const serverResult=()=>serverChecks(server.read,{floor:server.floor,wallSource:server.wallSource,wallNames:server.wallNames,marks:{...marks,...server.marks},local:checkDrawing(engine.doc,decisions,{marks,zone:zoneChoice})});
 async function readOnServer(wallNames=null,source='server'){
  server={...server,state:'loading',message:''};strip();
  try{
   const {foreignRead}=await import('./compute-client.js');
   let reading=null;try{const r=await fetch('/drawing-knowledge.json',{cache:'no-store'});if(r.ok)reading=(await r.json()).standard?.planReading||null;}catch{}
   const sent=wallNames?.length?mergeWallLayers(engine.doc,wallNames):{doc:engine.doc,layer:null},t0=performance.now();
   const read=await foreignRead(sent.doc,reading,{fileName:engine.doc?.name||'',wallLayer:sent.layer});
   if(!dialog.open)return;
   server={...server,state:'ok',read,floor:Math.min(server.floor,Math.max(0,read.floors.length-1)),wallSource:wallNames?.length?source:'server',wallNames:wallNames?.length?wallNames:null,ms:performance.now()-t0};
   const f=read.floors[server.floor];if(f?.walls?.length){const ps=f.walls.flatMap(w=>[w.a,w.b]);fit([{type:'polyline',points:ps}]);}
  }catch(e){if(!dialog.open)return;server={...server,state:'off',message:e?.code==='not_logged_in'?'login':userErrorMessage(e)};}
  cancelPick();paint();strip();
 }
 function strip(){
  const b=q('.lr-strip');b.replaceChildren();b.hidden=false;b.classList.remove('warn');
  const t=document.createElement('span');b.append(t);
  const btn=(label,fn)=>{const x=document.createElement('button');x.type='button';x.textContent=label;x.onclick=fn;b.append(x);};
  if(server.state==='loading'){t.textContent='바른 서버로 읽는 중… (벽·창·문·실을 다시 그릴 준비)';return;}
  if(server.state==='off'){b.classList.add('warn');
   t.textContent=server.message==='login'?'로그인하면 바른 서버가 벽·창·문·실을 다시 그려 3D 모형·창 제안·면적까지 됩니다. 지금은 레이어만 옮깁니다.':`바른 서버 계산을 못 썼습니다(${server.message}) — 지금은 레이어만 옮깁니다.`;
   if(server.message==='login'&&typeof window.barunOpenAccountUpdate==='function')btn('계정 연결',()=>window.barunOpenAccountUpdate());
   btn('다시 읽기',()=>readOnServer());return;}
  const r=serverResult(),f=r.floor,doubt=r.confirm.find(c=>c.kind==='wall');
  if(doubt){b.classList.add('warn');t.textContent=`확인 필요 · ${doubt.text} — 벽 레이어가 맞는지 보세요`;return;}
  t.textContent=`바른 서버로 읽었습니다 · ${f.label||f.title||'평면'} 벽 ${f.runs?.length||0}줄 · 실 ${f.rooms?.length||0} · ${(server.ms/1000).toFixed(2)}초`+(server.wallSource==='staff'?` · 벽 레이어 ${server.wallNames.join('·')}(직원이 고름)`:server.wallSource==='dictionary'?` · 벽 레이어 ${server.wallNames.join('·')}(사무소 사전)`:'');
 }
 function paintServer(){
  const f=server.read.floors[server.floor];if(!f)return;
  if(!hideOriginal)for(const e of entities){const draw=x=>Array.isArray(x.entities)?x.entities.forEach(draw):drawEntity(ctx,x,screen,k,'#3a3f46',1);draw(e);}
  if(hoverIds){const hs=new Set(hoverIds);for(const e of entities)if(hs.has(e.id)){const d=x=>Array.isArray(x.entities)?x.entities.forEach(d):drawEntity(ctx,x,screen,k,'#ffe45c',2.4);d(e);}}
  const path=(ps,closed)=>{ctx.beginPath();ps.forEach((p,i)=>{const s=screen(p);i?ctx.lineTo(s.x,s.y):ctx.moveTo(s.x,s.y);});if(closed)ctx.closePath();};
  const poly=(ps,stroke,width,fill,dash)=>{ctx.save();path(ps,true);if(fill){ctx.fillStyle=fill;ctx.fill();}if(dash)ctx.setLineDash(dash);ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();ctx.restore();};
  const seg=(a,b,stroke,width)=>{ctx.save();path([a,b],false);ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();ctx.restore();};
  for(const r of f.rooms||[])poly(r.points,r.stair?KIND_COLOR.stair:KIND_COLOR.room,1.3,r.stair?'rgba(255,170,60,.18)':'rgba(200,130,255,.12)');
  for(const c of f.outline?.outdoorCandidates||[])poly(c.points,'#ffe45c',1.2,'rgba(255,228,92,.08)',[4,4]);
  if(hoverPoly)poly(hoverPoly,'#ffe45c',3,'rgba(255,228,92,.2)');
  for(const w of f.walls||[])seg(w.a,w.b,KIND_COLOR.wall,2.4);
  for(const g of f.glass||[])seg(g.a,g.b,KIND_COLOR.window,2.4);
  const env=f.outline?.envelope?.length>=3?f.outline.envelope:f.outline?.points;if(env)poly(env,KIND_COLOR.site,1.8,null,[8,5]);
  ctx.save();ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillStyle='#e6d2ff';
  (f.rooms||[]).forEach((r,ri)=>{if(r.area<3e6)return;const c=r.points.reduce((a,p)=>({x:a.x+p.x/r.points.length,y:a.y+p.y/r.points.length}),{x:0,y:0}),s=screen(c);ctx.fillText(`${server.roomNames[`${server.floor}:${ri}`]||r.name||(r.stair?'계단':'실')} ${m2s(r.area)}㎡`,s.x,s.y);});
  ctx.restore();
  q('.lr-legend').replaceChildren(...[['벽(다시 그림)',KIND_COLOR.wall],['창',KIND_COLOR.window],['실',KIND_COLOR.room],['계단',KIND_COLOR.stair],['벽 중심선 외곽',KIND_COLOR.site],['원본 선','#4a4f57']].map(([name,c])=>{const b=document.createElement('b');b.style.setProperty('--c',c);b.textContent=name;return b;}));
 }
 // 벽 레이어 고르기: 서버 점수 후보 + 이름으로 벽인 레이어. 직원이 고른 레이어로 다시 읽는다
 function wallCandidates(){
  const f=server.read.floors[server.floor],dict=loadLayerDictionary(),out=new Map(),used=new Set(engine.doc.entities.map(e=>e.layer));
  for(const sc of f?.layerScores||[]){const ls=[sc.layer].flat().filter(n=>n&&n!==MERGED_WALL_LAYER);if(ls.length===1&&!out.has(ls[0]))out.set(ls[0],{area:sc.area,server:sc===f.layerScores[0]});}
  for(const l of engine.doc.layers){if(!used.has(l.id))continue;const sug=suggestLayerFamily(l.name,dict);if(WALL_LABELS.includes(sug?.label))out.set(l.name,{...(out.get(l.name)||{}),label:sug.label,dict:sug.source==='사무소 사전'});}
  return out;
 }
 function wallPicker(){
  const cands=wallCandidates(),r=serverResult(),doubt=r.confirm.find(c=>c.kind==='wall');
  const chosen=new Set(server.wallNames||(doubt?[...cands].filter(([,v])=>v.label).map(([n])=>n):[r.floor.wallLayer].flat().filter(Boolean)));
  let remember=false;pickKey='wall-layer';pick={chosen:[]};
  const pop=q('.lr-pick-pop');pop.hidden=false;pop.style.left='12px';pop.style.top='52px';
  const draw=()=>{pop.replaceChildren();
   const h=document.createElement('b');h.textContent='벽 레이어 고르기';
   const why=document.createElement('small');why.textContent=doubt?`서버가 고른 ${[r.floor.wallLayer].flat().join('·')} 로는 ${doubt.text.split(' — ')[0]}. 벽인 레이어를 고르면 그걸로 다시 읽습니다.`:'벽인 레이어를 고르면 그걸로 다시 읽습니다. 도면에서 선을 눌러 더하거나 뺄 수도 있습니다.';
   pop.append(h,why);
   for(const [name,v] of cands){const l=document.createElement('label');l.className='lr-radio';const i=document.createElement('input');i.type='checkbox';i.checked=chosen.has(name);i.onchange=()=>{i.checked?chosen.add(name):chosen.delete(name);paint();};
    const t=document.createElement('span');t.textContent=name;const n=document.createElement('small');n.textContent=[v.area>0.05?`닫힌 ${v.area.toFixed(1)}㎡`+(v.server?' · 서버 1등':''):'',v.label?`이름: ${v.label}`+(v.dict?'(사무소 사전)':''):''].filter(Boolean).join(' · ');
    l.onmouseenter=()=>{hoverIds=engine.doc.entities.filter(e=>engine.doc.layers.find(x=>x.id===e.layer)?.name===name).map(e=>e.id);paint();};l.onmouseleave=()=>{hoverIds=null;paint();};l.append(i,t,n);pop.append(l);}
   for(const name of chosen)if(!cands.has(name)){const s=document.createElement('small');s.textContent=`도면에서 짚음: ${name}`;pop.append(s);}
   const keep=document.createElement('label');keep.className='lr-remember';const box=document.createElement('input');box.type='checkbox';box.checked=remember;const ok=[...chosen].every(n=>rememberAllowed(n));box.disabled=!ok||!chosen.size;box.onchange=()=>{remember=box.checked;};
   const kn=document.createElement('small');kn.textContent=ok?'다음 도면부터 이 레이어를 바로 서버 읽기에 넘깁니다':'짧은 이름(0·W 등)이 섞여 있어 기억하지 않습니다';keep.append(box,' 사무소 사전에도 기억',kn);pop.append(keep);
   const row=document.createElement('div');row.className='dialog-actions';
   const pickBtn=document.createElement('button');pickBtn.type='button';pickBtn.textContent='도면에서 짚기';pickBtn.onclick=()=>{const b=q('.lr-pick-banner');b.hidden=false;b.textContent='벽 선을 누르면 그 레이어를 더하거나 뺍니다 · Esc 마침';};
   const cancel=document.createElement('button');cancel.type='button';cancel.textContent='닫기';cancel.onclick=cancelPick;
   const go=document.createElement('button');go.type='button';go.className='primary';go.textContent='이 레이어로 다시 읽기';go.disabled=!chosen.size;
   go.onclick=()=>{const names=[...chosen];if(remember)for(const n of names)rememberPicks.push({name:n,label:'벽체'});readOnServer(names,'staff');};
   row.append(pickBtn,cancel,go);pop.append(row);};
  wallPicker.toggle=name=>{chosen.has(name)?chosen.delete(name):chosen.add(name);draw();paint();};
  draw();paint();
 }
 function roomNamer(){
  const f=server.read.floors[server.floor],pop=q('.lr-pick-pop');pop.hidden=false;pop.style.left='12px';pop.style.top='52px';pop.replaceChildren();
  const h=document.createElement('b');h.textContent='이름 없는 실';const w=document.createElement('small');w.textContent='넣지 않아도 됩니다. 창 제안·전기 배치가 실 이름을 씁니다.';pop.append(h,w);
  f.rooms.forEach((r,ri)=>{if(r.stair||r.name)return;const k=`${server.floor}:${ri}`,l=document.createElement('label');l.className='lr-radio';const t=document.createElement('span');t.textContent=`실 ${m2s(r.area)}㎡`;
   const i=document.createElement('input');i.type='text';i.placeholder='예: 거실';i.value=server.roomNames[k]||'';i.oninput=()=>{server.roomNames[k]=i.value.trim();paint();};
   l.onmouseenter=()=>{hoverPoly=r.points;paint();};l.onmouseleave=()=>{hoverPoly=null;paint();};l.append(t,i);pop.append(l);});
  const row=document.createElement('div');row.className='dialog-actions';const done=document.createElement('button');done.type='button';done.className='primary';done.textContent='다 넣음';done.onclick=()=>{pop.hidden=true;hoverPoly=null;paint();};row.append(done);pop.append(row);
 }
 function serverPanel(){
  const root=q('.lr-check'),r=serverResult();root.replaceChildren();
  const sub=document.createElement('p');sub.className='lr-note';sub.textContent='바른 서버가 읽은 결과입니다. 주황 ! 와 노란 ? 만 보면 됩니다. 적용하면 원본 선은 그대로 두고 바른 객체를 더합니다.';root.append(sub);
  if(server.read.floors.length>1){const tabs=document.createElement('div');tabs.className='lr-floor-tabs';
   server.read.floors.forEach((f,i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-pressed',String(i===server.floor));const miss=serverChecks(server.read,{floor:i,wallSource:server.wallSource,wallNames:server.wallNames,marks:{...marks,...server.marks}}).missing;
    b.textContent=(f.label||f.title||`${i+1}번`)+(miss?' !':'');b.onclick=()=>{server.floor=i;const ps=(f.walls||[]).flatMap(w=>[w.a,w.b]);if(ps.length)fit([{type:'polyline',points:ps}]);cancelPick();paint();strip();};tabs.append(b);});root.append(tabs);}
  if(r.confirm.length){const box=document.createElement('div');box.className='lr-check-group lr-confirm';const head=document.createElement('div');head.className='lr-check-head';const t=document.createElement('b');t.textContent='확인 필요';head.append(t);
   const u=document.createElement('small');u.textContent='서버 읽기가 사람에게 묻는 것';box.append(head,u);
   for(const c of r.confirm){const row=document.createElement('div');row.className='lr-check-row';row.dataset.status='sug';const i=document.createElement('i');i.textContent='?';const d=document.createElement('small');d.textContent=c.text;row.append(i,d);
    const btn=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=fn;row.append(b);};
    if(c.kind==='wall')btn('벽 레이어 고르기',wallPicker);
    else if(c.kind==='outdoor'){btn('바닥면적에서 빼기',()=>{server.marks[c.key]='cut';paint();});btn('그대로 두기',()=>{server.marks[c.key]='keep';paint();});row.onmouseenter=()=>{hoverPoly=c.points;paint();};row.onmouseleave=()=>{hoverPoly=null;paint();};}
    else btn('확인함',()=>{server.marks[c.key]='done';paint();});
    box.append(row);}
   root.append(box);}
  for(const g of r.groups){
   const box=document.createElement('div');box.className='lr-check-group';const head=document.createElement('div');head.className='lr-check-head';const t=document.createElement('b');t.textContent=g.title;head.append(t);
   if(g.ready){const ok=document.createElement('span');ok.className='lr-ready';ok.textContent='돌릴 수 있음';head.append(ok);}
   const uses=document.createElement('small');uses.textContent=g.uses;box.append(head,uses);
   for(const it of g.items){
    const row=document.createElement('div');row.className='lr-check-row';row.dataset.status=it.status;
    const mark=document.createElement('i');mark.textContent={ok:'✓',miss:'!',none:'–',sug:'?'}[it.status];const name=document.createElement('b');name.textContent=it.name;
    const detail=document.createElement('small');detail.textContent=it.detail;if(it.source){const s=document.createElement('em');s.className='lr-src';s.textContent=it.source;detail.append(' ',s);}
    row.append(mark,name,detail);
    const btn=(label,fn,cls)=>{const b=document.createElement('button');b.type='button';b.textContent=label;if(cls)b.className=cls;b.onclick=fn;row.append(b);};
    if(it.key==='wall'){if(it.status==='sug'){btn('맞음',()=>{server.wallSource='staff';server.wallNames=[r.floor.wallLayer].flat().filter(Boolean);paint();strip();});btn('다른 레이어',wallPicker);}else btn(it.status==='ok'?'다시 고르기':'벽 레이어 고르기',wallPicker,it.status==='ok'?'lr-more-pick':'');}
    else if(it.key==='room'&&it.unnamed)btn(`이름 없는 ${it.unnamed}개`,roomNamer);
    else if(it.key==='zone'&&it.status==='miss'){const sel=document.createElement('select');sel.setAttribute('aria-label','용도지역 고르기');for(const z of ['',...Object.keys(STATUTORY_LIMITS)]){const o=document.createElement('option');o.value=z;o.textContent=z||'용도지역 고르기';sel.append(o);}sel.value=zoneChoice;sel.onchange=()=>{zoneChoice=sel.value;paint();};row.append(sel);}
    else if(it.key==='zone'&&zoneChoice&&it.detail===zoneChoice)btn('다시 고르기',()=>{zoneChoice='';paint();});
    else if(it.status==='miss')btn('없음',()=>{marks[it.key]='none';paint();},'lr-none');
    else if(marks[it.key]==='none'&&it.detail==='이 도면에 없음')btn('되돌리기',()=>{delete marks[it.key];paint();});
    box.append(row);
   }
   root.append(box);
  }
  q('.layer-review-status').textContent=(r.missing?`빠진 것 ${r.missing}개 — 「없음」으로 넘기거나 고르세요. `:'')+'적용하면 원본 선은 그대로 두고 벽·창·문·실·계단·벽 중심선 외곽을 바른 객체로 더합니다 · Ctrl+Z 한 번으로 되돌림';
  {const add=foreignAdditions(server.read,{roomNames:server.roomNames,marks:server.marks});q('.lr-summary').textContent=`다시 그려 더할 것: 벽 ${add.walls.length}줄 · 창·문 ${add.openings.length} · 실·계단 ${add.rooms.length} · 벽 중심선 외곽 ${add.outlines.length} — 원본 선 ${engine.doc.entities.length}개는 그대로`;}
  q('.apply').textContent='이 도면에 적용';q('.apply').disabled=false;q('.apply').classList.toggle('primary',!r.missing&&!r.confirm.some(c=>c.kind==='wall'));
 }
 function paintCheck(){
  if(server.state==='ok'){paintServer();return;}
  const r=check(),tint=new Map(),hot=new Set(pick?.chosen||hoverIds||[]);
  for(const it of r.groups.flatMap(g=>g.items))for(const id of it.ids||[])if(!tint.has(id))tint.set(id,KIND_COLOR[it.key]);
  for(const pass of [0,1])for(const e of entities){const lit=hot.has(e.id)||tint.has(e.id);if(lit!==!!pass)continue;
   const color=original?(e.color||layers.get(e.layer).color):hot.has(e.id)?'#ffe45c':tint.get(e.id)||'#3a4048',w=hot.has(e.id)?3:lit?1.8:1;
   // 블록은 안의 선이 제 색(예: 단열재 하늘색)으로 그려져 '찾은 것'처럼 보이므로, 안의 선을 하나씩 같은 색으로
   const draw=x=>Array.isArray(x.entities)&&!original?x.entities.forEach(draw):drawEntity(ctx,x,screen,k,color,w);draw(e);}
  // 벽 둘레로 만든 건물 외곽(아직 도면에 없는 것)은 점선으로 미리 보여 준다
  const b=r.groups.flatMap(g=>g.items).find(i=>i.key==='building')?.outline;
  if(b&&!original){ctx.save();ctx.setLineDash([8,5]);ctx.strokeStyle=KIND_COLOR.building;ctx.lineWidth=1.6;ctx.beginPath();b.forEach((p,i)=>{const s=screen(p);i?ctx.lineTo(s.x,s.y):ctx.moveTo(s.x,s.y);});ctx.closePath();ctx.stroke();ctx.restore();}
  q('.lr-legend').replaceChildren(...Object.entries(KIND_NAME).map(([key,name])=>{const b=document.createElement('b');b.style.setProperty('--c',KIND_COLOR[key]);b.textContent=name;return b;}));
 }
 function checkPanel(){
  q('.orig-off').hidden=server.state!=='ok';if(server.state==='ok'){serverPanel();return;}
  const root=q('.lr-check'),r=check();root.replaceChildren();
  const sub=document.createElement('p');sub.className='lr-note';sub.textContent='이 도면으로 돌릴 기능과, 그 기능이 읽는 것입니다. 주황 ! 만 처리하면 됩니다.';root.append(sub);
  for(const g of r.groups){
   const box=document.createElement('div');box.className='lr-check-group';
   const head=document.createElement('div');head.className='lr-check-head';const t=document.createElement('b');t.textContent=g.title;head.append(t);
   if(g.ready){const ok=document.createElement('span');ok.className='lr-ready';ok.textContent='돌릴 수 있음';head.append(ok);}
   const uses=document.createElement('small');uses.textContent=g.uses;box.append(head,uses);
   for(const it of g.items){
    const picking=pickKey===it.key,row=document.createElement('div');row.className='lr-check-row';row.dataset.status=picking?'pick':it.status;
    const mark=document.createElement('i');mark.textContent=picking?'…':{ok:'✓',miss:'!',none:'–'}[it.status];
    const name=document.createElement('b');name.textContent=it.name;const detail=document.createElement('small');detail.textContent=picking?'도면에서 고르는 중':it.detail;
    row.append(mark,name,detail);
    if(picking){const b=document.createElement('button');b.type='button';b.textContent='그만 고르기';b.onclick=cancelPick;row.append(b);}
    else if(it.status==='miss'){
     if(it.key==='zone'){const sel=document.createElement('select');sel.setAttribute('aria-label','용도지역 고르기');for(const z of ['',...Object.keys(STATUTORY_LIMITS)]){const o=document.createElement('option');o.value=z;o.textContent=z||'용도지역 고르기';sel.append(o);}sel.value=zoneChoice;sel.onchange=()=>{zoneChoice=sel.value;paint();};row.append(sel);}
     if(PICK_LABEL[it.key]){const b=document.createElement('button');b.type='button';b.textContent='도면에서 짚기';b.onclick=()=>startPick(it);row.append(b);}
     const no=document.createElement('button');no.type='button';no.className='lr-none';no.textContent='없음';no.title='이 도면에 원래 없으면 넘깁니다(그 기능에서 빠짐)';no.onclick=()=>{marks[it.key]='none';paint();};row.append(no);
    }else if(marks[it.key]==='none'&&it.detail==='이 도면에 없음'){const b=document.createElement('button');b.type='button';b.textContent='되돌리기';b.onclick=()=>{delete marks[it.key];paint();};row.append(b);}
    else if(it.status==='ok'&&PICK_LABEL[it.key]&&!pickKey){const b=document.createElement('button');b.type='button';b.className='lr-more-pick';b.textContent='+ 더 짚기';b.title='같은 종류가 다른 레이어에도 있으면 더 짚습니다';b.onclick=()=>startPick(it);row.append(b);}
    else if(it.key==='zone'&&zoneChoice&&it.detail===zoneChoice){const b=document.createElement('button');b.type='button';b.textContent='다시 고르기';b.onclick=()=>{zoneChoice='';paint();};row.append(b);}
    box.append(row);
    // 이름으로 짐작한 묶음(제안)이 있으면 바로 아래에 — 짐작이라 직원이 '맞음'을 눌러야 옮긴다
    const labels=CHECK_GROUPS.flatMap(x=>x.items).find(x=>x.key===it.key)?.labels||[];
    if(it.status==='miss'&&!picking)for(const g of nameGroups.filter(g=>labels.includes(g.suggestion?.label)&&nameGroupState(g,byId,g.kept).state==='pending')){
     const sug=document.createElement('div');sug.className='lr-check-sug';const t=document.createElement('small');t.textContent=`제안: ${g.layers.map(l=>l.name).join('·')} ${g.count}개 → ${g.suggestion.label}`+(g.suggestion.hint?` (${g.suggestion.hint})`:'');
     const yes=document.createElement('button');yes.type='button';yes.textContent='맞음';yes.onclick=()=>{hoverIds=null;g.label=g.suggestion.label;g.kept=false;applyNameGroup(decisions,g,g.label);groups();paint();};
     sug.onmouseenter=()=>{hoverIds=g.entityIds;paint();};sug.onmouseleave=()=>{hoverIds=null;paint();};sug.append(t,yes);box.append(sug);
    }
   }
   root.append(box);
  }
  const more=document.createElement('button');more.type='button';more.className='lr-more';more.textContent='레이어별로 자세히 보기 ›';more.onclick=()=>setView('detail');root.append(more);
  q('.layer-review-status').textContent=r.missing?`빠진 것 ${r.missing}개 — 짚거나 「없음」으로 넘기세요. 적용은 지금도 됩니다(빠진 기능만 안 돎).`:'원본 레이어는 그대로 두고 찾은 선만 표준 레이어로 옮깁니다 · Ctrl+Z 로 되돌림';
  q('.apply').classList.toggle('primary',!r.missing);
 }
 function startPick(it){pickKey=it.key;pick=null;q('.lr-pick-pop').hidden=true;const b=q('.lr-pick-banner');b.hidden=false;b.textContent=`${eul(it.name)} 도면에서 한 번 눌러 주세요 · Esc 취소`;paint();}
 function cancelPick(){pickKey=null;pick=null;q('.lr-pick-banner').hidden=true;q('.lr-pick-pop').hidden=true;paint();}
 function showPick(id,at){
  const g=pickGroup(engine.doc,id);if(!g)return;
  const item=check().groups.flatMap(x=>x.items).find(i=>i.key===pickKey),label=PICK_LABEL[pickKey],whole=engine.doc.entities.filter(e=>e.layer===g.layerId&&!e.hidden).map(e=>e.id);
  pick={...g,label,whole:false,remember:false,chosen:g.ids};
  const pop=q('.lr-pick-pop');pop.replaceChildren();pop.hidden=false;
  const wrap=q('.lr-canvas').getBoundingClientRect(),cv=preview.getBoundingClientRect(),x=(at.x/1000)*cv.width+cv.left-wrap.left,y=(at.y/650)*cv.height+cv.top-wrap.top;
  pop.style.left=Math.max(8,Math.min(wrap.width-320,x+16))+'px';pop.style.top=Math.max(52,Math.min(wrap.height-280,y-40))+'px';   // 위 안내 띠는 가리지 않게
  const inner=g.ids.map(i=>engine.doc.entities.find(e=>e.id===i)).filter(e=>Array.isArray(e?.entities)),lines=inner.reduce((n,e)=>n+e.entities.length,0);
  const h=document.createElement('b');h.textContent=inner.length?`블록 ${inner.length}개를 골랐습니다(안에 선 ${lines}개)`:`${item?.name||label} ${g.ids.length}개를 찾았습니다`;
  const how=document.createElement('small');how.textContent=g.how==='열림 호와 문짝'?'누른 열림 호와 경첩에서 뻗은 문짝을 묶었습니다':g.how==='같은 간격 평행선'?'누른 선과 같은 간격으로 나란한 선을 묶었습니다':g.how==='이어진 선'?'누른 선과 끝이 이어진 같은 레이어 선을 묶었습니다':'누른 선 하나입니다';
  pop.append(h,how);
  if(NEED_CLOSED.has(pickKey)&&!g.ids.some(i=>closedShape(engine.doc.entities.find(e=>e.id===i)))){const w=document.createElement('p');w.className='lr-warn';w.textContent=`${item?.name}${final(item?.name||'')?'은':'는'} 닫힌 선이어야 합니다. 둘레가 닫힌 선을 눌러 주세요.`;pop.append(w);}
  const radio=(text,note,checked,on)=>{const l=document.createElement('label');l.className='lr-radio';const i=document.createElement('input');i.type='radio';i.name='lr-pick-scope';i.checked=checked;i.onchange=on;const t=document.createElement('span');t.textContent=text;const n=document.createElement('small');n.textContent=note;l.append(i,t,n);return l;};
  const remember=document.createElement('label');remember.className='lr-remember';const box=document.createElement('input');box.type='checkbox';const why=document.createElement('small');
  const sync=()=>{const allowed=pick.whole&&rememberAllowed(g.layerName);box.disabled=!allowed;if(!allowed){box.checked=false;pick.remember=false;}
   why.textContent=!rememberAllowed(g.layerName)?`'${g.layerName}' 같은 짧은 이름은 기억하지 않습니다`:!pick.whole?'레이어 전체를 고를 때만 기억할 수 있습니다':`다음 도면의 '${g.layerName}' 도 ${ro(label)} 자동`;pick.chosen=pick.whole?whole:g.ids;paint();};
  box.onchange=()=>{pick.remember=box.checked;};remember.append(box,' 사무소 사전에도 기억',why);
  pop.append(radio(`이 묶음만 ${ro(label)}`,`${g.ids.length}개`,true,()=>{pick.whole=false;sync();}));
  if(whole.length>g.ids.length)pop.append(radio(`'${g.layerName}' 레이어 전체`,`${whole.length}개 · 다른 선이 섞여 있을 수 있음`,false,()=>{pick.whole=true;sync();}));
  const only=document.createElement('p');only.className='lr-note';only.textContent='기본은 이번 도면에만 적용합니다.';pop.append(only,remember);
  const again=document.createElement('button');again.type='button';again.textContent='다시 고르기';again.onclick=()=>{pick=null;pop.hidden=true;paint();};
  const ok=document.createElement('button');ok.type='button';ok.className='primary';ok.textContent=`${ro(label)} 정하기`;ok.onclick=commitPick;
  const row=document.createElement('div');row.className='dialog-actions';row.append(again,ok);pop.append(row);sync();
 }
 function commitPick(){
  for(const id of pick.chosen){const d=byId.get(id);if(!d)continue;d.label=pick.label;d.accepted=true;d.reason='도면 확인에서 짚음';manualIds.add(id);}
  if(pick.remember&&pick.whole&&rememberAllowed(pick.layerName))rememberPicks.push({name:pick.layerName,label:pick.label});
  delete marks[pickKey];cancelPick();groups();
 }
 function setView(next){
  view=next;const first=next==='check';q('.lr-check').hidden=!first;q('.lr-tabs').hidden=first;q('.lr-legend').hidden=!first;
  if(first){for(const x of ['.lr-names','.lr-groups','.lr-group-actions','.lr-object'])q(x).hidden=true;q('.lr-hint').textContent='휠 확대 · 드래그 이동 · 색 = 찾은 것, 회색 = 못 찾았거나 기능이 안 쓰는 선';focus=null;paint();}
  else{cancelPick();q('.apply').classList.add('primary');setTab(tab);}
 }
 function groups(){const root=q('.lr-groups');root.replaceChildren();for(const label of ['?',...colors.keys(),'']){const ds=decisions.filter(d=>label==='?'?!!d.label&&d.confidence<.9&&!d.accepted:(d.label||'')===label);if(!ds.length&&label!=='?'&&label!=='')continue;const b=document.createElement('button');b.className='lr-category';b.setAttribute('aria-pressed',String(group===label));const dot=document.createElement('i');dot.style.background=colors.get(label)||'#64717a';const name=document.createElement('span');name.textContent=label==='?'?'확인 필요':label||'미분류 · 원본 유지';const count=document.createElement('small');count.textContent=ds.length+'개'+(ds.some(d=>d.accepted)?' · '+ds.filter(d=>d.accepted).length+'개 확인':'');b.append(dot,name,count);b.onclick=()=>{group=label;chosen=null;groups();paint();};root.append(b);}}
 function summary(n){
  // 위 요약과 아래 적용 단추가 같은 셈: 적용 예정 = 자동 + 이름 묶음 확인 + 직접 고침(종류별 보기)
  const groupIds=new Set(nameGroups.flatMap(g=>g.entityIds));let auto=0,byName=0,manual=0;
  for(const d of decisions){if(!d.accepted||!d.label)continue;if(manualIds.has(d.id))manual++;else if(autoIds.has(d.id))auto++;else if(groupIds.has(d.id))byName++;else manual++;}
  const states=nameGroups.map(g=>nameGroupState(g,byId,g.kept).state);
  const left=nameGroups.filter((g,i)=>(states[i]==='pending'||states[i]==='mixed')&&!g.unnamed),sug=left.filter(g=>g.suggestion).length;
  q('.lr-summary').textContent=`적용 예정 ${n}개 = 자동 ${auto}개 + 이름 묶음 확인 ${byName}개`+(manual?` + 직접 고침 ${manual}개`:'')+` · 남은 줄 ${left.length}(제안 ${sug} · 모름 ${left.length-sug})`;
  q('.layer-review-status').textContent=`적용 예정 ${n}개 · 나머지 ${decisions.length-n}개는 원본 유지 · 아직 도면은 바뀌지 않았습니다.`;
 }
 const rowOf=g=>[...dialog.querySelectorAll('.lr-name-row')].find(r=>r.dataset.key===g.key);
 function pickGroupFor(id){picked=nameGroups.find(g=>g.entityIds.includes(id))||null;focus=picked?new Set(picked.entityIds):null;names();
  const d=byId.get(id);q('.lr-hint').textContent=picked?`고른 선: ${picked.layers.map(l=>l.name).join('·')} 줄`:d?.accepted&&d.label?`고른 선은 이미 ${d.label}(으)로 정해졌습니다(자동)`:'고른 선은 원본 유지입니다';
  if(picked)rowOf(picked)?.scrollIntoView({block:'nearest'});}
 // 적용할 때 남길 사무소 사전: 이름 묶음에 든 레이어는 '다음부터 자동'을 켠 묶음으로만 남긴다(끄면 아무것도 안 남음, 중복 없음).
 function learnedDictionary(){
  const base={};for(const r of rememberPicks)base[layerDictionaryEntry(r.name)]=r.label;
  for(const g of nameGroups)for(const l of g.layers)delete base[layerDictionaryEntry(l.name)];
  return {...base,...dictionaryFromNameGroups(nameGroups.map(g=>{const st=nameGroupState(g,byId,g.kept);return {...g,label:st.state==='confirmed'?st.label:''};}))};
 }
 function names(){
  const root=q('.lr-names');root.replaceChildren();
  if(!nameGroups.length){const p=document.createElement('p');p.className='lr-caption';p.textContent='이름으로 확인할 묶음이 없습니다.';root.append(p);return;}
  let section=null;
  // 줄은 처음 순서 그대로 둔다(확인해도 아래로 옮기지 않는다 — 잘못 누른 것을 그 자리에서 바로 되돌리게).
  for(const g of nameGroups){
   const st=nameGroupState(g,byId,g.kept),state=st.state;if(state==='confirmed')g.label=st.label;
   const heading=g.suggestion?'제안 — 짐작이라 확인해야 옮김':'모름 — 분류를 직접 고르기';
   if(heading!==section){section=heading;const h=document.createElement('p');h.className='lr-names-section';h.textContent=heading;root.append(h);}
   const row=document.createElement('div');row.className='lr-name-row';row.dataset.status=state;row.dataset.key=g.key;row.classList.toggle('picked',picked===g);
   const head=document.createElement('button');head.type='button';head.className='lr-name-head';
   const title=document.createElement('b');title.textContent=g.unnamed?'이름 없는 레이어 ('+g.layers.map(l=>l.name).join('·')+')':g.layers.map(l=>l.name).join(' · ');
   const meta=document.createElement('small');meta.textContent=(g.layers.length>1?`레이어 ${g.layers.length}개 · `:'')+`선 ${g.count}개`;
   head.append(title,meta);head.title='누르면 이 묶음으로 확대';
   const top=document.createElement('div');top.className='lr-name-top';top.append(head);
   head.onclick=()=>{picked=g;focus=new Set(g.entityIds);fit(entities.filter(e=>focus.has(e.id)));names();paint();};
   row.onmouseenter=()=>{focus=new Set(g.entityIds);paint();};row.onmouseleave=()=>{focus=picked?new Set(picked.entityIds):null;paint();};
   row.append(top);
   if(g.unnamed){
    const one=document.createElement('button');one.type='button';one.textContent='선 하나씩 고르기';one.onclick=()=>{setTab('kinds');group='';groups();paint();};
    row.append(one);root.append(row);continue;
   }
   const pick=document.createElement('div');pick.className='lr-name-pick';
   const select=document.createElement('select');select.setAttribute('aria-label',title.textContent+' 분류');
   const blank=document.createElement('option');blank.value='';blank.textContent='분류 고르기';select.append(blank);
   for(const label of new Set([...colors.keys(),...(g.label?[g.label]:[])])){const o=document.createElement('option');o.value=label;o.textContent=label;select.append(o);}
   select.value=g.label;select.disabled=state!=='pending';select.onchange=()=>{g.label=select.value;if(!g.suggestion&&g.label){g.kept=false;applyNameGroup(decisions,g,g.label);groups();}names();paint();};
   const dot=document.createElement('i');dot.className='lr-dot';dot.style.background=colors.get(g.label)||'transparent';
   pick.append(dot,select);
   if(['벽체','콘크리트벽','조적','칸막이','창호','문','계단','축선','벽중심선','중심선','문자'].includes(g.label)){const c=document.createElement('span');c.className='lr-core';c.textContent='단면·법규';c.title='단면 설계·법규 분석에 쓰이는 분류';top.append(c);}
   row.append(pick);
   const actions=document.createElement('div');actions.className='lr-name-actions';
   const undo=()=>{g.kept=false;applyNameGroup(decisions,g,null);groups();names();paint();};
   if(state==='pending'){
    const yes=document.createElement('button');yes.type='button';yes.className='yes';yes.textContent=g.label?`${g.label}(으)로 확인`:'분류를 먼저 고르세요';yes.disabled=!g.label;
    yes.onclick=()=>{g.kept=false;applyNameGroup(decisions,g,g.label);groups();names();paint();};
    const keep=document.createElement('button');keep.type='button';keep.textContent='원본 유지';
    keep.onclick=()=>{g.kept=true;applyNameGroup(decisions,g,null);groups();names();paint();};
    actions.append(yes,keep);
   }else{
    const s=document.createElement('span');
    s.textContent=state==='confirmed'?`✓ ${g.label}(으)로 적용 예정`:state==='kept'?'원본 유지로 정함':st.accepted===g.count?'묶음 안 분류가 서로 다름':`일부만 적용 예정(${st.accepted}/${g.count})`;
    const b=document.createElement('button');b.type='button';b.textContent='확인 취소';b.onclick=undo;
    actions.append(s,b);
   }
   if(g.layers.length>1&&!g.exact&&state!=='confirmed'){
    const split=document.createElement('button');split.type='button';split.className='lr-split';split.textContent='레이어별로 펼치기';split.title='번호마다 뜻이 다를 때(WALL1 콘크리트, WALL2 칸막이) 따로 정합니다';
    split.onclick=()=>{const parts=splitNameGroup(engine.doc,g,loadLayerDictionary()).map(p=>({...p,label:p.suggestion?.label||g.label||'',kept:false,remember:g.remember}));nameGroups.splice(nameGroups.indexOf(g),1,...parts);picked=null;names();paint();};
    top.append(split);
   }
   const siblings=g.parent?nameGroups.filter(x=>x.parent===g.parent):[];
   if(siblings[0]===g){
    const join=document.createElement('button');join.type='button';join.className='lr-split';join.textContent='다시 묶기';
    join.disabled=siblings.some(x=>nameGroupState(x,byId,x.kept).state!=='pending');join.title=join.disabled?'펼친 줄의 확인을 먼저 취소하세요':'펼친 줄을 하나로 합칩니다';
    join.onclick=()=>{nameGroups.splice(nameGroups.indexOf(g),siblings.length,{...g.parent,label:g.parent.suggestion?.label||'',kept:false,remember:false});picked=null;names();paint();};
    top.append(join);
   }
   row.append(actions);
   if(g.suggestion?.hint&&state==='pending'){const s=document.createElement('small');s.className='lr-hint-row';s.textContent='근거: '+g.suggestion.hint;row.append(s);}
   if(g.label&&state!=='kept'&&state!=='mixed'){
    const remember=document.createElement('label');remember.className='lr-remember';
    const box=document.createElement('input');box.type='checkbox';const allowed=g.layers.every(l=>rememberAllowed(l.name));if(!allowed)g.remember=false;box.disabled=!allowed;box.checked=g.remember;box.onchange=()=>{g.remember=box.checked;};
    remember.title='적용할 때 사무소 사전에 저장됩니다. Ctrl+Z 로는 지워지지 않으니 "기억한 이름 관리"에서 지우세요.';
    remember.append(box,allowed?` 다음 도면의 ${rememberTarget(g)}도 ${g.label}(으)로 자동 (적용할 때 기억)`:` 짧은 이름(${g.layers.map(l=>l.name).join('·')})은 사무소 사전에 기억하지 않습니다`);
    row.append(remember);
   }
   if(g.warning&&state==='pending'){const w=document.createElement('p');w.className='lr-warn';w.textContent='⚠ '+g.warning;row.append(w);}
   if(state==='mixed'){const w=document.createElement('p');w.className='lr-warn';w.textContent='종류별 보기에서 일부만 고쳤습니다. 펼쳐서 따로 정하거나 확인 취소 뒤 다시 정하세요.';row.append(w);}
   root.append(row);
  }
 }
 function dictPanel(){
  const box=q('.lr-dict');box.replaceChildren();
  const head=document.createElement('p');head.innerHTML='<b>기억한 이름</b> — 다음 도면부터 자동으로 옮기는 이름입니다. <b>지우기는 바로 저장</b>됩니다(변경 없이 닫아도 되돌아오지 않음). 적용할 때 기억한 이름은 Ctrl+Z 로 지워지지 않으니 여기서 지우세요. 지금 창의 분류는 바뀌지 않습니다.';box.append(head);
  const rows=describeDictionary(loadLayerDictionary());
  if(!rows.length){const p=document.createElement('p');p.textContent='아직 기억한 이름이 없습니다.';box.append(p);}
  for(const r of rows){
   const line=document.createElement('div');line.className='lr-dict-row';
   const name=document.createElement('span');name.textContent=`${r.name} → ${r.label}`;
   const del=document.createElement('button');del.type='button';del.textContent='지우기';
   del.onclick=()=>{const dict=loadLayerDictionary();delete dict[r.entry];try{localStorage.setItem(LAYER_DICTIONARY_KEY,JSON.stringify(dict));}catch{}dictPanel();};
   line.append(name,del);box.append(line);
  }
 }
 q('.lr-dict-open').onclick=()=>{const box=q('.lr-dict');box.hidden=!box.hidden;if(!box.hidden){dictPanel();box.scrollIntoView({block:'nearest'});}};
 function setTab(name){
  tab=name;
  for(const b of dialog.querySelectorAll('.lr-tab'))b.setAttribute('aria-pressed',String(b.dataset.tab===name));
  q('.lr-names').hidden=name!=='names';q('.lr-groups').hidden=name==='names';q('.lr-group-actions').hidden=name==='names';q('.lr-object').hidden=name==='names';
  q('.focus').textContent=name==='names'?'고른 묶음 확대':'이 종류 확대';
  q('.lr-hint').textContent=name==='names'?'줄에 마우스: 보라로 표시 · 이름 누르면 확대 · 도면 선을 누르면 그 줄로':'휠 확대 · 드래그 이동 · 선을 클릭해 수정';
  focus=picked&&name==='names'?new Set(picked.entityIds):null;if(name==='names')names();paint();
 }
 for(const b of dialog.querySelectorAll('.lr-tab'))b.onclick=()=>setTab(b.dataset.tab);
 q('.lr-object-list').onchange=()=>{chosen=q('.lr-object-list').value||null;paint();};
 for(const label of ['',...colors.keys()]){const o=document.createElement('option');o.value=label;o.textContent=label||'원본 유지';q('.lr-category-select').append(o);}
 q('.lr-category-select').onchange=()=>{const d=byId.get(chosen);if(!d)return;manualIds.add(d.id);d.label=q('.lr-category-select').value||null;d.accepted=!!d.label;d.reason='직접 지정';group=d.label||'';groups();paint();};q('.keep').onclick=()=>{const d=byId.get(chosen);if(d){manualIds.add(d.id);d.accepted=false;d.label=null;d.reason='원본 유지로 지정';group='';groups();paint();}};
 q('.exclude').onclick=()=>{decisions.filter(inGroup).forEach(d=>{d.accepted=false;manualIds.add(d.id);});groups();paint();};
 q('.fit').onclick=()=>{fit(entities);paint();};q('.focus').onclick=()=>{const ids=tab==='names'&&picked?new Set(picked.entityIds):null;fit(entities.filter(e=>ids?ids.has(e.id):inGroup(byId.get(e.id))));paint();};q('.original').onclick=()=>{original=!original;q('.original').setAttribute('aria-pressed',String(original));q('.original').textContent=original?'분류 보기':'원본 보기';paint();};
 const point=e=>{const r=preview.getBoundingClientRect();return {x:(e.clientX-r.left)*1000/r.width,y:(e.clientY-r.top)*650/r.height};};
 preview.onwheel=e=>{e.preventDefault();const p=point(e),w=world(p);k=Math.max(.000001,Math.min(1000,k*Math.exp(-e.deltaY*.001)));ox=p.x-w.x*k;oy=p.y+w.y*k;paint();};
 preview.onpointerdown=e=>{const p=point(e);drag={p,start:p,ox,oy};preview.setPointerCapture(e.pointerId);};preview.onpointermove=e=>{if(!drag)return;const p=point(e);ox=drag.ox+p.x-drag.p.x;oy=drag.oy+p.y-drag.p.y;paint();};preview.onpointerup=e=>{if(!drag)return;const p=point(e),start=drag.start;drag=null;if(Math.hypot(p.x-start.x,p.y-start.y)>5)return;const w=world(p);let best=null,distance=18/k;for(const entity of entities){if(!byId.has(entity.id))continue;const d=G.entityDistance(entity,w);if(d<distance){best=entity.id;distance=d;}}if(view==='check'){if(pickKey==='wall-layer'){if(best){const e=engine.doc.entities.find(x=>x.id===best),n=engine.doc.layers.find(l=>l.id===e?.layer)?.name;if(n)wallPicker.toggle?.(n);}return;}if(pickKey&&best)showPick(best,p);return;}chosen=best;if(tab==='names'&&best)pickGroupFor(best);paint();};preview.onpointercancel=()=>{drag=null;};
 q('.cancel').onclick=()=>dialog.close();q('.apply').onclick=()=>{try{if(JSON.stringify(engine.doc)!==snapshot)throw Error('도면이 변경되었습니다. 닫고 다시 분석하세요.');
  if(view==='check'&&server.state==='ok'){const additions=foreignAdditions(server.read,{roomNames:server.roomNames,marks:server.marks}),result=engine.execute({type:'foreign.apply',additions,zone:zoneChoice||''});
   const learned={};for(const r of rememberPicks)learned[layerDictionaryEntry(r.name)]=r.label;try{localStorage.setItem(LAYER_DICTIONARY_KEY,JSON.stringify({...loadLayerDictionary(),...learned}));}catch{}
   refresh();log(`도면 확인 적용(다시 그려 더하기) · 벽 ${additions.walls.length} · 창·문 ${additions.openings.length} · 실 ${additions.rooms.length} · 객체 ${result.added.length}개 · 원본 선 그대로`+(zoneChoice?` · 용도지역 ${zoneChoice}`:'')+` · 사무소 사전 ${Object.keys(learned).length}개 · Ctrl+Z 복구`);dialog.close();return;}const learned=learnedDictionary();const building=check().groups.flatMap(g=>g.items).find(i=>i.key==='building');const result=engine.execute({type:'layer.review',decisions,outline:building?.outline||null,zone:zoneChoice||''});try{localStorage.setItem(LAYER_DICTIONARY_KEY,JSON.stringify({...loadLayerDictionary(),...learned}));}catch{}refresh();log(`도면 확인 적용 · 레이어 ${result.changed}개 옮김`+(building?.outline?' · 건물 외곽 만듦':'')+(zoneChoice?` · 용도지역 ${zoneChoice}`:'')+` · 사무소 사전 ${Object.keys(learned).length}개 기억 · Ctrl+Z 복구`);dialog.close();}catch(e){q('.layer-review-status').textContent=userErrorMessage(e);}};
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.addEventListener('cancel',e=>{if(pickKey){e.preventDefault();cancelPick();}});q('.lr-back').onclick=()=>setView('check');
 dialog.showModal();fit(entities);groups();names();setTab('names');
 {const wallLabels=CHECK_GROUPS[0].items[0].labels,ids=new Set([...decisions.filter(d=>d.accepted&&wallLabels.includes(d.label)).map(d=>d.id),...nameGroups.filter(g=>wallLabels.includes(g.suggestion?.label)).flatMap(g=>g.entityIds)]);const core=entities.filter(e=>ids.has(e.id));if(core.length)fit(core);}
 setView('check');
 q('.orig-off').onclick=()=>{hideOriginal=!hideOriginal;q('.orig-off').textContent=hideOriginal?'원본 켜기':'원본 끄기';paint();};
 {const dict=loadLayerDictionary(),used=new Set(engine.doc.entities.map(e=>e.layer)),known=engine.doc.layers.filter(l=>used.has(l.id)).map(l=>({name:l.name,s:suggestLayerFamily(l.name,dict)})).filter(x=>x.s?.source==='사무소 사전'&&WALL_LABELS.includes(x.s.label)).map(x=>x.name);
  readOnServer(known.length?known:null,'dictionary');}
}

/* 블록 제자리 편집(오토캐드 REFEDIT 처럼): 더블클릭한 블록을 도면 위에서 바로 고친다.
   블록을 풀어 내용을 도면 객체로 꺼내고, 블록 밖 객체는 흐리게·고를 수 없게 한다. 평소 명령(이동·지우기·선 그리기 등)을 그대로 쓴다.
   [저장하고 닫기]는 남은 객체(새로 그린 것 포함)를 같은 id·이름·레이어의 블록으로 다시 묶고, 편집 전체를 되돌리기 한 번으로 줄인다. */
let blockEdit=null;
const BLOCK_RENDER_CACHE=['_renderBounds','_visibleEntities','_lodCollapsed'];
const withoutRenderCache=entity=>{const copy=structuredClone(entity);const strip=e=>{for(const key of BLOCK_RENDER_CACHE)delete e[key];(e.entities||[]).forEach(strip);};strip(copy);return copy;};
/* 같은 이름 블록 전부에 반영(오토캐드): 편집 전 이 삽입본과 다른 삽입본의 점을 맞대어 위치·회전·축척·대칭을 구해 같은 편집을 옮긴다. */
function blockPoints(list){const out=[];for(const e of list||[])for(const p of G.vertices(e)||[])out.push(p);return out;}
function blockSimilarity(fromList,toList){
 const A=blockPoints(fromList),B=blockPoints(toList);if(A.length<2||A.length!==B.length)return null;
 let i1=0,far=0;for(let i=1;i<A.length;i++){const d=G.dist(A[0],A[i]);if(d>far){far=d;i1=i;}}if(far<=G.EPS)return null;
 for(const mirror of [false,true]){
  const f=p=>mirror?{x:-p.x,y:p.y}:p,a0=f(A[0]),va=G.sub(f(A[i1]),a0),vb=G.sub(B[i1],B[0]),s=G.len(vb)/G.len(va),theta=G.angle(vb)-G.angle(va),r=theta*Math.PI/180,c=Math.cos(r),sn=Math.sin(r);
  const map=p=>{const q=f(p),dx=q.x-a0.x,dy=q.y-a0.y;return {x:B[0].x+s*(c*dx-sn*dy),y:B[0].y+s*(sn*dx+c*dy)};};
  const tol=Math.max(1e-3,far*s*1e-7);if(A.every((p,i)=>G.dist(map(p),B[i])<=tol))return {mirror,s,theta,a0,b0:B[0]};
 }
 return null;
}
function applyBlockSimilarity(e,t){let x=structuredClone(e);delete x.id;if(t.mirror)x=G.mirror(x,{x:0,y:0},{x:0,y:1});x=G.translate(x,-t.a0.x,-t.a0.y);x=G.resize(x,{x:0,y:0},t.s);x=G.rotate(x,{x:0,y:0},t.theta);return G.translate(x,t.b0.x,t.b0.y);}
/* 공유 블록 삽입본 좌표 → 정의(로컬) 좌표. 정방향은 (p-원점)×축척(대칭이면 x 반전) → 회전 → +삽입점. */
function toSharedLocal(e,ref,origin){let x=G.translate(structuredClone(e),-(ref.position?.x||0),-(ref.position?.y||0));x=G.rotate(x,{x:0,y:0},-(Number(ref.rotation)||0));x=G.resize(x,{x:0,y:0},1/(Number(ref.scale)||1));if(ref.mirror===true)x=G.mirror(x,{x:0,y:0},{x:0,y:1});return G.translate(x,origin.x||0,origin.y||0);}
function startBlockEdit(chosenPath=null){
 if(blockEdit)throw Error('이미 블록을 편집 중입니다. 위쪽 [저장하고 닫기]나 [취소]를 먼저 누르세요.');
 const blocks=engine.doc.entities.filter(e=>selected.has(e.id)&&e.type==='block');if(blocks.length!==1)throw Error('편집할 블록 하나를 선택하세요.');
 let source=blocks[0];
 if(layerMap().get(source.layer)?.locked)throw Error('잠긴 레이어의 블록입니다.');
 if(source.xref)throw Error('외부참조는 원본 파일 보호를 위해 직접 편집하지 않습니다. XREF 관리자에서 결합한 로컬 블록을 선택한 뒤 편집하세요.');
 // 606: 공유 블록 안에 중첩 블록이 있으면 어느 단계를 편집할지 고른다(바깥 › 안쪽). 안쪽을 고르면 그 정의만 편집하고 바깥은 주변으로 흐리게.
 if(!chosenPath&&source.sharedBlock){const paths=nestedPaths(engine.doc.sharedBlocks,source);if(paths.length>1){form('편집할 블록 · REFEDIT',[{name:'path',label:'블록 (바깥 › 안쪽)',value:'0',options:paths.map((p,i)=>[String(i),p.label])}],v=>{const path=paths[Number(v.path)]?.path||[source];safe(()=>path.length>1?startNestedBlockEdit(path):startBlockEdit(path));});return;}}
 engine.closeTransaction?.();
 const startDoc=engine.doc,undoStack=engine.undoStack,sharedRef=source.sharedBlock?source:null;
 if(source.sharedBlock){execute({type:'shared.materialize',ids:[source.id]});source=engine.doc.entities.find(e=>e.id===source.id);}
 const originalEntities=withoutRenderCache({entities:source.entities}).entities;
 if(!source?.entities?.length)throw Error('블록 안에 객체가 없습니다.');
 const outside=new Set();for(const e of engine.doc.entities)if(e.id!==source.id)outside.add(e.id);
 const {entities,...header}=source;
 execute({type:'batch',commands:[{type:'delete',ids:[source.id]},{type:'addMany',entities:entities.map(child=>({...withoutRenderCache(child),layer:child.layer||source.layer}))}]});
 blockEdit={header:withoutRenderCache(header),startDoc,undoStack,sharedRef,originalEntities};blockEditOutside=outside;
 setSelected([]);showBlockEditBar();refresh();
 log(`블록 편집: ${header.name||'이름 없는 블록'} · 블록 밖은 흐리게 잠깁니다 · 다 고치면 위쪽 [저장하고 닫기](REFCLOSE)`);
}
/* 606 중첩 REFEDIT: path=[바깥 참조, 안쪽 참조…]. 안쪽 정의 자식을 경로 행렬로 놓아 편집하고, 바깥 블록의 나머지는 주변(흐리게·잠김)으로 둔다.
   저장 = 역행렬로 로컬화해 안쪽 정의 교체 한 번 + 바깥 참조는 그대로 되돌려 놓기. */
function startNestedBlockEdit(path){
 const top=path[0];engine.closeTransaction?.();
 const startDoc=engine.doc,undoStack=engine.undoStack,ws=openWorkSet(engine.doc,path);
 if(!ws.members.length)throw Error('안쪽 블록에 객체가 없습니다.');
 const outside=new Set();for(const e of engine.doc.entities)if(e.id!==top.id)outside.add(e.id);
 const ids=execute({type:'batch',commands:[{type:'delete',ids:[top.id]},{type:'addMany',entities:ws.context},{type:'addMany',entities:ws.members}]});
 const contextIds=new Set(ids.slice(0,ws.context.length));for(const id of contextIds)outside.add(id);
 const {entities,...header}=top;
 blockEdit={header:{...withoutRenderCache(header),name:path.map(r=>r.name||r.sharedBlock).join(' › ')},startDoc,undoStack,sharedRef:top,originalEntities:[],nested:{key:ws.key,workset:ws,contextIds}};blockEditOutside=outside;
 setSelected([]);showBlockEditBar();refresh();
 log(`안쪽 블록 편집: ${blockEdit.header.name} · 바깥 블록의 나머지와 도면은 흐리게 잠깁니다 · 저장하면 이 정의를 쓰는 모든 삽입본이 바뀝니다`);
}
/* 608 BEDIT: 이름으로 정의를 골라 편집. 놓인 참조가 있으면 그 자리에서, 없으면 원점에 임시로 놓고 편집한 뒤 임시 참조는 지운다. */
function blockEditorDialog(){
 const list=editableDefinitions(engine.doc);if(!list.length)throw Error('편집할 공유 블록 정의가 없습니다. BLOCK 으로 먼저 만드세요.');
 form('블록 편집기 · BEDIT',[{name:'key',label:'블록 정의',value:list[0].key,options:list.map(x=>[x.key,`${x.name} · 삽입 ${x.count}개`])}],v=>safe(()=>{
  const before=engine.doc,target=beditTarget(engine.doc,v.key,{layer:activeLayer});
  if(target.temporary){const [id]=execute({type:'add',entity:target.ref});setSelected([id]);}else setSelected([target.ref.id]);
  startBlockEdit([engine.doc.entities.find(e=>selected.has(e.id))]);
  if(blockEdit&&target.temporary){blockEdit.startDoc=before;blockEdit.temporary=true;}
 }));
}
function closeBlockEdit(save){
 const session=blockEdit;if(!session)return;
 const finish=()=>{blockEdit=null;blockEditOutside=null;showBlockEditBar();sceneKey=null;refresh();};
 // 도면 탭이 바뀌었으면 그 도면의 이력은 건드리지 않는다.
 if(engine.undoStack!==session.undoStack){finish();return;}
 if(save){
  const members=engine.doc.entities.filter(e=>!blockEditOutside.has(e.id));
  if(!members.length)throw Error('블록 안에 남은 객체가 없습니다. [취소]하거나 객체를 하나 이상 남기세요.');
  const edited=members.map(withoutRenderCache);let updated=0,skipped=0;
  if(session.nested){
   const {key,workset,contextIds}=session.nested,present=engine.doc.entities.filter(e=>contextIds.has(e.id)).map(e=>e.id);
   updated=buildSharedRefIndex(engine.doc).top.get(session.sharedRef.sharedBlock)?.size||0;
   execute({type:'batch',commands:[{type:'delete',ids:[...members.map(e=>e.id),...present]},{type:'add',entity:withoutRenderCache(session.sharedRef)},{type:'shared.define',key,entities:closeWorkSet(workset,edited)}]});
  }else if(session.sharedRef){
   // 공유 블록: 정의를 바꾸면 같은 정의를 쓰는 삽입본이 모두 바뀐다. 편집한 삽입본은 원래 공유 참조로 되돌린다.
   const key=session.sharedRef.sharedBlock,origin=engine.doc.sharedBlocks?.[key]?.origin||{x:0,y:0};
   updated=(buildSharedRefIndex(engine.doc).top.get(key)?.size||0)+(session.temporary?0:1); // 602 역색인(문서 배열마다 한 번) · 지금 편집 중인 삽입본(잠시 풀어 둔 것) 포함
   execute({type:'batch',commands:[{type:'delete',ids:members.map(e=>e.id)},...(session.temporary?[]:[{type:'add',entity:withoutRenderCache(session.sharedRef)}]),{type:'shared.define',key,entities:edited.map(e=>{const {id,...rest}=toSharedLocal(e,session.sharedRef,origin);return rest;})}]});
  }else{
   const commands=[{type:'delete',ids:members.map(e=>e.id)},{type:'add',entity:{...session.header,entities:edited}}];
   // 같은 이름의 다른 (보통) 블록 삽입본에도 같은 편집을 옮긴다. 모양이 달라 맞지 않는 삽입본은 건드리지 않는다.
   for(const other of engine.doc.entities){
    if(other.type!=='block'||other.sharedBlock||other.id===session.header.id||other.name!==session.header.name||!other.name)continue;
    const t=blockSimilarity(session.originalEntities,other.entities);
    if(!t){skipped++;continue;}
    commands.push({type:'update',ids:[other.id],changes:{entities:edited.map(e=>applyBlockSimilarity(e,t))}});updated++;
   }
   const def=engine.doc.blocks?.find(b=>b.name===session.header.name),t=def&&blockSimilarity(session.originalEntities,def.entities);
   if(t)commands.push({type:'document.update',changes:{blocks:engine.doc.blocks.map(b=>b===def?{...b,entities:edited.map(e=>applyBlockSimilarity(e,t))}:b)}});
   execute({type:'batch',commands});
  }
  const at=engine.undoStack.indexOf(session.startDoc);
  if(at>=0){engine.undoStack.length=at+1;engine.redoStack=[];}
  finish();setSelected(session.temporary?[]:[session.header.id]);
  log(`블록을 저장했습니다${(session.sharedRef?updated>1:updated>0)?` · 같은 이름 블록 ${session.sharedRef?updated:updated+1}개에 반영`:''}${skipped?` · 모양이 달라 ${skipped}개는 그대로`:''}. Ctrl+Z 한 번으로 편집 전으로 되돌립니다.`);return;
 }
 blockEditOutside=null;
 while(engine.doc!==session.startDoc&&engine.undoStack.includes(session.startDoc))execute({type:'undo'});
 engine.redoStack=[];
 finish();log('블록 편집을 취소했습니다.');
}
function showBlockEditBar(){
 let bar=document.getElementById('block-edit-bar');
 if(!blockEdit){bar?.remove();return;}
 if(!bar){
  bar=document.createElement('div');bar.id='block-edit-bar';bar.className='block-edit-bar';bar.setAttribute('role','status');
  const label=document.createElement('span'),save=document.createElement('button'),cancel=document.createElement('button');
  save.type=cancel.type='button';save.className='primary';save.textContent='저장하고 닫기';cancel.textContent='취소';
  save.onclick=()=>safe(()=>closeBlockEdit(true));cancel.onclick=()=>safe(()=>closeBlockEdit(false));
  bar.append(label,save,cancel);canvas.parentElement.append(bar);
 }
 bar.firstChild.textContent=`블록 편집 중 · ${blockEdit.header.name||'이름 없는 블록'} — 블록 밖 객체는 흐리게 잠겨 있습니다`;
}
function paintBlockEditFocus(palette,drawingBox){
 ctx.save();ctx.globalAlpha=.68;ctx.fillStyle=palette.background;ctx.fillRect(0,0,width,height);ctx.restore();
 for(const e of visible()){
  if(blockEditOutside.has(e.id))continue;
  drawEntity(ctx,e,screen,scale,e._displayColor||e.color||layerMap().get(e.layer)?.color,selected.has(e.id)?2.3:screenLineweightPx(e._displayLineweight??e.lineweight??0.25),false,false,drawingBox);
 }
}
// 다른 도면으로 바꾸면 편집 표시는 닫는다(그 도면의 꺼낸 내용은 되돌리기로 되돌릴 수 있다).
addEventListener('cad-document-switched',()=>{if(blockEdit&&engine.undoStack!==blockEdit.undoStack){blockEdit=null;blockEditOutside=null;showBlockEditBar();}});

/* ── 리습 입력 창 ──
   Electron 은 window.prompt 를 지원하지 않는다(5.0.1~5.0.2 에서 동봉 리습이 첫 질문에서 멈춘 원인).
   리습이 값을 물을 때마다 본체 폼 창으로 한 가지씩 받는다. 창을 닫으면 리습 전체를 취소한다. */
/* ── 공통 화면 입력 ──
   명령들이 공유하는 세 가지 입력: 점 하나 찍기, 객체 하나 고르기, 점을 이어 찍기(미리보기·C 닫기·U 취소).
   각각 Promise 를 돌려주고, Esc 나 다른 명령 실행으로 reset() 되면 null 로 끝난다. */
/* 점 하나 입력. 예전에는 canvas 포인터만 들었으나(명령창 좌표 입력 불가), 지금은 PICKPATH 한 점으로 받아 좌표 입력·스냅·투명 줌이 모두 된다. */
/* 문자열("안내문")과 객체({prompt,preview}) 둘 다 받는다. 카드 모듈 14곳이 객체로 부르는데 문자열만 받으면 안내가 "[object Object]" 로 보였다. */
function pickPointOnce(options='도면에서 점을 클릭하세요. Esc로 취소합니다.'){
 const given=typeof options==='string'?{prompt:options}:(options&&typeof options==='object'?options:{});
 const prompt=typeof given.prompt==='string'&&given.prompt.trim()?given.prompt:'도면에서 점을 클릭하세요. Esc로 취소합니다.';
 return pickPathOnce({prompt,preview:typeof given.preview==='function'?given.preview:null,options:given.options||null,minPoints:1,maxPoints:1}).then(r=>r&&Object.hasOwn(r,'option')?r:r&&r.points&&r.points[0]?snapSource({x:r.points[0].x,y:r.points[0].y},r.points[0].snapEntityId):null);
}
/* 모달 폼이 열린 채로는 도면을 클릭할 수 없다. 폼 [적용] 뒤에 점·객체를 찍는 카드(TII·NUMC·LC 등)를 위해 입력을 시작할 때 폼을 닫는다. */
function closeFormForPicking(){const dialog=document.getElementById('form-dialog');if(dialog?.open){form.closingForPick=form.session;dialog.close();}}
function pickEntityOnce({prompt='객체를 클릭하세요 · Esc 취소',types=null,allowNone=null,withPoint=false,options=null}={}){
 return new Promise(resolve=>{closeFormForPicking();reset();mode='PICKENTITY';phase='pick';params={prompt:typeof prompt==='string'?prompt:'객체를 클릭하세요 · Esc 취소',types,allowNone,withPoint,options:Array.isArray(options)?options:null,resolve,onCancel:()=>resolve(null)};updatePrompt();render();canvas.focus();});
}
function pickPathOnce({prompt='점을 이어 찍으세요 · Enter 완료 · C 닫기 · U 한 점 취소',preview=null,options=null,minPoints=2,maxPoints=0}={}){
 return new Promise(resolve=>{closeFormForPicking();reset();mode='PICKPATH';phase='point';points=[];params={prompt:typeof prompt==='string'?prompt:'점을 이어 찍으세요 · Enter 완료 · C 닫기 · U 한 점 취소',preview,options,minPoints,maxPoints,resolve,onCancel:()=>resolve(null)};updatePrompt();render();canvas.focus();});
}
function settlePick(value){const settle=params.resolve;params.onCancel=null;params.resolve=null;reset();if(settle)settle(value);}
function ensureLayerByName(name,color){
 const found=engine.doc.layers.find(l=>l.name===name);if(found)return found.id;
 execute({...(standardLayerForName(name)||{}),type:'layer.add',name,color:standardLayerForName(name)?.color||color||'#ffd479'});return engine.doc.layers.find(l=>l.name===name).id;
}
const openWallPreset=installWallPreset({storage:localStorage,entities:()=>engine.doc.entities,layers:()=>engine.doc.layers,ensureLayer:ensureLayerByName,addEntities:list=>addEntities(list),commit:commitCardResult,tolerance:()=>Math.max(4,Math.min(30,num('pickbox-size',10)))/scale,setSelected:ids=>setSelected(ids),pickEntity:pickEntityOnce,pickPoint:pickPointOnce,pickPath:pickPathOnce,toast,userErrorMessage,run:name=>run(name)});
/* ── 보조명령 카드 공통 문맥. 문·창·개구부·계단·주차·벽 정리 카드가 같은 문맥을 쓴다. ──
   commit: 벽선 삭제와 새 객체 추가를 한 번의 batch 로 넣어 Ctrl+Z 한 번에 되돌린다.
   askNumber: 명령입력 먼저 방식일 때 폭 하나만 묻는 작은 폼(설정 창 열기 단추 포함). */
// select:false = 새 객체를 고르지 않고 직전 선택(P)으로만 남긴다(문·창처럼 넣고 끝나는 카드).
function commitCardResult({removeIds=[],entities=[],definitions=null,reviewObjectSeq=null,select=true}){
 const layer=engine.doc.layers.find(l=>l.id===activeLayer);
 if(!layer?.visible||layer.locked)throw Error('현재 레이어가 숨김/잠금 상태입니다. 다른 레이어를 선택하세요.');
 const list=entities.map(e=>({...e,layer:e.layer||activeLayer}));
 // 609: 매개변수 블록은 공유 정의(값마다 하나)를 먼저 넣고 참조만 더한다.
 const commands=[...(reviewObjectSeq?[{type:'document.update',changes:{reviewObjectSeq}}]:[]),...(removeIds.length?[{type:'delete',ids:removeIds}]:[]),...(definitions&&Object.keys(definitions).length?[{type:'shared.add',definitions}]:[]),{type:'addMany',entities:list}];
 const ids=execute({type:'batch',commands});if(select)setSelected(ids);else commandDone(ids);refresh();return ids;
}
/* 카드 숫자 입력. 기본은 양수만 받되, min/allowZero/allowNegative 로 카드마다 범위를 정한다.
   기본값이 0 인 카드(PW 두께 0=변환만, XLD 각도 0, FE 남길 길이 0)는 옵션이 없어도 0 을 허용한다. */
function askCardNumber({title,label,value,settings,min,max,allowZero,allowNegative},onValue){
 // 0·음수 허용은 카드가 명시한다(min / allowZero / allowNegative). 기본값이 0 이라는 이유만으로 0 을 받지 않는다.
 const lower=Number.isFinite(min)?min:allowNegative?-Infinity:allowZero?0:null;
 form(title,[{name:'value',label,type:'number',value}],async values=>{
  const n=Number(values.value);
  if(!Number.isFinite(n)||String(values.value??'').trim()==='')throw Error('숫자를 입력하세요.');
  if(lower===null?n<=0:n<lower)throw Error(lower===null?'양수를 입력하세요.':lower===0?'0 이상의 숫자를 입력하세요.':`${lower} 이상의 숫자를 입력하세요.`);
  if(Number.isFinite(max)&&n>max)throw Error(`${max} 이하의 숫자를 입력하세요.`);
  setTimeout(()=>{beginCardWork();Promise.resolve().then(()=>onValue(n)).catch(e=>toast(e,true)).finally(()=>endCardWork());},0);
 });
 if(typeof settings==='function'){const b=document.createElement('button');b.type='button';b.dataset.temporaryFormAction='card-settings';b.textContent='설정 창 열기';b.onclick=()=>{$('form-dialog').close();settings();};$('form-dialog').querySelector('.dialog-actions').prepend(b);}
 $('form-fields').querySelector('input')?.focus();
}
// 서버 계산(PLANSET 평면 읽기·벽체 다시 그리기)을 기다리는 동안 진행 창을 띄운다. 돌려준 함수로 닫는다.
function computeWait(text){$('drawing-load-title').textContent='바른 서버 계산';updateDrawingLoad(text,null);return ()=>{endDrawingLoad();updatePrompt();};}
// 벽 찾기는 바른 서버에서(로그인 필요). 명령 실행 때만 보내고 기다리는 동안 진행 창을 띄운다. 도면 열기·편집에는 계산을 넣지 않는다.
async function detectWallDocument(document){
 const snapshot=engine.doc;busy=true;$('drawing-load-title').textContent='벽 찾기';
 updateDrawingLoad('벽 찾기 · 바른 서버에서 평행 벽면을 분석하고 있습니다.',null,document.entities.length+'개 객체');
 try{
  const {detectWalls}=await import('./compute-client.js');
  const result=await detectWalls(document);
  if(engine.doc!==snapshot)throw Error('도면이 변경되었습니다. 벽 찾기를 다시 실행하세요.');
  return result;
 }finally{busy=false;endDrawingLoad();updatePrompt();}
}
// AI 도면 다시 만들기: 도면 기준은 이 PC 의 열쇠 묶음(서버)에서, 생성기는 우리 명령을 돌리므로 새 Worker 에서(끝나면 닫는다).
async function generateAccessPlan(document,options={}){
 const response=await fetch('/drawing-knowledge.json',{cache:'no-store'}),knowledge=await response.json();
 if(!response.ok)throw Error(knowledge.error||'도면 기준을 열 수 없습니다.');
 if(engine.doc!==document)throw Error('도면이 변경되었습니다. 계획도를 다시 실행하세요.');
 busy=true;updateDrawingLoad('편의시설 계획도를 그리고 있습니다.',null);let client;
 try{
  const {createCommandClient}=await import('./command-runner.js');client=createCommandClient();
  const planSets=Object.entries(document.drawingSets||{}).filter(([,s])=>['plan','set'].includes(s.kind));
  const planEntry=planSets.length===1&&planSets[0][1].kind==='plan'?planSets[0]:null,planSet=planEntry?.[1];
  const planStory=planSet?.options?.story||planSet?.model?.stories?.[0]?.id;
  if(options.story&&planEntry&&options.story!==planStory)throw Error('열린 평면의 층과 다릅니다. 해당 층 평면을 열고 실행하세요.');
  const {pendingEdits}=await import('./drawing-sync.js');
  const sync=planEntry?pendingEdits(document,planEntry[0]):null;
  if(sync?.lost)toast('손 편집이 있어 현재 도면의 레이어·블록으로 편의시설 후보를 인식합니다.');
  const result=await client.generate(document,{kind:'access-plan',...knowledge,facility:options.facility,story:sync?.lost?undefined:options.story||planSet?.options?.story||undefined,origin:sync?.lost?undefined:planSet?.options?.origin,model:sync?.lost?undefined:options.model||sync?.model||planSet?.model,overlay:true});
  if(engine.doc!==document)throw Error('도면이 변경되어 계획도를 적용하지 않았습니다.');
  execute({type:'lisp.apply',document:result.document});selected=new Set(result.added);refresh();return result;
 }finally{client?.stop();busy=false;endDrawingLoad();updatePrompt();}
}
// No OCCT imports or Workers until the first building-view command.
let occtDrawingService=null,occtViewEpoch=0;
async function beginModelWaiting(title){
 if(!aiDrawRevealEnabled())return null;
 const {startModelWait}=await import('./wait-model-progress.js');
 const wait=startModelWait(canvas.closest('.viewport'),{title});
 endDrawingLoad();return wait;
}
async function generateOcctView(document,request){
 const epoch=occtViewEpoch;
 busy=true;$('drawing-load-title').textContent='건물 도면 만들기';updateDrawingLoad('3D 도면 엔진을 준비하고 있습니다.',null);
 let wait;
 try{
  wait=await beginModelWaiting('건물 도면 만들기');

  if(!occtDrawingService){
   const {createOcctDrawingService}=await import('./occt-commands.js');
   if(epoch!==occtViewEpoch || engine.doc!==document)throw Error('도면이 변경되어 건물 도면 작업을 취소했습니다. 다시 실행하세요.');
   occtDrawingService=createOcctDrawingService();
  }
  return await occtDrawingService.generate(document,request,(message,event)=>wait?wait.push({...event,label:message}):updateDrawingLoad(message,null),{detailedProgress:!!wait});
 }finally{wait?.destroy();busy=false;endDrawingLoad();updatePrompt();}
}
function closeOcctViews(){occtViewEpoch++;const service=occtDrawingService;occtDrawingService=null;void service?.close();}
addEventListener('cad-document-switched',closeOcctViews);
addEventListener('pagehide',closeOcctViews);
async function regenerateDrawingSet(document,setId,request={}){
 const response=await fetch('/drawing-knowledge.json',{cache:'no-store'}),knowledge=await response.json();
 if(!response.ok)throw Error(knowledge.error||'도면 기준을 열 수 없습니다.');
 busy=true;$('drawing-load-title').textContent='AI 도면 다시 만들기';updateDrawingLoad('도면을 다시 그리고 있습니다.',null);
 let client,wait;
 try{wait=await beginModelWaiting('AI 도면 다시 만들기');wait?.push({phase:'engine',label:'도면 기준을 준비하고 있습니다.'});const {createCommandClient}=await import('./command-runner.js');client=createCommandClient();return await client.generate(document,{setId,...knowledge,...request},{onProgress:wait?event=>wait.push(event):undefined});}
 finally{wait?.destroy();client?.stop();busy=false;endDrawingLoad();updatePrompt();}
}
async function wallDetectResult(result,{summary,draw,select}){
 const snapshot=engine.doc;busy=true;updateDrawingLoad('벽 찾기 · 미리보기를 준비하고 있습니다.');
 let overlay;
 try{overlay=await wallDetectionPreview(result);if(engine.doc!==snapshot)throw Error('도면이 변경되었습니다. 벽 찾기를 다시 실행하세요.');}
 finally{busy=false;endDrawingLoad();updatePrompt();}
 wallDetectionOverlay=overlay;render();
 const dialog=document.createElement('dialog');dialog.className='drafting-dialog';dialog.setAttribute('aria-label','벽 찾기 결과');
 const title=document.createElement('h2');title.textContent='벽 찾기';title.style.textWrap='balance';
 const status=document.createElement('p');status.textContent=summary;status.setAttribute('role','status');status.style.fontVariantNumeric='tabular-nums';
 const legend=document.createElement('p');legend.textContent='연두: 벽 · 노랑: 신뢰도 낮음(<0.6) · 빨강 점선: 판단 보류 · 파랑 점선: 기둥';legend.style.textWrap='pretty';
 const error=document.createElement('p');error.setAttribute('role','alert');
 const actions=document.createElement('div');actions.className='dialog-actions';
 const add=document.createElement('button'),original=document.createElement('button'),close=document.createElement('button');
 add.type=original.type=close.type='button';add.textContent='벽 중심선 그리기';add.className='primary';add.disabled=!result.walls.length;original.textContent='원본 선 선택';close.textContent='닫기';
 add.onclick=()=>{try{draw();dialog.close();}catch(e){error.textContent=userErrorMessage(e);}};
 original.onclick=()=>{try{select();}catch(e){error.textContent=userErrorMessage(e);}};
 close.onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{wallDetectionOverlay=null;dialog.remove();render();canvas.focus();});
 actions.append(add,original,close);dialog.append(title,status,legend,error,actions);document.body.append(dialog);dialog.showModal();
}
const cardContext={storage:localStorage,entities:()=>engine.doc.entities,blocks:()=>engine.doc.blocks,layers:()=>engine.doc.layers,ensureLayer:ensureLayerByName,commit:commitCardResult,sharedDefinitions:true,setSelected:ids=>setSelected(ids),pickEntity:pickEntityOnce,pickPoint:pickPointOnce,pickPath:pickPathOnce,tolerance:()=>Math.max(4,Math.min(30,num('pickbox-size',10)))/scale,askNumber:askCardNumber,toast,userErrorMessage,run:name=>run(name),
 /* 1차 병렬 작업(유틸 카드)용 추가 문맥: 선택 객체·엔진 명령·폼·현재 켜·로그·화면 갱신 */
 selected:()=>engine.doc.entities.filter(e=>selected.has(e.id)),selectedIds:()=>[...selected],beginAIReveal,endAIReveal,execute:command=>execute(command),form:(title,fields,onApply,onCancel)=>form(title,fields,cardFormApply(onApply),onCancel),activeLayer:()=>activeLayer,setActiveLayer:id=>{if(engine.doc.layers.some(l=>l.id===id)){activeLayer=id;refresh();}},log,refresh:()=>refresh(),num:(key,def)=>{try{const v=num(key,def);return Number.isFinite(v)?v:def;}catch{return def;}},scale:()=>scale,
 /* EXP(작업폴더 열기)용: 지금 탭 도면의 실제 파일 경로(열거나 저장한 적 없으면 빈 문자열). */
 drawingFilePath:()=>typeof filePath==='string'?filePath:'',
 /* OPA(저장 없이 다시 열기)용: 지금 탭에서 연 DXF/DWG 파일을 다시 변환해 읽는다(탭에 열지는 않는다). 본체는 이 창이 열거나 저장한 경로만 받는다. */
 readDrawingFile:async path=>{try{return await importPreparedDrawingPath(path,{selected:true});}finally{endDrawingLoad();}}};
// AI 연결 실행기(화면 없는 일꾼)가 모아 돌려준 '화면이 할 일'을 사람이 직접 실행했을 때처럼 처리한다(2026-10-27 설명서 시험):
// 저장소 값 쓰기 → 파일 내려받기 → 클립보드 쓰기 → 이어서 부를 화면 명령(DIMSTYLE·XREF 창 등) 열기.
studio.context.applyCommandFollowUps=async f=>{
 const failed=[];
 for(const [k,v] of Object.entries(f?.storage||{}))try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v);}catch{}
 if(f?.downloads?.length){for(const d of f.downloads)downloadText(d.filename,d.text,d.type);}
 if(f?.clipboard!=null)try{await (window.cadDesktop?.clipboardText?window.cadDesktop.clipboardText(f.clipboard):navigator.clipboard.writeText(f.clipboard));}catch{failed.push('클립보드에 쓰지 못했습니다');toast('클립보드에 쓰지 못했습니다. 화면을 한 번 누른 뒤 다시 실행하세요.',true);}
 for(const name of f?.run||[])setTimeout(()=>run(name),0);
 return {failed};   // AI 실행은 이걸 결과 경고로 돌려준다
};
// 본체 중계 요청은 이 칸의 실제 엔진에서만 처리한다. 객체는 다른 프로세스로 보내지 않는다.
const outputCloseReservation=createOutputCloseReservation({engine,hold:()=>{outputCloseHeld=true;},release:()=>{outputCloseHeld=false;}});
window.cadDesktop?.onOutputReleased?.(id=>outputCloseReservation.release(id));
const outputContext={...cardContext,outputReservation:outputCloseReservation,outputReserve:request=>outputCloseReservation.acquire(request),
 outputState:(allowAI,lease)=>{const state=drawingOpenState();return {...state,busy:busy||(outputCloseHeld&&!outputCloseReservation.active(lease))||restoringTabs||fileImportQueue.length>0||mode!=='SELECT'||!!document.querySelector('dialog[open]')||(!allowAI&&!!studio.context.isAIWorking?.()),drawings:documents.tabs.map(t=>({id:t.id,name:t.name,dirty:!!t.dirty}))};},
 outputCloseTab:id=>{documents.checkpoint();const tab=documents.tabs.find(t=>t.id===id);if(!tab||tab.dirty||documents.tabs.length<2)throw Error('저장된 도면만 닫을 수 있습니다.');documents.remove(id);scheduleDrawingRecovery();},
 outputActive:()=>documents.activeId,outputSelect:id=>{if(documents.activeId!==id)documents.select(id);},
 outputBatch:apply=>{engine.beginTransaction();try{const result=apply();engine.endTransaction();return result;}catch(error){engine.rollbackTransaction();throw error;}}
};
window.cadDesktop?.onOutputRequested?.(request=>handleOutputRequest(outputContext,request));
window.cadDesktop?.onOutputClosed?.(r=>{const message=qqResultMessage({requested:r.requested,closed:r.closed.length,failed:r.failed.length,dirtySkipped:r.dirty.length,names:r.names});toast(message.text,message.isError);});
if(window.cadDesktop?.outputWindows)studio.context.runOutputCommand=(name,inputs,options={})=>runOutputCommand({...outputContext,deferOutputClose:options.afterDelivery,beforeOutput:options.beforeOutput,beforeOutputClose:options.beforeOutputClose,commitOutput:options.commitOutput},name,inputs);
{const propertyContext={...cardContext,pickFiles:studio.pickFiles,api:studio.api,afterCommand,openDrawingCheck:()=>{layerReviewDialog();return {opened:'도면 확인',note:'직원이 벽 레이어·확인 필요를 보고 [이 도면에 적용]을 누르면 도면에 그려집니다.'};},confirmDimensionBreak:changes=>new Promise(resolve=>{
 const preview=document.createElement('canvas');preview.width=720;preview.height=420;preview.style.width='100%';preview.style.height='auto';preview.style.display='block';preview.style.touchAction='none';preview.setAttribute('aria-label','치수 끊기 적용 결과 미리보기');
 const result=renderDimensionBreakPreview(preview,engine.doc,changes);
 form('치수 끊기 결과',[],()=>resolve(true),()=>resolve(false));
 const hint=document.createElement('p');hint.textContent='파란 치수는 적용 후 결과입니다. 휠 확대 · 드래그 이동';hint.style.textWrap='pretty';
 const fit=document.createElement('button');fit.type='button';fit.textContent='미리보기 전체 보기';fit.onclick=result.reset;
 $('form-fields').append(hint,preview,fit);
 }),getTextHeight:()=>{const v=Number($('text-height')?.value);return Number.isFinite(v)&&v>0?v:null;},getSettings:()=>{try{return JSON.parse(localStorage.getItem('barun-cad-global')||'{}');}catch{return {};}},getDisplayPrecision:()=>displayPrecision,setDisplayPrecision,doc:()=>engine.doc,detectWallDocument,computeWait,wallDetectResult,regenerateDrawingSet,generateAccessPlan,generateOcctView,getCurrentProperties:()=>currentProperties,setCurrentProperties:value=>{currentProperties=value;syncPropertyStrip();},setTextHeight:value=>{const input=$('text-height');if(input)input.value=String(value);}};
 /* 건축 요소 명령 등록은 card-registry.js 한 곳에서(화면 없는 실행기 command-runner.js 와 같은 목록). */
 /* ACAD200 522·524·520: 찾기·맞춤법 결과 위치로 확대(fitBox), 엑셀 연결 표가 로컬 엔진(excel)을 부르는 연결. */
 cardContext.zoomToBounds=propertyContext.zoomToBounds=b=>{if(b)fitBox(b);};propertyContext.api=(route,data)=>studio.context.api(route,data);
 Object.assign(cardCommands,installCardCommands(cardContext,propertyContext,{styledDimension,openArchitecturalDetail}));
 /* ATTSYNC 는 두 영역이 만들었다: 521(카드 · 기준 블록에 속성 글자 배치 맞추기)과 612(studio · 공유 정의의 ATTDEF 목록에 삽입본 속성 맞추기).
    공유 정의에 ATTDEF 가 있는 도면이면 612 를, 아니면 521 을 쓴다(BATTMAN 은 언제나 612). */
 if(cardCommands.ATTSYNC&&studio.handlers.ATTSYNC){const layoutSync=cardCommands.ATTSYNC;cardCommands.ATTSYNC=(...args)=>{const defs=engine.doc.sharedBlocks;return defs&&Object.values(defs).some(d=>d?.entities?.some(e=>e?.attdef))?studio.handlers.ATTSYNC():layoutSync(...args);};}
  Object.assign(cardCommands,installDimensionEditing(cardContext,G));
  /* ACAD200 영역 7: LAYDEL·VIEW·UNITS·LAYOUT·VPSCALE·VPLAYER·VPMAX·EXPORTLAYOUT·PLOTSTAMP·PUBLISH·COLORBOOK … (acad200-s7.js) */
  s7Tools=createS7Tools({engine,execute,refresh,toast,log,form:cardContext.form,formFields:()=>$('form-fields'),chosen,activeLayer:()=>activeLayer,storage:localStorage,
   getScreen:()=>({scale,origin:{...origin},width,height:fitHeight()}),setScreen:view=>{rememberView();scale=view.scale;origin={...view.origin};render();},fitBox,
   api:(name,args)=>studio.api(name,args),output:(data,name,mime)=>studio.output(data,name,mime),pickFile:pickOneFile,tabs:()=>{documents?.checkpoint?.();return documents?.tabs||[];},
   openDrawingTab:(doc,name,modified)=>openDrawingTab(doc,name,modified),plotSVG,plotPDFJob,fileName:()=>fileName,runCommand:name=>run(name),setPrecision:value=>{try{setDisplayPrecision(value);}catch{}},
   invalidateScene:()=>{gpuEdit=null;sceneRevision++;sceneKey=null;render();}});
  Object.assign(cardCommands,s7Tools.commands);s7Tools.syncDisplay();
  engine.onChange(()=>{if(s7Tools.syncDisplay()){sceneKey=null;}});
  S4.connectEditHooks({setClipboard:data=>{if(data)cadClipboard=data;}});
 /* 기능군 숫자 메뉴판(H06): 있는 명령만 보여 주고, 메뉴판에서 실행한 명령은 최근 줄로 */
 cardCommands.QMENU=()=>{const known=new Set([...COMMANDS.map(c=>c.name),...Object.keys(cardCommands)]),labelOf=name=>COMMANDS.find(c=>c.name===name)?.label||name;const model=quickMenuModel(known,labelOf,readRecent(localStorage)),rect=canvas.getBoundingClientRect(),at=lastDrawingPointer?screen(lastDrawingPointer):null;openQuickMenu(document,document.body,model,{anchor:at?{x:Math.min(rect.left+at.x,innerWidth-340),y:Math.min(rect.top+at.y,innerHeight-420)}:{x:rect.left+24,y:rect.top+24},onRun:name=>{recordRecent(localStorage,name);run(name);},onClose:()=>canvas.focus()});};} /* 숨김 목록은 architecture-command-pack.js 한 곳에서(xiSetup→BRSETUP 이름 불일치 해소) */
/* H12·H07 레이어 번호(2026-09-26): LAYNUM(LN) 번호로 현재 레이어·객체 이동, LAYNUMLIST(LNL) 번호표 편집. */
/* 리습 질문 대기열(lisp-question-queue.js). 늦게 오는 close 이벤트는 창이 다시 열려 있으면 무시한다. */
const lispQuestions=createQuestionQueue();
$('form-dialog').addEventListener('close',()=>{
 lispQuestions.onDialogClose({dialogOpen:$('form-dialog').open});
 if($('form-dialog').open)return;
 /* [적용] 없이 닫힌(Esc·×) 카드 창: 카드가 폼 답을 기다리는 약속은 영영 풀리지 않으므로 여기서 카드 묶음(transaction)을 닫는다.
    점 찍기를 위해 닫은 경우(closingForPick)와 적용 뒤 닫힌 경우는 제외한다. 카드가 onCancel 을 주었으면 불러 준다. */
 const cancelled=form.appliedSession!==form.session&&form.closingForPick!==form.session;
 if(!cancelled)return;
 const onCancel=form.onCancel;form.onCancel=null;
 if(engine.inTransaction())engine.closeTransaction();
 if(onCancel)safe(()=>onCancel());
});
function askLispInput({command,what,prompt,step,pickPoint,warning}){
 return new Promise(resolve=>{
  const settle=lispQuestions.ask(resolve);
  const question=String(prompt||'').replace(/\\n|\n/g,' ').replace(/\s*[:：]\s*$/,'').trim();
  const kind=what||'값',pointLike=/점$/.test(kind);
  const hint=pointLike?'X,Y 로 적거나 도면에서 찍기 · 빈 값은 Enter':kind==='거리'?'숫자 또는 X,Y · 빈 값은 Enter':kind==='선택어'?'보기 중 하나 · 빈 값은 Enter':'빈 값은 Enter';
  const recipe=ARCHITECTURE_LISP[command];
  form(`${command} 리습 · ${step}번째 입력${recipe?' · '+recipe[0]:''}`,[{name:'value',label:`${question||kind} (${kind}) · ${hint}`,value:''}],async values=>{settle(String(values.value??''));});
  if(warning)$('form-error').textContent=warning;
  // 닫기 × 와 Esc 는 close 이벤트가 늦게 올 수 있어 눌린 즉시 취소로 처리한다.
  const cancelNow=()=>settle(null);$('form-dialog').querySelector('[data-close]')?.addEventListener('click',cancelNow,{once:true});$('form-dialog').addEventListener('cancel',cancelNow,{once:true});
  if(recipe?.[1]){const note=document.createElement('p');note.className='lisp-recipe-note';note.textContent='입력 순서: '+recipe[1];$('form-fields').append(note);}
  if(pointLike&&typeof pickPoint==='function'){
   const pick=document.createElement('button');pick.type='button';pick.dataset.temporaryFormAction='lisp-pick';pick.textContent='도면에서 찍기';
   pick.onclick=async()=>{if(!lispQuestions.takeover(settle))return;$('form-dialog').close();const point=await pickPoint();const r=v=>Math.round(v*1000)/1000;resolve(point?`${r(point.x)},${r(point.y)}`:null);};
   $('form-dialog').querySelector('.dialog-actions').prepend(pick);
  }
  $('form-fields').querySelector('input')?.focus();
 });
}
function architectureReferenceGuide(spec){
 const d=document.createElement('dialog');d.className='architecture-reference-guide';
 const head=document.createElement('div');head.className='architecture-reference-head';
 const icon=document.createElement('div');icon.className='architecture-reference-icon';icon.innerHTML=architectureCommandIconSvg(spec);
 const identity=document.createElement('div');const title=document.createElement('h2');title.textContent=spec.label;const meta=document.createElement('p');meta.textContent=`${spec.alias} · ${spec.category} · 매뉴얼 ${spec.source.row}행`;identity.append(title,meta);head.append(icon,identity);
 const status=document.createElement('div');status.className='architecture-reference-status';
 const selectedEntities=chosen(),types=[...new Set(selectedEntities.map(entity=>entity.type))];
 const heading=document.createElement('strong');heading.textContent='미연결 명령';const selection=document.createElement('p');selection.textContent=`아이콘과 명령 이름은 확인할 수 있습니다. 현재 선택: ${selectedEntities.length}개${types.length?' · '+types.join(', '):''}`;const safety=document.createElement('p');safety.textContent='본체 실행 기능에 연결되지 않아 정식 기능 수에서 제외했습니다. 도면을 변경하지 않습니다.';status.append(heading,selection,safety);
 const actions=document.createElement('div');actions.className='dialog-actions';const close=document.createElement('button');close.textContent='닫기';close.onclick=()=>d.close();actions.append(close);
 d.append(head,status,actions);document.body.append(d);d.addEventListener('close',()=>d.remove(),{once:true});d.showModal();
}

function persistArchitectureAssistState(next){
 architectureAssistState=saveAssistState({storage:localStorage,state:next,commands:architectureReferenceCommands});
 refreshFavoriteToolbar();
 return architectureAssistState;
}
function launchArchitectureReference(spec,ownerDialog=null){
 persistArchitectureAssistState(recordAssistRecent(architectureAssistState,spec.id));
 if(spec.nativeCommand){ownerDialog?.close();run(spec.nativeCommand);}
 else architectureReferenceGuide(spec);
}
/* 건축 설계도구 카드 [▶ 사용법](2026-10-28 시안 승인): 예제 그림(홈페이지) + 쓰는 법 단계가 하나씩 켜지며 돈다.
   설명서에 없는 카드는 명령 라이브러리의 쓰는 때만. 그림이 안 오면(인터넷 없음) 글만 돈다. */
function architectureHowto(spec,ownerDialog){
 const howto=ARCHITECTURE_HOWTO[spec.alias]||ARCHITECTURE_HOWTO[spec.nativeCommand]||ARCHITECTURE_HOWTO[spec.commandCode];
 const code=spec.commandCode||spec.alias||spec.nativeCommand;
 const steps=howto?.steps?.length?howto.steps:[`명령창에 ${code} 입력 → Enter`,...(spec.manualLabel&&spec.manualLabel!==spec.label?[spec.manualLabel]:[]),'화면 아래 안내에 따라 고르거나 점을 찍고, 끝나면 Enter · 취소는 Esc'];
 const d=document.createElement('dialog');d.className='architecture-howto';d.setAttribute('aria-label',spec.label+' 사용법');
 const head=document.createElement('div');head.className='dialog-header';const title=document.createElement('h2');title.textContent=`${code} · ${spec.label} — 사용법`;const close=document.createElement('button');close.type='button';close.textContent='닫기 ×';close.onclick=()=>d.close();head.append(title,close);
 const body=document.createElement('div');body.className='architecture-howto-body';
 const stage=document.createElement('div');stage.className='architecture-howto-stage';
 if(howto?.img){const img=document.createElement('img');img.alt=spec.label+' 예제';img.src=MANUAL_BASE+'manual-cmd-img/'+howto.img;img.onerror=()=>{stage.replaceChildren(Object.assign(document.createElement('p'),{textContent:'예제 그림은 인터넷에 연결되면 보입니다.'}));};stage.append(img);}
 else stage.append(Object.assign(document.createElement('p'),{textContent:'이 명령은 아직 예제 그림이 없습니다.'}));
 const side=document.createElement('div');const list=document.createElement('ol');for(const text of steps){const li=document.createElement('li');li.textContent=text;list.append(li);}
 const bar=document.createElement('div');bar.className='architecture-howto-bar';const fill=document.createElement('b');bar.append(fill);
 const actions=document.createElement('div');actions.className='dialog-actions';const start=document.createElement('button');start.type='button';start.className='primary';start.textContent='이 명령 실행';start.onclick=()=>{d.close();launchArchitectureReference(spec,ownerDialog);};actions.append(start);
 if(howto?.book){const more=document.createElement('a');more.href=`${MANUAL_BASE}${howto.book}/index.html#${encodeURIComponent(code)}`;more.target='_blank';more.rel='noopener';more.textContent='설명서에서 더 보기 ↗';more.onclick=e=>{if(navigator.onLine===false){e.preventDefault();toast('인터넷 연결 뒤 다시 누르세요 — 설명서는 홈페이지(barunarc.co.kr)에 있습니다.',true);}};actions.append(more);}
 side.append(list,bar,actions);body.append(stage,side);d.append(head,body);
 // 단계를 2.8초마다 하나씩 켠다. 움직임 줄이기 설정이면 확대하지 않는다.
 const still=matchMedia('(prefers-reduced-motion: reduce)').matches;let at=0;
 const step=()=>{[...list.children].forEach((li,k)=>li.classList.toggle('on',k===at));const img=stage.querySelector('img');if(img&&!still)img.style.transform=`scale(${1+0.12*((at%3)+1)})`;fill.style.transition='none';fill.style.width='0';requestAnimationFrame(()=>{fill.style.transition='width 2.6s linear';fill.style.width='100%';});at=(at+1)%list.children.length;};
 step();const timer=setInterval(step,2800);
 d.addEventListener('close',()=>{clearInterval(timer);d.remove();},{once:true});d.addEventListener('keydown',e=>e.stopPropagation());
 document.body.append(d);d.showModal();
 return d;
}
function architectureCatalog(){
 const d=document.createElement('dialog');d.className='architecture-catalog';
 const header=document.createElement('div');header.className='dialog-header';const title=document.createElement('h2');title.textContent='건축 설계도구';if(BARUN_BETA_MODE){const beta=document.createElement('span');beta.className='beta-badge';beta.textContent='BETA 5';title.append(' ',beta);}const close=document.createElement('button');close.textContent='닫기';close.onclick=()=>d.close();header.append(title,close);
 const note=document.createElement('p');note.textContent='카드의 영문 코드를 명령창에 치면 같은 명령이 실행됩니다. "안내만(미완료)" 명령은 실행하면 제공 범위 안내만 나옵니다.';
 const controls=document.createElement('div');controls.className='architecture-catalog-controls';
 const search=document.createElement('input');search.type='search';search.placeholder='명령, 한글 기능명, 분류 검색';search.setAttribute('aria-label','건축 보조 명령 검색');
 const category=document.createElement('select');category.setAttribute('aria-label','건축 보조 명령 분류');for(const value of ['전체','정식 기능','미완료','즐겨찾기','최근 사용',...architectureReferenceCategories]){const option=document.createElement('option');option.value=value;option.textContent=value;category.append(option);}
 const edit=document.createElement('button');edit.type='button';edit.className='architecture-shortcut-toggle';edit.textContent='단축키 편집';
 const showHidden=document.createElement('label'),showHiddenBox=document.createElement('input');showHiddenBox.type='checkbox';showHiddenBox.checked=showHiddenArchCards;showHidden.append(showHiddenBox,'숨긴 카드 보기');
 showHiddenBox.onchange=()=>{showHiddenArchCards=showHiddenBox.checked;try{localStorage.setItem(ARCH_SHOW_HIDDEN_KEY,showHiddenArchCards?'1':'0');}catch{}toolButtons();render();};
 controls.append(search,category,showHidden,edit);
 const feedback=document.createElement('p');feedback.className='architecture-shortcut-feedback';feedback.setAttribute('role','alert');
 const count=document.createElement('p');count.className='architecture-catalog-count';const list=document.createElement('div');list.className='architecture-tool-grid';
 let editing=false,draftHotkeys={...architectureAssistState.hotkeys};
 const runtimeHotkeys={plot:'Ctrl+P',selectAll:'Ctrl+A',copy:'Ctrl+C',cut:'Ctrl+X',paste:'Ctrl+V',copyBase:'Ctrl+Shift+C',commandLine:'Ctrl+9',help:'F1',osnap:'F3',grid:'F7',ortho:'F8',snap:'F9',cancel:'Esc',finish:'Enter'};
 const hotkeyError=result=>{if(result.errors.length)return '사용할 수 없는 단축키가 있습니다. Ctrl, Alt, Shift와 문자·숫자·F키 조합을 사용하세요.';const conflict=result.conflicts[0];if(!conflict)return '';return conflict.reason==='core-hotkey'?`${conflict.hotkey}는 바른 CAD 기본 단축키와 겹칩니다.`:`${conflict.hotkey}가 다른 보조명령과 겹칩니다.`;};
 const render=()=>{
  list.replaceChildren();const query=search.value.trim().toLocaleLowerCase('ko');let shown=0,commands=[...architectureReferenceCommands],filter=category.value;
  if(filter==='즐겨찾기')commands=architectureAssistState.favorites.map(id=>commands.find(spec=>spec.id===id)).filter(Boolean);
  else if(filter==='최근 사용')commands=architectureAssistState.recent.map(id=>commands.find(spec=>spec.id===id)).filter(Boolean);
  for(const spec of commands){
   const favorite=architectureAssistState.favorites.includes(spec.id);
   if(!showHiddenArchCards&&!architectureCardShown(spec)&&!['즐겨찾기','최근 사용'].includes(filter))continue;
   if(query&&!architectureCommandSearchText(spec).includes(query))continue;
   if((filter==='정식 기능'&&spec.releaseStatus!=='official')||(filter==='미완료'&&spec.releaseStatus==='official')||(filter==='즐겨찾기'&&!favorite)||(!['전체','정식 기능','미완료','즐겨찾기','최근 사용'].includes(filter)&&filter!==spec.category))continue;
   const row=document.createElement('article');row.className='architecture-tool-card';row.dataset.availability=spec.availability;
   const launch=document.createElement('button');launch.className='architecture-tool-launch';launch.innerHTML=architectureCommandIconSvg(spec);
   const copy=document.createElement('span');copy.className='architecture-tool-copy';const name=document.createElement('strong');name.textContent=spec.label;const assigned=draftHotkeys[spec.id]||architectureAssistState.hotkeys[spec.id];const meta=document.createElement('small');const code=spec.commandCode||spec.alias;meta.textContent=`${code}${code!==spec.alias?` (매뉴얼 ${spec.alias})`:''} · ${spec.category}${assigned?' · '+assigned:''}`;const badge=document.createElement('em');badge.textContent=architectureReleaseLabel(spec);copy.append(name,meta,badge);launch.append(copy);launch.onclick=()=>launchArchitectureReference(spec,d);
   const star=document.createElement('button');star.className='architecture-tool-favorite';star.textContent=favorite?'★':'☆';star.setAttribute('aria-label',spec.label+' 즐겨찾기');star.onclick=()=>{persistArchitectureAssistState(toggleAssistFavorite(architectureAssistState,spec.id));render();};const how=document.createElement('button');how.type='button';how.className='architecture-tool-how';how.textContent='▶ 사용법';how.setAttribute('aria-label',spec.label+' 사용법');how.onclick=()=>architectureHowto(spec,d);row.append(launch,how,star);
   if(filter==='즐겨찾기'){
    const move=document.createElement('div');move.className='architecture-favorite-order';const index=architectureAssistState.favorites.indexOf(spec.id);
    for(const [label,to] of [['↑',index-1],['↓',index+1]]){const button=document.createElement('button');button.type='button';button.textContent=label;button.disabled=to<0||to>=architectureAssistState.favorites.length;button.setAttribute('aria-label',`${spec.label} ${label==='↑'?'앞으로':'뒤로'} 이동`);button.onclick=()=>{persistArchitectureAssistState(moveAssistFavorite(architectureAssistState,spec.id,to));render();};move.append(button);}row.append(move);
   }
   if(editing){
    const editor=document.createElement('label');editor.className='architecture-hotkey-editor';editor.textContent='단축키';const input=document.createElement('input');input.value=draftHotkeys[spec.id]||'';input.placeholder='예: Ctrl+Alt+W';input.setAttribute('aria-label',spec.label+' 단축키');input.oninput=()=>{if(input.value.trim())draftHotkeys[spec.id]=input.value.trim();else delete draftHotkeys[spec.id];};input.onkeydown=event=>{event.stopPropagation();if(['Tab','Escape'].includes(event.key))return;if(['Backspace','Delete'].includes(event.key)&&!event.ctrlKey&&!event.altKey&&!event.shiftKey&&!event.metaKey){event.preventDefault();input.value='';delete draftHotkeys[spec.id];feedback.textContent='';return;}if(['Control','Alt','Shift','Meta'].includes(event.key))return;event.preventDefault();const value=normalizeAssistHotkey(event);if(value){input.value=value;draftHotkeys[spec.id]=value;feedback.textContent='';}else feedback.textContent='이 조합은 단축키로 사용할 수 없습니다.';};editor.append(input);row.append(editor);
   }
   list.append(row);shown++;
  }
  count.textContent=filter==='전체'?'':`표시 ${shown}개`;
  if(!shown){const empty=document.createElement('p');empty.className='architecture-catalog-empty';empty.textContent='일치하는 도구가 없습니다. 다른 이름이나 별칭을 검색하세요.';list.append(empty);}
 };
 edit.onclick=()=>{
  if(!editing){editing=true;draftHotkeys={...architectureAssistState.hotkeys};edit.textContent='단축키 저장';feedback.textContent='입력 칸에서 원하는 키 조합을 누르세요. Backspace로 해제할 수 있습니다.';render();return;}
  const result=validateAssistHotkeys({hotkeys:draftHotkeys,commands:architectureReferenceCommands,coreHotkeys:{...settings.hotkeys,...runtimeHotkeys}});
  if(!result.ok){feedback.textContent=hotkeyError(result);return;}
  persistArchitectureAssistState({...architectureAssistState,hotkeys:result.valid});editing=false;edit.textContent='단축키 편집';feedback.textContent='보조명령 단축키를 저장했습니다.';render();
 };
 search.oninput=category.onchange=render;search.addEventListener('keydown',event=>event.stopPropagation());d.append(header,note,controls,feedback,count,list);document.body.append(d);d.addEventListener('close',()=>d.remove(),{once:true});d.showModal();render();search.focus();
}
{
 const tools=document.querySelector('.canvas-view-tools');const selectedButton=document.createElement('button');selectedButton.textContent='선택 맞춤';selectedButton.onclick=()=>{const b=G.bounds(chosen());if(b)fitBox(b);else toast('맞출 객체를 먼저 선택하세요.');};
 const mainButton=document.createElement('button');mainButton.textContent='주 도면 찾기';mainButton.onclick=()=>{const es=visible(),centers=es.map(e=>{const b=G.bounds([e]);return b?{e,x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2}:null;}).filter(Boolean);if(!centers.length)return;const sorted=key=>centers.map(c=>c[key]).sort((a,b)=>a-b),xs=sorted('x'),ys=sorted('y'),q=(a,n)=>a[Math.min(a.length-1,Math.floor(a.length*n))],lx=q(xs,.25),hx=q(xs,.75),ly=q(ys,.25),hy=q(ys,.75),dx=Math.max(1000,(hx-lx)*1.5),dy=Math.max(1000,(hy-ly)*1.5),cluster=centers.filter(c=>c.x>=lx-dx&&c.x<=hx+dx&&c.y>=ly-dy&&c.y<=hy+dy);const b=G.bounds(cluster.map(c=>c.e));if(b)fitBox(b);toast('주 도면 후보 '+cluster.length+'개에 맞췄습니다. 전체 객체는 그대로 유지됩니다.');};tools.append(selectedButton,mainButton);
 // 도면 맞춤·확대 밖의 화면 단추(전체화면 · GPU/기존 화면 · 선택 맞춤 · 주 도면 찾기)는 '화면 ▾' 하나로 묶는다(10-25 시안 ②). 단추는 .canvas-view-tools 안에 그대로 있어 이름으로 찾는 코드(일조 보기의 선택 맞춤 등)도 그대로 찾는다.
 const menu=document.createElement('details');menu.className='view-menu';const summary=document.createElement('summary');summary.textContent='화면 ▾';summary.title='전체화면 · GPU 화면 · 선택 맞춤 · 주 도면 찾기';const list=document.createElement('div');list.className='view-menu-list';list.setAttribute('role','menu');menu.append(summary,list);tools.append(menu);
 const gather=()=>{for(const b of [...tools.children])if(b.tagName==='BUTTON'&&b.dataset.command!=='FIT'){b.setAttribute('role','menuitem');list.append(b);}};gather();new MutationObserver(gather).observe(tools,{childList:true});
 // 상태줄은 가로로 스크롤되어 그 안에 띄운 목록이 잘린다 → 열 때 창 기준 위치로 띄운다
 menu.addEventListener('toggle',()=>{if(!menu.open)return;const r=summary.getBoundingClientRect();list.style.left=Math.max(8,Math.min(r.left,innerWidth-list.offsetWidth-8))+'px';list.style.bottom=(innerHeight-r.top+6)+'px';});
 list.addEventListener('click',()=>{menu.open=false;});document.addEventListener('pointerdown',event=>{if(menu.open&&!menu.contains(event.target))menu.open=false;});
}


function configuredWall(a,b,options){
 if(G.dist(a,b)<1e-7)throw Error('서로 다른 두 점을 지정하세요.');
 let path=[a,b];
 if(options.centered===false){const v=G.sub(b,a),length=G.dist(a,b),offset={x:v.y/length*options.width/2,y:-v.x/length*options.width/2};path=path.map(p=>G.add(p,offset));}
 return {type:'wall',points:path,thickness:options.width,openings:[],wallKind:options.wallKind||'rc200',wallName:options.wallName||'철근콘크리트',reference:options.centered===false?'left-face':'center'};
}
function wallSettings(){
 const presets=[['rc200','철근콘크리트 200',200],['rc300','철근콘크리트 300',300],['brick90','조적벽 90',90],['brick190','조적벽 190',190],['block100','블록벽 100',100],['block150','블록벽 150',150],['block200','블록벽 200',200],['dry100','경량 칸막이 100',100],['dry125','경량 칸막이 125',125],['dry150','경량 칸막이 150',150],['custom','사용자 지정',200]];
 let saved={};try{saved=JSON.parse(localStorage.getItem('barun-wall-settings')||'{}');}catch{}
 reset();
 form('벽 설정',[
  {name:'kind',label:'벽 종류',value:saved.wallKind||'rc200',options:presets.map(p=>[p[0],p[1]+' mm'])},
  {name:'width',label:'벽 두께 (mm)',type:'number',value:saved.width||200},
  {name:'centered',label:'기존 중심선을 클릭해서 벽 만들기 (끄면 시작점·끝점을 찍어 그림)',type:'checkbox',value:false}
 ],v=>{
  const options={width:Number(v.width),centered:true,useCenterline:v.centered==='on',wallKind:v.kind,wallName:(presets.find(p=>p[0]===v.kind)?.[1]||'사용자 지정').replace(/\s+\d+$/,'')};
  if(!Number.isFinite(options.width)||options.width<=0||options.width>10000)throw Error('벽 두께는 0 초과 10,000mm 이하로 입력하세요.');
  mode='WALL';phase=options.useCenterline?'wall-center-pick':'point';params=options;lastCommand='WALL';updatePrompt();render();canvas.focus();
  localStorage.setItem('barun-wall-settings',JSON.stringify(options));
 });
 // 기본은 점을 찍어 그리는 방식(좌표 입력 가능). 중심선 클릭 방식은 지난번에 그렇게 골랐을 때만 유지한다.
 const checkbox=$('form-fields').querySelector('[name=centered]');checkbox.checked=saved.useCenterline===true;
 const select=$('form-fields').querySelector('[name=kind]'),width=$('form-fields').querySelector('[name=width]');
 select.addEventListener('change',()=>{width.value=presets.find(p=>p[0]===select.value)[2];redraw();});
 const preview=document.createElement('canvas');preview.width=600;preview.height=160;preview.style.cssText='width:100%;max-height:160px;background:#101820';preview.setAttribute('aria-label','벽 기준선 미리보기');$('form-fields').prepend(preview);
 function redraw(){const w=Number(width.value),ctx=preview.getContext('2d');ctx.clearRect(0,0,600,160);if(!Number.isFinite(w)||w<=0)return;const k=100/Math.max(500,w*2),entity=configuredWall({x:0,y:0},{x:4000,y:0},{width:w,centered:true});drawEntity(ctx,entity,p=>({x:50+p.x*.125,y:90-p.y*k}),k,'#ade5cf');ctx.strokeStyle='#f7bf55';ctx.setLineDash([8,5]);ctx.beginPath();ctx.moveTo(30,90);ctx.lineTo(570,90);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#f7bf55';ctx.font='14px sans-serif';ctx.fillText(checkbox.checked?'적용 후 도면의 기존 중심선 위를 클릭하세요':'적용 후 시작점과 끝점을 찍어 새 벽을 그립니다',30,145);}
 width.addEventListener('input',redraw);checkbox.addEventListener('change',redraw);redraw();
}

function pickWallCenterline(p){
 const hit=pick(p,{exclude:engine.doc.entities.filter(e=>!['line','polyline'].includes(e.type)).map(e=>e.id)});
 if(!hit)throw Error('기준으로 사용할 중심선 위를 클릭하세요. 빈 곳에는 벽을 만들지 않습니다.');
 if(params.usedSources?.includes(hit.id))throw Error('이미 벽을 만든 중심선입니다. 다른 선을 클릭하세요.');
 if(hit.bulges?.some(b=>b))throw Error('곡선 구간은 직선으로 나눈 뒤 선택하세요.');
 const entities=[];for(let i=1;i<hit.points.length;i++)entities.push(configuredWall(hit.points[i-1],hit.points[i],{...params,centered:true}));
 if(hit.closed)entities.push(configuredWall(hit.points.at(-1),hit.points[0],{...params,centered:true}));
 if(!entities.length)throw Error('길이가 있는 중심선을 클릭하세요.');
 setSelected(addEntities(entities,{centerlineId:hit.id}));params.usedSources??=[];params.usedSources.push(hit.id);updatePrompt();
}



// Read-only renderer metrics and isolated test-document access are available only
// in an explicitly requested local diagnostic session.
if(new URLSearchParams(location.search).get('gpu-test')==='1')globalThis.__cadGpuTest={
 load(doc){engine.doc=G.prepareSharedDrawingReferences(structuredClone(doc));if(typeof adoptEntityArray==='function')adoptEntityArray(engine.doc.entities);selected.clear();engine.emit();fit();paintFrame();},
 draw(){sceneKey=null;paintFrame();return gpuView.stats;},
 command(command){engine.execute(command);sceneKey=null;paintFrame();return gpuView.stats;},
 setView(s,o){scale=s;origin=o;sceneKey=null;paintFrame();return gpuView.stats;},
 runCommand(name){run(name);},
 state(){return {stats:gpuView.stats,count:engine.doc.entities.length,scale,origin,revision:sceneRevision,mode,phase,selected:[...selected],selectionWindow:drag?.kind==='selection'?{start:drag.start,current:drag.current,awaitingCorner:!!drag.awaitingCorner}:null};},
 toggle(value){gpuView.setEnabled(value);}
};

// Isolated installer verifier only; ordinary CAD startup does not expose this bridge.
if(new URLSearchParams(location.search).get("quality-verify")==="1" && new URLSearchParams(location.search).get("gpu-test")==="1")globalThis.__barunQuality={run,reset,screen,submit,edit:execute,state:()=>(typeof flushCursorSnap==='function'&&flushCursorSnap(),{mode,phase,drag:drag?{kind:drag.kind,awaitingCorner:drag.awaitingCorner,secondCorner:drag.secondCorner}:null,selected:[...selected],cursor,entities:engine.doc.entities})};
