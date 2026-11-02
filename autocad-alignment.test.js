import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DrawingEngine} from './engine.js';
import {parsePoint,resolveCommand} from './commands.js';

const source=readFileSync(new URL('./app.js',import.meta.url),'utf8');

test('좌표: #·* 절대, @ 하나는 마지막 점, x,y,z 의 z 는 버린다',()=>{
 assert.deepEqual(parsePoint('#10,20',{x:5,y:5}),{x:10,y:20});
 assert.deepEqual(parsePoint('@',{x:5,y:6}),{x:5,y:6});
 assert.deepEqual(parsePoint('1,2,3',null),{x:1,y:2});
 assert.deepEqual(parsePoint('@10<90',{x:0,y:0}).x<1e-9,true);
});

test('EXPLODE 는 분해할 수 없는 객체를 건너뛰고 나머지만 분해한다',()=>{
 const engine=new DrawingEngine();
 const [l,p]=engine.execute({type:'addMany',entities:[{type:'line',layer:'default',points:[{x:0,y:0},{x:1,y:0}]},{type:'polyline',layer:'default',closed:false,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1}]}]});
 engine.execute({type:'explode',ids:[l,p]});
 assert.equal(engine.lastExplodeSkipped,1);
 assert.ok(engine.doc.entities.some(e=>e.id===l),'선은 그대로');
 assert.ok(!engine.doc.entities.some(e=>e.id===p),'폴리선은 분해');
 assert.equal(engine.doc.entities.filter(e=>e.type==='line').length,3);
 assert.throws(()=>engine.execute({type:'explode',ids:[l]}),/분해할 수 있는 객체/);
});

test('오토캐드 별칭 보강: PE·DT·DCO·LI·OOPS (기존 사용자 별칭은 그대로)',()=>{
 const settings={aliases:{},hotkeys:{}};
 assert.equal(resolveCommand('PE',settings),'PLINEEDIT');
 assert.equal(resolveCommand('DT',settings),'TEXT');
 assert.equal(resolveCommand('DCO',settings),'DIMCONTINUE');
 assert.equal(resolveCommand('OOPS',settings),'OOPS');
});

