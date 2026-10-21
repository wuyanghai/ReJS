import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
test('真实浏览器：CDP 原 URL 200、项目 UI、模块脚本、隔离、SRI 诊断、停用恢复', { timeout:120000 }, async () => {
  const original = "document.body.dataset.result='original'";
  const digest = createHash('sha256').update(original).digest('base64');
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control','no-store');
    if (req.url.startsWith('/unrelated.js')) { res.setHeader('Content-Type','text/javascript'); res.end('window.unrelatedLoaded=true'); return; }
    if (req.url.startsWith('/demo.js')) { res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Content-Type','text/javascript'); res.end(original); return; }
    if (req.url.includes('csp')) res.setHeader('Content-Security-Policy', 'script-src http://127.0.0.1:* http://localhost:*');
    res.setHeader('Content-Type','text/html');
    res.end(`<body data-result="pending"><script src="/unrelated.js"></script><script ${req.url.includes('module') ? 'type="module"' : ''} ${req.url.includes('sri') ? `crossorigin="anonymous" integrity="sha256-${digest}"` : ''} src="http://127.0.0.1:${server.address().port}/demo.js${req.url.includes('exact') ? '?v=1+2&amp;x=[ok]' : ''}"></script></body>`);
  });
  await new Promise(r => server.listen(0,'0.0.0.0',r));
  let context;
  try {
    const manifest = JSON.parse(await readFile('extension/manifest.json'));
    assert.ok(manifest.permissions.includes('debugger'));
    context = await chromium.launchPersistentContext('', { headless:true, executablePath:process.env.BROWSER_EXE || chromium.executablePath(), args:['--renderer-process-limit=2', `--disable-extensions-except=${resolve('extension')}`, `--load-extension=${resolve('extension')}`] });
    console.log('Browser:', context.browser()?.version());
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const options = context.pages()[0] || await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.locator('#projectName').fill('浏览器验证'); await options.locator('#createProject button').click();
    await options.waitForTimeout(300);
    console.log('Project UI:', await options.locator('#projectMessage').textContent());
    await options.locator('#new').click();
    await options.locator('#name').fill('替换'); await options.locator('#pattern').fill('/demo\\.js$');
    await options.locator('#content').fill("document.body.dataset.result='替换成功🚀'");
    await options.locator('#editor button[type=submit]').click();
    await options.waitForFunction(() => document.querySelector('#message').textContent.includes('已保存'));
    const url = `http://localhost:${server.address().port}/`;
    const page = await context.newPage();
    const network = await context.newCDPSession(page);
    await network.send('Network.enable');
    const redirects = [], failures = [], responses = [];
    network.on('Network.responseReceived', event => {
      if (event.response.url.includes('/demo.js')) responses.push({ url: event.response.url, status: event.response.status });
    });
    network.on('Network.requestWillBeSent', event => {
      if (event.redirectResponse?.url.includes('/demo.js')) redirects.push({ status: event.redirectResponse.status, statusText: event.redirectResponse.statusText });
    });
    network.on('Network.loadingFailed', event => failures.push({ errorText:event.errorText, blockedReason:event.blockedReason }));
    await page.goto(url);
    assert.equal(await page.locator('body').getAttribute('data-result'),'original');
    const setup = await options.evaluate(async () => {
      const tabs = await chrome.tabs.query({}); const tab = tabs.find(t => t.url?.startsWith('http://localhost:'));
      const { projects } = await chrome.runtime.sendMessage({ type:'projects' });
      const result = await chrome.runtime.sendMessage({ type:'start', tabId:tab.id, projectId:projects[0].id });
      return { tabId:tab.id, result };
    });
    assert.equal(setup.result.ok,true,JSON.stringify(setup));
    await page.reload(); assert.equal(await page.locator('body').getAttribute('data-result'),'替换成功🚀');
    assert.equal(redirects.length, 0);
    assert.ok(responses.some(r => r.status === 200 && r.url.startsWith('http://127.0.0.1:')));
    console.log('Replacement keeps original URL, status 200, no redirect:', responses);
    await page.goto(url+'?module'); assert.equal(await page.locator('body').getAttribute('data-result'),'替换成功🚀');
    const other = await context.newPage(); await other.goto(url); assert.equal(await other.locator('body').getAttribute('data-result'),'original');
    await other.close();
    await page.goto(url+'?csp'); assert.equal(await page.locator('body').getAttribute('data-result'),'替换成功🚀');
    await page.goto(url+'?sri'); assert.equal(await page.locator('body').getAttribute('data-result'),'pending');
    await options.waitForFunction(async tabId => { const s = await chrome.runtime.sendMessage({ type:'status',tabId }); return s.logs.some(l => l.message.includes('脚本加载失败')); },setup.tabId);
    const logs = await options.evaluate(tabId => chrome.runtime.sendMessage({ type:'status',tabId }),setup.tabId);
    assert.ok(logs.logs.some(l => l.level === 'success' && l.message.startsWith('200 ·')));
    assert.ok(!logs.logs.some(l => l.message.includes('加载完成')));
    // Updating an active project's payload must replace the existing native rule.
    const updated = await options.evaluate(async () => {
      const { projects } = await chrome.runtime.sendMessage({ type:'projects' });
      const project = projects[0]; project.rules[0].content = "document.body.dataset.result='updated'";
      project.rules[0].scope = 'all';
      return chrome.runtime.sendMessage({ type:'save', projectId:project.id, rules:project.rules });
    });
    assert.equal(updated.ok,true);
    await page.goto(url); assert.equal(await page.locator('body').getAttribute('data-result'),'updated');
    const fetched = await page.evaluate(async port => (await fetch(`http://127.0.0.1:${port}/demo.js`)).text(),server.address().port);
    assert.ok(fetched.includes("='updated'"));
    const fullUrl = `http://127.0.0.1:${server.address().port}/demo.js?v=1+2&x=[ok]`;
    const exactSaved = await options.evaluate(async pattern => {
      const { projects } = await chrome.runtime.sendMessage({ type:'projects' });
      const p = projects[0]; p.rules[0].pattern = pattern; p.rules[0].matchMode = 'auto';
      return chrome.runtime.sendMessage({ type:'save', projectId:p.id, rules:p.rules });
    }, fullUrl);
    assert.equal(exactSaved.ok,true);
    await page.goto(url+'?exact'); assert.equal(await page.locator('body').getAttribute('data-result'),'updated');
    await page.goto(url); assert.equal(await page.locator('body').getAttribute('data-result'),'original');
    const filtered = await options.evaluate(tabId => chrome.runtime.sendMessage({ type:'status',tabId }),setup.tabId);
    assert.ok(!filtered.logs.some(l => l.url.includes('unrelated.js')));
    await mkdir('test-results', { recursive:true });
    await options.screenshot({ path:'test-results/projects.png',fullPage:true });
    await options.evaluate(tabId => chrome.runtime.sendMessage({ type:'stop',tabId }),setup.tabId);
    await page.goto(url); assert.equal(await page.locator('body').getAttribute('data-result'),'original');
    console.log('PASS: classic, module, tab isolation, CSP/SRI diagnostics, stop restores original');
  } finally { await context?.close(); await new Promise(r => server.close(r)); }
});
