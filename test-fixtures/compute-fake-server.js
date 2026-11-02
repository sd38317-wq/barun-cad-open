// 시험용 가짜 바른 서버. 화면 → 서버 길(JSON 으로 보내고 JSON 으로 받기)을 그대로 흉내 내고,
// 계산은 실제 서버 묶음과 같은 compute/actions.js 로 한다. 불러오기만 하면 compute-client 의 길이 이리로 바뀐다.
import {setComputeTransport,ComputeError} from '../compute-client.js';
import {runCompute,ComputeInputError} from '../compute/actions.js';

export const computeCalls=[];
/** 서버 창구와 같은 오류 규칙: 형식 오류는 bad_input, 계산 코드가 일부러 던진 Error 는 그 문장, 나머지는 일반 문장. */
export function computeErrorOf(error){
 if(error instanceof ComputeInputError)return new ComputeError('계산 입력이 올바르지 않습니다 ('+error.message+').','bad_input');
 if(error?.constructor===Error)return new ComputeError(error.message,'cannot_compute');
 return new ComputeError('바른 서버가 이 도면을 계산하지 못했습니다.','cannot_compute');
}
export async function fakeComputeTransport(action,input){
 computeCalls.push(action);
 const wire=JSON.parse(JSON.stringify({action,input}));
 await null;
 let result;
 try{result=runCompute(wire.action,wire.input);}catch(error){throw computeErrorOf(error);}
 return JSON.parse(JSON.stringify(result));
}
setComputeTransport(fakeComputeTransport);
