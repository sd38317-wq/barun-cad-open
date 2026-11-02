// 층 관리: 레이어의 floor·height·elevation 속성을 층 단위로 모아 보고 고친다.
// 자동 평면(plan-floor-bridge.js)·법규 검사(livecheck)와 같은 규칙이다 — 층 정보는 레이어에 있고,
// 바닥 높이가 비어 있으면 아래층 층고를 쌓아 정한다. 층고를 바꾸면 위층 바닥 높이가 모두 따라 올라간다.

/** 레이어가 속한 층 번호. floor 속성이 우선이고, 없으면 이름의 2F·B1 같은 표시를 읽는다. 층이 없으면 null. */
export function layerFloor(layer){
 if(Number.isInteger(layer?.floor)&&layer.floor!==0)return layer.floor;
 const name=String(layer?.name||''),up=name.match(/(?:^|[ _-])(\d+)F(?:$|[ _-])/i);if(up&&Number(up[1])>0)return Number(up[1]);
 const down=name.match(/(?:^|[ _-])B(\d+)(?:F)?(?:$|[ _-])/i);return down&&Number(down[1])>0?-Number(down[1]):null;
}

/** 바닥 높이를 다시 쌓는다. 1층(없으면 가장 낮은 지상층) 바닥이 기준이고, 빠진 층은 바로 아래층 층고로 채운다. */
export function restack(rows,{base}={}){
 const sorted=[...rows].sort((a,b)=>a.floor-b.floor);if(!sorted.length)return sorted;
 const anchorIndex=Math.max(0,sorted.findIndex(r=>r.floor>0));const anchor=sorted[anchorIndex];
 anchor.elevation=base??anchor.elevation??0;
 for(let i=anchorIndex+1;i<sorted.length;i++){const below=sorted[i-1],gap=sorted[i].floor-below.floor-(below.floor<0&&sorted[i].floor>0?1:0);sorted[i].elevation=below.elevation+below.height*gap;}
 for(let i=anchorIndex-1;i>=0;i--){const above=sorted[i+1],row=sorted[i],gap=above.floor-row.floor-(row.floor<0&&above.floor>0?1:0);row.elevation=above.elevation-row.height*gap;}
 return sorted;
}

/** 층 표. 같은 층의 레이어를 묶는다. 저장된 바닥 높이가 있으면 그대로 두고, 없으면 쌓아서 정한다. */
export function storeyTable(doc){
 const floorHeight=Number(doc.reviewSettings?.floorHeight)||3000,byFloor=new Map();
 for(const layer of doc.layers||[]){
  const floor=layerFloor(layer);if(floor===null)continue;
  const row=byFloor.get(floor)||{floor,name:floor>0?floor+'층':'지하 '+(-floor)+'층',height:null,elevation:null,layerIds:[]};
  row.layerIds.push(layer.id);row.height??=Number.isFinite(layer.height)&&layer.height>0?layer.height:null;row.elevation??=Number.isFinite(layer.elevation)?layer.elevation:null;
  byFloor.set(floor,row);
 }
 const rows=[...byFloor.values()].map(r=>({...r,height:r.height??floorHeight,stored:r.elevation}));
 const anchor=rows.filter(r=>r.floor>0).sort((a,b)=>a.floor-b.floor)[0]??rows.sort((a,b)=>a.floor-b.floor)[0];
 // 1층이 없으면 빠진 아래층을 기본 층고로 본다(이름만 2F 인 레이어는 3,000mm 위 — 예전 3D 규칙과 같다).
 const stacked=restack(rows.map(r=>({...r})),{base:anchor?.elevation??(anchor?.floor>1?(anchor.floor-1)*floorHeight:0)});
 return stacked.map(r=>({...r,elevation:r.stored??r.elevation})).map(({stored,...r})=>r);
}

/** 레이어의 바닥 높이와 층고(mm). 층이 없는 레이어는 바닥 0, 층고는 레이어 값 또는 기본 층고. */
export function layerLevel(doc,layer,floorHeight=Number(doc.reviewSettings?.floorHeight)||3000,table=storeyTable(doc)){
 const row=table.find(r=>r.layerIds.includes(layer?.id));
 return row?{base:row.elevation,height:row.height,floor:row.floor}:{base:0,height:Number.isFinite(layer?.height)&&layer.height>0?layer.height:floorHeight,floor:null};
}

/** 고친 층 표를 레이어 변경 명령으로 바꾼다. 층고는 양수, 층 번호는 0 이 아닌 정수여야 한다. */
export function storeyCommands(doc,rows){
 const out=[];
 for(const row of restack(rows.map(r=>({...r})),{base:rows.find(r=>r.floor===1)?.elevation})){
  if(!Number.isInteger(row.floor)||row.floor===0)throw Error('층 번호는 0 이 아닌 정수여야 합니다.');
  if(!(Number.isFinite(row.height)&&row.height>0&&row.height<=100000))throw Error(row.name+' 층고는 0보다 크고 100,000mm 이하여야 합니다.');
  for(const id of row.layerIds||[]){const layer=doc.layers.find(l=>l.id===id);if(!layer)continue;
   const changes={floor:row.floor,height:row.height,elevation:row.elevation};
   if(Object.entries(changes).some(([k,v])=>layer[k]!==v))out.push({type:'layer.update',id,changes});}
 }
 return out;
}

