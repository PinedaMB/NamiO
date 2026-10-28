const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const exportsObject = {}
vm.runInNewContext(ts.transpile(fs.readFileSync('src/renderer/src/lib/emailTheme.ts', 'utf8'), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), { exports: exportsObject })
const { emailColor, darkenEmail } = exportsObject
assert.equal(emailColor('rgba(0, 0, 0, 0)', true), null)
assert.equal(emailColor('rgb(20, 20, 20)', true), null)
assert.equal(emailColor('rgb(255, 255, 255)', false), null)
const darkBackground = emailColor('rgb(255, 255, 255)', true)
const lightText = emailColor('rgb(0, 0, 0)', false)
function luminance(rgb) {
  const values = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722
}
assert.ok((luminance(lightText) + 0.05) / (luminance(darkBackground) + 0.05) >= 4.5)
function element(name, parent = null, picture = false) {
  return { name, parentElement: parent, namespaceURI: 'http://www.w3.org/1999/xhtml',
    styles: {}, style: { setProperty(property, value) { this.owner.styles[property] = value } },
    closest: () => picture,
    computed: { color: 'rgb(0, 0, 0)', backgroundColor: 'rgb(255, 255, 255)', backgroundImage: 'none', borderTopColor: 'rgb(255, 255, 255)', borderRightColor: 'rgb(255, 255, 255)', borderBottomColor: 'rgb(255, 255, 255)', borderLeftColor: 'rgb(255, 255, 255)' }
  }
}
const body = element('body'), text = element('text', body), image = element('image', body, true), background = element('background', body), caption = element('caption', background)
background.computed.backgroundImage = 'url(data:image/png;base64,abc)'
for (const el of [body, text, image, background, caption]) el.style.owner = el
body.querySelectorAll = () => [text, image, background, caption]
darkenEmail({ body, defaultView: { getComputedStyle: el => el.computed } })
assert.equal(text.styles.color, lightText)
assert.equal(text.styles['background-color'], darkBackground)
assert.equal(Object.keys(image.styles).length, 0)
assert.equal(Object.keys(background.styles).length, 0)
assert.equal(Object.keys(caption.styles).length, 0)
assert.ok(!fs.readFileSync('src/renderer/src/components/EmailBody.tsx', 'utf8').includes('filter: invert'))
console.log('Email theme: contrast, transparent colors and untouched images/background-image content passed')

const { applyEmailTheme } = exportsObject
const attributes = new Map([['style', 'color: black !important']])
const reversible = element('body')
reversible.style.owner = reversible
reversible.getAttribute = name => attributes.get(name) ?? null
reversible.setAttribute = (name, value) => { attributes.set(name, value); reversible.styles = {} }
reversible.removeAttribute = name => { attributes.delete(name); reversible.styles = {} }
reversible.querySelectorAll = () => []
const sheet = { textContent: '@media (prefers-color-scheme: dark) { p { color: white } }', media: '(prefers-color-scheme: light)' }
const originalCss = sheet.textContent
let currentTheme
const document = {
  body: reversible,
  defaultView: { getComputedStyle: el => el.computed },
  documentElement: { setAttribute: (_name, value) => { currentTheme = value } },
  querySelectorAll: () => [sheet]
}
for (let cycle = 0; cycle < 2; cycle++) {
  applyEmailTheme(document, 'dark')
  assert.equal(currentTheme, 'dark')
  assert.equal(reversible.styles.color, lightText)
  assert.ok(sheet.textContent.includes('(min-width: 0px)'))
  assert.equal(sheet.media, '(width: 0px)')
  applyEmailTheme(document, 'light')
  assert.equal(currentTheme, 'light')
  assert.equal(attributes.get('style'), 'color: black !important')
  assert.deepEqual(reversible.styles, { 'background-color': 'rgb(255, 255, 255)' })
  assert.equal(sheet.textContent, originalCss.replace('(prefers-color-scheme: dark)', '(width: 0px)'))
  assert.equal(sheet.media, '(min-width: 0px)')
}
console.log('Email theme: repeated toggles restore original inline styles and adapt original media queries')

const { emailBackground } = exportsObject
function surface(color, width, height, backgroundImage = 'none') {
  return { computed: { backgroundColor: color, backgroundImage }, getBoundingClientRect: () => ({ width, height }) }
}
const mainSurface = surface('rgb(41, 41, 41)', 700, 1000)
const smallSurface = surface('rgb(255, 0, 0)', 80, 30)
const transparent = surface('rgba(0, 0, 0, 0)', 900, 1500)
const picture = surface('rgb(255, 255, 255)', 900, 1500, 'url(image.png)')
const backgroundDocument = {
  body: { computed: { backgroundColor: 'rgb(20, 22, 27)' }, querySelectorAll: () => [transparent, smallSurface, mainSurface, picture] },
  defaultView: { getComputedStyle: el => el.computed }
}
assert.equal(emailBackground(backgroundDocument), 'rgb(41, 41, 41)')
backgroundDocument.body.querySelectorAll = () => [transparent]
assert.equal(emailBackground(backgroundDocument), 'rgb(20, 22, 27)')
console.log('Email background: largest content surface, ignoring transparent/image backgrounds, body fallback')
