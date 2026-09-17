/// Check if a path is executable (Unix: has execute permission).
#[cfg(not(windows))]
fn is_executable(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

/// Shell configuration for cross-platform command execution.
pub struct ShellConfig {
    pub shell: String,
    pub flag: &'static str,
    /// True when `shell` is `cmd.exe` and requires the verbatim-arg workaround
    /// for its non-MSVCRT quoting rules. Only consulted on Windows.
    #[allow(dead_code)]
    pub is_cmd: bool,
}

/// Get the shell for the current platform.
///
/// - **Windows:** prefer `bash.exe` from Git for Windows (POSIX semantics, no
///   cmd.exe quoting quirks). Override with `RIFT_BASH_PATH`. Falls back
///   to `cmd /C` when git-bash is not installed.
/// - **Unix:** the user's `$SHELL` without evaluating login profiles. The GUI
///   process receives a deterministic PATH from [`effective_path`] instead,
///   so common CLI locations work without executing arbitrary profile code.
pub fn get_shell_config() -> ShellConfig {
    #[cfg(windows)]
    {
        static WIN_SHELL: std::sync::OnceLock<(String, &'static str, bool)> =
            std::sync::OnceLock::new();
        let (shell, flag, is_cmd) = WIN_SHELL.get_or_init(|| {
            if let Some(bash) = find_git_bash() {
                (bash, "-c", false)
            } else {
                ("cmd".to_string(), "/C", true)
            }
        });
        return ShellConfig {
            shell: shell.clone(),
            flag,
            is_cmd: *is_cmd,
        };
    }
    #[cfg(not(windows))]
    {
        static USER_SHELL: std::sync::OnceLock<String> = std::sync::OnceLock::new();
        let shell = USER_SHELL.get_or_init(|| {
            use std::path::Path;
            let candidates = [
                std::env::var("SHELL").ok(),
                Some("/bin/sh".to_string()),
                Some("/bin/bash".to_string()),
                Some("/usr/bin/sh".to_string()),
                Some("/usr/bin/bash".to_string()),
            ];
            for candidate in candidates.into_iter().flatten() {
                let p = Path::new(&candidate);
                if p.is_file() && is_executable(p) {
                    return candidate;
                }
            }
            // Last resort — hope the OS can resolve "sh" via PATH
            "sh".to_string()
        });
        ShellConfig {
            shell: shell.clone(),
            flag: "-c",
            is_cmd: false,
        }
    }
}

#[cfg(not(windows))]
fn build_search_path(
    home: Option<&std::path::Path>,
    inherited: &std::ffi::OsStr,
) -> std::ffi::OsString {
    use std::collections::HashSet;
    use std::path::{Path, PathBuf};

    let mut paths = Vec::<PathBuf>::new();
    let mut seen = HashSet::<PathBuf>::new();
    let mut push = |path: PathBuf| {
        if path.is_absolute() && seen.insert(path.clone()) {
            paths.push(path);
        }
    };

    if let Some(home) = home.filter(|path| path.is_absolute()) {
        for suffix in [".local/bin", ".grok/bin", ".cargo/bin", ".bun/bin"] {
            push(home.join(suffix));
        }
    }
    for path in [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ] {
        push(Path::new(path).to_path_buf());
    }
    for path in std::env::split_paths(inherited) {
        push(path);
    }

    std::env::join_paths(paths).unwrap_or_else(|_| inherited.to_os_string())
}

/// PATH used by commands launched from a GUI process. macOS applications do
/// not inherit the interactive terminal's PATH, so explicitly include common
/// user and package-manager locations while discarding relative entries.
#[cfg(not(windows))]
pub fn effective_path() -> std::ffi::OsString {
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from);
    build_search_path(
        home.as_deref(),
        std::env::var_os("PATH").as_deref().unwrap_or_default(),
    )
}

#[cfg(windows)]
pub fn effective_path() -> std::ffi::OsString {
    let inherited = std::env::var_os("PATH").unwrap_or_default();
    let paths = std::env::split_paths(&inherited)
        .filter(|path| path.is_absolute())
        .collect::<Vec<_>>();
    std::env::join_paths(paths).unwrap_or(inherited)
}

/// Resolve one fixed executable name against the GUI-safe search path. The
/// caller chooses the name from a compile-time allowlist; no webview-provided
/// command or path reaches this function.
pub fn find_gui_executable(command: &str) -> Option<std::path::PathBuf> {
    if command.is_empty()
        || command.contains('/')
        || command.contains('\\')
        || command.contains('\0')
    {
        return None;
    }

    #[cfg(windows)]
    let names = [
        command.to_string(),
        format!("{command}.exe"),
        format!("{command}.cmd"),
        format!("{command}.bat"),
    ];
    #[cfg(not(windows))]
    let names = [command.to_string()];

    for directory in std::env::split_paths(&effective_path()) {
        for name in &names {
            let candidate = directory.join(name);
            #[cfg(not(windows))]
            let runnable = candidate.is_file() && is_executable(&candidate);
            #[cfg(windows)]
            let runnable = candidate.is_file();
            if runnable {
                return std::fs::canonicalize(&candidate).ok();
            }
        }
    }
    None
}

/// Locate `bash.exe` from Git for Windows. Tries:
///   1. `RIFT_BASH_PATH` env override
///   2. Common install locations
///   3. `where git` → `<gitDir>/../../bin/bash.exe`
#[cfg(windows)]
fn find_git_bash() -> Option<String> {
    use std::path::PathBuf;
    use std::process::Command as StdCommand;

    if let Ok(p) = std::env::var("RIFT_BASH_PATH") {
        if PathBuf::from(&p).exists() {
            return Some(p);
        }
    }

    let candidates = [
        "C:\\Program Files\\Git\\bin\\bash.exe",
        "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    ];
    for c in &candidates {
        if PathBuf::from(c).exists() {
            return Some((*c).to_string());
        }
    }

    if let Ok(out) = StdCommand::new("where").arg("git").output() {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            for line in stdout.lines() {
                let line = line.trim();
                if line.to_lowercase().ends_with("git.exe") {
                    // <gitDir>/cmd/git.exe → <gitDir>/bin/bash.exe
                    let p = PathBuf::from(line);
                    if let Some(git_dir) = p.parent().and_then(|d| d.parent()) {
                        let bash = git_dir.join("bin").join("bash.exe");
                        if bash.exists() {
                            return bash.to_str().map(|s| s.to_string());
                        }
                    }
                }
            }
        }
    }

    None
}

/// Build a `tokio::process::Command` from an exec request.
/// Centralizes shell selection, args, cwd, env, and stdio setup.
pub fn build_command(
    command: &str,
    cwd: Option<&str>,
    env: Option<&std::collections::HashMap<String, String>>,
) -> tokio::process::Command {
    let config = get_shell_config();
    let mut cmd = tokio::process::Command::new(&config.shell);

    #[cfg(windows)]
    {
        if config.is_cmd {
            // cmd.exe does not understand MSVCRT-style `\"` escaping that
            // Rust's std `Command::arg` applies on Windows. Use `raw_arg`
            // to pass the command line through verbatim, wrapped in the
            // outer quotes that `cmd /C` expects, so embedded quoted paths
            // like `"C:\temp\foo"` survive intact. tokio's Command exposes
            // raw_arg natively on Windows, no CommandExt import needed.
            cmd.arg(config.flag);
            cmd.raw_arg(format!("\"{}\"", command));
        } else {
            // git-bash and other POSIX shells handle their own quoting fine.
            cmd.arg(config.flag).arg(command);
        }
    }
    #[cfg(not(windows))]
    {
        cmd.arg(config.flag).arg(command);
        cmd.env("PATH", effective_path());
        unsafe {
            cmd.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }

    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }

    if let Some(env) = env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    cmd
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    #[test]
    fn gui_search_path_includes_cli_locations_and_rejects_relative_entries() {
        let path = build_search_path(
            Some(Path::new("/Users/rift")),
            std::ffi::OsStr::new("relative:/custom/bin:/usr/bin"),
        );
        let entries: Vec<PathBuf> = std::env::split_paths(&path).collect();

        assert!(entries.contains(&PathBuf::from("/Users/rift/.local/bin")));
        assert!(entries.contains(&PathBuf::from("/Users/rift/.grok/bin")));
        assert!(entries.contains(&PathBuf::from("/opt/homebrew/bin")));
        assert!(entries.contains(&PathBuf::from("/usr/local/bin")));
        assert!(entries.contains(&PathBuf::from("/custom/bin")));
        assert!(!entries.contains(&PathBuf::from("relative")));
    }

    #[test]
    fn executable_lookup_rejects_paths_from_callers() {
        assert!(find_gui_executable("../codex").is_none());
        assert!(find_gui_executable("/usr/bin/env").is_none());
        assert!(find_gui_executable("").is_none());
    }
}

/// Gracefully kill a child process.
///
/// On Unix: sends SIGTERM, waits up to 2 seconds, then sends SIGKILL.
/// On Windows: calls kill() directly (which is always immediate).
/// Always reaps the process with wait() afterward.
pub async fn graceful_kill(child: &mut tokio::process::Child) {
    #[cfg(unix)]
    {
        use std::time::Duration;
        if let Some(pid) = child.id() {
            // Send SIGTERM first for graceful shutdown
            terminate_process_group(pid, libc::SIGTERM);
            // Wait up to 2 seconds for the process to exit
            match tokio::time::timeout(Duration::from_secs(2), child.wait()).await {
                Ok(_) => return,
                Err(_) => {
                    // Process didn't exit in time, escalate to SIGKILL
                    terminate_process_group(pid, libc::SIGKILL);
                    let _ = child.kill().await;
                }
            }
        } else {
            // No PID available (already exited), just try kill
            let _ = child.kill().await;
        }
    }

    #[cfg(not(unix))]
    {
        let _ = child.kill().await;
    }

    // Reap the process to avoid zombies
    let _ = child.wait().await;
}

#[cfg(unix)]
fn terminate_process_group(pid: u32, signal: libc::c_int) {
    let pid = pid as libc::pid_t;
    unsafe {
        // build_command places each command in a fresh session, making the
        // child pid also the process-group id. Kill the group so pipelines and
        // shell grandchildren stop together.
        if libc::kill(-pid, signal) == -1 {
            let _ = libc::kill(pid, signal);
        }
    }
}

/// Best-effort external cancellation for a streaming command by process id.
pub async fn cancel_process_tree(pid: u32) {
    #[cfg(unix)]
    {
        terminate_process_group(pid, libc::SIGTERM);
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        terminate_process_group(pid, libc::SIGKILL);
    }

    #[cfg(windows)]
    {
        let _ = tokio::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output()
            .await;
    }
}
