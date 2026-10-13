import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native'

/** The panel under a scenario's map. */
export function ControlPanel({ children }: { children: ReactNode }) {
  return <View style={styles.panel}>{children}</View>
}

export function ControlRow({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>
}

export function ActionButton({
  label,
  onPress,
  testID,
}: {
  label: string
  onPress: () => void
  testID: string
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      testID={testID}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  )
}

export function Toggle({
  label,
  value,
  onValueChange,
  testID,
}: {
  label: string
  value: boolean
  onValueChange: (value: boolean) => void
  testID: string
}) {
  return (
    <View style={styles.toggle}>
      <Text style={styles.text}>{label}</Text>
      <Switch onValueChange={onValueChange} testID={testID} value={value} />
    </View>
  )
}

/** One line of scenario state, e.g. `Visible points: 40`, for people and Maestro. */
export function StatusText({
  children,
  testID,
}: {
  children: ReactNode
  testID: string
}) {
  return (
    <Text style={styles.text} testID={testID}>
      {children}
    </Text>
  )
}

const styles = StyleSheet.create({
  panel: {
    gap: 8,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#0F52FF',
  },
  pressed: {
    opacity: 0.7,
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    color: '#111827',
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
})
