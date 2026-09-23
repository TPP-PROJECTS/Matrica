import { lazy, Suspense, useState, useEffect } from 'react'
import { AppProvider, useApp } from './store/AppContext'
import { AppLayout } from './components/layout/AppLayout'

const AnalyticsDashboard = lazy(() => import('./screens/AnalyticsDashboard').then(module => ({ default: module.AnalyticsDashboard })))
const ReviewerWorkspace = lazy(() => import('./screens/ReviewerWorkspace').then(module => ({ default: module.ReviewerWorkspace })))
const Screen1 = lazy(() => import('./screens/Screen1').then(module => ({ default: module.Screen1 })))
const ScreenMatrixInit = lazy(() => import('./screens/ScreenMatrixInit').then(module => ({ default: module.ScreenMatrixInit })))
const Screen3 = lazy(() => import('./screens/Screen3').then(module => ({ default: module.Screen3 })))
const Screen4 = lazy(() => import('./screens/Screen4').then(module => ({ default: module.Screen4 })))
const Screen5 = lazy(() => import('./screens/Screen5').then(module => ({ default: module.Screen5 })))
const ScreenSynthesisGap = lazy(() => import('./screens/ScreenSynthesisGap').then(module => ({ default: module.ScreenSynthesisGap })))
const Screen8 = lazy(() => import('./screens/Screen8').then(module => ({ default: module.Screen8 })))

function LoadingScreen() {
  return (
    <div className="h-screen flex items-center justify-center gap-2 bg-zinc-50">
      <span className="w-4 h-4 border-2 border-zinc-300 border-t-zinc-700 rounded-full animate-spin" />
      <span className="text-[12px] text-zinc-500">Loading…</span>
    </div>
  )
}

function WorkflowRouter() {
  const { state } = useApp()

  function renderScreen() {
    // Kept in step with src/lib/steps.ts, which names these same steps.
    switch (state.currentStep) {
      case 1: return <Screen1 />
      case 2: return <ScreenMatrixInit />
      case 3: return <Screen3 />            // Explore & search — topics and systems
      case 4: return <Screen4 />            // Select paper
      case 5: return <Screen5 />            // Matrix table
      case 6: return <ScreenSynthesisGap /> // Synthesis & gap
      case 7: return <Screen8 />            // Final question
      default: return <Screen1 />
    }
  }

  return (
    <AppLayout>
      {renderScreen()}
    </AppLayout>
  )
}

export default function App() {
  const [hash, setHash] = useState(window.location.hash)

  useEffect(() => {
    const handler = () => setHash(window.location.hash)
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  if (hash === '#analytics') {
    return <Suspense fallback={<LoadingScreen />}><AnalyticsDashboard /></Suspense>
  }

  // Peer review runs outside AppProvider on purpose: a reviewer's browser must
  // never load the owner's local session, only the redacted copy the server
  // sends for their token.
  const reviewToken = hash.startsWith('#review/') ? hash.slice('#review/'.length) : null
  if (reviewToken) {
    return <Suspense fallback={<LoadingScreen />}><ReviewerWorkspace token={reviewToken} /></Suspense>
  }

  return (
    <AppProvider>
      <Suspense fallback={<LoadingScreen />}>
        <WorkflowRouter />
      </Suspense>
    </AppProvider>
  )
}
