import * as G from './geometry.js';
import {H_BEAMS} from './reference-data.js';
const p=(x,y)=>({x,y});
/** 높이·너비가 규격표와 1mm 안에서 맞는 H형강 단면. 같은 크기가 여럿이면 표에 먼저 나온 것. */
export function standardHSection(height,width){
 return H_BEAMS.find(s=>Math.abs(s.h-height)<=1&&Math.abs(s.b-width)<=1)||null;
}
export function structuralDetail(kind,o,layer='default'){
 const {width:w,depth:d,cover,diameter:dia,count,spacing,span}=o;
 for(const [k,v]of Object.entries({width:w,depth:d,cover,diameter:dia,spacing,span}))if(!Number.isFinite(v)||v<=0)throw Error(k+'는 양수입니다.');
 if(cover+dia>=Math.min(w,d)/2)throw Error('피복/철근이 단면 안에 들어가지 않습니다.');
 if(!Number.isInteger(count)||count<2||count>100)throw Error('철근 개수는 2~100 정수입니다.');
 const es=[],line=(a,b)=>es.push({type:'line',points:[a,b],layer}),rect=(x,y,w,h)=>es.push({type:'rectangle',points:G.rectangle(p(x,y),p(x+w,y+h)),layer}),bar=(x,y)=>es.push({type:'circle',center:p(x,y),radius:dia/2,layer}),text=(t,x,y)=>es.push({type:'text',text:t,position:p(x,y),height:o.textHeight||50,layer});
 const ix=cover+dia/2,iy=cover+dia/2;
 if(kind==='beam'||kind==='column'){
  rect(0,0,w,d);rect(cover,cover,w-2*cover,d-2*cover);
  if((w-2*ix)/(count-1)<dia)throw Error('입력 철근이 겹칩니다. 단면/철근 개수를 조정하세요.');
  for(let i=0;i<count;i++){const x=ix+(w-2*ix)*i/(count-1);bar(x,iy);bar(x,d-iy);}
  if(kind==='column')for(let i=1;i<count-1;i++){const y=iy+(d-2*iy)*i/(count-1);bar(ix,y);bar(w-ix,y);}
  text(`${o.mark} ${w}×${d}`,0,d+100);text(`주근 D${dia} ${kind==='column'?4*count-4:2*count}개`,0,-100);text(`띠/늑근 @${spacing} 피복 ${cover}`,0,-200);
  const baseX=w+500;rect(baseX,0,span,d);line(p(baseX,iy),p(baseX+span,iy));line(p(baseX,d-iy),p(baseX+span,d-iy));
  if(span/spacing>1000)throw Error('상세 철근 개수 한도');for(let x=cover;x<span-cover;x+=spacing)line(p(baseX+x,cover),p(baseX+x,d-cover));text('전개 길이 '+span,baseX,d+100);
 }else if(kind==='slab'){
  rect(0,0,span,w);if((span+w)/spacing>2000)throw Error('슬래브 배근 개수 한도');
  for(let x=cover;x<span-cover;x+=spacing)line(p(x,cover),p(x,w-cover));for(let y=cover;y<w-cover;y+=spacing)line(p(cover,y),p(span-cover,y));
  text(`${o.mark} 슬래브 t=${d} D${dia}@${spacing} 양방향`,0,w+100);
 }else if(kind==='steel'){
  /* 규격표에 있는 단면이면 실제 플랜지·웹 두께를 쓴다. 없으면 예전처럼 높이·너비에 비례해 어림한다. */
  const section=standardHSection(d,w);
  const flange=section?section.tf:Math.max(6,d*.06),web=section?section.tw:Math.max(6,w*.04);
  rect(0,0,w,flange);rect(0,d-flange,w,flange);rect((w-web)/2,flange,web,d-2*flange);
  line(p(w+500,-w/2),p(w+500+span,-w/2));line(p(w+500,w/2),p(w+500+span,w/2));line(p(w+500,0),p(w+500+span,0));text(`${o.mark} ${section?section.label:'H-'+d+'×'+w} (플랜지/웹 도식)`,0,d+100);
 }else throw Error('구조 종류 오류');
 return {type:'block',layer,name:o.mark,category:'STRUCTURE',structural:{kind,...o,scope:'사용자 지정 치수의 제도 상세. 내력/정착/이음/법규 검증을 수행하지 않음.'},entities:es.map(e=>G.translate(e,o.x||0,o.y||0))};
}
export function steelFrame(xs,ys,o,layer='default'){
 if(xs.length<2||ys.length<2||xs.length>20||ys.length>20)throw Error('철골 축선은 방향별 2~20개입니다.');
 for(const values of [xs,ys])if(values.some((v,i)=>!Number.isFinite(v)||(i&&v<=values[i-1])))throw Error('축선 좌표는 오름차순의 서로 다른 숫자입니다.');
 const es=[],w=o.width,depth=o.depth;if(w<=0||depth<=0)throw Error('부재 치수는 양수입니다.');
 const line=(a,b)=>({type:'line',layer,points:[a,b]});
 for(const [ix,x]of xs.entries())for(const [iy,y]of ys.entries()){
  es.push({type:'block',layer,name:'SC'+(ix+1)+'-'+(iy+1),category:'STEEL_COLUMN',attributes:{mark:'SC',width:w,height:depth},entities:[{type:'rectangle',layer,points:G.rectangle(p(x-w/2,y-depth/2),p(x+w/2,y+depth/2))}]});
  if(ix<xs.length-1)es.push({type:'block',layer,name:'SB-X',category:'STEEL_BEAM',attributes:{mark:'SB-X',width:w,length:xs[ix+1]-x},entities:[line(p(x,y-w/2),p(xs[ix+1],y-w/2)),line(p(x,y+w/2),p(xs[ix+1],y+w/2))]});
  if(iy<ys.length-1)es.push({type:'block',layer,name:'SB-Y',category:'STEEL_BEAM',attributes:{mark:'SB-Y',width:w,length:ys[iy+1]-y},entities:[line(p(x-w/2,y),p(x-w/2,ys[iy+1])),line(p(x+w/2,y),p(x+w/2,ys[iy+1]))]});
 }
 for(const [i,x]of xs.entries())es.push({type:'text',layer,position:p(x,ys[0]-1000),height:o.textHeight||150,text:'X'+(i+1)});
 for(const [i,y]of ys.entries())es.push({type:'text',layer,position:p(xs[0]-1000,y),height:o.textHeight||150,text:'Y'+(i+1)});
 return es.map(e=>G.translate(e,o.x||0,o.y||0));
}
