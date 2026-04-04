# 🚨 SECURITY WARNING - Exposed Credentials

## Critical Issue Found

The `.env` file in the repository contains **REAL, ACTIVE credentials**:

```env
DISCORD_BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE
PIKAMC_API_KEY=YOUR_PIKAMC_API_KEY_HERE
SECONDARY_PTERODACTYL_API_KEY=YOUR_SECONDARY_PTERODACTYL_API_KEY_HERE
```

### ⚠️ IMMEDIATE ACTIONS REQUIRED

1. **Regenerate ALL tokens immediately:**
   - ✋ Discord Bot Token
   - ✋ PikaMC API Key  
   - ✋ Pterodactyl API Keys
   - ✋ Session Secret

2. **Add `.env` to `.gitignore`** (if not already):
   ```
   .env
   .env.local
   .env.*.local
   ```

3. **Use `.env.example` template:**
   ```bash
   # Copy template for developers
   cp .env.example .env
   # Edit .env with your own credentials
   ```

4. **Rotate credentials in affected services:**
   - Discord: Create new bot token
   - PikaMC Panel: Regenerate API key
   - Pterodactyl: Rotate API keys
   - Sessions: Change SESSION_SECRET

---

## How EJS Helps

Now that EJS is implemented for **Server-Side Rendering**:

✅ API calls happen on server, not client  
✅ Secrets stored in `.env`, never sent to browser  
✅ HTML renders complete before sending to client  
✅ DevTools Network tab shows **NO API keys**

---

## Migration Timeline

### What's Done:
- ✅ EJS installed and configured
- ✅ `/views` directory created
- ✅ Demo templates created (`leaderboard.ejs`, `status-server.ejs`)
- ✅ SSR routes working (`/leaderboard-ssr`, `/status-ssr`)
- ✅ Documentation complete

### What Still Needs Doing:

1. **Credential Rotation** (URGENT)
   - Regenerate all tokens
   - Update `.env` with new values
   - Commit `.env.example` (not `.env`)

2. **Migrate Main Pages**
   - Homepage (`/`)
   - Other key pages
   - Replace static HTML with SSR

3. **Remove Static Files** (After final migration)
   - Delete `/html` folder  
   - Delete `/p` folder
   - Keep only necessary static assets

4. **Add `.env` to gitignore**
   ```bash
   echo ".env
   .env.local
   .env.*.local" >> .gitignore
   ```

---

## Testing Security Improvement

### Before EJS (Unsafe):
```bash
# Open DevTools > Network tab
# Visit http://localhost:3000/html/leaderboard.html
# You'll see: Multiple XHR requests with API keys visible!
```

### After EJS (Secure):
```bash
# Open DevTools > Network tab
# Visit http://localhost:3000/leaderboard-ssr
# You'll see: Only 1 HTML request, NO API calls!
```

---

## Next Steps

1. **Stop accepting this risk**
   - Rotate credentials NOW
   - Never commit `.env` to git

2. **Keep migrating pages to EJS**
   - Use templates in `/views`
   - Use patterns from `src/routes/ssrRoutes.js`
   - Follow `EJS_IMPLEMENTATION.md` guide

3. **Gradually remove static pages**
   - Test each SSR route
   - Redirect old static routes to SSR
   - Monitor for issues

---

## Questions?

See: `EJS_IMPLEMENTATION.md` for full implementation guide

**Status:** ⚠️ CRITICAL - Credentials need rotation NOW

Last updated: February 25, 2026
