/** 读 config/agent.yaml。SDK 的环境变量全部由这里填充，不散落在别处。 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export type AgentCfg = {
  enabled: boolean;
  base_url: string;
  auth_token_env: string;
  model: string;
  max_turns: number;
  allowed_tools: string[];
  log_dir: string;
  platform_api: string;
  system_prompt_file: string;
  skills: string[];
};

export function loadAgentCfg(): AgentCfg {
  const f = path.resolve('config', 'agent.yaml');
  const raw = fs.existsSync(f) ? (YAML.parse(fs.readFileSync(f, 'utf8'))?.agent ?? {}) : {};
  return {
    enabled: raw.enabled === true,
    base_url: raw.base_url ?? 'http://127.0.0.1:3427',
    auth_token_env: raw.auth_token_env ?? 'MAGPIE_API_KEY',
    model: raw.model ?? 'codex/gpt-6.1-terra',
    max_turns: Number(raw.max_turns ?? 12),
    allowed_tools: Array.isArray(raw.allowed_tools) ? raw.allowed_tools : [],
    log_dir: raw.log_dir ?? 'logs/agent',
    platform_api: raw.platform_api ?? 'http://127.0.0.1:8787',
    system_prompt_file: raw.system_prompt_file ?? 'config/agent-prompt.md',
    skills: Array.isArray(raw.skills) ? raw.skills : [],
  };
}

/** 把配置灌进 SDK 需要的环境变量；返回实际用的值，便于日志核对 */
export function applyAgentEnv(cfg: AgentCfg): { baseUrl: string; model: string; tokenSet: boolean } {
  process.env.ANTHROPIC_BASE_URL = cfg.base_url;
  process.env.ANTHROPIC_MODEL = cfg.model;
  const token = process.env[cfg.auth_token_env];
  if (token) process.env.ANTHROPIC_AUTH_TOKEN = token;
  // 别被 shell 代理劫到外网
  process.env.NO_PROXY = '127.0.0.1,localhost';
  process.env.no_proxy = '127.0.0.1,localhost';
  return { baseUrl: cfg.base_url, model: cfg.model, tokenSet: !!token };
}