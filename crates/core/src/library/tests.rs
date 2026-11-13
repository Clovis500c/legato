use super::*;

fn spotify() -> Track {
    Track {
        title: "Get Lucky (feat. Pharrell Williams)".into(),
        artist: "Daft Punk, Pharrell Williams".into(),
        album: Some("Random Access Memories".into()),
        duration_ms: Some(248_000),
        isrc: Some("USQX91300108".into()),
        ids: BTreeMap::from([(Source::Spotify, "2Foc5Q5nqNiosCNqttzHof".into())]),
        art: Some("https://i.scdn.co/image/ram".into()),
        musicness: None,
        explicit: false,
    }
}

fn youtube() -> Track {
    Track {
        title: "Get Lucky (Official Audio)".into(),
        artist: "Daft Punk".into(),
        duration_ms: Some(250_000),
        ids: BTreeMap::from([(Source::Youtube, "5NV6Rdv1a3I".into())]),
        ..Default::default()
    }
}

fn served(key: &str, n: usize) -> Vec<Track> {
    (0..n).map(|i| Track { title: format!("Song {i} of {key}"), artist: format!("Artist {}", i % 50), album: Some(format!("Album {}", i / 10)), duration_ms: Some(200_000 + i as u32), ids: BTreeMap::from([(Source::Server, format!("{key}:tr-{i}"))]), ..Default::default() }).collect()
}

#[test]
fn a_servers_songs_mirror_its_sync_and_join_the_same_songs_from_elsewhere() -> Result<()> {
    let lib = Library::in_memory()?;
    lib.upsert_track(&spotify())?;
    let mut songs = served("s1", 3);
    // Same song as the Spotify one (ISRC): one row with both sources.
    songs.push(Track { ids: BTreeMap::from([(Source::Server, "s1:lucky".into())]), ..spotify() });
    assert_eq!(lib.replace_server("s1", &songs, true)?, 4);
    // Another server's songs are its own.
    lib.replace_server("s2", &served("s2", 2), true)?;
    let all = lib.tracks()?;
    assert_eq!(all.len(), 6);
    let lucky = all.iter().find(|t| t.track.ids.contains_key(&Source::Spotify)).unwrap();
    assert_eq!(lucky.track.ids.get(&Source::Server).map(String::as_str), Some("s1:lucky"));
    // Next sync: one song gone from the server; the Spotify song stays, without the server.
    lib.replace_server("s1", &served("s1", 3), true)?;
    let all = lib.tracks()?;
    assert_eq!(all.len(), 6);
    assert!(all.iter().all(|t| t.track.ids.get(&Source::Server).is_none_or(|id| id != "s1:lucky")));
    // Signed out: its songs and lists go, the other server's stay.
    lib.save_playlist(Source::Server, "s1:pl-1", "Road", &served("s1", 2))?;
    lib.save_playlist(Source::Server, "s2:pl-1", "Road", &served("s2", 1))?;
    lib.drop_server_playlists("s1", &[])?;
    lib.replace_server("s1", &[], true)?;
    assert_eq!(lib.tracks()?.len(), 3);
    assert_eq!(lib.playlists()?.iter().filter(|p| p.source == Source::Server).count(), 1);
    Ok(())
}

#[test]
fn ten_thousand_server_songs_land_in_one_write() -> Result<()> {
    let lib = Library::in_memory()?;
    let songs = served("s1", 10_000);
    let started = std::time::Instant::now();
    assert_eq!(lib.replace_server("s1", &songs, true)?, 10_000);
    // Again (the next sync): nothing new, quicker.
    lib.replace_server("s1", &songs, true)?;
    assert_eq!(lib.tracks()?.len(), 10_000);
    // Debug build: generous. Async command, so never on the window's thread anyway.
    assert!(started.elapsed() < std::time::Duration::from_secs(60), "{:?}", started.elapsed());
    Ok(())
}

#[test]
fn a_partial_read_of_a_server_drops_nothing() -> Result<()> {
    let lib = Library::in_memory()?;
    lib.replace_server("s1", &served("s1", 3), true)?;
    let played = lib.tracks()?.into_iter().find(|t| t.track.ids.get(&Source::Server).is_some_and(|id| id == "s1:tr-2")).unwrap().id;
    lib.record_play(&crate::history::Play { track_id: played, started_at: 1, listened_ms: 200_000, completed: true })?;
    // Albums failed to come: only the first song read. The others stay, with their plays.
    assert_eq!(lib.replace_server("s1", &served("s1", 1), false)?, 3);
    assert_eq!(lib.tracks()?.len(), 3);
    assert_eq!(lib.play_stats()?.get(&played).map(|s| s.0), Some(1));
    // A whole read without them: they go.
    assert_eq!(lib.replace_server("s1", &served("s1", 1), true)?, 1);
    assert_eq!(lib.tracks()?.len(), 1);
    Ok(())
}

#[test]
fn a_playlist_made_here_becomes_its_servers_once_created_there() -> Result<()> {
    let lib = Library::in_memory()?;
    let id = lib.edit_playlist(PlaylistEdit::Create { name: "Road".into() })?.unwrap();
    lib.adopt_playlist(id, Source::Server, "s1:pl-9")?;
    let p = lib.playlists()?.into_iter().find(|p| p.id == id).unwrap();
    assert_eq!((p.source, p.source_id.as_str(), p.custom), (Source::Server, "s1:pl-9", false));
    // Already a service's: no second adoption.
    assert!(lib.adopt_playlist(id, Source::Server, "s1:pl-10").is_err());
    Ok(())
}

#[test]
fn a_server_playlist_gone_from_it_goes_here() -> Result<()> {
    let lib = Library::in_memory()?;
    lib.save_playlist(Source::Server, "s1:a", "A", &served("s1", 2))?;
    lib.save_playlist(Source::Server, "s1:b", "B", &served("s1", 2))?;
    lib.drop_server_playlists("s1", &["s1:a".into()])?;
    let names: Vec<String> = lib.playlists()?.into_iter().map(|p| p.name).collect();
    assert_eq!(names, ["A"]);
    Ok(())
}

#[test]
fn merging_duplicates_keeps_everything_on_one_song() -> Result<()> {
    let lib = Library::in_memory()?;
    let mut video = Track { title: "Nightcall (Official Video)".into(), artist: "Kavinsky".into(), album: None, duration_ms: Some(300_000), isrc: None, ids: BTreeMap::from([(Source::Youtube, "v1".into())]), art: None, musicness: None, explicit: false };
    let a = lib.upsert_track(&video)?;
    video.title = "Nightcall".into();
    video.duration_ms = Some(258_000);
    video.album = Some("OutRun".into());
    video.ids = BTreeMap::from([(Source::Spotify, "s1".into())]);
    let b = lib.upsert_track(&video)?;
    assert_ne!(a, b);
    let pl = lib.edit_playlist(PlaylistEdit::Create { name: "Night".into() })?.unwrap();
    lib.edit_playlist(PlaylistEdit::Add { id: pl, track_ids: vec![b] })?;
    lib.merge_tracks(a, &[b])?;
    let all = lib.tracks()?;
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].track.ids.len(), 2);
    assert_eq!(all[0].track.album.as_deref(), Some("OutRun"));
    assert!(all[0].added_at.is_some_and(|t| t > 1_700_000_000), "new songs get a real date");
    assert_eq!(lib.playlist_track_ids(pl)?, [a]);
    assert!(lib.merge_tracks(999, &[a]).is_err());
    Ok(())
}

#[test]
fn dedupes_by_isrc_across_sources() -> Result<()> {
    let lib = Library::in_memory()?;
    let a = lib.upsert_track(&spotify())?;
    let b = lib.upsert_track(&Track { isrc: Some("usqx91300108".into()), ..youtube() })?;
    assert_eq!(a, b);
    let all = lib.tracks()?;
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].track.ids.len(), 2);
    Ok(())
}

#[test]
fn dedupes_by_fuzzy_without_isrc() -> Result<()> {
    let lib = Library::in_memory()?;
    lib.upsert_track(&spotify())?;
    lib.upsert_track(&youtube())?;
    assert_eq!(lib.tracks()?.len(), 1);
    Ok(())
}

#[test]
fn keeps_different_isrc_apart() -> Result<()> {
    let lib = Library::in_memory()?;
    lib.upsert_track(&spotify())?;
    lib.upsert_track(&Track {
        isrc: Some("USQX91300999".into()),
        ids: BTreeMap::from([(Source::Spotify, "other".into())]),
        ..spotify()
    })?;
    assert_eq!(lib.tracks()?.len(), 2);
    Ok(())
}

#[test]
fn merges_rows_when_match_links_them() -> Result<()> {
    let lib = Library::in_memory()?;
    // Long-intro clip: duration too far for fuzzy, stays separate…
    let clip = Track { duration_ms: Some(300_000), ..youtube() };
    lib.upsert_track(&spotify())?;
    lib.upsert_track(&clip)?;
    assert_eq!(lib.tracks()?.len(), 2);
    let pid = lib.save_playlist(Source::Youtube, "PL1", "Mix", std::slice::from_ref(&clip))?;
    // …until YouTube → Spotify match links both ids.
    let mut linked = clip.clone();
    linked.isrc = spotify().isrc;
    linked.ids.extend(spotify().ids);
    lib.upsert_track(&linked)?;
    let all = lib.tracks()?;
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].track.isrc.as_deref(), Some("USQX91300108"));
    assert_eq!(all[0].track.album.as_deref(), Some("Random Access Memories"));
    assert_eq!(lib.playlist_tracks(pid)?.iter().map(|t| t.id).collect::<Vec<_>>(), vec![all[0].id]);
    Ok(())
}

