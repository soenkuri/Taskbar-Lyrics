"use strict";


plugin.onLoad(async () => {
    const { TaskbarLyricsAPI, pluginConfig } = { ...this.base };
    const liblyric = loadedPlugins.liblyric;


    let observer = null;
    let parsedLyric = null;
    let currentIndex = 0;
    let musicId = 0;


    const addLog = (...args) => window.TaskbarLyricsLog?.(...args);


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
            parsedLyric = liblyric.parseLyric(
                lyricData?.lrc?.lyric ?? "",
                lyricData?.tlyric?.lyric ?? "",
                lyricData?.romalrc?.lyric ?? ""
            );
        }


        // 清除歌词空白行
        parsedLyric = parsedLyric.filter(item => item.originalLyric != "");


        // 纯音乐只显示歌曲名与作曲家
        if (
            (parsedLyric.length == 1)
            && (parsedLyric[0].time == 0)
            && (parsedLyric[0].duration != 0)
        ) {
            parsedLyric = [];
        }

        clearHideTimer();
        currentIndex = 0;
    }


    let lastProgressTime = 0;
    let hideTimer = null;
    let lastScheduledEndTime = -1;


    // 取消隐藏定时器
    const clearHideTimer = () => {
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
            lastScheduledEndTime = -1;
        }
    };


    // 调度到时间后发送空歌词隐藏
    // 规则：当前句有明确结束时间，且与下一句空档 > 1 秒，才在句末隐藏
    const scheduleHide = (time, currentLyric, nextIndex) => {
        const hideEnabled = pluginConfig.get("hide")["enabled"];
        if (!hideEnabled || !currentLyric) {
            clearHideTimer();
            return;
        }

        const adjust = Number(pluginConfig.get("effect")["adjust"]);

        // 计算与下一句的空档
        const gap = (nextIndex < parsedLyric.length)
            ? parsedLyric[nextIndex].time - currentLyric.time
            : 0;

        // 取 liblyric 给出的 duration；若没有，就用到下一句的空档
        let duration = currentLyric?.duration;
        if (!duration || duration <= 0) {
            duration = gap;
        }

        // 空档不超过 1 秒，或当前句结束时间不早于下一句开始（重叠），则不隐藏
        const gapAfterLine = gap - duration;
        if (gap <= 1000 || gapAfterLine <= 0) {
            clearHideTimer();
            return;
        }

        const endTime = currentLyric.time + duration;
        // 同一句歌词且结束时间没变就不重复调度，避免进度回调频繁重置
        if (endTime === lastScheduledEndTime && hideTimer) return;

        clearHideTimer();

        const elapsed = (time + adjust) * 1000 - currentLyric.time;
        const remaining = Math.max(0, duration - elapsed);

        if (remaining > 0) {
            lastScheduledEndTime = endTime;
            hideTimer = setTimeout(() => {
                hideTimer = null;
                lastScheduledEndTime = -1;
                if (!pluginConfig.get("hide")["enabled"]) return;
                addLog(`句末空档 ${Math.round(gapAfterLine)}ms，发送空歌词隐藏`, "info");
                TaskbarLyricsAPI.lyrics.lyrics({ "basic": "", "extra": "" });
            }, remaining);
        }
    };


    // 发送当前进度对应的歌词
    const sendCurrentLyric = (time, force = false) => {
        const adjust = Number(pluginConfig.get("effect")["adjust"]);
        const hideEnabled = pluginConfig.get("hide")["enabled"];
        if (!parsedLyric) return;

        let nextIndex = parsedLyric.findIndex(item => item.time > (time + adjust) * 1000);
        nextIndex = (nextIndex <= -1) ? parsedLyric.length : nextIndex;

        const currentLyric = parsedLyric[nextIndex - 1] ?? "";

        if (force || nextIndex != currentIndex) {
            const lyrics = {
                "basic": currentLyric?.originalLyric ?? "",
                "extra": currentLyric?.translatedLyric ?? ""
            };

            addLog(`发送歌词: "${lyrics.basic || "(空)"}"`, "info");
            TaskbarLyricsAPI.lyrics.lyrics(lyrics);
            currentIndex = nextIndex;
        }

        if (hideEnabled) {
            scheduleHide(time, currentLyric, nextIndex);
        } else {
            clearHideTimer();
        }
    }


    // 音乐进度发生变化时
    const play_progress = async (_, time) => {
        lastProgressTime = time;
        sendCurrentLyric(time, false);
    }


    // 播放状态变化
    const play_state = async (state) => {
        const hideEnabled = pluginConfig.get("hide")["enabled"];
        if (!hideEnabled) return;

        addLog(`[调试] PlayState 回调: ${JSON.stringify(state)}`, "info");

        let isPlaying = false;
        let time = lastProgressTime;

        if (typeof state === "boolean") {
            isPlaying = state;
        } else if (state && typeof state === "object") {
            isPlaying = state.playing || state.data?.playing || state.isPlaying || false;
            time = state.time || state.data?.time || state.currentTime || lastProgressTime;
        } else if (typeof state === "string") {
            isPlaying = state === "play" || state === "playing";
        } else if (typeof state === "number") {
            isPlaying = state !== 0;
        }

        if (isPlaying) {
            addLog("播放恢复，立即发送当前歌词", "info");
            sendCurrentLyric(time, true);
        } else {
            addLog("暂停播放，清空歌词并取消隐藏定时器", "info");
            clearHideTimer();
            TaskbarLyricsAPI.lyrics.lyrics({ "basic": "", "extra": "" });
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
        clearHideTimer();
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
