import { componentize } from '@bytecodealliance/componentize-js';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { component } = await componentize({
  sourcePath: resolve('src/adapter.js'),
  witPath:    resolve('wit/emlite-js.wit'),
  worldName:  'env',
});

await writeFile('emlite.wasm', component);
console.log('wrote emlite.wasm');