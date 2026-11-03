import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
test('disabled recovery does not load its optional source dependency',t=>{
 const root=path.resolve(import.meta.dirname,'..'),dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'entry-disabled-import-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'probe.mjs');
 fs.writeFileSync(file,`import {registerHooks} from 'node:module';
 registerHooks({load(url,context,next){if(url.endsWith('/entry-recovery.ts'))throw Error('Disabled recovery dependency loaded');return next(url,context);}});
 const {createStagedRuntime}=await import(${JSON.stringify(pathToFileURL(path.join(root,'runner/staged/runtime.ts')).href)});
 if(typeof createStagedRuntime!=='function')throw Error('Missing runtime');`);
 assert.doesNotThrow(()=>execFileSync(process.execPath,['--import',pathToFileURL(path.join(root,'node_modules/tsx/dist/loader.mjs')).href,file],{cwd:root,stdio:'pipe'}));
});
