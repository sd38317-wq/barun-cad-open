// graphic-card.js 시험. DOM 없이 순수 함수만 시험한다. node --test graphic-card.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
 isLeapYear,daysInMonth,firstWeekdayOf,monthWeeks,buildCalendar,CALENDAR_FIELDS,CALENDAR_SHARED_FIELDS,
 flagMetrics,taegeukRegions,gwaeBars,buildKoreanFlag,DKF_DEFAULT_WIDTH,
 gfMul,rsGenerator,rsEncode,qrDataCodewords,qrCapacityBytes,qrPickVersion,qrAlignmentPositions,
 qrFormatBits,qrVersionBits,qrEncode,qrRuns,buildQrCode,qrCellSize,qrCodewords,qrSize,QR_M_BLOCKS,QR_MASKS,
 solidFace,toPreviewEntities,QR_FIELDS,
} from './graphic-card.js';

test('QRC 기본 내용은 비어 있고(타사 주소 없음) 필수 입력이다 (2026-09-24 F10)', () => {
 const content=QR_FIELDS.find(f=>f.key==='content');
 assert.equal(content.def,'');
 assert.match(content.label,/필수/);
 assert.ok(!JSON.stringify(QR_FIELDS).includes('izzarder'));
});
import {defaultsOf,normalizeValues} from './card-kit.js';

const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<=tol,`${a} ≈ ${b} 가 아님 (허용 ${tol})`);
const nearPoint=(p,x,y,tol=1e-6)=>{near(p.x,x,tol);near(p.y,y,tol);};

/* ════════ 1. CALENDAR ════════ */
test('윤년과 달의 날수', () => {
 assert.equal(isLeapYear(2020),true);
 assert.equal(isLeapYear(1900),false);
 assert.equal(isLeapYear(2000),true);
 assert.equal(isLeapYear(2026),false);
 assert.equal(daysInMonth(2020,2),29);
 assert.equal(daysInMonth(1900,2),28);
 assert.equal(daysInMonth(2026,2),28);
 assert.equal(daysInMonth(2026,9),30);
 assert.equal(daysInMonth(2026,12),31);
 assert.throws(()=>daysInMonth(2026,13),/1~12/);
});

test('1일의 요일(젤러의 공식)', () => {
 assert.equal(firstWeekdayOf(2020,1),3);  // 2020-01-01 수요일
 assert.equal(firstWeekdayOf(2000,1),6);  // 2000-01-01 토요일
 assert.equal(firstWeekdayOf(1900,1),1);  // 1900-01-01 월요일
 assert.equal(firstWeekdayOf(2026,9),2);  // 2026-09-01 화요일
 assert.equal(firstWeekdayOf(2026,1),4);  // 2026-01-01 목요일
 assert.throws(()=>firstWeekdayOf(0,1),/1~9999/);
});

test('달 격자. 2020년 1월은 수요일 시작, 5주', () => {
 const w=monthWeeks(2020,1);
 assert.equal(w.length,5);
 assert.deepEqual(w[0],[0,0,0,1,2,3,4]);
 assert.deepEqual(w[1],[5,6,7,8,9,10,11]);
 assert.deepEqual(w[4],[26,27,28,29,30,31,0]);
 // 2월 29일이 있는 해
 assert.equal(monthWeeks(2020,2).flat().filter(Boolean).length,29);
 // 1일이 일요일이고 31일인 달은 정확히 5주
 assert.equal(firstWeekdayOf(2026,3),0);
 assert.equal(monthWeeks(2026,3).length,5);
});

