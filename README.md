# Video to Frames — Client-Side Video Frame Extractor

[![Live Site](https://img.shields.io/badge/Live%20Tool-video--to--frames.github.io-F5AFAF?style=flat-square&labelColor=1E1B1B)](https://video-to-frames.github.io/)
[![Astro](https://img.shields.io/badge/Built%20with-Astro%20Islands-BC52EE?style=flat-square&labelColor=1E1B1B)](https://astro.build/)
[![Privacy](https://img.shields.io/badge/Processing-100%25%20Client--Side-2EA043?style=flat-square&labelColor=1E1B1B)](#privacy-first-architecture)
[![PWA](https://img.shields.io/badge/PWA-Offline%20Ready-0969DA?style=flat-square&labelColor=1E1B1B)](#offline-pwa-support)
[![Languages](https://img.shields.io/badge/Languages-8%20Locales-E3B341?style=flat-square&labelColor=1E1B1B)](#internationalization)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square&labelColor=1E1B1B)](./LICENSE)

A fast, tactile, **100% browser-based video frame extractor** built with **Astro Islands Architecture**. Extract lossless PNG or compact JPG frames from MP4, WebM, MOV, AVI, and MKV videos directly in browser memory — **no server uploads, no watermarks, and 100% offline capable**.

**Live Demo:** [https://video-to-frames.github.io/](https://video-to-frames.github.io/)

---

## Key Features

- **100% Client-Side & Private ("Video never leaves your device.")**
  - Uses local `URL.createObjectURL()`, HTML5 `<video>`, offscreen HTML5 `<canvas>`, and in-memory `JSZip` compression.
  - Zero server uploads, zero file size paywalls, and instant loading even on large 4K videos.
- **Two Extraction Workflows**
  - **Mode 1 — Single Frame Capture:** Interactive timestamp scrubber, `±1 Frame` / `±1s` stepping, direct timestamp jump, and keyboard shortcuts (`Space`, `←`/`→`, `C`).
  - **Mode 2 — Auto Batch Sequence:** Extract frames automatically **every N seconds** or at a custom **FPS** rate across a trimmed Start/End range with live progress bar and cancel support.
- **Native-Resolution PNG & JPG + Bulk ZIP**
  - Export lossless **PNG** stills or quality-tuned **JPG** (`50%`–`100%`) at exact source video pixel dimensions.
  - Full-resolution lightbox gallery preview, individual frame downloads, and one-click **Download All as ZIP**.
- **8-Language Internationalization**
  - Instant reactive UI switching persisted in `localStorage`, plus static crawlable locale pages for **English**, **Español**, **Português**, **Deutsch**, **Français**, **日本語**, **简体中文**, and **Русский**.
- **Offline PWA Support**
  - Complete `manifest.webmanifest` and build-time precached Service Worker (`sw.js`) so clicking **Add to Home Screen** enables 100% offline usage.
- **Tactile Light & Dark Modes**
  - High-contrast accessible palette (`#FCF8F8` / `#FBEFEF` / `#F5AFAF` / `#1E1B1B` in light mode; `#121010` / `#1C1818` / `#F5AFAF` / `#FCF8F8` in dark mode) with zero-FOUC theme persistence.

---

## Tech Stack

- **Framework:** [Astro](https://astro.build/) (Static output, Zero JS by default on guide/FAQ/privacy pages, single hydrated interactive island on the tool workspace)
- **Interactive Island:** [Preact](https://preactjs.com/) (`@astrojs/preact`)
- **Client-Side Packaging:** [JSZip](https://stuk.github.io/jszip/) (dynamically loaded only when exporting ZIPs)
- **SEO & Sitemaps:** `@astrojs/sitemap`, flat Google Search Console `sitemap.xml`, bidirectional `hreflang`, JSON-LD (`WebApplication`, `HowTo`, `FAQPage`, `BreadcrumbList`)
- **Deployment:** GitHub Actions (`.github/workflows/deploy.yml`) + GitHub Pages (`public/.nojekyll`)

---

## SEO Architecture Overview

- **Canonical & Multi-Language Routing:** Root English pages (`/`, `/how-it-works/`, `/privacy/`, `/faq/`) paired with static pre-rendered locale routes (`/es/`, `/pt/`, `/de/`, `/fr/`, `/ja/`, `/zh/`, `/ru/`) and full bidirectional `hreflang` + `x-default` metadata.
- **Dual Sitemap Discovery:** Serves both `@astrojs/sitemap` (`sitemap-index.xml` + `sitemap-0.xml` with `xhtml:link` alternates) and a flat `sitemap.xml` referenced in `robots.txt` for reliable Google Search Console indexing.
- **Structured Data:** Semantic `WebApplication`, `HowTo`, `FAQPage`, and `BreadcrumbList` JSON-LD matching visible content and breadcrumbs with zero synthetic `AggregateRating` markup.

---

## Local Development

### Prerequisites

- Node.js `>= 22.23.4` (tested with Node `v24.19.0`)
- npm `>= 9.6.5`

### Commands

```bash
# Install dependencies
npm install

# Start local Astro dev server
npm run dev

# Run TypeScript/Astro checks and build production static output to ./dist
npm run build

# Preview production build locally
npm run preview
```

---

## Deployment

Pushing to `main` automatically triggers [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml), which runs `npm ci`, executes `npm run build` (`astro check && astro build`), and deploys `./dist` to GitHub Pages via `actions/deploy-pages@v4`.

---

## License

This project is open-source under the [MIT License](./LICENSE).

---

## Support the Developer

If this free, private, ad-free tool saves you time, you can support ongoing development:

- **Buy Me a Coffee:** [https://kisharadilshan.gumroad.com/coffee](https://kisharadilshan.gumroad.com/coffee)
