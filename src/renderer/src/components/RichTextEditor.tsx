import { EditorContent, Mark, Node, ResizableNodeView, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { useEffect, useState } from 'react'
import { useI18n, type TranslationKey } from '../i18n'
import { cleanComposeHtml, composeImageWidth, isComposeImage, isComposeLink, MAX_COMPOSE_IMAGE_BYTES, textToEditorContent } from '../lib/composeHtml'
import { Icon } from './Icon'
import { TooltipButton } from './Tooltip'

import { Select } from './Select'
import { ColorPicker } from './ColorPicker'

const ImageNode = Node.create({
  name: 'image', group: 'inline', inline: true, atom: true, draggable: true,
  addAttributes() { return { src: { default: null }, alt: { default: '' }, width: { default: null, parseHTML: element => composeImageWidth(element.getAttribute('width')) } } },
  parseHTML() { return [{ tag: 'img[src]', getAttrs: element => isComposeImage(element.getAttribute('src') ?? '') ? null : false }] },
  renderHTML({ HTMLAttributes }) { return ['img', HTMLAttributes] },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const image = document.createElement('img')
      const updateImage = (current: typeof node): void => {
        image.src = current.attrs.src
        image.alt = current.attrs.alt
        image.style.width = current.attrs.width ? `${current.attrs.width}px` : ''
        image.style.height = 'auto'
      }
      updateImage(node)
      return new ResizableNodeView({
        element: image, node, editor, getPos,
        options: { preserveAspectRatio: true, directions: ['bottom-right'], max: { width: 4096 } },
        onCommit: width => {
          const position = getPos()
          if (position !== undefined) editor.chain().setNodeSelection(position).updateAttributes('image', { width: Math.max(1, Math.round(width)) }).setNodeSelection(position).run()
        },
        onUpdate: current => { updateImage(current); return true }
      })
    }
  }
})

const TextStyle = Mark.create({
  name: 'textStyle',
  addAttributes() {
    return Object.fromEntries(([['color', 'color'], ['backgroundColor', 'background-color'], ['fontSize', 'font-size']] as const).map(([name, property]) => [name, {
      default: null,
      parseHTML: (element: HTMLElement) => element.style.getPropertyValue(property) || null,
      renderHTML: (attributes: Record<string, string | null>) => attributes[name] ? { style: `${property}:${attributes[name]}` } : {}
    }]))
  },
  parseHTML() { return [{ tag: 'span[style]' }] },
  renderHTML({ HTMLAttributes }) { return ['span', HTMLAttributes, 0] }
})

