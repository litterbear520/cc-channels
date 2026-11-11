import { afterEach } from 'bun:test'
import { rmSync } from 'node:fs'

/*
 * Clean-up that runs after every test in every file. bunfig.toml preloads this
 * module: a hook registered in a module that test files import attaches only
 * to the first file that loads it, so the Channels and state directories of
 * the other files were left behind.
 */

const stops: (() => Promise<void>)[] = []
const dirs: string[] = []

/** Stops something, such as a Channel, once the current test ends. */
export const stopAfterTest = (stop: () => Promise<void>) => void stops.push(stop)
/** Removes a directory once the current test ends. */
export const removeAfterTest = (dir: string) => void dirs.push(dir)

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop().catch(() => {})
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
