import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useState } from 'react'
import { useI18n, type TranslationKey } from '../i18n'
import { cleanComposeHtml, isComposeLink, textToEditorContent } from '../lib/composeHtml'
import { Icon } from './Icon'
import { TooltipButton } from './Tooltip'

interface RichTextEditorProps {
  text: string
  html?: string
  disabled: boolean
  onChange: (text: string, html: string) => void
  onAttach?: () => void
  children: React.ReactNode
}

export function RichTextEditor({ text, html, disabled, onChange, onAttach, children }: RichTextEditorProps): React.JSX.Element {
  const { t } = useI18n()
  const [linkOpen, setLinkOpen] = useState(false)
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState(false)
  const instance = useEditor({
    immediatelyRender: false, // Suspense puede descartar una instancia creada durante el render.
    extensions: [StarterKit.configure({
      heading: false, codeBlock: false, horizontalRule: false, strike: false,
      link: { openOnClick: false, defaultProtocol: 'https', isAllowedUri: isComposeLink }
    })],
    content: html ? cleanComposeHtml(html) : textToEditorContent(text),
    editable: !disabled,
    editorProps: {
      attributes: { class: 'rich-editor__content', role: 'textbox', 'aria-multiline': 'true', 'aria-label': t('compose.placeholder'), 'data-placeholder': t('compose.placeholder'), spellcheck: 'true' },
      transformPastedHTML: cleanComposeHtml
    },
    onUpdate: ({ editor }) => onChange(editor.getText({ blockSeparator: '\n' }), cleanComposeHtml(editor.getHTML()))
  })
  const editor = instance && !instance.isDestroyed ? instance : null
  useEditorState({ editor, selector: ({ editor }) => editor ? { active: ['bold', 'italic', 'underline', 'link', 'bulletList', 'orderedList', 'blockquote'].map(mark => editor.isActive(mark)), undo: editor.can().undo(), redo: editor.can().redo() } : null })

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const matches = html ? cleanComposeHtml(editor.getHTML()) === html : editor.getText({ blockSeparator: '\n' }) === text
    if (!matches) editor.commands.setContent(html ? cleanComposeHtml(html) : textToEditorContent(text), { emitUpdate: false })
  }, [editor, text, html])

  useEffect(() => { if (editor && !editor.isDestroyed) editor.setEditable(!disabled) }, [editor, disabled])
  useEffect(() => { if (editor && !editor.isDestroyed) editor.setOptions({ editorProps: { ...editor.options.editorProps, attributes: { class: 'rich-editor__content', role: 'textbox', 'aria-multiline': 'true', 'aria-label': t('compose.placeholder'), 'data-placeholder': t('compose.placeholder'), spellcheck: 'true' } } }) }, [editor, t])

  const tools: { label: TranslationKey; icon: string; active?: boolean; disabled?: boolean; run: () => void }[] = [
    { label: 'compose.format.bold', icon: 'format_bold', active: editor?.isActive('bold'), run: () => { editor?.chain().focus().toggleBold().run() } },
    { label: 'compose.format.italic', icon: 'format_italic', active: editor?.isActive('italic'), run: () => { editor?.chain().focus().toggleItalic().run() } },
    { label: 'compose.format.underline', icon: 'format_underlined', active: editor?.isActive('underline'), run: () => { editor?.chain().focus().toggleUnderline().run() } },
    { label: 'compose.format.link', icon: 'link', active: editor?.isActive('link'), run: () => { setLink(editor?.getAttributes('link').href ?? ''); setLinkError(false); setLinkOpen(value => !value) } },
    { label: 'compose.format.bullets', icon: 'format_list_bulleted', active: editor?.isActive('bulletList'), run: () => { editor?.chain().focus().toggleBulletList().run() } },
    { label: 'compose.format.numbered', icon: 'format_list_numbered', active: editor?.isActive('orderedList'), run: () => { editor?.chain().focus().toggleOrderedList().run() } },
    { label: 'compose.format.quote', icon: 'format_quote', active: editor?.isActive('blockquote'), run: () => { editor?.chain().focus().toggleBlockquote().run() } },
    { label: 'compose.format.undo', icon: 'undo', disabled: !editor?.can().undo(), run: () => { editor?.chain().focus().undo().run() } },
    { label: 'compose.format.redo', icon: 'redo', disabled: !editor?.can().redo(), run: () => { editor?.chain().focus().redo().run() } }
  ]

  return <>
    <div className="formatbar" role="group" aria-label={t('compose.format.title')}>
      <div className="formatbar__tools">
        {tools.map(tool => <TooltipButton key={tool.label} className="icon-btn" type="button" title={t(tool.label)}
          aria-pressed={tool.active} disabled={disabled || !editor || tool.disabled}
          onMouseDown={event => event.preventDefault()} onClick={tool.run}><Icon name={tool.icon} size={17} /></TooltipButton>)}
        <span className="formatbar__sep" />
        <TooltipButton className="icon-btn" type="button" title={t('compose.attach')} disabled={disabled || !onAttach} onClick={onAttach}><Icon name="attach_file" size={17} /></TooltipButton>
      </div>
    </div>
    {linkOpen && <form className="rich-editor__link" data-editor-popup onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setLinkOpen(false) } }} onSubmit={event => {
      event.preventDefault()
      const href = link.trim()
      if (href && !isComposeLink(href)) { setLinkError(true); return }
      if (href) {
        if (editor?.state.selection.empty && !editor.isActive('link')) editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run()
        else editor?.chain().focus().extendMarkRange('link').setLink({ href }).run()
      } else editor?.chain().focus().extendMarkRange('link').unsetLink().run()
      setLinkOpen(false)
    }}>
      <input aria-label={t('compose.format.link')} aria-invalid={linkError || undefined} value={link} onChange={event => { setLink(event.target.value); setLinkError(false) }} placeholder="https://" autoFocus />
      <button className="tool-btn" type="submit">{t('compose.format.applyLink')}</button>
      <button className="tool-btn" type="button" onClick={() => setLinkOpen(false)}>{t('common.close')}</button>
      {linkError && <span role="alert">{t('compose.format.invalidLink')}</span>}
    </form>}
    <div className="composer__body">
      <EditorContent editor={editor} className="rich-editor" />
      {children}
    </div>
  </>
}
