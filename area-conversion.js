const numberPattern=/[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)/;

export function formatAreaValue(value,precision=4){
 if(!Number.isFinite(value))throw Error('변환할 면적 숫자가 올바르지 않습니다.');
 return Number(value.toFixed(precision)).toLocaleString('ko-KR',{maximumFractionDigits:precision});
}

export function convertAreaText(text,direction){
 const source=String(text),match=source.match(numberPattern);
 if(!match)throw Error('선택한 문자에서 변환할 숫자를 찾지 못했습니다.');
 const value=Number(match[0].replaceAll(',','')),factor=direction==='py-to-m2'?400/121:direction==='m2-to-py'?121/400:null;
 if(!factor)throw Error('면적 변환 방향을 확인할 수 없습니다.');
 let result=source.slice(0,match.index)+formatAreaValue(value*factor)+source.slice(match.index+match[0].length);
 result=direction==='py-to-m2'?result.replace(/\s*평/u,' ㎡'):result.replace(/\s*(?:㎡|m²|m2)/iu,' 평');
 return result;
}

export function areaConversionChanges(entity,direction){
 if(entity.type==='text')return {text:convertAreaText(entity.text,direction)};
 if(entity.type==='block'&&Array.isArray(entity.entities)){
  let changed=0;
  const visit=item=>{
   if(item.type==='text'){try{const text=convertAreaText(item.text,direction);changed++;return {...item,text};}catch{return item;}}
   return Array.isArray(item.entities)?{...item,entities:item.entities.map(visit)}:item;
  };
  const entities=entity.entities.map(visit);
  if(changed)return {entities};
 }
 throw Error('숫자가 있는 문자 또는 문자 블록을 선택하세요.');
}
