import { compileRules } from './core.mjs';
const $ = id => document.getElementById(id);
let projects = [], projectId = null, rules = [];
let editing = null, filename = '';
const tell = text => { $('message').textContent = text; if ($('ruleEditor').hidden) $('projectMessage').textContent = text; };
async function send(type, data = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...data });
  if (!result.ok) throw new Error(result.error);
  return result;
}
async function load(selected = projectId) {
  projects = (await send('projects')).projects;
  projectId = projects.some(p => p.id === selected) ? selected : null;
  rules = projects.find(p => p.id === projectId)?.rules || [];
  renderProjects(); render();
}
function renderProjects() {
  $('projects').replaceChildren();
  if (!projects.length) $('projects').textContent = '还没有项目。请先创建第一个项目，再添加规则。';
  for (const project of projects) {
    const button = document.createElement('button');
    button.className = project.id === projectId ? 'primary' : '';
    button.textContent = `${project.name} · ${project.rules.length} 条规则`;
    button.onclick = () => {
      projectId = project.id; rules = project.rules; editing = null;
      $('ruleEditor').hidden = true; $('projectMessage').textContent = '';
      renderProjects(); render();
    };
    $('projects').append(button);
  }
  $('projectDetail').hidden = !projectId;
  $('projectTitle').textContent = projects.find(p => p.id === projectId)?.name || '';
}
async function save(next) {
  if (!projectId) throw new Error('请先创建或选择项目');
  await send('save', { projectId, rules: next });
  await load();
}
function draft() {
  return { id: editing || crypto.randomUUID(), name: $('name').value.trim() || '未命名规则', pattern: $('pattern').value.trim(), matchMode: $('matchMode').value, flags: $('ignoreCase').checked ? 'i' : '', enabled: $('enabled').checked, scope: $('scope').value, content: $('content').value, filename };
}
function edit(rule) {
  if (!projectId) return;
  $('ruleEditor').hidden = false;
  editing = rule?.id || null; filename = rule?.filename || '';
  $('heading').textContent = rule ? '编辑规则' : '新建规则';
  $('name').value = rule?.name || ''; $('pattern').value = rule?.pattern || '';
  $('matchMode').value = rule ? rule.matchMode || 'regex' : 'auto';
  $('ignoreCase').checked = rule?.flags === 'i'; $('enabled').checked = rule?.enabled ?? true;
  $('scope').value = rule?.scope || 'Script'; $('content').value = rule?.content || '';
  $('file').value = ''; $('filename').textContent = filename || '内容快照：不会自动同步磁盘修改'; tell('');
}
function render() {
  $('rules').replaceChildren();
  if (!rules.length) $('rules').textContent = '此项目还没有规则，点击“新建规则”开始。';
  rules.forEach((rule, index) => {
    const block = document.createElement('div'); block.className = 'rule';
    const row = document.createElement('div'); row.className = 'row';
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = rule.enabled;
    toggle.onchange = () => save(rules.map(r => r.id === rule.id ? { ...r, enabled: toggle.checked } : r)).catch(e => { tell(e.message); render(); });
    const name = document.createElement('strong'); name.textContent = rule.name;
    row.append(toggle, name);
    for (const [label, action] of [ ['编辑', () => edit(rule)], ['上移', async () => { if (!index) return; const next = [...rules]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; await save(next); }], ['删除', async () => { await save(rules.filter(r => r.id !== rule.id)); if (editing === rule.id) { editing = null; $('ruleEditor').hidden = true; } }] ]) {
      const button = document.createElement('button'); button.textContent = label;
      button.onclick = () => Promise.resolve().then(action).catch(e => tell(e.message)); row.append(button);
    }
    const pattern = document.createElement('code'); pattern.textContent = `[${({ auto:'自动', exact:'完整 URL', regex:'正则' })[rule.matchMode || 'regex']}] ` + rule.pattern + (rule.flags ? ' [i]' : '');
    block.append(row, pattern); $('rules').append(block);
  });
}
$('new').onclick = () => edit();
$('createProject').onsubmit = async event => {
  event.preventDefault();
  try {
    const result = await send('createProject', { name: $('projectName').value });
    await load(result.projectId); $('projectName').value = ''; $('ruleEditor').hidden = true;
    $('projectMessage').textContent = '项目已创建，可以在项目中添加规则。';
  } catch (e) { $('projectMessage').textContent = e.message; }
};
$('renameProject').onclick = async () => {
  const name = prompt('项目名称', projects.find(p => p.id === projectId)?.name);
  if (name === null) return;
  try { await send('renameProject', { projectId, name }); await load(); }
  catch (e) { $('projectMessage').textContent = e.message; }
};
$('deleteProject').onclick = async () => {
  if (!confirm('删除此项目及其全部规则？此操作无法撤销。')) return;
  try { await send('deleteProject', { projectId }); await load(null); $('ruleEditor').hidden = true; $('projectMessage').textContent = '项目已删除'; }
  catch (e) { $('projectMessage').textContent = e.message; }
};
$('file').onchange = async () => {
  const file = $('file').files[0]; if (!file) return;
  const currentProject = projectId, currentEditing = editing;
  try { if (file.size > 2 * 1024 * 1024) throw new Error('文件不能超过 2 MB'); const content = await file.text(); if (projectId !== currentProject || editing !== currentEditing) return; $('content').value = content; filename = file.name; $('filename').textContent = filename + ' · 内容快照'; }
  catch (e) { tell(e.message); }
};
$('test').onclick = async () => { try { const [rule] = compileRules([draft()]); const check = await send('checkRegex', { pattern: rule.pattern, flags: rule.flags, matchMode: rule.matchMode }); if (!check.isSupported) throw new Error('浏览器不支持此正则：' + check.reason + '，请检查 JavaScript 正则语法'); const url = new URL($('testUrl').value.trim()); url.hash = ''; tell(rule.regex.test(url.href) ? '✓ URL 匹配成功（实际还需满足请求范围）' : '未匹配：请检查路径、查询参数、大小写和匹配方式'); } catch (e) { tell(e.message); } };
$('editor').onsubmit = async event => {
  event.preventDefault();
  try { const rule = draft(); compileRules([rule]); await save(editing ? rules.map(r => r.id === editing ? rule : r) : [...rules, rule]); editing = rule.id; $('heading').textContent = '编辑规则'; tell('已保存，已启用的标签页将在下一次请求时使用新规则。'); }
  catch (e) { tell(e.message); }
};
await load().catch(e => { $('projectMessage').textContent = e.message; });
