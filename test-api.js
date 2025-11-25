const axios = require('axios');

const API_URL = 'http://localhost:3000';

async function testAPI() {
    console.log('Testing Purplixi API...\n');
    
    try {
        // Test 1: Health check
        console.log('1. Testing health endpoint...');
        const healthResponse = await axios.get(`${API_URL}/health`, { timeout: 5000 });
        console.log('✓ Health check passed:', healthResponse.data.status);
        console.log('');
        
        // Test 2: Get stats
        console.log('2. Testing stats endpoint...');
        const statsResponse = await axios.get(`${API_URL}/api/stats`, { timeout: 5000 });
        console.log('✓ Stats retrieved:', statsResponse.data.statistics);
        console.log('');
        
        // Test 3: Player connect
        console.log('3. Testing player connect...');
        const connectResponse = await axios.post(`${API_URL}/api/player/connect`, {
            username: 'TestPlayer',
            uuid: 'test-uuid-1234',
            launcherVersion: '2.6.0',
            privacy: {
                showUsername: true,
                showVersion: true,
                showWorld: true,
                showServer: false
            }
        }, { timeout: 5000 });
        
        if (connectResponse.data.success) {
            const sessionId = connectResponse.data.sessionId;
            console.log('✓ Player connected with session:', sessionId);
            console.log('');
            
            // Test 4: Get online players
            console.log('4. Testing get online players...');
            const playersResponse = await axios.get(`${API_URL}/api/players/online`, { timeout: 5000 });
            console.log('✓ Online players:', playersResponse.data.count);
            console.log('');
            
            // Test 5: Update status
            console.log('5. Testing status update...');
            const statusResponse = await axios.post(`${API_URL}/api/player/status`, {
                sessionId: sessionId,
                status: 'playing',
                minecraftVersion: '1.20.4',
                worldName: 'Test World',
                serverAddress: null
            }, { timeout: 5000 });
            console.log('✓ Status updated:', statusResponse.data.message);
            console.log('');
            
            // Test 6: Heartbeat
            console.log('6. Testing heartbeat...');
            const heartbeatResponse = await axios.post(`${API_URL}/api/player/heartbeat`, {
                sessionId: sessionId
            }, { timeout: 5000 });
            console.log('✓ Heartbeat sent:', heartbeatResponse.data.message);
            console.log('');
            
            // Test 7: Disconnect
            console.log('7. Testing player disconnect...');
            const disconnectResponse = await axios.post(`${API_URL}/api/player/disconnect`, {
                sessionId: sessionId
            }, { timeout: 5000 });
            console.log('✓ Player disconnected:', disconnectResponse.data.message);
            console.log('');
        }
        
        console.log('✅ All tests passed!\n');
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        if (error.response) {
            console.error('Response:', error.response.data);
        }
        process.exit(1);
    }
}

testAPI();
