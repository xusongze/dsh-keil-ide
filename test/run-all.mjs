// Runs every regression suite in this folder and reports one verdict.
//
//   node test/run-all.mjs
//
// The Keil suites copy a real `.uvprojx` to a temp directory and normalise it.
// Point `DSH_KEIL_TEST_PROJECT` at your own project if the default is missing.
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const suites = (await readdir(here)).filter((n) => /^test-ide-.*\.mjs$/.test(n)).sort();
if (suites.length === 0) {
  console.error('no suites found next to run-all.mjs');
  process.exit(1);
}

const failed = [];
for (const name of suites) {
  process.stdout.write(`\n=== ${name} ${'='.repeat(Math.max(0, 58 - name.length))}\n`);
  const result = spawnSync(process.execPath, [path.join(here, name)], { stdio: 'inherit' });
  if (result.status !== 0) failed.push(name);
}

console.log(`\n${'='.repeat(64)}`);
if (failed.length === 0) {
  console.log(`all ${suites.length} suites passed`);
} else {
  console.log(`${failed.length} of ${suites.length} suites FAILED: ${failed.join(', ')}`);
}
process.exit(failed.length === 0 ? 0 : 1);
