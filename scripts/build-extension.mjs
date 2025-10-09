#!/usr/bin/env node
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'out');

async function bundleExtension() {
  await rm(outDir, { recursive: true, force: true });

  await build({
    entryPoints: [path.join(rootDir, 'src', 'extension.ts')],
    outfile: path.join(outDir, 'extension.js'),
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    external: ['vscode', 'vscode.git'],
    sourcemap: false,
    logLevel: 'info',
    minify: true
  });

  await mkdir(path.join(outDir, 'characters'), { recursive: true });
  await cp(path.join(rootDir, 'src', 'characters'), path.join(outDir, 'characters'), {
    recursive: true
  });
}

bundleExtension().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
