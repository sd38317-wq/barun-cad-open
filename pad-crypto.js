// 패드 원격 수정(1단계) 종단 간 암호화. 서버는 암호문만 받는다 — 열쇠는 링크의 # 뒤에만 있어 서버로 가지 않는다.
// 규약: 내용 = gzip(JSON) → AES-256-GCM, 결과 = base64url(iv 12바이트 + 암호문), AAD = "barun-pad/1:" + 세션 ID.
// 브라우저(패드·바른 CAD 화면)와 Node 테스트 모두 WebCrypto·CompressionStream 만 쓴다.
const encoder=new TextEncoder(),decoder=new TextDecoder();
export const PAD_AAD_PREFIX='barun-pad/1:';
export const PAD_ID_PATTERN=/^[A-Za-z0-9_-]{22}$/;

export function toBase64Url(bytes){
 let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
 return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function fromBase64Url(text){
 if(typeof text!=='string'||!/^[A-Za-z0-9_-]*$/.test(text))throw Error('암호문 형식이 올바르지 않습니다.');
 const binary=atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-text.length%4)%4)),bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;
}
export const randomToken=(size=32)=>toBase64Url(crypto.getRandomValues(new Uint8Array(size)));
/** 세션 ID 는 바른 CAD 가 만든다(128비트, 22글자). 암호문의 AAD 에 들어가야 해서 서버 발급을 기다릴 수 없다. */
export const newPadSessionId=()=>randomToken(16);
export async function sha256Hex(text){
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)));
 return [...digest].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
const pipe=async(bytes,stream)=>new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
async function importKey(keyText){
 const raw=fromBase64Url(keyText);if(raw.length!==32)throw Error('링크의 열쇠가 올바르지 않습니다. 링크를 끝까지 복사했는지 확인하세요.');
 return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
}
/** 바이트를 잠근다: gzip → AES-256-GCM. 구운 도면 묶음(pad-pack.js)도, JSON 도 이 길로 간다. */
export async function sealPadBytes(bytes,keyText,sessionId){
 const iv=crypto.getRandomValues(new Uint8Array(12)),packed=await pipe(bytes,new CompressionStream('gzip'));
 const sealed=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(PAD_AAD_PREFIX+sessionId)},await importKey(keyText),packed));
 const out=new Uint8Array(12+sealed.length);out.set(iv);out.set(sealed,12);return toBase64Url(out);
}
export async function openPadBytes(text,keyText,sessionId){
 const bytes=fromBase64Url(text);if(bytes.length<29)throw Error('암호문이 너무 짧습니다.');
 let packed;
 try{packed=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.subarray(0,12),additionalData:encoder.encode(PAD_AAD_PREFIX+sessionId)},await importKey(keyText),bytes.subarray(12));}
 catch(error){if(/열쇠/.test(error?.message))throw error;throw Error('도면을 풀 수 없습니다. 링크가 바뀌었거나 다른 세션의 열쇠입니다.');}
 return pipe(new Uint8Array(packed),new DecompressionStream('gzip'));
}
export async function sealPadJson(value,keyText,sessionId){return sealPadBytes(encoder.encode(JSON.stringify(value)),keyText,sessionId);}
export async function openPadJson(text,keyText,sessionId){return JSON.parse(decoder.decode(await openPadBytes(text,keyText,sessionId)));}
/** 링크: <주소>/p/<세션ID>#k=<열쇠>&w=<쓰기토큰>. 쓰기토큰이 없으면 보기 전용 링크다. */
export function padLink(origin,sessionId,keyText,writeToken){
 return `${String(origin).replace(/\/+$/,'')}/p/${sessionId}#k=${keyText}${writeToken?'&w='+writeToken:''}`;
}
export function parsePadLocation(pathname,hash){
 const id=String(pathname).match(/\/p\/([A-Za-z0-9_-]{22})\/?$/)?.[1]||'';
 const params=new URLSearchParams(String(hash||'').replace(/^#/,''));
 return {id,key:params.get('k')||'',writeToken:params.get('w')||''};
}
