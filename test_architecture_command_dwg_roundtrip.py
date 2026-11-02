from collections import Counter
from pathlib import Path
import base64
import hashlib
import tempfile
import unittest

import exchange
from batch_converter import process


ROOT = Path(__file__).resolve().parent
SAMPLES = (
    ROOT / "작업도면" / "설치검증_건축평면.dxf",
    ROOT / "작업도면" / "새 도면.dxf",
    ROOT / "data" / "aihub-71465" / "full-catalog" / "design-trials" / "editable-house.dxf",
)


def entity_types(document):
    return Counter(entity.get("type", "unknown") for entity in document["entities"])


class ArchitectureCommandDwgRoundtripTests(unittest.TestCase):
    def test_real_barun_drawings_survive_dxf_dwg_dxf_roundtrip(self):
        for source in SAMPLES:
            with self.subTest(source=source.name), tempfile.TemporaryDirectory(prefix="barun_arch_dwg_") as folder:
                self.assertTrue(source.is_file(), source)
                source_hash = hashlib.sha256(source.read_bytes()).hexdigest()

                opened = exchange.import_file_path(source, ".dxf")
                document = opened["document"]
                self.assertGreater(len(document["entities"]), 0)

                exported, warnings = exchange.export_dxf(document, "R2018")
                conversion = process({
                    "action": "convert",
                    "name": source.stem + "_barun.dxf",
                    "direction": "dxf-dwg",
                    "version": "2018",
                    "folder": folder,
                    "data": base64.b64encode(exported).decode("ascii"),
                })
                self.assertFalse(conversion.get("failed"), conversion)

                dwg_path = Path(conversion["path"])
                self.assertTrue(dwg_path.is_file())
                reopened = exchange.import_file_path(dwg_path, ".dwg")
                self.assertEqual(reopened["report"]["sourceFormat"], "DWG")
                self.assertEqual(len(reopened["document"]["entities"]), len(document["entities"]))
                self.assertEqual(entity_types(reopened["document"]), entity_types(document))

                final_dxf, final_warnings = exchange.export_dxf(reopened["document"], "R2018")
                final_document = exchange.import_file(final_dxf, ".dxf")["document"]
                self.assertEqual(len(final_document["entities"]), len(document["entities"]))
                self.assertEqual(entity_types(final_document), entity_types(document))
                self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), source_hash)
                self.assertIsInstance(warnings, list)
                self.assertIsInstance(final_warnings, list)


if __name__ == "__main__":
    unittest.main()
