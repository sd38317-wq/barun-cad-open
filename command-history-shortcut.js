// Ctrl+Z / Ctrl+Y 를 어디로 보낼지 정한다(명령창 포커스·도면 포커스 공통).
//  - 명령이 없을 때: 도면 되돌리기/다시 실행(document)
//  - 점을 이어 찍는 명령(선·폴리선·경로·구적·단열재·XCLIP)에서 이미 찍은 점이 있으면: 그 명령의 U(마지막 점 취소)(step)
//  - 그 밖의 명령 도중: 지금 명령만 취소(cancel). 도면의 다른 작업을 되돌리지 않는다.
//  - 명령 도중 Ctrl+Y: 아무것도 하지 않고 안내(ignore)
const STEP_MODES=new Set(['LINE','PLINE','PICKPATH','AHM','XCLIP','INSULATION']);
export function historyShortcutAction({name,mode,phase,points=[],lineSteps=[]}){
  if(mode==='SELECT'&&phase==='idle')return {action:'document'};
  if(name==='REDO')return {action:'ignore',message:'명령 진행 중에는 다시 실행할 수 없습니다. Esc 로 명령을 끝낸 뒤 Ctrl+Y 를 누르세요.'};
  if(STEP_MODES.has(mode)){
    const hasStep=mode==='LINE'?lineSteps.length>0:mode==='PLINE'?points.length>1:points.length>0;
    if(hasStep)return {action:'step'};
  }
  return {action:'cancel',message:'명령을 취소했습니다. 도면 되돌리기(Ctrl+Z)는 명령이 없을 때 누르세요.'};
}
