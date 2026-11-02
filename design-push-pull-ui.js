import * as THREE from './three.module.js';
import {pushPullDesignModel} from './design-model3d.js';

export function snapPushPullDistance(distance,existing=[]){
 if(!Number.isFinite(distance))throw Error('유한한 거리(mm)를 입력하세요.');
 const nearest=[0,...existing].filter(Number.isFinite).find(value=>Math.abs(distance-value)<=5);
 return nearest??Math.round(distance/10)*10;
}
// Installed only with the 3D viewport. No document writes until pointer release.
export function installDesignPushPull({canvas,controls,engine,getGroup,getCamera,getOrbit,getSetId,preview,restore,commit}) {
 const ui=document.createElement('fieldset');
 ui.innerHTML='<legend>설계 밀고 당기기</legend><label><input class="pp-mode" type="checkbox">면 선택·끌기</label><p>지붕·바닥판 윗면 또는 외벽 바깥면을 선택하세요.</p><output class="pp-target">선택한 면 없음</output><label>이동 거리 (mm)<input class="pp-distance" type="number" step="10" value="0"></label><button class="pp-apply" type="button">설계에 반영</button><span class="pp-error" role="status"></span>';
 controls.append(ui);ui.hidden=!getSetId();
 const $=s=>ui.querySelector(s);let selected=null,drag=null,busy=false;
 const snap=d=>{
  const model=engine.doc.drawingSets?.[selected?.data.setId]?.model,story=model?.stories?.find(s=>s.id===selected?.data.target.id);
  return snapPushPullDistance(d,story?model.stories.map(s=>s.height-story.height):[]);
 };
 const error=e=>{$('.pp-error').textContent=e?.message||String(e||'');};
 function rayAt(event){const r=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((event.clientX-r.left)/r.width*2-1,1-(event.clientY-r.top)/r.height*2),getCamera());return ray;}
 function select(event){
  const hits=rayAt(event).intersectObjects(getGroup()?.children||[],true);
  for(const hit of hits.slice(0,1)){
   const data=hit.object.userData.pushPull;if(!data||data.setId!==getSetId()||!hit.face)continue;
   const face=hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
   const normal=data.target.type==='story'?new THREE.Vector3(0,1,0):new THREE.Vector3(data.normal.x,0,-data.normal.y);
   if(face.dot(normal)<.95)continue;
   return {data,point:hit.point.clone(),normal};
  }
  return null;
 }
 function reset(){drag=null;const orbit=getOrbit();if(orbit)orbit.enabled=true;}
 function invalidate({restore:restorePreview=true}={}){ui.hidden=!getSetId();if(drag&&restorePreview)restore();reset();selected=null;$('.pp-target').textContent='선택한 면 없음';$('.pp-distance').value=0;}
 async function apply(distance){
  if(busy||!selected)return;
  const base=engine.doc,setId=selected.data.setId,target=selected.data.target;
  busy=true;$('.pp-apply').disabled=true;
  try{
   if(typeof commit!=='function')throw Error('설계 반영 경로가 연결되지 않았습니다.');
   await commit({setId,target,distance:snap(distance),alreadySnapped:true,expectedDocument:base});
   error('');selected=null;$('.pp-target').textContent='선택한 면 없음';$('.pp-distance').value=0;
  }catch(e){error(e);}finally{busy=false;$('.pp-apply').disabled=false;restore();}
 }
 $('.pp-apply').onclick=()=>{const distance=Number($('.pp-distance').value);if(!Number.isFinite(distance))return error(Error('유한한 거리(mm)를 입력하세요.'));apply(distance);};
 $('.pp-mode').onchange=invalidate;
 canvas.addEventListener('pointerdown',event=>{
  if(!$('.pp-mode').checked||busy||event.button!==0)return;
  event.preventDefault();event.stopImmediatePropagation();canvas.focus();error('');
  const hit=select(event);if(!hit){selected=null;$('.pp-target').textContent='선택 가능한 윗면·외벽면을 클릭하세요.';return;}
  selected=hit;$('.pp-target').textContent=(hit.data.target.type==='story'?'층 ':'외벽 ')+hit.data.target.id;
  $('.pp-distance').value=0;
  const camera=getCamera(),r=canvas.getBoundingClientRect(),a=hit.point.clone().project(camera),b=hit.point.clone().add(hit.normal).project(camera);
  const axis={x:(b.x-a.x)*r.width/2,y:-(b.y-a.y)*r.height/2},length=axis.x**2+axis.y**2;
  if(length<4){error(Error('끌기 방향이 화면에 보이도록 시점을 돌리거나 숫자를 입력하세요.'));return;}
  drag={pointer:event.pointerId,x:event.clientX,y:event.clientY,axis,length,base:engine.doc,distance:0};
  getOrbit().enabled=false;canvas.setPointerCapture(event.pointerId);
 },true);
 canvas.addEventListener('pointermove',event=>{
  if(!drag||drag.pointer!==event.pointerId)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(engine.doc!==drag.base){invalidate({restore:false});return;}
  const d=snap(((event.clientX-drag.x)*drag.axis.x+(event.clientY-drag.y)*drag.axis.y)/drag.length*1000);
  if(d===drag.distance)return;
  try{const model=pushPullDesignModel(drag.base.drawingSets[selected.data.setId].model,selected.data.target,d,{snap:0});preview(model,selected.data.setId);drag.distance=d;$('.pp-distance').value=d;error('');}catch(e){error(e);}
 },true);
 canvas.addEventListener('pointerup',event=>{
  if(!drag||drag.pointer!==event.pointerId)return;
  event.preventDefault();event.stopImmediatePropagation();const d=drag.distance;reset();restore();if(d)apply(d);
 },true);
 canvas.addEventListener('pointercancel',()=>{if(drag){restore();reset();}},true);
 canvas.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();invalidate();}},true);
 return {invalidate,close:invalidate,syncVisibility:()=>{ui.hidden=!getSetId();}};
}
