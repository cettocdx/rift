//! Desktop-owned Codex sessions. UI readers never own process lifetime.
use crate::{local_access, native_codex_relay, pty};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
};
use tauri::Manager;

pub type NativeInput = Arc<Mutex<Option<ChildStdin>>>;
pub type NativeCodexState = Mutex<HashMap<String, Session>>;
const MAX_REPLAY_BYTES: usize = 8 * 1024 * 1024;
const MAX_LINE_BYTES: u64 = 4 * 1024 * 1024;
#[derive(Default)]
struct Events {
    sequence: u64,
    bytes: usize,
    queue: VecDeque<(u64, Value, usize)>,
    approvals: HashMap<String, Value>,
    closed: bool,
    ready: bool,
}
impl Events {
    fn push(&mut self, value: Value) {
        let size = value.to_string().len();
        self.sequence += 1;
        self.bytes += size;
        self.queue.push_back((self.sequence, value, size));
        while self.bytes > MAX_REPLAY_BYTES && self.queue.len() > 1 {
            if let Some((_, _, size)) = self.queue.pop_front() {
                self.bytes -= size;
            }
        }
    }
}
pub struct Session {
    owner: String,
    generation: u64,
    grant: String,
    cwd: PathBuf,
    child: Arc<Mutex<Child>>,
    stdin: NativeInput,
    events: Arc<Mutex<Events>>,
    relay: native_codex_relay::Relay,
    tracker: Arc<crate::native_codex_process::ProcessTracker>,
}
impl Drop for Session {
    fn drop(&mut self) {
        self.relay.abort_handle().abort();
        crate::native_codex_process::terminate(&self.child, &self.stdin, &self.tracker);
        if let Ok(mut events) = self.events.lock() {
            events.closed = true;
        }
    }
}
pub fn revoke_all(state: &NativeCodexState) {
    if let Ok(mut sessions) = state.lock() {
        sessions.clear();
    }
}
pub fn revoke_grant(state: &NativeCodexState, grant: &str) {
    if let Ok(mut sessions) = state.lock() {
        sessions.retain(|_, session| session.grant != grant);
    }
}
fn digest(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}
fn write_message(stdin: &NativeInput, message: &Value) -> Result<(), String> {
    let mut stdin = stdin
        .lock()
        .map_err(|_| "Native console input unavailable.")?;
    let stdin = stdin.as_mut().ok_or("Native console input closed.")?;
    let bytes = serde_json::to_vec(message).map_err(|_| "Invalid native message.")?;
    stdin
        .write_all(&bytes)
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|_| "Native Codex exited. Reopen the console to resume saved history.".into())
}
fn verified_binary(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut directory = app
        .path()
        .resource_dir()
        .map_err(|_| "Native resources unavailable.")?
        .join("native-codex");
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("RIFT_NATIVE_CODEX_BUNDLE") {
        directory = PathBuf::from(path);
    }
    let manifest: Value = serde_json::from_slice(
        &std::fs::read(directory.join("provenance.json"))
            .map_err(|_| "Native Codex bundle is missing. Update RIFT Desktop.")?,
    )
    .map_err(|_| "Invalid native package manifest.")?;
    let suffix = std::env::consts::EXE_SUFFIX;
    for name in [
        format!("rift{suffix}"),
        format!("codex-code-mode-host{suffix}"),
        "LICENSE".into(),
        "NOTICE".into(),
        "models.json".into(),
    ] {
        let mut source = std::fs::File::open(directory.join(&name))
            .map_err(|_| "Native Codex package is incomplete.")?;
        let mut hasher = Sha256::new();
        let mut chunk = [0; 65536];
        loop {
            let n = source
                .read(&mut chunk)
                .map_err(|_| "Could not verify native package.")?;
            if n == 0 {
                break;
            }
            hasher.update(&chunk[..n]);
        }
        if manifest["files"][&name].as_str() != Some(format!("{:x}", hasher.finalize()).as_str()) {
            return Err("Native package checksum failed. Reinstall RIFT Desktop.".into());
        }
    }
    Ok(directory.join(format!("rift{suffix}")))
}
fn describe(id: &str, session: &Session) -> Value {
    json!({"sessionId":id,"workspace":session.cwd.to_string_lossy(),"workspaceKey":digest(session.cwd.to_string_lossy().as_bytes()),"config":session.relay.config})
}

