using ACadSharp;
using ACadSharp.Entities;
using CSMath;
using System.Text;

// --split-lines: plain model-space LINEs, CIRCLEs, ARCs and straight
// LWPOLYLINEs go to a compact binary file instead of the DXF. On a 1.9M-object
// plan (1.86M lines) writing them to DXF and having Python read them back took
// 150 of 225 seconds; the importer now builds those entities straight from this
// file and reads only the rest from the DXF.
//
// Only entities whose import result is fully determined by the fields below are
// split. Anything unusual (extension dictionary, reactors, thickness,
// transparency, invisibility, a colour book, a non-Z normal, non-finite values,
// polyline bulges or vertex widths) stays in the DXF, so the source-preservation
// layer still carries it. Split entities are not in that layer: a DXF export
// rewrites them from the drawing (same geometry and properties) without their
// XDATA.
//
// Layout (little endian), read by exchange.read_split_lines:
//   "BLN3" int32 total int32 strings int32 lines int32 circles int32 arcs int32 polylines int32 vertices
//          int32 splines int32 splineValues
//   strings × (int32 byteLength, UTF-8 bytes)          layer and linetype names
//   total × uint64 handle                               model space, writer order
//   total × byte kind (0 in the DXF, 1 line, 2 circle, 3 arc, 4 polyline, 5 spline)
//   header = int32 layer, int32 linetype, int32 colour, int16 lineweight, int16 flags, double linetypeScale
//   flags: 1 = extrusion exactly (0,0,-1) (circle, arc, polyline: the importer flips it the
//   way ezdxf.upright does); 2 = a line whose extrusion is not +Z (its WCS points are used).
//   lines     × (header, double x1, y1, z1, x2, y2, z2)
//   circles   × (header, double cx, cy, cz, radius)
//   arcs      × (header, double cx, cy, cz, radius, startDegrees, endDegrees)
//   polylines × (header, int32 vertices, int32 flags (1 closed), double constantWidth, double elevation)
//   vertices  × (double x, y)                           all polylines, in order
//   splines   × (header, int32 degree, int32 flags (DXF 70), int32 controlPoints, int32 knots,
//                double knotTolerance, controlPointTolerance, fitTolerance (DXF 42-44: ezdxf's
//                Bezier decomposition depends on them))
//   splineValues × double: per spline its control points (x, y, z) then its knots
// Only splines drawn from control points without weights or fit points, in the
// +Z plane: the importer rebuilds exactly the ezdxf SPLINE the DXF would give
// and flattens it with the same ezdxf call.
// colour: 256 by layer, 0 by block, 1..255 index, 0x1000000|rgb true colour.
// Angles use the writer's own conversion (MathHelper.RadToDeg) so they are the
// exact values the DXF would have held.
static class LineSplit
{
	public static readonly Dictionary<string, double> Timings = new();
	public static readonly Dictionary<string, int> Counts = new();

	const byte None = 0, LineKind = 1, CircleKind = 2, ArcKind = 3, PolylineKind = 4, SplineKind = 5;

	static bool Finite(XYZ p) => double.IsFinite(p.X) && double.IsFinite(p.Y) && double.IsFinite(p.Z);

	static int? ColourCode(Color c)
	{
		if (c.IsTrueColor) return 0x1000000 | (c.R << 16) | (c.G << 8) | c.B;
		if (c.IsByLayer) return 256;
		if (c.IsByBlock) return 0;
		if (c.Index >= 1 && c.Index <= 255) return c.Index;
		return null;
	}

	static bool PlainNormal(XYZ n) => n.X == 0 && n.Y == 0 && n.Z == 1;
	static bool FlippedNormal(XYZ n) => n.X == 0 && n.Y == 0 && n.Z == -1;
	// exchange.entity(): planar = |x| <= 1e-9 and |y| <= 1e-9 and z > 0.
	static bool ImporterPlanar(XYZ n) => Math.Abs(n.X) <= 1e-9 && Math.Abs(n.Y) <= 1e-9 && n.Z > 0;

	static bool PlainEntity(Entity e)
	{
		if (!double.IsFinite(e.LineTypeScale) || e.IsInvisible || e.BookColor != null) return false;
		if (e.Transparency.IsByBlock || !e.Transparency.IsByLayer) return false;
		if (e.Layer?.Name == null || e.LineType?.Name == null || ColourCode(e.Color) == null) return false;
		// XDATA is not imported and is not what makes an entity associative; 1.76M
		// of 1.86M lines in a structural plan carry "ACAD" XDATA. Extension
		// dictionaries and reactors (hatch boundaries, dimensions) stay in the DXF.
		if (e.XDictionary != null || e.Reactors.Any()) return false;
		return true;
	}

