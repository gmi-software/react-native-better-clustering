import { useEffect, useState } from 'react'
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { DevHud } from './hud/DevHud'
import { HudVisibilityContext } from './hud/HudVisibility'
import type { Scenario } from './scenarios'

/** A scenario under a header with a way back, and the dev HUD over it. */
export function ScenarioScreen({
  scenario,
  onBack,
}: {
  scenario: Scenario
  onBack: () => void
}) {
  const [hudHidden, setHudHidden] = useState(false)

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onBack()
        return true
      }
    )
    return () => subscription.remove()
  }, [onBack])

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={onBack}
          testID="back"
        >
          <Text style={styles.back}>‹ Scenarios</Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.title}>
          {scenario.title}
        </Text>
      </View>
      <View style={styles.body}>
        <HudVisibilityContext.Provider value={setHudHidden}>
          {scenario.render()}
        </HudVisibilityContext.Provider>
        {hudHidden ? null : <DevHud />}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D1D5DB',
  },
  back: {
    color: '#0F52FF',
    fontSize: 16,
  },
  title: {
    flex: 1,
    color: '#111827',
    fontSize: 16,
    fontWeight: '600',
  },
  body: {
    flex: 1,
  },
})
