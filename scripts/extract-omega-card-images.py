#!/usr/bin/env python3
"""Extract browser-ready card images from copied YGO Omega Unity bundles."""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path


CARD_ID_RE = re.compile(r"(?<!\d)(\d{3,10})(?!\d)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract card textures from YGO Omega Unity bundles into public web images.",
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("public/assets/ygo-omega/de"),
        help="Copied YGO Omega asset root. Defaults to public/assets/ygo-omega/de.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/assets/cards/de"),
        help="Directory for extracted web images. Defaults to public/assets/cards/de.",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=None,
        help="Manifest path. Defaults to <output>/manifest.json.",
    )
    parser.add_argument(
        "--format",
        choices=("webp", "png"),
        default="webp",
        help="Output image format. Defaults to webp.",
    )
    parser.add_argument(
        "--quality",
        type=int,
        default=90,
        help="WebP quality from 1 to 100. Defaults to 90.",
    )
    parser.add_argument(
        "--include-unnamed",
        action="store_true",
        help="Also export textures whose names do not contain a known card id.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Stop after exporting this many images. Useful for testing the importer.",
    )
    return parser.parse_args()


def load_unitypy():
    try:
        import UnityPy  # type: ignore
    except ModuleNotFoundError:
        print(
            "Missing Python dependency: UnityPy\n\n"
            "Install the extractor dependencies, then run this script again:\n"
            "  python3 -m pip install UnityPy Pillow\n",
            file=sys.stderr,
        )
        raise SystemExit(2)

    return UnityPy


def known_card_ids(db_path: Path) -> set[str]:
    if not db_path.exists():
        return set()

    with sqlite3.connect(db_path) as connection:
        rows = connection.execute("select id from datas").fetchall()

    return {str(row[0]) for row in rows}


def bundle_payloads(source: Path) -> list[Path]:
    bundles = source / "bundles"
    if not bundles.exists():
        raise SystemExit(f"Bundle directory not found: {bundles}")

    return sorted(
        path
        for path in bundles.glob("*/**/__data")
        if path.parent.parent.name.startswith("arts") or path.parent.parent.name == "cds"
    )


def card_id_from_name(name: str, valid_ids: set[str]) -> str | None:
    for match in CARD_ID_RE.finditer(name):
        candidate = str(int(match.group(1)))
        if not valid_ids or candidate in valid_ids:
            return candidate

    return None


def texture_image(obj):
    data = obj.read()
    name = getattr(data, "name", None) or getattr(data, "m_Name", "")

    if obj.type.name == "Sprite":
        return data.image, name

    if obj.type.name == "Texture2D":
        return data.image, name

    return None, ""


def save_image(image, path: Path, image_format: str, quality: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA")

    if image_format == "webp":
        image.save(path, "WEBP", quality=quality, method=6)
        return

    image.save(path, "PNG", optimize=True)


def public_path(path: Path) -> str:
    normalized = path.as_posix()
    parts = normalized.split("/public/", 1)
    if len(parts) == 2:
        return "/" + parts[1]

    if normalized.startswith("public/"):
        return "/" + normalized[len("public/") :]

    return normalized


def main() -> int:
    args = parse_args()
    if not 1 <= args.quality <= 100:
        raise SystemExit("--quality must be between 1 and 100")

    UnityPy = load_unitypy()
    manifest_path = args.manifest or args.output / "manifest.json"
    valid_ids = known_card_ids(args.source / "db.sqlite")
    payloads = bundle_payloads(args.source)

    if not payloads:
        raise SystemExit(f"No Omega bundle payloads found below {args.source}")

    exported = 0
    skipped_without_id = 0
    failed_payloads: list[str] = []
    variants: dict[str, list[str]] = defaultdict(list)

    for payload in payloads:
        try:
            environment = UnityPy.load(str(payload))
        except Exception as exc:
            failed_payloads.append(f"{payload}: {exc}")
            continue

        for obj in environment.objects:
            if obj.type.name not in {"Sprite", "Texture2D"}:
                continue

            image, name = texture_image(obj)
            if image is None:
                continue

            card_id = card_id_from_name(name, valid_ids)
            if card_id is None:
                if not args.include_unnamed:
                    skipped_without_id += 1
                    continue
                card_id = f"unnamed-{exported + 1}"

            suffix = "" if not variants[card_id] else f"-{len(variants[card_id]) + 1}"
            filename = f"{card_id}{suffix}.{args.format}"
            output_path = args.output / filename

            save_image(image, output_path, args.format, args.quality)
            variants[card_id].append(public_path(output_path))
            exported += 1

            if args.limit is not None and exported >= args.limit:
                break

        if args.limit is not None and exported >= args.limit:
            break

    manifest = {
        "source": public_path(args.source),
        "format": args.format,
        "cards": {
            card_id: {
                "primary": paths[0],
                "variants": paths,
            }
            for card_id, paths in sorted(variants.items(), key=lambda item: item[0])
        },
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")

    print(f"Read {len(payloads)} Omega bundle payloads")
    print(f"Exported {exported} images to {args.output}")
    print(f"Wrote manifest to {manifest_path}")
    if skipped_without_id:
        print(f"Skipped {skipped_without_id} textures without a known card id")
    if failed_payloads:
        print(f"Skipped {len(failed_payloads)} payloads that UnityPy could not parse", file=sys.stderr)
        for failure in failed_payloads[:10]:
            print(f"  {failure}", file=sys.stderr)

    return 0 if exported else 1


if __name__ == "__main__":
    raise SystemExit(main())