test('달력 좌표. 한달 5000×5000, 달간 간격 500, 가로 4개', () => {
 const v=normalizeValues(CALENDAR_FIELDS,{...defaultsOf(CALENDAR_FIELDS),year:2020,lang:'ko',columns:'4'});
 const shared=normalizeValues(CALENDAR_SHARED_FIELDS,defaultsOf(CALENDAR_SHARED_FIELDS));
 const r=buildCalendar({x:0,y:0},v,shared);
 assert.equal(r.columns,4);
 assert.equal(r.rows,3);
 near(r.width,4*5000+3*500);
 near(r.height,3*5000+2*500);
 // 12달 × (네모 1 + 달 이름 1 + 요일 7) + 2020년 날수 366
 assert.equal(r.entities.length,12*9+366);
 // 1월 네모
 const box=r.entities[0];
 assert.equal(box.type,'polyline');
 assert.equal(box.closed,true);
 nearPoint(box.points[0],0,0);nearPoint(box.points[1],5000,0);
 nearPoint(box.points[2],5000,-5000);nearPoint(box.points[3],0,-5000);
 assert.equal(box.cardLayer,'A-SYM');
 // 1월 이름
 const title=r.entities[1];
 assert.equal(title.text,'1월');
 nearPoint(title.position,2500,-312.5);   // 세로 8줄이므로 한 줄 625, 가운데 312.5
 near(title.height,375);
 // 요일 첫 칸(일요일) — 주말켜
 const sun=r.entities[2];
 assert.equal(sun.text,'일');
 nearPoint(sun.position,5000/7*0.5,-937.5);
 assert.equal(sun.cardLayer,'A-TEXT');
 // 1월 1일은 수요일(4번째 칸), 첫째 주
 const one=r.entities.find(e=>e.type==='text'&&e.text==='1'&&e.position.y<-1000);
 nearPoint(one.position,5000/7*3.5,-1562.5);
 // 5월 네모는 1열 2행
 const may=r.entities.filter(e=>e.type==='polyline')[4];
 nearPoint(may.points[0],0,-5500);
 // 12월 네모는 4열 3행
 const dec=r.entities.filter(e=>e.type==='polyline')[11];
 nearPoint(dec.points[0],3*5500,-2*5500);
});

test('달력 가로 갯수 12 는 한 줄', () => {
 const v=normalizeValues(CALENDAR_FIELDS,{...defaultsOf(CALENDAR_FIELDS),year:2026,columns:'12'});
 const shared=normalizeValues(CALENDAR_SHARED_FIELDS,defaultsOf(CALENDAR_SHARED_FIELDS));
 const r=buildCalendar({x:1000,y:2000},v,shared);
 assert.equal(r.rows,1);
 near(r.width,12*5000+11*500);
 near(r.height,5000);
 nearPoint(r.entities.filter(e=>e.type==='polyline')[11].points[0],1000+11*5500,2000);
});

test('달력 영어 이름과 잘못된 크기', () => {
 const base=normalizeValues(CALENDAR_FIELDS,{...defaultsOf(CALENDAR_FIELDS),year:2026,lang:'en'});
 const shared=normalizeValues(CALENDAR_SHARED_FIELDS,defaultsOf(CALENDAR_SHARED_FIELDS));
 const r=buildCalendar({x:0,y:0},base,shared);
 assert.equal(r.entities[1].text,'JANUARY');
 assert.equal(r.entities[2].text,'SUN');
 assert.throws(()=>buildCalendar({x:0,y:0},{...base,monthWidth:0},shared),/0보다 커야/);
});

/* ════════ 2. DKF 태극기 ════════ */
test('태극기 비례가 대한민국국기법 시행령 별표와 맞는다', () => {
 const m=flagMetrics(3000);
 near(m.width,3000);
 near(m.height,2000);                       // 가로:세로 = 3:2
 near(m.diameter,m.height/2);               // 태극 지름 = 세로의 1/2
 near(m.radius,500);
 near(m.gwae.length,m.diameter/2);          // 괘 길이 = 태극 지름의 1/2
 near(m.gwae.band,m.diameter/3);            // 괘 너비 = 태극 지름의 1/3
 near(m.gwae.gap,m.diameter/4);             // 괘와 태극 사이 = 태극 지름의 1/4
 near(m.gwae.bar,m.gwae.band/4);            // 효 너비 = 괘 너비의 1/4
 near(m.gwae.space,m.gwae.bar/2);           // 효 사이 = 효 너비의 1/2
 near(m.gwae.band,3*m.gwae.bar+2*m.gwae.space);
 near(m.gwae.distance,m.radius+m.gwae.gap+m.gwae.band/2);
 near(m.gwae.halfBar,(m.gwae.length-m.gwae.space)/2);
 near(m.diagonal,-33.690067525979785,1e-9); // 좌상 → 우하 대각선
 assert.equal(DKF_DEFAULT_WIDTH,3000);
 assert.throws(()=>flagMetrics(0),/0보다 큰/);
});

