use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;
use tauri::ipc::Channel;

use crate::platform;

const OUTPUT_BUFFER_MAX_BYTES: usize = 32 * 1024;
pub const MAX_DESKTOP_PROFILE_PTY_SESSIONS: usize = 8;
pub const MAX_DESKTOP_PROFILE_PTY_INPUT_BYTES: usize = 64 * 1024;
const MIN_PTY_COLS: u16 = 20;
const MAX_PTY_COLS: u16 = 500;
const MIN_PTY_ROWS: u16 = 5;
const MAX_PTY_ROWS: u16 = 200;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopTerminalProfileCapability {
    pub profile: &'static str,
    pub available: bool,
    pub runtime_label: &'static str,
    pub unavailable_reason: Option<String>,
}

#[derive(Clone)]
pub struct DesktopTerminalProfileLaunch {
    pub profile: &'static str,
    pub runtime_label: &'static str,
    pub executable: PathBuf,
    pub args: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopProfilePtyCreateResult {
    pub cwd: String,
    pub pid: Option<u32>,
    pub session_id: String,
    pub profile: &'static str,
    pub runtime_label: &'static str,
}

fn shell_launch() -> Option<DesktopTerminalProfileLaunch> {
    #[cfg(windows)]
    let candidates: &[(&str, &[&str])] = &[("cmd", &[])];
    #[cfg(not(windows))]
    let candidates: &[(&str, &[&str])] = &[
        ("/bin/zsh", &["-f"]),
        ("/bin/bash", &["--noprofile", "--norc"]),
        ("/bin/sh", &[]),
    ];

    for (program, args) in candidates {
        let candidate = Path::new(program);
        #[cfg(not(windows))]
        let executable = candidate
            .is_file()
            .then(|| std::fs::canonicalize(candidate).ok())
            .flatten();
        #[cfg(windows)]
        let executable = platform::find_gui_executable(program);
        if let Some(executable) = executable {
            return Some(DesktopTerminalProfileLaunch {
                profile: "shell",
                runtime_label: "System shell",
                executable,
                args: args.iter().map(|arg| (*arg).to_string()).collect(),
            });
        }
    }
    None
}

pub fn resolve_desktop_terminal_profile(profile: &str) -> Option<DesktopTerminalProfileLaunch> {
    let (profile, runtime_label, command, args): (
        &'static str,
        &'static str,
        &'static str,
        &[&str],
    ) = match profile {
        "shell" => return shell_launch(),
        "claude" => ("claude", "Claude Code", "claude", &[]),
        "codex" => (
            "codex",
            "Codex",
            "codex",
            &["-c", "check_for_update_on_startup=false"],
        ),
        "grok" => ("grok", "Grok", "grok", &[]),
        _ => return None,
    };
    platform::find_gui_executable(command).map(|executable| DesktopTerminalProfileLaunch {
        profile,
        runtime_label,
        executable,
        args: args.iter().map(|arg| (*arg).to_string()).collect(),
    })
}

pub fn desktop_terminal_profile_capabilities() -> Vec<DesktopTerminalProfileCapability> {
    [
        ("shell", "System shell"),
        ("claude", "Claude Code"),
        ("codex", "Codex"),
        ("grok", "Grok"),
    ]
    .into_iter()
    .map(|(profile, runtime_label)| {
        let available = resolve_desktop_terminal_profile(profile).is_some();
        DesktopTerminalProfileCapability {
            profile,
            available,
            runtime_label,
            unavailable_reason: (!available).then(|| {
                format!("{runtime_label} is not installed in a supported desktop CLI location.")
            }),
        }
    })
    .collect()
}

pub fn valid_profile_session_id(session_id: &str) -> bool {
    !session_id.is_empty()
        && session_id.len() <= 128
        && session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

pub fn valid_pty_geometry(cols: u16, rows: u16) -> bool {
    (MIN_PTY_COLS..=MAX_PTY_COLS).contains(&cols) && (MIN_PTY_ROWS..=MAX_PTY_ROWS).contains(&rows)
}

const DESKTOP_REPLAY_BYTES: usize = 512 * 1024;
pub const DESKTOP_OUTPUT_WINDOW_BYTES: usize = 64 * 1024;
const DESKTOP_READ_BYTES: usize = 4096;
const MAX_CLOSED_DESKTOP_TABS: usize = 4096;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DesktopTerminalEvent {
    Ready {
        sequence: u64,
    },
    Exit {
        #[serde(rename = "exitCode")]
        exit_code: i32,
    },
    Truncated,
    Closed,
}

#[derive(Serialize)]
pub struct DesktopTerminalRead {
    sequence: u64,
    data: String,
}

struct DesktopAttachment {
    id: String,
    channel: Channel<DesktopTerminalEvent>,
    acknowledged: u64,
    sent: u64,
    read: bool,
    exit_sent: bool,
}

#[derive(Clone, Copy)]
enum DesktopIoInterest {
    Read,
    Write,
}

/// Owns the descriptor used by poll, independently of the manager's master.
/// Closing the signal socket creates sticky EOF on its peer: all waiters wake
/// without one reader consuming another reader/writer's cancellation token.
struct DesktopIoReadiness {
    #[cfg(unix)]
    master: std::os::fd::OwnedFd,
    #[cfg(unix)]
    cancelled_peer: std::os::unix::net::UnixStream,
    #[cfg(unix)]
    cancel_signal: std::os::unix::net::UnixStream,
    cancelled: std::sync::atomic::AtomicBool,
    #[cfg(test)]
    read_waits: std::sync::atomic::AtomicUsize,
    #[cfg(test)]
    write_waits: std::sync::atomic::AtomicUsize,
}

impl DesktopIoReadiness {
    #[cfg(unix)]
    fn new(master: std::os::fd::RawFd) -> std::io::Result<Self> {
        use std::os::fd::{AsRawFd, FromRawFd};
        let duplicate = unsafe { libc::fcntl(master, libc::F_DUPFD_CLOEXEC, 0) };
        if duplicate < 0 {
            return Err(std::io::Error::last_os_error());
        }
        let master = unsafe { std::os::fd::OwnedFd::from_raw_fd(duplicate) };
        let (cancelled_peer, cancel_signal) = std::os::unix::net::UnixStream::pair()?;
        for socket in [&cancelled_peer, &cancel_signal] {
            socket.set_nonblocking(true)?;
            let flags = unsafe { libc::fcntl(socket.as_raw_fd(), libc::F_GETFD) };
            if flags < 0
                || unsafe {
                    libc::fcntl(socket.as_raw_fd(), libc::F_SETFD, flags | libc::FD_CLOEXEC)
                } < 0
            {
                return Err(std::io::Error::last_os_error());
            }
        }
        Ok(Self {
            master,
            cancelled_peer,
            cancel_signal,
            cancelled: std::sync::atomic::AtomicBool::new(false),
            #[cfg(test)]
            read_waits: std::sync::atomic::AtomicUsize::new(0),
            #[cfg(test)]
            write_waits: std::sync::atomic::AtomicUsize::new(0),
        })
    }
    fn cancel(&self) {
        if !self
            .cancelled
            .swap(true, std::sync::atomic::Ordering::AcqRel)
        {
            #[cfg(unix)]
            let _ = self.cancel_signal.shutdown(std::net::Shutdown::Both);
        }
    }
    /// false means cancelled. No output/manager mutex may be held here.
    fn wait(&self, interest: DesktopIoInterest) -> std::io::Result<bool> {
        #[cfg(test)]
        match interest {
            DesktopIoInterest::Read => &self.read_waits,
            DesktopIoInterest::Write => &self.write_waits,
        }
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            loop {
                if self.cancelled.load(std::sync::atomic::Ordering::Acquire) {
                    return Ok(false);
                }
                let mut descriptors = [
                    libc::pollfd {
                        fd: self.master.as_raw_fd(),
                        events: match interest {
                            DesktopIoInterest::Read => libc::POLLIN,
                            DesktopIoInterest::Write => libc::POLLOUT,
                        },
                        revents: 0,
                    },
                    libc::pollfd {
                        fd: self.cancelled_peer.as_raw_fd(),
                        events: libc::POLLIN,
                        revents: 0,
                    },
                ];
                let result =
                    unsafe { libc::poll(descriptors.as_mut_ptr(), descriptors.len() as _, -1) };
                if result < 0 {
                    let error = std::io::Error::last_os_error();
                    if error.kind() == std::io::ErrorKind::Interrupted {
                        continue;
                    }
                    return Err(error);
                }
                // Cancellation wins over simultaneous PTY readiness.
                if self.cancelled.load(std::sync::atomic::Ordering::Acquire)
                    || descriptors[1].revents != 0
                {
                    return Ok(false);
                }
                if descriptors[0].revents & libc::POLLNVAL != 0 {
                    return Err(std::io::Error::from_raw_os_error(libc::EBADF));
                }
                // HUP/ERR may accompany unread bytes; let the nonblocking read
                // drain those before the existing EOF/exit-status path runs.
                if descriptors[0].revents != 0 {
                    return Ok(true);
                }
            }
        }
        #[cfg(not(unix))]
        {
            let _ = interest;
            thread::sleep(std::time::Duration::from_millis(5));
            Ok(!self.cancelled.load(std::sync::atomic::Ordering::Acquire))
        }
    }
}

/// Kept by the native process. Byte cursors refer to decoded UTF-8 output, not
/// chunk counts. One bounded batch can cross IPC until xterm acknowledges it.
struct DesktopTerminalOutput {
    replay: VecDeque<(u64, String)>,
    replay_bytes: usize,
    limit: usize,
    sequence: u64,
    truncated: bool,
    exit_code: Option<i32>,
    pending_utf8: Vec<u8>,
    subscriber: Option<DesktopAttachment>,
    changed: Arc<std::sync::Condvar>,
    stopped: bool,
    readiness: Option<Arc<DesktopIoReadiness>>,
}

impl DesktopTerminalOutput {
    fn new(limit: usize) -> Self {
        Self {
            replay: VecDeque::new(),
            replay_bytes: 0,
            limit,
            sequence: 0,
            truncated: false,
            exit_code: None,
            pending_utf8: Vec::new(),
            subscriber: None,
            changed: Arc::new(std::sync::Condvar::new()),
            stopped: false,
            readiness: None,
        }
    }
    fn send(&mut self, event: DesktopTerminalEvent) {
        if self
            .subscriber
            .as_ref()
            .is_some_and(|attachment| attachment.channel.send(event).is_err())
        {
            self.subscriber = None;
            self.changed.notify_all();
        }
    }
    fn pump(&mut self) {
        let Some(attachment) = self.subscriber.as_mut() else {
            return;
        };
        if attachment.sent != attachment.acknowledged {
            return;
        }
        let mut bytes = 0;
        let mut cursor = attachment.acknowledged;
        for (end, chunk) in &self.replay {
            if *end <= cursor {
                continue;
            }
            if bytes + chunk.len() > DESKTOP_OUTPUT_WINDOW_BYTES {
                break;
            }
            bytes += chunk.len();
            cursor = *end;
        }
        if bytes > 0 {
            attachment.sent = cursor;
            attachment.read = false;
            // Keep Channel messages tiny: Tauri caches large channel payloads
            // until a JS fetch, which can be lost when the renderer reloads.
            self.send(DesktopTerminalEvent::Ready { sequence: cursor });
        } else if let Some(exit_code) = self.exit_code {
            if !attachment.exit_sent {
                attachment.exit_sent = true;
                self.send(DesktopTerminalEvent::Exit { exit_code });
            }
        }
    }
    fn acknowledge(&mut self, attachment_id: &str, cursor: u64) -> Result<(), String> {
        let attachment = self
            .subscriber
            .as_mut()
            .ok_or("Terminal attachment expired.")?;
        if attachment.id != attachment_id {
            return Err("Terminal attachment expired.".into());
        }
        if cursor != attachment.sent || cursor <= attachment.acknowledged || !attachment.read {
            return Err("Invalid terminal render acknowledgement.".into());
        }
        attachment.acknowledged = cursor;
        self.changed.notify_all();
        self.pump();
        Ok(())
    }
    fn read(&mut self, attachment_id: &str, cursor: u64) -> Result<DesktopTerminalRead, String> {
        let attachment = self
            .subscriber
            .as_mut()
            .ok_or("Terminal attachment expired.")?;
        if attachment.id != attachment_id {
            return Err("Terminal attachment expired.".into());
        }
        if attachment.read || cursor != attachment.sent || cursor <= attachment.acknowledged {
            return Err("Invalid terminal output cursor.".into());
        }
        let data: String = self
            .replay
            .iter()
            .filter(|(end, _)| *end > attachment.acknowledged && *end <= cursor)
            .map(|(_, data)| data.as_str())
            .collect();
        if data.len() as u64 != cursor - attachment.acknowledged
            || data.len() > DESKTOP_OUTPUT_WINDOW_BYTES
        {
            return Err("Terminal output cursor is unavailable.".into());
        }
        attachment.read = true;
        Ok(DesktopTerminalRead {
            sequence: cursor,
            data,
        })
    }
    fn reader_blocked(&self) -> bool {
        self.subscriber.as_ref().is_some_and(|attachment| {
            // Reserve a whole read, including worst-case replacement of invalid
            // UTF-8 and a partial character retained from the preceding read.
            self.sequence.saturating_sub(attachment.acknowledged)
                + (DESKTOP_READ_BYTES * 3 + 4) as u64
                > DESKTOP_OUTPUT_WINDOW_BYTES as u64
        })
    }
    fn publish(&mut self, data: String) {
        if data.is_empty() {
            return;
        }
        self.sequence += data.len() as u64;
        self.replay_bytes += data.len();
        self.replay.push_back((self.sequence, data));
        while self.replay_bytes > self.limit {
            // The reader's window prevents reaching this condition in attached
            // production sessions. Never silently trim an unacknowledged byte.
            if self.subscriber.as_ref().is_some_and(|attachment| {
                self.replay
                    .front()
                    .is_some_and(|(end, _)| *end > attachment.acknowledged)
            }) {
                break;
            }
            if let Some((_, data)) = self.replay.pop_front() {
                self.replay_bytes -= data.len();
            }
            self.truncated = true;
        }
        self.pump();
    }
    fn write(&mut self, bytes: &[u8]) {
        self.pending_utf8.extend_from_slice(bytes);
        loop {
            match std::str::from_utf8(&self.pending_utf8) {
                Ok(text) => {
                    let text = text.to_owned();
                    self.pending_utf8.clear();
                    self.publish(text);
                    break;
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    let text = String::from_utf8_lossy(&self.pending_utf8[..valid]).into_owned();
                    let invalid = error.error_len();
                    self.pending_utf8.drain(..valid + invalid.unwrap_or(0));
                    self.publish(text);
                    if invalid.is_some() {
                        self.publish("�".into());
                    } else {
                        break;
                    }
                }
            }
        }
    }
    fn finish(&mut self, exit_code: i32) {
        if !self.pending_utf8.is_empty() {
            let text = String::from_utf8_lossy(&self.pending_utf8).into_owned();
            self.pending_utf8.clear();
            self.publish(text);
        }
        self.exit_code = Some(exit_code);
        self.pump();
    }
    fn attach(&mut self, attachment_id: String, channel: Channel<DesktopTerminalEvent>) {
        if self.stopped {
            let _ = channel.send(DesktopTerminalEvent::Closed);
            return;
        }
        let cursor = self
            .replay
            .front()
            .map(|(end, data)| end - data.len() as u64)
            .unwrap_or(self.sequence);
        self.subscriber = Some(DesktopAttachment {
            id: attachment_id,
            channel,
            acknowledged: cursor,
            sent: cursor,
            read: false,
            exit_sent: false,
        });
        self.changed.notify_all();
        if self.truncated {
            self.send(DesktopTerminalEvent::Truncated);
        }
        self.pump();
    }
    fn detach(&mut self, attachment_id: &str) {
        if self
            .subscriber
            .as_ref()
            .is_some_and(|attachment| attachment.id == attachment_id)
        {
            self.subscriber = None;
            self.changed.notify_all();
        }
    }
    fn stop(&mut self) {
        self.stopped = true;
        if let Some(readiness) = &self.readiness {
            readiness.cancel();
        }
        self.send(DesktopTerminalEvent::Closed);
        self.subscriber = None;
        self.changed.notify_all();
    }
}

type DesktopOutput = Arc<std::sync::Mutex<DesktopTerminalOutput>>;
enum PtyOutput {
    Legacy(Channel<String>),
    Desktop(DesktopOutput),
}

type DesktopInputCompletion = std::sync::mpsc::Receiver<Result<(), String>>;
type DesktopInputRequest = (String, std::sync::mpsc::SyncSender<Result<(), String>>);

fn write_desktop_input(
    writer: &mut dyn Write,
    mut data: &[u8],
    shutdown: &std::sync::atomic::AtomicBool,
    readiness: Option<&DesktopIoReadiness>,
) -> Result<(), String> {
    while !data.is_empty() {
        if shutdown.load(std::sync::atomic::Ordering::Acquire)
            || readiness
                .is_some_and(|ready| ready.cancelled.load(std::sync::atomic::Ordering::Acquire))
        {
            return Err("Desktop terminal session is closed.".into());
        }
        match writer.write(data) {
            Ok(0) => return Err("Desktop terminal input closed.".into()),
            Ok(count) => data = &data[count..],
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if let Some(readiness) = readiness {
                    if !readiness
                        .wait(DesktopIoInterest::Write)
                        .map_err(|error| format!("Terminal write wait failed: {error}"))?
                    {
                        return Err("Desktop terminal session is closed.".into());
                    }
                } else {
                    thread::sleep(std::time::Duration::from_millis(5));
                }
            }
            Err(error) => return Err(format!("Failed to write to PTY: {error}")),
        }
    }
    Ok(())
}

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    child_killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
    desktop_terminate: Option<std::sync::mpsc::Sender<()>>,
    child_exited: Arc<std::sync::atomic::AtomicBool>,
    writer: Option<Box<dyn Write + Send>>,
    desktop_input: Option<std::sync::mpsc::SyncSender<DesktopInputRequest>>,
    reader_shutdown: Arc<std::sync::atomic::AtomicBool>,
    readiness: Option<Arc<DesktopIoReadiness>>,
}