#[test]
fn imported_mirror_takes_tracks_custom_edit_still_refuses() -> Result<()> {
    let lib = Library::in_memory()?;
    let pid = lib.save_playlist(Source::Youtube, "PL1", "Mix", &[youtube()])?;
    let other = lib.upsert_track(&spotify())?;
    lib.append_to_imported(pid, &[other])?;
    assert_eq!(lib.playlist_tracks(pid)?.len(), 2);
    assert!(lib.edit_playlist(PlaylistEdit::Add { id: pid, track_ids: vec![other] }).is_err());
    // YouTube playlist: newest on top.
    assert_eq!(lib.playlist_orders()?[&pid][0], other);
    Ok(())
}

fn song(n: u32) -> Track {
    Track { title: format!("Song {n}"), artist: format!("Artist {n}"), ids: BTreeMap::from([(Source::Youtube, format!("vid{n}"))]), ..Default::default() }
}

#[test]
fn a_song_not_found_is_listed_and_left_alone_for_a_while() -> Result<()> {
    let lib = Library::in_memory()?;
    let spotify = |id: &str, title: &str| Track { title: title.into(), artist: "A".into(), ids: [(Source::Spotify, id.to_string())].into(), ..Default::default() };
    let row = lib.upsert_track(&spotify("s1", "One"))?;
    lib.upsert_track(&spotify("s2", "Two"))?;
    assert!(lib.not_found()?.is_empty());
    assert!(!lib.not_found_lately(&spotify("s1", "One"))?);
    lib.mark_not_found(&spotify("s1", "One"))?;
    assert_eq!(lib.not_found()?, [row]);
    assert!(lib.not_found_lately(&spotify("s1", "One"))?);
    assert!(!lib.not_found_lately(&spotify("s2", "Two"))?, "never searched");
    lib.db.execute("UPDATE not_found SET searched = 0", [])?;
    assert!(!lib.not_found_lately(&spotify("s1", "One"))?, "a month later: searched again");
    assert_eq!(lib.not_found()?, [row], "still on the list meanwhile");
    Ok(())
}

#[test]
fn a_song_found_after_all_leaves_the_list() -> Result<()> {
    let lib = Library::in_memory()?;
    let spotify = Track { title: "One".into(), artist: "A".into(), ids: [(Source::Spotify, "s1".to_string())].into(), ..Default::default() };
    lib.upsert_track(&spotify)?;
    lib.mark_not_found(&spotify)?;
    lib.add_version(&Track { ids: [(Source::Spotify, "s1".to_string()), (Source::Youtube, "v1".to_string())].into(), ..spotify.clone() })?;
    assert!(lib.not_found()?.is_empty());
    Ok(())
}

#[test]
fn a_song_merged_into_another_stays_on_the_list() -> Result<()> {
    let lib = Library::in_memory()?;
    let on = |source, id: &str, isrc: Option<&str>| Track { title: "One".into(), artist: "A".into(), duration_ms: Some(1000), isrc: isrc.map(String::from), ids: [(source, id.to_string())].into(), ..Default::default() };
    let keep = lib.upsert_track(&on(Source::Apple, "a1", None))?;
    lib.db.execute("UPDATE tracks SET match_key = 'other' WHERE id = ?1", [keep])?;
    let dupe = lib.upsert_track(&on(Source::Spotify, "s1", Some("USAAA0000001")))?;
    assert_ne!(keep, dupe);
    lib.mark_not_found(&on(Source::Spotify, "s1", None))?;
    lib.upsert_track(&Track { ids: [(Source::Apple, "a1".to_string()), (Source::Spotify, "s1".to_string())].into(), ..on(Source::Apple, "a1", None) })?;
    assert_eq!(lib.not_found()?, [keep]);
    Ok(())
}

#[test]
fn a_version_picked_by_hand_joins_the_row_its_playlists_hold() -> Result<()> {
    let lib = Library::in_memory()?;
    let spotify = Track { title: "One".into(), artist: "A".into(), duration_ms: Some(200_000), ids: [(Source::Spotify, "s1".to_string())].into(), ..Default::default() };
    let list = lib.save_playlist(Source::Spotify, "export:x", "X", std::slice::from_ref(&spotify))?;
    let row = lib.playlist_tracks(list)?[0].id;
    lib.mark_not_found(&spotify)?;
    // The video the user picked is already a song of theirs, named its own way.
    let video = Track { title: "A - One (Official Video)".into(), artist: "A VEVO".into(), duration_ms: Some(215_000), ids: [(Source::Youtube, "v1".to_string())].into(), art: Some("https://i.ytimg.com/vi/v1/hqdefault.jpg".into()), ..Default::default() };
    let own = lib.upsert_track(&video)?;
    assert_ne!(own, row);
    lib.set_version(row, &video)?;
    assert!(lib.not_found()?.is_empty());
    let tracks = lib.tracks()?;
    assert_eq!(tracks.len(), 1, "one row, not two");
    let t = &tracks[0];
    assert_eq!((t.id, t.track.title.as_str(), t.track.ids.get(&Source::Youtube).map(String::as_str)), (row, "One", Some("v1")));
    assert_eq!(lib.playlist_tracks(list)?[0].id, row);
    assert!(lib.set_version(9999, &video).is_err());
    Ok(())
}

#[test]
fn a_song_removed_leaves_the_list() -> Result<()> {
    let lib = Library::in_memory()?;
    let spotify = Track { title: "One".into(), artist: "A".into(), ids: [(Source::Spotify, "s1".to_string())].into(), ..Default::default() };
    let row = lib.upsert_track(&spotify)?;
    lib.mark_not_found(&spotify)?;
    lib.db.execute("DELETE FROM tracks WHERE id = ?1", [row])?;
    assert!(lib.not_found()?.is_empty());
    Ok(())
}

#[test]
fn a_version_found_later_reaches_the_saved_list() -> Result<()> {
    let lib = Library::in_memory()?;
    let spotify = |id: &str, title: &str| Track { title: title.into(), artist: "A".into(), ids: [(Source::Spotify, id.to_string())].into(), ..Default::default() };
    let list = lib.save_playlist(Source::Spotify, "export:x", "X", &[spotify("s1", "One"), spotify("s2", "Two")])?;
    lib.add_version(&Track { ids: [(Source::Spotify, "s1".to_string()), (Source::Youtube, "v1".to_string())].into(), ..spotify("s1", "One") })?;
    assert_eq!(lib.playlist_track_ids(list)?.len(), 2);
    assert_eq!(lib.known_youtube(&spotify("s1", "One"))?.as_deref(), Some("v1"));
    assert_eq!(lib.known_youtube(&spotify("s2", "Two"))?, None);
    Ok(())
}

#[test]
fn an_import_knows_the_youtube_version_it_already_found() -> Result<()> {
    let lib = Library::in_memory()?;
    let spotify = |id: &str, title: &str| Track { title: title.into(), artist: "A".into(), ids: [(Source::Spotify, id.to_string())].into(), ..Default::default() };
    let found = Track { ids: [(Source::Spotify, "s1".to_string()), (Source::Youtube, "v1".to_string())].into(), ..spotify("s1", "One") };
    lib.upsert_track(&found)?;
    lib.upsert_track(&spotify("s2", "Two"))?;
    assert_eq!(lib.known_youtube(&spotify("s1", "One"))?.as_deref(), Some("v1"));
    // Same song by its words, from another service's list.
    let elsewhere = Track { ids: [(Source::Apple, "x".to_string())].into(), ..spotify("", "One") };
    assert_eq!(lib.known_youtube(&elsewhere)?.as_deref(), Some("v1"));
    assert_eq!(lib.known_youtube(&spotify("s2", "Two"))?, None, "known, but no version: searched");
    assert_eq!(lib.known_youtube(&spotify("s3", "Three"))?, None);
    Ok(())
}

#[test]
fn likes_of_any_service_go_to_the_one_liked_music() -> Result<()> {
    let lib = Library::in_memory()?;
    let song = |id: &str| Track { title: id.into(), artist: "A".into(), ids: [(Source::Spotify, id.to_string()), (Source::Youtube, format!("v{id}"))].into(), ..Default::default() };
    // No YouTube Music: all in yours, once, however often imported.
    let own = lib.add_likes(&[song("a"), song("b"), song("a")])?;
    assert_eq!(lib.add_likes(&[song("b"), song("c")])?, own);
    assert_eq!(lib.playlist_tracks(own)?.iter().map(|t| t.track.title.as_str()).collect::<Vec<_>>(), ["a", "b", "c"]);
    assert_eq!(lib.playlists()?.len(), 1, "no Liked Songs beside it");
    // Its list stays YouTube Music's own: what isn't there waits in yours, what is stays out.
    let lm = lib.save_playlist(Source::Youtube, "LM", "Liked Music", &[song("a"), song("d")])?;
    assert_eq!(lib.add_likes(&[song("d"), song("e")])?, lm);
    assert_eq!(lib.playlist_tracks(own)?.iter().map(|t| t.track.title.as_str()).collect::<Vec<_>>(), ["a", "b", "c", "e"]);
    assert_eq!(lib.playlist_tracks(lm)?.len(), 2);
    Ok(())
}

#[test]
fn liked_music_comes_newest_first_date_added_follows() -> Result<()> {
    let lib = Library::in_memory()?;
    let old = lib.upsert_track(&song(9))?;
    let pid = lib.save_playlist(Source::Youtube, "LM", "Liked Music", &[song(1), song(2), song(3)])?;
    let order: Vec<i64> = lib.playlist_tracks(pid)?.iter().map(|t| t.id).collect();
    let added = |id: i64| lib.tracks().unwrap().into_iter().find(|t| t.id == id).unwrap().added;
    // Playlist keeps service order; newest like = newest row.
    assert!(added(order[0]) > added(order[1]) && added(order[1]) > added(order[2]) && added(order[2]) > added(old));
    assert!(lib.playlists()?[0].newest_first);
    // New like goes on top, like on YouTube.
    lib.append_to_imported(pid, &[old])?;
    assert_eq!(lib.playlist_orders()?[&pid][0], old);
    Ok(())
}

