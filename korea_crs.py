"""Small Korean CRS engine (scalar, always longitude/easting first).

Only math is required at runtime. Heights are zero at each datum operation,
matching PROJ's push/pop v_3 pipeline; an inverse datum operation is therefore
not an exact 2D round trip. TM uses the order-six Krueger series (Karney,
J. Geodesy 85, 2011, doi:10.1007/s00190-011-0445-3), also used by PROJ etmerc.
EPSG definitions were checked with pyproj 3.8.0 / PROJ 9.8.1.

4019 deliberately retains its *unknown* datum: PROJ uses a ballpark geographic
identity, rather than Korean 1985's MB operation, when either CRS has that datum.
WGS84 and KGD2002 otherwise share geographic coordinates (no datum shift).
Unlisted Korean 1985 WKT uses MB everywhere, as the application's fixed datum
policy requires. PROJ's default may instead choose ballpark outside Korea for
custom CRS without an area of use; compare those with allow_ballpark=False.
"""

import math

__all__ = ['parse', 'transformer']

_RAD = math.pi / 180.0
_ELLIPSOIDS = {
    'WGS84': (6378137.0, 298.257223563),
    'GRS80': (6378137.0, 298.257222101),
    'BESSEL': (6377397.155, 299.1528128),
}
# EPSG: (ellipsoid, latitude of origin, central meridian, k0, FE[m], FN[m]).
# Expanded UTM definitions: lat_0=0, k0=.9996, FE=500000, FN=0.
_TM = {
    5173: ('BESSEL', 38, 125.002890277778, 1, 200000, 500000),
    5174: ('BESSEL', 38, 127.002890277778, 1, 200000, 500000),
    5175: ('BESSEL', 38, 127.002890277778, 1, 200000, 550000),
    5176: ('BESSEL', 38, 129.002890277778, 1, 200000, 500000),
    5177: ('BESSEL', 38, 131.002890277778, 1, 200000, 500000),
    5178: ('BESSEL', 38, 127.5, .9996, 1000000, 2000000),
    5179: ('GRS80', 38, 127.5, .9996, 1000000, 2000000),
    5180: ('GRS80', 38, 125, 1, 200000, 500000),
    5181: ('GRS80', 38, 127, 1, 200000, 500000),
    5182: ('GRS80', 38, 127, 1, 200000, 550000),
    5183: ('GRS80', 38, 129, 1, 200000, 500000),
    5184: ('GRS80', 38, 131, 1, 200000, 500000),
    5185: ('GRS80', 38, 125, 1, 200000, 600000),
    5186: ('GRS80', 38, 127, 1, 200000, 600000),
    5187: ('GRS80', 38, 129, 1, 200000, 600000),
    5188: ('GRS80', 38, 131, 1, 200000, 600000),
    2096: ('BESSEL', 38, 129, 1, 200000, 500000),
    2097: ('BESSEL', 38, 127, 1, 200000, 500000),
    2098: ('BESSEL', 38, 125, 1, 200000, 500000),
    32651: ('WGS84', 0, 123, .9996, 500000, 0),
    32652: ('WGS84', 0, 129, .9996, 500000, 0),
}
_GEO = {4326: ('WGS84', 'modern'), 4737: ('GRS80', 'modern'),
        4019: ('GRS80', 'unknown'), 4162: ('BESSEL', 'korean1985')}


def _coefficients(n):
    """Forward alpha and inverse beta coefficients, through n**6."""
    return (
        (n*(1/2+n*(-2/3+n*(5/16+n*(41/180+n*(-127/288+n*7891/37800))))),
         n**2*(13/48+n*(-3/5+n*(557/1440+n*(281/630-n*1983433/1935360)))),
         n**3*(61/240+n*(-103/140+n*(15061/26880+n*167603/181440))),
         n**4*(49561/161280+n*(-179/168+n*6601661/7257600)),
         n**5*(34729/80640-n*3418889/1995840),
         n**6*212378941/319334400),
        (n*(1/2+n*(-2/3+n*(37/96+n*(-1/360+n*(-81/512+n*96199/604800))))),
         n**2*(1/48+n*(1/15+n*(-437/1440+n*(46/105-n*1118711/3870720)))),
         n**3*(17/480+n*(-37/840+n*(-209/4480+n*5569/90720))),
         n**4*(4397/161280+n*(-11/504-n*830251/7257600)),
         n**5*(4583/161280-n*108847/3991680),
         n**6*20648693/638668800),
    )


