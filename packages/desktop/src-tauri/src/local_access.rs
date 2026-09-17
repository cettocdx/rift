use crate::file_access::{content_version, FileScope};
use base64::Engine;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::IpAddr;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

const MAX_WORKSPACE_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES: u64 = 64 * 1024 * 1024;
const MAX_WORKSPACE_ENTRIES: usize = 1_000;
const MAX_LOOPBACK_RESPONSE_BYTES: usize = 512 * 1024;
const MAX_LOOPBACK_REDIRECTS: usize = 5;
const LOOPBACK_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone)]
pub(crate) struct WorkspaceGrant {
    grant_id: String,
    root: PathBuf,
    file_scope: Option<Arc<FileScope>>,
    writable: bool,
    granted_at: u64,
}

#[derive(Default)]
pub struct WorkspaceGrants {
    generation: u64,
    grants: HashMap<String, WorkspaceGrant>,
}

pub type LocalAccessState = Arc<Mutex<WorkspaceGrants>>;

pub fn new_local_access_state() -> LocalAccessState {
    Arc::new(Mutex::new(WorkspaceGrants::default()))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGrantInfo {
    grant_id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    root_path: Option<String>,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    relative_path: Option<String>,
    writable: bool,
    granted_at: u64,
}

impl WorkspaceGrant {
    fn info(&self) -> WorkspaceGrantInfo {
        WorkspaceGrantInfo {
            grant_id: self.grant_id.clone(),
            name: self
                .file_scope
                .as_ref()
                .map(|scope| scope.name.clone())
                .unwrap_or_else(|| {
                    self.root
                        .file_name()
                        .and_then(|name| name.to_str())
                        .filter(|name| !name.is_empty())
                        .unwrap_or("Workspace")
                        .to_string()
                }),
            root_path: self
                .file_scope
                .is_none()
                .then(|| self.root.to_string_lossy().to_string()),
            kind: if self.file_scope.is_some() {
                "file"
            } else {
                "directory"
            },
            relative_path: self.file_scope.as_ref().map(|scope| scope.name.clone()),
            writable: self.writable,
            granted_at: self.granted_at,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    name: String,
    relative_path: String,
    kind: &'static str,
    size: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileData {
    relative_path: String,
    media_type: String,
    encoding: &'static str,
    content: String,
    size: u64,
    version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWriteResult {
    relative_path: String,
    size: u64,
    version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopbackResponse {
    status: u16,
    final_url: String,
    content_type: String,
    encoding: &'static str,
    body: String,
    bytes: usize,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPlatformInfo {
    platform: &'static str,
    arch: &'static str,
    release: &'static str,
    hostname: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSaveResult {
    path: String,
    size: u64,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn grant_generation(state: &LocalAccessState) -> Result<u64, String> {
    Ok(state.lock().map_err(|_| "Local access state is unavailable.".to_string())?.generation)
}

fn insert_grant(state: &LocalAccessState, grant: WorkspaceGrant, generation: u64) -> Result<(), String> {
    let mut state = state.lock().map_err(|_| "Local access state is unavailable.".to_string())?;
    if state.generation != generation { return Err("Workspace consent expired. Choose the file or folder again.".into()); }
    state.grants.insert(grant.grant_id.clone(), grant);
    Ok(())
}

pub(crate) fn revoke_all_grants(state: &LocalAccessState) -> Result<Vec<String>, String> {
    let mut state = state.lock().map_err(|_| "Local access state is unavailable.".to_string())?;
    state.generation = state.generation.wrapping_add(1);
    Ok(state.grants.drain().map(|(id, _)| id).collect())
}

fn grant_from_state(
    state: &tauri::State<'_, LocalAccessState>,
    grant_id: &str,
) -> Result<WorkspaceGrant, String> {
    let grants = state
        .lock()
        .map_err(|_| "Local access state is unavailable.".to_string())?;
    grants.grants
        .get(grant_id)
        .cloned()
        .ok_or_else(|| "Workspace access has expired or was revoked.".to_string())
}

fn validated_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative_path);
    if path.is_absolute() {
        return Err("Workspace paths must be relative.".to_string());
    }

    let mut clean = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Workspace paths cannot leave the selected folder.".to_string())
            }
        }
    }
    Ok(clean)
}

fn resolved_existing_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = validated_relative_path(relative_path)?;
    let candidate = root.join(relative);
    let canonical = fs::canonicalize(&candidate)
        .map_err(|error| format!("Workspace path is unavailable: {error}"))?;
    if !canonical.starts_with(root) {
        return Err("Symbolic links cannot leave the selected folder.".to_string());
    }
    Ok(canonical)
}

fn ensure_write_parent(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    let parent = relative.parent().unwrap_or_else(|| Path::new(""));
    let mut current = root.to_path_buf();

    for component in parent.components() {
        let Component::Normal(part) = component else {
            return Err("Workspace paths cannot leave the selected folder.".to_string());
        };
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err("Writes through symbolic links are not allowed.".to_string())
            }
            Ok(metadata) if !metadata.is_dir() => {
                return Err("A workspace path component is not a folder.".to_string())
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&current)
                    .map_err(|error| format!("Could not create workspace folder: {error}"))?;
            }
            Err(error) => return Err(format!("Workspace folder is unavailable: {error}")),
        }

        let canonical = fs::canonicalize(&current)
            .map_err(|error| format!("Workspace folder is unavailable: {error}"))?;
        if !canonical.starts_with(root) {
            return Err("Symbolic links cannot leave the selected folder.".to_string());
        }
        current = canonical;
    }

    Ok(current)
}

