import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const ASSET_DIRS = ['models', 'sounds'] as const;

function scanAssets(root: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const dir of ASSET_DIRS) {
    const full = path.join(root, 'public', 'assets', dir);
    try {
      out[dir] = fs
        .readdirSync(full)
        .filter((f) => !f.startsWith('.') && !/\.md$/i.test(f));
    } catch {
      out[dir] = [];
    }
  }
  return out;
}

/**
 * Publishes the contents of public/assets as assets/manifest.json.
 *
 * The game uses this to discover optional drop-in assets (a real nissan_z.glb,
 * real engine samples) without firing speculative requests that would litter
 * the console with 404s. In dev the folder is re-scanned on every request, so
 * dropping a file in and refreshing the page is enough.
 */
function assetManifest(): Plugin {
  let root = process.cwd();
  return {
    name: 'z-asset-manifest',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use('/assets/manifest.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(scanAssets(root)));
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'assets/manifest.json',
        source: JSON.stringify(scanAssets(root)),
      });
    },
  };
}

export default defineConfig({
  plugins: [assetManifest()],
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
});
