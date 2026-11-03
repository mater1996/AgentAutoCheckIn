import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {resolveDatabasePath,isStorageMigrated,STORAGE_DDL} from '../storage/index.ts';
import {readStructured,structuredExists} from '../storage/structured.ts';
import {validateSplitTaskRecords} from '../task-records-v2.ts';
import {sharedReviewKnowledge} from './source-archive.ts';
import {assessRewardAttribution,type RewardAttribution} from './reward-attribution.ts';

export type StagedSession = {
  id: string; evidenceDir: string; startedAt: string; configFile?: string;
  scope: {appId: string; accountId: string; activityId: string; userId: number};
};
export type StagedResult = {
  status: 'completed' | 'stopped' | 'unknown';
  task?: {name: string; instruction: string; done: number; total: number;
    displayRewardCoins?: number | null; button?: unknown;
    beforeFrame: {path: string; ocrPath?: string}; afterDone?: number; afterTotal?: number};
  balanceBefore: number | null; balanceAfter: number | null;
  receipt?: {frameId: string; path: string; quote: string; taskAttemptId: string};
  rewardAttribution?: RewardAttribution;
  taskAttemptId?: string; nextTask?: unknown; error?: string; usedExperienceVersionId?: string | null;
};
export type SaveStagedInput = {
  root?: string; archiveKnowledge?:boolean; session: StagedSession; result: StagedResult; stages: any[]; reviews: any[];
  scriptFiles?: (string | {path: string})[]; usage?: Record<string, any> | Record<string, any>[] | null;
};
export type SavedStagedResult = {
  runId: number | null; gainCoins: number | null; resultFile: string;
  stageIndexFile: string; v2Archived: boolean; partial: boolean; issues: string[];
};
const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const hash = (kind: string, ...parts: unknown[]) => kind + '_' + createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const nullable = (n: unknown) => finite(n) ? n : null;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function upsert(rows: any[], row: any) {
  const old = rows.find(x => x.id === row.id);
  if (old && !same(old, row)) throw Error('Immutable record conflict: ' + row.id);
  if (!old) rows.push(row);
}

