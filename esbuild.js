// Build script for SheetLab.
// Produces two bundles:
//   dist/extension.js   — Node.js extension host code (CommonJS, vscode external)
//   media/webview.js    — Browser bundle that runs inside the Custom Editor Webview
//
// Usage:
//   node esbuild.js            one-off dev build
//   node esbuild.js --watch    watch mode for both bundles
//   node esbuild.js --production  minified production build

const esbuild = require('esbuild');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: ['webview/src/app/main.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  outfile: 'media/webview.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

async function run() {
  if (watch) {
    const [extCtx, webCtx] = await Promise.all([
      esbuild.context(extensionConfig),
      esbuild.context(webviewConfig),
    ]);
    await Promise.all([extCtx.watch(), webCtx.watch()]);
    console.log('[esbuild] watching for changes...');
  } else {
    await Promise.all([esbuild.build(extensionConfig), esbuild.build(webviewConfig)]);
    console.log(`[esbuild] build complete (${production ? 'production' : 'development'})`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

module.exports = { extensionConfig, webviewConfig, projectRoot: path.resolve(__dirname) };
