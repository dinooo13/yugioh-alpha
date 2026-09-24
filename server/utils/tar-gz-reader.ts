// Minimal streaming reader for `.tar.gz` archives (ADR 0015).
//
// The ygoresources card-history tarball is ~15 MB gzip but ~170 MB
// uncompressed (every language), and only `de/` is needed. This reader
// gunzips and parses the tar stream chunk by chunk, keeps only the entries
// the caller accepts, and skips the rest without buffering them — so memory
// stays at "one accepted entry" instead of "the whole archive".
//
// Supported: ustar headers (name + prefix), pax extended headers (`x`, for
// the next entry's `path`), pax global headers (`g`, skipped) and GNU long
// names (`L`). Everything that isn't a regular file is skipped.
import { Readable, pipeline } from 'node:stream'
import { createGunzip } from 'node:zlib'

const BLOCK = 512

/** Largest accepted entry; a card JSON is a few KB. */
export const MAX_TAR_ENTRY_BYTES = 256 * 1024

/** Largest pax/GNU long-name header body we're willing to read. */
const MAX_META_BYTES = 64 * 1024

export interface TarEntry {
  path: string
  data: Buffer
}

interface Header {
  path: string
  size: number
  type: string
}

function cString(block: Buffer, start: number, length: number): string {
  const slice = block.subarray(start, start + length)
  const end = slice.indexOf(0)
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8')
}

function parseSize(block: Buffer): number {
  const field = block.subarray(124, 136)
  // GNU base-256 encoding for sizes that don't fit in 11 octal digits.
  if (field[0]! & 0x80) {
    let size = 0
    for (let i = 1; i < field.length; i++) {
      size = size * 256 + field[i]!
    }
    return size
  }
  const text = cString(block, 124, 12).trim()
  const size = text === '' ? 0 : Number.parseInt(text, 8)
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error('invalid tar header: bad size field')
  }
  return size
}

function verifyChecksum(block: Buffer) {
  const stored = Number.parseInt(cString(block, 148, 8).trim(), 8)
  let sum = 0
  for (let i = 0; i < BLOCK; i++) {
    // The checksum field itself counts as eight spaces.
    sum += i >= 148 && i < 156 ? 0x20 : block[i]!
  }
  if (stored !== sum) {
    throw new Error('invalid tar header: checksum mismatch')
  }
}

function parseHeader(block: Buffer): Header {
  verifyChecksum(block)
  const name = cString(block, 0, 100)
  const isUstar = block.subarray(257, 262).toString('latin1') === 'ustar'
  const prefix = isUstar ? cString(block, 345, 155) : ''
  return {
    path: prefix ? `${prefix}/${name}` : name,
    size: parseSize(block),
    type: String.fromCharCode(block[156]!),
  }
}

function isZeroBlock(block: Buffer): boolean {
  for (let i = 0; i < BLOCK; i++) {
    if (block[i] !== 0) {
      return false
    }
  }
  return true
}

/** The `path` record of a pax extended header body, if any. */
function paxPath(body: Buffer): string | undefined {
  let path: string | undefined
  let offset = 0
  while (offset < body.length) {
    const space = body.indexOf(0x20, offset)
    if (space === -1) {
      break
    }
    const length = Number.parseInt(body.subarray(offset, space).toString('latin1'), 10)
    if (!Number.isSafeInteger(length) || length <= 0 || offset + length > body.length) {
      throw new Error('invalid tar pax header')
    }
    // "<length> <key>=<value>\n"
    const record = body.subarray(space + 1, offset + length - 1).toString('utf8')
    const equals = record.indexOf('=')
    if (equals !== -1 && record.slice(0, equals) === 'path') {
      path = record.slice(equals + 1)
    }
    offset += length
  }
  return path
}

type BodyKind = 'file' | 'pax' | 'longname' | 'skip'

