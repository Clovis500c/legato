use std::{env, fs, path::Path};

// Third-party notices, bundled by tauri.conf.json › bundle.resources (docs/licenses.md). `pnpm notices` writes them.
// Missing: dev build gets a placeholder page, release build stops (no installer without notices).
const NOTICES: &str = "third-party-licenses.html";
const MARK: &str = r#"<meta name="placeholder">"#;

fn main() {
    let real = fs::read_to_string(NOTICES).is_ok_and(|s| !s.contains(MARK));
    if !real {
        if env::var("PROFILE").as_deref() == Ok("release") {
            panic!("src-tauri/{NOTICES} not generated: run `pnpm notices` first (needs cargo-about, docs/licenses.md)");
        }
        if !Path::new(NOTICES).exists() {
            let page = format!(
                "<!doctype html>\n<html lang=\"en\">\n<meta charset=\"utf-8\">\n{MARK}\n<title>Third-party licenses</title>\n\
                 <p>Development build: the third-party licenses aren't in it. Installers carry them; <code>pnpm notices</code> \
                 writes them (docs/licenses.md).</p>\n</html>\n"
            );
            fs::write(NOTICES, page).expect("write placeholder notices");
        }
    }
    tauri_build::build()
}
