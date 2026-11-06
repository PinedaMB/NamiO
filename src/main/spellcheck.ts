import { app, Menu, type BrowserWindow, type Session, type MenuItemConstructorOptions } from 'electron'
import { readSettings } from './settings'

export function setSpellcheckLanguage(session: Session, language: 'es' | 'en'): void {
  if (process.platform === 'darwin') return
  const available = session.availableSpellCheckerLanguages
  const selected = (language === 'es' ? ['es-MX', 'es', 'es-ES'] : ['en-US']).find(code => available.includes(code))
  if (!selected) throw new Error(`Spellcheck dictionary unavailable: ${language}`)
  session.setSpellCheckerLanguages([selected])
}

export async function setupSpellcheck(window: BrowserWindow): Promise<void> {
  const contents = window.webContents
  const settings = await readSettings()
  if (contents.isDestroyed()) return
  setSpellcheckLanguage(contents.session, settings.spellcheckLanguage ?? 'es')

  contents.on('context-menu', async (_event, params) => {
    if (!params.isEditable) return
    const settings = await readSettings()
    if (contents.isDestroyed()) return
    const es = (settings.language ?? app.getLocale()).startsWith('es')
    const items: MenuItemConstructorOptions[] = []
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions) {
        items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) })
      }
      if (!params.dictionarySuggestions.length) items.push({ label: es ? 'Sin sugerencias' : 'No suggestions', enabled: false })
      items.push({ label: es ? 'Añadir al diccionario' : 'Add to dictionary', click: () => { contents.session.addWordToSpellCheckerDictionary(params.misspelledWord) } })
      items.push({ type: 'separator' })
    }
    items.push(
      { role: 'undo', label: es ? 'Deshacer' : 'Undo', enabled: params.editFlags.canUndo },
      { role: 'redo', label: es ? 'Rehacer' : 'Redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', label: es ? 'Cortar' : 'Cut', enabled: params.editFlags.canCut },
      { role: 'copy', label: es ? 'Copiar' : 'Copy', enabled: params.editFlags.canCopy },
      { role: 'paste', label: es ? 'Pegar' : 'Paste', enabled: params.editFlags.canPaste },
      { role: 'selectAll', label: es ? 'Seleccionar todo' : 'Select all', enabled: params.editFlags.canSelectAll }
    )
    Menu.buildFromTemplate(items).popup({ window })
  })
}
