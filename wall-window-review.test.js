import test from 'node:test';
import assert from 'node:assert/strict';
import {cutWallBand,wallFrame,windowStyleOf} from './card-kit.js';
import {dragWallBand} from './wall-preset.js';
const frame=wallFrame({x:0,y:0},{x:1000,y:0},{x:0,y:200});
const line=(id,layer='A-WALL',y=0)=>({id,type:'line',layer,points:[{x:0,y},{x:5000,y}]});
for(const link of ['room','roomBoundary','roomSchedule'])test('벽 끌기: '+link+' 연결된 실 경계를 보존한다',()=>{
 const boundary=line('boundary','A-WALL',100);
 const reference=link==='room'?null:link==='roomBoundary'?{id:'tag',type:'text',roomBoundary:'boundary'}:{id:'schedule',type:'table',roomSchedule:{rooms:[{sourceId:'boundary'}]}};
 if(link==='room')boundary.room={name:'실'};
 const entities=[line('wall'),boundary,...(reference?[reference]:[])],before=structuredClone(entities);
 const result=dragWallBand(entities,frame,1000,2000,500);
 assert.deepEqual(result.removeIds,['wall']);
 assert.ok(!result.add.some(e=>e.points.some(p=>p.y===100||p.y===600)),'실 경계를 옮긴 복제선도 만들지 않는다');
 assert.deepEqual(entities,before);
});
for(const layer of ['A-DOOR','A-WIND','A-COL','S-COLS'])test('벽 끌기: '+layer+' 객체는 그대로 둔다',()=>{
 const result=dragWallBand([line('wall'),line('other','other',100)],frame,1000,2000,500,{layers:[{id:'other',name:layer}]});
 assert.deepEqual(result.removeIds,['wall']);
 assert.ok(result.add.every(e=>e.layer==='A-WALL'));
});
test('벽 절단: wallOnly false도 실 연결과 비벽체 표준 켜를 보호한다',()=>{
 const room=line('room','A-WALL',50);room.room={name:'실'};
 const result=cutWallBand([line('wall'),room,line('door','A-DOOR',100)],frame,1000,2000,{wallOnly:false});
 assert.deepEqual(result.removeIds,['wall']);
});
test('벽 끌기: 중심선 이동 복제선을 만들지 않는다',()=>{
 const center=line('center','custom',100);center.linetype='CENTER';
 const result=dragWallBand([line('wall'),center],frame,1000,2000,500);
 assert.deepEqual(result.removeIds,['wall']);assert.ok(result.add.every(e=>e.layer==='A-WALL'));
});
for(const generic of ['window','창','단창'])test('창 종류: 일반 분류 '+generic+' 뒤의 구체적 종류를 읽는다',()=>{
 assert.equal(windowStyleOf({style:generic,parameters:{style:'fixed'}}),'fixed');
 assert.equal(windowStyleOf({subtype:generic,cardOpening:{values:{kind:'미서기'}}}),'sliding');
 assert.equal(windowStyleOf({style:generic,name:'W1'}),'fixed');
});
for(const style of ['틸트앤턴창','tilt-turn','tilt_turn'])test('창 종류: '+style+'를 알아본다',()=>assert.equal(windowStyleOf({style}),'tiltTurn'));
test('창 종류: 명시한 미확인은 이름으로 추측하지 않고 구체적 값은 읽는다',()=>{
 assert.equal(windowStyleOf({style:'window',subtype:'unknown',name:'W2'}),'unknown');
 assert.equal(windowStyleOf({style:'unknown',parameters:{style:'casement'},name:'W2'}),'casement');
 assert.equal(windowStyleOf({style:'sliding',parameters:{style:'fixed'}}),'sliding');
});
