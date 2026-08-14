fn main() {
    let dir = std::env::var("APPDATA").ok()
        .map(|a| std::path::PathBuf::from(a).join("com.archivistpro.desktop"));
    let cands = archivist_h2import::discover_candidates(dir.as_deref(), |p| {
        let uri = format!("file:{}?mode=ro", p.to_string_lossy().replace('\\', "/"));
        let c = rusqlite::Connection::open_with_flags(uri,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI).ok()?;
        c.query_row("SELECT count(*) FROM assets", [], |r| r.get::<_, i64>(0)).ok()
    });
    for c in &cands {
        println!("{:<6} {:<8} exists={} {:>9} B assets={:?} locked={} {}",
            c.kind, c.source, c.exists, c.size_bytes, c.asset_count, c.locked_hint, c.path);
    }
}
