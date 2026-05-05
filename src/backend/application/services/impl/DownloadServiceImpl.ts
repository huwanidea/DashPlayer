import { inject, injectable } from 'inversify';
import DownloadService from '@/backend/application/services/DownloadService';
import DownloadGateway, { DownloadMetadata } from '@/backend/application/ports/gateways/media/DownloadGateway';
import DpTaskService from '@/backend/application/services/DpTaskService';
import TYPES from '@/backend/ioc/types';
import StorageDirectoryProvider, { StorageDirectoryTarget } from '@/backend/application/ports/gateways/storage/StorageDirectoryProvider';
import path from 'path';
import fs from 'fs';
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
export function sanitizeFileName(name: string): string {
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
export default class DownloadServiceImpl implements DownloadService {
    private logger = getMainLogger('DownloadServiceImpl');

    constructor(
        @inject(TYPES.DownloadGateway) private downloadGateway: DownloadGateway,
        @inject(TYPES.DpTaskService) private dpTaskService: DpTaskService,
        @inject(TYPES.StorageDirectoryProvider) private storageDirectoryProvider: StorageDirectoryProvider,
    ) {}

    public async getMetadata(url: string): Promise<DownloadMetadata> {
        return this.downloadGateway.getMetadata(url);
    }

    public async startDownload(url: string, savePath?: string): Promise<number> {
        const taskId = await this.dpTaskService.create();
        const metadata = await this.getMetadata(url);

        const libraryPath = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.VIDEOS);
        const safeTitle = sanitizeFileName(metadata.title);
        const finalSavePath = savePath || path.join(libraryPath, `${safeTitle}.mp4`);

        // Ensure directory exists
        const dir = path.dirname(finalSavePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.downloadGateway.download({
            taskId,
            url,
            savePath: finalSavePath,
            onProgress: (percent, speed, eta) => {
                this.dpTaskService.process(taskId, {
                    progress: `下载中: ${percent}% ${speed ? `(${speed})` : ''} ${eta ? `ETA: ${eta}` : ''}`,
                    result: JSON.stringify({ percent, speed, eta, path: finalSavePath })
                });
            },
            onCancelable: (cancel) => {
                this.dpTaskService.registerTask(taskId, {
                    cancel: () => cancel()
                });
            }
        }).then(() => {
            this.dpTaskService.finish(taskId, {
                progress: '下载完成',
                result: JSON.stringify({ percent: 100, path: finalSavePath })
            });
            // Extra buffer: ensure file is completely written before ffprobe tries to read it
            setTimeout(() => {
                this.logger.info(`Download complete, file ready: ${finalSavePath}`);
            }, 1000);
        }).catch((err) => {
            this.logger.error('download failed', { error: err.message });
            this.dpTaskService.fail(taskId, {
                progress: `下载失败: ${err.message}`,
                result: JSON.stringify({ error: err.message })
            });
        });

        return taskId;
    }
}
