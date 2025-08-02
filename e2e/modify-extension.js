// e2e/modify-extension.js
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTENSION_ZIP = 'hide-me-Chrome-Chrome.zip';
const MODIFIED_DIR = '.modified-extension';

async function modifyExtension() {
  console.log('🎷 Modifying extension with bundled Jazz...');

  // 1. Clean previous build
  if (fs.existsSync(MODIFIED_DIR)) {
    fs.rmSync(MODIFIED_DIR, { recursive: true });
  }

  // 2. Extract original extension
  fs.mkdirSync(MODIFIED_DIR);
  const zip = new AdmZip(EXTENSION_ZIP);
  zip.extractAllTo(MODIFIED_DIR, true);
  
  // 3. Bundle the Jazz-enabled background script
  console.log('📦 Bundling Jazz integration...');
  try {
    execSync('pnpm bundle-extension', { stdio: 'inherit' });
  } catch (e) {
    console.error('❌ Bundling failed');
    process.exit(1);
  }

  // 4. Replace background script
  const manifestPath = path.join(MODIFIED_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  
  const bgScript = manifest.background?.service_worker ||
                   manifest.background?.scripts?.[0] || 'main.js';
  
  const bundledPath = path.join(MODIFIED_DIR, 'bundled-background.js');
  const targetPath = path.join(MODIFIED_DIR, bgScript);
  
  fs.renameSync(bundledPath, targetPath);
  console.log(`✅ Replaced ${bgScript} with bundled version`);

  // 5. Add options page
  const optionsHtml = fs.readFileSync(
    path.join(__dirname, 'extension-src/options.html'), 'utf8'
  );
  const optionsJs = fs.readFileSync(
    path.join(__dirname, 'extension-src/options.js'), 'utf8'
  );
  
  fs.writeFileSync(path.join(MODIFIED_DIR, 'options.html'), optionsHtml);
  fs.writeFileSync(path.join(MODIFIED_DIR, 'options.js'), optionsJs);

  // 6. Update manifest
  manifest.permissions = manifest.permissions || [];
  if (!manifest.permissions.includes('storage')) {
    manifest.permissions.push('storage');
  }
  manifest.options_page = 'options.html';
  
  // 7. Fix CSP for WASM support
  if (manifest.manifest_version === 3) {
    // For Manifest V3
    manifest.content_security_policy = manifest.content_security_policy || {};
    manifest.content_security_policy.extension_pages =
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'";
  } else {
    // For Manifest V2
    manifest.content_security_policy =
      "script-src 'self' 'unsafe-eval'; object-src 'self'";
  }
  
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  
  console.log('✅ Extension modified successfully!');
  console.log(`📁 Modified extension in: ${path.resolve(MODIFIED_DIR)}`);
  console.log('\n📋 Next steps:');
  console.log('1. Load extension in Chrome');
  console.log('2. Configure Jazz in extension options');
  console.log('3. Start local Jazz server: pnpm start-local-server');
}

modifyExtension().catch(console.error);
