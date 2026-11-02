import {emptyLayoutState,createLayout,updateLayout,removeLayout,createViewport,setViewportScale,setViewportLayers} from './layout-workbench.js';

const clone=value=>structuredClone(value);
export const createLayoutSession=(initial=emptyLayoutState())=>({present:clone(initial),undo:[],redo:[]});

export function runLayoutCommand(session,command){
 const before=clone(session.present);let after;
 switch(command.type){
  case 'layout.create':after=createLayout(before,command);break;
  case 'layout.update':after=updateLayout(before,command.id,command.changes);break;
  case 'layout.remove':after=removeLayout(before,command.id);break;
  case 'layout.activate':{
   after=clone(before);if(command.id==='model')after.currentSpace={kind:'model'};else if(after.layouts.some(layout=>layout.id===command.id))after.currentSpace={kind:'paper',layoutId:command.id};else throw Error('배치를 찾지 못했습니다.');break;
  }
  case 'viewport.create':after=createViewport(before,command);break;
  case 'viewport.scale':after=setViewportScale(before,command.layoutId,command.viewportId,command.denominator);break;
  case 'viewport.layers':after=setViewportLayers(before,command.layoutId,command.viewportId,command.hiddenLayerIds||[]);break;
  default:throw Error('지원하지 않는 배치 명령입니다: '+command.type);
 }
 return {present:after,undo:[...session.undo,before].slice(-100),redo:[]};
}

export function undoLayoutCommand(session){if(!session.undo.length)return clone(session);const undo=clone(session.undo),present=undo.pop();return {present,undo,redo:[clone(session.present),...session.redo].slice(0,100)};}
export function redoLayoutCommand(session){if(!session.redo.length)return clone(session);const redo=clone(session.redo),present=redo.shift();return {present,undo:[...session.undo,clone(session.present)].slice(-100),redo};}

export function validateLayoutSession(session){
 const errors=[],layoutIds=new Set(),names=new Set(),viewportIds=new Set();
 if(!session||!session.present||!Array.isArray(session.undo)||!Array.isArray(session.redo))errors.push('세션 구조 오류');
 for(const layout of session?.present?.layouts||[]){
  if(layoutIds.has(layout.id))errors.push('배치 ID 중복: '+layout.id);layoutIds.add(layout.id);
  if(names.has(layout.name))errors.push('배치 이름 중복: '+layout.name);names.add(layout.name);
  if(!(layout.width>0&&layout.height>0))errors.push('배치 용지 크기 오류: '+layout.name);
  for(const viewport of layout.viewports||[]){if(viewportIds.has(viewport.id))errors.push('뷰포트 ID 중복: '+viewport.id);viewportIds.add(viewport.id);if(!(viewport.denominator>0))errors.push('뷰포트 축척 오류: '+viewport.id);}
 }
 const current=session?.present?.currentSpace;if(current?.kind==='paper'&&!layoutIds.has(current.layoutId))errors.push('현재 배치가 없습니다.');
 return {valid:errors.length===0,errors,layouts:layoutIds.size,viewports:viewportIds.size};
}
