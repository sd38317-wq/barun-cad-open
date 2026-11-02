(async () => {
  // Internal, synthetic-document probes. No live document or file dialogs are used.
  const checks = [];
  const api = globalThis.__cadGpuTest, qa = globalThis.__barunQuality;
  const assert = (value, message) => { if (!value) throw Error(message); };
  assert(api && qa, 'Packaged quality bridge is unavailable');
  const canvas = document.querySelector('#canvas');
  const input = document.querySelector('#coordinate');
  const doc = {version:2, units:'mm', layers:[{id:'default',name:'0',color:'#ffffff',visible:true}],blocks:[],entities:[]};
  const line = (id, x1, y1, x2, y2) => ({id,type:'line',layer:'default',points:[{x:x1,y:y1},{x:x2,y:y2}]});
  const load = entities => { qa.reset(); api.load({...doc, entities}); api.setView(1,{x:0,y:400}); };
  const pointer = (type,x,y,buttons) => {
    const r=canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:r.left+x,clientY:r.top+y,button:0,buttons,pointerId:1,pointerType:'mouse'}));
  };
  const click = (x,y) => {pointer('pointerdown',x,y,1);pointer('pointerup',x,y,0);};
  const submit = text => {input.value=text;qa.submit();};
  const check = async (id, action) => {
    const start=performance.now();
    try { await action(); checks.push({id,status:'passed',durationMs:performance.now()-start}); }
    catch(error) {checks.push({id,status:'failed',durationMs:performance.now()-start,detail:String(error.message||error)});}
    finally {qa.reset(); for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();}
  };
  await check('SELECT_CLICK_RELEASE',()=>{
    load([line('a',100,100,200,100)]);qa.run('ERASE');
    click(80,280);assert(qa.state().drag?.awaitingCorner,'Released first click lost selection');
    pointer('pointermove',220,320,0);assert(qa.state().drag?.kind==='selection','Movement without button did not retain selection');
    click(220,320);assert(qa.state().selected.includes('a'),'Second click did not select enclosed line');
  });
  await check('HATCH_HOLE_SELECTION',()=>{
    const square=(a,b)=>[{x:a,y:a},{x:b,y:a},{x:b,y:b},{x:a,y:b}];
    const hollow={id:'block',type:'block',layer:'default',entities:[{id:'h',type:'hatch',layer:'default',points:square(20,320),loops:[square(60,280)],solid:true,spacing:100,angle:0}]};
    const entities=[hollow,line('inside',120,120,200,120)];
    load(entities);qa.run('ERASE');click(90,310);
    assert(qa.state().drag?.awaitingCorner&&qa.state().selected.length===0,'Empty hatch hole intercepted first corner');
    pointer('pointermove',230,220,0);click(230,220);
    assert(qa.state().selected.join(',')==='inside','Two-corner window in hatch hole selected wrong object');
    load(entities);qa.run('ERASE');click(150,280);
    assert(qa.state().selected.join(',')==='inside','Direct line selection regressed');
  });
  await check('DRAFTING_CONTEXT_SETTINGS',()=>{
    for(const id of ['osnap','snap','ortho']){
      const before=document.getElementById(id).checked;
      document.querySelector('#quick-'+id).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
      const dialog=document.querySelector('.drafting-dialog');
      assert(dialog?.open,'Context menu did not open: '+id);
      assert(document.getElementById(id).checked===before,'Context menu toggled setting: '+id);
      dialog.close();
    }
  });
  await check('DIALOG_THREE_QUARTER_SCALE',()=>{
    document.querySelector('#quick-osnap').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
    const dialog=document.querySelector('.drafting-dialog');
    assert(dialog?.open,'Settings dialog did not open');
    assert(Math.abs(parseFloat(getComputedStyle(dialog).zoom)-0.75)<0.001,'Dialog is not scaled to 75 percent');
    const r=dialog.getBoundingClientRect();
    assert(r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,'Scaled dialog is outside viewport');
  });
  const corner=[line('h',100,100,180,100),line('v',200,120,200,200)];
  await check('FILLET_TWO_CLICK_UNDO',()=>{
    load(corner);submit('F');assert(qa.state().mode==='FILLET','F alias did not start FILLET');
    click(140,300);click(200,240);
    const result=qa.state().entities;
    assert(result.length===2&&result.every(e=>e.points.some(p=>p.x===200&&p.y===100)),'Two clicks did not create zero-radius corner');
    qa.edit({type:'undo'});assert(JSON.stringify(qa.state().entities)===JSON.stringify(corner),'Fillet undo changed original geometry');
  });
  await check('FILLET_RADIUS',()=>{
    load(corner);for(const text of ['F','R','10'])submit(text);
    click(140,300);click(200,240);
    assert(qa.state().entities.some(e=>e.type==='arc'&&e.radius===10),'R option did not create radius 10 arc');
  });
  await check('OSNAP_INTERSECTION_ORTHO',()=>{
    load([line('h',80,100,120,100),line('v',100,80,100,120)]);
    for(const id of ['ortho','osnap','snap-intersection'])document.getElementById(id).checked=true;
    qa.run('PLINE');click(20,380);
    for(let repeat=0;repeat<3;repeat++)for(const [x,y] of [[99,300],[100,299],[101,300],[100,301]]){
      pointer('pointermove',x,y,0);const q=qa.state().cursor;
      assert(q?.snapped&&q.x===100&&q.y===100,'Intersection capture lost while ortho is enabled');
    }
  });
  await check('GPU_CLIPPED_BLOCK_EDIT',()=>{
    const clip={enabled:true,points:[{x:60,y:60},{x:240,y:60},{x:240,y:240},{x:60,y:240}]};
    load([{id:'clipped',type:'block',layer:'default',clip,entities:[line('clipped-line',0,100,300,100),{id:'t',type:'text',layer:'default',text:'CLIP',position:{x:50,y:150},height:35}]},line('delete-me',300,100,400,100)]);
    api.draw();const before=api.state().stats;
    assert(before.active&&!before.reason,'Clipped block disabled GPU: '+before.reason);
    qa.edit({type:'delete',ids:['delete-me']});api.draw();const after=api.state().stats;
    assert(after.active&&!after.reason,'Editing clipped drawing disabled GPU: '+after.reason);
    assert(after.builds===before.builds,'Deleting one line rebuilt whole GPU drawing');
  });
  await check('GPU_TEXT_VIEWPORT_BUDGET',()=>{
    const texts=Array.from({length:10000},(_,i)=>({id:'label-'+i,type:'text',layer:'default',text:'검증 문자 '+i+' '+('CAD '.repeat(35)),position:{x:(i%100)*10000,y:Math.floor(i/100)*10000},height:30}));
    load(texts);api.draw();const initial=api.state().stats;
    assert(initial.active&&!initial.reason,'Large text drawing disabled GPU: '+initial.reason);
    assert(initial.textSourceCount===10000,'Large text source registry lost entries');
    assert(initial.textViewportCandidates<100,'Offscreen text was prepared for local viewport');
    assert(initial.textAtlasPages<=32,'Text atlas exceeded bounded budget');
    for(let i=0;i<10;i++){pointer('pointermove',60+i,60,0);api.draw();}
    const steady=api.state().stats;
    assert(steady.frames===initial.frames,'Cursor-only movement unnecessarily redrew static GPU scene');
    assert(steady.textViewportBuilds===initial.textViewportBuilds,'Cursor-only movement recreated text atlas');
    api.setView(2,{x:-20000,y:400});api.draw();const moved=api.state().stats;
    assert(moved.active&&!moved.reason,'Pan/zoom disabled text GPU: '+moved.reason);
    assert(moved.builds===initial.builds,'Text pan/zoom rebuilt entire GPU scene');
    assert(moved.textSourceCount===10000&&moved.textViewportCandidates<100,'Pan/zoom lost text sources or searched whole drawing');
    assert(moved.textAtlasPages<=32,'Pan/zoom accumulated unbounded text atlas pages');
    // A count-only threshold misses smaller collections of long labels.
    load(Array.from({length:200},(_,i)=>({id:'long-'+i,type:'text',layer:'default',height:30,text:String(i).padStart(3,'0')+' CAD'.repeat(12),position:{x:i*10000,y:0}})));
    api.draw();const longLabels=api.state().stats;
    assert(longLabels.active&&!longLabels.reason,'Long labels below count threshold disabled GPU: '+longLabels.reason);
    assert(longLabels.textAtlasPages<=32,'Long labels exceeded atlas budget');
    api.setView(2,{x:-20000,y:400});api.draw();const longMoved=api.state().stats;
    assert(longMoved.active&&!longMoved.reason&&longMoved.builds===longLabels.builds,'Long label pan/zoom rebuilt or disabled GPU');
  });
  await check('OUTPUT_PLOT_DIALOG_AUTOCAD',async()=>{
    const oldDesktop=globalThis.cadDesktop,oldPrint=globalThis.print,calls=[];
    const tick=()=>new Promise(resolve=>setTimeout(resolve,100));
    try{
      globalThis.cadDesktop={listPrinters:async()=>[{name:'quality-device',isDefault:true}],printDrawing:async job=>{calls.push(job);return {submittedPages:job.pages?.length||1};}};
      globalThis.print=()=>{throw Error('System print dialog was invoked');};
      qa.reset();api.load({...doc,entities:[line('one',10,10,100,100)],sheets:[
        {id:'one',title:'<img src=x>',bounds:{minX:0,minY:0,maxX:1000,maxY:1000},paper:'A3',denominator:100},
        {id:'two',title:'Second',bounds:{minX:0,minY:0,maxX:1500,maxY:1500},paper:'A4',denominator:100}
      ]});qa.run('PPP');await tick();
      const dialog=document.querySelector('#form-dialog'),form=document.querySelector('#property-form');
      assert(dialog.open&&dialog.classList.contains('plot-settings-dialog'),'PPP did not open integrated output');
      // AutoCAD 플롯 창 배치(2026-10-02 사용자 승인): 세 줄 묶음과 가운데 실시간 미리보기
      const headings=[...dialog.querySelectorAll('.plot-settings-section>h3')].map(h=>h.textContent);
      for(const name of ['프린터/플로터','용지 크기','플롯 영역','플롯 축척','플롯 스타일 테이블 (펜 지정)','플롯 옵션','도면 방향'])assert(headings.includes(name),'Plot dialog section missing: '+name);
      assert(headings.some(h=>h.startsWith('플롯 간격띄우기')),'Plot offset section missing');
      const cols=[...dialog.querySelectorAll('#form-fields>.plot-col')].map(c=>c.getBoundingClientRect());
      assert(cols.length===3&&cols[0].right<=cols[1].left+1&&cols[1].right<=cols[2].left+1,'Plot dialog is not three columns left to right');
      const preview=dialog.querySelector('.plot-col-middle .plot-preview-pane'),live=preview?.querySelector('.plot-live');
      assert(preview&&live.getBoundingClientRect().width>=200&&live.getBoundingClientRect().height>=150,'Live preview missing or unreadably small');
      assert(dialog.querySelector('[name=fit]').getBoundingClientRect().width<=24,'Plot checkboxes are oversized');
      for(const label of ['미리보기...','다중 플롯...','확인','취소'])assert([...dialog.querySelectorAll('.dialog-actions button')].some(b=>b.textContent===label),'Plot dialog button missing: '+label);
      assert(dialog.querySelector('[name=printerName]').getBoundingClientRect().width>=70,'Printer control is unreadably narrow');
      assert(document.querySelector('#plot-multi-mode').checked,'PPP did not enable multi-plot');
      const rows=[...dialog.querySelectorAll('.plot-page-row')];assert(rows.length===2,'Sheet list missing');
      // PPP 는 도곽을 모두 골라 둔 채 연다(2026-10-27). 모두 끄고 확인하면 한 장으로 새지 않고 막혀야 한다.
      assert(rows.every(row=>row.querySelector('input[type=checkbox]').checked),'PPP did not preselect sheets');
      for(const row of rows){const checkbox=row.querySelector('input[type=checkbox]');checkbox.checked=false;checkbox.dispatchEvent(new Event('change',{bubbles:true}));}
      form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick();
      assert(calls.length===0&&dialog.open,'Empty multi-plot silently printed single page');
      for(const row of rows){const checkbox=row.querySelector('input[type=checkbox]');checkbox.checked=true;checkbox.dispatchEvent(new Event('change',{bubbles:true}));}
      const next=[...dialog.querySelectorAll('.plot-preview-heading button')].find(b=>b.textContent==='다음');next.click();
      assert(rows.every(row=>row.querySelector('input[type=checkbox]').checked),'Preview navigation changed output selection');
      assert(!dialog.querySelector('.plot-preview-summary img'),'Sheet title interpreted as HTML');
      rows[1].querySelector('button').click();
      form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick();
      assert(calls.length===1&&calls[0].pages?.length===2,'Selected pages not sent in one print request');
      assert(calls[0].printerName==='quality-device'&&calls[0].pages[0].paper==='A4'&&calls[0].pages[1].paper==='A3','Printer or ordered paper sizes lost: '+JSON.stringify({printer:calls[0].printerName,papers:calls[0].pages.map(p=>p.paper)}));
    }finally{globalThis.cadDesktop=oldDesktop;globalThis.print=oldPrint;}
  });
  await check('OVERLAP_SHIFT_LAYER_CYCLE',()=>{
    load([line('wall-a',100,100,200,100),line('dimension-a',100,100,200,100),line('wall-b',100,100,200,100)]);
    qa.run('ERASE');const seen=[];
    for(let i=0;i<4;i++){
      const p=qa.screen({x:150,y:100}),r=canvas.getBoundingClientRect();
      for(const type of ['pointerdown','pointerup'])canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:r.left+p.x,clientY:r.top+p.y,button:0,buttons:type==='pointerdown'?1:0,pointerId:1,pointerType:'mouse',shiftKey:true}));
      const selected=qa.state().selected;assert(selected.length===1,'Cycling accumulated selection');seen.push(selected[0]);
      assert(document.querySelectorAll('.overlap-selection-item[aria-pressed=true]').length===1,'Active layer row missing');
    }
    assert(new Set(seen.slice(0,3)).size===3&&seen[0]===seen[3],'Shift cycle lost candidates');
    const rows=[...document.querySelectorAll('.overlap-selection-item')];assert(rows.length===3,'Same-layer objects were merged');rows[1].click();
    const id=qa.state().selected[0];submit('');assert(qa.state().entities.length===2&&!qa.state().entities.some(e=>e.id===id),'Wrong overlap object deleted');
    qa.edit({type:'undo'});assert(qa.state().entities.length===3,'Overlap deletion undo failed');
  });
  await check('INLINE_TEXT_COMPACT_TRANSPARENT',()=>{
    load([{id:'edit-label',type:'text',layer:'default',text:'AB',position:{x:100,y:100},height:16}]);
    const p=qa.screen({x:105,y:105}),r=canvas.getBoundingClientRect();click(p.x,p.y);click(p.x,p.y);
    canvas.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,button:0,clientX:r.left+p.x,clientY:r.top+p.y}));
    const editor=document.querySelector('textarea.drawing-text-editor');assert(editor,'Double-click editor missing');
    assert(getComputedStyle(editor).backgroundColor==='rgba(0, 0, 0, 0)','Editor background is not transparent');
    const before=parseFloat(editor.style.width);assert(before<100,'Short text editor is too wide');
    editor.value='ABCDEFGH';editor.dispatchEvent(new Event('input',{bubbles:true}));assert(parseFloat(editor.style.width)>before,'Editor did not grow with content');
    editor.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter'}));assert(qa.state().entities[0].text==='ABCDEFGH','Edited text not saved: '+JSON.stringify({entities:qa.state().entities,toast:document.querySelector('#toast')?.textContent}));
  });
  await check('OSNAP_DENSE_POLYLINE',()=>{
    const points=Array.from({length:4097},(_,i)=>({x:i/16,y:100}));
    load([{id:'dense',type:'polyline',layer:'default',points,closed:false},line('vertical',100.03,80,100.03,120)]);
    for(const id of ['ortho','snap','snap-end','snap-mid','snap-center','snap-nearest','snap-perpendicular','snap-tangent','snap-quadrant'])document.getElementById(id).checked=false;
    for(const id of ['osnap','snap-intersection'])document.getElementById(id).checked=true;
    qa.run('LINE');
    const p=qa.screen({x:100.04,y:100.1});pointer('pointermove',p.x,p.y,0);const snapped=qa.state().cursor;
    assert(snapped?.snapped&&Math.abs(snapped.x-100.03)<1e-7&&Math.abs(snapped.y-100)<1e-7,'Dense polyline intersection is inaccurate');
  });
  return {checks,scope:'Synthetic documents through real renderer DOM event handlers; output bridge mocked: no physical print, OS mouse timing or large-drawing performance claim.'};
})()
