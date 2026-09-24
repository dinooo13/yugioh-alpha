import { gzipSync } from 'node:zlib'

const BLOCK = 512

function writeString(block: Buffer, value: string, offset: number, length: number) {
  block.write(value, offset, Math.min(Buffer.byteLength(value), length), 'utf8')
}

function writeOctal(block: Buffer, value: number, offset: number, length: number) {
  block.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length, 'latin1')
}

function header(name: string, size: number, type: string, prefix = ''): Buffer {
  const block = Buffer.alloc(BLOCK)
  writeString(block, name, 0, 100)
  writeOctal(block, 0o644, 100, 8)
  writeOctal(block, 0, 108, 8)
  writeOctal(block, 0, 116, 8)
  writeOctal(block, size, 124, 12)
  writeOctal(block, 0, 136, 12)
  block.fill(0x20, 148, 156)
  block.write(type, 156, 1, 'latin1')
  block.write('ustar\0', 257, 6, 'latin1')
  block.write('00', 263, 2, 'latin1')
  writeString(block, prefix, 345, 155)
  let sum = 0
  for (const byte of block) {
    sum += byte
  }
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'latin1')
  return block
}

function padded(data: Buffer): Buffer[] {
  const rest = data.length % BLOCK
  return rest === 0 ? [data] : [data, Buffer.alloc(BLOCK - rest)]
}

/** A pax record: "<length> <key>=<value>\n", where length counts itself. */
function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`
  let length = Buffer.byteLength(body) + 1
  while (String(length).length + Buffer.byteLength(body) !== length) {
    length = String(length).length + Buffer.byteLength(body)
  }
  return `${length}${body}`
}

export interface TarFixtureOptions {
  /** Store this file's path in a pax `x` header (and a dummy name in the ustar header). */
  paxPathFor?: string
  /** Split this file's path into ustar prefix + name. */
  prefixPathFor?: string
}

/**
 * Builds an in-memory `.tar.gz` like GitHub's codeload tarballs: a pax
 * global header (`g`) first, a directory entry for `root`, then one regular
 * file per entry under `root/`. Optionally one file gets its path from a pax
 * extended header (`x`) and one from the ustar prefix field.
 */
export function buildTarGz(files: Record<string, string>, root = 'yugioh-card-history-abc123', options: TarFixtureOptions = {}): Buffer {
  const blocks: Buffer[] = []
  const comment = Buffer.from(paxRecord('comment', 'abc123'))
  blocks.push(header('pax_global_header', comment.length, 'g'), ...padded(comment))
  blocks.push(header(`${root}/`, 0, '5'))

  for (const [relativePath, content] of Object.entries(files)) {
    const path = `${root}/${relativePath}`
    const data = Buffer.from(content, 'utf8')
    if (options.paxPathFor === relativePath) {
      const pax = Buffer.from(paxRecord('path', path))
      blocks.push(header('PaxHeader/long', pax.length, 'x'), ...padded(pax))
      blocks.push(header('truncated-name.json', data.length, '0'), ...padded(data))
    }
    else if (options.prefixPathFor === relativePath) {
      const slash = path.lastIndexOf('/')
      blocks.push(header(path.slice(slash + 1), data.length, '0', path.slice(0, slash)), ...padded(data))
    }
    else {
      blocks.push(header(path, data.length, '0'), ...padded(data))
    }
  }

  blocks.push(Buffer.alloc(BLOCK * 2))
  return gzipSync(Buffer.concat(blocks))
}

/** Feeds `buffer` as a byte stream in small chunks, like a network download. */
export async function* streamOf(buffer: Buffer, chunkSize = 1000): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    yield buffer.subarray(offset, offset + chunkSize)
  }
}
