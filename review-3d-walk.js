// 내부 투시도: 평면에서 찍은 자리의 눈높이(층 바닥 + 1.5 m)로 들어가 둘러본다. 단추는 3D 줄의 [내부 보기]/[밖으로] 하나.
// 안에서: 끌기 = 둘러보기, W·A·S·D / 방향키 = 걷기(Shift 빠르게), 휠 = 앞뒤, PgUp·PgDn = 위·아래층, Esc = 밖으로.
// 벽을 통과하지 못하게 막지는 않는다(설계 검토용 시점 이동).
import * as THREE from './three.module.js';

export const EYE_HEIGHT=1.5,WALK_SPEED=1.4,INTERIOR_FOV=60;

/** 찍은 점(도면 mm)과 층 바닥 높이(m)로 카메라 자리·바라볼 방향을 정한다. 모델 가운데를 보게 하되, 가운데에 서 있으면 북쪽(도면 위). */
export function eyeFromPlan(point,levelM,center){
  const x=point.x/1000,z=-point.y/1000,dx=center.x-x,dz=center.z-z;
  const yaw=Math.hypot(dx,dz)<1?0:Math.atan2(-dx,-dz);   // yaw 0 = -z(북쪽)를 본다
  return {position:{x,y:levelM+EYE_HEIGHT,z},yaw,pitch:0};
}
/** 바라보는 방향(yaw·pitch)의 단위 벡터. */
export function lookVector(yaw,pitch){return {x:-Math.sin(yaw)*Math.cos(pitch),y:Math.sin(pitch),z:-Math.cos(yaw)*Math.cos(pitch)};}
/** 눌린 키로 한 걸음(수평면). forward·right 는 -1·0·1. */
export function stepVector(yaw,forward,right,distance){
  const fx=-Math.sin(yaw),fz=-Math.cos(yaw),rx=Math.cos(yaw),rz=-Math.sin(yaw),len=Math.hypot(forward,right)||1;
  return {x:(fx*forward+rx*right)/len*distance,z:(fz*forward+rz*right)/len*distance};
}
/** 가장 가까운 위·아래층 바닥(m). levels 는 오름차순. */
export function nextLevel(levels,current,direction){
  const list=levels.length?levels:[0];
  if(direction>0)return list.find(v=>v>current+.01)??current;
  return [...list].reverse().find(v=>v<current-.01)??current;
}

const KEYS={KeyW:[1,0],ArrowUp:[1,0],KeyS:[-1,0],ArrowDown:[-1,0],KeyA:[0,-1],ArrowLeft:[0,-1],KeyD:[0,1],ArrowRight:[0,1]};

