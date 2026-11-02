/** Small OCCT 1.1.0 binding helpers; all returned TopoDS wrappers are caller-owned. */
export class OcctScope {
  #objects = [];
  own(obj) { if (obj?.delete) this.#objects.push(obj); return obj; }
  close() {
    for (const obj of this.#objects.reverse()) obj.delete();
    this.#objects = [];
  }
}
export function scoped(fn) {
  const scope = new OcctScope();
  try { return fn(scope); } finally { scope.close(); }
}
export function enumValue(oc, group, name) {
  const value = oc[group]?.[name];
  if (value === undefined) throw new Error('Missing OCCT enum ' + group + '.' + name);
  return value;
}
export function assertKernel(oc) {
  const symbols = ['gp_Pnt', 'gp_Vec', 'gp_Dir', 'gp_Pln', 'gp_Ax2',
    'BRepBuilderAPI_MakeEdge', 'BRepBuilderAPI_MakeWire', 'BRepBuilderAPI_MakeFace',
    'BRepPrimAPI_MakePrism', 'BRepPrimAPI_MakeHalfSpace', 'BRepAlgoAPI_Cut',
    'BRepAlgoAPI_Fuse', 'BRepAlgoAPI_Common', 'BRepAlgoAPI_Section',
    'TopExp_Explorer', 'TopLoc_Location', 'TopoDS', 'BRep_Tool', 'BRepAdaptor_Curve', 'BRepAdaptor_Surface', 'BRepTools', 'BRepLib',
    'BRepCheck_Analyzer', 'GProp_GProps', 'BRepGProp', 'HLRBRep_Algo',
    'HLRBRep_HLRToShape', 'HLRAlgo_Projector', 'STEPControl_Writer', 'Message_ProgressRange'];
  const missing = symbols.filter(name => !oc[name]);
  if (missing.length) throw new Error('OCCT binding missing: ' + missing.join(', '));
}
export function validShape(oc, shape, label = 'shape') {
  if (shape.IsNull()) throw new Error(label + ': null OCCT shape');
  scoped(s => {
    const checker = s.own(new oc.BRepCheck_Analyzer(shape, true, false, false));
    if (!checker.IsValid()) throw new Error(label + ': invalid OCCT topology');
  });
  return shape;
}
export function wireFromPoints(oc, points) {
  return scoped(s => {
    const wire = s.own(new oc.BRepBuilderAPI_MakeWire());
    for (let i = 0; i < points.length; i++) {
      const a = s.own(new oc.gp_Pnt(...points[i]));
      const b = s.own(new oc.gp_Pnt(...points[(i + 1) % points.length]));
      const builder = s.own(new oc.BRepBuilderAPI_MakeEdge(a, b));
      if (!builder.IsDone()) throw new Error('Cannot construct edge');
      wire.Add(s.own(builder.Edge()));
    }
    if (!wire.IsDone()) throw new Error('Cannot construct closed wire');
    return wire.Wire();
  });
}
export function prism(oc, outline, holes, bottom, height) {
  return scoped(s => {
    const outer = s.own(wireFromPoints(oc, outline.map(([x,y]) => [x,y,bottom])));
    const faceBuilder = s.own(new oc.BRepBuilderAPI_MakeFace(outer, true));
    for (const hole of holes) {
      // Normalized input holes are clockwise, opposite to the outer boundary.
      faceBuilder.Add(s.own(wireFromPoints(oc, hole.map(([x,y]) => [x,y,bottom]))));
    }
    if (!faceBuilder.IsDone()) throw new Error('Cannot construct planar face');
    const face = s.own(faceBuilder.Face());
    const vector = s.own(new oc.gp_Vec(0, 0, height));
    const builder = s.own(new oc.BRepPrimAPI_MakePrism(face, vector, false, true));
    return builder.Shape();
  });
}
export function booleanShape(oc, operation, left, right) {
  return scoped(s => {
    const progress = s.own(new oc.Message_ProgressRange());
    const builder = s.own(new oc['BRepAlgoAPI_' + operation](left, right, progress));
    if (!builder.IsDone()) throw new Error('OCCT ' + operation + ' failed');
    builder.SimplifyResult(true, true, 1e-9);
    return builder.Shape();
  });
}
export function fuseShapes(oc, shapes) {
  if (!shapes.length) throw new Error('Empty solid selection');
  // A new wrapper keeps ownership separate from the element wrappers.
  let combined = scoped(s => shapes[0].Moved(s.own(new oc.TopLoc_Location()), false));
  try {
    for (const shape of shapes.slice(1)) {
      const next = booleanShape(oc, 'Fuse', combined, shape);
      combined.delete(); combined = next;
    }
    return combined;
  } catch (error) { combined.delete(); throw error; }
}
export function forSubshapes(oc, shape, type, fn) {
  return scoped(s => {
    const exp = s.own(new oc.TopExp_Explorer(shape,
      enumValue(oc, 'TopAbs_ShapeEnum', type),
      enumValue(oc, 'TopAbs_ShapeEnum', 'TopAbs_SHAPE')));
    while (exp.More()) {
      const generic = exp.Current();
      try { fn(generic); } finally { generic.delete(); }
      exp.Next();
    }
  });
}
/** Exact bounds for this adapter's planar polygon prisms, measured from OCCT vertices. */
export function solidBounds(oc, shape) {
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  forSubshapes(oc, shape, 'TopAbs_VERTEX', generic => scoped(s => {
    const vertex = s.own(oc.TopoDS.Vertex(generic));
    const point = s.own(oc.BRep_Tool.Pnt(vertex));
    const values = [point.X(),point.Y(),point.Z()];
    values.forEach((v,i) => { min[i] = Math.min(min[i],v); max[i] = Math.max(max[i],v); });
  }));
  if (!min.every(Number.isFinite)) throw new Error('Shape has no finite vertices');
  return { min, max };
}
export function solidVolume(oc, shape) {
  return scoped(s => {
    const props = s.own(new oc.GProp_GProps());
    oc.BRepGProp.VolumeProperties(shape, props, true, false, false);
    return props.Mass();
  });
}
