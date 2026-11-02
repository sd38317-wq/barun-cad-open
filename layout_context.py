"""Local AI planning input adapter. No legal limits or planning rules are invented here."""
import copy
import math
import re
import site_plan_service as site


def ask(key, question, choices=(), **extra):
    return {'key':key,'question':question,'choices':[{'n':i+1,**c} for i,c in enumerate(choices)],**extra}


def positive(v):
    return type(v) in (int,float) and math.isfinite(v) and v>0


def area(ring):
    ox,oy=ring[0]
    return abs(sum((a[0]-ox)*(b[1]-oy)-(a[1]-oy)*(b[0]-ox) for a,b in zip(ring,ring[1:]+ring[:1])))/2


def merge(base, patch):
    out=copy.deepcopy(base)
    for key,value in patch.items():
        out[key]=merge(out[key],value) if isinstance(out.get(key),dict) and isinstance(value,dict) else copy.deepcopy(value)
    return out


def read_neighbors(neighbors,convert=None):
    if not isinstance(neighbors,list):raise ValueError('site.neighbors는 인접 필지 객체 배열입니다. 도로는 {jimok:"도", coords:[[x,y],...]}로 주세요.')
    result=[]
    for i,n in enumerate(neighbors):
        if not isinstance(n,dict):raise ValueError(f'site.neighbors[{i}]는 {{jimok:"도", coords:[[x,y],...]}} 형식의 객체입니다.')
        if 'coords' not in n:raise ValueError(f'site.neighbors[{i}].coords에 인접 필지의 닫힌 외곽 좌표 [[x,y],...]를 주세요. 도로는 jimok:"도"입니다.')
        try:
            coords=convert(n['coords']) if convert else copy.deepcopy(n['coords'])
            site.polygon(coords)
            if area(coords)<=1e-8:raise ValueError('면적이 있는 인접 필지 외곽이 필요합니다.')
        except ValueError as error:raise ValueError(f'site.neighbors[{i}].coords: {error}') from None
        if not isinstance(n.get('jimok'),str):raise ValueError(f'site.neighbors[{i}].jimok에 지목을 주세요. 도로는 "도"입니다.')
        result.append({**n,'coords':coords})
    return result


def normalize_site(value):
    """Explicit projected coordinates are metres. CAD x/y without CRS are mm."""
    import korea_crs
    value=copy.deepcopy(value)
    crs=value.get('crs');units=value.pop('units',None)
    if crs not in (None,'local','EPSG:5179','EPSG:5187'):raise ValueError('대지 좌표계는 EPSG:5179 또는 EPSG:5187을 사용하세요.')
    if units not in (None,'m','mm'):raise ValueError('대지 단위는 m 또는 mm입니다.')
    local=crs in (None,'local')
    scale=.001 if units=='mm' or local and units is None else 1
    transform=korea_crs.transformer(crs or 'EPSG:5187', 'EPSG:5187') if not local else None
    def ring(raw):
        if not isinstance(raw,list):raise ValueError('대지 외곽 좌표가 필요합니다.')
        result=[]
        for p in raw:
            pair=[p.get('x'),p.get('y',p.get('z'))] if isinstance(p,dict) else p
            if not isinstance(pair,(list,tuple)) or len(pair)!=2 or any(type(v) not in (int,float) or not math.isfinite(v) for v in pair):
                raise ValueError('대지 좌표는 [x,y] 또는 x·y 도면 점이어야 합니다.')
            x,y=[v*scale for v in pair]
            result.append(list(transform.transform(x,y)) if transform else [200000+x,400000+y])
        if len(result)>1 and result[0]==result[-1]:result.pop()
        site.polygon(result)
        if area(result)<=1e-8:raise ValueError('면적이 있는 대지 외곽이 필요합니다.')
        return result
    value['parcel']=ring(value.get('parcel',value.pop('ring',None)))
    value['neighbors']=read_neighbors(value.get('neighbors',[]),ring)
    value['crs']='EPSG:5187'
    return value,local


