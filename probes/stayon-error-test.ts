import { runActivity } from '../runner/signin';

try {
  await runActivity({ activityId: 'does_not_exist' });
} catch (e: any) {
  console.log('预期抛错:', String(e?.message ?? e).slice(0, 70));
}