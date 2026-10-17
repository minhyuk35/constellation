import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (!existsSync('worker/.dev.vars'))
  writeFileSync(
    'worker/.dev.vars',
    `LOCAL_DEV=true\nKIOSK_KEY=local-exhibition-only\nSESSION_SECRET=${randomBytes(32).toString('hex')}\n`,
  );
const wrangler = 'node_modules/wrangler/bin/wrangler.js';
const result = spawnSync(
  process.execPath,
  [wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', '--config', 'worker/wrangler.jsonc'],
  { stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status || 1);
const children = [
  spawn(
    process.execPath,
    [wrangler, 'dev', '--config', 'worker/wrangler.jsonc', '--ip', '127.0.0.1', '--port', '8787'],
    { stdio: 'inherit' },
  ),
  spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
    { stdio: 'inherit' },
  ),
];
const stop = () => {
  for (const child of children) child.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', stop);
