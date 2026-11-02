"""Optional LAN pad endpoint for the office: the pad sends pen points and typed text only.
CAD files and internal APIs are never exposed; command text runs on the PC through the same
command line as the keyboard (7.0: "사무실에서는 전부 다").

BC-03 (5.0.4 보안 검토): 0.0.0.0 전체 바인딩 대신 고른 LAN 주소 하나에만, 연결 중에만 열어 둔다.
페어링 시간 안에 연결이 없거나 패드가 한동안 조용하면 스스로 닫는다. 코드 시도는 IP별·전체 횟수를 제한한다.
"""
import json,secrets,time,threading,socket,math,io,base64,os,ipaddress
import qrcode
import qrcode.image.svg
from pathlib import Path
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
LOCK=threading.Lock();STATE={};SERVER=None;_WATCHDOG=None
ROOT=Path(__file__).resolve().parent
PORT=int(os.environ.get('BARUN_TABLET_PORT','1111'))
PAIR_WINDOW_SECONDS=int(os.environ.get('BARUN_TABLET_PAIR_WINDOW','180') or 180)   # 코드 유효 시간(예전 300초)
IDLE_LIMIT_SECONDS=int(os.environ.get('BARUN_TABLET_IDLE_LIMIT','600') or 600)      # 패드가 조용하면 닫는 시간
ATTEMPTS_PER_IP=5;ATTEMPTS_TOTAL=12
EVENTS_PER_POST=256;QUEUE_LIMIT=4000
KINDS=('point','view','clear','keep','voice','ask','text','undo','confirm','cancel')
MODES=('mark','select','draw','text')
INFO_TEXT={'drawing':120,'pending':160,'message':200}
CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"

def lan_addresses():
 """이 PC 의 사설 IPv4 주소 목록(루프백 제외). 기본 경로 인터페이스를 앞에 둔다(UDP connect 는 패킷을 보내지 않는다)."""
 found=[]
 try:
  probe=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
  try:probe.connect(('10.255.255.255',1));found.append(probe.getsockname()[0])
  except OSError:pass
  finally:probe.close()
 except OSError:pass
 try:found.extend(a[4][0] for a in socket.getaddrinfo(socket.gethostname(),None,socket.AF_INET))
 except OSError:pass
 ordered=[]
 for address in found:
  try:ip=ipaddress.ip_address(address)
  except ValueError:continue
  if ip.is_loopback or ip.is_link_local or ip.is_unspecified or address in ordered:continue
  ordered.append(address)
 return ordered

def choose_address(requested,candidates):
 if requested:
  requested=str(requested).strip()
  if requested in candidates or requested=='127.0.0.1':return requested
  raise ValueError('선택한 주소가 이 PC 의 네트워크 주소가 아닙니다. 목록에서 다시 고르세요.')
 private=[a for a in candidates if ipaddress.ip_address(a).is_private and not ipaddress.ip_address(a).is_link_local]
 return (private or candidates or [None])[0]

def _close_server_locked(reason=None):
 global SERVER
 server=SERVER;SERVER=None
 STATE.clear()
 if reason:STATE['closedReason']=reason
 if server is not None:
  try:server.shutdown()
  except Exception:pass
  try:server.server_close()
  except OSError:pass

def _watchdog():
 while True:
  time.sleep(2)
  with LOCK:
   if SERVER is None:return
   now=time.monotonic()
   if not STATE.get('owner'):_close_server_locked();return
   if not STATE.get('token') and now>STATE.get('expires',0):_close_server_locked('연결 코드 시간이 지나 패드 연결을 닫았습니다. PC에서 다시 시작하세요.');return
   if STATE.get('token') and now-STATE.get('seen',0)>IDLE_LIMIT_SECONDS:_close_server_locked('패드가 한동안 조용해 연결을 닫았습니다. PC에서 다시 시작하세요.');return

