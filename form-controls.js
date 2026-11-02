// 폼 항목 정의(field) → 실제 input 상태. 체크박스는 브라우저 FormData 가 켜진 것의 value 만 보내므로
// value 를 'on' 으로 통일하고 checked 만 field.value 로 정한다(카드 모듈은 v.name==='on' 으로 읽는다).
const TRUE_WORDS=new Set(['on','yes','true','1']);
export function checkboxState(field={}){
  const checked=field.checked===true||field.value===true||TRUE_WORDS.has(String(field.value??'').trim().toLowerCase());
  return {checked,value:'on'};
}
export function controlValue(field={}){
  if(field.type==='checkbox')return checkboxState(field).value;
  return field.value??'';
}
