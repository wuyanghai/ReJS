export function effectivePattern(rule) {
  const mode = rule.matchMode || 'regex';
  if (!['auto', 'exact', 'regex'].includes(mode)) throw new Error('匹配方式无效');
  const input = rule.pattern.trim();
  if (mode === 'exact' || (mode === 'auto' && /^https?:\/\//i.test(input))) {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('完整 URL 必须以 http:// 或 https:// 开头');
    url.hash = '';
    return '^' + url.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
  }
  return input;
}
export function compileRules(rules) {
  if (!Array.isArray(rules) || rules.length > 100) throw new Error('最多支持 100 条规则');
  return rules.map(rule => {
    if (!rule || typeof rule.pattern !== 'string' || !rule.pattern || rule.pattern.length > 1000) throw new Error('请填写有效的正则（最多 1000 字符）');
    if (!['', 'i'].includes(rule.flags)) throw new Error('仅支持空选项或 i');
    if (typeof rule.content !== 'string' || new TextEncoder().encode(rule.content).length > 2 * 1024 * 1024) throw new Error('每条 JS 内容最多 2 MB');
    if (!['Script', 'all'].includes(rule.scope)) throw new Error('资源类型无效');
    return { ...rule, regex: new RegExp(effectivePattern(rule), rule.flags) };
  });
}
export function matchRule(rules, request, resourceType) {
  if (!['GET', 'HEAD'].includes(request.method) || !/^https?:\/\//.test(request.url)) return;
  return rules.find(r => r.enabled && (r.scope === 'all' || resourceType === 'Script') && r.regex.test(request.url));
}
export function encodeBody(content) {
  const bytes = new TextEncoder().encode(content);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
