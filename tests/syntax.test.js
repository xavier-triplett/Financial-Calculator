const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = [];

function collect(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'vendor') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collect(full);
        else if (entry.name.endsWith('.js')) files.push(full);
    }
}

collect(path.join(root, 'js'));
collect(path.join(root, 'tests'));
const serviceWorker = path.join(root, 'sw.js');
if (fs.existsSync(serviceWorker)) files.push(serviceWorker);

for (const file of files) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const authBundle = fs.readFileSync(
    path.join(root, 'js', 'vendor', 'firebase-auth-compat.js'),
    'utf8'
);

if (authBundle.includes('https://apis.google.com') &&
    !/script-src[^;]*https:\/\/apis\.google\.com/.test(index)) {
    throw new Error('CSP must allow the Firebase Auth Google API resolver');
}
if (!/object-src 'none'/.test(index) || !/base-uri 'none'/.test(index)) {
    throw new Error('CSP must disable object embedding and base URL rewriting');
}

console.log(`SYNTAX PASS (${files.length} files)`);
