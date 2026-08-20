import type { Context } from "@deepseek-ai/cordis";

/** dsh-image-text-fallback 插件配置 */
export interface Config {
  /** 是否启用,默认 true */
  enabled: boolean;
  /** ocr.py 脚本路径(空=默认 ~/.ocr-tool/ocr.py) */
  ocrScript: string;
  /** ocr.py venv Python 路径(空=默认 ~/.ocr-tool/venv/bin/python) */
  venvPython: string;
  /** 单次 OCR 超时(ms) */
  timeoutMs: number;
  /** 最大并发 OCR 数 */
  maxConcurrent: number;
  /** 内容哈希缓存上限 */
  cacheCap: number;
  /** 显式强制纯文本的 provider 名单(默认空 = 自动识别) */
  textOnlyProviders: string[];
  /** 多引擎路由:auto=本地优先失败升级 modlens;local=仅本地;modlens=全部云端 */
  engineRoute: "auto" | "local" | "modlens";
  /** modlens CLI 入口(空=自动探测 ~/.dsh/profiles/*/node_modules/@liustack/modlens) */
  modlensCli: string;
  /** 显式指定 modlens 视觉 provider(空=用 ~/.modlens/config.json 选中项) */
  modlensProvider: string;
  /** modlens 单次超时(ms) */
  modlensTimeoutMs: number;
  /** 引擎失败冷却(ms),默认 60000 */
  engineCooldownMs: number;
}

export const name: "image-text-fallback";

export const inject: readonly ["llm", "attachments"];

export const Config: import("@deepseek-ai/schemastery").default<Config>;

export function apply(ctx: Context, config: Config): void;