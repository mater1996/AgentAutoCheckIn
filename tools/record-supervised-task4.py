# -*- coding: utf-8 -*-
"""Persist this supervised attempt; never rerun phone actions."""
import datetime as dt
import json
import pathlib
import sqlite3

root = pathlib.Path(__file__).resolve().parents[1]
ed = root / 'evidence/ocr-browse-2026-11-01T00-53-49-661Z'
result_file = ed / 'result.json'
summary = json.loads((ed / 'summary.json').read_text())
assert summary.get('stayOnRestored') is True and not summary.get('error')
for n in (19, 20):
    lines = json.loads((ed / f'frame-{n}.json').read_text())['pages'][0]['lines']
    assert any('1520' in line['text'] and line['bounds'][1] < 330 for line in lines)
assert any(line['text'] == '任务已完成' for line in json.loads((ed/'frame-15.json').read_text())['pages'][0]['lines'])
now = dt.datetime.now(dt.timezone.utc)
day = now.astimezone(dt.timezone(dt.timedelta(hours=8))).date().isoformat()
db = sqlite3.connect(root / 'db/checkin.db')
db.row_factory = sqlite3.Row
existing = db.execute('select * from run where evidence_dir=?', (str(ed),)).fetchall()
assert len(existing) <= 1
backup = None
if not existing:
    backup_dir = root / '.backups/ocr-task4'
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = str(backup_dir / (now.strftime('%Y%m%dT%H%M%S%fZ')+'.db'))
    with sqlite3.connect(backup) as dest:
        db.backup(dest)
    assert db.execute('pragma quick_check').fetchone()[0] == 'ok'
    rate = db.execute('select cny_per_unit from asset where id=?', ('taobao_coins',)).fetchone()[0]
    with db:
        cur = db.execute('insert into run(ts,day,account_id,activity_id,status,cold_start,balance_before,balance_after,error,evidence_dir,usage_json) values(?,?,?,?,?,?,?,?,?,?,?)', (now.isoformat(),day,'tb_main','tb_coin','DIAGNOSTIC',0,1500,1520,None,str(ed),json.dumps({'mode':'supervised','ocrFrames':20,'midsceneCalls':0,'parentVisualAudits':5,'parentModelTokens':None,'automaticRunnerAcceptance':False})))
        run_id = cur.lastrowid
        for value, source in ((1500,'before'),(1520,'after')):
            db.execute('insert into asset_snapshot(ts,day,asset_id,account_id,balance,source,run_id,note) values(?,?,?,?,?,?,?,?)',(now.isoformat(),day,'taobao_coins','tb_main',value,source,run_id,'SUPERVISED task4; stable owning-panel evidence; parent-directed interactive probe'))
        db.execute('insert into gain_event(run_id,asset_id,source,units,note) values(?,?,?,?,?)',(run_id,'taobao_coins','settle',1520-1500,'SUPERVISED flash-sale browse; receipt + stable balance; not autonomous acceptance'))
else:
    run_id = existing[0]['id']
    assert (existing[0]['balance_before'], existing[0]['balance_after']) == (1500,1520)
    rate = db.execute('select cny_per_unit from asset where id=?',('taobao_coins',)).fetchone()[0]
r = {'task':'来淘宝闪购分百亿补贴','runId':run_id,'status':'supervised_success','automaticRunnerAcceptance':False,'destination':'淘宝闪购 × 淘金币','listInstruction':'下单最高+1000，浏览5秒','observedRequirement':'浏览10秒得奖励','completionQuote':['任务已完成','继续逛逛吧'],'receiptFrames':[10,15,16,17],'receiptSource':'parent frame-10 audit plus OCR frame-15; some earlier OCR frames mixed receipt with underlying shop text','balanceBefore':1500,'balanceAfter':1520,'gainCoins':1520-1500,'configuredCnyEquivalent':round((1520-1500)*rate,4),'progressBefore':None,'progressAfter':None,'progressNote':'Top milestone not visible; not guessed','targetAfter':'Target removed from current viewport; no new complete inventory','transientBalance':{'frame':18,'ocr':1530,'used':False},'stableBalanceFrames':[19,20],'actionCounts':{'scroll':1,'entry':1,'back':2,'confirmExitTap':1},'returnExceptions':['First back opened 确定要离开吗？ modal','Single fresh OCR-targeted 离开会场去看看 tap left the modal visible; no-effect observed','Second system back returned to owning coin task panel'],'limitations':['Interactive probe directed by parent; not autonomous replay','Actual page requirement 10 seconds differs from list 5 seconds','Receipt OCR sometimes overlaps shop text; parent audit used','Initial return balance 1530 was transient; only stable 1520 accepted','Declared 90-second observation budget in original plan was exceeded during supervised return diagnosis; not compliant normal-entry acceptance','Only local target refreshed; remaining inventory requires refresh','Parent inference tokens not measured; no zero-cost claim'],'evidenceDir':str(ed),'backup':backup,'next':'充话费0元起！; paused; revalidate before execution'}
if result_file.exists():
    previous = json.loads(result_file.read_text())
    assert previous['runId'] == run_id
    r = previous
r['ledgerReadback'] = {'run':dict(db.execute('select id,status,balance_before,balance_after from run where id=?',(run_id,)).fetchone()),'gain':[row[0] for row in db.execute('select units from gain_event where run_id=?',(run_id,))],'snapshots':[row[0] for row in db.execute('select balance from asset_snapshot where run_id=? order by id',(run_id,))]}
assert r['ledgerReadback']['gain'] == [20]
assert r['ledgerReadback']['snapshots'] == [1500,1520]
result_file.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(r,ensure_ascii=False,indent=2))
db.close()
