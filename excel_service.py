"""Local XLSX exchange; no Office, Node, or Codex installation is required."""
from pathlib import Path
import base64,io,zipfile,xml.etree.ElementTree as ET,re,ast,operator,math
NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
LIMIT=100_000_000

def formula_values(sheet, formulas):
    """Calculate local arithmetic/cell references without executing supplied code.

    Other Excel functions are retained for recalculation by the receiving app.
    Never cache a guessed zero for an unsupported expression.
    """
    cache={};active=set()
    def cell(name):
        if name in cache:return cache[name]
        if name in active or len(active)>64:raise ValueError('순환 또는 과도한 수식 참조')
        if name not in formulas:
            value=sheet[name].value
            if value is None:return 0
            if isinstance(value,(int,float)) and not isinstance(value,bool):return value
            raise ValueError('숫자가 아닌 셀 참조')
        active.add(name)
        try:
            expression=formulas[name][1:].replace('$','')
            if len(expression)>2000:raise ValueError('수식 길이 초과')
            node=ast.parse(expression,mode='eval')
            def number(n):
                if isinstance(n,ast.Expression):return number(n.body)
                if isinstance(n,ast.Constant) and type(n.value) in (int,float):return n.value
                if isinstance(n,ast.Name) and re.fullmatch(r'[A-Z]{1,3}[1-9][0-9]{0,4}',n.id):return cell(n.id)
                if isinstance(n,ast.UnaryOp) and isinstance(n.op,(ast.UAdd,ast.USub)):
                    return number(n.operand)*(1 if isinstance(n.op,ast.UAdd) else -1)
                ops={ast.Add:operator.add,ast.Sub:operator.sub,ast.Mult:operator.mul,ast.Div:operator.truediv}
                if isinstance(n,ast.BinOp) and type(n.op) in ops:return ops[type(n.op)](number(n.left),number(n.right))
                raise ValueError('스프레드시트에서 재계산할 수식')
            value=number(node)
            if not math.isfinite(value):raise ValueError('수식 결과 범위 초과')
            cache[name]=value;return value
        finally:active.remove(name)
    for name in formulas:
        try:cell(name)
        except (ValueError,SyntaxError,ZeroDivisionError,OverflowError,RecursionError):pass
    return cache

REL_NS='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PKG_REL_NS='http://schemas.openxmlformats.org/package/2006/relationships'

def sheet_titles(z,read):
    """워크북에 적힌 시트 이름(탭 이름) → 시트 파일 경로. 워크북 순서는 '__order__' 에 둔다. 없거나 깨졌으면 빈 사전."""
    out={}
    try:
        if 'xl/workbook.xml' not in z.namelist() or 'xl/_rels/workbook.xml.rels' not in z.namelist():return out
        targets={}
        for rel in ET.fromstring(read('xl/_rels/workbook.xml.rels')).findall('{%s}Relationship'%PKG_REL_NS):
            target=rel.attrib.get('Target','').lstrip('/')
            targets[rel.attrib.get('Id')]=target if target.startswith('xl/') else 'xl/'+target
        order=[]
        for sheet in ET.fromstring(read('xl/workbook.xml')).findall('.//s:sheets/s:sheet',NS):
            path=targets.get(sheet.attrib.get('{%s}id'%REL_NS))
            if path:out[path]=sheet.attrib.get('name','');order.append(path)
        out['__order__']=order
    except (ET.ParseError,KeyError):return {}
    return out

def read_xlsx(data):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        if sum(i.file_size for i in z.infolist())>LIMIT:raise ValueError('압축 해제 크기가 너무 큽니다.')
        budget=LIMIT
        def read(name):
            # 중앙 디렉터리의 file_size는 위조할 수 있으므로, 조각내어 읽으며 실제로 푼 바이트로 상한을 강제한다(ZIP 폭탄 방어).
            nonlocal budget
            out=bytearray()
            with z.open(name) as f:
                while True:
                    chunk=f.read(min(budget+1,1<<20))
                    if not chunk:break
                    out+=chunk;budget-=len(chunk)
                    if budget<0:raise ValueError('압축 해제 크기가 너무 큽니다.')
            return bytes(out)
        strings=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            strings=[''.join(n.itertext()) for n in ET.fromstring(read('xl/sharedStrings.xml')).findall('s:si',NS)]
        names=sorted(n for n in z.namelist() if re.fullmatch(r'xl/worksheets/sheet\d+\.xml',n))
        titles=sheet_titles(z,read)
        result=[]
        for name in names:
            rows=[];numbers=[]
            for row in ET.fromstring(read(name)).findall('.//s:sheetData/s:row',NS):
                number=row.attrib.get('r')
                number=int(number) if number and number.isdigit() else (numbers[-1]+1 if numbers else 1)
                cells={}
                for c in row.findall('s:c',NS):
                    col=0
                    for a in re.match('[A-Z]+',c.attrib['r'])[0]:col=col*26+ord(a)-64
                    if col>100:raise ValueError('최대 100열만 지원합니다.')
                    value=c.find('s:v',NS);text=value.text if value is not None else ''
                    typ=c.attrib.get('t')
                    if typ=='s':value=strings[int(text)]
                    elif typ=='inlineStr':
                        inline=c.find('s:is',NS)
                        value=''.join(inline.itertext()) if inline is not None else ''
                    elif typ in ('str','e'):value=text
                    elif text:
                        try:value=float(text);value=int(value) if value.is_integer() else value
                        except ValueError:value=text
                    else:value=''
                    cells[col-1]=value
                if cells:rows.append([cells.get(i,'') for i in range(max(cells)+1)]);numbers.append(number)
                if len(rows)>20000:raise ValueError('최대 20,000행만 지원합니다.')
            # rowNumbers: 빈 행을 건너뛴 rows 의 실제 엑셀 행 번호(1부터). 범위 다시 읽기(데이터 링크)가 쓴다.
            result.append({'name':name,'rows':rows,'rowNumbers':numbers,'title':titles.get(name,'')})
        return {'sheets':result,'rows':result[0]['rows'] if result else [],'sheetOrder':titles.get('__order__',[])}

