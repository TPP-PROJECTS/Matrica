import { useState, useEffect, useRef } from 'react'
import { useApp } from '../store/AppContext'
import { API, apiFetch } from '../lib/api'
import { SchemaBuilder } from '../components/matrix/SchemaBuilder'

const FIXED_LIT = new Set(['#', 'Title', 'Authors', 'Year'])
const FIXED_SYS = new Set(['System Name', 'Vendor', 'Category'])

const JSON_HEADERS = { 'Content-Type': 'application/json' }

// Drop descriptions for columns already chosen, so regenerate never rewrites them.
function newColumnDescriptions(descriptions: Record<string, string> | undefined, exclude: string[]): Record<string, string> {
  if (!descriptions) return {}
  const ex = new Set(exclude.map(c => c.toLowerCase().trim()))
  return Object.fromEntries(Object.entries(descriptions).filter(([k]) => !ex.has(k.toLowerCase().trim())))
}

export function ScreenMatrixInit() {
  const { state, dispatch } = useApp()
  const [litLoading, setLitLoading] = useState(false)
  const [sysLoading, setSysLoading] = useState(false)
  const [error, setError] = useState(false)
  const [rationale, setRationale] = useState('')
  const [litPrompt, setLitPrompt] = useState<string | null>(null)
  const [sysPrompt, setSysPrompt] = useState<string | null>(null)
  const didInit = useRef(false)

  const litSelected = state.matrixColumns.filter(c => !FIXED_LIT.has(c))
  const sysSelected = (state.systemMatrixColumns ?? []).filter(c => !FIXED_SYS.has(c))

  const topicsPayload = state.topics.map(t => ({ title: t.title, description: t.description, type: t.type }))

  async function genLiterature(prompt?: string | null) {
    setLitPrompt(prompt ?? null)
    setLitLoading(true); setError(false)
    try {
      const res = await apiFetch(`${API}/matrix/generate-columns`, {
        method: 'POST', headers: JSON_HEADERS,
        body: JSON.stringify({
          papers: [], topics: topicsPayload, profile: state.profile,
          exclude_columns: litSelected,
          custom_system_prompt: prompt ?? null,
        }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      dispatch({ type: 'SET_MATRIX_COLUMN_SUGGESTIONS', columns: data.columns })
      const descs = newColumnDescriptions(data.descriptions, litSelected)
      if (Object.keys(descs).length) dispatch({ type: 'MERGE_COLUMN_DESCRIPTIONS', system: false, descriptions: descs })
    } catch { setError(true) } finally { setLitLoading(false) }
  }

  async function genSystem(prompt: string | null, initial: boolean) {
    setSysPrompt(prompt)
    setSysLoading(true)
    try {
      const res = await apiFetch(`${API}/matrix/assess-system-schema`, {
        method: 'POST', headers: JSON_HEADERS,
        body: JSON.stringify({ profile: state.profile, topics: topicsPayload, exclude_columns: sysSelected, custom_system_prompt: prompt }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRationale(data.rationale || '')
      dispatch({ type: 'SET_SYSTEM_MATRIX_COLUMN_SUGGESTIONS', columns: data.columns })
      const descs = newColumnDescriptions(data.descriptions, sysSelected)
      if (Object.keys(descs).length) dispatch({ type: 'MERGE_COLUMN_DESCRIPTIONS', system: true, descriptions: descs })
      // The LLM only decides "needed?" on the first, automatic assessment. Manual
      // regenerate refreshes column suggestions without overriding the user's toggle.
      if (initial) dispatch({ type: 'SET_SYSTEM_MATRIX_ENABLED', enabled: !!data.recommended })
    } catch { /* leave prior state */ } finally { setSysLoading(false) }
  }

  // Auto-generate the initial schema (profile-only) the first time this step is opened.
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    if (state.matrixColumnSuggestions.length === 0) {
      // Start curation from a clean slate (drop any mock-seeded columns).
      dispatch({ type: 'SET_MATRIX_COLUMNS', columns: [] })
      dispatch({ type: 'SET_SYSTEM_MATRIX_COLUMNS', columns: [] })
      genLiterature()
      genSystem(null, true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-[44px] bg-zinc-50 border-b border-zinc-200 flex items-center px-4 gap-3 shrink-0">
        <div className="w-7 h-7 rounded-full bg-zinc-900 flex items-center justify-center text-white text-[11px] shrink-0">✦</div>
        <div className="flex flex-col">
          <span className="text-[13px] font-bold text-zinc-900 leading-tight">Matrix Initial</span>
          <span className="text-[10px] text-zinc-500 leading-tight">
            Choose the columns your extraction matrix will use — move the AI's recommendations into your schema
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-7">
        {error && litSelected.length === 0 && state.matrixColumnSuggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <p className="text-[13px] text-zinc-500">Could not generate a schema. Make sure the backend is running.</p>
            <button onClick={() => genLiterature()} className="px-4 h-8 bg-zinc-900 text-white rounded text-[12px] hover:bg-zinc-700">Retry</button>
          </div>
        ) : (
          <>
            <SchemaBuilder
              title="Literature Matrix"
              accent="zinc"
              available={state.matrixColumnSuggestions}
              selected={litSelected}
              descriptions={state.columnDescriptions}
              loading={litLoading}
              customPrompt={litPrompt}
              promptKey="matrix-lit-columns"
              promptTitle="Literature Matrix Columns"
              onRegenerate={genLiterature}
              onChange={cols => dispatch({ type: 'SET_MATRIX_COLUMNS', columns: cols })}
            />

            {/* System matrix — only when the LLM judges it relevant, with a manual override */}
            <div className="border-t border-zinc-200 pt-5 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={state.systemMatrixEnabled}
                  onChange={e => dispatch({ type: 'SET_SYSTEM_MATRIX_ENABLED', enabled: e.target.checked })}
                  className="accent-violet-600"
                />
                <span className="text-[12px] font-bold text-zinc-900">Include a system comparison matrix</span>
                {sysLoading && <span className="w-3 h-3 border border-violet-300 border-t-violet-600 rounded-full animate-spin" />}
              </label>
              {rationale && (
                <p className="text-[11px] text-zinc-500 pl-6">
                  <span className="font-semibold text-zinc-600">AI:</span> {rationale}
                </p>
              )}
              {state.systemMatrixEnabled && (
                <div className="pl-6">
                  <SchemaBuilder
                    title="System matrix columns"
                    accent="violet"
                    available={state.systemMatrixColumnSuggestions}
                    selected={sysSelected}
                    descriptions={state.systemColumnDescriptions}
                    loading={sysLoading}
                    customPrompt={sysPrompt}
                    promptKey="matrix-sys-columns"
                    promptTitle="System Matrix Columns"
                    onRegenerate={p => genSystem(p ?? null, false)}
                    onChange={cols => dispatch({ type: 'SET_SYSTEM_MATRIX_COLUMNS', columns: cols })}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="h-[52px] border-t border-zinc-200 flex items-center justify-between px-5 shrink-0 bg-white">
        <span className="text-[11px] text-zinc-500">
          {litSelected.length} literature{state.systemMatrixEnabled ? ` · ${sysSelected.length} system` : ''} column{litSelected.length === 1 ? '' : 's'} selected
        </span>
        <button
          onClick={() => dispatch({ type: 'ADVANCE_STEP' })}
          className="px-5 h-9 bg-zinc-900 text-white rounded text-[12px] font-semibold hover:bg-zinc-700 transition-colors"
        >
          Continue →
        </button>
      </div>
    </div>
  )
}
