# Show installed-map storage failures instead of an empty library

**Area:** app · **Priority:** P2

`catalogue/view.ts` catches failures from `store.list()` or `store.sources()` in `reloadInstalled`
and clears installed records without an error state. The catalogue can then offer another download
or claim that the library is empty despite a storage access failure. The previous source list can
also remain paired with an emptied record list.

## Scope

Retain the last coherent installed snapshot on read failure, show a localized storage error with a
retry action, and prevent actions based on an unverified empty library. Distinguish an initial read
failure from a genuinely empty store. Preserve atomic installation and removal behavior.

## Verify

Exercise the view's async lifecycle with a populated store followed by a failed list/source read,
a first-load failure, and a successful retry. Verify truthful counts, action availability and
messages in the catalogue and Installed tab.
