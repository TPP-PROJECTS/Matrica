import { useState, useEffect } from 'react'
import { AppProvider, useApp } from './store/AppContext'
import { AppLayout } from './components/layout/AppLayout'
import { AnalyticsDashboard } from './screens/AnalyticsDashboard'
import { Screen1 } from './screens/Screen1'
import { ScreenMatrixInit } from './screens/ScreenMatrixInit'
import { Screen2 } from './screens/Screen2'
import { Screen3 } from './screens/Screen3'
import { Screen4 } from './screens/Screen4'
import { Screen5 } from './screens/Screen5'
import { Screen6 } from './screens/Screen6'
import { Screen7 } from './screens/Screen7'
import { Screen8 } from './screens/Screen8'

function WorkflowRouter() {
  const { state } = useApp()

  function renderScreen() {
    switch (state.currentStep) {
      case 1: return <Screen1 />
      case 2: return <ScreenMatrixInit />
      case 3: return <Screen2 />
      case 4: return <Screen3 />
      case 5: return <Screen4 />
      case 6: return <Screen5 />
      case 7: return <Screen6 />
      case 8: return <Screen7 />
      case 9: return <Screen8 />
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
    return <AnalyticsDashboard />
  }

  return (
    <AppProvider>
      <WorkflowRouter />
    </AppProvider>
  )
}
