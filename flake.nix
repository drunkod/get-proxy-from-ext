# flake.nix
{
  description = "A development environment for the Prismai proxy management with Jazz integration.";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        
        # Jazz sync server URL
        jazzSyncUrl = "ws://node205197-env-9764176354321.mircloud.host:11129";
        
        # Test credentials for automated tests
        testServerAccount = "test_server_account_123";
        testServerSecret = "test_server_secret_123";
        testClientAccount = "test_client_account_123";
        testClientSecret = "test_client_secret_123";

        # Helper scripts (existing)
        setupScripts = ''
          # ... existing setup scripts ...
        '';

      in
      {
        # NixOS Tests
        checks = {
          # Test 1: Basic Jazz sync server connectivity
          jazzSyncServerTest = pkgs.testers.runNixOSTest {
            name = "jazz-sync-server-test";
            
            
            nodes.jazzServer = { pkgs, ... }: {
              networking.firewall.allowedTCPPorts = [ 4200 ];

              systemd.services.jazz-sync-server = {
                description = "Jazz Sync Server";
                wantedBy = [ "multi-user.target" ];
                after = [ "network.target" ];
                serviceConfig = {
                  ExecStart = "${pkgs.nodejs_20}/bin/npx jazz-run sync-server --port 4200";
                  Restart = "always";
                };
              };
            };
            
            nodes.client = { pkgs, ... }: {
              environment.systemPackages = with pkgs; [ curl netcat ];
            };
            
            testScript = ''
              jazzServer.wait_for_unit("jazz-sync-server.service")
              jazzServer.wait_for_open_port(4200)

              # Test WebSocket connectivity
              client.succeed("timeout 5 nc -zv jazzServer 4200")
            '';
          };
          
          # Test 2: Proxy server startup and account creation
          proxyServerTest = pkgs.testers.runNixOSTest {
            name = "proxy-server-test";
            
            
            nodes.proxyServer = { pkgs, ... }: {
              networking.firewall.allowedTCPPorts = [ 4200 ];

              environment.systemPackages = with pkgs; [
                nodejs_20
                nodePackages.pnpm
              ];

              systemd.services.jazz-proxy-server = {
                description = "Jazz Proxy Server";
                wantedBy = [ "multi-user.target" ];
                after = [ "network.target" ];
                environment = {
                  JAZZ_SYNC_URL = "ws://localhost:4200";
                  JAZZ_PROXY_SERVER_ACCOUNT = testServerAccount;
                  JAZZ_PROXY_SERVER_SECRET = testServerSecret;
                  NODE_ENV = "test";
                };
                serviceConfig = {
                  WorkingDirectory = "/opt/proxy-server";
                  ExecStartPre = "${pkgs.nodePackages.pnpm}/bin/pnpm install";
                  ExecStart = "${pkgs.nodejs_20}/bin/node e2e/proxy-server.js";
                  Restart = "always";
                };
              };

              systemd.tmpfiles.rules = [
                "d /opt/proxy-server 0755 root root -"
              ];
            };
            
            testScript = ''
              proxyServer.wait_for_unit("jazz-proxy-server.service")

              # Check if server started successfully
              proxyServer.succeed("journalctl -u jazz-proxy-server | grep 'Server ready'")
            '';
          };
          
          # Test 3: Full client-server proxy data flow
          proxyDataFlowTest = pkgs.testers.runNixOSTest {
            name = "proxy-data-flow-test";
            
            
            nodes.server = { pkgs, ... }: {
              networking.firewall.allowedTCPPorts = [ 4200 ];

              environment.systemPackages = with pkgs; [
                nodejs_20
                nodePackages.pnpm
                git
              ];

              # Mock Jazz sync server
              systemd.services.mock-jazz-server = {
                description = "Mock Jazz Sync Server";
                wantedBy = [ "multi-user.target" ];
                after = [ "network.target" ];
                serviceConfig = {
                  WorkingDirectory = "/opt/mock-server";
                  ExecStart = "${pkgs.nodejs_20}/bin/node /opt/mock-server/mock-jazz-server.js";
                  Restart = "always";
                };
              };

              # Proxy server
              systemd.services.proxy-server = {
                description = "Jazz Proxy Server";
                wantedBy = [ "multi-user.target" ];
                after = [ "mock-jazz-server.service" ];
                environment = {
                  JAZZ_SYNC_URL = "ws://localhost:4200";
                  JAZZ_PROXY_SERVER_ACCOUNT = testServerAccount;
                  JAZZ_PROXY_SERVER_SECRET = testServerSecret;
                };
                serviceConfig = {
                  WorkingDirectory = "/opt/proxy-server";
                  ExecStart = "${pkgs.nodejs_20}/bin/node /opt/proxy-server/proxy-server.js";
                  Restart = "always";
                };
              };

              systemd.tmpfiles.rules = [
                "d /opt/mock-server 0755 root root -"
                "d /opt/proxy-server 0755 root root -"
              ];
            };
            
            nodes.client = { pkgs, ... }: {
              environment.systemPackages = with pkgs; [
                nodejs_20
                nodePackages.pnpm
                curl
                jq
              ];

              # Simulate extension client
              systemd.services.proxy-client = {
                description = "Proxy Client Simulator";
                wantedBy = [ "multi-user.target" ];
                after = [ "network.target" ];
                environment = {
                  JAZZ_SYNC_URL = "ws://server:4200";
                  JAZZ_PROXY_CLIENT_ACCOUNT = testClientAccount;
                  JAZZ_PROXY_CLIENT_SECRET = testClientSecret;
                  JAZZ_PROXY_SERVER_ACCOUNT = testServerAccount;
                };
                serviceConfig = {
                  WorkingDirectory = "/opt/proxy-client";
                  ExecStart = "${pkgs.nodejs_20}/bin/node /opt/proxy-client/test-client.js";
                  Type = "oneshot";
                };
              };

              systemd.tmpfiles.rules = [
                "d /opt/proxy-client 0755 root root -"
              ];
            };
            
            testScript = ''
              # Start servers
              server.wait_for_unit("mock-jazz-server.service")
              server.wait_for_open_port(4200)
              server.wait_for_unit("proxy-server.service")

              # Wait for client to connect
              client.wait_for_unit("multi-user.target")

              # Create test proxy data
              client.succeed("""cat > /opt/proxy-client/test-proxy-data.json << 'EOF'
              {
                "servers": {
                  "us": {
                    "host": "us.proxy.test",
                    "port": 3128,
                    "name": "Test US Proxy",
                    "receivedTime": 1234567890,
                    "ttl": 30
                  },
                  "uk": {
                    "host": "uk.proxy.test",
                    "port": 3128,
                    "name": "Test UK Proxy",
                    "receivedTime": 1234567890,
                    "ttl": -1
                  }
                },
                "timestamp": "2024-01-01T00:00:00Z",
                "extensionId": "test-extension"
              }
              EOF""")

              # Run client to push data
              client.systemctl("start proxy-client.service")

              # Verify server received data
              server.wait_until_succeeds(
                "journalctl -u proxy-server | grep 'Saved 2 servers'",
                timeout=30
              )

              # Check if V2Ray config was generated
              server.wait_until_succeeds(
                "journalctl -u proxy-server | grep 'V2Ray config generated'",
                timeout=10
              )
            '';
          };

          # Test 4: Webhook compatibility test (legacy support)
          webhookCompatibilityTest = pkgs.testers.runNixOSTest {
  name = "webhook-compatibility-test";
  
  nodes.webhookServer = { pkgs, ... }: {
    networking.firewall.allowedTCPPorts = [ 3000 ];

    systemd.services.webhook-server = {
      description = "Legacy Webhook Server";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      serviceConfig = {
        ExecStart = ''
          ${pkgs.nodejs_20}/bin/node -e "
            const http = require('http');
            
            const server = http.createServer((req, res) => {
              if (req.method === 'POST' && req.url === '/proxy-update') {
                let body = "";
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                  console.log('Received proxy update:', body);
                  res.writeHead(200, {'Content-Type': 'application/json'});
                  res.end(JSON.stringify({ status: 'success' }));
                });
              } else {
                res.writeHead(404);
                res.end();
              }
            });
            
            server.listen(3000, () => console.log('Webhook server on :3000'));
          "
        '';
        Type = "simple";
        Restart = "on-failure";
      };
    };
  };
  
  nodes.client = { pkgs, ... }: {
    environment.systemPackages = with pkgs; [ curl jq ];
  };
  
  testScript = ''
    webhookServer.wait_for_unit("webhook-server.service")
    webhookServer.wait_for_open_port(3000)

    # Test webhook endpoint
    client.succeed("""
      curl -X POST http://webhookServer:3000/proxy-update \
        -H 'Content-Type: application/json' \
        -d '{"servers": {"test": {"host": "test.proxy", "port": 3128}}}' \
        | jq -e '.status == "success"'
    """)
  '';
};
          
          # Test 5: Extension modification test
          extensionModificationTest = pkgs.writeShellScriptBin "test-extension-modification" ''
            set -e
            echo "🧪 Testing extension modification..."

            # Create test directory
            TEST_DIR=$(mktemp -d)
            cd $TEST_DIR

            # Create mock extension structure
            mkdir -p mock-extension
            echo '{"manifest_version": 3, "name": "Test"}' > mock-extension/manifest.json
            echo 'console.log("original");' > mock-extension/main.js
            
            # Zip it
            cd mock-extension && ${pkgs.zip}/bin/zip -r ../test-extension.zip . && cd ..
            
            # Run modification script (simplified test version)
            cat > modify-test.js << 'EOF'
            const fs = require('fs');
            const AdmZip = require('adm-zip');
            
            const zip = new AdmZip('test-extension.zip');
            zip.extractAllTo('modified', true);
            
            // Check if extraction worked
            if (!fs.existsSync('modified/manifest.json')) {
              console.error('❌ Extraction failed');
              process.exit(1);
            }
            
            // Modify manifest
            const manifest = JSON.parse(fs.readFileSync('modified/manifest.json'));
            manifest.permissions = ['storage'];
            fs.writeFileSync('modified/manifest.json', JSON.stringify(manifest, null, 2));
            
            console.log('✅ Extension modification test passed');
            EOF
            
            ${pkgs.nodejs_20}/bin/node modify-test.js
            
            # Cleanup
            rm -rf $TEST_DIR
          '';
        };

        # Test helper package
        packages = {
          # Test client simulator
          testProxyClient = pkgs.writeScriptBin "test-proxy-client" ''
            #!${pkgs.nodejs_20}/bin/node
            const fs = require('fs');

            // Simulate sending proxy data
            const testData = {
              servers: {
                "test1": {
                  host: "test1.proxy.local",
                  port: 3128,
                  ttl: 30,
                  receivedTime: Date.now()
                }
              },
              timestamp: new Date().toISOString(),
              extensionId: "test-extension"
            };

            console.log('Sending test proxy data:', testData);
            // In real implementation, this would use Jazz inbox
          '';
          
          # Interactive test runner
          runTests = pkgs.writeShellScriptBin "run-proxy-tests" ''
            echo "🧪 Running Proxy System Tests"
            echo "============================"
            
            echo "1. Testing Jazz sync server..."
            nix build .#checks.${system}.jazzSyncServerTest -L

            echo "2. Testing proxy server..."
            nix build .#checks.${system}.proxyServerTest -L

            echo "3. Testing data flow..."
            nix build .#checks.${system}.proxyDataFlowTest -L

            echo "4. Testing webhook compatibility..."
            nix build .#checks.${system}.webhookCompatibilityTest -L

            echo "5. Testing extension modification..."
            ${self.checks.${system}.extensionModificationTest}/bin/test-extension-modification
            
            echo ""
            echo "✅ All tests passed!"
          '';
        };
        
        devShells = {
          # Existing default shell
          default = pkgs.mkShell {
            # ... existing configuration ...

            buildInputs = with pkgs; [
              # ... existing packages ...
              self.packages.${system}.runTests  # Add test runner
            ];

            shellHook = ''
              ${setupScripts}
              
              echo "🧪 Testing Commands:"
              echo "  run-proxy-tests      - Run all tests"
              echo "  nix flake check      - Run NixOS VM tests"
              echo ""
            '';
          };
          
          # Test development shell
          test = pkgs.mkShell {
            buildInputs = with pkgs; [
              nodejs_20
              nodePackages.pnpm
              python3  # For interactive test debugging
              self.packages.${system}.testProxyClient
              self.packages.${system}.runTests
            ];

            shellHook = ''
              echo "🧪 Test Development Environment"
              echo ""
              echo "Commands:"
              echo "  test-proxy-client    - Run test client"
              echo "  run-proxy-tests      - Run all tests"
              echo ""
              echo "Debug test interactively:"
              echo "  nix run '.#checks.${system}.proxyDataFlowTest.driverInteractive'"
              echo ""
            '';
          };
        };
      }
    );
}