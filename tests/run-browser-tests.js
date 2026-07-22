const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..');
const windowsChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chrome = process.env.CHROME_PATH ||
    (process.platform === 'win32' && fs.existsSync(windowsChrome) ? windowsChrome : 'google-chrome');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'coast-ledger-chrome-'));
const cases = [
    ['smoke.html', 'smoke-result', 'SMOKE PASS'],
    ['cloud.test.html', 'out', 'CLOUD PASS'],
    ['firebase-load.test.html', 'out', 'FBLOAD PASS']
];

function chromeRun(target) {
    return new Promise((resolve) => {
        const child = spawn(chrome, [
            '--headless=new',
            '--disable-gpu',
            '--no-first-run',
            '--disable-background-networking',
            `--user-data-dir=${profile}`,
            '--virtual-time-budget=15000',
            '--dump-dom',
            target
        ]);
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { if (stdout.length < 8 * 1024 * 1024) stdout += chunk; });
        child.stderr.on('data', (chunk) => { if (stderr.length < 2 * 1024 * 1024) stderr += chunk; });
        child.on('error', (error) => resolve({ error, stdout, stderr, status: null }));
        child.on('close', (status) => resolve({ stdout, stderr, status }));
    });
}

function staticServer() {
    const misses = [];
    const server = http.createServer((request, response) => {
        let pathname;
        try { pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
        catch (error) { response.writeHead(400).end(); return; }
        if (pathname === '/') pathname = '/index.html';
        const file = path.resolve(root, `.${pathname}`);
        if (file !== root && !file.startsWith(root + path.sep)) {
            response.writeHead(403).end();
            return;
        }
        fs.readFile(file, (error, data) => {
            if (error) {
                misses.push(pathname);
                response.writeHead(404).end();
                return;
            }
            const type = pathname.endsWith('.js') ? 'text/javascript' :
                pathname.endsWith('.css') ? 'text/css' :
                    pathname.endsWith('.html') ? 'text/html' : 'application/octet-stream';
            response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
            response.end(data);
        });
    });
    return { server, misses };
}

async function main() {
    let failed = false;
    try {
        for (const [file, resultId, expected] of cases) {
            const result = await chromeRun(pathToFileURL(path.join(__dirname, file)).href);
            const expression = new RegExp(`<pre id="${resultId}"[^>]*>([\\s\\S]*?)<\\/pre>`, 'i');
            const match = result.stdout.match(expression);
            const testResult = match ? match[1].replace(/<[^>]+>/g, '').trim() : '';
            if (result.error || result.status !== 0 || !testResult.startsWith(expected)) {
                failed = true;
                console.error(`${file}: FAIL`);
                if (result.error) console.error(result.error.message);
                if (testResult) console.error(testResult);
            } else {
                console.log(`${file}: ${expected}`);
            }
        }

        const hosted = staticServer();
        await new Promise((resolve) => hosted.server.listen(0, '127.0.0.1', resolve));
        const port = hosted.server.address().port;
        const result = await chromeRun(`http://127.0.0.1:${port}/?browser-test=1`);
        await new Promise((resolve) => hosted.server.close(resolve));
        const booted = /class="[^"]*pf-shell/.test(result.stdout) &&
            result.stdout.includes('The Coast Ledger') && hosted.misses.length === 0;
        if (result.error || result.status !== 0 || !booted) {
            failed = true;
            console.error('index.html: FAIL');
            if (result.error) console.error(result.error.message);
            if (hosted.misses.length) console.error(`Missing assets: ${hosted.misses.join(', ')}`);
        } else {
            console.log('index.html: PRODUCTION PASS');
        }
    } finally {
        fs.rmSync(profile, { recursive: true, force: true });
    }
    if (failed) process.exit(1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
