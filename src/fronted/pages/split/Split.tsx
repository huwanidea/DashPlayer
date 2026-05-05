import { cn } from '@/fronted/lib/utils';
import React, { useEffect } from 'react';
import { Button } from '@/fronted/components/ui/button';
import { Textarea } from '@/fronted/components/ui/textarea';
import { Label } from '@/fronted/components/ui/label';
import { FileQuestion, FileType2, FileVideo2, Stethoscope, X, AlertTriangle, Zap } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/fronted/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/fronted/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/fronted/components/ui/alert';
import { Progress } from '@/fronted/components/ui/progress';
import { Switch } from '@/fronted/components/ui/switch';
import SplitFile from '@/fronted/pages/split/SplitFile';
import SplitPreview from '@/fronted/pages/split/split-preview';
import useSplit from '@/fronted/hooks/useSplit';
import { useShallow } from 'zustand/react/shallow';
import useSWR from 'swr';
import toast from 'react-hot-toast';
import { AllFormats } from '@/common/utils/MediaUtil';
import { backendClient } from '@/fronted/application/bootstrap/backendClient';
import PageHeader from '@/fronted/components/shared/common/PageHeader';
import { useTranslation as useI18nTranslation } from 'react-i18next';

const api = backendClient;

const example = `
00:00:00 Intro
00:01:10 Part 1
00:10:00 Part 2
00:20:00 Part 3
`;

/**
 * 切分长视频页面。
 * 负责组织左右两栏布局，并确保预览区在窄窗口下优先内部滚动，而不是把整页撑出屏幕。
 */
