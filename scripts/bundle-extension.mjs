// scripts/bundle-extension.mjs
import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const entryPoint = path.join(__dirname, '../e2e/extension-src/background.js');
const outfile = path.join(__dirname, '../.modified-extension/jazz-integration.js');

console.log('📦 Bundling extension background script...');

try {
  await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    outfile: outfile,
    format: 'iife',
    platform: 'browser',
    target: 'chrome100',
    external: ['chrome'],
    define: {
      'process.env.NODE_ENV': '"production"',
      'global': 'self'
    },
    alias: {
      'ws': path.join(__dirname, '../scripts/ws-polyfill.js')
    },
    // Add banner to preserve built-in globals
    banner: {
      js: `
(function() {
  // Preserve built-in globals that might be overridden by the extension
  const _Proxy = window.Proxy;
  const _Promise = window.Promise;
  const _Object = window.Object;
  const _Array = window.Array;
  const _Map = window.Map;
  const _Set = window.Set;

  // Run Jazz in its own scope with preserved globals
  (function(Proxy, Promise, Object, Array, Map, Set) {
`,
    },
    footer: {
      js: `
  })(_Proxy, _Promise, _Object, _Array, _Map, _Set);
})();
`,
    }
  });

  console.log(`✅ Bundled successfully to ${outfile}`);
} catch (error) {
  console.error('❌ Bundle failed:', error);
  process.exit(1);
}
