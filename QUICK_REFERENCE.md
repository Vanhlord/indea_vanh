# 🎯 EJS Implementation - Quick Reference

## Files Created/Modified

### New Files Created:
```
views/
├── leaderboard.ejs          ✅ Server-side rendered leaderboard
├── status-server.ejs        ✅ Server-side rendered status page
```

### New Dirs:
```
views/                        ✅ EJS templates directory
```

### Modified Files:
```
server.js                     ✅ Added EJS configuration
package.json                  ✅ Added ejs dependency
```

### Route File Added:
```
src/routes/ssrRoutes.js       ✅ Server-side rendering routes
```

### Documentation:
```
EJS_IMPLEMENTATION.md         ✅ Complete implementation guide
SECURITY_WARNING.md           ✅ Credential security notice
.env.example                  ✅ Environment template
```

---

## New Routes Available

| Route | Type | Data Source | Security |
|-------|------|-------------|----------|
| `/leaderboard-ssr` | GET | `json/tool-usage.json` | ✅ Safe |
| `/status-ssr` | GET | Server APIs | ✅ Safe |

---

## How to Use

### 1. Start Server
```bash
npm start
# or
npm run dev
```

### 2. Visit SSR Routes
```
http://localhost:3000/leaderboard-ssr
http://localhost:3000/status-ssr
```

### 3. Open DevTools (F12)
- **Sources tab**: See only HTML, no API calls visible
- **Network tab**: See only 1 request (HTML), no XHR calls
- **Console**: No fetch/axios calls
- ✅ All secrets safe on server!

---

## Create Your Own SSR Page

### Step 1: Create Template (`views/my-page.ejs`)
```html
<!DOCTYPE html>
<html>
<body>
    <h1><%= title %></h1>
    <p><%= description %></p>
    
    <% if (items && items.length > 0) { %>
        <ul>
        <% items.forEach(item => { %>
            <li><%= item.name %></li>
        <% }); %>
        </ul>
    <% } %>
</body>
</html>
```

### Step 2: Add Route (`src/routes/ssrRoutes.js`)
```javascript
router.get('/my-page', async (req, res) => {
    try {
        const data = await fetchDataFromServer();
        res.render('my-page', data);
    } catch (error) {
        res.status(500).render('error', { error: error.message });
    }
});
```

### Step 3: Visit Page
```
http://localhost:3000/my-page
```

---

## EJS Syntax Quick Ref

| Syntax | Purpose | Example |
|--------|---------|---------|
| `<%= %>` | Output variable | `<%= userName %>` |
| `<%- %>` | Output HTML | `<%- content %>` |
| `<% %>` | Run code | `<% if (x) { %>` |
| `<%# %>` | Comment | `<%# This is hidden %>` |

---

## Security Rules

✅ **DO:**
- Keep API keys in `.env` on server
- Use `<%= %>` for user content
- Fetch data server-side before rendering
- Use `process.env.SECRET` in routes

❌ **DON'T:**
- Put API keys in client-side JS
- Use `<%- %>` for user input (XSS risk)
- Fetch data inside EJS templates
- Commit `.env` to git

---

## Performance Tips

1. **Cache views in production**
   - Already configured in `server.js`
   - Automatically done with `NODE_ENV=production`

2. **Pre-fetch all data**
   ```javascript
   // ✅ Fetch before rendering
   const data = await fetchData();
   res.render('page', { data });
   
   // ❌ Don't fetch in template
   ```

3. **Reuse templates with includes**
   ```ejs
   <%- include('header', { title }) %>
   <main>Content</main>
   <%- include('footer') %>
   ```

---

## Troubleshooting

| Error | Solution |
|-------|----------|
| `Failed to lookup view` | Check file is in `views/` with `.ejs` extension |
| `Cannot read property` | Pass all variables to `res.render()` |
| `HTML not rendering` | Use `<%- %>` only for trusted HTML, not `<%= %>` |
| `Undefined in template` | Add variable to render object: `res.render('page', { var })` |

---

## Development Commands

```bash
# Start server in dev mode (with auto-reload)
npm run dev

# Check code style
npm run lint

# Fix code style
npm run lint:fix

# Run tests
npm run test:smoke

# Install dependencies
npm install
```

---

## Testing Security

### Before (Unsafe - Client-Side):
```bash
# DevTools Network tab shows:
GET /html/leaderboard.html
GET /api/tool-usage           # ← API key visible here!
GET /api/user-info
GET /api/leaderboard
```

### After (Secure - Server-Side):
```bash
# DevTools Network tab shows:
GET /leaderboard-ssr          # ← Only this request!
# All APIs already called server-side
```

---

## Next Steps

1. **Rotate credentials** (CRITICAL!)
   - New Discord token
   - New API keys
   - Update `.env`

2. **Migrate other pages** to EJS
   - Homepage
   - Status pages
   - Admin pages

3. **Remove old static files**
   - Once all pages migrated
   - Delete `/html` folder
   - Delete `/p` folder

4. **Monitor performance**
   - Check server load
   - Monitor response times
   - Adjust cache settings if needed

---

## Links

- Full Guide: [EJS_IMPLEMENTATION.md](./EJS_IMPLEMENTATION.md)
- Security: [SECURITY_WARNING.md](./SECURITY_WARNING.md)
- Docs: [EJS Official](https://ejs.co/)

---

**Last Updated:** Feb 25, 2026  
**Status:** ✅ Active Implementation  
**Support:** Check docs or create issue
