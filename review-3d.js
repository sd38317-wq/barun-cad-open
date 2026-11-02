import {buildDesignModel3D,buildDesignModel3DSteps} from './design-model3d.js';
import {drainModelWork,runModelWork,modelWorkAbort} from './model-work.js';
import {startModelWait} from './wait-model-progress.js';
import {installDesignPushPull} from './design-push-pull-ui.js';
import * as THREE from './three.module.js';
import {OrbitControls} from './OrbitControls.js';
import {mergeGeometries} from './BufferGeometryUtils.js';
import {GLTFExporter} from './GLTFExporter.js';
import * as G from './geometry.js';
import {architectureSolids,furnitureSolids,furnitureSpec,furnitureOutline} from './architecture.js';
import {installLawOverlay} from './review-3d-law.js';
import {roofGeometry} from './roof-geometry.js';
import {floorName,floorHeight,floorElevation,floorFootprints} from './review-3d-geometry.js';
import {installSunStrip,computeSunGridAsync,sunGridRunning,sunGridOverlay,sunWorstSpots,sunByParcel} from './review-3d-sun.js';
import {installWalk,eyeFromPlan,lookVector,EYE_HEIGHT,INTERIOR_FOV} from './review-3d-walk.js';
import {sunPosition,siteOf,gridAzimuth,KEY_DAYS,SUN_RULE,sunRuleText} from './sun-study.js';
import {basicWindSpeed,designWind,windOnWalls,WIND_SOURCE} from './wind-load.js';
import {resolveMaterial,materialPreset,KIND_LABELS,MATERIAL_PRESETS} from './material-presets.js';
import {windAsks,interiorAsks,ASK_RULE} from './ai-asks.js';
export {floorElevation} from './review-3d-geometry.js';

export function noonSun(date=new Date(),latitude=35.1){
 const day=(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())-Date.UTC(date.getFullYear(),0,0))/86400000;
 const declination=23.44*Math.sin(2*Math.PI*(day-81)/365.2422);
 return {azimuth:latitude>=declination?180:0,altitude:90-Math.abs(latitude-declination)};
}
// 부재별 재료(material-presets.js): 레이어 색 대신 건축 재료. 고르는 순서는 객체에 정한 재료 > 도면 종류별 재료(model3d.materials) > 기본.
// 사용자가 3D 색(model3d.color)을 정하면 그 색으로 물들인다. 유리는 반투명·그림자 없음(빛이 들어옴).
// 무늬(벽돌·판석·패널·목재…)는 그림 파일 없이 실제 크기(mm)로 즉석에서 그린다. 3D 의 UV 가 m 단위라 repeat = 1 / 무늬 한 장 크기(m).
const TEXTURES=new Map();
function seeded(n){let x=n*9301+49297;return ()=>{x=(x*9301+49297)%233280;return x/233280;};}
function shade(hex,amount){const c=new THREE.Color(hex),hsl={};c.getHSL(hsl);c.setHSL(hsl.h,hsl.s,Math.max(0,Math.min(1,hsl.l*(1+amount))));return '#'+c.getHexString();}
function patternTexture(preset){
 if(TEXTURES.has(preset.id))return TEXTURES.get(preset.id);
 if(typeof document==='undefined'||!preset.pattern){TEXTURES.set(preset.id,null);return null;}
 const {type,unit:[uw,uh],joint=0,jointColor='#888888',variation=.08,dots,speckle}=preset.pattern,mw=uw+joint,mh=uh+joint;
 const cols=type==='brick'||type==='stone'?Math.max(2,Math.round(1200/mw)):Math.max(1,Math.round(1000/mw)),rows=Math.max(type==='brick'?2:1,Math.round(1000/mh)+(type==='brick'&&Math.round(1000/mh)%2?1:0));
 const tileW=cols*mw,tileH=rows*mh,px=Math.min(1024,Math.max(128,Math.round(tileW*.5))),py=Math.min(1024,Math.max(64,Math.round(px*tileH/tileW))),k=px/tileW,ky=py/tileH;
 const canvas=document.createElement('canvas');canvas.width=px;canvas.height=py;const g=canvas.getContext('2d'),rnd=seeded(preset.id.length*31+uw);
 g.fillStyle=joint?jointColor:preset.color;g.fillRect(0,0,px,py);
 const cell=(x,y,w,h)=>{g.fillStyle=shade(preset.color,(rnd()-.5)*2*variation);g.fillRect(x*k,y*ky,Math.max(1,w*k),Math.max(1,h*ky));};
 for(let r=0;r<rows;r++){
  const y=r*mh+joint/2;
  if(type==='brick'){const off=r%2?mw/2:0;for(let c=-1;c<=cols;c++)cell(c*mw+off+joint/2,y,uw,uh);}
  else if(type==='board'||type==='seam'){cell(0,y,tileW,uh);}
  else if(type==='grain'){cell(0,r*mh,tileW,mh);g.strokeStyle=jointColor;g.globalAlpha=.35;for(let i=0;i<3;i++){g.beginPath();const yy=(r*mh+rnd()*mh)*ky;g.moveTo(0,yy);g.bezierCurveTo(px*.3,yy+(rnd()-.5)*4,px*.6,yy+(rnd()-.5)*4,px,yy);g.stroke();}g.globalAlpha=1;}
  else for(let c=0;c<cols;c++)cell(c*mw+joint/2,y,uw,uh);
 }
 if(type==='seam'){g.fillStyle=jointColor;for(let c=0;c<cols;c++)g.fillRect((c*mw)*k,0,Math.max(1,joint*k),py);}
 if(dots){g.fillStyle='rgba(60,60,60,.35)';for(let c=0;c<cols;c++)for(let r=0;r<rows;r++)for(const [fx,fy] of [[.25,.25],[.75,.25],[.25,.75],[.75,.75]]){g.beginPath();g.arc((c*mw+joint/2+uw*fx)*k,(r*mh+joint/2+uh*fy)*ky,Math.max(1,12*k),0,Math.PI*2);g.fill();}}
 if(speckle){const image=g.getImageData(0,0,px,py),d=image.data;for(let i=0;i<d.length;i+=4){const n=(rnd()-.5)*28;d[i]+=n;d[i+1]+=n;d[i+2]+=n;}g.putImageData(image,0,0);}
 const texture=new THREE.CanvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(1000/tileW,1000/tileH);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
 TEXTURES.set(preset.id,texture);return texture;
}
function reviewMaterial(kind,presetId,color){
 const preset=materialPreset(presetId)||resolveMaterial(kind),map=patternTexture(preset),glass=kind==='glass';
 return new THREE.MeshStandardMaterial({color:map&&color.getHexString()===new THREE.Color(preset.color).getHexString()?0xffffff:color,map,roughness:preset.roughness,metalness:preset.metalness,
  ...(glass||preset.opacity!==undefined?{transparent:true,opacity:preset.opacity??.32,depthWrite:false}:{})});
}
const MODEL_EDGES=new WeakMap();
// 옆면(벽 면) UV 를 그 변 방향으로 잰 거리(m)로 한다. 기본 UV 는 x 나 y 로 투영해서 비스듬한 벽에서 무늬가 늘어난다(√2 배).
const REAL_SIZE_UV={generateTopUV(geometry,v,a,b,c){return [new THREE.Vector2(v[a*3],v[a*3+1]),new THREE.Vector2(v[b*3],v[b*3+1]),new THREE.Vector2(v[c*3],v[c*3+1])];},
 generateSideWallUV(geometry,v,a,b,c,d){const ax=v[a*3],ay=v[a*3+1],bx=v[b*3],by=v[b*3+1],len=Math.hypot(bx-ax,by-ay)||1,ux=(bx-ax)/len,uy=(by-ay)/len,u=(x,y)=>x*ux+y*uy;
  return [new THREE.Vector2(u(ax,ay),v[a*3+2]),new THREE.Vector2(u(bx,by),v[b*3+2]),new THREE.Vector2(u(v[c*3],v[c*3+1]),v[c*3+2]),new THREE.Vector2(u(v[d*3],v[d*3+1]),v[d*3+2])];}};
/** 설계 JSON 모델(design-model3d)에도 도면 종류별 재료를 입힌다(재료를 정했을 때만 — 정하지 않으면 원래 모습). */
function applyDesignMaterials(group,docMaterials){
 if(!docMaterials||!Object.keys(docMaterials).length)return;
 const kindOf={wall:'wall',parapet:'wall',core:'wall',column:'solid',mass:'solid'};
 group.traverse(o=>{const kind=o.isMesh&&kindOf[o.userData.kind];if(!kind)return;const preset=resolveMaterial(kind,docMaterials);o.material=reviewMaterial(kind,preset.id,new THREE.Color(preset.color));o.userData.material=preset.id;});
}
/** 모서리 선: 모든 불투명 부재의 접힌 모서리(25° 넘게 꺾인 곳)를 선 하나로 모은다(그리기 1번). 3D 화면·그림용, GLB 에는 넣지 않는다. */
export function addReviewEdges(group){return drainModelWork(reviewEdgeSteps(group));}
export function addReviewEdgesAsync(group,work={}){return runModelWork(reviewEdgeSteps(group,!!work.onProgress),work);}
function* reviewEdgeSteps(group,progress=false){
 let positions=MODEL_EDGES.get(group);const m=new THREE.Matrix4(),v=new THREE.Vector3();
 if(!positions){positions=[];group.updateMatrixWorld(true);
 const meshes=[];group.traverse(o=>{if(o.isMesh&&o.userData.kind!=='glass')meshes.push(o);});let done=0;
 for(const o of meshes){const edges=new THREE.EdgesGeometry(o.geometry,25),pos=edges.getAttribute('position');m.copy(o.matrixWorld);for(let i=0;i<pos.count;i++){v.fromBufferAttribute(pos,i).applyMatrix4(m);positions.push(v.x,v.y,v.z);}edges.dispose();yield progress?{phase:'mesh',label:'모서리 선 만들기',done:++done,total:meshes.length,unit:'개'}:undefined;}}
 if(!positions.length)return null;
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 const lines=new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:0x2c3136,transparent:true,opacity:.45}));lines.userData.edges=true;lines.name='모서리 선';group.add(lines);return lines;
}
/** 화면 공통 색감: 톤 보정(ACES), 하늘색 배경. */
export function reviewLook(renderer,scene){renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;scene.background=new THREE.Color('#cfe0ea');}
/** 태양을 고도·방위(도북 기준)로 놓는다. extent 는 그림자 범위 배율. 화면과 AI 그림이 같이 쓴다. */
export function placeSun(sun,center,span,s,extent=1){const az=s.azimuth*Math.PI/180,alt=s.altitude*Math.PI/180;if(!Number.isFinite(az)||!Number.isFinite(alt))return;
 sun.position.copy(center).add(new THREE.Vector3(Math.sin(az)*Math.cos(alt),Math.sin(alt),-Math.cos(az)*Math.cos(alt)).multiplyScalar(span*2));sun.target.position.copy(center);
 const r=span*extent;Object.assign(sun.shadow.camera,{left:-r,right:r,top:r,bottom:-r,near:.01,far:span*6});sun.shadow.camera.updateProjectionMatrix();const tone=sunLook(s.altitude);sun.color.copy(tone.color);sun.intensity=tone.intensity;}
