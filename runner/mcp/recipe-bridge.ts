import {randomUUID} from 'node:crypto';
import {runStage} from '../staged/engine.ts';
import type {StageInput,StageDeps,StageResult} from '../staged/contracts.ts';

/** Runtime opts.runStage adapter: check-in execution never derives review candidates. */
export function runRecipeStage(input:StageInput,deps:StageDeps):Promise<StageResult> {
  const {review:_review,...execution} = deps;
  return runStage(input,execution);
}

export type DecisionRequest = {prompt:string; frame?:any; context?:any; maxMs?:number; signal?:AbortSignal; [key:string]:any};
export type PendingDecision = {id:string; request:Omit<DecisionRequest,'signal'|'maxMs'>};
export type DecisionSnapshot = {status:'needs_decision'; decision:PendingDecision} | {status:'running'|'idle'};
export type Snapshot =
  | {status:'idle'}
  | {status:'running'; id:string; cancelling?:boolean}
  | {status:'needs_decision'; id:string; decision:PendingDecision}
  | {status:'completed'; id:string; result:any}
  | {status:'stopped'; id:string; result?:any; error?:string; cancelled?:boolean};

function parseAnswer(value:any):Record<string,any> {
  try {
    if(typeof value === 'string') value = JSON.parse(value);
    if(!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    const seen = new Set<object>();
    const visit = (v:any):void => {
      if(v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return;
      if(typeof v !== 'object' || seen.has(v)) throw Error();
      if(!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw Error();
      seen.add(v); for(const item of Object.values(v)) visit(item); seen.delete(v);
    };
    visit(value);
    return JSON.parse(JSON.stringify(value));
  } catch {throw Error('Decision answer must be a JSON object');}
}

/** A local model adapter: no HTTP transport and no human-response deadline. */
export class DecisionChannel {
  readonly hostManagedDecisions = true;
  readonly usage:any[] = [];
  private pending?:{decision:PendingDecision; resolve:(value:any)=>void; reject:(error:Error)=>void; cleanup:()=>void};
  private listeners = new Set<()=>void>();
  private phase:'idle'|'running' = 'idle';
  private closed?:Error;

  query = (request:DecisionRequest):Promise<any> => {
    if(this.closed) return Promise.reject(this.closed);
    if(this.pending) return Promise.reject(Error('A decision is already pending'));
    if(typeof request?.prompt !== 'string' || !request.prompt.trim()) return Promise.reject(Error('Decision prompt required'));
    if(request.signal?.aborted) return Promise.reject(Error('Decision request aborted'));
    const {signal,maxMs:_maxMs,...data} = request;
    const decision = {id:randomUUID(), request:structuredClone(data)};
    const abort = () => {
      const pending = this.pending;
      if(pending?.decision.id !== decision.id) return;
      this.pending = undefined; pending.cleanup();
      pending.reject(Error('Decision request aborted')); this.emit();
    };
    const promise = new Promise<any>((resolve,reject) => {
      this.pending = {decision,resolve,reject,cleanup:()=>signal?.removeEventListener('abort',abort)};
    });
    signal?.addEventListener('abort',abort,{once:true});
    this.phase = 'running';
    this.emit();
    return promise;
  };

  snapshot():DecisionSnapshot {
    return this.pending ? {status:'needs_decision',decision:structuredClone(this.pending.decision)} : {status:this.phase};
  }

  answer(id:string,value:any):void {
    if(!this.pending || this.pending.decision.id !== id) throw Error('Unknown, stale or already answered decision id');
    const copy = parseAnswer(value);
    const pending = this.pending;
    this.pending = undefined;
    pending.cleanup();
    pending.resolve(copy);
    this.emit();
  }

  cancel(reason = 'Decision channel cancelled'):void {
    this.closed ??= Error(reason);
    const pending = this.pending;
    this.pending = undefined;
    this.phase = 'idle';
    pending?.cleanup();
    pending?.reject(this.closed);
    this.emit();
  }

  /** Called after the owning job exits; the channel may serve its next stage. */
  finish():void {
    const pending = this.pending;
    this.pending = undefined;
    pending?.cleanup();
    pending?.reject(Error('Owning recipe job exited before answering decision'));
    this.phase = 'idle'; this.emit();
  }

  /** Internal event subscription; all waits are driven by state changes. */
  subscribe(listener:()=>void):()=>void {
    this.listeners.add(listener);
    return () => {this.listeners.delete(listener);};
  }

  private emit():void {for(const listener of this.listeners) listener();}
}

/** Owns one uninterrupted stage Promise, including all visual interruptions. */
export class RecipeBridge {
  private active?:{id:string; done:Promise<void>; cancelling:boolean};
  private last:Snapshot = {status:'idle'};
  private waiters = new Set<()=>void>();
  private closed = false;
  private seenIds = new Set<string>();
  private unsubscribe:()=>void;
  constructor(private readonly channel:DecisionChannel) {this.unsubscribe = channel.subscribe(()=>this.notify());}

  start(id:string,fn:()=>Promise<any>):Promise<Snapshot> {
    if(this.closed) return Promise.reject(Error('Recipe bridge is closed/cancelled'));
    if(this.active) return Promise.reject(Error('A recipe job is already active'));
    if(this.seenIds.has(id)) return Promise.reject(Error('Recipe job id already used; replay is forbidden'));
    this.seenIds.add(id);
    const job = {id, done:Promise.resolve(), cancelling:false};
    this.active = job;
    job.done = Promise.resolve().then(fn).then(result => {
      this.last = result?.status && result.status !== 'completed'
        ? {status:'stopped',id,result} : {status:'completed',id,result};
    },error => {this.last = {status:'stopped',id,error:error instanceof Error ? error.message : String(error)};})
      .finally(()=>{
        if(job.cancelling) this.last = {...this.last,status:'stopped',id,cancelled:true};
        this.active = undefined; this.channel.finish(); this.notify();
      });
    return this.awaitSignal();
  }

  status():Snapshot {
    if(!this.active) return structuredClone(this.last);
    const current = this.channel.snapshot();
    if(current.status === 'needs_decision') return {status:'needs_decision',id:this.active.id,decision:current.decision};
    return {status:'running',id:this.active.id,...(this.active.cancelling ? {cancelling:true} : {})};
  }

  async respond(decisionId:string,value:any):Promise<Snapshot> {
    if(!this.active) return Promise.reject(Error('No active recipe job'));
    this.channel.answer(decisionId,value);
    return this.awaitSignal();
  }

  async cancel(reason = 'Recipe cancelled'):Promise<void> {
    this.closed = true;
    const job = this.active;
    if(job) job.cancelling = true;
    this.channel.cancel(reason);
    if(job) await job.done;
    this.unsubscribe();
  }

  private awaitSignal():Promise<Snapshot> {
    const current = this.status();
    if(current.status !== 'running') return Promise.resolve(current);
    return new Promise(resolve => {
      const listener = () => {const next = this.status(); if(next.status !== 'running'){this.waiters.delete(listener);resolve(next);}};
      this.waiters.add(listener);
    });
  }
  private notify():void {for(const waiter of this.waiters) waiter();}
}
