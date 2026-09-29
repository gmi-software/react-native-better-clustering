import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, jest } from 'bun:test'

// The DOM must exist before @testing-library/react is first imported.
GlobalRegistrator.register()

const { cleanup } = await import('@testing-library/react')

// What jest's `clearMocks: true` and the old jest.setup.js did.
afterEach(() => {
  cleanup()
  jest.clearAllMocks()
})
