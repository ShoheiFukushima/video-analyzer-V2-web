/**
 * Favicon PNG Generation Script
 *
 * Usage:
 *   npm install sharp --save-dev
 *   node scripts/generate-favicons.js
 *
 * Generates multiple PNG sizes from SVG favicon
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const inputSvg = path.join(__dirname, '../public/favicon.svg');
const outputDir = path.join(__dirname, '../public');

const sizes = [
  { name: 'favicon-16x16.png', size: 16 },
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'favicon-48x48.png', size: 48 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'android-chrome-192x192.png', size: 192 },
  { name: 'android-chrome-512x512.png', size: 512 },
];

async function generateFavicons() {
  console.log('🎨 Generating favicons from SVG...\n');

  if (!fs.existsSync(inputSvg)) {
    console.error('❌ Error: favicon.svg not found at', inputSvg);
    process.exit(1);
  }

  for (const { name, size } of sizes) {
    try {
      const outputPath = path.join(outputDir, name);
      await sharp(inputSvg)
        .resize(size, size)
        .png()
        .toFile(outputPath);
      console.log(`✅ Generated: ${name} (${size}x${size})`);
    } catch (error) {
      console.error(`❌ Failed to generate ${name}:`, error.message);
    }
  }

  console.log('\n🎉 Favicon generation complete!');
  console.log('\nNext steps:');
  console.log('1. Verify files in public/ directory');
  console.log('2. Run: npm run dev');
  console.log('3. Open: http://localhost:3000');
  console.log('4. Check browser tab for favicon');
}

generateFavicons().catch(console.error);
