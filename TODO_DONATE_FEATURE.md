# TODO: Donate Feature - Discord Bot to Web

## Steps:
- [x] 1. Update `src/config/index.js` - Add DISCORD_DONATE_CHANNEL_ID
- [x] 2. Update `bot/bot2.js` - Add message listener for !add command
- [x] 3. Create `src/services/donateService.js` - Handle donation data
- [x] 4. Update `server.js` - Add API endpoint and Socket.IO events
- [x] 5. Update `A11/donet.html` - Dynamic data from API
- [ ] 6. Test the feature


## Command Format:
```
!add "Nguyễn Văn A" 100.000
!add "Tên người donate" 500000
```

## Data Storage:
- File: `json/donations.json`
- Format: `[{ name: "Nguyễn Văn A", amount: 100000, date: "2024-01-15T10:30:00Z" }]`
