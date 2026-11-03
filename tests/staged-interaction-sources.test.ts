import test from 'node:test';
import assert from 'node:assert/strict';
import * as entry from '../runner/staged/main.ts';
test('normal entry archives generic interaction and reward attribution implementation sources',()=>{
 assert.equal(typeof (entry as any).interactionSourceFiles,'function');
 const {interactionSourceFiles}=entry as any;
 assert.deepEqual(interactionSourceFiles({interactionRoutes:[{type:'quiz'}]}),['runner/staged/interaction.ts','runner/staged/reward-attribution.ts']);
 assert.deepEqual(interactionSourceFiles({}),['runner/staged/reward-attribution.ts']);
 assert.deepEqual(interactionSourceFiles({interactionRoutes:[{type:'home-revisit'}]}),['runner/staged/interaction.ts','runner/staged/home-revisit.ts','runner/staged/home-revisit-route.ts','runner/staged/raw-capture.ts','runner/staged/reward-attribution.ts']);
});