def start(owner,address=None):
 global SERVER,_WATCHDOG
 with LOCK:
  _close_server_locked()
  candidates=lan_addresses()
  bind=choose_address(address,candidates)
  if not bind:raise ValueError('Wi-Fi(LAN) 주소를 찾지 못했습니다. PC 네트워크 연결을 확인하세요.')
  try:SERVER=ThreadingHTTPServer((bind,PORT),PadHandler)
  except OSError:raise ValueError(f'패드 주소 {bind}의 {PORT} 포트가 사용 중입니다. 다른 바른 CAD 패드 연결을 종료한 뒤 다시 시도하세요.') from None
  SERVER.daemon_threads=True
  threading.Thread(target=SERVER.serve_forever,daemon=True,name='barun-tablet').start()
  STATE.clear();STATE.update(owner=owner,code=f'{secrets.randbelow(1000000):06}',expires=time.monotonic()+PAIR_WINDOW_SECONDS,token=None,queue=[],seen=0,seq=-1,attempts={},failures=0,bound=bind)
  _WATCHDOG=threading.Thread(target=_watchdog,daemon=True,name='barun-tablet-watchdog');_WATCHDOG.start()
  port=SERVER.server_port
 urls=[f'http://{bind}:{port}']
 qr=[]
 for url in urls:
  stream=io.BytesIO();qrcode.make(url,image_factory=qrcode.image.svg.SvgPathImage).save(stream);qr.append('data:image/svg+xml;base64,'+base64.b64encode(stream.getvalue()).decode())
 return {'urls':urls,'qr':qr,'code':STATE['code'],'bound':bind,'addresses':candidates,'expiresIn':PAIR_WINDOW_SECONDS,'idleLimit':IDLE_LIMIT_SECONDS}

def clean_info(info):
 out={k:str(info[k])[:n] for k,n in INFO_TEXT.items() if isinstance(info.get(k),str)}
 value=info.get('unitsPerPixel')
 if type(value) in (int,float) and math.isfinite(value) and 0<value<1e9:out['unitsPerPixel']=value
 return out

def stop():
 with LOCK:_close_server_locked()
 return {'stopped':True}

def local(data):
 action=data.get('action');owner=data.get('owner')
 if not isinstance(owner,str) or len(owner)<16:raise ValueError('입력판 세션 오류')
 if action=='start':return start(owner,data.get('address'))
 with LOCK:
  # 도면 칸마다 프로세스: 패드는 지금 보는 도면 칸을 따라간다. 연결은 그대로, 주인만 바뀐다(A15·A16).
  if action=='claim':
   if SERVER is None or not STATE.get('owner'):return {'active':False}
   if STATE['owner']!=owner:STATE.setdefault('moved',[]).append(STATE['owner']);STATE['owner']=owner;STATE['queue']=[]
   connected=bool(STATE.get('token')) and time.monotonic()-STATE.get('seen',0)<3
   return {'active':True,'connected':connected,'paired':bool(STATE.get('token')),'code':None if STATE.get('token') else STATE.get('code')}
  if STATE.get('owner')!=owner:
   if owner in STATE.get('moved',[]):return {'moved':True,'events':[],'connected':False}
   reason=STATE.get('closedReason')
   raise ValueError(reason or '이 창에서 시작한 연결이 아닙니다.')
  if action=='stop':_close_server_locked();return {'stopped':True}
  if action=='frame':
   image=data.get('image','')
   if not isinstance(image,str) or not image.startswith('data:image/jpeg;base64,') or len(image)>2000000:raise ValueError('화면 형식 오류')
   if any(type(data.get(k)) not in (int,float) or not math.isfinite(data[k]) or not 0<data[k]<=32000 for k in ('width','height')):raise ValueError('화면 크기 오류')
   STATE['frame']={'image':image,'width':data.get('width'),'height':data.get('height'),'id':STATE.get('frame_id',0)+1};STATE['frame_id']=STATE['frame']['id']
   info=data.get('info')
   if isinstance(info,dict):STATE['info']=clean_info(info)
   return {'ok':True,'id':STATE['frame_id']}
  if action=='info':
   info=data.get('info')
   if not isinstance(info,dict):raise ValueError('정보 형식 오류')
   STATE['info']=clean_info(info);return {'ok':True}
  if action=='poll':
   events=STATE['queue'];STATE['queue']=[]
   connected=bool(STATE.get('token')) and time.monotonic()-STATE.get('seen',0)<3
   return {'events':events if connected else [],'connected':connected}
 raise ValueError('지원하지 않는 입력판 요청')

