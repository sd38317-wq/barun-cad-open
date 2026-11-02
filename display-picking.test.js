import test from 'node:test';
import assert from 'node:assert/strict';
import {pickDisplayEntity,pickDistance} from './display-picking.js';
import * as G from './geometry.js';

const line = (id, x, y = 0) => ({ id, type: 'line', points: [{ x, y }, { x: x + 10, y }] });
const point = { x: 5, y: 1 };
test('chooses nearest candidate and preserves reverse tie rule', () => {
  const near = line('near', 0), tie = line('tie', 0), candidates = [near, tie];
  assert.equal(pickDisplayEntity(candidates, point, 5)?.id, 'tie');
  assert.deepEqual(candidates, [near, tie]);
});
test('lets a nearer earlier candidate beat a farther later candidate without mutation', () => {
  const nearer = line('nearer', 0), farther = line('farther', 0, 3);
  const before = structuredClone([nearer, farther]); Object.freeze(nearer.points); Object.freeze(nearer); Object.freeze(farther.points); Object.freeze(farther);
  assert.equal(pickDisplayEntity([nearer, farther], point, 10)?.id, 'nearer');
  assert.deepEqual([nearer, farther], before);
});
test('handles locks, excludes, and strict tolerance boundary', () => {
  const locked = line('locked', 0), open = line('open', 0);
  assert.equal(pickDisplayEntity([open, locked], point, 5, {}, e => e.id === 'locked')?.id, 'open');
  assert.equal(pickDisplayEntity([open, locked], point, 5, { locked: true }, e => e.id === 'locked')?.id, 'locked');
  assert.equal(pickDisplayEntity([open], point, 5, { exclude: ['open'] }), null);
  assert.equal(pickDisplayEntity([open], { x: 5, y: 5 }, 5), null);
});
test('an exact hit stops before inspecting earlier geometry without changing zero ties', () => {
  const candidates=[line('earlier',0),line('top',0)],visited=[];
  assert.equal(pickDisplayEntity(candidates,{x:5,y:0},5,{},e=>{visited.push(e.id);return false;})?.id,'top');
  assert.deepEqual(visited,['top']);
  assert.equal(pickDisplayEntity(candidates,{x:5,y:0},0),null);
});
test('exact-hit shortcut agrees with the original loop for mixed geometry and filters', () => {
  const candidates=[line('a',0),line('b',0,2),{id:'circle',type:'circle',center:{x:5,y:5},radius:3},
    {id:'fill',type:'hatch',points:[{x:2,y:2},{x:8,y:2},{x:8,y:8},{x:2,y:8}]},line('last',0)];
  for(let x=0;x<=10;x+=0.5)for(let y=0;y<=10;y+=0.5)for(const options of [{},{exclude:['fill']},{locked:true}]){
    const p={x,y},locked=e=>e.id==='circle';let best=5,expected=null;
    for(const e of candidates.toReversed()){
      if(!options.locked&&locked(e)||options.exclude?.includes(e.id))continue;
      const d=pickDistance(e,p,5,best);if(d<best){best=d;expected=e;}
    }
    assert.equal(pickDisplayEntity(candidates,p,5,options,locked),expected);
  }
});
test('a text drawn over a hatch is picked before the hatch interior; the hatch alone is still pickable', () => {
  const fill={id:'fill',type:'hatch',points:[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]};
  const label={id:'label',type:'text',text:'131.27',position:{x:20,y:40},height:10};
  assert.equal(pickDisplayEntity([label,fill],{x:25,y:45},5),label);
  assert.equal(pickDisplayEntity([label,fill],{x:80,y:80},5),fill);
});
