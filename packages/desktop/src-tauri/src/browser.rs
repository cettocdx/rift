//! Visible, unprivileged web tabs. The native view owns navigation and page state;
//! the main RIFT webview owns chrome. Never expose local-access IPC to these views.
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex};
use tauri::Manager;

const MAX_BROWSER_TABS: usize = 8;

#[derive(Clone)]
struct BrowserTab {
    label: String,
    requested_url: String,
    ready: bool,
}

#[derive(Default)]
struct BrowserRegistry {
    tabs: HashMap<String, BrowserTab>,
}

impl BrowserRegistry {
    fn reserve(&mut self, tab_id: &str, url: &str) -> Result<BrowserTab, String> {
        if self.tabs.contains_key(tab_id) {
            return Err("Browser tab already exists.".into());
        }
        if self.tabs.len() >= MAX_BROWSER_TABS {
            return Err("Close a browser tab before opening another (maximum 8).".into());
        }
        // Internal generation prevents a late create/close from targeting a new
        // view that reused the same public tab ID after a component remounted.
        let tab = BrowserTab {
            label: format!("browser-{}-{}", tab_id, uuid::Uuid::new_v4()),
            requested_url: url.into(),
            ready: false,
        };
        self.tabs.insert(tab_id.into(), tab.clone());
        Ok(tab)
    }

    fn finish_creation(&mut self, tab_id: &str, label: &str) -> bool {
        match self.tabs.get_mut(tab_id) {
            Some(tab) if tab.label == label => {
                tab.ready = true;
                true
            }
            _ => false,
        }
    }

    fn remove_if_current(&mut self, tab_id: &str, label: &str) {
        if self.tabs.get(tab_id).is_some_and(|tab| tab.label == label) {
            self.tabs.remove(tab_id);
        }
    }

    fn take_tabs_for_document_load(
        &mut self,
        label: &str,
        event: tauri::webview::PageLoadEvent,
    ) -> Vec<BrowserTab> {
        if label != "main" || !matches!(event, tauri::webview::PageLoadEvent::Started) {
            return Vec::new();
        }
        self.tabs.drain().map(|(_, tab)| tab).collect()
    }
}

#[derive(Default)]
pub struct BrowserState(Mutex<BrowserRegistry>);

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct BrowserBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSnapshot {
    tab_id: String,
    url: String,
    title: String,
    loading: bool,
    can_go_back: bool,
    can_go_forward: bool,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BrowserAction {
    Back,
    Forward,
    Reload,
    Stop,
}

fn validate_caller_label(label: &str) -> Result<(), String> {
    if label == "main" {
        Ok(())
    } else {
        Err("Only the RIFT interface can manage browser tabs.".into())
    }
}

fn validate_tab_id(raw: &str) -> Result<String, String> {
    let id = uuid::Uuid::parse_str(raw).map_err(|_| "Invalid browser tab ID.")?;
    let canonical = id.to_string();
    if raw != canonical {
        return Err("Invalid browser tab ID.".into());
    }
    Ok(canonical)
}

fn validate_browser_url(raw: &str) -> Result<url::Url, String> {
    if raw.len() > 4096 || raw.chars().any(|ch| ch.is_control()) {
        return Err("Enter a valid HTTP or HTTPS address.".into());
    }
    let parsed = url::Url::parse(raw.trim()).map_err(|_| "Enter a valid HTTP or HTTPS address.")?;
    if parsed.as_str() == "about:blank" {
        return Ok(parsed);
    }
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(
            "Browser tabs support HTTP and HTTPS addresses without embedded credentials.".into(),
        );
    }
    Ok(parsed)
}

fn validated_bounds(
    bounds: BrowserBounds,
    width: f64,
    height: f64,
) -> Result<Option<BrowserBounds>, String> {
    if [
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        width,
        height,
    ]
    .iter()
    .any(|value| !value.is_finite() || *value < 0.0)
    {
        return Err("Invalid browser viewport.".into());
    }
    let clipped = BrowserBounds {
        width: bounds.width.min((width - bounds.x).max(0.0)),
        height: bounds.height.min((height - bounds.y).max(0.0)),
        ..bounds
    };
    Ok((clipped.width >= 1.0 && clipped.height >= 1.0).then_some(clipped))
}

