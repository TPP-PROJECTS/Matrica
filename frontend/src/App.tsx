import { AppProvider, useApp } from './store/AppContext'
import { AppLayout } from './components/layout/AppLayout'
import { Screen1 } from './screens/Screen1'
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
      case 2: return <Screen2 />
      case 3: return <Screen3 />
      case 4: return <Screen4 />
      case 5: return <Screen5 />
      case 6: return <Screen6 />
      case 7: return <Screen7 />
      case 8: return <Screen8 />
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
  return (
    <AppProvider>
      <WorkflowRouter />
    </AppProvider>
  )
}