#[tauri::command]
pub async fn native_codex_open(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NativeCodexState>,
    terminal: tauri::State<'_, pty::DesktopProfilePtyState>,
    access: tauri::State<'_, local_access::LocalAccessState>,
    owner_id: String,
    owner_generation: u64,
    grant_id: String,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Native console is available only to the main RIFT window.".into());
    }
    let origin = window
        .url()
        .map_err(|_| "Invalid RIFT origin.")?
        .origin()
        .ascii_serialization();
    if origin != "https://riftsys.app"
        && origin != "http://localhost:3020"
        && origin != "http://localhost:3022"
    {
        return Err("Native console is unavailable for this app origin.".into());
    }
    let cwd = {
        let owner = terminal.lock().map_err(|_| "Terminal owner unavailable.")?;
        owner.authorize(&owner_id, owner_generation)?;
        let cwd = local_access::resolve_terminal_workspace_cwd(&access, &grant_id, "")?;
        let sessions = state.lock().map_err(|_| "Native state unavailable.")?;
        if let Some((id, session)) = sessions.iter().find(|(_, s)| {
            s.owner == owner_id
                && s.generation == owner_generation
                && s.grant == grant_id
                && !s.events.lock().map(|e| e.closed).unwrap_or(true)
        }) {
            return Ok(describe(id, session));
        }
        cwd
    };
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or("Home directory unavailable.")?;
    let relay = native_codex_relay::start(&home, &origin, &owner_id).await?;
    let binary = verified_binary(&app)?;
    let owner = terminal.lock().map_err(|_| "Terminal owner unavailable.")?;
    owner.authorize(&owner_id, owner_generation)?;
    if local_access::resolve_terminal_workspace_cwd(&access, &grant_id, "")? != cwd {
        return Err("Workspace grant changed.".into());
    }
    let mut sessions = state.lock().map_err(|_| "Native state unavailable.")?;
    if let Some((id, session)) = sessions.iter().find(|(_, s)| {
        s.owner == owner_id
            && s.generation == owner_generation
            && s.grant == grant_id
            && !s.events.lock().map(|e| e.closed).unwrap_or(true)
    }) {
        return Ok(describe(id, session));
    }
    sessions.retain(|_, s| !s.events.lock().map(|e| e.closed).unwrap_or(true));
    if sessions.len() >= 4 {
        return Err("Close a native workspace before opening another (maximum four).".into());
    }
    let native_home = home
        .join(".rift/codex-native")
        .join(digest(owner_id.as_bytes()))
        .join(digest(cwd.to_string_lossy().as_bytes()));
    std::fs::create_dir_all(&native_home)
        .map_err(|_| "Could not create native session storage.")?;
    // Use the pinned engine's actual metadata with RIFT IDs, avoiding its degraded
    // unknown-model fallback. Standard Responses preserves tools without Lite-only input.
    let catalog: Value = serde_json::from_slice(
        &std::fs::read(
            binary
                .parent()
                .ok_or("Invalid native path.")?
                .join("models.json"),
        )
        .map_err(|_| "Native model catalog missing.")?,
    )
    .map_err(|_| "Invalid native model catalog.")?;
    let mut models = Vec::new();
    for allowed in relay.config["models"]
        .as_array()
        .ok_or("Invalid RIFT model configuration.")?
    {
        let slug = allowed["providerModel"]
            .as_str()
            .and_then(|s| s.strip_prefix("openai/"))
            .ok_or("Unsupported native provider.")?;
        let mut model = catalog["models"]
            .as_array()
            .and_then(|items| items.iter().find(|m| m["slug"] == slug))
            .cloned()
            .ok_or("Native model metadata unavailable. Update RIFT Desktop.")?;
        model["slug"] = allowed["id"].clone();
        model["display_name"] = allowed["label"].clone();
        model["use_responses_lite"] = json!(false);
        model["prefer_websockets"] = json!(false);
        model["input_modalities"] = json!(["text"]);
        model["supports_image_detail_original"] = json!(false);
        if let Some(levels) = model["supported_reasoning_levels"].as_array_mut() {
            levels.retain(|level| {
                allowed["efforts"]
                    .as_array()
                    .is_some_and(|items| items.contains(&level["effort"]))
            });
        }
        models.push(model);
    }
    let catalog_path = native_home.join("rift-models.json");
    std::fs::write(
        &catalog_path,
        serde_json::to_vec(&json!({"models":models})).map_err(|_| "Invalid model metadata.")?,
    )
    .map_err(|_| "Could not write native model catalog.")?;
    let mut command = Command::new(binary);
    command.current_dir(&cwd).env_clear();
    for name in [
        "HOME",
        "PATH",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "SHELL",
        "USER",
        "LOGNAME",
        "SystemRoot",
        "WINDIR",
    ] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    command.env("PATH", crate::platform::effective_path());
    command
        .env("RIFT_HOME", native_home)
        .env("RIFT_NATIVE_NONCE", &relay.nonce);
    for setting in [
        "model_provider=\"rift_native\"".to_owned(),
        format!("model={}", relay.config["defaultModel"]),
        "check_for_update_on_startup=false".into(),
        "web_search=\"disabled\"".into(),
        format!("model_catalog_json={}", json!(catalog_path)),
        "approval_policy=\"on-request\"".into(),
        "sandbox_mode=\"read-only\"".into(),
        "model_providers.rift_native.name=\"RIFT account\"".into(),
        format!(
            "model_providers.rift_native.base_url=\"http://127.0.0.1:{}\"",
            relay.port
        ),
        "model_providers.rift_native.env_key=\"RIFT_NATIVE_NONCE\"".into(),
        "model_providers.rift_native.wire_api=\"responses\"".into(),
        "model_providers.rift_native.requires_openai_auth=false".into(),
        "model_providers.rift_native.request_max_retries=0".into(),
        "model_providers.rift_native.stream_max_retries=0".into(),
        "model_providers.rift_native.supports_websockets=false".into(),
    ] {
        command.arg("-c").arg(setting);
    }
    let mut child = command
        .args(["app-server", "--listen", "stdio://"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Could not start packaged Codex app-server.")?;
    let stdin = Arc::new(Mutex::new(Some(
        child.stdin.take().ok_or("Native input missing.")?,
    )));
    let stdout = child.stdout.take().ok_or("Native output missing.")?;
    let tracker = crate::native_codex_process::ProcessTracker::start(child.id());
    let child = Arc::new(Mutex::new(child));
    let events = Arc::new(Mutex::new(Events::default()));
    let (reader_events, reader_stdin) = (events.clone(), stdin.clone());
    let reader_child = child.clone();
    let relay_abort = relay.abort_handle();
    monitor_child(
        stdout,
        reader_child,
        reader_stdin,
        reader_events,
        relay_abort,
        tracker.clone(),
    );

    let session = Session {
        owner: owner_id,
        generation: owner_generation,
        grant: grant_id,
        cwd,
        child,
        stdin,
        events,
        relay,
        tracker,
    };
    write_message(
        &session.stdin,
        &json!({"id":"__rift_init","method":"initialize","params":{"clientInfo":{"name":"rift_desktop","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}),
    )?;
    let id = uuid::Uuid::new_v4().to_string();
    let result = describe(&id, &session);
    sessions.insert(id, session);
    Ok(result)
}

fn monitor_child(
    stdout: impl Read + Send + 'static,
    reader_child: Arc<Mutex<Child>>,
    reader_stdin: NativeInput,
    reader_events: Arc<Mutex<Events>>,
    relay_abort: tokio::task::AbortHandle,
    tracker: Arc<crate::native_codex_process::ProcessTracker>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match (&mut reader).take(MAX_LINE_BYTES + 1).read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) if line.len() as u64 > MAX_LINE_BYTES => break,
                _ => {}
            }
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                break;
            };
            let Ok(mut state) = reader_events.lock() else {
                break;
            };
            if value["id"] == "__rift_init" {
                if value.get("error").is_none()
                    && write_message(&reader_stdin, &json!({"method":"initialized","params":{}}))
                        .is_ok()
                {
                    state.ready = true;
                } else {
                    state.push(json!({"method":"error","params":{"message":"Native Codex initialization failed."}}));
                    break;
                }
            } else {
                if value["method"] == "serverRequest/resolved" {
                    state
                        .approvals
                        .remove(&value["params"]["requestId"].to_string());
                }
                if value["method"] == "turn/completed" {
                    let thread = &value["params"]["threadId"];
                    state
                        .approvals
                        .retain(|_, request| &request["params"]["threadId"] != thread);
                }
                if value.get("method").is_some() && value.get("id").is_some() {
                    if state.approvals.len() >= 32 {
                        break;
                    }
                    state
                        .approvals
                        .insert(value["id"].to_string(), value.clone());
                }
                state.push(value);
            }
        }
        // A protocol/reader failure is a process failure, not just a detached UI.
        // Revoke model access and stop the old process before allowing a reopen.
        relay_abort.abort();
        crate::native_codex_process::terminate(&reader_child, &reader_stdin, &tracker);
        if let Ok(mut state) = reader_events.lock() {
            state.closed = true;
        }
    })
}

