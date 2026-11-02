import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMANDS,resolveCommand,defaultAliases,RETIRED_LISP_COMMANDS,KOREAN_COMMANDS} from './commands.js';
import {readFileSync,readdirSync} from 'node:fs';
import {architectureSourceCommands,architectureReferenceCommands,architectureReferenceCategories,architectureCommandIconSvg,architectureCommandSummary,architectureNativeCommandMap,GUIDANCE_ONLY_ALIASES,REMOVED_REFERENCE_ALIASES,ARCHITECTURE_MERGED_COMMAND_IDS,architectureReleaseLabel,architectureCardShown,ARCHITECTURE_HIDDEN_COMMAND_NAMES} from './architecture-command-pack.js';
import {normalizeAssistState} from './architecture-assist-state.js';
import {architectureCardIconSvg} from './architecture-command-pack.js';
test('그리기 카드는 실제 기본 도형의 검은 SVG, 매스는 준비 중 대체',()=>{
 for(const alias of ['WAL','D1','W1','PLINE','STP','ELV']){const command={alias,label:alias},svg=architectureCardIconSvg(command);assert.match(svg,/^<svg/);assert.match(svg,/fill="#000000"/);assert.match(svg,/<(?:line|path|circle) /);assert.notEqual(svg,architectureCommandIconSvg(command));assert.doesNotMatch(svg,/pencil|<script|onload=/);}
 assert.match(architectureCardIconSvg({alias:'MASS',label:'3D 매스'}),/그림 준비 중 · 3D 매스/);
 assert.equal(architectureCardIconSvg({alias:'QT'}),architectureCommandIconSvg({alias:'QT'}));
});
test('건축 칸은 건축단축키·건축상세도·아파트배치·단위평면도 4줄 — 그리기 단추는 빼고 명령으로 쓴다(2026-10-27 확정 시안)',()=>{
 const source=readFileSync('app.js','utf8'),panel=source.slice(source.indexOf('(function installAuxiliaryPanels()'));
 assert.doesNotMatch(panel,/\[\['벽','WAL'\]/);assert.doesNotMatch(panel,/textContent='선택한 문·창·계단 수정'/);assert.doesNotMatch(panel,/catalogLauncher/);
 for(const label of ['건축단축키','건축상세도','아파트배치','단위평면도'])assert.match(panel,new RegExp("libraryLauncher\\('"+label+"'"));
 assert.match(source,/if\(name==='ARCHLIB'\|\|name==='BUILDING'\)\{architectureCatalog\(\);return;\}/,'건축 설계도구는 ARCHLIB 명령으로 그대로 연다');
});

test('reference command pack preserves manual rows but hides exact functional duplicates',()=>{
 assert.equal(architectureSourceCommands.length,365); // 매뉴얼 394행 − 구현 불가로 삭제한 29개(2026-10-10)
 assert.equal(new Set(architectureSourceCommands.map(command=>command.id)).size,365);
 assert.equal(architectureReferenceCommands.length,359); // 2026-09-21: 구현 불가 29개 숨김(2026-10-10 삭제) · 2026-09-24: LII 중복(두 분류) 하나로
 assert.equal(new Set(architectureReferenceCommands.map(command=>[command.category,command.label,command.alias].join('|'))).size,359);
 assert.equal(architectureReferenceCommands.filter(command=>command.alias==='LII').length,1);
 assert.equal(architectureReferenceCategories.length,18);
});

test('every explicit native mapping resolves to a real Barun CAD command',()=>{
 const names=new Set(COMMANDS.map(command=>command.name));
 for(const [alias,target] of Object.entries(architectureNativeCommandMap))assert.ok(names.has(target),`${alias} -> ${target}`);
 const summary=architectureCommandSummary();
 assert.ok(summary.native>=200);
 assert.equal(summary.total,359);assert.equal(summary.removed,29);
 // 2026-09-24: "완료"는 이름 매핑 수가 아니라 실제로 동작하는 수다. 안내만 하는 명령은 미완료로 센다.
 assert.equal(summary.official+summary.guided,359);
 assert.equal(summary.guidanceOnly,GUIDANCE_ONLY_ALIASES.size);
 assert.equal(summary.official,summary.native-summary.guidanceOnly);
 assert.equal(summary.unavailable,summary.guided);
 assert.equal(summary.guided,summary.unconnected+summary.guidanceOnly);
 assert.equal(summary.sourceTotal,365);
 assert.equal(summary.duplicatesRemoved,6);
});

test('release status reflects real behaviour: official only when connected and not guidance-only',()=>{
 for(const command of architectureReferenceCommands){
  const expected=!command.nativeCommand?'unavailable':GUIDANCE_ONLY_ALIASES.has(command.alias)?'guidance':'official';
  assert.equal(command.releaseStatus,expected,command.alias);
  if(command.releaseStatus==='official')assert.equal(command.availability,'native');
  assert.equal(command.implementation.status,{official:'complete',guidance:'guidance',unavailable:'unconnected'}[command.releaseStatus]);
 }
 for(const alias of ['A0','A1','FCC','MSL','HEX','HP','HPM','MTLT','LEX','BAK','AON','AOFF'])assert.equal(architectureReferenceCommands.find(c=>c.alias===alias).releaseStatus,'official',alias);
 assert.equal(architectureReleaseLabel({releaseStatus:'guidance'}),'안내만(미완료)');
});

test('card code shown in the helper is what actually runs the card when typed',()=>{
 const settings={aliases:defaultAliases()};
 for(const command of architectureReferenceCommands){
  if(!command.nativeCommand)continue;
  assert.equal(resolveCommand(command.commandCode,settings),command.nativeCommand,`${command.alias} → ${command.commandCode}`);
 }
 const code=alias=>architectureReferenceCommands.find(c=>c.alias===alias).commandCode;
 assert.equal(code('B'),'BRK');assert.equal(code('LIS'),'LEN');assert.equal(code('V'),'VSYM');assert.equal(code('X'),'XSYM');
});

test('helper labels come from the same COMMANDS labels as the menu (one source of truth)',()=>{
 const byName=new Map(COMMANDS.map(c=>[c.name,c.label]));
 let mismatches=0;
 for(const command of architectureReferenceCommands)if(command.nativeCommand&&byName.get(command.nativeCommand)!==command.label)mismatches++;
 assert.equal(mismatches,0);
 assert.ok(architectureReferenceCommands.every(c=>typeof c.manualLabel==='string'&&c.manualLabel));
});

test('removed commands stay out of the list and merged ids keep user settings',()=>{
 assert.equal(REMOVED_REFERENCE_ALIASES.size,29);
 assert.ok(architectureSourceCommands.every(c=>!REMOVED_REFERENCE_ALIASES.has(c.alias)),'삭제한 명령은 앱 목록에 없다');
 const [removed,kept]=Object.entries(ARCHITECTURE_MERGED_COMMAND_IDS).find(([,k])=>architectureReferenceCommands.find(c=>c.id===k)?.alias==='LII');
 // 2026-09-24(비평 2): 같은 본체 명령 카드는 하나 — FR/FM·PV/PVV·00/(=,-,*,/)·LII
 const natives=architectureReferenceCommands.map(c=>c.nativeCommand).filter(Boolean);
 assert.equal(new Set(natives).size,natives.length);
 assert.equal(new Set(architectureReferenceCommands.map(c=>c.label)).size,architectureReferenceCommands.length,'같은 이름 카드가 두 장 보이면 안 된다');
 for(const [alias,native] of [['FR','FM'],['PVV','PLINEEDIT'],['00','CALC00']]){const card=architectureReferenceCommands.find(c=>c.nativeCommand===native);assert.ok(card.aliases.includes(alias),alias);assert.equal(ARCHITECTURE_MERGED_COMMAND_IDS[architectureSourceCommands.find(c=>c.alias===alias&&c.id!==card.id)?.id],card.id);}
 const state=normalizeAssistState({favorites:[removed],recent:[removed],hotkeys:{[removed]:'Ctrl+Alt+L'}},architectureReferenceCommands);
 assert.deepEqual(state.favorites,[kept]);assert.deepEqual(state.recent,[kept]);assert.equal(state.hotkeys[kept],'CTRL+ALT+L');
});

test('manual aliases that collide with unrelated Barun commands are never inferred',()=>{
 const byAlias=alias=>architectureReferenceCommands.filter(command=>command.alias===alias);
 assert.ok(byAlias('B').every(command=>command.nativeCommand==='BRK')); // 4차: 바른 CAD 리습 B 다중 끊기 카드는 BLOCK 별칭 B 와 겹쳐 BRK 이름을 갖는다
 // 2026-09-21: V·X 기호 카드는 SELECT·EXPLODE 별칭과 겹치지 않도록 VSYM·XSYM 이름으로, EED 는 에스컬레이터 입면 카드로 연결됐다(에너지 입면 전개는 DEE).
 assert.ok(byAlias('V').every(command=>command.nativeCommand==='VSYM'));
 assert.ok(byAlias('X').every(command=>command.nativeCommand==='XSYM'));
 assert.ok(byAlias('EED').every(command=>command.nativeCommand==='EED'));
});

test('every command has a safe inline SVG icon',()=>{
 const icons=[];
 for(const command of architectureReferenceCommands){
  const svg=architectureCommandIconSvg(command);
  icons.push(svg);
  assert.match(svg,/^<svg/);
  assert.doesNotMatch(svg,/<text/,'command code is shown in the card text, not inside the icon');
  assert.match(svg,/<title>/);
  assert.match(svg,/data-icon-subject="[a-z]+"/);
  assert.match(svg,/data-icon-action="[a-z]+"/);
  assert.match(svg,/data-icon-visual-key="[^"]+"/);
  assert.match(svg,new RegExp(`data-command-id="${command.id}"`));
  assert.doesNotMatch(svg,/command-signature/);
  assert.doesNotMatch(svg,/<script|onload=|javascript:/i);
 }
 assert.equal(new Set(icons).size,359);
});

test('배포용 개별 SVG 392개와 매니페스트가 메뉴 명령과 일치한다',()=>{
 const assetDir=new URL('./별도개발/건축CAD보조명령/assets/command-icons/',import.meta.url);
 const files=readdirSync(assetDir).filter(name=>name.endsWith('.svg'));
 const manifest=JSON.parse(readFileSync(new URL('manifest.json',assetDir),'utf8'));
 assert.equal(files.length,359);
 assert.equal(manifest.count,359);
 assert.deepEqual(manifest.commands.map(item=>item.id),architectureReferenceCommands.map(command=>command.id));
 assert.equal(new Set(manifest.commands.map(item=>item.visualKey)).size,359);
 assert.deepEqual(manifest.commands.map(item=>item.label),architectureReferenceCommands.map(command=>command.label));
 for(const item of manifest.commands){
  assert.ok(files.includes(item.filename),item.filename);
  const svg=readFileSync(new URL(item.filename,assetDir),'utf8');
  assert.match(svg,/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.doesNotMatch(svg,/<script|onload=|javascript:/i);
 }
});

test('Barun catalog removes third-party branding and building icons match their subjects',()=>{
 assert.equal(architectureReferenceCommands.find(command=>command.alias==='COM').manualLabel,'바른 CAD 단축키 설정');
 assert.ok(architectureReferenceCommands.every(command=>!/바른 CAD 리습|^Xi\s/i.test(command.label)));
 for(const [alias,subject] of Object.entries({DOOR:'door',WINDOW:'window',STAIR:'stair',CURVESTAIR:'curved-stair',COLUMN:'column',ELEVATOR:'elevator',RAMP:'ramp',INSULATION:'insulation'})){
  const svg=architectureCommandIconSvg({id:`BARUN-${alias}`,alias,label:alias,category:'그리기'},{compact:true});
  assert.match(svg,new RegExp(`data-icon-subject="${subject}"`));
 }
});

test('도우미·문서의 옛(매뉴얼) 이름을 명령창에 쳐도 같은 명령이 실행된다(비평 8)',()=>{
 const settings={aliases:defaultAliases()};
 assert.equal(resolveCommand('켜 병합하기',settings),'LAM');
 assert.equal(resolveCommand('선택한 선들의 길이 합산',settings),'LEN');
 assert.equal(resolveCommand('폴리선 정점 삭제하기',settings),'PLINEEDIT');
 const names=new Set(COMMANDS.map(c=>c.name));
 for(const command of architectureReferenceCommands){
  if(!command.nativeCommand)continue;
  const resolved=resolveCommand(command.manualLabel,settings);
  assert.ok(resolved===command.nativeCommand||names.has(resolved),`${command.alias} ${command.manualLabel} → ${resolved}`);
 }
});

test('합쳐진 옛 id 와 남은 카드에 단축키가 모두 있으면 남은 카드 자신의 값이 이긴다(재비평 1)',()=>{
 const [removed,kept]=Object.entries(ARCHITECTURE_MERGED_COMMAND_IDS)[0];
 for(const hotkeys of [{[removed]:'Ctrl+Alt+1',[kept]:'Ctrl+Alt+2'},{[kept]:'Ctrl+Alt+2',[removed]:'Ctrl+Alt+1'}]){
  const state=normalizeAssistState({hotkeys},architectureReferenceCommands);
  assert.equal(state.hotkeys[kept],'CTRL+ALT+2');
 }
 assert.equal(normalizeAssistState({hotkeys:{[removed]:'Ctrl+Alt+1'}},architectureReferenceCommands).hotkeys[kept],'CTRL+ALT+1');
});

test('only the 101 chosen architecture cards are shown; hidden ones stay runnable and core commands stay visible',()=>{
 const shown=architectureReferenceCommands.filter(architectureCardShown);
 assert.equal(shown.length,101); // 2026-10-06 사용자 지시: 고르기 화면 추천 101개만 보이기
 assert.ok(ARCHITECTURE_HIDDEN_COMMAND_NAMES.has('TIN'));
 for(const name of ['MIRROR','HIDE','SHOWALL','XCLIP','LAYISO','BRK','FL','SE'])assert.ok(!ARCHITECTURE_HIDDEN_COMMAND_NAMES.has(name),name);
 for(const command of shown)assert.ok(!ARCHITECTURE_HIDDEN_COMMAND_NAMES.has(command.nativeCommand),command.alias);
 assert.equal(resolveCommand('TIN',{aliases:defaultAliases()}),'TIN');
});

// 2026-10-27 설명서 시험: AI·설명서가 읽는 명령 목록(command-library.json)에 적힌 별칭을 명령창에 치면 그 명령이 돼야 한다.
// 예전 목록에는 PV·MII·LL 처럼 아무것도 안 되는 별칭과, B·V·X·LIS 처럼 다른 명령이 되는 별칭이 섞여 있었다.
test('명령 목록의 별칭은 명령창에 치면 모두 그 명령이 된다(아무것도 안 되거나 다른 명령이 되는 별칭 없음)',()=>{
 const settings={aliases:defaultAliases()};
 const lib=JSON.parse(readFileSync('rules/knowledge/command-library.json','utf8')).commands.filter(c=>c.kind!=='lisp');
 const bad=[];
 for(const c of lib)for(const a of new Set([c.command,...(c.aliases||[])])){
  if(/[ ,]/.test(a))continue;                       // 'D2, D3' 같은 표시용 묶음 이름
  const got=resolveCommand(a,settings);
  if(got!==c.command&&!(c.command==='D2'&&a==='D3')&&!(c.command==='W2'&&a==='W3'))bad.push(`${c.command} ← ${a} = ${got}`);
 }
 assert.deepEqual(bad,[]);
});

test('뺀 동봉 리습 이름은 실제 있는 기본 명령으로 이어지고, 같은 이름의 등록 리습이 먼저 돈다(2026-10-27)',()=>{
 const names=new Set(COMMANDS.map(c=>c.name)),settings={aliases:defaultAliases(),hotkeys:{}};
 for(const [old,target] of Object.entries(RETIRED_LISP_COMMANDS)){assert.ok(names.has(target),`${old} -> ${target}`);assert.equal(resolveCommand(old,settings),target,old);}
 for(const word of ['레이어표준','직선이중벽','도각','면적표','트림','문넣기','창넣기'])assert.ok(names.has(KOREAN_COMMANDS[word]),word);
 for(const word of ['실','번호','길이','찾기','수량','접합','닫기','태그'])assert.equal(KOREAN_COMMANDS[word],undefined,word+' 같은 흔한 낱말은 넣지 않는다');
 // 명령창: 등록 리습(NUM·TAG·WALL2 …)이 있으면 옛 이름 대응보다 먼저 돈다
 assert.match(readFileSync(new URL('./app.js',import.meta.url),'utf8'),/studio\.lisp\?\.hasCommand\(value\.trim\(\)\)&&\(!resolveCommand\(value\.trim\(\),settings\)\|\|Object\.hasOwn\(RETIRED_LISP_COMMANDS,value\.trim\(\)\.toUpperCase\(\)\)\)/);
});

test('건축 설계도구 카드 [▶ 사용법]: 쓰는 법은 앱에, 예제 그림은 홈페이지(같은 이름 파일이 docs/manual-cmd-img 에)(2026-10-28)',async()=>{
 const {ARCHITECTURE_HOWTO,MANUAL_BASE}=await import('./architecture-howto-data.js');
 assert.equal(MANUAL_BASE,'https://barunarc.co.kr/cad/manual/');
 const hit=c=>ARCHITECTURE_HOWTO[c.alias]||ARCHITECTURE_HOWTO[c.nativeCommand]||ARCHITECTURE_HOWTO[c.commandCode];
 assert.ok(architectureReferenceCommands.filter(hit).length>=280,'카드 대부분에 쓰는 법이 있다');
 for(const [id,h] of Object.entries(ARCHITECTURE_HOWTO)){
  assert.ok(h.steps.length>0,id);assert.match(h.book,/^manual-cmd-[a-z-]+-2026-10-27$/,id);
  // 윈도우는 CON 같은 예약 이름 파일을 못 꺼낸다(그림은 홈페이지에서 불러오므로 앱엔 영향 없음)
  if(h.img&&!(process.platform==='win32'&&/^(CON|PRN|AUX|NUL|COM\d|LPT\d)\./i.test(h.img)))assert.ok(readFileSync(new URL('./docs/manual-cmd-img/'+h.img,import.meta.url)).length>1000,id+' 예제 그림');
 }
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8'),html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
 assert.match(app,/how\.onclick=\(\)=>architectureHowto\(spec,d\);row\.append\(launch,how,star\);/);
 assert.match(html,/img-src 'self' data: blob: https:\/\/barunarc\.co\.kr;/,'홈페이지 예제 그림만 더 허용');
});
