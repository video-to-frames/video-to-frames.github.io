import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

function collectFiles(rootDir, currentDir = rootDir) {
  const results = [];
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(rootDir, fullPath));
    } else if (entry.isFile()) {
      const rel = path.relative(rootDir, fullPath).split(path.sep).join('/');
      if (rel !== 'sw.js' && !rel.endsWith('.map')) {
        results.push({ rel, fullPath });
      }
    }
  }
  return results;
}

function pwaPrecacheIntegration() {
  return {
    name: 'vtf-pwa-precache',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const distDir = fileURLToPath(dir);
        const swPath = path.join(distDir, 'sw.js');
        if (!fs.existsSync(swPath)) {
          logger.warn('sw.js not found in dist directory; skipping precache injection.');
          return;
        }

        const files = collectFiles(distDir).sort((a, b) => a.rel.localeCompare(b.rel));
        const hash = crypto.createHash('sha256');
        const urls = new Set();

        for (const file of files) {
          hash.update(file.rel);
          hash.update(fs.readFileSync(file.fullPath));
          if (file.rel === 'index.html') {
            urls.add('/');
          } else if (file.rel.endsWith('/index.html')) {
            urls.add(`/${file.rel.slice(0, -'index.html'.length)}`);
          } else {
            urls.add(`/${file.rel}`);
          }
        }

        const buildId = hash.digest('hex').slice(0, 10);
        const cacheName = `vtf-offline-${buildId}`;
        const precacheArray = JSON.stringify(Array.from(urls), null, 2);

        let swSource = fs.readFileSync(swPath, 'utf8');
        swSource = swSource
          .replace(/const CACHE_NAME = ['"][^'"]+['"];/, `const CACHE_NAME = '${cacheName}';`)
          .replace(/const PRECACHE_URLS = \[[\s\S]*?\];/, `const PRECACHE_URLS = ${precacheArray};`);

        fs.writeFileSync(swPath, swSource, 'utf8');
        logger.info(`Injected ${urls.size} offline precache URLs into sw.js (${cacheName}).`);
      },
    },
  };
}

export default defineConfig({
  site: 'https://video-to-frames.github.io',
  trailingSlash: 'always',
  output: 'static',
  integrations: [
    preact(),
    sitemap({
      changefreq: 'weekly',
      priority: 0.8,
      lastmod: new Date(),
      i18n: {
        defaultLocale: 'en',
        locales: {
          en: 'en',
          es: 'es',
          pt: 'pt',
          de: 'de',
          fr: 'fr',
          ja: 'ja',
          zh: 'zh-Hans',
          ru: 'ru',
        },
      },
    }),
    pwaPrecacheIntegration(),
  ],
});
