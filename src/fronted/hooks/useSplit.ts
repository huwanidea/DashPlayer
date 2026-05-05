/**
 * 管理视频切分页面的文件输入、AI 格式化结果和切分任务执行状态。
 */
import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { ChapterParseResult } from '@/common/types/chapter-result';
import MediaUtil from '@/common/utils/MediaUtil';
import useDpTaskCenter, { registerDpTask } from '@/fronted/hooks/useDpTaskCenter';
import { SWR_KEY, swrApiMutate, swrMutate } from '@/fronted/lib/swr-util';
import StrUtil from '@/common/utils/str-util';
import { backendClient } from '@/fronted/application/bootstrap/backendClient';
import { DpTaskState } from '@/backend/infrastructure/db/tables/dpTask';

const api = backendClient;

export interface TaskChapterParseResult extends ChapterParseResult {
    taskId: number | null;
}

export type UseSplitState = {
    videoPath: string | null;
    srtPath: string | null;
    userInput: string;
    parseResult: TaskChapterParseResult[];
    inputable: boolean;
    splitTaskId: number | null;
    splitProgress: number;
    splitStatus: 'idle' | 'splitting' | 'done' | 'error';
    /** 精确模式：使用 re-encode 而非 -c copy，避免关键帧对齐偏差 */
    preciseMode: boolean;
};

export type UseSplitAction = {
    updateFile(filePath: string): void;
    setUseInput(input: string): void;
    deleteFile(filePath: string): void;
    runSplitAll(): Promise<void>;
    aiFormat: () => void;
    cancelSplit(): void;
    setPreciseMode(enabled: boolean): void;
};


const useSplit = create(
    persist(
        subscribeWithSelector<UseSplitState & UseSplitAction>((set, get) => ({
            videoPath: null,
            srtPath: null,
            userInput: '',
            parseResult: [],
            inputable: true,
            splitTaskId: null,
            splitProgress: 0,
            splitStatus: 'idle',
            preciseMode: false,
            updateFile: async (filePath) => {
                if (StrUtil.isBlank(filePath)) {
                    return;
                }
                if (MediaUtil.isMedia(filePath)) {
                    set({ videoPath: filePath });
                }
                if (MediaUtil.isSubtitle(filePath)) {
                    set({ srtPath: filePath });
                }
                set({ parseResult: get().parseResult.map(r => ({ ...r, taskId: null })) });
            },
            setUseInput: (input) => {
                set({ userInput: input });
            },
            deleteFile: (filePath) => {
                if (get().videoPath === filePath) {
                    set({ videoPath: null });
                }
                if (get().srtPath === filePath) {
                    set({ srtPath: null });
                }
            },
            runSplitAll: async () => {
                if (!useSplit.getState().videoPath) {
                    throw new Error('Please select a video file first');
                }
                for (const chapter of get().parseResult) {
                    if (!chapter.timestampValid || StrUtil.isBlank(chapter.title)) {
                        throw new Error('请修正红色部分');
                    }
                }

                // 使用任务中心进行分割，显示进度
                set({ splitStatus: 'splitting', splitProgress: 0 });

                const { preciseMode } = get();
                const taskId = await registerDpTask(async () => {
                    set({ splitProgress: 10 });
                    const result = await api.call('split-video/split', {
                        videoPath: useSplit.getState().videoPath ?? '',
                        srtPath: useSplit.getState().srtPath,
                        chapters: useSplit.getState().parseResult,
                        precise: preciseMode
                    });
                    set({ splitProgress: 90 });
                    await api.call('watch-history/create', [result]);
                    await swrApiMutate('watch-history/list');
                    set({ splitProgress: 100, splitStatus: 'done' });
                    return result;
                }, {
                    onUpdated: (task) => {
                        if (task.status === DpTaskState.IN_PROGRESS) {
                            // 尝试从 result 中解析进度
                            try {
                                const r = JSON.parse(task.result || '{}');
                                if (r.progress !== undefined) {
                                    set({ splitProgress: Math.floor(r.progress) });
                                }
                            } catch {
                                // ignore
                            }
                        }
                    },
                    onFinish: (task) => {
                        if (task.status === DpTaskState.DONE) {
                            set({ splitStatus: 'done', splitProgress: 100 });
                        } else {
                            set({ splitStatus: 'error' });
                        }
                    }
                });

                set({ splitTaskId: taskId });
                return;
            },
            cancelSplit: async () => {
                const taskId = get().splitTaskId;
                if (taskId) {
                    try {
                        await api.call('dp-task/cancel', taskId);
                    } catch {
                        // ignore
                    }
                }
                set({ splitStatus: 'idle', splitTaskId: null, splitProgress: 0 });
            },
            setPreciseMode: (enabled) => set({ preciseMode: enabled }),
            aiFormat: async () => {
                if (StrUtil.isBlank(get().userInput)) {
                    return;
                }
                const userInput = get().userInput;
                set({ inputable: false });
                await useDpTaskCenter.getState().register(() => api.call('ai-func/format-split', userInput), {
                    onUpdated: (task) => {
                        if (StrUtil.isBlank(task?.result)) return;
                        // const res = JSON.parse(task.result) as AiFuncFormatSplitRes;
                        useSplit.setState({
                            userInput: task.result
                        });
                    },
                    onFinish: () => {
                        useSplit.setState({ inputable: true });
                    },
                });
            }
        }))
        , {
            name: 'split-page-info'
        }
    )
);

useSplit.setState({
    inputable: true
});

useSplit.subscribe(
    (s) => s.userInput,
    async (topic) => {
        if (StrUtil.isBlank(topic)) {
            useSplit.setState({ parseResult: [] });
            return;
        }
        const videoPath = useSplit.getState().videoPath;
        let videoDuration: number | undefined;
        if (videoPath) {
            try {
                const info = await api.call('split-video/video-length', videoPath);
                videoDuration = info.duration;
            } catch {
                // Ignore error, preview will use placeholder
            }
        }
        const result = await api.call('split-video/preview', { topic, videoDuration });
        const oldState: Map<string, TaskChapterParseResult> = new Map(useSplit.getState().parseResult.map(r => [r.original, r]));
        useSplit.setState({
            parseResult: result.map(r => ({
                ...r,
                taskId: oldState.get(r.original)?.taskId ?? null
            }))
        });
    }
);


export default useSplit;
