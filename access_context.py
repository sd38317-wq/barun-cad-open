"""Ask only unresolved facility inputs before sending an access drawing to a worker."""
import copy
from datetime import date
from layout_context import ask, area, positive


def named_profile(doc, model, profiles):
    """도면 글자·모델 실 이름에 가장 많이 나온 용도(소매점·의원…)를 고른다. 주거 용도는 빼고 본다(복합 건물의 근생 쪽)."""
    names=[str(e.get('text','')) for e in doc.get('entities',[]) if e.get('type') in ('text','mtext')]
    names+=[str(e.get(k,'')) for e in model.get('elements',[]) if e.get('kind')=='space' for k in ('name','use')]
    best=None
    for p in profiles:
        if p['id'] in ('apartment','multi-family','dormitory'):continue
        for alias in p.get('aliases',[]):
            hits=sum(alias in n for n in names)
            if hits and (best is None or hits>best[2]):best=(p,alias,hits)
    return best[:2] if best else None


def prepare(document, args, knowledge):
    doc=document or {};facility=copy.deepcopy(args.get('facility',{}))
    if not isinstance(facility,dict):raise ValueError('시설 조건을 확인하세요.')
    if doc.get('units','mm')!='mm':raise ValueError('편의시설 계획도는 mm 도면에서 실행하세요.')
    auto={};assumed=[];needs=[]
    program=doc.get('program') or (doc.get('sitePlanInput') or {}).get('program') or (doc.get('sitePlan') or {}).get('request',{}).get('program') or {}
    model=args.get('model') or doc.get('buildingModel') or {}
    if not facility.get('use'):
        found=program.get('use') or (model.get('building') or {}).get('use')
        if found:facility['use']=found;auto['facility.use']={'value':found,'from':'도면의 건물 용도'}
    profiles=knowledge.get('planRules',{}).get('profiles',[])
    use=facility.get('use','')
    aliases={'다세대주택':'multi-family','연립주택':'multi-family','연립·다세대주택':'multi-family'}
    profile=next((p for p in profiles if p['id']==aliases.get(use,use) or use in p.get('aliases',[])),None)
    choices=[{'label':p['name'],'value':p['id']} for p in profiles if p['id'] in ('apartment','multi-family','dormitory')]
    shop=not profile and use!='공동주택' and named_profile(doc,model,[{'id':'retail','aliases':['상가','매장','점포','근린생활','근생']}])
    if use=='공동주택' or not use and not shop:
        needs.append(ask('facility.use','어떤 건물인가요? 공동주택은 세부 종류를 골라 주세요.',choices,suggested='apartment'))
    elif shop and not named_profile(doc,model,profiles):
        # 업종이 안 정해진 상가(괴정 1~3층 '상가', 2026-10-30): 아파트로 떨어지지 않고 제1종 근린 소매점 기준으로 가정한다
        needs.append(ask('facility.use','이 시설에 가장 가까운 용도를 골라 주세요.',[{'label':p['name'],'value':p['id']} for p in profiles],
                         suggested='retail',why=f"업종이 정해지지 않은 '{shop[1]}'이라 제1종 근린생활시설 소매점 기준으로 봤어요"))
    elif not profile:
        found=named_profile(doc,model,profiles)
        needs.append(ask('facility.use','이 시설에 가장 가까운 용도를 골라 주세요.',[{'label':p['name'],'value':p['id']} for p in profiles],
                         **({'suggested':found[0]['id'],'why':f"도면 실 이름 '{found[1]}'으로 골랐어요"} if found else {})))
    else:facility['use']=profile['id']
    if 'areaM2' not in facility:
        recorded=(doc.get('sitePlan') or {}).get('report',{}).get('numbers',{}).get('gfa')
        same_use=profile and program.get('use') in (profile['id'],*profile.get('aliases',[]))
        if same_use and positive(recorded):
            facility['areaM2']=recorded;auto['facility.areaM2']={'value':recorded,'from':'동일 용도의 배치 결과 연면적'}
    if 'areaM2' not in facility:
        layers={l.get('id'):l.get('name') for l in doc.get('layers',[])}
        outlines=[e for e in doc.get('entities',[]) if layers.get(e.get('layer'),e.get('layer')) in ('A-BLDG','A-BLDG-L1') and e.get('type') in ('polyline','rectangle') and (e.get('closed') or e.get('type')=='rectangle')]
        multiple_floors=positive(program.get('floors')) and program['floors']>1 or len(model.get('stories',[]))>1
        if len(outlines)==1 and not multiple_floors:
            ring=[[p['x']/1000,p['y']/1000] for p in outlines[0].get('points',[])]
            if len(ring)>=3 and positive(area(ring)):
                facility['areaM2']=area(ring);assumed.append({'key':'facility.areaM2','value':facility['areaM2'],'say':'현재 층의 건물 외곽 면적을 해당 시설 면적으로 가정했어요. 여러 층이나 복합 용도이면 해당 용도 전체 면적을 알려 주세요.'})
        if 'areaM2' not in facility:
            spaces=[e for e in model.get('elements',[]) if e.get('kind')=='space' and len(e.get('outline') or [])>2 and profile and any(a in str(e.get('name',''))+str(e.get('use','')) for a in [profile['name'],*profile.get('aliases',[])])]
            total=round(sum(area([[x/1000,y/1000] for x,y in e['outline']]) for e in spaces),2) if spaces else None
            needs.append(ask('facility.areaM2','이 용도로 쓰는 전체 바닥면적은 몇 ㎡인가요?',**({'suggested':total,'why':f'설계 모델의 같은 용도 실 {len(spaces)}개 면적을 더했어요'} if positive(total) else {})))
    if 'work' not in facility:
        facility['work']='new';assumed.append({'key':'facility.work','value':'new','say':'신축으로 가정했어요. 기존 건물 용도를 바꾸는 경우 알려 주세요.'})
    if 'date' not in facility:
        facility['date']=date.today().isoformat();assumed.append({'key':'facility.date','value':facility['date'],'say':'검토 기준일은 오늘로 가정했어요.'})
    if profile:
        for key in dict.fromkeys(c['field'] for c in profile.get('conditions',[])):
            if facility.get(key) is not None:continue
            label={'units':'세대수는 몇 세대인가요?','rooms':'객실이나 방은 몇 개인가요?','residents':'수용 인원은 몇 명인가요?','parkingSpaces':'주차면은 몇 면인가요?','employmentObligation':'장애인 고용 의무가 있는 시설인가요?'}.get(key,'시설의 '+key+' 조건을 알려 주세요.')
            needs.append(ask('facility.'+key,label))
    return {'status':'needs_input' if needs else 'ready','facility':facility,'autoFilled':auto,'assumed':assumed,'needs':needs}
