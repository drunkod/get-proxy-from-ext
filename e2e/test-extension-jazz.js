// e2e/test-extension-jazz.js
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testExtensionJazz() {
  console.log('🧪 Testing Jazz-enabled extension...');
  
  const extensionPath = path.join(__dirname, '..', '.modified-extension-jazz');
  
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox'
    ]
  });
  
  // Get extension ID
  const targets = await browser.targets();
  const extensionTarget = targets.find(target => 
    target.type() === 'background_page' || 
    target.type() === 'service_worker'
  );
  
  if (extensionTarget) {
    const extensionUrl = extensionTarget.url();
    const extensionId = extensionUrl.split('/')[2];
    console.log(`✅ Extension loaded with ID: ${extensionId}`);
    
    // Open options page to configure Jazz
    const optionsUrl = `chrome-extension://${extensionId}/options.html`;
    const page = await browser.newPage();
    await page.goto(optionsUrl);
    
    console.log('📋 Configure Jazz connection in the options page');
    console.log('   Use these test credentials:');
    console.log('   Account ID: test_extension_account');
    console.log('   Account Secret: test_extension_secret');
    console.log('   Server Account ID:', process.env.JAZZ_PROXY_SERVER_ACCOUNT);
    
    // Keep browser open for manual configuration
    console.log('\n⏸️  Configure and test manually. Press Ctrl+C to exit.');
    
  } else {
    console.error('❌ Could not find extension background page');
  }
}

testExtensionJazz().catch(console.error);