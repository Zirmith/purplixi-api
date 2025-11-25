// index.js
/**
 * Purplixi API Server
 * - Supports HTTP (ws) and optional HTTPS (wss)
 * - Auto-generates self-signed certs for development if missing (uses `selfsigned`)
 * - Clean WebSocket client handling (ping/pong) and broadcast helpers
 *
 * Required packages:
 *   npm install express cors helmet express-rate-limit ws uuid dotenv selfsigned
 *
 * Environment:
 *   PORT (http port) default 3000
 *   HTTPS_PORT default 3443
 *   HOST default 0.0.0.0
 *   USE_HTTPS = "true" to enable HTTPS and wss (dev self-signed cert generation)
 *   CERT_DIR default ./certs
 *   NODE_ENV
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const selfsigned = require('selfsigned'); // dev cert generator
const PlayerDatabase = require('./database');
const db = new PlayerDatabase();

// Config
const USE_HTTPS = true || (process.env.USE_HTTPS || 'false').toLowerCase() === 'true';
const HOST = process.env.HOST || '0.0.0.0';
const HTTP_PORT = parseInt(process.env.PORT || '3000', 10);
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || '3443', 10);
const CERT_DIR = process.env.CERT_DIR || path.join(__dirname, 'certs');
const PING_INTERVAL_MS = 30000; // ping every 30s
const PONG_WAIT_MS = 10000; // allow 10s for pong

// Express app shared by HTTP/HTTPS
const app = express();

// Security & Middleware
app.use(helmet());
app.use(cors({
    origin: '*',
    credentials: true,
    methods: ['GET','POST','PUT','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Rate limiting on /api
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Simple health check
const wsClients = new Set();

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        websockets: wsClients.size
    });
});

// ===== API ROUTES =====
// Connect player
app.post('/api/player/connect', async (req, res) => {
    try {
        const { username, uuid, launcherVersion, privacy } = req.body;

        if (!username) {
            return res.status(400).json({ error: 'Username is required' });
        }

        const sessionId = uuidv4();

        await db.createSession(sessionId, username, privacy || {});

        // Broadcast update
        const players = await db.getOnlinePlayers();
        const count = await db.getPlayerCount();
        broadcast({
            type: 'player_connected',
            players,
            count
        });

        res.json({
            success: true,
            sessionId,
            message: 'Player connected successfully'
        });
    } catch (error) {
        console.error('Error connecting player:', error);
        res.status(500).json({ error: 'Failed to connect player' });
    }
});

// Update player status
app.post('/api/player/status', async (req, res) => {
    try {
        const { sessionId, status, minecraftVersion, worldName, serverAddress, gameMode } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: 'Session ID is required' });
        }

        await db.updateSession(sessionId, {
            status,
            minecraftVersion,
            worldName,
            serverAddress,
            gameMode
        });

        // Broadcast update
        const players = await db.getOnlinePlayers();
        const count = await db.getPlayerCount();
        broadcast({
            type: 'player_updated',
            players,
            count
        });

        res.json({
            success: true,
            message: 'Status updated successfully'
        });
    } catch (error) {
        console.error('Error updating player status:', error);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

// Disconnect player
app.post('/api/player/disconnect', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: 'Session ID is required' });
        }

        await db.endSession(sessionId);

        // Broadcast update
        const players = await db.getOnlinePlayers();
        const count = await db.getPlayerCount();
        broadcast({
            type: 'player_disconnected',
            players,
            count
        });

        res.json({
            success: true,
            message: 'Player disconnected successfully'
        });
    } catch (error) {
        console.error('Error disconnecting player:', error);
        res.status(500).json({ error: 'Failed to disconnect player' });
    }
});

// Get online players
app.get('/api/players/online', async (req, res) => {
    try {
        const players = await db.getOnlinePlayers();
        res.json({
            success: true,
            count: players.length,
            players
        });
    } catch (error) {
        console.error('Error fetching online players:', error);
        res.status(500).json({ error: 'Failed to fetch players' });
    }
});

// Get statistics
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await db.getStatistics();
        const popularVersions = await db.getPopularVersions(5);

        res.json({
            success: true,
            statistics: stats,
            popularVersions
        });
    } catch (error) {
        console.error('Error fetching statistics:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

// Heartbeat endpoint (for launcher to keep session alive)
app.post('/api/player/heartbeat', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: 'Session ID is required' });
        }

        await db.updateSession(sessionId, {});

        res.json({
            success: true,
            message: 'Heartbeat received'
        });
    } catch (error) {
        console.error('Error processing heartbeat:', error);
        res.status(500).json({ error: 'Failed to process heartbeat' });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ===== WebSocket logic =====
function setupWSS(serverInstance) {
    const wss = new WebSocketServer({ server: serverInstance, path: '/ws' });

    // heartbeat helper per socket
    function heartbeat() {
        this.isAlive = true;
    }

    wss.on('connection', async (ws, req) => {
        console.log('New WebSocket client connected from', req.socket.remoteAddress);
        ws.isAlive = true;
        ws.lastPong = Date.now();
        ws.on('pong', () => {
            ws.isAlive = true;
            ws.lastPong = Date.now();
        });

        ws.on('close', () => {
            console.log('WebSocket client disconnected');
            wsClients.delete(ws);
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
            wsClients.delete(ws);
            try { ws.terminate(); } catch (_) {}
        });

        wsClients.add(ws);

        // Send initial player list
        try {
            const players = await db.getOnlinePlayers();
            ws.send(JSON.stringify({
                type: 'initial',
                players: players,
                count: players.length
            }));
        } catch (error) {
            console.error('Error sending initial data:', error);
        }

        // Optionally handle incoming messages if needed:
        ws.on('message', (msg, isBinary) => {
            // If you expect messages from clients, handle them here.
            // Example: parse JSON safely
            try {
                const data = JSON.parse(isBinary ? msg : msg.toString());
                // handle data...
            } catch (e) {
                // ignore non-json messages for now
            }
        });
    });

    // server-side ping/pong sweep to detect dead sockets
    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                console.log('Terminating dead ws client');
                try { ws.terminate(); } catch (_) {}
                wsClients.delete(ws);
                return;
            }

            ws.isAlive = false;
            try {
                ws.ping(() => { /* noop */ });
            } catch (err) {
                console.error('Failed to ping ws client', err);
            }
        });
    }, PING_INTERVAL_MS);

    wss.on('close', () => {
        clearInterval(interval);
    });

    return wss;
}