export function installWalk({canvas,button,status,get,pickPlanPoint,reopen,toast,onEnter=()=>{}}){
  let active=false,yaw=0,pitch=0,level=0,saved=null,frame=0,last=0,drag=null;const held=new Set();
  const apply=()=>{const {camera}=get(),v=lookVector(yaw,pitch);camera.lookAt(camera.position.x+v.x,camera.position.y+v.y,camera.position.z+v.z);};
  const hint=()=>{status.textContent=`내부 · 바닥 ${level.toFixed(1)} m + 눈높이 ${EYE_HEIGHT} m · 끌기 둘러보기 · W A S D 걷기 · PgUp/PgDn 층 · Esc 밖으로`;};
  function loop(now){
    if(!active)return;const dt=Math.min(.1,(now-last)/1000);last=now;
    let f=0,r=0;for(const k of held){const m=KEYS[k];if(m){f+=m[0];r+=m[1];}}
    if(f||r){const {camera}=get(),s=stepVector(yaw,Math.sign(f),Math.sign(r),WALK_SPEED*(held.has('ShiftLeft')||held.has('ShiftRight')?3:1)*dt);camera.position.x+=s.x;camera.position.z+=s.z;apply();}
    frame=requestAnimationFrame(loop);
  }
  function enterAt(point){
    const {camera,orbit,center,levels,spot}=get(),at=spot?.(point);   // 설계 묶음 평면 칸이면 모델 좌표·그 층으로
    level=at?.level??(levels?.length?levels[0]:0);   // 칸 층을 모르면 맨 아래층
    const eye=eyeFromPlan(at?.point||point,level,center);
    onEnter();
    if(!active)saved={position:camera.position.clone(),target:orbit.target.clone(),fov:camera.fov,near:camera.near};
    active=true;orbit.enabled=false;camera.fov=INTERIOR_FOV;camera.near=.05;camera.updateProjectionMatrix();
    camera.position.set(eye.position.x,eye.position.y,eye.position.z);yaw=eye.yaw;pitch=0;apply();
    button.textContent='밖으로';button.setAttribute('aria-pressed','true');hint();canvas.focus();
    cancelAnimationFrame(frame);last=performance.now();frame=requestAnimationFrame(loop);
  }
  function exit(){
    if(!active)return;active=false;cancelAnimationFrame(frame);held.clear();drag=null;
    const {camera,orbit}=get();
    if(saved){camera.position.copy(saved.position);camera.fov=saved.fov;camera.near=saved.near;camera.updateProjectionMatrix();orbit.target.copy(saved.target);}
    orbit.enabled=true;orbit.update();button.textContent='내부 보기';button.setAttribute('aria-pressed','false');status.textContent='';
  }
  /** 평면에서 점을 받아 들어간다(3D 를 잠시 닫고 평면에서 찍는다). */
  async function start(){
    const wasOpen=!!get().open;exit();
    const point=await pickPlanPoint('내부 투시도 · 들어갈 자리를 평면에서 찍으세요 · Esc 취소');
    if(point){reopen();enterAt(point);}
    else if(wasOpen)reopen();   // 3D 에서 시작했다가 취소하면 3D 로, 평면에서 시작했으면 평면 그대로
  }
  button.onclick=()=>active?exit():start();
  canvas.addEventListener('pointerdown',e=>{if(!active)return;drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture?.(e.pointerId);});
  // 끌기는 거리뷰처럼 '화면을 잡아 끈다'(오른쪽으로 끌면 왼쪽을 본다)
  canvas.addEventListener('pointermove',e=>{if(!active||!drag)return;yaw+=(e.clientX-drag.x)*.004;pitch=Math.max(-1.4,Math.min(1.4,pitch+(e.clientY-drag.y)*.004));drag={x:e.clientX,y:e.clientY};apply();});
  canvas.addEventListener('pointerup',()=>{drag=null;});
  canvas.addEventListener('wheel',e=>{if(!active)return;e.preventDefault();const {camera}=get(),s=stepVector(yaw,e.deltaY<0?1:-1,0,.5);camera.position.x+=s.x;camera.position.z+=s.z;apply();},{passive:false});
  // Esc 는 앱의 명령 취소가 창 단계에서 먼저 가져가므로, 들어가 있는 동안은 창 단계에서 먼저 받는다.
  window.addEventListener('keydown',e=>{if(active&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();exit();}},true);
  canvas.addEventListener('keydown',e=>{
    if(!active)return;
    if(e.code==='PageUp'||e.code==='PageDown'){const {camera,levels}=get(),to=nextLevel(levels||[0],level,e.code==='PageUp'?1:-1);if(to===level)toast(e.code==='PageUp'?'맨 위층입니다.':'맨 아래층입니다.');camera.position.y+=to-level;level=to;apply();hint();e.preventDefault();return;}
    if(KEYS[e.code]||e.code.startsWith('Shift')){held.add(e.code);e.preventDefault();}
  });
  canvas.addEventListener('keyup',e=>held.delete(e.code));
  canvas.addEventListener('blur',()=>held.clear());
  return {start,enterAt,exit,isActive:()=>active};
}