fn sanitize(method: &str, params: &Value, cwd: &Path, models: &Value) -> Result<Value, String> {
    let allowed: &[&str] = match method {
        "thread/start" => &["model"],
        "thread/resume" => &["threadId", "model"],
        "thread/read" => &["threadId", "includeTurns"],
        "turn/start" => &["threadId", "input", "model", "effort"],
        "turn/interrupt" => &["threadId", "turnId"],
        "mcpServerStatus/list" => &["cursor", "limit"],
        _ => return Err("Unsupported native console method.".into()),
    };
    let source = params.as_object().ok_or("Invalid native parameters.")?;
    if source.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err("Unsupported native console parameter.".into());
    }
    if let Some(model) = source.get("model") {
        if !models
            .as_array()
            .is_some_and(|items| items.iter().any(|m| m["id"] == *model))
        {
            return Err("Model is unavailable for this RIFT account.".into());
        }
    }
    for field in ["threadId", "turnId"] {
        if let Some(id) = source.get(field) {
            if !id.as_str().is_some_and(|s| {
                !s.is_empty()
                    && s.len() <= 128
                    && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            }) {
                return Err("Invalid native session identifier.".into());
            }
        }
    }
    let mut result = params.clone();
    if method == "thread/start" || method == "thread/resume" {
        result["cwd"] = json!(cwd);
        result["modelProvider"] = json!("rift_native");
        result["sandbox"] = json!("read-only");
        result["approvalPolicy"] = json!("on-request");
        result["developerInstructions"] = json!("You are RIFT running the native Codex engine. Use the granted project directory. Treat denied actions as denied; do not perform the same action by an alternate command or tool. Explain observed results and continue until the requested task is complete.");
    }
    if method == "turn/start" {
        let input = source
            .get("input")
            .and_then(Value::as_array)
            .ok_or("Missing native task text.")?;
        if input.is_empty()
            || input.len() > 16
            || input.iter().any(|i| {
                i["type"] != "text" || !i["text"].as_str().is_some_and(|s| s.len() <= 100_000)
            })
        {
            return Err("Native console accepts text input only.".into());
        }
        result["cwd"] = json!(cwd);
    }
    Ok(result)
}

