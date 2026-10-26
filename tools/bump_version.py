"""Bump the ledger's edition for a release, everywhere at once.

    python3 tools/bump_version.py            # ledger-v6 -> ledger-v7
    python3 tools/bump_version.py ledger-v9  # set a specific edition

The edition lives in four places that must always agree: sw.js (the offline
copy), index.html (the address of js/boot.js), js/app.js and styles.css.
js/boot.js compares them when the app opens and repairs a phone that mixes
editions. Run this before every push that changes the app.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = ["sw.js", "index.html", "js/app.js", "styles.css"]
EDITION = re.compile(r"ledger-v(\d+)")


def main():
    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    current = re.search(r'const VERSION = "(ledger-v\d+)"', sw).group(1)
    new = sys.argv[1] if len(sys.argv) > 1 else f"ledger-v{int(current.split('v')[-1]) + 1}"
    if not EDITION.fullmatch(new):
        sys.exit(f"An edition looks like ledger-v7, not {new!r}.")
    # \b keeps ledger-v1 from matching inside ledger-v10.
    pattern = re.compile(rf"\b{re.escape(current)}\b")

    # Check every file first, so a problem never leaves the editions half bumped.
    texts = {}
    for name in FILES:
        text = (ROOT / name).read_text(encoding="utf-8")
        if not pattern.search(text):
            sys.exit(f"{name} doesn't mention {current}; nothing was changed. Check it by hand.")
        texts[name] = text

    for name, text in texts.items():
        (ROOT / name).write_text(pattern.sub(new, text), encoding="utf-8")
        print(f"{name}: {current} -> {new}")


if __name__ == "__main__":
    main()
