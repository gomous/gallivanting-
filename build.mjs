#!/usr/bin/env bun
import { build } from 'bun';
import { rmSync, mkdirSync, existsSync, readdirSync, copyFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const deployDir = 'deploy-final';
const publicDir = 'public';

// Ensure deploy-final directory exists (skip cleanup on Windows)
if (!existsSync(deployDir)) mkdirSync(deployDir, { recursive: true });

// Copy static files from public to deploy-final
function copyDir(src, dest) {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else copyFileSync(srcPath, destPath);
  }
}
copyDir(publicDir, deployDir);

// Build React app
const result = await build({
  entrypoints: ['src/main.tsx'],
  outdir: deployDir,
  minify: true,
  sourcemap: true,
  splitting: true,
  naming: {
    entryPaths: 'main.js',
    chunkPaths: 'assets/[name].[hash].[ext]',
    assetPaths: '[name].[ext]',
  },
});

console.log('Build complete:', result.outputs.length, 'files');

// Write the index.html with proper CSP
const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <link rel="manifest" href="/manifest.json" />
    <meta name="theme-color" content="#0066ff" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.googleusercontent.com; connect-src 'self' http://localhost:5173 ws://localhost:5173 https://cdn.jsdelivr.net; object-src 'none'; base-uri 'self'; form-action 'self'"
    />
    <title>Gallivanter</title>
    <link rel="stylesheet" href="/main.css" />
  </head>
  <body>
    <div id="root"></div>
    <script src="/sw-kill.js"></script>
    <script type="module" src="/main.js"></script>
  </body>
</html>`;
writeFileSync(join(deployDir, 'index.html'), indexHtml);
console.log('index.html written');
