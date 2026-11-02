const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const {requestJson} = require('./desktop-http.cjs');

async function fixture(handler, run) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('local JSON client reads gzip import response without fetch or Undici', async () => {
  await fixture((request, response) => {
    const chunks=[];request.on('data',chunk=>chunks.push(chunk));request.on('end',()=>{
      assert.equal(JSON.parse(Buffer.concat(chunks)).extension,'.dxf');
      const body=zlib.gzipSync(Buffer.from(JSON.stringify({report:{imported:1}})));
      response.writeHead(200,{'Content-Type':'application/json','Content-Encoding':'gzip','Content-Length':body.length});response.end(body);
    });
  }, async url => {
    const result=await requestJson(url+'/api/import-path',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({extension:'.dxf'})});
    assert.equal(result.ok,true);assert.equal(result.value.report.imported,1);
  });
});

test('local JSON client reports a cut response instead of crashing the main process', async () => {
  await fixture((_request,response)=>{response.writeHead(200,{'Content-Type':'application/json','Content-Length':'100'});response.write('{"partial":');response.destroy();},
    async url => assert.rejects(requestJson(url,{timeoutMs:1000}),/끊겼|socket hang up|aborted/i));
});
