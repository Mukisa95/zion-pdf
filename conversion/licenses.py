"""Keep installed dependency notices with the frozen runtime."""
import importlib.metadata
import json
import shutil
import sys
from pathlib import Path

target = Path(sys.argv[1]); target.mkdir(parents=True, exist_ok=True)
packages = []
for dist in importlib.metadata.distributions():
    name = dist.metadata['Name']; version = dist.version
    packages.append({'name': name, 'version': version, 'license': dist.metadata.get('License-Expression') or dist.metadata.get('License'), 'home': dist.metadata.get('Home-page')})
    for entry in dist.files or []:
        if any(word in Path(entry).name.lower() for word in ('license', 'copying', 'notice')):
            source = Path(dist.locate_file(entry))
            if source.is_file():
                destination = target / name / Path(*[part for part in entry.parts if part not in ('.', '..')])
                destination.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(source, destination)
(target / 'packages.json').write_text(json.dumps(packages, indent=2), encoding='utf-8')

shutil.copytree(Path(__file__).parent / 'licenses', target / 'models', dirs_exist_ok=True)
