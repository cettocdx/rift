#!/usr/bin/env python3
"""Launch the packaged Codex TUI through a nonce-scoped RIFT account relay."""

import copy
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request


ALLOWED_ORIGINS = {"https://riftsys.app", "http://localhost:3020", "http://localhost:3022"}
MAX_BODY = 20 * 1024 * 1024
MAX_CONCURRENT = 8


class CliError(RuntimeError):
    @classmethod
    def service(cls, status, _detail=None):
        return cls(f"RIFT native model service is unavailable ({status}). Check account and credit eligibility.")


def validate_login(login):
    origin = str(login.get("app", "")).rstrip("/")
    if origin not in ALLOWED_ORIGINS:
        raise CliError("RIFT console login belongs to another server. Run rift login again.")
    key = login.get("apiKey")
    if not isinstance(key, str) or not key.startswith("rift_live_") or len(key) >= 512:
        raise CliError("RIFT console login is missing. Run rift login.")
    return origin, key


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def gateway_request(origin, key, method, path, body=None, timeout=300):
    request = urllib.request.Request(origin + path, data=body, method=method)
    request.add_header("Authorization", "Bearer " + key)
    if body is not None:
        request.add_header("Content-Type", "application/json")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)
    try:
        return opener.open(request, timeout=timeout)
    except urllib.error.HTTPError as error:
        raise CliError.service(error.code) from None
    except (OSError, urllib.error.URLError):
        raise CliError("RIFT model service is unreachable.") from None


def abort_response(response):
    try:
        response.fp.raw._sock.shutdown(2)
    except (AttributeError, OSError):
        pass
    response.close()


def fetch_config(origin, key):
    with gateway_request(origin, key, "GET", "/api/console/native/config", timeout=45) as response:
        try:
            config = json.load(response)
        except (ValueError, UnicodeError):
            raise CliError("Invalid native model configuration.") from None
    if not isinstance(config.get("ownerId"), str) or not config["ownerId"]:
        raise CliError("Invalid native model configuration: owner is missing.")
    if not isinstance(config.get("models"), list) or not isinstance(config.get("defaultModel"), str):
        raise CliError("Invalid native model configuration.")
    return config


OPENCODE_MODELS = {"build-gemini", "build-max", "build-fable", "build-grok", "build-kimi", "build-qwen", "build-glm", "build-hunyuan"}


def requested_model(arguments):
    for index, argument in enumerate(arguments):
        if argument == "--":
            break
        if argument in {"-m", "--model"} and index + 1 < len(arguments):
            return arguments[index + 1].removeprefix("rift/")
        if argument.startswith("--model="):
            return argument.split("=", 1)[1].removeprefix("rift/")
        if argument.startswith("-m") and len(argument) > 2:
            return argument[2:].removeprefix("rift/")
    return None


class Relay:
    def __init__(self, origin, key, nonce=None, max_body=MAX_BODY, max_concurrent=MAX_CONCURRENT, client_timeout=300):
        self.origin = origin
        self.key = key
        self.nonce = nonce or secrets.token_hex(32)
        self.max_body = max_body
        self.server = None
        self.thread = None
        self.slots = threading.BoundedSemaphore(max_concurrent)
        self.client_timeout = client_timeout
        self.active = set()
        self.upstreams = set()
        self.deadlines = {}
        self.active_lock = threading.Lock()

    @property
    def active_count(self):
        with self.active_lock:
            return len(self.active)

    @property
    def base_url(self):
        return f"http://127.0.0.1:{self.server.server_port}"

    def start(self):
        relay = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_args):
                pass

            def reply(self, status, body=b""):
                self.send_response(status)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Connection", "close")
                self.end_headers()
                if body:
                    self.wfile.write(body)

            def do_POST(self):
                if self.path != "/responses":
                    return self.reply(404)
                if self.headers.get("Authorization") != "Bearer " + relay.nonce:
                    return self.reply(403)
                if self.headers.get("Transfer-Encoding") or self.headers.get("Content-Encoding") or self.headers.get("Origin"):
                    return self.reply(403)
                try:
                    length = int(self.headers.get("Content-Length", ""))
                except ValueError:
                    return self.reply(400)
                if length <= 0 or length > relay.max_body:
                    return self.reply(413)
                body = self.rfile.read(length)
                if len(body) != length:
                    return self.reply(400)
                try:
                    response = gateway_request(relay.origin, relay.key, "POST", "/api/console/native/responses", body)
                    with relay.active_lock:
                        relay.upstreams.add(response)
                    status = response.status
                    content_type = response.headers.get("Content-Type", "text/event-stream")
                except CliError:
                    return self.reply(502)
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Connection", "close")
                self.end_headers()
                try:
                    read = getattr(response, "read1", None) or response.read
                    for chunk in iter(lambda: read(64 * 1024), b""):
                        self.wfile.write(chunk)
                        self.wfile.flush()
                finally:
                    with relay.active_lock:
                        relay.upstreams.discard(response)
                    abort_response(response)
                    self.close_connection = True

        class BoundedServer(ThreadingHTTPServer):
            daemon_threads = False
            block_on_close = True

            def handle_error(self, _request, _client_address):
                pass

            def get_request(self):
                client, address = super().get_request()
                client.settimeout(relay.client_timeout)
                return client, address

            def process_request(self, request, client_address):
                if not relay.slots.acquire(blocking=False):
                    self.shutdown_request(request)
                    return
                with relay.active_lock:
                    relay.active.add(request)
                    deadline = threading.Timer(relay.client_timeout, self.shutdown_request, (request,))
                    deadline.daemon = True
                    relay.deadlines[request] = deadline
                    deadline.start()
                try:
                    super().process_request(request, client_address)
                except BaseException:
                    with relay.active_lock:
                        relay.active.discard(request)
                        deadline = relay.deadlines.pop(request, None)
                    if deadline:
                        deadline.cancel()
                    relay.slots.release()
                    raise

            def process_request_thread(self, request, client_address):
                try:
                    super().process_request_thread(request, client_address)
                finally:
                    with relay.active_lock:
                        relay.active.discard(request)
                        deadline = relay.deadlines.pop(request, None)
                    if deadline:
                        deadline.cancel()
                    relay.slots.release()

        self.server = BoundedServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self

    def close(self):
        if self.server:
            self.server.shutdown()
            with self.active_lock:
                clients = list(self.active)
                upstreams = list(self.upstreams)
            for response in upstreams:
                abort_response(response)
            for client in clients:
                try:
                    client.shutdown(2)
                except OSError:
                    pass
                client.close()
            self.server.server_close()
            self.thread.join(timeout=2)
            self.server = None


