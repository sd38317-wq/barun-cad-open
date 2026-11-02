"""Isolated bundled ACadSharp conversion; never passes drawings through our editor."""
from pathlib import Path
import base64, contextlib, os, re, subprocess, sys, tempfile, threading, json, uuid, datetime, time
import runtime_paths
import ezdxf
from collections import Counter

FALLBACK_MEMORY_LIMIT = 4 * 1024 * 1024 * 1024
FALLBACK_MEMORY_WARNING = '보조 엔진이 메모리 상한(4GB)을 넘었거나 사용할 메모리가 부족해 중단되었습니다.'

def _fallback_process_options():
    # POSIX 상한은 Rust 실행기 시작 단계에서 설정한다. 다중 스레드 서버에서 preexec_fn을 쓰지 않는다.
    return {}

RUNTIME=Path(os.environ.get('BARUN_DWG_RUNTIME') or runtime_paths.bundled_runtime('dwg-runtime'))
CONVERTER='BarunConverter'+runtime_paths.EXE
ENGINE_VERSION=os.environ.get('BARUN_DWG_ENGINE_VERSION','ACadSharp 3.8.0')
LOCK=threading.Lock()
# ACadSharp CLR entity type names -> DXF type names, for per-type count checks.
# ATTDEF is a preserved entity, not an extra entity or a lost ATTRIBUTEDEFINITION.
ENGINE_DXF_TYPES={**{'Insert':'INSERT','Circle':'CIRCLE','TextEntity':'TEXT','Line':'LINE','LwPolyline':'LWPOLYLINE','Arc':'ARC','Hatch':'HATCH','DimensionLinear':'DIMENSION','DimensionAligned':'DIMENSION','DimensionAngular2Line':'DIMENSION','DimensionAngular3Pt':'DIMENSION','DimensionRadius':'DIMENSION','DimensionDiameter':'DIMENSION','DimensionOrdinate':'DIMENSION','Ellipse':'ELLIPSE','MText':'MTEXT','Region':'REGION','Spline':'SPLINE','Face3D':'3DFACE','Polyline2D':'POLYLINE','Polyline3D':'POLYLINE','Solid':'SOLID','Leader':'LEADER','RasterImage':'IMAGE','DimensionArc':'ARC_DIMENSION','TableEntity':'ACAD_TABLE'},'AttributeDefinition':'ATTDEF'}
def expected_dxf_types(input_types):
    expected=Counter()
    for kind,count in (input_types or {}).items():expected[ENGINE_DXF_TYPES.get(kind,kind.upper())]+=count
    return expected
# Names shown to the user when an import opens without some objects.
DXF_TYPE_LABELS={'WIPEOUT':'가림막(WIPEOUT)','INSERT':'블록 참조','ACAD_TABLE':'표(TABLE)','REGION':'영역(REGION)','ARC_DIMENSION':'호 길이 치수',
    'DIMENSION':'치수','OLE2FRAME':'OLE 개체','MULTILEADER':'다중 지시선','LEADER':'지시선','IMAGE':'이미지','HATCH':'해치','TEXT':'문자','MTEXT':'여러 줄 문자',
    'LINE':'선','LWPOLYLINE':'폴리선','POLYLINE':'폴리선','ARC':'호','CIRCLE':'원','SPLINE':'스플라인','UNKNOWNENTITY':'알 수 없는 객체'}
def type_counts_text(counts):
    return ', '.join(f"{DXF_TYPE_LABELS.get(kind,kind)} {count:,}개" for kind,count in sorted(counts.items(),key=lambda item:-item[1]))
def count_difference(expected,actual,invalid_types=None):
    """(missing, extra) per DXF type. Entities the engine flagged invalid in the
    source (an INSERT of a block that does not exist) may be kept or dropped."""
    missing=expected-actual;extra=actual-expected
    for kind,count in expected_dxf_types(invalid_types).items():
        if extra[kind]:extra[kind]-=min(extra[kind],count)
    return dict(+missing),dict(+extra)
# DXF types the primary engine reads but cannot write. Its output is then certainly
# incomplete, so the importer checks the secondary engine first and reads the
# primary output only when the secondary does worse (a 846k-object plan with
# REGIONs spent 72 s reading a primary output that was then discarded).
SECONDARY_FIRST_TYPES={'REGION','ACAD_TABLE'}
# Unreadable REGIONs may only be carried by the fallback preservation layer.
NOT_DRAWN_TYPES={'REGION'}
def conversion_loss(candidate):
    return sum(candidate['missing'].values())+sum(candidate['extra'].values())

def fast_modelspace_types(path):
    """ezdxf 로 통째로 읽지 않고 모형 공간 객체 수를 형식별로 센다(2026-10-30, 주통 19만 객체 보조 엔진 결과 통째 읽기 15초 → 이걸로 고를 수 있다).
    ezdxf 와 같은 규칙: ENTITIES 구역만, 주인(330)이 *Paper_Space 면 종이 공간·*Model_Space 면 모형 공간·없으면 67 값,
    INSERT(66=1)·POLYLINE 뒤 ATTRIB·VERTEX·SEQEND 는 따로 세지 않는다. 이진 DXF·구조가 이상하면 None(통째로 읽어 센다)."""
    data=Path(path).read_bytes()
    if data.startswith(b'AutoCAD Binary DXF'):return None
    lines=data.split(b'\n')
    if len(lines)%2:lines.append(b'')
    codes=lines[0::2];values=lines[1::2]
    special={'*model_space':None,'*paper_space':None};counts=Counter()
    section=None;kind=None;owner=None;paper=None;follow=False;linked=None;record=None;name=None
    def finish():
        nonlocal linked
        if section==b'TABLES' and kind==b'BLOCK_RECORD' and name is not None and name.casefold() in special:special[name.casefold()]=record
        if section!=b'ENTITIES' or kind is None:return
        if linked is not None:
            if kind==b'SEQEND':linked=None
            return
        if kind==b'POLYLINE' or (kind==b'INSERT' and follow):linked=kind
        space=1 if owner is not None and owner==special['*paper_space'] else 0 if owner is not None and owner==special['*model_space'] else paper or 0
        if not space:counts[kind.decode('ascii','replace')]+=1
    for code,value in zip(codes,values):
        code=code.strip()
        if code==b'0':
            finish();value=value.strip();kind=None;owner=None;paper=None;follow=False;record=None;name=None
            if value==b'ENDSEC':section=None
            elif value not in (b'SECTION',b'EOF'):kind=value
            continue
        if kind is None:
            if code==b'2' and section is None:section=value.strip()
            continue
        if code==b'330' and owner is None:owner=value.strip().upper().decode('ascii','replace')
        elif code==b'67':
            try:paper=int(value)
            except ValueError:return None
        elif code==b'66' and kind==b'INSERT':follow=value.strip() not in (b'0',b'')
        elif code==b'5' and kind==b'BLOCK_RECORD':record=value.strip().upper().decode('ascii','replace')
        elif code==b'2' and kind==b'BLOCK_RECORD':name=value.strip().decode('utf-8','replace')
    finish()
    return counts

# 변환 중에 서버가 닫혀도 미리 돌리던 보조 엔진이 남지 않게: Windows 작업 개체(KILL_ON_JOB_CLOSE)에 넣는다.
# 서버 프로세스가 끝나 핸들이 닫히면 이 개체 안의 프로세스만 함께 끝난다(서버가 연 브라우저 등은 넣지 않는다).
_JOB=None
_JOB_GUARD=threading.RLock()
_JOB_MEMORY_PIDS=set()
def _converter_job():
    with _JOB_GUARD:
        return _create_converter_job()

