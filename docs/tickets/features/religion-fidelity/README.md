# Remaining religion fidelity checks

The production event clock, prayer permission and household oil delivery policy are covered by the
implementation tests. Prayer occurs outside at the building entrance. Temple operation is continuous
once built: construction consumes oil, with no priest or recurring fuel. Overlapping temples deliberately
provide one aura effect; do not add stacking.

Two original-game comparisons remain:

- [Prayer positions and site search](prayer-positions.md): the entrance is an explicit positional
  approximation; exact outdoor work areas and search ordering need observation.
- [Oil depletion and damage](holy-oil.md): verify the calibrated pool's small remainder and damaged-home
  consumption before changing them.

The [non-religious trade's religion row](../religion-row-for-non-praying-trades.md) separately needs a
window comparison. Its manual action already follows the trade's permission.

Readable `jobtypes.ini`, `goodtypes.ini`, `tribetypes.ini`, decoded house/animation tables and the
owned manual establish the roles and authored events. Exact site-search and numeric aura behavior
have not been confirmed against the running original. Tests establish this implementation's behavior,
not full fidelity. Druid field healing/blessing requires gameplay observation before it is scheduled.
