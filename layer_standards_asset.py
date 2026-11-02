"""Read the public layer standards asset from its BCV2 bundle at runtime."""
from pathlib import Path
import vault

ROOT = Path(__file__).resolve().parent
PACK = ROOT / 'rules' / 'layer-standards.pack'
SOURCE_NAME = 'layer-standards-data.js'

def read_layer_standards(pack_path=PACK):
    """Return decrypted generated layer standards JS bytes, or None when unavailable."""
    path = Path(pack_path)
    if not path.is_file():
        return None
    try:
        files = vault.unpack(path.read_bytes())
    except (ValueError, OSError):
        return None
    return files.get(SOURCE_NAME)

def screen_file(name, pack_path=PACK):
    """SCREEN route helper: only the known asset name is served from the encrypted pack."""
    return read_layer_standards(pack_path) if name == SOURCE_NAME else None
