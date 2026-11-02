import {classifyByLayerKnowledge} from './layer-knowledge.js';
// 레이어 순위 모델도 핵심 자산(layer-knowledge.js 와 같은 방식). 잠겨 있으면 priors 가 비어 있어 후보를 내지 않는다.
import {LAYER_RANKING as SHIPPED} from './layer-ranking-data.js';
export let LAYER_RANKING=SHIPPED;
export async function reloadLayerRanking(){
 LAYER_RANKING=(await import(new URL('./layer-ranking-data.js',import.meta.url).href+'?v='+Date.now())).LAYER_RANKING;
 return !LAYER_RANKING.locked;
}

// Evidence families are capped per candidate to avoid counting duplicate signals twice.
export function rankLayerCandidates(entity,layer,geometricCandidates=[],geometryAllowed=false){
 if(!Object.keys(LAYER_RANKING.priors).length)return {id:entity.id,label:null,accepted:false,confidence:0,modelScore:0,margin:0,candidates:[],calibrated:false,
  evidenceKind:'ranked',evidence:[],ruleIds:[],status:'review',reason:'레이어 정리 지식은 [계정 연결] 로그인 뒤 쓸 수 있습니다 · 원본 유지'};
 const semantic=classifyByLayerKnowledge(entity,layer);
 const evidence=(semantic?.evidence||[]).map(e=>({...e,
  family:e.ruleId.startsWith('native.')?'native':e.strong?'annotation':'name',strength:1}));
 if(geometryAllowed)for(const g of geometricCandidates){
  if(g.label&&Number.isFinite(g.confidence)&&g.confidence>0&&g.confidence<1)
   evidence.push({label:g.label,ruleId:'geometry.'+g.label,family:'geometry',strength:g.confidence,strong:false,reason:g.reason});
 }
 const groups=new Map();
 for(const e of evidence){
  if(!(e.label in LAYER_RANKING.priors))continue;
  const families=groups.get(e.label)||new Map();
  families.set(e.family,Math.max(families.get(e.family)||0,e.strength));groups.set(e.label,families);
 }
 const labels=Object.keys(LAYER_RANKING.priors),uniform=1/labels.length;
 const logits=labels.map(label=>({label,logit:LAYER_RANKING.priorStrength*Math.log(LAYER_RANKING.priors[label]/uniform)
  +[...(groups.get(label)||[])].reduce((n,[family,strength])=>n+LAYER_RANKING.weights[family]*strength,0)}));
 logits.push({label:null,logit:LAYER_RANKING.unknownLogit});
 const max=Math.max(...logits.map(c=>c.logit)),total=logits.reduce((n,c)=>n+Math.exp(c.logit-max),0);
 const candidates=logits.map(c=>({label:c.label,score:Math.exp(c.logit-max)/total,
  ruleIds:evidence.filter(e=>e.label===c.label).map(e=>e.ruleId)})).sort((a,b)=>b.score-a.score||String(a.label).localeCompare(String(b.label)));
 const [first,second]=candidates,margin=first.score-second.score;
 const strongLabels=new Set(evidence.filter(e=>e.strong).map(e=>e.label));
 const hasEvidence=groups.size>0,conflict=strongLabels.size>1;
 const accepted=hasEvidence&&!conflict&&first.label!==null&&groups.has(first.label)&&first.score>=LAYER_RANKING.minimumScore&&margin>=LAYER_RANKING.minimumMargin;
 return {id:entity.id,label:hasEvidence?first.label:null,accepted,confidence:first.score,
  modelScore:first.score,margin,candidates,calibrated:false,evidenceKind:'ranked',evidence,
  ruleIds:first.ruleIds,status:accepted?'auto':'review',
  reason:!hasEvidence?'분류 근거 없음 · 원본 유지':conflict?'확정 근거끼리 충돌 · 최고 후보 제시 후 검토':
   accepted?`최고 후보 ${first.label} · 모델점수 ${(first.score*100).toFixed(1)}% · 차이 ${(margin*100).toFixed(1)}%p`:
   '후보 점수 또는 차이 부족 · 원본 유지'};
}
