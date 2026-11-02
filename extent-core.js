// 전체 보기에서 '멀리 떨어진 부스러기'를 빼고 본 도면만 맞춘다.
// 남의 도면(DWG·DXF)에는 원점 근처나 수 km 밖에 선 몇 개가 남아 있는 일이 많아, 그대로 맞추면 본 도면이 점처럼 작아진다.
// 판단: 객체 중심의 1~99% 범위(표본)를 본 도면 영역으로 보고, 그 영역 크기만큼 넓힌 테두리와 전혀 겹치지 않는 객체를
// '멀리 떨어진 객체'로 센다. 그런 객체가 적고(2% 이하) 전체 범위를 10배 넘게 부풀릴 때만 뺀다. 지우지 않고 화면 맞춤에서만 뺀다.
// 전체 보기는 도면을 열 때마다 돌므로 객체마다 새 객체를 만들지 않고, 보통 도면은 한 번만 훑는다.
const SAMPLE=4096,SHARE=0.02,SPREAD=10;
const span=b=>Math.max(b.maxX-b.minX,b.maxY-b.minY,1e-9);

function boxOf(v,out){
 let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
 if(Array.isArray(v))for(let k=0;k<v.length;k++){const p=v[k],x=p.x,y=p.y;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
 else if(v){x0=v.minX;y0=v.minY;x1=v.maxX;y1=v.maxY;}
 out[0]=x0;out[1]=y0;out[2]=x1;out[3]=y1;
 // NaN·무한대가 섞인 객체는 범위에 넣지 않는다
 return x0<=x1&&y0<=y1&&Number.isFinite(x0)&&Number.isFinite(x1)&&Number.isFinite(y0)&&Number.isFinite(y1);
}

/** pointsOf(e) = 객체의 점 목록 [{x,y}…] 또는 범위 {minX,minY,maxX,maxY}. {all, core, far:[객체], farCount} 를 돌려준다. */
export function coreExtents(entities,pointsOf){
 const n=entities.length,b=new Float64Array(4),step=Math.max(1,Math.floor(n/SAMPLE)),xs=[],ys=[];
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,count=0;
 // 1회째: 전체 범위 + 중심 표본(수십만 객체에서도 정렬은 4천 개)
 for(let i=0;i<n;i++){
  if(!boxOf(pointsOf(entities[i]),b))continue;
  count++;if(b[0]<minX)minX=b[0];if(b[1]<minY)minY=b[1];if(b[2]>maxX)maxX=b[2];if(b[3]>maxY)maxY=b[3];
  if(i%step===0){xs.push((b[0]+b[2])/2);ys.push((b[1]+b[3])/2);}
 }
 const all=count?{minX,minY,maxX,maxY}:null,plain={all,core:all&&{...all},far:[],farCount:0};
 if(count<20||xs.length<20)return plain;
 xs.sort((a,c)=>a-c);ys.sort((a,c)=>a-c);
 // 양 끝에서 2%(작은 도면은 최소 2~3개)를 건너뛴 범위 — 객체가 적으면 1%·99% 지점이 곧 멀리 떨어진 객체가 된다.
 const k=Math.max(Math.min(3,Math.floor(xs.length/8)),Math.floor(xs.length*.02)),q=(a,lo)=>lo?a[k]:a[a.length-1-k];
 const qx0=q(xs,true),qx1=q(xs,false),qy0=q(ys,true),qy1=q(ys,false),grow=Math.max(qx1-qx0,qy1-qy0,1e-6);
 const rx0=qx0-grow,ry0=qy0-grow,rx1=qx1+grow,ry1=qy1+grow;
 // 전체 범위가 테두리 안이면 멀리 떨어진 객체가 없다 — 대부분 도면은 여기서 끝난다(한 번만 훑음).
 if(minX>=rx0&&minY>=ry0&&maxX<=rx1&&maxY<=ry1)return plain;
 // 2회째(드묾): 테두리와 겹치지 않는 객체를 골라낸다
 const far=[];let cx0=Infinity,cy0=Infinity,cx1=-Infinity,cy1=-Infinity;
 for(let i=0;i<n;i++){
  if(!boxOf(pointsOf(entities[i]),b))continue;
  if(b[2]<rx0||b[0]>rx1||b[3]<ry0||b[1]>ry1){far.push(entities[i]);if(far.length>Math.max(3,count*SHARE))return plain;continue;}
  if(b[0]<cx0)cx0=b[0];if(b[1]<cy0)cy0=b[1];if(b[2]>cx1)cx1=b[2];if(b[3]>cy1)cy1=b[3];
 }
 if(!far.length)return plain;
 const core={minX:cx0,minY:cy0,maxX:cx1,maxY:cy1};
 if(span(all)<SPREAD*span(core))return plain;
 return {all,core,far,farCount:far.length};
}
