import test from 'node:test';
import assert from 'node:assert/strict';
import {sunPosition,gridToLatLon,siteOf,gridAzimuth,sampleTimes,sunlightVerdict,summarizeSunlight,KEY_DAYS,DEFAULT_SITE,SUN_RULE,clock,sunRuleText} from './sun-study.js';

const near=(a,b,tol,msg)=>assert.ok(Math.abs(a-b)<=tol,`${msg}: ${a} vs ${b}`);

test('평면직각좌표 → 위경도(pyproj 기준값과 1 m 안쪽)', ()=>{
 for(const [crs,e,n,lat,lon] of [['EPSG:5187',206886.273,287022.723,35.1796,129.0756],['EPSG:5186',198056.367,551885.031,37.5665,126.978],
   ['EPSG:5179',953901.165,1952032.081,37.5665,126.978],['EPSG:5187',332642.127,545561.242,37.5,130.5]]){
  const r=gridToLatLon(crs,e,n);
  near(r.lat,lat,1e-5,crs+' 위도');near(r.lon,lon,1e-5,crs+' 경도');
 }
 assert.equal(gridToLatLon('EPSG:9999',0,0),null);
});

test('수렴각: 중앙 자오선 동쪽은 +, 도북 방위는 진북 방위 − 수렴각', ()=>{
 const east=gridToLatLon('EPSG:5187',332642.127,545561.242);   // 130.5°E
 near(east.convergence,1.5*Math.sin(37.5*Math.PI/180),0.01,'수렴각');
 near(gridAzimuth(180,east),180-east.convergence,1e-9,'도북 방위');
 near(gridAzimuth(0.2,{convergence:0.5}),359.7,1e-9,'0° 넘어감');
});

test('도면 위치: drawingGeo 원점 + 모델 중심, 없으면 기본(부산)', ()=>{
 const doc={drawingGeo:{crs:'EPSG:5187',originM:[206800,287000]}};
 const s=siteOf(doc,{x:86273,y:22723});
 near(s.lat,35.1796,1e-5,'위도');near(s.lon,129.0756,1e-5,'경도');assert.match(s.source,/지적도/);
 assert.deepEqual(siteOf({}),{...DEFAULT_SITE});
 const seoul=siteOf({entities:[],reviewSettings:{buildingOverview:{values:{address:'서울특별시 종로구 세종로 1'}}}});assert.equal(seoul.province,'서울');assert.ok(Math.abs(seoul.lat-37.57)<.01);
 assert.equal(siteOf({entities:[],reviewSettings:{buildingOverview:{values:{address:'경상남도 창원시'}}}}).province,'경남');
});

test('태양 위치: 동지 남중 고도 = 90 − 위도 − 23.44, 남중 방위 180, 남중 시각은 경도·균시차만큼 늦다', ()=>{
 const seoul={lat:37.5665,lon:126.978};
 // 서울 동지 남중: 12:00 + (135−126.978)×4분 − 균시차(+1.6분) ≈ 12:30
 let best={altitude:-90};for(let m=11*60;m<=13*60;m++){const p=sunPosition({year:2026,month:12,day:22,hour:Math.floor(m/60),minute:m%60},seoul);if(p.altitude>best.altitude)best={...p,m};}
 near(best.altitude,90-37.5665-23.44,0.1,'남중 고도');
 near(best.azimuth,180,0.5,'남중 방위');
 near(best.m,12*60+30,2,'남중 시각(분)');
 // 오전은 동쪽(방위 < 180), 오후는 서쪽
 assert.ok(sunPosition({year:2026,month:12,day:22,hour:9},seoul).azimuth<180);
 assert.ok(sunPosition({year:2026,month:12,day:22,hour:15},seoul).azimuth>180);
 // 하지 남중 고도 ≈ 90 − 37.57 + 23.44 = 75.9
 near(sunPosition({year:2026,month:6,day:21,hour:12,minute:32},seoul).altitude,75.87,0.3,'하지 남중');
 // 동지 07시는 해 뜨기 전
 assert.ok(sunPosition({year:2026,month:12,day:22,hour:7},seoul).altitude<0);
});

test('일조 판정: 연속 2시간(09~15) 또는 총 4시간(08~16)', ()=>{
 const times=sampleTimes();
 assert.equal(times.length,49);assert.equal(clock(times[0]),'08:00');assert.equal(clock(times.at(-1)),'16:00');
 const lit=f=>times.map(t=>f(t/60));
 assert.deepEqual(sunlightVerdict(lit(h=>h>=10&&h<12)),{continuous:120,total:120,ok:true});          // 연속 2시간
 assert.equal(sunlightVerdict(lit(h=>h>=10&&h<11.8)).ok,false);                                       // 1시간 50분
 const broken=sunlightVerdict(lit(h=>(h>=8&&h<9)||(h>=10&&h<11)||(h>=12&&h<13)||(h>=15&&h<16)));      // 총 4시간, 연속 1시간
 assert.deepEqual(broken,{continuous:60,total:240,ok:true});
 assert.equal(sunlightVerdict(lit(h=>h>=8&&h<9||h>=15)).continuous,0);                                // 09~15 밖은 연속에 안 셈
 assert.equal(sunlightVerdict(lit(()=>true)).total,480);                                             // 16:00 표본은 총합에 안 셈
 assert.deepEqual(summarizeSunlight([{ok:true},{ok:false},null,{ok:true}]),{cells:3,ok:2,ratio:2/3});
 assert.equal(KEY_DAYS[0].label,'동지');assert.match(SUN_RULE.text,/연속 2시간/);
});

test('rule text names the computed day; winter keeps the precedent wording (A8)',()=>{
 assert.equal(sunRuleText('동지'),SUN_RULE.text);
 const t=sunRuleText('춘·추분');
 assert.match(t,/^춘·추분 기준 계산/);assert.match(t,/09~15시 연속 2시간/);assert.match(t,/08~16시 총 4시간/);assert.match(t,/기준일은 동지/);
 assert.doesNotMatch(t,/^동지/);
});
