import {ChapterParseResult} from '@/common/types/chapter-result';
import registerRoute from '@/backend/adapters/ipc/registerRoute';
import FfmpegServiceImpl from '@/backend/application/services/impl/FfmpegServiceImpl';
import { inject, injectable } from 'inversify';
import Controller from '@/backend/adapters/controllers/Controller';
import TYPES from '@/backend/ioc/types';
import SplitVideoService from '@/backend/application/services/SplitVideoService';
import MediaService from '@/backend/application/services/MediaService';

@injectable()
export default class MediaController implements Controller {

    @inject(TYPES.SplitVideoService)
    private splitVideoService!: SplitVideoService;

    @inject(TYPES.FfmpegService)
    private ffmpegService!: FfmpegServiceImpl;
    @inject(TYPES.MediaService)
    private mediaService!: MediaService;

    public async previewSplit({ topic, videoDuration }: { topic: string; videoDuration?: number }): Promise<ChapterParseResult[]> {
        return this.splitVideoService.previewSplit(topic, videoDuration);
    }

    public async split({
                           videoPath,
                           srtPath,
                           chapters,
                           precise
                       }: {
        videoPath: string,
        srtPath: string | null,
        chapters: ChapterParseResult[],
        precise?: boolean
    }): Promise<string> {
        return await this.splitVideoService.splitByChapters({
            videoPath,
            srtPath,
            chapters,
            precise
        });
    }


    public async thumbnail({filePath, time, quality = 'medium', width, format = 'jpg'}: {
        filePath: string,
        time: number,
        quality?: 'low' | 'medium' | 'high' | 'ultra',
        width?: number,
        format?: 'jpg' | 'png'
    }): Promise<string> {
        return this.mediaService.thumbnail(filePath, time, { quality, width, format });
    }

    public videoLength(filePath: string): Promise<number> {
        return this.ffmpegService.duration(filePath);
    }


    registerRoutes(): void {
        registerRoute('split-video/preview', (p)=>this.previewSplit(p));
        registerRoute('split-video/split', (p)=>this.split(p));
        registerRoute('split-video/thumbnail', (p)=>this.thumbnail(p));
        registerRoute('split-video/video-length', (p)=>this.videoLength(p));
    }
}
