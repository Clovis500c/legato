//! The main window's WebView2 processes: one that dies is logged (a page that stops drawing left no line before, Nov
//! 2026 report: the window went blank, nothing in the log), and a page whose renderer died is loaded again instead of
//! staying empty under the user.

#[cfg_attr(not(windows), allow(dead_code))]
/// What a failed WebView2 process means here: the log's words, and whether the page is loaded again.
/// Kinds: `COREWEBVIEW2_PROCESS_FAILED_KIND` (0 browser, 1 renderer, 2 renderer unresponsive, 3 a frame's renderer,
/// 4 utility, 5 sandbox helper, 6 GPU, 7-8 plugin, 9 unknown).
pub fn after(kind: i32) -> (&'static str, bool) {
    match kind {
        0 => ("the WebView2 browser process exited", false),
        1 => ("the page's renderer exited, loading the page again", true),
        2 => ("the page stopped answering", false),
        3 => ("a frame's renderer exited", false),
        6 => ("the WebView2 GPU process exited", false),
        _ => ("a WebView2 helper process exited", false),
    }
}

#[cfg(windows)]
pub fn install(webview: &tauri::Webview) -> tauri::Result<()> {
    webview.with_webview(|wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PROCESS_FAILED_KIND;
        use webview2_com::ProcessFailedEventHandler;
        let Ok(core) = wv.controller().CoreWebView2() else { return };
        let handler = ProcessFailedEventHandler::create(Box::new(|sender, args| {
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
            if let Some(args) = args {
                args.ProcessFailedKind(&mut kind)?;
            }
            let (words, reload) = after(kind.0);
            crate::diag::warn("webview", words, "");
            if reload && let Some(core) = sender {
                core.Reload()?;
            }
            Ok(())
        }));
        let mut token = Default::default();
        let _ = core.add_ProcessFailed(&handler, &mut token);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_dead_renderer_reloads_the_page_and_every_kind_has_words() {
        assert_eq!(after(1), ("the page's renderer exited, loading the page again", true));
        for kind in [0, 2, 3, 4, 5, 6, 7, 8, 9, 42] {
            let (words, reload) = after(kind);
            assert!(!reload, "{kind}");
            assert!(!words.is_empty());
        }
    }
}
