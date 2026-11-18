# Recommendation (design, lot 42)

What picks the songs: Shuffle, what plays after Up next runs out, mixes made from a song, the Mixes page. One taste model
for all of them, computed on this PC from this PC's history. Written 2026-11-14 from the owner's ask: the algorithm shapes
everything, the user gets the best of their music "but not only that", no Instagram-style bubble.

Rebuilt 2026-11-18, the owner's word (2026-11-17): Shuffle in playlists and mixes was "horrible"; redo it "the way YouTube or
TikTok" recommend. What made it bad, each reproduced by a test on a made-up library like theirs (`feel.test.ts`: streamed songs
with no tags, one artist played every day and liked):
- Shuffle weighted every song by its score, play counts and artist taste included, up to 300 times one against another: the
  most played artist opened every shuffle and came back every other song, the rest of the playlist almost never got its turn,
  and what played got more plays (a loop).
- The picks after Up next and the mixes from a song ADDED preference to fit: a liked, often played song of another style scored
  like a song that fits, and every third song of a mix was a favourite from anywhere: 11 of 30 songs of a mix were off-style.
- Untagged songs (most streamed ones) had nothing to say they go together but the artist; YouTube Music's radio counted less
  than a like.
- Nothing reacted to a skip before the next reload of the signals (every 20 listens).

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
- TikTok (the For You feed): the strongest signals are implicit and immediate (watched to the end, swiped away), and the feed
  reacts within the session. We copy it: an early skip steers what comes next at once, a full listen counts more in the queue's
  profile (In the session, below).
- YouTube's "watched together": songs you hear right after one another go together, whatever their tags. We keep it per song,
  from this PC's plays only (`TasteSignal::near`), and it counts in the fit of what plays after Up next and of a mix.
- We do not do: servers, accounts, embeddings trained on other users, anything that needs a crowd. Taste here is a small
  weighted feature profile plus a co-listening graph, both from this library.

## Signals and weights
Per library song, from `plays`, `track_prefs`, ratings, likes (same definitions as `music_core::mixes`):
- play weight: finished 1.0; partial 0.3 to 0.9 by the share heard; skip under 30 s: -0.9 to -0.3 (`mixes::play_weight`).
- decay: half-life 30 days (taste now), 180 days for the long profile (`mixes::decay`). Mixes use both: 70 / 30.
- preference = a factor e^p, p = 0.12 ln(1 + listens) + rating (8-10: 0.5, 6-7: 0.2) + like 0.35 + long profile (0..0.4)
  - 0.45 per skip in the last 30 days (4 at most), clamped to -1.8..1.1 (x0.17..x3). Rated 1-2 or Never in mixes: out. Less:
  x0.3.
- near: the 8 songs heard most often right before or after it, 30 min apart at most, skips passed over (`taste_signals`).
- playlists: in one of yours +1.5, imported ones less (`mixes`, the Mixes page only).
- heard in the last 20 h: x0.6 (cooldown, as `mixes`); the last 24 h go last in Shuffle.
All numbers are first guesses, never heard by ear; they live in one table at the top of `score.ts` (`K`) and of `shuffle.ts`.

## Taste profile
A map feature -> weight, features = main artist (3), genre (2), album (1.5), decade (1), tempo by 10 bpm (0.8), key (0.8),
as `featuresOf` today. Built from the decayed play weights of the whole library (the long-term part) and, for a queue, from
the queue around the current song (the session part, the last played count most). Bounded on purpose: a feature's weight
saturates (`tanh`), one song adds at most a fixed share, so one liked video never turns into "only that".
The profile is rebuilt at start and every 20 plays, kept in memory, never written anywhere new.

## Candidates, score, diversity
1. Candidates: the library (one cheap pass over 10 000 songs, no per-song call), the seed's YouTube Music radio when signed
   in (already requested, nothing new), for a mix from a song the co-listening neighbours of its artist (`mixes` graph).