#[tauri::command]
pub fn native_codex_send(
    state: tauri::State<'_, NativeCodexState>,
    terminal: tauri::State<'_, pty::DesktopProfilePtyState>,
    owner_id: String,
    owner_generation: u64,
    session_id: String,
    message: Value,
) -> Result<(), String> {
    let owner = terminal.lock().map_err(|_| "Terminal owner unavailable.")?;
    owner.authorize(&owner_id, owner_generation)?;
    let sessions = state.lock().map_err(|_| "Native state unavailable.")?;
    let session = sessions
        .get(&session_id)
        .filter(|s| s.owner == owner_id && s.generation == owner_generation)
        .ok_or("Native console session expired.")?;
    if message.to_string().len() > 1024 * 1024 {
        return Err("Native message is too large.".into());
    }
    if let Some(method) = message["method"].as_str() {
        if !message["id"]
            .as_str()
            .is_some_and(|id| id.starts_with("ui-") && id.len() <= 128)
        {
            return Err("Invalid native request identity.".into());
        }
        let params = sanitize(
            method,
            &message["params"],
            &session.cwd,
            &session.relay.config["models"],
        )?;
        write_message(
            &session.stdin,
            &json!({"id":message["id"],"method":method,"params":params}),
        )
    } else {
        let mut events = session
            .events
            .lock()
            .map_err(|_| "Native event state unavailable.")?;
        let id = message["id"].to_string();
        let response = approval_response(&events, &message)?;
        write_message(&session.stdin, &response)?;
        events.approvals.remove(&id);
        Ok(())
    }
}

