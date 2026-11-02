using ACadSharp;
using ACadSharp.Entities;
using ACadSharp.Objects;
using ACadSharp.Objects.Evaluations;
using ACadSharp.Tables;
using CSMath;

var doc = new CadDocument();
var block = new BlockRecord("A-DYNAMIC-TEST");
var line = new Line(new XYZ(2, 1, 0), new XYZ(4, 1, 0));
block.Entities.Add(line);
block.CreateExtendedDictionary();
var graph = new EvaluationGraph();
block.XDictionary.Add("ACAD_ENHANCEDBLOCK", graph);
void Add(EvaluationExpression expression) { var node = graph.CreateNode(); node.Expression = expression; }
Add(new BlockLinearParameter { Id = 1, Label = "길이", FirstPoint = new XYZ(0, 0, 0), SecondPoint = new XYZ(10, 0, 0) });
Add(new BlockFlipParameter { Id = 2, Label = "대칭", BaseStateName = "원래", FlippedStateName = "뒤집기", FirstPoint = new XYZ(3, 4, 0), SecondPoint = new XYZ(3, 9, 0) });
var flip = new BlockFlipAction { Id = 12, FlipConnection = new EvalConnection { Id = 2, Name = "Flip" } }; flip.Entities.Add(line); Add(flip);
Add(new BlockRotationParameter { Id = 3, Label = "각도", FirstPoint = new XYZ(10, 20, 0), SecondPoint = new XYZ(10, 25, 0), Point = new XYZ(15, 20, 0) });
var rotate = new BlockRotationAction { Id = 13, AngleDeltaConnection = new EvalConnection { Id = 3, Name = "AngleDelta" }, BasePoint = new XYZ(10, 20, 0) }; rotate.Entities.Add(line); Add(rotate);
var xy = new BlockXYParameter { Id = 4, ElementName = "이동 거리", BaseLocation = LinearParameterBaseLocation.MiddlePoint, LabelX = "가로", LabelY = "세로", FirstPoint = new XYZ(2, 3, 0), SecondPoint = new XYZ(12, -7, 0) }; Add(xy);
var move = new BlockMoveAction { Id = 14, XDeltaConnection = new EvalConnection { Id = 4, Name = "EndXDelta" }, YDeltaConnection = new EvalConnection { Id = 4, Name = "EndYDelta" }, DistanceMultiplier = 1 }; move.Entities.Add(line); Add(move);
var stretch = new BlockStretchAction { Id = 15, EndXDeltaConnection = new EvalConnection { Id = 4, Name = "EndXDelta" }, EndYDeltaConnection = new EvalConnection { Id = 4, Name = "EndYDelta" }, DistanceMultiplier = 1 }; Add(stretch);
Add(new BlockLookupParameter { Id = 5, Label = "규격" });
var insert = new Insert(block);
doc.BlockRecords.Add(block);
insert.CreateExtendedDictionary();
var representation = new CadDictionary(); insert.XDictionary.Add("AcDbBlockRepresentation", representation);
representation.Add("AcDbRepData", new BlockRepresentationData { Block = block });
var cache = new CadDictionary(); representation.Add("AppDataCache", cache);
var data = new CadDictionary(); cache.Add("ACAD_ENHANCEDBLOCKDATA", data);
void Record(string key, params (int code, object value)[] entries) { var record = new XRecord(); foreach (var entry in entries) record.CreateEntry(entry.code, entry.value); data.Add(key, record); }
Record("1", (10, new XYZ(0, 0, 0)), (10, new XYZ(30, 40, 0)));
Record("2", (70, (short)1), (10, new XYZ(3, 4, 0)), (10, new XYZ(3, 9, 0)));
Record("3", (10, new XYZ(10, 20, 0)), (10, new XYZ(5, 20, 0)), (10, new XYZ(0, 0, 0)), (10, new XYZ(0, 0, 0)));
Record("4", (10, new XYZ(2, 3, 0)), (10, new XYZ(-18, 33, 0)));
doc.Entities.Add(insert);
DynBlocks.Write(doc, args[0]);

// Redefined nodes retain old keys, whose parameter kinds are no longer provable.
data.Clear();
Record("91", (10, new XYZ(10, 20, 0)), (10, new XYZ(5, 20, 0)));
Record("92", (10, new XYZ(2, 3, 0)), (10, new XYZ(-18, 33, 0)));
Record("5", (10, new XYZ(0, 0, 0)), (10, new XYZ(30, 40, 0)));
Record("93", (1, "unknown text"));
DynBlocks.Write(doc, args[0] + ".stale");

move.XDeltaConnection = new EvalConnection { Id = -1, Name = "EndXDelta" };
stretch.EndXDeltaConnection = new EvalConnection { Id = 4, Name = "" };
xy.LabelY = "";
DynBlocks.Write(doc, args[0] + ".yonly");
xy.ElementName = " ";
DynBlocks.Write(doc, args[0] + ".unnamed");

DynBlocks.Write(new CadDocument(), args[0] + ".empty");
data.Clear();
DynBlocks.Write(doc, args[0] + ".missing");
Record("3", (10, new XYZ(10, 20, 0)), (10, new XYZ(10, 20, 0)));
DynBlocks.Write(doc, args[0] + ".invalid");

rotate.UpdateBaseXConnection = new EvalConnection { Id = 4, Name = "EndX" };
flip.UpdatedBaseConnection = new EvalConnection { Id = 4, Name = "End" };
DynBlocks.Write(doc, args[0] + ".linked");
