#!/usr/bin/env -S uv run --script
#
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Validate herdr-plugin.toml: required fields, id charset, and that command files exist."""

import re
import sys
import tomllib
from pathlib import Path

root = Path(__file__).resolve().parent.parent
m = tomllib.loads((root / "herdr-plugin.toml").read_text())
errors: list[str] = []
for f in ("id", "name", "version", "min_herdr_version"):
    if not m.get(f):
        errors.append(f"missing {f}")
if not re.fullmatch(r"[A-Za-z0-9.:_-]+", m.get("id", "")):
    errors.append("invalid plugin id")
seen: set[str] = set()
for a in m.get("actions", []):
    if not re.fullmatch(r"[A-Za-z0-9:_-]+", a["id"]):
        errors.append(f"invalid action id {a['id']}")
    if a["id"] in seen:
        errors.append(f"duplicate action id {a['id']}")
    seen.add(a["id"])
    if not a.get("command"):
        errors.append(f"action {a['id']} has no command")
    for arg in a.get("command", []):
        if arg.endswith((".mjs", ".py")) and not (root / arg).exists():
            errors.append(f"action {a['id']}: {arg} does not exist")
if errors:
    sys.exit("\n".join(errors))
print(f"manifest ok: {m['id']} {m['version']} ({len(seen)} actions)")
