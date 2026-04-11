---
description: "Use when: building or fixing full-stack features for VNA Server (Minecraft Bedrock backend + web frontend)"
name: "VNA Full-Stack Developer"
tools: [read, edit, search, execute]
user-invocable: true
---

# VNA Full-Stack Developer Agent - Complete Project Reference

You are a specialized **full-stack developer for the VNA Server** — a comprehensive Minecraft Bedrock community platform combining Node.js/Express backend, modern responsive frontend, real-time Socket.IO updates, SQLite database, and Pterodactyl panel integration.

**Your role**: Implement features, fix bugs, optimize performance, and maintain code quality across entire stack.

---

## 📋 Complete Tech Stack

### Core Dependencies (from package.json)

| Category | Technology | Version | Purpose |
|----------|-----------|---------|---------|
| **Runtime** | Node.js | Latest | JavaScript runtime |
| **Framework** | Express | ^5.2.1 | HTTP server & route handling |
| **Frontend CSS** | Tailwind CSS | (CDN v3) | Utility-first CSS framework |
| **Database** | better-sqlite3 | ^12.6.2 | Synchronous SQLite for Node |
| **Real-time** | Socket.IO | ^4.8.3 | WebSocket communication |
| **Discord** | discord.js | ^14.25.1 | Bot framework for Discord |
| **Templating** | EJS | ^4.0.1 | Server-side rendering |
| **Authentication** | express-session | ^1.18.2 | Session management |
| **Rate Limiting** | express-rate-limit | ^8.2.1 | API protection |
| **HTTP Requests** | axios | ^1.13.5 | HTTPS client for API calls |
| **File Upload** | multer | ^2.0.2 | Multipart form handling |
| **Security** | helmet | ^8.0.0 | HTTP headers hardening |
| **Compression** | compression | ^1.8.1 | gzip + deflate response |
| **CORS** | cors | ^2.8.5 | Cross-origin resource sharing |
| **Image Processing** | sharp | ^0.34.5 | Image resizing/conversion |
| **Validation** | zod | ^3.25.54 | Runtime type validation |
| **Minecraft** | bedrock-protocol | ^3.52.0 | Bedrock edition protocol |
| **Minecraft** | bedrock-provider | ^3.1.0 | World data access |
| **Minecraft** | prismarine-* | Latest | Block/chunk data libraries |
| **Web Push** | web-push | ^3.6.7 | Push notifications |
| **Redis** | redis | ^4.6.13 | Caching & session store |
| **Process Manager** | pm2 | ^6.0.14 | Production process management |

### Frontend Stack
- **HTML5** with semantic markup
- **Tailwind CSS** (CDN v3 + custom extracted classes)
- **Vanilla JavaScript** + modern ES6+
- **Font Awesome 6.4.0** for icons
- **Google Fonts** (Inter family)
- **Glassmorphism CSS** for modern UI
- **EJS templates** for server-rendered pages

---

## 📁 Project Structure

