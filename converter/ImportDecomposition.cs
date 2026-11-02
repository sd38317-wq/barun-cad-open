using ACadSharp;
using ACadSharp.Entities;
using ACadSharp.Objects;
using ACadSharp.Tables;
using CSMath;
using System.Globalization;

// Import-only lowering. Never used for verified file conversion or DWG saving.
internal static class ImportDecomposition
{
    internal static void Apply(CadDocument doc, Dictionary<string, int> decomposed,
        List<object> regions, List<object> unresolved, List<string> warnings)
    {
        // Snapshot owners because adding an INSERT may register its new block.
        foreach (var owner in doc.BlockRecords.ToArray())
        foreach (var entity in owner.Entities.Where(e => e is Region or TableEntity).ToArray())
        {
            if (entity is Region emptyRegion && !(emptyRegion.AcisData?.Length > 0))
                unresolved.Add(new { ownerBlock = owner.Name, type = "REGION", count = 1 });
            if (entity is Region region && region.AcisData?.Length > 0)
            {
                regions.Add(new {
                    handle = region.Handle.ToString("X"), ownerBlock = owner.Name,
                    layer = region.Layer.Name, color = region.Color.Index,
                    trueColor = region.Color.IsTrueColor ? (int?)region.Color.TrueColor : null,
                    lineweight = (int)region.LineWeight, linetype = region.LineType.Name,
                    data = Convert.ToBase64String(region.AcisData), binary = region.IsBinaryAcisData
                });
            }
            if (entity is not TableEntity table) continue;
            try
            {
                var insert = LowerTable(table);
                // Construct completely before replacing: failures retain the source type
                // for the caller's missing-object verification and fallback engine.
                owner.Entities.Add(insert);
                owner.Entities.Remove(table);
                decomposed["ACAD_TABLE"] = decomposed.GetValueOrDefault("ACAD_TABLE") + 1;
            }
            catch (Exception ex)
            {
                warnings.Add($"TABLE {table.Handle:X}: cannot decompose ({ex.Message})");
                unresolved.Add(new { ownerBlock = owner.Name, type = "ACAD_TABLE", count = 1 });
            }
        }
    }

    private static Insert LowerTable(TableEntity table)
    {
        string name = "BCAD_TABLE_" + table.Handle.ToString("X");
        for (int suffix = 1; table.Document?.BlockRecords.Contains(name) == true; suffix++)
            name = "BCAD_TABLE_" + table.Handle.ToString("X") + "_" + suffix;
        var block = new BlockRecord(name);
        // AutoCAD's anonymous table cache already contains its exact cell layout.
        // Retain only boundary/text primitives; backgrounds are intentionally omitted.
        if (table.Block != null && table.Block.Entities.Any(e => e is Line or LwPolyline or TextEntity or MText)
            && table.Block.Entities.All(e => e is Line or LwPolyline or TextEntity or MText or Solid or Hatch))
        {
            block.BlockEntity.BasePoint = table.Block.BlockEntity.BasePoint;
            foreach (var e in table.Block.Entities)
                if (e is Line or LwPolyline or TextEntity or MText)
                    block.Entities.Add((Entity)e.Clone());
        }
        else BuildCells(table, block);
        var insert = new Insert(block) {
            InsertPoint = table.InsertPoint, Normal = table.Normal,
            XScale = table.XScale, YScale = table.YScale, ZScale = table.ZScale,
            Rotation = table.Rotation
        };
        // TABLE's horizontal vector carries the orientation in many DWG versions
        // whose inherited INSERT rotation remains zero. Convert WCS to its OCS.
        if (Math.Abs(insert.Rotation) < 1e-12 && table.HorizontalDirection != XYZ.Zero)
        {
            var direction = Matrix3.ArbitraryAxis(table.Normal).Transpose() * table.HorizontalDirection;
            insert.Rotation = Math.Atan2(direction.Y, direction.X);
        }
        insert.MatchProperties(table);
        return insert;
    }

