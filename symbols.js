import * as G from "./geometry.js";
export function symbol(kind, options, position, rotation, layer) {
  if(['DOOR','WINDOW'].includes(kind))options={frameWidth:kind==='DOOR'?40:50,...(kind==='DOOR'?{leafThickness:40,openingAngle:90}:{}),...options};
  const entities = [],
    line = (a, b) => entities.push({ type: "line", points: [a, b], layer }),
    point = (x, y) => ({ x, y }),
    width = options.width;
  if (!Number.isFinite(width) || width <= 0)
    throw Error("폭은 양수여야 합니다.");
  if (kind === "DOOR") {
    const style=options.style||'single',depth=options.depth||120,frame=options.frameWidth??40,leafThickness=options.leafThickness??40,openingAngle=options.openingAngle??90;
    if(!['single','double','unequal','sliding','doubleSliding','pocket','folding'].includes(style))throw Error('문 종류를 확인하세요.');
    if(!(depth>0&&frame>0&&frame<width/3&&leafThickness>0&&leafThickness<width/5&&openingAngle>0&&openingAngle<=170))throw Error('문틀·문짝 두께 또는 열림 각도(0 초과~170도)를 확인하세요.');
    const rect=(x,y,w,h)=>entities.push({type:'rectangle',layer,points:G.rectangle(point(x,y),point(x+w,y+h))});
    const leaf=(x,w,right=false)=>{
      const ang=right?180-openingAngle:openingAngle,unit=G.polar(1,ang),normal=G.normal(unit),base=point(x,0),tip=G.add(base,G.mul(unit,w));
      entities.push({type:'polyline',closed:true,layer,points:[G.add(base,G.mul(normal,-leafThickness/2)),G.add(tip,G.mul(normal,-leafThickness/2)),G.add(tip,G.mul(normal,leafThickness/2)),G.add(base,G.mul(normal,leafThickness/2))]});
      entities.push({type:'arc',center:base,radius:w,startAngle:right?180-openingAngle:0,endAngle:right?180:openingAngle,layer});
      const handle=G.add(base,G.mul(unit,Math.max(w*.65,w-leafThickness*2.5)));line(G.add(handle,G.mul(normal,leafThickness/2)),G.add(handle,G.mul(normal,leafThickness*1.5)));
    };
    if(style==='single')leaf(0,width);
    else if(style==='double'||style==='unequal'){const ratio=style==='unequal'?(options.leafRatio??.7):.5;if(!(ratio>=.2&&ratio<=.8))throw Error('주문짝 비율은 0.2~0.8입니다.');leaf(0,width*ratio);leaf(width,width*(1-ratio),true);}
    else if(style==='folding'){const count=4,span=width/count;for(let i=0;i<count;i++){const y=i%2?depth*.22:-depth*.22;line(point(i*span,0),point((i+1)*span,y));line(point((i+1)*span,y),point((i+1)*span,0));}}
    else {const spans=style==='doubleSliding'?[[0,-depth*.15,width/2],[width/2,depth*.15,width/2]]:style==='pocket'?[[0,0,width],[width,-depth*.3,width*.45]]:[[0,-depth*.15,width*.55],[width*.45,depth*.15,width*.55]];for(const [x,y,w]of spans){rect(x,y-leafThickness/2,w,leafThickness);line(point(x+w*.5,y),point(x+w*.5+(x?60:-60),y));}line(point(0,-depth/2),point(width,-depth/2));line(point(0,depth/2),point(width,depth/2));}
    rect(-frame,-depth/2,frame,depth);rect(width,-depth/2,frame,depth);
    if((options.frameType||'rebated')==='rebated'){line(point(-frame/2,-depth/2),point(-frame/2,depth/2));line(point(width+frame/2,-depth/2),point(width+frame/2,depth/2));rect(-frame*.3,-leafThickness/2,frame*.3,leafThickness);rect(width,-leafThickness/2,frame*.3,leafThickness);}
    if(options.threshold==='sill')rect(0,-depth/2,width,depth);
    if(options.hand==='right')for(let i=0;i<entities.length;i++)entities[i]=G.mirror(entities[i],point(width/2,0),point(width/2,1));
    if(options.side==='negative')for(let i=0;i<entities.length;i++)entities[i]=G.mirror(entities[i],point(0,0),point(1,0));
  }
  if (kind === "WINDOW") {
    const depth = options.depth;
    const style=options.style||'fixed',frame=options.frameWidth??50;
    if(!['fixed','sliding','casement','awning','tiltTurn'].includes(style))throw Error('창 종류를 확인하세요.');
    if(!(depth>0&&frame>0&&frame<width/3))throw Error('창틀 두께는 창 폭의 1/3보다 작아야 합니다.');
    entities.push({
      type: "rectangle",
      points: G.rectangle(point(0, -depth / 2), point(width, depth / 2)),
      layer,
    });
    line(point(0, 0), point(width, 0));
    line(point(frame, -depth / 2), point(frame, depth / 2));
    line(point(width - frame, -depth / 2), point(width - frame, depth / 2));
    if(style==='sliding'){line(point(frame,-depth*.2),point(width*.55,-depth*.2));line(point(width*.45,depth*.2),point(width-frame,depth*.2));line(point(width/2,-depth/2),point(width/2,depth/2));}
    if(style==='casement'){const x=options.hand==='right'?width-frame:frame,span=width-frame*2;line(point(x,0),point(x,options.side==='negative'?-span:span));entities.push({type:'arc',center:point(x,0),radius:span,startAngle:options.hand==='right'?90:0,endAngle:options.hand==='right'?180:90,layer});if(options.side==='negative')entities[entities.length-1]=G.mirror(entities.at(-1),point(0,0),point(1,0));}
    if(style==='awning'){line(point(frame,-depth/2),point(width/2,depth*.35));line(point(width-frame,-depth/2),point(width/2,depth*.35));}
    if(style==='tiltTurn'){line(point(frame,-depth/2),point(width/2,depth*.35));line(point(width-frame,-depth/2),point(width/2,depth*.35));line(point(frame,depth/2),point(width/2,-depth*.25));line(point(width-frame,depth/2),point(width/2,-depth*.25));}
  }
  if (kind === "STAIR") {
    const count = options.count,
      run = options.run;
    if (
      !Number.isInteger(count) ||
      count < 2 ||
      count > 100 ||
      !Number.isFinite(run) ||
      run <= 0
    )
      throw Error("계단 단수는 2~100의 정수, 디딤판 깊이는 양수입니다.");
    if(options.floorHeight){
      const layout=options.layout||'straight',landing=options.landing??width,gap=options.gap??100;if(!Number.isFinite(gap)||gap<0)throw Error('계단 중앙 간격은 0 이상입니다.');
      if(!['straight','l','u'].includes(layout)||!(landing>0))throw Error('계단 형태와 참 깊이를 확인하세요.');
      if(layout!=='straight'&&landing<width)throw Error('참 깊이는 계단 폭 이상으로 입력하세요.');
      const rect=(x,y,w,h)=>entities.push({type:'rectangle',layer,points:G.rectangle(point(x,y),point(x+w,y+h))});
      const first=layout==='straight'?count:Math.ceil(count/2),second=count-first,n1=Math.max(1,first-1),n2=Math.max(1,second-1),length=n1*run;
      rect(0,0,width,length);for(let i=1;i<n1;i++)line(point(0,i*run),point(width,i*run));
      
      if(layout==='l'){rect(0,length,landing,landing);rect(landing,length,n2*run,width);for(let i=1;i<n2;i++)line(point(landing+i*run,length),point(landing+i*run,length+width));line(point(landing,length+width/2),point(landing+n2*run,length+width/2));}
      if(layout==='u'){rect(0,length,width*2+gap,landing);rect(width+gap,length-n2*run,width,n2*run);for(let i=1;i<n2;i++)line(point(width+gap,length-i*run),point(width*2+gap,length-i*run));line(point(width*1.5+gap,length),point(width*1.5+gap,length-n2*run));}
      const route=layout==='straight'?[point(width/2,0),point(width/2,length)]:layout==='l'?[point(width/2,0),point(width/2,length+width/2),point(landing+n2*run,length+width/2)]:[point(width/2,0),point(width/2,length+landing/2),point(width*1.5+gap,length+landing/2),point(width*1.5+gap,length-n2*run)];
      if(options.direction==='down')route.reverse();entities.push({type:'polyline',layer,points:route});const end=route.at(-1),u=G.unit(G.sub(end,route.at(-2))),normal=G.normal(u),back=G.sub(end,G.mul(u,width/6));line(end,G.add(back,G.mul(normal,width/12)));line(end,G.sub(back,G.mul(normal,width/12)));
      entities.push({type:'text',layer,position:point(width/2,-250),text:`UP ${count}단 / ${Number((options.floorHeight/count).toFixed(1))} mm`,height:100,align:'center'});
    }else{
    entities.push({
      type: "rectangle",
      points: G.rectangle(point(0, 0), point(width, run * count)),
      layer,
    });
    for (let i = 1; i < count; i++)
      line(point(0, i * run), point(width, i * run));
    line(point(width / 2, run * 0.5), point(width / 2, run * (count - 0.5)));
    line(
      point(width / 2, run * (count - 0.5)),
      point(width / 2 - 100, run * (count - 0.5) - 200),
    );
    line(
      point(width / 2, run * (count - 0.5)),
      point(width / 2 + 100, run * (count - 0.5) - 200),
    );
    }
  }
  if(kind==='STAIR'){
    const nosing=options.nosing??30,rail=options.railWidth??38;
    if(!Number.isFinite(nosing)||nosing<0||nosing>=options.run/2||!Number.isFinite(rail)||rail<=0||rail>=width/3)throw Error('논슬립 폭 또는 난간 폭을 확인하세요.');
    const treads=entities.filter(e=>e.type==='line'&&Math.abs(G.dist(...e.points)-width)<1e-6&&(Math.abs(e.points[0].x-e.points[1].x)<1e-6||Math.abs(e.points[0].y-e.points[1].y)<1e-6));
    if(nosing)for(const t of treads){const horizontal=Math.abs(t.points[0].y-t.points[1].y)<1e-6;entities.push({...t,points:t.points.map(p=>({x:p.x+(horizontal?0:nosing),y:p.y+(horizontal?nosing:0)})),detailRole:'nosing'});}
    const flights=entities.filter(e=>e.type==='rectangle'&&(Math.abs(e.points[1].x-e.points[0].x-width)<1e-6||Math.abs(e.points[2].y-e.points[1].y-width)<1e-6));
    if(options.rails!=='none')for(const f of flights){const b=G.bounds([f]),vertical=Math.abs(b.maxX-b.minX-width)<1e-6;for(const end of [0,1]){if(options.rails==='left'&&end===1||options.rails==='right'&&end===0)continue;const a=vertical?point(end?b.maxX-rail:b.minX,b.minY):point(b.minX,end?b.maxY-rail:b.minY),c=vertical?point(a.x+rail,b.maxY):point(b.maxX,a.y+rail);entities.push({type:'rectangle',layer,points:G.rectangle(a,c),detailRole:'rail'});}}
    if(options.direction==='down')for(const e of entities)if(e.type==='text')e.text=e.text.replace('UP','DN');
  }
  return {
    type: "block",
    category:kind,position:{...position},parameters:{...options,kind,x:position.x,y:position.y,rotation,height:options.height??(kind==='DOOR'?2100:kind==='WINDOW'?1500:0),sill:options.sill??(kind==='WINDOW'?900:0)},attributes:{width,height:options.height??(kind==='DOOR'?2100:kind==='WINDOW'?1500:0),depth:options.depth||200},
    name: { DOOR: "문 기호", WINDOW: "창 기호", STAIR: "계단 기호" }[kind],
    layer,
    entities: entities.map((e) =>
      G.translate(
        G.rotate(e, { x: 0, y: 0 }, rotation),
        position.x,
        position.y,
      ),
    ),
  };
}
