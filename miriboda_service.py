"""Barun CAD adapter to the existing Miriboda land, review, PDF and SMS services."""
import base64
import json
import math
import re
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone
from html import escape
import parcel_service as parcel


ZONE_GROUPS={'도시지역','관리지역','농림지역','자연환경보전지역','주거지역','상업지역','공업지역','녹지지역'}


def land_info(pnu, area, floors=3, config=None):
    if not re.fullmatch(r'\d{19}', str(pnu)): raise ValueError('대지의 필지 번호(PNU)가 없습니다. 주소로 다시 가져오세요.')
    if not math.isfinite(area) or area <= 0: raise ValueError('대지 면적을 확인하세요.')
    config = config or parcel.request(parcel.BASE+'/api/vworld', authenticated=True)[0]
    params={'key':config['key'],'domain':config['domain'],'pnu':pnu,'format':'json','numOfRows':100,'pageNo':1}
    raw,_=parcel.request('https://api.vworld.kr/ned/data/getLandUseAttr?'+urllib.parse.urlencode(params),
        extra_headers={'Referer':'https://'+str(config['domain']).removeprefix('https://').strip('/')+'/'})
    uses=raw.get('landUses') or {}
    if uses.get('resultCode'): raise ValueError('토지이용정보 조회 실패: '+str(uses.get('resultMsg') or uses['resultCode']))
    rows=uses.get('field') or []
    if isinstance(rows,dict): rows=[rows]
    if int(uses.get('totalCount',len(rows)))>len(rows): raise ValueError('토지이용정보가 일부만 조회되었습니다. 다시 조회하세요.')
    zones=[{'code':r.get('prposAreaDstrcCode',''),'name':r.get('prposAreaDstrcCodeNm',''),'relation':r.get('cnflcAtNm',''),'updated':r.get('lastUpdtDt','')} for r in rows]
    names=list(dict.fromkeys(z['name'] for z in zones if z['name'] and z['relation']!='접함'))
    if not names: raise ValueError('이 필지의 용도지역을 조회하지 못했습니다.')
    first=rows[0];address=(first.get('ldCodeNm','')+' '+first.get('mnnmSlno','')).strip()
    req={'kind':'newbuild','zoneNames':names,'address':address,'code':pnu,'totalLotAreaM2':area,'lotAreaM2':area,
         'isHousing':False,'housingType':'','units':'','existingBuildingAreaM2':0,'existingFloorAreaM2':0,
         'existingFloors':str(floors),'addBuildingAreaM2':0,'addFloorAreaM2':0,'totalFloorAreaM2':0,'floors':str(floors),'selected':[]}
    try:
        review,_=parcel.request(parcel.BASE+'/api/public/plan-check',req,authenticated=True)
    except ValueError as error:
        review={'error':str(error)}
    mass=review.get('massing') or {}
    # Read the service's reported limits, rather than duplicating legal rules here.
    limits={}
    for section in review.get('report',{}).get('sections',[]):
        for row in section.get('rows',[]):
            if row.get('label') in ('건폐율','용적률'):
                match=re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*%\s*',str((row.get('value') or {}).get('v','')))
                if match: limits['bcr' if row['label']=='건폐율' else 'far']=float(match[1])
    # 도시지역·녹지지역 같은 상위 구분은 세지 않는다(자연녹지지역과 함께 와도 용도지역은 하나).
    primary=[z for z in zones if z['code'][:3] in ('UQA','UQB','UQC','UQD') and z['relation']!='접함' and z['name'] not in ZONE_GROUPS]
    warnings=[]
    if review.get('error'):warnings.append('미리보다 법규 검토 조회 실패: '+str(review['error'])+' · 토지이용정보만 표시합니다.')
    if len({z['name'] for z in primary})>1:
        warnings.append('복수 용도지역이 조회되었습니다. 미리보다 산정 기준: '+str(mass.get('zoneName','미확인'))+' · 구역별 면적과 지구단위계획은 별도 확인 필요')
    if any('지구단위' in z['name'] for z in zones):
        warnings.append('지구단위계획구역: 세부 결정도서의 건축선·높이·용도·배치 지침은 자동 조회 범위 밖입니다. 토지이음 원문 확인 필요')
    # 주소로 땅을 불러올 때 일조 적용 여부도 같이(2026-10-30 대표: '법규랑 일조검토는 다 불러와야지'). 판정 자체는 AI 설계 엔진(cad_validate_layout)이 건물을 앉혀 잰다.
    north=any(re.search('전용주거|일반주거',z['name']) for z in primary)
    sunlight={'applies':north,'rule':'건축법 시행령 86조① 정북 일조' if north else '정북 일조 사선 대상 아님(전용·일반주거지역 아님)',
              'check':'설계를 그린 뒤 cad_validate_layout 이 AI 설계 엔진으로 층마다 정북 이격을 잽니다'}
    return {'pnu':pnu,'address':address,'areaM2':area,'polygonAreaM2':area,'recordAreaM2':None,'zones':zones,'zoneNames':names,'limits':limits,
            'review':review,'massing':mass,'sunlight':sunlight,'warnings':warnings,'queriedAt':datetime.now(timezone.utc).isoformat(),
            'source':'미리보다 · VWorld 토지이용정보 / 미리보다 신축 검토',
            'eumUrl':'https://www.eum.go.kr/web/ar/lu/luLandDet.jsp?isNoScr=script&mode=search&pnu='+pnu,
            'reviewScope':'미리보다 최대 규모 개략 검토 · 생성 도면의 전체 법규 적합 판정 아님'}


