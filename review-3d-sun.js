// 3D 검토 화면 아래 일조 띠: [동지|춘·추분|하지] 시각 ─○─ ▶ [일조 확보] [이미지 저장]. 꼭 필요한 것만 둔다(사용자 2026-10-16).
// 그림자는 화면과 같은 three.js 그림자. 일조 확보는 그 그림자를 08~16시 10분 간격(49번)으로 위에서 찍어 바닥 칸마다 판정한다.
import * as THREE from './three.module.js';
import {runModelWork,modelWorkYield,modelWorkAbort} from './model-work.js';
import {sunPosition,siteOf,gridAzimuth,sampleTimes,sunlightVerdict,summarizeSunlight,KEY_DAYS,SUN_RULE,clock,sunRuleText} from './sun-study.js';

const GRID=128,ANALYSIS_LAYER=5,SHOT_HOURS=[9,10,11,12,13,14,15];
const SUN_GRID_RUNNING=new WeakSet();
export function sunGridRunning(renderer){return SUN_GRID_RUNNING.has(renderer);}

const COLORS={ok:[86,200,130,150],some:[240,180,60,150],none:[230,84,70,150]};

export function installSunStrip({panel,engine,toast,download,get,applySun,renderOnce,waitEnabled=()=>true}){
  const strip=document.createElement('div');strip.className='review-sun';
  strip.style.cssText='width:max-content;padding:8px 10px;background:#25292f;border:1px solid #383f48;border-radius:8px';
  strip.innerHTML='<span class="rs-days" role="radiogroup" aria-label="기준일"></span>'+
   '<label class="rs-time"><input class="rs-slider" type="range" min="360" max="1140" step="10" value="720" aria-label="시각"><output class="rs-clock">12:00</output></label>'+
   '<button type="button" class="rs-play" title="하루 그림자 움직임 재생">▶</button>'+
   '<button type="button" class="rs-grid" aria-pressed="false" title="'+SUN_RULE.text+' — 바닥 칸마다 색으로">일조 확보</button>'+
   '<button type="button" class="rs-shot" title="09~15시 한 시간 간격 그림자를 한 장 PNG 로(근거 문구 포함)">이미지 저장</button>'+
   '<span class="rs-info" role="status"></span>';
  panel.append(strip);
  const $=s=>strip.querySelector(s);let dayKey='winter',playing=0,overlay=null,lastSummary=null,calculation=null;
  const progress=document.createElement('progress');progress.hidden=true;progress.max=49;progress.setAttribute('aria-label','일조 시각 계산');progress.style.cssText='width:96px;accent-color:#9dcbe0';strip.insertBefore(progress,$('.rs-info'));
  $('.rs-info').style.fontSize='12px';
  for(const d of KEY_DAYS){const b=document.createElement('button');b.type='button';b.textContent=d.label;b.dataset.day=d.key;b.setAttribute('role','radio');b.onclick=()=>{dayKey=d.key;clearOverlay();update();};$('.rs-days').append(b);}
  const day=()=>{const d=KEY_DAYS.find(k=>k.key===dayKey);return {year:new Date().getFullYear(),month:d.month,day:d.day,label:d.label};};
  const site=()=>{const c=get().center;return siteOf(engine.doc,{x:c.x*1000,y:-c.z*1000});};
  const at=minutes=>{const s=site(),p=sunPosition({...day(),hour:Math.floor(minutes/60),minute:minutes%60},s);return {altitude:p.altitude,azimuth:gridAzimuth(p.azimuth,s),site:s};};
  /** review-3d 의 lighting() 이 부른다: 지금 띠의 날짜·시각 태양(도북 기준 방위). */
  const current=()=>at(Number($('.rs-slider').value));
  function update(){
    const minutes=Number($('.rs-slider').value),sun=current();
    $('.rs-clock').textContent=clock(minutes);
    for(const b of $('.rs-days').children)b.setAttribute('aria-checked',String(b.dataset.day===dayKey));
    $('.rs-info').textContent=`${day().label} ${clock(minutes)} · 고도 ${sun.altitude.toFixed(1)}° 방위 ${sun.azimuth.toFixed(0)}°`+(lastSummary?` · 일조 확보 ${Math.round(lastSummary.ratio*100)}%`:'');
    $('.rs-info').title=`${sun.site.source} · 위도 ${sun.site.lat.toFixed(4)}° 경도 ${sun.site.lon.toFixed(4)}° · 태양 위치: NOAA 식(균시차·한국 표준시), 방위는 도면 위쪽(도북) 기준`;
    applySun();
  }
  $('.rs-slider').oninput=update;
  $('.rs-play').onclick=()=>{
    if(playing){cancelAnimationFrame(playing);playing=0;$('.rs-play').textContent='▶';return;}
    const slider=$('.rs-slider');if(Number(slider.value)>=Number(slider.max))slider.value=slider.min;
    let last=performance.now(),minutes=Number(slider.value);$('.rs-play').textContent='⏸';
    // 1초 = 90분. 분은 실수로 쌓고 슬라이더만 10분 단위로(매 프레임 반올림하면 60Hz 에서 멈춘다)
    const step=now=>{if(document.hidden||panel.hidden){stopPlay();return;}minutes=Math.min(Number(slider.max),minutes+(now-last)/1000*90);last=now;const shown=String(Math.floor(minutes/10)*10);if(slider.value!==shown){slider.value=shown;update();}
      if(minutes>=Number(slider.max)){playing=0;$('.rs-play').textContent='▶';return;}playing=requestAnimationFrame(step);};
    playing=requestAnimationFrame(step);
  };

  function clearOverlay(){calculation?.abort();delete strip.lastGrid;const {scene}=get();if(overlay){scene?.remove(overlay);overlay.geometry.dispose();overlay.material.map.dispose();overlay.material.dispose();overlay=null;}lastSummary=null;$('.rs-grid').setAttribute('aria-pressed','false');}
  $('.rs-grid').onclick=async()=>{
    if(calculation){calculation.abort();return;}
    if(overlay){clearOverlay();update();return;}
    const showWait=waitEnabled(),controller=new AbortController(),keep=$('.rs-slider').value,started=performance.now();let errorMessage='';calculation=controller;stopPlay();
    const controls=[...$('.rs-days').children,$('.rs-slider'),$('.rs-play'),$('.rs-shot')];controls.forEach(el=>el.disabled=true);
    $('.rs-grid').textContent='계산 취소';progress.hidden=!showWait;progress.value=0;$('.rs-info').textContent='일조 확보 · 바닥 칸 준비';
    try{
      const {renderer,scene,sun,center,span,group}=get();if(!renderer||!scene)throw Error('3D 모델을 먼저 여세요.');
      const r=await computeSunGridAsync({renderer,scene,sun,center,span,group,at,applySun,signal:controller.signal,onProgress:showWait?p=>{
        if(controller.signal.aborted||document.hidden||panel.hidden)return;
        progress.value=p.index;
        $('.rs-info').textContent=p.kind==='sun-summary'?'일조 확보 · 49/49 시각 완료 · 바닥 칸 집계 중':
          day().label+' '+clock(p.minutes)+' · '+p.index+'/'+p.total+' 시각 계산';
        // 실제 계산 시각을 표시한다. 무거운 3D 그림자는 결과에서 한 번 그린다.
        if(p.kind==='sun-grid'&&showWait&&!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
          $('.rs-slider').value=String(p.minutes);$('.rs-clock').textContent=clock(p.minutes);applySun();
        }
      }:undefined});
      modelWorkAbort(controller.signal);overlay=sunGridOverlay(r);scene.add(overlay);
      lastSummary=r.summary;strip.lastGrid={grid:GRID,side:r.side,center:{x:r.center.x,z:r.center.z},cells:r.cells};$('.rs-grid').setAttribute('aria-pressed','true');
      toast(day().label+' 일조 확보: 바닥 칸 '+Math.round(r.summary.ratio*100)+'% 충족 — 초록 기준 충족 · 주황 2시간 이상 · 빨강 2시간 미만 ('+sunRuleText(day().label)+', '+Math.round(performance.now()-started)+'ms)');
    }catch(e){if(e.name!=='AbortError'){errorMessage='일조 확보 계산 실패: '+e.message;toast(errorMessage,true);}}
    finally{
      if(calculation===controller){calculation=null;$('.rs-slider').value=keep;controls.forEach(el=>el.disabled=false);$('.rs-grid').textContent='일조 확보';progress.hidden=true;update();if(errorMessage)$('.rs-info').textContent=errorMessage;if(!document.hidden&&!panel.hidden)renderOnce();}
    }
  };
  $('.rs-shot').onclick=async()=>{
    try{
      const {renderer}=get();if(!renderer)throw Error('3D 모델을 먼저 여세요.');
      const keep=$('.rs-slider').value,overlayShown=overlay?.visible,sheet=document.createElement('canvas');try{
      const src=renderer.domElement,w=480,h=Math.round(w*src.height/Math.max(1,src.width)),cols=4;
      sheet.width=cols*w;sheet.height=2*(h+28)+70;const g=sheet.getContext('2d');g.fillStyle='#ffffff';g.fillRect(0,0,sheet.width,sheet.height);g.font='16px sans-serif';g.fillStyle='#14202a';
      // 시간별 7장은 일조 확보 색칠을 잠시 끄고(그림자가 보이게), 비어 있는 8번째 칸에 하루 합계 색칠을 넣는다.
      const cell=(i,label)=>{const x=(i%cols)*w,y=Math.floor(i/cols)*(h+28);g.drawImage(src,x,y+28,w,h);g.fillText(label,x+8,y+20);};
      if(overlay)overlay.visible=false;
      SHOT_HOURS.forEach((hour,i)=>{$('.rs-slider').value=String(hour*60);update();renderOnce();const s=current();cell(i,`${day().label} ${pad(hour)}:00 · 고도 ${s.altitude.toFixed(1)}° 방위 ${s.azimuth.toFixed(0)}°`);});
      if(overlay){overlay.visible=true;renderOnce();cell(SHOT_HOURS.length,`일조 확보(하루) ${Math.round(lastSummary.ratio*100)}% · 초록 충족·주황 2h↑·빨강 미달`);}
      const s=current().site,lines=[`${s.source} · 위도 ${s.lat.toFixed(4)}° 경도 ${s.lon.toFixed(4)}° · 방위는 도면 위쪽(도북) 기준`,
        '태양 위치: NOAA 태양 위치식(균시차·한국 표준시) · 그림자: 3D 모델 그대로(주변 건물은 모델에 있을 때만)',
        `일조 기준(참고): ${sunRuleText(day().label)}${lastSummary?` · 바닥 칸 충족 ${Math.round(lastSummary.ratio*100)}%`:''} · 건축법 정북 사선 판정과는 별개`];
      g.font='13px sans-serif';lines.forEach((t,i)=>g.fillText(t,10,2*(h+28)+20+i*18));
      }finally{$('.rs-slider').value=keep;if(overlay)overlay.visible=overlayShown??true;update();}   // 실패해도 시각·색칠을 되돌린다
      const blob=await new Promise(r=>sheet.toBlob(r,'image/png'));download(blob,`바른CAD_일조_${day().label.replace('·','')}.png`,'image/png');
    }catch(e){toast('일조 이미지 저장 실패: '+e.message,true);}
  };
  const pad=n=>String(n).padStart(2,'0');
  update();
  function stopPlay(){if(playing){cancelAnimationFrame(playing);playing=0;$('.rs-play').textContent='▶';}}
  const stop=()=>{stopPlay();calculation?.abort();};
  return {current,update,reset:clearOverlay,stop};
}

