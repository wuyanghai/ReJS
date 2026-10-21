import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules, matchRule, encodeBody } from '../extension/core.mjs';
const base = { name: 'demo', pattern: '^https?://example\\.com/demo\\.js(?:\\?.*)?$', flags: '', enabled: true, scope: 'Script', content: '' };
test('精确域名、查询参数、类型与方法', () => {
  const rules = compileRules([base]);
  const req = { url: 'https://example.com/demo.js?v=1', method: 'GET' };
  assert.ok(matchRule(rules, req, 'Script'));
  assert.equal(matchRule(rules, { ...req, url: 'https://evil.example.com/demo.js' }, 'Script'), undefined);
  assert.equal(matchRule(rules, req, 'Fetch'), undefined);
  assert.equal(matchRule(rules, { ...req, method: 'POST' }, 'Script'), undefined);
  assert.ok(matchRule(rules, { ...req, method: 'HEAD' }, 'Script'));
});
test('第一条启用规则优先，重复匹配稳定，all 覆盖 Fetch', () => {
  const rules = compileRules([{ ...base, enabled: false }, { ...base, name: 'second', scope: 'all' }, { ...base, name: 'third' }]);
  for (let i = 0; i < 3; i++) assert.equal(matchRule(rules, { url: 'http://example.com/demo.js', method: 'GET' }, 'Fetch').name, 'second');
});
test('非法正则和状态性 flags 被拒绝', () => {
  assert.throws(() => compileRules([{ ...base, pattern: '[' }]));
  assert.throws(() => compileRules([{ ...base, flags: 'g' }]));
});
test('UTF-8、emoji、大内容和空内容无损编码', () => {
  for (const value of ['', '中文 🚀', 'a'.repeat(100000)]) assert.equal(Buffer.from(encodeBody(value), 'base64').toString('utf8'), value);
});
test('完整 URL 自动/精确模式转义查询参数；正则旧规则保持原意', () => {
  const url = 'https://example.com/demo.js?v=1+2&x=[ok]';
  for (const matchMode of ['auto','exact']) {
    const [rule] = compileRules([{ ...base, matchMode, pattern:'  '+url+'  ' }]);
    assert.ok(rule.regex.test(url));
    assert.equal(rule.regex.test(url+'&extra=1'),false);
    assert.equal(rule.regex.test(url.replace('demo.js','demoXjs')),false);
  }
  const [legacy] = compileRules([{ ...base, pattern:'https://example.com/demo.js?v=1' }]);
  assert.equal(legacy.regex.test('https://example.com/demo.js?v=1'),false);
});
