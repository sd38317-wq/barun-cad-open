// 계획 탭 ⑥ 3D: 지적 바닥 · 5m 등고선 · 주변 건물 매스 · 계획 매스를 실제 좌표(drawingGeo) 그대로 띄우고 GLB 로 저장한다.
// 좌표: 도면 mm → 3D m (x, 높이, -y). 높이 기준(0)은 대지 가운데 지반고.
import * as THREE from './three.module.js';
import {OrbitControls} from './OrbitControls.js';
import {GLTFExporter} from './GLTFExporter.js';
import * as G from './geometry.js';
import {analysisModel,withZones,terrainGrid,diagramSVG,svgToPngDataUrl,useCategory,HEIGHT_BINS,AGE_BINS,USE_CATS,USE_UNKNOWN} from './site-analysis.js';
// 이 파일은 [3D로 보기]를 누를 때만 app.js 가 불러온다(three 는 그때 함께 읽힌다).

/** 3D 장면 재료(순수 함수 · 시험 대상): 도면에서 대지·주변·등고선·계획 매스를 뽑는다. */
/** radiusM 을 주면 대지 가운데에서 그 반경 안(대지분석 원 도판과 같은 원)의 건물·등고선만 넣는다. */
export function site3dModel(doc,{radiusM=null}={}){
 const all=G.parcelEntities(doc?.entities||[]);
 const contours=all.filter(e=>(e.parcelRole==='contour'||e.parcelRole==='contour-major')&&Number.isFinite(e.attributes?.elevationM));
 const samples=contours.flatMap(e=>e.points.filter((_,i)=>i%3===0).map(p=>[p.x,p.y,e.attributes.elevationM]));
 // 지반고: 가까운 등고선 점 8개의 거리 역가중 평균(등고선이 없으면 0).
 const groundAt=(x,y)=>{if(!samples.length)return 0;const near=samples.map(s=>[Math.hypot(s[0]-x,s[1]-y),s[2]]).sort((a,b)=>a[0]-b[0]).slice(0,8);if(near[0][0]<1)return near[0][1];let w=0,v=0;for(const [d,z] of near){w+=1/d**2;v+=z/d**2;}return v/w;};
 const sites=all.filter(e=>e.parcelRole==='site'&&e.attributes?.ring!=='hole');
 const pts=sites.flatMap(e=>e.points);const center=pts.length?{x:pts.reduce((s,p)=>s+p.x,0)/pts.length,y:pts.reduce((s,p)=>s+p.y,0)/pts.length}:{x:0,y:0};
 const base=groundAt(center.x,center.y);
 const R=radiusM?radiusM*1000:0,inside=R?p=>Math.hypot(p.x-center.x,p.y-center.y)<=R:()=>true;
 // 원판이 경계선: 선은 원 둘레에서 끊고(한 줄이 여러 토막이 될 수 있다), 다 안에 있는 닫힌 선만 닫힌 채로.
 const cut=(points,z,closed=false)=>{if(points.every(inside))return [{points:points.map(p=>({x:p.x,y:p.y,z:z(p)})),whole:true}];
  return G.clipLineToCircle(closed?[...points,points[0]]:points,center,R).map(run=>({points:run.map(p=>({x:p.x,y:p.y,z:z(p)})),whole:false}));};
 const lines=all.filter(e=>['site','road','neighbor'].includes(e.parcelRole)&&e.attributes?.ring!=='hole').flatMap(e=>cut(e.points,p=>groundAt(p.x,p.y)-base,true).map(r=>({role:e.parcelRole,points:r.points,closed:r.whole})));
 const terrain=contours.flatMap(e=>cut(e.points,()=>e.attributes.elevationM-base).map(r=>({major:e.parcelRole==='contour-major',points:r.points})));
 const buildings=all.filter(e=>e.parcelRole==='building'&&e.closed&&e.points?.length>=3).map(e=>[e,e.points.reduce((s,p)=>({x:s.x+p.x/e.points.length,y:s.y+p.y/e.points.length}),{x:0,y:0})]).map(([e,c])=>[e,c,e.points.every(inside)?e.points:G.clipRingToCircle(e.points,center,R)]).filter(([,,points])=>points.length>=3).map(([e,c,points])=>{
  const a=e.attributes||{},ground=Number.isFinite(a.groundM)?a.groundM:groundAt(c.x,c.y),source=String(a.heightSource||'');
  // 도판과 같은 색 기준: 높이(층수 없음 → 미상)·용도·사용승인 연도.
  return {points,z:ground-base,height:(e.model3d?.height||3300)/1000,estimated:!source.startsWith('건물 높이'),
   h:source.startsWith('층수 없음')?null:Number(a.heightM)||null,use:useCategory(a.useCode,a.useName),year:Number(a.approvalYear)||null};});
 const plan=planMasses(doc);
 return {lines,terrain,buildings,plan,base,hasTerrain:samples.length>0};
}

