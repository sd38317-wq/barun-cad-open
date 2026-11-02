using ACadSharp;
using ACadSharp.Blocks;
using ACadSharp.Entities;
using ACadSharp.Objects;
using ACadSharp.Objects.Evaluations;
using ACadSharp.Tables;
using System.Text.Json;

// AutoCAD dynamic blocks (--dyn-blocks path).
// DXF writers do not carry the evaluation graph of a dynamic block, so the
// importer only sees the anonymous *U block of each reference (its current
// shape). This writes, next to the DXF:
//   defs[name]   = the parameters and actions of every dynamic block definition
//                  (ACAD_ENHANCEDBLOCK in the block record's extension dictionary)
//   inserts[hex] = for each reference, its source definition and the current
//                  parameter values stored in AcDbBlockRepresentation
// Entities are referred to by handle (hex), which the DXF keeps.
// Parameters: linear, visibility, flip, rotation and XY; lookup remains unsupported.
// Anything else is listed in "unsupported" so the importer can say so.
static class DynBlocks{
 static string Hex(IHandledCadObject? o)=>o==null?"":o.Handle.ToString("X");
 static object Pt(CSMath.XYZ p)=>new{x=p.X,y=p.Y};
 static object Pt2(CSMath.XY p)=>new{x=p.X,y=p.Y};
 static bool Connected(EvalConnection? c)=>c!=null&&c.Id>=0&&!string.IsNullOrWhiteSpace(c.Name);
 static object? Connection(EvalConnection? c)=>Connected(c)?new{id=c!.Id,name=c.Name}:null;
 static EvalConnection? FirstConnection(EvalConnection? x,EvalConnection? y)=>Connected(x)?x:Connected(y)?y:null;
 static object? ValueSet(ParameterValueSet? set)=>set==null?null:new{type=set.Type.ToString(),min=set.Minimum,max=set.Maximum,increment=set.Increment,list=set.AllowedValues};
 static double? Angle(CSMath.XYZ first,CSMath.XYZ second){
  var dx=second.X-first.X;var dy=second.Y-first.Y;
  return double.IsFinite(dx)&&double.IsFinite(dy)&&(dx!=0||dy!=0)?Math.Atan2(dy,dx):null;
 }
 static T? Entry<T>(CadDictionary? d,string key) where T:NonGraphicalObject=>d!=null&&d.ContainsKey(key)?d[key] as T:null;

