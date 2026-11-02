const assert = require('node:assert/strict')
const fs = require('node:fs')

/** Contrato estático del patrón “Calma” para Configuración. */
const css = fs.readFileSync('src/renderer/src/styles/app.css', 'utf8')
const settings = fs.readFileSync('src/renderer/src/components/Settings.tsx', 'utf8')
const rules = fs.readFileSync('src/renderer/src/components/RulesSection.tsx', 'utf8')

function block(selector) {
  const start = css.indexOf(selector === '.account-modal' ? '\n.account-modal {' : selector)
  assert.notEqual(start, -1, `missing CSS selector ${selector}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

function has(selector, pattern, label) {
  assert.match(block(selector), pattern, label)
}

has('.settings {', /max-width:\s*1120px/, 'settings max width')
has('.settings {', /padding:\s*32px 36px/, 'settings desktop padding')
has('.settings {', /overflow:\s*hidden/, 'the page shell does not scroll')
has('.settings__grid', /flex:\s*1[\s\S]*min-height:\s*0/, 'the grid fills the remaining height')
has('.settings__main', /overflow-y:\s*auto/, 'only the content column scrolls')
has('.settings__aside', /align-self:\s*start/, 'the navigation stays at the top')
has('.settings__title', /font-size:\s*26px[\s\S]*line-height:\s*34px/, 'settings title role')
has('.settings__grid', /grid-template-columns:\s*190px minmax\(0,\s*1fr\)/, 'settings navigation column')
has('.settings__grid', /gap:\s*40px/, 'settings column gap')
has('.settings-stack', /gap:\s*28px/, 'section stack')
has('.settings-card {', /background:\s*transparent/, 'sections are flat')
has('.settings-card {', /border-radius:\s*0/, 'sections have no card radius')
has('.settings-card {', /padding:\s*0/, 'sections have no card padding')
assert.match(css, /\.settings-stack > \.settings-card \+ \.settings-card \{[^}]*border-top:\s*1px solid var\(--surface-container-highest\)/, 'sections use hairline dividers')
has('.settings-card__title', /font-size:\s*16px[\s\S]*line-height:\s*24px/, 'section title role')
has('.settings-card__subtitle', /font-size:\s*13px[\s\S]*line-height:\s*20px/, 'section description role')
has('.settings-nav__item--active', /background:\s*var\(--selection-surface\)[\s\S]*color:\s*var\(--primary\)/, 'selected navigation')
has('.settings .seg__btn', /font-family:\s*var\(--font-sans\)[\s\S]*font-size:\s*13px/, 'settings segmented controls use sans')
has('.notification-option__text p', /font-size:\s*13px[\s\S]*line-height:\s*20px/, 'secondary descriptions follow settings type')
has('.settings-about__name', /font-size:\s*26px[\s\S]*line-height:\s*34px/, 'about identity follows title role')
has('.settings-about__description', /font-size:\s*13px[\s\S]*line-height:\s*20px/, 'about description follows settings type')
has('.account-modal', /padding:\s*28px/, 'account dialog padding')
has('.account-modal', /width:\s*min\(600px,\s*100%\)/, 'account dialog width')

for (const media of [960, 520]) assert.match(css, new RegExp(`@media \\(max-width: ${media}px\\)[\\s\\S]{0,1800}?\\.settings`), `settings responsive at ${media}px`)
assert.match(css, /@media \(max-width: 960px\)[\s\S]{0,600}?\.settings-nav \{ display: grid; grid-template-columns: repeat\(3,/, 'three-column settings nav')
assert.match(css, /@media \(max-width: 520px\)[\s\S]{0,900}?\.settings-nav \{ grid-template-columns: repeat\(2,/, 'two-column settings nav')
assert.match(css, /@media \(max-width: 520px\)[\s\S]{0,900}?\.account-modal, \.remap \{ padding: 20px/, 'dialog padding at 520px')

assert.doesNotMatch(block('.settings-card {'), /linear-gradient|radial-gradient|backdrop-filter|blur\(/, 'flat sections cannot use gradients or blur')
assert.doesNotMatch(css, /\.rules \.settings-card__title \{ font-size: 20px/, 'rules follows the section-title role')

for (const id of ['general', 'shortcuts', 'accounts', 'copilot', 'rules', 'about']) {
  assert.match(settings, new RegExp(`id:\\s*'${id}'`), `navigation entry ${id}`)
}
assert.match(settings, /className="settings__hero"/, 'settings header pattern')
assert.match(settings, /className="settings__grid"/, 'settings grid pattern')
assert.match(settings, /<nav className="settings-nav"/, 'settings navigation pattern')
assert.match(settings, /<main className="settings__main"/, 'settings content pattern')
assert.match(settings, /settings-stack settings-about-page/, 'about uses the section stack')
assert.match(rules, /className="settings-stack"/, 'rules uses the section stack')
assert.match(rules, /className="settings-card rules"/, 'rules uses the flat section pattern')

// Una declaración huérfana fuera de un bloque es CSS inválido aunque el
// navegador la ignore: la detectamos antes de que vuelva a colarse.
let depth = 0
for (const raw of css.split(/\r?\n/)) {
  const line = raw.replace(/\/\*.*?\*\//g, '').trim()
  if (line === '') continue
  if (depth === 0 && /^[a-z-]+\s*:/.test(line) && !line.startsWith('@')) {
    assert.fail(`stray CSS declaration outside a rule: ${line}`)
  }
  for (const character of line) {
    if (character === '{') depth += 1
    else if (character === '}') depth = Math.max(0, depth - 1)
  }
}
assert.equal(depth, 0, 'CSS blocks are balanced')

console.log('Settings design: header, 190/40 grid, flat sections, typography, controls, dialogs and responsive breakpoints match Calma')