class _CRS:
    def __init__(self, name, ellipsoid, datum, kind='geo', params=None, unit=1.0,
                 bound=False):
        self.name = name
        self.is_geographic = kind == 'geo'
        self.unit = unit
        self._ellipsoid, self._datum, self._kind = ellipsoid, datum, kind
        self._params = params
        self._bound = bound
        self._a, rf = _ELLIPSOIDS[ellipsoid]
        f = 1.0 / rf
        self._e2 = f * (2 - f)
        self._e = math.sqrt(self._e2)
        if kind == 'tm':
            lat0, lon0, k, self._fe, self._fn = params
            self._lon0 = lon0 * _RAD
            n = f / (2 - f)
            self._alpha, self._beta = _coefficients(n)
            self._radius = k*self._a/(1+n)*(1+n*n/4+n**4/64+n**6/256)
            xi, eta = self._rectifying(lat0 * _RAD, 0.0)
            self._origin = xi
            if not all(math.isfinite(v) for v in
                       (self._fe, self._fn, self._radius, self._origin)):
                raise ValueError('non-finite derived TM parameters')

    def _rectifying(self, lat, lon):
        # Exact ellipsoidal -> conformal latitude, then spherical TM.
        taup = math.sinh(math.asinh(math.tan(lat))
                         - self._e*math.atanh(self._e*math.sin(lat)))
        xi = math.atan2(taup, math.cos(lon))
        eta = math.asinh(math.sin(lon)/math.hypot(taup, math.cos(lon)))
        return (xi + sum(a*math.sin(2*j*xi)*math.cosh(2*j*eta)
                         for j, a in enumerate(self._alpha, 1)),
                eta + sum(a*math.cos(2*j*xi)*math.sinh(2*j*eta)
                          for j, a in enumerate(self._alpha, 1)))

    def _forward(self, lon, lat):
        if self._kind == 'geo':
            return lon/self.unit, lat/self.unit
        if self._kind == 'merc':
            return (self._a*lon/self.unit,
                    self._a*math.asinh(math.tan(lat))/self.unit)
        lon = (lon-self._lon0+math.pi) % (2*math.pi)-math.pi
        xi, eta = self._rectifying(lat, lon)
        return ((self._fe+self._radius*eta)/self.unit,
                (self._fn+self._radius*(xi-self._origin))/self.unit)

    def _inverse(self, x, y):
        if self._kind == 'geo':
            return x*self.unit, y*self.unit
        if self._kind == 'merc':
            return x*self.unit/self._a, math.atan(math.sinh(y*self.unit/self._a))
        xi = (y*self.unit-self._fn)/self._radius+self._origin
        eta = (x*self.unit-self._fe)/self._radius
        xp = xi - sum(b*math.sin(2*j*xi)*math.cosh(2*j*eta)
                      for j, b in enumerate(self._beta, 1))
        ep = eta - sum(b*math.cos(2*j*xi)*math.sinh(2*j*eta)
                       for j, b in enumerate(self._beta, 1))
        lon = self._lon0+math.atan2(math.sinh(ep), math.cos(xp))
        taup = math.sin(xp)/math.hypot(math.sinh(ep), math.cos(xp))
        # Solve isometric latitude; Newton converges in <= 5 steps here.
        psi = math.asinh(taup)
        lat = math.atan(taup)
        for _ in range(8):
            s, c = math.sin(lat), math.cos(lat)
            d = (psi-math.asinh(math.tan(lat))+self._e*math.atanh(self._e*s))
            d *= c*(1-self._e2*s*s)/(1-self._e2)
            lat += d
            if abs(d) < 2e-16:
                break
        return lon, lat


_CATALOG = {}
for _epsg, (_ell, _datum) in _GEO.items():
    _CATALOG[_epsg] = _CRS('EPSG:%s' % _epsg, _ell, _datum, unit=_RAD)
