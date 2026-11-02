import * as G from './geometry.js';
import {sheetTitleAttributes} from './sheet-layout.js';

export const sortSheets=sheets=>[...sheets].sort((a,b)=>String(a.number).localeCompare(String(b.number),'ko',{numeric:true}));

export function renumberSheets(sheets,{prefix='',start=1,step=1,digits=3,order='number'}={}){
  start=Number(start);step=Number(step);digits=Number(digits);
  if(!Number.isInteger(start)||!Number.isInteger(step)||step===0||!Number.isInteger(digits)||digits<1||digits>8)throw Error('시작 번호·증가값·자리수를 확인하세요.');
  const ordered=order==='position'?[...sheets].sort((a,b)=>a.bounds.minX-b.bounds.minX||b.bounds.maxY-a.bounds.maxY):sortSheets(sheets);
  const numbers=new Map(ordered.map((sheet,index)=>[sheet.id,prefix+String(start+index*step).padStart(digits,'0')]));
  return sheets.map(sheet=>({...structuredClone(sheet),number:numbers.get(sheet.id)}));
}

export function setSheetScale(sheets,{id='all',denominator,paper='keep'}={}){
  denominator=Number(denominator);if(!(Number.isFinite(denominator)&&denominator>0))throw Error('축척은 양수입니다.');
  if(id!=='all'&&!sheets.some(sheet=>sheet.id===id))throw Error('도곽을 찾지 못했습니다.');
  if(paper!=='keep'&&!['A1','A3','A4'].includes(paper))throw Error('용지는 A1/A3/A4입니다.');
  return sheets.map(sheet=>id==='all'||sheet.id===id?{...structuredClone(sheet),denominator,...(paper==='keep'?{}:{paper})}:structuredClone(sheet));
}

const inside=(bounds,outer)=>bounds&&bounds.minX>=outer.minX&&bounds.maxX<=outer.maxX&&bounds.minY>=outer.minY&&bounds.maxY<=outer.maxY;
export function entitiesForSheet(doc,sheet){
  return doc.entities.filter(entity=>entity.sheetId===sheet.id||(!entity.sheetId&&inside(G.bounds([entity]),sheet.bounds)));
}

export function alignSheetPlan(doc,sheets,{direction='horizontal',gap=1000}={}){
  gap=Number(gap);if(!Number.isFinite(gap)||gap<0)throw Error('도곽 간격은 0 이상입니다.');
  if(!['horizontal','vertical'].includes(direction))throw Error('도곽 정렬 방향 오류');
  const updated=structuredClone(sheets),moves=[],moved=new Set();let cursor=0;
  for(const sheet of sortSheets(updated)){
    const b=sheet.bounds,dx=direction==='horizontal'?cursor-b.minX:-b.minX,dy=direction==='vertical'?cursor-b.minY:-b.minY;
    const ids=entitiesForSheet(doc,sheet).map(entity=>entity.id).filter(id=>!moved.has(id));ids.forEach(id=>moved.add(id));
    if(ids.length&&(dx||dy))moves.push({ids,dx,dy});
    const width=b.maxX-b.minX,height=b.maxY-b.minY;
    sheet.bounds=direction==='horizontal'?{minX:cursor,minY:0,maxX:cursor+width,maxY:height}:{minX:0,minY:cursor,maxX:width,maxY:cursor+height};
    cursor+=(direction==='horizontal'?width:height)+gap;
  }
  return {sheets:updated,moves};
}

const remapIds=(entity,idFactory)=>{
  const copy=structuredClone(entity);copy.id=idFactory();if(copy.entities)copy.entities=copy.entities.map(child=>remapIds(child,idFactory));return copy;
};
export function duplicateSheet(doc,sheet,{number,title=sheet.title,dx,dy,idFactory=()=>crypto.randomUUID()}={}){
  if(!sheet)throw Error('복사할 도곽을 찾지 못했습니다.');
  if(!number)throw Error('새 도면 번호를 입력하세요.');
  dx=Number(dx);dy=Number(dy);if(!Number.isFinite(dx)||!Number.isFinite(dy))throw Error('복사 거리를 확인하세요.');
  const id=idFactory(),newSheet={...structuredClone(sheet),id,number,title,bounds:{minX:sheet.bounds.minX+dx,minY:sheet.bounds.minY+dy,maxX:sheet.bounds.maxX+dx,maxY:sheet.bounds.maxY+dy}};
  const entities=entitiesForSheet(doc,sheet).map(entity=>{const copy=G.translate(remapIds(entity,idFactory),dx,dy);copy.sheetId=id;if(copy.sheetFrame&&copy.attributes)copy.attributes={...copy.attributes,NUMBER:number,...sheetTitleAttributes(title,copy.sheetTitleChars || 10)};return copy;});
  return {sheet:newSheet,entities};
}

