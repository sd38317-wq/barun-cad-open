// 위 막대 [패드 ▾](10/21): 사무실에서 보기·밖에서 보기·현장 기록·현장 기록 폴더를 한 목록으로 묶는다(최소 DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import {installPadMenu,PAD_MENU_ITEMS} from './pad-share.js';

class Node_ {
 constructor(tag){this.tagName=tag;this.children=[];this.parentNode=null;this.attrs={};this.listeners={};this.hidden=false;this.textContent='';this.style={};this.id='';
  const self=this;this.classList={set:new Set(),add:c=>self.classList.set.add(c),remove:c=>self.classList.set.delete(c),contains:c=>self.classList.set.has(c),toggle:(c,on)=>on?self.classList.set.add(c):self.classList.set.delete(c)};}
 set className(v){this.classList.set=new Set(String(v).split(' ').filter(Boolean));}
 append(...nodes){for(const n of nodes){n.parentNode?.children.splice(n.parentNode.children.indexOf(n),1);n.parentNode=this;this.children.push(n);}}
 insertBefore(n,ref){const i=ref?this.children.indexOf(ref):-1;n.parentNode=this;if(i<0)this.children.push(n);else this.children.splice(i,0,n);}
 contains(n){for(let x=n;x;x=x.parentNode)if(x===this)return true;return false;}
 setAttribute(k,v){this.attrs[k]=String(v);}
 addEventListener(t,f){(this.listeners[t]??=[]).push(f);}
 click(){this.onclick?.();for(const f of this.listeners.click||[])f({target:this});}
 querySelector(){return null;}
 focus(){}
 getBoundingClientRect(){return {left:100,bottom:40};}
}
function fakeDoc(){
 const header=new Node_('div');const byId={};const doc=new Node_('#doc');
 doc.createElement=tag=>new Node_(tag);doc.defaultView={innerWidth:1280,addEventListener(){}};
 doc.querySelector=sel=>sel==='header .file-actions'?header:null;doc.getElementById=id=>byId[id]||null;
 for(const [id] of PAD_MENU_ITEMS){const b=new Node_('button');b.id=id;b.textContent=id;byId[id]=b;header.append(b);}
 globalThis.MutationObserver=class{observe(){}};
 return {doc,header,byId};
}

test('네 단추를 [패드 ▾] 하나로 묶고, 누르면 펼치고 고르면 닫는다', () => {
 const {doc,header,byId}=fakeDoc();
 let opened=0;byId['pad-outside'].onclick=()=>{opened++;};
 const menu=installPadMenu({doc});
 assert.equal(header.children.length,1,'위 막대에는 묶음 하나만');
 assert.equal(menu.list.children.length,4);
 assert.ok(menu.list.hidden);
 menu.main.click();assert.equal(menu.list.hidden,false);assert.equal(menu.main.attrs['aria-expanded'],'true');
 assert.equal(menu.list.style.top,'46px');
 byId['pad-outside'].click();
 assert.equal(opened,1,'원래 단추 일은 그대로');assert.ok(menu.list.hidden,'고르면 닫힘');
});

test('하위 단추에 새 소식이 있으면 위 단추에 점', () => {
 const {doc,byId}=fakeDoc();
 const menu=installPadMenu({doc});
 assert.equal(menu.main.textContent,'패드 ▾');
 byId['pad-records'].classList.add('pad-has-changes');menu.sync();
 assert.equal(menu.main.textContent,'패드 ● ▾');assert.ok(menu.main.classList.contains('pad-has-changes'));
});