export function installStoreys(studio){
 const {engine,execute,toast}=studio.context;
 const dialog=document.createElement('dialog');dialog.id='storeys-dialog';dialog.className='storeys-dialog';
 dialog.innerHTML='<div class="dialog-header"><h2>층 관리</h2><button type="button" class="s-close">닫기 ×</button></div>'
  +'<p class="muted">층고를 바꾸면 위층 바닥 높이가 따라 올라갑니다. 3D·IFC·정북일조 검토가 이 표를 씁니다. 적용은 되돌리기 한 번으로 취소됩니다.</p>'
  +'<table class="s-table"><thead><tr><th>층</th><th>바닥 높이 (mm)</th><th>층고 (mm)</th><th>레이어</th></tr></thead><tbody></tbody></table>'
  +'<div class="s-assign"><label>레이어 <select class="s-layer"></select></label><label>층 <input class="s-floor" type="number" step="1" value="1"></label><button type="button" class="s-add">층에 넣기</button></div>'
  +'<p class="s-note" role="status"></p><div class="dialog-actions"><button type="button" class="s-apply primary">적용</button></div>';
 document.body.append(dialog);dialog.addEventListener('keydown',e=>e.stopPropagation());
 const $=s=>dialog.querySelector(s);let rows=[];
 const layerName=id=>engine.doc.layers.find(l=>l.id===id)?.name||id;
 function render(){
  restack(rows,{base:rows.find(r=>r.floor===1)?.elevation});rows.sort((a,b)=>b.floor-a.floor);
  $('tbody').replaceChildren(...rows.map(row=>{
   const tr=document.createElement('tr');
   const cell=(content)=>{const td=document.createElement('td');td.append(content);tr.append(td);return td;};
   cell(row.name);
   const base=document.createElement('input');base.type='number';base.step='10';base.value=Math.round(row.elevation);base.disabled=row.floor!==1;base.title=row.floor===1?'1층 바닥 높이(기준)':'아래층 층고로 정해집니다';
   base.onchange=()=>{const n=Number(base.value);if(Number.isFinite(n)){row.elevation=n;render();}};cell(base);
   const height=document.createElement('input');height.type='number';height.step='10';height.min='1';height.value=Math.round(row.height);
   height.onchange=()=>{const n=Number(height.value);if(n>0){row.height=n;render();}else{$('.s-note').textContent='층고는 양수여야 합니다.';height.value=row.height;}};cell(height);
   cell(row.layerIds.map(layerName).join(', '));
   return tr;
  }));
  if(!rows.length)$('.s-note').textContent='층이 정해진 레이어가 없습니다. 아래에서 레이어를 층에 넣으세요(레이어 이름의 2F·B1 도 층으로 읽습니다).';
  const assigned=new Set(rows.flatMap(r=>r.layerIds));
  $('.s-layer').replaceChildren(...engine.doc.layers.filter(l=>!assigned.has(l.id)).map(l=>{const o=document.createElement('option');o.value=l.id;o.textContent=l.name;return o;}));
 }
 function open(){rows=storeyTable(engine.doc).map(r=>({...r,layerIds:[...r.layerIds]}));$('.s-note').textContent='';render();if(!dialog.open)dialog.showModal();}
 $('.s-close').onclick=()=>dialog.close();
 $('.s-add').onclick=()=>{
  const id=$('.s-layer').value,floor=Number($('.s-floor').value);
  if(!id){$('.s-note').textContent='넣을 레이어가 없습니다.';return;}
  if(!Number.isInteger(floor)||floor===0){$('.s-note').textContent='층 번호는 0 이 아닌 정수입니다(지하는 -1).';return;}
  let row=rows.find(r=>r.floor===floor);
  if(!row){const below=rows.filter(r=>r.floor<floor).sort((a,b)=>b.floor-a.floor)[0];row={floor,name:floor>0?floor+'층':'지하 '+(-floor)+'층',height:below?.height||Number(engine.doc.reviewSettings?.floorHeight)||3000,elevation:0,layerIds:[]};rows.push(row);}
  row.layerIds.push(id);$('.s-note').textContent=`${layerName(id)} 를 ${row.name}에 넣었습니다. [적용]을 눌러야 도면에 반영됩니다.`;render();
 };
 $('.s-apply').onclick=()=>{
  try{
   const commands=storeyCommands(engine.doc,rows);
   if(!commands.length){$('.s-note').textContent='바뀐 것이 없습니다.';return;}
   engine.beginTransaction();try{for(const c of commands)execute(c);}finally{engine.endTransaction();}
   toast(`층 관리 적용 · 레이어 ${commands.length}개 · Ctrl+Z 로 되돌리기`);open();
  }catch(error){$('.s-note').textContent=error.message;}
 };
 studio.handlers.STOREYS=open;
 return {open};
}
