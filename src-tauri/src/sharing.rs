//! Sharing: share codes and links for a song or a playlist, the local network's send and receive, a shared item's preview and import.

use super::*;

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ShareCode {
    /// The website's page with the code in its fragment (`share::WEB_LINK`), for messages: any browser shows the
    /// playlist, Legato reads it pasted.
    link: String,
    /// QR modules: size, row-major "0"/"1". None = too big for a QR code.
    qr: Option<(usize, String)>,
    tracks: usize,
    bytes: usize,
}

/// The Discord sign-in's profile (Settings › Accounts), when there is one: it rides in the links this PC makes.
fn own_profile(lib: &Library) -> Option<share::Profile> {
    lib.setting(crate::discord_login::PROFILE).ok().flatten().and_then(|v| serde_json::from_value::<share::Profile>(v).ok()).filter(share::Profile::valid)
}

pub fn shared_playlist(lib: &Library, id: i64) -> CmdResult<Shared> {
    let name = lib.playlists().map_err(err)?.into_iter().find(|p| p.id == id).ok_or("Playlist not found")?.name;
    let items = lib.playlist_tracks(id).map_err(err)?.iter().map(|t| Item::from_track(&t.track)).collect();
    Ok(Shared { name, items, by: own_profile(lib) })
}

/// The playing song as a share for its card: link and QR modules (see `share_playlist`).
#[tauri::command]
pub async fn song_code(title: String, artist: String, youtube: Option<String>) -> CmdResult<ShareCode> {
    let shared = share::song(&title, &artist, youtube.as_deref());
    let qr = share::qr_modules(&share::to_qr_text(&shared)).map(|(size, dark)| (size, dark.iter().map(|&d| if d { '1' } else { '0' }).collect()));
    Ok(ShareCode { link: share::to_web_link(&shared), qr, tracks: 1, bytes: share::encode(&shared).len() })
}

#[tauri::command]
pub async fn share_playlist(state: State<'_, AppState>, id: i64) -> CmdResult<ShareCode> {
    let shared = shared_playlist(&state.lib(), id)?;
    let qr = share::qr_modules(&share::to_qr_text(&shared)).map(|(size, dark)| (size, dark.iter().map(|&d| if d { '1' } else { '0' }).collect()));
    Ok(ShareCode { link: share::to_web_link(&shared), qr, tracks: shared.items.len(), bytes: share::encode(&shared).len() })
}

#[derive(Clone, Serialize, ts_rs::TS)]
#[serde(tag = "state", rename_all = "camelCase")]
#[ts(export)]
pub enum NearbyState {
    Idle,
    Waiting { code: String },
    Sent,
    Failed { error: String },
}

/// Offer a playlist on the local network. Returns the 6-digit code to read out.
#[tauri::command]
pub async fn nearby_send(state: State<'_, AppState>, id: i64) -> CmdResult<String> {
    let payload = share::encode(&shared_playlist(&state.lib(), id)?);
    let code = music_connectors::nearby::new_code();
    nearby_stop(state.clone());
    *state.nearby.lock().unwrap() = NearbyState::Waiting { code: code.clone() };
    let (status, c) = (state.nearby.clone(), code.clone());
    let task = tauri::async_runtime::spawn(async move {
        let done = music_connectors::nearby::serve(&c, &payload).await;
        *status.lock().unwrap() = match done {
            Ok(()) => NearbyState::Sent,
            Err(e) => NearbyState::Failed { error: err(e) },
        };
    });
    *state.nearby_task.lock().unwrap() = Some(task);
    Ok(code)
}

#[tauri::command]
pub fn nearby_status(state: State<AppState>) -> NearbyState {
    state.nearby.lock().unwrap().clone()
}

/// Withdraws the offer (mDNS announce and listener dropped with the task).
#[tauri::command]
pub fn nearby_stop(state: State<AppState>) {
    if let Some(task) = state.nearby_task.lock().unwrap().take() {
        task.abort();
    }
    *state.nearby.lock().unwrap() = NearbyState::Idle;
}

/// 6-digit code → share link for the import dialog.
#[tauri::command]
pub async fn nearby_receive(code: String) -> CmdResult<String> {
    let code: String = code.chars().filter(|c| !c.is_whitespace()).collect();
    let bytes = music_connectors::nearby::receive(&code).await.map_err(err)?;
    Ok(share::to_link(&share::decode(&bytes).map_err(err)?))
}

