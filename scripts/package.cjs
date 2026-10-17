// File: Builds the reviewable application archive once and records exactly which files it contains.
const fs = require('node:fs');
const path = require('node:path');
const { ZipArchive } = require('archiver');

const root = path.resolve(__dirname, '..');
const artifactDirectory = path.join(root, 'artifacts');
const archivePath = path.join(artifactDirectory, 'quackloan.zip');
const sbomPath = path.join(artifactDirectory, 'quackloan-sbom.json');

const files = [
  ['backend/src', 'backend/src'],
  ['backend/package.json', 'backend/package.json'],
  ['backend/package-lock.json', 'backend/package-lock.json'],
  ['frontend/dist', 'frontend/dist'],
  ['frontend/package.json', 'frontend/package.json'],
  ['frontend/package-lock.json', 'frontend/package-lock.json'],
  ['README.md', 'README.md'],
];

function resolveFiles() {
  const missing = files.filter(([source]) => !fs.existsSync(path.join(root, source)));
  if (missing.length > 0) {
    throw new Error(`Cannot package because these paths are missing: ${missing.map(([source]) => source).join(', ')}`);
  }
}

function expandFiles() {
  return files.flatMap(([source, destination]) => {
    const sourcePath = path.join(root, source);
    if (!fs.statSync(sourcePath).isDirectory()) return [[sourcePath, destination]];
    const entries = [];
    function visit(directory, prefix) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        const entryDestination = path.join(prefix, entry.name);
        if (entry.isDirectory()) visit(entryPath, entryDestination);
        else entries.push([entryPath, entryDestination]);
      }
    }
    visit(sourcePath, destination);
    return entries;
  });
}

async function createArchive() {
  resolveFiles();
  const archiveFiles = expandFiles();
  fs.mkdirSync(artifactDirectory, { recursive: true });
  if (fs.existsSync(archivePath)) fs.rmSync(archivePath);
  if (fs.existsSync(sbomPath)) fs.rmSync(sbomPath);

  const output = fs.createWriteStream(archivePath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const completion = new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
  });
  archive.pipe(output);
  for (const [source, destination] of archiveFiles) {
    archive.file(source, { name: destination.split(path.sep).join('/') });
  }
  await archive.finalize();
  await completion;

  const sbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    component: { type: 'application', name: 'quackloan', version: '0.1.0' },
    metadata: { timestamp: new Date().toISOString(), tools: [{ vendor: 'ConnectSphere', name: 'package.cjs' }] },
    components: archiveFiles.map(([source, destination]) => ({
      type: 'file',
      name: destination.split(path.sep).join('/'),
      version: 'included',
      hashes: [{ alg: 'SHA-256', content: require('node:crypto').createHash('sha256').update(fs.readFileSync(source)).digest('hex') }],
    })),
  };
  fs.writeFileSync(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`);
  console.log(`Created ${path.relative(root, archivePath)} and ${path.relative(root, sbomPath)}`);
}

createArchive().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
