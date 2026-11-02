// Loaded with review-3d.js only. No work is performed until the option is used.
import * as THREE from './three.module.js';
import {buildLawModel} from './review-3d-law-geometry.js';

export function installLawOverlay({engine,controls,getScene,isActive,toast,onModel=()=>{},check=doc=>globalThis.cadLiveCheck?.check(doc)}){
 const label=document.createElement('label'),toggle=document.createElement('input');
 toggle.type='checkbox';toggle.className='r-law';label.append(toggle,document.createTextNode('한계면 보기'));
 const heightLabel=document.createElement('label'),height=document.createElement('input');
 height.type='number';height.min='1';height.placeholder='기준 없음';height.className='r-law-height';
 heightLabel.append(document.createTextNode('높이 제한 (mm)'),height);
 const refresh=document.createElement('button');refresh.type='button';refresh.textContent='다시 계산';
 const status=document.createElement('span');status.className='r-law-status';status.setAttribute('role','status');
 // 도구줄에는 '법규 한계면' 메뉴 하나만 둔다. 상태 글자는 도구줄 아래 줄로 간다(CSS).
 const menu=document.createElement('details'),summary=document.createElement('summary'),box=document.createElement('div');menu.className='r-law-menu';box.className='review-menu';
 summary.textContent='법규 한계면';summary.title='건축선·사선·높이 제한 한계면을 3D로 봅니다';box.append(label,heightLabel,refresh);menu.append(summary,box);
 controls.append(menu,status);
 let group=null,revision=0,job=0,dirty=true,docRef=null;
 const clear=()=>{if(!group)return;group.removeFromParent();group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});group=null;};
 function addFaces(target,faces,color,opacity){
  const positions=[];
  for(const face of faces)for(let i=1;i<face.length-1;i++)for(const p of [face[0],face[i],face[i+1]])positions.push(p.x/1000,p.z/1000,-p.y/1000);
  if(!positions.length)return;
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();
  const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity,side:THREE.DoubleSide,depthWrite:false});
  target.add(new THREE.Mesh(geometry,material));
 }
 async function update(){
  if(!toggle.checked||!isActive())return;
  const scene=getScene();if(!scene)return;
  const ticket=++job,version=revision,doc=engine.doc;clear();status.textContent='법규 한계면 계산 중…';
  try{
   const result=await check(doc);
   if(ticket!==job||version!==revision||doc!==engine.doc||!toggle.checked||!isActive())return;
   if(result&&!result.active)throw Error(result.status||'대지 기준을 확인하세요.');
   const cap=doc.siteAnalysis?.heightLimit;height.value=cap??'';
   if(cap!==undefined&&(!Number.isFinite(cap)||cap<=0))throw Error('높이 제한은 양수로 입력하세요.');
   const model=buildLawModel(doc);
   group=new THREE.Group();group.name='법규 한계면 · 개략 검토';
   const faces={safe:[],tolerance:[],violation:[],unknown:[]};let violation=0,tolerated=0;
   for(const mass of model.masses)for(const part of mass.parts){faces[part.status].push(...part.faces);if(part.status==='violation')violation+=part.volumeM3;if(part.status==='tolerance')tolerated+=part.volumeM3;}
   addFaces(group,faces.safe,0x85c6d7,.28);addFaces(group,faces.tolerance,0xff9c32,.65);addFaces(group,faces.violation,0xff4545,.75);
   addFaces(group,faces.unknown,0x969fa8,.3);
   for(const kind of ['north','height'])addFaces(group,model.limits.filter(l=>l.kind===kind).flatMap(l=>l.faces),kind==='north'?0x739fff:0xc2a1ed,.22);
   scene.add(group);onModel(group);dirty=false;
   status.textContent=`위반 ${violation.toFixed(2)}㎥ · 허용오차 안 ${tolerated.toFixed(2)}㎥ · 빨강=위반 · 주황=허용오차 안${cap===undefined?' · 높이 제한 기준 없음':''}${model.warnings.length?' · '+model.warnings.join(' · '):''} · 입력 기준 개략 검토`;
  }catch(error){if(ticket===job){clear();dirty=true;status.textContent=error.message;toast(error.message,true);}}
 }
 toggle.onchange=()=>{job++;if(toggle.checked){dirty=true;update();}else{clear();status.textContent='';}};
 refresh.onclick=()=>{toggle.checked=true;dirty=true;update();};
 height.onchange=()=>{
  try{
   if(!engine.doc.siteAnalysis)throw Error('높이 제한을 저장하려면 먼저 대지 기준을 설정하세요.');
   const value=height.value.trim(),cap=Number(value);
   if(value&&(!Number.isFinite(cap)||cap<=0))throw Error('높이 제한은 양수로 입력하세요.');
   const analysis={...engine.doc.siteAnalysis};if(value)analysis.heightLimit=cap;else delete analysis.heightLimit;
   engine.execute({type:'site.analyze',analysis});dirty=true;if(toggle.checked)update();
  }catch(error){status.textContent=error.message;toast(error.message,true);}
 };
 return {
  open(){if(docRef!==engine.doc){docRef=engine.doc;height.value=engine.doc.siteAnalysis?.heightLimit??'';dirty=true;}if(toggle.checked&&dirty)update();else if(group)group.visible=true;},
  close(){job++;if(group)group.visible=false;},
  invalidate(){revision++;job++;dirty=true;height.value=engine.doc.siteAnalysis?.heightLimit??'';if(group)group.visible=false;if(toggle.checked)status.textContent='도면 변경됨 · 한계면 갱신 필요';}
 };
}