/** No client.ts import: opening this module never opens or migrates the live database. */
export async function saveStagedResult(input: SaveStagedInput): Promise<SavedStagedResult> {
  const root = fs.realpathSync(path.resolve(input.root ?? process.cwd()));
  const {session, result, stages, reviews} = input;
  if (!session.id?.trim() || !Array.isArray(stages) || !Array.isArray(reviews)) throw Error('Invalid staged session');
  for (const value of [session.scope.appId, session.scope.accountId, session.scope.activityId])
    if (typeof value !== 'string' || !value.trim() || value === '.' || value === '..' || /[/\\]/.test(value)) throw Error('Invalid scope');
  if (!Number.isInteger(session.scope.userId) || !Number.isFinite(Date.parse(session.startedAt))) throw Error('Invalid session scope/time');
  // All archive targets and their existing ancestors must remain inside this root, including symlinks.
  function target(file: string) {
    const f = path.resolve(root, file), rel = path.relative(root, f);
    if (!rel || rel === '..' || rel.startsWith('..' + path.sep)) throw Error('Path outside root: ' + file);
    let ancestor = f;
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    const realRel = path.relative(root, fs.realpathSync(ancestor));
    if (realRel === '..' || realRel.startsWith('..' + path.sep)) throw Error('Path outside root via symlink: ' + file);
    return f;
  }
  const relative = (file: string) => path.relative(root, target(file));
  const evidenceDir = relative(session.evidenceDir);
  const resultFile = path.join(evidenceDir, 'result.json');
  const stageIndexFile = 'data/stage-records/index.json';
  const outputs = new Map<string, string | Buffer>(), mutable = new Set<string>();
  const add = (f: string, value: unknown, changeable = false) => {
    const file = target(f); outputs.set(file, json(value)); if (changeable) mutable.add(file);
  };
  const preflight = () => {
    for (const [f, bytes] of outputs){
      const rel=path.relative(root,f);
      if(unified&&rel.startsWith('data'+path.sep)&&typeof bytes==='string'){
        if(!mutable.has(f)&&existsData(rel)&&JSON.stringify(readData(rel))!==JSON.stringify(JSON.parse(bytes)))throw Error('Stored immutable conflict: '+rel);
      }else if(fs.existsSync(f)&&!mutable.has(f)&&!fs.readFileSync(f).equals(Buffer.from(bytes)))throw Error('Stored immutable conflict: '+rel);
    }
  };
  const t = result.task;
  if (t && (!t.name?.trim() || typeof t.instruction !== 'string' || !Number.isInteger(t.done) || !Number.isInteger(t.total) || t.done < 0 || t.total <= 0 || t.done > t.total)) throw Error('Invalid task quota/identity');
  if (t) { target(t.beforeFrame.path); if (t.beforeFrame.ocrPath) target(t.beforeFrame.ocrPath); }
  if (result.receipt) target(result.receipt.path);
  const scripts = (input.scriptFiles ?? []).map(s => {
    const p = relative(typeof s === 'string' ? s : s.path), bytes = fs.readFileSync(target(p));
    return {path: p, bytes, sha256: createHash('sha256').update(bytes).digest('hex')};
  });
  const fingerprint = hash('session', session, result, stages, reviews, scripts.map(s => [s.path, s.sha256]), input.usage ?? null);
  const before = nullable(result.balanceBefore), after = nullable(result.balanceAfter);
  const receiptOK = !!(result.taskAttemptId && result.receipt?.taskAttemptId === result.taskAttemptId && result.receipt.frameId && result.receipt.quote?.trim() && fs.existsSync(target(result.receipt.path)));
  const quotaOK = !!t && t.done < t.total && (
    (t.afterDone === undefined && t.afterTotal === undefined) ||
    (Number.isInteger(t.afterDone) && t.afterDone! > t.done && t.afterDone! <= t.total && t.afterTotal === t.total));
  for (const stage of stages) {
    if (!stage || typeof stage !== 'object') continue;
    if (stage.sessionId !== undefined && stage.sessionId !== session.id) throw Error('Stage session scope mismatch');
    if (stage.scope) for (const [key,value] of Object.entries(stage.scope))
      if ((session.scope as any)[key] !== value) throw Error('Stage scope mismatch');
  }
  const stageOK = ['return_list', 'settle'].every(name => stages.some(s => (s?.stageId ?? s?.stage) === name && s.status === 'completed'));
  const attribution=assessRewardAttribution(result);
  const incidentalEvidenceOK=(result.rewardAttribution?.incidentalRewards??[]).every(r=>fs.existsSync(target(r.receipt.path)));
  const unresolvedReportedReward=result.rewardAttribution===undefined&&stages.some(s=>s?.review?.incidentalReceipt||s?.review?.incidentalRewards?.length||s?.incidentalRewards?.length);
  const accepted = result.status === 'completed' && !!t && receiptOK && quotaOK && stageOK && before !== null && after !== null && before > 0 && after > before && attribution.accepted && incidentalEvidenceOK && !unresolvedReportedReward;
  const gainCoins = accepted ? attribution.selectedCoins : null;
  const issues: string[] = [];
  const dbFile = target(resolveDatabasePath(root));
  const unified=isStorageMigrated(root);
  const readData=(ref:string)=>readStructured(root,ref);
  const existsData=(ref:string)=>structuredExists(root,ref);
  if (!fs.existsSync(dbFile)) throw Error('Existing SQLite database required');
  const db = new Database(dbFile, {fileMustExist: true});
  db.pragma('busy_timeout = 5000');
  let runId: number | null = null, v2Archived = false;
  try {
    const account: any = db.prepare('SELECT * FROM account WHERE id=?').get(session.scope.accountId);
    const activity: any = db.prepare('SELECT * FROM activity WHERE id=?').get(session.scope.activityId);
    if (account?.app !== session.scope.appId || account.user_id !== session.scope.userId || activity?.account_id !== account.id) throw Error('Account/activity scope mismatch');
    if (accepted && !activity.asset_id) throw Error('Missing activity asset');
    const backup = target('.backups/staged-' + hash('backup', session.id, evidenceDir) + '.db');
    fs.mkdirSync(path.dirname(backup), {recursive: true});
    if (!fs.existsSync(backup)) await db.backup(backup);
    db.exec(`CREATE TABLE IF NOT EXISTS staged_session_store (
      session_id TEXT PRIMARY KEY, evidence_dir TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, run_id INTEGER
    )`);
    const persistStructured=()=>{if(!unified)return;db.exec(STORAGE_DDL);for(const [file,bytes]of outputs){const key=path.relative(root,file).split(path.sep).join('/');if(key.startsWith('data/')&&typeof bytes==='string'){const content=JSON.stringify(JSON.parse(bytes));db.prepare(`INSERT INTO legacy_document(key,json,content_hash,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json,content_hash=excluded.content_hash,revision=legacy_document.revision+1,updated_at=excluded.updated_at`).run(key,content,createHash('sha256').update(content).digest('hex'),new Date().toISOString());}}};
    db.transaction(() => {
      const prior: any = db.prepare('SELECT * FROM staged_session_store WHERE session_id=? OR evidence_dir=?').get(session.id, evidenceDir);
      if(accepted&&!prior){
        const history=db.prepare('SELECT evidence_dir FROM run WHERE account_id=? AND activity_id=?').all(account.id,activity.id)as any[];
        for(const h of history){try{const p=path.join(h.evidence_dir,'result.json');if(fs.existsSync(p)){const old=read(p);if(old.taskAttemptId===result.taskAttemptId&&typeof old.gainCoins==='number'&&old.gainCoins>0)throw Object.assign(Error('Receipt attempt already credited'),{duplicateReceipt:true});}}catch(e:any){if(e.duplicateReceipt)throw e;}}
      }
      if (prior && (prior.session_id !== session.id || prior.evidence_dir !== evidenceDir || prior.fingerprint !== fingerprint)) throw Error('Immutable session conflict');
      if (prior) runId = prior.run_id;
      else if (t || result.taskAttemptId || stages.length) {
        const status = result.status === 'stopped' ? 'STOPPED' : accepted ? 'DIAGNOSTIC' : 'UNKNOWN';
        const day = new Date(Date.parse(session.startedAt) + 8 * 3600_000).toISOString().slice(0, 10);
        const usage: any = Array.isArray(input.usage) ? (() => {
          const rows = input.usage;
          const sum = (keys: string[]) => {
            const values = rows.map(row => keys.map(key => row[key]).find(v => v !== undefined));
            return values.length && values.every(finite) ? (values as number[]).reduce((a,b)=>a+b,0) : null;
          };
          return {modelCalls:sum(['modelCalls','model_calls','calls']),promptTokens:sum(['promptTokens','prompt_tokens']),
            completionTokens:sum(['completionTokens','completion_tokens']),totalTokens:sum(['totalTokens','total_tokens','tokens']),cachedTokens:sum(['cachedTokens','cached_tokens'])};
        })() : input.usage ?? {};
        const values: Record<string, unknown> = {ts:session.startedAt,day,account_id:account.id,activity_id:activity.id,status,
          balance_before:before,balance_after:after,error:result.error ?? null,evidence_dir:target(evidenceDir),
          prompt_tokens:nullable(usage.promptTokens ?? usage.prompt_tokens),completion_tokens:nullable(usage.completionTokens ?? usage.completion_tokens),
          total_tokens:nullable(usage.totalTokens ?? usage.total_tokens),cached_tokens:nullable(usage.cachedTokens ?? usage.cached_tokens),
          model_calls:nullable(usage.modelCalls ?? usage.model_calls ?? usage.calls),model_name:usage.modelName ?? usage.model_name ?? null,
          usage_json:input.usage == null ? null : JSON.stringify(input.usage)};
        const columns = new Set((db.prepare('PRAGMA table_info(run)').all() as any[]).map(c => c.name));
        const entries = Object.entries(values).filter(([name]) => columns.has(name));
        runId = Number(db.prepare(`INSERT INTO run(${entries.map(([k])=>k).join(',')}) VALUES(${entries.map(()=>'?').join(',')})`).run(...entries.map(([,v])=>v)).lastInsertRowid);
        if (accepted) {
          const snap = db.prepare('INSERT INTO asset_snapshot(ts,day,asset_id,account_id,balance,source,run_id,note) VALUES(?,?,?,?,?,?,?,?)');
          for (const [balance, label] of [[before,'before'],[after,'after']] as const) snap.run(session.startedAt,day,activity.asset_id,account.id,balance,'staged',runId,label);
          db.prepare('INSERT INTO gain_event(run_id,asset_id,source,units,note) VALUES(?,?,?,?,?)').run(runId,activity.asset_id,'task',gainCoins,'Staged diagnostic receipt; independent replay not validated');
        }
      }
      const savedResult = {...result,status:accepted ? 'completed' : result.status === 'stopped' ? 'stopped' : 'unknown',balanceBefore:before,balanceAfter:after,runId,gainCoins,
        sessionId:session.id,learningValidation:'diagnostic_only'};
      add(resultFile,savedResult); add(path.join(evidenceDir,'stages.json'),stages); add(path.join(evidenceDir,'reviews.json'),reviews);
      if(input.archiveKnowledge===false){
        preflight();persistStructured();if(!prior)db.prepare('INSERT INTO staged_session_store(session_id,evidence_dir,fingerprint,run_id) VALUES(?,?,?,?)').run(session.id,evidenceDir,fingerprint,runId);
        v2Archived=true;return;
      }
      const stageManifest = existsData(stageIndexFile) ? readData(stageIndexFile) : {schemaVersion:1,sessions:[],candidates:[]};
      const source = {sessionId:session.id,runId,accountId:account.id,evidenceDir,resultFile};
      const sessionRecord = {id:hash('stagedsession',session.id),scope:session.scope,startedAt:session.startedAt,...source,stagesFile:path.join(evidenceDir,'stages.json'),reviewsFile:path.join(evidenceDir,'reviews.json'),configFile:session.configFile ?? null};
      const sessionPath = `data/stage-records/accounts/${session.scope.appId}/${session.scope.accountId}/${session.scope.activityId}/sessions/${sessionRecord.id}.json`;
      add(sessionPath,sessionRecord); upsert(stageManifest.sessions,{id:sessionRecord.id,path:sessionPath,sessionId:session.id,runId});
      for (const [reviewIndex, envelope] of reviews.entries()) {
        const review = sharedReviewKnowledge(envelope?.review && typeof envelope.review === 'object' ? {...envelope.review,
          stageId:envelope.stageId ?? envelope.review.stageId,stage:envelope.stage ?? envelope.review.stage,
          scope:envelope.scope ?? envelope.review.scope} : envelope);
        const reviewStage = review?.stageId ?? review?.stage;
        if (!review || typeof review !== 'object' || !reviewStage) continue;
        if (typeof reviewStage !== 'string' || !/^[a-z][a-z0-9_]*$/.test(reviewStage)) throw Error('Invalid review stage scope');
        const appStage = ['device_prepare','prepare_device','open_app','launch_app','app_start','app_home','ensure_app'].includes(reviewStage);
        const scope: any = {appId:session.scope.appId,...(appStage ? {} : {activityId:session.scope.activityId}),stage:reviewStage};
        if (review.scope && (review.scope.appId !== scope.appId || review.scope.activityId !== scope.activityId || Object.keys(review.scope).some(key=>!['appId','activityId','stage'].includes(key)) || (review.scope.stage !== undefined && review.scope.stage !== scope.stage))) throw Error('Review scope mismatch');
        const body: any = {scope,validation:'candidate',crossAccountValidated:false,summary:review.summary ?? null,
          orderedSteps:review.orderedSteps ?? [],reusePreconditions:review.reusePreconditions ?? [],knownLimits:review.knownLimits ?? []};
        const noAccountData = (v: any): void => {
          if (!v || typeof v !== 'object') return;
          for (const [key,value] of Object.entries(v)) {
            if (['accountId','userId','done','total','balanceBefore','balanceAfter','gainCoins','observedBalance','frameId','capturedAt','events','actions','receipt','taskAttemptId','sessionId'].includes(key)) throw Error('Operational data in shared candidate: ' + key);
            noAccountData(value);
          }
        };
        if (review.candidateScript) {
          const scriptPath = typeof review.candidateScript === 'string' ? review.candidateScript : review.candidateScript.path;
          const script = scripts.find(s => s.path === relative(scriptPath));
          if (!script) throw Error('Candidate script must be provided in scriptFiles');
          const archived = `data/stage-records/script-sources/${script.sha256}${path.extname(script.path) || '.txt'}`;
          outputs.set(target(archived),script.bytes);
          body.candidateScript = {path:archived,originalPath:script.path,fileSha256:script.sha256,validation:'candidate'};
        }
        if (review.candidateConfig !== undefined) {
          noAccountData(review.candidateConfig);
          const configFile = `data/stage-records/config-candidates/${hash('config',scope,review.candidateConfig)}.json`;
          add(configFile,review.candidateConfig); body.candidateConfig = {path:configFile,validation:'candidate'};
        }
        noAccountData(body);
        const candidate = {id:hash('candidate',scope,session.id,reviewIndex,body),...body,sources:[{...source,reviewIndex,reviewFile:path.join(evidenceDir,'reviews.json')}]};
        const candidatePath = `data/stage-records/knowledge/${scope.appId}/${appStage ? 'app' : 'activities/'+scope.activityId}/stages/${scope.stage}/${candidate.id}.json`;
        add(candidatePath,candidate); upsert(stageManifest.candidates,{id:candidate.id,path:candidatePath,scope,sessionId:session.id,runId});
      }
      add(stageIndexFile,stageManifest,true);
      const indexFile = 'data/task-records-v2/index.json';
      if (t && runId !== null && existsData(indexFile)) {
        const m = readData(indexFile), k = readData(m.knowledgeBundle), a = readData(m.accountBundle);
        if (a.scope.appId !== session.scope.appId || a.scope.accountId !== session.scope.accountId || a.scope.activityId !== session.scope.activityId || a.account.userId !== session.scope.userId || k.application.package !== account.package || a.activity.assetId !== activity.asset_id) throw Error('V2 scope mismatch');
        const scope = a.scope, ks = k.scope;
        const did = hash('definition',ks,t.name,t.instruction), tid = hash('task',scope,did);
        const iid = hash('inventory',scope,session.id), sid = hash('snapshot',scope,session.id), pid = hash('plan',scope,session.id), eid = hash('execution',scope,runId);
        const existingDefinition=k.taskDefinitions.find((x:any)=>x.id===did);
        if(existingDefinition){if(!same(existingDefinition.scope,ks)||existingDefinition.name!==t.name||existingDefinition.instruction!==t.instruction)throw Error('Task definition identity conflict');}
        else upsert(k.taskDefinitions,{id:did,scope:ks,name:t.name,instruction:t.instruction,providerTaskId:null,identityBasis:'observed exact name and instruction'});
        upsert(a.tasks,{id:tid,scope,name:t.name,instruction:t.instruction,taskDefinitionId:did});
        upsert(a.snapshots,{id:sid,scope,inventoryId:iid,taskId:tid,done:t.done,total:t.total,instruction:t.instruction,displayRewardCoins:t.displayRewardCoins ?? null,button:t.button ?? null,evidence:relative(t.beforeFrame.path),ocrSource:t.beforeFrame.ocrPath ? relative(t.beforeFrame.ocrPath) : null,positionAuthority:false});
        upsert(a.inventories,{id:iid,scope,complete:false,source:t.beforeFrame.ocrPath ? relative(t.beforeFrame.ocrPath) : relative(t.beforeFrame.path),taskSnapshotIds:[sid],note:'Partial current task observation; refresh remaining inventory.'});
        upsert(a.plans,{id:pid,scope,inventoryId:iid,decisions:[{taskId:tid,taskSnapshotId:sid,name:t.name,instruction:t.instruction,decision:'do'}],provenance:'Current staged task selection; not a complete inventory plan'});
        upsert(a.executions,{id:eid,scope,runId,taskSnapshotId:sid,planId:pid,decisionTaskSnapshotId:sid,status:savedResult.status,evidenceDir,resultFile,result:savedResult,assetId:activity.asset_id,automaticRunnerAcceptance:false,usedExperienceVersionId:result.usedExperienceVersionId ?? null,derivedExperienceVersionIds:[]});
        upsert(a.progress,{id:hash('progress',scope,eid),scope,planId:pid,executionIds:[eid],requiresInventoryRefresh:true,status:'paused_after_staged_task',nextTask:result.nextTask ?? null});
        validateSplitTaskRecords({schemaVersion:2,knowledge:k,accountData:a});
        for (const [part,key,bundle,kinds] of [[k,'knowledgeRecords',m.knowledgeBundle,['taskDefinitions','scriptVersions','experienceVersions']],[a,'accountRecords',m.accountBundle,['tasks','inventories','snapshots','plans','executions','progress']]] as any[]) {
          m[key] ??= {};
          for (const kind of kinds) m[key][kind] = part[kind].map((row:any) => {const file = path.join(path.dirname(bundle),kind,row.id+'.json'); add(file,row); return file;});
          add(bundle,part,true);
        }
        add(indexFile,m,true); v2Archived = true;
      } else if (t && runId !== null) issues.push('V2 manifest missing; session and ledger persisted, v2 archive pending');
      preflight();persistStructured();
      if (!prior) db.prepare('INSERT INTO staged_session_store(session_id,evidence_dir,fingerprint,run_id) VALUES(?,?,?,?)').run(session.id,evidenceDir,fingerprint,runId);
    })();
    // Immutable records first, mutable bundles next, manifests last. A retry repairs absent files.
    const manifestFiles = new Set([target(stageIndexFile),target('data/task-records-v2/index.json')]);
    const ordered = [...outputs].sort(([a],[b]) => (manifestFiles.has(a)?2:mutable.has(a)?1:0)-(manifestFiles.has(b)?2:mutable.has(b)?1:0));
    for (const [f,bytes] of ordered) {
      if(unified&&path.relative(root,f).startsWith('data'+path.sep)&&typeof bytes==='string')continue;
      if (fs.existsSync(f) && fs.readFileSync(f).equals(Buffer.from(bytes))) continue;
      fs.mkdirSync(path.dirname(f),{recursive:true});
      const temp = f+'.tmp-'+randomUUID();
      try {fs.writeFileSync(temp,bytes,{flag:'wx'});fs.renameSync(temp,f);} finally {if(fs.existsSync(temp))fs.unlinkSync(temp);}
    }
    return {runId,gainCoins,resultFile,stageIndexFile,v2Archived,partial:issues.length>0,issues};
  } finally {db.close();}
}
