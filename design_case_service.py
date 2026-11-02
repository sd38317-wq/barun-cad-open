"""Local, source-preserving design case retrieval and reference geometry."""
import io, json, math, re, sqlite3, uuid, os
from pathlib import Path
from zipfile import ZipFile
from contextlib import closing
from PIL import Image
from runtime_paths import local_data_root

def catalog_root():
    """Resolve the catalogue without depending on one inherited Windows variable.

    Packaged backends can be started by Explorer, the updater, or a recovery
    process.  Some of those launch paths did not inherit LOCALAPPDATA, which
    made an existing catalogue look deleted.  Only return a configured folder
    after its read-only database has actually been verified.
    """
    local=Path(__file__).resolve().parent/'data'/'aihub-71465'/'full-catalog'
    candidates=[]
    override=os.environ.get('BARUN_DESIGN_CATALOG')
    if override:candidates.append(Path(override))
    candidates.append(local)
    app_data=[]
    if os.environ.get('LOCALAPPDATA'):app_data.append(Path(os.environ['LOCALAPPDATA']))
    # 맥은 ~/Library/Application Support(엔진을 단독으로 띄워 LOCALAPPDATA 가 없을 때도 같은 곳).
    for home_local in (local_data_root(),Path.home()/'AppData'/'Local'):
        if home_local not in app_data:app_data.append(home_local)
    for base in app_data:
        config=base/'BarunCAD'/'design-cases.json'
        try:
            configured=json.loads(config.read_text(encoding='utf-8-sig')).get('catalogPath')
            if configured:candidates.append(Path(configured))
        except (OSError,ValueError,TypeError):
            continue
    for candidate in candidates:
        try:
            resolved=candidate.expanduser().resolve()
            if (resolved/'catalog.sqlite').is_file():return resolved
        except (OSError,RuntimeError):
            continue
    return local

ROOT=catalog_root()

def active_root():
    """Re-read the small location file if the catalogue appeared after startup."""
    global ROOT
    if not (ROOT/'catalog.sqlite').is_file():ROOT=catalog_root()
    return ROOT

def connection():
    root=active_root()
    if not (root/'catalog.sqlite').is_file(): raise ValueError('설계 사례 자료 연결이 끊겼습니다. 사례 자료 폴더를 다시 연결하세요.')
    db=sqlite3.connect(f'file:{(root/"catalog.sqlite").as_posix()}?mode=ro',uri=True)
    db.row_factory=sqlite3.Row
    return db

def row_for(key):
    with closing(connection()) as db: row=db.execute('SELECT * FROM drawings WHERE id=?',(key,)).fetchone()
    if row is None: raise ValueError('설계 사례를 찾을 수 없습니다.')
    return dict(row)

def raw_for(row):
    root=active_root();p=(root/row['label_path']).resolve()
    if not p.is_relative_to(root.resolve()/'original-labels'): raise ValueError('자료 경로 오류')
    return json.loads(p.read_text(encoding='utf-8'))

def image_size(row):
    with closing(connection()) as db:
        cols={r[1] for r in db.execute('PRAGMA table_info(case_images)')}
        if 'width' in cols:
            actual=db.execute('SELECT width,height FROM case_images WHERE id=?',(row['id'],)).fetchone()
            if actual and actual[0] and actual[1]:return list(actual)
    return [row['width'],row['height']]

