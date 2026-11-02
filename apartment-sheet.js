// 아파트 가두리 검토 결과(run_all) → 도면 미리보기 개체. 순수 함수 — 레이어는 이름(layerName)만 붙이고 패널이 id 로 바꾼다.
// 검토서(필지·묶음별·인센티브·계산표·건축개요)는 토지·법규 검토서와 같은 글 모양, 배치도 3안은 인포그래픽(높이 띠 해치·동 번호 배지·
// 스카이라인·용적 게이지·세대 구성 막대·일조 체크·방위·축척·등고선), 그 아래 실제 들어간 주동·단위세대 평면.
import {reviewSheet} from './parcel-info.js';

export const PREVIEW_LAYER='아파트-검토';
const C={frame:'#506574',teal:'#82ded5',text:'#d8dde2',orange:'#f0a35a',red:'#e06060',track:'#2c3338',site:'#f0a35a',contour:'#55666e'};
export const BANDS=[[0,15,'#5b6b73','~15F'],[15,25,'#8a7c68','16~25F'],[25,35,'#b8955e','26~35F'],[35,999,'#e0b56a','36F~']];
const UNIT_COLORS=['#b8955e','#8a7c68','#5b6b73','#3f4a50','#9a8f7a'];

export const bandColor=f=>(BANDS.find(([a,b])=>f>a&&f<=b)||BANDS[0])[2];
const P=(x,y)=>({x,y});
const pts=a=>(a||[]).map(p=>Array.isArray(p)?P(p[0],p[1]):P(p.x,p.y));
export function bbox(list){let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of list){if(p.x<minX)minX=p.x;if(p.y<minY)minY=p.y;if(p.x>maxX)maxX=p.x;if(p.y>maxY)maxY=p.y;}return {minX,minY,maxX,maxY,w:maxX-minX,h:maxY-minY};}
const move=(list,dx,dy)=>list.map(p=>P(p.x+dx,p.y+dy));
const rect=(x,y,w,h)=>[P(x,y),P(x+w,y),P(x+w,y+h),P(x,y+h)];

function Out(layerName){
 const ents=[];
 const add=e=>ents.push({...e,layerName,apartmentZone:'preview'});
 return {ents,
  pl:(points,color,closed=true,extra={})=>points.length>1&&add({type:'polyline',closed,points,...(color?{color}:{}),...extra}),
  hatch:(points,color)=>points.length>2&&add({type:'hatch',points,loops:[],pattern:'solid',solid:true,spacing:100,hatchScale:1,angle:0,color}),
  text:(text,x,y,h,color,extra={})=>add({type:'text',text:String(text),position:P(x,y),height:h,rotation:0,...(color?{color}:{}),...extra}),
  circle:(x,y,r,color)=>add({type:'circle',center:P(x,y),radius:r,...(color?{color}:{})}),
  raw:list=>{for(const e of list)add(e);}};
}

