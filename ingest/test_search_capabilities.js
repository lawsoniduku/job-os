import test from 'node:test';
import assert from 'node:assert/strict';
import {createSearchCapabilities} from '../api/searchCapabilities.js';

function database(probe) {
  return {from(table) {
    assert.equal(table,'jobs');
    return {select(column,options) {
      assert.equal(options,undefined,'capabilities never request whole-table counts');
      return {limit(n) { assert.equal(n,1); return probe(column); }};
    }};
  }};
}

test('stale or missing signals do not disable lean schema capability',async()=>{
  const columns=[];
  const load=createSearchCapabilities({db:database(async column=>{
    columns.push(column);
    return {data:[{elig_signals:null}],error:null};
  })});
  assert.deepEqual(await load(),{lean:true,hasLiveness:true});
  assert.deepEqual(columns.sort(),['elig_signals','link_status']);
});

test('concurrent cold searches share one capability probe and cached result',async()=>{
  let finish;
  const gate=new Promise(resolve=>{finish=resolve;});
  let calls=0;
  const load=createSearchCapabilities({db:database(async()=>{
    calls++; await gate; return {data:[],error:null};
  })});
  const searches=Array.from({length:8},()=>load());
  assert.equal(calls,2);
  finish();
  const values=await Promise.all(searches);
  assert.ok(values.every(value=>value.lean && value.hasLiveness));
  assert.deepEqual(await load(),values[0]);
  assert.equal(calls,2);
});

test('schema probes fail independently and retry after the capability TTL',async()=>{
  let clock=0,missing=true,calls=0;
  const load=createSearchCapabilities({ttlMs:100,now:()=>clock,db:database(async column=>{
    calls++;
    return {error:missing && column==='elig_signals' ? {message:'column does not exist'} : null};
  })});
  assert.deepEqual(await load(),{lean:false,hasLiveness:true});
  missing=false; clock=99;
  assert.deepEqual(await load(),{lean:false,hasLiveness:true});
  assert.equal(calls,2);
  clock=100;
  assert.deepEqual(await load(),{lean:true,hasLiveness:true});
  assert.equal(calls,4);
});

test('transport failures degrade capabilities without rejecting searches',async()=>{
  const load=createSearchCapabilities({db:database(async()=>{throw new Error('network failed');})});
  assert.deepEqual(await load(),{lean:false,hasLiveness:false});
});
