import { describe, expect, it } from 'vitest'
import { isPublicPath } from '../../app/utils/public-routes'

// Pins the one line in app/middleware/auth.global.ts that keeps an anonymous
// visitor *in* on a shared link and a logged-in visitor from being bounced
// *out* of it — extracted to a pure helper because a route-middleware unit
// test is impractical in this repo's vitest setup (see docs/adr/0007).
describe('isPublicPath', () => {
  it('treats every /spieler/** path as public', () => {
    expect(isPublicPath('/spieler/dino')).toBe(true)
    expect(isPublicPath('/spieler/dino/decks/abc')).toBe(true)
    expect(isPublicPath('/spieler/dino/sammlungen/abc')).toBe(true)
    expect(isPublicPath('/spieler/dino/inventar')).toBe(true)
  })

  it('treats the bare /spieler path (no trailing slash) as public too', () => {
    expect(isPublicPath('/spieler')).toBe(true)
  })

  it('does not treat an unrelated or look-alike path as public', () => {
    expect(isPublicPath('/profil')).toBe(false)
    expect(isPublicPath('/wunschliste')).toBe(false)
    expect(isPublicPath('/spielerx')).toBe(false)
    expect(isPublicPath('/')).toBe(false)
  })
})
