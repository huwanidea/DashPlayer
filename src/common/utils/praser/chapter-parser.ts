/**
 * 章节解析器配置选项
 */
export interface ParseChapterOptions {
    /** 视频总时长（秒），用于设置最后章节的结束时间。省略则使用占位值 99:59:59 */
    videoDuration?: number;
}

import {ChapterParseResult} from "@/common/types/chapter-result";
import TimeUtil from "@/common/utils/TimeUtil";
import StrUtil from '@/common/utils/str-util';

function parseChapter(str: string, options?: ParseChapterOptions): ChapterParseResult[] {
    //split the string by new line
    const lines = str.split('\n')
        .filter(StrUtil.isNotBlank)
        .map((line) => line.trim())
        .map(parseLine);
    if (lines.length > 0) {
        if (lines[0].timestampStart !== '00:00:00') {
            lines.unshift({
                timestampStart: '00:00:00',
                timestampEnd: '00:00:00',
                title: 'Intro Auto Generated',
                timestampValid: true,
                original: ''
            })
        }
    }
    // 调整时间
    for (let i = 0; i < lines.length; i++) {
        if (i + 1 < lines.length) {
            lines[i].timestampEnd = lines[i + 1].timestampStart;
        }
    }
    // 设置最后章节的结束时间
    const lastLine = lines[lines.length - 1];
    if (options?.videoDuration) {
        // 使用实际视频时长
        lastLine.timestampEnd = TimeUtil.secondToTimeStr(options.videoDuration);
    } else {
        // 使用占位值（仅用于预览，实际切分时会使用真实时长）
        lastLine.timestampEnd = '99:59:59';
    }
    // 开始时间必须小于结束时间
    for (let i = 0; i < lines.length; i++) {

        const startSecond = TimeUtil.parseDuration(lines[i].timestampStart);
        const endSecond = TimeUtil.parseDuration(lines[i].timestampEnd)
        if (startSecond > endSecond - 60) {
            lines[i].timestampValid = false;
        }

    }
    return lines;
}


function parseLine(line: string): ChapterParseResult {
    // 按照第一个空格分割
    const firstSpaceIndex = line.indexOf(' ');
    let title = '';
    let timestamp = line;
    if (firstSpaceIndex !== -1) {
        timestamp = line.slice(0, firstSpaceIndex);
        title = line.slice(firstSpaceIndex + 1).trim();
    }

    return {
        timestampStart: TimeUtil.secondToTimeStr(TimeUtil.parseDuration(timestamp)),
        timestampEnd: TimeUtil.secondToTimeStr(TimeUtil.parseDuration(timestamp)),
        timestampValid: true,
        title,
        original: line
    }
}

export default parseChapter;
