#!/usr/bin/env python3
"""Build a preprod mint fixture from a mainnet CIP-25 collection via Koios (no API key).

Scrapes N real assets under a mainnet policy id and writes
`.local/<slug>-mainnet.json` in the shape consumed by MintFromFixtureTool
(the generalized preprod minter). Each NFT entry preserves the RAW CIP-25
inner metadata object verbatim (`cip25`), so when we re-mint under a
time-locked preprod policy the assets render byte-identically in wallets
(files[], attributes, website, traits — all kept).

Usage:
    python3 scripts/mint/build-mainnet-fixture.py <slug> <policy_id> [count]

Example:
    python3 scripts/mint/build-mainnet-fixture.py gnomeskies \
        ec77283fe87b1ccd7e5e8eb963de4c90abc8488e1e090b16b7f70a50 24

Notes:
  - Koios is free + public (rate-limited). This is a one-shot scrape, so a
    single small page is enough — we never page the whole collection.
  - Skips royalty/reference tokens (empty asset_name, CIP-27 label 777) and
    anything whose name doesn't decode to UTF-8 or lacks CIP-25 metadata.
"""
import json
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

KOIOS = "https://api.koios.rest/api/v1"
REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / ".local"


def _post(path, body):
    req = urllib.request.Request(
        f"{KOIOS}{path}",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def _get(path):
    req = urllib.request.Request(f"{KOIOS}{path}", headers={"accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def _decode_name(name_hex):
    try:
        return bytes.fromhex(name_hex).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None


def _flatten_image(img):
    """CIP-25 allows image as a string or an array of string chunks."""
    if isinstance(img, list):
        return "".join(str(x) for x in img)
    return img


def _extract_cip25(asset, policy, name_key):
    """Pull the inner CIP-25 object for this asset out of its minting tx metadata."""
    md = asset.get("minting_tx_metadata")
    if not md:
        return None
    label = md.get("721")
    if not isinstance(label, dict):
        return None
    pol = label.get(policy)
    if not isinstance(pol, dict):
        return None
    # The minting tx may embed many assets; find this one by its decoded name key.
    inner = pol.get(name_key)
    if inner is None:
        # tolerate whitespace/case drift
        for k, v in pol.items():
            if k.strip() == name_key.strip():
                inner = v
                break
    return inner if isinstance(inner, dict) else None


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    slug = sys.argv[1]
    policy = sys.argv[2].lower()
    want = int(sys.argv[3]) if len(sys.argv) > 3 else 24

    # 1. List candidate asset names (one small page is plenty).
    listing = _get(f"/policy_asset_list?_asset_policy={policy}&limit={want * 3 + 10}")
    candidates = []
    for row in listing:
        name_hex = row.get("asset_name") or ""
        if not name_hex:  # royalty / empty-name token
            continue
        name = _decode_name(name_hex)
        if name is None:
            continue
        candidates.append((name_hex, name))

    # 2. Fetch metadata in SMALL chunks. Some collections (e.g. Gnomeskies)
    #    embed hundreds of assets per minting tx, so each asset_info row carries
    #    a huge minting_tx_metadata blob — a big batch 413s. Chunk small and
    #    stop as soon as we have `want` valid CIP-25 assets.
    nfts = []
    CHUNK = 6
    for i in range(0, len(candidates), CHUNK):
        if len(nfts) >= want:
            break
        chunk = candidates[i : i + CHUNK]
        info = _post("/asset_info", {"_asset_list": [[policy, h] for h, _ in chunk]})
        by_hex = {a.get("asset_name"): a for a in info}
        for name_hex, name in chunk:
            if len(nfts) >= want:
                break
            asset = by_hex.get(name_hex)
            if not asset:
                continue
            inner = _extract_cip25(asset, policy, name)
            if inner is None:
                continue
            nfts.append(
                {
                    "n": len(nfts) + 1,
                    "asset_name": name,
                    "asset_name_hex": name_hex,
                    "display_name": inner.get("name", name),
                    "image": _flatten_image(inner.get("image")),
                    "cip25": inner,
                }
            )
        time.sleep(0.05)

    if not nfts:
        print(f"ERROR: no CIP-25 assets extracted for {slug} ({policy})", file=sys.stderr)
        sys.exit(1)

    out = {
        "source": "Koios mainnet /policy_asset_list + /asset_info",
        "policy_id": policy,
        "slug": slug,
        "policy_label": slug,
        "standard": "cip25",
        "fetched_at": date.today().isoformat(),
        "count": len(nfts),
        "nfts": nfts,
    }
    OUT_DIR.mkdir(exist_ok=True)
    out_path = OUT_DIR / f"{slug}-mainnet.json"
    out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print(f"wrote {len(nfts)} NFTs → {out_path}")
    for n in nfts[:3]:
        print(f"  {n['asset_name']:32s} {n['display_name']!r}  {n['image']}")


if __name__ == "__main__":
    main()