fn registry(state: &BrowserState) -> Result<std::sync::MutexGuard<'_, BrowserRegistry>, String> {
    state
        .0
        .lock()
        .map_err(|_| "Browser state unavailable.".into())
}

fn get_tab(state: &BrowserState, tab_id: &str) -> Result<BrowserTab, String> {
    validate_tab_id(tab_id)?;
    registry(state)?
        .tabs
        .get(tab_id)
        .filter(|tab| tab.ready)
        .cloned()
        .ok_or_else(|| "Browser tab is not available.".into())
}

fn get_view(app: &tauri::AppHandle, tab: &BrowserTab) -> Result<tauri::Webview, String> {
    app.get_webview(&tab.label)
        .ok_or_else(|| "Browser tab is not available.".into())
}

/// A full main-document navigation can skip React's unmount cleanup. Invalidate
/// ownership before closing native views so an in-flight create cannot restore
/// a tab from the previous document. SPA routes do not generate page-load events.
pub fn on_page_load(webview: &tauri::Webview, payload: &tauri::webview::PageLoadPayload<'_>) {
    if webview.label() != "main"
        || !matches!(payload.event(), tauri::webview::PageLoadEvent::Started)
    {
        return;
    }
    let app = webview.app_handle();
    let Some(state) = app.try_state::<BrowserState>() else {
        return;
    };
    let tabs = {
        let Ok(mut registry) = registry(&state) else {
            return;
        };
        registry.take_tabs_for_document_load(webview.label(), payload.event())
    };
    // Never hold the registry lock while calling into the native event loop.
    for tab in tabs {
        if let Some(view) = app.get_webview(&tab.label) {
            let _ = view.hide();
            let _ = view.close();
        }
    }
}

#[derive(Clone, Copy)]
struct BrowserMenuState {
    focused: bool,
    visible: bool,
}

async fn reload_with_focus<Focus, FocusResult, Reload>(
    labels: &[String],
    mut menu_state: Focus,
    mut reload: Reload,
) -> Result<(), String>
where
    Focus: FnMut(String) -> FocusResult,
    FocusResult: std::future::Future<Output = Result<BrowserMenuState, String>>,
    Reload: FnMut(&str) -> Result<(), String>,
{
    let mut visible_browser = None;
    for label in labels {
        // A closed view or failed focus query is indeterminate, not permission
        // to reload the application and destroy every browser page session.
        let state = menu_state(label.clone()).await?;
        if state.focused {
            return reload(label);
        }
        if state.visible && visible_browser.is_none() {
            visible_browser = Some(label.as_str());
        }
    }
    // The browser address field lives in main. Moving focus there must not
    // turn Cmd+R into a destructive reload of RIFT and all its browser tabs.
    reload(visible_browser.unwrap_or("main"))
}