fn media_type(path: &Path) -> String {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "css" => "text/css",
        "csv" => "text/csv",
        "html" | "htm" => "text/html",
        "js" | "mjs" | "cjs" => "text/javascript",
        "json" => "application/json",
        "md" | "markdown" => "text/markdown",
        "svg" => "image/svg+xml",
        "ts" | "tsx" => "text/typescript",
        "txt" => "text/plain",
        "xml" => "application/xml",
        "gif" => "image/gif",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn is_textual_media_type(content_type: &str) -> bool {
    let normalized = content_type.to_ascii_lowercase();
    normalized.starts_with("text/")
        || normalized.contains("json")
        || normalized.contains("javascript")
        || normalized.contains("xml")
        || normalized.contains("svg")
        || normalized.contains("x-www-form-urlencoded")
}

#[tauri::command]
pub async fn request_workspace_access(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LocalAccessState>,
    writable: bool,
) -> Result<Option<WorkspaceGrantInfo>, String> {
    let generation = grant_generation(&state)?;
    let selected = app
        .dialog()
        .file()
        .set_title("Choose a folder for RIFT Build")
        .blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let selected = selected
        .into_path()
        .map_err(|_| "The selected folder is not available as a local path.".to_string())?;
    let root = fs::canonicalize(&selected)
        .map_err(|error| format!("The selected folder is unavailable: {error}"))?;
    if !root.is_dir() {
        return Err("The selected path is not a folder.".to_string());
    }

    if writable {
        let confirmed = app
            .dialog()
            .message(format!(
                "Allow RIFT Build to read and modify files inside this folder until RIFT closes?\n\n{}\n\nRIFT will not receive access to folders outside this selection.",
                root.display()
            ))
            .parent(&window)
            .title("Allow workspace access")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Allow access".into(),
                "Cancel".into(),
            ))
            .blocking_show();
        if !confirmed {
            return Ok(None);
        }
    }

    let grant = WorkspaceGrant {
        grant_id: uuid::Uuid::new_v4().to_string(),
        root,
        file_scope: None,
        writable,
        granted_at: now_millis(),
    };
    let info = grant.info();
    insert_grant(&state, grant, generation)?;
    Ok(Some(info))
}

