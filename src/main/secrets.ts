import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { SecretStore } from '../core/types'

/** Whole store = one JSON blob, encrypted by OS keychain (DPAPI / Keychain / libsecret). */
export function secretStore(file: string): SecretStore {
  const data: Record<string, unknown> = existsSync(file) ? JSON.parse(safeStorage.decryptString(readFileSync(file))) : {}
  return {
    get: <T>(key: string) => data[key] as T | undefined,
    set(key, value) {
      if (value === undefined) delete data[key]
      else data[key] = value
      writeFileSync(file, safeStorage.encryptString(JSON.stringify(data)))
    },
  }
}
