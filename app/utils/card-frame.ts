// Moved to shared/card-frame.ts: the server needs it for the deck tiles'
// card-kind chips. This re-export only keeps the last importers working
// (catalog.vue, CardDetailModal and the inventory list/tile, which another
// round-6 PR edits); once they import `~~/shared/card-frame`, delete it.
export * from '../../shared/card-frame'
