import { useState } from 'react'
import type { ReactNode } from 'react'
import { useApp } from '../../store/AppContext'
import { TopBar } from './TopBar'
import { LeftNav } from './LeftNav'
import { RightPanel } from './RightPanel'
import { ReadOnlyGuard } from './ReadOnlyGuard'
import { VersionHistoryDrawer } from '../overlays/VersionHistoryDrawer'
import { BackNavModal } from '../overlays/BackNavModal'
import { StaleStepBanner } from '../overlays/StaleStepBanner'
import { EditModeBanner } from '../overlays/EditModeBanner'
import { SaveTroubleBanner } from '../overlays/SaveTroubleBanner'
import { ReviewModeBanner } from '../overlays/ReviewModeBanner'
import { AiLoadingOverlay } from '../overlays/AiLoadingOverlay'
import { useIntegrityWatcher } from '../../lib/useIntegrityWatcher'

interface Props {
  children: ReactNode
}

export function AppLayout({ children }: Props) {
  const { state } = useApp()
  useIntegrityWatcher()
  const [rightCollapsed, setRightCollapsed] = useState(
    () => localStorage.getItem('tpp:rightPanelCollapsed') === '1'
  )

  function toggleRightPanel() {
    setRightCollapsed(v => {
      localStorage.setItem('tpp:rightPanelCollapsed', v ? '0' : '1')
      return !v
    })
  }

  const showRightPanel = state.currentStep > 1
  // Review mode silences the whole stale/edit apparatus: no outdated banner, no
  // dimmed step, no edit outline — just the review as it stands.
  const isStale = !state.reviewMode && state.stepStates[state.currentStep] === 'stale'
  const showEditMode = !state.reviewMode && state.editMode

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white">
      {/* Fixed top bar */}
      <TopBar />

      {/* Banners below top bar */}
      <SaveTroubleBanner />
      {state.reviewMode && <ReviewModeBanner />}
      {showEditMode && <EditModeBanner />}
      {/* Main body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left nav */}
        <LeftNav />

        {/* Main content */}
        <main
          className={`flex-1 overflow-hidden flex flex-col ${showEditMode ? 'outline outline-[3px] outline-red-500 outline-offset-[-3px]' : ''}`}
        >
          {isStale && <StaleStepBanner />}
          <div className={`flex-1 min-h-0 ${isStale ? 'opacity-55 pointer-events-none' : ''}`}>
            <ReadOnlyGuard enabled={state.reviewMode}>{children}</ReadOnlyGuard>
          </div>
        </main>

        {/* Right panel — steps 2+ only, collapsible */}
        {showRightPanel && !rightCollapsed && (
          <div className="relative h-full flex flex-col">
            <button
              onClick={toggleRightPanel}
              title="Hide profile & assistant"
              className="absolute -left-3 top-1/2 -translate-y-1/2 z-20 w-6 h-14 bg-white border border-zinc-200 rounded-full shadow-sm text-zinc-400 text-[10px] hover:text-zinc-700 hover:border-zinc-400 transition-colors flex items-center justify-center"
            >
              ❯
            </button>
            <div className={`flex-1 min-h-0 flex flex-col ${state.showVersionHistory ? 'opacity-40 pointer-events-none' : ''}`}>
              <ReadOnlyGuard enabled={state.reviewMode}><RightPanel /></ReadOnlyGuard>
            </div>
          </div>
        )}
        {showRightPanel && rightCollapsed && (
          <button
            onClick={toggleRightPanel}
            title="Show profile & assistant"
            className="w-7 h-full shrink-0 border-l border-zinc-200 bg-zinc-50 hover:bg-zinc-100 transition-colors flex flex-col items-center justify-center gap-3 text-zinc-400 hover:text-zinc-700"
          >
            <span className="text-[10px]">❮</span>
            <span className="text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ writingMode: 'vertical-rl' }}>
              Profile · Assistant
            </span>
          </button>
        )}
      </div>

      {/* Overlays */}
      {state.showVersionHistory && <VersionHistoryDrawer />}
      {state.showBackNavModal && !state.reviewMode && <BackNavModal />}
      <AiLoadingOverlay />
    </div>
  )
}
