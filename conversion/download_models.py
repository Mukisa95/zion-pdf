"""Build-time downloads only. Model revisions and weight hashes are pinned."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import sys
import urllib.request

target = Path(sys.argv[1]).resolve()
models = [
    {"repo": "docling-project/docling-layout-heron", "revision": "8f39ad3c0b4c58e9c2d2c84a38465abf757272d8", "license": "Apache-2.0",
     "files": {"config.json": None, "preprocessor_config.json": None, "README.md": None,
               "model.safetensors": "00333a43451945aaf89db8ca9c0a17e75d1537c17db60fdb91aa95f4c7929e0c"}},
    {"repo": "docling-project/docling-models", "revision": "fc0f2d45e2218ea24bce5045f58a389aed16dc23", "license": "CDLA-Permissive-2.0",
     "files": {"README.md": None, "model_artifacts/tableformer/accurate/tm_config.json": None,
               "model_artifacts/tableformer/accurate/tableformer_accurate.safetensors": "2a7d6c924b3cd12fb99a09280ca9c33a89c5d60b93253617d2e088c1a40374d9"}},
]

def download(model, name, expected):
    destination = target / model['repo'].replace('/', '--') / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        with destination.open('rb') as stream:
            if not expected or hashlib.file_digest(stream, 'sha256').hexdigest() == expected:
                return
    url = f"https://huggingface.co/{model['repo']}/resolve/{model['revision']}/{name}"
    temp = destination.with_suffix(destination.suffix + '.download')
    print(f"Downloading {model['repo']}/{name}", flush=True)
    with urllib.request.urlopen(url, timeout=120) as response, temp.open('wb') as stream:
        while chunk := response.read(1024 * 1024):
            stream.write(chunk)
    with temp.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if expected and digest != expected:
        raise ValueError(f"Model checksum mismatch: {name}")
    temp.replace(destination)

with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    futures = [pool.submit(download, model, name, digest) for model in models for name, digest in model['files'].items()]
    for future in futures:
        future.result()
(target / 'models.json').write_text(json.dumps(models, indent=2), encoding='utf-8')