/** 배치도 한 안 — 왼쪽 대지·동, 오른쪽 상자 3개, 아래 스카이라인. 반환: 차지한 폭·높이. */
function planPanel(o,plan,site,index,ox,oy,th,data){
 const B=bbox(site.flat()),dx=ox-B.minX,dy=oy-B.maxY;            // 대지 왼쪽 위를 (ox,oy) 에
 const T=th;
 o.text(`${index+1}안 · ${plan.title||plan.form||''}`+(plan.status==='불가'?'  [불가]':''),ox,oy+T*2.2,T*1.6,plan.status==='불가'?C.orange:C.teal);
 if(plan.status==='불가')o.text('막힌 규칙: '+(plan.blocked_by||'확인필요'),ox,oy+T*.6,T*.9,C.orange);
 for(const c of data.contours||[])o.pl(move(pts(c.points||c),dx,dy),C.contour,false);
 for(const ring of site)o.pl(move(ring,dx,dy),C.site,true,{linetype:'DASHED'});
 for(const part of data.parts||[]){const pp=move(pts(part.points),dx,dy),pb=bbox(pp);o.text(`묶음 ${part.no} · ${part.zone}`,pb.minX+T*.4,pb.maxY-T*1.2,T*.8,C.orange);}
 for(const b of plan.buildings||[]){
  const fp=move(pts(b.points_mm),dx,dy);if(fp.length<3)continue;
  o.hatch(fp,bandColor(Number(b.floors)||0));o.pl(fp,C.text);
  const c=b.centroid_mm?P(b.centroid_mm.x+dx,b.centroid_mm.y+dy):(()=>{const q=bbox(fp);return P(q.minX+q.w/2,q.minY+q.h/2);})();
  const R=T*1.35;o.circle(c.x,c.y,R,C.teal);o.text(b.dong||'',c.x-R*.68,c.y-R*.3,T*.7,C.teal);
  o.text(String(b.label||'').replace(/^\d+동\s*/,''),c.x+R*1.3,c.y-T*.3,T*.75,C.text);
  if(b.ground!=null&&b.ground!=='None')o.text(`EL.${Number(b.ground).toFixed(1)}`,c.x+R*1.3,c.y-T*1.4,T*.6,b.steep&&b.steep!=='False'?C.orange:C.text);
 }
 for(const k of plan.callouts||[]){const p=k.position_mm||k.position||k.at;if(p)o.text(k.text||k.rule||'확인필요',(p.x??p[0])+dx,(p.y??p[1])+dy,T*.8,C.red);}
 // 방위표·축척
 const nv=data.north||[0,1],ax=ox+B.w+T*1.5,ay=oy-T*3.5,L=T*3,len=Math.hypot(nv[0],nv[1])||1,ux=nv[0]/len,uy=nv[1]/len;
 o.pl([P(ax,ay),P(ax+ux*L,ay+uy*L)],C.text,false);o.pl([P(ax+ux*L,ay+uy*L),P(ax+ux*L*.7-uy*T*.5,ay+uy*L*.7+ux*T*.5),P(ax+ux*L*.7+uy*T*.5,ay+uy*L*.7-ux*T*.5)],C.text,true);
 o.text('N',ax+ux*L*1.15-T*.3,ay+uy*L*1.15,T*.9,C.text);
 const step=[10,20,25,50,100].find(s=>s*1000*4>B.w*.25)||100,sy=oy-B.h-T*2;
 for(let i=0;i<4;i++){const r=rect(ox+i*step*1000,sy,step*1000,T*.35);i%2?o.pl(r,C.text):o.hatch(r,C.text);}
 o.text(`0   ${step}   ${step*2}   ${step*4}m`,ox,sy-T*1.1,T*.6,C.text);
 // 오른쪽 상자 3개
 const bx=ox+B.w+T*3,bw=Math.max(T*18,B.w*.55);let by=oy;
 const box=(h,title)=>{o.pl(rect(bx,by-h,bw,h),C.frame);o.text(title,bx+T*.6,by-T*1.4,T*.85,C.teal);const top=by;by-=h+T;return top;};
 let y=box(T*(9+1.6*(plan.per_piece||[]).length),plan.title||'');
 o.text(`${Number(plan.far_pct||0).toFixed(0)}%`,bx+T*.6,y-T*4.6,T*2.6,C.text);
 o.text(`용적률 · 상한 ${Number(plan.far_cap_pct||0).toFixed(0)}% · 채움 ${Number(plan.fill_pct||0).toFixed(0)}%`,bx+T*.6,y-T*6,T*.7,Number(plan.fill_pct)<97?C.orange:C.teal);
 (plan.per_piece||[]).forEach((pc,i)=>{const gy=y-T*(7.4+1.6*i),gw=bw-T*1.2,f=Math.max(0,Math.min(1,(pc.fill_pct||0)/100));
  o.pl(rect(bx+T*.6,gy-T*.5,gw,T*.5),C.frame);if(f>0)o.hatch(rect(bx+T*.6,gy-T*.5,gw*f,T*.5),f<.97?C.orange:C.teal);
  o.text(`묶음 ${i+1} ${pc.zone} · ${Number(pc.far_used_pct||0).toFixed(0)} / ${Number(pc.far_cap_pct||0).toFixed(0)}%`,bx+T*.6,gy+T*.15,T*.55,C.text);});
 const yy=y-T*(7.6+1.6*(plan.per_piece||[]).length);
 o.text(`${Number(plan.units||0).toLocaleString()}세대 · ${plan.buildings_n??(plan.buildings||[]).length}개동 · ${plan.floors_min??''}~${plan.floors_max??''}층`,bx+T*.6,yy,T*.8,C.text);
 o.text(`건폐 ${Number(plan.bcr_pct||0).toFixed(1)}% · 연면적 ${Math.round(plan.gfa_m2||0).toLocaleString()}㎡ · 84형 ${Number(plan.share84_pct||0).toFixed(0)}%`,bx+T*.6,yy-T*1.1,T*.6,C.text);
 // 세대 구성
 const mix=plan.unit_mix||[];y=box(T*(4+1.1*mix.length),'세대 구성 (타입별)');
 let mx=bx+T*.6;const mw=bw-T*1.2,tot=mix.reduce((s,m)=>s+(m.units||0),0)||1;
 mix.forEach((m,i)=>{const w=mw*(m.units||0)/tot;if(w>0)o.hatch(rect(mx,y-T*3,w,T*.9),UNIT_COLORS[i%UNIT_COLORS.length]);mx+=w;
  o.text(`${m.type} · ${Number(m.units||0).toLocaleString()}세대 · ${Number(m.pct||0).toFixed(0)}% · 층당 ${m.upf??''}호 · ${(m.dongs||[]).join('·')}동`,bx+T*.6,y-T*(4.2+1.1*i),T*.55,C.text);});
 // 일조·인동
 const rows=plan.check_rows||[];y=box(T*(2.6+1.1*rows.length),'일조 · 인동 검토');
 rows.forEach((r,i)=>o.text(`${r.ok?'[OK]':r.ok===false?'[NG]':'[..]'} ${r.rule} · ${r.text??''}`,bx+T*.6,y-T*(2.6+1.1*i),T*.6,r.ok?C.teal:r.ok===false?C.red:C.orange));
 // 스카이라인
 const bs=[...(plan.buildings||[])].sort((a,b)=>(a.centroid_mm?.x??0)-(b.centroid_mm?.x??0));
 const sx=ox,sy0=Math.min(sy-T*3,by),barW=T*1.6,scaleY=T*0.25,fmax=Math.max(1,...bs.map(b=>Number(b.floors)||0)),base=sy0-T*(fmax*.25+2.2);
 o.text('스카이라인',sx,sy0,T*.8,C.teal);
 o.pl([P(sx,base),P(sx+Math.max(bs.length,4)*barW*1.5,base)],C.text,false);
 bs.forEach((b,i)=>{const f=Number(b.floors)||0,x=sx+i*barW*1.5,h=f*scaleY;o.hatch(rect(x,base,barW,h),bandColor(f));o.pl(rect(x,base,barW,h),C.text);
  o.text(`${f}F`,x,base+h+T*.3,T*.55,C.text);o.text(b.dong||'',x,base-T*1.2,T*.55,C.teal);});
 // 높이 띠 범례
 BANDS.forEach(([,,col,lab],i)=>{const lx=sx+Math.max(bs.length,4)*barW*1.5+T*2,ly=base+T*1.4*i;o.hatch(rect(lx,ly,T*.8,T*.8),col);o.text(lab,lx+T*1.2,ly+T*.1,T*.55,C.text);});
 return {w:(bx+bw)-ox,h:oy-(base-T*2)};
}