test('태극 문양 좌표. 지름선 끝점과 반원 두 개', () => {
 const m=flagMetrics(3000),center={x:1500,y:-1000};
 const t=taegeukRegions(center,m.radius,m.diagonal);
 nearPoint(t.axisEnds[0],1083.9748527046846,-722.6499018305161,1e-6);  // 대각선 왼쪽 위 끝
 nearPoint(t.axisEnds[1],1916.0251472953154,-1277.3500981694839,1e-6); // 오른쪽 아래 끝
 nearPoint(t.red[0],t.axisEnds[1].x,t.axisEnds[1].y,1e-6);             // 빨강은 오른쪽 끝에서 시작
 nearPoint(t.blue[0],t.axisEnds[0].x,t.axisEnds[0].y,1e-6);
 for(const p of [...t.red,...t.blue])
  assert.ok(Math.hypot(p.x-center.x,p.y-center.y)<=m.radius+1e-6,'태극 점이 원 밖으로 나감');
 const maxY=Math.max(...t.red.map(p=>p.y)),minY=Math.min(...t.blue.map(p=>p.y));
 near(maxY,-500,0.1);    // 빨강이 원의 위쪽
 near(minY,-1500,0.1);   // 파랑이 원의 아래쪽
 assert.ok(Math.min(...t.red.map(p=>p.y))<-1000,'빨강이 대각선 아래(왼쪽 반원)까지 내려와야 한다');
 assert.ok(Math.max(...t.blue.map(p=>p.y))>-1000,'파랑이 대각선 위(오른쪽 반원)까지 올라와야 한다');
 assert.throws(()=>taegeukRegions(center,0,0),/0보다 커야/);
});

test('4괘의 효 갯수와 자리', () => {
 const m=flagMetrics(3000),center={x:1500,y:-1000},d=m.diagonal;
 assert.equal(gwaeBars(center,m,'geon',d+180).length,3); // 건 ☰
 assert.equal(gwaeBars(center,m,'gon',d).length,6);      // 곤 ☷
 assert.equal(gwaeBars(center,m,'gam',-d).length,5);     // 감 ☵
 assert.equal(gwaeBars(center,m,'ri',-d+180).length,4);  // 이 ☲
 assert.throws(()=>gwaeBars(center,m,'없음',0),/geon/);
 const geon=gwaeBars(center,m,'geon',d+180);
 // 가운데 효의 중심 = 중심점에서 좌상 대각선으로 11/24 세로만큼 간 자리
 const mid=geon[1].reduce((a,p)=>({x:a.x+p.x/4,y:a.y+p.y/4}),{x:0,y:0});
 nearPoint(mid,737.2872302453237,-491.5248201635492,1e-6);
 // 효 한 장의 크기 = 길이 500 × 너비 83.333
 const side=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 near(side(geon[1][0],geon[1][1]),m.gwae.length,1e-6);
 near(side(geon[1][1],geon[1][2]),m.gwae.bar,1e-6);
 // 끊어진 효 반쪽 길이
 const gon=gwaeBars(center,m,'gon',d);
 near(side(gon[0][0],gon[0][1]),m.gwae.halfBar,1e-6);
 // 세 효의 중심은 대각선 위에 일정 간격(효 너비 + 효 사이)으로 놓인다
 const centers=geon.map(q=>q.reduce((a,p)=>({x:a.x+p.x/4,y:a.y+p.y/4}),{x:0,y:0}));
 near(Math.hypot(centers[1].x-centers[0].x,centers[1].y-centers[0].y),m.gwae.bar+m.gwae.space,1e-6);
 near(Math.hypot(centers[2].x-centers[1].x,centers[2].y-centers[1].y),m.gwae.bar+m.gwae.space,1e-6);
});

