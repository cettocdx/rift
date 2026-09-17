use super::*;
#[test]
fn untrusted_parameters_cannot_change_workspace_provider_or_permissions() {
    let cwd = Path::new("/fixture");
    let models = json!([{"id":"build-codex"}]);
    for params in [
        json!({"cwd":"/private"}),
        json!({"modelProvider":"openai"}),
        json!({"config":{"sandbox_mode":"danger-full-access"}}),
        json!({"model":"unmetered"}),
    ] {
        assert!(sanitize("thread/start", &params, cwd, &models).is_err());
    }
    let started = sanitize(
        "thread/start",
        &json!({"model":"build-codex"}),
        cwd,
        &models,
    )
    .unwrap();
    assert_eq!(started["cwd"], "/fixture");
    assert_eq!(started["sandbox"], "read-only");
    assert!(sanitize("command/exec", &json!({}), cwd, &models).is_err());
    assert!(sanitize(
        "thread/resume",
        &json!({"threadId":"../../secret"}),
        cwd,
        &models
    )
    .is_err());
    assert!(sanitize(
        "turn/start",
        &json!({"threadId":"abc","input":[{"type":"localImage","path":"/secret"}]}),
        cwd,
        &models
    )
    .is_err());
}
#[test]
fn replay_is_bounded_and_keeps_monotonic_sequence() {
    let mut events = Events::default();
    for _ in 0..20 {
        events.push(json!({"text":"x".repeat(1024 * 1024)}));
    }
    assert!(events.bytes <= MAX_REPLAY_BYTES);
    assert_eq!(events.sequence, 20);
    assert!(events.queue.front().unwrap().0 > 1);
    assert_eq!(events.queue.back().unwrap().0, 20);
}

