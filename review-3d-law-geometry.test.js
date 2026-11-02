import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLawModel, NORTH_CAP_SEGMENTS} from './review-3d-law-geometry.js';

const rect=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
const doc=()=>({layers:[{id:'l1',name:'A-BLDG-L1',height:10000}],entities:[{id:'mass',layer:'l1',type:'polyline',closed:true,points:rect(0,0,10000,10000)}],siteAnalysis:{version:1,units:'mm',buildable:[{outer:rect(0,0,10000,10000),holes:[]}],northProfile:{segments:[[{x:0,y:0},{x:10000,y:0}]],setbacks:[{height:0,distance:0},{height:10000,distance:5000}]},tolerancePct:0}});
const sum=(m,status)=>m.masses.flatMap(m=>m.parts).filter(p=>p.status===status).reduce((s,p)=>s+p.volumeM3,0);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);

test('rectangle with north distance z/2 has exact violation volume and plane coordinates',()=>{
  const model=buildLawModel(doc());assert.match(model.warnings.join(' '),/0.12%/);near(model.masses[0].volumeM3,1000);near(sum(model,'violation'),250);near(sum(model,'safe'),750);
  assert.deepEqual(model.limits[0].faces[0],[{x:0,y:0,z:0},{x:10000,y:0,z:0},{x:10000,y:5000,z:10000},{x:0,y:5000,z:10000}]);
  for(const part of model.masses[0].parts.filter(p=>p.status==='violation'))for(const p of part.faces.flat())assert.ok(p.y<=p.z/2+1e-6);
});
test('three percent shortfall becomes an orange shell with no overlapping volume',()=>{
  const d=doc();d.siteAnalysis.tolerancePct=3;const model=buildLawModel(d);near(sum(model,'violation'),242.5);near(sum(model,'tolerance'),7.5);near(sum(model,'safe'),750);near(model.masses[0].volumeM3,1000);
  for(const part of model.masses[0].parts.filter(p=>p.status==='tolerance'))for(const p of part.faces.flat()){assert.ok(p.y>=p.z*.485-1e-6);assert.ok(p.y<=p.z*.5+1e-6);}
});
test('height plane uses mm and three percent tolerance',()=>{
  const d=doc();delete d.siteAnalysis.northProfile;d.siteAnalysis.heightLimit=5000;d.siteAnalysis.tolerancePct=3;const model=buildLawModel(d);
  near(sum(model,'violation'),485);near(sum(model,'tolerance'),15);near(sum(model,'safe'),500);assert.equal(model.limits[0].kind,'height');assert.ok(model.limits[0].faces.flat().every(p=>p.z===5000));
});
test('overlapping height and north rules do not count violation volume twice',()=>{
  const d=doc();d.siteAnalysis.heightLimit=5000;const model=buildLawModel(d);near(sum(model,'violation'),562.5);near(sum(model,'safe'),437.5);near(model.masses[0].volumeM3,1000);
});
test('UP repeats floors over accumulated lower heights and divides explicit total entity height',()=>{
  const d=doc();d.layers=[{id:'l1',name:'A-BLDG-L1',height:3500},{id:'up',name:'A-BLDG-UP',height:3000,upperFloors:3}];d.entities=[{id:'mass',layer:'up',type:'mass',points:rect(2000,2000,3000,3000),height:7500}];const model=buildLawModel(d);
  assert.deepEqual(model.masses.map(m=>[m.floor,m.base,m.top]),[[2,3500,6000],[3,6000,8500],[4,8500,11000]]);near(model.masses.reduce((s,m)=>s+m.volumeM3,0),7.5);assert.ok(sum(model,'unknown')>0);
  d.layers[1].elevation=1000;assert.deepEqual(buildLawModel(d).masses.map(m=>m.base),[1000,3500,6000]);
});
test('stale source geometry stops all geometry and leaves document untouched',()=>{
  const d=doc();d.siteAnalysis.sourceGeometry=[{id:'mass',points:rect(1,0,10000,10000),loops:[]}];const before=JSON.stringify(d),model=buildLawModel(d);assert.deepEqual(model.masses,[]);assert.deepEqual(model.limits,[]);assert.equal(model.warnings.length,1);assert.equal(JSON.stringify(d),before);
  delete d.entities[0];assert.equal(buildLawModel(d).masses.length,0);
});
test('concave outline and courtyard hole retain exact volume',()=>{
  const d=doc();delete d.siteAnalysis.northProfile;d.entities[0].points=[{x:0,y:0},{x:10000,y:0},{x:10000,y:5000},{x:5000,y:5000},{x:5000,y:10000},{x:0,y:10000}];d.entities[0].loops=[rect(1000,1000,2000,2000)];const model=buildLawModel(d);near(model.masses[0].volumeM3,740);near(sum(model,'safe'),740);
});
test('hole subtraction also removes exact north violation volume',()=>{
  const d=doc();d.entities[0].loops=[rect(0,0,10000,1000)];const model=buildLawModel(d);near(model.masses[0].volumeM3,900);near(sum(model,'violation'),160);near(sum(model,'safe'),740);
});
test('finite north boundary segments extend by setback, not by infinite lines',()=>{
  const d=doc();d.entities[0].points=rect(20000,0,21000,1000);const model=buildLawModel(d);near(sum(model,'violation'),0);near(sum(model,'safe'),10);
});
test('constant setback and profile discontinuity are honored at actual row heights',()=>{
  const d=doc();d.siteAnalysis.northProfile.setbacks=[{height:0,distance:1500},{height:10000,distance:1500},{height:10001,distance:5000.5},{height:20000,distance:10000}];d.layers[0].height=10001;const model=buildLawModel(d);
  near(sum(model,'violation'),150+((1500+5000.5)/2)*10000/1e9);near(model.masses[0].volumeM3,1000.1);assert.equal(model.limits[0].faces[0][2].y,1500);
});
test('out-of-profile portions are marked unknown while height violations take priority',()=>{
  const d=doc();d.layers[0].height=12000;d.siteAnalysis.heightLimit=11000;const model=buildLawModel(d);near(sum(model,'violation'),350);near(sum(model,'unknown'),100);near(sum(model,'safe'),750);assert.match(model.warnings.join(' '),/범위 밖/);
});
test('missing or invalid baseline cannot produce a law model',()=>{
  assert.equal(buildLawModel({}).masses.length,0);const d=doc();d.siteAnalysis.units='m';assert.equal(buildLawModel(d).limits.length,0);
});
test('non-building open lines, reference layers and excluded entities are ignored',()=>{
  const d=doc();d.entities.push({...d.entities[0],id:'open',closed:false});d.layers.push({id:'reference',name:'A-BLDG-L2',referenceOnly:true});d.entities.push({...d.entities[0],id:'ref',layer:'reference'});d.entities.push({...d.entities[0],id:'site'});d.siteAnalysis.sourceIds={site:'site'};assert.deepEqual(buildLawModel(d).masses.map(m=>m.objectId),['mass']);
});
test('invalid or degenerate north profiles leave remaining volume unknown',()=>{
  const d=doc();d.siteAnalysis.northProfile.segments=[[{x:0,y:0},{x:0,y:0}]];let model=buildLawModel(d);near(sum(model,'unknown'),1000);near(sum(model,'safe'),0);assert.match(model.warnings.join(' '),/올바르지/);
  d.siteAnalysis.heightLimit=5000;model=buildLawModel(d);near(sum(model,'violation'),500);near(sum(model,'unknown'),500);
});
test('engine wall layer contributes lower floor heights without becoming an overlay mass',()=>{
  const d=doc();d.layers=[{id:'wall',name:'WALL',height:4000},{id:'up',name:'A-BLDG-UP',height:3000}];d.entities=[{id:'mass',layer:'up',type:'mass',points:rect(1000,1000,2000,2000)}];assert.equal(buildLawModel(d).masses[0].base,4000);
});
test('overlapping north segments do not double-count the same volume',()=>{
  const d=doc();d.siteAnalysis.northProfile.segments.push(d.siteAnalysis.northProfile.segments[0].slice().reverse());const model=buildLawModel(d);near(sum(model,'violation'),250);near(sum(model,'safe'),750);
});
test('finite segment endpoint circles do not flag buildings outside true Euclidean setback',()=>{
  const d=doc();d.layers[0].height=3000;d.siteAnalysis.buildable=[{outer:rect(-5000,0,5000,10000),holes:[]}];d.siteAnalysis.northProfile={segments:[[{x:0,y:0},{x:1000,y:0}]],setbacks:[{height:0,distance:1500},{height:10000,distance:1500}]};d.entities[0].points=rect(2300,1300,2400,1400);
  const model=buildLawModel(d);near(model.masses[0].volumeM3,.03);near(sum(model,'violation'),0);near(sum(model,'safe'),.03);assert.equal(NORTH_CAP_SEGMENTS,64);
  assert.equal(model.limits[0].faces.length,33);for(const face of model.limits[0].faces.slice(1))for(const p of face){const endpoint=p.x<0?{x:0,y:0}:{x:1000,y:0};near(Math.hypot(p.x-endpoint.x,p.y),1500);}
});
test('endpoint cap violations remain inside exact circular setback and partition volume',()=>{
  const d=doc();d.layers[0].height=3000;d.siteAnalysis.buildable=[{outer:rect(-5000,0,5000,10000),holes:[]}];d.siteAnalysis.northProfile={segments:[[{x:0,y:0},{x:1000,y:0}]],setbacks:[{height:0,distance:1500},{height:10000,distance:1500}]};d.entities[0].points=rect(1800,800,2300,1300);
  const model=buildLawModel(d);near(model.masses[0].volumeM3,.75);assert.ok(sum(model,'violation')>0);assert.ok(sum(model,'safe')>0);
  for(const part of model.masses[0].parts.filter(p=>p.status==='violation'))for(const p of part.faces.flat())assert.ok(Math.hypot(p.x-1000,p.y)<=1500+1e-6);
  near(sum(model,'violation')+sum(model,'safe'),.75);
});
test('three percent tolerance also applies to endpoint circle caps',()=>{
  const d=doc();d.layers[0].height=3000;d.siteAnalysis.tolerancePct=3;d.siteAnalysis.buildable=[{outer:rect(-5000,0,5000,10000),holes:[]}];d.siteAnalysis.northProfile={segments:[[{x:0,y:0},{x:1000,y:0}]],setbacks:[{height:0,distance:1500},{height:10000,distance:1500}]};d.entities[0].points=rect(2040,1040,2050,1050);
  const model=buildLawModel(d);near(sum(model,'violation'),0);near(sum(model,'tolerance'),.0003);near(sum(model,'safe'),0);
});