pub struct PtyManager {
    sessions: HashMap<String, PtySession>,
}

#[derive(Serialize, Clone)]
pub struct PtyCreateResult {
    pub pid: Option<u32>,
    pub session_id: String,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    pub fn create(
        &mut self,
        session_id: String,
        command: String,
        cols: u16,
        rows: u16,
        cwd: Option<String>,
        env: Option<HashMap<String, String>>,
        on_data: Channel<String>,
    ) -> Result<PtyCreateResult, String> {
        if self.sessions.contains_key(&session_id) {
            return Err(format!("Session '{}' already exists", session_id));
        }

        let shell = get_default_shell();

        let mut cmd = if command.is_empty() {
            CommandBuilder::new(&shell)
        } else {
            let mut c = CommandBuilder::new(&shell);
            let shell_flag = get_shell_exec_flag(&shell);
            c.arg(shell_flag);
            c.arg(&command);
            c
        };

        #[cfg(not(windows))]
        cmd.env("PATH", platform::effective_path());

        if let Some(ref dir) = cwd {
            cmd.cwd(dir);
        }

        if let Some(ref env_map) = env {
            for (k, v) in env_map {
                cmd.env(k, v);
            }
        }

        self.spawn_builder(session_id, cmd, cols, rows, PtyOutput::Legacy(on_data))
    }

