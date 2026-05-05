import registerRoute from '@/backend/adapters/ipc/registerRoute';
import Controller from '@/backend/adapters/controllers/Controller';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import SettingService from '@/backend/application/services/SettingService';
import { getMainLogger } from '@/backend/infrastructure/logger';
import SettingsKeyValueService from '@/backend/application/services/impl/SettingsKeyValueService';
import {
    ServiceCredentialSettingDetailVO,
    ServiceCredentialSettingSaveVO,
} from '@/common/types/vo/service-credentials-setting-vo';
import { EngineSelectionSettingVO } from '@/common/types/vo/engine-selection-setting-vo';
import { ShortcutSettingDetailVO, ShortcutSettingSaveVO } from '@/common/types/vo/shortcut-setting-vo';
import { getStorageRootStatus } from '@/backend/infrastructure/storage/StorageDirectorySupport';
import { WhisperCppCli } from '@/backend/infrastructure/media/whisper/WhisperCppCli';
import StorageDirectoryProvider, {
    StorageDirectoryTarget,
} from '@/backend/application/ports/gateways/storage/StorageDirectoryProvider';
import * as fs from 'fs';
import * as path from 'path';

@injectable()
export default class SettingsController implements Controller {
    @inject(TYPES.SettingService) private settingService!: SettingService;
    @inject(TYPES.SettingsKeyValueService) private settingsKeyValueService!: SettingsKeyValueService;
    @inject(TYPES.WhisperCppCli) private whisperCppCli!: WhisperCppCli;
    @inject(TYPES.StorageDirectoryProvider) private storageDirectoryProvider!: StorageDirectoryProvider;
    private logger = getMainLogger('SettingsController');

    /**
     * 获取服务凭据页面详情。
     */
    public async getServiceCredentialsDetail(): Promise<ServiceCredentialSettingDetailVO> {
        return this.settingService.getServiceCredentialsDetail();
    }

    /**
     * 保存服务凭据页面数据。
     */
    public async saveServiceCredentials(settings: ServiceCredentialSettingSaveVO): Promise<void> {
        this.logger.info('update service credentials', {
            settings: {
                ...settings,
                openai: { ...settings.openai, key: '***' },
            },
        });
        await this.settingService.saveServiceCredentials(settings);
    }

    /**
     * 获取功能设置页面详情。
     */
    public async getEngineSelectionDetail(): Promise<EngineSelectionSettingVO> {
        return this.settingService.getEngineSelectionDetail();
    }

    /**
     * 保存功能设置页面数据。
     */
    public async saveEngineSelection(settings: EngineSelectionSettingVO): Promise<void> {
        this.logger.info('update engine selection', { settings });
        await this.settingService.saveEngineSelection(settings);
    }

    public async testOpenAi(): Promise<{ success: boolean, message: string }> {
        this.logger.info('testing openai connection');
        return this.settingService.testOpenAi();
    }

    public async testTencent(): Promise<{ success: boolean, message: string }> {
        this.logger.info('testing tencent connection');
        return this.settingService.testTencent();
    }

    public async testYoudao(): Promise<{ success: boolean, message: string }> {
        this.logger.info('testing youdao connection');
        return this.settingService.testYoudao();
    }

    public async testWhisper(): Promise<{ success: boolean, message: string }> {
        this.logger.info('testing whisper local connection');
        const cliResult = this.whisperCppCli.test();
        if (!cliResult.exists) {
            return { success: false, message: `Whisper CLI 未找到: ${cliResult.executablePath}` };
        }

        const modelsRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.MODELS);
        const modelSize = this.settingsKeyValueService.get('whisper.modelSize') === 'large' ? 'large' : 'base';
        const modelTag = modelSize === 'large' ? 'large-v3' : 'base';
        const modelPath = path.join(modelsRoot, 'whisper', `ggml-${modelTag}.bin`);

        if (!fs.existsSync(modelPath)) {
            return { success: false, message: `Whisper ${modelSize} 模型文件未找到: ${modelPath}` };
        }

        const vadModel = this.settingsKeyValueService.get('whisper.vadModel') === 'silero-v5.1.2' ? 'silero-v5.1.2' : 'silero-v6.2.0';
        // 路径与 WhisperCppArgsBuilder.build() 保持一致：whisper-vad 子目录 + ggml 前缀 + .bin 后缀
        const vadPath = path.join(modelsRoot, 'whisper-vad', `ggml-${vadModel}.bin`);
        const vadExists = fs.existsSync(vadPath);