2. Score = fit x preference, x Less, x cooldown, x 0.3 per early skip of its artist in the queue (two at most). Fit = 0.05 +
   0.6 x the session profile's features (0..1 over the candidates) + 0.5 x the share of the queue it is played next to + 0.35
   x the same for its artist + a radio row 0.9 / (1 + 0.04 x its place). Multiplied, not added: a favourite that fits nothing
   stays near the floor, so it never pushes out what fits (it still fills in when nothing else is left). The long profile is
   part of the preference, not of the fit. Standardised to z-scores so the weights below do not depend on the library's size.
3. Exploration dose by variety: Alike 10 %, Balanced 20 %, Adventurous 35 % of the slots go to explore picks: songs with
   middle fit (same genre or decade, another artist) and few plays, or never played; picked by weighted sampling,
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
A playlist or a mix you play is your pick: Shuffle orders it, it does not rank it. Weighted random sampling without
replacement (Efraimidis-Spirakis): each song gets the key `ln(u) / w`, u uniform in (0,1), and the list is sorted by the keys,
largest first. `w = rest x marks^sharp` (`shuffleWeight`), never below 0.01, so everything stays reachable:
- rest = 1 - 0.9 e^(-days since heard / 3): heard today 0.1, 3 days ago 0.67, a week 0.91, never 1. What you heard waits its
  turn and comes back, so the head of the shuffle rotates from day to day.
- marks = a like x2, a rating 8-10 x1.8 or 6-7 x1.3, each recent skip x0.6 (4 at most), Less x0.4. No play count and no artist
  taste: those made the same favourites open every shuffle.
- sharp = 1.4 / 1 / 0.6 for Alike / Balanced / Adventurous.
Then each artist is kept apart (`spaced`): at least `gap` other songs between two of theirs, `gap` = 0.7 of an even spread
over the list, at most 10 (an artist with a sixth of the list comes back every 5 songs or so, one with 5 songs in 100 every 11);
each place takes the first song of the next 60 whose artist is far enough. Songs heard in the last 24 h and rated 1-2 after all
the others, spread the same way. `Math.random` only through an injected `rand` (tests pass a seeded one). The "Smart shuffle"
setting keeps its place: off = plain random order; the taste store not loaded yet = artists spread, unweighted.
Cost: 10 000 songs, the whole shuffle about 11 ms (was 27).

## In the session
`listens.ts` keeps this session's verdicts in memory only (nothing new is written): early skips (under 30 s, not finished)
counted by song, and the last verdict by song (skipped early, heard to the end). They act at once, before the next reload of
the signals:
- Shuffle: an early skip moves that artist's songs out of the next 10 (`steered`, the moved ones right after); a second skip of
  the same artist this session sends all of theirs to the end. Songs you queued yourself stay put.
- The app's own picks, Shuffle off (2026-11-18, lot 64): the songs added when Up next runs out, a mix from a song's songs and the
  Auto-DJ's are marked as picks (`store.ts` `markPicks`, by id, forgotten when a new queue plays). An early skip of one moves that
  artist's OTHER picks out of the next 10 and a second skip sends them to the end (the same `steered`). Never moved: what you
  queued, a playlist's own songs (not picks), the parts of a split video.
- The taste: the session's skips count as recent skips (the larger of the two, so a reload does not count them twice).
- After Up next and in a mix: a queue song skipped early no longer shapes the queue's profile and cuts its artist's songs (x0.3
  each, two at most); one heard to the end counts 1.5 times.

## After Up next runs out
Always: the "Then, similar songs" switch goes (the stored value is ignored). The queue's session profile + the long profile
score the candidates, dose and re-rank above, 15 songs at a time (as `autoplay.ts` does). The Auto-DJ keeps its own picks.
A queue the user ended on purpose (Stop, a one-song play with repeat off) is still a stop: only a run-out adds songs.