const Split = () => {
    const { t } = useI18nTranslation('pages');
    const {
        userInput,
        setUseInput,
        videoPath,
        srtPath,
        deleteFile,
        updateFile,
        inputable,
        aiFormat,
        runSplitAll,
        cancelSplit,
        splitStatus,
        splitProgress,
        preciseMode,
        setPreciseMode
    } = useSplit(useShallow(s => ({
        userInput: s.userInput,
        setUseInput: s.setUseInput,
        videoPath: s.videoPath,
        srtPath: s.srtPath,
        deleteFile: s.deleteFile,
        updateFile: s.updateFile,
        aiFormat: s.aiFormat,
        runSplitAll: s.runSplitAll,
        cancelSplit: s.cancelSplit,
        inputable: s.inputable,
        splitStatus: s.splitStatus,
        splitProgress: s.splitProgress,
        preciseMode: s.preciseMode,
        setPreciseMode: s.setPreciseMode
    })));
    const { data: video } = useSWR(videoPath ? ['system/select-file', videoPath] : null, ([_key, path]) => api.call('system/path-info', path));
    const { data: srt } = useSWR(srtPath ? ['system/select-file', srtPath] : null, ([_key, path]) => api.call('system/path-info', path));
    const onSelect = async () => {
        const files = await api.call('system/select-file', AllFormats);
        files.forEach(updateFile);
    };

    useEffect(() => {
        useSplit.setState({ inputable: true });
    }, []);
    const isSplitting = splitStatus === 'splitting';

    return (
        <div className="w-full h-full flex flex-col overflow-hidden select-none bg-background text-foreground">
            <div className="px-6 pt-6 pb-4 border-b border-border/50">
                <PageHeader
                    title={t('sentenceSplitter.title')}
                    description={t('sentenceSplitter.description')}
                />
            </div>

            <Alert className="m-4 border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800" variant="default">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <AlertTitle className="text-amber-800 dark:text-amber-200 text-sm font-medium">{t('sentenceSplitter.warning.title')}</AlertTitle>
                <AlertDescription className="text-amber-700 dark:text-amber-300 text-xs">
                    {t('sentenceSplitter.warning.description')}
                </AlertDescription>
            </Alert>

            <div className={cn(
                'flex-1 min-h-0 grid gap-6 px-6 py-5 overflow-hidden',
                '[grid-template-columns:minmax(0,1fr)_minmax(0,1.2fr)]'
            )}>
                {/* Left Column: input + files + action buttons */}
                <div className="flex min-w-0 flex-col gap-4 min-h-0">
                    <div className="flex flex-col gap-1.5 flex-1 min-h-0">
                        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            {t('sentenceSplitter.inputLabel')}
                        </Label>
                        <Textarea
                            disabled={!inputable}
                            value={userInput}
                            onChange={e => setUseInput(e.target.value)}
                            placeholder={t('sentenceSplitter.inputPlaceholder')}
                            className="flex-1 resize-none font-mono text-sm"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            {t('sentenceSplitter.filesLabel')}
                        </Label>
                        <div className="rounded-lg border bg-muted/30 p-3 flex flex-col gap-2.5">
                            <div className="flex items-center gap-2.5">
                                <FileVideo2 className="w-4 h-4 shrink-0 text-muted-foreground" />
                                {video?.baseName ? <>
                                    <span className="flex-1 text-sm truncate">{video.baseName}</span>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="w-5 h-5 shrink-0"
                                        onClick={() => deleteFile(videoPath ?? '')}
                                    ><X className="w-3 h-3" /></Button>
                                </> : <span
                                    className="text-sm text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                                    onClick={onSelect}
                                >{t('sentenceSplitter.clickToSelect')}</span>}
                            </div>
                            <div className="flex items-center gap-2.5">
                                <FileType2 className="w-4 h-4 shrink-0 text-muted-foreground" />
                                {srt?.baseName ? <>
                                    <span className="flex-1 text-sm truncate">{srt.baseName}</span>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="w-5 h-5 shrink-0"
                                        onClick={() => deleteFile(srtPath ?? '')}
                                    ><X className="w-3 h-3" /></Button>
                                </> : <span
                                    className="text-sm text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                                    onClick={onSelect}
                                >{t('sentenceSplitter.clickToSelect')}</span>}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 justify-end">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => setUseInput(example.trim())}
                                    ><FileQuestion className="w-4 h-4" /></Button>
                                </TooltipTrigger>
                                <TooltipContent>{t('sentenceSplitter.loadExample')}</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        onClick={aiFormat}
                                        variant="outline"
                                        size="icon"
                                    ><Stethoscope className="w-4 h-4" /></Button>
                                </TooltipTrigger>
                                <TooltipContent>{t('sentenceSplitter.aiFormat')}</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </div>

                {/* Right Column: tabs + split button */}
                <div className="flex min-w-0 flex-col gap-3 min-h-0">
                    <Tabs
                        defaultValue="preview"
                        className="flex min-w-0 flex-col flex-1 min-h-0"
                    >
                        <TabsList className="grid w-full grid-cols-2 shrink-0">
                            <TabsTrigger value="preview">{t('sentenceSplitter.tabs.preview')}</TabsTrigger>
                            <TabsTrigger value="quickSelect">{t('sentenceSplitter.tabs.quickSelect')}</TabsTrigger>
                        </TabsList>
                        <TabsContent
                            value="preview"
                            className="mt-2 min-w-0 flex-1 overflow-auto scrollbar-thin"
                        >
                            <SplitPreview className="w-full" />
                        </TabsContent>
                        <TabsContent
                            value="quickSelect"
                            className="mt-2 min-w-0 flex-1 overflow-y-auto"
                        >
                            <SplitFile />
                        </TabsContent>
                    </Tabs>

                    <div className="flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-2">
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="flex items-center gap-2">
                                            <Switch
                                                id="precise-mode"
                                                checked={preciseMode}
                                                onCheckedChange={setPreciseMode}
                                                disabled={isSplitting}
                                            />
                                            <Zap className="w-4 h-4 text-amber-500" />
                                            <Label htmlFor="precise-mode" className="text-xs cursor-pointer">
                                                {t('sentenceSplitter.preciseMode')}
                                            </Label>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p className="max-w-xs">{t('sentenceSplitter.preciseModeTooltip')}</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="secondary" onClick={onSelect}>
                                {t('sentenceSplitter.selectFile')}
                            </Button>
                            {isSplitting && (
                                <Button variant="outline" onClick={cancelSplit}>
                                    {t('sentenceSplitter.cancel')}
                                </Button>
                            )}
                            <Button
                                disabled={isSplitting}
                                onClick={async () => {
                                    try {
                                        await toast.promise(runSplitAll(), {
                                            loading: t('sentenceSplitter.splitting'),
                                            success: t('sentenceSplitter.splitSuccess'),
                                            error: (v: unknown) => v instanceof Error ? v.message : t('sentenceSplitter.splitFailed')
                                        });
                                    } catch {
                                        // handled by toast
                                    }
                                }}
                            >{isSplitting ? `${t('sentenceSplitter.splitting')} ${splitProgress}%` : t('sentenceSplitter.splitAll')}</Button>
                        </div>
                    </div>
                    {isSplitting && (
                        <Progress value={splitProgress} className="h-1.5" />
                    )}
                </div>
            </div>
        </div>
    );
};
export default Split;
