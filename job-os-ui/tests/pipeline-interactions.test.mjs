import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {build} from 'vite';
import React from 'react';
import {plugin} from './support/pipelineFixture.mjs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));

test('Pipeline and return prompt distinguish browsing, saving and the full application lifecycle',async()=>{
const out=await mkdtemp(root+'/.pipeline-dom-qa-');
const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'https://example.invalid/qa',pretendToBeVisual:true});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true});
window.open=()=>null;
const errors=[];const originalError=console.error;console.error=(...args)=>{errors.push(args.map(String).join(' '));originalError(...args);};
const flush=async()=>React.act(async()=>{await new Promise(r=>setTimeout(r,25));});
const until=async check=>{for(let i=0;i<40;i++){await flush();if(check())return;}throw Error('DOM assertion timed out: '+document.body.textContent.slice(-2000));};
const cards=()=>[...document.querySelectorAll('.p-card')];
const card=title=>cards().find(n=>n.querySelector('.pc-title').textContent===title);
const count=label=>[...document.querySelectorAll('.col')].find(n=>n.querySelector('.col-head').textContent.startsWith(label))?.querySelectorAll('.p-card').length;
async function click(label,within=document){const b=[...within.querySelectorAll('button')].find(n=>n.textContent===label||n.getAttribute('aria-label')===label);assert.ok(b,'button '+label);await React.act(async()=>{b.click();});await flush();}
const reset=async()=>{await React.act(async()=>window.__pipelineQA.reset());await until(()=>document.querySelector('.nudge-q'));};
try{
 await build({root,plugins:[plugin],logLevel:'error',build:{ssr:'/__qa_entry.jsx',outDir:out,emptyOutDir:true,minify:false}});
 await React.act(async()=>{await import(pathToFileURL(out+'/__qa_entry.js'));});
 await until(()=>document.querySelector('.nudge-q'));
 assert.equal(cards().length,5);assert.equal(card('Old false Closed'),undefined);assert.equal(card('Viewed only'),undefined);
 await click('Not applying');await click('Not open to my country');assert.equal(card('Viewed only'),undefined);assert.equal(count('Closed'),1);
 await reset();await click('Not applying');await click('Application form was broken');assert.equal(count('Saved'),1);assert.equal(count('Closed'),1);
 await reset();await click('Dismiss');assert.equal(card('Viewed only'),undefined);assert.equal(count('Closed'),1);
 await reset();await click('Save for later');await until(()=>card('Viewed only'));assert.equal(count('Saved'),2);
 await click('Remove saved',card('Viewed only'));await until(()=>!card('Viewed only'));assert.equal(count('Closed'),1);
 await reset();await click('Yes, applied');await until(()=>card('Viewed only'));assert.equal(count('Applied'),2);
 await click('Move to In progress',card('Viewed only'));assert.equal(count('In progress'),2);
 await click('Mark offer',card('Viewed only'));assert.equal(count('Offer'),2);
 await click('Close application',card('Viewed only'));assert.equal(count('Closed'),2);
 await click('Open ↗',card('Saved intentionally'));assert.equal(count('Saved'),1);assert.equal(window.__pipelineQA.rows().length,7);
 assert.deepEqual(errors,[]);
 console.log('PASS: mounted production Pipeline + ReturnNudge: legacy filtering, decline, broken form, dismiss, save, remove Saved, confirm, In progress, Offer, genuine Closed and reopening; no React errors.');
}finally{console.error=originalError;dom.window.close();await rm(out,{recursive:true,force:true});}

});
