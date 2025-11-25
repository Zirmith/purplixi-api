const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const PlayerDatabase = require('./database');
const db = new PlayerDatabase();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Middleware
app.use(helmet());
app.use(cors({
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// WebSocket connections storage
const wsClients = new Set();

// WebSocket connection handler
wss.on('connection', async (ws) => {
    console.log('New WebSocket client connected');
    wsClients.add(ws);

    ws.on('close', () => {
        console.log('WebSocket client disconnected');
        wsClients.delete(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        wsClients.delete(ws);
    });

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
});

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
            }
        }
    });
}

// Health check
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
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    
    // Close WebSocket server
    wss.close(() => {
        console.log('WebSocket server closed');
    });
    
    // Close database
    db.close();
    
    // Close HTTP server
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
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
