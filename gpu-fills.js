// GPU hatch/solid fill bridge.  Geometry is kept in the same local frame as the
// other GPU primitives so large drawing coordinates do not lose precision.
import {THREE, AcGeArea2d, AcGePolyline2d} from './vendor/mlightcad.js';
import {hatchFamilies} from './hatch-patterns.js';

const emptyHatch = () => { const group = new THREE.Group(); group.userData.barunEmpty = true; return group; };
const finite = n => Number.isFinite(Number(n));
const point = (p, shift) => ({x: Number(p?.x ?? p?.[0]) - shift.x, y: Number(p?.y ?? p?.[1]) - shift.y});

// Definition offsets are already in the pattern line's local frame here.
// Repetition spacing is the perpendicular component, not the vector length.
// Dash phase belongs to the nearest repeated line, not the fragment's Y:
// continuous Y shears each dash across its stroke width when offset.x is large.
export function correctGpuHatchPattern(material) {
  if (!material?.uniforms?.u_patternLines || material.userData?.barunHatchPatternCorrected) return;
  const shader = material.fragmentShader;
  const spacing = 'float distanceBetweenLines = length(offset);';
  const phase = 'offsetX = samplePos.y * offset.x / offset.y;';
  if (typeof shader !== 'string' || !shader.includes(spacing) || !shader.includes(phase)) {
    throw new Error('Unsupported GPU hatch shader: pattern correction anchors missing');
  }
  material.fragmentShader = shader
    .replace(spacing, 'float distanceBetweenLines = abs(offset.y);')
    // Match hatchSegments' degenerate-family guard. Rotation can leave tiny
    // nonzero roundoff where the repetition vector is parallel to the line.
    .replaceAll('float distanceBetweenLines = abs(offset.y);',
      'float distanceBetweenLines = abs(offset.y); if (distanceBetweenLines <= 1e-9) return 0.0;')
    .replace(phase, 'offsetX = floor(samplePos.y / offset.y + 0.5) * offset.x;');
  material.userData = {...material.userData, barunHatchPatternCorrected: true};
  material.needsUpdate = true;
}

function loopFrom(value, shift) {
  const raw = Array.isArray(value) ? value : value?.points || value?.vertices || value?.path;
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const vertices = raw.map(p => {
    const q = point(p, shift);
    return {x: q.x, y: q.y, ...(finite(p?.bulge) ? {bulge: Number(p.bulge)} : {})};
  });
  if (vertices.some(p => !finite(p.x) || !finite(p.y))) return null;
  return new AcGePolyline2d(vertices, value?.closed !== false);
}

function loopsOf(entity, shift) {
  const outer = loopFrom({points: entity?.points, closed: true}, shift);
  // A hatch without a usable outer boundary fills nothing on the canvas: draw nothing, keep the drawing on the GPU.
  if (!outer) return [];
  const source = entity?.loops || entity?.boundaryPaths || entity?.boundaries || entity?.paths || [];
  const values = Array.isArray(source) ? source : source?.loops || [];
  // An unusable hole path adds no area to the canvas' even-odd fill: leave just that hole out.
  const holes = values.map(v => loopFrom(v, shift)).filter(Boolean);
  return [outer, ...holes];
}

function setHatchStyle(renderer, entity, shift) {
  const style = renderer.subEntityTraits.fillType;
  const families = hatchFamilies(entity);
  style.solidFill = !!entity?.solid;
  style.patternAngle = 0;
  style.definitionLines = families.map(line => ({
    angle: Number(line.angle || 0) * Math.PI / 180,
    base: point(line.base || {x: 0, y: 0}, shift),
    offset: {x: Number(line.offset?.x || 0), y: Number(line.offset?.y || 0)},
    dashLengths: (line.dashes || []).map(Number).filter(Number.isFinite),
  }));
}

/** Build one native MLightCAD area drawable for a hatch entity. */
export function createGpuHatch(renderer, entity, {x = 0, y = 0} = {}, order = 0) {
  if (!renderer || !entity) return emptyHatch();
  const shift = {x: Number(x) || 0, y: Number(y) || 0};
  const loops = loopsOf(entity, shift);
  if (!loops.length) return emptyHatch();
  const area = new AcGeArea2d();
  loops.forEach(loop => area.add(loop));
  setHatchStyle(renderer, entity, shift);
  renderer.subEntityTraits.drawOrder = Number(order) || 0;
  const object = renderer.area(area);
  if (object) {
    object.traverse(child => {
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) correctGpuHatchPattern(material);
    });
    object.renderOrder = Number(order) || 0;
    if (entity.solid) object.traverse(child => {
      if (!child.material) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      const cloned = materials.map(material => {
        const copy = material.clone();
        // 가리기(WIPEOUT)는 뒤를 덮어야 하므로 불투명. 보통 채움 해치는 예전처럼 옅게.
        copy.transparent = !entity.wipeout;
        copy.opacity = entity.wipeout ? 1 : 0.22;
        copy.userData = {...(copy.userData || {}), barunOwnedMaterial: true};
        return copy;
      });
      child.material = Array.isArray(child.material) ? cloned : cloned[0];
    });
  }
  return object || emptyHatch();
}

/** Dispose per-object geometry; materials are owned by the renderer/style manager. */
export function disposeGpuObject(object) {
  if (!object?.traverse) return;
  object.traverse(child => {
    if (child.geometry?.dispose) child.geometry.dispose();
  });
}