def zoning_from_info(info):
    mass=info.get('massing') or {};limits=info.get('limits') or {}
    names=info.get('zoneNames') or [z.get('name') for z in info.get('zones',[]) if z.get('relation')!='접함']
    zone=mass.get('zoneName') or (names[0] if len(names)==1 else None)
    return {k:v for k,v in {'zone':zone,'bcr':limits.get('bcr'),'far':limits.get('far')}.items() if v is not None}


def fill_program_from_model(program, model):
    """그려 둔 설계 모델이 있으면 층수·층고를 그것으로(3층·3.6 m 가정 대신). 용도는 배치 서버 보기와 달라 그대로 둔다."""
    if not isinstance(model,dict):return
    # 옥상 난간 층(rf·1.5 m 이하)은 층이 아니다 — 괴정이 '5층·층고 2.62 m'로 엔진에 갔다(2026-10-30)
    low=area_rules()['lowWallMax']
    stories=[s for s in model.get('stories') or [] if isinstance(s,dict) and positive(s.get('height')) and s['height']>low and (s.get('elevation') or 0)>=0]
    if stories:
        program.setdefault('floors',len(stories))
        program.setdefault('floor_h',round(sum(s['height'] for s in stories)/len(stories)/1000,2))


def housing_needs(program):
    if not re.search(r'아파트|공동주택|연립|다세대|다가구|도시형|오피스텔',str(program.get('use') or '')):return []
    units=program.get('units')
    if units is None:units={}
    if not isinstance(units,dict):raise ValueError('program.units는 {count:세대수, exclusive_area_m2:전용면적} 객체입니다.')
    count=units.get('count');areas=units.get('exclusive_areas_m2');one=units.get('exclusive_area_m2')
    if count is not None and (type(count) is not int or not 1<=count<=500):raise ValueError('program.units.count는 1~500의 정수 세대수입니다.')
    if areas is not None:
        if not isinstance(areas,list) or not 1<=len(areas)<=500 or not all(positive(a) for a in areas):raise ValueError('program.units.exclusive_areas_m2는 세대별 전용면적(㎡) 양수 목록입니다.')
        if count is not None and count!=len(areas):raise ValueError('program.units.count와 exclusive_areas_m2의 세대 수가 다릅니다.')
    if one is not None and not positive(one):raise ValueError('program.units.exclusive_area_m2는 한 세대 전용면적(㎡) 양수입니다.')
    needs=[]
    if count is None and areas is None:
        needs.append(ask('program.units.count','모두 몇 세대를 계획하나요? 전체 세대수를 알려 주세요.',[{'label':str(n)+'세대','value':n} for n in (50,80,100)]))
    if one is None and areas is None:
        needs.append(ask('program.units.exclusive_area_m2','한 세대의 전용면적은 몇 ㎡인가요? 면적이 다르면 세대별 전용면적 목록을 알려 주세요.',[{'label':str(n)+'㎡','value':n} for n in (59,74,84)]))
    return needs


