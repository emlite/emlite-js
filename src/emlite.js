/* eslint-disable no-undef */
// base-1000 encoding of major.minor.patch of the semver string
// 0.1.23 => 1023
// 1.0.23 => 1000023
// 11.0.23 => 11000023
// version = (major × 1 000 000) + (minor × 1 000) + patch
const EMLITE_VERSION = 1037;

const enc = new TextEncoder("utf-8");
const dec = new TextDecoder("utf-8");
const dec_16 = new TextDecoder("utf-16le");

export class Emlite {
  /**
   * @param {Object} opts
   *        {
   *          memory?:   WebAssembly.Memory,
   *          env?:      Record<string, any>,    // extra `env` imports
   *          globals?:  Record<string, any>,    // things to pin on `globalThis`
   *        }
   */
  constructor(opts = {}) {
    const { memory = undefined, env = {}, globals = {} } = opts;

    this._memory =
      memory ?? new WebAssembly.Memory({ initial: 258, maximum: 4096 });
    this._extraEnv = { ...env };
    for (const [name, value] of Object.entries(globals)) {
      if (name in globalThis) {
        console.warn(`[Emlite] globalThis.${name} already exists; skipping`);
        continue;
      }
      globalThis[name] = value;
    }
    this._updateViews();
  }

  envIsBrowser() {
    // eslint-disable-next-line no-undef
    return typeof window !== "undefined" && "document" in window;
  }

  async dynamicImport(id) {
    const hidden = new Function("id", "return import(id)");
    return hidden(id);
  }

  /**
   * read a file from a URL
   * @param {URL} url
   * @return {ArrayBuffer}
   */
  async readFile(url) {
    if (this.envIsBrowser()) {
      let buf = await fetch(url);
      return await buf.arrayBuffer();
    } else {
      const { readFile } = await this.dynamicImport("node:fs/promises");
      const buf = await readFile(url);
      return buf.buffer.slice();
    }
  }

  _ensureViewsFresh() {
    if (this._u8.buffer !== this._memory.buffer) {
      this._updateViews();
    }
  }

  _updateViews() {
    const b = this._memory.buffer;

    this._i8 = new Int8Array(b);
    this._u8 = new Uint8Array(b);
    this._i16 = new Int16Array(b);
    this._u16 = new Uint16Array(b);
    this._i32 = new Int32Array(b);
    this._u32 = new Uint32Array(b);
    this._f32 = new Float32Array(b);
    this._f64 = new Float64Array(b);

    globalThis.HEAP8 = this._i8;
    globalThis.HEAPU8 = this._u8;
    globalThis.HEAP16 = this._i16;
    globalThis.HEAPU16 = this._u16;
    globalThis.HEAP32 = this._i32;
    globalThis.HEAPU32 = this._u32;
    globalThis.HEAPF32 = this._f32;
    globalThis.HEAPF64 = this._f64;
  }

  /**
   * Pass your WebAssemly.Instance exports to Emlite
   * @param {WebAssembly.Exports} exports
   */
  setExports(exports) {
    if (typeof exports.emlite_target === "undefined") {
      console.warn(
        "emlite_target is not defined, it's advisable to use an emlite version above 0.1.23."
      );
    } else if (EMLITE_VERSION !== exports.emlite_target()) {
      console.warn(
        "Probably using an incompatible version of emlite, plowing through!"
      );
    }
    this.exports = exports;
  }

  /**
   * Convert a C string to a javascript string
   * @param {Number} ptr - represents an offset in wasm's memory
   * @param {Number} len - represents the length from the offset
   * @returns {string} returns a javascript string
   */
  cStr(ptr, len) {
    this._ensureViewsFresh();
    // return dec.decode(new Uint8Array(this._memory.buffer, ptr, len));
    return dec.decode(this._u8.subarray(ptr, ptr + len));
  }

  /**
   * Convert a UTF-16 C string to a javascript string
   * @param {Number} ptr - represents an offset in wasm's memory (char16_t*)
   * @param {Number} len - represents the length in char16_t units
   * @returns {string} returns a javascript string
   */
  cStrUtf16(ptr, len) {
    this._ensureViewsFresh();
    return dec_16.decode(this._u8.subarray(ptr, ptr + len * 2));
  }

