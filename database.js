const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

class PlayerDatabase {
    constructor(dbPath = './data/players.db') {
        // Ensure data directory exists
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Error opening database:', err);
                throw err;
            }
        });

        // Custom promisify for run() that preserves 'this' context
        this.dbRun = (sql, params = []) => {
            return new Promise((resolve, reject) => {
                this.db.run(sql, params, function(err) {
                    if (err) reject(err);
                    else resolve(this); // 'this' contains lastID and changes
                });
            });
        };
        
        this.dbGet = promisify(this.db.get.bind(this.db));
        this.dbAll = promisify(this.db.all.bind(this.db));
        this.dbExec = promisify(this.db.exec.bind(this.db));

        // Set WAL mode for better concurrency
        this.db.run('PRAGMA journal_mode = WAL', (err) => {
            if (err) console.error('Error setting WAL mode:', err);
        });
        
        this.initializeTables();
    }

    async initializeTables() {
        try {
            // Players table
            await this.dbExec(`
                CREATE TABLE IF NOT EXISTS players (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT UNIQUE NOT NULL,
                    username TEXT NOT NULL,
                    uuid TEXT,
                    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                    total_playtime INTEGER DEFAULT 0,
                    launcher_version TEXT,
                    UNIQUE(session_id)
                )
            `);

            // Sessions table (current active sessions)
            await this.dbExec(`
                CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT UNIQUE NOT NULL,
                    player_id INTEGER,
                    username TEXT NOT NULL,
                    status TEXT DEFAULT 'online',
                    minecraft_version TEXT,
                    world_name TEXT,
                    server_address TEXT,
                    game_mode TEXT DEFAULT 'idle',
                    connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_update DATETIME DEFAULT CURRENT_TIMESTAMP,
                    privacy_show_username BOOLEAN DEFAULT 1,
                    privacy_show_version BOOLEAN DEFAULT 1,
                    privacy_show_world BOOLEAN DEFAULT 1,
                    privacy_show_server BOOLEAN DEFAULT 1,
                    FOREIGN KEY (player_id) REFERENCES players(id)
                )
            `);
            
            // Add game_mode column if it doesn't exist (for existing databases)
            await this.dbExec(`
                CREATE TABLE IF NOT EXISTS _temp_check (game_mode TEXT);
                DROP TABLE _temp_check;
            `).catch(() => {});
            
            // Check if column exists and add if not
            const tableInfo = await this.dbAll(`PRAGMA table_info(sessions)`);
            const hasGameMode = tableInfo.some(col => col.name === 'game_mode');
            
            if (!hasGameMode) {
                await this.dbExec(`ALTER TABLE sessions ADD COLUMN game_mode TEXT DEFAULT 'idle'`);
                console.log('Added game_mode column to sessions table');
            }
            // Statistics table
            await this.dbExec(`
                CREATE TABLE IF NOT EXISTS statistics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    metric TEXT UNIQUE NOT NULL,
                    value INTEGER DEFAULT 0,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Initialize statistics
            await this.dbRun(`INSERT OR IGNORE INTO statistics (metric, value) VALUES (?, 0)`, ['total_launches']);
            await this.dbRun(`INSERT OR IGNORE INTO statistics (metric, value) VALUES (?, 0)`, ['total_users']);
            await this.dbRun(`INSERT OR IGNORE INTO statistics (metric, value) VALUES (?, 0)`, ['total_playtime']);
        } catch (error) {
            console.error('Error initializing tables:', error);
            throw error;
        }
    }

    // Player management
    async createOrUpdatePlayer(sessionId, username, uuid = null, launcherVersion = null) {
        try {
            const existingPlayer = await this.dbGet(
                `SELECT id FROM players WHERE session_id = ?`,
                [sessionId]
            );

            if (existingPlayer) {
                await this.dbRun(
                    `UPDATE players 
                    SET last_seen = CURRENT_TIMESTAMP, launcher_version = ?
                    WHERE session_id = ?`,
                    [launcherVersion, sessionId]
                );
                return existingPlayer.id;
            } else {
                const result = await this.dbRun(
                    `INSERT INTO players (session_id, username, uuid, launcher_version)
                    VALUES (?, ?, ?, ?)`,
                    [sessionId, username, uuid, launcherVersion]
                );
                
                // Increment total users
                await this.incrementStat('total_users');
                
                return result.lastID;
            }
        } catch (error) {
            console.error('Error in createOrUpdatePlayer:', error);
            throw error;
        }
    }

    // Session management
    async createSession(sessionId, username, privacySettings = {}) {
        try {
            const playerId = await this.createOrUpdatePlayer(sessionId, username);
            
            await this.dbRun(
                `INSERT INTO sessions (
                    session_id, player_id, username,
                    privacy_show_username, privacy_show_version,
                    privacy_show_world, privacy_show_server
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    sessionId,
                    playerId,
                    username,
                    privacySettings.showUsername !== false ? 1 : 0,
                    privacySettings.showVersion !== false ? 1 : 0,
                    privacySettings.showWorld !== false ? 1 : 0,
                    privacySettings.showServer !== false ? 1 : 0
                ]
            );

            // Increment total launches
            await this.incrementStat('total_launches');

            return { sessionId, playerId };
        } catch (error) {
            console.error('Error in createSession:', error);
            throw error;
        }
    }

    async updateSession(sessionId, updates) {
        try {
            const fields = [];
            const values = [];

            if (updates.status) {
                fields.push('status = ?');
                values.push(updates.status);
            }
            if (updates.minecraftVersion) {
                fields.push('minecraft_version = ?');
                values.push(updates.minecraftVersion);
            }
            if (updates.worldName !== undefined) {
                fields.push('world_name = ?');
                values.push(updates.worldName);
            }
            if (updates.serverAddress !== undefined) {
                fields.push('server_address = ?');
                values.push(updates.serverAddress);
            }
            if (updates.gameMode !== undefined) {
                fields.push('game_mode = ?');
                values.push(updates.gameMode);
            }

            fields.push('last_update = CURRENT_TIMESTAMP');
            values.push(sessionId);

            const result = await this.dbRun(
                `UPDATE sessions 
                SET ${fields.join(', ')}
                WHERE session_id = ?`,
                values
            );

            return result;
        } catch (error) {
            console.error('Error in updateSession:', error);
            throw error;
        }
    }

    async endSession(sessionId) {
        try {
            // Calculate session duration
            const session = await this.dbGet(
                `SELECT 
                    player_id,
                    (strftime('%s', 'now') - strftime('%s', connected_at)) as duration
                FROM sessions
                WHERE session_id = ?`,
                [sessionId]
            );

            if (session) {
                // Update player's total playtime
                await this.dbRun(
                    `UPDATE players 
                    SET total_playtime = total_playtime + ?,
                        last_seen = CURRENT_TIMESTAMP
                    WHERE id = ?`,
                    [session.duration, session.player_id]
                );

                // Update total playtime stat
                await this.dbRun(
                    `UPDATE statistics 
                    SET value = value + ?, updated_at = CURRENT_TIMESTAMP
                    WHERE metric = 'total_playtime'`,
                    [session.duration]
                );
            }

            // Remove session
            return await this.dbRun(
                `DELETE FROM sessions WHERE session_id = ?`,
                [sessionId]
            );
        } catch (error) {
            console.error('Error in endSession:', error);
            throw error;
        }
    }

    async getOnlinePlayers() {
        try {
            return await this.dbAll(`
                SELECT 
                    s.session_id,
                    CASE 
                        WHEN s.privacy_show_username = 1 THEN s.username
                        ELSE 'Anonymous'
                    END as username,
                    s.status,
                    CASE 
                        WHEN s.privacy_show_version = 1 THEN s.minecraft_version
                        ELSE NULL
                    END as minecraft_version,
                    CASE 
                        WHEN s.privacy_show_world = 1 THEN s.world_name
                        ELSE NULL
                    END as world_name,
                    CASE 
                        WHEN s.privacy_show_server = 1 THEN s.server_address
                        WHEN s.privacy_show_server = 0 AND s.server_address IS NOT NULL THEN 'Hidden Server'
                        ELSE NULL
                    END as server_address,
                    s.game_mode,
                    s.connected_at,
                    (strftime('%s', 'now') - strftime('%s', s.connected_at)) as session_duration,
                    s.privacy_show_username,
                    s.privacy_show_version,
                    s.privacy_show_world,
                    s.privacy_show_server
                FROM sessions s
                WHERE datetime(s.last_update) > datetime('now', '-5 minutes')
                ORDER BY s.connected_at DESC
            `);
        } catch (error) {
            console.error('Error in getOnlinePlayers:', error);
            throw error;
        }
    }

    async getPlayerCount() {
        try {
            const result = await this.dbGet(`
                SELECT COUNT(*) as count 
                FROM sessions
                WHERE datetime(last_update) > datetime('now', '-5 minutes')
            `);
            return result.count;
        } catch (error) {
            console.error('Error in getPlayerCount:', error);
            throw error;
        }
    }

    async getStatistics() {
        try {
            const stats = await this.dbAll(`
                SELECT metric, value FROM statistics
            `);

            const result = {};
            stats.forEach(stat => {
                result[stat.metric] = stat.value;
            });

            result.online_players = await this.getPlayerCount();
            
            return result;
        } catch (error) {
            console.error('Error in getStatistics:', error);
            throw error;
        }
    }

    async incrementStat(metric) {
        try {
            await this.dbRun(
                `UPDATE statistics 
                SET value = value + 1, updated_at = CURRENT_TIMESTAMP
                WHERE metric = ?`,
                [metric]
            );
        } catch (error) {
            console.error('Error in incrementStat:', error);
            throw error;
        }
    }

    // Cleanup old sessions (older than 5 minutes with no update)
    async cleanupStaleSessions() {
        try {
            const staleSessions = await this.dbAll(`
                SELECT session_id FROM sessions
                WHERE datetime(last_update) <= datetime('now', '-5 minutes')
            `);

            for (const session of staleSessions) {
                await this.endSession(session.session_id);
            }

            return staleSessions.length;
        } catch (error) {
            console.error('Error in cleanupStaleSessions:', error);
            throw error;
        }
    }

    // Get popular versions
    async getPopularVersions(limit = 10) {
        try {
            return await this.dbAll(
                `SELECT 
                    minecraft_version,
                    COUNT(*) as count
                FROM sessions
                WHERE minecraft_version IS NOT NULL
                    AND datetime(last_update) > datetime('now', '-24 hours')
                GROUP BY minecraft_version
                ORDER BY count DESC
                LIMIT ?`,
                [limit]
            );
        } catch (error) {
            console.error('Error in getPopularVersions:', error);
            throw error;
        }
    }

    close() {
        this.db.close((err) => {
            if (err) {
                console.error('Error closing database:', err);
            }
        });
    }
}

module.exports = PlayerDatabase;
