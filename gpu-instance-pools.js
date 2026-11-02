// 블록 인스턴스 풀(ACAD200 113, 1단계).
// AutoCAD 는 블록 정의 한 벌을 여러 참조가 행렬로 나눠 쓰고, 풀 변경은 모았다가 flush 때 한 번 넘긴다.
// 이 모듈은 그 그릇이다: 정의마다 선분 버퍼 한 벌(정의 좌표) + 참조마다 2x3 행렬 한 칸(인스턴스 속성).
// 참조 추가·삭제는 칸만 바꾸고(빈 칸은 재사용), 바뀐 풀은 flush() 에서 한 번만 GPU 로 올린다.
// 셰이더는 인스턴스 행렬을 정점에 곱한다(THREE InstancedBufferGeometry + LineSegments).
// 지금 화면 경로(gpu-renderer.js)는 아직 펼친 정점을 쓴다: 공유 블록 템플릿을 이 풀로 옮기는 것이 다음 단계다.
import {THREE} from './vendor/mlightcad.js';

const SLOT=6;   // a,b,c,d,e,f
const vertexShader=`
attribute vec3 instanceRow0;   // a c e
attribute vec3 instanceRow1;   // b d f
void main(){
  vec3 p=vec3(dot(instanceRow0,vec3(position.xy,1.0)),dot(instanceRow1,vec3(position.xy,1.0)),position.z);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
}`;
const fragmentShader=`uniform vec3 color;void main(){gl_FragColor=vec4(color,1.0);}`;

export function referenceAffine(ref){
  const r=(Number(ref.rotation)||0)*Math.PI/180,sx=Number(ref.scaleX??ref.scale)||1,sy=Number(ref.scaleY??ref.scale)||1;
  const c=Math.cos(r),s=Math.sin(r),p=ref.position||{x:0,y:0};
  return [c*sx,s*sx,-s*sy,c*sy,p.x,p.y];
}

export class GpuInstancePools {
  constructor(){this.pools=new Map();this.dirty=new Set();this.stats={pools:0,instances:0,uploads:0};}
  // definition: Float32Array 선분 정점(x,y,z 쌍). 처음 한 번만 만든다.
  pool(name,definition,color='#ffffff'){
    let p=this.pools.get(name);
    if(!p){
      const positions=definition instanceof Float32Array?definition:new Float32Array(definition);
      const geometry=new THREE.InstancedBufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
      const material=new THREE.ShaderMaterial({vertexShader,fragmentShader,uniforms:{color:{value:new THREE.Color(color)}}});
      const object=new THREE.LineSegments(geometry,material);object.frustumCulled=false;
      p={name,geometry,material,object,slots:new Float32Array(SLOT*16),ids:[],free:[],count:0,live:0,byId:new Map()};
      this.pools.set(name,p);this.stats.pools++;
    }
    return p;
  }
  add(name,ref,definition,color){
    const p=this.pool(name,definition,color);if(p.byId.has(ref.id))this.remove(name,ref.id);
    const i=p.free.length?p.free.pop():p.count++;
    if(SLOT*p.count>p.slots.length){const grown=new Float32Array(Math.max(p.slots.length*2,SLOT*p.count));grown.set(p.slots);p.slots=grown;}
    p.slots.set(referenceAffine(ref),i*SLOT);p.ids[i]=ref.id;p.byId.set(ref.id,i);p.live++;this.dirty.add(p);this.stats.instances++;
    return i;
  }
  remove(name,id){
    const p=this.pools.get(name),i=p?.byId.get(id);if(i===undefined)return false;
    // 빈 칸은 크기 0 행렬: 모든 정점이 한 점으로 모여 그려지지 않는다.
    p.slots.fill(0,i*SLOT,i*SLOT+SLOT);p.ids[i]=null;p.byId.delete(id);p.free.push(i);p.live--;this.dirty.add(p);this.stats.instances--;
    return true;
  }
  // 프레임 끝에서 한 번: 바뀐 풀의 인스턴스 속성만 다시 올린다.
  flush(){
    let uploads=0;
    for(const p of this.dirty){
      const n=p.count,row0=new Float32Array(n*3),row1=new Float32Array(n*3);
      for(let i=0;i<n;i++){const s=p.slots.subarray(i*SLOT,i*SLOT+SLOT);row0.set([s[0],s[2],s[4]],i*3);row1.set([s[1],s[3],s[5]],i*3);}
      p.geometry.setAttribute('instanceRow0',new THREE.InstancedBufferAttribute(row0,3));
      p.geometry.setAttribute('instanceRow1',new THREE.InstancedBufferAttribute(row1,3));
      p.geometry.instanceCount=n;uploads++;
    }
    this.dirty.clear();this.stats.uploads+=uploads;
    return uploads;
  }
  // 칸 i 의 행렬로 정의 좌표 점을 옮긴다(시험·선택용 CPU 경로).
  transformed(name,id,point){const p=this.pools.get(name),i=p?.byId.get(id);if(i===undefined)return null;const s=p.slots.subarray(i*SLOT,i*SLOT+SLOT);return {x:s[0]*point.x+s[2]*point.y+s[4],y:s[1]*point.x+s[3]*point.y+s[5]};}
  dispose(){for(const p of this.pools.values()){p.geometry.dispose();p.material.dispose();}this.pools.clear();this.dirty.clear();}
}
