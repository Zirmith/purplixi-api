# Purplixi API Server

Real-time player tracking API for Purplixi Minecraft Launcher with WebSocket support and privacy controls.

## Features

- 🔴 **Real-time Updates** - WebSocket support for instant player status updates
- 🔒 **Privacy Controls** - Players can choose what information to share
- 📊 **Statistics Tracking** - Track launches, playtime, popular versions
- 💾 **SQLite Database** - Lightweight, file-based storage
- 🚀 **High Performance** - Optimized queries with WAL mode
- 🛡️ **Security** - Rate limiting, helmet.js, CORS protection
- ⚡ **Auto Cleanup** - Removes stale sessions automatically

## Quick Start

### Installation

```bash
# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit .env with your settings (optional)
nano .env

# Start the server
npm start
```

### Development Mode

```bash
# Install nodemon for auto-restart
npm install -g nodemon

# Run in development mode
npm run dev
```

## API Endpoints

### Player Connection

**POST** `/api/player/connect`

Connect a player and create a new session.

**Request Body:**
```json
{
  "username": "Notch",
  "uuid": "069a79f4-44e9-4726-a5be-fca90e38aaf5",
  "launcherVersion": "2.5.0",
  "privacy": {
    "showUsername": true,
    "showVersion": true,
    "showWorld": true,
    "showServer": false
  }
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Player connected successfully"
}
```

---

### Update Player Status

**POST** `/api/player/status`

Update player's current activity.

**Request Body:**
```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "playing",
  "minecraftVersion": "1.20.1",
  "worldName": "My Survival World",
  "serverAddress": null
}
```

**Status Values:**
- `online` - Launcher open, not playing
- `playing` - Currently in-game
- `idle` - AFK or minimized

---

### Disconnect Player

**POST** `/api/player/disconnect`

End a player session and record playtime.

**Request Body:**
```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

### Heartbeat

**POST** `/api/player/heartbeat`

Keep session alive (call every 60 seconds).

**Request Body:**
```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

### Get Online Players

**GET** `/api/players/online`

Get list of currently online players.

**Response:**
```json
{
  "success": true,
  "count": 3,
  "players": [
    {
      "session_id": "550e8400-e29b-41d4-a716-446655440000",
      "username": "Notch",
      "status": "playing",
      "minecraft_version": "1.20.1",
      "world_name": "My Survival World",
      "server_address": null,
      "connected_at": "2025-11-20 03:00:00",
      "session_duration": 1500
    }
  ]
}
```

---

### Get Statistics

**GET** `/api/stats`

Get launcher usage statistics.

**Response:**
```json
{
  "success": true,
  "statistics": {
    "total_launches": 15234,
    "total_users": 542,
    "total_playtime": 98234567,
    "online_players": 3
  },
  "popularVersions": [
    { "minecraft_version": "1.20.1", "count": 12 },
    { "minecraft_version": "1.19.2", "count": 8 }
  ]
}
```

---

## WebSocket Connection

Connect to `ws://your-server:3000/ws` for real-time updates.

### Message Types

**Initial Connection:**
```json
{
  "type": "initial",
  "players": [...],
  "count": 3
}
```

**Player Connected:**
```json
{
  "type": "player_connected",
  "players": [...],
  "count": 4
}
```

**Player Updated:**
```json
{
  "type": "player_updated",
  "players": [...],
  "count": 4
}
```

**Player Disconnected:**
```json
{
  "type": "player_disconnected",
  "players": [...],
  "count": 3
}
```

**Cleanup (stale sessions removed):**
```json
{
  "type": "cleanup",
  "players": [...],
  "count": 2
}
```

## Privacy System

Players can control what information is shared:

- **showUsername** - Display username or "Anonymous"
- **showVersion** - Display Minecraft version
- **showWorld** - Display world name (singleplayer)
- **showServer** - Display server address or "Hidden Server"

Privacy settings are sent during connection and respected in all responses.

## Database Schema

### Players Table
```sql
- id: INTEGER PRIMARY KEY
- session_id: TEXT UNIQUE
- username: TEXT
- uuid: TEXT
- first_seen: DATETIME
- last_seen: DATETIME
- total_playtime: INTEGER (seconds)
- launcher_version: TEXT
```

### Sessions Table
```sql
- id: INTEGER PRIMARY KEY
- session_id: TEXT UNIQUE
- player_id: INTEGER (FK)
- username: TEXT
- status: TEXT
- minecraft_version: TEXT
- world_name: TEXT
- server_address: TEXT
- connected_at: DATETIME
- last_update: DATETIME
- privacy_show_username: BOOLEAN
- privacy_show_version: BOOLEAN
- privacy_show_world: BOOLEAN
- privacy_show_server: BOOLEAN
```

### Statistics Table
```sql
- id: INTEGER PRIMARY KEY
- metric: TEXT UNIQUE
- value: INTEGER
- updated_at: DATETIME
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `NODE_ENV` | `development` | Environment |
| `ALLOWED_ORIGINS` | `*` | CORS allowed origins (comma-separated) |
| `DB_PATH` | `./data/players.db` | SQLite database path |

### CORS Configuration

For production, set specific allowed origins:

```env
ALLOWED_ORIGINS=https://purplixi.com,https://www.purplixi.com
```

## Deployment

### Production Deployment

1. **VPS/Dedicated Server:**
```bash
# Clone repository
git clone <your-repo>
cd purplixi-api

# Install dependencies
npm install --production

# Configure environment
cp .env.example .env
nano .env

# Run with PM2 (process manager)
npm install -g pm2
pm2 start server.js --name purplixi-api
pm2 save
pm2 startup
```

2. **Docker:**
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t purplixi-api .
docker run -p 3000:3000 -v $(pwd)/data:/app/data purplixi-api
```

3. **Reverse Proxy (Nginx):**
```nginx
server {
    listen 80;
    server_name api.purplixi.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

## Performance

### Optimizations

- **WAL Mode** - Better SQLite performance for concurrent reads/writes
- **Auto Cleanup** - Removes stale sessions every 60 seconds
- **Rate Limiting** - 100 requests per 15 minutes per IP
- **Connection Pooling** - Efficient WebSocket connection management

### Scaling

For high traffic:
- Use Redis for session storage instead of SQLite
- Deploy multiple instances behind a load balancer
- Use Redis Pub/Sub for WebSocket message distribution

## Security

- ✅ Helmet.js for security headers
- ✅ CORS protection
- ✅ Rate limiting
- ✅ Input validation
- ✅ No sensitive data exposure
- ✅ Privacy-first design

## Monitoring

### Health Check

```bash
curl http://localhost:3000/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-11-20T03:25:49.000Z",
  "uptime": 3600,
  "websockets": 5
}
```

### Logs

```bash
# View real-time logs with PM2
pm2 logs purplixi-api

# View specific number of lines
pm2 logs purplixi-api --lines 100
```

## Troubleshooting

### WebSocket Connection Fails

1. Check firewall allows WebSocket connections
2. Ensure reverse proxy has WebSocket support
3. Verify CORS settings allow your domain

### Database Locked

SQLite WAL mode prevents most locks, but if issues occur:
```bash
# Close all connections and rebuild
rm data/players.db-wal data/players.db-shm
```

### High Memory Usage

```bash
# Restart with PM2
pm2 restart purplixi-api

# Check database size
du -h data/players.db
```

## License

MIT License - See LICENSE file for details

## Support

For issues or questions, please open an issue on GitHub.

---

**Built by MiniMax Agent for Purplixi Launcher**
