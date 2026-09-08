import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';

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
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: false,
});

// Remove duplicate shebang that results from source file already having one
const bundlePath = 'dist/pinloop.js';
let content = readFileSync(bundlePath, 'utf8');
const shebangRegex = /^(#!\/usr\/bin\/env node\n)+/;
content = content.replace(shebangRegex, '#!/usr/bin/env node\n');
writeFileSync(bundlePath, content);
