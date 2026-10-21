import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replacementHeaders } from '../extension/response.mjs';
const listeners = {}, local = {}, session = { engine:'dnr-v1', active:[[7,'legacy']] }, calls=[];
let failFulfill=false, attached=new Set(), oldRules=[{id:5}];
const storage = data => ({ async get() { return structuredClone(data); }, async set(value) { Object.assign(data, structuredClone(value)); } });
globalThis.chrome = {
  storage:{ local:storage(local), session:storage(session) },
  runtime:{ id:'test', getURL:()=> 'chrome-extension://test/', onMessage:{ addListener(fn){listeners.message=fn;} } },
  declarativeNetRequest:{ async getSessionRules(){return oldRules;},async getDynamicRules(){return [];},async updateSessionRules(){oldRules=[];},async updateDynamicRules(){} },
  debugger:{ onEvent:{addListener(fn){listeners.event=fn;}},onDetach:{addListener(fn){listeners.detach=fn;}}, async attach({tabId}){attached.add(tabId);},async detach({tabId}){attached.delete(tabId);listeners.detach({tabId});},async sendCommand(source,method,params){calls.push({source,method,params});if(failFulfill && method==='Fetch.fulfillRequest')throw new Error('模拟失败');} },
  webRequest:{ onErrorOccurred:{addListener(fn){listeners.error=fn;}} },
  tabs:{ async query(){return [];},async get(){return {url:'http://example.com/'};},onRemoved:{addListener(fn){listeners.removed=fn;}} },
  action:{async setBadgeText(){}}
};
await import('../extension/background.js');
const message = value => new Promise(resolve=>listeners.message(value,{id:'test',url:'chrome-extension://test/options.html',tab:{id:99}},resolve));
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
test('响应头保留 CORS/Cookie，移除旧压缩与长度',()=>{
  const headers=replacementHeaders([{name:'Content-Encoding',value:'gzip'},{name:'Content-Length',value:'10'},{name:'ETag',value:'old'},{name:'Access-Control-Allow-Origin',value:'*'},{name:'Set-Cookie',value:'a=b'}]);
  assert.ok(headers.some(h=>h.name==='Access-Control-Allow-Origin'));
  assert.ok(headers.some(h=>h.name==='Set-Cookie'));
  assert.ok(!headers.some(h=>/^(Content-Encoding|Content-Length|ETag)$/.test(h.name)));
});
test('CDP 迁移、项目隔离、200 正文、放行、失败回退、断开与停用',async()=>{
  assert.deepEqual((await message({type:'projects'})).projects,[]);assert.deepEqual(oldRules,[]);
  const {projectId:a}=await message({type:'createProject',name:'A'});
  const {projectId:b}=await message({type:'createProject',name:'B'});
  const rule={id:'r',name:'test',pattern:'http://example.com/demo.js?v=1',matchMode:'exact',flags:'',enabled:true,scope:'Script',content:'中文🚀'};
  await message({type:'save',projectId:a,rules:[rule]});await message({type:'save',projectId:b,rules:[{...rule,content:'B'}]});
  assert.equal((await message({type:'start',tabId:7,projectId:a})).ok,true);
  assert.equal((await message({type:'start',tabId:8,projectId:b})).ok,true);
  assert.equal((await message({type:'deleteProject',projectId:a})).ok,false);
  const paused={requestId:'1',resourceType:'Script',request:{url:rule.pattern,method:'GET'},responseStatusCode:200,responseHeaders:[{name:'Access-Control-Allow-Origin',value:'*'}]};
  listeners.event({tabId:7},'Fetch.requestPaused',paused);await tick();
  assert.equal(calls.at(-1).method,'Fetch.fulfillRequest');assert.equal(calls.at(-1).params.responseCode,200);
  assert.equal(Buffer.from(calls.at(-1).params.body,'base64').toString(),'中文🚀');
  listeners.event({tabId:8},'Fetch.requestPaused',paused);await tick();assert.equal(Buffer.from(calls.at(-1).params.body,'base64').toString(),'B');
  listeners.event({tabId:7},'Fetch.requestPaused',{...paused,request:{...paused.request,url:'http://example.com/other.js'}});await tick();assert.equal(calls.at(-1).method,'Fetch.continueRequest');
  failFulfill=true;listeners.event({tabId:7},'Fetch.requestPaused',paused);await tick();assert.equal(calls.at(-1).method,'Fetch.continueRequest');failFulfill=false;
  listeners.event({tabId:7},'Target.attachedToTarget',{sessionId:'child'});await tick();assert.equal(calls.at(-1).method,'Runtime.runIfWaitingForDebugger');
  listeners.message({type:'diagnostic',kind:'load',url:'http://example.com/other.js'},{id:'test',url:'http://example.com/',tab:{id:7}},()=>{});await tick();
  assert.ok(!(await message({type:'status',tabId:7})).logs.some(l=>l.url.includes('other.js')));
  listeners.message({type:'diagnostic',kind:'load',url:rule.pattern},{id:'test',url:'http://example.com/',tab:{id:7}},()=>{});await tick();
  assert.ok(!(await message({type:'status',tabId:7})).logs.some(l=>l.message.includes('加载完成')));
  await message({type:'clearLogs',tabId:7});assert.deepEqual((await message({type:'status',tabId:7})).logs,[]);
  await message({type:'stop',tabId:7});assert.equal((await message({type:'status',tabId:7})).active,false);assert.ok(!attached.has(7));
  assert.equal((await message({type:'status',tabId:7})).logs.length,1);
  listeners.detach({tabId:8});await tick();assert.equal((await message({type:'status',tabId:8})).active,false);
});
