import test from 'node:test';
import assert from 'node:assert/strict';
import {layerFloor,restack,storeyTable,layerLevel,storeyCommands} from './storeys.js';
import {ifcPayload} from './bim-envelope.js';

const doc=()=>({units:'mm',reviewSettings:{floorHeight:3000},layers:[
 {id:'0',name:'0'},
 {id:'b1',name:'A-WALL B1'},
 {id:'w1',name:'A-WALL 1F',height:4000},
 {id:'t1',name:'A-TEXT 1F'},
 {id:'w2',name:'2F 벽'},
 {id:'w3',name:'벽 3층',floor:3,height:3300},
],entities:[]});

test('층 번호: floor 속성 우선, 이름의 2F·B1 도 읽고, 층 없는 레이어는 null',()=>{
 assert.equal(layerFloor({name:'A-WALL 1F'}),1);
 assert.equal(layerFloor({name:'X',floor:3}),3);
 assert.equal(layerFloor({name:'A-WALL B1'}),-1);
 assert.equal(layerFloor({name:'0'}),null);
 assert.equal(layerFloor({name:'A10FX'}),null);
});

test('층 표: 같은 층 레이어를 묶고 아래층 층고로 바닥 높이를 쌓는다',()=>{
 const t=storeyTable(doc());
 assert.deepEqual(t.map(r=>[r.floor,r.elevation,r.height,r.layerIds.length]),[[-1,-3000,3000,1],[1,0,4000,2],[2,4000,3000,1],[3,7000,3300,1]]);
});

test('층고를 바꾸면 위층이 모두 따라 올라가고, 되돌릴 명령은 바뀐 레이어만',()=>{
 const d=doc(),rows=storeyTable(d);
 rows.find(r=>r.floor===1).height=5000;
 const commands=storeyCommands(d,rows);
 const by=Object.fromEntries(commands.map(c=>[c.id,c.changes]));
 assert.equal(by.w2.elevation,5000);
 assert.equal(by.w3.elevation,8000);
 assert.equal(by.w1.height,5000);
 assert.equal(by.b1.elevation,-3000);
 for(const c of commands)Object.assign(d.layers.find(l=>l.id===c.id),c.changes);
 assert.equal(storeyCommands(d,storeyTable(d)).length,0);
});

test('잘못된 층고는 막는다',()=>{
 const d=doc(),rows=storeyTable(d);rows[1].height=0;
 assert.throws(()=>storeyCommands(d,rows),/층고/);
});

test('빠진 층은 바로 아래층 층고로 채운다',()=>{
 const rows=restack([{floor:1,height:4000},{floor:4,height:3000}],{base:100});
 assert.deepEqual(rows.map(r=>r.elevation),[100,12100]);
});

test('벽 높이·바닥은 층 표를 따르고 IFC 층 이름도 층 표에서 온다',()=>{
 const d=doc();d.entities.push({id:'w',type:'wall',points:[{x:0,y:0},{x:5000,y:0}],thickness:200,layer:'w2'});
 assert.deepEqual(layerLevel(d,d.layers.find(l=>l.id==='w2')),{base:4000,height:3000,floor:2});
 assert.deepEqual(layerLevel(d,d.layers[0]),{base:0,height:3000,floor:null});
 const p=ifcPayload(d);
 assert.deepEqual([p.walls[0].base,p.walls[0].height],[4000,3000]);
 assert.deepEqual(p.storeys.map(s=>s.name),['지하 1층','1층','2층','3층']);
});

test('1층 없이 2층만 있으면 아래층을 기본 층고로 보고 바닥 3,000mm',()=>{
 const t=storeyTable({reviewSettings:{floorHeight:3000},layers:[{id:'a',name:'A-WALL 2F'}],entities:[]});
 assert.deepEqual(t.map(r=>[r.floor,r.elevation]),[[2,3000]]);
});
