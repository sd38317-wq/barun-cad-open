import base64
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import ezdxf

import exchange
import server


class DwgOpenPerformanceTest(unittest.TestCase):
    def test_import_reports_monotonic_pipeline_timings(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "simple.dxf"
            document = ezdxf.new("R2018")
            document.units = 4  # mm
            document.modelspace().add_line((0, 0), (10, 20))
            document.saveas(source)
            result = exchange.import_file_path(source, ".dxf")
        timings = result["report"]["timings_ms"]
        self.assertGreaterEqual(timings["dxf_read"], 0)
        self.assertGreaterEqual(timings["normalize"], 0)
        self.assertGreaterEqual(timings["preservation_compress"], 0)
        self.assertGreaterEqual(timings["import_total"], timings["dxf_read"])
        self.assertTrue(result["document"]["sourceCoverage"]["preservationAvailable"])

    def test_corrupt_preservation_stops_save_instead_of_dropping_objects(self):
        model = {
            "version": 2,
            "units": "mm",
            "layers": [{"id": "0", "name": "0", "color": "#ffffff"}],
            "blocks": [],
            "entities": [],
            "dxfPreservation": {
                "format": "dxf-zlib-v1",
                "data": base64.b64encode(b"not zlib").decode("ascii"),
                "handles": [],
                "version": "AC1032",
            },
        }
        with self.assertRaisesRegex(ValueError, "저장을 중단"):
            exchange.export_dxf(model)

    def test_missing_preservation_blocks_lossy_save_when_coverage_is_incomplete(self):
        model = {
            "version": 2,
            "units": "mm",
            "layers": [{"id": "0", "name": "0", "color": "#ffffff"}],
            "blocks": [],
            "entities": [],
            "sourceCoverage": {"preservationAvailable": False, "skipped": {"PROXY": 1}, "layoutsPreserved": 0},
        }
        with self.assertRaisesRegex(ValueError, "안전하게 저장"):
            exchange.export_dxf(model)

    def test_cache_namespace_separates_import_routes(self):
        with patch.dict("os.environ", {"BARUN_DWG_IMPORT_ROUTE": "legacy"}):
            legacy = server.import_cache_namespace(".dwg")
        with patch.dict("os.environ", {"BARUN_DWG_IMPORT_ROUTE": "deferred"}):
            deferred = server.import_cache_namespace(".dwg")
        self.assertNotEqual(legacy, deferred)

    def test_cache_namespace_tracks_runtime_override_and_converter_binary(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            for folder, payload in ((first, b"engine-a"), (second, b"engine-b")):
                root = Path(folder)
                (root / "ACadSharp.dll").write_bytes(payload)
                (root / "BarunConverter.dll").write_bytes(b"adapter")
                (root / "BarunConverter.exe").write_bytes(b"host")
            with patch.dict("os.environ", {"BARUN_DWG_RUNTIME": first}, clear=False):
                one = server.import_cache_namespace(".dwg")
            with patch.dict("os.environ", {"BARUN_DWG_RUNTIME": second}, clear=False):
                two = server.import_cache_namespace(".dwg")
        self.assertNotEqual(one, two)

    def test_cache_namespace_tracks_acadrust_converter(self):
        # 보조 변환기만 바뀌어도 옛 변환 캐시를 쓰지 않는다(7.0.30 온천동 DWG).
        real = server.runtime_paths.bundled_runtime
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            exe = root / ("barun-dwg2dxf" + server.runtime_paths.EXE)
            pick = lambda name: root if name == "acadrust-runtime" else real(name)
            with patch.object(server.runtime_paths, "bundled_runtime", side_effect=pick):
                exe.write_bytes(b"converter-a")
                one = server.import_cache_namespace(".dwg")
                exe.write_bytes(b"converter-b")
                two = server.import_cache_namespace(".dwg")
        self.assertNotEqual(one, two)


if __name__ == "__main__":
    unittest.main()
