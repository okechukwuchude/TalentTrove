import { build } from 'esbuild';
import { join } from 'node:path';

const packageRoot = join(import.meta.dirname, '..');

await build({
  entryPoints: [join(packageRoot, 'src/pinloop.ts')],
  outfile: join(packageRoot, 'dist/pinloop.js'),
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
