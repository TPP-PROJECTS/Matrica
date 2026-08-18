import { useEffect, useState } from 'react'
import { useApp } from '../../store/AppContext'
import { exportAsDocx, exportAsPdf } from '../../lib/exportReport'
import { exportBibTeX, exportRIS, exportMatrixCSV, exportPrismaCSV, exportSearchStrategyCSV, exportRiskOfBiasCSV } from '../../lib/exportData'
import { reportResearchQuestions } from '../../lib/researchQuestions'
import { downloadSessionFile } from '../../lib/sessionStorage'
import { API, apiFetch } from '../../lib/api'
import type { RobTool } from '../../types'

interface Props {
  onClose: () => void
}

export function ExportModal({ onClose }: Props) {
  const { state } = useApp()
  const [loading, setLoading] = useState<'pdf' | 'docx' | null>(null)
  // The appraisal instrument's domains live on the backend, so the risk-of-bias
  // table can only be built once they are loaded.
  const [robTool, setRobTool] = useState<RobTool | null>(null)

  useEffect(() => {
    let cancelled = false
    const toolId = state.robToolId
    // Resolved through a promise even in the "no tool" case, so no setState
    // happens synchronously in the effect body and cascades a render.
    const load = toolId
      ? apiFetch(`${API}/rob/tools/${toolId}`)
          .then(res => (res.ok ? res.json() : Promise.reject(new Error())))
      : Promise.resolve(null)
    load
      .then(tool => { if (!cancelled) setRobTool(tool) })
      .catch(() => { if (!cancelled) setRobTool(null) })
    return () => { cancelled = true }
  }, [state.robToolId])

  const title = state.sessionTitle || 'Research Report'
  const topicsCount  = state.topics.filter(t => t.selected).length
  const papersCount  = state.reviewList.filter(r => r.status === 'included' || r.status === 'maybe').length
  const themesCount  = state.themes.length
  const gapsCount    = state.gaps.filter(g => g.selected).length
  const hasRQ        = reportResearchQuestions(state).length > 0
  const hasDesign    = !!state.selectedStudyDesignId
  const paperStructureCount = state.topicFinalData.find(d => d.topicId === state.selectedFinalTopicId)?.paperSections.length ?? 0
  const hasStructure = !!state.selectedFinalTopicId || paperStructureCount > 0
  const citableCount = state.reviewList.filter(r => r.status === 'included' || r.status === 'maybe' || r.status === 'saved').length
  const matrixCount  = state.matrixRows.length
  const searchedQueries = state.queries.filter(q => q.lastRunAt).length

  const dataExports = [
    { key: 'bib',    label: 'BibTeX (.bib)',    hint: 'Import into Zotero / Mendeley', ready: citableCount > 0, run: () => exportBibTeX(state) },
    { key: 'ris',    label: 'RIS (.ris)',       hint: 'Import into EndNote / RefWorks', ready: citableCount > 0, run: () => exportRIS(state) },
    { key: 'csv',    label: 'Matrix (.csv)',    hint: 'Open the literature matrix in Excel', ready: matrixCount > 0, run: () => exportMatrixCSV(state) },
    { key: 'prisma', label: 'PRISMA flow (.csv)', hint: 'Screening counts for a PRISMA diagram', ready: state.results.length > 0, run: () => exportPrismaCSV(state) },
    { key: 'rob', label: 'Risk of bias (.csv)', hint: 'Appraisal table with per-domain judgements and rationales', ready: Boolean(robTool) && state.robAssessments.length > 0, run: () => robTool && exportRiskOfBiasCSV(state, robTool) },
    { key: 'strategy', label: 'Search strategy (.csv)', hint: 'PRISMA appendix: full query per database, dates, hits', ready: searchedQueries > 0, run: () => exportSearchStrategyCSV(state) },
    { key: 'session', label: 'Session backup (.json)', hint: 'Complete working copy — re-importable into this tool', ready: true, run: () => downloadSessionFile(state) },
  ]

  const sections = [
    { label: 'Research Profile',    ready: !!state.profile.domain },
    { label: `Topics (${topicsCount})`,   ready: topicsCount > 0 },
    { label: `Queries (${state.queries.length})`, ready: state.queries.length > 0 },
    { label: 'Search Strategy (reproducible)', ready: searchedQueries > 0 },
    { label: `Papers (${papersCount})`,  ready: papersCount > 0 },
    { label: `Risk of Bias (${state.robAssessments.length})`, ready: state.robAssessments.length > 0 },
    { label: 'Literature Matrix',   ready: state.matrixRows.length > 0 },
    { label: `Synthesis (${themesCount} themes)`, ready: themesCount > 0 },
    { label: `Gap Analysis (${gapsCount})`, ready: gapsCount > 0 },
    { label: 'Research Question',   ready: hasRQ },
    { label: 'Study Design',        ready: hasDesign },
    { label: 'Final Topic & Structure', ready: hasStructure },
  ]

  async function handleExportDocx() {
    setLoading('docx')
    try {
      await exportAsDocx(state)
    } finally {
      setLoading(null)
      onClose()
    }
  }

  function handleExportPdf() {
    setLoading('pdf')
    exportAsPdf(state)
    setTimeout(() => { setLoading(null); onClose() }, 500)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200">
          <div>
            <h2 className="text-[15px] font-bold text-zinc-900">Export Report</h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">"{title}"</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800 transition-colors">
            ✕
          </button>
        </div>

        {/* Content sections summary */}
        <div className="px-5 py-4 border-b border-zinc-100">
          <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">Sections included</p>
          <div className="grid grid-cols-2 gap-1">
            {sections.map(s => (
              <div key={s.label} className="flex items-center gap-2">
                <span className={`text-[10px] ${s.ready ? 'text-green-500' : 'text-zinc-300'}`}>●</span>
                <span className={`text-[11px] ${s.ready ? 'text-zinc-700' : 'text-zinc-400'}`}>{s.label}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-zinc-400 italic mt-2">Grey items have no data yet — they'll be skipped.</p>
        </div>

        {/* Export options */}
        <div className="px-5 py-4 flex flex-col gap-3">
          {/* DOCX */}
          <button
            onClick={handleExportDocx}
            disabled={loading !== null}
            className="flex items-center gap-4 px-4 py-3 border-2 border-blue-200 bg-blue-50 rounded-xl hover:bg-blue-100 hover:border-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left"
          >
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                <rect x="4" y="2" width="12" height="16" rx="2" stroke="white" strokeWidth="1.5"/>
                <path d="M7 7h6M7 10h6M7 13h4" stroke="white" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="flex-1">
              <div className="text-[13px] font-bold text-zinc-900">
                {loading === 'docx' ? 'Generating…' : 'Export as Word (.docx)'}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                Formatted document with tables, headings, and all sections
              </div>
            </div>
            {loading === 'docx' && (
              <span className="w-4 h-4 border-2 border-blue-400 border-t-blue-700 rounded-full animate-spin" />
            )}
          </button>

          {/* PDF */}
          <button
            onClick={handleExportPdf}
            disabled={loading !== null}
            className="flex items-center gap-4 px-4 py-3 border-2 border-zinc-200 bg-zinc-50 rounded-xl hover:bg-zinc-100 hover:border-zinc-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left"
          >
            <div className="w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                <rect x="4" y="2" width="12" height="16" rx="2" stroke="white" strokeWidth="1.5"/>
                <path d="M7 8h2.5c.8 0 1.5.7 1.5 1.5S10.3 11 9.5 11H7V8z" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M7 11v2" stroke="white" strokeWidth="1.3" strokeLinecap="round"/>
                <path d="M12 8v5M12 8h1.5a1.5 1.5 0 0 1 0 3H12" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="flex-1">
              <div className="text-[13px] font-bold text-zinc-900">
                {loading === 'pdf' ? 'Opening print dialog…' : 'Export as PDF'}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                Opens browser print dialog — save as PDF
              </div>
            </div>
          </button>
        </div>

        {/* Data exports — reference managers & analysis */}
        <div className="px-5 pb-4">
          <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">
            References &amp; data
          </p>
          <div className="grid grid-cols-2 gap-2">
            {dataExports.map(d => (
              <button
                key={d.key}
                onClick={() => { d.run(); onClose() }}
                disabled={!d.ready || loading !== null}
                title={d.hint}
                className="flex flex-col items-start px-3 py-2 border border-zinc-200 rounded-lg hover:bg-zinc-50 hover:border-zinc-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-left"
              >
                <span className="text-[12px] font-semibold text-zinc-800">{d.label}</span>
                <span className="text-[10px] text-zinc-500 mt-0.5">{d.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-[12px] text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
