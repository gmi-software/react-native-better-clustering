import { StatusBar } from 'expo-status-bar'
import { useCallback, useState } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { resetStats } from './src/hud/stats'
import { ScenarioMenu } from './src/ScenarioMenu'
import { ScenarioScreen } from './src/ScenarioScreen'
import { SCENARIOS } from './src/scenarios'

export default function App() {
  const [scenarioId, setScenarioId] = useState<string | null>(null)
  const scenario = SCENARIOS.find(({ id }) => id === scenarioId)

  const open = (id: string) => {
    // Each scenario starts its HUD counters from zero.
    resetStats()
    setScenarioId(id)
  }
  const close = useCallback(() => setScenarioId(null), [])

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {scenario == null ? (
        <ScenarioMenu onOpen={open} />
      ) : (
        <ScenarioScreen key={scenario.id} onBack={close} scenario={scenario} />
      )}
    </SafeAreaProvider>
  )
}
