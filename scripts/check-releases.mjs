import assert from 'node:assert/strict';
import { updateRelease } from '../src/lib/releases.js';
const repository = 'https://github.com/PinedaMB/NamiO';
const version = 'v0.4.3';
const asset = (name, url = `${repository}/releases/download/${version}/${encodeURIComponent(name)}`) => ({ name, state: 'uploaded', browser_download_url: url });
function page() {
  const label = () => ({ textContent: '' });
  const versions = [label(), label()];
  const note = label(), windows = label();
  const links = Object.fromEntries(['AppImage', 'deb', 'exe'].map(format => {
    const text = label();
    return [format, { href: `${repository}/releases/latest`, text, querySelector: () => text }];
  }));
  return { versions, note, windows, links,
    querySelectorAll: () => versions,
    querySelector: selector => selector === '[data-release-note]' ? note : selector === '[data-windows-status]' ? windows : links[selector.match(/="(.*?)"/)[1]],
  };
}
const release = { tag_name: version, draft: false, prerelease: false, assets: [asset('NamiO-arm64.AppImage'), asset('NamiO.AppImage'), asset('namio_amd64.deb'), asset('NamiO Setup.exe.blockmap'), asset('NamiO Setup.exe'), asset('latest.yml')] };
let document = page();
await updateRelease(document, async (url, options) => {
  assert.equal(url, 'https://api.github.com/repos/PinedaMB/NamiO/releases/latest');
  assert.ok(options.signal);
  return { ok: true, json: async () => release };
});
assert.deepEqual(document.versions.map(item => item.textContent), [version, version]);
assert.match(document.note.textContent, /v0.4.3/);
assert.match(document.windows.textContent, /Disponible/);
assert.equal(document.links.exe.href, asset('NamiO Setup.exe').browser_download_url);
assert.equal(document.links.AppImage.href, asset('NamiO.AppImage').browser_download_url);
assert.match(document.links.deb.text.textContent, /Descargar .deb/);
for (const data of [
  { ...release, draft: true }, { ...release, prerelease: true },
  { ...release, tag_name: '<img onerror=alert(1)>' }, { ...release, assets: null },
]) {
  document = page();
  await updateRelease(document, async () => ({ ok: true, json: async () => data }));
  assert.equal(document.versions[0].textContent, '');
  assert.equal(document.links.exe.href, `${repository}/releases/latest`);
}
for (const fetchRelease of [async () => { throw new Error('offline'); }, async () => ({ ok: false }), async () => ({ ok: true, json: async () => { throw new Error('invalid JSON'); } })]) {
  document = page();
  await updateRelease(document, fetchRelease);
  assert.equal(document.links.exe.href, `${repository}/releases/latest`);
  assert.equal(document.versions[0].textContent, '');
}
document = page();
await updateRelease(document, async () => ({ ok: true, json: async () => ({ ...release, assets: [asset('NamiO.exe', 'https://evil.example/setup.exe'), asset('NamiO.arm64.exe'), asset('latest.yml'), asset('setup.exe.blockmap')] }) }));
assert.equal(document.links.exe.href, `${repository}/releases/latest`, 'missing or untrusted installers keep the fallback');
assert.equal(document.windows.textContent, '', 'do not claim availability for missing installers');
assert.equal(document.versions[0].textContent, version, 'published version remains valid when a platform is not yet uploaded');
console.log('Releases: version, official installers, missing assets, draft/prerelease and network fallback verified');
