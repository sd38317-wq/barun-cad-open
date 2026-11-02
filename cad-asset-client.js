// 필요한 명령을 실행할 때만 로드합니다. 받은 기하는 요청/Worker 메모리에만 둡니다.
import {engineToken} from './studio.js';
import {lockedImport} from './screen-vault.js';

export async function requestCadAsset(path, body = {}, {fetch:fetchImpl=(...args)=>globalThis.fetch(...args), desktop=globalThis.window?.cadDesktop, timeoutMs=20_000} = {}) {
  const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const statusResponse = await fetchImpl('/api/status',{signal:controller.signal,cache:'no-store'});
    if (!statusResponse.ok) throw Object.assign(Error('로그인 필요: CAD 엔진에 연결하지 못했습니다.'),{code:'offline'});
    const token = await engineToken(await statusResponse.json(),desktop);
    if (!token) throw Object.assign(Error('로그인 필요: CAD 엔진 연결을 확인하세요.'),{code:'offline'});
    const response = await fetchImpl('/api/cad-asset/' + path,{method:'POST',headers:{'Content-Type':'application/json','X-CAD-Token':token},body:JSON.stringify(body),signal:controller.signal,cache:'no-store'});
    const result = await response.json();
    if (!response.ok || result?.error) throw Object.assign(Error(result?.message || result?.error || '로그인 필요'),{code:result?.code || ({401:'not_logged_in',429:'limit',404:'not_found'}[response.status]) || 'offline',status:response.status});
    return result;
  } catch (error) {
    if (error?.code) throw error;
    throw Object.assign(Error('로그인 필요: 서버 자산을 받지 못했습니다.'),{code:'offline',cause:error});
  } finally {clearTimeout(timer);}
}

export async function prepareStandardDetails(document, request, {api=requestCadAsset} = {}) {
  const previous = request.setId && document.drawingSets?.[request.setId], kind = request.kind || previous?.kind || 'set';
  if (!['set','details'].includes(kind) || request.standardDetails !== undefined) return request;
  const options = {...previous?.options,...request};
  const {pendingEdits} = await import('./drawing-sync.js');
  const model = request.model || (previous && pendingEdits(document,request.setId)?.model) || previous?.model || {stories:[],elements:[]};
  const {autoSelect,selectDetailItems,isGeneratorDetail} = await lockedImport('drawing-details/registry.js');
  if (kind === 'details') {
    if (request.ids !== undefined) delete options.group;
    else if (request.group !== undefined) delete options.ids;
  }
  const selected = kind === 'details' ? selectDetailItems({...options,model}) : request.assemblies?.details && request.standard?.details ? autoSelect(model,{details:request.details}) : [];
  const ids = [...new Set(selected.filter(item=>!isGeneratorDetail(item.id)).map(item=>item.id))], standardDetails = {}, standardDetailErrors = {};
  if (!ids.length) return {...request,standardDetails,standardDetailErrors};
  let catalog;
  try {catalog = await api('catalog',{kind:'detail'});}
  catch (error) {for (const id of ids) standardDetailErrors[id] = error.code || 'offline';return {...request,standardDetails,standardDetailErrors};}
  const entries = Array.isArray(catalog) ? catalog.filter(entry=>entry.kind==='detail') : [];
  const found = new Map();
  for (const id of ids) {
    const entry = entries.find(entry=>entry.id===id || Object.values(entry.ids || {}).some(covered=>covered.includes(id)));
    if (!entry) continue; // 서버 목록에도 없는 표준판은 작성 예정입니다.
    if (!found.has(entry.id)) found.set(entry.id,[]);
    found.get(entry.id).push(id);
  }
  let stopped;
  for (const [assetId,covered] of found) {
    if (stopped) {for (const id of covered) standardDetailErrors[id] = stopped;continue;}
    try {
      const asset = await api('detail/' + encodeURIComponent(assetId),{});
      if (asset?.format !== 'barun-asset/1' || asset.kind !== 'detail' || !Array.isArray(asset.scenes)) throw Object.assign(Error('잘못된 상세 자산'),{code:'offline'});
      for (const id of covered) standardDetails[id] = asset;
    } catch (error) {
      if (error.code !== 'not_found') for (const id of covered) standardDetailErrors[id] = error.code || 'offline';
      if (['not_logged_in','limit','offline'].includes(error.code)) stopped = error.code;
    }
  }
  return {...request,standardDetails,standardDetailErrors};
}
