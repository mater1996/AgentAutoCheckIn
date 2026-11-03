import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {readStructured,structuredExists} from '../storage/structured.ts';
export function loadStageRecipes(root:string,scope:{appId:string;activityId:string},workspace=process.cwd()){
 const file=path.join(root,'registry.json'),ref=path.relative(workspace,path.resolve(file));
 if(ref.startsWith('..')){if(!fs.existsSync(file))return [];return validateRecipes(JSON.parse(fs.readFileSync(file,'utf8')).recipes,root,scope);}
 if(!structuredExists(workspace,ref))return [];
 return validateRecipes(readStructured(workspace,ref).recipes,root,scope);
}
function validateRecipes(rows:any,root:string,scope:{appId:string;activityId:string}){if(!Array.isArray(rows))throw Error('Invalid recipe registry');
 return rows.filter((r:any)=>{
  if(r.state!=='validated'||r.scope?.appId!==scope.appId||(r.scope.activityId!==undefined&&r.scope.activityId!==scope.activityId)||!r.id||!r.version||!Array.isArray(r.steps)||!r.steps.length)return false;
  const hash=createHash('sha256').update(JSON.stringify(r.steps)).digest('hex');if(hash!==r.stepsSha256)return false;
  const runs=new Set<string>();for(const v of r.validations??[]){if(v.independent===true&&v.status==='completed'&&v.stepsSha256===hash&&v.sessionId&&typeof v.evidenceFile==='string'&&fs.existsSync(path.resolve(root,v.evidenceFile)))runs.add(v.sessionId);}
  return runs.size>=2;
 });
}
