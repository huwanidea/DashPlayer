import { injectable } from 'inversify';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import DownloadGateway, { DownloadMetadata, DownloadOptions } from '@/backend/application/ports/gateways/media/DownloadGateway';
import { getRuntimeResourcePath } from '@/backend/utils/runtimeEnv';
import { getMainLogger } from '@/backend/infrastructure/logger';

/**
 * Windows 保留设备名，这些名称不能作为文件名使用。
 */
const WINDOWS_RESERVED_NAMES = new Set([
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/**
 * 清理文件名，使其在 Windows 文件系统上安全可用。
 * 处理：
 * 1. 移除非法字符：\\/:*?"<>|
 * 2. 处理 Windows 保留名（添加下划线前缀）
 * 3. 移除首尾空格和点
 * 4. 处理空文件名
 */
function sanitizeFileName(name: string): string {
    // Step 1: Remove illegal characters
    let sanitized = name.replace(/[\\/:*?"<>|]/g, '_');

    // Step 2: Check for Windows reserved names (case-insensitive)
    const baseName = sanitized.split('.')[0].trim().toUpperCase();
    if (WINDOWS_RESERVED_NAMES.has(baseName)) {
        sanitized = '_' + sanitized;
    }

    // Step 3: Remove leading/trailing spaces and dots
    sanitized = sanitized.replace(/^[\s.]+|[\s.]+$/g, '');

    // Step 4: Handle empty result
    if (!sanitized) {
        sanitized = 'untitled';
    }

    return sanitized;
}

@injectable()
export default class YtDlpGatewayImpl implements DownloadGateway {
    private logger = getMainLogger('YtDlpGatewayImpl');

    private getBinaryPath(): string {
        const ext = process.platform === 'win32' ? '.exe' : '';
        return getRuntimeResourcePath('lib', `yt-dlp${ext}`);
    }

    private async normalizeUrl(url: string): Promise<string> {
        // Handle Bilibili share links like:
        // https://b23.tv/xxxxxx
        // https://bilibili.com/video/BVxxx/...
        // https://www.bilibili.com/video/BVxxx/?xxx
        // https://b23.tv/xxxxxx?share_source=copy_web&...

        // Extract video ID from various Bilibili URL formats
        const bilibiliVideoMatch = url.match(/(?:bilibili\.com\/video\/|video\/)([Bb][Vv][a-zA-Z0-9]+)/);
        if (bilibiliVideoMatch) {
            return `https://www.bilibili.com/video/${bilibiliVideoMatch[1]}`;
        }

        // b23.tv short links need to be resolved via HTTP redirect
        const bilibiliShareMatch = url.match(/b23\.tv\/([a-zA-Z0-9]+)/i);
        if (bilibiliShareMatch) {
            try {
                const resolvedUrl = await this.resolveShortUrl(url);
                if (resolvedUrl) {
                    return resolvedUrl;
                }
            } catch (e) {
                this.logger.warn('Failed to resolve b23.tv short link', { url, error: e });
            }
            // Fallback: yt-dlp will handle the redirect during download
        }

        return url;
    }

    /**
     * 使用 HTTP HEAD 请求解析 b23.tv 短链接。
     */
    private async resolveShortUrl(shortUrl: string): Promise<string | null> {
        return new Promise((resolve) => {
            const http = require('http');
            const https = require('https');

            const client = shortUrl.startsWith('https') ? https : http;
            const parsedUrl = new URL(shortUrl);

            const req = client.request({
                hostname: parsedUrl.hostname,
                path: parsedUrl.pathname,
                method: 'HEAD',
                timeout: 5000
            }, (res: any) => {
                // 检查是否有重定向
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    // 递归解析重定向URL，确保返回最终的标准URL
                    const location = res.headers.location;
                    if (location.startsWith('http')) {
                        resolve(location);
                    } else {
                        resolve(`https://${location}`);
                    }
                } else {
                    resolve(null);
                }
            });

            req.on('error', () => resolve(null));
            req.on('timeout', () => {
                req.destroy();
                resolve(null);
            });

            req.end();
        });
    }

    public async getMetadata(url: string): Promise<DownloadMetadata> {
        const binary = this.getBinaryPath();
        if (!fs.existsSync(binary)) {
            throw new Error(`yt-dlp binary not found at ${binary}`);
        }

        const nodePath = process.execPath;
        const normalizedUrl = await this.normalizeUrl(url);
        this.logger.info(`Getting metadata for URL: ${normalizedUrl}`);

        return new Promise((resolve, reject) => {
            const child = spawn(binary, ['-J', `--js-runtimes`, `node:${nodePath}`, normalizedUrl]);
            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                if (code === 0) {
                    try {
                        const json = JSON.parse(stdout);
                        resolve({
                            title: json.title || 'Unknown Title',
                            thumbnail: json.thumbnail,
                            url: normalizedUrl,
                            duration: json.duration,
                        });
                    } catch (e) {
                        reject(new Error(`Failed to parse yt-dlp output: ${e}`));
                    }
                } else {
                    reject(new Error(`yt-dlp exited with code ${code}: ${stderr}`));
                }
            });
        });
    }

    public async download(options: DownloadOptions): Promise<void> {
        const binary = this.getBinaryPath();
        if (!fs.existsSync(binary)) {
            throw new Error(`yt-dlp binary not found at ${binary}`);
        }

        const nodePath = process.execPath;
        const normalizedUrl = await this.normalizeUrl(options.url);

        // Prefer single-file formats to avoid moov atom issues during merge
        // Use direct format that includes both video+audio in one container
        const args = [
            '--newline',
            '--progress',
            '--js-runtimes', `node:${nodePath}`,
            '--format', '(bestvideo+bestaudio/best)[ext=mp4]/(bestvideo+bestaudio/best)',
            '--merge-output-format', 'mp4',
            '-o', options.savePath,
            normalizedUrl,
        ];

        return new Promise((resolve, reject) => {
            const child = spawn(binary, args);

            options.onCancelable?.(() => {
                try {
                    child.kill('SIGKILL');
                } catch (e) {
                    this.logger.warn(`Failed to kill yt-dlp process: ${e}`);
                }
                reject(new Error('Cancelled by user'));
            });

            child.stdout.on('data', (data) => {
                const line = data.toString().trim();
                // yt-dlp progress format: [download] 10.0% of 100.00MiB at 10.00MiB/s ETA 00:01
                // Also handles locale variations like Chinese: [download]  10.0% 的 100.00MiB 于 10.00MiB/s ETA 00:01
                const progressMatch = line.match(/\[download\]\s+([\d.]+)%/);
                if (progressMatch) {
                    const percent = parseFloat(progressMatch[1]);
                    // Try to extract speed and ETA with locale-agnostic patterns
                    const speedMatch = line.match(/(?:at|于)\s+([\d.]+\s*[KMGT]?i?B?\/s)/i);
                    const etaMatch = line.match(/(?:ETA|预计剩余|预计)\s+([\d:]+)/i);
                    const speed = speedMatch ? speedMatch[1] : undefined;
                    const eta = etaMatch ? etaMatch[1] : undefined;
                    options.onProgress?.(percent, speed, eta);
                }
            });

            child.stderr.on('data', (data) => {
                this.logger.warn(`yt-dlp stderr: ${data.toString()}`);
            });

            child.on('close', (code) => {
                if (code === 0) {
                    // Wait for file to be fully written/flushed to disk
                    this.waitForFileWrite(options.savePath!)
                        .then(() => resolve())
                        .catch((err) => {
                            this.logger.warn(`File write wait warning: ${err.message}`);
                            resolve(); // Still resolve - the download itself succeeded
                        });
                } else if (code === null || code === 9) { // SIGKILL returns null code or 9
                    // Ignore, handled by onCancelable reject
                } else {
                    reject(new Error(`yt-dlp download failed with code ${code}`));
                }
            });
        });
    }

    private async waitForFileWrite(filePath: string, maxWaitMs = 10000): Promise<void> {
        return new Promise((resolve, reject) => {
            let lastSize = -1;
            let stableCount = 0;
            const startTime = Date.now();

            const check = () => {
                try {
                    const stat = fs.statSync(filePath);
                    const currentSize = stat.size;

                    if (currentSize === lastSize && currentSize > 0) {
                        stableCount++;
                        if (stableCount >= 3) {
                            resolve();
                            return;
                        }
                    } else {
                        stableCount = 0;
                        lastSize = currentSize;
                    }

                    if (Date.now() - startTime > maxWaitMs) {
                        resolve(); // Timeout - file is likely complete
                    } else {
                        setTimeout(check, 500);
                    }
                } catch (e) {
                    // File not ready yet
                    if (Date.now() - startTime > maxWaitMs) {
                        reject(new Error('File never appeared'));
                    } else {
                        setTimeout(check, 500);
                    }
                }
            };

            setTimeout(check, 500);
        });
    }
}
