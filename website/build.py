#!/usr/bin/env python3
"""Render Yarvan's static landing page, including a portable, offline HTML preview."""

import argparse
import base64
import html
import json
import re
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = "https://github.com/ghahremany/yarvan-agent"
HOMEPAGE = "https://ghahremany.github.io/yarvan-agent/"
# The website only advertises versions whose installer assets were independently verified.
INSTALLER_VERSION = "0.1.1-beta.1"


def data_uri(path, mime):
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def shape(data):
    if isinstance(data, dict):
        return {key: shape(value) for key, value in data.items()}
    if isinstance(data, list):
        return [shape(value) for value in data]
    if not isinstance(data, str) or not data.strip():
        raise ValueError("Translation leaves must be nonempty strings")
    return None


def render():
    messages = json.loads((HERE / "messages.json").read_text(encoding="utf-8"))
    if shape(messages["fa"]) != shape(messages["en"]) or len(messages["fa"]["examples"]) != 4:
        raise ValueError("Persian and English copy must have matching keys and four examples")

    css = (HERE / "site.css").read_text(encoding="utf-8")
    for key, filename in {"inter": "inter-latin.woff2", "vazirmatn": "vazirmatn-arabic.woff2"}.items():
        css = css.replace("{{" + key + "}}", data_uri(HERE / "fonts" / filename, "font/woff2"))

    raw = {
        "!css": css,
        "!script": (HERE / "site.js").read_text(encoding="utf-8"),
        "!messages": json.dumps(messages, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c"),
    }
    values = {
        **messages["fa"],
        "repo": REPO,
        "homepage": HOMEPAGE,
        "installer": {
            "version": INSTALLER_VERSION,
            "release": REPO + "/releases/tag/v" + INSTALLER_VERSION,
            "assets": REPO + "/releases/download/v" + INSTALLER_VERSION + "/",
        },
        "guide": REPO + "/blob/main/docs/yarvan/guide-fa.md",
        "icon": data_uri(HERE.parent / "public" / "app-icon.svg", "image/svg+xml"),
    }

    def replace(match):
        key = match.group(1)
        if key in raw:
            return raw[key]
        value = values
        for field in key.split("."):
            value = value[int(field)] if isinstance(value, list) else value[field]
        return html.escape(value, quote=True)

    template = (HERE / "index.template.html").read_text(encoding="utf-8")
    rendered = re.sub(r"\{\{([!a-zA-Z0-9._]+)\}\}", replace, template)
    licenses = "\n\n".join(p.read_text(encoding="utf-8") for p in sorted((HERE / "fonts").glob("OFL-*.txt")))
    return rendered + "\n<!-- Embedded font licenses (Inter and Vazirmatn)\n" + licenses + "\n-->\n"


def write(path, contents):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(contents, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True, help="Directory for the Pages artifact")
    parser.add_argument("--preview", type=Path, help="Optional copy as a single offline HTML file")
    args = parser.parse_args()
    output = render()
    write(args.out / "index.html", output)
    write(args.out / ".nojekyll", "")
    shutil.copyfile(HERE / "og.png", args.out / "og.png")
    if args.preview:
        write(args.preview, output)
    print(f"Built {args.out / 'index.html'} ({len(output.encode('utf-8')):,} bytes)")


if __name__ == "__main__":
    main()
