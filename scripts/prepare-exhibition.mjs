import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const origin = process.argv[2];
let site;
try {
  site = new URL(origin);
} catch {}
if (
  !site ||
  site.protocol !== 'https:' ||
  site.username ||
  site.password ||
  site.pathname !== '/' ||
  site.search ||
  site.hash
) {
  console.error('Usage: npm run exhibition:prepare -- https://your-project.vercel.app');
  process.exit(1);
}
const path = 'worker/wrangler.production.json';
const config = existsSync(path)
  ? JSON.parse(readFileSync(path, 'utf8'))
  : {
      name: 'constellation-exhibition-api',
      main: 'index.js',
      compatibility_date: '2026-10-01',
      workers_dev: true,
      d1_databases: [],
    };
config.vars = { PUBLIC_ORIGIN: site.origin };
config.durable_objects = { bindings: [{ name: 'VR_MONITOR', class_name: 'VRMonitorRoom' }] };
config.migrations ||= [];
if (!config.migrations.some(m => m.tag === 'vr-monitor-v1'))
  config.migrations.push({ tag: 'vr-monitor-v1', new_sqlite_classes: ['VRMonitorRoom'] });
for (const database of config.d1_databases) database.migrations_dir = 'migrations';
writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
if (!existsSync('exhibition-secrets.local.json'))
  writeFileSync(
    'exhibition-secrets.local.json',
    JSON.stringify(
      {
        KIOSK_KEY: randomBytes(32).toString('hex'),
        SESSION_SECRET: randomBytes(32).toString('hex'),
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
console.log('Production configuration prepared. Existing secrets were preserved.');
console.log(
  'After Cloudflare login, create D1 with --binding DB --update-config if this is the first deployment.',
);
console.log(
  'The operator key is stored in the ignored exhibition-secrets.local.json file; never add it to Vercel VITE_ variables.',
);
