import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';

const p=(x,y)=>({x,y});
test('static index preserves identity, order, centers, arcs and clipped primitives',()=>{
 const line={id:'line',type:'line',points:[p(-5,0),p(5,0)]};
 const circle={id:'circle',type:'circle',center:p(20,20),radius:4};
 const arc={id:'arc',type:'arc',center:p(40,0),radius:6,startAngle:0,endAngle:180};
 const ellipse={id:'ellipse',type:'ellipse',center:p(60,0),majorAxis:p(8,0),ratio:.5};
 const clipped={id:'clipped',type:'polyline',points:[p(80,0),p(90,0)],clip:{enabled:true,points:[p(79,-1),p(85,-1),p(85,1),p(79,1)]}};
 const items=[line,circle,arc,ellipse,clipped],a=G.spatialIndex(items),b=G.staticSpatialIndex(items);
 for(const box of [{minX:-10,minY:-10,maxX:10,maxY:10},{minX:15,minY:15,maxX:25,maxY:25},{minX:35,minY:-10,maxX:50,maxY:10},{minX:75,minY:-2,maxX:100,maxY:2}]) assert.deepEqual(b.query(box),a.query(box));
 assert.equal(b.query({minX:-10,minY:-10,maxX:100,maxY:10})[0],line);
});
test('nonfinite source geometry is skipped like the legacy index',()=>{
 const bad={id:'bad',type:'line',points:[p(0,0),p(Infinity,1)]},items=[bad];
 assert.deepEqual(G.staticSpatialIndex(items).query({minX:-1,minY:-1,maxX:1,maxY:1}),G.spatialIndex(items).query({minX:-1,minY:-1,maxX:1,maxY:1}));
});
test('keeps duplicate object identities and original order',()=>{
 const shared={id:'same',type:'line',points:[p(0,0),p(2,0)]},other={id:'same',type:'line',points:[p(10,0),p(12,0)]},items=[shared,other,shared];
 const result=G.staticSpatialIndex(items).query({minX:-1,minY:-1,maxX:20,maxY:1});assert.deepEqual(result,[shared,other,shared]);
});
test('invalid and infinite query boxes use legacy query behavior',()=>{
 const item={id:'x',type:'line',points:[p(0,0),p(1,0)]},index=G.staticSpatialIndex([item]);
 for(const box of [{minX:Infinity,minY:0,maxX:1,maxY:1},{minX:2,minY:0,maxX:1,maxY:1},{minX:-Infinity,minY:-Infinity,maxX:Infinity,maxY:Infinity},{minX:NaN,minY:0,maxX:1,maxY:1}]) assert.deepEqual(index.query(box),G.spatialIndex([item]).query(box));
});
test('branched packed tree matches legacy queries in order and exact object identity',()=>{
 const items=Array.from({length:257},(_,i)=>i%3===0
   ?{id:String(i%17),type:'circle',center:p((i*97)%503-251,(i*61)%307-153),radius:i%23+1}
   :{id:String(i%17),type:'line',points:[p((i*97)%503-251,(i*61)%307-153),p((i*31)%401-200,(i*43)%283-141)]});
 items.splice(40,0,items[0],items[20]);
 const a=G.spatialIndex(items),b=G.staticSpatialIndex(items);
 for(let i=0;i<1000;i++){
  const x=(i*71)%601-300,y=(i*43)%401-200,r=i%70,box={minX:x-r,minY:y-r,maxX:x+r,maxY:y+r};
  const expected=a.query(box),actual=b.query(box);assert.equal(actual.length,expected.length);
  actual.forEach((entity,j)=>assert.equal(entity,expected[j]));
 }
});
test('ordinary construction avoids building a second legacy index',()=>{
 let reads=0;const points=[p(0,0),p(10,10)],entity={type:'line',get points(){reads++;return points;}};
 G.spatialIndex([entity]);const legacyReads=reads;reads=0;
 const index=G.staticSpatialIndex([entity]);assert.equal(reads,legacyReads);
 index.query({minX:0,minY:0,maxX:1,maxY:1});assert.equal(reads,legacyReads);
 index.query({minX:-Infinity,minY:-Infinity,maxX:Infinity,maxY:Infinity});assert.ok(reads>legacyReads);
 const after=reads;index.query({minX:-Infinity,minY:-Infinity,maxX:Infinity,maxY:Infinity});assert.equal(reads,after);
});
test('clipped block primitives retain identity through visible expansion',()=>{
 const child={id:'child',type:'line',points:[p(0,0),p(10,0)]},block={id:'block',type:'block',entities:[child],clip:{enabled:true,inverted:false,points:[p(1,-1),p(5,-1),p(5,1),p(1,1)]}};
 const visible=G.visiblePrimitives(block),index=G.staticSpatialIndex(visible),hit=index.query({minX:-1,minY:-1,maxX:11,maxY:1});assert.equal(hit.length,visible.length);assert.ok(hit.every((e,i)=>e===visible[i]));
});

test('full then partial static queries preserve duplicate order, skipped geometry and bounds snapshot',()=>{
 const a={type:'line',points:[p(0,0),p(2,0)]},b={type:'line',points:[p(100,0),p(102,0)]};
 const skipped={type:'line',points:[]},items=[a,skipped,b,a],index=G.staticSpatialIndex(items);
 const full={minX:-1,minY:-1,maxX:103,maxY:1},partial={minX:-1,minY:-1,maxX:3,maxY:1};
 const first=index.query(full);assert.deepEqual(first,[a,b,a]);first.pop();assert.deepEqual(index.query(full),[a,b,a]);
 // A static index captures bounds at construction, even before tree creation.
 a.points=[p(200,0),p(202,0)];
 assert.deepEqual(index.query(partial),[a,a]);assert.deepEqual(index.query(full),[a,b,a]);
 assert.deepEqual(index.query({minX:99,minY:-1,maxX:103,maxY:1}),[b]);
});