    fn create_program(
        &mut self,
        session_id: String,
        program: &Path,
        args: &[String],
        cols: u16,
        rows: u16,
        cwd: &Path,
        output: DesktopOutput,
    ) -> Result<PtyCreateResult, String> {
        if self.sessions.contains_key(&session_id) {
            return Err(format!("Session '{}' already exists", session_id));
        }

        let mut cmd = CommandBuilder::new(program);
        cmd.args(args);
        cmd.env_clear();
        for key in [
            "HOME",
            "USER",
            "LOGNAME",
            "TMPDIR",
            "LANG",
            "LC_ALL",
            "LC_CTYPE",
            "SSH_AUTH_SOCK",
            "GPG_TTY",
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "no_proxy",
            "ANTHROPIC_API_KEY",
            "OPENAI_API_KEY",
            "XAI_API_KEY",
        ] {
            if let Some(value) = std::env::var_os(key).filter(|value| value.len() <= 8 * 1024) {
                cmd.env(key, value);
            }
        }
        cmd.env("PATH", platform::effective_path());
        cmd.env("SHELL", shell_program_for_environment());
        cmd.env("PWD", cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "RIFT");
        cmd.env("RIFT_LOCAL_TERMINAL", "1");
        cmd.cwd(cwd);

        self.spawn_builder(session_id, cmd, cols, rows, PtyOutput::Desktop(output))
    }

    fn spawn_builder(
        &mut self,
        session_id: String,
        cmd: CommandBuilder,
        cols: u16,
        rows: u16,
        output: PtyOutput,
    ) -> Result<PtyCreateResult, String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let durable = matches!(&output, PtyOutput::Desktop(_));
        #[cfg(unix)]
        if durable {
            let fd = pair
                .master
                .as_raw_fd()
                .ok_or("Terminal descriptor is unavailable.")?;
            let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
            if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
            {
                return Err("Failed to configure bounded terminal I/O.".into());
            }
        }
        #[cfg(unix)]
        let readiness = if durable {
            Some(Arc::new(
                DesktopIoReadiness::new(pair.master.as_raw_fd().unwrap())
                    .map_err(|error| format!("Failed to configure terminal readiness: {error}"))?,
            ))
        } else {
            None
        };
        #[cfg(not(unix))]
        let readiness: Option<Arc<DesktopIoReadiness>> = None;
        if let PtyOutput::Desktop(output) = &output {
            output
                .lock()
                .map_err(|_| "Terminal output unavailable.")?
                .readiness = readiness.clone();
        }
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {e}"))?;
        #[cfg(unix)]
        let foreground_terminal = if durable {
            use std::os::fd::FromRawFd;
            pair.master
                .as_raw_fd()
                .map(|fd| {
                    let duplicate = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 0) };
                    if duplicate < 0 {
                        return Err("Failed to retain terminal control handle.".to_string());
                    }
                    Ok(unsafe { std::fs::File::from_raw_fd(duplicate) })
                })
                .transpose()?
        } else {
            None
        };
        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn command: {e}"))?;
        let pid = child.process_id();
        let child_killer = child.clone_killer();
        let shutdown_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let shutdown_clone = shutdown_flag.clone();
        let (writer, desktop_input) = if durable {
            // At most one active and one queued input chunk. A blocked child
            // stdin never holds the terminal manager or output mutex.
            let (sender, receiver) = std::sync::mpsc::sync_channel::<DesktopInputRequest>(1);
            let shutdown = shutdown_flag.clone();
            let readiness = readiness.clone();
            thread::spawn(move || {
                let mut writer = writer;
                while let Ok((data, complete)) = receiver.recv() {
                    let result = write_desktop_input(
                        writer.as_mut(),
                        data.as_bytes(),
                        &shutdown,
                        readiness.as_deref(),
                    );
                    let _ = complete.send(result);
                }
            });
            (None, Some(sender))
        } else {
            (Some(writer), None)
        };
        let (exit_sender, exit_receiver) = std::sync::mpsc::sync_channel(1);
        let (terminate_sender, terminate_receiver) = std::sync::mpsc::channel();
        let child_exited = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let worker_exited = child_exited.clone();

        // The durable waiter retains the real child handle. Close/revoke asks
        // this worker to terminate it, rather than signalling a stored PID that
        // might already have been reaped and reused by an unrelated process.
        thread::spawn(move || {
            let exit_code = if durable {
                loop {
                    match child.try_wait() {
                        Ok(Some(status)) => break portable_exit_code(status),
                        Err(_) => break -1,
                        Ok(None) => {}
                    }
                    match terminate_receiver.recv_timeout(std::time::Duration::from_millis(25)) {
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                        _ => {
                            #[cfg(unix)]
                            if let Some(terminal) = &foreground_terminal {
                                use std::os::fd::AsRawFd;
                                let group = unsafe { libc::tcgetpgrp(terminal.as_raw_fd()) };
                                // Terminate the whole foreground job, including
                                // HUP-resistant children sharing the leader's group.
                                // The retained child handle still owns/reaps the
                                // leader, so an exited tab never signals a reused PID.
                                if group > 0 && group != unsafe { libc::getpgrp() } {
                                    if Some(group as u32) == pid {
                                        // Keep the leader unreaped during this grace:
                                        // its PID/group cannot be recycled, and a
                                        // normal shell can notify background jobs.
                                        unsafe {
                                            libc::kill(-group, libc::SIGHUP);
                                        }
                                        thread::sleep(std::time::Duration::from_millis(50));
                                    }
                                    unsafe {
                                        libc::kill(-group, libc::SIGKILL);
                                    }
                                }
                            }
                            let _ = child.kill();
                            break child.wait().map(portable_exit_code).unwrap_or(-1);
                        }
                    }
                }
            } else {
                child.wait().map(portable_exit_code).unwrap_or(-1)
            };
            worker_exited.store(true, std::sync::atomic::Ordering::Release);
            let _ = exit_sender.send(exit_code);
        });

        let session_id_clone = session_id.clone();
        let reader_readiness = readiness.clone();
        let reader_terminate = terminate_sender.clone();
        thread::spawn(move || match output {
            PtyOutput::Legacy(channel) => pty_reader_thread(
                reader,
                channel,
                shutdown_clone,
                session_id_clone,
                exit_receiver,
            ),
            PtyOutput::Desktop(output) => {
                if desktop_reader_thread_with_readiness(
                    reader,
                    output.clone(),
                    shutdown_clone,
                    exit_receiver,
                    reader_readiness,
                )
                .is_err()
                {
                    if let Ok(mut output) = output.lock() {
                        output.stop();
                    }
                    let _ = reader_terminate.send(());
                }
            }
        });

        let session = PtySession {
            master: pair.master,
            child_killer,
            desktop_terminate: durable.then_some(terminate_sender),
            child_exited,
            writer,
            desktop_input,
            reader_shutdown: shutdown_flag,
            readiness,
        };

        let result = PtyCreateResult {
            pid,
            session_id: session_id.clone(),
        };

        self.sessions.insert(session_id, session);

        Ok(result)
    }

    pub fn send_input(&mut self, session_id: &str, data: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| session_not_found_err(session_id))?;

        let writer = session
            .writer
            .as_mut()
            .ok_or("Terminal writer is unavailable.")?;
        writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write to PTY: {}", e))?;

        writer
            .flush()
            .map_err(|e| format!("Failed to flush PTY writer: {}", e))?;

        Ok(())
    }

    fn queue_desktop_input(
        &self,
        session_id: &str,
        data: &str,
    ) -> Result<DesktopInputCompletion, String> {
        if data.len() > MAX_DESKTOP_PROFILE_PTY_INPUT_BYTES {
            return Err("Desktop terminal input is too large.".into());
        }
        let sender = self
            .sessions
            .get(session_id)
            .and_then(|session| session.desktop_input.as_ref())
            .ok_or("Desktop terminal session is unavailable.")?;
        let (complete, result) = std::sync::mpsc::sync_channel(1);
        sender
            .try_send((data.to_owned(), complete))
            .map_err(|_| "Desktop terminal input is busy or closed.".to_string())?;
        Ok(result)
    }

    pub fn resize(&mut self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| session_not_found_err(session_id))?;

        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize PTY: {}", e))?;

        Ok(())
    }

    pub fn kill(&mut self, session_id: &str) -> Result<(), String> {
        let mut session = self
            .sessions
            .remove(session_id)
            .ok_or_else(|| session_not_found_err(session_id))?;

        session
            .reader_shutdown
            .store(true, std::sync::atomic::Ordering::Relaxed);
        if let Some(readiness) = &session.readiness {
            readiness.cancel();
        }

        if let Some(terminate) = session.desktop_terminate {
            // A disconnected receiver means the retained child was already reaped.
            let _ = terminate.send(());
            return Ok(());
        }
        session
            .child_killer
            .kill()
            .map_err(|e| format!("Failed to kill PTY child: {}", e))?;

        Ok(())
    }

    pub fn stop_all(&mut self) {
        let session_ids: Vec<String> = self.sessions.keys().cloned().collect();
        for id in session_ids {
            if let Err(e) = self.kill(&id) {
                log::warn!("Failed to kill PTY session '{}': {}", id, e);
            }
        }
    }
}

