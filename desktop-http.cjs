const http = require('node:http');
const zlib = require('node:zlib');
const net = require('node:net');
const crypto = require('node:crypto');

// S1: 페이지 상한(서버 import_stream.SAFE_LINE_BYTES). 객체 하나가 큰 경우 HARD 한도까지는 받는다.
const SAFE_LINE_BYTES = 32 * 1024 * 1024;
const HARD_LINE_BYTES = 256 * 1024 * 1024;
const ENGINE_HEADER = 'x-barun-cad';
const ENGINE_HEADER_VALUE = '2';

/** 줄 단위 NDJSON 조립기. 어떤 문자열도 SAFE_LINE_BYTES 를 넘기지 않고 {document,report} 를 복원한다. */
function createImportAssembler() {
  let document = null, report = null, end = null, lines = 0, bytes = 0, maxLine = 0;
  const entities = [], blocks = [], shared = new Map(), preservationParts = [];
  let preservationMeta = null;
  const pending = [];
  let pendingBytes = 0;
  function record(value, size) {
    if (value.kind !== 'end') { lines++; bytes += size + 1; }
    switch (value.kind) {
      case 'index': break;   // 엔진이 맨 앞에 보내는 목차 줄(화면 쪽 import-stream.js 만 쓴다)
      case 'header': document = {...value.document}; report = value.report; break;
      case 'entities': for (const item of value.items) entities.push(item); break;
      case 'blocks': for (const item of value.items) blocks.push(item); break;
      case 'sharedBlock': {
        let definition = shared.get(value.name);
        if (!definition) { definition = {}; for (const [key, item] of Object.entries(value)) if (!['kind', 'name', 'part', 'last', 'entities'].includes(key)) definition[key] = item; definition.entities = []; shared.set(value.name, definition); }
        for (const item of value.entities || []) definition.entities.push(item);
        break;
      }
      case 'preservationMeta': preservationMeta = {}; for (const [key, item] of Object.entries(value)) if (key !== 'kind') preservationMeta[key] = item; break;
      case 'preservation': preservationParts.push(String(value.data || '')); break;
      case 'end': end = value; break;
      default: throw Error('도면 엔진 응답 형식을 알 수 없습니다.');
    }
  }
  function line(buffer) {
    if (buffer.length > HARD_LINE_BYTES) throw Error('도면 엔진 응답 한 줄이 허용 크기를 초과했습니다.');
    if (!buffer.length) return;
    maxLine = Math.max(maxLine, buffer.length);
    let value;
    try { value = JSON.parse(buffer.toString('utf8')); } catch { throw Error('도면 엔진 응답이 중간에 끊겼거나 형식이 손상되었습니다.'); }
    record(value, buffer.length);
  }
  return {
    push(chunk) {
      let start = 0;
      for (let index = 0; index < chunk.length; index++) {
        if (chunk[index] !== 0x0a) continue;
        const piece = chunk.subarray(start, index);
        if (pending.length) { pending.push(piece); line(Buffer.concat(pending)); pending.length = 0; pendingBytes = 0; }
        else line(piece);
        start = index + 1;
      }
      if (start < chunk.length) {
        const rest = chunk.subarray(start);
        pendingBytes += rest.length;
        if (pendingBytes > HARD_LINE_BYTES) throw Error('도면 엔진 응답 한 줄이 허용 크기를 초과했습니다.');
        pending.push(Buffer.from(rest));
      }
    },
    finish() {
      if (pending.length) { line(Buffer.concat(pending)); pending.length = 0; }
      if (!document || !end) throw Error('도면 엔진 응답이 중간에 끊겼습니다.');
      // 무결성: end 줄의 줄 수·바이트·개수와 대조한다(페이지 하나가 빠진 캐시를 조용히 받지 않는다).
      const got = {entities: entities.length, blocks: blocks.length, sharedBlocks: shared.size, preservationParts: preservationParts.length};
      for (const [key, expected] of Object.entries(end.counts || {})) if (key in got && got[key] !== expected) throw Error(`전송된 도면 자료가 불완전합니다 (${key} ${got[key]}/${expected}). 다시 여세요.`);
      if (Number.isFinite(end.lines) && end.lines !== lines) throw Error(`전송된 도면 자료가 불완전합니다 (줄 ${lines}/${end.lines}). 다시 여세요.`);
      if (Number.isFinite(end.bytes) && end.bytes !== bytes) throw Error('전송된 도면 자료가 불완전합니다 (크기 불일치). 다시 여세요.');
      document.entities = entities;
      document.blocks = blocks;
      if (shared.size) document.sharedBlocks = Object.fromEntries(shared);
      if (preservationMeta) document.dxfPreservation = {...preservationMeta, data: preservationParts.join('')};
      return {document, report, stats: {lines, maxLineBytes: maxLine}};
    },
    get stats() { return {lines, maxLineBytes: maxLine, entities: entities.length}; }
  };
}

