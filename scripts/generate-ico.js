/**
 * Generate favicon.ico from PNG files
 *
 * Usage: node scripts/generate-ico.js
 */

const toIco = require('to-ico');
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '../public');

const pngFiles = [
  path.join(publicDir, 'favicon-16x16.png'),
  path.join(publicDir, 'favicon-32x32.png'),
  path.join(publicDir, 'favicon-48x48.png'),
];

async function generateIco() {
  console.log('🎨 Generating favicon.ico...\n');

  try {
    const buffers = pngFiles.map(file => {
      if (!fs.existsSync(file)) {
        throw new Error(`File not found: ${file}`);
      }
      return fs.readFileSync(file);
    });

    const ico = await toIco(buffers);
    const outputPath = path.join(publicDir, 'favicon.ico');
    fs.writeFileSync(outputPath, ico);

    console.log('✅ Generated: favicon.ico (16x16, 32x32, 48x48)');
    console.log('\n🎉 favicon.ico generation complete!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

generateIco();
