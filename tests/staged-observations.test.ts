import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readPanel, bindTask, stableSettlement, recipeStep} from '../runner/staged/observations.ts';
const page=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8')).pages[0];
const old='evidence/ocr-browse-2026-11-01T01-24-03-352Z/frame-5.json';
test('current OCR frame binds complete task identity and button without fixed quota',()=>{
 const p=page(old),v=readPanel({...p,id:'one'});
 assert.equal(v.isPanel,true);assert.equal(v.balance,1540);
 const t=v.tasks.find(t=>t.name==='好物沉浸看')!;
 assert.equal(t.done,0);assert.equal(t.total,6);assert.equal(t.reward,50);
 const b=bindTask({...p,id:'one'},t);
 assert.ok(b?.point && b.point[0]>881 && b.point[0]<1003 && b.point[1]>1022 && b.point[1]<1067);
 const changed=page('evidence/ocr-browse-2026-11-01T01-25-10-834Z/frame-2.json');
 const cv=readPanel({...changed,id:'two'});
 assert.equal(cv.tasks.find(t=>t.name==='好物沉浸看')?.total,5);
 assert.equal(bindTask({...changed,id:'two'},t),null,'old quota/position authority cannot cross frames');
});
test('panel top accepts whitespace in visible progress without changing its numbers',()=>{assert.equal(readPanel({id:'x',width:1080,height:2400,lines:[{text:'赚金币抵钱',bounds:[390,470,680,530]},{text:'完成进度 6/20',bounds:[40,690,280,730]}]}).top,true);});
test('settlement rejects different owning page or contradictory same task counter',()=>{
 const before={name:'T',instruction:'浏览',done:0,total:6,reward:50,button:'去完成'};
 assert.equal(stableSettlement({before,balanceBefore:100,samples:[{isPanel:true,balance:120,task:{...before,done:1}},{isPanel:true,balance:120,task:{...before,done:1}}],receipt:true}).ok,true);
 assert.equal(stableSettlement({before,balanceBefore:100,samples:[{isPanel:false,balance:120},{isPanel:false,balance:120}],receipt:true}).ok,false);
 assert.equal(stableSettlement({before,balanceBefore:100,samples:[{isPanel:true,balance:120,task:before},{isPanel:true,balance:120,task:before}],receipt:true}).ok,false);
 assert.equal(stableSettlement({before,balanceBefore:100,samples:[{isPanel:true,balance:110},{isPanel:true,balance:120}],receipt:true}).ok,false);
});
test('a receipt and advanced quota with unchanged owning balance cannot settle a new earned reward',()=>{
 const before={name:'T',instruction:'浏览',done:0,total:6,reward:20,button:'去完成'};
 assert.equal(stableSettlement({before,balanceBefore:100,samples:[{isPanel:true,balance:100,task:{...before,done:1}},{isPanel:true,balance:100,task:{...before,done:1}}],receipt:true}).ok,false);
});
test('candidate recipe cannot execute; validated recipe uses current text and stops when target missing',()=>{
 const frame={...page(old),id:'one'};
 const candidate={id:'r',version:'1',state:'candidate',stageId:'return_list',steps:[{kind:'back'}]};
 assert.equal(recipeStep(candidate,frame,0),null);
 const validated={...candidate,state:'validated',steps:[{kind:'tap_text',text:'去完成',nearTask:'好物沉浸看'}]};
 assert.equal(recipeStep(validated,frame,0)?.action.type,'tap');
 assert.equal(recipeStep({...validated,steps:[{kind:'tap_text',text:'不存在'}]},frame,0),null);
});