/**
 * Yields the regular-file entries of a gzipped tar stream whose path passes
 * `accept`, in archive order. Rejected entries are skipped without being
 * buffered. Stops at the end-of-archive marker (two zero blocks); throws when
 * the stream ends before it (a truncated download), on a corrupt header, or
 * on an accepted entry larger than `maxEntryBytes`.
 */
export async function* readTarGzEntries(
  source: AsyncIterable<Uint8Array>,
  accept: (path: string) => boolean,
  options: { maxEntryBytes?: number } = {},
): AsyncGenerator<TarEntry> {
  const maxEntryBytes = options.maxEntryBytes ?? MAX_TAR_ENTRY_BYTES
  const gunzip = createGunzip()
  // Errors on either side (network, gzip) surface through the iteration
  // below; the callback only keeps the rejection from going unhandled.
  pipeline(Readable.from(source), gunzip, () => {})

  // Header bytes collected so far (always < 512).
  let pending = Buffer.alloc(0)
  let zeroBlocks = 0

  // The entry body being read.
  let body: { kind: BodyKind, path: string, size: number, remaining: number, parts: Buffer[] } | null = null
  // Path set by a preceding pax `x` / GNU `L` header, for the next entry.
  let nextPath: string | undefined

  for await (const raw of gunzip as AsyncIterable<Buffer>) {
    let chunk = raw
    while (chunk.length > 0) {
      if (body) {
        const take = Math.min(body.remaining, chunk.length)
        // Only the first `size` bytes are data; the rest is block padding.
        const consumed = body.size + padding(body.size) - body.remaining
        const dataEnd = Math.max(0, Math.min(take, body.size - consumed))
        if (body.kind !== 'skip' && dataEnd > 0) {
          body.parts.push(chunk.subarray(0, dataEnd))
        }
        body.remaining -= take
        chunk = chunk.subarray(take)
        if (body.remaining === 0) {
          const finished = body
          body = null
          const data = finished.kind === 'skip' ? null : Buffer.concat(finished.parts)
          if (finished.kind === 'file' && data) {
            yield { path: finished.path, data }
          }
          else if (finished.kind === 'pax' && data) {
            nextPath = paxPath(data) ?? nextPath
          }
          else if (finished.kind === 'longname' && data) {
            nextPath = cString(data, 0, data.length)
          }
        }
        continue
      }

      const need = BLOCK - pending.length
      if (chunk.length < need) {
        pending = Buffer.concat([pending, chunk])
        break
      }
      const block = pending.length > 0 ? Buffer.concat([pending, chunk.subarray(0, need)]) : chunk.subarray(0, need)
      pending = Buffer.alloc(0)
      chunk = chunk.subarray(need)

      if (isZeroBlock(block)) {
        zeroBlocks += 1
        if (zeroBlocks === 2) {
          return
        }
        continue
      }
      zeroBlocks = 0

      const header = parseHeader(block)
      let kind: BodyKind = 'skip'
      let path = header.path
      if (header.type === 'x' || header.type === 'L') {
        if (header.size > MAX_META_BYTES) {
          throw new Error('invalid tar archive: oversized extended header')
        }
        kind = header.type === 'x' ? 'pax' : 'longname'
      }
      else if (header.type === '0' || header.type === '\0' || header.type === '7') {
        path = nextPath ?? header.path
        nextPath = undefined
        if (accept(path)) {
          if (header.size > maxEntryBytes) {
            throw new Error(`tar entry too large: ${path} (${header.size} bytes)`)
          }
          kind = 'file'
        }
      }
      else if (header.type !== 'g') {
        // Directories, links, … — a pending pax path belonged to this entry.
        nextPath = undefined
      }

      const remaining = header.size + padding(header.size)
      if (kind === 'file' && remaining === 0) {
        yield { path, data: Buffer.alloc(0) }
      }
      else if (remaining > 0) {
        body = { kind, path, size: header.size, remaining, parts: [] }
      }
    }
  }

  throw new Error('truncated tar archive: stream ended before the end-of-archive marker')
}

function padding(size: number): number {
  const rest = size % BLOCK
  return rest === 0 ? 0 : BLOCK - rest
}