def prepare(document, args, cached=None, mode='generate'):
    import parcel_service
    import miriboda_service
    doc=copy.deepcopy(document or {});cached=cached or {}
    raw=copy.deepcopy(args.get('request',{}))
    if not isinstance(raw,dict):raise ValueError('배치 request는 객체여야 합니다.')
    if 'siteEngine' in raw:
        if set(raw)!={'siteEngine'} or not isinstance(raw['siteEngine'],dict):raise ValueError('siteEngine 입력을 확인하세요.')
        raw=raw['siteEngine']
    allowed={'site','zoning','program','output','overrides','address','pnu'}
    if set(raw)-allowed:raise ValueError('지원하지 않는 배치 입력입니다: '+', '.join(sorted(set(raw)-allowed)))
    address=args.get('address',raw.pop('address',None));pnu=args.get('pnu',raw.pop('pnu',None))
    if address is not None and (not isinstance(address,str) or not address.strip()):raise ValueError('주소를 글자로 알려 주세요.')
    if pnu is not None and not re.fullmatch(r'\d{19}',str(pnu)):raise ValueError('주소 검색 결과의 필지를 선택하세요.')
    needs=[];assumed=[];auto={};info=None
    stored=doc.get('sitePlanInput') or (doc.get('sitePlan') or {}).get('request') or {}
    full=all(isinstance(raw.get(k),dict) for k in ('site','zoning','program')) and any(k in raw['site'] for k in ('parcel','ring'))
    program={} if full else merge(stored.get('program') or {},doc.get('program') or {})
    zoning={} if full else merge(stored.get('zoning') or {},doc.get('zoning') or {})
    for key,dest in (('program',program),('zoning',zoning)):
        for source in (raw,args):
            if key in source:
                if not isinstance(source[key],dict):raise ValueError('배치 '+key+'은 객체여야 합니다.')
                dest.update(copy.deepcopy(source[key]))
    if not full:fill_program_from_model(program,doc.get('buildingModel') or latest_set_model(doc))
    boundaries=site.boundary_entities(doc)
    source=next((e for e in boundaries if e.get('parcelRole')=='site'),None)
    source_attrs=(source or {}).get('attributes') or {}
    explicit_site=raw.get('site')
    if explicit_site is not None and not isinstance(explicit_site,dict):raise ValueError('대지 입력은 객체여야 합니다.')
    has_parcel=isinstance(explicit_site,dict) and ('parcel' in explicit_site or 'ring' in explicit_site)
    if not address and not has_parcel:address=(explicit_site or {}).get('address') or (stored.get('site') or {}).get('address')
    if not pnu and not address:pnu=(explicit_site or {}).get('id') or source_attrs.get('pnu')
    if not re.fullmatch(r'\d{19}',str(pnu or '')):pnu=None
    if not pnu and not address and not has_parcel:
        pnu=cached.get('pnu');address=cached.get('address')
    fetched=cached.get('parcel') if pnu and cached.get('pnu')==pnu else None
    if address and not pnu:
        found=cached.get('search') if cached.get('address')==address else parcel_service.search(address)
        choices=[r for r in found.get('results',[]) if re.fullmatch(r'\d{19}',str(r.get('pnu','')))]
        choices=list({r['pnu']:r for r in choices}.values())
        exact=[r for r in choices if address.strip() in (r.get('jibunAddress'),r.get('roadAddress'))]
        if len(exact)==1:choices=exact
        if len(choices)!=1:
            needs.append(ask('pnu','어느 땅인가요? 주소 검색 결과에서 골라 주세요.' if choices else '주소를 찾지 못했어요. 지번이나 도로명 주소를 조금 더 알려 주세요.',
                             [{'label':r.get('jibunAddress') or r.get('roadAddress'),'value':r['pnu']} for r in choices[:20]]))
            return {'status':'needs_input','needs':needs,'autoFilled':auto,'assumed':assumed}
        pnu=choices[0]['pnu'];auto['pnu']={'value':pnu,'from':'주소 검색 결과'}
    if pnu and source_attrs.get('pnu') and str(source_attrs['pnu'])!=str(pnu):
        return {'status':'needs_input','needs':[ask('pnu','현재 도면의 필지와 선택한 주소가 달라요. 도면의 대지를 사용할지, 새 주소의 대지를 사용할지 먼저 확인해 주세요.')],'autoFilled':auto,'assumed':assumed}
    valid_pnu=bool(re.fullmatch(r'\d{19}',str(pnu or '')))
    if not source and not has_parcel and valid_pnu:
        fetched=fetched or parcel_service.fetch({'pnu':pnu,'crs':'EPSG:5187'})
        doc['entities']=fetched.get('entities',[]);doc['drawingGeo']=fetched.get('drawingGeo')
        source=next((e for e in site.boundary_entities(doc) if e.get('parcelRole')=='site'),None)
        source_attrs=(source or {}).get('attributes') or {}
        auto['site']={'from':'주소로 조회한 필지 경계'}
    try:
        request=copy.deepcopy(raw) if full else site.from_drawing(doc) if source else {'site':{},'program':{'use':'근린생활시설','floors':3,'floor_h':3.6,'massing':'auto','shape':'auto','entry_side':'auto','parking':{'count':'auto','mode':'auto','layout':'auto','stall':'일반형'}},'zoning':{}}
        if source:auto['site']={'from':'현재 도면의 대지 경계'}
    except ValueError as error:
        return {'status':'needs_input','needs':[ask('site',str(error))],'autoFilled':auto,'assumed':assumed}
    if not request['site'].get('parcel') and not has_parcel:
        return {'status':'needs_input','needs':[ask('address','이 땅의 주소를 알려 주시거나 A-SITE 레이어에 닫힌 대지 외곽을 그려 주세요.')],'autoFilled':auto,'assumed':assumed}
    if explicit_site and not has_parcel:
        request['site']=merge(request['site'],explicit_site)
        if 'neighbors' in explicit_site:
            try:
                import korea_crs
                crs,origin,anchor,_=site.drawing_frame(doc,source)
                transform=korea_crs.transformer(crs, 'EPSG:5187')
                def convert_neighbor_ring(raw):
                    if not isinstance(raw,list):raise ValueError('인접 필지 외곽 좌표가 필요합니다.')
                    points=[]
                    for p in raw:
                        if not isinstance(p, (list,tuple)) or len(p)!=2 or any(type(v) not in (int,float) or not math.isfinite(v) for v in p):
                            raise ValueError('인접 필지 좌표는 [x,y] 도면 점이어야 합니다.')
                        points.append(list(transform.transform(origin[0]+(p[0]-anchor['x'])/1000,origin[1]+(p[1]-anchor['y'])/1000)))
                    return points
                request['site']['neighbors']=read_neighbors(explicit_site['neighbors'],convert_neighbor_ring)
            except ValueError as error:
                return {'status':'needs_input','needs':[ask('site',str(error))],'autoFilled':auto,'assumed':assumed}
    if has_parcel:
        normalized,local=normalize_site(explicit_site)
        request['site']=merge({k:v for k,v in request['site'].items() if k not in ('parcel','crs','neighbors')},normalized)
    else:local=site.drawing_frame(doc,source)[3]
    if valid_pnu:request['site']['id']=pnu
    if address:request['site']['address']=address
    if local:assumed.append({'key':'site.crs','value':'EPSG:5187','say':'도면 mm를 m로 바꾸고 임시 원점에 놓았어요. 실제 지적 위치와 정북 정합은 확인이 필요해요.'})
    info=source_attrs.get('landInfo') or (fetched or {}).get('landInfo')
    if info:zoning=merge(zoning_from_info(info),zoning)
    complete_zone=lambda z: z.get('zone') not in (None,'','미확인') and positive(z.get('bcr')) and positive(z.get('far'))
    if args.get('enrich',True) and valid_pnu and not complete_zone(zoning):
        # Reuse the existing land/rule adapter; preserve the user's edited boundary.
        if source:
            doc['program']=program
            for e in site._tagged_entities(doc):
                if e.get('id')==source.get('id') and e.get('points')==source.get('points'):
                    e.setdefault('attributes',{})['pnu']=pnu
            enriched=miriboda_service.enrich_drawing(doc)
            info=enriched.get('landInfo')
            request['program']=merge(request['program'],enriched['request'].get('program') or {})
            request['zoning']=merge(request['zoning'],enriched['request'].get('zoning') or {})
            if not request['site'].get('address'):request['site']['address']=enriched['request']['site'].get('address','')
            zoning=merge(request.get('zoning') or {},zoning)
        else:
            info=miriboda_service.land_info(pnu,area(request['site']['parcel']),program.get('floors',3))
            zoning=merge(zoning_from_info(info),zoning)
        auto['zoning']={'from':'필지 토지정보·법규 조회'}
    request['zoning']=merge(request.get('zoning') or {},zoning)
    request['program']=merge(request['program'],program)
    for key in ('use','floors','floor_h'):
        if key not in request['program']:continue
        if key not in program:assumed.append({'key':'program.'+key,'value':request['program'][key],'say':{'use':'용도는 근린생활시설로 가정했어요.','floors':'층수는 3층으로 가정했어요.','floor_h':'층고는 3.6m로 가정했어요.'}[key]})
        else:auto['program.'+key]={'value':program[key],'from':'도면 또는 지정한 계획 조건'}
    needs.extend(housing_needs(request['program']))
    z=request['zoning']
    if z.get('zone') in (None,'','미확인'):
        needs.append(ask('address','이 땅의 주소를 알려 주세요. 주소가 없다면 확인한 용도지역·건폐율·용적률을 알려 주세요.'))
    else:
        for key,label in (('bcr','건폐율'),('far','용적률')):
            if not positive(z.get(key)):needs.append(ask('zoning.'+key,'이 땅에 확인된 '+label+' 상한은 몇 %인가요? 주소를 알려 주시면 조회할 수 있어요.'))
    for key in ('output','overrides'):
        if key in raw:request[key]=raw[key]
        if key in args:request[key]=copy.deepcopy(args[key])
    result={'request':request,'needs':needs,'autoFilled':auto,'assumed':assumed}
    if info:result['landInfo']={'address':info.get('address',''),'zones':[z.get('name','') for z in info.get('zones',[])[:20]]}
    if mode=='validate' and 'overrides' not in request:
        try:geometry=drawing_overrides(doc)
        except ValueError as error:
            geometry=None;needs.append(ask('overrides',str(error)))
        if geometry:
            request['overrides']=geometry;auto['overrides']={'from':'현재 도면의 건물 외곽'}
            if not (doc.get('sitePlan') or {}).get('bindings'):
                assumed.append({'key':'overrides.stalls','value':[],'say':'연결된 주차 구획 정보가 없어 주차 0면으로 검사해요. 실제 구획은 별도로 확인해 주세요.'})
        elif not any(n['key']=='overrides' for n in needs):needs.append(ask('overrides','어느 건물을 검사할까요? 배치안을 먼저 만들거나 A-BLDG-L1 레이어에 닫힌 건물 외곽을 그려 주세요.'))
    result['status']='needs_input' if needs else 'ready'
    return result


