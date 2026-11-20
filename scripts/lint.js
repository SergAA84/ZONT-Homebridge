'use strict';

// Syntax-checks every tracked JavaScript file with `node --check`.
// Using a script (instead of a hand-maintained file list in package.json)
// ensures newly added source/test files are always linted.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Script } = require('node:vm');

const ROOT = path.join(__dirname, '..');
// Recurse only into source/test directories, never local dependencies.
const SCAN_DIRS = ['', 'lib', 'homebridge-ui', 'test', 'scripts'];

function collectJsFiles() {
  const files = [];

  function visit(dir, recursive) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) {
      return;
    }

    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.isDirectory() && recursive) {
        visit(path.join(dir, entry.name), true);
      }
      if (!entry.isFile() || !entry.name.endsWith('.js')) {
        continue;
      }

      const rel = path.join(dir, entry.name);
      files.push(rel);
    }
  }
  for (const dir of SCAN_DIRS) visit(dir, dir !== '');

  return files.sort();
}

function main() {
  const files = collectJsFiles();
  if (files.length === 0) {
    console.error('No JavaScript files found to lint.');
    process.exit(1);
  }

  let failures = 0;

  for (const file of files) {
    try {
      execFileSync(process.execPath, ['--check', file], { cwd: ROOT, stdio: 'pipe' });
    } catch (error) {
      failures += 1;
      const output = error.stderr ? error.stderr.toString() : error.message;
      console.error(`Syntax error in ${file}:\n${output}`);
    }
  }

  const uiPath = 'homebridge-ui/public/index.html';
  const html = fs.readFileSync(path.join(ROOT, uiPath), 'utf8');
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      new Script(match[1], { filename: uiPath });
    } catch (error) {
      failures += 1;
      console.error(`Syntax error in ${uiPath}: ${error.message}`);
    }
  }

  if (failures > 0) {
    console.error(`Lint failed: ${failures} file(s) with syntax errors.`);
    process.exit(1);
  }

  console.log(`Lint OK: checked ${files.length} JavaScript files and inline UI scripts.`);
}

main();