fn added_of(lib: &Library, pid: i64) -> Vec<i64> {
    let all = lib.tracks().unwrap();
    lib.playlist_tracks(pid).unwrap().iter().map(|t| all.iter().find(|a| a.id == t.id).unwrap().added).collect()
}

#[test]
fn youtube_playlists_come_newest_first() -> Result<()> {
    let lib = Library::in_memory()?;
    let pid = lib.save_playlist(Source::Youtube, "PL1", "Mix", &[song(1), song(2), song(3)])?;
    // Top song = last added (2026-10-20 report: "added newest" showed the oldest).
    assert_eq!(added_of(&lib, pid), vec![3, 2, 1]);
    assert!(lib.playlists()?[0].newest_first);
    Ok(())
}

#[test]
fn a_sync_learns_which_end_new_songs_land_on() -> Result<()> {
    let lib = Library::in_memory()?;
    let pid = lib.save_playlist(Source::Youtube, "PL1", "Mix", &[song(1), song(2), song(3)])?;
    // New song at the bottom: this playlist grows at the bottom after all.
    lib.save_playlist(Source::Youtube, "PL1", "Mix", &[song(1), song(2), song(3), song(4)])?;
    assert!(!lib.playlists()?[0].newest_first);
    assert_eq!(added_of(&lib, pid), vec![1, 2, 3, 4]);
    // And back: new one on top.
    lib.save_playlist(Source::Youtube, "PL1", "Mix", &[song(5), song(1), song(2), song(3), song(4)])?;
    assert!(lib.playlists()?[0].newest_first);
    assert_eq!(added_of(&lib, pid), vec![5, 4, 3, 2, 1]);
    Ok(())
}

#[test]
fn order_set_by_hand_wins_over_syncs() -> Result<()> {
    let lib = Library::in_memory()?;
    let pid = lib.save_playlist(Source::Youtube, "PL1", "Mix", &[song(1), song(2)])?;
    lib.edit_playlist(PlaylistEdit::SetOrder { id: pid, newest_first: Some(false) })?;
    assert_eq!(added_of(&lib, pid), vec![1, 2]);
    lib.save_playlist(Source::Youtube, "PL1", "Mix", &[song(3), song(1), song(2)])?;
    assert!(!lib.playlists()?[0].newest_first);
    // Automatic again: next sync decides.
    lib.edit_playlist(PlaylistEdit::SetOrder { id: pid, newest_first: None })?;
    assert!(lib.playlists()?[0].newest_first);
    Ok(())
}

#[test]
fn removed_songs_stay_out_of_syncs_until_added_again() -> Result<()> {
    let lib = Library::in_memory()?;
    let pid = lib.save_playlist(Source::Youtube, "PL1", "Mix", &[song(1), song(2)])?;
    let custom = lib.edit_playlist(PlaylistEdit::Create { name: "Mine".into() })?.unwrap();
    let gone = lib.playlist_tracks(pid)?.into_iter().find(|t| t.track.title == "Song 1").unwrap().id;
    lib.edit_playlist(PlaylistEdit::Add { id: custom, track_ids: vec![gone, gone] })?;
    lib.remove_track(gone)?;
    assert!(lib.tracks()?.iter().all(|t| t.id != gone));
    assert!(lib.playlist_tracks(custom)?.is_empty());
    // Next sync: still in the service's playlist, still out of the app.
    lib.save_playlist(Source::Youtube, "PL1", "Mix", &[song(1), song(2)])?;
    assert_eq!(lib.playlist_tracks(pid)?.iter().map(|t| t.track.title.as_str()).collect::<Vec<_>>(), ["Song 2"]);
    // Added again by hand: back on the next sync.
    lib.unremove(&song(1))?;
    lib.save_playlist(Source::Youtube, "PL1", "Mix", &[song(1), song(2)])?;
    assert_eq!(lib.playlist_tracks(pid)?.len(), 2);
    Ok(())
}

#[test]
fn local_files_keep_their_genre_and_year() -> Result<()> {
    let lib = Library::in_memory()?;
    let file = |genre: Option<&str>, year| LocalSong { track: Track { ids: [(Source::Local, "C:/Music/1.flac".into())].into(), ..song(1) }, genre: genre.map(Into::into), year, bpm: year.map(|_| 128), key: year.map(|_| "8A".to_string()) };
    lib.replace_local(&[file(Some("Jazz"), Some(1959))])?;
    let t = &lib.tracks()?[0];
    assert_eq!((t.genre.as_deref(), t.year, t.bpm, t.key.as_deref()), (Some("Jazz"), Some(1959), Some(128), Some("8A")));
    // Tags taken off the file: the next scan takes them off the song, and the interface gets no empty field.
    lib.replace_local(&[file(None, None)])?;
    let t = &lib.tracks()?[0];
    assert_eq!((t.genre.as_deref(), t.year), (None, None));
    let json = serde_json::to_value(t)?;
    assert!(json.get("genre").is_none() && json.get("year").is_none() && json.get("bpm").is_none() && json.get("key").is_none() && json.get("title").is_some());
    Ok(())
}

#[test]
fn a_vanished_file_held_by_a_playlist_is_sourceless() -> Result<()> {
    let lib = Library::in_memory()?;
    let file = |n: u32| Track { ids: [(Source::Local, format!("C:/Music/{n}.mp3"))].into(), ..song(n) };
    lib.replace_local(&[file(1).into(), file(2).into()])?;
    let kept = lib.tracks()?.into_iter().find(|t| t.track.title == "Song 1").unwrap().id;
    let id = lib.edit_playlist(PlaylistEdit::Create { name: "Mine".into() })?.unwrap();
    lib.edit_playlist(PlaylistEdit::Add { id, track_ids: vec![kept] })?;
    assert!(lib.sourceless()?.is_empty());
    assert_eq!(lib.local_files()?.iter().map(|(_, p, art)| (p.as_str(), *art)).collect::<Vec<_>>(), [("C:/Music/1.mp3", false), ("C:/Music/2.mp3", false)]);
    // Both files gone: the one a playlist holds stays, sourceless; the other leaves.
    lib.replace_local(&[])?;
    let gone = lib.sourceless()?;
    assert_eq!((gone.len(), gone[0].id, gone[0].track.ids.is_empty()), (1, kept, true));
    assert!(lib.local_files()?.is_empty());
    Ok(())
}

#[test]
fn remove_track_takes_every_occurrence() -> Result<()> {
    let lib = Library::in_memory()?;
    let a = lib.upsert_track(&song(1))?;
    let b = lib.upsert_track(&song(2))?;
    let id = lib.edit_playlist(PlaylistEdit::Create { name: "Mine".into() })?.unwrap();
    lib.edit_playlist(PlaylistEdit::Add { id, track_ids: vec![a, b, a] })?;
    lib.edit_playlist(PlaylistEdit::RemoveTrack { id, track_id: a })?;
    assert_eq!(lib.playlist_orders()?[&id], vec![b]);
    // Imported mirror: through its own call, once the service dropped it.
    let pid = lib.save_playlist(Source::Youtube, "PL1", "Mix", &[song(1), song(2), song(1)])?;
    assert!(lib.edit_playlist(PlaylistEdit::RemoveTrack { id: pid, track_id: a }).is_err());
    lib.remove_from_imported(pid, a)?;
    assert_eq!(lib.playlist_orders()?[&pid], vec![b]);
    assert_eq!(lib.source_ids(a, Source::Youtube)?, ["vid1"]);
    Ok(())
}

#[test]
fn explicit_once_a_source_says_so() -> Result<()> {
    let lib = Library::in_memory()?;
    let get = |id| lib.tracks().unwrap().into_iter().find(|t| t.id == id).unwrap().track.explicit;
    let id = lib.upsert_track(&song(1))?;
    assert!(!get(id));
    lib.upsert_track(&Track { explicit: true, ..song(1) })?;
    assert!(get(id));
    // Seen again unmarked (another source): kept.
    lib.upsert_track(&song(1))?;
    assert!(get(id));
    // Merged from a duplicate row: carried over.
    let a = lib.upsert_track(&song(2))?;
    let b = lib.upsert_track(&Track { explicit: true, ..song(3) })?;
    lib.merge_tracks(a, &[b])?;
    assert!(get(a));
    // The user's word: not explicit. A source saying so again doesn't undo it; the user can take it back.
    lib.set_explicit_ok(&[a, id], true)?;
    assert!(!get(a) && !get(id));
    lib.upsert_track(&Track { explicit: true, ..song(1) })?;
    assert!(!get(id));
    lib.set_explicit_ok(&[id], false)?;
    assert!(get(id));
    Ok(())
}

#[test]
fn music_or_not_is_kept_and_a_music_label_wins() -> Result<()> {
    let lib = Library::in_memory()?;
    let talk = Track { musicness: Some(Musicness::NotMusic), ..song(1) };
    let id = lib.upsert_track(&talk)?;
    let get = |id| lib.tracks().unwrap().into_iter().find(|t| t.id == id).unwrap().track.musicness;
    assert_eq!(get(id), Some(Musicness::NotMusic));
    // Seen again without a word: kept. Seen as a song somewhere: music.
    lib.upsert_track(&song(1))?;
    assert_eq!(get(id), Some(Musicness::NotMusic));
    lib.upsert_track(&Track { musicness: Some(Musicness::Music), ..song(1) })?;
    assert_eq!(get(id), Some(Musicness::Music));
    lib.upsert_track(&Track { musicness: Some(Musicness::NotMusic), ..song(1) })?;
    assert_eq!(get(id), Some(Musicness::Music));
    Ok(())
}

