// Bundles the viewer into a single self-contained HTML file so the WebView
// can load it from Flutter assets without any relative resource fetches.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'assets', 'web');
fs.mkdirSync(outDir, { recursive: true });

const result = esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'src', 'viewer.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2018'],
  write: false,
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const template = fs.readFileSync(path.join(__dirname, 'src', 'template.html'), 'utf8');
const html = template.replace('/*BUNDLE*/', () => js);
fs.writeFileSync(path.join(outDir, 'viewer.html'), html);
console.log(`Wrote ${path.relative(process.cwd(), path.join(outDir, 'viewer.html'))} (${(html.length / 1024).toFixed(0)} KB)`);
