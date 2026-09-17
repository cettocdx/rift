use std::sync::atomic::{AtomicU64, Ordering};

/// Low bit: enabled. Remaining bits: generation, advanced on every revocation.
/// One atomic value prevents consent completion from racing a disconnect store.
#[derive(Default)]
pub struct ConsentFlag(AtomicU64);

impl ConsentFlag {
    pub fn snapshot(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
    pub fn enabled(&self) -> bool {
        self.snapshot() & 1 != 0
    }
    pub fn current(&self, token: u64) -> bool {
        token & 1 != 0 && self.snapshot() == token
    }
    pub fn approve(&self, pending: u64) -> bool {
        self.0
            .compare_exchange(pending, pending | 1, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }
    pub fn revoke(&self) {
        // Increment even when already disconnected: pending prompts still expire.
        let _ = self
            .0
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |value| {
                Some(value.wrapping_add(2) & !1)
            });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revocation_defeats_late_approval() {
        let grant = ConsentFlag::default();
        let pending = grant.snapshot();
        grant.revoke();
        assert!(!grant.approve(pending));
        assert!(!grant.enabled());
    }

    #[test]
    fn old_queued_action_cannot_use_a_replacement_grant() {
        let grant = ConsentFlag::default();
        assert!(grant.approve(grant.snapshot()));
        let queued = grant.snapshot();
        grant.revoke();
        assert!(grant.approve(grant.snapshot()));
        assert!(!grant.current(queued));
        assert!(grant.current(grant.snapshot()));
    }

    #[test]
    fn cancellation_does_not_grant_access() {
        let grant = ConsentFlag::default();
        let _cancelled = grant.snapshot();
        assert!(!grant.enabled());
    }
}