def drawing_overrides(doc):
    state=doc.get('sitePlan') or {}
    if (state.get('contract') or {}).get('revalidate') is False:raise ValueError('이 배치안은 편집 후 재검증을 지원하지 않습니다. 다시 생성해 확인해 주세요.')
    if state.get('geometry') and state.get('bindings'):
        g=copy.deepcopy(state['geometry']);by_id={e.get('id'):e for e in doc.get('entities',[])}
        all_entities={e.get('id'):e for e in site.parcel_snapshot_entities(doc)}
        for snapshot in state.get('sourceParcelGeometry',[]):
            if (all_entities.get(snapshot.get('entityId')) or {}).get('points')!=snapshot.get('points'):raise ValueError('원본 대지·도로 경계가 바뀌었습니다. 변경한 대지로 계획을 다시 생성해 주세요.')
        for snapshot in state.get('contextGeometry',[]):
            if (by_id.get(snapshot.get('entityId')) or {}).get('points')!=snapshot.get('points'):raise ValueError('대지·주변 필지가 바뀌었습니다. 새 대지 입력으로 다시 생성해 주세요.')
        bound_ids={b.get('entityId') for b in state['bindings']}
        if any(e.get('sitePlanId')==state.get('id') and e.get('sitePlanRoles') and e.get('id') not in bound_ids for e in doc.get('entities',[])):raise ValueError('복사된 배치 다각형이 있습니다. 복사를 취소하거나 새 조건으로 다시 생성해 주세요.')
        origin=state.get('origin') or {};offset=state.get('offset') or {}
        if not all(type(v) in (int,float) and math.isfinite(v) for d in (origin,offset) for v in (d.get('x'),d.get('y'))):return None
        for binding in state['bindings']:
            entity=by_id.get(binding.get('entityId'))
            if not entity:return None
            if 'stall' in binding:
                rings=[e.get('points') for e in entity.get('entities',[]) if e.get('type')=='polyline' and e.get('closed')]
                if not 0<=binding['stall']<len(rings):return None
                points=rings[binding['stall']];shift=binding.get('shift',0);points=points[shift:]+points[:shift]
            else:points=entity.get('points')
            if not points or not (entity.get('closed') or entity.get('type') in ('rectangle','block','hatch')):return None
            if points==binding.get('originalPoints'):continue
            ring=[[origin['x']+(p['x']-offset['x'])/1000,origin['y']+(p['y']-offset['y'])/1000] for p in points]
            at=g;keys=binding['path']
            for k in keys[:-1]:at=at[k]
            at[keys[-1]]=ring
        return g
    layers={l.get('id'):l.get('name') for l in doc.get('layers',[])}
    buildings=[e for e in doc.get('entities',[]) if layers.get(e.get('layer'),e.get('layer')) in ('A-BLDG','A-BLDG-L1') and e.get('type') in ('polyline','rectangle') and (e.get('closed') or e.get('type')=='rectangle')]
    sources=[e for e in site.boundary_entities(doc) if e.get('parcelRole')=='site']
    if buildings and sources:
        # 한 벌 배치도 장에도 A-BLDG-L1 외곽이 그려진다(도곽 안) — 대지 위에 있는 외곽만 본다(2026-10-30). 하나뿐이어도: 괴정은 배치도 장 외곽 하나가 110 m 떨어진 건물로 엔진에 갔다
        from shapely.geometry import Point,Polygon
        lot=Polygon([(p['x'],p['y']) for p in sources[0].get('points',[])]).buffer(1000)
        buildings=[b for b in buildings if b.get('points') and lot.contains(Point(sum(p['x'] for p in b['points'])/len(b['points']),sum(p['y'] for p in b['points'])/len(b['points'])))]
    if not sources:return None
    crs,origin,anchor,_=site.drawing_frame(doc,sources[0])
    import korea_crs
    transform=korea_crs.transformer(crs, 'EPSG:5187')
    to_crs=lambda ring:[list(transform.transform(origin[0]+(x-anchor['x'])/1000,origin[1]+(y-anchor['y'])/1000)) for x,y in ring]
    if len(buildings)!=1:
        # 대지 위 외곽이 없으면 그려 둔 한 벌의 설계(model.site.parcel 로 대지에 앉힌 것)를 AI 설계 엔진에 넘긴다 — 층마다 바깥 외곽(2026-10-30 괴정: 빈 건물로 검사됐다)
        floors=set_floor_rings(doc,sources[0])
        if not floors:return None
        rings=[to_crs(r) for r in floors]
        for r in rings:site.polygon(r)
        return {'crs':'EPSG:5187','units':'m','footprint':rings[0],'floors':rings,'stalls':[],'parking_mode':'none'}
    ring=to_crs((p['x'],p['y']) for p in buildings[0]['points'])
    site.polygon(ring)
    return {'crs':'EPSG:5187','units':'m','footprint':ring,'stalls':[],'parking_mode':'none'}


