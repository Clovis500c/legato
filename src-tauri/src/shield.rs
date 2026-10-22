//! WebView2 hook: every request from every frame (YouTube iframe included) goes through the shield. Also turns the
//! browser's own keys off in release builds.

use music_shield::Shield;
use std::sync::Arc;
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::{WebResourceRequestedEventHandler, take_pwstr};
use windows::core::{HSTRING, Interface, PWSTR};

/// Release builds: F5 / Ctrl+R (reload, cuts the music), Ctrl+F, Ctrl+P, Ctrl+S, F12… are a browser's, not an app's.
/// The page still gets the keys (shortcuts), and editing keys (copy, paste) keep working.
pub fn browser_keys_off(webview: &tauri::Webview) -> tauri::Result<()> {
    // Dev builds keep them (F5, F12).
    if cfg!(debug_assertions) {
        return Ok(());
    }
    webview.with_webview(|wv| unsafe {
        if let Ok(settings) = wv.controller().CoreWebView2().and_then(|c| c.Settings()).and_then(|s| s.cast::<ICoreWebView2Settings3>()) {
            let _ = settings.SetAreBrowserAcceleratorKeysEnabled(false);
        }
    })
}

pub fn install(webview: &tauri::Webview, shield: Arc<Shield>) -> tauri::Result<()> {
    webview.with_webview(move |wv| unsafe {
        let Ok(core) = wv.controller().CoreWebView2() else { return };
        let Ok(env) = core.cast::<ICoreWebView2_2>().and_then(|c| c.Environment()) else { return };
        let all = HSTRING::from("*");
        // _22 API also sees iframe requests; older runtimes: main frame only.
        let added = match core.cast::<ICoreWebView2_22>() {
            Ok(c) => c.AddWebResourceRequestedFilterWithRequestSourceKinds(&all, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL),
            Err(_) => core.AddWebResourceRequestedFilter(&all, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL),
        };
        if added.is_err() {
            return;
        }
        let handler = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let req = args.Request()?;
            let mut uri = PWSTR::null();
            req.Uri(&mut uri)?;
            let uri = take_pwstr(uri);
            let mut ctx = COREWEBVIEW2_WEB_RESOURCE_CONTEXT::default();
            args.ResourceContext(&mut ctx)?;
            let mut referer = PWSTR::null();
            let referer = req.Headers()?.GetHeader(&HSTRING::from("Referer"), &mut referer).map(|_| take_pwstr(referer)).unwrap_or_default();
            if shield.should_block(&uri, &referer, kind(ctx)) {
                args.SetResponse(&env.CreateWebResourceResponse(None, 403, &HSTRING::from("Blocked"), &HSTRING::new())?)?;
            }
            Ok(())
        }));
        let mut token = Default::default();
        let _ = core.add_WebResourceRequested(&handler, &mut token);
    })
}

/// WebView2 context → adblock request type.
fn kind(ctx: COREWEBVIEW2_WEB_RESOURCE_CONTEXT) -> &'static str {
    match ctx {
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT => "sub_frame",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT => "script",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE => "image",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET => "stylesheet",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT => "font",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA => "media",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST | COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH => "xmlhttprequest",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING => "ping",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_WEBSOCKET => "websocket",
        _ => "other",
    }
}
