"use strict";


plugin.onLoad(async () => {
    const { TaskbarLyricsAPI, pluginConfig } = { ...this.base };
    const liblyric = loadedPlugins.liblyric;


    let observer = null;
    let parsedLyric = null;
    let currentIndex = 0;
    let musicId = 0;
    let lastProgressTime = 0;
    let interludeSent = false;
    let isPaused = false;
    let pauseDebounceTimer = null;
    let lineEndTimer = null;
    let lineEndTimerIndex = null;
    let hideDebounceTimer = null;


    const addLog = (...args) => window.TaskbarLyricsLog?.(...args);


    const clearLineEndTimer = () => {
        if (lineEndTimer) clearTimeout(lineEndTimer);
        if (hideDebounceTimer) clearTimeout(hideDebounceTimer);
        lineEndTimer = null;
        lineEndTimerIndex = null;
        hideDebounceTimer = null;
    };


    // 普通 LRC 无法提供句末时间，只能识别显式的空白时间戳作为间奏标记
    const getInterludeMarkers = lyricText => {
        if (typeof liblyric.parsePureLyric !== "function") return [];

        try {
            const lines = liblyric.parsePureLyric(lyricText);
            return lines.flatMap((line, index) => {
                const nextLine = lines[index + 1];
                if (line.lyric.trim() || !nextLine || nextLine.time <= line.time) return [];

                return [{
                    time: line.time,
                    duration: nextLine.time - line.time,
                    originalLyric: "",
                    isInterludeMarker: true
                }];
            });
        } catch {
            return [];
        }
    };


    // 断线重连
    let 正在重连 = false;
    const reconnect = async () => {
        if (正在重连) return;
        正在重连 = true;
        currentIndex = 0;
        addLog("检测到连接断开，正在重启 C++ 程序...", "error");
        const dataPath = (await betterncm.app.getDataPath()).replace("/", "\\");
        const pluginPath = this.pluginPath.replace("/./", "\\").replace("/", "\\");
        const cmd = `taskkill /F /IM "taskbar-lyrics.exe" & xcopy /C /D /Y "${pluginPath}\\taskbar-lyrics.exe" "${dataPath}" && "${dataPath}\\taskbar-lyrics.exe" ${this.base.TaskbarLyricsPort}`;
        await betterncm.app.exec(`cmd /S /C ${cmd}`, false, false);
        addLog("C++ 程序已重启，正在发送配置...", "success");
        TaskbarLyricsAPI.font.font(pluginConfig.get("font"));
        TaskbarLyricsAPI.font.color(pluginConfig.get("color"));
        TaskbarLyricsAPI.font.style(pluginConfig.get("style"));
        TaskbarLyricsAPI.window.position(pluginConfig.get("position"));
        TaskbarLyricsAPI.window.margin(pluginConfig.get("margin"));
        TaskbarLyricsAPI.lyrics.align(pluginConfig.get("align"));
        TaskbarLyricsAPI.window.screen(pluginConfig.get("screen"));
        TaskbarLyricsAPI.animation(pluginConfig.get("transition"));
        addLog("重连配置发送完成", "success");
        正在重连 = false;
    };


    // 心跳保活
    setInterval(async () => {
        try {
            await Promise.race([
                TaskbarLyricsAPI.ping({}),
                new Promise((_, reject) => setTimeout(() => reject(new Error()), 3000))
            ]);
        } catch {
            await reconnect();
        }
    }, 5000);


    // 监视软件内歌词变动
    const watchLyricsChange = async () => {
        const mLyric = await betterncm.utils.waitForElement("#x-g-mn .m-lyric");
        const MutationCallback = mutations => {
            for (const mutation of mutations) {
                let lyrics = {
                    basic: "",
                    extra: ""
                };

                if (mutation.addedNodes[2]) {
                    lyrics.basic = mutation.addedNodes[0].firstChild.textContent;
                    lyrics.extra = mutation.addedNodes[2].firstChild ? mutation.addedNodes[2].firstChild.textContent : "";
                } else {
                    lyrics.basic = mutation.addedNodes[0].textContent;
                }

                TaskbarLyricsAPI.lyrics.lyrics(lyrics);
            }
        }

        observer = new MutationObserver(MutationCallback);
        observer.observe(mLyric, { childList: true, subtree: true });
    }


    // 音乐ID发生变化时
    const play_load = async () => {
        clearLineEndTimer();

        // 获取歌曲信息
        const playingSong = betterncm.ncm.getPlayingSong();
        musicId = playingSong.data.id ?? 0;
        const name = playingSong.data.name ?? "";
        const artists = playingSong.data.artists ?? "";

        // 解析歌手名称
        let artistName = "";
        artists.forEach(item => artistName += ` / ${item.name}`);
        artistName = artistName.slice(3);

        // 发送歌曲信息
        TaskbarLyricsAPI.lyrics.lyrics({
            "basic": name,
            "extra": artistName
        });


        // 解析歌词
        const config = pluginConfig.get("lyrics");
        if ((config["retrieval_method"]["value"] == "2") && window.currentLyrics) {
            // 解决RNP歌词对不上的问题
            while (true) {
                if (window.currentLyrics.hash.includes(musicId)) {
                    parsedLyric = window.currentLyrics.lyrics;
                    break;
                } else {
                    await betterncm.utils.delay(100);
                }
            }
        } else {
            const lyricData = await liblyric.getLyricData(musicId);
            const lyricText = lyricData?.lrc?.lyric ?? "";
            parsedLyric = liblyric.parseLyric(
                lyricText,
                lyricData?.tlyric?.lyric ?? "",
                lyricData?.romalrc?.lyric ?? ""
            );
            parsedLyric = [
                ...parsedLyric.filter(item => item.originalLyric.trim()),
                ...getInterludeMarkers(lyricText)
            ].sort((left, right) => left.time - right.time);
        }


        // RefinedNowPlaying 歌词不带普通 LRC 的间奏标记，保持原有空行清理行为
        if (config["retrieval_method"]["value"] == "2") {
            parsedLyric = parsedLyric.filter(item => item.originalLyric != "");
        }


        // 纯音乐只显示歌曲名与作曲家
        if (
            (parsedLyric.length == 1)
            && (parsedLyric[0].time == 0)
            && (parsedLyric[0].duration != 0)
        ) {
            parsedLyric = [];
        }

        currentIndex = 0;
        interludeSent = false;
    }


    // 发送当前进度对应的歌词
    const sendCurrentLyric = (time, force = false) => {
        if (!parsedLyric) return;

        const adjust = Number(pluginConfig.get("effect")["adjust"]);
        let nextIndex = parsedLyric.findIndex(item => item.time > (time + adjust) * 1000);
        nextIndex = (nextIndex <= -1) ? parsedLyric.length : nextIndex;

        // 间奏中（还没到下一句）或暂停中（非强制补发）不重新发送歌词
        if (!force && ((interludeSent && nextIndex === currentIndex) || isPaused)) {
            currentIndex = nextIndex;
            return;
        }

        if (force || nextIndex != currentIndex) {
            const currentLyric = parsedLyric[nextIndex - 1] ?? "";
            const isInterludeMarker = currentLyric?.isInterludeMarker === true;
            if (isInterludeMarker) {
                const hideConfig = pluginConfig.get("hide");
                const minimumGap = Number(hideConfig["minimum_gap"]);
                const duration = Number(currentLyric.duration) || 0;
                if (!hideConfig["enabled"] || duration < (Number.isFinite(minimumGap) ? minimumGap : 400)) {
                    currentIndex = nextIndex;
                    interludeSent = false;
                    return;
                }
            }

            const lyrics = {
                "basic": currentLyric?.originalLyric ?? "",
                "extra": currentLyric?.translatedLyric ?? ""
            };
            TaskbarLyricsAPI.lyrics.lyrics(lyrics);
            currentIndex = nextIndex;
            interludeSent = isInterludeMarker;
        }
    }


    // 逐字歌词提供实际句末时间，仅在存在足够空档时发送空歌词
    const scheduleLineEndHide = time => {
        clearLineEndTimer();

        const hideConfig = pluginConfig.get("hide");
        if (!hideConfig["enabled"] || !parsedLyric || interludeSent || isPaused) return;

        const adjust = Number(pluginConfig.get("effect")["adjust"]);
        const currentTime = (time + adjust) * 1000;

        let nextIndex = parsedLyric.findIndex(item => item.time > currentTime);
        nextIndex = (nextIndex <= -1) ? parsedLyric.length : nextIndex;

        const currentLyricIndex = nextIndex - 1;
        const currentLyric = parsedLyric[currentLyricIndex];
        if (!currentLyric) return;

        // 没有可信的 duration 就无法确定句末，跳过
        const duration = currentLyric.duration ?? 0;
        const lineStart = currentLyric.dynamicLyricTime;
        const lineEnd = lineStart + duration;
        const nextLyric = parsedLyric[currentLyricIndex + 1];
        const nextLineStart = nextLyric?.dynamicLyricTime;
        const minimumGap = Number(hideConfig["minimum_gap"]);
        const gap = nextLineStart - lineEnd;

        // 普通 LRC 没有真实句末，短空档也不值得触发淡出动画
        if (
            typeof lineStart !== "number"
            || typeof nextLineStart !== "number"
            || duration <= 0
            || gap < (Number.isFinite(minimumGap) ? minimumGap : 400)
        ) return;

        const hideCurrentLine = () => {
            const latestHideConfig = pluginConfig.get("hide");
            if (
                !latestHideConfig["enabled"]
                || isPaused
                || interludeSent
                || currentIndex !== currentLyricIndex + 1
            ) return;

            interludeSent = true;
            addLog("当前歌词播放完成，发送空歌词", "info");
            TaskbarLyricsAPI.lyrics.lyrics({ "basic": "", "extra": "" });
        };

        const queueHideCurrentLine = () => {
            // 留出短暂窗口让紧接着到来的下一句取消隐藏
            hideDebounceTimer = setTimeout(() => {
                hideDebounceTimer = null;
                if (lineEndTimerIndex !== currentLyricIndex) return;
                hideCurrentLine();
            }, 100);
        };

        const delay = lineEnd - currentTime;
        lineEndTimerIndex = currentLyricIndex;
        if (delay <= 0) {
            queueHideCurrentLine();
        } else {
            lineEndTimer = setTimeout(() => {
                lineEndTimer = null;
                if (lineEndTimerIndex !== currentLyricIndex) return;
                queueHideCurrentLine();
            }, delay);
        }
    }


    // 音乐进度发生变化时
    const play_progress = async (_, time) => {
        lastProgressTime = time;
        sendCurrentLyric(time, false);
        scheduleLineEndHide(time);
    }


    // 播放状态变化：暂停发空歌词，恢复立即补发当前歌词
    const play_state = async (_, state) => {
        let playing;
        if (typeof state === "boolean") playing = state;
        else if (typeof state === "number") playing = state !== 0;
        else if (typeof state === "string") {
            const normalizedState = state.trim().toLowerCase();
            const stateFields = normalizedState.split("|");
            if (["play", "playing", "resume", "resumed", "true", "1"].some(value => stateFields.includes(value))) {
                playing = true;
            } else if (["pause", "paused", "false", "0"].some(value => stateFields.includes(value))) {
                playing = false;
            }
        }
        else if (state && typeof state === "object") {
            playing = state.playing ?? state.isPlaying ?? state.data?.playing;
            const t = state.time ?? state.currentTime ?? state.data?.time;
            if (typeof t === "number") lastProgressTime = t;
        }

        // 无法识别的状态格式，记日志方便排查
        if (playing === undefined || playing === null) {
            addLog(`[调试] PlayState 未知格式: ${JSON.stringify(state)}`, "warn");
            return;
        }

        if (playing) {
            // 恢复播放：若暂停防抖还没触发就取消，避免恢复瞬间先清空再补发的闪断
            if (pauseDebounceTimer) {
                clearTimeout(pauseDebounceTimer);
                pauseDebounceTimer = null;
            }
            if (isPaused) {
                isPaused = false;
                addLog("恢复播放，立即补发当前歌词", "info");
                sendCurrentLyric(lastProgressTime, true);
            }
            scheduleLineEndHide(lastProgressTime);
        } else {
            // 暂停：防抖 500ms，过滤恢复瞬间可能出现的瞬时暂停事件
            clearLineEndTimer();
            if (pauseDebounceTimer) clearTimeout(pauseDebounceTimer);
            pauseDebounceTimer = setTimeout(() => {
                pauseDebounceTimer = null;
                if (isPaused) return;
                isPaused = true;
                interludeSent = false;
                addLog("暂停播放，发送空歌词", "info");
                TaskbarLyricsAPI.lyrics.lyrics({ "basic": "", "extra": "" });
            }, 500);
        }
    }



    // 开始获取歌词
    function startGetLyric() {
        const config = pluginConfig.get("lyrics");
        switch (config["retrieval_method"]["value"]) {
            // 软件内词栏
            case 0: {
                watchLyricsChange();
            } break;

            // LibLyric
            case 1: {
                legacyNativeCmder.appendRegisterCall("Load", "audioplayer", play_load);
                legacyNativeCmder.appendRegisterCall("PlayProgress", "audioplayer", play_progress);
                legacyNativeCmder.appendRegisterCall("PlayState", "audioplayer", play_state);
                const playingSong = betterncm.ncm.getPlayingSong();
                if (playingSong && playingSong.data.id != musicId) {
                    play_load();
                }
            } break;

            // RefinedNowPlaying
            case 2: {
                legacyNativeCmder.appendRegisterCall("Load", "audioplayer", play_load);
                legacyNativeCmder.appendRegisterCall("PlayProgress", "audioplayer", play_progress);
                legacyNativeCmder.appendRegisterCall("PlayState", "audioplayer", play_state);
            } break;
        }
    }


    // 停止获取歌词
    function stopGetLyric() {
        if (pauseDebounceTimer) {
            clearTimeout(pauseDebounceTimer);
            pauseDebounceTimer = null;
        }
        clearLineEndTimer();
        isPaused = false;
        interludeSent = false;
        const config = pluginConfig.get("lyrics");
        switch (config["retrieval_method"]["value"]) {
            // 软件内词栏
            case 0: {
                if (observer) {
                    observer.disconnect();
                    observer = null;
                }
            } break;

            // LibLyric
            case 1: {
                legacyNativeCmder.removeRegisterCall("Load", "audioplayer", play_load);
                legacyNativeCmder.removeRegisterCall("PlayProgress", "audioplayer", play_progress);
                legacyNativeCmder.removeRegisterCall("PlayState", "audioplayer", play_state);
            } break;

            // RefinedNowPlaying
            case 2: {
                legacyNativeCmder.removeRegisterCall("Load", "audioplayer", play_load);
                legacyNativeCmder.removeRegisterCall("PlayProgress", "audioplayer", play_progress);
                legacyNativeCmder.removeRegisterCall("PlayState", "audioplayer", play_state);
            } break;
        }
    }


    this.lyric = {
        startGetLyric,
        stopGetLyric
    }
});