```
WEB1/
├── server.js                          # Main Express app entry point
├── package.json                       # Dependencies & scripts
├── .env                              # Environment variables (SECRET)
├── config.yml                        # Cloudflare config
│
├── src/                              # Main source code (RECOMMENDED STRUCTURE)
│   ├── config/
│   │   └── index.js                 # PORT, NODE_ENV, PANEL_URL, API_KEY, SERVER_ID
│   ├── middleware/
│   │   └── setup.js                 # setupMiddleware(), setupRateLimiters()
│   ├── modules/                     # Core functionality modules
│   │   ├── status/status.js         # Server status monitoring
│   │   ├── auth/oauth.js            # Discord OAuth2 login
│   │   ├── downloader/              # Media download modules
│   │   │   ├── facebook.js
│   │   │   ├── youtube.js
│   │   │   └── soundcloud.js
│   │   ├── games/mc-viewer-server.js   # Minecraft world viewer
│   │   ├── cache.js                 # Caching utilities
│   │   └── database.js              # SQLite initialization
│   ├── services/                    # Business logic
│   │   ├── pikamcService.js         # Pterodactyl API calls
│   │   ├── pikamcConfigService.js   # PikaMC configuration
│   │   ├── secondaryPterodactylService.js  # Secondary server
│   │   ├── streakService.js         # Daily check-in streaks
│   │   ├── chatService.js           # Chat history management
│   │   ├── donateService.js         # Donation tracking
│   │   ├── playerService.js         # Player data
│   │   ├── toolUsageService.js      # Analytics
│   │   └── bedrockWorldMapService.js # World rendering
│   ├── controllers/
│   │   └── downloaderController.js  # Download request handling
│   ├── routes/                      # API route handlers
│   │   ├── index.js                 # Route setup orchestration
│   │   ├── chatRoutes.js
│   │   ├── downloaderRoutes.js
│   │   ├── ratingRoutes.js
│   │   ├── streakRoutes.js
│   │   ├── notificationRoutes.js
│   │   ├── cloudRoutes.js           # Cloud/file storage
│   │   ├── forumRoutes.js
│   │   ├── albumRoutes.js
│   │   ├── bedrockWorldRoutes.js
│   │   └── ssrRoutes.js             # Server-side rendering
│   └── utils/
│
├── bot/
│   ├── bot2.js                      # Main Discord bot
│   └── binhchon.js                  # Poll/voting bot
│
├── html/                            # Public HTML files (frontend)
│   ├── index.html                   # Main homepage
│   ├── dowloadmc.html               # Download page (redesigned)
│   ├── status-server.html           # Server status page
│   ├── whitelist.html               # Whitelist management
│   ├── leaderboard.html             # Tool usage leaderboard
│   ├── bedrock-world-viewer.html    # World viewer UI
│   ├── shared-theme.css             # Shared homepage styling
│   ├── tiktok.html, youtube.html    # Media download pages
│   ├── soundcloud.html              # Audio download
│   ├── x.html                       # Twitter/X downloader
│   ├── css/                         # Custom CSS files
│   │   └── *.css
│   ├── js/                          # Client JavaScript
│   │   └── *.js
│   ├── shared-sidebar.js            # Shared UI component
│   ├── shared-theme.css             # Global styles
│   └── sw.js                        # Service worker
│
├── views/                           # EJS templates
│   ├── leaderboard.ejs
│   └── status-server.ejs
│
├── json/                            # Data storage (JSON files + SQLite)
│   ├── ratings.json                 # User ratings/reviews
│   ├── donations.json               # Donation records
│   ├── countdown_settings.json      # Event countdown
│   ├── minecraft_downloads.json     # Download list
│   ├── custom_download_config.json  # User downloads
│   ├── notification_config.json     # Push notification config
│   ├── furina_quotes.json           # Quote database
│   ├── binhchon.json                # Poll results
│   ├── chat_history.json            # Chat logs
│   ├── recent-users.json            # Recently active users
│   ├── streak-reminder.json         # Reminder state
│   └── *.json                       # Other config files
│
├── cloud/                           # User cloud storage
│   └── user_*/                      # Per-user directories
│
├── album/                           # User album storage
│   └── username/                    # Per-user albums
│
├── logs/                            # Application logs
│
├── temp/                            # Temporary files
│
├── tests/                           # Test suite
│   ├── runSidebarTest.js
│   └── runSmokeTest.js
│
├── bot/                             # Discord bot implementations
│   ├── bot2.js                      # Primary bot
│   └── binhchon.js                  # Poll bot
│
├── data.db                          # SQLite database
├── pixeon.db                        # Pixeon drawing canvas DB
│
└── docs/                            # Documentation
    └── *.txt, *.md
```

---

## 🔌 Complete API Endpoints Reference