/** 태양 색·세기: 낮으면 주황(아침·저녁), 높으면 흰빛. */
export function sunLook(altitude){const t=Math.max(0,Math.min(1,altitude/35));return {color:new THREE.Color('#ffb067').lerp(new THREE.Color('#fff5e6'),t),intensity:altitude>0?1.4+1.8*t:0};}
// The viewport, AI eye and GLB export share this builder. Called only on a 3D request.
export function wallLayerGuess(layers){
 const named=l=>/wall|벽|partition|칸막이|concrete|콘크리트|조적|masonry|(?:^|[-_\s])con(?:$|[-_\s])/i.test(l.name)&&!/insul|단열|hatch|해치|pattern|finish|마감|center|중심/i.test(l.name);
 const plain=l=>!/insul|단열|hatch|해치|pattern|finish|마감|center|중심/i.test(l.name);
 return layers.find(l=>/^A-WALL(?:$|-)/i.test(l.name)&&plain(l))||layers.find(named)||null;
}
// 도면 묶음의 평면 칸(wallViews)마다 원점·층: 묶음 평면은 모델 좌표를 칸 원점만큼 옮겨 그린다.
function planViewFrames(record){
 const stories=new Map((record.model?.stories||[]).map(s=>[s.id,s])),walls=new Map((record.model?.elements||[]).filter(w=>w.kind==='wall').map(w=>[w.id,w]));
 return (record.wallViews||[]).map(view=>{const [dx,dy]=view.origin||[0,0];let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity,story=null;
  for(const id of view.wallIds||[]){const w=walls.get(id);if(!w)continue;story??=stories.get(w.story)||null;for(const [x,y] of w.path||[]){x0=Math.min(x0,x+dx);y0=Math.min(y0,y+dy);x1=Math.max(x1,x+dx);y1=Math.max(y1,y+dy);}}
  return {x0,y0,x1,y1,dx,dy,story};}).concat([(()=>{let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const w of walls.values())for(const [x,y] of w.path||[]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}return {x0,y0,x1,y1,dx:0,dy:0,story:null};})()])   // 원래 평면(모델 좌표 그대로): 묶음을 옆에 그리고 가구는 원래 평면에 둔 경우
   .filter(f=>f.x1>f.x0&&f.y1>f.y0);
}
// 내부 보기: 묶음 3D 는 모델 좌표로 서므로, 평면 칸에서 찍은 점은 그 칸 원점을 빼고 그 칸 층 바닥(m)에 선다. 칸 밖이거나 묶음이 없으면 null(도면 좌표 그대로).
export function walkSpotFromPlan(doc,setId,point){const record=doc.drawingSets?.[setId||Object.keys(doc.drawingSets||{})[0]];if(!record)return null;
 const f=planViewFrames(record).find(f=>point.x>=f.x0&&point.x<=f.x1&&point.y>=f.y0&&point.y<=f.y1);
 return f?{point:{x:point.x-f.dx,y:point.y-f.dy},level:f.story?(f.story.elevation||0)/1000:null}:null;}
