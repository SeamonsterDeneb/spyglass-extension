const fs = require('fs');
const { exec } = require('child_process');

const filename = process.argv[2];
const chunkNumber = parseInt(process.argv[3], 10);
const linesPerChunk = 120;

if (!filename || !chunkNumber || chunkNumber < 1) {
  console.error('Usage: node chunk.js <filename> <chunkNumber>');
  process.exit(1);
}

fs.readFile(filename, 'utf8', (err, data) => {
  if (err) {
    console.error(`Could not read file ${filename}:`, err.message);
    process.exit(1);
  }

  const lines = data.split('\n');
  const start = (chunkNumber - 1) * linesPerChunk;
  const end = start + linesPerChunk;
  const chunk = lines.slice(start, end).join('\n');

  if (!chunk) {
    console.error('No more lines to read.');
    process.exit(1);
  }

  // Copy chunk to clipboard (works on macOS, Linux with xclip/xsel, Windows with clip)
  const platform = process.platform;

  let copyCommand;
  if (platform === 'darwin') {
    copyCommand = 'pbcopy';
  } else if (platform === 'win32') {
    copyCommand = 'clip';
  } else {
    // Linux - try xclip or xsel
    copyCommand = 'xclip -selection clipboard || xsel --clipboard --input';
  }

  const child = exec(copyCommand, (copyErr) => {
    if (copyErr) {
      console.error('Failed to copy to clipboard:', copyErr);
      process.exit(1);
    } else {
      console.log(`Chunk ${chunkNumber} copied to clipboard.`);
    }
  });

  child.stdin.write(chunk);
  child.stdin.end();
});
