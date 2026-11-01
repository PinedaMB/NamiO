const assert = require('node:assert/strict')
const fs = require('node:fs')

/** La bienvenida y el lector vacío deben hablar el mismo idioma visual que Calma. */
const css = fs.readFileSync('src/renderer/src/styles/app.css', 'utf8')
const onboarding = fs.readFileSync('src/renderer/src/components/Onboarding.tsx', 'utf8')
const threadPane = fs.readFileSync('src/renderer/src/components/ThreadPane.tsx', 'utf8')

function block(selector) {
  const start = css.indexOf(selector)
  assert.notEqual(start, -1, `missing CSS selector ${selector}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

function has(selector, pattern, label) {
  assert.match(block(selector), pattern, label)
}

has('.onboarding {', /background:\s*var\(--surface\)/, 'welcome uses the base surface')
assert.doesNotMatch(block('.onboarding {'), /gradient|backdrop-filter|blur\(/, 'welcome has no decorative gradients')
has('.onboarding__panel', /width:\s*min\(620px, 100%\)[\s\S]*gap:\s*24px/, 'welcome uses the settings rhythm')
has('.onboarding__title', /font-size:\s*26px[\s\S]*line-height:\s*34px/, 'welcome title role')
has('.onboarding__subtitle', /font-size:\s*13px[\s\S]*line-height:\s*20px/, 'welcome description role')
has('.onboarding__grid', /flex-direction:\s*column[\s\S]*border-top:\s*1px solid var\(--surface-container-highest\)/, 'account choices use flat dividers')
has('.onboarding__card {', /border-radius:\s*0[\s\S]*background:\s*transparent/, 'account choices are not cards')
assert.doesNotMatch(block('.onboarding__card {'), /transform|translateY/, 'account choices do not lift')
has('.onboarding__logo', /object-fit:\s*contain/, 'brand logo remains')
assert.doesNotMatch(block('.onboarding__logo'), /drop-shadow|filter:/, 'brand logo is not glowed')
has('.onboarding__form {', /border:\s*0[\s\S]*background:\s*transparent/, 'the form is a flat section')
has('.onboarding__demo', /background:\s*transparent/, 'demo action uses the quiet button pattern')

has('.mail-welcome h1', /font-size:\s*26px[\s\S]*line-height:\s*34px/, 'reader welcome title role')
has('.mail-welcome__hint', /font-size:\s*13px[\s\S]*line-height:\s*20px/, 'reader welcome description role')
has('.mail-welcome__actions', /border-top:\s*1px solid var\(--surface-container-highest\)/, 'reader actions use flat dividers')
has('.mail-welcome__action {', /border-radius:\s*0[\s\S]*background:\s*transparent/, 'reader actions are flat rows')
has('.mail-welcome__action[data-primary]', /background:\s*transparent/, 'the primary action is not a filled card')
has('.mail-welcome__footer', /font-size:\s*13px[\s\S]*line-height:\s*20px/, 'reader footer follows the description role')

has('.boot {', /background:\s*var\(--surface\)/, 'boot splash uses the base surface')
assert.doesNotMatch(block('.boot {'), /gradient|filter:/, 'boot splash has no gradient')
assert.doesNotMatch(block('.boot__logo'), /drop-shadow|filter:/, 'boot logo is not glowed')
has('.boot__bar-fill', /background:\s*var\(--primary\)/, 'boot progress uses the primary token')

assert.match(onboarding, /className="onboarding__brand"/, 'welcome keeps the NamiO wordmark')
assert.match(onboarding, /className="onboarding__grid"/, 'welcome keeps the account choice list')
assert.match(threadPane, /className="mail-welcome__brand"/, 'reader welcome keeps the brand lockup')
assert.match(threadPane, /className="mail-welcome__wordmark"/, 'reader welcome shows the NamiO wordmark')
assert.doesNotMatch(threadPane, /mail-welcome__action[\s\S]*?<kbd/, 'reader welcome does not expose permanent shortcuts')
assert.match(threadPane, /className="mail-welcome"/, 'reader welcome keeps its structure')
assert.match(threadPane, /className="mail-welcome__logo"/, 'reader welcome keeps the brand')

console.log('Welcome identity: flat surfaces, Calma type scale, divider rows and brand assets verified')
