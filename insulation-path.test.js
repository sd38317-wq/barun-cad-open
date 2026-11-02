import test from 'node:test';
import assert from 'node:assert/strict';
import {insulationPath,insulationSourcePath} from './architecture.js';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';
const p=(x,y)=>({x,y});
test('insulation baseline follows move rotate scale mirror for subsequent thickness edits',()=>{
 const entity=insulationPath([p(0,0),p(1000,0),p(1000,1000)],100,'left');
 const moved=G.mirror(G.translate(G.resize(entity,p(0,0),2),500,300),p(0,0),p(0,1));
 assert.equal(moved.parameters.depth,200);assert.equal(moved.parameters.side,'right');assert.deepEqual(moved.parameters.path,[p(-500,300),p(-2500,300),p(-2500,2300)]);
 const rebuilt=insulationPath(moved.parameters.path,200,moved.parameters.side,false,'default',moved.parameters.waveSign);for(let i=0;i<rebuilt.entities[0].points.length;i++)assert.ok(G.dist(rebuilt.entities[0].points[i],moved.entities[0].points[i])<1e-6);
});
test('bent insulation follows all path legs with continuous finite geometry and preserves source',()=>{
 const path=[p(0,0),p(1000,0),p(1000,1000),p(2000,1000)],before=structuredClone(path);
 const entity=insulationPath(path,100),points=entity.entities[0].points;
 assert.deepEqual(path,before);assert.deepEqual(points[0],path[0]);assert.ok(Math.hypot(points.at(-1).x-2000,points.at(-1).y-1000)<1e-7);
 assert.ok(points.some(q=>q.y>300&&q.y<700&&Math.abs(q.x-1000)<=50.001));
 assert.ok(points.every(q=>Number.isFinite(q.x)&&Number.isFinite(q.y)));
 for(let i=1;i<points.length;i++)assert.ok(Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y)<35);
 const engine=new DrawingEngine();engine.execute({type:'addMany',entities:[entity]});engine.execute({type:'undo'});assert.equal(engine.doc.entities.length,0);
});
test('thickness and left/right placement retain the selected straight baseline',()=>{
 for(const side of ['center','left','right']){
  const ys=insulationPath([p(0,0),p(1000,0)],100,side).entities[0].points.map(q=>q.y);
  const expected=side==='left'?[0,100]:side==='right'?[-100,0]:[-50,50];
  assert.ok(Math.abs(Math.min(...ys)-expected[0])<1e-7);assert.ok(Math.abs(Math.max(...ys)-expected[1])<1e-7);
 }
});
test('arcs and closed circles produce continuous curved insulation; replace and undo are atomic',()=>{
 for(const type of ['arc','circle']){
  const source={type,center:p(0,0),radius:1000,startAngle:0,endAngle:180,layer:'default'};
  const path=insulationSourcePath(source,100),entity=insulationPath(path.points,100,'center',path.closed);
  assert.equal(entity.entities[0].closed,type==='circle');
  assert.ok(entity.entities[0].points.every(q=>Math.hypot(q.x,q.y)>949&&Math.hypot(q.x,q.y)<1051));
  const engine=new DrawingEngine();const [id]=engine.execute({type:'addMany',entities:[source]});
  engine.execute({type:'batch',commands:[{type:'delete',ids:[id]},{type:'addMany',entities:[entity]}]});assert.equal(engine.doc.entities.length,1);
  engine.execute({type:'undo'});assert.equal(engine.doc.entities[0].id,id);assert.equal(engine.doc.entities[0].type,type);
 }
});
test('duplicate clicks are ignored and invalid or excessive paths reject without partial geometry',()=>{
 assert.deepEqual(insulationPath([p(0,0),p(0,0),p(1000,0)],100).parameters.path,[p(0,0),p(1000,0)]);
 assert.throws(()=>insulationPath([p(0,0)],100));assert.throws(()=>insulationPath([p(0,0),p(1,0)],0));
 assert.throws(()=>insulationPath([p(0,0),p(1000,0),p(0,0),p(0,1000)],100));
 assert.throws(()=>insulationPath([p(0,0),p(1e9,0)],1));
});
