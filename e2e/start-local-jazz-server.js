// e2e/start-local-jazz-server.js
import { spawn } from 'child_process';

console.log('🎷 Starting local Jazz sync server...');

const server = spawn('npx', ['jazz-run', 'sync', '--port', '4200'], {
  stdio: 'inherit',
  shell: true
});

server.on('error', (error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});

server.on('close', (code) => {
  console.log(`Server exited with code ${code}`);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n⏹️  Stopping server...');
  server.kill();
  process.exit(0);
});
