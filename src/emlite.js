// base-1000 encoding of major.minor.patch of the semver string
// 0.1.23 => 1023
// 1.0.23 => 1000023
// 11.0.23 => 11000023
// version = (major × 1 000 000) + (minor × 1 000) + patch
const EMLITE_VERSION = 1024;

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

    get(h) { return this._h2e.get(h)?.value; }
    toHandle(value) { return this.add(value); }
    toValue(h) { return this.get(h); }
    has(value) { return this._v2h.has(value); }
    get size() { return this._h2e.size; }
    [Symbol.iterator]() { return this._h2e.values(); }
}

const HANDLE_MAP = new HandleTable();
HANDLE_MAP.add(null);
HANDLE_MAP.add(undefined);
HANDLE_MAP.add(false);
HANDLE_MAP.add(true);
HANDLE_MAP.add(globalThis);
HANDLE_MAP.add(console);
HANDLE_MAP.add(Symbol("_EMLITE_RESERVED_"));
globalThis.EMLITE_VALMAP = HANDLE_MAP;

const enc = new TextEncoder("utf-8");
const dec = new TextDecoder("utf-8");

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
        const {
            memory = undefined,
            env = {},
            globals = {},
        } = opts;

        this._memory = memory ?? new WebAssembly.Memory({ initial: 258, maximum: 4096 });
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
        return typeof window !== "undefined" && "document" in window;
    }

    async dynamicImport(id) {
        const hidden = new Function('id', 'return import(id)');
        return hidden(id);
    }

    /**
     * read a file from a URL
     * @param {URL} url
     * @return {ArrayBuffer}
     */
    async readFile(url) {
        if (this.envIsBrowser()) {
            let buf = await window.fetch(url);
            return await buf.arrayBuffer();
        } else {
            const { readFile } = await this.dynamicImport('node:fs/promises');
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
            console.warn("emlite_target is not defined, it's advisable to use an emlite version above 0.1.23.");
        } else if (EMLITE_VERSION !== exports.emlite_target()) {
            console.warn("Probably using an incompatible version of emlite, plowing through!");
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
     * Convert a javascript string to a C string
     * @param {string} str - The javascript string
     * @returns {Number} - represents the offset in memory of a null-terminated char array
     */
    copyStringToWasm(str) {
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

    /** Returns the env required for wasm instantiation. @returns {Object} env object */
    get env() {
        const core = {
            __cxa_allocate_exception: () => { },
            __cxa_free_exception: () => { },
            __cxa_throw: () => { },
            __cxa_atexit:() => { },

            emlite_val_new_array: () => HANDLE_MAP.add([]),
            emlite_val_new_object: () => HANDLE_MAP.add({}),
            emlite_val_make_int: n => HANDLE_MAP.add(n | 0),
            emlite_val_make_double: n => HANDLE_MAP.add(n),
            emlite_val_make_str: (ptr, len) => HANDLE_MAP.add(this.cStr(ptr, len)),

            emlite_val_get_value_int: n => HANDLE_MAP.get(n),
            emlite_val_get_value_double: n => HANDLE_MAP.get(n),
            emlite_val_get_value_string: n => this.copyStringToWasm(HANDLE_MAP.get(n)),
            emlite_val_typeof: n => this.copyStringToWasm(typeof HANDLE_MAP.get(n)),

            emlite_val_push: (arrRef, valRef) => HANDLE_MAP.get(arrRef).push(valRef),
            emlite_val_get: (n, idx) => HANDLE_MAP.add(HANDLE_MAP.get(n)[HANDLE_MAP.get(idx)]),
            emlite_val_set: (n, idx, valRef) => HANDLE_MAP.get(n)[HANDLE_MAP.get(idx)] = HANDLE_MAP.get(valRef),
            emlite_val_has: (objRef, valRef) => {
                return Reflect.has(HANDLE_MAP.get(objRef), HANDLE_MAP.get(valRef));
            },
            emlite_val_not: arg => !HANDLE_MAP.get(arg),
            emlite_val_is_string: arg => {
                const obj = HANDLE_MAP.get(arg);
                return typeof obj === "string" || obj instanceof String;
            },
            emlite_val_is_number: arg => typeof HANDLE_MAP.get(arg) === "number",
            emlite_val_gt: (a, b) => HANDLE_MAP.get(a) > HANDLE_MAP.get(b),
            emlite_val_gte: (a, b) => HANDLE_MAP.get(a) >= HANDLE_MAP.get(b),
            emlite_val_lt: (a, b) => HANDLE_MAP.get(a) < HANDLE_MAP.get(b),
            emlite_val_lte: (a, b) => HANDLE_MAP.get(a) <= HANDLE_MAP.get(b),
            emlite_val_equals: (a, b) => HANDLE_MAP.get(a) == HANDLE_MAP.get(b),
            emlite_val_strictly_equals: (a, b) => HANDLE_MAP.get(a) === HANDLE_MAP.get(b),
            emlite_val_instanceof: (a, b) => HANDLE_MAP.get(a) instanceof HANDLE_MAP.get(b),
            emlite_val_obj_has_own_prop: (objRef, pPtr, pLen) => {
                const target = HANDLE_MAP.get(objRef);
                const prop = this.cStr(pPtr, pLen);
                return Object.prototype.hasOwnProperty.call(target, prop);
            },
            emlite_val_inc_ref: h => HANDLE_MAP.incRef(h),
            emlite_val_dec_ref: h => { if (h > 6) HANDLE_MAP.decRef(h); },
            emlite_val_throw: n => { throw HANDLE_MAP.get(n); },

            emlite_val_make_callback: (fidx, data) => {
                const jsFn = (...args) => {
                    const arrHandle = HANDLE_MAP.add(args.map(v => v));
                    return this.exports.__indirect_function_table.get(fidx)(arrHandle, data);
                };
                return HANDLE_MAP.add(jsFn);
            },

            emlite_val_obj_call: (objRef, mPtr, mLen, argvRef) => {
                const target = HANDLE_MAP.get(objRef);
                const method = this.cStr(mPtr, mLen);
                const args = HANDLE_MAP.get(argvRef).map(h => HANDLE_MAP.get(h));
                return HANDLE_MAP.add(Reflect.apply(target[method], target, args));
            },
            emlite_val_construct_new: (objRef, argvRef) => {
                const target = HANDLE_MAP.get(objRef);
                const args = HANDLE_MAP.get(argvRef).map(h => HANDLE_MAP.get(h));
                return HANDLE_MAP.add(Reflect.construct(target, args));
            },
            emlite_val_func_call: (objRef, argvRef) => {
                const target = HANDLE_MAP.get(objRef);
                const args = HANDLE_MAP.get(argvRef).map(h => HANDLE_MAP.get(h));
                return HANDLE_MAP.add(Reflect.apply(target, undefined, args));
            },
            // eslint-disable-next-line no-unused-vars
            emscripten_notify_memory_growth: (i) => this._updateViews(),
            _msync_js: () => { },
            emlite_print_object_map: () => console.log(HANDLE_MAP),
            emlite_reset_object_map: () => {
                for (const h of [...HANDLE_MAP._h2e.keys()]) {
                    if (h > 5) {
                        const value = HANDLE_MAP._h2e.get(h).value;

                        HANDLE_MAP._h2e.delete(h);
                        HANDLE_MAP._v2h.delete(value);
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
