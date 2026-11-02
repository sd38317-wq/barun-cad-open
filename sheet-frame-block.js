// One immutable paper-mm definition, with per-sheet attribute values.
export function sameSheetFrameDefinition(doc, expected, actual) {
  if (Number(actual.origin?.x || 0) !== 0 || Number(actual.origin?.y || 0) !== 0) return false;
  const layerName = id => doc.layers.find(l => l.id === id)?.name || id;
  const n = v => Math.round(Number(v || 0) * 1e6) / 1e6;
  const point = p => p && [n(p.x), n(p.y)];
  const shape = e => ({type: e.type, layer: layerName(e.layer), points: e.points?.map(point), position: point(e.position),
    text: e.type === 'text' ? (e.attdef ? '' : e.text) : undefined,
    attdef: e.attdef && [e.attdef.tag, e.attdef.default || '', !!e.attdef.constant, !!e.attdef.invisible, !!e.attdef.verify, !!e.attdef.preset], height: e.height === undefined ? undefined : n(e.height),
    align: e.type === 'text' ? e.align || 'left' : undefined, rotation: n(e.rotation),
    width: e.type === 'text' ? n(e.widthFactor ?? 1) : undefined,
    color: e.color?.toLowerCase(), lineweight: e.lineweight === undefined ? undefined : n(e.lineweight)});
  return JSON.stringify(expected.map(shape)) === JSON.stringify(actual.entities.map(shape));
}

export function sheetFrameBlock(g, render, geometry, {at, k, fields, template, paper}) {
  const entities = [], attributes = {}, P = ([x, y]) => ({x, y});
  const text = (p, value, height, layer, extra = {}) => entities.push({type: 'text', position: P(p), text: String(value), height, layer, ...extra});
  const local = {
    line: (a, b, layer, extra = {}) => entities.push({type: 'line', points: [P(a), P(b)], layer, ...extra}),
    fill: (points, layer, color) => entities.push({type: 'hatch', points: points.map(P), layer, color, solid: true, pattern: 'solid', spacing: 1, angle: 0}),
    text,
    attribute: (tag, p, value, height, layer, extra = {}) => {
      tag = String(tag).replace(/[^a-z0-9_]/gi, '_').toUpperCase();
      attributes[tag] = String(value ?? '');
      text(p, '', height, layer, {...extra, attdef: {tag, default: '', prompt: tag}});
    },
  };
  render(local, {at: {x: 0, y: 0}, k: 1, fields, template, paper});
  // Values never affect the definition identity or the positions of its children.
  const signature = JSON.stringify({paper, template, entities});
  let hash = 2166136261;
  for (const ch of signature) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  const name = `바른도곽_${paper}_${template.style || '표준'}_${hash.toString(16)}`;
  g.block({name, entities, signature}, {type: 'block', name, sharedBlock: name, position: {...at}, scale: k, rotation: 0, layer: template.frameLayer, attributes, entities: [], sheetFrame: true, sheetTitleChars: Math.floor((template.titleWidth - (template.style === 'air' ? 8 : 4)) / ((template.style === 'air' ? 4.2 : template.rows.find(r => r.key === 'title')?.size || 4.2) * 0.95))});
  const geo = geometry(template, paper);
  const placed = b => ({minX: at.x + b.minX * k, minY: at.y + b.minY * k, maxX: at.x + b.maxX * k, maxY: at.y + b.maxY * k});
  return {bounds: placed({minX: 0, minY: 0, maxX: geo.W, maxY: geo.H}), draw: placed(geo.draw)};
}
