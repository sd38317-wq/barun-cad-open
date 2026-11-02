// The candidate is an entity, not a layer: two lines on one layer remain distinct.
export class OverlapSelection {
  clear(){this.ids=[];this.index=-1;this.anchor=null;this.context=null;this.base=new Set();}
  constructor(){this.clear();}
  pick(candidates, point, context, selected, advance=false){
    const ids=candidates.map(e=>e.id);
    const candidateIds=new Set(ids);
    const same=this.context===context&&this.anchor&&Math.hypot(point.x-this.anchor.x,point.y-this.anchor.y)<=6&&ids.length===this.ids.length&&this.ids.every(id=>candidateIds.has(id));
    if(!same){this.ids=ids;this.anchor={...point};this.context=context;this.base=new Set(selected);this.index=0;
      if(advance){const current=ids.findIndex(id=>selected.has(id));if(current>=0){this.base.delete(ids[current]);this.index=(current+1)%ids.length;}}
      if(!advance)this.base.delete(ids[0]);
    }else if(advance)this.index=(this.index+1)%ids.length;
    return candidates.find(entity=>entity.id===this.ids[this.index]);
  }
  select(id){const i=this.ids.indexOf(id);if(i<0)return null;this.index=i;return new Set([...this.base,id]);}
}

export function createOverlapPanel({document,onSelect,onClose}){
  const panel=document.createElement('aside');panel.className='overlap-selection-panel';panel.hidden=true;panel.setAttribute('aria-label','겹친 객체 레이어');
  panel.addEventListener('keydown',event=>{if(event.key!=='Escape')event.stopPropagation();});
  const head=document.createElement('div');head.className='overlap-selection-heading';
  const title=document.createElement('strong');title.textContent='겹친 객체';
  const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','겹친 객체 목록 닫기');close.onclick=onClose;
  head.append(title,close);const help=document.createElement('p');help.textContent='Shift + 좌클릭으로 순환 · 목록에서도 선택';
  const list=document.createElement('div');list.className='overlap-selection-list';panel.append(head,help,list);document.body.append(panel);
  const types={line:'선',polyline:'폴리선',dimension:'치수',text:'문자',block:'블록',hatch:'해치',arc:'호',circle:'원',wall:'벽체'};
  return {hide(){panel.hidden=true;list.replaceChildren();},show(candidates,layers,current){
    title.textContent=`겹친 객체 ${candidates.length}개`;list.replaceChildren();
    for(const [i,entity] of candidates.entries()){
      const layer=layers.get(entity.layer),button=document.createElement('button');button.type='button';button.className='overlap-selection-item';
      button.setAttribute('aria-pressed',String(entity.id===current));
      const swatch=document.createElement('span');swatch.className='overlap-selection-swatch';swatch.style.backgroundColor=entity._displayColor||layer?.color||'#fff';
      const knownNames={WALL:'벽체','A-WALL':'벽체',DIM:'치수선','A-DIM':'치수선',DOR:'문','A-DOOR':'문',WIN:'창','A-GLAZ':'창'};
      const name=layer?.name||entity.layer||'레이어 없음',caption=layer?.label||knownNames[name.toUpperCase()]||name;
      const label=document.createElement('span');label.textContent=`${i+1}. ${caption}`;label.title=name;
      const kind=document.createElement('small');kind.textContent=types[entity.type]||entity.type;
      button.append(swatch,label,kind);button.onclick=()=>onSelect(entity.id);list.append(button);
    }panel.hidden=false;
  }};
}
