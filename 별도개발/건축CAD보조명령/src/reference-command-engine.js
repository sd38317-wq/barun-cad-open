import {referenceCommands} from './reference-command-catalog.js';

const clone=value=>structuredClone(value);
const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const point=(value={x:0,y:0})=>({x:finite(value.x??value[0]),y:finite(value.y??value[1])});
const points=value=>(Array.isArray(value)&&value.length?value:[{x:0,y:0},{x:4000,y:0},{x:4000,y:3000},{x:0,y:3000}]).map(point);
const distance=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
const polygonArea=value=>Math.abs(value.reduce((sum,current,index)=>{const next=value[(index+1)%value.length];return sum+current.x*next.y-next.x*current.y;},0))/2;
const perimeter=value=>value.reduce((sum,current,index)=>sum+distance(current,value[(index+1)%value.length]),0);
const bounds=value=>{const ps=value.flatMap(entity=>entity.points||[entity.position,entity.center].filter(Boolean)).map(point);return ps.length?{minX:Math.min(...ps.map(p=>p.x)),minY:Math.min(...ps.map(p=>p.y)),maxX:Math.max(...ps.map(p=>p.x)),maxY:Math.max(...ps.map(p=>p.y))}:null;};
const inside=(p,polygon)=>{let result=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if(((a.y>p.y)!==(b.y>p.y))&&(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x))result=!result;}return result;};
const translate=(entity,dx,dy)=>{const next=clone(entity),move=p=>({x:p.x+dx,y:p.y+dy,...(p.z===undefined?{}:{z:p.z})});if(next.position)next.position=move(next.position);if(next.center)next.center=move(next.center);if(next.points)next.points=next.points.map(move);if(next.entities)next.entities=next.entities.map(item=>translate(item,dx,dy));return next;};
const rotatePoint=(p,base,degrees)=>{const radians=degrees*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians),x=p.x-base.x,y=p.y-base.y;return {x:base.x+x*c-y*s,y:base.y+x*s+y*c};};
const transform=(entity,fn)=>{const next=clone(entity);if(next.position)next.position=fn(next.position);if(next.center)next.center=fn(next.center);if(next.points)next.points=next.points.map(fn);if(next.entities)next.entities=next.entities.map(item=>transform(item,fn));return next;};
const safeName=value=>String(value||'untitled').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim()||'untitled';
const firstPoint=entity=>entity.position||entity.center||entity.points?.[0]||{x:0,y:0};
const textEntity=(text,position,layer,height=150)=>({type:'text',text:String(text),position:point(position),height,layer});
const lineEntity=(a,b,layer,extra={})=>({type:'line',points:[point(a),point(b)],layer,...extra});
const polyEntity=(value,layer,extra={})=>({type:'polyline',points:points(value),layer,...extra});

const ALIAS_INDEX=new Map();
for(const command of referenceCommands)for(const alias of command.aliases){const key=alias.toUpperCase(),rows=ALIAS_INDEX.get(key)||[];rows.push(command);ALIAS_INDEX.set(key,rows);}

const HOST_ALIASES=new Set(['EXP','OL','ON','OPA','QQ','BRUNINSTALL','BRBACKUP','BRRESTORE','B2X','BEX','CX','QWB','P2M','VPS','VSD','BAK','IB','FCC','MSL','PPP','SVS','SAB','C2E','E2C','HEX','LEX']);
const READ_ONLY_PATTERN=/표시|목록|확인|검토|세기|합산|조회|정보|통계/;

export function referenceCommandStrategy(command){
 const label=command.label;
 let action='update';
 if(HOST_ALIASES.has(command.alias.toUpperCase()))action='host';
 else if(/그리기|작성|넣기|생성|박스/.test(label))action='create';
 else if(/삭제|지우기|퍼지/.test(label))action='delete';
 else if(/선택/.test(label))action='select';
 else if(READ_ONLY_PATTERN.test(label))action='inspect';
 else if(/복사|미러|배열|등분/.test(label))action='copy';
 else if(/계산|면적|길이|거리|숫자|평을|m2|합산/.test(label))action='calculate';
 return Object.freeze({id:`${command.id}:${action}`,action,category:command.category,mutates:!['host','inspect','select','calculate'].includes(action),requiresHost:action==='host'});
}

export const referenceCommandImplementations=Object.freeze(Object.fromEntries(referenceCommands.map(command=>[command.id,referenceCommandStrategy(command)])));

export function createReferenceDocument(){return {version:1,name:'건축보조명령_작업도면',activeLayer:'L0',layers:[{id:'L0',name:'0',color:'#ffffff',visible:true,locked:false,frozen:false},{id:'LW',name:'A-WALL',color:'#79d4ff',visible:true,locked:false,frozen:false},{id:'LT',name:'A-TEXT',color:'#ffd479',visible:true,locked:false,frozen:false}],entities:[],blocks:[],xrefs:[],layouts:[{id:'MODEL',name:'모형',viewports:[]}],settings:{background:'dark',inputLanguage:'auto',ucsAngle:0},artifacts:[],selection:[],audit:[]};}

function normalizeDocument(document){const value=clone(document||createReferenceDocument());value.layers??=[];value.entities??=[];value.blocks??=[];value.xrefs??=[];value.layouts??=[];value.settings??={};value.artifacts??=[];value.selection??=[];value.audit??=[];return value;}

