var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e2) {
    throw mod = 0, e2;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../../node_modules/clone/clone.js
var require_clone = __commonJS({
  "../../../node_modules/clone/clone.js"(exports, module) {
    var clone = (function() {
      "use strict";
      function clone2(parent, circular, depth, prototype) {
        var filter;
        if (typeof circular === "object") {
          depth = circular.depth;
          prototype = circular.prototype;
          filter = circular.filter;
          circular = circular.circular;
        }
        var allParents = [];
        var allChildren = [];
        var useBuffer = typeof Buffer != "undefined";
        if (typeof circular == "undefined")
          circular = true;
        if (typeof depth == "undefined")
          depth = Infinity;
        function _clone(parent2, depth2) {
          if (parent2 === null)
            return null;
          if (depth2 == 0)
            return parent2;
          var child;
          var proto;
          if (typeof parent2 != "object") {
            return parent2;
          }
          if (clone2.__isArray(parent2)) {
            child = [];
          } else if (clone2.__isRegExp(parent2)) {
            child = new RegExp(parent2.source, __getRegExpFlags(parent2));
            if (parent2.lastIndex) child.lastIndex = parent2.lastIndex;
          } else if (clone2.__isDate(parent2)) {
            child = new Date(parent2.getTime());
          } else if (useBuffer && Buffer.isBuffer(parent2)) {
            if (Buffer.allocUnsafe) {
              child = Buffer.allocUnsafe(parent2.length);
            } else {
              child = new Buffer(parent2.length);
            }
            parent2.copy(child);
            return child;
          } else {
            if (typeof prototype == "undefined") {
              proto = Object.getPrototypeOf(parent2);
              child = Object.create(proto);
            } else {
              child = Object.create(prototype);
              proto = prototype;
            }
          }
          if (circular) {
            var index = allParents.indexOf(parent2);
            if (index != -1) {
              return allChildren[index];
            }
            allParents.push(parent2);
            allChildren.push(child);
          }
          for (var i in parent2) {
            var attrs;
            if (proto) {
              attrs = Object.getOwnPropertyDescriptor(proto, i);
            }
            if (attrs && attrs.set == null) {
              continue;
            }
            child[i] = _clone(parent2[i], depth2 - 1);
          }
          return child;
        }
        return _clone(parent, depth);
      }
      clone2.clonePrototype = function clonePrototype(parent) {
        if (parent === null)
          return null;
        var c2 = function() {
        };
        c2.prototype = parent;
        return new c2();
      };
      function __objToStr(o2) {
        return Object.prototype.toString.call(o2);
      }
      ;
      clone2.__objToStr = __objToStr;
      function __isDate(o2) {
        return typeof o2 === "object" && __objToStr(o2) === "[object Date]";
      }
      ;
      clone2.__isDate = __isDate;
      function __isArray(o2) {
        return typeof o2 === "object" && __objToStr(o2) === "[object Array]";
      }
      ;
      clone2.__isArray = __isArray;
      function __isRegExp(o2) {
        return typeof o2 === "object" && __objToStr(o2) === "[object RegExp]";
      }
      ;
      clone2.__isRegExp = __isRegExp;
      function __getRegExpFlags(re2) {
        var flags = "";
        if (re2.global) flags += "g";
        if (re2.ignoreCase) flags += "i";
        if (re2.multiline) flags += "m";
        return flags;
      }
      ;
      clone2.__getRegExpFlags = __getRegExpFlags;
      return clone2;
    })();
    if (typeof module === "object" && module.exports) {
      module.exports = clone;
    }
  }
});

// ../../../node_modules/kdbush/kdbush.js
var require_kdbush = __commonJS({
  "../../../node_modules/kdbush/kdbush.js"(exports, module) {
    (function(global2, factory) {
      typeof exports === "object" && typeof module !== "undefined" ? module.exports = factory() : typeof define === "function" && define.amd ? define(factory) : global2.kdbush = factory();
    })(exports, (function() {
      "use strict";
      function sortKD(ids, coords, nodeSize, left, right, depth) {
        if (right - left <= nodeSize) return;
        var m2 = Math.floor((left + right) / 2);
        select(ids, coords, m2, left, right, depth % 2);
        sortKD(ids, coords, nodeSize, left, m2 - 1, depth + 1);
        sortKD(ids, coords, nodeSize, m2 + 1, right, depth + 1);
      }
      function select(ids, coords, k2, left, right, inc) {
        while (right > left) {
          if (right - left > 600) {
            var n = right - left + 1;
            var m2 = k2 - left + 1;
            var z2 = Math.log(n);
            var s2 = 0.5 * Math.exp(2 * z2 / 3);
            var sd = 0.5 * Math.sqrt(z2 * s2 * (n - s2) / n) * (m2 - n / 2 < 0 ? -1 : 1);
            var newLeft = Math.max(left, Math.floor(k2 - m2 * s2 / n + sd));
            var newRight = Math.min(right, Math.floor(k2 + (n - m2) * s2 / n + sd));
            select(ids, coords, k2, newLeft, newRight, inc);
          }
          var t2 = coords[2 * k2 + inc];
          var i = left;
          var j2 = right;
          swapItem(ids, coords, left, k2);
          if (coords[2 * right + inc] > t2) swapItem(ids, coords, left, right);
          while (i < j2) {
            swapItem(ids, coords, i, j2);
            i++;
            j2--;
            while (coords[2 * i + inc] < t2) i++;
            while (coords[2 * j2 + inc] > t2) j2--;
          }
          if (coords[2 * left + inc] === t2) swapItem(ids, coords, left, j2);
          else {
            j2++;
            swapItem(ids, coords, j2, right);
          }
          if (j2 <= k2) left = j2 + 1;
          if (k2 <= j2) right = j2 - 1;
        }
      }
      function swapItem(ids, coords, i, j2) {
        swap(ids, i, j2);
        swap(coords, 2 * i, 2 * j2);
        swap(coords, 2 * i + 1, 2 * j2 + 1);
      }
      function swap(arr, i, j2) {
        var tmp = arr[i];
        arr[i] = arr[j2];
        arr[j2] = tmp;
      }
      function range(ids, coords, minX, minY, maxX, maxY, nodeSize) {
        var stack = [0, ids.length - 1, 0];
        var result = [];
        var x2, y2;
        while (stack.length) {
          var axis = stack.pop();
          var right = stack.pop();
          var left = stack.pop();
          if (right - left <= nodeSize) {
            for (var i = left; i <= right; i++) {
              x2 = coords[2 * i];
              y2 = coords[2 * i + 1];
              if (x2 >= minX && x2 <= maxX && y2 >= minY && y2 <= maxY) result.push(ids[i]);
            }
            continue;
          }
          var m2 = Math.floor((left + right) / 2);
          x2 = coords[2 * m2];
          y2 = coords[2 * m2 + 1];
          if (x2 >= minX && x2 <= maxX && y2 >= minY && y2 <= maxY) result.push(ids[m2]);
          var nextAxis = (axis + 1) % 2;
          if (axis === 0 ? minX <= x2 : minY <= y2) {
            stack.push(left);
            stack.push(m2 - 1);
            stack.push(nextAxis);
          }
          if (axis === 0 ? maxX >= x2 : maxY >= y2) {
            stack.push(m2 + 1);
            stack.push(right);
            stack.push(nextAxis);
          }
        }
        return result;
      }
      function within(ids, coords, qx, qy, r2, nodeSize) {
        var stack = [0, ids.length - 1, 0];
        var result = [];
        var r22 = r2 * r2;
        while (stack.length) {
          var axis = stack.pop();
          var right = stack.pop();
          var left = stack.pop();
          if (right - left <= nodeSize) {
            for (var i = left; i <= right; i++) {
              if (sqDist(coords[2 * i], coords[2 * i + 1], qx, qy) <= r22) result.push(ids[i]);
            }
            continue;
          }
          var m2 = Math.floor((left + right) / 2);
          var x2 = coords[2 * m2];
          var y2 = coords[2 * m2 + 1];
          if (sqDist(x2, y2, qx, qy) <= r22) result.push(ids[m2]);
          var nextAxis = (axis + 1) % 2;
          if (axis === 0 ? qx - r2 <= x2 : qy - r2 <= y2) {
            stack.push(left);
            stack.push(m2 - 1);
            stack.push(nextAxis);
          }
          if (axis === 0 ? qx + r2 >= x2 : qy + r2 >= y2) {
            stack.push(m2 + 1);
            stack.push(right);
            stack.push(nextAxis);
          }
        }
        return result;
      }
      function sqDist(ax, ay, bx, by) {
        var dx = ax - bx;
        var dy = ay - by;
        return dx * dx + dy * dy;
      }
      function kdbush(points, getX, getY, nodeSize, ArrayType) {
        return new KDBush(points, getX, getY, nodeSize, ArrayType);
      }
      function KDBush(points, getX, getY, nodeSize, ArrayType) {
        getX = getX || defaultGetX;
        getY = getY || defaultGetY;
        ArrayType = ArrayType || Array;
        this.nodeSize = nodeSize || 64;
        this.points = points;
        this.ids = new ArrayType(points.length);
        this.coords = new ArrayType(points.length * 2);
        for (var i = 0; i < points.length; i++) {
          this.ids[i] = i;
          this.coords[2 * i] = getX(points[i]);
          this.coords[2 * i + 1] = getY(points[i]);
        }
        sortKD(this.ids, this.coords, this.nodeSize, 0, this.ids.length - 1, 0);
      }
      KDBush.prototype = {
        range: function(minX, minY, maxX, maxY) {
          return range(this.ids, this.coords, minX, minY, maxX, maxY, this.nodeSize);
        },
        within: function(x2, y2, r2) {
          return within(this.ids, this.coords, x2, y2, r2, this.nodeSize);
        }
      };
      function defaultGetX(p2) {
        return p2[0];
      }
      function defaultGetY(p2) {
        return p2[1];
      }
      return kdbush;
    }));
  }
});

// ../../../node_modules/graham_scan/graham_scan.min.js
var require_graham_scan_min = __commonJS({
  "../../../node_modules/graham_scan/graham_scan.min.js"(exports, module) {
    function ConvexHullGrahamScan() {
      this.anchorPoint = void 0, this.reverse = false, this.points = [];
    }
    ConvexHullGrahamScan.prototype = { constructor: ConvexHullGrahamScan, Point: function(a2, b2) {
      this.x = a2, this.y = b2;
    }, _findPolarAngle: function(a2, b2) {
      var c2, d2, e2 = 57.295779513082;
      if (!a2 || !b2) return 0;
      if (c2 = b2.x - a2.x, d2 = b2.y - a2.y, 0 == c2 && 0 == d2) return 0;
      var f2 = Math.atan2(d2, c2) * e2;
      return this.reverse ? 0 >= f2 && (f2 += 360) : f2 >= 0 && (f2 += 360), f2;
    }, addPoint: function(a2, b2) {
      var c2 = void 0 === this.anchorPoint || this.anchorPoint.y > b2 || this.anchorPoint.y === b2 && this.anchorPoint.x > a2;
      c2 ? (void 0 !== this.anchorPoint && this.points.push(new this.Point(this.anchorPoint.x, this.anchorPoint.y)), this.anchorPoint = new this.Point(a2, b2)) : this.points.push(new this.Point(a2, b2));
    }, _sortPoints: function() {
      var a2 = this;
      return this.points.sort(function(b2, c2) {
        var d2 = a2._findPolarAngle(a2.anchorPoint, b2), e2 = a2._findPolarAngle(a2.anchorPoint, c2);
        return e2 > d2 ? -1 : d2 > e2 ? 1 : 0;
      });
    }, _checkPoints: function(a2, b2, c2) {
      var d2, e2 = this._findPolarAngle(a2, b2), f2 = this._findPolarAngle(a2, c2);
      return e2 > f2 ? (d2 = e2 - f2, !(d2 > 180)) : f2 > e2 ? (d2 = f2 - e2, d2 > 180) : true;
    }, getHull: function() {
      var a2, b2, c2 = [];
      if (this.reverse = this.points.every(function(a3) {
        return a3.x < 0 && a3.y < 0;
      }), a2 = this._sortPoints(), b2 = a2.length, 3 > b2) return a2.unshift(this.anchorPoint), a2;
      for (c2.push(a2.shift(), a2.shift()); ; ) {
        var d2, e2, f2;
        if (c2.push(a2.shift()), d2 = c2[c2.length - 3], e2 = c2[c2.length - 2], f2 = c2[c2.length - 1], this._checkPoints(d2, e2, f2) && c2.splice(c2.length - 2, 1), 0 == a2.length) {
          if (b2 == c2.length) {
            var g2 = this.anchorPoint;
            return c2 = c2.filter(function(a3) {
              return !!a3;
            }), c2.some(function(a3) {
              return a3.x == g2.x && a3.y == g2.y;
            }) || c2.unshift(this.anchorPoint), c2;
          }
          a2 = c2, b2 = a2.length, c2 = [], c2.push(a2.shift(), a2.shift());
        }
      }
    } }, "function" == typeof define && define.amd && define(function() {
      return ConvexHullGrahamScan;
    }), "undefined" != typeof module && (module.exports = ConvexHullGrahamScan);
  }
});

// ../../../node_modules/bezier-js/lib/utils.js
var require_utils = __commonJS({
  "../../../node_modules/bezier-js/lib/utils.js"(exports, module) {
    (function() {
      "use strict";
      var abs = Math.abs, cos = Math.cos, sin = Math.sin, acos = Math.acos, atan2 = Math.atan2, sqrt = Math.sqrt, pow = Math.pow, crt = function(v) {
        return v < 0 ? -pow(-v, 1 / 3) : pow(v, 1 / 3);
      }, pi = Math.PI, tau = 2 * pi, quart = pi / 2, epsilon = 1e-6, nMax = Number.MAX_SAFE_INTEGER || 9007199254740991, nMin = Number.MIN_SAFE_INTEGER || -9007199254740991, ZERO = { x: 0, y: 0, z: 0 };
      var utils = {
        // Legendre-Gauss abscissae with n=24 (x_i values, defined at i=n as the roots of the nth order Legendre polynomial Pn(x))
        Tvalues: [
          -0.06405689286260563,
          0.06405689286260563,
          -0.1911188674736163,
          0.1911188674736163,
          -0.3150426796961634,
          0.3150426796961634,
          -0.4337935076260451,
          0.4337935076260451,
          -0.5454214713888396,
          0.5454214713888396,
          -0.6480936519369755,
          0.6480936519369755,
          -0.7401241915785544,
          0.7401241915785544,
          -0.820001985973903,
          0.820001985973903,
          -0.8864155270044011,
          0.8864155270044011,
          -0.9382745520027328,
          0.9382745520027328,
          -0.9747285559713095,
          0.9747285559713095,
          -0.9951872199970213,
          0.9951872199970213
        ],
        // Legendre-Gauss weights with n=24 (w_i values, defined by a function linked to in the Bezier primer article)
        Cvalues: [
          0.12793819534675216,
          0.12793819534675216,
          0.1258374563468283,
          0.1258374563468283,
          0.12167047292780339,
          0.12167047292780339,
          0.1155056680537256,
          0.1155056680537256,
          0.10744427011596563,
          0.10744427011596563,
          0.09761865210411388,
          0.09761865210411388,
          0.08619016153195327,
          0.08619016153195327,
          0.0733464814110803,
          0.0733464814110803,
          0.05929858491543678,
          0.05929858491543678,
          0.04427743881741981,
          0.04427743881741981,
          0.028531388628933663,
          0.028531388628933663,
          0.0123412297999872,
          0.0123412297999872
        ],
        arcfn: function(t2, derivativeFn) {
          var d2 = derivativeFn(t2);
          var l2 = d2.x * d2.x + d2.y * d2.y;
          if (typeof d2.z !== "undefined") {
            l2 += d2.z * d2.z;
          }
          return sqrt(l2);
        },
        compute: function(t2, points, _3d) {
          if (t2 === 0) {
            return points[0];
          }
          var order = points.length - 1;
          if (t2 === 1) {
            return points[order];
          }
          var p2 = points;
          var mt2 = 1 - t2;
          if (order === 0) {
            return points[0];
          }
          if (order === 1) {
            ret = {
              x: mt2 * p2[0].x + t2 * p2[1].x,
              y: mt2 * p2[0].y + t2 * p2[1].y
            };
            if (_3d) {
              ret.z = mt2 * p2[0].z + t2 * p2[1].z;
            }
            return ret;
          }
          if (order < 4) {
            var mt22 = mt2 * mt2, t22 = t2 * t2, a2, b2, c2, d2 = 0;
            if (order === 2) {
              p2 = [p2[0], p2[1], p2[2], ZERO];
              a2 = mt22;
              b2 = mt2 * t2 * 2;
              c2 = t22;
            } else if (order === 3) {
              a2 = mt22 * mt2;
              b2 = mt22 * t2 * 3;
              c2 = mt2 * t22 * 3;
              d2 = t2 * t22;
            }
            var ret = {
              x: a2 * p2[0].x + b2 * p2[1].x + c2 * p2[2].x + d2 * p2[3].x,
              y: a2 * p2[0].y + b2 * p2[1].y + c2 * p2[2].y + d2 * p2[3].y
            };
            if (_3d) {
              ret.z = a2 * p2[0].z + b2 * p2[1].z + c2 * p2[2].z + d2 * p2[3].z;
            }
            return ret;
          }
          var dCpts = JSON.parse(JSON.stringify(points));
          while (dCpts.length > 1) {
            for (var i = 0; i < dCpts.length - 1; i++) {
              dCpts[i] = {
                x: dCpts[i].x + (dCpts[i + 1].x - dCpts[i].x) * t2,
                y: dCpts[i].y + (dCpts[i + 1].y - dCpts[i].y) * t2
              };
              if (typeof dCpts[i].z !== "undefined") {
                dCpts[i] = dCpts[i].z + (dCpts[i + 1].z - dCpts[i].z) * t2;
              }
            }
            dCpts.splice(dCpts.length - 1, 1);
          }
          return dCpts[0];
        },
        computeWithRatios: function(t2, points, ratios, _3d) {
          var mt2 = 1 - t2, r2 = ratios, p2 = points, d2;
          var f1 = r2[0], f2 = r2[1], f3 = r2[2], f4 = r2[3];
          f1 *= mt2;
          f2 *= t2;
          if (p2.length === 2) {
            d2 = f1 + f2;
            return {
              x: (f1 * p2[0].x + f2 * p2[1].x) / d2,
              y: (f1 * p2[0].y + f2 * p2[1].y) / d2,
              z: !_3d ? false : (f1 * p2[0].z + f2 * p2[1].z) / d2
            };
          }
          f1 *= mt2;
          f2 *= 2 * mt2;
          f3 *= t2 * t2;
          if (p2.length === 3) {
            d2 = f1 + f2 + f3;
            return {
              x: (f1 * p2[0].x + f2 * p2[1].x + f3 * p2[2].x) / d2,
              y: (f1 * p2[0].y + f2 * p2[1].y + f3 * p2[2].y) / d2,
              z: !_3d ? false : (f1 * p2[0].z + f2 * p2[1].z + f3 * p2[2].z) / d2
            };
          }
          f1 *= mt2;
          f2 *= 1.5 * mt2;
          f3 *= 3 * mt2;
          f4 *= t2 * t2 * t2;
          if (p2.length === 4) {
            d2 = f1 + f2 + f3 + f4;
            return {
              x: (f1 * p2[0].x + f2 * p2[1].x + f3 * p2[2].x + f4 * p2[3].x) / d2,
              y: (f1 * p2[0].y + f2 * p2[1].y + f3 * p2[2].y + f4 * p2[3].y) / d2,
              z: !_3d ? false : (f1 * p2[0].z + f2 * p2[1].z + f3 * p2[2].z + f4 * p2[3].z) / d2
            };
          }
        },
        derive: function(points, _3d) {
          var dpoints = [];
          for (var p2 = points, d2 = p2.length, c2 = d2 - 1; d2 > 1; d2--, c2--) {
            var list = [];
            for (var j2 = 0, dpt; j2 < c2; j2++) {
              dpt = {
                x: c2 * (p2[j2 + 1].x - p2[j2].x),
                y: c2 * (p2[j2 + 1].y - p2[j2].y)
              };
              if (_3d) {
                dpt.z = c2 * (p2[j2 + 1].z - p2[j2].z);
              }
              list.push(dpt);
            }
            dpoints.push(list);
            p2 = list;
          }
          return dpoints;
        },
        between: function(v, m2, M2) {
          return m2 <= v && v <= M2 || utils.approximately(v, m2) || utils.approximately(v, M2);
        },
        approximately: function(a2, b2, precision) {
          return abs(a2 - b2) <= (precision || epsilon);
        },
        length: function(derivativeFn) {
          var z2 = 0.5, sum = 0, len = utils.Tvalues.length, i, t2;
          for (i = 0; i < len; i++) {
            t2 = z2 * utils.Tvalues[i] + z2;
            sum += utils.Cvalues[i] * utils.arcfn(t2, derivativeFn);
          }
          return z2 * sum;
        },
        map: function(v, ds2, de2, ts2, te2) {
          var d1 = de2 - ds2, d2 = te2 - ts2, v2 = v - ds2, r2 = v2 / d1;
          return ts2 + d2 * r2;
        },
        lerp: function(r2, v1, v2) {
          var ret = {
            x: v1.x + r2 * (v2.x - v1.x),
            y: v1.y + r2 * (v2.y - v1.y)
          };
          if (!!v1.z && !!v2.z) {
            ret.z = v1.z + r2 * (v2.z - v1.z);
          }
          return ret;
        },
        pointToString: function(p2) {
          var s2 = p2.x + "/" + p2.y;
          if (typeof p2.z !== "undefined") {
            s2 += "/" + p2.z;
          }
          return s2;
        },
        pointsToString: function(points) {
          return "[" + points.map(utils.pointToString).join(", ") + "]";
        },
        copy: function(obj) {
          return JSON.parse(JSON.stringify(obj));
        },
        angle: function(o2, v1, v2) {
          var dx1 = v1.x - o2.x, dy1 = v1.y - o2.y, dx2 = v2.x - o2.x, dy2 = v2.y - o2.y, cross = dx1 * dy2 - dy1 * dx2, dot = dx1 * dx2 + dy1 * dy2;
          return atan2(cross, dot);
        },
        // round as string, to avoid rounding errors
        round: function(v, d2) {
          var s2 = "" + v;
          var pos = s2.indexOf(".");
          return parseFloat(s2.substring(0, pos + 1 + d2));
        },
        dist: function(p1, p2) {
          var dx = p1.x - p2.x, dy = p1.y - p2.y;
          return sqrt(dx * dx + dy * dy);
        },
        closest: function(LUT, point) {
          var mdist = pow(2, 63), mpos, d2;
          LUT.forEach(function(p2, idx) {
            d2 = utils.dist(point, p2);
            if (d2 < mdist) {
              mdist = d2;
              mpos = idx;
            }
          });
          return { mdist, mpos };
        },
        abcratio: function(t2, n) {
          if (n !== 2 && n !== 3) {
            return false;
          }
          if (typeof t2 === "undefined") {
            t2 = 0.5;
          } else if (t2 === 0 || t2 === 1) {
            return t2;
          }
          var bottom = pow(t2, n) + pow(1 - t2, n), top = bottom - 1;
          return abs(top / bottom);
        },
        projectionratio: function(t2, n) {
          if (n !== 2 && n !== 3) {
            return false;
          }
          if (typeof t2 === "undefined") {
            t2 = 0.5;
          } else if (t2 === 0 || t2 === 1) {
            return t2;
          }
          var top = pow(1 - t2, n), bottom = pow(t2, n) + top;
          return top / bottom;
        },
        lli8: function(x1, y1, x2, y2, x3, y3, x4, y4) {
          var nx = (x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4), ny = (x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4), d2 = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
          if (d2 == 0) {
            return false;
          }
          return { x: nx / d2, y: ny / d2 };
        },
        lli4: function(p1, p2, p3, p4) {
          var x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y, x3 = p3.x, y3 = p3.y, x4 = p4.x, y4 = p4.y;
          return utils.lli8(x1, y1, x2, y2, x3, y3, x4, y4);
        },
        lli: function(v1, v2) {
          return utils.lli4(v1, v1.c, v2, v2.c);
        },
        makeline: function(p1, p2) {
          var Bezier = require_bezier();
          var x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y, dx = (x2 - x1) / 3, dy = (y2 - y1) / 3;
          return new Bezier(
            x1,
            y1,
            x1 + dx,
            y1 + dy,
            x1 + 2 * dx,
            y1 + 2 * dy,
            x2,
            y2
          );
        },
        findbbox: function(sections) {
          var mx = nMax, my = nMax, MX = nMin, MY = nMin;
          sections.forEach(function(s2) {
            var bbox = s2.bbox();
            if (mx > bbox.x.min) mx = bbox.x.min;
            if (my > bbox.y.min) my = bbox.y.min;
            if (MX < bbox.x.max) MX = bbox.x.max;
            if (MY < bbox.y.max) MY = bbox.y.max;
          });
          return {
            x: { min: mx, mid: (mx + MX) / 2, max: MX, size: MX - mx },
            y: { min: my, mid: (my + MY) / 2, max: MY, size: MY - my }
          };
        },
        shapeintersections: function(s1, bbox1, s2, bbox2, curveIntersectionThreshold) {
          if (!utils.bboxoverlap(bbox1, bbox2)) return [];
          var intersections = [];
          var a1 = [s1.startcap, s1.forward, s1.back, s1.endcap];
          var a2 = [s2.startcap, s2.forward, s2.back, s2.endcap];
          a1.forEach(function(l1) {
            if (l1.virtual) return;
            a2.forEach(function(l2) {
              if (l2.virtual) return;
              var iss = l1.intersects(l2, curveIntersectionThreshold);
              if (iss.length > 0) {
                iss.c1 = l1;
                iss.c2 = l2;
                iss.s1 = s1;
                iss.s2 = s2;
                intersections.push(iss);
              }
            });
          });
          return intersections;
        },
        makeshape: function(forward, back, curveIntersectionThreshold) {
          var bpl = back.points.length;
          var fpl = forward.points.length;
          var start = utils.makeline(back.points[bpl - 1], forward.points[0]);
          var end = utils.makeline(forward.points[fpl - 1], back.points[0]);
          var shape = {
            startcap: start,
            forward,
            back,
            endcap: end,
            bbox: utils.findbbox([start, forward, back, end])
          };
          var self2 = utils;
          shape.intersections = function(s2) {
            return self2.shapeintersections(
              shape,
              shape.bbox,
              s2,
              s2.bbox,
              curveIntersectionThreshold
            );
          };
          return shape;
        },
        getminmax: function(curve, d2, list) {
          if (!list) return { min: 0, max: 0 };
          var min = nMax, max = nMin, t2, c2;
          if (list.indexOf(0) === -1) {
            list = [0].concat(list);
          }
          if (list.indexOf(1) === -1) {
            list.push(1);
          }
          for (var i = 0, len = list.length; i < len; i++) {
            t2 = list[i];
            c2 = curve.get(t2);
            if (c2[d2] < min) {
              min = c2[d2];
            }
            if (c2[d2] > max) {
              max = c2[d2];
            }
          }
          return { min, mid: (min + max) / 2, max, size: max - min };
        },
        align: function(points, line2) {
          var tx = line2.p1.x, ty = line2.p1.y, a2 = -atan2(line2.p2.y - ty, line2.p2.x - tx), d2 = function(v) {
            return {
              x: (v.x - tx) * cos(a2) - (v.y - ty) * sin(a2),
              y: (v.x - tx) * sin(a2) + (v.y - ty) * cos(a2)
            };
          };
          return points.map(d2);
        },
        roots: function(points, line2) {
          line2 = line2 || { p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 } };
          var order = points.length - 1;
          var p2 = utils.align(points, line2);
          var reduce = function(t3) {
            return 0 <= t3 && t3 <= 1;
          };
          if (order === 2) {
            var a2 = p2[0].y, b2 = p2[1].y, c2 = p2[2].y, d2 = a2 - 2 * b2 + c2;
            if (d2 !== 0) {
              var m1 = -sqrt(b2 * b2 - a2 * c2), m2 = -a2 + b2, v1 = -(m1 + m2) / d2, v2 = -(-m1 + m2) / d2;
              return [v1, v2].filter(reduce);
            } else if (b2 !== c2 && d2 === 0) {
              return [(2 * b2 - c2) / (2 * b2 - 2 * c2)].filter(reduce);
            }
            return [];
          }
          var pa = p2[0].y, pb = p2[1].y, pc = p2[2].y, pd = p2[3].y, d2 = -pa + 3 * pb - 3 * pc + pd, a2 = 3 * pa - 6 * pb + 3 * pc, b2 = -3 * pa + 3 * pb, c2 = pa;
          if (utils.approximately(d2, 0)) {
            if (utils.approximately(a2, 0)) {
              if (utils.approximately(b2, 0)) {
                return [];
              }
              return [-c2 / b2].filter(reduce);
            }
            var q2 = sqrt(b2 * b2 - 4 * a2 * c2), a22 = 2 * a2;
            return [(q2 - b2) / a22, (-b2 - q2) / a22].filter(reduce);
          }
          a2 /= d2;
          b2 /= d2;
          c2 /= d2;
          var p2 = (3 * b2 - a2 * a2) / 3, p3 = p2 / 3, q2 = (2 * a2 * a2 * a2 - 9 * a2 * b2 + 27 * c2) / 27, q22 = q2 / 2, discriminant = q22 * q22 + p3 * p3 * p3, u1, v1, x1, x2, x3;
          if (discriminant < 0) {
            var mp3 = -p2 / 3, mp33 = mp3 * mp3 * mp3, r2 = sqrt(mp33), t2 = -q2 / (2 * r2), cosphi = t2 < -1 ? -1 : t2 > 1 ? 1 : t2, phi = acos(cosphi), crtr = crt(r2), t1 = 2 * crtr;
            x1 = t1 * cos(phi / 3) - a2 / 3;
            x2 = t1 * cos((phi + tau) / 3) - a2 / 3;
            x3 = t1 * cos((phi + 2 * tau) / 3) - a2 / 3;
            return [x1, x2, x3].filter(reduce);
          } else if (discriminant === 0) {
            u1 = q22 < 0 ? crt(-q22) : -crt(q22);
            x1 = 2 * u1 - a2 / 3;
            x2 = -u1 - a2 / 3;
            return [x1, x2].filter(reduce);
          } else {
            var sd = sqrt(discriminant);
            u1 = crt(-q22 + sd);
            v1 = crt(q22 + sd);
            return [u1 - v1 - a2 / 3].filter(reduce);
          }
        },
        droots: function(p2) {
          if (p2.length === 3) {
            var a2 = p2[0], b2 = p2[1], c2 = p2[2], d2 = a2 - 2 * b2 + c2;
            if (d2 !== 0) {
              var m1 = -sqrt(b2 * b2 - a2 * c2), m2 = -a2 + b2, v1 = -(m1 + m2) / d2, v2 = -(-m1 + m2) / d2;
              return [v1, v2];
            } else if (b2 !== c2 && d2 === 0) {
              return [(2 * b2 - c2) / (2 * (b2 - c2))];
            }
            return [];
          }
          if (p2.length === 2) {
            var a2 = p2[0], b2 = p2[1];
            if (a2 !== b2) {
              return [a2 / (a2 - b2)];
            }
            return [];
          }
        },
        curvature: function(t2, points, _3d, kOnly) {
          var dpoints = utils.derive(points);
          var d1 = dpoints[0];
          var d2 = dpoints[1];
          var num, dnm, adk, dk, k2 = 0, r2 = 0;
          var d3 = utils.compute(t2, d1);
          var dd = utils.compute(t2, d2);
          var qdsum = d3.x * d3.x + d3.y * d3.y;
          if (_3d) {
            num = sqrt(
              pow(d3.y * dd.z - dd.y * d3.z, 2) + pow(d3.z * dd.x - dd.z * d3.x, 2) + pow(d3.x * dd.y - dd.x * d3.y, 2)
            );
            dnm = pow(qdsum + d3.z * d3.z, 3 / 2);
          } else {
            num = d3.x * dd.y - d3.y * dd.x;
            dnm = pow(qdsum, 3 / 2);
          }
          if (num === 0 || dnm === 0) {
            return { k: 0, r: 0 };
          }
          k2 = num / dnm;
          r2 = dnm / num;
          if (!kOnly) {
            var pk = utils.curvature(t2 - 1e-3, points, _3d, true).k;
            var nk = utils.curvature(t2 + 1e-3, points, _3d, true).k;
            dk = (nk - k2 + (k2 - pk)) / 2;
            adk = (abs(nk - k2) + abs(k2 - pk)) / 2;
          }
          return { k: k2, r: r2, dk, adk };
        },
        inflections: function(points) {
          if (points.length < 4) return [];
          var p2 = utils.align(points, { p1: points[0], p2: points.slice(-1)[0] }), a2 = p2[2].x * p2[1].y, b2 = p2[3].x * p2[1].y, c2 = p2[1].x * p2[2].y, d2 = p2[3].x * p2[2].y, v1 = 18 * (-3 * a2 + 2 * b2 + 3 * c2 - d2), v2 = 18 * (3 * a2 - b2 - 3 * c2), v3 = 18 * (c2 - a2);
          if (utils.approximately(v1, 0)) {
            if (!utils.approximately(v2, 0)) {
              var t2 = -v3 / v2;
              if (0 <= t2 && t2 <= 1) return [t2];
            }
            return [];
          }
          var trm = v2 * v2 - 4 * v1 * v3, sq = Math.sqrt(trm), d2 = 2 * v1;
          if (utils.approximately(d2, 0)) return [];
          return [(sq - v2) / d2, -(v2 + sq) / d2].filter(function(r2) {
            return 0 <= r2 && r2 <= 1;
          });
        },
        bboxoverlap: function(b1, b2) {
          var dims = ["x", "y"], len = dims.length, i, dim, l2, t2, d2;
          for (i = 0; i < len; i++) {
            dim = dims[i];
            l2 = b1[dim].mid;
            t2 = b2[dim].mid;
            d2 = (b1[dim].size + b2[dim].size) / 2;
            if (abs(l2 - t2) >= d2) return false;
          }
          return true;
        },
        expandbox: function(bbox, _bbox) {
          if (_bbox.x.min < bbox.x.min) {
            bbox.x.min = _bbox.x.min;
          }
          if (_bbox.y.min < bbox.y.min) {
            bbox.y.min = _bbox.y.min;
          }
          if (_bbox.z && _bbox.z.min < bbox.z.min) {
            bbox.z.min = _bbox.z.min;
          }
          if (_bbox.x.max > bbox.x.max) {
            bbox.x.max = _bbox.x.max;
          }
          if (_bbox.y.max > bbox.y.max) {
            bbox.y.max = _bbox.y.max;
          }
          if (_bbox.z && _bbox.z.max > bbox.z.max) {
            bbox.z.max = _bbox.z.max;
          }
          bbox.x.mid = (bbox.x.min + bbox.x.max) / 2;
          bbox.y.mid = (bbox.y.min + bbox.y.max) / 2;
          if (bbox.z) {
            bbox.z.mid = (bbox.z.min + bbox.z.max) / 2;
          }
          bbox.x.size = bbox.x.max - bbox.x.min;
          bbox.y.size = bbox.y.max - bbox.y.min;
          if (bbox.z) {
            bbox.z.size = bbox.z.max - bbox.z.min;
          }
        },
        pairiteration: function(c1, c2, curveIntersectionThreshold) {
          var c1b = c1.bbox(), c2b = c2.bbox(), r2 = 1e5, threshold = curveIntersectionThreshold || 0.5;
          if (c1b.x.size + c1b.y.size < threshold && c2b.x.size + c2b.y.size < threshold) {
            return [
              (r2 * (c1._t1 + c1._t2) / 2 | 0) / r2 + "/" + (r2 * (c2._t1 + c2._t2) / 2 | 0) / r2
            ];
          }
          var cc1 = c1.split(0.5), cc2 = c2.split(0.5), pairs = [
            { left: cc1.left, right: cc2.left },
            { left: cc1.left, right: cc2.right },
            { left: cc1.right, right: cc2.right },
            { left: cc1.right, right: cc2.left }
          ];
          pairs = pairs.filter(function(pair) {
            return utils.bboxoverlap(pair.left.bbox(), pair.right.bbox());
          });
          var results = [];
          if (pairs.length === 0) return results;
          pairs.forEach(function(pair) {
            results = results.concat(
              utils.pairiteration(pair.left, pair.right, threshold)
            );
          });
          results = results.filter(function(v, i) {
            return results.indexOf(v) === i;
          });
          return results;
        },
        getccenter: function(p1, p2, p3) {
          var dx1 = p2.x - p1.x, dy1 = p2.y - p1.y, dx2 = p3.x - p2.x, dy2 = p3.y - p2.y;
          var dx1p = dx1 * cos(quart) - dy1 * sin(quart), dy1p = dx1 * sin(quart) + dy1 * cos(quart), dx2p = dx2 * cos(quart) - dy2 * sin(quart), dy2p = dx2 * sin(quart) + dy2 * cos(quart);
          var mx1 = (p1.x + p2.x) / 2, my1 = (p1.y + p2.y) / 2, mx2 = (p2.x + p3.x) / 2, my2 = (p2.y + p3.y) / 2;
          var mx1n = mx1 + dx1p, my1n = my1 + dy1p, mx2n = mx2 + dx2p, my2n = my2 + dy2p;
          var arc = utils.lli8(mx1, my1, mx1n, my1n, mx2, my2, mx2n, my2n), r2 = utils.dist(arc, p1), s2 = atan2(p1.y - arc.y, p1.x - arc.x), m2 = atan2(p2.y - arc.y, p2.x - arc.x), e2 = atan2(p3.y - arc.y, p3.x - arc.x), _2;
          if (s2 < e2) {
            if (s2 > m2 || m2 > e2) {
              s2 += tau;
            }
            if (s2 > e2) {
              _2 = e2;
              e2 = s2;
              s2 = _2;
            }
          } else {
            if (e2 < m2 && m2 < s2) {
              _2 = e2;
              e2 = s2;
              s2 = _2;
            } else {
              e2 += tau;
            }
          }
          arc.s = s2;
          arc.e = e2;
          arc.r = r2;
          return arc;
        },
        numberSort: function(a2, b2) {
          return a2 - b2;
        }
      };
      module.exports = utils;
    })();
  }
});

// ../../../node_modules/bezier-js/lib/poly-bezier.js
var require_poly_bezier = __commonJS({
  "../../../node_modules/bezier-js/lib/poly-bezier.js"(exports, module) {
    (function() {
      "use strict";
      var utils = require_utils();
      var PolyBezier = function(curves) {
        this.curves = [];
        this._3d = false;
        if (!!curves) {
          this.curves = curves;
          this._3d = this.curves[0]._3d;
        }
      };
      PolyBezier.prototype = {
        valueOf: function() {
          return this.toString();
        },
        toString: function() {
          return "[" + this.curves.map(function(curve) {
            return utils.pointsToString(curve.points);
          }).join(", ") + "]";
        },
        addCurve: function(curve) {
          this.curves.push(curve);
          this._3d = this._3d || curve._3d;
        },
        length: function() {
          return this.curves.map(function(v) {
            return v.length();
          }).reduce(function(a2, b2) {
            return a2 + b2;
          });
        },
        curve: function(idx) {
          return this.curves[idx];
        },
        bbox: function() {
          var c2 = this.curves;
          var bbox = c2[0].bbox();
          for (var i = 1; i < c2.length; i++) {
            utils.expandbox(bbox, c2[i].bbox());
          }
          return bbox;
        },
        offset: function(d2) {
          var offset = [];
          this.curves.forEach(function(v) {
            offset = offset.concat(v.offset(d2));
          });
          return new PolyBezier(offset);
        }
      };
      module.exports = PolyBezier;
    })();
  }
});

// ../../../node_modules/bezier-js/lib/normalise-svg.js
var require_normalise_svg = __commonJS({
  "../../../node_modules/bezier-js/lib/normalise-svg.js"(exports, module) {
    function normalizePath(d2) {
      d2 = d2.replace(/,/g, " ").replace(/-/g, " - ").replace(/-\s+/g, "-").replace(/([a-zA-Z])/g, " $1 ");
      var instructions = d2.replace(/([a-zA-Z])\s?/g, "|$1").split("|"), instructionLength = instructions.length, i, instruction, op, lop, args = [], alen, a2, sx = 0, sy = 0, x2 = 0, y2 = 0, cx = 0, cy = 0, cx2 = 0, cy2 = 0, normalized = "";
      for (i = 1; i < instructionLength; i++) {
        instruction = instructions[i];
        op = instruction.substring(0, 1);
        lop = op.toLowerCase();
        args = instruction.replace(op, "").trim().split(" ");
        args = args.filter(function(v) {
          return v !== "";
        }).map(parseFloat);
        alen = args.length;
        if (lop === "m") {
          normalized += "M ";
          if (op === "m") {
            x2 += args[0];
            y2 += args[1];
          } else {
            x2 = args[0];
            y2 = args[1];
          }
          sx = x2;
          sy = y2;
          normalized += x2 + " " + y2 + " ";
          if (alen > 2) {
            for (a2 = 0; a2 < alen; a2 += 2) {
              if (op === "m") {
                x2 += args[a2];
                y2 += args[a2 + 1];
              } else {
                x2 = args[a2];
                y2 = args[a2 + 1];
              }
              normalized += ["L", x2, y2, ""].join(" ");
            }
          }
        } else if (lop === "l") {
          for (a2 = 0; a2 < alen; a2 += 2) {
            if (op === "l") {
              x2 += args[a2];
              y2 += args[a2 + 1];
            } else {
              x2 = args[a2];
              y2 = args[a2 + 1];
            }
            normalized += ["L", x2, y2, ""].join(" ");
          }
        } else if (lop === "h") {
          for (a2 = 0; a2 < alen; a2++) {
            if (op === "h") {
              x2 += args[a2];
            } else {
              x2 = args[a2];
            }
            normalized += ["L", x2, y2, ""].join(" ");
          }
        } else if (lop === "v") {
          for (a2 = 0; a2 < alen; a2++) {
            if (op === "v") {
              y2 += args[a2];
            } else {
              y2 = args[a2];
            }
            normalized += ["L", x2, y2, ""].join(" ");
          }
        } else if (lop === "q") {
          for (a2 = 0; a2 < alen; a2 += 4) {
            if (op === "q") {
              cx = x2 + args[a2];
              cy = y2 + args[a2 + 1];
              x2 += args[a2 + 2];
              y2 += args[a2 + 3];
            } else {
              cx = args[a2];
              cy = args[a2 + 1];
              x2 = args[a2 + 2];
              y2 = args[a2 + 3];
            }
            normalized += ["Q", cx, cy, x2, y2, ""].join(" ");
          }
        } else if (lop === "t") {
          for (a2 = 0; a2 < alen; a2 += 2) {
            cx = x2 + (x2 - cx);
            cy = y2 + (y2 - cy);
            if (op === "t") {
              x2 += args[a2];
              y2 += args[a2 + 1];
            } else {
              x2 = args[a2];
              y2 = args[a2 + 1];
            }
            normalized += ["Q", cx, cy, x2, y2, ""].join(" ");
          }
        } else if (lop === "c") {
          for (a2 = 0; a2 < alen; a2 += 6) {
            if (op === "c") {
              cx = x2 + args[a2];
              cy = y2 + args[a2 + 1];
              cx2 = x2 + args[a2 + 2];
              cy2 = y2 + args[a2 + 3];
              x2 += args[a2 + 4];
              y2 += args[a2 + 5];
            } else {
              cx = args[a2];
              cy = args[a2 + 1];
              cx2 = args[a2 + 2];
              cy2 = args[a2 + 3];
              x2 = args[a2 + 4];
              y2 = args[a2 + 5];
            }
            normalized += ["C", cx, cy, cx2, cy2, x2, y2, ""].join(" ");
          }
        } else if (lop === "s") {
          for (a2 = 0; a2 < alen; a2 += 4) {
            cx = x2 + (x2 - cx2);
            cy = y2 + (y2 - cy2);
            if (op === "s") {
              cx2 = x2 + args[a2];
              cy2 = y2 + args[a2 + 1];
              x2 += args[a2 + 2];
              y2 += args[a2 + 3];
            } else {
              cx2 = args[a2];
              cy2 = args[a2 + 1];
              x2 = args[a2 + 2];
              y2 = args[a2 + 3];
            }
            normalized += ["C", cx, cy, cx2, cy2, x2, y2, ""].join(" ");
          }
        } else if (lop === "z") {
          normalized += "Z ";
          x2 = sx;
          y2 = sy;
        }
      }
      return normalized.trim();
    }
    module.exports = normalizePath;
  }
});

// ../../../node_modules/bezier-js/lib/svg-to-beziers.js
var require_svg_to_beziers = __commonJS({
  "../../../node_modules/bezier-js/lib/svg-to-beziers.js"(exports, module) {
    var normalise = require_normalise_svg();
    var M2 = { x: false, y: false };
    function makeBezier(Bezier, term, values) {
      if (term === "Z") return;
      if (term === "M") {
        M2 = { x: values[0], y: values[1] };
        return;
      }
      var cvalues = [false, M2.x, M2.y].concat(values);
      var PreboundConstructor = Bezier.bind.apply(Bezier, cvalues);
      var curve = new PreboundConstructor();
      var last = values.slice(-2);
      M2 = { x: last[0], y: last[1] };
      return curve;
    }
    function convertPath(Bezier, d2) {
      var terms = normalise(d2).split(" "), term, matcher = new RegExp("[MLCQZ]", ""), segment, values, segments = [], ARGS = { "C": 6, "Q": 4, "L": 2, "M": 2 };
      while (terms.length) {
        term = terms.splice(0, 1)[0];
        if (matcher.test(term)) {
          values = terms.splice(0, ARGS[term]).map(parseFloat);
          segment = makeBezier(Bezier, term, values);
          if (segment) segments.push(segment);
        }
      }
      return new Bezier.PolyBezier(segments);
    }
    module.exports = convertPath;
  }
});

// ../../../node_modules/bezier-js/lib/bezier.js
var require_bezier = __commonJS({
  "../../../node_modules/bezier-js/lib/bezier.js"(exports, module) {
    (function() {
      "use strict";
      var abs = Math.abs, min = Math.min, max = Math.max, cos = Math.cos, sin = Math.sin, acos = Math.acos, sqrt = Math.sqrt, pi = Math.PI, ZERO = { x: 0, y: 0, z: 0 };
      var utils = require_utils();
      var PolyBezier = require_poly_bezier();
      var Bezier = function(coords) {
        var args = coords && coords.forEach ? coords : [].slice.call(arguments);
        var coordlen = false;
        if (typeof args[0] === "object") {
          coordlen = args.length;
          var newargs = [];
          args.forEach(function(point2) {
            ["x", "y", "z"].forEach(function(d2) {
              if (typeof point2[d2] !== "undefined") {
                newargs.push(point2[d2]);
              }
            });
          });
          args = newargs;
        }
        var higher = false;
        var len = args.length;
        if (coordlen) {
          if (coordlen > 4) {
            if (arguments.length !== 1) {
              throw new Error(
                "Only new Bezier(point[]) is accepted for 4th and higher order curves"
              );
            }
            higher = true;
          }
        } else {
          if (len !== 6 && len !== 8 && len !== 9 && len !== 12) {
            if (arguments.length !== 1) {
              throw new Error(
                "Only new Bezier(point[]) is accepted for 4th and higher order curves"
              );
            }
          }
        }
        var _3d = !higher && (len === 9 || len === 12) || coords && coords[0] && typeof coords[0].z !== "undefined";
        this._3d = _3d;
        var points = [];
        for (var idx = 0, step = _3d ? 3 : 2; idx < len; idx += step) {
          var point = {
            x: args[idx],
            y: args[idx + 1]
          };
          if (_3d) {
            point.z = args[idx + 2];
          }
          points.push(point);
        }
        this.order = points.length - 1;
        this.points = points;
        var dims = ["x", "y"];
        if (_3d) dims.push("z");
        this.dims = dims;
        this.dimlen = dims.length;
        (function(curve) {
          var order = curve.order;
          var points2 = curve.points;
          var a2 = utils.align(points2, { p1: points2[0], p2: points2[order] });
          for (var i = 0; i < a2.length; i++) {
            if (abs(a2[i].y) > 1e-4) {
              curve._linear = false;
              return;
            }
          }
          curve._linear = true;
        })(this);
        this._t1 = 0;
        this._t2 = 1;
        this.update();
      };
      var svgToBeziers = require_svg_to_beziers();
      Bezier.SVGtoBeziers = function(d2) {
        return svgToBeziers(Bezier, d2);
      };
      function getABC(n, S2, B2, E2, t2) {
        if (typeof t2 === "undefined") {
          t2 = 0.5;
        }
        var u2 = utils.projectionratio(t2, n), um = 1 - u2, C3 = {
          x: u2 * S2.x + um * E2.x,
          y: u2 * S2.y + um * E2.y
        }, s2 = utils.abcratio(t2, n), A2 = {
          x: B2.x + (B2.x - C3.x) / s2,
          y: B2.y + (B2.y - C3.y) / s2
        };
        return { A: A2, B: B2, C: C3 };
      }
      Bezier.quadraticFromPoints = function(p1, p2, p3, t2) {
        if (typeof t2 === "undefined") {
          t2 = 0.5;
        }
        if (t2 === 0) {
          return new Bezier(p2, p2, p3);
        }
        if (t2 === 1) {
          return new Bezier(p1, p2, p2);
        }
        var abc = getABC(2, p1, p2, p3, t2);
        return new Bezier(p1, abc.A, p3);
      };
      Bezier.cubicFromPoints = function(S2, B2, E2, t2, d1) {
        if (typeof t2 === "undefined") {
          t2 = 0.5;
        }
        var abc = getABC(3, S2, B2, E2, t2);
        if (typeof d1 === "undefined") {
          d1 = utils.dist(B2, abc.C);
        }
        var d2 = d1 * (1 - t2) / t2;
        var selen = utils.dist(S2, E2), lx = (E2.x - S2.x) / selen, ly = (E2.y - S2.y) / selen, bx1 = d1 * lx, by1 = d1 * ly, bx2 = d2 * lx, by2 = d2 * ly;
        var e1 = { x: B2.x - bx1, y: B2.y - by1 }, e2 = { x: B2.x + bx2, y: B2.y + by2 }, A2 = abc.A, v1 = { x: A2.x + (e1.x - A2.x) / (1 - t2), y: A2.y + (e1.y - A2.y) / (1 - t2) }, v2 = { x: A2.x + (e2.x - A2.x) / t2, y: A2.y + (e2.y - A2.y) / t2 }, nc1 = { x: S2.x + (v1.x - S2.x) / t2, y: S2.y + (v1.y - S2.y) / t2 }, nc2 = {
          x: E2.x + (v2.x - E2.x) / (1 - t2),
          y: E2.y + (v2.y - E2.y) / (1 - t2)
        };
        return new Bezier(S2, nc1, nc2, E2);
      };
      var getUtils = function() {
        return utils;
      };
      Bezier.getUtils = getUtils;
      Bezier.PolyBezier = PolyBezier;
      Bezier.prototype = {
        getUtils,
        valueOf: function() {
          return this.toString();
        },
        toString: function() {
          return utils.pointsToString(this.points);
        },
        toSVG: function(relative) {
          if (this._3d) return false;
          var p2 = this.points, x2 = p2[0].x, y2 = p2[0].y, s2 = ["M", x2, y2, this.order === 2 ? "Q" : "C"];
          for (var i = 1, last = p2.length; i < last; i++) {
            s2.push(p2[i].x);
            s2.push(p2[i].y);
          }
          return s2.join(" ");
        },
        setRatios: function(ratios) {
          if (ratios.length !== this.points.length) {
            throw new Error("incorrect number of ratio values");
          }
          this.ratios = ratios;
          this._lut = [];
        },
        verify: function() {
          var print = this.coordDigest();
          if (print !== this._print) {
            this._print = print;
            this.update();
          }
        },
        coordDigest: function() {
          return this.points.map(function(c2, pos) {
            return "" + pos + c2.x + c2.y + (c2.z ? c2.z : 0);
          }).join("");
        },
        update: function(newprint) {
          this._lut = [];
          this.dpoints = utils.derive(this.points, this._3d);
          this.computedirection();
        },
        computedirection: function() {
          var points = this.points;
          var angle = utils.angle(points[0], points[this.order], points[1]);
          this.clockwise = angle > 0;
        },
        length: function() {
          return utils.length(this.derivative.bind(this));
        },
        _lut: [],
        getLUT: function(steps) {
          this.verify();
          steps = steps || 100;
          if (this._lut.length === steps) {
            return this._lut;
          }
          this._lut = [];
          steps--;
          for (var t2 = 0; t2 <= steps; t2++) {
            this._lut.push(this.compute(t2 / steps));
          }
          return this._lut;
        },
        on: function(point, error) {
          error = error || 5;
          var lut = this.getLUT(), hits = [], c2, t2 = 0;
          for (var i = 0; i < lut.length; i++) {
            c2 = lut[i];
            if (utils.dist(c2, point) < error) {
              hits.push(c2);
              t2 += i / lut.length;
            }
          }
          if (!hits.length) return false;
          return t2 /= hits.length;
        },
        project: function(point) {
          var LUT = this.getLUT(), l2 = LUT.length - 1, closest = utils.closest(LUT, point), mdist = closest.mdist, mpos = closest.mpos;
          var ft2, t2, p2, d2, t1 = (mpos - 1) / l2, t22 = (mpos + 1) / l2, step = 0.1 / l2;
          mdist += 1;
          for (t2 = t1, ft2 = t2; t2 < t22 + step; t2 += step) {
            p2 = this.compute(t2);
            d2 = utils.dist(point, p2);
            if (d2 < mdist) {
              mdist = d2;
              ft2 = t2;
            }
          }
          p2 = this.compute(ft2);
          p2.t = ft2;
          p2.d = mdist;
          return p2;
        },
        get: function(t2) {
          return this.compute(t2);
        },
        point: function(idx) {
          return this.points[idx];
        },
        compute: function(t2) {
          if (this.ratios) return utils.computeWithRatios(t2, this.points, this.ratios, this._3d);
          return utils.compute(t2, this.points, this._3d, this.ratios);
        },
        raise: function() {
          var p2 = this.points, np = [p2[0]], i, k2 = p2.length, pi2, pim;
          for (var i = 1; i < k2; i++) {
            pi2 = p2[i];
            pim = p2[i - 1];
            np[i] = {
              x: (k2 - i) / k2 * pi2.x + i / k2 * pim.x,
              y: (k2 - i) / k2 * pi2.y + i / k2 * pim.y
            };
          }
          np[k2] = p2[k2 - 1];
          return new Bezier(np);
        },
        derivative: function(t2) {
          var mt2 = 1 - t2, a2, b2, c2 = 0, p2 = this.dpoints[0];
          if (this.order === 2) {
            p2 = [p2[0], p2[1], ZERO];
            a2 = mt2;
            b2 = t2;
          }
          if (this.order === 3) {
            a2 = mt2 * mt2;
            b2 = mt2 * t2 * 2;
            c2 = t2 * t2;
          }
          var ret = {
            x: a2 * p2[0].x + b2 * p2[1].x + c2 * p2[2].x,
            y: a2 * p2[0].y + b2 * p2[1].y + c2 * p2[2].y
          };
          if (this._3d) {
            ret.z = a2 * p2[0].z + b2 * p2[1].z + c2 * p2[2].z;
          }
          return ret;
        },
        curvature: function(t2) {
          return utils.curvature(t2, this.points, this._3d);
        },
        inflections: function() {
          return utils.inflections(this.points);
        },
        normal: function(t2) {
          return this._3d ? this.__normal3(t2) : this.__normal2(t2);
        },
        __normal2: function(t2) {
          var d2 = this.derivative(t2);
          var q2 = sqrt(d2.x * d2.x + d2.y * d2.y);
          return { x: -d2.y / q2, y: d2.x / q2 };
        },
        __normal3: function(t2) {
          var r1 = this.derivative(t2), r2 = this.derivative(t2 + 0.01), q1 = sqrt(r1.x * r1.x + r1.y * r1.y + r1.z * r1.z), q2 = sqrt(r2.x * r2.x + r2.y * r2.y + r2.z * r2.z);
          r1.x /= q1;
          r1.y /= q1;
          r1.z /= q1;
          r2.x /= q2;
          r2.y /= q2;
          r2.z /= q2;
          var c2 = {
            x: r2.y * r1.z - r2.z * r1.y,
            y: r2.z * r1.x - r2.x * r1.z,
            z: r2.x * r1.y - r2.y * r1.x
          };
          var m2 = sqrt(c2.x * c2.x + c2.y * c2.y + c2.z * c2.z);
          c2.x /= m2;
          c2.y /= m2;
          c2.z /= m2;
          var R2 = [
            c2.x * c2.x,
            c2.x * c2.y - c2.z,
            c2.x * c2.z + c2.y,
            c2.x * c2.y + c2.z,
            c2.y * c2.y,
            c2.y * c2.z - c2.x,
            c2.x * c2.z - c2.y,
            c2.y * c2.z + c2.x,
            c2.z * c2.z
          ];
          var n = {
            x: R2[0] * r1.x + R2[1] * r1.y + R2[2] * r1.z,
            y: R2[3] * r1.x + R2[4] * r1.y + R2[5] * r1.z,
            z: R2[6] * r1.x + R2[7] * r1.y + R2[8] * r1.z
          };
          return n;
        },
        hull: function(t2) {
          var p2 = this.points, _p = [], pt2, q2 = [], idx = 0, i = 0, l2 = 0;
          q2[idx++] = p2[0];
          q2[idx++] = p2[1];
          q2[idx++] = p2[2];
          if (this.order === 3) {
            q2[idx++] = p2[3];
          }
          while (p2.length > 1) {
            _p = [];
            for (i = 0, l2 = p2.length - 1; i < l2; i++) {
              pt2 = utils.lerp(t2, p2[i], p2[i + 1]);
              q2[idx++] = pt2;
              _p.push(pt2);
            }
            p2 = _p;
          }
          return q2;
        },
        split: function(t1, t2) {
          if (t1 === 0 && !!t2) {
            return this.split(t2).left;
          }
          if (t2 === 1) {
            return this.split(t1).right;
          }
          var q2 = this.hull(t1);
          var result = {
            left: this.order === 2 ? new Bezier([q2[0], q2[3], q2[5]]) : new Bezier([q2[0], q2[4], q2[7], q2[9]]),
            right: this.order === 2 ? new Bezier([q2[5], q2[4], q2[2]]) : new Bezier([q2[9], q2[8], q2[6], q2[3]]),
            span: q2
          };
          result.left._t1 = utils.map(0, 0, 1, this._t1, this._t2);
          result.left._t2 = utils.map(t1, 0, 1, this._t1, this._t2);
          result.right._t1 = utils.map(t1, 0, 1, this._t1, this._t2);
          result.right._t2 = utils.map(1, 0, 1, this._t1, this._t2);
          if (!t2) {
            return result;
          }
          t2 = utils.map(t2, t1, 1, 0, 1);
          var subsplit = result.right.split(t2);
          return subsplit.left;
        },
        extrema: function() {
          var dims = this.dims, result = {}, roots = [], p2, mfn;
          dims.forEach(
            function(dim) {
              mfn = function(v) {
                return v[dim];
              };
              p2 = this.dpoints[0].map(mfn);
              result[dim] = utils.droots(p2);
              if (this.order === 3) {
                p2 = this.dpoints[1].map(mfn);
                result[dim] = result[dim].concat(utils.droots(p2));
              }
              result[dim] = result[dim].filter(function(t2) {
                return t2 >= 0 && t2 <= 1;
              });
              roots = roots.concat(result[dim].sort(utils.numberSort));
            }.bind(this)
          );
          roots = roots.sort(utils.numberSort).filter(function(v, idx) {
            return roots.indexOf(v) === idx;
          });
          result.values = roots;
          return result;
        },
        bbox: function() {
          var extrema = this.extrema(), result = {};
          this.dims.forEach(
            function(d2) {
              result[d2] = utils.getminmax(this, d2, extrema[d2]);
            }.bind(this)
          );
          return result;
        },
        overlaps: function(curve) {
          var lbbox = this.bbox(), tbbox = curve.bbox();
          return utils.bboxoverlap(lbbox, tbbox);
        },
        offset: function(t2, d2) {
          if (typeof d2 !== "undefined") {
            var c2 = this.get(t2);
            var n = this.normal(t2);
            var ret = {
              c: c2,
              n,
              x: c2.x + n.x * d2,
              y: c2.y + n.y * d2
            };
            if (this._3d) {
              ret.z = c2.z + n.z * d2;
            }
            return ret;
          }
          if (this._linear) {
            var nv = this.normal(0);
            var coords = this.points.map(function(p2) {
              var ret2 = {
                x: p2.x + t2 * nv.x,
                y: p2.y + t2 * nv.y
              };
              if (p2.z && n.z) {
                ret2.z = p2.z + t2 * nv.z;
              }
              return ret2;
            });
            return [new Bezier(coords)];
          }
          var reduced = this.reduce();
          return reduced.map(function(s2) {
            if (s2._linear) {
              return s2.offset(t2)[0];
            }
            return s2.scale(t2);
          });
        },
        simple: function() {
          if (this.order === 3) {
            var a1 = utils.angle(this.points[0], this.points[3], this.points[1]);
            var a2 = utils.angle(this.points[0], this.points[3], this.points[2]);
            if (a1 > 0 && a2 < 0 || a1 < 0 && a2 > 0) return false;
          }
          var n1 = this.normal(0);
          var n2 = this.normal(1);
          var s2 = n1.x * n2.x + n1.y * n2.y;
          if (this._3d) {
            s2 += n1.z * n2.z;
          }
          var angle = abs(acos(s2));
          return angle < pi / 3;
        },
        reduce: function() {
          var i, t1 = 0, t2 = 0, step = 0.01, segment, pass1 = [], pass2 = [];
          var extrema = this.extrema().values;
          if (extrema.indexOf(0) === -1) {
            extrema = [0].concat(extrema);
          }
          if (extrema.indexOf(1) === -1) {
            extrema.push(1);
          }
          for (t1 = extrema[0], i = 1; i < extrema.length; i++) {
            t2 = extrema[i];
            segment = this.split(t1, t2);
            segment._t1 = t1;
            segment._t2 = t2;
            pass1.push(segment);
            t1 = t2;
          }
          pass1.forEach(function(p1) {
            t1 = 0;
            t2 = 0;
            while (t2 <= 1) {
              for (t2 = t1 + step; t2 <= 1 + step; t2 += step) {
                segment = p1.split(t1, t2);
                if (!segment.simple()) {
                  t2 -= step;
                  if (abs(t1 - t2) < step) {
                    return [];
                  }
                  segment = p1.split(t1, t2);
                  segment._t1 = utils.map(t1, 0, 1, p1._t1, p1._t2);
                  segment._t2 = utils.map(t2, 0, 1, p1._t1, p1._t2);
                  pass2.push(segment);
                  t1 = t2;
                  break;
                }
              }
            }
            if (t1 < 1) {
              segment = p1.split(t1, 1);
              segment._t1 = utils.map(t1, 0, 1, p1._t1, p1._t2);
              segment._t2 = p1._t2;
              pass2.push(segment);
            }
          });
          return pass2;
        },
        scale: function(d2) {
          var order = this.order;
          var distanceFn = false;
          if (typeof d2 === "function") {
            distanceFn = d2;
          }
          if (distanceFn && order === 2) {
            return this.raise().scale(distanceFn);
          }
          var clockwise = this.clockwise;
          var r1 = distanceFn ? distanceFn(0) : d2;
          var r2 = distanceFn ? distanceFn(1) : d2;
          var v = [this.offset(0, 10), this.offset(1, 10)];
          var o2 = utils.lli4(v[0], v[0].c, v[1], v[1].c);
          if (!o2) {
            throw new Error("cannot scale this curve. Try reducing it first.");
          }
          var points = this.points, np = [];
          [0, 1].forEach(
            function(t2) {
              var p2 = np[t2 * order] = utils.copy(points[t2 * order]);
              p2.x += (t2 ? r2 : r1) * v[t2].n.x;
              p2.y += (t2 ? r2 : r1) * v[t2].n.y;
            }.bind(this)
          );
          if (!distanceFn) {
            [0, 1].forEach(
              function(t2) {
                if (this.order === 2 && !!t2) return;
                var p2 = np[t2 * order];
                var d3 = this.derivative(t2);
                var p22 = { x: p2.x + d3.x, y: p2.y + d3.y };
                np[t2 + 1] = utils.lli4(p2, p22, o2, points[t2 + 1]);
              }.bind(this)
            );
            return new Bezier(np);
          }
          [0, 1].forEach(
            function(t2) {
              if (this.order === 2 && !!t2) return;
              var p2 = points[t2 + 1];
              var ov = {
                x: p2.x - o2.x,
                y: p2.y - o2.y
              };
              var rc = distanceFn ? distanceFn((t2 + 1) / order) : d2;
              if (distanceFn && !clockwise) rc = -rc;
              var m2 = sqrt(ov.x * ov.x + ov.y * ov.y);
              ov.x /= m2;
              ov.y /= m2;
              np[t2 + 1] = {
                x: p2.x + rc * ov.x,
                y: p2.y + rc * ov.y
              };
            }.bind(this)
          );
          return new Bezier(np);
        },
        outline: function(d1, d2, d3, d4) {
          d2 = typeof d2 === "undefined" ? d1 : d2;
          var reduced = this.reduce(), len = reduced.length, fcurves = [], bcurves = [], p2, alen = 0, tlen = this.length();
          var graduated = typeof d3 !== "undefined" && typeof d4 !== "undefined";
          function linearDistanceFunction(s2, e2, tlen2, alen2, slen2) {
            return function(v) {
              var f1 = alen2 / tlen2, f2 = (alen2 + slen2) / tlen2, d5 = e2 - s2;
              return utils.map(v, 0, 1, s2 + f1 * d5, s2 + f2 * d5);
            };
          }
          reduced.forEach(function(segment) {
            slen = segment.length();
            if (graduated) {
              fcurves.push(
                segment.scale(linearDistanceFunction(d1, d3, tlen, alen, slen))
              );
              bcurves.push(
                segment.scale(linearDistanceFunction(-d2, -d4, tlen, alen, slen))
              );
            } else {
              fcurves.push(segment.scale(d1));
              bcurves.push(segment.scale(-d2));
            }
            alen += slen;
          });
          bcurves = bcurves.map(function(s2) {
            p2 = s2.points;
            if (p2[3]) {
              s2.points = [p2[3], p2[2], p2[1], p2[0]];
            } else {
              s2.points = [p2[2], p2[1], p2[0]];
            }
            return s2;
          }).reverse();
          var fs = fcurves[0].points[0], fe2 = fcurves[len - 1].points[fcurves[len - 1].points.length - 1], bs2 = bcurves[len - 1].points[bcurves[len - 1].points.length - 1], be2 = bcurves[0].points[0], ls = utils.makeline(bs2, fs), le2 = utils.makeline(fe2, be2), segments = [ls].concat(fcurves).concat([le2]).concat(bcurves), slen = segments.length;
          return new PolyBezier(segments);
        },
        outlineshapes: function(d1, d2, curveIntersectionThreshold) {
          d2 = d2 || d1;
          var outline = this.outline(d1, d2).curves;
          var shapes = [];
          for (var i = 1, len = outline.length; i < len / 2; i++) {
            var shape = utils.makeshape(
              outline[i],
              outline[len - i],
              curveIntersectionThreshold
            );
            shape.startcap.virtual = i > 1;
            shape.endcap.virtual = i < len / 2 - 1;
            shapes.push(shape);
          }
          return shapes;
        },
        intersects: function(curve, curveIntersectionThreshold) {
          if (!curve) return this.selfintersects(curveIntersectionThreshold);
          if (curve.p1 && curve.p2) {
            return this.lineIntersects(curve);
          }
          if (curve instanceof Bezier) {
            curve = curve.reduce();
          }
          return this.curveintersects(
            this.reduce(),
            curve,
            curveIntersectionThreshold
          );
        },
        lineIntersects: function(line2) {
          var mx = min(line2.p1.x, line2.p2.x), my = min(line2.p1.y, line2.p2.y), MX = max(line2.p1.x, line2.p2.x), MY = max(line2.p1.y, line2.p2.y), self2 = this;
          return utils.roots(this.points, line2).filter(function(t2) {
            var p2 = self2.get(t2);
            return utils.between(p2.x, mx, MX) && utils.between(p2.y, my, MY);
          });
        },
        selfintersects: function(curveIntersectionThreshold) {
          var reduced = this.reduce();
          var i, len = reduced.length - 2, results = [], result, left, right;
          for (i = 0; i < len; i++) {
            left = reduced.slice(i, i + 1);
            right = reduced.slice(i + 2);
            result = this.curveintersects(left, right, curveIntersectionThreshold);
            results = results.concat(result);
          }
          return results;
        },
        curveintersects: function(c1, c2, curveIntersectionThreshold) {
          var pairs = [];
          c1.forEach(function(l2) {
            c2.forEach(function(r2) {
              if (l2.overlaps(r2)) {
                pairs.push({ left: l2, right: r2 });
              }
            });
          });
          var intersections = [];
          pairs.forEach(function(pair) {
            var result = utils.pairiteration(
              pair.left,
              pair.right,
              curveIntersectionThreshold
            );
            if (result.length > 0) {
              intersections = intersections.concat(result);
            }
          });
          return intersections;
        },
        arcs: function(errorThreshold) {
          errorThreshold = errorThreshold || 0.5;
          var circles = [];
          return this._iterate(errorThreshold, circles);
        },
        _error: function(pc, np1, s2, e2) {
          var q2 = (e2 - s2) / 4, c1 = this.get(s2 + q2), c2 = this.get(e2 - q2), ref = utils.dist(pc, np1), d1 = utils.dist(pc, c1), d2 = utils.dist(pc, c2);
          return abs(d1 - ref) + abs(d2 - ref);
        },
        _iterate: function(errorThreshold, circles) {
          var t_s = 0, t_e = 1, safety;
          do {
            safety = 0;
            t_e = 1;
            var np1 = this.get(t_s), np2, np3, arc, prev_arc;
            var curr_good = false, prev_good = false, done;
            var t_m = t_e, prev_e = 1, step = 0;
            do {
              prev_good = curr_good;
              prev_arc = arc;
              t_m = (t_s + t_e) / 2;
              step++;
              np2 = this.get(t_m);
              np3 = this.get(t_e);
              arc = utils.getccenter(np1, np2, np3);
              arc.interval = {
                start: t_s,
                end: t_e
              };
              var error = this._error(arc, np1, t_s, t_e);
              curr_good = error <= errorThreshold;
              done = prev_good && !curr_good;
              if (!done) prev_e = t_e;
              if (curr_good) {
                if (t_e >= 1) {
                  arc.interval.end = prev_e = 1;
                  prev_arc = arc;
                  if (t_e > 1) {
                    var d2 = {
                      x: arc.x + arc.r * cos(arc.e),
                      y: arc.y + arc.r * sin(arc.e)
                    };
                    arc.e += utils.angle({ x: arc.x, y: arc.y }, d2, this.get(1));
                  }
                  break;
                }
                t_e = t_e + (t_e - t_s) / 2;
              } else {
                t_e = t_m;
              }
            } while (!done && safety++ < 100);
            if (safety >= 100) {
              break;
            }
            prev_arc = prev_arc ? prev_arc : arc;
            circles.push(prev_arc);
            t_s = prev_e;
          } while (t_e < 1);
          return circles;
        }
      };
      module.exports = Bezier;
    })();
  }
});

// ../../../node_modules/bezier-js/index.js
var require_bezier_js = __commonJS({
  "../../../node_modules/bezier-js/index.js"(exports, module) {
    module.exports = require_bezier();
  }
});

// ../../../node_modules/makerjs/dist/index.js
var require_dist = __commonJS({
  "../../../node_modules/makerjs/dist/index.js"(exports, module) {
    var MakerJs;
    (function(MakerJs2) {
      MakerJs2.version = "debug";
      MakerJs2.environmentTypes = {
        BrowserUI: "browser",
        NodeJs: "node",
        WebWorker: "worker",
        Unknown: "unknown"
      };
      var EPSILON = Number.EPSILON || Math.pow(2, -52);
      function detectEnvironment() {
        var getGlobal = function() {
          if (typeof self !== "undefined") {
            return self;
          }
          if (typeof global !== "undefined") {
            return global;
          }
          return this || {};
        };
        var globalObj = getGlobal();
        if (globalObj["self"] && globalObj["WorkerGlobalScope"] && !globalObj["window"]) {
          return MakerJs2.environmentTypes.WebWorker;
        }
        if (globalObj["window"] && globalObj["document"]) {
          return MakerJs2.environmentTypes.BrowserUI;
        }
        if (globalObj["global"] && globalObj["process"]) {
          return MakerJs2.environmentTypes.NodeJs;
        }
        return MakerJs2.environmentTypes.Unknown;
      }
      MakerJs2.environment = detectEnvironment();
      MakerJs2.unitType = {
        Centimeter: "cm",
        Foot: "foot",
        Inch: "inch",
        Meter: "m",
        Millimeter: "mm"
      };
      function split(s2, char) {
        var p2 = s2.indexOf(char);
        if (p2 < 0) {
          return [s2];
        } else if (p2 > 0) {
          return [s2.substr(0, p2), s2.substr(p2 + 1)];
        } else {
          return ["", s2];
        }
      }
      function splitDecimal(n) {
        var s2 = n.toString();
        if (s2.indexOf("e") > 0) {
          s2 = n.toFixed(20).match(/.*[^(0+$)]/)[0];
        }
        return split(s2, ".");
      }
      MakerJs2.splitDecimal = splitDecimal;
      function round(n, accuracy) {
        if (accuracy === void 0) {
          accuracy = 1e-7;
        }
        if (n % 1 === 0)
          return n;
        var temp = 1 / accuracy;
        return Math.round((n + EPSILON) * temp) / temp;
      }
      MakerJs2.round = round;
      function createRouteKey(route) {
        var converted = [];
        for (var i = 0; i < route.length; i++) {
          var element = route[i];
          var newElement;
          if (i % 2 === 0) {
            newElement = (i > 0 ? "." : "") + element;
          } else {
            newElement = JSON.stringify([element]);
          }
          converted.push(newElement);
        }
        return converted.join("");
      }
      MakerJs2.createRouteKey = createRouteKey;
      function travel(modelContext, route) {
        if (!modelContext || !route)
          return null;
        var routeArray;
        if (Array.isArray(route)) {
          routeArray = route;
        } else {
          routeArray = JSON.parse(route);
        }
        var props = routeArray.slice();
        var ref = modelContext;
        var origin = modelContext.origin || [0, 0];
        while (props.length) {
          var prop = props.shift();
          ref = ref[prop];
          if (!ref)
            return null;
          if (ref.origin && props.length) {
            origin = MakerJs2.point.add(origin, ref.origin);
          }
        }
        return {
          result: ref,
          offset: origin
        };
      }
      MakerJs2.travel = travel;
      var clone = require_clone();
      function cloneObject(objectToClone) {
        return clone(objectToClone);
      }
      MakerJs2.cloneObject = cloneObject;
      function extendObject(target, other) {
        if (target && other) {
          for (var key in other) {
            if (other.hasOwnProperty(key) && typeof other[key] !== "undefined") {
              if (key === "__proto__" || key === "constructor" || key === "prototype")
                continue;
              target[key] = other[key];
            }
          }
        }
        return target;
      }
      MakerJs2.extendObject = extendObject;
      function isFunction(value) {
        return typeof value === "function";
      }
      MakerJs2.isFunction = isFunction;
      function isNumber(value) {
        return typeof value === "number";
      }
      MakerJs2.isNumber = isNumber;
      function isObject(value) {
        return typeof value === "object";
      }
      MakerJs2.isObject = isObject;
      function isPoint(item) {
        return item && Array.isArray(item) && item.length == 2 && isNumber(item[0]) && isNumber(item[1]);
      }
      MakerJs2.isPoint = isPoint;
      function isPath(item) {
        return item && item.type && isPoint(item.origin);
      }
      MakerJs2.isPath = isPath;
      function isPathLine(item) {
        return isPath(item) && item.type == MakerJs2.pathType.Line && isPoint(item.end);
      }
      MakerJs2.isPathLine = isPathLine;
      function isPathCircle(item) {
        return isPath(item) && item.type == MakerJs2.pathType.Circle && isNumber(item.radius);
      }
      MakerJs2.isPathCircle = isPathCircle;
      function isPathArc(item) {
        return isPath(item) && item.type == MakerJs2.pathType.Arc && isNumber(item.radius) && isNumber(item.startAngle) && isNumber(item.endAngle);
      }
      MakerJs2.isPathArc = isPathArc;
      function isPathArcInBezierCurve(item) {
        return isPathArc(item) && isObject(item.bezierData) && isNumber(item.bezierData.startT) && isNumber(item.bezierData.endT);
      }
      MakerJs2.isPathArcInBezierCurve = isPathArcInBezierCurve;
      MakerJs2.pathType = {
        Line: "line",
        Circle: "circle",
        Arc: "arc",
        BezierSeed: "bezier-seed"
      };
      function isModel(item) {
        return item && (item.paths || item.models);
      }
      MakerJs2.isModel = isModel;
      function isChain(item) {
        var x2 = item;
        return x2 && x2.links && Array.isArray(x2.links) && isNumber(x2.pathLength);
      }
      MakerJs2.isChain = isChain;
      var Cascade = (
        /** @class */
        (function() {
          function Cascade2(_module, $initial) {
            this._module = _module;
            this.$initial = $initial;
            for (var methodName in this._module)
              this._shadow(methodName);
            this.$result = $initial;
          }
          Cascade2.prototype._shadow = function(methodName) {
            var _this = this;
            this[methodName] = function() {
              return _this._apply(_this._module[methodName], arguments);
            };
          };
          Cascade2.prototype._apply = function(fn, carriedArguments) {
            var args = [].slice.call(carriedArguments);
            args.unshift(this.$result);
            this.$result = fn.apply(void 0, args);
            return this;
          };
          Cascade2.prototype.$reset = function() {
            this.$result = this.$initial;
            return this;
          };
          return Cascade2;
        })()
      );
      function $2(context) {
        if (isModel(context)) {
          return new Cascade(MakerJs2.model, context);
        } else if (isPath(context)) {
          return new Cascade(MakerJs2.path, context);
        } else if (isPoint(context)) {
          return new Cascade(MakerJs2.point, context);
        }
      }
      MakerJs2.$ = $2;
    })(MakerJs || (MakerJs = {}));
    module.exports = MakerJs;
    var MakerJs;
    (function(MakerJs2) {
      var angle;
      (function(angle2) {
        function getFractionalPart(n) {
          return MakerJs2.splitDecimal(n)[1];
        }
        function setFractionalPart(n, fractionalPart) {
          if (fractionalPart) {
            return +(MakerJs2.splitDecimal(n)[0] + "." + fractionalPart);
          } else {
            return n;
          }
        }
        function copyFractionalPart(src, dest) {
          if (src < 0 && dest < 0 || src > 0 && dest > 0) {
            return setFractionalPart(dest, getFractionalPart(src));
          }
          return dest;
        }
        function noRevolutions(angleInDegrees) {
          var revolutions = Math.floor(angleInDegrees / 360);
          if (revolutions === 0)
            return angleInDegrees;
          var a2 = angleInDegrees - 360 * revolutions;
          return copyFractionalPart(angleInDegrees, a2);
        }
        angle2.noRevolutions = noRevolutions;
        function toRadians(angleInDegrees) {
          return noRevolutions(angleInDegrees) * Math.PI / 180;
        }
        angle2.toRadians = toRadians;
        function toDegrees(angleInRadians) {
          return angleInRadians * 180 / Math.PI;
        }
        angle2.toDegrees = toDegrees;
        function ofArcEnd(arc) {
          if (arc.endAngle < arc.startAngle) {
            var revolutions = Math.ceil((arc.startAngle - arc.endAngle) / 360);
            var a2 = revolutions * 360 + arc.endAngle;
            return copyFractionalPart(arc.endAngle, a2);
          }
          return arc.endAngle;
        }
        angle2.ofArcEnd = ofArcEnd;
        function ofArcMiddle(arc, ratio) {
          if (ratio === void 0) {
            ratio = 0.5;
          }
          return arc.startAngle + ofArcSpan(arc) * ratio;
        }
        angle2.ofArcMiddle = ofArcMiddle;
        function ofArcSpan(arc) {
          var endAngle = angle2.ofArcEnd(arc);
          var a2 = endAngle - arc.startAngle;
          if (MakerJs2.round(a2) > 360) {
            return noRevolutions(a2);
          } else {
            return a2;
          }
        }
        angle2.ofArcSpan = ofArcSpan;
        function ofLineInDegrees(line2) {
          return noRevolutions(toDegrees(ofPointInRadians(line2.origin, line2.end)));
        }
        angle2.ofLineInDegrees = ofLineInDegrees;
        function ofPointInDegrees(origin, pointToFindAngle) {
          return toDegrees(ofPointInRadians(origin, pointToFindAngle));
        }
        angle2.ofPointInDegrees = ofPointInDegrees;
        function ofPointInRadians(origin, pointToFindAngle) {
          var d2 = MakerJs2.point.subtract(pointToFindAngle, origin);
          var x2 = d2[0];
          var y2 = d2[1];
          return Math.atan2(-y2, -x2) + Math.PI;
        }
        angle2.ofPointInRadians = ofPointInRadians;
        function mirror(angleInDegrees, mirrorX, mirrorY) {
          if (mirrorY) {
            angleInDegrees = 360 - angleInDegrees;
          }
          if (mirrorX) {
            angleInDegrees = (angleInDegrees < 180 ? 180 : 540) - angleInDegrees;
          }
          return angleInDegrees;
        }
        angle2.mirror = mirror;
        var linkLineMap = {};
        linkLineMap[MakerJs2.pathType.Arc] = function(arc, first, reversed) {
          var fromEnd = first != reversed;
          var angleToRotate = fromEnd ? arc.endAngle - 90 : arc.startAngle + 90;
          var origin = MakerJs2.point.fromArc(arc)[fromEnd ? 1 : 0];
          var end = MakerJs2.point.rotate(MakerJs2.point.add(origin, [arc.radius, 0]), angleToRotate, origin);
          return new MakerJs2.paths.Line(first ? [end, origin] : [origin, end]);
        };
        linkLineMap[MakerJs2.pathType.Line] = function(line2, first, reversed) {
          return reversed ? new MakerJs2.paths.Line(line2.end, line2.origin) : line2;
        };
        function getLinkLine(chainLink, first) {
          if (chainLink) {
            var p2 = chainLink.walkedPath.pathContext;
            var fn = linkLineMap[p2.type];
            if (fn) {
              return fn(p2, first, chainLink.reversed);
            }
          }
        }
        function ofChainLinkJoint(linkA, linkB) {
          if (arguments.length < 2)
            return null;
          var linkLines = [linkA, linkB].map(function(link, i) {
            return getLinkLine(link, i === 0);
          });
          var result = noRevolutions(ofLineInDegrees(linkLines[1]) - ofLineInDegrees(linkLines[0]));
          if (result > 180)
            result -= 360;
          return result;
        }
        angle2.ofChainLinkJoint = ofChainLinkJoint;
      })(angle = MakerJs2.angle || (MakerJs2.angle = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var point;
      (function(point2) {
        function add(a2, b2, subtract2) {
          var newPoint = clone(a2);
          if (!b2)
            return newPoint;
          for (var i = 2; i--; ) {
            if (subtract2) {
              newPoint[i] -= b2[i];
            } else {
              newPoint[i] += b2[i];
            }
          }
          return newPoint;
        }
        point2.add = add;
        function average(a2, b2) {
          function avg(i) {
            return (a2[i] + b2[i]) / 2;
          }
          return [avg(0), avg(1)];
        }
        point2.average = average;
        function clone(pointToClone) {
          if (!pointToClone)
            return point2.zero();
          return [pointToClone[0], pointToClone[1]];
        }
        point2.clone = clone;
        function closest(referencePoint, pointOptions) {
          var smallest = {
            index: 0,
            distance: -1
          };
          for (var i = 0; i < pointOptions.length; i++) {
            var distance = MakerJs2.measure.pointDistance(referencePoint, pointOptions[i]);
            if (smallest.distance == -1 || distance < smallest.distance) {
              smallest.distance = distance;
              smallest.index = i;
            }
          }
          return pointOptions[smallest.index];
        }
        point2.closest = closest;
        var zero_cos = {};
        zero_cos[Math.PI / 2] = true;
        zero_cos[3 * Math.PI / 2] = true;
        var zero_sin = {};
        zero_sin[Math.PI] = true;
        zero_sin[2 * Math.PI] = true;
        function fromPolar(angleInRadians, radius) {
          return [
            angleInRadians in zero_cos ? 0 : MakerJs2.round(radius * Math.cos(angleInRadians)),
            angleInRadians in zero_sin ? 0 : MakerJs2.round(radius * Math.sin(angleInRadians))
          ];
        }
        point2.fromPolar = fromPolar;
        function fromAngleOnCircle(angleInDegrees, circle2) {
          return add(circle2.origin, fromPolar(MakerJs2.angle.toRadians(angleInDegrees), circle2.radius));
        }
        point2.fromAngleOnCircle = fromAngleOnCircle;
        function fromArc(arc) {
          return [fromAngleOnCircle(arc.startAngle, arc), fromAngleOnCircle(arc.endAngle, arc)];
        }
        point2.fromArc = fromArc;
        var pathEndsMap = {};
        pathEndsMap[MakerJs2.pathType.Arc] = function(arc) {
          return point2.fromArc(arc);
        };
        pathEndsMap[MakerJs2.pathType.Line] = function(line2) {
          return [line2.origin, line2.end];
        };
        pathEndsMap[MakerJs2.pathType.BezierSeed] = pathEndsMap[MakerJs2.pathType.Line];
        function fromPathEnds(pathContext, pathOffset) {
          var result = null;
          var fn = pathEndsMap[pathContext.type];
          if (fn) {
            result = fn(pathContext);
            if (pathOffset) {
              result = result.map(function(p2) {
                return add(p2, pathOffset);
              });
            }
          }
          return result;
        }
        point2.fromPathEnds = fromPathEnds;
        function verticalIntersectionPoint(verticalLine, nonVerticalSlope) {
          var x2 = verticalLine.origin[0];
          var y2 = nonVerticalSlope.slope * x2 + nonVerticalSlope.yIntercept;
          return [x2, y2];
        }
        function fromSlopeIntersection(lineA, lineB, options) {
          if (options === void 0) {
            options = {};
          }
          var slopeA = MakerJs2.measure.lineSlope(lineA);
          var slopeB = MakerJs2.measure.lineSlope(lineB);
          if (MakerJs2.measure.isSlopeParallel(slopeA, slopeB)) {
            if (MakerJs2.measure.isSlopeEqual(slopeA, slopeB)) {
              options.out_AreOverlapped = MakerJs2.measure.isLineOverlapping(lineA, lineB, options.excludeTangents);
            }
            return null;
          }
          var pointOfIntersection;
          if (!slopeA.hasSlope) {
            pointOfIntersection = verticalIntersectionPoint(lineA, slopeB);
          } else if (!slopeB.hasSlope) {
            pointOfIntersection = verticalIntersectionPoint(lineB, slopeA);
          } else {
            var x2 = (slopeB.yIntercept - slopeA.yIntercept) / (slopeA.slope - slopeB.slope);
            var y2 = slopeA.slope * x2 + slopeA.yIntercept;
            pointOfIntersection = [x2, y2];
          }
          return pointOfIntersection;
        }
        point2.fromSlopeIntersection = fromSlopeIntersection;
        function midCircle(circle2, midAngle) {
          return point2.add(circle2.origin, point2.fromPolar(MakerJs2.angle.toRadians(midAngle), circle2.radius));
        }
        var middleMap = {};
        middleMap[MakerJs2.pathType.Arc] = function(arc, ratio) {
          var midAngle = MakerJs2.angle.ofArcMiddle(arc, ratio);
          return midCircle(arc, midAngle);
        };
        middleMap[MakerJs2.pathType.Circle] = function(circle2, ratio) {
          return midCircle(circle2, 360 * ratio);
        };
        middleMap[MakerJs2.pathType.Line] = function(line2, ratio) {
          function ration(a2, b2) {
            return a2 + (b2 - a2) * ratio;
          }
          ;
          return [
            ration(line2.origin[0], line2.end[0]),
            ration(line2.origin[1], line2.end[1])
          ];
        };
        middleMap[MakerJs2.pathType.BezierSeed] = function(seed, ratio) {
          return MakerJs2.models.BezierCurve.computePoint(seed, ratio);
        };
        function middle(pathContext, ratio) {
          if (ratio === void 0) {
            ratio = 0.5;
          }
          var midPoint = null;
          var fn = middleMap[pathContext.type];
          if (fn) {
            midPoint = fn(pathContext, ratio);
          }
          return midPoint;
        }
        point2.middle = middle;
        function mirror(pointToMirror, mirrorX, mirrorY) {
          var p2 = clone(pointToMirror);
          if (mirrorX) {
            p2[0] = -p2[0];
          }
          if (mirrorY) {
            p2[1] = -p2[1];
          }
          return p2;
        }
        point2.mirror = mirror;
        function rounded(pointContext, accuracy) {
          return [MakerJs2.round(pointContext[0], accuracy), MakerJs2.round(pointContext[1], accuracy)];
        }
        point2.rounded = rounded;
        function rotate(pointToRotate, angleInDegrees, rotationOrigin) {
          if (rotationOrigin === void 0) {
            rotationOrigin = [0, 0];
          }
          var pointAngleInRadians = MakerJs2.angle.ofPointInRadians(rotationOrigin, pointToRotate);
          var d2 = MakerJs2.measure.pointDistance(rotationOrigin, pointToRotate);
          var rotatedPoint = fromPolar(pointAngleInRadians + MakerJs2.angle.toRadians(angleInDegrees), d2);
          return add(rotationOrigin, rotatedPoint);
        }
        point2.rotate = rotate;
        function scale(pointToScale, scaleValue) {
          var p2 = clone(pointToScale);
          for (var i = 2; i--; ) {
            p2[i] *= scaleValue;
          }
          return p2;
        }
        point2.scale = scale;
        function distort(pointToDistort, scaleX, scaleY) {
          return [pointToDistort[0] * scaleX, pointToDistort[1] * scaleY];
        }
        point2.distort = distort;
        function subtract(a2, b2) {
          return add(a2, b2, true);
        }
        point2.subtract = subtract;
        function zero() {
          return [0, 0];
        }
        point2.zero = zero;
      })(point = MakerJs2.point || (MakerJs2.point = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var path;
      (function(path2) {
        function addTo(childPath, parentModel, pathId, overwrite) {
          if (overwrite === void 0) {
            overwrite = false;
          }
          MakerJs2.model.addPath(parentModel, childPath, pathId, overwrite);
          return childPath;
        }
        path2.addTo = addTo;
        function copyLayer(pathA, pathB) {
          if (pathA && pathB && typeof pathA.layer !== "undefined") {
            pathB.layer = pathA.layer;
          }
          if (pathA && pathB && "bezierData" in pathA) {
            pathB.bezierData = pathA.bezierData;
          }
        }
        var copyPropsMap = {};
        copyPropsMap[MakerJs2.pathType.Circle] = function(srcCircle, destCircle, offset) {
          destCircle.radius = srcCircle.radius;
        };
        copyPropsMap[MakerJs2.pathType.Arc] = function(srcArc, destArc, offset) {
          copyPropsMap[MakerJs2.pathType.Circle](srcArc, destArc, offset);
          destArc.startAngle = srcArc.startAngle;
          destArc.endAngle = srcArc.endAngle;
        };
        copyPropsMap[MakerJs2.pathType.Line] = function(srcLine, destLine, offset) {
          destLine.end = MakerJs2.point.add(srcLine.end, offset);
        };
        copyPropsMap[MakerJs2.pathType.BezierSeed] = function(srcSeed, destSeed, offset) {
          copyPropsMap[MakerJs2.pathType.Line](srcSeed, destSeed, offset);
          destSeed.controls = srcSeed.controls.map(function(p2) {
            return MakerJs2.point.add(p2, offset);
          });
        };
        function clone(pathToClone, offset) {
          var result = { type: pathToClone.type, origin: MakerJs2.point.add(pathToClone.origin, offset) };
          var fn = copyPropsMap[pathToClone.type];
          if (fn) {
            fn(pathToClone, result, offset);
          }
          copyLayer(pathToClone, result);
          return result;
        }
        path2.clone = clone;
        function copyProps(srcPath, destPath) {
          var fn = copyPropsMap[srcPath.type];
          if (fn) {
            destPath.origin = MakerJs2.point.clone(srcPath.origin);
            fn(srcPath, destPath);
          }
          copyLayer(srcPath, destPath);
          return srcPath;
        }
        path2.copyProps = copyProps;
        var mirrorMap = {};
        mirrorMap[MakerJs2.pathType.Line] = function(line2, origin, mirrorX, mirrorY) {
          return new MakerJs2.paths.Line(origin, MakerJs2.point.mirror(line2.end, mirrorX, mirrorY));
        };
        mirrorMap[MakerJs2.pathType.Circle] = function(circle2, origin, mirrorX, mirrorY) {
          return new MakerJs2.paths.Circle(origin, circle2.radius);
        };
        mirrorMap[MakerJs2.pathType.Arc] = function(arc, origin, mirrorX, mirrorY) {
          var startAngle = MakerJs2.angle.mirror(arc.startAngle, mirrorX, mirrorY);
          var endAngle = MakerJs2.angle.mirror(MakerJs2.angle.ofArcEnd(arc), mirrorX, mirrorY);
          var xor = mirrorX != mirrorY;
          return new MakerJs2.paths.Arc(origin, arc.radius, xor ? endAngle : startAngle, xor ? startAngle : endAngle);
        };
        mirrorMap[MakerJs2.pathType.BezierSeed] = function(seed, origin, mirrorX, mirrorY) {
          var mirrored = mirrorMap[MakerJs2.pathType.Line](seed, origin, mirrorX, mirrorY);
          mirrored.type = MakerJs2.pathType.BezierSeed;
          mirrored.controls = seed.controls.map(function(c2) {
            return MakerJs2.point.mirror(c2, mirrorX, mirrorY);
          });
          return mirrored;
        };
        function layer(pathContext, layer2) {
          pathContext.layer = layer2;
          return pathContext;
        }
        path2.layer = layer;
        function mirror(pathToMirror, mirrorX, mirrorY) {
          var newPath = null;
          if (pathToMirror) {
            var origin = MakerJs2.point.mirror(pathToMirror.origin, mirrorX, mirrorY);
            var fn = mirrorMap[pathToMirror.type];
            if (fn) {
              newPath = fn(pathToMirror, origin, mirrorX, mirrorY);
            }
          }
          copyLayer(pathToMirror, newPath);
          return newPath;
        }
        path2.mirror = mirror;
        var moveMap = {};
        moveMap[MakerJs2.pathType.Line] = function(line2, origin) {
          var delta = MakerJs2.point.subtract(line2.end, line2.origin);
          line2.end = MakerJs2.point.add(origin, delta);
        };
        function move(pathToMove, origin) {
          if (pathToMove) {
            var fn = moveMap[pathToMove.type];
            if (fn) {
              fn(pathToMove, origin);
            }
            pathToMove.origin = origin;
          }
          return pathToMove;
        }
        path2.move = move;
        var moveRelativeMap = {};
        moveRelativeMap[MakerJs2.pathType.Line] = function(line2, delta, subtract) {
          line2.end = MakerJs2.point.add(line2.end, delta, subtract);
        };
        moveRelativeMap[MakerJs2.pathType.BezierSeed] = function(seed, delta, subtract) {
          moveRelativeMap[MakerJs2.pathType.Line](seed, delta, subtract);
          seed.controls = seed.controls.map(function(c2) {
            return MakerJs2.point.add(c2, delta, subtract);
          });
        };
        function moveRelative(pathToMove, delta, subtract) {
          if (pathToMove && delta) {
            pathToMove.origin = MakerJs2.point.add(pathToMove.origin, delta, subtract);
            var fn = moveRelativeMap[pathToMove.type];
            if (fn) {
              fn(pathToMove, delta, subtract);
            }
          }
          return pathToMove;
        }
        path2.moveRelative = moveRelative;
        function moveTemporary(pathsToMove, deltas, task) {
          var subtract = false;
          function move2(pathToOffset, i) {
            if (deltas[i]) {
              moveRelative(pathToOffset, deltas[i], subtract);
            }
          }
          pathsToMove.map(move2);
          task();
          subtract = true;
          pathsToMove.map(move2);
        }
        path2.moveTemporary = moveTemporary;
        var rotateMap = {};
        rotateMap[MakerJs2.pathType.Line] = function(line2, angleInDegrees, rotationOrigin) {
          line2.end = MakerJs2.point.rotate(line2.end, angleInDegrees, rotationOrigin);
        };
        rotateMap[MakerJs2.pathType.Arc] = function(arc, angleInDegrees, rotationOrigin) {
          arc.startAngle = MakerJs2.angle.noRevolutions(arc.startAngle + angleInDegrees);
          arc.endAngle = MakerJs2.angle.noRevolutions(arc.endAngle + angleInDegrees);
        };
        rotateMap[MakerJs2.pathType.BezierSeed] = function(seed, angleInDegrees, rotationOrigin) {
          rotateMap[MakerJs2.pathType.Line](seed, angleInDegrees, rotationOrigin);
          seed.controls = seed.controls.map(function(c2) {
            return MakerJs2.point.rotate(c2, angleInDegrees, rotationOrigin);
          });
        };
        function rotate(pathToRotate, angleInDegrees, rotationOrigin) {
          if (rotationOrigin === void 0) {
            rotationOrigin = [0, 0];
          }
          if (!pathToRotate || !angleInDegrees)
            return pathToRotate;
          pathToRotate.origin = MakerJs2.point.rotate(pathToRotate.origin, angleInDegrees, rotationOrigin);
          var fn = rotateMap[pathToRotate.type];
          if (fn) {
            fn(pathToRotate, angleInDegrees, rotationOrigin);
          }
          return pathToRotate;
        }
        path2.rotate = rotate;
        var scaleMap = {};
        scaleMap[MakerJs2.pathType.Line] = function(line2, scaleValue) {
          line2.end = MakerJs2.point.scale(line2.end, scaleValue);
        };
        scaleMap[MakerJs2.pathType.BezierSeed] = function(seed, scaleValue) {
          scaleMap[MakerJs2.pathType.Line](seed, scaleValue);
          seed.controls = seed.controls.map(function(c2) {
            return MakerJs2.point.scale(c2, scaleValue);
          });
        };
        scaleMap[MakerJs2.pathType.Circle] = function(circle2, scaleValue) {
          circle2.radius *= scaleValue;
        };
        scaleMap[MakerJs2.pathType.Arc] = scaleMap[MakerJs2.pathType.Circle];
        function scale(pathToScale, scaleValue) {
          if (!pathToScale || scaleValue === 1 || !scaleValue)
            return pathToScale;
          pathToScale.origin = MakerJs2.point.scale(pathToScale.origin, scaleValue);
          var fn = scaleMap[pathToScale.type];
          if (fn) {
            fn(pathToScale, scaleValue);
          }
          return pathToScale;
        }
        path2.scale = scale;
        var distortMap = {};
        distortMap[MakerJs2.pathType.Arc] = function(arc, scaleX, scaleY) {
          return new MakerJs2.models.EllipticArc(arc, scaleX, scaleY);
        };
        distortMap[MakerJs2.pathType.Circle] = function(circle2, scaleX, scaleY) {
          var ellipse = new MakerJs2.models.Ellipse(circle2.radius * scaleX, circle2.radius * scaleY);
          ellipse.origin = MakerJs2.point.distort(circle2.origin, scaleX, scaleY);
          return ellipse;
        };
        distortMap[MakerJs2.pathType.Line] = function(line2, scaleX, scaleY) {
          return new MakerJs2.paths.Line([line2.origin, line2.end].map(function(p2) {
            return MakerJs2.point.distort(p2, scaleX, scaleY);
          }));
        };
        distortMap[MakerJs2.pathType.BezierSeed] = function(seed, scaleX, scaleY) {
          var d2 = MakerJs2.point.distort;
          return {
            type: MakerJs2.pathType.BezierSeed,
            origin: d2(seed.origin, scaleX, scaleY),
            controls: seed.controls.map(function(c2) {
              return d2(c2, scaleX, scaleY);
            }),
            end: d2(seed.end, scaleX, scaleY)
          };
        };
        function distort(pathToDistort, scaleX, scaleY) {
          if (!pathToDistort || !scaleX || !scaleY)
            return null;
          var fn = distortMap[pathToDistort.type];
          if (fn) {
            var distorted = fn(pathToDistort, scaleX, scaleY);
            if (typeof pathToDistort.layer !== "undefined") {
              distorted.layer = pathToDistort.layer;
            }
            return distorted;
          }
          return null;
        }
        path2.distort = distort;
        function converge(lineA, lineB, useOriginA, useOriginB) {
          var p2 = MakerJs2.point.fromSlopeIntersection(lineA, lineB);
          if (p2) {
            let setPoint2 = function(line2, useOrigin2) {
              var setP;
              if (useOrigin2) {
                setP = line2.origin;
              } else {
                setP = line2.end;
              }
              setP[0] = p2[0];
              setP[1] = p2[1];
            };
            var setPoint = setPoint2;
            var lines = [lineA, lineB];
            var useOrigin = [useOriginA, useOriginB];
            if (arguments.length === 2) {
              lines.forEach(function(line2, i) {
                useOrigin[i] = MakerJs2.point.closest(p2, [line2.origin, line2.end]) === line2.origin;
              });
            }
            lines.forEach(function(line2, i) {
              setPoint2(line2, useOrigin[i]);
            });
          }
          return p2;
        }
        path2.converge = converge;
        var alterMap = {};
        alterMap[MakerJs2.pathType.Arc] = function(arc, pathLength, distance, useOrigin) {
          var span = MakerJs2.angle.ofArcSpan(arc);
          var delta = (pathLength + distance) * span / pathLength - span;
          if (useOrigin) {
            arc.startAngle -= delta;
          } else {
            arc.endAngle += delta;
          }
        };
        alterMap[MakerJs2.pathType.Circle] = function(circle2, pathLength, distance, useOrigin) {
          circle2.radius *= (pathLength + distance) / pathLength;
        };
        alterMap[MakerJs2.pathType.Line] = function(line2, pathLength, distance, useOrigin) {
          var delta = MakerJs2.point.scale(MakerJs2.point.subtract(line2.end, line2.origin), distance / pathLength);
          if (useOrigin) {
            line2.origin = MakerJs2.point.subtract(line2.origin, delta);
          } else {
            line2.end = MakerJs2.point.add(line2.end, delta);
          }
        };
        function alterLength(pathToAlter, distance, useOrigin) {
          if (useOrigin === void 0) {
            useOrigin = false;
          }
          if (!pathToAlter || !distance)
            return null;
          var fn = alterMap[pathToAlter.type];
          if (fn) {
            var pathLength = MakerJs2.measure.pathLength(pathToAlter);
            if (!pathLength || -distance >= pathLength)
              return null;
            fn(pathToAlter, pathLength, distance, useOrigin);
            return pathToAlter;
          }
          return null;
        }
        path2.alterLength = alterLength;
        function toPoints(pathContext, numberOfPoints) {
          if (numberOfPoints == 1) {
            return [MakerJs2.point.middle(pathContext)];
          }
          var points = [];
          var base = numberOfPoints;
          if (pathContext.type != MakerJs2.pathType.Circle)
            base--;
          for (var i = 0; i < numberOfPoints; i++) {
            points.push(MakerJs2.point.middle(pathContext, i / base));
          }
          return points;
        }
        path2.toPoints = toPoints;
        var numberOfKeyPointsMap = {};
        numberOfKeyPointsMap[MakerJs2.pathType.Line] = function(line2) {
          return 2;
        };
        numberOfKeyPointsMap[MakerJs2.pathType.Circle] = function(circle2, maxPointDistance) {
          var len = MakerJs2.measure.pathLength(circle2);
          if (!len)
            return 0;
          maxPointDistance = maxPointDistance || len;
          return Math.max(8, Math.ceil(len / (maxPointDistance || len)));
        };
        numberOfKeyPointsMap[MakerJs2.pathType.Arc] = function(arc, maxPointDistance) {
          var len = MakerJs2.measure.pathLength(arc);
          if (!len)
            return 0;
          var minPoints = Math.ceil(MakerJs2.angle.ofArcSpan(arc) / 45) + 1;
          return Math.max(minPoints, Math.ceil(len / (maxPointDistance || len)));
        };
        function toKeyPoints(pathContext, maxArcFacet) {
          if (pathContext.type == MakerJs2.pathType.BezierSeed) {
            var curve = new MakerJs2.models.BezierCurve(pathContext);
            var curveKeyPoints;
            MakerJs2.model.findChains(curve, function(chains, loose, layer2) {
              if (chains.length == 1) {
                var c2 = chains[0];
                switch (c2.links[0].walkedPath.pathId) {
                  case "arc_0":
                  case "line_0":
                    break;
                  default:
                    MakerJs2.chain.reverse(c2);
                }
                curveKeyPoints = MakerJs2.chain.toKeyPoints(c2);
              } else if (loose.length === 1) {
                curveKeyPoints = toKeyPoints(loose[0].pathContext);
              }
            });
            return curveKeyPoints;
          } else {
            var fn = numberOfKeyPointsMap[pathContext.type];
            if (fn) {
              var numberOfKeyPoints = fn(pathContext, maxArcFacet);
              if (numberOfKeyPoints) {
                return toPoints(pathContext, numberOfKeyPoints);
              }
            }
          }
          return [];
        }
        path2.toKeyPoints = toKeyPoints;
        function center(pathToCenter) {
          var m2 = MakerJs2.measure.pathExtents(pathToCenter);
          var c2 = MakerJs2.point.average(m2.high, m2.low);
          var o2 = MakerJs2.point.subtract(pathToCenter.origin || [0, 0], c2);
          move(pathToCenter, o2);
          return pathToCenter;
        }
        path2.center = center;
        function zero(pathToZero) {
          var m2 = MakerJs2.measure.pathExtents(pathToZero);
          var z2 = MakerJs2.point.subtract(pathToZero.origin || [0, 0], m2.low);
          move(pathToZero, z2);
          return pathToZero;
        }
        path2.zero = zero;
      })(path = MakerJs2.path || (MakerJs2.path = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var path;
      (function(path_1) {
        var breakPathFunctionMap = {};
        breakPathFunctionMap[MakerJs2.pathType.Arc] = function(arc, pointOfBreak) {
          var angleAtBreakPoint = MakerJs2.angle.ofPointInDegrees(arc.origin, pointOfBreak);
          if (MakerJs2.measure.isAngleEqual(angleAtBreakPoint, arc.startAngle) || MakerJs2.measure.isAngleEqual(angleAtBreakPoint, arc.endAngle)) {
            return null;
          }
          function getAngleStrictlyBetweenArcAngles() {
            var startAngle = MakerJs2.angle.noRevolutions(arc.startAngle);
            var endAngle = startAngle + MakerJs2.angle.ofArcEnd(arc) - arc.startAngle;
            var tries = [0, 1, -1];
            for (var i = 0; i < tries.length; i++) {
              var add = 360 * tries[i];
              if (MakerJs2.measure.isBetween(angleAtBreakPoint + add, startAngle, endAngle, true)) {
                return arc.startAngle + angleAtBreakPoint + add - startAngle;
              }
            }
            return null;
          }
          var angleAtBreakPointBetween = getAngleStrictlyBetweenArcAngles();
          if (angleAtBreakPointBetween == null) {
            return null;
          }
          var savedEndAngle = arc.endAngle;
          arc.endAngle = angleAtBreakPointBetween;
          var copy = MakerJs2.cloneObject(arc);
          copy.startAngle = angleAtBreakPointBetween;
          copy.endAngle = savedEndAngle;
          return copy;
        };
        breakPathFunctionMap[MakerJs2.pathType.Circle] = function(circle2, pointOfBreak) {
          circle2.type = MakerJs2.pathType.Arc;
          var arc = circle2;
          var angleAtBreakPoint = MakerJs2.angle.ofPointInDegrees(circle2.origin, pointOfBreak);
          arc.startAngle = angleAtBreakPoint;
          arc.endAngle = angleAtBreakPoint + 360;
          return null;
        };
        breakPathFunctionMap[MakerJs2.pathType.Line] = function(line2, pointOfBreak) {
          if (!MakerJs2.measure.isBetweenPoints(pointOfBreak, line2, true)) {
            return null;
          }
          var savedEndPoint = line2.end;
          line2.end = pointOfBreak;
          var copy = MakerJs2.cloneObject(line2);
          copy.origin = pointOfBreak;
          copy.end = savedEndPoint;
          return copy;
        };
        function breakAtPoint(pathToBreak, pointOfBreak) {
          if (pathToBreak && pointOfBreak) {
            var fn = breakPathFunctionMap[pathToBreak.type];
            if (fn) {
              var result = fn(pathToBreak, pointOfBreak);
              if (result && "layer" in pathToBreak) {
                result.layer = pathToBreak.layer;
              }
              return result;
            }
          }
          return null;
        }
        path_1.breakAtPoint = breakAtPoint;
      })(path = MakerJs2.path || (MakerJs2.path = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var paths;
      (function(paths2) {
        var Arc = (
          /** @class */
          /* @__PURE__ */ (function() {
            function Arc2() {
              var args = [];
              for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
              }
              var _a, _b;
              function getSpan(origin) {
                var startAngle = MakerJs2.angle.ofPointInDegrees(origin, args[clockwise ? 1 : 0]);
                var endAngle = MakerJs2.angle.ofPointInDegrees(origin, args[clockwise ? 0 : 1]);
                if (endAngle < startAngle) {
                  endAngle += 360;
                }
                return {
                  origin,
                  startAngle,
                  endAngle,
                  size: endAngle - startAngle
                };
              }
              switch (args.length) {
                case 5:
                  var pointA = args[0];
                  var pointB = args[1];
                  this.radius = args[2];
                  var largeArc = args[3];
                  var clockwise = args[4];
                  var span;
                  var smallestRadius = MakerJs2.measure.pointDistance(pointA, pointB) / 2;
                  if (MakerJs2.round(this.radius - smallestRadius) <= 0) {
                    this.radius = smallestRadius;
                    span = getSpan(MakerJs2.point.average(pointA, pointB));
                  } else {
                    var intersectionPoints = (_b = (_a = MakerJs2.path.intersection(new Circle(pointA, this.radius), new Circle(pointB, this.radius))) === null || _a === void 0 ? void 0 : _a.intersectionPoints) !== null && _b !== void 0 ? _b : [pointA, pointB];
                    var spans = [];
                    for (var i = intersectionPoints.length; i--; ) {
                      span = getSpan(intersectionPoints[i]);
                      if (spans.length == 0 || span.size > spans[0].size) {
                        spans.push(span);
                      } else {
                        spans.unshift(span);
                      }
                    }
                    var index = largeArc ? 1 : 0;
                    span = spans[index];
                  }
                  this.origin = span.origin;
                  this.startAngle = span.startAngle;
                  this.endAngle = span.endAngle;
                  break;
                case 4:
                  this.origin = args[0];
                  this.radius = args[1];
                  this.startAngle = args[2];
                  this.endAngle = args[3];
                  break;
                case 3:
                  if (MakerJs2.isPoint(args[2])) {
                    Circle.apply(this, args);
                    var angles = [];
                    for (var i_1 = 0; i_1 < 3; i_1++) {
                      angles.push(MakerJs2.angle.ofPointInDegrees(this.origin, args[i_1]));
                    }
                    this.startAngle = angles[0];
                    this.endAngle = angles[2];
                    if (!MakerJs2.measure.isBetweenArcAngles(angles[1], this, false)) {
                      this.startAngle = angles[2];
                      this.endAngle = angles[0];
                    }
                    break;
                  }
                //fall through to below if 2 points
                case 2:
                  var clockwise = args[2];
                  Circle.call(this, args[0], args[1]);
                  this.startAngle = MakerJs2.angle.ofPointInDegrees(this.origin, args[clockwise ? 1 : 0]);
                  this.endAngle = MakerJs2.angle.ofPointInDegrees(this.origin, args[clockwise ? 0 : 1]);
                  break;
              }
              this.type = MakerJs2.pathType.Arc;
            }
            return Arc2;
          })()
        );
        paths2.Arc = Arc;
        var Circle = (
          /** @class */
          /* @__PURE__ */ (function() {
            function Circle2() {
              var args = [];
              for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
              }
              this.type = MakerJs2.pathType.Circle;
              switch (args.length) {
                case 1:
                  this.origin = [0, 0];
                  this.radius = args[0];
                  break;
                case 2:
                  if (MakerJs2.isNumber(args[1])) {
                    this.origin = args[0];
                    this.radius = args[1];
                  } else {
                    this.origin = MakerJs2.point.average(args[0], args[1]);
                    this.radius = MakerJs2.measure.pointDistance(this.origin, args[0]);
                  }
                  break;
                default:
                  var lines = [
                    new Line(args[0], args[1]),
                    new Line(args[1], args[2])
                  ];
                  var perpendiculars = [];
                  for (var i = 2; i--; ) {
                    var midpoint = MakerJs2.point.middle(lines[i]);
                    perpendiculars.push(MakerJs2.path.rotate(lines[i], 90, midpoint));
                  }
                  var origin = MakerJs2.point.fromSlopeIntersection(perpendiculars[0], perpendiculars[1]);
                  if (origin) {
                    this.origin = origin;
                    this.radius = MakerJs2.measure.pointDistance(this.origin, args[0]);
                  } else {
                    throw "invalid parameters - attempted to construct a circle from 3 points on a line: " + JSON.stringify(args);
                  }
                  break;
              }
            }
            return Circle2;
          })()
        );
        paths2.Circle = Circle;
        var Line = (
          /** @class */
          /* @__PURE__ */ (function() {
            function Line2() {
              var args = [];
              for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
              }
              this.type = MakerJs2.pathType.Line;
              switch (args.length) {
                case 1:
                  var points = args[0];
                  this.origin = points[0];
                  this.end = points[1];
                  break;
                case 2:
                  this.origin = args[0];
                  this.end = args[1];
                  break;
              }
            }
            return Line2;
          })()
        );
        paths2.Line = Line;
        var Chord = (
          /** @class */
          /* @__PURE__ */ (function() {
            function Chord2(arc) {
              var arcPoints = MakerJs2.point.fromArc(arc);
              this.type = MakerJs2.pathType.Line;
              this.origin = arcPoints[0];
              this.end = arcPoints[1];
            }
            return Chord2;
          })()
        );
        paths2.Chord = Chord;
        var Parallel = (
          /** @class */
          /* @__PURE__ */ (function() {
            function Parallel2(toLine, distance, nearPoint) {
              this.type = MakerJs2.pathType.Line;
              this.origin = MakerJs2.point.clone(toLine.origin);
              this.end = MakerJs2.point.clone(toLine.end);
              var angleOfLine = MakerJs2.angle.ofLineInDegrees(this);
              function getNewOrigin(offsetAngle) {
                var origin = MakerJs2.point.add(toLine.origin, MakerJs2.point.fromPolar(MakerJs2.angle.toRadians(angleOfLine + offsetAngle), distance));
                return {
                  origin,
                  nearness: MakerJs2.measure.pointDistance(origin, nearPoint)
                };
              }
              var newOrigins = [getNewOrigin(-90), getNewOrigin(90)];
              var newOrigin = newOrigins[0].nearness < newOrigins[1].nearness ? newOrigins[0].origin : newOrigins[1].origin;
              MakerJs2.path.move(this, newOrigin);
            }
            return Parallel2;
          })()
        );
        paths2.Parallel = Parallel;
      })(paths = MakerJs2.paths || (MakerJs2.paths = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var model;
      (function(model2) {
        function addCaption(modelContext, text, leftAnchorPoint, rightAnchorPoint) {
          if (!leftAnchorPoint) {
            leftAnchorPoint = MakerJs2.point.zero();
          }
          if (!rightAnchorPoint) {
            rightAnchorPoint = MakerJs2.point.clone(leftAnchorPoint);
          }
          modelContext.caption = { text, anchor: new MakerJs2.paths.Line(leftAnchorPoint, rightAnchorPoint) };
          return modelContext;
        }
        model2.addCaption = addCaption;
        function addPath(modelContext, pathContext, pathId, overWrite) {
          if (overWrite === void 0) {
            overWrite = false;
          }
          var id = overWrite ? pathId : getSimilarPathId(modelContext, pathId);
          modelContext.paths = modelContext.paths || {};
          modelContext.paths[id] = pathContext;
          return modelContext;
        }
        model2.addPath = addPath;
        function addModel(parentModel, childModel, childModelId, overWrite) {
          if (overWrite === void 0) {
            overWrite = false;
          }
          var id = overWrite ? childModelId : getSimilarModelId(parentModel, childModelId);
          parentModel.models = parentModel.models || {};
          parentModel.models[id] = childModel;
          return parentModel;
        }
        model2.addModel = addModel;
        function addTo(childModel, parentModel, childModelId, overWrite) {
          if (overWrite === void 0) {
            overWrite = false;
          }
          addModel(parentModel, childModel, childModelId, overWrite);
          return childModel;
        }
        model2.addTo = addTo;
        function clone(modelToClone) {
          return MakerJs2.cloneObject(modelToClone);
        }
        model2.clone = clone;
        function countChildModels(modelContext) {
          var count = 0;
          if (modelContext.models) {
            for (var id in modelContext.models) {
              count++;
            }
          }
          return count;
        }
        model2.countChildModels = countChildModels;
        function getAllCaptionsOffset(modelContext) {
          var captions = [];
          function tryAddCaption(m2, offset, layer2) {
            if (m2.caption) {
              captions.push({ text: m2.caption.text, anchor: MakerJs2.path.clone(m2.caption.anchor, MakerJs2.point.add(m2.origin, offset)), layer: m2.caption.anchor.layer || layer2 });
            }
          }
          tryAddCaption(modelContext, modelContext.origin, modelContext.layer);
          model2.walk(modelContext, {
            afterChildWalk: function(wm) {
              return tryAddCaption(wm.childModel, wm.offset, wm.layer);
            }
          });
          return captions;
        }
        model2.getAllCaptionsOffset = getAllCaptionsOffset;
        function getSimilarId(map, id) {
          if (!map)
            return id;
          var i = 0;
          var newId = id;
          while (newId in map) {
            i++;
            newId = [id, i].join("_");
          }
          return newId;
        }
        function getSimilarModelId(modelContext, modelId) {
          return getSimilarId(modelContext.models, modelId);
        }
        model2.getSimilarModelId = getSimilarModelId;
        function getSimilarPathId(modelContext, pathId) {
          return getSimilarId(modelContext.paths, pathId);
        }
        model2.getSimilarPathId = getSimilarPathId;
        function layer(modelContext, layer2) {
          modelContext.layer = layer2;
          return modelContext;
        }
        model2.layer = layer;
        function originate(modelToOriginate, origin) {
          function innerOriginate(m2, o2) {
            if (!m2)
              return;
            var newOrigin = MakerJs2.point.add(m2.origin, o2);
            if (m2.type === MakerJs2.models.BezierCurve.typeName) {
              MakerJs2.path.moveRelative(m2.seed, newOrigin);
            }
            if (m2.paths) {
              for (var id in m2.paths) {
                MakerJs2.path.moveRelative(m2.paths[id], newOrigin);
              }
            }
            if (m2.models) {
              for (var id in m2.models) {
                innerOriginate(m2.models[id], newOrigin);
              }
            }
            if (m2.caption) {
              MakerJs2.path.moveRelative(m2.caption.anchor, newOrigin);
            }
            m2.origin = MakerJs2.point.zero();
          }
          innerOriginate(modelToOriginate, origin ? MakerJs2.point.subtract([0, 0], origin) : [0, 0]);
          if (origin) {
            modelToOriginate.origin = origin;
          }
          return modelToOriginate;
        }
        model2.originate = originate;
        function center(modelToCenter, centerX, centerY) {
          if (centerX === void 0) {
            centerX = true;
          }
          if (centerY === void 0) {
            centerY = true;
          }
          var m2 = MakerJs2.measure.modelExtents(modelToCenter);
          var o2 = modelToCenter.origin || [0, 0];
          if (centerX)
            o2[0] -= m2.center[0];
          if (centerY)
            o2[1] -= m2.center[1];
          modelToCenter.origin = o2;
          return modelToCenter;
        }
        model2.center = center;
        function mirror(modelToMirror, mirrorX, mirrorY) {
          var newModel = {};
          if (!modelToMirror)
            return null;
          if (modelToMirror.origin) {
            newModel.origin = MakerJs2.point.mirror(modelToMirror.origin, mirrorX, mirrorY);
          }
          if (modelToMirror.type) {
            newModel.type = modelToMirror.type;
          }
          if ("layer" in modelToMirror) {
            newModel.layer = modelToMirror.layer;
          }
          if (modelToMirror.units) {
            newModel.units = modelToMirror.units;
          }
          if (modelToMirror.type === MakerJs2.models.BezierCurve.typeName) {
            newModel.type = MakerJs2.models.BezierCurve.typeName;
            newModel.seed = MakerJs2.path.mirror(modelToMirror.seed, mirrorX, mirrorY);
          }
          if (modelToMirror.paths) {
            newModel.paths = {};
            for (var id in modelToMirror.paths) {
              var pathToMirror = modelToMirror.paths[id];
              if (!pathToMirror)
                continue;
              var pathMirrored = MakerJs2.path.mirror(pathToMirror, mirrorX, mirrorY);
              if (!pathMirrored)
                continue;
              newModel.paths[id] = pathMirrored;
            }
          }
          if (modelToMirror.models) {
            newModel.models = {};
            for (var id in modelToMirror.models) {
              var childModelToMirror = modelToMirror.models[id];
              if (!childModelToMirror)
                continue;
              var childModelMirrored = mirror(childModelToMirror, mirrorX, mirrorY);
              if (!childModelMirrored)
                continue;
              newModel.models[id] = childModelMirrored;
            }
          }
          if (modelToMirror.caption) {
            newModel.caption = MakerJs2.cloneObject(modelToMirror.caption);
            newModel.caption.anchor = MakerJs2.path.mirror(modelToMirror.caption.anchor, mirrorX, mirrorY);
          }
          return newModel;
        }
        model2.mirror = mirror;
        function move(modelToMove, origin) {
          modelToMove.origin = MakerJs2.point.clone(origin);
          return modelToMove;
        }
        model2.move = move;
        function moveRelative(modelToMove, delta) {
          if (modelToMove) {
            modelToMove.origin = MakerJs2.point.add(modelToMove.origin || MakerJs2.point.zero(), delta);
          }
          return modelToMove;
        }
        model2.moveRelative = moveRelative;
        function prefixPathIds(modelToPrefix, prefix) {
          var walkedPaths = [];
          walk(modelToPrefix, {
            onPath: function(walkedPath2) {
              walkedPaths.push(walkedPath2);
            }
          });
          for (var i = 0; i < walkedPaths.length; i++) {
            var walkedPath = walkedPaths[i];
            delete walkedPath.modelContext.paths[walkedPath.pathId];
            walkedPath.modelContext.paths[prefix + walkedPath.pathId] = walkedPath.pathContext;
          }
          return modelToPrefix;
        }
        model2.prefixPathIds = prefixPathIds;
        function rotate(modelToRotate, angleInDegrees, rotationOrigin) {
          if (rotationOrigin === void 0) {
            rotationOrigin = [0, 0];
          }
          if (!modelToRotate || !angleInDegrees)
            return modelToRotate;
          var offsetOrigin = MakerJs2.point.subtract(rotationOrigin, modelToRotate.origin);
          if (modelToRotate.type === MakerJs2.models.BezierCurve.typeName) {
            MakerJs2.path.rotate(modelToRotate.seed, angleInDegrees, offsetOrigin);
          }
          if (modelToRotate.paths) {
            for (var id in modelToRotate.paths) {
              MakerJs2.path.rotate(modelToRotate.paths[id], angleInDegrees, offsetOrigin);
            }
          }
          if (modelToRotate.models) {
            for (var id in modelToRotate.models) {
              rotate(modelToRotate.models[id], angleInDegrees, offsetOrigin);
            }
          }
          if (modelToRotate.caption) {
            MakerJs2.path.rotate(modelToRotate.caption.anchor, angleInDegrees, offsetOrigin);
          }
          return modelToRotate;
        }
        model2.rotate = rotate;
        function scale(modelToScale, scaleValue, scaleOrigin) {
          if (scaleOrigin === void 0) {
            scaleOrigin = false;
          }
          if (scaleOrigin && modelToScale.origin) {
            modelToScale.origin = MakerJs2.point.scale(modelToScale.origin, scaleValue);
          }
          if (modelToScale.type === MakerJs2.models.BezierCurve.typeName) {
            MakerJs2.path.scale(modelToScale.seed, scaleValue);
          }
          if (modelToScale.paths) {
            for (var id in modelToScale.paths) {
              MakerJs2.path.scale(modelToScale.paths[id], scaleValue);
            }
          }
          if (modelToScale.models) {
            for (var id in modelToScale.models) {
              scale(modelToScale.models[id], scaleValue, true);
            }
          }
          if (modelToScale.caption) {
            MakerJs2.path.scale(modelToScale.caption.anchor, scaleValue);
          }
          return modelToScale;
        }
        model2.scale = scale;
        function addDistortedPath(parentModel, pathToDistort, pathId, layer2, scaleX, scaleY, bezierAccuracy) {
          var distortedPath = MakerJs2.path.distort(pathToDistort, scaleX, scaleY);
          layer2 = layer2 || pathToDistort.layer;
          if (layer2) {
            distortedPath.layer = layer2;
          }
          if (MakerJs2.isPath(distortedPath)) {
            if (distortedPath.type === MakerJs2.pathType.BezierSeed) {
              var curve = new MakerJs2.models.BezierCurve(distortedPath, bezierAccuracy);
              addModel(parentModel, curve, pathId);
            } else {
              addPath(parentModel, distortedPath, pathId);
            }
          } else {
            addModel(parentModel, distortedPath, pathId);
          }
        }
        function distort(modelToDistort, scaleX, scaleY, scaleOrigin, bezierAccuracy) {
          if (scaleOrigin === void 0) {
            scaleOrigin = false;
          }
          var distorted = {};
          if (modelToDistort.layer) {
            distorted.layer = modelToDistort.layer;
          }
          if (scaleOrigin && modelToDistort.origin) {
            distorted.origin = MakerJs2.point.distort(modelToDistort.origin, scaleX, scaleY);
          }
          if (modelToDistort.type === MakerJs2.models.BezierCurve.typeName) {
            var b2 = modelToDistort;
            var bezierPartsByLayer = MakerJs2.models.BezierCurve.getBezierSeeds(b2, { byLayers: true, pointMatchingDistance: bezierAccuracy });
            var _loop_1 = function(layer_12) {
              var pathArray = bezierPartsByLayer[layer_12];
              pathArray.forEach(function(p2, i) {
                addDistortedPath(distorted, p2, i.toString(), layer_12, scaleX, scaleY, bezierAccuracy);
              });
            };
            for (var layer_1 in bezierPartsByLayer) {
              _loop_1(layer_1);
            }
          } else if (modelToDistort.paths) {
            for (var pathId in modelToDistort.paths) {
              var pathToDistort = modelToDistort.paths[pathId];
              addDistortedPath(distorted, pathToDistort, pathId, null, scaleX, scaleY, bezierAccuracy);
            }
          }
          if (modelToDistort.models) {
            for (var childId in modelToDistort.models) {
              var childModel = modelToDistort.models[childId];
              var distortedChild = distort(childModel, scaleX, scaleY, true, bezierAccuracy);
              addModel(distorted, distortedChild, childId);
            }
          }
          if (modelToDistort.caption) {
            distorted.caption = MakerJs2.cloneObject(modelToDistort.caption);
            distorted.caption.anchor = MakerJs2.path.distort(modelToDistort.caption.anchor, scaleX, scaleY);
          }
          return distorted;
        }
        model2.distort = distort;
        function convertUnits(modeltoConvert, destUnitType) {
          if (modeltoConvert.units && MakerJs2.units.isValidUnit(modeltoConvert.units) && MakerJs2.units.isValidUnit(destUnitType)) {
            var ratio = MakerJs2.units.conversionScale(modeltoConvert.units, destUnitType);
            if (ratio != 1) {
              scale(modeltoConvert, ratio);
              modeltoConvert.units = destUnitType;
            }
          }
          return modeltoConvert;
        }
        model2.convertUnits = convertUnits;
        function walkPaths(modelContext, callback) {
          if (modelContext.paths) {
            for (var pathId in modelContext.paths) {
              if (!modelContext.paths[pathId])
                continue;
              callback(modelContext, pathId, modelContext.paths[pathId]);
            }
          }
          if (modelContext.models) {
            for (var id in modelContext.models) {
              if (!modelContext.models[id])
                continue;
              walkPaths(modelContext.models[id], callback);
            }
          }
        }
        model2.walkPaths = walkPaths;
        function walk(modelContext, options) {
          if (!modelContext)
            return;
          function walkRecursive(modelContext2, layer2, offset, route, routeKey) {
            var newOffset = MakerJs2.point.add(modelContext2.origin, offset);
            layer2 = layer2 != void 0 ? layer2 : "";
            if (modelContext2.paths) {
              for (var pathId in modelContext2.paths) {
                var pathContext = modelContext2.paths[pathId];
                if (!pathContext)
                  continue;
                var walkedPath = {
                  modelContext: modelContext2,
                  layer: pathContext.layer != void 0 ? pathContext.layer : layer2,
                  offset: newOffset,
                  pathContext,
                  pathId,
                  route: route.concat(["paths", pathId]),
                  routeKey: routeKey + (routeKey ? "." : "") + "paths" + JSON.stringify([pathId])
                };
                if (options.onPath)
                  options.onPath(walkedPath);
              }
            }
            if (modelContext2.models) {
              for (var modelId in modelContext2.models) {
                var childModel = modelContext2.models[modelId];
                if (!childModel)
                  continue;
                var walkedModel = {
                  parentModel: modelContext2,
                  layer: childModel.layer != void 0 ? childModel.layer : layer2,
                  offset: newOffset,
                  route: route.concat(["models", modelId]),
                  routeKey: routeKey + (routeKey ? "." : "") + "models" + JSON.stringify([modelId]),
                  childId: modelId,
                  childModel
                };
                if (options.beforeChildWalk) {
                  if (!options.beforeChildWalk(walkedModel))
                    continue;
                }
                walkRecursive(walkedModel.childModel, walkedModel.layer, newOffset, walkedModel.route, walkedModel.routeKey);
                if (options.afterChildWalk) {
                  options.afterChildWalk(walkedModel);
                }
              }
            }
          }
          walkRecursive(modelContext, modelContext.layer, [0, 0], [], "");
          return modelContext;
        }
        model2.walk = walk;
        function zero(modelToZero, zeroX, zeroY) {
          if (zeroX === void 0) {
            zeroX = true;
          }
          if (zeroY === void 0) {
            zeroY = true;
          }
          var m2 = MakerJs2.measure.modelExtents(modelToZero);
          var z2 = modelToZero.origin || [0, 0];
          if (zeroX)
            z2[0] -= m2.low[0];
          if (zeroY)
            z2[1] -= m2.low[1];
          modelToZero.origin = z2;
          return modelToZero;
        }
        model2.zero = zero;
      })(model = MakerJs2.model || (MakerJs2.model = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var model;
      (function(model2) {
        function getNonZeroSegments(pathToSegment, breakPoint) {
          var segment1 = MakerJs2.cloneObject(pathToSegment);
          if (!segment1)
            return null;
          var segment2 = MakerJs2.path.breakAtPoint(segment1, breakPoint);
          if (segment2) {
            var segments = [segment1, segment2];
            for (var i = 2; i--; ) {
              if (MakerJs2.round(MakerJs2.measure.pathLength(segments[i]), 1e-4) == 0) {
                return null;
              }
            }
            return segments;
          } else if (pathToSegment.type == MakerJs2.pathType.Circle) {
            return [segment1];
          }
          return null;
        }
        function getPointsOnPath(points, onPath, popOptions) {
          var endpointsOnPath = [];
          points.forEach(function(p2) {
            if (MakerJs2.measure.isPointOnPath(p2, onPath, 1e-5, null, popOptions)) {
              endpointsOnPath.push(p2);
            }
          });
          return endpointsOnPath;
        }
        function breakAlongForeignPath(crossedPath, overlappedSegments, foreignWalkedPath) {
          var foreignPath = foreignWalkedPath.pathContext;
          var segments = crossedPath.segments;
          if (MakerJs2.measure.isPathEqual(segments[0].absolutePath, foreignPath, 1e-4, null, foreignWalkedPath.offset)) {
            segments[0].overlapped = true;
            segments[0].duplicate = true;
            overlappedSegments.push(segments[0]);
            return;
          }
          var popOptions = {};
          var options = { path1Offset: crossedPath.offset, path2Offset: foreignWalkedPath.offset };
          var foreignIntersection = MakerJs2.path.intersection(crossedPath.pathContext, foreignPath, options);
          var intersectionPoints = foreignIntersection ? foreignIntersection.intersectionPoints : null;
          var foreignPathEndPoints = MakerJs2.point.fromPathEnds(foreignPath, foreignWalkedPath.offset) || [];
          for (var i = 0; i < segments.length; i++) {
            var pointsOfInterest = intersectionPoints ? foreignPathEndPoints.concat(intersectionPoints) : foreignPathEndPoints;
            var pointsToCheck = getPointsOnPath(pointsOfInterest, segments[i].absolutePath, popOptions);
            if (options.out_AreOverlapped) {
              segments[i].overlapped = true;
              overlappedSegments.push(segments[i]);
            }
            if (pointsToCheck.length > 0) {
              var subSegments = null;
              var p2 = 0;
              while (!subSegments && p2 < pointsToCheck.length) {
                subSegments = getNonZeroSegments(segments[i].absolutePath, pointsToCheck[p2]);
                p2++;
              }
              if (subSegments) {
                crossedPath.broken = true;
                segments[i].absolutePath = subSegments[0];
                if (subSegments[1]) {
                  var newSegment = {
                    absolutePath: subSegments[1],
                    pathId: segments[0].pathId,
                    overlapped: segments[i].overlapped,
                    uniqueForeignIntersectionPoints: []
                  };
                  if (segments[i].overlapped) {
                    overlappedSegments.push(newSegment);
                  }
                  segments.push(newSegment);
                }
                i--;
              }
            }
          }
        }
        function isPathInsideModel(pathContext, modelContext, pathOffset, farPoint, measureAtlas) {
          var options = {
            farPoint,
            measureAtlas
          };
          var p2 = MakerJs2.point.add(MakerJs2.point.middle(pathContext), pathOffset);
          return MakerJs2.measure.isPointInsideModel(p2, modelContext, options);
        }
        model2.isPathInsideModel = isPathInsideModel;
        function breakPathsAtIntersections(modelToBreak, modelToIntersect) {
          var modelToBreakAtlas = new MakerJs2.measure.Atlas(modelToBreak);
          modelToBreakAtlas.measureModels();
          var modelToIntersectAtlas;
          if (!modelToIntersect) {
            modelToIntersect = modelToBreak;
            modelToIntersectAtlas = modelToBreakAtlas;
          } else {
            modelToIntersectAtlas = new MakerJs2.measure.Atlas(modelToIntersect);
            modelToIntersectAtlas.measureModels();
          }
          ;
          breakAllPathsAtIntersections(modelToBreak, modelToIntersect || modelToBreak, false, modelToBreakAtlas, modelToIntersectAtlas);
          return modelToBreak;
        }
        model2.breakPathsAtIntersections = breakPathsAtIntersections;
        function breakAllPathsAtIntersections(modelToBreak, modelToIntersect, checkIsInside, modelToBreakAtlas, modelToIntersectAtlas, farPoint) {
          var crossedPaths = [];
          var overlappedSegments = [];
          var walkModelToBreakOptions = {
            onPath: function(outerWalkedPath) {
              var segment = {
                absolutePath: MakerJs2.path.clone(outerWalkedPath.pathContext, outerWalkedPath.offset),
                pathId: outerWalkedPath.pathId,
                overlapped: false,
                uniqueForeignIntersectionPoints: []
              };
              var thisPath = outerWalkedPath;
              thisPath.broken = false;
              thisPath.segments = [segment];
              var walkModelToIntersectOptions = {
                onPath: function(innerWalkedPath) {
                  if (outerWalkedPath.pathContext !== innerWalkedPath.pathContext && MakerJs2.measure.isMeasurementOverlapping(modelToBreakAtlas.pathMap[outerWalkedPath.routeKey], modelToIntersectAtlas.pathMap[innerWalkedPath.routeKey])) {
                    breakAlongForeignPath(thisPath, overlappedSegments, innerWalkedPath);
                  }
                },
                beforeChildWalk: function(innerWalkedModel) {
                  var innerModelMeasurement = modelToIntersectAtlas.modelMap[innerWalkedModel.routeKey];
                  return innerModelMeasurement && MakerJs2.measure.isMeasurementOverlapping(modelToBreakAtlas.pathMap[outerWalkedPath.routeKey], innerModelMeasurement);
                }
              };
              model2.walk(modelToIntersect, walkModelToIntersectOptions);
              if (checkIsInside) {
                for (var i = 0; i < thisPath.segments.length; i++) {
                  var p2 = MakerJs2.point.middle(thisPath.segments[i].absolutePath);
                  var pointInsideOptions = { measureAtlas: modelToIntersectAtlas, farPoint };
                  thisPath.segments[i].isInside = MakerJs2.measure.isPointInsideModel(p2, modelToIntersect, pointInsideOptions);
                  thisPath.segments[i].uniqueForeignIntersectionPoints = pointInsideOptions.out_intersectionPoints;
                }
              }
              crossedPaths.push(thisPath);
            }
          };
          model2.walk(modelToBreak, walkModelToBreakOptions);
          return { crossedPaths, overlappedSegments };
        }
        function checkForEqualOverlaps(crossedPathsA, crossedPathsB, pointMatchingDistance) {
          function compareSegments(segment1, segment2) {
            if (MakerJs2.measure.isPathEqual(segment1.absolutePath, segment2.absolutePath, pointMatchingDistance)) {
              segment1.duplicate = segment2.duplicate = true;
            }
          }
          function compareAll(segment) {
            for (var i2 = 0; i2 < crossedPathsB.length; i2++) {
              compareSegments(crossedPathsB[i2], segment);
            }
          }
          for (var i = 0; i < crossedPathsA.length; i++) {
            compareAll(crossedPathsA[i]);
          }
        }
        function addOrDeleteSegments(crossedPath, includeInside, includeOutside, keepDuplicates, atlas, trackDeleted) {
          function addSegment(modelContext, pathIdBase, segment) {
            var id = model2.getSimilarPathId(modelContext, pathIdBase);
            var newRouteKey = id == pathIdBase ? crossedPath.routeKey : MakerJs2.createRouteKey(crossedPath.route.slice(0, -1).concat([id]));
            segment.addedPath = MakerJs2.cloneObject(crossedPath.pathContext);
            segment.addedPath.type = segment.absolutePath.type;
            MakerJs2.path.copyProps(segment.absolutePath, segment.addedPath);
            MakerJs2.path.moveRelative(segment.addedPath, crossedPath.offset, true);
            modelContext.paths[id] = segment.addedPath;
            if (crossedPath.broken) {
              var measurement = MakerJs2.measure.pathExtents(segment.absolutePath);
              atlas.pathMap[newRouteKey] = measurement;
              atlas.modelsMeasured = false;
            } else {
              atlas.pathMap[newRouteKey] = savedMeasurement;
            }
          }
          function checkAddSegment(modelContext, pathIdBase, segment) {
            if (segment.isInside && includeInside || !segment.isInside && includeOutside) {
              addSegment(modelContext, pathIdBase, segment);
            } else {
              atlas.modelsMeasured = false;
              trackDeleted(segment.absolutePath, crossedPath.routeKey, "segment is " + (segment.isInside ? "inside" : "outside") + " intersectionPoints=" + JSON.stringify(segment.uniqueForeignIntersectionPoints));
            }
          }
          var savedMeasurement = atlas.pathMap[crossedPath.routeKey];
          delete crossedPath.modelContext.paths[crossedPath.pathId];
          delete atlas.pathMap[crossedPath.routeKey];
          for (var i = 0; i < crossedPath.segments.length; i++) {
            if (crossedPath.segments[i].duplicate) {
              if (keepDuplicates) {
                addSegment(crossedPath.modelContext, crossedPath.pathId, crossedPath.segments[i]);
              } else {
                trackDeleted(crossedPath.segments[i].absolutePath, crossedPath.routeKey, "segment is duplicate");
              }
            } else {
              checkAddSegment(crossedPath.modelContext, crossedPath.pathId, crossedPath.segments[i]);
            }
          }
        }
        function combine(modelA, modelB, includeAInsideB, includeAOutsideB, includeBInsideA, includeBOutsideA, options) {
          if (includeAInsideB === void 0) {
            includeAInsideB = false;
          }
          if (includeAOutsideB === void 0) {
            includeAOutsideB = true;
          }
          if (includeBInsideA === void 0) {
            includeBInsideA = false;
          }
          if (includeBOutsideA === void 0) {
            includeBOutsideA = true;
          }
          var opts = {
            trimDeadEnds: true,
            pointMatchingDistance: 5e-3,
            out_deleted: [{ paths: {} }, { paths: {} }]
          };
          MakerJs2.extendObject(opts, options);
          opts.measureA = opts.measureA || new MakerJs2.measure.Atlas(modelA);
          opts.measureB = opts.measureB || new MakerJs2.measure.Atlas(modelB);
          opts.measureA.measureModels();
          opts.measureB.measureModels();
          if (!opts.farPoint) {
            var measureBoth = MakerJs2.measure.increase(MakerJs2.measure.increase({ high: [null, null], low: [null, null] }, opts.measureA.modelMap[""]), opts.measureB.modelMap[""]);
            opts.farPoint = MakerJs2.point.add(measureBoth.high, [1, 1]);
          }
          var pathsA = breakAllPathsAtIntersections(modelA, modelB, true, opts.measureA, opts.measureB, opts.farPoint);
          var pathsB = breakAllPathsAtIntersections(modelB, modelA, true, opts.measureB, opts.measureA, opts.farPoint);
          checkForEqualOverlaps(pathsA.overlappedSegments, pathsB.overlappedSegments, opts.pointMatchingDistance);
          function trackDeleted(which, deletedPath, routeKey, reason) {
            model2.addPath(opts.out_deleted[which], deletedPath, "deleted");
            var p2 = deletedPath;
            p2.reason = reason;
            p2.routeKey = routeKey;
          }
          for (var i = 0; i < pathsA.crossedPaths.length; i++) {
            addOrDeleteSegments(pathsA.crossedPaths[i], includeAInsideB, includeAOutsideB, true, opts.measureA, function(p2, id, reason) {
              return trackDeleted(0, p2, id, reason);
            });
          }
          for (var i = 0; i < pathsB.crossedPaths.length; i++) {
            addOrDeleteSegments(pathsB.crossedPaths[i], includeBInsideA, includeBOutsideA, false, opts.measureB, function(p2, id, reason) {
              return trackDeleted(1, p2, id, reason);
            });
          }
          var result = { models: { a: modelA, b: modelB } };
          if (opts.trimDeadEnds) {
            var shouldKeep;
            if (!includeAInsideB && !includeBInsideA) {
              shouldKeep = function(walkedPath) {
                for (var i2 = 0; i2 < pathsA.overlappedSegments.length; i2++) {
                  if (pathsA.overlappedSegments[i2].duplicate && walkedPath.pathContext === pathsA.overlappedSegments[i2].addedPath) {
                    return false;
                  }
                }
                return true;
              };
            }
            model2.removeDeadEnds(result, null, shouldKeep, function(wp, reason) {
              var which = wp.route[1] === "a" ? 0 : 1;
              trackDeleted(which, wp.pathContext, wp.routeKey, reason);
            });
          }
          MakerJs2.extendObject(options, opts);
          return result;
        }
        model2.combine = combine;
        function combineIntersection(modelA, modelB) {
          return combine(modelA, modelB, true, false, true, false);
        }
        model2.combineIntersection = combineIntersection;
        function combineSubtraction(modelA, modelB) {
          return combine(modelA, modelB, false, true, true, false);
        }
        model2.combineSubtraction = combineSubtraction;
        function combineUnion(modelA, modelB) {
          return combine(modelA, modelB, false, true, false, true);
        }
        model2.combineUnion = combineUnion;
      })(model = MakerJs2.model || (MakerJs2.model = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var Collector = (
        /** @class */
        (function() {
          function Collector2(comparer) {
            this.comparer = comparer;
            this.collections = [];
          }
          Collector2.prototype.addItemToCollection = function(key, item) {
            var found = this.findCollection(key);
            if (found) {
              found.push(item);
            } else {
              var collection = { key, items: [item] };
              this.collections.push(collection);
            }
          };
          Collector2.prototype.findCollection = function(key, action) {
            for (var i = 0; i < this.collections.length; i++) {
              var collection = this.collections[i];
              if (this.comparer(key, collection.key)) {
                if (action) {
                  action(i);
                }
                return collection.items;
              }
            }
            return null;
          };
          Collector2.prototype.removeCollection = function(key) {
            var _this = this;
            if (this.findCollection(key, function(index) {
              _this.collections.splice(index, 1);
            })) {
              return true;
            }
            return false;
          };
          Collector2.prototype.removeItemFromCollection = function(key, item) {
            var collection = this.findCollection(key);
            if (!collection)
              return;
            for (var i = 0; i < collection.length; i++) {
              if (collection[i] === item) {
                collection.splice(i, 1);
                return true;
              }
            }
            return false;
          };
          Collector2.prototype.getCollectionsOfMultiple = function(cb) {
            for (var i = 0; i < this.collections.length; i++) {
              var collection = this.collections[i];
              if (collection.items.length > 1) {
                cb(collection.key, collection.items);
              }
            }
          };
          return Collector2;
        })()
      );
      MakerJs2.Collector = Collector;
      var _kdbush = require_kdbush();
      var kdbush = _kdbush["default"] || _kdbush;
      var PointGraph = (
        /** @class */
        (function() {
          function PointGraph2() {
            this.reset();
          }
          PointGraph2.prototype.reset = function() {
            this.insertedCount = 0;
            this.graph = {};
            this.index = {};
            this.merged = {};
            this.values = [];
          };
          PointGraph2.prototype.insertValue = function(value) {
            this.values.push(value);
            return this.values.length - 1;
          };
          PointGraph2.prototype.insertValueIdAtPoint = function(valueId, p2) {
            var x2 = p2[0], y2 = p2[1];
            if (!this.graph[x2]) {
              this.graph[x2] = {};
            }
            var pgx = this.graph[x2];
            var existed = y2 in pgx;
            var el;
            var pointId;
            if (!existed) {
              pgx[y2] = pointId = this.insertedCount++;
              el = {
                pointId,
                point: p2,
                valueIds: [valueId]
              };
              this.index[pointId] = el;
            } else {
              pointId = pgx[y2];
              if (pointId in this.merged) {
                pointId = this.merged[pointId];
              }
              el = this.index[pointId];
              el.valueIds.push(valueId);
            }
            return { existed, pointId };
          };
          PointGraph2.prototype.mergePoints = function(withinDistance) {
            var _this = this;
            var points = [];
            var kEls = [];
            for (var pointId in this.index) {
              var el = this.index[pointId];
              var p2 = el.point;
              el.kdId = points.length;
              points.push(p2);
              kEls.push(el);
            }
            this.kdbush = kdbush(points);
            var _loop_2 = function(pointId2) {
              if (pointId2 in this_1.merged)
                return "continue";
              var el2 = this_1.index[pointId2];
              var mergeIds = this_1.kdbush.within(el2.point[0], el2.point[1], withinDistance);
              mergeIds.forEach(function(kdId) {
                if (kdId === el2.kdId)
                  return;
                _this.mergeIndexElements(el2, kEls[kdId]);
              });
            };
            var this_1 = this;
            for (var pointId in this.index) {
              _loop_2(pointId);
            }
          };
          PointGraph2.prototype.mergeNearestSinglePoints = function(withinDistance) {
            var _this = this;
            var singles = [];
            for (var pointId in this.index) {
              var el = this.index[pointId];
              if (el.valueIds.length === 1) {
                singles.push(el);
              }
            }
            this.kdbush = kdbush(singles.map(function(el2) {
              return el2.point;
            }));
            singles.forEach(function(el2) {
              if (el2.pointId in _this.merged)
                return;
              var mergeIds = _this.kdbush.within(el2.point[0], el2.point[1], withinDistance);
              var byDistance = [];
              mergeIds.forEach(function(i2) {
                var other2 = singles[i2];
                if (other2.pointId === el2.pointId)
                  return;
                byDistance.push({ el: other2, distance: MakerJs2.measure.pointDistance(other2.point, el2.point) });
              });
              byDistance.sort(function(a2, b2) {
                return a2.distance - b2.distance;
              });
              for (var i = 0; i < byDistance.length; i++) {
                var other = byDistance[i].el;
                if (other.pointId in _this.merged)
                  continue;
                if (other.merged && other.merged.length > 0) {
                  _this.mergeIndexElements(other, el2);
                } else {
                  _this.mergeIndexElements(el2, other);
                }
                return;
              }
            });
          };
          PointGraph2.prototype.mergeIndexElements = function(keep, remove) {
            keep.merged = keep.merged || [];
            keep.merged.push(remove.pointId);
            this.merged[remove.pointId] = keep.pointId;
            keep.valueIds.push.apply(keep.valueIds, remove.valueIds);
            delete this.index[remove.pointId];
            return keep.pointId;
          };
          PointGraph2.prototype.forEachPoint = function(cb) {
            var _this = this;
            for (var pointId = 0; pointId < this.insertedCount; pointId++) {
              var el = this.index[pointId];
              if (!el)
                continue;
              var length_1 = el.valueIds.length;
              if (length_1 > 0) {
                cb(el.point, el.valueIds.map(function(i) {
                  return _this.values[i];
                }), pointId, el);
              }
            }
          };
          PointGraph2.prototype.getIdOfPoint = function(p2) {
            var px = this.graph[p2[0]];
            if (px) {
              var pointId = px[p2[1]];
              if (pointId >= 0) {
                if (pointId in this.merged) {
                  return this.merged[pointId];
                } else {
                  return pointId;
                }
              }
            }
          };
          PointGraph2.prototype.getElementAtPoint = function(p2) {
            var pointId = this.getIdOfPoint(p2);
            if (pointId >= 0) {
              return this.index[pointId];
            }
          };
          return PointGraph2;
        })()
      );
      MakerJs2.PointGraph = PointGraph;
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var model;
      (function(model2) {
        function checkForOverlaps(refPaths, isOverlapping, overlapUnion) {
          var currIndex = 0;
          do {
            var root = refPaths[currIndex];
            do {
              var overlaps = false;
              for (var i = currIndex + 1; i < refPaths.length; i++) {
                var arcRef = refPaths[i];
                overlaps = isOverlapping(root.pathContext, arcRef.pathContext, false);
                if (overlaps) {
                  overlapUnion(root.pathContext, arcRef.pathContext);
                  delete arcRef.modelContext.paths[arcRef.pathId];
                  refPaths.splice(i, 1);
                  break;
                }
              }
            } while (overlaps);
            currIndex++;
          } while (currIndex < refPaths.length);
        }
        function simplify(modelToSimplify, options) {
          function compareCircles(circleA, circleB) {
            if (Math.abs(circleA.radius - circleB.radius) <= opts.scalarMatchingDistance) {
              var distance = MakerJs2.measure.pointDistance(circleA.origin, circleB.origin);
              return distance <= opts.pointMatchingDistance;
            }
            return false;
          }
          var similarArcs = new MakerJs2.Collector(compareCircles);
          var similarCircles = new MakerJs2.Collector(compareCircles);
          var similarLines = new MakerJs2.Collector(MakerJs2.measure.isSlopeEqual);
          var map = {};
          map[MakerJs2.pathType.Arc] = function(arcRef) {
            similarArcs.addItemToCollection(arcRef.pathContext, arcRef);
          };
          map[MakerJs2.pathType.Circle] = function(circleRef) {
            similarCircles.addItemToCollection(circleRef.pathContext, circleRef);
          };
          map[MakerJs2.pathType.Line] = function(lineRef) {
            var slope = MakerJs2.measure.lineSlope(lineRef.pathContext);
            similarLines.addItemToCollection(slope, lineRef);
          };
          var opts = {
            scalarMatchingDistance: 1e-3,
            pointMatchingDistance: 5e-3
          };
          MakerJs2.extendObject(opts, options);
          var walkOptions = {
            onPath: function(walkedPath) {
              var fn = map[walkedPath.pathContext.type];
              if (fn) {
                fn(walkedPath);
              }
            }
          };
          model2.walk(modelToSimplify, walkOptions);
          similarArcs.getCollectionsOfMultiple(function(key, arcRefs) {
            checkForOverlaps(arcRefs, MakerJs2.measure.isArcOverlapping, function(arcA, arcB) {
              var aEndsInB = MakerJs2.measure.isBetweenArcAngles(arcA.endAngle, arcB, false);
              var bEndsInA = MakerJs2.measure.isBetweenArcAngles(arcB.endAngle, arcA, false);
              if (aEndsInB && bEndsInA) {
                arcA.endAngle = arcA.startAngle + 360;
                return;
              }
              var ordered = aEndsInB ? [arcA, arcB] : [arcB, arcA];
              arcA.startAngle = MakerJs2.angle.noRevolutions(ordered[0].startAngle);
              arcA.endAngle = ordered[1].endAngle;
            });
          });
          similarCircles.getCollectionsOfMultiple(function(key, circleRefs) {
            for (var i = 1; i < circleRefs.length; i++) {
              var circleRef = circleRefs[i];
              delete circleRef.modelContext.paths[circleRef.pathId];
            }
          });
          similarLines.getCollectionsOfMultiple(function(slope, arcRefs) {
            checkForOverlaps(arcRefs, MakerJs2.measure.isLineOverlapping, function(lineA, lineB) {
              var box = { paths: { lineA, lineB } };
              var m2 = MakerJs2.measure.modelExtents(box);
              if (!slope.hasSlope) {
                lineA.origin[1] = m2.low[1];
                lineA.end[1] = m2.high[1];
              } else {
                if (slope.slope < 0) {
                  lineA.origin = [m2.low[0], m2.high[1]];
                  lineA.end = [m2.high[0], m2.low[1]];
                } else if (slope.slope > 0) {
                  lineA.origin = m2.low;
                  lineA.end = m2.high;
                } else {
                  lineA.origin[0] = m2.low[0];
                  lineA.end[0] = m2.high[0];
                }
              }
            });
          });
          return modelToSimplify;
        }
        model2.simplify = simplify;
      })(model = MakerJs2.model || (MakerJs2.model = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var path;
      (function(path2) {
        var map = {};
        map[MakerJs2.pathType.Arc] = function(arc, expansion, isolateCaps) {
          return new MakerJs2.models.OvalArc(arc.startAngle, arc.endAngle, arc.radius, expansion, false, isolateCaps);
        };
        map[MakerJs2.pathType.Circle] = function(circle2, expansion, isolateCaps) {
          return new MakerJs2.models.Ring(circle2.radius + expansion, circle2.radius - expansion);
        };
        map[MakerJs2.pathType.Line] = function(line2, expansion, isolateCaps) {
          return new MakerJs2.models.Slot(line2.origin, line2.end, expansion, isolateCaps);
        };
        function expand(pathToExpand, expansion, isolateCaps) {
          if (!pathToExpand)
            return null;
          var result = null;
          var fn = map[pathToExpand.type];
          if (fn) {
            result = fn(pathToExpand, expansion, isolateCaps);
            result.origin = pathToExpand.origin;
          }
          return result;
        }
        path2.expand = expand;
        function straighten(arc, bevel, prefix, close) {
          var arcSpan = MakerJs2.angle.ofArcSpan(arc);
          var joints = 1;
          if (arcSpan >= 270) {
            joints = 4;
          } else if (arcSpan > 180) {
            joints = 3;
          } else if (arcSpan > 150 || bevel) {
            joints = 2;
          }
          var jointAngleInRadians = MakerJs2.angle.toRadians(arcSpan / joints);
          var circumscribedRadius = MakerJs2.models.Polygon.circumscribedRadius(arc.radius, jointAngleInRadians);
          var ends = MakerJs2.point.fromArc(arc);
          var points = [MakerJs2.point.subtract(ends[0], arc.origin)];
          var a2 = MakerJs2.angle.toRadians(arc.startAngle) + jointAngleInRadians / 2;
          for (var i = 0; i < joints; i++) {
            points.push(MakerJs2.point.fromPolar(a2, circumscribedRadius));
            a2 += jointAngleInRadians;
          }
          points.push(MakerJs2.point.subtract(ends[1], arc.origin));
          var result = new MakerJs2.models.ConnectTheDots(close, points);
          result.origin = arc.origin;
          if (typeof prefix === "string" && prefix.length) {
            MakerJs2.model.prefixPathIds(result, prefix);
          }
          return result;
        }
        path2.straighten = straighten;
      })(path = MakerJs2.path || (MakerJs2.path = {}));
    })(MakerJs || (MakerJs = {}));
    (function(MakerJs2) {
      var model;
      (function(model2) {
        function expandPaths(modelToExpand, distance, joints, combineOptions) {
          if (joints === void 0) {
            joints = 0;
          }
          if (combineOptions === void 0) {
            combineOptions = {};
          }
          if (distance <= 0)
            return null;
          var result = {
            models: {
              expansions: { models: {} },
              caps: { models: {} }
            }
          };
          var first = true;
          var lastFarPoint = combineOptions.farPoint;
          var walkOptions = {
            onPath: function(walkedPath) {
              if (combineOptions.pointMatchingDistance && MakerJs2.measure.pathLength(walkedPath.pathContext) < combineOptions.pointMatchingDistance)
                return;
              var expandedPathModel = MakerJs2.path.expand(walkedPath.pathContext, distance, true);
              if (expandedPathModel) {
                model2.moveRelative(expandedPathModel, walkedPath.offset);
                var newId = model2.getSimilarModelId(result.models["expansions"], walkedPath.pathId);
                model2.prefixPathIds(expandedPathModel, walkedPath.pathId + "_");
                model2.originate(expandedPathModel);
                if (!first) {
                  model2.combine(result, expandedPathModel, false, true, false, true, combineOptions);
                  combineOptions.measureA.modelsMeasured = false;
                  lastFarPoint = combineOptions.farPoint;
                  delete combineOptions.farPoint;
                  delete combineOptions.measureB;
                }
                result.models["expansions"].models[newId] = expandedPathModel;
                if (expandedPathModel.models) {
                  var caps = expandedPathModel.models["Caps"];
                  if (caps) {
                    delete expandedPathModel.models["Caps"];
                    result.models["caps"].models[newId] = caps;
                  }
                }
                first = false;
              }
            }
          };
          model2.walk(modelToExpand, walkOptions);
          if (joints) {
            var roundCaps = result.models["caps"];
            var straightCaps = { models: {} };
            result.models["straightcaps"] = straightCaps;
            model2.simplify(roundCaps);
            for (var id in roundCaps.models) {
              straightCaps.models[id] = { models: {} };
              model2.walk(roundCaps.models[id], {
                onPath: function(walkedPath) {
                  var arc = walkedPath.pathContext;
                  var straightened = MakerJs2.path.straighten(arc, joints == 2, walkedPath.pathId + "_", true);
                  model2.combine(result, straightened, false, true, false, true, combineOptions);
                  combineOptions.measureA.modelsMeasured = false;
                  lastFarPoint = combineOptions.farPoint;
                  delete combineOptions.farPoint;
                  delete combineOptions.measureB;
                  straightCaps.models[id].models[walkedPath.pathId] = straightened;
                  delete walkedPath.modelContext.paths[walkedPath.pathId];
                }
              });
            }
            delete result.models["caps"];
          }
          combineOptions.farPoint = lastFarPoint;
          return result;
        }
        model2.expandPaths = expandPaths;
        function getEndlessChains(modelContext) {
          var endlessChains = [];
          model2.findChains(modelContext, function(chains, loose, layer) {
            endlessChains = chains.filter(function(chain) {
              return chain.endless;
            });
          });
          return endlessChains;
        }
        function getClosedGeometries(modelContext) {
          var endlessChains = getEndlessChains(modelContext);
          if (endlessChains.length == 0)
            return null;
          var closed = { models: {} };
          endlessChains.forEach(function(c2, i) {
            closed.models[i] = MakerJs2.chain.toNewModel(c2);
          });
          return closed;
        }
        function outline(modelToOutline, distance, joints, inside, options) {
          if (joints === void 0) {
            joints = 0;
          }
          if (inside === void 0) {
            inside = false;
          }
          if (options === void 0) {
            options = {};
          }
          var expanded = expandPaths(modelToOutline, distance, joints, options);
          if (!expanded)
            return null;
          var closed = getClosedGeometries(modelToOutline);
          if (closed) {
            var childCount = 0;
            var result = { models: {} };
            var chains = getEndlessChains(expanded);
            chains.forEach(function(c2) {
              var wp = c2.links[0].walkedPath;
              var isInside = MakerJs2.measure.isPointInsideModel(MakerJs2.point.middle(wp.pathContext), closed, wp.offset);
              if (inside && isInside || !inside && !isInside) {
                result.models[childCount++] = MakerJs2.chain.toNewModel(c2);
              }
              ;
            });
            return result;
          } else {
            return expanded;
          }
        }
        model2.outline = outline;
      })(model = MakerJs2.model || (MakerJs2.model = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var units;
      (function(units2) {
        var base = MakerJs2.unitType.Millimeter;
        function init() {
          addBaseConversion(MakerJs2.unitType.Centimeter, 10);
          addBaseConversion(MakerJs2.unitType.Meter, 1e3);
          addBaseConversion(MakerJs2.unitType.Inch, 25.4);
          addBaseConversion(MakerJs2.unitType.Foot, 25.4 * 12);
        }
        var table;
        function addConversion(srcUnitType, destUnitType, value) {
          function row(unitType) {
            if (!table[unitType]) {
              table[unitType] = {};
            }
            return table[unitType];
          }
          row(srcUnitType)[destUnitType] = value;
          row(destUnitType)[srcUnitType] = 1 / value;
        }
        function addBaseConversion(destUnitType, value) {
          addConversion(destUnitType, base, value);
        }
        function conversionScale(srcUnitType, destUnitType) {
          if (srcUnitType == destUnitType) {
            return 1;
          }
          if (!table) {
            table = {};
            init();
          }
          if (!table[srcUnitType][destUnitType]) {
            addConversion(srcUnitType, destUnitType, table[srcUnitType][base] * table[base][destUnitType]);
          }
          return table[srcUnitType] && table[srcUnitType][destUnitType];
        }
        units2.conversionScale = conversionScale;
        function isValidUnit(tryUnit) {
          for (var id in MakerJs2.unitType) {
            if (MakerJs2.unitType[id] == tryUnit) {
              return true;
            }
          }
          return false;
        }
        units2.isValidUnit = isValidUnit;
      })(units = MakerJs2.units || (MakerJs2.units = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var measure;
      (function(measure2) {
        function isAngleEqual(angleA, angleB, accuracy) {
          if (accuracy === void 0) {
            accuracy = 1e-4;
          }
          var a2 = MakerJs2.angle.noRevolutions(angleA);
          var b2 = MakerJs2.angle.noRevolutions(angleB);
          var d2 = MakerJs2.angle.noRevolutions(MakerJs2.round(b2 - a2, accuracy));
          return d2 == 0;
        }
        measure2.isAngleEqual = isAngleEqual;
        var pathAreEqualMap = {};
        pathAreEqualMap[MakerJs2.pathType.Line] = function(lineA, lineB, withinPointDistance) {
          return isPointEqual(lineA.origin, lineB.origin, withinPointDistance) && isPointEqual(lineA.end, lineB.end, withinPointDistance) || isPointEqual(lineA.origin, lineB.end, withinPointDistance) && isPointEqual(lineA.end, lineB.origin, withinPointDistance);
        };
        pathAreEqualMap[MakerJs2.pathType.Circle] = function(circleA, circleB, withinPointDistance) {
          return isPointEqual(circleA.origin, circleB.origin, withinPointDistance) && circleA.radius == circleB.radius;
        };
        pathAreEqualMap[MakerJs2.pathType.Arc] = function(arcA, arcB, withinPointDistance) {
          return pathAreEqualMap[MakerJs2.pathType.Circle](arcA, arcB, withinPointDistance) && isAngleEqual(arcA.startAngle, arcB.startAngle) && isAngleEqual(arcA.endAngle, arcB.endAngle);
        };
        function isPathEqual(pathA, pathB, withinPointDistance, pathAOffset, pathBOffset) {
          var result = false;
          if (pathA.type == pathB.type) {
            var fn = pathAreEqualMap[pathA.type];
            if (fn) {
              let getResult2 = function() {
                result = fn(pathA, pathB, withinPointDistance);
              };
              var getResult = getResult2;
              if (pathAOffset || pathBOffset) {
                MakerJs2.path.moveTemporary([pathA, pathB], [pathAOffset, pathBOffset], getResult2);
              } else {
                getResult2();
              }
            }
          }
          return result;
        }
        measure2.isPathEqual = isPathEqual;
        function isPointEqual(a2, b2, withinDistance) {
          if (!withinDistance) {
            return MakerJs2.round(a2[0] - b2[0]) == 0 && MakerJs2.round(a2[1] - b2[1]) == 0;
          } else {
            if (!a2 || !b2)
              return false;
            var distance = measure2.pointDistance(a2, b2);
            return distance <= withinDistance;
          }
        }
        measure2.isPointEqual = isPointEqual;
        function isPointDistinct(pointToCheck, pointArray, withinDistance) {
          for (var i = 0; i < pointArray.length; i++) {
            if (isPointEqual(pointArray[i], pointToCheck, withinDistance)) {
              return false;
            }
          }
          return true;
        }
        measure2.isPointDistinct = isPointDistinct;
        function isPointOnSlope(p2, slope, withinDistance) {
          if (withinDistance === void 0) {
            withinDistance = 0;
          }
          if (slope.hasSlope) {
            return Math.abs(p2[1] - (slope.slope * p2[0] + slope.yIntercept)) <= withinDistance;
          } else {
            return Math.abs(p2[0] - slope.line.origin[0]) <= withinDistance;
          }
        }
        measure2.isPointOnSlope = isPointOnSlope;
        function isPointOnCircle(p2, circle2, withinDistance) {
          if (withinDistance === void 0) {
            withinDistance = 0;
          }
          var d2 = Math.abs(measure2.pointDistance(p2, circle2.origin) - circle2.radius);
          return d2 <= withinDistance;
        }
        measure2.isPointOnCircle = isPointOnCircle;
        var onPathMap = {};
        onPathMap[MakerJs2.pathType.Circle] = function(p2, circle2, withinDistance) {
          return isPointOnCircle(p2, circle2, withinDistance);
        };
        onPathMap[MakerJs2.pathType.Arc] = function(p2, arc, withinDistance) {
          if (onPathMap[MakerJs2.pathType.Circle](p2, arc, withinDistance)) {
            var a2 = MakerJs2.angle.ofPointInDegrees(arc.origin, p2);
            return measure2.isBetweenArcAngles(a2, arc, false);
          }
          return false;
        };
        onPathMap[MakerJs2.pathType.Line] = function(p2, line2, withinDistance, options) {
          var slope = options && options.cachedLineSlope || measure2.lineSlope(line2);
          if (options && !options.cachedLineSlope) {
            options.cachedLineSlope = slope;
          }
          return isPointOnSlope(p2, slope, withinDistance) && measure2.isBetweenPoints(p2, line2, false);
        };
        function isPointOnPath(pointToCheck, onPath, withinDistance, pathOffset, options) {
          if (withinDistance === void 0) {
            withinDistance = 0;
          }
          var fn = onPathMap[onPath.type];
          if (fn) {
            var offsetPath = pathOffset ? MakerJs2.path.clone(onPath, pathOffset) : onPath;
            return fn(pointToCheck, offsetPath, withinDistance, options);
          }
          return false;
        }
        measure2.isPointOnPath = isPointOnPath;
        function isSlopeEqual(slopeA, slopeB) {
          if (!isSlopeParallel(slopeA, slopeB))
            return false;
          if (!slopeA.hasSlope && !slopeB.hasSlope) {
            return MakerJs2.round(slopeA.line.origin[0] - slopeB.line.origin[0]) == 0;
          }
          var slopes = [slopeA, slopeB];
          var angles = slopes.map(function(s2) {
            return MakerJs2.angle.toDegrees(Math.atan(s2.slope));
          });
          var lines = slopes.map(function(s2) {
            return MakerJs2.path.clone(s2.line);
          });
          var origin = lines[0].origin;
          lines.forEach(function(l2, i) {
            return MakerJs2.path.rotate(l2, -angles[i], origin);
          });
          var averageYs = lines.map(function(l2) {
            return (l2.origin[1] + l2.end[1]) / 2;
          });
          return MakerJs2.round(averageYs[0] - averageYs[1], 1e-5) == 0;
        }
        measure2.isSlopeEqual = isSlopeEqual;
        function isSlopeParallel(slopeA, slopeB) {
          if (!slopeA.hasSlope && !slopeB.hasSlope) {
            return true;
          }
          if (slopeA.hasSlope && slopeB.hasSlope && MakerJs2.round(slopeA.slope - slopeB.slope, 1e-5) == 0) {
            return true;
          }
          return false;
        }
        measure2.isSlopeParallel = isSlopeParallel;
      })(measure = MakerJs2.measure || (MakerJs2.measure = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var measure;
      (function(measure2) {
        function increase(baseMeasure, addMeasure, augmentBaseMeasure) {
          function getExtreme(basePoint, newPoint, fn) {
            if (!newPoint)
              return;
            for (var i = 2; i--; ) {
              if (newPoint[i] == null)
                continue;
              if (basePoint[i] == null) {
                basePoint[i] = newPoint[i];
              } else {
                basePoint[i] = fn(basePoint[i], newPoint[i]);
              }
            }
          }
          if (addMeasure) {
            getExtreme(baseMeasure.low, addMeasure.low, Math.min);
            getExtreme(baseMeasure.high, addMeasure.high, Math.max);
          }
          if (augmentBaseMeasure) {
            augment(baseMeasure);
          }
          return baseMeasure;
        }
        measure2.increase = increase;
        function isArcConcaveTowardsPoint(arc, towardsPoint) {
          if (pointDistance(arc.origin, towardsPoint) <= arc.radius) {
            return true;
          }
          var midPointToNearPoint = new MakerJs2.paths.Line(MakerJs2.point.middle(arc), towardsPoint);
          var options = {};
          var intersectionPoint = MakerJs2.path.intersection(midPointToNearPoint, new MakerJs2.paths.Chord(arc), options);
          if (intersectionPoint || options.out_AreOverlapped) {
            return true;
          }
          return false;
        }
        measure2.isArcConcaveTowardsPoint = isArcConcaveTowardsPoint;
        function isArcOverlapping(arcA, arcB, excludeTangents) {
          return isArcSpanOverlapping(arcA, arcB, excludeTangents);
        }
        measure2.isArcOverlapping = isArcOverlapping;
        function isArcSpanOverlapping(arcA, arcB, excludeTangents) {
          var pointsOfIntersection = [];
          function checkAngles(a2, b2) {
            function checkAngle(n) {
              return isBetweenArcAngles(n, a2, excludeTangents);
            }
            return checkAngle(b2.startAngle) || checkAngle(b2.endAngle);
          }
          return checkAngles(arcA, arcB) || checkAngles(arcB, arcA) || arcA.startAngle == arcB.startAngle && arcA.endAngle == arcB.endAngle;
        }
        measure2.isArcSpanOverlapping = isArcSpanOverlapping;
        function isBetween(valueInQuestion, limitA, limitB, exclusive) {
          if (exclusive) {
            return Math.min(limitA, limitB) < valueInQuestion && valueInQuestion < Math.max(limitA, limitB);
          } else {
            return Math.min(limitA, limitB) <= valueInQuestion && valueInQuestion <= Math.max(limitA, limitB);
          }
        }
        measure2.isBetween = isBetween;
        function isBetweenArcAngles(angleInQuestion, arc, exclusive) {
          var startAngle = MakerJs2.angle.noRevolutions(arc.startAngle);
          var span = MakerJs2.angle.ofArcSpan(arc);
          var endAngle = startAngle + span;
          angleInQuestion = MakerJs2.angle.noRevolutions(angleInQuestion);
          return isBetween(angleInQuestion, startAngle, endAngle, exclusive) || isBetween(angleInQuestion, startAngle + 360, endAngle + 360, exclusive) || isBetween(angleInQuestion, startAngle - 360, endAngle - 360, exclusive);
        }
        measure2.isBetweenArcAngles = isBetweenArcAngles;
        function isBetweenPoints(pointInQuestion, line2, exclusive) {
          var oneDimension = false;
          for (var i = 2; i--; ) {
            if (MakerJs2.round(line2.origin[i] - line2.end[i], 1e-6) == 0) {
              if (oneDimension)
                return false;
              oneDimension = true;
              continue;
            }
            var origin_value = MakerJs2.round(line2.origin[i]);
            var end_value = MakerJs2.round(line2.end[i]);
            if (!isBetween(MakerJs2.round(pointInQuestion[i]), origin_value, end_value, exclusive))
              return false;
          }
          return true;
        }
        measure2.isBetweenPoints = isBetweenPoints;
        function isBezierSeedLinear(seed, exclusive) {
          var slope = lineSlope(seed);
          for (var i = 0; i < seed.controls.length; i++) {
            if (!measure2.isPointOnSlope(seed.controls[i], slope)) {
              if (!exclusive)
                return false;
              if (isBetweenPoints(seed.controls[i], seed, false))
                return false;
            }
          }
          return true;
        }
        measure2.isBezierSeedLinear = isBezierSeedLinear;
        var graham_scan = require_graham_scan_min();
        function serializePoint(p2) {
          return p2.join(",");
        }
        function isChainClockwise(chainContext, out_result) {
          if (!chainContext.endless || chainContext.links.length === 1) {
            return null;
          }
          var keyPoints = MakerJs2.chain.toKeyPoints(chainContext);
          return isPointArrayClockwise(keyPoints, out_result);
        }
        measure2.isChainClockwise = isChainClockwise;
        function isPointArrayClockwise(points, out_result) {
          var convexHull = new graham_scan();
          var pointsInOrder = [];
          function add(endPoint) {
            convexHull.addPoint(endPoint[0], endPoint[1]);
            pointsInOrder.push(serializePoint(endPoint));
          }
          points.forEach(add);
          var hull = convexHull.getHull();
          var hullPoints = hull.slice(0, 3).map(function(p2) {
            return serializePoint([p2.x, p2.y]);
          });
          var ordered = [];
          pointsInOrder.forEach(function(p2) {
            if (~hullPoints.indexOf(p2))
              ordered.push(p2);
          });
          switch (ordered.indexOf(hullPoints[1])) {
            case 0:
              ordered.unshift(ordered.pop());
              break;
            case 2:
              ordered.push(ordered.shift());
              break;
          }
          if (out_result) {
            out_result.hullPoints = hull.map(function(p2) {
              return [p2.x, p2.y];
            });
            out_result.keyPoints = points;
          }
          return hullPoints[0] != ordered[0];
        }
        measure2.isPointArrayClockwise = isPointArrayClockwise;
        function isLineOverlapping(lineA, lineB, excludeTangents) {
          var pointsOfIntersection = [];
          function checkPoints(index, a2, b2) {
            function checkPoint(p2) {
              return isBetweenPoints(p2, a2, excludeTangents);
            }
            return checkPoint(b2.origin) || checkPoint(b2.end);
          }
          return checkPoints(0, lineA, lineB) || checkPoints(1, lineB, lineA);
        }
        measure2.isLineOverlapping = isLineOverlapping;
        function isMeasurementOverlapping(measureA, measureB) {
          for (var i = 2; i--; ) {
            if (!(MakerJs2.round(measureA.low[i] - measureB.high[i]) <= 0 && MakerJs2.round(measureA.high[i] - measureB.low[i]) >= 0))
              return false;
          }
          return true;
        }
        measure2.isMeasurementOverlapping = isMeasurementOverlapping;
        function lineSlope(line2) {
          var dx = line2.end[0] - line2.origin[0];
          if (MakerJs2.round(dx, 1e-6) == 0) {
            return {
              line: line2,
              hasSlope: false
            };
          }
          var dy = line2.end[1] - line2.origin[1];
          var slope = dy / dx;
          var yIntercept = line2.origin[1] - slope * line2.origin[0];
          return {
            line: line2,
            hasSlope: true,
            slope,
            yIntercept
          };
        }
        measure2.lineSlope = lineSlope;
        function pointDistance(a2, b2) {
          var dx = b2[0] - a2[0];
          var dy = b2[1] - a2[1];
          return Math.sqrt(dx * dx + dy * dy);
        }
        measure2.pointDistance = pointDistance;
        function getExtremePoint(a2, b2, fn) {
          return [
            fn(a2[0], b2[0]),
            fn(a2[1], b2[1])
          ];
        }
        var pathExtentsMap = {};
        pathExtentsMap[MakerJs2.pathType.Line] = function(line2) {
          return {
            low: getExtremePoint(line2.origin, line2.end, Math.min),
            high: getExtremePoint(line2.origin, line2.end, Math.max)
          };
        };
        pathExtentsMap[MakerJs2.pathType.Circle] = function(circle2) {
          var r2 = circle2.radius;
          return {
            low: MakerJs2.point.add(circle2.origin, [-r2, -r2]),
            high: MakerJs2.point.add(circle2.origin, [r2, r2])
          };
        };
        pathExtentsMap[MakerJs2.pathType.Arc] = function(arc) {
          var r2 = arc.radius;
          var arcPoints = MakerJs2.point.fromArc(arc);
          function extremeAngle(xyAngle, value, fn) {
            var extremePoint = getExtremePoint(arcPoints[0], arcPoints[1], fn);
            for (var i = 2; i--; ) {
              if (isBetweenArcAngles(xyAngle[i], arc, false)) {
                extremePoint[i] = value + arc.origin[i];
              }
            }
            return extremePoint;
          }
          return {
            low: extremeAngle([180, 270], -r2, Math.min),
            high: extremeAngle([360, 90], r2, Math.max)
          };
        };
        function pathExtents(pathToMeasure, addOffset) {
          if (pathToMeasure) {
            var fn = pathExtentsMap[pathToMeasure.type];
            if (fn) {
              var m2 = fn(pathToMeasure);
              if (addOffset) {
                m2.high = MakerJs2.point.add(m2.high, addOffset);
                m2.low = MakerJs2.point.add(m2.low, addOffset);
              }
              return m2;
            }
          }
          return { low: null, high: null };
        }
        measure2.pathExtents = pathExtents;
        var pathLengthMap = {};
        pathLengthMap[MakerJs2.pathType.Line] = function(line2) {
          return pointDistance(line2.origin, line2.end);
        };
        pathLengthMap[MakerJs2.pathType.Circle] = function(circle2) {
          return 2 * Math.PI * circle2.radius;
        };
        pathLengthMap[MakerJs2.pathType.Arc] = function(arc) {
          var value = pathLengthMap[MakerJs2.pathType.Circle](arc);
          var pct = MakerJs2.angle.ofArcSpan(arc) / 360;
          value *= pct;
          return value;
        };
        pathLengthMap[MakerJs2.pathType.BezierSeed] = function(seed) {
          return MakerJs2.models.BezierCurve.computeLength(seed);
        };
        function pathLength(pathToMeasure) {
          if (pathToMeasure) {
            var fn = pathLengthMap[pathToMeasure.type];
            if (fn) {
              return fn(pathToMeasure);
            }
          }
          return 0;
        }
        measure2.pathLength = pathLength;
        function modelPathLength(modelToMeasure) {
          var total = 0;
          MakerJs2.model.walk(modelToMeasure, {
            onPath: function(walkedPath) {
              total += pathLength(walkedPath.pathContext);
            }
          });
          return total;
        }
        measure2.modelPathLength = modelPathLength;
        function cloneMeasure(measureToclone) {
          return {
            high: MakerJs2.point.clone(measureToclone.high),
            low: MakerJs2.point.clone(measureToclone.low)
          };
        }
        function modelExtents(modelToMeasure, atlas) {
          function increaseParentModel(childRoute, childMeasurement) {
            if (!childMeasurement)
              return;
            var parentRoute = childRoute.slice(0, -2);
            var parentRouteKey = MakerJs2.createRouteKey(parentRoute);
            if (!(parentRouteKey in atlas.modelMap)) {
              atlas.modelMap[parentRouteKey] = cloneMeasure(childMeasurement);
            } else {
              increase(atlas.modelMap[parentRouteKey], childMeasurement);
            }
          }
          if (!atlas)
            atlas = new Atlas(modelToMeasure);
          var walkOptions = {
            onPath: function(walkedPath) {
              if (!(walkedPath.routeKey in atlas.pathMap)) {
                atlas.pathMap[walkedPath.routeKey] = pathExtents(walkedPath.pathContext, walkedPath.offset);
              }
              increaseParentModel(walkedPath.route, atlas.pathMap[walkedPath.routeKey]);
            },
            afterChildWalk: function(walkedModel) {
              increaseParentModel(walkedModel.route, atlas.modelMap[walkedModel.routeKey]);
            }
          };
          MakerJs2.model.walk(modelToMeasure, walkOptions);
          atlas.modelsMeasured = true;
          var m2 = atlas.modelMap[""];
          if (m2) {
            return augment(m2);
          }
          return null;
        }
        measure2.modelExtents = modelExtents;
        function augment(measureToAugment) {
          var m2 = measureToAugment;
          m2.center = MakerJs2.point.average(m2.high, m2.low);
          m2.width = m2.high[0] - m2.low[0];
          m2.height = m2.high[1] - m2.low[1];
          return m2;
        }
        measure2.augment = augment;
        var Atlas = (
          /** @class */
          (function() {
            function Atlas2(modelContext) {
              this.modelContext = modelContext;
              this.modelsMeasured = false;
              this.modelMap = {};
              this.pathMap = {};
            }
            Atlas2.prototype.measureModels = function() {
              if (!this.modelsMeasured) {
                modelExtents(this.modelContext, this);
              }
            };
            return Atlas2;
          })()
        );
        measure2.Atlas = Atlas;
        function loopIndex(base, i) {
          if (i >= base)
            return i - base;
          if (i < 0)
            return i + base;
          return i;
        }
        function yAtX(slope, x2) {
          return slope.slope * x2 + slope.yIntercept;
        }
        function pointOnSlopeAtX(line2, x2) {
          var slope = lineSlope(line2);
          return [x2, yAtX(slope, x2)];
        }
        function isCircular(bounds) {
          for (var i = 1; i < 3; i++) {
            if (!measure2.isPointEqual(bounds[0].center, bounds[i].center, 1e-6) || !(MakerJs2.round(bounds[0].width - bounds[i].width) === 0)) {
              return false;
            }
          }
          return true;
        }
        function getAngledBounds(index, modelToMeasure, rotateModel, rotatePaths) {
          MakerJs2.model.rotate(modelToMeasure, rotateModel);
          var m2 = modelExtents(modelToMeasure);
          var result = {
            index,
            rotation: rotatePaths,
            center: MakerJs2.point.rotate(m2.center, rotatePaths),
            //model is sideways, so width is based on Y, height is based on X
            width: m2.height,
            height: m2.width,
            bottom: new MakerJs2.paths.Line(m2.low, [m2.high[0], m2.low[1]]),
            middle: new MakerJs2.paths.Line([m2.low[0], m2.center[1]], [m2.high[0], m2.center[1]]),
            top: new MakerJs2.paths.Line(m2.high, [m2.low[0], m2.high[1]])
          };
          [result.top, result.middle, result.bottom].forEach(function(line2) {
            return MakerJs2.path.rotate(line2, rotatePaths);
          });
          return result;
        }
        function hexSolution(lines, bounds) {
          var tip = lines[1].origin;
          var tipX = tip[0];
          var left = lines[3].origin[0];
          var right = lines[0].origin[0];
          var altRight = tipX - right;
          if (right - left > 2 * altRight)
            return null;
          var altLeft = (tipX - left) / 3;
          if (altRight < altLeft)
            return null;
          var altitudeViaSide = Math.min(altLeft, altRight);
          var radiusViaSide = MakerJs2.solvers.equilateralSide(altitudeViaSide);
          var peakPoints = [MakerJs2.point.fromSlopeIntersection(lines[1], lines[2]), MakerJs2.point.fromSlopeIntersection(lines[4], lines[5])];
          var peakRadii = peakPoints.map(function(p2) {
            return Math.abs(p2[1] - tip[1]);
          });
          var peakNum = peakRadii[0] > peakRadii[1] ? 0 : 1;
          var radiusViaPeak = peakRadii[peakNum];
          if (radiusViaPeak > radiusViaSide) {
            var altitudeViaPeak = MakerJs2.solvers.equilateralAltitude(radiusViaPeak);
            var peakX = tipX - 2 * altitudeViaPeak;
            if (right > peakX + altitudeViaPeak)
              return null;
            if (left < peakX - altitudeViaPeak)
              return null;
            var leftGap = left - peakX + altitudeViaPeak;
            var peakGap = 2 * altitudeViaPeak - bounds[peakNum + 1].width;
            var minHalfGap = Math.min(leftGap, peakGap) / 2;
            return {
              origin: pointOnSlopeAtX(bounds[2 - peakNum].middle, peakX + minHalfGap),
              radius: radiusViaPeak,
              type: "peak " + peakNum
            };
          } else {
            return {
              origin: [tipX - 2 * altitudeViaSide, tip[1]],
              radius: radiusViaSide,
              type: "side"
            };
          }
        }
        function boundingHexagon(modelToMeasure) {
          var clone = MakerJs2.cloneObject(modelToMeasure);
          MakerJs2.model.originate(clone);
          var originalMeasure = modelExtents(clone);
          var bounds = [];
          var scratch = { paths: {} };
          MakerJs2.model.center(clone);
          function result(radius, origin, notes) {
            return {
              radius,
              paths: new MakerJs2.models.Polygon(6, radius, 30).paths,
              origin: MakerJs2.point.add(origin, originalMeasure.center),
              //models: { scratch: scratch },
              notes
            };
          }
          var boundRotations = [[90, -90], [-60, -30], [-60, 30]];
          while (boundRotations.length) {
            var rotation = boundRotations.shift();
            var bound = getAngledBounds(bounds.length, clone, rotation[0], rotation[1]);
            var side = MakerJs2.solvers.equilateralSide(bound.width / 2);
            if (side >= bound.height) {
              return result(side, bound.center, "solved by bound " + bounds.length);
            }
            bounds.push(bound);
          }
          if (isCircular(bounds)) {
            return result(MakerJs2.solvers.equilateralSide(bounds[0].width / 2), bounds[0].center, "solved as circular");
          }
          var perimeters = bounds.map(function(b2) {
            return b2.top;
          }).concat(bounds.map(function(b2) {
            return b2.bottom;
          }));
          perimeters.forEach(function(p3, i2) {
            scratch.paths[i2] = p3;
            MakerJs2.path.converge(perimeters[loopIndex(6, i2 + 2)], p3, true);
          });
          bounds.forEach(function(b2, i2) {
            scratch.paths["m" + i2] = b2.middle;
          });
          var boundCopy = bounds.slice();
          var solution;
          for (var i = 0; i < 6; i++) {
            if (i > 0) {
              perimeters.push(perimeters.shift());
              boundCopy.push(boundCopy.shift());
              MakerJs2.model.rotate(scratch, -60);
            }
            var s2 = hexSolution(perimeters, boundCopy);
            if (s2) {
              if (!solution || s2.radius < solution.radius) {
                solution = s2;
                solution.index = i;
              }
            }
          }
          var p2 = MakerJs2.point.rotate(solution.origin, solution.index * 60);
          return result(solution.radius, p2, "solved by " + solution.index + " as " + solution.type);
        }
        measure2.boundingHexagon = boundingHexagon;
        function addUniquePoints(pointArray, pointsToAdd) {
          var added = 0;
          pointsToAdd.forEach(function(p2) {
            if (!measure2.isPointDistinct(p2, pointArray, 1e-8))
              return;
            pointArray.push(p2);
            added++;
          });
          return added;
        }
        function getFarPoint(modelContext, farPoint, measureAtlas) {
          if (farPoint)
            return farPoint;
          var high = modelExtents(modelContext).high;
          if (high) {
            return MakerJs2.point.add(high, [1, 1]);
          }
          return [7654321, 1234567];
        }
        function isPointInsideModel(pointToCheck, modelContext, options) {
          if (options === void 0) {
            options = {};
          }
          if (!options.farPoint) {
            options.farPoint = getFarPoint(modelContext, options.farPoint, options.measureAtlas);
          }
          options.out_intersectionPoints = [];
          var isInside;
          var lineToFarPoint = new MakerJs2.paths.Line(pointToCheck, options.farPoint);
          var measureFarPoint = pathExtents(lineToFarPoint);
          var walkOptions = {
            onPath: function(walkedPath) {
              if (options.measureAtlas && !isMeasurementOverlapping(measureFarPoint, options.measureAtlas.pathMap[walkedPath.routeKey])) {
                return;
              }
              var intersectOptions = { path2Offset: walkedPath.offset };
              var farInt = MakerJs2.path.intersection(lineToFarPoint, walkedPath.pathContext, intersectOptions);
              if (farInt) {
                var added = addUniquePoints(options.out_intersectionPoints, farInt.intersectionPoints);
                if (added % 2 == 1) {
                  isInside = !!!isInside;
                }
              }
            },
            beforeChildWalk: function(innerWalkedModel) {
              if (!options.measureAtlas) {
                return true;
              }
              var innerModelMeasurement = options.measureAtlas.modelMap[innerWalkedModel.routeKey];
              return innerModelMeasurement && isMeasurementOverlapping(measureFarPoint, innerModelMeasurement);
            }
          };
          MakerJs2.model.walk(modelContext, walkOptions);
          return !!isInside;
        }
        measure2.isPointInsideModel = isPointInsideModel;
      })(measure = MakerJs2.measure || (MakerJs2.measure = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var exporter;
      (function(exporter2) {
        function toJson(itemToExport, options) {
          if (options === void 0) {
            options = {};
          }
          function replacer(key, value) {
            if (MakerJs2.isNumber(value)) {
              var newValue = MakerJs2.round(value, options.accuracy);
              return newValue;
            }
            if (MakerJs2.isPoint(value)) {
              var newPoint = MakerJs2.point.rounded(value, options.accuracy);
              return newPoint;
            }
            return value;
          }
          return JSON.stringify(itemToExport, options.accuracy && replacer, options.indentation);
        }
        exporter2.toJson = toJson;
        function tryGetModelUnits(itemToExport) {
          if (MakerJs2.isModel(itemToExport)) {
            return itemToExport.units;
          }
        }
        exporter2.tryGetModelUnits = tryGetModelUnits;
        exporter2.colors = {
          black: 0,
          red: 1,
          yellow: 2,
          lime: 3,
          aqua: 4,
          blue: 5,
          fuchsia: 6,
          white: 7,
          gray: 9,
          maroon: 14,
          orange: 30,
          olive: 58,
          green: 94,
          teal: 134,
          navy: 174,
          purple: 214,
          silver: 254
        };
      })(exporter = MakerJs2.exporter || (MakerJs2.exporter = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var importer;
      (function(importer2) {
        function parseNumericList(s2) {
          var result = [];
          var re2 = /-?(?:0|[1-9]\d*)?(?:\.\d*)?(?:[eE][+\-]?\d+)?/g;
          var matches;
          while ((matches = re2.exec(s2)) !== null) {
            if (matches.index === re2.lastIndex) {
              re2.lastIndex++;
            }
            if (matches[0] !== "")
              result.push(parseFloat(matches[0]));
          }
          return result;
        }
        importer2.parseNumericList = parseNumericList;
      })(importer = MakerJs2.importer || (MakerJs2.importer = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var exporter;
      (function(exporter2) {
        function toDXF(itemToExport, options) {
          if (options === void 0) {
            options = {};
          }
          var opts = {
            fontSize: 9
          };
          var layerIds = [];
          var doc = {
            entities: [],
            header: {},
            tables: {}
          };
          MakerJs2.extendObject(opts, options);
          if (MakerJs2.isModel(itemToExport)) {
            var modelToExport = itemToExport;
            if (modelToExport.exporterOptions) {
              MakerJs2.extendObject(opts, modelToExport.exporterOptions["toDXF"]);
            }
          }
          function colorLayerOptions(layer) {
            if (opts.layerOptions && opts.layerOptions[layer])
              return opts.layerOptions[layer];
            if (layer in exporter2.colors) {
              return {
                color: exporter2.colors[layer]
              };
            }
          }
          function lineTypeLayerOptions(layer) {
            if (opts.layerOptions && opts.layerOptions[layer] && opts.layerOptions[layer].lineType) {
              return opts.layerOptions[layer].lineType;
            }
            return "CONTINUOUS";
          }
          function defaultLayer(pathContext, parentLayer) {
            var layerId = pathContext && pathContext.layer || parentLayer || "0";
            if (layerIds.indexOf(layerId) < 0) {
              layerIds.push(layerId);
            }
            return layerId;
          }
          var map = {};
          map[MakerJs2.pathType.Line] = function(line2, offset, layer) {
            var layerId = defaultLayer(line2, layer);
            var lineEntity = {
              type: "LINE",
              layer: layerId,
              vertices: [
                {
                  x: MakerJs2.round(line2.origin[0] + offset[0], opts.accuracy),
                  y: MakerJs2.round(line2.origin[1] + offset[1], opts.accuracy)
                },
                {
                  x: MakerJs2.round(line2.end[0] + offset[0], opts.accuracy),
                  y: MakerJs2.round(line2.end[1] + offset[1], opts.accuracy)
                }
              ]
            };
            lineEntity.lineType = lineTypeLayerOptions(layerId);
            return lineEntity;
          };
          map[MakerJs2.pathType.Circle] = function(circle2, offset, layer) {
            var layerId = defaultLayer(circle2, layer);
            var circleEntity = {
              type: "CIRCLE",
              layer: layerId,
              center: {
                x: MakerJs2.round(circle2.origin[0] + offset[0], opts.accuracy),
                y: MakerJs2.round(circle2.origin[1] + offset[1], opts.accuracy)
              },
              radius: MakerJs2.round(circle2.radius, opts.accuracy)
            };
            circleEntity.lineType = lineTypeLayerOptions(layerId);
            return circleEntity;
          };
          map[MakerJs2.pathType.Arc] = function(arc, offset, layer) {
            var layerId = defaultLayer(arc, layer);
            var arcEntity = {
              type: "ARC",
              layer: layerId,
              center: {
                x: MakerJs2.round(arc.origin[0] + offset[0], opts.accuracy),
                y: MakerJs2.round(arc.origin[1] + offset[1], opts.accuracy)
              },
              radius: MakerJs2.round(arc.radius, opts.accuracy),
              startAngle: MakerJs2.round(arc.startAngle, opts.accuracy),
              endAngle: MakerJs2.round(arc.endAngle, opts.accuracy)
            };
            arcEntity.lineType = lineTypeLayerOptions(layerId);
            return arcEntity;
          };
          function appendVertex(v, layer, bulge) {
            var vertex = {
              type: "VERTEX",
              layer: defaultLayer(null, layer),
              x: MakerJs2.round(v[0], opts.accuracy),
              y: MakerJs2.round(v[1], opts.accuracy),
              bulge
            };
            return vertex;
          }
          function polyline(c2) {
            var polylineEntity = {
              type: "POLYLINE",
              layer: defaultLayer(null, c2.layer),
              shape: c2.chain.endless,
              vertices: []
            };
            polylineEntity.lineType = lineTypeLayerOptions(polylineEntity.layer);
            c2.chain.links.forEach(function(link, i) {
              var bulge;
              if (link.walkedPath.pathContext.type === MakerJs2.pathType.Arc) {
                var arc = link.walkedPath.pathContext;
                bulge = MakerJs2.round(Math.tan(MakerJs2.angle.toRadians(MakerJs2.angle.ofArcSpan(arc)) / 4), opts.accuracy);
                if (link.reversed) {
                  bulge *= -1;
                }
              }
              var vertex = link.endPoints[link.reversed ? 1 : 0];
              polylineEntity.vertices.push(appendVertex(vertex, c2.layer, bulge));
            });
            if (!c2.chain.endless) {
              var lastLink = c2.chain.links[c2.chain.links.length - 1];
              var endPoint = lastLink.endPoints[lastLink.reversed ? 0 : 1];
              polylineEntity.vertices.push(appendVertex(endPoint, c2.layer));
            }
            return polylineEntity;
          }
          function text(caption) {
            var layerId = defaultLayer(null, caption.layer);
            var layerOptions = colorLayerOptions(layerId);
            var center = MakerJs2.point.middle(caption.anchor);
            var textEntity = {
              type: "TEXT",
              startPoint: appendVertex(center, null),
              endPoint: appendVertex(center, null),
              layer: layerId,
              textHeight: layerOptions && layerOptions.fontSize || opts.fontSize,
              text: caption.text,
              halign: 4,
              valign: 0,
              rotation: MakerJs2.angle.ofPointInDegrees(caption.anchor.origin, caption.anchor.end)
            };
            return textEntity;
          }
          function layerOut(layerId, layerColor) {
            var layerEntity = {
              name: layerId,
              color: layerColor
            };
            layerEntity.lineType = lineTypeLayerOptions(layerId);
            return layerEntity;
          }
          function lineTypesOut() {
            var lineStyleTable = {
              lineTypes: {
                "CONTINUOUS": {
                  name: "CONTINUOUS",
                  description: "______",
                  patternLength: 0,
                  elements: []
                },
                "DASHED": {
                  name: "DASHED",
                  description: "_ _ _ ",
                  elements: [5, -2.5],
                  patternLength: 7.5
                },
                "DOTTED": {
                  name: "DOTTED",
                  description: ". . . ",
                  elements: [0.5, -1],
                  patternLength: 1.5
                }
              }
            };
            var tableName = "lineType";
            doc.tables[tableName] = lineStyleTable;
          }
          function layersOut() {
            var layerTable = {
              layers: {}
            };
            layerIds.forEach(function(layerId) {
              var layerOptions = colorLayerOptions(layerId);
              if (layerOptions) {
                layerTable.layers[layerId] = layerOut(layerId, layerOptions.color);
              }
            });
            var tableName = "layer";
            doc.tables[tableName] = layerTable;
          }
          function header() {
            if (opts.units) {
              var units2 = dxfUnit[opts.units];
              doc.header["$INSUNITS"] = units2;
            }
          }
          function entities(walkedPaths2, chains, captions) {
            var entityArray = doc.entities;
            entityArray.push.apply(entityArray, chains.map(polyline));
            walkedPaths2.forEach(function(walkedPath) {
              var fn = map[walkedPath.pathContext.type];
              if (fn) {
                var entity = fn(walkedPath.pathContext, walkedPath.offset, walkedPath.layer);
                entityArray.push(entity);
              }
            });
            entityArray.push.apply(entityArray, captions.map(text));
          }
          if (!opts.units) {
            var units = exporter2.tryGetModelUnits(itemToExport);
            if (units) {
              opts.units = units;
            }
          }
          MakerJs2.extendObject(options, opts);
          var chainsOnLayers = [];
          var walkedPaths = [];
          if (opts.usePOLYLINE) {
            var cb = function(chains, loose, layer) {
              chains.forEach(function(c2) {
                if (c2.endless && c2.links.length === 1 && c2.links[0].walkedPath.pathContext.type === MakerJs2.pathType.Circle) {
                  walkedPaths.push(c2.links[0].walkedPath);
                  return;
                }
                var chainOnLayer = { chain: c2, layer };
                chainsOnLayers.push(chainOnLayer);
              });
              walkedPaths.push.apply(walkedPaths, loose);
            };
            MakerJs2.model.findChains(modelToExport, cb, { byLayers: true, pointMatchingDistance: opts.pointMatchingDistance });
          } else {
            var walkOptions = {
              onPath: function(walkedPath) {
                walkedPaths.push(walkedPath);
              }
            };
            MakerJs2.model.walk(modelToExport, walkOptions);
          }
          entities(walkedPaths, chainsOnLayers, MakerJs2.model.getAllCaptionsOffset(modelToExport));
          header();
          lineTypesOut();
          layersOut();
          return outputDocument(doc);
        }
        exporter2.toDXF = toDXF;
        function outputDocument(doc) {
          var dxf = [];
          function append() {
            var values = [];
            for (var _i = 0; _i < arguments.length; _i++) {
              values[_i] = arguments[_i];
            }
            dxf.push.apply(dxf, values);
          }
          function appendLineType(entity) {
            var lt2 = entity.lineType;
            if (lt2) {
              append("6", lt2);
            }
          }
          var map = {};
          map["LINE"] = function(line2) {
            append("0", "LINE", "8", line2.layer);
            appendLineType(line2);
            append("10", line2.vertices[0].x, "20", line2.vertices[0].y, "11", line2.vertices[1].x, "21", line2.vertices[1].y);
          };
          map["CIRCLE"] = function(circle2) {
            append("0", "CIRCLE", "8", circle2.layer);
            appendLineType(circle2);
            append("10", circle2.center.x, "20", circle2.center.y, "40", circle2.radius);
          };
          map["ARC"] = function(arc) {
            append("0", "ARC", "8", arc.layer);
            appendLineType(arc);
            append("10", arc.center.x, "20", arc.center.y, "40", arc.radius, "50", arc.startAngle, "51", arc.endAngle);
          };
          map["VERTEX"] = function(vertex) {
            append("0", "VERTEX", "8", vertex.layer, "10", vertex.x, "20", vertex.y);
            if (vertex.bulge !== void 0) {
              append("42", vertex.bulge);
            }
          };
          map["POLYLINE"] = function(polyline) {
            append("0", "POLYLINE", "8", polyline.layer);
            appendLineType(polyline);
            append("66", 1, "70", polyline.shape ? 1 : 0);
            polyline.vertices.forEach(function(vertex) {
              return map["VERTEX"](vertex);
            });
            append("0", "SEQEND");
          };
          map["TEXT"] = function(text) {
            append("0", "TEXT", "10", text.startPoint.x, "20", text.startPoint.y, "11", text.endPoint.x, "21", text.endPoint.y, "40", text.textHeight, "1", text.text, "50", text.rotation, "8", text.layer, "72", text.halign, "73", text.valign);
          };
          function section(sectionFn) {
            append("0", "SECTION");
            sectionFn();
            append("0", "ENDSEC");
          }
          function table(fn) {
            append("0", "TABLE");
            fn();
            append("0", "ENDTAB");
          }
          function tables() {
            append("2", "TABLES");
            table(lineTypesOut);
            table(layersOut);
          }
          function layerOut(layer) {
            var lt2 = layer.lineType || "CONTINUOUS";
            append("0", "LAYER", "2", layer.name, "70", "0", "62", layer.color, "6", lt2);
          }
          function lineTypeOut(lineType) {
            var elements = lineType.elements || [];
            append(
              "0",
              "LTYPE",
              "72",
              //72 Alignment code; value is always 65, the ASCII code for A
              "65",
              "70",
              "0",
              "2",
              lineType.name,
              "3",
              lineType.description,
              "73",
              elements.length,
              "40",
              lineType.patternLength
            );
            elements.forEach(function(e2) {
              return append("49", e2);
            });
          }
          function lineTypesOut() {
            var lineTypeTableName = "lineType";
            var lineTypeTable = doc.tables[lineTypeTableName];
            append("2", "LTYPE");
            for (var lineTypeId in lineTypeTable.lineTypes) {
              var lineType = lineTypeTable.lineTypes[lineTypeId];
              lineTypeOut(lineType);
            }
          }
          function layersOut() {
            var layerTableName = "layer";
            var layerTable = doc.tables[layerTableName];
            append("2", "LAYER");
            for (var layerId in layerTable.layers) {
              var layer = layerTable.layers[layerId];
              layerOut(layer);
            }
          }
          function header() {
            append("2", "HEADER");
            for (var key in doc.header) {
              var value = doc.header[key];
              append("9", key, "70", value);
            }
          }
          function entities(entityArray) {
            append("2", "ENTITIES");
            entityArray.forEach(function(entity) {
              var fn = map[entity.type];
              if (fn) {
                fn(entity);
              }
            });
          }
          section(header);
          section(tables);
          section(function() {
            return entities(doc.entities);
          });
          append("0", "EOF");
          return dxf.join("\n");
        }
        var dxfUnit = {};
        dxfUnit[""] = 0;
        dxfUnit[MakerJs2.unitType.Inch] = 1;
        dxfUnit[MakerJs2.unitType.Foot] = 2;
        dxfUnit[MakerJs2.unitType.Millimeter] = 4;
        dxfUnit[MakerJs2.unitType.Centimeter] = 5;
        dxfUnit[MakerJs2.unitType.Meter] = 6;
      })(exporter = MakerJs2.exporter || (MakerJs2.exporter = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var solvers;
      (function(solvers2) {
        var equilateral = Math.sqrt(3) / 2;
        function equilateralAltitude(sideLength) {
          return sideLength * equilateral;
        }
        solvers2.equilateralAltitude = equilateralAltitude;
        function equilateralSide(altitude) {
          return altitude / equilateral;
        }
        solvers2.equilateralSide = equilateralSide;
        function solveTriangleSSS(lengthA, lengthB, lengthC) {
          return MakerJs2.angle.toDegrees(Math.acos((lengthB * lengthB + lengthC * lengthC - lengthA * lengthA) / (2 * lengthB * lengthC)));
        }
        solvers2.solveTriangleSSS = solveTriangleSSS;
        function solveTriangleASA(oppositeAngleInDegrees, lengthOfSideBetweenAngles, otherAngleInDegrees) {
          var angleOppositeSide = 180 - oppositeAngleInDegrees - otherAngleInDegrees;
          return lengthOfSideBetweenAngles * Math.sin(MakerJs2.angle.toRadians(oppositeAngleInDegrees)) / Math.sin(MakerJs2.angle.toRadians(angleOppositeSide));
        }
        solvers2.solveTriangleASA = solveTriangleASA;
        function circleTangentAngles(a2, b2, inner) {
          if (inner === void 0) {
            inner = false;
          }
          var connect = new MakerJs2.paths.Line(a2.origin, b2.origin);
          var distance = MakerJs2.measure.pointDistance(a2.origin, b2.origin);
          if (a2.radius >= distance + b2.radius || b2.radius >= distance + a2.radius)
            return null;
          if (inner && a2.radius + b2.radius >= distance)
            return null;
          var tangentAngles;
          if (!inner && MakerJs2.round(a2.radius - b2.radius) == 0) {
            tangentAngles = [90, 270];
          } else {
            var d2 = distance / 2;
            var between = new MakerJs2.paths.Circle([d2, 0], d2);
            var diff = new MakerJs2.paths.Circle(a2.radius > b2.radius ? [0, 0] : [distance, 0], inner ? a2.radius + b2.radius : Math.abs(a2.radius - b2.radius));
            var int = MakerJs2.path.intersection(diff, between);
            if (!int || !int.path1Angles)
              return null;
            tangentAngles = int.path1Angles;
          }
          var connectAngle = MakerJs2.angle.ofLineInDegrees(connect);
          return tangentAngles.map(function(a3) {
            return MakerJs2.angle.noRevolutions(a3 + connectAngle);
          });
        }
        solvers2.circleTangentAngles = circleTangentAngles;
      })(solvers = MakerJs2.solvers || (MakerJs2.solvers = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var path;
      (function(path2) {
        var map = {};
        map[MakerJs2.pathType.Arc] = {};
        map[MakerJs2.pathType.Circle] = {};
        map[MakerJs2.pathType.Line] = {};
        map[MakerJs2.pathType.Arc][MakerJs2.pathType.Arc] = function(arc1, arc2, options, swapOffsets) {
          var result = null;
          moveTemp([arc1, arc2], options, swapOffsets, function() {
            var angles = circleToCircle(arc1, arc2, options);
            if (angles) {
              var arc1Angles = getAnglesWithinArc(angles[0], arc1, options);
              var arc2Angles = getAnglesWithinArc(angles[1], arc2, options);
              if (arc1Angles && arc2Angles) {
                if (arc1Angles.length === 1 || arc2Angles.length === 1) {
                  for (var i1 = 0; i1 < arc1Angles.length; i1++) {
                    for (var i2 = 0; i2 < arc2Angles.length; i2++) {
                      var p1 = MakerJs2.point.fromAngleOnCircle(arc1Angles[i1], arc1);
                      var p2 = MakerJs2.point.fromAngleOnCircle(arc2Angles[i2], arc2);
                      if (MakerJs2.measure.isPointEqual(p1, p2, 1e-4)) {
                        result = {
                          intersectionPoints: [p1],
                          path1Angles: [arc1Angles[i1]],
                          path2Angles: [arc2Angles[i2]]
                        };
                        return;
                      }
                    }
                  }
                } else {
                  result = {
                    intersectionPoints: pointsFromAnglesOnCircle(arc1Angles, arc1),
                    path1Angles: arc1Angles,
                    path2Angles: arc2Angles
                  };
                }
              }
            } else {
              if (options.out_AreOverlapped) {
                options.out_AreOverlapped = MakerJs2.measure.isArcOverlapping(arc1, arc2, options.excludeTangents);
              }
            }
          });
          return result;
        };
        map[MakerJs2.pathType.Arc][MakerJs2.pathType.Circle] = function(arc, circle2, options, swapOffsets) {
          var result = null;
          moveTemp([arc, circle2], options, swapOffsets, function() {
            var angles = circleToCircle(arc, circle2, options);
            if (angles) {
              var arcAngles = getAnglesWithinArc(angles[0], arc, options);
              if (arcAngles) {
                var circleAngles;
                if (arcAngles.length == 2) {
                  circleAngles = angles[1];
                } else {
                  var index = findCorrespondingAngleIndex(angles[0], arcAngles[0]);
                  circleAngles = [angles[1][index]];
                }
                result = {
                  intersectionPoints: pointsFromAnglesOnCircle(arcAngles, arc),
                  path1Angles: arcAngles,
                  path2Angles: circleAngles
                };
              }
            }
          });
          return result;
        };
        map[MakerJs2.pathType.Arc][MakerJs2.pathType.Line] = function(arc, line2, options, swapOffsets) {
          var result = null;
          moveTemp([arc, line2], options, swapOffsets, function() {
            var angles = lineToCircle(line2, arc, options);
            if (angles) {
              var arcAngles = getAnglesWithinArc(angles, arc, options);
              if (arcAngles) {
                result = {
                  intersectionPoints: pointsFromAnglesOnCircle(arcAngles, arc),
                  path1Angles: arcAngles
                };
              }
            }
          });
          return result;
        };
        map[MakerJs2.pathType.Circle][MakerJs2.pathType.Arc] = function(circle2, arc, options) {
          var result = map[MakerJs2.pathType.Arc][MakerJs2.pathType.Circle](arc, circle2, options, true);
          if (result) {
            return swapAngles(result);
          }
          return null;
        };
        map[MakerJs2.pathType.Circle][MakerJs2.pathType.Circle] = function(circle1, circle2, options, swapOffsets) {
          var result = null;
          moveTemp([circle1, circle2], options, swapOffsets, function() {
            var angles = circleToCircle(circle1, circle2, options);
            if (angles) {
              result = {
                intersectionPoints: pointsFromAnglesOnCircle(angles[0], circle1),
                path1Angles: angles[0],
                path2Angles: angles[1]
              };
            }
          });
          return result;
        };
        map[MakerJs2.pathType.Circle][MakerJs2.pathType.Line] = function(circle2, line2, options, swapOffsets) {
          var result = null;
          moveTemp([circle2, line2], options, swapOffsets, function() {
            var angles = lineToCircle(line2, circle2, options);
            if (angles) {
              result = {
                intersectionPoints: pointsFromAnglesOnCircle(angles, circle2),
                path1Angles: angles
              };
            }
          });
          return result;
        };
        map[MakerJs2.pathType.Line][MakerJs2.pathType.Arc] = function(line2, arc, options) {
          var result = map[MakerJs2.pathType.Arc][MakerJs2.pathType.Line](arc, line2, options, true);
          if (result) {
            return swapAngles(result);
          }
          return null;
        };
        map[MakerJs2.pathType.Line][MakerJs2.pathType.Circle] = function(line2, circle2, options) {
          var result = map[MakerJs2.pathType.Circle][MakerJs2.pathType.Line](circle2, line2, options, true);
          if (result) {
            return swapAngles(result);
          }
          return null;
        };
        map[MakerJs2.pathType.Line][MakerJs2.pathType.Line] = function(line1, line2, options, swapOffsets) {
          var result = null;
          moveTemp([line1, line2], options, swapOffsets, function() {
            var intersectionPoint = MakerJs2.point.fromSlopeIntersection(line1, line2, options);
            if (intersectionPoint) {
              if (MakerJs2.measure.isBetweenPoints(intersectionPoint, line1, options.excludeTangents) && MakerJs2.measure.isBetweenPoints(intersectionPoint, line2, options.excludeTangents)) {
                result = {
                  intersectionPoints: [intersectionPoint]
                };
              }
            }
          });
          return result;
        };
        function moveTemp(pathsToOffset, options, swapOffsets, task) {
          var offsets = swapOffsets ? [options.path2Offset, options.path1Offset] : [options.path1Offset, options.path2Offset];
          path2.moveTemporary(pathsToOffset, offsets, task);
        }
        ;
        function swapAngles(result) {
          var temp = result.path1Angles;
          if (result.path2Angles) {
            result.path1Angles = result.path2Angles;
          } else {
            delete result.path1Angles;
          }
          if (temp) {
            result.path2Angles = temp;
          }
          return result;
        }
        function intersection(path1, path22, options) {
          if (options === void 0) {
            options = {};
          }
          if (path1 && path22) {
            var fn = map[path1.type][path22.type];
            if (fn) {
              return fn(path1, path22, options);
            }
          }
          return null;
        }
        path2.intersection = intersection;
        function findCorrespondingAngleIndex(circleAngles, arcAngle) {
          for (var i = 2; i--; ) {
            if (circleAngles[i] === arcAngle)
              return i;
          }
        }
        function pointsFromAnglesOnCircle(anglesInDegrees, circle2) {
          var result = [];
          for (var i = 0; i < anglesInDegrees.length; i++) {
            result.push(MakerJs2.point.fromAngleOnCircle(anglesInDegrees[i], circle2));
          }
          return result;
        }
        function getAnglesWithinArc(angles, arc, options) {
          if (!angles)
            return null;
          var anglesWithinArc = [];
          for (var i = 0; i < angles.length; i++) {
            if (MakerJs2.measure.isBetweenArcAngles(angles[i], arc, options.excludeTangents)) {
              anglesWithinArc.push(angles[i]);
            }
          }
          if (anglesWithinArc.length == 0)
            return null;
          return anglesWithinArc;
        }
        function lineToCircle(line2, circle2, options) {
          var radius = MakerJs2.round(circle2.radius);
          if (circle2.radius <= 0) {
            return null;
          }
          var clonedLine = new MakerJs2.paths.Line(MakerJs2.point.subtract(line2.origin, circle2.origin), MakerJs2.point.subtract(line2.end, circle2.origin));
          var lineAngleNormal = MakerJs2.angle.ofLineInDegrees(line2);
          var lineAngle = lineAngleNormal >= 180 ? lineAngleNormal - 360 : lineAngleNormal;
          path2.rotate(clonedLine, -lineAngle, MakerJs2.point.zero());
          function unRotate(resultAngle) {
            var unrotated = resultAngle + lineAngle;
            return MakerJs2.round(MakerJs2.angle.noRevolutions(unrotated));
          }
          var lineY = MakerJs2.round(clonedLine.origin[1]);
          var lineYabs = Math.abs(lineY);
          if (lineYabs > radius) {
            return null;
          }
          var anglesOfIntersection = [];
          if (lineYabs == radius) {
            if (options.excludeTangents) {
              return null;
            }
            anglesOfIntersection.push(unRotate(lineY > 0 ? 90 : 270));
          } else {
            let intersectionBetweenEndpoints2 = function(x2, angleOfX) {
              if (MakerJs2.measure.isBetween(MakerJs2.round(x2), MakerJs2.round(clonedLine.origin[0]), MakerJs2.round(clonedLine.end[0]), options.excludeTangents)) {
                anglesOfIntersection.push(unRotate(angleOfX));
              }
            };
            var intersectionBetweenEndpoints = intersectionBetweenEndpoints2;
            var intersectRadians = Math.asin(lineY / radius);
            var intersectDegrees = MakerJs2.angle.toDegrees(intersectRadians);
            var intersectX = Math.cos(intersectRadians) * radius;
            intersectionBetweenEndpoints2(-intersectX, 180 - intersectDegrees);
            intersectionBetweenEndpoints2(intersectX, intersectDegrees);
          }
          if (anglesOfIntersection.length > 0) {
            return anglesOfIntersection;
          }
          return null;
        }
        function circleToCircle(circle1, circle2, options) {
          if (circle1.radius <= 0 || circle2.radius <= 0) {
            return null;
          }
          if (circle1.radius == circle2.radius && MakerJs2.measure.isPointEqual(circle1.origin, circle2.origin, 1e-4)) {
            options.out_AreOverlapped = true;
            return null;
          }
          var offset = MakerJs2.point.subtract(MakerJs2.point.zero(), circle1.origin);
          var c1 = new MakerJs2.paths.Circle(MakerJs2.point.zero(), circle1.radius);
          var c2 = new MakerJs2.paths.Circle(MakerJs2.point.subtract(circle2.origin, circle1.origin), circle2.radius);
          var c2Angle = MakerJs2.angle.ofPointInDegrees(MakerJs2.point.zero(), c2.origin);
          path2.rotate(c2, -c2Angle, MakerJs2.point.zero());
          function unRotate(resultAngle) {
            var unrotated = resultAngle + c2Angle;
            return MakerJs2.angle.noRevolutions(unrotated);
          }
          var x2 = c2.origin[0];
          if (MakerJs2.round(c2.radius - x2 - c1.radius) == 0) {
            if (options.excludeTangents) {
              return null;
            }
            return [[unRotate(180)], [unRotate(180)]];
          }
          if (MakerJs2.round(c2.radius + x2 - c1.radius) == 0) {
            if (options.excludeTangents) {
              return null;
            }
            return [[unRotate(0)], [unRotate(0)]];
          }
          if (MakerJs2.round(x2 - c2.radius - c1.radius) == 0) {
            if (options.excludeTangents) {
              return null;
            }
            return [[unRotate(0)], [unRotate(180)]];
          }
          if (MakerJs2.round(x2 - c2.radius) > c1.radius) {
            return null;
          }
          if (MakerJs2.round(x2 + c2.radius) < c1.radius) {
            return null;
          }
          if (MakerJs2.round(x2 - c2.radius) < -c1.radius) {
            return null;
          }
          function bothAngles(oneAngle) {
            return [unRotate(oneAngle), unRotate(MakerJs2.angle.mirror(oneAngle, false, true))];
          }
          var c1IntersectionAngle = MakerJs2.solvers.solveTriangleSSS(c2.radius, c1.radius, x2);
          var c2IntersectionAngle = MakerJs2.solvers.solveTriangleSSS(c1.radius, x2, c2.radius);
          return [bothAngles(c1IntersectionAngle), bothAngles(180 - c2IntersectionAngle)];
        }
      })(path = MakerJs2.path || (MakerJs2.path = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var path;
      (function(path2) {
        var propertyNamesMap = {};
        propertyNamesMap[MakerJs2.pathType.Arc] = function(arc) {
          return ["startAngle", "endAngle"];
        };
        propertyNamesMap[MakerJs2.pathType.Line] = function(line2) {
          return ["origin", "end"];
        };
        function getPointProperties(pathToInspect) {
          var points = MakerJs2.point.fromPathEnds(pathToInspect);
          if (points) {
            let pointProperty2 = function(index) {
              return { point: points[index], propertyName: propertyNames[index] };
            };
            var pointProperty = pointProperty2;
            var propertyNames = null;
            var fn = propertyNamesMap[pathToInspect.type];
            if (fn) {
              propertyNames = fn(pathToInspect);
              return [pointProperty2(0), pointProperty2(1)];
            }
          }
          return null;
        }
        function getMatchingPointProperties(pathA, pathB, options) {
          var pathAProperties = getPointProperties(pathA);
          var pathBProperties = getPointProperties(pathB);
          var result = null;
          function makeMatch(pathContext, pointProperties, index) {
            return {
              path: pathContext,
              isStart: index == 0,
              propertyName: pointProperties[index].propertyName,
              point: pointProperties[index].point,
              oppositePoint: pointProperties[1 - index].point
            };
          }
          function check(iA, iB) {
            if (MakerJs2.measure.isPointEqual(pathAProperties[iA].point, pathBProperties[iB].point, 1e-4)) {
              result = [
                makeMatch(pathA, pathAProperties, iA),
                makeMatch(pathB, pathBProperties, iB)
              ];
              return true;
            }
            return false;
          }
          check(0, 0) || check(0, 1) || check(1, 0) || check(1, 1);
          return result;
        }
        function populateShardPointsFromReferenceCircle(filletRadius, center, properties, options) {
          var referenceCircle = new MakerJs2.paths.Circle(center, filletRadius);
          for (var i = 0; i < 2; i++) {
            var circleIntersection = path2.intersection(referenceCircle, properties[i].path);
            if (!circleIntersection) {
              return false;
            }
            properties[i].shardPoint = circleIntersection.intersectionPoints[0];
            if (MakerJs2.measure.isPointEqual(properties[i].point, circleIntersection.intersectionPoints[0], 1e-4)) {
              if (circleIntersection.intersectionPoints.length > 1) {
                properties[i].shardPoint = circleIntersection.intersectionPoints[1];
              } else {
                return false;
              }
            }
          }
          return true;
        }
        function cloneAndBreakPath(pathToShard, shardPoint) {
          var shardStart = path2.clone(pathToShard);
          var shardEnd = path2.breakAtPoint(shardStart, shardPoint);
          return [shardStart, shardEnd];
        }
        var guidePathMap = {};
        guidePathMap[MakerJs2.pathType.Arc] = function(arc, filletRadius, nearPoint, shardPoint, isStart) {
          var guideRadius = arc.radius;
          var guideArcShard = cloneAndBreakPath(arc, shardPoint)[isStart ? 0 : 1];
          if (guideArcShard) {
            if (MakerJs2.measure.isArcConcaveTowardsPoint(guideArcShard, nearPoint)) {
              guideRadius -= filletRadius;
            } else {
              guideRadius += filletRadius;
            }
            if (MakerJs2.round(guideRadius) <= 0)
              return null;
            return new MakerJs2.paths.Arc(arc.origin, guideRadius, arc.startAngle, arc.endAngle);
          }
          return null;
        };
        guidePathMap[MakerJs2.pathType.Line] = function(line2, filletRadius, nearPoint, shardPoint, isStart) {
          return new MakerJs2.paths.Parallel(line2, filletRadius, nearPoint);
        };
        function getGuidePath(context, filletRadius, nearPoint) {
          var result = null;
          var fn = guidePathMap[context.path.type];
          if (fn) {
            result = fn(context.path, filletRadius, nearPoint, context.shardPoint, context.isStart);
          }
          return result;
        }
        var filletResultMap = {};
        filletResultMap[MakerJs2.pathType.Arc] = function(arc, propertyName, filletRadius, filletCenter) {
          var guideLine = new MakerJs2.paths.Line(arc.origin, filletCenter);
          var guideLineAngle = MakerJs2.angle.ofLineInDegrees(guideLine);
          var filletAngle = guideLineAngle;
          if (!MakerJs2.measure.isArcConcaveTowardsPoint(arc, filletCenter)) {
            filletAngle += 180;
          }
          return {
            filletAngle: MakerJs2.angle.noRevolutions(filletAngle),
            clipPath: function() {
              arc[propertyName] = guideLineAngle;
            }
          };
        };
        filletResultMap[MakerJs2.pathType.Line] = function(line2, propertyName, filletRadius, filletCenter) {
          var guideLine = new MakerJs2.paths.Line([0, 0], [0, 1]);
          var lineAngle = MakerJs2.angle.ofLineInDegrees(line2);
          path2.rotate(guideLine, lineAngle, [0, 0]);
          path2.moveRelative(guideLine, filletCenter);
          var intersectionPoint = MakerJs2.point.fromSlopeIntersection(line2, guideLine);
          if (intersectionPoint) {
            return {
              filletAngle: MakerJs2.angle.ofPointInDegrees(filletCenter, intersectionPoint),
              clipPath: function() {
                line2[propertyName] = intersectionPoint;
              }
            };
          }
          return null;
        };
        function getFilletResult(context, filletRadius, filletCenter) {
          var result = null;
          var fn = filletResultMap[context.path.type];
          if (fn) {
            result = fn(context.path, context.propertyName, filletRadius, filletCenter);
          }
          if (!testFilletResult(context, result)) {
            result = null;
          }
          return result;
        }
        function getDogboneResult(context, filletCenter) {
          var result = {
            filletAngle: MakerJs2.angle.ofPointInDegrees(filletCenter, context.shardPoint),
            clipPath: function() {
              context.path[context.propertyName] = context.shardPoint;
            }
          };
          if (!testFilletResult(context, result)) {
            result = null;
          }
          return result;
        }
        function testFilletResult(context, result) {
          var test = false;
          if (result) {
            var originalValue = context.path[context.propertyName];
            result.clipPath();
            if (MakerJs2.measure.pathLength(context.path) > 0) {
              test = true;
            }
            context.path[context.propertyName] = originalValue;
          }
          return test;
        }
        function getLineRatio(lines) {
          var totalLength = 0;
          var lengths = [];
          for (var i = 0; i < lines.length; i++) {
            var length = MakerJs2.measure.pathLength(lines[i]);
            lengths.push(length);
            totalLength += length;
          }
          return lengths[0] / totalLength;
        }
        function dogbone(lineA, lineB, filletRadius, options) {
          if (MakerJs2.isPathLine(lineA) && MakerJs2.isPathLine(lineB) && filletRadius && filletRadius > 0) {
            var opts = {
              pointMatchingDistance: 5e-3
            };
            MakerJs2.extendObject(opts, options);
            var commonProperty = getMatchingPointProperties(lineA, lineB, options);
            if (commonProperty) {
              var ratio = getLineRatio([lineA, lineB]);
              var span = new MakerJs2.paths.Line(commonProperty[0].oppositePoint, commonProperty[1].oppositePoint);
              var midRatioPoint = MakerJs2.point.middle(span, ratio);
              var bisectionAngle = MakerJs2.angle.ofPointInDegrees(commonProperty[0].point, midRatioPoint);
              var center = MakerJs2.point.add(commonProperty[0].point, MakerJs2.point.fromPolar(MakerJs2.angle.toRadians(bisectionAngle), filletRadius));
              if (!populateShardPointsFromReferenceCircle(filletRadius, center, commonProperty, opts)) {
                return null;
              }
              var results = [];
              for (var i = 0; i < 2; i++) {
                var result = getDogboneResult(commonProperty[i], center);
                if (!result) {
                  return null;
                }
                results.push(result);
              }
              var filletArc = new MakerJs2.paths.Arc(center, filletRadius, results[0].filletAngle, results[1].filletAngle);
              if (MakerJs2.round(MakerJs2.angle.noRevolutions(MakerJs2.angle.ofArcMiddle(filletArc))) == MakerJs2.round(bisectionAngle)) {
                filletArc.startAngle = results[1].filletAngle;
                filletArc.endAngle = results[0].filletAngle;
              }
              results[0].clipPath();
              results[1].clipPath();
              return filletArc;
            }
          }
          return null;
        }
        path2.dogbone = dogbone;
        function fillet(pathA, pathB, filletRadius, options) {
          if (pathA && pathB && filletRadius && filletRadius > 0) {
            var opts = {
              pointMatchingDistance: 5e-3
            };
            MakerJs2.extendObject(opts, options);
            var commonProperty = getMatchingPointProperties(pathA, pathB, options);
            if (commonProperty) {
              if (!populateShardPointsFromReferenceCircle(filletRadius, commonProperty[0].point, commonProperty, opts)) {
                return null;
              }
              var guidePaths = [];
              for (var i = 0; i < 2; i++) {
                var otherPathShardPoint = commonProperty[1 - i].shardPoint;
                if (!otherPathShardPoint) {
                  return null;
                }
                var guidePath = getGuidePath(commonProperty[i], filletRadius, otherPathShardPoint);
                guidePaths.push(guidePath);
              }
              var intersectionPoint = path2.intersection(guidePaths[0], guidePaths[1]);
              if (intersectionPoint) {
                var center;
                if (intersectionPoint.intersectionPoints.length == 1) {
                  center = intersectionPoint.intersectionPoints[0];
                } else {
                  center = MakerJs2.point.closest(commonProperty[0].point, intersectionPoint.intersectionPoints);
                }
                var results = [];
                for (var i = 0; i < 2; i++) {
                  var result = getFilletResult(commonProperty[i], filletRadius, center);
                  if (!result) {
                    return null;
                  }
                  results.push(result);
                }
                if (MakerJs2.round(results[0].filletAngle - results[1].filletAngle) == 0)
                  return null;
                var filletArc = new MakerJs2.paths.Arc(center, filletRadius, results[0].filletAngle, results[1].filletAngle);
                var filletSpan = MakerJs2.angle.ofArcSpan(filletArc);
                if (filletSpan == 180) {
                  return null;
                }
                if (filletSpan > 180) {
                  filletArc.startAngle = results[1].filletAngle;
                  filletArc.endAngle = results[0].filletAngle;
                }
                results[0].clipPath();
                results[1].clipPath();
                return filletArc;
              }
            }
          }
          return null;
        }
        path2.fillet = fillet;
      })(path = MakerJs2.path || (MakerJs2.path = {}));
    })(MakerJs || (MakerJs = {}));
    (function(MakerJs2) {
      var chain;
      (function(chain2) {
        function dogbone(chainToFillet, filletSpec) {
          return chainFillet(false, chainToFillet, filletSpec);
        }
        chain2.dogbone = dogbone;
        function fillet(chainToFillet, filletSpec) {
          return chainFillet(true, chainToFillet, filletSpec);
        }
        chain2.fillet = fillet;
        function chainFillet(traditional, chainToFillet, filletSpec) {
          var result = { paths: {} };
          var added = 0;
          var links = chainToFillet.links;
          function add(i1, i2) {
            var p1 = links[i1].walkedPath, p2 = links[i2].walkedPath;
            if (p1.modelContext === p2.modelContext && p1.modelContext.type == MakerJs2.models.BezierCurve.typeName)
              return;
            MakerJs2.path.moveTemporary([p1.pathContext, p2.pathContext], [p1.offset, p2.offset], function() {
              var filletRadius;
              if (MakerJs2.isObject(filletSpec)) {
                var a2 = MakerJs2.angle.ofChainLinkJoint(links[i1], links[i2]);
                if (MakerJs2.round(a2) === 0)
                  return;
                filletRadius = a2 > 0 ? filletSpec.left : filletSpec.right;
              } else {
                filletRadius = filletSpec;
              }
              if (!filletRadius || filletRadius < 0)
                return;
              var filletArc;
              if (traditional) {
                filletArc = MakerJs2.path.fillet(p1.pathContext, p2.pathContext, filletRadius);
              } else {
                filletArc = MakerJs2.path.dogbone(p1.pathContext, p2.pathContext, filletRadius);
              }
              if (filletArc) {
                result.paths["fillet" + added] = filletArc;
                added++;
              }
            });
          }
          for (var i = 1; i < links.length; i++) {
            add(i - 1, i);
          }
          if (chainToFillet.endless) {
            add(i - 1, 0);
          }
          if (!added)
            return null;
          return result;
        }
      })(chain = MakerJs2.chain || (MakerJs2.chain = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var kit;
      (function(kit2) {
        function construct(ctor, args) {
          function F2() {
            return ctor.apply(this, args);
          }
          F2.prototype = ctor.prototype;
          return new F2();
        }
        kit2.construct = construct;
        function getParameterValues(ctor) {
          var parameters = [];
          var metaParams = ctor.metaParameters;
          if (metaParams) {
            for (var i = 0; i < metaParams.length; i++) {
              var value = metaParams[i].value;
              if (Array.isArray(value)) {
                value = value[0];
              }
              parameters.push(value);
            }
          }
          return parameters;
        }
        kit2.getParameterValues = getParameterValues;
      })(kit = MakerJs2.kit || (MakerJs2.kit = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var model;
      (function(model2) {
        function getOpposedLink(linkedPaths, pathContext) {
          if (linkedPaths[0].walkedPath.pathContext === pathContext) {
            return linkedPaths[1];
          }
          return linkedPaths[0];
        }
        function followLinks(pointGraph, chainFound, chainNotFound) {
          function followLink(currLink, chain, firstLink) {
            while (currLink) {
              chain.links.push(currLink);
              chain.pathLength += currLink.pathLength;
              var next = currLink.reversed ? 0 : 1;
              var nextPoint = currLink.endPoints[next];
              var nextEl = pointGraph.getElementAtPoint(nextPoint);
              if (!nextEl || nextEl.valueIds.length === 0) {
                break;
              }
              var items = nextEl.valueIds.map(function(valueIndex) {
                return pointGraph.values[valueIndex];
              });
              var nextLink = getOpposedLink(items, currLink.walkedPath.pathContext);
              nextEl.valueIds.splice(0, 2);
              if (!nextLink) {
                break;
              }
              if (nextLink.walkedPath.pathContext === firstLink.walkedPath.pathContext) {
                if (chain.links.length > 1) {
                  chain.endless = true;
                }
                break;
              }
              currLink = nextLink;
            }
          }
          pointGraph.forEachPoint(function(p2, values, pointId, el) {
            if (el.valueIds.length > 0) {
              var chain = {
                links: [],
                pathLength: 0
              };
              followLink(values[0], chain, values[0]);
              if (chain.endless) {
                chainFound(chain, false);
              } else {
                chain.links.reverse();
                var firstLink = chain.links[0];
                chain.links.map(function(link) {
                  link.reversed = !link.reversed;
                });
                chain.pathLength -= chain.links[chain.links.length - 1].pathLength;
                var currLink = chain.links.pop();
                followLink(currLink, chain, firstLink);
                if (chain.links.length > 1) {
                  chainFound(chain, true);
                } else {
                  chainNotFound(chain.links[0].walkedPath);
                }
              }
            }
          });
        }
        function findSingleChain(modelContext) {
          var singleChain = null;
          findChains(modelContext, function(chains, loose, layer) {
            singleChain = chains[0];
          }, { byLayers: false });
          return singleChain;
        }
        model2.findSingleChain = findSingleChain;
        function linkEndpoint(link, beginning) {
          var index = beginning === link.reversed ? 1 : 0;
          return link.endPoints[index];
        }
        function findChains(modelContext) {
          var args = [];
          for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
          }
          var options;
          var callback;
          switch (args.length) {
            case 1:
              if (typeof args[0] === "function") {
                callback = args[0];
              } else {
                options = args[0];
              }
              break;
            case 2:
              callback = args[0];
              options = args[1];
              break;
          }
          var opts = {
            pointMatchingDistance: 5e-3
          };
          MakerJs2.extendObject(opts, options);
          var pointGraphsByLayer = {};
          var chainsByLayer = {};
          var ignored = {};
          var walkOptions = {
            onPath: function(walkedPath) {
              var layer = opts.byLayers ? walkedPath.layer : "";
              if (!pointGraphsByLayer[layer]) {
                pointGraphsByLayer[layer] = new MakerJs2.PointGraph();
              }
              var pointGraph = pointGraphsByLayer[layer];
              var pathLength = MakerJs2.measure.pathLength(walkedPath.pathContext);
              if (walkedPath.pathContext.type === MakerJs2.pathType.Circle || walkedPath.pathContext.type === MakerJs2.pathType.Arc && MakerJs2.round(MakerJs2.angle.ofArcSpan(walkedPath.pathContext) - 360) === 0 || walkedPath.pathContext.type === MakerJs2.pathType.BezierSeed && MakerJs2.measure.isPointEqual(walkedPath.pathContext.origin, walkedPath.pathContext.end, opts.pointMatchingDistance)) {
                var chain = {
                  links: [{
                    walkedPath,
                    reversed: null,
                    endPoints: null,
                    pathLength
                  }],
                  endless: true,
                  pathLength
                };
                if (!chainsByLayer[layer]) {
                  chainsByLayer[layer] = [];
                }
                chainsByLayer[layer].push(chain);
              } else {
                if (pathLength < opts.pointMatchingDistance / 5) {
                  if (!ignored[layer]) {
                    ignored[layer] = [];
                  }
                  ignored[layer].push(walkedPath);
                  return;
                }
                var endPoints = MakerJs2.point.fromPathEnds(walkedPath.pathContext, walkedPath.offset);
                for (var i = 0; i < 2; i++) {
                  var link = {
                    walkedPath,
                    endPoints,
                    reversed: i != 0,
                    pathLength
                  };
                  var valueId = pointGraph.insertValue(link);
                  pointGraph.insertValueIdAtPoint(valueId, endPoints[i]);
                }
              }
            }
          };
          if (opts.shallow) {
            walkOptions.beforeChildWalk = function() {
              return false;
            };
          }
          var beziers;
          if (opts.unifyBeziers) {
            beziers = getBezierModels(modelContext);
            swapBezierPathsWithSeeds(beziers, true, opts.pointMatchingDistance);
          }
          model2.walk(modelContext, walkOptions);
          var _loop_3 = function(layer_22) {
            var pointGraph = pointGraphsByLayer[layer_22];
            pointGraph.mergeNearestSinglePoints(opts.pointMatchingDistance);
            loose = [];
            if (!chainsByLayer[layer_22]) {
              chainsByLayer[layer_22] = [];
            }
            followLinks(pointGraph, function(chain, checkEndless) {
              if (checkEndless) {
                chain.endless = MakerJs2.measure.isPointEqual(linkEndpoint(chain.links[0], true), linkEndpoint(chain.links[chain.links.length - 1], false), opts.pointMatchingDistance);
              } else {
                chain.endless = !!chain.endless;
              }
              chainsByLayer[layer_22].push(chain);
            }, function(walkedPath) {
              loose.push(walkedPath);
            });
            chainsByLayer[layer_22].sort(function(a2, b2) {
              return b2.pathLength - a2.pathLength;
            });
            if (opts.contain) {
              containChainsOptions = MakerJs2.isObject(opts.contain) ? opts.contain : { alternateDirection: false };
              containedChains = getContainment(chainsByLayer[layer_22], containChainsOptions);
              chainsByLayer[layer_22] = containedChains;
            }
            if (callback)
              callback(chainsByLayer[layer_22], loose, layer_22, ignored[layer_22]);
          };
          var loose, containChainsOptions, containedChains;
          for (var layer_2 in pointGraphsByLayer) {
            _loop_3(layer_2);
          }
          if (beziers) {
            swapBezierPathsWithSeeds(beziers, false, opts.pointMatchingDistance);
          }
          if (opts.byLayers) {
            return chainsByLayer;
          } else {
            return chainsByLayer[""];
          }
        }
        model2.findChains = findChains;
        function getContainment(allChains, opts) {
          var chainsAsModels = allChains.map(function(c2) {
            return MakerJs2.chain.toNewModel(c2);
          });
          var parents = [];
          allChains.forEach(function(chainContext, i1) {
            if (!chainContext.endless)
              return;
            var wp = chainContext.links[0].walkedPath;
            var firstPath = MakerJs2.path.clone(wp.pathContext, wp.offset);
            allChains.forEach(function(otherChain, i2) {
              if (chainContext === otherChain)
                return;
              if (!otherChain.endless)
                return;
              if (MakerJs2.measure.isPointInsideModel(MakerJs2.point.middle(firstPath), chainsAsModels[i2])) {
                parents[i1] = otherChain;
              }
            });
          });
          var result = [];
          allChains.forEach(function(chainContext, i) {
            var parent = parents[i];
            if (!parent) {
              result.push(chainContext);
            } else {
              if (!parent.contains) {
                parent.contains = [];
              }
              parent.contains.push(chainContext);
            }
          });
          if (opts.alternateDirection) {
            let alternate2 = function(chains, shouldBeClockwise) {
              chains.forEach(function(chainContext, i) {
                var isClockwise = MakerJs2.measure.isChainClockwise(chainContext);
                if (isClockwise !== null) {
                  if (!isClockwise && shouldBeClockwise || isClockwise && !shouldBeClockwise) {
                    MakerJs2.chain.reverse(chainContext);
                  }
                }
                if (chainContext.contains) {
                  alternate2(chainContext.contains, !shouldBeClockwise);
                }
              });
            };
            var alternate = alternate2;
            alternate2(result, true);
          }
          return result;
        }
        function getBezierModels(modelContext) {
          var beziers = [];
          function checkIsBezier(wm) {
            if (wm.childModel.type === MakerJs2.models.BezierCurve.typeName) {
              beziers.push(wm);
            }
          }
          var options = {
            beforeChildWalk: function(walkedModel) {
              checkIsBezier(walkedModel);
              return true;
            }
          };
          var rootModel = {
            childId: "",
            childModel: modelContext,
            layer: modelContext.layer,
            offset: modelContext.origin,
            parentModel: null,
            route: [],
            routeKey: ""
          };
          checkIsBezier(rootModel);
          model2.walk(modelContext, options);
          return beziers;
        }
        function swapBezierPathsWithSeeds(beziers, swap, pointMatchingDistance) {
          var tempKey = "tempPaths";
          var tempLayerKey = "tempLayer";
          beziers.forEach(function(wm) {
            var b2 = wm.childModel;
            if (swap) {
              if (wm.layer != void 0 && wm.layer !== "") {
                b2[tempLayerKey] = b2.layer;
                b2.layer = wm.layer;
              }
              var bezierPartsByLayer = MakerJs2.models.BezierCurve.getBezierSeeds(b2, { byLayers: true, pointMatchingDistance });
              for (var layer in bezierPartsByLayer) {
                var bezierSeeds = bezierPartsByLayer[layer];
                if (bezierSeeds.length > 0) {
                  b2[tempKey] = b2.paths;
                  var newPaths = {};
                  bezierSeeds.forEach(function(seed, i) {
                    seed.layer = layer;
                    newPaths["seed_" + i] = seed;
                  });
                  b2.paths = newPaths;
                }
              }
            } else {
              if (tempKey in b2) {
                b2.paths = b2[tempKey];
                delete b2[tempKey];
              }
              if (tempLayerKey in b2) {
                if (b2[tempLayerKey] == void 0) {
                  delete b2.layer;
                } else {
                  b2.layer = b2[tempLayerKey];
                }
                delete b2[tempLayerKey];
              }
            }
          });
        }
      })(model = MakerJs2.model || (MakerJs2.model = {}));
    })(MakerJs || (MakerJs = {}));
    (function(MakerJs2) {
      var chain;
      (function(chain2) {
        function cycle(chainContext, amount) {
          if (amount === void 0) {
            amount = 1;
          }
          if (!chainContext.endless)
            return;
          var n = Math.abs(amount);
          for (var i = 0; i < n; i++) {
            if (amount < 0) {
              chainContext.links.push(chainContext.links.shift());
            } else {
              chainContext.links.unshift(chainContext.links.pop());
            }
          }
          return chainContext;
        }
        chain2.cycle = cycle;
        function reverse(chainContext) {
          chainContext.links.reverse();
          chainContext.links.forEach(function(link) {
            return link.reversed = !link.reversed;
          });
          return chainContext;
        }
        chain2.reverse = reverse;
        function startAt(chainContext, routeKey) {
          if (!chainContext.endless)
            return;
          var index = -1;
          for (var i = 0; i < chainContext.links.length; i++) {
            if (chainContext.links[i].walkedPath.routeKey == routeKey) {
              index = i;
              break;
            }
          }
          if (index > 0) {
            cycle(chainContext, index);
          }
          return chainContext;
        }
        chain2.startAt = startAt;
        function toNewModel(chainContext, detachFromOldModel) {
          if (detachFromOldModel === void 0) {
            detachFromOldModel = false;
          }
          var result = { paths: {} };
          for (var i = 0; i < chainContext.links.length; i++) {
            var wp = chainContext.links[i].walkedPath;
            if (wp.pathContext.type === MakerJs2.pathType.BezierSeed) {
              if (detachFromOldModel) {
                delete wp.modelContext.paths[wp.pathId];
              }
              if (!result.models) {
                result.models = {};
              }
              var modelId = MakerJs2.model.getSimilarModelId(result, wp.pathId);
              result.models[modelId] = MakerJs2.model.moveRelative(new MakerJs2.models.BezierCurve(wp.pathContext), wp.offset);
            } else {
              var newPath;
              if (detachFromOldModel) {
                newPath = wp.pathContext;
                delete wp.modelContext.paths[wp.pathId];
              } else {
                newPath = MakerJs2.path.clone(wp.pathContext);
              }
              var pathId = MakerJs2.model.getSimilarPathId(result, wp.pathId);
              result.paths[pathId] = MakerJs2.path.moveRelative(newPath, wp.offset);
            }
          }
          return result;
        }
        chain2.toNewModel = toNewModel;
        function removeDuplicateEnds(endless, points) {
          if (!endless || points.length < 2)
            return;
          if (MakerJs2.measure.isPointEqual(points[0], points[points.length - 1], 1e-5)) {
            points.pop();
          }
        }
        function toPoints(chainContext, distanceOrDistances, maxPoints) {
          var result = [];
          var di = 0;
          var t2 = 0;
          var distanceArray;
          if (Array.isArray(distanceOrDistances)) {
            distanceArray = distanceOrDistances;
          }
          for (var i = 0; i < chainContext.links.length; i++) {
            var link = chainContext.links[i];
            var wp = link.walkedPath;
            var len = link.pathLength;
            while (MakerJs2.round(len - t2) > 0) {
              var r2 = t2 / len;
              if (link.reversed) {
                r2 = 1 - r2;
              }
              result.push(MakerJs2.point.add(MakerJs2.point.middle(wp.pathContext, r2), wp.offset));
              if (maxPoints && result.length >= maxPoints)
                return result;
              var distance;
              if (distanceArray) {
                distance = distanceArray[di];
                di++;
                if (di > distanceArray.length) {
                  return result;
                }
              } else {
                distance = distanceOrDistances;
              }
              t2 += distance;
            }
            t2 -= len;
          }
          removeDuplicateEnds(chainContext.endless, result);
          return result;
        }
        chain2.toPoints = toPoints;
        function toKeyPoints(chainContext, maxArcFacet) {
          var result = [];
          for (var i = 0; i < chainContext.links.length; i++) {
            var link = chainContext.links[i];
            var wp = link.walkedPath;
            var keyPoints = MakerJs2.path.toKeyPoints(wp.pathContext, maxArcFacet);
            if (keyPoints.length > 0) {
              if (link.reversed) {
                keyPoints.reverse();
              }
              if (i > 0) {
                keyPoints.shift();
              }
              var offsetPathPoints = keyPoints.map(function(p2) {
                return MakerJs2.point.add(p2, wp.offset);
              });
              result.push.apply(result, offsetPathPoints);
            }
          }
          removeDuplicateEnds(chainContext.endless, result);
          return result;
        }
        chain2.toKeyPoints = toKeyPoints;
      })(chain = MakerJs2.chain || (MakerJs2.chain = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var model;
      (function(model2) {
        var DeadEndFinder = (
          /** @class */
          (function() {
            function DeadEndFinder2(modelContext, options) {
              this.modelContext = modelContext;
              this.options = options;
              this.pointMap = new MakerJs2.PointGraph();
              this.list = [];
              this.removed = [];
              this.ordinals = {};
              this.load();
            }
            DeadEndFinder2.prototype.load = function() {
              var _this = this;
              var walkOptions = {
                onPath: function(walkedPath) {
                  var endPoints = MakerJs2.point.fromPathEnds(walkedPath.pathContext, walkedPath.offset);
                  if (!endPoints)
                    return;
                  var pathRef = walkedPath;
                  pathRef.endPoints = endPoints;
                  var valueId = _this.pointMap.insertValue(pathRef);
                  for (var i = 2; i--; ) {
                    _this.pointMap.insertValueIdAtPoint(valueId, endPoints[i]);
                  }
                }
              };
              model2.walk(this.modelContext, walkOptions);
              if (this.options.pointMatchingDistance) {
                this.pointMap.mergePoints(this.options.pointMatchingDistance);
              }
            };
            DeadEndFinder2.prototype.findDeadEnds = function() {
              var _this = this;
              var i = 0;
              this.pointMap.forEachPoint(function(p2, values, pointId, el) {
                _this.ordinals[pointId] = i++;
                _this.list.push(el);
              });
              i = 0;
              var _loop_4 = function() {
                var el = this_2.list[i];
                if (el.valueIds.length === 1) {
                  this_2.removePath(el, el.valueIds[0], i);
                } else if (this_2.options.keep && el.valueIds.length % 2) {
                  el.valueIds.forEach(function(valueId) {
                    var value = _this.pointMap.values[valueId];
                    if (!_this.options.keep(value)) {
                      _this.removePath(el, valueId, i);
                    }
                  });
                }
                i++;
              };
              var this_2 = this;
              while (i < this.list.length) {
                _loop_4();
              }
              return this.removed;
            };
            DeadEndFinder2.prototype.removePath = function(el, valueId, current) {
              var value = this.pointMap.values[valueId];
              var otherPointId = this.getOtherPointId(value.endPoints, el.pointId);
              var otherElement = this.pointMap.index[otherPointId];
              this.removed.push(value);
              this.removeValue(el, valueId);
              this.removeValue(otherElement, valueId);
              if (otherElement.valueIds.length > 0) {
                this.appendQueue(otherElement, current);
              }
            };
            DeadEndFinder2.prototype.removeValue = function(el, valueId) {
              var pos = el.valueIds.indexOf(valueId);
              if (pos >= 0) {
                el.valueIds.splice(pos, 1);
              }
            };
            DeadEndFinder2.prototype.appendQueue = function(el, current) {
              var otherOrdinal = this.ordinals[el.pointId];
              if (otherOrdinal < current) {
                this.list[otherOrdinal] = null;
                this.list.push(el);
                this.ordinals[el.pointId] = this.list.length;
              }
            };
            DeadEndFinder2.prototype.getOtherPointId = function(endPoints, pointId) {
              for (var i = 0; i < endPoints.length; i++) {
                var id = this.pointMap.getIdOfPoint(endPoints[i]);
                if (pointId !== id) {
                  return id;
                }
              }
            };
            return DeadEndFinder2;
          })()
        );
        function removeDeadEnds(modelContext, pointMatchingDistance, keep, trackDeleted) {
          var options = {
            pointMatchingDistance: pointMatchingDistance || 5e-3,
            keep
          };
          var deadEndFinder = new DeadEndFinder(modelContext, options);
          var removed = deadEndFinder.findDeadEnds();
          if (removed.length < deadEndFinder.pointMap.values.length) {
            removed.forEach(function(wp) {
              trackDeleted(wp, "dead end");
              delete wp.modelContext.paths[wp.pathId];
            });
          }
          return modelContext;
        }
        model2.removeDeadEnds = removeDeadEnds;
      })(model = MakerJs2.model || (MakerJs2.model = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var exporter;
      (function(exporter2) {
        var XmlTag = (
          /** @class */
          (function() {
            function XmlTag2(name, attrs) {
              this.name = name;
              this.attrs = attrs;
              this.innerText = "";
            }
            XmlTag2.escapeString = function(value) {
              var escape = {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;"
              };
              for (var code in escape) {
                value = value.split(code).join(escape[code]);
              }
              return value;
            };
            XmlTag2.prototype.getOpeningTag = function(selfClose) {
              var attrs = "";
              function outputAttr(attrName, attrValue) {
                if (attrValue == null || typeof attrValue === "undefined")
                  return;
                if (Array.isArray(attrValue) || typeof attrValue === "object") {
                  attrValue = JSON.stringify(attrValue);
                }
                if (typeof attrValue === "string") {
                  attrValue = XmlTag2.escapeString(attrValue);
                }
                attrs += " " + attrName + '="' + attrValue + '"';
              }
              for (var name in this.attrs) {
                outputAttr(name, this.attrs[name]);
              }
              return "<" + this.name + attrs + (selfClose ? "/" : "") + ">";
            };
            XmlTag2.prototype.getInnerText = function() {
              if (this.innerTextEscaped) {
                return this.innerText;
              } else {
                return XmlTag2.escapeString(this.innerText);
              }
            };
            XmlTag2.prototype.getClosingTag = function() {
              return "</" + this.name + ">";
            };
            XmlTag2.prototype.toString = function() {
              var selfClose = !this.innerText;
              if (selfClose && !this.closingTags) {
                return this.getOpeningTag(true);
              } else {
                return this.getOpeningTag(false) + this.getInnerText() + this.getClosingTag();
              }
            };
            return XmlTag2;
          })()
        );
        exporter2.XmlTag = XmlTag;
      })(exporter = MakerJs2.exporter || (MakerJs2.exporter = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var exporter;
      (function(exporter2) {
        function wrap(prefix, content, condition) {
          if (condition) {
            return prefix + "(" + content + ")";
          } else {
            return content;
          }
        }
        function facetSizeToResolution(arcOrCircle, facetSize) {
          if (!facetSize)
            return;
          var circle2 = new MakerJs2.paths.Circle([0, 0], arcOrCircle.radius);
          var length = MakerJs2.measure.pathLength(circle2);
          if (!length)
            return;
          return Math.ceil(length / facetSize);
        }
        function chainToJscadScript(chainContext, facetSize, accuracy) {
          var head = "";
          var tail = "";
          var first = true;
          var exit = false;
          var reverseTail = false;
          var beginMap = {};
          beginMap[MakerJs2.pathType.Circle] = function(circle2, link2) {
            var circleOptions = {
              center: MakerJs2.point.rounded(MakerJs2.point.add(circle2.origin, link2.walkedPath.offset), accuracy),
              radius: MakerJs2.round(circle2.radius, accuracy),
              resolution: facetSizeToResolution(circle2, facetSize)
            };
            head = wrap("CAG.circle", JSON.stringify(circleOptions), true);
            exit = true;
          };
          beginMap[MakerJs2.pathType.Line] = function(line2, link2) {
            var points = link2.endPoints.map(function(p2) {
              return MakerJs2.point.rounded(p2, accuracy);
            });
            if (link2.reversed) {
              points.reverse();
            }
            head = wrap("new CSG.Path2D", JSON.stringify(points), true);
          };
          beginMap[MakerJs2.pathType.Arc] = function(arc, link2) {
            var endAngle = MakerJs2.angle.ofArcEnd(arc);
            if (link2.reversed) {
              reverseTail = true;
            }
            var arcOptions = {
              center: MakerJs2.point.rounded(MakerJs2.point.add(arc.origin, link2.walkedPath.offset), accuracy),
              radius: MakerJs2.round(arc.radius, accuracy),
              startangle: MakerJs2.round(arc.startAngle, accuracy),
              endangle: MakerJs2.round(endAngle, accuracy),
              resolution: facetSizeToResolution(arc, facetSize)
            };
            head = wrap("new CSG.Path2D.arc", JSON.stringify(arcOptions), true);
          };
          var appendMap = {};
          appendMap[MakerJs2.pathType.Line] = function(line2, link2) {
            var reverse = reverseTail != link2.reversed;
            var endPoint = MakerJs2.point.rounded(link2.endPoints[reverse ? 0 : 1], accuracy);
            append(wrap(".appendPoint", JSON.stringify(endPoint), true));
          };
          appendMap[MakerJs2.pathType.Arc] = function(arc, link2) {
            var reverse = reverseTail != link2.reversed;
            var endAngle = MakerJs2.angle.ofArcEnd(arc);
            var arcOptions = {
              radius: MakerJs2.round(arc.radius, accuracy),
              clockwise: reverse,
              large: Math.abs(endAngle - arc.startAngle) > 180,
              resolution: facetSizeToResolution(arc, facetSize)
            };
            var endPoint = MakerJs2.point.rounded(link2.endPoints[reverse ? 0 : 1], accuracy);
            append(wrap(".appendArc", JSON.stringify(endPoint) + "," + JSON.stringify(arcOptions), true));
          };
          function append(s2) {
            if (reverseTail) {
              tail = s2 + tail;
            } else {
              tail += s2;
            }
          }
          for (var i = 0; i < chainContext.links.length; i++) {
            var link = chainContext.links[i];
            var pathContext = link.walkedPath.pathContext;
            var fn = first ? beginMap[pathContext.type] : appendMap[pathContext.type];
            if (fn) {
              fn(pathContext, link);
            }
            if (exit) {
              return head;
            }
            first = false;
          }
          return head + tail + ".close().innerToCAG()";
        }
        function makePhasedCallback(originalCb, phaseStart, phaseSpan) {
          return function statusCallback(status) {
            originalCb && originalCb({ progress: phaseStart + status.progress * phaseSpan / 100 });
          };
        }
        function toJscadCAG(jscadCAG, modelToExport, jsCadCagOptions) {
          function chainToJscadCag(c2, maxArcFacet) {
            var keyPoints = MakerJs2.chain.toKeyPoints(c2, maxArcFacet);
            keyPoints.push(keyPoints[0]);
            return jscadCAG.fromPoints(keyPoints);
          }
          function jscadCagUnion(augend, addend) {
            return augend.union(addend);
          }
          function jscadCagSubtraction(minuend, subtrahend) {
            return minuend.subtract(subtrahend);
          }
          return convertChainsTo2D(chainToJscadCag, jscadCagUnion, jscadCagSubtraction, modelToExport, jsCadCagOptions);
        }
        exporter2.toJscadCAG = toJscadCAG;
        function convertChainsTo2D(convertToT, union, subtraction, modelToExport, jsCadCagOptions) {
          if (jsCadCagOptions === void 0) {
            jsCadCagOptions = {};
          }
          var adds = {};
          var status = { total: 0, complete: 0 };
          function unionize(phaseStart, phaseSpan, arr) {
            var result = arr.shift();
            arr.forEach(function(el) {
              return result = union(result, el);
            });
            status.complete++;
            jsCadCagOptions.statusCallback && jsCadCagOptions.statusCallback({ progress: phaseStart + phaseSpan * status.complete / status.total });
            return result;
          }
          function subtractChains(layerId2, cs2) {
            var subtracts = [];
            cs2.forEach(function(c2) {
              if (!c2.endless)
                return;
              if (c2.contains) {
                addChains(layerId2, c2.contains);
              }
              status.total++;
              subtracts.unshift(convertToT(c2, jsCadCagOptions.maxArcFacet));
            });
            return subtracts;
          }
          function addChains(layerId2, cs2) {
            cs2.forEach(function(c2) {
              if (!c2.endless)
                return;
              var add = { cag: convertToT(c2, jsCadCagOptions.maxArcFacet), subtracts: [] };
              if (c2.contains) {
                var subtracts = subtractChains(layerId2, c2.contains);
                if (subtracts.length > 0) {
                  add.subtracts.push(subtracts);
                }
              }
              status.total++;
              if (!(layerId2 in adds)) {
                adds[layerId2] = [];
              }
              adds[layerId2].unshift(add);
            });
          }
          var options = {
            pointMatchingDistance: jsCadCagOptions.pointMatchingDistance,
            byLayers: jsCadCagOptions.byLayers,
            contain: true
          };
          jsCadCagOptions.statusCallback && jsCadCagOptions.statusCallback({ progress: 25 });
          var chainsResult = MakerJs2.model.findChains(modelToExport, options);
          if (Array.isArray(chainsResult)) {
            addChains("", chainsResult);
          } else {
            for (var layerId in chainsResult) {
              addChains(layerId, chainsResult[layerId]);
            }
          }
          jsCadCagOptions.statusCallback && jsCadCagOptions.statusCallback({ progress: 50 });
          var closedCount = 0;
          for (var layerId in adds) {
            closedCount += adds[layerId].length;
          }
          if (closedCount === 0) {
            jsCadCagOptions.statusCallback && jsCadCagOptions.statusCallback({ progress: 100 });
            throw "No closed geometries found.";
          }
          var resultMap = {};
          for (var layerId in adds) {
            var flatAdds = adds[layerId].map(function(add) {
              var result = add.cag;
              add.subtracts.forEach(function(subtract) {
                var union2 = unionize(50, 50, subtract);
                result = subtraction(result, union2);
              });
              return result;
            });
            resultMap[layerId] = unionize(50, 50, flatAdds);
          }
          jsCadCagOptions.statusCallback && jsCadCagOptions.statusCallback({ progress: 100 });
          return options.byLayers ? resultMap : resultMap[""];
        }
        function toJscadCSG(jscadCAG, modelToExport, options) {
          function to2D(opts) {
            return toJscadCAG(jscadCAG, modelToExport, opts);
          }
          function to3D(cag, extrude, z2) {
            var csg = cag.extrude({ offset: [0, 0, extrude] });
            if (z2) {
              csg = csg.translate([0, 0, z2]);
            }
            return csg;
          }
          function union3D(augend, addend) {
            return augend.union(addend);
          }
          return convert2Dto3D(to2D, to3D, union3D, modelToExport, options);
        }
        exporter2.toJscadCSG = toJscadCSG;
        function convert2Dto3D(to2D, to3D, union3D, modelToExport, options) {
          if (options === void 0) {
            options = {};
          }
          var originalCb = options.statusCallback;
          function getDefinedNumber(a2, b2) {
            if (MakerJs2.isNumber(a2))
              return a2;
            return b2;
          }
          if (modelToExport.exporterOptions) {
            MakerJs2.extendObject(options, modelToExport.exporterOptions["toJscadCSG"]);
          }
          options.byLayers = options.byLayers || options.layerOptions && true;
          options.statusCallback = makePhasedCallback(originalCb, 0, 50);
          var result2D = to2D(options);
          var csgs = [];
          if (options.byLayers) {
            for (var layerId in result2D) {
              var layerOptions = options.layerOptions[layerId];
              var csg = to3D(result2D[layerId], layerOptions.extrude || options.extrude, getDefinedNumber(layerOptions.z, options.z));
              csgs.push(csg);
            }
          } else {
            var csg = to3D(result2D, options.extrude, options.z);
            csgs.push(csg);
          }
          options.statusCallback = makePhasedCallback(originalCb, 50, 100);
          var status = { total: csgs.length - 1, complete: 0 };
          var result = csgs.shift();
          csgs.forEach(function(el, i) {
            result = union3D(result, el);
            status.complete++;
            options.statusCallback({ progress: status.complete / status.total });
          });
          return result;
        }
        function toJscadScript(modelToExport, options) {
          if (options === void 0) {
            options = {};
          }
          function _chainToJscadScript(c2, maxArcFacet) {
            return wrap2(chainToJscadScript(c2, maxArcFacet, options.accuracy));
          }
          function scriptUnion(augend, addend) {
            return augend + ".union(".concat(addend, ")");
          }
          function scriptSubtraction(minuend, subtrahend) {
            return minuend + ".subtract(".concat(subtrahend, ")");
          }
          function to2D(opts) {
            return convertChainsTo2D(_chainToJscadScript, scriptUnion, scriptSubtraction, modelToExport, options);
          }
          function to3D(cag, extrude, z2) {
            var csg = cag + ".extrude({ offset: [0, 0, ".concat(extrude, "] })");
            if (z2) {
              csg = csg + ".translate([0, 0, ".concat(z2, "])");
            }
            return csg;
          }
          function wrap2(s2) {
            return "".concat(nl).concat(indent).concat(s2).concat(nl);
          }
          var indent = new Array((options.indent || 0) + 1).join(" ");
          var nl = options.indent ? "\n" : "";
          var result = convert2Dto3D(to2D, to3D, scriptUnion, modelToExport, options).trim();
          return "function ".concat(options.functionName || "main", "(){").concat(wrap2("return ".concat(result, ";")), "}").concat(nl);
        }
        exporter2.toJscadScript = toJscadScript;
        function toJscadSTL(CAG, stlSerializer, modelToExport, options) {
          var originalCb = options.statusCallback;
          options.statusCallback = makePhasedCallback(originalCb, 0, 50);
          var csg = toJscadCSG(CAG, modelToExport, options);
          return stlSerializer.serialize(csg, { binary: false, statusCallback: makePhasedCallback(originalCb, 50, 50) });
        }
        exporter2.toJscadSTL = toJscadSTL;
      })(exporter = MakerJs2.exporter || (MakerJs2.exporter = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var exporter;
      (function(exporter2) {
        function toPDF(doc, modelToExport, options) {
          if (!modelToExport)
            return;
          var opts = {
            fontName: "Courier",
            fontSize: 9,
            origin: [0, 0],
            stroke: "#000"
          };
          MakerJs2.extendObject(opts, options);
          var scale = 1;
          var exportUnits = opts.units || modelToExport.units;
          if (exportUnits) {
            scale = MakerJs2.units.conversionScale(exportUnits, MakerJs2.unitType.Inch);
          } else {
            scale = 1 / 100;
          }
          scale *= 72;
          var scaledModel = MakerJs2.model.scale(MakerJs2.cloneObject(modelToExport), scale);
          var size = MakerJs2.measure.modelExtents(scaledModel);
          var left = -size.low[0];
          var offset = [left, size.high[1]];
          offset = MakerJs2.point.add(offset, opts.origin);
          MakerJs2.model.findChains(scaledModel, function(chains, loose, layer) {
            function single(walkedPath) {
              var pathData = exporter2.pathToSVGPathData(walkedPath.pathContext, walkedPath.offset, offset);
              doc.path(pathData).stroke(opts.stroke);
            }
            chains.map(function(chain) {
              if (chain.links.length > 1) {
                var pathData = exporter2.chainToSVGPathData(chain, offset);
                doc.path(pathData).stroke(opts.stroke);
              } else {
                var walkedPath = chain.links[0].walkedPath;
                if (walkedPath.pathContext.type === MakerJs2.pathType.Circle) {
                  var fixedPath;
                  MakerJs2.path.moveTemporary([walkedPath.pathContext], [walkedPath.offset], function() {
                    fixedPath = MakerJs2.path.mirror(walkedPath.pathContext, false, true);
                  });
                  MakerJs2.path.moveRelative(fixedPath, offset);
                  doc.circle(fixedPath.origin[0], fixedPath.origin[1], walkedPath.pathContext.radius).stroke(opts.stroke);
                } else {
                  single(walkedPath);
                }
              }
            });
            loose.map(single);
          }, { byLayers: false });
          doc.font(opts.fontName).fontSize(opts.fontSize);
          MakerJs2.model.getAllCaptionsOffset(scaledModel).forEach(function(caption) {
            var a2 = MakerJs2.angle.ofLineInDegrees(caption.anchor);
            var anchor = MakerJs2.path.mirror(caption.anchor, false, true);
            MakerJs2.path.moveRelative(anchor, offset);
            var text = caption.text;
            var textCenter = [doc.widthOfString(text) / 2, doc.heightOfString(text) / 2];
            var center = MakerJs2.point.middle(anchor);
            var textOffset = MakerJs2.point.subtract(center, textCenter);
            doc.rotate(-a2, { origin: center });
            doc.text(text, textOffset[0], textOffset[1]);
            doc.rotate(a2, { origin: center });
          });
        }
        exporter2.toPDF = toPDF;
      })(exporter = MakerJs2.exporter || (MakerJs2.exporter = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var exporter;
      (function(exporter2) {
        var chainLinkToPathDataMap = {};
        chainLinkToPathDataMap[MakerJs2.pathType.Arc] = function(arc, endPoint, reversed, d2, accuracy) {
          d2.push("A");
          svgArcData(d2, arc.radius, endPoint, accuracy, MakerJs2.angle.ofArcSpan(arc) > 180, reversed ? arc.startAngle > arc.endAngle : arc.startAngle < arc.endAngle);
        };
        chainLinkToPathDataMap[MakerJs2.pathType.Line] = function(line2, endPoint, reversed, d2, accuracy) {
          d2.push("L", MakerJs2.round(endPoint[0], accuracy), MakerJs2.round(endPoint[1], accuracy));
        };
        chainLinkToPathDataMap[MakerJs2.pathType.BezierSeed] = function(seed, endPoint, reversed, d2, accuracy) {
          svgBezierData(d2, seed, accuracy, reversed);
        };
        function svgCoords(p2) {
          return MakerJs2.point.mirror(p2, false, true);
        }
        function correctArc(arc) {
          var arcSpan = MakerJs2.angle.ofArcSpan(arc);
          arc.startAngle = MakerJs2.angle.noRevolutions(arc.startAngle);
          arc.endAngle = arc.startAngle + arcSpan;
        }
        function chainToSVGPathData(c2, offset, accuracy, clockwise) {
          function offsetPoint(p2) {
            return MakerJs2.point.add(p2, offset);
          }
          if (clockwise !== void 0) {
            var isClockwise = MakerJs2.measure.isChainClockwise(c2);
            if (isClockwise !== null && isClockwise !== clockwise) {
              c2 = MakerJs2.cloneObject(c2);
              MakerJs2.chain.reverse(c2);
            }
          }
          var first = c2.links[0];
          var firstPoint = offsetPoint(svgCoords(first.endPoints[first.reversed ? 1 : 0]));
          var d2 = ["M", MakerJs2.round(firstPoint[0], accuracy), MakerJs2.round(firstPoint[1], accuracy)];
          for (var i = 0; i < c2.links.length; i++) {
            var link = c2.links[i];
            var pathContext = link.walkedPath.pathContext;
            var fn = chainLinkToPathDataMap[pathContext.type];
            if (fn) {
              var fixedPath;
              MakerJs2.path.moveTemporary([pathContext], [link.walkedPath.offset], function() {
                fixedPath = MakerJs2.path.mirror(pathContext, false, true);
              });
              MakerJs2.path.moveRelative(fixedPath, offset);
              fn(fixedPath, offsetPoint(svgCoords(link.endPoints[link.reversed ? 0 : 1])), link.reversed, d2, accuracy);
            }
          }
          if (c2.endless) {
            d2.push("Z");
          }
          return d2.join(" ");
        }
        exporter2.chainToSVGPathData = chainToSVGPathData;
        function startSvgPathData(start, d2, accuracy) {
          return ["M", MakerJs2.round(start[0], accuracy), MakerJs2.round(start[1], accuracy)].concat(d2);
        }
        var svgPathDataMap = {};
        svgPathDataMap[MakerJs2.pathType.Line] = function(line2, accuracy) {
          return startSvgPathData(line2.origin, MakerJs2.point.rounded(line2.end, accuracy), accuracy);
        };
        svgPathDataMap[MakerJs2.pathType.Circle] = function(circle2, accuracy, clockwiseCircle) {
          return startSvgPathData(circle2.origin, svgCircleData(circle2.radius, accuracy, clockwiseCircle), accuracy);
        };
        svgPathDataMap[MakerJs2.pathType.Arc] = function(arc, accuracy) {
          correctArc(arc);
          var arcPoints = MakerJs2.point.fromArc(arc);
          if (MakerJs2.measure.isPointEqual(arcPoints[0], arcPoints[1])) {
            return svgPathDataMap[MakerJs2.pathType.Circle](arc, accuracy);
          } else {
            var d2 = ["A"];
            svgArcData(d2, arc.radius, arcPoints[1], accuracy, MakerJs2.angle.ofArcSpan(arc) > 180, arc.startAngle > arc.endAngle);
            return startSvgPathData(arcPoints[0], d2, accuracy);
          }
        };
        svgPathDataMap[MakerJs2.pathType.BezierSeed] = function(seed, accuracy) {
          var d2 = [];
          svgBezierData(d2, seed, accuracy);
          return startSvgPathData(seed.origin, d2, accuracy);
        };
        function pathToSVGPathData(pathToExport, pathOffset, exportOffset, accuracy, clockwiseCircle) {
          var fn = svgPathDataMap[pathToExport.type];
          if (fn) {
            var fixedPath;
            MakerJs2.path.moveTemporary([pathToExport], [pathOffset], function() {
              fixedPath = MakerJs2.path.mirror(pathToExport, false, true);
            });
            MakerJs2.path.moveRelative(fixedPath, exportOffset);
            var d2 = fn(fixedPath, accuracy, clockwiseCircle);
            return d2.join(" ");
          }
          return "";
        }
        exporter2.pathToSVGPathData = pathToSVGPathData;
        function getPathDataByLayer(modelToExport, offset, options, accuracy) {
          var pathDataByLayer = {};
          options.unifyBeziers = true;
          MakerJs2.model.findChains(modelToExport, function(chains, loose, layer) {
            function single(walkedPath, clockwise) {
              var pathData = pathToSVGPathData(walkedPath.pathContext, walkedPath.offset, offset, accuracy, clockwise);
              pathDataByLayer[layer].push(pathData);
            }
            pathDataByLayer[layer] = [];
            function doChains(cs2, clockwise) {
              cs2.forEach(function(c2) {
                if (c2.links.length > 1) {
                  var pathData = chainToSVGPathData(c2, offset, accuracy, clockwise);
                  pathDataByLayer[layer].push(pathData);
                } else {
                  single(c2.links[0].walkedPath, clockwise);
                }
                if (c2.contains) {
                  doChains(c2.contains, !clockwise);
                }
              });
            }
            doChains(chains, true);
            loose.forEach(function(wp) {
              return single(wp);
            });
          }, options);
          return pathDataByLayer;
        }
        function toSVGPathData(modelToExport) {
          var args = [];
          for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
          }
          var options = {
            fillRule: "evenodd"
          };
          if (typeof args[0] === "boolean") {
            options.byLayers = args[0];
            options.origin = args[1];
            options.accuracy = args[2];
          } else if (MakerJs2.isObject(args[0])) {
            MakerJs2.extendObject(options, args[0]);
          }
          var findChainsOptions = {
            byLayers: options.byLayers,
            contain: false
          };
          if (options.fillRule === "nonzero") {
            findChainsOptions.contain = {
              alternateDirection: true
            };
          }
          var size = MakerJs2.measure.modelExtents(modelToExport);
          if (!options.origin) {
            options.origin = [-size.low[0], size.high[1]];
          }
          var pathDataArrayByLayer = getPathDataByLayer(modelToExport, options.origin, findChainsOptions, options.accuracy);
          var pathDataStringByLayer = {};
          for (var layer in pathDataArrayByLayer) {
            pathDataStringByLayer[layer] = pathDataArrayByLayer[layer].join(" ");
          }
          return findChainsOptions.byLayers ? pathDataStringByLayer : pathDataStringByLayer[""];
        }
        exporter2.toSVGPathData = toSVGPathData;
        function toSVG(itemToExport, options) {
          function append(value, layer, forcePush) {
            if (forcePush === void 0) {
              forcePush = false;
            }
            if (!forcePush && typeof layer == "string" && layer.length > 0) {
              if (!(layer in layers)) {
                layers[layer] = [];
              }
              layers[layer].push(value);
            } else {
              elements.push(value);
            }
          }
          function cssStyle(elOpts) {
            var a2 = [];
            function push(name, val) {
              if (val === void 0)
                return;
              a2.push(name + ":" + val);
            }
            push("stroke", elOpts.stroke);
            push("stroke-width", elOpts.strokeWidth);
            push("fill", elOpts.fill);
            return a2.join(";");
          }
          function addSvgAttrs(attrs2, elOpts) {
            if (!elOpts)
              return;
            MakerJs2.extendObject(attrs2, {
              "stroke": elOpts.stroke,
              "stroke-width": elOpts.strokeWidth,
              "fill": elOpts.fill,
              "style": elOpts.cssStyle || cssStyle(elOpts),
              "class": elOpts.className
            });
          }
          function colorLayerOptions(layer) {
            if (opts.layerOptions && opts.layerOptions[layer])
              return opts.layerOptions[layer];
            if (layer in exporter2.colors) {
              return {
                stroke: layer
              };
            }
          }
          function createElement(tagname, attrs2, layer, innerText, forcePush) {
            if (innerText === void 0) {
              innerText = null;
            }
            if (forcePush === void 0) {
              forcePush = false;
            }
            if (tagname !== "text") {
              addSvgAttrs(attrs2, colorLayerOptions(layer));
            }
            if (!opts.scalingStroke) {
              attrs2["vector-effect"] = "non-scaling-stroke";
            }
            var tag = new exporter2.XmlTag(tagname, attrs2);
            tag.closingTags = opts.closingTags;
            if (innerText) {
              tag.innerText = innerText;
            }
            append(tag.toString(), layer, forcePush);
          }
          function fixPoint(pointToFix) {
            var pointMirroredY = svgCoords(pointToFix);
            return MakerJs2.point.scale(pointMirroredY, opts.scale);
          }
          function fixPath(pathToFix, origin) {
            var mirrorY = MakerJs2.path.mirror(pathToFix, false, true);
            return MakerJs2.path.moveRelative(MakerJs2.path.scale(mirrorY, opts.scale), origin);
          }
          var opts = {
            accuracy: 1e-3,
            annotate: false,
            origin: null,
            scale: 1,
            stroke: "#000",
            strokeLineCap: "round",
            strokeWidth: "0.25mm",
            fill: "none",
            fillRule: "evenodd",
            fontSize: "9pt",
            useSvgPathOnly: true,
            viewBox: true
          };
          MakerJs2.extendObject(opts, options);
          var modelToExport;
          var itemToExportIsModel = MakerJs2.isModel(itemToExport);
          if (itemToExportIsModel) {
            modelToExport = itemToExport;
            if (modelToExport.exporterOptions) {
              MakerJs2.extendObject(opts, modelToExport.exporterOptions["toSVG"]);
            }
          }
          var elements = [];
          var layers = {};
          if (itemToExportIsModel) {
            modelToExport = itemToExport;
          } else if (Array.isArray(itemToExport)) {
            var pathMap = {};
            itemToExport.forEach(function(p2, i2) {
              pathMap[i2] = p2;
            });
            modelToExport = { paths: pathMap };
          } else if (MakerJs2.isPath(itemToExport)) {
            modelToExport = { paths: { modelToMeasure: itemToExport } };
          }
          var size = MakerJs2.measure.modelExtents(modelToExport);
          var captions = MakerJs2.model.getAllCaptionsOffset(modelToExport);
          captions.forEach(function(caption) {
            MakerJs2.measure.increase(size, MakerJs2.measure.pathExtents(caption.anchor), true);
          });
          if (!opts.units) {
            var unitSystem = exporter2.tryGetModelUnits(itemToExport);
            if (unitSystem) {
              opts.units = unitSystem;
            }
          }
          var useSvgUnit = exporter2.svgUnit[opts.units];
          if (useSvgUnit && opts.viewBox) {
            opts.scale *= useSvgUnit.scaleConversion;
          }
          if (size && !opts.origin) {
            var left = -size.low[0] * opts.scale;
            opts.origin = [left, size.high[1] * opts.scale];
          }
          MakerJs2.extendObject(options, opts);
          var svgAttrs = {};
          if (size && opts.viewBox) {
            var width = MakerJs2.round(size.width * opts.scale, opts.accuracy);
            var height = MakerJs2.round(size.height * opts.scale, opts.accuracy);
            var viewBox = [0, 0, width, height];
            var unit = useSvgUnit ? useSvgUnit.svgUnitType : "";
            svgAttrs = {
              width: width + unit,
              height: height + unit,
              viewBox: viewBox.join(" ")
            };
          }
          svgAttrs["xmlns"] = "http://www.w3.org/2000/svg";
          var svgTag = new exporter2.XmlTag("svg", MakerJs2.extendObject(svgAttrs, opts.svgAttrs));
          append(svgTag.getOpeningTag(false));
          var groupAttrs = {
            id: "svgGroup",
            "stroke-linecap": opts.strokeLineCap,
            "fill-rule": opts.fillRule,
            "font-size": opts.fontSize
          };
          addSvgAttrs(groupAttrs, opts);
          var svgGroup = new exporter2.XmlTag("g", groupAttrs);
          append(svgGroup.getOpeningTag(false));
          if (opts.useSvgPathOnly) {
            var findChainsOptions = {
              byLayers: true
            };
            if (opts.fillRule === "nonzero") {
              findChainsOptions.contain = {
                alternateDirection: true
              };
            }
            var pathDataByLayer = getPathDataByLayer(modelToExport, opts.origin, findChainsOptions, opts.accuracy);
            for (var layerId1 in pathDataByLayer) {
              var pathData = pathDataByLayer[layerId1].join(" ");
              var attrs = { "d": pathData };
              if (layerId1.length > 0) {
                attrs["id"] = layerId1;
              }
              createElement("path", attrs, layerId1, null, true);
            }
          } else {
            let drawText2 = function(id, textPoint, layer) {
              createElement("text", {
                "id": id + "_text",
                "x": MakerJs2.round(textPoint[0], opts.accuracy),
                "y": MakerJs2.round(textPoint[1], opts.accuracy)
              }, layer, id);
            }, drawPath2 = function(id, x2, y2, d2, layer, route, textPoint, annotate, flow) {
              createElement("path", {
                "id": id,
                "data-route": route,
                "d": ["M", MakerJs2.round(x2, opts.accuracy), MakerJs2.round(y2, opts.accuracy)].concat(d2).join(" ")
              }, layer);
              if (annotate) {
                drawText2(id, textPoint, layer);
              }
            }, circleInPaths2 = function(id, center, radius, layer, route, annotate, flow) {
              var d2 = svgCircleData(radius, opts.accuracy);
              drawPath2(id, center[0], center[1], d2, layer, route, center, annotate, flow);
            }, addFlowMarks2 = function(flow, layer, origin, end, endAngle) {
              var className = "flow";
              map[MakerJs2.pathType.Circle]("", new MakerJs2.paths.Circle(origin, flow.size / 2), layer, className, null, false, null);
              var arrowEnd = [-1 * flow.size, flow.size / 2];
              var arrowLines = [arrowEnd, MakerJs2.point.mirror(arrowEnd, false, true)].map(function(p2) {
                return new MakerJs2.paths.Line(MakerJs2.point.add(MakerJs2.point.rotate(p2, endAngle), end), end);
              });
              arrowLines.forEach(function(a2) {
                return map[MakerJs2.pathType.Line]("", a2, layer, className, null, false, null);
              });
            }, beginModel2 = function(id, modelContext) {
              modelGroup.attrs = { id };
              append(modelGroup.getOpeningTag(false), modelContext.layer);
            }, endModel2 = function(modelContext) {
              append(modelGroup.getClosingTag(), modelContext.layer);
            };
            var drawText = drawText2, drawPath = drawPath2, circleInPaths = circleInPaths2, addFlowMarks = addFlowMarks2, beginModel = beginModel2, endModel = endModel2;
            var map = {};
            map[MakerJs2.pathType.Line] = function(id, line2, layer, className, route, annotate, flow) {
              var start = line2.origin;
              var end = line2.end;
              createElement("line", {
                "id": id,
                "class": className,
                "data-route": route,
                "x1": MakerJs2.round(start[0], opts.accuracy),
                "y1": MakerJs2.round(start[1], opts.accuracy),
                "x2": MakerJs2.round(end[0], opts.accuracy),
                "y2": MakerJs2.round(end[1], opts.accuracy)
              }, layer);
              if (annotate) {
                drawText2(id, MakerJs2.point.middle(line2), layer);
              }
              if (flow) {
                addFlowMarks2(flow, layer, line2.origin, line2.end, MakerJs2.angle.ofLineInDegrees(line2));
              }
            };
            map[MakerJs2.pathType.Circle] = function(id, circle2, layer, className, route, annotate, flow) {
              var center = circle2.origin;
              createElement("circle", {
                "id": id,
                "class": className,
                "data-route": route,
                "r": circle2.radius,
                "cx": MakerJs2.round(center[0], opts.accuracy),
                "cy": MakerJs2.round(center[1], opts.accuracy)
              }, layer);
              if (annotate) {
                drawText2(id, center, layer);
              }
            };
            map[MakerJs2.pathType.Arc] = function(id, arc, layer, className, route, annotate, flow) {
              correctArc(arc);
              var arcPoints = MakerJs2.point.fromArc(arc);
              if (MakerJs2.measure.isPointEqual(arcPoints[0], arcPoints[1])) {
                circleInPaths2(id, arc.origin, arc.radius, layer, route, annotate, flow);
              } else {
                var d2 = ["A"];
                svgArcData(d2, arc.radius, arcPoints[1], opts.accuracy, MakerJs2.angle.ofArcSpan(arc) > 180, arc.startAngle > arc.endAngle);
                drawPath2(id, arcPoints[0][0], arcPoints[0][1], d2, layer, route, MakerJs2.point.middle(arc), annotate, flow);
                if (flow) {
                  addFlowMarks2(flow, layer, arcPoints[1], arcPoints[0], MakerJs2.angle.noRevolutions(arc.startAngle - 90));
                }
              }
            };
            map[MakerJs2.pathType.BezierSeed] = function(id, seed, layer, className, route, annotate, flow) {
              var d2 = [];
              svgBezierData(d2, seed, opts.accuracy);
              drawPath2(id, seed.origin[0], seed.origin[1], d2, layer, route, MakerJs2.point.middle(seed), annotate, flow);
            };
            var modelGroup = new exporter2.XmlTag("g");
            var walkOptions = {
              beforeChildWalk: function(walkedModel) {
                beginModel2(walkedModel.childId, walkedModel.childModel);
                return true;
              },
              onPath: function(walkedPath) {
                var fn = map[walkedPath.pathContext.type];
                if (fn) {
                  var offset = MakerJs2.point.add(fixPoint(walkedPath.offset), opts.origin);
                  fn(walkedPath.pathId, fixPath(walkedPath.pathContext, offset), walkedPath.layer, null, walkedPath.route, opts.annotate, opts.flow);
                }
              },
              afterChildWalk: function(walkedModel) {
                endModel2(walkedModel.childModel);
              }
            };
            beginModel2("0", modelToExport);
            MakerJs2.model.walk(modelToExport, walkOptions);
            for (var layerId2 in layers) {
              var layerGroup = new exporter2.XmlTag("g", { id: layerId2 });
              addSvgAttrs(layerGroup.attrs, colorLayerOptions(layerId2));
              for (var i = 0; i < layers[layerId2].length; i++) {
                layerGroup.innerText += layers[layerId2][i];
              }
              layerGroup.innerTextEscaped = true;
              append(layerGroup.toString());
            }
            endModel2(modelToExport);
          }
          var captionTags = captions.map(function(caption) {
            var anchor = fixPath(caption.anchor, opts.origin);
            var center = MakerJs2.point.rounded(MakerJs2.point.middle(anchor), opts.accuracy);
            var tag = new exporter2.XmlTag("text", {
              "alignment-baseline": "middle",
              "text-anchor": "middle",
              "transform": "rotate(".concat(MakerJs2.angle.ofLineInDegrees(anchor), ",").concat(center[0], ",").concat(center[1], ")"),
              "x": center[0],
              "y": center[1]
            });
            addSvgAttrs(tag.attrs, colorLayerOptions(caption.layer));
            tag.innerText = caption.text;
            return tag.toString();
          });
          if (captionTags.length) {
            var captionGroup = new exporter2.XmlTag("g", { "id": "captions" });
            addSvgAttrs(captionGroup.attrs, colorLayerOptions(captionGroup.attrs.id));
            captionGroup.innerText = captionTags.join("");
            captionGroup.innerTextEscaped = true;
            append(captionGroup.toString());
          }
          append(svgGroup.getClosingTag());
          append(svgTag.getClosingTag());
          return elements.join("");
        }
        exporter2.toSVG = toSVG;
        function svgCircleData(radius, accuracy, clockwiseCircle) {
          var r2 = MakerJs2.round(radius, accuracy);
          var d2 = ["m", -r2, 0];
          function halfCircle(sign) {
            d2.push("a");
            svgArcData(d2, r2, [2 * r2 * sign, 0], accuracy, false, !clockwiseCircle);
          }
          halfCircle(1);
          halfCircle(-1);
          d2.push("z");
          return d2;
        }
        function svgBezierData(d2, seed, accuracy, reversed) {
          if (seed.controls.length === 1) {
            d2.push("Q", MakerJs2.round(seed.controls[0][0], accuracy), MakerJs2.round(seed.controls[0][1], accuracy));
          } else {
            var controls = reversed ? [seed.controls[1], seed.controls[0]] : seed.controls;
            d2.push("C", MakerJs2.round(controls[0][0], accuracy), MakerJs2.round(controls[0][1], accuracy), MakerJs2.round(controls[1][0], accuracy), MakerJs2.round(controls[1][1], accuracy));
          }
          var final = reversed ? seed.origin : seed.end;
          d2.push(MakerJs2.round(final[0], accuracy), MakerJs2.round(final[1], accuracy));
        }
        function svgArcData(d2, radius, endPoint, accuracy, largeArc, increasing) {
          var r2 = MakerJs2.round(radius, accuracy);
          var end = endPoint;
          d2.push(r2, r2);
          d2.push(0);
          d2.push(largeArc ? 1 : 0);
          d2.push(increasing ? 0 : 1);
          d2.push(MakerJs2.round(end[0], accuracy), MakerJs2.round(end[1], accuracy));
        }
        exporter2.svgUnit = {};
        exporter2.svgUnit[MakerJs2.unitType.Inch] = { svgUnitType: "in", scaleConversion: 1 };
        exporter2.svgUnit[MakerJs2.unitType.Millimeter] = { svgUnitType: "mm", scaleConversion: 1 };
        exporter2.svgUnit[MakerJs2.unitType.Centimeter] = { svgUnitType: "cm", scaleConversion: 1 };
        exporter2.svgUnit[MakerJs2.unitType.Foot] = { svgUnitType: "in", scaleConversion: 12 };
        exporter2.svgUnit[MakerJs2.unitType.Meter] = { svgUnitType: "cm", scaleConversion: 100 };
      })(exporter = MakerJs2.exporter || (MakerJs2.exporter = {}));
    })(MakerJs || (MakerJs = {}));
    (function(MakerJs2) {
      var importer;
      (function(importer2) {
        function fromSVGPathData(pathData, options) {
          if (options === void 0) {
            options = {};
          }
          var result = {};
          function addPath(p2) {
            if (!result.paths) {
              result.paths = {};
            }
            result.paths["p_" + ++pathCount] = p2;
          }
          function addModel(m2) {
            if (!result.models) {
              result.models = {};
            }
            result.models["p_" + ++pathCount] = m2;
          }
          function getPoint(cmd, offset, from) {
            if (offset === void 0) {
              offset = 0;
            }
            if (from === void 0) {
              from = cmd.from;
            }
            if (offset < 0) {
              offset = offset + cmd.data.length;
            }
            var p2 = MakerJs2.point.mirror([cmd.data[0 + offset], cmd.data[1 + offset]], false, true);
            if (cmd.absolute) {
              return p2;
            } else {
              return MakerJs2.point.add(p2, from);
            }
          }
          function lineTo(cmd, end) {
            if (!MakerJs2.measure.isPointEqual(cmd.from, end)) {
              addPath(new MakerJs2.paths.Line(cmd.from, end));
            }
            return end;
          }
          var map = {};
          map["M"] = function(cmd) {
            firstPoint = getPoint(cmd);
            if (cmd.data.length > 2) {
              cmd.from = firstPoint;
              for (var a2 = 2; a2 < cmd.data.length; a2 = a2 + 2) {
                cmd.from = lineTo(cmd, getPoint(cmd, a2));
              }
              return cmd.from;
            } else
              return firstPoint;
          };
          map["Z"] = function(cmd) {
            return lineTo(cmd, firstPoint);
          };
          map["H"] = function(cmd) {
            var end = MakerJs2.point.clone(cmd.from);
            if (cmd.absolute) {
              end[0] = cmd.data[0];
            } else {
              end[0] += cmd.data[0];
            }
            return lineTo(cmd, end);
          };
          map["V"] = function(cmd) {
            var end = MakerJs2.point.clone(cmd.from);
            if (cmd.absolute) {
              end[1] = -cmd.data[0];
            } else {
              end[1] -= cmd.data[0];
            }
            return lineTo(cmd, end);
          };
          map["L"] = function(cmd) {
            var end;
            for (var a2 = 0; a2 < cmd.data.length; a2 = a2 + 2) {
              end = getPoint(cmd, a2);
              cmd.from = lineTo(cmd, end);
            }
            return cmd.from;
          };
          map["A"] = function(cmd) {
            var rx;
            var ry;
            var rotation;
            var large;
            var decreasing;
            var end;
            var elliptic;
            var xAxis;
            var arc;
            var scaleUp;
            var e2;
            for (var a2 = 0; a2 < cmd.data.length; a2 = a2 + 7) {
              rx = cmd.data[0 + a2];
              ry = cmd.data[1 + a2];
              rotation = cmd.data[2 + a2];
              large = cmd.data[3 + a2] === 1;
              decreasing = cmd.data[4 + a2] === 1;
              end = getPoint(cmd, 5 + a2);
              elliptic = rx !== ry;
              xAxis = new MakerJs2.paths.Line(cmd.from, MakerJs2.point.rotate(end, rotation, cmd.from));
              if (elliptic) {
                xAxis = MakerJs2.path.distort(xAxis, 1, rx / ry);
              }
              arc = new MakerJs2.paths.Arc(xAxis.origin, xAxis.end, rx, large, decreasing);
              if (elliptic) {
                if (rx < arc.radius) {
                  scaleUp = arc.radius / rx;
                  rx *= scaleUp;
                  ry *= scaleUp;
                }
                e2 = new MakerJs2.models.EllipticArc(arc, 1, ry / rx, options.bezierAccuracy);
                MakerJs2.model.rotate(e2, -rotation, cmd.from);
                addModel(e2);
              } else {
                MakerJs2.path.rotate(arc, -rotation, cmd.from);
                addPath(arc);
              }
              cmd.from = end;
            }
            return end;
          };
          map["C"] = function(cmd) {
            var control1;
            var control2;
            var start = cmd.from;
            var end;
            for (var a2 = 0; a2 < cmd.data.length; a2 = a2 + 6) {
              cmd.from = start;
              control1 = getPoint(cmd, 0 + a2, start);
              control2 = getPoint(cmd, 2 + a2, start);
              end = getPoint(cmd, 4 + a2, start);
              addModel(new MakerJs2.models.BezierCurve(start, control1, control2, end, options.bezierAccuracy));
              start = end;
            }
            return end;
          };
          map["S"] = function(cmd) {
            var control1;
            var prevControl2;
            var control2;
            var start = cmd.from;
            var end;
            if (cmd.prev.command === "C" || cmd.prev.command === "S") {
              prevControl2 = getPoint(cmd.prev, -4);
            } else {
              prevControl2 = cmd.from;
            }
            for (var a2 = 0; a2 < cmd.data.length; a2 = a2 + 4) {
              cmd.from = start;
              control1 = MakerJs2.point.rotate(prevControl2, 180, start);
              control2 = getPoint(cmd, 0 + a2);
              end = getPoint(cmd, 2 + a2);
              addModel(new MakerJs2.models.BezierCurve(start, control1, control2, end, options.bezierAccuracy));
              start = end;
              prevControl2 = control2;
            }
            return end;
          };
          map["Q"] = function(cmd) {
            var control;
            var start = cmd.from;
            var end;
            for (var a2 = 0; a2 < cmd.data.length; a2 = a2 + 4) {
              cmd.from = start;
              control = getPoint(cmd, 0 + a2);
              end = getPoint(cmd, 2 + a2);
              addModel(new MakerJs2.models.BezierCurve(start, control, end, options.bezierAccuracy));
              start = end;
            }
            return end;
          };
          map["T"] = function(cmd) {
            var control;
            var prevControl;
            var end;
            if (cmd.prev.command === "Q") {
              prevControl = getPoint(cmd.prev, -4);
              control = MakerJs2.point.rotate(prevControl, 180, cmd.from);
            } else if (cmd.prev.command === "T") {
              cmd.prev.absolute = true;
              control = getPoint(cmd.prev, -2);
            } else {
              control = cmd.from;
            }
            for (var a2 = 0; a2 < cmd.data.length; a2 = a2 + 2) {
              end = getPoint(cmd, 0 + a2);
              addModel(new MakerJs2.models.BezierCurve(cmd.from, control, end, options.bezierAccuracy));
              cmd.from = end;
              control = MakerJs2.point.rotate(control, 180, cmd.from);
            }
            var p2 = MakerJs2.point.mirror(control, false, true);
            cmd.data.push.apply(cmd.data, p2);
            return end;
          };
          var firstPoint = [0, 0];
          var currPoint = [0, 0];
          var pathCount = 0;
          var prevCommand;
          var regexpCommands = /([achlmqstvz])([0-9e\.,\+-\s]*)/ig;
          var commandMatches;
          while ((commandMatches = regexpCommands.exec(pathData)) !== null) {
            if (commandMatches.index === regexpCommands.lastIndex) {
              regexpCommands.lastIndex++;
            }
            var command = commandMatches[1];
            var dataString = commandMatches[2];
            var currCmd = {
              command: command.toUpperCase(),
              data: [],
              from: currPoint,
              prev: prevCommand
            };
            if (command === currCmd.command) {
              currCmd.absolute = true;
            }
            currCmd.data = importer2.parseNumericList(dataString);
            var fn = map[currCmd.command];
            if (fn) {
              currPoint = fn(currCmd);
            }
            prevCommand = currCmd;
          }
          return result;
        }
        importer2.fromSVGPathData = fromSVGPathData;
      })(importer = MakerJs2.importer || (MakerJs2.importer = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var layout;
      (function(layout2) {
        function getChildPlacement(parentModel, baseline) {
          var atlas = new MakerJs2.measure.Atlas(parentModel);
          var measureParent = MakerJs2.measure.modelExtents(parentModel, atlas);
          var parentTop = measureParent.high[1];
          var cpa = [];
          var xMap = {};
          var walkOptions = {
            beforeChildWalk: function(context) {
              var child = context.childModel;
              var m2 = atlas.modelMap[context.routeKey];
              if (!m2)
                return;
              var childMeasure = MakerJs2.measure.augment(m2);
              MakerJs2.model.originate(child, [childMeasure.center[0], parentTop * baseline]);
              var x2 = child.origin[0] - measureParent.low[0];
              xMap[context.childId] = x2;
              var xRatio = x2 / measureParent.width;
              cpa.push({ childId: context.childId, xRatio });
              return false;
            }
          };
          MakerJs2.model.walk(parentModel, walkOptions);
          cpa.sort(function(a2, b2) {
            return a2.xRatio - b2.xRatio;
          });
          var first = cpa[0];
          var last = cpa[cpa.length - 1];
          if (cpa.length > 1) {
            var min = first.xRatio;
            var max = last.xRatio;
            var span = max - min;
            cpa.forEach(function(cp) {
              return cp.xRatio = (cp.xRatio - min) / span;
            });
          }
          return {
            cpa,
            firstX: xMap[first.childId],
            lastX: measureParent.width - xMap[last.childId]
          };
        }
        function moveAndRotate(parentModel, cpa, rotate) {
          cpa.forEach(function(cp) {
            var child = parentModel.models[cp.childId];
            child.origin = cp.origin;
            if (rotate)
              MakerJs2.model.rotate(child, cp.angle, cp.origin);
          });
        }
        var onPathMap = {};
        onPathMap[MakerJs2.pathType.Arc] = function(arc, reversed, cpa) {
          var arcSpan = MakerJs2.angle.ofArcSpan(arc);
          cpa.forEach(function(p2) {
            return p2.angle = reversed ? arc.endAngle - p2.xRatio * arcSpan - 90 : arc.startAngle + p2.xRatio * arcSpan + 90;
          });
        };
        onPathMap[MakerJs2.pathType.Line] = function(line2, reversed, cpa) {
          var lineAngle = MakerJs2.angle.ofLineInDegrees(line2);
          cpa.forEach(function(p2) {
            return p2.angle = lineAngle;
          });
        };
        function childrenOnPath(parentModel, onPath, baseline, reversed, contain, rotate) {
          if (baseline === void 0) {
            baseline = 0;
          }
          if (reversed === void 0) {
            reversed = false;
          }
          if (contain === void 0) {
            contain = false;
          }
          if (rotate === void 0) {
            rotate = true;
          }
          var result = getChildPlacement(parentModel, baseline);
          var cpa = result.cpa;
          var chosenPath = onPath;
          if (contain && cpa.length > 1) {
            var onPathLength = MakerJs2.measure.pathLength(onPath);
            if (result.firstX + result.lastX < onPathLength) {
              chosenPath = MakerJs2.path.clone(onPath);
              MakerJs2.path.alterLength(chosenPath, -result.firstX, true);
              MakerJs2.path.alterLength(chosenPath, -result.lastX);
            }
          }
          cpa.forEach(function(p2) {
            return p2.origin = MakerJs2.point.middle(chosenPath, reversed ? 1 - p2.xRatio : p2.xRatio);
          });
          var fn = onPathMap[chosenPath.type];
          if (fn) {
            fn(chosenPath, reversed, cpa);
          }
          moveAndRotate(parentModel, cpa, rotate);
          return parentModel;
        }
        layout2.childrenOnPath = childrenOnPath;
        function miterAngles(points, offsetAngle) {
          var arc = new MakerJs2.paths.Arc([0, 0], 0, 0, 0);
          return points.map(function(p2, i) {
            var a2;
            if (i === 0) {
              a2 = MakerJs2.angle.ofPointInDegrees(p2, points[i + 1]) + 90;
            } else if (i === points.length - 1) {
              a2 = MakerJs2.angle.ofPointInDegrees(points[i - 1], p2) + 90;
            } else {
              arc.origin = p2;
              arc.startAngle = MakerJs2.angle.ofPointInDegrees(p2, points[i + 1]);
              arc.endAngle = MakerJs2.angle.ofPointInDegrees(p2, points[i - 1]);
              a2 = MakerJs2.angle.ofArcMiddle(arc);
            }
            return a2 + offsetAngle;
          });
        }
        function childrenOnChain(parentModel, onChain, baseline, reversed, contain, rotated) {
          if (baseline === void 0) {
            baseline = 0;
          }
          if (reversed === void 0) {
            reversed = false;
          }
          if (contain === void 0) {
            contain = false;
          }
          if (rotated === void 0) {
            rotated = true;
          }
          var result = getChildPlacement(parentModel, baseline);
          var cpa = result.cpa;
          var chainLength = onChain.pathLength;
          var points;
          if (cpa.length > 1) {
            if (contain)
              chainLength -= result.firstX + result.lastX;
            var absolutes = cpa.map(function(cp) {
              return (reversed ? 1 - cp.xRatio : cp.xRatio) * chainLength;
            });
            var relatives;
            if (reversed)
              absolutes.reverse();
            relatives = absolutes.map(function(ab, i) {
              return Math.abs(ab - (i == 0 ? 0 : absolutes[i - 1]));
            });
            if (contain) {
              relatives[0] += reversed ? result.lastX : result.firstX;
            } else {
              relatives.shift();
            }
            points = MakerJs2.chain.toPoints(onChain, relatives);
            if (points.length < cpa.length) {
              var endLink = onChain.links[onChain.links.length - 1];
              points.push(endLink.endPoints[endLink.reversed ? 0 : 1]);
            }
            if (contain)
              points.shift();
          } else {
            points = MakerJs2.chain.toPoints(onChain, 0.5 * chainLength);
            points.length = 2;
            points.push(onChain.links[onChain.links.length - 1].endPoints[onChain.links[onChain.links.length - 1].reversed ? 0 : 1]);
          }
          if (reversed)
            points.reverse();
          var angles = miterAngles(points, -90);
          if (cpa.length > 1) {
            cpa.forEach(function(cp, i) {
              cp.angle = angles[i];
              cp.origin = points[i];
            });
          } else {
            cpa[0].angle = angles[1];
            cpa[0].origin = points[1];
          }
          moveAndRotate(parentModel, cpa, rotated);
          return parentModel;
        }
        layout2.childrenOnChain = childrenOnChain;
        function cloneToRadial(itemToClone, count, angleInDegrees, rotationOrigin) {
          var result = {};
          var add;
          var rotateFn;
          if (MakerJs2.isModel(itemToClone)) {
            add = result.models = {};
            rotateFn = MakerJs2.model.rotate;
          } else {
            add = result.paths = {};
            rotateFn = MakerJs2.path.rotate;
          }
          for (var i = 0; i < count; i++) {
            add[i] = rotateFn(MakerJs2.cloneObject(itemToClone), i * angleInDegrees, rotationOrigin);
          }
          return result;
        }
        layout2.cloneToRadial = cloneToRadial;
        function cloneTo(dimension, itemToClone, count, margin) {
          var result = {};
          var add;
          var measureFn;
          var moveFn;
          if (MakerJs2.isModel(itemToClone)) {
            measureFn = MakerJs2.measure.modelExtents;
            add = result.models = {};
            moveFn = MakerJs2.model.move;
          } else {
            measureFn = MakerJs2.measure.pathExtents;
            add = result.paths = {};
            moveFn = MakerJs2.path.move;
          }
          var m2 = measureFn(itemToClone);
          var size = m2.high[dimension] - m2.low[dimension];
          for (var i = 0; i < count; i++) {
            var origin = [0, 0];
            origin[dimension] = i * (size + margin);
            add[i] = moveFn(MakerJs2.cloneObject(itemToClone), origin);
          }
          return result;
        }
        function cloneToColumn(itemToClone, count, margin) {
          if (margin === void 0) {
            margin = 0;
          }
          return cloneTo(1, itemToClone, count, margin);
        }
        layout2.cloneToColumn = cloneToColumn;
        function cloneToRow(itemToClone, count, margin) {
          if (margin === void 0) {
            margin = 0;
          }
          return cloneTo(0, itemToClone, count, margin);
        }
        layout2.cloneToRow = cloneToRow;
        function cloneToGrid(itemToClone, xCount, yCount, margin) {
          var margins = getMargins(margin);
          return cloneToColumn(cloneToRow(itemToClone, xCount, margins[0]), yCount, margins[1]);
        }
        layout2.cloneToGrid = cloneToGrid;
        function getMargins(margin) {
          if (Array.isArray(margin)) {
            return margin;
          } else {
            return [margin, margin];
          }
        }
        function cloneToAlternatingRows(itemToClone, xCount, yCount, spacingFn) {
          var modelToMeasure;
          if (MakerJs2.isModel(itemToClone)) {
            modelToMeasure = itemToClone;
          } else {
            modelToMeasure = { paths: { "0": itemToClone } };
          }
          var spacing = spacingFn(modelToMeasure);
          var result = { models: {} };
          for (var i = 0; i < yCount; i++) {
            var i2 = i % 2;
            result.models[i] = MakerJs2.model.move(cloneToRow(itemToClone, xCount + i2, spacing.xMargin), [i2 * spacing.x, i * spacing.y]);
          }
          return result;
        }
        function cloneToBrick(itemToClone, xCount, yCount, margin) {
          var margins = getMargins(margin);
          function spacing(modelToMeasure) {
            var m2 = MakerJs2.measure.modelExtents(modelToMeasure);
            var xMargin = margins[0] || 0;
            var yMargin = margins[1] || 0;
            return { x: (m2.width + xMargin) / -2, y: m2.height + yMargin, xMargin };
          }
          return cloneToAlternatingRows(itemToClone, xCount, yCount, spacing);
        }
        layout2.cloneToBrick = cloneToBrick;
        function cloneToHoneycomb(itemToClone, xCount, yCount, margin) {
          if (margin === void 0) {
            margin = 0;
          }
          function spacing(modelToMeasure) {
            var hex = MakerJs2.measure.boundingHexagon(modelToMeasure);
            var width = 2 * MakerJs2.solvers.equilateralAltitude(hex.radius);
            var s2 = width + margin;
            return { x: s2 / -2, y: MakerJs2.solvers.equilateralAltitude(s2), xMargin: margin };
          }
          return cloneToAlternatingRows(itemToClone, xCount, yCount, spacing);
        }
        layout2.cloneToHoneycomb = cloneToHoneycomb;
      })(layout = MakerJs2.layout || (MakerJs2.layout = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var models;
      (function(models2) {
        var hasLib = false;
        function ensureBezierLib() {
          if (hasLib)
            return;
          try {
            var lib = Bezier.prototype;
            hasLib = true;
          } catch (e2) {
            throw "Bezier library not found. If you are using Node, try running 'npm install' or if you are in the browser, download http://pomax.github.io/bezierjs/bezier.js to your website and add a script tag.";
          }
        }
        var scratch;
        function getScratch(seed) {
          var points = [seed.origin];
          points.push.apply(points, seed.controls);
          points.push(seed.end);
          var bezierJsPoints = points.map(function(p2) {
            var bp = {
              x: p2[0],
              y: p2[1]
            };
            return bp;
          });
          if (!scratch) {
            ensureBezierLib();
            scratch = new Bezier(bezierJsPoints);
          } else {
            Bezier.apply(scratch, bezierJsPoints);
          }
          return scratch;
        }
        function BezierToSeed(b2, range) {
          var points = b2.points.map(getIPoint);
          var seed = new BezierSeed(points);
          if (range) {
            seed.parentRange = range;
          }
          return seed;
        }
        function seedToBezier(seed) {
          var coords = [];
          coords.push.apply(coords, seed.origin);
          coords.push.apply(coords, seed.controls[0]);
          if (seed.controls.length > 1) {
            coords.push.apply(coords, seed.controls[1]);
          }
          coords.push.apply(coords, seed.end);
          ensureBezierLib();
          return new Bezier(coords);
        }
        function getExtrema(b2) {
          var extrema = b2.extrema().values.map(function(m2) {
            return MakerJs2.round(m2);
          }).filter(function(value, index, self2) {
            return self2.indexOf(value) === index;
          }).sort();
          if (extrema.length === 0)
            return [0, 1];
          if (extrema[0] !== 0) {
            extrema.unshift(0);
          }
          if (extrema[extrema.length - 1] !== 1) {
            extrema.push(1);
          }
          return extrema;
        }
        function getIPoint(p2) {
          return [p2.x, p2.y];
        }
        var TPoint = (
          /** @class */
          /* @__PURE__ */ (function() {
            function TPoint2(b2, t2, offset) {
              this.t = t2;
              this.point = MakerJs2.point.add(getIPoint(b2.get(t2)), offset);
            }
            return TPoint2;
          })()
        );
        function getError(b2, startT, endT, arc, arcReversed) {
          var tSpan = endT - startT;
          function m2(ratio) {
            var t2 = startT + tSpan * ratio;
            var bp = getIPoint(b2.get(t2));
            var ap = MakerJs2.point.middle(arc, arcReversed ? 1 - ratio : ratio);
            return MakerJs2.measure.pointDistance(ap, bp);
          }
          return m2(0.25) + m2(0.75);
        }
        function getLargestArc(b2, startT, endT, accuracy) {
          var arc, lastGoodArc;
          var start = new TPoint(b2, startT);
          var end = new TPoint(b2, endT);
          var upper = end;
          var lower = start;
          var count = 0;
          var test = upper;
          var reversed;
          while (count < 100) {
            var middle = getIPoint(b2.get((start.t + test.t) / 2));
            try {
              arc = new MakerJs2.paths.Arc(start.point, middle, test.point);
            } catch (e2) {
              if (lastGoodArc) {
                return lastGoodArc;
              } else {
                break;
              }
            }
            if (reversed === void 0) {
              reversed = MakerJs2.measure.isPointEqual(start.point, MakerJs2.point.fromAngleOnCircle(arc.endAngle, arc));
            }
            var error = getError(b2, startT, test.t, arc, reversed);
            if (error <= accuracy) {
              arc.bezierData = {
                startT,
                endT: test.t
              };
              lower = test;
              lastGoodArc = arc;
            } else {
              upper = test;
            }
            if (lower.t === upper.t || lastGoodArc && lastGoodArc !== arc && MakerJs2.angle.ofArcSpan(arc) - MakerJs2.angle.ofArcSpan(lastGoodArc) < 0.5) {
              return lastGoodArc;
            }
            count++;
            test = new TPoint(b2, (lower.t + upper.t) / 2);
          }
          var line2 = new MakerJs2.paths.Line(start.point, test.point);
          line2.bezierData = {
            startT,
            endT: test.t
          };
          return line2;
        }
        function getArcs(bc, b2, accuracy, startT, endT, base) {
          var added = 0;
          var arc;
          while (startT < endT) {
            arc = getLargestArc(b2, startT, endT, accuracy);
            startT = arc.bezierData.endT;
            var len = MakerJs2.measure.pathLength(arc);
            if (len < 1e-4) {
              continue;
            }
            bc.paths[arc.type + "_" + (base + added)] = arc;
            added++;
          }
          return added;
        }
        function getActualBezierRange(curve, arc, endpoints, offset, pointMatchingDistance) {
          var b2 = getScratch(curve.seed);
          var tPoints = [arc.bezierData.startT, arc.bezierData.endT].map(function(t2) {
            return new TPoint(b2, t2, offset);
          });
          var ends = endpoints.slice();
          var endpointDistancetoStart = ends.map(function(e2) {
            return MakerJs2.measure.pointDistance(e2, tPoints[0].point);
          });
          if (endpointDistancetoStart[0] > endpointDistancetoStart[1])
            ends.reverse();
          for (var i = 2; i--; ) {
            if (!MakerJs2.measure.isPointEqual(ends[i], tPoints[i].point, pointMatchingDistance)) {
              return null;
            }
          }
          return arc.bezierData;
        }
        function getChainBezierRange(curve, c2, layer, addToLayer, pointMatchingDistance) {
          var endLinks = [c2.links[0], c2.links[c2.links.length - 1]];
          if (endLinks[0].walkedPath.pathContext.bezierData.startT > endLinks[1].walkedPath.pathContext.bezierData.startT) {
            MakerJs2.chain.reverse(c2);
            endLinks.reverse();
          }
          var actualBezierRanges = endLinks.map(function(endLink) {
            return getActualBezierRange(curve, endLink.walkedPath.pathContext, endLink.endPoints, endLink.walkedPath.offset, pointMatchingDistance);
          });
          var result = {
            startT: actualBezierRanges[0] ? actualBezierRanges[0].startT : null,
            endT: actualBezierRanges[1] ? actualBezierRanges[1].endT : null
          };
          if (result.startT !== null && result.endT !== null) {
            return result;
          } else if (c2.links.length > 2) {
            if (result.startT === null) {
              addToLayer(c2.links[0].walkedPath.pathContext, layer, true);
              result.startT = c2.links[1].walkedPath.pathContext.bezierData.startT;
            }
            if (result.endT === null) {
              addToLayer(c2.links[c2.links.length - 1].walkedPath.pathContext, layer, true);
              result.endT = c2.links[c2.links.length - 2].walkedPath.pathContext.bezierData.endT;
            }
            return result;
          }
          return null;
        }
        var BezierSeed = (
          /** @class */
          /* @__PURE__ */ (function() {
            function BezierSeed2() {
              var args = [];
              for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
              }
              this.type = MakerJs2.pathType.BezierSeed;
              switch (args.length) {
                case 1:
                  var points = args[0];
                  this.origin = points[0];
                  if (points.length === 3) {
                    this.controls = [points[1]];
                    this.end = points[2];
                  } else if (points.length === 4) {
                    this.controls = [points[1], points[2]];
                    this.end = points[3];
                  } else {
                    this.end = points[1];
                  }
                  break;
                case 3:
                  if (Array.isArray(args[1])) {
                    this.controls = args[1];
                  } else {
                    this.controls = [args[1]];
                  }
                  this.end = args[2];
                  break;
                case 4:
                  this.controls = [args[1], args[2]];
                  this.end = args[3];
                  break;
              }
            }
            return BezierSeed2;
          })()
        );
        var BezierCurve = (
          /** @class */
          (function() {
            function BezierCurve2() {
              var args = [];
              for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
              }
              this.type = BezierCurve2.typeName;
              var isArrayArg0 = Array.isArray(args[0]);
              switch (args.length) {
                case 2:
                  if (isArrayArg0) {
                    this.accuracy = args[1];
                  } else {
                    this.seed = args[0];
                    this.accuracy = args[1];
                    break;
                  }
                //fall through to point array
                case 1:
                  if (isArrayArg0) {
                    var points = args[0];
                    this.seed = new BezierSeed(points);
                  } else {
                    this.seed = args[0];
                  }
                  break;
                default:
                  switch (args.length) {
                    case 4:
                      if (MakerJs2.isPoint(args[3])) {
                        this.seed = new BezierSeed(args);
                        break;
                      } else {
                        this.accuracy = args[3];
                      }
                    case 3:
                      if (isArrayArg0) {
                        this.seed = new BezierSeed(args.slice(0, 3));
                      }
                      break;
                    case 5:
                      this.accuracy = args[4];
                      this.seed = new BezierSeed(args.slice(0, 4));
                      break;
                  }
                  break;
              }
              this.paths = {};
              if (MakerJs2.measure.isBezierSeedLinear(this.seed)) {
                var line2 = new MakerJs2.paths.Line(MakerJs2.point.clone(this.seed.origin), MakerJs2.point.clone(this.seed.end));
                line2.bezierData = {
                  startT: 0,
                  endT: 1
                };
                this.paths = {
                  "0": line2
                };
                return;
              }
              var b2 = seedToBezier(this.seed);
              var extrema = getExtrema(b2);
              this.paths = {};
              if (!this.accuracy) {
                var len = b2.length();
                this.accuracy = len / 100;
              }
              var count = 0;
              for (var i = 1; i < extrema.length; i++) {
                var extremaSpan = extrema[i] - extrema[i - 1];
                count += getArcs(this, b2, this.accuracy * extremaSpan, extrema[i - 1], extrema[i], count);
              }
            }
            BezierCurve2.getBezierSeeds = function(curve, options) {
              if (options === void 0) {
                options = {};
              }
              options.shallow = true;
              options.unifyBeziers = false;
              var seedsByLayer = {};
              var addToLayer = function(pathToAdd, layer, clone) {
                if (clone === void 0) {
                  clone = false;
                }
                if (!seedsByLayer[layer]) {
                  seedsByLayer[layer] = [];
                }
                seedsByLayer[layer].push(clone ? MakerJs2.path.clone(pathToAdd) : pathToAdd);
              };
              MakerJs2.model.findChains(curve, function(chains, loose, layer) {
                chains.forEach(function(c2) {
                  var range = getChainBezierRange(curve, c2, layer, addToLayer, options.pointMatchingDistance);
                  if (range) {
                    var b2 = getScratch(curve.seed);
                    var piece = b2.split(range.startT, range.endT);
                    addToLayer(BezierToSeed(piece), layer);
                  } else {
                    c2.links.forEach(function(link) {
                      return addToLayer(link.walkedPath.pathContext, layer, true);
                    });
                  }
                });
                loose.forEach(function(wp) {
                  if (wp.pathContext.type === MakerJs2.pathType.Line) {
                    return addToLayer(wp.pathContext, layer, true);
                  }
                  var range = getActualBezierRange(curve, wp.pathContext, MakerJs2.point.fromPathEnds(wp.pathContext), wp.offset, options.pointMatchingDistance);
                  if (range) {
                    var b2 = getScratch(curve.seed);
                    var piece = b2.split(range.startT, range.endT);
                    addToLayer(BezierToSeed(piece), layer);
                  } else {
                    addToLayer(wp.pathContext, layer, true);
                  }
                });
              }, options);
              if (options.byLayers) {
                return seedsByLayer;
              } else {
                return seedsByLayer[""];
              }
            };
            BezierCurve2.computeLength = function(seed) {
              var b2 = seedToBezier(seed);
              return b2.length();
            };
            BezierCurve2.computePoint = function(seed, t2) {
              var s2 = getScratch(seed);
              var computedPoint = s2.compute(t2);
              return getIPoint(computedPoint);
            };
            BezierCurve2.typeName = "BezierCurve";
            return BezierCurve2;
          })()
        );
        models2.BezierCurve = BezierCurve;
        BezierCurve.metaParameters = [
          {
            title: "points",
            type: "select",
            value: [
              [[100, 0], [-80, -60], [100, 220], [100, 60]],
              [[0, 0], [100, 0], [100, 100]],
              [[0, 0], [20, 0], [80, 100], [100, 100]]
            ]
          }
        ];
      })(models = MakerJs2.models || (MakerJs2.models = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var models;
      (function(models2) {
        var maxBezierArcspan = 45;
        function controlYForCircularCubic(arcSpanInRadians) {
          return 4 * (Math.tan(arcSpanInRadians / 4) / 3);
        }
        function controlPointsForCircularCubic(arc) {
          var arcSpan = MakerJs2.angle.ofArcSpan(arc);
          var y2 = controlYForCircularCubic(MakerJs2.angle.toRadians(arcSpan));
          var c1 = [arc.radius, arc.radius * y2];
          var c2 = MakerJs2.point.rotate(MakerJs2.point.mirror(c1, false, true), arcSpan, [0, 0]);
          return [c1, c2].map(function(p2) {
            return MakerJs2.point.add(arc.origin, MakerJs2.point.rotate(p2, arc.startAngle, [0, 0]));
          });
        }
        function bezierSeedFromArc(arc) {
          var span = MakerJs2.angle.ofArcSpan(arc);
          if (span <= 90) {
            var endPoints = MakerJs2.point.fromPathEnds(arc);
            var controls = controlPointsForCircularCubic(arc);
            return {
              type: MakerJs2.pathType.BezierSeed,
              origin: endPoints[0],
              controls,
              end: endPoints[1]
            };
          }
          return null;
        }
        var Ellipse = (
          /** @class */
          /* @__PURE__ */ (function() {
            function Ellipse2() {
              var args = [];
              for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
              }
              var _this = this;
              this.models = {};
              var n = 360 / maxBezierArcspan;
              var accuracy;
              var isPointArgs0 = MakerJs2.isPoint(args[0]);
              var realArgs = function(numArgs) {
                switch (numArgs) {
                  case 2:
                    if (isPointArgs0) {
                      _this.origin = args[0];
                    }
                    break;
                  case 3:
                    _this.origin = args[0];
                    break;
                  case 4:
                    _this.origin = [args[0], args[1]];
                    break;
                }
                var a2 = 360 / n;
                var arc = new MakerJs2.paths.Arc([0, 0], 1, 0, a2);
                for (var i = 0; i < n; i++) {
                  var seed = bezierSeedFromArc(arc);
                  switch (numArgs) {
                    case 1:
                      seed = MakerJs2.path.scale(seed, args[0]);
                      break;
                    case 2:
                      if (isPointArgs0) {
                        seed = MakerJs2.path.scale(seed, args[1]);
                      } else {
                        seed = MakerJs2.path.distort(seed, args[0], args[1]);
                      }
                      break;
                    case 3:
                      seed = MakerJs2.path.distort(seed, args[1], args[2]);
                      break;
                    case 4:
                      seed = MakerJs2.path.distort(seed, args[2], args[3]);
                      break;
                  }
                  _this.models["Curve_" + (1 + i)] = new models2.BezierCurve(seed, accuracy);
                  arc.startAngle += a2;
                  arc.endAngle += a2;
                }
              };
              switch (args.length) {
                case 2:
                  realArgs(2);
                  break;
                case 3:
                  if (isPointArgs0) {
                    realArgs(3);
                  } else {
                    accuracy = args[2];
                    realArgs(2);
                  }
                  break;
                case 4:
                  if (isPointArgs0) {
                    accuracy = args[3];
                    realArgs(3);
                  } else {
                    realArgs(4);
                  }
                  break;
                case 5:
                  accuracy = args[4];
                  realArgs(4);
                  break;
              }
            }
            return Ellipse2;
          })()
        );
        models2.Ellipse = Ellipse;
        Ellipse.metaParameters = [
          { title: "radiusX", type: "range", min: 1, max: 50, value: 50 },
          { title: "radiusY", type: "range", min: 1, max: 50, value: 25 }
        ];
        var EllipticArc = (
          /** @class */
          /* @__PURE__ */ (function() {
            function EllipticArc2() {
              var args = [];
              for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
              }
              this.models = {};
              var arc;
              var accuracy;
              var distortX;
              var distortY;
              if (MakerJs2.isPathArc(args[0])) {
                arc = args[0];
                distortX = args[1];
                distortY = args[2];
                accuracy = args[3];
              } else {
                arc = new MakerJs2.paths.Arc([0, 0], 1, args[0], args[1]);
                distortX = args[2];
                distortY = args[3];
                accuracy = args[4];
              }
              var span = MakerJs2.angle.ofArcSpan(arc);
              var count = Math.ceil(span / maxBezierArcspan);
              var subSpan = span / count;
              var subArc = MakerJs2.path.clone(arc);
              for (var i = 0; i < count; i++) {
                subArc.startAngle = arc.startAngle + i * subSpan;
                subArc.endAngle = subArc.startAngle + subSpan;
                var seed = bezierSeedFromArc(subArc);
                seed = MakerJs2.path.distort(seed, distortX, distortY);
                this.models["Curve_" + (1 + i)] = new models2.BezierCurve(seed, accuracy);
              }
            }
            return EllipticArc2;
          })()
        );
        models2.EllipticArc = EllipticArc;
        EllipticArc.metaParameters = [
          { title: "startAngle", type: "range", min: 0, max: 90, value: 0 },
          { title: "endAngle", type: "range", min: 90, max: 360, value: 180 },
          { title: "radiusX", type: "range", min: 1, max: 50, value: 50 },
          { title: "radiusY", type: "range", min: 1, max: 50, value: 25 }
        ];
      })(models = MakerJs2.models || (MakerJs2.models = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var models;
      (function(models2) {
        function getPoints(arg) {
          var coords;
          if (Array.isArray(arg)) {
            if (MakerJs2.isPoint(arg[0])) {
              return arg;
            }
            coords = arg;
          } else {
            coords = MakerJs2.importer.parseNumericList(arg);
          }
          var points = [];
          for (var i = 0; i < coords.length; i += 2) {
            points.push([coords[i], coords[i + 1]]);
          }
          return points;
        }
        var ConnectTheDots = (
          /** @class */
          /* @__PURE__ */ (function() {
            function ConnectTheDots2() {
              var args = [];
              for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
              }
              var _this = this;
              this.paths = {};
              var isClosed;
              var points;
              switch (args.length) {
                case 1:
                  isClosed = true;
                  points = getPoints(args[0]);
                  break;
                case 2:
                  isClosed = args[0];
                  points = getPoints(args[1]);
                  break;
              }
              var connect = function(a2, b2, skipZeroDistance) {
                if (skipZeroDistance === void 0) {
                  skipZeroDistance = false;
                }
                if (skipZeroDistance && MakerJs2.measure.pointDistance(points[a2], points[b2]) == 0)
                  return;
                _this.paths["ShapeLine" + i] = new MakerJs2.paths.Line(points[a2], points[b2]);
              };
              for (var i = 1; i < points.length; i++) {
                connect(i - 1, i);
              }
              if (isClosed && points.length > 2) {
                connect(points.length - 1, 0, true);
              }
            }
            return ConnectTheDots2;
          })()
        );
        models2.ConnectTheDots = ConnectTheDots;
        ConnectTheDots.metaParameters = [
          { title: "closed", type: "bool", value: true },
          {
            title: "points",
            type: "select",
            value: [
              [[0, 0], [40, 40], [60, 20], [100, 100], [60, 60], [40, 80]],
              [[0, 0], [100, 0], [50, 87]],
              [-10, 0, 10, 0, 0, 20],
              "-10 0 10 0 0 20"
            ]
          }
        ];
      })(models = MakerJs2.models || (MakerJs2.models = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var models;
      (function(models2) {
        var Polygon = (
          /** @class */
          (function() {
            function Polygon2(numberOfSides, radius, firstCornerAngleInDegrees, circumscribed) {
              this.paths = {};
              this.paths = new models2.ConnectTheDots(true, Polygon2.getPoints(numberOfSides, radius, firstCornerAngleInDegrees, circumscribed)).paths;
            }
            Polygon2.circumscribedRadius = function(radius, angleInRadians) {
              return radius / Math.cos(angleInRadians / 2);
            };
            Polygon2.getPoints = function(numberOfSides, radius, firstCornerAngleInDegrees, circumscribed) {
              if (firstCornerAngleInDegrees === void 0) {
                firstCornerAngleInDegrees = 0;
              }
              if (circumscribed === void 0) {
                circumscribed = false;
              }
              var points = [];
              var a1 = MakerJs2.angle.toRadians(firstCornerAngleInDegrees);
              var a2 = 2 * Math.PI / numberOfSides;
              if (circumscribed) {
                radius = Polygon2.circumscribedRadius(radius, a2);
              }
              for (var i = 0; i < numberOfSides; i++) {
                points.push(MakerJs2.point.fromPolar(a2 * i + a1, radius));
              }
              return points;
            };
            return Polygon2;
          })()
        );
        models2.Polygon = Polygon;
        Polygon.metaParameters = [
          { title: "number of sides", type: "range", min: 3, max: 24, value: 6 },
          { title: "radius", type: "range", min: 1, max: 100, value: 50 },
          { title: "offset angle", type: "range", min: 0, max: 180, value: 0 },
          { title: "radius on flats (vs radius on vertexes)", type: "bool", value: false }
        ];
      })(models = MakerJs2.models || (MakerJs2.models = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var models;
      (function(models2) {
        var Holes = (
          /** @class */
          /* @__PURE__ */ (function() {
            function Holes2(holeRadius, points, ids) {
              this.paths = {};
              for (var i = 0; i < points.length; i++) {
                var id = ids ? ids[i] : i.toString();
                this.paths[id] = new MakerJs2.paths.Circle(points[i], holeRadius);
              }
            }
            return Holes2;
          })()
        );
        models2.Holes = Holes;
        Holes.metaParameters = [
          { title: "holeRadius", type: "range", min: 0.1, max: 10, step: 0.1, value: 1 },
          {
            title: "points",
            type: "select",
            value: [
              [[0, 0], [10, 10], [20, 20], [30, 30], [40, 40], [50, 50], [60, 60], [70, 70], [80, 80]],
              [[0, 0], [0, 25], [0, 50], [0, 75], [0, 100], [25, 50], [50, 50], [75, 50], [100, 100], [100, 75], [100, 50], [100, 25], [100, 0]]
            ]
          }
        ];
      })(models = MakerJs2.models || (MakerJs2.models = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var models;
      (function(models2) {
        var BoltCircle = (
          /** @class */
          /* @__PURE__ */ (function() {
            function BoltCircle2(boltRadius, holeRadius, boltCount, firstBoltAngleInDegrees) {
              if (firstBoltAngleInDegrees === void 0) {
                firstBoltAngleInDegrees = 0;
              }
              this.paths = {};
              var points = models2.Polygon.getPoints(boltCount, boltRadius, firstBoltAngleInDegrees);
              var ids = points.map(function(p2, i) {
                return "bolt " + i;
              });
              this.paths = new models2.Holes(holeRadius, points, ids).paths;
            }
            return BoltCircle2;
          })()
        );
        models2.BoltCircle = BoltCircle;
        BoltCircle.metaParameters = [
          { title: "bolt circle radius", type: "range", min: 1, max: 100, value: 50 },
          { title: "hole radius", type: "range", min: 1, max: 50, value: 5 },
          { title: "bolt count", type: "range", min: 3, max: 24, value: 12 },
          { title: "offset angle", type: "range", min: 0, max: 180, value: 0 }
        ];
      })(models = MakerJs2.models || (MakerJs2.models = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var models;
      (function(models2) {
        var BoltRectangle = (
          /** @class */
          /* @__PURE__ */ (function() {
            function BoltRectangle2(width, height, holeRadius) {
              this.paths = {};
              var points = [[0, 0], [width, 0], [width, height], [0, height]];
              var ids = ["BottomLeft_bolt", "BottomRight_bolt", "TopRight_bolt", "TopLeft_bolt"];
              this.paths = new models2.Holes(holeRadius, points, ids).paths;
            }
            return BoltRectangle2;
          })()
        );
        models2.BoltRectangle = BoltRectangle;
        BoltRectangle.metaParameters = [
          { title: "width", type: "range", min: 1, max: 100, value: 100 },
          { title: "height", type: "range", min: 1, max: 100, value: 50 },
          { title: "hole radius", type: "range", min: 1, max: 50, value: 5 }
        ];
      })(models = MakerJs2.models || (MakerJs2.models = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var models;
      (function(models2) {
        var Dogbone = (
          /** @class */
          /* @__PURE__ */ (function() {
            function Dogbone2(width, height, radius, style, bottomless) {
              if (style === void 0) {
                style = 0;
              }
              if (bottomless === void 0) {
                bottomless = false;
              }
              this.paths = {};
              var maxSide = Math.min(height, width) / 2;
              var maxRadius;
              switch (style) {
                case -1:
                //horizontal
                case 1:
                  maxRadius = maxSide / 2;
                  break;
                case 0:
                //equal
                default:
                  maxRadius = maxSide * Math.SQRT2 / 2;
                  break;
              }
              radius = Math.min(radius, maxRadius);
              var ax;
              var ay;
              var lx;
              var ly;
              var apexes;
              switch (style) {
                case -1:
                  ax = 0;
                  ay = radius;
                  lx = 0;
                  ly = radius * 2;
                  apexes = [180, 0, 0, 180];
                  break;
                case 1:
                  ax = radius;
                  ay = 0;
                  lx = radius * 2;
                  ly = 0;
                  apexes = [270, 270, 90, 90];
                  break;
                case 0:
                default:
                  ax = ay = radius / Math.SQRT2;
                  lx = ly = ax * 2;
                  apexes = [225, 315, 45, 135];
                  break;
              }
              if (bottomless) {
                this.paths["Left"] = new MakerJs2.paths.Line([0, 0], [0, height - ly]);
                this.paths["Right"] = new MakerJs2.paths.Line([width, 0], [width, height - ly]);
              } else {
                this.paths["Left"] = new MakerJs2.paths.Line([0, ly], [0, height - ly]);
                this.paths["Right"] = new MakerJs2.paths.Line([width, ly], [width, height - ly]);
                this.paths["Bottom"] = new MakerJs2.paths.Line([lx, 0], [width - lx, 0]);
                this.paths["BottomLeft"] = new MakerJs2.paths.Arc([ax, ay], radius, apexes[0] - 90, apexes[0] + 90);
                this.paths["BottomRight"] = new MakerJs2.paths.Arc([width - ax, ay], radius, apexes[1] - 90, apexes[1] + 90);
              }
              this.paths["TopRight"] = new MakerJs2.paths.Arc([width - ax, height - ay], radius, apexes[2] - 90, apexes[2] + 90);
              this.paths["TopLeft"] = new MakerJs2.paths.Arc([ax, height - ay], radius, apexes[3] - 90, apexes[3] + 90);
              this.paths["Top"] = new MakerJs2.paths.Line([lx, height], [width - lx, height]);
            }
            return Dogbone2;
          })()
        );
        models2.Dogbone = Dogbone;
        Dogbone.metaParameters = [
          { title: "width", type: "range", min: 1, max: 100, value: 50 },
          { title: "height", type: "range", min: 1, max: 100, value: 100 },
          { title: "radius", type: "range", min: 0, max: 50, value: 5 },
          { title: "style", type: "select", value: [0, 1, -1] },
          { title: "bottomless", type: "bool", value: false }
        ];
      })(models = MakerJs2.models || (MakerJs2.models = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var models;
      (function(models2) {
        var Dome = (
          /** @class */
          /* @__PURE__ */ (function() {
            function Dome2(width, height, radius, bottomless) {
              this.paths = {};
              var w2 = width / 2;
              if (radius < 0)
                radius = 0;
              if (radius === void 0)
                radius = w2;
              radius = Math.min(radius, w2);
              radius = Math.min(radius, height);
              var wt2 = Math.max(w2 - radius, 0);
              var hr = Math.max(height - radius, 0);
              if (!bottomless) {
                this.paths["Bottom"] = new MakerJs2.paths.Line([-w2, 0], [w2, 0]);
              }
              if (hr) {
                this.paths["Left"] = new MakerJs2.paths.Line([-w2, 0], [-w2, hr]);
                this.paths["Right"] = new MakerJs2.paths.Line([w2, 0], [w2, hr]);
              }
              if (radius > 0) {
                this.paths["TopLeft"] = new MakerJs2.paths.Arc([-wt2, hr], radius, 90, 180);
                this.paths["TopRight"] = new MakerJs2.paths.Arc([wt2, hr], radius, 0, 90);
              }
              if (wt2) {
                this.paths["Top"] = new MakerJs2.paths.Line([-wt2, height], [wt2, height]);
              }
            }
            return Dome2;
          })()
        );
        models2.Dome = Dome;
        Dome.metaParameters = [
          { title: "width", type: "range", min: 1, max: 100, value: 50 },
          { title: "height", type: "range", min: 1, max: 100, value: 100 },
          { title: "radius", type: "range", min: 0, max: 50, value: 25 },
          { title: "bottomless", type: "bool", value: false }
        ];
      })(models = MakerJs2.models || (MakerJs2.models = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var models;
      (function(models2) {
        var RoundRectangle = (
          /** @class */
          /* @__PURE__ */ (function() {
            function RoundRectangle2() {
              var args = [];
              for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
              }
              this.paths = {};
              var width;
              var height;
              var radius = 0;
              switch (args.length) {
                case 3:
                  width = args[0];
                  height = args[1];
                  radius = args[2];
                  break;
                case 2:
                  radius = args[1];
                //fall through to 1
                case 1:
                  var m2 = MakerJs2.measure.modelExtents(args[0]);
                  this.origin = MakerJs2.point.subtract(m2.low, [radius, radius]);
                  width = m2.high[0] - m2.low[0] + 2 * radius;
                  height = m2.high[1] - m2.low[1] + 2 * radius;
                  break;
              }
              var maxRadius = Math.min(height, width) / 2;
              radius = Math.min(radius, maxRadius);
              var wr = width - radius;
              var hr = height - radius;
              if (radius > 0) {
                this.paths["BottomLeft"] = new MakerJs2.paths.Arc([radius, radius], radius, 180, 270);
                this.paths["BottomRight"] = new MakerJs2.paths.Arc([wr, radius], radius, 270, 0);
                this.paths["TopRight"] = new MakerJs2.paths.Arc([wr, hr], radius, 0, 90);
                this.paths["TopLeft"] = new MakerJs2.paths.Arc([radius, hr], radius, 90, 180);
              }
              if (wr - radius > 0) {
                this.paths["Bottom"] = new MakerJs2.paths.Line([radius, 0], [wr, 0]);
                this.paths["Top"] = new MakerJs2.paths.Line([wr, height], [radius, height]);
              }
              if (hr - radius > 0) {
                this.paths["Right"] = new MakerJs2.paths.Line([width, radius], [width, hr]);
                this.paths["Left"] = new MakerJs2.paths.Line([0, hr], [0, radius]);
              }
            }
            return RoundRectangle2;
          })()
        );
        models2.RoundRectangle = RoundRectangle;
        RoundRectangle.metaParameters = [
          { title: "width", type: "range", min: 1, max: 100, value: 50 },
          { title: "height", type: "range", min: 1, max: 100, value: 100 },
          { title: "radius", type: "range", min: 0, max: 50, value: 11 }
        ];
      })(models = MakerJs2.models || (MakerJs2.models = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var models;
      (function(models2) {
        var Oval = (
          /** @class */
          /* @__PURE__ */ (function() {
            function Oval2(width, height) {
              this.paths = {};
              this.paths = new models2.RoundRectangle(width, height, Math.min(height / 2, width / 2)).paths;
            }
            return Oval2;
          })()
        );
        models2.Oval = Oval;
        Oval.metaParameters = [
          { title: "width", type: "range", min: 1, max: 100, value: 50 },
          { title: "height", type: "range", min: 1, max: 100, value: 100 }
        ];
      })(models = MakerJs2.models || (MakerJs2.models = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var models;
      (function(models2) {
        var OvalArc = (
          /** @class */
          /* @__PURE__ */ (function() {
            function OvalArc2(startAngle, endAngle, sweepRadius, slotRadius, selfIntersect, isolateCaps) {
              if (selfIntersect === void 0) {
                selfIntersect = false;
              }
              if (isolateCaps === void 0) {
                isolateCaps = false;
              }
              var _this = this;
              this.paths = {};
              var capRoot;
              if (isolateCaps) {
                capRoot = { models: {} };
                this.models = { "Caps": capRoot };
              }
              if (slotRadius <= 0 || sweepRadius <= 0)
                return;
              startAngle = MakerJs2.angle.noRevolutions(startAngle);
              endAngle = MakerJs2.angle.noRevolutions(endAngle);
              if (MakerJs2.round(startAngle - endAngle) == 0)
                return;
              if (endAngle < startAngle)
                endAngle += 360;
              var addCap = function(id, tiltAngle, offsetStartAngle, offsetEndAngle) {
                var capModel;
                if (isolateCaps) {
                  capModel = { paths: {} };
                  capRoot.models[id] = capModel;
                } else {
                  capModel = _this;
                }
                return capModel.paths[id] = new MakerJs2.paths.Arc(MakerJs2.point.fromPolar(MakerJs2.angle.toRadians(tiltAngle), sweepRadius), slotRadius, tiltAngle + offsetStartAngle, tiltAngle + offsetEndAngle);
              };
              var addSweep = function(id, offsetRadius) {
                return _this.paths[id] = new MakerJs2.paths.Arc([0, 0], sweepRadius + offsetRadius, startAngle, endAngle);
              };
              addSweep("Outer", slotRadius);
              var hasInner = sweepRadius - slotRadius > 0;
              if (hasInner) {
                addSweep("Inner", -slotRadius);
              }
              var caps = [];
              caps.push(addCap("StartCap", startAngle, 180, 0));
              caps.push(addCap("EndCap", endAngle, 0, 180));
              var d2 = MakerJs2.measure.pointDistance(caps[0].origin, caps[1].origin);
              if (d2 / 2 < slotRadius) {
                var int = MakerJs2.path.intersection(caps[0], caps[1]);
                if (int) {
                  if (!hasInner || !selfIntersect) {
                    caps[0].startAngle = int.path1Angles[0];
                    caps[1].endAngle = int.path2Angles[0];
                  }
                  if (!selfIntersect && hasInner && int.intersectionPoints.length == 2) {
                    addCap("StartCap2", startAngle, 180, 0).endAngle = int.path1Angles[1];
                    addCap("EndCap2", endAngle, 0, 180).startAngle = int.path2Angles[1] + 360;
                  }
                }
              }
            }
            return OvalArc2;
          })()
        );
        models2.OvalArc = OvalArc;
        OvalArc.metaParameters = [
          { title: "start angle", type: "range", min: -360, max: 360, step: 1, value: 180 },
          { title: "end angle", type: "range", min: -360, max: 360, step: 1, value: 0 },
          { title: "sweep", type: "range", min: 0, max: 100, step: 1, value: 50 },
          { title: "radius", type: "range", min: 0, max: 100, step: 1, value: 15 },
          { title: "self intersect", type: "bool", value: false }
        ];
      })(models = MakerJs2.models || (MakerJs2.models = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var models;
      (function(models2) {
        var Rectangle = (
          /** @class */
          /* @__PURE__ */ (function() {
            function Rectangle2() {
              var args = [];
              for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
              }
              this.paths = {};
              var width;
              var height;
              if (args.length === 2 && !MakerJs2.isObject(args[0])) {
                width = args[0];
                height = args[1];
              } else {
                var margin = 0;
                var m2;
                if (MakerJs2.isModel(args[0])) {
                  m2 = MakerJs2.measure.modelExtents(args[0]);
                  if (args.length === 2) {
                    margin = args[1];
                  }
                } else {
                  m2 = args[0];
                }
                this.origin = MakerJs2.point.subtract(m2.low, [margin, margin]);
                width = m2.high[0] - m2.low[0] + 2 * margin;
                height = m2.high[1] - m2.low[1] + 2 * margin;
              }
              this.paths = new models2.ConnectTheDots(true, [[0, 0], [width, 0], [width, height], [0, height]]).paths;
            }
            return Rectangle2;
          })()
        );
        models2.Rectangle = Rectangle;
        Rectangle.metaParameters = [
          { title: "width", type: "range", min: 1, max: 100, value: 50 },
          { title: "height", type: "range", min: 1, max: 100, value: 100 }
        ];
      })(models = MakerJs2.models || (MakerJs2.models = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var models;
      (function(models2) {
        var Ring = (
          /** @class */
          /* @__PURE__ */ (function() {
            function Ring2(outerRadius, innerRadius) {
              this.paths = {};
              var radii = {
                "Ring_outer": outerRadius,
                "Ring_inner": innerRadius
              };
              for (var id in radii) {
                var r2 = radii[id];
                if (r2 === void 0 || r2 <= 0)
                  continue;
                this.paths[id] = new MakerJs2.paths.Circle(MakerJs2.point.zero(), r2);
              }
            }
            return Ring2;
          })()
        );
        models2.Ring = Ring;
        Ring.metaParameters = [
          { title: "outer radius", type: "range", min: 0, max: 100, step: 1, value: 50 },
          { title: "inner radius", type: "range", min: 0, max: 100, step: 1, value: 20 }
        ];
      })(models = MakerJs2.models || (MakerJs2.models = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var models;
      (function(models2) {
        var Belt = (
          /** @class */
          /* @__PURE__ */ (function() {
            function Belt2(leftRadius, distance, rightRadius) {
              this.paths = {};
              var left = new MakerJs2.paths.Arc([0, 0], leftRadius, 0, 360);
              var right = new MakerJs2.paths.Arc([distance, 0], rightRadius, 0, 360);
              var angles = MakerJs2.solvers.circleTangentAngles(left, right);
              if (!angles) {
                this.paths["Belt"] = new MakerJs2.paths.Circle(Math.max(leftRadius, rightRadius));
              } else {
                angles = angles.sort(function(a2, b2) {
                  return a2 - b2;
                });
                left.startAngle = angles[0];
                left.endAngle = angles[1];
                right.startAngle = angles[1];
                right.endAngle = angles[0];
                this.paths["Left"] = left;
                this.paths["Right"] = right;
                this.paths["Top"] = new MakerJs2.paths.Line(MakerJs2.point.fromAngleOnCircle(angles[0], left), MakerJs2.point.fromAngleOnCircle(angles[0], right));
                this.paths["Bottom"] = new MakerJs2.paths.Line(MakerJs2.point.fromAngleOnCircle(angles[1], left), MakerJs2.point.fromAngleOnCircle(angles[1], right));
              }
            }
            return Belt2;
          })()
        );
        models2.Belt = Belt;
        Belt.metaParameters = [
          { title: "left radius", type: "range", min: 0, max: 100, value: 30 },
          { title: "distance between centers", type: "range", min: 0, max: 100, value: 50 },
          { title: "right radius", type: "range", min: 0, max: 100, value: 15 }
        ];
      })(models = MakerJs2.models || (MakerJs2.models = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var models;
      (function(models2) {
        var SCurve = (
          /** @class */
          /* @__PURE__ */ (function() {
            function SCurve2(width, height) {
              this.paths = {};
              function findRadius(x2, y2) {
                return x2 + (y2 * y2 - x2 * x2) / (2 * x2);
              }
              var h2 = height / 2;
              var w2 = width / 2;
              var radius;
              var startAngle;
              var endAngle;
              var arcOrigin;
              if (width > height) {
                radius = findRadius(h2, w2);
                startAngle = 270;
                endAngle = 360 - MakerJs2.angle.toDegrees(Math.acos(w2 / radius));
                arcOrigin = [0, radius];
              } else {
                radius = findRadius(w2, h2);
                startAngle = 180 - MakerJs2.angle.toDegrees(Math.asin(h2 / radius));
                endAngle = 180;
                arcOrigin = [radius, 0];
              }
              var curve = new MakerJs2.paths.Arc(arcOrigin, radius, startAngle, endAngle);
              this.paths["curve_start"] = curve;
              this.paths["curve_end"] = MakerJs2.path.moveRelative(MakerJs2.path.mirror(curve, true, true), [width, height]);
            }
            return SCurve2;
          })()
        );
        models2.SCurve = SCurve;
        SCurve.metaParameters = [
          { title: "width", type: "range", min: 1, max: 100, value: 50 },
          { title: "height", type: "range", min: 1, max: 100, value: 100 }
        ];
      })(models = MakerJs2.models || (MakerJs2.models = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var models;
      (function(models2) {
        var Slot = (
          /** @class */
          /* @__PURE__ */ (function() {
            function Slot2(origin, endPoint, radius, isolateCaps) {
              if (isolateCaps === void 0) {
                isolateCaps = false;
              }
              var _this = this;
              this.paths = {};
              var capRoot;
              if (isolateCaps) {
                capRoot = { models: {} };
                this.models = { "Caps": capRoot };
              }
              var addCap = function(id, capPath) {
                var capModel;
                if (isolateCaps) {
                  capModel = { paths: {} };
                  capRoot.models[id] = capModel;
                } else {
                  capModel = _this;
                }
                capModel.paths[id] = capPath;
              };
              var a2 = MakerJs2.angle.ofPointInDegrees(origin, endPoint);
              var len = MakerJs2.measure.pointDistance(origin, endPoint);
              this.paths["Top"] = new MakerJs2.paths.Line([0, radius], [len, radius]);
              this.paths["Bottom"] = new MakerJs2.paths.Line([0, -radius], [len, -radius]);
              addCap("StartCap", new MakerJs2.paths.Arc([0, 0], radius, 90, 270));
              addCap("EndCap", new MakerJs2.paths.Arc([len, 0], radius, 270, 90));
              MakerJs2.model.rotate(this, a2, [0, 0]);
              this.origin = origin;
            }
            return Slot2;
          })()
        );
        models2.Slot = Slot;
        Slot.metaParameters = [
          {
            title: "origin",
            type: "select",
            value: [
              [0, 0],
              [10, 0],
              [10, 10]
            ]
          },
          {
            title: "end",
            type: "select",
            value: [
              [80, 0],
              [0, 30],
              [10, 30]
            ]
          },
          { title: "radius", type: "range", min: 1, max: 50, value: 10 }
        ];
      })(models = MakerJs2.models || (MakerJs2.models = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var models;
      (function(models2) {
        var Square = (
          /** @class */
          /* @__PURE__ */ (function() {
            function Square2(side) {
              this.paths = {};
              this.paths = new models2.Rectangle(side, side).paths;
            }
            return Square2;
          })()
        );
        models2.Square = Square;
        Square.metaParameters = [
          { title: "side", type: "range", min: 1, max: 100, value: 100 }
        ];
      })(models = MakerJs2.models || (MakerJs2.models = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var models;
      (function(models2) {
        var Star = (
          /** @class */
          (function() {
            function Star2(numberOfPoints, outerRadius, innerRadius, skipPoints) {
              if (skipPoints === void 0) {
                skipPoints = 2;
              }
              this.paths = {};
              if (!innerRadius) {
                innerRadius = outerRadius * Star2.InnerRadiusRatio(numberOfPoints, skipPoints);
              }
              var outerPoints = models2.Polygon.getPoints(numberOfPoints, outerRadius);
              var innerPoints = models2.Polygon.getPoints(numberOfPoints, innerRadius, 180 / numberOfPoints);
              var allPoints = [];
              for (var i = 0; i < numberOfPoints; i++) {
                allPoints.push(outerPoints[i]);
                allPoints.push(innerPoints[i]);
              }
              var model = new models2.ConnectTheDots(true, allPoints);
              this.paths = model.paths;
              delete model.paths;
            }
            Star2.InnerRadiusRatio = function(numberOfPoints, skipPoints) {
              if (numberOfPoints > 0 && skipPoints > 1 && skipPoints < numberOfPoints / 2) {
                return Math.cos(Math.PI * skipPoints / numberOfPoints) / Math.cos(Math.PI * (skipPoints - 1) / numberOfPoints);
              }
              return 0;
            };
            return Star2;
          })()
        );
        models2.Star = Star;
        Star.metaParameters = [
          { title: "number of sides", type: "range", min: 3, max: 24, value: 8 },
          { title: "outer radius", type: "range", min: 1, max: 100, value: 50 },
          { title: "inner radius", type: "range", min: 0, max: 100, value: 15 },
          { title: "skip points (when inner radius is zero)", type: "range", min: 0, max: 12, value: 2 }
        ];
      })(models = MakerJs2.models || (MakerJs2.models = {}));
    })(MakerJs || (MakerJs = {}));
    var MakerJs;
    (function(MakerJs2) {
      var models;
      (function(models2) {
        var Text = (
          /** @class */
          (function() {
            function Text2(font, text, fontSize, combine, centerCharacterOrigin, bezierAccuracy, opentypeOptions) {
              if (combine === void 0) {
                combine = false;
              }
              if (centerCharacterOrigin === void 0) {
                centerCharacterOrigin = false;
              }
              var _this = this;
              this.models = {};
              var charIndex = 0;
              var prevDeleted;
              var prevChar;
              var cb = function(glyph2, x2, y2, _fontSize, options) {
                var charModel = Text2.glyphToModel(glyph2, _fontSize, bezierAccuracy, font);
                charModel.origin = [x2, 0];
                if (centerCharacterOrigin && (charModel.paths || charModel.models)) {
                  var m2 = MakerJs2.measure.modelExtents(charModel);
                  if (m2) {
                    var w2 = m2.high[0] - m2.low[0];
                    MakerJs2.model.originate(charModel, [m2.low[0] + w2 / 2, 0]);
                  }
                }
                if (combine && charIndex > 0) {
                  var combineOptions = {};
                  var prev;
                  if (prevDeleted) {
                    prev = {
                      models: {
                        deleted: prevDeleted,
                        char: prevChar
                      }
                    };
                  } else {
                    prev = prevChar;
                  }
                  MakerJs2.model.combine(prev, charModel, false, true, false, true, combineOptions);
                  prevDeleted = combineOptions.out_deleted[1];
                }
                _this.models[charIndex] = charModel;
                charIndex++;
                prevChar = charModel;
              };
              if (font.layout && typeof font.layout === "function") {
                var fontkitFont = font;
                var layoutOpts = opentypeOptions;
                var run = fontkitFont.layout(text, layoutOpts === null || layoutOpts === void 0 ? void 0 : layoutOpts.features, layoutOpts === null || layoutOpts === void 0 ? void 0 : layoutOpts.script, layoutOpts === null || layoutOpts === void 0 ? void 0 : layoutOpts.language, layoutOpts === null || layoutOpts === void 0 ? void 0 : layoutOpts.direction);
                var scale = fontSize / fontkitFont.unitsPerEm;
                var currentX = 0;
                for (var i = 0; i < run.glyphs.length; i++) {
                  var glyph = run.glyphs[i];
                  var position = run.positions[i];
                  var glyphX = currentX + (position.xOffset || 0) * scale;
                  var glyphY = (position.yOffset || 0) * scale;
                  cb(glyph, glyphX, glyphY, fontSize, opentypeOptions);
                  currentX += (position.xAdvance || 0) * scale;
                }
              } else {
                var opentypeFont = font;
                opentypeFont.forEachGlyph(text, 0, 0, fontSize, opentypeOptions, cb);
              }
            }
            Text2.glyphToModel = function(glyph, fontSize, bezierAccuracy, font) {
              var charModel = {};
              var firstPoint;
              var currPoint;
              var pathCount = 0;
              function addPath(p3, layer) {
                if (!charModel.paths) {
                  charModel.paths = {};
                }
                if (layer) {
                  if (!charModel.layer)
                    charModel.layer = layer;
                }
                charModel.paths["p_" + ++pathCount] = p3;
              }
              function addModel(m2, layer) {
                if (!charModel.models) {
                  charModel.models = {};
                }
                if (layer) {
                  if (!charModel.layer)
                    charModel.layer = layer;
                }
                charModel.models["p_" + ++pathCount] = m2;
              }
              var isFontkitGlyph = glyph.path && !glyph.getPath;
              var p2;
              if (isFontkitGlyph && font) {
                var scale_1 = fontSize / font.unitsPerEm;
                p2 = glyph.path;
                if (glyph.layers && glyph.layers.length > 0) {
                  glyph.layers.forEach(function(layer, layerIndex) {
                    var layerGlyph = font.getGlyph(layer.glyph);
                    var layerPath = layerGlyph.path;
                    if (layerPath && layerPath.commands) {
                      var layerColor = void 0;
                      if (font["COLR"] && font["CPAL"] && layer.color !== void 0) {
                        var cpal = font["CPAL"];
                        var colorPalettes = cpal.colorPalettes || cpal.colorRecords;
                        if (colorPalettes && colorPalettes.length > 0) {
                          var palette = colorPalettes[0];
                          if (palette && palette.length > layer.color) {
                            var color = palette[layer.color];
                            if (color) {
                              var red = color.red !== void 0 ? color.red : color.r || 0;
                              var green = color.green !== void 0 ? color.green : color.g || 0;
                              var blue = color.blue !== void 0 ? color.blue : color.b || 0;
                              layerColor = "color_".concat(red.toString(16).padStart(2, "0")).concat(green.toString(16).padStart(2, "0")).concat(blue.toString(16).padStart(2, "0"));
                            }
                          }
                        }
                      }
                      var layerFirstPoint = void 0;
                      var layerCurrPoint = void 0;
                      for (var _i2 = 0, _a2 = layerPath.commands; _i2 < _a2.length; _i2++) {
                        var cmd2 = _a2[_i2];
                        var points2 = Text2.convertFontkitCommand(cmd2, scale_1);
                        switch (cmd2.command) {
                          case "moveTo":
                            layerFirstPoint = points2[0];
                            layerCurrPoint = points2[0];
                            break;
                          case "closePath":
                            points2[0] = layerFirstPoint;
                          // fall through to line
                          case "lineTo":
                            if (layerCurrPoint && !MakerJs2.measure.isPointEqual(layerCurrPoint, points2[0])) {
                              addPath(new MakerJs2.paths.Line(layerCurrPoint, points2[0]), layerColor);
                            }
                            layerCurrPoint = points2[0];
                            break;
                          case "bezierCurveTo":
                            if (layerCurrPoint) {
                              addModel(new models2.BezierCurve(layerCurrPoint, points2[0], points2[1], points2[2], bezierAccuracy), layerColor);
                            }
                            layerCurrPoint = points2[2];
                            break;
                          case "quadraticCurveTo":
                            if (layerCurrPoint) {
                              addModel(new models2.BezierCurve(layerCurrPoint, points2[0], points2[1], bezierAccuracy), layerColor);
                            }
                            layerCurrPoint = points2[1];
                            break;
                        }
                      }
                    }
                  });
                  return charModel;
                }
                if (!p2 || !p2.commands) {
                  return charModel;
                }
                for (var _i = 0, _a = p2.commands; _i < _a.length; _i++) {
                  var cmd = _a[_i];
                  var points = Text2.convertFontkitCommand(cmd, scale_1);
                  switch (cmd.command) {
                    case "moveTo":
                      firstPoint = points[0];
                      currPoint = points[0];
                      break;
                    case "closePath":
                      points[0] = firstPoint;
                    // fall through to line
                    case "lineTo":
                      if (!MakerJs2.measure.isPointEqual(currPoint, points[0])) {
                        addPath(new MakerJs2.paths.Line(currPoint, points[0]));
                      }
                      currPoint = points[0];
                      break;
                    case "bezierCurveTo":
                      addModel(new models2.BezierCurve(currPoint, points[0], points[1], points[2], bezierAccuracy));
                      currPoint = points[2];
                      break;
                    case "quadraticCurveTo":
                      addModel(new models2.BezierCurve(currPoint, points[0], points[1], bezierAccuracy));
                      currPoint = points[1];
                      break;
                  }
                }
              } else {
                p2 = glyph.getPath(0, 0, fontSize);
                p2.commands.map(function(command, i) {
                  var points2 = [[command.x, command.y], [command.x1, command.y1], [command.x2, command.y2]].map(function(p3) {
                    if (p3[0] !== void 0) {
                      return MakerJs2.point.mirror(p3, false, true);
                    }
                  });
                  switch (command.type) {
                    case "M":
                      firstPoint = points2[0];
                      break;
                    case "Z":
                      points2[0] = firstPoint;
                    //fall through to line
                    case "L":
                      if (!MakerJs2.measure.isPointEqual(currPoint, points2[0])) {
                        addPath(new MakerJs2.paths.Line(currPoint, points2[0]));
                      }
                      break;
                    case "C":
                      addModel(new models2.BezierCurve(currPoint, points2[1], points2[2], points2[0], bezierAccuracy));
                      break;
                    case "Q":
                      addModel(new models2.BezierCurve(currPoint, points2[1], points2[0], bezierAccuracy));
                      break;
                  }
                  currPoint = points2[0];
                });
              }
              return charModel;
            };
            Text2.convertFontkitCommand = function(cmd, scale) {
              var points = [];
              switch (cmd.command) {
                case "moveTo":
                case "lineTo":
                  points.push([cmd.args[0] * scale, cmd.args[1] * scale]);
                  break;
                case "quadraticCurveTo":
                  points.push([cmd.args[0] * scale, cmd.args[1] * scale]);
                  points.push([cmd.args[2] * scale, cmd.args[3] * scale]);
                  break;
                case "bezierCurveTo":
                  points.push([cmd.args[0] * scale, cmd.args[1] * scale]);
                  points.push([cmd.args[2] * scale, cmd.args[3] * scale]);
                  points.push([cmd.args[4] * scale, cmd.args[5] * scale]);
                  break;
              }
              return points;
            };
            return Text2;
          })()
        );
        models2.Text = Text;
        Text.metaParameters = [
          { title: "font", type: "font", value: "*" },
          { title: "text", type: "text", value: "Hello" },
          { title: "font size", type: "range", min: 10, max: 200, value: 72 },
          { title: "combine", type: "bool", value: false },
          { title: "center character origin", type: "bool", value: false }
        ];
      })(models = MakerJs2.models || (MakerJs2.models = {}));
    })(MakerJs || (MakerJs = {}));
    MakerJs.version = "0.19.2";
    var Bezier = require_bezier_js();
  }
});

// vendor/plan/planPrinciples.ts
var CORE_PLANNING = {
  /**
   * 층고 — 계단 단수를 정하고, 그 단수가 계단실 깊이를 정한다.
   *
   * **전 층이 같은 값이다.** 예전에는 1층 4,200·기준층 3,600으로 갈랐는데, 계단실은
   * 가장 높은 층이 지배하므로 1층 층고 혼자 코어 깊이를 끌어올리고 있었다.
   */
  floorHeightMm: {
    housing: 2500,
    shop: 3200,
    largeShop: 3500,
    /** 이 바닥면적 합계(㎡)부터 대형상가로 본다 */
    largeShopFromM2: 2e3,
    source: "\uC0AC\uC6A9\uC790(\uAC74\uCD95\uC0AC) \uC9C0\uC815 2026-08-03 \u2014 \uC8FC\uD0DD 2.5m / \uC0C1\uAC00 3.2m / \uB300\uD615\uC0C1\uAC00 3.5m"
  },
  /**
   * 코어를 도로면에 붙이는 규모 상한(바닥면적 합계 ㎡).
   *
   * 이 아래는 각론 M2·M3(계단실은 도로에서 직접 진입 / 코어를 안쪽에 넣으면 연결이 끊긴다)를
   * 자리로 지킨다. 이 이상이면 S3(채광 불리한 쪽)이 우선이라 여기서 정하지 않는다.
   */
  coreAtRoadUnderM2: { value: 2e3, source: "\uC0AC\uC6A9\uC790 \uC9C0\uC815 \u2014 \uB300\uD615\uC73C\uB85C \uBCF4\uB294 \uC120\uACFC \uAC19\uB2E4(2026-08-03)" },
  /** 계단 한 단 — 용도별 법정 상한이 있으면 planRules.stairDimensions가 이긴다 */
  riserMm: { value: 180, source: "\uAC01\uB860 \uD1B5\uC6A9 \uB2E8\uB192\uC774 18cm \uC774\uD558" },
  treadMm: { value: 300, source: "\uC0AC\uBB34\uC18C \uC2E4\uC801 \u2014 \uACC4\uB2E8 \uC0C1\uC138\uB3C4 146\uAC74 \uCD5C\uBE48(\uC911\uC559\uAC12\uB3C4 300)" },
  /** U자형 2런 — 6m 안팎 폭의 소규모 필지에서 직선 1런은 깊이가 나오지 않는다 */
  stairRuns: { value: 2, wellMm: 200, source: "\uAC01\uB860 \uACC4\uB2E8 \uD615\uC2DD (\uB450 \uB7F0 \uC0AC\uC774 \uB09C\uAC04\xB7\uBCBD \uC5EC\uC720 200)" },
  /** 대변기 칸 — 장애인용 칸은 planRules.ACCESSIBLE_DIMS(법정)를 쓴다 */
  toiletStallMm: { widthMm: 900, depthMm: 1350, source: "\uAC01\uB860 \uD1B5\uC6A9 \uB300\uBCC0\uAE30 \uCE78" },
  urinalWidthMm: { value: 700, source: "\uAC01\uB860 \uD1B5\uC6A9 \uC18C\uBCC0\uAE30 1\uAC1C\uC18C" },
  lavatoryWidthMm: { value: 700, source: "\uAC01\uB860 \uD1B5\uC6A9 \uC138\uBA74\uB300 1\uB300" },
  toiletAisleMm: { value: 900, source: "\uAC01\uB860 \uD1B5\uC6A9 \uCE78 \uC55E \uD1B5\uB85C (1\uC778 \uD1B5\uD589)" },
  /**
   * 홀·통로 계획폭 — **법정 하한이 없을 때만** 쓴다.
   * planRules.corridorWidth가 0을 돌려주는 층(200㎡ 미만 · 다중이용업 아님 · 편의법 권장)이 그렇다.
   */
  passageMm: {
    value: 1200,
    source: "\uD3B8\uC758\uC2DC\uC124 \uC0C1\uC138\uD45C\uC900\uB3C4 \uD1B5\uD589 \uC18C\uC694\uD3ED(\uBAA9\uBC1C 1,050)\uC5D0 \uC5EC\uC720\uB97C \uB354\uD55C \uACC4\uD68D\uAC12 \u2014 \uBC95\uC815 \uCD5C\uC18C\uAC00 \uC544\uB2C8\uB2E4"
  },
  /** 실로 쓰기에 너무 얕은 띠 — 이보다 얕으면 별도 실로 만들지 않고 홀에 흡수한다 */
  minRoomDepthMm: { value: 1500, source: "\uAC01\uB860 \u2014 \uD1B5\uD589\uD3ED\uC5D0\uB3C4 \uBABB \uBBF8\uCE58\uB294 \uAE4A\uC774\uB294 \uC2E4\uC774 \uC544\uB2C8\uB2E4" },
  /**
   * 사무·교육 실의 최소 한 변 — **계획값이다(법정 아님).**
   *
   * 1,500만 보면 깊이 1.7m짜리 "사무실"이 통과한다(10.5×9.2m 사무소에서 실제로
   * 8.1㎡ 띠방 여섯이 나왔다). 책상 한 조(700+의자 여유 560)와 통로(1,200)가
   * 앞뒤로 놓이려면 이만큼은 있어야 실이다. FIXTURES 치수의 조합값.
   */
  minOfficeRoomMm: { value: 2500, source: "\uACC4\uD68D\uAC12 \u2014 \uCC45\uC0C1(700)+\uC758\uC790(560)+\uD1B5\uB85C(1,200) \uC870\uD569. \uBC95\uC815 \uAE30\uC900 \uC544\uB2D8" },
  /**
   * 침실 한 줄의 최소 깊이. 주택층에서 침실대를 몇 줄 놓을지 이 값으로 가른다.
   * 이보다 얕게 나누면 침대가 안 들어가는 방이 나온다(90㎡ 3층에서 안방 5.1㎡가 나왔다).
   */
  bedroomRowMm: {
    value: 2600,
    source: "\uC0AC\uC6A9\uC790(\uAC74\uCD95\uC0AC) \uD655\uC815 2026-08-05 \u2014 \uCE68\uB300 \uAE38\uC774 2,000(FIXTURES.bedSingle) + \uCE68\uB300 \uC606 \uD1B5\uB85C 600"
  },
  /**
   * 기둥을 세우는 최대 스팬. 이보다 짧으면 **중간 기둥을 두지 않는다.**
   * 기계적으로 반씩 쪼개 기둥을 세웠더니 폭 6m 건물에서 기둥이 홀 한가운데(유효폭 1,300 중
   * 400 잠식)와 필로티 주차 구간에 섰다. 안 세워도 되는 기둥이 평면을 망친다.
   */
  /**
   * 창 계획값 — **법정 치수가 아니다.** 도면에 창을 그리기 위한 표현값이고, 채광·환기
   * 면적 기준(영 제51조제1항 대상 용도의 시행규칙 제17조)은 planRules.daylightRule이
   * 따로 본다. 여기 값으로 그 비율을 만족한다고 말하면 안 된다.
   */
  windowMm: {
    /** 창 한 짝의 최대 폭 — 이보다 긴 벽은 여러 짝으로 나눈다 */
    maxWidthMm: 2400,
    /** 모서리에서 띄우는 거리 — 기둥(400)과 마감이 서는 자리다 */
    cornerMarginMm: 600,
    /** 벽 길이 중 창이 차지하는 비율 */
    coverage: 0.6,
    /** 창대·창 상단 높이 — 단면도에서만 쓴다(평면은 높이를 그리지 않는다) */
    sillMm: 900,
    headMm: 2100,
    source: "\uACC4\uD68D\uAC12 \u2014 \uAE30\uD68D \uB3C4\uBA74 \uD45C\uD604\uC6A9. \uBC95\uC815 \uAE30\uC900\uC774 \uC544\uB2C8\uBA70 \uCC3D\uD638 \uC0C1\uC138\uB294 \uC124\uACC4\uC5D0\uC11C \uC815\uD55C\uB2E4"
  },
  maxSpanMm: {
    value: 7800,
    // 원문 대조(10권 p16~17)로 "각론 6~8m 안"이 부정확함을 확인 — 원문은 RC 정사각 6~7m(5~6m),
    // SRC 7~9m, 직사각 보방향 7.5~9m. 7.8m는 RC 정사각 범위 밖이지만 값의 주근거는 실적이므로 유지.
    source: "\uC0AC\uBB34\uC18C \uC2E4\uC801 \u2014 \uD3C9\uBA74\uB3C4 456\uAC74 \uC911 \uCD5C\uBE48 76\uAC74 (\uAC01\uB860 \uC6D0\uBB38 RC 6~7m\xB7SRC 7~9m, 10\uAD8C p16)"
  },
  /**
   * 승용승강기 승강로 평면 개산 — **계획값이다(법정 아님).**
   *
   * 법(제64조)은 설치 의무·대수만 정하고 승강로 평면 치수는 기종(제조사 사양)이 정한다.
   * 장애인 겸용으로 흔히 쓰는 13인승급 승강로가 대략 2.1×2.2m라 2,200각으로 잡는다.
   * 기종 선정 후 제조사 승강로 도면으로 확정할 것 — 방침에도 개산임을 밝힌다.
   */
  elevatorMm: {
    widthMm: 2200,
    depthMm: 2200,
    source: "13\uC778\uC2B9 \uC7A5\uC560\uC778 \uACB8\uC6A9\uAE09 \uC2B9\uAC15\uB85C \uD45C\uC900 \uD3C9\uBA74 \uC218\uC900\uC758 \uAC1C\uC0B0 \u2014 \uAE30\uC885 \uD655\uC815 \uC804 \uACC4\uD68D\uAC12"
  }
};
var FIXTURES = {
  toilet: { wMm: 400, dMm: 700 },
  lavatory: { wMm: 550, dMm: 450 },
  bathtub: { wMm: 1700, dMm: 800 },
  /** 주방 카운터 — 길이는 실 폭에 맞춰 잘라 쓴다 */
  counter: { maxWMm: 2400, dMm: 600 },
  diningTable: { wMm: 1200, dMm: 800 },
  bedDouble: { wMm: 1500, dMm: 2e3 },
  bedSingle: { wMm: 1e3, dMm: 2e3 },
  sofa: { wMm: 1800, dMm: 850 },
  coffeeTable: { wMm: 1e3, dMm: 500 },
  /** 사무 책상(1인) + 의자 반지름 */
  desk: { wMm: 1400, dMm: 700 },
  chairRMm: 230,
  /** 매장 진열대 — 길이는 실 폭에 맞춰 잘라 쓴다 */
  shelf: { dMm: 600, maxWMm: 9e3 },
  /** 매장 계산대 */
  shopCounter: { wMm: 1800, dMm: 700 },
  /** 강의실 책상(2인용) + 교탁 */
  classDesk: { wMm: 1200, dMm: 450 },
  lectern: { wMm: 1200, dMm: 600 },
  /** 가구 열 사이를 지나는 통로 — 표현용 간격이지 법정 유효너비가 아니다 */
  aisleMm: 1200,
  /** 기구와 벽 사이 최소 여유 — 이보다 좁으면 그리지 않는다 */
  clearanceMm: 250,
  source: "\uAE30\uD68D \uB3C4\uBA74 \uD45C\uC2DC\uC6A9 \uB300\uD45C \uCE58\uC218 \u2014 \uBC95\uC815 \uCE58\uC218\uB3C4 \uC81C\uD488 \uADDC\uACA9\uB3C4 \uC544\uB2C8\uB2E4"
};

// vendor/plan/planOpenings.ts
var WIN = CORE_PLANNING.windowMm;
var DOOR_HEAD_MM = 2100;
var PREFIX = { window: "W", door: "D", entrance: "E" };
function heightsFor(o2) {
  if (o2.sillMm != null && o2.headMm != null) return { sillMm: o2.sillMm, headMm: o2.headMm };
  return o2.kind === "window" ? { sillMm: WIN.sillMm, headMm: WIN.headMm } : { sillMm: 0, headMm: DOOR_HEAD_MM };
}
var typeKey = (o2, sillMm, headMm) => `${o2.kind}|${Math.round(o2.width)}|${sillMm}|${headMm}|${o2.swing ? "sw" : "-"}`;
function assignOpeningIds(plans) {
  const types = /* @__PURE__ */ new Map();
  for (const p2 of plans) {
    for (const o2 of p2.openings) {
      const h2 = heightsFor(o2);
      const key = typeKey(o2, h2.sillMm, h2.headMm);
      if (!types.has(key)) {
        types.set(key, { kind: o2.kind, widthMm: Math.round(o2.width), ...h2 });
      }
    }
  }
  const typeIdByKey = /* @__PURE__ */ new Map();
  for (const kind of ["window", "door", "entrance"]) {
    const ofKind = [...types.entries()].filter(([, t2]) => t2.kind === kind).sort(([, a2], [, b2]) => b2.widthMm - a2.widthMm || b2.headMm - a2.headMm || a2.sillMm - b2.sillMm);
    ofKind.forEach(([key], i) => typeIdByKey.set(key, `${PREFIX[kind]}${i + 1}`));
  }
  const seq = /* @__PURE__ */ new Map();
  return plans.map((p2) => ({
    ...p2,
    openings: p2.openings.map((o2) => {
      const h2 = heightsFor(o2);
      const typeId = typeIdByKey.get(typeKey(o2, h2.sillMm, h2.headMm));
      const n = (seq.get(typeId) ?? 0) + 1;
      seq.set(typeId, n);
      return { ...o2, ...h2, typeId, id: `${typeId}-${n}` };
    })
  }));
}

// vendor/plan/sheet.ts
function make(no, title) {
  const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  return {
    no,
    discipline: "A",
    title,
    scale: "N.S.",
    issuedAt: date,
    revisions: [{ rev: 0, date, note: "\uC790\uB3D9\uC0DD\uC131 \uCD08\uD310" }],
    drawnBy: "\uC790\uB3D9\uC791\uC131",
    checkedBy: "\uAC74\uCD95\uC0AC \uD655\uC778 \uC804"
  };
}
function siteSheet() {
  return make("A-001", "\uBC30\uCE58\uB3C4");
}
function planSheet(index, label) {
  return make(`A-${101 + index}`, `${label} \uD3C9\uBA74\uB3C4`);
}
var ELEVATION_ORDER = ["front", "back", "left", "right"];
function elevationSheetNo(index) {
  return `A-${201 + index}`;
}
var SECTION_SHEET_NO = "A-301";
function elevationSheet(index, title) {
  return make(elevationSheetNo(index), title);
}
function sectionSheet() {
  return make(SECTION_SHEET_NO, "\uC8FC\uB2E8\uBA74\uB3C4");
}
function openingScheduleSheet() {
  return make("A-601", "\uCC3D\uD638\uC77C\uB78C\uD45C");
}

// vendor/plan/planLayout.ts
function poly(name, points, program) {
  const xs2 = points.map((p2) => p2[0]);
  const ys2 = points.map((p2) => p2[1]);
  const x2 = Math.min(...xs2);
  const y2 = Math.min(...ys2);
  return { name, points, x: x2, y: y2, w: Math.max(...xs2) - x2, h: Math.max(...ys2) - y2, program };
}
function rect(name, x2, y2, w2, h2, program) {
  return {
    name,
    points: [
      [x2, y2],
      [x2 + w2, y2],
      [x2 + w2, y2 + h2],
      [x2, y2 + h2]
    ],
    x: x2,
    y: y2,
    w: w2,
    h: h2,
    program
  };
}
var DEFAULT_BUILDING = {
  widthMm: 8e3,
  depthMm: 16500,
  extWallMm: 200,
  intWallMm: 100,
  columnMm: 400,
  maxSpanMm: 8e3,
  window: { maxWidthMm: 2400, cornerMarginMm: 600, coverage: 0.6 },
  // planCompose가 층고·법정 치수에서 계산해 덮어쓴다. 여기 값은 계산이 없을 때의 최소 골격일 뿐이다.
  core: {
    depthMm: 3800,
    stairWidthMm: 1200,
    stairBayMm: 2600,
    anteBayMm: 0,
    landingMm: 1200,
    treadsPerRun: 10,
    wellMm: 200,
    wetBayMm: 2e3,
    wetDepthMm: 2300,
    evCount: 0,
    evShaftWmm: 0,
    evDepthMm: 0,
    stairDoorMm: 900
  },
  floors: []
};
function hWall(x1, x2, y2, t2, kind) {
  return { a: [x1, y2], b: [x2, y2], thickness: t2, kind };
}
function vWall(x2, y1, y2, t2, kind) {
  return { a: [x2, y1], b: [x2, y2], thickness: t2, kind };
}
function door(at2, width, axis, hinge, startDeg) {
  return {
    at: at2,
    width,
    axis,
    kind: "door",
    swing: { hinge, radius: width, startDeg, endDeg: startDeg + 90 }
  };
}
function buildCore(b2, opts = {}) {
  const { widthMm: W2, core } = b2;
  const d2 = core.depthMm;
  const wetW = opts.wetAsFree ? 0 : core.wetBayMm;
  const stairBay = core.stairBayMm;
  const evBay = core.evCount * core.evShaftWmm;
  const evD = evBay > 0 ? Math.min(core.evDepthMm, d2) : 0;
  const anteBay = core.anteBayMm ?? 0;
  const restW = Math.max(0, W2 - wetW - evBay - anteBay - stairBay);
  const hallW = opts.hallMaxMm ? Math.min(restW, opts.hallMaxMm) : restW;
  const freeW = restW - hallW;
  const wetX = freeW;
  const hallX = wetX + wetW;
  const stairX = W2 - stairBay;
  const anteX = stairX - anteBay;
  const evX = anteX - evBay;
  const wetD = Math.min(core.wetDepthMm, d2);
  const rest = d2 - wetD;
  const rooms = [];
  if (wetW > 0) rooms.push(rect(opts.wetName ?? "\uD654\uC7A5\uC2E4", wetX, 0, wetW, wetD, "wet"));
  rooms.push(
    // 승강기가 있으면 승강로 앞 띠(승강장)까지 홀이 ㄴ자로 이어져 계단실 문에 닿는다.
    evBay > 0 ? poly(
      "\uD640",
      [
        [hallX, 0],
        [evX, 0],
        [evX, evD],
        [anteX, evD],
        [anteX, d2],
        [hallX, d2]
      ],
      "hall"
    ) : rect("\uD640", hallX, 0, hallW, d2, "hall"),
    rect("\uACC4\uB2E8\uC2E4", stairX, 0, stairBay, d2, "core")
  );
  if (anteBay > 0) rooms.push(rect("\uBD80\uC18D\uC2E4", anteX, 0, anteBay, d2, "core"));
  for (let i = 0; i < core.evCount; i++) {
    rooms.push(rect("\uC2B9\uAC15\uAE30", evX + i * core.evShaftWmm, 0, core.evShaftWmm, evD, "core"));
  }
  const walls = [
    vWall(hallX, 0, d2, b2.intWallMm, "interior"),
    vWall(stairX, 0, d2, b2.intWallMm, "interior")
  ];
  if (anteBay > 0) walls.push(vWall(anteX, 0, d2, b2.intWallMm, "interior"));
  if (evBay > 0) {
    walls.push(vWall(evX, 0, evD, b2.intWallMm, "interior"));
    walls.push(hWall(evX, anteX, evD, b2.intWallMm, "interior"));
    for (let i = 1; i < core.evCount; i++) {
      walls.push(vWall(evX + i * core.evShaftWmm, 0, evD, b2.intWallMm, "interior"));
    }
  }
  if (freeW > 0 && wetW > 0) walls.push(vWall(wetX, 0, d2, b2.intWallMm, "interior"));
  if (opts.frontWall !== false) walls.unshift(hWall(wetX, W2, d2, b2.intWallMm, "interior"));
  const stairDoorY = evBay > 0 ? evD + (d2 - evD) / 2 : d2 / 2;
  const openings = [
    // 계단실로 들어가는 문. 부속실이 있으면 이 자리는 **부속실 → 계단실** 문이 되고,
    // 홀에서 들어오는 문은 아래에서 부속실 앞에 따로 선다.
    // 문은 **계단실 안쪽으로** 열린다 — 거실에서 계단으로 가는 게 피난 방향이다.
    //
    // 방화구획도 피난계단도 대상이 아니면 문짝을 그리지 않는다(사용자 지시 + 영 §46①·§35①).
    // 없는 방화문을 그려 두면 건축주가 그 값을 견적에 넣는다. 대신 통로로 열어 둔다.
    b2.stairEnclosed === false ? {
      at: [stairX, stairDoorY],
      width: evBay > 0 ? Math.min(1200, Math.max(600, d2 - evD - 200)) : 1200,
      axis: "y",
      kind: "door"
    } : door(
      [stairX, stairDoorY],
      core.stairDoorMm,
      "y",
      [stairX, stairDoorY + core.stairDoorMm / 2],
      270
    )
  ];
  if (wetW > 0) openings.push(door([hallX, wetD / 2], 900, "y", [hallX, wetD / 2 - 450], 90));
  if (opts.frontDoor !== false) {
    openings.push({
      at: [hallX + hallW / 2, d2],
      width: Math.min(hallW - 200, 1500),
      axis: "x",
      kind: "door"
    });
  }
  if (anteBay > 0) {
    openings.push(
      door(
        [anteX, stairDoorY],
        core.stairDoorMm,
        "y",
        [anteX, stairDoorY + core.stairDoorMm / 2],
        270
      )
    );
  }
  for (let i = 0; i < core.evCount; i++) {
    openings.push({
      at: [evX + i * core.evShaftWmm + core.evShaftWmm / 2, evD],
      width: Math.min(900, core.evShaftWmm - 400),
      axis: "x",
      kind: "door"
    });
  }
  if (wetW > 0 && rest > 0) {
    rooms.push(rect("\uCC3D\uACE0", wetX, wetD, wetW, rest, "core"));
    walls.push(hWall(wetX, wetX + wetW, wetD, b2.intWallMm, "interior"));
    openings.push(door([wetX + wetW / 2, d2], 900, "x", [wetX + wetW / 2 - 450, d2], 270));
  }
  const clearX = Math.max(0, core.stairBayMm - (core.stairWidthMm * 2 + core.wellMm)) / 2;
  const runX1 = stairX + clearX;
  const runX2 = runX1 + core.stairWidthMm + core.wellMm;
  const runY = core.landingMm;
  const runH = Math.max(600, d2 - runY - 150);
  const stairs = [
    // 홀에서 들어와 뒤쪽 계단참으로 (Y가 줄어드는 방향)
    {
      x: runX1,
      y: runY,
      w: core.stairWidthMm,
      h: runH,
      treads: core.treadsPerRun,
      direction: "down",
      landingMm: core.landingMm
    },
    // 계단참에서 되돌아 올라간다
    {
      x: runX2,
      y: runY,
      w: core.stairWidthMm,
      h: runH,
      treads: core.treadsPerRun,
      direction: "up",
      landingMm: core.landingMm
    }
  ];
  return { rooms, walls, stairs, openings, freeW, hallX, hallW };
}
function entryCorridor(b2, yFrom, yTo, widthMm) {
  const W2 = b2.widthMm;
  const ec = Math.min(widthMm, b2.core.stairBayMm);
  const roomW = W2 - ec;
  const cx = roomW + ec / 2;
  const my = (yFrom + yTo) / 2;
  return {
    roomW,
    rooms: [rect("\uC9C4\uC785\uD1B5\uB85C", roomW, yFrom, ec, yTo - yFrom, "hall")],
    walls: [vWall(roomW, yFrom, yTo, b2.intWallMm, "interior")],
    openings: [
      { at: [cx, yTo], width: Math.min(ec - 200, 1200), axis: "x", kind: "entrance" },
      // 통로 → 계단실. 문은 **통로 쪽으로** 열린다 — 계단에서 나오는 것이 피난 방향이다.
      door([cx, yFrom], 900, "x", [cx - 450, yFrom], 0),
      // 통로 → 앞쪽 실. 임대인은 이 문으로 들어가고, 상층 이용자는 안 쓴다.
      // 문은 **실 쪽으로** 연다 — 통로로 열면 문짝이 피난 통로를 가로막는다
      // (폭 1,200 통로에 900짜리 문을 통로로 열면 유효폭이 300만 남는다).
      door([roomW, my], 900, "y", [roomW, my + 450], 180)
    ]
  };
}
function roomWithFreeBand(name, yFrom, w2, yTo, freeW, program) {
  if (freeW <= 0) return rect(name, 0, yFrom, w2, yTo - yFrom, program);
  return poly(
    name,
    [
      [0, 0],
      [freeW, 0],
      [freeW, yFrom],
      [w2, yFrom],
      [w2, yTo],
      [0, yTo]
    ],
    program
  );
}
var BAY_FALLBACK = {
  boundaryM2: [39, 55, 74],
  livingMinMm: 2700,
  bedroomMinMm: 2400,
  serviceBandMm: 2300,
  kitchenMinMm: 2400,
  corridorMm: 1200,
  entranceMm: 1500,
  bathroomM2: 4,
  bathroomMinMm: 1600,
  bedroomTargetM2: 10,
  livingShare: 0.3
};
function baysForAreaM2(areaM2, boundary) {
  if (areaM2 <= boundary[0]) return 1;
  if (areaM2 <= boundary[1]) return 2;
  if (areaM2 < boundary[2]) return 3;
  return 4;
}
function buildDwelling(b2, u2) {
  const t2 = b2.intWallMm;
  const rooms = [];
  const walls = [];
  const openings = [];
  const UW = u2.x1 - u2.x0;
  const UD = u2.yTo - u2.yFrom;
  const bandW = u2.x0 === 0 ? u2.freeW : 0;
  const areaM2 = (UW * UD + bandW * u2.yFrom) / 1e6;
  let usedBand = false;
  const bandDoorAt = (roomW) => bandW > 0 ? Math.round(Math.min(bandW, roomW) / 2) : null;
  const single = (name) => {
    usedBand = bandW > 0;
    rooms.push(
      usedBand ? roomWithFreeBand(name, u2.yFrom, u2.x1, u2.yTo, bandW, u2.program) : rect(name, u2.x0, u2.yFrom, UW, UD, u2.program)
    );
    return { rooms, walls, openings, usedBand, bandDoorX: null, gridY: [] };
  };
  if (u2.noBedrooms) return single("\uAC70\uC2E4 \xB7 \uC8FC\uBC29");
  const wantBays = baysForAreaM2(areaM2, u2.bay.boundaryM2);
  const entryFrom = Math.max(u2.entryFrom, u2.x0);
  const entryTo = Math.min(u2.entryTo, u2.x1);
  const rightSide = (entryFrom + entryTo) / 2 - u2.x0 >= UW / 2;
  const entW = u2.ownEntrance ? Math.max(0, Math.min(u2.bay.entranceMm, entryTo - entryFrom)) : Math.max(0, entryTo - entryFrom);
  const livNeed = rightSide ? u2.x1 - (entryTo - entW) : entryFrom + entW - u2.x0;
  const livMin = Math.min(UW, Math.max(livNeed, u2.bay.livingMinMm));
  const frontBeds = wantBays - 1;
  const frontBedW = Math.min(3200, Math.floor((UW - livMin) / Math.max(1, frontBeds)));
  const frontBedD = Math.max(u2.rowMm, Math.ceil(u2.bay.bedroomTargetM2 * 1e6 / Math.max(1, frontBedW)));
  if (!u2.ownEntrance && rightSide && bandW > 0 && frontBeds >= 2 && frontBedW >= u2.bay.bedroomMinMm + b2.extWallMm + t2 && frontBedW * frontBedD <= (u2.bay.bedroomTargetM2 + 1) * 1e6 && UD >= frontBedD + u2.bay.corridorMm + t2) {
    const y2 = u2.yTo - frontBedD;
    const bedsW = frontBeds * frontBedW;
    for (let i = 0; i < frontBeds; i++) {
      const x2 = i * frontBedW;
      rooms.push(rect(i === 0 ? "\uC548\uBC29" : `\uCE68\uC2E4 ${i + 1}`, x2, y2, frontBedW, frontBedD, u2.program));
      walls.push(hWall(x2, x2 + frontBedW, y2, t2, "interior"));
      walls.push(vWall(x2 + frontBedW, y2, u2.yTo, t2, "interior"));
      const dx = x2 + frontBedW / 2;
      openings.push(door([dx, y2], 900, "x", [dx - 450, y2], 0));
    }
    rooms.push(poly("\uAC70\uC2E4 \xB7 \uC8FC\uBC29", [
      [0, 0],
      [bandW, 0],
      [bandW, u2.yFrom],
      [u2.x1, u2.yFrom],
      [u2.x1, u2.yTo],
      [bedsW, u2.yTo],
      [bedsW, y2],
      [0, y2]
    ], u2.program));
    return { rooms, walls, openings, usedBand: true, bandDoorX: null, gridY: [u2.yFrom, u2.yTo] };
  }
  const rearD = Math.max(u2.rowMm, Math.ceil(
    u2.bay.bedroomTargetM2 * 1e6 / Math.max(1, bandW - (b2.extWallMm + t2) / 2)
  ) + (b2.extWallMm + t2) / 2);
  if (!u2.ownEntrance && rightSide && bandW >= u2.bay.bedroomMinMm + b2.extWallMm + t2 && rearD <= u2.yFrom && UD > 0 && UW - bandW >= livMin) {
    const compactW = Math.min(3200, bandW - u2.bay.corridorMm - t2);
    const compactD = Math.max(u2.rowMm, Math.ceil(u2.bay.bedroomTargetM2 * 1e6 / Math.max(1, compactW)));
    if (UD < u2.rowMm + u2.bay.corridorMm + t2 && compactW >= u2.bay.bedroomMinMm + b2.extWallMm + t2 && compactD <= u2.yFrom && compactW * compactD <= (u2.bay.bedroomTargetM2 + 1) * 1e6) {
      rooms.push(rect("\uC548\uBC29", 0, 0, compactW, compactD, u2.program));
      walls.push(hWall(0, compactW, compactD, t2, "interior"));
      walls.push(vWall(compactW, 0, compactD, t2, "interior"));
      const dy = compactD / 2;
      openings.push(door([compactW, dy], 900, "y", [compactW, dy - 450], 90));
      rooms.push(poly("\uAC70\uC2E4 \xB7 \uC8FC\uBC29", [
        [0, compactD],
        [compactW, compactD],
        [compactW, 0],
        [bandW, 0],
        [bandW, u2.yFrom],
        [u2.x1, u2.yFrom],
        [u2.x1, u2.yTo],
        [0, u2.yTo]
      ], u2.program));
      return { rooms, walls, openings, usedBand: true, bandDoorX: null, gridY: [u2.yFrom, u2.yTo] };
    }
    const frontW = Math.min(bandW, 3200);
    const frontD = Math.max(u2.rowMm + b2.extWallMm + t2, 3e3);
    const second = UD >= frontD + u2.bay.corridorMm + t2;
    const frontY = second ? u2.yTo - frontD : u2.yTo;
    rooms.push(rect("\uC548\uBC29", 0, 0, bandW, rearD, u2.program));
    walls.push(hWall(0, bandW, rearD, t2, "interior"));
    const rearDoorX = bandW / 2;
    openings.push(door([rearDoorX, rearD], 900, "x", [rearDoorX - 450, rearD], 270));
    const living = [
      [0, rearD],
      [bandW, rearD],
      [bandW, u2.yFrom],
      [u2.x1, u2.yFrom],
      [u2.x1, u2.yTo]
    ];
    if (second) {
      rooms.push(rect("\uCE68\uC2E4 2", 0, frontY, frontW, frontD, u2.program));
      walls.push(hWall(0, frontW, frontY, t2, "interior"));
      walls.push(vWall(frontW, frontY, u2.yTo, t2, "interior"));
      openings.push(door([frontW / 2, frontY], 900, "x", [frontW / 2 - 450, frontY], 0));
      living.push([frontW, u2.yTo], [frontW, frontY], [0, frontY]);
    } else living.push([0, u2.yTo]);
    rooms.push(poly("\uAC70\uC2E4 \xB7 \uC8FC\uBC29", living, u2.program));
    return {
      rooms,
      walls,
      openings,
      usedBand: true,
      bandDoorX: null,
      // 새 경량 칸막이마다 전 폭의 구조 기둥을 추가하지 않는다.
      gridY: [u2.yFrom, u2.yTo]
    };
  }
  const bayDMax = Math.max(
    u2.rowMm,
    Math.round(u2.bay.bedroomTargetM2 * 1e6 / u2.bay.bedroomMinMm)
  );
  const bayDEst = Math.max(
    u2.rowMm,
    Math.min(UD - u2.bay.corridorMm - u2.bay.serviceBandMm, bayDMax)
  );
  const bedW = Math.max(
    u2.bay.bedroomMinMm,
    Math.round(u2.bay.bedroomTargetM2 * 1e6 / Math.max(1, bayDEst))
  );
  const byWidth = 1 + Math.max(0, Math.floor((UW - livMin) / bedW));
  let bays = Math.min(wantBays, byWidth);
  if (bays >= 2 && UD - u2.bay.corridorMm - u2.bay.serviceBandMm < u2.rowMm) bays = 1;
  const nBed = bays - 1;
  const corridorD = nBed > 0 ? u2.bay.corridorMm : 0;
  const bathEst = Math.max(
    Math.round(u2.bay.bathroomM2 * 1e6 / u2.bay.serviceBandMm),
    u2.bay.bathroomMinMm
  );
  const bedInService = nBed === 0 && UW - (u2.ownEntrance ? entW + bathEst : livNeed) >= u2.bay.bedroomMinMm;
  const serviceMin = bedInService ? Math.max(u2.bay.serviceBandMm, u2.rowMm) : u2.bay.serviceBandMm;
  if (UD - corridorD - serviceMin < u2.rowMm) {
    if (!u2.ownEntrance && UD >= u2.rowMm) {
      const bedW2 = Math.min(3200, Math.max(u2.bay.bedroomMinMm, Math.round(u2.bay.bedroomTargetM2 * 1e6 / UD)));
      const rows = Math.min(2, Math.floor((UW - livMin) / bedW2));
      if (rows >= 1) {
        const bedsW = rows * bedW2;
        const livW2 = UW - bedsW;
        const livX02 = rightSide ? u2.x1 - livW2 : u2.x0;
        const bedsX0 = rightSide ? u2.x0 : u2.x0 + livW2;
        const livTakesBand = bandW > 0 && livX02 === 0;
        rooms.push(
          livTakesBand ? roomWithFreeBand("\uAC70\uC2E4 \xB7 \uC8FC\uBC29", u2.yFrom, livX02 + livW2, u2.yTo, bandW, u2.program) : rect("\uAC70\uC2E4 \xB7 \uC8FC\uBC29", livX02, u2.yFrom, livW2, UD, u2.program)
        );
        const splitX2 = rightSide ? livX02 : livX02 + livW2;
        walls.push(vWall(splitX2, u2.yFrom, u2.yTo, t2, "interior"));
        for (let i = 0; i < rows; i++) {
          const bx0 = rightSide ? bedsX0 + bedsW - (i + 1) * bedW2 : bedsX0 + i * bedW2;
          rooms.push(rect(i === 0 ? "\uC548\uBC29" : `\uCE68\uC2E4 ${i + 1}`, bx0, u2.yFrom, bedW2, UD, u2.program));
          if (i > 0) walls.push(vWall(rightSide ? bx0 + bedW2 : bx0, u2.yFrom, u2.yTo, t2, "interior"));
          const dy = i === 0 ? u2.yFrom + UD * 0.5 : u2.yTo - 700;
          const dx = i === 0 ? splitX2 : rightSide ? bx0 + bedW2 : bx0;
          openings.push(door([dx, dy], 900, "y", [dx, dy - 450], rightSide ? 180 : 0));
        }
        let usedB = livTakesBand;
        if (bandW > 0 && !livTakesBand) {
          rooms.push(rect("\uC218\uB0A9", 0, 0, bandW, u2.yFrom, "core"));
          walls.push(hWall(0, bandW, u2.yFrom, t2, "interior"));
          const mx = Math.min(bandW, bedW2) / 2;
          openings.push(door([mx, u2.yFrom], 800, "x", [mx - 400, u2.yFrom], 270));
          usedB = true;
        }
        return { rooms, walls, openings, usedBand: usedB, bandDoorX: null, gridY: [u2.yFrom, u2.yTo] };
      }
    }
    return single("\uAC70\uC2E4 \xB7 \uC8FC\uBC29");
  }
  const bayD0 = nBed > 0 ? Math.max(u2.rowMm, Math.min(UD - corridorD - serviceMin, bayDMax)) : UD - corridorD - serviceMin;
  const serviceD = Math.min(UD - corridorD - bayD0, Math.max(serviceMin, bayDMax));
  const bayD = UD - corridorD - serviceD;
  const svcY1 = u2.yFrom + serviceD;
  const bayY0 = svcY1 + corridorD;
  const gridY = [u2.yFrom, svcY1, bayY0, u2.yTo];
  if (nBed === 0) {
    if (u2.ownEntrance) {
      const bathTarget = Math.max(
        Math.round(u2.bay.bathroomM2 * 1e6 / serviceD),
        u2.bay.bathroomMinMm
      );
      const bathW2 = Math.min(bathTarget, Math.max(0, UW - entW));
      const restW = UW - entW - bathW2;
      const hasBed = restW >= u2.bay.bedroomMinMm && serviceD >= u2.rowMm;
      const legW2 = hasBed ? 0 : restW;
      const frontName = hasBed ? "\uAC70\uC2E4 \xB7 \uC8FC\uBC29" : "\uAC70\uC2E4 \xB7 \uC8FC\uBC29 \xB7 \uCE68\uC2E4";
      const legX0 = rightSide ? u2.x0 : u2.x1 - legW2;
      rooms.push(
        legW2 > 0 ? poly(
          frontName,
          rightSide ? [
            [u2.x0, u2.yFrom],
            [u2.x0 + legW2, u2.yFrom],
            [u2.x0 + legW2, svcY1],
            [u2.x1, svcY1],
            [u2.x1, u2.yTo],
            [u2.x0, u2.yTo]
          ] : [
            [u2.x1 - legW2, u2.yFrom],
            [u2.x1, u2.yFrom],
            [u2.x1, u2.yTo],
            [u2.x0, u2.yTo],
            [u2.x0, svcY1],
            [u2.x1 - legW2, svcY1]
          ],
          u2.program
        ) : rect(frontName, u2.x0, svcY1, UW, u2.yTo - svcY1, u2.program)
      );
      walls.push(
        hWall(
          rightSide ? u2.x0 + legW2 : u2.x0,
          rightSide ? u2.x1 : u2.x1 - legW2,
          svcY1,
          t2,
          "interior"
        )
      );
      if (legW2 > 0) walls.push(vWall(rightSide ? u2.x0 + legW2 : legX0, u2.yFrom, svcY1, t2, "interior"));
      const seq = [
        { name: "\uD604\uAD00", w: entW, program: "hall" },
        { name: "\uC695\uC2E4", w: bathW2, program: "wet" }
      ];
      if (hasBed) seq.push({ name: "\uCE68\uC2E4", w: restW, program: u2.program });
      let cx = rightSide ? u2.x1 : u2.x0;
      for (let i = 0; i < seq.length; i++) {
        const s2 = seq[i];
        const sx0 = rightSide ? cx - s2.w : cx;
        rooms.push(rect(s2.name, sx0, u2.yFrom, s2.w, serviceD, s2.program));
        if (i > 0) walls.push(vWall(rightSide ? sx0 + s2.w : sx0, u2.yFrom, svcY1, t2, "interior"));
        cx = rightSide ? sx0 : sx0 + s2.w;
      }
      const entCx = rightSide ? u2.x1 - entW / 2 : u2.x0 + entW / 2;
      openings.push({ at: [entCx, u2.yFrom], width: Math.min(entW - 200, 1e3), axis: "x", kind: "door" });
      openings.push(door([entCx, svcY1], 900, "x", [entCx - 450, svcY1], 90));
      const bx = rightSide ? u2.x1 - entW : u2.x0 + entW;
      const bmy = u2.yFrom + serviceD / 2;
      openings.push(door([bx, bmy], 800, "y", [bx, bmy - 400], rightSide ? 180 : 0));
      if (hasBed) {
        const bedCx = rightSide ? u2.x0 + restW / 2 : u2.x1 - restW / 2;
        openings.push(door([bedCx, svcY1], 900, "x", [bedCx - 450, svcY1], 270));
      }
      return { rooms, walls, openings, usedBand, bandDoorX: bandDoorAt(rightSide ? legW2 > 0 ? legW2 : restW : entW), gridY: [u2.yFrom, svcY1, u2.yTo] };
    }
    const colW = Math.min(UW, Math.max(livNeed, u2.bay.livingMinMm));
    const gapW2 = UW - colW;
    const rows = Math.min(2, Math.floor(gapW2 / u2.bay.bedroomMinMm));
    if (rows === 0) return single("\uAC70\uC2E4 \xB7 \uC8FC\uBC29");
    const colX0 = rightSide ? u2.x1 - colW : u2.x0;
    const gapX02 = rightSide ? u2.x0 : colX0 + colW;
    rooms.push(
      poly(
        "\uAC70\uC2E4 \xB7 \uC8FC\uBC29",
        rightSide ? [
          [gapX02, svcY1],
          [colX0, svcY1],
          [colX0, u2.yFrom],
          [u2.x1, u2.yFrom],
          [u2.x1, u2.yTo],
          [gapX02, u2.yTo]
        ] : [
          [u2.x0, u2.yFrom],
          [colX0 + colW, u2.yFrom],
          [colX0 + colW, svcY1],
          [u2.x1, svcY1],
          [u2.x1, u2.yTo],
          [u2.x0, u2.yTo]
        ],
        u2.program
      )
    );
    walls.push(hWall(gapX02, gapX02 + gapW2, svcY1, t2, "interior"));
    walls.push(vWall(rightSide ? colX0 : colX0 + colW, u2.yFrom, svcY1, t2, "interior"));
    const bw2 = gapW2 / rows;
    for (let i = 0; i < rows; i++) {
      const bx0 = rightSide ? gapX02 + gapW2 - (i + 1) * bw2 : gapX02 + i * bw2;
      rooms.push(rect(i === 0 ? "\uC548\uBC29" : `\uCE68\uC2E4 ${i + 1}`, bx0, u2.yFrom, bw2, serviceD, u2.program));
      if (i > 0) walls.push(vWall(rightSide ? bx0 + bw2 : bx0, u2.yFrom, svcY1, t2, "interior"));
      openings.push(door([bx0 + bw2 / 2, svcY1], 900, "x", [bx0 + bw2 / 2 - 450, svcY1], 270));
    }
    return { rooms, walls, openings, usedBand, bandDoorX: bandDoorAt(rightSide ? bw2 : colW), gridY: [u2.yFrom, svcY1, u2.yTo] };
  }
  const livDepth = u2.ownEntrance ? u2.yTo - svcY1 : UD;
  const livTarget = Math.round(u2.bay.livingShare * areaM2 * 1e6 / Math.max(1, livDepth));
  const rearBed = !u2.ownEntrance && serviceD >= u2.rowMm && livNeed - entW >= u2.bay.kitchenMinMm && // 넓은 건물에서는 이 밴드가 통째로 31㎡짜리 "침실"이 된다 — 그럴 바엔 주방·식당이다.
  // 목표(10㎡)의 두 배까지가 침실로 부를 수 있는 크기다.
  (UW - livNeed) * serviceD <= 2 * u2.bay.bedroomTargetM2 * 1e6;
  const livW = rearBed ? livMin : Math.max(livMin, Math.min(Math.max(livMin, livTarget), UW - nBed * bedW));
  const livX0 = rightSide ? u2.x1 - livW : u2.x0;
  const livX1 = livX0 + livW;
  const gapX0 = rightSide ? u2.x0 : livX1;
  const gapX1 = rightSide ? livX0 : u2.x1;
  const gapW = gapX1 - gapX0;
  const splitX = rightSide ? livX0 : livX1;
  const bathW = u2.ownEntrance ? Math.max(
    0,
    Math.min(
      Math.max(
        Math.round(u2.bay.bathroomM2 * 1e6 / serviceD),
        u2.bay.bathroomMinMm
      ),
      livW - entW
    )
  ) : 0;
  const legW = u2.ownEntrance ? livW - entW - bathW : rearBed ? entW : livW;
  rooms.push(
    legW >= livW ? rect("\uAC70\uC2E4", livX0, u2.yFrom, livW, UD, u2.program) : legW > 0 ? poly(
      "\uAC70\uC2E4",
      rightSide ? [
        [livX0, u2.yFrom],
        [livX0 + legW, u2.yFrom],
        [livX0 + legW, svcY1],
        [livX1, svcY1],
        [livX1, u2.yTo],
        [livX0, u2.yTo]
      ] : [
        [livX1 - legW, u2.yFrom],
        [livX1, u2.yFrom],
        [livX1, u2.yTo],
        [livX0, u2.yTo],
        [livX0, svcY1],
        [livX1 - legW, svcY1]
      ],
      u2.program
    ) : rect("\uAC70\uC2E4", livX0, svcY1, livW, u2.yTo - svcY1, u2.program)
  );
  walls.push(vWall(splitX, u2.yFrom, u2.yTo, t2, "interior"));
  const bandTaken = bandW > 0 && rightSide ? Math.min(bandW, gapW) : 0;
  const svcName = rearBed ? `\uCE68\uC2E4 ${nBed + 1}` : "\uC8FC\uBC29 \xB7 \uC2DD\uB2F9";
  rooms.push(
    bandTaken >= gapW ? rect(svcName, gapX0, 0, gapW, svcY1, u2.program) : bandTaken > 0 ? roomWithFreeBand(svcName, u2.yFrom, gapW, svcY1, bandTaken, u2.program) : rect(svcName, gapX0, u2.yFrom, gapW, serviceD, u2.program)
  );
  if (bandTaken > 0) {
    usedBand = true;
    if (bandW > bandTaken) {
      rooms.push(rect("\uC218\uB0A9", bandTaken, 0, bandW - bandTaken, u2.yFrom, "core"));
      walls.push(vWall(bandTaken, 0, u2.yFrom, t2, "interior"));
      walls.push(hWall(bandTaken, bandW, u2.yFrom, t2, "interior"));
      const my = u2.yFrom / 2;
      openings.push(door([bandTaken, my], 800, "y", [bandTaken, my - 400], 0));
    }
  }
  rooms.push(rect("\uBCF5\uB3C4", gapX0, svcY1, gapW, corridorD, "hall"));
  walls.push(hWall(gapX0, gapX1, svcY1, t2, "interior"));
  walls.push(hWall(gapX0, gapX1, bayY0, t2, "interior"));
  openings.push(door([gapX0 + gapW / 2, svcY1], 900, "x", [gapX0 + gapW / 2 - 450, svcY1], 270));
  const corMidY = svcY1 + corridorD / 2;
  openings.push({
    at: [splitX, corMidY],
    width: Math.min(corridorD - 200, 1200),
    axis: "y",
    kind: "door"
  });
  const bw = gapW / nBed;
  for (let i = 0; i < nBed; i++) {
    const bx0 = rightSide ? gapX1 - (i + 1) * bw : gapX0 + i * bw;
    rooms.push(rect(i === 0 ? "\uC548\uBC29" : `\uCE68\uC2E4 ${i + 1}`, bx0, bayY0, bw, u2.yTo - bayY0, u2.program));
    if (i > 0) walls.push(vWall(rightSide ? bx0 + bw : bx0, bayY0, u2.yTo, t2, "interior"));
    openings.push(door([bx0 + bw / 2, bayY0], 900, "x", [bx0 + bw / 2 - 450, bayY0], 90));
  }
  if (u2.ownEntrance) {
    const entX0 = rightSide ? livX1 - entW : livX0;
    const bathX0 = rightSide ? entX0 - bathW : entX0 + entW;
    rooms.push(rect("\uD604\uAD00", entX0, u2.yFrom, entW, serviceD, "hall"));
    rooms.push(rect("\uC695\uC2E4", bathX0, u2.yFrom, bathW, serviceD, "wet"));
    walls.push(
      hWall(rightSide ? bathX0 : entX0, rightSide ? livX1 : bathX0 + bathW, svcY1, t2, "interior")
    );
    walls.push(vWall(rightSide ? entX0 : entX0 + entW, u2.yFrom, svcY1, t2, "interior"));
    if (legW > 0) {
      walls.push(vWall(rightSide ? bathX0 : bathX0 + bathW, u2.yFrom, svcY1, t2, "interior"));
    }
    const entCx = entX0 + entW / 2;
    openings.push({ at: [entCx, u2.yFrom], width: Math.min(entW - 200, 1e3), axis: "x", kind: "door" });
    openings.push(door([entCx, svcY1], 900, "x", [entCx - 450, svcY1], 90));
    const bmy = u2.yFrom + serviceD / 2;
    const bwx = rightSide ? entX0 : entX0 + entW;
    openings.push(door([bwx, bmy], 800, "y", [bwx, bmy - 400], rightSide ? 180 : 0));
  } else if (rearBed) {
    const kitW = livW - legW;
    const kitX0 = rightSide ? livX0 + legW : livX0;
    rooms.push(rect("\uC8FC\uBC29 \xB7 \uC2DD\uB2F9", kitX0, u2.yFrom, kitW, serviceD, u2.program));
    walls.push(hWall(kitX0, kitX0 + kitW, svcY1, t2, "interior"));
    walls.push(vWall(rightSide ? kitX0 : kitX0 + kitW, u2.yFrom, svcY1, t2, "interior"));
    const kcx = kitX0 + kitW / 2;
    openings.push(door([kcx, svcY1], 900, "x", [kcx - 450, svcY1], 270));
  } else {
    const kmy = u2.yFrom + serviceD / 2;
    openings.push(door([splitX, kmy], 900, "y", [splitX, kmy - 450], rightSide ? 180 : 0));
  }
  return { rooms, walls, openings, usedBand, bandDoorX: bandDoorAt(rightSide ? gapW : livW), gridY };
}
function envelope(b2, yFrom, yTo) {
  const W2 = b2.widthMm;
  const t2 = b2.extWallMm;
  return [
    hWall(0, W2, yFrom, t2, "exterior"),
    hWall(0, W2, yTo, t2, "exterior"),
    vWall(0, yFrom, yTo, t2, "exterior"),
    vWall(W2, yFrom, yTo, t2, "exterior")
  ];
}
function pilotiStalls(gridX, columnMm, yFrom, yTo, stall) {
  if (!stall) return [];
  const stallW = stall.widthMm;
  const stallD = stall.depthMm;
  if (stallW <= 0 || stallD <= 0 || yTo - yFrom < stallD) return [];
  const y2 = yTo - stallD;
  const out = [];
  for (let i = 0; i < gridX.length - 1; i++) {
    const from = gridX[i] + (i === 0 ? 0 : columnMm / 2);
    const to = gridX[i + 1] - (i === gridX.length - 2 ? 0 : columnMm / 2);
    const n = Math.floor((to - from) / stallW);
    for (let k2 = 0; k2 < n; k2++) {
      out.push({ x: from + k2 * stallW, y: y2, w: stallW, h: stallD });
    }
  }
  return out;
}
function needsWindow(program) {
  return program !== "core" && program !== "wet" && program !== "hall" && program !== "outdoor";
}
function freeSpans(from, to, blocked) {
  const out = [];
  let cur = from;
  for (const [s2, e2] of [...blocked].sort((a2, b2) => a2[0] - b2[0])) {
    if (e2 <= cur || s2 >= to) continue;
    if (s2 > cur) out.push([cur, Math.min(s2, to)]);
    cur = Math.max(cur, e2);
  }
  if (cur < to) out.push([cur, to]);
  return out;
}
function exteriorWindows(b2, rooms, openings, frontY) {
  const ON2 = 60;
  const MIN_WIN = 900;
  const { maxWidthMm, cornerMarginMm, coverage } = b2.window;
  const W2 = b2.widthMm;
  const out = [];
  for (const r2 of rooms) {
    if (!needsWindow(r2.program)) continue;
    const p2 = r2.points;
    for (let i = 0; i < p2.length; i++) {
      const [x1, y1] = p2[i];
      const [x2, y2] = p2[(i + 1) % p2.length];
      let axis;
      let fixed;
      let a2;
      let z2;
      if (Math.abs(x1 - x2) < ON2 && (Math.abs(x1) < ON2 || Math.abs(x1 - W2) < ON2)) {
        axis = "y";
        fixed = Math.abs(x1) < ON2 ? 0 : W2;
        a2 = Math.min(y1, y2);
        z2 = Math.max(y1, y2);
      } else if (Math.abs(y1 - y2) < ON2 && (Math.abs(y1) < ON2 || Math.abs(y1 - frontY) < ON2)) {
        axis = "x";
        fixed = Math.abs(y1) < ON2 ? 0 : frontY;
        a2 = Math.min(x1, x2);
        z2 = Math.max(x1, x2);
      } else {
        continue;
      }
      const blocked = [...openings, ...out].filter((o2) => o2.axis === axis && Math.abs((axis === "y" ? o2.at[0] : o2.at[1]) - fixed) < ON2).map((o2) => {
        const c2 = axis === "y" ? o2.at[1] : o2.at[0];
        return [c2 - o2.width / 2 - 300, c2 + o2.width / 2 + 300];
      });
      for (const [s2, e2] of freeSpans(a2 + cornerMarginMm, z2 - cornerMarginMm, blocked)) {
        const len = e2 - s2;
        if (len < MIN_WIN) continue;
        const n = Math.max(1, Math.round(len / (maxWidthMm / coverage)));
        const seg = len / n;
        const width = Math.min(maxWidthMm, seg, Math.max(MIN_WIN, seg * coverage));
        if (width < MIN_WIN) continue;
        for (let k2 = 0; k2 < n; k2++) {
          const c2 = s2 + seg * k2 + seg / 2;
          out.push({ at: axis === "y" ? [fixed, c2] : [c2, fixed], width, axis, kind: "window" });
        }
      }
    }
  }
  return out;
}
function columnsFor(b2, gridX, gridY) {
  const out = [];
  for (const x2 of gridX) for (const y2 of gridY) out.push([x2, y2]);
  return out;
}
function gridFrom(keys, maxSpanMm) {
  const out = [];
  const push = (v) => {
    if (out.length === 0 || out[out.length - 1] !== v) out.push(v);
  };
  for (let i = 0; i < keys.length - 1; i++) {
    const from = keys[i];
    const span = keys[i + 1] - from;
    const n = Math.max(1, Math.ceil(span / Math.max(1, maxSpanMm)));
    for (let k2 = 0; k2 <= n; k2++) push(Math.round(from + span * k2 / n));
  }
  return out;
}
function gridAlignedToBase(keys, D2, baseD, maxSpanMm) {
  if (baseD <= D2) return gridFrom(keys, maxSpanMm);
  const base = gridFrom([...keys.filter((k2) => k2 < D2), baseD], maxSpanMm);
  const out = base.filter((v) => v < D2);
  out.push(D2);
  return out;
}
function buildFloor(b2, f2, baseDepthMm) {
  const W2 = b2.widthMm;
  const D2 = f2.depthMm ?? b2.depthMm;
  const gridX = gridFrom([0, W2], b2.maxSpanMm);
  const rooms = [];
  const walls = [];
  const openings = [];
  const stairs = [];
  const stalls = [];
  let gridY = [0, D2];
  let solidTo = D2;
  if (f2.archetype === "piloti") {
    const pd = f2.pilotiDepthMm ?? 5250;
    const solidTop = D2 - pd;
    walls.push(...envelope(b2, 0, solidTop));
    const marks = pilotiStalls(gridX, b2.columnMm, solidTop, D2, f2.stallMm);
    stalls.push(...marks);
    rooms.push(
      rect(
        // 대수를 못 대는 깊이면 "주차"라고 쓰지 않는다 — 없는 것을 그린 도면이 된다.
        marks.length > 0 ? `\uD544\uB85C\uD2F0 \uC8FC\uCC28 ${marks.length}\uB300` : "\uD544\uB85C\uD2F0 (\uC8FC\uCC28\uAD6C\uD68D \uC548 \uB098\uC634)",
        0,
        solidTop,
        W2,
        pd,
        "outdoor"
      )
    );
    solidTo = solidTop;
    const band = solidTop - b2.core.depthMm;
    const core = buildCore(b2, { frontWall: band > 0, hallMaxMm: f2.hallMaxMm });
    rooms.push(...core.rooms);
    walls.push(...core.walls);
    stairs.push(...core.stairs);
    openings.push(...core.openings);
    if (band > 0) {
      const e2 = (f2.entryCorridorMm ?? 0) > 0 ? entryCorridor(b2, b2.core.depthMm, solidTop, f2.entryCorridorMm) : null;
      const roomW = e2 ? e2.roomW : W2;
      if (f2.program === "residential" && f2.bay && f2.bedroomRowMm) {
        const dw = buildDwelling(b2, {
          x0: 0,
          x1: roomW,
          yFrom: b2.core.depthMm,
          yTo: solidTop,
          entryFrom: core.hallX,
          entryTo: core.hallX + core.hallW,
          ownEntrance: false,
          freeW: core.freeW,
          rowMm: f2.bedroomRowMm,
          bay: f2.bay,
          program: "residential",
          noBedrooms: false
        });
        rooms.push(...dw.rooms);
        walls.push(...dw.walls);
        openings.push(...dw.openings);
        if (!dw.usedBand && core.freeW > 0) rooms.push(rect("\uC218\uB0A9", 0, 0, core.freeW, b2.core.depthMm, "core"));
      } else {
        rooms.push(
          roomWithFreeBand(f2.roomNames?.[0] ?? "\uC2E4", b2.core.depthMm, roomW, solidTop, core.freeW, f2.program)
        );
      }
      if (e2) {
        rooms.push(...e2.rooms);
        walls.push(...e2.walls);
        openings.push(...e2.openings);
      }
      const hallX = b2.core.wetBayMm;
      const hallW = Math.max(0, roomW - hallX);
      openings.push({ at: [hallX + hallW / 2, solidTop], width: 1800, axis: "x", kind: "entrance" });
    } else if (core.freeW > 0) {
      rooms.push(rect(f2.roomNames?.[0] ?? "\uC2E4", 0, 0, core.freeW, solidTop, f2.program));
      openings.push({ at: [core.freeW / 2, solidTop], width: 1800, axis: "x", kind: "entrance" });
    }
    gridY = [0, solidTop, D2];
  } else if (f2.archetype === "doubleLoaded") {
    walls.push(...envelope(b2, 0, D2));
    const core = buildCore(b2, { hallMaxMm: f2.hallMaxMm });
    rooms.push(...core.rooms);
    walls.push(...core.walls);
    stairs.push(...core.stairs);
    openings.push(...core.openings);
    const cw = f2.corridorMm ?? 1500;
    const yFrom = b2.core.depthMm;
    const yTo = D2;
    const bandH = yTo - yFrom;
    const n = f2.roomsPerSide ?? 2;
    const cx0 = (W2 - cw) / 2;
    rooms.push(rect("\uBCF5\uB3C4", cx0, yFrom, cw, bandH, "hall"));
    walls.push(vWall(cx0, yFrom, yTo, b2.intWallMm, "interior"));
    walls.push(vWall(cx0 + cw, yFrom, yTo, b2.intWallMm, "interior"));
    const rh = bandH / n;
    for (let i = 0; i < n; i++) {
      const y2 = yFrom + i * rh;
      const nameL = f2.roomNames?.[i] ?? `\uC2E4 ${i + 1}`;
      const nameR = f2.roomNames?.[n + i] ?? `\uC2E4 ${n + i + 1}`;
      rooms.push(
        i === 0 ? roomWithFreeBand(nameL, y2, cx0, y2 + rh, core.freeW, f2.program) : rect(nameL, 0, y2, cx0, rh, f2.program)
      );
      rooms.push(rect(nameR, cx0 + cw, y2, W2 - cx0 - cw, rh, f2.program));
      if (i > 0) {
        walls.push(hWall(0, cx0, y2, b2.intWallMm, "interior"));
        walls.push(hWall(cx0 + cw, W2, y2, b2.intWallMm, "interior"));
      }
      const dy = y2 + rh / 2;
      openings.push(door([cx0, dy], 900, "y", [cx0, dy - 450], 0));
      openings.push(door([cx0 + cw, dy], 900, "y", [cx0 + cw, dy + 450], 180));
    }
    if (f2.ground) {
      openings.push({
        at: [cx0 + cw / 2, yTo],
        width: Math.min(cw - 200, 1500),
        axis: "x",
        kind: "entrance"
      });
    }
    gridY = [0, yFrom, D2];
  } else if (f2.archetype === "residential") {
    const td = f2.terraceDepthMm ?? 2e3;
    const top = D2 - td;
    walls.push(...envelope(b2, 0, top));
    solidTo = top;
    const bay = f2.bay ?? BAY_FALLBACK;
    const rowMm = f2.bedroomRowMm ?? 2600;
    const yCore = b2.core.depthMm;
    const units = Math.floor(f2.unitsPerFloor ?? 1) >= 2 && W2 >= 2 * bay.livingMinMm ? 2 : 1;
    const entryDepth = bay.corridorMm;
    const entryBandW = f2.hallMaxMm ? Math.max(0, W2 - b2.core.stairBayMm - b2.core.wetBayMm - f2.hallMaxMm) : 0;
    const entryBedroomD = Math.max(rowMm, Math.ceil(bay.bedroomTargetM2 * 1e6 / Math.max(1, entryBandW - (b2.extWallMm + b2.intWallMm) / 2)) + (b2.extWallMm + b2.intWallMm) / 2);
    const sideEntry = units === 1 && top - yCore < entryDepth + b2.intWallMm && top > yCore && entryBandW >= bay.bedroomMinMm + b2.extWallMm + b2.intWallMm && entryBedroomD + b2.intWallMm <= yCore - 900 - b2.intWallMm / 2 && b2.core.evCount === 0 && b2.core.anteBayMm === 0 && yCore - entryDepth >= bay.bathroomMinMm;
    const core = buildCore(sideEntry ? { ...b2, core: { ...b2.core, wetDepthMm: yCore - entryDepth } } : b2, {
      wetName: units === 1 ? "\uC695\uC2E4" : void 0,
      wetAsFree: units === 2,
      hallMaxMm: f2.hallMaxMm,
      frontDoor: units === 1 && !sideEntry
    });
    if (sideEntry) {
      const foyer = core.rooms.find((r2) => r2.name === "\uCC3D\uACE0");
      if (foyer) {
        foyer.name = "\uD604\uAD00";
        foyer.program = "hall";
        core.openings = core.openings.filter((o2) => !(o2.axis === "x" && Math.abs(o2.at[1] - yCore) < 1 && o2.at[0] >= foyer.x && o2.at[0] <= foyer.x + foyer.w));
        const cy = entryBedroomD + 450 + b2.intWallMm / 2;
        core.openings.push(
          { at: [foyer.x + foyer.w, cy], width: 900, axis: "y", kind: "door" },
          { at: [foyer.x, cy], width: 900, axis: "y", kind: "door" }
        );
      }
    }
    rooms.push(...core.rooms);
    walls.push(...core.walls);
    stairs.push(...core.stairs);
    openings.push(...core.openings);
    const dwellings = [];
    const yFrom = yCore;
    let sx = null;
    if (units === 1) {
      dwellings.push({
        x0: 0,
        x1: W2,
        yFrom,
        yTo: top,
        entryFrom: core.hallX,
        entryTo: core.hallX + core.hallW,
        ownEntrance: false,
        freeW: core.freeW,
        rowMm,
        bay,
        program: "residential",
        // 1층은 거실·식당·부엌의 공동생활구역이다(주거건축계획 P122). 단독주택은 세대
        // 내부 계단으로 오르므로 침실은 2층부터다.
        noBedrooms: f2.ground === true
      });
    } else {
      sx = Math.round(core.hallX + core.hallW / 2);
      walls.push(vWall(sx, yFrom, top, b2.intWallMm, "party"));
      dwellings.push(
        {
          x0: 0,
          x1: sx,
          yFrom,
          yTo: top,
          // 홀의 왼쪽 절반이 이 세대의 현관 자리다.
          entryFrom: core.hallX,
          entryTo: sx,
          ownEntrance: true,
          freeW: core.freeW,
          rowMm,
          bay,
          program: "residential",
          noBedrooms: false
        },
        {
          x0: sx,
          x1: W2,
          yFrom,
          yTo: top,
          // 홀의 오른쪽 절반.
          entryFrom: sx,
          entryTo: core.hallX + core.hallW,
          ownEntrance: true,
          freeW: 0,
          rowMm,
          bay,
          program: "residential",
          noBedrooms: false
        }
      );
    }
    const bandYs = [];
    let usedBand = false;
    let bandDoorX = null;
    const unitRooms = [];
    for (const [i, spec] of dwellings.entries()) {
      const dw = buildDwelling(b2, spec);
      const mine = dw.rooms.map((r2) => ({ ...r2, unitId: i + 1 }));
      unitRooms.push(mine);
      rooms.push(...mine);
      walls.push(...dw.walls);
      openings.push(...dw.openings);
      bandYs.push(...dw.gridY);
      if (dw.usedBand) usedBand = true;
      if (dw.bandDoorX !== null) bandDoorX = dw.bandDoorX;
    }
    if (core.freeW > 0 && !usedBand) {
      rooms.push(rect("\uC218\uB0A9", 0, 0, core.freeW, yFrom, "core"));
      walls.push(hWall(0, core.freeW, yFrom, b2.intWallMm, "interior"));
      const dx = bandDoorX ?? core.freeW / 2;
      openings.push(door([dx, yFrom], 900, "x", [dx - 450, yFrom], 270));
    }
    const terraceBounds = sx === null ? [[0, W2]] : [[0, sx], [sx, W2]];
    for (const [i, [bx0, bx1]] of terraceBounds.entries()) {
      rooms.push({ ...rect("\uD14C\uB77C\uC2A4", bx0, top, bx1 - bx0, td, "outdoor"), unitId: i + 1 });
      if (td <= 0) continue;
      if (f2.ground) continue;
      const fronts = (unitRooms[i] ?? []).filter(
        (r2) => r2.program === "residential" && Math.abs(r2.y + r2.h - top) <= 60
      );
      const front = fronts.find((r2) => r2.name.startsWith("\uAC70\uC2E4")) ?? [...fronts].sort((p2, q2) => q2.w - p2.w)[0];
      if (!front) continue;
      const frontEdges = front.points.map((p2, j2) => [p2, front.points[(j2 + 1) % front.points.length]]).filter(([a2, z2]) => Math.abs(a2[1] - top) <= 1 && Math.abs(z2[1] - top) <= 1).map(([a2, z2]) => [Math.min(a2[0], z2[0]), Math.max(a2[0], z2[0])]).sort((a2, z2) => z2[1] - z2[0] - (a2[1] - a2[0]));
      const edge = frontEdges[0];
      if (!edge) continue;
      const dw = Math.min(1500, edge[1] - edge[0] - 600);
      if (dw < 900) continue;
      const dx = (edge[0] + edge[1]) / 2;
      openings.push(door([dx, top], dw, "x", [dx - dw / 2, top], 270));
    }
    if (f2.ground) {
      openings.push({ at: [W2 / 2, top], width: 1500, axis: "x", kind: "entrance" });
    }
    gridY = Array.from(/* @__PURE__ */ new Set([0, yCore, ...bandYs, top, D2])).sort((p2, q2) => p2 - q2);
  } else {
    walls.push(...envelope(b2, 0, D2));
    const core = buildCore(b2, { hallMaxMm: f2.hallMaxMm });
    rooms.push(...core.rooms);
    walls.push(...core.walls);
    stairs.push(...core.stairs);
    openings.push(...core.openings);
    const yFrom = b2.core.depthMm;
    const e2 = (f2.entryCorridorMm ?? 0) > 0 ? entryCorridor(b2, yFrom, D2, f2.entryCorridorMm) : null;
    const roomW = e2 ? e2.roomW : W2;
    rooms.push(roomWithFreeBand(f2.roomNames?.[0] ?? "\uC2E4", yFrom, roomW, D2, core.freeW, f2.program));
    if (e2) {
      rooms.push(...e2.rooms);
      walls.push(...e2.walls);
      openings.push(...e2.openings);
    }
    if (f2.ground) {
      openings.push({ at: [roomW / 2, D2], width: 1800, axis: "x", kind: "entrance" });
    }
    gridY = [0, yFrom, D2];
  }
  openings.push(...exteriorWindows(b2, rooms, openings, solidTo));
  const gridYFinal = gridAlignedToBase(gridY, D2, baseDepthMm ?? D2, b2.maxSpanMm);
  return {
    label: f2.label,
    ground: f2.ground === true,
    useLabel: f2.useLabel,
    widthMm: W2,
    depthMm: D2,
    walls,
    openings,
    rooms,
    stairs,
    stalls,
    gridX,
    gridY: gridYFinal,
    columns: columnsFor(b2, gridX, gridYFinal),
    columnMm: b2.columnMm
  };
}
function mirrorFloor(p2) {
  const D2 = p2.depthMm;
  const fy = (y2) => D2 - y2;
  const fp = ([x2, y2]) => [x2, fy(y2)];
  return {
    ...p2,
    walls: p2.walls.map((w2) => ({ ...w2, a: fp(w2.a), b: fp(w2.b) })),
    openings: p2.openings.map(
      (o2) => o2.swing ? {
        ...o2,
        at: fp(o2.at),
        ...o2.direction ? { direction: [o2.direction[0], -o2.direction[1]] } : {},
        swing: {
          ...o2.swing,
          hinge: fp(o2.swing.hinge),
          startDeg: -o2.swing.endDeg,
          endDeg: -o2.swing.startDeg
        }
      } : { ...o2, at: fp(o2.at), ...o2.direction ? { direction: [o2.direction[0], -o2.direction[1]] } : {} }
    ),
    // y는 바운딩 박스의 아래끝이라 뒤집으면 위끝이 아래끝이 된다
    rooms: p2.rooms.map((r2) => ({
      ...r2,
      points: r2.points.map(fp),
      y: fy(r2.y + r2.h),
      ...r2.labelAt ? { labelAt: fp(r2.labelAt) } : {},
      ...r2.fixedFixtures ? { fixedFixtures: r2.fixedFixtures.map((s2) => s2.kind === "rect" ? { ...s2, y: fy(s2.y + s2.h) } : s2.kind === "circle" ? { ...s2, c: fp(s2.c) } : { ...s2, a: fp(s2.a), b: fp(s2.b) }) } : {},
      ...r2.counterEdge ? { counterEdge: r2.counterEdge === "minY" ? "maxY" : "minY" } : {}
    })),
    // 계단참은 런 상자 밖에 있어 좌표만 뒤집으면 안 된다 — 붙는 쪽을 같이 뒤집는다.
    stairs: p2.stairs.map((s2) => ({ ...s2, y: fy(s2.y + s2.h), landingAtFar: !s2.landingAtFar })),
    ...p2.stairDetail ? { stairDetail: {
      lines: p2.stairDetail.lines.map((l2) => ({ a: fp(l2.a), b: fp(l2.b) })),
      labels: p2.stairDetail.labels.map((l2) => ({ ...l2, at: fp(l2.at) }))
    } } : {},
    stalls: p2.stalls.map((s2) => ({ ...s2, y: fy(s2.y + s2.h) })),
    gridY: p2.gridY.map(fy),
    columns: p2.columns.map(fp),
    ...p2.columnPolygons ? { columnPolygons: p2.columnPolygons.map((ring) => ring.map(fp)) } : {}
  };
}
function entranceAtRoad(p2) {
  const hall = p2.rooms.find((r2) => r2.name === "\uD640");
  if (!hall) return p2;
  const openings = p2.openings.filter((o2) => o2.kind !== "entrance");
  openings.push({
    at: [hall.x + hall.w / 2, p2.depthMm],
    width: Math.min(Math.max(hall.w - 200, 900), 1800),
    axis: "x",
    kind: "entrance"
  });
  return { ...p2, openings };
}
function attachWing(p2, b2, wingMm, roomName, program) {
  const W2 = p2.widthMm;
  const D2 = p2.depthMm;
  const ww = wingMm.widthMm;
  const wd = Math.min(wingMm.depthMm, D2);
  if (ww < 900 || wd < 900) return p2;
  const left = wingMm.side === "left";
  const x0 = left ? -ww : W2;
  const x1 = left ? 0 : W2 + ww;
  const bx = left ? 0 : W2;
  const t2 = b2.extWallMm;
  const yFrom = b2.coreAtRoad ? 0 : D2 - wd;
  const yTo = yFrom + wd;
  const coreLo = b2.coreAtRoad ? D2 - b2.core.depthMm : 0;
  const coreHi = b2.coreAtRoad ? D2 : b2.core.depthMm;
  const gaps = [];
  if (coreHi <= yFrom || coreLo >= yTo) gaps.push([yFrom, yTo]);
  else {
    if (coreLo > yFrom) gaps.push([yFrom, coreLo]);
    if (coreHi < yTo) gaps.push([coreHi, yTo]);
  }
  const doorGap = gaps.filter(([g0, g1]) => g1 - g0 >= 1200).sort((ga, gb) => gb[1] - gb[0] - (ga[1] - ga[0]))[0];
  if (!doorGap) return p2;
  const ON2 = 60;
  const fullGap = doorGap[0] <= yFrom + ON2 && doorGap[1] >= yTo - ON2;
  const edgeIdx = (r2) => {
    for (let i = 0; i < r2.points.length; i++) {
      const a2 = r2.points[i];
      const c2 = r2.points[(i + 1) % r2.points.length];
      if (Math.abs(a2[0] - bx) > ON2 || Math.abs(c2[0] - bx) > ON2) continue;
      if (Math.min(a2[1], c2[1]) <= yFrom + ON2 && Math.max(a2[1], c2[1]) >= yTo - ON2) return i;
    }
    return -1;
  };
  const host = fullGap ? p2.rooms.find((r2) => r2.program === program && edgeIdx(r2) >= 0) : void 0;
  let walls = [
    ...p2.walls,
    hWall(x0, x1, yFrom, t2, "exterior"),
    hWall(x0, x1, yTo, t2, "exterior"),
    vWall(left ? x0 : x1, yFrom, yTo, t2, "exterior")
  ];
  if (host) {
    walls = walls.flatMap((w2) => {
      const vert = Math.abs(w2.a[0] - w2.b[0]) < 1e-6;
      if (!vert || Math.abs(w2.a[0] - bx) > ON2) return [w2];
      const lo = Math.min(w2.a[1], w2.b[1]);
      const hi = Math.max(w2.a[1], w2.b[1]);
      if (Math.min(hi, yTo) - Math.max(lo, yFrom) <= 0) return [w2];
      const out = [];
      if (lo < yFrom) out.push(vWall(w2.a[0], lo, yFrom, w2.thickness, w2.kind));
      if (hi > yTo) out.push(vWall(w2.a[0], yTo, hi, w2.thickness, w2.kind));
      return out;
    });
  }
  const openings = p2.openings.filter(
    (o2) => !(o2.kind === "window" && o2.axis === "y" && Math.abs(o2.at[0] - bx) < ON2 && o2.at[1] > yFrom - ON2 && o2.at[1] < yTo + ON2)
  );
  if (!host) {
    const dw = Math.min(1800, doorGap[1] - doorGap[0] - 300);
    openings.push({ at: [bx, (doorGap[0] + doorGap[1]) / 2], width: dw, axis: "y", kind: "door" });
  }
  const horizY = b2.coreAtRoad ? yFrom : yTo;
  const wc = Math.min(b2.window.maxWidthMm, ww - b2.window.cornerMarginMm * 2);
  if (wc >= 900) openings.push({ at: [(x0 + x1) / 2, horizY], width: wc, axis: "x", kind: "window" });
  const sc = Math.min(b2.window.maxWidthMm, wd - b2.window.cornerMarginMm * 2);
  if (sc >= 900)
    openings.push({ at: [left ? x0 : x1, yFrom + wd / 2], width: sc, axis: "y", kind: "window" });
  let rooms;
  if (host) {
    const i = edgeIdx(host);
    const a2 = host.points[i];
    const c2 = host.points[(i + 1) % host.points.length];
    const wx = left ? x0 : x1;
    const notch = c2[1] > a2[1] ? [
      [a2[0], yFrom],
      [wx, yFrom],
      [wx, yTo],
      [a2[0], yTo]
    ] : [
      [a2[0], yTo],
      [wx, yTo],
      [wx, yFrom],
      [a2[0], yFrom]
    ];
    const raw = [...host.points.slice(0, i + 1), ...notch, ...host.points.slice(i + 1)];
    const pts = raw.filter((q2, qi) => {
      const prev = raw[(qi + raw.length - 1) % raw.length];
      return Math.abs(q2[0] - prev[0]) > 1e-6 || Math.abs(q2[1] - prev[1]) > 1e-6;
    });
    rooms = p2.rooms.map(
      (r2) => r2 === host ? { ...poly(host.name, pts, host.program), unitId: host.unitId } : r2
    );
  } else {
    rooms = [...p2.rooms, rect(roomName, x0, yFrom, ww, wd, program)];
  }
  const ox = left ? x0 : x1;
  const columns = [...p2.columns, [ox, yFrom], [ox, yTo], [bx, b2.coreAtRoad ? yTo : yFrom]];
  return { ...p2, walls, openings, rooms, columns, wingMm: { ...wingMm, depthMm: wd } };
}
function wingYRange(plan) {
  if (!plan.wingMm) return null;
  const right = plan.wingMm.side === "right";
  const ys2 = plan.rooms.flatMap(
    (r2) => r2.points.filter((q2) => right ? q2[0] > plan.widthMm + 1 : q2[0] < -1).map((q2) => q2[1])
  );
  if (ys2.length === 0) return null;
  return [Math.min(...ys2), Math.max(...ys2)];
}
function buildAllFloors(b2) {
  const baseDepthMm = b2.floors.reduce((m2, f2) => Math.max(m2, f2.depthMm ?? b2.depthMm), b2.depthMm);
  const plans = b2.floors.map((f2) => {
    const plan = buildFloor(b2, f2, baseDepthMm);
    const base = !b2.coreAtRoad ? plan : f2.ground ? (
      // 출입구는 1층에만 있다 — 위층까지 손대면 없는 문을 만든다.
      entranceAtRoad(mirrorFloor(plan))
    ) : mirrorFloor(plan);
    if (!f2.wingMm) return base;
    return attachWing(base, b2, f2.wingMm, `${f2.roomNames?.[0] ?? "\uC2E4"}2`, f2.program);
  });
  return assignRefMarks(assignOpeningIds(plans));
}
function assignRefMarks(plans) {
  const stairFloor = plans.find((p2) => p2.stairs.length > 0);
  if (stairFloor) {
    const x0 = Math.min(...stairFloor.stairs.map((s2) => s2.x));
    const x1 = Math.max(...stairFloor.stairs.map((s2) => s2.x + s2.w));
    const cutX = (x0 + x1) / 2;
    for (const p2 of plans) {
      p2.sectionMarks = [
        { a: [cutX, 0], b: [cutX, p2.depthMm], dir: [-1, 0], label: "A", sheetNo: SECTION_SHEET_NO }
      ];
    }
  }
  const g2 = plans[0];
  if (g2) {
    const xMin = g2.wingMm?.side === "left" ? -g2.wingMm.widthMm : 0;
    const xMax = g2.wingMm?.side === "right" ? g2.widthMm + g2.wingMm.widthMm : g2.widthMm;
    const midX = (xMin + xMax) / 2;
    const midY = g2.depthMm / 2;
    const FACE = {
      front: { at: [midX, g2.depthMm], dir: [0, -1] },
      back: { at: [midX, 0], dir: [0, 1] },
      left: { at: [xMax, midY], dir: [-1, 0] },
      right: { at: [xMin, midY], dir: [1, 0] }
    };
    g2.elevationMarks = ELEVATION_ORDER.map((d2, i) => ({ ...FACE[d2], sheetNo: elevationSheetNo(i) }));
  }
  return plans;
}
function pointInPoly(pts, px, py) {
  let inside = false;
  for (let i = 0, j2 = pts.length - 1; i < pts.length; j2 = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j2];
    if (yi > py !== yj > py && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function distToEdges(pts, px, py) {
  let best = Infinity;
  for (let i = 0, j2 = pts.length - 1; i < pts.length; j2 = i++) {
    const [x1, y1] = pts[j2];
    const [x2, y2] = pts[i];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const t2 = len2 > 0 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
    const qx = x1 + t2 * dx;
    const qy = y1 + t2 * dy;
    best = Math.min(best, Math.hypot(px - qx, py - qy));
  }
  return best;
}
function roomLabelPoint(r2) {
  if (r2.labelAt && pointInPoly(r2.points, r2.labelAt[0], r2.labelAt[1])) return r2.labelAt;
  const center = [r2.x + r2.w / 2, r2.y + r2.h / 2];
  if (r2.points.length <= 4) return center;
  const N2 = 24;
  let best = center;
  let bestDist = -1;
  for (let i = 0; i < N2; i++) {
    const px = r2.x + r2.w * (i + 0.5) / N2;
    for (let j2 = 0; j2 < N2; j2++) {
      const py = r2.y + r2.h * (j2 + 0.5) / N2;
      if (!pointInPoly(r2.points, px, py)) continue;
      const dist = distToEdges(r2.points, px, py);
      if (dist > bestDist) {
        bestDist = dist;
        best = [px, py];
      }
    }
  }
  return best;
}
function roomAreaM2(r2) {
  const p2 = r2.points;
  let twice = 0;
  for (let i = 0; i < p2.length; i++) {
    const [x1, y1] = p2[i];
    const [x2, y2] = p2[(i + 1) % p2.length];
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2 / 1e6;
}
function roomFloorAreaM2(r2) {
  if (r2.program !== "outdoor") return roomAreaM2(r2);
  if (r2.name === "\uD14C\uB77C\uC2A4") return Math.max(0, roomAreaM2(r2) - r2.w / 1e3 * 1.5);
  return 0;
}
function floorAreaM2(p2) {
  return p2.rooms.reduce((s2, r2) => s2 + roomFloorAreaM2(r2), 0);
}

// ../../../node_modules/@tarikjabiri/dxf/lib/index.esm.js
function e(e2) {
  const t2 = Math.sqrt(Math.pow(e2, 2) + Math.pow(e2, 2)) / 2;
  return -(e2 - Math.sqrt(Math.pow(e2, 2) - Math.pow(t2, 2))) / t2;
}
function t(e2, t2, s2) {
  return { x: null != e2 ? e2 : 0, y: null != t2 ? t2 : 0, z: null != s2 ? s2 : 0 };
}
function s(e2, t2) {
  return { x: null != e2 ? e2 : 0, y: null != t2 ? t2 : 0 };
}
var h = class _h {
  static next() {
    return (++_h.seed).toString(16).toUpperCase();
  }
  static peek() {
    return (_h.seed + 1).toString(16).toUpperCase();
  }
  static clear() {
    _h.seed = 0;
  }
};
h.seed = 0;
var o = class {
  constructor() {
    this.handle = h.next();
  }
  dxfy(e2) {
    e2.type("ENDBLK"), e2.handle(this.handle), e2.push(330, this.ownerObjectHandle), e2.subclassMarker("AcDbEntity"), e2.layerName("0"), e2.subclassMarker("AcDbBlockEnd");
  }
};
var d = (e2, t2) => ({ tl: e2, br: t2 });
var a = class _a {
  static centerRadiusBBox(e2, s2) {
    return d(t(e2.x - s2, e2.y + s2), t(e2.x + s2, e2.y - s2));
  }
  static pointBBox(e2) {
    return d(t(e2.x - 100, e2.y + 100), t(e2.x + 100, e2.y - 100));
  }
  static lineBBox(e2, s2) {
    const n = e2.x > s2.x ? e2.x : s2.x, i = e2.x < s2.x ? e2.x : s2.x, h2 = e2.y > s2.y ? e2.y : s2.y, o2 = e2.y < s2.y ? e2.y : s2.y, a2 = e2.z > s2.z ? e2.z : s2.z, l2 = e2.z < s2.z ? e2.z : s2.z;
    return d(t(i, h2, l2), t(n, o2, a2));
  }
  static verticesBBox(e2) {
    let s2 = -1 / 0, n = -1 / 0, i = 1 / 0, h2 = 1 / 0;
    for (let t2 = 0; t2 < e2.length; t2++) {
      const { x: o2, y: d2 } = e2[t2];
      s2 < o2 && (s2 = o2), n < d2 && (n = d2), i > o2 && (i = o2), h2 > d2 && (h2 = d2);
    }
    return d(t(i, n), t(s2, h2));
  }
  static boundingBox(e2) {
    if (0 === e2.length) return _a.pointBBox(t());
    const s2 = [];
    for (let t2 = 0; t2 < e2.length; t2++) {
      const n = e2[t2];
      s2.push(n.tl, n.br);
    }
    return _a.verticesBBox(s2);
  }
  static boundingBoxCenter(e2) {
    return t(e2.tl.x + (e2.br.x - e2.tl.x) / 2, e2.br.y + (e2.tl.y - e2.br.y) / 2, 0);
  }
  static boundingBoxHeight(e2) {
    return e2.tl.y - e2.br.y;
  }
};
var l;
var r;
var f;
!(function(e2) {
  e2[e2.None = 0] = "None", e2[e2.Frozen = 1] = "Frozen", e2[e2.FrozenInNewViewports = 2] = "FrozenInNewViewports", e2[e2.Locked = 4] = "Locked", e2[e2.XRefDependent = 16] = "XRefDependent", e2[e2.XRefResolved = 32] = "XRefResolved";
})(l || (l = {})), (function(e2) {
  e2[e2.None = 0] = "None", e2[e2.DescribeShape = 1] = "DescribeShape", e2[e2.VerticalText = 4] = "VerticalText", e2[e2.XRefDependent = 16] = "XRefDependent", e2[e2.XRefResolved = 32] = "XRefResolved";
})(r || (r = {})), (function(e2) {
  e2[e2.None = 0] = "None", e2[e2.PaperSpace = 1] = "PaperSpace", e2[e2.XRefDependent = 16] = "XRefDependent", e2[e2.XRefResolved = 32] = "XRefResolved";
})(f || (f = {}));
var u = class {
  constructor(e2) {
    this.type = e2, this.handle = h.next();
  }
  dxfy(e2) {
    e2.type(this.type), e2.handle(this.handle), e2.push(330, this.ownerObjectHandle), e2.subclassMarker("AcDbSymbolTableRecord");
  }
};
var c = class extends u {
  constructor(e2, t2, s2, n) {
    super("LAYER"), this.name = e2, this.colorNumber = t2, this.lineType = s2, this.flags = null != n ? n : l.None;
  }
  dxfy(e2) {
    super.dxfy(e2), e2.subclassMarker("AcDbLayerTableRecord"), e2.name(this.name), e2.push(70, this.flags), e2.colorNumber(this.colorNumber), e2.push(420, this.trueColor), e2.lineType(this.lineType), e2.push(370, 0), e2.push(390, 0), e2.push(347, this.materialObject);
  }
};
c.layerZeroName = "0";
var g = [[["00", "00", "00"], 0, ["0", "0", "0"]], [["FF", "00", "00"], 1, ["255", "0", "0"]], [["FF", "FF", "00"], 2, ["255", "255", "0"]], [["00", "FF", "00"], 3, ["0", "255", "0"]], [["00", "FF", "FF"], 4, ["0", "255", "255"]], [["00", "00", "FF"], 5, ["0", "0", "255"]], [["FF", "00", "FF"], 6, ["255", "0", "255"]], [["FF", "FF", "FF"], 7, ["255", "255", "255"]], [["41", "41", "41"], 8, ["65", "65", "65"]], [["80", "80", "80"], 9, ["128", "128", "128"]], [["FF", "00", "00"], 10, ["255", "0", "0"]], [["FF", "AA", "AA"], 11, ["255", "170", "170"]], [["BD", "00", "00"], 12, ["189", "0", "0"]], [["BD", "7E", "7E"], 13, ["189", "126", "126"]], [["81", "00", "00"], 14, ["129", "0", "0"]], [["81", "56", "56"], 15, ["129", "86", "86"]], [["68", "00", "00"], 16, ["104", "0", "0"]], [["68", "45", "45"], 17, ["104", "69", "69"]], [["4F", "00", "00"], 18, ["79", "0", "0"]], [["4F", "35", "35"], 19, ["79", "53", "53"]], [["FF", "3F", "00"], 20, ["255", "63", "0"]], [["FF", "BF", "AA"], 21, ["255", "191", "170"]], [["BD", "2E", "00"], 22, ["189", "46", "0"]], [["BD", "8D", "7E"], 23, ["189", "141", "126"]], [["81", "1F", "00"], 24, ["129", "31", "0"]], [["81", "60", "56"], 25, ["129", "96", "86"]], [["68", "19", "00"], 26, ["104", "25", "0"]], [["68", "4E", "45"], 27, ["104", "78", "69"]], [["4F", "13", "00"], 28, ["79", "19", "0"]], [["4F", "3B", "35"], 29, ["79", "59", "53"]], [["FF", "7F", "00"], 30, ["255", "127", "0"]], [["FF", "D4", "AA"], 31, ["255", "212", "170"]], [["BD", "5E", "00"], 32, ["189", "94", "0"]], [["BD", "9D", "7E"], 33, ["189", "157", "126"]], [["81", "40", "00"], 34, ["129", "64", "0"]], [["81", "6B", "56"], 35, ["129", "107", "86"]], [["68", "34", "00"], 36, ["104", "52", "0"]], [["68", "56", "45"], 37, ["104", "86", "69"]], [["4F", "27", "00"], 38, ["79", "39", "0"]], [["4F", "42", "35"], 39, ["79", "66", "53"]], [["FF", "BF", "00"], 40, ["255", "191", "0"]], [["FF", "EA", "AA"], 41, ["255", "234", "170"]], [["BD", "8D", "00"], 42, ["189", "141", "0"]], [["BD", "AD", "7E"], 43, ["189", "173", "126"]], [["81", "60", "00"], 44, ["129", "96", "0"]], [["81", "76", "56"], 45, ["129", "118", "86"]], [["68", "4E", "00"], 46, ["104", "78", "0"]], [["68", "5F", "45"], 47, ["104", "95", "69"]], [["4F", "3B", "00"], 48, ["79", "59", "0"]], [["4F", "49", "35"], 49, ["79", "73", "53"]], [["FF", "FF", "00"], 50, ["255", "255", "0"]], [["FF", "FF", "AA"], 51, ["255", "255", "170"]], [["BD", "BD", "00"], 52, ["189", "189", "0"]], [["BD", "BD", "7E"], 53, ["189", "189", "126"]], [["81", "81", "00"], 54, ["129", "129", "0"]], [["81", "81", "56"], 55, ["129", "129", "86"]], [["68", "68", "00"], 56, ["104", "104", "0"]], [["68", "68", "45"], 57, ["104", "104", "69"]], [["4F", "4F", "00"], 58, ["79", "79", "0"]], [["4F", "4F", "35"], 59, ["79", "79", "53"]], [["BF", "FF", "00"], 60, ["191", "255", "0"]], [["EA", "FF", "AA"], 61, ["234", "255", "170"]], [["8D", "BD", "00"], 62, ["141", "189", "0"]], [["AD", "BD", "7E"], 63, ["173", "189", "126"]], [["60", "81", "00"], 64, ["96", "129", "0"]], [["76", "81", "56"], 65, ["118", "129", "86"]], [["4E", "68", "00"], 66, ["78", "104", "0"]], [["5F", "68", "45"], 67, ["95", "104", "69"]], [["3B", "4F", "00"], 68, ["59", "79", "0"]], [["49", "4F", "35"], 69, ["73", "79", "53"]], [["7F", "FF", "00"], 70, ["127", "255", "0"]], [["D4", "FF", "AA"], 71, ["212", "255", "170"]], [["5E", "BD", "00"], 72, ["94", "189", "0"]], [["9D", "BD", "7E"], 73, ["157", "189", "126"]], [["40", "81", "00"], 74, ["64", "129", "0"]], [["6B", "81", "56"], 75, ["107", "129", "86"]], [["34", "68", "00"], 76, ["52", "104", "0"]], [["56", "68", "45"], 77, ["86", "104", "69"]], [["27", "4F", "00"], 78, ["39", "79", "0"]], [["42", "4F", "35"], 79, ["66", "79", "53"]], [["3F", "FF", "00"], 80, ["63", "255", "0"]], [["BF", "FF", "AA"], 81, ["191", "255", "170"]], [["2E", "BD", "00"], 82, ["46", "189", "0"]], [["8D", "BD", "7E"], 83, ["141", "189", "126"]], [["1F", "81", "00"], 84, ["31", "129", "0"]], [["60", "81", "56"], 85, ["96", "129", "86"]], [["19", "68", "00"], 86, ["25", "104", "0"]], [["4E", "68", "45"], 87, ["78", "104", "69"]], [["13", "4F", "00"], 88, ["19", "79", "0"]], [["3B", "4F", "35"], 89, ["59", "79", "53"]], [["00", "FF", "00"], 90, ["0", "255", "0"]], [["AA", "FF", "AA"], 91, ["170", "255", "170"]], [["00", "BD", "00"], 92, ["0", "189", "0"]], [["7E", "BD", "7E"], 93, ["126", "189", "126"]], [["00", "81", "00"], 94, ["0", "129", "0"]], [["56", "81", "56"], 95, ["86", "129", "86"]], [["00", "68", "00"], 96, ["0", "104", "0"]], [["45", "68", "45"], 97, ["69", "104", "69"]], [["00", "4F", "00"], 98, ["0", "79", "0"]], [["35", "4F", "35"], 99, ["53", "79", "53"]], [["00", "FF", "3F"], 100, ["0", "255", "63"]], [["AA", "FF", "BF"], 101, ["170", "255", "191"]], [["00", "BD", "2E"], 102, ["0", "189", "46"]], [["7E", "BD", "8D"], 103, ["126", "189", "141"]], [["00", "81", "1F"], 104, ["0", "129", "31"]], [["56", "81", "60"], 105, ["86", "129", "96"]], [["00", "68", "19"], 106, ["0", "104", "25"]], [["45", "68", "4E"], 107, ["69", "104", "78"]], [["00", "4F", "13"], 108, ["0", "79", "19"]], [["35", "4F", "3B"], 109, ["53", "79", "59"]], [["00", "FF", "7F"], 110, ["0", "255", "127"]], [["AA", "FF", "D4"], 111, ["170", "255", "212"]], [["00", "BD", "5E"], 112, ["0", "189", "94"]], [["7E", "BD", "9D"], 113, ["126", "189", "157"]], [["00", "81", "40"], 114, ["0", "129", "64"]], [["56", "81", "6B"], 115, ["86", "129", "107"]], [["00", "68", "34"], 116, ["0", "104", "52"]], [["45", "68", "56"], 117, ["69", "104", "86"]], [["00", "4F", "27"], 118, ["0", "79", "39"]], [["35", "4F", "42"], 119, ["53", "79", "66"]], [["00", "FF", "BF"], 120, ["0", "255", "191"]], [["AA", "FF", "EA"], 121, ["170", "255", "234"]], [["00", "BD", "8D"], 122, ["0", "189", "141"]], [["7E", "BD", "AD"], 123, ["126", "189", "173"]], [["00", "81", "60"], 124, ["0", "129", "96"]], [["56", "81", "76"], 125, ["86", "129", "118"]], [["00", "68", "4E"], 126, ["0", "104", "78"]], [["45", "68", "5F"], 127, ["69", "104", "95"]], [["00", "4F", "3B"], 128, ["0", "79", "59"]], [["35", "4F", "49"], 129, ["53", "79", "73"]], [["00", "FF", "FF"], 130, ["0", "255", "255"]], [["AA", "FF", "FF"], 131, ["170", "255", "255"]], [["00", "BD", "BD"], 132, ["0", "189", "189"]], [["7E", "BD", "BD"], 133, ["126", "189", "189"]], [["00", "81", "81"], 134, ["0", "129", "129"]], [["56", "81", "81"], 135, ["86", "129", "129"]], [["00", "68", "68"], 136, ["0", "104", "104"]], [["45", "68", "68"], 137, ["69", "104", "104"]], [["00", "4F", "4F"], 138, ["0", "79", "79"]], [["35", "4F", "4F"], 139, ["53", "79", "79"]], [["00", "BF", "FF"], 140, ["0", "191", "255"]], [["AA", "EA", "FF"], 141, ["170", "234", "255"]], [["00", "8D", "BD"], 142, ["0", "141", "189"]], [["7E", "AD", "BD"], 143, ["126", "173", "189"]], [["00", "60", "81"], 144, ["0", "96", "129"]], [["56", "76", "81"], 145, ["86", "118", "129"]], [["00", "4E", "68"], 146, ["0", "78", "104"]], [["45", "5F", "68"], 147, ["69", "95", "104"]], [["00", "3B", "4F"], 148, ["0", "59", "79"]], [["35", "49", "4F"], 149, ["53", "73", "79"]], [["00", "7F", "FF"], 150, ["0", "127", "255"]], [["AA", "D4", "FF"], 151, ["170", "212", "255"]], [["00", "5E", "BD"], 152, ["0", "94", "189"]], [["7E", "9D", "BD"], 153, ["126", "157", "189"]], [["00", "40", "81"], 154, ["0", "64", "129"]], [["56", "6B", "81"], 155, ["86", "107", "129"]], [["00", "34", "68"], 156, ["0", "52", "104"]], [["45", "56", "68"], 157, ["69", "86", "104"]], [["00", "27", "4F"], 158, ["0", "39", "79"]], [["35", "42", "4F"], 159, ["53", "66", "79"]], [["00", "3F", "FF"], 160, ["0", "63", "255"]], [["AA", "BF", "FF"], 161, ["170", "191", "255"]], [["00", "2E", "BD"], 162, ["0", "46", "189"]], [["7E", "8D", "BD"], 163, ["126", "141", "189"]], [["00", "1F", "81"], 164, ["0", "31", "129"]], [["56", "60", "81"], 165, ["86", "96", "129"]], [["00", "19", "68"], 166, ["0", "25", "104"]], [["45", "4E", "68"], 167, ["69", "78", "104"]], [["00", "13", "4F"], 168, ["0", "19", "79"]], [["35", "3B", "4F"], 169, ["53", "59", "79"]], [["00", "00", "FF"], 170, ["0", "0", "255"]], [["AA", "AA", "FF"], 171, ["170", "170", "255"]], [["00", "00", "BD"], 172, ["0", "0", "189"]], [["7E", "7E", "BD"], 173, ["126", "126", "189"]], [["00", "00", "81"], 174, ["0", "0", "129"]], [["56", "56", "81"], 175, ["86", "86", "129"]], [["00", "00", "68"], 176, ["0", "0", "104"]], [["45", "45", "68"], 177, ["69", "69", "104"]], [["00", "00", "4F"], 178, ["0", "0", "79"]], [["35", "35", "4F"], 179, ["53", "53", "79"]], [["3F", "00", "FF"], 180, ["63", "0", "255"]], [["BF", "AA", "FF"], 181, ["191", "170", "255"]], [["2E", "00", "BD"], 182, ["46", "0", "189"]], [["8D", "7E", "BD"], 183, ["141", "126", "189"]], [["1F", "00", "81"], 184, ["31", "0", "129"]], [["60", "56", "81"], 185, ["96", "86", "129"]], [["19", "00", "68"], 186, ["25", "0", "104"]], [["4E", "45", "68"], 187, ["78", "69", "104"]], [["13", "00", "4F"], 188, ["19", "0", "79"]], [["3B", "35", "4F"], 189, ["59", "53", "79"]], [["7F", "00", "FF"], 190, ["127", "0", "255"]], [["D4", "AA", "FF"], 191, ["212", "170", "255"]], [["5E", "00", "BD"], 192, ["94", "0", "189"]], [["9D", "7E", "BD"], 193, ["157", "126", "189"]], [["40", "00", "81"], 194, ["64", "0", "129"]], [["6B", "56", "81"], 195, ["107", "86", "129"]], [["34", "00", "68"], 196, ["52", "0", "104"]], [["56", "45", "68"], 197, ["86", "69", "104"]], [["27", "00", "4F"], 198, ["39", "0", "79"]], [["42", "35", "4F"], 199, ["66", "53", "79"]], [["BF", "00", "FF"], 200, ["191", "0", "255"]], [["EA", "AA", "FF"], 201, ["234", "170", "255"]], [["8D", "00", "BD"], 202, ["141", "0", "189"]], [["AD", "7E", "BD"], 203, ["173", "126", "189"]], [["60", "00", "81"], 204, ["96", "0", "129"]], [["76", "56", "81"], 205, ["118", "86", "129"]], [["4E", "00", "68"], 206, ["78", "0", "104"]], [["5F", "45", "68"], 207, ["95", "69", "104"]], [["3B", "00", "4F"], 208, ["59", "0", "79"]], [["49", "35", "4F"], 209, ["73", "53", "79"]], [["FF", "00", "FF"], 210, ["255", "0", "255"]], [["FF", "AA", "FF"], 211, ["255", "170", "255"]], [["BD", "00", "BD"], 212, ["189", "0", "189"]], [["BD", "7E", "BD"], 213, ["189", "126", "189"]], [["81", "00", "81"], 214, ["129", "0", "129"]], [["81", "56", "81"], 215, ["129", "86", "129"]], [["68", "00", "68"], 216, ["104", "0", "104"]], [["68", "45", "68"], 217, ["104", "69", "104"]], [["4F", "00", "4F"], 218, ["79", "0", "79"]], [["4F", "35", "4F"], 219, ["79", "53", "79"]], [["FF", "00", "BF"], 220, ["255", "0", "191"]], [["FF", "AA", "EA"], 221, ["255", "170", "234"]], [["BD", "00", "8D"], 222, ["189", "0", "141"]], [["BD", "7E", "AD"], 223, ["189", "126", "173"]], [["81", "00", "60"], 224, ["129", "0", "96"]], [["81", "56", "76"], 225, ["129", "86", "118"]], [["68", "00", "4E"], 226, ["104", "0", "78"]], [["68", "45", "5F"], 227, ["104", "69", "95"]], [["4F", "00", "3B"], 228, ["79", "0", "59"]], [["4F", "35", "49"], 229, ["79", "53", "73"]], [["FF", "00", "7F"], 230, ["255", "0", "127"]], [["FF", "AA", "D4"], 231, ["255", "170", "212"]], [["BD", "00", "5E"], 232, ["189", "0", "94"]], [["BD", "7E", "9D"], 233, ["189", "126", "157"]], [["81", "00", "40"], 234, ["129", "0", "64"]], [["81", "56", "6B"], 235, ["129", "86", "107"]], [["68", "00", "34"], 236, ["104", "0", "52"]], [["68", "45", "56"], 237, ["104", "69", "86"]], [["4F", "00", "27"], 238, ["79", "0", "39"]], [["4F", "35", "42"], 239, ["79", "53", "66"]], [["FF", "00", "3F"], 240, ["255", "0", "63"]], [["FF", "AA", "BF"], 241, ["255", "170", "191"]], [["BD", "00", "2E"], 242, ["189", "0", "46"]], [["BD", "7E", "8D"], 243, ["189", "126", "141"]], [["81", "00", "1F"], 244, ["129", "0", "31"]], [["81", "56", "60"], 245, ["129", "86", "96"]], [["68", "00", "19"], 246, ["104", "0", "25"]], [["68", "45", "4E"], 247, ["104", "69", "78"]], [["4F", "00", "13"], 248, ["79", "0", "19"]], [["4F", "35", "3B"], 249, ["79", "53", "59"]], [["33", "33", "33"], 250, ["51", "51", "51"]], [["50", "50", "50"], 251, ["80", "80", "80"]], [["69", "69", "69"], 252, ["105", "105", "105"]], [["82", "82", "82"], 253, ["130", "130", "130"]], [["BE", "BE", "BE"], 254, ["190", "190", "190"]], [["FF", "FF", "FF"], 255, ["255", "255", "255"]]];
function p(e2) {
  let t2 = "";
  const s2 = g.find(((t3) => {
    const [, s3] = t3;
    return s3 === e2;
  }));
  if (s2) {
    const [e3] = s2, [n, i, h2] = e3;
    t2 = `${n}${i}${h2}`;
  }
  return t2;
}
var A = class {
  constructor(e2) {
    this.name = e2, this.tags = [];
  }
  add(e2, t2) {
    this.tags.push({ code: e2, value: t2 });
  }
  dxfy(e2) {
    e2.push(102, `{${this.name}`);
    for (const t2 of this.tags) e2.push(t2.code, t2.value);
    e2.push(102, "}");
  }
};
var y = class {
  constructor() {
    this.lines = [];
  }
  push(e2, t2) {
    null != t2 && this.lines.push(e2, t2);
  }
  stringify() {
    return this.lines.join("\n");
  }
  start(e2) {
    this.push(0, "SECTION"), this.push(2, e2);
  }
  end() {
    this.push(0, "ENDSEC");
  }
  variableName(e2) {
    this.push(9, e2);
  }
  type(e2) {
    this.push(0, e2);
  }
  primaryText(e2) {
    this.push(1, e2);
  }
  name(e2, t2 = 2) {
    this.push(t2, e2);
  }
  handle(e2) {
    this.push(5, e2);
  }
  lineType(e2) {
    this.push(6, e2);
  }
  textStyle(e2) {
    this.push(7, e2);
  }
  layerName(e2) {
    this.push(8, e2);
  }
  point2d(e2, t2 = 0) {
    this.push(10 + t2, null == e2 ? void 0 : e2.x), this.push(20 + t2, null == e2 ? void 0 : e2.y);
  }
  point3d(e2, t2 = 0) {
    this.point2d(e2, t2), this.push(30 + t2, null == e2 ? void 0 : e2.z);
  }
  elevation(e2) {
    this.push(38, e2);
  }
  thickness(e2) {
    this.push(39, e2);
  }
  visibilty(e2) {
    null != e2 && this.push(60, e2 ? 0 : 1);
  }
  colorNumber(e2) {
    this.push(62, e2);
  }
  subclassMarker(e2) {
    this.push(100, e2);
  }
};
var m;
var x;
var I;
var L;
function S(e2, t2, s2, n) {
  if ("a" === s2 && !n) throw new TypeError("Private accessor was defined without a getter");
  if ("function" == typeof t2 ? e2 !== t2 || !n : !t2.has(e2)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return "m" === s2 ? n : "a" === s2 ? n.call(e2) : n ? n.value : t2.get(e2);
}
function D(e2, t2, s2, n, i) {
  if ("m" === n) throw new TypeError("Private method is not writable");
  if ("a" === n && !i) throw new TypeError("Private accessor was defined without a setter");
  if ("function" == typeof t2 ? e2 !== t2 || !i : !t2.has(e2)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return "a" === n ? i.call(e2, s2) : i ? i.value = s2 : t2.set(e2, s2), s2;
}
function b(e2, t2) {
  return { code: e2, value: t2 };
}
function E(e2, t2 = 255) {
  const s2 = [], n = [];
  for (let i = 0; i < e2.length; i++) {
    const h2 = e2[i];
    n.length === t2 || i === e2.length - 1 ? (s2.push(n.join("")), n.length = 0) : n.push(h2);
  }
  return s2;
}
!(function(e2) {
  e2[e2.Red = 1] = "Red", e2[e2.Green = 3] = "Green", e2[e2.Cyan = 4] = "Cyan", e2[e2.Blue = 5] = "Blue", e2[e2.Magenta = 6] = "Magenta", e2[e2.White = 7] = "White", e2[e2.Black = 0] = "Black", e2[e2.Yellow = 2] = "Yellow";
})(m || (m = {})), (function(e2) {
  e2[e2.Unitless = 0] = "Unitless", e2[e2.Inches = 1] = "Inches", e2[e2.Feet = 2] = "Feet", e2[e2.Miles = 3] = "Miles", e2[e2.Millimeters = 4] = "Millimeters", e2[e2.Centimeters = 5] = "Centimeters", e2[e2.Meters = 6] = "Meters", e2[e2.Kilometers = 7] = "Kilometers", e2[e2.Microinches = 8] = "Microinches", e2[e2.Mils = 9] = "Mils", e2[e2.Yards = 10] = "Yards", e2[e2.Angstroms = 11] = "Angstroms", e2[e2.Nanometers = 12] = "Nanometers", e2[e2.Microns = 13] = "Microns", e2[e2.Decimeters = 14] = "Decimeters", e2[e2.Decameters = 15] = "Decameters", e2[e2.Hectometers = 16] = "Hectometers", e2[e2.Gigameters = 17] = "Gigameters", e2[e2.AstronomicalUnits = 18] = "AstronomicalUnits", e2[e2.LightYears = 19] = "LightYears", e2[e2.Parsecs = 20] = "Parsecs", e2[e2.USSurveyFeet = 21] = "USSurveyFeet", e2[e2.USSurveyInch = 22] = "USSurveyInch", e2[e2.USSurveyYard = 23] = "USSurveyYard", e2[e2.USSurveyMile = 24] = "USSurveyMile";
})(x || (x = {})), (function(e2) {
  e2.Continuous = "Continuous";
})(I || (I = {})), "function" == typeof SuppressedError && SuppressedError;
var F = class {
  constructor(e2) {
    L.set(this, void 0), this.name = e2, D(this, L, [], "f");
  }
  clear() {
    S(this, L, "f").length = 0;
  }
  string(e2) {
    E(e2).forEach(((e3) => S(this, L, "f").push(b(1e3, e3))));
  }
  beginList() {
    S(this, L, "f").push(b(1002, "{"));
  }
  endList() {
    S(this, L, "f").push(b(1002, "}"));
  }
  layerName(e2) {
    S(this, L, "f").push(b(1003, e2));
  }
  binaryData(e2) {
    E(e2).forEach(((e3) => S(this, L, "f").push(b(1004, e3))));
  }
  databaseHandle(e2) {
    S(this, L, "f").push(b(1005, e2));
  }
  point(e2) {
    S(this, L, "f").push(b(1010, e2.x)), S(this, L, "f").push(b(1020, e2.y)), S(this, L, "f").push(b(1030, e2.z));
  }
  position(e2) {
    S(this, L, "f").push(b(1011, e2.x)), S(this, L, "f").push(b(1021, e2.y)), S(this, L, "f").push(b(1031, e2.z));
  }
  displacement(e2) {
    S(this, L, "f").push(b(1012, e2.x)), S(this, L, "f").push(b(1022, e2.y)), S(this, L, "f").push(b(1032, e2.z));
  }
  direction(e2) {
    S(this, L, "f").push(b(1013, e2.x)), S(this, L, "f").push(b(1023, e2.y)), S(this, L, "f").push(b(1033, e2.z));
  }
  real(e2) {
    S(this, L, "f").push(b(1040, e2));
  }
  distance(e2) {
    S(this, L, "f").push(b(1041, e2));
  }
  scale(e2) {
    S(this, L, "f").push(b(1042, e2));
  }
  integer(e2) {
    S(this, L, "f").push(b(1070, e2));
  }
  long(e2) {
    S(this, L, "f").push(b(1071, e2));
  }
  dxfy(e2) {
    e2.push(1001, this.name), e2.push(1002, "{"), S(this, L, "f").forEach(((t2) => e2.push(t2.code, t2.value))), e2.push(1002, "}");
  }
};
L = /* @__PURE__ */ new WeakMap();
var C = class {
  set angle(e2) {
    this.patternsData.forEach(((t2) => t2.lineAngle = e2));
  }
  constructor(e2) {
    this.name = e2, this.patternsData = [], this.scale = 1;
  }
  dxfy(e2) {
    e2.push(78, this.patternsData.length);
    for (const t2 of this.patternsData) {
      e2.push(53, t2.lineAngle), e2.push(43, t2.x), e2.push(44, t2.y), e2.push(45, t2.offsetX * this.scale), e2.push(46, t2.offsetY * this.scale), e2.push(79, t2.dashLengthItems.length);
      for (const s2 of t2.dashLengthItems) e2.push(49, s2 * this.scale);
    }
  }
  add(e2) {
    this.patternsData.push(e2);
  }
};
var T = /* @__PURE__ */ new Map();
var X = new C("ANGLE");
X.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0.275, offsetY: 0.2, dashLengthItems: [-0.075] }), X.add({ lineAngle: 90, x: 0, y: 0, offsetX: 0.275, offsetY: 0.2, dashLengthItems: [-0.075] }), T.set("ANGLE", X);
var R = new C("ANSI31");
R.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 1.25, dashLengthItems: [] }), T.set("ANSI31", R);
var Y = new C("ANSI32");
Y.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 3.175, dashLengthItems: [] }), T.set("ANSI32", Y);
var B = new C("ANSI33");
B.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 9.525, dashLengthItems: [] }), B.add({ lineAngle: 45, x: 4.49013, y: 0, offsetX: 0, offsetY: 9.525, dashLengthItems: [] }), T.set("ANSI33", B);
var w = new C("ANSI34");
w.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 6.35, dashLengthItems: [] }), w.add({ lineAngle: 45, x: 4.49013, y: 0, offsetX: 0, offsetY: 6.35, dashLengthItems: [3.175, -1.5875] }), T.set("ANSI34", w);
var N = new C("ANSI35");
N.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 19.05, dashLengthItems: [] }), N.add({ lineAngle: 45, x: 4.49013, y: 0, offsetX: 0, offsetY: 19.05, dashLengthItems: [] }), N.add({ lineAngle: 45, x: 8.98026, y: 0, offsetX: 0, offsetY: 19.05, dashLengthItems: [] }), N.add({ lineAngle: 45, x: 13.4704, y: 0, offsetX: 0, offsetY: 19.05, dashLengthItems: [] }), T.set("ANSI35", N);
var M = new C("ANSI36");
M.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 6.35, dashLengthItems: [] }), M.add({ lineAngle: 45, x: 4.49013, y: 0, offsetX: 0, offsetY: 6.35, dashLengthItems: [7.9375, -1.5875, 0, -1.5875] }), T.set("ANSI36", M);
var P = new C("ANSI37");
P.add({ lineAngle: 45, x: 0, y: 0, offsetX: 5.55625, offsetY: 3.175, dashLengthItems: [7.9375, -1.5875, 0, -1.5875] }), T.set("ANSI37", P);
var O = new C("ANSI38");
O.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 3.175, dashLengthItems: [] }), O.add({ lineAngle: 135, x: 0, y: 0, offsetX: 0, offsetY: 3.175, dashLengthItems: [] }), T.set("ANSI38", O);
var _ = new C("AR_B816");
_.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 3.175, dashLengthItems: [] }), _.add({ lineAngle: 135, x: 0, y: 0, offsetX: 6.35, offsetY: 3.175, dashLengthItems: [7.9375, -4.7625] }), T.set("AR_B816", _);
var H = new C("AR_B816C");
H.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 203.2, dashLengthItems: [] }), H.add({ lineAngle: 90, x: 0, y: 0, offsetX: 203.2, offsetY: 203.2, dashLengthItems: [203.2, -203.2] }), T.set("AR_B816C", H);
var k = new C("AR_B88");
k.add({ lineAngle: 0, x: 0, y: 0, offsetX: 203.2, offsetY: 203.2, dashLengthItems: [396.875, -9.525] }), k.add({ lineAngle: 0, x: -203.2, y: 9.525, offsetX: 203.2, offsetY: 203.2, dashLengthItems: [396.875, -9.525] }), k.add({ lineAngle: 90, x: 0, y: 0, offsetX: 203.2, offsetY: 203.2, dashLengthItems: [-212.725, 193.675] }), k.add({ lineAngle: 90, x: -9.525, y: 0, offsetX: 203.2, offsetY: 203.2, dashLengthItems: [-212.725, 193.675] }), T.set("AR_B88", k);
var W = new C("AR_BRELM");
W.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 203.2, dashLengthItems: [] }), W.add({ lineAngle: 90, x: 0, y: 0, offsetX: 203.2, offsetY: 101.6, dashLengthItems: [203.2, -203.2] }), T.set("AR_BRELM", W);
var V = new C("AR_BRSTD");
V.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 135.484, dashLengthItems: [193.675, -9.525] }), V.add({ lineAngle: 0, x: 0, y: 57.15, offsetX: 0, offsetY: 135.484, dashLengthItems: [193.675, -9.525] }), V.add({ lineAngle: 0, x: 50.8, y: 67.7418, offsetX: 0, offsetY: 135.484, dashLengthItems: [92.075, -9.525] }), V.add({ lineAngle: 0, x: 50.8, y: 124.892, offsetX: 0, offsetY: 135.484, dashLengthItems: [92.075, -9.525] }), V.add({ lineAngle: 90, x: 0, y: 0, offsetX: 0, offsetY: 203.2, dashLengthItems: [57.15, -78.334] }), V.add({ lineAngle: 90, x: -9.525, y: 0, offsetX: 0, offsetY: 203.2, dashLengthItems: [57.15, -78.334] }), V.add({ lineAngle: 90, x: 50.8, y: 67.7418, offsetX: 0, offsetY: 101.6, dashLengthItems: [57.15, -78.334] }), V.add({ lineAngle: 90, x: 41.275, y: 67.7418, offsetX: 0, offsetY: 101.6, dashLengthItems: [57.15, -78.334] }), T.set("AR_BRSTD", V);
var U = new C("AR_CONC");
U.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 67.7418, dashLengthItems: [] }), U.add({ lineAngle: 90, x: 0, y: 0, offsetX: 67.7418, offsetY: 101.6, dashLengthItems: [67.7418, -67.7418] }), T.set("AR_CONC", U);
var j = new C("AR_HBONE");
j.add({ lineAngle: 50, x: 0, y: 0, offsetX: 104.896, offsetY: -149.807, dashLengthItems: [19.05, -209.55] }), j.add({ lineAngle: 355, x: 0, y: 0, offsetX: -51.76101082, offsetY: 187.25814969, dashLengthItems: [15.24, -167.64058417] }), j.add({ lineAngle: 100.4514447, x: 15.182007, y: -1.3282535, offsetX: 145.5569059, offsetY: -176.270089, dashLengthItems: [16.1900088, -178.0902446] }), j.add({ lineAngle: 46.1842, x: 0, y: 50.8, offsetX: 157.343, offsetY: -224.71, dashLengthItems: [28.575, -314.325] }), j.add({ lineAngle: 96.63555761, x: 22.5899, y: 47.2965, offsetX: 218.33577212, offsetY: -264.40480444, dashLengthItems: [24.28502314, -267.13560816] }), j.add({ lineAngle: 351.18415117, x: 0, y: 50.8, offsetX: 196.67912063, offsetY: 280.88740361, dashLengthItems: [22.85996707, -251.45973192] }), j.add({ lineAngle: 21, x: 25.4, y: 38.1, offsetX: 104.89565868, offsetY: -149.80652586, dashLengthItems: [19.05, -209.55] }), j.add({ lineAngle: 326, x: 25.4, y: 38.1, offsetX: -51.7604, offsetY: 187.258, dashLengthItems: [15.24, -167.64] }), j.add({ lineAngle: 71.451445, x: 38.0345326, y: 29.5779001, offsetX: 145.5567546, offsetY: -176.2700748, dashLengthItems: [16.1900088, -178.0899376] }), j.add({ lineAngle: 37.5, x: 0, y: 0, offsetX: 53.9242, offsetY: 65.2018, dashLengthItems: [0, -165.608, 0, -170.18, 0, -168.275] }), j.add({ lineAngle: 7.5, x: 0, y: 0, offsetX: 79.3242, offsetY: 90.6018, dashLengthItems: [0, -97.028, 0, -161.798, 0, -64.135] }), j.add({ lineAngle: -32.5, x: -56.642, y: 0, offsetX: 117.434, offsetY: 68.0212, dashLengthItems: [0, -63.5, 0, -198.12, 0, -262.89] }), j.add({ lineAngle: -42.5, x: -82.042, y: 0, offsetX: 92.0344, offsetY: 118.821, dashLengthItems: [0, -82.55, 0, -131.572, 0, -186.69] }), T.set("AR_HBONE", j);
var G = new C("AR_PARQ1");
G.add({ lineAngle: 45, x: 0, y: 0, offsetX: 101.6, offsetY: 101.6, dashLengthItems: [304.8, -101.6] }), G.add({ lineAngle: 135, x: 71.842, y: 71.842, offsetX: 101.6, offsetY: -101.6, dashLengthItems: [304.8, -101.6] }), T.set("AR_PARQ1", G);
var z = new C("AR_RROOF");
z.add({ lineAngle: 90, x: 0, y: 0, offsetX: 304.8, offsetY: 304.8, dashLengthItems: [304.8, -304.8] }), z.add({ lineAngle: 90, x: 50.8, y: 0, offsetX: 304.8, offsetY: 304.8, dashLengthItems: [304.8, -304.8] }), z.add({ lineAngle: 90, x: 101.6, y: 0, offsetX: 304.8, offsetY: 304.8, dashLengthItems: [304.8, -304.8] }), z.add({ lineAngle: 90, x: 152.4, y: 0, offsetX: 304.8, offsetY: 304.8, dashLengthItems: [304.8, -304.8] }), z.add({ lineAngle: 90, x: 203.2, y: 0, offsetX: 304.8, offsetY: 304.8, dashLengthItems: [304.8, -304.8] }), z.add({ lineAngle: 90, x: 254, y: 0, offsetX: 304.8, offsetY: 304.8, dashLengthItems: [304.8, -304.8] }), z.add({ lineAngle: 90, x: 304.8, y: 0, offsetX: 304.8, offsetY: 304.8, dashLengthItems: [304.8, -304.8] }), z.add({ lineAngle: 0, x: 0, y: 304.8, offsetX: 304.8, offsetY: -304.8, dashLengthItems: [304.8, -304.8] }), z.add({ lineAngle: 0, x: 0, y: 355.6, offsetX: 304.8, offsetY: -304.8, dashLengthItems: [304.8, -304.8] }), z.add({ lineAngle: 0, x: 0, y: 406.4, offsetX: 304.8, offsetY: -304.8, dashLengthItems: [304.8, -304.8] }), z.add({ lineAngle: 0, x: 0, y: 457.2, offsetX: 304.8, offsetY: -304.8, dashLengthItems: [304.8, -304.8] }), z.add({ lineAngle: 0, x: 0, y: 508, offsetX: 304.8, offsetY: -304.8, dashLengthItems: [304.8, -304.8] }), z.add({ lineAngle: 0, x: 0, y: 558.8, offsetX: 304.8, offsetY: -304.8, dashLengthItems: [304.8, -304.8] }), z.add({ lineAngle: 0, x: 0, y: 609.6, offsetX: 304.8, offsetY: -304.8, dashLengthItems: [304.8, -304.8] }), T.set("AR_RROOF", z);
var J = new C("AR_RSHKE");
J.add({ lineAngle: 0, x: 0, y: 0, offsetX: 55.88, offsetY: 25.4, dashLengthItems: [381, -50.8, 127, -25.4] }), J.add({ lineAngle: 0, x: 33.782, y: 12.7, offsetX: -25.4, offsetY: 33.782, dashLengthItems: [76.2, -8.382, 152.4, -19.05] }), J.add({ lineAngle: 0, x: 12.7, y: 21.59, offsetX: 132.08, offsetY: 17.018, dashLengthItems: [203.2, -35.56, 101.6, -25.4] }), T.set("AR_RSHKE", J);
var K = new C("AR_SAND");
K.add({ lineAngle: 0, x: 0, y: 0, offsetX: 647.7, offsetY: 304.8, dashLengthItems: [152.4, -127, 177.8, -76.2, 228.6, -101.6] }), K.add({ lineAngle: 0, x: 152.4, y: 12.7, offsetX: 647.7, offsetY: 304.8, dashLengthItems: [127, -482.6, 101.6, -152.4] }), K.add({ lineAngle: 0, x: 457.2, y: -19.05, offsetX: 647.7, offsetY: 304.8, dashLengthItems: [76.2, -787.4] }), K.add({ lineAngle: 90, x: 0, y: 0, offsetX: 304.8, offsetY: 215.9, dashLengthItems: [292.1, -927.1] }), K.add({ lineAngle: 90, x: 152.4, y: 0, offsetX: 304.8, offsetY: 215.9, dashLengthItems: [285.75, -933.45] }), K.add({ lineAngle: 90, x: 279.4, y: 0, offsetX: 304.8, offsetY: 215.9, dashLengthItems: [266.7, -952.5] }), K.add({ lineAngle: 90, x: 457.2, y: -19.05, offsetX: 304.8, offsetY: 215.9, dashLengthItems: [292.1, -927.1] }), K.add({ lineAngle: 90, x: 533.4, y: -19.05, offsetX: 304.8, offsetY: 215.9, dashLengthItems: [292.1, -927.1] }), K.add({ lineAngle: 90, x: 762, y: 0, offsetX: 304.8, offsetY: 215.9, dashLengthItems: [279.4, -939.8] }), T.set("AR_SAND", K);
var Z = new C("BOX");
Z.add({ lineAngle: 37.5, x: 0, y: 0, offsetX: 28.5242, offsetY: 39.8018, dashLengthItems: [0, -38.608, 0, -43.18, 0, -41.275] }), Z.add({ lineAngle: 7.5, x: 0, y: 0, offsetX: 53.9242, offsetY: 65.2018, dashLengthItems: [0, -20.828, 0, -34.798, 0, -13.335] }), Z.add({ lineAngle: -32.5, x: -31.242, y: 0, offsetX: 66.6344, offsetY: 42.6212, dashLengthItems: [0, -12.7, 0, -45.72, 0, -59.69] }), Z.add({ lineAngle: -42.5, x: -31.242, y: 0, offsetX: 41.2344, offsetY: 68.0212, dashLengthItems: [0, -6.35, 0, -29.972, 0, -34.29] }), T.set("BOX", Z);
var q = new C("BRASS");
q.add({ lineAngle: 90, x: 0, y: 0, offsetX: 0, offsetY: 25.4, dashLengthItems: [] }), q.add({ lineAngle: 90, x: 6.35, y: 0, offsetX: 0, offsetY: 25.4, dashLengthItems: [] }), q.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 25.4, dashLengthItems: [-6.35, 6.35] }), q.add({ lineAngle: 0, x: 0, y: 6.35, offsetX: 0, offsetY: 25.4, dashLengthItems: [-6.35, 6.35] }), q.add({ lineAngle: 0, x: 0, y: 12.7, offsetX: 0, offsetY: 25.4, dashLengthItems: [6.35, -6.35] }), q.add({ lineAngle: 0, x: 0, y: 19.05, offsetX: 0, offsetY: 25.4, dashLengthItems: [6.35, -6.35] }), q.add({ lineAngle: 90, x: 12.7, y: 0, offsetX: 0, offsetY: 25.4, dashLengthItems: [6.35, -6.35] }), q.add({ lineAngle: 90, x: 19.05, y: 0, offsetX: 0, offsetY: 25.4, dashLengthItems: [6.35, -6.35] }), T.set("BRASS", q);
var $ = new C("BRICK");
$.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 6.35, dashLengthItems: [] }), $.add({ lineAngle: 0, x: 0, y: 3.175, offsetX: 0, offsetY: 6.35, dashLengthItems: [3.175, -1.5875] }), T.set("BRICK", $);
var Q = new C("BRSTONE");
Q.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 6.35, dashLengthItems: [] }), Q.add({ lineAngle: 90, x: 0, y: 0, offsetX: 0, offsetY: 12.7, dashLengthItems: [6.35, -6.35] }), Q.add({ lineAngle: 90, x: 6.35, y: 0, offsetX: 0, offsetY: 12.7, dashLengthItems: [-6.35, 6.35] }), T.set("BRSTONE", Q);
var ee = new C("CLAY");
ee.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 8.382, dashLengthItems: [] }), ee.add({ lineAngle: 90, x: 22.86, y: 0, offsetX: 8.382, offsetY: 12.7, dashLengthItems: [8.382, -8.382] }), ee.add({ lineAngle: 90, x: 20.32, y: 0, offsetX: 8.382, offsetY: 12.7, dashLengthItems: [8.382, -8.382] }), ee.add({ lineAngle: 0, x: 22.86, y: 1.397, offsetX: 12.7, offsetY: 8.382, dashLengthItems: [-22.86, 2.54] }), ee.add({ lineAngle: 0, x: 22.86, y: 2.794, offsetX: 12.7, offsetY: 8.382, dashLengthItems: [-22.86, 2.54] }), ee.add({ lineAngle: 0, x: 22.86, y: 4.191, offsetX: 12.7, offsetY: 8.382, dashLengthItems: [-22.86, 2.54] }), ee.add({ lineAngle: 0, x: 22.86, y: 5.588, offsetX: 12.7, offsetY: 8.382, dashLengthItems: [-22.86, 2.54] }), ee.add({ lineAngle: 0, x: 22.86, y: 6.985, offsetX: 12.7, offsetY: 8.382, dashLengthItems: [-22.86, 2.54] }), T.set("CLAY", ee);
var te = new C("CORK");
te.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 4.7625, dashLengthItems: [] }), te.add({ lineAngle: 0, x: 0, y: 0.79375, offsetX: 0, offsetY: 4.7625, dashLengthItems: [] }), te.add({ lineAngle: 0, x: 0, y: 1.5875, offsetX: 0, offsetY: 4.7625, dashLengthItems: [] }), te.add({ lineAngle: 0, x: 0, y: 3.175, offsetX: 0, offsetY: 4.7625, dashLengthItems: [4.7625, -3.175] }), T.set("CORK", te);
var se = new C("CROSS");
se.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 3.175, dashLengthItems: [] }), se.add({ lineAngle: 135, x: 1.5875, y: -1.5875, offsetX: 0, offsetY: 8.98026, dashLengthItems: [4.49013, -4.49013] }), se.add({ lineAngle: 135, x: 2.38125, y: -1.5875, offsetX: 0, offsetY: 8.98026, dashLengthItems: [4.49013, -4.49013] }), se.add({ lineAngle: 135, x: 3.175, y: -1.5875, offsetX: 0, offsetY: 8.98026, dashLengthItems: [4.49013, -4.49013] }), T.set("CROSS", se);
var ne = new C("DASH");
ne.add({ lineAngle: 0, x: 0, y: 0, offsetX: 6.35, offsetY: 6.35, dashLengthItems: [3.175, -9.525] }), ne.add({ lineAngle: 90, x: 1.5875, y: -1.5875, offsetX: 6.35, offsetY: 6.35, dashLengthItems: [3.175, -9.525] }), T.set("DASH", ne);
var ie = new C("DOLMIT");
ie.add({ lineAngle: 0, x: 0, y: 0, offsetX: 3.175, offsetY: 3.175, dashLengthItems: [3.175, -3.175] }), T.set("DOLMIT", ie);
var he = new C("DOTS");
he.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 6.35, dashLengthItems: [] }), he.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 17.9605, dashLengthItems: [8.980256121069154, -17.960512242138307] }), T.set("DOTS", he);
var oe = new C("EARTH");
oe.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0.79375, offsetY: 1.5875, dashLengthItems: [0, -1.5875] }), T.set("EARTH", oe);
var de = new C("ESCHER");
de.add({ lineAngle: 0, x: 0, y: 0, offsetX: 6.35, offsetY: 6.35, dashLengthItems: [6.35, -6.35] }), de.add({ lineAngle: 0, x: 0, y: 2.38125, offsetX: 6.35, offsetY: 6.35, dashLengthItems: [6.35, -6.35] }), de.add({ lineAngle: 0, x: 0, y: 4.7625, offsetX: 6.35, offsetY: 6.35, dashLengthItems: [6.35, -6.35] }), de.add({ lineAngle: 90, x: 0.79375, y: 5.55625, offsetX: 6.35, offsetY: 6.35, dashLengthItems: [6.35, -6.35] }), de.add({ lineAngle: 90, x: 3.175, y: 5.55625, offsetX: 6.35, offsetY: 6.35, dashLengthItems: [6.35, -6.35] }), de.add({ lineAngle: 90, x: 5.55625, y: 5.55625, offsetX: 6.35, offsetY: 6.35, dashLengthItems: [6.35, -6.35] }), T.set("ESCHER", de);
var ae = new C("FLEX");
ae.add({ lineAngle: 60, x: 0, y: 0, offsetX: -15.24, offsetY: 26.3964542936, dashLengthItems: [27.94, -2.54] }), ae.add({ lineAngle: 180, x: 0, y: 0, offsetX: -15.24, offsetY: 26.3964542936, dashLengthItems: [27.94, -2.54] }), ae.add({ lineAngle: 300, x: 0, y: 0, offsetX: 15.24, offsetY: 26.3964542936, dashLengthItems: [27.94, -2.54] }), ae.add({ lineAngle: 60, x: 2.54, y: 0, offsetX: -15.24, offsetY: 26.3964542936, dashLengthItems: [5.08, -25.4] }), ae.add({ lineAngle: 300, x: 2.54, y: 0, offsetX: 15.24, offsetY: 26.3964542936, dashLengthItems: [5.08, -25.4] }), ae.add({ lineAngle: 60, x: -1.27, y: 2.199704516, offsetX: -15.24, offsetY: 26.3964542936, dashLengthItems: [5.08, -25.4] }), ae.add({ lineAngle: 180, x: -1.27, y: 2.199704516, offsetX: -15.24, offsetY: 26.3964542936, dashLengthItems: [5.08, -25.4] }), ae.add({ lineAngle: 300, x: -1.27, y: -2.199704516, offsetX: 15.24, offsetY: 26.3964542936, dashLengthItems: [5.08, -25.4] }), ae.add({ lineAngle: 180, x: -1.27, y: -2.199704516, offsetX: -15.24, offsetY: 26.3964542936, dashLengthItems: [5.08, -25.4] }), ae.add({ lineAngle: 60, x: -10.16, y: 0, offsetX: -15.24, offsetY: 26.3964542936, dashLengthItems: [5.08, -25.4] }), ae.add({ lineAngle: 300, x: -10.16, y: 0, offsetX: 15.24, offsetY: 26.3964542936, dashLengthItems: [5.08, -25.4] }), ae.add({ lineAngle: 60, x: 5.08, y: -8.7988180894, offsetX: -15.24, offsetY: 26.3964542936, dashLengthItems: [5.08, -25.4] }), ae.add({ lineAngle: 180, x: 5.08, y: -8.7988180894, offsetX: -15.24, offsetY: 26.3964542936, dashLengthItems: [5.08, -25.4] }), ae.add({ lineAngle: 300, x: 5.08, y: 8.7988180894, offsetX: 15.24, offsetY: 26.3964542936, dashLengthItems: [5.08, -25.4] }), ae.add({ lineAngle: 180, x: 5.08, y: 8.7988180894, offsetX: -15.24, offsetY: 26.3964542936, dashLengthItems: [5.08, -25.4] }), ae.add({ lineAngle: 0, x: 5.08, y: 4.3994090574, offsetX: -15.24, offsetY: 26.3964542936, dashLengthItems: [17.78, -12.7] }), ae.add({ lineAngle: 0, x: 5.08, y: -4.3994090574, offsetX: -15.24, offsetY: 26.3964542936, dashLengthItems: [17.78, -12.7] }), ae.add({ lineAngle: 120, x: 1.27, y: 6.5991135734, offsetX: 15.24, offsetY: 26.3964542936, dashLengthItems: [17.78, -12.7] }), ae.add({ lineAngle: 120, x: -6.35, y: 2.199704516, offsetX: 15.24, offsetY: 26.3964542936, dashLengthItems: [17.78, -12.7] }), ae.add({ lineAngle: 240, x: -6.35, y: -2.199704516, offsetX: 15.24, offsetY: 26.3964542936, dashLengthItems: [17.78, -12.7] }), ae.add({ lineAngle: 240, x: 1.27, y: -6.5991135734, offsetX: 15.24, offsetY: 26.3964542936, dashLengthItems: [17.78, -12.7] }), T.set("FLEX", ae);
var le = new C("GOST_GLASS");
le.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 6.35, dashLengthItems: [6.35, -6.35] }), le.add({ lineAngle: 45, x: 6.35, y: 0, offsetX: 4.490128053, offsetY: 4.490128053, dashLengthItems: [1.5875, -5.8052561314, 1.5875, -8.9802561314] }), T.set("GOST_GLASS", le);
var re = new C("GOST_WOOD");
re.add({ lineAngle: 45, x: 0, y: 0, offsetX: 6, offsetY: -6, dashLengthItems: [5, -7] }), re.add({ lineAngle: 45, x: 2.12132, y: 0, offsetX: 6, offsetY: -6, dashLengthItems: [2, -10] }), re.add({ lineAngle: 45, x: 0, y: 2.12132, offsetX: 6, offsetY: -6, dashLengthItems: [2, -10] }), T.set("GOST_WOOD", re);
var fe = new C("GOST_GROUND");
fe.add({ lineAngle: 90, x: 0, y: 0, offsetX: 0, offsetY: -6, dashLengthItems: [10, -2] }), fe.add({ lineAngle: 90, x: 2, y: -2, offsetX: 0, offsetY: -6, dashLengthItems: [6, -1.5, 3, -1.5] }), fe.add({ lineAngle: 90, x: 4, y: -5, offsetX: 0, offsetY: -6, dashLengthItems: [10, -2] }), T.set("GOST_GROUND", fe);
var ue = new C("GRASS");
ue.add({ lineAngle: 45, x: 0, y: 0, offsetX: 10, offsetY: -10, dashLengthItems: [20] }), ue.add({ lineAngle: 45, x: 3, y: 0, offsetX: 10, offsetY: -10, dashLengthItems: [20] }), ue.add({ lineAngle: 45, x: 6, y: 0, offsetX: 10, offsetY: -10, dashLengthItems: [20] }), T.set("GRASS", ue);
var ce = new C("GRATE");
ce.add({ lineAngle: 90, x: 0, y: 0, offsetX: 17.96051224, offsetY: 17.96051224, dashLengthItems: [4.7625, -31.15852448] }), ce.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 25.4, dashLengthItems: [4.7625, -20.6375] }), ce.add({ lineAngle: 135, x: 0, y: 0, offsetX: 0, offsetY: 25.4, dashLengthItems: [4.7625, -20.6375] }), T.set("GRATE", ce);
var ge = new C("GRAVEL");
ge.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 0.79375, dashLengthItems: [] }), ge.add({ lineAngle: 90, x: 0, y: 0, offsetX: 0, offsetY: 3.175, dashLengthItems: [] }), T.set("GRAVEL", ge);
var pe = new C("HEX");
pe.add({ lineAngle: 228.0127875, x: 18.288, y: 25.4, offsetX: 305.85067529778, offsetY: 1.88796713245, dashLengthItems: [3.4172144, -338.30483639565] }), pe.add({ lineAngle: 184.969741, x: 16.002, y: 22.86, offsetX: -305.8545235377, offsetY: 1.10019612724, dashLengthItems: [5.8640472, -580.54048893524] }), pe.add({ lineAngle: 132.5104471, x: 10.16, y: 22.352, offsetX: -377.59492241548, offsetY: 1.56030959675, dashLengthItems: [4.1348152, -409.347227941] }), pe.add({ lineAngle: 267.273689, x: 0.254, y: 16.002, offsetX: -508.63316875916, offsetY: 1.20815479432, dashLengthItems: [5.3400452, -528.66437425738] }), pe.add({ lineAngle: 292.83365418, x: 0, y: 10.668, offsetX: -330.19770134945, offsetY: 1.23208097566, dashLengthItems: [5.236337, -518.39807745344] }), pe.add({ lineAngle: 357.273689, x: 2.032, y: 5.842, offsetX: -508.63316875916, offsetY: 1.20815479432, dashLengthItems: [5.3400452, -528.66437425738] }), pe.add({ lineAngle: 37.69424047, x: 7.366, y: 5.588, offsetX: -416.58997273292, offsetY: 0.91357450169, dashLengthItems: [7.0619366, -699.13115314247] }), pe.add({ lineAngle: 72.25532837, x: 12.954, y: 9.906, offsetX: 586.40373773403, offsetY: 0.96766293399, dashLengthItems: [6.6671952, -660.05256601905] }), pe.add({ lineAngle: 121.42956562, x: 14.986, y: 16.256, offsetX: 387.71230339293, offsetY: 1.2040754753, dashLengthItems: [5.35813, -530.45545698712] }), pe.add({ lineAngle: 175.2363583, x: 12.192, y: 20.828, offsetX: -280.5442400419, offsetY: 2.10935518695, dashLengthItems: [6.1171328, -299.7393695] }), pe.add({ lineAngle: 222.3974378, x: 6.096, y: 21.336, offsetX: 413.48123885686, offsetY: 0.81554484621, dashLengthItems: [7.9107792, -783.16772512177] }), pe.add({ lineAngle: 138.81407483, x: 25.4, y: 15.748, offsetX: 234.164238558, offsetY: 2.38943100688, dashLengthItems: [2.7000454, -267.30565824344] }), pe.add({ lineAngle: 171.4692344, x: 23.368, y: 17.526, offsetX: -334.082478726, offsetY: 1.25594916784, dashLengthItems: [5.1368198, -508.5463899704] }), pe.add({ lineAngle: 225, x: 18.288, y: 18.288, offsetX: 17.96051224214, offsetY: 17.96051224214, dashLengthItems: [3.5920934, -32.32893108428] }), pe.add({ lineAngle: 203.19859051, x: 16.51, y: 21.336, offsetX: -136.74251918, offsetY: 3.33518339548, dashLengthItems: [1.9344132, -191.50622368894] }), pe.add({ lineAngle: 291.80140949, x: 14.732, y: 20.574, offsetX: -80.18324702488, offsetY: 4.71666158921, dashLengthItems: [2.7356562, -134.0475299] }), pe.add({ lineAngle: 30.96375653, x: 15.748, y: 18.034, offsetX: 91.47734531502, offsetY: 4.35606406258, dashLengthItems: [4.4431966, -143.6629815291] }), pe.add({ lineAngle: 161.56505118, x: 19.558, y: 20.32, offsetX: -56.2252967978, offsetY: 8.03218525675, dashLengthItems: [3.2128714, -77.10898116828] }), pe.add({ lineAngle: 16.389540334, x: 0, y: 20.574, offsetX: 265.17991128726, offsetY: 1.43340492604, dashLengthItems: [4.50088, -445.58826672539] }), pe.add({ lineAngle: 70.34617594, x: 4.318, y: 21.844, offsetX: -297.29446803469, offsetY: 1.70858889651, dashLengthItems: [3.7759894, -373.822156782] }), pe.add({ lineAngle: 293.19859051, x: 19.558, y: 25.4, offsetX: -136.7425191801, offsetY: 3.33518339548, dashLengthItems: [3.868801, -189.57183588894] }), pe.add({ lineAngle: 343.61045967, x: 21.082, y: 21.844, offsetX: -265.17991128725, offsetY: 1.433404926, dashLengthItems: [4.50088, -445.5882667254] }), pe.add({ lineAngle: 339.44395478, x: 0, y: 4.826, offsetX: -136.75087638398, offsetY: 2.97284513779, dashLengthItems: [4.340352, -212.67734313106] }), pe.add({ lineAngle: 294.7751406, x: 4.064, y: 3.302, offsetX: -306.90424056705, offsetY: 1.77401295215, dashLengthItems: [3.6367212, -360.0359338072] }), pe.add({ lineAngle: 66.80140949, x: 19.812, y: 0, offsetX: 136.74251918012, offsetY: 3.33518339452, dashLengthItems: [3.868801, -189.57183588894] }), pe.add({ lineAngle: 17.35402464, x: 21.336, y: 3.556, offsetX: -345.47402804977, offsetY: 1.51523696536, dashLengthItems: [4.2578274, -421.523759802] }), pe.add({ lineAngle: 69.44395478, x: 7.366, y: 0, offsetX: -136.75087638396, offsetY: 2.97284513874, dashLengthItems: [2.170176, -214.84751913106] }), pe.add({ lineAngle: 101.309932474, x: 18.288, y: 0, offsetX: 104.60834648271, offsetY: 4.98134983255, dashLengthItems: [1.295146, -128.21994964526] }), pe.add({ lineAngle: 165.963756532, x: 18.034, y: 1.27, offsetX: -80.085263387, offsetY: 6.16040487582, dashLengthItems: [5.236337, -99.49054589069] }), pe.add({ lineAngle: 186.00900596, x: 12.954, y: 2.54, offsetX: -255.26337856879, offsetY: 1.32949676118, dashLengthItems: [4.85267, -480.41364863337] }), pe.add({ lineAngle: 303.69006753, x: 15.748, y: 15.748, offsetX: -56.35753993648, offsetY: 7.0446924921, dashLengthItems: [3.6632388, -87.9177635968] }), pe.add({ lineAngle: 353.15722659, x: 17.78, y: 12.7, offsetX: 434.77679606606, offsetY: 1.0087628707, dashLengthItems: [6.3955676, -633.16009065031] }), pe.add({ lineAngle: 60.9453959, x: 24.13, y: 11.938, offsetX: -204.76648550216, offsetY: 2.46706609031, dashLengthItems: [2.6150824, -258.8939231811] }), pe.add({ lineAngle: 90, x: 25.4, y: 14.224, offsetX: 25.4, offsetY: 25.4, dashLengthItems: [1.524, -23.876] }), pe.add({ lineAngle: 120.25643716, x: 12.446, y: 3.302, offsetX: -204.77318477297, offsetY: 1.8283320086, dashLengthItems: [3.5286696, -349.339407732] }), pe.add({ lineAngle: 48.0127875, x: 10.668, y: 6.35, offsetX: 305.85067529778, offsetY: 1.88796713138, dashLengthItems: [6.8344288, -334.88762199565] }), pe.add({ lineAngle: 0, x: 15.24, y: 11.43, offsetX: 25.4, offsetY: 25.4, dashLengthItems: [6.604, -18.796] }), pe.add({ lineAngle: 325.3048465, x: 21.844, y: 11.43, offsetX: 310.04235091354, offsetY: -1.6064370526, dashLengthItems: [4.0160956, -397.5931672414] }), pe.add({ lineAngle: 254.0546041, x: 25.146, y: 9.144, offsetX: 104.6687497289, offsetY: 3.48895832444, dashLengthItems: [3.6982908, -181.21650038772] }), pe.add({ lineAngle: 207.64597536, x: 24.13, y: 5.588, offsetX: 545.36007557253, offsetY: 1.07143433066, dashLengthItems: [6.021451, -596.12464422938] }), pe.add({ lineAngle: 175.42607874, x: 18.796, y: 2.794, offsetX: 331.1739336186, offsetY: 1.01276432357, dashLengthItems: [6.3702946, -630.6584645624] }), T.set("HEX", pe);
var Ae = new C("HONEY");
Ae.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 5.4992613154, dashLengthItems: [3.175, -6.35] }), Ae.add({ lineAngle: 120, x: 0, y: 0, offsetX: 0, offsetY: 5.4992613154, dashLengthItems: [3.175, -6.35] }), Ae.add({ lineAngle: 60, x: 3.175, y: 0, offsetX: 0, offsetY: 5.4992613154, dashLengthItems: [3.175, -6.35] }), T.set("HONEY", Ae);
var ye = new C("HOUND");
ye.add({ lineAngle: 0, x: 0, y: 0, offsetX: 4.7625, offsetY: 2.749630645, dashLengthItems: [3.175, -6.35] }), ye.add({ lineAngle: 120, x: 0, y: 0, offsetX: 4.7625, offsetY: 2.749630645, dashLengthItems: [3.175, -6.35] }), ye.add({ lineAngle: 60, x: 0, y: 0, offsetX: 4.7625, offsetY: 2.749630645, dashLengthItems: [-6.35, 3.175] }), T.set("HOUND", ye);
var me = new C("INSUL");
me.add({ lineAngle: 0, x: 0, y: 0, offsetX: 6.35, offsetY: 1.5875, dashLengthItems: [25.4, -12.7] }), me.add({ lineAngle: 90, x: 0, y: 0, offsetX: -6.35, offsetY: 1.5875, dashLengthItems: [25.4, -12.7] }), T.set("INSUL", me);
var xe = new C("ACAD_ISO02W100");
xe.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 9.525, dashLengthItems: [] }), xe.add({ lineAngle: 0, x: 0, y: 3.175, offsetX: 0, offsetY: 9.525, dashLengthItems: [3.175, -3.175] }), xe.add({ lineAngle: 0, x: 0, y: 6.35, offsetX: 0, offsetY: 9.525, dashLengthItems: [3.175, -3.175] }), T.set("ACAD_ISO02W100", xe);
var Ie = new C("ACAD_ISO03W100");
Ie.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 5, dashLengthItems: [12, -3] }), T.set("ACAD_ISO03W100", Ie);
var Le = new C("ACAD_ISO04W100");
Le.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 5, dashLengthItems: [12, -18] }), T.set("ACAD_ISO04W100", Le);
var Se = new C("ACAD_ISO05W100");
Se.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 5, dashLengthItems: [24, -3, 0.5, -3] }), T.set("ACAD_ISO05W100", Se);
var De = new C("ACAD_ISO06W100");
De.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 5, dashLengthItems: [24, -3, 0.5, -3, 0.5, -3] }), T.set("ACAD_ISO06W100", De);
var be = new C("ACAD_ISO07W100");
be.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 5, dashLengthItems: [24, -3, 0.5, -3, 0.5, -6.5] }), be.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 5, dashLengthItems: [-34, 0.5, -3] }), T.set("ACAD_ISO07W100", be);
var ve = new C("ACAD_ISO08W100");
ve.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 5, dashLengthItems: [0.5, -3] }), T.set("ACAD_ISO08W100", ve);
var Ee = new C("ACAD_ISO09W100");
Ee.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 5, dashLengthItems: [24, -3, 6, -3] }), T.set("ACAD_ISO09W100", Ee);
var Fe = new C("ACAD_ISO10W100");
Fe.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 5, dashLengthItems: [24, -3, 6, -3, 6, -3] }), T.set("ACAD_ISO10W100", Fe);
var Ce = new C("ACAD_ISO11W100");
Ce.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 5, dashLengthItems: [12, -3, 0.5, -3] }), T.set("ACAD_ISO11W100", Ce);
var Te = new C("ACAD_ISO12W100");
Te.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 5, dashLengthItems: [12, -3, 12, -3, 0.5, -3] }), T.set("ACAD_ISO12W100", Te);
var Xe = new C("ACAD_ISO13W100");
Xe.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 5, dashLengthItems: [12, -3, 0.5, -3, 0.5, -3] }), T.set("ACAD_ISO13W100", Xe);
var Re = new C("ACAD_ISO14W100");
Re.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 5, dashLengthItems: [12, -3, 12, -3, 0.5, -6.5] }), Re.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 5, dashLengthItems: [-33.5, 0.5, -3] }), T.set("ACAD_ISO14W100", Re);
var Ye = new C("ACAD_ISO15W100");
Ye.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 5, dashLengthItems: [12, -3, 0.5, -3, 0.5, -6.5] }), Ye.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 5, dashLengthItems: [-22, 0.5, -3] }), T.set("ACAD_ISO15W100", Ye);
var Be = new C("JIS_LC_20");
Be.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 5, dashLengthItems: [12, -3, 12, -3, 0.5, -10] }), Be.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 5, dashLengthItems: [-33.5, 0.5, -3, 0.5, -3] }), T.set("JIS_LC_20", Be);
var we = new C("JIS_LC_20A");
we.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 20, dashLengthItems: [] }), we.add({ lineAngle: 45, x: 0.4, y: 0, offsetX: 0, offsetY: 20, dashLengthItems: [] }), T.set("JIS_LC_20A", we);
var Ne = new C("JIS_LC_8");
Ne.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 20, dashLengthItems: [] }), Ne.add({ lineAngle: 45, x: 1, y: 0, offsetX: 0, offsetY: 20, dashLengthItems: [] }), T.set("JIS_LC_8", Ne);
var Me = new C("JIS_LC_8A");
Me.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 7.8, dashLengthItems: [] }), Me.add({ lineAngle: 45, x: 0.4, y: 0, offsetX: 0, offsetY: 7.8, dashLengthItems: [] }), T.set("JIS_LC_8A", Me);
var Pe = new C("JIS_RC_10");
Pe.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 7.8, dashLengthItems: [] }), Pe.add({ lineAngle: 45, x: 1, y: 0, offsetX: 0, offsetY: 7.8, dashLengthItems: [] }), T.set("JIS_RC_10", Pe);
var Oe = new C("JIS_RC_15");
Oe.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 10, dashLengthItems: [] }), Oe.add({ lineAngle: 45, x: 0.725, y: 0, offsetX: 0, offsetY: 10, dashLengthItems: [] }), Oe.add({ lineAngle: 45, x: 1.45, y: 0, offsetX: 0, offsetY: 10, dashLengthItems: [] }), T.set("JIS_RC_15", Oe);
var _e = new C("JIS_RC_18");
_e.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 15, dashLengthItems: [] }), _e.add({ lineAngle: 45, x: 0.725, y: 0, offsetX: 0, offsetY: 15, dashLengthItems: [] }), _e.add({ lineAngle: 45, x: 1.45, y: 0, offsetX: 0, offsetY: 15, dashLengthItems: [] }), T.set("JIS_RC_18", _e);
var He = new C("JIS_RC_30");
He.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 18, dashLengthItems: [] }), He.add({ lineAngle: 45, x: 1, y: 0, offsetX: 0, offsetY: 18, dashLengthItems: [] }), He.add({ lineAngle: 45, x: 2, y: 0, offsetX: 0, offsetY: 18, dashLengthItems: [] }), T.set("JIS_RC_30", He);
var ke = new C("JIS_STN_1E");
ke.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 30, dashLengthItems: [] }), ke.add({ lineAngle: 45, x: 1, y: 0, offsetX: 0, offsetY: 30, dashLengthItems: [] }), ke.add({ lineAngle: 45, x: 2, y: 0, offsetX: 0, offsetY: 30, dashLengthItems: [] }), T.set("JIS_STN_1E", ke);
var We = new C("JIS_STN_2_5");
We.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 1, dashLengthItems: [] }), We.add({ lineAngle: 45, x: 0.705, y: 0, offsetX: 0, offsetY: 1, dashLengthItems: [1, -0.5] }), T.set("JIS_STN_2_5", We);
var Ve = new C("JIS_WOOD");
Ve.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 2.5, dashLengthItems: [] }), Ve.add({ lineAngle: 45, x: 1.765, y: 0, offsetX: 0, offsetY: 2.5, dashLengthItems: [1.2, -0.5] }), T.set("JIS_WOOD", Ve);
var Ue = new C("LINE");
Ue.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 0.70710678, dashLengthItems: [] }), T.set("LINE", Ue);
var je = new C("MUDST");
je.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 3.175, dashLengthItems: [] }), T.set("MUDST", je);
var Ge = new C("NET");
Ge.add({ lineAngle: 0, x: 0, y: 0, offsetX: 12.7, offsetY: 6.35, dashLengthItems: [6.35, -6.35, 0, -6.35, 0, -6.35] }), T.set("NET", Ge);
var ze = new C("NET3");
ze.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 3.175, dashLengthItems: [] }), ze.add({ lineAngle: 90, x: 0, y: 0, offsetX: 0, offsetY: 3.175, dashLengthItems: [] }), T.set("NET3", ze);
var Je = new C("PLAST");
Je.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 3.175, dashLengthItems: [] }), Je.add({ lineAngle: 60, x: 0, y: 0, offsetX: 0, offsetY: 3.175, dashLengthItems: [] }), Je.add({ lineAngle: 120, x: 0, y: 0, offsetX: 0, offsetY: 3.175, dashLengthItems: [] }), T.set("PLAST", Je);
var Ke = new C("PLASTI");
Ke.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 6.35, dashLengthItems: [] }), Ke.add({ lineAngle: 0, x: 0, y: 0.79375, offsetX: 0, offsetY: 6.35, dashLengthItems: [] }), Ke.add({ lineAngle: 0, x: 0, y: 1.5875, offsetX: 0, offsetY: 6.35, dashLengthItems: [] }), T.set("PLASTI", Ke);
var Ze = new C("SACNCR");
Ze.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 6.35, dashLengthItems: [] }), Ze.add({ lineAngle: 0, x: 0, y: 0.79375, offsetX: 0, offsetY: 6.35, dashLengthItems: [] }), Ze.add({ lineAngle: 0, x: 0, y: 1.5875, offsetX: 0, offsetY: 6.35, dashLengthItems: [] }), Ze.add({ lineAngle: 0, x: 0, y: 3.96875, offsetX: 0, offsetY: 6.35, dashLengthItems: [] }), T.set("SACNCR", Ze);
var qe = new C("SQUARE");
qe.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 2.38125, dashLengthItems: [] }), qe.add({ lineAngle: 45, x: 1.6838, y: 0, offsetX: 0, offsetY: 2.38125, dashLengthItems: [0, -2.38125] }), T.set("SQUARE", qe);
var $e = new C("STARS");
$e.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 3.175, dashLengthItems: [3.175, -3.175] }), $e.add({ lineAngle: 90, x: 0, y: 0, offsetX: 0, offsetY: 3.175, dashLengthItems: [3.175, -3.175] }), T.set("STARS", $e);
var Qe = new C("STEEL");
Qe.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 5.4992613154, dashLengthItems: [3.175, -3.175] }), Qe.add({ lineAngle: 60, x: 0, y: 0, offsetX: 0, offsetY: 5.4992613154, dashLengthItems: [3.175, -3.175] }), Qe.add({ lineAngle: 120, x: 1.5875, y: 2.7496306704, offsetX: 0, offsetY: 5.4992613154, dashLengthItems: [3.175, -3.175] }), T.set("STEEL", Qe);
var et = new C("SWAMP");
et.add({ lineAngle: 45, x: 0, y: 0, offsetX: 0, offsetY: 3.175, dashLengthItems: [] }), et.add({ lineAngle: 45, x: 0, y: 1.5875, offsetX: 0, offsetY: 3.175, dashLengthItems: [] }), T.set("SWAMP", et);
var tt = new C("TRANS");
tt.add({ lineAngle: 0, x: 0, y: 0, offsetX: 12.7, offsetY: 21.9970452362, dashLengthItems: [3.175, -22.225] }), tt.add({ lineAngle: 90, x: 1.5875, y: 0, offsetX: 21.9970452362, offsetY: 12.7, dashLengthItems: [1.5875, -42.4065904724] }), tt.add({ lineAngle: 90, x: 1.984375, y: 0, offsetX: 21.9970452362, offsetY: 12.7, dashLengthItems: [1.27, -42.7240904724] }), tt.add({ lineAngle: 90, x: 1.190625, y: 0, offsetX: 21.9970452362, offsetY: 12.7, dashLengthItems: [1.27, -42.7240904724] }), tt.add({ lineAngle: 60, x: 2.38125, y: 0, offsetX: 12.7, offsetY: 21.9970452362, dashLengthItems: [1.016, -24.384] }), tt.add({ lineAngle: 120, x: 0.79375, y: 0, offsetX: 12.7, offsetY: 21.9970452362, dashLengthItems: [1.016, -24.384] }), T.set("TRANS", tt);
var st = new C("TRIANG");
st.add({ lineAngle: 0, x: 0, y: 0, offsetX: 0, offsetY: 6.35, dashLengthItems: [] }), st.add({ lineAngle: 0, x: 0, y: 3.175, offsetX: 0, offsetY: 6.35, dashLengthItems: [3.175, -3.175] }), T.set("TRIANG", st);
var nt = new C("ZIGZAG");
nt.add({ lineAngle: 60, x: 0, y: 0, offsetX: 4.7625, offsetY: 8.2488919604, dashLengthItems: [4.7625, -4.7625] }), nt.add({ lineAngle: 120, x: 0, y: 0, offsetX: 4.7625, offsetY: 8.2488919604, dashLengthItems: [4.7625, -4.7625] }), nt.add({ lineAngle: 0, x: -2.38125, y: 4.1244459802, offsetX: 4.7625, offsetY: 8.2488919604, dashLengthItems: [4.7625, -4.7625] }), T.set("ZIGZAG", nt);
var it = class _it {
  static fromHex(e2) {
    return e2.startsWith("#") && (e2 = e2.replace("#", "")), parseInt(e2, 16);
  }
  static fromRGB(e2, t2, s2) {
    const n = [e2, t2, s2].reduce(((e3, t3) => {
      const s3 = t3.toString(16);
      return `${e3}${1 === s3.length ? "0" + s3 : s3}`;
    }), "0x00");
    return _it.fromHex(n);
  }
};
var ht = class {
  constructor(e2, t2, s2) {
    this.type = e2, this.subclassMarker = t2, this.layerName = null == s2 ? void 0 : s2.layerName, this.handle = h.next(), this.trueColor = null == s2 ? void 0 : s2.trueColor, this.inPaperSpace = false, this.colorNumber = null == s2 ? void 0 : s2.colorNumber, this.visible = null == s2 ? void 0 : s2.visible, this.lineType = null == s2 ? void 0 : s2.lineType, this.lineTypeScale = null == s2 ? void 0 : s2.lineTypeScale, this.extrusion = null == s2 ? void 0 : s2.extrusion, this.xdatas = [];
  }
  boundingBox() {
    return a.pointBBox(t());
  }
  addXData(e2) {
    const t2 = new F(e2);
    return this.xdatas.push(t2), t2;
  }
  dxfy(e2) {
    var t2, s2, n;
    e2.type(this.type), e2.handle(this.handle), e2.push(330, this.ownerBlockRecord), e2.subclassMarker("AcDbEntity"), this.inPaperSpace && e2.push(67, Number(this.inPaperSpace)), e2.push(420, this.trueColor), e2.layerName(this.layerName || c.layerZeroName), e2.lineType(this.lineType), e2.colorNumber(this.colorNumber), e2.push(48, this.lineTypeScale), e2.visibilty(this.visible), e2.subclassMarker(this.subclassMarker), "HATCH" !== this.type && (e2.push(210, null === (t2 = this.extrusion) || void 0 === t2 ? void 0 : t2.x), e2.push(220, null === (s2 = this.extrusion) || void 0 === s2 ? void 0 : s2.y), e2.push(230, null === (n = this.extrusion) || void 0 === n ? void 0 : n.z)), this.dxfyChild(e2), this.xdatas.forEach(((t3) => t3.dxfy(e2)));
  }
};
var ot;
var dt;
var at;
!(function(e2) {
  e2[e2.Default = 0] = "Default", e2[e2.Aligned = 1] = "Aligned", e2[e2.Angular = 2] = "Angular", e2[e2.Diameter = 3] = "Diameter", e2[e2.Radius = 4] = "Radius", e2[e2.Angular3Point = 5] = "Angular3Point", e2[e2.Ordinate = 6] = "Ordinate", e2[e2.ReferencedByThis = 32] = "ReferencedByThis", e2[e2.OrdinateType = 64] = "OrdinateType";
})(ot || (ot = {})), (function(e2) {
  e2[e2.TopLeft = 1] = "TopLeft", e2[e2.TopCenter = 2] = "TopCenter", e2[e2.TopRight = 3] = "TopRight", e2[e2.MiddleLeft = 4] = "MiddleLeft", e2[e2.MiddleCenter = 5] = "MiddleCenter", e2[e2.MiddleRight = 6] = "MiddleRight", e2[e2.BottomLeft = 7] = "BottomLeft", e2[e2.BottomCenter = 8] = "BottomCenter", e2[e2.BottomRight = 9] = "BottomRight";
})(dt || (dt = {})), (function(e2) {
  e2[e2.AtLeast = 1] = "AtLeast", e2[e2.Exact = 2] = "Exact";
})(at || (at = {}));
var lt = class extends ht {
  constructor(e2) {
    super("DIMENSION", "AcDbDimension", e2), this.blockName = null == e2 ? void 0 : e2.blockName, this.definitionPoint = null == e2 ? void 0 : e2.definitionPoint, this.middlePoint = null == e2 ? void 0 : e2.middlePoint, this.dimensionType = ot.Default, this.attachmentPoint = (null == e2 ? void 0 : e2.attachmentPoint) || dt.MiddleCenter, this.textLineSpacingStyle = null == e2 ? void 0 : e2.textLineSpacingStyle, this.textLineSpacingFactor = null == e2 ? void 0 : e2.textLineSpacingFactor, this.ActualMeasurement = null == e2 ? void 0 : e2.ActualMeasurement, this.text = null == e2 ? void 0 : e2.text, this.rotation = null == e2 ? void 0 : e2.rotation, this.horizontalDirection = null == e2 ? void 0 : e2.horizontalDirection, this.styleName = null == e2 ? void 0 : e2.styleName;
  }
  dxfyChild(e2) {
    e2.push(2, this.blockName), e2.point3d(this.definitionPoint), e2.point3d(this.middlePoint, 1), e2.push(70, this.dimensionType), e2.push(71, this.attachmentPoint), e2.push(72, this.textLineSpacingStyle), e2.push(41, this.textLineSpacingFactor), e2.push(42, this.ActualMeasurement), e2.push(1, this.text), e2.push(53, "auto" === this.rotation ? this.rotate() : this.rotation), e2.push(51, this.horizontalDirection), e2.push(3, this.styleName);
  }
};
var rt = /[<>/\\":;?*|=`]/g;
function ft(e2) {
  return e2 * Math.PI / 180;
}
function ut(e2, t2) {
  const s2 = (function(e3, t3) {
    return Math.sqrt(Math.pow(e3.x - t3.x, 2) + Math.pow(e3.y - t3.y, 2));
  })(e2, t2);
  return 0 === s2 ? s2 : 180 * Math.asin(Math.abs(e2.y - t2.y) / s2) / Math.PI;
}
var ct = class extends lt {
  constructor(e2, t2, s2) {
    super(s2), this.dimensionType = ot.Aligned, this.insertionPoint = null == s2 ? void 0 : s2.insertionPoint, this.fisrtPoint = e2, this.secondPoint = t2, this.offset(null == s2 ? void 0 : s2.offset);
  }
  offset(e2) {
    if (null == e2) return;
    const [s2, n] = (function(e3, t2) {
      const s3 = e3.x - t2.x;
      let n2 = 0;
      return 0 !== s3 && (n2 = (e3.y - t2.y) / s3), [n2, e3.y - n2 * e3.x];
    })(this.fisrtPoint, this.secondPoint), i = (function(e3, t2) {
      const [s3, n2] = t2;
      return n2 - e3 * Math.sqrt(s3 * s3 + 1);
    })(e2, [s2, n]);
    this.definitionPoint = (function(e3, s3) {
      const [n2, i2] = e3, h2 = null != n2 ? n2 : -1 / n2, o2 = s3.y - h2 * s3.x, d2 = h2 - n2;
      let a2 = i2 - o2;
      return 0 !== d2 && (a2 = (i2 - o2) / d2), t(a2, n2 * a2 + i2, s3.z);
    })([s2, i], this.fisrtPoint);
  }
  rotate() {
    return ut(this.fisrtPoint, this.secondPoint);
  }
  dxfyChild(e2) {
    super.dxfyChild(e2), e2.subclassMarker("AcDbAlignedDimension"), e2.point3d(this.insertionPoint, 2), e2.point3d(this.fisrtPoint, 3), e2.point3d(this.secondPoint, 4);
  }
};
var gt = class extends lt {
  constructor(e2, t2, s2, n) {
    super(n), this.first = e2, this.second = t2, this.location = s2, this.dimensionType = ot.Angular;
  }
  rotate() {
    return 0;
  }
  _update() {
    this.definitionPoint = this.second.end;
  }
  dxfyChild(e2) {
    this._update(), super.dxfyChild(e2), e2.subclassMarker("AcDb2LineAngularDimension"), e2.point3d(this.first.start, 3), e2.point3d(this.first.end, 4), e2.point3d(this.second.start, 5), e2.point3d(this.location, 6);
  }
};
var pt = class extends lt {
  constructor(e2, t2, s2, n) {
    super(n), this.center = e2, this.first = t2, this.second = s2, this.dimensionType = ot.Angular3Point;
  }
  rotate() {
    return 0;
  }
  dxfyChild(e2) {
    super.dxfyChild(e2), e2.subclassMarker("AcDb3PointAngularDimension"), e2.point3d(this.first, 3), e2.point3d(this.second, 4), e2.point3d(this.center, 5);
  }
};
var yt = class extends lt {
  constructor(e2, t2, s2) {
    super(s2), this.dimensionType = ot.Diameter, this.first = e2, this.definitionPoint = t2, this.leaderLength = null == s2 ? void 0 : s2.leaderLength;
  }
  rotate() {
    return 0;
  }
  dxfyChild(e2) {
    super.dxfyChild(e2), e2.subclassMarker("AcDbDiametricDimension"), e2.point3d(this.first, 5), e2.push(40, this.leaderLength);
  }
};
var mt = class extends lt {
  constructor(e2, t2, s2) {
    var n;
    super(s2), this.dimensionType = ot.Default, this.insertionPoint = null == s2 ? void 0 : s2.insertionPoint, this.fisrtPoint = e2, this.secondPoint = t2, this.angle = null !== (n = null == s2 ? void 0 : s2.angle) && void 0 !== n ? n : 0, this.linearType = null == s2 ? void 0 : s2.linearType, this.offset(null == s2 ? void 0 : s2.offset);
  }
  offset(e2) {
    if (null == e2) return;
    const s2 = ft(this.angle), n = this.fisrtPoint.x + e2 * Math.floor(Math.sin(s2)), i = this.fisrtPoint.y + e2 * Math.floor(Math.cos(s2));
    this.definitionPoint = t(n, i, 0);
  }
  rotate() {
    return this.angle;
  }
  dxfyChild(e2) {
    super.dxfyChild(e2), e2.subclassMarker("AcDbAlignedDimension"), e2.point3d(this.insertionPoint, 2), e2.point3d(this.fisrtPoint, 3), e2.point3d(this.secondPoint, 4), e2.push(50, this.angle), e2.push(52, this.linearType), e2.subclassMarker("AcDbRotatedDimension");
  }
};
var xt = class extends lt {
  constructor(e2, t2, s2) {
    super(s2), this.dimensionType = ot.Radius, this.first = e2, this.definitionPoint = t2, this.leaderLength = null == s2 ? void 0 : s2.leaderLength;
  }
  rotate() {
    return 0;
  }
  dxfyChild(e2) {
    super.dxfyChild(e2), e2.subclassMarker("AcDbRadialDimension"), e2.point3d(this.first, 5), e2.push(40, this.leaderLength);
  }
};
var It = class extends ht {
  get start() {
    return t(this.center.x + this.radius * Math.cos(ft(this.startAngle)), this.center.y + this.radius * Math.sin(ft(this.startAngle)));
  }
  get end() {
    return t(this.center.x + this.radius * Math.cos(ft(this.endAngle)), this.center.y + this.radius * Math.sin(ft(this.endAngle)));
  }
  constructor(e2, t2, s2, n, i) {
    super("ARC", "AcDbCircle", i), this.center = e2, this.radius = t2, this.startAngle = s2, this.endAngle = n;
  }
  boundingBox() {
    return a.centerRadiusBBox(this.center, this.radius);
  }
  dxfyChild(e2) {
    e2.point3d(this.center), e2.push(40, this.radius), e2.subclassMarker("AcDbArc"), e2.push(50, this.startAngle), e2.push(51, this.endAngle);
  }
};
var Lt = class extends ht {
  constructor(e2, t2, s2, n, i) {
    super("ATTDEF", "AcDbText", i), this.position = e2, this.height = t2, this.value = n, this.tag = s2, this.textStyle = "STANDARD", this.rotation = null == i ? void 0 : i.rotation, this.obliqueAngle = null == i ? void 0 : i.obliqueAngle, this.generationFlags = null == i ? void 0 : i.generationFlags, this.horizontalAlignment = null == i ? void 0 : i.horizontalAlignment, this.verticalAlignment = null == i ? void 0 : i.verticalAlignment, this.secondAlignmentPoint = null == i ? void 0 : i.secondAlignmentPoint, this.relativeXScaleFactor = null == i ? void 0 : i.relativeXScaleFactor;
  }
  boundingBox() {
    return a.pointBBox(this.position);
  }
  dxfyChild(e2) {
    e2.point3d(this.position), e2.push(40, this.height), e2.primaryText(this.value), e2.push(50, this.rotation), e2.push(41, this.relativeXScaleFactor), e2.push(51, this.obliqueAngle), e2.textStyle(this.textStyle), e2.push(71, this.generationFlags), e2.push(72, this.horizontalAlignment), this.secondAlignmentPoint && (e2.push(11, this.secondAlignmentPoint.x), e2.push(21, this.secondAlignmentPoint.y), e2.push(31, this.secondAlignmentPoint.z)), e2.push(73, this.verticalAlignment), e2.subclassMarker("AcDbAttributeDefinition"), e2.push(280, 0), e2.push(3, ""), e2.push(2, this.tag), e2.push(70, 0);
  }
};
var St = class extends ht {
  constructor(e2, t2, s2, n, i) {
    super("ATTRIB", "AcDbText", i), this.position = e2, this.height = t2, this.value = n, this.tag = s2, this.textStyle = "STANDARD", this.rotation = null == i ? void 0 : i.rotation, this.obliqueAngle = null == i ? void 0 : i.obliqueAngle, this.generationFlags = null == i ? void 0 : i.generationFlags, this.horizontalAlignment = null == i ? void 0 : i.horizontalAlignment, this.verticalAlignment = null == i ? void 0 : i.verticalAlignment, this.secondAlignmentPoint = null == i ? void 0 : i.secondAlignmentPoint, this.relativeXScaleFactor = null == i ? void 0 : i.relativeXScaleFactor;
  }
  boundingBox() {
    return a.pointBBox(this.position);
  }
  dxfyChild(e2) {
    e2.point3d(this.position), e2.push(40, this.height), e2.primaryText(this.value), e2.push(50, this.rotation), e2.push(41, this.relativeXScaleFactor), e2.push(51, this.obliqueAngle), e2.textStyle(this.textStyle), e2.push(71, this.generationFlags), e2.push(72, this.horizontalAlignment), e2.point3d(this.secondAlignmentPoint, 1), e2.push(73, this.verticalAlignment), e2.subclassMarker("AcDbAttribute"), e2.push(280, 0), e2.push(2, this.tag), e2.push(70, 0);
  }
};
var Dt = class extends ht {
  constructor(e2, t2, s2) {
    super("CIRCLE", "AcDbCircle", s2), this.center = e2, this.radius = t2;
  }
  boundingBox() {
    return a.centerRadiusBBox(this.center, this.radius);
  }
  dxfyChild(e2) {
    e2.point3d(this.center), e2.push(40, this.radius);
  }
};
var bt = class extends ht {
  constructor(e2, t2, s2, n, i, h2) {
    super("ELLIPSE", "AcDbEllipse", h2), this.center = e2, this.endPointOfMajorAxis = t2, this.ratioOfMinorAxisToMajorAxis = s2, this.startParameter = n, this.endParameter = i;
  }
  boundingBox() {
    const e2 = this.center.x, t2 = this.center.y, s2 = this.endPointOfMajorAxis.x, n = this.endPointOfMajorAxis.y, i = Math.sqrt(Math.pow(e2 - (e2 + s2), 2) + Math.pow(t2 - (t2 + n), 2));
    return a.centerRadiusBBox(this.center, i);
  }
  dxfyChild(e2) {
    e2.point3d(this.center), e2.point3d(this.endPointOfMajorAxis, 1), e2.push(40, this.ratioOfMinorAxisToMajorAxis), e2.push(41, this.startParameter), e2.push(42, this.endParameter);
  }
};
var vt;
var Et;
var Ft;
var Ct;
var Tt;
var Xt;
var Rt;
var Yt;
var Bt;
var wt;
var Nt;
var Mt;
var Pt;
var Ot;
var _t;
var Ht;
var kt;
var Wt;
var Vt;
var Ut;
var jt;
var Gt;
var zt;
var Jt;
var Kt;
var Zt;
var qt;
var $t;
var Qt;
var es;
var ts;
var ss;
var ns;
var is;
!(function(e2) {
  e2[e2.None = 0] = "None", e2[e2.First = 1] = "First", e2[e2.Second = 2] = "Second", e2[e2.Third = 4] = "Third", e2[e2.Fourth = 8] = "Fourth";
})(vt || (vt = {}));
var hs = class extends ht {
  constructor(e2, t2, s2, n, i) {
    super("3DFACE", "AcDbFace", i), this.firstCorner = e2, this.secondCorner = t2, this.thirdCorner = s2, this.fourthCorner = n, this.invisibleEdges = (null == i ? void 0 : i.invisibleEdges) || vt.None;
  }
  setFirstEdgeVisible(e2) {
    this.setEdgeVisible(vt.First, e2);
  }
  setSecondEdgeVisible(e2) {
    this.setEdgeVisible(vt.Second, e2);
  }
  setThirdEdgeVisible(e2) {
    this.setEdgeVisible(vt.Third, e2);
  }
  setFourthEdgeVisible(e2) {
    this.setEdgeVisible(vt.Fourth, e2);
  }
  setEdgesVisible(e2) {
    this.invisibleEdges = e2 ? vt.None : vt.First | vt.Second | vt.Third | vt.Fourth;
  }
  setEdgeVisible(e2, t2) {
    t2 ? this.invisibleEdges |= e2 : this.invisibleEdges === (this.invisibleEdges | e2) && (this.invisibleEdges ^= e2);
  }
  boundingBox() {
    return a.verticesBBox([this.firstCorner, this.secondCorner, this.thirdCorner, this.fourthCorner]);
  }
  dxfyChild(e2) {
    e2.point3d(this.firstCorner), e2.point3d(this.secondCorner, 1), e2.point3d(this.thirdCorner, 2), e2.point3d(this.fourthCorner, 3), e2.push(70, this.invisibleEdges);
  }
};
!(function(e2) {
  e2.SOLID = "SOLID", e2.ANGLE = "ANGLE", e2.ANSI31 = "ANSI31", e2.ANSI32 = "ANSI32", e2.ANSI33 = "ANSI33", e2.ANSI34 = "ANSI34", e2.ANSI35 = "ANSI35", e2.ANSI36 = "ANSI36", e2.ANSI37 = "ANSI37", e2.ANSI38 = "ANSI38", e2.AR_B816 = "AR_B816", e2.AR_B816C = "AR_B816C", e2.AR_B88 = "AR_B88", e2.AR_BRELM = "AR_BRELM", e2.AR_BRSTD = "AR_BRSTD", e2.AR_CONC = "AR_CONC", e2.AR_HBONE = "AR_HBONE", e2.AR_PARQ1 = "AR_PARQ1", e2.AR_RROOF = "AR_RROOF", e2.AR_RSHKE = "AR_RSHKE", e2.AR_SAND = "AR_SAND", e2.BOX = "BOX", e2.BRASS = "BRASS", e2.BRICK = "BRICK", e2.BRSTONE = "BRSTONE", e2.CLAY = "CLAY", e2.CORK = "CORK", e2.CROSS = "CROSS", e2.DASH = "DASH", e2.DOLMIT = "DOLMIT", e2.DOTS = "DOTS", e2.EARTH = "EARTH", e2.ESCHER = "ESCHER", e2.FLEX = "FLEX", e2.GOST_GLASS = "GOST_GLASS", e2.GOST_WOOD = "GOST_WOOD", e2.GOST_GROUND = "GOST_GROUND", e2.GRASS = "GRASS", e2.GRATE = "GRATE", e2.GRAVEL = "GRAVEL", e2.HEX = "HEX", e2.HONEY = "HONEY", e2.HOUND = "HOUND", e2.INSUL = "INSUL", e2.ACAD_ISO02W100 = "ACAD_ISO02W100", e2.ACAD_ISO03W100 = "ACAD_ISO03W100", e2.ACAD_ISO04W100 = "ACAD_ISO04W100", e2.ACAD_ISO05W100 = "ACAD_ISO05W100", e2.ACAD_ISO06W100 = "ACAD_ISO06W100", e2.ACAD_ISO07W100 = "ACAD_ISO07W100", e2.ACAD_ISO08W100 = "ACAD_ISO08W100", e2.ACAD_ISO09W100 = "ACAD_ISO09W100", e2.ACAD_ISO10W100 = "ACAD_ISO10W100", e2.ACAD_ISO11W100 = "ACAD_ISO11W100", e2.ACAD_ISO12W100 = "ACAD_ISO12W100", e2.ACAD_ISO13W100 = "ACAD_ISO13W100", e2.ACAD_ISO14W100 = "ACAD_ISO14W100", e2.ACAD_ISO15W100 = "ACAD_ISO15W100", e2.JIS_LC_20 = "JIS_LC_20", e2.JIS_LC_20A = "JIS_LC_20A", e2.JIS_LC_8 = "JIS_LC_8", e2.JIS_LC_8A = "JIS_LC_8A", e2.JIS_RC_10 = "JIS_RC_10", e2.JIS_RC_15 = "JIS_RC_15", e2.JIS_RC_18 = "JIS_RC_18", e2.JIS_RC_30 = "JIS_RC_30", e2.JIS_STN_1E = "JIS_STN_1E", e2.JIS_STN_2_5 = "JIS_STN_2_5", e2.JIS_WOOD = "JIS_WOOD", e2.LINE = "LINE", e2.MUDST = "MUDST", e2.NET = "NET", e2.NET3 = "NET3", e2.PLAST = "PLAST", e2.PLASTI = "PLASTI", e2.SACNCR = "SACNCR", e2.SQUARE = "SQUARE", e2.STARS = "STARS", e2.STEEL = "STEEL", e2.SWAMP = "SWAMP", e2.TRANS = "TRANS", e2.TRIANG = "TRIANG", e2.ZIGZAG = "ZIGZAG";
})(Et || (Et = {})), (function(e2) {
  e2[e2.UserDefined = 0] = "UserDefined", e2[e2.Predifined = 1] = "Predifined", e2[e2.Custom = 2] = "Custom";
})(Ft || (Ft = {}));
var ds = class {
  constructor(e2) {
    this.vertices = e2 || [];
  }
  add(e2) {
    this.vertices.push(e2);
  }
  dxfy(e2) {
    const t2 = !!this.vertices.find(((e3) => e3.bulge));
    e2.push(72, Number(t2)), e2.push(73, 1), e2.push(93, this.vertices.length);
    for (const s2 of this.vertices) e2.point2d(s2), t2 && e2.push(42, s2.bulge || 0);
    e2.push(97, 0);
  }
};
!(function(e2) {
  e2[e2.Default = 0] = "Default", e2[e2.External = 1] = "External", e2[e2.Polyline = 2] = "Polyline", e2[e2.Derived = 4] = "Derived", e2[e2.Textbox = 8] = "Textbox", e2[e2.Outermost = 16] = "Outermost";
})(Ct || (Ct = {}));
var as = class {
  constructor() {
    this.pathTypeFlag = Ct.External | Ct.Derived, this.polylineBoundaries = [], this.edgesTypeDatas = [];
  }
  get length() {
    let e2 = 0;
    return this.isPolyline() ? e2 += this.polylineBoundaries.length : this.isEdges() && this.edgesTypeDatas.forEach(((t2) => {
      e2 += t2.edgesData.length;
    })), e2;
  }
  addPolylineBoundary(e2) {
    (this.pathTypeFlag & Ct.Polyline) !== Ct.Polyline && (this.pathTypeFlag |= Ct.Polyline), this.polylineBoundaries.push(e2);
  }
  isPolyline() {
    return this.polylineBoundaries && (this.pathTypeFlag & Ct.Polyline) === Ct.Polyline;
  }
  isEdges() {
    return this.edgesTypeDatas && (this.pathTypeFlag & Ct.Polyline) !== Ct.Polyline;
  }
  addEdgesTypeData(e2) {
    (this.pathTypeFlag & Ct.Polyline) !== Ct.Polyline && (this.pathTypeFlag ^= Ct.Polyline), this.edgesTypeDatas.push(e2);
  }
  dxfy(e2) {
    if (this.isPolyline()) this.polylineBoundaries.forEach(((t2) => {
      e2.push(92, this.pathTypeFlag), t2.dxfy(e2);
    }));
    else {
      if (!this.isEdges()) throw new Error("The boundary path is empty!");
      this.edgesTypeDatas.forEach(((t2) => {
        e2.push(92, this.pathTypeFlag), t2.dxfy(e2);
      }));
    }
  }
};
function cs(e2) {
  return e2;
}
!(function(e2) {
  e2[e2.SolidFill = 1] = "SolidFill", e2[e2.PatternFill = 0] = "PatternFill";
})(Tt || (Tt = {})), (function(e2) {
  e2[e2.NonAssociative = 0] = "NonAssociative", e2[e2.Associative = 1] = "Associative";
})(Xt || (Xt = {})), (function(e2) {
  e2[e2.Normal = 0] = "Normal", e2[e2.Outer = 1] = "Outer", e2[e2.Ignore = 2] = "Ignore";
})(Rt || (Rt = {})), (function(e2) {
  e2.LINEAR = "LINEAR", e2.CYLINDER = "CYLINDER", e2.INVCYLINDER = "INVCYLINDER", e2.SPHERICAL = "SPHERICAL", e2.HEMISPHERICAL = "HEMISPHERICAL", e2.CURVED = "CURVED", e2.INVSPHERICAL = "SPHERICAL", e2.INVHEMISPHERICAL = "INVHEMISPHERICAL", e2.INVCURVED = "INVCURVED";
})(Yt || (Yt = {}));
var gs = class extends ht {
  get patternName() {
    let e2 = Et.SOLID;
    return this.isPattern(this.fill) && (e2 = this.fill.name), e2;
  }
  get solidFillFlag() {
    return this.patternName === Et.SOLID ? Tt.SolidFill : Tt.PatternFill;
  }
  constructor(e2, s2, n) {
    super("HATCH", "AcDbHatch", n), this.fill = s2, this.elevation = (null == n ? void 0 : n.elevation) || 0, this.extrusion = (null == n ? void 0 : n.extrusion) || t(0, 0, 1), this.boundaryPath = e2;
  }
  pattern(e2, t2) {
    var s2;
    const n = t2.name, i = null !== (s2 = t2.angle) && void 0 !== s2 ? s2 : 0, h2 = t2.scale || 1, o2 = t2.double || false;
    e2.push(52, i), e2.push(41, h2), e2.push(77, Number(o2));
    const d2 = T.get(n);
    d2 && (d2.scale = h2, 0 !== i && (d2.angle = i), d2.dxfy(e2));
  }
  gradient(e2, t2) {
    var s2, n, i;
    const h2 = t2.firstColor, o2 = null !== (s2 = t2.secondColor) && void 0 !== s2 ? s2 : 7, d2 = null !== (n = t2.angle) && void 0 !== n ? n : 0, a2 = t2.definition || 0, l2 = null !== (i = t2.tint) && void 0 !== i ? i : 1, r2 = t2.type || Yt.LINEAR;
    e2.push(450, 1), e2.push(451, 0), e2.push(460, d2), e2.push(461, a2), e2.push(452, t2.secondColor ? 0 : 1), e2.push(462, l2), e2.push(453, 2), e2.push(463, 0), e2.push(63, h2), e2.push(421, it.fromHex(p(h2))), e2.push(463, 1), e2.push(63, o2), e2.push(421, it.fromHex(p(o2))), e2.push(470, r2);
  }
  isPattern(e2) {
    return "name" in e2;
  }
  boundingBox() {
    return a.pointBBox(t(0, 0));
  }
  dxfyChild(e2) {
    var s2, n, i;
    e2.point3d(t(0, 0, this.elevation)), e2.push(210, null === (s2 = this.extrusion) || void 0 === s2 ? void 0 : s2.x), e2.push(220, null === (n = this.extrusion) || void 0 === n ? void 0 : n.y), e2.push(230, null === (i = this.extrusion) || void 0 === i ? void 0 : i.z), e2.name(this.patternName), e2.push(70, this.solidFillFlag), e2.push(71, Xt.NonAssociative), e2.push(91, this.boundaryPath.length), this.boundaryPath.dxfy(e2), e2.push(75, Rt.Outer), e2.push(76, Ft.Predifined), this.isPattern(this.fill) ? (this.solidFillFlag === Tt.PatternFill && this.pattern(e2, this.fill), e2.push(47, 1), e2.push(98, 0)) : (e2.push(47, 1), e2.push(98, 0), this.gradient(e2, this.fill));
  }
};
!(function(e2) {
  e2[e2.ShowImage = 1] = "ShowImage", e2[e2.ShowImageWhenNotAlignedWithScreen = 2] = "ShowImageWhenNotAlignedWithScreen", e2[e2.UseClippingBoundary = 4] = "UseClippingBoundary", e2[e2.TransparencyIsOn = 8] = "TransparencyIsOn";
})(wt || (wt = {})), (function(e2) {
  e2[e2.Rectangular = 1] = "Rectangular", e2[e2.Polygonal = 2] = "Polygonal";
})(Nt || (Nt = {})), (function(e2) {
  e2[e2.Off = 0] = "Off", e2[e2.On = 1] = "On";
})(Mt || (Mt = {})), (function(e2) {
  e2[e2.Outside = 0] = "Outside", e2[e2.Inside = 1] = "Inside";
})(Pt || (Pt = {}));
var ps = class extends ht {
  constructor(e2, t2) {
    super("IMAGE", "AcDbRasterImage", t2), Bt.set(this, void 0), this.width = e2.width, this.height = e2.height, this.scale = e2.scale, this.rotation = e2.rotation, this.insertionPoint = e2.insertionPoint, this.ratio = this.scale / this.width, this.imageDefHandle = e2.imageDefHandle, this.imageDisplayFlags = (null == t2 ? void 0 : t2.imageDisplayFlags) || wt.ShowImage | wt.ShowImageWhenNotAlignedWithScreen, this.clippingStateFlag = (null == t2 ? void 0 : t2.clippingStateFlag) || Mt.On, this.clipModeFlag = (null == t2 ? void 0 : t2.clipModeFlag) || Pt.Inside, this.clippingType = (null == t2 ? void 0 : t2.clippingType) || Nt.Rectangular, this.brightness = (null == t2 ? void 0 : t2.brightness) || 50, this.contrast = (null == t2 ? void 0 : t2.brightness) || 50, this.fade = (null == t2 ? void 0 : t2.fade) || 0, D(this, Bt, [], "f"), this.classVersion = (null == t2 ? void 0 : t2.classVersion) || 0, this.resetClipping();
  }
  setClipBoundaryVerticies(e2, t2) {
    if (t2 === Nt.Rectangular) {
      if (2 != e2.length) throw new Error("The number of vertices should be 2 in rectangular clipping !");
      D(this, Bt, e2, "f");
    } else {
      if (!(e2.length >= 3)) throw new Error("The number of vertices should be >= 3 in polygonal clipping !");
      D(this, Bt, e2, "f");
    }
    D(this, Bt, [], "f"), S(this, Bt, "f").push(...e2);
  }
  resetClipping() {
    const e2 = [s(-0.5, -0.5), s(this.width - 0.5, this.height - 0.5)];
    this.setClipBoundaryVerticies(e2, Nt.Rectangular);
  }
  _vector() {
    return s(this.ratio * Math.cos(this.rotation * Math.PI / 180), this.ratio * Math.sin(this.rotation * Math.PI / 180));
  }
  _uVector() {
    const e2 = this._vector();
    return t(e2.x, -e2.y, 0);
  }
  _vVector() {
    const e2 = this._vector();
    return t(e2.y, e2.x, 0);
  }
  boundingBox() {
    const e2 = this.scale, t2 = this.width / this.height * this.scale, s2 = Math.sqrt(Math.pow(e2, 2) + Math.pow(t2, 2));
    return a.centerRadiusBBox(this.insertionPoint, s2);
  }
  dxfyChild(e2) {
    e2.push(90, this.classVersion), e2.point3d(this.insertionPoint), e2.point3d(this._uVector(), 1), e2.point3d(this._vVector(), 2), e2.push(13, this.width), e2.push(23, this.height), e2.push(340, this.imageDefHandle), e2.push(70, this.imageDisplayFlags), e2.push(280, this.clippingStateFlag), e2.push(281, this.brightness), e2.push(282, this.contrast), e2.push(283, this.fade), e2.push(360, this.imageDefReactorHandle), e2.push(71, this.clippingType), e2.push(91, S(this, Bt, "f").length), S(this, Bt, "f").forEach(((t2) => e2.point2d(t2, 4))), e2.push(290, this.clipModeFlag);
  }
};
Bt = /* @__PURE__ */ new WeakMap();
var As = class extends ht {
  constructor(e2, s2, n) {
    var i, h2, o2, d2, a2, l2;
    super("INSERT", "AcDbBlockReference", n), this.blockName = e2, this.insertionPoint = s2, this.scaleFactor = (null == n ? void 0 : n.scaleFactor) || t(1, 1, 1), this.rotationAngle = null !== (i = null == n ? void 0 : n.rotationAngle) && void 0 !== i ? i : 0, this.columnCount = null !== (h2 = null == n ? void 0 : n.columnCount) && void 0 !== h2 ? h2 : 1, this.rowCount = null !== (o2 = null == n ? void 0 : n.rowCount) && void 0 !== o2 ? o2 : 1, this.columnSpacing = null !== (d2 = null == n ? void 0 : n.columnSpacing) && void 0 !== d2 ? d2 : 0, this.rowSpacing = null !== (a2 = null == n ? void 0 : n.rowSpacing) && void 0 !== a2 ? a2 : 0, this.attributesFollowFlag = null !== (l2 = null == n ? void 0 : n.rowSpacing) && void 0 !== l2 ? l2 : 0;
  }
  boundingBox() {
    return a.pointBBox(this.insertionPoint);
  }
  dxfyChild(e2) {
    e2.name(this.blockName), e2.point3d(this.insertionPoint), e2.push(41, this.scaleFactor.x), e2.push(42, this.scaleFactor.y), e2.push(43, this.scaleFactor.z), e2.push(50, this.rotationAngle), e2.push(66, this.attributesFollowFlag), e2.push(70, this.columnCount), e2.push(71, this.rowCount), e2.push(44, this.columnSpacing), e2.push(45, this.rowSpacing);
  }
};
!(function(e2) {
  e2[e2.Disabed = 0] = "Disabed", e2[e2.Enabled = 1] = "Enabled";
})(Ot || (Ot = {})), (function(e2) {
  e2[e2.StraightLine = 0] = "StraightLine", e2[e2.Spline = 1] = "Spline";
})(_t || (_t = {}));
var ys = class extends ht {
  constructor(e2, t2) {
    var s2, n;
    super("LEADER", "AcDbLeader", t2), this.vertices = e2, this.flag = null !== (s2 = null == t2 ? void 0 : t2.flag) && void 0 !== s2 ? s2 : Ot.Enabled, this.leaderPathType = null !== (n = null == t2 ? void 0 : t2.leaderPathType) && void 0 !== n ? n : _t.StraightLine, this.dimensionStyleName = (null == t2 ? void 0 : t2.dimensionStyleName) || "Standard";
  }
  boundingBox() {
    return a.verticesBBox(this.vertices);
  }
  dxfyChild(e2) {
    e2.push(3, this.dimensionStyleName), e2.push(71, this.flag), e2.push(72, this.leaderPathType), e2.push(76, this.vertices.length), this.vertices.forEach(((t2) => e2.point3d(t2)));
  }
};
var ms = class extends ht {
  constructor(e2, t2, s2) {
    super("LINE", "AcDbLine", s2), this.startPoint = e2, this.endPoint = t2;
  }
  boundingBox() {
    return a.lineBBox(this.startPoint, this.endPoint);
  }
  dxfyChild(e2) {
    e2.point3d(this.startPoint), e2.point3d(this.endPoint, 1);
  }
};
!(function(e2) {
  e2[e2.None = 0] = "None", e2[e2.Closed = 1] = "Closed", e2[e2.Plinegen = 128] = "Plinegen";
})(Ht || (Ht = {}));
var xs = class extends ht {
  constructor(e2, t2) {
    super("LWPOLYLINE", "AcDbPolyline", t2), this.vertices = e2, this.flags = (null == t2 ? void 0 : t2.flags) || Ht.None, this.constantWidth = (null == t2 ? void 0 : t2.constantWidth) || 0, this.elevation = (null == t2 ? void 0 : t2.elevation) || 0, this.thickness = (null == t2 ? void 0 : t2.thickness) || 0;
  }
  boundingBox() {
    return a.verticesBBox(this.vertices.map(((e2) => t(e2.point.x, e2.point.y, 0))));
  }
  dxfyChild(e2) {
    var t2, s2, n;
    e2.push(90, this.vertices.length), e2.push(70, this.flags || 0), this.vertices.find(((e3) => {
      var t3, s3;
      return (null !== (t3 = e3.startingWidth) && void 0 !== t3 ? t3 : 0) > 0 && (null !== (s3 = e3.endWidth) && void 0 !== s3 ? s3 : 0) > 0;
    })) || e2.push(43, this.constantWidth), e2.elevation(this.elevation), e2.thickness(this.thickness);
    for (const t3 of this.vertices) e2.point2d(t3.point), e2.push(40, t3.startingWidth), e2.push(41, t3.endWidth), e2.push(42, t3.bulge);
    e2.push(210, null === (t2 = this.extrusion) || void 0 === t2 ? void 0 : t2.x), e2.push(220, null === (s2 = this.extrusion) || void 0 === s2 ? void 0 : s2.y), e2.push(230, null === (n = this.extrusion) || void 0 === n ? void 0 : n.z);
  }
};
!(function(e2) {
  e2[e2.TopLeft = 1] = "TopLeft", e2[e2.TopCenter = 2] = "TopCenter", e2[e2.TopRight = 3] = "TopRight", e2[e2.MiddleLeft = 4] = "MiddleLeft", e2[e2.MiddleCenter = 5] = "MiddleCenter", e2[e2.MiddleRight = 6] = "MiddleRight", e2[e2.BottomLeft = 7] = "BottomLeft", e2[e2.BottomCenter = 8] = "BottomCenter", e2[e2.BottomRight = 9] = "BottomRight";
})(kt || (kt = {})), (function(e2) {
  e2[e2.LeftToRight = 1] = "LeftToRight", e2[e2.TopToBottom = 3] = "TopToBottom", e2[e2.ByStyle = 5] = "ByStyle";
})(Wt || (Wt = {})), (function(e2) {
  e2[e2.AtLeast = 1] = "AtLeast", e2[e2.Exact = 2] = "Exact";
})(Vt || (Vt = {}));
var Is = class extends ht {
  constructor(e2, t2, s2, n) {
    super("MTEXT", "AcDbMText", n), this.position = e2, this.height = t2, this.value = s2, this.textStyle = "STANDARD", this.rotation = null == n ? void 0 : n.rotation, this.attachmentPoint = null == n ? void 0 : n.attachmentPoint, this.drawingDirection = null == n ? void 0 : n.drawingDirection, this.lineSpacingStyle = null == n ? void 0 : n.lineSpacingStyle, this.width = null == n ? void 0 : n.width;
  }
  boundingBox() {
    return a.pointBBox(this.position);
  }
  dxfyChild(e2) {
    e2.point3d(this.position), e2.push(40, this.height), e2.push(41, this.width), e2.push(71, this.attachmentPoint), e2.push(72, this.drawingDirection), e2.push(73, this.lineSpacingStyle), e2.primaryText(this.value), e2.push(50, this.rotation), e2.textStyle(this.textStyle);
  }
};
var Ls = class extends ht {
  constructor(e2, t2, s2, n) {
    super("POINT", "AcDbPoint", n), this.x = e2, this.y = t2, this.z = s2;
  }
  boundingBox() {
    return a.pointBBox(t(this.x, this.y, this.z));
  }
  dxfyChild(e2) {
    e2.point3d(t(this.x, this.y, this.z));
  }
};
!(function(e2) {
  e2[e2.None = 0] = "None", e2[e2.ExtraVertex = 1] = "ExtraVertex", e2[e2.CurveFit = 2] = "CurveFit", e2[e2.NotUsed = 4] = "NotUsed", e2[e2.SplineVertex = 8] = "SplineVertex", e2[e2.SplineFrame = 16] = "SplineFrame", e2[e2.Polyline3dVertex = 32] = "Polyline3dVertex", e2[e2.Polygon3dMesh = 64] = "Polygon3dMesh", e2[e2.PolyfaceMeshVertex = 128] = "PolyfaceMeshVertex";
})(Ut || (Ut = {}));
var Ss = class extends ht {
  constructor(e2, t2) {
    var s2;
    super("VERTEX", "AcDbVertex", t2), this.point = e2, this.flags = null !== (s2 = null == t2 ? void 0 : t2.flags) && void 0 !== s2 ? s2 : Ut.None, t2 && ("startingWidth" in t2 && (this.startingWidth = t2.startingWidth), "endWidth" in t2 && (this.endWidth = t2.endWidth), "bulge" in t2 && (this.bulge = t2.bulge));
  }
  boundingBox() {
    return a.pointBBox(this.point);
  }
  dxfyChild(e2) {
    e2.subclassMarker("AcDb3dPolylineVertex"), e2.point3d(this.point), e2.push(40, this.startingWidth), e2.push(41, this.endWidth), e2.push(42, this.bulge), e2.push(70, this.flags);
  }
};
var Ds = class extends ht {
  dxfyChild(e2) {
  }
  constructor() {
    super("SEQEND");
  }
};
!(function(e2) {
  e2[e2.None = 0] = "None", e2[e2.Closed = 1] = "Closed", e2[e2.CurveFit = 2] = "CurveFit", e2[e2.SplineFit = 4] = "SplineFit", e2[e2.Polyline3D = 8] = "Polyline3D", e2[e2.PolygonMesh3D = 16] = "PolygonMesh3D", e2[e2.PolygonMeshClosed = 32] = "PolygonMeshClosed", e2[e2.PolyfaceMesh = 64] = "PolyfaceMesh", e2[e2.LinetypeGenerated = 128] = "LinetypeGenerated";
})(jt || (jt = {})), (function(e2) {
  e2[e2.NoSmooth = 0] = "NoSmooth", e2[e2.QuadraticBSpline = 5] = "QuadraticBSpline", e2[e2.CubicBSpline = 6] = "CubicBSpline", e2[e2.Bezier = 8] = "Bezier";
})(Gt || (Gt = {}));
var bs = class extends ht {
  constructor(e2, t2) {
    var s2, n, i, h2, o2, d2, a2, l2, r2, f2;
    super("POLYLINE", "AcDb3dPolyline", t2), this._seqend = new Ds(), this.vertices = [], this.thickness = null !== (s2 = null == t2 ? void 0 : t2.thickness) && void 0 !== s2 ? s2 : 0, this.elevation = null !== (n = null == t2 ? void 0 : t2.elevation) && void 0 !== n ? n : 0, this.flags = null !== (i = null == t2 ? void 0 : t2.flags) && void 0 !== i ? i : jt.None, this.defaultStartWidth = null !== (h2 = null == t2 ? void 0 : t2.defaultStartWidth) && void 0 !== h2 ? h2 : 0, this.defaultEndWidth = null !== (o2 = null == t2 ? void 0 : t2.defaultEndWidth) && void 0 !== o2 ? o2 : 0, this.polygonMeshM = null !== (d2 = null == t2 ? void 0 : t2.polygonMeshM) && void 0 !== d2 ? d2 : 0, this.polygonMeshN = null !== (a2 = null == t2 ? void 0 : t2.polygonMeshN) && void 0 !== a2 ? a2 : 0, this.smoothSurfaceM = null !== (l2 = null == t2 ? void 0 : t2.smoothSurfaceM) && void 0 !== l2 ? l2 : 0, this.smoothSurfaceN = null !== (r2 = null == t2 ? void 0 : t2.smoothSurfaceN) && void 0 !== r2 ? r2 : 0, this.surfaceType = null !== (f2 = null == t2 ? void 0 : t2.surfaceType) && void 0 !== f2 ? f2 : Gt.NoSmooth, e2.forEach(((e3) => this.vertices.push(new Ss(e3.point, { startingWidth: e3.startingWidth, endWidth: e3.endWidth, bulge: e3.bulge, flags: Ut.Polyline3dVertex }))));
  }
  boundingBox() {
    return a.verticesBBox(this.vertices.map(((e2) => e2.point)));
  }
  dxfyChild(e2) {
    e2.push(66, 1), e2.point3d(t(0, 0, this.elevation)), e2.push(39, this.thickness), e2.push(70, this.flags), e2.push(40, this.defaultStartWidth), e2.push(41, this.defaultEndWidth), e2.push(71, this.polygonMeshM), e2.push(72, this.polygonMeshN), e2.push(73, this.smoothSurfaceM), e2.push(74, this.smoothSurfaceN), e2.push(75, this.surfaceType), this.vertices.forEach(((t2) => t2.dxfy(e2))), this._seqend.dxfy(e2);
  }
};
!(function(e2) {
  e2[e2.Closed = 1] = "Closed", e2[e2.Periodic = 2] = "Periodic", e2[e2.Rational = 4] = "Rational", e2[e2.Planar = 8] = "Planar", e2[e2.Linear = 16] = "Linear";
})(zt || (zt = {}));
var vs = class extends ht {
  constructor(e2, t2) {
    var s2, n;
    super("SPLINE", "AcDbSpline", t2), this.controlPoints = e2.controlPoints, this.degreeCurve = null !== (s2 = e2.degreeCurve) && void 0 !== s2 ? s2 : 3, this.flags = null !== (n = e2.flags) && void 0 !== n ? n : zt.Planar, this.knots = e2.knots || [], this.weights = e2.weights || [], this.fitPoints = e2.fitPoints || [];
    const i = this.controlPoints.length, h2 = this.degreeCurve, o2 = h2 + 1, d2 = this.fitPoints.length;
    if (i < o2) throw new Error(`Number of control points should be >= ${o2}.`);
    if (0 !== d2 && d2 < 2) throw new Error("Number of fit points should be >= 2.");
    const a2 = h2 + i + 1;
    if (0 === this.knots.length) {
      let e3 = 0;
      for (let t3 = 0; t3 < a2; t3++) t3 <= h2 || t3 >= i + 1 ? this.knots.push(e3) : this.knots.push(++e3);
    }
    if (this.knots.length !== a2) throw new Error(`Number of knots should be ${a2}.`);
  }
  boundingBox() {
    return a.verticesBBox([...this.controlPoints, ...this.fitPoints]);
  }
  dxfyChild(e2) {
    e2.push(70, this.flags), e2.push(71, this.degreeCurve), e2.push(72, this.knots.length), e2.push(73, this.controlPoints.length), e2.push(74, this.fitPoints.length), e2.push(42, "0.0000001"), e2.push(43, "0.0000001"), e2.push(42, "0.0000000001"), this.knots.forEach(((t2) => e2.push(40, t2))), this.weights.forEach(((t2) => e2.push(41, t2))), this.controlPoints.forEach(((t2) => e2.point3d(t2))), this.fitPoints.forEach(((t2) => e2.point3d(t2, 1)));
  }
};
!(function(e2) {
  e2[e2.Text = 1] = "Text", e2[e2.Block = 2] = "Block";
})(Jt || (Jt = {})), (function(e2) {
  e2[e2.False = 0] = "False", e2[e2.True = 1] = "True";
})(Kt || (Kt = {})), (function(e2) {
  e2[e2.False = 0] = "False", e2[e2.True = 1] = "True";
})(Zt || (Zt = {})), (function(e2) {
  e2[e2.TopLeft = 1] = "TopLeft", e2[e2.TopCenter = 2] = "TopCenter", e2[e2.TopRight = 3] = "TopRight", e2[e2.MiddleLeft = 4] = "MiddleLeft", e2[e2.MiddleCenter = 5] = "MiddleCenter", e2[e2.MiddleRight = 6] = "MiddleRight", e2[e2.BottomLeft = 7] = "BottomLeft", e2[e2.BottomCenter = 8] = "BottomCenter", e2[e2.BottomRight = 9] = "BottomRight";
})(qt || (qt = {}));
var Fs = class extends ht {
  constructor(e2, s2, n, i, h2, o2, d2) {
    super("ACAD_TABLE", "AcDbBlockReference", d2), this.blockName = e2, this.position = s2, this.numberOfRows = n, this.numberOfColumn = i, this.rowsHeight = h2, this.columnsHeight = o2, this.horizontalDirectionVector = (null == d2 ? void 0 : d2.horizontalDirectionVector) || t(1), this.cells = null == d2 ? void 0 : d2.cell;
  }
  boundingBox() {
    return a.pointBBox(this.position);
  }
  dxfyChild(e2) {
    var t2, s2, n, i;
    e2.name(this.blockName), e2.point3d(this.position), e2.subclassMarker("AcDbTable"), e2.point3d(this.horizontalDirectionVector, 1), e2.push(91, this.numberOfRows), e2.push(92, this.numberOfColumn);
    for (let n2 = 0; n2 < this.numberOfRows; n2++) e2.push(141, null !== (s2 = null !== (t2 = this.rowsHeight[n2]) && void 0 !== t2 ? t2 : this.rowsHeight[0]) && void 0 !== s2 ? s2 : 1);
    for (let t3 = 0; t3 < this.numberOfColumn; t3++) e2.push(142, null !== (i = null !== (n = this.columnsHeight[t3]) && void 0 !== n ? n : this.columnsHeight[0]) && void 0 !== i ? i : 1);
    this.cells.forEach(((t3) => t3.dxfy(e2)));
  }
};
!(function(e2) {
  e2[e2.None = 0] = "None", e2[e2.Backward = 2] = "Backward", e2[e2.UpsideDown = 4] = "UpsideDown";
})($t || ($t = {})), (function(e2) {
  e2[e2.Left = 0] = "Left", e2[e2.Center = 1] = "Center", e2[e2.Right = 2] = "Right", e2[e2.Aligned = 3] = "Aligned", e2[e2.Middle = 4] = "Middle", e2[e2.Fit = 5] = "Fit";
})(Qt || (Qt = {})), (function(e2) {
  e2[e2.BaseLine = 0] = "BaseLine", e2[e2.Bottom = 1] = "Bottom", e2[e2.Middle = 2] = "Middle", e2[e2.Top = 3] = "Top";
})(es || (es = {}));
var Cs = class extends ht {
  constructor(e2, t2, s2, n) {
    super("TEXT", "AcDbText", n), this.position = e2, this.height = t2, this.value = s2, this.textStyle = "STANDARD", this.rotation = null == n ? void 0 : n.rotation, this.obliqueAngle = null == n ? void 0 : n.obliqueAngle, this.generationFlags = null == n ? void 0 : n.generationFlags, this.horizontalAlignment = null == n ? void 0 : n.horizontalAlignment, this.verticalAlignment = null == n ? void 0 : n.verticalAlignment, this.secondAlignmentPoint = null == n ? void 0 : n.secondAlignmentPoint, this.relativeXScaleFactor = null == n ? void 0 : n.relativeXScaleFactor;
  }
  boundingBox() {
    return a.pointBBox(this.position);
  }
  dxfyChild(e2) {
    e2.point3d(this.position), e2.push(40, this.height), e2.primaryText(this.value), e2.push(50, this.rotation), e2.push(41, this.relativeXScaleFactor), e2.push(51, this.obliqueAngle), e2.textStyle(this.textStyle), e2.push(71, this.generationFlags), e2.push(72, this.horizontalAlignment), e2.point3d(this.secondAlignmentPoint, 1), e2.subclassMarker("AcDbText"), e2.push(73, this.verticalAlignment);
  }
};
var Ts = class {
  constructor(e2, t2, s2) {
    this.entities = [], this.handle = h.next(), this.objects = e2, this.blockRecord = t2, this.layerName = s2;
  }
  dxfy(e2) {
    for (const t2 of this.entities) t2.dxfy(e2);
  }
  addHatch(e2, t2, s2) {
    const n = new gs(e2, t2, s2);
    return this.addEntity(n);
  }
  addEntity(e2) {
    return e2.ownerBlockRecord = this.blockRecord.handle, this.blockRecord.isPaperSpace && (e2.inPaperSpace = true), null == e2.layerName && (e2.layerName = this.layerName), this.entities.push(e2), e2;
  }
  addAttrib(e2, t2, s2, n, i, h2) {
    i.attributesFollowFlag = 1;
    const o2 = this.addEntity(new St(e2, t2, s2, n, h2));
    return this.addEntity(new Ds()).ownerBlockRecord = i.handle, o2;
  }
  addAttdef(e2, t2, s2, n, i) {
    return this.addEntity(new Lt(e2, t2, s2, n, i));
  }
  addAlignedDim(e2, t2, s2) {
    return this.addEntity(new ct(e2, t2, s2));
  }
  addDiameterDim(e2, t2, s2) {
    return this.addEntity(new yt(e2, t2, s2));
  }
  addRadialDim(e2, t2, s2) {
    return this.addEntity(new xt(e2, t2, s2));
  }
  addLinearDim(e2, t2, s2) {
    return this.addEntity(new mt(e2, t2, s2));
  }
  addAngularLinesDim(e2, t2, s2, n) {
    return this.addEntity(new gt(e2, t2, s2, n));
  }
  addAngularPointsDim(e2, t2, s2, n) {
    return this.addEntity(new pt(e2, t2, s2, n));
  }
  addLine(e2, t2, s2) {
    return this.addEntity(new ms(e2, t2, s2));
  }
  addLeader(e2, t2) {
    return this.addEntity(new ys(e2, t2));
  }
  addLWPolyline(e2, t2) {
    return this.addEntity(new xs(e2, t2));
  }
  addRectangle(t2, n, i) {
    const h2 = [], o2 = t2.x, d2 = t2.y, a2 = n.x, l2 = n.y;
    if (void 0 !== (null == i ? void 0 : i.fillet) && void 0 !== (null == i ? void 0 : i.chamfer)) throw new Error("You cannot define both fillet and chamfer!");
    if (void 0 !== (null == i ? void 0 : i.fillet)) {
      const t3 = null == i ? void 0 : i.fillet, n2 = e(t3);
      h2.push({ point: s(o2, d2 - t3), bulge: n2 }), h2.push({ point: s(o2 + t3, d2) }), h2.push({ point: s(a2 - t3, d2), bulge: n2 }), h2.push({ point: s(a2, d2 - t3) }), h2.push({ point: s(a2, l2 + t3), bulge: n2 }), h2.push({ point: s(a2 - t3, l2) }), h2.push({ point: s(o2 + t3, l2), bulge: n2 }), h2.push({ point: s(o2, l2 + t3) });
    } else if (void 0 !== (null == i ? void 0 : i.chamfer)) {
      const e2 = null == i ? void 0 : i.chamfer.first, t3 = (null == i ? void 0 : i.chamfer.second) || e2;
      h2.push({ point: s(o2, d2 - e2) }), h2.push({ point: s(o2 + t3, d2) }), h2.push({ point: s(a2 - e2, d2) }), h2.push({ point: s(a2, d2 - t3) }), h2.push({ point: s(a2, l2 + e2) }), h2.push({ point: s(a2 - t3, l2) }), h2.push({ point: s(o2 + e2, l2) }), h2.push({ point: s(o2, l2 + t3) });
    } else h2.push({ point: s(o2, d2) }), h2.push({ point: s(a2, d2) }), h2.push({ point: s(a2, l2) }), h2.push({ point: s(o2, l2) });
    return this.addLWPolyline(h2, Object.assign(Object.assign({}, i), { flags: Ht.Closed }));
  }
  addImage(e2, t2, s2, n, i, h2, o2, d2) {
    const a2 = this.objects.addImageDef(e2);
    a2.width = n, a2.height = i;
    const l2 = new ps({ height: i, width: n, scale: h2, rotation: o2, insertionPoint: s2, imageDefHandle: a2.handle }, d2), r2 = this.objects.addImageDefReactor(l2.handle);
    l2.imageDefReactorHandle = r2.handle, this.addEntity(l2);
    const f2 = this.objects.addDictionary();
    return f2.addEntryObject(t2, a2.handle), a2.ownerObjecthandle = f2.handle, this.objects.root.addEntryObject("ACAD_IMAGE_DICT", f2.handle), a2.acadImageDictHandle = f2.handle, a2.addImageDefReactorHandle(r2.handle), l2;
  }
  addPolyline3D(e2, t2) {
    return this.addEntity(new bs(e2, t2));
  }
  addPoint(e2, t2, s2, n) {
    return this.addEntity(new Ls(e2, t2, s2, n));
  }
  addCircle(e2, t2, s2) {
    return this.addEntity(new Dt(e2, t2, s2));
  }
  addArc(e2, t2, s2, n, i) {
    return this.addEntity(new It(e2, t2, s2, n, i));
  }
  addSpline(e2, t2) {
    return this.addEntity(new vs(e2, t2));
  }
  addEllipse(e2, t2, s2, n, i, h2) {
    const o2 = new bt(e2, t2, s2, n, i, h2);
    return this.addEntity(o2), o2;
  }
  add3dFace(e2, t2, s2, n, i) {
    return this.addEntity(new hs(e2, t2, s2, n, i));
  }
  addText(e2, t2, s2, n) {
    return this.addEntity(new Cs(e2, t2, s2, n));
  }
  addMText(e2, t2, s2, n) {
    return this.addEntity(new Is(e2, t2, s2, n));
  }
  addInsert(e2, t2, s2) {
    return this.addEntity(new As(e2, t2, s2 || {}));
  }
  addTable(e2, t2, s2, n, i, h2, o2) {
    return this.addEntity(new Fs(e2, t2, s2, n, i, h2, o2));
  }
  boundingBox() {
    const e2 = [];
    for (let t2 = 0; t2 < this.entities.length; t2++) e2.push(this.entities[t2].boundingBox());
    return a.boundingBox(e2);
  }
  centerView() {
    return a.boundingBoxCenter(this.boundingBox());
  }
  viewHeight() {
    return a.boundingBoxHeight(this.boundingBox());
  }
};
!(function(e2) {
  e2[e2.None = 0] = "None", e2[e2.AnonymousBlock = 1] = "AnonymousBlock", e2[e2.HasNonConstantAttribute = 2] = "HasNonConstantAttribute", e2[e2.XRef = 4] = "XRef", e2[e2.XRefOverlay = 8] = "XRefOverlay", e2[e2.ExternallyDependent = 16] = "ExternallyDependent", e2[e2.ResolvedXRef = 32] = "ResolvedXRef", e2[e2.ReferencedXRef = 64] = "ReferencedXRef";
})(ts || (ts = {}));
var Xs = class extends Ts {
  get isPaperSpace() {
    return this.name.startsWith("*Paper_Space");
  }
  get isModelSpace() {
    return this.name.startsWith("*Model_Space");
  }
  get isModelOrPaperSpace() {
    return this.isModelSpace || this.isPaperSpace;
  }
  constructor(e2, s2, n) {
    super(n, s2, "0"), this.name = e2, this.flags = ts.None, this.endBlk = new o(), this.ownerObjectHandle = s2.handle, this.basePoint = t(0, 0, 0), this.xrefPathName = "";
  }
  setLayerName(e2) {
    this.layerName = e2;
  }
  dxfy(e2) {
    e2.type("BLOCK"), e2.handle(this.handle), e2.push(330, this.ownerObjectHandle), e2.subclassMarker("AcDbEntity"), e2.layerName(this.layerName), e2.subclassMarker("AcDbBlockBegin"), e2.name(this.name), e2.push(70, this.flags), e2.point3d(this.basePoint), e2.name(this.name, 3), e2.push(1, this.xrefPathName), this.isModelSpace || "*Paper_Space" === this.name || super.dxfy(e2), this.endBlk.dxfy(e2);
  }
};
var Rs = class {
  constructor(e2, t2) {
    this.blocks = [], this.paperSpaceSeed = 0, this.tables = e2, this.objects = t2, this.modelSpace = this.addBlock("*Model_Space", t2, false), this.paperSpace = this.addBlock("*Paper_Space", t2, false);
  }
  addBlock(e2, t2, s2 = true) {
    s2 && (e2 = e2.replace(rt, ""));
    const n = this.tables.addBlockRecord(e2), i = new Xs(e2, n, t2);
    return this.blocks.push(i), i;
  }
  addPaperSpace() {
    const e2 = "*Paper_Space" + this.paperSpaceSeed++;
    return this.addBlock(e2, this.objects, false);
  }
  dxfy(e2) {
    e2.start("BLOCKS"), this.blocks.forEach(((t2) => t2.dxfy(e2))), e2.end();
  }
};
var Ys = class {
  dxfy(e2) {
    e2.start("CLASSES"), e2.end();
  }
};
var Bs = class {
  constructor(e2) {
    this.blocks = e2, this.modelSpace = e2.modelSpace, this.paperSpace = e2.paperSpace;
  }
  setLayerName(e2) {
    this.modelSpace.setLayerName(e2);
  }
  dxfy(e2) {
    e2.start("ENTITIES"), this.paperSpace.entities.forEach(((t2) => t2.dxfy(e2))), this.modelSpace.entities.forEach(((t2) => t2.dxfy(e2))), e2.end();
  }
};
var ws = class {
  constructor(e2, t2) {
    this.values = t2, this.name = e2;
  }
  dxfy(e2) {
    e2.variableName(this.name);
    Object.entries(this.values).forEach(((t2) => {
      const [s2, n] = t2;
      e2.push(parseInt(s2), n);
    }));
  }
};
var Ns = class {
  constructor() {
    this.variables = [];
  }
  setVariable(e2, t2) {
    const s2 = this.variables.find(((t3) => t3.name === e2));
    s2 ? s2.values = t2 : this.variables.push(new ws(e2, t2));
  }
  dxfy(e2) {
    e2.start("HEADER"), this.variables.forEach(((t2) => t2.dxfy(e2))), e2.end();
  }
};
var Ms = class {
  constructor(e2) {
    this.type = e2, this.ownerObjecthandle = "0", this.handle = h.next();
  }
  dxfy(e2) {
    e2.type(this.type), e2.handle(this.handle), e2.push(330, this.ownerObjecthandle);
  }
};
var Ps = class extends Ms {
  constructor() {
    super("DICTIONARY"), this.entries = [], this.duplicateRecordCloningFlag = 0;
  }
  addEntryObject(e2, t2) {
    this.entries.push({ name: e2, entryObjectHandle: t2 });
  }
  dxfy(e2) {
    super.dxfy(e2), e2.subclassMarker("AcDbDictionary"), e2.push(280, this.hardOwnerFlag), e2.push(281, this.duplicateRecordCloningFlag);
    for (const t2 of this.entries) e2.push(3, t2.name), e2.push(350, t2.entryObjectHandle);
  }
};
!(function(e2) {
  e2[e2.NoUnits = 0] = "NoUnits", e2[e2.Centimeters = 2] = "Centimeters", e2[e2.Inch = 5] = "Inch";
})(ss || (ss = {}));
var Os = class extends Ms {
  constructor(e2) {
    super("IMAGEDEF"), this.path = e2, this.acadImageDictHandle = "", this.imageReactorHandles = [], this.width = 1, this.height = 1, this.widthPixelSize = 1, this.heightPixelSize = 1, this.loaded = true, this.resolutionUnits = ss.NoUnits;
  }
  addImageDefReactorHandle(e2) {
    this.imageReactorHandles.push(e2);
  }
  dxfy(e2) {
    super.dxfy(e2);
    const t2 = new A("ACAD_REACTORS");
    t2.add(330, this.acadImageDictHandle);
    for (const e3 of this.imageReactorHandles) t2.add(330, e3);
    t2.dxfy(e2), e2.subclassMarker("AcDbRasterImageDef"), e2.push(1, this.path), e2.point2d(s(this.width, this.height)), e2.push(11, this.widthPixelSize), e2.push(21, this.heightPixelSize), e2.push(280, Number(this.loaded)), e2.push(281, this.resolutionUnits);
  }
};
var _s = class extends Ms {
  constructor(e2) {
    super("IMAGEDEF_REACTOR"), this.imageHandle = e2, this.classVersion = 2;
  }
  dxfy(e2) {
    super.dxfy(e2), e2.subclassMarker("AcDbRasterImageDefReactor"), e2.push(90, this.classVersion), e2.push(330, this.imageHandle);
  }
};
var Hs = class {
  constructor() {
    this.root = new Ps(), this.objects = [], this.root.duplicateRecordCloningFlag = 1;
    const e2 = this.addDictionary();
    this.root.addEntryObject("ACAD_GROUP", e2.handle);
  }
  addObject(e2) {
    return this.objects.push(e2), e2;
  }
  addImageDef(e2) {
    return this.addObject(new Os(e2));
  }
  addImageDefReactor(e2) {
    return this.addObject(new _s(e2));
  }
  addDictionary() {
    const e2 = new Ps();
    return e2.ownerObjecthandle = this.root.handle, this.addObject(e2), e2;
  }
  addEntryToRoot(e2, t2) {
    this.root.addEntryObject(e2, t2);
  }
  dxfy(e2) {
    e2.start("OBJECTS"), this.root.dxfy(e2);
    for (const t2 of this.objects) t2.dxfy(e2);
    e2.end(), e2.type("EOF");
  }
};
var Ws = class {
  constructor(e2) {
    this.name = e2, this.maxNumberEntries = 0, this.ownerObjectHandle = "0", this.handle = h.next(), this.records = [];
  }
  dxfy(e2) {
    e2.type("TABLE"), e2.name(this.name), e2.handle(this.handle), e2.push(330, this.ownerObjectHandle), e2.subclassMarker("AcDbSymbolTable"), e2.push(70, this.records.length);
    for (const t2 of this.records) t2.dxfy(e2);
    e2.type("ENDTAB");
  }
};
!(function(e2) {
  e2[e2.None = 0] = "None", e2[e2.XRefDependent = 16] = "XRefDependent", e2[e2.XRefResolved = 32] = "XRefResolved";
})(ns || (ns = {}));
var Vs = class extends u {
  constructor(e2, t2) {
    super("APPID"), this.name = e2, this.flags = null != t2 ? t2 : ns.None;
  }
  dxfy(e2) {
    super.dxfy(e2), e2.subclassMarker("AcDbRegAppTableRecord"), e2.name(this.name), e2.push(70, this.flags);
  }
};
var Us = class extends u {
  get isPaperSpace() {
    return this.name.startsWith("*Paper_Space");
  }
  constructor(e2) {
    super("BLOCK_RECORD"), this.name = e2, this.insertionUnits = 0, this.explodability = 1, this.scalability = 0;
  }
  dxfy(e2) {
    super.dxfy(e2), e2.subclassMarker("AcDbBlockTableRecord"), e2.name(this.name), e2.push(340, this.layoutObject), e2.push(70, this.insertionUnits), e2.push(280, this.explodability), e2.push(281, this.scalability);
  }
};
!(function(e2) {
  e2[e2.None = 0] = "None", e2[e2.XRefDependent = 16] = "XRefDependent", e2[e2.XRefRefesolved = 32] = "XRefRefesolved";
})(is || (is = {}));
var js = class {
  constructor(e2, t2) {
    this.name = e2, this.flags = null != t2 ? t2 : is.None, this.handle = h.next(), this.type = "DIMSTYLE";
  }
  dxfy(e2) {
    e2.type(this.type), e2.push(105, this.handle), e2.push(330, this.ownerObjectHandle), e2.subclassMarker("AcDbSymbolTableRecord"), e2.subclassMarker("AcDbDimStyleTableRecord"), e2.name(this.name), e2.push(70, this.flags), e2.push(3, this.DIMPOST), e2.push(4, this.DIMAPOST), e2.push(5, this.DIMBLK), e2.push(6, this.DIMBLK1), e2.push(7, this.DIMBLK2), e2.push(40, this.DIMSCALE), e2.push(41, this.DIMASZ), e2.push(42, this.DIMEXO), e2.push(43, this.DIMDLI), e2.push(44, this.DIMEXE), e2.push(45, this.DIMRND), e2.push(46, this.DIMDLE), e2.push(47, this.DIMTP), e2.push(48, this.DIMTM), e2.push(140, this.DIMTXT), e2.push(141, this.DIMCEN), e2.push(142, this.DIMTSZ), e2.push(143, this.DIMALTF), e2.push(144, this.DIMLFAC), e2.push(145, this.DIMTVP), e2.push(146, this.DIMTFAC), e2.push(147, this.DIMGAP), e2.push(148, this.DIMALTRND), e2.push(71, this.DIMTOL), e2.push(72, this.DIMLIM), e2.push(73, this.DIMTIH), e2.push(74, this.DIMTOH), e2.push(75, this.DIMSE1), e2.push(76, this.DIMSE2), e2.push(77, this.DIMTAD), e2.push(78, this.DIMZIN), e2.push(79, this.DIMAZIN), e2.push(170, this.DIMALT), e2.push(171, this.DIMALTD), e2.push(172, this.DIMTOFL), e2.push(173, this.DIMSAH), e2.push(174, this.DIMTIX), e2.push(175, this.DIMSOXD), e2.push(176, this.DIMCLRD), e2.push(177, this.DIMCLRE), e2.push(178, this.DIMCLRT), e2.push(179, this.DIMADEC), e2.push(271, this.DIMDEC), e2.push(272, this.DIMTDEC), e2.push(273, this.DIMALTU), e2.push(274, this.DIMALTTD), e2.push(275, this.DIMAUNIT), e2.push(276, this.DIMFRAC), e2.push(277, this.DIMLUNIT), e2.push(278, this.DIMDSEP), e2.push(279, this.DIMTMOVE), e2.push(280, this.DIMJUST), e2.push(281, this.DIMSD1), e2.push(282, this.DIMSD2), e2.push(283, this.DIMTOLJ), e2.push(284, this.DIMTZIN), e2.push(285, this.DIMALTZ), e2.push(286, this.DIMALTTZ), e2.push(287, this.DIMFIT), e2.push(288, this.DIMUPT), e2.push(289, this.DIMATFIT), e2.push(340, this.DIMTXSTY), e2.push(341, this.DIMLDRBLK), e2.push(342, this.DIMBLK), e2.push(343, this.DIMBLK1), e2.push(344, this.DIMBLK2), e2.push(371, this.DIMLWD), e2.push(372, this.DIMLWE);
  }
};
var Gs = class extends u {
  constructor(e2, t2, s2, n) {
    super("LTYPE"), this.name = e2, this.descriptive = t2, this.elements = s2, this.flags = null != n ? n : 0;
  }
  dxfy(e2) {
    super.dxfy(e2), e2.subclassMarker("AcDbLinetypeTableRecord"), e2.name(this.name), e2.push(70, this.flags), e2.push(3, this.descriptive), e2.push(72, 65), e2.push(73, this.elements.length);
    let t2 = 0;
    for (const e3 of this.elements) t2 += Math.abs(e3);
    e2.push(40, t2);
    for (const t3 of this.elements) e2.push(49, t3), e2.push(74, 0);
  }
};
var zs = class extends u {
  constructor(e2, t2) {
    super("STYLE"), this.fixedTextHeight = 0, this.widthFactor = 1, this.obliqueAngle = 0, this.textGenerationFlag = 0, this.lastHeightUsed = 1, this.fontFileName = "txt", this.bigFontFileName = "", this.name = e2, this.flags = null != t2 ? t2 : r.None;
  }
  dxfy(e2) {
    super.dxfy(e2), e2.subclassMarker("AcDbTextStyleTableRecord"), e2.name(this.name), e2.push(70, this.flags), e2.push(40, this.fixedTextHeight), e2.push(41, this.widthFactor), e2.push(50, this.obliqueAngle), e2.push(71, this.textGenerationFlag), e2.push(42, this.lastHeightUsed), e2.push(3, this.fontFileName), e2.push(4, this.bigFontFileName);
  }
};
var Js = class extends u {
  constructor(e2) {
    super("UCS"), this.name = e2;
  }
  dxfy(e2) {
    super.dxfy(e2);
  }
};
var Ks = class extends u {
  constructor(e2) {
    super("VPORT"), this.name = e2, this.viewHeight = 200, this.viewCenter = [0, 0];
  }
  dxfy(e2) {
    super.dxfy(e2);
    const [t2, s2] = this.viewCenter;
    e2.subclassMarker("AcDbViewportTableRecord"), e2.name(this.name), e2.push(70, 0), e2.point2d({ x: 0, y: 0 }), e2.push(11, 1), e2.push(21, 1), e2.push(12, t2), e2.push(22, s2), e2.push(13, 0), e2.push(23, 0), e2.push(14, 10), e2.push(24, 10), e2.push(15, 10), e2.push(25, 10), e2.push(16, 0), e2.push(26, 0), e2.push(36, 1), e2.push(17, 0), e2.push(27, 0), e2.push(37, 0), e2.push(40, this.viewHeight || 200), e2.push(41, 2), e2.push(42, 50), e2.push(43, 0), e2.push(44, 0), e2.push(50, 0), e2.push(51, 0), e2.push(71, 0), e2.push(72, 100), e2.push(73, 1), e2.push(74, 3), e2.push(75, 0), e2.push(76, 1), e2.push(77, 0), e2.push(78, 0), e2.push(281, 0), e2.push(65, 1), e2.push(110, 0), e2.push(120, 0), e2.push(130, 0), e2.push(111, 1), e2.push(121, 0), e2.push(131, 0), e2.push(112, 0), e2.push(122, 1), e2.push(132, 0), e2.push(79, 0), e2.push(146, 0), e2.push(348, 10020), e2.push(60, 7), e2.push(61, 5), e2.push(292, 1), e2.push(282, 1), e2.push(141, 0), e2.push(142, 0), e2.push(63, 250), e2.push(421, 3358443);
  }
};
var Zs = class extends u {
  constructor(e2) {
    var t2;
    super("VIEW"), this.name = e2.name, this.flags = null !== (t2 = e2.flags) && void 0 !== t2 ? t2 : f.None, this.viewHeight = e2.viewHeight, this.viewCenter = e2.viewCenter, this.viewWidth = e2.viewWidth, this.viewDirection = e2.viewDirection, this.targetPoint = e2.targetPoint, this.lensLength = e2.lensLength, this.frontClipping = e2.frontClipping, this.backClipping = e2.backClipping, this.twistAngle = e2.twistAngle, this.viewMode = e2.viewMode, this.renderMode = e2.renderMode, this.isUCSAssociated = e2.isUCSAssociated, this.isCameraPlottable = e2.isCameraPlottable || false, e2.backgroundObjectHandle && (this.backgroundObjectHandle = e2.backgroundObjectHandle), e2.liveSectionObjectHandle && (this.liveSectionObjectHandle = e2.liveSectionObjectHandle), e2.visualStyleObjectHandle && (this.visualStyleObjectHandle = e2.visualStyleObjectHandle);
  }
  dxfy(e2) {
    super.dxfy(e2), e2.subclassMarker("AcDbViewTableRecord"), e2.name(this.name), e2.push(70, this.flags), e2.push(40, this.viewHeight), e2.point2d(this.viewCenter), e2.push(41, this.viewWidth), e2.push(11, this.viewDirection.x), e2.push(21, this.viewDirection.y), e2.push(31, this.viewDirection.z), e2.push(12, this.targetPoint.x), e2.push(22, this.targetPoint.y), e2.push(32, this.targetPoint.z), e2.push(42, this.lensLength), e2.push(43, this.frontClipping), e2.push(44, this.backClipping), e2.push(50, this.twistAngle), e2.push(71, this.viewMode), e2.push(281, this.renderMode), e2.push(72, this.isUCSAssociated ? 1 : 0), e2.push(73, this.isCameraPlottable ? 1 : void 0), e2.push(332, this.backgroundObjectHandle), e2.push(334, this.liveSectionObjectHandle), e2.push(348, this.visualStyleObjectHandle);
  }
};
var qs = class extends Ws {
  constructor() {
    super("APPID");
  }
  addAppId(e2, t2) {
    const s2 = new Vs(e2, t2);
    return s2.ownerObjectHandle = this.handle, this.records.push(s2), s2;
  }
};
var $s = class extends Ws {
  constructor() {
    super("BLOCK_RECORD");
  }
  addBlockRecord(e2) {
    const t2 = new Us(e2);
    return t2.ownerObjectHandle = this.handle, this.records.push(t2), t2;
  }
};
var Qs = class extends Ws {
  constructor() {
    super("DIMSTYLE"), this.ownerObjectHandle = "0";
  }
  addDimStyle(e2, t2) {
    const s2 = new js(e2, t2);
    return s2.ownerObjectHandle = this.handle, this.records.push(s2), s2;
  }
  dxfy(e2) {
    e2.type("TABLE"), e2.name(this.name), e2.handle(this.handle), e2.push(330, this.ownerObjectHandle), e2.subclassMarker("AcDbSymbolTable"), e2.push(70, this.records.length), e2.subclassMarker("AcDbDimStyleTable");
    for (const t2 of this.records) t2.dxfy(e2);
    e2.type("ENDTAB");
  }
};
var en = class extends Ws {
  constructor() {
    super("LTYPE");
  }
  exist(e2) {
    return void 0 !== this.records.find(((t2) => t2.name === e2));
  }
  ltype(e2) {
    return this.records.find(((t2) => t2.name === e2));
  }
  addLType(e2, t2, s2, n) {
    const i = this.ltype(e2);
    if (i) return i;
    const h2 = new Gs(e2, t2, s2, n);
    return h2.ownerObjectHandle = this.handle, this.records.push(h2), h2;
  }
};
var tn = class extends Ws {
  constructor(e2) {
    super("LAYER"), this.lTypeTable = e2;
  }
  addLayer(e2, t2, s2, n) {
    e2 = e2.replace(rt, "");
    const i = this.layer(e2);
    if (i) return i;
    this.lTypeTable.exist(s2) || (s2 = I.Continuous);
    const h2 = new c(e2, t2, s2, n);
    return h2.ownerObjectHandle = this.handle, this.records.push(h2), h2;
  }
  layer(e2) {
    return e2 = e2.replace(rt, ""), this.records.find(((t2) => t2.name === e2));
  }
  exist(e2) {
    return void 0 !== this.records.find(((t2) => t2.name === e2));
  }
};
var sn = class extends Ws {
  constructor() {
    super("STYLE");
  }
  addStyle(e2, t2) {
    const s2 = new zs(e2, t2);
    return s2.ownerObjectHandle = this.handle, this.records.push(s2), s2;
  }
};
var nn = class extends Ws {
  constructor() {
    super("UCS");
  }
  addUcs(e2) {
    const t2 = new Js(e2);
    return t2.ownerObjectHandle = this.handle, this.records.push(t2), t2;
  }
};
var hn = class extends Ws {
  constructor() {
    super("VPORT");
  }
  addViewPort(e2) {
    const t2 = new Ks(e2);
    return t2.ownerObjectHandle = this.handle, this.records.push(t2), t2;
  }
};
var on = class extends Ws {
  constructor() {
    super("VIEW");
  }
  addView(e2) {
    const t2 = new Zs(e2);
    return t2.ownerObjectHandle = this.handle, this.records.push(t2), t2;
  }
};
var dn = class {
  constructor() {
    this.vPortTable = new hn(), this.ltypeTable = new en(), this.layerTable = new tn(this.ltypeTable), this.styleTable = new sn(), this.viewTable = new on(), this.ucsTable = new nn(), this.appIdTable = new qs(), this.dimStyleTable = new Qs(), this.blockRecordTable = new $s();
  }
  layer(e2) {
    return this.layerTable.layer(e2);
  }
  addLType(e2, t2, s2, n) {
    return this.ltypeTable.addLType(e2, t2, s2, n);
  }
  addBlockRecord(e2) {
    return this.blockRecordTable.addBlockRecord(e2);
  }
  addLayer(e2, t2, s2, n) {
    return this.layerTable.addLayer(e2, t2, s2, n);
  }
  addStyle(e2) {
    return this.styleTable.addStyle(e2);
  }
  addView(e2) {
    return this.viewTable.addView(e2);
  }
  addUcs(e2) {
    return this.ucsTable.addUcs(e2);
  }
  addAppId(e2, t2) {
    return this.appIdTable.addAppId(e2, t2);
  }
  addDimStyle(e2, t2) {
    return this.dimStyleTable.addDimStyle(e2, t2);
  }
  addVPort(e2) {
    return this.vPortTable.addViewPort(e2);
  }
  dxfy(e2) {
    e2.start("TABLES"), this.vPortTable.dxfy(e2), this.ltypeTable.dxfy(e2), this.layerTable.dxfy(e2), this.styleTable.dxfy(e2), this.viewTable.dxfy(e2), this.ucsTable.dxfy(e2), this.appIdTable.dxfy(e2), this.dimStyleTable.dxfy(e2), this.blockRecordTable.dxfy(e2), e2.end();
  }
};
var an = class {
  constructor() {
    h.clear(), this.header = new Ns(), this.classes = new Ys(), this.tables = new dn(), this.objects = new Hs(), this.blocks = new Rs(this.tables, this.objects), this.entities = new Bs(this.blocks), this.currentLayerName = c.layerZeroName, this.currentUnits = x.Unitless, this.header.setVariable("$ACADVER", { 1: "AC1021" }), this.header.setVariable("$LASTSAVEDBY", { 1: "@tarikjabiri/dxf" }), this._handseed(), this.setUnits(x.Unitless), this.tables.addLType("ByBlock", "", []), this.tables.addLType("ByLayer", "", []);
    const e2 = this.tables.addLType("Continuous", "Solid line", []);
    this.tables.addLayer(c.layerZeroName, m.White, e2.name), this.styleStandard = this.tables.addStyle("Standard"), this.tables.addAppId("ACAD", ns.None), this.dimStyleStandard = this.tables.addDimStyle("Standard"), this.dimStyleStandard.DIMTXSTY = this.styleStandard.handle, this.activeVPort = this.tables.addVPort("*Active"), this.modelSpace = this.blocks.modelSpace, this.paperSpace = this.blocks.paperSpace, this.setZeroLayerAsCurrent();
  }
  dxfy(e2) {
    this.header.dxfy(e2), this.classes.dxfy(e2), this.tables.dxfy(e2), this.blocks.dxfy(e2), this.entities.dxfy(e2), this.objects.dxfy(e2);
  }
  addBlock(e2) {
    return this.blocks.addBlock(e2, this.objects);
  }
  setZeroLayerAsCurrent() {
    this.setCurrentLayerName(c.layerZeroName);
  }
  setCurrentLayerName(e2) {
    this.currentLayerName = e2.replace(rt, ""), this.entities.setLayerName(this.currentLayerName), this.setCLayerVariable();
  }
  _handseed() {
    this.header.setVariable("$HANDSEED", { 5: h.peek() });
  }
  setUnits(e2) {
    this.currentUnits = e2, this.header.setVariable("$INSUNITS", { 70: this.currentUnits });
  }
  setCLayerVariable() {
    this.header.setVariable("$CLAYER", { 8: this.currentLayerName });
  }
  setViewCenter(e2) {
    this.header.setVariable("$VIEWCTR", { 10: e2.x, 20: e2.y }), this.activeVPort.viewCenter = [e2.x, e2.y];
  }
  stringify() {
    const e2 = new y();
    return this._handseed(), this.setViewCenter(this.modelSpace.centerView()), this.activeVPort.viewHeight = this.modelSpace.viewHeight(), this.dxfy(e2), e2.stringify();
  }
};
var ln = class {
  get header() {
    return this.document.header;
  }
  get tables() {
    return this.document.tables;
  }
  get blocks() {
    return this.document.blocks;
  }
  get entities() {
    return this.document.entities;
  }
  get currentLayer() {
    return this.document.currentLayerName;
  }
  get units() {
    return this.document.currentUnits;
  }
  get modelSpace() {
    return this.document.modelSpace;
  }
  constructor() {
    this.document = new an();
  }
  layer(e2) {
    return this.tables.layer(e2);
  }
  setZeroLayerAsCurrent() {
    this.document.setZeroLayerAsCurrent();
  }
  addBlock(e2) {
    return this.blocks.addBlock(e2, this.document.objects);
  }
  addPaperSpace() {
    return this.blocks.addPaperSpace();
  }
  setVariable(e2, t2) {
    this.header.setVariable(e2, t2);
  }
  addLType(e2, t2, s2) {
    return this.tables.addLType(e2, t2, s2);
  }
  addDimStyle(e2) {
    return this.tables.addDimStyle(e2);
  }
  addAlignedDim(e2, t2, s2) {
    return this.modelSpace.addAlignedDim(e2, t2, s2);
  }
  addDiameterDim(e2, t2, s2) {
    return this.modelSpace.addDiameterDim(e2, t2, s2);
  }
  addRadialDim(e2, t2, s2) {
    return this.modelSpace.addRadialDim(e2, t2, s2);
  }
  addLinearDim(e2, t2, s2) {
    return this.modelSpace.addLinearDim(e2, t2, s2);
  }
  addAngularLinesDim(e2, t2, s2, n) {
    return this.modelSpace.addAngularLinesDim(e2, t2, s2, n);
  }
  addHatch(e2, t2, s2) {
    return this.modelSpace.addHatch(e2, t2, s2);
  }
  addLayer(e2, t2, s2, n = l.None) {
    return s2 || (s2 = I.Continuous), this.tables.addLayer(e2, t2, s2, n);
  }
  setCurrentLayerName(e2) {
    this.document.setCurrentLayerName(e2);
  }
  setUnits(e2) {
    this.document.setUnits(e2);
  }
  addLine(e2, t2, s2) {
    return this.modelSpace.addLine(e2, t2, s2);
  }
  addLeader(e2, t2) {
    return this.modelSpace.addLeader(e2, t2);
  }
  addLWPolyline(e2, t2) {
    return this.modelSpace.addLWPolyline(e2, t2);
  }
  addRectangle(e2, t2, s2) {
    return this.modelSpace.addRectangle(e2, t2, s2);
  }
  addPolyline3D(e2, t2) {
    return this.modelSpace.addPolyline3D(e2, t2);
  }
  addPoint(e2, t2, s2, n) {
    return this.modelSpace.addPoint(e2, t2, s2, n);
  }
  addCircle(e2, t2, s2) {
    return this.modelSpace.addCircle(e2, t2, s2);
  }
  addArc(e2, t2, s2, n, i) {
    return this.modelSpace.addArc(e2, t2, s2, n, i);
  }
  addSpline(e2, t2) {
    return this.modelSpace.addSpline(e2, t2);
  }
  addEllipse(e2, t2, s2, n, i, h2) {
    return this.modelSpace.addEllipse(e2, t2, s2, n, i, h2);
  }
  addImage(e2, t2, s2, n, i, h2, o2, d2) {
    return this.modelSpace.addImage(e2, t2, s2, n, i, h2, o2, d2);
  }
  add3dFace(e2, t2, s2, n, i) {
    return this.modelSpace.add3dFace(e2, t2, s2, n, i);
  }
  addText(e2, t2, s2, n) {
    return this.modelSpace.addText(e2, t2, s2, n);
  }
  addAttdef(e2, t2, s2, n, i) {
    return this.modelSpace.addAttdef(e2, t2, s2, n, i);
  }
  addAttrib(e2, t2, s2, n, i, h2) {
    return this.modelSpace.addAttrib(e2, t2, s2, n, i, h2);
  }
  addMText(e2, t2, s2, n) {
    return this.modelSpace.addMText(e2, t2, s2, n);
  }
  addInsert(e2, t2, s2) {
    return this.modelSpace.addInsert(e2, t2, s2);
  }
  addTable(e2, t2, s2, n, i, h2, o2) {
    return this.modelSpace.addTable(e2, t2, s2, n, i, h2, o2);
  }
  stringify() {
    return this.document.stringify();
  }
};

// vendor/plan/dxf.ts
var ACI = {
  red: 1,
  yellow: 2,
  green: 3,
  cyan: 4,
  blue: 5,
  magenta: 6,
  white: 7,
  // 배경이 검으면 흰색, 흰 배경이면 검게 보인다
  grey: 8,
  lightGrey: 9
};
var HATCH = {
  SOLID: Et.SOLID,
  ANSI31: Et.ANSI31,
  ANSI32: Et.ANSI32,
  ANSI37: Et.ANSI37,
  "AR-CONC": Et.AR_CONC,
  "AR-SAND": Et.AR_SAND,
  DOTS: Et.DOTS
};
var LTYPES = {
  DASHED: { desc: "Dashed __ __ __ __ __", elements: [300, -150] },
  CENTER: { desc: "Center ____ _ ____ _ ____", elements: [800, -150, 150, -150] },
  DASHDOT: { desc: "Dash dot __ . __ . __ .", elements: [300, -150, 0, -150] },
  HIDDEN: { desc: "Hidden __ __ __ __", elements: [150, -80] }
};
var TEXT_STYLE = "BARUN-KO";
var DIM_STYLE = "BARUN";
var DxfBuilder = class {
  dxf;
  labelMode;
  layerNames = /* @__PURE__ */ new Set();
  constructor(layers, labelMode = "korean") {
    this.labelMode = labelMode;
    const dxf = new ln();
    this.dxf = dxf;
    dxf.setUnits(x.Millimeters);
    for (const [name, lt2] of Object.entries(LTYPES)) dxf.addLType(name, lt2.desc, lt2.elements);
    for (const l2 of layers) this.ensureLayer(l2);
    const st2 = dxf.tables.addStyle(TEXT_STYLE);
    st2.fontFileName = "malgun.ttf";
    st2.widthFactor = 1;
    const ds2 = dxf.tables.addDimStyle(DIM_STYLE);
    ds2.DIMTXT = 200;
    ds2.DIMTSZ = 130;
    ds2.DIMASZ = 130;
    ds2.DIMEXE = 100;
    ds2.DIMEXO = 100;
    ds2.DIMGAP = 60;
    ds2.DIMTIH = 0;
    ds2.DIMTAD = 1;
    ds2.DIMDEC = 0;
    ds2.DIMLFAC = 1;
    ds2.DIMSCALE = 1;
  }
  ensureLayer(l2) {
    if (this.layerNames.has(l2.name)) return;
    this.layerNames.add(l2.name);
    this.dxf.tables.addLayer(l2.name, l2.color, l2.lineType && l2.lineType !== "CONTINUOUS" ? l2.lineType : "Continuous");
  }
  /** 정의 안 된 레이어를 쓰면 CAD가 임의로 만든다 — 색이 흰색이 되므로 여기서 회색으로 만든다. */
  layer(name) {
    if (!this.layerNames.has(name)) this.ensureLayer({ name, color: ACI.grey });
    return { layerName: name };
  }
  line(layer, a2, b2) {
    this.dxf.addLine(t(a2[0], a2[1]), t(b2[0], b2[1]), this.layer(layer));
    return this;
  }
  /** 열린/닫힌 폴리라인. 지적 경계·벽 윤곽·실 경계에 쓴다. */
  polyline(layer, pts, closed = false) {
    if (pts.length < 2) return this;
    this.dxf.addLWPolyline(
      pts.map((p2) => ({ point: s(p2[0], p2[1]) })),
      { ...this.layer(layer), flags: closed ? Ht.Closed : Ht.None }
    );
    return this;
  }
  rect(layer, x2, y2, w2, h2) {
    return this.polyline(layer, [[x2, y2], [x2 + w2, y2], [x2 + w2, y2 + h2], [x2, y2 + h2]], true);
  }
  circle(layer, c2, r2) {
    this.dxf.addCircle(t(c2[0], c2[1]), r2, this.layer(layer));
    return this;
  }
  /** 호 — 각도는 도(°), 반시계 방향. 문 열림 궤적에 쓴다. */
  arc(layer, c2, r2, startDeg, endDeg) {
    this.dxf.addArc(t(c2[0], c2[1]), r2, startDeg, endDeg, this.layer(layer));
    return this;
  }
  /**
   * 해칭 — 닫힌 다각형 안을 패턴으로 채운다. 벽 포셰(SOLID)·콘크리트 단면(ANSI31)·
   * 대지 해칭에 쓴다. scale은 패턴 간격 배율(mm 도면에서 ANSI31은 20~25가 종이 1/100에서
   * 0.6~0.8mm 간격이다).
   */
  hatch(layer, pts, fill = "SOLID", scale = 20, angle = 0) {
    if (pts.length < 3) return this;
    const boundary = new ds();
    for (const p2 of pts) boundary.add(s(p2[0], p2[1]));
    const paths = new as();
    paths.addPolylineBoundary(boundary);
    const fillOpts = fill === "SOLID" ? cs({ name: HATCH.SOLID }) : cs({ name: HATCH[fill], scale, angle });
    this.dxf.addHatch(paths, fillOpts, this.layer(layer));
    return this;
  }
  hatchRect(layer, x2, y2, w2, h2, fill = "SOLID", scale = 20) {
    return this.hatch(layer, [[x2, y2], [x2 + w2, y2], [x2 + w2, y2 + h2], [x2, y2 + h2]], fill, scale);
  }
  /** 채워진 사각형 — 벽 포셰용. (예전 R12의 SOLID 엔티티 자리 — 지금은 SOLID 해칭이다.) */
  solidRect(layer, x2, y2, w2, h2) {
    return this.hatchRect(layer, x2, y2, w2, h2, "SOLID");
  }
  /**
   * 정렬 치수(DIMENSION) — CAD에서 진짜 치수로 잡힌다(선을 옮기면 값이 따라온다).
   * offset은 두 점을 잇는 선에서 치수선까지의 거리(부호로 방향). label을 주면 그 문구를 찍고,
   * 없으면 CAD가 잰 값을 찍는다.
   */
  alignedDim(layer, a2, b2, offset, label) {
    const text = label === void 0 ? void 0 : this.body(label);
    this.dxf.addAlignedDim(t(a2[0], a2[1]), t(b2[0], b2[1]), {
      ...this.layer(layer),
      offset,
      styleName: DIM_STYLE,
      ...text ? { text } : {}
    });
    return this;
  }
  body(value) {
    return this.labelMode === "ascii" ? value.replace(/[^\x20-\x7E]/g, "") : value;
  }
  text(layer, at2, height, value, align = "left", rotationDeg = 0) {
    const body = this.body(value);
    if (!body.trim()) return this;
    const t2 = this.dxf.addText(t(at2[0], at2[1]), height, body, {
      ...this.layer(layer),
      ...rotationDeg ? { rotation: rotationDeg } : {},
      ...align !== "left" ? {
        horizontalAlignment: align === "center" ? Qt.Center : Qt.Right,
        verticalAlignment: es.BaseLine,
        // 정렬을 쓰면 두 번째 점이 기준이 된다.
        secondAlignmentPoint: t(at2[0], at2[1])
      } : {}
    });
    t2.textStyle = TEXT_STYLE;
    return this;
  }
  toString() {
    return this.dxf.stringify();
  }
};

// vendor/plan/openingGeometry.ts
function openingFrame(o2) {
  const d2 = o2.direction ?? (o2.axis === "x" ? [1, 0] : [0, 1]);
  const len = Math.hypot(d2[0], d2[1]);
  if (!Number.isFinite(len) || len === 0) throw new Error("\uAC1C\uAD6C\uBD80 \uBC29\uD5A5\uC740 \uC720\uD6A8\uD55C \uBCA1\uD130\uC5EC\uC57C \uD569\uB2C8\uB2E4.");
  const tangent = [d2[0] / len, d2[1] / len];
  const normal = [-tangent[1], tangent[0]];
  const point = (along, across = 0) => [
    o2.at[0] + tangent[0] * along + normal[0] * across,
    o2.at[1] + tangent[1] * along + normal[1] * across
  ];
  return { tangent, normal, point };
}

// vendor/plan/planFixtures.ts
var C2 = FIXTURES.clearanceMm;
function rect2(x2, y2, w2, h2) {
  return { kind: "rect", x: x2, y: y2, w: w2, h: h2 };
}
function circle(c2, r2) {
  return { kind: "circle", c: c2, r: r2 };
}
function line(a2, b2) {
  return { kind: "line", a: a2, b: b2 };
}
function toilet(x2, y2) {
  const { wMm: w2, dMm: d2 } = FIXTURES.toilet;
  const tank = 180;
  return [
    rect2(x2, y2, w2, tank),
    circle([x2 + w2 / 2, y2 + tank + (d2 - tank) / 2], (d2 - tank) / 2)
  ];
}
function lavatory(x2, y2) {
  const { wMm: w2, dMm: d2 } = FIXTURES.lavatory;
  return [rect2(x2, y2, w2, d2), circle([x2 + w2 / 2, y2 + d2 / 2], Math.min(w2, d2) / 2 - 80)];
}
function bathtub(x2, y2, w2, d2) {
  return [rect2(x2, y2, w2, d2), rect2(x2 + 90, y2 + 90, w2 - 180, d2 - 180)];
}
function counter(x2, y2, w2) {
  const d2 = FIXTURES.counter.dMm;
  const out = [rect2(x2, y2, w2, d2)];
  out.push(rect2(x2 + 150, y2 + 100, Math.min(600, w2 * 0.35), d2 - 200));
  const burnerX = x2 + w2 - 450;
  for (const [dx, dy] of [
    [0, d2 * 0.3],
    [0, d2 * 0.7],
    [-330, d2 * 0.3],
    [-330, d2 * 0.7]
  ]) {
    if (burnerX + dx > x2 + w2 * 0.5) out.push(circle([burnerX + dx, y2 + dy], 110));
  }
  return out;
}
function bed(x2, y2, w2, d2) {
  return [rect2(x2, y2, w2, d2), line([x2, y2 + 380], [x2 + w2, y2 + 380])];
}
function sofa(x2, y2, w2) {
  const d2 = FIXTURES.sofa.dMm;
  return [rect2(x2, y2, w2, d2), line([x2, y2 + 250], [x2 + w2, y2 + 250])];
}
function insideRoom(r2, x2, y2, w2, h2, obs = []) {
  const m2 = C2 / 2;
  const xs2 = [x2 - m2, x2 + w2 + m2];
  const ys2 = [y2 - m2, y2 + h2 + m2];
  if (!xs2.every((px) => ys2.every((py) => pointInPoly(r2.points, px, py)))) return false;
  return !obs.some((o2) => o2.x < x2 + w2 && x2 < o2.x + o2.w && o2.y < y2 + h2 && y2 < o2.y + o2.h);
}
function furnitureObstacles(plan, includeAccess = true) {
  const half = (plan.columnMm || 400) / 2;
  const bounds = (points) => {
    const xs2 = points.map((p2) => p2[0]), ys2 = points.map((p2) => p2[1]);
    const x2 = Math.min(...xs2), y2 = Math.min(...ys2);
    return { x: x2, y: y2, w: Math.max(...xs2) - x2, h: Math.max(...ys2) - y2 };
  };
  const obstacles = plan.columnPolygons ? plan.columnPolygons.filter((ring) => ring.length >= 3).map(bounds) : plan.columns.map(([x2, y2]) => ({ x: x2 - half, y: y2 - half, w: half * 2, h: half * 2 }));
  if (!includeAccess) return obstacles;
  for (const o2 of plan.openings) {
    if (o2.kind === "window") continue;
    const depth = Math.max(FIXTURES.aisleMm, o2.swing ? o2.width : 0);
    const margin = C2 / 2;
    if (o2.direction) {
      const { point } = openingFrame(o2), width = o2.width / 2 + margin;
      obstacles.push(bounds([point(-width, -depth), point(width, -depth), point(width, depth), point(-width, depth)]));
      continue;
    }
    obstacles.push(o2.axis === "x" ? { x: o2.at[0] - o2.width / 2 - margin, y: o2.at[1] - depth, w: o2.width + margin * 2, h: depth * 2 } : { x: o2.at[0] - depth, y: o2.at[1] - o2.width / 2 - margin, w: depth * 2, h: o2.width + margin * 2 });
  }
  for (const hall of plan.rooms.filter((r2) => r2.program === "hall")) {
    const x2 = hall.x + hall.w / 2;
    for (const room of plan.rooms.filter((r2) => r2.program === "office" || r2.program === "shop")) {
      const below = pointInPoly(room.points, x2, hall.y - 1);
      const above = pointInPoly(room.points, x2, hall.y + hall.h + 1);
      if (!below && !above) continue;
      const y2 = below ? room.y : hall.y + hall.h;
      const end = below ? hall.y : room.y + room.h;
      if (end > y2) obstacles.push({ x: x2 - FIXTURES.aisleMm / 2, y: y2, w: FIXTURES.aisleMm, h: end - y2 });
    }
  }
  return obstacles;
}
function place(r2, wantX, wantY, w2, h2, obs, yRange = 0) {
  const lo = r2.x + C2;
  const hi = r2.x + r2.w - C2 - w2;
  if (hi < lo) return void 0;
  const clamp = (x2) => Math.min(hi, Math.max(lo, x2));
  const dir = yRange < 0 ? -1 : 1;
  for (let dy = 0; dy <= Math.abs(yRange); dy += 200) {
    const y2 = wantY + dir * dy;
    for (let dx = 0; dx <= r2.w; dx += 100) {
      for (const x2 of dx === 0 ? [clamp(wantX)] : [clamp(wantX - dx), clamp(wantX + dx)]) {
        if (insideRoom(r2, x2, y2, w2, h2, obs)) return [x2, y2];
      }
    }
  }
  return void 0;
}
function gridSpots(r2, unitW, unitD, pitchX, pitchY, yFrom, yTo, max, obs) {
  const out = [];
  const xEnd = r2.x + r2.w - C2;
  for (let y2 = yFrom; y2 + unitD <= yTo && out.length < max; y2 += pitchY) {
    for (let x2 = r2.x + C2; x2 + unitW <= xEnd && out.length < max; x2 += pitchX) {
      if (insideRoom(r2, x2, y2, unitW, unitD, obs)) out.push([x2, y2]);
    }
  }
  return out;
}
var MAX_UNITS = 40;
function officeDesks(r2, obs) {
  const { wMm, dMm } = FIXTURES.desk;
  const cr = FIXTURES.chairRMm;
  const seat = dMm + cr * 2 + 100;
  const shared = [];
  const keepOut = [...obs];
  if (roomAreaM2(r2) >= 60) {
    const table = FIXTURES.diningTable;
    const apron = cr * 2 + 100;
    const depth = table.dMm + apron * 2;
    const spot = place(r2, r2.x + C2, r2.y + r2.h - C2 - depth, table.wMm, depth, obs, -r2.h / 2);
    if (spot) {
      const [x2, y2] = spot;
      shared.push(rect2(x2, y2 + apron, table.wMm, table.dMm));
      for (const dx of [table.wMm / 4, table.wMm * 3 / 4]) {
        shared.push(circle([x2 + dx, y2 + cr], cr), circle([x2 + dx, y2 + depth - cr], cr));
      }
      keepOut.push({
        x: x2 - FIXTURES.aisleMm / 2,
        y: y2 - FIXTURES.aisleMm / 2,
        w: table.wMm + FIXTURES.aisleMm,
        h: depth + FIXTURES.aisleMm
      });
    }
  }
  const spots = gridSpots(
    r2,
    wMm,
    seat,
    wMm + 600,
    seat + FIXTURES.aisleMm,
    r2.y + C2,
    r2.y + r2.h - C2,
    MAX_UNITS,
    keepOut
  );
  return shared.concat(spots.flatMap(([x2, y2]) => [
    rect2(x2, y2, wMm, dMm),
    line([x2 + 200, y2 + dMm], [x2 + wMm - 200, y2 + dMm]),
    // 상판 앞선 — 책상으로 읽히게
    circle([x2 + wMm / 2, y2 + dMm + cr + 100], cr)
  ]));
}
function shopFixtures(r2, obs) {
  const out = [];
  const cnt = FIXTURES.shopCounter;
  const counterY = r2.y + r2.h - C2 - cnt.dMm;
  let shelfTo = r2.y + r2.h - C2;
  if (insideRoom(r2, r2.x + C2, counterY, cnt.wMm, cnt.dMm, obs)) {
    out.push(
      rect2(r2.x + C2, counterY, cnt.wMm, cnt.dMm),
      line([r2.x + C2, counterY + cnt.dMm - 150], [r2.x + C2 + cnt.wMm, counterY + cnt.dMm - 150])
    );
    shelfTo = counterY - FIXTURES.aisleMm;
  }
  const unitW = 2400;
  const d2 = FIXTURES.shelf.dMm;
  const spots = gridSpots(r2, unitW, d2, unitW + 200, d2 + FIXTURES.aisleMm, r2.y + C2, shelfTo, MAX_UNITS, obs);
  for (const [x2, y2] of spots) {
    out.push(rect2(x2, y2, unitW, d2), line([x2, y2 + d2 / 2], [x2 + unitW, y2 + d2 / 2]));
  }
  return out;
}
function classroom(r2, obs) {
  const out = [];
  const l2 = FIXTURES.lectern;
  let yFrom = r2.y + C2;
  const lx = r2.x + (r2.w - l2.wMm) / 2;
  if (insideRoom(r2, lx, yFrom, l2.wMm, l2.dMm, obs)) {
    out.push(rect2(lx, yFrom, l2.wMm, l2.dMm));
    yFrom += l2.dMm + FIXTURES.aisleMm;
  }
  const cd = FIXTURES.classDesk;
  const cr = FIXTURES.chairRMm;
  const seat = cd.dMm + cr * 2 + 100;
  const spots = gridSpots(
    r2,
    cd.wMm,
    seat,
    cd.wMm + 400,
    seat + 700,
    yFrom,
    r2.y + r2.h - C2,
    MAX_UNITS,
    obs
  );
  return out.concat(
    spots.flatMap(([x2, y2]) => [
      rect2(x2, y2, cd.wMm, cd.dMm),
      circle([x2 + cd.wMm / 2, y2 + cd.dMm + cr + 100], cr)
    ])
  );
}
function fixturesFor(r2, obs = [], builtInOnly = false) {
  if (r2.fixedFixtures !== void 0) return r2.fixedFixtures.map((s2) => s2.kind === "rect" ? { ...s2 } : s2.kind === "circle" ? { ...s2, c: [...s2.c] } : { ...s2, a: [...s2.a], b: [...s2.b] });
  const fits = (w2, d2) => r2.w >= w2 + C2 * 2 && r2.h >= d2 + C2 * 2;
  const name = r2.name;
  if (r2.program === "wet") {
    if (r2.fixtureProfile === "laundry" || /다용도실|세탁실/.test(name)) {
      const size = 700, x2 = r2.x + C2, y3 = r2.y + C2;
      if (!fits(size, size)) return [];
      return [
        rect2(x2, y3, size, size),
        { kind: "circle", c: [x2 + size / 2, y3 + size / 2], r: size * 0.32 },
        { kind: "line", a: [x2, y3 + size - 100], b: [x2 + size, y3 + size - 100] }
      ];
    }
    const out2 = [];
    const isBath = name.includes("\uC695\uC2E4") && r2.fixtureProfile !== "shower-room";
    const t3 = FIXTURES.toilet;
    const l2 = FIXTURES.lavatory;
    let usedX = r2.x + C2;
    let freeTop = r2.y + r2.h - C2;
    if (isBath) {
      const bw = Math.min(FIXTURES.bathtub.wMm, r2.w - C2 * 2);
      if (fits(bw, FIXTURES.bathtub.dMm + t3.dMm + C2)) {
        out2.push(...bathtub(r2.x + C2, r2.y + r2.h - C2 - FIXTURES.bathtub.dMm, bw, FIXTURES.bathtub.dMm));
        freeTop = r2.y + r2.h - C2 - FIXTURES.bathtub.dMm - C2;
      }
    }
    if (fits(t3.wMm, t3.dMm)) {
      out2.push(...toilet(usedX, r2.y + C2));
      usedX += t3.wMm + C2;
    }
    if (usedX + l2.wMm + C2 <= r2.x + r2.w && r2.h >= l2.dMm + C2 * 2) {
      out2.push(...lavatory(usedX, r2.y + C2));
    } else if (r2.w >= l2.wMm + C2 * 2 && r2.y + C2 + t3.dMm + C2 + l2.dMm <= freeTop) {
      out2.push(...lavatory(r2.x + C2, r2.y + C2 + t3.dMm + C2));
    }
    return out2;
  }
  if (r2.program === "office") return builtInOnly ? [] : officeDesks(r2, obs);
  if (r2.program === "shop") return builtInOnly ? [] : shopFixtures(r2, obs);
  if (r2.program === "edu") return builtInOnly ? [] : classroom(r2, obs);
  if (r2.program !== "residential") return [];
  if (name.includes("\uC548\uBC29") || name.includes("\uCE68\uC2E4")) {
    if (builtInOnly) return [];
    const b2 = name.includes("\uC548\uBC29") ? FIXTURES.bedDouble : FIXTURES.bedSingle;
    if (!fits(b2.wMm, b2.dMm)) return [];
    const spot = place(r2, r2.x + C2, r2.y + r2.h - C2 - b2.dMm, b2.wMm, b2.dMm, obs);
    return spot === void 0 ? [] : bed(spot[0], spot[1], b2.wMm, b2.dMm);
  }
  const hasKitchen = name.includes("\uC8FC\uBC29") || name.includes("\uC2DD\uB2F9");
  const hasLiving = name.includes("\uAC70\uC2E4");
  if (!hasKitchen && !hasLiving) return [];
  const out = [];
  let y2 = r2.y + C2;
  if (hasKitchen) {
    const cd = FIXTURES.counter.dMm;
    const cw = Math.min(FIXTURES.counter.maxWMm, r2.w - C2 * 2);
    if (cw > 900 && r2.y + r2.h - y2 >= cd + C2) {
      const preferredY = r2.counterEdge === "maxY" ? r2.y + r2.h - C2 - cd : y2;
      const spot = place(r2, r2.x + C2, preferredY, cw, cd, obs);
      if (spot) {
        out.push(...counter(spot[0], spot[1], cw));
        y2 = spot[1] + cd + C2;
      }
    }
  }
  if (builtInOnly) return out;
  if (hasLiving) {
    const sd = FIXTURES.sofa.dMm;
    const sw = Math.min(FIXTURES.sofa.wMm, r2.w - C2 * 2);
    if (sw > 1100 && r2.y + r2.h - y2 >= sd + C2) {
      const spot = place(r2, r2.x + (r2.w - sw) / 2, y2, sw, sd, obs, r2.y + r2.h - C2 - sd - y2);
      if (spot) {
        out.push(...sofa(spot[0], spot[1], sw));
        y2 = spot[1] + sd + C2;
      }
    }
  }
  const t2 = hasKitchen ? FIXTURES.diningTable : FIXTURES.coffeeTable;
  if (r2.y + r2.h - y2 >= t2.dMm + C2 && r2.w >= t2.wMm + C2 * 2) {
    const ty = r2.y + r2.h - C2 - t2.dMm;
    const spot = place(r2, r2.x + (r2.w - t2.wMm) / 2, ty, t2.wMm, t2.dMm, obs, y2 - ty);
    if (spot) out.push(rect2(spot[0], spot[1], t2.wMm, t2.dMm));
  }
  return out;
}

// vendor/plan/furnitureLabel.ts
function furnitureLabelPoint(room, shapes, width, above, below) {
  const preferred = roomLabelPoint(room);
  const boxes = shapes.map((s2) => s2.kind === "rect" ? { x: s2.x, y: s2.y, w: s2.w, h: s2.h } : s2.kind === "circle" ? { x: s2.c[0] - s2.r, y: s2.c[1] - s2.r, w: s2.r * 2, h: s2.r * 2 } : { x: Math.min(s2.a[0], s2.b[0]), y: Math.min(s2.a[1], s2.b[1]), w: Math.abs(s2.b[0] - s2.a[0]), h: Math.abs(s2.b[1] - s2.a[1]) });
  const clear = ([x2, y2]) => {
    const left = x2 - width / 2, right = x2 + width / 2, bottom = y2 - below, top = y2 + above;
    if (![left, x2, right].every((px) => [bottom, y2, top].every((py) => pointInPoly(room.points, px, py)))) return false;
    return !boxes.some((b2) => b2.x - 80 < right && b2.x + b2.w + 80 > left && b2.y - 80 < top && b2.y + b2.h + 80 > bottom);
  };
  if (clear(preferred)) return preferred;
  const candidates = [];
  for (let y2 = room.y + below + 100; y2 <= room.y + room.h - above - 100; y2 += 200)
    for (let x2 = room.x + width / 2 + 100; x2 <= room.x + room.w - width / 2 - 100; x2 += 200) candidates.push([x2, y2]);
  candidates.sort((a2, b2) => (a2[0] - preferred[0]) ** 2 + (a2[1] - preferred[1]) ** 2 - ((b2[0] - preferred[0]) ** 2 + (b2[1] - preferred[1]) ** 2));
  return candidates.find(clear);
}

// vendor/plan/scale.ts
function textWidth(s2, fs) {
  return [...s2].reduce((w2, c2) => w2 + (c2.charCodeAt(0) > 11904 ? fs : fs * 0.6), 0);
}

// vendor/plan/stairAnnotation.ts
function stairAnnotation(run, ground = false) {
  const positiveY = run.direction === "up" !== !!run.landingAtFar;
  const near = run.y + run.h * 0.15;
  const far = run.y + run.h * 0.85;
  return {
    x: run.x + run.w / 2,
    fromY: positiveY ? near : far,
    toY: positiveY ? far : near,
    labelY: run.y + run.h * 0.22,
    label: ground || run.direction === "up" ? "UP" : "DN"
  };
}

// vendor/plan/wallOpenings.ts
function wallPieces(wall, openings) {
  const horizontal = Math.abs(wall.a[1] - wall.b[1]) < 1e-6;
  const vertical = Math.abs(wall.a[0] - wall.b[0]) < 1e-6;
  if (!horizontal && !vertical || openings.some((o2) => o2.direction)) {
    const dx = wall.b[0] - wall.a[0], dy = wall.b[1] - wall.a[1], length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length === 0) return [];
    const ux = dx / length, uy = dy / length;
    const cuts2 = [];
    for (const o2 of openings) {
      const { tangent } = openingFrame(o2);
      if (Math.abs(ux * tangent[1] - uy * tangent[0]) > 1e-6 || o2.width <= 0) continue;
      const rx = o2.at[0] - wall.a[0], ry = o2.at[1] - wall.a[1];
      if (Math.abs(rx * uy - ry * ux) >= 1) continue;
      const along2 = rx * ux + ry * uy;
      const a2 = Math.max(0, along2 - o2.width / 2), b2 = Math.min(length, along2 + o2.width / 2);
      if (b2 > a2) cuts2.push([a2, b2]);
    }
    cuts2.sort((a2, b2) => a2[0] - b2[0]);
    const out2 = [];
    const add2 = (a2, b2) => {
      if (b2 - a2 > 1e-6) out2.push({ ...wall, a: [wall.a[0] + a2 * ux, wall.a[1] + a2 * uy], b: [wall.a[0] + b2 * ux, wall.a[1] + b2 * uy] });
    };
    let cursor2 = 0;
    for (const [a2, b2] of cuts2) {
      add2(cursor2, a2);
      cursor2 = Math.max(cursor2, b2);
    }
    add2(cursor2, length);
    return out2;
  }
  const along = horizontal ? 0 : 1, across = horizontal ? 1 : 0;
  const lo = Math.min(wall.a[along], wall.b[along]);
  const hi = Math.max(wall.a[along], wall.b[along]);
  const cuts = openings.filter((o2) => o2.axis === (horizontal ? "x" : "y") && Math.abs(o2.at[across] - wall.a[across]) < 1 && o2.width > 0).map((o2) => [Math.max(lo, o2.at[along] - o2.width / 2), Math.min(hi, o2.at[along] + o2.width / 2)]).filter(([a2, b2]) => b2 > a2).sort((a2, b2) => a2[0] - b2[0]);
  const out = [];
  const add = (a2, b2) => {
    if (b2 - a2 < 1e-6) return;
    const p2 = [...wall.a], q2 = [...wall.a];
    p2[along] = a2;
    q2[along] = b2;
    out.push({ ...wall, a: p2, b: q2 });
  };
  let cursor = lo;
  for (const [a2, b2] of cuts) {
    add(cursor, a2);
    cursor = Math.max(cursor, b2);
  }
  add(cursor, hi);
  return out;
}

// vendor/plan/symbols.ts
var import_makerjs = __toESM(require_dist(), 1);
function doorSwingModel(hinge, radius, startDeg, endDeg) {
  const leafEnd = import_makerjs.default.point.add(hinge, import_makerjs.default.point.fromPolar(import_makerjs.default.angle.toRadians(startDeg), radius));
  return {
    paths: {
      trace: new import_makerjs.default.paths.Arc(hinge, radius, startDeg, endDeg),
      leaf: new import_makerjs.default.paths.Line(hinge, leafEnd)
    }
  };
}
function symbolPrims(model) {
  const out = [];
  const roleOf = (id) => id === "leaf" || id === "trace" ? id : "outline";
  import_makerjs.default.model.walk(model, {
    onPath: (wp) => {
      const p2 = wp.pathContext;
      const off = wp.offset ?? [0, 0];
      const o2 = (q2) => [q2[0] + off[0], q2[1] + off[1]];
      const role = roleOf(wp.pathId);
      if (import_makerjs.default.isPathLine(p2)) {
        const l2 = p2;
        out.push({ kind: "line", a: o2(l2.origin), b: o2(l2.end), role });
      } else if (import_makerjs.default.isPathArc(p2)) {
        const a2 = p2;
        out.push({ kind: "arc", c: o2(a2.origin), r: a2.radius, startDeg: a2.startAngle, endDeg: a2.endAngle, role });
      } else if (import_makerjs.default.isPathCircle(p2)) {
        const c2 = p2;
        out.push({ kind: "circle", c: o2(c2.origin), r: c2.radius, role });
      }
    }
  });
  return out;
}

// vendor/plan/planSection.ts
var SLAB_MM = 200;
var PARAPET_MM = 1200;
function buildSection(b2) {
  const slabMm = b2.slabMm ?? SLAB_MM;
  const parapetMm = b2.parapetMm ?? PARAPET_MM;
  const baseDepthMm = b2.floors.reduce((m2, f2) => Math.max(m2, f2.depthMm ?? b2.depthMm), b2.depthMm);
  const floors = [];
  let fl = 0;
  for (const f2 of b2.floors) {
    const heightMm = f2.heightMm ?? 3200;
    floors.push({
      label: f2.label,
      useLabel: f2.useLabel,
      flMm: fl,
      heightMm,
      piloti: f2.archetype === "piloti",
      pilotiDepthMm: f2.archetype === "piloti" ? f2.pilotiDepthMm ?? 0 : 0,
      backInsetMm: baseDepthMm - (f2.depthMm ?? b2.depthMm)
    });
    fl += heightMm;
  }
  const coreD = b2.core.depthMm;
  const stairZone = b2.coreAtRoad ? [baseDepthMm - coreD, baseDepthMm] : [0, coreD];
  const landingMm = b2.core.landingMm;
  const runMm = Math.max(0, coreD - landingMm);
  return {
    depthMm: baseDepthMm,
    floors,
    slabMm,
    parapetMm,
    stairZone,
    stair: { runMm, landingMm, treadsPerRun: b2.core.treadsPerRun, landingAtFar: !!b2.coreAtRoad },
    totalHeightMm: fl + parapetMm,
    notes: [
      "\uAE30\uCD08\xB7\uC9C0\uC815, \uCC98\uB9C8\xB7\uD648\uD1B5, \uB2E8\uC5F4\xB7\uBC29\uC218 \uB450\uAED8\uB294 \uADF8\uB9AC\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4 \u2014 \uAD6C\uC870\xB7\uB9C8\uAC10 \uC124\uACC4\uC5D0\uC11C \uC815\uD569\uB2C8\uB2E4.",
      "\uC625\uC0C1\uC73C\uB85C \uB098\uAC00\uB294 \uC625\uD0D1(\uACC4\uB2E8\uC2E4)\uC740 \uADF8\uB9AC\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4 \u2014 \uBA74\uC801 \uC0B0\uC785 \uC5EC\uBD80\uAC00 \uADDC\uBAA8\xB7\uD615\uD0DC\uC5D0 \uB530\uB77C \uAC08\uB9BD\uB2C8\uB2E4.",
      "\uB2E8\uBA74\uC758 \uCC3D \uB192\uC774(\uCC3D\uB300 900\xB7\uC0C1\uB2E8 2,100)\uB294 \uACC4\uD68D\uAC12\uC785\uB2C8\uB2E4 \u2014 \uCC3D\uD638 \uC0C1\uC138\uB294 \uC124\uACC4\uC5D0\uC11C \uC815\uD569\uB2C8\uB2E4.",
      "\uC9C0\uBC18\uC120(GL)\uC740 \uB300\uC9C0\uAC00 \uD3C9\uD0C4\uD558\uB2E4\uACE0 \uBCF4\uACE0 \uADF8\uB9B0 \uC120\uC785\uB2C8\uB2E4.",
      ...floors.some((f2) => f2.backInsetMm > 0) ? ["\uB2E8\uCC28\uB85C \uB4DC\uB7EC\uB09C \uC800\uCE35 \uC9C0\uBD95\uC740 \uC774\uC6A9 \uD14C\uB77C\uC2A4\uB85C \uACC4\uD68D\uD558\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4. \uCD9C\uC785\xB7\uB09C\uAC04\xB7\uC9C0\uBD95 \uAC00\uC7A5\uC790\uB9AC\uC640 \uC77C\uC870 \uC801\uD569\uC131\uC740 \uBCC4\uB3C4 \uC124\uACC4\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4."] : []
    ]
  };
}
function sectionStairLines(sec, floor) {
  const [near, far] = sec.stairZone;
  const turn = near + sec.stair.landingMm;
  const reflect = (x2) => sec.stair.landingAtFar ? near + far - x2 : x2;
  const n = Math.max(1, sec.stair.treadsPerRun);
  const dx = (far - turn) / n, dy = floor.heightMm / 2 / n;
  const lines = [];
  const add = (x1, y1, x2, y2, kind) => lines.push({ a: [reflect(x1), y1], b: [reflect(x2), y2], kind });
  for (let i = 0; i < n; i++) {
    const x2 = far - i * dx, y2 = floor.flMm + i * dy;
    add(x2, y2, x2, y2 + dy, "flight");
    add(x2, y2 + dy, x2 - dx, y2 + dy, "flight");
  }
  const half = floor.flMm + floor.heightMm / 2;
  add(turn, half, near, half, "landing");
  add(turn, half, far, floor.flMm + floor.heightMm, "return");
  return lines;
}

// vendor/plan/planDxf.ts
var LAYERS = [
  { name: "\uB300\uC9C0-\uC9C0\uC801", color: ACI.red },
  { name: "\uB300\uC9C0-\uACBD\uACC4\uACF5\uC720", color: ACI.magenta, lineType: "DASHED" },
  { name: "\uAC74\uBB3C-\uC678\uACFD", color: ACI.yellow },
  { name: "\uBCBD-\uC678\uBCBD", color: ACI.white },
  { name: "\uBCBD-\uB0B4\uBCBD", color: ACI.white },
  { name: "\uBCBD-\uC138\uB300\uACBD\uACC4", color: ACI.white },
  { name: "\uCC3D\uD638", color: ACI.cyan },
  { name: "\uCC3D\uD638-\uAE30\uD638", color: ACI.cyan },
  { name: "\uBB38", color: ACI.green },
  { name: "\uACC4\uB2E8", color: ACI.grey },
  { name: "\uAE30\uB465", color: ACI.white },
  { name: "\uD1B5\uC2EC\uC120", color: ACI.lightGrey, lineType: "CENTER" },
  { name: "\uCE58\uC218", color: ACI.lightGrey },
  // 실 외곽선과 실명 글자는 레이어를 나눈다. 한 레이어에 섞여 있으면 CAD에서
  // 글자만 끄거나 선만 굵게 하는 흔한 조작이 안 된다.
  { name: "\uC2E4-\uC678\uACFD", color: ACI.lightGrey },
  { name: "\uC2E4\uBA85", color: ACI.white },
  { name: "\uD45C\uC81C", color: ACI.yellow },
  { name: "\uD45C\uC81C-\uD2C0", color: ACI.lightGrey },
  { name: "\uC678\uBD80", color: ACI.grey },
  // 가구·위생기구는 따로 둔다 — 사장님이 CAD에서 이 레이어만 끄고 본인 것을 그린다.
  { name: "\uAC00\uAD6C", color: ACI.grey },
  // 주차구획도 따로 둔다 — 배치도의 같은 이름 레이어와 짝이 맞아야 CAD에서 함께 다룬다.
  { name: "\uC8FC\uCC28", color: ACI.cyan },
  // 단면의 지반선 — 평면에는 없는 선이라 레이어를 따로 둔다
  { name: "\uC9C0\uBC18", color: ACI.grey },
  // 절단선·입면 기호 — CAD에서 선형(일점쇄선)을 입히거나 통째로 끄는 조작 단위
  { name: "\uCC38\uC870\uAE30\uD638", color: ACI.yellow }
];
var TXT = { room: 300, area: 230, small: 200, title: 450, grid: 250 };
function drawWall(d2, w2) {
  const layer = w2.kind === "exterior" ? "\uBCBD-\uC678\uBCBD" : w2.kind === "party" ? "\uBCBD-\uC138\uB300\uACBD\uACC4" : "\uBCBD-\uB0B4\uBCBD";
  const h2 = w2.thickness / 2;
  const horizontal = Math.abs(w2.a[1] - w2.b[1]) < 1e-6;
  const x2 = Math.min(w2.a[0], w2.b[0]);
  const y2 = Math.min(w2.a[1], w2.b[1]);
  if (horizontal) {
    d2.solidRect(layer, x2, y2 - h2, Math.abs(w2.b[0] - w2.a[0]), w2.thickness);
    d2.rect(layer, x2, y2 - h2, Math.abs(w2.b[0] - w2.a[0]), w2.thickness);
  } else {
    d2.solidRect(layer, x2 - h2, y2, w2.thickness, Math.abs(w2.b[1] - w2.a[1]));
    d2.rect(layer, x2 - h2, y2, w2.thickness, Math.abs(w2.b[1] - w2.a[1]));
  }
}
function drawOpening(d2, o2) {
  const half = o2.width / 2;
  if (o2.kind === "window") {
    const layer2 = "\uCC3D\uD638";
    for (const offset of [-100, 0, 100]) {
      if (o2.axis === "x") {
        d2.line(layer2, [o2.at[0] - half, o2.at[1] + offset], [o2.at[0] + half, o2.at[1] + offset]);
      } else {
        d2.line(layer2, [o2.at[0] + offset, o2.at[1] - half], [o2.at[0] + offset, o2.at[1] + half]);
      }
    }
    return;
  }
  const layer = o2.kind === "entrance" ? "\uCC3D\uD638" : "\uBB38";
  if (o2.axis === "x") {
    d2.line(layer, [o2.at[0] - half, o2.at[1]], [o2.at[0] + half, o2.at[1]]);
  } else {
    d2.line(layer, [o2.at[0], o2.at[1] - half], [o2.at[0], o2.at[1] + half]);
  }
  if (o2.swing) {
    for (const pr of symbolPrims(doorSwingModel(o2.swing.hinge, o2.swing.radius, o2.swing.startDeg, o2.swing.endDeg))) {
      if (pr.kind === "arc") d2.arc("\uBB38", pr.c, pr.r, pr.startDeg, pr.endDeg);
      else if (pr.kind === "line") d2.line("\uBB38", pr.a, pr.b);
      else d2.circle("\uBB38", pr.c, pr.r);
    }
  }
}
function drawRoomLabel(d2, r2, shapes = []) {
  const width = Math.max(textWidth(r2.name, TXT.room), textWidth(`${roomAreaM2(r2).toFixed(1)}\u33A1`, TXT.area)) + 100;
  const [cx, cy] = (shapes.length ? furnitureLabelPoint(r2, shapes, width, TXT.room + 60, TXT.room * 1.35 + 60) : void 0) || roomLabelPoint(r2);
  d2.text("\uC2E4\uBA85", [cx, cy], TXT.room, r2.name, "center");
  if (r2.program !== "outdoor" && roomAreaM2(r2) > 3) {
    d2.text("\uC2E4\uBA85", [cx, cy - TXT.room * 1.35], TXT.area, `${roomAreaM2(r2).toFixed(1)}\u33A1`, "center");
  }
}
function drawStairs(d2, p2) {
  for (const s2 of p2.stairs) {
    if (s2.landingMm && s2.landingMm > 0) {
      const ly = s2.landingAtFar ? s2.y + s2.h : s2.y - s2.landingMm;
      d2.rect("\uACC4\uB2E8", s2.x, ly, s2.w, s2.landingMm);
    }
    const boards = Math.max(1, s2.treads - 1);
    const step = s2.h / boards;
    for (let i = 1; i < boards; i++) {
      d2.line("\uACC4\uB2E8", [s2.x, s2.y + step * i], [s2.x + s2.w, s2.y + step * i]);
    }
    d2.rect("\uACC4\uB2E8", s2.x, s2.y, s2.w, s2.h);
    const a2 = stairAnnotation(s2, p2.ground);
    const tailY = a2.toY + Math.sign(a2.fromY - a2.toY) * 180;
    d2.line("\uACC4\uB2E8", [a2.x, a2.fromY], [a2.x, a2.toY]);
    d2.line("\uACC4\uB2E8", [a2.x - 95, tailY], [a2.x, a2.toY]);
    d2.line("\uACC4\uB2E8", [a2.x + 95, tailY], [a2.x, a2.toY]);
    d2.text("\uACC4\uB2E8", [a2.x, a2.labelY], Math.min(TXT.small, s2.w * 0.65 / 1.2), a2.label, "center");
  }
}
function drawGrid(d2, gridX, gridY, x0, y0, x1, y1) {
  const ext = 2100;
  gridX.forEach((x2, i) => {
    d2.line("\uD1B5\uC2EC\uC120", [x2, y0 - ext], [x2, y1 + ext]);
    d2.circle("\uD1B5\uC2EC\uC120", [x2, y0 - ext], 380);
    d2.text("\uD1B5\uC2EC\uC120", [x2, y0 - ext - TXT.grid / 2], TXT.grid, `X${i + 1}`, "center");
  });
  gridY.forEach((y2, i) => {
    d2.line("\uD1B5\uC2EC\uC120", [x0 - ext, y2], [x1 + ext, y2]);
    d2.circle("\uD1B5\uC2EC\uC120", [x0 - ext, y2], 380);
    d2.text("\uD1B5\uC2EC\uC120", [x0 - ext, y2 - TXT.grid / 2], TXT.grid, `Y${i + 1}`, "center");
  });
}
function drawOutdoor(d2, r2) {
  d2.polyline("\uC678\uBD80", r2.points, true);
  const step = 700;
  for (let o2 = -r2.h; o2 < r2.w; o2 += step) {
    const x1 = Math.max(r2.x + o2, r2.x);
    const y1 = r2.y + Math.max(-o2, 0);
    const x2 = Math.min(r2.x + o2 + r2.h, r2.x + r2.w);
    const y2 = r2.y + (x2 - (r2.x + o2));
    if (x2 > x1) d2.line("\uC678\uBD80", [x1, y1], [x2, Math.min(y2, r2.y + r2.h)]);
  }
}
function drawFloor(d2, p2, ox, oy, sheetNo, openingTags = false) {
  const shift = (r2) => ({ ...r2, x: r2.x + ox, y: r2.y + oy });
  const sp = (p0) => [p0[0] + ox, p0[1] + oy];
  const shiftRoom = (r2) => ({ ...shift(r2), points: r2.points.map(sp) });
  const colObs = furnitureObstacles(p2, false).map((o2) => ({ ...o2, x: o2.x + ox, y: o2.y + oy }));
  const accessObs = furnitureObstacles(p2).map((o2) => ({ ...o2, x: o2.x + ox, y: o2.y + oy }));
  for (const r2 of p2.rooms) {
    const rr = shiftRoom(r2);
    if (r2.program === "outdoor") drawOutdoor(d2, rr);
    else d2.polyline("\uC2E4-\uC678\uACFD", rr.points, true);
    for (const s2 of fixturesFor(rr, ["office", "shop", "edu"].includes(r2.program) ? accessObs : colObs)) {
      if (s2.kind === "rect") d2.rect("\uAC00\uAD6C", s2.x, s2.y, s2.w, s2.h);
      else if (s2.kind === "circle") d2.circle("\uAC00\uAD6C", s2.c, s2.r);
      else d2.line("\uAC00\uAD6C", s2.a, s2.b);
    }
  }
  for (const s2 of p2.stalls) {
    d2.rect("\uC8FC\uCC28", s2.x + ox, s2.y + oy, s2.w, s2.h);
  }
  for (const w2 of p2.walls) {
    for (const piece of wallPieces(w2, p2.openings)) {
      drawWall(d2, { ...piece, a: sp(piece.a), b: sp(piece.b) });
    }
  }
  for (const o2 of p2.openings) {
    drawOpening(d2, {
      ...o2,
      at: sp(o2.at),
      swing: o2.swing ? { ...o2.swing, hinge: sp(o2.swing.hinge) } : void 0
    });
    if (openingTags && o2.typeId) {
      const x2 = ox + o2.at[0] + (o2.axis === "y" ? 350 : 0);
      const y2 = oy + o2.at[1] + (o2.axis === "x" ? 250 : 0);
      d2.text("\uCC3D\uD638-\uAE30\uD638", [x2, y2], 110, o2.typeId, "center");
    }
  }
  drawStairs(d2, { ...p2, stairs: p2.stairs.map((s2) => shift(s2)) });
  for (const c2 of p2.columns) {
    const [cx, cy] = sp(c2);
    const h2 = (p2.columnMm || 400) / 2;
    d2.solidRect("\uAE30\uB465", cx - h2, cy - h2, h2 * 2, h2 * 2);
  }
  for (const r2 of p2.rooms) {
    const shifted = shiftRoom(r2);
    drawRoomLabel(d2, shifted, ["office", "shop", "edu"].includes(r2.program) ? fixturesFor(shifted, accessObs) : []);
  }
  drawGrid(
    d2,
    p2.gridX.map((x2) => x2 + ox),
    p2.gridY.map((y2) => y2 + oy),
    ox,
    oy,
    ox + p2.widthMm,
    oy + p2.depthMm
  );
  drawDimsAt(d2, p2, ox, oy);
  for (const m2 of p2.sectionMarks ?? []) {
    d2.line("\uCC38\uC870\uAE30\uD638", sp(m2.a), sp(m2.b));
    const roadEnd = m2.a[1] >= m2.b[1] ? m2.a : m2.b;
    const uy = Math.sign(m2.b[1] - m2.a[1]) || 1;
    for (const end of [m2.a, m2.b]) {
      const out = end === roadEnd ? 1 : -1;
      const e2 = [end[0], end[1] + out * uy * 450];
      d2.line("\uCC38\uC870\uAE30\uD638", sp(end), sp(e2));
      const px = -m2.dir[1];
      const py = m2.dir[0];
      d2.polyline(
        "\uCC38\uC870\uAE30\uD638",
        [
          sp([e2[0] + px * 170, e2[1] + py * 170]),
          sp([e2[0] - px * 170, e2[1] - py * 170]),
          sp([e2[0] + m2.dir[0] * 470, e2[1] + m2.dir[1] * 470])
        ],
        true
      );
    }
    const c2 = sp([roadEnd[0] + 700, roadEnd[1] + 950]);
    d2.circle("\uCC38\uC870\uAE30\uD638", c2, 400);
    d2.line("\uCC38\uC870\uAE30\uD638", [c2[0] - 400, c2[1]], [c2[0] + 400, c2[1]]);
    d2.text("\uCC38\uC870\uAE30\uD638", [c2[0], c2[1] + 90], TXT.small, m2.label, "center");
    d2.text("\uCC38\uC870\uAE30\uD638", [c2[0], c2[1] - 260], 160, m2.sheetNo, "center");
    const oEnd = roadEnd === m2.a ? m2.b : m2.a;
    d2.text("\uCC38\uC870\uAE30\uD638", sp([oEnd[0] + m2.dir[0] * 900, oEnd[1] - uy * 450]), TXT.area, m2.label, "center");
  }
  for (const m2 of p2.elevationMarks ?? []) {
    const [dx, dy] = m2.dir;
    const xMin = p2.wingMm?.side === "left" ? -p2.wingMm.widthMm : 0;
    const xMax = p2.wingMm?.side === "right" ? p2.widthMm + p2.wingMm.widthMm : p2.widthMm;
    const cx = dy < 0 ? xMin + (xMax - xMin) * 0.15 : dy > 0 ? xMax + 900 : dx < 0 ? xMax + 900 : xMin - 900;
    const cy = dy < 0 ? p2.depthMm + 900 : dy > 0 ? -900 : dx > 0 ? -900 : p2.depthMm / 2;
    const c2 = sp([cx, cy]);
    d2.circle("\uCC38\uC870\uAE30\uD638", c2, 320);
    d2.text("\uCC38\uC870\uAE30\uD638", [c2[0], c2[1] - 80], 170, m2.sheetNo, "center");
    const px = -dy;
    const py = dx;
    d2.polyline(
      "\uCC38\uC870\uAE30\uD638",
      [
        [c2[0] + px * 190 + dx * 240, c2[1] + py * 190 + dy * 240],
        [c2[0] - px * 190 + dx * 240, c2[1] - py * 190 + dy * 240],
        [c2[0] + dx * 650, c2[1] + dy * 650]
      ],
      true
    );
  }
  d2.text("\uD45C\uC81C", [ox + p2.widthMm / 2, oy - 5600], TXT.title, `${sheetNo} ${p2.label} \uD3C9\uBA74\uB3C4`, "center");
  d2.text("\uD45C\uC81C", [ox + p2.widthMm / 2, oy - 6300], TXT.area, p2.useLabel, "center");
}
function drawSection(d2, sec, ox, oy, sheetNo) {
  const D2 = sec.depthMm;
  const X2 = (x2) => ox + x2;
  const Y2 = (y2) => oy + y2;
  d2.line("\uC9C0\uBC18", [X2(-2e3), Y2(0)], [X2(D2 + 2e3), Y2(0)]);
  for (let x2 = -2e3; x2 < D2 + 2e3; x2 += 700) {
    d2.line("\uC9C0\uBC18", [X2(x2), Y2(0)], [X2(x2 - 350), Y2(-350)]);
  }
  d2.text("\uC9C0\uBC18", [X2(D2 + 2e3), Y2(-800)], TXT.small, "G.L", "right");
  for (const [fi, f2] of sec.floors.entries()) {
    const yTop = f2.flMm + f2.heightMm;
    const x0 = Math.max(0, Math.min(f2.backInsetMm, D2));
    const below = fi > 0 ? sec.floors[fi - 1] : f2;
    const slabX = Math.min(x0, Math.max(0, Math.min(below.backInsetMm, D2)));
    d2.hatchRect("\uBCBD-\uC678\uBCBD", X2(slabX), Y2(f2.flMm - sec.slabMm), D2 - slabX, sec.slabMm, "ANSI31", 25);
    if (slabX < x0) d2.hatchRect("\uBCBD-\uC678\uBCBD", X2(slabX) - 100, Y2(f2.flMm), 200, sec.parapetMm, "ANSI31", 25);
    if (f2.piloti) {
      const open = Math.min(f2.pilotiDepthMm, D2 - x0);
      const wallAt = D2 - open;
      for (const x2 of [x0, wallAt]) d2.hatchRect("\uBCBD-\uC678\uBCBD", X2(x2) - 100, Y2(f2.flMm), 200, f2.heightMm, "ANSI31", 25);
      if (open > 0) {
        d2.solidRect("\uAE30\uB465", X2(D2) - 200, Y2(f2.flMm), 400, f2.heightMm);
        d2.text("\uC2E4\uBA85", [X2(wallAt + open / 2), Y2(f2.flMm + 600)], TXT.area, `\uD544\uB85C\uD2F0 ${(open / 1e3).toFixed(1)}m`, "center");
      }
    } else {
      for (const x2 of [x0, D2]) d2.hatchRect("\uBCBD-\uC678\uBCBD", X2(x2) - 100, Y2(f2.flMm), 200, f2.heightMm, "ANSI31", 25);
    }
    d2.text("\uC2E4\uBA85", [X2(0) - 500, Y2(f2.flMm + 250)], TXT.area, `${f2.label}  FL +${(f2.flMm / 1e3).toFixed(2)}`, "right");
    dimRun(d2, [X2(D2) + 1200, Y2(f2.flMm)], [X2(D2) + 1200, Y2(yTop)], f2.heightMm.toLocaleString(), true);
    for (const line2 of sectionStairLines(sec, f2)) {
      d2.line("\uACC4\uB2E8", [X2(line2.a[0]), Y2(line2.a[1])], [X2(line2.b[0]), Y2(line2.b[1])]);
    }
  }
  const roof = sec.floors[sec.floors.length - 1];
  if (roof) {
    const rY = roof.flMm + roof.heightMm;
    const rx0 = Math.max(0, Math.min(roof.backInsetMm, D2));
    d2.hatchRect("\uBCBD-\uC678\uBCBD", X2(rx0), Y2(rY - sec.slabMm), D2 - rx0, sec.slabMm, "ANSI31", 25);
    for (const x2 of [rx0, D2]) {
      d2.hatchRect("\uBCBD-\uC678\uBCBD", X2(x2) - 100, Y2(rY), 200, sec.parapetMm, "ANSI31", 25);
    }
    d2.text("\uC2E4\uBA85", [X2(0) - 500, Y2(rY + 250)], TXT.area, `\uC9C0\uBD95  FL +${(rY / 1e3).toFixed(2)}`, "right");
  }
  d2.text("\uD45C\uC81C", [X2(D2 / 2), Y2(-3e3)], TXT.title, `${sheetNo} \uC8FC\uB2E8\uBA74\uB3C4`, "center");
  d2.text("\uD45C\uC81C", [X2(D2 / 2), Y2(-3800)], TXT.area, "\uACC4\uB2E8\uC2E4\uC744 \uC790\uB978 \uBA74 \xB7 \uB3C4\uB85C\uBCC0\uC740 \uC624\uB978\uCABD", "center");
}
function drawElevation(d2, ep, ox, oy, sheetNo) {
  const W2 = ep.widthMm;
  const X2 = (x2) => ox + x2;
  const Y2 = (z2) => oy + z2;
  d2.line("\uC9C0\uBC18", [X2(-2e3), Y2(0)], [X2(W2 + 2e3), Y2(0)]);
  for (let x2 = -2e3; x2 < W2 + 2e3; x2 += 700) {
    d2.line("\uC9C0\uBC18", [X2(x2), Y2(0)], [X2(x2 - 350), Y2(-350)]);
  }
  d2.text("\uC9C0\uBC18", [X2(W2 + 2e3), Y2(-800)], TXT.small, "G.L", "right");
  for (const b2 of ep.bands) d2.rect("\uBCBD-\uC678\uBCBD", X2(b2.x0), Y2(b2.z0), b2.x1 - b2.x0, b2.z1 - b2.z0);
  for (const r2 of ep.parapets) d2.rect("\uBCBD-\uC678\uBCBD", X2(r2.x0), Y2(r2.z0), r2.x1 - r2.x0, r2.z1 - r2.z0);
  for (const c2 of ep.columns) d2.solidRect("\uAE30\uB465", X2(c2.x0), Y2(c2.z0), c2.x1 - c2.x0, c2.z1 - c2.z0);
  for (const o2 of ep.openings) {
    const layer = o2.kind === "window" ? "\uCC3D\uD638" : "\uBB38";
    d2.rect(layer, X2(o2.x0), Y2(o2.z0), o2.x1 - o2.x0, o2.z1 - o2.z0);
    if (o2.kind === "window") {
      d2.line(layer, [X2((o2.x0 + o2.x1) / 2), Y2(o2.z0)], [X2((o2.x0 + o2.x1) / 2), Y2(o2.z1)]);
    }
    if (o2.typeId) {
      d2.text(layer, [X2((o2.x0 + o2.x1) / 2), Y2((o2.z0 + o2.z1) / 2 - TXT.small / 2)], TXT.small, o2.typeId, "center");
    }
  }
  for (const lv of ep.levels) {
    d2.text("\uC2E4\uBA85", [X2(0) - 500, Y2(lv.z + 250)], TXT.area, lv.label, "right");
  }
  dimRun(d2, [X2(W2) + 1200, Y2(0)], [X2(W2) + 1200, Y2(ep.totalHeightMm)], ep.totalHeightMm.toLocaleString(), true);
  d2.text("\uD45C\uC81C", [X2(W2 / 2), Y2(-3e3)], TXT.title, `${sheetNo} ${ep.title}`, "center");
  if (ep.dir === "left") d2.text("\uD45C\uC81C", [X2(W2 / 2), Y2(-3800)], TXT.area, "\uB3C4\uB85C\uBCC0\uC740 \uC624\uB978\uCABD", "center");
  if (ep.dir === "right") d2.text("\uD45C\uC81C", [X2(W2 / 2), Y2(-3800)], TXT.area, "\uB3C4\uB85C\uBCC0\uC740 \uC67C\uCABD", "center");
}
function drawOpeningTable(d2, x2, y2, rows) {
  const cols = [3e3, 10500, 9e3, 3500, 1e4];
  const rowH = 1300;
  const total = cols.reduce((s2, c2) => s2 + c2, 0);
  const cells = [
    ["\uBD80\uD638", "\uAD6C\uBD84", "\uADDC\uACA9(\u339C)", "\uAC1C\uC218", "\uB098\uC624\uB294 \uCE35"],
    ...rows.map((r2) => [
      r2.typeId,
      r2.kindLabel,
      `${r2.widthMm.toLocaleString()}\xD7${(r2.headMm - r2.sillMm).toLocaleString()}` + (r2.sillMm > 0 ? ` (\uCC3D\uB300 ${r2.sillMm.toLocaleString()})` : ""),
      String(r2.count),
      r2.floors
    ])
  ];
  const h2 = rowH * cells.length;
  d2.text("\uD45C\uC81C", [x2, y2 + 500], TXT.title, `${openingScheduleSheet().no} \uCC3D\uD638\uC77C\uB78C\uD45C`, "left");
  d2.rect("\uD45C\uC81C-\uD2C0", x2, y2 - h2, total, h2);
  let cx = x2;
  for (const c2 of cols.slice(0, -1)) {
    cx += c2;
    d2.line("\uD45C\uC81C-\uD2C0", [cx, y2 - h2], [cx, y2]);
  }
  cells.forEach((r2, i) => {
    const top = y2 - rowH * i;
    if (i > 0) d2.line("\uD45C\uC81C-\uD2C0", [x2, top], [x2 + total, top]);
    let colX = x2;
    r2.forEach((cell, j2) => {
      d2.text("\uD45C\uC81C", [colX + 500, top - rowH / 2 - TXT.area / 2], TXT.area, cell, "left");
      colX += cols[j2];
    });
  });
  d2.text(
    "\uD45C\uC81C",
    [x2, y2 - h2 - 900],
    TXT.small,
    "\uCC3D\uB300 900\xB7\uC0C1\uB2E8 2,100\uC740 \uACC4\uD68D\uAC12 \u2014 \uC7AC\uC9C8\xB7\uAC1C\uD3D0 \uD615\uC2DD\xB7\uCC3D\uD638 \uC0C1\uC138\uB294 \uC124\uACC4\uC5D0\uC11C \uC815\uD55C\uB2E4",
    "left"
  );
}
function dimRun(d2, a2, b2, label, vertical) {
  void vertical;
  d2.alignedDim("\uCE58\uC218", a2, b2, 0, label);
}
function drawDimsAt(d2, p2, ox, oy) {
  const inner = 1700;
  const off = 3200;
  const exL = p2.wingMm?.side === "left" ? p2.wingMm.widthMm : 0;
  const exR = p2.wingMm?.side === "right" ? p2.wingMm.widthMm : 0;
  const x0 = ox;
  const x1 = ox + p2.widthMm;
  const y0 = oy;
  const y1 = oy + p2.depthMm;
  const mm = (v) => Math.round(v).toLocaleString();
  for (let i = 0; i < p2.gridX.length - 1; i++) {
    const [a2, b2] = [p2.gridX[i], p2.gridX[i + 1]];
    if (b2 - a2 <= 0) continue;
    dimRun(d2, [ox + a2, y0 - inner], [ox + b2, y0 - inner], mm(b2 - a2), false);
  }
  dimRun(d2, [x0 - exL, y0 - off], [x1 + exR, y0 - off], mm(p2.widthMm + exL + exR), false);
  if (p2.wingMm) {
    const [wx0, wx1] = p2.wingMm.side === "right" ? [x1, x1 + exR] : [x0 - exL, x0];
    dimRun(d2, [wx0, y0 - inner], [wx1, y0 - inner], mm(p2.wingMm.widthMm), false);
    const wy = wingYRange(p2);
    if (wy) {
      const dx = x1 + exR + inner;
      dimRun(d2, [dx, oy + wy[0]], [dx, oy + wy[1]], mm(wy[1] - wy[0]), true);
    }
  }
  for (let i = 0; i < p2.gridY.length - 1; i++) {
    const [a2, b2] = [p2.gridY[i], p2.gridY[i + 1]];
    if (b2 - a2 <= 0) continue;
    dimRun(d2, [x0 - inner, oy + a2], [x0 - inner, oy + b2], mm(b2 - a2), true);
  }
  dimRun(d2, [x0 - off, y0], [x0 - off, y1], mm(p2.depthMm), true);
}
function drawTitleBlock(d2, x2, y2, input) {
  const labelW = 5e3;
  const valueW = 21e3;
  const rowH = 1500;
  const nos = [
    siteSheet().no,
    ...input.floors.map((f2, i) => planSheet(i, f2.label).no),
    ...(input.elevations ?? []).map((e2, i) => elevationSheet(i, e2.title).no),
    ...input.section ? [sectionSheet().no] : [],
    ...input.schedule && input.schedule.length > 0 ? [openingScheduleSheet().no] : []
  ];
  const rows = [
    ["\uACF5 \uC0AC \uBA85", input.title],
    ["\uB3C4 \uBA74 \uBA85", "\uC9C0\uC801 \uD604\uD669\uB3C4 \xB7 \uCE35\uBCC4 \uAE30\uD68D \uD3C9\uBA74\uB3C4"],
    // 이 파일에 든 도면들의 번호. SVG 표제란·기획안 시트와 같은 체계다(sheet.ts).
    ["\uB3C4\uBA74\uBC88\uD638", nos.join(" \xB7 ")],
    ["\uCD95    \uCC99", "1:1 \uC2E4\uCC99 \uC791\uB3C4 (\uCD9C\uB825 \uCD95\uCC99\uC740 \uD310\uB12C\uC5D0\uC11C \uC9C0\uC815)"],
    ...input.dateLabel ? [["\uC791 \uC131 \uC77C", input.dateLabel]] : []
  ];
  const h2 = rowH * rows.length;
  d2.rect("\uD45C\uC81C-\uD2C0", x2, y2 - h2, labelW + valueW, h2);
  d2.line("\uD45C\uC81C-\uD2C0", [x2 + labelW, y2 - h2], [x2 + labelW, y2]);
  rows.forEach(([k2, v], i) => {
    const top = y2 - rowH * i;
    if (i > 0) d2.line("\uD45C\uC81C-\uD2C0", [x2, top], [x2 + labelW + valueW, top]);
    const ty = top - rowH / 2 - TXT.room / 2;
    d2.text("\uD45C\uC81C", [x2 + labelW / 2, ty], TXT.room, k2, "center");
    d2.text("\uD45C\uC81C", [x2 + labelW + 500, ty], TXT.room, v, "left");
  });
  d2.text(
    "\uD45C\uC81C",
    [x2, y2 - h2 - 1100],
    TXT.small,
    "\uAE30\uD68D\uB2E8\uACC4 \uAC1C\uB150\uC548 \u2014 \uCD5C\uC885 \uC778\uD5C8\uAC00 \uC5EC\uBD80\uB294 \uAD00\uACC4 \uD589\uC815\uAE30\uAD00 \uC2EC\uC0AC\uC5D0 \uB530\uB77C \uB2EC\uB77C\uC9C8 \uC218 \uC788\uC74C",
    "left"
  );
}
function buildPlanDxf(input) {
  const d2 = new DxfBuilder(LAYERS, input.labelMode ?? "korean");
  let siteRight = 0;
  for (const p2 of input.parcels) {
    const ring = p2.ring.map(([x2, y2]) => [x2 * 1e3, y2 * 1e3]);
    d2.polyline("\uB300\uC9C0-\uC9C0\uC801", ring, true);
    const cx = ring.reduce((s2, q2) => s2 + q2[0], 0) / ring.length;
    const cy = ring.reduce((s2, q2) => s2 + q2[1], 0) / ring.length;
    d2.text("\uB300\uC9C0-\uC9C0\uC801", [cx, cy], TXT.room, p2.jibun, "center");
    d2.text("\uB300\uC9C0-\uC9C0\uC801", [cx, cy - TXT.room * 1.35], TXT.area, `${p2.areaM2.toFixed(1)}\u33A1`, "center");
    siteRight = Math.max(siteRight, ...ring.map((q2) => q2[0]));
  }
  if (input.sharedEdge && input.sharedEdge.length > 1) {
    d2.polyline("\uB300\uC9C0-\uACBD\uACC4\uACF5\uC720", input.sharedEdge.map(([x2, y2]) => [x2 * 1e3, y2 * 1e3]));
  }
  d2.text("\uD45C\uC81C", [0, -3e3], TXT.title, `${siteSheet().no} \uC9C0\uC801 \uD604\uD669\uB3C4`, "left");
  d2.text("\uD45C\uC81C", [0, -3800], TXT.area, input.title, "left");
  const gap = 6e3;
  let ox = siteRight + 1e4;
  input.floors.forEach((f2, i) => {
    drawFloor(d2, f2, ox, 0, planSheet(i, f2.label).no, input.openingTags);
    ox += f2.widthMm + gap;
  });
  for (const [i, ep] of (input.elevations ?? []).entries()) {
    drawElevation(d2, ep, ox, 0, elevationSheet(i, ep.title).no);
    ox += ep.widthMm + 4e3 + gap;
  }
  if (input.section) {
    drawSection(d2, input.section, ox, 0, sectionSheet().no);
  }
  const infoY = -1e4;
  drawTitleBlock(d2, 0, infoY, input);
  if (input.schedule && input.schedule.length > 0) {
    drawOpeningTable(d2, 55e3, infoY, input.schedule);
  }
  return d2.toString();
}

// vendor/plan/planElevation.ts
var ON = 60;
function wingYRange2(b2, p2) {
  if (!p2.wingMm) return null;
  const wd = Math.min(p2.wingMm.depthMm, p2.depthMm);
  const yFrom = b2.coreAtRoad ? 0 : p2.depthMm - wd;
  return [yFrom, yFrom + wd];
}
function xRange(p2) {
  const xMin = p2.wingMm?.side === "left" ? -p2.wingMm.widthMm : 0;
  const xMax = p2.wingMm?.side === "right" ? p2.widthMm + p2.wingMm.widthMm : p2.widthMm;
  return [xMin, xMax];
}
function subtractSpans(from, to, blocked) {
  const out = [];
  let cur = from;
  for (const [s2, e2] of [...blocked].sort((a2, b2) => a2[0] - b2[0])) {
    if (e2 <= cur || s2 >= to) continue;
    if (s2 > cur) out.push([cur, s2]);
    cur = Math.max(cur, e2);
  }
  if (cur < to) out.push([cur, to]);
  return out;
}
function buildElevations(b2, plans) {
  const sec = buildSection(b2);
  const baseD = sec.depthMm;
  const TITLE = {
    front: "\uC815\uBA74\uB3C4 (\uB3C4\uB85C\uCE21)",
    back: "\uBC30\uBA74\uB3C4",
    left: "\uC88C\uCE21\uBA74\uB3C4",
    right: "\uC6B0\uCE21\uBA74\uB3C4"
  };
  const dirs = ELEVATION_ORDER.map((dir) => ({ dir, title: TITLE[dir] }));
  return dirs.map(({ dir, title }) => {
    const bands = [];
    const openings = [];
    const columns = [];
    for (const [i, p2] of plans.entries()) {
      const sf = sec.floors[i];
      if (!sf) continue;
      const D2 = p2.depthMm;
      const W2 = p2.widthMm;
      const [xMin, xMax] = xRange(p2);
      const wingY = wingYRange2(b2, p2);
      const z0 = sf.flMm;
      const z1 = sf.flMm + sf.heightMm;
      const span = dir === "front" ? [W2 - xMax, W2 - xMin] : dir === "back" ? [xMin, xMax] : dir === "left" ? [baseD - D2, baseD] : [0, D2];
      bands.push({ x0: span[0], x1: span[1], z0, z1, label: sf.label });
      const hWalls = p2.walls.filter((w2) => w2.kind === "exterior" && Math.abs(w2.a[1] - w2.b[1]) < ON).map((w2) => ({
        y: w2.a[1],
        x0: Math.min(w2.a[0], w2.b[0]),
        x1: Math.max(w2.a[0], w2.b[0])
      }));
      const onHWall = (o2) => hWalls.some(
        (w2) => Math.abs(w2.y - o2.at[1]) < ON && w2.x0 - ON <= o2.at[0] && o2.at[0] <= w2.x1 + ON
      );
      const hiddenBeyond = (o2, outward) => hWalls.some(
        (w2) => (w2.y - o2.at[1]) * outward > ON && w2.x0 - ON <= o2.at[0] && o2.at[0] <= w2.x1 + ON
      );
      for (const o2 of p2.openings) {
        if (o2.sillMm == null || o2.headMm == null) continue;
        if (o2.headMm + 200 >= sf.heightMm) continue;
        let cx = null;
        if (dir === "front" && o2.axis === "x" && onHWall(o2) && !hiddenBeyond(o2, 1)) {
          cx = W2 - o2.at[0];
        } else if (dir === "back" && o2.axis === "x" && onHWall(o2) && !hiddenBeyond(o2, -1)) {
          cx = o2.at[0];
        } else if (dir === "left" && o2.axis === "y") {
          const onMain = Math.abs(o2.at[0] - W2) < ON;
          const onWing = p2.wingMm?.side === "right" && Math.abs(o2.at[0] - xMax) < ON;
          const interior = onMain && p2.wingMm?.side === "right" && wingY ? o2.at[1] > wingY[0] - ON && o2.at[1] < wingY[1] + ON : false;
          if ((onMain || onWing) && !interior) cx = baseD - D2 + o2.at[1];
        } else if (dir === "right" && o2.axis === "y") {
          const onMain = Math.abs(o2.at[0]) < ON;
          const onWing = p2.wingMm?.side === "left" && Math.abs(o2.at[0] - xMin) < ON;
          const interior = onMain && p2.wingMm?.side === "left" && wingY ? o2.at[1] > wingY[0] - ON && o2.at[1] < wingY[1] + ON : false;
          if ((onMain || onWing) && !interior) cx = D2 - o2.at[1];
        }
        if (cx == null) continue;
        openings.push({
          kind: o2.kind,
          typeId: o2.typeId,
          id: o2.id,
          x0: cx - o2.width / 2,
          x1: cx + o2.width / 2,
          z0: z0 + o2.sillMm,
          z1: z0 + o2.headMm
        });
      }
      if (sf.piloti && dir !== "back") {
        const openFrom = D2 - sf.pilotiDepthMm;
        const seen = /* @__PURE__ */ new Set();
        for (const [x2, y2] of p2.columns) {
          if (y2 < openFrom - ON) continue;
          const cx = dir === "front" ? W2 - x2 : dir === "left" ? baseD - D2 + y2 : D2 - y2;
          const key = Math.round(cx / 10);
          if (seen.has(key)) continue;
          seen.add(key);
          columns.push({
            x0: cx - p2.columnMm / 2,
            x1: cx + p2.columnMm / 2,
            z0,
            z1
          });
        }
      }
    }
    const shift = -Math.min(...bands.map((r2) => r2.x0), 0);
    const nudge = (r2) => {
      r2.x0 += shift;
      r2.x1 += shift;
    };
    bands.forEach(nudge);
    openings.forEach(nudge);
    columns.forEach(nudge);
    const widthMm = Math.max(...bands.map((r2) => r2.x1), 0);
    const parapets = [];
    for (const [i, band] of bands.entries()) {
      if (i !== bands.length - 1) continue;
      const above = bands.slice(i + 1).map((u2) => [u2.x0, u2.x1]);
      for (const [s2, e2] of subtractSpans(band.x0, band.x1, above)) {
        if (e2 - s2 < 100) continue;
        parapets.push({ x0: s2, x1: e2, z0: band.z1, z1: band.z1 + sec.parapetMm });
      }
    }
    const levels = [
      ...sec.floors.map((f2) => ({ z: f2.flMm, label: `${f2.label}  FL +${(f2.flMm / 1e3).toFixed(2)}` })),
      ...sec.floors.length > 0 ? (() => {
        const top = sec.floors[sec.floors.length - 1];
        const z2 = top.flMm + top.heightMm;
        return [{ z: z2, label: `\uC9C0\uBD95  FL +${(z2 / 1e3).toFixed(2)}` }];
      })() : []
    ];
    return {
      dir,
      title,
      widthMm,
      totalHeightMm: sec.totalHeightMm,
      bands,
      parapets,
      levels,
      openings,
      columns,
      notes: [
        "\uC785\uBA74\uC758 \uCC3D\uD638 \uD06C\uAE30\xB7\uC704\uCE58\uB294 \uACC4\uD68D\uAC12\uC785\uB2C8\uB2E4 \u2014 \uCC3D\uD638 \uC0C1\uC138\xB7\uC7AC\uC9C8\uC740 \uC124\uACC4\uC5D0\uC11C \uC815\uD569\uB2C8\uB2E4.",
        "\uC678\uBCBD \uB9C8\uAC10\xB7\uC7AC\uB8CC \uBD84\uD560\uC120\uC740 \uADF8\uB9AC\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4 \u2014 \uB9C8\uAC10 \uC124\uACC4\uC5D0\uC11C \uC815\uD569\uB2C8\uB2E4.",
        "\uBA74 \uC774\uB984\uC740 \uB3C4\uB85C\uBCC0 \uAE30\uC900\uC785\uB2C8\uB2E4(\uC815\uBA74 = \uB3C4\uB85C\uC5D0\uC11C \uBCF8 \uBA74)."
      ]
    };
  });
}
export {
  DEFAULT_BUILDING,
  FIXTURES,
  buildAllFloors,
  buildElevations,
  buildPlanDxf,
  buildSection,
  fixturesFor,
  floorAreaM2,
  roomFloorAreaM2,
  poly as roomFromPolygon
};
