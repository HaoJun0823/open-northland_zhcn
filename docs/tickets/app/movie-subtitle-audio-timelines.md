# Align selectable film subtitles with the playing audio

**Area:** app, pipeline · **Priority:** P2

`playCampaignMovie` displays each selected SRT against the playing audio's clock. The subtitle map
identifies only text language, but spoken-language SRT files follow different recordings. For example,
`translations/eng/campaigns/asgard/films/intro.srt` ends at 29.140 seconds while the German version
ends at 37.180 seconds. Switching subtitle language can therefore show a sentence at the wrong time.

## Scope

Support timing by both narration language and subtitle language for the six campaign films. Verify
sentence correspondences against the available audio before authoring timing mappings; do not infer
alignment from cue number or proportional duration. Preserve the native-speaker CHS files verbatim
and do not create CHT translations. Keep the language switch from changing audio or playback time.

## Verify

Verify cross-language captions at sentence boundaries and silent passages against each available
recording. Cover timing selection in tests with different audio durations, and check language switches
mid-film in the player. Matching-language captions must retain their existing timings.