struct DesktopSession {
    info: DesktopProfilePtyCreateResult,
    client_id: String,
    grant_id: String,
    output: DesktopOutput,
}

pub struct DesktopProfilePtyManager {
    manager: PtyManager,
    sessions: HashMap<String, DesktopSession>,
    closed_clients: HashSet<String>,
    owner: Option<String>,
    generation: u64,
}
pub type DesktopProfilePtyState = Arc<std::sync::Mutex<DesktopProfilePtyManager>>;
pub fn new_desktop_profile_pty_state() -> DesktopProfilePtyState {
    Arc::new(std::sync::Mutex::new(DesktopProfilePtyManager::new()))
}
impl DesktopProfilePtyManager {
    pub fn new() -> Self {
        Self {
            manager: PtyManager::new(),
            sessions: HashMap::new(),
            closed_clients: HashSet::new(),
            owner: None,
            generation: 0,
        }
    }
    pub fn owner_changes(&self, owner: &str) -> bool {
        self.owner
            .as_deref()
            .is_some_and(|current| current != owner)
    }
    pub fn grant_for_client(&self, client_id: &str) -> Option<String> {
        self.sessions
            .values()
            .find(|session| session.client_id == client_id)
            .map(|session| session.grant_id.clone())
    }
    pub fn synchronize_owner(&mut self, owner: String) -> u64 {
        if self.owner.as_ref() != Some(&owner) {
            self.revoke_owner();
            self.owner = Some(owner);
        }
        self.generation
    }
    pub fn revoke_owner(&mut self) {
        self.stop_all();
        self.owner = None;
        self.generation += 1;
        self.closed_clients.clear();
    }
    pub fn authorize(&self, owner: &str, generation: u64) -> Result<(), String> {
        if self.owner.as_deref() != Some(owner) || self.generation != generation {
            return Err("Desktop terminal ownership expired. Reconnect after signing in.".into());
        }
        Ok(())
    }
    pub fn existing(
        &mut self,
        client_id: &str,
        profile: &str,
        restart: bool,
        attachment_id: String,
        channel: Channel<DesktopTerminalEvent>,
    ) -> Result<Option<DesktopProfilePtyCreateResult>, String> {
        if self.closed_clients.contains(client_id) {
            return Err("This terminal tab was closed.".into());
        }
        let existing = self
            .sessions
            .iter()
            .find(|(_, session)| session.client_id == client_id)
            .map(|(id, _)| id.clone());
        if let Some(id) = existing {
            if restart {
                self.remove(&id)?;
            } else {
                let session = &self.sessions[&id];
                if session.info.profile != profile {
                    return Err("Terminal profile does not match its session.".into());
                }
                session
                    .output
                    .lock()
                    .map_err(|_| "Terminal output unavailable.")?
                    .attach(attachment_id, channel);
                return Ok(Some(session.info.clone()));
            }
        }
        Ok(None)
    }
    pub fn create(
        &mut self,
        session_id: String,
        client_id: String,
        grant_id: String,
        launch: DesktopTerminalProfileLaunch,
        cols: u16,
        rows: u16,
        cwd: &Path,
        attachment_id: String,
        channel: Channel<DesktopTerminalEvent>,
    ) -> Result<DesktopProfilePtyCreateResult, String> {
        if self.closed_clients.contains(&client_id) {
            return Err("This terminal tab was closed.".into());
        }
        if self.closed_clients.len() >= MAX_CLOSED_DESKTOP_TABS {
            return Err("This desktop session has closed too many terminal tabs. Restart RIFT Desktop to open another.".into());
        }
        // Exited terminals remain replayable until closed; the cap bounds both
        // running processes and retained history without silently losing tabs.
        if self.sessions.len() >= MAX_DESKTOP_PROFILE_PTY_SESSIONS {
            return Err(format!("Desktop terminals are limited to {MAX_DESKTOP_PROFILE_PTY_SESSIONS} sessions. Close an existing tab first."));
        }
        let output = Arc::new(std::sync::Mutex::new(DesktopTerminalOutput::new(
            DESKTOP_REPLAY_BYTES,
        )));
        output
            .lock()
            .map_err(|_| "Terminal output unavailable.")?
            .attach(attachment_id, channel);
        let result = self.manager.create_program(
            session_id.clone(),
            &launch.executable,
            &launch.args,
            cols,
            rows,
            cwd,
            output.clone(),
        )?;
        let info = DesktopProfilePtyCreateResult {
            cwd: cwd.to_string_lossy().into_owned(),
            pid: result.pid,
            session_id: session_id.clone(),
            profile: launch.profile,
            runtime_label: launch.runtime_label,
        };
        self.sessions.insert(
            session_id,
            DesktopSession {
                info: info.clone(),
                client_id,
                grant_id,
                output,
            },
        );
        Ok(info)
    }
    pub fn detach(&mut self, session_id: &str, attachment_id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.get(session_id) {
            session
                .output
                .lock()
                .map_err(|_| "Terminal output unavailable.")?
                .detach(attachment_id);
        }
        Ok(())
    }
    pub fn acknowledge(
        &mut self,
        session_id: &str,
        attachment_id: &str,
        cursor: u64,
    ) -> Result<(), String> {
        self.sessions
            .get(session_id)
            .ok_or("Desktop terminal session is unavailable.")?
            .output
            .lock()
            .map_err(|_| "Terminal output unavailable.")?
            .acknowledge(attachment_id, cursor)
    }
    pub fn read_output(
        &mut self,
        session_id: &str,
        attachment_id: &str,
        cursor: u64,
    ) -> Result<DesktopTerminalRead, String> {
        self.sessions
            .get(session_id)
            .ok_or("Desktop terminal session is unavailable.")?
            .output
            .lock()
            .map_err(|_| "Terminal output unavailable.")?
            .read(attachment_id, cursor)
    }
    #[cfg(test)]
    pub fn send_input(&mut self, session_id: &str, data: &str) -> Result<(), String> {
        self.queue_input(session_id, data)?
            .recv_timeout(std::time::Duration::from_secs(2))
            .map_err(|_| "Test input did not finish.".to_string())?
    }
    pub fn queue_input(
        &self,
        session_id: &str,
        data: &str,
    ) -> Result<DesktopInputCompletion, String> {
        if !self.sessions.contains_key(session_id) {
            return Err("Desktop terminal session is unavailable.".into());
        }
        self.manager.queue_desktop_input(session_id, data)
    }
    pub fn resize(&mut self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        if !self.sessions.contains_key(session_id) {
            return Err("Desktop terminal session is unavailable.".into());
        }
        self.manager.resize(session_id, cols, rows)
    }
    fn remove(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.remove(session_id) {
            if let Ok(mut output) = session.output.lock() {
                output.stop();
            }
            self.manager.kill(session_id)?;
        }
        Ok(())
    }
    pub fn kill(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.get(session_id) {
            if self.closed_clients.len() < MAX_CLOSED_DESKTOP_TABS {
                self.closed_clients.insert(session.client_id.clone());
            }
        }
        self.remove(session_id)
    }
    pub fn close_client(&mut self, client_id: String) -> Result<(), String> {
        // Never evict a revocation: at the cap new spawns fail closed, while
        // existing tabs can still attach and close. This also bounds bogus IDs.
        if self.closed_clients.len() < MAX_CLOSED_DESKTOP_TABS {
            self.closed_clients.insert(client_id.clone());
        }
        let id = self
            .sessions
            .iter()
            .find(|(_, session)| session.client_id == client_id)
            .map(|(id, _)| id.clone());
        if let Some(id) = id {
            self.remove(&id)?;
        }
        Ok(())
    }
    pub fn kill_for_grant(&mut self, grant_id: &str) {
        let ids: Vec<_> = self
            .sessions
            .iter()
            .filter(|(_, s)| s.grant_id == grant_id)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            let _ = self.kill(&id);
        }
    }
    pub fn stop_all(&mut self) {
        let completions: Vec<_> = self
            .manager
            .sessions
            .values()
            .map(|session| session.child_exited.clone())
            .collect();
        let ids: Vec<_> = self.sessions.keys().cloned().collect();
        for id in ids {
            let _ = self.remove(&id);
        }
        self.manager.stop_all();
        // Quit/sign-out must not finish while the native worker still owns a
        // HUP-resistant child. Kill requests are issued together, so the bound
        // applies to the batch rather than once per tab.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while completions
            .iter()
            .any(|done| !done.load(std::sync::atomic::Ordering::Acquire))
        {
            if std::time::Instant::now() >= deadline {
                log::warn!("Desktop terminal shutdown did not complete within its grace period");
                break;
            }
            thread::sleep(std::time::Duration::from_millis(5));
        }
    }
}