for _epsg, (_ell, *_params) in _TM.items():
    _CATALOG[_epsg] = _CRS('EPSG:%s' % _epsg, _ell,
                          'korean1985' if _ell == 'BESSEL' else 'modern',
                          'tm', tuple(_params))
_CATALOG[3857] = _CRS('EPSG:3857', 'WGS84', 'modern', 'merc')

# EPSG operation 5189/5191. Coordinate-frame, linearized rotation.
_PIVOT = (-3159521.31, 4068151.32, 3748113.85)
_SHIFT = (-145.907, 505.034, 685.756)
_RX, _RY, _RZ = (v*_RAD/3600 for v in (-1.162, 2.347, 1.592))
_SCALE = 1 + 6.342e-6
# Equivalent unpivoted, position-vector Helmert values for a bound WKT1 CRS.
_TOWGS84 = (-114.61998513853177, 475.96296987030655, 675.0183286857791,
            1.162, -2.347, -1.592, 6.342)


def _datum_shift(lon, lat, source, target):
    bound = source._bound or target._bound
    pivot, shift = ((0.0, 0.0, 0.0), _TOWGS84[:3]) if bound else (_PIVOT, _SHIFT)
    # PROJ's reverse bound operation enters through cart(WGS84), including
    # for KGD2002 input; the forward operation uses the target ellipsoid.
    src = _CATALOG[4326] if bound and source._datum != 'korean1985' else source
    dst = target
    s, c = math.sin(lat), math.cos(lat)
    n = src._a/math.sqrt(1-src._e2*s*s)
    x = n*c*math.cos(lon)-pivot[0]
    y = n*c*math.sin(lon)-pivot[1]
    z = n*(1-src._e2)*s-pivot[2]
    if source._datum == 'korean1985':
        x, y, z = (_SCALE*(x+_RZ*y-_RY*z)+shift[0],
                   _SCALE*(-_RZ*x+y+_RX*z)+shift[1],
                   _SCALE*(_RY*x-_RX*y+z)+shift[2])
    else:
        x, y, z = ((x-shift[0])/_SCALE, (y-shift[1])/_SCALE,
                   (z-shift[2])/_SCALE)
        # PROJ uses the transposed small-angle rotation, NOT a matrix inverse.
        x, y, z = x-_RZ*y+_RY*z, _RZ*x+y-_RX*z, -_RY*x+_RX*y+z
    x, y, z = x+pivot[0], y+pivot[1], z+pivot[2]
    p = math.hypot(x, y)
    lon = math.atan2(y, x)
    lat = math.atan2(z, p*(1-dst._e2))
    for _ in range(10):
        n = dst._a/math.sqrt(1-dst._e2*math.sin(lat)**2)
        new = math.atan2(z+dst._e2*n*math.sin(lat), p)
        if abs(new-lat) < 2e-16:
            return lon, new
        lat = new
    return lon, lat


class _Transformer:
    def __init__(self, source, target):
        self._source, self._target = source, target
        self._shift = ('unknown' not in (source._datum, target._datum)
                       and (source._datum == 'korean1985')
                       != (target._datum == 'korean1985'))
        self._identity = (source is target or not self._shift
                          and source.is_geographic and target.is_geographic
                          and source.unit == target.unit)

    def transform(self, x, y):
        """Transform two scalar coordinates, with height zero for datum shifts."""
        x, y = float(x), float(y)
        if self._identity:
            return x, y
        if not (math.isfinite(x) and math.isfinite(y)):
            return math.inf, math.inf
        try:
            lon, lat = self._source._inverse(x, y)
            if abs(lat) > math.pi/2:
                return math.inf, math.inf
            if self._shift:
                lon, lat = _datum_shift(lon, lat, self._source, self._target)
            return self._target._forward(lon, lat)
        except (OverflowError, ValueError, ZeroDivisionError):
            return math.inf, math.inf


def transformer(source, target):
    """Build an always-XY transform; custom Korean 1985 WKT keeps MB fixed."""
    return _Transformer(parse(source), parse(target))


def _normal(value):
    return ''.join(c.lower() for c in value if c.isalnum())


