// 실제 midrise-review.test.cjs의 input(A/B/C)를 공유한다. 엔진이나 계산식은 수정하지 않는다.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const prototype=readFileSync(new URL('../docs/structure/prototype.html',import.meta.url),'utf8');
const mid=['midrise.js','midrise-analysis.js','member-common.js','member-column.js','member-wall.js','member-beam.js','member-footing.js','member-demand.js'].map((f)=>readFileSync(new URL('../docs/structure/'+f,import.meta.url),'utf8')).join('\n');
const reviewTest=readFileSync(new URL('../docs/structure/midrise-review.test.cjs',import.meta.url),'utf8');
const ctx={};
const inputs=reviewTest.slice(reviewTest.indexOf('const rect='),reviewTest.indexOf('function inspect'));
vm.runInNewContext(mid+'\n'+prototype.split('/*CORE-START*/')[1].split('/*CORE-END*/')[0]+'\n'+inputs+';this.api={generate,review,input,columnMember,beamMember,wallMember,footingMember,footingProposal};',ctx);
export const CORE=ctx.api;
export const input=CORE.input;
export const {columnMember,beamMember,wallMember,footingMember,footingProposal}=CORE;
export function analysisFixture(stories=5) {
  const direction=di=>({
    storeys:Array.from({length:stories},(_,i)=>{
      const v=di*10+i;
      return {level:i+1,h_m:3+v/10,z_m:(i+1)*3+v/10,Fx_kN:100.123+v*11,Vx_kN:500.456+v*13,K_kNm:54321.678+v*101,
        CR:{x:1.2+v,y:3.4+v},CM:{x:2.1+v,y:3.6+v},e_m:.9+v/10,eAcc_m:.5+v/10,Ax:1.2345+v/100,
        deltaXe_mm:1.234+v,delta_mm:4.567+v,drift_mm:3.333+v,driftRatio:.0011+v/10000,allowRatio:.02+v/100000,
        driftSt:i%2?'ng':'ok',theta:.0123+v/1000,thetaMax:.1234+v/1000,pDeltaSt:i%2?'ok':'hold'};
    }),
    members:Array.from({length:stories},(_,i)=>({id:(di?'Y':'X')+'W'+(i+1),kind:'wall',level:i+1,k_kNm:54321.678+(di*10+i)*101,share:.6+(di*10+i)/100,V_kN:300.123+(di*10+i)*7,M_kNm:100.456+(di*10+i)*9})),
    torsion:{maxAvg:Array.from({length:stories},(_,i)=>1.1+di+i/10),H1:false,H1b:null},
    softStorey:{ratios:Array.from({length:stories-1},(_,i)=>.9-di/10-i/100),V1:true,weak:{ratios:Array.from({length:stories-1},(_,i)=>.8-di/10+i/100),V5:false}}
  });
  return {method:'storey-shear-rigid-diaphragm',assumptions:['강체 다이어프램 시험 가정'],src:['시험 해석 근거'],status:'hold',missing:['analysis.x.H1b'],dirs:{x:direction(0),y:direction(1)}};
}
