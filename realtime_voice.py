"""Authenticated Miriboda voice bootstrap; provider keys never enter CAD."""
import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from parcel_service import BASE, cookie
MODELS={'gpt-realtime-2.1-mini','gpt-realtime-2.1'}

def create(data):
 session=cookie()
 if not session: raise ValueError('미리보다 계정으로 먼저 로그인하세요.')
 model=data.get('model','gpt-realtime-2.1-mini')
 if model not in MODELS: raise ValueError('지원하지 않는 음성 모델입니다.')
 sdp=data.get('sdp','')
 if not isinstance(sdp,str) or not sdp.startswith('v=0') or len(sdp)>100000: raise ValueError('음성 연결 정보가 올바르지 않습니다.')
 req=Request(BASE+'/api/cad/voice',data=json.dumps({'model':model,'sdp':sdp}).encode(),headers={'Content-Type':'application/json','Cookie':session},method='POST')
 try:
  with urlopen(req,timeout=45) as response:
   result=json.loads(response.read(150000))
   if not isinstance(result.get('sdp'),str) or not result['sdp'].startswith('v=0'): raise ValueError('음성 서버 응답을 확인하지 못했습니다.')
   return {name:result[name] for name in ('sdp','model','sessionId') if name in result}
 except HTTPError as e:
  messages={401:'미리보다 로그인이 만료되었습니다. 다시 로그인하세요.',403:'실시간 음성 구독 또는 남은 연결 한도를 확인하세요.',404:'미리보다 음성 서버 업데이트가 아직 적용되지 않았습니다.',503:'운영자가 음성 연결을 준비 중입니다.'}
  raise ValueError(messages.get(e.code,'미리보다 음성 연결에 실패했습니다. 잠시 후 다시 시도하세요.')) from None
 except (URLError,TimeoutError,json.JSONDecodeError): raise ValueError('미리보다 음성 서버에 연결하지 못했습니다.') from None
