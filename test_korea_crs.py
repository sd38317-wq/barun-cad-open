"""Oracle tests: python -B -m unittest -v test_korea_crs

The core API tests work without pyproj; oracle tests are skipped if it is absent.
No NumPy is used. Tests print maxima by output EPSG and WKT format.
All EPSG and literal PRJ tests use pyproj's default operation selection. Custom
Bessel WKT tests disable ballpark to enforce the requested fixed MB policy;
a separate regression test explicitly records the default-selector difference.
"""

import ast
import math
from pathlib import Path
import time
import unittest

import korea_crs as kc

try:
    from pyproj import CRS, Transformer
    from pyproj.exceptions import CRSError
except ImportError:
    CRS = Transformer = None

EPSGS = (4326, 4737, 4019, 4162, *range(5173, 5189),
         2096, 2097, 2098, 32651, 32652, 3857)
# All 825 Korean grid points, plus the exact +/-3 degree boundary of every
# distinct central meridian, including modified belts and UTM zone 51 (120E).
_CENTRES = (123, 125, 127, 129, 131, 127.5,
            125.002890277778, 127.002890277778,
            129.002890277778, 131.002890277778)
_LONGITUDES = sorted({124+i*.25 for i in range(33)} |
                     {c+d for c in _CENTRES for d in (-3, 3)})
GRID = tuple((lon, 33+j*.25) for lon in _LONGITUDES for j in range(25))
LONS, LATS = tuple(zip(*GRID))

# Literal PRJ fixtures intentionally use the common historical ESRI names.
CENTRAL_PRJ = '''PROJCS["Korea_2000_Korea_Central_Belt_2010",
GEOGCS["GCS_Korea_2000",DATUM["D_Korea_2000",
SPHEROID["GRS_1980",6378137.0,298.257222101]],
PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],
PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",200000.0],
PARAMETER["False_Northing",600000.0],PARAMETER["Central_Meridian",127.0],
PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",38.0],
UNIT["Meter",1.0]]'''
UNIFIED_PRJ = '''PROJCS["Korea_2000_Korea_Unified_Coordinate_System",
GEOGCS["GCS_Korea_2000",DATUM["D_Korea_2000",
SPHEROID["GRS_1980",6378137.0,298.257222101]],
PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],
PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",1000000.0],
PARAMETER["False_Northing",2000000.0],PARAMETER["Central_Meridian",127.5],
PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",38.0],
UNIT["Meter",1.0]]'''
BESSEL_PRJ = '''PROJCS["Korean_1985_Modified_Korea_Central_Belt",
GEOGCS["GCS_Korean_Datum_1985",DATUM["D_Korean_Datum_1985",
SPHEROID["Bessel_1841",6377397.155,299.1528128]],
PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],
PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",200000.0],
PARAMETER["False_Northing",500000.0],
PARAMETER["Central_Meridian",127.002890277778],
PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",38.0],
UNIT["Meter",1.0]]'''

# WKT2 fixture keeps the nested base/method IDs distinct from the top-level ID.
CENTRAL_WKT2 = '''PROJCRS["KGD2002 / Central Belt 2010",
BASEGEOGCRS["KGD2002",DATUM["Korean Geodetic Datum 2002",
ELLIPSOID["GRS 1980",6378137,298.257222101,LENGTHUNIT["metre",1]]],
PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],ID["EPSG",4737]],
CONVERSION["Korea Central Belt 2010",METHOD["Transverse Mercator",ID["EPSG",9807]],
PARAMETER["Latitude of natural origin",38,ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",8801]],
PARAMETER["Longitude of natural origin",127,ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",8802]],
PARAMETER["Scale factor at natural origin",1,SCALEUNIT["unity",1],ID["EPSG",8805]],
PARAMETER["False easting",200000,LENGTHUNIT["metre",1],ID["EPSG",8806]],
PARAMETER["False northing",600000,LENGTHUNIT["metre",1],ID["EPSG",8807]]],
CS[Cartesian,2],
AXIS["northing",north,ORDER[1],LENGTHUNIT["metre",1]],
AXIS["easting",east,ORDER[2],LENGTHUNIT["metre",1]],ID["EPSG",5186]]'''
GEOGRAPHIC_WKT2 = '''GEOGCRS["KGD2002",DATUM["Korean Geodetic Datum 2002",
ELLIPSOID["GRS 1980",6378137,298.257222101,LENGTHUNIT["metre",1]]],
PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],
CS[ellipsoidal,2],AXIS["latitude",north,ORDER[1]],
AXIS["longitude",east,ORDER[2]],ANGLEUNIT["degree",0.0174532925199433],
ID["EPSG",4737]]'''
WKT_STYLES = ('WKT2_2019', 'WKT2_2015', 'WKT1_GDAL', 'WKT1_ESRI')


