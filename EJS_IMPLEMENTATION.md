# 🔒 Server-Side Rendering with EJS - Implementation Guide

## 📋 Overview

This project now uses **EJS (Embedded JavaScript)** for server-side rendering (SSR) to improve security and performance. All sensitive logic and API calls are executed on the server, not exposed to the client.

## 🎯 Why Server-Side Rendering?

### ❌ Before (Client-Side Rendering - Unsafe)
```javascript
// Your API key is visible in Network tab!
fetch('/api/data?key=SECRET_API_KEY')
  .then(res => res.json())
  .then(data => {
    document.getElementById('leaderboard').innerHTML = renderTable(data);
  });
```

### ✅ After (Server-Side Rendering - Secure)
```javascript
// Server fetches data with secret keys (client never sees them!)
app.get('/leaderboard', async (req, res) => {
  const data = await fetchWithSecretKey(SECRET_API_KEY);
  res.render('leaderboard', { data }); // HTML sent to client
});
```

**Benefits:**
- 🛡️ **API keys stay on server** - Never exposed to client
- ⚡ **Faster first load** - HTML comes pre-rendered
- 📊 **Better SEO** - Engines see complete content
- 🔐 **Logic hidden** - Business logic stays server-side

---

## 🚀 Quick Start

### 1. Access SSR Routes

**Existing SSR routes:**
- `/leaderboard-ssr` - Tool usage leaderboard
- `/status-ssr` - Server status dashboard

### 2. View Source Code

Open browser DevTools (F12) > **Sources** tab:
- You'll see the final **HTML** only
- No API calls, no fetch requests
- No exposed credentials!

Compare with `/html/leaderboard.html`:
- See multiple API calls in Network tab
- Keys might be exposed
- Logic lives on client-side

---

## 📝 How to Build Your Own SSR Page

### Step 1: Create EJS Template

Create file: `views/my-page.ejs`

```html
<!DOCTYPE html>
<html>
<head>
    <title>My Page</title>
</head>
<body>
    <h1>Users: <%= userCount %></h1>
    
    <% if (users && users.length > 0) { %>
        <ul>
        <% users.forEach(user => { %>
            <li><%= user.name %> - <%= user.email %></li>
        <% }); %>
        </ul>
    <% } else { %>
        <p>No users found</p>
    <% } %>
</body>
</html>
```

### Step 2: Add Route in `src/routes/ssrRoutes.js`

```javascript
router.get('/my-page', async (req, res) => {
    try {
        // Fetch data server-side (secrets stay here!)
        const users = await database.query('SELECT * FROM users');
        const userCount = users.length;

        // Render template with data
        res.render('my-page', {
            users,
            userCount,
            currentUser: req.session?.user // Session data is safe here
        });
    } catch (error) {
        res.status(500).render('error', { error: error.message });
    }
});
```

### Step 3: Access Your Page

Visit: `http://localhost:3000/my-page`

---

## 📚 EJS Syntax Cheatsheet

### Variables
```ejs
<%= userName %>              <!-- Output variable -->
<%- htmlContent %>           <!-- Output HTML (unsafe - use with care) -->
<%= userName || 'Guest' %>   <!-- Default value -->
<%= JSON.stringify(obj) %>   <!-- Complex objects -->
```

### Conditionals
```ejs
<% if (isAdmin) { %>
    <div>Admin panel</div>
<% } else { %>
    <div>User panel</div>
<% } %>
```

### Loops
```ejs
<% users.forEach(user => { %>
    <li><%= user.name %> (<%= user.id %>)</li>
<% }); %>

<!-- Or traditional for loop -->
<% for (let i = 0; i < items.length; i++) { %>
    <p><%= items[i] %></p>
<% } %>
```

### Includes (Reusable Components)
```ejs
<%- include('header', { title: 'My Page' }) %>
<main>Content here</main>
<%- include('footer') %>
```

---

## 🔄 Migration Roadmap

### Phase 1: Core Pages (DONE ✅)
- ✅ `/leaderboard-ssr` - Demo
- ✅ `/status-ssr` - Demo
- 📝 Create EJS templates in `/views/`

### Phase 2: High-Value Pages (TODO)
1. **Homepage** (`html/index.html`)
   - Render sidebar data server-side
   - Fetch featured content
   - Pre-render user status

2. **Status Server** (`html/status-server.html`)
   - Already have template (`views/status-server.ejs`)
   - Need to complete route implementation

3. **Leaderboard** (`html/leaderboard.html`)
   - Already have template (`views/leaderboard.ejs`)
   - Enhance with real data source

### Phase 3: Dynamic Pages (TODO)
- Chat history page
- Cloud storage listing
- Download history
- User settings

### Phase 4: Remove Static Files (TODO)
Once all pages are SSR:
- Delete `html/` folder
- Delete `p/` folder
- Keep `public/` for static assets (CSS, JS, images)

---

## 🔑 Common Use Cases

