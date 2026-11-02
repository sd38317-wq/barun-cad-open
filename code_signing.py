"""Windows 설치 파일 코드 서명(Azure Artifact Signing) 설정 읽기와 서명 확인.

설정 값은 저장소에 두지 않는다. 환경변수가 먼저, 없으면 이 PC 의 설정 파일
(%USERPROFILE%\\.barun\\code-signing.json, 다른 곳이면 BARUN_SIGN_SETTINGS)에서 읽는다.

  환경변수               설정 파일 키              무엇
  BARUN_SIGN_ENDPOINT    endpoint                  서명 계정 주소(Azure 포털 계정 개요의 Account URI 그대로)
  BARUN_SIGN_ACCOUNT     codeSigningAccountName    서명 계정 이름
  BARUN_SIGN_PROFILE     certificateProfileName    인증서 프로필 이름
  BARUN_SIGN_PUBLISHER   publisherName             인증서 게시자 이름(인증서 Subject 의 CN 과 글자까지 같게)

Azure 로그인: 이 PC 에서 `az login` 해 두거나, 앱 등록 비밀을 AZURE_TENANT_ID·AZURE_CLIENT_ID·AZURE_CLIENT_SECRET
환경변수(또는 설정 파일의 같은 이름 키)로 준다. 비밀은 설정 파일에만 두고 NAS 공유 폴더·저장소에 두지 않는다.

값이 하나도 없으면 지금처럼 서명 없이 빌드하고 크게 알린다. 일부만 있으면 빌드를 멈춘다(서명된 줄 알고 안 된 판이 나가지 않게).
build/code-signing.json 의 required 가 true 이면 서명 없이는 빌드하지 않는다 — 첫 서명 판을 서버에 올린 뒤 켠다.
그 판부터 설치본이 업데이트 파일의 게시자를 확인하므로, 서명 안 된 판을 올리면 사용자 업데이트가 실패한다.
"""
from pathlib import Path
import copy,json,os,re,subprocess

FIELDS={'endpoint':'BARUN_SIGN_ENDPOINT','codeSigningAccountName':'BARUN_SIGN_ACCOUNT','certificateProfileName':'BARUN_SIGN_PROFILE','publisherName':'BARUN_SIGN_PUBLISHER'}
AZURE_CREDENTIALS=('AZURE_TENANT_ID','AZURE_CLIENT_ID','AZURE_CLIENT_SECRET')
POLICY=Path(__file__).parent/'build'/'code-signing.json'
ENDPOINT=re.compile(r'https://[a-z0-9-]+\.codesigning\.azure\.net/?')

class SigningConfigError(SystemExit):
    pass

def settings_path(environ):
    return Path(environ.get('BARUN_SIGN_SETTINGS') or Path.home()/'.barun'/'code-signing.json')

def required(policy_path=POLICY):
    return json.loads(Path(policy_path).read_text(encoding='utf8')).get('required') is True

def load(environ=None,policy_path=POLICY):
    """(azureSignOptions 또는 None, electron-builder 에 더 넘길 환경변수) 를 돌려준다."""
    environ=os.environ if environ is None else environ
    path=settings_path(environ)
    try:stored=json.loads(path.read_text(encoding='utf8')) if path.is_file() else {}
    except ValueError as error:raise SigningConfigError(f'서명 설정 파일을 읽지 못했습니다: {path} ({error})')
    options={key:str(environ.get(name) or stored.get(key) or '').strip() for key,name in FIELDS.items()}
    if not any(options.values()):
        if required(policy_path):raise SigningConfigError('build/code-signing.json 이 서명을 요구합니다(required). 서명 설정 없이 만든 판은 서명된 설치본의 업데이트를 깨뜨립니다. '+describe_missing(FIELDS))
        return None,{}
    missing={key:name for key,name in FIELDS.items() if not options[key]}
    if missing:raise SigningConfigError('서명 설정이 일부만 있습니다. '+describe_missing(missing))
    if not ENDPOINT.fullmatch(options['endpoint']):raise SigningConfigError(f'서명 계정 주소가 이상합니다: {options["endpoint"]} (예: https://<지역>.codesigning.azure.net/)')
    env={name:str(stored[name]) for name in AZURE_CREDENTIALS if stored.get(name) and not environ.get(name)}
    return options,env

def describe_missing(fields):
    return '빠진 값: '+', '.join(f'{name}(설정 파일 {key})' for key,name in fields.items())

def builder_config(base,options):
    """electron-builder 설정에 서명을 더한 사본. 원본 JSON 은 서명 없는 판 그대로 둔다."""
    config=copy.deepcopy(base)
    win=config.setdefault('win',{})
    win['signExecutable']=True
    win['azureSignOptions']=dict(options)
    # 설치본 resources/app-update.yml 에 publisherName 이 적혀, electron-updater 가 받은 설치 파일의 서명 게시자를 확인한다.
    win['verifyUpdateCodeSignature']=True
    return config

def yaml_scalar(text):
    """js-yaml 이 쓰는 한 줄 값: 'O''Brien' → O'Brien, "a\\"b" → a"b, 따옴표 없으면 그대로."""
    if len(text)>=2 and text[0]==text[-1]=="'":return text[1:-1].replace("''","'")
    if len(text)>=2 and text[0]==text[-1]=='"':return json.loads(text)
    return text

