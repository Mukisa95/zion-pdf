"""Generate platform icons from the approved artwork. Requires Pillow; not used at app runtime."""
from pathlib import Path
import argparse
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def generate(source):
    with Image.open(source) as original:
        artwork = original.convert("RGBA")
    # Keep the complete design and its transparency; platform icon canvases must be square.
    artwork.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    master = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    master.alpha_composite(artwork, ((1024 - artwork.width) // 2, (1024 - artwork.height) // 2))
    for directory in ("build", "build/icons", "electron", "public"):
        (ROOT / directory).mkdir(parents=True, exist_ok=True)
    master.save(ROOT / "build/icon.png", optimize=True)
    master.save(ROOT / "build/icon.ico", sizes=[(n, n) for n in (16, 20, 24, 32, 40, 48, 64, 128, 256)])
    master.save(ROOT / "build/icon.icns")
    for size in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
        master.resize((size, size), Image.Resampling.LANCZOS).save(ROOT / f"build/icons/{size}x{size}.png", optimize=True)
    master.resize((256, 256), Image.Resampling.LANCZOS).save(ROOT / "electron/icon.png", optimize=True)
    shutil.copyfile(ROOT / "build/icon.ico", ROOT / "electron/icon.ico")
    for filename, size in (("app-icon.png", 128), ("favicon-32.png", 32), ("apple-touch-icon.png", 180)):
        master.resize((size, size), Image.Resampling.LANCZOS).save(ROOT / "public" / filename, optimize=True)
    master.save(ROOT / "public/favicon.ico", sizes=[(n, n) for n in (16, 32, 48, 64)])
    print("Generated Windows ICO, macOS ICNS, Linux PNG sizes, desktop window icon and web branding.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", type=Path, default=ROOT / "build/icon-source.png")
    generate(parser.parse_args().source)