#[tauri::command]
pub async fn request_file_access(
    app: tauri::AppHandle,
    state: tauri::State<'_, LocalAccessState>,
) -> Result<Option<WorkspaceGrantInfo>, String> {
    let generation = grant_generation(&state)?;
    let selected = app
        .dialog()
        .file()
        .set_title("Choose a file to work on")
        .blocking_pick_file();
    let selected = selected
        .map(|selected| {
            selected
                .into_path()
                .map_err(|_| "The selected file is not available as a local file.".to_string())
        })
        .transpose()?;
    register_file_selection(&state, selected.as_deref(), generation)
}

fn register_file_selection(
    state: &LocalAccessState,
    selected: Option<&Path>,
    generation: u64,
) -> Result<Option<WorkspaceGrantInfo>, String> {
    let Some(selected) = selected else {
        return Ok(None);
    };
    let scope = FileScope::open(selected)?;
    let grant = WorkspaceGrant {
        grant_id: uuid::Uuid::new_v4().to_string(),
        // File grants retain only a directory capability and selected basename;
        // no absolute path is exposed to the webview or grants listing.
        root: PathBuf::new(),
        file_scope: Some(Arc::new(scope)),
        writable: true,
        granted_at: now_millis(),
    };
    let info = grant.info();
    insert_grant(state, grant, generation)?;
    Ok(Some(info))
}

#[tauri::command]
pub fn list_workspace_grants(
    state: tauri::State<'_, LocalAccessState>,
) -> Result<Vec<WorkspaceGrantInfo>, String> {
    let grants = state
        .lock()
        .map_err(|_| "Local access state is unavailable.".to_string())?;
    let mut result: Vec<_> = grants.grants.values().map(WorkspaceGrant::info).collect();
    result.sort_by(|left, right| right.granted_at.cmp(&left.granted_at));
    Ok(result)
}

#[tauri::command]
pub fn revoke_workspace_access(
    native: tauri::State<'_, crate::native_codex::NativeCodexState>,
    state: tauri::State<'_, LocalAccessState>,
    terminal_state: tauri::State<'_, crate::pty::DesktopProfilePtyState>,
    grant_id: String,
) -> Result<bool, String> {
    // Match creation's lock order. Revocation cannot slip between its final
    // grant check and process insertion, leaving an ungranted process alive.
    let mut terminals = terminal_state.lock()
        .map_err(|_| "Desktop terminal state is unavailable.".to_string())?;
    let revoked = state.lock()
        .map_err(|_| "Local access state is unavailable.".to_string())?
        .grants.remove(&grant_id).is_some();
    if revoked {
        terminals.kill_for_grant(&grant_id);
        crate::native_codex::revoke_grant(&native, &grant_id);
    }
    Ok(revoked)
}

pub(crate) fn resolve_terminal_workspace_cwd(
    state: &tauri::State<'_, LocalAccessState>,
    grant_id: &str,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let grant = grant_from_state(state, grant_id)?;
    terminal_cwd_for_grant(&grant, relative_path)
}

fn terminal_cwd_for_grant(grant: &WorkspaceGrant, relative_path: &str) -> Result<PathBuf, String> {
    if grant.file_scope.is_some() {
        return Err(
            "File access does not grant terminal access. Choose a workspace folder for a terminal."
                .to_string(),
        );
    }
    if !grant.writable {
        return Err("Desktop terminals require a writable workspace grant.".to_string());
    }
    let directory = resolved_existing_path(&grant.root, relative_path)?;
    if !directory.is_dir() {
        return Err("The desktop terminal working directory is not a folder.".to_string());
    }
    Ok(directory)
}

#[tauri::command]
pub fn get_desktop_platform_info() -> DesktopPlatformInfo {
    DesktopPlatformInfo {
        platform: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        // Avoid shelling out merely to identify the bridge. The product does
        // not need the host name or exact OS patch level to route safe local
        // access requests, and omitting both keeps machine metadata private.
        release: "unknown",
        hostname: "RIFT Desktop",
    }
}

