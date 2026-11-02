import {imageEntity,loadImageSource,commitImage,alignImage} from './image-underlay.js';

export function installImageCommands(ctx){
 const attach=async args=>{
  const snapshot=ctx.doc(),source=await loadImageSource(args,{api:ctx.api});
  if(ctx.doc()!==snapshot)throw Error('도면이 변경되었습니다. 다시 실행하세요.');
  const position=await ctx.pickPoint('이미지 왼쪽 아래 삽입점 · Esc 취소');if(!position)return;
  return ctx.form('이미지 밑그림 폭',[{name:'width',label:'도면에서 이미지 폭 (mm)',type:'number',value:source.pixelWidth}],v=>{
   if(ctx.doc()!==snapshot)throw Error('도면이 변경되었습니다. 다시 실행하세요.');
   const entity=imageEntity({...args,position,width:Number(v.width)},source);commitImage(ctx,entity);ctx.toast?.('이미지 밑그림을 넣었습니다. IMAGEALIGN으로 두 점을 맞출 수 있습니다.');
  });
 };
 return {
  IMAGEATTACH(){
   if(ctx.scripted)return ctx.form('이미지 파일',[{name:'path',label:'이미지 절대 경로',type:'text',value:''}],v=>{ctx.scripted.requireText('이미지 절대 경로',v.path);return attach({path:v.path});});
   ctx.pickFiles('.jpg,.jpeg,.png,.bmp',false,async files=>{
    const file=files[0];if(!file)return;if(file.size>50*1024*1024)throw Error('이미지는 50MB 이하만 사용할 수 있습니다.');
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('파일을 읽을 수 없습니다.'));reader.readAsDataURL(file);});
    return attach({data,path:globalThis.window?.cadDesktop?.filePath?.(file)||file.path||undefined});   // 검토 A5: Electron 44 엔 file.path 가 없다 — 경로가 없으면 DXF·DWG 저장 때 IMAGE 가 빠진다
   });
  },
  async IMAGEALIGN(){
   const image=await ctx.pickEntity({prompt:'맞출 이미지 테두리를 선택하세요',types:['image']});if(!image)return;
   const snapshot=ctx.doc(),points=[];
   for(const prompt of ['이미지 위 기준 첫 점','이미지 위 기준 둘째 점','도면 위 대응 첫 점','도면 위 대응 둘째 점']){const p=await ctx.pickPoint(prompt+' · Esc 취소');if(!p)return;points.push(p);}
   if(ctx.doc()!==snapshot)throw Error('도면이 변경되었습니다. 다시 실행하세요.');
   // Use the current image transform to convert clicked drawing coordinates to top-left pixels.
   const r=(image.rotation||0)*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
   const px=p=>{const x=p.x-image.position.x,y=p.y-image.position.y;return [(x*c+y*s)*image.pixelWidth/image.width,image.pixelHeight-(-x*s+y*c)*image.pixelHeight/image.height];};
   const placement=alignImage(image.pixelWidth,image.pixelHeight,{imagePoints:points.slice(0,2).map(px),drawingPoints:points.slice(2).map(p=>[p.x,p.y])});
   ctx.execute({type:'update',ids:[image.id],changes:placement});ctx.refresh?.();ctx.toast?.('두 기준점에 이미지 위치·축척·회전을 맞췄습니다.');
  },
 };
}