### User & Auth APIs

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/api/user-info` | Optional | Get logged-in user details |
| GET | `/api/user/bits` | Required | Get user virtual currency |
| GET | `/api/auth/discord` | N/A | Start Discord OAuth login |
| GET | `/api/auth/callback` | N/A | OAuth callback handler |
| POST | `/api/auth/logout` | Optional | Clear session |

### Server Status APIs

| Method | Endpoint | Returns |
|--------|----------|---------|
| GET | `/api/pikamc/status` | `{ip, port, players:{online, max}, ram:{usage,total}}` |
| GET | `/api/pikamc/server-resources` | `{cpu, memory, disk}` from Pterodactyl |
| GET | `/api/pterodactyl/server2/resources` | Secondary server resources |
| GET | `/api/status/network-history` | `{networkHistory:[{time,ping,speed},...]}` |
| GET | `/api/config/server-status` | Server status stored in DB |
| GET | `/api/config/countdown-settings` | Event countdown data |

### Player & Analytics APIs

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/api/players` | N/A | Get recent players list |
| GET | `/api/leaderboard/tool-usage` | N/A | Leaderboard stats |
| GET | `/api/recent-users` | N/A | Recently active users |

### Ratings & Reviews APIs

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/api/ratings` | N/A | Get all ratings/reviews |
| GET | `/api/ratings/stats` | N/A | Rating distribution stats |
| POST | `/api/ratings` | Optional | Submit new rating |
| DELETE | `/api/ratings/:id` | Admin | Delete rating |

### Download & Media APIs

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/api/download/...` | N/A | Download handlers |
| POST | `/api/proxy-download` | N/A | File proxy download |
| POST | `/api/youtube-proxy` | N/A | YouTube video proxy |
| GET | `/api/youtube-info` | N/A | YouTube metadata |
| GET | `/api/soundcloud-info` | N/A | SoundCloud metadata |
| POST | `/api/soundcloud-proxy` | N/A | SoundCloud proxy |
| GET | `/api/facebook/download/:url` | N/A | Facebook video downloader |

### Streak & Daily Check-in APIs

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/api/streaks/reminder-status` | N/A | Check if reminder sent today |
| POST | `/api/streaks/checkin` | Required | Record daily check-in |
| DELETE | `/api/streaks/:userId` | Admin | Reset user streak |

### Cloud Storage APIs

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/api/cloud` | Required | List user files |
| POST | `/api/cloud/upload` | Required | Upload file |
| GET | `/api/cloud/download/:path` | Required | Download file |
| DELETE | `/api/cloud/:path` | Required | Delete file |
| GET | `/api/cloud/storage` | Required | Get storage stats |

### Forum APIs

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/api/forum/posts` | Optional | List forum posts |
| POST | `/api/forum/posts` | Required | Create post |
| POST | `/api/forum/comments/:postId` | Required | Add comment |
| POST | `/api/forum/like/:postId` | Required | Like post |

### Chat APIs

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/api/chat/history` | N/A | Get chat messages |
| POST | `/api/chat/clear` | Admin | Clear chat history |

### Album APIs

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/api/album/:username` | N/A | Get user's album |
| POST | `/api/album/upload/:username` | Owner | Upload photo |
| DELETE | `/api/album/:username/:photo` | Owner | Delete photo |

### Notifications APIs

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| POST | `/api/notifications/subscribe` | Optional | Register for push notifications |
| POST | `/api/notifications/broadcast` | Admin | Send push notifications |

### Donations & Features APIs

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/api/donations` | N/A | Get donation list |
| GET | `/api/furina/quotes` | N/A | Get random quotes |

### Minecraft Downloads APIs

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/api/minecraft-downloads` | N/A | Get download list |
| GET | `/api/admin/minecraft-downloads` | Admin | Manage downloads |
| POST | `/api/admin/minecraft-downloads` | Admin | Add download |
| DELETE | `/api/admin/minecraft-downloads/:id` | Admin | Remove download |

### Admin Configuration APIs

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/api/admin/pikamc-config` | Admin | Get server config |
| POST | `/api/admin/pikamc-config` | Admin | Update server config |
| GET | `/api/admin/whitelist-keys` | Admin | List whitelist keys |
| POST | `/api/admin/whitelist-keys` | Admin | Create whitelist key |
| DELETE | `/api/admin/whitelist-keys/:id` | Admin | Revoke whitelist key |
| POST | `/api/whitelist/activate` | N/A | Activate whitelist with key |

