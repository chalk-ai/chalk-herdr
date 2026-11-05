#!/usr/bin/env -S uv run --script
#
# /// script
# requires-python = ">=3.12"
# dependencies = ["chalkcompute>=2.13"]
# ///
"""Provision a Chalk sandbox with Claude Code + tmux. Prints one JSON line on stdout."""

import argparse
import json
import re
import sys

import chalkcompute as cc


def to_duration(value: str) -> str:
    """Convert '8h' / '30m' / '90s' into the protobuf duration string the SDK requires."""
    m = re.fullmatch(r"(\d+)([smhd])", value.strip())
    if not m:
        raise SystemExit(f"Invalid lifetime {value!r}; use e.g. 90s, 30m, 8h, 1d")
    return f"{int(m.group(1)) * {'s': 1, 'm': 60, 'h': 3600, 'd': 86400}[m.group(2)]}s"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--name", required=True)
    p.add_argument("--cpu", default="2")
    p.add_argument("--memory", default="8Gi")
    p.add_argument("--lifetime", default="8h")
    p.add_argument("--workdir", default="/workspace/repo")
    p.add_argument("--claude-version", default=None)
    p.add_argument("--anthropic-secret", default=None, help="Chalk secret holding CLAUDE_CODE_OAUTH_TOKEN")
    args = p.parse_args()

    image = (
        cc.Image.sandbox()
        .with_claude_code(
            *([args.claude_version] if args.claude_version else []),
            trusted_dirs=[args.workdir],
        )
        .with_tmux()
        .workdir(args.workdir)
    )
    sandbox = cc.Sandbox(
        name=args.name,
        image=image,
        cpu=args.cpu,
        memory=args.memory,
        lifetime=to_duration(args.lifetime),
        tags={"provisioner": "herdr-chalk-sandbox"},
    )
    if args.anthropic_secret:
        sandbox = sandbox.add_credentials(
            "api.anthropic.com",
            cc.Secret.from_chalk_env(args.anthropic_secret, alias="CLAUDE_CODE_OAUTH_TOKEN"),
        )
    sandbox = sandbox.run()
    sandbox.exec("mkdir", "-p", args.workdir)
    print(json.dumps({"id": sandbox.id, "name": args.name}))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
