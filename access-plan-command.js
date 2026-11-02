// ACCPLAN: 실행 당시 도면과 사용자가 입력한 적용 조건을 묶는다.
export function installAccessPlan(ctx){
 return {ACCPLAN: async ()=>{
  const snapshot=ctx.doc();
  ctx.form('장애인시설 계획도',[
   {name:'use',label:'대상 세부용도(의원: clinic)',value:'clinic'},
   {name:'areaM2',label:'해당 용도 면적(m²)',value:'',type:'number'},
   {name:'work',label:'신축/용도변경',value:'change-use',options:[['new','신축'],['change-use','용도변경']]},
   {name:'date',label:'허가/신고일',value:'',type:'date'},
   {name:'story',label:'층/story(선택)',value:''},
   {name:'parkingSpaces',label:'부설주차장 총대수(선택)',value:'',type:'number'},
   {name:'parkingKind',label:'주차장 종류',value:'ancillary',options:[['ancillary','부설'],['off-street','노외']]},
   {name:'noiseDb',label:'공중전화 주변 소음(dB, 선택)',value:'',type:'number'},
   {name:'parkingRatio',label:'지방 설치비율(0~1, 선택)',value:'',type:'number'},
   {name:'rooms',label:'숙박 총객실(선택)',value:'',type:'number'},
   {name:'employmentObligation',label:'공장 고용의무',value:'unknown',options:[['unknown','미상'],['yes','예'],['no','아니오']]},
   {name:'units',label:'연립·다세대 세대수(선택)',value:'',type:'number'},
   {name:'residents',label:'기숙사 인원(선택)',value:'',type:'number'}
  ], values=>{
   if(ctx.doc()!==snapshot)throw Error('도면이 변경되었습니다. 다시 실행하세요.');
   if(!String(values.areaM2??'').trim()||!Number.isFinite(Number(values.areaM2))||Number(values.areaM2)<=0)throw Error('해당 용도 면적을 입력하세요.');
   const date=String(values.date??'').trim();
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error('허가/신고일을 YYYY-MM-DD로 입력하세요.');
   const facility={use:String(values.use||'').trim(),areaM2:Number(values.areaM2),work:values.work,date,parkingKind:values.parkingKind||'ancillary'};
   for(const key of ['parkingSpaces','parkingRatio','rooms','units','residents','noiseDb']){
    const raw=String(values[key]??'').trim();if(!raw)continue;const n=Number(raw);
    if(!Number.isFinite(n)||n<0||(key==='parkingRatio'?n>1:key==='noiseDb'?false:!Number.isInteger(n)))throw Error(key+' 값을 확인하세요.');
    facility[key]=n;
   }
   if(values.employmentObligation==='yes')facility.employmentObligation=true;
   else if(values.employmentObligation==='no')facility.employmentObligation=false;
   return ctx.generateAccessPlan(snapshot,{facility,story:values.story||undefined}).catch(e=>ctx.toast?.(e?.message||String(e),true));
  });
 }};
}
