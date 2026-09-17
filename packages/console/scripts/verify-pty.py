#!/usr/bin/env python3
"""Exercise a standalone RIFT release in an isolated real PTY (macOS/Linux).

Usage: python3 scripts/verify-pty.py /absolute/path/to/release/rift
No credentials or existing conversation history are used. No model task runs.
"""
import argparse
import fcntl
import json
import os
import pty
import select
import signal
import struct
import subprocess
import tempfile
import termios
import time
from pathlib import Path


def verify(binary, draft):
    with tempfile.TemporaryDirectory(prefix="rift-pty-acceptance-") as root:
        config = Path(root) / "config"
        config.mkdir()
        env = {
            **os.environ,
            "RIFT_CONFIG_DIR": str(config),
            "RIFT_API_KEY": "",
            "RIFT_APP_URL": "http://localhost:9",
            "TERM": "xterm-256color",
            "COLORTERM": "truecolor",
        }
        master, slave = pty.openpty()
        proc = None
        output = bytearray()
        started = time.monotonic()
        try:
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
            before = termios.tcgetattr(slave)
            proc = subprocess.Popen(
                [binary], cwd=root, env=env, stdin=slave, stdout=slave,
                stderr=slave, start_new_session=True,
            )

            def drain(seconds, until_ready=False):
                deadline = time.monotonic() + seconds
                while time.monotonic() < deadline:
                    if select.select([master], [], [], 0.05)[0]:
                        chunk = os.read(master, 65536)
                        output.extend(chunk)
                        # Answer the standard cursor-position query as a terminal would.
                        if b"\x1b[6n" in chunk:
                            os.write(master, b"\x1b[1;1R")
                        if len(output) > 262144:
                            del output[:-262144]
                    if proc.poll() is not None:
                        return
                    if until_ready and b"RIFT" in output:
                        return

            drain(5, until_ready=True)
            if proc.poll() is not None or b"RIFT" not in output:
                raise RuntimeError("Release did not render RIFT in the PTY")
            startup_ms = round((time.monotonic() - started) * 1000)
            # Allow native input initialization to finish after the first paint.
            drain(0.3)
            if draft:
                os.write(master, b"unsent acceptance test draft")
                drain(0.2)
            stop_started = time.monotonic()
            os.write(master, b"\x03")
            drain(3)
            if proc.poll() is None:
                raise RuntimeError("One Ctrl+C did not exit the idle CLI")
            if proc.returncode != 0:
                raise RuntimeError(f"Unexpected exit code: {proc.returncode}")
            if termios.tcgetattr(slave) != before:
                raise RuntimeError("CLI did not restore terminal attributes")
            return {
                "scenario": "unsent-draft" if draft else "idle",
                "startupMs": startup_ms,
                "ctrlCExitMs": round((time.monotonic() - stop_started) * 1000),
                "exitCode": proc.returncode,
                "terminalRestored": True,
                "isolatedConfig": True,
            }
        finally:
            if proc is not None and proc.poll() is None:
                os.killpg(proc.pid, signal.SIGTERM)
                try:
                    proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait(timeout=2)
            os.close(master)
            os.close(slave)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    args = parser.parse_args()
    binary = str(args.binary.resolve(strict=True))
    print(json.dumps({"binary": binary, "results": [verify(binary, draft) for draft in [False, True]]}))