 public static int Write(CadDocument doc,string path){
  var defs=new Dictionary<string,object>();var unsupported=new SortedDictionary<string,int>();
  Dictionary<string,Dictionary<string,BlockParameter>>? parameterTypes=null;
  foreach(var record in doc.BlockRecords){
   var graph=Entry<EvaluationGraph>(record.XDictionary,"ACAD_ENHANCEDBLOCK");
   if(graph==null)continue;
   var parameters=new List<object>();var actions=new List<object>();var unhandled=new HashSet<string>();
   var types=new Dictionary<string,BlockParameter>();
   void Unsupported(string name){unsupported[name]=unsupported.GetValueOrDefault(name)+1;unhandled.Add(name);}
   foreach(var node in graph.Nodes){
    if(node.Expression is BlockParameter parameter)types[parameter.Id.ToString(System.Globalization.CultureInfo.InvariantCulture)]=parameter;
    switch(node.Expression){
     case BlockLinearParameter p:{
      var set=p.ValueSet;
      parameters.Add(new{id=p.Id,kind="linear",label=p.Label,p1=Pt(p.FirstPoint),p2=Pt(p.SecondPoint),baseLocation=p.BaseLocation.ToString(),
       value=Math.Sqrt(Math.Pow(p.SecondPoint.X-p.FirstPoint.X,2)+Math.Pow(p.SecondPoint.Y-p.FirstPoint.Y,2)),
       valueSet=set==null?null:new{type=set.Type.ToString(),min=set.Minimum,max=set.Maximum,increment=set.Increment,list=set.AllowedValues}});
      break;}
     case BlockFlipParameter p:
      parameters.Add(new{id=p.Id,kind="flip",label=p.Label,p1=Pt(p.FirstPoint),p2=Pt(p.SecondPoint),value=0,labels=new[]{p.BaseStateName,p.FlippedStateName}});
      break;
     case BlockRotationParameter p:
      parameters.Add(new{id=p.Id,kind="rotation",label=p.Label,p1=Pt(p.FirstPoint),p2=Pt(p.SecondPoint),point=Pt(p.Point),value=Angle(p.FirstPoint,p.SecondPoint),valueSet=ValueSet(p.ValueSet)});
      break;
     case BlockXYParameter p:
      parameters.Add(new{id=p.Id,kind="xy",label=string.IsNullOrWhiteSpace(p.ElementName)?"가로·세로":p.ElementName,labelX=p.LabelX,labelY=p.LabelY,p1=Pt(p.FirstPoint),p2=Pt(p.SecondPoint),baseLocation=p.BaseLocation.ToString(),
       value=new{x=p.SecondPoint.X-p.FirstPoint.X,y=p.SecondPoint.Y-p.FirstPoint.Y},valueSetX=ValueSet(p.ValueSetX),valueSetY=ValueSet(p.ValueSetY)});
      break;
     case BlockVisibilityParameter p:
      parameters.Add(new{id=p.Id,kind="visibility",label=p.Label,all=p.Entities.Select(Hex).ToList(),
       states=p.States.Values.Select(s=>new{name=s.Name,handles=s.Entities.Select(Hex).ToList()}).ToList()});
      break;
     case BlockFlipAction a:
      if(Connected(a.UpdatedBaseConnection)||Connected(a.UpdatedEndConnection)){Unsupported("BlockFlipAction.LinkedAxis");break;}
      actions.Add(new{id=a.Id,kind="flip",param=a.FlipConnection?.Id,handles=a.Entities.Select(Hex).ToList()});
      break;
     case BlockRotationAction a:
      if(Connected(a.UpdateBaseXConnection)||Connected(a.UpdateBaseYConnection)){Unsupported("BlockRotationAction.LinkedBasePoint");break;}
      actions.Add(new{id=a.Id,kind="rotate",param=a.AngleDeltaConnection?.Id,center=Pt(a.BasePoint),handles=a.Entities.Select(Hex).ToList()});
      break;
     case BlockStretchAction a:
      actions.Add(new{id=a.Id,kind="stretch",param=FirstConnection(a.EndXDeltaConnection,a.EndYDeltaConnection)?.Id,connection=FirstConnection(a.EndXDeltaConnection,a.EndYDeltaConnection)?.Name,multiplier=a.DistanceMultiplier,angle=a.AngleOffset,
       xConnection=Connection(a.EndXDeltaConnection),yConnection=Connection(a.EndYDeltaConnection),
       frame=a.Boundary.Select(Pt2).ToList(),bindings=a.StretchBindings.Select(b=>new{h=Hex(b.Entity),t=b.Entity?.GetType().Name,points=b.PointIndexes}).ToList()});
      break;
     case BlockMoveAction a:
      actions.Add(new{id=a.Id,kind="move",param=FirstConnection(a.XDeltaConnection,a.YDeltaConnection)?.Id,connection=FirstConnection(a.XDeltaConnection,a.YDeltaConnection)?.Name,multiplier=a.DistanceMultiplier,angle=a.AngleOffset,
       xConnection=Connection(a.XDeltaConnection),yConnection=Connection(a.YDeltaConnection),handles=a.Entities.Select(Hex).ToList()});
      break;
     case null:break;
     default:{var name=node.Expression.GetType().Name;if(!name.EndsWith("Grip"))Unsupported(name);break;}
    }
   }
   if(parameters.Count>0){defs[record.Name]=new{parameters,actions,unsupported=unhandled.OrderBy(x=>x).ToList()};(parameterTypes??=new())[record.Name]=types;}
  }
  if(defs.Count==0&&unsupported.Count==0){File.WriteAllText(path,"{\"version\":1,\"defs\":{},\"inserts\":{},\"unsupported\":{}}");return 0;}
  var inserts=new Dictionary<string,object>();
  if(defs.Count>0)foreach(var record in doc.BlockRecords)foreach(var e in record.Entities){
   if(e is not Insert insert)continue;
   var representation=Entry<CadDictionary>(insert.XDictionary,"AcDbBlockRepresentation");
   var source=Entry<BlockRepresentationData>(representation,"AcDbRepData")?.Block?.Name;
   if(source==null||!defs.ContainsKey(source))continue;
   var data=Entry<CadDictionary>(Entry<CadDictionary>(representation,"AppDataCache"),"ACAD_ENHANCEDBLOCKDATA");
   var values=new Dictionary<string,object?>();
   var types=parameterTypes![source];
   // A missing new parameter value must never silently reset an existing reference.
   foreach(var pair in types)if(pair.Value is BlockFlipParameter or BlockRotationParameter or BlockXYParameter)values[pair.Key]=null;
   if(data!=null)foreach(var key in data.EntryNames){
    if(data[key] is not XRecord record2)continue;
    // Point-pair caches are interpreted according to their definition, never as an unconditional length.
    var points=record2.Entries.Where(x=>x.Code==10).Select(x=>x.Value).OfType<CSMath.XYZ>().ToList();
    var text=record2.Entries.Where(x=>x.Code==1).Select(x=>x.Value as string).FirstOrDefault(x=>x!=null);
    types.TryGetValue(key,out var parameter);
    if(parameter is BlockFlipParameter){
     // The cache flag layout is not verified. Retain unknown rather than guessing 0/1.
     values[key]=null;
    }else if(parameter is BlockRotationParameter){
     // The library maintainer documents the first two code-10 points as the current angle:
     // https://github.com/DomCR/ACadSharp/issues/962
     values[key]=points.Count>=2?Angle(points[0],points[1]):null;
    }else if(parameter is BlockXYParameter){
     if(points.Count>=2&&double.IsFinite(points[1].X-points[0].X)&&double.IsFinite(points[1].Y-points[0].Y))
      values[key]=new{x=points[1].X-points[0].X,y=points[1].Y-points[0].Y};
    }else if(parameter is BlockVisibilityParameter)values[key]=text;
    else if(parameter is BlockLinearParameter&&points.Count>=2)values[key]=Math.Sqrt(Math.Pow(points[1].X-points[0].X,2)+Math.Pow(points[1].Y-points[0].Y,2));
    // A stale node ID or unsupported parameter cannot establish the cache kind.
    else values[key]=null;
   }
   inserts[Hex(insert)]=new{source,values};
  }
  File.WriteAllText(path,JsonSerializer.Serialize(new{version=1,defs,inserts,unsupported}));
  return defs.Count;
 }
}
