/** ACAD200-805: 캐시 재사용을 '파일 전체 해시'가 아니라 '판 지문 + 객체 지문'으로.
    AutoCAD 는 도면 지문과 판 지문이 모두 같을 때만 그래픽 캐시를 쓰고 그림 조각을 객체 번호별로 붙인다.
    여기서는 판(렌더러) 지문이 같으면 객체마다 (핸들 + 내용 지문)으로 지난 결과를 찾아, 파일이 조금 바뀌어도
    바뀌지 않은 객체의 결과는 그대로 쓰고 바뀐 것만 다시 만든다. 지문은 객체당 한 번(JSON 한 번)만 계산한다.

    쓰는 법: const cache=createRecordCache({rendererVersion}); const {reuse,compile}=cache.plan(entities);
             compile 만 새로 만들고 cache.store(entity,record) 로 넣는다. 다른 판 번호로 만들면 이전 것은 모두 버린다. */
export function entityFingerprint(entity){
  // FNV-1a 32비트. id 는 열 때마다 새로 붙으므로 지문에서 뺀다(핸들이 같은 객체를 잇는다).
  let h=2166136261;
  const text=JSON.stringify(entity,(key,value)=>key==='id'||key==='_display'?undefined:value)||'';
  for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);
  return (h>>>0).toString(36)+':'+text.length.toString(36);
}
const recordKey=entity=>entity&&entity.handle!=null&&entity.handle!==''?String(entity.handle)+'#'+entityFingerprint(entity):null;

export function createRecordCache({rendererVersion,limit=500000}={}){
  let records=new Map();
  return {
    rendererVersion,
    get size(){return records.size;},
    /** 지난 결과로 쓸 수 있는 것(reuse: entity.id → record)과 새로 만들 것(compile). 핸들이 없는 객체는 늘 새로 만든다. */
    plan(entities,{version=this.rendererVersion}={}){
      const reuse=new Map(),compile=[],keys=new Map();
      if(version!==this.rendererVersion){records=new Map();this.rendererVersion=version;}
      for(const entity of entities||[]){
        const key=recordKey(entity);
        if(key)keys.set(entity,key);
        const old=key?records.get(key):undefined;
        if(old!==undefined)reuse.set(entity.id,old);else compile.push(entity);
      }
      return {reuse,compile,keys};
    },
    store(entity,record,key=recordKey(entity)){
      if(!key)return false;
      if(records.size>=limit&&!records.has(key))records.delete(records.keys().next().value);   // 가장 오래된 것부터 버린다
      records.set(key,record);return true;
    },
    clear(){records=new Map();},
  };
}
