// ACAD200 영역 7(레이어·특성·배치·뷰포트·출력) 명령과 연결. app.js 에는 연결 몇 줄만 두고 큰 로직은 여기와 각 모듈에 둔다.
// 명령마다 "AutoCAD 방식 → 바른 CAD 가 더 낫게 한 점" 은 각 모듈 머리 주석과 ACAD200-s7.md 에 적었다.
import {saveLayerState, layerStateCommands, deleteLayerState, listLayerStates, LAYER_STATE_KEYS, LAYER_STATE_LABELS, isolateLayerCommands, unisolateLayerCommands, LAYISO_MODES} from './layer-states.js';
import {countLayerDelete} from './engine.js';
import {checkBeforeAction, notifyMessage, reconcileCommands, NOTIFY, NOTIFY_LABELS, flagsFromNotifyMask, notifyMaskFromFlags, unreconciledLayers} from './layer-reconcile.js';
import {saveNamedView, restoreNamedView, deleteNamedView} from './named-views.js';
import {normalizeUnits, unitsSample, LUNITS, AUNITS, INSUNITS_LABEL} from './units.js';
import {parseScaleInput} from './scale-input.js';
import {layoutsFromSheets, paperLayouts, layoutPreviewSVG, exportLayout, setViewportScale, setViewportLock, updateLayoutViewport, maximizeViewport, minimizeViewport} from './paper-space.js';
import {setViewportOverride, clearViewportOverrides, viewportFrozenLayers} from './viewport-layers.js';
import {parseColorBookCsv, parseAcbXml, loadColorBooks, saveColorBooks, mergeColorBook, searchColorBooks} from './color-books.js';
import {collectSheets, runPublish, serializePublishList, parsePublishList, outOfDate} from './publish-list.js';
import {loadPrefs, savePrefs} from './cad-prefs.js';
import {contextTools} from './rollover-tip.js';
import {suggestCommandsRanked, learnCorrection, recordCommandUsage, COMMANDS} from './commands.js';
import {plotStampText, STAMP_FIELDS, STAMP_LABELS} from './plot.js';
import {DEFAULT_LOCK_FADE, lockFadePercent} from './geometry.js';
import {setLineweightDisplay, setLinetypePatternSource} from './view.js';

export {S7_COMMANDS} from './s7-command-names.js';

const yes = (v) => v === 'on' || v === true || v === 'yes';
const num = (v, name) => { const n = Number(String(v ?? '').trim()); if (!Number.isFinite(n)) throw Error(name + ' 값은 숫자입니다.'); return n; };

/**
 * ctx: {engine, execute, refresh, toast, log, form, formFields, chosen, activeLayer, storage, getScreen, setScreen, fitBox,
 *       api, output, pickFile, tabs, openDrawingTab, plotSVG, plotPDFJob, fileName, runCommand, invalidateScene, layerReview}
 */
