import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import socket
import subprocess
import sys
import signal
import time
import tempfile
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock


HERE = Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


native = load("rift_native_cli", "native-cli.py")
sys.modules["native_cli"] = native
installer = load("rift_native_installer", "install-native-cli.py")
opencode = load("rift_opencode_cli", "opencode_cli.py")


class OpenCodeLauncherTests(unittest.TestCase):
    config = {"ownerId": "owner-opencode", "defaultModel": "build-fable", "models": [
        {"id": "build-fable", "label": "Fable", "providerModel": "anthropic/claude-fable-5.1", "contextTokens": 1000000, "maxOutputTokens": 16384, "reasoning": {"type": "levels"}},
        {"id": "build-qwen", "label": "Qwen", "providerModel": "qwen/qwen3.8-max", "contextTokens": 1000000, "maxOutputTokens": 16384, "reasoning": {"control": "toggle"}},
    ]}

    def test_engine_selection_and_model_parsing(self):
        self.assertEqual(native.requested_model(["exec", "-m", "build-fable", "hello"]), "build-fable")
        self.assertEqual(native.requested_model(["--model=rift/build-qwen"]), "build-qwen")
        self.assertIsNone(native.requested_model(["--", "--model", "build-fable"]))
        self.assertEqual(opencode.normalize_arguments(["exec", "-m", "build-fable", "hello"]), ["run", "-m", "rift/build-fable", "hello"])

    def test_remote_auto_and_hidden_root_commands_are_rejected(self):
        rejected = [
            ["run", "prompt", "--attach", "https://example.test"],
            ["run", "--attach=https://example.test", "prompt"], ["run", "--auto", "prompt"],
            ["run", "--password", "secret", "prompt"], ["run", "--username=user", "prompt"],
            ["--log-level", "INFO", "attach", "https://example.test"],
            ["-m", "build-fable", "serve"], ["--model", "build-fable", "attach", "url"],
        ]
        for arguments in rejected:
            with self.subTest(arguments=arguments), self.assertRaises(native.CliError):
                opencode.validate_arguments(arguments)
        opencode.validate_arguments(["run", "--", "--auto", "attach", "--password=literal"])
        opencode.validate_arguments(["run", "serve is literal prompt text"])

    def test_pinned_argument_resolution(self):
        prefixes = [[flag, "literal"] for flag, arity in {**opencode.COMMON_OPTIONS, **opencode.TUI_OPTIONS}.items() if arity == "value"]
        prefixes += [[flag + "=literal"] for flag, arity in {**opencode.COMMON_OPTIONS, **opencode.TUI_OPTIONS}.items() if arity == "value"]
        prefixes += [["-sliteral"], ["-s", "literal"], ["-mliteral"], ["-m", "literal"], ["-c"], ["--continue", "false"]]
        for prefix in prefixes:
            for command in ("attach", "serve", "web", "acp"):
                with self.subTest(prefix=prefix, command=command), self.assertRaises(native.CliError):
                    opencode.validate_arguments([*prefix, command])
        for prefix in (["-m", "build-fable"], ["--model=build-fable"], ["-mbuild-fable"]):
            normalized = opencode.normalize_arguments([*prefix, "exec", "hello"])
            self.assertIn("run", normalized)
            self.assertNotIn("exec", normalized)
        for args in (["--prompt", "exec"], ["--prompt=-mbuild-fable"],
                     ["run", "--title=--auto"], ["run", "--", "exec", "--model=literal"]):
            self.assertEqual(opencode.normalize_arguments(args), args)
        for args in (["--unknown", "literal", "attach"], ["--file", "literal", "attach"],
                     ["-xyz", "serve"], ["--model"], ["project", "attach"], ["run", "--json"]):
            with self.subTest(args=args), self.assertRaises(native.CliError):
                opencode.validate_arguments(args)
        self.assertEqual(opencode.normalize_arguments(["-sliteral", "exec", "hello"]), ["--session=literal", "run", "hello"])
        opencode.validate_arguments(["-c", "-s", "session-id", "--prompt", "attach"])
        opencode.validate_arguments(["run", "-c", "-s", "session-id", "-f", "a", "b", "--", "prompt"])

    def test_argument_rejection_precedes_account_access(self):
        with tempfile.TemporaryDirectory() as root:
            bundle = Path(root)
            (bundle / "opencode").touch()
            with mock.patch.dict(sys.modules, {native.__name__: native}), mock.patch.object(native, "__file__", str(bundle / "native-cli.py")), mock.patch.object(native, "validate_login") as login, mock.patch.object(native, "legacy") as legacy, mock.patch.object(native.subprocess, "run") as child:
                for args in (["--prompt", "literal", "attach", "http://127.0.0.1:9"],
                             ["--prompt", "literal", "serve"], ["--help", "--prompt", "literal", "attach"],
                             ["--unknown", "literal", "serve"], ["run", "--json"], ["-psecret", "run"]):
                    with self.subTest(args=args):
                        self.assertEqual(native.main(["opencode", *args]), 1)
                        self.assertEqual(native.main(["-m", "build-fable", *args]), 1)
                login.assert_not_called()
                legacy.assert_not_called()
                child.assert_not_called()

    def test_help_boolean_false_cannot_launch_without_account(self):
        with tempfile.TemporaryDirectory() as root:
            bundle = Path(root)
            (bundle / "opencode").touch()
            with mock.patch.dict(sys.modules, {native.__name__: native}), mock.patch.object(native, "__file__", str(bundle / "native-cli.py")), mock.patch.object(Path, "home", return_value=bundle), mock.patch.object(native.subprocess, "run") as child:
                for args in (["--help", "false"], ["--help", "--help=false"], ["--version", "false"]):
                    self.assertEqual(native.main(["opencode", *args]), 1)
                child.assert_not_called()

    @unittest.skipUnless(Path("/tmp/rift-opencode-v1.18.31/opencode").is_file(), "pinned official OpenCode fixture unavailable")
    def test_official_binary_root_argument_contract(self):
        binary = "/tmp/rift-opencode-v1.18.31/opencode"
        with tempfile.TemporaryDirectory() as root:
            env = native.child_environment()
            env.update({"HOME": root, "XDG_CONFIG_HOME": root, "XDG_DATA_HOME": root,
                        "XDG_CACHE_HOME": root, "XDG_STATE_HOME": root,
                        "OPENCODE_DISABLE_MODELS_FETCH": "1", "OPENCODE_DISABLE_PROJECT_CONFIG": "1",
                        "OPENCODE_DISABLE_AUTOUPDATE": "1", "OPENCODE_DISABLE_EXTERNAL_SKILLS": "1"})
            for args in (["--prompt", "literal", "attach"], ["--prompt", "literal", "serve"],
                         ["--session", "literal", "attach"], ["-s", "literal", "attach"],
                         ["--replay-limit", "3", "attach"], ["--agent", "literal", "attach"]):
                with self.subTest(args=args):
                    result = subprocess.run([binary, "--pure", *args, "--help"], env=env, capture_output=True, text=True, timeout=15)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn("opencode " + args[-1], (result.stdout + result.stderr).splitlines()[0])
                    with self.assertRaises(native.CliError): opencode.validate_arguments(args)
            for prefix in (["-m", "build-fable"], ["--model=build-fable"], ["-mbuild-fable"]):
                args = opencode.normalize_arguments([*prefix, "exec", "hello"])
                result = subprocess.run([binary, "--pure", *args, "--help"], env=env, capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("opencode run [message..]", (result.stdout + result.stderr).splitlines()[0])

    def test_generated_config_is_isolated_and_asks_before_mutation(self):
        value = opencode.generated_config(self.config, "http://127.0.0.1:1", "nonce", "build-qwen")
        self.assertEqual(value["model"], "rift/build-qwen")
        self.assertEqual(value["small_model"], value["model"])
        self.assertEqual(value["provider"]["rift"]["npm"], "@ai-sdk/openai")
        self.assertEqual(value["provider"]["rift"]["options"]["baseURL"], "http://127.0.0.1:1")
        self.assertFalse(value["provider"]["rift"]["models"]["build-qwen"]["reasoning"])
        self.assertEqual(value["provider"]["rift"]["models"]["build-fable"]["options"]["store"], False)
        self.assertEqual(value["permission"], {"read": "allow", "glob": "allow", "grep": "allow", "list": "allow", "bash": "ask", "edit": "ask", "write": "ask", "patch": "ask", "external_directory": "ask"})

    def test_child_has_private_home_xdg_and_no_parent_provider_credentials(self):
        captured = {}
        def fake(command, cwd, env): captured.update(command=command, cwd=cwd, env=env); return 0
        with tempfile.TemporaryDirectory() as root, mock.patch.object(opencode, "run_managed_process", side_effect=fake), mock.patch.dict(os.environ, {"OPENAI_API_KEY": "secret", "ANTHROPIC_API_KEY": "secret"}):
            bundle = Path(root); (bundle / "opencode").write_text("")
            self.assertEqual(opencode.run_child(bundle, self.config, "http://127.0.0.1:1", "nonce", ["run", "hello"], bundle), 0)
        self.assertEqual(captured["command"][1:3], ["--pure", "run"])
        self.assertNotIn("OPENAI_API_KEY", captured["env"]); self.assertNotIn("ANTHROPIC_API_KEY", captured["env"])
        for key in ("HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"): self.assertIn(key, captured["env"])
        self.assertEqual(captured["env"]["OPENCODE_DISABLE_PROJECT_CONFIG"], "1")

    def test_failure_adapter_normalizes_failed_missing_and_preheader_failures(self):
        class FailureUpstream(BaseHTTPRequestHandler):
            mode = "failed"; seen = 0
            def log_message(self, *_args): pass
            def do_POST(self):
                self.__class__.seen += 1; self.rfile.read(int(self.headers["Content-Length"]))
                if self.mode == "http": self.send_response(503); self.end_headers(); return
                self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
                self.wfile.write(b'data: {"type":"response.created","response":{"id":"x"}}\n\n')
                if self.mode == "failed": self.wfile.write(b'data: {"type":"response.failed","response":{}}\n\n')
                elif self.mode == "null": self.wfile.write(b'data: {"type":"response.completed","response":null}\n\n')
                elif self.mode == "list": self.wfile.write(b'data: {"type":"response.completed","response":[]}\n\n')
                elif self.mode == "nonobject": self.wfile.write(b'data: []\n\n')
                elif self.mode == "typeless": self.wfile.write(b'data: {"response":{}}\n\n')
        upstream = ThreadingHTTPServer(("127.0.0.1", 0), FailureUpstream); thread = threading.Thread(target=upstream.serve_forever, daemon=True); thread.start()
        relay = opencode.OpenCodeRelay(f"http://127.0.0.1:{upstream.server_port}", "rift_live_x").start()
        try:
            for mode in ("failed", "missing", "null", "list", "nonobject", "typeless", "http"):
                FailureUpstream.mode = mode
                request = urllib.request.Request(relay.base_url + "/v1/responses", data=b'{}', headers={"Authorization": "Bearer " + relay.nonce}, method="POST")
                try:
                    with urllib.request.urlopen(request) as response: status, body = response.status, response.read()
                except urllib.error.HTTPError as error: status, body = error.code, error.read()
                if mode == "http": self.assertEqual(status, 400); self.assertEqual(json.loads(body)["error"]["type"], "invalid_request_error")
                else: self.assertEqual(status, 200); self.assertIn(b'"type":"error"', body); self.assertNotIn(b'response.failed', body)
            self.assertEqual(FailureUpstream.seen, 7)
        finally:
            relay.close(); upstream.shutdown(); upstream.server_close(); thread.join()

    @unittest.skipUnless(Path("/tmp/rift-opencode-v1.18.31/opencode").is_file(), "pinned official OpenCode fixture unavailable")
    def test_actual_official_binary_sees_one_main_request_through_failure_adapter(self):
        class ActualUpstream(BaseHTTPRequestHandler):
            title = 0; main = 0; mode = "failed"; fixture = ""
            def log_message(self, *_args): pass
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                mode = self.mode
                if body.get("tools") and mode == "chunked_truncation":
                    self.__class__.main += 1
                    self.connection.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n20\r\ndata: {\"type\":\"response.created\"}")
                    self.close_connection = True; return
                if body.get("tools") and mode in {"http", "slow_headers", "slow_drip"}:
                    self.__class__.main += 1
                    if mode == "slow_headers": time.sleep(1.2)
                    if mode == "slow_drip":
                        try:
                            self.connection.sendall(b"HTTP/1.1 200 OK\r\nX-Slow: ")
                            for _ in range(6): self.connection.sendall(b"a"); time.sleep(0.2)
                        except OSError: pass
                        return
                    self.send_response(503); self.end_headers(); return
                self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
                if not body.get("tools"):
                    self.__class__.title += 1
                    message = {"type":"message","id":"msg_title","role":"assistant","status":"completed","content":[{"type":"output_text","text":"Failure fixture","annotations":[]}]}
                    events = [
                        {"type":"response.created","response":{"id":"resp_title","created_at":1,"model":"build-fable","service_tier":None}},
                        {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_title","phase":"final_answer"}},
                        {"type":"response.content_part.added","item_id":"msg_title","output_index":0,"content_index":0,"part":{"type":"output_text","text":"","annotations":[]}},
                        {"type":"response.output_text.delta","item_id":"msg_title","output_index":0,"content_index":0,"delta":"Failure fixture"},
                        {"type":"response.output_text.done","item_id":"msg_title","output_index":0,"content_index":0,"text":"Failure fixture"},
                        {"type":"response.content_part.done","item_id":"msg_title","output_index":0,"content_index":0,"part":{"type":"output_text","text":"Failure fixture","annotations":[]}},
                        {"type":"response.output_item.done","output_index":0,"item":message},
                        {"type":"response.completed","response":{"id":"resp_title","status":"completed","model":"build-fable","output":[message],"usage":{"input_tokens":5,"output_tokens":2,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":0}}}},
                    ]
                else:
                    self.__class__.main += 1
                    terminal = {"failed": {"type":"response.failed","response":{}}, "incomplete": {"type":"response.incomplete","response":{}}, "malformed_null": {"type":"response.completed","response":None}, "malformed_list": {"type":"response.completed","response":[]}, "typeless": {"response":{}}}.get(mode)
                    events = [{"type":"response.created","response":{"id":"resp_main","created_at":2,"model":"build-fable"}}]
                    if terminal: events.append(terminal)
                    if mode == "success":
                        has_output = any(item.get("type") == "function_call_output" for item in body.get("input", []) if isinstance(item, dict))
                        if not has_output:
                            args = json.dumps({"filePath": "fixture.txt"}); call = {"type":"function_call","id":"fc_1","call_id":"call_1","name":"read","arguments":args,"status":"completed"}
                            events += [{"type":"response.output_item.added","output_index":0,"item":{**call,"status":None}}, {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"delta":args}, {"type":"response.function_call_arguments.done","item_id":"fc_1","output_index":0,"arguments":args}, {"type":"response.output_item.done","output_index":0,"item":call}, {"type":"response.completed","response":{"id":"resp_call","status":"completed","model":"build-fable","output":[call],"usage":{"input_tokens":10,"output_tokens":3,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":0}}}}]
                        else:
                            text = "FINAL_OK RIFT_OPENCODE_FIXTURE_271828"; message = {"type":"message","id":"msg_final","role":"assistant","status":"completed","content":[{"type":"output_text","text":text,"annotations":[]}]}
                            events += [{"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_final","phase":"final_answer"}}, {"type":"response.content_part.added","item_id":"msg_final","output_index":0,"content_index":0,"part":{"type":"output_text","text":"","annotations":[]}}, {"type":"response.output_text.delta","item_id":"msg_final","output_index":0,"content_index":0,"delta":text}, {"type":"response.output_text.done","item_id":"msg_final","output_index":0,"content_index":0,"text":text}, {"type":"response.content_part.done","item_id":"msg_final","output_index":0,"content_index":0,"part":{"type":"output_text","text":text,"annotations":[]}}, {"type":"response.output_item.done","output_index":0,"item":message}, {"type":"response.completed","response":{"id":"resp_final","status":"completed","model":"build-fable","output":[message],"usage":{"input_tokens":20,"output_tokens":4,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":0}}}}]
                for event in events: self.wfile.write(("data: " + json.dumps(event) + "\n\n").encode()); self.wfile.flush()
                if mode == "stalled": time.sleep(1.2)
                if mode == "slow_sse_drip":
                    try:
                        for _ in range(6): self.wfile.write(b": keepalive\n\n"); self.wfile.flush(); time.sleep(0.2)
                    except OSError: pass
                if mode not in {"truncated", "stalled", "slow_sse_drip"}: self.wfile.write(b"data: [DONE]\n\n")
        upstream = ThreadingHTTPServer(("127.0.0.1", 0), ActualUpstream); thread = threading.Thread(target=upstream.serve_forever, daemon=True); thread.start()
        relay = opencode.OpenCodeRelay(f"http://127.0.0.1:{upstream.server_port}", "rift_live_fixture", client_timeout=0.6).start()
        try:
            requested_mode = os.environ.get("RIFT_OPENCODE_TEST_MODE")
            modes = (requested_mode,) if requested_mode else ("http", "failed", "incomplete", "truncated", "chunked_truncation", "malformed_null", "malformed_list", "typeless", "slow_headers", "slow_drip", "stalled", "slow_sse_drip")
            for mode in modes:
                with self.subTest(mode=mode), tempfile.TemporaryDirectory() as root:
                    ActualUpstream.mode = mode; before_title, before_main = ActualUpstream.title, ActualUpstream.main
                    bundle = Path(root) / "bundle"; bundle.mkdir(); (bundle / "opencode").symlink_to("/tmp/rift-opencode-v1.18.31/opencode")
                    work = Path(root) / "work"; work.mkdir()
                    result = opencode.run_child(bundle, {**self.config, "ownerId": "owner-" + mode}, relay.base_url, relay.nonce,
                        ["run", "Reply with one word after inspecting the workspace.", "--model", "rift/build-fable", "--format", "json", "--dir", str(work)], work, "build-fable")
                    self.assertNotEqual(result, 0)
                    self.assertEqual(ActualUpstream.title - before_title, 1)
                    self.assertEqual(ActualUpstream.main - before_main, 1)
            if requested_mode: return
            with tempfile.TemporaryDirectory() as root:
                ActualUpstream.mode = "success"; before_main = ActualUpstream.main
                bundle = Path(root) / "bundle"; bundle.mkdir(); (bundle / "opencode").symlink_to("/tmp/rift-opencode-v1.18.31/opencode")
                work = Path(root) / "work"; work.mkdir(); subprocess.run(["git", "init", "-q", str(work)], check=True)
                fixture = work / "fixture.txt"; fixture.write_text("RIFT_OPENCODE_FIXTURE_271828\n"); ActualUpstream.fixture = str(fixture)
                result = opencode.run_child(bundle, {**self.config, "ownerId": "owner-success"}, relay.base_url, relay.nonce,
                    ["run", "Read fixture.txt with the read tool, then reply exactly FINAL_OK and the file content.", "--model", "rift/build-fable", "--format", "json", "--dir", str(work)], work, "build-fable")
                self.assertEqual(result, 0); self.assertEqual(ActualUpstream.main - before_main, 2)
        finally:
            relay.close(); upstream.shutdown(); upstream.server_close(); thread.join()


class NativeArgumentTests(unittest.TestCase):
    def test_command_words_are_allowed_as_exec_prompts(self):
        for word in ("cloud", "app", "agents"):
            for prefix in ([], ["--model", "cloud"], ["-mapp"], ["--model=agents"]):
                with self.subTest(word=word, prefix=prefix):
                    native.validate_native_arguments([*prefix, "exec", word])

    def test_root_commands_are_blocked_after_option_values(self):
        for word in ("cloud", "app", "agents"):
            for prefix in ([], ["--model", "cloud"], ["-m", "app"], ["-magents"],
                           ["--model=agents"], ["--config", 'model="cloud"'], ["--full-auto"]):
                with self.subTest(word=word, prefix=prefix), self.assertRaises(native.CliError):
                    native.validate_native_arguments([*prefix, word])

    def test_selectors_remain_blocked_after_exec_and_prompt(self):
        for selector in ("--oss", "--local-provider=ollama", "--remote=ws://localhost:9",
                         "--remote-auth-token-env=X", "--profile=other", "-pother", "-hpother"):
            with self.subTest(selector=selector), self.assertRaises(native.CliError):
                native.validate_native_arguments(["exec", "cloud", selector])
        native.validate_native_arguments(["exec", "--", "cloud", "--oss", "-pother"])


class Upstream(BaseHTTPRequestHandler):
    config = {
        "ownerId": "owner-1",
        "defaultModel": "build-codex",
        "models": [{
            "id": "build-codex", "label": "Build", "providerModel": "openai/gpt-5.6-sol",
            "efforts": ["medium", "high"],
        }],
    }
    seen = []

    def log_message(self, *_args):
        pass

    def do_GET(self):
        self.__class__.seen.append((self.command, self.path, self.headers, b""))
        body = json.dumps(self.config).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        self.__class__.seen.append((self.command, self.path, self.headers, body))
        events = [
            {"type": "response.created", "response": {"id": "resp_0"}},
            {"type": "response.output_item.done", "item": {"type": "message", "role": "assistant", "id": "msg_done", "content": [{"type": "output_text", "text": "LOCAL_ROUTE_OK"}]}},
            {"type": "response.completed", "response": {"id": "resp_0", "status": "completed", "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}}},
        ]
        response = "".join("data: " + json.dumps(event) + "\n\n" for event in events).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)


class NativeCliTests(unittest.TestCase):
    def setUp(self):
        Upstream.seen = []
        self.upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        self.thread = threading.Thread(target=self.upstream.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.upstream.server_port}"

    def tearDown(self):
        if self.upstream is not None:
            self.upstream.shutdown()
            self.upstream.server_close()
            self.thread.join()

    def test_login_allows_only_saved_rift_origins_and_never_formats_key(self):
        for origin in ("https://riftsys.app", "http://localhost:3020", "http://localhost:3022"):
            self.assertEqual(native.validate_login({"app": origin, "apiKey": "rift_live_secret"})[0], origin)
        with self.assertRaisesRegex(native.CliError, "server"):
            native.validate_login({"app": "https://evil.example", "apiKey": "rift_live_secret"})
        error = native.CliError.service(401, "rift_live_secret")
        self.assertNotIn("rift_live_secret", str(error))

    def test_gateway_disables_environment_proxy_resolution(self):
        response = mock.MagicMock()
        opener = mock.Mock()
        opener.open.return_value = response
        with mock.patch.object(native.urllib.request, "build_opener", return_value=opener) as build:
            self.assertIs(native.gateway_request("https://riftsys.app", "rift_live_secret", "GET", "/x"), response)
        proxy_handlers = [item for item in build.call_args.args if isinstance(item, native.urllib.request.ProxyHandler)]
        self.assertEqual(len(proxy_handlers), 1)
        self.assertEqual(proxy_handlers[0].proxies, {})

    def test_relay_requires_nonce_exact_route_and_bounded_body(self):
        relay = native.Relay(self.origin, "rift_live_secret", "nonce-123", max_body=16)
        relay.start()
        self.addCleanup(relay.close)
        import urllib.error
        import urllib.request

        def request(path="/responses", token="nonce-123", body=b"{}"):
            req = urllib.request.Request(
                relay.base_url + path, data=body,
                headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=2) as result:
                    return result.status, result.read()
            except urllib.error.HTTPError as error:
                try:
                    return error.code, error.read()
                finally:
                    error.close()

        self.assertEqual(request()[0], 200)
        self.assertEqual(request("/other")[0], 404)
        self.assertEqual(request(token="wrong")[0], 403)
        self.assertEqual(request(body=b"x" * 17)[0], 413)
        self.assertEqual(len(Upstream.seen), 1)
        method, path, headers, _ = Upstream.seen[0]
        self.assertEqual((method, path), ("POST", "/api/console/native/responses"))
        self.assertEqual(headers["Authorization"], "Bearer rift_live_secret")

    def test_relay_caps_idle_clients_before_header_parsing(self):
        relay = native.Relay(self.origin, "rift_live_secret", "nonce", max_concurrent=2, client_timeout=.2).start()
        self.addCleanup(relay.close)
        clients = [socket.create_connection(("127.0.0.1", relay.server.server_port)) for _ in range(3)]
        self.addCleanup(lambda: [client.close() for client in clients])
        clients[0].sendall(b"POST /responses HTTP/1.1\r\n")
        clients[1].sendall(b"POST /responses HTTP/1.1\r\n")
        clients[2].settimeout(1)
        self.assertEqual(clients[2].recv(1), b"")

    def test_relay_close_terminates_stalled_active_clients(self):
        relay = native.Relay(self.origin, "rift_live_secret", "nonce", client_timeout=30).start()
        client = socket.create_connection(("127.0.0.1", relay.server.server_port))
        client.sendall(b"POST /responses HTTP/1.1\r\n")
        relay.close()
        client.settimeout(1)
        try:
            try:
                self.assertEqual(client.recv(1), b"")
            except ConnectionResetError:
                pass
            self.assertEqual(relay.active_count, 0)
        finally:
            client.close()

    def test_catalog_maps_gateway_ids_to_packaged_metadata(self):
        source = {"models": [{
            "slug": "gpt-5.6-sol", "display_name": "Sol", "use_responses_lite": True,
            "prefer_websockets": True, "input_modalities": ["text", "image"],
            "supported_reasoning_levels": [{"effort": "low"}, {"effort": "medium"}, {"effort": "high"}],
        }]}
        mapped = native.map_catalog(source, Upstream.config)
        model = mapped["models"][0]
        self.assertEqual((model["slug"], model["display_name"]), ("build-codex", "Build"))
        self.assertEqual([x["effort"] for x in model["supported_reasoning_levels"]], ["medium", "high"])
        self.assertFalse(model["use_responses_lite"])
        self.assertFalse(model["prefer_websockets"])
        self.assertEqual(model["input_modalities"], ["text"])

    def test_gateway_config_requires_account_owner_metadata(self):
        original = Upstream.config
        Upstream.config = {"models": [], "defaultModel": "build-codex"}
        try:
            with self.assertRaisesRegex(native.CliError, "owner"):
                native.fetch_config(self.origin, "rift_live_secret")
        finally:
            Upstream.config = original

    def test_child_preserves_cwd_args_and_isolates_provider_credentials(self):
        config = Upstream.config
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "models.json").write_text(json.dumps({"models": [{
                "slug": "gpt-5.6-sol", "supported_reasoning_levels": [{"effort": "medium"}, {"effort": "high"}],
            }]}))
            captured = {}

            def fake_run(args, cwd, env):
                captured.update(args=args, kwargs={"cwd": cwd, "env": env})
                return 7

            with mock.patch.dict(os.environ, {
                "OPENAI_API_KEY": "openai-secret", "RIFT_API_KEY": "rift_live_parent",
                "ANTHROPIC_API_KEY": "anthropic-secret",
            }), mock.patch.object(native, "run_managed_process", side_effect=fake_run):
                status = native.run_child(root, config, "http://127.0.0.1:9", "nonce", ["exec", "hello"], root)
            self.assertEqual(status, 7)
            self.assertEqual(captured["kwargs"]["cwd"], root)
            self.assertEqual(captured["args"][1:3], ["exec", "hello"])
            env = captured["kwargs"]["env"]
            self.assertEqual(env["RIFT_NATIVE_NONCE"], "nonce")
            self.assertNotIn("OPENAI_API_KEY", env)
            self.assertNotIn("RIFT_API_KEY", env)
            self.assertNotIn("rift_live", json.dumps(env))
            joined = " ".join(captured["args"])
            self.assertIn('approval_policy="on-request"', joined)
            self.assertIn('sandbox_mode="read-only"', joined)

    def test_real_packaged_exec_with_exec_local_config_still_uses_relay(self):
        bundle = Path("/Applications/RIFT UI Preview.app/Contents/Resources/native-codex")
        if not (bundle / "rift").is_file():
            self.skipTest("packaged native executable unavailable")
        relay = native.Relay(self.origin, "rift_live_secret", "real-route-nonce").start()
        self.addCleanup(relay.close)
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(native.Path, "home", return_value=Path(tmp)):
            status = native.run_child(
                bundle, Upstream.config, relay.base_url, relay.nonce,
                ["exec", "--skip-git-repo-check", "--json", "-c", 'model_reasoning_effort="low"',
                 "-c", 'model_provider="openai"', "-c", 'model_providers.rift_native.base_url="http://127.0.0.1:1"',
                 "reply briefly"],
                Path(tmp),
            )
        self.assertEqual(status, 0)
        self.assertTrue(any(method == "POST" and path == "/api/console/native/responses" for method, path, _, _ in Upstream.seen))

    def test_real_packaged_delimiter_keeps_config_in_exec_scope(self):
        bundle = Path("/Applications/RIFT UI Preview.app/Contents/Resources/native-codex")
        if not (bundle / "rift").is_file():
            self.skipTest("packaged native executable unavailable")
        relay = native.Relay(self.origin, "rift_live_secret", "delimiter-nonce").start()
        self.addCleanup(relay.close)
        # The hostile provider is also loopback: a regression must never call a paid API.
        hostile = ('model_providers.decoy={name="decoy",base_url="' + self.origin +
                   '",env_key="RIFT_NATIVE_NONCE",wire_api="responses",requires_openai_auth=false}')
        for config_args in (["-c", hostile], ["--config=" + hostile], ["-c" + hostile]):
            with self.subTest(config_args=config_args), tempfile.TemporaryDirectory() as tmp:
                Upstream.seen = []
                with mock.patch.object(native.Path, "home", return_value=Path(tmp)):
                    status = native.run_child(
                        bundle, Upstream.config, relay.base_url, relay.nonce,
                        ["-c", 'model_reasoning_effort="low"', "exec", "--skip-git-repo-check", "--json",
                         *config_args, "-c", 'model_provider="decoy"', "-c", 'model_reasoning_effort="high"', "--", "--oss --remote literal prompt"],
                        Path(tmp),
                    )
                self.assertEqual(status, 0)
                self.assertEqual([path for method, path, _, _ in Upstream.seen if method == "POST"],
                                 ["/api/console/native/responses"])
                body = json.loads(Upstream.seen[-1][3])
                self.assertIn("--oss --remote literal prompt", json.dumps(body))
                self.assertEqual(body["model"], "build-codex")
                self.assertEqual(body["reasoning"]["effort"], "high")

    def test_alternate_selectors_are_rejected_before_account_access(self):
        selectors = ["--oss", "--local-provider=ollama", "--remote=ws://127.0.0.1:9",
                     "--remote-auth-token-env=X", "--profile=other", "-pother", "-p", "-hpother",
                     "cloud", "cloud-tasks", "app-server", "exec-server", "remote-control", "agents",
                     "responses-api-proxy", "stdio-to-uds"]
        for selector in selectors:
            with self.subTest(selector=selector), mock.patch.object(native, "fetch_config") as fetch:
                with mock.patch.object(native.Path, "home", side_effect=AssertionError("account accessed")):
                    self.assertEqual(native.main([selector]), 1)
                fetch.assert_not_called()

    def test_sse_first_event_is_forwarded_before_upstream_finishes(self):
        release = threading.Event()
        first = b"data: first\n\n"

        class Slow(BaseHTTPRequestHandler):
            def log_message(self, *_args): pass
            def do_POST(self):
                self.rfile.read(int(self.headers["Content-Length"]))
                self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
                self.wfile.write(first); self.wfile.flush(); release.wait(3)
                self.wfile.write(b"data: done\n\n"); self.wfile.flush()

        server = ThreadingHTTPServer(("127.0.0.1", 0), Slow)
        worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
        relay = native.Relay(f"http://127.0.0.1:{server.server_port}", "rift_live_secret", "nonce").start()
        try:
            request = urllib.request.Request(relay.base_url + "/responses", data=b"{}", method="POST", headers={"Authorization": "Bearer nonce"})
            response = urllib.request.urlopen(request, timeout=2)
            started = time.monotonic()
            self.assertEqual(response.read(len(first)), first)
            self.assertLess(time.monotonic() - started, 1)
            release.set(); response.close()
        finally:
            release.set(); relay.close(); server.shutdown(); server.server_close(); worker.join()

    def test_close_interrupts_stalled_upstream_response(self):
        started = threading.Event()

        class Stalled(BaseHTTPRequestHandler):
            def log_message(self, *_args): pass
            def do_POST(self):
                self.rfile.read(int(self.headers["Content-Length"]))
                self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers(); self.wfile.flush()
                started.set(); time.sleep(5)

        server = ThreadingHTTPServer(("127.0.0.1", 0), Stalled)
        worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
        relay = native.Relay(f"http://127.0.0.1:{server.server_port}", "rift_live_secret", "nonce", client_timeout=10).start()
        client = socket.create_connection(("127.0.0.1", relay.server.server_port))
        client.sendall(b"POST /responses HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer nonce\r\nContent-Length: 2\r\n\r\n{}")
        self.assertTrue(started.wait(2))
        before = time.monotonic(); relay.close()
        self.assertLess(time.monotonic() - before, 1.5)
        client.close(); server.shutdown(); server.server_close(); worker.join()

    def test_offline_help_also_strips_provider_credentials(self):
        captured = {}

        def fake_run(args, **kwargs):
            captured.update(args=args, kwargs=kwargs)
            return mock.Mock(returncode=0)

        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "secret", "RIFT_API_KEY": "secret"}), \
                mock.patch.object(native.subprocess, "run", side_effect=fake_run):
            self.assertEqual(native.main(["--help"]), 0)
        self.assertNotIn("OPENAI_API_KEY", captured["kwargs"]["env"])
        self.assertNotIn("RIFT_API_KEY", captured["kwargs"]["env"])

    def test_child_environment_preserves_terminal_capabilities(self):
        values = {"TERM": "xterm-256color", "COLORTERM": "truecolor", "TERM_PROGRAM": "Apple_Terminal"}
        with mock.patch.dict(os.environ, values, clear=True):
            self.assertEqual({name: native.child_environment()[name] for name in values}, values)

    @unittest.skipUnless(hasattr(signal, "SIGTERM"), "requires SIGTERM")
    def test_managed_child_receives_sigterm_and_is_reaped(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp) / "signal"
            child_script = Path(tmp) / "child.py"
            child_script.write_text(
                "import signal,time,sys\nfrom pathlib import Path\n"
                "signal.signal(signal.SIGTERM, lambda s,f: (Path(sys.argv[1]).write_text(str(s)), sys.exit(0)))\n"
                "print('ready', flush=True)\n"
                "while True: time.sleep(.1)\n"
            )
            runner = Path(tmp) / "runner.py"
            runner.write_text(
                "import importlib.util,sys\n"
                f"s=importlib.util.spec_from_file_location('n',{str(HERE / 'native-cli.py')!r});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n"
                "raise SystemExit(m.run_managed_process([sys.executable,sys.argv[1],sys.argv[2]], None, None))\n"
            )
            process = subprocess.Popen([sys.executable, str(runner), str(child_script), str(marker)], stdout=subprocess.PIPE, text=True)
            try:
                self.assertEqual(process.stdout.readline().strip(), "ready")
                process.send_signal(signal.SIGTERM)
                self.assertEqual(process.wait(timeout=3), 0)
                self.assertEqual(marker.read_text(), str(signal.SIGTERM))
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                process.stdout.close()

    @unittest.skipUnless(hasattr(os, "forkpty"), "requires PTY")
    def test_foreground_pty_sigint_reaches_child_once(self):
        self.upstream.shutdown()
        self.upstream.server_close()
        self.thread.join()
        self.upstream = None
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            marker, ready = root / "signals", root / "ready"
            child = root / "child.py"
            child.write_text(
                "import signal,time,sys\nfrom pathlib import Path\n"
                "p=Path(sys.argv[1]); signal.signal(signal.SIGINT,lambda s,f:p.open('a').write('I\\n'))\n"
                "signal.signal(signal.SIGTERM,lambda s,f:sys.exit(0)); Path(sys.argv[2]).write_text('ready')\n"
                "while True: time.sleep(.05)\n"
            )
            runner = root / "runner.py"
            runner.write_text(
                "import importlib.util,sys\n"
                f"s=importlib.util.spec_from_file_location('n',{str(HERE / 'native-cli.py')!r});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n"
                "raise SystemExit(m.run_managed_process([sys.executable,*sys.argv[1:]],None,None))\n"
            )
            pid, master = os.forkpty()
            if pid == 0:
                os.execv(sys.executable, [sys.executable, str(runner), str(child), str(marker), str(ready)])
            try:
                deadline = time.monotonic() + 3
                while not ready.exists() and time.monotonic() < deadline:
                    time.sleep(.02)
                self.assertTrue(ready.exists())
                os.killpg(pid, signal.SIGINT)
                time.sleep(.3)
                self.assertEqual(marker.read_text().splitlines(), ["I"])
                os.kill(pid, signal.SIGTERM)
                waited, _ = os.waitpid(pid, 0)
                self.assertEqual(waited, pid)
            finally:
                try:
                    os.kill(pid, signal.SIGKILL)
                    os.waitpid(pid, 0)
                except (ProcessLookupError, ChildProcessError):
                    pass
                os.close(master)


def make_bundle(path):
    path.mkdir()
    files = {
        "rift": b"#!/bin/sh\nexit 0\n",
        "codex-code-mode-host": b"#!/bin/sh\nexit 0\n",
        "LICENSE": b"license",
        "NOTICE": b"notice",
        "models.json": b'{"models":[]}',
    }
    for name, data in files.items():
        target = path / name
        target.write_bytes(data)
        if name in ("rift", "codex-code-mode-host"):
            target.chmod(target.stat().st_mode | stat.S_IXUSR)
    manifest = {"files": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
    (path / "provenance.json").write_text(json.dumps(manifest))


class InstallerTests(unittest.TestCase):
    def test_verification_failure_preserves_prior_entrypoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source, bin_dir, data = root / "source", root / "bin", root / "data"
            make_bundle(source)
            bin_dir.mkdir()
            old = bin_dir / "rift"
            old.write_text("old entrypoint")
            (source / "NOTICE").write_text("tampered")
            with self.assertRaisesRegex(installer.InstallError, "checksum"):
                installer.install(source, bin_dir, data)
            self.assertEqual(old.read_text(), "old entrypoint")
            self.assertFalse(data.exists())

    def test_install_swaps_verified_bundle_and_backs_up_prior_entrypoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source, bin_dir, data = root / "source", root / "bin", root / "data"
            make_bundle(source)
            bin_dir.mkdir()
            old = bin_dir / "rift"
            old.write_text("old entrypoint")
            installer.install(source, bin_dir, data)
            self.assertEqual(len(list((data / "versions").glob("native-*/native-cli.py"))), 1)
            self.assertIn("native-cli.py", old.read_text())
            backups = list((data / "backups").iterdir())
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_text(), "old entrypoint")

    def test_failure_switching_public_entrypoint_keeps_old_target_valid(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source, bin_dir, data = root / "source", root / "bin", root / "data"
            make_bundle(source)
            bin_dir.mkdir()
            old = bin_dir / "rift"
            installer.install(source, bin_dir, data)
            old_wrapper = old.read_text()
            old_target = Path(old_wrapper.split('"')[1]).parent
            old_notice = (old_target / "NOTICE").read_text()
            (source / "NOTICE").write_text("new notice")
            manifest = json.loads((source / "provenance.json").read_text())
            manifest["files"]["NOTICE"] = hashlib.sha256(b"new notice").hexdigest()
            (source / "provenance.json").write_text(json.dumps(manifest))
            real_replace = installer.os.replace

            def fail_wrapper(source_path, destination):
                if Path(destination) == old:
                    raise OSError("injected public swap failure")
                return real_replace(source_path, destination)

            with mock.patch.object(installer.os, "replace", side_effect=fail_wrapper), self.assertRaises(OSError):
                installer.install(source, bin_dir, data)
            self.assertEqual(old.read_text(), old_wrapper)
            self.assertTrue(old_target.is_dir())
            self.assertEqual((old_target / "NOTICE").read_text(), old_notice)
            self.assertEqual(list(bin_dir.glob(".rift-*.tmp")), [])

    def test_failure_promoting_staged_version_keeps_old_entrypoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source, bin_dir, data = root / "source", root / "bin", root / "data"
            make_bundle(source)
            bin_dir.mkdir()
            old = bin_dir / "rift"
            old.write_text("old entrypoint")
            with mock.patch.object(installer.os, "replace", side_effect=OSError("injected version failure")), \
                    self.assertRaises(OSError):
                installer.install(source, bin_dir, data)
            self.assertEqual(old.read_text(), "old entrypoint")

    def test_two_installs_keep_original_legacy_and_version_finds_data_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source, bin_dir, data = root / "source", root / "bin", root / "data"
            make_bundle(source)
            bin_dir.mkdir()
            marker = root / "legacy-called"
            legacy = bin_dir / "rift"
            legacy.write_text(f"#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"{marker}\"\n")
            legacy.chmod(0o755)
            installer.install(source, bin_dir, data)
            installer.install(source, bin_dir, data)
            backups = list((data / "backups").glob("rift-*"))
            self.assertEqual(len(backups), 1)
            versions = sorted((data / "versions").glob("native-*"))
            self.assertEqual(native.data_root_for_bundle(versions[-1]), data.resolve())
            self.assertEqual(subprocess.run([str(bin_dir / "rift"), "doctor"]).returncode, 0)
            self.assertEqual(marker.read_text().splitlines(), ["doctor"])


if __name__ == "__main__":
    unittest.main()