def _wkt_tree(text):
    """Parse WKT1/2 with proper nesting and doubled-quote escapes (no regex)."""
    pos, length = 0, len(text)

    def space():
        nonlocal pos
        while pos < length and text[pos].isspace():
            pos += 1

    def value(depth=0):
        nonlocal pos
        if depth > 20:
            raise ValueError('WKT nesting')
        space()
        if pos >= length:
            raise ValueError('incomplete WKT')
        if text[pos] == '"':
            pos += 1
            out = ''
            while pos < length:
                c = text[pos]
                pos += 1
                if c == '"':
                    if pos < length and text[pos] == '"':
                        out += '"'
                        pos += 1
                    else:
                        return out
                else:
                    out += c
            raise ValueError('unclosed quote')
        start = pos
        while pos < length and not text[pos].isspace() and text[pos] not in '[],()':
            pos += 1
        token = text[start:pos]
        if not token:
            raise ValueError('empty token')
        space()
        if pos < length and text[pos] in '[(':
            closing = ']' if text[pos] == '[' else ')'
            pos += 1
            args = [value(depth+1)]
            while True:
                space()
                if pos >= length:
                    raise ValueError('unclosed node')
                c = text[pos]
                pos += 1
                if c == closing:
                    return token.upper(), args
                if c != ',':
                    raise ValueError('expected comma')
                args.append(value(depth+1))
        try:
            number = float(token)
        except ValueError:
            return token  # AXIS direction, for example EAST.
        if not math.isfinite(number):
            raise ValueError('non-finite WKT number')
        return number

    tree = value()
    space()
    if pos != length or not isinstance(tree, tuple):
        raise ValueError('trailing WKT')
    return tree


def _nodes(node, key):
    return [v for v in node[1] if isinstance(v, tuple) and v[0] == key]


def _one(node, key):
    matches = _nodes(node, key)
    if len(matches) != 1:
        raise ValueError('expected one '+key)
    return matches[0]


def _number(value):
    if not isinstance(value, float) or not math.isfinite(value):
        raise ValueError('expected numeric parameter')
    return value


def _check_nodes(node, allowed, start=1, wkt2=False):
    if not node[1] or not isinstance(node[1][0], str):
        raise ValueError('expected WKT name')
    for v in node[1][start:]:
        if not isinstance(v, tuple) or v[0] not in allowed:
            raise ValueError('unsupported WKT element')
    for axis in _nodes(node, 'AXIS'):
        if (len(axis[1]) < 2 or not isinstance(axis[1][1], str)
                or axis[1][1].upper() not in ('EAST', 'NORTH')
                or not wkt2 and len(axis[1]) != 2):
            raise ValueError('unsupported axis')
        if wkt2:
            _check_nodes(axis, {'ORDER', 'LENGTHUNIT', 'ANGLEUNIT', 'ID', 'AUTHORITY'}, start=2)



_WKT2_GEO = {'GEOGCRS', 'GEODCRS', 'GEOGRAPHICCRS', 'GEODETICCRS'}
_WKT2_BASE = {'BASEGEOGCRS', 'BASEGEODCRS',
              'BASEGEOGRAPHICCRS', 'BASEGEODETICCRS'}
_WKT2_PROJ = {'PROJCRS', 'PROJECTEDCRS'}
_METADATA = {'ID', 'AUTHORITY', 'USAGE', 'SCOPE', 'AREA', 'BBOX', 'REMARK'}
_PARAMETER_NAMES = {
    'latitudeofnaturalorigin': 'latitudeoforigin',
    'longitudeofnaturalorigin': 'centralmeridian',
    'scalefactoratnaturalorigin': 'scalefactor',
    'latitudeoforigin': 'latitudeoforigin',
    'centralmeridian': 'centralmeridian', 'scalefactor': 'scalefactor',
    'falseeasting': 'falseeasting', 'falsenorthing': 'falsenorthing',
}


def _epsg_code(node):
    # Only direct identifiers belong to this CRS; a base CRS/method ID does not.
    for identifier in _nodes(node, 'ID') + _nodes(node, 'AUTHORITY'):
        args = identifier[1]
        if len(args) >= 2 and str(args[0]).upper() == 'EPSG':
            code = str(args[1])
            if isinstance(args[1], float) and args[1].is_integer():
                code = str(int(args[1]))
            if code.isascii() and code.isdigit() and len(code) < 12:
                number = int(code)
                if number in _CATALOG:
                    return number
    return None