	static byte Kind(Entity e, out short flags)
	{
		flags = 0;
		switch (e)
		{
			case Line line:
				// Line coordinates are WCS whatever the extrusion (it only orients a thickness).
				if (!Finite(line.Normal)) return None;
				if (!ImporterPlanar(line.Normal)) flags = 2;
				return line.Thickness == 0 && Finite(line.StartPoint) && Finite(line.EndPoint) && PlainEntity(e) ? LineKind : None;
			case Arc arc:
				if (FlippedNormal(arc.Normal)) flags = 1; else if (!PlainNormal(arc.Normal)) return None;
				return arc.Thickness == 0 && Finite(arc.Center) && double.IsFinite(arc.Radius)
					&& double.IsFinite(arc.StartAngle) && double.IsFinite(arc.EndAngle) && PlainEntity(e) ? ArcKind : None;
			case Circle circle:
				if (FlippedNormal(circle.Normal)) flags = 1; else if (!PlainNormal(circle.Normal)) return None;
				return circle.Thickness == 0 && Finite(circle.Center) && double.IsFinite(circle.Radius) && PlainEntity(e) ? CircleKind : None;
			case LwPolyline poly:
				if (FlippedNormal(poly.Normal)) flags = 1; else if (!PlainNormal(poly.Normal)) return None;
				if (poly.Thickness != 0 || poly.Vertices.Count < 2) return None;
				if (!double.IsFinite(poly.ConstantWidth) || !double.IsFinite(poly.Elevation)) return None;
				foreach (var v in poly.Vertices)
					if (v.Bulge != 0 || v.StartWidth != 0 || v.EndWidth != 0 || !double.IsFinite(v.Location.X) || !double.IsFinite(v.Location.Y)) return None;
				return PlainEntity(e) ? PolylineKind : None;
			case Spline spline:
				if (!PlainNormal(spline.Normal) || spline.FitPoints.Count > 0 || spline.Weights.Count > 0 || spline.ControlPoints.Count < 2) return None;
				if (spline.Degree < 1 || spline.Knots.Count != spline.ControlPoints.Count + spline.Degree + 1) return None;
				if (spline.ControlPoints.Any(p => !Finite(p)) || spline.Knots.Any(k => !double.IsFinite(k))) return None;
				return PlainEntity(e) ? SplineKind : None;
			default:
				return None;
		}
	}