def latest_set(doc):
    """도면에 기억한 마지막 한 벌(kind=set) 기록."""
    sets=[s for s in (doc.get('drawingSets') or {}).values() if isinstance(s,dict) and s.get('kind') in ('set','all') and isinstance(s.get('model'),dict)]
    return sets[-1] if sets else None


def latest_set_model(doc):
    """도면에 기억한 마지막 한 벌(kind=set)의 설계 모델."""
    return (latest_set(doc) or {}).get('model')


def use_set_area(report, doc):
    """엔진은 발코니까지 바닥으로 세어 건폐율·용적률이 도면 구적과 달랐다(괴정 182.68 vs 구적) — 한 벌의 구적 값으로 바꾸고 출처를 단다. 한도·판정은 엔진 한도로."""
    area=(latest_set(doc) or {}).get('area') or {}
    for c in report.get('checks') or []:
        key={'건폐율':'coverage','용적률':'far'}.get(c.get('rule'))
        if key and isinstance(area.get(key),(int,float)):
            c['engineValue']=c.get('value');c['value']=area[key];c['source']='도면 구적'
            if isinstance(c.get('limit'),(int,float)):c['ok']=area[key]<=c['limit']
    return report


def set_on_site(doc, source):
    """한 벌 설계 모델과, 설계 mm → 도면 mm(지적 대지) 돌림·옮김. model.site.parcel 이 지적 대지와 85% 넘게 겹칠 때만."""
    import site_placement
    model=latest_set_model(doc);parcel=((model or {}).get('site') or {}).get('parcel')
    lot=site_placement._polygon([(p['x'],p['y']) for p in source.get('points') or []])
    design=site_placement._polygon([(p['x'],p['y']) if isinstance(p,dict) else p[:2] for p in parcel or []])
    if not lot or not design:return model,None
    rigid,iou,_=site_placement.fit(design,lot)
    return model,(rigid if iou>=site_placement.GOOD_IOU else None)