test('점 입력 중 END·MID·INT… 는 다음 한 점만 그 스냅, 글자 편집 Esc 는 저장 안 함, 휠 두 번 = 전체 보기',()=>{
 assert.match(source,/const ONCE_SNAPS=\{END:'end',ENDP:'end',MID:'mid',INT:'intersection'/);
 assert.match(source,/if\(inlineTextInput&&finishInlineText\)\{finishInlineText\(false\);canvas\.focus\(\);return;\}/);
 assert.match(source,/now-last\.time<400&&Math\.hypot\(p\.x-last\.x,p\.y-last\.y\)<8&&typeof fit==='function'\)\{canvas\._middleDown=null;e\.preventDefault\(\);drag=null;fit\(\);/);
});

test('TEXT 는 회전 각도를 묻고 Enter 마다 다음 줄, 빈 Enter 로 끝(DTEXT)',()=>{
 // 504: 맞춤(A)·채움(F)은 두 끝점이 각도를 정하므로 회전을 묻지 않고 바로 문자로.
 assert.match(source,/phase = mode === "TEXT" \? \(isFitJustify\(run\.textJustify\)&&points\.length>1\?"text":"text-rotation"\)/);
 assert.match(source,/if\(mode==='TEXT'\)\{points=\[G\.add\(points\[0\],G\.polar\(params\.height\*1\.667,rotation-90\)\)\];/);
});

test('새 명령 DIVIDE(DIV)·MEASURE(ME)·DONUT(DO), ELLIPSE 축 끝점 기본, DIMLINEAR Enter=객체 선택',()=>{
 const settings={aliases:{},hotkeys:{}};
 assert.match(source,/function divideOrMeasure\(value\)\{/);
 assert.match(source,/function donutEntity\(center\)\{/);
 assert.match(source,/if\(params\.ellipseCenter\)points\.push\(p\);else points=\[\{x:\(a\.x\+p\.x\)\/2,y:\(a\.y\+p\.y\)\/2\},p\];/);
 assert.match(source,/if\(\['DIMLINEAR','DIMALIGNED'\]\.includes\(mode\)&&!points\.length&&phase!=='dim-object'\)\{phase='dim-object';/);
});

test('ARC 중심(C)·끝(E) 방식, REC 치수(D)·회전(R), BREAK @·BREAKATPOINT, COPY 배열(A)·U, 수정 명령 뒤 선택 풀림',()=>{
 assert.match(source,/function arcFromInput\(list\)\{/);
 assert.match(source,/params\.rectDims=\{\};phase='rect-length'/);
 assert.match(source,/if\(mode==='BREAKATPOINT'&&phase==='point'\)/);
 assert.match(source,/const count=mode==='COPY'\?params\.arrayCount:0;/);
 assert.match(source,/function commandDone\(ids\)\{previousSelection=/);
});

test('BREAK 두 점이 같으면 그 점에서 둘로 나눈다',()=>{
 const engine=new DrawingEngine();
 const [id]=engine.execute({type:'addMany',entities:[{type:'line',layer:'default',points:[{x:0,y:0},{x:100,y:0}]}]});
 engine.execute({type:'break',id,a:{x:40,y:0},b:{x:40,y:0}});
 assert.deepEqual(engine.doc.entities.map(e=>e.points.map(p=>p.x)),[[0,40],[40,100]]);
});

test('ZOOM A·O·C, DIMCONTINUE·DIMBASELINE 화면에서 바로(옛 좌표 입력 창보다 먼저)',()=>{
 assert.match(source,/else if\(\["O","OBJECT"\]\.includes\(option\)\)/);
 assert.match(source,/function acceptChainDimension\(p\)\{/);
 assert.ok(source.indexOf("if(name==='DIMCONTINUE'||name==='DIMBASELINE'){")<source.indexOf('if (studio.run(name)) return;'));
});

test('XLINE·RAY·SPLINE·REVCLOUD·BOUNDARY 새 명령, 전체 보기는 구성선 제외',()=>{
 for(const fn of ['constructionLine','splinePoints','cloudPoints','boundaryAt'])assert.ok(source.includes('function '+fn+'('),fn);
 assert.match(source,/shown\.some\(e=>e\.construction\)\?shown\.filter\(e=>!e\.construction\):shown/);
 const settings={aliases:{},hotkeys:{}};
});

test('그립을 누르기만 하면 뜨거운 그립: Space 로 신축→이동→회전→축척→대칭, 숫자는 거리·각도·비율',()=>{
 assert.match(source,/const GRIP_OPS=\['stretch','move','rotate','scale','mirror'\]/);
 assert.match(source,/if\(mode==='GRIP'\)\{params\.op=GRIP_OPS\[\(GRIP_OPS\.indexOf\(params\.op\)\+1\)%GRIP_OPS\.length\];/);
});

test('블록 편집은 같은 이름 블록 전부에: 공유 블록은 정의(shared.define)를 바꾸면 모든 삽입본이 바뀐다',()=>{
 const engine=new DrawingEngine();
 const doc=structuredClone(engine.doc);doc.version=3;doc.sharedBlocks={K:{origin:{x:0,y:0},entities:[{type:'line',layer:'default',points:[{x:0,y:0},{x:1,y:0}]}]}};
 doc.entities=[{id:'a',type:'block',name:'K',sharedBlock:'K',layer:'default',position:{x:0,y:0},scale:1,rotation:0,entities:[]},{id:'b',type:'block',name:'K',sharedBlock:'K',layer:'default',position:{x:5,y:0},scale:1,rotation:0,entities:[]}];
 engine.execute({type:'load',document:doc});
 const before=engine.doc.sharedBlocks;
 const ids=engine.execute({type:'shared.define',key:'K',entities:[{type:'line',layer:'default',points:[{x:0,y:0},{x:2,y:0}]}]});
 assert.deepEqual(ids.sort(),['a','b']);
 assert.equal(engine.doc.sharedBlocks.K.entities[0].points[1].x,2);
 assert.equal(before.K.entities[0].points[1].x,1,'되돌리기 기록의 정의는 그대로');
 engine.execute({type:'undo'});assert.equal(engine.doc.sharedBlocks.K.entities[0].points[1].x,1);
 assert.match(source,/function blockSimilarity\(fromList,toList\)\{/);
});

test('탭 전환 첫 화면은 빈 화면+"도면을 그리는 중"(GPU 작업 중 덧그리기·화면 기억 끄기는 A/B 퇴행으로 뺐다)',()=>{
 assert.match(source,/tabSwitchCover=true;gpuEdit=null;/);
 assert.doesNotMatch(source,/paintPendingGpuEdit/);
 assert.match(source,/if\(drag\?\.kind==='pan'\|\|viewMoving\)\{sceneKey=null;/);
});
