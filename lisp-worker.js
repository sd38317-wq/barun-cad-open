// 리습 전용 Worker — 자체 AutoLISP 엔진을 화면 스레드 밖에서 돌린다.
// 오래 걸리는 리습이 화면을 멈추지 않게 하고, 화면의 '중지' 가 worker.terminate() 로 바로 끊을 수 있게 한다.
// 질문이 필요하면 {ask} 를 돌려주고 끝난다. 답을 받으면 화면이 처음부터 다시 보낸다(runWithPrompts 와 같은 방식).
import { inspectFile, planRun, runNative, runNativeBridged, releasePristine, lispFilesFor } from './lisp-panel.js'
import { LispError } from './lisp-native.js'

let mcpState=null,mcpPending=null;

/** 메시지 하나를 처리해 돌려줄 값을 만든다(노드 시험도 이 함수를 쓴다). */
export function handleMessage(data) {
  if(data?.mcpCommit){if(mcpPending?.id===data.mcpCommit)mcpState=mcpPending.state;mcpPending=null;releasePristine();return null}
  if(data?.mcpDiscard){mcpPending=null;releasePristine();return null}
  if (data?.release) { releasePristine(); return null }      // 실행이 끝났다: 얼려 둔 원본 도면을 놓는다
  const { id, items = [], command = null, expression = null, snapshot, snapshotKey, inputs = [], preselected = [], activeLayer = '0', context = {}, timeLimitMs = 60_000, cardStorage } = data || {}
  // 바뀐 것만(delta) 알면 도면 전체를 화면으로 다시 복사해 보내지 않는다(19만 객체면 수 초).
  const session=data?.mcp?{interpreter:mcpState?.interpreter,loaded:new Map(mcpState?.loaded||[])}:null
  if(session&&data?.loadName)session.loaded.delete(data.loadName)
  const reply = (result) => { if(session)mcpPending={id,state:session}; if ('delta' in result) { const { document, ...rest } = result; return { id, result: rest } } return { id, result } }
  const failure = (e) => ({ id, error: { message: e?.message || String(e), ask: e?.ask || null, retry: !!e?.retry, lisp: e instanceof LispError, output: e?.output || '' } })
  try {
    const inspected=items.map(inspectFile),plan = planRun(inspected, command)
    if(data?.mcp){
      const own=inspected.find(f=>f.name===data.loadName)
      if(own?.error)throw new LispError(own.error)
      if(own&&!plan.files.includes(own))throw new LispError(plan.warnings.join('; '))
      if(plan.blockers.length)throw new LispError(plan.blockers.join('; '))
    }
    const files=lispFilesFor(plan.files,command)
    if(data?.loadName){const own=plan.files.find(f=>f.name===data.loadName);if(own&&!files.includes(own))files.push(own)}
    const options = { files, command, expression, snapshot, snapshotKey, inputs, preselected, activeLayer, context, sources: items, timeLimitMs, cardStorage, strict:!!data?.mcp, session }
    // 건축 요소 명령을 부르지 않는 리습은 예전처럼 바로(동기) 끝난다. 부르면 그 명령을 돌리며 다시 도는 길(비동기)로 넘어간다.
    try { return reply(runNative({ ...options, bridgeDone: [] })) }
    catch (e) { if (!e?.bridgeSuspend) throw e; return runNativeBridged(options).then(reply, failure) }
  } catch (e) {
    return failure(e)
  }
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
  self.onmessage = ({ data }) => { Promise.resolve(handleMessage(data)).then(reply => { if (reply) self.postMessage(reply) }) }
  self.postMessage({ ready: true })
}
