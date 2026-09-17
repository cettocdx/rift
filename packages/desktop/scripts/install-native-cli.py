#!/usr/bin/env python3
"""Verify and atomically install the standalone native RIFT CLI."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import time


REQUIRED = ("rift", "codex-code-mode-host", "LICENSE", "NOTICE", "models.json")


class InstallError(RuntimeError):
    pass


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def probe_environment():
    allowed = ("HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "SHELL", "USER", "LOGNAME", "TERM", "COLORTERM", "TERM_PROGRAM", "SystemRoot", "WINDIR")
    return {name: os.environ[name] for name in allowed if name in os.environ}


def is_native_wrapper(path):
    try:
        text = path.read_text()
    except (OSError, UnicodeError):
        return False
    return text.startswith("#!/bin/sh\nexec python3 ") and "/versions/native-" in text and "/native-cli.py\" \"$@\"" in text


def verify(source):
    try:
        manifest = json.loads((source / "provenance.json").read_text())
    except (OSError, ValueError):
        raise InstallError("Native bundle provenance is missing or invalid.") from None
    for name in REQUIRED:
        path = source / name
        if not path.is_file() or digest(path) != manifest.get("files", {}).get(name):
            raise InstallError(f"Native bundle checksum mismatch: {name}")
    for option in ("--version", "--help"):
        try:
            result = subprocess.run([str(source / "rift"), option], stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL, timeout=15, env=probe_environment())
        except (OSError, subprocess.TimeoutExpired):
            raise InstallError(f"Native executable failed offline probe: {option}") from None
        if result.returncode != 0:
            raise InstallError(f"Native executable failed offline probe: {option}")


def verify_opencode(source):
    try:
        manifest = json.loads((source / "provenance.json").read_text())
    except (OSError, ValueError):
        raise InstallError("OpenCode provenance is missing or invalid.") from None
    archive_name = manifest.get("name")
    if manifest.get("version") != "1.18.31" or not isinstance(archive_name, str):
        raise InstallError("OpenCode provenance is not pinned to version 1.18.31.")
    if not (source / "LICENSE").is_file() or not (source / "opencode").is_file() or not (source / archive_name).is_file():
        raise InstallError("OpenCode release assets are incomplete.")
    if digest(source / "opencode") != manifest.get("binarySha256"):
        raise InstallError("OpenCode checksum mismatch: opencode")
    if "sha256:" + digest(source / archive_name) != manifest.get("digest"):
        raise InstallError(f"OpenCode checksum mismatch: {archive_name}")
    result = subprocess.run([str(source / "opencode"), "--version"], capture_output=True, text=True, timeout=15, env=probe_environment())
    if result.returncode or result.stdout.strip() != "1.18.31":
        raise InstallError("OpenCode executable is not pinned version 1.18.31.")


def install(source, bin_dir, data_dir, opencode_source=None):
    source, bin_dir, data_dir = map(Path, (source, bin_dir, data_dir))
    verify(source)
    if opencode_source is not None:
        opencode_source = Path(opencode_source); verify_opencode(opencode_source)
    parent = data_dir.parent
    parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".rift-native-stage-", dir=parent))
    wrapper = None
    try:
        for name in (*REQUIRED, "provenance.json"):
            shutil.copy2(source / name, staging / name)
        shutil.copy2(Path(__file__).with_name("native-cli.py"), staging / "native-cli.py")
        shutil.copy2(Path(__file__).with_name("opencode_cli.py"), staging / "opencode_cli.py")
        if opencode_source is not None:
            opencode_manifest = json.loads((opencode_source / "provenance.json").read_text())
            shutil.copy2(opencode_source / "opencode", staging / "opencode")
            shutil.copy2(opencode_source / "LICENSE", staging / "OPENCODE-LICENSE")
            shutil.copy2(opencode_source / "provenance.json", staging / "opencode-provenance.json")
            shutil.copy2(opencode_source / opencode_manifest["name"], staging / opencode_manifest["name"])
        (staging / "native-cli.py").chmod(0o755)
        bin_dir.mkdir(parents=True, exist_ok=True)
        data_dir.mkdir(parents=True, exist_ok=True)
        backups = data_dir / "backups"
        backups.mkdir(exist_ok=True)
        entrypoint = bin_dir / "rift"
        if (entrypoint.exists() or entrypoint.is_symlink()) and not is_native_wrapper(entrypoint):
            backup = backups / f"rift-{time.time_ns()}"
            shutil.copy2(entrypoint, backup, follow_symlinks=True)
            backup.chmod(backup.stat().st_mode | stat.S_IXUSR)
        versions = data_dir / "versions"
        versions.mkdir(exist_ok=True)
        current = versions / f"native-{time.time_ns()}"
        os.replace(staging, current)
        staging = None
        wrapper = bin_dir / f".rift-{time.time_ns()}.tmp"
        wrapper.write_text(f'#!/bin/sh\nexec python3 "{current / "native-cli.py"}" "$@"\n')
        wrapper.chmod(0o755)
        os.replace(wrapper, entrypoint)
        wrapper = None
    finally:
        if staging is not None:
            shutil.rmtree(staging, ignore_errors=True)
        if wrapper is not None:
            wrapper.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--bin-dir", type=Path, default=Path.home() / ".local" / "bin")
    parser.add_argument("--data-dir", type=Path, default=Path.home() / ".local" / "share" / "rift-native")
    parser.add_argument("--opencode-source", type=Path)
    args = parser.parse_args()
    try:
        install(args.source, args.bin_dir, args.data_dir, args.opencode_source)
    except InstallError as error:
        parser.exit(1, f"install-native-cli: {error}\n")
    print(f"Installed native RIFT CLI at {args.bin_dir / 'rift'}")


if __name__ == "__main__":
    main()
