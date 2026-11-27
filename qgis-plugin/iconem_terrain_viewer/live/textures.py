"""The matcap pictures, fetched once from the app (or Potree's repository,
as lib/matcap-textures.ts lists them) and decoded by Qt: (h, w, 3) float32
0-1, kept for the session."""
import threading
import urllib.request

import numpy as np

from .dem import USER_AGENT, image_rgb
from .modes import MATCAP_TEXTURES

_cache = {}
_lock = threading.Lock()


def matcap_texture(texture_id):
    with _lock:
        t = _cache.get(texture_id)
    if t is not None:
        return t
    url = MATCAP_TEXTURES.get(texture_id) or MATCAP_TEXTURES["clay_studio"]
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    t = image_rgb(data).astype(np.float32) / 255.0
    with _lock:
        _cache[texture_id] = t
    return t
