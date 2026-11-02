import {referenceCommands} from './reference-command-catalog.js';

const clone=value=>structuredClone(value??{});
const finite=(value,name)=>{const number=Number(value);if(!Number.isFinite(number))throw new TypeError(`${name}은(는) 유한한 숫자여야 합니다.`);return number;};
const points=value=>{
 if(!Array.isArray(value))return [];
 return value.map((point,index)=>({x:finite(point?.x??point?.[0],`points[${index}].x`),y:finite(point?.y??point?.[1],`points[${index}].y`)}));
};
const distance=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
const perimeter=value=>value.length<2?0:value.reduce((sum,point,index)=>sum+distance(point,value[(index+1)%value.length]),0);
const area=value=>Math.abs(value.reduce((sum,point,index)=>sum+point.x*value[(index+1)%value.length].y-value[(index+1)%value.length].x*point.y,0))/2;
const bounds=value=>value.length?{minX:Math.min(...value.map(p=>p.x)),minY:Math.min(...value.map(p=>p.y)),maxX:Math.max(...value.map(p=>p.x)),maxY:Math.max(...value.map(p=>p.y))}:null;

const aliasIndex=new Map();
for(const command of referenceCommands){
 for(const alias of command.aliases){
  const key=alias.toUpperCase();
  const current=aliasIndex.get(key)??[];
  current.push(command);
  aliasIndex.set(key,current);
 }
}

const base=(command,input,result,operations=[])=>({
 commandId:command.id,
 alias:command.alias,
 label:command.label,
 category:command.category,
 status:'ready-for-host',
 result,
 operations,
 source:clone(command.source),
 integration:{enabled:false,required:true}
});

const plan=(command,input,kind,extra={})=>base(command,input,{input:clone(input)},[{kind,command:command.alias,targetIds:[...(input.targetIds??[])],parameters:{...clone(input),...extra}}]);

const utilityHandler=(command,input)=>plan(command,input,'document.utility',{action:command.label});
const editHandler=(command,input)=>{
 const geometry=points(input.points);
 return base(command,input,{entityCount:(input.entities??[]).length,geometry,bounds:bounds(geometry)},[{kind:'geometry.edit',action:command.label,targetIds:[...(input.targetIds??[])],geometry,parameters:clone(input.options)}]);
};
const drawingHandler=(command,input)=>{
 const path=points(input.points);
 const origin=points([input.origin??{x:0,y:0}])[0];
 const width=input.width===undefined?1000:finite(input.width,'width');
 const height=input.height===undefined?1000:finite(input.height,'height');
 return base(command,input,{origin,width,height,path,bounds:path.length?bounds(path):{minX:origin.x,minY:origin.y,maxX:origin.x+width,maxY:origin.y+height}},[{kind:'geometry.create',entityRole:command.label,geometry:{origin,width,height,path},layerRole:input.layerRole??command.category}]);
};
const areaHandler=(command,input)=>{
 const polygon=points(input.points);
 const values=(input.values??[]).map((value,index)=>finite(value,`values[${index}]`));
 const polyArea=polygon.length>=3?area(polygon):0;
 const polyPerimeter=polygon.length>=2?perimeter(polygon):0;
 const sum=values.reduce((total,value)=>total+value,0);
 const product=values.reduce((total,value)=>total*value,values.length?1:0);
 const result={values,sum,product,area:polyArea,perimeter:polyPerimeter,squareMetersFromPyeong:input.pyeong===undefined?undefined:finite(input.pyeong,'pyeong')*3.305785,pyeongFromSquareMeters:input.squareMeters===undefined?undefined:finite(input.squareMeters,'squareMeters')/3.305785};
 return base(command,input,result,[{kind:'calculation.result',action:command.label,result}]);
};
const textHandler=(command,input)=>{
 const texts=(input.texts??[]).map(String);
 const find=input.find===undefined?'':String(input.find);
 const replace=input.replace===undefined?'':String(input.replace);
 let output=[...texts];
 if(/찾아 바꾸기/.test(command.label)&&find)output=output.map(text=>text.split(find).join(replace));
 else if(/접두어 접미어/.test(command.label))output=output.map(text=>`${input.prefix??''}${text}${input.suffix??''}`);
 else if(/병합/.test(command.label))output=[output.join(input.separator??' ')];
 else if(/분리|잘라서/.test(command.label))output=output.flatMap(text=>text.split(input.separator??' ').filter(Boolean));
 else if(/서로 교체/.test(command.label)&&output.length>=2)[output[0],output[1]]=[output[1],output[0]];
 return base(command,input,{input:texts,output},[{kind:'text.update',action:command.label,values:output,targetIds:[...(input.targetIds??[])]}]);
};
const sequenceHandler=(command,input)=>{
 const count=Math.max(0,Math.trunc(finite(input.count??1,'count')));
 const start=finite(input.start??1,'start');
 const step=finite(input.step??1,'step');
 const values=Array.from({length:count},(_,index)=>`${input.prefix??''}${start+step*index}${input.suffix??''}`);
 return base(command,input,{values},[{kind:'text.create',action:command.label,values,points:points(input.points)}]);
};
const selectionHandler=(command,input)=>{
 const entities=clone(input.entities??[]);
 const selected=entities.filter(entity=>{
  if(input.type&&entity.type!==input.type)return false;
  if(input.layer&&entity.layer!==input.layer)return false;
  if(input.color!==undefined&&entity.color!==input.color)return false;
  if(input.bounds&&entity.point){const b=input.bounds;return entity.point.x>=b.minX&&entity.point.x<=b.maxX&&entity.point.y>=b.minY&&entity.point.y<=b.maxY;}
  return true;
 });
 return base(command,input,{selectedIds:selected.map(entity=>entity.id),count:selected.length},[{kind:'selection.replace',ids:selected.map(entity=>entity.id)}]);
};
const layerHandler=(command,input)=>{
 const layers=clone(input.layers??[]);
 const names=new Set(input.layerNames??[]);
 const updates=layers.map(layer=>{
  const selected=!names.size||names.has(layer.name);
  const next={...layer};
  if(selected&&/끔|OFF/.test(command.label))next.visible=false;
  if(selected&&/켬|ON/.test(command.label))next.visible=true;
  if(selected&&/얼림/.test(command.label))next.frozen=true;
  if(selected&&/녹임/.test(command.label))next.frozen=false;
  if(selected&&/잠금/.test(command.label))next.locked=true;
  if(selected&&/풀림/.test(command.label))next.locked=false;
  if(selected&&input.renameTo)next.name=String(input.renameTo);
  if(selected&&input.color!==undefined)next.color=input.color;
  return next;
 });
 return base(command,input,{layers:updates},[{kind:'layer.update',action:command.label,layers:updates}]);
};
const tableHandler=(command,input)=>{
 const rows=clone(input.rows??[]);
 const columns=rows.reduce((maximum,row)=>Math.max(maximum,Array.isArray(row)?row.length:0),0);
 return base(command,input,{rows,rowCount:rows.length,columnCount:columns},[{kind:/해치/.test(command.label)?'hatch.update':'table.update',action:command.label,rows,options:clone(input.options)}]);
};
const dimensionHandler=(command,input)=>{
 const measured=input.value===undefined?undefined:finite(input.value,'value');
 const scale=finite(input.scale??1,'scale');
 const display=measured===undefined?undefined:`${input.prefix??''}${Number((measured*scale).toFixed(input.precision??2))}${input.suffix??''}`;
 return base(command,input,{measured,scale,display},[{kind:'dimension.update',action:command.label,targetIds:[...(input.targetIds??[])],display,scale}]);
};
const hostPlanHandler=(command,input)=>plan(command,input,'host.transaction',{action:command.label,requiresPreview:true,requiresUndo:true});

