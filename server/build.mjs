import { build } from 'esbuild';
await build({
  entryPoints: ['server/guandan-match-driver.ts'],
  bundle: true, format: 'esm', platform: 'node', target: 'node18',
  outfile: 'server/guandan-match-driver.bundle.mjs',
});
console.log('built server/guandan-match-driver.bundle.mjs');
