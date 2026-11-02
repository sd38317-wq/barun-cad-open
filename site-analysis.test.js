import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisModel,useCategory,USE_UNKNOWN,diagramSVG,overlayAffine,sunHours,skyView,ANALYSIS_PANELS,rasterPixels,terrainGrid,withZones} from './site-analysis.js';
import {analysisKey,PLAN_STEPS} from './plan-workflow-panel.js';

const square=(x,y,s)=>[{x,y},{x:x+s,y},{x:x+s,y:y+s},{x,y:y+s}];
// 대지 20m 사각(가운데 0,0) · 도로 · 인접 필지 · 주변 건물 3동(남쪽 40m 고층, 동쪽 저층, 높이 미상)
const doc=()=>({drawingGeo:{crs:'EPSG:5187',originM:[388000,186000],unit:'mm'},entities:[
 {type:'polyline',closed:true,parcelRole:'site',points:square(-10000,-10000,20000),attributes:{ring:'outer',pnu:'2623010300105730001'}},
 {type:'polyline',closed:true,parcelRole:'road',points:square(-60000,-22000,120000).map((p,i)=>i>1?{...p,y:-12000}:p),attributes:{ring:'outer'}},
 {type:'polyline',closed:true,parcelRole:'neighbor',points:square(12000,-10000,30000),attributes:{ring:'outer',pnu:'2623010300105740000'}},
 {type:'polyline',closed:true,parcelRole:'building',points:square(-8000,-45000,16000),model3d:{height:60000},attributes:{heightM:60,floors:18,heightSource:'건물 높이(GIS건물통합정보)',useCode:'02000',approvalYear:1995}},
 {type:'polyline',closed:true,parcelRole:'building',points:square(20000,-5000,10000),model3d:{height:9900},attributes:{heightM:9.9,floors:3,heightSource:'지상 3층 × 3.3m',useCode:'03000'}},
 {type:'polyline',closed:true,parcelRole:'building',points:square(-50000,20000,10000),model3d:{height:3300},attributes:{heightM:3.3,floors:1,heightSource:'층수 없음 · 1층으로 봄'}},
]});

test('대지분석 재료: 대지 가운데가 원점(y는 남쪽 +), 높이 미상은 null, 용도·연도는 있는 것만',()=>{
 const m=analysisModel(doc());
 assert.equal(m.counts.buildings,3);assert.equal(m.counts.parcels,3);
 assert.deepEqual(m.center,{x:0,y:0});
 const tall=m.buildings[0];
 assert.ok(tall.c[1]>0,'남쪽 건물은 SVG y가 + 이어야 한다');
 assert.equal(tall.h,60);assert.equal(tall.use.t,'주거');assert.equal(tall.year,1995);
 assert.equal(m.buildings[1].h,9.9,'층수로 잡은 높이도 층수가 있으면 쓴다');
 assert.equal(m.buildings[2].h,null,'층수도 높이도 없어 1층으로 본 건물은 높이 미상');
 assert.equal(m.buildings[2].use,USE_UNKNOWN);assert.equal(m.buildings[2].year,null);
 assert.ok(m.R>=60&&m.R<=400,String(m.R));
 assert.ok(Math.abs(m.lat-35.15)<1.5,'5187 원점에서 위도를 대략 구한다: '+m.lat);
 assert.equal(analysisModel({entities:[]}),null,'대지가 없으면 도판도 없다');
});

test('용도 범주: 별표1 다섯 자리 코드 우선, 없으면 이름, 모르면 미상(지어내지 않음)',()=>{
 assert.equal(useCategory('04000').t,'근린생활');
 assert.equal(useCategory('14000').t,'업무');
 assert.equal(useCategory('',  '공장').t,'공업·창고');
 assert.equal(useCategory(''),USE_UNKNOWN);
 assert.equal(useCategory('99000'),USE_UNKNOWN);
});

