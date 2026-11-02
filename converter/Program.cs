using ACadSharp;
using ACadSharp.IO;
using System.Text;
using System.Text.Json;
using System.Diagnostics;

// Legacy Korean DWG files use KSC5601/Windows-949. .NET does not enable these
// encodings unless the provider is registered, which previously produced readable
// geometry with damaged Korean strings on another PC.
Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

// input output version [--defer-verify [--split-lines path [--split-min n]]] [--dyn-blocks path]
// --defer-verify: the caller reads the output anyway and compares the entity
// counts per type itself (inputTypes is always reported), so the output is not
// read back here a second time.
// --split-lines: plain model-space lines, circles, arcs and straight polylines go to a binary file, not the DXF (LineSplit.cs).
// --dyn-blocks: AutoCAD dynamic block definitions and reference values go to a JSON file (DynBlocks.cs).
var deferVerify=false;string? splitPath=null;string? dynPath=null;var splitMin=20000;var usage=args.Length<3;
for(int i=3;i<args.Length&&!usage;i++){
 if(args[i]=="--defer-verify")deferVerify=true;
 else if(args[i]=="--split-lines"&&i+1<args.Length)splitPath=args[++i];
 else if(args[i]=="--split-min"&&i+1<args.Length&&int.TryParse(args[++i],out var n)&&n>=0)splitMin=n;
 else if(args[i]=="--dyn-blocks"&&i+1<args.Length)dynPath=args[++i];
 else usage=true;
}
if(usage||splitPath!=null&&!deferVerify){Console.Error.WriteLine("input output version [--defer-verify [--split-lines path [--split-min n]]] [--dyn-blocks path] required");return 2;}
var timings = new Dictionary<string,double>();
var total = Stopwatch.StartNew();
var engineVersion = "ACadSharp 3.8.0";
var route = "acadsharp";
var warnings=new List<string>();
// Entity types this ACadSharp version reads but cannot write to DXF. A drawing
// containing them always failed the count verification after a full write and
// re-read (tens of seconds on large drawings); report it before writing.
var unwritableDxf=new HashSet<string>{"Region","TableEntity"};
try {
 var versions=new Dictionary<string,ACadVersion>{{"2000",ACadVersion.AC1015},{"2004",ACadVersion.AC1018},{"2010",ACadVersion.AC1024},{"2013",ACadVersion.AC1027},{"2018",ACadVersion.AC1032}};
 if(!versions.TryGetValue(args[2],out var version))throw new Exception("Unsupported version");
 bool unsupportedJogged=false;
 void Notice(object sender,NotificationEventArgs e){warnings.Add(e.Message);if(e.Message.Contains("LARGE_RADIAL_DIMENSION",StringComparison.Ordinal))unsupportedJogged=true;}
 var source=Path.GetExtension(args[0]).ToLowerInvariant();var target=Path.GetExtension(args[1]).ToLowerInvariant();
 var sw=Stopwatch.StartNew();
 CadDocument doc=source==".dwg"?DwgReader.Read(args[0],Notice):source==".dxf"?DxfReader.Read(args[0],Notice):throw new Exception("Unsupported input");
 sw.Stop();timings["dwg_parse"]=sw.Elapsed.TotalMilliseconds;
 if(source==".dxf"&&target==".dwg"&&unsupportedJogged)throw new Exception("LARGE_RADIAL_DIMENSION requires the staged radial-dimension fallback; use the Barun CAD conversion entry point.");
 int before=doc.Entities.Count;doc.Header.Version=version;
 // An INSERT whose block definition is missing in the source shows nothing in
 // AutoCAD either and the writer drops it as invalid. It is not a lost object.
 bool Broken(ACadSharp.Entities.Entity e)=>e is ACadSharp.Entities.Insert insert&&e is not ACadSharp.Entities.TableEntity&&insert.Block==null;
 var invalidTypes=doc.Entities.Where(Broken).GroupBy(e=>e.GetType().Name).ToDictionary(g=>g.Key,g=>g.Count());
 var inputTypes=doc.Entities.Where(e=>!Broken(e)).GroupBy(e=>e.GetType().Name).ToDictionary(g=>g.Key,g=>g.Count());
 // With --defer-verify the importer compares this output with the secondary
 // engine's and may open the one that lost fewer objects, so write it anyway.
 if(target==".dxf"&&!deferVerify){
  var blocked=inputTypes.Keys.Where(unwritableDxf.Contains).OrderBy(k=>k).ToList();
  if(blocked.Count>0){
   total.Stop();timings["csharp_total"]=total.Elapsed.TotalMilliseconds;
   var message="Entity types not writable by this engine: "+string.Join(", ",blocked);
   Console.WriteLine(JsonSerializer.Serialize(new {failed=true,message,before,inputTypes,unwritableTypes=blocked,warnings,engine_version=engineVersion,route,timings_ms=timings}));return 1;
  }
 }
 var dynBlocks=0;
 if(dynPath!=null){sw=Stopwatch.StartNew();dynBlocks=DynBlocks.Write(doc,dynPath);sw.Stop();timings["dyn_blocks"]=sw.Elapsed.TotalMilliseconds;}
 var decomposedTypes=new Dictionary<string,int>();
 var acisRegions=new List<object>();
 var unresolvedDecompositions=new List<object>();
 if(target==".dxf"&&deferVerify){
  sw=Stopwatch.StartNew();ImportDecomposition.Apply(doc,decomposedTypes,acisRegions,unresolvedDecompositions,warnings);
  sw.Stop();timings["import_decomposition"]=sw.Elapsed.TotalMilliseconds;
 }
 // Expected counts describe the lowered output before split-lines. The original
 // inputTypes remains available for diagnostics; unresolved types stay expected.
 var expectedOutputTypes=doc.Entities.Where(e=>!Broken(e)).GroupBy(e=>e.ObjectName).ToDictionary(g=>g.Key,g=>g.Count());
 var splitLines=0;
 if(splitPath!=null&&target==".dxf"){
  sw=Stopwatch.StartNew();splitLines=LineSplit.Split(doc,splitPath,splitMin);foreach(var kv in LineSplit.Timings)timings[kv.Key]=kv.Value;
  sw.Stop();timings["split_lines"]=sw.Elapsed.TotalMilliseconds;
 }
 sw=Stopwatch.StartNew();
 if(target==".dwg")DwgWriter.Write(args[1],doc,notification:Notice);
 else if(target==".dxf")DimensionDxfWriter.Write(args[1],doc,Notice);
 else throw new Exception("Unsupported output");
 sw.Stop();timings["dxf_write"]=sw.Elapsed.TotalMilliseconds;
 if(deferVerify){
  total.Stop();timings["csharp_total"]=total.Elapsed.TotalMilliseconds;
  Console.WriteLine(JsonSerializer.Serialize(new {before,after=(int?)null,verificationDeferred=true,inputTypes,expectedOutputTypes,decomposedTypes,acisRegions,unresolvedDecompositions,invalidTypes,splitLines,dynBlocks,splitTypes=LineSplit.Counts,warnings,engine_version=engineVersion,route,timings_ms=timings}));return 0;
 }
 sw=Stopwatch.StartNew();
 var verified=target==".dwg"?DwgReader.Read(args[1],Notice):DxfReader.Read(args[1],Notice);
 sw.Stop();timings["dxf_verify_read"]=sw.Elapsed.TotalMilliseconds;
 if(verified.Entities.Count!=before-invalidTypes.Values.Sum()){
  total.Stop();timings["csharp_total"]=total.Elapsed.TotalMilliseconds;
  var message="Entity count changed during output verification:";
  Console.WriteLine(JsonSerializer.Serialize(new {failed=true,message,before,after=verified.Entities.Count,inputTypes,invalidTypes,outputTypes=verified.Entities.GroupBy(e=>e.GetType().Name).ToDictionary(g=>g.Key,g=>g.Count()),warnings,engine_version=engineVersion,route,timings_ms=timings}));return 1;
 }
 total.Stop();timings["csharp_total"]=total.Elapsed.TotalMilliseconds;
 Console.WriteLine(JsonSerializer.Serialize(new {before,after=verified.Entities.Count,inputTypes,invalidTypes,dynBlocks,warnings,engine_version=engineVersion,route,timings_ms=timings}));return 0;
}catch(Exception e){
 total.Stop();timings["csharp_total"]=total.Elapsed.TotalMilliseconds;
 var error=new {failed=true,message=e.Message,engine_version=engineVersion,route,timings_ms=timings,warnings};
 Console.WriteLine(JsonSerializer.Serialize(error));return 1;
}
