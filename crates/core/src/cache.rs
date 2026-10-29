//! Smart caches, in memory and bounded:
//! - `Versions`: change counters per data set, bumped by SQLite's update hook, so no write path can forget to
//!   invalidate;
//! - `Memo`: a computed answer (JSON, ready to send) kept until its stamp changes (data version, day, hour…);
//! - `Lru`: hot values under a byte budget (images);
//! - `Ttl`: network answers kept for a while.

use std::collections::HashMap;
use std::hash::Hash;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Data set a table belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Data {
    /// Tracks, their ids, playlists.
    Library,
    /// Plays and mix preferences.
    History,
    /// Settings, session: no cached answer reads them.
    Other,
}

pub fn data_of(table: &str) -> Data {
    match table {
        "tracks" | "track_ids" | "playlists" | "playlist_tracks" => Data::Library,
        "plays" | "track_prefs" => Data::History,
        _ => Data::Other,
    }
}

/// Bumped on every row written. A cached answer stamped with an older number is stale.
#[derive(Debug, Default)]
pub struct Versions {
    library: AtomicU64,
    history: AtomicU64,
}

impl Versions {
    pub fn touch(&self, table: &str) {
        match data_of(table) {
            Data::Library => self.library.fetch_add(1, Ordering::Relaxed),
            Data::History => self.history.fetch_add(1, Ordering::Relaxed),
            Data::Other => 0,
        };
    }

    pub fn library(&self) -> u64 {
        self.library.load(Ordering::Relaxed)
    }

    pub fn history(&self) -> u64 {
        self.history.load(Ordering::Relaxed)
    }
}

/// Hits and misses, for Settings › About.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct Stats {
    pub hits: u64,
    pub misses: u64,
    pub entries: usize,
    pub bytes: usize,
}

struct MemoInner<K, S> {
    map: HashMap<K, (S, Arc<str>, u64)>,
    tick: u64,
    hits: u64,
    misses: u64,
}

/// Answers per key, kept until their stamp changes. Past `cap` keys, the least recently used goes.
pub struct Memo<K, S> {
    cap: usize,
    inner: Mutex<MemoInner<K, S>>,
}

impl<K: Eq + Hash + Clone, S: PartialEq> Memo<K, S> {
    pub fn new(cap: usize) -> Self {
        Self { cap: cap.max(1), inner: Mutex::new(MemoInner { map: HashMap::new(), tick: 0, hits: 0, misses: 0 }) }
    }

    /// Kept answer when the stamp still matches, else `compute` (lock released meanwhile: a slow answer never
    /// blocks other keys). Errors are not kept.
    pub fn get_or<E>(&self, key: K, stamp: S, compute: impl FnOnce() -> Result<String, E>) -> Result<Arc<str>, E> {
        {
            let mut m = self.inner.lock().unwrap();
            m.tick += 1;
            let tick = m.tick;
            let hit = match m.map.get_mut(&key) {
                Some(e) if e.0 == stamp => {
                    e.2 = tick;
                    Some(e.1.clone())
                }
                _ => None,
            };
            match hit {
                Some(answer) => {
                    m.hits += 1;
                    return Ok(answer);
                }
                None => m.misses += 1,
            }
        }
        let answer: Arc<str> = compute()?.into();
        let mut m = self.inner.lock().unwrap();
        m.tick += 1;
        let tick = m.tick;
        m.map.insert(key, (stamp, answer.clone(), tick));
        if m.map.len() > self.cap
            && let Some(old) = m.map.iter().min_by_key(|(_, e)| e.2).map(|(k, _)| k.clone())
        {
            m.map.remove(&old);
        }
        Ok(answer)
    }

    /// Kept answer when the stamp still matches, nothing computed (an answer that needs network first).
    pub fn peek(&self, key: &K, stamp: &S) -> Option<Arc<str>> {
        let mut m = self.inner.lock().unwrap();
        m.tick += 1;
        let tick = m.tick;
        let answer = {
            let e = m.map.get_mut(key).filter(|e| e.0 == *stamp)?;
            e.2 = tick;
            e.1.clone()
        };
        m.hits += 1;
        Some(answer)
    }

    pub fn clear(&self) {
        self.inner.lock().unwrap().map.clear();
    }

    pub fn stats(&self) -> Stats {
        let m = self.inner.lock().unwrap();
        Stats { hits: m.hits, misses: m.misses, entries: m.map.len(), bytes: m.map.values().map(|e| e.1.len()).sum() }
    }
}

struct LruInner<V> {
    map: HashMap<String, (Arc<V>, usize, u64)>,
    used: usize,
    tick: u64,
    hits: u64,
    misses: u64,
}

/// Hot values under a byte budget. Over budget: least recently used out, down to three quarters (amortized).
pub struct Lru<V> {
    budget: usize,
    inner: Mutex<LruInner<V>>,
}

impl<V> Lru<V> {
    pub fn new(budget: usize) -> Self {
        Self { budget, inner: Mutex::new(LruInner { map: HashMap::new(), used: 0, tick: 0, hits: 0, misses: 0 }) }
    }

    pub fn get(&self, key: &str) -> Option<Arc<V>> {
        let mut m = self.inner.lock().unwrap();
        m.tick += 1;
        let tick = m.tick;
        let found = m.map.get_mut(key).map(|e| {
            e.2 = tick;
            e.0.clone()
        });
        if found.is_some() { m.hits += 1 } else { m.misses += 1 }
        found
    }