test('도판 SVG: 패널마다 원형 프레임·대지 표식, 범례·제목은 고를 때만',()=>{
 const m=analysisModel(doc());
 for(const p of ANALYSIS_PANELS.filter(p=>!p.raster)){
  const svg=diagramSVG(m,p.key,{size:300});
  assert.match(svg,/^<svg [^>]*viewBox=/);assert.match(svg,/clipPath id="sa-clip-/);assert.match(svg,/fill="#e0245e"/,'대지 표식');
  assert.doesNotMatch(svg,/<text/,'기본 도판에는 글자가 없다');
 }
 const full=diagramSVG(m,'height',{legend:true,title:true});
 assert.match(full,/BUILDING HEIGHT/);assert.match(full,/35~60m/);
 assert.match(diagramSVG(m,'height'),/fill="#1e3a9e"/,'60m 는 60~100m 구간');
 assert.match(diagramSVG(m,'use'),/fill="#f2d98d"/,'주거 색');
 assert.equal(ANALYSIS_PANELS.find(p=>p.key==='use').need(m),'');
 assert.equal(ANALYSIS_PANELS.find(p=>p.key==='age').need(m),'');
 const bare=analysisModel({...doc(),entities:doc().entities.map(e=>e.parcelRole==='building'?{...e,attributes:{...e.attributes,useCode:'',approvalYear:null}}:e)});
 assert.match(ANALYSIS_PANELS.find(p=>p.key==='use').need(bare),/용도 자료가 없습니다/);
 assert.match(ANALYSIS_PANELS.find(p=>p.key==='age').need(bare),/연도 자료가 없습니다/);
 const raster=diagramSVG(m,'sunhours',{rasterHref:r=>{assert.equal(r.vals.length,r.M*r.M);return 'data:image/png;base64,AA==';}});
 assert.match(raster,/<image href="data:image\/png/);
});

test('도면 뒤에 깔기: 아핀은 도면 mm → 그림 화소, 대지 가운데가 그림 가운데, 북쪽이 위',()=>{
 const m=analysisModel(doc()),size=1600,[a,b,c,d,e,f]=overlayAffine(m,size);
 const px=(x,y)=>[a*x+c*y+e,b*x+d*y+f];
 const [cx,cy]=px(m.center.x,m.center.y);assert.ok(Math.abs(cx-size/2)<1e-6&&Math.abs(cy-size/2)<1e-6);
 const [,north]=px(0,10000);assert.ok(north<size/2,'도면 y+ (북) 은 그림 위쪽');
 const H=m.R*1.06,[edge]=px(H*1000,0);assert.ok(Math.abs(edge-size)<1e-6,'프레임 오른쪽 끝 = 그림 오른쪽 끝');
});

test('일조시간: 트인 곳은 동지 6시간, 높은 건물 바로 북쪽은 덜 받는다 · 건물 안은 −1',()=>{
 const H=50,cell=1,n=100,g=new Float32Array(n*n);
 // 남쪽(y +) 10~20m 에 높이 30m 벽 하나
 for(let j=60;j<70;j++)for(let i=30;i<70;i++)g[j*n+i]=30;
 const G={n,cell,H,g},M=20,v=sunHours(G,M,35.15);
 const at=(x,y)=>v[Math.floor((y+H)/(2*H/M))*M+Math.floor((x+H)/(2*H/M))];
 assert.equal(at(-45,45),6,'벽 남쪽(햇빛 쪽) 끝은 하루 종일 트여 있다');
 assert.ok(at(0,5)<3,'벽 바로 북쪽: '+at(0,5));
 assert.equal(at(0,15),-1);
 const sky=skyView(G,M,40,16),s=(x,y)=>sky[Math.floor((y+H)/(2*H/M))*M+Math.floor((x+H)/(2*H/M))];
 assert.ok(s(-45,45)>s(0,5),'벽 옆이 더 막혀 있다');
 const px=rasterPixels({M:2,vals:Float32Array.from([-1,0,1,2]),color:()=>[1,2,3]});
 assert.equal(px[3],0,'건물 안은 투명');assert.equal(px[7],255);
});

test('계획 탭: 대지분석 단계는 지도 다음·계획안 앞, 다시 그릴 열쇠는 건물·필지가 바뀔 때만 바뀐다',()=>{
 const ids=PLAN_STEPS.map(s=>s.id);
 assert.equal(ids.indexOf('analysis'),ids.indexOf('map')+1);assert.equal(ids.indexOf('plan'),ids.indexOf('analysis')+1);
 const d=doc(),site={entityIds:['a']};
 const k1=analysisKey(d,site),k2=analysisKey({...d,entities:[...d.entities,{type:'line',points:[]}]},site);
 assert.equal(k1,k2,'선 하나 그린다고 도판을 다시 만들지 않는다');
 assert.notEqual(k1,analysisKey({...d,entities:d.entities.slice(0,-1)},site));
 const step=PLAN_STEPS.find(s=>s.id==='analysis');
 assert.equal(step.evaluate({site:{kind:null},engine:{doc:d}}).state,'blocked');
 assert.equal(step.evaluate({site:{kind:'parcel',drawingGeo:d.drawingGeo},engine:{doc:d}}).state,'done');
});

test('추천 용도 입력: 둘레 100m 건물의 별표1 용도별 동수·평균 층수, 모르는 용도는 따로 센다',async()=>{
 const {useStats,recommendRequest}=await import('./site-analysis.js');
 const m=analysisModel(doc());
 const u=useStats(m,100);
 assert.equal(u.total,3);assert.equal(u.unknown,1,'용도 코드가 없는 건물은 지어내지 않고 따로 센다');
 assert.deepEqual(u.stats,[{use:'공동주택',count:1,avgFloors:18},{use:'제1종근린생활시설',count:1,avgFloors:3}]);
 assert.equal(useStats(m,40).total,2,'반경을 줄이면 먼 건물은 빠진다');
 const body=recommendRequest(m,{address:'부산 부산진구 부전동 139-3',areaM2:400.04,landInfo:{massing:{zoneName:'일반상업지역'},zoneNames:['일반상업지역','방화지구']}});
 assert.equal(body.action,'use-recommend');assert.deepEqual(body.zoneNames,['일반상업지역','방화지구']);assert.equal(body.lotAreaM2,400);
 assert.equal(body.totalBuildings,u.total);
});

test('용도지역·지구·시설: 브이월드 면(도면 mm)을 도판 좌표로, 범주는 이름으로, 받는 중·실패는 따로 알린다',async()=>{
 const {withZones,ZONING,densityCells}=await import('./site-analysis.js');
 const m=analysisModel(doc());
 const zp=ANALYSIS_PANELS.find(p=>p.key==='zoning');
 assert.match(zp.need(m),/받는 중/);
 const ring=[[-100000,-100000],[100000,-100000],[100000,100000],[-100000,100000]];
 const z=withZones(m,{zones:[{kind:'zone',name:'일반상업지역',polygons:[[ring]]},{kind:'district',name:'방화지구',polygons:[[ring]]},{kind:'facility',name:'소로3류',group:'도로',polygons:[[ring]]}],warnings:[]});
 assert.equal(zp.need(z),'');assert.deepEqual(z.zones[0].rings[0][2],[100,-100],'북동 모서리 = (100, −100) m');
 assert.match(diagramSVG(z,'zoning'),new RegExp(`fill="${ZONING.find(c=>c.t==='일반상업').c}"`));
 assert.deepEqual(ANALYSIS_PANELS.find(p=>p.key==='district').legend(z),[{c:'#f2a33a',t:'방화지구'}]);
 assert.deepEqual(ANALYSIS_PANELS.find(p=>p.key==='planned').legend(z),[{c:'#f6c46a',t:'도로'}]);
 assert.match(zp.need(withZones(m,{zones:[],warnings:['로그인 필요']})),/받지 못했습니다: 로그인 필요/);
 const gfa=analysisModel({...doc(),entities:doc().entities.map(e=>e.parcelRole==='building'?{...e,attributes:{...e.attributes,totalAreaM2:5000}}:e)});
 assert.ok(densityCells(gfa).cells.some(c=>c.far>=5000/(densityCells(gfa).cs**2)-1e-9),'연면적이 있으면 그 값을 쓴다');
});

test('[PNG 저장]: data URL 을 fetch 하지 않고 바로 Blob 으로 — CSP(connect-src 에 data: 없음)에 막히지 않게',async()=>{
 const {dataUrlToBlob}=await import('./site-analysis.js');
 const png=dataUrlToBlob('data:image/png;base64,iVBORw0KGgo=');
 assert.equal(png.type,'image/png');
 assert.deepEqual([...new Uint8Array(await png.arrayBuffer())],[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
 const svg=dataUrlToBlob('data:image/svg+xml,%3Csvg%2F%3E');
 assert.equal(await svg.text(),'<svg/>');
 assert.throws(()=>dataUrlToBlob('blob:x'),/올바르지 않습니다/);
 const {readFileSync}=await import('node:fs');
 assert.doesNotMatch(readFileSync(new URL('./site-analysis.js',import.meta.url),'utf8'),/fetch\(url\)/,'PNG 저장이 다시 fetch(data:) 를 쓰면 안 된다');
});

test('용도지역·지구·시설: 일부 레이어만 받지 못해도 그 종류는 "자료 없음"이 아니라 "받지 못함"',async()=>{
 const {withZones}=await import('./site-analysis.js');
 const m=analysisModel(doc()),ring=[[-5000,-5000],[5000,-5000],[5000,5000],[-5000,5000]];
 const need=(model,key)=>ANALYSIS_PANELS.find(p=>p.key===key).need(model);
 const z=withZones(m,{zones:[{kind:'zone',name:'일반상업지역',polygons:[[ring]]}],warnings:['LT_C_UQ124: 일시 오류'],failed:{zone:[],district:['LT_C_UQ124'],facility:[]}});
 assert.equal(need(z,'zoning'),'','받은 용도지역은 그린다');
 assert.match(need(z,'district'),/용도지구·지구단위계획구역 자료를 받지 못했습니다: LT_C_UQ124: 일시 오류/);
 assert.equal(need(z,'planned'),'이 범위에는 해당 자료가 없습니다.','실패 없이 비어 있으면 그때만 "없음"');
 const whole=withZones(m,{zones:[],warnings:['로그인 필요']});
 for(const key of ['zoning','district','planned'])assert.match(need(whole,key),/받지 못했습니다: 로그인 필요/);
});

test('용도지역 받기가 실패하면 [도시계획 자료 다시 받기] — 누르면 같은 대지에서 다시 받는다',async()=>{
 const step=PLAN_STEPS.find(s=>s.id==='analysis');
 const site={kind:'parcel',pnu:'P1',drawingGeo:{originM:[0,0]}};
 const view=zoning=>({site,engine:{doc:{entities:[]}},studio:{context:{}},state:{zoningSite:'P1',zoningLoading:false,zoning}});
 const ids=v=>step.actions(v).map(a=>a.id);
 assert.ok(!ids(view({zones:[],warnings:[],failed:{zone:[],district:[],facility:[]}})).includes('zoning-retry'));
 const failed=view({zones:[],warnings:['LT_C_UQ124: 오류'],failed:{zone:[],district:['LT_C_UQ124'],facility:[]}});
 const retry=step.actions(failed).find(a=>a.id==='zoning-retry');
 assert.ok(retry);
 assert.ok(ids(view({zones:[],warnings:['로그인 필요']})).includes('zoning-retry'),'요청 자체가 실패해도');
 await retry.run({state:failed.state});
 assert.equal(failed.state.zoningSite,null,'다음 그리기에서 다시 받는다');
});

test('상권·추천 용도: 기다리는 사이 대지가 바뀌면 옛 대지의 답을 붙이지 않는다',async()=>{
 const {marketSection}=await import('./site-analysis.js');
 const el=(tag,cls,text='')=>({tag,cls,text,children:[],append(...c){this.children.push(...c);}});
 const buttons=node=>[node,...(node.children||[]).flatMap(buttons)].filter(n=>n.tag==='button');
 let resolve;const api=()=>new Promise(r=>{resolve=r;});
 const state={marketSite:'A'};
 const click=()=>buttons(marketSection({model:analysisModel(doc()),site:{address:'부산'},api,state,el,rerender(){}})).find(b=>b.text.startsWith('주변 상권')).onclick();
 let done=click();state.marketSite='B';resolve({상권:{총점포:1}});await done;
 assert.equal(state.market,undefined,'대지 A 의 상권이 대지 B 에 붙으면 안 된다');
 assert.equal(state.marketBusy,'');
 done=click();resolve({상권:{총점포:2}});await done;
 assert.equal(state.market.상권.총점포,2,'같은 대지면 붙인다');
});

// 동서로 뻗은 등고선 4줄(남쪽 10m → 북쪽 25m, 20m 간격) = 북쪽이 높은 비탈(내려가는 쪽 = 남, 약 14°).
const slopeDoc=()=>{const d=doc();for(let k=0;k<4;k++)d.entities.push({type:'polyline',closed:false,parcelRole:k%2?'contour-major':'contour',points:Array.from({length:41},(_,i)=>({x:-200000+i*10000,y:-30000+k*20000})),attributes:{elevationM:10+k*5}});return d;};

test('지형: 등고선 → 표고 격자, 경사도(°)와 내려가는 방향(남=180°), 등고선이 없으면 지형 도판 3장은 "등고선 없음"',()=>{
 const m=analysisModel(slopeDoc());
 assert.equal(m.contours.length,4);assert.equal(m.contours[1].major,true);
 const t=terrainGrid(m.contours,60,60),mid=30*60+30;
 assert.equal(t.zmin,10);assert.equal(t.zmax,25);
 assert.ok(t.z[mid]>10&&t.z[mid]<25,String(t.z[mid]));
 assert.ok(t.slope[mid]>8&&t.slope[mid]<20,'경사도 '+t.slope[mid]);
 assert.ok(Math.abs(t.aspect[mid]-180)<20,'남향 비탈 '+t.aspect[mid]);
 for(const key of ['topo','slope','aspect']){
  const p=ANALYSIS_PANELS.find(x=>x.key===key);
  assert.equal(p.need(m),'',key);assert.match(diagramSVG(m,key,{rasterHref:()=>'data:,'}),/<image /,key);
  assert.match(p.need(analysisModel(doc())),/등고선이 없습니다/,key);
 }
 assert.equal(terrainGrid([],60),null);
});

test('도로 위계·가구·공원·녹지·하천: 도시계획 도로 이름으로 위계, 하천은 하천망, 받는 중·실패는 따로 알린다',()=>{
 const sq=(x,y,s)=>[[[x,y],[x+s,y],[x+s,y+s],[x,y+s]]];
 const zoning={zones:[{kind:'facility',group:'도로',name:'대로2류(폭 30m~35m)',polygons:[sq(-60000,-30000,10000)]},{kind:'facility',group:'도로',name:'소로2류',polygons:[sq(0,-30000,5000)]},
  {kind:'facility',group:'공간',name:'양정꿈동산어린이공원',polygons:[sq(30000,30000,10000)]},{kind:'water',name:'부전천',detail:'지방2급하천',polygons:[sq(-40000,30000,8000)]}],failed:{zone:[],district:[],facility:[],water:[]},warnings:[]};
 const base=analysisModel(doc()),m=withZones(base,zoning);
 for(const key of ['roads','blocks','green'])assert.equal(ANALYSIS_PANELS.find(x=>x.key===key).need(m),'',key);
 const roads=diagramSVG(m,'roads');
 assert.match(roads,/fill="#5a5a5a"/,'대로 색');assert.match(roads,/fill="#c2c2c2"/,'소로 색');assert.doesNotMatch(roads,/fill="#2b2b2b"/,'광로는 없다');
 assert.match(diagramSVG(m,'green'),/fill="#8cc4e8"/,'하천');assert.match(diagramSVG(m,'green'),/fill="#5fae5a"/,'공원');
 assert.match(ANALYSIS_PANELS.find(x=>x.key==='green').need(base),/받는 중/);
 const failed=withZones(base,{...zoning,failed:{...zoning.failed,water:['LT_C_WKMSTRM']},warnings:['LT_C_WKMSTRM: 시간 초과']});
 assert.match(ANALYSIS_PANELS.find(x=>x.key==='green').need(failed),/하천 자료를 받지 못했습니다: LT_C_WKMSTRM: 시간 초과/);
});

test('반경: 주변 건물을 받은 둘레(aroundM, 없으면 150m)를 모델에 남긴다',()=>{
 assert.equal(analysisModel(doc()).fetchedR,150);
 const d=doc();for(const e of d.entities)if(e.parcelRole==='building')e.attributes.aroundM=500;
 assert.equal(analysisModel(d,{maxRadiusM:500}).fetchedR,500);
 assert.equal(analysisModel(d,{maxRadiusM:500}).R,500,'반경을 정해 받은 도면은 원 도판 = 받은 원');assert.equal(analysisModel(d,{maxRadiusM:200}).R,200,'더 작게 고르면 그 원');
});

test('도판 카드 그림은 그림 파일(img)로 넣는다 — 글 속 SVG 면 주변 건물 3천 동에서 칸 위 마우스가 움직일 때마다 다시 칠해 느렸다(10-28)',async()=>{
 const {renderAnalysisGallery}=await import('./site-analysis.js');
 const el=(tag,cls,text='')=>({tag,cls,text,children:[],dataset:{},style:{},append(...c){this.children.push(...c);},set innerHTML(v){this.html=v;},querySelector(){return null;},setAttribute(){}});
 const all=node=>[node,...(node.children||[]).flatMap(all)];
 const state={analysisModel:analysisModel(doc()),analysisCache:{}};
 const nodes=all(renderAnalysisGallery({doc:doc(),el,state,rerender(){}}));
 const thumbs=nodes.filter(n=>n.cls==='site-analysis-thumb');
 assert.ok(thumbs.length>0);
 assert.ok(thumbs.every(t=>t.html===undefined),'카드에 SVG 글을 직접 넣지 않는다');
 const imgs=nodes.filter(n=>n.tag==='img');
 assert.ok(imgs.length>0&&imgs.every(i=>i.src.startsWith('data:image/svg+xml')));
 const again=all(renderAnalysisGallery({doc:doc(),el,state,rerender(){}})).filter(n=>n.tag==='img');
 assert.deepEqual(again.map(i=>i.src),imgs.map(i=>i.src),'다시 그려도 같은 그림(캐시)');
});