// Broadcast to all WebSocket clients
function broadcast(data) {
    const message = JSON.stringify(data);
    wsClients.forEach(client => {
        if (client.readyState === 1) { // OPEN
            try {
                client.send(message);
            } catch (error) {
                console.error('Error sending to client:', error);
                wsClients.delete(client);
                try { client.terminate(); } catch (_) {}
            }
        }
    });
}

// Cleanup stale sessions every minute
setInterval(async () => {
    try {
        const cleaned = await db.cleanupStaleSessions();
        if (cleaned > 0) {
            console.log(`Cleaned up ${cleaned} stale sessions`);

            // Broadcast update after cleanup
            const players = await db.getOnlinePlayers();
            const count = await db.getPlayerCount();
            broadcast({
                type: 'cleanup',
                players,
                count
            });
        }
    } catch (error) {
        console.error('Error during cleanup:', error);
    }
}, 60000);

// Graceful shutdown
async function gracefulShutdown(httpServer, httpsServer) {
    console.log('\nShutting down gracefully...');

    try {
        if (httpServer) {
            httpServer.close(() => {
                console.log('HTTP server closed');
            });
        }
        if (httpsServer) {
            httpsServer.close(() => {
                console.log('HTTPS server closed');
            });
        }
    } catch (err) {
        console.error('Error closing servers:', err);
    }

    try {
        // ensure DB closes
        await db.close();
    } catch (err) {
        console.error('Error closing DB:', err);
    }

    // terminate remaining websockets
    wsClients.forEach((ws) => {
        try { ws.terminate(); } catch (_) {}
    });

    setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', () => gracefulShutdown(httpServerInstance, httpsServerInstance));
process.on('SIGTERM', () => gracefulShutdown(httpServerInstance, httpsServerInstance));

// ===== Server startup with optional HTTPS =====
let httpServerInstance = null;
let httpsServerInstance = null;
let httpWssInstance = null;
let httpsWssInstance = null;

async function ensureCerts() {
    if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

    const keyFile = path.join(CERT_DIR, 'key.pem');
    const certFile = path.join(CERT_DIR, 'cert.pem');

    if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
        return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
    }

    console.log('Generating self-signed certificate for development (saved to ./certs/) ...');

    const attrs = [{ name: 'commonName', value: process.env.SSL_COMMON_NAME || 'localhost' }];
    const opts = {
        days: 3650,
        keySize: 2048,
        algorithm: 'sha256',
        extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 2, value: '127.0.0.1' }] }]
    };

    const pems = selfsigned.generate(attrs, opts);

    fs.writeFileSync(keyFile, pems.private);
    fs.writeFileSync(certFile, pems.cert);

    return { key: pems.private, cert: pems.cert };
}