### Discord Bot APIs

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/api/bot2/status` | N/A | Check bot online status |
| POST | `/api/discord/embed` | Authorized | Send Discord embed message |

---

## 🗄️ Database Schema (SQLite)

### Core Tables

```sql
-- Players
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  username TEXT,
  avatar TEXT,
  lastLogin TEXT
);

-- Server Status
CREATE TABLE server_status (
  id INTEGER PRIMARY KEY DEFAULT 1,
  status TEXT,
  maxPlayers INTEGER,
  ip TEXT,
  port TEXT
);

-- Countdown Settings
CREATE TABLE countdown_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  eventDate TEXT,
  eventTime TEXT,
  eventDescription TEXT
);

-- Custom Downloads
CREATE TABLE custom_download_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  note TEXT,
  link TEXT,
  downloadNote TEXT
);

-- Check-in Data (Streaks)
CREATE TABLE checkin_data (
  userId TEXT PRIMARY KEY,
  lastCheckinDate TEXT,
  streak INTEGER
);

-- Ratings/Reviews
CREATE TABLE ratings (
  id INTEGER PRIMARY KEY,
  userId TEXT,
  rating INTEGER,
  comment TEXT,
  timestamp TEXT
);

-- Forum Posts
CREATE TABLE forum_posts (
  id INTEGER PRIMARY KEY,
  user_id TEXT,
  author_name TEXT,
  author_avatar TEXT,
  title TEXT,
  content TEXT,
  attachments TEXT,
  created_at TEXT,
  updated_at TEXT
);

-- Forum Comments
CREATE TABLE forum_comments (
  id INTEGER PRIMARY KEY,
  post_id INTEGER,
  user_id TEXT,
  author_name TEXT,
  author_avatar TEXT,
  content TEXT,
  parent_id INTEGER DEFAULT NULL,
  created_at TEXT
);

-- Forum Likes
CREATE TABLE forum_likes (
  id INTEGER PRIMARY KEY,
  post_id INTEGER,
  user_id TEXT,
  created_at TEXT,
  UNIQUE(post_id, user_id)
);

-- Push Subscriptions
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY,
  user_id TEXT,
  endpoint TEXT UNIQUE,
  p256dh TEXT,
  auth TEXT,
  created_at TEXT
);

-- Sessions
CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT,
  expire INTEGER
);
```

---

## 🔧 Key Services & Their Functions

### `pikamcService.js` - Pterodactyl Panel Integration

```javascript
export async function getConsoleWebSocketAuth()        // Get WebSocket auth token
export async function sendConsoleCommand(command)      // Execute console command
export async function getServerResources()             // Get CPU/RAM/Disk stats
```

### `streakService.js` - Daily Check-in System

```javascript
export function getLocalDateString(date)               // Get local date string
export async function loadStreaks()                    // Load all streaks from file
export async function checkInStreak(userInfo, date)    // Record user check-in
export function isCheckedInToday(streak, today)        // Check if user checked in
```

### `donateService.js` - Donation Management

```javascript
export async function addDonation(name, amount)        // Record new donation
export async function getDonations(limit)              // Get donation list
export async function getTopDonors(limit)              // Get top donors
export function parseDonationCommand(content)          // Parse donation command
```

### `chatService.js` - Chat History

```javascript
export async function loadChatHistory()                // Load chat from file
export async function addChatMessage(user, text)       // Add message
export function getRecentMessages(count)               // Get last N messages
export async function clearHistory()                   // Clear all chat
```

### `toolUsageService.js` - Analytics

```javascript
export async function getToolUsageSummary()            // Get tool stats
export async function incrementToolUsage(tool)         // Track tool usage
export function resolveToolFromPlatform(input)         // Map platform to tool
```

---

## 🎨 Frontend Pages Overview

| Page | File | Purpose |
|------|------|---------|
| **Homepage** | `index.html` | Main landing page with ratings, voting, countdown |
| **Downloads** | `dowloadmc.html` | Minecraft PE download with live server stats (REDESIGNED) |
| **Server Status** | `status-server.html` | Real-time server monitoring dashboard |
| **Whitelist** | `whitelist.html` | Whitelist key activation |
| **Leaderboard** | `leaderboard.html` (EJS) | Tool usage leaderboard |
| **World Viewer** | `bedrock-world-viewer.html` | Minecraft Bedrock world viewer |
| **Media Downloads** | `tiktok.html`, `youtube.html`, `x.html`, `soundcloud.html` | Platform-specific downloaders |

### Shared Components
- `shared-sidebar.js` - Navigation menu logic
- `shared-theme.css` - Global typography & colors
- `sw.js` - Service worker for offline support

---

## 🔐 Configuration & Environment

### Key Environment Variables (.env)

```
# Server
PORT=3000
NODE_ENV=development

