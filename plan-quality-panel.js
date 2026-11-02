// 자동 배치 품질 판정 상태 이름. 판정 계산은 서버(compute/plan-quality.js)에서 한다.
export const QUALITY_STATUS={pass:'통과',warning:'경고',needs_check:'확인 필요',held:'판정 보류'};

/** 기존 카드 안에 붙이는 작은 판정 줄과 네이티브 접기 표. */
export function planQualityPanel(quality,doc=document){
 const el=(tag,text)=>{const e=doc.createElement(tag);if(text!=null)e.textContent=text;return e;};
 const root=el('section');root.className='plan-quality';root.setAttribute('aria-label','계획안 4단계 품질 판정');
 root.style.cssText='font-size:12px;line-height:1.5;overflow-wrap:anywhere;font-variant-numeric:tabular-nums';
 const line=el('p',quality.stages.map((s,i)=>(i+1)+' '+s.label+' '+QUALITY_STATUS[s.status]).join(' · '));line.className='plan-quality-line';root.append(line);
 const details=el('details'),summary=el('summary','판정 이유 · 기본값/확인값 '+quality.values.length+'개');details.append(summary);
 const reasons=el('ul');for(const s of quality.stages)reasons.append(el('li',s.label+' '+QUALITY_STATUS[s.status]+' · '+s.reasons.join(' · ')));details.append(reasons);
 const scroll=el('div');scroll.style.overflowX='auto';const table=el('table');table.style.cssText='width:100%;text-align:left;border-collapse:collapse';table.append(el('caption','결과 생성에 사용한 조건 · 확인값은 조회·계산 출처이며 인허가 확정값이 아닙니다.'));
 const head=el('thead'),hr=el('tr');for(const text of ['항목','값','출처','비고']){const th=el('th',text);th.scope='col';hr.append(th);}head.append(hr);table.append(head);
 const body=el('tbody'),labels={user:'사용자 입력',confirmed:'확인값',default:'기본값 (가정)',unknown:'출처 불명'};
 for(const v of quality.values){const row=el('tr');for(const text of [v.name,String(v.value)+(v.unit?' '+v.unit:''),labels[v.source]||labels.unknown,v.note]){const cell=el('td',text);cell.style.cssText='vertical-align:top;padding:4px';row.append(cell);}body.append(row);}table.append(body);scroll.append(table);details.append(scroll);root.append(details);return root;
}
