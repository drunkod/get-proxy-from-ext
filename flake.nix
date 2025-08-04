# flake.nix
{
  description = "A development environment for the Prismai proxy management with Jazz integration.";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        
        # Jazz sync server URL
        # jazzSyncUrl = "ws://node205197-env-9764176354321.mircloud.host:11129";
        jazzSyncUrl = "ws://127.0.0.1:4200";
        
        # Helper scripts
        setupScripts = ''
          # Function to create Jazz account
          jazz-create-account() {
            local name="$1"
            if [ -z "$name" ]; then
              echo "Usage: jazz-create-account <account-name>"
              echo "Example: jazz-create-account 'Proxy Server'"
              return 1
            fi
            
            echo "🔐 Creating Jazz account: $name"
            echo "   Using peer: ${jazzSyncUrl}"
            echo ""
            npx jazz-run account create --name "$name" --peer "${jazzSyncUrl}"
          }
          
          # Function to setup environment
          setup-env() {
            echo "🔧 Setting up environment..."
            
            # Check if .env exists
            if [ -f .env ]; then
              echo "⚠️  .env file already exists. Backing up to .env.backup"
              cp .env .env.backup
            fi
            
            # Create .env file
          cat > .env << EOF
            # Jazz Sync Server
            JAZZ_SYNC_URL=${jazzSyncUrl}

            # Jazz Server Account (generate with: jazz-create-account "Proxy Server")
            JAZE2E_PROXY_SERVER_ACCOUNT=
            JAZZ_PROXY_SERVER_SECRET=

            # Jazz Client Account (generate with: jazz-create-account "Proxy Client")
            JAZZ_PROXY_CLIENT_ACCOUNT=
            JAZZ_PROXY_CLIENT_SECRET=

            # Webhook Server
            PORT=3000
            WEBHOOK_URL=http://localhost:3000/proxy-update

            # Extension ID (will be set after loading modified extension)
            EXTENSION_ID=

            # Node environment
            NODE_ENV=development
          EOF
                        
            echo "✅ Created .env file"
            echo ""
            echo "📋 Next steps:"
            echo "1. Create Jazz accounts:"
            echo "   jazz-create-account 'Proxy Server'"
            echo "   jazz-create-account 'Proxy Client'"
            echo ""
            echo "2. Copy the account IDs and secrets to .env"
            echo "3. Run 'setup-all' to complete setup"
          }
          
          # Function to create both accounts
          create-all-accounts() {
            echo "🔐 Creating all required Jazz accounts..."
            echo ""
            
            echo "=== Creating Proxy Server Account ==="
            jazz-create-account "Proxy Server"
            echo ""
            echo "Copy the above account ID and secret to:"
            echo "JAZZ_PROXY_SERVER_ACCOUNT="
            echo "JAZZ_PROXY_SERVER_SECRET="
            echo ""
            echo "Press Enter to continue..."
            read
            
            echo "=== Creating Proxy Client Account ==="
            jazz-create-account "Proxy Client"
            echo ""
            echo "Copy the above account ID and secret to:"
            echo "JAZZ_PROXY_CLIENT_ACCOUNT="
            echo "JAZZ_PROXY_CLIENT_SECRET="
            echo ""
          }
          
          # Complete setup function
          setup-all() {
            echo "🚀 Running complete setup..."
            
            # Check if .env exists
            if [ ! -f .env ]; then
              echo "❌ No .env file found. Running setup-env first..."
              setup-env
              echo ""
              echo "⚠️  Please fill in the Jazz account credentials in .env"
              echo "   Then run 'setup-all' again"
              return 1
            fi
            
            # Check if credentials are set
            source .env
            if [ -z "$JAZZ_PROXY_SERVER_ACCOUNT" ] || [ -z "$JAZZ_PROXY_CLIENT_ACCOUNT" ]; then
              echo "❌ Jazz credentials not set in .env"
              echo "   Please run: create-all-accounts"
              echo "   Then add the credentials to .env"
              return 1
            fi
            
            # Install dependencies
            echo "📦 Installing dependencies..."
            pnpm install
            
            # Clean previous builds
            echo "🧹 Cleaning previous builds..."
            rm -rf .modified-extension proxy-data e2e/v2ray-configs
            
            # Modify extension
            echo "🔧 Modifying extension..."
            pnpm modify-extension
            
            echo ""
            echo "✅ Setup complete!"
            echo ""
            echo "📋 Next steps:"
            echo "1. Load the modified extension:"
            echo "   - Open chrome://extensions"
            echo "   - Enable Developer mode"
            echo "   - Load unpacked -> select .modified-extension"
            echo ""
            echo "2. Copy the extension ID to .env"
            echo ""
            echo "3. Start the servers:"
            echo "   start-servers"
          }
          
          # Function to start all servers
          start-servers() {
            echo "🚀 Starting all servers..."
            
            # Check environment
            if [ ! -f .env ]; then
                echo "❌ No .env file found. Run: setup-env"
                return 1
            fi
            
            # Load environment
            set -a
            source .env
            set +a
            
            # Create logs directory
            mkdir -p logs
            
            # Start with PM2
            pm2 delete all 2>/dev/null || true
            pm2 start ecosystem.config.cjs
            pm2 logs
            }
          
          # Function to check status
          check-status() {
            echo "📊 Checking system status..."
            echo ""
            
            # Check .env
            if [ -f .env ]; then
              echo "✅ .env file exists"
              source .env
              
              # Check credentials
              if [ -n "$JAZZ_PROXY_SERVER_ACCOUNT" ]; then
                echo "✅ Jazz server account configured"
              else
                echo "❌ Jazz server account not configured"
              fi
              
              if [ -n "$JAZZ_PROXY_CLIENT_ACCOUNT" ]; then
                echo "✅ Jazz client account configured"
              else
                echo "❌ Jazz client account not configured"
              fi
            else
              echo "❌ .env file not found"
            fi
            
            # Check modified extension
            if [ -d ".modified-extension" ]; then
              echo "✅ Modified extension exists"
            else
              echo "❌ Modified extension not found"
            fi
            
            # Check PM2 status
            echo ""
            echo "📋 PM2 Status:"
            pm2 list
            
            # Check log files
            echo ""
            echo "📜 Recent server logs:"
            tail -n 10 logs/jazz-proxy-out.log || echo "No output log."
            echo ""
            echo "📜 Recent server errors:"
            tail -n 10 logs/jazz-proxy-error.log || echo "No error log."
          }
        '';

      in
      {
        devShells = {
          default = pkgs.mkShell {
            buildInputs = with pkgs; [
              nodejs_20
              nodePackages.pnpm
              unzip
              zip
              curl
              jq
              pm2
            ];

            shellHook = ''
              ${setupScripts}
              
              echo "✅ Prismai Jazz Environment Ready"
              echo ""
              echo "Common Commands:"
              echo "  setup-env            - Create a new .env file"
              echo "  create-all-accounts  - Interactively create Jazz accounts"
              echo "  setup-all            - Install dependencies and build the extension"
              echo "  start-servers        - Start the Jazz proxy server with PM2"
              echo "  check-status         - Check the status of all components"
              echo ""
            '';
          };
        };
      }
    );
}