### Case 1: Rendering with Session Data

```ejs
<!-- Show user info from server session -->
<div class="profile">
    <h1><%= currentUser.username %></h1>
    <p>ID: <%= currentUser.id %></p>
    <p>Role: <%= currentUser.role %></p>
</div>
```

**Route:**
```javascript
app.get('/profile', (req, res) => {
    res.render('profile', { 
        currentUser: req.session.user 
    });
});
```

### Case 2: Rendering Admin-Only Content

```ejs
<!-- Hide from HTML source - only rendered if user is admin -->
<% if (isAdmin) { %>
    <div class="admin-panel">
        <p>API Key: <%= apiKey %></p>
    </div>
<% } %>
```

**Route:**
```javascript
app.get('/admin/dashboard', requireAdmin, async (req, res) => {
    const apiKey = process.env.ADMIN_API_KEY; // Secret!
    res.render('admin-dashboard', { 
        isAdmin: true,
        apiKey 
    });
});
```

### Case 3: Rendering Database Data

```ejs
<!-- Render data from database -->
<table>
    <tr><th>Username</th><th>Downloads</th></tr>
    <% leaderboard.forEach(entry => { %>
        <tr>
            <td><%= entry.username %></td>
            <td><%= entry.downloads %></td>
        </tr>
    <% }); %>
</table>
```

**Route:**
```javascript
app.get('/leaderboard-ssr', async (req, res) => {
    const toolUsage = await readJsonSafe(path.join(JSON_DIR, 'tool-usage.json'), {});
    const leaderboard = Object.entries(toolUsage)
        .map(([username, data]) => ({
            username,
            downloads: data.total || 0
        }))
        .sort((a, b) => b.downloads - a.downloads);
    
    res.render('leaderboard', { leaderboard });
});
```

---

## ⚙️ Configuration

### View Engine Setup (Already Done)

In `server.js`:
```javascript
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

if (process.env.NODE_ENV === 'production') {
    app.set('view cache', true); // Cache views for performance
}
```

### Best Practices

1. **Always validate/sanitize** - Even server-side rendering needs safe data
   ```ejs
   <%= userInput.slice(0, 100) %>  ✅ Safe - truncated
   <%- userInput %>                 ❌ Unsafe - XSS risk
   ```

2. **Use `<%= %>` for user content**, `<%- %>` for trusted HTML only

3. **Keep logic minimal** - Use helper functions
   ```ejs
   <%= formatDate(date) %>    ✅ Clean
   <% new Date(...) %>        ❌ Logic in template
   ```

4. **Pre-fetch all data** - Don't use async in templates
   ```javascript
   // ✅ Do this
   const data = await fetchData();
   res.render('page', { data });
   
   // ❌ Don't do this (causes template errors)
   res.render('page', { data: fetchData() });
   ```

---

## 🧪 Testing

### Local Testing
```bash
# View source in SSR mode
curl http://localhost:3000/leaderboard-ssr

# Compare with client-side rendering
curl http://localhost:3000/html/leaderboard.html

# Check what's in Network tab (F12)
# SSR: Only HTML, no XHR calls
# Client: Multiple XHR API calls
```

### Browser DevTools
1. Open F12 > Network tab
2. Visit `/leaderboard-ssr` - See 1 HTML request ✅
3. Visit `/html/leaderboard.html` - See many XHR requests ❌

---

## 📊 Security Comparison

| Feature | Static HTML | Client Render | Server Render (EJS) |
|---------|-----------|---------------|-------------------|
| API Keys Exposed | ❌ No | ⚠️ Maybe | ✅ No |
| Logic Visible | ✅ Yes | ⚠️ Source Maps | ✅ No |
| First Paint | ⚠️ Slow | ⚠️ Slow | ✅ Fast |
| SEO | ✅ Good | ❌ Bad | ✅ Good |
| Complexity | ⚠️ High | ✅ Low | ⚠️ Medium |

---

## 🐛 Troubleshooting

### EJS Template Not Found
```
Error: Failed to lookup view "mytemplate"
```
**Fix:** Make sure file is in `views/` folder with `.ejs` extension

### Variables Undefined
```
TypeError: Cannot read property 'name' of undefined
```
**Fix:** Ensure all variables are passed to `res.render()`:
```javascript
res.render('template', {
    variable1: value1,
    variable2: value2  // ← Make sure this is included
});
```

### HTML Not Rendering
```ejs
<%- htmlContent %> <!-- Check for typo! -->
```
Can be confused with `<%= %>`. Use `<%- %>` only for trusted HTML.

---

## 📞 Need Help?

1. **Check Examples**: `/views/leaderboard.ejs`, `/views/status-server.ejs`
2. **EJS Docs**: https://ejs.co/
3. **Review**: `src/routes/ssrRoutes.js` for route patterns

---

**Last Updated:** February 2026  
**EJS Version:** ^3.x  
**Status:** Actively Maintained ✅