/** 건물 색: 기본(높이 자료 있음/추정) 또는 대지분석 도판 색. */
// legend(model) = 위쪽 줄 색 설명(고른 색에 따라 바뀐다, 대표 2026-10-27 시안 승인).
export const BUILDING_COLORS={
 basic:{t:'기본',of:b=>b.estimated?'#8d969d':'#c9d6df',legend:m=>[...(m.plan.length?[{c:'#9dcbe0',t:'계획안'}]:[]),{c:'#c9d6df',t:'실제 높이(GIS)'},{c:'#8d969d',t:'층수로 추정'}]},
 height:{t:'높이',of:b=>HEIGHT_BINS.find(x=>x.test(b.h)).c,legend:m=>HEIGHT_BINS.filter(x=>m.buildings.some(b=>x===HEIGHT_BINS.find(y=>y.test(b.h)))).map(x=>({c:x.c,t:x.t}))},
 use:{t:'용도',of:b=>(b.use||USE_UNKNOWN).c,legend:m=>[...USE_CATS,USE_UNKNOWN].filter(c=>m.buildings.some(b=>(b.use||USE_UNKNOWN)===c)).map(c=>({c:c.c,t:c.t}))},
 age:{t:'연대',of:b=>b.year?(AGE_BINS.find(x=>b.year<x.m)||AGE_BINS.at(-1)).c:'#e3e3e1',legend:m=>AGE_BINS.filter(x=>m.buildings.some(b=>b.year&&(AGE_BINS.find(y=>b.year<y.m)||AGE_BINS.at(-1))===x)).map(x=>({c:x.c,t:x.t})).concat(m.buildings.some(b=>!b.year)?[{c:'#e3e3e1',t:'미상'}]:[])},
};
/** 첫 화면 가운데: 계획안이 있으면 계획 매스, 없으면 대지(대지 선) 가운데 — 3D 좌표(m: x 동, z 남). 둘 다 없으면 null. */
export function focusPoint(model){
 const pts=model.plan.length?model.plan.flatMap(m=>m.points):model.lines.filter(l=>l.role==='site').flatMap(l=>l.points);
 if(!pts.length)return null;
 return {x:pts.reduce((s,p)=>s+p.x,0)/pts.length/1000,y:0,z:-pts.reduce((s,p)=>s+p.y,0)/pts.length/1000};
}
/** 바닥에 까는 대지분석 도판(zones = 도시계획 자료가 있어야 하는 것). */
export const GROUND_BOARDS=[{key:'',t:'없음'},{key:'topo',t:'지형'},{key:'slope',t:'경사도'},{key:'aspect',t:'경사 방향'},{key:'roads',t:'도로 위계',zones:true},{key:'zoning',t:'용도지역',zones:true}];

/** 설계엔진 계획안(doc.sitePlan, EPSG:5187 m)을 도면 원점에 맞춘 층별 매스로. 원점이 없거나 좌표계가 다르면 없음. */
export function planMasses(doc){
 const plan=doc?.sitePlan,geo=doc?.drawingGeo,g=plan?.geometry;
 if(!g||!geo||geo.crs!=='EPSG:5187')return [];
 const n=plan.report?.numbers||{},floors=(g.floors||[]).length?g.floors:g.footprint?Array(Math.max(1,Math.round(n.floors||1))).fill(g.footprint):[];
 const each=Number.isFinite(n.height)&&n.height>0&&floors.length?n.height/floors.length:3.3;
 const ring=r=>(Array.isArray(r?.[0]?.[0])?r[0]:r).map(([x,y])=>({x:(x-geo.originM[0])*1000,y:(y-geo.originM[1])*1000}));
 return floors.map((r,i)=>({points:ring(r),z:i*each,height:each}));
}

