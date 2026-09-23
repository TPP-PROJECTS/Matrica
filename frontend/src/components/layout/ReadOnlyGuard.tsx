import type { ReactNode } from 'react'

/**
 * Swallow every interaction that could change the review.
 *
 * Review mode has to leave the screens themselves untouched — they are the same
 * components, rendered the same way — so the block happens at the boundary
 * instead of in each screen. Events are caught on the way down (capture phase),
 * before any handler inside sees them.
 *
 * What still works: scrolling, text selection, copying, and following a link.
 * Anything a viewer needs in order to read the review, in other words. Anything
 * a screen deliberately allows can opt back in with `data-review-allow`.
 */

/** Keys that move around or copy, rather than type. */
const READING_KEYS = new Set([
  'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown', 'Shift', 'Control', 'Alt', 'Meta',
])

/**
 * Whether review mode lets this interaction through.
 *
 * The *nearest* marker decides, so an allowed region can carry editing
 * controls inside it — a theme card may be clicked to select it, while the
 * rename and delete buttons on that same card are marked `data-review-block`.
 */
function allowed(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const marker = target.closest('[data-review-allow], [data-review-block]')
  return marker !== null && marker.hasAttribute('data-review-allow')
}

export function ReadOnlyGuard({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  if (!enabled) return <>{children}</>

  function block(e: React.SyntheticEvent) {
    if (allowed(e.target)) return
    e.preventDefault()
    e.stopPropagation()
  }

  function blockClick(e: React.MouseEvent) {
    if (allowed(e.target)) return
    // A link out to the paper or the vendor's site is reading, not editing.
    if (e.target instanceof Element && e.target.closest('a[href]')) return
    e.preventDefault()
    e.stopPropagation()
  }

  function blockKey(e: React.KeyboardEvent) {
    if (allowed(e.target)) return
    if (READING_KEYS.has(e.key)) return
    // ⌘C / ⌘A and friends copy and select; they change nothing.
    if (e.metaKey || e.ctrlKey) return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div
      className="contents"
      onClickCapture={blockClick}
      onDoubleClickCapture={blockClick}
      onKeyDownCapture={blockKey}
      onKeyPressCapture={blockKey}
      onBeforeInputCapture={block}
      onInputCapture={block}
      onChangeCapture={block}
      onPasteCapture={block}
      onCutCapture={block}
      onDropCapture={block}
      onSubmitCapture={block}
    >
      {children}
    </div>
  )
}