def enrich_drawing(data):
    from site_plan_service import from_drawing
    request=from_drawing(data)
    # from_drawing 이 방금 채운 프로그램 값: 사용자 입력과 섞이기 전에 출처를 기록한다.
    input_sources={}
    def record(value, prefix, source, note):
        for key, item in value.items():
            name=prefix+'.'+key
            if isinstance(item,dict): record(item,name,source,note)
            else: input_sources[name]={'value':item,'source':source,'note':note}
    input_sources['site.parcel']={'value':request['site']['parcel'],'source':'confirmed','note':'도면 대지 경계 · 연속지적도 기반, 측량 확인 아님'}
    record(request['program'],'program','default','대지 입력 기본값')
    ps=request['site']['parcel'];area=abs(sum(a[0]*b[1]-a[1]*b[0] for a,b in zip(ps,ps[1:]+ps[:1])))/2
    program=data.get('program') or {};floors=program.get('floors',3)
    if type(floors)!=int or not 1<=floors<=100: raise ValueError('층수는 1~100으로 입력하세요.')
    info=land_info(request['site']['id'],area,floors)
    mass=info['massing']
    # zoneConfirmed 는 '부산 조례 확인값'일 뿐이다. 부산 밖은 관할 조례 수집값·법 상한으로 산정되므로 수치만 있으면 전국 진행.
    if not mass.get('zoneName') or not mass.get('maxBuildingAreaM2') or not mass.get('maxFloorAreaM2'):
        raise ValueError('미리보다에서 계획 규모를 확정하지 못했습니다. 토지정보 검토 결과를 확인하세요.')
    request['site']['address']=info['address']
    request['zoning']={'zone':mass['zoneName'],'bcr':info['limits'].get('bcr'),'far':info['limits'].get('far')}
    request['program'].update(floors=floors,floors_search=False,target_gfa=round(min(mass['maxFloorAreaM2'],mass['maxBuildingAreaM2']*floors),2))
    record(request['zoning'],'zoning','confirmed','토지정보 조회값 · 관할 기준 확인 필요')
    input_sources['program.floors']={'value':floors,'source':'user' if 'floors' in program else 'default','note':'대지 입력 층수'}
    for key in ('floors_search','target_gfa'):
        input_sources['program.'+key]={'value':request['program'][key],'source':'default','note':'조회 규모와 층수로 계산한 자동 조건'}
    return {'request':request,'landInfo':info,'inputSources':input_sources}