test('태극기 한 장의 객체 구성', () => {
 const r=buildKoreanFlag({x:0,y:0},3000);
 assert.equal(r.entities.length,1+2+3+6+5+4); // 깃면 1 + 태극 2 + 효 18
 const [flag,red,blue]=r.entities;
 assert.equal(flag.type,'polyline');
 nearPoint(flag.points[2],3000,-2000);
 assert.equal(red.type,'hatch');assert.equal(red.solid,true);assert.equal(red.color,'#CD2E3A');
 assert.equal(blue.color,'#0047A0');
 assert.equal(r.entities.at(-1).color,'#000000');
 nearPoint(r.center,1500,-1000);
 for(const e of r.entities)assert.equal(e.cardLayer,'A-SYM');
 // 모든 점이 깃면 안에 있다
 for(const e of r.entities)for(const p of e.points)
  assert.ok(p.x>=-1e-6&&p.x<=3000+1e-6&&p.y<=1e-6&&p.y>=-2000-1e-6,`깃면 밖 점 ${p.x},${p.y}`);
 // 다른 폭으로 그리면 좌표가 비례한다
 const big=buildKoreanFlag({x:0,y:0},6000);
 near(big.entities[1].points[0].x,r.entities[1].points[0].x*2,1e-6);
});

/* ════════ 3. QRC QR 코드 ════════ */
test('GF(256) 곱셈이 독립 구현과 같다', () => {
 const slow=(a,b)=>{let r=0;for(let i=0;i<8;i++){if(b&1)r^=a;const hi=a&0x80;a=(a<<1)&0xff;if(hi)a^=0x1d;b>>=1;}return r;};
 for(let a=0;a<256;a++)for(let b=0;b<256;b++)assert.equal(gfMul(a,b),slow(a,b),`gfMul(${a},${b})`);
 assert.deepEqual(rsGenerator(2),[1,3,2]); // (x+1)(x+2) = x^2 + 3x + 2
 assert.equal(rsGenerator(10).length,11);
 assert.equal(rsGenerator(10)[0],1);
});

test('리드-솔로몬 부호가 ISO/IEC 18004 보기와 같다', () => {
 // 부속서 I 의 1-M 숫자모드 보기 "01234567" 의 자료 코드워드
 const data=[0x10,0x20,0x0C,0x56,0x61,0x80,0xEC,0x11,0xEC,0x11,0xEC,0x11,0xEC,0x11,0xEC,0x11];
 assert.deepEqual(rsEncode(data,10),[0xA5,0x24,0xD4,0xC1,0xED,0x36,0xC7,0x87,0x2C,0x55]);
});

test('오류정정 코드워드의 신드롬이 0 이다(독립 검산)', () => {
 const slow=(a,b)=>{let r=0;for(let i=0;i<8;i++){if(b&1)r^=a;const hi=a&0x80;a=(a<<1)&0xff;if(hi)a^=0x1d;b>>=1;}return r;};
 const alpha=n=>{let x=1;for(let i=0;i<n;i++)x=slow(x,2);return x;};
 for(const ec of [10,16,18,22,24,26]){
  const data=Array.from({length:20},(_,i)=>(i*37+11)&0xff);
  const word=[...data,...rsEncode(data,ec)];
  for(let s=0;s<ec;s++){
   const a=alpha(s);let acc=0,px=1;
   for(let i=word.length-1;i>=0;i--){acc^=slow(word[i],px);px=slow(px,a);}
   assert.equal(acc,0,`ec ${ec} 의 신드롬 ${s} 가 0 이 아님`);
  }
 }
});

test('용량표가 공개된 값과 맞는다(바이트 모드·오류정정 M)', () => {
 assert.equal(qrDataCodewords(1),16);
 assert.equal(qrDataCodewords(10),216);
 assert.deepEqual([1,2,3,4,5,6,7,8,9,10].map(qrCapacityBytes),[14,26,42,62,84,106,122,152,180,213]);
 for(const [v,b] of Object.entries(QR_M_BLOCKS)){
  const total=b[1]*b[2]+b[3]*b[4]+b[0]*(b[1]+b[3]);
  assert.equal(total,[26,44,70,100,134,172,196,242,292,346][Number(v)-1],`버전 ${v} 총 코드워드`);
 }
 assert.equal(qrPickVersion(14),1);
 assert.equal(qrPickVersion(15),2);
 assert.equal(qrPickVersion(213),10);
 assert.throws(()=>qrPickVersion(214),/너무 깁니다/);
});