function requestJson(target, options = {}) {
  const method = options.method || 'GET';
  const body = options.body == null ? null : Buffer.from(options.body);
  const headers = {...(options.headers || {})};
  if (body) headers['Content-Length'] = String(body.length);
  const timeoutMs = options.timeoutMs || 120000;
  const maxBytes = options.maxBytes || 400_000_000;
  return new Promise((resolve, reject) => {
    const request = http.request(target, {method, headers}, response => {
      const chunks = [];
      let size = 0;
      let lastProgress = 0;
      let failed = null;
      const total = Number(response.headers['content-length']) || 0;
      const ndjson = /x-ndjson/i.test(response.headers['content-type'] || '');
      const gzip = /gzip/i.test(response.headers['content-encoding'] || '');
      const assembler = ndjson ? createImportAssembler() : null;
      // NDJSON 은 압축을 풀면서 줄마다 바로 조립해 큰 문자열·버퍼를 만들지 않는다.
      const sink = ndjson ? (gzip ? zlib.createGunzip() : null) : null;
      const fail = error => { if (failed) return; failed = error; request.destroy(error); reject(error); };
      const feed = chunk => { try { assembler.push(chunk); } catch (error) { fail(error); } };
      if (sink) { sink.on('data', feed); sink.on('error', fail); }
      options.onProgress?.({stage:'변환 결과를 받는 중입니다.',received:0,total});
      response.on('data', chunk => {
        if (failed) return;
        size += chunk.length;
        if (size > maxBytes) { fail(Error('도면 엔진 응답이 허용 크기를 초과했습니다.')); return; }
        if (ndjson) { if (sink) sink.write(chunk); else feed(chunk); }
        else chunks.push(chunk);
        const now=Date.now();if(now-lastProgress>=100){lastProgress=now;options.onProgress?.({stage:'변환 결과를 받는 중입니다.',received:size,total});}
      });
      response.on('aborted', () => fail(Error('도면 엔진 응답이 중간에 끊겼습니다.')));
      response.on('error', fail);
      response.on('end', () => {
        if (failed) return;
        const done = () => {
          try {
            options.onProgress?.({stage:'압축을 풀고 객체 목록을 해석하고 있습니다.',received:size,total});
            let value;
            if (ndjson) { const assembled = assembler.finish(); value = {document: assembled.document, report: assembled.report}; }
            else {
              let data = Buffer.concat(chunks);
              if (gzip) data = zlib.gunzipSync(data);
              const text = data.toString('utf8');
              if (!text.trim()) throw Error('도면 엔진 응답이 비어 있습니다.');
              value = JSON.parse(text);
            }
            resolve({ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, headers: response.headers, value});
          } catch (error) { reject(error); }
        };
        if (sink) { sink.once('end', done); sink.end(); } else done();
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(Error('도면 엔진 응답 시간이 초과되었습니다.')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

/** 엔진 시험의 답(server.py engine_proof 와 글자 그대로 같은 식). 포트를 묶어 다른 포트의 엔진 답을 빌려 올 수 없다. */
function engineProof(key, port, challenge) {
  return crypto.createHmac('sha256', key).update(`barun-cad-engine/v1|${port}|${challenge}`).digest('hex');
}

/** 받은 답(쉼표로 이은 hex) 가운데 keys 의 열쇠로 만든 답과 같은 것이 있으면 그 열쇠를 돌려준다. */
function provenKey(keys, port, challenge, answer) {
  const answers = String(answer || '').split(',').filter(item => /^[0-9a-f]{64}$/.test(item)).map(item => Buffer.from(item));
  for (const key of keys) {
    if (typeof key !== 'string' || !key) continue;
    const expected = Buffer.from(engineProof(key, port, challenge));
    if (answers.some(item => crypto.timingSafeEqual(item, expected))) return key;
  }
  return null;
}

/** S4: 포트에 무엇이 있는지 구분한다 — engine(우리 엔진) / foreign(다른 프로그램) / free(비어 있음) / silent(응답 없음).
    keys(열쇠 목록, 또는 /api/status 응답을 받아 목록을 주는 함수)를 주면 머리말·응답 모양만 믿지 않고 시험을 낸다:
    그 열쇠를 아는 엔진만 맞게 답하고, 못 맞히면 흉내 낸 다른 프로그램(foreign)으로 본다. 맞힌 열쇠는 key 로 돌려준다. */
async function probeEngine(url, {timeoutMs = 2000, keys = null} = {}) {
  try {
    const challenge = keys ? crypto.randomBytes(24).toString('base64url') : null;
    const result = await requestJson(url + '/api/status', {timeoutMs, maxBytes: 1_000_000, headers: challenge ? {'X-CAD-Challenge': challenge} : {}});
    // 데스크톱 엔진은 토큰을 알리지 않고 tokenPolicy:'desktop' 만 알린다(토큰은 셸이 넘겨주거나 연결 파일에서 읽는다).
    const value = result.value;
    const ours = value && (typeof value.token === 'string' || value.tokenPolicy === 'desktop');
    if (result.headers[ENGINE_HEADER] === ENGINE_HEADER_VALUE && ours) {
      let key = null;
      if (challenge) {
        key = provenKey(typeof keys === 'function' ? keys(value) || [] : keys, new URL(url).port, challenge, result.headers['x-cad-proof']);
        if (!key) return {state: 'foreign', status: result.status, unverified: true};
      }
      return {state: 'engine', status: result.status, token: typeof value.token === 'string' ? value.token : null, ...(challenge ? {key} : {}), pid: value.pid || null, version: value.version};
    }
    return {state: 'foreign', status: result.status};
  } catch (error) {
    if (error && error.code === 'ECONNREFUSED') return {state: 'free'};
    if (/시간이 초과|timeout/i.test(String(error && error.message))) return {state: 'silent'};
    if (error && error.code === 'ECONNRESET') return {state: 'foreign', status: 0};
    return {state: 'foreign', status: 0, error: String(error && error.message || error)};
  }
}

function portIsFree(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

/** 후보 포트 중 우리 엔진이 이미 있으면 그것을 쓰고, 비어 있으면 그 포트에서 새로 띄운다. 다른 프로그램이 점유한 포트는 건너뛴다. */
async function selectEnginePort(candidates, {probe = port => probeEngine(`http://127.0.0.1:${port}`), isFree = portIsFree} = {}) {
  const conflicts = [];
  for (const port of candidates) {
    const found = await probe(port);
    if (found.state === 'engine') return {port, state: 'engine', pid: found.pid, token: found.token, key: found.key || null, conflicts};
    if (found.state === 'free' && await isFree(port)) return {port, state: 'free', conflicts};
    conflicts.push({port, state: found.state === 'free' ? 'busy' : found.state, status: found.status});
  }
  const error = Error('포트 ' + conflicts.map(item => item.port).join(', ') + '를 다른 프로그램이 사용 중이라 로컬 도면 엔진을 시작하지 못했습니다. 그 프로그램을 종료하거나 컴퓨터를 다시 시작한 뒤 바른 CAD를 다시 실행하세요.');
  error.code = 'PORT_CONFLICT';
  error.conflicts = conflicts;
  throw error;
}

module.exports = {requestJson, createImportAssembler, probeEngine, engineProof, selectEnginePort, portIsFree, SAFE_LINE_BYTES, HARD_LINE_BYTES};
