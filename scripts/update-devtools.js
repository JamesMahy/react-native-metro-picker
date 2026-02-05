#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PACKAGE = '@react-native/debugger-frontend';
const DEST = path.resolve(__dirname, '..', 'devtools');

// Parse --version flag (default: latest)
let version = 'latest';
const vIdx = process.argv.indexOf('--version');
if (vIdx !== -1 && process.argv[vIdx + 1]) {
  version = process.argv[vIdx + 1];
}

if (!/^[\w.\-^~>=<]+$/.test(version)) {
  console.error('Invalid version specifier: ' + version);
  process.exit(1);
}

const spec = `${PACKAGE}@${version}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-devtools-'));

try {
  console.log(`Packing ${spec}...`);
  execFileSync('npm', ['pack', spec, '--pack-destination', tmpDir], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Find the tarball npm produced in the temp directory
  const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.tgz'));
  if (files.length === 0) {
    throw new Error('npm pack did not produce a tarball');
  }
  const tarball = path.join(tmpDir, files[0]);

  // Remove old devtools directory
  if (fs.existsSync(DEST)) {
    fs.rmSync(DEST, { recursive: true });
  }
  fs.mkdirSync(DEST, { recursive: true });

  console.log('Extracting...');
  execFileSync('tar', ['xzf', tarball, '--strip-components=1', '-C', DEST], {
    stdio: 'pipe',
  });

  // Read extracted package.json to report version
  const pkg = JSON.parse(
    fs.readFileSync(path.join(DEST, 'package.json'), 'utf8')
  );
  console.log(`Installed ${PACKAGE}@${pkg.version} into devtools/`);
} catch (err) {
  console.error(`Failed to install ${spec}: ${err.message}`);
  if (err.stderr) console.error(err.stderr.toString().trim());
  process.exit(1);
} finally {
  // Clean up temp directory
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
