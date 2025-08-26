let V = null;

export function makeHost({ apply }) {
  const strToU16 = (s) => {
    const out = new Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  };
  const u16ToStr = (a) => {
    let s = "";
    for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i] & 0xffff);
    return s;
  };

  const host = {
    emliteInitHandleTable() {
      class HandleTable {
        constructor() {
          this.h2e = new Map();
          this.v2h = new Map();
          this.next = 0;
        }
        _new(v) {
          const h = this.next++;
          this.h2e.set(h, { v, refs: 1 });
          this.v2h.set(v, h);
          return h;
        }
        add(v) {
          if (this.v2h.has(v)) {
            const h = this.v2h.get(v);
            this.h2e.get(h).refs++;
            return h;
          }
          return this._new(v);
        }
        get(h) {
          return this.h2e.get(h)?.v;
        }
        incRef(h) {
          const e = this.h2e.get(h);
          if (e) e.refs++;
        }
        decRef(h) {
          const e = this.h2e.get(h);
          if (!e) return;
          if (--e.refs === 0) {
            this.v2h.delete(e.v);
            this.h2e.delete(h);
          }
        }
      }
      const g = typeof self !== "undefined" ? self : globalThis;
      const T = new HandleTable();
      T.add(null); // 0
      T.add(undefined); // 1
      T.add(false); // 2
      T.add(true); // 3
      T.add(g); // 4  <- global object (has document in page)
      T.add(console); // 5
      T.add(Symbol("_EMLITE_RSVD")); // 6
      globalThis.EMLITE_VALMAP = T;
      globalThis.normalizeThrown = (e) =>
        e instanceof Error ? e : new Error(String(e));
      V = T;
    },

    emliteValNewArray() {
      return V.add([]);
    },
    emliteValNewObject() {
      return V.add({});
    },
    emliteValMakeBool(v) {
      return V.add(!!v);
    },
    emliteValMakeInt(v) {
      return V.add(v | 0);
    },
    emliteValMakeUint(v) {
      return V.add(v >>> 0);
    },
    emliteValMakeBigint(v) {
      return V.add(BigInt(v));
    },
    emliteValMakeBiguint(v) {
      let x = BigInt(v);
      if (x < 0n) x += 1n << 64n;
      return V.add(x);
    },
    emliteValMakeDouble(n) {
      return V.add(Number(n));
    },
    emliteValMakeStr(s) {
      return V.add(String(s));
    },
    emliteValMakeStrUtf16(u16) {
      return V.add(u16ToStr(u16));
    },

    emliteValGetValueBool(h) {
      return !!V.get(h);
    },
    emliteValGetValueInt(h) {
      const v = V.get(h);
      return (typeof v === "bigint" ? Number(v) : Number(v)) | 0;
    },
    emliteValGetValueUint(h) {
      const v = V.get(h);
      return (typeof v === "bigint" ? Number(v) : Number(v)) >>> 0;
    },
    emliteValGetValueBigint(h) {
      const v = V.get(h);
      return typeof v === "bigint" ? v : BigInt(Math.trunc(Number(v)));
    },
    emliteValGetValueBiguint(h) {
      const v = V.get(h);
      if (typeof v === "bigint") return v >= 0n ? v : 0n;
      const n = Math.trunc(Number(v));
      return BigInt(n >= 0 ? n : 0);
    },
    emliteValGetValueDouble(h) {
      return Number(V.get(h));
    },
    emliteValGetValueString(h) {
      return String(V.get(h));
    },
    emliteValGetValueStringUtf16(h) {
      return strToU16(String(V.get(h)));
    },
    emliteValTypeof(h) {
      return typeof V.get(h);
    },

    emliteValPush(arr, v) {
      const a = V.get(arr);
      if (Array.isArray(a)) a.push(v);
    },
    emliteValGet(obj, idx) {
      const base = V.get(obj);
      const key = V.get(idx);
      return V.add(base != null ? base[key] : undefined);
    },
    emliteValSet(obj, idx, v) {
      const base = V.get(obj);
      if (base == null) return;
      base[V.get(idx)] = V.get(v);
    },
    emliteValHas(obj, key) {
      try {
        return Reflect.has(V.get(obj), V.get(key));
      } catch {
        return false;
      }
    },
    emliteValNot(h) {
      return !V.get(h);
    },
    emliteValIsString(h) {
      const o = V.get(h);
      return typeof o === "string" || o instanceof String;
    },
    emliteValIsNumber(h) {
      const o = V.get(h);
      return typeof o === "number" || o instanceof Number;
    },
    emliteValIsBool(h) {
      const o = V.get(h);
      return typeof o === "boolean" || o instanceof Boolean;
    },
    emliteValGt(a, b) {
      return V.get(a) > V.get(b);
    },
    emliteValGte(a, b) {
      return V.get(a) >= V.get(b);
    },
    emliteValLt(a, b) {
      return V.get(a) < V.get(b);
    },
    emliteValLte(a, b) {
      return V.get(a) <= V.get(b);
    },
    emliteValEquals(a, b) {
      return V.get(a) == V.get(b);
    },
    emliteValStrictlyEquals(a, b) {
      return V.get(a) === V.get(b);
    },
    emliteValInstanceof(a, b) {
      const A = V.get(a),
        B = V.get(b);
      try {
        return A instanceof B;
      } catch {
        return false;
      }
    },

    emliteValObjHasOwnProp(obj, prop) {
      const t = V.get(obj);
      return Object.prototype.hasOwnProperty.call(t, prop);
    },
    emliteValObjCall(obj, method, argv) {
      let target = V.get(obj);
      const list = V.get(argv);
      const args = Array.isArray(list) ? list.map((h) => V.get(h)) : [];
      // helpful DOM fallback
      const domMethods = new Set([
        "getElementsByTagName",
        "getElementById",
        "querySelector",
        "querySelectorAll",
        "createElement",
      ]);
      if (!target && domMethods.has(method) && typeof document !== "undefined")
        target = document;
      try {
        const m = target?.[method];
        return V.add(
          typeof m === "function" ? Reflect.apply(m, target, args) : undefined
        );
      } catch (e) {
        return V.add(normalizeThrown(e));
      }
    },

    emliteValConstructNew(ctor, argv) {
      const C = V.get(ctor);
      const list = V.get(argv);
      const args = Array.isArray(list) ? list.map((h) => V.get(h)) : [];
      try {
        return V.add(Reflect.construct(C, args));
      } catch (e) {
        return V.add(normalizeThrown(e));
      }
    },
    emliteValFuncCall(fn, argv) {
      const f = V.get(fn);
      const list = V.get(argv);
      const args = Array.isArray(list) ? list.map((h) => V.get(h)) : [];
      try {
        return V.add(Reflect.apply(f, undefined, args));
      } catch (e) {
        return V.add(normalizeThrown(e));
      }
    },

    emliteValIncRef(h) {
      V.incRef(h);
    },
    emliteValDecRef(h) {
      if (h > 6) V.decRef(h);
    },
    emliteValThrow(h) {
      throw V.get(h);
    },
    emlitePrintObjectMap() {
      /* optional: console.log(V) */
    },
    emliteResetObjectMap() {
      for (const h of [...V.h2e.keys()])
        if (h > 6) {
          const v = V.h2e.get(h).v;
          V.h2e.delete(h);
          V.v2h.delete(v);
        }
    },

    emliteValMakeCallback(fidx, data) {
      const jsFn = (...values) => {
        const handles = values.map((v) => V.add(v));
        const argvHandle = V.add(handles);
        const retHandle = apply(fidx, argvHandle, data);
        return V.get(retHandle);
      };
      return V.add(jsFn);
    },
  };

  return host;
}