function colorHex(value: string | undefined, fallback: string): string {
  if (/^#[\da-f]{6}$/i.test(value ?? '')) return value!
  const rgb = value?.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  return rgb ? `#${rgb.slice(1, 4).map(channel => Number(channel).toString(16).padStart(2, '0')).join('')}` : fallback
}

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
  const [pasteError, setPasteError] = useState<string | null>(null)
  const instance = useEditor({
    immediatelyRender: false, // Suspense puede descartar una instancia creada durante el render.
    extensions: [StarterKit.configure({
      heading: false, codeBlock: false, horizontalRule: false, strike: false,
      link: { openOnClick: false, defaultProtocol: 'https', isAllowedUri: isComposeLink }
    }), TextStyle, ImageNode],
    content: html ? cleanComposeHtml(html) : textToEditorContent(text),
    editable: !disabled,
    editorProps: {
      attributes: { class: 'rich-editor__content', role: 'textbox', 'aria-multiline': 'true', 'aria-label': t('compose.placeholder'), 'data-placeholder': t('compose.placeholder'), spellcheck: 'true' },
      transformPastedHTML: cleanComposeHtml,
      decorations(state) {
        const { empty, $from } = state.selection
        if (!empty) return null
        const after = $from.nodeBefore?.type.name === 'image'
        if (!after && $from.nodeAfter?.type.name !== 'image') return null
        const position = $from.pos - (after ? 1 : 0)
        return DecorationSet.create(state.doc, [Decoration.node(position, position + 1, { 'data-image-caret': after ? 'after' : 'before' })])
      },
      handlePaste(view, event) {
        const files = [...(event.clipboardData?.files ?? [])].filter(file => file.type.startsWith('image/'))
        setPasteError(null)
        if (!files.length) return false
        event.preventDefault()
        if (files.some(file => !/^image\/(png|jpeg|gif|webp)$/.test(file.type) || file.size > MAX_COMPOSE_IMAGE_BYTES)) {
          setPasteError(t('compose.imageLimit'))
          return true
        }
        void Promise.all(files.map(file => new Promise<{ src: string; alt: string }>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => typeof reader.result === 'string' && isComposeImage(reader.result)
            ? resolve({ src: reader.result, alt: file.name || t('compose.pastedImage') }) : reject(new Error(t('compose.imageFailed')))
          reader.onerror = () => reject(new Error(t('compose.imageFailed')))
          reader.readAsDataURL(file)
        }))).then(images => {
          if (view.isDestroyed || !view.editable) return
          for (const image of images) view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.image!.create(image)))
          view.focus()
        }).catch(() => { if (!view.isDestroyed) setPasteError(t('compose.imageFailed')) })
        return true
      }
    },
    onUpdate: ({ editor }) => onChange(editor.getText({ blockSeparator: '\n' }), cleanComposeHtml(editor.getHTML()))
  })
  const editor = instance && !instance.isDestroyed ? instance : null
  useEditorState({ editor, selector: ({ editor }) => editor ? { textStyle: editor.getAttributes('textStyle'), image: editor.isActive('image') ? editor.getAttributes('image') : null, active: ['bold', 'italic', 'underline', 'link', 'bulletList', 'orderedList', 'blockquote'].map(mark => editor.isActive(mark)), undo: editor.can().undo(), redo: editor.can().redo() } : null })

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const matches = html ? cleanComposeHtml(editor.getHTML()) === html : editor.getText({ blockSeparator: '\n' }) === text
    if (!matches) editor.commands.setContent(html ? cleanComposeHtml(html) : textToEditorContent(text), { emitUpdate: false })
  }, [editor, text, html])

  useEffect(() => { if (editor && !editor.isDestroyed) editor.setEditable(!disabled) }, [editor, disabled])
  useEffect(() => { if (editor && !editor.isDestroyed) editor.setOptions({ editorProps: { ...editor.options.editorProps, attributes: { class: 'rich-editor__content', role: 'textbox', 'aria-multiline': 'true', 'aria-label': t('compose.placeholder'), 'data-placeholder': t('compose.placeholder'), spellcheck: 'true' } } }) }, [editor, t])

  const style = editor?.getAttributes('textStyle') ?? {}
  const changeStyle = (attribute: string, value: string | null): void => {
    editor?.chain().focus().setMark('textStyle', { [attribute]: value }).run()
  }
  const resizeImage = (width: number | null): void => {
    if (!editor?.isActive('image')) return
    const position = editor.state.selection.from
    editor.chain().updateAttributes('image', { width }).setNodeSelection(position).run()
  }

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
        <Select className="formatbar__size" aria-label={t('compose.format.size')} value={style.fontSize ?? ''} disabled={disabled || !editor}
          onChange={event => changeStyle('fontSize', event.target.value || null)}>
          <option value="">{t('compose.format.defaultSize')}</option>
          {![12, 14, 16, 18, 20, 24, 32, 48].map(size => `${size}px`).includes(style.fontSize) && style.fontSize && <option value={style.fontSize}>{style.fontSize}</option>}
          {[12, 14, 16, 18, 20, 24, 32, 48].map(size => <option key={size} value={`${size}px`}>{size} px</option>)}
        </Select>
        {(['color', 'backgroundColor'] as const).map(attribute => <ColorPicker key={attribute}
          highlight={attribute === 'backgroundColor'} value={style[attribute] ? colorHex(style[attribute], '#000000') : undefined}
          disabled={disabled || !editor} onChange={value => changeStyle(attribute, value)} />)}
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
    {editor?.isActive('image') && <div className="rich-editor__image-tools" data-editor-popup>
      <label>{t('compose.imageWidth')} <input type="number" min="1" max="4096" step="1" value={editor.getAttributes('image').width ?? ''} placeholder={t('compose.imageOriginal')}
        disabled={disabled} onChange={event => resizeImage(composeImageWidth(event.target.value))} /></label>
      <button type="button" className="tool-btn" disabled={disabled} onClick={() => resizeImage(null)}>{t('compose.imageOriginal')}</button>
      <span>{t('compose.imageResizeHint')}</span>
    </div>}
    {pasteError && <p className="account-error" role="alert">{pasteError}</p>}
    <div className="composer__body">
      <EditorContent editor={editor} className="rich-editor" />
      {children}
    </div>
  </>
}
