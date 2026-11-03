import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {loadStageRecipes} from '../runner/staged/recipes.ts';
test('only explicitly validated immutable recipes with independent evidence can be loaded',()=>{
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'staged-recipes-'));
 const record={id:'r',version:'1',state:'candidate',scope:{appId:'a',activityId:'c'},stageId:'open_list',steps:[{kind:'back'}],validations:[]};
 fs.writeFileSync(path.join(dir,'registry.json'),JSON.stringify({recipes:[record]}));assert.deepEqual(loadStageRecipes(dir,{appId:'a',activityId:'c'}),[]);
 fs.rmSync(dir,{recursive:true,force:true});
});
