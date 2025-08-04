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
    // Note: The bundle script now outputs to 'jazz-integration.js'
    execSync('pnpm bundle-extension', { stdio: 'inherit' });
  } catch (e) {
    console.error('❌ Bundling failed');
    process.exit(1);
  }

  // 4. INJECT the script into background.html
  const manifestPath = path.join(MODIFIED_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // Check if the extension uses a background page
  if (manifest.background && manifest.background.page) {
    const backgroundHtmlPath = path.join(MODIFIED_DIR, manifest.background.page);
    let htmlContent = fs.readFileSync(backgroundHtmlPath, 'utf8');

    // Add our script tag BEFORE other scripts to ensure it runs first
    htmlContent = htmlContent.replace(
      '<script src="javascripts/proxy.js">',
      '<script src="jazz-integration.js"></script>\\n    <script src="javascripts/proxy.js">'
    );

    fs.writeFileSync(backgroundHtmlPath, htmlContent);
    console.log(`✅ Injected jazz-integration.js into ${manifest.background.page}`);

    // Copy the bundled script to the extension directory
    fs.copyFileSync(
      path.join(__dirname, '../.modified-extension/jazz-integration.js'),
      path.join(MODIFIED_DIR, 'jazz-integration.js')
    );

  } else {
    // Fallback for service worker-based extensions (your previous logic)
    const bgScriptPath = manifest.background?.service_worker || 'main.js';
    const targetPath = path.join(MODIFIED_DIR, bgScriptPath);
    const originalScriptContent = fs.readFileSync(targetPath, 'utf8');
    const modifiedScriptContent = `
    try { importScripts('jazz-integration.js'); } 
    catch (e) { console.error('Failed to load Jazz integration:', e); } 
    ${originalScriptContent} `;
    fs.writeFileSync(targetPath, modifiedScriptContent);
    console.log(`✅ Injected jazz-integration.js into ${bgScriptPath}`);
  }


  // 5. Add options page (remains the same)
  const optionsHtml = fs.readFileSync(
    path.join(__dirname, 'extension-src/options.html'), 'utf8'
  );
  const optionsJs = fs.readFileSync(
    path.join(__dirname, 'extension-src/options.js'), 'utf8'
  );
  
  fs.writeFileSync(path.join(MODIFIED_DIR, 'options.html'), optionsHtml);
  fs.writeFileSync(path.join(MODIFIED_DIR, 'options.js'), optionsJs);

  // 6. Update manifest (remains the same)
  manifest.permissions = manifest.permissions || [];
  if (!manifest.permissions.includes('storage')) {
    manifest.permissions.push('storage');
  }
  manifest.options_page = 'options.html';
  
  // 7. Fix CSP for WASM support (remains the same)
  if (manifest.manifest_version === 3) {
    manifest.content_security_policy = manifest.content_security_policy || {};
    manifest.content_security_policy.extension_pages =
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'";
  } else {
    // This is the path that will be taken for this Manifest V2 extension
    manifest.content_security_policy =
      "script-src 'self' 'unsafe-eval'; object-src 'self'";
  }
  
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  
  console.log('✅ Extension modified successfully!');
  console.log(`📁 Modified extension in: ${path.resolve(MODIFIED_DIR)}`);
}

modifyExtension().catch(console.error);
