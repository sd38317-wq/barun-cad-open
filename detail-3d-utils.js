// Pure helpers shared by the lazy GLB viewer and the detail catalog UI.
export function isSafeDetailGlbPath(value) {
  if (typeof value !== 'string' || !value || /[:?#\u0000-\u001f]/u.test(value)) return false;
  const relative = value.replaceAll('\\', '/');
  return !relative.startsWith('/') && !relative.split('/').some(part => part === '..') && /\.glb$/iu.test(relative);
}

export function hasDetailGlb(item) {
  return item?.source === 'library' && !!item.id && (!item.kind || item.kind === 'detail') && item.has_glb === true;
}

/** Decode the authenticated server response in RAM; no URL, file or cache is created. */
export function detailGlbBuffer(asset) {
  if (asset?.format !== 'barun-asset/1' || asset.kind !== 'detail' || typeof asset.glb !== 'string' || !asset.glb) throw Error('3D 미리보기 없음');
  let binary;
  try {binary = atob(asset.glb);} catch {throw Error('서버 3D 자료가 올바르지 않습니다.');}
  const bytes = Uint8Array.from(binary, value => value.charCodeAt(0)), view = new DataView(bytes.buffer);
  if (bytes.length < 20 || String.fromCharCode(...bytes.slice(0,4)) !== 'glTF' || view.getUint32(4,true) !== 2 || view.getUint32(8,true) !== bytes.length) throw Error('서버 3D 자료가 올바르지 않습니다.');
  return bytes.buffer;
}

/** Fit the bounding sphere inside both perspective angles, including narrow panes. */
export function calculateCameraFit(bounds, aspect = 1, fov = 40) {
  const axes = ['x', 'y', 'z'];
  if (!axes.every(axis => Number.isFinite(bounds?.min?.[axis]) && Number.isFinite(bounds?.max?.[axis]) && bounds.max[axis] >= bounds.min[axis])) {
    throw new Error('3D 모형의 크기를 계산할 수 없습니다.');
  }
  if (!(aspect > 0) || !Number.isFinite(aspect) || !(fov > 0 && fov < 180)) throw new Error('3D 화면 크기가 올바르지 않습니다.');
  const target = Object.fromEntries(axes.map(axis => [axis, bounds.min[axis] + (bounds.max[axis] - bounds.min[axis]) / 2]));
  const radius = Math.hypot(...axes.map(axis => (bounds.max[axis] - bounds.min[axis]) / 2)) || 1;
  const vertical = fov * Math.PI / 360, horizontal = Math.atan(Math.tan(vertical) * aspect);
  const distance = radius * 1.15 / Math.sin(Math.min(vertical, horizontal));
  const norm = Math.hypot(1, 0.8, 1);
  const position = {x: target.x + distance / norm, y: target.y + distance * 0.8 / norm, z: target.z + distance / norm};
  return {target, position, radius, distance, near: radius / 1000, far: distance * 10 + radius * 20};
}
