// 204: 32비트 정수 핸들 → 칸 번호 표.
// AutoCAD 는 64비트 핸들을 바이트로 쪼개 256갈래 트리를 내려가고, 마지막으로 찾은 잎을 기억해 이웃 핸들은 트리를 타지 않는다.
// 바른 CAD 도 같은 모양(잎 = 256칸 Int32Array)을 쓰되 더 낫게 한다:
//  - 비어 있는 갈래는 만들지 않고(성긴 핸들도 메모리 적게), 지운 칸만 남은 잎은 돌려준다(오래 편집해도 잎이 쌓이지 않음).
//  - 핸들 순서대로 돌기(forEach)가 정렬 없이 된다 — DXF 원본 보존 대조·감사가 핸들 순서로 걸을 때 쓴다.
//  - 문자열 키(36자 UUID)를 쓰지 않아 객체 20만 개에 문자열 수십 MB 가 들지 않는다.
// DXF 핸들(16진 문자열)은 parseHandle 로 정수로 받는다. 32비트를 넘는 핸들은 null(문자열 경로로 남긴다).

const LEAF_BITS=8,LEAF=1<<LEAF_BITS,MASK=LEAF-1;

export function parseHandle(text){
  if(typeof text==='number')return Number.isInteger(text)&&text>=0&&text<=0xffffffff?text:null;
  if(typeof text!=='string'||!/^[0-9a-f]{1,8}$/i.test(text.trim()))return null;
  return parseInt(text.trim(),16)>>>0;
}
export const formatHandle=h=>(h>>>0).toString(16).toUpperCase();

export function createHandleTable(){
  const root=new Array(LEAF);
  let lastKey=-1,lastLeaf=null,size=0,leaves=0;
  const leafOf=(h,create)=>{
    const key=h>>>LEAF_BITS;
    if(key===lastKey)return lastLeaf;                        // 마지막 잎 재사용(이웃 핸들)
    const a0=h>>>24,a1=(h>>>16)&MASK,a2=(h>>>8)&MASK;
    let a=root[a0];if(!a){if(!create)return null;a=root[a0]=new Array(LEAF);}
    let b=a[a1];if(!b){if(!create)return null;b=a[a1]=new Array(LEAF);}
    let leaf=b[a2];if(!leaf){if(!create)return null;leaf=b[a2]=new Int32Array(LEAF).fill(-1);leaf.used=0;leaves++;}
    lastKey=key;lastLeaf=leaf;return leaf;
  };
  const dropLeaf=h=>{
    const a0=h>>>24,a1=(h>>>16)&MASK,a2=(h>>>8)&MASK,a=root[a0],b=a?.[a1];
    if(!b?.[a2])return;
    b[a2]=undefined;leaves--;
    if(b.every(x=>!x))a[a1]=undefined;
    if(a.every(x=>!x))root[a0]=undefined;
    if(lastKey===h>>>LEAF_BITS){lastKey=-1;lastLeaf=null;}
  };
  return {
    get(h){h>>>=0;const leaf=leafOf(h,false);return leaf?leaf[h&MASK]:-1;},
    has(h){return this.get(h)>=0;},
    set(h,slot){
      if(!Number.isInteger(slot)||slot<0)throw Error('칸 번호가 잘못되었습니다.');
      h>>>=0;const leaf=leafOf(h,true);
      if(leaf[h&MASK]>=0)throw Error('핸들 중복: '+formatHandle(h));
      leaf[h&MASK]=slot;leaf.used++;size++;
    },
    remove(h){
      h>>>=0;const leaf=leafOf(h,false);if(!leaf||leaf[h&MASK]<0)return false;
      leaf[h&MASK]=-1;leaf.used--;size--;
      if(!leaf.used)dropLeaf(h);
      return true;
    },
    /** 핸들 오름차순으로 (핸들, 칸) 을 돈다. 정렬이 필요 없다(트리 순서가 곧 핸들 순서). */
    forEach(fn){
      for(let i=0;i<LEAF;i++){const a=root[i];if(!a)continue;
        for(let j=0;j<LEAF;j++){const b=a[j];if(!b)continue;
          for(let k=0;k<LEAF;k++){const leaf=b[k];if(!leaf)continue;
            const base=((i<<24)|(j<<16)|(k<<8))>>>0;
            for(let m=0;m<LEAF;m++)if(leaf[m]>=0)fn((base|m)>>>0,leaf[m]);}}}
    },
    /** 다음에 쓸 수 있는 핸들(지금 가장 큰 핸들 + 1). */
    nextHandle(){let max=-1;this.forEach(h=>{max=h;});return max+1;},
    get size(){return size;},
    get leafCount(){return leaves;},
  };
}