test('law masses follow the shared sparse floor table and model3d height/elevation edits',()=>{
  const d=doc();delete d.siteAnalysis.northProfile;d.reviewSettings={floorHeight:9000};
  d.model3d={floorHeights:{'1F':4500,'2F':3200}};
  d.layers=[{id:'l1',name:'1F'},{id:'l2',name:'2F'}];
  d.entities=d.layers.map(l=>({id:l.id,type:'rectangle',layer:l.id,points:rect(0,0,1000,1000)}));
  const before=JSON.stringify(d);
  assert.deepEqual(buildLawModel(d).masses.map(m=>[m.floor,m.base,m.top]),[[1,0,4500],[2,4500,7700]]);
  assert.equal(JSON.stringify(d),before);
  // The preceding floor table still contributes when its drawing layer is absent.
  d.layers.shift();d.entities.shift();d.entities[0].model3d={height:1000,elevation:200};
  assert.deepEqual(buildLawModel(d).masses.map(m=>[m.base,m.top]),[[4700,5700]]);
  d.entities[0].model3d={};d.layers[0].height=2500;
  assert.deepEqual(buildLawModel(d).masses.map(m=>[m.base,m.top]),[[4500,7000]]);
});

test('table-driven UP repeats retain floor heights while explicit total height keeps legacy splitting',()=>{
  const d=doc();delete d.siteAnalysis.northProfile;
  d.model3d={floorHeights:{'1F':4500,'2F':3200,'3F':2800}};
  d.layers=[{id:'up',name:'A-BLDG-UP',upperFloors:2}];
  d.entities=[{id:'mass',type:'mass',layer:'up',points:rect(0,0,1000,1000)}];
  assert.deepEqual(buildLawModel(d).masses.map(m=>[m.floor,m.base,m.top]),[[2,4500,7700],[3,7700,10500]]);
  d.entities[0].height=6000;
  assert.deepEqual(buildLawModel(d).masses.map(m=>[m.floor,m.base,m.top]),[[2,4500,7500],[3,7500,10500]]);
});
