import { injectable } from 'inversify';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import DownloadGateway, { DownloadMetadata, DownloadOptions } from '@/backend/application/ports/gateways/media/DownloadGateway';
import { getRuntimeResourcePath } from '@/backend/utils/runtimeEnv';
import { getMainLogger } from '@/backend/infrastructure/logger';

@injectable()
export default class YtDlpGatewayImpl implements DownloadGateway {
    private logger = getMainLogger('YtDlpGatewayImpl');

    private getBinaryPath(): string {
        const ext = process.platform === 'win32' ? '.exe' : '';
        return getRuntimeResourcePath('lib', `yt-dlp${ext}`);
    }

    private normalizeUrl(url: string): string {
        // Handle Bilibili share links like:
        // https://b23.tv/xxxxxx
        // https://bilibili.com/video/BVxxx/...
        // https://www.bilibili.com/video/BVxxx/?xxx
        // https://b23.tv/xxxxxx?share_source=copy_web&...
        
        // Extract BV/BV1 from Bilibili share URLs
        const bilibiliShareMatch = url.match(/b23\.tv\/([a-zA-Z0-9]+)/i);
        if (bilibiliShareMatch) {
            // For b23.tv short links, we need to first resolve them
            // yt-dlp can handle this directly, but let's return as-is for now
            // as yt-dlp will handle the redirect
        }
        
        // Extract video ID from various Bilibili URL formats
        const bilibiliVideoMatch = url.match(/(?:bilibili\.com\/video\/|video\/)([Bb][Vv][a-zA-Z0-9]+)/);
        if (bilibiliVideoMatch) {
            return `https://www.bilibili.com/video/${bilibiliVideoMatch[1]}`;
        }
        
        return url;
    }

    public async getMetadata(url: string): Promise<DownloadMetadata> {
        const binary = this.getBinaryPath();
        if (!fs.existsSync(binary)) {
            throw new Error(`yt-dlp binary not found at ${binary}`);
        }

        const nodePath = process.execPath;
        const normalizedUrl = this.normalizeUrl(url);
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
        const normalizedUrl = this.normalizeUrl(options.url);

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
                // [download]  10.0% of 100.00MiB at 10.00MiB/s ETA 00:01
                const progressMatch = line.match(/\[download\]\s+([\d.]+)% of\s+[\d.]+(?:MiB|GiB|kiB|B)\s+at\s+([\w\d./]+)\s+ETA\s+([\d:]+)/);
                if (progressMatch) {
                    const percent = parseFloat(progressMatch[1]);
                    const speed = progressMatch[2];
                    const eta = progressMatch[3];
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