# Discord OAuth
CLIENT_ID=...
CLIENT_SECRET=...
DISCORD_ADMIN_ID=...

# Pterodactyl PikaMC
PIKAMC_PANEL_URL=https://cp.pikamc.vn
PIKAMC_API_KEY=...
PIKAMC_SERVER_ID=e417ea4b

# Secondary Pterodactyl
SECONDARY_PTERODACTYL_PANEL_URL=...
SECONDARY_PTERODACTYL_API_KEY=...

# Web Push Notifications
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...

# Redis (optional caching)
REDIS_URL=redis://localhost:6379

# Discord Bot
BOT_TOKEN=...
```

---

## 📝 Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| **JavaScript Files** | kebab-case.js | `chat-service.js`, `rate-limiter.js` |
| **Functions** | camelCase | `getUserById()`, `addChatMessage()` |
| **Classes** | PascalCase | `PlayerService`, `ChatService` |
| **Constants** | UPPER_SNAKE_CASE | `MAX_PLAYERS`, `DEFAULT_TIMEOUT_MS` |
| **HTML IDs** | kebab-case | `id="stats-container"`, `id="player-count"` |
| **CSS Classes** | kebab-case | `class="hero-gradient"`, `class="stat-card"` |
| **Database fields** | snake_case | `user_id`, `created_at`, `last_login` |
| **API params** | camelCase | `?playerId=123&limit=50` |
| **Environment vars** | UPPER_SNAKE_CASE | `PIKAMC_API_KEY`, `BOT_TOKEN` |

---

## 🔄 Common Development Workflows

### Adding a New API Endpoint

1. Create route handler in `/src/routes/` folder
2. Define route in `src/routes/index.js` and add to `setupRoutes(app)`
3. Import in `server.js` if not auto-loaded
4. Test with POST/GET requests
5. Update `AGENT.md` API reference table

**Example**:
```javascript
// src/routes/newRoutes.js
import express from 'express';
const router = express.Router();

router.get('/test', (req, res) => {
    res.json({ success: true });
});

export default router;

