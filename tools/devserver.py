# Local dev server (not deployed): static files with caching disabled, so every reload picks up edits.
# usage: python tools/devserver.py [port]   (serves the hyperdrive-sim folder)
import http.server, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm'}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    # mirror Vercel's cleanUrls: /sim serves sim.html
    def translate_path(self, path):
        full = super().translate_path(path)
        if not os.path.splitext(full)[1] and not os.path.isdir(full) and os.path.isfile(full + '.html'):
            return full + '.html'
        return full

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    http.server.ThreadingHTTPServer(('127.0.0.1', port), NoCache).serve_forever()