fn finish_desktop_output(output: &DesktopOutput, exit_code: i32) {
    let Ok(state) = output.lock() else { return };
    let changed = state.changed.clone();
    // EOF may complete a partial UTF-8 character after an attachment replaced
    // us during the OS read. Reserve that final replacement character too.
    let Ok(mut state) = changed.wait_while(state, |state| {
        !state.stopped && !state.pending_utf8.is_empty() && state.reader_blocked()
    }) else {
        return;
    };
    if !state.stopped {
        state.finish(exit_code);
    }
}

#[cfg(test)]
fn desktop_reader_thread(
    reader: Box<dyn Read + Send>,
    output: DesktopOutput,
    shutdown: Arc<std::sync::atomic::AtomicBool>,
    exit_receiver: std::sync::mpsc::Receiver<i32>,
) {
    desktop_reader_thread_with_readiness(reader, output, shutdown, exit_receiver, None).unwrap();
}

fn desktop_reader_thread_with_readiness(
    mut reader: Box<dyn Read + Send>,
    output: DesktopOutput,
    shutdown: Arc<std::sync::atomic::AtomicBool>,
    exit_receiver: std::sync::mpsc::Receiver<i32>,
    readiness: Option<Arc<DesktopIoReadiness>>,
) -> std::io::Result<()> {
    let mut buf = [0; DESKTOP_READ_BYTES];
    loop {
        // Only the dedicated reader waits. Condvar releases the output mutex;
        // ACK, detach, replacement and revoke never wait behind this reader.
        {
            let Ok(state) = output.lock() else { break };
            let changed = state.changed.clone();
            let Ok(state) =
                changed.wait_while(state, |state| !state.stopped && state.reader_blocked())
            else {
                break;
            };
            if state.stopped {
                break;
            }
        }
        if shutdown.load(std::sync::atomic::Ordering::Acquire) {
            break;
        }
        match reader.read(&mut buf) {
            Ok(0) => {
                let code = exit_receiver.recv().unwrap_or(-1);
                finish_desktop_output(&output, code);
                break;
            }
            Ok(n) => {
                let Ok(state) = output.lock() else { break };
                let changed = state.changed.clone();
                // A replacement attachment may pin the entire replay while
                // this read was in the OS. Recheck credit before publication.
                let Ok(mut state) =
                    changed.wait_while(state, |state| !state.stopped && state.reader_blocked())
                else {
                    break;
                };
                if state.stopped {
                    break;
                }
                state.write(&buf[..n]);
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if let Some(readiness) = &readiness {
                    if !readiness.wait(DesktopIoInterest::Read)? {
                        break;
                    }
                } else {
                    thread::sleep(std::time::Duration::from_millis(5));
                }
            }
            Err(_) => {
                let code = exit_receiver.recv().unwrap_or(-1);
                finish_desktop_output(&output, code);
                break;
            }
        }
    }
    Ok(())
}

fn shell_program_for_environment() -> &'static str {
    #[cfg(windows)]
    {
        "cmd.exe"
    }
    #[cfg(not(windows))]
    {
        "/bin/zsh"
    }
}

fn pty_reader_thread(
    mut reader: Box<dyn Read + Send>,
    on_data: Channel<String>,
    shutdown: Arc<std::sync::atomic::AtomicBool>,
    session_id: String,
    exit_receiver: std::sync::mpsc::Receiver<i32>,
) {
    let mut buf = [0u8; 4096];
    let mut output_buffer = Vec::with_capacity(OUTPUT_BUFFER_MAX_BYTES);

    loop {
        if shutdown.load(std::sync::atomic::Ordering::Relaxed) {
            break;
        }

        match reader.read(&mut buf) {
            Ok(0) => {
                // EOF -- drain buffered output before publishing the actual
                // child status. recv() only blocks this dedicated reader
                // thread, never the Tauri command/event loop.
                flush_buffer(&on_data, &mut output_buffer);
                send_exit(&on_data, exit_receiver.recv().unwrap_or(-1), &session_id);
                break;
            }
            Ok(n) => {
                output_buffer.extend_from_slice(&buf[..n]);

                // For interactive PTY, flush immediately after every read to
                // minimize latency. The server's idle timer needs to see output
                // as soon as it arrives. Batching caused prompts to arrive late,
                // after the idle timer had already fired.
                if !output_buffer.is_empty() {
                    let chunk = String::from_utf8_lossy(&output_buffer).to_string();
                    if on_data.send(chunk).is_err() {
                        // IPC channel closed (window gone / subscription dropped):
                        // no point reading further — bail so the thread exits.
                        log::debug!(
                            "PTY reader channel closed for session '{}', exiting reader",
                            session_id
                        );
                        break;
                    }
                    output_buffer.clear();
                }
            }
            Err(e) => {
                log::warn!("PTY reader error for session '{}': {}", session_id, e);
                flush_buffer(&on_data, &mut output_buffer);
                send_exit(&on_data, -1, &session_id);
                break;
            }
        }
    }
}

fn portable_exit_code(status: portable_pty::ExitStatus) -> i32 {
    i32::try_from(status.exit_code()).unwrap_or(-1)
}

fn session_not_found_err(id: &str) -> String {
    format!("Session '{}' not found", id)
}

fn flush_buffer(on_data: &Channel<String>, buf: &mut Vec<u8>) {
    if buf.is_empty() {
        return;
    }
    let chunk = String::from_utf8_lossy(buf).to_string();
    let _ = on_data.send(chunk);
    buf.clear();
}

fn send_exit(on_data: &Channel<String>, exit_code: i32, session_id: &str) {
    let msg = serde_json::json!({
        "type": "exit",
        "exitCode": exit_code,
        "sessionId": session_id,
    })
    .to_string();
    let _ = on_data.send(msg);
}

/// Get the default shell for the current platform.
fn get_default_shell() -> String {
    let config = platform::get_shell_config();
    config.shell
}