def _create_converter_job():
    global _JOB
    if _JOB is not None or os.name!='nt':return _JOB or None
    job=port=None
    try:
        import ctypes
        from ctypes import wintypes
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.CreateJobObjectW.restype=wintypes.HANDLE
        kernel.CreateJobObjectW.argtypes=[ctypes.c_void_p,wintypes.LPCWSTR]
        kernel.SetInformationJobObject.argtypes=[wintypes.HANDLE,ctypes.c_int,ctypes.c_void_p,wintypes.DWORD]
        kernel.AssignProcessToJobObject.argtypes=[wintypes.HANDLE,wintypes.HANDLE]
        kernel.CloseHandle.argtypes=[wintypes.HANDLE]
        kernel.CreateIoCompletionPort.argtypes=[wintypes.HANDLE,wintypes.HANDLE,ctypes.c_size_t,wintypes.DWORD]
        kernel.CreateIoCompletionPort.restype=wintypes.HANDLE
        kernel.GetQueuedCompletionStatus.argtypes=[wintypes.HANDLE,ctypes.POINTER(wintypes.DWORD),ctypes.POINTER(ctypes.c_size_t),ctypes.POINTER(ctypes.c_void_p),wintypes.DWORD]
        class Completion(ctypes.Structure):
            _fields_=[('CompletionKey',ctypes.c_void_p),('CompletionPort',wintypes.HANDLE)]
        class Basic(ctypes.Structure):
            _fields_=[('PerProcessUserTimeLimit',ctypes.c_int64),('PerJobUserTimeLimit',ctypes.c_int64),('LimitFlags',wintypes.DWORD),('MinimumWorkingSetSize',ctypes.c_size_t),('MaximumWorkingSetSize',ctypes.c_size_t),('ActiveProcessLimit',wintypes.DWORD),('Affinity',ctypes.c_size_t),('PriorityClass',wintypes.DWORD),('SchedulingClass',wintypes.DWORD)]
        class Io(ctypes.Structure):
            _fields_=[(name,ctypes.c_ulonglong) for name in ('ReadOperationCount','WriteOperationCount','OtherOperationCount','ReadTransferCount','WriteTransferCount','OtherTransferCount')]
        class Extended(ctypes.Structure):
            _fields_=[('BasicLimitInformation',Basic),('IoInfo',Io),('ProcessMemoryLimit',ctypes.c_size_t),('JobMemoryLimit',ctypes.c_size_t),('PeakProcessMemoryUsed',ctypes.c_size_t),('PeakJobMemoryUsed',ctypes.c_size_t)]
        job=kernel.CreateJobObjectW(None,None)
        if not job:return None
        info=Extended();info.BasicLimitInformation.LimitFlags=0x2000|0x100
        info.ProcessMemoryLimit=FALLBACK_MEMORY_LIMIT
        if not kernel.SetInformationJobObject(job,9,ctypes.byref(info),ctypes.sizeof(info)):
            raise ctypes.WinError(ctypes.get_last_error())
        port=kernel.CreateIoCompletionPort(wintypes.HANDLE(-1),None,0,1)
        if not port:raise ctypes.WinError(ctypes.get_last_error())
        completion=Completion(None,port)
        if not kernel.SetInformationJobObject(job,7,ctypes.byref(completion),ctypes.sizeof(completion)):
            raise ctypes.WinError(ctypes.get_last_error())
        _JOB_MEMORY_PIDS.clear()
        _JOB=(kernel,job,port)
    except Exception:
        if port:kernel.CloseHandle(port)
        if job:kernel.CloseHandle(job)
        _JOB=False
    return _JOB or None

def _attach_to_job(process):
    job=_converter_job()
    if not job or process is None:return False
    try:return bool(job[0].AssignProcessToJobObject(job[1],int(process._handle)))
    except Exception:return False

def _resume_fallback(process):
    """Resume the suspended process, including its primary thread, without a global snapshot."""
    import ctypes
    from ctypes import wintypes
    ntdll=ctypes.WinDLL('ntdll')
    resume=ntdll.NtResumeProcess
    resume.argtypes=[wintypes.HANDLE]
    resume.restype=wintypes.LONG
    status=resume(int(process._handle))
    if status < 0:raise OSError('보조 엔진 재개 실패: NTSTATUS 0x%08X' % (status & 0xFFFFFFFF))


def _job_memory_exceeded(process):
    """Positive cap evidence; Windows does not guarantee delivery of these notifications."""
    if os.name!='nt' or not _JOB:return False
    import ctypes
    from ctypes import wintypes
    with _JOB_GUARD:
        kernel,job,port=_JOB
        message=wintypes.DWORD();key=ctypes.c_size_t();pid=ctypes.c_void_p()
        while kernel.GetQueuedCompletionStatus(port,ctypes.byref(message),ctypes.byref(key),ctypes.byref(pid),0):
            if message.value==9:_JOB_MEMORY_PIDS.add(pid.value)
        exceeded=getattr(process,'pid',None) in _JOB_MEMORY_PIDS
        _JOB_MEMORY_PIDS.discard(getattr(process,'pid',None))
        return exceeded


def _fallback_result(process,output,args=None):
    result=subprocess.CompletedProcess(args if args is not None else process.args,process.returncode,output)
    result.memory_limit_exceeded=_job_memory_exceeded(process)
    return result


def _start_fallback(args, **kwargs):
    # Windows는 첫 명령을 실행하기 전에 Job 제한을 적용한다.
    options = _fallback_process_options()
    if os.name == 'nt':
        kwargs['creationflags'] = kwargs.get('creationflags', 0) | 0x4  # CREATE_SUSPENDED
    process = subprocess.Popen(args, **kwargs, **options)
    if os.name == 'nt':
        try:
            _job_memory_exceeded(process)  # Clear stale evidence before a recycled PID is assigned.
            if not _attach_to_job(process): raise OSError('보조 엔진의 메모리 보호를 설정하지 못했습니다.')
            _resume_fallback(process)
        except Exception as error:
            process.kill(); process.communicate()
            raise OSError('보조 엔진의 메모리 보호를 설정하지 못해 변환을 중단했습니다.') from error
    return process


def _run_fallback(args, timeout=600, **kwargs):
    process = _start_fallback(args, **kwargs)
    try:
        output, _ = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill(); process.communicate()
        raise
    return _fallback_result(process,output,args)


def _fallback_memory_exceeded(result):
    # SIGKILL은 외부 종료일 수도 있다. Windows 메모리 상태 코드 또는 할당 실패 문구만 근거로 삼는다.
    code = result.returncode & 0xFFFFFFFF
    log = (result.stdout or b'').decode('utf-8', errors='replace')
    windows_error=os.name=='nt' and re.search(r'os error (?:1455|8|14)\b',log,re.I)
    return bool(result.returncode and (windows_error or getattr(result,'memory_limit_exceeded',False) or code in (0xC0000017, 0xC000012D) or re.search(
        r'barun_memory_limit_exceeded|memory allocation of \d+ bytes failed|out of memory|cannot allocate memory', log, re.I)))

# One optional warmup per server, after startup; foreground work always wins.
_WARMUP=None
_WARMUP_GUARD=threading.Lock()

def _warmup_allowed():
    """Windows only: AC power and five seconds without input; fail closed."""
    if os.name!='nt':return False
    try:
        import ctypes
        from ctypes import wintypes
        class Power(ctypes.Structure):
            _fields_=[('ac',ctypes.c_ubyte),('flags',ctypes.c_ubyte),('percent',ctypes.c_ubyte),('reserved',ctypes.c_ubyte),('remaining',wintypes.DWORD),('full',wintypes.DWORD)]
        class LastInput(ctypes.Structure):
            _fields_=[('size',wintypes.UINT),('tick',wintypes.DWORD)]
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        user=ctypes.WinDLL('user32',use_last_error=True)
        power=Power();last=LastInput();last.size=ctypes.sizeof(last)
        kernel.GetTickCount.restype=wintypes.DWORD
        return bool(kernel.GetSystemPowerStatus(ctypes.byref(power)) and power.ac==1 and
                    user.GetLastInputInfo(ctypes.byref(last)) and ((kernel.GetTickCount()-last.tick)&0xffffffff)>=5000)
    except Exception:return False

