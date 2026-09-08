import { build } from 'esbuild';

await build({
  entryPoints: ['src/pinloop.ts'],
  outfile: 'dist/pinloop.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // These four are real, published npm dependencies (see package.json) —
  // left external so the bundle doesn't duplicate them; they resolve from
  // node_modules at runtime exactly as they do today.
  external: ['commander', 'picocolors', 'log-update', 'cli-spinners'],
  sourcemap: false,
});
