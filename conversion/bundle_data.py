"""Copy data consumed at import time that dependency-graph hooks do not collect."""
from pathlib import Path
import shutil
import sys
import importlib.util
from PyInstaller.utils.hooks import collect_data_files

root = Path(sys.argv[1]).resolve()
for package in ('latex2mathml', 'rapidocr'):
    for source, destination in collect_data_files(package):
        target = root / destination / Path(source).name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)

# Recent torchvision wheels load these libraries by file path; older freezer hooks only know _C.
vision = Path(next(iter(importlib.util.find_spec('torchvision').submodule_search_locations)))
for source in vision.rglob('*'):
    if source.is_file() and (source.suffix in ('.pyd', '.dll', '.dylib') or '.so' in source.name):
        target = root / 'torchvision' / source.relative_to(vision)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
