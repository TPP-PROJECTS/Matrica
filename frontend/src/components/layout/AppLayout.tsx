import type { ReactNode } from 'react'
import { useApp } from '../../store/AppContext'
import { TopBar } from './TopBar'
import { LeftNav } from './LeftNav'
import { RightPanel } from './RightPanel'
import { VersionHistoryDrawer } from '../overlays/VersionHistoryDrawer'
import { BackNavModal } from '../overlays/BackNavModal'
import { StaleStepBanner } from '../overlays/StaleStepBanner'
import { ConsistencyAlertBanner } from '../overlays/ConsistencyAlertBanner'
import { EditModeBanner } from '../overlays/EditModeBanner'

interface Props {
  children: ReactNode
}

export function AppLayout({ children }: Props) {
  const { state } = useApp()

  const showRightPanel = state.currentStep >= 2
  const isStale = state.stepStates[state.currentStep] === 'stale'

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white">
      {/* Fixed top bar */}
      <TopBar />

      {/* Banners below top bar */}
      {state.editMode && <EditModeBanner />}
      {state.consistencyAlert && <ConsistencyAlertBanner />}

      {/* Main body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left nav */}
        <LeftNav />

        {/* Main content */}
        <main
          className={`flex-1 overflow-hidden flex flex-col ${state.editMode ? 'outline outline-[3px] outline-red-500 outline-offset-[-3px]' : ''}`}
        >
          {isStale && <StaleStepBanner />}
          <div className={`flex-1 min-h-0 ${isStale ? 'opacity-55 pointer-events-none' : ''}`}>
            {children}
          </div>
        </main>

        {/* Right panel — steps 2+ only */}
        {showRightPanel && (
          <div className="relative h-full flex flex-col">
            <div className={`flex-1 min-h-0 flex flex-col ${state.showVersionHistory ? 'opacity-40 pointer-events-none' : ''}`}>
              <RightPanel />
            </div>
          </div>
        )}
      </div>

      {/* Overlays */}
      {state.showVersionHistory && <VersionHistoryDrawer />}
      {state.showBackNavModal && <BackNavModal />}
    </div>
  )
}
