import registerRoute from '@/backend/adapters/ipc/registerRoute';
import { app, dialog, shell } from 'electron';
import path from 'path';
import fsSync from 'fs';
import { clearDB } from '@/backend/infrastructure/db/db';
import { WindowState } from '@/common/types/Types';
import { checkUpdate } from '@/backend/application/services/CheckUpdate';
import { inject, injectable } from 'inversify';
import Controller from '@/backend/adapters/controllers/Controller';
import StrUtil from '@/common/utils/str-util';
import TYPES from '@/backend/ioc/types';
import OpenDialogOptions = Electron.OpenDialogOptions;
import WindowPort from '@/backend/application/ports/gateways/window/WindowPort';
import SystemConfigService from '@/backend/application/services/SystemConfigService';
import { UPDATE_TOAST_LAST_SHOWN_AT_KEY } from '@/common/constants/systemConfigKeys';
import { UpdateCheckResult } from '@/common/types/update-check';
import { RESET_DB_RESYNC_FLAG } from '@/common/constants/resetDb';
import StorageDirectoryProvider, {
    StorageDirectoryTarget,
} from '@/backend/application/ports/gateways/storage/StorageDirectoryProvider';
import { SettingsStore } from '@/backend/application/ports/gateways/SettingsStore';
import { getMainLogger } from '@/backend/infrastructure/logger';

/**
 * eg: .mkv -> mkv
 * @param filter
 */
function processFilter(filter: string[]) {
    return filter
        .filter(f => StrUtil.isNotBlank(f))
        .map(f => f.replace(/^\./, ''));
}

@injectable()
export default class SystemController implements Controller {
    private static readonly UPDATE_TOAST_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
    private logger = getMainLogger('SystemController');

    @inject(TYPES.WindowPort)
    private windowPort!: WindowPort;
    @inject(TYPES.StorageDirectoryProvider)
    private storageDirectoryProvider!: StorageDirectoryProvider;
    @inject(TYPES.SystemConfigService)
    private systemConfigService!: SystemConfigService;
    @inject(TYPES.SettingsStore)
    private settingsStore!: SettingsStore;

    public async info() {
        const platform = process.platform;
        return {
            isWindows: platform === 'win32',
            isMac: platform === 'darwin',
            isLinux: platform === 'linux',
            pathSeparator: path.sep,
        };
    }

    public async selectFile(filter: string[]): Promise<string[]> {
        const f = processFilter(filter);
        const files = await dialog.showOpenDialog({
            properties: ['openFile', 'multiSelections'],
            filters: [{
                name: 'Files',
                extensions: f
            }]
        });
        return files.filePaths;
    }

    public async selectFolder({ defaultPath , createDirectory}: { defaultPath?: string,createDirectory?:boolean }): Promise<string[]> {
        const options: OpenDialogOptions = {
            properties: ['openDirectory']
        };
        if (defaultPath) {
            options.defaultPath = defaultPath;
        }
        if (createDirectory) {
            options.properties?.push('createDirectory');
        }
        const files = await dialog.showOpenDialog(options);
        return files.filePaths;
    }

    public async pathInfo(p: string): Promise<{
        baseName: string,
        dirName: string,
        extName: string,
    }> {
        return {
            baseName: path.basename(p),
            dirName: path.dirname(p),
            extName: path.extname(p)
        };
    }

    public async resetDb() {
        await clearDB();
        app.relaunch({ args: [...process.argv.slice(1), RESET_DB_RESYNC_FLAG] });
        app.quit();
    }

    public async openFolder(p: string) {
        const folder = path.dirname(p);
        await shell.openPath(folder);
    }

    public async setWindowButtonsVisible(visible: boolean) {
        this.windowPort.setWindowButtonsVisible(visible);
    }

    public async changeWindowSize(state: WindowState) {
        this.windowPort.changeWindowSize(state);
    }

    public async windowState(): Promise<WindowState> {
        return this.windowPort.windowState();
    }

    public async checkUpdate(params?: { mode?: 'toast' }): Promise<UpdateCheckResult> {
        const result = await checkUpdate();
        if (params?.mode !== 'toast' || result.status !== 'ok' || result.releases.length === 0) {
            return result;
        }

        const now = Date.now();
        const lastShownRaw = await this.systemConfigService.getValue(UPDATE_TOAST_LAST_SHOWN_AT_KEY);
        const lastShownAt = lastShownRaw ? Number(lastShownRaw) : 0;
        const shouldNotify =
            Number.isNaN(lastShownAt) || now - lastShownAt >= SystemController.UPDATE_TOAST_MIN_INTERVAL_MS;

        if (shouldNotify) {
            await this.systemConfigService.setValue(UPDATE_TOAST_LAST_SHOWN_AT_KEY, String(now));
        }

        return {
            ...result,
            shouldNotify,
        };
    }

    public async openUrl(url: string) {
        await shell.openExternal(url);
    }

    public async appVersion() {
        return app.getVersion();
    }

    /**
     * 打开当前媒体库根目录。
     *
     * 行为说明：
     * - 直接打开用户配置的路径（storage.path），不做后缀处理；
     * - 若路径为空则使用默认路径；
     * - 目录不存在时尝试打开其父目录。
     */
    public async openCacheDir() {
        const configuredPath = this.settingsStore.get('storage.path');
        this.logger.info(`openCacheDir: configuredPath=${configuredPath}`);
        let targetPath = configuredPath;
        if (StrUtil.isBlank(targetPath)) {
            targetPath = path.join(app.getPath('documents'), 'DashPlayer');
            this.logger.info(`openCacheDir: using default path=${targetPath}`);
        }
        // 目录不存在时尝试打开父目录
        if (!fsSync.existsSync(targetPath)) {
            this.logger.info(`openCacheDir: path not exists, using parent=${path.dirname(targetPath)}`);
            targetPath = path.dirname(targetPath);
        }
        await shell.openPath(targetPath);
    }

    public registerRoutes(): void {
        registerRoute('system/info', (_) => this.info());
        registerRoute('system/select-file', (p) => this.selectFile(p));
        registerRoute('system/select-folder', (p) => this.selectFolder(p));
        registerRoute('system/path-info', (p) => this.pathInfo(p));
        registerRoute('system/reset-db', (_) => this.resetDb());
        registerRoute('system/open-folder', (p) => this.openFolder(p));
        registerRoute('system/open-folder/cache', () => this.openCacheDir());
        registerRoute('system/window-size/change', (p) => this.changeWindowSize(p));
        registerRoute('system/window-size', () => this.windowState());
        registerRoute('system/window-buttons/visibility', (visible) => this.setWindowButtonsVisible(visible));
        registerRoute('system/check-update', (p) => this.checkUpdate(p));
        registerRoute('system/open-url', (p) => this.openUrl(p));
        registerRoute('system/app-version', () => this.appVersion());
    }
}
