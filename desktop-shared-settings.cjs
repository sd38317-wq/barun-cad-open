/* 도면 칸마다 프로세스: 도면 칸마다 저장 공간이 따로라 설정(localStorage)이 갈라진다.
   앱 본체가 공용 설정을 한 파일로 들고, 칸이 열릴 때 나눠 주고, 한 칸에서 바뀌면 나머지 칸에 알린다.
   창마다 따로여야 하는 것(복구본·세션·정상 종료 표시·성능 기록·패드 연결)은 나누지 않는다.
   desktop-preload.cjs 는 샌드박스라 이 모듈을 못 불러온다 — PER_WINDOW 를 거기에도 같은 글자로 둔다(시험이 맞는지 본다). */
const fs=require('node:fs');

const PER_WINDOW=/^(barun-cad-recovery|barun-cad-workspace-rev|barun-cad-clean-exit|barun-cad-session|barun-drawing-performance)/;   // 현장 패드 링크 목록(barun-pad-sessions)은 창끼리 같이 쓴다(B4)
const MAX_KEY=200;

function createSharedSettings({file,log=()=>{},fsImpl=fs,delayMs=500}){
 let values=null,timer=null;
 try{const parsed=JSON.parse(fsImpl.readFileSync(file,'utf8'));if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))values=parsed;}catch{}
 const write=()=>{timer=null;try{fsImpl.writeFileSync(file+'.tmp',JSON.stringify(values));fsImpl.renameSync(file+'.tmp',file);}catch(error){log('shared settings save failed '+(error?.message||error));}};
 const save=()=>{if(timer)clearTimeout(timer);timer=setTimeout(write,delayMs);};
 const valid=(key,value)=>typeof key==='string'&&key.length>0&&key.length<=MAX_KEY&&!PER_WINDOW.test(key)&&(value===null||typeof value==='string');
 return {
  // 처음 켤 때(파일 없음)는 1번 칸(기존 사용자 설정이 든 기본 세션)에만 null 을 줘서 그 칸의 설정으로 채우게 한다.
  snapshot:({seeding=false}={})=>values===null?(seeding?null:{}):{...values},
  seed(input){
   if(values!==null)return false;
   values={};
   for(const [key,value] of Object.entries(input||{}))if(valid(key,value)&&value!==null)values[key]=value;
   save();return true;
  },
  // 바뀌었으면 true(다른 칸에 알릴 것).
  set(key,value){
   if(!valid(key,value))return false;
   if(values===null)values={};
   if(value===null){if(!Object.prototype.hasOwnProperty.call(values,key))return false;delete values[key];}
   else{if(values[key]===value)return false;values[key]=value;}
   save();return true;
  },
  flush(){if(timer){clearTimeout(timer);write();}},
 };
}

module.exports={createSharedSettings,PER_WINDOW};
