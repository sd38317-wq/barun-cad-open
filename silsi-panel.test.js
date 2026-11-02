import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SILSI_DRAWING_ROWS,SILSI_REVIEW_CARDS,recognitionChips} from './silsi-panel.js';

// 실시 탭(2026-10-24 통과 시안 ①⑧⑨⑩): 명령은 있는 것만 잇고, 없는 것은 눌리지 않게 둔다.
test('실시 칸 줄은 실제 있는 명령으로만 연결된다',()=>{
 const commands=readFileSync('commands.js','utf8');
 const names=SILSI_DRAWING_ROWS.flatMap(([,c])=>c==null?[]:Array.isArray(c)?c.map(([,x])=>x):[c]);
 assert.ok(names.includes('PLANSET'));
 for(const name of new Set(names))assert.match(commands,new RegExp(`\\[\\s*['"]${name}['"],`),name);
 assert.equal(SILSI_DRAWING_ROWS.find(([label])=>label==='방화구획 상세도')[1],'FIREDETAILS','상세 찾기 방화 공종으로 연다(2026-10-27)');
});

test('검토 카드: 편의시설·에너지는 인허가 도서 창의 그 탭, 구조·증축은 각 검토 창',()=>{
 assert.deepEqual(SILSI_REVIEW_CARDS.map(([label,,to])=>[label,to]),[['장애인 편의시설','permit:access'],['에너지절약계획','permit:energy'],['구조 검토','STRUCTUREREVIEW'],['증축 · 대수선 검토','EXTENSIONREVIEW']]);
 const app=readFileSync('app.js','utf8'),book=readFileSync('permit-book.js','utf8');
 assert.match(app,/silsiPanelElement\(\{run,open:to=>to\.startsWith\('permit:'\)\?studio\.handlers\.PERMITBOOK\?\.\(to\.slice\(7\)\):studio\.handlers\[to\]\?\.\(\),recognition:/);
 assert.match(app,/installStructureReview\(studio\);installExtensionReview\(studio\);/);
 for(const file of ['structure-review.js','extension-review.js'])assert.match(readFileSync('server.py','utf8'),new RegExp(`'/${file.replace('.','\\.')}'`));
 assert.match(book,/async function open\(tab\)\{/);assert.match(book,/if\(tab==='access'\|\|tab==='energy'\)\{state\.tab=tab;/);
});

test('탭 줄: 검수 단추는 숨기고 실시는 계획 다음, 3D 앞',()=>{
 const app=readFileSync('app.js','utf8'),miri=readFileSync('miriboda-panel.js','utf8');
 assert.match(app,/if\(check\)check\.hidden=true;/);
 assert.doesNotMatch(miri,/rail\.querySelector\('\.livecheck-toggle'\);if\(review\)review\.hidden=false/);
 const order=miri.slice(miri.indexOf('const order=['));
 assert.ok(order.indexOf('plan-side-panel')<order.indexOf('silsi-side-panel')&&order.indexOf('silsi-side-panel')<order.indexOf('3D'));
 assert.doesNotMatch(order.slice(0,order.indexOf('];')),/livecheck-toggle/);
 assert.match(readFileSync('server.py','utf8'),/'\/silsi-panel\.js'/);
});

test('맨 위 [도면 인식] 카드: 읽은 때와 확인 필요 수(10-27 docs/adr/0001)',()=>{
 assert.deepEqual(recognitionChips({read:false}),[['아직 읽지 않음','muted']]);
 const at=new Date(2026,9,27,10,55).toISOString();
 assert.deepEqual(recognitionChips({read:true,readAt:at,confirm:3}),[['읽음 10-27 10:55','ok'],['확인 필요 3','warn']]);
 assert.deepEqual(recognitionChips({read:true,readAt:at,confirm:0}),[['읽음 10-27 10:55','ok']]);
 const app=readFileSync('app.js','utf8'),server=readFileSync('server.py','utf8');
 assert.match(app,/const drawingRecognition=installDrawingRecognition\(studio\);/);
 assert.match(app,/recognition:\{state:\(\)=>drawingRecognition\.state\(\),open:\(\)=>drawingRecognition\.open\(\)\}/);
 for(const file of ['drawing-recognition.js','building-overview.js'])assert.match(server,new RegExp(`'/${file.replace('.','\\.')}'`));
 assert.match(readFileSync('drawing-recognition.js','utf8'),/studio\.handlers\.RECOGNIZE=open;/);
});
