//! Another app's library file: iTunes' `iTunes Music Library.xml` (MusicBee writes the same one for other apps). A plist:
//! the songs by id, then the playlists naming their songs. Read as it goes, only what's needed kept: such a file runs to
//! tens of MB. The shell lets the user pick lists, then takes each song like a playlist file's (`playfile::plan`).

use crate::playfile::{Entry, clean, place, unescape};
use std::collections::HashMap;

/// Playlists kept, at most.
pub const MAX_LISTS: usize = 500;
/// Songs per playlist, at most.
pub const MAX_LIST_SONGS: usize = 10_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct List {
    /// "Playlist Persistent ID".
    pub id: String,
    pub name: String,
    pub songs: Vec<Entry>,
    /// A smart playlist: its songs as they were when the file was written.
    pub smart: bool,
}

#[derive(Clone, Copy)]
struct Tag<'a> {
    name: &'a str,
    close: bool,
    /// `<true/>`.
    empty: bool,
}

struct Reader<'a> {
    s: &'a str,
    at: usize,
}

impl<'a> Reader<'a> {
    /// The next tag, declarations and comments passed.
    fn tag(&mut self) -> Option<Tag<'a>> {
        loop {
            let start = self.at + self.s[self.at..].find('<')?;
            if self.s[start..].starts_with("<!--") {
                self.at = start + self.s[start..].find("-->")? + 3;
                continue;
            }
            let end = start + self.s[start..].find('>')?;
            self.at = end + 1;
            let inner = &self.s[start + 1..end];
            if inner.starts_with(['?', '!']) {
                continue;
            }
            let (close, inner) = inner.strip_prefix('/').map_or((false, inner), |r| (true, r));
            let (empty, inner) = inner.strip_suffix('/').map_or((false, inner), |r| (true, r));
            return Some(Tag { name: inner.split_whitespace().next().unwrap_or_default(), close, empty });
        }
    }

    /// The text of the element `t` just opened, the cursor past its end.
    fn text(&mut self, t: Tag) -> Option<&'a str> {
        if t.empty {
            return Some("");
        }
        let close = format!("</{}>", t.name);
        let end = self.at + self.s[self.at..].find(&close)?;
        let text = &self.s[self.at..end];
        self.at = end + close.len();
        Some(text)
    }

    /// Past the element `t` just opened, whatever it holds.
    fn skip(&mut self, t: Tag) -> Option<()> {
        if t.empty {
            return Some(());
        }
        if t.name != "dict" && t.name != "array" {
            return self.text(t).map(drop);
        }
        let mut depth = 1usize;
        while depth > 0 {
            let n = self.tag()?;
            if !n.empty && (n.name == "dict" || n.name == "array") {
                if n.close {
                    depth -= 1;
                } else {
                    depth += 1;
                }
            }
        }
        Some(())
    }

    /// The dict's next key, the cursor before its value. None: the dict ended.
    fn key(&mut self) -> Option<String> {
        let t = self.tag().filter(|t| !t.close && t.name == "key")?;
        self.text(t).map(unescape)
    }

    /// The value after a key: its opening tag.
    fn value(&mut self) -> Option<Tag<'a>> {
        self.tag().filter(|t| !t.close)
    }

    fn string(&mut self, t: Tag) -> Option<Option<String>> {
        self.text(t).map(|s| clean(&unescape(s)))
    }

    fn int(&mut self, t: Tag) -> Option<Option<i64>> {
        self.text(t).map(|s| s.trim().parse().ok())
    }
}

/// One song's dict: its id and entry. None inside: not a song (podcast, film) or nothing to go by.
fn track(r: &mut Reader) -> Option<Option<(i64, Entry)>> {
    let mut e = Entry { artist: String::new(), title: String::new(), secs: None, location: None };
    let (mut id, mut album_artist, mut other) = (None, None, false);
    while let Some(k) = r.key() {
        let v = r.value()?;
        match k.as_str() {
            "Track ID" => id = r.int(v)?,
            "Name" => e.title = r.string(v)?.unwrap_or_default(),
            "Artist" => e.artist = r.string(v)?.unwrap_or_default(),
            "Album Artist" => album_artist = r.string(v)?,
            "Total Time" => e.secs = r.int(v)?.filter(|ms| *ms >= 1000).and_then(|ms| u32::try_from((ms + 500) / 1000).ok()),
            "Location" => e.location = place(&unescape(r.text(v)?)),
            "Podcast" | "Movie" | "TV Show" | "iTunesU" => {
                other |= v.name == "true";
                r.skip(v)?;
            }
            _ => r.skip(v)?,
        }
    }
    if e.artist.is_empty() {
        e.artist = album_artist.unwrap_or_default();
    }
    Some(id.filter(|_| !other && (!e.title.is_empty() || e.location.is_some())).map(|id| (id, e)))
}

