"""Keep newly generated Lisp geometry independently editable and on named layers."""
import copy,math,re,uuid

def standard_color(name):
    n=name.upper()
    if re.search(r'WALL-C|CENTER|CENTRE|GRID|AXIS|중심',n):return '#ff0000'
    if re.search(r'DIM|치수|TEXT|ANNO|NUMBER|TAG|TABLE|LENGTH|COUNT|TITLE|문자',n):return '#ffffff'
    if re.search(r'WALL|BRICK|MASON|COL|벽|조적|기둥',n):return '#ffff00'
    if re.search(r'DOOR|출입문',n):return '#00ff00'
    if re.search(r'GLAZ|WINDOW|창호',n):return '#00ffff'
    if re.search(r'HATCH|해치',n):return '#808080'
    if re.search(r'AREA|ROOM|면적',n):return '#00ff00'
    if re.search(r'STAIR|계단',n):return '#0000ff'
    if re.search(r'FURN|가구|INSUL|단열',n):return '#ff00ff'
    if n.startswith('LISP-'):return '#ffffff'
    return None

def normalize(document,original,command):
    doc=copy.deepcopy(document);old_ids={e['id'] for e in original['entities']}
    old_layers={l['id'] for l in original['layers']};layers={l['id']:l for l in doc['layers']}
    by_name={l['name']:l for l in doc['layers']};command=re.sub(r'[^\w-]','_',command or 'USER')[:40]
    for layer in doc['layers']:
        color=standard_color(layer['name'])
        if color:layer.update(color=color,colorMode='truecolor');layer.pop('aci',None)
    result=[];generated=0
    def layer_for(e):
        layer=layers[e['layer']]
        # Explicit architectural layers are intentional; unclassified output gets a tool/type layer.
        if layer['name'].upper().startswith(('A-','LISP-')) or (e['layer'] not in old_layers and layer['name']!='0'):return layer['id']
        name=f'LISP-{command}-{e["type"].upper()}'
        if name not in by_name:
            new={'id':uuid.uuid4().hex,'name':name,'color':standard_color(name) or '#ffffff','visible':True,'locked':False,'linetype':'CONTINUOUS','lineweight':layer.get('lineweight',.25)}
            by_name[name]=new;layers[new['id']]=new;doc['layers'].append(new)
        return by_name[name]['id']
    def separate(e):
        nonlocal generated
        if e['type']=='block':
            if e.get('clip',{}).get('enabled',False):raise ValueError('새 리습 결과에 잘린 블록이 있습니다. 클리핑을 해제하거나 개별 도형으로 출력하는 리습을 사용하세요.')
            for child in e.get('entities',[]):separate(child)
            return
        e=copy.deepcopy(e);e['id']=uuid.uuid4().hex;e['layer']=layer_for(e);e['lispCommand']=command
        if standard_color(layers[e['layer']]['name']):
            for key in ('color','aci','colorMode'):e.pop(key,None)
        if e['type']=='text' and '\n' in e.get('text',''):
            angle=math.radians(e.get('rotation',0));height=e.get('height',200);position=e['position']
            for i,text in enumerate(e['text'].split('\n')):
                if not text:continue
                item=copy.deepcopy(e);item['id']=uuid.uuid4().hex;item['text']=text
                item['position']={'x':position['x']+math.sin(angle)*height*1.35*i,'y':position['y']-math.cos(angle)*height*1.35*i}
                result.append(item);generated+=1
        else:result.append(e);generated+=1
    for e in doc['entities']:
        if e['id'] in old_ids:result.append(e)
        else:separate(e)
    doc['entities']=result
    return doc,generated