test('맞춤무늬 자리·형식정보·버전정보', () => {
 assert.deepEqual(qrAlignmentPositions(1),[]);
 assert.deepEqual(qrAlignmentPositions(2),[6,18]);
 assert.deepEqual(qrAlignmentPositions(6),[6,34]);
 assert.deepEqual(qrAlignmentPositions(7),[6,22,38]);
 assert.deepEqual(qrAlignmentPositions(10),[6,28,50]);
 assert.equal(qrFormatBits(0),0b101010000010010); // 오류정정 M · 마스크 0 의 표준값
 for(let mask=0;mask<8;mask++){
  const bits=qrFormatBits(mask)^0x5412;
  let rem=bits>>>10;
  for(let i=0;i<10;i++)rem=(rem<<1)^(((rem>>>9)&1)*0x537);
  assert.equal(rem&0x3ff,bits&0x3ff,`마스크 ${mask} 의 BCH 나머지`);
  assert.equal(bits>>>13,0,'오류정정 M 은 앞 두 비트가 00');
 }
 assert.throws(()=>qrFormatBits(8),/0~7/);
 assert.equal(qrVersionBits(6),0);
 assert.equal(qrVersionBits(7),0b000111110010010100);
 assert.equal(qrVersionBits(10),0b001010010011010011);
});

test('"Hello World" 의 QR 격자가 알려진 값과 한 칸도 다르지 않다', () => {
 // 바이트 모드·오류정정 M·버전 1. 바깥 부호기(api.qrserver.com)의 결과와 21×21 전부 일치함을 확인했다.
 const want=[
  '111111100010101111111','100000100010101000001','101110101010101011101','101110101101101011101',
  '101110101000101011101','100000101011001000001','111111101010101111111','000000001100000000000',
  '101111100001001111100','100111001001111111101','011110110100111001110','101010001101110011100',
  '011000100000111000001','000000001010100001000','111111100001001000110','100000101000010101111',
  '101110101001001100001','101110101110111111000','101110101100100100100','100000100010110011100',
  '111111101011101010010'];
 const r=qrEncode('Hello World');
 assert.equal(r.version,1);
 assert.equal(r.size,21);
 assert.equal(r.mask,2);
 assert.deepEqual(r.modules.map(row=>row.map(v=>v?'1':'0').join('')),want);
});

test('기능 무늬(찾기·타이밍·고정 어두운 칸)가 제자리에 있다', () => {
 for(const [text,version] of [['Hello World',1],['x'.repeat(60),4],['y'.repeat(120),7],['z'.repeat(200),10]]){
  const r=qrEncode(text),n=r.size,m=r.modules;
  assert.equal(r.version,version);
  assert.equal(n,qrSize(version));
  for(const [r0,c0] of [[0,0],[0,n-7],[n-7,0]]){
   assert.deepEqual(m[r0].slice(c0,c0+7).map(Number),[1,1,1,1,1,1,1]);
   assert.deepEqual(m[r0+1].slice(c0,c0+7).map(Number),[1,0,0,0,0,0,1]);
   assert.deepEqual(m[r0+3].slice(c0,c0+7).map(Number),[1,0,1,1,1,0,1]);
   assert.deepEqual(m[r0+6].slice(c0,c0+7).map(Number),[1,1,1,1,1,1,1]);
  }
  for(let i=8;i<n-8;i++){
   assert.equal(m[6][i],i%2===0,`가로 타이밍 ${i}`);
   assert.equal(m[i][6],i%2===0,`세로 타이밍 ${i}`);
  }
  assert.equal(m[n-8][8],true,'항상 어두운 칸');
  assert.equal(r.isFunction[n-8][8],true);
  if(version>=7){ // 버전정보 18칸이 좌하·우상에 두 벌
   const bits=qrVersionBits(version);
   for(let i=0;i<18;i++){
    const bit=((bits>>>i)&1)===1,a=n-11+i%3,b=Math.floor(i/3);
    assert.equal(m[b][a],bit);assert.equal(m[a][b],bit);
   }
  }
 }
});