def report_pages(info, plan=None):
    """SVG sheets consumed by Miriboda's own PDF renderer; escape all remote text."""
    import textwrap
    lines=[('title','토지정보 · 법규 검토'),('text',info.get('address','')),('text','조회: '+info.get('queriedAt','')),
           ('text','자료: '+info.get('source','')),('text',info.get('reviewScope',''))]
    lines += [('text',w) for w in info.get('warnings',[])]
    lines += [('text',w) for w in info.get('suggestions',[])]
    lines += [('heading','토지이용정보')]+[('text',f"{z['name']} · {z['relation']} · 갱신 {z['updated']}") for z in info.get('zones',[])]
    if plan:
        lines.append(('heading','생성 배치 검토'))
        lines += [('text',f"{c.get('rule','')} · {'통과' if c.get('ok') else 'NG'} · {c.get('value') if c.get('value') is not None else '—'} / {c.get('limit') if c.get('limit') is not None else '—'}"+(' · 잠정' if c.get('provisional') else '')) for c in plan.get('checks',[])]
    for section in info.get('review',{}).get('report',{}).get('sections',[]):
        lines.append(('heading',section.get('title','')))
        lines += [('text',str(r.get('label',''))+'  '+str((r.get('value') or {}).get('v',''))) for r in section.get('rows',[])]
        if section.get('note'):lines.append(('text',section['note']))
    lines.append(('text',info.get('review',{}).get('disclaimer','')))
    pages=[];parts=[];y=60
    def finish():
        pages.append('<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123" viewBox="0 0 794 1123"><rect width="794" height="1123" fill="white"/><g font-family="sans-serif" fill="#182b38">'+''.join(parts)+f'<text x="50" y="1090" font-size="12">미리보다 · 바른캐드 / {len(pages)+1}</text></g></svg>')
    for kind,line in lines:
        for index,chunk in enumerate(textwrap.wrap(str(line),48) or ['']):
            height=32 if kind in ('title','heading') else 22
            if y+height>1050:finish();parts=[];y=60
            size=25 if kind=='title' else 18 if kind=='heading' else 14
            parts.append(f'<text x="50" y="{y}" font-size="{size}"'+(' font-weight="bold"' if kind!='text' else '')+'>'+escape(chunk)+'</text>');y+=height
    finish();return pages


def pdf(data):
    info=data.get('landInfo') or {}
    if not info.get('review'):raise ValueError('토지·법규 검토를 먼저 조회하세요.')
    pages=report_pages(info,data.get('report'))
    site=data.get('site') or {};report=data.get('report') or {};geometry=report.get('geometry') or {}
    if geometry.get('footprint'):
        pages[0:0]=sunlight_pages(site,report,data.get('sunlightReview'))+shadow_pages(data.get('shadow'),info.get('address',''))
    if site.get('parcel') and geometry.get('footprint'):
        ps=site['parcel'];xs=[p[0] for p in ps];ys=[p[1] for p in ps]
        scale=min(650/max(max(xs)-min(xs),1),750/max(max(ys)-min(ys),1))
        def shape(points,color,fill='none'):
            points=' '.join(f'{70+(p[0]-min(xs))*scale:.2f},{900-(p[1]-min(ys))*scale:.2f}' for p in points)
            return f'<polygon points="{points}" stroke="{color}" fill="{fill}" stroke-width="2"/>'
        drawing=shape(ps,'#9632aa')+shape(geometry['footprint'],'#334d77','#dfe8ef')
        drawing+=''.join(shape(stall['rect'],'#338866') for stall in geometry.get('stalls',[]))
        pages.insert(0,'<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123"><rect width="794" height="1123" fill="white"/><text x="50" y="60" font-family="sans-serif" font-size="24">계획 배치도 · 개략 검토</text><text x="50" y="95" font-family="sans-serif" font-size="16">'+escape(info.get('address',''))+'</text>'+drawing+'<text x="50" y="1060" font-family="sans-serif" font-size="13">대지경계 · 건물 외곽 · 주차 / 상세 평면·실시설계 도면 아님</text></svg>')
    req=urllib.request.Request(parcel.BASE+'/api/sheet-pdf',data=json.dumps({'title':'토지·법규 검토서','pages':pages}).encode(),headers={'Content-Type':'application/json','User-Agent':'BarunCAD/3',**parcel.auth_headers()})   # 계정 연결 토큰도(쿠키만이면 토큰 로그인에서 401)
    renderer='miriboda'
    try:
        with urllib.request.urlopen(req,timeout=90) as response:raw=response.read(30_000_001)
    except urllib.error.HTTPError as e:
        if e.code<500 and not data.get('localOk'):raise ValueError('PDF 생성에 실패했습니다. 미리보다 로그인 상태를 확인하세요. ('+str(e.code)+')') from None
        raw=local_pdf(pages);renderer='cad-fallback'
    except (urllib.error.URLError,TimeoutError):
        raw=local_pdf(pages);renderer='cad-fallback'
    if len(raw)>30_000_000 or not raw.startswith(b'%PDF'):raise ValueError('PDF 응답을 확인할 수 없습니다.')
    return {'data':base64.b64encode(raw).decode(),'filename':'토지_법규검토.pdf','renderer':renderer,**({'dxf':base64.b64encode(pages_dxf(pages)).decode()} if data.get('dxf') else {})}