def epsg(n):
    return 'EPSG:%s' % n


def custom_tm(ell='GRS80', unit=1.0):
    names = {
        'GRS80': ('D_Korea_2000', 'GRS_1980', 6378137, 298.257222101),
        'WGS84': ('D_WGS_1984', 'WGS_1984', 6378137, 298.257223563),
        'BESSEL': ('D_Korean_Datum_1985', 'Bessel_1841', 6377397.155, 299.1528128),
    }
    datum, spheroid, a, rf = names[ell]
    return (f'PROJCS["Custom TM {ell}",GEOGCS["Custom geog",'
            f'DATUM["{datum}",SPHEROID["{spheroid}",{a},{rf}]],'
            'PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]],'
            'PROJECTION["Transverse_Mercator"],'
            'PARAMETER["Latitude_Of_Origin",37],'
            'PARAMETER["Central_Meridian",126.3],'
            'PARAMETER["Scale_Factor",0.9999],'
            'PARAMETER["False_Easting",123456.7],'
            f'PARAMETER["False_Northing",456789.1],UNIT["Custom unit",{unit}]]')


class ApiTests(unittest.TestCase):
    def test_public_api_and_axis_order(self):
        source = kc.parse('epsg:4326')
        target = kc.parse('EPSG:5186')
        self.assertIs(kc.parse(source), source)
        self.assertTrue(source.is_geographic)
        self.assertFalse(target.is_geographic)
        self.assertEqual(target.name, 'EPSG:5186')
        self.assertEqual(target.unit, 1.0)
        self.assertEqual(kc.transformer(source, target).transform(127, 38),
                         (200000.0, 600000.0))
        self.assertEqual(kc.parse('\ufeff '+CENTRAL_PRJ).name, 'EPSG:5186')
        self.assertEqual(kc.parse(UNIFIED_PRJ).name, 'EPSG:5179')
        self.assertEqual(kc.parse(BESSEL_PRJ).name, 'EPSG:5174')

    def test_runtime_imports_math_only(self):
        tree = ast.parse(Path(kc.__file__).read_text(encoding='utf8'))
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                imported.add(node.module)
        self.assertEqual(imported, {'math'})

    def test_unsupported_and_malformed_inputs(self):
        invalid = [None, 5186, '', 'EPSG:²', 'EPSG:①', 'EPSG:'+'9'*5000, custom_tm(unit=1e308), 'EPSG:999999', 'EPSG:3395', 'EPSG:32653',
                   '+proj=tmerc +ellps=GRS80', 'PROJCS[', CENTRAL_PRJ+'junk',
                   CENTRAL_PRJ.replace('Transverse_Mercator', 'Lambert_Conformal_Conic'),
                   CENTRAL_PRJ.replace('D_Korea_2000', 'D_North_American_1983'),
                   CENTRAL_PRJ.replace('6378137.0', '6378200.0'),
                   CENTRAL_PRJ.replace('Greenwich",0.0', 'Paris",2.33722917'),
                   CENTRAL_PRJ.replace('UNIT["Meter",1.0]', 'UNIT["Meter",0]'),
                   CENTRAL_PRJ.replace('127.0]', 'NaN]'),
                   CENTRAL_PRJ.replace('1.0],PARAMETER["Latitude', '-1.0],PARAMETER["Latitude'),
                   CENTRAL_PRJ.replace('PROJECTION[', 'TOWGS84[1,2,3],PROJECTION['),
                   BESSEL_PRJ.replace('299.1528128]]', '299.1528128],TOWGS84[0,0,0]]'),
                   CENTRAL_PRJ.replace('UNIT["Meter",1.0]',
                                       'PARAMETER["False_Easting",1],UNIT["Meter",1.0]'),
                   CENTRAL_PRJ.replace('UNIT["Meter",1.0]',
                                       'AXIS["Westing",WEST],UNIT["Meter",1.0]')]
        for value in invalid:
            with self.subTest(value=str(value)[:70]):
                with self.assertRaisesRegex(ValueError, '^지원하지 않는 좌표계입니다: '):
                    kc.parse(value)
        with self.assertRaisesRegex(ValueError, '^지원하지 않는 좌표계입니다: '):
            kc.transformer('EPSG:4326', 'EPSG:999999')

    def test_wkt_does_not_trust_authority_or_name(self):
        wkt = CENTRAL_PRJ.replace('127.0]', '127.000000001]')
        wkt = wkt[:-1]+',AUTHORITY["EPSG","5186"]]'
        crs = kc.parse(wkt)
        self.assertNotEqual(crs.name, 'EPSG:5186')
        self.assertNotEqual(kc.transformer('EPSG:4326', crs).transform(127, 38),
                            (200000.0, 600000.0))

    def test_wkt2_keywords_ids_units_and_always_xy(self):
        for projected in ('PROJCRS', 'PROJECTEDCRS'):
            for base in ('BASEGEOGCRS', 'BASEGEODCRS'):
                wkt = CENTRAL_WKT2.replace('PROJCRS[', projected+'[')
                wkt = wkt.replace('BASEGEOGCRS[', base+'[')
                self.assertEqual(kc.parse(wkt).name, 'EPSG:5186')
                self.assertEqual(kc.transformer('EPSG:4326', wkt).transform(127, 38),
                                 (200000.0, 600000.0))
        for key in ('GEOGCRS', 'GEODCRS'):
            self.assertEqual(kc.parse(GEOGRAPHIC_WKT2.replace('GEOGCRS[', key+'[')).name,
                             'EPSG:4737')
        for key in ('BASEGEOGCRS', 'BASEGEODCRS'):
            base = ('%s["KGD2002",DATUM["Korean Geodetic Datum 2002",'
                    'ELLIPSOID["GRS 1980",6378137,298.257222101]]]' % key)
            self.assertEqual(kc.parse(base).name, 'EPSG:4737')
        # Stale supported IDs never override the actual projection or unit.
        wkt = CENTRAL_WKT2.replace('ID["EPSG",5186]', 'ID["EPSG",5187]')
        self.assertEqual(kc.parse(wkt).name, 'EPSG:5186')
        wkt = CENTRAL_WKT2.replace('origin",127,', 'origin",127.000000001,')
        self.assertNotEqual(kc.parse(wkt).name, 'EPSG:5186')
        self.assertNotEqual(kc.transformer('EPSG:4326', wkt).transform(127, 38),
                            (200000.0, 600000.0))
        wkt = CENTRAL_WKT2.replace('ID["EPSG",5186]', 'AUTHORITY["EPSG","5186"]')
        self.assertEqual(kc.parse(wkt).name, 'EPSG:5186')
        for axis in ('northing', 'easting'):
            old = 'AXIS["%s",%s,ORDER[%d],LENGTHUNIT["metre",1]]'
            direction, order = ('north', 1) if axis == 'northing' else ('east', 2)
            wkt = wkt.replace(old % (axis, direction, order),
                              (old % (axis, direction, order)).replace(
                                  'LENGTHUNIT["metre",1]', 'LENGTHUNIT["foot",0.3048]'))
        self.assertEqual(kc.parse(wkt).unit, .3048)
        self.assertLessEqual(math.dist(
            kc.transformer('EPSG:4326', wkt).transform(127, 38),
            (200000/.3048, 600000/.3048)), .0005/.3048)

    def test_wkt2_rejects_unsupported_semantics_despite_id(self):
        invalid = [
            CENTRAL_WKT2.replace('Transverse Mercator', 'Lambert Conic Conformal (2SP)'),
            CENTRAL_WKT2.replace('origin",127,', 'origin",NaN,'),
            CENTRAL_WKT2.replace('origin",127,', 'origin",181,'),
            CENTRAL_WKT2.replace('origin",1,SCALEUNIT', 'origin",-1,SCALEUNIT'),
            CENTRAL_WKT2.replace('PARAMETER["False northing"', 'PARAMETER["Unknown parameter"'),
            CENTRAL_WKT2.replace('CS[Cartesian,2]', 'CS[Cartesian,3]'),
            CENTRAL_WKT2.replace('6378137,298.', '6378200,298.'),
            CENTRAL_WKT2.replace('Greenwich",0,', 'Paris",2.33722917,'),
            CENTRAL_WKT2.replace('ORDER[1],LENGTHUNIT["metre",1]',
                                 'ORDER[1],LENGTHUNIT["foot",0.3048]'),
            CENTRAL_WKT2.replace('LENGTHUNIT["metre",1]', 'LENGTHUNIT["metre",0]'),
            CENTRAL_WKT2.replace('SCALEUNIT["unity",1]', 'ANGLEUNIT["radian",1]'),
            CENTRAL_WKT2.replace('CS[Cartesian,2]',
                                 'PARAMETER["False easting",0],CS[Cartesian,2]'),
            GEOGRAPHIC_WKT2.replace('CS[ellipsoidal,2]', 'CS[Cartesian,2]'),
            GEOGRAPHIC_WKT2.replace('Korean Geodetic Datum 2002', 'Unknown other datum'),
        ]
        for wkt in invalid:
            with self.subTest(wkt=wkt[:90]):
                with self.assertRaisesRegex(ValueError, '^지원하지 않는 좌표계입니다: '):
                    kc.parse(wkt)