// Attribute updates travel in the same undo batch as sheet metadata changes.
export function sheetFrameUpdates(doc, sheets) {
  const previous = new Map((doc.sheets || []).map(s => [s.id, s])), next = new Map(sheets.map(s => [s.id, s]));
  return doc.entities.filter(e => e.sheetFrame && next.has(e.sheetId)).flatMap(e => {
    const before = previous.get(e.sheetId), sheet = next.get(e.sheetId), attributes = {...e.attributes};
    if (!before || before.number !== sheet.number) attributes.NUMBER = sheet.number;
    if (!before || before.title !== sheet.title) Object.assign(attributes, sheetTitleAttributes(sheet.title, e.sheetTitleChars || 10));
    if (!before || before.denominator !== sheet.denominator) attributes.SCALE = '1/' + sheet.denominator;
    if (!before || before.paper !== sheet.paper) attributes.PAPER = sheet.paper;
    return JSON.stringify(attributes) === JSON.stringify(e.attributes) ? [] : [{type: 'update', ids: [e.id], changes: {attributes}}];
  });
}

export function clippedSheetDocument(doc,sheet,idFactory=()=>crypto.randomUUID(),entities=null){
  const copy=structuredClone(doc),b=sheet.bounds;
  copy.entities=(entities||doc.entities.filter(entity=>!entity.sheetDecoration)).flatMap(entity=>G.clipToBounds(entity,b)).map(entity=>remapIds(entity,idFactory));
  copy.sheets=[structuredClone(sheet)];return copy;
}

const walk=(entities,fn)=>{for(const entity of entities||[]){fn(entity);walk(entity.entities,fn);}};
export function applyDrawingBatchEdit(source,spec={}){
  const doc=structuredClone(source);let changed=0;
  if(spec.action==='text'){
    const find=String(spec.find??'');if(!find)throw Error('찾을 문자를 입력하세요.');const replace=String(spec.replace??'');
    const edit=entity=>{if(entity.type==='text'&&String(entity.text).includes(find)){entity.text=String(entity.text).split(find).join(replace);changed++;}if(entity.attributes)for(const key of Object.keys(entity.attributes)){const value=String(entity.attributes[key]);if(value.includes(find)){entity.attributes[key]=value.split(find).join(replace);changed++;}}};
    walk(doc.entities,edit);for(const block of doc.blocks||[])walk(block.entities,edit);
  }else if(spec.action==='block'){
    const from=String(spec.from??'').trim(),to=String(spec.to??'').trim();if(!from||!to)throw Error('기존 블록명과 새 블록명을 입력하세요.');
    const edit=entity=>{if(entity.type==='block'&&entity.name===from){entity.name=to;changed++;}};walk(doc.entities,edit);
    for(const block of doc.blocks||[])if(block.name===from){block.name=to;changed++;}
  }else if(spec.action==='layer'){
    const from=String(spec.from??'').trim(),to=String(spec.to??'').trim();if(!from)throw Error('기존 레이어명을 입력하세요.');
    const layer=doc.layers.find(item=>item.name===from);if(!layer)throw Error('레이어를 찾지 못했습니다: '+from);
    if(to&&doc.layers.some(item=>item.id!==layer.id&&item.name===to))throw Error('같은 이름의 레이어가 이미 있습니다: '+to);
    if(to&&to!==layer.name){layer.name=to;changed++;}
    if(spec.color){if(!/^#[0-9a-f]{6}$/i.test(spec.color))throw Error('레이어 색상은 #RRGGBB입니다.');layer.color=spec.color;changed++;}
    if(spec.lineweight!==''&&spec.lineweight!==undefined){const value=Number(spec.lineweight);if(!Number.isFinite(value)||value<0)throw Error('선굵기는 0 이상입니다.');layer.lineweight=value;changed++;}
  }else throw Error('지원하지 않는 일괄 편집 작업입니다.');
  return {document:doc,changed};
}
