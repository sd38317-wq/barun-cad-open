// Build only the proposed entities; drawing and commit use the same geometry builders.
// This adapter never allocates document IDs, records undo, or changes the document.
export function dimensionPreview(build) {
 return (pointsOrCursor, cursor) => {
  const points = Array.isArray(pointsOrCursor) ? pointsOrCursor : [];
  const at = Array.isArray(pointsOrCursor) ? cursor : pointsOrCursor;
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return [];
  try {
   const result = build({x: at.x, y: at.y}, points);
   return Array.isArray(result) ? result.filter(Boolean) : result ? [result] : [];
  } catch { return []; }
 };
}

// The point picker returns option tokens without passing them through command aliases.
export async function pickDimensionPlacement(ctx, build, {prompt, linear = false, quadrant = null} = {}) {
 const values = {};
 const make = p => ({...build(p), ...values});
 const choices = ['M','MTEXT','T','TEXT','A','ANGLE', ...(linear ? ['H','HORIZONTAL','V','VERTICAL','R','ROTATED'] : []), ...(quadrant ? ['Q','QUADRANT'] : [])];
 while (true) {
  const at = await ctx.pickPoint({prompt: prompt || '치수선 위치 지정 또는 [여러 줄 문자(M)/문자(T)/각도(A)]', options: choices, preview: dimensionPreview(make)});
  if (!at) return null;
  if (!at.option) return make(at);
  const key = at.option.toUpperCase()[0];
  if (key === 'H' || key === 'V') {values.mode = key === 'H' ? 'horizontal' : 'vertical'; delete values.axisAngle; continue;}
  if (key === 'Q') {const p = await ctx.pickPoint({prompt:'사분점 지정',preview:dimensionPreview(make)});if(!p)return null;quadrant(p);continue;}
  if (typeof ctx.form !== 'function') throw Error('치수 옵션 입력창을 사용할 수 없습니다.');
  const numeric = key === 'A' || key === 'R';
  const value = await new Promise(resolve => ctx.form(numeric ? '각도 지정' : '치수 문자 입력', [{name:'value',label:numeric?'각도': '치수 문자 (<> = 측정값)',type:numeric?'number':key==='M'?'textarea':'text',value:numeric?0:'<>'}], v=>{
   if(numeric&&!Number.isFinite(Number(v.value)))throw Error('각도를 숫자로 입력하세요.');
   resolve(numeric?Number(v.value):String(v.value));
  },()=>resolve(null)));
  if (value === null) return null;
  if (key === 'A') values.textRotation = value;
  else if (key === 'R') {values.axisAngle = value;values.mode = 'horizontal';}
  else values.text = key === 'M' ? value.replaceAll('\\P','\n') : value;
 }
}

export function installDimensionEditing(ctx, geometry) {
 const selected=async()=>{
  let dims=(ctx.selected?.()||[]).filter(e=>e.type==='dimension');
  if(!dims.length){const d=await ctx.pickEntity({prompt:'치수 선택',types:['dimension']});if(d)dims=[d];}
  return dims;
 };
 const ask=async(label,value=0,numeric=true)=>new Promise(resolve=>ctx.form(label,[{name:'value',label,type:numeric?'number':'text',value}],v=>{
  const result=numeric?Number(v.value):String(v.value);
  if(numeric&&!Number.isFinite(result))throw Error('각도를 숫자로 입력하세요.');
  resolve(result);
 },()=>resolve(null)));
 const apply=(dims,changes)=>ctx.execute({type:'batch',commands:dims.map(e=>({type:'update',ids:[e.id],changes}))});
 return {
  async DIMEDIT(){
   const dims=await selected();if(!dims.length)return;
   const option=await ctx.pickPoint({prompt:'치수 편집 유형 입력 [원래 위치(H)/새로 만들기(N)/회전(R)/기울기(O)] <H>',options:['','H','HOME','N','NEW','R','ROTATE','O','OBLIQUE'],preview:dimensionPreview(()=>dims)});
   if(!option)return;
   const key=(option.option||'H')[0];let changes;
   if(key==='H')changes={textPosition:undefined,textRotation:undefined};
   else {const value=await ask(key==='N'?'치수 문자 입력 (<> = 측정값)':key==='R'?'치수 문자 각도 지정':'치수보조선 기울기 각도 지정',key==='N'?'<>':0,key!=='N');if(value===null)return;
    changes=key==='N'?{text:value}:key==='R'?{textRotation:value}:{obliqueAngle:value};}
   const at=await ctx.pickPoint({prompt:'편집 결과 확인 · 클릭하여 적용 · Esc 취소',preview:dimensionPreview(()=>dims.map(e=>({...e,...changes})))});
   if(at)apply(dims,changes);
  },
  async DIMTEXTMOVE(){
   const dims=await selected();if(!dims.length)return;
   const make=p=>dims.map(e=>({...e,textPosition:p}));
   let changes;
   while(true){
    const at=await ctx.pickPoint({prompt:'치수 문자 위치 지정 또는 [왼쪽(L)/오른쪽(R)/중심(C)/원래 위치(H)/각도(A)]',options:['L','LEFT','R','RIGHT','C','CENTER','H','HOME','A','ANGLE'],preview:dimensionPreview(make)});
    if(!at)return;
    if(!at.option){changes={textPosition:at};break;}
    const key=at.option[0];
    if(key==='A'){const value=await ask('치수 문자 각도 지정');if(value===null)return;changes={textRotation:value};}
    else if(key==='H')changes={textPosition:undefined,textRotation:undefined,textAlign:'center'};
    else {const copy={...dims[0],textPosition:undefined},parts=geometry.dimensionParts(copy),label=parts.find(p=>p.dimensionLabel),line=parts.find(p=>p.type==='line');
     const position=key==='C'||!line?label.position:line.points[key==='L'?0:1];changes={textPosition:position,textAlign:key==='L'?'left':key==='R'?'right':'center'};}
    const confirm=await ctx.pickPoint({prompt:'치수 문자 위치 확인 · 클릭하여 적용 · Esc 취소',preview:dimensionPreview(()=>dims.map(e=>({...e,...changes})))});
    if(!confirm)return;break;
   }
   apply(dims,changes);
  }
 };
}