class _ConverterWarmup:
    def __init__(self):
        self.cancelled=threading.Event();self.guard=threading.Lock();self.process=None;self.thread=None

    def cancel(self):
        self.cancelled.set()
        # CreateProcess can be delayed by the OS. Request parsing never waits for it.
        if not self.guard.acquire(False):return
        try:
            process=self.process
            if process is not None:
                try:
                    if process.poll() is None:process.kill()
                except OSError:pass
        finally:self.guard.release()

    def run(self,delay):
        if self.cancelled.wait(delay):return
        # Never queue behind an import/save, or repeat when a laptop is busy/on battery.
        if not _warmup_allowed() or not LOCK.acquire(False):return
        try:
            if self.cancelled.is_set() or not (RUNTIME/CONVERTER).is_file():return
            with tempfile.TemporaryDirectory(prefix='barun_converter_warm_',ignore_cleanup_errors=True) as folder:
                source=Path(folder)/'warm.dxf';target=Path(folder)/'warm.dwg'
                doc=ezdxf.new('R2018',setup=True);doc.layers.new('A-WALL')
                doc.modelspace().add_line((0,0),(1,0),dxfattribs={'layer':'A-WALL'});doc.saveas(source);del doc
                # Publishing uses R2R already. Exercise read/write/readback once, with no user drawing.
                with self.guard:
                    if self.cancelled.is_set():return
                    self.process=subprocess.Popen([str(RUNTIME/CONVERTER),str(source),str(target),'2018'],cwd=folder,
                        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                        creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0)|getattr(subprocess,'IDLE_PRIORITY_CLASS',0))
                    process=self.process
                _attach_to_job(process)
                deadline=time.monotonic()+5
                try:
                    if self.cancelled.is_set():process.kill()
                    while True:
                        try:
                            process.communicate(timeout=0.2);break
                        except subprocess.TimeoutExpired:
                            if self.cancelled.is_set() or time.monotonic()>=deadline or not _warmup_allowed():
                                process.kill();process.communicate(timeout=1);break
                finally:
                    try:
                        if process.poll() is None:
                            process.kill();process.communicate(timeout=1)
                    finally:
                        with self.guard:self.process=None
        except Exception:
            pass  # Optional preparation must never change a save result.
        finally:LOCK.release()

def schedule_warmup(delay=30):
    """Called only by the running server; BARUN_DWG_WARMUP=0 disables it."""
    global _WARMUP
    if os.environ.get('BARUN_DWG_WARMUP','1').strip().lower() in ('0','false','off','no'):return None
    with _WARMUP_GUARD:
        if _WARMUP is None:
            task=_ConverterWarmup();_WARMUP=task
            task.thread=threading.Thread(target=task.run,args=(delay,),name='barun-converter-warm',daemon=True)
            try:task.thread.start()
            except Exception:task.cancelled.set()
        return _WARMUP

def cancel_warmup():
    task=_WARMUP
    if task is not None:task.cancel()

class ConversionFailure(ValueError):
    def __init__(self,message,report=None):
        super().__init__(message)
        self.report=report or {}

def compact_engine_warnings(report):
    """Collapse repeated engine notices so one malformed object cannot create a huge log."""
    raw=[str(item) for item in report.get('warnings',[]) if str(item).strip()]
    counts=Counter(raw)
    report['warningCount']=len(raw)
    report['warnings']=[text+(f' × {count:,}' if count>1 else '') for text,count in counts.most_common(100)]
    if len(counts)>100:report['warnings'].append(f'그 밖의 서로 다른 경고 {len(counts)-100:,}종')
    return report

