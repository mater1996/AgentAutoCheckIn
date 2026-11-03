# -*- coding: utf-8 -*-
"""Persist the fifth supervised attempt; no phone actions."""
import datetime as dt
import json
import pathlib
import sqlite3
root = pathlib.Path(__file__).resolve().parents[1]
ed = root / 'evidence/ocr-browse-2026-11-01T01-18-29-192Z'
rf = ed / 'result.json'
s = json.loads((ed/'summary.json').read_text())
assert s['stayOnRestored'] is True and not s.get('error')
assert [a['type'] for a in s['actions']] == ['open','back']
lines = lambda n: json.loads((ed/f'frame-{n}.json').read_text())['pages'][0]['lines']
assert any(l['text']=='任务已完成' for l in lines(5))
for n, value in ((2,1520),(7,1540),(8,1540)):
    assert any(l['text']==str(value) and l['bounds'][1]<330 for l in lines(n))
start = dt.datetime.fromisoformat(s['actions'][0]['at'].replace('Z','+00:00'))
settled = dt.datetime.fromisoformat(s['frames'][-1]['at'].replace('Z','+00:00'))
assert (settled-start).total_seconds()<90
now = dt.datetime.now(dt.timezone.utc)
day = start.astimezone(dt.timezone(dt.timedelta(hours=8))).date().isoformat()
db = sqlite3.connect(root/'db/checkin.db'); db.row_factory=sqlite3.Row
rows=db.execute('select * from run where evidence_dir=?',(str(ed),)).fetchall(); assert len(rows)<=1
backup=None
rate=db.execute('select cny_per_unit from asset where id=?',('taobao_coins',)).fetchone()[0]
if rows:
    run_id=rows[0]['id']; assert (rows[0]['balance_before'],rows[0]['balance_after'])==(1520,1540)
else:
    bd=root/'.backups/ocr-task5';bd.mkdir(parents=True,exist_ok=True)
    backup=str(bd/(now.strftime('%Y%m%dT%H%M%S%fZ')+'.db'))
    with sqlite3.connect(backup) as dest: db.backup(dest)
    assert db.execute('pragma quick_check').fetchone()[0]=='ok'
    with db:
        usage={'mode':'supervised','ocrFrames':13,'midsceneCalls':0,'parentVisualAudits':2,'parentModelTokens':None,'automaticRunnerAcceptance':False,'note':'8 successful-session frames plus 3 pre-observation and 2 stopped-before-entry frames'}
        c=db.execute('insert into run(ts,day,account_id,activity_id,status,cold_start,balance_before,balance_after,error,evidence_dir,usage_json) values(?,?,?,?,?,?,?,?,?,?,?)',(start.isoformat(),day,'tb_main','tb_coin','DIAGNOSTIC',0,1520,1540,None,str(ed),json.dumps(usage)))
        run_id=c.lastrowid
        for balance,source in ((1520,'before'),(1540,'after')):
            db.execute('insert into asset_snapshot(ts,day,asset_id,account_id,balance,source,run_id,note) values(?,?,?,?,?,?,?,?)',(now.isoformat(),day,'taobao_coins','tb_main',balance,source,run_id,'SUPERVISED task5; current owning-panel balance; no recharge/payment'))
        db.execute('insert into gain_event(run_id,asset_id,source,units,note) values(?,?,?,?,?)',(run_id,'taobao_coins','settle',1540-1520,'Supervised browse receipt + stable balance; no phone entry/recharge/payment; not autonomous acceptance'))
r={'task':'充话费0元起！','runId':run_id,'status':'supervised_success','automaticRunnerAcceptance':False,'destination':'淘金币话费特惠充值页，带支付优惠框','observedRequirement':'浏览5秒得奖励','completionQuote':['任务已完成','继续逛逛吧'],'receiptFrames':[5],'receiptSource':'OCR; destination requirements audited by parent','balanceBefore':1520,'balanceAfter':1540,'gainCoins':1540-1520,'configuredCnyEquivalent':round((1540-1520)*rate,4),'stableBalanceFrames':[7,8],'progressBefore':None,'progressAfter':None,'replacement':'养小羊免费赚话费（0/1）','actionCounts':{'entry':1,'back':1,'scrollAcrossObservationSessions':1,'payment':0,'input':0},'preEntrySessions':[{'evidenceDir':'evidence/ocr-browse-2026-11-01T01-17-08-657Z','outcome':'read/scroll only; observed actual button 逛一逛; no entry dispatched'},{'evidenceDir':'evidence/ocr-browse-2026-11-01T01-17-51-522Z','outcome':'stopped before tap: asymmetric NFKC comparison rejected fullwidth exclamation; corrected both comparison operands, original identity preserved'}],'observedSecondsEntryToFinalBalance':(settled-start).total_seconds(),'limits':['Parent-directed interactive probe; automated model handoff not implemented','Only local target refresh, no complete inventory','Sensitive prefilled data omitted from summary; raw evidence private','No autonomous or cross-account replay validation','Original scripted matching stopped once before entry; supervised recovery disclosed'],'evidenceDir':str(ed),'backup':backup,'next':'发现精选好物; paused; revalidate before execution'}
if rf.exists():
    r=json.loads(rf.read_text()); assert r['runId']==run_id
r['ledgerReadback']={'run':dict(db.execute('select id,status,balance_before,balance_after from run where id=?',(run_id,)).fetchone()),'gain':[x[0] for x in db.execute('select units from gain_event where run_id=?',(run_id,))],'snapshots':[x[0] for x in db.execute('select balance from asset_snapshot where run_id=? order by id',(run_id,))]}
assert r['ledgerReadback']['gain']==[20] and r['ledgerReadback']['snapshots']==[1520,1540]
rf.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'runId':run_id,'gainCoins':r['gainCoins'],'balanceAfter':r['balanceAfter'],'ledgerReadback':r['ledgerReadback']},ensure_ascii=False))
db.close()
