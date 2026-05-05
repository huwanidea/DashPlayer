import UrlUtil from '@/common/utils/UrlUtil';
import StrUtil from '@/common/utils/str-util';
import { Nullable } from '@/common/types/Types';
import { TypeGuards } from '@/backend/utils/TypeGuards';
import { getRendererLogger } from '@/fronted/log/simple-logger';

/** 最大缓存条目数量，防止内存持续增长 */
const MAX_CACHE_SIZE = 100;
/** 缓存 Map + 访问顺序追踪（数组头部为最旧） */
const cache = new Map<string, string>();
/** 访问顺序记录，用于 LRU 淘汰 */
const accessOrder: string[] = [];
const api = window.electron;
let player: HTMLAudioElement | null = null;

/**
 * 将条目添加到 LRU 缓存，超出容量时淘汰最旧条目。
 * @param key 缓存键
 * @param value 缓存值
 */
function addToCache(key: string, value: string): void {
    if (cache.has(key)) {
        // 已存在：更新值并移到最后（最新）
        const idx = accessOrder.indexOf(key);
        if (idx !== -1) {
            accessOrder.splice(idx, 1);
        }
    } else if (cache.size >= MAX_CACHE_SIZE) {
        // 容量已满：淘汰最旧的条目
        const oldest = accessOrder.shift();
        if (oldest) {
            const oldUrl = cache.get(oldest);
            if (oldUrl) {
                URL.revokeObjectURL(oldUrl);
            }
            cache.delete(oldest);
        }
    }
    cache.set(key, value);
    accessOrder.push(key);
}

async function getAudioUrl(outURl: string) {
    let audioUrl = cache.get(outURl);
    if (!audioUrl) {
        const data = await fetch(UrlUtil.toUrl(outURl));
        const blob = new Blob([await data.arrayBuffer()]);
        audioUrl = URL.createObjectURL(blob);
        addToCache(outURl, audioUrl);
    } else {
        // 命中缓存时更新 LRU 顺序
        const idx = accessOrder.indexOf(outURl);
        if (idx !== -1) {
            accessOrder.splice(idx, 1);
            accessOrder.push(outURl);
        }
    }
    return audioUrl;
}

export const playAudioUrl = async (audioUrl: Nullable<string>) => {
    if (TypeGuards.isNull(audioUrl)) {
        return;
    }
    player?.pause();
    getRendererLogger('AudioPlayer').debug('play audio url', { audioUrl });
    player = new Audio(audioUrl);
    player.volume = 0.5;
    await player.play();
};

export const playUrl = async (outURl: string) => {
    const audioUrl = await getAudioUrl(outURl);
    getRendererLogger('AudioPlayer').debug('play url', { url: outURl });
    await playAudioUrl(audioUrl);
};

export const playWord = async (word: string) => {
    let blobUrl = cache.get(word);
    if (blobUrl) {
        // 更新 LRU 顺序
        const idx = accessOrder.indexOf(word);
        if (idx !== -1) {
            accessOrder.splice(idx, 1);
            accessOrder.push(word);
        }
        await playAudioUrl(blobUrl);
        return;
    }
    const trans = await api.call('ai-trans/word', { word });
    const outUrl = trans && 'speakUrl' in trans ? trans.speakUrl : null;
    if (StrUtil.isBlank(outUrl)) {
        return;
    }
    blobUrl = await getAudioUrl(outUrl);
    addToCache(word, blobUrl);
    await playAudioUrl(blobUrl);
};

export const getTtsUrl = async (str: string) => {
    str = str.trim();
    if (StrUtil.isBlank(str)) {
        return;
    }
    let audioUrl = cache.get(str);
    if (audioUrl) {
        // 更新 LRU 顺序
        const idx = accessOrder.indexOf(str);
        if (idx !== -1) {
            accessOrder.splice(idx, 1);
            accessOrder.push(str);
        }
        return audioUrl;
    }

    try {
        audioUrl = await api.call('ai-func/tts', str);
        getRendererLogger('AudioPlayer').debug('tts result', { audioUrl });
    } catch (error) {
        getRendererLogger('AudioPlayer').warn('tts failed', { error });
        return;
    }

    if (!StrUtil.isBlank(audioUrl)) {
        addToCache(str, audioUrl);
        return audioUrl;
    }
    return;
};
