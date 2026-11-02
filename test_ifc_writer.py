"""직접 쓴 IFC(ifc-writer.js)가 진짜 IFC 인지 — 개발 PC 의 IfcOpenShell 로 열어 형식 검사·형상 만들기까지. 설치판에는 IfcOpenShell 을 넣지 않는다.
node ifc-writer.test.js 가 tmp/ifc-writer-sample.ifc 를 쓴다(없으면 여기서 node 로 만든다). IfcOpenShell 이 없으면 건너뛴다."""
import os, subprocess, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SAMPLE = ROOT / 'tmp' / 'ifc-writer-sample.ifc'
try:
    import ifcopenshell, ifcopenshell.geom, ifcopenshell.validate
except ImportError:
    ifcopenshell = None


@unittest.skipIf(ifcopenshell is None, 'IfcOpenShell 없음(개발 확인용)')
class IfcWriterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not SAMPLE.exists():
            subprocess.run(['node', '--test', '--test-name-pattern=확인용', 'ifc-writer.test.js'], cwd=ROOT, check=True, capture_output=True)
        cls.f = ifcopenshell.open(str(SAMPLE))

    def test_schema_and_counts(self):
        f = self.f
        self.assertEqual(f.schema, 'IFC4')
        self.assertEqual(len(f.by_type('IfcBuildingStorey')), 6)
        self.assertGreater(len(f.by_type('IfcWall')), 50)
        self.assertEqual(len(f.by_type('IfcStair')), 5)
        self.assertEqual(len(f.by_type('IfcStairFlight')), 10)
        roofs = [s for s in f.by_type('IfcSlab') if s.PredefinedType == 'ROOF']
        self.assertEqual(len(roofs), 1)
        self.assertEqual(f.by_type('IfcSpace')[0].Name and True, True)
        self.assertTrue(any('층' in (s.Name or '') or 'F' in (s.Name or '') for s in f.by_type('IfcBuildingStorey')))

    def test_schema_validation(self):
        logger = ifcopenshell.validate.json_logger()
        ifcopenshell.validate.validate(self.f, logger)
        self.assertEqual([s for s in logger.statements if s.get('level') == 'ERROR'][:5], [])

    def test_geometry_builds(self):
        settings = ifcopenshell.geom.settings()
        for t in ('IfcWall', 'IfcSlab', 'IfcStairFlight', 'IfcWindow', 'IfcDoor', 'IfcSpace'):
            el = self.f.by_type(t)[0]
            shape = ifcopenshell.geom.create_shape(settings, el)
            self.assertGreater(len(shape.geometry.verts), 0, t)
        # 계단 오름은 높이가 단수 × 단높이만큼 오른다
        fl = self.f.by_type('IfcStairFlight')[0]
        verts = ifcopenshell.geom.create_shape(settings, fl).geometry.verts
        zs = verts[2::3]
        self.assertAlmostEqual(max(zs) - 0, fl.NumberOfRisers * fl.RiserHeight / 1000, delta=0.05)


if __name__ == '__main__':
    unittest.main()
