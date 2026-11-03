import test from 'node:test';import assert from 'node:assert/strict';
import {validateProposedAction} from '../runner/staged/observations.ts';
test('proposed tap on payment/cart/login controls is blocked before dispatch',()=>{
 const f:any={id:'f',width:1080,height:2400,lines:[{text:'立即支付',bounds:[700,1800,1000,1900]}]};
 assert.throws(()=>validateProposedAction({type:'tap',x:850,y:1850},f),/prohibited/);
 assert.doesNotThrow(()=>validateProposedAction({type:'back'},f));
 assert.throws(()=>validateProposedAction({type:'launch',package:'other'},f),/unsupported/);
});
