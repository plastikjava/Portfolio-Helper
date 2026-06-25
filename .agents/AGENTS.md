# Project Rules: Kita-Portfolio-Studio

## PWA Version Management
- **Automatic Version Triggers**: Whenever you modify any frontend code files (like `ipad.html`, `ipad.css`, `ipad.js`, `index.html`, `style.css`, or `app.js`), you MUST increment the version number in the `CACHE_NAME` constant in `sw.js` (e.g., from `v1` to `v2`, `v3`, etc.) before committing and pushing the changes. This ensures that client iPads will detect the changes and download the updated files.