#[cfg(target_os = "macos")]
async fn native_browser_menu_state(view: &tauri::Webview) -> Result<BrowserMenuState, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    view.with_webview(move |platform| {
        // AppKit's first responder belongs to the page's internal content view.
        // Walk its native responder chain; never ask untrusted page JavaScript
        // whether it has focus, and never grant it an IPC bridge.
        let native = unsafe { &*(platform.inner() as *const objc2_web_kit::WKWebView) };
        let pointer = native as *const _ as *const ();
        let visible = !unsafe { native.isHiddenOrHasHiddenAncestor() };
        let Some(window) = native.window() else {
            let _ = tx.send(Err("Browser window is unavailable.".to_string()));
            return;
        };
        let mut responder = window.firstResponder();
        for _ in 0..256 {
            let Some(current) = responder else {
                let _ = tx.send(Ok(BrowserMenuState {
                    focused: false,
                    visible,
                }));
                return;
            };
            if std::ptr::eq(&*current as *const _ as *const (), pointer) {
                let _ = tx.send(Ok(BrowserMenuState {
                    focused: true,
                    visible,
                }));
                return;
            }
            responder = unsafe { current.nextResponder() };
        }
        let _ = tx.send(Err("Browser focus is unavailable.".to_string()));
    })
    .map_err(|_| "Browser focus is unavailable.".to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(3), rx)
        .await
        .map_err(|_| "Browser focus timed out.".to_string())?
        .map_err(|_| "Browser view was closed.".to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn native_browser_menu_state(_view: &tauri::Webview) -> Result<BrowserMenuState, String> {
    // Native browser creation is unavailable on these platforms.
    Ok(BrowserMenuState {
        focused: false,
        visible: false,
    })
}

pub async fn reload_from_menu(app: tauri::AppHandle) -> Result<(), String> {
    let labels: Vec<String> = registry(&app.state::<BrowserState>())?
        .tabs
        .values()
        .filter(|tab| tab.ready)
        .map(|tab| tab.label.clone())
        .collect();
    reload_with_focus(
        &labels,
        |label| {
            let app = app.clone();
            async move {
                let view = app.get_webview(&label).ok_or("Browser view was closed.")?;
                native_browser_menu_state(&view).await
            }
        },
        |label| {
            app.get_webview(label)
                .ok_or("Webview is unavailable.")?
                .reload()
                .map_err(|_| "Could not reload the page.".into())
        },
    )
    .await
}

#[cfg(target_os = "macos")]
async fn platform_snapshot(
    view: &tauri::Webview,
    tab_id: &str,
    fallback_url: &str,
    action: Option<BrowserAction>,
) -> Result<BrowserSnapshot, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tab_id = tab_id.to_string();
    let fallback_url = fallback_url.to_string();
    view.with_webview(move |platform| {
        // with_webview executes on the native UI thread. The pointer remains
        // owned by wry; no Objective-C objects escape this callback.
        let native = unsafe { &*(platform.inner() as *const objc2_web_kit::WKWebView) };
        unsafe {
            match action {
                Some(BrowserAction::Back) if native.canGoBack() => {
                    native.goBack();
                }
                Some(BrowserAction::Forward) if native.canGoForward() => {
                    native.goForward();
                }
                Some(BrowserAction::Reload) => {
                    native.reload();
                }
                Some(BrowserAction::Stop) => native.stopLoading(),
                _ => {}
            }
            let snapshot = BrowserSnapshot {
                tab_id,
                url: native
                    .URL()
                    .and_then(|url| url.absoluteString())
                    .map(|url| url.to_string())
                    .unwrap_or(fallback_url),
                title: native
                    .title()
                    .map(|title| title.to_string())
                    .unwrap_or_default(),
                loading: native.isLoading(),
                can_go_back: native.canGoBack(),
                can_go_forward: native.canGoForward(),
            };
            let _ = tx.send(snapshot);
        }
    })
    .map_err(|_| "Could not access browser state.")?;
    tokio::time::timeout(std::time::Duration::from_secs(3), rx)
        .await
        .map_err(|_| "Browser state timed out.".to_string())?
        .map_err(|_| "Browser tab was closed.".to_string())
}

#[cfg(not(target_os = "macos"))]
async fn platform_snapshot(
    _view: &tauri::Webview,
    _tab_id: &str,
    _fallback_url: &str,
    _action: Option<BrowserAction>,
) -> Result<BrowserSnapshot, String> {
    Err("Native browser tabs are not available on this platform yet.".into())
}