def _wkt_unit(node, key, default=None):
    units = _nodes(node, key)
    if not units:
        return default
    if len(units) != 1:
        raise ValueError('duplicate unit')
    _check_nodes(units[0], {'ID', 'AUTHORITY'}, start=2)
    factor = _number(units[0][1][1])
    if factor <= 0:
        raise ValueError('unit factor')
    return factor


def _wkt2_coordinate_unit(node, key, default=None):
    base = node[0] in _WKT2_BASE
    systems = _nodes(node, 'CS')
    axes = _nodes(node, 'AXIS')
    if not base or systems:
        cs = _one(node, 'CS')[1]
        expected = 'cartesian' if node[0] in _WKT2_PROJ else 'ellipsoidal'
        if (len(cs) != 2 or not isinstance(cs[0], str)
                or cs[0].lower() != expected or _number(cs[1]) != 2
                or len(axes) != 2
                or {axis[1][1].upper() for axis in axes} != {'NORTH', 'EAST'}):
            raise ValueError('only horizontal 2D CS is supported')
    elif axes:
        raise ValueError('axes without CS')
    common = _wkt_unit(node, key)
    factors = [_wkt_unit(axis, key, common) for axis in axes]
    if common is not None:
        factors.append(common)
    if not factors:
        factors = [default]
    if any(f is None or f != factors[0] for f in factors):
        raise ValueError('missing or different axis units')
    return factors[0]


def _wkt2_to_wkt1(tree):
    """Normalize supported WKT2 semantics for the shared WKT1 validator.

    Parameters have their own units in WKT2; coordinate-axis units only set
    the CRS input/output unit. No identifier bypasses the numeric validation.
    """
    kind = tree[0]
    if kind in ('PROJCS', 'GEOGCS'):
        return tree
    if kind == 'BOUNDCRS':
        return _wkt2_bound(tree)
    projected = kind in _WKT2_PROJ
    if not projected and kind not in _WKT2_GEO | _WKT2_BASE:
        raise ValueError('unsupported WKT CRS')
    geo_keys = {'DATUM', 'GEODETICDATUM', 'ENSEMBLE', 'PRIMEM', 'ANGLEUNIT',
                'CS', 'AXIS'} | _METADATA
    _check_nodes(tree, (_WKT2_BASE | {'CONVERSION', 'LENGTHUNIT', 'CS', 'AXIS'}
                        | _METADATA) if projected else geo_keys, wkt2=True)
    if projected:
        bases = [v for v in tree[1] if isinstance(v, tuple) and v[0] in _WKT2_BASE]
        if len(bases) != 1:
            raise ValueError('expected one base geographic CRS')
        geo = _wkt2_to_wkt1(bases[0])
        angular = _number(_one(geo, 'UNIT')[1][1])
        linear = _wkt2_coordinate_unit(tree, 'LENGTHUNIT')
        conversion = _one(tree, 'CONVERSION')
        _check_nodes(conversion, {'METHOD', 'PARAMETER'} | _METADATA)
        method = _one(conversion, 'METHOD')
        _check_nodes(method, {'ID', 'AUTHORITY'})
        parameters = []
        for param in _nodes(conversion, 'PARAMETER'):
            key = _PARAMETER_NAMES.get(_normal(param[1][0]))
            if key is None:
                raise ValueError('unsupported conversion parameter')
            unit_key, fallback = (('ANGLEUNIT', angular) if key in
                                  {'latitudeoforigin', 'centralmeridian'} else
                                  ('SCALEUNIT', 1.0) if key == 'scalefactor' else
                                  ('LENGTHUNIT', linear))
            _check_nodes(param, {unit_key, 'ID', 'AUTHORITY'}, start=2)
            value = _number(param[1][1])*_wkt_unit(param, unit_key, fallback)/fallback
            parameters.append(('PARAMETER', [key, value]))
        normalized = ('PROJCS', [tree[1][0], geo,
                                 ('PROJECTION', [method[1][0]]), *parameters,
                                 ('UNIT', ['linear', linear])])
    else:
        angular = _wkt2_coordinate_unit(tree, 'ANGLEUNIT', _RAD)
        datums = [v for v in tree[1] if isinstance(v, tuple)
                  and v[0] in {'DATUM', 'GEODETICDATUM', 'ENSEMBLE'}]
        if len(datums) != 1:
            raise ValueError('expected one datum or ensemble')
        datum = datums[0]
        _check_nodes(datum, {'ELLIPSOID', 'ID', 'AUTHORITY'} |
                     ({'MEMBER', 'ENSEMBLEACCURACY'} if datum[0] == 'ENSEMBLE' else set()))
        ellipsoid = _one(datum, 'ELLIPSOID')
        _check_nodes(ellipsoid, {'LENGTHUNIT', 'ID', 'AUTHORITY'}, start=3)
        a = _number(ellipsoid[1][1])*_wkt_unit(ellipsoid, 'LENGTHUNIT', 1.0)
        rf = _number(ellipsoid[1][2])
        datum_name = datum[1][0]
        if (datum[0] == 'ENSEMBLE'
                and _normal(datum_name) == 'worldgeodeticsystem1984ensemble'):
            datum_name = 'World Geodetic System 1984'
        primes = _nodes(tree, 'PRIMEM')
        if len(primes) > 1:
            raise ValueError('duplicate prime meridian')
        prime = primes[0] if primes else ('PRIMEM', ['Greenwich', 0.0])
        _check_nodes(prime, {'ANGLEUNIT', 'ID', 'AUTHORITY'}, start=2)
        _wkt_unit(prime, 'ANGLEUNIT', angular)
        normalized = ('GEOGCS', [tree[1][0],
                                 ('DATUM', [datum_name, ('SPHEROID',
                                  [ellipsoid[1][0], a, rf])]),
                                 ('PRIMEM', prime[1][:2]),
                                 ('UNIT', ['angular', angular])])
    code = _epsg_code(tree)
    if code is not None:
        normalized[1].append(('AUTHORITY', ['EPSG', str(code)]))
    return normalized


