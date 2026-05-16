import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import esbuild from 'esbuild';
import zlib from 'zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The files in your source directory to copy into each dist folder
const SOURCE_FILES = [
  'background.js',
  'icon-16.png',
  'icon-48.png',
  'icon-128.png',
  'spyglass-styles.css'
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
    } else if (Array.isArray(base[key]) && Array.isArray(override[key])) {
      // Use a Set to completely strip out any duplicate values during array concatenation
      result[key] = [...new Set(base[key].concat(override[key]))];
    } else {
      // Primitives and other array cases: override wins outright
      result[key] = override[key];
    }
  }
  return result;
}

async function zipDirectory(sourceDir, outPath) {
  const files = [];
  
  function getFilesRecursively(dir) {
    fs.readdirSync(dir).forEach(file => {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        getFilesRecursively(fullPath);
      } else {
        files.push(fullPath);
      }
    });
  }
  
  getFilesRecursively(sourceDir);

  const zipFile = fs.createWriteStream(outPath);

  // Helper to calculate DOS date/time format required by ZIP specs
  const getDosTime = (date) => {
    return ((date.getFullYear() - 1980) << 25) |
           ((date.getMonth() + 1) << 21) |
           (date.getDate() << 16) |
           (date.getHours() << 11) |
           (date.getMinutes() << 5) |
           (date.getSeconds() >> 1);
  };

  const localHeaders = [];
  const centralDirectoryHeaders = [];
  let currentOffset = 0;

  for (const filePath of files) {
    const relativePath = path.relative(sourceDir, filePath).replace(/\\/g, '/');
    const content = fs.readFileSync(filePath);
    const compressedContent = zlib.deflateRawSync(content, { level: 9 });
    
    const now = new Date();
    const dosTime = getDosTime(now);
    const pathBuffer = Buffer.from(relativePath, 'utf-8');
    
    // Calculate CRC32 checksum via a quick buffer calculation loop
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < content.length; i++) {
      crc ^= content[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    crc = (crc ^ 0xFFFFFFFF) >>> 0;

    // --- Create Local File Header (LFH) ---
    const lfh = Buffer.alloc(30 + pathBuffer.length);
    lfh.writeUInt32LE(0x04034b50, 0);       // LFH Signature
    lfh.writeUInt16LE(20, 4);               // Version needed to extract
    lfh.writeUInt16LE(0, 6);                // General purpose bit flag
    lfh.writeUInt16LE(8, 8);                // Compression method (Deflate)
    lfh.writeUInt32LE(dosTime, 10);         // Last mod file time/date
    lfh.writeUInt32LE(crc, 14);             // CRC-32
    lfh.writeUInt32LE(compressedContent.length, 18); // Compressed size
    lfh.writeUInt32LE(content.length, 22);   // Uncompressed size
    lfh.writeUInt16LE(pathBuffer.length, 26); // File name length
    lfh.writeUInt16LE(0, 28);               // Extra field length
    pathBuffer.copy(lfh, 30);

    zipFile.write(lfh);
    zipFile.write(compressedContent);

    // --- Queue Central Directory Header (CDH) ---
    const cdh = Buffer.alloc(46 + pathBuffer.length);
    cdh.writeUInt32LE(0x02014b50, 0);       // CDH Signature
    cdh.writeUInt16LE(20, 4);               // Version made by
    cdh.writeUInt16LE(20, 6);               // Version needed to extract
    cdh.writeUInt16LE(0, 8);                // General purpose bit flag
    cdh.writeUInt16LE(8, 10);               // Compression method
    cdh.writeUInt32LE(dosTime, 12);         // Last mod file time/date
    cdh.writeUInt32LE(crc, 16);             // CRC-32
    cdh.writeUInt32LE(compressedContent.length, 20); // Compressed size
    cdh.writeUInt32LE(content.length, 24);   // Uncompressed size
    cdh.writeUInt16LE(pathBuffer.length, 28); // File name length
    cdh.writeUInt16LE(0, 30);               // Extra field length
    cdh.writeUInt16LE(0, 32);               // File comment length
    cdh.writeUInt16LE(0, 34);               // Disk number start
    cdh.writeUInt16LE(0, 36);               // Internal file attributes
    cdh.writeUInt32LE(0, 38);               // External file attributes
    cdh.writeUInt32LE(currentOffset, 42);   // Relative offset of local header
    pathBuffer.copy(cdh, 46);

    centralDirectoryHeaders.push(cdh);
    currentOffset += lfh.length + compressedContent.length;
  }

  // --- Write Central Directory ---
  const cdOffset = currentOffset;
  let cdSize = 0;
  for (const cdh of centralDirectoryHeaders) {
    zipFile.write(cdh);
    cdSize += cdh.length;
  }

  // --- Write End of Central Directory (EOCD) ---
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);        // EOCD Signature
  eocd.writeUInt16LE(0, 4);                 // Number of this disk
  eocd.writeUInt16LE(0, 6);                 // Disk where central directory starts
  eocd.writeUInt16LE(files.length, 8);      // Number of central directory records on this disk
  eocd.writeUInt16LE(files.length, 10);     // Total number of central directory records
  eocd.writeUInt32LE(cdSize, 12);           // Size of central directory
  eocd.writeUInt32LE(cdOffset, 16);         // Offset of central directory layout
  eocd.writeUInt16LE(0, 20);                // Comment length

  zipFile.write(eocd);
  
  return new Promise((resolve) => {
    zipFile.end(() => resolve());
  });
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
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'spyglass.js')],
    bundle: true,
    format: 'iife',
    outfile: path.join(distDir, 'spyglass.js'),
  });
  console.log(`  Bundled: spyglass.js`);

  // Write merged manifest
  fs.writeFileSync(
    path.join(distDir, 'manifest.json'),
    JSON.stringify(merged, null, 2)
  );
  console.log(`  Written: manifest.json (v${merged.manifest_version})`);
  console.log(`  Version: ${merged.version}`);

  // Create automated zip packages inside a dedicated deploy directory
  const deployDir = path.join(__dirname, 'deploy');
  fs.ensureDirSync(deployDir); // Makes sure the deploy folder exists

  const zipName = `spyglass-${target}.zip`;
  const zipPath = path.join(deployDir, zipName);
  await zipDirectory(distDir, zipPath);
  console.log(`  Archived: Generated deployment artifact → deploy/${zipName}`);

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
