# Re-rendering the concept images
- `image_sources/hero.html`, `options.html`, `arch.html` → screenshots at 1530×1000 (device scale 1.5) with Playwright:
  `python -c "from playwright.sync_api import sync_playwright as s; ..."` or just open in Chrome and take a full-size screenshot.
- `3_test.png` is a matplotlib chart of simulator output (synthetic baseline). Regenerate from the real simulator once Phase 3 is done.
- Replace all four with REAL screenshots of the running prototype before the exhibit, and update captions.
