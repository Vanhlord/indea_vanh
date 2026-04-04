# Project Review Report - Hidden Errors & Potential Issues

## Executive Summary
This report documents all potential hidden errors and issues found in the MC Note Server project after a comprehensive code review.

---

## 🔴 CRITICAL SECURITY ISSUES

### 1. Hardcoded Credentials
**Files:** `discord.js`, `bot3.js`, `src/config/index.js`

- **discord.js line 10:**
  
```
javascript
  const DISCORD_TOKEN = 'MTM4OTg2Mjk5NzE3Mzk5MzQ3Mw.GvDE3K...';
  
```
  Token is hardcoded in source code!

- **discord.js line 7:**
  
```
javascript
  const SERVER_ID = 'e417ea4b';
  
```
  Server ID is hardcoded.

- **bot3.js:**
  
```
javascript
  username: 'vanhleg188@gmail.com',
  auth: 'microsoft'
  
```
  Credentials hardcoded in source code.

### 2. Missing Environment Variable Validation
- `src/config/index.js`: `validateConfig()` exits with `process.exit(1)` but is called on every import
- `pikamcService.js`: No check if `API_KEY` is undefined before making requests

---

## 🟠 SERVER.JS ISSUES

### 1. Socket.IO Cluster Issue
**Problem:** Socket.IO instance created in master process but cluster workers can't access it properly.

```
javascript
// server.js - io is created in master
const io = new SocketServer(server);

// Workers try to use it but it's not shared
cluster.on('message', async (worker, message) => {
    io.emit('mc-chat', { ... }); // Won't work in workers!
});
```

### 2. Missing Error Handling in Cluster
```
javascript
cluster.on('message', async (worker, message) => {
    // No try-catch!
    await sendConsoleCommand(command);
    await addChatMessage(...);
});
```

### 3. Referenced Files Don't Exist
- `streak.html`
- `embed-admin.html`  
- `admin.html`
- `youtube.html`
- `tiktok.html`
- `soundcloud.html`

### 4. No 404 Handler for Static Files
Missing `notFoundHandler` middleware.

---

## 🟡 BOT ISSUES

### bot/bot2.js
1. **Duplicate token check:**
   - Checked in `startBot2()` AND `sendEmbed()`
   - Code duplication

2. **Race condition in waitForBotReady:**
   - `client2` might be undefined when checking

### bot3.js
1. **No reconnection logic** when bot disconnects
2. **No socket error handling:**
   
```
javascript
   const socket = io('http://localhost:3000');
   // No .on('error') handler!
   
```
3. **Hardcoded version:** `'1.26'` hardcoded
4. **Hardcoded server:** `host: 'vanhmcpe.my-land.fun'`

### bot/binhchon.js
1. **Race condition:** Multiple concurrent votes can cause data loss
2. **Missing input validation:** No check for null/undefined `choice`, `userId`, `userName`
3. **No file existence check** before JSON.parse

---

## 🟡 CONFIG ISSUES

### src/config/index.js
1. **Unused import:**
   
```
javascript
   import { dirname } from 'path'; // Never used!
   
```

2. **Dangerous config exit:**
   
```
javascript
   validateConfig(); // Called on every import - can crash server!
   
```

---

## 🟠 MIDDLEWARE ISSUES

### src/middleware/setup.js
1. **CSP Policy Too Loose:**
   
```
javascript
   scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "*"],
   styleSrc: ["'self'", "'unsafe-inline'", "*"],
   
```
   Should NOT allow `'unsafe-inline'` and `"*"` in production!

2. **Session sameSite:'strict'** can cause issues with some cross-site requests

---

## 🟠 VALIDATION ISSUES

### src/middleware/validation.js
1. **Broken sanitization:**
   
```
javascript
   .replace(/[<>]/g, '') // Removes < and > completely - breaks valid content!
   
```
   Should encode instead of remove.

2. **No recursive sanitization:**
   
```
javascript
   // Only sanitizes top-level strings, not nested objects
   if (typeof req.body[key] === 'string')
   
```

---

## 🟠 SERVICE ISSUES

### src/services/chatService.js
1. **Race condition:** Global `chatHistory` variable modified by multiple async operations
2. **Silent error swallowing:**
   
```
javascript
   } catch (error) {
       console.error('❌ Lỗi lưu lịch sử chat:', error);
       // Error not propagated!
   }
   
```

### src/services/pikamcService.js
1. **Mixed HTTP clients:** Uses both `axios` and `fetch` in same file
2. **No API_KEY validation** before making requests
3. **Cache race condition:**
   
```
javascript
   if (pikamcCache.inFlight) {
       // Multiple concurrent requests can cause issues
   }
   
```

### src/services/playerService.js
1. **Race condition:** Concurrent `logPlayer` calls can lose data
2. **Wrong path:** `path.join(__dirname, '../../json/player.json')` might not resolve correctly
3. **Missing input validation:** No null check for `playerData`

---

## 🟠 ROUTE ISSUES

### src/routes/index.js
- Looks OK, simple router setup

### src/routes/chatRoutes.js
1. **Missing rate limiting** on `/clear` endpoint
2. **No authorization** - anyone can clear chat history

---

## 🟠 HTML/FRONTEND ISSUES

### html/index.html
1. **Inline JavaScript** - hard to maintain and security risk
2. **No input validation** on client side before sending to API
3. **localStorage without try-catch:**
   
```
javascript
   const userData = JSON.parse(localStorage.getItem('user'));
   // Can throw if corrupted!
   
```
4. **Notification modal** can be closed by clicking outside - potential security issue
5. **No CSRF protection** on forms

---

## 🟡 DEPENDENCY ISSUES

### package.json
1. **Redundant dependency:**
   
```
json
   "cluster": "^0.7.7"
   
```
   Node.js has built-in cluster module!

2. **Outdated dependencies** - some packages may have security vulnerabilities

---

## 🟡 CODE DUPLICATION

1. **sendConsoleCommand function** duplicated in:
   - `discord.js`
   - `src/services/pikamcService.js`

2. **Server config values** duplicated:
   - `PANEL_URL`, `API_KEY`, `SERVER_ID` defined in multiple places

---

## 🟡 POTENTIAL RUNTIME ERRORS

1. **File path issues:**
   - Windows vs Unix path separators
   - Relative paths may not resolve correctly

2. **Async/Await errors:**
   - Many places don't have proper try-catch for async operations
   - Unhandled promise rejections can crash workers

3. **Memory issues:**
   - Large file downloads in `tiktok.js` can cause memory issues
   - No file size limits checked before download

4. **JSON parsing errors:**
   - `JSON.parse()` without try-catch in multiple places

---

## 📋 RECOMMENDATIONS

### Priority 1 (Critical)
1. Move all credentials to environment variables
2. Add proper input validation everywhere
3. Fix Socket.IO clustering issue
4. Add error handling to all async operations

### Priority 2 (High)
1. Tighten CSP policy
2. Fix sanitization function
3. Add rate limiting to sensitive endpoints
4. Add authorization checks

### Priority 3 (Medium)
1. Remove duplicate code
2. Fix path resolution for cross-platform
3. Add proper logging
4. Consider using a database instead of JSON files

---

*Report generated on review date*
*Total files reviewed: 18+*
*Total issues found: 40+*