def sunlight_pages(site,report,review):
    """Draw provider limit geometry verbatim; do not invent legal setbacks."""
    if not review or not isinstance(review.get('sunlight',{}).get('applies'),bool):
        raise ValueError('일조 검토도가 누락되어 PDF를 완료할 수 없습니다.')
    sun=review['sunlight'];limits=review.get('limits',[])
    if sun['applies'] is False:return []
    if not review.get('section'):raise ValueError('일조 단면검토도가 누락되었습니다.')
    # 엔진 재검사(validate)는 평면 일조선을 주지 않는다 — 미리 일조 보고서는 A–A 단면 사선으로 갈음하고 그렇다고 적는다(limitsFrom='section')
    if sun['applies'] and (not sun.get('by_floor') or (any(f['north_setback_from_parcel']>0 for f in sun['by_floor']) and not limits and review.get('limitsFrom')!='section')):
        raise ValueError('일조 한계선 자료가 없습니다.')
    parcel=site['parcel'];xs=[p[0] for p in parcel];ys=[p[1] for p in parcel]
    scale=min(620/max(max(xs)-min(xs),1),470/max(max(ys)-min(ys),1))
    def polygon(ps,color,limit=False):
        pts=' '.join(f'{80+(p[0]-min(xs))*scale:.2f},{610-(p[1]-min(ys))*scale:.2f}' for p in ps)
        style=f'stroke-width="{.05*scale}" stroke-dasharray="{.5*scale},{.25*scale}"' if limit else 'stroke-width="2"'
        tag='polyline' if limit or len(ps)==2 else 'polygon'
        return f'<{tag} points="{pts}" stroke="{color}" fill="none" {style}/>'
    drawing=polygon(parcel,'#a25a91')
    cut=review['section']['cutX'];drawing+=polygon([(cut,min(ys)-1),(cut,max(ys)+1)],'#be8245')
    for e in limits:drawing+=polygon(e['points'],'#ff0000',True)
    floors=report['geometry'].get('floors',[])
    for ps in floors:drawing+=polygon(ps,'#a78021')
    rows=[('정북 일조 제한 적용' if sun['applies'] else '엔진 판정: 비적용 · 적용 근거 확인 필요'),
          '분홍: 대지 / 붉은 점선: 일조선 PL 폭 50mm / 황색: 건물 외곽',
          '방향: EPSG:5187 도북 기준 · 실제 정북 확인 필요']
    if not limits and review.get('limitsFrom')=='section':rows.append('평면 일조선은 엔진 재검사에 없어 A–A 단면 사선으로 봅니다')
    rows += [f"{f['floor']}층 | 높이 {f['top_h']}m | 대지경계 기준 이격 {f['north_setback_from_parcel']}m" for f in sun.get('by_floor',[])]
    rows += [f"{'통과' if c['ok'] else '확인 필요'} · {c['rule']}"+(' (잠정)' if c.get('provisional') else '')+(' — 옥탑을 둘 경우의 자리 시험' if '옥탑' in c['rule'] else '') for c in report.get('checks',[]) if any(t in c['rule'] for t in ('일조','정북','건축가능'))]
    pages=[]
    for start in range(0,max(1,len(rows)),15):
        parts=['<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123">','<text x="50" y="55" font-size="24">정북 일조 검토도'+(' · 계속' if start else '')+'</text>']
        parts.append('<text x="50" y="85" font-size="13">'+escape(site.get('address',''))+' · 주황선 A–A</text>')
        if not start:parts.append(drawing)
        y=665 if not start else 110
        chunk=rows[start:start+15]
        for row in chunk:parts.append(f'<text x="50" y="{y}" font-size="13">'+escape(row)+'</text>');y+=25
        parts.append('<text x="50" y="1090" font-size="12">정북 사선 검토 · 시간대별 일조시간 분석 아님 · 상세 적용 조건 확인 필요</text></svg>');pages.append(''.join(parts))
    pages.extend(sunlight_section_pages(review['section']))
    return pages


