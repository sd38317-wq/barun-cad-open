// Presentation only. These shapes never enter the CAD document or engine request.
const finite=n=>Number.isFinite(n);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export const siteWaitNumber=(n,unit='')=>finite(n)?n.toLocaleString('ko-KR',{maximumFractionDigits:1})+unit:'미확인';
export function siteWaitArea(points=[]){
 const o=points[0]||[0,0];
 return Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+(p[0]-o[0])*(q[1]-o[1])-(q[0]-o[0])*(p[1]-o[1]);},0))/2;
}
export function siteWaitModel(request){
 const parcel=(request.site?.parcel||[]).filter(p=>Array.isArray(p)&&p.length===2&&p.every(finite));
 const area=siteWaitArea(parcel),z=request.zoning||{},p=request.program||{};
 const bcr=finite(z.bcr)&&z.bcr>0?clamp(z.bcr,0,100):null;
 const footprint=bcr==null?null:area*bcr/100;
 const gfa=finite(z.far)&&z.far>0?area*z.far/100:null;
 const fixed=p.floors_search!==true&&finite(p.floors)&&p.floors>0?Math.floor(p.floors):null;
 const upper=footprint&&gfa?Math.min(gfa,fixed?footprint*fixed:Infinity):null;
 const count=upper&&footprint?Math.ceil(upper/footprint-1e-9):0;
 const floorHeight=finite(p.floor_h)&&p.floor_h>0?p.floor_h:3;
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const [x,y]of parcel){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
 const center=parcel.length?[(minX+maxX)/2,(minY+maxY)/2]:[0,0];
 const local=ring=>ring.map(([x,y])=>[x-center[0],y-center[1]]);
 const boundary=local(parcel),span=Math.max(maxX-minX,maxY-minY,1);
 // Uniform scaling visualizes an area budget, never a regulatory setback/envelope.
 const scaled=ratio=>boundary.map(([x,y])=>[x*Math.sqrt(ratio),y*Math.sqrt(ratio)]);
 const floors=Array.from({length:Math.min(count,12)},(_,i)=>scaled(Math.min(footprint,upper-i*footprint)/Math.max(area,1e-9)));
 return {area,footprint,gfa,upper,count,floorHeight,heightAssumed:!(finite(p.floor_h)&&p.floor_h>0),boundary,span,center,floors,
  neighbors:(request.site?.neighbors||[]).filter(n=>Array.isArray(n.coords)&&n.coords.every(v=>Array.isArray(v)&&v.length===2&&v.every(finite))).map(n=>({road:['도','도로'].includes(n.jimok),ring:local(n.coords)}))};
}
export function siteWaitResult(result){
 if(!result)return null;
 const c=result.contract,plan=c?.plans?.find(p=>p.plan_id===c.selected_plan?.plan_id)||c?.plans?.find(p=>p.available!==false);
 if(!plan)return result.report||null;
 const m=plan.metrics||{},toM=ring=>(ring||[]).map(([x,y])=>[x/1000,y/1000]),floors=[];
 for(const o of plan.objects||[])if(o.role==='building_outline')for(const f of o.floors||[o.floor])if(f>0&&f<=200)floors[f-1]=toM(o.geometry?.ring);
 return {numbers:{site_area:result.report?.numbers?.site_area,building_area:m.building_area_m2,gfa:m.gross_floor_area_m2,bcr:m.building_coverage_pct,far:m.floor_area_ratio_pct,floors:m.floor_count,parking_placed:m.parking_planned_count,parking_required:m.parking_required_count,floor_h:result.report?.numbers?.floor_h},
  geometry:{floors:floors.map(r=>r||[]),stalls:(plan.stalls||[]).map(s=>({rect:toM(s.geometry?.ring)}))}};
}
export function mountSiteWaitScene(canvas,initial){
 const doc=canvas.ownerDocument,win=doc.defaultView,ctx=canvas.getContext('2d');
 const backdrop=doc.createElement('canvas'),bg=backdrop.getContext('2d'),volume=doc.createElement('canvas'),vg=volume.getContext('2d');
 if(!ctx||!bg||!vg)throw Error('기다림 화면의 캔버스를 열지 못했습니다.');
 const reduced=win.matchMedia?.('(prefers-reduced-motion: reduce)');
 let model=initial,w=0,h=0,ratio=1,scale=1,ox=0,oy=0,raf=0,last=-Infinity,elapsed=0,previous=0,visible=true,paused=false,done=false,destroyed=false,mode='input',report=null,drawn=0,dirty=true;
 const project=([x,y],z=0)=>[ox+(x*.82-y*.57)*scale,oy-(x*.57+y*.82)*scale*.5-z*scale*.86];
 const path=(g,ring,z=0,dx=0,dy=0)=>{g.beginPath();ring.forEach((p,i)=>{const [x,y]=project(p,z);i?g.lineTo(x+dx,y+dy):g.moveTo(x+dx,y+dy);});g.closePath();};
 function polygon(g,ring,z,fill,stroke,width=1){if(!ring?.length)return;path(g,ring,z);if(fill){g.fillStyle=fill;g.fill();}if(stroke){g.strokeStyle=stroke;g.lineWidth=width;g.stroke();}}
 function prism(g,ring,low,high,alpha=1){
  g.save();g.globalAlpha=alpha;
  const faces=ring.map((p,i)=>[p,ring[(i+1)%ring.length]]).sort((a,b)=>(b[0][0]*.57+b[0][1]*.82)-(a[0][0]*.57+a[0][1]*.82));
  for(const [a,b]of faces){const v=[project(a,low),project(b,low),project(b,high),project(a,high)];g.beginPath();v.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();g.fillStyle='rgba(157,203,224,.055)';g.fill();g.strokeStyle='rgba(157,203,224,.22)';g.lineWidth=.7;g.stroke();}
  polygon(g,ring,high,'rgba(157,203,224,.09)','rgba(157,203,224,.78)');g.restore();
 }
 function staticScene(){
  bg.setTransform(ratio,0,0,ratio,0,0);bg.clearRect(0,0,w,h);bg.fillStyle='#0e1920';bg.fillRect(0,0,w,h);
  if(model.boundary.length<3)return;
  // Grid density is bounded even for a very large parcel.
  const step=model.span/10,ext=model.span*.92;
  bg.save();bg.beginPath();bg.rect(0,0,w,h);bg.clip();bg.strokeStyle='#1c2c35';bg.lineWidth=.7;
  for(let i=-10;i<=10;i++)for(const axis of [0,1]){const a=axis?[-ext,i*step]:[i*step,-ext],b=axis?[ext,i*step]:[i*step,ext];bg.beginPath();bg.moveTo(...project(a));bg.lineTo(...project(b));bg.stroke();}
  for(const n of model.neighbors)polygon(bg,n.ring,0,n.road?'#1b2c36':'#111f28',n.road?'#415561':'#263944');
  // Display shadow direction is a fixed illustration, not a solar calculation.
  path(bg,model.boundary,0,18,17);bg.fillStyle='#0a1319';bg.fill();
  prism(bg,model.boundary,-model.span*.035,0);polygon(bg,model.boundary,0,'#203541','#9dcbe0',1.8);
  for(const p of model.boundary){const [x,y]=project(p);bg.fillStyle='#9dcbe0';bg.fillRect(x-2,y-2,4,4);}
  bg.restore();
 }
 function resize(){
  if(destroyed)return;dirty=true;if(doc.hidden||paused||!visible)return;dirty=false;const r=canvas.getBoundingClientRect();w=Math.max(1,r.width);h=Math.max(1,r.height);ratio=Math.min(win.devicePixelRatio||1,1.5);
  for(const c of [canvas,backdrop,volume]){c.width=Math.round(w*ratio);c.height=Math.round(h*ratio);}
  // Reserve label gutters outside the volume; no label is placed on a solid.
  const actual=mode==='result'?report?.geometry?.floors?.slice(0,12):null;
  const fh=mode==='result'&&report?.numbers?.floor_h>0?report.numbers.floor_h:model.floorHeight;
  let x0=0,x1=1,y0=0,y1=1;
  const include=(p,z)=>{const [x,y]=projectRaw(p,z);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);};
  for(const p of model.boundary){include(p,0);if(!actual)include(p,Math.min(model.count,12)*fh);}
  if(actual)for(const [i,ring]of actual.entries())for(const [x,y]of ring)include([x-model.center[0],y-model.center[1]],(i+1)*fh);
  scale=Math.min((w-(w<440?64:140))/Math.max(x1-x0,1),(h-(h<220?36:96))/Math.max(y1-y0,1));scale=Math.max(.1,scale);
  ox=w/2-(x0+x1)*scale/2;oy=h/2+(h<220?0:12)-(y0+y1)*scale/2;
  staticScene();vg.setTransform(ratio,0,0,ratio,0,0);vg.clearRect(0,0,w,h);for(let i=0;i<model.floors.length;i++)prism(vg,model.floors[i],i*model.floorHeight,(i+1)*model.floorHeight);draw();
 }
 function projectRaw([x,y],z){return [x*.82-y*.57,-(x*.57+y*.82)*.5-z*.86];}
 function draw(){
  if(destroyed||!ctx||paused||!visible||doc.hidden)return;drawn++;ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);ctx.drawImage(backdrop,0,0,w,h);
  if(model.boundary.length<3){ctx.fillStyle='#c0ccd3';ctx.font='12px sans-serif';ctx.fillText('대지 경계를 기다립니다',24,h/2);return;}
  const t=elapsed/1000,search=mode==='search',cycle=Math.floor(t/3.6),beat=t%3.6;
  let rings=model.floors;
  if(mode==='result'&&report?.geometry?.floors?.length)rings=report.geometry.floors.slice(0,12).map(r=>r.map(([x,y])=>[x-model.center[0],y-model.center[1]]));
  const fh=mode==='result'&&report?.numbers?.floor_h>0?report.numbers.floor_h:model.floorHeight;
  // Unverified, parcel-clipped examples. No candidate/score counters are invented.
  const shape=(seed,factor=.7)=>{const a=(seed%3)*.07,all=model.floors[0]||model.boundary,ring=all.filter((_,i)=>i%Math.max(1,Math.ceil(all.length/96))===0);return ring.map(([x,y])=>[x*factor+Math.sin(seed)*model.span*.07,y*(factor+a)+Math.cos(seed)*model.span*.07]);};
  if(search){
   for(let k=2;k>=1;k--)polygon(ctx,shape(cycle-k),.1,null,'rgba(157,203,224,'+(k===1?'.18':'.08')+')');
  }
  if(mode==='result'){for(let i=0;i<rings.length;i++)prism(ctx,rings[i],i*fh,(i+1)*fh);}else{ctx.save();ctx.globalAlpha=search?.52:1;ctx.drawImage(volume,0,0,w,h);ctx.restore();}
  if(search){
   ctx.save();path(ctx,model.boundary);ctx.clip();
   const candidate=shape(cycle),core=shape(cycle,.17);
   prism(ctx,core,0,fh*Math.min(rings.length||2,3),.95);
   if(beat>.75){
    const n=6,span=model.span;ctx.strokeStyle='#9dcbe0';ctx.lineWidth=1;
    for(let i=0;i<n;i++){const x=-span*.29+i*span*.1,y=-span*.32;polygon(ctx,[[x,y],[x+span*.075,y],[x+span*.075,y+span*.19],[x,y+span*.19]],.04,'rgba(157,203,224,.13)','#9dcbe0');}
   }
   if(beat>1.5)polygon(ctx,candidate,.12,'rgba(157,203,224,.18)','#d9ecf5',2);
   ctx.restore();
   if(beat>2.05)for(let i=0;i<Math.min(rings.length,5);i++)prism(ctx,candidate,i*fh,(i+1)*fh,Math.min(1,(beat-2.05)*1.8)*.8);
   // A thin moving section plane makes the stacked levels legible.
   const z=(t*.26%1)*Math.min(rings.length,12)*fh;polygon(ctx,shape(0,1),z,'rgba(157,203,224,.065)','rgba(210,232,242,.5)');
  }
  ctx.font='12px sans-serif';ctx.fillStyle='#b1c4cf';ctx.fillText('N',13,25);ctx.strokeStyle='#9dcbe0';const north=[-.57,-.41],len=Math.hypot(...north),dx=north[0]/len,dy=north[1]/len,tip=[40+dx*22,56+dy*22];ctx.beginPath();ctx.moveTo(40,56);ctx.lineTo(...tip);ctx.lineTo(tip[0]-dx*6-dy*3,tip[1]-dy*6+dx*3);ctx.moveTo(...tip);ctx.lineTo(tip[0]-dx*6+dy*3,tip[1]-dy*6-dx*3);ctx.stroke();
  ctx.fillStyle='#9aadb9';ctx.textAlign='right';ctx.fillText(mode==='result'?'수신 결과 도형':mode==='boundary'?'실제 입력 경계':'입력 상한 · 형태 연출',w-18,26);
  ctx.fillText('그림자 방향은 연출',w-18,44);ctx.textAlign='left';
  // A dedicated vertical gutter prevents floor labels from crossing the volume.
  const x=w-26,top=h<220?64:72,bottom=h-24;ctx.strokeStyle='#40535d';ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();
  const levels=Math.min(rings.length,12);ctx.fillStyle='#b1c4cf';ctx.textAlign='right';
  const markCount=Math.min(levels,Math.max(2,Math.floor((bottom-top)/24))),marks=new Set(Array.from({length:markCount},(_,i)=>markCount===1?1:1+Math.round(i*(levels-1)/(markCount-1))));
  for(let i=1;i<=levels;i++){if(!marks.has(i))continue;const y=bottom-(bottom-top)*i/Math.max(levels,1);ctx.fillText(i+'층',x-8,y+4);ctx.beginPath();ctx.moveTo(x-4,y);ctx.lineTo(x+4,y);ctx.stroke();}
  ctx.textAlign='left';
 }
 function stop(){if(raf)win.cancelAnimationFrame(raf);raf=0;previous=0;}
 function frame(at){raf=0;if(destroyed||paused||!visible||doc.hidden||done)return;if(previous)elapsed+=Math.min(at-previous,100);previous=at;if(at-last>=1000/30){last=at;draw();}raf=win.requestAnimationFrame(frame);}
 function start(){if(!destroyed&&!done&&mode==='search'&&!paused&&visible&&!doc.hidden&&!reduced?.matches&&!raf)raf=win.requestAnimationFrame(frame);}
 const intersection=typeof win.IntersectionObserver==='function'?new win.IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting!==false;if(visible){if(dirty)resize();start();}else stop();}):null;intersection?.observe(canvas);
 const changed=()=>{stop();draw();start();};reduced?.addEventListener?.('change',changed);
 const observer=typeof win.ResizeObserver==='function'?new win.ResizeObserver(resize):null;observer?.observe(canvas);try{resize();start();}catch(error){destroyed=true;stop();observer?.disconnect();intersection?.disconnect();reduced?.removeEventListener?.('change',changed);throw error;}
 return {update(next,{state='input',result=null}={}){if(model===next&&mode===state&&report===result)return;model=next;mode=state;report=result;resize();if(state==='result')stop();else start();},pause(value){paused=value;if(value)stop();else {if(dirty)resize();else draw();start();}},finish(){done=true;stop();observer?.disconnect();intersection?.disconnect();reduced?.removeEventListener?.('change',changed);},destroy(){if(destroyed)return;this.finish();destroyed=true;},get frames(){return drawn;}};
}