def map_catalog(source, config):
    available = {model.get("slug"): model for model in source.get("models", [])}
    models = []
    for allowed in config["models"]:
        provider = allowed.get("providerModel", "")
        if not provider.startswith("openai/") or provider[7:] not in available:
            raise CliError("Native model metadata unavailable. Update RIFT.")
        model = copy.deepcopy(available[provider[7:]])
        model.update({
            "slug": allowed["id"], "display_name": allowed["label"],
            "use_responses_lite": False, "prefer_websockets": False,
            "input_modalities": ["text"], "supports_image_detail_original": False,
        })
        efforts = allowed.get("efforts", [])
        model["supported_reasoning_levels"] = [
            level for level in model.get("supported_reasoning_levels", []) if level.get("effort") in efforts
        ]
        models.append(model)
    return {"models": models}


def child_environment(home=None, nonce=None):
    allowed = ("HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "SHELL", "USER", "LOGNAME", "TERM", "COLORTERM", "TERM_PROGRAM", "SystemRoot", "WINDIR")
    env = {name: os.environ[name] for name in allowed if name in os.environ}
    if home is not None:
        env["RIFT_HOME"] = str(home)
    if nonce is not None:
        env["RIFT_NATIVE_NONCE"] = nonce
    return env


def run_managed_process(command, cwd, env):
    child = subprocess.Popen(command, cwd=cwd, env=env)
    previous = {}

    def forward(signum, _frame):
        if child.poll() is None:
            if signum == signal.SIGINT:
                try:
                    if os.isatty(0) and os.tcgetpgrp(0) == os.getpgrp() == os.getpgid(child.pid):
                        return
                except OSError:
                    pass
            child.send_signal(signum)

    if threading.current_thread() is threading.main_thread():
        for signum in (signal.SIGINT, signal.SIGTERM, getattr(signal, "SIGHUP", None)):
            if signum is not None:
                previous[signum] = signal.signal(signum, forward)
    try:
        return child.wait()
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


def validate_native_arguments(arguments):
    """Reject execution selectors whose account routing is outside this relay.

    Only inspect option syntax before `--`; everything after it is prompt text.
    Skip values (including attached short values) so literal text is not a flag.
    Only the first non-option token selects a root command; later words are prompts.
    Profiles are intentionally unsupported until their routing is verified.
    """
    blocked_options = {"--oss", "--local-provider", "--remote", "--remote-auth-token-env", "--profile"}
    blocked_commands = {"cloud", "cloud-tasks", "app-server", "exec-server", "remote-control",
                        "agents", "responses-api-proxy", "stdio-to-uds", "debug", "app", "login", "logout"}
    value_options = {"--config", "--image", "--model", "--sandbox", "--cd", "--ask-for-approval",
                     "--output-last-message", "--output-schema", "--color", "--add-dir",
                     "--thread-source", "--enable", "--disable"}
    skip_value = False
    root_resolved = False
    for argument in arguments:
        if argument == "--":
            break
        if skip_value:
            skip_value = False
            continue
        option = argument.split("=", 1)[0]
        is_root_command = not root_resolved and not argument.startswith("-")
        if is_root_command:
            root_resolved = True
        if option in blocked_options or (is_root_command and argument in blocked_commands):
            raise CliError("Alternate providers, remote execution, and profiles are unavailable in the RIFT account launcher.")
        if option in value_options:
            skip_value = "=" not in argument
        elif argument.startswith("-") and not argument.startswith("--"):
            for index, flag in enumerate(argument[1:], 1):
                if flag == "p":
                    raise CliError("Profiles are unavailable in the RIFT account launcher.")
                if flag in "cimsCao":
                    skip_value = index == len(argument) - 1
                    break


def run_child(bundle, config, base_url, nonce, arguments, cwd):
    validate_native_arguments(arguments)
    owner_scope = hashlib.sha256(config["ownerId"].encode()).hexdigest()
    state = Path.home() / ".rift" / "codex-native-terminal" / owner_scope
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix="launch-", dir=state) as launch_dir:
        catalog = map_catalog(json.loads((bundle / "models.json").read_text()), config)
        catalog_path = Path(launch_dir) / "models.json"
        catalog_path.write_text(json.dumps(catalog))
        settings = [
            'model_provider="rift_native"', f'model={config["defaultModel"]}',
            "check_for_update_on_startup=false", 'web_search="disabled"',
            "model_catalog_json=" + json.dumps(str(catalog_path)),
            'approval_policy="on-request"', 'sandbox_mode="read-only"',
            'model_providers.rift_native.name="RIFT account"',
            f'model_providers.rift_native.base_url="{base_url}"',
            'model_providers.rift_native.env_key="RIFT_NATIVE_NONCE"',
            'model_providers.rift_native.wire_api="responses"',
            "model_providers.rift_native.requires_openai_auth=false",
            "model_providers.rift_native.request_max_retries=0",
            "model_providers.rift_native.stream_max_retries=0",
            "model_providers.rift_native.supports_websockets=false",
        ]
        # Root and exec -c occurrences do not reliably merge in this packaged
        # clap parser. Use the final selected scope, before its option terminator.
        boundary = arguments.index("--") if "--" in arguments else len(arguments)
        command = [str(bundle / "rift"), *arguments[:boundary]]
        for setting in settings:
            command.extend(("-c", setting))
        command.extend(arguments[boundary:])
        return run_managed_process(command, cwd, child_environment(state, nonce))


