use base64::Engine;
use serde::{Deserialize, Serialize};
use crate::consent::ConsentFlag;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
pub struct ComputerAccessState {
    pub web: ConsentFlag,
    computer: ConsentFlag,
    operation: tokio::sync::Mutex<()>,
}

impl ComputerAccessState {
    /// Signed-in device capabilities are ready without a separate app toggle.
    /// macOS permissions and per-operation owner checks remain independent.
    pub(crate) fn enable_for_signed_in_owner(&self) {
        self.web.approve(self.web.snapshot());
        if cfg!(target_os = "macos") {
            self.computer.approve(self.computer.snapshot());
        }
    }
    async fn acquire_operation(&self) -> Result<(tokio::sync::MutexGuard<'_, ()>, u64), String> {
        let grant = self.computer.snapshot();
        let serial = self.operation.lock().await;
        if !self.computer.current(grant) {
            return Err("The desktop session is not ready. Sign in to RIFT Desktop and retry.".into());
        }
        Ok((serial, grant))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessStatus {
    local_web: bool,
    computer: bool,
    screen_recording: bool,
    accessibility: bool,
    supported: bool,
}

fn status(state: &ComputerAccessState) -> AccessStatus {
    let (screen_recording, accessibility) = native::permissions();
    AccessStatus {
        local_web: state.web.enabled(),
        computer: state.computer.enabled(),
        screen_recording,
        accessibility,
        supported: cfg!(target_os = "macos"),
    }
}

#[tauri::command]
pub fn desktop_access_status(state: tauri::State<'_, ComputerAccessState>) -> AccessStatus {
    status(&state)
}

#[tauri::command]
pub async fn set_desktop_access(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ComputerAccessState>,
    capability: String,
    enabled: bool,
) -> Result<AccessStatus, String> {
    let (flag, description) = match capability.as_str() {
        "local_web" => (&state.web, "Allow your signed-in RIFT agent to read localhost pages on this Mac? This access ends when RIFT quits and does not share folders."),
        "computer" if cfg!(target_os = "macos") => (&state.computer, "Allow your signed-in RIFT agent to see the main display and operate your mouse and keyboard for your tasks? Screen contents are sent to the selected model. You can disconnect in Build access; access ends when RIFT quits."),
        _ => return Err("This desktop capability is unavailable.".into()),
    };
    if !enabled {
        flag.revoke();
        return Ok(status(&state));
    }
    let pending = flag.snapshot();
    if flag.current(pending) { return Ok(status(&state)); }
    if !app
        .dialog()
        .message(description)
        // A parentless macOS dialog uses CFUserNotification rather than an
        // app sheet and can remain invisible while this command waits.
        .parent(&window)
        .title("RIFT desktop connection")
        .buttons(MessageDialogButtons::OkCancel)
        .blocking_show()
    {
        return Ok(status(&state));
    }
    if flag.snapshot() != pending { return Ok(status(&state)); }
    if capability == "computer" {
        native::request_screen_permission();
    }
    // A disconnect during either consent prompt must win over its late result.
    flag.approve(pending);
    Ok(status(&state))
}

pub(crate) fn revoke_permissions(state: &ComputerAccessState) {
    state.web.revoke();
    state.computer.revoke();
}

/// Invalidate pending consent as well as every grant from the previous account.
#[tauri::command]
pub fn revoke_all_desktop_access(
    native: tauri::State<'_, crate::native_codex::NativeCodexState>,
    state: tauri::State<'_, ComputerAccessState>,
    workspaces: tauri::State<'_, crate::local_access::LocalAccessState>,
    terminals: tauri::State<'_, crate::pty::DesktopProfilePtyState>,
) -> Result<(), String> {
    revoke_permissions(&state);
    let mut terminals = terminals.lock().map_err(|_| "Desktop terminal state is unavailable.".to_string())?;
    crate::local_access::revoke_all_grants(&workspaces)?;
    terminals.revoke_owner();
    crate::native_codex::revoke_all(&native);
    Ok(())
}

/// Open only the native privacy panes, never an agent-supplied URL.
#[tauri::command]
pub fn open_desktop_permission_settings(app: tauri::AppHandle, permission: String) -> Result<(), String> {
    if !cfg!(target_os = "macos") { return Err("macOS permissions are unavailable on this platform.".into()); }
    let pane = match permission.as_str() {
        "screen_recording" => "Privacy_ScreenCapture",
        "accessibility" => "Privacy_Accessibility",
        _ => return Err("Unknown desktop permission.".into()),
    };
    app.opener().open_url(format!("x-apple.systempreferences:com.apple.preference.security?{pane}"), None::<&str>)
        .map_err(|error| format!("Could not open macOS permissions: {error}"))
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum ComputerAction {
    Screenshot {},
    Click {
        x: f64,
        y: f64,
    },
    Type {
        text: String,
    },
    Key {
        key: String,
        #[serde(default)]
        modifiers: Vec<String>,
    },
    Scroll {
        lines: i32,
    },
}

impl ComputerAction {
    fn validate(&self) -> Result<(), String> {
        match self {
            Self::Click { x, y }
                if !x.is_finite()
                    || !y.is_finite()
                    || !(0.0..=1.0).contains(x)
                    || !(0.0..=1.0).contains(y) =>
            {
                Err("Click coordinates must be between 0 and 1 on the main display.".into())
            }
            Self::Type { text } if text.chars().count() > 2000 => {
                Err("Type at most 2000 characters per action.".into())
            }
            Self::Key { key, modifiers }
                if keycode(key).is_none()
                    || modifiers
                        .iter()
                        .any(|m| !["meta", "control", "alt", "shift"].contains(&m.as_str())) =>
            {
                Err("Unsupported key or modifier.".into())
            }
            Self::Scroll { lines } if lines.unsigned_abs() > 50 => {
                Err("Scroll at most 50 lines per action.".into())
            }
            _ => Ok(()),
        }
    }
}

fn keycode(key: &str) -> Option<u16> {
    Some(match key.to_ascii_lowercase().as_str() {
        "enter" => 36,
        "tab" => 48,
        "space" => 49,
        "backspace" => 51,
        "escape" => 53,
        "arrowleft" => 123,
        "arrowright" => 124,
        "arrowdown" => 125,
        "arrowup" => 126,
        "a" => 0,
        "c" => 8,
        "v" => 9,
        "x" => 7,
        "z" => 6,
        "l" => 37,
        "f" => 3,
        "t" => 17,
        "w" => 13,
        "r" => 15,
        _ => return None,
    })
}

#[tauri::command]
pub async fn desktop_computer_action(
    state: tauri::State<'_, ComputerAccessState>,
    request: ComputerAction,
) -> Result<serde_json::Value, String> {
    request.validate()?;
    let (_serial, grant) = state.acquire_operation().await?;
    let (screen, input) = native::permissions();
    if matches!(request, ComputerAction::Screenshot { .. }) {
        if !screen {
            native::request_screen_permission();
            return Err("Enable Screen Recording for RIFT in macOS System Settings → Privacy & Security, then reopen RIFT.".into());
        }
        let dir = std::env::temp_dir().join(format!("rift-screen-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
        let result = async {
            let raw = dir.join("screen.png");
            let image = dir.join("screen.jpg");
            for (binary, args) in [
                ("/usr/sbin/screencapture", vec!["-x".into(), "-D".into(), "1".into(), raw.to_string_lossy().into_owned()]),
                ("/usr/bin/sips", vec!["-Z".into(), "1280".into(), "-s".into(), "format".into(), "jpeg".into(), "-s".into(), "formatOptions".into(), "55".into(), raw.to_string_lossy().into_owned(), "--out".into(), image.to_string_lossy().into_owned()]),
            ] {
                let mut command = tokio::process::Command::new(binary);
                command.args(args).kill_on_drop(true);
                let output = tokio::time::timeout(std::time::Duration::from_secs(8), command.output()).await
                    .map_err(|_| "Screen capture timed out.".to_string())?.map_err(|e| e.to_string())?;
                if !output.status.success() { return Err("Screen capture failed. Check RIFT's macOS Screen Recording permission.".into()); }
            }
            if !state.computer.current(grant) { return Err("Computer control was disconnected.".into()); }
            let bytes = std::fs::read(image).map_err(|e| e.to_string())?;
            if bytes.len() > 500 * 1024 { return Err("Screen capture exceeded the transfer limit.".into()); }
            Ok(serde_json::json!({"image": base64::engine::general_purpose::STANDARD.encode(bytes), "mediaType":"image/jpeg", "coordinates":"normalized-main-display"}))
        }.await;
        let _ = std::fs::remove_dir_all(dir);
        return result;
    }
    if !input {
        return Err("Enable Accessibility for RIFT in macOS System Settings → Privacy & Security before using the mouse or keyboard.".into());
    }
    native::perform(&request, &state.computer, grant)?;
    Ok(serde_json::json!({"performed":true,"observeNext":true}))
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use std::ffi::c_void;
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Point {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    struct Size {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    struct Rect {
        origin: Point,
        size: Size,
    }
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
        fn CGMainDisplayID() -> u32;
        fn CGDisplayBounds(display: u32) -> Rect;
        fn CGEventCreateMouseEvent(
            source: *const c_void,
            kind: u32,
            point: Point,
            button: u32,
        ) -> *mut c_void;
        fn CGEventCreateKeyboardEvent(source: *const c_void, key: u16, down: bool) -> *mut c_void;
        fn CGEventCreateScrollWheelEvent(
            source: *const c_void,
            units: u32,
            wheels: u32,
            ...
        ) -> *mut c_void;
        fn CGEventKeyboardSetUnicodeString(event: *mut c_void, length: usize, string: *const u16);
        fn CGEventSetFlags(event: *mut c_void, flags: u64);
        fn CGEventPost(tap: u32, event: *mut c_void);
        fn CFRelease(value: *const c_void);
    }
    pub fn request_screen_permission() {
        unsafe {
            if !CGPreflightScreenCaptureAccess() {
                CGRequestScreenCaptureAccess();
            }
        }
    }
    pub fn permissions() -> (bool, bool) {
        unsafe { (CGPreflightScreenCaptureAccess(), AXIsProcessTrusted()) }
    }
    unsafe fn post(event: *mut c_void) -> Result<(), String> {
        if event.is_null() {
            return Err("macOS could not create an input event.".into());
        }
        CGEventPost(0, event);
        CFRelease(event);
        Ok(())
    }
    pub fn perform(request: &ComputerAction, enabled: &ConsentFlag, grant: u64) -> Result<(), String> {
        if !enabled.current(grant) { return Err("Computer control was disconnected.".into()); }
        unsafe {
            match request {
                ComputerAction::Click { x, y } => {
                    let bounds = CGDisplayBounds(CGMainDisplayID());
                    let point = Point {
                        x: bounds.origin.x + x * (bounds.size.width - 1.0),
                        y: bounds.origin.y + y * (bounds.size.height - 1.0),
                    };
                    post(CGEventCreateMouseEvent(std::ptr::null(), 1, point, 0))?;
                    post(CGEventCreateMouseEvent(std::ptr::null(), 2, point, 0))?;
                }
                ComputerAction::Type { text } => {
                    for character in text.chars() {
                        if !enabled.current(grant) {
                            return Err("Computer control was disconnected.".into());
                        }
                        let units: Vec<u16> = character.to_string().encode_utf16().collect();
                        for down in [true, false] {
                            let event = CGEventCreateKeyboardEvent(std::ptr::null(), 0, down);
                            if event.is_null() {
                                return Err("macOS could not create a keyboard event.".into());
                            }
                            CGEventKeyboardSetUnicodeString(event, units.len(), units.as_ptr());
                            post(event)?;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(2));
                    }
                }
                ComputerAction::Key { key, modifiers } => {
                    let flags = modifiers.iter().fold(0u64, |flags, m| {
                        flags
                            | match m.as_str() {
                                "meta" => 1 << 20,
                                "shift" => 1 << 17,
                                "alt" => 1 << 19,
                                "control" => 1 << 18,
                                _ => 0,
                            }
                    });
                    for down in [true, false] {
                        let event = CGEventCreateKeyboardEvent(
                            std::ptr::null(),
                            keycode(key).ok_or("Unsupported key")?,
                            down,
                        );
                        if event.is_null() {
                            return Err("macOS could not create a keyboard event.".into());
                        }
                        CGEventSetFlags(event, flags);
                        post(event)?;
                    }
                }
                ComputerAction::Scroll { lines } => post(CGEventCreateScrollWheelEvent(
                    std::ptr::null(),
                    1,
                    1,
                    *lines,
                ))?,
                ComputerAction::Screenshot { .. } => unreachable!(),
            }
        }
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
mod native {
    use super::*;
    pub fn request_screen_permission() {}
    pub fn permissions() -> (bool, bool) {
        (false, false)
    }
    pub fn perform(_: &ComputerAction, _: &ConsentFlag, _: u64) -> Result<(), String> {
        Err("Computer control currently requires macOS.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signed_in_defaults_preserve_revocation_fences() {
        let state = ComputerAccessState::default();
        assert!(!state.web.enabled());
        state.enable_for_signed_in_owner();
        let previous = state.web.snapshot();
        assert!(state.web.current(previous));
        assert_eq!(state.computer.enabled(), cfg!(target_os = "macos"));
        revoke_permissions(&state);
        assert!(!state.web.enabled());
        assert!(!state.computer.enabled());
        state.enable_for_signed_in_owner();
        assert!(!state.web.current(previous));
        assert!(state.web.enabled());
    }
    #[tokio::test]
    async fn queued_operation_is_rejected_after_disconnect_and_reconnect() {
        let state = ComputerAccessState::default();
        assert!(state.computer.approve(state.computer.snapshot()));
        let active = state.operation.lock().await;
        let queued = state.acquire_operation();
        tokio::pin!(queued);
        // Poll the queued command until it is blocked on the active operation.
        tokio::select! {
            biased;
            _ = &mut queued => panic!("The active operation should keep this queued"),
            _ = async {} => {}
        }
        state.computer.revoke();
        assert!(state.computer.approve(state.computer.snapshot()));
        drop(active);
        assert!(queued.await.is_err());
        assert!(state.acquire_operation().await.is_ok());
    }

    #[test]
    fn rejects_invalid_actions() {
        assert!(ComputerAction::Click {
            x: f64::NAN,
            y: 0.5
        }
        .validate()
        .is_err());
        assert!(ComputerAction::Click { x: 1.1, y: 0.5 }.validate().is_err());
        assert!(ComputerAction::Scroll { lines: i32::MIN }
            .validate()
            .is_err());
        assert!(ComputerAction::Key {
            key: "l".into(),
            modifiers: vec!["meta".into()]
        }
        .validate()
        .is_ok());
        assert!(serde_json::from_str::<ComputerAction>(
            r#"{"action":"screenshot","command":"anything"}"#
        )
        .is_err());
    }
    #[test]
    fn starts_disconnected() {
        let state = ComputerAccessState::default();
        assert!(!state.web.enabled());
        assert!(!state.computer.enabled());
    }
}