/// Get the flag used to execute a command string in the given shell.
fn get_shell_exec_flag(shell: &str) -> &'static str {
    if shell.contains("cmd") {
        "/C"
    } else {
        "-c"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reattaching_after_an_io_failure_reports_closed_without_reopening_output() {
        let mut output = DesktopTerminalOutput::new(DESKTOP_REPLAY_BYTES);
        output.write(b"retained before failure");
        output.stop();
        let (channel, events) = recording_channel();
        output.attach("late".into(), channel);
        assert!(output.subscriber.is_none());
        assert_eq!(
            events.lock().unwrap().as_slice(),
            &["{\"type\":\"closed\"}"]
        );
    }

    #[cfg(unix)]
    fn wait_for_test(condition: impl Fn() -> bool) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while !condition() {
            assert!(
                std::time::Instant::now() < deadline,
                "condition did not become ready"
            );
            thread::sleep(std::time::Duration::from_millis(1));
        }
    }

    #[cfg(unix)]
    #[test]
    fn sticky_cancellation_wakes_idle_reader_and_full_writer_without_timer_retries() {
        use std::os::fd::AsRawFd;
        use std::sync::atomic::Ordering;
        let (mut master, _peer) = std::os::unix::net::UnixStream::pair().unwrap();
        master.set_nonblocking(true).unwrap();
        // Make POLLOUT false, while the other direction also has no POLLIN.
        loop {
            match master.write(&[b'x'; 65536]) {
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(error) => panic!("{error}"),
            }
        }
        let readiness = Arc::new(DesktopIoReadiness::new(master.as_raw_fd()).unwrap());
        for fd in [
            readiness.master.as_raw_fd(),
            readiness.cancelled_peer.as_raw_fd(),
            readiness.cancel_signal.as_raw_fd(),
        ] {
            assert_ne!(
                unsafe { libc::fcntl(fd, libc::F_GETFD) } & libc::FD_CLOEXEC,
                0
            );
        }
        // The owned duplicate remains valid after the original descriptor closes.
        drop(master);
        let (done_sender, done) = std::sync::mpsc::channel();
        for interest in [DesktopIoInterest::Read, DesktopIoInterest::Write] {
            let readiness = readiness.clone();
            let done_sender = done_sender.clone();
            thread::spawn(move || {
                done_sender.send(readiness.wait(interest).unwrap()).unwrap();
            });
        }
        wait_for_test(|| {
            readiness.read_waits.load(Ordering::Relaxed) == 1
                && readiness.write_waits.load(Ordering::Relaxed) == 1
        });
        assert!(matches!(
            done.recv_timeout(std::time::Duration::from_millis(100)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ));
        assert_eq!(readiness.read_waits.load(Ordering::Relaxed), 1);
        assert_eq!(readiness.write_waits.load(Ordering::Relaxed), 1);
        readiness.cancel();
        readiness.cancel();
        assert!(!done
            .recv_timeout(std::time::Duration::from_secs(1))
            .unwrap());
        assert!(!done
            .recv_timeout(std::time::Duration::from_secs(1))
            .unwrap());
        assert!(!readiness.wait(DesktopIoInterest::Read).unwrap());
        assert!(!readiness.wait(DesktopIoInterest::Write).unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn cancellation_before_wait_wins_over_ready_data() {
        use std::os::fd::AsRawFd;
        let (master, mut peer) = std::os::unix::net::UnixStream::pair().unwrap();
        let readiness = DesktopIoReadiness::new(master.as_raw_fd()).unwrap();
        peer.write_all(b"already ready").unwrap();
        readiness.cancel();
        assert!(!readiness.wait(DesktopIoInterest::Read).unwrap());
        assert!(!readiness.wait(DesktopIoInterest::Write).unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn ready_hangup_drains_buffered_utf8_before_exit() {
        use std::os::fd::AsRawFd;
        use std::sync::atomic::Ordering;
        let (master, mut peer) = std::os::unix::net::UnixStream::pair().unwrap();
        master.set_nonblocking(true).unwrap();
        let readiness = Arc::new(DesktopIoReadiness::new(master.as_raw_fd()).unwrap());
        let output = Arc::new(std::sync::Mutex::new(DesktopTerminalOutput::new(
            DESKTOP_REPLAY_BYTES,
        )));
        let (channel, events) = recording_channel();
        output.lock().unwrap().attach("test".into(), channel);
        let (exit_sender, exit_receiver) = std::sync::mpsc::channel();
        exit_sender.send(19).unwrap();
        let reader_output = output.clone();
        let reader_readiness = readiness.clone();
        let (done_sender, done) = std::sync::mpsc::channel();
        thread::spawn(move || {
            let result = desktop_reader_thread_with_readiness(
                Box::new(master),
                reader_output,
                Arc::new(std::sync::atomic::AtomicBool::new(false)),
                exit_receiver,
                Some(reader_readiness),
            );
            done_sender.send(result).unwrap();
        });
        wait_for_test(|| readiness.read_waits.load(Ordering::Relaxed) == 1);
        peer.write_all("last λ🙂 bytes".as_bytes()).unwrap();
        drop(peer);
        done.recv_timeout(std::time::Duration::from_secs(1))
            .unwrap()
            .unwrap();
        assert_eq!(
            render_available(&mut output.lock().unwrap(), "test"),
            "last λ🙂 bytes"
        );
        assert!(events.lock().unwrap().last().unwrap().contains("19"));
    }

    #[cfg(unix)]
    #[test]
    fn actual_idle_pty_uses_one_readiness_wait_and_close_releases_waiters() {
        use std::sync::atomic::Ordering;
        let mut manager = DesktopProfilePtyManager::new();
        manager.synchronize_owner("account".into());
        let (channel, messages) = recording_channel();
        let launch = DesktopTerminalProfileLaunch {
            profile: "shell",
            runtime_label: "test",
            executable: "/bin/sh".into(),
            args: vec!["-c".into(), "exec sleep 60".into()],
        };
        let info = manager
            .create(
                "idle_process".into(),
                "idle_tab".into(),
                "grant".into(),
                launch,
                80,
                24,
                &std::env::temp_dir(),
                "idle".into(),
                channel,
            )
            .unwrap();
        let readiness = manager.manager.sessions[&info.session_id]
            .readiness
            .clone()
            .unwrap();
        wait_for_test(|| readiness.read_waits.load(Ordering::Relaxed) >= 1);
        let waits = readiness.read_waits.load(Ordering::Relaxed);
        thread::sleep(std::time::Duration::from_millis(150));
        assert_eq!(readiness.read_waits.load(Ordering::Relaxed), waits);
        assert_eq!(readiness.write_waits.load(Ordering::Relaxed), 0);
        let weak = Arc::downgrade(&readiness);
        manager.close_client("idle_tab".into()).unwrap();
        assert!(readiness.cancelled.load(Ordering::Acquire));
        drop(readiness);
        wait_for_test(|| weak.upgrade().is_none());
        assert!(messages.lock().unwrap().last().unwrap().contains("closed"));
    }

    #[test]
    fn stalled_renderer_bounds_channel_and_reader_then_detach_unblocks() {
        let output = Arc::new(std::sync::Mutex::new(DesktopTerminalOutput::new(
            DESKTOP_REPLAY_BYTES,
        )));
        let (channel, messages) = recording_channel();
        output.lock().unwrap().attach("stalled".into(), channel);
        let (exit_sender, exit_receiver) = std::sync::mpsc::channel();
        exit_sender.send(0).unwrap();
        let (done_sender, done) = std::sync::mpsc::channel();
        let reader_output = output.clone();
        thread::spawn(move || {
            desktop_reader_thread(
                Box::new(std::io::Cursor::new(vec![b'x'; 2 * 1024 * 1024])),
                reader_output,
                Arc::new(std::sync::atomic::AtomicBool::new(false)),
                exit_receiver,
            );
            done_sender.send(()).unwrap();
        });
        thread::sleep(std::time::Duration::from_millis(100));
        let sent = messages.lock().unwrap().len();
        // Always release the worker, including when testing the old failure.
        output.lock().unwrap().detach("stalled");
        done.recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        assert_eq!(sent, 1, "a stalled renderer must retain only one IPC batch");
        assert!(output.lock().unwrap().replay_bytes <= DESKTOP_REPLAY_BYTES);
        let (channel, restored) = recording_channel();
        let mut state = output.lock().unwrap();
        state.attach("restored".into(), channel);
        let retained = state.replay_bytes;
        assert_eq!(
            render_available(&mut state, "restored"),
            "x".repeat(retained)
        );
        assert!(restored
            .lock()
            .unwrap()
            .first()
            .unwrap()
            .contains("truncated"));
    }

    fn recording_channel() -> (
        Channel<DesktopTerminalEvent>,
        Arc<std::sync::Mutex<Vec<String>>>,
    ) {
        let messages = Arc::new(std::sync::Mutex::new(Vec::new()));
        let output = messages.clone();
        (
            Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                    output.lock().unwrap().push(json);
                }
                Ok(())
            }),
            messages,
        )
    }

    fn render_available(output: &mut DesktopTerminalOutput, attachment: &str) -> String {
        let mut text = String::new();
        loop {
            let current = output.subscriber.as_ref().unwrap();
            if current.sent == current.acknowledged {
                break;
            }
            let cursor = current.sent;
            let batch = output.read(attachment, cursor).unwrap();
            assert!(batch.data.len() <= DESKTOP_OUTPUT_WINDOW_BYTES);
            text.push_str(&batch.data);
            output.acknowledge(attachment, cursor).unwrap();
        }
        text
    }

    #[test]
    fn read_and_ack_reject_stale_future_unread_and_replaced_cursors() {
        let mut output = DesktopTerminalOutput::new(DESKTOP_REPLAY_BYTES);
        let (channel, _) = recording_channel();
        output.attach("old".into(), channel);
        output.write(b"first");
        assert!(output.acknowledge("old", 5).is_err()); // not read yet
        assert!(output.read("old", 6).is_err());
        assert!(output.read("other", 5).is_err());
        assert_eq!(output.read("old", 5).unwrap().data, "first");
        assert!(output.read("old", 5).is_err()); // no duplicated payload
        assert!(output.acknowledge("old", 4).is_err());
        assert!(output.acknowledge("old", 6).is_err());
        output.acknowledge("old", 5).unwrap();
        assert!(output.acknowledge("old", 5).is_err());
        output.write(b"second");
        let (channel, _) = recording_channel();
        output.attach("new".into(), channel);
        assert!(output.acknowledge("old", 11).is_err());
        assert!(output.read("old", 11).is_err());
        output.detach("old");
        assert_eq!(render_available(&mut output, "new"), "firstsecond");
    }

    #[test]
    fn finite_burst_round_trips_byte_for_byte_after_replacing_a_stalled_attachment() {
        let expected = "λ🙂\r\n\u{1b}[31mred\u{1b}[0m".repeat(100_000);
        let output = Arc::new(std::sync::Mutex::new(DesktopTerminalOutput::new(
            DESKTOP_REPLAY_BYTES,
        )));
        let (channel, old_messages) = recording_channel();
        output.lock().unwrap().attach("old".into(), channel);
        let (sender, receiver) = std::sync::mpsc::channel();
        sender.send(23).unwrap();
        let source = expected.as_bytes().to_vec();
        let reader_output = output.clone();
        let worker = thread::spawn(move || {
            desktop_reader_thread(
                Box::new(std::io::Cursor::new(source)),
                reader_output,
                Arc::new(std::sync::atomic::AtomicBool::new(false)),
                receiver,
            )
        });
        thread::sleep(std::time::Duration::from_millis(50));
        assert_eq!(old_messages.lock().unwrap().len(), 1);
        assert!(output.lock().unwrap().sequence <= DESKTOP_OUTPUT_WINDOW_BYTES as u64);
        let (channel, messages) = recording_channel();
        output.lock().unwrap().attach("new".into(), channel);
        output.lock().unwrap().detach("old");
        let mut actual = String::new();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            let mut state = output.lock().unwrap();
            actual.push_str(&render_available(&mut state, "new"));
            assert!(state.replay_bytes <= DESKTOP_REPLAY_BYTES);
            if state.exit_code.is_some() {
                break;
            }
            if std::time::Instant::now() >= deadline {
                state.stop();
                panic!("burst did not drain");
            }
            drop(state);
            thread::sleep(std::time::Duration::from_millis(1));
        }
        worker.join().unwrap();
        assert_eq!(actual, expected);
        let messages = messages.lock().unwrap();
        assert!(messages.iter().all(|message| message.len() < 8192));
        assert!(messages.last().unwrap().contains("23"));
    }

    #[test]
    fn attachment_during_os_read_preserves_replay_bound_and_stop_wakes_reader() {
        struct GatedReader {
            entered: std::sync::mpsc::Sender<()>,
            release: std::sync::mpsc::Receiver<()>,
        }
        impl Read for GatedReader {
            fn read(&mut self, bytes: &mut [u8]) -> std::io::Result<usize> {
                self.entered.send(()).unwrap();
                self.release.recv().unwrap();
                bytes.fill(b'y');
                Ok(bytes.len())
            }
        }
        let output = Arc::new(std::sync::Mutex::new(DesktopTerminalOutput::new(
            DESKTOP_REPLAY_BYTES,
        )));
        for _ in 0..DESKTOP_REPLAY_BYTES / DESKTOP_READ_BYTES {
            output.lock().unwrap().write(&[b'x'; DESKTOP_READ_BYTES]);
        }
        let (entered_sender, entered) = std::sync::mpsc::channel();
        let (release, release_receiver) = std::sync::mpsc::channel();
        let (_exit_sender, exit_receiver) = std::sync::mpsc::channel();
        let (done_sender, done) = std::sync::mpsc::channel();
        let reader_output = output.clone();
        thread::spawn(move || {
            desktop_reader_thread(
                Box::new(GatedReader {
                    entered: entered_sender,
                    release: release_receiver,
                }),
                reader_output,
                Arc::new(std::sync::atomic::AtomicBool::new(false)),
                exit_receiver,
            );
            done_sender.send(()).unwrap();
        });
        entered
            .recv_timeout(std::time::Duration::from_secs(1))
            .unwrap();
        let (channel, messages) = recording_channel();
        output.lock().unwrap().attach("new".into(), channel);
        release.send(()).unwrap();
        thread::sleep(std::time::Duration::from_millis(50));
        let mut state = output.lock().unwrap();
        assert_eq!(state.replay_bytes, DESKTOP_REPLAY_BYTES);
        assert_eq!(state.sequence, DESKTOP_REPLAY_BYTES as u64);
        state.stop();
        drop(state);
        done.recv_timeout(std::time::Duration::from_secs(1))
            .unwrap();
        assert!(messages.lock().unwrap().last().unwrap().contains("closed"));
    }

    #[cfg(unix)]
    #[test]
    fn blocked_desktop_input_does_not_block_ack_or_revocation() {
        let mut manager = DesktopProfilePtyManager::new();
        let generation = manager.synchronize_owner("account".into());
        let launch = DesktopTerminalProfileLaunch {
            profile: "shell",
            runtime_label: "test",
            executable: "/bin/sh".into(),
            // Raw input ensures write really blocks instead of canonical line
            // discipline dropping long lines. This child never consumes stdin.
            args: vec![
                "-c".into(),
                "stty raw -echo; while :; do printf 0123456789abcdef; done".into(),
            ],
        };
        let (channel, messages) = recording_channel();
        let info = manager
            .create(
                "blocked_process".into(),
                "tab".into(),
                "grant".into(),
                launch,
                80,
                24,
                &std::env::temp_dir(),
                "stalled".into(),
                channel,
            )
            .unwrap();
        let output = manager.sessions[&info.session_id].output.clone();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while !output.lock().unwrap().reader_blocked() {
            if std::time::Instant::now() >= deadline {
                manager.stop_all();
                panic!("output never filled");
            }
            thread::sleep(std::time::Duration::from_millis(5));
        }
        let completion = manager
            .queue_input(
                &info.session_id,
                &"i".repeat(MAX_DESKTOP_PROFILE_PTY_INPUT_BYTES),
            )
            .unwrap();
        assert!(matches!(
            completion.recv_timeout(std::time::Duration::from_millis(50)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ));
        let readiness = manager.manager.sessions[&info.session_id]
            .readiness
            .clone()
            .unwrap();
        let waits = readiness
            .write_waits
            .load(std::sync::atomic::Ordering::Relaxed);
        assert!(waits > 0, "the blocked input must enter the readiness wait");
        thread::sleep(std::time::Duration::from_millis(50));
        assert_eq!(
            readiness
                .write_waits
                .load(std::sync::atomic::Ordering::Relaxed),
            waits
        );
        let queued = manager
            .queue_input(
                &info.session_id,
                &"j".repeat(MAX_DESKTOP_PROFILE_PTY_INPUT_BYTES),
            )
            .unwrap();
        assert!(manager
            .queue_input(&info.session_id, "queue is full")
            .is_err());
        let cursor = output.lock().unwrap().subscriber.as_ref().unwrap().sent;
        manager.authorize("account", generation).unwrap();
        manager
            .read_output(&info.session_id, "stalled", cursor)
            .unwrap();
        manager
            .acknowledge(&info.session_id, "stalled", cursor)
            .unwrap();
        assert!(manager
            .read_output("stale_process", "stalled", cursor)
            .is_err());
        manager.kill_for_grant("grant");
        completion
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap()
            .unwrap_err();
        queued
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap()
            .unwrap_err();
        assert!(output.lock().unwrap().stopped);
        assert!(messages.lock().unwrap().last().unwrap().contains("closed"));
        assert!(manager.sessions.is_empty());
        manager.revoke_owner();
        assert!(manager.authorize("account", generation).is_err());
    }

    #[test]
    fn desktop_input_partial_writes_retry_without_duplication_and_cancel_when_full() {
        struct PartialWriter {
            bytes: Vec<u8>,
            calls: usize,
        }
        impl Write for PartialWriter {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.calls += 1;
                if self.calls % 2 == 0 {
                    return Err(std::io::ErrorKind::WouldBlock.into());
                }
                let count = bytes.len().min(3);
                self.bytes.extend_from_slice(&bytes[..count]);
                Ok(count)
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let shutdown = std::sync::atomic::AtomicBool::new(false);
        let mut writer = PartialWriter {
            bytes: Vec::new(),
            calls: 0,
        };
        write_desktop_input(&mut writer, "hello🙂world".as_bytes(), &shutdown, None).unwrap();
        assert_eq!(writer.bytes, "hello🙂world".as_bytes());
        shutdown.store(true, std::sync::atomic::Ordering::Release);
        assert!(write_desktop_input(&mut writer, b"ignored", &shutdown, None).is_err());
        assert_eq!(writer.bytes, "hello🙂world".as_bytes());
    }

    #[test]
    fn eof_partial_utf8_waits_for_replaced_attachment_credit_and_stop_cancels_it() {
        let output = Arc::new(std::sync::Mutex::new(DesktopTerminalOutput::new(
            DESKTOP_REPLAY_BYTES,
        )));
        for _ in 0..DESKTOP_REPLAY_BYTES / DESKTOP_READ_BYTES {
            output.lock().unwrap().write(&[b'x'; DESKTOP_READ_BYTES]);
        }
        output.lock().unwrap().write(&[0xf0]);
        let (channel, _) = recording_channel();
        output.lock().unwrap().attach("new".into(), channel);
        let (done_sender, done) = std::sync::mpsc::channel();
        let reader_output = output.clone();
        thread::spawn(move || {
            finish_desktop_output(&reader_output, 0);
            done_sender.send(()).unwrap();
        });
        assert!(matches!(
            done.recv_timeout(std::time::Duration::from_millis(50)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ));
        assert_eq!(output.lock().unwrap().replay_bytes, DESKTOP_REPLAY_BYTES);
        output.lock().unwrap().stop();
        done.recv_timeout(std::time::Duration::from_secs(1))
            .unwrap();
        assert_eq!(output.lock().unwrap().replay_bytes, DESKTOP_REPLAY_BYTES);
    }

    #[cfg(unix)]
    #[test]
    fn exited_terminal_replays_status_and_restart_replaces_only_its_incarnation() {
        let mut manager = DesktopProfilePtyManager::new();
        manager.synchronize_owner("account".into());
        let (channel, _) = recording_channel();
        manager
            .create(
                "old_process".into(),
                "tab".into(),
                "standalone-shell".into(),
                shell_launch().unwrap(),
                80,
                24,
                &std::env::temp_dir(),
                "old_attachment".into(),
                channel,
            )
            .unwrap();
        manager.send_input("old_process", "exit 19\r").unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while manager.sessions["old_process"]
            .output
            .lock()
            .unwrap()
            .exit_code
            .is_none()
        {
            if std::time::Instant::now() >= deadline {
                manager.stop_all();
                panic!("Shell did not exit");
            }
            thread::sleep(std::time::Duration::from_millis(10));
        }
        // The worker already reaped the child; close/restart only sees a closed
        // control channel, never a stored process ID to signal again.
        assert!(manager.manager.sessions["old_process"]
            .desktop_terminate
            .as_ref()
            .unwrap()
            .send(())
            .is_err());
        let (channel, replay) = recording_channel();
        assert!(manager
            .existing("tab", "shell", false, "new_attachment".into(), channel)
            .unwrap()
            .is_some());
        render_available(
            &mut manager.sessions["old_process"].output.lock().unwrap(),
            "new_attachment",
        );
        assert!(replay.lock().unwrap().last().unwrap().contains("19"));
        let (channel, _) = recording_channel();
        assert!(manager
            .existing("tab", "shell", true, "restart".into(), channel.clone())
            .unwrap()
            .is_none());
        manager
            .create(
                "new_process".into(),
                "tab".into(),
                "standalone-shell".into(),
                shell_launch().unwrap(),
                100,
                30,
                &std::env::temp_dir(),
                "restart".into(),
                channel,
            )
            .unwrap();
        assert_eq!(manager.sessions.len(), 1);
        assert!(manager.sessions.contains_key("new_process"));
        manager.close_client("tab".into()).unwrap();
        assert!(manager.sessions.is_empty());
    }

    #[test]
    fn closed_tab_tombstones_are_bounded_without_allowing_late_recreation() {
        let mut manager = DesktopProfilePtyManager::new();
        manager.synchronize_owner("account-a".into());
        for index in 0..5000 {
            manager.close_client(format!("closed_{index}")).unwrap();
        }
        assert!(manager.closed_clients.len() <= 4096);
        let (channel, _) = recording_channel();
        assert!(manager
            .existing("closed_0", "shell", false, "attach".into(), channel)
            .is_err());
        let (channel, _) = recording_channel();
        assert!(manager
            .create(
                "process".into(),
                "late_closed_4999".into(),
                "standalone-shell".into(),
                shell_launch().unwrap(),
                80,
                24,
                &std::env::temp_dir(),
                "attach".into(),
                channel
            )
            .is_err());
    }

    #[test]
    fn closed_channel_does_not_stop_reader_and_split_utf8_is_preserved() {
        let output = Arc::new(std::sync::Mutex::new(DesktopTerminalOutput::new(1024)));
        let failed = Channel::new(|_| {
            Err(std::io::Error::new(std::io::ErrorKind::BrokenPipe, "renderer gone").into())
        });
        output.lock().unwrap().attach("old".into(), failed);
        struct ByteReader(std::io::Cursor<Vec<u8>>);
        impl Read for ByteReader {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                self.0.read(&mut buf[..1])
            }
        }
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        sender.send(9).unwrap();
        desktop_reader_thread(
            Box::new(ByteReader(std::io::Cursor::new(
                "one🙂two".as_bytes().to_vec(),
            ))),
            output.clone(),
            Arc::new(std::sync::atomic::AtomicBool::new(false)),
            receiver,
        );
        let (channel, messages) = recording_channel();
        output.lock().unwrap().attach("new".into(), channel);
        let text = render_available(&mut output.lock().unwrap(), "new");
        let events: Vec<serde_json::Value> = messages
            .lock()
            .unwrap()
            .iter()
            .map(|s| serde_json::from_str(s).unwrap())
            .collect();
        assert_eq!(text, "one🙂two");
        assert_eq!(events.last().unwrap()["exitCode"], 9);
    }

    #[cfg(unix)]
    #[test]
    fn real_shell_retains_pid_and_variables_across_detach_and_revoke_kills_standalone() {
        let mut manager = DesktopProfilePtyManager::new();
        let owner = manager.synchronize_owner("account-a".into());
        let (channel, _) = recording_channel();
        let info = manager
            .create(
                "process_a".into(),
                "tab_a".into(),
                "standalone-shell".into(),
                shell_launch().unwrap(),
                80,
                24,
                &std::env::temp_dir(),
                "first".into(),
                channel,
            )
            .unwrap();
        manager.detach(&info.session_id, "first").unwrap();
        manager
            .send_input(
                &info.session_id,
                "trap '' HUP; RIFT_DURABLE_TEST=preserved; printf '\x64etached-value\n'\r",
            )
            .unwrap();
        let (channel, messages) = recording_channel();
        let attached = manager
            .existing("tab_a", "shell", false, "second".into(), channel)
            .unwrap()
            .unwrap();
        assert_eq!(attached.pid, info.pid);
        assert_eq!(attached.session_id, info.session_id);
        manager
            .send_input(
                &info.session_id,
                "printf 'value=%s\n' \"$RIFT_DURABLE_TEST\"\r",
            )
            .unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut text = String::new();
        loop {
            text.push_str(&render_available(
                &mut manager.sessions[&info.session_id].output.lock().unwrap(),
                "second",
            ));
            if text.contains("value=preserved") {
                break;
            }
            if std::time::Instant::now() >= deadline {
                manager.stop_all();
                panic!("Shell did not retain its variable: {text}");
            }
            thread::sleep(std::time::Duration::from_millis(10));
        }
        manager
            .send_input(
                &info.session_id,
                "trap '' HUP; printf '%s%s' RIFT_TRAP_ READY; while :; do sleep 1; done\r",
            )
            .unwrap();
        while !text.contains("RIFT_TRAP_READY") {
            text.push_str(&render_available(
                &mut manager.sessions[&info.session_id].output.lock().unwrap(),
                "second",
            ));
            if std::time::Instant::now() >= deadline {
                manager.stop_all();
                panic!("Trap test did not start");
            }
            thread::sleep(std::time::Duration::from_millis(10));
        }
        manager.revoke_owner();
        assert!(messages.lock().unwrap().last().unwrap().contains("closed"));
        assert!(manager.sessions.is_empty());
        assert!(manager.manager.sessions.is_empty());
        assert!(manager.authorize("account-a", owner).is_err());
        let pid = info.pid.unwrap() as i32;
        while unsafe { libc::kill(pid, 0) } == 0 {
            if std::time::Instant::now() >= deadline {
                unsafe {
                    libc::kill(pid, libc::SIGKILL);
                }
                panic!("Revocation left a HUP-trapping shell alive");
            }
            thread::sleep(std::time::Duration::from_millis(10));
        }
    }

    #[test]
    fn closing_a_pending_tab_prevents_late_spawn() {
        let mut manager = DesktopProfilePtyManager::new();
        manager.synchronize_owner("account-a".into());
        manager.close_client("pending_tab".into()).unwrap();
        let (channel, _) = recording_channel();
        assert!(manager
            .existing("pending_tab", "shell", false, "first".into(), channel)
            .is_err());
        assert!(manager.manager.sessions.is_empty());
    }

    #[test]
    fn desktop_output_survives_detach_and_replays_exit_in_order() {
        let mut output = DesktopTerminalOutput::new(32);
        let (channel, first) = recording_channel();
        output.attach("first".into(), channel);
        output.write(b"before ");
        output.detach("first");
        output.write(b"during");
        output.finish(17);
        let (channel, replay) = recording_channel();
        output.attach("second".into(), channel);
        assert_eq!(first.lock().unwrap().len(), 1);
        assert_eq!(replay.lock().unwrap().len(), 1);
        assert_eq!(render_available(&mut output, "second"), "before during");
        let replay = replay.lock().unwrap();
        assert_eq!(replay.len(), 2);
        assert!(replay[1].contains("17"));
    }

    #[test]
    fn stale_detach_cannot_remove_new_subscriber_and_replay_is_bounded() {
        let mut output = DesktopTerminalOutput::new(8);
        output.write(b"12345678");
        output.write(b"abcdefgh");
        let (first, _) = recording_channel();
        output.attach("first".into(), first);
        let (second, events) = recording_channel();
        output.attach("second".into(), second);
        output.detach("first");
        assert_eq!(render_available(&mut output, "second"), "abcdefgh");
        output.write(b"live");
        assert_eq!(render_available(&mut output, "second"), "live");
        let events = events.lock().unwrap();
        assert!(events.iter().all(|event| !event.contains("12345678")));
        assert!(events.first().unwrap().contains("truncated"));
        assert!(output.replay_bytes <= 8);
    }

    #[test]
    fn desktop_owner_revocation_rejects_old_generation_even_after_same_account_returns() {
        let mut manager = DesktopProfilePtyManager::new();
        let first = manager.synchronize_owner("account-a".into());
        assert!(manager.authorize("account-a", first).is_ok());
        manager.revoke_owner();
        assert!(manager.authorize("account-a", first).is_err());
        let next = manager.synchronize_owner("account-a".into());
        assert_ne!(next, first);
        assert!(manager.authorize("account-a", first).is_err());
        assert!(manager.authorize("account-b", next).is_err());
    }

    #[test]
    fn profile_allowlist_rejects_commands_and_unknown_profiles() {
        assert!(resolve_desktop_terminal_profile("sh -c whoami").is_none());
        assert!(resolve_desktop_terminal_profile("../../bin/sh").is_none());
        assert!(resolve_desktop_terminal_profile("unknown").is_none());
        assert!(resolve_desktop_terminal_profile("shell").is_some());
    }

    #[test]
    fn profile_session_contract_is_bounded() {
        assert!(valid_profile_session_id("desktop-session_01"));
        assert!(!valid_profile_session_id("session/../../escape"));
        assert!(!valid_profile_session_id(&"x".repeat(129)));
        assert!(valid_pty_geometry(120, 32));
        assert!(!valid_pty_geometry(1, 1));
        assert!(!valid_pty_geometry(501, 201));
    }

    #[test]
    fn portable_exit_status_preserves_non_zero_codes() {
        assert_eq!(
            portable_exit_code(portable_pty::ExitStatus::with_exit_code(17)),
            17
        );
        assert_eq!(
            portable_exit_code(portable_pty::ExitStatus::with_signal("TERM")),
            1
        );
    }
}
