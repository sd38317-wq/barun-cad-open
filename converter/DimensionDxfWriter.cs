using ACadSharp;
using ACadSharp.Entities;
using ACadSharp.IO;
using System.Globalization;
using System.Buffers.Text;
using System.Text;

// ACadSharp 3.8.0 reads/writes DWG HorizontalDirection, but its DXF writer
// omits group 51. Insert the native field while streaming, including dimensions
// in block definitions and paper space. Ordinary drawings use the original writer.
internal static class DimensionDxfWriter
{
    public static void Write(string path, CadDocument doc, NotificationEventHandler notice)
    {
        var directions = new Dictionary<ulong, double>();
        foreach (var block in doc.BlockRecords)
            foreach (var entity in block.Entities)
                if (entity is DimensionOrdinate dim && dim.HorizontalDirection != 0)
                    directions.Add(dim.Handle, dim.HorizontalDirection * 180 / Math.PI);
        if (directions.Count == 0)
        {
            DxfWriter.Write(path, doc, notification: notice);
            return;
        }
        using var file = File.Create(path);
        using var output = new DirectionStream(file, directions);
        DxfWriter.Write(output, doc, notification: notice);
    }

    private sealed class DirectionStream(Stream output, Dictionary<ulong, double> directions) : Stream
    {
        // Only short ASCII code/handle/subclass lines are inspected; all other
        // bytes (including legacy code pages and Unicode) pass through unchanged.
        private readonly byte[] line = new byte[256];
        private int length;
        private bool valueLine;
        private int code = -1;
        private ulong handle;
        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() => output.Flush();
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => Write(buffer.AsSpan(offset, count));
        public override void Write(ReadOnlySpan<byte> buffer)
        {
            int written = 0, start = 0;
            while (start < buffer.Length)
            {
                int end = buffer[start..].IndexOf((byte)'\n');
                int count = end < 0 ? buffer.Length - start : end;
                int copied = Math.Min(count, Math.Max(0, line.Length - length));
                if (!valueLine || code == 5 || code == 100 && directions.ContainsKey(handle))
                    buffer.Slice(start, copied).CopyTo(line.AsSpan(Math.Min(length, line.Length)));
                length = Math.Min(line.Length + 1, length + count);
                start += count;
                if (end < 0) break;
                start++;
                string? addition = EndLine();
                if (addition != null)
                {
                    output.Write(buffer[written..start]);
                    output.Write(Encoding.ASCII.GetBytes(addition));
                    written = start;
                }
            }
            output.Write(buffer[written..]);
        }
        private string? EndLine()
        {
            ReadOnlySpan<byte> text = length <= line.Length ? line.AsSpan(0, length) : ReadOnlySpan<byte>.Empty;
            while (!text.IsEmpty && text[0] <= 32) text = text[1..];
            while (!text.IsEmpty && text[^1] <= 32) text = text[..^1];
            length = 0;
            string? addition = null;
            if (!valueLine)
                code = Utf8Parser.TryParse(text, out int n, out int consumed) && consumed == text.Length ? n : -1;
            else if (code == 0)
                handle = 0;
            else if (code == 5)
                Utf8Parser.TryParse(text, out handle, out _, 'X');
            else if (code == 100 && directions.TryGetValue(handle, out double angle) && text.SequenceEqual("AcDbDimension"u8))
                addition = " 51\r\n" + angle.ToString("R", CultureInfo.InvariantCulture) + "\r\n";
            valueLine = !valueLine;
            return addition;
        }
    }
}
