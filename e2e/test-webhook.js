// e2e/test-webhook.js
import fetch from 'node-fetch';

async function testWebhook() {
  console.log('🧪 Testing webhook endpoint...');
  
  const testData = {
    servers: {
      "usa": {
        "host": "107.150.41.226",
        "port": 34905,
        "name": "USA",
        "receivedTime": Date.now(),
        "ttl": 60
      },
      "netherlands": {
        "host": "213.111.146.36",
        "port": 25375,
        "name": "Netherlands",
        "receivedTime": Date.now(),
        "ttl": 60
      }
    },
    timestamp: new Date().toISOString(),
    extensionId: "test-extension-id"
  };
  
  try {
    const response = await fetch('http://localhost:3000/proxy-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData)
    });
    
    const result = await response.json();
    console.log('✅ Response:', result);
    
    // Check status
    const statusResponse = await fetch('http://localhost:3000/status');
    const status = await statusResponse.json();
    console.log('📊 Server status:', status);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testWebhook();