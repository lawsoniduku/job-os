import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
test('Briefing renders for signed-in users even when inactive, and for guests', async () => {
  const outDir = await mkdtemp(path.join(root, '.render-test-'));
  try {
    await build({root, logLevel:'silent', build:{ssr:path.join(root,'src/views/Briefing.jsx'),outDir,emptyOutDir:true,minify:false}});
    const {default: Briefing} = await import(pathToFileURL(path.join(outDir,'Briefing.js')).href);
    const base = {profile:null, requireAuth:()=>{},setView:()=>{}};
    for (const active of [false,true]) {
      const html = renderToString(React.createElement(Briefing,{active,shared:{...base,user:{id:'render-test',email:'test@example.invalid'}}}));
      assert.match(html,/New for you/);
    }
    const guest = renderToString(React.createElement(Briefing,{active:true,shared:{...base,user:null}}));
    assert.match(guest,/Sign in or create account/);
  } finally { await rm(outDir,{recursive:true,force:true}); }
});
