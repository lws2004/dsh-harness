#!/usr/bin/env node

/**
 * 模型下载脚本
 * 在 npm install 时自动执行,下载 OCR 模型文件
 */

const { join } = require('node:path');
const { homedir } = require('node:os');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { execSync } = require('node:child_process');

const MODEL_VERSION = '2.0.0';
const MODEL_DIR = join(homedir(), '.dsh', 'models', 'ocr');

const MODEL_URLS = {
  det: 'https://github.com/RapidAI/RapidOCR/releases/download/v1.4.4/ch_PP-OCRv4_det_infer.onnx',
  rec: 'https://github.com/RapidAI/RapidOCR/releases/download/v1.4.4/ch_PP-OCRv4_rec_infer.onnx',
};

function downloadModels() {
  // 检查是否需要下载
  const versionFile = join(MODEL_DIR, '.version');
  if (existsSync(versionFile)) {
    const current = readFileSync(versionFile, 'utf8').trim();
    if (current === MODEL_VERSION) {
      console.log('[dsh-image-text-fallback] 模型已是最新版本');
      return;
    }
  }

  // 创建目录
  if (!existsSync(MODEL_DIR)) {
    mkdirSync(MODEL_DIR, { recursive: true });
  }

  console.log('[dsh-image-text-fallback] 下载 OCR 模型...');

  // 下载模型
  for (const [name, url] of Object.entries(MODEL_URLS)) {
    const targetPath = join(MODEL_DIR, `${name}.onnx`);
    if (!existsSync(targetPath)) {
      console.log(`  下载 ${name}...`);
      try {
        execSync(`curl -L -o "${targetPath}" "${url}"`, { stdio: 'inherit' });
      } catch (error) {
        console.error(`  下载 ${name} 失败:`, error.message);
      }
    }
  }

  // 写入版本号
  writeFileSync(versionFile, MODEL_VERSION);
  console.log('[dsh-image-text-fallback] 模型下载完成');
}

// 执行
downloadModels();
