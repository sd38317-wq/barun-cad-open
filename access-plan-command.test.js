import test from 'node:test';
import assert from 'node:assert/strict';
import {installAccessPlan} from './access-plan-command.js';
function setup(){let captured;const calls=[];let document={entities:[]};const ctx={doc:()=>document,form:(title,fields,done)=>{captured={title,fields,done};},generateAccessPlan:async(...args)=>{calls.push(args);return {ok:true};},toast:()=>{}};return {ctx,calls,get captured(){return captured},replace(){document={entities:[]};}};}
const values={areaM2:'120',date:'2026-10-11',use:'clinic',work:'change-use',story:'3F'};
test('ACCPLAN has target and optional condition fields',()=>{const x=setup();installAccessPlan(x.ctx).ACCPLAN();assert.equal(x.captured.fields.length,13);assert.equal(x.captured.fields.find(f=>f.name==='date').value,'');});
test('ACCPLAN validates area, calendar date and counts',()=>{const x=setup();installAccessPlan(x.ctx).ACCPLAN();for(const bad of [{areaM2:''},{date:'2026-02-30'},{parkingSpaces:'1.5'},{parkingRatio:'2'}])assert.throws(()=>x.captured.done({...values,...bad}));assert.equal(x.calls.length,0);});
test('ACCPLAN converts booleans and separates story from legal facility',async()=>{const x=setup();installAccessPlan(x.ctx).ACCPLAN();await x.captured.done({...values,employmentObligation:'no',parkingSpaces:'10'});assert.deepEqual(x.calls[0][1],{facility:{use:'clinic',areaM2:120,date:'2026-10-11',work:'change-use',parkingKind:'ancillary',parkingSpaces:10,employmentObligation:false},story:'3F'});});
test('ACCPLAN rejects a document changed while form was open',()=>{const x=setup();installAccessPlan(x.ctx).ACCPLAN();x.replace();assert.throws(()=>x.captured.done(values),/도면이 변경/);assert.equal(x.calls.length,0);});