# ── 데이터 링크(520): 도면 표가 기억한 엑셀 파일·범위를 다시 읽는다. 원본 시각(stat)만 먼저 보고 바뀐 것만 읽게 한다. ──
LINK_SUFFIXES=('.xlsx','.xlsm')
CELL_RE=re.compile(r'([A-Z]{1,3})([1-9][0-9]{0,6})')

def linked_path(data):
    raw=str(data.get('path','') or '').strip()
    if not raw:raise ValueError('엑셀 파일 경로가 없습니다.')
    if len(raw)>4096 or '\0' in raw:raise ValueError('엑셀 파일 경로가 올바르지 않습니다.')
    path=Path(raw)
    if path.suffix.lower() not in LINK_SUFFIXES:raise ValueError('엑셀 파일(.xlsx·.xlsm)만 연결할 수 있습니다.')
    return path

def stat_xlsx(data):
    """원본 수정 시각(ms 정수)과 크기. 파일이 없으면 오류 대신 exists=False(열 때 알림이 '원본 없음'을 알린다)."""
    path=linked_path(data)
    try:st=path.stat()
    except (FileNotFoundError,NotADirectoryError):return {'path':str(path),'exists':False,'mtime':None,'size':0}
    if not path.is_file():return {'path':str(path),'exists':False,'mtime':None,'size':0}
    return {'path':str(path),'exists':True,'mtime':st.st_mtime_ns//1_000_000,'size':st.st_size}

def column_number(letters):
    n=0
    for ch in letters:n=n*26+ord(ch)-64
    return n

def column_letters(n):
    out=''
    while n:n,rem=divmod(n-1,26);out=chr(65+rem)+out
    return out

def parse_range(text):
    """'시트!A1:D10' · "'시트 이름'!B2:C5" · 'A1:D10' · 'B3' · '시트!' · '' → (시트 이름 또는 None, (r1,c1,r2,c2) 또는 None)."""
    s=str(text or '').strip()
    if not s:return None,None
    sheet=None
    if '!' in s:
        sheet,s=s.rsplit('!',1)
        sheet=sheet.strip()
        if len(sheet)>=2 and sheet[0]==sheet[-1]=="'":sheet=sheet[1:-1].replace("''","'")
        if not sheet:raise ValueError('시트 이름이 비어 있습니다.')
        s=s.strip()
        if not s:return sheet,None
    parts=s.upper().replace('$','').split(':')
    if len(parts)>2:raise ValueError(f'범위 "{text}" 를 읽을 수 없습니다. 예: Sheet1!A1:D10')
    cells=[CELL_RE.fullmatch(p.strip()) for p in parts]
    if not all(cells):
        if sheet is None and len(parts)==1:return str(text).strip(),None   # 셀 주소가 아니면 시트 이름으로 본다
        raise ValueError(f'범위 "{text}" 를 읽을 수 없습니다. 예: Sheet1!A1:D10')
    coords=[(column_number(m[1]),int(m[2])) for m in cells]
    (c1,r1),(c2,r2)=coords[0],coords[-1]
    r1,r2=sorted((r1,r2));c1,c2=sorted((c1,c2))
    if c2>100:raise ValueError('최대 100열만 지원합니다.')
    if r2-r1+1>20000:raise ValueError('최대 20,000행만 지원합니다.')
    return sheet,(r1,c1,r2,c2)

def read_range(data):
    """연결된 파일의 범위를 다시 읽어 표 행으로. 빈 칸은 '', 범위 안 빈 행도 그대로 둔다(표 모양 유지)."""
    path=linked_path(data)
    before=stat_xlsx(data)
    if not before['exists']:raise ValueError(f'연결된 엑셀 파일을 찾을 수 없습니다: {path}')
    if before['size']>LIMIT:raise ValueError('엑셀 파일이 너무 큽니다.')
    book=read_xlsx(path.read_bytes())
    sheet_name,box=parse_range(data.get('range',''))
    sheets=book['sheets']
    if not sheets:raise ValueError('엑셀 파일에 시트가 없습니다.')
    if sheet_name is not None:
        found=[s for s in sheets if s.get('title')==sheet_name] or [s for s in sheets if (s.get('title') or '').lower()==sheet_name.lower()]
        if not found:raise ValueError(f'시트 "{sheet_name}" 이(가) 없습니다. 있는 시트: '+', '.join(s.get('title') or s['name'] for s in sheets))
        sheet=found[0]
    else:
        order=book.get('sheetOrder') or []
        sheet=next((s for p in order for s in sheets if s['name']==p),sheets[0])
    by_number=dict(zip(sheet['rowNumbers'],sheet['rows']))
    if box is None:
        if not by_number:return {'rows':[],'sheet':sheet.get('title',''),'range':'','mtime':before['mtime']}
        r1,r2=min(by_number),max(by_number);c1,c2=1,max(len(r) for r in by_number.values())
    else:r1,c1,r2,c2=box
    rows=[[(by_number.get(r) or [])[c-1] if c-1<len(by_number.get(r) or []) else '' for c in range(c1,c2+1)] for r in range(r1,r2+1)]
    return {'rows':rows,'sheet':sheet.get('title',''),'range':f'{column_letters(c1)}{r1}:{column_letters(c2)}{r2}','mtime':before['mtime']}

def process(data):
    if data['action']=='import':return read_xlsx(base64.b64decode(data['data'],validate=True))
    if data['action']=='stat':return stat_xlsx(data)
    if data['action']=='range':return read_range(data)
    if data['action']!='export':raise ValueError('엑셀 작업 오류')
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter, coordinate_to_tuple
    from openpyxl.workbook.properties import CalcProperties
    rows=data.get('rows')
    if not isinstance(rows,list) or not rows or len(rows)>20000:
        raise ValueError('표 크기 제한: 1~20,000행, 최대 100열')
    if any(not isinstance(row,list) or len(row)>100 for row in rows):
        raise ValueError('표 크기 제한: 최대 100열')
    wb=Workbook();sheet=wb.active;sheet.title='도면표'
    for r,row in enumerate(rows,1):
        for c,value in enumerate(row,1):
            if value is not None and not isinstance(value,(str,int,float,bool)):
                raise ValueError('표 셀에는 문자 또는 숫자만 넣을 수 있습니다.')
            cell=sheet.cell(r,c,value)
            # Ordinary drawing text beginning with '=' is text, not executable formula.
            if isinstance(value,str):cell.data_type='s'
            cell.font=Font(name='Malgun Gothic',size=11,bold=r==1,color='FFFFFF' if r==1 else '25292F')
            cell.number_format='#,##0.00' if isinstance(value,(int,float)) and not isinstance(value,bool) else 'General'
            if r==1:cell.fill=PatternFill('solid',fgColor='25292F')
        sheet.row_dimensions[r].height=22
    for c in range(1,max(map(len,rows))+1):sheet.column_dimensions[get_column_letter(c)].width=22
    formulas={}
    for item in data.get('formulas',[]):
        address=item.get('cell','');formula=item.get('formula','')
        if not re.fullmatch(r'[A-Z]{1,3}[1-9][0-9]{0,4}',address):raise ValueError('수식 셀 주소 오류')
        r,c=coordinate_to_tuple(address)
        if r>20000 or c>100 or not isinstance(formula,str) or not formula.startswith('='):
            raise ValueError('수식 또는 표 범위 오류')
        sheet[address]=formula
        formulas[address]=formula
    sheet.freeze_panes='A2';sheet.sheet_view.showGridLines=False
    wb.calculation=CalcProperties(fullCalcOnLoad=True)
    values=formula_values(sheet,formulas)
    output=io.BytesIO();wb.save(output)
    cached=io.BytesIO()
    with zipfile.ZipFile(output) as original,zipfile.ZipFile(cached,'w',zipfile.ZIP_DEFLATED) as result:
        for item in original.infolist():
            content=original.read(item.filename)
            if item.filename=='xl/worksheets/sheet1.xml':
                xml=ET.fromstring(content)
                for cell in xml.findall('.//s:c',NS):
                    if cell.attrib['r'] in values:
                        value=cell.find('s:v',NS)
                        if value is None:value=ET.SubElement(cell,'{'+NS['s']+'}v')
                        value.text=str(values[cell.attrib['r']])
                content=ET.tostring(xml,encoding='utf-8')
            result.writestr(item,content)
    return {'data':base64.b64encode(cached.getvalue()).decode('ascii'),
            'warnings':['일부 수식은 스프레드시트 프로그램에서 열 때 다시 계산됩니다.'] if len(values)<len(formulas) else []}