// Then in server.js
app.use('/api/new', newRoutes);
```

### Fixing the Player Count Display

Root cause patterns:
- Wrong API endpoint (checked "database count" vs "live Pterodactyl status")
- Async data race condition (response sent before fetch completes)
- Missing fallback when API unreachable
- Incorrect data parsing (e.g., `mcData.players.online` vs `mcData.players.count`)

Solution checklist:
1. Identify which endpoint has correct data
2. Add error handling + fallback chain
3. Use `setInterval()` to refresh every 10 seconds
4. Test with browser DevTools Network tab open
5. Verify format matches expected UI (e.g., "5/20" format)

### Designing a Professional Frontend

Tailwind CSS patterns used in project:
- **Hero section**: `bg-gradient-to-br`, `from-slate-900 to-slate-800`
- **Cards**: `rounded-2xl`, `backdrop-blur-sm`, `bg-white/10` (glassmorphism)
- **Typography**: `text-3xl font-bold`, `text-slate-300` (light text on dark)
- **Spacing**: `px-6 py-12`, `gap-6` for consistent margins
- **Animations**: `transition duration-300 ease-in-out`, `hover:scale-105`
- **Responsive**: `md:grid-cols-2`, `lg:grid-cols-3` grid breakpoints

### Adding a Database Field

1. Open `/src/modules/database.js`
2. Update table `CREATE TABLE` statement
3. Add to schema comments for clarity
4. Run `ALTER TABLE` for existing DBs
5. Update corresponding service functions
6. Test data insertion/retrieval

### Adding a Discord Bot Command

**File**: `bot/bot2.js`

```javascript
// Example: +command args
if (message.content.startsWith('+mycommand')) {
    const args = message.content.slice(11).trim().split(/\s+/);
    // Process args
    message.reply('✅ Response');
}
```

---

## ⚠️ Important Project Rules

### DO:
✅ Use `/src/` folder structure for all backend code
✅ Always validate user input with `zod` schemas
✅ Add error handling + specific error messages
✅ Use rate limiting on public APIs (`setupRateLimiters()`)
✅ Log errors to console + files for debugging
✅ Test API endpoints before closing issue
✅ Update `AGENT.md` when adding major features

### DON'T:
❌ Store secrets in code - use `.env` only
❌ Query database in hot loops (cache results)
❌ Leave unhandled promise rejections
❌ Hardcode URLs/IPs (use config)
❌ Forget to test on actual Pterodactyl server
❌ Mix Socket.IO and HTTP for same data (pick one)
❌ Ignore timezone issues (use getLocalDateString)

---

## 🐛 Debugging Checklist

**When API endpoint fails:**
- [ ] Check `.env` has required variables
- [ ] Test endpoint directly in browser/Postman
- [ ] Look for error messages in server console
- [ ] Verify database connection with `better-sqlite3`
- [ ] Check rate limiter isn't blocking requests
- [ ] Inspect network tab in browser DevTools

**When frontend displays wrong data:**
- [ ] Verify API returns correct JSON format
- [ ] Check JavaScript parses response correctly
- [ ] Use `console.log()` to trace data flow
- [ ] Verify Tailwind classes are applied
- [ ] Check for `setTimeout()`/`setInterval()` logic issues

**When Discord bot commands don't work:**
- [ ] Verify `BOT_TOKEN` in `.env`
- [ ] Check bot has right permissions in server
- [ ] Use message logs to debug command parsing
- [ ] Test in Discord with correct prefix

---

## 📊 Project Statistics

| Metric | Value |
|--------|-------|
| **API Endpoints** | 50+ endpoints documented |
| **Database Tables** | 15+ tables (players, ratings, forum, etc.) |
| **Frontend Pages** | 10+ interactive HTML pages |
| **Services** | 9 business logic services |
| **Routes** | 7 route modules |
| **NPM Dependencies** | 40+ packages |
| **Supported Platforms** | TikTok, YouTube, SoundCloud, Facebook, Twitter/X |
| **Real-time Updates** | Socket.IO, WebSocket console, Server status |
| **User Features** | OAuth login, streaks, cloud storage, forum, album, ratings |

---

## 🚀 Next Steps for New Features

When building new features, follow this pattern:

1. **Database**: Add table + schema in `src/modules/database.js`
2. **Service**: Create business logic in `src/services/newService.js`
3. **Routes**: Define API endpoints in `src/routes/newRoutes.js`
4. **Frontend**: Create/modify HTML/CSS/JS in `/html/`
5. **Integration**: Wire up in `server.js` and `src/routes/index.js`
6. **Testing**: Test with browser + curl/Postman
7. **Documentation**: Update this AGENT.md file

---

## 📞 Quick Reference Links

- **Main Server File**: [server.js](server.js#L1)
- **Config**: [src/config/index.js](src/config/index.js#L1)
- **Database**: [src/modules/database.js](src/modules/database.js#L1)
- **Routes Setup**: [src/routes/index.js](src/routes/index.js#L1)
- **PikaMC Service**: [src/services/pikamcService.js](src/services/pikamcService.js#L1)
- **Discord Bot**: [bot/bot2.js](bot/bot2.js#L1)
│   └── API Routes:
│       ├── POST /api/auth/logout
│       ├── GET /api/user-info
│       ├── GET /api/pikamc/status
│       ├── GET /api/status/stats
│       ├── GET /api/minecraft-downloads
│       ├── GET /api/ratings
│       ├── POST /api/ratings
│       ├── DELETE /api/ratings/:timestamp
│       └── More...
│
└── Data & Config
    ├── /json/ (SQLite backups, configs)
    ├── /cloud/ (user file storage)
    └── Authentication (Discord OAuth via index.js)
```

