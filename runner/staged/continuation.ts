const localDay=(s:string)=>new Date(Date.parse(s)+8*3600_000).toISOString().slice(0,10);
/** Validate provenance before waking a device for an explicit failed-task continuation. */
export function validateContinuation(source:any,session:any,scope:any,now:string,credited:boolean){
 if(!session?.scope||Object.keys(scope).some(k=>session.scope[k]!==scope[k])||!Number.isFinite(Date.parse(session.startedAt))||!Number.isFinite(Date.parse(now))||localDay(session.startedAt)!==localDay(now)||credited||source?.gainCoins>0||source?.status==='completed'||!source?.task?.name||!source.task.instruction||!Number.isInteger(source.task.done)||!Number.isInteger(source.task.total)||source.task.done<0||source.task.done>=source.task.total||!source.taskAttemptId||!Number.isSafeInteger(source.runId)||!Number.isFinite(source.balanceBefore)||source.balanceBefore<=0)throw Error('Invalid continuation source/scope/day or already credited');
 return source;
}