## A mix from a song
`mixFromSong(seed)`: 30 songs. The seed first. Candidates: same-style neighbourhood = shared genre or decade or artist, the
seed's YouTube Music radio, the artists listened to near the seed's artist (co-listening). Score as above with the seed's
own features counting double in the profile. Arc, not a pile: 3 parts (settle, middle, return); where tempo is known each
step moves at most 12 bpm and avoids a clashing key, else the co-listening "flow" order of `mixes`; every third song is a
favourite (high preference) when one is among the next 8 by rank (further down it is of another style), the dose of explore
picks as above, none with a low rating, never in mixes, or a recent skip.
Name: "<Title> mix". The Mixes page gets the same, made ahead: up to 8 "Like <song>" mixes from the user's most loved songs,
one per style cluster (genre + decade, else the co-listening cluster), seeds rotating by day (`mixes` stays pure: same
input and seed = same mixes).

## Where the code lives
- `crates/core`: signals over the whole library in one SQL pass (`taste_signals`: decayed plays, last played, recent skips,
  like, less, never, the songs heard next to it; no IN list, one call), and `song_mixes` for the Mixes page (next to `mixes`,
  same Input).
- `ui/src/features/player/score.ts` (pure, no store, no network): profiles, links, fit, preference, dose, MMR.
  `similarRank.ts`, `songMix.ts`, `radio.ts` call it; `shuffle.ts` has Shuffle's own weight, spacing and steering, `listens.ts`
  the session's verdicts, `store.ts` steers on a skip. Front end because Up next and Shuffle already live there and the
  queue is a front-end object; the Rust side stays a data source. If a measurement on 10 000 songs (`pnpm bench`) shows more
  than 50 ms for a shuffle, the scoring pass moves into `music_core` behind one command.
- The signals are cached in a small store (refreshed every 20 plays); Shuffle reads the cache, so toggling it stays instant.

## Never
No new network request, host or field sent: the website's privacy rows (`PRIVACY`, `SERVICES`) stay true; the only outside
call is the YouTube Music radio the app already makes. No new data written beyond what plays and prefs already store. No
audio is downloaded, recorded or analysed from a platform; only local files' tags and `crates/dsp` results are read.

## Why it is still not YouTube's level, and the levers
Written 2026-11-18 from the owner's word: the picks are "still not at the level of YouTube's". Analysis only, nothing built.
**The gap.** YouTube's picks come from collaborative filtering over billions of sessions. It learns what people who
played A played next, and it trains the ranking on watch time (Covington 2016, Zhao 2019). It splits candidate generation
(a few hundred songs out of millions) from ranking. Our ranker is close to theirs in shape (two stages, listened time,
diversity), but our candidates are poor. One user's library: songs mostly untagged when streamed, a co-listening graph
from one person's plays (`near`), and one YouTube Music radio. Ranking well among weak candidates cannot beat a
crowd's candidates. So most of the gain lies in stage 1, the candidate pool, and that is where the crowd lives.
**What the crowd signal is today.** `radio.ts` `around()` adds the radio of the last song only (`RDAMVM<id>`, ranked by
its place), and only when signed in (`status.youtube.connected`). Yet `ytm_list` already answers signed out from the
public catalog, and the Mixes page already asks anonymous radios of its seeds (`listening.rs` `radios`, cached for hours).
The artist page parser drops "Fans might also like" (`home.rs` `artist_page`, "artists-only shelf dropped"). Last.fm
`artist.getSimilar` and `artist.getTopTracks` are used once a day for Discoveries only, with the user's own key, opt-in.

**Decided by the owner (2026-11-18).** All four surfaces fall short: Shuffle, the end of Up next, mixes from a song (and
"Like <title>"), and discovery. Crowd data from YouTube Music only: its radios, related artists and Home shelves,
ranked by our score. No new host; no ListenBrainz, no Last.fm.
**The design: YouTube Music finds, we rank.**
- Stage 1, candidates, from YouTube Music: the radios (`RDAMVM<id>`) of up to 3 seeds, merged. A song in several radios
  gets `votes`, the crowd's "played together", and its best place is kept. Signed in, the Home shelves ("Quick picks",
  "Mixed for you") feed discovery. A mix from a song also gets the seed artist's "Fans might also like" (top songs of
  2 of them). The library's own neighbours join (`near`, same style).