def sunlight_section(site,geometry,sun):
    """site-plan.js sunlightSection 과 같은 계산(대지 무게중심 세로 단면 A–A, 층마다 정북 경계까지 가까운·먼 거리) — 미리 일조 보고서(2026-10-30)가 화면 없이 쓴다."""
    if not sun.get('applies'):return None
    ps=site['parcel'];ox,oy=ps[0];area=cx=0.0
    for a,b in zip(ps,ps[1:]+ps[:1]):
        cross=(a[0]-ox)*(b[1]-oy)-(b[0]-ox)*(a[1]-oy);area+=cross;cx+=(a[0]+b[0]-2*ox)*cross
    if not area:raise ValueError('단면 검토용 대지 면적이 없습니다.')
    cut=ox+cx/(3*area)
    def crosses(ring):
        return sorted(a[1]+(cut-a[0])*(b[1]-a[1])/(b[0]-a[0]) for a,b in zip(ring,ring[1:]+ring[:1]) if a[0]<=cut<b[0] or b[0]<=cut<a[0])
    ys=crosses(ps)
    if not ys:raise ValueError('대지를 관통하는 단면선을 만들 수 없습니다.')
    boundary=ys[-1];credit=sun.get('boundary_credit_m') or 0;floors=[];low=0
    for i,ring in enumerate(geometry.get('floors') or []):
        f=next((f for f in sun['by_floor'] if f['floor']==i+1),None)
        if not f:raise ValueError('층별 일조 높이 자료가 없습니다.')
        hits=crosses(ring)
        for j in range(0,len(hits)-1,2):
            near=boundary+credit-hits[j+1];far=boundary+credit-hits[j]
            floors.append({'floor':i+1,'low':low,'high':f['top_h'],'near':near,'far':far,'required':f['north_setback'],'ok':near+.02>=f['north_setback']})
        low=f['top_h']
    return {'cutX':cut,'boundaryY':boundary,'credit':credit,'floors':floors,'height':max([12]+[f['top_h'] for f in sun['by_floor']])+2}


