// 실제 CORE와 midrise-review.test.cjs의 A(5층)·B(필로티)·C(3층) 입력을 사용한다.
import {CORE,input,wallMember,beamMember,footingMember,footingProposal,columnMember} from './structure-calc-report.js';
export function midriseDrawingModel(kind='C', {sections=true, proposal=false}={}) {
  const p=input(kind);
  if (sections) {
    p.floors.forEach((f,i)=>{
      f.columns=f.columns.map(c=>({...columnMember({b:400+i*50,h:450+i*50}),...c}));
      f.walls=[wallMember({x0:1,y0:0,x1:9,y1:0})];
      f.beams=[beamMember({x0:0,y0:0,x1:10,y1:0})];
    });
    p.foundation=footingMember({B:2400,L:2600,columnId:'C1'});
  }
  if (proposal) {
    p.floors.forEach(f=>{
      Object.assign(f.columns[0],{b:400,h:400,design:{minB:400,maxB:400,minH:400,maxH:400,barCandidates:['D22'],countCandidates:[8],tieSpacingCandidates:[150]}});
      for(const key of ['b','h','bar','nx','ny'])delete f.columns[0][key];
      f.walls[0].design={barCandidates:['D13'],spacingCandidates:[200],layerCandidates:[2]};
      delete f.walls[0].vertical;delete f.walls[0].horizontal;
      f.beams[0].design={bwCandidates:[300],hCandidates:[600],barCandidates:['D22'],barCounts:[4],stirrupCandidates:['D10'],spacingCandidates:[200],stirrupLegs:2};
      for(const key of ['bw','h','top','bottom','stirrup'])delete f.beams[0][key];
    });
    p.foundation=footingProposal({columnId:'C1'});
  }
  return CORE.generate(p);
}