    /// Values bigger than a quarter of the budget are not kept (one would push out many).
    pub fn put(&self, key: &str, value: Arc<V>, size: usize) {
        if size > self.budget / 4 {
            return;
        }
        let mut m = self.inner.lock().unwrap();
        m.tick += 1;
        let tick = m.tick;
        if let Some(old) = m.map.insert(key.to_string(), (value, size, tick)) {
            m.used -= old.1;
        }
        m.used += size;
        if m.used > self.budget {
            let mut by_age: Vec<(u64, String, usize)> = m.map.iter().map(|(k, e)| (e.2, k.clone(), e.1)).collect();
            by_age.sort_unstable();
            for (_, k, size) in by_age {
                if m.used <= self.budget * 3 / 4 {
                    break;
                }
                m.map.remove(&k);
                m.used -= size;
            }
        }
    }

    pub fn stats(&self) -> Stats {
        let m = self.inner.lock().unwrap();
        Stats { hits: m.hits, misses: m.misses, entries: m.map.len(), bytes: m.used }
    }
}

/// Answers kept `ttl` (network: searches, sign-in state). Past `cap`, expired ones go, then the oldest.
pub struct Ttl<V> {
    ttl: Duration,
    cap: usize,
    inner: Mutex<HashMap<String, (Instant, Arc<V>)>>,
}

impl<V> Ttl<V> {
    pub fn new(ttl: Duration, cap: usize) -> Self {
        Self { ttl, cap: cap.max(1), inner: Mutex::new(HashMap::new()) }
    }

    pub fn get(&self, key: &str) -> Option<Arc<V>> {
        let mut m = self.inner.lock().unwrap();
        match m.get(key) {
            Some((at, v)) if at.elapsed() < self.ttl => Some(v.clone()),
            Some(_) => {
                m.remove(key);
                None
            }
            None => None,
        }
    }

    pub fn put(&self, key: &str, value: V) -> Arc<V> {
        let value = Arc::new(value);
        let mut m = self.inner.lock().unwrap();
        if m.len() >= self.cap {
            m.retain(|_, (at, _)| at.elapsed() < self.ttl);
        }
        if m.len() >= self.cap
            && let Some(oldest) = m.iter().min_by_key(|(_, (at, _))| *at).map(|(k, _)| k.clone())
        {
            m.remove(&oldest);
        }
        m.insert(key.to_string(), (Instant::now(), value.clone()));
        value
    }

    pub fn clear(&self) {
        self.inner.lock().unwrap().clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_follow_their_tables() {
        let v = Versions::default();
        v.touch("tracks");
        v.touch("playlist_tracks");
        v.touch("plays");
        v.touch("settings");
        assert_eq!((v.library(), v.history()), (2, 1));
    }

    #[test]
    fn memo_recomputes_only_on_new_stamp() {
        let memo: Memo<&str, u64> = Memo::new(2);
        let mut runs = 0;
        let mut get = |stamp: u64| memo.get_or::<()>("lib", stamp, || {
            runs += 1;
            Ok(format!("v{stamp}"))
        });
        assert_eq!(&*get(1).unwrap(), "v1");
        assert_eq!(&*get(1).unwrap(), "v1");
        assert_eq!(&*get(2).unwrap(), "v2");
        assert_eq!(runs, 2);
        assert_eq!(memo.stats().hits, 1);
        // Errors are not kept.
        assert!(memo.get_or("x", 0, || Err::<String, _>("boom")).is_err());
        assert_eq!(&*memo.get_or::<()>("x", 0, || Ok("ok".into())).unwrap(), "ok");
        // Peek: kept answer for this stamp only.
        assert_eq!(memo.peek(&"lib", &2).as_deref(), Some("v2"));
        assert_eq!(memo.peek(&"lib", &3), None);
    }

    #[test]
    fn memo_drops_least_recently_used_key() {
        let memo: Memo<u8, ()> = Memo::new(2);
        let put = |k: u8| memo.get_or::<()>(k, (), || Ok(k.to_string())).unwrap();
        put(1);
        put(2);
        put(1);
        put(3);
        // 2 was the least recently used: recomputed, 1 still there.
        let mut again = vec![];
        for k in [1, 2] {
            memo.get_or::<()>(k, (), || {
                again.push(k);
                Ok(String::new())
            })
            .unwrap();
        }
        assert_eq!(again, [2]);
    }

    #[test]
    fn lru_keeps_the_budget_and_the_hot_ones() {
        let lru: Lru<Vec<u8>> = Lru::new(100);
        for k in 0..4 {
            lru.put(&k.to_string(), Arc::new(vec![k; 20]), 20);
        }
        lru.get("0");
        lru.put("4", Arc::new(vec![4; 20]), 20);
        lru.put("5", Arc::new(vec![5; 20]), 20);
        let s = lru.stats();
        assert!(s.bytes <= 100, "{s:?}");
        assert!(lru.get("0").is_some(), "touched one survives");
        assert!(lru.get("1").is_none(), "oldest untouched one goes");
        lru.put("big", Arc::new(vec![0; 30]), 30);
        assert!(lru.get("big").is_none(), "over a quarter of the budget: not kept");
    }

    #[test]
    fn ttl_expires_and_stays_bounded() {
        let t: Ttl<u8> = Ttl::new(Duration::from_secs(60), 2);
        t.put("a", 1);
        t.put("b", 2);
        t.put("c", 3);
        assert_eq!((t.get("a"), t.get("c").as_deref()), (None, Some(&3)));
        let gone: Ttl<u8> = Ttl::new(Duration::ZERO, 2);
        gone.put("a", 1);
        assert!(gone.get("a").is_none());
    }
}
