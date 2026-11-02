// 재생성 요청의 우선순위 큐(ACAD200 101·116).
// AutoCAD 는 재생성 묶음에 우선순위·보조 우선순위를 붙여 큐에 넣고, 동기 요청만 기다린다.
// 우리는 "화면 안 → 화면 근처 → 나머지" 세 칸 + 칸 안에서는 화면 중심에서 가까운 순으로 꺼낸다.
// 같은 key 의 요청은 최신 것 하나만 남긴다(AutoCAD 큐는 중복을 쌓는다: 우리는 쌓지 않는다).
export const REGEN_PRIORITY=Object.freeze({visible:0,near:1,rest:2});

const overlaps=(a,b)=>a.minX<=b.maxX&&a.maxX>=b.minX&&a.minY<=b.maxY&&a.maxY>=b.minY;
// bounds·view 는 같은 좌표계의 상자. near 는 화면 크기의 몇 배까지를 "근처"로 볼지.
export function regenPriority(bounds,view,near=.5){
  if(!bounds||!view)return 'rest';
  if(overlaps(bounds,view))return 'visible';
  const dx=(view.maxX-view.minX)*near,dy=(view.maxY-view.minY)*near;
  return overlaps(bounds,{minX:view.minX-dx,maxX:view.maxX+dx,minY:view.minY-dy,maxY:view.maxY+dy})?'near':'rest';
}
// 상자 중심과 점 사이 거리의 제곱(정렬용).
export const centreDistance2=(b,c)=>((b.minX+b.maxX)/2-c.x)**2+((b.minY+b.maxY)/2-c.y)**2;

export class GpuRegenQueue {
  constructor({run=()=>{},now=()=>performance.now()}={}){this.run=run;this.now=now;this.tiers=[[],[],[]];this.byKey=new Map();this.stats={queued:0,ran:0,replaced:0,sync:0};}
  get size(){return this.tiers[0].length+this.tiers[1].length+this.tiers[2].length;}
  // job: {key?, distance?, ...}. sync=true 는 큐를 거치지 않고 바로 실행해 결과를 돌려준다(저장·출력 직전).
  enqueue(job,priority='rest',sync=false){
    if(sync){this.stats.sync++;return this.run(job);}
    const tier=REGEN_PRIORITY[priority]??2;
    if(job.key!==undefined){
      const old=this.byKey.get(job.key);
      if(old){const list=this.tiers[old.tier],i=list.indexOf(old.job);if(i>=0)list.splice(i,1);this.stats.replaced++;}
      this.byKey.set(job.key,{job,tier});
    }
    const list=this.tiers[tier],d=job.distance??0;
    // 칸 안은 거리 오름차순. 정렬된 자리에 끼워 넣는다(이분 탐색).
    let lo=0,hi=list.length;while(lo<hi){const mid=(lo+hi)>>1;if((list[mid].distance??0)<=d)lo=mid+1;else hi=mid;}
    list.splice(lo,0,job);this.stats.queued++;
    return null;
  }
  next(){for(const list of this.tiers)if(list.length){const job=list.shift();if(job.key!==undefined)this.byKey.delete(job.key);return job;}return null;}
  // budgetMs 동안 꺼내 실행한다. 적어도 하나는 실행한다(굶주림 방지).
  pump(budgetMs=Infinity){
    const start=this.now();let ran=0;
    for(let job=this.next();job;job=this.next()){this.run(job);ran++;this.stats.ran++;if(this.now()-start>=budgetMs)break;}
    return ran;
  }
  clear(){this.tiers=[[],[],[]];this.byKey.clear();}
}

// 116. 정제(refine) 단위 순서: 화면 중심에서 가까운 단위부터. 단위마다 가장 가까운 정제 대상의 거리.
// 정렬만 하므로 O(단위 수 log 단위 수), 도면 전체를 훑지 않는다.
export function orderRefineUnits(units,view){
  if(!view||units.length<2)return units;
  const centre={x:(view.minX+view.maxX)/2,y:(view.minY+view.maxY)/2};
  const keyed=units.map(unit=>{let best=Infinity,tier=2;for(const d of unit.details){const t=REGEN_PRIORITY[regenPriority(d.bounds,view)];const dist=d.bounds?centreDistance2(d.bounds,centre):Infinity;if(t<tier||t===tier&&dist<best){tier=t;best=dist;}}return {unit,tier,best};});
  keyed.sort((a,b)=>a.tier-b.tier||a.best-b.best);
  return keyed.map(k=>k.unit);
}
