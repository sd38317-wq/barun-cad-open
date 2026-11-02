// 편의시설 표기는 화면과 생성기에서 같은 명령을 사용한다. 법 수치는 호출자가 한국 팩에서 준다.
const point = p => Array.isArray(p) ? {x:p[0],y:p[1]} : p;
export function accessMarkEntities(at, {number='1', code='AC', size=300, color='#9dcbe0'}={}) {
  const p=point(at), h=size/2;
  if(!p || ![p.x,p.y,size].every(Number.isFinite) || size<=0)throw Error('편의시설 기호 위치·크기가 잘못되었습니다.');
  return [{type:'circle',center:p,radius:size,color},
    {type:'text',position:{x:p.x,y:p.y+h/2},text:String(number),height:h,align:'center',color},
    {type:'text',position:{x:p.x,y:p.y-h},text:String(code),height:h*0.65,align:'center',color}];
}
export function installAccessMarks(ctx) {
  const layer=()=>ctx.ensureLayer('A-ACCS','#9dcbe0');
  return {
    ACCMARK:()=>ctx.form('편의시설 기호',[{name:'number',value:'1'},{name:'code',value:'AC'},{name:'size',value:300},{name:'color',value:'#9dcbe0'}],async v=>{
      const p=await ctx.pickPoint({prompt:'편의시설 위치'});if(!p)return;
      ctx.commit({entities:accessMarkEntities(p,{...v,size:Number(v.size)}).map(e=>({...e,layer:layer()}))});
    }),
    ACCROUTE:()=>ctx.form('접근 경로',[{name:'color',value:'#9dcbe0'}],async v=>{
      const p=await ctx.pickPath({prompt:'확인된 접근 경로',minPoints:2});if(!p)return;
      ctx.commit({entities:[{type:'polyline',points:p.points,closed:false,layer:layer(),color:v.color,linetype:'DASHED'}]});
    }),
    ACCTURN:()=>ctx.form('휠체어 활동공간',[{name:'width',value:''},{name:'depth',value:''}],async v=>{
      const width=Number(v.width),depth=Number(v.depth);if(![width,depth].every(n=>Number.isFinite(n)&&n>0))throw Error('활동공간 규격을 입력하세요.');
      const p=await ctx.pickPoint({prompt:'활동공간 중심'});if(!p)return;
      ctx.commit({entities:[{type:'circle',center:p,radius:Math.min(width,depth)/2,layer:layer(),linetype:'DASHED'},
        {type:'polyline',points:[[-width/2,-depth/2],[width/2,-depth/2],[width/2,depth/2],[-width/2,depth/2]].map(([x,y])=>({x:p.x+x,y:p.y+y})),closed:true,layer:layer(),linetype:'DASHED'}]});
    }),
    ACCNOTE:()=>ctx.form('편의시설 규격 주기',[{name:'text',value:''},{name:'height',value:150},{name:'color',value:'#9dcbe0'}],async v=>{
      if(!v.text || !(Number(v.height)>0))throw Error('주기·문자높이를 입력하세요.');const p=await ctx.pickPoint({prompt:'주기 위치'});if(!p)return;
      ctx.commit({entities:[{type:'text',position:p,text:String(v.text),height:Number(v.height),color:v.color,layer:layer()}]});
    }),
  };
}
