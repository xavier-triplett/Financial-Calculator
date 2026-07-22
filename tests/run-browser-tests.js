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
const swProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'coast-ledger-sw-chrome-'));
const cases = [
    ['smoke.html', 'smoke-result', 'SMOKE PASS'],
    ['cloud.test.html', 'out', 'CLOUD PASS'],
    ['firebase-load.test.html', 'out', 'FBLOAD PASS']
];

function chromeRun(target, profilePath = profile, budget = 15000) {
    return new Promise((resolve) => {
        const args = [
            '--headless=new',
            '--disable-gpu',
            '--no-first-run',
            '--disable-background-networking',
            `--user-data-dir=${profilePath}`,
            `--virtual-time-budget=${budget}`,
            '--dump-dom',
            target
        ];
        const child = spawn(chrome, args);
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { if (stdout.length < 8 * 1024 * 1024) stdout += chunk; });
        child.stderr.on('data', (chunk) => { if (stderr.length < 2 * 1024 * 1024) stderr += chunk; });
        child.on('error', (error) => resolve({ error, stdout, stderr, status: null }));
        child.on('close', (status) => resolve({ stdout, stderr, status }));
    });
}

function connectCdp(url) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        const pending = new Map();
        let nextId = 1;
        socket.addEventListener('open', () => {
            resolve({
                send(method, params = {}) {
                    const id = nextId++;
                    socket.send(JSON.stringify({ id, method, params }));
                    return new Promise((resolveCall, rejectCall) => {
                        pending.set(id, { resolve: resolveCall, reject: rejectCall });
                    });
                },
                close() { socket.close(); }
            });
        }, { once: true });
        socket.addEventListener('error', () => reject(new Error('Could not connect to Chrome DevTools')), { once: true });
        socket.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            if (!message.id || !pending.has(message.id)) return;
            const call = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) call.reject(new Error(message.error.message));
            else call.resolve(message.result);
        });
    });
}

async function chromeCdpRun(target, profilePath, timeout = 30000) {
    const child = spawn(chrome, [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        `--user-data-dir=${profilePath}`,
        '--remote-debugging-port=0',
        'about:blank'
    ]);
    let stderr = '';
    let readyResolve;
    let readyReject;
    const ready = new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
    });
    const startupTimer = setTimeout(() => readyReject(new Error('Chrome DevTools did not start')), 10000);
    child.stderr.on('data', (chunk) => {
        stderr += chunk;
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
            clearTimeout(startupTimer);
            readyResolve(match[1]);
        }
    });
    child.on('error', readyReject);

    let client;
    try {
        const browserUrl = await ready;
        const debugUrl = new URL(browserUrl);
        const page = await fetch(
            `http://${debugUrl.host}/json/new?${encodeURIComponent(target)}`,
            { method: 'PUT' }
        ).then((response) => response.json());
        client = await connectCdp(page.webSocketDebuggerUrl);
        await client.send('Runtime.enable');
        const deadline = Date.now() + timeout;
        let output = '';
        while (Date.now() < deadline) {
            const evaluated = await client.send('Runtime.evaluate', {
                expression: "document.getElementById('out')?.textContent || ''",
                returnByValue: true
            });
            output = evaluated.result.value || '';
            if (/^SW (?:PASS|FAIL)/.test(output)) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const html = await client.send('Runtime.evaluate', {
            expression: 'document.documentElement.outerHTML',
            returnByValue: true
        });
        await client.send('Browser.close').catch(() => {});
        return { stdout: html.result.value || '', stderr, status: /^SW PASS/.test(output) ? 0 : 1 };
    } catch (error) {
        return { error, stdout: '', stderr, status: null };
    } finally {
        clearTimeout(startupTimer);
        if (client) client.close();
        if (!child.killed) child.kill();
    }
}

function staticServer() {
    const misses = [];
    let offline = false;
    let probe = 0;
    const server = http.createServer((request, response) => {
        let pathname;
        try { pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
        catch (error) { response.writeHead(400).end(); return; }
        if (pathname === '/__sw_probe__') {
            response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
            response.end(`probe-v${++probe}`);
            return;
        }
        if (pathname === '/__sw_offline__') {
            response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
            response.end('offline', function () { offline = true; });
            return;
        }
        if (offline) {
            request.socket.destroy();
            return;
        }
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

        const swResult = await chromeCdpRun(
            `http://127.0.0.1:${port}/tests/service-worker.test.html`,
            swProfile,
            30000
        );
        const swMatch = swResult.stdout.match(/<pre id="out"[^>]*>([\s\S]*?)<\/pre>/i);
        const swOutput = swMatch ? swMatch[1].replace(/<[^>]+>/g, '').trim() : '';
        if (swResult.error || swResult.status !== 0 || !swOutput.startsWith('SW PASS')) {
            failed = true;
            console.error('service-worker.test.html: FAIL');
            if (swResult.error) console.error(swResult.error.message);
            if (swOutput) console.error(swOutput);
            if (swResult.stderr) console.error(swResult.stderr.slice(-4000));
        } else {
            console.log('service-worker.test.html: SW PASS');
        }
        await new Promise((resolve) => hosted.server.close(resolve));
    } finally {
        fs.rmSync(profile, { recursive: true, force: true });
        fs.rmSync(swProfile, { recursive: true, force: true });
    }
    if (failed) process.exit(1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