def set_neighbors(doc, source, entities):
    """이웃 필지(지적, parcelRole neighbor)를 설계 mm 로 — 3D 동지 그림자를 필지별로 셀 때(일조 보고서). 지적 점은 EPSG m = (점-insertionMm)/1000+originMetres."""
    _,rigid=set_on_site(doc,source)
    a=source.get('attributes') or {};o,ins=a.get('originMetres'),a.get('insertionMm')
    if not rigid or not o or not ins:return []
    back=rigid.inverse();out=[]
    for e in entities:
        ea=e.get('attributes') or {};eo,ei=ea.get('originMetres',o),ea.get('insertionMm',ins)
        if e.get('parcelRole')!='neighbor' or ea.get('ring')=='hole':continue
        ring=[back((((p['x']-ei[0])/1000+eo[0]-o[0])*1000+ins[0],((p['y']-ei[1])/1000+eo[1]-o[1])*1000+ins[1])) for p in e.get('points') or []]
        out.append({'jibun':ea.get('jibun',''),'coords':[[round(x),round(y)] for x,y in ring]})
    return out


def area_rules():
    """도면 기준 areaSheet 의 뺄 벽 역할·낮은 벽 높이 — 기준을 못 받으면(로그인 전 등) 지금 기준 값."""
    try:
        import vault_gate,json
        A=json.loads(vault_gate.knowledge('drawing-standard.json').decode('utf-8')).get('areaSheet') or {}
    except Exception:A={}
    return {'excludeWallRoles':A.get('excludeWallRoles') or ['parapet','railing','handrail','balcony'],'lowWallMax':(A.get('lowWall') or {}).get('maxHeight') or 1500}


