import { Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SCENARIOS } from './scenarios'

export function ScenarioMenu({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} testID="scenario-menu">
        <Text style={styles.heading}>Scenarios</Text>
        {SCENARIOS.map((scenario) => (
          <Pressable
            key={scenario.id}
            accessibilityRole="button"
            onPress={() => onOpen(scenario.id)}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            testID={`scenario-${scenario.id}`}
          >
            <Text style={styles.title}>{scenario.title}</Text>
            <Text style={styles.description}>{scenario.description}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  content: {
    gap: 8,
    padding: 16,
  },
  heading: {
    marginBottom: 8,
    color: '#111827',
    fontSize: 28,
    fontWeight: '700',
  },
  item: {
    gap: 4,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D1D5DB',
  },
  pressed: {
    opacity: 0.7,
  },
  title: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '600',
  },
  description: {
    color: '#4B5563',
    fontSize: 14,
  },
})
