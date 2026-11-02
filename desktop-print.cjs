'use strict';
// Printer access is only exposed through the trusted main-window IPC handlers.
const PAPERS=new Set(['A0','A1','A2','A3','A4']);
function validateJob(payload){
 if(!payload||typeof payload!=='object')throw Error('인쇄 설정이 없습니다.');
 const pages=payload.pages??[payload];
 if(!Array.isArray(pages)||!pages.length||pages.length>200)throw Error('인쇄할 도면은 1~200장이어야 합니다.');
 const copies=Number(payload.copies??1);
 if(!Number.isInteger(copies)||copies<1||copies>99)throw Error('인쇄 매수는 1~99입니다.');
 if(typeof payload.printerName!=='string'||!payload.printerName.trim())throw Error('프린터를 선택하세요.');
 let size=0;
 for(const page of pages){
  if(typeof page.svg!=='string'||!/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(page.svg))throw Error('인쇄 도면 형식이 잘못되었습니다.');
  size+=Buffer.byteLength(page.svg);if(size>100*1024*1024)throw Error('인쇄 자료가 너무 큽니다. 출력 장수를 나누세요.');
  if(!PAPERS.has(page.paper)||!['portrait','landscape'].includes(page.orientation))throw Error('용지와 방향을 확인하세요.');
  // Only locally generated, self-contained SVG is accepted. No scripts, foreign
  // HTML, file/network resources, or font downloads in the print renderer.
  // The generated IMAGE tag may contain an embedded raster, never a URL or SVG.
  const number='-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?';
  const raster=new RegExp('^<image href="data:image/(?:png|jpeg|bmp);base64,[A-Za-z0-9+/]+=*" x="'+number+'" y="'+number+'" width="'+number+'" height="'+number+'" preserveAspectRatio="none" opacity="'+number+'" transform="translate\\('+number+' '+number+'\\) rotate\\('+number+'\\)"/>$','i');
  const markup=(page.svg.match(/<[^>]*>/g)||[]).filter(tag=>!raster.test(tag)).join('\n');
  const styles=(page.svg.match(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi)||[]).join('\n');
  if(/<\s*(?:script|foreignObject|iframe|object|embed|image|use)\b|\bon\w+\s*=|\b(?:href|src)\s*=|<!DOCTYPE|<!ENTITY|@import|url\(\s*['"]?(?!#)/i.test(markup+'\n'+styles))throw Error('외부 참조가 있는 인쇄 자료는 지원하지 않습니다.');
 }
 return {pages,copies,printerName:payload.printerName};
}
function printHTML(page){
 return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src \'none\'"><style>@page{size:'+page.paper+' '+page.orientation+';margin:0}html,body{margin:0;padding:0}svg{display:block;max-width:100%}</style></head><body>'+page.svg+'</body></html>';
}
function createPrinterService({BrowserWindow,getPrinters,timeoutMs=60000,platform=process.platform,createPrinterSettings=require('./desktop-print-windows.cjs').createPrinterSettings}){
 let busy=false,restoreFailure;
 const deadline=(work,label)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error(label+' 응답 시간이 초과됐습니다. 프린터 대기열을 확인하세요.')),timeoutMs);
  Promise.resolve().then(work).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
 });
 return {
  async list(){return (await deadline(getPrinters,'프린터 목록')).map(p=>({name:p.name,displayName:p.displayName||p.name,isDefault:!!p.isDefault}));},
  async print(payload){
   if(restoreFailure)throw Error('프린터 원래 설정 복원에 실패했습니다. 인쇄 기본 설정을 확인한 뒤 앱을 다시 실행하세요. '+restoreFailure.message);
   if(busy)throw Error('앞선 인쇄를 처리 중입니다. 완료 후 다시 실행하세요.');
   const job=validateJob(payload);busy=true;let win,settings,changed=false,submittedPages=0;
   try{
    if(!(await deadline(getPrinters,'프린터 목록')).some(p=>p.name===job.printerName))throw Error('선택한 프린터를 찾을 수 없습니다.');
    if(platform==='win32'){
     settings=createPrinterSettings(job.printerName,timeoutMs);
     try{await settings.open();}catch{try{await settings.restore();}catch{}settings=null;}
    }
    win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false}});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',event=>event.preventDefault());
    for(let copy=0;copy<job.copies;copy++)for(const page of job.pages){
     await deadline(()=>win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(printHTML(page))),'인쇄 도면 준비');
     if(settings){await settings.set(page.paper,page.orientation);changed=true;}
     await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('인쇄 응답 시간이 초과됐습니다. 프린터 대기열을 확인하세요.')),timeoutMs);
      try{win.webContents.print({silent:true,deviceName:job.printerName,printBackground:true,color:true,copies:1,pageSize:page.paper,landscape:page.orientation==='landscape',margins:{marginType:'none'},scaleFactor:100},(ok,reason)=>{clearTimeout(timer);ok?resolve():reject(Error(reason||'인쇄 요청 실패'));});}catch(error){clearTimeout(timer);reject(error);}
     });
     submittedPages++;
    }
    return {submittedPages};
   }catch(error){throw Error((submittedPages?`${submittedPages}장은 프린터로 전송됐습니다. 남은 장을 확인하세요. `:'')+error.message);}
   finally{
    try{if(win&&!win.isDestroyed())win.destroy();}
    finally{try{if(settings)await settings.restore();}catch(error){if(changed)restoreFailure=error;throw Error('프린터 원래 설정 복원 실패: '+error.message);}finally{busy=false;}}
   }
  }
 };
}
module.exports={validateJob,printHTML,createPrinterService};