def shadow_pages(shadow,address=''):
    """동지 그림자(3D 실제 그림자 계산) — 이웃 필지별 기준 충족 비율·가장 짧은 일조 시간. 정북 사선 판정과 별개."""
    if not shadow:return []
    rows=[f"동지(12/22) 09~15시 연속 2시간 또는 08~16시 총 4시간 기준 · 계산 칸 {shadow.get('cells',0)}개 중 {round((shadow.get('okRatio') or 0)*100,1)}% 충족 (칸 {shadow.get('cellSizeMm','')}mm)",
          '우리 건물 그림자만 계산 · 주변 기존 건물은 3D 모델에 있을 때만 · 판례 수인한도 참고']
    h=lambda m:f"{m//60}시간 {m%60}분" if m>=60 else f"{m}분"
    counted=sorted((n for n in shadow.get('neighbors') or [] if n.get('cells')),key=lambda n:(n['okRatio'],n['minTotalMin']))   # 기준 미달 필지가 먼저
    away=[n.get('jibun') or '이웃 필지' for n in shadow.get('neighbors') or [] if not n.get('cells')]
    for n in counted:
        rows.append(f"{'기준 미달 · ' if n['okRatio']<1 else ''}{n.get('jibun') or '이웃 필지'} · 충족 {round(n['okRatio']*100,1)}% · 가장 짧은 곳 연속 {h(n['minContinuousMin'])} / 총 {h(n['minTotalMin'])}")
    if away:rows.append(f"그림자 계산 범위 밖(우리 건물 그림자가 닿지 않는 먼 필지) {len(away)}필지")
    for w in shadow.get('worst') or []:rows.append(f"부족한 곳 ({w['x']}, {w['y']}) mm · 연속 {w['continuousMin']}분 / 총 {w['totalMin']}분")
    parts=['<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123"><text x="50" y="55" font-size="24">동지 일조 시간 · 인접 대지</text>',
           '<text x="50" y="85" font-size="13">'+escape(address)+'</text>']
    import textwrap
    y=130
    for row in rows:
        for chunk in textwrap.wrap(row,52):
            if y>1050:break
            parts.append(f'<text x="50" y="{y}" font-size="13">'+escape(chunk)+'</text>');y+=24
        y+=6
    return [''.join(parts)+'<text x="50" y="1090" font-size="12">시간대별 일조 분석 · 건축법 정북 사선과 별개 · 실측·주변 건물 확인 필요</text></svg>']


def sunlight_section_pages(section):
    H=section['height'];width=max([15]+[f['far'] for f in section['floors']])+2
    k=min(570/width,560/H)
    parts=['<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123"><text x="50" y="55" font-size="24">A–A 정북 일조 단면검토</text>']
    def shape(ps,color,limit=False):
        pts=' '.join(f'{85+x*k:.2f},{680-y*k:.2f}' for x,y in ps)
        style=f'stroke-width="{.05*k}" stroke-dasharray="{.5*k},{.25*k}"' if limit else 'stroke-width="2"'
        tag='polyline' if limit or len(ps)==2 else 'polygon'
        parts.append(f'<{tag} points="{pts}" stroke="{color}" fill="none" {style}/>')
    shape([(0,0),(width,0)],'#888888');shape([(0,0),(0,H)],'#a25a91')
    if section['credit']:shape([(section['credit'],0),(section['credit'],H)],'#a25a91')
    shape([(1.5,0),(1.5,10),(5,10),(H/2,H)],'#ff0000',True)
    parts.append(f'<text x="45" y="{680-10*k:.2f}" font-size="12">10m</text>')
    for f in section['floors']:shape([(f['near'],f['low']),(f['far'],f['low']),(f['far'],f['high']),(f['near'],f['high'])],'#a78021' if f['ok'] else '#c63f3f')
    rows=['10m 이하: 1.5m / 10m 초과: H/2 · 수평:높이 = 1:2',
          f"기준 경계에서 대지까지 도로·공원 공제: {section['credit']:.2f}m",
          '대지 중심 A–A · EPSG:5187 도북 · 같은 지반고 가정',
          '구조단면 아님 · 실제 정북·지반고·조례 및 예외 확인 필요']
    rows += [f"{f['floor']}층 H={f['high']:.2f}m | 이격 {f['near']:.2f}m / 기준 {f['required']:.2f}m" for f in section['floors']]
    for i,row in enumerate(rows[:14]):parts.append(f'<text x="50" y="{740+i*23}" font-size="13">'+escape(row)+'</text>')
    parts.append('</svg>');pages=[''.join(parts)]
    for start in range(14,len(rows),30):
        parts=['<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123"><text x="50" y="55" font-size="24">일조 단면검토 · 층별 수치</text>']
        for i,row in enumerate(rows[start:start+30]):parts.append(f'<text x="50" y="{110+i*28}" font-size="13">'+escape(row)+'</text>')
        pages.append(''.join(parts)+'</svg>')
    return pages


