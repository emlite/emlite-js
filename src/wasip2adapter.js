import { EMLITE_VERSION } from "./emlite.js";

const norm = (e) => (globalThis.normalizeThrown ? normalizeThrown(e) : e);

function stringToU16Array(s) {
  const out = new Array(s.length);
  for (let i = 0;
    i < s.length;
    i++) out[i] = s.charCodeAt(i);
  return out;
}

function u16ArrayToString(arr) {
  let s = "";
  for (let i = 0;
    i < arr.length;
    i++) s += String.fromCharCode(arr[i] & 0xffff);
  return s;
}

export function makeHost({ emlite, apply, target }) {
  const e = emlite.env;
  let VAL = null;
  // Finalize Rust closures when the JS function is GC'd
  const FR = typeof FinalizationRegistry !== 'undefined'
    ? new FinalizationRegistry((data /* handle to boxed-closure pointer */) => {
        try {
          // argv == 0 is a sentinel to free the closure/data on the guest side
          apply(0 /* argv sentinel */, data);
        } catch {}
      })
    : null;
  return {
    __cxaAllocateException() {
      return e.__cxa_allocate_exception();
    },
    __cxaFreeException() {
      return e.__cxa_free_exception();
    },
    __cxaThrow() {
      return e.__cxa_throw();
    },
    __cxaAtexit() {
      return e.__cxa_atexit();
    },
    emliteInitHandleTable() {
      e.emlite_init_handle_table();
      VAL = globalThis.EMLITE_VALMAP;
      // Perform version check if the guest exported a target() function
      try {
        if (typeof target === 'function') {
          const t = target();
          if (t !== EMLITE_VERSION) {
            console.warn(
              "Probably using an incompatible version of emlite (wasip2); plowing through!"
            );
          }
        } else {
          console.warn(
            "emlite_target is not defined for wasip2; it's advisable to export it via WIT."
          );
        }
      } catch (err) {
        console.warn("Failed to check emlite version (wasip2)", err);
      }
    },
    emliteValNewArray() {
      return e.emlite_val_new_array();
    },
    emliteValNewObject() {
      return e.emlite_val_new_object();
    },
    emliteValMakeBool(v) {
      return e.emlite_val_make_bool(v);
    },
    emliteValMakeInt(v) {
      return e.emlite_val_make_int(v);
    },
    emliteValMakeUint(v) {
      return e.emlite_val_make_uint(v);
    },
    emliteValMakeBigint(v) {
      return e.emlite_val_make_bigint(v);
    },
    emliteValMakeBiguint(v) {
      return e.emlite_val_make_biguint(v);
    },
    emliteValMakeDouble(n) {
      return e.emlite_val_make_double(n);
    },
    emliteValGetValueInt(h) {
      return e.emlite_val_get_value_int(h);
    },
    emliteValGetValueUint(h) {
      return e.emlite_val_get_value_uint(h);
    },
    emliteValGetValueBigint(h) {
      return e.emlite_val_get_value_bigint(h);
    },
    emliteValGetValueBiguint(h) {
      return e.emlite_val_get_value_biguint(h);
    },
    emliteValGetValueDouble(h) {
      return e.emlite_val_get_value_double(h);
    },
    emliteValGetValueBool(h) {
      return e.emlite_val_get_value_bool(h);
    },
    emliteValTypeof(h) {
      return typeof VAL.get(h);
    },
    emliteValPush(a, v) {
      return e.emlite_val_push(a, v);
    },
    emliteValGet(n, idx) {
      return e.emlite_val_get(n, idx);
    },
    emliteValSet(n, idx, v) {
      return e.emlite_val_set(n, idx, v);
    },
    emliteValHas(o, k) {
      return e.emlite_val_has(o, k);
    },
    emliteValNot(h) {
      return e.emlite_val_not(h);
    },
    emliteValIsString(h) {
      return e.emlite_val_is_string(h);
    },
    emliteValIsNumber(h) {
      return e.emlite_val_is_number(h);
    },
    emliteValIsBool(h) {
      return e.emlite_val_is_bool(h);
    },
    emliteValGt(a, b) {
      return e.emlite_val_gt(a, b);
    },
    emliteValGte(a, b) {
      return e.emlite_val_gte(a, b);
    },
    emliteValLt(a, b) {
      return e.emlite_val_lt(a, b);
    },
    emliteValLte(a, b) {
      return e.emlite_val_lte(a, b);
    },
    emliteValEquals(a, b) {
      return e.emlite_val_equals(a, b);
    },
    emliteValStrictlyEquals(a, b) {
      return e.emlite_val_strictly_equals(a, b);
    },
    emliteValInstanceof(a, b) {
      return e.emlite_val_instanceof(a, b);
    },
    emliteValIncRef(h) {
      return e.emlite_val_inc_ref(h);
    },
    emliteValDecRef(h) {
      return e.emlite_val_dec_ref(h);
    },
    emliteValThrow(h) {
      return e.emlite_val_throw(h);
    },
    emlitePrintObjectMap() {
      return e.emlite_print_object_map();
    },
    emliteResetObjectMap() {
      return e.emlite_reset_object_map();
    },
    emliteValMakeStr(s /* string */) {
      return VAL.add(String(s));
    },
    emliteValMakeStrUtf16(u16 /* list<u16> */) {
      return VAL.add(u16ArrayToString(u16));
    },
    emliteValGetValueString(h /* -> string */) {
      return String(VAL.get(h));
    },
    emliteValGetValueStringUtf16(h /* -> list<u16> */) {
      return stringToU16Array(String(VAL.get(h)));
    },
    emliteValObjHasOwnProp(obj, prop /* string */) {
      const target = VAL.get(obj);
      return Object.prototype.hasOwnProperty.call(target, prop);
    },
    emliteValObjCall(obj, method, argv /* u32 handle */) {
      const target = VAL.get(obj);
      const args = VAL.get(argv).map((h) => VAL.get(h));
      let ret;
      try {
        ret = Reflect.apply(target[method], target, args);
      } catch (e) {
        ret = norm(e);
      }
      return VAL.add(ret);
    },
    emliteValConstructNew(ctor, argv /* u32 handle */) {
      const target = VAL.get(ctor);
      const args = VAL.get(argv).map((h) => VAL.get(h));
      let ret;
      try {
        ret = Reflect.construct(target, args);
      } catch (e) {
        ret = norm(e);
      }
      return VAL.add(ret);
    },
    emliteValFuncCall(fn, argv /* u32 handle */) {
      const f = VAL.get(fn);
      const args = VAL.get(argv).map((h) => VAL.get(h));
      let ret;
      try {
        ret = Reflect.apply(f, undefined, args);
      } catch (e) {
        ret = norm(e);
      }
      return VAL.add(ret);
    },
    emliteValMakeCallback(fidx, data) {
      const jsFn = (...values) => {
        const argvHandle = VAL.add(values);
        const retHandle = apply(fidx, argvHandle, data);
        return VAL.get(retHandle);
      };
      if (FR) FR.register(jsFn, data);
      return VAL.add(jsFn);
    },
  };
}