/** 실제 들어간 도면 — 원본 좌표를 왼쪽 아래 0 으로 옮겨 한 줄로. */
function drawingStrip(o,drawings,ox,oy,th){
 let x=ox;const T=th;
 o.text('실제 들어간 도면 — 주동 기준층',ox,oy+T*1.5,T*1.1,C.teal);
 const one=(d,title,rooms,extra)=>{
  const out=pts(d.outline_mm);if(d.missing===true||d.missing==='True'||out.length<3){o.text(title,x,oy-T,T*.7,C.text);o.text('평면 정보 없음',x,oy-T*2,T*.7,C.orange);x+=T*14;return;}
  const B=bbox(out),dx=x-B.minX,dy=oy-T*2-B.maxY;
  o.pl(move(out,dx,dy),C.text);
  for(const c of extra||[])o.pl(move(pts(c),dx,dy),C.teal);
  for(const r of rooms||[]){const rp=move(pts(r.poly),dx,dy);o.pl(rp,C.frame);const rb=bbox(rp);if(r.label&&rb.w>T*2)o.text(String(r.label).replace(/\s+/g,''),rb.minX+rb.w*.2,rb.minY+rb.h*.45,T*.35,C.text);}
  o.text(title,x,oy-T*.6,T*.6,C.text);x+=B.w+T*4;};
 for(const d of drawings?.blocks||[])one(d,`${d.code} · ${d.used_label||''}${d.title?' · '+d.title:''}`,d.rooms,(d.core||[]));
 x+=T*4;o.text('단위세대',x,oy+T*1.5,T*1.1,C.teal);
 for(const u of drawings?.unit_types||[])one(u,`${u.label} · 전용 ${u.area_m2!=null?Number(u.area_m2).toFixed(1):'산정 필요'}㎡${u.units?' · '+u.units+'세대':''}`,u.rooms);
 return x-ox;
}

