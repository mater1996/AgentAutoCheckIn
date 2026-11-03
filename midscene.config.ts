/**
 * Midscene Test 项目配置。
 *
 * 关键：用 createMidsceneNodes 注册官方 Agent，框架会自动注入
 * 通用 AI 节点（aiAct / aiAssert / aiWaitFor / aiQuery ...）和
 * Android 预置节点（launch / terminate / back / home / recentApps / runAdbShell）。
 *
 * 自定义 ensureNoPopup / tapRow 与业务运行器共用 buildNodes 注册表。
 */
import './runner/model';
import { fileURLToPath } from 'node:url';

import { agentFromAdbDevice } from '@midscene/android';
import { defineFileSetup, defineTestProject } from '@midscene/test/config';
import { config as loadEnv } from 'dotenv';

import { buildNodes } from './runner/workflow';
import type { FileContext } from './runner/nodes/ensure-no-popup';

loadEnv({ path: fileURLToPath(new URL('.env', import.meta.url)) });

const DEVICE = process.env.ADB_SERIAL || '3d8a7934';

const fileSetup = defineFileSetup<FileContext, undefined>({
  name: 'android',
  async setup({ env, onTeardown }) {
    const serial = env.ADB_SERIAL || DEVICE;
    const agent = await agentFromAdbDevice(serial);
    onTeardown(() => agent.destroy());
    return { agent, serial, screen: { w: 1080, h: 2400 } };
  },
});

export default defineTestProject<FileContext, undefined>({
  projects: [
    {
      name: 'checkin',
      fileSetup,
      maxConcurrentFiles: 1,
      files: { include: ['data/playbooks/**/*.{yaml,yml}'] },
    },
  ],
  nodes: buildNodes(),
  test: { maxConcurrentFiles: 1, bail: 0, testTimeout: 600_000 },
});