#[tauri::command]
pub async fn browser_tab_create(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    state: tauri::State<'_, BrowserState>,
    tab_id: String,
    url: String,
) -> Result<BrowserSnapshot, String> {
    validate_caller_label(webview.label())?;
    validate_tab_id(&tab_id)?;
    let url = validate_browser_url(&url)?;
    if !cfg!(target_os = "macos") {
        return Err("Native browser tabs are not available on this platform yet.".into());
    }
    let tab = registry(&state)?.reserve(&tab_id, url.as_str())?;
    let result = (|| {
        let window = app
            .get_window("main")
            .ok_or("RIFT window is unavailable.")?;
        let popup_app = app.clone();
        let popup_label = tab.label.clone();
        let builder =
            tauri::webview::WebviewBuilder::new(&tab.label, tauri::WebviewUrl::External(url))
                .incognito(true)
                .focused(false)
                .general_autofill_enabled(false)
                .on_navigation(|url| validate_browser_url(url.as_str()).is_ok())
                .on_download(|_, _| false)
                // Keep ordinary target=_blank links usable without creating an
                // untracked or privileged window. Popups navigate this same tab.
                .on_new_window(move |url, _| {
                    if let Ok(url) = validate_browser_url(url.as_str()) {
                        if let Some(view) = popup_app.get_webview(&popup_label) {
                            let _ = view.navigate(url);
                        }
                    }
                    tauri::webview::NewWindowResponse::Deny
                });
        let view = window
            .add_child(
                builder,
                tauri::LogicalPosition::new(-10000.0, -10000.0),
                tauri::LogicalSize::new(1.0, 1.0),
            )
            .map_err(|_| "Could not create browser tab.")?;
        view.hide().map_err(|_| "Could not hide browser tab.")?;
        view.set_auto_resize(false)
            .map_err(|_| "Could not configure browser viewport.")?;
        if !registry(&state)?.finish_creation(&tab_id, &tab.label) {
            let _ = view.close();
            return Err("Browser tab was closed during creation.".to_string());
        }
        Ok(view)
    })();
    match result {
        Ok(view) => match platform_snapshot(&view, &tab_id, &tab.requested_url, None).await {
            Ok(snapshot) => Ok(snapshot),
            Err(error) => {
                registry(&state)?.remove_if_current(&tab_id, &tab.label);
                let _ = view.close();
                Err(error)
            }
        },
        Err(error) => {
            registry(&state)?.remove_if_current(&tab_id, &tab.label);
            if let Some(view) = app.get_webview(&tab.label) {
                let _ = view.close();
            }
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn browser_tab_snapshot(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    state: tauri::State<'_, BrowserState>,
    tab_id: String,
) -> Result<BrowserSnapshot, String> {
    validate_caller_label(webview.label())?;
    let tab = get_tab(&state, &tab_id)?;
    platform_snapshot(&get_view(&app, &tab)?, &tab_id, &tab.requested_url, None).await
}

#[tauri::command]
pub async fn browser_tab_navigate(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    state: tauri::State<'_, BrowserState>,
    tab_id: String,
    url: String,
) -> Result<BrowserSnapshot, String> {
    validate_caller_label(webview.label())?;
    let url = validate_browser_url(&url)?;
    let tab = get_tab(&state, &tab_id)?;
    let view = get_view(&app, &tab)?;
    view.navigate(url.clone())
        .map_err(|_| "Could not navigate browser tab.")?;
    if let Some(current) = registry(&state)?
        .tabs
        .get_mut(&tab_id)
        .filter(|current| current.label == tab.label)
    {
        current.requested_url = url.to_string();
    }
    platform_snapshot(&view, &tab_id, url.as_str(), None).await
}

#[tauri::command]
pub async fn browser_tab_action(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    state: tauri::State<'_, BrowserState>,
    tab_id: String,
    action: BrowserAction,
) -> Result<BrowserSnapshot, String> {
    validate_caller_label(webview.label())?;
    let tab = get_tab(&state, &tab_id)?;
    platform_snapshot(
        &get_view(&app, &tab)?,
        &tab_id,
        &tab.requested_url,
        Some(action),
    )
    .await
}

#[tauri::command]
pub async fn browser_tab_layout(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    state: tauri::State<'_, BrowserState>,
    tab_id: String,
    bounds: BrowserBounds,
    visible: bool,
) -> Result<(), String> {
    validate_caller_label(webview.label())?;
    let tab = get_tab(&state, &tab_id)?;
    let view = get_view(&app, &tab)?;
    // Hide first, including on invalid layouts: stale native content must not
    // cover the composer or dialogs after a container disappears.
    view.hide()
        .map_err(|_| "Could not hide browser viewport.")?;
    if !visible {
        return Ok(());
    }
    let window = app
        .get_window("main")
        .ok_or("RIFT window is unavailable.")?;
    let scale = window
        .scale_factor()
        .map_err(|_| "Window scale is unavailable.")?;
    let size = window
        .inner_size()
        .map_err(|_| "Window bounds are unavailable.")?
        .to_logical::<f64>(scale);
    let Some(bounds) = validated_bounds(bounds, size.width, size.height)? else {
        return Ok(());
    };
    let labels: Vec<String> = registry(&state)?
        .tabs
        .values()
        .map(|entry| entry.label.clone())
        .collect();
    for label in labels {
        if label != tab.label {
            if let Some(other) = app.get_webview(&label) {
                let _ = other.hide();
            }
        }
    }
    view.set_bounds(tauri::Rect {
        position: tauri::LogicalPosition::new(bounds.x, bounds.y).into(),
        size: tauri::LogicalSize::new(bounds.width, bounds.height).into(),
    })
    .map_err(|_| "Could not resize browser viewport.")?;
    view.show()
        .map_err(|_| "Could not show browser viewport.".into())
}

#[tauri::command]
pub async fn browser_tab_close(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    state: tauri::State<'_, BrowserState>,
    tab_id: String,
) -> Result<(), String> {
    validate_caller_label(webview.label())?;
    validate_tab_id(&tab_id)?;
    let tab = registry(&state)?.tabs.remove(&tab_id);
    if let Some(tab) = tab {
        if let Some(view) = app.get_webview(&tab.label) {
            view.close().map_err(|_| "Could not close browser tab.")?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_tabs_hide_all(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    state: tauri::State<'_, BrowserState>,
) -> Result<(), String> {
    validate_caller_label(webview.label())?;
    let labels: Vec<String> = registry(&state)?
        .tabs
        .values()
        .map(|tab| tab.label.clone())
        .collect();
    for label in labels {
        if let Some(view) = app.get_webview(&label) {
            view.hide().map_err(|_| "Could not hide browser tab.")?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn menu_reload_targets_the_focused_browser_without_reloading_main() {
        let mut reloads = Vec::new();
        reload_with_focus(
            &["background".into(), "focused".into()],
            |label| {
                std::future::ready(Ok(BrowserMenuState {
                    focused: label == "focused",
                    visible: true,
                }))
            },
            |label| {
                reloads.push(label.to_owned());
                Ok(())
            },
        )
        .await
        .unwrap();
        assert_eq!(reloads, ["focused"]);
    }

    #[tokio::test]
    async fn menu_reload_uses_main_when_all_browser_tabs_are_hidden() {
        let mut reloads = Vec::new();
        reload_with_focus(
            &["background".into()],
            |_| {
                std::future::ready(Ok(BrowserMenuState {
                    focused: false,
                    visible: false,
                }))
            },
            |label| {
                reloads.push(label.to_owned());
                Ok(())
            },
        )
        .await
        .unwrap();
        assert_eq!(reloads, ["main"]);
    }

    #[tokio::test]
    async fn menu_reload_keeps_main_address_field_focus_on_the_visible_browser() {
        let mut reloads = Vec::new();
        reload_with_focus(
            &["hidden-tab".into(), "visible-tab".into()],
            |label| {
                std::future::ready(Ok(BrowserMenuState {
                    focused: false,
                    visible: label == "visible-tab",
                }))
            },
            |label| {
                reloads.push(label.to_owned());
                Ok(())
            },
        )
        .await
        .unwrap();
        assert_eq!(reloads, ["visible-tab"]);
    }

    #[tokio::test]
    async fn failed_visible_browser_reload_never_reloads_main_instead() {
        let mut reloads = Vec::new();
        let result = reload_with_focus(
            &["visible-tab".into()],
            |_| {
                std::future::ready(Ok(BrowserMenuState {
                    focused: false,
                    visible: true,
                }))
            },
            |label| {
                reloads.push(label.to_owned());
                Err("Tab closed".into())
            },
        )
        .await;
        assert!(result.is_err());
        assert_eq!(reloads, ["visible-tab"]);
    }

    #[tokio::test]
    async fn uncertain_native_focus_never_falls_back_to_destructive_main_reload() {
        let mut reloads = Vec::new();
        let result = reload_with_focus(
            &["focused".into()],
            |_| std::future::ready(Err("View unavailable".into())),
            |label| {
                reloads.push(label.to_owned());
                Ok(())
            },
        )
        .await;
        assert!(result.is_err());
        assert!(reloads.is_empty());
    }

    #[tokio::test]
    async fn failed_browser_reload_never_reloads_the_application_instead() {
        let mut reloads = Vec::new();
        let result = reload_with_focus(
            &["focused".into()],
            |_| {
                std::future::ready(Ok(BrowserMenuState {
                    focused: true,
                    visible: true,
                }))
            },
            |label| {
                reloads.push(label.to_owned());
                Err("Tab closed".into())
            },
        )
        .await;
        assert!(result.is_err());
        assert_eq!(reloads, ["focused"]);
    }

    #[test]
    fn browser_addresses_never_open_local_files_or_privileged_protocols() {
        for url in [
            "file:///etc/passwd",
            "tauri://localhost/index.html",
            "javascript:alert(1)",
            "data:text/html,x",
            "rift://auth",
            "https://user:secret@example.com",
            "https://example.com/\nsecret",
        ] {
            assert!(validate_browser_url(url).is_err(), "accepted {url}");
        }
        assert!(validate_browser_url(&"x".repeat(4097)).is_err());
        for url in [
            "about:blank",
            "https://example.com/a#b",
            "http://localhost:3020",
            "http://127.0.0.1:5173",
        ] {
            assert!(validate_browser_url(url).is_ok(), "rejected {url}");
        }
    }

    #[test]
    fn only_main_caller_can_manage_browser_views() {
        assert!(validate_caller_label("main").is_ok());
        for label in ["", "browser-main", "browser-123", "Main", "main-child"] {
            assert!(validate_caller_label(label).is_err());
        }
    }

    #[test]
    fn identifiers_cannot_target_main_or_arbitrary_webviews() {
        for value in [
            "main",
            "../main",
            "browser-main",
            "",
            "00000000000000000000000000000000",
        ] {
            assert!(validate_tab_id(value).is_err());
        }
        let id = uuid::Uuid::new_v4().to_string();
        assert_eq!(validate_tab_id(&id).unwrap(), id);
    }

    #[test]
    fn layout_is_finite_bounded_and_empty_areas_hide() {
        let bounds = BrowserBounds {
            x: 200.0,
            y: 80.0,
            width: 900.0,
            height: 900.0,
        };
        let rect = validated_bounds(bounds, 1000.0, 800.0).unwrap().unwrap();
        assert_eq!(
            rect,
            BrowserBounds {
                x: 200.0,
                y: 80.0,
                width: 800.0,
                height: 720.0
            }
        );
        for value in [-1.0, f64::NAN, f64::INFINITY] {
            assert!(validated_bounds(BrowserBounds { x: value, ..bounds }, 1000.0, 800.0).is_err());
            assert!(validated_bounds(
                BrowserBounds {
                    width: value,
                    ..bounds
                },
                1000.0,
                800.0
            )
            .is_err());
        }
        assert!(validated_bounds(
            BrowserBounds {
                width: 0.0,
                ..bounds
            },
            1000.0,
            800.0
        )
        .unwrap()
        .is_none());
        assert!(validated_bounds(
            BrowserBounds {
                x: 1000.0,
                ..bounds
            },
            1000.0,
            800.0
        )
        .unwrap()
        .is_none());
    }

    #[test]
    fn tab_registry_enforces_capacity_and_does_not_replace_a_live_tab() {
        let mut registry = BrowserRegistry::default();
        let id = uuid::Uuid::new_v4().to_string();
        let first = registry.reserve(&id, "about:blank").unwrap();
        assert!(registry.reserve(&id, "https://example.com").is_err());
        for _ in 1..MAX_BROWSER_TABS {
            registry
                .reserve(&uuid::Uuid::new_v4().to_string(), "about:blank")
                .unwrap();
        }
        assert!(registry
            .reserve(&uuid::Uuid::new_v4().to_string(), "about:blank")
            .is_err());
        registry.tabs.remove(&id);
        let next = registry.reserve(&id, "about:blank").unwrap();
        assert_ne!(first.label, next.label);
        assert!(!registry.finish_creation(&id, &first.label));
        assert!(registry.finish_creation(&id, &next.label));
    }

    #[test]
    fn desktop_capabilities_never_grant_browser_children_native_permissions() {
        for json in [
            include_str!("../capabilities/default.json"),
            include_str!("../capabilities/dev.json"),
            include_str!("../capabilities/ui-preview.json"),
        ] {
            let capability: serde_json::Value = serde_json::from_str(json).unwrap();
            assert!(
                capability.get("windows").is_none(),
                "window scope authorizes every child webview"
            );
            assert_eq!(capability["webviews"], serde_json::json!(["main"]));
            assert!(capability["permissions"]
                .as_array()
                .unwrap()
                .contains(&serde_json::json!("allow-desktop-browser")));
        }
    }

    #[test]
    fn main_document_reload_closes_ready_tabs_and_cancels_pending_generations() {
        let mut registry = BrowserRegistry::default();
        let ready_id = uuid::Uuid::new_v4().to_string();
        let pending_id = uuid::Uuid::new_v4().to_string();
        let ready = registry.reserve(&ready_id, "https://example.com").unwrap();
        let pending = registry.reserve(&pending_id, "about:blank").unwrap();
        assert!(registry.finish_creation(&ready_id, &ready.label));

        let removed =
            registry.take_tabs_for_document_load("main", tauri::webview::PageLoadEvent::Started);
        assert_eq!(removed.len(), 2);
        assert!(removed.iter().any(|tab| tab.label == ready.label));
        assert!(removed.iter().any(|tab| tab.label == pending.label));
        assert!(registry.tabs.is_empty());
        assert!(!registry.finish_creation(&pending_id, &pending.label));

        // A rehydrated component can reuse the public ID. Late work from the
        // previous document must neither activate nor remove its replacement.
        let replacement = registry.reserve(&pending_id, "about:blank").unwrap();
        assert_ne!(replacement.label, pending.label);
        assert!(!registry.finish_creation(&pending_id, &pending.label));
        registry.remove_if_current(&pending_id, &pending.label);
        assert!(registry.finish_creation(&pending_id, &replacement.label));
    }

    #[test]
    fn child_navigation_and_main_document_finish_preserve_browser_tabs() {
        let mut registry = BrowserRegistry::default();
        let id = uuid::Uuid::new_v4().to_string();
        let tab = registry.reserve(&id, "https://example.com").unwrap();
        assert!(registry.finish_creation(&id, &tab.label));
        for (label, event) in [
            (tab.label.as_str(), tauri::webview::PageLoadEvent::Started),
            ("main", tauri::webview::PageLoadEvent::Finished),
        ] {
            assert!(registry
                .take_tabs_for_document_load(label, event)
                .is_empty());
            assert_eq!(registry.tabs.get(&id).unwrap().label, tab.label);
        }
    }
}
