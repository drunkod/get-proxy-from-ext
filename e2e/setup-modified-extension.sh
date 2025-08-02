#!/bin/bash
# setup-modified-extension.sh

echo "🚀 Setting up modified extension with proxy webhook..."

# Install dependencies
echo "📦 Installing dependencies..."
npm install adm-zip express cors

# Modify extension
echo "🔧 Modifying extension..."
node e2e/modify-extension.js

# Generate Jazz accounts if needed
if [ -z "$JAZZ_PROXY_SERVER_ACCOUNT" ]; then
  echo "🔑 Generating Jazz accounts..."
  echo "Run: npx jazz-run account create --name 'Proxy Server'"
  echo "Run: npx jazz-run account create --name 'Proxy Client'"
  echo "Then set environment variables and run this script again"
  exit 1
fi

# Start servers
echo "🚀 Starting servers..."

# Start Jazz proxy server in background
echo "Starting Jazz proxy server..."
node e2e/proxy-server.js &
JAZZ_PID=$!

# Start webhook server
echo "Starting webhook server..."
node e2e/proxy-webhook-server.js &
WEBHOOK_PID=$!

echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Open chrome://extensions"
echo "2. Enable Developer mode"
echo "3. Click 'Load unpacked'"
echo "4. Select the .modified-extension folder"
echo "5. The extension will start sending proxy updates automatically"
echo ""
echo "📊 Monitor status at: http://localhost:3000/status"
echo ""
echo "Press Ctrl+C to stop all servers"

# Wait for interrupt
trap "kill $JAZZ_PID $WEBHOOK_PID" INT
wait