/// Library probe for a shared entry: by id, or by title + artist.
pub fn probe(item: &Item) -> Track {
    match item {
        Item::Youtube { id, .. } => Track { ids: [(Source::Youtube, id.clone())].into(), ..Default::default() },
        Item::Apple(n) => Track { ids: [(Source::Apple, n.to_string())].into(), ..Default::default() },
        Item::Text { artist, title } => Track { artist: artist.clone(), title: title.clone(), ..Default::default() },
    }
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SharePreview {
    name: String,
    tracks: usize,
    /// Already in this library.
    known: usize,
    /// Of the others, videos named by the sender: they come in as they are, nothing to look up.
    ready: usize,
    /// The sender's Discord profile when the link carries one. NOT verified: anyone can write a link by hand.
    by: Option<share::Profile>,
}

#[tauri::command]
pub async fn share_preview(state: State<'_, AppState>, code: String) -> CmdResult<SharePreview> {
    let shared = share::parse(&code).map_err(err)?;
    let lib = state.lib();
    let rows = shared.items.iter().map(|i| lib.find(&probe(i))).collect::<anyhow::Result<Vec<_>>>().map_err(err)?;
    let ready = shared.items.iter().zip(&rows).filter(|(i, row)| row.is_none() && i.ready().is_some()).count();
    Ok(SharePreview { name: shared.name, tracks: shared.items.len(), known: rows.iter().flatten().count(), ready, by: shared.by })
}

/// QR code from a dropped screenshot or photo → share text.
#[tauri::command]
pub async fn share_read_image(path: String) -> CmdResult<String> {
    // Trust boundary: absolute PNG / JPEG path from drop event.
    let p = PathBuf::from(&path);
    let ok = p.is_absolute() && p.extension().and_then(|e| e.to_str()).is_some_and(|e| ["png", "jpg", "jpeg"].contains(&e.to_lowercase().as_str()));
    if !ok {
        return Err("PNG or JPEG image expected".into());
    }
    tauri::async_runtime::spawn_blocking(move || share::read_picture(&p)).await.map_err(err)?.map_err(err)
}

/// While nothing is searched, a song lands on the import screen every this long: 2.5 s in all at most.
pub fn landing(songs: usize) -> std::time::Duration {
    std::time::Duration::from_millis((2500 / songs.max(1) as u64).clamp(10, 120))
}

/// Shared playlist → new custom playlist, on the import screen (`spotify-import` events, as a Spotify list). Known songs
/// reused, videos named by the sender taken as they are (no request), Apple ids in one lookup, bare video ids (QR code,
/// older Legato) by oEmbed, artist + title searched on YouTube at its pace like any import. `import_link_stop` ends it
/// with "canceled", nothing made.
#[tauri::command]
pub async fn share_import(app: tauri::AppHandle, state: State<'_, AppState>, code: String, country: String) -> CmdResult<SpotifyLibraryImport> {
    use music_connectors::{itunes, youtube};
    let shared = share::parse(&code).map_err(err)?;
    let _running = links::begin()?;
    let country = store(&country);
    let name: String = if shared.name.trim().is_empty() { "Shared playlist".into() } else { shared.name.trim().chars().take(100).collect() };
    let total = shared.items.len();
    let say = |done: usize, playable: usize, (searched, to_search): (usize, usize), wait_secs: u32, song: Option<&Track>| {
        let p = SpotifyProgress { name: name.clone(), list: 1, lists: 1, matching: to_search > 0, done, total, all_done: done, all_total: total, playable, searched, to_search, wait_secs, song: song.map(SpotifySong::from) };
        let _ = app.emit_to("main", "spotify-import", p);
    };
    say(0, 0, (0, 0), 0, None);
    let mut songs: Vec<Option<Track>> = {
        let lib = state.lib();
        let rows = shared.items.iter().map(|i| lib.find(&probe(i))).collect::<anyhow::Result<Vec<_>>>().map_err(err)?;
        let known: HashMap<i64, Track> = if rows.iter().any(Option::is_some) { lib.tracks().map_err(err)?.into_iter().map(|t| (t.id, t.track)).collect() } else { HashMap::new() };
        shared.items.iter().zip(rows).map(|(item, row)| row.and_then(|r| known.get(&r).cloned()).or_else(|| item.ready())).collect()
    };

    // Apple: one batched lookup.
    let apple: Vec<u64> = shared.items.iter().zip(&songs).filter_map(|(item, s)| if let (Item::Apple(n), None) = (item, s) { Some(*n) } else { None }).collect();
    let apple_found = if apple.is_empty() { Vec::new() } else { itunes::lookup(hosts::get().itunes_lookup, &apple, &country).await.unwrap_or_default() };
    // Bare video ids: keyless oEmbed per video, 8 at a time.
    let bare: Vec<(usize, String)> = shared.items.iter().zip(&songs).enumerate().filter_map(|(i, (item, s))| if let (Item::Youtube { id, .. }, None) = (item, s) { Some((i, id.clone())) } else { None }).collect();
    for chunk in bare.chunks(8) {
        if links::stopped() {
            return Err("canceled".into());
        }
        let jobs: Vec<_> = chunk.iter().cloned().map(|(i, v)| tauri::async_runtime::spawn(async move { (i, youtube::track_from_link(&format!("https://youtu.be/{v}"), youtube::OEMBED).await) })).collect();
        for job in jobs {
            if let Ok((i, Ok(t))) = job.await {
                songs[i] = Some(t);
            }
        }
    }
    for (item, s) in shared.items.iter().zip(songs.iter_mut()) {
        if let Item::Apple(n) = item
            && s.is_none()
        {
            *s = apple_found.iter().find(|t| t.ids.get(&Source::Apple) == Some(&n.to_string())).cloned();
        }
    }

    // Everything but the songs to search lands on the deck, one by one.
    let to_find: Vec<usize> = (0..total).filter(|&i| songs[i].is_none() && matches!(shared.items[i], Item::Text { .. })).collect();
    let pause = landing(total - to_find.len());
    let (mut done, mut playable) = (0, 0);
    for (i, song) in songs.iter().enumerate() {
        if to_find.contains(&i) {
            continue;
        }
        if links::stopped() {
            return Err("canceled".into());
        }
        done += 1;
        playable += usize::from(song.is_some());
        say(done, playable, (0, 0), 0, song.as_ref());
        if song.is_some() {
            tokio::time::sleep(pause).await;
        }
    }

    // Artist + title: YouTube at its pace; what the library knows and songs not found lately aren't searched.
    let mut unsearched = 0;
    if !to_find.is_empty() {
        let wanted: Vec<Track> = to_find.iter().map(|&i| probe(&shared.items[i])).collect();
        let step = |s: links::Searched| say(done + s.done, playable + s.found, (s.done, wanted.len()), s.wait_secs, s.song);
        let found = links::find_on_youtube(&app, &wanted, step).await?.ok_or("canceled")?;
        for (&i, t) in to_find.iter().zip(found.tracks) {
            songs[i] = links::has_version(&t).then_some(t);
        }
        unsearched = found.unsearched;
    }

    let found: Vec<Track> = songs.into_iter().flatten().collect();
    let playlist_id = if found.is_empty() {
        None
    } else {
        let lib = state.lib();
        let id = lib.edit_playlist(PlaylistEdit::Create { name: name.clone() }).map_err(err)?.ok_or("Playlist not created")?;
        let mut ids = Vec::with_capacity(found.len());
        for t in &found {
            // Asked for by hand: a song removed earlier comes back.
            lib.unremove(t).map_err(err)?;
            ids.push(lib.upsert_track(t).map_err(err)?);
        }
        lib.edit_playlist(PlaylistEdit::Add { id, track_ids: ids }).map_err(err)?;
        Some(id)
    };
    Ok(SpotifyLibraryImport { playlist_id, lists: 0, songs: total, playable: found.len(), failed: Vec::new(), unsearched })
}

/// A shared code with ONE song, ready to play: the library's own row when it has it, else the song as the sender has it, an Apple
/// id looked up, a bare video named by oEmbed, a title searched on YouTube (one search). Nothing is written to the library.
#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SharedSong {
    track: Track,
    /// Library row, when the song is already there.
    library_id: Option<i64>,
}

#[tauri::command]
pub async fn share_song(state: State<'_, AppState>, code: String, country: String) -> CmdResult<SharedSong> {
    use music_connectors::{itunes, youtube};
    let shared = share::parse(&code).map_err(err)?;
    let [item] = shared.items.as_slice() else { return Err("A shared song has exactly one song".into()) };
    let known = {
        let lib = state.lib();
        lib.find(&probe(item)).map_err(err)?.map(|id| lib.tracks().map(|all| all.into_iter().find(|t| t.id == id)))
    };
    if let Some(row) = known.transpose().map_err(err)?.flatten() {
        return Ok(SharedSong { track: row.track, library_id: Some(row.id) });
    }
    let track = match item {
        Item::Youtube { id, .. } => match item.ready() {
            Some(t) => t,
            None => youtube::track_from_link(&format!("https://youtu.be/{id}"), youtube::OEMBED).await.map_err(err)?,
        },
        Item::Apple(n) => itunes::lookup(hosts::get().itunes_lookup, &[*n], &store(&country)).await.map_err(err)?.into_iter().next().ok_or("This song was not found on Apple Music")?,
        Item::Text { .. } => playable_hit(&state, probe(item)).await?,
    };
    Ok(SharedSong { track, library_id: None })
}