fn approval_response(events: &Events, message: &Value) -> Result<Value, String> {
    let id = message["id"].to_string();
    let request = events
        .approvals
        .get(&id)
        .ok_or("Native approval expired.")?;
    let result = &message["result"];
    match request["method"].as_str() {
        Some("item/commandExecution/requestApproval" | "item/fileChange/requestApproval") => {
            if !matches!(
                result["decision"].as_str(),
                Some("accept" | "decline" | "cancel")
            ) {
                return Err("Unsupported approval decision.".into());
            }
        }
        Some("item/tool/requestUserInput") => {
            if !result["answers"].is_object() {
                return Err("Invalid question answer.".into());
            }
        }
        Some("mcpServer/elicitation/request") => {
            let params = &request["params"];
            if params["mode"] != "form"
                || params["_meta"]["codex_approval_kind"] != "mcp_tool_call"
                || params["requestedSchema"]["type"] != "object"
                || !params["requestedSchema"]["properties"]
                    .as_object()
                    .is_some_and(|properties| properties.is_empty())
                || !matches!(
                    result["action"].as_str(),
                    Some("accept" | "decline" | "cancel")
                )
                || !result["_meta"].is_null()
                || !(result["content"].is_null()
                    || result["content"]
                        .as_object()
                        .is_some_and(|content| content.is_empty()))
            {
                return Err("Unsupported MCP approval response.".into());
            }
            return Ok(json!({"id":request["id"],"result":{
                "action":result["action"],
                "content":if result["action"] == "accept" { json!({}) } else { Value::Null },
                "_meta":Value::Null
            }}));
        }
        _ => return Err("Unsupported native approval. Stop the task to continue safely.".into()),
    }
    Ok(json!({"id":request["id"],"result":result}))
}

#[tauri::command]
pub fn native_codex_poll(
    state: tauri::State<'_, NativeCodexState>,
    terminal: tauri::State<'_, pty::DesktopProfilePtyState>,
    owner_id: String,
    owner_generation: u64,
    session_id: String,
    after: u64,
) -> Result<Value, String> {
    let owner = terminal.lock().map_err(|_| "Terminal owner unavailable.")?;
    owner.authorize(&owner_id, owner_generation)?;
    let sessions = state.lock().map_err(|_| "Native state unavailable.")?;
    let session = sessions
        .get(&session_id)
        .filter(|s| s.owner == owner_id && s.generation == owner_generation)
        .ok_or("Native console session expired.")?;
    let events = session
        .events
        .lock()
        .map_err(|_| "Native events unavailable.")?;
    let result: Vec<_> = events
        .queue
        .iter()
        .filter(|(seq, _, _)| *seq > after)
        .take(200)
        .map(|(seq, value, _)| json!({"sequence":seq,"message":value}))
        .collect();
    Ok(
        json!({"events":result,"ready":events.ready,"closed":events.closed,"firstSequence":events.queue.front().map(|x|x.0).unwrap_or(1),"approvals":events.approvals.values().collect::<Vec<_>>()}),
    )
}

#[tauri::command]
pub fn native_codex_close(
    state: tauri::State<'_, NativeCodexState>,
    terminal: tauri::State<'_, pty::DesktopProfilePtyState>,
    owner_id: String,
    owner_generation: u64,
    session_id: String,
) -> Result<(), String> {
    let owner = terminal.lock().map_err(|_| "Terminal owner unavailable.")?;
    owner.authorize(&owner_id, owner_generation)?;
    let mut sessions = state.lock().map_err(|_| "Native state unavailable.")?;
    if sessions
        .get(&session_id)
        .is_some_and(|s| s.owner == owner_id && s.generation == owner_generation)
    {
        sessions.remove(&session_id);
    }
    Ok(())
}

#[cfg(test)]
#[path = "native_codex_tests.rs"]
mod tests;