- Stage 2, our score, unchanged in shape: fit x preference (`score.ts`). The radio term becomes 0.9 x (1 + 0.5 x (votes - 1))
  / (1 + 0.04 x best place), so the crowd decides what fits, and our taste decides among what fits.
- Stage 3, diversity last: dose of the new, MMR, the artist caps, all as they are.
- Session signals we own, the second lever, with no network:
  - a replay within a day counts as a strong like;
  - skipping the next song marks the pair: twice, and `near` drops it;
  - for local files only, energy from `crates/dsp` loudness and tempo.
**Signed out.** Only YouTube Music's public catalog: the anonymous radios, which the Mixes page already asks
(`listening::radios`, `state.ytm_or_public()`), and the public artist page. No Home shelves (they are an account's). Same
ids sent, no account.
**Pacing and refusals, unchanged.** Every list goes through the existing cache (radios kept for hours, `cache.lists`). A
run-out of Up next asks at most 3 radios (fewer when cached); a mix asks 1 radio and 1 artist page; never a search to fill
the pool. Songs of the pool play by their video id, so no lookup is needed. A refusal (429, a "Sorry" page) ends the
crowd pool for that pick: it falls back to the library, it is never retried sooner or elsewhere, and the `searchpace`
rules still hold for every lookup. No script ever runs real requests in bulk; tests use fixtures.
**What it will and will not fix, per surface.**
- *Up next's end*: the biggest gain. Today it uses one radio, and only signed in. Three merged radios give a crowd-ranked
  pool of about 100 songs, and our score picks within it. Close to YouTube's own "up next", with the user's taste on top.
- *Mix from a song / "Like <title>"*: a real gain where the seed is on YouTube. Several radios plus related artists, the
  arc kept. A local file with no YouTube match stays library-only.
- *Discovery*: a partial gain. New songs come only from what YouTube Music shows (radios, related artists, Home
  signed in), filtered by our taste. Signed out there is no personal Home, so the gain is smaller. We never see what
  YouTube knows about the user beyond those lists.
- *Shuffle of the user's own playlist*: it cannot discover anything; it is the user's pick, and adding songs would
  break that. It can only order better: the session signals (replays, skipped transitions) and the `near` flow. A modest
  gain; the 2026-11-18 rebuild already removed the worst of it.
- *Never*: the crowd at YouTube's own depth (watch time across users, embeddings). We see ranked lists, not their
  model, and InnerTube is unofficial: it may change or break, and the pool then falls back to the library.
**Slices** (each one tested first, from fixtures, with no real network):
1. *Up next and "Start a mix" use several radios, signed in or out.* Done 2026-11-18 (lot 62, no new Rust: `ytm_list` already answers signed out and through the `lists` cache): `crowd.ts` (`seedsOf`, `mergeRadios`, `crowdOf`), `radio.ts` `around`, `score.ts` `radioVote`; tests in `crowd.test.ts` and `feel.test.ts` (the Rust mockito refusal case became a front-end one: one request, nothing from the crowd). Never run against the real YouTube Music. A Rust command over `listening::radios` (cache,
   public fallback) takes the last 3 distinct YouTube songs; candidates carry `votes`; the `fit` term above.
   Acceptance: `feel.test.ts` gets 3 radio fixtures that overlap:
   - a song in all 3 is in the first 5 picks;
   - a song in 1 radio and of another style ranks below the overlapping ones;
   - the caps still hold (at most 2 off-style favourites in 15; the artist spacing);
   - the signed-out fixtures give the same picks;
   - a refused radio (fixture error) gives library picks, with one request only (a mockito test).
2. *"Why this song"*, from the reason that scored the pick most, as `words.ts` and `autoDj` do already ("In 3 radios of
   what you played", "Played after <artist>"). Measure: each `feel` pick carries one reason.
3. *Session signals*: replays and skipped transitions (`taste_signals`, `listens.ts`). Measure: in `feel` cases, a
   replayed song rises, and a pair skipped twice is no longer a neighbour.
4. *Related artists*: keep "Fans might also like" in `artist_page` (it must fail empty), used by mixes. Measure: a
   parser fixture plus a `feel` case.
5. *Discovery from Home* (signed in): the shelves' songs, ranked by our score with the explore dose, in a "New for you"
   mix. Measure: a Home fixture where an off-style song stays out of the first 10.
6. Later, if 1 to 5 fall short: exploration as a bandit over the explore slots (Thompson sampling; the floor kept,
   Anderson 2020).
**Not chosen** (the owner, 2026-11-18), with what each would add:
- Last.fm `track.getSimilar` / `artist.getSimilar`: similar songs "based on listening data", for users with their own key.
  It would send the titles being played beyond the scrobbles, and the privacy row would change.
- ListenBrainz labs `similar-artists`: an open crowd from listening sessions, keyed by MusicBrainz ids. It means a new host
  (plus MusicBrainz at 1 request a second), and its staff call it experimental.

Sources read for this section: the code above; Last.fm `track.getSimilar` / `artist.getSimilar` pages
(https://www.last.fm/api/show/track.getSimilar, https://www.last.fm/api/show/artist.getSimilar: search excerpts only);
ListenBrainz API docs (https://listenbrainz.readthedocs.io/en/latest/users/api/core.html, similar-artists response) and the
MetaBrainz forum on the labs similarity API's stability (https://community.metabrainz.org/t/stability-of-the-similarity-api/570849).
Not read in full: those pages themselves (only search excerpts); no documentation found for a labs similar-recordings
endpoint; YouTube Music's radio algorithm is not public (the two papers above are YouTube's, not YouTube Music's).

## Sources
- Covington, Adams, Sargin, Deep Neural Networks for YouTube Recommendations (RecSys 2016): https://gwern.net/doc/ai/nn/retrieval/2016-covington.pdf (summary: https://blog.acolyer.org/2016/09/19/deep-neural-networks-for-youtube-recommendations/)
- Zhao et al., Recommending What Video to Watch Next: A Multitask Ranking System (RecSys 2019): https://research.google/pubs/recommending-what-video-to-watch-next-a-multitask-ranking-system/
- Wilhelm et al., Practical Diversified Recommendations on YouTube with Determinantal Point Processes (CIKM 2018): https://dl.acm.org/doi/10.1145/3269206.3272018
- Anderson et al., Algorithmic Effects on the Diversity of Consumption on Spotify (WWW 2020): https://www.cs.utoronto.ca/~ashton/pubs/alg-effects-spotify-www2020.pdf
- Mok et al., The Dynamics of Exploration on Spotify (ICWSM 2022): https://ojs.aaai.org/index.php/ICWSM/article/view/19324
- Efraimidis, Spirakis, Weighted random sampling with a reservoir (2006); the log form: https://opensource.posit.co/blog/2020-07-29_parallelized-sampling/
- Result Diversification in Search and Recommendation: A Survey (MMR, DPP): https://arxiv.org/pdf/2212.14464

## Measured (2026-11-18, the rebuild)
On the made-up library of `feel.test.ts`: a mix from a song had 11 favourites of another style in 30, now at most 2; after Up
next 4 in 15, now at most 2; signed out, songs played next to the queue's lead. In Shuffle the most played artist came every
other song; now any two songs of an artist are at least 4 apart in the first 30, and an early skip clears the next 10 of that
artist. A whole Shuffle of 10 000 songs: about 11 ms (`shuffleBench.test.ts`). Still never heard by ear.

## Measured (2026-11-14, lot 42B)
Node, the code the app runs, 10 000 songs with tags, best of 5 on a PC doing other things: a whole Shuffle (the taste store built from
the signals, `libraryScores`, `weightedOrder`, the artist pass) takes about 27 ms (store 0.3, scores 14, order 12), under the 50 ms
target, so the scoring stays in the front end. 15 picks for the end of Up next (profiles, scores, dose, MMR) take about 30 ms. `pnpm
bench` prints the Shuffle line and puts it in the row's notes (`shuffleBench.test.ts`); the rest of that run (start, RAM, CPU) was
not run for this lot. Never heard by ear: every weight here is a first guess.
