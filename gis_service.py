import io,base64,zipfile,uuid,math
import shapefile
import korea_crs

ZIP_LIMIT=100_000_000
# 중앙 디렉터리의 신고 크기는 위조할 수 있으므로, 실제로 읽은 바이트를 세어 확장자별 상한으로 막는다.
PART_LIMITS={'.shp':100_000_000,'.shx':20_000_000,'.dbf':100_000_000,'.prj':1_000_000}

def process(data):
    raw=base64.b64decode(data['data'],validate=True)
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        if sum(i.file_size for i in z.infolist())>ZIP_LIMIT:raise ValueError('SHP 압축 해제 한도 초과')
        names=z.namelist();shps=[n for n in names if n.lower().endswith('.shp')]
        if len(shps)!=1:raise ValueError('ZIP에는 SHP 데이터셋 하나만 넣으세요.')
        stem=shps[0][:-4];budget=ZIP_LIMIT
        def get(ext):
            nonlocal budget
            name=next((n for n in names if n.lower()==(stem+ext).lower()),None)
            if name is None:return None
            cap=min(PART_LIMITS.get(ext,ZIP_LIMIT),budget)
            with z.open(name) as f:buf=f.read(cap+1)
            if len(buf)>cap:raise ValueError('SHP 압축 해제 한도 초과')
            budget-=len(buf);return io.BytesIO(buf)
        prj=get('.prj');source=data.get('sourceCRS') or (prj.getvalue().decode('utf-8-sig') if prj else '')
        if not source:raise ValueError('PRJ 또는 원본 EPSG 좌표계가 필요합니다.')
        target=korea_crs.parse(data.get('targetCRS') or source)
        if target.is_geographic:raise ValueError('출력 좌표계는 미터 단위 투영 좌표계로 지정하세요.')
        transform=korea_crs.transformer(source,target)
        unit=target.unit
        ox,oy=float(data.get('originX',0)),float(data.get('originY',0))
        reader=shapefile.Reader(shp=get('.shp'),shx=get('.shx'),dbf=get('.dbf'),encoding=data.get('encoding') or 'utf-8')
        fields=[f[0] for f in reader.fields[1:]];entities=[];skipped={}
        for sr in reader.iterShapeRecords():
            s=sr.shape;attrs=dict(zip(fields,sr.record));ps=[]
            for x,y,*_ in s.points:
                xx,yy=transform.transform(x,y);xx=(xx*unit-ox)*1000;yy=(yy*unit-oy)*1000
                if not math.isfinite(xx+yy):raise ValueError('좌표 변환 실패')
                ps.append({'x':xx,'y':yy})
            typ=s.shapeType%10
            if typ==1:
                entities.append({'id':str(uuid.uuid4()),'type':'point','position':ps[0],'layer':'default','attributes':attrs})
            elif typ in (3,5):
                starts=[*s.parts,len(ps)]
                for a,b in zip(starts,starts[1:]):
                    points=ps[a:b]
                    if typ==5 and points[0]==points[-1]:points=points[:-1]
                    entities.append({'id':str(uuid.uuid4()),'type':'polyline','points':points,'closed':typ==5,'layer':'default','attributes':attrs})
            else:skipped[str(s.shapeType)]=skipped.get(str(s.shapeType),0)+1
            if len(entities)>100000:raise ValueError('SHP 객체 한도 초과')
        return {'entities':entities,'report':{'sourceCRS':source,'targetCRS':target.name,'originMetres':[ox,oy],'units':'mm','skipped':skipped,'note':'다중 링은 개별 폐합선으로 입력합니다. 3D 높이는 XY 평면으로 투영합니다.'}}
