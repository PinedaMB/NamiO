const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript-test')
const compile = text => ts.transpile(text, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })

/** El renderer solo ve ajustes públicos y solo puede escribir claves conocidas. */
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'namio-settings-allowlist-'))
  const settings = {}
  vm.runInNewContext(compile(await fs.readFile('src/main/settings.ts', 'utf8')), {
    exports: settings,
    require: id => id === 'electron' ? { app: { getPath: () => directory }, safeStorage: {} } : require(id)
  })

  try {
    await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({
      language: 'es',
      appTheme: 'dark',
      shortcuts: { next: 'j' },
      onboarded: true,
      accounts: [{
        id: 'one', host: 'imap.example.com', port: 993, secure: true, user: 'person@example.com',
        smtp: { host: 'smtp.example.com', port: 465, secure: true },
        secret: 'encrypted-password', refreshToken: 'encrypted-refresh',
        oauth: { provider: 'custom', clientId: 'client', clientSecret: 'plain-secret' }
      }],
      activeAccount: 'one',
      mailNotificationCursors: { one: { uidValidity: 7, uidNext: 9 } }
    }))

    const publicSettings = await settings.readAppSettings()
    assert.deepEqual(Object.keys(publicSettings).sort(), ['appTheme', 'language', 'onboarded', 'shortcuts'])
    assert.equal(publicSettings.accounts, undefined, 'accounts never reach the renderer')
    assert.equal(publicSettings.activeAccount, undefined)
    assert.equal(publicSettings.mailNotificationCursors, undefined)
    assert.ok(!JSON.stringify(publicSettings).includes('secret'), 'encrypted credentials are not projected')
    assert.equal(publicSettings.language, 'es')
    assert.equal(publicSettings.shortcuts.next, 'j')

    const valid = {
      appTheme: 'light', offlineDownload: true, keepInBackground: true, notifications: false,
      notificationSound: false, notificationPrivate: false, language: 'en', shortcuts: { next: 'k' },
      shortcutModifier: 'command', contextPanel: true, remoteImages: 'allow', timeFormat: '12h',
      bodyTheme: 'dark', onboarded: true
    }
    const clean = settings.sanitizeSettingsPatch(valid)
    assert.deepEqual(JSON.parse(JSON.stringify(clean)), valid, 'valid settings survive unchanged')
    assert.deepEqual(Object.keys(settings.sanitizeSettingsPatch({})), [])

    for (const invalid of [
      { accounts: [] },
      { activeAccount: 'two' },
      { mailNotificationCursors: {} },
      JSON.parse('{"__proto__": {"polluted": true}}')
    ]) {
      assert.throws(() => settings.sanitizeSettingsPatch(invalid), /Unknown setting/)
    }

    assert.throws(() => settings.sanitizeSettingsPatch({ appTheme: 'blue' }), /Invalid app theme/)
    assert.throws(() => settings.sanitizeSettingsPatch({ timeFormat: 'auto' }), /Invalid time format/)
    assert.throws(() => settings.sanitizeSettingsPatch({ shortcutModifier: 'meta' }), /Invalid shortcut modifier/)
    assert.throws(() => settings.sanitizeSettingsPatch({ notifications: 'yes' }), /Invalid setting value/)
    assert.throws(() => settings.sanitizeSettingsPatch({ shortcuts: 'j' }), /Invalid shortcuts/)
    assert.throws(() => settings.sanitizeSettingsPatch({ shortcuts: { next: 1 } }), /Invalid shortcuts/)
    assert.throws(() => settings.sanitizeSettingsPatch({ shortcuts: { next: 'j\nk' } }), /Invalid shortcuts/)
    assert.throws(() => settings.sanitizeSettingsPatch({ shortcuts: { 'bad key': 'j' } }), /Invalid shortcuts/)
    assert.throws(() => settings.sanitizeSettingsPatch({ shortcuts: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`k${index}`, 'j'])) }), /Invalid shortcuts/)

    console.log('Settings allowlist: public projection excludes credentials; unknown keys, internal settings and invalid types are rejected')
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
