"""Isolated OpenCode launcher and failure-normalizing Responses relay."""

import json
import http.client
import os
from pathlib import Path
import tempfile
import urllib.error
import urllib.parse
import urllib.request

from native_cli import CliError, Relay, abort_response, child_environment, run_managed_process


MAX_FRAME = 8 * 1024 * 1024
MAX_STREAM = 32 * 1024 * 1024
FAILURE_MESSAGE = "RIFT model request did not complete. Retry explicitly when ready."


def failure_event():
    return {"type": "error", "sequence_number": 1, "error": {
        "type": "invalid_request_error", "code": "rift_response_uncommitted",
        "message": FAILURE_MESSAGE, "param": None,
    }}


def encoded_failure_stream():
    event = json.dumps(failure_event(), separators=(",", ":"))
    return ("data: " + event + "\n\ndata: [DONE]\n\n").encode()


class OpenCodeRelay(Relay):
    """Relay which turns every uncertain Responses ending into a non-retryable error."""

    def upstream(self, body, transport):
        parsed = urllib.parse.urlparse(self.origin)
        connection_type = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
        connection = connection_type(parsed.hostname, parsed.port, timeout=self.client_timeout)
        transport["connection"] = connection
        with self.active_lock: self.upstreams.add(connection)
        connection.request("POST", "/api/console/native/responses", body=body, headers={
            "Authorization": "Bearer " + self.key, "Content-Type": "application/json",
        })
        response = connection.getresponse()
        transport["response"] = response
        try: transport["socket"] = response.fp.raw._sock
        except AttributeError: transport["socket"] = connection.sock
        with self.active_lock: self.upstreams.add(response)
        return connection, response

    def start(self):
        relay = self
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        import threading

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            def log_message(self, *_args): pass
            def reply(self, status, body, content_type="application/json"):
                self.send_response(status); self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body))); self.send_header("Connection", "close")
                self.end_headers(); self.wfile.write(body); self.close_connection = True
            def do_POST(self):
                if self.path not in {"/responses", "/v1/responses"}: return self.reply(404, b"")
                if self.headers.get("Authorization") != "Bearer " + relay.nonce: return self.reply(403, b"")
                if self.headers.get("Transfer-Encoding") or self.headers.get("Content-Encoding") or self.headers.get("Origin"): return self.reply(403, b"")
                try: length = int(self.headers.get("Content-Length", ""))
                except ValueError: return self.reply(400, b"")
                if length <= 0 or length > relay.max_body: return self.reply(413, b"")
                body = self.rfile.read(length)
                if len(body) != length: return self.reply(400, b"")
                with relay.active_lock: header_timer = relay.deadlines.pop(self.request, None)
                if header_timer: header_timer.cancel()
                transport = {"connection": None, "response": None, "socket": None}
                def expire_model_request():
                    sock = transport["socket"]
                    if sock is not None:
                        try: sock.shutdown(2)
                        except OSError: pass
                    connection = transport["connection"]
                    if connection is not None:
                        try:
                            if connection.sock: connection.sock.shutdown(2)
                        except OSError: pass
                        connection.close()
                model_timer = threading.Timer(relay.client_timeout, expire_model_request)
                model_timer.daemon = True
                with relay.active_lock: relay.deadlines[self.request] = model_timer
                model_timer.start()
                try:
                    connection, response = relay.upstream(body, transport)
                except (urllib.error.HTTPError, urllib.error.URLError, http.client.HTTPException, OSError, CliError) as error:
                    expire_model_request()
                    with relay.active_lock:
                        relay.upstreams.discard(transport["connection"])
                        relay.upstreams.discard(transport["response"])
                    try: error.close()
                    except AttributeError: pass
                    payload = json.dumps({"error": {"type": "invalid_request_error", "code": "rift_request_rejected", "message": FAILURE_MESSAGE, "param": None}}).encode()
                    return self.reply(400, payload)
                if response.status < 200 or response.status >= 300:
                    model_timer.cancel()
                    with relay.active_lock:
                        relay.upstreams.discard(connection); relay.upstreams.discard(response)
                    abort_response(response); connection.close()
                    payload = json.dumps({"error": {"type": "invalid_request_error", "code": "rift_request_rejected", "message": FAILURE_MESSAGE, "param": None}}).encode()
                    return self.reply(400, payload)
                self.send_response(200); self.send_header("Content-Type", "text/event-stream")
                self.send_header("Connection", "close"); self.end_headers()
                total = 0; terminal = False; malformed = False
                try:
                    while True:
                        line = response.readline(MAX_FRAME + 1)
                        if not line: break
                        total += len(line)
                        if len(line) > MAX_FRAME or total > MAX_STREAM: malformed = True; break
                        if not line.startswith(b"data:"):
                            if line.strip() and not line.startswith((b"event:", b"id:", b"retry:", b":")): malformed = True; break
                            self.wfile.write(line); continue
                        raw = line[5:].strip()
                        if raw == b"[DONE]":
                            if terminal: self.wfile.write(line); self.wfile.flush()
                            else: malformed = True
                            break
                        try: event = json.loads(raw)
                        except (ValueError, UnicodeError): malformed = True; break
                        if terminal: malformed = True; break
                        if not isinstance(event, dict) or not isinstance(event.get("type"), str):
                            malformed = True; break
                        kind = event["type"]
                        if kind in {"response.failed", "response.incomplete", "error"}: malformed = True; break
                        if kind == "response.completed":
                            response_body = event.get("response")
                            if not isinstance(response_body, dict): malformed = True; break
                            usage = response_body.get("usage")
                            if response_body.get("status") != "completed" or not isinstance(usage, dict): malformed = True; break
                            terminal = True
                        self.wfile.write(line); self.wfile.flush()
                    if not terminal or malformed:
                        self.wfile.write(encoded_failure_stream()); self.wfile.flush()
                except (OSError, ValueError, http.client.HTTPException):
                    try: self.wfile.write(encoded_failure_stream()); self.wfile.flush()
                    except OSError: pass
                finally:
                    model_timer.cancel()
                    with relay.active_lock:
                        relay.upstreams.discard(connection); relay.upstreams.discard(response)
                    abort_response(response); connection.close(); self.close_connection = True

        class Server(ThreadingHTTPServer):
            daemon_threads = False; block_on_close = True
            def handle_error(self, _request, _client_address): pass
            def get_request(self):
                client, address = super().get_request(); client.settimeout(relay.client_timeout); return client, address
            def process_request(self, request, client_address):
                if not relay.slots.acquire(blocking=False): self.shutdown_request(request); return
                with relay.active_lock:
                    relay.active.add(request)
                    deadline = threading.Timer(relay.client_timeout, self.shutdown_request, (request,))
                    deadline.daemon = True; relay.deadlines[request] = deadline; deadline.start()
                try: super().process_request(request, client_address)
                except BaseException:
                    with relay.active_lock:
                        relay.active.discard(request); timer = relay.deadlines.pop(request, None)
                    if timer: timer.cancel()
                    relay.slots.release(); raise
            def process_request_thread(self, request, client_address):
                try: super().process_request_thread(request, client_address)
                finally:
                    with relay.active_lock:
                        relay.active.discard(request); timer = relay.deadlines.pop(request, None)
                    if timer: timer.cancel()
                    relay.slots.release()
        self.server = Server(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        return self


def fetch_config(origin, key):
    from native_cli import gateway_request
    with gateway_request(origin, key, "GET", "/api/console/opencode/config", timeout=45) as response:
        try: config = json.load(response)
        except (ValueError, UnicodeError): raise CliError("Invalid OpenCode model configuration.") from None
    if not isinstance(config.get("ownerId"), str) or not config["ownerId"] or not isinstance(config.get("models"), list) or not isinstance(config.get("defaultModel"), str):
        raise CliError("Invalid OpenCode model configuration.")
    return config


def generated_config(config, base_url, nonce, selected=None, cwd=None):
    models = {}
    for model in config["models"]:
        reasoning = model.get("reasoning", False)
        models[model["id"]] = {"name": model["label"], "tool_call": True,
            "reasoning": False if isinstance(reasoning, dict) and reasoning.get("control") == "toggle" else bool(reasoning),
            "limit": {"context": model["contextTokens"], "output": 16384}, "options": {"store": False}}
    chosen = selected or config["defaultModel"]
    return {"model": "rift/" + chosen, "small_model": "rift/" + chosen,
        "enabled_providers": ["rift"], "provider": {"rift": {"npm": "@ai-sdk/openai", "name": "RIFT account",
        "options": {"baseURL": base_url, "apiKey": nonce}, "models": models}}, "share": "disabled", "autoupdate": False, "lsp": False,
        "permission": {"read": "allow", "glob": "allow", "grep": "allow", "list": "allow", "bash": "ask", "edit": "ask", "write": "ask", "patch": "ask", "external_directory": ({"*": "ask", str(Path(cwd).resolve()) + "/**": "allow"} if cwd else "ask")}}


# Pinned OpenCode 1.18.31 root/TUI and run --help contract. All accepted
# options have explicit arity. Other subcommands and unknown syntax fail closed.
# Values are never revisited as flags or command names.
COMMON_OPTIONS = {
    "--help": "bool", "--version": "bool", "--print-logs": "bool",
    "--log-level": "value", "--pure": "bool", "--model": "value",
    "--continue": "bool", "--session": "value", "--fork": "bool", "--agent": "value",
}
TUI_OPTIONS = {"--prompt": "value", "--mini": "bool", "--no-replay": "bool", "--replay-limit": "value"}
RUN_OPTIONS = {"--command": "value", "--format": "value", "--file": "array", "--title": "value",
               "--dir": "value", "--variant": "value", "--thinking": "bool", "--interactive": "bool"}
SHORT_OPTIONS = {"-h": "--help", "-v": "--version", "-m": "--model", "-c": "--continue",
                 "-s": "--session", "-f": "--file", "-i": "--interactive"}
BLOCKED_OPTIONS = frozenset({"--hostname", "--port", "--mdns", "--mdns-domain", "--cors", "--config",
    "--skip-git-repo-check", "--sandbox", "--ask-for-approval", "--oss", "--profile", "--attach",
    "--password", "--username", "--auto", "--share", "-p", "-u"})
OTHER_COMMANDS = frozenset({"completion", "acp", "mcp", "attach", "debug", "providers", "auth", "agent",
    "upgrade", "uninstall", "serve", "web", "models", "stats", "export", "import", "github", "pr",
    "session", "plugin", "plug", "db", "login", "logout"})


def parse_arguments(arguments):
    """Return the root index and (option, value index, attached prefix) records.

    Only root/TUI options may precede the command. Array flags are accepted only
    after run/exec, where their greedy values cannot conceal a root command.
    Short boolean clusters and optional/missing values are deliberately rejected.
    Use --option=value for literal values beginning with a dash.
    """
    root = None
    records = []
    used = []
    index = 0
    while index < len(arguments):
        argument = arguments[index]
        if argument == "--":
            break
        if not argument.startswith("-"):
            if root is None:
                root = index
                if argument in OTHER_COMMANDS:
                    raise CliError("OpenCode servers, remote attachment, and management commands are unavailable in the RIFT account launcher.")
            elif arguments[root] not in {"run", "exec"}:
                raise CliError("OpenCode TUI accepts one project path; use run (or exec) for a prompt.")
            index += 1
            continue
        option, equals, value = argument.partition("=")
        prefix = option + "=" if equals else None
        if argument.startswith("-") and not argument.startswith("--"):
            option = argument[:2]
            if len(argument) > 2:
                value = argument[2:]
                if value.startswith("="): value = value[1:]
                prefix = argument[:len(argument) - len(value)]
        if option in BLOCKED_OPTIONS:
            raise CliError("OpenCode remote access and automatic approvals are unavailable in the RIFT account launcher.")
        option = SHORT_OPTIONS.get(option, option)
        schema = {**COMMON_OPTIONS, **(RUN_OPTIONS if root is not None and arguments[root] in {"run", "exec"} else TUI_OPTIONS)}
        arity = schema.get(option)
        if arity is None:
            raise CliError(f"Unsupported OpenCode option: {argument}. Use rift opencode --help or run --help.")
        used.append(option)
        if arity == "bool":
            if prefix is not None:
                if not argument.startswith("--") or value not in {"true", "false"}:
                    raise CliError(f"Ambiguous OpenCode boolean option: {argument}; pass flags separately.")
            elif index + 1 < len(arguments) and arguments[index + 1] in {"true", "false"}:
                index += 1
        elif prefix is not None:
            if not value:
                raise CliError(f"OpenCode option requires a value: {option}")
            records.append((option, index, prefix))
        else:
            index += 1
            if index >= len(arguments) or arguments[index].startswith("-"):
                raise CliError(f"OpenCode option requires a value: {option}; use {option}=VALUE for a value beginning with '-'.")
            records.append((option, index, None))
        if arity == "array":
            while index + 1 < len(arguments) and not arguments[index + 1].startswith("-"):
                index += 1
        index += 1
    if root is not None and arguments[root] in {"run", "exec"}:
        for option in used:
            if option in TUI_OPTIONS:
                raise CliError(f"OpenCode option {option} is only supported by the TUI, not run/exec.")
    return root, records


def requested_model(arguments):
    _, records = parse_arguments(arguments)
    models = [arguments[index][len(prefix):] if prefix else arguments[index]
              for option, index, prefix in records if option == "--model"]
    if len(models) > 1:
        raise CliError("Pass only one OpenCode model selection.")
    return models[0].removeprefix("rift/") if models else None


def normalize_arguments(arguments):
    root, records = parse_arguments(arguments)
    result = list(arguments)
    if root is not None and result[root] == "exec":
        result[root] = "run"
    for option, index, prefix in records:
        value = result[index][len(prefix):] if prefix else result[index]
        if option == "--model" and "/" not in value:
            value = "rift/" + value
        # yargs treats attached short strings as clusters in this release.
        # Canonical long assignments preserve the requested literal value.
        if prefix and not prefix.startswith("--"):
            prefix = option + "="
        result[index] = (prefix or "") + value
    return result


def validate_arguments(arguments):
    requested_model(arguments)

def run_child(bundle, config, base_url, nonce, arguments, cwd, selected=None):
    validate_arguments(arguments)
    owner = __import__("hashlib").sha256(config["ownerId"].encode()).hexdigest()
    state = Path.home() / ".rift" / "opencode-terminal" / owner; state.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name in ("data", "cache", "state"):
        (state / name).mkdir(exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix="launch-", dir=state) as private:
        env = child_environment(); env.update({"HOME": private, "XDG_CONFIG_HOME": private + "/config", "XDG_DATA_HOME": str(state / "data"), "XDG_CACHE_HOME": str(state / "cache"), "XDG_STATE_HOME": str(state / "state"),
            "OPENCODE_CONFIG_CONTENT": json.dumps(generated_config(config, base_url, nonce, selected, cwd)), "OPENCODE_DISABLE_PROJECT_CONFIG": "1", "OPENCODE_PURE": "1", "OPENCODE_DISABLE_DEFAULT_PLUGINS": "1", "OPENCODE_DISABLE_EXTERNAL_SKILLS": "1", "OPENCODE_DISABLE_CLAUDE_CODE": "1", "OPENCODE_DISABLE_CLAUDE_CODE_SKILLS": "1", "OPENCODE_DISABLE_AUTOUPDATE": "1", "OPENCODE_DISABLE_MODELS_FETCH": "1", "OPENCODE_DISABLE_LSP_DOWNLOAD": "true"})
        return run_managed_process([str(bundle / "opencode"), "--pure", *normalize_arguments(arguments)], cwd, env)