// 도면 묶음 3D 위에 평면의 가구·위생·주방 블록을 상자로 얹는다(실내 보기·GLB 같은 길). 묶음 모델엔 가구 종류가 없어 겹치지 않는다.
// 가구가 든 평면 칸이 있으면 그 칸 원점을 빼고 그 층 바닥에 둔다. 칸이 있는데 어느 칸에도 없으면 이 묶음 가구가 아니라 빼고 ignoredFurniture 로 알린다.
// 칸 기록이 없는 옛 묶음은 레이어 층 이름(없으면 1층) → 모델 층 표고.
function* addPlanFurniture(doc,group,record,{floors,floor=3000}={}){
 const table=doc.model3d?.floorHeights||{},wanted=floors===undefined?null:new Set(floors),docMaterials=doc.model3d?.materials||{},frames=planViewFrames(record),storyByName=new Map((record.model?.stories||[]).map(s=>[s.name,s]));let count=0;
 for(const e of doc.entities||[]){
  if(e.hidden||e.type!=='block'&&!e.model3d)continue;const layer=doc.layers?.find(l=>l.id===e.layer);
  if(!layer||!layer.visible||layer.frozen)continue;
  const parts=e.type==='block'?(furnitureSpec(e,layer.name)?furnitureSolids(e,e.sharedBlock?G.resolveSharedDrawingReference(doc,e):e,layer.name):[]):furnitureOutline(e,layer.name);if(!parts.length)continue;
  const cx=parts[0].points.reduce((s,p)=>s+p.x,0)/parts[0].points.length,cy=parts[0].points.reduce((s,p)=>s+p.y,0)/parts[0].points.length;
  const frame=frames.find(f=>cx>=f.x0&&cx<=f.x1&&cy>=f.y0&&cy<=f.y1);
  if(frames.length&&!frame){(group.userData.ignoredFurniture??=[]).push(e.id);continue;}
  const layerStory=floorName(layer.name),story=frame?.story||storyByName.get(layerStory||'1F')||null,storyName=story?.name||layerStory;
  if(wanted&&storyName&&!wanted.has(storyName))continue;
  const z=story?story.elevation||0:floorElevation(layer.name,floor,table),dx=frame?.dx||0,dy=frame?.dy||0;
  for(const part of parts){
   const geo=new THREE.ExtrudeGeometry(new THREE.Shape(part.points.map(p=>new THREE.Vector2((p.x-dx)/1000,(p.y-dy)/1000))),{depth:part.height/1000,bevelEnabled:false,steps:1,UVGenerator:REAL_SIZE_UV});geo.rotateX(-Math.PI/2);geo.translate(0,(z+part.z)/1000,0);
   const preset=resolveMaterial('solid',docMaterials,part.material),mesh=new THREE.Mesh(geo,reviewMaterial('solid',preset.id,new THREE.Color(e.model3d?.color||(!part.material&&!docMaterials.solid?part.color:null)||preset.color)));
   mesh.userData.material=preset.id;mesh.userData.objectId=e.id;mesh.userData.kind='solid';mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);count++;}
  yield;
 }
 return count;
}
export function buildReviewModel(doc,options={}){return drainModelWork(buildReviewModelSteps(doc,options));}
export function buildReviewModelAsync(doc,options={},work={}){return runModelWork(buildReviewModelSteps(doc,options,!!work.onProgress),work);}
function* buildReviewModelSteps(doc,{inferLayerWalls=()=>[],floor=doc.model3d?.floorHeights?3000:doc.reviewSettings?.floorHeight||3000,wallLayer=doc.reviewSettings?.wallLayer,heights={},floors,setId,autoSlabs=doc.model3d?.autoSlabs!==false,autoRoof=doc.model3d?.autoRoof!==false}={},progress=false){
 const ids=Object.keys(doc.drawingSets||{});
 if(setId!==undefined&&!doc.drawingSets?.[setId])throw Error('설계 도면 묶음을 찾을 수 없습니다.');
 const designId=setId??ids[0];
 if(designId){const built=yield* buildDesignModel3DSteps(doc.drawingSets[designId].model,{setId:designId,floors},progress);applyDesignMaterials(built.group,doc.model3d?.materials);if(yield* addPlanFurniture(doc,built.group,doc.drawingSets[designId],{floors,floor}))built.box=new THREE.Box3().setFromObject(built.group);return built;}
 const table=doc.model3d?.floorHeights||{},wanted=floors===undefined?null:new Set(floors);
 const acceptLayer=layer=>!wanted||wanted.has(floorName(layer.name));
 const group=new THREE.Group();group.name='CAD geometry (metres)';
 const buckets=new Map(),linePositions=[],lineColors=[],siteEdges=[];let objectId='';
  const addLine=(a,b,z,color)=>{linePositions.push(a.x/1000,z/1000,-a.y/1000,b.x/1000,z/1000,-b.y/1000);lineColors.push(color.r,color.g,color.b,color.r,color.g,color.b);};
  const docMaterials=doc.model3d?.materials||{};
  const look=(kind,override,own=null)=>{const preset=resolveMaterial(kind,docMaterials,own);return {kind,preset:preset.id,color:new THREE.Color(override||preset.color)};};
  const edgePositions=[];
  const prismEdges=(loop,z0,z1,top=true)=>{const n=loop.length;for(let i=0;i<n;i++){const a=loop[i],b=loop[(i+1)%n],c=loop[(i+n-1)%n],X=p=>p.x/1000,Y=p=>-p.y/1000;
    edgePositions.push(X(a),z0,Y(a),X(b),z0,Y(b));if(top)edgePositions.push(X(a),z1,Y(a),X(b),z1,Y(b));
    const u={x:a.x-c.x,y:a.y-c.y},v={x:b.x-a.x,y:b.y-a.y},lu=Math.hypot(u.x,u.y),lv=Math.hypot(v.x,v.y);   // 25° 넘게 꺾인 꼭짓점만 세로선
    if(lu>1e-9&&lv>1e-9&&(u.x*v.x+u.y*v.y)/(lu*lv)<Math.cos(25*Math.PI/180))edgePositions.push(X(a),z0,Y(a),X(a),z1,Y(a));}};
  const extrude=(points,depth,z,material,holes=[],roofRise=0)=>{const color=material.color;if(points.length<3)return;if(material.kind!=='glass')for(const loop of [points,...holes])if(loop.length>=3)prismEdges(loop,z/1000,(z+depth)/1000,!roofRise);const shape=new THREE.Shape(points.map(p=>new THREE.Vector2(p.x/1000,p.y/1000)));for(const loop of holes)shape.holes.push(new THREE.Path(loop.map(p=>new THREE.Vector2(p.x/1000,p.y/1000))));const geo=new THREE.ExtrudeGeometry(shape,{depth:depth/1000,bevelEnabled:false,steps:1,curveSegments:12,UVGenerator:REAL_SIZE_UV});if(roofRise){const ys=points.map(p=>p.y/1000),lo=Math.min(...ys),span=Math.max(...ys)-lo||1,pos=geo.getAttribute('position');for(let i=0;i<pos.count;i++)pos.setZ(i,pos.getZ(i)+roofRise/1000*(pos.getY(i)-lo)/span);geo.computeVertexNormals();}geo.rotateX(-Math.PI/2);geo.translate(0,z/1000,0);const key=material.kind+':'+material.preset+':'+color.getHex()+':'+objectId;if(!buckets.has(key))buckets.set(key,{kind:material.kind,preset:material.preset,color:color.getHex(),id:objectId,geos:[]});buckets.get(key).geos.push(geo);};
  const addRoof=(points,options,z,material)=>{const color=material.color;const roof=roofGeometry(points,options);if(roof.fallback)(group.userData.roofFallbacks??=[]).push({id:objectId,reason:roof.reason});if(!roof.triangles.length)return;const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(roof.triangles.flat(1).flatMap(p=>[p.x/1000,(z+p.z)/1000,-p.y/1000]),3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(roof.triangles.flat(1).flatMap(p=>[p.x/1000,p.y/1000]),2));geo.computeVertexNormals();{const edges=new THREE.EdgesGeometry(geo,25),pos=edges.getAttribute('position');for(let i=0;i<pos.count;i++)edgePositions.push(pos.getX(i),pos.getY(i),pos.getZ(i));edges.dispose();}const key=material.kind+':'+material.preset+':'+color.getHex()+':'+objectId;if(!buckets.has(key))buckets.set(key,{kind:material.kind,preset:material.preset,color:color.getHex(),id:objectId,geos:[]});buckets.get(key).geos.push(geo);};
  let complete=false;try {
  let wallCount=0,done=0;const total=doc.entities.length;
  const tick=(phase,label,done,total)=>progress?{phase,label,done,total,unit:'개'}:undefined;
  const depthFor=layer=>heights[layer.id]??layer.height??floorHeight(layer.name,table,floor);
  const flat=[];const flatten=function*(e,parent){const l=doc.layers.find(l=>l.id===e.layer)||parent;if(!l||!l.visible||l.frozen||e.hidden||e.model3d||e.libraryCommand||['DOOR','WINDOW','STAIR'].includes(e.parameters?.kind))return;if(e.type==='block'){const source=e.sharedBlock?G.resolveSharedDrawingReference(doc,e):e;for(const child of source.entities||[]){yield* flatten(child,l);yield;}}else flat.push({...e,layer:l.id});};let prepared=0;for(const e of doc.entities){yield* flatten(e);yield tick('prepare','도면 객체 확인',++prepared,total);}
  const inferred=new Map(),inferFor=ids=>{const key=[...ids].sort().join('\0');if(!inferred.has(key))inferred.set(key,inferLayerWalls(flat,ids));return inferred.get(key);};
  for(const layer of doc.layers)if(layer.visible&&!layer.frozen&&acceptLayer(layer)&&(layer.id===wallLayer||floorName(layer.name))){for(const points of inferFor(new Set([layer.id]))){extrude(points,depthFor(layer),floorElevation(layer.name,floor,table),look('wall'));wallCount++;yield tick('prepare','벽 레이어 확인',undefined,undefined);}}
  const visit=function*(e,inherited){const layer=doc.layers.find(l=>l.id===e.layer)||inherited;if(!layer||!layer.visible||layer.frozen||e.hidden)return;const z=floorElevation(layer.name,floor,table),color=new THREE.Color(e.color||layer.color||'#ffffff');
   if(e.type==='block'){const solids=acceptLayer(layer)?architectureSolids(e):[];if(solids.length){for(const part of solids)extrude(part.points,part.height,z+part.z,look(part.role||(part.glass?'glass':'frame'),part.role==='glass'?null:e.model3d?.color,e.model3d?.material));return;}const source=e.sharedBlock?G.resolveSharedDrawingReference(doc,e):e;
    const furniture=acceptLayer(layer)?furnitureSolids(e,source,layer.name):[];if(furniture.length){for(const part of furniture)extrude(part.points,part.height,z+part.z,look('solid',e.model3d?.color||(!part.material&&!docMaterials.solid?part.color:null),part.material));return;}for(const child of source.entities||[]){yield* visit(child,layer);yield;}return;}
   if(!acceptLayer(layer))return;
   if(e.type==='wall'){const height=e.model3d?.height??depthFor(layer),base=z+(e.model3d?.elevation||0);for(const points of G.wallPolygons(e)){extrude(points,height,base,look('wall',e.model3d?.color,e.model3d?.material));wallCount++;}
     const u=G.unit(G.sub(e.points[1],e.points[0])),n=G.mul(G.normal(u),e.thickness/2);
     for(const opening of doc.entities.filter(o=>o.hostWall===e.id)){const a=opening.position,b=G.add(a,G.mul(u,opening.openingWidth)),ps=[G.add(a,n),G.add(b,n),G.sub(b,n),G.sub(a,n)],sill=opening.parameters?.sill||0,top=sill+(opening.parameters?.height||2100);if(sill>0)extrude(ps,Math.min(sill,height),base,look('wall',e.model3d?.color,e.model3d?.material));if(top<height)extrude(ps,height-top,base+top,look('wall',e.model3d?.color,e.model3d?.material));}
     wallCount++;return;}
   if((e.type==='rectangle'||e.type==='rect'||e.type==='polyline'&&e.closed)&&layer.name.toUpperCase()!=='SITE'){const solidKind=e.model3d?.kind==='slab'?'slab':e.model3d?.kind==='roof'?'roof':'solid';extrude(e.points,e.model3d?.height??200,z+(e.model3d?.elevation||0),look(solidKind,e.model3d?.color||(solidKind==='solid'&&!e.model3d?.material&&!docMaterials.solid?e.color:null),e.model3d?.material),e.loops||[],!e.model3d?.roof&&e.model3d?.kind==='roof'?e.model3d.roofRise:0);if(e.model3d?.roof)addRoof(e.points,e.model3d.roof,z+(e.model3d.elevation||0)+(e.model3d.height??200),look('roof',e.model3d.color,e.model3d.material));return;}
   if(layer.name.toUpperCase()==='SITE'&&e.points?.length>=3){const ps=e.points.map(p=>({x:p.x/1000,y:p.y/1000}));const signed=ps.reduce((sum,p,i)=>sum+G.cross(p,ps[(i+1)%ps.length]),0);ps.forEach((p,i)=>{const q=ps[(i+1)%ps.length];if(G.dist(p,q)>1e-8)siteEdges.push([p,q,G.mul(G.normal(G.unit(G.sub(q,p))),signed>=0?1:-1)]);});}
   for(const primitive of G.primitives(e)){
    if(primitive.points){for(let i=1;i<primitive.points.length;i++)addLine(primitive.points[i-1],primitive.points[i],z+.5,color);if(primitive.closed||primitive.type==='rectangle')addLine(primitive.points.at(-1),primitive.points[0],z+.5,color);}
    else if(['circle','arc'].includes(primitive.type)){const start=primitive.startAngle||0,sweep=primitive.type==='circle'?360:G.normalizeAngle(primitive.endAngle-start);let prev=G.add(primitive.center,G.polar(primitive.radius,start));for(let i=1;i<=64;i++){const p=G.add(primitive.center,G.polar(primitive.radius,start+sweep*i/64));addLine(prev,p,z+.5,color);prev=p;}}
    else if(primitive.type==='ellipse'){const ps=G.ellipsePoints(primitive,3);for(let i=1;i<ps.length;i++)addLine(ps[i-1],ps[i],z+.5,color);}
   }
  };
  for(const e of doc.entities){objectId=e.id;yield* visit(e);yield tick('objects','3D 객체 만들기',++done,total); }
  const footprints=(autoSlabs||autoRoof)?floorFootprints(doc,{inferLayerWalls:(_entities,ids)=>inferFor(ids)}):[];
  const topFloor=Math.max(0,...footprints.map(f=>Number(f.floor.slice(0,-1))));
  let footprintDone=0;for(const footprint of footprints){
   if(wanted&&!wanted.has(footprint.floor))continue;
   const z=floorElevation(footprint.floor,floor,table);
   if(autoSlabs){objectId='';extrude(footprint.points,200,z-200,look('slab'),footprint.holes);}
   if(autoRoof&&Number(footprint.floor.slice(0,-1))===topFloor){objectId='';extrude(footprint.points,200,z+floorHeight(footprint.floor,table,floor),look('roof'),footprint.holes);}
   yield tick('mesh','바닥·지붕 만들기',++footprintDone,footprints.length);
  }
  let meshDone=0;for(const {kind,preset,color,id,geos} of buckets.values()){const merged=mergeGeometries(geos,false);geos.forEach(g=>g.dispose());if(merged){const glass=kind==='glass',mesh=new THREE.Mesh(merged,reviewMaterial(kind,preset,new THREE.Color(color)));mesh.userData.material=preset;mesh.userData.objectId=id;mesh.userData.kind=kind;mesh.castShadow=!glass;mesh.receiveShadow=!glass;if(glass)mesh.renderOrder=2;group.add(mesh);}yield tick('mesh','3D 표면 모으기',++meshDone,buckets.size);}
  MODEL_EDGES.set(group,edgePositions);   // addReviewEdges 가 선으로. userData 에 두면 GLB extras 로 실려 파일이 커진다
  if(linePositions.length){const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(linePositions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(lineColors,3));group.add(new THREE.LineSegments(geo,new THREE.LineBasicMaterial({vertexColors:true})));}
 const box=new THREE.Box3().setFromObject(group);
 complete=true;return {group,box,siteEdges,wallCount,floors:[...new Set(doc.layers.filter(l=>l.visible&&!l.frozen&&acceptLayer(l)).map(l=>floorName(l.name)).filter(Boolean))].sort((a,b)=>parseInt(a)-parseInt(b))};
  } finally {if(!complete){disposeReviewModel(group);for(const {geos} of buckets.values())for(const geo of geos)geo.dispose();}}
}
export function disposeReviewModel(group){group?.traverse(o=>{o.geometry?.dispose();for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])m.dispose();});}
export const REVIEW_VIEWS=['iso-ne','iso-nw','iso-se','iso-sw','top','front','back','left','right'];
export function reviewCamera(box,view='iso-se'){
 const directions={'iso-ne':[1,.8,-1],'iso-nw':[-1,.8,-1],'iso-se':[1,.8,1],'iso-sw':[-1,.8,1],top:[0,1,0],front:[0,0,1],back:[0,0,-1],left:[-1,0,0],right:[1,0,0]};
 if(!directions[view])throw Error('지원하지 않는 3D 보기입니다.');
 if(box.isEmpty())throw Error('볼 3D 형상이 없습니다.');
 const center=box.getCenter(new THREE.Vector3()),radius=Math.max(.001,box.getSize(new THREE.Vector3()).length()/2),camera=new THREE.OrthographicCamera(-radius*1.1,radius*1.1,radius*1.1,-radius*1.1,.001,radius*10+10);
 camera.position.copy(center).add(new THREE.Vector3(...directions[view]).normalize().multiplyScalar(radius*3+1));
 if(view==='top')camera.up.set(0,0,-1);camera.lookAt(center);camera.updateProjectionMatrix();return camera;
}
export async function renderReview3D(doc,{view='iso-se',size=900,...options}={}){
 if(!REVIEW_VIEWS.includes(view)||!Number.isInteger(size)||size<256||size>1600)throw Error('3D 보기 또는 크기(256~1600)가 잘못되었습니다.');
 if(options.floors!==undefined&&(!Array.isArray(options.floors)||options.floors.some(f=>typeof f!=='string'||floorName(f)!==f)))throw Error('floors에는 nF 층 이름 목록을 주세요.');
 const model=buildReviewModel(doc,options);let renderer;
 try{
  const camera=reviewCamera(model.box,view),scene=new THREE.Scene();addReviewEdges(model.group);scene.add(model.group,new THREE.HemisphereLight(0xdce9f2,0x8f877c,2));
  const sun=new THREE.DirectionalLight(0xffffff,3);sun.position.copy(camera.position);scene.add(sun);
  // Detached canvas, no OrbitControls, UI installation or animation loop.
  const canvas=document.createElement('canvas');renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});reviewLook(renderer,scene);renderer.setPixelRatio(1);renderer.setSize(size,size,false);renderer.render(scene,camera);
  const boundsMm={min:{x:model.box.min.x*1000,y:-model.box.max.z*1000,z:model.box.min.y*1000},max:{x:model.box.max.x*1000,y:-model.box.min.z*1000,z:model.box.max.y*1000}};
  return {view,width:size,height:size,floors:model.floors,boundsMm,image:{mimeType:'image/png',data:canvas.toDataURL('image/png').split(',')[1]}};
 }finally{disposeReviewModel(model.group);renderer?.dispose();renderer?.forceContextLoss();}
}
/** 층 바닥(m) 목록 — 설계 JSON 은 층 표고 그대로, 아니면 층 이름(1F·2F…)·층 높이 표. */
function modelLevels(doc,model,floor){
 const table=doc.model3d?.floorHeights,levels=model.levels?.length?[...new Set(model.levels)]:[...new Set((model.floors||[]).map(f=>floorElevation(f,doc.model3d?.floorHeights?3000:floor,table)/1000))].filter(Number.isFinite).sort((a,b)=>a-b);
 return levels.length?levels:[0];
}
const minutesOf=time=>{const m=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(time||'12:00');if(!m)throw Error('time 은 00:00~23:59 (HH:MM) 입니다.');return Number(m[1])*60+Number(m[2]);};
const checkSize=size=>{if(!Number.isInteger(size)||size<256||size>1600)throw Error('size 는 256~1600 정수입니다.');return size;};
async function offscreen(doc,{width,height,...options}){
 const floor=options.floor??(doc.model3d?.floorHeights?3000:doc.reviewSettings?.floorHeight||3000),model=buildReviewModel(doc,{...options,floor});
 if(model.box.isEmpty())throw Error('볼 3D 형상이 없습니다. 벽 레이어를 고르거나 벽을 그리세요.');
 addReviewEdges(model.group);
 const center=model.box.getCenter(new THREE.Vector3()),span=Math.max(10,model.box.getSize(new THREE.Vector3()).length());
 const canvas=document.createElement('canvas'),renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true}),scene=new THREE.Scene();
 renderer.setPixelRatio(1);renderer.setSize(width,height,false);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;reviewLook(renderer,scene);
 const sun=new THREE.DirectionalLight(0xffffff,3);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.0001;
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(span*3,span*3),new THREE.MeshStandardMaterial({color:0xb8b3a7,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.set(center.x,-.01,center.z);ground.receiveShadow=true;
 scene.add(model.group,new THREE.HemisphereLight(0xdce9f2,0x8f877c,1.6),sun,sun.target,ground);
 const site=siteOf(doc,{x:center.x*1000,y:-center.z*1000});
 // 공유 무늬 텍스처는 renderer 마다 dispose 리스너가 붙는다 — 다 쓰면 텍스처를 dispose 해 리스너를 걷는다(화면은 다음에 다시 올린다).
 const dispose=()=>{disposeReviewModel(model.group);ground.geometry.dispose();ground.material.dispose();for(const t of TEXTURES.values())t?.dispose();renderer.dispose();renderer.forceContextLoss();};
 return {model,center,span,canvas,renderer,scene,sun,ground,site,dispose,levels:modelLevels(doc,model,floor),floor};
}
const sunAt=(site,dayKey,minutes)=>{const d=KEY_DAYS.find(k=>k.key===(dayKey||'winter'));if(!d)throw Error('day 는 winter·equinox·summer 입니다.');const p=sunPosition({year:new Date().getFullYear(),month:d.month,day:d.day,hour:Math.floor(minutes/60),minute:minutes%60},site);return {altitude:p.altitude,azimuth:gridAzimuth(p.azimuth,site),label:d.label};};
/** AI 도구 cad_sun_study: 태양 위치·일조 확보(칸 비율·부족한 곳)·그림. */
export async function renderSunStudy(doc,{day:dayIn,time='12:00',grid=true,view='iso-se',size=900,...options}={}){
 const day=dayIn||'winter';
 checkSize(size);const minutes=minutesOf(time),ctx=await offscreen(doc,{width:size,height:size,...options});
 try{
  const at=m=>sunAt(ctx.site,day,m),applySun=(s,extent)=>placeSun(ctx.sun,ctx.center,ctx.span,s||at(minutes),extent);applySun();
  let gridResult=null,overlay=null;
  if(grid!==false){const r=await computeSunGridAsync({signal:options.signal,onProgress:options.onProgress,renderer:ctx.renderer,scene:ctx.scene,sun:ctx.sun,center:ctx.center,span:ctx.span,group:ctx.model.group,at,applySun});overlay=sunGridOverlay(r);ctx.scene.add(overlay);
   gridResult={okRatio:Number(r.summary.ratio.toFixed(3)),cells:r.summary.cells,okCells:r.summary.ok,cellSizeMm:Math.round(r.side/r.grid*1000),worst:sunWorstSpots(r),...(options.neighbors?.length?{neighbors:sunByParcel(r,options.neighbors)}:{})};}
  const box=ctx.model.box.clone();if(overlay)box.expandByObject(overlay);
  const camera=reviewCamera(box,view);ctx.renderer.render(ctx.scene,camera);
  const s=at(minutes);
  if(overlay){overlay.geometry.dispose();overlay.material.map.dispose();overlay.material.dispose();}
  return {day,dayLabel:s.label,time,site:{lat:Number(ctx.site.lat.toFixed(5)),lon:Number(ctx.site.lon.toFixed(5)),source:ctx.site.source},sun:{altitude:Number(s.altitude.toFixed(2)),azimuth:Number(s.azimuth.toFixed(2)),azimuthNote:'도면 위쪽(도북) 기준 시계 방향'},
   assumed:[...(dayIn?[]:[{key:'day',value:'winter',say:'날짜는 일조 기준일인 동지(12월 22일)로 봤어요. 춘·추분이나 하지가 궁금하면 말해 주세요.'}]),
    ...(ctx.site.source?.startsWith('지적도')?[]:[{key:'site',say:ctx.site.province?`도면 개요의 대지 주소로 ${ctx.site.province} 위도에서 계산했어요. 주소로 대지를 불러오면 그 자리 해 길로 더 정확히 봐요.`:'대지 위치를 몰라 부산 위도로 계산했어요. 주소로 대지를 불러오면 그 자리 해 길로 다시 봐요.'}])],
   rule:sunRuleText(s.label),grid:gridResult,legend:'초록 기준 충족 · 주황 2시간 이상 · 빨강 2시간 미만',note:'건축법 정북 사선 판정과는 별개 · 주변 건물은 모델에 있을 때만',width:size,height:size,image:{mimeType:'image/png',data:ctx.canvas.toDataURL('image/png').split(',')[1]}};
 }finally{ctx.dispose();}
}
/** 방향을 안 주면 눈높이에서 16 방향으로 벽까지 거리를 재어 가장 트인 쪽을 본다(가운데 쪽만 보면 벽에 붙은 자리에서 벽만 찍혔다, 2026-10-30). */
function openYaw(scene,eye){
 const ray=new THREE.Raycaster(),from=new THREE.Vector3(eye.position.x,eye.position.y,eye.position.z),meshes=[];scene.traverse(o=>{if(o.isMesh)meshes.push(o);});
 let best=eye.yaw,far=-1;
 for(let i=0;i<16;i++){const yaw=eye.yaw+i*Math.PI/8,v=lookVector(yaw,0);ray.set(from,new THREE.Vector3(v.x,v.y,v.z));const d=ray.intersectObjects(meshes,false)[0]?.distance??0;if(d>far+.3){far=d;best=yaw;}}
 return best;
}
/** AI 도구 cad_view_interior: 도면 점(mm)의 눈높이 투시도. heading 0 = 도면 위쪽(북), 90 = 오른쪽(동). */
export async function renderInterior(doc,{x,y,floor:floorName,heading,pitch=0,fov=INTERIOR_FOV,size=1200,day='winter',time='12:00',...options}={}){
 if(x!==undefined&&!Number.isFinite(x)||y!==undefined&&!Number.isFinite(y)||(x===undefined)!==(y===undefined))throw Error('x, y(도면 mm)는 둘 다 숫자로 주세요.');checkSize(size);minutesOf(time);
 if(!(fov>=30&&fov<=100))throw Error('fov 는 30~100 입니다.');if(!(pitch>=-60&&pitch<=60))throw Error('pitch 는 -60~60 입니다.');if(heading!==undefined&&!Number.isFinite(heading))throw Error('heading 은 각도(°) 숫자입니다.');
 const width=size,height=Math.round(size*.66),ctx=await offscreen(doc,{width,height,...options});
 try{
  const table=doc.model3d?.floorHeights,design=ctx.model.floorLevels;
  const named=(design?Object.entries(design):(ctx.model.floors||[]).map(f=>[f,floorElevation(f,ctx.floor,table)/1000])).filter(([,v])=>Number.isFinite(v)).sort((p,q)=>p[1]-q[1]);   // 층 이름과 바닥(m), 낮은 층부터
  if(x===undefined){const b=ctx.model.box,inside=p=>!b.isEmpty()&&p.x>=b.min.x*1000&&p.x<=b.max.x*1000&&-p.y>=b.min.z*1000&&-p.y<=b.max.z*1000;
   const asks=interiorAsks(doc,{floor:floorName},{center:b.isEmpty()?null:{x:(b.min.x+b.max.x)*500,y:-(b.min.z+b.max.z)*500},inside,floors:named.map(([f])=>f)});
   return {...asks,howToAsk:ASK_RULE+' spot 의 value(x,y,floor)를 그대로 넣으세요.'};}
  let level=ctx.levels[0];
  if(floorName){if(design){if(!(floorName in design))throw Error(`없는 층입니다: ${floorName} (있는 층: ${Object.keys(design).join(', ')})`);level=design[floorName];}
   else{if(ctx.model.floors?.length&&!ctx.model.floors.includes(floorName))throw Error(`없는 층입니다: ${floorName} (있는 층: ${ctx.model.floors.join(', ')})`);level=floorElevation(floorName,ctx.floor,table)/1000;}}
  const eye=eyeFromPlan({x,y},level,ctx.center),yaw=heading===undefined?openYaw(ctx.scene,eye):-heading*Math.PI/180,v=lookVector(yaw,pitch*Math.PI/180);
  const camera=new THREE.PerspectiveCamera(fov,width/height,.05,Math.max(500,ctx.span*4));camera.position.set(eye.position.x,eye.position.y,eye.position.z);camera.lookAt(eye.position.x+v.x,eye.position.y+v.y,eye.position.z+v.z);
  const s=sunAt(ctx.site,day,minutesOf(time));placeSun(ctx.sun,ctx.center,ctx.span,s);ctx.scene.add(new THREE.AmbientLight(0xfff4e6,.9));ctx.renderer.render(ctx.scene,camera);   // 실내는 은은한 실내 조명을 더한다(벽 그늘이 너무 어둡지 않게)
  const b=ctx.model.box,inside=eye.position.x>=b.min.x&&eye.position.x<=b.max.x&&eye.position.z>=b.min.z&&eye.position.z<=b.max.z;
  const shown=named.find(([,v])=>Math.abs(v-level)<1e-6)?.[0],others=named.map(([f])=>f).filter(f=>f!==shown);   // 실제로 본 층 이름(바닥 높이로 찾음)
  return {...(!floorName&&shown&&others.length?{assumed:[{key:'floor',value:shown,say:`${shown}에서 봤어요. 다른 층(${others.slice(0,5).join(', ')})이 궁금하면 말해 주세요.`}]}:{}),eye:{x,y,z:Math.round((level+EYE_HEIGHT)*1000)},floorLevelMm:Math.round(level*1000),heading:Number(((-yaw*180/Math.PI)%360+360).toFixed(1))%360,pitch,fov,sun:{day,time,altitude:Number(s.altitude.toFixed(1))},
   ...(inside?{}:{warning:'찍은 점이 모델 범위 밖입니다(건물 밖에서 본 그림).'}),width,height,image:{mimeType:'image/png',data:ctx.canvas.toDataURL('image/png').split(',')[1]}};
 }finally{ctx.dispose();}
}
/** AI 도구 cad_wind_check: 풍하중 개략 검토(KDS 41 12 00:2022 5.5·5.15 + LH 지역별 기본풍속). 면별 풍압 + 바람 받는 면 색칠 그림. */
export async function renderWindCheck(doc,{region,basicWindSpeed:V0in,terrain:terrainIn,importance:importanceIn,height,directions=[0,90,180,270],direction,gust=null,size=900,...options}={}){
 checkSize(size);if(gust!==null&&gust!==undefined&&!(gust>=1&&gust<=4))throw Error('gust(가스트영향계수)는 1~4 입니다.');if(!Array.isArray(directions)||!directions.length||directions.some(d=>!(d>=0&&d<=360)))throw Error('directions 는 0~360° 배열입니다.');
 const asks=windAsks(doc,{region,basicWindSpeed:V0in,terrain:terrainIn,importance:importanceIn});
 if(asks.needs.length)return {source:WIND_SOURCE,autoFilled:asks.autoFilled,assumed:asks.assumed,needs:asks.needs,howToAsk:ASK_RULE};   // 모르는 것이 있으면 계산하지 않고 묻는다
 const found=asks.found,terrain=terrainIn,importance=importanceIn||'1';
 const ctx=await offscreen(doc,{width:size,height:size,...options});
 try{
  const H=height>0?height:Math.max(1,ctx.model.box.max.y),autoFilled={...asks.autoFilled,...(height>0?{}:{height:{value:Number(H.toFixed(1)),from:'3D 모델 꼭대기 높이(m)'}})};
  const wind=designWind({V0:found.speed,terrain,height:H,importance});
  const walls=doc.entities.filter(e=>e.type==='wall'&&e.points?.length===2).map(e=>({id:e.id,a:e.points[0],b:e.points[1]}));
  const b=ctx.model.box,box=[{x:b.min.x*1000,y:-b.max.z*1000},{x:b.max.x*1000,y:-b.max.z*1000},{x:b.max.x*1000,y:-b.min.z*1000},{x:b.min.x*1000,y:-b.min.z*1000}];
  const outline=walls.length?walls:box.map((p,i)=>({id:'외곽'+(i+1),a:p,b:box[(i+1)%4]}));   // 벽 객체가 없으면 건물 외곽 상자로
  const results=windOnWalls(outline,{qH:wind.qH,height:H,directions,gust});
  const pick=direction!==undefined?results.find(r=>r.from===direction)||windOnWalls(outline,{qH:wind.qH,height:H,directions:[direction],gust})[0]:results.slice().sort((x,y)=>Math.abs(y.maxNegative)-Math.abs(x.maxNegative))[0];
  // 그림: 고른 바람 방향에서 면을 풍압으로 색칠(정압 붉은색, 부압 파란색, 진할수록 큼)
  const byId=new Map(pick.faces.map(f=>[f.id,f.pressure])),peak=Math.max(1,...pick.faces.map(f=>Math.abs(f.pressure)));
  // 벽 객체가 없으면(선으로 그린 벽) 바깥 둘레 면에서 0.6 m 안에 있는 벽에 그 면의 풍압 색을 칠한다
  const faceOf=o=>{if(walls.length)return byId.get(o.userData.objectId);const c=new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()),q={x:c.x*1000,y:-c.z*1000};let best,d=600;for(const f of outline){const t=G.distanceToSegment(q,f.a,f.b);if(t<d){d=t;best=f.id;}}return best===undefined?undefined:byId.get(best);};
  ctx.model.group.traverse(o=>{if(!o.isMesh||o.userData.kind!=='wall')return;const p=faceOf(o);if(p===undefined)return;const t=Math.min(1,Math.abs(p)/peak);const old=o.material;o.material=old.clone();old.dispose();o.material.map=null;o.material.color=new THREE.Color(p>0?'#f2e3dc':'#dde6f2').lerp(new THREE.Color(p>0?'#c8432b':'#2f6fb8'),.25+.75*t);});
  const views=['iso-ne','iso-se','iso-sw','iso-nw'],view=views[Math.floor((((pick.from%360)+360)%360)/90)%4];   // 바람이 불어오는 쪽에서 본다
  placeSun(ctx.sun,ctx.center,ctx.span,{altitude:45,azimuth:pick.from});
  ctx.renderer.render(ctx.scene,reviewCamera(ctx.model.box,view));
  const round=v=>Number(v.toFixed(3));
  return {source:WIND_SOURCE,autoFilled,assumed:asks.assumed,region:found.region,province:found.province,basicWindSpeed:found.speed,terrain,importance,referenceHeightM:round(H),
   designWindSpeed:round(wind.VH),velocityPressure:Math.round(wind.qH),factors:{KD:wind.KD,Kzr:round(wind.Kzr),Kzt:wind.Kzt,Iw:wind.Iw,gust:gust||'미반영'},
   facesFrom:walls.length?'벽 객체(바깥 벽만)':'건물 외곽 상자(벽 객체 없음)',
   directions:results.map(r=>({from:r.from,label:r.label,maxPositive:r.maxPositive,maxNegative:r.maxNegative,faces:r.faces.slice(0,80)})),
   image:{mimeType:'image/png',data:ctx.canvas.toDataURL('image/png').split(',')[1]},imageDirection:{from:pick.from,label:pick.label,view,legend:'붉은색 정압(바람받이) · 파란색 부압(바람그늘·측벽) · 진할수록 큼'},
   note:'풍압(N/m²) = 속도압 × 외압계수(표 5.15-1)'+(gust?' × 가스트영향계수(입력값)':'')+', 주골조 최소 675 N/m² 적용. 내압 미반영 · 개략 검토(구조 설계 아님)',width:size,height:size};
 }finally{ctx.dispose();}
}
export async function exportReviewGLB(doc,options={}){
 const model=buildReviewModel(doc,options);
 try{if(model.box.isEmpty())throw Error('저장할 3D 형상이 없습니다.');return await new GLTFExporter().parseAsync(model.group,{binary:true});}
 finally{disposeReviewModel(model.group);}
}
export function installReview3D({engine,toast,download,inferLayerWalls=()=>[],editEntity=()=>{},exportIfc=null,openStoreys=null,pushPull=null,pickPlanPoint=null,waitEnabled=()=>true}){
 const viewport=document.querySelector('.viewport'),label=viewport.querySelector('.canvas-label');
 const switcher=document.createElement('span');switcher.className='review-switch';
 const top=document.createElement('button'),three=document.createElement('button');top.textContent='TOP';three.textContent='3D';switcher.append(top,three);label.replaceChildren(switcher);
 const rail=document.querySelector('.sidebar-tabs'),sidebar=document.getElementById('review-3d-toggle')||document.createElement('button');sidebar.id='review-3d-toggle';sidebar.textContent='3D 모델링';sidebar.setAttribute('aria-expanded','false');sidebar.title='3D 모델 보기 · 다시 누르면 2D 도면';if(!sidebar.isConnected)rail?.insertBefore(sidebar,rail.querySelector('.livecheck-toggle'));
 const panel=document.createElement('section');panel.className='review-3d';panel.hidden=true;
 const controls=document.createElement('div');controls.className='review-settings';
 controls.innerHTML='<button class="r-fit" title="모델 전체를 화면에 맞춥니다">전체 보기</button><button class="r-walk" aria-pressed="false" title="평면에서 점을 찍으면 그 자리 눈높이(1.5 m)로 들어가 둘러봅니다">내부 보기</button><details class="r-settings-menu"><summary title="층고·벽 레이어·사선 보조">3D 설정</summary><label>층고 (mm)<input class="r-floor" type="number" min="1" value="3000"></label><label>벽으로 볼 레이어<select class="r-layer"></select></label><label><input class="r-follow" type="checkbox" checked>벽 높이를 층고와 같게</label><label>별도 벽 높이 (mm)<input class="r-height" type="number" min="1" value="3000"></label><label><input type="checkbox" class="r-road">도로사선 보조</label><label>SITE 도로변<select class="r-edge"></select></label><label><input type="checkbox" class="r-north">정북사선 보조</label><label>보조 평면 각도 (°)<input class="r-angle" type="number" min="1" max="89" value="45"></label><p>선택 레이어의 평행선·좁은 닫힌 윤곽을 벽으로 표시합니다.</p><p>각도 입력에 따른 보조 평면 · 법규 판정 아님</p></details><button class="r-export" title="3D 모델을 GLB 파일로 저장합니다">GLB 저장</button><button class="r-ifc" title="BIM 모델을 IFC 파일로 저장합니다">IFC 저장</button><button class="r-storeys" title="층 이름과 높이를 관리합니다">층 관리</button><span class="r-status" role="status"></span>';
 controls.querySelector('details').insertAdjacentHTML('beforeend','<label>층 높이 표 (mm)<textarea class="r-floor-table" rows="4" placeholder="1F=4500&#10;2F=3000"></textarea></label><button class="r-floor-apply">층 높이 적용</button><label><input type="checkbox" class="r-auto-slabs" checked>바닥판 자동 (200 mm)</label><label><input type="checkbox" class="r-auto-roof" checked>평지붕 자동 (200 mm)</label>');
 controls.insertAdjacentHTML('afterbegin','<label class="r-design-label">설계 도면 묶음<select class="r-design-set" aria-label="설계 도면 묶음"></select></label>');
 const canvas=document.createElement('canvas');canvas.tabIndex=0;canvas.setAttribute('aria-label','3D 검토 화면');const emptyGuide=document.createElement('div');emptyGuide.className='review-empty';emptyGuide.hidden=true;emptyGuide.innerHTML='<strong>세울 벽을 찾지 못했습니다</strong><span>위쪽 <b>벽 레이어</b>에서 벽이 그려진 레이어를 고르세요.</span><span>벽은 나란한 두 선(벽 두께)으로 그려져 있어야 합니다. 층별로 나누려면 레이어 이름에 1F·2F 를 넣으세요.</span>';panel.append(canvas,emptyGuide,controls);viewport.append(panel);
 const edit=document.createElement('details');edit.className='r-edit-menu';edit.innerHTML='<summary title="벽·바닥·지붕 높이와 위치를 바꿉니다">부재 편집</summary><label>부재<select class="r-object"></select></label><label>높이 / 두께 (mm)<input class="r-object-height" type="number" min="1" value="200"></label><label>바닥에서 높이 (mm)<input class="r-object-z" type="number" value="0"></label><label>재료<select class="r-object-material"></select></label><label><input type="checkbox" class="r-material-all" checked>같은 종류 모두</label><label>재질색<input class="r-object-color" type="color" value="#b8c7d0"></label><button class="r-object-apply">3D 치수 적용</button><button class="r-object-edit">문·창·계단 / 평면 속성 편집</button><p>벽·닫힌 윤곽의 높이와 위치를 바꿉니다. 문·창·계단은 아래 속성 편집을 사용하세요.</p>';controls.append(edit);edit.insertAdjacentHTML('beforeend','<label>형태<select class="r-object-kind"><option value="solid">벽 / 입체</option><option value="slab">슬래브</option><option value="roof">한 방향 경사 지붕</option></select></label><label>지붕 Y방향 상승 (mm)<input class="r-object-rise" type="number" min="0" value="1000"></label>');
 { const wallLabel=controls.querySelector('.r-layer').closest('label');wallLabel.className='r-wall-label';wallLabel.firstChild.textContent='벽 레이어';wallLabel.title='이 레이어의 나란한 두 선(벽 두께)을 벽으로 세웁니다. 이름에 1F·2F 가 있는 레이어는 그 층에 따로 세웁니다.';controls.prepend(wallLabel); }
 controls.addEventListener('toggle',e=>{if(e.target.open)for(const other of controls.querySelectorAll(':scope>details[open]'))if(other!==e.target)other.open=false;},true);
 for(const menu of controls.querySelectorAll(':scope>details')){const box=document.createElement('div');box.className='review-menu';while(menu.children.length>1)box.append(menu.children[1]);menu.append(box);}
 const $=s=>controls.querySelector(s),heights={};let renderer,scene,camera,orbit,group,helpers,sun,ground,active=false,dirty=true,debounce,frame=0,center=new THREE.Vector3(),span=20,siteEdges=[],levels=[0];
 const sunStrip=installSunStrip({panel,engine,toast,download,waitEnabled,get:()=>({renderer,scene,sun,center,span,group,camera}),applySun:(s,extent)=>lighting(s,extent),renderOnce:()=>{if(renderer)renderer.render(scene,camera);}});
 const lawOverlay=installLawOverlay({engine,controls,getScene:()=>scene,isActive:()=>active,toast,onModel:law=>{const box=new THREE.Box3();if(group)box.setFromObject(group);box.expandByObject(law);if(!box.isEmpty()){box.getCenter(center);span=Math.max(10,box.getSize(new THREE.Vector3()).length());if(!walk.isActive())fit();}}});
 function disposeGroup(g){if(!g)return;g.traverse(o=>{o.geometry?.dispose();if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());});scene.remove(g);}
 function init(){
  renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  scene=new THREE.Scene();reviewLook(renderer,scene);camera=new THREE.PerspectiveCamera(45,1,.01,100000);
  orbit=new OrbitControls(camera,canvas);orbit.enableDamping=true;orbit.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.PAN,RIGHT:THREE.MOUSE.PAN};orbit.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN};
  scene.add(new THREE.HemisphereLight(0xdce9f2,0x8f877c,1.6));sun=new THREE.DirectionalLight(0xffffff,3);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.0001;scene.add(sun,sun.target);
  new ResizeObserver(()=>{if(active)resize();}).observe(panel);
 }
 function resize(){const w=Math.max(1,panel.clientWidth),h=Math.max(1,panel.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
 function fit(){camera.position.copy(center).add(new THREE.Vector3(span*.8,span*.7,span*.9));orbit.target.copy(center);camera.near=Math.max(.01,span/10000);camera.far=Math.max(1000,span*30);camera.updateProjectionMatrix();orbit.update();}
 // 태양: 아래 일조 띠의 날짜·시각(도북 기준 방위). extent 는 일조 확보 계산 때 그림자 범위를 조금 넓힐 때.
 function lighting(s,extent=1){if(!sun)return;placeSun(sun,center,span,s||sunStrip.current(),extent);}
 function planes(){disposeGroup(helpers);helpers=new THREE.Group();scene.add(helpers);const angle=Number($('.r-angle').value);if(!(angle>0&&angle<90))return;
  const addPlane=(edge,color)=>{if(!edge)return;const [a,b,inward]=edge,depth=Math.min(span,30),rise=depth*Math.tan(angle*Math.PI/180);const ps=[a,b,{x:b.x+inward.x*depth,y:b.y+inward.y*depth},{x:a.x+inward.x*depth,y:a.y+inward.y*depth}];const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(ps.flatMap((p,i)=>[p.x,i<2?0:rise,-p.y]),3));geo.setIndex([0,1,2,0,2,3]);geo.computeVertexNormals();helpers.add(new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color,transparent:true,opacity:.22,side:THREE.DoubleSide,depthWrite:false})));};
  if($('.r-road').checked)addPlane(siteEdges[Number($('.r-edge').value)],0xffae55);
  if($('.r-north').checked){const north=siteEdges.filter(e=>e[2].y<0).sort((a,b)=>(b[0].y+b[1].y)-(a[0].y+a[1].y))[0];addPlane(north,0x79baff);}
 }
 let buildController=null,ifcController=null;
 async function rebuild(){
  dirty=true;buildController?.abort();const controller=new AbortController();buildController=controller;
  // 작은 모델은 0.1초 안에 끝난다: 나누지 않고 예전처럼 한 번에 만든다(나누면 +6% 느려짐).
  const showWait=waitEnabled()&&engine.doc.entities.length>20000,wait=startModelWait(panel,{title:'3D 보기 준비',enabled:showWait,phases:[{key:'prepare',label:'벽 확인'},{key:'objects',label:'객체 만들기'},{key:'mesh',label:'표면·모서리'}]});
  const work={signal:controller.signal,onProgress:showWait?event=>wait.push(event):undefined};let pending;
  try {
  const started=performance.now();sunStrip.reset();
  const floor=Number($('.r-floor').value);if(!(floor>0&&Number.isFinite(floor)))throw Error('층고는 양수여야 합니다.');
  const model=pending=await buildReviewModelAsync(engine.doc,{inferLayerWalls,floor:engine.doc.model3d?.floorHeights?3000:floor,wallLayer:$('.r-layer').value,heights,...($('.r-design-set').value?{setId:$('.r-design-set').value}:{})},work);
  await addReviewEdgesAsync(model.group,work);modelWorkAbort(controller.signal);disposeGroup(group);
  group=model.group;pending=null;scene.add(group);siteEdges=model.siteEdges;const wallCount=model.wallCount;
  // 내부 투시도 층 바닥(m): 층 이름(1F·2F…)과 층 높이 표에서. 없으면 지면 하나.
  levels=model.levels?.length?[...new Set(model.levels)]:[...new Set((model.floors||[]).map(f=>floorElevation(f,engine.doc.model3d?.floorHeights?3000:floor,engine.doc.model3d?.floorHeights)/1000))].filter(Number.isFinite).sort((a,b)=>a-b);if(!levels.length)levels=[0];   // 설계 JSON 은 층 표고(stories[].elevation) 그대로
  const box=new THREE.Box3().setFromObject(group);if(!box.isEmpty()){box.getCenter(center);span=Math.max(10,box.getSize(new THREE.Vector3()).length());}
  if(ground){ground.geometry.dispose();ground.material.dispose();scene.remove(ground);}ground=new THREE.Mesh(new THREE.PlaneGeometry(span*3,span*3),new THREE.MeshStandardMaterial({color:0xb8b3a7,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.set(center.x,-.01,center.z);ground.receiveShadow=true;scene.add(ground);
  const chosen=$('.r-edge').value;$('.r-edge').replaceChildren(...siteEdges.map((e,i)=>{const option=document.createElement('option');option.value=i;option.textContent='변 '+(i+1);return option;}));$('.r-edge').value=chosen||'0';if($('.r-edge').selectedIndex<0)$('.r-edge').selectedIndex=0;
  $('.r-road').disabled=$('.r-north').disabled=!siteEdges.length;lighting();planes();dirty=false;panel.dataset.modelHeightMm=String(box.isEmpty()?0:Math.round(box.max.y*1000));emptyGuide.hidden=true;   // 화면 가운데를 가리는 안내 상자는 쓰지 않는다: 위 상태 줄에만 짧게 알린다(사용자 요청 2026-10-16).
  $('.r-status').textContent=$('.r-design-set').value?`설계 JSON · 벽 형상 ${wallCount}개 · 갱신 ${Math.round(performance.now()-started)}ms`:wallCount?`벽 형상 ${wallCount}개 · 층고 ${floor} mm · 갱신 ${Math.round(performance.now()-started)}ms`:'벽 없음 · 3D 설정에서 벽 레이어를 고르세요(두 줄 선·해치·닫힌 벽 외곽)';
  wait.finish();return true;
  } catch(error){if(pending)disposeReviewModel(pending.group);if(error.name==='AbortError')return false;throw error;}
  finally {wait.destroy();if(buildController===controller)buildController=null;}
 }
 let frames=0,lastTime=0;
 function animate(now){if(!active)return;if(document.hidden){frame=0;return;}if(!walk.isActive())orbit.update();if(!buildController&&!sunGridRunning(renderer)){renderer.render(scene,camera);frames++;}if(now-lastTime>1000){panel.dataset.fps=String(Math.round(frames*1000/(now-lastTime)));frames=0;lastTime=now;}frame=requestAnimationFrame(animate);}
 document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;}else if(active&&!frame)frame=requestAnimationFrame(animate);});
 function sync(){
  const priorSet=$('.r-design-set').value;$('.r-design-set').replaceChildren(...Object.keys(engine.doc.drawingSets||{}).map(id=>{const option=document.createElement('option');option.value=id;option.textContent=id;return option;}));if(engine.doc.drawingSets?.[priorSet])$('.r-design-set').value=priorSet;$('.r-design-set').parentElement.hidden=!$('.r-design-set').options.length;edit.hidden=!!$('.r-design-set').value;designPull.syncVisibility();
  const usingDesign=!!$('.r-design-set').value;
  for(const selector of ['.r-floor','.r-layer','.r-follow','.r-height','.r-floor-table','.r-auto-slabs','.r-auto-roof'])$(selector).closest('label').hidden=usingDesign;
  $('.r-floor-apply').hidden=usingDesign;
  const object=$('.r-object').value;$('.r-object').replaceChildren(...engine.doc.entities.filter(e=>e.type==='wall'||e.type==='block'||e.closed||e.type==='rectangle').map((e,i)=>{const option=document.createElement('option');option.value=e.id;option.textContent=(e.attributes?.mark||{DOOR:'문',WINDOW:'창',STAIR:'계단',wall:'벽',rectangle:'사각형',polyline:'닫힌 윤곽',block:'블록'}[e.category||e.type]||e.name||'부재')+' '+(i+1);return option;}));if(engine.doc.entities.some(e=>e.id===object))$('.r-object').value=object;objectFields();
  $('.r-floor').value=engine.doc.reviewSettings?.floorHeight||3000;
  $('.r-floor-table').value=Object.entries(engine.doc.model3d?.floorHeights||{}).map(([f,h])=>`${f}=${h}`).join('\n');
  $('.r-auto-slabs').checked=engine.doc.model3d?.autoSlabs!==false;$('.r-auto-roof').checked=engine.doc.model3d?.autoRoof!==false;
  // 벽으로 볼 레이어: 저장된 선택 > 지금 고른 것 > 이름이 벽인 레이어(A-WALL 먼저). 없으면 '(벽 레이어 없음)'.
  // 예전에는 목록 첫 레이어(보통 0)가 저절로 골라져 벽이 아닌 평행선까지 벽으로 세웠다.
  const prior=engine.doc.reviewSettings?.wallLayer||$('.r-layer').value||wallLayerGuess(engine.doc.layers)?.id||'';const none=document.createElement('option');none.value='';none.textContent='(벽 레이어 없음)';$('.r-layer').replaceChildren(none,...engine.doc.layers.map(l=>{const o=document.createElement('option');o.value=l.id;o.textContent=l.name;return o;}));$('.r-layer').value=engine.doc.layers.some(l=>l.id===prior)?prior:'';
  const layer=engine.doc.layers.find(l=>l.id===$('.r-layer').value);$('.r-follow').checked=layer?.height==null;$('.r-height').disabled=$('.r-follow').checked;$('.r-height').value=layer?.height??floorHeight(layer?.name,engine.doc.model3d?.floorHeights,engine.doc.model3d?.floorHeights?3000:Number($('.r-floor').value));objectFields();
 }
 function open(){try{active=true;panel.hidden=false;top.setAttribute('aria-pressed','false');three.setAttribute('aria-pressed','true');if(!renderer)init();resize();sync();lawOverlay.open();cancelAnimationFrame(frame);frame=requestAnimationFrame(animate);if(dirty){void rebuild().then(ok=>{if(ok&&active)fit();}).catch(error=>{close();toast('3D 열기 실패: '+error.message,true);});}}catch(error){close();toast('3D 열기 실패: '+error.message,true);}}
 function close(){active=false;buildController?.abort();ifcController?.abort();walk.exit();sunStrip.stop();designPull.close();lawOverlay.close();active=false;panel.hidden=true;cancelAnimationFrame(frame);top.setAttribute('aria-pressed','true');three.setAttribute('aria-pressed','false');sidebar.setAttribute('aria-expanded','false');}
 const designPull=installDesignPushPull({canvas,controls,engine,getGroup:()=>group,getCamera:()=>camera,getOrbit:()=>orbit,getSetId:()=>$('.r-design-set').value,
  preview:(model,setId)=>{const built=buildDesignModel3D(model,{setId});disposeGroup(group);group=built.group;scene.add(group);},
  restore:()=>{if(active&&scene)void rebuild().catch(e=>toast(e.message,true));},commit:pushPull});
 $('.r-design-set').onchange=()=>{designPull.invalidate();edit.hidden=!!$('.r-design-set').value;dirty=true;if(active)void rebuild().then(ok=>{if(ok)fit();}).catch(e=>toast(e.message,true));};
 const openView=()=>{open();sidebar.setAttribute('aria-expanded',String(active));};
 const walk=installWalk({canvas,button:$('.r-walk'),status:$('.r-status'),toast,get:()=>({camera,orbit,center,levels,open:active,spot:point=>walkSpotFromPlan(engine.doc,$('.r-design-set').value,point)}),
  pickPlanPoint:prompt=>{close();return pickPlanPoint(prompt);},reopen:openView,
  onEnter:()=>{const mode=controls.querySelector('.pp-mode');if(mode?.checked){mode.checked=false;designPull.invalidate();}}});
 $('.r-walk').hidden=!pickPlanPoint;
 sidebar.onclick=()=>active?close():openView();top.onclick=close;three.onclick=openView;close();$('.r-fit').onclick=fit;
 const schedule=()=>{dirty=true;buildController?.abort();clearTimeout(debounce);if(active)debounce=setTimeout(()=>{void rebuild().catch(e=>toast(e.message,true));},80);};
 const changed=()=>{buildController?.abort();ifcController?.abort();designPull.invalidate({restore:false});lawOverlay.invalidate();for(const id of Object.keys(heights))delete heights[id];if(active)sync();schedule();};
 // 부재 편집의 재료: 부재 종류에 맞는 재료만 보이고, '같은 종류 모두'면 도면 전체 그 종류를 바꾼다(문·창은 종류 전체만).
 const materialKindOf=e=>e.type==='wall'?'wall':e.type==='block'?({WINDOW:'frame',DOOR:'leaf',STAIR:'stair'}[e.parameters?.kind]||'solid'):e.model3d?.kind==='slab'?'slab':e.model3d?.kind==='roof'||e.model3d?.roof?'roof':'solid';
 function materialField(e){const kind=materialKindOf(e),current=resolveMaterial(kind,engine.doc.model3d?.materials,e.model3d?.material).id;
  $('.r-object-material').replaceChildren(...MATERIAL_PRESETS.filter(m=>m.kinds.includes(kind)).map(m=>Object.assign(document.createElement('option'),{value:m.id,textContent:m.label})));$('.r-object-material').value=current;
  $('.r-object-material').title=`${KIND_LABELS[kind]} 재료 · AI 에게 "외벽을 적벽돌로 바꿔 줘" 처럼 말해도 됩니다`;$('.r-material-all').disabled=e.type==='block';if(e.type==='block')$('.r-material-all').checked=true;}
 function objectFields(){const e=engine.doc.entities.find(e=>e.id===$('.r-object').value);if(!e)return;materialField(e);const layer=engine.doc.layers.find(l=>l.id===e.layer),table=engine.doc.model3d?.floorHeights,defaultHeight=layer?.height??floorHeight(layer?.name,table,table?3000:Number($('.r-floor').value));$('.r-object-kind').value=e.model3d?.kind||'solid';$('.r-object-rise').value=e.model3d?.roofRise??1000;$('.r-object-height').value=e.model3d?.height??(e.type==='wall'?defaultHeight:200);$('.r-object-z').value=e.model3d?.elevation||0;$('.r-object-color').value=e.model3d?.color||e.color||layer?.color||'#b8c7d0';}
 $('.r-object').onchange=objectFields;
 $('.r-object-material').onchange=()=>{try{const e=engine.doc.entities.find(e=>e.id===$('.r-object').value);if(!e)return;const kind=materialKindOf(e),id=$('.r-object-material').value;
  if($('.r-material-all').checked||e.type==='block')engine.execute({type:'model3d.settings',settings:{materials:{[kind]:id}}});else engine.execute({type:'model3d.set',ids:[e.id],changes:{material:id}});}catch(error){toast(error.message,true);}};
 $('.r-object-apply').onclick=()=>{try{const e=engine.doc.entities.find(e=>e.id===$('.r-object').value),height=Number($('.r-object-height').value),elevation=Number($('.r-object-z').value);if(!e)throw Error('부재를 선택하세요.');if(e.type==='block')throw Error('문·창·계단 / 평면 속성 편집을 사용하세요.');if(!(height>0&&height<=100000&&Number.isFinite(elevation)))throw Error('높이는 0~100000 mm 안의 양수로 입력하세요.');engine.execute({type:'model3d.set',ids:[e.id],changes:{height,elevation,kind:$('.r-object-kind').value,roofRise:Number($('.r-object-rise').value),color:$('.r-object-color').value}});}catch(e){toast(e.message,true);}};
 $('.r-object-edit').onclick=()=>{if($('.r-object').value)editEntity($('.r-object').value);};
 let startPointer;canvas.addEventListener('pointerdown',e=>{startPointer={x:e.clientX,y:e.clientY};});canvas.addEventListener('pointerup',e=>{if(walk.isActive()||!startPointer||Math.hypot(e.clientX-startPointer.x,e.clientY-startPointer.y)>5)return;const r=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2),camera);const id=ray.intersectObjects(group?.children||[]).find(h=>h.object.userData.objectId)?.object.userData.objectId;if(id){$('.r-object').value=id;edit.open=true;objectFields();}});
 $('.r-layer').onchange=()=>engine.execute({type:'review.settings',settings:{wallLayer:$('.r-layer').value}});
 $('.r-follow').onchange=()=>engine.execute({type:'layer.update',id:$('.r-layer').value,changes:{height:$('.r-follow').checked?null:Number($('.r-height').value)}});
 $('.r-floor').oninput=()=>{const n=Number($('.r-floor').value);if(n>0&&Number.isFinite(n)){if($('.r-follow').checked)$('.r-height').value=n;schedule();}};
 $('.r-floor').onchange=()=>{const n=Number($('.r-floor').value);if(n>0&&Number.isFinite(n))engine.execute({type:'review.settings',settings:{floorHeight:n}});else{toast('층고는 양수여야 합니다.',true);sync();schedule();}};
 $('.r-height').oninput=()=>{const n=Number($('.r-height').value);if(n>0&&Number.isFinite(n)){heights[$('.r-layer').value]=n;schedule();}};
 $('.r-height').onchange=()=>{const n=Number($('.r-height').value);if(n>0&&Number.isFinite(n))engine.execute({type:'layer.update',id:$('.r-layer').value,changes:{height:n}});else{toast('벽 높이는 양수여야 합니다.',true);sync();schedule();}};
 for(const key of ['.r-road','.r-north','.r-angle','.r-edge'])$(key).onchange=planes;
 // IFC 저장·층 관리(BIM): 화면이 넘겨준 경우에만 보인다
 $('.r-storeys').hidden=!openStoreys;$('.r-storeys').onclick=()=>openStoreys?.();
 $('.r-ifc').hidden=!exportIfc;$('.r-ifc').onclick=async()=>{if(ifcController)return;const controller=new AbortController();ifcController=controller;const button=$('.r-ifc');button.disabled=true;
  const showWait=waitEnabled(),wait=startModelWait(panel,{title:'IFC 만들기',enabled:showWait,phases:[{key:'prepare',label:'층·벽 준비'},{key:'objects',label:'객체 쓰기'}]});
  try{await exportIfc({onProgress:showWait?event=>wait.push(event):undefined,signal:controller.signal});modelWorkAbort(controller.signal);wait.finish();}
  catch(e){if(e.name!=='AbortError')toast('IFC 저장 실패: '+e.message,true);}finally{wait.destroy();ifcController=null;button.disabled=false;}};
 $('.r-export').onclick=async()=>{try{if(dirty&&!await rebuild())return;if(!group)return;const edges=group.children.filter(o=>o.userData.edges);edges.forEach(o=>group.remove(o));let result;try{result=await new GLTFExporter().parseAsync(group,{binary:true});}finally{edges.forEach(o=>group.add(o));}/* 모서리 선은 화면용이라 GLB 에서 뺀다 */download(new Blob([result],{type:'model/gltf-binary'}),'바른CAD_3D.glb','model/gltf-binary');}catch(e){toast('GLB 저장 실패: '+e.message,true);}};
 panel.addEventListener('pointerdown',e=>e.stopPropagation());panel.addEventListener('wheel',e=>e.stopPropagation());panel.addEventListener('keydown',e=>e.stopPropagation());engine.onChange(changed);
 $('.r-floor-apply').onclick=()=>{try{const table={};for(const row of $('.r-floor-table').value.split(/\n/).map(s=>s.trim()).filter(Boolean)){const m=row.match(/^([1-9]\d*F)\s*=\s*(\S+)$/i);if(!m)throw Error('층 높이는 1F=4500 형식으로 입력하세요.');const key=m[1].toUpperCase();if(Object.hasOwn(table,key))throw Error('층 이름이 중복되었습니다.');table[key]=Number(m[2]);}engine.execute({type:'model3d.settings',settings:{floorHeights:table}});}catch(error){toast(error.message,true);}};
 for(const [selector,key] of [['.r-auto-slabs','autoSlabs'],['.r-auto-roof','autoRoof']])$(selector).onchange=()=>engine.execute({type:'model3d.settings',settings:{[key]:$(selector).checked}});
 return {open:openView,close,walk:()=>walk.start()};
}
