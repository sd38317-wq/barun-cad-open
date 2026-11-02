/* 상세·주동·단위세대 자료를 본 도면과 같은 그리기(view.js drawEntity)로 검은 바탕에 그린다.
   PNG 를 키우거나 배경색만 바꾸지 않는다: 서버에서 받은 자료의 실제 선·색·선종류를 그린다. */
import * as G from './geometry.js';
import {drawEntity,withMaskBackground} from './view.js';

export const PREVIEW_BACKGROUND = '#000000';

/** 검은 바탕 CAD 색: 레이어·객체 색을 그대로 쓰되, ACI 7·검정처럼 바탕에 묻히는 색은 흰색으로. */
export function previewInk(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color || '')) return '#ffffff';
  const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  return Math.max(r, g, b) < 48 ? '#ffffff' : color.toLowerCase();
}

/** 미리보기용 사본: 블록 안 자식까지 previewInk 를 적용한다(drawEntity 는 자식의 자기 색을 쓴다). 원본은 바꾸지 않는다. */
export function previewEntity(e) {
  const ink = previewInk(e._displayColor || e.color);
  const copy = {...e, color: ink, _displayColor: ink};
  if (Array.isArray(e.entities)) copy.entities = e.entities.map(previewEntity);
  return copy;
}

export function assetPreviewEntities(asset) {
  if (Array.isArray(asset?.entities)) return asset.entities;
  return (asset?.scenes || []).flatMap(scene => Array.isArray(scene?.entities) ? scene.entities : []);
}

/** 그릴 범위: 장면 bounds 가 있으면 그것을, 없으면 객체 범위. */
export function assetPreviewBounds(asset, entities = assetPreviewEntities(asset)) {
  const boxes = (asset?.scenes || []).map(scene => scene?.bounds).filter(b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite));
  if (boxes.length) return {minX: Math.min(...boxes.map(b => b[0])), minY: Math.min(...boxes.map(b => b[1])), maxX: Math.max(...boxes.map(b => b[2])), maxY: Math.max(...boxes.map(b => b[3]))};
  const b = entities.length ? G.bounds(entities) : null;
  return b && [b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite) ? b : null;
}

/** 장면 제목 한 줄: 번호 · 제목 · SCALE 1/x (서버 자료는 장면 제목 글자를 빼고 n·title·scale 값만 남긴다). */
export function sceneLabel(scene) {
  const scale = Number(scene?.scale);
  return [scene?.n != null ? String(scene.n) : '', scene?.title || '', Number.isFinite(scale) && scale > 0 ? 'SCALE 1/' + +scale.toFixed(2) : ''].filter(Boolean).join('  ');
}
const boundsOf = b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) ? b : null;

/** canvas 에 자료를 맞춰 그린다. 그린 객체 수를 돌려준다(0 이면 그릴 것이 없음).
    scene: 그 번호의 장면 하나만 크게. labels: 장면 아래 제목(번호·제목·SCALE)을 화면 글자 크기로.
    canvas.sceneRects 에 장면별 화면 사각형을 남긴다(눌러 크게 보기용). */
export function drawAssetPreview(canvas, asset, {padding = 8, pixelRatio = globalThis.devicePixelRatio || 1, scene = null, labels = true} = {}) {
  const width = canvas.clientWidth || canvas.width, height = canvas.clientHeight || canvas.height;
  canvas.width = Math.max(1, Math.round(width * pixelRatio)); canvas.height = Math.max(1, Math.round(height * pixelRatio));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.fillStyle = PREVIEW_BACKGROUND; ctx.fillRect(0, 0, width, height);
  canvas.sceneRects = [];
  const shownAsset = scene == null ? asset : {...asset, entities: undefined, scenes: (asset?.scenes || []).filter(s => s?.n === scene)};
  const entities = assetPreviewEntities(shownAsset), box = assetPreviewBounds(shownAsset, entities);
  if (!entities.length || !box) return 0;
  const titled = labels ? (shownAsset?.scenes || []).filter(s => boundsOf(s?.bounds) && sceneLabel(s)) : [];
  const labelPx = titled.length ? 12 : 0, below = labelPx ? labelPx + 8 : 0;
  const scale = Math.min((width - padding * 2) / Math.max(box.maxX - box.minX, 1e-9), (height - padding * 2 - below) / Math.max(box.maxY - box.minY, 1e-9));
  const ox = (width - (box.maxX - box.minX) * scale) / 2, oy = (height - below - (box.maxY - box.minY) * scale) / 2 + below;
  const screen = p => ({x: ox + (p.x - box.minX) * scale, y: height - oy - (p.y - box.minY) * scale});
  let drawn = 0;
  withMaskBackground(PREVIEW_BACKGROUND, () => {for (const e of entities) {
    try {const shown = previewEntity(e); drawEntity(ctx, shown, screen, scale, shown.color, 1); drawn++;}
    catch {/* 미리보기는 그릴 수 있는 객체만 그린다 */}
  }});
  for (const s of shownAsset?.scenes || []) {
    const b = boundsOf(s?.bounds); if (!b) continue;
    const a = screen({x: b[0], y: b[1]}), c = screen({x: b[2], y: b[3]});
    canvas.sceneRects.push({n: s.n, x0: a.x, y0: c.y, x1: c.x, y1: a.y + below});
  }
  if (labelPx) {
    ctx.save(); ctx.fillStyle = '#e8ebf0'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.font = `600 ${labelPx}px "Barun Drawing Korean","Apple SD Gothic Neo","Malgun Gothic",sans-serif`;
    for (const s of titled) {
      const b = s.bounds, p = screen({x: b[0], y: b[1]}), w = Math.max(40, (b[2] - b[0]) * scale);
      ctx.fillText(sceneLabel(s), p.x, p.y + 4, w);
    }
    ctx.restore();
  }
  return drawn;
}