def pages_dxf(pages):
    """보고서 쪽(같은 제한 SVG)을 캐드 도면으로 — A4(210×297 mm) 한 장씩 옆으로 늘어놓는다(대표 2026-10-30 '보고서도 캐드에서 볼 수 있어야지')."""
    import io
    import xml.etree.ElementTree as ET
    import ezdxf
    k=210/794;doc=ezdxf.new('R2018',setup=True);doc.units=ezdxf.units.MM;msp=doc.modelspace()
    for name,color in (('A-ANNO-TEXT',7),('A-ANNO-LINE',8),('A-ANNO-FRAME',8)):doc.layers.add(name,color=color)
    for i,page in enumerate(pages):
        ox=i*(210+20);msp.add_lwpolyline([(ox,0),(ox+210,0),(ox+210,297),(ox,297)],close=True,dxfattribs={'layer':'A-ANNO-FRAME'})
        for node in ET.fromstring(page).iter():
            tag=node.tag.rsplit('}',1)[-1];a=node.attrib
            if tag=='text' and (node.text or '').strip():
                h=float(a.get('font-size',14))*k*.72
                msp.add_text(node.text,height=h,dxfattribs={'layer':'A-ANNO-TEXT','insert':(ox+float(a.get('x',0))*k,297-float(a.get('y',0))*k)})
            elif tag in ('polygon','polyline'):
                ps=[(ox+float(x)*k,297-float(y)*k) for x,y in (p.split(',') for p in a['points'].split())]
                msp.add_lwpolyline(ps,close=tag=='polygon',dxfattribs={'layer':'A-ANNO-LINE'})
    out=io.StringIO();doc.write(out);return out.getvalue().encode('utf-8')


def local_pdf(pages):
    """Render our restricted SVG sheets with CAD's existing Korean PDF font."""
    import io
    import xml.etree.ElementTree as ET
    from reportlab.pdfgen import canvas
    from reportlab.lib.colors import HexColor
    from pdf_service import font,FONT
    font();output=io.BytesIO();c=canvas.Canvas(output,pagesize=(595.5,842.25))
    for page in pages:
        c.saveState();c.scale(.75,.75)
        for node in ET.fromstring(page).iter():
            tag=node.tag.rsplit('}',1)[-1];a=node.attrib
            if tag=='text':
                c.setFillColor(HexColor(a.get('fill','#182b38')));c.setFont(FONT,float(a.get('font-size',14)))
                c.drawString(float(a.get('x',0)),1123-float(a.get('y',0)),node.text or '')
            elif tag in ('polygon','polyline'):
                c.setDash([float(v) for v in a.get('stroke-dasharray','').split(',') if v])
                ps=[tuple(map(float,p.split(','))) for p in a['points'].split()]
                path=c.beginPath();path.moveTo(ps[0][0],1123-ps[0][1])
                for x,y in ps[1:]:path.lineTo(x,1123-y)
                if tag=='polygon':path.close()
                c.setStrokeColor(HexColor(a.get('stroke','#000000')));c.setLineWidth(float(a.get('stroke-width',1)))
                fill=a.get('fill','none');c.setFillColor(HexColor(fill if fill!='none' else '#ffffff'));c.drawPath(path,stroke=1,fill=int(fill!='none'))
        c.restoreState();c.showPage()
    c.save();return output.getvalue()


def process(data):
    action=data.get('action')
    if action=='land':return enrich_drawing(data)
    if action=='pdf':return pdf(data)
    if action=='sms':
        if data.get('confirmed') is not True:raise ValueError('받는 번호와 내용을 확인한 뒤 전송하세요.')
        phone=re.sub(r'[^0-9]','',str(data.get('phone','')));text=str(data.get('text','')).strip()
        if not re.fullmatch(r'0\d{8,10}',phone) or not text or len(text)>2000:raise ValueError('수신번호와 문자 내용(최대 2,000자)을 확인하세요.')
        return parcel.request(parcel.BASE+'/api/send-sms',{'phone':phone,'text':text},authenticated=True)[0]
    raise ValueError('지원하지 않는 미리보다 작업입니다.')
