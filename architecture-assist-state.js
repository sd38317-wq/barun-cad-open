/** Pure state helpers for the architecture assistant command palette. */
import {architectureReferenceCommands,ARCHITECTURE_MERGED_COMMAND_IDS} from './architecture-command-pack.js';

export const ASSIST_STATE_STORAGE_KEY='barun-cad.architecture-assist-state.v1';
export const ASSIST_RECENT_LIMIT=8;
const EMPTY_STATE=Object.freeze({favorites:[],recent:[],hotkeys:{}});
const RESERVED=new Set(['CTRL+ALT+DELETE','CTRL+SHIFT+ESC','ALT+F4','CTRL+ALT+ESC']);
const KEY_NAMES=new Set(['CTRL','ALT','SHIFT','META','CMD','COMMAND']);

export const createAssistState=()=>({favorites:[],recent:[],hotkeys:{}});
const idsOf=commands=>commands===undefined?null:new Set((commands||architectureReferenceCommands).map(c=>typeof c==='string'?c:c?.id).filter(Boolean));
const mergedId=id=>ARCHITECTURE_MERGED_COMMAND_IDS[id]||id; // 2026-09-24: 중복으로 합친 명령(LII)의 옛 id 저장값을 남은 id 로 옮긴다
const cleanList=(value,ids)=>[...new Set(Array.isArray(value)?value.filter(id=>typeof id==='string').map(mergedId).filter(id=>!ids||ids.has(id)):[])];
export const normalizeAssistState=(value,commands)=>{
 const ids=idsOf(commands);
 const source=value&&typeof value==='object'?value:{};
 const hotkeys={};
 if(source.hotkeys&&typeof source.hotkeys==='object') for(const [rawId,key] of Object.entries(source.hotkeys).sort(([a],[b])=>(mergedId(a)!==a)-(mergedId(b)!==b))){const id=mergedId(rawId); if((!ids||ids.has(id))&&normalizeAssistHotkey(key)&&!hotkeys[id]) hotkeys[id]=normalizeAssistHotkey(key);} /* 남은 카드 자신의 단축키를 먼저 넣어 합쳐진 옛 id 값보다 우선한다 */
 return {favorites:cleanList(source.favorites,ids),recent:cleanList(source.recent,ids).slice(0,ASSIST_RECENT_LIMIT),hotkeys};
};

export function normalizeAssistHotkey(value){
 let raw=typeof value==='string'?value:(value&&typeof value==='object'&&typeof value.key==='string' ? `${value.ctrlKey?'Ctrl+':''}${value.altKey?'Alt+':''}${value.shiftKey?'Shift+':''}${value.metaKey?'Meta+':''}${value.key}` : '');
 raw=raw.trim(); if(!raw)return null;
 const parts=raw.split('+').map(p=>p.trim()).filter(Boolean); if(!parts.length)return null;
 let key=parts.pop().toUpperCase(); const mods=[]; for(const p of parts){const m=p.toUpperCase(); if(!KEY_NAMES.has(m)||mods.includes(m))return null; mods.push(m);}
 if(!/^(F(?:[1-9]|1[0-2])|[A-Z0-9]|ESC|ESCAPE|TAB|ENTER|SPACE|BACKSPACE|DELETE|INSERT|HOME|END|PAGEUP|PAGEDOWN|UP|DOWN|LEFT|RIGHT|[!@#$%^&*(),.?/:;\[\]{}\\`~\-=_])$/.test(key))return null;
 if(key==='ESCAPE')key='ESC'; if(key==='COMMAND')key='CMD';
 const order=['CTRL','ALT','SHIFT','META','CMD','COMMAND']; mods.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
 const result=[...mods,key].join('+'); return RESERVED.has(result)?null:result;
}

export function validateAssistHotkeys({hotkeys={},commands=architectureReferenceCommands,coreHotkeys={}}={}){
 const ids=idsOf(commands), valid={}, errors=[], conflicts=[]; const core=new Set(Object.values(coreHotkeys||{}).map(normalizeAssistHotkey).filter(Boolean));
 for(const [id,value] of Object.entries(hotkeys||{})){const normalized=normalizeAssistHotkey(value); if(!ids.has(id))errors.push({id,reason:'unknown-command'}); else if(!normalized)errors.push({id,reason:'invalid-hotkey'}); else {valid[id]=normalized;if(core.has(normalized))conflicts.push({id,hotkey:normalized,reason:'core-hotkey'});}}
 const seen=new Map(); for(const [id,key] of Object.entries(valid)){if(seen.has(key))conflicts.push({id,hotkey:key,reason:'duplicate-assist-hotkey',with:seen.get(key)});else seen.set(key,id);}
 return {valid,errors,conflicts,ok:errors.length===0&&conflicts.length===0};
}

export const toggleAssistFavorite=(state,id)=>{const next=normalizeAssistState(state); const i=next.favorites.indexOf(id); if(i<0)next.favorites.push(id); else next.favorites.splice(i,1); return next;};
export const moveAssistFavorite=(state,id,toIndex)=>{const next=normalizeAssistState(state), from=next.favorites.indexOf(id); if(from<0)return next; next.favorites.splice(from,1); next.favorites.splice(Math.max(0,Math.min(next.favorites.length,Number(toIndex)||0)),0,id); return next;};
export const recordAssistRecent=(state,id,max=ASSIST_RECENT_LIMIT)=>{const next=normalizeAssistState(state); next.recent=[id,...next.recent.filter(x=>x!==id)].slice(0,Math.max(0,Number(max)||ASSIST_RECENT_LIMIT)); return next;};
export function loadAssistState({storage,commands}={}){try{return normalizeAssistState(JSON.parse(storage?.getItem(ASSIST_STATE_STORAGE_KEY)||'{}'),commands);}catch{return normalizeAssistState(EMPTY_STATE,commands);}}
export function saveAssistState({storage,state,commands}={}){const normalized=normalizeAssistState(state,commands); storage?.setItem(ASSIST_STATE_STORAGE_KEY,JSON.stringify(normalized)); return normalized;}
