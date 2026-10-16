"""Path-naming shim for CVAT: CVAT names frames after the URL's last path segment, and every TiTiler bbox URL
ends in '1024x1024.png', so two chips collide. This serves /<any_name>.png?u=<TiTiler URL> by streaming the upstream.
Not needed for Label Studio or labelme. Run: python chip_proxy.py 8020"""
import sys, requests
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        q = parse_qs(urlparse(self.path).query); up = q.get("u", [None])[0]
        if not up: self.send_error(400, "missing u="); return
        r = requests.get(up, timeout=300)
        self.send_response(r.status_code); self.send_header("Content-Type", r.headers.get("content-type", "image/png"))
        self.send_header("Content-Length", str(len(r.content))); self.end_headers(); self.wfile.write(r.content)
    def log_message(self, *a): pass

ThreadingHTTPServer(("0.0.0.0", int(sys.argv[1]) if len(sys.argv) > 1 else 8020), H).serve_forever()