/// One playlist's dict. None inside: one not to offer (the whole library, its parts, a folder, hidden, empty).
fn list(r: &mut Reader, songs: &HashMap<i64, Entry>) -> Option<Option<List>> {
    let (mut id, mut name, mut smart, mut skip, mut items) = (None, None, false, false, Vec::new());
    while let Some(k) = r.key() {
        let v = r.value()?;
        match k.as_str() {
            "Name" => name = r.string(v)?,
            "Playlist Persistent ID" => id = r.string(v)?,
            "Master" | "Folder" => {
                skip |= v.name == "true";
                r.skip(v)?;
            }
            "Visible" => {
                skip |= v.name == "false";
                r.skip(v)?;
            }
            // Music, Films, Podcasts…: parts of the library.
            "Distinguished Kind" => {
                skip = true;
                r.skip(v)?;
            }
            "Smart Info" => {
                smart = true;
                r.skip(v)?;
            }
            "Playlist Items" if v.name == "array" && !v.empty => loop {
                let t = r.tag()?;
                if t.close {
                    break;
                }
                if t.name != "dict" || t.empty {
                    r.skip(t)?;
                    continue;
                }
                while let Some(k) = r.key() {
                    let v = r.value()?;
                    if k != "Track ID" {
                        r.skip(v)?;
                    } else if let Some(e) = r.int(v)?.and_then(|id| songs.get(&id))
                        && items.len() < MAX_LIST_SONGS
                    {
                        items.push(e.clone());
                    }
                }
            },
            _ => r.skip(v)?,
        }
    }
    Some(match (id, name) {
        (Some(id), Some(name)) if !skip && !items.is_empty() => Some(List { id, name, songs: items, smart }),
        _ => None,
    })
}

