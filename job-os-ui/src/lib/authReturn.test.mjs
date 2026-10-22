import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberAuthReturn,consumeAuthReturn,allowedAuthPath,authReturnStorage} from './authReturn.js';
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
test('employer and application intent survive the root OAuth callback once',()=>{
 for(const path of ['/employer','/apply/00000000-0000-4000-8000-000000000001']){
  const store=storage();rememberAuthReturn(store,path,1000);
  assert.equal(consumeAuthReturn(store,{pathname:'/',hash:'#access_token=synthetic-placeholder'},1500),path);
  assert.equal(consumeAuthReturn(store,{pathname:'/',hash:'#access_token=synthetic-placeholder'},1500),null);
 }
});
test('candidate navigation, external URLs and expired or malformed intent cannot redirect',()=>{
 for(const path of ['//external.example','https://external.example','/employer?next=//external.example','/apply/not-a-job','/employer/../../outside'])assert.equal(allowedAuthPath(path),null);
 const store=storage();rememberAuthReturn(store,'/employer',1000);
 assert.equal(consumeAuthReturn(store,{pathname:'/',hash:''},1500),null,'ordinary homepage visits stay put');
 assert.equal(consumeAuthReturn(store,{pathname:'/',hash:'#access_token=synthetic-placeholder'},1000+16*60000),null);
 rememberAuthReturn(store,'/employer',1000);rememberAuthReturn(store,'/',1500);
 assert.equal(consumeAuthReturn(store,{pathname:'/',search:'?code=synthetic-placeholder'},1700),null,'candidate auth clears older employer intent');
 assert.equal(consumeAuthReturn({getItem:()=>{throw Error('disabled');}},{pathname:'/',hash:'#access_token=synthetic-placeholder'}),null);
 assert.equal(authReturnStorage({get localStorage(){throw Error('privacy mode');}}),null);
 assert.equal(consumeAuthReturn(null,{pathname:'/',hash:'#access_token=synthetic-placeholder'}),null);
});
