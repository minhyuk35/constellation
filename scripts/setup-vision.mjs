import { mkdir, cp, stat, writeFile, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
await mkdir(new URL('public/models/', root), { recursive: true });
await cp(
  new URL('node_modules/@mediapipe/tasks-vision/wasm/', root),
  new URL('public/wasm/', root),
  { recursive: true },
);
// Emscripten's distributed loader declares ModuleFactory in classic-script
// scope. Export it explicitly for a module worker without eval/importScripts.
for (const name of ['vision_wasm_internal', 'vision_wasm_nosimd_internal']) {
  const source = await readFile(new URL(`public/wasm/${name}.js`, root), 'utf8');
  // Emscripten's optional debug fallback uses sloppy-mode block scoping;
  // provide its supported dbg hook when importing the loader in strict ESM.
  await writeFile(
    new URL(`public/wasm/${name}.mjs`, root),
    `const dbg = (...args) => console.debug(...args);\n${source}\nexport default ModuleFactory;\n`,
  );
}
const model = new URL('public/models/hand_landmarker.task', root);
try {
  if ((await stat(model)).size > 1000000) process.exit(0);
} catch {
  /* First install. */
}
const response = await fetch(
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
);
if (!response.ok)
  throw new Error(
    `Hand model download failed: ${response.status}. Run npm run setup:vision to retry.`,
  );
await writeFile(model, Buffer.from(await response.arrayBuffer()));
console.log('Hand tracking model and WASM are ready locally.');