/** run_all 결과 → 미리보기 개체 전부. */
export function buildApartmentPreview(r,{layerName=PREVIEW_LAYER}={}){
 const o=Out(layerName),enc=r.enclose||{},inc=r.incentive||{},pm=r.place||{};
 const site=Array.isArray(enc.site_mm?.[0])?enc.site_mm.map(pts):[pts(enc.site_mm)];
 const all=site.flat();if(!all.length)throw Error('대지 경계가 없습니다.');
 const B=bbox(all),th=Number(pm.text_h||enc.text_h)||Math.max(B.w,B.h)/60;
 const gap=th*6;
 // 1줄: 배치도 3안 (같은 축척)
 let x=B.maxX+gap*2;const top=B.maxY+th*20;let rowH=0;
 const data={parts:enc.parts_mm,contours:pm.contours_mm,north:pm.north_vec};
 (pm.plans||[]).forEach((p,i)=>{const s=planPanel(o,p,site,i,x,top,th,data);x+=s.w+gap*1.5;rowH=Math.max(rowH,s.h);});
 // 2줄: 검토서 (필지 → 묶음별 → 인센티브 → 계산표 → 안별 건축개요)
 const scale=th/330;let sx=B.maxX+gap*2;const sy=top-rowH-gap*2;
 const sheet=(title,groups)=>{const e=reviewSheet(title,groups,B,layerName,{scale,origin:{x:sx,y:sy}});o.raw(e.map(({layer,...rest})=>rest));sx+=e.width+gap;return e;};
 for(const s of [...(enc.sheets||[]),...(inc.sheets||[]),...(pm.plans||[]).flatMap(p=>p.sheets||[])]){
  if(s.perColumn)for(const g of s.groups)sheet(`${s.title} · ${g[0]}`,[g]);else sheet(s.title,s.groups);}
 // 3줄: 실제 들어간 도면
 const sheetBottom=sy-1000*scale-39*380*scale-300*scale;
 const used={};for(const p of pm.plans||[])for(const b of p.buildings||[])(used[b.block]??=new Set()).add(b.dong);
 const dr={...pm.drawings,blocks:(pm.drawings?.blocks||[]).map(d=>({...d,used_label:used[d.code]?'사용 동 '+[...used[d.code]].join('·'):''}))};
 drawingStrip(o,dr,B.maxX+gap*2,sheetBottom-gap*2,th);
 return o.ents;
}
