// 레이어 창·명령·생성기는 같은 원천의 사양을 쓴다. JSON 원본은 보호 지식으로 묶고,
// 이 기본 UI 자료는 generate_layer_standards.py가 만들며 시험에서 원본과 대조한다.
import {LAYER_STANDARDS} from './layer-standards-data.js';
export const STANDARD_LAYERS=Object.freeze(LAYER_STANDARDS.map(layer=>Object.freeze({...layer,groups:Object.freeze([...layer.groups]),...(layer.labelAliases?{labelAliases:Object.freeze([...layer.labelAliases])}:{})})));
const group=name=>Object.freeze(STANDARD_LAYERS.filter(layer=>layer.groups.includes(name)));
export const TEMPLATE_LAYERS=group('template');
export const SITE_PLAN_LAYERS=group('sitePlan');
export const ON_DEMAND_LAYERS=group('onDemand');
export const LEARNED_LAYERS=group('learned');
const byName=new Map(STANDARD_LAYERS.map(layer=>[layer.name,layer]));
const byLabel=new Map(STANDARD_LAYERS.flatMap(layer=>[layer.label,...(layer.labelAliases||[])].map(label=>[label,layer])));
byLabel.set('위생기구',byName.get('A-SANI'));
byLabel.set('단열',byName.get('A-WALL-INSL'));
export const standardLayerForName=name=>byName.get(name)||null;
export const standardLayerForLabel=label=>byLabel.get(label)||byName.get(label)||null;
export function layerTooltip(layer){
 const name=typeof layer==='string'?layer:layer?.name,standard=byName.get(name);
 return standard?[name,standard.label,standard.description,(typeof layer==='object'?layer.color:null)||standard.color].join(' · '):'사용자 레이어';
}
