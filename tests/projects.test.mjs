import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateProjects } from '../extension/projects.mjs';
test('首次安装不自动创建项目；旧规则完整迁移且不重复迁移', () => {
  assert.deepEqual(migrateProjects({}), []);
  const oldRules = [{ id: 'rule', content: '原始内容', enabled: false }];
  const projects = migrateProjects({ rules: oldRules });
  assert.equal(projects[0].name, '默认项目');
  assert.deepEqual(projects[0].rules, oldRules);
  assert.deepEqual(migrateProjects({ projects, rules: oldRules }), projects);
  assert.deepEqual(migrateProjects({ projects: [], rules: oldRules }), []);
});
