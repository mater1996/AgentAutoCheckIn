import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {auditStableScripts} from '../runner/staged/script-validation.ts';

const escape = (s:unknown) => String(s??'').replaceAll('|','\\|').replaceAll('\n',' ');
export function renderStableScriptReport(report:Awaited<ReturnType<typeof auditStableScripts>>) {
  const lines=['# 已学任务稳定脚本状态','',`审计时间：${report.generatedAt}`,`范围：${report.scope.appId}/${report.scope.accountId}/${report.scope.activityId}（Android user ${report.scope.userId}）`,'',
    `候选 ${report.candidateCount} 项，稳定 ${report.stableCount} 项。按 v2 正收益 completed/supervised_success 执行的完整任务名 + instruction 去重；历史成功仅定义候选，不等于稳定。`,
    '验收采用 whole-session 零模型：真实 final/result/stages/usage、正常 main 入口、实际入口与脚本动作、本地脚本授权、可见回执、返回结算、归档与息屏读回；同任务当前归档实现指纹需两个不同 session。人工 validations 不参与判定；diagnostic_only 仅显示。','',
    '实现指纹包含 core main/runtime/engine/device/session/checker 源码与匹配合同、行为配置；源码必须由该 session 的 store candidate/review 绑定至 script-sources，逐文件验 hash 并匹配当前实现。排除账号、plan、次数和来源 run 等运行数据。','',
    '| # | 任务 | instruction | 历史成功 run | 历史成功次数 | 所有尝试 | 同指纹有效 session | 状态 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |'];
  report.tasks.forEach((t,i)=>lines.push(`| ${i+1} | ${escape(t.name)} | ${escape(t.instruction)} | ${t.historicalSuccessRunIds.join(', ')} | ${t.historicalSuccessCount} | ${t.attemptCount} | ${t.qualifyingSessionCount}/2 | ${t.state} |`));
  for(const t of report.tasks) {
    lines.push('',`## ${escape(t.name)} — ${escape(t.instruction)}`,'');
    for(const b of t.blockers)lines.push(`- ${b.code}: ${escape(b.detail)}（${escape(b.file)}）`);
    for(const a of t.attempts) {
      lines.push('',`### Run ${a.runId??'unknown'} · ${a.sessionId??'session 缺失'}`,'',`证据：${escape(a.evidenceDir)}；通过：${a.qualified}；模型调用：${a.modelCalls??'unknown'}；tokens：${a.tokens??'unknown'}；实现指纹：${a.fingerprint??'未证实'}`,'');
      for(const note of a.notes)lines.push(`- 说明：${escape(note)}`);
      for(const b of a.blockers)lines.push(`- ${b.code}: ${escape(b.detail)}（${escape(b.file)}）`);
      for(const source of a.scriptSources)lines.push(`- 源码 ${escape(source.originalPath)} → ${escape(source.archivePath)}；sha256=${source.sha256}`);
    }
  }
  return lines.join('\n')+'\n';
}
export async function runStableScriptAudit(args=process.argv.slice(2)) {
  let root=process.cwd(),indexFile='data/task-records-v2/index.json';
  for(let i=0;i<args.length;i++) {
    if(!['--root','--index'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--'))throw Error('Usage: node --import tsx tools/audit-stable-scripts.ts [--root project] [--index manifest]');
    if(args[i]==='--root')root=path.resolve(args[++i]);else indexFile=args[++i];
  }
  root=fs.realpathSync(root);
  const report=await auditStableScripts({root,indexFile});
  const outputs=[['docs/已学任务稳定脚本状态.json',JSON.stringify(report,null,2)+'\n'],['docs/已学任务稳定脚本状态.md',renderStableScriptReport(report)]] as const;
  const docs=path.join(root,'docs');fs.mkdirSync(docs,{recursive:true});
  const rel=path.relative(root,fs.realpathSync(docs));
  if(rel==='..'||rel.startsWith('..'+path.sep))throw Error('Report directory escapes project root');
  for(const [file,bytes] of outputs) {
    const dest=path.join(root,file),temporary=dest+'.tmp-'+randomUUID();
    try{fs.writeFileSync(temporary,bytes,{flag:'wx'});fs.renameSync(temporary,dest);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  }
  return {candidateCount:report.candidateCount,stableCount:report.stableCount,outputs:outputs.map(([f])=>path.join(root,f))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename))runStableScriptAudit().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error('Stable script audit failed:',e.message);process.exitCode=1;});
