import { describe, it, expect } from 'vitest'
import { reducer } from './AppContext'
import type { AppState, Theme } from '../types'

function theme(id: string, over: Partial<Theme> = {}): Theme {
  return {
    id, name: `Theme ${id}`, paperCount: 1, totalPapers: 2, coverageLabel: 'Moderate',
    profileMatch: null, blocks: [], sourceColumns: [], systemSourceColumns: [],
    ...over,
  }
}

function stateWith(over: Partial<AppState>): AppState {
  return { themes: [], activeThemeId: '', ...over } as unknown as AppState
}

describe('user-defined themes', () => {
  it('ADD_THEME appends the theme and makes it the active one', () => {
    const s = reducer(stateWith({ themes: [theme('a')], activeThemeId: 'a' }),
      { type: 'ADD_THEME', theme: theme('mine', { name: '  Barriers  ', userDefined: true }) })
    expect(s.themes.map(t => t.id)).toEqual(['a', 'mine'])
    expect(s.themes[1].name).toBe('Barriers')
    expect(s.activeThemeId).toBe('mine')
  })

  it('ADD_THEME ignores a blank name', () => {
    const before = stateWith({ themes: [theme('a')] })
    expect(reducer(before, { type: 'ADD_THEME', theme: theme('x', { name: '   ' }) })).toBe(before)
  })

  it('RENAME_THEME renames, and ignores a blank name', () => {
    const s = reducer(stateWith({ themes: [theme('a')] }), { type: 'RENAME_THEME', themeId: 'a', name: 'Costs' })
    expect(s.themes[0].name).toBe('Costs')
    expect(reducer(s, { type: 'RENAME_THEME', themeId: 'a', name: '  ' })).toBe(s)
  })

  it('REMOVE_THEME moves the selection off a deleted active theme', () => {
    const s = reducer(stateWith({ themes: [theme('a'), theme('b')], activeThemeId: 'a' }),
      { type: 'REMOVE_THEME', themeId: 'a' })
    expect(s.themes.map(t => t.id)).toEqual(['b'])
    expect(s.activeThemeId).toBe('b')
  })

  it('REMOVE_THEME leaves an unrelated selection alone', () => {
    const s = reducer(stateWith({ themes: [theme('a'), theme('b')], activeThemeId: 'b' }),
      { type: 'REMOVE_THEME', themeId: 'a' })
    expect(s.activeThemeId).toBe('b')
  })

  it('regenerating the synthesis replaces generated themes but keeps the reviewer’s own', () => {
    const s = reducer(
      stateWith({ themes: [theme('old-ai'), theme('mine', { userDefined: true })], activeThemeId: 'mine' }),
      { type: 'SET_THEMES', themes: [theme('new-ai')] },
    )
    expect(s.themes.map(t => t.id)).toEqual(['new-ai', 'mine'])
  })

  it('REMOVE_SYNTHESIS_BLOCK removes only that block from that theme', () => {
    const block = (id: string) => ({ id, blockType: 'focus' as const, title: id, content: '', paperCount: 0, avgConfidence: 0, isLowConfidence: false })
    const s = reducer(
      stateWith({ themes: [theme('a', { blocks: [block('b1'), block('b2')] }), theme('c', { blocks: [block('b1')] })] }),
      { type: 'REMOVE_SYNTHESIS_BLOCK', themeId: 'a', blockId: 'b1' },
    )
    expect(s.themes[0].blocks.map(b => b.id)).toEqual(['b2'])
    expect(s.themes[1].blocks.map(b => b.id)).toEqual(['b1'])
  })
})