fn write_new_download(directory: &Path, filename: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let name = Path::new(filename);
    let stem = name.file_stem().and_then(|value| value.to_str()).unwrap_or("download");
    let extension = name.extension().and_then(|value| value.to_str());
    for index in 0..1000 {
        let candidate = if index == 0 { filename.to_string() } else {
            match extension {
                Some(ext) => format!("{stem} ({index}).{ext}"),
                None => format!("{stem} ({index})"),
            }
        };
        let target = directory.join(candidate);
        match OpenOptions::new().write(true).create_new(true).open(&target) {
            Ok(mut file) => {
                if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
                    drop(file);
                    let _ = fs::remove_file(&target);
                    return Err(format!("Could not save the download: {error}"));
                }
                return Ok(target);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not save the download: {error}")),
        }
    }
    Err("Too many downloads already use this file name.".into())
}

#[tauri::command]
pub fn save_file_to_downloads(
    app: tauri::AppHandle,
    filename: String,
    content: String,
    encoding: Option<String>,
) -> Result<DownloadSaveResult, String> {
    let safe_name = Path::new(&filename)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty() && *name != "." && *name != "..")
        .ok_or_else(|| "A valid download file name is required.".to_string())?;
    if safe_name != filename {
        return Err("Download file names cannot contain folder paths.".to_string());
    }
    let bytes = match encoding.as_deref().unwrap_or("utf8") {
        "utf8" => content.into_bytes(),
        "base64" => base64::engine::general_purpose::STANDARD
            .decode(content)
            .map_err(|_| "The download content is not valid base64.".to_string())?,
        _ => return Err("Download encoding must be utf8 or base64.".to_string()),
    };
    if bytes.len() as u64 > MAX_DOWNLOAD_BYTES {
        return Err(format!(
            "Desktop downloads are limited to {} MiB.",
            MAX_DOWNLOAD_BYTES / 1024 / 1024
        ));
    }

    let downloads = app
        .path()
        .download_dir()
        .map_err(|error| format!("The Downloads folder is unavailable: {error}"))?;
    fs::create_dir_all(&downloads)
        .map_err(|error| format!("Could not prepare the Downloads folder: {error}"))?;
    let target = write_new_download(&downloads, safe_name, &bytes)?;
    Ok(DownloadSaveResult {
        path: target.to_string_lossy().to_string(),
        size: bytes.len() as u64,
    })
}