test('자료를 다시 읽으면 넣은 글자가 그대로 나온다(버전 1~10)', () => {
 const texts=['A','Hello World','https://izzarder.com','바른 CAD',
  'a'.repeat(30),'b'.repeat(60),'c'.repeat(100),'d'.repeat(120),'e'.repeat(150),'f'.repeat(175),'g'.repeat(213)];
 for(const text of texts){
  const r=qrEncode(text),n=r.size,fn=r.isFunction,mk=QR_MASKS[r.mask];
  const bits=[];
  for(let right=n-1;right>=1;right-=2){
   if(right===6)right=5;
   for(let vert=0;vert<n;vert++)for(let j=0;j<2;j++){
    const col=right-j,up=((right+1)&2)===0,row=up?n-1-vert:vert;
    if(fn[row][col])continue;
    bits.push(r.modules[row][col]!==mk(row,col)?1:0);
   }
  }
  const words=[];for(let i=0;i+8<=bits.length;i+=8){let b=0;for(let j=0;j<8;j++)b=(b<<1)|bits[i+j];words.push(b);}
  assert.deepEqual(words.slice(0,r.codewords.length),r.codewords,`${text.slice(0,8)} 격자에서 읽은 코드워드`);
  // 블록을 풀어 원문 확인
  const [ec,b1,d1,b2,d2]=QR_M_BLOCKS[r.version];
  const lens=[...new Array(b1).fill(d1),...new Array(b2).fill(d2)],longest=Math.max(...lens);
  const blocks=lens.map(()=>[]);let idx=0;
  for(let i=0;i<longest;i++)for(let b=0;b<lens.length;b++)if(i<lens[b])blocks[b].push(words[idx++]);
  const data=[].concat(...blocks),bs=[];
  for(const b of data)for(let i=7;i>=0;i--)bs.push((b>>>i)&1);
  const take=(p,len)=>{let v=0;for(let i=0;i<len;i++)v=(v<<1)|bs[p+i];return v;};
  const countBits=r.version<10?8:16;
  assert.equal(take(0,4),0b0100,'바이트 모드');
  const count=take(4,countBits),bytes=[];
  for(let i=0;i<count;i++)bytes.push(take(4+countBits+i*8,8));
  assert.equal(Buffer.from(bytes).toString('utf8'),text);
  assert.deepEqual(qrCodewords(text,r.version),r.codewords);
 }
});

test('QR 칸 묶기와 좌표', () => {
 assert.deepEqual(qrRuns([[true,true,false,true]]),[{row:0,from:0,to:2},{row:0,from:3,to:4}]);
 assert.deepEqual(qrRuns([[false,false]]),[]);
 const r=qrEncode('Hello World');
 const cells=buildQrCode({x:100,y:200},50,r.modules,'A-SYM');
 assert.equal(cells.length,qrRuns(r.modules).length);
 const first=cells[0];
 assert.equal(first.type,'hatch');
 assert.equal(first.solid,true);
 assert.equal(first.cardLayer,'A-SYM');
 // 첫 줄의 첫 묶음은 왼쪽 위 찾기무늬 7칸
 nearPoint(first.points[0],100,200);
 nearPoint(first.points[1],100+7*50,200);
 nearPoint(first.points[2],100+7*50,150);
 nearPoint(first.points[3],100,150);
 // 전체 크기는 21칸 × 50
 const xs=cells.flatMap(c=>c.points.map(p=>p.x)),ys=cells.flatMap(c=>c.points.map(p=>p.y));
 near(Math.min(...xs),100);near(Math.max(...xs),100+21*50);
 near(Math.max(...ys),200);near(Math.min(...ys),200-21*50);
 assert.throws(()=>buildQrCode({x:0,y:0},0,r.modules),/0보다 커야/);
 near(qrCellSize(1,100),100);
 near(qrCellSize(2.5,40),100);
 assert.throws(()=>qrCellSize(0,100),/0보다 큰/);
 assert.throws(()=>qrEncode(''),/내용을 적으세요/);
});

/* ════════ 공통 ════════ */
test('채운 면과 미리보기 변환', () => {
 const f=solidFace([{x:0,y:0},{x:1,y:0},{x:1,y:1}],'#123456','A-SYM');
 assert.equal(f.type,'hatch');
 assert.equal(f.solid,true);
 assert.equal(f.pattern,'solid');
 assert.equal(f.color,'#123456');
 assert.equal(f.cardLayer,'A-SYM');
 const [p,t]=toPreviewEntities([f,{type:'text',position:{x:0,y:0},text:'가'}]);
 assert.equal(p.type,'polyline');
 assert.equal(p.closed,true);
 assert.equal(p.previewColor,'#123456');
 assert.equal(t.type,'text');
});
