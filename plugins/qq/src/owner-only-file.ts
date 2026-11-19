import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Replaces a file in the state directory, readable by the owner only. It is
 * written under a temporary name and renamed, so that a crash part way
 * leaves the old file whole rather than half of a new one.
 */
export function writeOwnerOnly(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, content, { mode: 0o600 })
  // The mode above applies only when the file is created.
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
}
