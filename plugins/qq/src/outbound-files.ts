import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, join, sep } from 'node:path'
import type { OutboundFile } from './gateway.ts'
import { inboxDir } from './inbox.ts'

/** The most QQ's direct upload takes. Larger files need its chunked upload, which is not built. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_FILES_PER_REPLY = 10
/** The formats QQ's upload documentation lists for an image. Anything else is sent as a file. */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg'])

/**
 * Reads the local files a reply is to carry. Throws, naming the file, when one
 * is missing, is not a regular file, is over QQ's limit, or lies in the
 * Channel's state directory outside the inbox. Reading all of them before any
 * is sent means a bad path leaves nothing half-sent.
 */
export function readFilesToSend(stateDir: string, paths: string[]): OutboundFile[] {
  if (paths.length > MAX_FILES_PER_REPLY) {
    throw new Error(`a reply carries at most ${MAX_FILES_PER_REPLY} files, and ${paths.length} were given`)
  }
  return paths.map(path => {
    if (!isAbsolute(path)) throw new Error(`${path} is not an absolute path`)
    // Symlinks are resolved first, so a link cannot reach around the check below.
    let real: string
    try {
      real = realpathSync(path)
    } catch {
      throw new Error(`${path} does not exist`)
    }
    if (isKeptPrivate(stateDir, real)) {
      throw new Error(
        `${path} is in the QQ channel's state directory, which holds the bot's credentials and the allowlist; ` +
          'only files in its inbox can be sent',
      )
    }
    const stats = statSync(real)
    if (!stats.isFile()) throw new Error(`${path} is not a file`)
    if (stats.size > MAX_FILE_BYTES) {
      const megabytes = (stats.size / (1024 * 1024)).toFixed(1)
      throw new Error(
        `${path} is ${megabytes} MB, and the QQ channel sends files of at most 5 MB; offer another way to deliver it`,
      )
    }
    let data: Uint8Array
    try {
      data = readFileSync(real)
    } catch (error) {
      throw new Error(`${path} could not be read: ${error instanceof Error ? error.message : String(error)}`)
    }
    return { data, name: basename(path), kind: IMAGE_EXTENSIONS.has(extname(path).toLowerCase()) ? 'image' : 'file' }
  })
}

/** True for a resolved path inside the state directory, unless it is inside the inbox. */
function isKeptPrivate(stateDir: string, realPath: string): boolean {
  const realStateDir = resolved(stateDir)
  if (!isInside(realStateDir, realPath)) return false
  const realInbox = resolved(inboxDir(stateDir))
  // An inbox that is a link to somewhere else in the state directory opens nothing.
  return !(realInbox === join(realStateDir, 'inbox') && isInside(realInbox, realPath))
}

const isInside = (dir: string, path: string) => path === dir || path.startsWith(dir + sep)

/** The path with symlinks resolved, or as given when it does not exist. */
function resolved(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}
