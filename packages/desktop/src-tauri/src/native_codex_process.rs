//! Track owned process identities while app-server lives, then close and reap them.
use super::native_codex::NativeInput;
use std::{
    collections::HashMap,
    process::Child,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Clone)]
struct Process {
    parent: u32,
    birth: String,
}
#[cfg(target_os = "macos")]
fn identity(pid: u32) -> Option<Process> {
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
    let read = unsafe {
        libc::proc_pidinfo(
            pid as i32,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            size,
        )
    };
    if read != size {
        return None;
    }
    let info = unsafe { info.assume_init() };
    Some(Process {
        parent: info.pbi_ppid,
        birth: format!("{}:{}", info.pbi_start_tvsec, info.pbi_start_tvusec),
    })
}
#[cfg(target_os = "macos")]
fn children(parent: u32) -> Vec<u32> {
    // PROC_PPID_ONLY. proc_listpids returns bytes, unlike proc_listchildpids.
    let mut pids = vec![0i32; 4096];
    let size = unsafe {
        libc::proc_listpids(6, parent, pids.as_mut_ptr().cast(), (pids.len() * 4) as i32)
    };
    pids.into_iter()
        .take(size.max(0) as usize / 4)
        .filter(|pid| *pid > 1)
        .map(|pid| pid as u32)
        .collect()
}
#[cfg(all(unix, not(target_os = "macos")))]
fn processes() -> HashMap<u32, Process> {
    let Ok(output) = std::process::Command::new("/bin/ps")
        .args(["-axo", "pid=,ppid=,lstart="])
        .output()
    else {
        return HashMap::new();
    };
    if !output.status.success() || output.stdout.len() > 2 * 1024 * 1024 {
        return HashMap::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() < 7 {
                return None;
            }
            Some((
                fields[0].parse().ok()?,
                Process {
                    parent: fields[1].parse().ok()?,
                    birth: fields[2..].join(" "),
                },
            ))
        })
        .collect()
}
#[cfg(all(unix, not(target_os = "macos")))]
fn identity(pid: u32) -> Option<Process> {
    processes().remove(&pid)
}
#[cfg(all(unix, not(target_os = "macos")))]
fn children(parent: u32) -> Vec<u32> {
    processes()
        .into_iter()
        .filter_map(|(pid, p)| (p.parent == parent).then_some(pid))
        .collect()
}
#[cfg(not(unix))]
fn identity(_pid: u32) -> Option<Process> {
    None
}
#[cfg(not(unix))]
fn children(_parent: u32) -> Vec<u32> {
    Vec::new()
}

pub struct ProcessTracker {
    root: u32,
    root_birth: Option<String>,
    owned: Mutex<HashMap<u32, String>>,
    stopped: AtomicBool,
}
impl ProcessTracker {
    pub fn start(root: u32) -> Arc<Self> {
        let tracker = Arc::new(Self {
            root,
            root_birth: identity(root).map(|p| p.birth),
            owned: Mutex::new(HashMap::new()),
            stopped: AtomicBool::new(false),
        });
        tracker.capture();
        let weak = Arc::downgrade(&tracker);
        std::thread::spawn(move || loop {
            let Some(tracker) = weak.upgrade() else { break };
            if tracker.stopped.load(Ordering::Acquire) {
                break;
            }
            tracker.capture();
            drop(tracker);
            std::thread::sleep(Duration::from_millis(if cfg!(target_os = "macos") {
                50
            } else {
                500
            }));
        });
        tracker
    }
    fn root_is_current(&self) -> bool {
        self.root_birth
            .as_ref()
            .is_some_and(|birth| identity(self.root).is_some_and(|p| &p.birth == birth))
    }
    fn capture(&self) {
        let Ok(mut owned) = self.owned.lock() else {
            return;
        };
        // Retained identities survive root death; a recycled root is never trusted.
        let mut roots: Vec<_> = owned
            .iter()
            .filter_map(|(&pid, birth)| {
                identity(pid)
                    .is_some_and(|p| &p.birth == birth)
                    .then_some(pid)
            })
            .collect();
        if self.root_is_current() {
            roots.push(self.root);
        }
        let mut seen = std::collections::HashSet::new();
        while let Some(parent) = roots.pop() {
            if !seen.insert(parent) || seen.len() > 4096 {
                continue;
            }
            for pid in children(parent) {
                if pid == std::process::id() || pid == self.root {
                    continue;
                }
                if let Some(process) = identity(pid).filter(|p| p.parent == parent) {
                    owned.insert(pid, process.birth);
                    roots.push(pid);
                }
            }
        }
    }
}

pub fn terminate(child: &Mutex<Child>, stdin: &NativeInput, tracker: &ProcessTracker) {
    let Ok(mut child) = child.lock() else { return };
    tracker.capture();
    // All writers share this Option: taking it triggers real EOF/shutdown_threads.
    if let Ok(mut input) = stdin.lock() {
        input.take();
    }
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        if child.try_wait().ok().flatten().is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    #[cfg(unix)]
    {
        if child.try_wait().ok().flatten().is_none() && tracker.root_is_current() {
            unsafe {
                libc::kill(tracker.root as i32, libc::SIGSTOP);
            }
        }
        for _ in 0..4 {
            tracker.capture();
            let Ok(owned) = tracker.owned.lock() else {
                break;
            };
            for (&pid, birth) in owned.iter() {
                if identity(pid).is_some_and(|p| &p.birth == birth) {
                    unsafe {
                        libc::kill(pid as i32, libc::SIGSTOP);
                    }
                }
            }
        }
        if let Ok(owned) = tracker.owned.lock() {
            for (&pid, birth) in owned.iter() {
                if identity(pid).is_some_and(|p| &p.birth == birth) {
                    unsafe {
                        libc::kill(pid as i32, libc::SIGKILL);
                    }
                }
            }
        }
    }
    tracker.stopped.store(true, Ordering::Release);
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
#[path = "native_codex_process_tests.rs"]
mod tests;
