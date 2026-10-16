// Deploy this package into the local DSH profile, then remind you to restart.
//
//   node scripts/deploy-local.mjs [profileName]
//
// `profileName` defaults to `desktop`. The script copies the package into
// `<profile>/node_modules/<package name>` and makes sure the profile manifest
// lists it under `dsh.profile.bundles`.
//
// DSH only reads the client bundle at startup, so a restart is required for any
// panel-side change to appear. Host-side changes also need the restart, because
// the plugin module is imported once at boot.
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const pkg = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'));

const profileName = process.argv[2] || 'desktop';
const profileDir = path.join(os.homedir(), '.dsh', 'profiles', profileName);
if (!existsSync(profileDir)) {
  console.error(`profile not found: ${profileDir}`);
  const root = path.join(os.homedir(), '.dsh', 'profiles');
  if (existsSync(root)) {
    console.error('available profiles:');
    for (const entry of readdirSync(root)) console.error('  ' + entry);
  }
  process.exit(1);
}

const target = path.join(profileDir, 'node_modules', pkg.name);

// 1) copy the package, leaving behind what a profile does not need
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(repo, target, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(repo, src);
    if (rel === '') return true;
    const top = rel.split(path.sep)[0];
    return top !== '.git' && top !== 'test' && top !== 'node_modules';
  },
});
console.log(`copied  ${repo}\n     -> ${target}`);

// 2) make sure the profile declares the bundle
const manifestPath = path.join(profileDir, 'package.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.dsh = manifest.dsh || {};
manifest.dsh.profile = manifest.dsh.profile || {};
const bundles = manifest.dsh.profile.bundles || (manifest.dsh.profile.bundles = []);
if (bundles.includes(pkg.name)) {
  console.log(`bundle  ${pkg.name} already declared`);
} else {
  bundles.push(pkg.name);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`bundle  added "${pkg.name}" to dsh.profile.bundles`);
}

console.log(`\nversion ${pkg.version} deployed to the "${profileName}" profile.`);
console.log('NOW RESTART DeepSeek Harness — the plugin is only read at startup.');