export class ReferenceCommandEngine{
 constructor(document=createReferenceDocument(),{host=null,idFactory=null}={}){this.document=normalizeDocument(document);this.undoStack=[];this.redoStack=[];this.host=host;this.sequence=this.document.entities.reduce((maximum,entity)=>{const match=/^REF-E(\d+)$/.exec(String(entity.id||''));return Math.max(maximum,match?Number(match[1]):0);},0);this.idFactory=idFactory||(()=>`REF-E${String(++this.sequence).padStart(5,'0')}`);}
 getCommand(alias,commandId){const rows=ALIAS_INDEX.get(String(alias).trim().toUpperCase())||[];const command=commandId?rows.find(row=>row.id===commandId):rows[0];if(!command)throw Error(commandId?`명령 행을 찾을 수 없습니다: ${commandId}`:`등록되지 않은 참조 명령입니다: ${alias}`);return command;}
 layer(){return this.document.layers.find(layer=>layer.id===this.document.activeLayer)||this.document.layers[0];}
 targets(input={}){const ids=new Set(input.targetIds?.length?input.targetIds:this.document.selection);return ids.size?this.document.entities.filter(entity=>ids.has(entity.id)):this.document.entities;}
 assertEditable(entities){for(const entity of entities){const layer=this.document.layers.find(item=>item.id===entity.layer);if(layer?.locked)throw Error(`잠긴 레이어의 객체는 변경할 수 없습니다: ${layer.name}`);}}
 add(entities){const layer=this.layer()?.id;const added=entities.map(entity=>({...clone(entity),id:entity.id||this.idFactory(),layer:entity.layer||layer}));this.document.entities.push(...added);this.document.selection=added.map(entity=>entity.id);return added;}
 updateEntities(changes){const map=new Map(changes.map(entity=>[entity.id,entity]));this.document.entities=this.document.entities.map(entity=>map.get(entity.id)||entity);this.document.selection=changes.map(entity=>entity.id);return changes;}
 execute(alias,input={},options={}){
  const command=this.getCommand(alias,options.commandId),strategy=referenceCommandImplementations[command.id],before=clone(this.document);
  let result;
  try{result=this.#execute(command,strategy,clone(input));}
  catch(error){this.document=before;throw error;}
  const changed=JSON.stringify(before)!==JSON.stringify(this.document);
  if(changed){this.undoStack.push(before);if(this.undoStack.length>100)this.undoStack.shift();this.redoStack=[];}
  const record={commandId:command.id,alias:command.alias,label:command.label,category:command.category,strategy:strategy.id,status:strategy.requiresHost&&!this.host?'host-ready':'executed',changed,result:clone(result),timestamp:new Date(0).toISOString()};
  this.document.audit.push(record);return record;
 }
 undo(){if(!this.undoStack.length)return false;this.redoStack.push(clone(this.document));this.document=this.undoStack.pop();return true;}
 redo(){if(!this.redoStack.length)return false;this.undoStack.push(clone(this.document));this.document=this.redoStack.pop();return true;}
 serialize(){return JSON.stringify(this.document);}
 static reopen(serialized,options={}){const document=JSON.parse(serialized);if(document?.version!==1||!Array.isArray(document.layers)||!Array.isArray(document.entities))throw Error('건축 보조명령 도면 형식이 올바르지 않습니다.');return new ReferenceCommandEngine(document,options);}

 #execute(command,strategy,input){
  if(strategy.requiresHost)return this.#host(command,input);
  switch(command.category){
   case '기타':return this.#utility(command,input);
   case '자르기 및 끌기':return this.#cut(command,input);
   case '도형 및 선':return this.#geometry(command,input);
   case '면적 및 계산':return this.#calculation(command,input);
   case '열기, 닫기 및 설정':return this.#host(command,input);
   case '멀티도구':return this.#transform(command,input);
   case '그리기':return this.#drawing(command,input);
   case '블럭 및 외부참조':return this.#block(command,input);
   case '문자 수정':return this.#text(command,input);
   case '선택':return this.#selection(command,input);
   case '레이어':return this.#layer(command,input);
   case '종이공간':return this.#layout(command,input);
   case '문자 생성 및 증가':return this.#textCreate(command,input);
   case '기호':return this.#symbol(command,input);
   case '출력 및 저장':return this.#output(command,input);
   case '치수':return this.#dimension(command,input);
   case '해치 및 표':return this.#hatchTable(command,input);
   case '도곽 관련':return this.#sheet(command,input);
   case '도형 및 기호':return this.#shape(command,input);
   default:throw Error(`지원하지 않는 명령 분류입니다: ${command.category}`);
  }
 }
 #host(command,input){const effect={kind:'host-action',commandId:command.id,alias:command.alias,label:command.label,payload:clone(input),previewRequired:true};if(this.host?.execute)return this.host.execute(effect);this.document.artifacts.push({...effect,status:'awaiting-host'});return effect;}
 #utility(command,input){
  const targets=this.targets(input),alias=command.alias;
  if(alias==='FLT'){this.assertEditable(targets);return this.updateEntities(targets.map(entity=>transform(entity,p=>({x:p.x,y:p.y,z:0}))));}
  if(alias==='CT'){if(targets.length<2)throw Error('원본과 대상 객체가 필요합니다.');this.assertEditable(targets.slice(1));const source=targets[0],changes=targets.slice(1).map(entity=>({...entity,color:source.color,linetype:source.linetype,lineweight:source.lineweight,layer:input.copyLayer?source.layer:entity.layer}));return this.updateEntities(changes);}
  if(alias==='DTS')return this.add([textEntity(input.text||'1970-01-01',input.position||{x:0,y:0},this.layer().id,finite(input.height,150))]);
  if(['COM','STT'].includes(alias)){this.document.settings={...this.document.settings,...input.settings,lastConfiguration:alias};return clone(this.document.settings);}
  if(alias==='CV'){this.assertEditable(targets);return this.updateEntities(targets.map(entity=>({...entity,...clone(input.changes||{color:'#ffffff'})})));}
  if(alias==='GEE'){this.document.selection=targets.map(entity=>entity.id);return {groupIds:[...this.document.selection]};}
  if(alias==='STL'){const imported=(input.entities||[]).map(clone);return {imported:this.add(imported).length};}
  return this.#calculation(command,input);
 }
 #cut(command,input){
  const targets=this.targets(input);this.assertEditable(targets);const alias=command.alias;
  if(alias==='CUT'){const polygon=points(input.boundary),removed=targets.filter(entity=>inside(firstPoint(entity),polygon));this.document.entities=this.document.entities.filter(entity=>!removed.includes(entity));return {deletedIds:removed.map(entity=>entity.id)};}
  if(['STR'].includes(alias)){const dx=finite(input.dx,500),dy=finite(input.dy,0);return this.updateEntities(targets.map(entity=>translate(entity,dx,dy)));}
  if(['DTP'].includes(alias)){const created=targets.flatMap(entity=>(entity.points||[]).slice(1).map((p,index)=>lineEntity(entity.points[index],p,entity.layer)));this.document.entities=this.document.entities.filter(entity=>!targets.includes(entity));return this.add(created);}
  if(['BAT','BB'].includes(alias)){const at=point(input.position||firstPoint(targets[0]||{})),created=[textEntity(input.text||command.alias,at,this.layer().id),lineEntity({x:at.x-500,y:at.y},{x:at.x+500,y:at.y},this.layer().id)];return this.add(created);}
  const gap=Math.max(1,finite(input.gap,100)),changes=targets.map(entity=>{const next=clone(entity);if(next.points?.length>=2){const a=next.points[0],b=next.points.at(-1),length=distance(a,b),ratio=Math.min(.45,gap/(length||1));next.points=[a,{x:a.x+(b.x-a.x)*(0.5-ratio),y:a.y+(b.y-a.y)*(0.5-ratio)},{x:a.x+(b.x-a.x)*(0.5+ratio),y:a.y+(b.y-a.y)*(0.5+ratio)},b];next.breakGap=gap;}next.editOperation=alias;return next;});return this.updateEntities(changes);
 }
 #geometry(command,input){
  const targets=this.targets(input),alias=command.alias;if(!targets.length&&!["ZIGZAG","BS","PAA","XLD"].includes(alias))return this.#drawing(command,input);
  if(alias==='DMD'){const a=firstPoint(targets[0]),b=firstPoint(targets[1]||{position:point(input.end||{x:1000,y:0})}),value=distance(a,b);return {distance:value,annotation:this.add([textEntity(value.toFixed(2),{x:(a.x+b.x)/2,y:(a.y+b.y)/2},this.layer().id)])[0]};}
  if(alias==='PVL'){return {rows:targets.flatMap(entity=>(entity.points||[]).map((p,index)=>[entity.id,index+1,p.x,p.y]))};}
  this.assertEditable(targets);
  if(alias==='3TP')return this.updateEntities(targets.map(entity=>transform(entity,p=>({x:p.x,y:p.y}))));
  if(alias==='PC')return this.updateEntities(targets.map(entity=>({...entity,closed:true})));
  if(alias==='DRL')return this.updateEntities(targets.map(entity=>({...entity,points:[...(entity.points||[])].reverse()})));
  if(alias==='PV'){return this.updateEntities(targets.map(entity=>{const ps=[...(entity.points||[])],at=point(input.position||ps[Math.max(0,ps.length-1)]||{x:0,y:0});ps.splice(Math.max(1,finite(input.index,ps.length-1)),0,at);return {...entity,points:ps};}));}
  if(alias==='PVV')return this.updateEntities(targets.map(entity=>({...entity,points:(entity.points||[]).filter((_,index)=>index!==finite(input.index,1))})));
  if(alias==='PVS')return this.updateEntities(targets.map(entity=>({...entity,points:(entity.points||[]).map((p,index)=>index===finite(input.index,1)?point(input.position||p):p)})));
  if(alias==='PVR')return this.updateEntities(targets.map(entity=>({...entity,points:(entity.points||[]).filter((p,index,array)=>index===0||distance(p,array[index-1])>finite(input.tolerance,1))})));
  if(['PW','PWD'].includes(alias))return this.updateEntities(targets.map(entity=>({...entity,width:Math.max(0,finite(input.width,100)),outline:alias==='PWD'})));
  if(alias==='PBB'){const box=bounds(targets);return box?this.add([polyEntity([{x:box.minX,y:box.minY},{x:box.maxX,y:box.minY},{x:box.maxX,y:box.maxY},{x:box.minX,y:box.maxY}],this.layer().id,{closed:true})]):[];}
  if(alias==='ZIGZAG'){const start=point(input.start),end=point(input.end||{x:4000,y:0}),teeth=Math.max(2,Math.trunc(finite(input.teeth,8))),ps=Array.from({length:teeth+1},(_,index)=>({x:start.x+(end.x-start.x)*index/teeth,y:start.y+(end.y-start.y)*index/teeth+(index%2?finite(input.amplitude,200):0)}));return this.add([polyEntity(ps,this.layer().id)]);}
  return this.#drawing(command,input);
 }
 #calculation(command,input){
  const ps=points(input.points),values=(input.values||[]).map(value=>finite(value)),alias=command.alias;let value;
  if(alias==='M2')value=finite(input.pyeong??values[0],1)*3.305785;
  else if(alias==='PY')value=finite(input.squareMeters??values[0],1)/3.305785;
  else if(['LIS','DM'].includes(alias))value=this.targets(input).reduce((sum,entity)=>sum+(entity.points||[]).slice(1).reduce((s,p,index)=>s+distance(entity.points[index],p),0),0);
  else if(alias==='QD')value=distance(point(input.start),point(input.end||{x:1000,y:0}));
  else if(alias==='NP')value=values.reduce((sum,current,index)=>index%2?sum+current*values[index-1]:sum,0);
  else if(alias==='NS')value=values.filter((_,index)=>index%2===0).reduce((a,b)=>a+b,0)-values.filter((_,index)=>index%2).reduce((a,b)=>a+b,0);
  else if(alias==='ND')value={first:values.filter((_,index)=>index%2===0).reduce((a,b)=>a+b,0),second:values.filter((_,index)=>index%2).reduce((a,b)=>a+b,0)};
  else if(['00','ABC','NUC'].includes(alias))value=values.reduce((a,b)=>a+b,0);
  else value={area:polygonArea(ps),perimeter:perimeter(ps)};
  const result={value,unit:['M2','PY','AE','DAR','MRT','SAR','SCA'].includes(alias)?'㎡':'drawing-unit'};
  if(/표|문자|표기|표시|기록/.test(command.label)){const position=point(input.position||ps[0]),text=typeof value==='object'?JSON.stringify(value):String(Number(value).toFixed(3));result.entities=this.add([textEntity(text,position,this.layer().id)]);}
  return result;
 }
 #transform(command,input){
  const targets=this.targets(input);if(!targets.length)return {changed:0};this.assertEditable(targets);const alias=command.alias,base=point(input.base||firstPoint(targets[0]));
  if(['DAC','DVC','MC','RDC','CIN','CNL','CR','CTL'].includes(alias)){const count=Math.max(1,Math.trunc(finite(input.count,3))),copies=[];for(let index=1;index<=count;index++)for(const entity of targets){let copy=translate(entity,finite(input.dx,1000)*index,finite(input.dy,0)*index);if(alias==='DAC'||alias==='CR')copy=transform(copy,p=>rotatePoint(p,base,finite(input.angle,360/(count+1))*index));delete copy.id;copies.push(copy);}return this.add(copies);}
  if(alias==='DDE'){const seen=new Set(),removed=[];this.document.entities=this.document.entities.filter(entity=>{const key=JSON.stringify({...entity,id:undefined});if(seen.has(key)){removed.push(entity.id);return false;}seen.add(key);return true;});return {deletedIds:removed};}
  if(alias==='MII')return this.add(targets.map(entity=>{const copy=transform(entity,p=>({x:base.x-(p.x-base.x),y:p.y}));delete copy.id;return copy;}));
  if(['RM','RR'].includes(alias))return this.updateEntities(targets.map(entity=>transform(entity,p=>rotatePoint(p,base,finite(input.angle,90)))));
  if(['SM','SS'].includes(alias)){const factor=finite(input.scale,2);if(factor<=0)throw Error('축척은 양수여야 합니다.');return this.updateEntities(targets.map(entity=>transform(entity,p=>({x:base.x+(p.x-base.x)*factor,y:base.y+(p.y-base.y)*factor}))));}
  if(['OB','OC','OE','OI','OM','OO','OT'].includes(alias)){const dx=finite(input.distance,200),copies=targets.map(entity=>translate(entity,0,dx));if(alias==='OE')this.document.entities=this.document.entities.filter(entity=>!targets.includes(entity));return this.add(copies.map(entity=>({...entity,id:undefined,offsetSource:entity.id})));}
  if(['OA','OAA'].includes(alias)){const box=bounds(targets),target=point(input.target);if(!box)return [];return this.updateEntities(targets.map(entity=>translate(entity,target.x-box.minX,target.y-box.minY)));}
  if(['SB'].includes(alias)){this.document.entities=this.document.entities.filter(entity=>!targets.includes(entity));this.document.entities.unshift(...targets);return {order:'back',ids:targets.map(entity=>entity.id)};}
  return this.updateEntities(targets.map(entity=>({...entity,lastOperation:alias,length:finite(input.length,entity.length||1000)})));
 }
 #drawing(command,input){
  const origin=point(input.origin||input.position),w=Math.max(1,finite(input.width,3000)),h=Math.max(1,finite(input.height,2100)),layer=this.layer().id,alias=command.alias;
  const outline=polyEntity([{x:origin.x,y:origin.y},{x:origin.x+w,y:origin.y},{x:origin.x+w,y:origin.y+h},{x:origin.x,y:origin.y+h}],layer,{closed:true,role:command.label});
  const entities=[outline,lineEntity({x:origin.x,y:origin.y+h/2},{x:origin.x+w,y:origin.y+h/2},layer,{role:`${alias}-axis`}),textEntity(command.label,{x:origin.x+w/2,y:origin.y+h/2},layer,Math.max(100,Math.min(w,h)*.08))];
  if(['WAL','CW','CEN','CEP'].includes(alias))return this.add([polyEntity(input.points||[{x:origin.x,y:origin.y},{x:origin.x+w,y:origin.y}],layer,{width:finite(input.thickness,200),role:command.label})]);
  return this.add([{type:'block',name:alias,category:command.label,position:origin,parameters:{width:w,height:h,...clone(input.parameters||{})},entities}]);
 }
 #block(command,input){
  const targets=this.targets(input),blocks=targets.filter(entity=>entity.type==='block'),alias=command.alias;
  if(alias==='XRL')return {rows:this.document.xrefs.map(xref=>[xref.name,xref.path,xref.status||'loaded'])};
  if(alias==='RBP'){this.document.xrefs=this.document.xrefs.map(xref=>({...xref,name:String(xref.name||'').replace(/\$[^$]*\$/g,''),path:String(xref.path||'').replace(/\$[^$]*\$/g,'')}));return clone(this.document.xrefs);}
  if(['REX','MFX','XRC','XRR'].includes(alias)){this.document.xrefs=this.document.xrefs.map(xref=>({...xref,status:input.status||'loaded',color:input.color||xref.color,layersReset:alias==='XRR'}));return clone(this.document.xrefs);}
  if(['ABX','BCO','EAR','M2B','XCX'].includes(alias)){this.assertEditable(blocks);this.document.entities=this.document.entities.filter(entity=>!blocks.includes(entity));const exploded=blocks.flatMap(block=>(block.entities||[]).map(entity=>translate({...entity,id:undefined},block.position?.x||0,block.position?.y||0)));return this.add(exploded);}
  if(['BAM','BAD'].includes(alias)){this.assertEditable(targets);const box=bounds(targets),base=point(input.base||{x:box?.minX||0,y:box?.minY||0}),block={type:'block',name:safeName(input.name||`BLOCK_${this.document.blocks.length+1}`),position:base,entities:targets.map(entity=>translate({...entity,id:undefined},-base.x,-base.y)),attributes:{...input.attributes}};this.document.entities=this.document.entities.filter(entity=>!targets.includes(entity));this.document.blocks.push(clone(block));return this.add([block]);}
  if(alias==='BBL')return this.add([polyEntity(blocks.map(block=>firstPoint(block)),this.layer().id)]);
  if(['BCH','BRN'].includes(alias)){this.assertEditable(blocks);return this.updateEntities(blocks.map(block=>({...block,name:safeName(input.name||'REPLACED_BLOCK')})));}
  if(alias==='BIN'){this.assertEditable(blocks);return this.updateEntities(blocks.map(block=>({...block,position:point(input.position)})));}
  if(['BLA','BCC'].includes(alias)){this.assertEditable(blocks);const layer=input.layer||this.layer().id;return this.updateEntities(blocks.map(block=>({...block,layer,entities:(block.entities||[]).map(entity=>({...entity,layer}))})));}
  if(alias==='BNM')return this.add(blocks.map(block=>textEntity(block.name,firstPoint(block),this.layer().id)));
  if(alias==='BRM'){
   this.assertEditable(blocks);
   const index=finite(input.index,0);
   return this.updateEntities(blocks.map(block=>({...block,entities:(block.entities||[]).filter((_,itemIndex)=>itemIndex!==index)})));
  }
  if(alias==='BSC'){input.scale??=2;return this.#transform({...command,alias:'SM'},{...input,targetIds:blocks.map(block=>block.id)});}
  if(['MX'].includes(alias)){this.assertEditable(blocks);return this.updateEntities(blocks.map(block=>({...block,clip:{enabled:true,points:points(input.points)}})));}
  if(['BEX','QWB'].includes(alias))return this.#host(command,{...input,blocks});
  if(alias==='Q1')return {blocks:clone(this.document.blocks)};
  return {blocks:clone(blocks),xrefs:clone(this.document.xrefs)};
 }
 #text(command,input){
  const targets=this.targets(input).filter(entity=>['text','mtext'].includes(entity.type));if(!targets.length)return {changed:0};this.assertEditable(targets);const alias=command.alias;
  let changes=targets.map(clone);
  if(alias==='FAM'){const find=String(input.find||'');return {selectedIds:targets.filter(entity=>entity.text.includes(find)).map(entity=>entity.id)};}
  if(alias==='FAR'){const find=String(input.find||'');if(!find)throw Error('찾을 문자가 필요합니다.');changes=changes.map(entity=>({...entity,text:entity.text.split(find).join(String(input.replace||''))}));}
  else if(alias==='TAP')changes=changes.map(entity=>({...entity,text:`${input.prefix||''}${entity.text}${input.suffix||''}`}));
  else if(['TD','TSP'].includes(alias)){const delimiter=String(input.separator||' '),created=changes.flatMap(entity=>entity.text.split(delimiter).filter(Boolean).map((text,index)=>({...entity,id:undefined,text,position:{x:entity.position.x,y:entity.position.y-index*finite(input.gap,200)}})));this.document.entities=this.document.entities.filter(entity=>!targets.includes(entity));return this.add(created);}
  else if(alias==='TM'){const text=changes.map(entity=>entity.text).join(String(input.separator||' ')),position=changes[0].position;this.document.entities=this.document.entities.filter(entity=>!targets.includes(entity));return this.add([textEntity(text,position,changes[0].layer,changes[0].height)]);}
  else if(alias==='TSW'&&changes.length>=2){const value=changes[0].text;changes[0].text=changes[1].text;changes[1].text=value;}
  else if(['TS','TW'].includes(alias))changes=changes.map(entity=>({...entity,height:alias==='TS'?Math.max(1,finite(input.height,200)):entity.height,widthFactor:alias==='TW'?Math.max(.01,finite(input.widthFactor,1)):entity.widthFactor}));
  else if(['MSK','TSH'].includes(alias))changes=changes.map(entity=>({...entity,backgroundMask:true}));
  else if(['TJ','TO','TOA','TSO'].includes(alias)){const target=point(input.position),axis=input.axis||'x';changes=changes.map(entity=>({...entity,position:{...entity.position,[axis]:target[axis]}}));}
  else changes=changes.map(entity=>({...entity,text:String(input.text??entity.text),textStyle:input.style||entity.textStyle||'Standard',formatting:alias==='MDF'?null:entity.formatting}));
  return this.updateEntities(changes);
 }
 #selection(command,input){
  let selected=this.document.entities;if(command.alias==='SE'){const sample=selected.find(entity=>entity.id===(input.sampleId||this.document.selection[0]))||selected[0];selected=sample?selected.filter(entity=>entity.type===sample.type&&(!input.matchLayer||entity.layer===sample.layer)):[];}
  else {const polygon=points(input.points);selected=selected.filter(entity=>inside(firstPoint(entity),polygon));}
  this.document.selection=selected.map(entity=>entity.id);return {selectedIds:[...this.document.selection]};
 }
 #layer(command,input){
  const alias=command.alias,selectedIds=new Set(input.layerIds?.length?input.layerIds:this.targets(input).map(entity=>entity.layer)),all=this.document.layers;
  const update=(predicate,changes)=>{for(const layer of all)if(predicate(layer))Object.assign(layer,typeof changes==='function'?changes(layer):changes);};
  if(alias==='LUI'){const state=this.document.settings.previousLayerState;if(state)this.document.layers=clone(state);return clone(this.document.layers);}
  this.document.settings.previousLayerState=clone(all);
  if(['LF','LFF','LFK'].includes(alias))update(layer=>!selectedIds.has(layer.id),alias==='LF'?{visible:false}:alias==='LFF'?{frozen:true}:{locked:true});
  else if(alias==='LTG')update(()=>true,layer=>({visible:!layer.visible}));
  else if(['LL','LLL','LK','LU'].includes(alias))update(layer=>selectedIds.has(layer.id),alias==='LL'?{visible:false}:alias==='LLL'?{frozen:true}:alias==='LK'?{locked:true}:{locked:false});
  else if(['LO','LOO','LUK'].includes(alias))update(()=>true,alias==='LO'?{visible:true}:alias==='LOO'?{frozen:false,visible:true}:{locked:false});
  else if(alias==='LOS')update(layer=>selectedIds.has(layer.id),{visible:true});
  else if(alias==='ELY'){const blocked=all.filter(layer=>selectedIds.has(layer.id)&&layer.locked);if(blocked.length)throw Error('잠긴 레이어는 삭제할 수 없습니다.');this.document.entities=this.document.entities.filter(entity=>!selectedIds.has(entity.layer));}
  else if(alias==='LAM'){const target=input.targetLayer||this.layer().id,sources=new Set(input.sourceLayers||[...selectedIds].filter(id=>id!==target));this.document.entities=this.document.entities.map(entity=>sources.has(entity.layer)?{...entity,layer:target}:entity);this.document.layers=all.filter(layer=>!sources.has(layer.id));}
  else if(['LC','LCC','LCD','LCO','LCS'].includes(alias)){const targets=this.targets(input);this.assertEditable(targets);const target=input.targetLayer||this.layer().id;this.updateEntities(targets.map(entity=>({...entity,layer:target})));}
  else if(['LRN','LRL'].includes(alias))update(layer=>selectedIds.has(layer.id),layer=>({name:safeName(input.name||`${layer.name}_변경`)}));
  else if(alias==='LFD')this.document.settings.layerFilters=[];
  else if(alias==='LP')update(layer=>selectedIds.has(layer.id),clone(input.changes||{color:'#79d4ff'}));
  else if(alias==='LQT')return {count:all.length,rows:all.map(layer=>[layer.name,this.document.entities.filter(entity=>entity.layer===layer.id).length])};
  else if(alias==='LST')return {rows:all.map(layer=>[layer.name,layer.color,layer.visible,layer.locked])};
  else if(['LLC','LFC','ECO','ECF','EOO','ESF','ESO'].includes(alias)){const color=input.color||this.targets(input)[0]?.color,ids=new Set(this.targets(input).map(entity=>entity.id));for(const entity of this.document.entities){if(alias==='EOO')entity.hidden=false;else if(alias==='ESF'&&ids.has(entity.id))entity.hidden=true;else if(alias==='ESO'&&!ids.has(entity.id))entity.hidden=true;else if(['ECO','ECF'].includes(alias)&&entity.color===color)entity.hidden=alias==='ECF';} }
  else this.document.settings.lastLayerOperation=alias;
  return clone(this.document.layers);
 }
 #layout(command,input){
  const alias=command.alias,layout=this.document.layouts.find(item=>item.id===(input.layoutId||'MODEL'))||this.document.layouts[0];
  if(alias==='TRN')layout.name=safeName(input.name||`${layout.name}_변경`);
  else if(['VL','VLL','VU','VUU'].includes(alias))for(const viewport of layout.viewports)viewport.locked=['VL','VLL'].includes(alias);
  else if(alias==='VMO')layout.viewports.push({id:this.idFactory(),name:input.name||'뷰포트',modelWindow:clone(input.modelWindow||{minX:0,minY:0,maxX:10000,maxY:7000}),paperWindow:clone(input.paperWindow||{minX:20,minY:20,maxX:400,maxY:277}),denominator:Math.max(1,finite(input.scale,100)),locked:false});
  else if(alias==='VR')for(const viewport of layout.viewports)viewport.rotation=finite(input.angle,90);
  else if(alias==='VGL'){const viewport=layout.viewports[0],window=viewport?.modelWindow||{minX:0,minY:0,maxX:10000,maxY:7000};return this.add([polyEntity([{x:window.minX,y:window.minY},{x:window.maxX,y:window.minY},{x:window.maxX,y:window.maxY},{x:window.minX,y:window.maxY}],this.layer().id,{closed:true,role:'viewport-outline'})]);}
  else if(['VPS','VSD','P2M'].includes(alias))return this.#host(command,{...input,layout:clone(layout)});
  else layout.settings={...layout.settings,...clone(input.settings||{}),lastOperation:alias};
  return clone(layout);
 }
 #textCreate(command,input){
  const alias=command.alias,positions=(input.points?.length?input.points:[input.position||{x:0,y:0}]).map(point),count=Math.max(1,Math.trunc(finite(input.count,positions.length))),start=finite(input.sequenceStart??input.start,1),step=finite(input.step,1);
  if(['TIC','TIE','TIN'].includes(alias)){const targets=this.targets(input).filter(entity=>['text','mtext'].includes(entity.type));this.assertEditable(targets);const changed=targets.map(entity=>({...entity,text:entity.text.replace(/-?\d+(?:\.\d+)?/,value=>String(Number(value)+step))}));return alias==='TIE'?this.add(changed.map(entity=>({...entity,id:undefined,position:{x:entity.position.x+finite(input.dx,300),y:entity.position.y}}))):this.updateEntities(changed);}
  if(alias==='TTT'){const rows=this.targets(input).filter(entity=>['text','mtext'].includes(entity.type)).map(entity=>[entity.text,entity.position.x,entity.position.y]);return this.add([{type:'table',rows,position:positions[0],layer:this.layer().id}]);}
  if(alias==='TX'){return this.add(this.targets(input).filter(entity=>['text','mtext'].includes(entity.type)).map(entity=>{const p=entity.position,w=(entity.text.length||1)*entity.height*.7,h=entity.height*1.4;return polyEntity([{x:p.x,y:p.y},{x:p.x+w,y:p.y},{x:p.x+w,y:p.y+h},{x:p.x,y:p.y+h}],entity.layer,{closed:true});}));}
  const values=Array.from({length:count},(_,index)=>alias==='QW'?(input.symbols||['±','Ø','㎡','°'])[index%4]:alias==='QT'?(input.sentences||['마감 확인','상세도 참조'])[index%2]:`${input.prefix||''}${start+step*index}${input.suffix||''}`);
  return this.add(values.map((value,index)=>textEntity(value,positions[index]||{x:positions[0].x+index*finite(input.spacing,500),y:positions[0].y},this.layer().id,finite(input.height,150))));
 }
 #symbol(command,input){
  if(command.alias==='WSL')return {rows:this.document.entities.filter(entity=>entity.category==='WINDOW'||/창/.test(entity.name||'')).map(entity=>[entity.name||'창',entity.parameters?.width||'',entity.parameters?.height||''])};
  const origin=point(input.position),size=Math.max(10,finite(input.size,500)),layer=this.layer().id,alias=command.alias;
  const circle={type:'circle',center:origin,radius:size,layer,role:command.label},axis=lineEntity({x:origin.x-size*1.4,y:origin.y},{x:origin.x+size*1.4,y:origin.y},layer),label=textEntity(input.text||alias,origin,layer,size*.45);
  if(alias==='WU')return this.add([polyEntity(input.points||[{x:origin.x,y:origin.y},{x:origin.x+3000,y:origin.y}],layer,{role:'drain-line',linetype:'DASHED'}),label]);
  if(alias==='CM')return this.add(Array.from({length:12},(_,index)=>({type:'arc',center:{x:origin.x+Math.cos(index*Math.PI/6)*size,y:origin.y+Math.sin(index*Math.PI/6)*size},radius:size*.3,startAngle:0,endAngle:180,layer})));
  return this.add([{type:'block',name:alias,position:origin,category:'SYMBOL',entities:[circle,axis,label]}]);
 }
 #output(command,input){
  const alias=command.alias;
  if(['A0','A1'].includes(alias)){this.document.settings.ucsAngle=alias==='A0'?0:finite(input.angle,30);return {ucsAngle:this.document.settings.ucsAngle};}
  if(['AON','AOFF'].includes(alias)){this.document.settings.inputLanguage=alias==='AON'?'auto':'manual';return {inputLanguage:this.document.settings.inputLanguage};}
  if(alias==='TBC'){this.document.settings.background=this.document.settings.background==='dark'?'light':'dark';return {background:this.document.settings.background};}
  if(['KCI','KCL','MTB1','MTB2','RUB'].includes(alias))return this.#drawing(command,input);
  if(alias==='MK'){return this.#text({...command,alias:'MSK'},input);}
  if(alias==='SOL'){return this.#hatchTable({...command,alias:'HT'},input);}
  if(alias==='PB'){const box=polyEntity(input.points,this.layer().id,{closed:true,plotBox:true});return this.add([box]);}
  if(alias==='PBD'){const removed=this.document.entities.filter(entity=>entity.plotBox);this.document.entities=this.document.entities.filter(entity=>!entity.plotBox);return {deletedIds:removed.map(entity=>entity.id)};}
  if(alias==='PBM'){const targets=this.targets(input);return this.add(targets.map(entity=>({...clone(entity),id:undefined,plotBox:true,closed:true})));}
  if(alias==='PUA'){const usedLayers=new Set(this.document.entities.map(entity=>entity.layer));this.document.layers=this.document.layers.filter(layer=>layer.id==='L0'||usedLayers.has(layer.id));this.document.blocks=this.document.blocks.filter(block=>this.document.entities.some(entity=>entity.type==='block'&&entity.name===block.name));return {purged:true};}
  return this.#host(command,input);
 }
 #dimension(command,input){
  const targets=this.targets(input).filter(entity=>entity.type==='dimension'),alias=command.alias;
  if(['LX','TL','CC','DPL','DQ','IL'].includes(alias)||!targets.length){const ps=points(input.points),created=[];for(let index=1;index<ps.length;index++)created.push({type:'dimension',points:[ps[index-1],ps[index]],measurement:distance(ps[index-1],ps[index]),text:input.text||'',layer:this.layer().id,style:input.style||'Standard'});return this.add(created);}
  this.assertEditable(targets);let changes=targets.map(clone);
  if(alias==='CDE')changes=changes.map(entity=>({...entity,text:String(input.text||'')}));
  else if(['DSC','ED'].includes(alias))changes=changes.map(entity=>({...entity,scale:Math.max(.001,finite(input.scale,100))}));
  else if(alias==='DDT')changes=changes.map(entity=>({...entity,extensionVisible:false}));
  else if(['DG','DLA','DLL','DTM','DH'].includes(alias))changes=changes.map((entity,index)=>({...entity,offset:finite(input.offset,500)*(index+1),textPosition:input.position?point(input.position):entity.textPosition}));
  else if(alias==='DTO')changes=changes.map(entity=>({...entity,prefix:String(input.prefix||''),suffix:String(input.suffix||'')}));
  else if(alias==='DTT')return this.add([{type:'table',position:point(input.position),layer:this.layer().id,rows:targets.map(entity=>[entity.measurement,entity.text||''])}]);
  else if(alias==='SD'){const created=targets.flatMap(entity=>{const [a,b]=entity.points,m={x:(a.x+b.x)/2,y:(a.y+b.y)/2};return [{...entity,id:undefined,points:[a,m],measurement:distance(a,m)},{...entity,id:undefined,points:[m,b],measurement:distance(m,b)}];});this.document.entities=this.document.entities.filter(entity=>!targets.includes(entity));return this.add(created);}
  else changes=changes.map(entity=>({...entity,style:input.style||'Barun-Dimension',updated:true}));
  return this.updateEntities(changes);
 }
 #hatchTable(command,input){
  const alias=command.alias,targets=this.targets(input);
  if(['C2E','E2C','HEX'].includes(alias))return this.#host(command,input);
  if(['TB','TBT','TBM','RDT','TAJ'].includes(alias)){const table=targets.find(entity=>entity.type==='table');if(table){this.assertEditable([table]);const next=clone(table);next.rows=clone(input.rows||next.rows||[['A','B'],['1','2']]);next.cellSpacing=finite(input.spacing,10);next.merges=clone(input.merges||next.merges||[]);return this.updateEntities([next]);}return this.add([{type:'table',position:point(input.position),rows:clone(input.rows||[['항목','값'],[command.label,'1']]),layer:this.layer().id}]);}
  const polygon=points(input.points),hatch={type:'hatch',points:polygon,closed:true,pattern:alias==='CON'?'CONCRETE':input.pattern||'ANSI31',spacing:Math.max(1,finite(input.spacing,100)),angle:finite(input.angle,45),solid:['RDS','HT'].includes(alias),layer:this.layer().id};
  if(['HC','HM','HP','HPM','HR','SHO','BPT'].includes(alias)&&targets.some(entity=>entity.type==='hatch')){const hatches=targets.filter(entity=>entity.type==='hatch');this.assertEditable(hatches);if(alias==='HM'){const all=hatches.flatMap(entity=>entity.points||[]);this.document.entities=this.document.entities.filter(entity=>!hatches.includes(entity));return this.add([{...hatch,points:all}]);}return this.updateEntities(hatches.map(entity=>({...entity,pattern:hatch.pattern,spacing:hatch.spacing,angle:hatch.angle,origin:point(input.origin)})));}
  return this.add([hatch]);
 }
 #sheet(command,input){
  const sheets=this.document.entities.filter(entity=>entity.sheet),alias=command.alias;
  if(alias==='TN'){this.assertEditable(sheets);return this.updateEntities(sheets.map((sheet,index)=>({...sheet,sheet:{...sheet.sheet,number:`${input.prefix||'A-'}${finite(input.start,1)+index}`}})));}
  if(['DAS','DSB'].includes(alias)){this.assertEditable(sheets);return this.updateEntities(sheets.map(sheet=>({...sheet,sheet:{...sheet.sheet,scale:Math.max(1,finite(input.scale,100))}})));}
  if(alias==='DBS'){this.assertEditable(sheets);return this.updateEntities(sheets.map((sheet,index)=>translate(sheet,index*finite(input.spacing,12000)-firstPoint(sheet).x,0)));}
  if(alias==='MDL')return this.add([{type:'table',position:point(input.position),layer:this.layer().id,rows:sheets.map(sheet=>[sheet.sheet?.number||'',sheet.sheet?.title||'',sheet.sheet?.scale||''])}]);
  if(alias==='PBS')return {rows:sheets.map(sheet=>({id:sheet.id,bounds:bounds([sheet]),valid:!!bounds([sheet])}))};
  if(alias==='TOB'){const targets=this.targets(input);return this.#block({...command,alias:'BAM'},{...input,targetIds:targets.map(entity=>entity.id)});}
  if(['BMT','DBC'].includes(alias)){const copies=sheets.map((sheet,index)=>translate({...sheet,id:undefined},finite(input.dx,12000)*(index+1),finite(input.dy,0)));return this.add(copies);}
  return {sheets:clone(sheets),operation:alias};
 }
 #shape(command,input){
  const origin=point(input.origin),alias=command.alias;
  if(alias==='R3'){const a=point(input.a||origin),b=point(input.b||{x:a.x+3000,y:a.y}),c=point(input.c||{x:a.x+3000,y:a.y+2000});return this.add([polyEntity([a,b,c,{x:a.x+(c.x-b.x),y:a.y+(c.y-b.y)}],this.layer().id,{closed:true})]);}
  if(alias==='RS'){return this.add([polyEntity(input.points,this.layer().id,{closed:true,filled:true})]);}
  if(['ATC','OTC'].includes(alias))return this.add([{type:'circle',center:origin,radius:Math.max(1,finite(input.radius,1000)),layer:this.layer().id,tangent:alias==='OTC'}]);
  if(alias==='OOL'){const box=bounds(this.targets(input));return box?this.add([polyEntity([{x:box.minX,y:box.minY},{x:box.maxX,y:box.minY},{x:box.maxX,y:box.maxY},{x:box.minX,y:box.maxY}],this.layer().id,{closed:true})]):[];}
  if(alias==='LSC'){const targets=this.targets(input);this.assertEditable(targets);return this.updateEntities(targets.map(entity=>({...entity,linetypeScale:Math.max(.001,finite(input.scale,1))})));}
  if(alias==='LXP'){const targets=this.targets(input);this.assertEditable(targets);const created=targets.flatMap(entity=>(entity.points||[]).slice(1).map((p,index)=>lineEntity(entity.points[index],p,entity.layer)));this.document.entities=this.document.entities.filter(entity=>!targets.includes(entity));return this.add(created);}
  return this.#drawing(command,input);
 }
}

export function validateReferenceCommandEngine(){
 const missing=referenceCommands.filter(command=>!referenceCommandImplementations[command.id]);
 return {rows:referenceCommands.length,implemented:referenceCommands.length-missing.length,missing:missing.map(command=>command.id),strategies:new Set(Object.values(referenceCommandImplementations).map(item=>item.action)).size,hostRequired:referenceCommands.filter(command=>referenceCommandImplementations[command.id].requiresHost).length};
}
