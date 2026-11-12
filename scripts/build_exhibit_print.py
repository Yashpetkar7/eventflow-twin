"""Build the printed booth material (task K8): A1 poster + English and Arabic A4 handouts → exhibit/poster/*.pdf.

    python scripts/build_exhibit_print.py [--base http://localhost:3000] [--qr URL]

Needs the API and the web app running (the hero image is captured from the live 3D twin) and `segno` for the QR code
(`pip install segno`). Without --qr the poster shows a "QR added when the link is approved" box — only pass the public
demo URL after Dr. Rachit has approved it (task K1/K7). PDFs and captured images are git-ignored; regenerate any time.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POSTER = ROOT / "exhibit/poster"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--base", default="http://localhost:3000", help="running web app (API reachable from it)")
    ap.add_argument("--qr", default=None, help="URL for the QR code (omit until the link is approved)")
    a = ap.parse_args()

    (POSTER / "img").mkdir(parents=True, exist_ok=True)
    qr = POSTER / "img/qr.svg"
    if a.qr:
        import segno
        segno.make(a.qr, error="m").save(qr, scale=10, border=1, dark="#0F2F8F")
        print(f"QR → {a.qr}")
    elif qr.exists():
        qr.unlink()                                   # never leave a stale QR on a reprint
    node = subprocess.run(["node", "tests/print_exhibit.mjs", a.base], cwd=ROOT / "apps/web")
    return node.returncode


if __name__ == "__main__":
    sys.exit(main())
