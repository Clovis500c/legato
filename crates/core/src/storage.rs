//! Settings › General › Storage: what the app keeps on disk, by kind. Sizes only here; each kind's owner clears its own
//! (covers `artcache`, the caches `Library::clear_caches`, the log `diag::Log::clear`). Never the library.
use std::fs;
use std::path::Path;

/// Bytes under `path`: a file, or a folder walked (links not followed). Missing: 0.
pub fn size(path: &Path) -> u64 {
    let Ok(meta) = fs::symlink_metadata(path) else { return 0 };
    if !meta.is_dir() {
        return meta.len();
    }
    fs::read_dir(path).map_or(0, |entries| entries.flatten().map(|e| size(&e.path())).sum())
}

/// The library and its copies beside it (before an update, each day), their journals too: `library*.db*`.
pub fn library(dir: &Path) -> u64 {
    let ours = |e: &fs::DirEntry| e.file_name().to_str().is_some_and(|n| n.starts_with("library") && n.contains(".db"));
    fs::read_dir(dir).map_or(0, |entries| entries.flatten().filter(ours).map(|e| size(&e.path())).sum())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_a_folder_and_the_library_with_its_copies_alone() {
        let dir = tempfile::tempdir().unwrap();
        let put = |name: &str, n: usize| fs::write(dir.path().join(name), vec![0u8; n]).unwrap();
        put("library.db", 10);
        put("library.db-wal", 5);
        put("library-before-v12.db", 4);
        put("library-daily.db", 3);
        put("diagnostics.log", 100);
        fs::create_dir(dir.path().join("art")).unwrap();
        put("art/a.jpg", 7);
        assert_eq!(library(dir.path()), 22);
        assert_eq!(size(dir.path()), 129);
        assert_eq!(size(&dir.path().join("art")), 7);
        assert_eq!(size(&dir.path().join("gone")), 0);
        assert_eq!(library(&dir.path().join("gone")), 0);
    }
}