#[tauri::command]
pub fn list_workspace_entries(
    state: tauri::State<'_, LocalAccessState>,
    grant_id: String,
    relative_path: String,
) -> Result<Vec<WorkspaceEntry>, String> {
    let grant = grant_from_state(&state, &grant_id)?;
    if let Some(scope) = &grant.file_scope {
        let snapshot = scope.list(&relative_path)?;
        return Ok(vec![WorkspaceEntry {
            name: scope.name.clone(),
            relative_path: scope.name.clone(),
            kind: "file",
            size: Some(snapshot.size),
        }]);
    }
    let directory = resolved_existing_path(&grant.root, &relative_path)?;
    if !directory.is_dir() {
        return Err("The requested workspace path is not a folder.".to_string());
    }

    let relative_base = validated_relative_path(&relative_path)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(&directory)
        .map_err(|error| format!("Could not list workspace folder: {error}"))?
        .take(MAX_WORKSPACE_ENTRIES)
    {
        let entry = entry.map_err(|error| format!("Could not read workspace entry: {error}"))?;
        let metadata = entry
            .file_type()
            .map_err(|error| format!("Could not inspect workspace entry: {error}"))?;
        if metadata.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let relative = relative_base.join(&name).to_string_lossy().to_string();
        let kind = if metadata.is_dir() {
            "directory"
        } else if metadata.is_file() {
            "file"
        } else {
            "other"
        };
        let size = if metadata.is_file() {
            entry.metadata().ok().map(|value| value.len())
        } else {
            None
        };
        entries.push(WorkspaceEntry {
            name,
            relative_path: relative,
            kind,
            size,
        });
    }
    entries.sort_by(|left, right| {
        left.kind
            .cmp(right.kind)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub fn read_workspace_file(
    state: tauri::State<'_, LocalAccessState>,
    grant_id: String,
    relative_path: String,
) -> Result<WorkspaceFileData, String> {
    let grant = grant_from_state(&state, &grant_id)?;
    if let Some(scope) = &grant.file_scope {
        let snapshot = scope.read(&relative_path)?;
        return Ok(WorkspaceFileData {
            relative_path: scope.name.clone(),
            media_type: media_type(Path::new(&scope.name)),
            encoding: "utf8",
            content: snapshot.content,
            size: snapshot.size,
            version: snapshot.version,
        });
    }
    let path = resolved_existing_path(&grant.root, &relative_path)?;
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Could not inspect workspace file: {error}"))?;
    if !metadata.is_file() {
        return Err("The requested workspace path is not a file.".to_string());
    }
    if metadata.len() > MAX_WORKSPACE_FILE_BYTES {
        return Err(format!(
            "Workspace files are limited to {} MiB.",
            MAX_WORKSPACE_FILE_BYTES / 1024 / 1024
        ));
    }

    let mut file =
        fs::File::open(&path).map_err(|error| format!("Could not open workspace file: {error}"))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read workspace file: {error}"))?;
    let version = content_version(&bytes);

    let detected_type = media_type(&path);
    let (encoding, content) = if is_textual_media_type(&detected_type) {
        let text = String::from_utf8(bytes)
            .map_err(|_| "The workspace text file is not valid UTF-8.".to_string())?;
        ("utf8", text)
    } else {
        (
            "base64",
            base64::engine::general_purpose::STANDARD.encode(bytes),
        )
    };

    Ok(WorkspaceFileData {
        relative_path,
        media_type: detected_type,
        encoding,
        content,
        size: metadata.len(),
        version,
    })
}

#[tauri::command]
pub fn write_workspace_file(
    state: tauri::State<'_, LocalAccessState>,
    grant_id: String,
    relative_path: String,
    content: String,
    encoding: Option<String>,
    expected_version: Option<String>,
) -> Result<WorkspaceWriteResult, String> {
    let grant = grant_from_state(&state, &grant_id)?;
    if !grant.writable {
        return Err("This workspace grant is read-only.".to_string());
    }
    if let Some(scope) = &grant.file_scope {
        if encoding.as_deref().unwrap_or("utf8") != "utf8" {
            return Err("File editing supports UTF-8 text only.".to_string());
        }
        let version = scope.write(
            &relative_path,
            content.as_bytes(),
            expected_version.as_deref(),
        )?;
        return Ok(WorkspaceWriteResult {
            relative_path: scope.name.clone(),
            size: content.len() as u64,
            version,
        });
    }

    let relative = validated_relative_path(&relative_path)?;
    if relative.as_os_str().is_empty() || relative.file_name().is_none() {
        return Err("A file path is required.".to_string());
    }
    let bytes = match encoding.as_deref().unwrap_or("utf8") {
        "utf8" => content.into_bytes(),
        "base64" => base64::engine::general_purpose::STANDARD
            .decode(content)
            .map_err(|_| "The file content is not valid base64.".to_string())?,
        _ => return Err("File encoding must be utf8 or base64.".to_string()),
    };
    if bytes.len() as u64 > MAX_WORKSPACE_FILE_BYTES {
        return Err(format!(
            "Workspace files are limited to {} MiB.",
            MAX_WORKSPACE_FILE_BYTES / 1024 / 1024
        ));
    }

    let parent = ensure_write_parent(&grant.root, &relative)?;
    let file_name = relative
        .file_name()
        .ok_or_else(|| "A file name is required.".to_string())?;
    let target = parent.join(file_name);
    if let Ok(metadata) = fs::symlink_metadata(&target) {
        if metadata.file_type().is_symlink() {
            return Err("Writes through symbolic links are not allowed.".to_string());
        }
        if !metadata.is_file() {
            return Err("The workspace target is not a file.".to_string());
        }
    }
    if let Some(expected) = &expected_version {
        let current = fs::read(&target).map_err(|_| {
            "The workspace file is unavailable. Read it again before saving.".to_string()
        })?;
        if content_version(&current) != *expected {
            return Err(
                "FILE_VERSION_CONFLICT: The file changed. Read it again before saving.".to_string(),
            );
        }
    }

    let temporary = parent.join(format!(".rift-write-{}.tmp", uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| format!("Could not create temporary workspace file: {error}"))?;
    if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Could not write workspace file: {error}"));
    }
    drop(file);

    #[cfg(target_os = "windows")]
    if target.exists() {
        fs::remove_file(&target)
            .map_err(|error| format!("Could not replace workspace file: {error}"))?;
    }
    if let Err(error) = fs::rename(&temporary, &target) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Could not commit workspace file: {error}"));
    }

    Ok(WorkspaceWriteResult {
        relative_path,
        size: bytes.len() as u64,
        version: content_version(&bytes),
    })
}

fn validate_loopback_url(raw_url: &str) -> Result<url::Url, String> {
    let parsed =
        url::Url::parse(raw_url).map_err(|_| "Enter a valid localhost URL.".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Local access supports only HTTP and HTTPS URLs.".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Credentials are not allowed in localhost URLs.".to_string());
    }
    let is_loopback = match parsed.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(address)) => IpAddr::V4(address).is_loopback(),
        Some(url::Host::Ipv6(address)) => IpAddr::V6(address).is_loopback(),
        None => false,
    };
    if !is_loopback {
        return Err(
            "The desktop local bridge can connect only to localhost or loopback IPs.".to_string(),
        );
    }
    Ok(parsed)
}