/// The playlists of an iTunes / MusicBee library file, in its order. None: no such file.
pub fn read(text: &str) -> Option<Vec<List>> {
    if !text.contains("<plist") || !text.contains("<key>Tracks</key>") {
        return None;
    }
    let mut r = Reader { s: text, at: 0 };
    while !matches!(r.tag()?, Tag { name: "dict", close: false, .. }) {}
    let (mut songs, mut lists) = (HashMap::new(), Vec::new());
    while let Some(k) = r.key() {
        let v = r.value()?;
        match (k.as_str(), v.name, v.empty) {
            ("Tracks", "dict", false) => {
                while r.key().is_some() {
                    let v = r.value()?;
                    if v.name != "dict" || v.empty {
                        r.skip(v)?;
                    } else if let Some((id, e)) = track(&mut r)? {
                        songs.insert(id, e);
                    }
                }
            }
            ("Playlists", "array", false) => loop {
                let t = r.tag()?;
                if t.close {
                    break;
                }
                if t.name != "dict" || t.empty {
                    r.skip(t)?;
                } else if let Some(l) = list(&mut r, &songs)?
                    && lists.len() < MAX_LISTS
                {
                    lists.push(l);
                }
            },
            _ => r.skip(v)?,
        }
    }
    Some(lists)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::playfile::file_path;
    use std::path::PathBuf;

    const FILE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Major Version</key><integer>1</integer>
	<key>Application Version</key><string>12.13.2.3</string>
	<key>Music Folder</key><string>file://localhost/C:/Users/me/Music/iTunes/iTunes%20Media/</string>
	<key>Tracks</key>
	<dict>
		<key>101</key>
		<dict>
			<key>Track ID</key><integer>101</integer>
			<key>Name</key><string>One More Time</string>
			<key>Artist</key><string>Daft Punk</string>
			<key>Album</key><string>Discovery</string>
			<key>Total Time</key><integer>320357</integer>
			<key>Compilation</key><true/>
			<key>Artwork Count</key><integer>1</integer>
			<key>Location</key><string>file://localhost/C:/Users/me/Music/iTunes/iTunes%20Media/Music/Daft%20Punk/Discovery/01%20One%20More%20Time.m4a</string>
		</dict>
		<key>102</key>
		<dict>
			<key>Track ID</key><integer>102</integer>
			<key>Name</key><string>Rock &#38; Roll</string>
			<key>Album Artist</key><string>Led Zeppelin</string>
			<key>Track Type</key><string>Remote</string>
			<key>Apple Music</key><true/>
		</dict>
		<key>103</key>
		<dict>
			<key>Track ID</key><integer>103</integer>
			<key>Name</key><string>Episode 1</string>
			<key>Podcast</key><true/>
			<key>Location</key><string>file://localhost/C:/Podcasts/e1.mp3</string>
		</dict>
	</dict>
	<key>Playlists</key>
	<array>
		<dict>
			<key>Name</key><string>Library</string>
			<key>Master</key><true/>
			<key>Playlist Persistent ID</key><string>AAAA</string>
			<key>Playlist Items</key><array><dict><key>Track ID</key><integer>101</integer></dict></array>
		</dict>
		<dict>
			<key>Name</key><string>Music</string>
			<key>Distinguished Kind</key><integer>4</integer>
			<key>Playlist Persistent ID</key><string>BBBB</string>
			<key>Playlist Items</key><array><dict><key>Track ID</key><integer>101</integer></dict></array>
		</dict>
		<dict>
			<key>Name</key><string>Old stuff</string>
			<key>Playlist Persistent ID</key><string>CCCC</string>
			<key>Folder</key><true/>
		</dict>
		<dict>
			<key>Name</key><string>Mine &amp; yours</string>
			<key>Description</key><string>A &lt;b&gt;list&lt;/b&gt;</string>
			<key>Playlist ID</key><integer>9</integer>
			<key>Playlist Persistent ID</key><string>DDDD</string>
			<key>Parent Persistent ID</key><string>CCCC</string>
			<key>All Items</key><true/>
			<key>Playlist Items</key>
			<array>
				<dict><key>Track ID</key><integer>102</integer></dict>
				<dict><key>Track ID</key><integer>103</integer></dict>
				<dict><key>Track ID</key><integer>999</integer></dict>
				<dict><key>Track ID</key><integer>101</integer></dict>
			</array>
		</dict>
		<!-- iTunes' own smart lists -->
		<dict>
			<key>Name</key><string>Top 25 Most Played</string>
			<key>Playlist Persistent ID</key><string>EEEE</string>
			<key>Smart Info</key><data>
			AQEAAwAAAAIAAAAZAAAAAAAAAAcAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
			</data>
			<key>Playlist Items</key><array><dict><key>Track ID</key><integer>101</integer></dict></array>
		</dict>
		<dict>
			<key>Name</key><string>Hidden</string>
			<key>Visible</key><false/>
			<key>Playlist Persistent ID</key><string>FFFF</string>
			<key>Playlist Items</key><array><dict><key>Track ID</key><integer>101</integer></dict></array>
		</dict>
		<dict>
			<key>Name</key><string>Empty</string>
			<key>Playlist Persistent ID</key><string>GGGG</string>
		</dict>
	</array>
</dict>
</plist>
"#;

    #[test]
    fn reads_the_playlists_worth_offering() {
        let lists = read(FILE).unwrap();
        assert_eq!(lists.iter().map(|l| (l.id.as_str(), l.name.as_str(), l.smart)).collect::<Vec<_>>(), [("DDDD", "Mine & yours", false), ("EEEE", "Top 25 Most Played", true)]);
        // Podcast and unknown ids out, the order kept.
        let songs = &lists[0].songs;
        assert_eq!(songs.len(), 2);
        assert_eq!((songs[0].artist.as_str(), songs[0].title.as_str(), songs[0].location.as_deref()), ("Led Zeppelin", "Rock & Roll", None));
        assert_eq!((songs[1].artist.as_str(), songs[1].title.as_str(), songs[1].secs), ("Daft Punk", "One More Time", Some(320)));
        let path = file_path(songs[1].location.as_deref().unwrap(), None);
        assert_eq!(path, Some(PathBuf::from("C:\\Users\\me\\Music\\iTunes\\iTunes Media\\Music\\Daft Punk\\Discovery\\01 One More Time.m4a")));
    }

    #[test]
    fn other_files_are_none() {
        assert_eq!(read("#EXTM3U\nC:\\a.mp3"), None);
        assert_eq!(read(r#"<?xml version="1.0"?><plist version="1.0"><dict><key>Name</key><string>x</string></dict></plist>"#), None);
        // Cut short: nothing half read.
        assert_eq!(read(&FILE[..FILE.find("<key>Playlists</key>").unwrap() + 40]), None);
    }
}
