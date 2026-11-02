import { test } from "node:test";
import assert from "node:assert/strict";
import { DrawingEngine } from "./engine.js";
import * as G from "./geometry.js";
import { symbol } from "./symbols.js";
import { plotSVG } from "./plot.js";

test('shared DWG blocks expand with insertion, scale and rotation',()=>{
 const doc={version:2,units:'mm',layers:[{id:'default',name:'0',color:'#ffffff',visible:true}],blocks:[],entities:[{id:'i',type:'block',name:'chair',layer:'default',sharedBlock:'chair',position:{x:100,y:200},scale:2,rotation:90,entities:[]}],sharedBlocks:{chair:{origin:{x:0,y:0},entities:[{id:'source',type:'line',layer:'default',points:[{x:0,y:0},{x:10,y:0}]}]}}};
 G.expandSharedDrawingBlocks(doc);new DrawingEngine().validate(doc);
 assert.equal(doc.sharedBlocks,undefined);assert.equal(doc.entities[0].entities.length,1);
 const [a,b]=doc.entities[0].entities[0].points;assert.ok(Math.abs(a.x-100)<1e-9&&Math.abs(a.y-200)<1e-9);assert.ok(Math.abs(b.x-100)<1e-9&&Math.abs(b.y-220)<1e-9);
});
import {
  defaultAliases,
  defaultHotkeys,
  resolveCommand,
  validateSettings,
  classifyInput,
  parsePoint,
} from "./commands.js";
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`),
  line = (a, b) => ({ type: "line", layer: "default", points: [a, b] }),
  p = (x, y) => ({ x, y });
test("COPY preserves original, creates independent IDs, undo and redo are atomic", () => {
  const e = new DrawingEngine();
  const [id] = e.execute({ type: "add", entity: line(p(0, 0), p(5000, 0)) });
  const [copy] = e.execute({ type: "copy", ids: [id], dx: 250, dy: 125.5 });
  assert.notEqual(id, copy);
  assert.deepEqual(e.doc.entities[0].points[0], p(0, 0));
  assert.deepEqual(e.doc.entities[1].points[1], p(5250, 125.5));
  e.execute({ type: "undo" });
  assert.equal(e.doc.entities.length, 1);
  e.execute({ type: "redo" });
  assert.equal(e.doc.entities.length, 2);
});
test("rotate, uniform scale and mirrored arcs preserve metric geometry", () => {
  const source = {
    type: "arc",
    center: p(10, 20),
    radius: 500,
    startAngle: 0,
    endAngle: 90,
    layer: "default",
  };
  const a = G.rotate(source, p(0, 0), 90);
  near(a.center.x, -20);
  near(a.center.y, 10);
  near(a.startAngle, 90);
  const b = G.resize(a, p(0, 0), 2);
  near(b.radius, 1000);
  const c = G.mirror(source, p(0, 0), p(1, 0));
  near(c.center.y, -20);
  assert.ok(G.angleOnArc(-45, c.startAngle, c.endAngle));
  assert.ok(!G.angleOnArc(45, c.startAngle, c.endAngle));
});
test("rotated linear dimension measures same projected length", () => {
  const e = {
    type: "dimension",
    layer: "default",
    mode: "horizontal",
    points: [p(0, 0), p(3000, 4000), p(0, -500)],
    textHeight: 100,
  };
  assert.equal(G.dimensionParts(e).at(-1).text, "3000");
  const r = G.rotate(e, p(0, 0), 37);
  assert.equal(G.dimensionParts(r).at(-1).text, "3000");
});
test("OFFSET exact square, circle collapse rejected and concave limits explicit", () => {
  const e = {
    type: "rectangle",
    points: G.rectangle(p(0, 0), p(1000, 800)),
    layer: "default",
  };
  const out = G.offsetEntity(e, 100, p(500, -200));
  assert.deepEqual(G.bounds([out]), {
    minX: -100,
    minY: -100,
    maxX: 1100,
    maxY: 900,
  });
  const inside = G.offsetEntity(e, 100, p(500, 50));
  assert.deepEqual(G.bounds([inside]), {
    minX: 100,
    minY: 100,
    maxX: 900,
    maxY: 700,
  });
  assert.throws(() => G.offsetEntity(e, 600, p(500, 50)));
  assert.throws(() =>
    G.offsetEntity(
      { type: "circle", center: p(0, 0), radius: 50 },
      100,
      p(0, 0),
    ),
  );
});
test("TRIM removes selected middle interval; EXTEND selects nearest forward boundary", () => {
  const target = line(p(0, 0), p(1000, 0)),
    boundaries = [line(p(200, -50), p(200, 50)), line(p(700, -50), p(700, 50))];
  const result = G.cutLine(target, boundaries, p(500, 0));
  assert.equal(result.length, 2);
  near(result[0].points[1].x, 200);
  near(result[1].points[0].x, 700);
  const extended = G.cutLine(
    target,
    [line(p(1500, -100), p(1500, 100)), line(p(1700, -100), p(1700, 100))],
    p(950, 0),
    true,
  );
  near(extended[0].points[1].x, 1500);
});
test("layer lock, invalid transform and failed batch leave document and history intact", () => {
  const e = new DrawingEngine();
  const [id] = e.execute({ type: "add", entity: line(p(0, 0), p(100, 0)) });
  const old = JSON.stringify(e.doc);
  assert.throws(() =>
    e.execute({
      type: "batch",
      commands: [
        { type: "move", ids: [id], dx: 5, dy: 0 },
        { type: "scale", ids: [id], base: p(0, 0), factor: 0 },
      ],
    }),
  );
  assert.equal(JSON.stringify(e.doc), old);
  e.execute({ type: "layer.update", id: "default", changes: { locked: true } });
  assert.throws(() => e.execute({ type: "copy", ids: [id], dx: 1, dy: 0 }));
});
test("blocks, insertion, explode, join and rectangular arrays are editable", () => {
  const e = new DrawingEngine();
  const [a] = e.execute({ type: "add", entity: line(p(0, 0), p(100, 0)) });
  const [b] = e.execute({ type: "add", entity: line(p(100, 0), p(100, 100)) });
  const [joined] = e.execute({ type: "join", ids: [a, b] });
  assert.equal(e.doc.entities[0].points.length, 3);
  const [block] = e.execute({
    type: "block.create",
    ids: [joined],
    name: "corner",
    base: p(0, 0),
  });
  const [insert] = e.execute({
    type: "block.insert",
    name: "corner",
    layer: "default",
    position: p(500, 500),
  });
  near(e.bounds([e.doc.entities.find((x) => x.id === insert)]).minX, 500);
  e.execute({
    type: "array",
    ids: [block],
    rows: 2,
    columns: 3,
    dx: 1000,
    dy: 2000,
  });
  assert.equal(e.doc.entities.length, 7);
  e.execute({ type: "explode", ids: [insert] });
  assert.equal(e.doc.entities.filter((x) => x.type === "polyline").length, 1);
});
test("wall openings preserve disjoint wall lengths; symbols have real arcs/lines", () => {
  const e = new DrawingEngine();
  const [id] = e.execute({
    type: "add",
    entity: {
      type: "wall",
      points: [p(0, 0), p(5000, 0)],
      thickness: 200,
      openings: [],
      layer: "default",
    },
  });
  e.execute({ type: "wall.opening", id, width: 900, position: p(2500, 0) });
  const polys = G.wallPolygons(e.doc.entities[0]);
  near(
    polys.reduce((a, p) => a + G.polygonArea(p), 0),
    4100 * 200,
  );
  e.execute({ type: "undo" });
  assert.equal(e.doc.entities[0].openings.length, 0);
  const door = symbol("DOOR", { width: 900 }, p(200, 300), 90, "default");
  assert.equal(door.entities.filter((e) => e.type === "arc").length, 1);
  near(door.entities.find((e) => e.type === "arc").radius, 900);
});
test("C=copy, CI=circle, custom aliases persist and collisions are rejected", () => {
  const settings = {
    version: 1,
    aliases: defaultAliases(),
    hotkeys: defaultHotkeys(),
  };
  validateSettings(settings);
  assert.equal(resolveCommand("c", settings), "COPY");
  assert.equal(resolveCommand("CI", settings), "CIRCLE");
  assert.equal(resolveCommand("circle", settings), "CIRCLE");
  const bad = structuredClone(settings);
  bad.aliases.CIRCLE = "C";
  assert.throws(() => validateSettings(bad));
  const custom = structuredClone(settings);
  custom.aliases.COPY = "CP";
  const loaded = validateSettings(JSON.parse(JSON.stringify(custom)));
  assert.equal(resolveCommand("CP", loaded), "COPY");
});
test("text and block names never dispatch aliases; coordinate and numeric stages remain separate", () => {
  const settings = { aliases: defaultAliases() };
  assert.deepEqual(classifyInput("COPY", "text", settings), {
    kind: "text",
    value: "COPY",
  });
  assert.deepEqual(classifyInput("C", "name", settings), {
    kind: "text",
    value: "C",
  });
  // 좌표 단계에서는 편집 명령이 끼어들지 않고(값으로 돌려주며 겹친 명령을 알림) 투명 명령(ZOOM)만 실행된다.
  assert.deepEqual(classifyInput("C", "point", settings), {
    kind: "value",
    value: "C",
    blockedCommand: "COPY",
  });
  assert.deepEqual(classifyInput("Z", "point", settings), { kind: "command", value: "ZOOM" });
  assert.deepEqual(classifyInput("C", "select", settings), { kind: "command", value: "COPY" });
  assert.deepEqual(parsePoint("@3000,0", p(100, 200)), p(3100, 200));
  const p2 = parsePoint("@3000<90", p(100, 200));
  near(p2.x, 100);
  near(p2.y, 3200);
  assert.throws(() => parsePoint("@1,2"));
});
test("legacy .bcad v1 migration preserves drawing and adds v2 fields", () => {
  const e = new DrawingEngine();
  e.execute({
    type: "load",
    document: {
      version: 1,
      units: "mm",
      layers: [
        { id: "default", name: "기본", visible: true, color: "#79d4ff" },
      ],
      entities: [{ ...line(p(0, 0), p(1000, 0)), id: "old" }],
    },
  });
  assert.equal(e.doc.version, 2);
  assert.equal(e.doc.entities[0].id, "old");
  assert.deepEqual(e.doc.blocks, []);
});
test("FILLET and CHAMFER trim two lines to exact corner dimensions", () => {
  const a = line(p(1000, 0), p(0, 0)),
    b = line(p(0, 0), p(0, 1000));
  const f = G.corner(a, b, 100);
  assert.equal(f.length, 3);
  near(f[2].radius, 100);
  near(f[2].center.x, 100);
  near(f[2].center.y, 100);
  near(G.dist(...f[0].points), 900);
  const c = G.corner(a, b, 200, true);
  near(G.dist(...c[2].points), Math.sqrt(2) * 200);
  assert.throws(() => G.corner(a, b, 2000));
});
test("STRETCH moves specified vertices and retains other points", () => {
  const e = new DrawingEngine(),
    [id] = e.execute({
      type: "add",
      entity: {
        type: "rectangle",
        points: G.rectangle(p(0, 0), p(1000, 800)),
        layer: "default",
      },
    });
  e.execute({
    type: "stretch",
    targets: [{ id, indices: [1, 2] }],
    dx: 500,
    dy: 0,
  });
  assert.equal(e.doc.entities[0].type, "polyline");
  assert.deepEqual(e.doc.entities[0].points[0], p(0, 0));
  assert.deepEqual(e.doc.entities[0].points[2], p(1500, 800));
  e.execute({ type: "undo" });
  assert.equal(e.doc.entities[0].type, "rectangle");
});
test("SVG plot uses real paper millimetres and rejects drawings exceeding scale", () => {
  const e = new DrawingEngine();
  e.execute({ type: "add", entity: line(p(0, 0), p(10000, 0)) });
  const svg = plotSVG(e.doc, { denominator: 50 });
  assert.match(svg, /width="420mm"/);
  assert.match(svg, /scale\(0.02\)/);
  assert.throws(() => plotSVG(e.doc, { paper: "A4", denominator: 10 }));
});
test("ellipses retain centre, axis ratio and reflection geometry", () => {
  const e = {
    type: "ellipse",
    center: p(0, 0),
    majorAxis: p(1000, 0),
    ratio: 0.5,
    startParam: 0,
    endParam: Math.PI * 2,
  };
  const transformed = G.rotate(G.resize(e, p(0, 0), 2), p(0, 0), 90);
  near(G.len(transformed.majorAxis), 2000);
  near(transformed.majorAxis.y, 2000);
  assert.equal(transformed.ratio, 0.5);
  near(G.entityDistance(transformed, p(0, 2000)), 0);
});
test("hotkey modifiers are canonicalized and equivalent bindings conflict", () => {
  const s = {
    version: 1,
    aliases: defaultAliases(),
    hotkeys: { COPY: "Shift+Ctrl+C", CIRCLE: "Ctrl+Shift+C" },
  };
  assert.throws(() => validateSettings(s));
  delete s.hotkeys.CIRCLE;
  assert.equal(validateSettings(s).hotkeys.COPY, "CTRL+SHIFT+C");
});


test('경사로 높이 미입력은 퍼센트를 만들지 않고 검토 입력을 null로 남긴다',async()=>{
 const {architecture}=await import('./architecture.js');const ramp=architecture('RAMP',{width:1200,depth:6000});assert.equal(ramp.reviewInput.riseMm,null);assert.ok(ramp.entities.some(e=>e.text==='경사 — (높이 입력 필요)'));assert.ok(!ramp.entities.some(e=>e.text?.includes('%')));
 const entered=architecture('RAMP',{width:1200,depth:6000,rise:300});assert.equal(entered.reviewInput.riseMm,300);assert.ok(entered.entities.some(e=>e.text==='경사 5%'));assert.throws(()=>architecture('RAMP',{rise:0}));
});
