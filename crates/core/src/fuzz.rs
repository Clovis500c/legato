//! Dropped or opened files are untrusted (plan-v2 › Security, the drop first). Each parser that reads one is fed
//! thousands of damaged inputs, made by flipping, cutting, repeating and inserting bytes in good samples and by pure
//! noise: none may panic, and what comes back stays bounded by the input. A fixed seed: the same run every time, no
//! new dependency. A real fuzzer (cargo-fuzz) would go deeper; this keeps the regressions out.

use crate::{itunes_xml, lyrics, playfile, share, songlist, syncmode, themefile};
use std::collections::HashMap;
use std::path::Path;

/// xorshift64*: enough randomness for damage.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
}

/// `sample` damaged a few ways, or pure noise now and then.
fn damaged(rng: &mut Rng, sample: &[u8]) -> Vec<u8> {
    let mut b = sample.to_vec();
    match rng.below(6) {
        0 => b.truncate(rng.below(b.len() + 1)),
        1 => {
            for _ in 0..1 + rng.below(8) {
                if !b.is_empty() {
                    let i = rng.below(b.len());
                    b[i] ^= 1 << rng.below(8);
                }
            }
        }
        2 => {
            let at = rng.below(b.len() + 1);
            let extra: Vec<u8> = (0..rng.below(64)).map(|_| rng.next() as u8).collect();
            b.splice(at..at, extra);
        }
        3 => {
            let again = b.clone();
            for _ in 0..rng.below(6) {
                b.extend_from_slice(&again);
            }
        }
        4 => return (0..rng.below(2_000)).map(|_| rng.next() as u8).collect(),
        _ => {
            let (from, to) = (rng.below(b.len() + 1), rng.below(b.len() + 1));
            let part: Vec<u8> = b[from.min(to)..from.max(to)].to_vec();
            b.splice(0..0, part);
        }
    }
    b
}

/// Runs `f` over `rounds` damaged inputs of each sample (and the samples themselves).
fn hammer(samples: &[&[u8]], rounds: usize, mut f: impl FnMut(&[u8])) {
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    for s in samples {
        f(s);
        for _ in 0..rounds {
            f(&damaged(&mut rng, s));
        }
    }
}

fn text(b: &[u8]) -> String {
    String::from_utf8_lossy(b).into_owned()
}

#[test]
fn share_codes_and_links_never_panic_and_stay_bounded() {
    let shared = share::Shared {
        name: "Road trip".into(),
        items: vec![share::Item::Youtube { id: "dQw4w9WgXcQ".into(), artist: "A".into(), title: "T".into(), secs: 212 }, share::Item::Apple(1_440_000_000), share::Item::Text { artist: "B".into(), title: "U".into() }],
        by: Some(share::Profile { id: "80351110224678912".into(), name: "Nelly".into() }),
    };
    let bytes = share::encode(&shared);
    let (link, web, qr) = (share::to_link(&shared), share::to_web_link(&shared), share::to_qr_text(&shared));
    hammer(&[&bytes], 3_000, |b| {
        if let Ok(s) = share::decode(b) {
            assert!(s.items.len() <= 10_000);
        }
    });
    hammer(&[link.as_bytes(), web.as_bytes(), qr.as_bytes(), b"LG1:", b"legato://playlist/", b"https://clovis500c.github.io/legato/l/#"], 2_000, |b| {
        if let Ok(s) = share::parse(&text(b)) {
            assert!(s.items.len() <= 10_000);
        }
    });
}

#[test]
fn theme_files_never_panic_and_pictures_are_checked() {
    let theme = serde_json::json!({ "name": "Night", "colors": { "bg": "#000" } });
    let packed = themefile::pack(&theme, None).unwrap();
    hammer(&[packed.as_bytes(), br#"{"backgroundData":"AAAA"}"#, b"[]", b"null"], 3_000, |b| {
        if let Ok((_, Some(picture))) = themefile::unpack(&text(b)) {
            // Only bytes the picture check accepts come out.
            assert!(themefile::background_name(&picture).is_ok());
        }
    });
}

