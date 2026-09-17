use super::*;
#[test]
fn a_reused_root_identity_cannot_adopt_new_descendants() {
    let tracker = ProcessTracker {
        root: std::process::id(),
        root_birth: Some("different-birth".into()),
        owned: Mutex::new(HashMap::new()),
        stopped: AtomicBool::new(false),
    };
    tracker.capture();
    assert!(tracker.owned.lock().unwrap().is_empty());
}
