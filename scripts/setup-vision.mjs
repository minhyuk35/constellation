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
let handReady = false;
try {
  handReady = (await stat(model)).size > 1000000;
} catch {
  /* First install. */
}
if (!handReady) {
  const response = await fetch(
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  );
  if (!response.ok)
    throw new Error(
      `Hand model download failed: ${response.status}. Run npm run setup:vision to retry.`,
    );
  await writeFile(model, Buffer.from(await response.arrayBuffer()));
  console.log('Hand tracking model and WASM are ready locally.');
}

// MoveNet MultiPose Lightning, converted for tfjs and hosted on TF-Hub. Each file
// is fetched through the same redirector Kaggle/TF-Hub use so the mirrored copy
// matches what `@tensorflow-models/pose-detection` would fetch at runtime.
const poseDir = new URL('public/models/movenet-multipose/', root);
await mkdir(poseDir, { recursive: true });
const poseModelJson = new URL('model.json', poseDir);
let poseReady = false;
try {
  poseReady = (await stat(poseModelJson)).size > 500;
} catch {
  /* First install. */
}
if (!poseReady) {
  const base = 'https://tfhub.dev/google/tfjs-model/movenet/multipose/lightning/1/';
  const manifestResponse = await fetch(`${base}model.json?tfjs-format=file`);
  if (!manifestResponse.ok)
    throw new Error(
      `Pose model manifest download failed: ${manifestResponse.status}. Run npm run setup:vision to retry.`,
    );
  const manifest = await manifestResponse.json();
  await writeFile(poseModelJson, JSON.stringify(manifest));
  const shardNames = manifest.weightsManifest.flatMap((group) => group.paths);
  for (const shard of shardNames) {
    const shardResponse = await fetch(`${base}${shard}?tfjs-format=file`);
    if (!shardResponse.ok)
      throw new Error(
        `Pose model weights download failed: ${shardResponse.status}. Run npm run setup:vision to retry.`,
      );
    await writeFile(new URL(shard, poseDir), Buffer.from(await shardResponse.arrayBuffer()));
  }
  console.log('Multi-person pose model is ready locally.');
}