def _pick_folder_mac(initial):
    """macOS 폴더 선택 창(Finder). 취소하면 빈 문자열 — Windows 창과 같다. 경로는 명령 인자로만 넘긴다(스크립트에 끼워 넣지 않는다)."""
    script = ['-e','on run argv','-e','POSIX path of (choose folder with prompt "저장할 폴더를 선택하세요" default location (POSIX file (item 1 of argv)))','-e','end run']
    result = subprocess.run(['/usr/bin/osascript',*script,str(initial)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=3600)
    if result.returncode:
        if b'-128' in result.stderr: return ''   # 사용자가 취소
        raise ValueError('폴더 선택 창을 열지 못했습니다.')
    folder = result.stdout.decode('utf-8').strip()
    return folder.rstrip('/') or folder

def _process(data):
    if data.get('action') == 'pick-folder':
        initial = Path(str(data.get('folder','')))
        if not initial.is_absolute() or not initial.is_dir(): initial = Path.home()
        if sys.platform == 'darwin': return {'folder':_pick_folder_mac(initial)}
        script = "Add-Type -AssemblyName System.Windows.Forms; $picker = New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description = '저장할 폴더를 선택하세요'; $picker.SelectedPath = $args[0]; if ($picker.ShowDialog() -eq 'OK') { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::Write($picker.SelectedPath) }"
        result = subprocess.run(['powershell.exe','-NoProfile','-STA','-Command',script,str(initial)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        if result.returncode: raise ValueError('폴더 선택 창을 열지 못했습니다.')
        return {'folder':result.stdout.decode('utf-8-sig').strip()}
    if data.get('action')=='status':
        return {'available':(RUNTIME/CONVERTER).is_file(),'engine':ENGINE_VERSION,'versions':['2000','2004','2010','2013','2018']}
    if data.get('action')!='convert':raise ValueError('지원하지 않는 변환 작업')
    name=data.get('name','')
    if not name or any(c in name for c in '/\\:\x00') or Path(name).name!=name:raise ValueError('파일 이름 오류')
    extension=Path(name).suffix.lower()
    direction=data.get('direction')
    expected='.dwg' if direction=='dwg-dxf' else '.dxf' if direction=='dxf-dwg' else None
    if extension!=expected:raise ValueError('선택한 변환 방향과 파일 확장자가 다릅니다.')
    import project;project.network_path(data.get('folder',''))
    destination=Path(data.get('folder',''))
    if not destination.is_absolute():raise ValueError('저장 폴더의 전체 경로를 입력하세요.')
    source_path=data.get('_source_path')
    raw=None if source_path else (data.get('_raw') if '_raw' in data else base64.b64decode(data.get('data',''),validate=True))
    if source_path:
        source_path=Path(source_path).resolve()
        if not source_path.is_file() or source_path.suffix.lower()!=extension:raise ValueError('원본 도면 경로가 올바르지 않습니다.')
        if source_path.stat().st_size<=0 or source_path.stat().st_size>1_000_000_000:raise ValueError('파일은 1 GB 이하만 지원합니다.')
    elif not raw or len(raw)>250_000_000:raise ValueError('파일은 250 MB 이하만 지원합니다.')
    output_ext='.dxf' if direction=='dwg-dxf' else '.dwg'
    defer_dxf_validation=bool(data.get('_defer_dxf_validation')) and direction=='dwg-dxf'
    # The importer reads the converted DXF anyway (and keeps that document). Let
    # it do the per-type count verification instead of the engine re-reading its
    # own output first: one full read of a large drawing instead of two.
    python_verify=defer_dxf_validation and callable(data.get('_reader')) and bool(data.get('_keep_document'))
    executable=RUNTIME/CONVERTER
    version=str(data.get('version','2018'))
    signatures={'2000':b'AC1015','2004':b'AC1018','2010':b'AC1024','2013':b'AC1027','2018':b'AC1032'}
    if version not in signatures:raise ValueError('지원하지 않는 출력 버전입니다.')
    if not executable.is_file():raise ValueError('내장 변환 엔진 파일이 없습니다. 설치 파일을 복구하세요.')
    timings={}
    prep_started=time.monotonic()
    cancel_warmup()
    with LOCK, tempfile.TemporaryDirectory(prefix='barun_convert_') as temp, contextlib.ExitStack() as cleanup:
        source=source_path or Path(temp)/('input'+extension)
        if raw is not None:source.write_bytes(raw)
        target=Path(temp)/('output'+output_ext)
        timings['engine_prepare']=round((time.monotonic()-prep_started)*1000,3)
        before=None;xclips=0;ole_removed=0;jogged_fallbacks=0
        if extension=='.dxf':
            dxf_prepare_started=time.perf_counter()
            if output_ext=='.dwg' and version in LEGACY_CODEPAGE_VERSIONS and dxf_has_non_ascii_text(raw if raw is not None else source):
                raise ValueError(legacy_text_message(version))
            try:source_doc=ezdxf.readfile(source)
            except Exception:raise ValueError('DXF 구조를 읽을 수 없습니다.')
            before=len(source_doc.modelspace())
            if output_ext=='.dwg':
                # 내장 엔진이 DXF 를 읽을 때 XCLIP 역행렬을 버린다(bake_xclip_matrices 설명). 원본은 두고 임시 사본에 옮겨 적어 넘긴다.
                try:xclips=bake_xclip_doc(source_doc)
                except Exception:xclips=None
                # 내장 엔진(ACadSharp 3.8.0)은 DXF 의 OLE2FRAME 이진 데이터를 읽지 못해 비워 두고, DWG 를 쓰다가
                # 'Value cannot be null (buffer)' 로 도면 전체 저장을 멈춘다(온천8구역 계획안: OLE 9개). 빼고 쓰고 개수를 알린다.
                ole_removed=strip_ole_frames(source_doc)
                if ole_removed:before=len(source_doc.modelspace())   # 뺀 OLE 를 'DWG 에 못 옮긴 객체'로 두 번 세지 않는다
                from dimension_compat import lower_jogged_dimensions
                jogged_fallbacks=lower_jogged_dimensions(source_doc)
                # A21: 이 수정 전 바른 CAD 가 저장한 DXF 는 SEQEND 주인이 모형 공간이라 내장 엔진이 'Seqend' 로 멈춘다. 사본에서 바로잡는다.
                from exchange import _own_seqends
                seqends=_own_seqends(source_doc)
                if xclips or ole_removed or jogged_fallbacks or seqends:
                    baked=Path(temp)/('input-dwg'+extension);source_doc.saveas(baked);source=baked
            del source_doc
            timings['engine_dxf_prepare']=round((time.perf_counter()-dxf_prepare_started)*1000,3)
        else:
            with source.open('rb') as stream:header=stream.read(4)
            if header!=b'AC10':raise ValueError('DWG 파일 헤더가 올바르지 않습니다.')
        # 기본 엔진(ACadSharp)이 객체를 빠뜨려 검증에서 떨어지면 acadrust 보조 엔진으로 다시 변환한다.
        # 보조 엔진을 기본 엔진과 함께 미리 돌려 두면 떨어졌을 때 그만큼(19만 객체 도면 8초) 덜 기다린다.
        # 기본 엔진이 성공하면 바로 끝내고 버린다. 어떤 경로로 나가도 프로세스가 남지 않게 cleanup 에 건다.
        fallback=runtime_paths.bundled_runtime('acadrust-runtime')/('barun-dwg2dxf'+runtime_paths.EXE)
        fallback_target=Path(temp)/'verified-fallback.dxf'
        early=None
        def stop_early():
            nonlocal early
            if early is None:return
            try:
                if early.poll() is None:early.kill()
                early.communicate(timeout=30)
                _job_memory_exceeded(early)
            except Exception:pass
            early=None
        cleanup.callback(stop_early)
        if extension=='.dwg' and output_ext=='.dxf' and fallback.is_file() and not data.get('_no_parallel_fallback'):
            try:
                early_started=time.monotonic()
                # 미리 돌리는 보조 엔진은 낮은 우선순위로: 기본 엔진(3 GB 넘게 쓰기도 한다)과 CPU 를 다투지 않게.
                early=_start_fallback([str(fallback),'-v0','--as','r'+version,'-o',str(fallback_target),str(source)],cwd=temp,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0)|getattr(subprocess,'BELOW_NORMAL_PRIORITY_CLASS',0))
                if os.name!='nt':
                    # 2026-10-30 맥: creationflags 는 Windows 에서만 먹어 보조 엔진이 기본 엔진과 같은 우선순위로 돌았다. 시작 뒤 낮춘다(preexec_fn 없이).
                    with contextlib.suppress(OSError,AttributeError):os.setpriority(os.PRIO_PROCESS,early.pid,10)
            except OSError:early=None
        try:
            process_started=time.monotonic()
            command=[str(executable),str(source),str(target),version]+(['--defer-verify'] if python_verify else [])
            # The importer builds plain model-space lines straight from a binary file
            # the engine writes instead of putting them in the DXF (converter/LineSplit.cs).
            split_path=Path(temp)/'lines.bin' if python_verify and data.get('_split_lines') and extension=='.dwg' else None
            split_args=['--split-lines',str(split_path),'--split-min',str(int(data.get('_split_min',20000)))] if split_path else []
            # AutoCAD dynamic block definitions and reference values (converter/DynBlocks.cs).
            dyn_path=Path(temp)/'dyn-blocks.json' if python_verify and data.get('_dyn_blocks') and extension=='.dwg' else None
            run=lambda args:subprocess.run(args,cwd=temp,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=600,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            result=run(command+split_args+(['--dyn-blocks',str(dyn_path)] if dyn_path else []))
            if dyn_path and result.returncode==2:
                # An older bundled engine without the option.
                dyn_path=None;result=run(command+split_args)
            if split_path and result.returncode==2:
                # An older bundled engine without the option.
                split_path=None;result=run(command)
            if python_verify and result.returncode==2:
                # An older bundled engine without the option: fall back to its own verification.
                python_verify=False
                result=run(command[:4])
            timings['process_start']=round((time.monotonic()-process_started)*1000,3)
        except subprocess.TimeoutExpired:raise ValueError('변환 시간이 10분를 초과했습니다. 원본은 유지됩니다.')
        engine_output=result.stdout.decode('utf-8',errors='replace').strip()
        fallback_used=False;primary_document=None;primary_candidate=None;partial=None;primary_pending=None;early_done=None;not_drawn=None;prepared_regions=None;restorable_regions=0
        primary_ok=result.returncode==0 and target.is_file() and target.stat().st_size>=100
        def split_count(primary_report):
            return int(primary_report.get('splitLines') or 0) if split_path else 0
        def read_primary(primary_report):
            started=time.monotonic()
            try:
                if split_count(primary_report) and not split_path.is_file():raise FileNotFoundError('split lines')
                document=data['_reader'](target);error_type=None
            except Exception as error:document=None;error_type=type(error).__name__
            timings['dxf_verify_read']=round((time.monotonic()-started)*1000,3)
            if document is not None and primary_report.get('acisRegions'):
                from exchange import restore_acis_regions
                restore_acis_regions(document,primary_report['acisRegions'],prepared_regions)
            wanted=Counter(primary_report['expectedOutputTypes']) if primary_report.get('expectedOutputTypes') is not None else expected_dxf_types(primary_report.get('inputTypes'))
            actual=Counter(e.dxftype() for e in document.modelspace()) if document is not None else None
            if actual is not None and split_count(primary_report):
                # Split entities are counted per DXF type (an engine before BLN2 split lines only).
                actual.update(primary_report.get('splitTypes') or {'LINE':split_count(primary_report)})
            missing,extra=count_difference(wanted,actual,primary_report.get('invalidTypes')) if actual is not None else ({},{})
            return document,wanted,actual,missing,extra,error_type
        def primary_candidate_from(primary_report,document,wanted,actual,missing,extra):
            if actual is None or not wanted:return None
            return {'engine':'primary','document':document,'report':primary_report,'missing':missing,'extra':extra}
        if primary_ok and python_verify:
            try:primary_report=json.loads(engine_output[engine_output.index('{'):])
            except Exception:raise ValueError('변환 결과 보고서를 읽을 수 없습니다.')
            remaining=Counter(primary_report['expectedOutputTypes']) if primary_report.get('expectedOutputTypes') is not None else expected_dxf_types(primary_report.get('inputTypes'))
            unwritable=sorted(set(remaining)&SECONDARY_FIRST_TYPES)
            if primary_report.get('acisRegions'):
                from exchange import prepare_acis_regions
                prepared_regions=prepare_acis_regions(primary_report['acisRegions'])
                restorable_regions=sum(record['ownerBlock'].casefold()=='*model_space' for record,_ in prepared_regions[0])
                # Keep the existing secondary-first path for unsupported ACIS:
                # do not read a huge primary DXF only to discard it afterwards.
                if restorable_regions>=remaining['REGION']:unwritable=[kind for kind in unwritable if kind!='REGION']
            limit=data.get('_preservation_limit')
            if unwritable and set(unwritable)<=NOT_DRAWN_TYPES and limit and early is not None:
                # Only undrawn types are missing. When the secondary engine's complete DXF is
                # too large to become the preservation layer anyway (exchange keeps sources up
                # to `limit`), reading it (90 s on an 846k-object plan) buys nothing: draw from
                # the primary reading, split entities included, and say what is not kept.
                try:
                    output,_=early.communicate(timeout=max(1,600-(time.monotonic()-early_started)))
                    early_done=_fallback_result(early,output);early=None
                except subprocess.TimeoutExpired:early_done=None
                if early_done and not early_done.returncode and fallback_target.is_file() and fallback_target.stat().st_size>limit:
                    not_drawn={kind:count-(restorable_regions if kind=='REGION' else 0) for kind,count in remaining.items() if kind in unwritable}
            if unwritable and not not_drawn and extension=='.dwg' and fallback.is_file():
                primary_pending=primary_report;primary_ok=False
                engine_output=json.dumps({**primary_report,'failed':True,'message':'Entity types not writable by this engine: '+', '.join(unwritable),'verification':{'code':'PRIMARY_UNWRITABLE_TYPES','types':unwritable}})
        if primary_ok and python_verify:
            primary_document,expected,actual,missing,extra,read_error=read_primary(primary_report)
            if not_drawn and actual is not None and not extra and missing==not_drawn:
                missing={};primary_report['notDrawn']=not_drawn
            elif not_drawn:not_drawn=None
            if actual is None or not expected or missing or extra:
                # Same rule as the engine's own check: any lost or extra entity sends
                # the drawing to the secondary engine, whose output is verified too.
                verification={'code':'PRIMARY_ENTITY_COUNT_MISMATCH','missingTypes':missing,'extraTypes':extra} if actual is not None else {'code':'PRIMARY_DXF_READ_FAILED','exceptionType':read_error}
                engine_output=json.dumps({**primary_report,'failed':True,'message':'Entity count changed during output verification:','verification':verification})
                # Keep the reading: when the secondary engine does no better, the importer
                # opens it and names what is missing instead of refusing the whole drawing.
                primary_candidate=primary_candidate_from(primary_report,primary_document,expected,actual,missing,extra)
                primary_ok=False;primary_document=None
        if not primary_ok:
            try:diagnostic=json.loads(engine_output[engine_output.index('{'):])
            except Exception:diagnostic={'engine_version':ENGINE_VERSION,'route':'acadsharp','timings_ms':timings}
            diagnostic.setdefault('timings_ms',{}).update(timings)
            # ACadSharp can reject otherwise readable DWGs while parsing a single
            # unsupported value (for example an Int16 overflow).  The previous
            # path only tried acadrust after an entity-count verification error,
            # so parser failures escaped as a large internal JSON message.
            report=diagnostic;failure=None;fallback_candidate=None
            if extension=='.dxf':
                # DXF → DWG 에는 보조 엔진이 없다. 엔진이 쓴 DWG 를 다시 읽어 객체 수가 달라졌으면 결과를 버린다.
                changed=str(diagnostic.get('message','')).startswith('Entity count changed')
                failure=('내장 DWG 엔진이 이 도면을 DWG로 옮기지 못했습니다.'+(' 옮긴 DWG를 다시 읽어 보니 객체 수가 원본과 달라 결과를 버렸습니다.' if changed else ''),
                         {'code':'DWG_WRITE_COUNT_MISMATCH','before':diagnostic.get('before'),'after':diagnostic.get('after')} if changed else {'code':'DWG_WRITE_FAILED'},None)
            elif not fallback.is_file():
                failure=('기본 DWG 엔진이 이 도면을 읽지 못했습니다. 보조 엔진을 사용할 수 없어 변환을 중단했습니다.',None,None)
            else:
                try:
                    fallback_started=time.monotonic()
                    if early is not None or early_done is not None:
                        # 미리 돌려 둔 보조 엔진을 기다린다(대개 이미 끝나 있다). 전체 한도는 처음 시작한 때부터 10분이다.
                        if early_done is None:
                            output,_=early.communicate(timeout=max(1,600-(time.monotonic()-early_started)))
                            early_done=_fallback_result(early,output);early=None
                        alternate=early_done
                        if (alternate.returncode or not fallback_target.is_file()) and not _fallback_memory_exceeded(alternate):
                            # 미리 돌린 실행이 (메모리·디스크 부족 등으로) 실패했으면 기본 엔진이 끝난 지금 한 번 더 혼자 돌려 본다.
                            try:fallback_target.unlink()
                            except OSError:pass
                            alternate=_run_fallback([str(fallback),'-v0','--as','r'+version,'-o',str(fallback_target),str(source)],cwd=temp,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=max(1,600-(time.monotonic()-early_started)),creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                    else:
                        alternate=_run_fallback([str(fallback),'-v0','--as','r'+version,'-o',str(fallback_target),str(source)],cwd=temp,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=600,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                    timings['fallback_convert']=round((time.monotonic()-fallback_started)*1000,3)
                    fallback_log=alternate.stdout.decode('utf-8',errors='replace')
                    if alternate.returncode or not fallback_target.is_file():
                        failure=(FALLBACK_MEMORY_WARNING if _fallback_memory_exceeded(alternate) else '두 DWG 엔진 모두 이 도면을 변환하지 못했습니다. 원본 CAD에서 다른 이름으로 저장한 사본을 확인해 주세요.',None,None)
                except subprocess.TimeoutExpired:failure=('보조 엔진 변환 시간이 10분을 초과했습니다.',None,None)
                except OSError:failure=('보조 엔진을 메모리 보호 안에서 실행하지 못해 변환을 중단했습니다.',{'code':'FALLBACK_RESOURCE_SETUP_FAILED'},None)
                # 가져오기(exchange.dwg_to_dxf)는 읽기 함수를 넘겨 이 검증에서 읽은 도면을 그대로 이어 쓴다.
                # 예전에는 여기서 한 번(25초), 가져오기에서 또 한 번(35초) 같은 DXF 를 통째로 읽었다.
                reader=data.get('_reader') if callable(data.get('_reader')) else ezdxf.readfile
                def read_fallback():
                    try:return reader(fallback_target),None
                    # Only stable type/code information belongs in the public diagnostic;
                    # exception text can include drawing text and private file paths.
                    except Exception as error:return None,('보조 엔진의 변환 결과를 검증하지 못했습니다.',{'code':'FALLBACK_DXF_READ_FAILED','exceptionType':type(error).__name__},error)
                verified=None;expected=expected_dxf_types(report.get('inputTypes'))
                if failure is None:
                    fallback_verify_started=time.monotonic()
                    # 2026-10-30 주통(19만 객체): 기본 엔진 결과가 블록 안 REGION 몇 개를 놓쳐 보조 결과를 15초 들여 통째로 읽고는
                    # 결국 기본 결과를 열었다. 가져오기(python_verify)는 개수만 빨리 세어 비교하고, 보조 결과를 고를 때만 통째로 읽는다.
                    actual=fast_modelspace_types(fallback_target) if python_verify and expected else None
                    if actual is not None and not any(count_difference(expected,actual,report.get('invalidTypes'))):actual=None   # 다 맞으면 어차피 이걸 연다
                    if actual is None:
                        verified,failure=read_fallback()
                        if failure is None:actual=Counter(e.dxftype() for e in verified.modelspace())
                if failure is None:
                    timings['fallback_verify']=round((time.monotonic()-fallback_verify_started)*1000,3)
                    missing,extra=count_difference(expected,actual,report.get('invalidTypes'))
                    if not expected and not actual and source.stat().st_size>200_000 and not any(len(block) for block in verified.blocks):
                        # The primary engine could not read the drawing (so there are no counts to
                        # check) and the secondary one produced no objects anywhere: a 226 MB plan
                        # opened as a blank sheet without a word. Say so instead.
                        failure=('두 DWG 엔진 모두 이 도면의 내용을 읽지 못했습니다(보조 엔진 결과에 객체가 하나도 없습니다). 원본 CAD에서 RECOVER 후 다른 이름으로 저장한 사본으로 다시 열어 주세요.',{'code':'FALLBACK_EMPTY_RESULT'},None)
                    elif expected and (missing or extra):
                        verification={'code':'FALLBACK_ENTITY_COUNT_MISMATCH','missingTypes':missing,'extraTypes':extra}
                        fallback_candidate={'engine':'fallback','document':verified,'missing':verification['missingTypes'],'extra':verification['extraTypes']}
                        failure=('보조 엔진의 객체 수 검증을 통과하지 못했습니다.',verification,None)
            if failure is not None:
                # Neither engine carried every object. Converting to a file stays strict;
                # the importer (python_verify) opens the reading that lost the fewest
                # objects and reports exactly which ones (a drawing with two WIPEOUTs
                # the engines cannot write used to refuse to open at all).
                if primary_pending is not None:
                    # The secondary engine did not carry everything either: now read the
                    # primary output and open whichever reading lost less.
                    primary_candidate=primary_candidate_from(primary_pending,*read_primary(primary_pending)[:5])
                options=[c for c in (primary_candidate,fallback_candidate) if c] if python_verify else []
                if not options:
                    message,verification,error=failure
                    if verification:diagnostic['verification']=verification
                    raise ConversionFailure(message,diagnostic) from error
                partial=min(options,key=conversion_loss)
                if partial['engine']=='fallback' and verified is None:
                    # 빨리 센 개수로 골랐다: 이제 한 번만 통째로 읽고, 알리는 수는 실제로 읽은 개수로 다시 센다.
                    verified,read_failure=read_fallback()
                    if verified is not None:
                        partial['document']=verified
                        partial['missing'],partial['extra']=count_difference(expected,Counter(e.dxftype() for e in verified.modelspace()),report.get('invalidTypes'))
                        if not partial['missing'] and not partial['extra']:partial=None
                        # ezdxf 가 읽으며 버리는 객체(ACIS 없는 REGION 등)는 빨리 센 수에만 있다: 실제로 더 잃었으면 기본 결과로 돌아간다.
                        elif primary_candidate is not None and conversion_loss(primary_candidate)<=conversion_loss(partial):partial=primary_candidate
                    elif primary_candidate is not None:partial=primary_candidate
                    else:
                        message,verification,error=read_failure
                        if verification:diagnostic['verification']=verification
                        raise ConversionFailure(message,diagnostic) from error
                if partial is not None and partial['engine']=='primary':
                    report={**partial['report'],'warnings':list(partial['report'].get('warnings',[]))};primary_document=partial['document']
                    if failure[0] == FALLBACK_MEMORY_WARNING: report.setdefault('warnings', []).append(FALLBACK_MEMORY_WARNING)
            if partial is None or partial['engine']=='fallback':
                if report.get('after') is not None:report['primaryAfter']=report['after']
                report['after']=len(verified.modelspace());report['fallbackLog']=fallback_log
                report.setdefault('warnings',[]).insert(0,
                    '기본 엔진이 도면을 완전히 처리하지 못해 보조 엔진으로 재변환했습니다. '
                    +('객체 유형별 수 검증을 통과했습니다.' if expected and partial is None else '변환 파일 구조를 검증했습니다.')
                    +' 원본 표시와 비교하세요.')
                fallback_used=True;target=fallback_target
            if partial is not None:
                report['incomplete']={'engine':partial['engine'],'missingTypes':partial['missing'],'extraTypes':partial['extra']}
        else:
            stop_early()      # 기본 엔진이 성공했다: 미리 돌린 보조 엔진은 끝내고 버린다
            try:report=json.loads(engine_output[engine_output.index('{'):])
            except Exception:raise ValueError('변환 결과 보고서를 읽을 수 없습니다.')
            if not_drawn:report['notDrawn']=not_drawn
        report.setdefault('engine_version',ENGINE_VERSION)
        report.setdefault('route','acadsharp')
        split_data=None
        if primary_document is not None:
            report['after']=len(primary_document.modelspace())+split_count(report)
            if split_count(report):split_data=split_path.read_bytes()
        report.setdefault('timings_ms',{}).update(timings)
        engine_total=report['timings_ms'].get('csharp_total')
        if isinstance(engine_total,(int,float)):
            # Includes process startup/teardown and report IO, not just CLR startup.
            report['timings_ms']['engine_process_overhead']=round(max(0,timings.get('process_start',0)-engine_total),3)
        report=compact_engine_warnings(report)
        # ACIS source bytes belong only to the import, never to public logs.
        report.pop('acisRegions',None)
        if fallback_used:
            report.pop('decomposedTypes',None);report.pop('unresolvedDecompositions',None)
        warnings=['고급 객체·외부참조·폰트는 원본과 비교 확인하세요.']
        if xclips is None:warnings.append(XCLIP_BAKE_FAILED)
        if ole_removed:warnings.append(OLE_REMOVED_MESSAGE.format(count=ole_removed))
        if jogged_fallbacks:warnings.append(JOGGED_FALLBACK_MESSAGE.format(count=jogged_fallbacks))
        if report.get('notDrawn'):
            warnings.insert(0,'경계를 읽지 못한 객체 '+type_counts_text(report['notDrawn'])+'는 도면이 커서 원본 보존 계층에도 담지 못했습니다. '
                            '다른 이름으로 저장하면 이 객체는 빠집니다. 원본 파일은 그대로입니다.')
        invalid_inserts=(report.get('invalidTypes') or {}).get('Insert',0)
        if invalid_inserts:
            warnings.append(f'원본에 블록 정의가 없는 블록 참조 {invalid_inserts:,}개는 원본 CAD에서도 보이지 않아 제외했습니다.')
        if partial is not None:
            notice='두 변환 엔진 모두 이 도면의 일부 객체를 옮기지 못해, 나머지 도면을 열었습니다.'
            if partial['missing']:notice+=' 빠진 객체: '+type_counts_text(partial['missing'])+'.'
            if partial['extra']:notice+=' 원본 목록에 없던 객체: '+type_counts_text(partial['extra'])+'.'
            warnings.insert(0,notice+' 해당 부분은 원본과 비교하세요.')
        if report.get('warnings'):
            warnings.append(f"엔진 주의사항 {report['warningCount']}건: "+' / '.join(report['warnings'][:5]))
        if output_ext=='.dxf':
            if not defer_dxf_validation:
                try:ezdxf.readfile(target)
                except Exception:raise ValueError('변환된 DXF의 구조 검증에 실패했습니다.')
        else:
            with target.open('rb') as stream:header=stream.read(len(signatures[version]))
            if not header.startswith(signatures[version]):
                raise ValueError('출력 DWG 버전 검증에 실패했습니다.')
        destination.mkdir(parents=True,exist_ok=True)
        content=target.read_bytes();stem=Path(name).stem
        # 감사 6: 결과 폴더 안 임시 파일에 다 쓰고(fsync) 이름을 붙인다 — 도중에 꺼지거나 디스크가 차도 반쯤 쓴 결과가 정상 이름으로 남지 않는다.
        # os.link 는 같은 이름이 있으면 실패해 덮어쓰지 않는다. 하드 링크를 못 쓰는 폴더(FAT·일부 공유)는 다 쓴 임시 파일의 이름을 바꾼다(검토 B1:
        # 최종 이름에 바로 쓰지 않음). Windows rename 은 같은 이름이 있으면 실패하고, 맥은 덮어쓰므로 먼저 확인한다(짧은 경합만 남음).
        fd,staged=tempfile.mkstemp(prefix='.barun-convert-',suffix=output_ext,dir=destination)
        try:
            with os.fdopen(fd,'wb') as handle:handle.write(content);handle.flush();os.fsync(handle.fileno())
            for index in range(10000):
                output=destination/(stem+(f'_{index}' if index else '')+output_ext)
                try:os.link(staged,output);break
                except FileExistsError:continue
                except OSError:
                    try:
                        if os.name!='nt' and output.exists():continue
                        os.rename(staged,output);break
                    except FileExistsError:continue
            else:raise ValueError('같은 이름의 결과가 너무 많습니다.')
        finally:
            with contextlib.suppress(OSError):os.unlink(staged)
        keep=({'_document':verified} if fallback_used and data.get('_keep_document') else {'_document':primary_document} if primary_document is not None else {})
        if split_data is not None and not fallback_used:keep['_split_lines']=split_data
        if dyn_path is not None and not fallback_used and dyn_path.is_file():
            try:keep['_dyn_blocks']=json.loads(dyn_path.read_text(encoding='utf-8'))
            except (OSError,ValueError):pass    # 동적 블록 정보가 없어도 도면은 그대로 연다
        return {**keep,'path':str(output),'bytes':len(content),'warnings':warnings,'oleRemoved':ole_removed,'engineWarnings':report.get('warnings',[]),'warningCount':report.get('warningCount',len(report.get('warnings',[]))),'before':report.get('before'),'after':report.get('after'),'engine':'acadrust 0.6.4' if fallback_used else ENGINE_VERSION,'engine_version':'acadrust 0.6.4' if fallback_used else report.get('engine_version'),'primary_engine_version':report.get('engine_version'),'route':'acadrust-fallback' if fallback_used else report.get('route'),'timings_ms':report.get('timings_ms',{}),'deferred_validation':defer_dxf_validation,'fallbackLog':report.get('fallbackLog'),'primaryAfter':report.get('primaryAfter'),'incomplete':report.get('incomplete'),'decomposedTypes':report.get('decomposedTypes'),'unresolvedDecompositions':report.get('unresolvedDecompositions'),'notDrawn':report.get('notDrawn'),'sourceEntities':before,'xclipsBaked':xclips,'joggedFallbacks':jogged_fallbacks}


LOG_KEEP=int(os.environ.get('BARUN_CONVERSION_LOG_KEEP','200') or 200)
LOG_MAX_BYTES=int(os.environ.get('BARUN_CONVERSION_LOG_MAX_BYTES',str(20*1024*1024)) or 20*1024*1024)

def rotate_logs(logdir,keep=None,max_bytes=None):
    """S9: conversion-logs 를 최신 keep 개·합계 max_bytes 이하로 유지한다(예전에는 무제한으로 쌓였다)."""
    keep=LOG_KEEP if keep is None else keep;max_bytes=LOG_MAX_BYTES if max_bytes is None else max_bytes
    removed=0
    try:
        items=sorted(Path(logdir).glob('*.json'),key=lambda p:p.stat().st_mtime,reverse=True)
        total=0
        for index,item in enumerate(items):
            total+=item.stat().st_size
            if index>=keep or total>max_bytes:
                try:item.unlink();removed+=1
                except OSError:pass
    except OSError:pass
    return removed

def process(data):
    if data.get('action')!='convert':return _process(data)
    started=time.monotonic();document=None;split=None;dyn=None
    job={'id':uuid.uuid4().hex,'time':datetime.datetime.now().astimezone().isoformat(),'name':data.get('name'),'direction':data.get('direction'),'version':data.get('version','2018'),'folder':data.get('folder')}
    try:
        result=_process(data)
        document=result.pop('_document',None)      # 읽어 둔 ezdxf 도면은 기록(JSON)에 넣지 않고 부른 쪽에만 돌려준다
        split=result.pop('_split_lines',None)
        dyn=result.pop('_dyn_blocks',None)
        job.update(status='completed',result=result.copy())
    except Exception as error:
        detail=str(error) or type(error).__name__
        if '10분' in detail:code,hint='TIMEOUT','처리 시간을 초과했습니다. 불필요한 객체를 정리한 사본으로 재시도하세요.'
        elif isinstance(error,PermissionError):code,hint='ACCESS_DENIED','저장 폴더의 쓰기 권한과 파일 잠금을 확인하세요.'
        elif '250 MB' in detail:code,hint='FILE_TOO_LARGE','현재 한 파일당 250 MB까지 지원합니다.'
        elif '헤더' in detail or 'DXF 구조' in detail:code,hint='INVALID_DRAWING','도면 형식을 읽지 못했습니다. 원본 CAD에서 열고 다른 이름으로 저장한 사본을 확인하세요.'
        elif '엔진 파일' in detail:code,hint='ENGINE_MISSING','변환 엔진이 누락되었습니다. 설치 복구가 필요합니다.'
        elif '2010 이상' in detail:code,hint='LEGACY_VERSION_TEXT','한글 등 영문 밖의 글자가 있는 도면은 DWG 2010 이상으로 변환하세요. 다른 파일은 그대로 변환됩니다.'
        else:code,hint='CONVERSION_FAILED','상세 로그와 원본을 함께 확인해야 합니다. 지원하지 않는 객체 또는 도면 구조 문제일 수 있습니다.'
        diagnostic=getattr(error,'report',{})
        result={'failed':True,'code':code,'message':detail,'hint':hint,'engine_version':diagnostic.get('engine_version',ENGINE_VERSION),'route':diagnostic.get('route','acadsharp'),'timings_ms':diagnostic.get('timings_ms',{})}
        if diagnostic.get('verification'):result['verification']=diagnostic['verification']
        # A21: 엔진이 낸 원래 문장(예: 'Entity not implemented : ...Seqend')은 화면에는 안 보이고 변환 기록에만 남긴다.
        engine_message=str(diagnostic.get('message') or '')[:500]
        job.update(status='failed',diagnostic={**result,**({'engineMessage':engine_message} if engine_message and engine_message!=detail else {})})
    job['seconds']=round(time.monotonic()-started,2)
    result['seconds']=job['seconds']
    logdir=Path(os.environ.get('LOCALAPPDATA',str(Path.home())))/'BarunCAD'/'conversion-logs'
    try:
        logdir.mkdir(parents=True,exist_ok=True)
        path=logdir/(job['id']+'.json')
        path.write_text(json.dumps(job,ensure_ascii=False,indent=2),encoding='utf-8')
        result['logPath']=str(path)
        rotate_logs(logdir)
    except OSError as error:result['logWarning']='진단 로그 저장 실패: '+str(error)
    if document is not None:result['_document']=document
    if document is not None and split is not None:result['_split_lines']=split
    if document is not None and dyn is not None:result['_dyn_blocks']=dyn
    return result

# 도면 저장(DWG): 화면이 만든 DXF 를 내장 엔진으로 DWG 로 바꾼다. '도면 변환' 창과 같은 엔진·같은 검증을 쓴다.
DWG_SAVE_VERSIONS=('2018','2013','2010','2004','2000')
LEGACY_CODEPAGE_VERSIONS=('2004','2000')   # 글자를 유니코드가 아니라 코드 페이지로 담는 DWG 버전
XCLIP_BAKE_FAILED='잘라 보이기(XCLIP) 경계를 DWG용으로 옮겨 적지 못했습니다. 클립한 뒤 옮긴 블록은 DWG에서 보이는 범위가 다를 수 있으니 확인하세요.'
# 영문 밖의 글자: 날것 바이트(UTF-8·코드 페이지), 옛 DXF 의 \U+XXXX(0080 이상)·\M+ 다중바이트 표기
NON_ASCII_TEXT=re.compile(rb'[\x80-\xff]|\\U\+(?:00[89A-Fa-f][0-9A-Fa-f]|0[1-9A-Fa-f][0-9A-Fa-f]{2}|[1-9A-Fa-f][0-9A-Fa-f]{3})|\\M\+[0-9A-Fa-f]{5}')

def dxf_has_non_ascii_text(source):
    """DXF(바이트 또는 경로)에 영문 밖의 글자가 있는가. 큰 파일은 겹치게 나눠 읽는다."""
    if isinstance(source,(bytes,bytearray,memoryview)):return NON_ASCII_TEXT.search(bytes(source)) is not None
    tail=b''
    with open(source,'rb') as stream:
        while chunk:=stream.read(8<<20):
            if NON_ASCII_TEXT.search(tail+chunk):return True
            tail=chunk[-16:]
    return False

def legacy_text_message(version):
    return ('DWG '+str(version)+' 형식에는 내장 엔진이 한글 등 영문 밖의 글자를 담지 못합니다(글자가 ?로 바뀌고 한글 이름 레이어가 사라집니다). '
            'DWG 2010 이상을 고르세요.')

def dwg_save_failure_message(result):
    """변환 실패 결과를 저장하는 사람이 읽을 한 문장으로 바꾼다(내부 JSON·경로는 넣지 않는다)."""
    code=result.get('code');detail=str(result.get('message') or '').strip()
    if code=='TIMEOUT':reason='변환 시간이 10분을 넘었습니다.'
    elif code=='ENGINE_MISSING':reason='내장 DWG 변환 엔진 파일이 없습니다. 바른 CAD 설치 파일로 복구하세요.'
    elif code=='INVALID_DRAWING':reason='저장용 DXF를 변환 엔진이 읽지 못했습니다.'
    elif detail and any('가'<=ch<='힣' for ch in detail) and '{' not in detail:reason=detail[:200]
    else:reason='내장 DWG 엔진이 이 도면을 DWG로 옮기지 못했습니다.'
    return 'DWG로 저장하지 못했습니다. '+reason+' 도면은 그대로 열려 있습니다. 저장 창에서 DXF를 고르면 저장할 수 있습니다.'

JOGGED_FALLBACK_MESSAGE='꺾인 반지름 치수 {count:,}개를 반지름 치수·꺾인 표시 블록·바른 CAD 좌표 XData로 보존했습니다. AutoCAD에서 치수를 다시 생성하면 꺾인 표시가 바뀔 수 있습니다. 원본 치수 형식은 DXF로도 보관하세요.'

OLE_REMOVED_MESSAGE='붙여 넣은 OLE 객체(엑셀 표·그림 등) {count:,}개는 내장 엔진이 DWG로 옮기지 못해 빼고 저장했습니다. 빠짐없이 보관하려면 DXF로도 저장하세요.'

def strip_ole_frames(doc):
    """모델·배치 공간과 블록 정의 속 OLE2FRAME 을 지우고 지운 수를 돌려준다(DWG 쓰기 전 임시 사본에만)."""
    removed=0
    for block in doc.blocks:
        for entity in list(block.query('OLE2FRAME')):block.delete_entity(entity);removed+=1
    return removed

def bake_xclip_matrices(path):
    """ACadSharp 3.8.0 의 DXF 읽기는 SPATIAL_FILTER(XCLIP)의 '클립할 때의 블록 역행렬'을 버리고 단위행렬로 둔다.
    클립한 뒤 옮긴 블록(실도면 1370-2: 15곳, 25만 mm 어긋남)은 DWG 에서 엉뚱한 부분이 보이게 된다.
    경계점에 그 행렬을 미리 곱해 블록 좌표로 적고 행렬을 단위행렬로 바꾼다(ezdxf XClip·바른 CAD 가져오기와 같은 해석:
    블록 좌표 경계 = 역행렬 × 경계점). 반전 클립·다른 평면 클립은 건드리지 않는다. path 의 DXF 를 제자리에서 고치고 고친 수를 돌려준다."""
    doc=ezdxf.readfile(path)
    fixed=bake_xclip_doc(doc)
    if fixed:doc.saveas(path)
    return fixed

def bake_xclip_doc(doc):
    """bake_xclip_matrices 의 본체: 읽어 둔 ezdxf 문서에서 고친다(저장은 부른 쪽). 고친 수를 돌려준다."""
    from ezdxf.math import Matrix44,Vec2,Vec3
    from ezdxf.xclip import XClip
    identity=Matrix44();fixed=0
    for entity in [insert for block in doc.blocks for insert in block.query('INSERT')]:   # 모델·배치 공간과 블록 정의 속 INSERT 모두
        if not entity.has_extension_dict:continue
        acad=entity.get_extension_dict().dictionary.get('ACAD_FILTER')
        spatial=acad.get('SPATIAL') if acad is not None else None
        if spatial is None or spatial.dxftype()!='SPATIAL_FILTER':continue
        matrix=spatial.inverse_insert_matrix
        if all(abs(a-b)<=1e-12 for a,b in zip(list(matrix),list(identity))):continue
        if XClip(entity).is_inverted_clip or not Vec3(spatial.dxf.extrusion).isclose((0,0,1)) or not Vec3(spatial.dxf.origin).isclose((0,0,0)):continue
        boundary=Vec2.list(spatial.boundary_vertices)
        if len(boundary)<2:continue
        values=list(matrix);axis_aligned=abs(values[1])<=1e-12 and abs(values[4])<=1e-12
        if len(boundary)==2 and not axis_aligned:
            (x0,y0),(x1,y1)=boundary;boundary=[Vec2(x0,y0),Vec2(x1,y0),Vec2(x1,y1),Vec2(x0,y1)]   # 돌아간 사각형은 네 점 다각형으로
        spatial.set_boundary_vertices([Vec2(v) for v in matrix.transform_vertices(boundary)])
        spatial.set_inverse_insert_matrix(identity)
        fixed+=1
    return fixed

def dxf_to_dwg(content,version='2018',progress=None):
    """DXF 바이트를 DWG 바이트로 바꾼다. 입력 DXF·출력 DWG·엔진 작업 폴더는 모두 임시 폴더에만 두고
    성공·실패 어느 쪽이든 지운다. 저장 위치는 여기서 정하지 않는다(부른 쪽이 셸이 허락한 경로에만 쓴다)."""
    if callable(progress):
        try: progress({'phase':'convert','completed':False})
        except Exception: pass
    version=str(version or '2018')
    if version not in DWG_SAVE_VERSIONS:raise ValueError('지원하지 않는 DWG 버전입니다. '+', '.join(DWG_SAVE_VERSIONS)+' 중에서 고르세요.')
    if not content:raise ValueError('DWG로 바꿀 도면 내용이 비어 있습니다.')
    if version in LEGACY_CODEPAGE_VERSIONS and dxf_has_non_ascii_text(content):
        # 2000·2004 DWG 는 글자를 코드 페이지로 쓴다. 내장 엔진은 ANSI_1252 로만 써서 한글이 ? 로 바뀌고
        # 한글 이름 레이어가 사라진다(엔진 재읽기·acadrust 모두 확인). 깨진 파일을 만드느니 저장하지 않는다.
        raise ValueError('DWG로 저장하지 못했습니다. '+legacy_text_message(version)+' 도면은 그대로 열려 있습니다.')
    started=time.perf_counter();timings={}
    with tempfile.TemporaryDirectory(prefix='barun_dwgsave_',ignore_cleanup_errors=True) as temp:
        write_started=time.perf_counter()
        source=Path(temp)/'save.dxf';source.write_bytes(content)
        timings['dwg_temp_write']=round((time.perf_counter()-write_started)*1000,3)
        folder=Path(temp)/'out';folder.mkdir()
        result=process({'action':'convert','name':source.name,'direction':'dxf-dwg','version':version,'folder':str(folder),'_source_path':str(source)})
        if result.get('failed'):raise ValueError(dwg_save_failure_message(result))
        read_started=time.perf_counter()
        dwg=Path(result['path']).read_bytes()
        timings['dwg_read_bytes']=round((time.perf_counter()-read_started)*1000,3)
    timings.update(result.get('timings_ms') or {})
    timings['dwg_save_total']=round((time.perf_counter()-started)*1000,3)
    source_count=result.get('sourceEntities');after=result.get('after')
    xclips=result.get('xclipsBaked',0)   # XCLIP 역행렬은 변환기(_process)가 옮겨 적는다
    warnings=([] if xclips is not None else [XCLIP_BAKE_FAILED])+([OLE_REMOVED_MESSAGE.format(count=result['oleRemoved'])] if result.get('oleRemoved') else [])
    if result.get('joggedFallbacks'):warnings.append(JOGGED_FALLBACK_MESSAGE.format(count=result['joggedFallbacks']))
    lost=source_count-after if isinstance(source_count,int) and isinstance(after,int) and after<source_count else 0
    if lost:
        warnings.append(f'DWG에 옮기지 못한 객체가 {lost:,}개 있습니다(DXF {source_count:,}개 → DWG {after:,}개). 빠짐없이 보관하려면 DXF로도 저장하세요.')
    report={'version':version,'engine':result.get('engine'),'entities':after,'sourceEntities':source_count,'lost':lost,'xclipsBaked':xclips,'joggedFallbacks':result.get('joggedFallbacks',0),'warnings':warnings,'engineWarningCount':result.get('warningCount',0),'timings_ms':timings}
    if callable(progress):
        try: progress({'phase':'convert','completed':True,'bytes':len(dwg)})
        except Exception: pass
    return dwg,report
