#!/usr/bin/env python3
"""Validate and upload legacy page PNGs to R2 (dry-run by default)."""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
from pathlib import Path


PAGE_RE = re.compile(r"\d{4}-\d{2}-\d{2}\.png")
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
MAX_BYTES = 4 * 1024 * 1024


def wrangler_command(config: Path, execute: bool) -> list[str]:
    """Return a cross-platform Wrangler invocation.

    Calling the `npx` shim directly works on POSIX but fails on Windows where
    the shim is `npx.cmd`.  Running Wrangler's JavaScript entrypoint through
    Node avoids shell-specific shims and keeps subprocess arguments unquoted.
    """
    node = shutil.which("node") or "node"
    wrangler = config.resolve().parent / "node_modules" / "wrangler" / "bin" / "wrangler.js"
    if execute:
        if not shutil.which("node"):
            raise FileNotFoundError("node executable was not found on PATH")
        if not wrangler.is_file():
            raise FileNotFoundError(
                f"Wrangler is not installed at {wrangler}; run npm ci in {config.parent}"
            )
    return [node, str(wrangler)]


def page_files(directory: Path) -> list[Path]:
    if not directory.is_dir():
        raise NotADirectoryError(directory)
    files = []
    for path in sorted(directory.iterdir(), key=lambda item: item.name):
        if not path.is_file() or not PAGE_RE.fullmatch(path.name):
            continue
        size = path.stat().st_size
        if size <= 0 or size > MAX_BYTES:
            raise ValueError(f"invalid page size: {path} ({size} bytes)")
        with path.open("rb") as handle:
            if handle.read(len(PNG_MAGIC)) != PNG_MAGIC:
                raise ValueError(f"not a PNG: {path}")
        files.append(path)
    return files


def upload(directory: Path, bucket: str, config: Path, execute: bool) -> list[list[str]]:
    commands = []
    launcher = wrangler_command(config, execute)
    for path in page_files(directory):
        command = [
            *launcher, "r2", "object", "put",
            f"{bucket}/pages/{path.name}",
            "--file", str(path.resolve()),
            "--content-type", "image/png",
            "--remote",
            "--config", str(config.resolve()),
        ]
        commands.append(command)
        print(" ".join(command))
        if execute:
            subprocess.run(command, check=True)
    return commands


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pages_dir", type=Path)
    parser.add_argument("--bucket", default="shared-page-pages")
    parser.add_argument(
        "--config", type=Path,
        default=Path(__file__).parents[1] / "application/wrangler.jsonc",
    )
    parser.add_argument("--execute", action="store_true", help="perform uploads")
    args = parser.parse_args()
    commands = upload(args.pages_dir, args.bucket, args.config, args.execute)
    print(f"{'uploaded' if args.execute else 'would upload'} {len(commands)} page(s)")


if __name__ == "__main__":
    main()
