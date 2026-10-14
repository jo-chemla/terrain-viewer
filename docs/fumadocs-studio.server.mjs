// Node-only half of the Studio config (fumadocs-studio.config.tsx points
// here): serve docs/public so the screenshots show in visual mode. Prose
// images are written `/screenshots/...` (Next adds the /docs basePath on the
// site); the Gallery literals carry `/docs/screenshots/...` already, so the
// middleware drops that prefix before Vite's static serving.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default {
  vite: {
    publicDir: path.join(here, 'public'),
    plugins: [
      {
        name: 'terrain-viewer-docs-basepath',
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            if (req.url?.startsWith('/docs/')) req.url = req.url.slice('/docs'.length);
            next();
          });
        },
      },
    ],
  },
};