#[test]
fn playlist_files_never_panic_and_never_name_a_file_outside_the_library() {
    let m3u: &[u8] = b"#EXTM3U\n#PLAYLIST:Mine\n#EXTINF:215,Artist - Title\nC:\\Music\\a.mp3\n..\\..\\Windows\\win.ini\n\\\\server\\share\\x.flac\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n";
    let xspf: &[u8] = b"<?xml version=\"1.0\"?><playlist version=\"1\" xmlns=\"http://xspf.org/ns/0/\"><title>Mine</title><trackList><track><location>file:///C:/Music/a.mp3</location><title>T</title><creator>A</creator></track></trackList></playlist>";
    let own: HashMap<String, i64> = HashMap::from([(playfile::path_key(Path::new("C:\\Music\\a.mp3")), 7)]);
    hammer(&[m3u, xspf], 3_000, |b| {
        let t = text(b);
        let _ = playfile::title(&t);
        let _ = playfile::csv_with_links(&t);
        for e in playfile::read(&t).unwrap_or_default() {
            // A path in a file only ever finds a song the library already holds; nothing is opened, read or run.
            if let Some(playfile::Plan::Own(id)) = playfile::plan(&e, Some(Path::new("C:\\Playlists")), &own, |_| None) {
                assert_eq!(id, 7);
            }
        }
    });
}

#[test]
fn song_lists_and_library_exports_never_panic_and_stay_bounded() {
    let list: &[u8] = b"Daft Punk - One More Time\nKavinsky; Nightcall\n\"Air\",\"La femme d'argent\"\n";
    let plist: &[u8] = br#"<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Tracks</key><dict></dict><key>Playlists</key><array><dict><key>Name</key><string>Mine</string><key>Playlist ID</key><integer>1</integer></dict></array></dict></plist>"#;
    hammer(&[list], 3_000, |b| assert!(songlist::parse(&text(b)).len() <= songlist::MAX_SONGS));
    hammer(&[plist], 3_000, |b| {
        if let Some(lists) = itunes_xml::read(&text(b)) {
            assert!(lists.len() <= itunes_xml::MAX_LISTS);
        }
    });
}

#[test]
fn lyrics_files_beside_a_dropped_song_never_panic() {
    let lrc: &[u8] = b"[ar:Artist]\n[ti:Title]\n[00:01.50]First line\n[00:05.00]<00:05.00>Word <00:05.40>by word\n";
    hammer(&[lrc, b"{\"lines\":[{\"text\":\"a\",\"start\":0}]}"], 3_000, |b| {
        let t = text(b);
        let _ = lyrics::parse_lrc(&t);
        let _ = lyrics::parse_lyricsfile(&t);
        let _ = lyrics::from_file(&t);
    });
}

#[test]
fn sync_files_never_panic_and_a_plain_one_never_brings_secrets() {
    let mut plain = b"MASYNC".to_vec();
    plain.push(0);
    hammer(&[&plain], 3_000, |b| {
        if let Ok(s) = syncmode::decode(b, None) {
            assert!(s.secrets.is_none(), "secrets travel sealed only");
        }
        let _ = syncmode::unpack(b);
    });
}


/// Files of a dropped folder or window: tags, pictures and sound read from bytes that are none of that.
#[test]
fn hostile_audio_and_picture_files_never_panic() {
    let dir = tempfile::tempdir().unwrap();
    let mut rng = Rng(0xDEAD_BEEF_CAFE_F00D);
    // Headers that look like the real thing, then noise.
    let heads: [&[u8]; 6] = [b"ID3\x04\x00\x00\x00\x00\x00\x10", b"fLaC\x00\x00\x00\x22", b"\x00\x00\x00\x18ftypM4A ", b"OggS\x00\x02", b"RIFF\x24\x00\x00\x00WAVEfmt ", b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR"];
    for (n, ext) in ["mp3", "flac", "m4a", "ogg", "wav", "png", "jpg", "mp3", "flac", "m4a", "ogg", "wav"].iter().enumerate() {
        for round in 0..40 {
            let mut bytes = heads[n % heads.len()].to_vec();
            bytes.extend((0..rng.below(3_000)).map(|_| rng.next() as u8));
            let path = dir.path().join(format!("f{n}_{round}.{ext}"));
            std::fs::write(&path, &bytes).unwrap();
            // A title from the file name at least: the row exists, whatever the bytes say.
            assert!(!crate::local::read_song(&path).track.title.is_empty());
            if matches!(*ext, "png" | "jpg") {
                // An answer or an error, never a panic or a hang.
                let _ = share::read_qr(&path);
            }
        }
    }
}

#[test]
fn a_picture_unpacking_into_a_huge_image_is_refused() {
    // 40 000 x 40 000 grey pixels declared in a PNG header: refused by the limits, not decoded.
    let dir = tempfile::tempdir().unwrap();
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    png.extend(13u32.to_be_bytes());
    png.extend(b"IHDR");
    png.extend(40_000u32.to_be_bytes());
    png.extend(40_000u32.to_be_bytes());
    png.extend([8, 0, 0, 0, 0]);
    png.extend([0, 0, 0, 0]);
    let path = dir.path().join("bomb.png");
    std::fs::write(&path, png).unwrap();
    assert!(share::read_qr(&path).is_err());
}
