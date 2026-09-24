import { describe, expect, it } from 'vitest'
import { readTarGzEntries } from '../../server/utils/tar-gz-reader'
import { buildTarGz, streamOf } from './fixtures/tarball'

async function collect(source: AsyncIterable<Uint8Array>, accept: (path: string) => boolean, maxEntryBytes?: number) {
  const entries: { path: string, text: string }[] = []
  for await (const entry of readTarGzEntries(source, accept, { maxEntryBytes })) {
    entries.push({ path: entry.path, text: entry.data.toString('utf8') })
  }
  return entries
}

const FILES = {
  'de/4041.json': '{"name":"Dunkler Magier"}',
  'en/4041.json': '{"name":"Dark Magician"}',
  'de/4007.json': '{"name":"Blauäugiger w. Drache"}',
  // Exactly one block, and one just over it: padding edge cases.
  'de/1.json': 'x'.repeat(512),
  'de/2.json': 'y'.repeat(513),
  'de/empty.json': '',
}

describe('readTarGzEntries', () => {
  it('yields only accepted regular files, in order, skipping global and directory headers', async () => {
    const archive = buildTarGz(FILES)

    const entries = await collect(streamOf(archive, 97), path => path.includes('/de/'))

    expect(entries.map(entry => entry.path)).toEqual([
      'yugioh-card-history-abc123/de/4041.json',
      'yugioh-card-history-abc123/de/4007.json',
      'yugioh-card-history-abc123/de/1.json',
      'yugioh-card-history-abc123/de/2.json',
      'yugioh-card-history-abc123/de/empty.json',
    ])
    expect(entries[0]!.text).toBe('{"name":"Dunkler Magier"}')
    expect(entries[1]!.text).toBe('{"name":"Blauäugiger w. Drache"}')
    expect(entries[2]!.text).toBe('x'.repeat(512))
    expect(entries[3]!.text).toBe('y'.repeat(513))
    expect(entries[4]!.text).toBe('')
  })

  it('works with one big chunk as well as tiny chunks', async () => {
    const archive = buildTarGz(FILES)
    const whole = await collect(streamOf(archive, archive.length), () => true)
    const tiny = await collect(streamOf(archive, 7), () => true)
    expect(tiny).toEqual(whole)
    expect(whole).toHaveLength(Object.keys(FILES).length)
  })

  it('takes the path from a pax extended header and from the ustar prefix', async () => {
    const archive = buildTarGz(FILES, 'yugioh-card-history-abc123', {
      paxPathFor: 'de/4041.json',
      prefixPathFor: 'de/4007.json',
    })

    const entries = await collect(streamOf(archive), path => path.endsWith('.json') && path.includes('/de/4'))

    expect(entries).toEqual([
      { path: 'yugioh-card-history-abc123/de/4041.json', text: '{"name":"Dunkler Magier"}' },
      { path: 'yugioh-card-history-abc123/de/4007.json', text: '{"name":"Blauäugiger w. Drache"}' },
    ])
  })

  it('throws on a truncated archive', async () => {
    const archive = buildTarGz(FILES)
    // Cut the gzip stream in the middle.
    const truncated = archive.subarray(0, Math.floor(archive.length / 2))

    await expect(collect(streamOf(truncated), () => true)).rejects.toThrow()
  })

  it('throws when the tar data ends before the end-of-archive marker', async () => {
    const { gunzipSync, gzipSync } = await import('node:zlib')
    const tar = gunzipSync(buildTarGz(FILES))
    // Valid gzip, but the tar stops after the first headers.
    const cut = gzipSync(tar.subarray(0, 512 * 4))

    await expect(collect(streamOf(cut), () => true)).rejects.toThrow('truncated tar archive')
  })

  it('throws on a corrupt header', async () => {
    const { gunzipSync, gzipSync } = await import('node:zlib')
    const tar = Buffer.from(gunzipSync(buildTarGz(FILES)))
    tar[512 * 2 + 10] = 0x41 // inside the directory entry's name: checksum no longer matches
    await expect(collect(streamOf(gzipSync(tar)), () => true)).rejects.toThrow('checksum')
  })

  it('refuses an accepted entry above the size cap but skips a rejected one', async () => {
    const archive = buildTarGz({ 'de/big.json': 'z'.repeat(2000), 'de/small.json': '{}' })

    await expect(collect(streamOf(archive), () => true, 1024)).rejects.toThrow('tar entry too large')
    const entries = await collect(streamOf(archive), path => path.endsWith('small.json'), 1024)
    expect(entries.map(entry => entry.text)).toEqual(['{}'])
  })

  it('propagates an error from the source stream', async () => {
    const archive = buildTarGz(FILES)
    async function* failing() {
      yield archive.subarray(0, 100)
      throw new Error('socket hang up')
    }

    await expect(collect(failing(), () => true)).rejects.toThrow('socket hang up')
  })
})