  /**
   * Convert a javascript string to a C string
   * @param {string} str - The javascript string
   * @returns {Number} - represents the offset in memory of a null-terminated char array
   */
  copyStringToWasm(str) {
    if (!str || !(typeof str === "string" || str instanceof String)) return 0;
    this._ensureViewsFresh();
    if (typeof this.exports.emlite_malloc !== "undefined") {
      const utf8 = enc.encode(str + "\0");
      const ptr = this.exports.emlite_malloc(utf8.length);
      if (ptr === 0) throw new Error("malloc failed in copyStringToWasm");
      // new Uint8Array(this._memory.buffer).set(utf8, ptr);
      this._u8.set(utf8, ptr);
      return ptr;
    } else {
      return 0;
    }
  }

  /**
   * Convert a javascript string to a UTF-16 C string
   * @param {string} str - The javascript string
   * @returns {Number} - represents the offset in memory of a null-terminated char16_t array
   */
  copyStringToWasmUtf16(str) {
    if (!str || !(typeof str === "string" || str instanceof String)) return 0;
    this._ensureViewsFresh();
    if (typeof this.exports.emlite_malloc !== "undefined") {
      // Each char16_t is 2 bytes, +1 for null terminator
      const byteLength = (str.length + 1) * 2;
      const ptr = this.exports.emlite_malloc(byteLength);
      if (ptr === 0) throw new Error("malloc failed in copyStringToWasmUtf16");

      // Ensure 2-byte alignment
      if (ptr % 2 !== 0) throw new Error("UTF-16 string not properly aligned");

      const startIdx = ptr >>> 1;
      // Copy string characters
      for (let i = 0; i < str.length; i++) {
        this._u16[startIdx + i] = str.charCodeAt(i);
      }
      // Add null terminator
      this._u16[startIdx + str.length] = 0;

      return ptr;
    } else {
      return 0;
    }
  }

