// 래스터 밉 캐시(ACAD200 122). THREE 를 쓰지 않아 app.js 가 바로 불러도 GPU 모듈을 끌어오지 않는다.
// 화면에 imagePx 픽셀짜리 원본이 screenPx 픽셀로 보일 때 쓸 밉 단계(0=원본, 1=절반 ...).
export const rasterLevel=(imagePx,screenPx)=>Math.max(0,Math.floor(Math.log2(Math.max(1,imagePx/Math.max(1,screenPx)))));

// 화면(캔버스) 쪽 같은 생각: 배경 지도처럼 큰 그림을 축소해 그릴 때, 원본을 매번 줄여 그리지 않고
// 화면 크기에 맞는 절반·4분의 1… 그림(밉)을 한 번 만들어 둔다. 밉은 처음 필요할 때 다음 틈(setTimeout)에
// 만들고(그 프레임은 예전처럼 원본으로 그린다: 멈춤 없음), 나이 방식으로 안 쓰면 버린다.
export class CanvasMipCache {
  constructor({maxAge=8,createCanvas=()=>document.createElement('canvas'),schedule=fn=>setTimeout(fn,0),onReady=()=>{}}={}){
    Object.assign(this,{maxAge,createCanvas,schedule,onReady});this.items=new Map();this.stats={builds:0,hits:0,disposed:0};
  }
  // 준비된 밉 캔버스(없으면 null, 만들기를 예약). level 0 은 원본을 그대로 쓰라는 뜻(null).
  acquire(key,image,level){
    if(!(level>0)||!image)return null;
    const id=key+'|'+level;let item=this.items.get(id);
    if(!item){
      item={canvas:null,age:this.maxAge};this.items.set(id,item);
      this.schedule(()=>{
        if(this.items.get(id)!==item)return;
        let source=image,w=image.naturalWidth||image.width,h=image.naturalHeight||image.height;
        for(let i=0;i<level&&w>1&&h>1;i++){
          const next=this.createCanvas();w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2));next.width=w;next.height=h;
          const c=next.getContext('2d');c.imageSmoothingQuality='high';c.drawImage(source,0,0,w,h);source=next;
        }
        item.canvas=source;item.scale=(image.naturalWidth||image.width)/w;this.stats.builds++;this.onReady();
      });
    }else if(item.canvas)this.stats.hits++;
    item.age=this.maxAge;return item.canvas?item:null;
  }
  incrementAge(){for(const [id,item] of this.items){if(item.age<=0){if(item.canvas){item.canvas.width=item.canvas.height=0;}this.items.delete(id);this.stats.disposed++;}else item.age--;}}
  clear(){this.items.clear();}
}
