use tauri::{WebviewUrl, WebviewWindowBuilder};

/// Resolve the URL the desktop window loads.
///
/// Priority:
///   1. debug-only `RIFT_DESKTOP_URL` env var (manual development override)
///   2. debug build  → local dev server (http://localhost:3010)
///   3. release build → cloud sign-in (https://riftsys.app/login)
fn resolve_app_url() -> String {
    #[cfg(debug_assertions)]
    {
        if let Ok(url) = std::env::var("RIFT_DESKTOP_URL") {
            if !url.trim().is_empty() {
                return url;
            }
        }
    }

    if cfg!(debug_assertions) {
        "http://localhost:3010".to_string()
    } else {
        "https://riftsys.app/login".to_string()
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let url_str = resolve_app_url();
      let mut url = tauri::Url::parse(&url_str).expect("invalid RIFT desktop URL");
      // Mark this as the lite wrapper via a query param. Unlike init scripts,
      // query params are reliable on remote URLs — the web app reads it on
      // first load, persists it to localStorage, and treats the session as a
      // normal web client (cloud sandbox) instead of expecting a native
      // desktop bridge this wrapper doesn't ship.
      url.query_pairs_mut().append_pair("rift_desktop", "lite");

      // Most reliable lite signal: a custom user-agent marker. Unlike init
      // scripts / query params, the UA is present on every request (client
      // AND server) and on every navigation, so the web app can detect the
      // lite wrapper deterministically. Realistic per-OS base + marker.
      let user_agent = if cfg!(target_os = "macos") {
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 RIFTWrapperLite/1.0"
      } else if cfg!(target_os = "windows") {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0 RIFTWrapperLite/1.0"
      } else {
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 RIFTWrapperLite/1.0"
      };

      let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("RIFT")
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .resizable(true)
        .decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        // MEASURED, then corrected against the measurement.
        // Captured each window on its own with `screencapture -l<windowid>` and
        // read the disc: with the inset at (13.25, 26.25) our lights centred on
        // (20.0, 24.0), while the reference window centres its own on 22.5. tao
        // moves the centre 1:1 with the inset -- it resizes the titlebar container
        // to `closeButtonHeight + y` and leaves the button's offset inside it
        // alone (tao/src/platform_impl/macos/view.rs, inset_traffic_lights) -- so
        // the correction is arithmetic: x += 2.5, y -= 1.5.

        // 22.5 is also the centre line of the 45px CSS strip, so the window
        // controls and everything the web app puts in that strip sit on one line.

        // Do not "fix" these from the reference app's own config. That app is
        // Electron, where trafficLightPosition means the button's top-left; tao
        // means a container inset. Reading 33/2 out of its bundle and using it
        // here is what put this 8pt out to begin with. Measure the pixels.
        .traffic_light_position(tauri::LogicalPosition::new(15.75, 24.75))
        .transparent(true)
        .user_agent(user_agent)
        .initialization_script("window.__RIFT_DESKTOP_LITE__ = true;")
        .build()?;

      // macOS "glass": frosted vibrancy behind the transparent webview, so the
      // desktop shows through wherever the web content is translucent (the
      // sidebar) — Codex-style. The web app tints the sidebar over this.
      #[cfg(target_os = "macos")]
      {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
        let _ = apply_vibrancy(
          &window,
          NSVisualEffectMaterial::Sidebar,
          Some(NSVisualEffectState::Active),
          None,
        );
      }
      let _ = &window;

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
