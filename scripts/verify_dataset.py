"""Verify tos_radar_dataset/ against the recorded SHA-256 checksums in scripts/dataset.sha256.

Exit code 0 = every file is byte-identical to the original; 1 = missing, modified or not yet pulled from LFS.

Usage:  python scripts/verify_dataset.py
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "tos_radar_dataset"
SUMS = Path(__file__).with_name("dataset.sha256")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main() -> int:
    ok = True
    for line in SUMS.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        expected, name = line.split(maxsplit=1)
        path = DATASET / name.lstrip("*")
        if not path.exists():
            print(f"MISSING   {path.name}")
            ok = False
            continue
        with path.open("rb") as f:
            if f.read(40).startswith(b"version https://git-lfs"):
                print(f"LFS-PTR   {path.name}: only the LFS pointer is present; run `git lfs pull`")
                ok = False
                continue
        actual = sha256(path)
        status = "OK" if actual == expected else "MODIFIED"
        ok &= actual == expected
        print(f"{status:<9} {path.name} ({path.stat().st_size:,} bytes)")
    print("Dataset integrity: " + ("verified" if ok else "FAILED"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