  /** Returns the env required for wasm instantiation. @returns {Object} env object */
  get env() {
    const core = {
      __cxa_allocate_exception: () => {},
      __cxa_free_exception: () => {},
      __cxa_throw: () => {},
      __cxa_atexit: () => {},

      emlite_init_handle_table: () => {
        class HandleTable {
          constructor() {
            this._h2e = new Map();
            this._v2h = new Map();
            this._next = 0;
          }

          _newEntry(value) {
            const h = this._next++;
            this._h2e.set(h, { value, refs: 1 });
            this._v2h.set(value, h);
            return h;
          }

          add(value) {
            if (this._v2h.has(value)) {
              const h = this._v2h.get(value);
              ++this._h2e.get(h).refs;
              return h;
            }
            return this._newEntry(value);
          }

          decRef(h) {
            const e = this._h2e.get(h);
            if (!e) return false;

            if (--e.refs === 0) {
              this._h2e.delete(h);
              this._v2h.delete(e.value);
            }
            return true;
          }

          incRef(h) {
            const e = this._h2e.get(h);
            if (e) ++e.refs;
          }

          get(h) {
            return this._h2e.get(h)?.value;
          }
          toHandle(value) {
            return this.add(value);
          }
          toValue(h) {
            return this.get(h);
          }
          has(value) {
            return this._v2h.has(value);
          }
          get size() {
            return this._h2e.size;
          }
          [Symbol.iterator]() {
            return this._h2e.values();
          }
        }

        const EMLITE_VALMAP = new HandleTable();
        EMLITE_VALMAP.add(null);
        EMLITE_VALMAP.add(undefined);
        EMLITE_VALMAP.add(false);
        EMLITE_VALMAP.add(true);
        EMLITE_VALMAP.add(globalThis);
        EMLITE_VALMAP.add(console);
        EMLITE_VALMAP.add(Symbol("_EMLITE_RESERVED_"));
        globalThis.EMLITE_VALMAP = EMLITE_VALMAP;

        function normalizeThrown(e) {
          if (e instanceof Error) return e;
          try {
            const err = new Error(String(e));
            if (e && typeof e === "object") {
              if ("name" in e) err.name = e.name;
              if ("code" in e) err.code = e.code;
            }
            err.cause = e;
            return err;
          } catch {
            return new Error("Unknown JS exception");
          }
        }
        globalThis.normalizeThrown = normalizeThrown;
      },

      emlite_val_new_array: () => EMLITE_VALMAP.add([]),
      emlite_val_new_object: () => EMLITE_VALMAP.add({}),
      emlite_val_make_bool: (value) => EMLITE_VALMAP.add(!!value),
      emlite_val_make_int: (value) => EMLITE_VALMAP.add(value | 0), // 32-bit signed: -2^31 to 2^31-1
      emlite_val_make_uint: (value) => EMLITE_VALMAP.add(value >>> 0), // 32-bit unsigned: 0 to 2^32-1
      emlite_val_make_bigint: (value) => EMLITE_VALMAP.add(BigInt(value)), // 64-bit signed BigInt
      emlite_val_make_biguint: (value) => {
        let x = BigInt(value); // may be negative due to signed i64 view
        if (x < 0n) x += 1n << 64n; // normalize to [0, 2^64-1]
        return EMLITE_VALMAP.add(x);
      },
      emlite_val_make_double: (n) => EMLITE_VALMAP.add(n),
      emlite_val_make_str: (ptr, len) => EMLITE_VALMAP.add(this.cStr(ptr, len)),
      emlite_val_make_str_utf16: (ptr, len) =>
        EMLITE_VALMAP.add(this.cStrUtf16(ptr, len)),

      emlite_val_get_value_int: (n) => {
        const val = EMLITE_VALMAP.get(n);
        if (typeof val === "bigint") {
          // Preserve lower 32 bits and signedness without precision loss
          return Number(BigInt.asIntN(32, val));
        }
        return val | 0; // 32-bit signed conversion
      },
      emlite_val_get_value_uint: (n) => {
        const val = EMLITE_VALMAP.get(n);
        if (typeof val === "bigint") {
          // Preserve lower 32 bits as unsigned without precision loss
          return Number(BigInt.asUintN(32, val));
        }
        return val >>> 0; // 32-bit unsigned conversion
      },
      emlite_val_get_value_bigint: (h) => {
        const v = EMLITE_VALMAP.get(h);
        if (typeof v === "bigint") return v; // already BigInt
        return BigInt(Math.trunc(Number(v))); // coerce number → BigInt
      },
      emlite_val_get_value_biguint: (h) => {
        const v = EMLITE_VALMAP.get(h);
        if (typeof v === "bigint") return v >= 0n ? v : 0n; // clamp negative
        const n = Math.trunc(Number(v));
        return BigInt(n >= 0 ? n : 0); // clamp to unsigned
      },
      emlite_val_get_value_double: (n) => Number(EMLITE_VALMAP.get(n)),
      emlite_val_get_value_string: (n) =>
        this.copyStringToWasm(EMLITE_VALMAP.get(n)),
      emlite_val_get_value_string_utf16: (n) =>
        this.copyStringToWasmUtf16(EMLITE_VALMAP.get(n)),
      emlite_val_get_value_bool: (h) => (EMLITE_VALMAP.get(h) ? 1 : 0),
      emlite_val_typeof: (n) =>
        this.copyStringToWasm(typeof EMLITE_VALMAP.get(n)),

      emlite_val_push: (arrRef, valRef) => {
        try {
          EMLITE_VALMAP.get(arrRef).push(valRef);
        } catch {
          /* empty */
        }
      },
      emlite_val_get: (n, idx) =>
        EMLITE_VALMAP.add(EMLITE_VALMAP.get(n)[EMLITE_VALMAP.get(idx)]),
      emlite_val_set: (n, idx, valRef) =>
        (EMLITE_VALMAP.get(n)[EMLITE_VALMAP.get(idx)] =
          EMLITE_VALMAP.get(valRef)),
      emlite_val_has: (objRef, valRef) => {
        try {
          return Reflect.has(
            EMLITE_VALMAP.get(objRef),
            EMLITE_VALMAP.get(valRef)
          );
        } catch {
          return false;
        }
      },
      emlite_val_not: (arg) => !EMLITE_VALMAP.get(arg),
      emlite_val_is_string: (arg) => {
        const obj = EMLITE_VALMAP.get(arg);
        return typeof obj === "string" || obj instanceof String;
      },
      emlite_val_is_number: (arg) => {
        const obj = EMLITE_VALMAP.get(arg);
        return typeof obj === "number" || obj instanceof Number;
      },
      emlite_val_is_bool: (h) => {
        const v = EMLITE_VALMAP.get(h);
        return (typeof v === "boolean" || v instanceof Boolean) | 0;
      },
      emlite_val_gt: (a, b) => EMLITE_VALMAP.get(a) > EMLITE_VALMAP.get(b),
      emlite_val_gte: (a, b) => EMLITE_VALMAP.get(a) >= EMLITE_VALMAP.get(b),
      emlite_val_lt: (a, b) => EMLITE_VALMAP.get(a) < EMLITE_VALMAP.get(b),
      emlite_val_lte: (a, b) => EMLITE_VALMAP.get(a) <= EMLITE_VALMAP.get(b),
      emlite_val_equals: (a, b) => EMLITE_VALMAP.get(a) == EMLITE_VALMAP.get(b),
      emlite_val_strictly_equals: (a, b) =>
        EMLITE_VALMAP.get(a) === EMLITE_VALMAP.get(b),
      emlite_val_instanceof: (a, b) =>
        EMLITE_VALMAP.get(a) instanceof EMLITE_VALMAP.get(b),
      emlite_val_obj_has_own_prop: (objRef, pPtr, pLen) => {
        const target = EMLITE_VALMAP.get(objRef);
        const prop = this.cStr(pPtr, pLen);
        return Object.prototype.hasOwnProperty.call(target, prop);
      },
      emlite_val_inc_ref: (h) => EMLITE_VALMAP.incRef(h),
      emlite_val_dec_ref: (h) => {
        if (h > 6) EMLITE_VALMAP.decRef(h);
      },
      emlite_val_throw: (n) => {
        throw EMLITE_VALMAP.get(n);
      },

      emlite_val_make_callback: (fidx, data) => {
        const jsFn = (...args) => {
          const arrHandle = EMLITE_VALMAP.add(args.map((v) => v));
          let ret;
          try {
            ret = this.exports.__indirect_function_table.get(fidx)(
              arrHandle,
              data
            );
          } catch (e) {
            ret = normalizeThrown(e);
          }
          return ret;
        };
        return EMLITE_VALMAP.add(jsFn);
      },

      emlite_val_obj_call: (objRef, mPtr, mLen, argvRef) => {
        const target = EMLITE_VALMAP.get(objRef);
        const method = this.cStr(mPtr, mLen);
        const args = EMLITE_VALMAP.get(argvRef).map((h) =>
          EMLITE_VALMAP.get(h)
        );
        let ret;
        try {
          ret = Reflect.apply(target[method], target, args);
        } catch (e) {
          ret = normalizeThrown(e);
        }
        return EMLITE_VALMAP.add(ret);
      },
      emlite_val_construct_new: (objRef, argvRef) => {
        const target = EMLITE_VALMAP.get(objRef);
        const args = EMLITE_VALMAP.get(argvRef).map((h) =>
          EMLITE_VALMAP.get(h)
        );
        let ret;
        try {
          ret = Reflect.construct(target, args);
        } catch (e) {
          ret = normalizeThrown(e);
        }
        return EMLITE_VALMAP.add(ret);
      },
      emlite_val_func_call: (objRef, argvRef) => {
        const target = EMLITE_VALMAP.get(objRef);
        const args = EMLITE_VALMAP.get(argvRef).map((h) =>
          EMLITE_VALMAP.get(h)
        );
        let ret;
        try {
          ret = Reflect.apply(target, undefined, args);
        } catch (e) {
          ret = normalizeThrown(e);
        }
        return EMLITE_VALMAP.add(ret);
      },
      // eslint-disable-next-line no-unused-vars
      emscripten_notify_memory_growth: (i) => this._updateViews(),
      _msync_js: () => {},
      emlite_print_object_map: () => console.log(EMLITE_VALMAP),
      emlite_reset_object_map: () => {
        for (const h of [...EMLITE_VALMAP._h2e.keys()]) {
          if (h > 6) {
            const value = EMLITE_VALMAP._h2e.get(h).value;

            EMLITE_VALMAP._h2e.delete(h);
            EMLITE_VALMAP._v2h.delete(value);
          }
        }
      },
    };
    return {
      memory: this._memory,
      ...core,
      ...this._extraEnv,
    };
  }
}