#[cfg(unix)]
#[tokio::test]
async fn malformed_reader_revokes_relay_and_reaps_process_before_reopen() {
    let mut child = Command::new("/bin/sh")
        .args(["-c", "printf 'invalid-json\\n'; exec sleep 30"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let stdin = Arc::new(Mutex::new(Some(child.stdin.take().unwrap())));
    let stdout = child.stdout.take().unwrap();
    let tracker = crate::native_codex_process::ProcessTracker::start(child.id());
    let child = Arc::new(Mutex::new(child));
    let events = Arc::new(Mutex::new(Events::default()));
    let relay = tokio::spawn(std::future::pending::<()>());
    let monitor = monitor_child(
        stdout,
        child.clone(),
        stdin,
        events.clone(),
        relay.abort_handle(),
        tracker,
    );
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while !events.lock().unwrap().closed {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    monitor.join().unwrap();
    assert!(child.lock().unwrap().try_wait().unwrap().is_some());
    assert!(relay.await.unwrap_err().is_cancelled());
}

#[cfg(unix)]
#[test]
fn detached_fixture_process() {
    if std::env::var("RIFT_DETACHED_FIXTURE").ok().as_deref() != Some("1") {
        return;
    }
    use std::os::unix::process::CommandExt;
    let mut command = Command::new("/bin/sh");
    command
        .args(["-c", "exec sleep 30"])
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut detached = command.spawn().unwrap();
    println!("RIFT_DETACHED_PID {}", detached.id());
    std::io::stdout().flush().unwrap();
    if std::env::var("RIFT_CRASH_FIXTURE").ok().as_deref() == Some("1") {
        std::thread::sleep(std::time::Duration::from_millis(500));
        std::process::exit(7);
    }
    let _ = detached.wait();
}

#[cfg(unix)]
#[test]
fn native_teardown_stops_detached_tools_without_killing_unrelated_processes() {
    let mut fixture = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "native_codex::tests::detached_fixture_process",
            "--nocapture",
        ])
        .env("RIFT_DETACHED_FIXTURE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut reader = BufReader::new(fixture.stdout.take().unwrap());
    let detached = loop {
        let mut line = String::new();
        assert!(reader.read_line(&mut line).unwrap() > 0);
        if let Some((_, pid)) = line.split_once("RIFT_DETACHED_PID ") {
            break pid.trim().parse::<i32>().unwrap();
        }
    };
    let mut unrelated = Command::new("/bin/sh")
        .args(["-c", "exec sleep 30"])
        .spawn()
        .unwrap();
    let input = Arc::new(Mutex::new(fixture.stdin.take()));
    let tracker = crate::native_codex_process::ProcessTracker::start(fixture.id());
    let fixture = Mutex::new(fixture);
    crate::native_codex_process::terminate(&fixture, &input, &tracker);
    assert!(fixture.lock().unwrap().try_wait().unwrap().is_some());
    assert!(unrelated.try_wait().unwrap().is_none());
    let _ = unrelated.kill();
    let _ = unrelated.wait();
    // The detached child may remain a zombie until launchd reaps it; it cannot run.
    let status = Command::new("/bin/ps")
        .args(["-o", "stat=", "-p", &detached.to_string()])
        .output()
        .unwrap();
    let state = String::from_utf8_lossy(&status.stdout);
    assert!(
        state.trim().is_empty() || state.trim().starts_with('Z'),
        "detached tool survived: {state}"
    );
}

#[cfg(unix)]
#[test]
fn native_teardown_reaps_retained_detached_tools_after_root_crashes() {
    let mut fixture = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "native_codex::tests::detached_fixture_process",
            "--nocapture",
        ])
        .env("RIFT_DETACHED_FIXTURE", "1")
        .env("RIFT_CRASH_FIXTURE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let tracker = crate::native_codex_process::ProcessTracker::start(fixture.id());
    let mut reader = BufReader::new(fixture.stdout.take().unwrap());
    let detached = loop {
        let mut line = String::new();
        assert!(reader.read_line(&mut line).unwrap() > 0);
        if let Some((_, pid)) = line.split_once("RIFT_DETACHED_PID ") {
            break pid.trim().parse::<i32>().unwrap();
        }
    };
    assert_eq!(fixture.wait().unwrap().code(), Some(7));
    let input = Arc::new(Mutex::new(fixture.stdin.take()));
    crate::native_codex_process::terminate(&Mutex::new(fixture), &input, &tracker);
    let status = Command::new("/bin/ps")
        .args(["-o", "stat=", "-p", &detached.to_string()])
        .output()
        .unwrap();
    let state = String::from_utf8_lossy(&status.stdout);
    assert!(
        state.trim().is_empty() || state.trim().starts_with('Z'),
        "detached tool survived root crash: {state}"
    );
}

#[test]
fn approval_responses_keep_original_id_and_cannot_approve_expired_or_session_wide_requests() {
    let mut events = Events::default();
    events.approvals.insert(
        "42".into(),
        json!({"id":42,"method":"item/commandExecution/requestApproval","params":{"threadId":"t"}}),
    );
    assert!(approval_response(&events, &json!({"id":43,"result":{"decision":"accept"}})).is_err());
    assert!(approval_response(
        &events,
        &json!({"id":42,"result":{"decision":"acceptForSession"}})
    )
    .is_err());
    assert_eq!(
        approval_response(&events, &json!({"id":42,"result":{"decision":"decline"}})).unwrap(),
        json!({"id":42,"result":{"decision":"decline"}})
    );
    events.approvals.remove("42");
    assert!(approval_response(&events, &json!({"id":42,"result":{"decision":"accept"}})).is_err());
    events.approvals.insert("\"q\"".into(),json!({"id":"q","method":"item/tool/requestUserInput","params":{"questions":[{"id":"q1"}]}}));
    assert_eq!(
        approval_response(
            &events,
            &json!({"id":"q","result":{"answers":{"q1":{"answers":["yes"]}}}})
        )
        .unwrap()["result"]["answers"]["q1"]["answers"],
        json!(["yes"])
    );
}

#[test]
fn mcp_confirmation_is_once_only_and_rejects_input_forms() {
    let mut events = Events::default();
    let request = json!({"id":7,"method":"mcpServer/elicitation/request","params":{
        "mode":"form","_meta":{"codex_approval_kind":"mcp_tool_call"},
        "requestedSchema":{"type":"object","properties":{}}
    }});
    events.approvals.insert("7".into(), request);
    for action in ["accept", "decline", "cancel"] {
        let response = approval_response(
            &events,
            &json!({"id":7,"result":{"action":action,"content":{},"_meta":null}}),
        )
        .unwrap();
        assert_eq!(response["id"], 7);
        assert_eq!(response["result"]["action"], action);
        assert_eq!(
            response["result"]["content"],
            if action == "accept" {
                json!({})
            } else {
                Value::Null
            }
        );
    }
    assert!(approval_response(
        &events,
        &json!({"id":7,"result":{"action":"accept","_meta":{"persist":"always"}}})
    )
    .is_err());
    events.approvals.get_mut("7").unwrap()["params"]["requestedSchema"]["properties"] =
        json!({"secret":{"type":"string"}});
    assert!(approval_response(
        &events,
        &json!({"id":7,"result":{"action":"accept","content":{}}})
    )
    .is_err());
}