#[test]
fn old_imports_get_todays_rules_and_the_users_word_wins() -> Result<()> {
    let lib = Library::in_memory()?;
    let video = |n: u32, title: &str, channel: &str| Track { title: title.into(), artist: channel.into(), duration_ms: Some(500_000), ids: BTreeMap::from([(Source::Youtube, format!("v{n}"))]), ..Default::default() };
    // Imported before musicness existed: no word stored.
    let talk = lib.upsert_track(&video(1, "Is Roblox Development A Viable Career?", "SmartyRBX"))?;
    let song = lib.upsert_track(&video(2, "how to sleep", "Deathbrain"))?;
    // A talk channel's doubts are talk too.
    lib.upsert_track(&video(3, "How To Make A Combat System In Roblox Studio", "Roblox Learn"))?;
    lib.upsert_track(&video(4, "How to style your UI on Roblox", "Roblox Learn"))?;
    let doubt = lib.upsert_track(&video(5, "Big day", "Roblox Learn"))?;
    let words = lib.music_words()?;
    assert_eq!((words[&talk], words[&doubt]), (Musicness::NotMusic, Musicness::NotMusic));
    assert_ne!(words[&song], Musicness::NotMusic);
    // The user's word beats the rules and survives a re-import.
    lib.set_music(&[talk], Some(true))?;
    lib.upsert_track(&Track { musicness: Some(Musicness::NotMusic), ..video(1, "Is Roblox Development A Viable Career?", "SmartyRBX") })?;
    assert_eq!(lib.tracks()?.iter().find(|t| t.id == talk).unwrap().track.musicness, Some(Musicness::Music));
    lib.set_music(&[song], Some(false))?;
    assert_eq!(lib.music_words()?[&song], Musicness::NotMusic);
    lib.set_music(&[song], None)?;
    assert_ne!(lib.music_words()?[&song], Musicness::NotMusic);
    Ok(())
}

#[test]
fn growth_side_needs_new_songs_on_one_end() {
    assert_eq!(growth_side(&[false, true, true]), Some(true));
    assert_eq!(growth_side(&[true, true, false]), Some(false));
    assert_eq!(growth_side(&[false, true, false]), None);
    assert_eq!(growth_side(&[true, true]), None);
    assert_eq!(growth_side(&[false, false]), None);
    assert_eq!(growth_side(&[]), None);
}

#[test]
fn v5_flips_youtube_playlists_inside_their_slots() -> Result<()> {
    let db = Connection::open_in_memory()?;
    db.execute_batch(SCHEMA)?;
    db.execute_batch("ALTER TABLE playlists ADD COLUMN custom INTEGER NOT NULL DEFAULT 0;")?;
    db.execute_batch(crate::history::SCHEMA_V2)?;
    db.execute_batch(SCHEMA_V3)?;
    db.execute_batch("ALTER TABLE tracks ADD COLUMN added INTEGER NOT NULL DEFAULT 0; PRAGMA user_version = 4;")?;
    for id in 1..=5 {
        db.execute("INSERT INTO tracks (id, title, artist, match_key, added) VALUES (?1, 't', 'a', ?1, ?1)", [id])?;
    }
    // Spotify playlist first (keeps its order), then a YouTube one imported as if it grew at the bottom.
    db.execute_batch(
        "INSERT INTO playlists (id, source, source_id, name) VALUES (1, 'spotify', 'p1', 'S'), (2, 'youtube', 'PL1', 'Mix');
         INSERT INTO playlist_tracks VALUES (1, 0, 1), (1, 1, 2), (2, 0, 3), (2, 1, 4), (2, 2, 5), (2, 3, 1);",
    )?;
    let lib = Library::init(db)?;
    let added: Vec<i64> = (1..=5).map(|id| lib.db.query_row("SELECT added FROM tracks WHERE id = ?1", [id], |r| r.get(0)).unwrap()).collect();
    // Track 1 belongs to the Spotify import (first seen there): untouched. 3, 4, 5 flipped in their slots.
    assert_eq!(added, vec![1, 2, 5, 4, 3]);
    Ok(())
}

#[test]
fn v4_flips_liked_music_inside_its_slots() -> Result<()> {
    let db = Connection::open_in_memory()?;
    db.execute_batch(SCHEMA)?;
    db.execute_batch("ALTER TABLE playlists ADD COLUMN custom INTEGER NOT NULL DEFAULT 0;")?;
    db.execute_batch(crate::history::SCHEMA_V2)?;
    db.execute_batch(SCHEMA_V3)?;
    for id in 1..=4 {
        db.execute("INSERT INTO tracks (id, title, artist, match_key) VALUES (?1, 't', 'a', ?1)", [id])?;
    }
    db.execute_batch(
        "INSERT INTO playlists (id, source, source_id, name) VALUES (1, 'youtube', 'LM', 'Liked'), (2, 'youtube', 'PL1', 'Mix');
         INSERT INTO playlist_tracks VALUES (1, 0, 1), (1, 1, 2), (1, 2, 3), (2, 0, 4);",
    )?;
    let lib = Library::init(db)?;
    let added: Vec<i64> = (1..=4).map(|id| lib.db.query_row("SELECT added FROM tracks WHERE id = ?1", [id], |r| r.get(0)).unwrap()).collect();
    assert_eq!(added, vec![3, 2, 1, 4]);
    Ok(())
}

#[test]
fn replaces_playlist_content() -> Result<()> {
    let lib = Library::in_memory()?;
    lib.save_playlist(Source::Spotify, "p1", "Old", &[spotify(), youtube()])?;
    let id = lib.save_playlist(Source::Spotify, "p1", "New", &[spotify()])?;
    assert_eq!(
        lib.playlists()?,
        vec![LibraryPlaylist { id, source: Source::Spotify, source_id: "p1".into(), name: "New".into(), track_count: 1, custom: false, newest_first: false, order_manual: false }]
    );
    Ok(())
}

#[test]
fn local_scan_links_known_tracks_and_prunes_vanished_files() -> Result<()> {
    let lib = Library::in_memory()?;
    lib.upsert_track(&spotify())?;
    let file = |p: &str, title: &str, isrc: Option<&str>| Track {
        title: title.into(),
        artist: "Daft Punk".into(),
        duration_ms: Some(248_500),
        isrc: isrc.map(Into::into),
        ids: BTreeMap::from([(Source::Local, p.into())]),
        ..Default::default()
    };
    let lucky = file("C:/m/a.flac", "Get Lucky", Some("USQX91300108"));
    assert_eq!(lib.replace_local(&[lucky.clone().into(), file("C:/m/b.flac", "Contact", None).into()])?, 2);
    let all = lib.tracks()?;
    assert_eq!(all.len(), 2);
    assert!(all.iter().any(|t| t.track.ids.len() == 2), "file linked to Spotify track");
    lib.replace_local(&[lucky.clone().into()])?;
    let all = lib.tracks()?;
    assert_eq!(all.len(), 1, "vanished file's orphan row removed");
    assert_eq!(all[0].track.ids.len(), 2);
    // Tags rewritten by the user: the row follows, a later rescan keeps it.
    let id = all[0].id;
    lib.set_details(id, "Get Lucky (Radio Edit)", "Daft Punk feat. Pharrell", None)?;
    lib.replace_local(&[Track { title: "Get Lucky (Radio Edit)".into(), artist: "Daft Punk feat. Pharrell".into(), ..lucky }.into()])?;
    let t = lib.tracks()?.into_iter().find(|t| t.id == id).unwrap().track;
    assert_eq!((t.title.as_str(), t.artist.as_str()), ("Get Lucky (Radio Edit)", "Daft Punk feat. Pharrell"));
    assert!(lib.set_details(9_999, "a", "b", None).is_err());
    Ok(())
}

#[test]
fn find_does_not_write() -> Result<()> {
    let lib = Library::in_memory()?;
    let id = lib.upsert_track(&spotify())?;
    assert_eq!(lib.find(&youtube())?, Some(id), "fuzzy match");
    assert_eq!(lib.find(&Track { title: "Other".into(), ..youtube() })?, None);
    assert_eq!(lib.tracks()?.len(), 1);
    Ok(())
}

#[test]
fn custom_playlist_lifecycle() -> Result<()> {
    let lib = Library::in_memory()?;
    let a = lib.upsert_track(&spotify())?;
    let b = lib.upsert_track(&Track { title: "Nightcall".into(), artist: "Kavinsky".into(), ..youtube() })?;
    let id = lib.edit_playlist(PlaylistEdit::Create { name: "  Road trip ".into() })?.unwrap();
    lib.edit_playlist(PlaylistEdit::Add { id, track_ids: vec![a, b, a] })?;
    lib.edit_playlist(PlaylistEdit::Move { id, from: 2, to: 0 })?;
    lib.edit_playlist(PlaylistEdit::Remove { id, position: 1 })?;
    assert_eq!(lib.playlist_tracks(id)?.iter().map(|t| t.id).collect::<Vec<_>>(), vec![a, b]);
    lib.edit_playlist(PlaylistEdit::Rename { id, name: "Route".into() })?;
    let p = lib.playlists()?.into_iter().find(|p| p.id == id).unwrap();
    assert_eq!((p.name.as_str(), p.track_count, p.custom), ("Route", 2, true));
    lib.edit_playlist(PlaylistEdit::Delete { id })?;
    assert!(lib.playlists()?.is_empty());
    Ok(())
}

#[test]
fn imported_playlists_are_read_only_but_duplicable() -> Result<()> {
    let lib = Library::in_memory()?;
    let id = lib.save_playlist(Source::Spotify, "p1", "Likes", &[spotify(), youtube()])?;
    assert!(lib.edit_playlist(PlaylistEdit::Rename { id, name: "X".into() }).is_err());
    assert!(lib.edit_playlist(PlaylistEdit::Delete { id }).is_err());
    assert!(lib.edit_playlist(PlaylistEdit::Create { name: " ".into() }).is_err());
    let copy = lib.edit_playlist(PlaylistEdit::Duplicate { id, name: "Likes perso".into() })?.unwrap();
    assert_eq!(lib.playlist_tracks(copy)?.len(), lib.playlist_tracks(id)?.len());
    // Re-sync replaces import, copy stays.
    lib.save_playlist(Source::Spotify, "p1", "Likes", &[])?;
    assert_eq!(lib.playlist_tracks(copy)?.len(), 2);
    Ok(())
}