class PadHandler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def send(self,data,status=200,content='application/json'):
  raw=(json.dumps(data,ensure_ascii=False).encode() if content=='application/json' else data)
  self.send_response(status);self.send_header('Content-Type',content);self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Content-Security-Policy',CSP);self.send_header('X-Frame-Options','DENY');self.end_headers();self.wfile.write(raw)
 def do_GET(self):
  name={'/':'tablet.html','/tablet-input.js':'tablet-input.js'}.get(self.path)
  if not name:return self.send({'error':'Not found'},404)
  self.send((ROOT/name).read_bytes(),content='text/html; charset=utf-8' if name.endswith('html') else 'text/javascript')
 def do_POST(self):
  try:
   if self.headers.get('Origin')!='http://'+self.headers.get('Host',''):return self.send({'error':'허용되지 않은 요청'},403)
   length=int(self.headers.get('Content-Length',0))
   if not 0<length<=32000:raise ValueError('입력 크기 오류')
   data=json.loads(self.rfile.read(length));now=time.monotonic()
   with LOCK:
    if not STATE.get('owner'):raise ValueError('PC에서 패드 연결을 시작하세요.')
    if self.path=='/pair':
     ip=self.client_address[0];attempt=STATE['attempts'].get(ip,[0,now])
     if now-attempt[1]>60:attempt=[0,now]
     attempt[0]+=1;STATE['attempts'][ip]=attempt
     if attempt[0]>ATTEMPTS_PER_IP:raise ValueError('잠시 후 다시 연결하세요.')
     paired=bool(STATE.get('token'))
     ok=not paired and now<=STATE['expires'] and secrets.compare_digest(str(data.get('code','')),STATE['code'])
     if not ok:
      STATE['failures']=STATE.get('failures',0)+1
      # 아직 짝이 안 맺어진 코드만 전체 시도 횟수로 닫는다. 이미 연결된 패드는 제3자의 실패 시도로 끊기지 않는다(IP별 제한만 적용).
      if not paired and STATE['failures']>=ATTEMPTS_TOTAL:
       _close_server_locked('연결 코드 시도가 너무 많아 패드 연결을 닫았습니다. PC에서 새 코드로 다시 시작하세요.')
       raise ValueError('연결 시도가 너무 많아 연결을 닫았습니다. PC에서 새 코드로 다시 시작하세요.')
      raise ValueError('연결 코드가 만료됐거나 올바르지 않습니다.' if not paired else '이미 연결된 패드가 있습니다.')
     STATE['token']=secrets.token_urlsafe(32);STATE['seen']=now;return self.send({'token':STATE['token']})
    if self.path not in ('/input','/frame') or not STATE.get('token') or not secrets.compare_digest(str(data.get('token','')),STATE['token']):return self.send({'error':'다시 연결하세요.'},403)
    if self.path=='/frame':
     STATE['seen']=now
     frame=STATE.get('frame');return self.send({'frame':frame if frame and frame['id']!=data.get('after') else None,'info':STATE.get('info',{})})
    events=data.get('events',[])
    if not isinstance(events,list) or len(events)>EVENTS_PER_POST:raise ValueError('입력 수 오류')
    accepted=[]
    for e in events:
     if not isinstance(e,dict) or e.get('kind') not in KINDS:raise ValueError('지원하지 않는 입력')
     if e.get('phase','move') not in ('down','move','up','cancel'):raise ValueError('입력 상태 오류')
     if e.get('mode','mark') not in MODES:raise ValueError('입력 모드 오류')
     if any(type(e[k]) not in (int,float) or not math.isfinite(e[k]) or abs(e[k])>10000 for k in ('x','y','dx','dy','factor') if k in e):raise ValueError('좌표 오류')
     if 'frame' in e and (type(e['frame']) is not int or not 0<=e['frame']<2**31):raise ValueError('화면 번호 오류')
     if 'text' in e and (not isinstance(e['text'],str) or len(e['text'])>500):raise ValueError('글이 너무 깁니다.')
     if 'as' in e and e['as'] not in ('memo','text'):raise ValueError('글 종류 오류')
     if 'ruler' in e and type(e['ruler']) is not bool:raise ValueError('자 표시 오류')
     accepted.append({k:v for k,v in e.items() if k in ('kind','phase','mode','x','y','dx','dy','factor','frame','text','as','ruler')})
    seq=data.get('seq')
    if type(seq) is not int:raise ValueError('입력 순서 오류')
    if seq>STATE['seq']:
     STATE['seq']=seq
     queue=STATE['queue']+accepted
     # 와이파이가 밀려 쌓여도 획을 버리지 않는다: 획 중간 점만 하나 건너 하나 줄인다(A20).
     while len(queue)>QUEUE_LIMIT:
      moves=[i for i,e in enumerate(queue) if e.get('kind')=='point' and e.get('phase','move')=='move']
      if not moves:queue=queue[-QUEUE_LIMIT:];break
      drop=set(moves[::2]);queue=[e for i,e in enumerate(queue) if i not in drop]
     STATE['queue']=queue
    STATE['seen']=now;self.send({'ok':True})
  except Exception as e:self.send({'error':str(e)},400)
