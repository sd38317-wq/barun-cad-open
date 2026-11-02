// CAD view commands. This module is imported only when a view command runs.
import {standardLayerForName} from './layer-standards.js';
import {hatchPatternFields} from './hatch-patterns.js';

const NAMES = {OCCTPLAN:'평면도 만들기', OCCTSECTION:'단면도 만들기', OCCTELEVATION:'입면도 만들기'};
const point = p => {
  const q = Array.isArray(p) ? {x:p[0],y:p[1]} : p;
  if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.y)) throw Error('유효한 도면 좌표를 지정하세요.');
  return {x:q.x,y:q.y};
};
const uid = () => globalThis.crypto.randomUUID();
export function buildingModelEntries(doc) {
  return Object.entries(doc.drawingSets || {}).filter(([,s]) => s.model?.format === 'barun-building-model')
    .map(([id,s]) => ({id,model:s.model,label:id+' · '+(s.model.source?.name || '건물 모델')}));
}
export function planReferences(doc, entry) {
  const refs = [{id:'model',label:'모델 원좌표',translation:{x:0,y:0}}], rec = doc.drawingSets?.[entry.id];
  // Older arranged drawing sets have no reliable final plan placement metadata.
  if (rec?.kind==='plan') {
    const origins = rec.wallViews?.length ? rec.wallViews.map(v=>({origin:v.origin,story:v.story || entry.model.elements.find(e=>v.wallIds?.includes(e.id))?.story})) : [{origin:rec.options?.origin || {x:0,y:0},story:rec.options?.story}];
    const seen = new Set();
    for (const v of origins) {
      const translation = point(v.origin), key=translation.x+','+translation.y;
      if (seen.has(key)) continue; seen.add(key);
      refs.push({id:'source-'+refs.length,label:entry.id+' 기존 평면'+(v.story?' · '+v.story:''),translation});
    }
  }
  for (const [id,v] of Object.entries(doc.occtViews || {})) if (v.kind==='plan' && v.modelSetId===entry.id) {
    const actual=trackedPlanTranslation(doc,id,v);
    refs.push({id,label:'OCCT 평면 · '+v.options.story+(actual.invalid?' (편집됨 · 다시 만들기 필요)':''),...actual});
  }
  return refs;
}
const geometry = e => ({type:e.type,points:e.points,center:e.center,loops:e.loops,radius:e.radius,startAngle:e.startAngle,endAngle:e.endAngle,closed:e.closed});
function trackedPlanTranslation(doc,id,view) {
  const baseline=view.baseline, entities=doc.entities.filter(e=>e.occtView===id);
  const invalid={invalid:'기준 평면이 회전·복사·부분 편집되었거나 지워졌습니다. 평면도 만들기로 다시 생성하고 선택하세요.'};
  if(!baseline || entities.length!==Object.keys(baseline).length) return invalid;
  let delta;
  for(const e of entities) {
    const before=baseline[e.id],now=geometry(e);if(!before)return invalid;
    for(const k of ['type','radius','startAngle','endAngle','closed']) if(now[k]!==before[k])return invalid;
    const points=g=>[...(g.points || []),...(g.center?[g.center]:[]),...(g.loops || []).flat()];
    const a=points(before),b=points(now);if(a.length!==b.length)return invalid;
    for(let i=0;i<a.length;i++) {
      const d={x:b[i].x-a[i].x,y:b[i].y-a[i].y};if(!delta)delta=d;
      if(Math.abs(delta.x-d.x)>0.001 || Math.abs(delta.y-d.y)>0.001)return invalid;
    }
  }
  return {translation:{x:view.translation.x+(delta?.x || 0),y:view.translation.y+(delta?.y || 0)}};
}
export function sectionOptions(start, end, look, translation={x:0,y:0}) {
  const a=point(start), b=point(end), c=point(look), t=point(translation);
  const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
  if(length<0.01) throw Error('절단선의 두 점을 서로 다르게 지정하세요.');
  const distance=(dx*(c.y-a.y)-dy*(c.x-a.x))/length;
  if(Math.abs(distance)<0.01) throw Error('바라볼 쪽은 절단선에서 떨어진 점으로 지정하세요.');
  return {start:[a.x-t.x,a.y-t.y],end:[b.x-t.x,b.y-t.y],side:distance>0?'left':'right'};
}
export function elevationDirection(face, angle) {
  const axes={north:[0,1,0],south:[0,-1,0],east:[1,0,0],west:[-1,0,0]};
  if(axes[face]) return axes[face];
  if(face!=='custom' || String(angle??'').trim()==='' || !Number.isFinite(Number(angle))) throw Error('입면 방향과 각도를 확인하세요.');
  const radians=Number(angle)*Math.PI/180;
  return [Math.cos(radians),Math.sin(radians),0];
}
/** Pure insertion: retain source objects and model, and create one complete undo document. */
export function insertOcctView(source, view, {kind,modelSetId,options={},origin}={}) {
  const at=point(origin), list=view.entities || [];
  if(!list.length) throw Error('이 절단 위치에는 보이는 건물 형상이 없습니다. 높이·위치·방향을 확인하세요.');
  const pts=list.flatMap(e=>e.points || (e.center ? [{x:e.center.x-e.radius,y:e.center.y-e.radius},{x:e.center.x+e.radius,y:e.center.y+e.radius}] : []));
  if(!pts.length || pts.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))) throw Error('건물 도면 좌표를 만들지 못했습니다.');
  const translation={x:at.x-pts.reduce((n,p)=>Math.min(n,p.x),Infinity),y:at.y-pts.reduce((n,p)=>Math.min(n,p.y),Infinity)};
  const move=p=>({x:p.x+translation.x,y:p.y+translation.y});
  const layers=source.layers.slice(), layerIds=new Map(layers.map(l=>[l.name,l.id]));
  const layer=name=>{
    if(!layerIds.has(name)) {
      const spec=standardLayerForName(name);if(!spec) throw Error('표준 레이어를 찾을 수 없습니다: '+name);
      const id=uid();layers.push({...spec,id,visible:true,locked:false,frozen:false});layerIds.set(name,id);
    }
    const found=layers.find(l=>l.id===layerIds.get(name));
    if(found.locked || found.visible===false || found.frozen) throw Error(name+' 레이어의 숨김·동결·잠금을 해제하고 다시 실행하세요.');
    return found.id;
  };
  const viewId='occt-view-'+uid(), entities=list.map(e=>({...e,id:uid(),layer:layer(e.occtRole==='cut'?'A-WALL-CONC':'A-ELEV-VIEW'),
    ...(e.points?{points:e.points.map(move)}:{}),...(e.center?{center:move(e.center)}:{}),occtView:viewId}));
  for(const b of view.hatchBoundaries || []) entities.push({id:uid(),type:'hatch',layer:layer('A-HATCH'),
    points:b.outer.map(move),loops:(b.holes || []).map(h=>h.map(move)),...hatchPatternFields('AR-CONC',{scale:10,origin:at}),origin:at,occtView:viewId});
  const record={kind,modelSetId,options:structuredClone(options),origin:at,translation,metadata:view.metadata,...(kind==='plan'?{baseline:Object.fromEntries(entities.map(e=>[e.id,geometry(e)]))}:{})};
  return {document:{...source,layers,entities:[...source.entities,...entities],occtViews:{...source.occtViews,[viewId]:record}},
    added:entities.map(e=>e.id),viewId,metadata:view.metadata};
}
/** A single cached building lives in a lazy Worker; command errors discard it for retry. */
export function createOcctDrawingService({clientFactory,idleMs=60000,setTimer=setTimeout,clearTimer=clearTimeout}={}) {
  let client,handle,key,idle,ignored=[],queue=Promise.resolve(),closed=false;
  const stop=async()=>{clearTimer(idle);idle=null;const old=client;client=null;handle=null;key=null;await old?.terminate();};
  const generate=async(source,request,progress,{detailedProgress=true}={})=>{
    const report=(label,event)=>{try{progress?.(label,event);}catch{}};
    clearTimer(idle);idle=null;
    if(closed) throw Error('건물 도면 작업이 종료되었습니다. 다시 실행하세요.');
    try {
      report('3D 도면 엔진을 불러오고 있습니다. 첫 사용에는 잠시 걸립니다.',{phase:'engine'});
      if(!client) {
        const factory=clientFactory || (await import('./occt-client.js')).createOcctClient;
        if(closed) throw Error('건물 도면 작업이 종료되었습니다.');
        client=factory();await client.load();
      }
      report('3D 도면 엔진 준비 완료',{phase:'engine',done:1,total:1});
      const activeClient=client;
      const assertOpen=()=>{if(closed || !activeClient || client!==activeClient)throw Error('건물 도면 작업이 종료되었습니다.');};
      assertOpen();
      const modelKey=JSON.stringify(request.model);
      if(key!==modelKey) {
        if(handle) {await activeClient.dispose(handle);assertOpen();}
        handle=null;key=null;
        report('벽을 합치고 문·창 개구부를 만들고 있습니다.',{phase:'solids'});
        const built=await activeClient.build(request.model,progress&&detailedProgress?event=>report(event.label,event):undefined);assertOpen();handle=built.handle;key=modelKey;ignored=built.ignored || [];
      }
      report('건물에서 '+({plan:'평면',section:'단면',elevation:'입면'}[request.kind])+'을 그리고 있습니다.',{phase:request.kind});
      const view=await activeClient[request.kind](handle,request.options);assertOpen();
      const result=insertOcctView(source,view,request);
      result.ignored=ignored;
      report('도면 한 장 완료',{phase:request.kind,done:1,total:1,unit:'장',preview:view.entities?.slice(0,160)});
      return result;
    } catch(cause) {
      await stop();
      throw new Error('건물 도면을 만들지 못했습니다. '+cause.message+' 다시 실행하거나 모델을 확인하세요.',{cause});
    } finally {
      if(client && idleMs>0 && !closed) idle=setTimer(()=>{void stop();},idleMs);
    }
  };
  return {
    generate(source,request,progress,options){const task=queue.then(()=>generate(source,request,progress,options));queue=task.catch(()=>{});return task;},
    async close(){closed=true;await stop();},
  };
}
export function installOcctCommands(ctx) {
  const run = async name => {
    const source=ctx.doc(), entries=buildingModelEntries(source);
    if(!entries.length) throw Error('이 도면에는 3D 건물 모델이 없습니다. 먼저 건물 모델로 평면·도면 한 벌을 만들거나 모델이 포함된 바른 CAD 도면을 열어 주세요.');
    const picked=ctx.selected?.().map(e=>e.drawingSet?.id || source.occtViews?.[e.occtView]?.modelSetId).find(id=>entries.some(e=>e.id===id));
    const assertCurrent=()=>{ctx.assertCurrent?.();if(ctx.doc()!==source) throw Error('도면이 변경되었습니다. 건물 도면 명령을 다시 실행하세요.');};
    const configure=async entry=>{
      assertCurrent();
      const {pendingEdits}=await import('./drawing-sync.js');
      const synced=pendingEdits(source,entry.id), model=synced.model;
      const generate=async(kind,options)=>{
        assertCurrent();
        const origin=await ctx.pickPoint({prompt:NAMES[name]+' · 삽입할 왼쪽 아래 위치 · Esc 취소'});
        if(!origin) return;
        assertCurrent();
        let service;
        try {
          const request={kind,model,modelSetId:entry.id,options,origin};
          const result=ctx.generateOcctView ? await ctx.generateOcctView(source,request) : await (service=createOcctDrawingService({idleMs:0})).generate(source,request);
          assertCurrent();ctx.execute({type:'lisp.apply',document:result.document});
          ctx.setSelected?.(result.added);ctx.refresh?.();
          ctx.toast?.(NAMES[name]+' · '+result.added.length+'개 삽입 · Ctrl+Z 한 번으로 되돌리기'+(result.ignored?.length?' · 미지원 요소 '+result.ignored.length+'개(계단·문짝 등) 생략':'')+(synced.lost?' · 모델로 옮길 수 없는 손 편집 '+synced.lost+'개는 반영되지 않았습니다.':''));
          return result;
        } finally {await service?.close();}
      };
      if(name==='OCCTPLAN') return ctx.form(NAMES[name],[
        {name:'story',label:'층',value:model.stories[0].id,options:model.stories.map(s=>[s.id,s.name || s.id])},
        {name:'height',label:'바닥 위 절단 높이 (m)',value:1.2,type:'number'}
      ],v=>{
        const height=Number(v.height),story=model.stories.find(s=>s.id===v.story);
        if(!story || String(v.height??'').trim()==='' || !Number.isFinite(height) || height<0 || height*1000>=story.height) throw Error('층과 절단 높이를 확인하세요. 높이는 0 이상, 해당 층 높이 미만입니다.');
        return generate('plan',{story:v.story,height:height*1000});
      });
      if(name==='OCCTSECTION') {
        const refs=planReferences(source,entry), selectedRef=ctx.selected?.().find(e=>refs.some(r=>r.id===e.occtView))?.occtView;
        return ctx.form(NAMES[name],[{name:'reference',label:source.drawingSets[entry.id].kind==='set'?'기준 평면 (도면 한 벌은 먼저 평면도 만들기 권장)':'절단선을 찍을 평면',value:selectedRef || refs.at(-1).id,options:refs.map(r=>[r.id,r.label])}],async v=>{
          const reference=refs.find(r=>r.id===v.reference);if(!reference) throw Error('기준 평면을 선택하세요.');if(reference.invalid)throw Error(reference.invalid);
          assertCurrent();const a=await ctx.pickPoint({prompt:'단면도 · 평면에서 절단선 첫 점 · Esc 취소'});if(!a)return;
          assertCurrent();const b=await ctx.pickPoint({prompt:'단면도 · 절단선 둘째 점 · Esc 취소'});if(!b)return;
          assertCurrent();const look=await ctx.pickPoint({prompt:'단면도 · 절단선에서 바라볼 쪽을 클릭 · Esc 취소'});if(!look)return;
          return generate('section',sectionOptions(a,b,look,reference.translation));
        });
      }
      return ctx.form(NAMES[name],[
        {name:'face',label:'바라보는 입면',value:'south',options:[['south','남측'],['north','북측'],['east','동측'],['west','서측'],['custom','임의 방향']]},
        {name:'angle',label:'임의 방향: 건물에서 관찰자로 향하는 각도 (동=0°, 북=90°)',value:0,type:'number'}
      ],v=>generate('elevation',{direction:elevationDirection(v.face,v.angle)}));
    };
    if(picked || entries.length===1) return configure(entries.find(e=>e.id===picked) || entries[0]);
    return ctx.form(NAMES[name],[{name:'model',label:'3D 건물 모델',value:entries[0].id,options:entries.map(e=>[e.id,e.label])}],v=>{
      const entry=entries.find(e=>e.id===v.model);if(!entry) throw Error('건물 모델을 선택하세요.');return configure(entry);
    });
  };
  return Object.fromEntries(Object.keys(NAMES).map(name=>[name,()=>run(name)]));
}
