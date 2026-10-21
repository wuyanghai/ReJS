import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendLog } from '../extension/logs.mjs';
test('日志合并相同短时事件，隔离标签页并限制容量', () => {
  const entry={tabId:1,message:'200 · demo',url:'https://example.com/a.js',level:'success'};
  let logs=appendLog([],entry,1000);
  logs=appendLog(logs,entry,1500);
  assert.equal(logs.length,1);assert.equal(logs[0].count,2);
  logs=appendLog(logs,{...entry,tabId:2},1600);assert.equal(logs.length,2);
  logs=appendLog(logs,entry,5000);assert.equal(logs.length,3);
  for(let i=0;i<150;i++) logs=appendLog(logs,{...entry,message:String(i)},10000+i);
  assert.equal(logs.filter(l=>l.tabId===1).length,100);
  assert.equal(logs.filter(l=>l.tabId===2).length,1);
});
