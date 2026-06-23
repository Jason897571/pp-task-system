import type { ClipboardEvent } from 'react'

// Pull image files out of a clipboard paste (screenshots / copied images), giving
// each a unique readable name (clipboard images all arrive as "image.png").
let _pasteSeq = 0
export function imagesFromClipboard(e: ClipboardEvent): File[] {
  const items = e.clipboardData?.items
  if (!items) return []
  const out: File[] = []
  for (const it of Array.from(items)) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile()
      if (!f) continue
      _pasteSeq += 1
      const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
      out.push(new File([f], `粘贴图片-${_pasteSeq}.${ext}`, { type: f.type }))
    }
  }
  return out
}