/** 바닥 칸마다 시각별 햇빛 여부를 GPU 그림자에서 읽는다(08~16시 10분 간격). 건물 아래 칸은 빼고 센다.
 *  3D 화면의 일조 띠와 AI 도구(cad_sun_study)가 같이 쓴다. at(분) = {altitude, azimuth}, applySun(s, 범위배율) = 태양 놓기, applySun() = 원래대로. */
export function computeSunGrid(options){
  const work=sunGridWork(options);let step;
  try{do{step=work.next();if(!step.done)options.onProgress?.(step.value);}while(!step.done);return step.value;}finally{work.return();}
}
/** 실제 계산을 12ms씩 양보한다. 숨은 창에서는 화면 갱신 없이 끝까지 계산한다. */
export async function computeSunGridAsync(options){
  const {onProgress,signal,yieldFrame=modelWorkYield,budgetMs=12,batchSize=Infinity,fastTaskMs=50}=options;
  SUN_GRID_RUNNING.add(options.renderer);
  try{return await runModelWork(sunGridWork(options),{onProgress,signal,yieldFrame,budgetMs,batchSize,fastTaskMs});}
  finally{SUN_GRID_RUNNING.delete(options.renderer);}
}
function* sunGridWork({renderer,scene,sun,center,span,group,at,applySun}){
  const side=span*1.6,cam=new THREE.OrthographicCamera(-side/2,side/2,side/2,-side/2,.1,span*12);
  cam.position.set(center.x,span*5,center.z);cam.up.set(0,0,-1);cam.lookAt(center.x,0,center.z);cam.layers.set(ANALYSIS_LAYER);cam.layers.enable(0);
  const plane=new THREE.Mesh(new THREE.PlaneGeometry(side,side),new THREE.ShadowMaterial({opacity:1,color:0x000000}));
  plane.rotation.x=-Math.PI/2;plane.position.set(center.x,.005,center.z);plane.receiveShadow=true;plane.layers.set(ANALYSIS_LAYER);
  const target=new THREE.WebGLRenderTarget(GRID,GRID),buf=new Uint8Array(GRID*GRID*4),maskMaterial=new THREE.MeshBasicMaterial({color:0x000000});
  const times=sampleTimes(),lit=times.map(()=>new Uint8Array(GRID*GRID)),mask=new Uint8Array(GRID*GRID);
  // 분석 전용 상태는 매 시각 안에서만 사용한다. 프레임 사이의 3D 화면은 원래 장면이다.
  const sample=(isMask,s)=>{
    const shown=scene.children.map(o=>[o,o.visible]),background=scene.background,material=scene.overrideMaterial,layerMask=sun.layers.mask;
    const previousTarget=renderer.getRenderTarget?.()??null;
    try{
      scene.add(plane);scene.background=new THREE.Color(0xffffff);sun.layers.enable(ANALYSIS_LAYER);
      for(const [o] of shown)o.visible=o===group||o.isLight||o===sun.target;
      plane.visible=!isMask;scene.overrideMaterial=isMask?maskMaterial:null;
      if(s)applySun(s,1.25);
      renderer.setRenderTarget(target);renderer.render(scene,cam);renderer.readRenderTargetPixels(target,0,0,GRID,GRID,buf);
    }finally{
      for(const [o,v] of shown)o.visible=v;
      renderer.setRenderTarget(previousTarget);scene.overrideMaterial=material;scene.background=background;sun.layers.mask=layerMask;scene.remove(plane);applySun();
    }
  };
  try{
    sample(true);for(let i=0;i<GRID*GRID;i++)mask[i]=buf[i*4]<128?1:0;
    yield {kind:'sun-grid',index:0,total:times.length,minutes:times[0]};
    for(let k=0;k<times.length;k++){
      const t=times[k],s=at(t);
      if(s.altitude>0){sample(false,s);const row=lit[k];for(let i=0;i<GRID*GRID;i++)row[i]=buf[i*4]>128?1:0;}
      yield {kind:'sun-grid',index:k+1,total:times.length,minutes:t};
    }
    const cells=new Array(GRID*GRID),color=new Uint8Array(GRID*GRID*4);let sliceStart=performance.now();
    for(let i=0;i<GRID*GRID;i++){
      if(!mask[i]){const v=sunlightVerdict(times.map((_,k)=>lit[k][i]));cells[i]=v;color.set(v.ok?COLORS.ok:v.total>=120?COLORS.some:COLORS.none,i*4);}else cells[i]=null;
      // 칸 판정도 나눈다. 49/49 뒤에는 비율을 더하지 않고 집계 중으로 표시한다.
      if((i+1)%1024===0&&performance.now()-sliceStart>=12){yield {kind:'sun-summary',index:times.length,total:times.length,minutes:times[times.length-1]};sliceStart=performance.now();}
    }
    return {grid:GRID,side,center:center.clone(),cells,color,summary:summarizeSunlight(cells)};
  }finally{plane.geometry.dispose();plane.material.dispose();maskMaterial.dispose();target.dispose();}
}
/** 칸 판정 결과를 바닥에 까는 색칠판. */
export function sunGridOverlay(r){
  const tex=new THREE.DataTexture(r.color,GRID,GRID,THREE.RGBAFormat);tex.needsUpdate=true;tex.magFilter=THREE.NearestFilter;
  const overlay=new THREE.Mesh(new THREE.PlaneGeometry(r.side,r.side),new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false}));
  overlay.rotation.x=-Math.PI/2;overlay.position.set(r.center.x,.02,r.center.z);overlay.renderOrder=1;return overlay;
}
/** 이웃 필지(설계 mm 닫힌 고리)마다 계산 칸이 몇 개 들어가고 그중 동지 기준을 채운 비율·가장 짧은 일조 시간(일조 보고서 2026-10-30). 계산판 밖 필지는 cells 0. */
export function sunByParcel(r,parcels){
  const cell=r.side/r.grid,x0=r.center.x-r.side/2,z0=r.center.z+r.side/2,inside=(p,ring)=>{let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>p[1])!==(yj>p[1])&&p[0]<(xj-xi)*(p[1]-yi)/(yj-yi)+xi)c=!c;}return c;};
  return parcels.map(({coords,jibun})=>{
    const ring=coords.map(p=>Array.isArray(p)?p:[p.x,p.y]);let cells=0,ok=0,cont=Infinity,total=Infinity;
    for(let i=0;i<r.cells.length;i++){const c=r.cells[i];if(!c)continue;const col=i%r.grid,row=Math.floor(i/r.grid),pt=[(x0+(col+.5)*cell)*1000,-(z0-(row+.5)*cell)*1000];
      if(!inside(pt,ring))continue;cells++;if(c.ok)ok++;cont=Math.min(cont,c.continuous);total=Math.min(total,c.total);}
    return {jibun:jibun||'',cells,okRatio:cells?Number((ok/cells).toFixed(3)):null,minContinuousMin:cells?cont:null,minTotalMin:cells?total:null};
  });
}
/** 기준 미달 칸 중 서로 떨어진 몇 곳(도면 mm) — AI 가 "어디가 부족한가"를 말할 수 있게. */
export function sunWorstSpots(r,count=5){
  const cell=r.side/r.grid,x0=r.center.x-r.side/2,z0=r.center.z+r.side/2,picked=[];
  const failing=r.cells.map((c,i)=>c&&!c.ok?{i,c}:null).filter(Boolean).sort((a,b)=>a.c.total-b.c.total||a.c.continuous-b.c.continuous);
  for(const {i,c} of failing){
    const col=i%r.grid,row=Math.floor(i/r.grid),x=(x0+(col+.5)*cell)*1000,y=-(z0-(row+.5)*cell)*1000;
    if(picked.every(p=>Math.hypot(p.x-x,p.y-y)>=r.side*1000/6))picked.push({x:Math.round(x),y:Math.round(y),continuousMin:c.continuous,totalMin:c.total});
    if(picked.length>=count)break;
  }
  return picked;
}