export function createS7Tools(ctx) {
  let prefs = loadPrefs(ctx.storage), saveTimer = 0, suggestTimer = 0, suggestFrame = 0, vpState = {maximized: null}, lastDefsKey = '';
  const persist = (delay = 0) => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { prefs = savePrefs(ctx.storage, prefs); }, delay); };
  const setPref = (key, value) => { prefs = savePrefs(ctx.storage, {...prefs, [key]: value}); return prefs[key]; };
  const doc = () => ctx.engine.doc;
  const docUpdate = (changes) => ctx.execute({type: 'document.update', changes});
  const batch = (commands) => { if (commands.length) ctx.execute({type: 'batch', commands}); return commands.length; };
  const layerNames = (ids) => doc().layers.filter((l) => ids.has(l.id)).map((l) => l.name);
  const pickLayerIds = (text) => { const wanted = String(text || '').split(/[,\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean); return new Set(doc().layers.filter((l) => wanted.includes(l.name.toLowerCase())).map((l) => l.id)); };
  const selectedLayerIds = () => new Set(ctx.chosen().map((e) => e.layer));
  const layouts = () => paperLayouts(doc());
  const layoutOptions = () => layouts().map((l) => [l.id, `${l.name} · ${l.paper || 'A3'} · 뷰포트 ${l.viewports.length}`]);
  const findLayout = (id) => { const l = layouts().find((x) => x.id === id) || layouts()[0]; if (!l) throw Error('배치가 없습니다. LAYOUT 에서 "도곽에서 배치 만들기" 를 먼저 하세요.'); return l; };
  const firstViewport = (layout) => { const vp = layout.viewports[0]; if (!vp) throw Error('뷰포트가 없는 배치입니다.'); return vp; };
  const showSvg = (svg) => { const box = document.createElement('div'); box.className = 'plot-live'; box.style.maxHeight = '60vh'; box.style.overflow = 'auto'; box.innerHTML = svg; ctx.formFields().append(box); };

  /* 화면 설정을 도면·사용자 설정에 맞춘다(문서가 바뀔 때 O(1), 선종류 정의가 있으면 그 표 크기만). */
  function syncDisplay() {
    const d = doc();
    setLineweightDisplay(d.lineweightDisplay !== false);
    const defs = d.linetypeDefs && typeof d.linetypeDefs === 'object' ? d.linetypeDefs : null;
    const key = prefs.linetypePatterns + '|' + (defs ? JSON.stringify(defs) : '');
    if (key !== lastDefsKey) { lastDefsKey = key; return setLinetypePatternSource(prefs.linetypePatterns, defs); }
    return false;
  }

  const commands = {
    LAYDEL() {
      const ids = selectedLayerIds();
      ctx.form('LAYDEL · 레이어와 그 객체 지우기', [
        {name: 'names', label: '지울 레이어 이름 (쉼표로 여러 개 · 고른 객체의 레이어가 먼저 들어 있음)', value: layerNames(ids).join(', ')},
      ], (v) => {
        const target = pickLayerIds(v.names);
        if (!target.size) throw Error('지울 레이어 이름을 넣으세요.');
        if (target.has(ctx.activeLayer())) throw Error('현재 레이어는 지울 수 없습니다. 다른 레이어를 현재로 바꾸세요.');
        const n = countLayerDelete(doc(), target);
        ctx.execute({type: 'layer.deleteWithEntities', ids: [...target]});
        ctx.toast(`LAYDEL · 레이어 ${target.size}개, 객체 ${n.top.toLocaleString('ko-KR')}개(블록 안 ${n.nested.toLocaleString('ko-KR')}개 · 블록 정의 ${n.blocks}개)를 지웠습니다. Ctrl+Z 한 번으로 되돌립니다.`);
      });
    },
    LAYISOSET() {
      ctx.form('LAYISO 방식', [{name: 'mode', label: '선택하지 않은 레이어를', value: prefs.layIsoMode, options: Object.entries(LAYISO_MODES)}], (v) => {
        setPref('layIsoMode', v.mode);
        ctx.toast(`LAYISO: ${LAYISO_MODES[prefs.layIsoMode]}. LAYUNISO(LAYRESTORE)로 되돌립니다.`);
      });
    },
    LAYLOCKFADECTL() {
      ctx.form('잠긴 레이어 흐리게 (LAYLOCKFADECTL)', [{name: 'value', label: '흐리게 % (0 = 끔, 최대 90 · 기본 ' + DEFAULT_LOCK_FADE + ')', type: 'number', value: lockFadePercent(doc())}], (v) => {
        const value = Math.max(0, Math.min(90, Math.round(num(v.value, '흐리게'))));
        if (value === lockFadePercent(doc())) return;   // AutoCAD 처럼 같은 값이면 아무것도 하지 않는다(다시 그리기 없음)
        docUpdate({lockFade: value});
        ctx.toast(`잠긴 레이어를 ${value}% 흐리게 보입니다. 출력에는 적용되지 않습니다.`);
      });
    },
    LAYERNOTIFY() {
      const flags = flagsFromNotifyMask(Number(doc().layerNotify) || 0);
      ctx.form('새 레이어 알림 (LAYERNOTIFY) · 이 도면에 저장', Object.keys(NOTIFY).filter((k) => ['plot', 'save', 'insert', 'open'].includes(k)).map((k) => ({name: k, label: NOTIFY_LABELS[k] + ' 알리기', type: 'checkbox', value: flags[k]})), (v) => {
        const mask = notifyMaskFromFlags(Object.fromEntries(Object.keys(NOTIFY).map((k) => [k, yes(v[k])])));
        docUpdate({layerNotify: mask, ...(mask && !doc().layerEval ? {layerEval: true} : {})});
        ctx.toast(mask ? '확인하지 않은 새 레이어가 있으면 알립니다. 새 레이어 표시(LAYEREVAL)도 켰습니다.' : '새 레이어 알림을 껐습니다.');
      });
    },
    LAYEREVAL() {
      const on = !doc().layerEval;
      docUpdate({layerEval: on});
      ctx.toast(on ? '붙여넣기·삽입·가져오기로 생긴 새 레이어에 "확인 전" 표시를 붙입니다(바른 표준 레이어 제외). 레이어 관리자의 "새 레이어(확인 전)" 필터로 봅니다.' : `새 레이어 표시를 껐습니다.${unreconciledLayers(doc()).length ? ' 이미 표시된 레이어는 관리자에서 "확인함" 으로 지웁니다.' : ''}`);
    },
    VIEW() {
      const views = doc().namedViews || [];
      ctx.form('이름 있는 뷰 (VIEW)', [
        {name: 'action', label: '작업', value: views.length ? 'restore' : 'save', options: [['save', '지금 화면을 뷰로 저장'], ['restore', '뷰 되살리기'], ['delete', '뷰 지우기']]},
        {name: 'name', label: '새 뷰 이름 (저장)', value: '뷰' + (views.length + 1)},
        {name: 'pick', label: '뷰 고르기 (되살리기·지우기)', value: views[0]?.name || '', options: views.length ? views.map((x) => [x.name, x.name + (x.layerState ? ' · 레이어 상태 있음' : '')]) : [['', '저장한 뷰 없음']]},
        {name: 'layers', label: '레이어 켜기·동결·잠금도 함께 (저장·되살리기)', type: 'checkbox', value: true},
      ], (v) => {
        if (v.action === 'save') { docUpdate(saveNamedView(doc(), v.name, ctx.getScreen(), {withLayers: yes(v.layers)})); ctx.toast(`뷰 "${String(v.name).trim()}" 를 저장했습니다.`); return; }
        if (!v.pick) throw Error('저장한 뷰가 없습니다.');
        if (v.action === 'delete') { docUpdate(deleteNamedView(doc(), v.pick)); ctx.toast(`뷰 "${v.pick}" 를 지웠습니다.`); return; }
        const r = restoreNamedView(doc(), v.pick, ctx.getScreen(), {layers: yes(v.layers)});
        batch(r.commands); ctx.setScreen(r.view);
        ctx.toast(`뷰 "${v.pick}"${r.commands.length ? ` · 레이어 ${r.commands.length}개 되살림` : ''}`);
      });
    },
    UNITS() {
      const u = normalizeUnits(doc().displayUnits);
      ctx.form('단위 (UNITS) · 저장 단위는 늘 mm, 보이는 형식만 바꿉니다', [
        {name: 'lunits', label: '길이 형식', value: String(u.lunits), options: Object.entries(LUNITS)},
        {name: 'luprec', label: '길이 정밀도 (소수 자리)', value: String(u.luprec), options: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => [String(n), String(n)])},
        {name: 'aunits', label: '각도 형식', value: String(u.aunits), options: Object.entries(AUNITS)},
        {name: 'auprec', label: '각도 정밀도', value: String(u.auprec), options: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => [String(n), String(n)])},
        {name: 'angbase', label: '0도 방향 (도, 동쪽 = 0)', type: 'number', value: u.angbase},
        {name: 'angdir', label: '시계 방향을 + 로', type: 'checkbox', value: !!u.angdir},
        {name: 'insunits', label: '이 도면을 넣을 때의 단위 (INSUNITS)', value: String(u.insunits), options: Object.entries(INSUNITS_LABEL)},
      ], (v) => {
        const next = normalizeUnits({...v, angdir: yes(v.angdir) ? 1 : 0});
        docUpdate({displayUnits: next});
        ctx.setPrecision?.(next.luprec);
        ctx.toast('단위 표시: ' + unitsSample(next));
      });
    },
    LWDISPLAY() {
      const on = doc().lineweightDisplay === false;
      docUpdate({lineweightDisplay: on});
      ctx.toast(on ? '선 굵기를 화면에 보입니다(0.75mm 넘는 굵기도 구별).' : '화면의 선을 모두 1픽셀로 봅니다. 출력 굵기는 그대로입니다.');
    },
    PSLTSCALE() {
      const on = doc().psltscale === false;
      docUpdate({psltscale: on});
      ctx.toast(on ? 'PSLTSCALE 켬: 뷰포트 축척이 달라도 종이 위 무늬 길이가 같습니다(배치 미리보기·내보내기).' : 'PSLTSCALE 끔: 뷰포트 안 무늬가 모형 축척을 따릅니다.');
    },
    MSLTSCALE() {
      const on = doc().msltscale === false;
      docUpdate({msltscale: on});
      ctx.toast(on ? 'MSLTSCALE 켬: 모형 선종류 축척에 주석 축척을 곱합니다.' : 'MSLTSCALE 끔.');
    },
    LTPATTERN() {
      ctx.form('선종류 무늬 모양', [{name: 'mode', label: '무늬', value: prefs.linetypePatterns, options: [['lin', 'AutoCAD .lin 정의 비율 (DASHED·HIDDEN 구별, 권장)'], ['legacy', '예전 바른 CAD 모양']]}], (v) => {
        setPref('linetypePatterns', v.mode);
        if (syncDisplay()) ctx.invalidateScene();
        ctx.toast(v.mode === 'lin' ? '선종류 무늬를 .lin 정의 비율로 그립니다.' : '선종류 무늬를 예전 모양으로 그립니다.');
      });
    },
    LAYOUT() {
      const have = layouts();
      ctx.form('배치 (LAYOUT) · 종이(mm) 위에 뷰포트로 모형을 놓습니다', [
        {name: 'action', label: '작업', value: have.length ? 'preview' : 'fromSheets', options: [['fromSheets', '도곽(시트)에서 배치 만들기'], ['preview', '배치 미리보기'], ['delete', '배치 지우기']]},
        {name: 'layout', label: '배치', value: have[0]?.id || '', options: have.length ? layoutOptions() : [['', '배치 없음']]},
      ], (v) => {
        if (v.action === 'fromSheets') {
          const r = layoutsFromSheets(doc());
          if (!r.added) throw Error((doc().sheets || []).length ? '모든 도곽에 이미 배치가 있습니다.' : '도곽(시트)이 없습니다. SHEET 로 도곽을 먼저 만드세요.');
          docUpdate({layouts: r.layouts});
          ctx.toast(`도곽 ${r.added}장에서 배치를 만들었습니다. 각 배치는 뷰포트 하나(축척 잠금)입니다. 예전 도곽 출력은 그대로입니다.`);
          return;
        }
        const layout = findLayout(v.layout);
        if (v.action === 'delete') { docUpdate({layouts: layouts().filter((l) => l.id !== layout.id)}); ctx.toast(`배치 "${layout.name}" 를 지웠습니다. 모형 도면은 그대로입니다.`); return; }
        const svg = layoutPreviewSVG(doc(), layout, ctx.plotSVG);
        ctx.form(`배치 미리보기 · ${layout.name} · 종이 1:1 (회색 = 뷰포트 테두리)`, [], () => {});   // 적용 창 안에서 새 창을 열면 그 창이 남는다
        showSvg(svg);
      });
    },
    VPSCALE() {
      const have = layouts();
      if (!have.length) throw Error('배치가 없습니다. LAYOUT 에서 "도곽에서 배치 만들기" 를 먼저 하세요.');
      const vp = firstViewport(have[0]);
      ctx.form('뷰포트 축척·잠금', [
        {name: 'layout', label: '배치', value: have[0].id, options: layoutOptions()},
        {name: 'scale', label: '축척 (100, 1:100, 1=50, 2:1 …)', value: `1:${+(1 / vp.scale).toFixed(3)}`},
        {name: 'locked', label: '축척 잠금', type: 'checkbox', value: !!vp.locked},
      ], (v) => {
        const layout = findLayout(v.layout), target = firstViewport(layout), parsed = parseScaleInput(v.scale);
        const next = updateLayoutViewport(doc(), layout.id, target.id, (old) => {
          const changed = Math.abs(old.scale - parsed.scale) > 1e-12;
          if (changed && old.locked && yes(v.locked)) throw Error('축척이 잠긴 뷰포트입니다. "축척 잠금" 을 끄고 적용하세요.');
          return setViewportLock(changed ? setViewportScale({...old, locked: false}, parsed.scale) : old, yes(v.locked));
        });
        docUpdate({layouts: next});
        ctx.toast(`뷰포트 축척 ${parsed.label}${yes(v.locked) ? ' · 잠금' : ''}`);
      });
    },
    VPLAYER() {
      const have = layouts();
      if (!have.length) throw Error('배치가 없습니다. LAYOUT 에서 "도곽에서 배치 만들기" 를 먼저 하세요.');
      const vp = firstViewport(have[0]);
      ctx.form('뷰포트별 레이어 (VPLAYER) · 이 뷰포트에서만', [
        {name: 'layout', label: '배치', value: have[0].id, options: layoutOptions()},
        {name: 'action', label: '작업', value: 'freeze', options: [['freeze', '레이어 동결'], ['thaw', '동결 풀기'], ['color', '색 재지정'], ['clear', '재지정 모두 지우기']]},
        {name: 'names', label: '레이어 이름 (쉼표)', value: layerNames(new Set(viewportFrozenLayers(vp))).join(', ') || layerNames(selectedLayerIds()).join(', ')},
        {name: 'color', label: '색 (색 재지정)', type: 'color', value: '#808080'},
      ], (v) => {
        const layout = findLayout(v.layout), target = firstViewport(layout), ids = pickLayerIds(v.names);
        if (v.action !== 'clear' && !ids.size) throw Error('레이어 이름을 넣으세요.');
        const next = updateLayoutViewport(doc(), layout.id, target.id, (old) => {
          if (v.action === 'clear') return {...old, layerOverrides: ids.size ? [...ids].reduce((o, id) => clearViewportOverrides({layerOverrides: o}, {layerId: id}), old.layerOverrides || {}) : {}};
          let ov = old;
          for (const id of ids) ov = {...ov, layerOverrides: setViewportOverride(ov, id, v.action === 'color' ? 'color' : 'frozen', v.action === 'color' ? v.color : v.action === 'freeze')};
          return ov;
        });
        docUpdate({layouts: next});
        ctx.toast(`뷰포트 레이어 재지정 · ${ids.size || '모든'} 레이어. 모형 화면과 다른 배치에는 영향이 없습니다.`);
      });
    },
    VPMAX() {
      const layout = findLayout(null), vp = firstViewport(layout);
      if (vpState.maximized) throw Error('이미 뷰포트를 최대화했습니다. VPMIN 으로 끝내세요.');
      vpState = maximizeViewport({view: ctx.getScreen()}, vp);
      ctx.fitBox(vpState.bounds);
      ctx.toast(`뷰포트 "${layout.name}" 범위를 모형 화면에 띄웠습니다. 도면은 바뀌지 않습니다. VPMIN 으로 돌아갑니다.`);
    },
    VPMIN() {
      if (!vpState.maximized) throw Error('최대화한 뷰포트가 없습니다.');
      const restore = vpState.maximized.restore;
      vpState = minimizeViewport(vpState);
      ctx.setScreen({scale: restore.scale, origin: restore.origin});
      ctx.toast('뷰포트 최대화를 끝냈습니다.');
    },
    EXPORTLAYOUT() {
      const have = layouts();
      if (!have.length) throw Error('배치가 없습니다. LAYOUT 에서 "도곽에서 배치 만들기" 를 먼저 하세요.');
      ctx.form('EXPORTLAYOUT · 배치를 종이 mm 좌표의 새 도면으로', [{name: 'layout', label: '배치', value: have[0].id, options: layoutOptions()}], (v) => {
        const layout = findLayout(v.layout), r = exportLayout(doc(), layout);
        if (!r.count) throw Error('배치에 보이는 객체가 없습니다.');
        setTimeout(() => { ctx.openDrawingTab(r.document, `${layout.name}_배치`, true); ctx.toast(`배치 "${layout.name}" 를 새 도면 탭으로 펼쳤습니다 · 객체 ${r.count.toLocaleString('ko-KR')}개(뷰포트 범위 안 ${r.scanned.toLocaleString('ko-KR')}개만 살폈습니다). 원본은 그대로입니다.`); }, 0);
      });
    },
    PLOTSTAMP() {
      const s = prefs.plotStamp;
      ctx.form('플롯 스탬프 · 출력할 때만 종이에 찍는 한 줄(도면은 바뀌지 않음)', [
        {name: 'on', label: '플롯 스탬프 켜기', type: 'checkbox', value: s.on},
        ...STAMP_FIELDS.filter((k) => !k.startsWith('udf')).map((k) => ({name: 'f_' + k, label: STAMP_LABELS[k], type: 'checkbox', value: s.fields.includes(k)})),
        {name: 'udf1', label: STAMP_LABELS.udf1, value: s.udf1}, {name: 'udf2', label: STAMP_LABELS.udf2, value: s.udf2},
        {name: 'corner', label: '위치', value: s.corner, options: [['bottom-left', '왼쪽 아래'], ['bottom-right', '오른쪽 아래'], ['top-left', '왼쪽 위'], ['top-right', '오른쪽 위']]},
        {name: 'height', label: '글자 높이 mm', type: 'number', value: s.height},
      ], (v) => {
        const fields = STAMP_FIELDS.filter((k) => (k.startsWith('udf') ? String(v[k] || '').trim() : yes(v['f_' + k])));
        setPref('plotStamp', {...s, on: yes(v.on), fields, udf1: v.udf1, udf2: v.udf2, corner: v.corner, height: Number(v.height)});
        const sample = plotStampText(prefs.plotStamp, {fileName: ctx.fileName(), denominator: 100, paper: 'A3', device: 'PDF'});
        ctx.toast(prefs.plotStamp.on ? '플롯 스탬프: ' + (sample?.text || '(필드 없음)') : '플롯 스탬프를 껐습니다.');
      });
    },
    PUBLISH() { return publishDialog(); },
    COLORBOOK() {
      const books = loadColorBooks(ctx.storage);
      ctx.form(`색 견본집 · ${books.length}색`, [
        {name: 'action', label: '작업', value: books.length ? 'apply' : 'import', options: [['import', '견본집 불러오기 (CSV: 이름,R,G,B · 또는 RGB 가 보이는 .acb)'], ['apply', '고른 객체에 색 넣기'], ['clear', '견본집 모두 지우기']]},
        {name: 'search', label: '색 찾기 (이름 일부)', value: ''},
        {name: 'color', label: '색', value: books[0]?.hex || '', options: books.length ? searchColorBooks(books, '', 500).map((c) => [c.hex, `${c.book} · ${c.name} · ${c.hex}`]) : [['', '견본집 없음']]},
      ], async (v) => {
        if (v.action === 'clear') { saveColorBooks(ctx.storage, []); ctx.toast('색 견본집을 지웠습니다.'); return; }
        if (v.action === 'import') {
          const file = await ctx.pickFile('.csv,.acb,.txt,.xml');
          if (!file) return;
          const text = await file.text(), name = file.name.replace(/\.[^.]+$/, '');
          const list = /\.acb$|\.xml$/i.test(file.name) || /<colorBook/i.test(text) ? parseAcbXml(text) : parseColorBookCsv(text, name);
          if (!list.length) throw Error('견본집에서 색을 찾지 못했습니다. CSV 는 "이름,R,G,B" 줄입니다.');
          saveColorBooks(ctx.storage, mergeColorBook(books, list));
          ctx.toast(`색 견본집 "${list[0].book}" ${list.length}색을 불러왔습니다. 특성 창 색 고르기에 나옵니다.`);
          return;
        }
        const found = String(v.search || '').trim() ? searchColorBooks(books, v.search, 1)[0]?.hex : v.color;
        if (!found) throw Error('색을 고르세요.');
        const ids = ctx.chosen().map((e) => e.id);
        if (!ids.length) throw Error('색을 넣을 객체를 먼저 고르세요.');
        ctx.execute({type: 'update', ids, changes: {color: found, colorMode: 'truecolor', aci: null}});
        ctx.toast(`객체 ${ids.length}개에 ${found} 를 넣었습니다.`);
      });
    },
    ROLLOVERTIPS() { const on = setPref('rolloverTips', !prefs.rolloverTips); ctx.toast(on ? '커서를 0.5초 멈추면 그 객체의 특성 4줄을 보입니다.' : '롤오버 특성을 껐습니다.'); },
    PROPOBJLIMIT() { numberPref('propObjLimit', '특성 팔레트 전체 계산 상한 (PROPOBJLIMIT · 넘으면 공통 항목만)', 100); },
    RIBBONCONTEXTSELLIM() { numberPref('ribbonContextSelLimit', '선택 도구 줄 상한 (RIBBONCONTEXTSELLIM · 0 = 제한 없음)', 0); },
    INPUTSEARCHDELAY() { numberPref('inputSearchDelay', '명령 제안 지연 ms (0 = 지연 없이 화면 갱신마다 한 번)', 0); },
  };
  function numberPref(key, label, min) {
    ctx.form(label, [{name: 'value', label, type: 'number', value: prefs[key]}], (v) => {
      const n = Math.round(num(v.value, label));
      if (n < min) throw Error(`${min} 이상으로 넣으세요.`);
      setPref(key, n); ctx.toast(`${label.split(' (')[0]}: ${prefs[key].toLocaleString('ko-KR')}`);
    });
  }

  /* PUBLISH 1단계: 열린 모든 탭의 시트 → 한 PDF. .bpub 로 저장·불러오기. */
  function publishDialog() {
    const tabs = ctx.tabs();
    let list = collectSheets(tabs);
    ctx.form(`일괄 출력 (PUBLISH) · 열린 도면 ${tabs.length}개 · 시트 ${list.length}장`, [
      {name: 'action', label: '작업', value: 'pdf', options: [['pdf', '고른 시트를 PDF 하나로'], ['save', '출력 목록(.bpub) 저장'], ['load', '출력 목록(.bpub) 불러와 PDF']]},
      {name: 'sheets', label: '출력할 시트 (줄마다 "도면 · 번호", 지우면 빠짐)', type: 'textarea', value: list.map((x) => `${x.file} · ${x.number || x.sheetId}`).join('\n')},
      {name: 'collate', label: '같은 페이지 설정이면 한 번에 묶기 (PUBLISHCOLLATE)', type: 'checkbox', value: true},
    ], async (v) => {
      const wanted = new Set(String(v.sheets || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
      if (v.action === 'load') { const file = await ctx.pickFile('.bpub,.json'); if (!file) return; list = parsePublishList(await file.text()); }
      else list = list.filter((x) => wanted.has(`${x.file} · ${x.number || x.sheetId}`));
      if (!list.length) throw Error('출력할 시트가 없습니다. 도곽(SHEET)이 있는 도면을 열어 두세요.');
      if (v.action === 'save') { await ctx.output(btoa(unescape(encodeURIComponent(serializePublishList(list)))), ctx.fileName() + '.bpub', 'application/json'); ctx.toast(`출력 목록 ${list.length}장을 저장했습니다.`); return; }
      const byName = new Map(tabs.map((t) => [t.name, t]));
      const stale = [];
      const result = await runPublish(list, {
        collate: yes(v.collate),
        resolve: (item) => { const tab = tabs.find((t) => t.id === item.tab) || byName.get(item.file); const sheet = (tab?.doc?.sheets || []).find((s) => (s.id || s.number) === item.sheetId); if (sheet && outOfDate(item, tab.doc)) stale.push(item.number || item.sheetId); return sheet ? {doc: tab.doc, sheet} : null; },
        plotPages: async (pages) => {
          const job = {action: 'plots', pages: pages.map(({doc: d, sheet, item}) => ctx.plotPDFJob(d, {window: sheet.bounds, paper: sheet.paper || 'A3', denominator: sheet.denominator || 100, orientation: sheet.orientation || 'landscape', margin: 0, colorMode: 'auto', title: item.file, bookmark: `${item.number || ''} ${item.title || ''}`.trim() || item.file, stamp: plotStampText(prefs.plotStamp, {fileName: item.file, sheet, denominator: sheet.denominator || 100, paper: sheet.paper || 'A3', device: 'PDF'}) || undefined}))};
          return (await ctx.api('pdf', job)).data;
        },
        merge: async (outputs) => (outputs.length === 1 ? outputs[0] : (await ctx.api('pdf', {action: 'merge', files: outputs})).data),
      });
      await ctx.output(result, ctx.fileName() + '_publish.pdf', 'application/pdf');
      ctx.toast(`시트 ${list.length}장을 PDF 하나로 저장했습니다(쪽마다 책갈피).${stale.length ? ` 목록을 만든 뒤 바뀐 시트: ${stale.join(', ')}` : ''}`);
    });
  }

  /* LAYISO / LAYUNISO(=LAYRESTORE) — 되돌리기 한 번, 파일에 저장되는 상태. */
  function isolate(layerIds) {
    const r = isolateLayerCommands(doc(), layerIds, {mode: prefs.layIsoMode});
    batch(r.commands);
    return r;
  }
  function unisolate(legacy) { return batch(unisolateLayerCommands(doc(), legacy)); }

  /* 707 알림: 알릴 것이 있으면 문장, 없으면 null. */
  function layerNotice(action) {
    const r = checkBeforeAction(doc(), action);
    return r ? {message: notifyMessage(r, action), reconcile: () => batch(reconcileCommands(doc()))} : null;
  }

  return {
    commands,
    prefs: () => prefs,
    setPref,
    syncDisplay,
    isolate, unisolate, layerNotice,
    layerStates: {save: saveLayerState, restore: layerStateCommands, remove: deleteLayerState, list: listLayerStates, keys: LAYER_STATE_KEYS, labels: LAYER_STATE_LABELS},
    suggest: (text, settings, count) => suggestCommandsRanked(text, settings, count, {autoCorrect: prefs.autoCorrect, usage: prefs.commandUsage}),
    learn: (typed, chosen) => { const next = learnCorrection(prefs.autoCorrect, typed, chosen); if (next !== prefs.autoCorrect) { prefs = {...prefs, autoCorrect: next}; persist(500); } },
    recordUsage: (name) => { if (!COMMANDS.some((c) => c.name === name)) return; prefs = {...prefs, commandUsage: recordCommandUsage(prefs.commandUsage, name)}; persist(2000); },
    /* 치는 동안 쌓인 제안 계산은 버리고 마지막 것만(지연 0 = 다음 화면 갱신 때). */
    scheduleSuggest(fn) {
      clearTimeout(suggestTimer); if (suggestFrame) cancelAnimationFrame(suggestFrame); suggestFrame = 0;
      if (prefs.inputSearchDelay > 0) suggestTimer = setTimeout(fn, prefs.inputSearchDelay);
      else suggestFrame = requestAnimationFrame(() => { suggestFrame = 0; fn(); });
    },
    contextTools: (counts, total) => {
      const known = new Set(COMMANDS.map((c) => c.name));
      return contextTools(counts, total, {limit: prefs.ribbonContextSelLimit, known}).map((name) => [name, COMMANDS.find((c) => c.name === name)?.label?.split(' (')[0] || name]);
    },
    dockCap: () => prefs.propObjLimit,
    plotStamp: (context) => plotStampText(prefs.plotStamp, context),
  };
}