def update_config_problem(app_update_yml,options):
    """설치본 resources/app-update.yml 검사. 서명 판에는 게시자 이름이 꼭 있어야 하고(업데이트 바꿔치기 확인),
    서명 안 된 판에는 없어야 한다(있으면 그 설치본이 다음 무서명 판 업데이트를 거부한다). 문제 글 또는 None."""
    names=None
    for line in app_update_yml.splitlines():
        if names is None:
            if line.startswith('publisherName:'):
                rest=line.split(':',1)[1].strip()
                names=[yaml_scalar(rest)] if rest else []
        elif line.startswith((' ','\t')) and line.strip().startswith('-'):names.append(yaml_scalar(line.strip()[1:].strip()))
        else:break
    if options is None:
        return 'app-update.yml 에 publisherName 이 있습니다(서명 안 된 판인데 업데이트 서명 확인이 켜짐)' if names is not None else None
    if not names:return 'app-update.yml 에 publisherName 이 없습니다(설치본이 업데이트 게시자를 확인하지 않음)'
    if options['publisherName'] not in names:return f'app-update.yml 의 publisherName {names} 이 설정({options["publisherName"]})과 다릅니다'
    return None

def unsigned_banner():
    line='!'*72
    return '\n'.join([line,'!!  서명 안 됨: 이 설치 파일은 코드 서명이 없습니다.',
        '!!  윈도우가 "알 수 없는 게시자"·SmartScreen 경고를 띄우고, 바꿔치기한 업데이트를 설치본이 가려내지 못합니다.',
        '!!  서명하려면 '+', '.join(FIELDS.values())+' 를 환경변수나 %USERPROFILE%\\.barun\\code-signing.json 에 채우세요.',line])

def parse_dn(text):
    """'CN="Barun, Inc.", O=Barun, C=KR' → {'CN':'Barun, Inc.','O':'Barun','C':'KR'} (electron-updater 와 같은 뜻으로 비교하려고)."""
    parts={};i=0;n=len(text)
    while i<n:
        while i<n and text[i] in ' ,':i+=1
        eq=text.find('=',i)
        if eq<0:break
        key=text[i:eq].strip();i=eq+1
        if i<n and text[i]=='"':
            end=i+1;value=''
            while end<n:
                if text[end]=='"' and end+1<n and text[end+1]=='"':value+='"';end+=2;continue
                if text[end]=='"':break
                value+=text[end];end+=1
            i=end+1
        else:
            end=text.find(',',i);end=n if end<0 else end
            value=text[i:end].strip();i=end
        if key and key not in parts:parts[key]=value
    return parts

def publisher_matches(subject,publisher_names):
    """electron-updater(windowsExecutableCodeSignatureVerifier)와 같은 규칙: 이름에 '=' 가 있으면 적힌 칸 전부, 없으면 CN 만 비교."""
    parsed=parse_dn(subject)
    for name in publisher_names:
        wanted=parse_dn(name) if '=' in name else {}
        if wanted and all(parsed.get(key)==value for key,value in wanted.items()):return True
        if not wanted and parsed.get('CN')==name:return True
    return False

def read_signature(path,run=subprocess.run):
    script=("[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
            "$s=Get-AuthenticodeSignature -LiteralPath $env:BARUN_SIGNED_FILE;"
            "[pscustomobject]@{Status=[string]$s.Status;Subject=[string]$s.SignerCertificate.Subject;Timestamp=[bool]$s.TimeStamperCertificate}|ConvertTo-Json -Compress")
    result=run(['powershell.exe','-NoProfile','-NonInteractive','-Command',script],capture_output=True,env={**os.environ,'BARUN_SIGNED_FILE':str(path)},timeout=60)
    if result.returncode:raise RuntimeError((result.stderr or b'').decode('utf8','replace').strip() or 'Get-AuthenticodeSignature 실패')
    return json.loads(result.stdout.decode('utf8'))

def verify_signed(paths,publisher_name,run=subprocess.run):
    """서명 빌드 끝 검사: 파일마다 서명이 유효하고, 게시자가 설정과 같고, 시간 도장이 있는지. 문제 목록(비면 통과)."""
    names=[publisher_name] if isinstance(publisher_name,str) else list(publisher_name)
    problems=[]
    for path in paths:
        if not Path(path).is_file():problems.append(f'{Path(path).name}: 파일이 없습니다');continue
        try:info=read_signature(path,run)
        except Exception as error:problems.append(f'{Path(path).name}: 서명을 읽지 못했습니다 ({error})');continue
        if info.get('Status')!='Valid':problems.append(f'{Path(path).name}: 서명 상태 {info.get("Status")}');continue
        if not publisher_matches(info.get('Subject') or '',names):problems.append(f'{Path(path).name}: 게시자 {info.get("Subject")!r} 가 설정({" | ".join(names)})과 다릅니다 — 업데이트 확인이 실패합니다')
        if not info.get('Timestamp'):problems.append(f'{Path(path).name}: 시간 도장이 없습니다(인증서가 끝나면 서명이 무효가 됩니다)')
    return problems