def _wkt2_bound(tree):
    # A bound CRS is an explicit datum operation, equivalent to WKT1 TOWGS84.
    if any(not isinstance(v, tuple) or v[0] not in
           {'SOURCECRS', 'TARGETCRS', 'ABRIDGEDTRANSFORMATION'} | _METADATA
           for v in tree[1]):
        raise ValueError('unsupported bound CRS element')

    def wrapped(key):
        args = _one(tree, key)[1]
        if len(args) != 1 or not isinstance(args[0], tuple) or args[0][0] == 'BOUNDCRS':
            raise ValueError('expected one unbound CRS')
        return args[0]

    target = _parse_wkt_tree(wrapped('TARGETCRS'))
    if not (target.is_geographic and target._ellipsoid == 'WGS84'
            and target._datum == 'modern'):
        raise ValueError('only a WGS84 bound target is supported')
    operation = _one(tree, 'ABRIDGEDTRANSFORMATION')
    _check_nodes(operation, {'METHOD', 'PARAMETER'} | _METADATA)
    method = _one(operation, 'METHOD')
    _check_nodes(method, {'ID', 'AUTHORITY'})
    method_name = _normal(method[1][0])
    position = {'positionvector', 'positionvectortransformationgeog2ddomain'}
    frame = {'coordinateframe', 'coordinateframerotationgeog2ddomain'}
    translation = {'geocentrictranslations', 'geocentrictranslationsgeog2ddomain'}
    if method_name not in position | frame | translation:
        raise ValueError('unsupported bound operation')
    params = {}
    for param in _nodes(operation, 'PARAMETER'):
        _check_nodes(param, {'ID', 'AUTHORITY'}, start=2)
        key = _normal(param[1][0])
        if key in params:
            raise ValueError('duplicate bound parameter')
        params[key] = _number(param[1][1])
    names = ['xaxistranslation', 'yaxistranslation', 'zaxistranslation']
    if method_name not in translation:
        names += ['xaxisrotation', 'yaxisrotation', 'zaxisrotation', 'scaledifference']
    if set(params) != set(names):
        raise ValueError('bound parameters')
    values = [params[key] for key in names]
    if len(values) == 7:
        if method_name in frame:
            values[3:6] = [-v for v in values[3:6]]
        # WKT2 abridged scale is a ratio, not a ppm difference (OGC 12-063r5
        # 18.2.3). Allow its serialization round-off in the shared validator.
        values[6] = (values[6]-1)*1e6
    source = _wkt2_to_wkt1(wrapped('SOURCECRS'))
    geo = _one(source, 'GEOGCS') if source[0] == 'PROJCS' else source
    datum = _one(geo, 'DATUM')
    if _nodes(datum, 'TOWGS84'):
        raise ValueError('duplicate bound operation')
    datum[1].append(('TOWGS84', values))
    return source