        return {
            success: true,
            message: `Whisper CLI 就绪，模型: ${modelSize}，VAD: ${vadExists ? '已下载' : '未下载'}`
        };
    }

    public async updateAppearanceSettings(params: { theme: string; fontSize: string }): Promise<void> {
        await this.settingsKeyValueService.set('appearance.theme', params.theme);
        await this.settingsKeyValueService.set('appearance.fontSize', params.fontSize);
    }

    /**
     * 获取快捷键设置详情。
     */
    public async getShortcutSettingsDetail(): Promise<ShortcutSettingDetailVO> {
        return {
            previousSentence: await this.settingsKeyValueService.get('shortcut.previousSentence'),
            nextSentence: await this.settingsKeyValueService.get('shortcut.nextSentence'),
            repeatSentence: await this.settingsKeyValueService.get('shortcut.repeatSentence'),
            playPause: await this.settingsKeyValueService.get('shortcut.playPause'),
            repeatSingleSentence: await this.settingsKeyValueService.get('shortcut.repeatSingleSentence'),
            autoPause: await this.settingsKeyValueService.get('shortcut.autoPause'),
            toggleEnglishDisplay: await this.settingsKeyValueService.get('shortcut.toggleEnglishDisplay'),
            toggleChineseDisplay: await this.settingsKeyValueService.get('shortcut.toggleChineseDisplay'),
            toggleBilingualDisplay: await this.settingsKeyValueService.get('shortcut.toggleBilingualDisplay'),
            toggleWordLevelDisplay: await this.settingsKeyValueService.get('shortcut.toggleWordLevelDisplay'),
            nextTheme: await this.settingsKeyValueService.get('shortcut.nextTheme'),
            adjustBeginMinus: await this.settingsKeyValueService.get('shortcut.adjustBeginMinus'),
            adjustBeginPlus: await this.settingsKeyValueService.get('shortcut.adjustBeginPlus'),
            adjustEndMinus: await this.settingsKeyValueService.get('shortcut.adjustEndMinus'),
            adjustEndPlus: await this.settingsKeyValueService.get('shortcut.adjustEndPlus'),
            clearAdjust: await this.settingsKeyValueService.get('shortcut.clearAdjust'),
            nextPlaybackRate: await this.settingsKeyValueService.get('shortcut.nextPlaybackRate'),
            aiChat: await this.settingsKeyValueService.get('shortcut.aiChat'),
            addClip: await this.settingsKeyValueService.get('shortcut.addClip'),
            openControlPanel: await this.settingsKeyValueService.get('shortcut.openControlPanel'),
        };
    }

    /**
     * 更新快捷键设置。
     */
    public async updateShortcutSettings(params: ShortcutSettingSaveVO): Promise<void> {
        await this.settingsKeyValueService.set('shortcut.previousSentence', params.previousSentence);
        await this.settingsKeyValueService.set('shortcut.nextSentence', params.nextSentence);
        await this.settingsKeyValueService.set('shortcut.repeatSentence', params.repeatSentence);
        await this.settingsKeyValueService.set('shortcut.playPause', params.playPause);
        await this.settingsKeyValueService.set('shortcut.repeatSingleSentence', params.repeatSingleSentence);
        await this.settingsKeyValueService.set('shortcut.autoPause', params.autoPause);
        await this.settingsKeyValueService.set('shortcut.toggleEnglishDisplay', params.toggleEnglishDisplay);
        await this.settingsKeyValueService.set('shortcut.toggleChineseDisplay', params.toggleChineseDisplay);
        await this.settingsKeyValueService.set('shortcut.toggleBilingualDisplay', params.toggleBilingualDisplay);
        await this.settingsKeyValueService.set('shortcut.toggleWordLevelDisplay', params.toggleWordLevelDisplay);
        await this.settingsKeyValueService.set('shortcut.nextTheme', params.nextTheme);
        await this.settingsKeyValueService.set('shortcut.adjustBeginMinus', params.adjustBeginMinus);
        await this.settingsKeyValueService.set('shortcut.adjustBeginPlus', params.adjustBeginPlus);
        await this.settingsKeyValueService.set('shortcut.adjustEndMinus', params.adjustEndMinus);
        await this.settingsKeyValueService.set('shortcut.adjustEndPlus', params.adjustEndPlus);
        await this.settingsKeyValueService.set('shortcut.clearAdjust', params.clearAdjust);
        await this.settingsKeyValueService.set('shortcut.nextPlaybackRate', params.nextPlaybackRate);
        await this.settingsKeyValueService.set('shortcut.aiChat', params.aiChat);
        await this.settingsKeyValueService.set('shortcut.addClip', params.addClip);
        await this.settingsKeyValueService.set('shortcut.openControlPanel', params.openControlPanel);
    }

    /**
     * 更新存储设置。
     *
     * 约束说明：
     * - 收藏集合固定使用 `default`，不再允许外部自定义集合名。
     * - `path` 仅表示媒体库目录，不再承载数据库与日志目录。
     * - `params.collection` 会被忽略，仅保留以兼容现有 IPC 参数结构。
     */
    public async updateStorageSettings(params: { path: string; collection: string }): Promise<void> {
        const nextPath = params.path.trim();
        if (nextPath.length > 0) {
            const status = getStorageRootStatus(nextPath);
            if (!status.available) {
                throw new Error(status.message);
            }
        }
        await this.settingsKeyValueService.set('storage.path', params.path);
        await this.settingsKeyValueService.set('storage.collection', 'default');
    }

    registerRoutes(): void {
        registerRoute('settings/service-credentials/detail', () => this.getServiceCredentialsDetail());
        registerRoute('settings/service-credentials/save', (p) => this.saveServiceCredentials(p));
        registerRoute('settings/service-credentials/test-openai', () => this.testOpenAi());
        registerRoute('settings/service-credentials/test-tencent', () => this.testTencent());
        registerRoute('settings/service-credentials/test-youdao', () => this.testYoudao());
        registerRoute('settings/service-credentials/test-whisper', () => this.testWhisper());
        registerRoute('settings/engine-selection/detail', () => this.getEngineSelectionDetail());
        registerRoute('settings/engine-selection/save', (p) => this.saveEngineSelection(p));
        registerRoute('settings/shortcuts/detail', () => this.getShortcutSettingsDetail());
        registerRoute('settings/appearance/update', (p) => this.updateAppearanceSettings(p));
        registerRoute('settings/shortcuts/update', (p) => this.updateShortcutSettings(p));
        registerRoute('settings/storage/update', (p) => this.updateStorageSettings(p));
    }
}