#[test]
fn settings_roundtrip_and_overwrite() -> Result<()> {
    let lib = Library::in_memory()?;
    assert_eq!(lib.setting("ui")?, None);
    lib.set_setting("ui", &serde_json::json!({ "theme": "paper" }))?;
    lib.set_setting("ui", &serde_json::json!({ "theme": "graphite" }))?;
    assert_eq!(lib.setting("ui")?, Some(serde_json::json!({ "theme": "graphite" })));
    Ok(())
}

#[test]
fn migrations_end_at_the_schema_version_and_newer_libraries_are_refused() -> Result<()> {
    let lib = Library::in_memory()?;
    assert_eq!(lib.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))?, SCHEMA_VERSION);
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("library.db");
    drop(Library::open(&path)?);
    Connection::open(&path)?.execute_batch(&format!("PRAGMA user_version = {};", SCHEMA_VERSION + 1))?;
    let e = Library::open(&path).err().expect("refused");
    assert_eq!(e.downcast_ref::<NewerLibrary>(), Some(&NewerLibrary(SCHEMA_VERSION + 1)));
    Ok(())
}

/// 50,000-song library (2026-10-22 pass): load time. `cargo test -p music-core --release -- --ignored fifty`.
#[test]
#[ignore]
fn fifty_thousand_songs_load_fast() -> Result<()> {
    let lib = Library::in_memory()?;
    let t0 = std::time::Instant::now();
    lib.tx(|| {
        for i in 0..50_000 {
            let mut t = spotify();
            t.title = format!("Song {i}");
            t.artist = format!("Artist {}", i % 4000);
            t.isrc = None;
            t.ids = BTreeMap::from([(Source::Youtube, format!("v{i:010}"))]);
            lib.upsert_track(&t)?;
        }
        Ok(())
    })?;
    let insert = t0.elapsed();
    let t1 = std::time::Instant::now();
    let all = lib.tracks()?;
    let load = t1.elapsed();
    eprintln!("50k: insert {insert:?}, load {load:?}");
    assert_eq!(all.len(), 50_000);
    assert!(load.as_millis() < 1500, "load took {load:?}");
    Ok(())
}

/// What the UI reads after a like, whole library vs. changes only (2026-10-28 pass), 50,000 songs in 21 playlists.
/// `cargo test -p music-core --release -- --ignored --nocapture fifty_thousand_reads`. MUSIC_BENCH_JSON=<file>: the
/// whole answer written there (webview parse timed apart).
#[test]
#[ignore]
fn fifty_thousand_reads() -> Result<()> {
    #[derive(Serialize)]
    struct Whole {
        tracks: Vec<LibraryTrack>,
        playlists: Vec<LibraryPlaylist>,
    }
    let lib = Library::in_memory()?;
    let t0 = std::time::Instant::now();
    let ids = lib.tx(|| {
        (0..50_000)
            .map(|i| {
                let mut t = spotify();
                t.title = format!("Song {i}");
                t.artist = format!("Artist {}", i % 4000);
                t.isrc = None;
                t.ids = BTreeMap::from([(Source::Youtube, format!("v{i:010}"))]);
                // A third also on Spotify (no music guess for those).
                if i % 3 == 0 {
                    t.ids.insert(Source::Spotify, format!("s{i:010}"));
                }
                lib.upsert_track(&t)
            })
            .collect::<Result<Vec<_>>>()
    })?;
    let liked = lib.edit_playlist(PlaylistEdit::Create { name: "Liked Music".into() })?.unwrap();
    lib.edit_playlist(PlaylistEdit::Add { id: liked, track_ids: ids[..2000].to_vec() })?;
    for n in 0..20 {
        let p = lib.edit_playlist(PlaylistEdit::Create { name: format!("Mix {n}") })?.unwrap();
        lib.edit_playlist(PlaylistEdit::Add { id: p, track_ids: ids[n * 500..n * 500 + 500].to_vec() })?;
    }
    eprintln!("50k: insert {:?}", t0.elapsed());
    let t0 = std::time::Instant::now();
    lib.tx(|| {
        for i in 0..50_000 {
            let mut t = spotify();
            t.title = format!("Song {i}");
            t.artist = format!("Artist {}", i % 4000);
            t.isrc = None;
            t.ids = BTreeMap::from([(Source::Youtube, format!("v{i:010}"))]);
            lib.upsert_track(&t)?;
        }
        Ok(())
    })?;
    eprintln!("50k: seen again {:?}", t0.elapsed());

    let t = std::time::Instant::now();
    let whole = serde_json::to_string(&Whole { tracks: lib.tracks()?, playlists: lib.playlists()? })?;
    let orders = serde_json::to_string(&lib.playlist_orders()?)?;
    eprintln!("whole read: {:?}, {} + {} bytes (library + orders)", t.elapsed(), whole.len(), orders.len());
    let t = std::time::Instant::now();
    lib.music_words()?;
    eprintln!("  of which music words: {:?}", t.elapsed());
    if let Ok(path) = std::env::var("MUSIC_BENCH_JSON") {
        std::fs::write(path, &whole)?;
    }

    lib.forget_changes()?;
    let changes = |what: &str, edit: &dyn Fn() -> Result<()>| -> Result<()> {
        edit()?;
        let t = std::time::Instant::now();
        let c = serde_json::to_string(&lib.take_changes(5000)?.expect("small"))?;
        eprintln!("{what}, changes read: {:?}, {} bytes", t.elapsed(), c.len());
        Ok(())
    };
    changes("like (Liked Music, 2,000 songs)", &|| lib.edit_playlist(PlaylistEdit::Add { id: liked, track_ids: vec![ids[40_000]] }).map(drop))?;
    changes("song added", &|| lib.upsert_track(&Track { title: "New".into(), ..song(1) }).map(drop))?;
    changes("song out of the library and a playlist", &|| lib.remove_track(ids[100]))?;
    let rows = lib.playlist_tracks(liked)?;
    let t = std::time::Instant::now();
    lib.judged(rows.clone(), None)?;
    let all = t.elapsed();
    let t = std::time::Instant::now();
    lib.playlist_tracks(liked)?;
    eprintln!("Liked Music opened: {:?} (judged among the whole library: {all:?} more)", t.elapsed());
    Ok(())
}

#[test]
fn an_older_library_is_copied_before_migrating_a_new_one_is_not() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("library.db");
    let copy = dir.path().join(format!("library-before-v{SCHEMA_VERSION}.db"));
    let fresh = dir.path().join("fresh.db");
    drop(Library::open(&fresh)?);
    assert!(!dir.path().join(format!("library-before-v{SCHEMA_VERSION}.db")).exists(), "brand-new library: nothing to keep");
    // An old library (schema 0) holding something.
    Connection::open(&path)?.execute_batch("CREATE TABLE notes (x TEXT); INSERT INTO notes VALUES ('kept');")?;
    let lib = Library::open(&path)?;
    assert_eq!(lib.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))?, SCHEMA_VERSION);
    let old = Connection::open(&copy)?;
    assert_eq!(old.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))?, 0);
    assert_eq!(old.query_row("SELECT x FROM notes", [], |r| r.get::<_, String>(0))?, "kept");
    assert_eq!(old.query_row("SELECT count(*) FROM sqlite_master WHERE name = 'tracks'", [], |r| r.get::<_, i64>(0))?, 0);
    assert!(!dir.path().join(format!("library-before-v{SCHEMA_VERSION}.db.part")).exists());
    // Daily copy: made once, then fresh.
    lib.upsert_track(&spotify())?;
    assert!(keep_daily_copy(&path)?);
    assert!(!keep_daily_copy(&path)?);
    assert_eq!(Connection::open(dir.path().join("library-daily.db"))?.query_row("SELECT count(*) FROM tracks", [], |r| r.get::<_, i64>(0))?, 1);
    Ok(())
}

#[test]
fn a_backup_comes_back_whole_and_only_a_library_is_taken() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let at = |name: &str| dir.path().join(name);
    let (path, file) = (at("library.db"), at("Legato 2026-11-01.legato"));
    let mut lib = Library::open(&path)?;
    lib.upsert_track(&song(1))?;
    lib.set_setting("ui", &serde_json::json!({ "theme": "dark" }))?;
    back_up(&path, &file)?;
    lib.upsert_track(&song(2))?;
    lib.restore(&file)?;
    assert_eq!(lib.tracks()?.len(), 1);
    assert_eq!(lib.setting("ui")?, Some(serde_json::json!({ "theme": "dark" })));
    // The library as it was, beside it.
    assert_eq!(Connection::open(at("library-before-restore.db"))?.query_row("SELECT count(*) FROM tracks", [], |r| r.get::<_, i64>(0))?, 2);
    // A text file, another database, a newer app's library: refused, nothing changed.
    std::fs::write(at("notes.txt"), "hello")?;
    Connection::open(at("other.db"))?.execute_batch("CREATE TABLE notes (x TEXT);")?;
    Connection::open(at("newer.db"))?.execute_batch("CREATE TABLE tracks (x); CREATE TABLE playlists (x); CREATE TABLE settings (x); PRAGMA user_version = 999;")?;
    for bad in ["notes.txt", "other.db"] {
        assert_eq!(lib.restore(&at(bad)).unwrap_err().to_string(), NOT_A_BACKUP, "{bad}");
    }
    assert!(lib.restore(&at("newer.db")).unwrap_err().is::<NewerLibrary>());
    assert_eq!(lib.tracks()?.len(), 1);
    Ok(())
}

