import { getMainLogger } from '@/backend/infrastructure/logger';
import parseChapter from '@/common/utils/praser/chapter-parser';
import path from 'path';
import fs from 'fs';
import { ChapterParseResult } from '@/common/types/chapter-result';
import hash from 'object-hash';
import TimeUtil from '@/common/utils/TimeUtil';
import StrUtil from '@/common/utils/str-util';
import FileUtil from '@/backend/utils/FileUtil';
import { inject, injectable } from 'inversify';
import FfmpegService from '@/backend/application/services/FfmpegService';
import TYPES from '@/backend/ioc/types';
import SplitVideoService from '@/backend/application/services/SplitVideoService';
import SrtUtil from "@/common/utils/SrtUtil";
import StorageDirectoryProvider from '@/backend/application/ports/gateways/storage/StorageDirectoryProvider';



@injectable()
class SplitVideoServiceImpl implements SplitVideoService {

    @inject(TYPES.FfmpegService)
    private ffmpegService!: FfmpegService;
    @inject(TYPES.StorageDirectoryProvider)
    private storageDirectoryProvider!: StorageDirectoryProvider;
    private logger = getMainLogger('SplitVideoServiceImpl');

    public async previewSplit(str: string, videoDuration?: number) {
        return parseChapter(str, { videoDuration });
    }

    async splitByChapters({
                     videoPath,
                     srtPath,
                     chapters,
                     precise = false
                 }: {
        videoPath: string,
        srtPath: string | null,
        chapters: ChapterParseResult[],
        precise?: boolean
    }) {
        await this.storageDirectoryProvider.ensurePathAccessPermissionIfExists(videoPath);

        // 获取视频总时长，验证章节时间是否合理
        const videoDuration = await this.ffmpegService.duration(videoPath);
        const lastChapter = chapters[chapters.length - 1];
        const lastChapterEnd = TimeUtil.parseDuration(lastChapter.timestampEnd);
        // 如果最后章节结束时间超过视频时长或使用占位值（99:59:59），给出警告
        if (lastChapterEnd > videoDuration || lastChapterEnd > 3600 * 100) {
            this.logger.warn('Last chapter end time exceeds video duration', {
                chapterEnd: lastChapterEnd,
                videoDuration,
                timestampEnd: lastChapter.timestampEnd
            });
            // 不阻止执行，但记录警告日志
        }

        const folderName = path.join(path.dirname(videoPath), path.basename(videoPath, path.extname(videoPath)));
        const splitVideos = await this.splitVideoPart(videoPath, chapters, folderName, precise);
        if (StrUtil.isBlank(srtPath) || !fs.existsSync(srtPath)) {
            this.logger.error('srtPath is blank or not exists');
            return folderName;
        }
        // 收集每个视频段的实际时长，用于精确计算 SRT 偏移
        const actualDurations: number[] = [];
        for (const v of splitVideos) {
            const duration = await this.ffmpegService.duration(v);
            actualDurations.push(duration);
        }

        // 计算 SRT 分割时间轴（使用实际段时长而非预期时间）
        // 注意：由于 -c copy 关键帧对齐，第一段的实际起点可能与预期有偏差（通常是负偏移）
        // 这里使用实际段时长来计算，确保 SRT 时间轴与实际视频内容同步
        const srtSplit: {
            start: number,
            end: number,
            name: string,
            duration: number
        }[] = [];
        let cumulativeStart = 0;
        for (let i = 0; i < splitVideos.length; i++) {
            const duration = actualDurations[i];
            srtSplit.push({
                start: cumulativeStart,
                end: cumulativeStart + duration,
                name: splitVideos[i].replace(path.extname(splitVideos[i]), '.srt'),
                duration
            });
            cumulativeStart += duration;
        }

        await this.storageDirectoryProvider.ensurePathAccessPermissionIfExists(srtPath);
        const content = await FileUtil.read(srtPath);
        if (content === null) {
            this.logger.error('read srt file failed');
            return folderName;
        }
        const srt = SrtUtil.parseSrt(content);
        for (const srtItem of srtSplit) {
            const lines = srt
                .filter(line => line.end >= srtItem.start && line.start <= srtItem.end)
                .map((line, index) => ({
                    index: index + 1,
                    start: Math.max(line.start - srtItem.start, 0),
                    end: Math.min(line.end - srtItem.start, srtItem.duration),
                    contentEn: line.contentEn,
                    contentZh: line.contentZh
                }));
            const srtContent = SrtUtil.srtLinesToSrt(lines, {
                reindex: true
            });
            fs.writeFileSync(srtItem.name, srtContent);
        }
        return folderName;
    }

    private async splitVideoPart(videoPath: string, chapters: ChapterParseResult[], folderName: string, precise = false) {
        await this.storageDirectoryProvider.ensurePathAccessPermissionIfExists(folderName);
        if (!fs.existsSync(folderName)) {
            fs.mkdirSync(folderName, { recursive: true });
        }
        const tempFilePrefix = hash(videoPath);
        const cs = chapters.map(chapter => {
            return {
                name: chapter.title,
                time: TimeUtil.parseDuration(chapter.timestampStart),
                timeStr: chapter.timestampStart
            };
        });
        const outputFiles = await this.ffmpegService.splitVideoByTimes({
            inputFile: videoPath,
            times: cs.map(c => c.time).filter(t => t > 0),
            outputFolder: folderName,
            outputFilePrefix: tempFilePrefix,
            precise
        });
        this.logger.info('video split completed', { fileCount: outputFiles.length });
        const splitedVideos: string[] = [];
        const usedNames = new Set<string>();
        // 重命名（处理同名文件冲突）
        for (let i = 0; i < outputFiles.length; i++) {
            const c = cs[i];
            const file = outputFiles[i];
            const ext = path.extname(file);
            let baseName = `${c.timeStr}-${c.name}${ext}`.replaceAll(':', '');
            let newName = path.join(folderName, baseName);

            // 处理文件名冲突：添加序号后缀
            if (usedNames.has(newName.toLowerCase())) {
                let counter = 1;
                while (usedNames.has(path.join(folderName, `${baseName.replace(ext, '')}_${counter}${ext}`).toLowerCase())) {
                    counter++;
                }
                newName = path.join(folderName, `${baseName.replace(ext, '')}_${counter}${ext}`);
            }

            usedNames.add(newName.toLowerCase());
            fs.renameSync(file, newName);
            splitedVideos.push(newName);
        }
        return splitedVideos;
    }
}


export default SplitVideoServiceImpl;
