import { build } from 'esbuild';
for (const name of ['guandan-match-driver', 'gandengyan-match-driver']) {
  await build({
    entryPoints: [`server/${name}.ts`],
    bundle: true, format: 'esm', platform: 'node', target: 'node18',
    outfile: `server/${name}.bundle.mjs`,
  });
  console.log(`built server/${name}.bundle.mjs`);
}