#[test]
fn edits_per_song_presets_and_one_active() -> Result<()> {
    let lib = Library::in_memory()?;
    let a = lib.save_edit(None, Some("t:1"), "Slowed", "{\"speed\":0.8}", 1)?;
    let b = lib.save_edit(None, Some("t:1"), "8D", "{}", 2)?;
    lib.save_edit(None, None, "My preset", "{}", 3)?;
    assert_eq!(lib.edits(Some("t:1"))?.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["Slowed", "8D"]);
    assert_eq!(lib.edits(None)?.len(), 1);
    lib.activate_edit("t:1", Some(a))?;
    lib.activate_edit("t:1", Some(b))?;
    let active: Vec<i64> = lib.edits(Some("t:1"))?.into_iter().filter(|e| e.active).map(|e| e.id).collect();
    assert_eq!(active, [b]);
    // Another song's id can't be made active here.
    lib.activate_edit("t:2", Some(b))?;
    assert!(lib.edits(Some("t:1"))?.iter().any(|e| e.active));
    lib.save_edit(Some(a), None, "Slowed more", "{\"speed\":0.7}", 4)?;
    assert_eq!(lib.edits(Some("t:1"))?[0].name, "Slowed more");
    lib.delete_edit(b)?;
    assert_eq!(lib.edits(Some("t:1"))?.len(), 1);
    Ok(())
}

#[test]
fn lyrics_cache_keeps_finds_and_misses() -> Result<()> {
    let lib = Library::in_memory()?;
    assert_eq!(lib.cached_lyrics("a|b|200")?, None);
    lib.save_lyrics("a|b|200", None, 10)?;
    assert_eq!(lib.cached_lyrics("a|b|200")?, Some((None, 10)));
    lib.save_lyrics("a|b|200", Some("{}"), 20)?;
    assert_eq!(lib.cached_lyrics("a|b|200")?, Some((Some("{}".into()), 20)));
    Ok(())
}

#[test]
fn a_line_finds_library_songs_by_their_cached_lyrics() -> Result<()> {
    let lib = Library::in_memory()?;
    let one = lib.upsert_track(&song(1))?;
    lib.upsert_track(&song(2))?;
    let sung = |text: &str| serde_json::json!({ "lines": [], "plain": text, "instrumental": false, "source": "LRCLIB" }).to_string();
    // Cached under another length and an older version: still the same song.
    lib.save_lyrics(&lyrics::key("ARTIST 1", "Song 1", Some(200_000)).replace("v5|", "v4|"), Some(&sung("Hello there\nGeneral Kenobi")), 1)?;
    lib.save_lyrics(&lyrics::key("Artist 2", "Song 2", None), None, 1)?;
    lib.save_lyrics(&lyrics::key("Someone", "Not mine", None), Some(&sung("General Kenobi again")), 1)?;
    assert_eq!(lib.lyrics_search("general ken", 10)?, [LyricHit { track_id: one, line: "General Kenobi".into() }]);
    assert!(lib.lyrics_search("general ken", 0)?.is_empty());
    assert!(lib.lyrics_search("obi wan", 10)?.is_empty());
    Ok(())
}

#[test]
fn a_song_keeps_its_bookmarks_through_a_merge_not_a_removal() -> Result<()> {
    let lib = Library::in_memory()?;
    let (one, two) = (lib.upsert_track(&song(1))?, lib.upsert_track(&song(2))?);
    assert!(lib.add_bookmark(one, 90_000, "  the solo ", 1)?);
    assert!(lib.add_bookmark(one, 30_000, "", 2)?);
    // Twice at the same moment: one bookmark, its note given later.
    assert!(lib.add_bookmark(one, 30_400, "intro ends", 3)?);
    assert!(lib.add_bookmark(one, 30_600, "", 4)?);
    let marks = lib.bookmarks(one)?;
    assert_eq!(marks.iter().map(|b| (b.ms, b.note.as_str())).collect::<Vec<_>>(), [(30_000, "intro ends"), (90_000, "the solo")]);
    // Gone songs and full ones keep nothing.
    assert!(!lib.add_bookmark(999, 1_000, "", 5)?);
    for k in 0..MAX_BOOKMARKS {
        lib.add_bookmark(two, k * 2_000, "", 6)?;
    }
    assert!(!lib.add_bookmark(two, 3_600_000, "", 7)?);
    lib.merge_tracks(two, &[one])?;
    assert_eq!(lib.bookmarks(two)?.len() as i64, MAX_BOOKMARKS + 2);
    lib.delete_bookmark(lib.bookmarks(two)?[0].id)?;
    assert_eq!(lib.bookmarks(two)?.len() as i64, MAX_BOOKMARKS + 1);
    lib.remove_track(two)?;
    assert!(lib.bookmarks(two)?.is_empty());
    Ok(())
}

#[test]
fn silence_cache_is_by_path_and_modified_time() -> Result<()> {
    let lib = Library::in_memory()?;
    assert_eq!(lib.cached_silence("a.mp3", 5)?, None);
    lib.save_silence("a.mp3", 5, 4_950, Some(200_000), 210_000)?;
    assert_eq!(lib.cached_silence("a.mp3", 5)?, Some((4_950, Some(200_000), 210_000)));
    // Changed file: measured again.
    assert_eq!(lib.cached_silence("a.mp3", 6)?, None);
    lib.save_silence("a.mp3", 6, 0, None, 210_000)?;
    assert_eq!(lib.cached_silence("a.mp3", 6)?, Some((0, None, 210_000)));
    Ok(())
}

#[test]
fn a_waveform_is_kept_until_its_file_changes() -> Result<()> {
    let lib = Library::in_memory()?;
    assert_eq!(lib.cached_waveform("a.flac", 5)?, None);
    lib.save_waveform("a.flac", 5, &[0, 120, 255])?;
    assert_eq!(lib.cached_waveform("a.flac", 5)?, Some(vec![0, 120, 255]));
    assert_eq!(lib.cached_waveform("a.flac", 6)?, None);
    lib.save_waveform("a.flac", 6, &[7])?;
    assert_eq!(lib.cached_waveform("a.flac", 6)?, Some(vec![7]));
    Ok(())
}

