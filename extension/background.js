import { compileRules, effectivePattern, matchRule, encodeBody } from './core.mjs';
import { migrateProjects, compileProjects } from './projects.mjs';
import { replacementHeaders } from './response.mjs';
import { appendLog } from './logs.mjs';
let projects = [], active = new Map(), logs = [];
let logQueue = Promise.resolve(), mutations = Promise.resolve();
let logRevision = 0, storedLogRevision = 0;
const encodedBodies = new WeakMap();
const stopping = new Set();
const command = (source, method, params = {}) => chrome.debugger.sendCommand(source, method, params);
function relatedRule(tabId, url, type = 'Script', method = 'GET') {
  const project = projects.find(p => p.id === active.get(tabId));
  return project && matchRule(project.rules, { url, method }, type);
}
function persistLogs() {
  logQueue = logQueue.catch(() => {}).then(async () => {
    if (storedLogRevision === logRevision) return;
    const revision = logRevision;
    await chrome.storage.session.set({ logs });
    storedLogRevision = revision;
  });
  return logQueue;
}
function log(tabId, message, url = '', level = 'info') {
  if (!Number.isInteger(tabId)) return;
  const displayUrl = url.startsWith('data:') ? '[导入的 JS 内容]' : url.slice(0, 2000);
  logs = appendLog(logs, { tabId, message: message.slice(0, 1500), url: displayUrl, level });
  logRevision++; void persistLogs().catch(() => {});
}
function plain(values) { return values.map(p => ({ ...p, rules: p.rules.map(({ regex, ...r }) => r) })); }
async function apply(nextProjects, nextActive) {
  try {
    if (nextProjects !== projects) await chrome.storage.local.set({ projects: plain(nextProjects) });
    await chrome.storage.session.set({ active: [...nextActive], engine: 'cdp-v2' });
  } catch (error) {
    if (nextProjects !== projects) await chrome.storage.local.set({ projects: plain(projects) }).catch(() => {});
    throw error;
  }
  projects = nextProjects; active = nextActive;
}
const ready = (async () => {
  const [local, session] = await Promise.all([chrome.storage.local.get(['rules', 'projects']), chrome.storage.session.get(['active', 'logs', 'engine', 'logVersion'])]);
  projects = compileProjects(migrateProjects(local)); logs = session.logVersion === 4 ? session.logs || [] : [];
  if (!Array.isArray(local.projects)) await chrome.storage.local.set({ projects: plain(projects) });
  // Keep the DNR permission only to remove this extension's old redirect rules.
  const dnr = chrome.declarativeNetRequest;
  const [oldSession, oldDynamic] = await Promise.all([dnr.getSessionRules(), dnr.getDynamicRules()]);
  await dnr.updateSessionRules({ removeRuleIds: oldSession.map(r => r.id) });
  await dnr.updateDynamicRules({ removeRuleIds: oldDynamic.map(r => r.id) });
  const available = new Set((await chrome.tabs.query({})).map(t => t.id));
  if (session.engine === 'cdp-v2') {
    for (const [tabId, projectId] of session.active || []) {
      if (!available.has(tabId) || !projects.some(p => p.id === projectId)) continue;
      try { await command({ tabId }, 'Runtime.enable'); active.set(tabId, projectId); } catch { /* The browser detached while the worker was stopped. */ }
    }
  }
  await apply(projects, active);
  await chrome.storage.session.set({ logVersion: 4, logs });
})();
function mutate(operation) {
  const result = mutations.then(() => ready).then(operation);
  mutations = result.catch(() => {}); return result;
}
async function configure(source) {
  await command(source, 'Network.enable');
  await command(source, 'Network.setCacheDisabled', { cacheDisabled: true });
  await command(source, 'Network.setBypassServiceWorker', { bypass: true });
  await command(source, 'Runtime.enable');
  await command(source, 'Fetch.enable', { patterns: ['Script', 'XHR', 'Fetch'].map(resourceType => ({ urlPattern: '*', resourceType, requestStage: 'Response' })) });
  await command(source, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'iframe', exclude: false }, { exclude: true }] });
}
chrome.debugger.onEvent.addListener((source, method, params) => {
  void (async () => {
    await ready;
    if (method === 'Target.attachedToTarget') {
      const child = { tabId: source.tabId, sessionId: params.sessionId };
      try { if (active.has(source.tabId)) await configure(child); }
      catch (e) { log(source.tabId, '子框架初始化失败：' + e.message, '', 'error'); }
      finally { await command(child, 'Runtime.runIfWaitingForDebugger').catch(() => {}); }
      return;
    }
    if (method === 'Runtime.exceptionThrown') {
      const detail = params.exceptionDetails;
      const url = detail.url || detail.stackTrace?.callFrames?.[0]?.url || '';
      if (relatedRule(source.tabId, url)) log(source.tabId, '脚本异常：' + String(detail.exception?.description || detail.text || '未知错误').slice(0, 1000), url, 'error');
      return;
    }
    if (method !== 'Fetch.requestPaused') return;
    const rule = relatedRule(source.tabId, params.request.url, params.resourceType, params.request.method);
    if (!rule) { await command(source, 'Fetch.continueRequest', { requestId: params.requestId }).catch(() => {}); return; }
    try {
      if (params.responseErrorReason) throw new Error('原请求失败：' + params.responseErrorReason);
      if (!encodedBodies.has(rule)) encodedBodies.set(rule, encodeBody(rule.content));
      await command(source, 'Fetch.fulfillRequest', {
        requestId: params.requestId, responseCode: 200, responsePhrase: 'OK',
        responseHeaders: replacementHeaders(params.responseHeaders),
        body: params.request.method === 'HEAD' ? '' : encodedBodies.get(rule)
      });
      log(source.tabId, `200 · ${rule.name}`, params.request.url, 'success');
    } catch (e) {
      log(source.tabId, '替换失败：' + e.message, params.request.url, 'error');
      await command(source, 'Fetch.continueRequest', { requestId: params.requestId }).catch(() => {});
    }
  })().catch(e => { if (active.has(source.tabId)) log(source.tabId, '调试错误：' + e.message, '', 'error'); });
});
chrome.debugger.onDetach.addListener(source => {
  if (stopping.has(source.tabId)) return;
  void mutate(async () => {
    if (!active.has(source.tabId)) return;
    active.delete(source.tabId);
    await chrome.storage.session.set({ active: [...active] });
    await chrome.action.setBadgeText({ tabId: source.tabId, text: '' }).catch(() => {});
    log(source.tabId, '连接断开，替换已停止', '', 'error');
  }).catch(() => {});
});
chrome.webRequest.onErrorOccurred.addListener(info => {
  void ready.then(() => { if (relatedRule(info.tabId, info.url, info.type === 'xmlhttprequest' ? 'Fetch' : 'Script', info.method || 'GET')) log(info.tabId, '请求失败：' + info.error, info.url, 'error'); }).catch(() => {});
}, { urls: ['<all_urls>'], types: ['script', 'xmlhttprequest'] });
chrome.tabs.onRemoved.addListener(tabId => {
  void mutate(async () => { if (active.has(tabId)) { const next = new Map(active); next.delete(tabId); await apply(projects, next); } }).catch(() => {});
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  const extensionPage = sender.url?.startsWith(chrome.runtime.getURL(''));
  if (!extensionPage && sender.tab) {
    if (message.type !== 'diagnostic') return;
    void ready.then(() => {
      if (!relatedRule(sender.tab.id, String(message.url || ''))) return;
      const labels = { csp: 'CSP 阻止加载', error: '脚本加载失败（请查看 Console）' };
      if (labels[message.kind]) log(sender.tab.id, labels[message.kind] + (message.directive ? '：' + String(message.directive).slice(0, 100) : ''), String(message.url || ''), 'error');
    }).catch(() => {});
    return;
  }
  if (!extensionPage) return;
  (async () => {
    await ready;
    if (message.type === 'projects') return { projects: plain(projects) };
    if (message.type === 'checkRegex') { new RegExp(effectivePattern(message), message.flags || ''); return { isSupported: true }; }
    if (message.type === 'status') return { active: active.has(message.tabId), projectId: active.get(message.tabId), logs: logs.filter(l => l.tabId === message.tabId), projects: projects.map(p => ({ id: p.id, name: p.name, count: p.rules.length })) };
    if (message.type === 'clearLogs') { logs = logs.filter(l => l.tabId !== message.tabId); logRevision++; await persistLogs(); return {}; }
    return mutate(async () => {
      if (message.type === 'createProject' || message.type === 'renameProject') {
        const name = String(message.name || '').trim();
        if (!name || name.length > 100) throw new Error('请输入 1–100 字符的项目名称');
        if (projects.some(p => p.name === name && p.id !== message.projectId)) throw new Error('项目名称已存在');
        if (message.type === 'renameProject') {
          if (!projects.some(p => p.id === message.projectId)) throw new Error('项目不存在');
          await apply(projects.map(p => p.id === message.projectId ? { ...p, name } : p), active);
          return { projectId: message.projectId };
        }
        const project = { id: crypto.randomUUID(), name, rules: [] };
        await apply([...projects, project], active); return { projectId: project.id };
      }
      if (message.type === 'deleteProject') {
        if ([...active.values()].includes(message.projectId)) throw new Error('项目正在标签页中使用，请先停止替换再删除');
        await apply(projects.filter(p => p.id !== message.projectId), active); return {};
      }
      if (message.type === 'save') {
        if (!projects.some(p => p.id === message.projectId)) throw new Error('请先创建或选择项目');
        const next = compileRules(message.rules);
        await apply(projects.map(p => p.id === message.projectId ? { ...p, rules: next } : p), active); return {};
      }
      if (message.type === 'start') {
        if (active.has(message.tabId)) throw new Error('请先停止当前项目再切换');
        const project = projects.find(p => p.id === message.projectId);
        if (!project) throw new Error('请先选择项目');
        if (!project.rules.some(r => r.enabled)) throw new Error('请在该项目中添加并启用至少一条规则');
        const tab = await chrome.tabs.get(message.tabId);
        if (!/^https?:\/\//.test(tab.url || '')) throw new Error('请在普通 HTTP/HTTPS 网页上启用');
        const source = { tabId: message.tabId };
        await chrome.debugger.attach(source, '1.3');
        try {
          active.set(message.tabId, project.id);
          await configure(source);
          await apply(projects, new Map(active));
        } catch (error) {
          active.delete(message.tabId);
          await chrome.debugger.detach(source).catch(() => {});
          throw error;
        }
        await chrome.action.setBadgeText({ tabId: message.tabId, text: 'ON' }).catch(() => {});
        log(message.tabId, `已启用 · ${project.name}`); return {};
      }
      if (message.type === 'stop') {
        stopping.add(message.tabId);
        try { if (active.has(message.tabId)) await chrome.debugger.detach({ tabId: message.tabId }); }
        finally { stopping.delete(message.tabId); }
        const next = new Map(active); next.delete(message.tabId); await apply(projects, next);
        await chrome.action.setBadgeText({ tabId: message.tabId, text: '' }).catch(() => {});
        log(message.tabId, '已停止替换'); return {};
      }
      throw new Error('未知操作');
    });
  })().then(data => reply({ ok: true, ...data }), error => reply({ ok: false, error: error.message }));
  return true;
});
