import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function packageTarget(target) {
  const distDir = path.join(__dirname, 'dist', target);

  if (!fs.existsSync(distDir)) {
    console.error(`  ERROR: dist/${target}/ not found. Run "npm run build:${target}" first.`);
    process.exit(1);
  }

  // Read version from the built manifest
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  );
  const version = manifest.version;
  const zipName = `spyglass-${target}-${version}.zip`;
  const zipPath = path.join(__dirname, zipName);

  // Remove old zip if it exists
  if (fs.existsSync(zipPath)) {
    fs.removeSync(zipPath);
  }

  // Create zip (using the system zip command)
  execSync(`zip -rj "${zipPath}" "${distDir}"/*`);

  console.log(`✓ Packaged: ${zipName}`);
}

const target = process.env.TARGET;

if (target === 'chrome' || target === 'firefox') {
  packageTarget(target);
} else {
  packageTarget('chrome');
  packageTarget('firefox');
  console.log('\n✓ All packages ready for upload!');
}