def search(data):
    text=str(data.get('query',''))[:500]
    housing=data.get('housing','')
    if not housing:
        housing=next((v for k,v in [('다세대','ROW'),('연립','ROW'),('아파트','APT'),('단독','DEH'),('주택','DEH')] if k in text),'')
    if housing not in ('','APT','DEH','ROW'): raise ValueError('주택 종류를 확인하세요.')
    task=data.get('task','SPA')
    if task not in ('SPA','STR','OBJ','OCR'): raise ValueError('자료 종류를 확인하세요.')
    desired={}
    for term,cls in [('침실|방','공간_침실'),('욕실|화장실','공간_화장실')]:
        m=re.search(r'(?:'+term+r')\s*(\d+)\s*개?',text)
        if m: desired[cls]=int(m[1])
    limit=min(100,max(1,int(data.get('limit',30))))
    offset=max(0,int(data.get('offset',0)))
    missing_use=next((word for word in ('상가','병원','학교','사무실','업무시설') if word in text),None)
    if missing_use:
        return {'results':[],'total':0,'hasMore':False,'interpreted':{'housing':housing,'task':task},'unverifiedConstraints':[f'{missing_use} 원본은 현재 자료에 없습니다.'],'notice':f'{missing_use} 자료는 아직 없습니다. 현재 아파트·단독주택·다세대/연립주택을 검색할 수 있습니다.'}
    number=re.search(r'(?<![\d.])(\d{2,3})(?:\s*(?:㎡|m²|m2|형|타입|제곱미터))?(?![\d.])',text)
    number=number.group(1) if number and not desired else None
    prefer_kitchen_living='주방' in text and '거실' in text and bool(re.search('가깝|인접|연결',text))
    unsupported=[]
    if re.search(r'\d+\s*(평|㎡|m2|m²|제곱)',text):unsupported.append('실제 면적은 축척 미확정으로 평가하지 않았습니다.')
    if '연결' in text:unsupported.append('문을 통한 연결은 미확정이며 공간 근접만 참고합니다.')
    with closing(connection()) as db:
        rows=db.execute('SELECT * FROM drawings WHERE task=? AND drawing_type=? AND (?="" OR housing=?)',(task,'FP',housing,housing)).fetchall()
        patterns=dict(db.execute('SELECT id,payload FROM patterns').fetchall()) if prefer_kitchen_living else {}
        numeric_hits={}
        if number:
            has_text=db.execute("SELECT name FROM sqlite_master WHERE name='case_text'").fetchone()
            if has_text:
                token=re.compile(r'(?<![\d.])'+re.escape(number)+r'(?:\.\d+)?(?:\s*[A-Za-z㎡²]*)?(?!\d)')
                for t in db.execute('SELECT id,text FROM case_text WHERE text LIKE ?',('%'+number+'%',)):
                    hits=[line for line in t['text'].splitlines() if token.search(line)]
                    if hits:numeric_hits[t['id'].replace('_OCR_','_'+task+'_')]=hits[:3]
            unsupported.append(f'{number}은 원본 문자 일치 검색입니다. 전용면적·공급면적·타입 여부는 도면에서 확인하세요.')
            if not numeric_hits:
                unsupported.append(f'{number}에 일치하는 면적·타입 표기가 없어 면적 미확인 참고 목록을 표시합니다. {number}㎡ 일치 결과가 아닙니다.')
    candidates=[]
    for r in rows:
        if number and numeric_hits and r['id'] not in numeric_hits:continue
        r=dict(r); counts=json.loads(r['class_counts'])
        penalty=sum(abs(counts.get(k,0)-v) for k,v in desired.items())
        spatial=json.loads(patterns[r['id']]) if r['id'] in patterns else None
        near=any(e['classes']==['공간_거실','공간_주방'] for e in spatial['nearbyCandidates']) if spatial else False
        candidates.append({'id':r['id'],'housing':r['housing'],'task':r['task'],
            'counts':counts,'issues':r['issue_count'],'countDistance':penalty,'matchedText':numeric_hits.get(r['id'],[]),'areaUnverified':bool(number and not numeric_hits),
            'preferredProximityObserved':near if prefer_kitchen_living else None,
            'explanation': ('시트 전체 방 개수 차이 '+str(penalty) if desired else '선택한 주택·평면도 자료')+(' · 주방·거실 근접 후보 '+('있음' if near else '없음') if prefer_kitchen_living else ''),
            'scope':'sheet, dwelling boundary unverified'})
    candidates.sort(key=lambda r:(r['countDistance'],prefer_kitchen_living and not r['preferredProximityObserved'],r['issues']>0,r['issues'],r['id']))
    return {'results':candidates[offset:offset+limit],'total':len(candidates),'offset':offset,'hasMore':offset+limit<len(candidates),'interpreted':{'housing':housing,'task':task,'desiredSheetCounts':desired},
            'unverifiedConstraints':unsupported,
            'notice':'원본 사례 추천입니다. 한 시트에 여러 세대가 있을 수 있어 세대별 조건 충족은 별도 확인해야 합니다. '+' '.join(unsupported)}

def detail(key):
    row=row_for(key);raw=raw_for(row)
    with closing(connection()) as db:
        has=db.execute("SELECT name FROM sqlite_master WHERE name='patterns'").fetchone()
        pattern=db.execute('SELECT payload FROM patterns WHERE id=?',(key,)).fetchone() if has else None
    return {'id':key,'counts':json.loads(row['class_counts']),'issues':row['issue_count'],
            'imageSize':image_size(row), 'pattern':json.loads(pattern[0]) if pattern else None,
            'annotations':raw,'scaleMmPerPixel':calibration(key).get('mmPerPixel'),'calibration':calibration(key),'sourceUnchanged':True}

def calibration(key):
    p=active_root()/'verified-scales.json'
    if not p.exists():return {}
    records=json.loads(p.read_text(encoding='utf8'))
    if key in records:return records[key]
    with closing(connection()) as db:
        if db.execute("SELECT name FROM sqlite_master WHERE name='case_images'").fetchone():
            for r in db.execute('SELECT id FROM case_images WHERE sha256=(SELECT sha256 FROM case_images WHERE id=?)',(key,)):
                if r[0] in records:return records[r[0]]
    return {}

