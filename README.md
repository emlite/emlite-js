# Emlite
Emlite is a tiny JS bridge for native code (C/C++/Rust/Zig) via Wasm, which is agnostic of the underlying toolchain. Thus it can target wasm32-unknown-unknown (freestanding, via stock clang), wasm32-wasi, wasm32-wasip1 and emscripten. 

It can be installed via npm, vendored to your code base.

## Usage
To quickly try out emlite in the browser, create an index.html file:
(Note this is not the recommended way to deploy. You should install the required dependencies via npm and use a bundler like webpack to handle bundling, minifying, tree-shaking ...etc).

- Using wasm32-wasi[p1] (wasi-libc, wasi-sysroot, wasi-sdk or standalone_wasm emscripten):
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
</head>
<body>
    <script type="module">
        import { WASI, File, OpenFile, ConsoleStdout } from "https://unpkg.com/@bjorn3/browser_wasi_shim";
        import { Emlite } from "https://unpkg.com/emlite";
        // or (if you decide to vendor emlite.js)
        // import { Emlite } from "./src/emlite.js";

        window.onload = async () => {
            let fds = [
                new OpenFile(new File([])), // 0, stdin
                ConsoleStdout.lineBuffered(msg => console.log(`[WASI stdout] ${msg}`)), // 1, stdout
                ConsoleStdout.lineBuffered(msg => console.warn(`[WASI stderr] ${msg}`)), // 2, stderr
            ];
            let wasi = new WASI([], [], fds);
            const emlite = new Emlite();
            const bytes = await emlite.readFile(new URL("./bin/mywasm.wasm", import.meta.url));
            let wasm = await WebAssembly.compile(bytes);
            let inst = await WebAssembly.instantiate(wasm, {
                "wasi_snapshot_preview1": wasi.wasiImport,
                "env": emlite.env,
            });
            emlite.setExports(inst.exports);
            // if your C/C++ has a main function, use: `wasi.start(inst)`. If not, use `wasi.initialize(inst)`.
            wasi.start(inst);
            // test our exported function `add` in tests/dom_test1.cpp works
            // window.alert(inst.exports.add?.(1, 2));
        };
    </script>
</body>
</html>
```

- Freestanding
The @bjorn3/browser_wasi_shim dependency is not required for freestanding builds:
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
</head>
<body>
    <script type="module">
        import { Emlite } from "https://unpkg.com/emlite";
        // or (if you decide to vendor emlite.js)
        // import { Emlite } from "./src/emlite.js";

        window.onload = async () => {
            const emlite = new Emlite();
            const bytes = await emlite.readFile(new URL("./bin/mywasm.wasm", import.meta.url));
            let wasm = await WebAssembly.compile(bytes);
            let inst = await WebAssembly.instantiate(wasm, {
                "env": emlite.env,
            });
            emlite.setExports(inst.exports);
            // test our exported function `add` in tests/dom_test1.cpp works
            inst.exports.main?.();
            window.alert(inst.exports.add?.(1, 2));
        };
    </script>
</body>
</html>
```


## Deployment

### Using wasm32-unknown-unknown
#### In the browser
Install emlite via npm:
```bash
npm install emlite
```

In your javascript code:
```javascript
import { Emlite } from "emlite";

async function main() {
    const emlite = new Emlite();
    const bytes = await emlite.readFile(new URL("./bin/mywasm.wasm", import.meta.url));
    let wasm = await WebAssembly.compile(bytes);
    let inst = await WebAssembly.instantiate(wasm, {
        env: emlite.env,
    });
    emlite.setExports(inst.exports);
    inst.exports.main?.();
    window.alert(inst.exports.add?.(1, 2));
}

await main();
```

#### With a javascript engine like nodejs
You can get emlite from npm:
```bash
npm install emlite
```

Then in your javascript file:
```javascript
import { Emlite } from "emlite";

async function main() {
    const emlite = new Emlite();
    const url = new URL("./bin/console.wasm", import.meta.url);
    const bytes = await emlite.readFile(url);
    const wasm = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(wasm, {
        env: emlite.env,
    });
    emlite.setExports(instance.exports);
    inst.exports.main?.();
    // if you have another exported function marked with EMLITE_USED, you can get it in the instance exports
    instance.exports.some_func();
}

await main();
```

### Using wasm32-wasi, wasm32-wasip1 or emscripten
#### In the browser
To use emlite with wasm32-wasi, wasm32-wasip1 or standalone_wasm emscripten** in your web stack, you will need a wasi javascript polyfill, here we use @bjorn3/browser_wasi_shim to provides us with said polyfill:
```bash
npm install emlite
npm install @bjorn3/browser_wasi_shim
```

In your javascript code:
```javascript
import { Emlite } from "emlite";
import { WASI, File, OpenFile, ConsoleStdout } from "@bjorn3/browser_wasi_shim";

async function main() {
    let fds = [
        new OpenFile(new File([])), // 0, stdin
        ConsoleStdout.lineBuffered(msg => console.log(`[WASI stdout] ${msg}`)), // 1, stdout
        ConsoleStdout.lineBuffered(msg => console.warn(`[WASI stderr] ${msg}`)), // 2, stderr
    ];
    let wasi = new WASI([], [], fds);
    const emlite = new Emlite();
    const bytes = await emlite.readFile(new URL("./bin/dom_test1.wasm", import.meta.url));
    let wasm = await WebAssembly.compile(bytes);
    let inst = await WebAssembly.instantiate(wasm, {
        "wasi_snapshot_preview1": wasi.wasiImport,
        "env": emlite.env,
    });
    emlite.setExports(inst.exports);
    // if your C/C++ has a main function, use: `wasi.start(inst)`. If not, use `wasi.initialize(inst)`.
    wasi.start(inst);
    // test our exported function `add` in tests/dom_test1.cpp works
    window.alert(inst.exports.add?.(1, 2));
}

await main();
```

** Note that this depends on emscripten's ability to create standalone wasm files, which will also require a wasi shim, see more info [here](https://v8.dev/blog/emscripten-standalone-wasm). To use Emlite with emscripten's default mode, please read the [README.emscripten.md](./README.emscripten.md) document.

#### With a javascript engine like nodejs
You can get emlite from npm:
```bash
npm install emlite
```

Then in your javascript file:
```javascript
import { Emlite } from "emlite";
import { WASI } from "node:wasi";
import { argv, env } from "node:process";

async function main() {
    const wasi = new WASI({
        version: 'preview1',
        args: argv,
        env,
    });
    
    const emlite = new Emlite();
    const url = new URL("./bin/console.wasm", import.meta.url);
    const bytes = await emlite.readFile(url);
    const wasm = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(wasm, {
        wasi_snapshot_preview1: wasi.wasiImport,
        env: emlite.env,
    });
    wasi.start(instance);
    emlite.setExports(instance.exports);
    // if you have another exported function marked with EMLITE_USED, you can get it in the instance exports
    instance.exports.some_func();
}

await main();
```
Note that nodejs as of version 22.16 requires a _start function in the wasm module. That can be achieved by defining an `int main() {}` function. It's also why we use `wasi.start(instance)` in the js module.