const categoryHandlers={
 '기타':utilityHandler,
 '열기, 닫기 및 설정':hostPlanHandler,
 '자르기 및 끌기':editHandler,
 '멀티도구':editHandler,
 '그리기':drawingHandler,
 '기호':drawingHandler,
 '도형 및 선':editHandler,
 '도형 및 기호':drawingHandler,
 '면적 및 계산':areaHandler,
 '문자 수정':textHandler,
 '문자 생성 및 증가':sequenceHandler,
 '선택':selectionHandler,
 '레이어':layerHandler,
 '해치 및 표':tableHandler,
 '치수':dimensionHandler,
 '블럭 및 외부참조':hostPlanHandler,
 '종이공간':hostPlanHandler,
 '도곽 관련':hostPlanHandler,
 '출력 및 저장':hostPlanHandler
};

export const getReferenceCommands=alias=>aliasIndex.get(String(alias).trim().toUpperCase())??[];

export function executeReferenceCommand(alias,input={},options={}){
 const matches=getReferenceCommands(alias);
 if(!matches.length)throw new RangeError(`등록되지 않은 참조 명령입니다: ${alias}`);
 const command=options.commandId?matches.find(item=>item.id===options.commandId):matches[0];
 if(!command)throw new RangeError(`명령 행을 찾을 수 없습니다: ${options.commandId}`);
 const handler=categoryHandlers[command.category];
 if(!handler)throw new Error(`처리기가 없는 분류입니다: ${command.category}`);
 return handler(command,clone(input));
}

export const validateReferenceCoverage=()=>{
 const missing=referenceCommands.filter(command=>typeof categoryHandlers[command.category]!=='function');
 return {rows:referenceCommands.length,codedRows:referenceCommands.length-missing.length,missing:missing.map(command=>command.id),handlerCategories:Object.keys(categoryHandlers).length,cadIntegratedRows:0};
};

export const referenceHandlers=Object.freeze({...categoryHandlers});
