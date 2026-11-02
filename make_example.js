import fs from "node:fs";
import { DrawingEngine } from "./engine.js";
import * as G from "./geometry.js";
import { symbol } from "./symbols.js";
import { plotSVG } from "./plot.js";
const engine = new DrawingEngine();
const layers = [
  ["벽체", "#d6e6ed", 0.35],
  ["문창", "#94d5f3", 0.25],
  ["가구", "#93b6c4", 0.18],
  ["치수", "#e0c599", 0.18],
  ["실명", "#bae5ce", 0.2],
  ["기준선", "#526a7d", 0.13],
];
const ids = {};
for (const [name, color, lineweight] of layers) {
  engine.execute({ type: "layer.add", name, color });
  const layer = engine.doc.layers.at(-1);
  ids[name] = layer.id;
  engine.execute({
    type: "layer.update",
    id: layer.id,
    changes: {
      lineweight,
      linetype: name === "기준선" ? "CENTER" : "CONTINUOUS",
    },
  });
}
const p = (x, y) => ({ x, y }),
  entities = [],
  wall = (a, b, t = 200, openings = []) => {
    const e = {
      type: "wall",
      points: [a, b],
      thickness: t,
      openings,
      layer: ids.벽체,
    };
    entities.push(e);
    for (const points of G.wallPolygons(e))
      entities.push({
        type: "hatch",
        points,
        solid: true,
        spacing: 100,
        angle: 45,
        layer: ids.벽체,
      });
  };
wall(p(0, 0), p(10000, 0), 200, [[0.11, 0.2]]);
wall(p(10000, 0), p(10000, 7000), 200, [[0.7, 0.88]]);
wall(p(10000, 7000), p(0, 7000), 200, [[0.43, 0.67]]);
wall(p(0, 7000), p(0, 0), 200, [[0.25, 0.48]]);
wall(p(6000, 0), p(6000, 7000), 150, [[0.67, 0.8]]);
wall(p(6000, 4000), p(10000, 4000), 150);
entities.push(symbol("DOOR", { width: 900 }, p(1100, 0), 0, ids.문창));
entities.push(symbol("DOOR", { width: 910 }, p(6000, 4690), 90, ids.문창));
entities.push(
  symbol("WINDOW", { width: 2400, depth: 200 }, p(3300, 7000), 0, ids.문창),
);
entities.push(
  symbol("WINDOW", { width: 1260, depth: 200 }, p(10000, 4900), 90, ids.문창),
);
entities.push(
  symbol("WINDOW", { width: 1610, depth: 200 }, p(0, 3640), 90, ids.문창),
);
entities.push(
  symbol(
    "STAIR",
    { width: 1400, run: 280, count: 11 },
    p(7500, 400),
    0,
    ids.가구,
  ),
);
const text = (x, y, value, height = 230) =>
  entities.push({
    type: "text",
    position: p(x, y),
    text: value,
    height,
    rotation: 0,
    layer: ids.실명,
  });
text(0, 8350, "바른 CAD  /  2D 건축 평면", 320);
text(0, 7850, "DXF 편집 예제 · 실제 대지/허가 도면 아님", 170);
text(2300, 4700, "거실 · 주방");
text(2500, 4300, "6,000 × 7,000", 150);
text(7250, 5700, "침실");
text(7000, 5350, "4,000 × 3,000", 150);
text(7750, 1200, "UP", 150);
entities.push({
  type: "block",
  name: "식탁",
  layer: ids.가구,
  entities: [
    {
      type: "rectangle",
      layer: ids.가구,
      points: G.rectangle(p(1800, 2000), p(4000, 3000)),
    },
    ...[2000, 3000].flatMap((x) =>
      [1700, 3000].map((y) => ({
        type: "rectangle",
        layer: ids.가구,
        points: G.rectangle(p(x, y), p(x + 650, y + 300)),
      })),
    ),
  ],
});
entities.push({
  type: "rectangle",
  points: G.rectangle(p(7200, 6100), p(9300, 6700)),
  layer: ids.가구,
});
for (const [a, b, pos, mode] of [
  [p(0, 0), p(10000, 0), p(0, -1000), "horizontal"],
  [p(0, 0), p(6000, 0), p(0, -500), "horizontal"],
  [p(6000, 0), p(10000, 0), p(0, -500), "horizontal"],
  [p(10000, 0), p(10000, 7000), p(11000, 0), "vertical"],
])
  entities.push({
    type: "dimension",
    points: [a, b, pos],
    mode,
    textHeight: 180,
    layer: ids.치수,
  });
for (const x of [0, 6000, 10000])
  entities.push({
    type: "line",
    points: [p(x, -1200), p(x, 7300)],
    layer: ids.기준선,
  });
engine.execute({ type: "addMany", entities });
engine.execute({
  type: "layer.update",
  id: ids.기준선,
  changes: { locked: true },
});
engine.doc.blocks = engine.doc.entities
  .filter((e) => e.type === "block")
  .map((e) => ({ name: e.name, entities: e.entities }))
  .filter((e, i, all) => all.findIndex((x) => x.name === e.name) === i);
engine.validate(engine.doc);
fs.mkdirSync("examples", { recursive: true });
fs.writeFileSync(
  "examples/건축평면_예제.bcad",
  JSON.stringify(engine.doc, null, 2),
);
fs.writeFileSync(
  "examples/건축평면_A3_1-50.svg",
  plotSVG(engine.doc, { denominator: 50, title: "바른 CAD 건축 평면 예제" }),
);
console.log(`Example: ${engine.doc.entities.length} entities`);
