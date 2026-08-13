"use strict";


plugin.onLoad(async () => {
    const { TaskbarLyricsAPI, pluginConfig } = { ...this.base };
    const liblyric = loadedPlugins.liblyric;


    let observer = null;
    let parsedLyric = null;
    let currentIndex = 0;
    let musicId = 0;
    let lastProgressTime = 0;
    let lyricLoadVersion = 0;
    let hasCurrentSongProgress = false;
    let hasDisplayedRealLyric = false;
    let interludeSent = false;
    let isPaused = false;
    let pauseDebounceTimer = null;
    let lineEndTimer = null;
    let lineEndTimerIndex = null;
    let hideDebounceTimer = null;
    let listenerRegistered = false;
    let listenerRegistrationPending = false;
    let registeredRetrievalMethod = null;
    let listenerRegistrationToken = 0;
    // 网易云在缓冲、跳转期间可能短暂回调异常的播放进度。
    // PlayProgress 没有直接暴露真实音频时钟，因此这里只对“短时间内的异常前跳”
    // 估算缓冲领先量，并持续从后续进度中扣除；明显拖动或重新播放时清零。
    const PROGRESS_RAPID_DELTA_THRESHOLD = 0.5;
    const PROGRESS_RAPID_LEAD_THRESHOLD = 0.15;
    const PROGRESS_BUFFER_MAX_ELAPSED = 1;
    const PROGRESS_BUFFER_MAX_DELTA = 2;
    const PROGRESS_MAX_CORRECTION = 3;
    const PROGRESS_BACKWARD_REANCHOR_THRESHOLD = 0.25;
    const PROGRESS_START_EPSILON = 0.01;
    let lastReportedProgress = null;
    let lastProgressTimestamp = null;
    let correctedProgress = null;
    let progressPlaybackState = "unknown";
    let bufferCorrection = 0;
    let progressCorrectionStatus = "未开始";
    let progressCorrectionReason = "等待播放进度";
    let progressCorrectionCount = 0;
    const LYRIC_ACK_TIMEOUT = 1000;
    let lyricAckRequestId = 0;
    let lyricAckGeneration = 0;
    let latestLyricAck = null;
    const pendingLyricAcks = new Map();
    let lastLyricAckRequestId = 0;


    const addLog = (...args) => window.TaskbarLyricsLog?.(...args);
    const updateDebug = (method, payload) => window.TaskbarLyricsDebug?.[method]?.(payload);
    const getMonotonicTime = () => (
        typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now()
    );


    const resetProgressCorrection = () => {
        lastReportedProgress = null;
        lastProgressTimestamp = null;
        correctedProgress = null;
        progressPlaybackState = "unknown";
        bufferCorrection = 0;
        progressCorrectionStatus = "未开始";
        progressCorrectionReason = "等待播放进度";
        progressCorrectionCount = 0;
        updateDebug("updatePlaybackProgress", {
            rawTime: null,
            correctedTime: null,
            adjustedTime: null,
            automaticOffset: null,
            bufferCorrection: null,
            bufferCorrectionStatus: "未检测",
            bufferCorrectionReason: "等待缓冲前跳",
            correctionStatus: progressCorrectionStatus,
            correctionReason: progressCorrectionReason,
            correctionCount: progressCorrectionCount
        });
    };


    // 参考上游歌词适配器的单调进度保护，并尝试估算缓冲导致的时间领先。
    const correctPlaybackProgress = value => {
        const rawProgress = Number(value);
        if (!Number.isFinite(rawProgress)) {
            progressCorrectionStatus = "无效进度";
            progressCorrectionReason = "PlayProgress 不是有效数字";
            return null;
        }

        const normalizedProgress = Math.max(0, rawProgress);
        const now = getMonotonicTime();
        const previousReported = lastReportedProgress;
        const previousCorrected = correctedProgress;
        const previousTimestamp = lastProgressTimestamp;
        lastReportedProgress = normalizedProgress;
        lastProgressTimestamp = now;

        if (previousReported === null || previousCorrected === null) {
            correctedProgress = normalizedProgress;
            progressCorrectionStatus = "已初始化";
            progressCorrectionReason = "首次有效播放进度";
            return correctedProgress;
        }

        const delta = normalizedProgress - previousReported;
        const isPlaying = progressPlaybackState === "playing";
        const isReset = normalizedProgress <= PROGRESS_START_EPSILON && previousReported > PROGRESS_START_EPSILON;
        const isBackwardSeek = delta < -PROGRESS_BACKWARD_REANCHOR_THRESHOLD;
        const isLargeForwardSeek = delta > PROGRESS_BUFFER_MAX_DELTA;
        const elapsed = previousTimestamp === null
            ? null
            : Math.max(0, (now - previousTimestamp) / 1000);
        const forwardExcess = elapsed === null ? null : delta - elapsed;
        const isRapidForward = delta > PROGRESS_RAPID_DELTA_THRESHOLD
            && elapsed !== null
            && elapsed <= PROGRESS_BUFFER_MAX_ELAPSED
            && forwardExcess >= PROGRESS_RAPID_LEAD_THRESHOLD;

        // 回到起点、明显回退或大幅前跳通常是重新播放/用户拖动，立即接受新锚点，
        // 同时清除旧的缓冲校正量，避免把旧歌曲的偏移带到新的时间轴。
        if (isReset || isBackwardSeek || isLargeForwardSeek) {
            bufferCorrection = 0;
            correctedProgress = normalizedProgress;
            progressCorrectionStatus = isPlaying ? "重新锚定" : "正常";
            progressCorrectionReason = isReset
                ? "检测到回到起点，接受新的播放锚点"
                : isBackwardSeek
                    ? "检测到向后跳转，接受新的播放锚点"
                    : "检测到大幅前跳，按用户拖动重新锚定";
            return correctedProgress;
        }

        // 暂停状态没有可靠的实时音频时钟，只应用已有校正量，不再估算新偏移。
        if (!isPlaying) {
            correctedProgress = Math.max(0, normalizedProgress + bufferCorrection);
            progressCorrectionStatus = bufferCorrection ? "保持校正" : "正常";
            progressCorrectionReason = bufferCorrection
                ? `暂停中保持缓冲校正量 ${bufferCorrection.toFixed(2)} 秒`
                : "暂停状态不估算缓冲偏移";
            return correctedProgress;
        }

        // 进度在短时间内比真实经过的墙钟时间多走一截，视为缓冲期间的累计前跳。
        // 把这段差值累积为负偏移，后续每次匹配歌词都继续扣除，而不是只压住一次回调。
        let bufferCorrectionApplied = false;
        if (isRapidForward && delta <= PROGRESS_BUFFER_MAX_DELTA) {
            const correction = Math.min(
                PROGRESS_MAX_CORRECTION,
                Math.max(0, forwardExcess)
            );
            bufferCorrection = Math.max(
                -PROGRESS_MAX_CORRECTION,
                bufferCorrection - correction
            );
            progressCorrectionCount++;
            bufferCorrectionApplied = true;
            progressCorrectionStatus = "缓冲已校正";
            progressCorrectionReason = `疑似缓冲前跳 ${forwardExcess.toFixed(2)} 秒，持续扣除校正量`;
        }

        const correctedCandidate = Math.max(0, normalizedProgress + bufferCorrection);
        const nextProgress = Math.max(previousCorrected, correctedCandidate);
        if (nextProgress !== correctedCandidate) {
            progressCorrectionCount++;
            progressCorrectionStatus = "抑制回退";
            progressCorrectionReason = "播放中忽略小幅回退，保持校正后时间轴单调";
        } else if (!bufferCorrectionApplied) {
            progressCorrectionStatus = bufferCorrection ? "保持校正" : "正常";
            progressCorrectionReason = bufferCorrection
                ? `持续扣除缓冲校正量 ${bufferCorrection.toFixed(2)} 秒`
                : "进度连续";
        }
        correctedProgress = nextProgress;
        return correctedProgress;
    };


    const invalidateLyricAcks = () => {
        lyricAckGeneration++;
        for (const pending of pendingLyricAcks.values()) {
            if (pending.timeoutId) clearTimeout(pending.timeoutId);
            pending.superseded = true;
        }
        pendingLyricAcks.clear();
        latestLyricAck = null;
        lastLyricAckRequestId = lyricAckRequestId;
    };


    const retrievalMethodName = value => ({
        0: "软件内词栏",
        1: "LibLyric",
        2: "RefinedNowPlaying"
    }[Number(value)] ?? `未知方式(${value})`);


    const shortenLyric = value => {
        const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
        if (!text) return "（间奏或空白）";
        return text.length > 80 ? `${text.slice(0, 80)}…` : `“${text}”`;
    };


    const reportLyricMatch = ({
        progress,
        adjustedProgress,
        nextIndex,
        currentLyric,
        detail
    }) => {
        const lineIndex = nextIndex - 1;
        const text = currentLyric?.originalLyric ?? "";
        const matchText = lineIndex < 0 ? "歌曲开头（暂无歌词）" : shortenLyric(text);
        updateDebug("updateLyricMatch", {
            progress,
            adjustedProgress,
            lineIndex: lineIndex < 0 ? null : lineIndex,
            text: matchText,
            detail
        });
    };


    const reportListener = ({ status, method, events = [], detail }) => {
        updateDebug("updateListener", { status, method, events, detail });
        const eventText = events.length ? events.join("、") : "MutationObserver";
        const level = status === "注册失败" ? "error" : status === "已注册" ? "success" : "info";
        const action = {
            "已注册": "已注册",
            "已注销": "已注销",
            "注销中": "正在注销",
            "注册中": "正在注册",
            "注册失败": "注册失败"
        }[status] ?? status;
        addLog(`[歌词监听] ${action} ${method}：${eventText}${detail ? `（${detail}）` : ""}`, level);
    };


    const sendLyrics = async (lyrics, { isSongInfo = false, isRealLyric = false } = {}) => {
        if (isRealLyric) hasDisplayedRealLyric = true;
        const expected = {
            ...lyrics,
            "is_song_info": isSongInfo,
            "is_real_lyric": isRealLyric
        };
        const requestStartedAt = getMonotonicTime();
        const startingUntil = Number(this.base.taskbarLyricsStartingUntil);
        const ackTimeout = Number.isFinite(startingUntil) && startingUntil > Date.now()
            ? Math.max(LYRIC_ACK_TIMEOUT, startingUntil - Date.now())
            : LYRIC_ACK_TIMEOUT;

        // 歌词可能在几十毫秒内连续切换。每条请求都保留回执窗口，收到任意
        // 更新后的有效回执即可证明 C++ 仍然工作；这样短歌词不会阻塞下一条，
        // 也不会因为上一条的迟到回执而误判。若连续一整个窗口都没有回执，
        // 仍会触发重连。
        const pending = {
            requestId: ++lyricAckRequestId,
            generation: lyricAckGeneration,
            timeoutId: null,
            timedOut: false,
            responseLatencyMs: null,
            ackTimeout,
            superseded: false
        };
        pendingLyricAcks.set(pending.requestId, pending);
        latestLyricAck = pending;
        const isCurrentGeneration = () => (
            !pending.superseded
            && lyricAckGeneration === pending.generation
        );
        const isLatestRequest = () => (
            isCurrentGeneration()
            && latestLyricAck === pending
        );
        const markAcknowledged = () => {
            if (!isCurrentGeneration()) return;
            lastLyricAckRequestId = Math.max(lastLyricAckRequestId, pending.requestId);
            for (const [requestId, olderPending] of pendingLyricAcks) {
                if (requestId >= pending.requestId) continue;
                if (olderPending.timeoutId) clearTimeout(olderPending.timeoutId);
                olderPending.superseded = true;
                pendingLyricAcks.delete(requestId);
            }
        };

        try {
            const responsePromise = TaskbarLyricsAPI.lyrics.lyrics(expected);
            const response = await Promise.race([
                responsePromise,
                new Promise((_, reject) => {
                    pending.timeoutId = setTimeout(
                        () => {
                            pending.timedOut = true;
                            reject(new Error(`歌词回执超时（${ackTimeout}ms）`));
                        },
                        ackTimeout
                    );
                })
            ]);
            if (!isCurrentGeneration()) return response;
            const responseLatencyMs = Math.max(0, getMonotonicTime() - requestStartedAt);
            pending.responseLatencyMs = responseLatencyMs;
            if (responseLatencyMs > ackTimeout && isLatestRequest()) {
                const detail = `歌词回执耗时 ${Math.round(responseLatencyMs)}ms，超过 ${ackTimeout}ms`;
                updateDebug("updateLyricAck", {
                    status: "超时",
                    statusCode: Number.isInteger(response?.status) ? response.status : null,
                    latencyMs: responseLatencyMs,
                    detail,
                    currentLyric: null
                });
                addLog(`[C++歌词回执] ${detail}，立即重启 C++ 程序`, "error");
                void reconnect();
                return null;
            }
            if (this.base.taskbarLyricsStartingUntil && response?.status >= 200 && response?.status < 300) {
                this.base.taskbarLyricsStartingUntil = 0;
            }
            if (response?.status === 204 && !isSongInfo && !isRealLyric) {
                markAcknowledged();
                if (!isLatestRequest()) return response;
                updateDebug("updateLyricAck", {
                    status: "已忽略",
                    statusCode: response.status,
                    latencyMs: responseLatencyMs,
                    detail: "C++ 按歌曲信息保护规则忽略空歌词",
                    currentLyric: null
                });
                return response;
            }
            if (!response || response.status !== 200) {
                throw new Error(`歌词回执状态异常：HTTP ${response?.status ?? "未知"}`);
            }

            let currentLyric;
            try {
                currentLyric = await response.clone().json();
            } catch {
                throw new Error("C++ 未返回歌词回执");
            }

            const echoedBasic = typeof currentLyric?.basic === "string" ? currentLyric.basic : null;
            const echoedExtra = typeof currentLyric?.extra === "string" ? currentLyric.extra : null;
            if (
                echoedBasic !== expected.basic
                || echoedExtra !== expected.extra
                || Boolean(currentLyric?.is_song_info) !== isSongInfo
            ) {
                throw new Error(
                    `歌词回执不一致：期望 ${JSON.stringify({ basic: expected.basic, extra: expected.extra })}，`
                    + `实际 ${JSON.stringify({ basic: echoedBasic, extra: echoedExtra })}`
                );
            }

            markAcknowledged();
            if (!isLatestRequest()) return response;
            updateDebug("updateLyricAck", {
                status: "正常",
                statusCode: response.status,
                latencyMs: responseLatencyMs,
                detail: "C++ 已复述当前歌词",
                currentLyric
            });
            return response;
        } catch (error) {
            if (!isCurrentGeneration()) return null;
            // 较早请求只有在自己的窗口真正超时后才触发重连；它的即时错误
            // 可能只是请求已被短歌词更新接管，不能抢先打断当前歌词。
            if (!isLatestRequest() && !pending.timedOut) return null;
            if (lastLyricAckRequestId >= pending.requestId) return null;
            const detail = error?.message ?? String(error);
            const startupGraceActive = Number(this.base.taskbarLyricsStartingUntil) > Date.now();
            const isSimulatedFailure = detail.includes("调试：模拟");
            if (startupGraceActive && !pending.timedOut && !isSimulatedFailure) {
                addLog(`[C++歌词回执] ${detail}，C++ 仍在启动，等待后续歌词请求`, "warn");
                return null;
            }
            const elapsedMs = Math.max(0, getMonotonicTime() - requestStartedAt);
            updateDebug("updateLyricAck", {
                status: pending.timedOut ? "超时" : "异常",
                statusCode: null,
                latencyMs: pending.timedOut ? elapsedMs : null,
                detail,
                currentLyric: null
            });
            addLog(`[C++歌词回执] ${detail}，触发重连`, "error");
            void reconnect();
            return null;
        } finally {
            if (pending.timeoutId) clearTimeout(pending.timeoutId);
            pendingLyricAcks.delete(pending.requestId);
            if (isLatestRequest()) latestLyricAck = null;
        }
    };


    const clearLineEndTimer = () => {
        if (lineEndTimer) clearTimeout(lineEndTimer);
        if (hideDebounceTimer) clearTimeout(hideDebounceTimer);
        lineEndTimer = null;
        lineEndTimerIndex = null;
        hideDebounceTimer = null;
    };


    // 普通 LRC 没有逐字句末时间，但空白时间戳可明确标记间奏开始
    const getInterludeMarkers = lyricText => {
        if (typeof liblyric.parsePureLyric !== "function") return [];

        try {
            const lines = liblyric.parsePureLyric(lyricText);
            return lines.flatMap((line, index) => {
                const nextLine = lines[index + 1];
                const lyric = typeof line.lyric === "string" ? line.lyric.trim() : "";
                if (
                    lyric
                    || !nextLine
                    || typeof line.time !== "number"
                    || typeof nextLine.time !== "number"
                    || nextLine.time <= line.time
                ) return [];

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
    const wait = delay => new Promise(resolve => setTimeout(resolve, delay));


    const getTaskbarLyricsDataPath = async () => {
        if (this.base.taskbarLyricsDataPath) return this.base.taskbarLyricsDataPath;

        let lastError = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const dataPath = await betterncm.app.getDataPath();
                if (!dataPath) throw new Error("数据目录为空");
                this.base.taskbarLyricsDataPath = dataPath.replace("/", "\\");
                return this.base.taskbarLyricsDataPath;
            } catch (error) {
                lastError = error;
                addLog(`[重连] 读取数据目录失败（${attempt}/3）：${error?.message ?? error}`, "warn");
                await wait(250 * attempt);
            }
        }
        throw lastError ?? new Error("无法读取数据目录");
    };


    // 通过 Windows 实际进程列表判断 taskbar-lyrics.exe 是否仍在后台运行。
    // app.exec 返回的是命令请求状态，不是命令退出码，因此将 tasklist 输出到临时文件后读取解析。
    const isTaskbarLyricsProcessRunning = async () => {
        const dataPath = await getTaskbarLyricsDataPath();
        const snapshotPath = `${dataPath}\\taskbar-lyrics-process-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`;
        try {
            const requested = await betterncm.app.exec(
                `cmd /S /C tasklist /FI "IMAGENAME eq taskbar-lyrics.exe" /FO CSV /NH > "${snapshotPath}"`,
                false,
                false
            );
            if (!requested) return true;

            let snapshot = null;
            for (let attempt = 1; attempt <= 12; attempt++) {
                try {
                    snapshot = await betterncm.fs.readFileText(snapshotPath);
                    break;
                } catch {
                    await wait(100);
                }
            }
            if (snapshot === null) return true;
            return /taskbar-lyrics\.exe/i.test(snapshot);
        } catch {
            // 查询命令或文件读取失败时按仍在运行处理，避免误启动第二个进程。
            return true;
        } finally {
            try {
                await betterncm.fs.remove(snapshotPath);
            } catch {
                // 临时快照清理失败不影响进程状态判断。
            }
        }
    };


    const waitForTaskbarLyricsProcessStopped = async () => {
        for (let check = 1; check <= 20; check++) {
            if (!(await isTaskbarLyricsProcessRunning())) return true;
            addLog(`[重连] 旧 C++ 进程仍在运行，等待退出（${check}/20）`, "warn");
            await wait(250);
        }
        return false;
    };


    const waitForTaskbarLyricsProcessRunning = async () => {
        for (let check = 1; check <= 20; check++) {
            if (await isTaskbarLyricsProcessRunning()) return true;
            await wait(250);
        }
        return false;
    };


    const restartTaskbarLyricsProcess = async () => {
        const dataPath = await getTaskbarLyricsDataPath();
        const pluginPath = this.pluginPath.replace("/./", "\\").replace("/", "\\");
        let lastError = null;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                addLog(`[重连] 正在结束旧 C++ 程序（${attempt}/3）...`, "info");
                try {
                    await betterncm.app.exec(
                        `cmd /S /C taskkill /F /T /IM "taskbar-lyrics.exe" >nul 2>&1`,
                        false,
                        false
                    );
                } catch (error) {
                    addLog(`[重连] 结束旧 C++ 程序命令返回异常：${error?.message ?? error}`, "warn");
                }

                // 查询实际进程列表，确认旧进程确实已经退出；未确认退出前绝不启动新进程。
                const oldProcessStopped = await waitForTaskbarLyricsProcessStopped();
                if (!oldProcessStopped) {
                    throw new Error("旧 C++ 程序未退出，已取消启动新进程");
                }
                if (await isTaskbarLyricsProcessRunning()) {
                    throw new Error("旧 C++ 程序仍存在，已取消启动新进程");
                }

                addLog(`[重连] 正在启动 C++ 程序（${attempt}/3）...`, "info");
                const startCommand = `xcopy /C /D /Y "${pluginPath}\\taskbar-lyrics.exe" "${dataPath}" && "${dataPath}\\taskbar-lyrics.exe" ${this.base.TaskbarLyricsPort}`;
                const started = await betterncm.app.exec(`cmd /S /C ${startCommand}`, false, false);
                if (!started) {
                    addLog("[重连] 启动命令未确认执行，将由歌词回执确认服务状态", "warn");
                }
                if (!(await waitForTaskbarLyricsProcessRunning())) {
                    throw new Error("C++ 进程未出现在实际进程列表");
                }
                // 启动命令返回不代表 HTTP 服务已经就绪；给首次回执一个启动窗口，
                // 避免启动阶段的正常竞态再次触发重启并创建第二个进程。
                this.base.taskbarLyricsStartingUntil = Date.now() + 5000;
                return;
            } catch (error) {
                lastError = error;
                addLog(`[重连] 启动命令失败（${attempt}/3）：${error?.message ?? error}`, "warn");
            }
            await wait(500 * attempt);
        }

        throw lastError ?? new Error("C++ 服务未在等待时间内就绪");
    };


    const reconnect = async () => {
        if (正在重连) return;
        正在重连 = true;
        try {
            currentIndex = 0;
            addLog("[重连] 检测到连接断开，正在重启 C++ 程序...", "error");
            // 先注销监听，避免旧回调在新进程启动期间继续发送过期歌词。
            stopGetLyric();
            const queue = this.base.queueTaskbarLyricsProcessOperation;
            if (typeof queue === "function") {
                await queue(() => restartTaskbarLyricsProcess());
            } else {
                await restartTaskbarLyricsProcess();
            }

            addLog("[重连] C++ 程序已启动，等待回执确认服务状态", "success");
            startGetLyric();
            addLog("[重连] 重连完成，已重新加载当前歌曲", "success");
        } catch (error) {
            addLog(`[重连] 自动重连失败：${error?.message ?? error}，将继续重试`, "error");
            if (!listenerRegistered && !listenerRegistrationPending) {
                startGetLyric();
            }
        } finally {
            正在重连 = false;
        }
    };

    // 监视软件内歌词变动
    const watchLyricsChange = async () => {
        const mLyric = await betterncm.utils.waitForElement("#x-g-mn .m-lyric");
        if (observer) observer.disconnect();
        const MutationCallback = mutations => {
            updateDebug("touchListener", { event: "MutationObserver" });
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

                sendLyrics(lyrics, {
                    isRealLyric: Boolean(lyrics.basic?.trim())
                });
            }
        }

        observer = new MutationObserver(MutationCallback);
        observer.observe(mLyric, { childList: true, subtree: true });
        updateDebug("updateLyricSummary", {
            type: "词栏监听",
            effectiveLines: null,
            interludeCount: null,
            detail: "实时监听，无法统计整首歌词行数"
        });
        return true;
    }


    // 音乐ID发生变化时
    const play_load = async () => {
        updateDebug("touchListener", { event: "Load" });
        const loadVersion = ++lyricLoadVersion;
        invalidateLyricAcks();
        clearLineEndTimer();
        if (pauseDebounceTimer) {
            clearTimeout(pauseDebounceTimer);
            pauseDebounceTimer = null;
        }
        parsedLyric = null;
        currentIndex = 0;
        lastProgressTime = 0;
        resetProgressCorrection();
        hasCurrentSongProgress = false;
        hasDisplayedRealLyric = false;
        interludeSent = false;
        isPaused = false;

        // 获取歌曲信息
        const playingSong = betterncm.ncm.getPlayingSong();
        musicId = playingSong.data.id ?? 0;
        const name = playingSong.data.name ?? "";
        const artists = playingSong.data.artists ?? "";

        // 解析歌手名称
        let artistName = "";
        artists.forEach(item => artistName += ` / ${item.name}`);
        artistName = artistName.slice(3);

        addLog(`[歌曲] 开始加载：${name || "未知歌曲"}${artistName ? ` - ${artistName}` : ""}（ID：${musicId}）`, "info");
        updateDebug("updateLyricMatch", {
            text: "正在加载歌词",
            progress: hasCurrentSongProgress ? lastProgressTime : null,
            adjustedProgress: null,
            lineIndex: null,
            detail: "等待歌词解析"
        });

        // 先发送歌曲信息；歌词加载期间不保留上一首的自动隐藏状态
        sendLyrics({
            "basic": name,
            "extra": artistName
        }, {
            isSongInfo: true
        });


        // 解析歌词
        const config = pluginConfig.get("lyrics");
        const retrievalMethod = retrievalMethodName(config["retrieval_method"]["value"]);
        let lyricType = retrievalMethod === "LibLyric" ? "静态歌词" : retrievalMethod;
        let interludeCount = 0;
        updateDebug("updateLyricSummary", {
            type: "加载中",
            effectiveLines: null,
            interludeCount: null,
            detail: `来源：${retrievalMethod}`
        });
        addLog(`[歌词加载] 来源：${retrievalMethod}`, "info");
        if ((config["retrieval_method"]["value"] == "2") && window.currentLyrics) {
            // 解决RNP歌词对不上的问题
            while (true) {
                if (loadVersion !== lyricLoadVersion) return;
                if (window.currentLyrics.hash.includes(musicId)) {
                    parsedLyric = window.currentLyrics.lyrics;
                    break;
                } else {
                    await betterncm.utils.delay(100);
                }
            }
        } else {
            const lyricData = await liblyric.getLyricData(musicId);
            if (loadVersion !== lyricLoadVersion) return;
            const lyricText = lyricData?.lrc?.lyric ?? "";
            const useDynamicLyrics = config["request_dynamic_lyrics"]
                && Boolean(lyricData?.yrc?.lyric?.trim());
            lyricType = useDynamicLyrics ? "逐字（动态）歌词" : "静态歌词";
            parsedLyric = liblyric.parseLyric(
                lyricText,
                lyricData?.tlyric?.lyric ?? "",
                lyricData?.romalrc?.lyric ?? "",
                useDynamicLyrics ? lyricData.yrc.lyric : ""
            );
            addLog(`[歌词加载] 类型：${useDynamicLyrics ? "逐字歌词" : "静态歌词"}`, "info");

            const interludeMarkers = getInterludeMarkers(lyricText);
            interludeCount = interludeMarkers.length;
            parsedLyric = [
                ...parsedLyric.filter(item => item.originalLyric?.trim()),
                ...interludeMarkers
            ].sort((left, right) => left.time - right.time);
            if (interludeMarkers.length) {
                addLog(`[歌词加载] 识别到 ${interludeMarkers.length} 个 LRC 间奏标记`, "info");
            }
        }

        if (loadVersion !== lyricLoadVersion) return;


        // RefinedNowPlaying 歌词不带 LRC 间奏标记，保持原有空行清理行为
        if (config["retrieval_method"]["value"] == "2") {
            parsedLyric = parsedLyric.filter(item => item.originalLyric?.trim());
        }

        // 有效歌词少于五行（含正好四行）视为未获取到歌词，保留歌曲信息
        const effectiveLyricLines = parsedLyric.filter(item => item.originalLyric?.trim());
        updateDebug("updateLyricSummary", {
            type: lyricType,
            effectiveLines: effectiveLyricLines.length,
            interludeCount,
            detail: `来源：${retrievalMethod}`
        });
        if (effectiveLyricLines.length < 5) {
            parsedLyric = null;
            currentIndex = 0;
            interludeSent = false;
            updateDebug("updateLyricMatch", {
                text: "无可用歌词",
                progress: hasCurrentSongProgress ? lastProgressTime : null,
                adjustedProgress: null,
                lineIndex: null,
                detail: `有效歌词 ${effectiveLyricLines.length} 行，小于 5 行阈值`
            });
            updateDebug("updateLyricSummary", {
                type: lyricType,
                effectiveLines: effectiveLyricLines.length,
                interludeCount,
                detail: `来源：${retrievalMethod}，少于 5 行，不发送歌词`
            });
            addLog(`[歌词加载] 有效歌词仅 ${effectiveLyricLines.length} 行，不发送歌词`, "info");
            return;
        }

        addLog(`[歌词加载] 解析完成：有效歌词 ${effectiveLyricLines.length} 行`, "success");

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

        // 只有本首歌曲已上报播放进度时，才恢复歌词与逐句隐藏
        if (hasCurrentSongProgress) {
            sendCurrentLyric(lastProgressTime, false);
            scheduleLineEndHide(lastProgressTime);
        }
    }


    // 发送当前进度对应的歌词
    const sendCurrentLyric = (time, force = false) => {
        if (!parsedLyric) return;

        const adjust = Number(pluginConfig.get("effect")["adjust"]);
        const progress = Number(time);
        const adjustedProgress = progress + (Number.isFinite(adjust) ? adjust : 0);
        let nextIndex = parsedLyric.findIndex(item => item.time > adjustedProgress * 1000);
        nextIndex = (nextIndex <= -1) ? parsedLyric.length : nextIndex;

        // 间奏中（还没到下一句）或暂停中（非强制补发）不重新发送歌词
        if (!force && ((interludeSent && nextIndex === currentIndex) || isPaused)) {
            currentIndex = nextIndex;
            return;
        }

        if (force || nextIndex != currentIndex) {
            const currentLyric = parsedLyric[nextIndex - 1] ?? "";
            const isRealLyric = Boolean(currentLyric?.originalLyric?.trim());
            const isInterludeMarker = currentLyric?.isInterludeMarker === true;
            if (!isRealLyric && !hasDisplayedRealLyric) {
                reportLyricMatch({
                    progress,
                    adjustedProgress,
                    nextIndex,
                    currentLyric,
                    detail: "歌曲信息保护，未发送空歌词"
                });
                currentIndex = nextIndex;
                interludeSent = false;
                return;
            }
            if (isInterludeMarker && interludeSent) {
                reportLyricMatch({
                    progress,
                    adjustedProgress,
                    nextIndex,
                    currentLyric,
                    detail: "间奏已处理，跳过重复发送"
                });
                currentIndex = nextIndex;
                return;
            }
            if (isInterludeMarker) {
                const hideConfig = pluginConfig.get("hide");
                const minimumGap = Number(hideConfig["minimum_gap"]);
                const duration = Number(currentLyric.duration) || 0;
                if (
                    !hideConfig["enabled"]
                    || duration < (Number.isFinite(minimumGap) ? minimumGap : 400)
                ) {
                    reportLyricMatch({
                        progress,
                        adjustedProgress,
                        nextIndex,
                        currentLyric,
                        detail: "间奏未达到隐藏条件，保持上一句"
                    });
                    currentIndex = nextIndex;
                    interludeSent = false;
                    return;
                }
            }

            const lyrics = {
                "basic": currentLyric?.originalLyric ?? "",
                "extra": currentLyric?.translatedLyric ?? ""
            };
            sendLyrics(lyrics, { isRealLyric });
            reportLyricMatch({
                progress,
                adjustedProgress,
                nextIndex,
                currentLyric,
                detail: isInterludeMarker ? "间奏空歌词已发送" : "真实歌词已发送"
            });
            currentIndex = nextIndex;
            interludeSent = isInterludeMarker;
            if (isInterludeMarker) addLog("[歌词隐藏] 检测到 LRC 间奏，发送空歌词", "info");
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

        // 逐字歌词使用真实句末；兼容不同 LibLyric 版本的起始时间字段
        const duration = currentLyric.duration ?? 0;
        const lineStart = currentLyric.dynamicLyricTime ?? currentLyric.time;
        const lineEnd = lineStart + duration;
        const nextLyric = parsedLyric[currentLyricIndex + 1];
        const nextLineStart = nextLyric?.dynamicLyricTime ?? nextLyric?.time;
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
                || !hasDisplayedRealLyric
                || currentIndex !== currentLyricIndex + 1
            ) return;

            interludeSent = true;
            addLog("[歌词隐藏] 当前歌词播放完成，发送空歌词", "info");
            sendLyrics({ "basic": "", "extra": "" });
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
        updateDebug("touchListener", { event: "PlayProgress" });
        const adjust = Number(pluginConfig.get("effect")["adjust"]);
        const numericTime = Number(time);
        const correctedTime = correctPlaybackProgress(numericTime);
        const adjustedTime = correctedTime === null
            ? null
            : correctedTime + (Number.isFinite(adjust) ? adjust : 0);
        updateDebug("updatePlaybackProgress", {
            rawTime: numericTime,
            correctedTime,
            adjustedTime,
            automaticOffset: correctedTime === null ? null : correctedTime - numericTime,
            bufferCorrection,
            bufferCorrectionStatus: progressCorrectionStatus,
            bufferCorrectionReason: progressCorrectionReason,
            correctionStatus: progressCorrectionStatus,
            correctionReason: progressCorrectionReason,
            correctionCount: progressCorrectionCount
        });
        if (correctedTime === null) return;
        lastProgressTime = correctedTime;
        hasCurrentSongProgress = true;
        sendCurrentLyric(correctedTime, false);
        scheduleLineEndHide(correctedTime);
    }


    // 播放状态变化：暂停发空歌词，恢复立即补发当前歌词
    const play_state = async (_, state) => {
        updateDebug("touchListener", { event: "PlayState" });
        let playing;
        let stateTime = null;
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
            if (typeof t === "number") stateTime = t;
        }

        // 无法识别的状态格式，记日志方便排查
        if (playing === undefined || playing === null) {
            addLog(`[播放状态] 无法识别 PlayState：${JSON.stringify(state)}`, "warn");
            return;
        }

        progressPlaybackState = playing ? "playing" : "paused";
        if (stateTime !== null) {
            const correctedTime = correctPlaybackProgress(stateTime);
            if (correctedTime !== null) lastProgressTime = correctedTime;
        }

        if (playing) {
            // 恢复播放：若暂停防抖还没触发就取消，避免恢复瞬间先清空再补发的闪断
            if (pauseDebounceTimer) {
                clearTimeout(pauseDebounceTimer);
                pauseDebounceTimer = null;
            }
            if (isPaused) {
                isPaused = false;
                if (hasCurrentSongProgress) {
                    addLog("[播放状态] 恢复播放，立即补发当前歌词", "info");
                    sendCurrentLyric(lastProgressTime, true);
                }
            }
            if (hasCurrentSongProgress) {
                scheduleLineEndHide(lastProgressTime);
            }
        } else {
            // 暂停：防抖 500ms，过滤恢复瞬间可能出现的瞬时暂停事件
            clearLineEndTimer();
            if (pauseDebounceTimer) clearTimeout(pauseDebounceTimer);
            pauseDebounceTimer = setTimeout(() => {
                pauseDebounceTimer = null;
                if (isPaused) return;
                isPaused = true;
                interludeSent = false;
                if (!hasCurrentSongProgress || !hasDisplayedRealLyric) return;
                addLog("[播放状态] 暂停播放，发送空歌词", "info");
                sendLyrics({ "basic": "", "extra": "" });
            }, 500);
        }
    }



    // 开始获取歌词
    function startGetLyric() {
        const config = pluginConfig.get("lyrics");
        const retrievalMethod = config["retrieval_method"]["value"];
        const methodName = retrievalMethodName(retrievalMethod);
        const nativeEvents = ["Load", "PlayProgress", "PlayState"];
        if (listenerRegistered || listenerRegistrationPending || registeredRetrievalMethod !== null) {
            addLog(`[歌词监听] ${methodName} 已存在活动监听，跳过重复注册`, "warn");
            return;
        }

        const registrationToken = ++listenerRegistrationToken;
        listenerRegistrationPending = true;
        reportListener({
            status: "注册中",
            method: methodName,
            events: retrievalMethod === 0 ? [] : nativeEvents,
            detail: "等待监听就绪"
        });

        switch (retrievalMethod) {
            // 软件内词栏
            case 0: {
                watchLyricsChange()
                    .then(() => {
                        if (registrationToken !== listenerRegistrationToken) {
                            if (observer) {
                                observer.disconnect();
                                observer = null;
                            }
                            return;
                        }
                        listenerRegistrationPending = false;
                        listenerRegistered = true;
                        registeredRetrievalMethod = methodName;
                        reportListener({
                            status: "已注册",
                            method: methodName,
                            events: [],
                            detail: "MutationObserver 已开始监听词栏变化"
                        });
                    })
                    .catch(error => {
                        if (registrationToken !== listenerRegistrationToken) return;
                        listenerRegistrationPending = false;
                        reportListener({
                            status: "注册失败",
                            method: methodName,
                            events: [],
                            detail: error?.message ?? error
                        });
                    });
            } break;

            // LibLyric
            case 1: {
                legacyNativeCmder.appendRegisterCall("Load", "audioplayer", play_load);
                legacyNativeCmder.appendRegisterCall("PlayProgress", "audioplayer", play_progress);
                legacyNativeCmder.appendRegisterCall("PlayState", "audioplayer", play_state);
                listenerRegistrationPending = false;
                listenerRegistered = true;
                registeredRetrievalMethod = methodName;
                reportListener({
                    status: "已注册",
                    method: methodName,
                    events: nativeEvents,
                    detail: "audioplayer"
                });
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
                listenerRegistrationPending = false;
                listenerRegistered = true;
                registeredRetrievalMethod = methodName;
                reportListener({
                    status: "已注册",
                    method: methodName,
                    events: nativeEvents,
                    detail: "audioplayer"
                });
            } break;

            default: {
                listenerRegistrationPending = false;
                reportListener({
                    status: "注册失败",
                    method: methodName,
                    events: [],
                    detail: "未知歌词获取方式"
                });
            } break;
        }
    }


    // 停止获取歌词
    function stopGetLyric() {
        ++listenerRegistrationToken;
        lyricLoadVersion++;
        invalidateLyricAcks();
        if (pauseDebounceTimer) {
            clearTimeout(pauseDebounceTimer);
            pauseDebounceTimer = null;
        }
        clearLineEndTimer();
        parsedLyric = null;
        lastProgressTime = 0;
        resetProgressCorrection();
        hasCurrentSongProgress = false;
        hasDisplayedRealLyric = false;
        musicId = 0;
        isPaused = false;
        interludeSent = false;
        const config = pluginConfig.get("lyrics");
        const currentMethod = registeredRetrievalMethod ?? retrievalMethodName(config["retrieval_method"]["value"]);
        const nativeEvents = ["Load", "PlayProgress", "PlayState"];
        const hasObserver = Boolean(observer);
        const hadListener = listenerRegistered || listenerRegistrationPending || registeredRetrievalMethod !== null || hasObserver;

        if (hadListener) {
            reportListener({
                status: "注销中",
                method: currentMethod,
                events: currentMethod === "软件内词栏" ? [] : nativeEvents,
                detail: "正在移除监听"
            });
        }

        switch (currentMethod) {
            // 软件内词栏
            case "软件内词栏": {
                if (observer) {
                    observer.disconnect();
                    observer = null;
                }
            } break;

            // LibLyric
            case "LibLyric": {
                legacyNativeCmder.removeRegisterCall("Load", "audioplayer", play_load);
                legacyNativeCmder.removeRegisterCall("PlayProgress", "audioplayer", play_progress);
                legacyNativeCmder.removeRegisterCall("PlayState", "audioplayer", play_state);
            } break;

            // RefinedNowPlaying
            case "RefinedNowPlaying": {
                legacyNativeCmder.removeRegisterCall("Load", "audioplayer", play_load);
                legacyNativeCmder.removeRegisterCall("PlayProgress", "audioplayer", play_progress);
                legacyNativeCmder.removeRegisterCall("PlayState", "audioplayer", play_state);
            } break;
        }

        listenerRegistrationPending = false;
        listenerRegistered = false;
        registeredRetrievalMethod = null;
        reportListener({
            status: "已注销",
            method: currentMethod,
            events: currentMethod === "软件内词栏" ? [] : nativeEvents,
            detail: hadListener ? "监听已移除" : "当前没有活动监听"
        });
    }


    this.lyric = {
        startGetLyric,
        stopGetLyric,
        waitForTaskbarLyricsProcessStopped,
        waitForTaskbarLyricsProcessRunning
    }
});
