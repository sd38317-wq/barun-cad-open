// 리습이 값을 물을 때마다 폼 창으로 한 가지씩 받는 질문 대기열.
// dialog.close() 의 close 이벤트는 별도 task 로 늦게 오므로, 첫 답을 낸 뒤 리습이 곧바로 다음 질문 창을 열면
// 이전 창의 close 이벤트가 다음 질문에 도착한다. 그때 창이 다시 열려 있으면(dialogOpen) 취소하지 않는다.
export function createQuestionQueue(){
  let pending=null;
  return {
    ask(resolve){
      const settle=value=>{if(pending!==settle)return false;pending=null;resolve(value);return true;};
      pending=settle;
      return settle;
    },
    hasPending(){return pending!==null;},
    isCurrent(settle){return pending===settle;},
    /* 직접 처리(도면에서 찍기 등)로 넘길 때 대기열에서 뺀다. 현재 질문이 아니면 false. */
    takeover(settle){if(pending!==settle)return false;pending=null;return true;},
    /* 폼 창 close 이벤트. 창이 다시 열려 있으면 이전 질문의 늦은 이벤트로 보고 무시한다. */
    onDialogClose({dialogOpen=false}={}){
      if(dialogOpen)return false;
      const settle=pending;
      if(!settle)return false;
      settle(null);
      return true;
    },
  };
}