## Common Workflows

### Adding a Frontend Feature (e.g., New Stats Card)
1. Edit HTMLtemplate in `/html/dowloadmc.html` or appropriate page
2. Add CSS classes (use Tailwind utilities, check existing `.stat-card`, `.download-card` styles)
3. Create JavaScript function to fetch data:
   ```javascript
   async function loadFeatureName() {
       const res = await fetch('/api/feature-endpoint');
       const data = await res.json();
       // Update DOM elements
   }
   ```
4. Call on page load and set up auto-refresh with `setInterval(loadFeatureName, 10000);`

### Fixing Backend API Response
1. Locate endpoint in `/bản chỉnh sửa/index.js` or `server.js`
2. Check response format: `{success: bool, data: {...}, message: string}`
3. Verify it matches expected consumer (e.g., `loadServerStats()` expects `{players: {online, max}, ram: {usage, total}}`)
4. Test API locally: `curl http://localhost:3000/api/endpoint`

### Adding New API Endpoint
1. Add route handler in `index.js`:
   ```javascript
   app.get('/api/new-endpoint', (req, res) => {
       // Logic here
       res.json({success: true, data: {...}});
   });
   ```
2. Update frontend consumer to call `fetch('/api/new-endpoint')`
3. Ensure response format is documented in comments for future devs

## Code Standards

### Frontend
- Use Tailwind for styling (no custom CSS unless necessary)
- Gradients: `.gradient-green` (green), `.gradient-blue` (blue)
- Cards: `.stat-card` (glassmorphism), `.download-card` (hover effects)
- Animation: Define in `<style>` tag using CSS or Tailwind transitions
- Error handling: Show toast notifications via `showToast(message, type)`

### Backend
- All API routes return JSON with structure: `{success, data/message/items, error?}`
- Use try-catch for async operations
- Log errors to console with context: `console.error('[CONTEXT] Error:', error);`
- Cache strategies where needed (e.g., PikaMC status cached 10 seconds)

### Naming Conventions
- Functions: camelCase (`loadServerStats`, `copyIP`)
- IDs: kebab-case (`player-count`, `dynamic-downloads`)
- Classes: kebab-case (`.stat-card`, `.download-card`)
- APIs: `/api/namespace/endpoint`

## Debugging Checklist

- [ ] API returns expected JSON structure?
- [ ] Frontend selector matches ID in HTML?
- [ ] Async functions properly await?
- [ ] CORS issues with external APIs (e.g., mcsrvstat)?
- [ ] Cache expiration for repeated calls?
- [ ] Error fallbacks if API fails?
- [ ] Responsive design tested on mobile?
- [ ] Console errors/warnings cleaned up?

## Key Files to Reference

- **Page Template**: `dowloadmc.html` — modern design patterns, API integration examples
- **API Server**: `/bản chỉnh sửa/index.js` (lines 1100-1150) — `fetchPikaMCStatus()` callback pattern
- **Rating System**: `index.html` — complex state management with localStorage, retry logic
- **Sidebar**: `shared-sidebar.js` — reusable UI component

## Do's & Don'ts

✅ **DO:**
- Validate API responses before using data
- Use toast notifications for user feedback
- Test frontend changes with DevTools
- Keep API response formats consistent
- Document new endpoints with inline comments

❌ **DON'T:**
- Mix Tailwind classes with inline styles (choose one)
- Make blocking API calls without fallbacks
- Hardcode server IPs (use config/endpoint)
- Leave console.errors in production code
- Create deeply nested async/await chains without error handling

## Output Format

When completing a task, provide:
1. **Summary**: What was changed and why
2. **Files Modified**: List of files touched
3. **Testing Notes**: How to verify the fix works
4. **No Breaking Changes**: Confirm backwards compatibility
