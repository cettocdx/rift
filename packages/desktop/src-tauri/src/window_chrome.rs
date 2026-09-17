//! Public AppKit window styling. AppKit owns the outside mask, shadow, and
//! fullscreen transition; the web surface must not draw a second frame.

#[cfg(target_os = "macos")]
pub fn configure(window: &tauri::WebviewWindow) -> Result<(), tauri::Error> {
    use objc2::sel;
    use objc2_app_kit::{NSTitlebarSeparatorStyle, NSView, NSWindow, NSWindowButton};
    use objc2_foundation::{MainThreadMarker, NSObjectProtocol, NSPoint};

    // Called from Tauri setup, on the AppKit main thread.
    let Some(_mtm) = MainThreadMarker::new() else {
        return Ok(());
    };
    let pointer = window.ns_window()?;
    let native = unsafe { &*pointer.cast::<NSWindow>() };
    unsafe {
        // Keep the decorated overlay window's standard AppKit geometry.
        // An empty Unified toolbar expands the outside corner mask on modern
        // macOS even though the workspace provides all of its own controls.
        if native.respondsToSelector(sel!(setTitlebarSeparatorStyle:)) {
            native.setTitlebarSeparatorStyle(NSTitlebarSeparatorStyle::None);
        }
        native.setTitlebarAppearsTransparent(true);
        native.setHasShadow(true);
        // Wry sizes the outer titlebar container from trafficLightPosition.
        // Convert its center into each button parent's coordinates instead of
        // assuming the web content or the immediate parent fills that container.
        for kind in [
            NSWindowButton::NSWindowCloseButton,
            NSWindowButton::NSWindowMiniaturizeButton,
            NSWindowButton::NSWindowZoomButton,
        ] {
            if let Some(button) = native.standardWindowButton(kind) {
                if let Some(parent) = button.superview() {
                    if let Some(container) = parent.superview() {
                        let mut frame = NSView::frame(&button);
                        let bounds = container.bounds();
                        let center = parent.convertPoint_fromView(
                            NSPoint::new(
                                bounds.origin.x,
                                bounds.origin.y + bounds.size.height / 2.0,
                            ),
                            Some(&container),
                        );
                        let target_y = center.y - frame.size.height / 2.0;
                        let parent_bounds = parent.bounds();
                        // Never move a control outside its parent's hit region.
                        if target_y >= parent_bounds.origin.y
                            && target_y + frame.size.height
                                <= parent_bounds.origin.y + parent_bounds.size.height
                        {
                            frame.origin.y = target_y;
                            button.setFrameOrigin(frame.origin);
                        }
                    }
                }
            }
        }
    }
    Ok(())
}
