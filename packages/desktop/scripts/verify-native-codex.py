#!/usr/bin/env python3
"""Verify the staged native binary against local fake Responses/MCP servers.

Run: python3 packages/desktop/scripts/verify-native-codex.py
No RIFT login or paid model calls. All state and edited files are temporary.
"""
import argparse
import copy
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MCP_RESULT = "MCP_NATIVE_RESULT_OK"
PATCH = 'text(await tools.apply_patch("*** Begin Patch\\n*** Update File: value.txt\\n-1\\n+2\\n*** End Patch"));'


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def mcp_fixture():
    for line in sys.stdin:
        request = json.loads(line)
        method = request.get("method")
        if method == "initialize":
            result = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}},
                      "serverInfo": {"name": "rift-local-fixture", "version": "1"}}
        elif method == "tools/list":
            result = {"tools": [{"name": "echo", "description": "Return a local verification result marker.",
                                "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}},
                                                "required": ["text"]}}]}
        elif method == "tools/call":
            require(request["params"]["name"] == "echo", "Unexpected MCP tool")
            # Deliberately different from input: assertions must inspect real tool results.
            result = {"content": [{"type": "text", "text": MCP_RESULT}]}
        else:
            result = {}
        if request.get("id") is not None:
            print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)


class ResponsesFixture:
    def __init__(self, scripts):
        self.requests = []
        self.errors = []
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                try:
                    body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                    step = len(fixture.requests)
                    fixture.requests.append(body)
                    require(step <= len(scripts), "Unexpected additional model request")
                    if step < len(scripts):
                        item = {"type": "custom_tool_call", "id": f"ct_{step}", "call_id": f"call_{step}",
                                "name": "exec", "input": scripts[step]}
                    else:
                        item = {"type": "message", "role": "assistant", "id": "msg_done",
                                "content": [{"type": "output_text", "text": "LOCAL_VERIFICATION_DONE"}]}
                    events = [
                        {"type": "response.created", "response": {"id": f"resp_{step}"}},
                        {"type": "response.output_item.done", "item": item},
                        {"type": "response.completed", "response": {"id": f"resp_{step}", "status": "completed",
                         "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}}},
                    ]
                    data = "".join("data: " + json.dumps(event) + "\n\n" for event in events).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                except Exception as error:
                    fixture.errors.append(str(error))
                    self.send_error(500, "Local verification failed")

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(timeout=5)


class AppServer:
    def __init__(self, binary, project, environment):
        self.events = queue.Queue()
        self.observed = []
        self.counter = 0
        self.stderr = tempfile.TemporaryFile(mode="w+t")
        self.process = subprocess.Popen([str(binary), "app-server", "--listen", "stdio://"],
                                        cwd=project, env=environment, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=self.stderr, text=True)
        def read():
            try:
                for line in self.process.stdout:
                    self.events.put(json.loads(line))
            except Exception as error:
                self.events.put(error)
            finally:
                self.events.put(EOFError("Native app-server exited"))
        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()
        try:
            self.call("initialize", {"clientInfo": {"name": "rift_local_verification", "version": "1"},
                                     "capabilities": {"experimentalApi": True}})
            self.send({"method": "initialized", "params": {}})
        except BaseException:
            self.close()
            raise

    def send(self, message):
        self.process.stdin.write(json.dumps(message) + "\n")
        self.process.stdin.flush()

    def next(self, deadline):
        try:
            event = self.events.get(timeout=max(0.01, deadline - time.monotonic()))
        except queue.Empty as error:
            raise TimeoutError("Timed out waiting for native app-server") from error
        if isinstance(event, Exception):
            self.stderr.seek(0)
            raise RuntimeError(f"{event}: {self.stderr.read()[-2000:]}")
        self.observed.append(event)
        return event

    def call(self, method, params):
        self.counter += 1
        request_id = f"verify-{self.counter}"
        self.send({"id": request_id, "method": method, "params": params})
        deadline = time.monotonic() + 60
        while True:
            event = self.next(deadline)
            if event.get("id") == request_id and "method" not in event:
                require("error" not in event, f"{method}: {event.get('error')}")
                return event["result"]
            require(not ("method" in event and "id" in event), f"Unexpected request during {method}: {event}")

    def turn(self, thread_id, approval):
        self.counter += 1
        self.send({"id": f"verify-{self.counter}", "method": "turn/start",
                   "params": {"threadId": thread_id, "input": [{"type": "text", "text": "Run the local verification task."}]}})
        deadline = time.monotonic() + 90
        approvals, items = [], []
        while True:
            event = self.next(deadline)
            if "method" in event and "id" in event:
                approvals.append(event)
                if event["method"] == "item/fileChange/requestApproval":
                    result = {"decision": approval}
                elif event["method"] == "mcpServer/elicitation/request":
                    params = event["params"]
                    require(params.get("mode") == "form" and params.get("requestedSchema") == {"type": "object", "properties": {}}, "Unexpected MCP form")
                    require(params.get("_meta", {}).get("codex_approval_kind") == "mcp_tool_call", "Not an MCP tool approval")
                    result = {"action": approval, "content": {} if approval == "accept" else None, "_meta": None}
                else:
                    raise AssertionError(f"Unexpected server request: {event['method']}")
                self.send({"id": event["id"], "result": result})
            elif event.get("method") == "item/completed":
                items.append(event["params"]["item"])
            elif event.get("method") == "turn/completed":
                require(event["params"]["turn"]["status"] == "completed", f"Turn failed: {event}")
                return approvals, items
            elif "error" in event:
                raise AssertionError(f"Native RPC error: {event['error']}")

    def close(self):
        if self.process.stdin and not self.process.stdin.closed:
            self.process.stdin.close()
        try:
            self.process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        self.reader.join(timeout=2)
        self.process.stdout.close()
        self.stderr.close()


def run_case(binary, catalog, name, scripts, approval="accept", workspace_write=False, mcp=False):
    fixture = ResponsesFixture(scripts)
    try:
        with tempfile.TemporaryDirectory(prefix="rift-native-verify-") as temporary:
            root = Path(temporary)
            state, project, home = (root / name for name in ("state", "project", "home"))
            for directory in (state, project, home):
                directory.mkdir()
            (project / "value.txt").write_text("1\n")
            catalog_path = state / "models.json"
            catalog_path.write_text(json.dumps(catalog))
            config = [
                'model="build-codex"', 'model_provider="fixture"',
                f"model_catalog_json={json.dumps(str(catalog_path))}", 'web_search="disabled"',
                f'approval_policy="{"never" if workspace_write else "on-request"}"',
                f'sandbox_mode="{"workspace-write" if workspace_write else "read-only"}"',
                "[model_providers.fixture]", 'name="Local fixture"',
                f'base_url="http://127.0.0.1:{fixture.server.server_port}"',
                'wire_api="responses"', "requires_openai_auth=false", "request_max_retries=0", "stream_max_retries=0",
            ]
            if mcp:
                config += ["[mcp_servers.fixture]", f"command={json.dumps(sys.executable)}",
                           f"args={json.dumps([str(Path(__file__).resolve()), '--mcp-fixture'])}"]
            (state / "config.toml").write_text("\n".join(config) + "\n")
            # Do not inherit credentials, app state, user config, proxies or API endpoints.
            environment = {"PATH": os.environ.get("PATH", os.defpath), "HOME": str(home),
                           "RIFT_HOME": str(state), "CODEX_HOME": str(state), "TMPDIR": str(root),
                           "LANG": "en_US.UTF-8"}
            app = AppServer(binary, project, environment)
            try:
                thread = app.call("thread/start", {"model": "build-codex", "cwd": str(project),
                                 "sandbox": "workspace-write" if workspace_write else "read-only",
                                 "approvalPolicy": "never" if workspace_write else "on-request"})["thread"]["id"]
                approvals, items = app.turn(thread, approval)
            finally:
                app.close()
            require(not fixture.errors, fixture.errors)
            require(len(fixture.requests) == len(scripts) + 1, f"{name}: wrong model request count")
            if mcp:
                require(any(a["method"] == "mcpServer/elicitation/request" for a in approvals), "MCP approval missing")
                results = [i for i in items if i.get("type") == "mcpToolCall"]
                require(results and all(i.get("status") == "completed" for i in results), f"MCP not completed: {results}")
                require(MCP_RESULT in json.dumps([i.get("result") for i in results]), "Actual completed MCP result marker missing")
                count = len(fixture.requests)
                app = AppServer(binary, project, environment)
                try:
                    resumed = app.call("thread/resume", {"threadId": thread, "model": "build-codex"})["thread"]
                    require(resumed["id"] == thread, "Resume changed thread ID")
                    saved_tools = [i for turn in resumed.get("turns", []) for i in turn.get("items", []) if i.get("type") == "mcpToolCall"]
                    require(MCP_RESULT in json.dumps([i.get("result") for i in saved_tools]), "Resume lost saved MCP tool result")
                    time.sleep(0.5)
                    require(len(fixture.requests) == count, "Resume unexpectedly made a model request")
                finally:
                    app.close()
                print(f"PASS {name}: actual MCP result + fresh-process resume; no additional model request", flush=True)
            else:
                expected = "1\n" if approval == "decline" else "2\n"
                require((project / "value.txt").read_text() == expected, f"{name}: incorrect actual file contents")
                if not workspace_write:
                    require(any(a["method"] == "item/fileChange/requestApproval" for a in approvals), "File approval missing")
                if workspace_write:
                    outputs = [i.get("aggregatedOutput", "") for i in items if i.get("type") == "commandExecution"]
                    require(any("RIFT_CHECK_OK" in (output or "") for output in outputs), "Actual shell check output missing")
                print(f"PASS {name}: actual file value={expected.strip()}, model requests={len(fixture.requests)}", flush=True)
    finally:
        fixture.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native-dir", type=Path, default=Path(__file__).resolve().parents[1] / "src-tauri" / "native-codex")
    parser.add_argument("--catalog-model", default="gpt-5.6-sol", help="Pinned models.json metadata entry; never calls this real model")
    parser.add_argument("--mcp-fixture", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.mcp_fixture:
        mcp_fixture()
        return
    binary = args.native_dir.resolve() / ("rift.exe" if os.name == "nt" else "rift")
    require(binary.is_file(), f"Stage the packaged native binary first: {binary}")
    source = json.loads((binary.parent / "models.json").read_text())
    models = [m for m in source["models"] if m["slug"] == args.catalog_model]
    require(len(models) == 1, f"Pinned metadata unavailable: {args.catalog_model}")
    model = copy.deepcopy(models[0])
    model.update(slug="build-codex", use_responses_lite=False, prefer_websockets=False,
                 input_modalities=["text"], supports_image_detail_original=False)
    require(model.get("tool_mode") == "code_mode_only", "Fixture requires pinned code-mode model metadata")
    catalog = {"models": [model]}
    print(f"Verifying staged binary: {binary}", flush=True)
    run_case(binary, catalog, "file-accept", [PATCH])
    run_case(binary, catalog, "file-decline", [PATCH], approval="decline")
    run_case(binary, catalog, "read-edit-check", [
        'text(await tools.exec_command({cmd:"cat value.txt"}));', PATCH,
        'text(await tools.exec_command({cmd:"test $(cat value.txt) = 2 && echo RIFT_CHECK_OK"}));',
    ], workspace_write=True)
    run_case(binary, catalog, "mcp-accept-resume", ['text(await tools.mcp__fixture__echo({text:"MCP_INPUT_ONLY"}));'], mcp=True)
    print("PASS all packaged native checks; local fake Responses only, zero paid calls", flush=True)


if __name__ == "__main__":
    main()