(async function startServers() {
    try {
        // Always start HTTP server (may be used for redirect to HTTPS)
        const httpServer = http.createServer(app);
        httpServerInstance = httpServer;

        // If HTTPS is requested - create certs and an HTTPS server
        if (USE_HTTPS) {
            const { key, cert } = await ensureCerts();

            // Create HTTPS server using same express app
            const httpsServer = https.createServer({ key, cert }, app);
            httpsServerInstance = httpsServer;

            // Setup WSS on HTTPS server (wss)
            httpsWssInstance = setupWSS(httpsServer);

            // Also setup WS on HTTP server (optional): allows ws connections (non-secure)
            httpWssInstance = setupWSS(httpServer);

            // Start HTTP server mainly for redirecting to HTTPS
            httpServer.on('request', (req, res) => {
                // If request is already for health or an API endpoint, you might want to accept it.
                // But for security, redirect all non-API GETs to https.
                if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/health') && !req.url.startsWith('/ws')) {
                    const host = req.headers.host ? req.headers.host.split(':')[0] : HOST;
                    const redirectTo = `https://${host}:${HTTPS_PORT}${req.url}`;
                    res.writeHead(301, { Location: redirectTo });
                    res.end();
                }
            });

            httpServer.listen(HTTP_PORT, HOST, () => {
                console.log(`HTTP server listening on http://${HOST}:${HTTP_PORT}`);
            });

            httpsServer.listen(HTTPS_PORT, HOST, () => {
                console.log(`HTTPS server listening on https://${HOST}:${HTTPS_PORT}`);
                console.log(`WSS endpoint: wss://${HOST}:${HTTPS_PORT}/ws`);
                console.log(`WS endpoint (non-secure): ws://${HOST}:${HTTP_PORT}/ws`);
            });

        } else {
            // Only HTTP + WS
            httpWssInstance = setupWSS(httpServer);
            httpServer.listen(HTTP_PORT, HOST, () => {
                console.log(`HTTP server listening on http://${HOST}:${HTTP_PORT}`);
                console.log(`WS endpoint: ws://${HOST}:${HTTP_PORT}/ws`);
            });
        }

        // show API endpoints summary
        console.log(`
╔═══════════════════════════════════════════════════════╗
║         Purplixi API Server                           ║
╚═══════════════════════════════════════════════════════╝

API Endpoints:
  POST   /api/player/connect      - Connect player
  POST   /api/player/disconnect   - Disconnect player
  POST   /api/player/status       - Update player status
  POST   /api/player/heartbeat    - Keep session alive
  GET    /api/players/online      - Get online players
  GET    /api/stats               - Get statistics
  GET    /health                  - Health check

Environment: ${process.env.NODE_ENV || 'development'}
USE_HTTPS: ${USE_HTTPS}
`);
    } catch (err) {
        console.error('Failed to start servers:', err);
        process.exit(1);
    }
})();
