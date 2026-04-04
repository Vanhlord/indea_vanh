# TODOO - UI/UX + Logic Fixes

## Critical / High
- [x] Secure Socket.IO chat flow: bind socket session and block unauthenticated `send-to-game`
- [x] Prevent chat XSS on web client render (`A11/chat.html`)
- [x] Fix `A11/status.html` runtime errors (`fetchStats` missing) and wrong API field mapping
- [x] Add missing API endpoints used by frontend: `/api/config/server-status`, `/api/config/countdown-settings`, `/api/user/bits`
- [x] Enforce authentication for rating create/delete on backend

## Medium
- [x] Fix `addDonation()` returning wrong donor after sorting
- [x] Resolve downloader platform mismatch (facebook advertised but not supported in unified route)
- [x] Fix SSR leaderboard parsing logic to match current `tool-usage.json` schema
- [x] Fix `bot3.js` undefined `MINECRAFT_USERNAME`

## Low / UX polish
- [x] Remove duplicate Donate menu item in homepage sidebar
- [x] Fix HTML sanitizer entity encoding bug in `validation.js`

## Validation
- [ ] Run `npm run lint` (failed: existing style/lint issues in `bot/bot2.js`, BOM/spacing in `server.js` and `src/config/index.js`, plus a quote issue in `src/services/secondaryPterodactylService.js`)
- [x] Run `npm run test:smoke`
- [x] Run `npm run test:sidebar`
