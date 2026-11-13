import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './lib.js';

function run(dir, args) {
  console.log(`\n=== ${dir}: npm ${args.join(' ')} ===`);
  const r = spawnSync('npm', args, { cwd: path.join(root, dir), stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`\nПомилка в папці ${dir}. Перевірте інтернет і повторіть: npm run setup`);
    process.exit(1);
  }
}

for (const dir of ['api', 'worker', 'autoscaler', 'balancer', 'frontend']) run(dir, ['install']);
run('frontend', ['run', 'build']);

const envFile = path.join(root, 'local.env');
if (!fs.existsSync(envFile)) {
  fs.copyFileSync(path.join(root, 'local.env.example'), envFile);
  console.log('\nСтворено файл local.env');
}

