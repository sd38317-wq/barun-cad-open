const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
export function templateBatchMatrix(batch) {
  if (!batch?.template) return null;
  if (!Array.isArray(batch.objects) || !batch.objects.length) throw new TypeError('template batch objects missing');
  let values;
  for (const object of batch.objects) {
    const elements = object?.matrixWorld?.elements;
    if (!elements || elements.length !== 16 || elements.some(v => !Number.isFinite(v))) throw new TypeError('invalid template world matrix');
    if (!values) values = Array.from(elements);
    else if (elements.some((v, i) => v !== values[i])) throw new Error('inconsistent template world matrix');
  }
  return values.every((v, i) => v === identity[i]) ? null : values.slice();
}
