# Recommendation (design, lot 42)

What picks the songs: Shuffle, what plays after Up next runs out, mixes made from a song, the Mixes page. One taste model
for all of them, computed on this PC from this PC's history. Written 2026-11-14 from the owner's ask: the algorithm shapes
everything, the user gets the best of their music "but not only that", no Instagram-style bubble.

## What we copy, what we do differently
- YouTube (Covington 2016): two stages, candidates then a ranker; the target is time really listened, not clicks. We copy
  both: candidates from the library (plus YouTube Music's radio when signed in), a score from listened time, skips, likes.
- YouTube (Zhao 2019, multitask ranking): several signals (engagement: plays, finishes; satisfaction: likes, ratings)
  mixed into one score, and the position bias removed. We mix the same two families; the position bias does not exist for
  us (the user picks, no feed ranking feeds back into the history we read), except radio rows: their rank counts less.
- YouTube (Wilhelm 2018, DPP): diversity is a last stage that re-ranks a scored list, and it raised engagement. We copy the
  stage, in its cheap greedy form (MMR: score minus similarity to what is already chosen); DPP costs ~n^3.
- Spotify (Anderson 2020, Mok 2022): recommendation-driven listening goes with less diverse listening, and users who widen
  leave the algorithmic stream. So the dose of exploration is a fixed floor in the design, not something the model learns
  away. We do not learn from our own recommendations as if the user had asked for them: a song only counts when it was
  listened to, finished or liked, and one song's influence is capped.
- Pandora / Plexamp: similarity from the song's own features (tempo, key, mood). We have tempo and key where analysed
  (`crates/dsp`, tags), genre, decade, album, artist; energy and mood are not there yet and stay out.
- We do not do: servers, accounts, embeddings trained on other users, anything that needs a crowd. Taste here is a small
  weighted feature profile plus a co-listening graph, both from this library.

## Signals and weights
Per library song, from `plays`, `track_prefs`, ratings, likes (same definitions as `music_core::mixes`):
- play weight: finished 1.0; partial 0.3 to 0.9 by the share heard; skip under 30 s: -0.9 to -0.3 (`mixes::play_weight`).
- decay: half-life 30 days (taste now), 180 days for the long profile (`mixes::decay`). Mixes use both: 70 / 30.
- rating 8-10: +6, 6-7: +2.5, 1-2: out of every pick (shuffle: weight x0.05, reachable); like: +3 decaying with its age.
- skips in the last 30 days: -1.5 each, capped at -6 (`similar_signals`, exists). Never in mixes: out. Less: x0.3.
- playlists: in one of yours +1.5, imported ones less (`mixes`).
- heard in the last 20 h: x0.6 (cooldown, as `mixes`); the last 24 h go last in Shuffle (exists).
All numbers are first guesses, never heard by ear; they live in one table at the top of the module.

## Taste profile
A map feature -> weight, features = main artist (3), genre (2), album (1.5), decade (1), tempo by 10 bpm (0.8), key (0.8),
as `featuresOf` today. Built from the decayed play weights of the whole library (the long-term part) and, for a queue, from
the queue around the current song (the session part, the last played count most). Bounded on purpose: a feature's weight
saturates (`tanh`), one song adds at most a fixed share, so one liked video never turns into "only that".
The profile is rebuilt at start and every 20 plays, kept in memory, never written anywhere new.

## Candidates, score, diversity
1. Candidates: the library (one cheap pass over 10 000 songs, no per-song call), the seed's YouTube Music radio when signed
   in (already requested, nothing new), for a mix from a song the co-listening neighbours of its artist (`mixes` graph).
2. Score = affinity (profile . features, scaled 0..1 over the candidates) + preference (log plays, rating, like) - skip
   cost, x cooldown. Standardised to z-scores so the weights below do not depend on the library's size.
3. Exploration dose by variety: Alike 10 %, Balanced 20 %, Adventurous 35 % of the slots go to explore picks: songs with
   middle affinity (same genre or decade, another artist) and few plays, or never played; picked by weighted sampling,
   not the top. Hard floor: never 0, whatever the setting.
4. Diversity re-rank (greedy MMR, lambda 0.7): next pick = score - 0.3 x its similarity to the last 4 chosen. Caps: the same
   artist at most 2 in any 10 picks (3 for a mix from a song, whose seed artist gets 4), never twice in a row while another
   artist is left, same album at most 2 in 10.
5. Time of day: the last 90 days' plays at the current hour of day (+-2 h) add up to 10 % to affinity (not before 100 plays).

## Variety control
`similarVariety` (Alike / Balanced / Adventurous, default Balanced) stays as the ONE "how adventurous" control, for Up
next, Shuffle and mixes alike (it is no longer shown only when "Then, similar songs" is on). It sets the dose (3.) and the
shuffle sharpness (below). Decided alone (2026-11-14): keep it, it is the only handle the user has on the bubble.

## Shuffle
Weighted random sampling without replacement (Efraimidis-Spirakis): each song gets the key `ln(u) / w`, u uniform in (0,1),
and the list is sorted by the keys, largest first. `w = clamp(exp(beta x z), 0.1, 30)` with z the score's z-score and
beta = 1.2 / 0.9 / 0.5 for Alike / Balanced / Adventurous: with Balanced a +1.5 sigma song comes before a -1.5 sigma one
about 15 times in 16 on average, and no song has weight 0, so everything stays reachable. Then the existing pass: no artist
twice in a row, songs heard in the last 24 h later. `Math.random` only through an injected `rand` (tests pass a seeded one).
The "Smart shuffle" setting keeps its place: off = plain random order. Decided alone: always shaped when on (the owner's
word: "pas assez influencé").
Cost: 10 000 songs = one pass for z, 10 000 keys, one sort: a few ms.

## After Up next runs out
Always: the "Then, similar songs" switch goes (the stored value is ignored). The queue's session profile + the long profile
score the candidates, dose and re-rank above, 15 songs at a time (as `autoplay.ts` does). The Auto-DJ keeps its own picks.
A queue the user ended on purpose (Stop, a one-song play with repeat off) is still a stop: only a run-out adds songs.

## A mix from a song
`mixFromSong(seed)`: 30 songs. The seed first. Candidates: same-style neighbourhood = shared genre or decade or artist, the
seed's YouTube Music radio, the artists listened to near the seed's artist (co-listening). Score as above with the seed's
own features counting double in the profile. Arc, not a pile: 3 parts (settle, middle, return); where tempo is known each
step moves at most 12 bpm and avoids a clashing key, else the co-listening "flow" order of `mixes`; every third song is a
favourite (high preference), the dose of explore picks as above, none with a low rating, never in mixes, or a recent skip.
Name: "<Title> mix". The Mixes page gets the same, made ahead: up to 8 "Like <song>" mixes from the user's most loved songs,
one per style cluster (genre + decade, else the co-listening cluster), seeds rotating by day (`mixes` stays pure: same
input and seed = same mixes).

## Where the code lives
- `crates/core`: signals over the whole library in one SQL pass (`taste_signals`: decayed plays, last played, recent skips,
  like, less, never; no IN list, one call), and `song_mixes` for the Mixes page (next to `mixes`, same Input).
- `ui/src/features/player/score.ts` (new, pure, no store, no network): profile, score, dose, MMR, weighted order, arc.
  `similarRank.ts`, `shuffle.ts`, `radio.ts` call it. Front end because Up next and Shuffle already live there and the
  queue is a front-end object; the Rust side stays a data source. If a measurement on 10 000 songs (`pnpm bench`) shows more
  than 50 ms for a shuffle, the scoring pass moves into `music_core` behind one command.
- The signals are cached in a small store (refreshed every 20 plays); Shuffle reads the cache, so toggling it stays instant.

## Never
No new network request, host or field sent: the website's privacy rows (`PRIVACY`, `SERVICES`) stay true; the only outside
call is the YouTube Music radio the app already makes. No new data written beyond what plays and prefs already store. No
audio is downloaded, recorded or analysed from a platform; only local files' tags and `crates/dsp` results are read.

## Sources
- Covington, Adams, Sargin, Deep Neural Networks for YouTube Recommendations (RecSys 2016): https://gwern.net/doc/ai/nn/retrieval/2016-covington.pdf (summary: https://blog.acolyer.org/2016/09/19/deep-neural-networks-for-youtube-recommendations/)
- Zhao et al., Recommending What Video to Watch Next: A Multitask Ranking System (RecSys 2019): https://research.google/pubs/recommending-what-video-to-watch-next-a-multitask-ranking-system/
- Wilhelm et al., Practical Diversified Recommendations on YouTube with Determinantal Point Processes (CIKM 2018): https://dl.acm.org/doi/10.1145/3269206.3272018
- Anderson et al., Algorithmic Effects on the Diversity of Consumption on Spotify (WWW 2020): https://www.cs.utoronto.ca/~ashton/pubs/alg-effects-spotify-www2020.pdf
- Mok et al., The Dynamics of Exploration on Spotify (ICWSM 2022): https://ojs.aaai.org/index.php/ICWSM/article/view/19324
- Efraimidis, Spirakis, Weighted random sampling with a reservoir (2006); the log form: https://opensource.posit.co/blog/2020-07-29_parallelized-sampling/
- Result Diversification in Search and Recommendation: A Survey (MMR, DPP): https://arxiv.org/pdf/2212.14464