	/// <summary>Writes the split file and removes the split entities from model space. Returns the split count (0: nothing written).</summary>
	public static int Split(CadDocument doc, string path, int minimum)
	{
		var sw = System.Diagnostics.Stopwatch.StartNew();
		void Mark(string key) { Timings[key] = sw.Elapsed.TotalMilliseconds; sw.Restart(); }
		var entities = doc.Entities.ToList();
		var kinds = new byte[entities.Count];
		var flags = new short[entities.Count];
		int count = 0, lines = 0, circles = 0, arcs = 0, polylines = 0, vertices = 0, splines = 0, splineValues = 0;
		for (int i = 0; i < entities.Count; i++)
		{
			var kind = Kind(entities[i], out flags[i]);
			kinds[i] = kind;
			if (kind == None) continue;
			count++;
			if (kind == LineKind) lines++;
			else if (kind == CircleKind) circles++;
			else if (kind == ArcKind) arcs++;
			else if (kind == PolylineKind) { polylines++; vertices += ((LwPolyline)entities[i]).Vertices.Count; }
			else { var spline = (Spline)entities[i]; splines++; splineValues += spline.ControlPoints.Count * 3 + spline.Knots.Count; }
		}
		Mark("split_select");
		if (count < minimum || count == 0) return 0;

		var strings = new Dictionary<string, int>(StringComparer.Ordinal);
		var table = new List<string>();
		int Id(string s) { if (!strings.TryGetValue(s, out var id)) { id = table.Count; strings[s] = id; table.Add(s); } return id; }
		var ids = new (int layer, int linetype)[entities.Count];
		for (int i = 0; i < entities.Count; i++)
			if (kinds[i] != None) ids[i] = (Id(entities[i].Layer.Name), Id(entities[i].LineType.Name));

		using (var stream = new BufferedStream(File.Create(path), 1 << 20))
		using (var w = new BinaryWriter(stream, new UTF8Encoding(false)))
		{
			w.Write(Encoding.ASCII.GetBytes("BLN3"));
			w.Write(entities.Count); w.Write(table.Count); w.Write(lines); w.Write(circles); w.Write(arcs); w.Write(polylines); w.Write(vertices);
			w.Write(splines); w.Write(splineValues);
			foreach (var s in table) { var bytes = Encoding.UTF8.GetBytes(s); w.Write(bytes.Length); w.Write(bytes); }
			foreach (var e in entities) w.Write(e.Handle);
			w.Write(kinds);
			void Header(int i)
			{
				var e = entities[i];
				w.Write(ids[i].layer); w.Write(ids[i].linetype); w.Write(ColourCode(e.Color)!.Value);
				w.Write((short)e.LineWeight); w.Write(flags[i]);
				w.Write(e.LineTypeScale);
			}
			for (int i = 0; i < entities.Count; i++)
			{
				if (kinds[i] != LineKind) continue;
				var line = (Line)entities[i]; Header(i);
				w.Write(line.StartPoint.X); w.Write(line.StartPoint.Y); w.Write(line.StartPoint.Z);
				w.Write(line.EndPoint.X); w.Write(line.EndPoint.Y); w.Write(line.EndPoint.Z);
			}
			for (int i = 0; i < entities.Count; i++)
			{
				if (kinds[i] != CircleKind) continue;
				var circle = (Circle)entities[i]; Header(i);
				w.Write(circle.Center.X); w.Write(circle.Center.Y); w.Write(circle.Center.Z); w.Write(circle.Radius);
			}
			for (int i = 0; i < entities.Count; i++)
			{
				if (kinds[i] != ArcKind) continue;
				var arc = (Arc)entities[i]; Header(i);
				w.Write(arc.Center.X); w.Write(arc.Center.Y); w.Write(arc.Center.Z); w.Write(arc.Radius);
				w.Write(MathHelper.RadToDeg(arc.StartAngle)); w.Write(MathHelper.RadToDeg(arc.EndAngle));
			}
			for (int i = 0; i < entities.Count; i++)
			{
				if (kinds[i] != PolylineKind) continue;
				var poly = (LwPolyline)entities[i]; Header(i);
				w.Write(poly.Vertices.Count); w.Write(poly.IsClosed ? 1 : 0); w.Write(poly.ConstantWidth); w.Write(poly.Elevation);
			}
			for (int i = 0; i < entities.Count; i++)
			{
				if (kinds[i] != PolylineKind) continue;
				foreach (var v in ((LwPolyline)entities[i]).Vertices) { w.Write(v.Location.X); w.Write(v.Location.Y); }
			}
			for (int i = 0; i < entities.Count; i++)
			{
				if (kinds[i] != SplineKind) continue;
				var spline = (Spline)entities[i]; Header(i);
				w.Write(spline.Degree); w.Write((int)spline.Flags); w.Write(spline.ControlPoints.Count); w.Write(spline.Knots.Count);
				w.Write(spline.KnotTolerance); w.Write(spline.ControlPointTolerance); w.Write(spline.FitTolerance);
			}
			for (int i = 0; i < entities.Count; i++)
			{
				if (kinds[i] != SplineKind) continue;
				var spline = (Spline)entities[i];
				foreach (var p in spline.ControlPoints) { w.Write(p.X); w.Write(p.Y); w.Write(p.Z); }
				foreach (var k in spline.Knots) w.Write(k);
			}
		}
		Mark("split_write");
		Counts["LINE"] = lines; Counts["CIRCLE"] = circles; Counts["ARC"] = arcs; Counts["LWPOLYLINE"] = polylines; Counts["SPLINE"] = splines;
		// The entities only have to be absent from the DXF, which is written from the
		// model-space collection. Collection.Remove notifies the document for every
		// entity (31 s for 1.86M lines); dropping them from the backing set does not.
		// The document is discarded after writing. Without that set (another engine
		// version) fall back to Remove.
		var backing = Entries(doc.Entities);
		var removed = new HashSet<Entity>(ReferenceEqualityComparer.Instance);
		for (int i = 0; i < entities.Count; i++)
		{
			if (kinds[i] == None) continue;
			removed.Add(entities[i]);
			if (!(backing?.Remove(entities[i]) ?? false)) doc.Entities.Remove(entities[i]);
		}
		// The model-space draw order table must not point at entities the DXF no
		// longer holds (the importer keeps that DXF as the source-preservation layer).
		var sorting = doc.ModelSpace.SortEntitiesTable;
		if (sorting != null)
		{
			var keep = sorting.Where(s => !removed.Contains(s.Entity)).Select(s => (s.Entity, s.SortHandle)).ToList();
			sorting.Clear();
			foreach (var (entity, handle) in keep) sorting.Add(entity, handle);
		}
		Mark("split_remove");
		return count;
	}

	static HashSet<Entity>? Entries(object collection)
	{
		for (var type = collection.GetType(); type != null; type = type.BaseType)
		{
			var field = type.GetField("_entries", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
			if (field?.GetValue(collection) is HashSet<Entity> set) return set;
		}
		return null;
	}
}