def planning_context(query):
    """Compact evidence supplied to the actual AI planning request, including execution mode."""
    import drawing_knowledge
    import classified_drawing_service
    try:
        normalized_references=classified_drawing_service.planning_context(query)
    except (OSError,ValueError,sqlite3.Error) as error:
        normalized_references={'references':[],'unavailable':str(error)}
    found=search({'query':query,'task':'SPA','limit':3})
    refs=[]
    for candidate in found['results']:
        d=detail(candidate['id']);pattern=d['pattern'] or {}
        shares={}
        for node in pattern.get('nodes',[]):
            name=node['class'];shares[name]=shares.get(name,0)+(node.get('shareOfAnnotatedArea') or 0)
        refs.append({'sourceId':candidate['id'],'housing':candidate['housing'],
            'observedSheetCounts':candidate['counts'],'countDistance':candidate['countDistance'],
            'relativeAnnotatedAreaByClass':{k:round(v,4) for k,v in shares.items()},
            'nearbyClassPairs':list({tuple(e['classes']) for e in pattern.get('nearbyCandidates',[])})[:30],
            'qualityIssues':candidate['issues'],'scope':'sheet, not verified single dwelling',
            'physicalDimensionsKnown':bool(d.get('scaleMmPerPixel')),
            'evidenceReadiness':drawing_knowledge.case_readiness(d)})
    return {'kind':'retrieved_design_evidence','request':found['interpreted'], 'references':refs,
        'judgmentKnowledge':drawing_knowledge.context(),
        'normalizedReferences':normalized_references,
        'unverifiedConstraints':found['unverifiedConstraints'],
        'applicationRules':[
            'Use these original cases as advisory evidence for spatial composition, not mandatory design standards.',
            'User-supplied site, dimensions, room program and verified constraints take precedence.',
            'Do not convert pixel proportions into real area, invent doorway connectivity, or claim legal/structural approval.',
            'Preserve existing drawing and original source layouts unless the user explicitly requests a separate changed alternative.',
            'Explain which source IDs informed the proposal and which requested conditions remain unverified.'
        ]}

def image_bytes(key):
    import parcel_service
    parcel_service.require_verified_login('설계 사례')
    row=row_for(key)
    # Only paths resolved through our catalog are read; no user-supplied filesystem path.
    with ZipFile(row['image_zip']) as z: raw=z.read(row['image_member'])
    with Image.open(io.BytesIO(raw)) as im:
        im.thumbnail((1800,1800)); out=io.BytesIO();im.convert('RGB').save(out,format='JPEG',quality=88)
    return out.getvalue()

def reference_document(key,scale):
    if type(scale) not in (int,float) or not math.isfinite(scale) or not 0<scale<=10000:
        raise ValueError('확인한 축척(mm/픽셀)이 필요합니다.')
    row=row_for(key);data=raw_for(row);info=data['images'][0]
    info={**info,'width':image_size(row)[0],'height':image_size(row)[1]}
    cats={c['id']:c['name'] for c in data['categories']};entities=[]
    for a in data['annotations']:
        name=cats.get(a['category_id'],'미분류')
        if name=='background':continue
        label=a.get('attributes',{}).get('OCR')
        if name=='OCR' and label:
            x,y,w,h=a['bbox']
            entities.append({'id':str(uuid.uuid4()),'type':'text','layer':'default','position':{'x':x*scale,'y':(info['height']-y-h)*scale},'height':h*scale,'text':str(label),'rotation':-float(a.get('attributes',{}).get('rotation',0)),'name':'문자','referenceOnly':True,'sourceCase':key,'sourceAnnotation':a['id']})
            continue
        polys=a.get('segmentation',[])
        if polys and isinstance(polys[0],(int,float)):polys=[polys]
        if not polys:
            x,y,w,h=a['bbox'];polys=[[x,y,x+w,y,x+w,y+h,x,y+h]]
        for poly in polys:
            if len(poly)<6 or len(poly)%2:continue
            entities.append({'id':str(uuid.uuid4()),'type':'polyline','closed':True,'layer':'default',
                'points':[{'x':x*scale,'y':(info['height']-y)*scale} for x,y in zip(poly[::2],poly[1::2])],
                'name':name,'referenceOnly':True,'sourceCase':key,'sourceAnnotation':a['id']})
    return {'version':2,'units':'mm','layers':[{'id':'default','name':'설계 사례 참고','color':'#79d4ff','visible':True}],
            'entities':entities,'blocks':[],'metadata':{'sourceCase':key,'mmPerPixel':scale,'sourceUnchanged':True,'referenceOnly':True}}

