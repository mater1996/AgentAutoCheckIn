import path from 'node:path';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const sourceHash=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function snapshotSources(files:(string|{path:string})[],root=process.cwd()){
 return [...new Set(files.map(f=>path.resolve(root,typeof f==='string'?f:f.path)))].map(file=>({file,sha256:sourceHash(file)}));
}
export function assertSourcesUnchanged(snapshot:{file:string;sha256:string}[]){
 for(const source of snapshot){
  try{if(sourceHash(source.file)!==source.sha256)throw Error('mismatch');}
  catch{throw Error('Source changed during session: '+source.file);}
 }
}


type SourceFile = string | {path:string};
type SourceScope = {appId:string;activityId:string};

/** Runtime review steps are execution evidence, not reusable procedure steps.
 * Keep their complete envelopes in session reviews; never strip owner keys from
 * actions to manufacture an executable cross-account candidate.
 */
export function sharedReviewKnowledge(review:any){
 if(!review || typeof review!=='object')return review;
 const procedure=(steps:any)=>Array.isArray(steps)?steps.filter(step=>!(
  step && typeof step==='object' && typeof step.frameId==='string' &&
  step.action && typeof step.action.type==='string' && typeof step.source==='string' &&
  typeof step.status==='string'
 )):steps;
 return {...review,orderedSteps:procedure(review.orderedSteps),
  ...(review.candidateConfig && typeof review.candidateConfig==='object' && Array.isArray(review.candidateConfig.steps)
   ?{candidateConfig:{...review.candidateConfig,steps:procedure(review.candidateConfig.steps)}}:{})};
}

/** Source provenance only: store archives these bytes as candidates, never validation. */
export function makeSourceReviews(scriptFiles:SourceFile[],reviews:any[],scope:SourceScope,root=process.cwd()){
 const relative=(file:string)=>path.relative(root,path.resolve(root,file));
 const seen=new Set<string>();
 for(const envelope of reviews){
  const review=envelope?.review??envelope;
  const candidate=review?.candidateScript;
  const file=typeof candidate==='string'?candidate:candidate?.path;
  if(typeof file==='string'&&file===relative(file))seen.add(file);
 }
 return scriptFiles.flatMap(source=>{
  const file=relative(typeof source==='string'?source:source.path);
  if(seen.has(file))return [];
  seen.add(file);
  return [{stageId:'script_sources',scope:{appId:scope.appId,activityId:scope.activityId,stage:'script_sources'},
   summary:'Implementation/config source archive reference; provenance only, not stability validation',candidateScript:file}];
 });
}
