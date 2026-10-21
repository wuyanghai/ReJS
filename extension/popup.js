const $ = id => document.getElementById(id);
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
let enabled = false;
let busy = false;
let refreshing = false;
async function send(type) {
  const result = await chrome.runtime.sendMessage({ type, tabId: tab.id, projectId: $('project').value });
  if (!result.ok) throw new Error(result.error); return result;
}
async function refresh() {
  if (busy || refreshing) return;
  refreshing = true;
  try {
  const result = await send('status'); enabled = result.active;
  if (busy) return;
  const selected = enabled ? result.projectId : $('project').value;
  const projectSignature = JSON.stringify(result.projects);
  if ($('project').dataset.signature !== projectSignature) {
  $('project').replaceChildren();
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = result.projects.length ? '请选择项目' : '请先创建项目'; $('project').append(placeholder);
  for (const project of result.projects) { const option = document.createElement('option'); option.value = project.id; option.textContent = `${project.name} · ${project.count} 条规则`; $('project').append(option); }
  $('project').dataset.signature = projectSignature;
  }
  $('project').value = result.projects.some(p => p.id === selected) ? selected : '';
  $('project').disabled = enabled;
  $('state').textContent = enabled ? `● 已启用 · ${result.projects.find(p => p.id === result.projectId)?.name || ''}` : '○ 未启用 · 请选择项目后启用';
  $('toggle').textContent = enabled ? '停止替换' : '启用当前页'; $('toggle').disabled = !enabled && !$('project').value;
  const scroll = $('logs').scrollTop;
  $('logs').replaceChildren();
  const entries = result.logs.filter(entry => $('logFilter').value !== 'error' || entry.level === 'error');
  for (const entry of entries) { const div = document.createElement('div'); div.className = 'log ' + (entry.level || 'info'); div.textContent = `${entry.time} ${entry.message}${entry.count > 1 ? ` ×${entry.count}` : ''}${entry.url ? '\n' + entry.url : ''}`; $('logs').append(div); }
  if (!entries.length) $('logs').textContent = '暂无记录';
  $('logs').scrollTop = scroll;
  } finally { refreshing = false; }
}
$('toggle').onclick = async () => {
  busy = true; $('toggle').disabled = true;
  try { await send(enabled ? 'stop' : 'start'); $('message').textContent = enabled ? '已停止，可选择其他项目' : '已启用，请刷新页面'; }
  catch (e) { $('message').textContent = e.message; }
  finally { busy = false; await refresh().catch(e => { $('message').textContent = e.message; $('toggle').disabled = false; }); }
};
$('clearLogs').onclick = async () => { try { await send('clearLogs'); await refresh(); } catch (e) { $('message').textContent = e.message; } };
$('logFilter').onchange = () => refresh().catch(e => { $('message').textContent = e.message; });
$('project').onchange = () => { $('toggle').disabled = !$('project').value; };
$('reload').onclick = () => chrome.tabs.reload(tab.id, { bypassCache: true }).catch(e => { $('message').textContent = e.message; });
$('manage').onclick = () => chrome.runtime.openOptionsPage();
refresh().catch(e => { $('message').textContent = e.message; });
setInterval(() => refresh().catch(() => {}), 1500);
