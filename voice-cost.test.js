import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateVoiceCost} from './chat.js';
test('live Mini response usage estimates all billable modalities',()=>{
 const u={input_tokens:384,output_tokens:123,input_token_details:{text_tokens:384,audio_tokens:0,cached_tokens:0},output_token_details:{text_tokens:53,audio_tokens:70}};
 assert.ok(Math.abs(estimateVoiceCost(u,'gpt-realtime-2.1-mini')-.0017576)<1e-10);
});
test('cached audio and text use their respective prices',()=>{
 const u={input_tokens:200,output_tokens:0,input_token_details:{text_tokens:100,audio_tokens:100,cached_tokens:100,cached_tokens_details:{text_tokens:50,audio_tokens:50}},output_token_details:{}};
 assert.equal(estimateVoiceCost(u,'gpt-realtime-2.1-mini'),.000548);
 assert.equal(estimateVoiceCost({...u,input_token_details:{...u.input_token_details,cached_tokens_details:{}}},'gpt-realtime-2.1-mini'),null);
 assert.equal(estimateVoiceCost(null,'gpt-realtime-2.1-mini'),null);
});
