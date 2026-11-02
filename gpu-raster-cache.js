// 래스터 이미지 텍스처 캐시(ACAD200 122, 1단계).
// AutoCAD 는 캐시 항목마다 나이를 두고 프레임마다 줄여 0 이 되면 버리며, 같은 원본은 다시 쓴다.
// 우리도 같다: 키 = 원본 경로|밉 단계. 화면에 쓰이면 나이를 다시 채우고, 안 쓰이면 줄어 0 에서 dispose.
// 더 나은 점: 화면 크기에 맞는 단계만 올린다(rasterLevel) — 큰 사진을 원본 해상도로 다 올리지 않는다.
// 같은 원본의 같은 단계는 여러 IMAGE 가 함께 쓴다. 지금은 IMAGE 개체 형식이 없어 이 캐시만 있다(다음 단계: IMAGEATTACH).
import {THREE} from './vendor/mlightcad.js';
export {rasterLevel,CanvasMipCache} from './raster-mip-cache.js';

export class GpuRasterCache {
  constructor({maxAge=8,createTexture=()=>new THREE.Texture()}={}){this.maxAge=maxAge;this.createTexture=createTexture;this.items=new Map();this.stats={loads:0,hits:0,disposed:0};}
  acquire(path,level,load){
    const key=path+'|'+level;let item=this.items.get(key);
    if(!item){
      item={texture:this.createTexture(),age:this.maxAge,ready:false};this.items.set(key,item);this.stats.loads++;
      Promise.resolve(load(level)).then(image=>{if(this.items.get(key)!==item)return;item.texture.image=image;item.texture.needsUpdate=true;item.ready=true;}).catch(()=>{item.failed=true;});
    }else this.stats.hits++;
    item.age=this.maxAge;return item.texture;
  }
  // 프레임 끝마다 한 번. 쓰이지 않은 항목은 maxAge 프레임 뒤 버린다.
  incrementAge(){
    for(const [key,item] of this.items){
      if(item.age<=0){item.texture.dispose?.();this.items.delete(key);this.stats.disposed++;}
      else item.age--;
    }
  }
  clear(){for(const item of this.items.values())item.texture.dispose?.();this.items.clear();}
  get size(){return this.items.size;}
}