def connect(path):
    """사례 자료 폴더(full-catalog, catalog.sqlite 가 있는 곳)를 사용자 설정에 적고 바로 연결한다(2026-09-21)."""
    global ROOT
    root=Path(str(path or '').strip().strip('"')).expanduser()
    if not (root/'catalog.sqlite').is_file(): raise ValueError('그 폴더에 catalog.sqlite 가 없습니다. 설계 사례 자료 폴더(예: …\aihub-71465\full-catalog)를 지정하세요.')
    base=local_data_root()/'BarunCAD'
    base.mkdir(parents=True,exist_ok=True)
    (base/'design-cases.json').write_text(json.dumps({'catalogPath':str(root.resolve())},ensure_ascii=False),encoding='utf-8')
    ROOT=root.resolve()
    return {'connected':True,'path':str(ROOT)}

def status():
    root=active_root()
    return {'connected':(root/'catalog.sqlite').is_file(),'path':str(root)}

def process(data):
    action=data.get('action','search')
    if action=='connect':return connect(data.get('path'))
    if action=='status':return status()
    # U-M5: 로그인 검사보다 자료 연결 검사를 먼저 한다. 그래야 로그인 전에도 [폴더 연결] 화면에 닿을 수 있다.
    if not status()['connected']:raise ValueError('설계 사례 자료 연결이 끊겼습니다. 사례 자료 폴더를 다시 연결하세요.')
    import parcel_service
    parcel_service.require_verified_login('설계 사례')
    if action in ('classified_search','classified_detail','classified_summary'):
        import classified_drawing_service as classified
        if action=='classified_search':return classified.search(data)
        if action=='classified_detail':return classified.detail(data)
        return classified.summary()
    if action=='evaluate':
        import drawing_knowledge
        return drawing_knowledge.evaluate(data.get('facts',{}))
    if action=='knowledge':
        import drawing_knowledge
        return drawing_knowledge.observed_rules(data.get('classes'))
    if action=='search':return search(data)
    if action=='detail':return detail(data.get('id'))
    if action=='reference':return {'document':reference_document(data.get('id'),data.get('mmPerPixel'))}
    if action=='editable':
        if data.get('mmPerPixel') is None and calibration(data.get('id')).get('mmPerPixel'):
            data={**data,'mmPerPixel':calibration(data['id'])['mmPerPixel']}
        verified=data.get('mmPerPixel') is not None
        key=data.get('id');keys=[key]
        with closing(connection()) as db:
            if db.execute("SELECT name FROM sqlite_master WHERE name='case_images'").fetchone():
                keys=[r[0] for r in db.execute('SELECT id FROM case_images WHERE sha256=(SELECT sha256 FROM case_images WHERE id=?) ORDER BY id',(key,))] or [key]
        doc=reference_document(key,data['mmPerPixel'] if verified else 10)
        seen={(e['name'],json.dumps(e.get('points',e.get('position')),sort_keys=True),e.get('text')) for e in doc['entities']}
        for other in keys:
            if other==key:continue
            related=reference_document(other,data['mmPerPixel'] if verified else 10)
            for e in related['entities']:
                signature=(e['name'],json.dumps(e.get('points',e.get('position')),sort_keys=True),e.get('text'))
                if signature not in seen:doc['entities'].append(e);seen.add(signature)
        layers={}
        for entity in doc['entities']:
            name=entity.get('name','미분류')
            if name not in layers:
                group='벽체' if '벽체' in name else '문' if '출입문' in name else '창' if '창호' in name else '공간' if name.startswith('공간_') else '기구' if name.startswith('객체_') else '문자' if name=='문자' else '기타'
                colors={'벽체':'#eeeeee','문':'#ffc66d','창':'#70dfff','공간':'#85d9a5','기구':'#d2a8ff','문자':'#fff28a','기타':'#aaaaaa'}
                clean=name.replace('공간_','').replace('객체_','').replace('구조_','')
                layers[name]={'id':str(uuid.uuid4()),'name':group+'_'+clean+('' if verified else ' · 축척 미확인'),'color':colors[group],'lineweight':0.35 if group=='벽체' else 0.18,'linetype':'CONTINUOUS','visible':True,'locked':False}
            entity.update(layer=layers[name]['id'],referenceOnly=False,scaleVerified=verified)
        doc['layers']=list(layers.values())
        doc['metadata'].update(referenceOnly=False,scaleVerified=verified,sourceCases=keys,conversionScope='all annotations linked by identical original image SHA256',mmPerPixel=data.get('mmPerPixel'),temporaryDrawingUnitsPerPixel=None if verified else 10)
        return {'document':doc,'objectCount':len(doc['entities']),'scaleVerified':verified,'sourceCases':keys,'notice':'동일 원본 이미지의 벽·공간·기구·문자 좌표를 합쳤습니다. 이미지에만 있는 선과 문자는 포함되지 않습니다.'}
    raise ValueError('지원하지 않는 사례 작업입니다.')
