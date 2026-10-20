# Distinguish deleted catalogue files from blocked download hosts

**Area:** api, app · **Priority:** P2

The catalogue audit could not download seven external entries. Hostuje pages for Leśne Wzgórza
and Leśna Wojna reported that the file was absent. ModDB returned HTTP 403 with a challenge page for
8-MY CUD - FINAŁOWA BITWA, Legenda Sześciu Synów v1.0, Bitwa o Cztery Wzgorza, Jezioro Mgieł
and Miasto portowe Kalos. A blocked request is not evidence that the file has expired.

## Scope

- Classify confirmed missing files, access/challenge blocks and transient failures separately;
  preserve source URL and last checked outcome. Recheck current evidence before curating entries.
- Give catalogue users a truthful availability message and a manual source link when useful.
  Do not advertise a confirmed deleted file as a working download or deny an entry merely for 403.
- Support a verified replacement link through the existing
  [curation](../features/map-catalogue-curation.md) mechanism; do not invent mirrors or bypass host
  access controls. Revalidate availability during normal sync without aggressive retry loops.
- Coordinate with [external-host resolvers](external-file-hosts.md), which own successful download
  extraction; this ticket owns failure classification and its user-facing state.

## Verify

Synthetic HTTP/page fixtures distinguish missing, challenge, temporary failure and recovered link.
Check API-to-catalogue presentation and recheck all seven entries, reporting unresolved cases rather
than claiming deleted upstream content has been restored.