def legacy(data_dir, arguments):
    backups = sorted((data_dir / "backups").glob("rift-*"), reverse=True)
    if not backups:
        raise CliError("This command requires the legacy RIFT CLI, but no preserved entrypoint is available.")
    return subprocess.run([str(backups[0]), *arguments]).returncode


def data_root_for_bundle(bundle):
    bundle = Path(bundle).resolve()
    if bundle.parent.name == "versions":
        return bundle.parent.parent
    return bundle.parent


def main(argv=None):
    arguments = list(sys.argv[1:] if argv is None else argv)
    bundle = Path(__file__).resolve().parent
    data_dir = data_root_for_bundle(bundle)
    explicit_opencode = bool(arguments and arguments[0] == "opencode")
    if explicit_opencode:
        arguments = arguments[1:]
    model = requested_model(arguments)
    use_opencode = explicit_opencode or model in OPENCODE_MODELS
    if use_opencode and not (bundle / "opencode").is_file():
        print("rift: Packaged OpenCode engine is unavailable. Reinstall RIFT CLI.", file=sys.stderr)
        return 1
    if use_opencode:
        sys.modules.setdefault("native_cli", sys.modules[__name__])
        import opencode_cli
        try:
            model = opencode_cli.requested_model(arguments)
        except CliError as error:
            print(f"rift: {error}", file=sys.stderr); return 1
    if not use_opencode and arguments and arguments[0] in {"--cloud", "--pair", "doctor", "login"}:
        return legacy(data_dir, arguments)
    if use_opencode and len(arguments) == 1 and arguments[0] in {"--help", "-h", "--version", "-v"}:
        return subprocess.run([str(bundle / "opencode"), *arguments], env=child_environment()).returncode
    if not use_opencode and arguments and arguments[0] in {"--help", "-h", "--version", "-V"}:
        return subprocess.run([str(bundle / "rift"), *arguments], env=child_environment()).returncode
    try:
        if not use_opencode:
            validate_native_arguments(arguments)
        login_path = Path.home() / ".config" / "rift" / "console.json"
        try:
            login = json.loads(login_path.read_text())
        except (OSError, ValueError):
            raise CliError("Connect this RIFT account with rift login before opening native console.") from None
        origin, key = validate_login(login)
        if sys.stderr.isatty():
            print("Connecting to RIFT...", file=sys.stderr)
        if use_opencode:
            config = opencode_cli.fetch_config(origin, key)
            if model and model not in {entry.get("id") for entry in config["models"]}:
                raise CliError(f"OpenCode model is unavailable: {model}")
            relay = opencode_cli.OpenCodeRelay(origin, key).start()
        else:
            config = fetch_config(origin, key)
            relay = Relay(origin, key).start()
        try:
            if use_opencode:
                return opencode_cli.run_child(bundle, config, relay.base_url, relay.nonce, arguments, Path.cwd(), model)
            return run_child(bundle, config, relay.base_url, relay.nonce, arguments, Path.cwd())
        finally:
            relay.close()
    except CliError as error:
        print(f"rift: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