def set_floor_rings(doc, source):
    """한 벌 설계의 지상층 바깥 외곽을 도면 mm 대지 위로: model.site.parcel(설계 mm)을 도면의 지적 대지에 겹쳐(돌림+옮김) 옮긴다. 아래층부터."""
    from shapely.geometry import LineString,Polygon
    from shapely.ops import polygonize,unary_union
    import site_placement
    model,rigid=set_on_site(doc,source)
    if not rigid:return []
    # 구적과 같은 규칙(도면 기준 areaSheet: 뺄 벽 역할·낮은 벽 높이) — 따로 적으면 난간벽 높이 없는 옥상이 한 층이 됐다
    A=area_rules();skip=set(A['excludeWallRoles']);low=A['lowWallMax']
    walls=[e for e in model.get('elements') or [] if e.get('kind')=='wall' and len(e.get('path') or [])>=2 and e.get('role') not in skip and not 0<(e.get('height') or 0)<=low]
    rings=[]
    for story in sorted(model.get('stories') or [],key=lambda s:s.get('elevation') or 0):
        if (story.get('elevation') or 0)<0 or 0<(story.get('height') or 0)<=low:continue   # 옥상 난간 층(1.5 m 이하)은 층이 아님
        mine=[w for w in walls if w.get('story')==story.get('id')]
        lines=[LineString([tuple((p['x'],p['y']) if isinstance(p,dict) else p[:2]) for p in w['path']]) for w in ([w for w in mine if w.get('exterior')] or mine)]
        faces=list(polygonize(unary_union(lines))) if lines else []
        if not faces:continue
        g=unary_union(faces);g=max(g.geoms,key=lambda p:p.area) if g.geom_type=='MultiPolygon' else g
        rings.append([rigid(p) for p in list(Polygon(g.exterior.coords).exterior.coords)[:-1]])
    return rings
