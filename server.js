const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const PlayerDatabase = require('./database');
const db = new PlayerDatabase();

const app = express();

// =========================
//   GENERATE DEV CERTS
// =========================
function generateDevCerts() {
    const certDir = path.join(__dirname, 'certs');

    if (!fs.existsSync(certDir)) fs.mkdirSync(certDir);

    const keyPath = path.join(certDir, 'dev-key.pem');
    const certPath = path.join(certDir, 'dev-cert.pem');

    // If already generated, use them
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        return {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };
    }

    console.log('🔧 Generating new self-signed development certificates...');

    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const pems = selfsigned.generate(attrs, { days: 365 });

    fs.writeFileSync(keyPath, pems.private);
    fs.writeFileSync(certPath, pems.cert);

    console.log('✨ Dev certificates created at ./certs/');
    return {
        key: Buffer.from(pems.private),
        cert: Buffer.from(pems.cert)
    };
}

// =========================
//   SERVER CREATION LOGIC
// =========================
let server;
let protocol;

if (process.env.SSL_KEY && process.env.SSL_CERT) {
    // =========================
    //  PRODUCTION HTTPS + WSS
    // =========================
    console.log('🔐 Using production SSL certificates');

    const httpsOptions = {
        key: fs.readFileSync(process.env.SSL_KEY),
        cert: fs.readFileSync(process.env.SSL_CERT)
    };

    server = https.createServer(httpsOptions, app);
    protocol = 'wss';

} else if (process.env.NODE_ENV !== 'production') {
    // =========================
    //   DEVELOPMENT HTTPS + WSS
    // =========================
    console.log('🧪 Development mode — generating self-signed certs');

    const devSSL = generateDevCerts();
    server = https.createServer(devSSL, app);
    protocol = 'wss';

} else {
    // =========================
    //  FALLBACK HTTP + WS
    // =========================
    console.log('🌐 No SSL provided — using HTTP + WS');
    server = http.createServer(app);
    protocol = 'ws';
}

// =========================
//   WEBSOCKET SERVER
// =========================
const wss = new WebSocketServer({
    server,
    path: '/ws',
});

// Track WS clients
const wsClients = new Set();

wss.on('connection', async (ws) => {
    console.log('New WebSocket client connected');
    wsClients.add(ws);

    ws.on('close', () => wsClients.delete(ws));
    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
        wsClients.delete(ws);
    });

    try {
        const players = await db.getOnlinePlayers();
        ws.send(JSON.stringify({
            type: 'initial',
            players,
            count: players.length
        }));
    } catch (err) {
        console.error('Error sending initial data:', err);
    }
});

// Broadcast helper
function broadcast(data) {
    const msg = JSON.stringify(data);
    wsClients.forEach(ws => {
        if (ws.readyState === 1) {
            try { ws.send(msg); }
            catch { wsClients.delete(ws); }
        }
    });
}

// =========================
//   MIDDLEWARE + API
// =========================
app.use(helmet());
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
});
app.use('/api/', limiter);

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        websockets: wsClients.size
    });
});

// =========================
//   YOUR EXISTING ROUTES
// =========================
// (unchanged)
// --- Connect player
app.post('/api/player/connect', async (req, res) => {
    try {
        const { username, uuid, launcherVersion, privacy } = req.body;

        if (!username) return res.status(400).json({ error: 'Username required' });

        const sessionId = uuidv4();
        await db.createSession(sessionId, username, privacy || {});

        const players = await db.getOnlinePlayers();
        const count = await db.getPlayerCount();

        broadcast({ type: 'player_connected', players, count });

        res.json({ success: true, sessionId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Connection failed' });
    }
});

// --- Update status
app.post('/api/player/status', async (req, res) => {
    try {
        const { sessionId, ...update } = req.body;
        if (!sessionId) return res.status(400).json({ error: 'Session ID is required' });

        await db.updateSession(sessionId, update);

        const players = await db.getOnlinePlayers();
        const count = await db.getPlayerCount();

        broadcast({ type: 'player_updated', players, count });

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update' });
    }
});

// --- Disconnect
app.post('/api/player/disconnect', async (req, res) => {
    try {
        const { sessionId } = req.body;
        if (!sessionId) return res.status(400).json({ error: 'Session ID required' });

        await db.endSession(sessionId);

        const players = await db.getOnlinePlayers();
        const count = await db.getPlayerCount();

        broadcast({ type: 'player_disconnected', players, count });

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to disconnect' });
    }
});

// --- Online players
app.get('/api/players/online', async (req, res) => {
    try {
        const players = await db.getOnlinePlayers();
        res.json({ success: true, players, count: players.length });
    } catch {
        res.status(500).json({ error: 'Failed to fetch players' });
    }
});

// --- Stats
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await db.getStatistics();
        const versions = await db.getPopularVersions(5);
        res.json({ success: true, statistics: stats, popularVersions: versions });
    } catch {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Heartbeat
app.post('/api/player/heartbeat', async (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'Session ID required' });

    await db.updateSession(sessionId, {});
    res.json({ success: true });
});

// Cleanup stale
setInterval(async () => {
    const cleaned = await db.cleanupStaleSessions();
    if (cleaned > 0) {
        const players = await db.getOnlinePlayers();
        const count = await db.getPlayerCount();
        broadcast({ type: 'cleanup', players, count });
    }
}, 60000);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down...');
    wss.close();
    db.close();
    server.close(() => process.exit(0));
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
    console.log(`
╔═══════════════════════════════════════════════════════╗
║         Purplixi API Server                           ║
╚═══════════════════════════════════════════════════════╝

🚀 Server running on http://${HOST}:${PORT}
🔌 WebSocket endpoint: ws://${HOST}:${PORT}/ws
📊 Health check: http://${HOST}:${PORT}/health

🚀 Running on ${protocol}://${HOST}:${PORT}
🛜 WebSockets: ${protocol}://${HOST}:${PORT}/ws

API Endpoints:
  POST   /api/player/connect      - Connect player
  POST   /api/player/disconnect   - Disconnect player
  POST   /api/player/status       - Update player status
  POST   /api/player/heartbeat    - Keep session alive
  GET    /api/players/online      - Get online players
  GET    /api/stats               - Get statistics

Environment: ${process.env.NODE_ENV || 'development'}
    `);
});

module.exports = { app, server, db };
