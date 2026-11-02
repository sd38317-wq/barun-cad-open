import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {COMMANDS} from './commands.js';
import {MENU_CATALOG,MENU_COMPAT_ALIASES,MENU_HIDDEN_COMMANDS,MENU_INSTALLED_COMMANDS,menuCoverage,matchesMenuQuery} from './menu-catalog.js';
import {architectureNativeCommandMap} from './architecture-command-pack.js';
import {linetypeDashPattern} from './view.js';

const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');

test('main menu keeps only File while command search and architecture tools remain available',()=>{
  const html=read('index.html');
  const tabs=[...html.matchAll(/data-tab="([^"]+)"[^>]*>([^<]+)<\/button>/g)].map(match=>[match[1],match[2]]);
  assert.deepEqual(tabs,[['file','File']]);
  assert.match(html,/data-tab="file"[^>]*aria-label="파일"/);
  assert.doesNotMatch(html,/data-tab="ai"/);
  assert.match(read('chat.js'),/id='ai-sidebar-toggle'|id="ai-sidebar-toggle"/);
  assert.match(html,/id="global-command-search"/);
  assert.match(html,/id="global-command-results"/);
  assert.doesNotMatch(html,/<datalist id="command-search-list"/);
  assert.match(html,/href="menu-shell\.css"/);
  // 로고는 영문 글자 모양(barun CAD)으로 보이고, 화면 읽기에는 '바른 CAD'로 읽힌다.
  assert.match(html,/<strong class="wordmark" aria-label="바른 CAD">/);
  assert.doesNotMatch(html,/좋은 설계가|더 좋은 공간/);
  assert.doesNotMatch(html,/세부정보/);
  assert.doesNotMatch(html,/data-tab="assist"/);
  assert.doesNotMatch(read('app.js'),/t\.dataset\.tab==='assist'/);
  assert.match(read('app.js'),/if\(name==='ARCHLIB'\|\|name==='BUILDING'\)\{architectureCatalog\(\);return;\}/);
  assert.doesNotMatch(read('app.js'),/allArchitecture/);
  assert.doesNotMatch(html,/data-command="BUILDING"/);
  assert.doesNotMatch(html,/data-command="PROJECT"/);
  assert.match(read('app.js'),/building-assist-launcher arch-row-card/,'건축 칸은 기호·이름·찾기 → 카드 4줄(2026-10-27 확정 시안)');
  assert.doesNotMatch(read('app.js').slice(read('app.js').indexOf('(function installAuxiliaryPanels()')),/전체 설계도구 열기|즐겨찾기 추가|즐겨찾기가 없습니다/,'건축 요소 패널에는 설계도구와 중복되는 즐겨찾기 안내를 만들지 않아야 한다');
  assert.doesNotMatch(read('app.js'),/건축 설계도구 전체 \$\{catalogSummary\.total\}개/,'건축 설계도구 이름에 전체 명령 수를 붙이지 않아야 한다');
  assert.match(read('app.js'),/filter==='즐겨찾기'/,'즐겨찾기 관리는 건축 설계도구 안에서 유지해야 한다');
  assert.doesNotMatch(read('app.js'),/const symbols=\[\['DOOR','문'\]/,'건축 요소 패널에 고정된 8개 버튼을 다시 만들지 않아야 한다');
  assert.doesNotMatch(read('app.js'),/drawing-tab-new|drawing-save-as/,'도면 탭 줄에 파일 메뉴와 중복되는 새 도면·저장 단추를 만들지 않아야 한다');
});

test('menu shell keeps real commands and avoids placeholder view modes',()=>{
  const app=read('app.js');
  assert.deepEqual(MENU_CATALOG.file.primary.slice(0,3),['NEW','OPEN','SAVE']);
  assert.match(app,/quickGroups=\[\['SELECT'\]/);
  assert.match(app,/quick-tools-toggle/);
  assert.match(app,/addEventListener\('contextmenu'/);
  assert.match(app,/showCommandShortcut\(c\.name\)/);
  assert.match(app,/e\.key==='ArrowDown'/);
  assert.match(app,/e\.key==='ArrowUp'/);
  assert.match(app,/catalog\.open = !catalog\.open/);
  assert.doesNotMatch(app,/const groups=|groups\[tab\]/,'분류 메뉴 위에 같은 명령의 빠른 버튼 줄을 다시 만들지 않아야 한다');
  assert.doesNotMatch(app,/ribbon[^;\n]*도구 전체|도구 전체[^;\n]*ribbon/,'상단 분류 버튼과 같은 역할의 전체 도구 버튼을 다시 만들지 않아야 한다');
  assert.match(app,/summary\.className='ribbon-catalog-trigger'/,'브라우저가 기본 세부정보 문구를 만들지 않도록 실제 summary를 유지해야 한다');
  assert.doesNotMatch(app,/summary\.hidden=true/,'summary를 hidden 처리하면 브라우저 기본 세부정보 문구가 다시 나타날 수 있다');
  assert.match(read('menu-shell.css'),/\.ribbon-catalog > \.ribbon-catalog-trigger\{[\s\S]*?width:1px!important;[\s\S]*?clip-path:inset\(50%\)/);
  assert.match(app,/commands:\['NEW','OPEN','SAVE','SAVEAS','BACKUP','RECOVER'\]/,'파일 메뉴에는 요청한 여섯 항목만 표시한다');
  assert.match(app,/for\(const section of sections\)/,'명령은 메뉴 안에서 한 번만 만든다');
  assert.match(app,/클릭: 실행 · 우클릭: 단축키 수정/);
  assert.deepEqual(MENU_INSTALLED_COMMANDS.NEWBUILD.tabs,['ai']);
  assert.match(read('new-build.js'),/studio\.handlers\.NEWBUILD\s*=\s*open/);
  assert.doesNotMatch(app,/정면도|측면도/);
});

test('every registered command has one explicit menu home and every shortcut is available in that tab',()=>{
  assert.deepEqual(menuCoverage(COMMANDS),{missing:[],unknown:[],duplicates:[]});
  for(const menu of Object.values(MENU_CATALOG)){
    const available=new Set(menu.sections.flatMap(group=>group.commands));
    for(const name of menu.primary)assert.ok(available.has(name),`${menu.label}: ${name}`);
    assert.ok(menu.primary.length<=5,'bounded shortcut count leaves room for the full menu and current-layer control');
  }
});

test('exact compatibility aliases stay callable but only canonical tools are visible',()=>{
  const placements=new Set(Object.values(MENU_CATALOG).flatMap(menu=>menu.sections.flatMap(group=>group.commands)));
  assert.deepEqual(MENU_COMPAT_ALIASES,{
    BUILDING:'ARCHLIB',DRAW:'ARCHLIB',TSD:'ARCHLIB',TSD2:'ARCHLIB',
    WAD:'WALL',PL2:'PLINE',R4:'ROOM',WCT:'WALLJOIN',
    CALCULATE:'NUMCALC',
  });
  for(const [alias,canonical] of Object.entries(MENU_COMPAT_ALIASES)){
    assert.equal(placements.has(alias),false,`${alias} must stay internal`);
    assert.equal(placements.has(canonical),true,`${canonical} must remain visible`);
  }
  const app=read('app.js');
  assert.match(app,/if\(name==='CALCULATE'\)name='NUMCALC'/);
  assert.match(app,/const visibleCommands=\(\)=>COMMANDS\.filter\(c=>!Object\.hasOwn\(MENU_COMPAT_ALIASES,c\.name\)\)/);
  assert.match(app,/const searchCommands=visibleCommands\(\)/);
});

test('unfinished project-folder command and automatic folder capture are removed',()=>{
  assert.equal(COMMANDS.some(command=>command.name==='PROJECT'),false);
  assert.equal(Object.values(MENU_CATALOG).some(menu=>menu.sections.some(group=>group.commands.includes('PROJECT'))),false);
  const studio=read('studio.js');
  assert.doesNotMatch(studio,/PROJECT\(\)/);
  assert.doesNotMatch(studio,/action:'save',folder/);
  assert.match(studio,/localStorage\.removeItem\('barun-cad-project-folder'\)/);
});

test('requested site-review tools are absent from the architecture menu',()=>{
  const architectureMenu=MENU_CATALOG.arch.sections.flatMap(group=>group.commands);
  assert.deepEqual([...MENU_HIDDEN_COMMANDS],['DISTANCECHECK','RATIOS','AREAOUTLINE']);
  for(const command of MENU_HIDDEN_COMMANDS)assert.equal(architectureMenu.includes(command),false,command);
  assert.doesNotMatch(read('site-plan-panel.js'),/open\.textContent='배치 검토'/);
  assert.doesNotMatch(read('app.js'),/button\.textContent='건물 외곽 비교'/);
});

test('native architecture mappings stay available without inventing guided reference commands',()=>{
  const available=new Set(Object.values(MENU_CATALOG).flatMap(menu=>menu.sections.flatMap(group=>group.commands)));
  for(const command of Object.values(architectureNativeCommandMap)){
    if(MENU_HIDDEN_COMMANDS.has(command))assert.ok(COMMANDS.some(item=>item.name===command),command+' remains callable');
    else assert.ok(available.has(command),command);
  }
  const home=name=>Object.entries(MENU_CATALOG).find(([,menu])=>menu.sections.some(group=>group.commands.includes(name)))?.[0];
  assert.equal(home('LEN'),'work');assert.equal(home('LAYISO'),'settings');
  assert.equal(home('SHEETPDF'),'file');assert.equal(home('CONVERT'),'convert');
  assert.equal(home('DOOR'),'arch');assert.equal(home('CHAT'),'ai');
});

test('menu query supports full Korean labels, native names, aliases and multiple terms',()=>{
  assert.ok(matchesMenuQuery('LEN 길이 합계 LIS','길이 합계'));
  assert.ok(matchesMenuQuery('LEN 길이 합계 LIS','len'));
  assert.ok(matchesMenuQuery('LEN 길이 합계 LIS','LIS 길이'));
  assert.ok(matchesMenuQuery('배치·평면 자동생성','평면 자동'));
  assert.equal(matchesMenuQuery('배치 검토','설계 사례'),false);
});

test('menu stylesheet is served and bundled with the desktop app',()=>{
  const css=read('menu-shell.css'),app=read('app.js'),html=read('index.html');
  assert.match(css,/\.right-workspace\s*\{[\s\S]*?position:\s*absolute/);
  assert.match(css,/\.right-workspace\.is-collapsed\s*\{[\s\S]*?width:\s*42px/);
  assert.match(css,/html body #top-ribbon\s*\{[\s\S]*?height:\s*0!important/);
  assert.match(read('server.py'),/'\/menu-shell\.css'/);
  assert.match(read('server.py'),/'\/menu-catalog\.js'/);
  assert.match(read('build_desktop.py'),/root\/'menu-shell\.css'/);
  assert.match(html,/class="engine-state"/);
  assert.match(app,/footer\.prepend\(viewRow\);if\(dock\)viewRow\.after\(dock\)/,'좌표보다 화면·스냅 도구가 먼저 고정되어야 한다');
  assert.match(css,/body > footer > #position \{[\s\S]*?flex:\s*0 0 36ch;[\s\S]*?font-variant-numeric:\s*tabular-nums/);
});

test('current-layer chooser exposes full names, real colors, linetypes and batch replacement',()=>{
  const app=read('app.js'),css=read('menu-shell.css');
  assert.match(app,/header\.after\(headerContext\)/,'레이어·자동정리·작도 보조는 주 메뉴와 분리해 바로 아래 줄에 있어야 한다');
  assert.doesNotMatch(app,/header\.insertBefore\(headerContext,tabs\)/,'도면 상태 도구를 파일·작업·변환 메뉴와 같은 줄에 두지 않아야 한다');
  assert.match(app,/headerContext\.append\(layerLabel,organizeButton\)/);
  assert.match(app,/layerPopover\.append\(layerHeading,layerSearch,layerTools,objectProps,layerColumns,layerList,layerFooter\)/,'객체 특성과 표시·잠금은 통합 레이어 창 안에 둔다');
  // 10-26 사장님 레이어 창 시안: 고른 객체의 레이어 끄기·이것만 보기·잠그기 단추와 되돌리는 단추
  for(const command of ['LAYOFF','LAYISO','LAYLOCK','LAYON','LAYUNLOCK','LAYRESTORE'])assert.match(app,new RegExp(`layerTool\\('[^']+',LAYER_ICON_[A-Z_]+,'${command}'`),command);
  assert.match(app,/syncCurrentLayerChooser\(hit\.layer\)/,'객체를 누르는 순간 해당 레이어를 표시해야 한다');
  assert.match(app,/name\.textContent=layer\.name;name\.style\.color=layer\.color/);
  assert.match(app,/layerLinetypeLabel\(layer\.linetype\)/);
  assert.match(app,/layer\.lineweight\?\?0\.25/);
  assert.match(app,/execute\(\{type:'update',ids,changes:\{layer:target\}\}\)/);
  assert.match(app,/type:'layer\.update',id:layer\.id,changes:\{color:event\.target\.value\}/);
  assert.match(app,/type:'layer\.update',id:layer\.id,changes:\{linetype:event\.target\.value\}/);
  assert.match(app,/type:'layer\.update',id:layer\.id,changes:\{lineweight:value\}/);
  assert.match(app,/current-layer-line-preview/);
  assert.match(app,/선택 객체 \$\{selected\.size\}개를 고른 레이어로 일괄 변경/);
  assert.match(css,/\.current-layer-option-copy strong \{[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(css,/\.header-context \.current-layer-popover\{[\s\S]*?width:min\(680px/);
  assert.match(css,/\.header-context \.current-layer-popover\{[\s\S]*?left:0/);
  assert.match(css,/\.current-layer-editor-controls \{[\s\S]*?grid-template-columns:\s*32px/);
  assert.match(css,/\.current-layer-line-preview \{/);
});

test('layer previews use the exact dash patterns used by drawing rendering',()=>{
  assert.deepEqual(linetypeDashPattern('CONTINUOUS'),[]);
  assert.deepEqual(linetypeDashPattern('CENTER'),[12,3,2,3]);   // 주요 축선이 표준 축척에서 보이게(10/23)
  assert.deepEqual(linetypeDashPattern('DASHED'),[7,5]);
  assert.deepEqual(linetypeDashPattern('DOT'),[1,4]);
  assert.deepEqual(linetypeDashPattern('PHANTOM'),[12,3,2,3,2,3]);
});

test('large drawing selection warms only the top-level index and prepares it before editing',()=>{
  const app=read('app.js');
  const warm=app.slice(app.indexOf('function warmNearbyIndex'),app.indexOf('// 선택 상자에 걸릴 수 있는 후보'));
  assert.doesNotMatch(warm,/prepareEntityDistanceIndex|warmBlocks/,'모든 블록 내부 인덱스를 백그라운드에서 만들면 대형 도면이 계속 멈춘다');
  assert.match(app,/prepareNearbyIndexNow\(\)/,'도면 열기 진행 중 최상위 선택 인덱스를 준비해야 한다');
  assert.match(app,/G\.querySnapPrimitives\(entity,box\)/,'스냅은 주변 블록 일부만 조회해야 한다');
});

test('한글 별칭은 모두 자기 명령으로 간다(라벨·다른 별칭에 가려진 죽은 별칭 없음)', async () => {
 const m = await import('./commands.js');
 const settings = {version: 1, aliases: m.defaultAliases(), hotkeys: m.defaultHotkeys()};
 const dead = Object.entries(m.KOREAN_COMMANDS).filter(([k, v]) => m.resolveCommand(k, settings) !== v).map(([k, v]) => `${k}→${m.resolveCommand(k, settings)} (${v})`);
 assert.deepEqual(dead, []);
});

test('architecture tool favorites appear in the top favorites bar like command favorites',()=>{
  const app=read('app.js');
  const toolbar=/const renderFavoriteToolbar=\(\)=>\{[\s\S]*?\n \};/.exec(app)?.[0]||'';
  // 건축 설계도구 카드의 ☆ 도 상단 즐겨찾기 줄에 버튼으로 뜨고, 누르면 그 도구를 실행한다.
  assert.match(toolbar,/architectureAssistState\.favorites\.map/);
  assert.match(toolbar,/favoriteToolbar\.hidden=!commandFavorites\.size&&!architectureFavorites\.length/);
  assert.match(toolbar,/launchArchitectureReference\(spec\)/);
  // 별을 누르면(즐겨찾기 저장) 줄이 곧바로 다시 그려진다.
  assert.match(app,/function persistArchitectureAssistState\(next\)\{[\s\S]*?refreshFavoriteToolbar\(\);/);
  assert.match(app,/refreshFavoriteToolbar=renderFavoriteToolbar;/);
});

test('command window background opacity slider also works under the air theme',()=>{
  const app=read('app.js'),air=read('barun-air.css');
  assert.match(app,/setProperty\('--command-bg-alpha',String\(alpha\)\)/);
  // The air theme fixes the command panel background with !important; a later rule of the same weight must use the slider value.
  const base=air.indexOf('html[data-barun-theme=air][data-theme] body .input-dock .command-panel{border:1px solid transparent!important;background:var(--d2-fill-soft)!important');
  const slider=air.indexOf('var(--command-bg-alpha,.7)');
  assert.ok(base>=0&&slider>base,'slider rule comes after the theme rule');
  assert.match(air.slice(slider-400,slider+300),/\.input-dock \.command-panel\{background:[^}]*var\(--command-bg-alpha,\.7\)[^}]*!important;\}/);
});

test('command window floats over the drawing so a low background opacity shows the drawing through',()=>{
  const css=read('style.css'),air=read('barun-air.css'),app=read('app.js');
  assert.match(css,/\.drawing-column>\.input-dock\{position:absolute;left:0;right:0;bottom:0;z-index:4;pointer-events:none;/);
  assert.match(css,/\.drawing-column>\.input-dock>\*\{pointer-events:auto;\}/);
  assert.match(css,/\.navigation\{bottom:calc\(var\(--command-dock-h,0px\) \+ 10px\);\}/);
  assert.match(air,/body \.drawing-column>\.input-dock\{background:transparent!important;/);
  assert.match(app,/setProperty\('--command-dock-h'/);
});
test('command search favorites list also shows 건축 설계도구 ☆ favorites like the top favorite bar',()=>{
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 assert.match(app,/\.filter\(Boolean\),\.\.\.architectureFavoriteEntries\(\)\]/,'empty search lists both favorite kinds');
 assert.match(app,/if\(command\.architecture\)\{launchArchitectureReference\(command\.architecture\);return;\}/,'running an architecture favorite opens its reference command');
 assert.match(app,/if\(c\.architecture\)\{persistArchitectureAssistState\(toggleAssistFavorite\(architectureAssistState,c\.architecture\.id\)\)/,'its ☆ toggles the architecture favorite');
});
test('U typed in the command line repeats with Space; Ctrl+Z keeps the previous repeat command',()=>{
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const noRepeat=/const NO_REPEAT=new Set\(\[([^\]]*)\]\)/.exec(app)[1];
 assert.doesNotMatch(noRepeat,/'UNDO'|'REDO'/);
 assert.match(app,/if\(decision\.action==='document'\)\{const repeat=lastCommand;run\(name\);lastCommand=repeat;return;\}/);
});
test("File 메뉴의 '도면 저장'은 지금 파일에 바로 저장(Ctrl+S)이라고 보인다",()=>{
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 assert.equal(COMMANDS.find(c=>c.name==='SAVE').label,'도면 저장');
 assert.match(app,/key\.textContent = settings\.aliases\[name\] \|\| \(name==="SAVE"\?settings\.hotkeys\?\.SAVE\|\|"":""\);/);
});
test('MOVE/COPY prompt shows how many objects are being moved when more than one is selected',()=>{
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 for(const name of ['COPY','MOVE'])assert.ok(app.includes(name+': (selected.size>1?`객체 ${selected.size.toLocaleString()}개 · `:"")+('),name);
});
test('아파트 평면 사례 창은 AI 메뉴에서 열린다(숨은 대지 도구 칸에만 있지 않다)',()=>{
 assert.deepEqual(MENU_INSTALLED_COMMANDS.DESIGNCASES,{label:'아파트 평면 사례',tabs:['ai']});
 assert.match(readFileSync(new URL('./design-cases-panel.js',import.meta.url),'utf8'),/studio\.handlers\.DESIGNCASES=\(\)=>open\.click\(\);/);
});
test('Ctrl+click adds or removes one object at a time and the status bar shows the selected count',()=>{
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 assert.match(app,/if\(mode==='SELECT'&&\(e\.ctrlKey\|\|e\.metaKey\)&&!e\.shiftKey&&!e\.altKey\)\{/);
 assert.match(app,/if\(selected\.has\(hit\.id\)\)selected\.delete\(hit\.id\);else\{selected\.add\(hit\.id\)/);
 assert.match(app,/선택 \$\{selected\.size\.toLocaleString\(\)\}개 · 객체/);
});

test('도움말: 설명서 열기·리습 단축키 내려받기는 홈페이지(https://barunarc.co.kr/cad/manual/)를 인터넷 창으로 연다(2026-10-28)',()=>{
 const html=readFileSync(new URL('./index.html',import.meta.url),'utf8'),app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const band=html.match(/<div class="help-manual">([\s\S]*?)<\/div>/)?.[1]||'';
 const links=[...band.matchAll(/<a [^>]*href="([^"]+)"[^>]*target="_blank" rel="noopener"/g)].map(m=>m[1]);
 assert.deepEqual(links,['https://barunarc.co.kr/cad/manual/','https://barunarc.co.kr/cad/manual/download-lisp-shortcuts-2026-10-27/lisp-shortcuts.pdf','https://barunarc.co.kr/cad/manual/manual-cmd-lisp-2026-10-27/index.html']);
 assert.ok(html.indexOf('help-manual')<html.indexOf('id="help-search"'),'설명서 줄은 명령 검색 위');
 assert.match(app,/help-manual'\)\?\.addEventListener\('click',e=>\{if\(e\.target\.closest\('a'\)&&navigator\.onLine===false\)/);
 // 받을 파일이 저장소에 있다(홈페이지에 그대로 올린다)
 for(const f of ['docs/download-lisp-shortcuts-2026-10-27/lisp-shortcuts.pdf','docs/manual-cmd-lisp-2026-10-27/index.html','docs/manual-index-2026-10-27/index.html'])assert.ok(readFileSync(new URL('./'+f,import.meta.url)).length>0,f);
});
