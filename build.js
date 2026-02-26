import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The files in your source directory to copy into each dist folder
const SOURCE_FILES = [
  'background.js',
  'spyglass.js',
  'icon-16.png',
  'icon-48.png',
  'icon-128.png'
];

function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      override[key] !== null &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      // Arrays and primitives: override wins outright
      result[key] = override[key];
    }
  }
  return result;
}

async function build(target) {
  console.log(`\nBuilding ${target}...`);

  const distDir = path.join(__dirname, 'dist', target);

  // Load manifests
  const shared = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.shared.json'), 'utf8'));
  const specific = JSON.parse(fs.readFileSync(path.join(__dirname, `manifest.${target}.json`), 'utf8'));

  // Merge: shared fields first, then browser-specific fields win
  const merged = deepMerge(shared, specific);

  // Clean and recreate dist folder
  fs.emptyDirSync(distDir);

  // Copy source files
  for (const file of SOURCE_FILES) {
    const src = path.join(__dirname, file);
    const dest = path.join(distDir, file);
    if (fs.existsSync(src)) {
      fs.copySync(src, dest);
      console.log(`  Copied: ${file}`);
    } else {
      console.warn(`  WARNING: Source file not found, skipping: ${file}`);
    }
  }

  // Write merged manifest
  fs.writeFileSync(
    path.join(distDir, 'manifest.json'),
    JSON.stringify(merged, null, 2)
  );
  console.log(`  Written: manifest.json (v${merged.manifest_version})`);
  console.log(`  Version: ${merged.version}`);
  console.log(`✓ ${target} build complete → dist/${target}/`);
}

// Determine which targets to build
const target = process.env.TARGET;

if (target === 'chrome' || target === 'firefox') {
  build(target).catch(err => {
    console.error(`Build failed:`, err);
    process.exit(1);
  });
} else {
  // Build both
  Promise.all([build('chrome'), build('firefox')])
    .then(() => console.log('\n✓ All builds complete!'))
    .catch(err => {
      console.error(`Build failed:`, err);
      process.exit(1);
    });
}
