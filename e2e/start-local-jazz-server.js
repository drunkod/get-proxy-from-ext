// e2e/start-local-jazz-server.js
import { execSync } from 'child_process';

console.log('🎷 Starting local Jazz sync server...');

try {
  // Start local Jazz server on port 4200
  execSync('npx jazz-run sync-server --port 4200', {
    stdio: 'inherit'
  });
} catch (error) {
  console.error('❌ Failed to start Jazz server:', error);
  console.log('\n💡 Try installing Jazz CLI globally:');
  console.log('   npm install -g jazz-run');
  console.log('   jazz-run sync-server --port 4200');
}