fn validate_visible_url(raw_url: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(raw_url).map_err(|_| "Enter a valid URL.".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Browser access supports only HTTP and HTTPS URLs.".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Credentials are not allowed in browser URLs.".to_string());
    }
    if parsed.host().is_none() {
        return Err("The browser URL must include a host.".to_string());
    }
    Ok(parsed)
}

#[tauri::command]
pub async fn open_visible_url_with_consent(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LocalAccessState>,
    url: String,
) -> Result<bool, String> {
    let generation = grant_generation(&state)?;
    let parsed = validate_visible_url(&url)?;
    let confirmed = app
        .dialog()
        .message(format!(
            "RIFT Build wants to open this address in your default browser:\n\n{}\n\nThe page will open visibly. RIFT will not attach to your personal browser profile.",
            parsed
        ))
        .parent(&window)
        .title("Open browser page")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Open page".into(),
            "Cancel".into(),
        ))
        .blocking_show();
    if !confirmed || grant_generation(&state)? != generation {
        return Ok(false);
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|error| format!("Could not open the browser: {error}"))?;
    Ok(true)
}

#[tauri::command]
pub async fn fetch_loopback_url(
    access: tauri::State<'_, crate::computer_access::ComputerAccessState>,
    url: String,
    method: Option<String>,
) -> Result<LoopbackResponse, String> {
    fetch_loopback_request(&access, url, method).await
}

