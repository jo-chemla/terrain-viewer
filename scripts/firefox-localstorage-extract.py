#!/usr/bin/env python3
"""Pull Terrain Viewer's saved bookmarks (or any localStorage key) out of a
Firefox profile, for a site you can no longer open on its old address.

Firefox keeps localStorage per origin under
  <profile>/storage/default/<origin>/ls/data.sqlite
where <origin> looks like  https+++jo-chemla.github.io  . Values are often
Snappy-compressed (compression_type 1). Run with Firefox closed, or on a copy
of the folder.

  python firefox-localstorage-extract.py "<profile>/storage/default/https+++jo-chemla.github.io/ls/data.sqlite" bookmarks > bookmarks.json

Then Bookmarks > Import in the app reads bookmarks.json. Needs `pip install
python-snappy` only if a value is compressed (the script says so).

Profile folders: Windows %APPDATA%\\Mozilla\\Firefox\\Profiles\\, macOS
~/Library/Application Support/Firefox/Profiles/, Linux ~/.mozilla/firefox/;
about:profiles in Firefox shows the one in use.
"""
import json
import sqlite3
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    path = sys.argv[1]
    key = sys.argv[2] if len(sys.argv) > 2 else "bookmarks"
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    cols = [c[1] for c in db.execute("PRAGMA table_info(data)")]
    rows = db.execute("SELECT key, value, compression_type, utf16_length FROM data").fetchall() if "compression_type" in cols else [
        (k, v, 0, None) for k, v in db.execute("SELECT key, value FROM data")
    ]
    if key == "--list":
        for k, _, c, _ in rows:
            print(f"{k}\t(compressed)" if c else k)
        return 0
    for k, value, compression, _ in rows:
        if k != key:
            continue
        if compression:
            try:
                import snappy  # type: ignore
            except ImportError:
                sys.stderr.write("value is Snappy-compressed: pip install python-snappy, then run again\n")
                return 1
            value = snappy.uncompress(value)
        text = value.decode("utf-8") if isinstance(value, (bytes, bytearray)) else str(value)
        # atomWithStorage stores JSON; print it pretty if it parses.
        try:
            print(json.dumps(json.loads(text), indent=2, ensure_ascii=False))
        except ValueError:
            print(text)
        return 0
    sys.stderr.write(f"no key {key!r}; keys here: {', '.join(k for k, *_ in rows)}\n")
    return 1


if __name__ == "__main__":
    sys.exit(main())