#[test]
fn sponsor_cache_keeps_the_empty_answer_too() -> Result<()> {
    let lib = Library::in_memory()?;
    assert_eq!(lib.cached_sponsor("aaaaaaaaaaa")?, None);
    lib.save_sponsor("aaaaaaaaaaa", "[]", 10)?;
    assert_eq!(lib.cached_sponsor("aaaaaaaaaaa")?, Some(("[]".into(), 10)));
    lib.save_sponsor("aaaaaaaaaaa", r#"[{"startS":0,"endS":12}]"#, 20)?;
    assert_eq!(lib.cached_sponsor("aaaaaaaaaaa")?.map(|c| c.1), Some(20));
    Ok(())
}

#[test]
fn loudness_cache_is_by_path_and_modified_time() -> Result<()> {
    let lib = Library::in_memory()?;
    assert_eq!(lib.cached_loudness("a.flac", 5)?, None);
    lib.save_loudness("a.flac", 5, Some(-9.25), 0.98)?;
    assert_eq!(lib.cached_loudness("a.flac", 5)?, Some((Some(-9.25), 0.98)));
    // Changed file: measured again. Silent throughout: kept as such, not measured every time.
    assert_eq!(lib.cached_loudness("a.flac", 6)?, None);
    lib.save_loudness("a.flac", 6, None, 0.0)?;
    assert_eq!(lib.cached_loudness("a.flac", 6)?, Some((None, 0.0)));
    Ok(())
}

#[test]
fn old_sponsor_answers_and_silence_rows_are_dropped() -> Result<()> {
    let lib = Library::in_memory()?;
    let day = 86_400;
    lib.save_sponsor("old", "[]", 1_000_000)?;
    lib.save_sponsor("recent", "[]", 1_000_000 + 20 * day)?;
    lib.save_sponsor("new", "[]", 1_000_000 + 40 * day)?;
    assert_eq!(lib.cached_sponsor("old")?, None);
    assert!(lib.cached_sponsor("recent")?.is_some() && lib.cached_sponsor("new")?.is_some());
    for i in 0..(SILENCE_KEEP + 5) {
        lib.save_silence(&format!("{i}.mp3"), 1, 0, None, 1)?;
    }
    assert_eq!(lib.cached_silence("0.mp3", 1)?, None);
    assert!(lib.cached_silence(&format!("{}.mp3", SILENCE_KEEP + 4), 1)?.is_some());
    Ok(())
}

#[test]
fn v3_backfills_youtube_frames_then_real_covers_win() -> Result<()> {
    // v2 database: no art column yet.
    let db = Connection::open_in_memory()?;
    db.execute_batch(SCHEMA)?;
    db.execute_batch("ALTER TABLE playlists ADD COLUMN custom INTEGER NOT NULL DEFAULT 0;")?;
    db.execute_batch(crate::history::SCHEMA_V2)?;
    let yt = youtube();
    db.execute("INSERT INTO tracks (id, title, artist, duration_ms, match_key) VALUES (1, ?1, ?2, ?3, ?4)", params![yt.title, yt.artist, yt.duration_ms, match_key(&yt.title, &yt.artist)])?;
    db.execute_batch("INSERT INTO track_ids VALUES ('youtube', '5NV6Rdv1a3I', 1);")?;
    let lib = Library::init(db)?;
    let art = || -> Result<Option<String>> { Ok(lib.tracks()?[0].track.art.clone()) };
    assert_eq!(art()?, Some(crate::model::youtube_art("5NV6Rdv1a3I")));
    lib.upsert_track(&spotify())?;
    assert_eq!(art()?, spotify().art, "real cover replaces video frame");
    lib.upsert_track(&Track { art: Some(crate::model::youtube_art("other")), ..youtube() })?;
    assert_eq!(art()?, spotify().art, "frame never replaces a cover");
    Ok(())
}

#[test]
fn rolls_back_on_error() -> Result<()> {
    let lib = Library::in_memory()?;
    lib.db.execute_batch("CREATE TRIGGER boom BEFORE INSERT ON tracks WHEN NEW.title = 'boom' BEGIN SELECT RAISE(ABORT, 'boom'); END;")?;
    let bad = Track { title: "boom".into(), ..youtube() };
    assert!(lib.save_playlist(Source::Spotify, "p1", "X", &[spotify(), bad]).is_err());
    assert!(lib.playlists()?.is_empty());
    assert!(lib.tracks()?.is_empty());
    Ok(())
}

#[test]
fn writes_bump_the_right_version() -> Result<()> {
    let lib = Library::in_memory()?;
    let (l, h) = (lib.versions.library(), lib.versions.history());
    let id = lib.edit_playlist(PlaylistEdit::Create { name: "Mine".into() })?.unwrap();
    assert!(lib.versions.library() > l);
    assert_eq!(lib.versions.history(), h);
    lib.set_setting("x", &serde_json::json!(1))?;
    let l = lib.versions.library();
    lib.edit_playlist(PlaylistEdit::Rename { id, name: "Ours".into() })?;
    assert!(lib.versions.library() > l);
    lib.clear_history()?;
    assert!(lib.versions.history() > h);
    Ok(())
}

/// `run` on a library the UI read whole: its copy patched with `take_changes` (as libraryPatch.ts does) equals a
/// whole read again. Returns the changes and what `run` returned.
fn patched_equals_whole<T>(lib: &Library, run: impl FnOnce() -> Result<T>) -> Result<(Changes, T)> {
    let (mut tracks, mut lists, mut orders) = (lib.tracks()?, lib.playlists()?, lib.playlist_orders()?);
    lib.forget_changes()?;
    let ran = run()?;
    let c = lib.take_changes(1000)?.expect("a small change");
    // SQLite's NOCASE: ASCII folded, then bytes.
    let nocase = |a: &str, b: &str| a.bytes().map(|x| x.to_ascii_lowercase()).cmp(b.bytes().map(|x| x.to_ascii_lowercase()));
    tracks.retain(|t| !c.gone.contains(&t.id) && c.tracks.iter().all(|n| n.id != t.id));
    tracks.extend(c.tracks.iter().cloned());
    tracks.sort_by(|a, b| nocase(&a.track.artist, &b.track.artist).then(nocase(&a.track.title, &b.track.title)).then(a.id.cmp(&b.id)));
    assert_eq!(tracks, lib.tracks()?);
    lists.retain(|p| !c.playlists_gone.contains(&p.id) && c.playlists.iter().all(|n| n.id != p.id));
    lists.extend(c.playlists.iter().cloned());
    lists.sort_by(|a, b| nocase(&a.name, &b.name).then(a.id.cmp(&b.id)));
    assert_eq!(lists, lib.playlists()?);
    // Whole reads leave empty playlists out.
    orders.retain(|id, _| !c.playlists_gone.contains(id) && !c.orders.contains_key(id));
    orders.extend(c.orders.iter().filter(|(_, o)| !o.is_empty()).map(|(id, o)| (*id, o.clone())));
    assert_eq!(orders, lib.playlist_orders()?);
    Ok((c, ran))
}

#[test]
fn changes_follow_likes_adds_edits_and_removals() -> Result<()> {
    let lib = Library::in_memory()?;
    let (a, b) = (lib.upsert_track(&song(1))?, lib.upsert_track(&song(2))?);
    let liked = lib.edit_playlist(PlaylistEdit::Create { name: "Liked Music".into() })?.unwrap();
    // A like: one playlist and its order, no song row.
    let (c, _) = patched_equals_whole(&lib, || lib.edit_playlist(PlaylistEdit::Add { id: liked, track_ids: vec![a] }))?;
    assert_eq!((c.tracks.len(), c.playlists.len(), &c.orders[&liked]), (0, 1, &vec![a]));
    // Added from a search: its row only (its channel has nothing else).
    let (c, new_id) = patched_equals_whole(&lib, || lib.upsert_track(&song(3)))?;
    assert_eq!(c.tracks.iter().map(|t| t.id).collect::<Vec<_>>(), [new_id]);
    // Seen again, nothing new: nothing logged. A play: only the play counts to read again.
    lib.upsert_track(&song(3))?;
    assert_eq!(lib.take_changes(1000)?, Some(Changes::default()));
    lib.record_play(&crate::history::Play { track_id: a, started_at: 1, listened_ms: 1000, completed: false })?;
    assert_eq!(lib.take_changes(1000)?, Some(Changes { history: true, ..Default::default() }));
    // Another source for a song, a rename, an unlike, a playlist gone.
    patched_equals_whole(&lib, || lib.upsert_track(&Track { ids: BTreeMap::from([(Source::Spotify, "s2".into())]), ..song(2) }))?;
    patched_equals_whole(&lib, || lib.edit_playlist(PlaylistEdit::Rename { id: liked, name: "aaa".into() }))?;
    patched_equals_whole(&lib, || lib.edit_playlist(PlaylistEdit::RemoveTrack { id: liked, track_id: a }))?;
    let (c, _) = patched_equals_whole(&lib, || lib.edit_playlist(PlaylistEdit::Delete { id: liked }))?;
    assert_eq!(c.playlists_gone, [liked]);
    // Out of the library, from a playlist too; merged into another.
    let mine = lib.edit_playlist(PlaylistEdit::Create { name: "Mine".into() })?.unwrap();
    lib.edit_playlist(PlaylistEdit::Add { id: mine, track_ids: vec![a, b, new_id] })?;
    let (c, _) = patched_equals_whole(&lib, || lib.remove_track(a))?;
    assert_eq!((c.gone, &c.orders[&mine]), (vec![a], &vec![b, new_id]));
    let (c, _) = patched_equals_whole(&lib, || lib.merge_tracks(b, &[new_id]))?;
    assert_eq!((c.gone, &c.orders[&mine]), (vec![new_id], &vec![b, b]));
    Ok(())
}

#[test]
fn changes_carry_a_whole_channel_when_it_turns_to_talk() -> Result<()> {
    let lib = Library::in_memory()?;
    let video = |n: u32, title: &str| Track { title: title.into(), artist: "Roblox Learn".into(), duration_ms: Some(500_000), ids: BTreeMap::from([(Source::Youtube, format!("v{n}"))]), ..Default::default() };
    let doubt = lib.upsert_track(&video(1, "Big day"))?;
    lib.upsert_track(&video(2, "How To Make A Combat System In Roblox Studio"))?;
    assert_ne!(lib.music_words()?[&doubt], Musicness::NotMusic);
    // A second talk video: the channel is talk, its doubt too, though the doubt's row never changed.
    let (c, talk) = patched_equals_whole(&lib, || lib.upsert_track(&video(3, "How to style your UI on Roblox")))?;
    assert_eq!(c.tracks.iter().find(|t| t.id == doubt).unwrap().track.musicness, Some(Musicness::NotMusic));
    // And back once it leaves.
    patched_equals_whole(&lib, || lib.remove_track(talk))?;
    assert_ne!(lib.music_words()?[&doubt], Musicness::NotMusic);
    Ok(())
}

#[test]
fn too_many_changes_ask_for_a_whole_read() -> Result<()> {
    let lib = Library::in_memory()?;
    for n in 0..5 {
        lib.upsert_track(&song(n))?;
    }
    // Kept until the whole read is done.
    assert_eq!(lib.take_changes(4)?, None);
    assert_eq!(lib.take_changes(4)?, None);
    lib.forget_changes()?;
    assert_eq!(lib.take_changes(4)?, Some(Changes::default()));
    Ok(())
}

#[test]
fn every_foreign_key_leads_an_index() -> Result<()> {
    // Deleting a song checks each table pointing at it: without an index there, one whole scan per deleted row.
    let lib = Library::in_memory()?;
    let col = |sql: &str| -> Result<Vec<String>> { Ok(lib.db.prepare(sql)?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?) };
    for table in col("SELECT name FROM sqlite_schema WHERE type = 'table'")? {
        let mut led: BTreeSet<String> = col(&format!("SELECT ii.name FROM pragma_index_list('{table}') il, pragma_index_info(il.name) ii WHERE ii.seqno = 0"))?.into_iter().collect();
        // INTEGER PRIMARY KEY = the row id itself.
        led.extend(col(&format!("SELECT name FROM pragma_table_info('{table}') WHERE pk = 1 AND upper(type) = 'INTEGER' AND (SELECT count(*) FROM pragma_table_info('{table}') WHERE pk > 0) = 1"))?);
        for from in col(&format!("SELECT \"from\" FROM pragma_foreign_key_list('{table}')"))? {
            assert!(led.contains(&from), "{table}.{from} has no index");
        }
    }
    Ok(())
}

const SONGS: i64 = 50_000;

/// Song `i` of the big library: 2 000 local files, then YouTube videos.
fn scale_song(i: i64) -> Track {
    let ids = if i <= 2_000 { BTreeMap::from([(Source::Local, format!("C:/Music/{i}.flac"))]) } else { BTreeMap::from([(Source::Youtube, format!("yt{i}"))]) };
    Track { title: format!("Song {i}"), artist: format!("Artist {}", i % 4_000), album: Some(format!("Album {}", i % 6_000)), duration_ms: Some(180_000 + (i * 7_919 % 120_000) as u32), ids, ..Default::default() }
}

/// Playlist `p`'s song at `k` (200 playlists of 250, spread over the library).
fn scale_row(p: i64, k: i64) -> i64 {
    (p * 7_919 + k * 104_729) % SONGS + 1
}

/// 50 000 songs, 200 playlists of 250, 50 000 plays: written straight, quicker than imports.
fn big_library(now: i64) -> Result<Library> {
    let lib = Library::in_memory()?;
    let tx = lib.db.unchecked_transaction()?;
    {
        let mut song = tx.prepare("INSERT INTO tracks (id, title, artist, album, duration_ms, match_key, added, added_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?1, ?7)")?;
        let mut link = tx.prepare("INSERT INTO track_ids (source, source_id, track_id) VALUES (?1, ?2, ?3)")?;
        for i in 1..=SONGS {
            let t = scale_song(i);
            song.execute(params![i, t.title, t.artist, t.album, t.duration_ms, match_key(&t.title, &t.artist), now])?;
            for (s, sid) in &t.ids {
                link.execute(params![s.as_str(), sid, i])?;
            }
        }
        let mut list = tx.prepare("INSERT INTO playlists (id, source, source_id, name) VALUES (?1, 'youtube', ?2, ?3)")?;
        let mut row = tx.prepare("INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?1, ?2, ?3)")?;
        for p in 1..=200 {
            list.execute(params![p, format!("PL{p}"), format!("Mix {p}")])?;
            for k in 0..250 {
                row.execute(params![p, k, scale_row(p, k)])?;
            }
        }
        let mut play = tx.prepare("INSERT INTO plays (track_id, started_at, listened_ms, completed) VALUES (?1, ?2, 200000, 1)")?;
        for k in 0..SONGS {
            play.execute(params![k * 31 % SONGS + 1, now - (SONGS - k) * 600])?;
        }
    }
    tx.commit()?;
    lib.forget_changes()?;
    Ok(lib)
}

/// Statements run while traced: their start counts by SQL text, then (SQL, whole-table steps, time).
type Run = (HashMap<String, i32>, Vec<(String, i32, std::time::Duration)>);
thread_local! {
    static RUN: std::cell::RefCell<Run> = Default::default();
}

fn traced(e: rusqlite::trace::TraceEvent<'_>) {
    use rusqlite::{StatementStatus::FullscanStep, trace::TraceEvent};
    RUN.with_borrow_mut(|(start, done)| match e {
        // Trigger subprograms report too ("-- TRIGGER …"): only the statement's own start counts.
        TraceEvent::Stmt(s, text) if !text.starts_with("--") => {
            start.insert(s.sql().into_owned(), s.get_status(FullscanStep));
        }
        // A cached statement's counts add up over its life: this run's share only.
        TraceEvent::Profile(s, took) => {
            let sql = s.sql().into_owned();
            let steps = s.get_status(FullscanStep) - start.remove(&sql).unwrap_or(0);
            done.push((sql, steps, took));
        }
        _ => {}
    });
}

/// Library at scale: what runs for one song never reads a big table whole, and a whole read goes over it once,
/// not once per row. `cargo test -p music-core at_50k -- --nocapture` prints the times.
#[test]
fn per_song_statements_skip_whole_scans_at_50k_songs() -> Result<()> {
    use crate::history::Play;
    use rusqlite::trace::TraceEventCodes;
    let now = 1_800_000_000;
    let mut lib = big_library(now)?;
    let mut took = Vec::new();
    macro_rules! op {
        ($name:literal, $e:expr) => {{
            let at = std::time::Instant::now();
            let r = $e;
            took.push(($name, at.elapsed()));
            r
        }};
    }
    lib.db.trace_v2(TraceEventCodes::SQLITE_TRACE_STMT | TraceEventCodes::SQLITE_TRACE_PROFILE, Some(traced))?;
    // Start: the whole library, playlists, history.
    op!("tracks", lib.tracks()?);
    op!("playlists", lib.playlists()?);
    op!("playlist orders", lib.playlist_orders()?);
    op!("play stats", lib.play_stats()?);
    op!("plays, last 30 days", lib.plays_since(now - 30 * 86_400)?);
    op!("liked", lib.liked_tracks()?);
    op!("prefs", lib.prefs()?);
    op!("music words", lib.music_words()?);
    op!("songs not found", lib.not_found()?);
    op!("local files", lib.local_files()?);
    // One song at a time: import, play, rate, edit.
    op!("find", lib.find(&scale_song(20_000))?);
    op!("upsert, known", lib.upsert_track(&scale_song(20_001))?);
    let fresh = Track { title: "Brand New".into(), artist: "Someone".into(), ids: BTreeMap::from([(Source::Youtube, "ytnew".into())]), ..Default::default() };
    let fresh = op!("upsert, new", lib.upsert_track(&fresh)?);
    op!("record a play", lib.record_play(&Play { track_id: 20_000, started_at: now, listened_ms: 200_000, completed: true })?);
    op!("rate", lib.set_rating(20_000, 8)?);
    op!("bookmark", lib.add_bookmark(20_000, 60_000, "", now)?);
    op!("bookmarks", lib.bookmarks(20_000)?);
    op!("one playlist", lib.playlist_tracks(7)?);
    let mine = op!("new playlist", lib.edit_playlist(PlaylistEdit::Create { name: "Mine".into() })?).expect("new id");
    op!("add 500", lib.edit_playlist(PlaylistEdit::Add { id: mine, track_ids: (1..=500).map(|i| i * 97).collect() })?);
    op!("move", lib.edit_playlist(PlaylistEdit::Move { id: mine, from: 0, to: 400 })?);
    op!("remove one", lib.edit_playlist(PlaylistEdit::Remove { id: mine, position: 10 })?);
    op!("remove a song from", lib.edit_playlist(PlaylistEdit::RemoveTrack { id: mine, track_id: 970 })?);
    op!("like", lib.add_likes(&[scale_song(30_000)])?);
    // Songs leaving: removed, merged, local files gone, a playlist synced again.
    op!("remove a song", lib.remove_track(scale_row(7, 0))?);
    op!("merge", lib.merge_tracks(25_000, &[25_001, fresh])?);
    op!("rescan local files", lib.replace_local(&(51..=2_000).map(scale_song).map(LocalSong::from).collect::<Vec<_>>())?);
    let mut eight: Vec<Track> = (1..250).map(|k| scale_song(scale_row(8, k))).collect();
    eight.push(scale_song(40_000));
    op!("sync a playlist", lib.save_playlist(Source::Youtube, "PL8", "Mix 8", &eight)?);
    op!("songs without a source", lib.sourceless()?);
    op!("changes", lib.take_changes(10_000)?);
    op!("delete a playlist", lib.edit_playlist(PlaylistEdit::Delete { id: mine })?);
    lib.db.trace_v2(TraceEventCodes::empty(), None::<fn(rusqlite::trace::TraceEvent<'_>)>)?;

    let done = RUN.with_borrow_mut(|(_, done)| std::mem::take(done));
    for (name, t) in &took {
        eprintln!("{name:>24}: {:>7.1} ms", t.as_secs_f64() * 1e3);
    }
    // A statement with bound values (one song, one playlist) may read a small table whole, never a big one.
    let mut over = BTreeMap::new();
    for (sql, steps, _) in &done {
        if *steps > if sql.contains('?') { 1_000 } else { 2 * SONGS as i32 } {
            let e = over.entry(sql.split_whitespace().collect::<Vec<_>>().join(" ")).or_insert(0);
            *e = (*e).max(*steps);
        }
    }
    assert!(over.is_empty(), "whole scans: {over:#?}");
    Ok(())
}

#[test]
fn the_caches_clear_alone_and_say_what_they_held() -> Result<()> {
    let lib = Library::in_memory()?;
    lib.upsert_track(&spotify())?;
    lib.save_lyrics("lexycat|jinx|197", Some(&"la la ".repeat(2000)), 1)?;
    lib.save_waveform("C:/music/a.mp3", 1, &[7; 3000])?;
    lib.save_sponsor("abc", "[]", 1)?;
    let held = lib.caches_bytes()?;
    assert!(held > 15_000, "{held}");
    assert_eq!(lib.clear_caches()?, held);
    assert_eq!(lib.caches_bytes()?, 0);
    assert!(lib.cached_lyrics("lexycat|jinx|197")?.is_none());
    assert!(lib.cached_sponsor("abc")?.is_none());
    lib.save_lyrics("pick|lexycat|jinx|197", Some("{}"), 1)?;
    lib.clear_caches()?;
    assert!(lib.cached_lyrics("pick|lexycat|jinx|197")?.is_some(), "a pick stays");
    assert_eq!(lib.tracks()?.len(), 1, "the library stays");
    Ok(())
}

#[test]
fn a_guessed_tempo_fills_a_gap_and_never_replaces_a_tag() -> Result<()> {
    let lib = Library::in_memory()?;
    let file = |n: u32, bpm: Option<u32>| LocalSong { track: Track { ids: [(Source::Local, format!("C:/Music/{n}.flac"))].into(), ..song(n) }, genre: None, year: None, bpm, key: bpm.map(|_| "Am".to_string()) };
    lib.replace_local(&[file(1, None), file(2, Some(128))])?;
    let todo = lib.untimed_local()?;
    assert_eq!(todo.len(), 1);
    assert!(todo[0].1.ends_with("1.flac"));
    lib.guess_tempo(todo[0].0, 97)?;
    assert_eq!(lib.untimed_local()?.len(), 1, "its key is still missing");
    lib.guess_key(todo[0].0, "F#m")?;
    assert!(lib.untimed_local()?.is_empty());
    let all = lib.tracks()?;
    assert!(all.iter().any(|t| t.bpm == Some(97)) && all.iter().any(|t| t.bpm == Some(128)));
    // A guess over a tag does nothing.
    let tagged = all.iter().find(|t| t.bpm == Some(128)).unwrap().id;
    lib.guess_tempo(tagged, 60)?;
    lib.guess_key(tagged, "C")?;
    assert!(lib.tracks()?.iter().any(|t| t.bpm == Some(128) && t.key.as_deref() == Some("Am")));
    assert!(lib.tracks()?.iter().any(|t| t.key.as_deref() == Some("F#m")));
    Ok(())
}
