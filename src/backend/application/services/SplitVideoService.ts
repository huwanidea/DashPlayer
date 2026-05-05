
import { ChapterParseResult } from '@/common/types/chapter-result';



export default interface SplitVideoService {
    previewSplit(str: string, videoDuration?: number): Promise<ChapterParseResult[]>;

    splitByChapters({
               videoPath,
               srtPath,
               chapters,
               precise
           }: {
        videoPath: string,
        srtPath: string | null,
        chapters: ChapterParseResult[],
        /** 精确模式：使用 re-encode 而非 -c copy，避免关键帧对齐偏差。默认 false。 */
        precise?: boolean
    }): Promise<string>;
}