    private static void BuildCells(TableEntity table, BlockRecord block)
    {
        int rows = table.Rows.Count, cols = table.Columns.Count;
        if (rows == 0 || cols == 0 || (long)rows * cols > 1000000)
            throw new InvalidDataException("missing or oversized cell grid");
        var x = new double[cols + 1];
        var y = new double[rows + 1];
        for (int c = 0; c < cols; c++) {
            double size = table.Columns[c].Width;
            if (!double.IsFinite(size) || size <= 0) throw new InvalidDataException("invalid column width");
            x[c + 1] = x[c] + size;
        }
        double direction = table.Style?.FlowDirection == TableFlowDirectionType.Up ||
            table.CellStyleOverride.PropertyOverrideFlags.HasFlag(TableStyle.CellStylePropertyFlags.FlowDirectionBottomToTop) ? 1 : -1;
        for (int r = 0; r < rows; r++) {
            double size = table.Rows[r].Height;
            if (!double.IsFinite(size) || size <= 0 || table.Rows[r].Cells.Count != cols)
                throw new InvalidDataException("invalid row geometry");
            y[r + 1] = y[r] + direction * size;
        }
        // Owner indices suppress internal borders of merged cells in O(cell count).
        var owners = new int[rows, cols];
        for (int r = 0; r < rows; r++) for (int c = 0; c < cols; c++) owners[r, c] = r * cols + c;
        var spans = new Dictionary<int, (int row, int col)>();
        foreach (var range in table.MergedCellRanges) {
            int r0 = range.TopRowIndex, r1 = range.BottomRowIndex;
            int c0 = range.LeftColumnIndex, c1 = range.RightColumnIndex;
            if (r0 < 0 || c0 < 0 || r1 >= rows || c1 >= cols || r1 < r0 || c1 < c0)
                throw new InvalidDataException("invalid merged cell range");
            int anchor = r0 * cols + c0;
            spans[anchor] = (r1 + 1, c1 + 1);
            for (int r = r0; r <= r1; r++) for (int c = c0; c <= c1; c++) owners[r, c] = anchor;
        }
        void Edge(double x0, double y0, double x1, double y1) =>
            block.Entities.Add(new Line(new XYZ(x0, y0, 0), new XYZ(x1, y1, 0)));
        for (int r = 0; r <= rows; r++) for (int c = 0; c < cols; c++)
            if (r == 0 || r == rows || owners[r - 1, c] != owners[r, c]) Edge(x[c], y[r], x[c + 1], y[r]);
        for (int c = 0; c <= cols; c++) for (int r = 0; r < rows; r++)
            if (c == 0 || c == cols || owners[r, c - 1] != owners[r, c]) Edge(x[c], y[r], x[c], y[r + 1]);
        for (int r = 0; r < rows; r++) for (int c = 0; c < cols; c++) {
            int index = r * cols + c;
            if (owners[r, c] != index) continue;
            var cell = table.Rows[r].Cells[c];
            (int row, int col) end = spans.GetValueOrDefault(index, (r + 1, c + 1));
            var style = cell.StyleOverride.HasData ? cell.StyleOverride : cell.Style ?? table.Style?.DataCellStyle;
            double width = x[end.col] - x[c], height = Math.Abs(y[end.row] - y[r]);
            var values = new List<string>();
            foreach (var content in cell.Contents) {
                var value = content.CadValue;
                string text = value.FormattedValue;
                if (string.IsNullOrEmpty(text)) text = Convert.ToString(value.Value, CultureInfo.InvariantCulture) ?? "";
                if (content.ContentType == TableEntity.TableCellContentType.Block ||
                    content.ContentType == TableEntity.TableCellContentType.Field && text.Length == 0)
                    throw new InvalidDataException("cell content has no rendered text");
                if (text.Length > 0) values.Add(text);
            }
            if (values.Count == 0) continue;
            var format = cell.Content?.Format;
            double textHeight = format?.HasData == true && format.TextHeight > 0 ? format.TextHeight : style?.TextHeight ?? 0;
            if (!double.IsFinite(textHeight) || textHeight <= 0) textHeight = height * 0.35;
            int alignment = (int)(style?.CellAlignment ?? 0);
            if (format?.HasData == true && format.Alignment >= 1 && format.Alignment <= 9) alignment = format.Alignment;
            if (alignment < 1 || alignment > 9) alignment = 5;
            int horizontal = (alignment - 1) % 3, vertical = (alignment - 1) / 3;
            double marginX = Math.Min(width * 0.1, Math.Max(0, style?.HorizontalMargin ?? width * 0.05));
            double marginY = Math.Min(height * 0.1, Math.Max(0, style?.VerticalMargin ?? height * 0.05));
            double left = x[c], right = x[end.col], top = Math.Max(y[r], y[end.row]), bottom = Math.Min(y[r], y[end.row]);
            double px = horizontal == 0 ? left + marginX : horizontal == 2 ? right - marginX : (left + right) / 2;
            double py = vertical == 0 ? top - marginY : vertical == 2 ? bottom + marginY : (top + bottom) / 2;
            var textEntity = new MText {
                Value = string.Join("\\P", values), InsertPoint = new XYZ(px, py, 0),
                Height = textHeight, RectangleWidth = width - 2 * marginX,
                AttachmentPoint = (AttachmentPointType)alignment
            };
            double angle = cell.Rotation + (format?.HasData == true ? format.Rotation : 0);
            textEntity.AlignmentPoint = new XYZ(Math.Cos(angle), Math.Sin(angle), 0);
            if (style?.TextStyle != null) textEntity.Style = style.TextStyle;
            if (format?.HasData == true && format.TextStyle != null) textEntity.Style = format.TextStyle;
            block.Entities.Add(textEntity);
        }
    }
}
