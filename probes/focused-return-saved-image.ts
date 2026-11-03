import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {VisionClient} from '../runner/staged/vision-client.ts';
import {readAiPanel,loadAiPanel} from '../runner/staged/ai-panel-reader.ts';
const root=process.cwd();
const sourceDir=path.resolve('evidence/staged-2026-11-02T11-28-32-462Z');
const id='d2880c56-38cc-490f-9dc4-b2d69ee63693';
const cfg=JSON.parse(fs.readFileSync('data/evidence/plans/tasks-once-20261102/config.json','utf8'));
function credential(){
 if(process.env[cfg.model.apiKeyEnv])return process.env[cfg.model.apiKeyEnv]!;
 const source=fs.readFileSync('runner/staged/main.ts','utf8');
 const expression=source.match(/apiKey:([^\n]+?),timeoutMs:/)?.[1];
 const envName=expression?.match(/process\.env\.([A-Z_]+)/)?.[1];
 if(envName&&process.env[envName])return process.env[envName]!;
 const literal=expression?.match(/\?\?\s*(['"])([^'"]+)\1/)?.[2];
 if(literal&&new URL(cfg.model.baseUrl).hostname==='127.0.0.1')return literal;
 throw Error('Configured vision credential unavailable');
}
const sha=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function main(){
 const dir=path.resolve('evidence','focused-return-recheck-'+new Date().toISOString().replace(/[:.]/g,'-'));
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const original=sha(path.join(sourceDir,id+'.png'));
 const frame=JSON.parse(fs.readFileSync(path.join(sourceDir,id+'.json'),'utf8'));
 delete frame.aiPanelEvidence;delete frame.systemObservation;
 fs.copyFileSync(path.join(sourceDir,id+'.png'),path.join(dir,id+'.png'));frame.path=path.join(dir,id+'.png');
 const model=new VisionClient({baseUrl:cfg.model.baseUrl,model:cfg.model.name,apiKey:credential(),timeoutMs:45000});
 const readMode={purpose:'return-status' as const,task:{name:'充话费0元起！',instruction:'浏览5秒',done:0,total:1}};
 frame.aiPanelEvidence=await readAiPanel({frame,owner:{package:cfg.package,userId:cfg.scope.userId},model,evidenceDir:dir,maxMs:45000,readMode});
 const panel=loadAiPanel(frame,readMode);
 const report={kind:'real-model-saved-image-only-no-device-no-ledger',sourceDir,frameId:id,originalSha256:original,originalUnchanged:original===sha(path.join(sourceDir,id+'.png')),panel,usage:model.usage,evidence:frame.aiPanelEvidence,implementationSha256:sha(path.join(root,'runner/staged/ai-panel-reader.ts'))};
 fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify(frame,null,2),{mode:0o600});
 fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
 console.log(JSON.stringify({dir,status:frame.aiPanelEvidence.status,panel,usage:model.usage,originalUnchanged:report.originalUnchanged}));
 if(!panel||panel.blocked||panel.isPanel||!report.originalUnchanged)process.exitCode=1;
}
main().catch(()=>{console.error('Focused saved-image validation failed');process.exitCode=1;});
