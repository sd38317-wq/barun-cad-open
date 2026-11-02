/**
 * No OCCT import, filesystem read or worker spawn occurs at module evaluation.
 * Use inside occt-worker.js to keep synchronous OCCT algorithms off the UI thread.
 */
export const OCCT_PACKAGE = Object.freeze({ name: 'replicad-opencascadejs', version: '1.1.0' });
const packageRoot = new URL('./vendor/occt-pkg/node_modules/replicad-opencascadejs/', import.meta.url);
export const OCCT_ASSETS = Object.freeze({
  js: new URL('dist/replicad_single.js', packageRoot).href,
  wasm: new URL('dist/replicad_single.wasm', packageRoot).href,
});
const isNode = () => typeof window === 'undefined' && typeof WorkerGlobalScope === 'undefined' &&
  typeof process !== 'undefined' && !!process.versions?.node;
const clock = () => globalThis.performance?.now() ?? Date.now();

export async function occtMemorySnapshot(oc) {
  const result = { wasmHeapBytes: oc?.wasmMemory?.buffer?.byteLength ?? oc?.HEAPU8?.buffer?.byteLength ?? null };
  if (isNode()) result.process = process.memoryUsage();
  const pm = globalThis.performance?.memory;
  if (pm) result.browser = { usedJSHeapSize: pm.usedJSHeapSize,
    totalJSHeapSize: pm.totalJSHeapSize, jsHeapSizeLimit: pm.jsHeapSizeLimit };
  return result;
}

/** Compressed sizes are offline estimates; a server must actually enable compression. */
export async function measureOcctWasm({ wasmUrl = OCCT_ASSETS.wasm } = {}) {
  const url = new URL(wasmUrl, import.meta.url);
  if (isNode() && url.protocol === 'file:') {
    const [{ readFile }, zlib] = await Promise.all([import('node:fs/promises'), import('node:zlib')]);
    const data = await readFile(url);
    return { rawBytes: data.length, gzipBytes: zlib.gzipSync(data, { level: 9 }).length,
      brotliBytes: zlib.brotliCompressSync(data, { params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } }).length, brotliQuality: 6 };
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error('WASM measurement HTTP ' + response.status);
  const data = await response.arrayBuffer();
  return { rawBytes: data.byteLength, gzipBytes: null, brotliBytes: null };
}

export function createOcctLoader({ jsUrl = OCCT_ASSETS.js, wasmUrl = OCCT_ASSETS.wasm,
  initFactory, verifyPackage = !initFactory } = {}) {
  let pending;
  let metrics = null;
  return {
    load() {
      if (pending) return pending;
      pending = (async () => {
        const start = clock();
        const before = await occtMemorySnapshot();
        let wasmBinary;
        if (isNode() && new URL(wasmUrl, import.meta.url).protocol === 'file:') {
          const { readFile } = await import('node:fs/promises');
          if (verifyPackage) {
            const info = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
            if (info.name !== OCCT_PACKAGE.name || info.version !== OCCT_PACKAGE.version) {
              throw new Error('Expected ' + OCCT_PACKAGE.name + '@' + OCCT_PACKAGE.version);
            }
          }
          wasmBinary = await readFile(new URL(wasmUrl, import.meta.url));
        }
        const factory = initFactory ?? (await import(jsUrl)).default;
        const oc = await factory({ wasmBinary,
          locateFile: name => name.endsWith('.wasm') ? new URL(wasmUrl, import.meta.url).href : name });
        metrics = { package: OCCT_PACKAGE, loadMs: clock() - start,
          wasmBytes: wasmBinary?.byteLength ?? oc.wasmBinary?.byteLength ?? null,
          before, after: await occtMemorySnapshot(oc) };
        return oc;
      })().catch(cause => {
        pending = undefined; // a failed first load must be retryable
        // 설치판은 OCCT 를 처음 쓸 때 서버에서 받는다(occt_remote.py) → 실패는 대개 인터넷 문제다.
        const error = new Error((isNode() ? 'OCCT load failed. Install the pinned dependency in vendor/occt-pkg. '
          : '3D 도면 부품(OCCT)을 받지 못했습니다. 인터넷 연결을 확인하고 다시 실행하세요. ') + (cause.message ?? cause), { cause });
        error.code = cause.code === 'ENOENT' || cause.code === 'ERR_MODULE_NOT_FOUND'
          ? 'OCCT_NOT_INSTALLED' : 'OCCT_LOAD_FAILED';
        throw error;
      });
      return pending;
    },
    getMetrics() { return metrics ? structuredClone(metrics) : null; },
  };
}
const singleton = createOcctLoader();
export const loadOcct = () => singleton.load();
export const getOcctLoadMetrics = () => singleton.getMetrics();
