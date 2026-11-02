// 끌기·변환 미리보기를 "행렬"로(ACAD200 123).
// AutoCAD 는 끌기를 시작할 때 선택을 한 번 읽어 미리보기 그래픽을 만들고, 그 뒤에는 변환 행렬만 바꾼다.
// 우리는 (1) 작은 선택: 객체마다 같은 2x3 행렬 하나로 점을 옮기고(이동·회전·배율·대칭 모두 같은 함수),
// (2) 큰 선택(수백 개·큰 블록): 선택을 그림 한 장으로 한 번 떠 두고 매 프레임 그 그림에 행렬만 걸어 그린다.
// 회전·배율·대칭도 이동과 같이 프레임당 비용이 그림 한 장이다. 그림이 화면보다 크면 해상도를 낮춰
// 통째로 뜬다(돌리면 화면 밖에 있던 부분이 들어와도 빠지지 않는다).

// 2x3 행렬 [a,b,c,d,e,f]: x' = a·x + c·y + e, y' = b·x + d·y + f (Canvas setTransform 과 같은 순서).
export const IDENTITY=Object.freeze([1,0,0,1,0,0]);
export function multiplyAffine(m,n){ // m∘n (n 먼저)
  return [m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
}
export function invertAffine(m){
  const det=m[0]*m[3]-m[1]*m[2];if(!det)return null;
  const a=m[3]/det,b=-m[1]/det,c=-m[2]/det,d=m[0]/det;
  return [a,b,c,d,-(a*m[4]+c*m[5]),-(b*m[4]+d*m[5])];
}
export const applyAffine=(m,p)=>({x:m[0]*p.x+m[2]*p.y+m[4],y:m[1]*p.x+m[3]*p.y+m[5]});
const about=(base,m)=>multiplyAffine([1,0,0,1,base.x,base.y],multiplyAffine(m,[1,0,0,1,-base.x,-base.y]));
// 미리보기 래퍼(previewTransformEntity)의 연산을 도면 좌표 행렬로.
export function previewAffine(operation,v={}){
  if(operation==='translate')return [1,0,0,1,Number(v.dx)||0,Number(v.dy)||0];
  if(operation==='rotate'){const r=(Number(v.degrees)||0)*Math.PI/180,c=Math.cos(r),s=Math.sin(r);return about(v.base||{x:0,y:0},[c,s,-s,c,0,0]);}
  if(operation==='scale'){const k=Number(v.factor);return Number.isFinite(k)&&k>0?about(v.base||{x:0,y:0},[k,0,0,k,0,0]):[...IDENTITY];}
  if(operation==='mirror'){
    const a=v.a||{x:0,y:0},b=v.b||{x:1,y:0},dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len;
    return about(a,[2*ux*ux-1,2*ux*uy,2*ux*uy,2*uy*uy-1,0,0]);
  }
  return [...IDENTITY];
}
// 도면 행렬 → 화면(CSS px) 행렬. 화면: x = origin.x + X·scale, y = origin.y − Y·scale.
export function screenAffine(world,{scale,origin}){
  const s=[scale,0,0,-scale,origin.x,origin.y],inverse=[1/scale,0,0,-1/scale,-origin.x/scale,origin.y/scale];
  return multiplyAffine(s,multiplyAffine(world,inverse));
}

// 큰 선택의 그림 한 장. key 가 같으면 다시 뜨지 않는다. paint(octx,box) 는 도면을 CSS px 화면 좌표로 그린다.
export const SNAPSHOT_MAX_PIXELS=4096;
export class MatrixSnapshot {
  constructor(createCanvas=()=>document.createElement('canvas')){this.createCanvas=createCanvas;this.snap=null;this.paints=0;}
  clear(){this.snap=null;}
  // bounds: 선택의 도면 상자. view: {scale,origin,ratio}. affine: 도면 행렬. 그렸으면 true.
  draw(ctx,{key,bounds,view,affine,paint}){
    if(!bounds||!Number.isFinite(bounds.minX)||!Number.isFinite(bounds.maxY))return false;
    const {scale,origin,ratio=1}=view,pad=4;
    const sx0=origin.x+bounds.minX*scale-pad,sy0=origin.y-bounds.maxY*scale-pad;
    const w=(bounds.maxX-bounds.minX)*scale+pad*2,h=(bounds.maxY-bounds.minY)*scale+pad*2;
    if(!(w>0&&h>0))return false;
    let snap=this.snap?.key===key?this.snap:null;
    if(!snap){
      // 너무 크면 해상도를 낮춰 통째로 뜬다(k<=1).
      const k=Math.min(1,SNAPSHOT_MAX_PIXELS/(w*ratio),SNAPSHOT_MAX_PIXELS/(h*ratio));
      const canvas=this.snap?.canvas||this.createCanvas();
      canvas.width=Math.max(1,Math.ceil(w*ratio*k));canvas.height=Math.max(1,Math.ceil(h*ratio*k));
      const octx=canvas.getContext('2d');
      octx.setTransform(ratio*k,0,0,ratio*k,-sx0*ratio*k,-sy0*ratio*k);octx.clearRect(sx0,sy0,w,h);
      paint(octx,{minX:bounds.minX-pad/scale,maxX:bounds.maxX+pad/scale,minY:bounds.minY-pad/scale,maxY:bounds.maxY+pad/scale});
      snap=this.snap={key,canvas,k,sx0,sy0};this.paints++;
    }
    // 그림 픽셀 → CSS 화면(뜬 시점) → 행렬 → 장치 픽셀.
    const m=multiplyAffine([ratio,0,0,ratio,0,0],multiplyAffine(screenAffine(affine,view),[1/(ratio*snap.k),0,0,1/(ratio*snap.k),snap.sx0,snap.sy0]));
    ctx.save();ctx.setTransform(m[0],m[1],m[2],m[3],m[4],m[5]);ctx.drawImage(snap.canvas,0,0);ctx.restore();
    return true;
  }
}
