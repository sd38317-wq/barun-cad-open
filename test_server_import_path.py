import functools
import gzip
import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.request import Request, urlopen
from unittest.mock import patch

import ezdxf

import server


class ImportPathHttpTest(unittest.TestCase):
    def test_import_path_reads_json_body_once_and_returns(self):
        with tempfile.TemporaryDirectory() as folder:
            drawing = Path(folder) / "simple.dxf"
            doc = ezdxf.new("R2018")
            doc.modelspace().add_line((0, 0), (1000, 0))
            doc.saveas(drawing)
            cache = Path(folder) / "cache"
            cache.mkdir()

            with patch.object(server, "import_cache_dir", return_value=cache):
                httpd = server.LocalServer(
                    ("127.0.0.1", 0),
                    functools.partial(server.Handler, directory=str(server.ROOT)),
                )
                thread = threading.Thread(target=httpd.serve_forever, daemon=True)
                thread.start()
                try:
                    port = httpd.server_port
                    origin = f"http://127.0.0.1:{port}"
                    payload = json.dumps(
                        {"path": str(drawing), "extension": ".dxf"}
                    ).encode("utf-8")
                    request = Request(
                        origin + "/api/import-path",
                        payload,
                        {
                            "Content-Type": "application/json",
                            "X-CAD-Token": server.TOKEN,
                            "Origin": origin,
                        },
                    )
                    with urlopen(request, timeout=3) as response:
                        # S1: 결과는 줄 단위 NDJSON(gzip)으로 온다.
                        self.assertIn("x-ndjson", response.headers.get("Content-Type", ""))
                        self.assertEqual(response.headers.get("X-Barun-Import-Cache"), "miss")
                        lines = gzip.decompress(response.read()).split(b"\n")
                    import import_stream
                    self.assertTrue(all(len(line) <= import_stream.SAFE_LINE_BYTES for line in lines))
                    result = import_stream.assemble(line for line in lines if line.strip())
                    self.assertEqual(result["report"]["imported"], 1)
                    self.assertEqual(result["report"]["sourceFormat"], "DXF")
                    self.assertEqual(len(result["document"]["entities"]), 1)
                    with urlopen(request, timeout=3) as response:
                        self.assertEqual(response.headers.get("X-Barun-Import-Cache"), "hit")
                finally:
                    httpd.shutdown()
                    httpd.server_close()
                    thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