@unittest.skipIf(CRS is None, 'pyproj is not installed (oracle only)')
class OracleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.started = time.perf_counter()
        cls.crss = {n: CRS.from_epsg(n) for n in EPSGS}
        cls.inputs = {}
        for n, crs in cls.crss.items():
            if crs.is_geographic:
                cls.inputs[n] = (LONS, LATS)
            else:
                cls.inputs[n] = Transformer.from_crs(
                    crs.geodetic_crs, crs, always_xy=True).transform(LONS, LATS)

    @classmethod
    def tearDownClass(cls):
        print('\nOracle suite elapsed: %.3f s' % (time.perf_counter()-cls.started))

    def check_grid(self, source, target, inputs=None, allow_ballpark=True, radians=False):
        ref_source = CRS.from_user_input(source)
        ref_target = CRS.from_user_input(target)
        if inputs is None:
            inputs = Transformer.from_crs(ref_source.geodetic_crs, ref_source,
                                          always_xy=True).transform(LONS, LATS)
        xs, ys = inputs
        rx, ry = Transformer.from_crs(ref_source, ref_target, always_xy=True,
                                      allow_ballpark=allow_ballpark).transform(xs, ys, radians=radians)
        transform = kc.transformer(source, target).transform
        largest, worst = 0.0, None
        for i, (x, y, ox, oy) in enumerate(zip(xs, ys, rx, ry)):
            px, py = transform(x, y)
            error = math.hypot(px-ox, py-oy)
            self.assertTrue(math.isfinite(error), (source, target, x, y, px, py))
            if error > largest:
                largest, worst = error, GRID[i]
        # Euclidean XY in metres, angular XY in degrees; tests here use degree CRS.
        tolerance = 1e-8 if ref_target.is_geographic else .0005/kc.parse(target).unit
        self.assertLessEqual(largest, tolerance,
                             (str(source)[:45], str(target)[:45], largest, worst))
        return largest

    def test_all_supported_pairs_full_grid(self):
        maxima = {n: 0.0 for n in EPSGS}
        worst_pair = {}
        visited = set()
        for source in EPSGS:
            for target in EPSGS:
                error = self.check_grid(epsg(source), epsg(target), self.inputs[source])
                visited.add((source, target))
                if error >= maxima[target]:
                    maxima[target], worst_pair[target] = error, source
        required = {(4326, 5179), (5179, 4326), (5179, 5187),
                    (5174, 5186), (2097, 5186), (5186, 5174)}
        self.assertTrue(required <= visited)
        self.assertEqual(len(visited), len(EPSGS)**2)
        print('\nAll %d CRS pairs x %d points = %d comparisons' %
              (len(visited), len(GRID), len(visited)*len(GRID)))
        print('Output EPSG    Maximum error       Worst source EPSG')
        for n in EPSGS:
            unit, scale = ('deg', 1) if self.crss[n].is_geographic else ('mm', 1000)
            print('%-14d %.12g %-4s       %s' %
                  (n, maxima[n]*scale, unit, worst_pair[n]))

    def test_esri_prj_examples_bidirectional(self):
        maximum = 0.0
        for wkt, code in ((CENTRAL_PRJ, 5186), (UNIFIED_PRJ, 5179), (BESSEL_PRJ, 5174)):
            self.assertEqual(kc.parse(wkt).name, epsg(code))
            for target in (4326, 5179, 5186, 5174):
                forward = self.check_grid(wkt, epsg(target), self.inputs[code])
                reverse = self.check_grid(epsg(target), wkt, self.inputs[target])
                if not self.crss[target].is_geographic:
                    maximum = max(maximum, forward)
                maximum = max(maximum, reverse)
        print('Literal ESRI PRJ maximum projected error: %.9g mm' % (maximum*1000))
        # The datum name must actually select MB, not a ballpark transform.
        oracle = Transformer.from_crs(CRS.from_wkt(BESSEL_PRJ), 5186, always_xy=True)
        self.assertIn('Korean 1985 to KGD2002 (1)', oracle.description)

    def test_epsg_datum_name_geocentric_datum_of_korea(self):
        # QGIS·GDAL 이 EPSG:5186 SHP 에 쓰는 WKT1 은 EPSG 공식 이름(Geocentric_datum_of_Korea)을 쓴다 (10-20 K48, A50).
        wkt = ('PROJCS["Korea 2000 / Central Belt 2010",GEOGCS["Korea 2000",'
               'DATUM["Geocentric_datum_of_Korea",SPHEROID["GRS 1980",6378137,298.257222101]],'
               'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],'
               'PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",38],'
               'PARAMETER["central_meridian",127],PARAMETER["scale_factor",1],'
               'PARAMETER["false_easting",200000],PARAMETER["false_northing",600000],UNIT["metre",1]]')
        self.assertEqual(kc.parse(wkt).name, epsg(5186))

    def test_every_epsg_in_four_wkt_formats(self):
        for style in WKT_STYLES:
            passed, skipped, maximum = 0, 0, 0.0
            for n in EPSGS:
                try:
                    wkt = (self.crss[n].to_wkt() if style == 'WKT2_2019'
                           else self.crss[n].to_wkt(style))
                except (CRSError, ValueError) as exc:
                    skipped += 1
                    with self.subTest(epsg=n, style=style):
                        self.skipTest('pyproj cannot export this format: '+str(exc))
                    continue
                with self.subTest(epsg=n, style=style):
                    self.assertEqual(kc.parse(wkt).name, epsg(n))
                    target = 5179 if self.crss[n].is_geographic else 5186
                    error = self.check_grid(wkt, epsg(target), self.inputs[n])
                    maximum = max(maximum, error)
                    passed += 1
            print('%s: %d passed, %d skipped, %d points, maximum %.12g mm' %
                  (style, passed, skipped, passed*len(GRID), maximum*1000))

    def test_custom_tm_and_feet(self):
        maximum = 0.0
        for ell in ('GRS80', 'WGS84', 'BESSEL'):
            for unit in (1.0, .3048, 1200/3937):
                wkt = custom_tm(ell, unit)
                parsed = kc.parse(wkt)
                self.assertEqual(parsed.unit, unit)
                self.assertFalse(parsed.name.startswith('EPSG:'))
                for target in (4326, 5174, 5186):
                    error = self.check_grid(wkt, epsg(target),
                                            allow_ballpark=ell != 'BESSEL')
                    if target != 4326:
                        maximum = max(maximum, error)
                    error = self.check_grid(epsg(target), wkt, self.inputs[target],
                                            allow_ballpark=ell != 'BESSEL')
                    maximum = max(maximum, error*unit)
        print('Custom TM / linear units (Bessel: fixed MB) maximum projected error: %.9g mm' % (maximum*1000))

    def test_custom_bessel_fixed_mb_policy(self):
        wkt = custom_tm('BESSEL')
        crs = CRS.from_wkt(wkt)
        xy = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True).transform(134, 33)
        fixed = Transformer.from_crs(crs, 4326, always_xy=True, allow_ballpark=False)
        default = Transformer.from_crs(crs, 4326, always_xy=True)
        got = kc.transformer(wkt, 'EPSG:4326').transform(*xy)
        self.assertLess(math.dist(got, fixed.transform(*xy)), 1e-8)
        self.assertGreater(math.dist(got, default.transform(*xy)), .001)
        print('Custom Bessel outside MB coverage: fixed MB intentionally differs '
              'from default pyproj ballpark.')

    def test_explicit_supported_towgs84(self):
        maxima = {'projected': 0.0, 'geographic': 0.0}

        def compare(source, target, inputs=None):
            error = self.check_grid(source, target, inputs)
            kind = 'geographic' if CRS.from_user_input(target).is_geographic else 'projected'
            maxima[kind] = max(maxima[kind], error)

        vector = ('-114.61998513853177,475.96296987030655,675.0183286857791,'
                  '1.162,-2.347,-1.592,6.342')
        bound = BESSEL_PRJ.replace('299.1528128]]',
                                  '299.1528128],TOWGS84['+vector+']]')
        for target in (4326, 4737, 4019, 4162, 5186):
            compare(bound, epsg(target))
            compare(epsg(target), bound, self.inputs[target])
        for code in (4326, 4737):
            for zeros in ('0,0,0', '0,0,0,0,0,0,0'):
                wkt = self.crss[code].to_wkt('WKT1_ESRI')
                wkt = wkt.replace(']],PRIMEM[', '],TOWGS84['+zeros+']],PRIMEM[')
                for target in (5174, 5186):
                    compare(wkt, epsg(target), self.inputs[code])
                    compare(epsg(target), wkt, self.inputs[target])
                with self.assertRaisesRegex(ValueError, '^지원하지 않는 좌표계입니다: '):
                    kc.parse(wkt.replace('TOWGS84[0,0,0', 'TOWGS84[1,0,0'))
        with self.assertRaisesRegex(ValueError, '^지원하지 않는 좌표계입니다: '):
            kc.parse(bound.replace('6.342]', '6.343]'))
        print('Supported TOWGS84 WKT maximum error: %.9g mm / %.9g deg' %
              (maxima['projected']*1000, maxima['geographic']))

    def test_wkt_angular_units_and_escaped_names(self):
        wkt = custom_tm().replace('Custom TM GRS80', 'Name with ""quoted"" text')
        # WKT1 parameters are expressed in the GEOGCS angular unit.
        wkt = wkt.replace('UNIT["Degree",0.0174532925199433]', 'UNIT["grad",0.015707963267948967]')
        wkt = wkt.replace('Origin",37]', 'Origin",41.11111111111111]')
        wkt = wkt.replace('Meridian",126.3]', 'Meridian",140.33333333333334]')
        self.check_grid(wkt, 'EPSG:5186')
        self.check_grid('EPSG:5186', wkt, self.inputs[5186])
        self.assertIn('"quoted"', kc.parse(wkt).name)

    def test_wkt2_parameter_ellipsoid_and_axis_units(self):
        maximum = 0.0
        # Parameter units differ from one another and from the coordinate axes.
        mixed = CENTRAL_WKT2.replace(
            'origin",38,ANGLEUNIT["degree",0.0174532925199433]',
            'origin",42.22222222222222,ANGLEUNIT["grad",0.015707963267948967]')
        mixed = mixed.replace(
            'origin",127,ANGLEUNIT["degree",0.0174532925199433]',
            'origin",2.2165681500327987,ANGLEUNIT["radian",1]')
        mixed = mixed.replace('origin",1,SCALEUNIT["unity",1]',
                              'origin",1000000,SCALEUNIT["ppm",0.000001]')
        mixed = mixed.replace('easting",200000,LENGTHUNIT["metre",1]',
                              'easting",656167.9790026246,LENGTHUNIT["foot",0.3048]')
        mixed = mixed.replace('6378137,298.257222101,LENGTHUNIT["metre",1]',
                              '20925646.325459316,298.257222101,LENGTHUNIT["foot",0.3048]')
        for unit in (1.0, .3048, 1200/3937):
            for common_unit in (False, True):
                wkt = mixed
                for axis, direction, order in (('northing', 'north', 1), ('easting', 'east', 2)):
                    wkt = wkt.replace(
                        'AXIS["%s",%s,ORDER[%d],LENGTHUNIT["metre",1]]' %
                        (axis, direction, order),
                        'AXIS["%s",%s,ORDER[%d]%s]' % (axis, direction, order,
                        '' if common_unit else ',LENGTHUNIT["custom",%r]' % unit))
                if common_unit:
                    wkt = wkt.replace('ID["EPSG",5186]',
                                      'LENGTHUNIT["custom",%r],ID["EPSG",5186]' % unit)
                self.assertEqual(kc.parse(wkt).unit, unit)
                maximum = max(maximum, self.check_grid(wkt, 'EPSG:5186'))
                maximum = max(maximum, self.check_grid(
                    'EPSG:5186', wkt, self.inputs[5186])*unit)
        for unit in (math.pi/200, 1.0):
            wkt = GEOGRAPHIC_WKT2.replace('ANGLEUNIT["degree",0.0174532925199433]',
                                          'ANGLEUNIT["custom",%r]' % unit)
            self.assertEqual(kc.parse(wkt).unit, unit)
            inputs = (tuple(v*kc._RAD/unit for v in LONS),
                      tuple(v*kc._RAD/unit for v in LATS))
            # pyproj's API defaults to degrees for a radian geographic CRS;
            # radians=True exposes the native CRS unit used by this engine.
            maximum = max(maximum, self.check_grid(
                wkt, 'EPSG:5179', inputs, radians=unit == 1.0))
            self.check_grid('EPSG:5186', wkt, self.inputs[5186], radians=unit == 1.0)
        # A modified WKT retaining EPSG:5186 must use the edited values.
        edited = CENTRAL_WKT2.replace('origin",127,', 'origin",126.3,')
        edited = edited.replace('northing",600000,', 'northing",456789.1,')
        self.assertFalse(kc.parse(edited).name.startswith('EPSG:'))
        maximum = max(maximum, self.check_grid(edited, 'EPSG:5186'))
        print('WKT2 edited parameters / mixed units maximum: %.12g mm' % (maximum*1000))

    def test_wkt2_bound_crs(self):
        vector = ','.join(map(str, kc._TOWGS84))
        bound = BESSEL_PRJ.replace('299.1528128]]',
                                  '299.1528128],TOWGS84['+vector+']]')
        maximum = 0.0
        for style in ('WKT2_2019', 'WKT2_2015'):
            wkt = CRS.from_wkt(bound).to_wkt(style)
            self.assertTrue(kc.parse(wkt)._bound)
            frame = wkt.replace('Position Vector transformation (geog2D domain)',
                                'Coordinate Frame rotation (geog2D domain)')
            frame = frame.replace('ID["EPSG",9606]', 'ID["EPSG",9607]')
            for value in ('1.162', '-2.347', '-1.592'):
                frame = frame.replace('rotation",'+value+',',
                                      'rotation",'+str(-float(value))+',')
            for version in (wkt, frame):
                for target in (4326, 4737, 4019, 4162, 5186):
                    error = self.check_grid(version, epsg(target))
                    if not self.crss[target].is_geographic:
                        maximum = max(maximum, error)
                    maximum = max(maximum, self.check_grid(
                        epsg(target), version, self.inputs[target]))
            for invalid in (
                    wkt.replace('Scale difference",1.000006342,',
                                'Scale difference",1.000006343,'),
                    wkt.replace('rotation",1.162,', 'rotation",1.163,'),
                    wkt.replace('translation",475.962969870307,',
                                'translation",476,'),
                    wkt.replace('Position Vector transformation (geog2D domain)', 'Unsupported'),
                    wkt.replace('PARAMETER["Scale difference"',
                                'PARAMETER["Unknown parameter"')):
                with self.subTest(style=style, invalid=invalid[-150:]):
                    with self.assertRaisesRegex(ValueError, '^지원하지 않는 좌표계입니다: '):
                        kc.parse(invalid)
            for code in (4326, 4737):
                for zeros in ('0,0,0', '0,0,0,0,0,0,0'):
                    modern = self.crss[code].to_wkt('WKT1_GDAL')
                    modern = modern.replace(']],PRIMEM[', '],TOWGS84['+zeros+']],PRIMEM[')
                    modern = CRS.from_wkt(modern).to_wkt(style)
                    self.check_grid(modern, 'EPSG:5174', self.inputs[code])
                    self.check_grid('EPSG:5174', modern, self.inputs[5174])
        print('WKT2 BOUNDCRS maximum projected error: %.12g mm' % (maximum*1000))


    def test_web_mercator_is_spherical(self):
        for style in ('WKT1_ESRI', 'WKT1_GDAL'):
            wkt = self.crss[3857].to_wkt(style)
            self.assertEqual(kc.parse(wkt).name, 'EPSG:3857')
            self.check_grid('EPSG:4326', wkt, self.inputs[4326])
            self.check_grid(wkt, 'EPSG:4326', self.inputs[3857])
        # Ellipsoidal Mercator must not be mistaken for web Mercator.
        with self.assertRaisesRegex(ValueError, '^지원하지 않는 좌표계입니다: '):
            kc.parse(CRS.from_epsg(3395).to_wkt('WKT1_GDAL'))

    def test_4019_unknown_datum_exception(self):
        for source, target in ((4162, 4019), (4019, 4162)):
            self.assertEqual(kc.transformer(epsg(source), epsg(target)).transform(127, 37),
                             Transformer.from_crs(source, target, always_xy=True).transform(127, 37))
        shifted = kc.transformer('EPSG:4162', 'EPSG:4737').transform(127, 37)
        self.assertGreater(math.dist(shifted, (127, 37)), .001)


class NoPyprojInAppTest(unittest.TestCase):
    """설치판은 pyproj 를 싣지 않는다(build_desktop.py). 앱 코드가 부르면 설치판에서만 ImportError 가 난다(10/23 아파트 가두리)."""
    def test_app_modules_do_not_import_pyproj(self):
        import re
        from pathlib import Path
        root = Path(__file__).resolve().parent
        bad = [p.name for p in root.glob('*.py')
               if not p.name.startswith('test_') and p.name != 'build_desktop.py'
               and re.search(r'^\s*(from pyproj|import pyproj)', p.read_text(encoding='utf-8', errors='replace'), re.M)]
        self.assertEqual(bad, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
