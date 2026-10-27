import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync('dist/index.html', 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, new Set(ids).size, 'IDs must be unique');
assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
for (const [, target] of html.matchAll(/href="#([^"\s]+)"/g)) {
  assert.ok(ids.includes(target), `Missing section: ${target}`);
}
for (const [, target] of html.matchAll(/(?:src|href)="(\/NamiO\/[^"#]+)"/g)) {
  const path = decodeURIComponent(target.replace('/NamiO/', ''));
  assert.ok(existsSync(join('dist', path)), `Missing local asset: ${target}`);
}
assert.ok(!html.includes('cdn.tailwindcss.com'), 'Styles must be built locally');
assert.ok(!html.includes('fonts.googleapis.com'), 'Fonts must be local');
assert.ok(!html.includes('namio.app/install.sh'), 'Do not publish a nonexistent installer');
assert.ok(html.includes('Vista ilustrativa'));
assert.ok(html.includes('https://github.com/PinedaMB/NamiO/releases'));
for (const path of ['fonts/inter.woff2', 'fonts/jetbrains-mono.woff2', 'fonts/material-symbols.woff2', 'licenses/Inter-OFL.txt', 'licenses/JetBrainsMono-OFL.txt', 'licenses/MaterialSymbols-Apache.txt', 'licenses/NamiO-MIT.txt']) {
  assert.ok(existsSync(join('dist', path)), `Missing asset or license: ${path}`);
}
console.log('Landing: sections, local assets, licenses, metadata and download links verified');