def _parse_wkt(text):
    return _parse_wkt_tree(_wkt_tree(text))


def _parse_wkt_tree(tree):
    tree = _wkt2_to_wkt1(tree)
    kind = tree[0]
    if kind not in ('PROJCS', 'GEOGCS'):
        raise ValueError('not a supported CRS')
    _check_nodes(tree, {'GEOGCS', 'PROJECTION', 'PARAMETER', 'UNIT', 'AUTHORITY',
                        'AXIS', 'EXTENSION'} if kind == 'PROJCS' else
                       {'DATUM', 'PRIMEM', 'UNIT', 'AUTHORITY', 'AXIS'})
    geo = _one(tree, 'GEOGCS') if kind == 'PROJCS' else tree
    _check_nodes(geo, {'DATUM', 'PRIMEM', 'UNIT', 'AUTHORITY', 'AXIS'})
    datum = _one(geo, 'DATUM')
    _check_nodes(datum, {'SPHEROID', 'AUTHORITY', 'TOWGS84'})
    spheroid = _one(datum, 'SPHEROID')[1]
    if len(spheroid) < 3:
        raise ValueError('spheroid')
    a, rf = _number(spheroid[1]), _number(spheroid[2])
    ell = next((e for e, v in _ELLIPSOIDS.items()
                if abs(a-v[0]) < 1e-6 and abs(rf-v[1]) < 1e-8), None)
    dn = _normal(datum[1][0])
    aliases = {
        'WGS84': {'wgs1984', 'dwgs1984', 'wgs84', 'worldgeodeticsystem1984'},
        'GRS80': {'koreangeodeticdatum2002', 'dkoreageodeticdatum2002',
                  'koreageodeticdatum2002', 'korea2000', 'dkorea2000',
                  'kgd2002', 'dkgd2002',
                  # EPSG:6737 공식 이름 — QGIS·GDAL 이 내보내는 PRJ (A50)
                  'geocentricdatumofkorea', 'dgeocentricdatumofkorea'},
        'BESSEL': {'koreandatum1985', 'dkoreandatum1985', 'korean1985',
                   'dkorean1985'},
    }
    unknown = dn in {'notspecifiedbasedongrs1980ellipsoid', 'dunknown', 'unknown', 'dgrs1980'}
    if ell == 'GRS80' and unknown:
        family = 'unknown'
    elif ell and dn in aliases[ell]:
        family = 'korean1985' if ell == 'BESSEL' else 'modern'
    else:
        raise ValueError('unsupported datum or ellipsoid')
    bound = False
    overrides = _nodes(datum, 'TOWGS84')
    if overrides:
        if len(overrides) != 1:
            raise ValueError('duplicate TOWGS84')
        values = tuple(_number(v) for v in overrides[0][1])
        if family == 'modern' and len(values) in (3, 7) and all(v == 0 for v in values):
            pass
        elif (family == 'korean1985' and len(values) == 7
              and all(abs(v-ref) <= tol for v, ref, tol in
                      zip(values, _TOWGS84, (1e-9, 1e-9, 1e-9, 1e-12, 1e-12, 1e-12, 2e-9)))):
            bound = True
        else:
            raise ValueError('different TOWGS84 operation')
    prime = _one(geo, 'PRIMEM')[1]
    if len(prime) < 2 or _number(prime[1]) != 0:
        raise ValueError('non-Greenwich prime meridian')
    angular = _number(_one(geo, 'UNIT')[1][1])
    if angular <= 0:
        raise ValueError('angular unit')
    name = tree[1][0]
    if kind == 'GEOGCS':
        candidate = _CRS(name, ell, family, unit=angular, bound=bound)
    else:
        projection = _normal(_one(tree, 'PROJECTION')[1][0])
        unit = _number(_one(tree, 'UNIT')[1][1])
        if unit <= 0:
            raise ValueError('linear unit')
        params = {}
        for p in _nodes(tree, 'PARAMETER'):
            if len(p[1]) != 2 or not isinstance(p[1][0], str):
                raise ValueError('parameter')
            key = _normal(p[1][0])
            if key in params:
                raise ValueError('duplicate parameter')
            params[key] = _number(p[1][1])
        required = {'latitudeoforigin', 'centralmeridian', 'scalefactor',
                    'falseeasting', 'falsenorthing'}
        if projection == 'transversemercator':
            if set(params) != required or _nodes(tree, 'EXTENSION'):
                raise ValueError('TM parameters')
            lat0 = params['latitudeoforigin']*angular/_RAD
            lon0 = params['centralmeridian']*angular/_RAD
            k = params['scalefactor']
            if abs(lat0) > 90 or abs(lon0) > 180 or k <= 0:
                raise ValueError('TM parameter range')
            candidate = _CRS(name, ell, family, 'tm',
                             (lat0, lon0, k, params['falseeasting']*unit,
                              params['falsenorthing']*unit), unit, bound=bound)
        else:
            # WKT1_GDAL 3857 uses Mercator_1SP plus this spherical extension.
            # Plain ellipsoidal Mercator_1SP is EPSG:3395 and is unsupported.
            ext = _nodes(tree, 'EXTENSION')
            spherical = (len(ext) == 1 and ext[0][1] == ['PROJ4',
                         '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 '
                         '+x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs'])
            is_merc = projection in {'mercatorauxiliarysphere',
                                    'popularvisualisationpseudomercator'}
            if not (is_merc or projection == 'mercator1sp' and spherical):
                raise ValueError('projection')
            allowed = required | {'standardparallel1', 'auxiliaryspheretype'}
            if (ell != 'WGS84' or family != 'modern' or set(params)-allowed
                    or any(v != (1 if k == 'scalefactor' else 0)
                           for k, v in params.items())
                    or not {'falseeasting', 'falsenorthing', 'centralmeridian'} <= set(params)
                    or (ext and not spherical)):
                raise ValueError('non-3857 Mercator')
            candidate = _CRS(name, ell, family, 'merc', unit=unit)
    preferred = _CATALOG.get(_epsg_code(tree))
    for known in ([preferred] if preferred is not None else []) + list(_CATALOG.values()):
        if (not candidate._bound and candidate._ellipsoid == known._ellipsoid
                and candidate._datum == known._datum and candidate._kind == known._kind
                and abs(candidate.unit-known.unit) < 1e-14
                and (candidate._params is None or
                     all(abs(x-y) < tol for x, y, tol in zip(
                         candidate._params, known._params,
                         (1e-11, 1e-11, 1e-14, 1e-8, 1e-8))))):
            return known
    return candidate


def parse(user_input):
    """Accept a supported EPSG identifier or WKT1 / WKT2 (2015/2019) PRJ.

    Unknown projections/datums, non-Greenwich meridians and different TOWGS84
    operations are rejected. Axis order is ignored (always XY), units are kept.
    Null modern-datum operations and the exact Korean
    MB-equivalent position-vector TOWGS84 operation are accepted.
    """
    if isinstance(user_input, _CRS):
        return user_input
    if isinstance(user_input, str):
        text = user_input.lstrip('\ufeff').strip()
        upper = text.upper()
        if upper.startswith('EPSG:') and upper[5:].isascii() and upper[5:].isdigit() and len(upper) < 14:
            result = _CATALOG.get(int(upper[5:]))
            if result is not None:
                return result
        else:
            try:
                return _parse_wkt(text)
            except (ValueError, IndexError, TypeError, AttributeError, RecursionError):
                pass
    raise ValueError('지원하지 않는 좌표계입니다: %s' % str(user_input)[:160])