export async function openSite3D({doc,host,toast=()=>{},download=()=>{},zoning=null,radius=500}){
 const am=withZones(analysisModel(doc,{maxRadiusM:radius}),zoning);
 const model=site3dModel(doc,{radiusM:am?.R});
 if(!model.buildings.length&&!model.terrain.length&&!model.plan.length)throw Error('3D로 볼 주변 건물·등고선·계획안이 없습니다. 먼저 [주변 건물·등고선 가져오기]를 누르세요.');
 const panel=document.createElement('section');panel.className='site-3d';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','대지 주변 3D');
 const bar=document.createElement('div');bar.className='site-3d-bar';
 const title=document.createElement('strong');title.textContent='대지 주변 3D';
 const note=document.createElement('span');note.className='site-3d-note';const count=document.createElement('em');count.textContent=`주변 건물 ${model.buildings.length}동${model.hasTerrain?' · 5m 등고선':' · 등고선 없음(평지로 표시)'}`;
 const chips=document.createElement('span');chips.className='site-3d-chips';note.append(count,chips);
 const showLegend=key=>chips.replaceChildren(...BUILDING_COLORS[key].legend(model).map(it=>{const s=document.createElement('span');s.className='site-3d-chip';const i=document.createElement('i');i.style.background=it.c;s.append(i,it.t);return s;}));
 showLegend('basic');
 const toSite=document.createElement('button');toSite.type='button';toSite.textContent='대지로';
 const toAll=document.createElement('button');toAll.type='button';toAll.textContent='전체';
 const pick=(label,options)=>{const wrap=document.createElement('label');wrap.className='site-3d-pick';const s=document.createElement('select');s.setAttribute('aria-label',label);
  for(const [value,text,disabled] of options){const o=document.createElement('option');o.value=value;o.textContent=text;o.disabled=!!disabled;s.append(o);}wrap.append(label+' ',s);return [wrap,s];};
 const [colorWrap,colorPick]=pick('색',Object.entries(BUILDING_COLORS).map(([k,v])=>[k,v.t]));
 const [groundWrap,groundPick]=pick('바닥',GROUND_BOARDS.map(g=>[g.key,g.zones&&!zoning?g.t+'(⑤ 대지분석을 먼저 여세요)':g.t,(g.zones&&!zoning)||(!g.zones&&g.key&&!model.hasTerrain)]));
 const save=document.createElement('button');save.type='button';save.textContent='GLB 저장';
 const close=document.createElement('button');close.type='button';close.textContent='닫기';
 bar.append(title,note,colorWrap,groundWrap,toSite,toAll,save,close);
 const canvas=document.createElement('canvas');canvas.setAttribute('aria-label','대지 주변 3D 화면');panel.append(bar,canvas);host.append(panel);
 const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
 const scene=new THREE.Scene();scene.background=new THREE.Color('#101820');
 scene.add(new THREE.HemisphereLight(0xffffff,0x4a5058,2.2));const sun=new THREE.DirectionalLight(0xffffff,2.2);sun.position.set(-1,2,1.5);scene.add(sun);
 const group=new THREE.Group();group.name='Barun site context (metres)';scene.add(group);
 const v=(p,z)=>new THREE.Vector3(p.x/1000,z,-p.y/1000);
 const addLine=(points,color,closed)=>{const ps=points.map(p=>v(p,p.z));if(closed)ps.push(ps[0]);const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(ps),new THREE.LineBasicMaterial({color}));group.add(line);};
 for(const t of model.terrain)addLine(t.points,t.major?0xa88b62:0x6d5c47,false);
 for(const l of model.lines)addLine(l.points,l.role==='site'?0xffd479:l.role==='road'?0x91b4c9:0x7c8790,l.closed);
 const extrude=(points,z,height,color,opacity=1)=>{const shape=new THREE.Shape(points.map(p=>new THREE.Vector2(p.x/1000,p.y/1000)));const geo=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false});geo.rotateX(-Math.PI/2);geo.translate(0,z,0);
  const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color,roughness:.85,transparent:opacity<1,opacity}));group.add(mesh);const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geo),new THREE.LineBasicMaterial({color:0x2a3640}));group.add(edges);return mesh;};
 const masses=model.buildings.map(b=>[b,extrude(b.points,b.z,b.height,BUILDING_COLORS.basic.of(b))]);
 colorPick.onchange=()=>{const of=BUILDING_COLORS[colorPick.value].of;for(const [b,mesh] of masses)mesh.material.color.set(of(b));showLegend(colorPick.value);};
 // 바닥: 등고선 표고 격자로 땅 면을 만들고 그 위에 도판 그림을 입힌다(도판과 같은 원·같은 좌표).
 const H=am?am.R*1.06:0,tg=am&&model.hasTerrain?terrainGrid(am.contours,H,120):null;
 let ground=null;
 const setGround=async key=>{
  if(ground){group.remove(ground);ground.geometry.dispose();ground.material.map?.dispose();ground.material.dispose();ground=null;}
  if(!key||!tg)return;
  const png=await svgToPngDataUrl(diagramSVG(am,key,{size:1024}),1024);
  const M=tg.M,geo=new THREE.PlaneGeometry(2*H*(M-1)/M,2*H*(M-1)/M,M-1,M-1);geo.rotateX(-Math.PI/2);
  const pos=geo.attributes.position;for(let k=0;k<pos.count;k++){const v=tg.z[k];pos.setY(k,(v===v?v:model.base)-model.base-.3);}   // 건물 밑이 뜨지 않게 0.3m 낮춤
  geo.translate(am.center.x/1000,0,-am.center.y/1000);geo.computeVertexNormals();
  const tex=new THREE.TextureLoader().load(png);tex.colorSpace=THREE.SRGBColorSpace;
  ground=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({map:tex,roughness:1,transparent:true,alphaTest:.5}));ground.name='대지분석 바닥';group.add(ground);
 };
 groundPick.onchange=()=>setGround(groundPick.value).catch(e=>toast('바닥 그림을 만들지 못했습니다: '+e.message));
 for(const m of model.plan)extrude(m.points,m.z,m.height,0x9dcbe0,.92);
 const box=new THREE.Box3().setFromObject(group),center=box.getCenter(new THREE.Vector3()),span=Math.max(20,box.getSize(new THREE.Vector3()).length()*.6);
 const camera=new THREE.PerspectiveCamera(45,1,.1,span*40);
 const orbit=new OrbitControls(camera,canvas);orbit.enableDamping=true;
 // 남동쪽 위에서 내려다본다(남쪽 건물에 덜 가림). 대지로 = 대지 둘레 약 60m(곁의 초고층 위에서 보이게 높이 150m 쯤에서), 전체 = 장면 전체.
 const look=(target,s,steep=false)=>{orbit.target.copy(target);camera.position.copy(target).add(steep?new THREE.Vector3(s*.45,s,s*.6):new THREE.Vector3(s*.7,s*.6,s*.8));orbit.update();};
 const f=focusPoint(model),site=f?new THREE.Vector3(f.x,f.y,f.z):center;
 const toSiteView=()=>f?look(site,150,true):look(center,span);
 toSite.onclick=toSiteView;toAll.onclick=()=>look(center,span);toSite.disabled=!f;
 toSiteView();
 let frame=0,open=true;
 const resize=()=>{const w=Math.max(1,panel.clientWidth),h=Math.max(1,panel.clientHeight-bar.offsetHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();};
 const observer=new ResizeObserver(resize);observer.observe(panel);resize();
 const tick=()=>{if(!open)return;orbit.update();renderer.render(scene,camera);frame=requestAnimationFrame(tick);};tick();
 const dispose=()=>{open=false;cancelAnimationFrame(frame);observer.disconnect();orbit.dispose();group.traverse(o=>{o.geometry?.dispose();o.material?.dispose?.();});renderer.dispose();panel.remove();window.removeEventListener('keydown',onKey,true);};
 const onKey=e=>{if(e.key==='Escape'){e.stopImmediatePropagation();e.preventDefault();dispose();}};window.addEventListener('keydown',onKey,true);   // 앱의 Esc(명령 취소)보다 먼저 받는다
 close.onclick=dispose;
 save.onclick=()=>new GLTFExporter().parse(group,result=>{download(result,'대지주변_3D.glb','model/gltf-binary');toast('GLB로 저장했습니다(단위 m).');},error=>toast('GLB 저장 실패: '+error.message),{binary:true});
 close.focus();
 return {close:dispose};
}