async fn fetch_loopback_request(
    access: &crate::computer_access::ComputerAccessState,
    url: String,
    method: Option<String>,
) -> Result<LoopbackResponse, String> {
    let grant = access.web.snapshot();
    if !access.web.current(grant) {
        return Err("The desktop session is not ready. Sign in to RIFT Desktop before reading a localhost page.".to_string());
    }
    let method = method
        .unwrap_or_else(|| "GET".to_string())
        .to_ascii_uppercase();
    if method != "GET" && method != "HEAD" {
        return Err("Localhost reads support only GET and HEAD requests.".to_string());
    }

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .timeout(LOOPBACK_REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("Could not initialize localhost access: {error}"))?;
    let mut current = validate_loopback_url(&url)?;

    for redirect_count in 0..=MAX_LOOPBACK_REDIRECTS {
        if !access.web.current(grant) { return Err("Local websites disconnected.".into()); }
        let request = if method == "HEAD" {
            client.head(current.clone())
        } else {
            client.get(current.clone())
        };
        let mut response = request
            .header(reqwest::header::USER_AGENT, "RIFT-Desktop-Local-Access/1.0")
            .send()
            .await
            .map_err(|error| format!("Could not reach localhost: {error}"))?;

        if response.status().is_redirection() {
            if redirect_count == MAX_LOOPBACK_REDIRECTS {
                return Err("The localhost URL redirected too many times.".to_string());
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "The localhost redirect is missing a valid location.".to_string())?;
            current = validate_loopback_url(
                current
                    .join(location)
                    .map_err(|_| "The localhost redirect URL is invalid.".to_string())?
                    .as_str(),
            )?;
            continue;
        }

        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();
        let mut bytes = Vec::new();
        let mut truncated = false;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("Could not read localhost response: {error}"))?
        {
            let remaining = MAX_LOOPBACK_RESPONSE_BYTES.saturating_sub(bytes.len());
            if chunk.len() > remaining {
                bytes.extend_from_slice(&chunk[..remaining]);
                truncated = true;
                break;
            }
            bytes.extend_from_slice(&chunk);
        }
        if !access.web.current(grant) { return Err("Local websites disconnected.".into()); }
        let response_bytes = bytes.len();
        let (encoding, body) = if is_textual_media_type(&content_type) {
            ("utf8", String::from_utf8_lossy(&bytes).to_string())
        } else {
            (
                "base64",
                base64::engine::general_purpose::STANDARD.encode(bytes),
            )
        };
        return Ok(LoopbackResponse {
            status,
            final_url: current.to_string(),
            content_type,
            encoding,
            body,
            bytes: response_bytes,
            truncated,
        });
    }

    Err("The localhost URL could not be read.".to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn binary_downloads_preserve_bytes_and_existing_files() {
        let directory = std::env::temp_dir().join(format!("rift-download-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let bytes = [0, 255, 128, 10];
        let first = super::write_new_download(&directory, "image.png", &bytes).unwrap();
        let second = super::write_new_download(&directory, "image.png", b"next").unwrap();
        assert_ne!(first, second);
        assert_eq!(std::fs::read(first).unwrap(), bytes);
        assert_eq!(std::fs::read(second).unwrap(), b"next");
        std::fs::remove_dir_all(directory).unwrap();
    }

    use super::*;
    #[tokio::test]
    async fn local_web_is_separate_from_file_sharing_and_revocable() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let access = crate::computer_access::ComputerAccessState::default();
        let server = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/", server.local_addr().unwrap());
        assert!(fetch_loopback_request(&access, url.clone(), None).await.is_err());
        assert!(access.web.approve(access.web.snapshot()));
        let task = tokio::spawn(async move {
            let (mut stream, _) = server.accept().await.unwrap();
            let mut buffer = [0; 2048];
            stream.read(&mut buffer).await.unwrap();
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 5\r\nConnection: close\r\n\r\nready").await.unwrap();
        });
        let result = fetch_loopback_request(&access, url.clone(), None).await.unwrap();
        assert_eq!(result.body, "ready");
        assert_eq!(result.status, 200);
        task.await.unwrap();
        access.web.revoke();
        assert!(fetch_loopback_request(&access, url, None).await.is_err());
    }


    #[cfg(unix)]
    #[test]
    fn file_grant_is_private_cancel_safe_and_never_a_terminal_grant() {
        let directory =
            std::env::temp_dir().join(format!("rift-local-access-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("chosen.txt");
        fs::write(&path, "hello").unwrap();
        let state = new_local_access_state();
        let info = register_file_selection(&state, Some(&path), grant_generation(&state).unwrap())
            .unwrap()
            .unwrap();
        let serialized = serde_json::to_value(&info).unwrap();
        assert_eq!(serialized["name"], "chosen.txt");
        assert_eq!(serialized["relativePath"], "chosen.txt");
        assert_eq!(serialized["kind"], "file");
        assert_eq!(serialized["writable"], true);
        assert!(serialized.get("rootPath").is_none());
        assert!(!serialized.to_string().contains(directory.to_str().unwrap()));
        assert!(register_file_selection(&state, None, grant_generation(&state).unwrap()).unwrap().is_none());
        assert_eq!(state.lock().unwrap().grants.len(), 1);
        let grants = state.lock().unwrap();
        let grant = grants.grants.get(&info.grant_id).unwrap();
        assert!(terminal_cwd_for_grant(grant, "")
            .unwrap_err()
            .contains("does not grant terminal"));
        assert!(terminal_cwd_for_grant(grant, "chosen.txt").is_err());
        drop(grants);
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn sign_out_clears_grants_and_rejects_late_picker_results() {
        let directory = std::env::temp_dir().join(format!("rift-session-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("private.txt");
        fs::write(&path, "private").unwrap();
        let state = new_local_access_state();
        let pending = grant_generation(&state).unwrap();
        let old = register_file_selection(&state, Some(&path), pending).unwrap().unwrap();
        insert_grant(&state, WorkspaceGrant {
            grant_id: "old-folder".into(), root: directory.clone(), file_scope: None,
            writable: true, granted_at: 0,
        }, pending).unwrap();
        let revoked = revoke_all_grants(&state).unwrap();
        assert_eq!(revoked.len(), 2);
        assert!(revoked.contains(&old.grant_id));
        assert!(revoked.contains(&"old-folder".to_string()));
        assert!(state.lock().unwrap().grants.is_empty());
        let late = register_file_selection(&state, Some(&path), pending);
        fs::remove_dir_all(directory).unwrap();
        assert!(late.is_err(), "An old picker must not grant access to the next session");
        assert!(state.lock().unwrap().grants.is_empty());
    }

    #[test]
    fn folder_grants_keep_the_existing_root_path_contract() {
        let grant = WorkspaceGrant {
            grant_id: "folder".to_string(),
            root: PathBuf::from("/existing/workspace"),
            file_scope: None,
            writable: false,
            granted_at: 1,
        };
        let serialized = serde_json::to_value(grant.info()).unwrap();
        assert_eq!(serialized["rootPath"], "/existing/workspace");
        assert_eq!(serialized["kind"], "directory");
        assert!(serialized.get("relativePath").is_none());
    }

    #[test]
    fn relative_paths_cannot_escape_the_workspace() {
        assert!(validated_relative_path("src/app.tsx").is_ok());
        assert!(validated_relative_path("../secrets").is_err());
        assert!(validated_relative_path("/etc/passwd").is_err());
    }

    #[test]
    fn localhost_policy_accepts_only_explicit_loopback_hosts() {
        assert!(validate_loopback_url("http://localhost:3000/").is_ok());
        assert!(validate_loopback_url("http://127.0.0.1:4173/").is_ok());
        assert!(validate_loopback_url("http://[::1]:8080/").is_ok());
        assert!(validate_loopback_url("https://example.com/").is_err());
        assert!(validate_loopback_url("http://localhost.attacker.test/").is_err());
        assert!(validate_loopback_url("file:///etc/passwd").is_err());
    }

    #[test]
    fn visible_browser_policy_rejects_non_web_schemes_and_embedded_credentials() {
        assert!(validate_visible_url("https://example.com/docs").is_ok());
        assert!(validate_visible_url("http://localhost:3000/").is_ok());
        assert!(validate_visible_url("file:///etc/passwd").is_err());
        assert!(validate_visible_url("https://user:secret@example.com/").is_err());
    }
}
