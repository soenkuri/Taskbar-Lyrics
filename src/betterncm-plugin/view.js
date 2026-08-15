"use strict";


// 创建根视图
const configView = document.createElement("div");
configView.style.overflow = "hidden";
configView.style.height = "100%";
configView.style.width = "100%";


// 日志基础设施（立即初始化，确保其他文件可用）
const logBuffer = [];
let logEntriesEl = null;
let logContainerEl = null;
const diagnosticsState = {
    playback: {
        rawTime: null,
        correctedTime: null,
        adjustedTime: null,
        automaticOffset: null,
        bufferCorrection: null,
        bufferCorrectionStatus: "未检测",
        bufferCorrectionReason: "等待缓冲前跳",
        correctionStatus: "未开始",
        correctionReason: "等待播放进度",
        correctionCount: 0,
        updatedAt: null
    },
    listener: {
        status: "未注册",
        method: "-",
        events: [],
        detail: "等待歌词监听注册",
        registeredAt: null,
        registeredClock: null,
        registrationCount: 0,
        lastActivityAt: null,
        lastActivityClock: null,
        lastActivityType: ""
    },
    lyrics: {
        type: "未获取",
        effectiveLines: null,
        interludeCount: null,
        detail: "等待歌词解析"
    },
    match: {
        text: "尚未匹配歌词",
        progress: null,
        adjustedProgress: null,
        lineIndex: null,
        detail: "等待歌词加载"
    },
    lyricAck: {
        status: "未检测",
        statusCode: null,
        latencyMs: null,
        consecutiveDelayCount: 0,
        detail: "等待 C++ 歌词回执",
        currentLyric: null,
        lastAt: null,
        lastClock: null
    }
};
let diagnosticProgressEl = null;
let diagnosticProgressDetailEl = null;
let diagnosticBufferCorrectionEl = null;
let diagnosticBufferCorrectionDetailEl = null;
let diagnosticListenerEl = null;
let diagnosticListenerDetailEl = null;
let diagnosticLyricTypeEl = null;
let diagnosticLyricLinesEl = null;
let diagnosticInterludeEl = null;
let diagnosticLyricSummaryDetailEl = null;
let diagnosticMatchEl = null;
let diagnosticMatchDetailEl = null;
let diagnosticLyricAckEl = null;
let diagnosticLyricAckDetailEl = null;


const getClockTime = () => {
    const now = new Date();
    return [now.getHours(), now.getMinutes(), now.getSeconds()]
        .map(n => String(n).padStart(2, "0")).join(":");
};


const toFiniteNumber = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};


const formatDiagnosticSeconds = value => {
    const number = toFiniteNumber(value);
    return number === null ? "无效" : `${number.toFixed(2)}秒`;
};


const formatDiagnosticPlaybackTime = value => {
    const number = toFiniteNumber(value);
    if (number === null) return "未获取";
    const totalMilliseconds = Math.max(0, Math.round(number * 1000));
    const minutes = Math.floor(totalMilliseconds / 60000);
    const seconds = Math.floor(totalMilliseconds / 1000) % 60;
    const milliseconds = totalMilliseconds % 1000;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(milliseconds).padStart(3, "0")}`;
};


const formatDiagnosticSignedSeconds = value => {
    const number = toFiniteNumber(value);
    if (number === null) return "无效";
    const sign = number > 0 ? "+" : "";
    return `${sign}${number.toFixed(2)}秒`;
};


const formatDiagnosticMilliseconds = value => {
    const number = toFiniteNumber(value);
    if (number === null) return "未获取";
    return number >= 1000
        ? `${(number / 1000).toFixed(2)}秒`
        : `${Math.round(number)}ms`;
};


const formatElapsed = timestamp => {
    if (!timestamp) return "尚无记录";
    const elapsed = Math.max(0, Date.now() - timestamp);
    if (elapsed < 1000) return "刚刚";
    if (elapsed < 60000) return `${Math.floor(elapsed / 1000)}秒前`;
    if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}分钟前`;
    return `${Math.floor(elapsed / 3600000)}小时前`;
};


const renderDiagnostics = () => {
    const playback = diagnosticsState.playback;
    if (diagnosticProgressEl) {
        diagnosticProgressEl.textContent = playback.correctedTime === null
            ? "未获取"
            : formatDiagnosticPlaybackTime(playback.correctedTime);
    }
    if (diagnosticProgressDetailEl) {
        if (playback.correctedTime === null) {
            diagnosticProgressDetailEl.textContent = "等待播放进度回调";
        } else {
            const raw = `原始 ${formatDiagnosticPlaybackTime(playback.rawTime)}`;
            const offset = `自动偏移（校正-原始）${formatDiagnosticSignedSeconds(playback.automaticOffset)}`;
            const correction = `${playback.correctionStatus}${playback.correctionCount ? `（${playback.correctionCount} 次）` : ""}`;
            const reason = ["正常", "已校正"].includes(playback.correctionStatus)
                ? ""
                : playback.correctionReason;
            diagnosticProgressDetailEl.textContent = [
                raw,
                offset,
                correction,
                reason,
                playback.updatedAt
            ].filter(Boolean).join(" · ");
        }
    }
    if (diagnosticBufferCorrectionEl) {
        diagnosticBufferCorrectionEl.textContent = playback.bufferCorrection === null
            ? "未检测"
            : formatDiagnosticSignedSeconds(playback.bufferCorrection);
    }
    if (diagnosticBufferCorrectionDetailEl) {
        diagnosticBufferCorrectionDetailEl.textContent = playback.bufferCorrection === null
            ? "等待缓冲前跳"
            : [playback.bufferCorrectionStatus, playback.bufferCorrectionReason]
                .filter(Boolean)
                .join(" · ");
    }

    const listener = diagnosticsState.listener;
    if (diagnosticListenerEl) diagnosticListenerEl.textContent = listener.status;
    if (diagnosticListenerDetailEl) {
        const registration = listener.registeredAt
            ? `注册 ${listener.registeredClock} · ${formatElapsed(listener.registeredAt)}`
            : "未注册";
        const activity = listener.lastActivityAt
            ? `上次 ${listener.lastActivityType || "回调"} · ${formatElapsed(listener.lastActivityAt)}`
            : "无回调";
        diagnosticListenerDetailEl.textContent = [listener.method, registration, activity]
            .filter(Boolean)
            .join(" · ");
    }

    const lyrics = diagnosticsState.lyrics;
    if (diagnosticLyricTypeEl) diagnosticLyricTypeEl.textContent = lyrics.type;
    if (diagnosticLyricLinesEl) {
        diagnosticLyricLinesEl.textContent = lyrics.effectiveLines === null
            ? "未统计"
            : `${lyrics.effectiveLines} 行`;
    }
    if (diagnosticInterludeEl) {
        diagnosticInterludeEl.textContent = lyrics.interludeCount === null
            ? "未统计"
            : `${lyrics.interludeCount} 个`;
    }
    if (diagnosticLyricSummaryDetailEl) {
        const lines = lyrics.effectiveLines === null ? "有效行数待解析" : `有效行 ${lyrics.effectiveLines}`;
        const interludes = lyrics.interludeCount === null ? "间奏待解析" : `间奏标记 ${lyrics.interludeCount}`;
        diagnosticLyricSummaryDetailEl.textContent = [lines, interludes, lyrics.detail]
            .filter(Boolean)
            .join(" · ");
    }

    const match = diagnosticsState.match;
    if (diagnosticMatchEl) diagnosticMatchEl.textContent = match.text;
    if (diagnosticMatchDetailEl) {
        const progress = match.progress === null
            ? "等待进度"
            : `根据 ${formatDiagnosticSeconds(match.progress)}（校准后 ${formatDiagnosticSeconds(match.adjustedProgress)}）`;
        const line = match.lineIndex === null
            ? ""
            : `第 ${match.lineIndex + 1} 行`;
        diagnosticMatchDetailEl.textContent = [progress, line, match.detail]
            .filter(Boolean)
            .join(" · ");
    }

    const lyricAck = diagnosticsState.lyricAck;
    if (diagnosticLyricAckEl) {
        diagnosticLyricAckEl.textContent = formatDiagnosticMilliseconds(lyricAck.latencyMs);
    }
    if (diagnosticLyricAckDetailEl) {
        const lastAck = lyricAck.lastAt
            ? `上次 ${lyricAck.lastClock} · ${formatElapsed(lyricAck.lastAt)}`
            : "无回执";
        const statusCode = lyricAck.statusCode ? `HTTP ${lyricAck.statusCode}` : "";
        const consecutive = `连续超限 ${lyricAck.consecutiveDelayCount} 次`;
        diagnosticLyricAckDetailEl.textContent = [
            lyricAck.status,
            lastAck,
            statusCode,
            consecutive,
            lyricAck.status === "正常" || lyricAck.status === "已忽略"
                ? ""
                : lyricAck.detail
        ]
            .filter(Boolean)
            .join(" · ");
    }
};


setInterval(renderDiagnostics, 1000);


// 高频播放进度和低频监听/歌词匹配状态单独展示，不写入滚动日志。
window.TaskbarLyricsDebug = {
    updatePlaybackProgress: payload => {
        const rawTime = toFiniteNumber(payload?.rawTime);
        diagnosticsState.playback.rawTime = rawTime;
        diagnosticsState.playback.correctedTime = toFiniteNumber(payload?.correctedTime);
        diagnosticsState.playback.adjustedTime = toFiniteNumber(payload?.adjustedTime);
        diagnosticsState.playback.automaticOffset = toFiniteNumber(payload?.automaticOffset);
        diagnosticsState.playback.bufferCorrection = toFiniteNumber(payload?.bufferCorrection);
        diagnosticsState.playback.bufferCorrectionStatus = payload?.bufferCorrectionStatus ?? "未知";
        diagnosticsState.playback.bufferCorrectionReason = payload?.bufferCorrectionReason ?? "";
        diagnosticsState.playback.correctionStatus = payload?.correctionStatus ?? "未知";
        diagnosticsState.playback.correctionReason = payload?.correctionReason ?? "";
        diagnosticsState.playback.correctionCount = Number.isInteger(payload?.correctionCount)
            ? payload.correctionCount
            : 0;
        diagnosticsState.playback.updatedAt = getClockTime();
        renderDiagnostics();
    },
    updateListener: payload => {
        diagnosticsState.listener.status = payload?.status ?? "未知";
        diagnosticsState.listener.method = payload?.method ?? "-";
        diagnosticsState.listener.events = Array.isArray(payload?.events) ? payload.events : [];
        diagnosticsState.listener.detail = payload?.detail ?? "";
        if (payload?.status === "已注册") {
            diagnosticsState.listener.registeredAt = Date.now();
            diagnosticsState.listener.registeredClock = getClockTime();
            diagnosticsState.listener.registrationCount += 1;
        }
        diagnosticsState.listener.lastActivityAt = Date.now();
        diagnosticsState.listener.lastActivityClock = getClockTime();
        diagnosticsState.listener.lastActivityType = payload?.activity ?? "生命周期";
        renderDiagnostics();
    },
    touchListener: payload => {
        diagnosticsState.listener.lastActivityAt = Date.now();
        diagnosticsState.listener.lastActivityClock = getClockTime();
        diagnosticsState.listener.lastActivityType = payload?.event ?? "回调";
        renderDiagnostics();
    },
    updateLyricSummary: payload => {
        diagnosticsState.lyrics.type = payload?.type ?? "未获取";
        diagnosticsState.lyrics.effectiveLines = Number.isInteger(payload?.effectiveLines)
            ? payload.effectiveLines
            : null;
        diagnosticsState.lyrics.interludeCount = Number.isInteger(payload?.interludeCount)
            ? payload.interludeCount
            : null;
        diagnosticsState.lyrics.detail = payload?.detail ?? "";
        renderDiagnostics();
    },
    updateLyricAck: payload => {
        diagnosticsState.lyricAck.status = payload?.status ?? "未知";
        diagnosticsState.lyricAck.statusCode = Number.isInteger(payload?.statusCode)
            ? payload.statusCode
            : null;
        const latencyMs = toFiniteNumber(payload?.latencyMs);
        if (latencyMs !== null) diagnosticsState.lyricAck.latencyMs = latencyMs;
        const consecutiveDelayCount = toFiniteNumber(payload?.consecutiveDelayCount);
        if (consecutiveDelayCount !== null) {
            diagnosticsState.lyricAck.consecutiveDelayCount = Math.max(0, Math.round(consecutiveDelayCount));
        }
        diagnosticsState.lyricAck.detail = payload?.detail ?? "";
        diagnosticsState.lyricAck.currentLyric = payload?.currentLyric
            && typeof payload.currentLyric === "object"
            ? payload.currentLyric
            : null;
        diagnosticsState.lyricAck.lastAt = Date.now();
        diagnosticsState.lyricAck.lastClock = getClockTime();
        renderDiagnostics();
    },
    updateLyricMatch: payload => {
        diagnosticsState.match.text = payload?.text ?? "尚未匹配歌词";
        diagnosticsState.match.progress = toFiniteNumber(payload?.progress);
        diagnosticsState.match.adjustedProgress = toFiniteNumber(payload?.adjustedProgress);
        diagnosticsState.match.lineIndex = Number.isInteger(payload?.lineIndex) ? payload.lineIndex : null;
        diagnosticsState.match.detail = payload?.detail ?? "";
        renderDiagnostics();
    },
    reset: () => {
        diagnosticsState.playback = {
            rawTime: null,
            correctedTime: null,
            adjustedTime: null,
            automaticOffset: null,
            bufferCorrection: null,
            bufferCorrectionStatus: "未检测",
            bufferCorrectionReason: "等待缓冲前跳",
            correctionStatus: "未开始",
            correctionReason: "等待播放进度",
            correctionCount: 0,
            updatedAt: null
        };
        diagnosticsState.listener = {
            status: "未注册",
            method: "-",
            events: [],
            detail: "等待歌词监听注册",
            registeredAt: null,
            registeredClock: null,
            registrationCount: 0,
            lastActivityAt: null,
            lastActivityClock: null,
            lastActivityType: ""
        };
        diagnosticsState.lyrics = {
            type: "未获取",
            effectiveLines: null,
            interludeCount: null,
            detail: "等待歌词解析"
        };
        diagnosticsState.match = {
            text: "尚未匹配歌词",
            progress: null,
            adjustedProgress: null,
            lineIndex: null,
            detail: "等待歌词加载"
        };
        diagnosticsState.lyricAck = {
            status: "未检测",
            statusCode: null,
            latencyMs: null,
            consecutiveDelayCount: 0,
            detail: "等待 C++ 歌词回执",
            currentLyric: null,
            lastAt: null,
            lastClock: null
        };
        renderDiagnostics();
    }
};

window.TaskbarLyricsLog = (message, level = "info") => {
    const time = getClockTime();

    const entry = document.createElement("div");
    entry.className = `log-entry log-${level}`;

    const timeSpan = document.createElement("span");
    timeSpan.className = "log-time";
    timeSpan.textContent = `[${time}]`;

    const msgSpan = document.createElement("span");
    msgSpan.textContent = ` ${message}`;

    entry.appendChild(timeSpan);
    entry.appendChild(msgSpan);

    if (logEntriesEl) {
        logEntriesEl.appendChild(entry);
        while (logEntriesEl.children.length > 200)
            logEntriesEl.removeChild(logEntriesEl.firstChild);
        if (logContainerEl.scrollTop + logContainerEl.clientHeight >= logContainerEl.scrollHeight - 30)
            logContainerEl.scrollTop = logContainerEl.scrollHeight;
    } else {
        logBuffer.push(entry);
    }
};


plugin.onConfig(tools => configView);


plugin.onLoad(async () => {
    const pluginConfig = this.base.pluginConfig;
    const {
        font,
        color,
        style,
        lyrics,
        effect,
        hide,
        align,
        position,
        margin,
        screen,
        transition,
    } = { ...this.func };


    // 加载结构
    {
        const path = `${this.pluginPath}/config.html`;
        const text = await betterncm.fs.readFileText(path);
        const parser = new DOMParser();
        const dom = parser.parseFromString(text, "text/html");
        const element = dom.querySelector("#taskbar-lyrics-dom");
        configView.appendChild(element);
    }


    // 加载样式
    {
        const path = `${this.pluginPath}/style.css`;
        const text = await betterncm.fs.readFileText(path);
        const element = document.createElement("style");
        element.textContent = text;
        configView.appendChild(element);
    }


    // 加载关于页面的构建信息
    {
        const fields = {
            name: configView.querySelector(".plugin-info-name"),
            version: configView.querySelector(".plugin-info-version"),
            buildTime: configView.querySelector(".plugin-info-build-time"),
            channel: configView.querySelector(".plugin-info-channel"),
            commit: configView.querySelector(".plugin-info-commit")
        };
        const readJson = async filename => {
            try {
                return JSON.parse(await betterncm.fs.readFileText(`${this.pluginPath}/${filename}`));
            } catch {
                return {};
            }
        };
        const formatBuildTime = value => {
            if (!value) return "未提供";
            const timestamp = Date.parse(value);
            if (!Number.isFinite(timestamp)) return value;
            return `${new Date(timestamp).toLocaleString()}（本地时间）`;
        };

        const manifest = await readJson("manifest.json");
        const buildInfo = await readJson("build-info.json");
        fields.name.textContent = buildInfo.name || manifest.name || "任务栏歌词";
        fields.version.textContent = buildInfo.version || manifest.version || "未提供";
        fields.buildTime.textContent = formatBuildTime(buildInfo.build_time);
        fields.channel.textContent = buildInfo.channel || "未提供";
        fields.commit.textContent = buildInfo.commit
            ? String(buildInfo.commit).slice(0, 12)
            : "未提供";
    }


    // 页面切换
    {
        const tab_box = configView.querySelector(".tab_box");
        const content_box = configView.querySelector(".content_box")

        const all_tab_button = tab_box.querySelectorAll(".tab_button");
        const all_content = Array.from(content_box.children)
            .filter(content => content.classList.contains("content"));

        all_tab_button.forEach(tab => {
            tab.addEventListener("click", () => {
                // 激活标签
                const active_tab = tab_box.querySelector(".active");
                active_tab?.classList.remove("active");
                tab.classList.add("active");
                // 显示内容
                const target = tab.dataset.tab;
                all_content.forEach(content => {
                    content.classList.toggle("show", content.classList.contains(target));
                });
                content_box.classList.toggle("log-active", target === "log");
            });
        });
    }


    // 通用的下拉选择框控制函数
    function selectController(event) {
        const open = event.target.parentElement.classList.contains("z-open");
        if (open) event.target.parentElement.classList.remove("z-open");
        else event.target.parentElement.classList.add("z-open");
    }


    // 点击其他地方收起下拉选择框
    addEventListener("pointerup", event => {
        if (!event.target.classList.contains("value")) {
            const open = configView.querySelectorAll(".u-select.z-open");
            open.forEach(value => value.classList.remove("z-open"));
        }
    });


    // 更换字体
    {
        const apply = configView.querySelector(".content.font .font-settings .apply");
        const reset = configView.querySelector(".content.font .font-settings .reset");

        const fontFamily = configView.querySelector(".content.font .font-settings .font-family");

        const elements = {
            fontFamily
        };

        apply.addEventListener("click", () => font.apply(elements));
        reset.addEventListener("click", () => font.reset(elements));

        fontFamily.value = pluginConfig.get("font")["font_family"];
    }


    // 字体颜色
    {
        const apply = configView.querySelector(".content.font .color-settings .apply");
        const reset = configView.querySelector(".content.font .color-settings .reset");

        const basicLightColor = configView.querySelector(".content.font .color-settings .basic-light-color");
        const basicLightOpacity = configView.querySelector(".content.font .color-settings .basic-light-opacity");
        const basicDarkColor = configView.querySelector(".content.font .color-settings .basic-dark-color");
        const basicDarkOpacity = configView.querySelector(".content.font .color-settings .basic-dark-opacity");
        const extraLightColor = configView.querySelector(".content.font .color-settings .extra-light-color");
        const extraLightOpacity = configView.querySelector(".content.font .color-settings .extra-light-opacity");
        const extraDarkColor = configView.querySelector(".content.font .color-settings .extra-dark-color");
        const extraDarkOpacity = configView.querySelector(".content.font .color-settings .extra-dark-opacity");

        const elements = {
            basicLightColor,
            basicLightOpacity,
            basicDarkColor,
            basicDarkOpacity,
            extraLightColor,
            extraLightOpacity,
            extraDarkColor,
            extraDarkOpacity
        }

        apply.addEventListener("click", () => color.apply(elements));
        reset.addEventListener("click", () => color.reset(elements));

        basicLightColor.value = `#${pluginConfig.get("color")["basic"]["light"]["hex_color"].toString(16).padStart(6, "0")}`;
        basicLightOpacity.value = pluginConfig.get("color")["basic"]["light"]["opacity"];
        basicDarkColor.value = `#${pluginConfig.get("color")["basic"]["dark"]["hex_color"].toString(16).padStart(6, "0")}`;
        basicDarkOpacity.value = pluginConfig.get("color")["basic"]["dark"]["opacity"];
        extraLightColor.value = `#${pluginConfig.get("color")["extra"]["light"]["hex_color"].toString(16).padStart(6, "0")}`;
        extraLightOpacity.value = pluginConfig.get("color")["extra"]["light"]["opacity"];
        extraDarkColor.value = `#${pluginConfig.get("color")["extra"]["dark"]["hex_color"].toString(16).padStart(6, "0")}`;
        extraDarkOpacity.value = pluginConfig.get("color")["extra"]["dark"]["opacity"];
    }


    // 字体样式
    {
        const reset = configView.querySelector(".content.font .style-settings .reset");

        const basicWeightValue = configView.querySelector(".content.font .style-settings .basic-weight .value");
        const basicWeightSelect = configView.querySelector(".content.font .style-settings .basic-weight .select");
        const basicNormal = configView.querySelector(".content.font .style-settings .basic-normal");
        const basicOblique = configView.querySelector(".content.font .style-settings .basic-oblique");
        const basicItalic = configView.querySelector(".content.font .style-settings .basic-italic");
        const basicUnderline = configView.querySelector(".content.font .style-settings .basic-underline");
        const basicStrikethrough = configView.querySelector(".content.font .style-settings .basic-strikethrough");
        const extraWeightValue = configView.querySelector(".content.font .style-settings .extra-weight .value");
        const extraWeightSelect = configView.querySelector(".content.font .style-settings .extra-weight .select");
        const extraNormal = configView.querySelector(".content.font .style-settings .extra-normal");
        const extraOblique = configView.querySelector(".content.font .style-settings .extra-oblique");
        const extraItalic = configView.querySelector(".content.font .style-settings .extra-italic");
        const extraUnderline = configView.querySelector(".content.font .style-settings .extra-underline");
        const extraStrikethrough = configView.querySelector(".content.font .style-settings .extra-strikethrough");

        const elements = {
            basicWeightValue,
            basicUnderline,
            basicStrikethrough,
            extraWeightValue,
            extraUnderline,
            extraStrikethrough
        }

        reset.addEventListener("click", () => style.reset(elements));

        basicNormal.addEventListener("click", event => style.setSlopeNormal(event));
        basicOblique.addEventListener("click", event => style.setSlopeOblique(event));
        basicItalic.addEventListener("click", event => style.setSlopeItalic(event));
        basicUnderline.addEventListener("change", event => style.setUnderline(event));
        basicStrikethrough.addEventListener("change", event => style.setStrikethrough(event));
        extraNormal.addEventListener("click", event => style.setSlopeNormal(event));
        extraOblique.addEventListener("click", event => style.setSlopeOblique(event));
        extraItalic.addEventListener("click", event => style.setSlopeItalic(event));
        extraUnderline.addEventListener("change", event => style.setUnderline(event));
        extraStrikethrough.addEventListener("change", event => style.setStrikethrough(event));

        basicWeightValue.addEventListener("click", selectController);
        basicWeightSelect.addEventListener("click", event => {
            const name = event.target.parentElement.dataset.type;
            const value = event.target.dataset.value;
            const textContent = event.target.textContent;
            style.setWeight(name, value, textContent);
            basicWeightValue.textContent = textContent;
        });

        extraWeightValue.addEventListener("click", selectController);
        extraWeightSelect.addEventListener("click", event => {
            const name = event.target.parentElement.dataset.type;
            const value = event.target.dataset.value;
            const textContent = event.target.textContent;
            style.setWeight(name, value, textContent);
            extraWeightValue.textContent = textContent;
        });

        basicWeightValue.textContent = pluginConfig.get("style")["basic"]["weight"]["textContent"];
        basicUnderline.checked = pluginConfig.get("style")["basic"]["underline"];
        basicStrikethrough.checked = pluginConfig.get("style")["basic"]["strikethrough"];
        extraWeightValue.textContent = pluginConfig.get("style")["extra"]["weight"]["textContent"];
        extraUnderline.checked = pluginConfig.get("style")["extra"]["underline"];
        extraStrikethrough.checked = pluginConfig.get("style")["extra"]["strikethrough"];
    }


    // 歌词设置
    {
        const reset = configView.querySelector(".content.lyrics .lyrics-settings .reset");

        const lyricsSwitch = configView.querySelector(".content.lyrics .lyrics-settings .lyrics-switch");
        const retrievalMethodValue = configView.querySelector(".content.lyrics .lyrics-settings .retrieval-method .value");
        const retrievalMethodSelect = configView.querySelector(".content.lyrics .lyrics-settings .retrieval-method .select");
        const requestDynamicLyrics = configView.querySelector(".content.lyrics .lyrics-settings .request-dynamic-lyrics");

        const elements = {
            retrievalMethodValue,
            requestDynamicLyrics
        }

        reset.addEventListener("click", () => lyrics.reset(elements));

        lyricsSwitch.addEventListener("change", event => lyrics.lyricsSwitch(event));
        requestDynamicLyrics.addEventListener("change", event => lyrics.setRequestDynamicLyrics(event));

        retrievalMethodValue.addEventListener("click", selectController);
        retrievalMethodSelect.addEventListener("click", event => {
            const value = event.target.dataset.value;
            const textContent = event.target.textContent;
            if ((value == "2") && (!window.currentLyrics)) {
                channel.call(
                    "trayicon.popBalloon",
                    () => { },
                    [{
                        title: "任务栏歌词",
                        text: "无法使用RefinedNowPlaying歌词！\n是否安装RefinedNowPlaying插件？\n将回退到使用LibLyric解析获取歌词",
                        icon: "path",
                        hasSound: true,
                        delayTime: 2e3
                    }]
                );
                return;
            }
            lyrics.setRetrievalMethod(value, textContent);
            retrievalMethodValue.textContent = textContent;
        });

        const lyricsConfig = pluginConfig.get("lyrics");
        retrievalMethodValue.textContent = lyricsConfig["retrieval_method"]["textContent"];
        requestDynamicLyrics.checked = lyricsConfig["request_dynamic_lyrics"];
    }


    // 显示效果
    {
        const apply = configView.querySelector(".content.lyrics .effect-settings .apply");
        const reset = configView.querySelector(".content.lyrics .effect-settings .reset");

        const adjust = configView.querySelector(".content.lyrics .effect-settings .adjust");

        const elements = {
            adjust
        }

        apply.addEventListener("click", () => effect.apply(elements));
        reset.addEventListener("click", () => effect.reset(elements));

        adjust.value = pluginConfig.get("effect")["adjust"];
    }


    // 逐句隐藏
    {
        const apply = configView.querySelector(".content.lyrics .hide-settings .apply");
        const reset = configView.querySelector(".content.lyrics .hide-settings .reset");

        const hideEnabled = configView.querySelector(".content.lyrics .hide-settings .hide-enabled");
        const minimumGap = configView.querySelector(".content.lyrics .hide-settings .minimum-gap");

        const elements = {
            hideEnabled,
            minimumGap
        }

        apply.addEventListener("click", () => hide.apply(elements));
        reset.addEventListener("click", () => hide.reset(elements));
        hideEnabled.addEventListener("change", event => hide.setEnabled(event));

        const hideConfig = pluginConfig.get("hide");
        hideEnabled.checked = hideConfig["enabled"];
        minimumGap.value = hideConfig["minimum_gap"];
    }


    // 对齐方式
    {
        const reset = configView.querySelector(".content.lyrics .align-settings .reset");

        const basicLeft = configView.querySelector(".content.lyrics .align-settings .basic-left");
        const basicCenter = configView.querySelector(".content.lyrics .align-settings .basic-center");
        const basicRight = configView.querySelector(".content.lyrics .align-settings .basic-right");
        const extraLeft = configView.querySelector(".content.lyrics .align-settings .extra-left");
        const extraCenter = configView.querySelector(".content.lyrics .align-settings .extra-center");
        const extraRight = configView.querySelector(".content.lyrics .align-settings .extra-right");

        reset.addEventListener("click", () => align.reset());

        basicLeft.addEventListener("click", event => align.setLeft(event));
        basicCenter.addEventListener("click", event => align.setCenter(event));
        basicRight.addEventListener("click", event => align.setRight(event));
        extraLeft.addEventListener("click", event => align.setLeft(event));
        extraCenter.addEventListener("click", event => align.setCenter(event));
        extraRight.addEventListener("click", event => align.setRight(event));
    }


    // 修改位置
    {
        const reset = configView.querySelector(".content.window .position-settings .reset");

        const windowPositionValue = configView.querySelector(".content.window .position-settings .window-position .value");
        const windowPositionSelect = configView.querySelector(".content.window .position-settings .window-position .select");

        const elements = {
            windowPositionValue
        }

        reset.addEventListener("click", () => position.reset(elements));

        windowPositionValue.addEventListener("click", selectController);
        windowPositionSelect.addEventListener("click", event => {
            const value = event.target.dataset.value;
            const textContent = event.target.textContent;
            position.setWindowPosition(value, textContent);
            windowPositionValue.textContent = textContent;
        });

        windowPositionValue.textContent = pluginConfig.get("position")["position"]["textContent"];
    }


    // 修改边距
    {
        const apply = configView.querySelector(".content.window .margin-settings .apply");
        const reset = configView.querySelector(".content.window .margin-settings .reset");

        const left = configView.querySelector(".content.window .margin-settings .left");
        const right = configView.querySelector(".content.window .margin-settings .right");
        const singleBottom = configView.querySelector(".content.window .margin-settings .single-bottom");
        const doubleBottom = configView.querySelector(".content.window .margin-settings .double-bottom");

        const elements = {
            left,
            right,
            singleBottom,
            doubleBottom
        }

        apply.addEventListener("click", () => margin.apply(elements));
        reset.addEventListener("click", () => margin.reset(elements));

        left.value = pluginConfig.get("margin")["left"];
        right.value = pluginConfig.get("margin")["right"];
        singleBottom.value = pluginConfig.get("margin")["single_bottom"] ?? 0;
        doubleBottom.value = pluginConfig.get("margin")["double_bottom"] ?? 0;
    }


    // 切换屏幕
    {
        const reset = configView.querySelector(".content.window .screen-settings .reset");

        const parentTaskbarValue = configView.querySelector(".content.window .screen-settings .parent-taskbar .value");
        const parentTaskbarSelect = configView.querySelector(".content.window .screen-settings .parent-taskbar .select");

        const elements = {
            parentTaskbarValue
        }

        reset.addEventListener("click", () => screen.reset(elements));

        parentTaskbarValue.addEventListener("click", selectController);
        parentTaskbarSelect.addEventListener("click", event => {
            const value = event.target.dataset.value;
            const textContent = event.target.textContent;
            screen.setParentTaskbar(value, textContent);
            parentTaskbarValue.textContent = textContent;
        });

        parentTaskbarValue.textContent = pluginConfig.get("screen")["parent_taskbar"]["textContent"];
    }


    // 过渡动画
    {
        const apply = configView.querySelector(".content.lyrics .transition-settings .apply");
        const reset = configView.querySelector(".content.lyrics .transition-settings .reset");

        const fadeInDuration = configView.querySelector(".content.lyrics .transition-settings .fade-in-duration");
        const fadeOutDuration = configView.querySelector(".content.lyrics .transition-settings .fade-out-duration");
        const frameRate = configView.querySelector(".content.lyrics .transition-settings .frame-rate");
        const overlap = configView.querySelector(".content.lyrics .transition-settings .overlap");
        const transitionModeValue = configView.querySelector(".content.lyrics .transition-settings .transition-mode .value");
        const transitionModeSelect = configView.querySelector(".content.lyrics .transition-settings .transition-mode .select");
        const gap = configView.querySelector(".content.lyrics .transition-settings .gap");
        const curveValue = configView.querySelector(".content.lyrics .transition-settings .curve-select .value");
        const curveSelect = configView.querySelector(".content.lyrics .transition-settings .curve-select .select");

        const elements = {
            fadeInDuration,
            fadeOutDuration,
            frameRate,
            overlap,
            transitionModeValue,
            gap,
            curveValue
        }

        apply.addEventListener("click", () => transition.apply(elements));
        reset.addEventListener("click", () => transition.reset(elements));

        transitionModeValue.addEventListener("click", selectController);
        transitionModeSelect.addEventListener("click", event => {
            const value = event.target.dataset.value;
            const textContent = event.target.textContent;
            if (!value) return;
            transitionModeValue.textContent = textContent;
            transitionModeValue.dataset.value = value;
        });

        curveValue.addEventListener("click", selectController);
        curveSelect.addEventListener("click", event => {
            const value = event.target.dataset.value;
            const textContent = event.target.textContent;
            transition.setCurve(value, textContent);
            curveValue.textContent = textContent;
            curveValue.dataset.value = value;
        });

        const config = pluginConfig.get("transition");
        fadeInDuration.value = config["fade_in"]["duration"];
        fadeOutDuration.value = config["fade_out"]["duration"];
        frameRate.value = config["frame_rate"];
        overlap.value = config["overlap"];
        transitionModeValue.textContent = config["crossfade"] ? "交叉淡入淡出" : "淡出后淡入";
        transitionModeValue.dataset.value = config["crossfade"] ? "crossfade" : "sequential";
        gap.value = config["gap"];
        const curveNames = ["线性", "缓入", "缓出", "缓入缓出", "回弹"];
        curveValue.textContent = curveNames[config["curve"]] || "缓入";
        curveValue.dataset.value = config["curve"];
    }


    // 连接日志 DOM
    {
        logEntriesEl = configView.querySelector(".log-entries");
        logContainerEl = configView.querySelector(".log-container");
        const logClear = configView.querySelector(".log-clear");
        diagnosticProgressEl = configView.querySelector(".diagnostic-progress");
        diagnosticProgressDetailEl = configView.querySelector(".diagnostic-progress-detail");
        diagnosticBufferCorrectionEl = configView.querySelector(".diagnostic-buffer-correction");
        diagnosticBufferCorrectionDetailEl = configView.querySelector(".diagnostic-buffer-correction-detail");
        diagnosticListenerEl = configView.querySelector(".diagnostic-listener");
        diagnosticListenerDetailEl = configView.querySelector(".diagnostic-listener-detail");
        diagnosticLyricTypeEl = configView.querySelector(".diagnostic-lyric-type");
        diagnosticLyricLinesEl = configView.querySelector(".diagnostic-lyric-lines");
        diagnosticInterludeEl = configView.querySelector(".diagnostic-interlude");
        diagnosticLyricSummaryDetailEl = configView.querySelector(".diagnostic-lyric-summary-detail");
        diagnosticLyricAckEl = configView.querySelector(".diagnostic-lyric-ack");
        diagnosticLyricAckDetailEl = configView.querySelector(".diagnostic-lyric-ack-detail");
        diagnosticMatchEl = configView.querySelector(".diagnostic-match");
        diagnosticMatchDetailEl = configView.querySelector(".diagnostic-match-detail");
        const diagnosticsReset = configView.querySelector(".diagnostics-reset");
        const diagnosticsDisconnect = configView.querySelector(".diagnostics-disconnect");

        // 刷新缓冲区
        if (logEntriesEl) {
            logBuffer.forEach(e => logEntriesEl.appendChild(e));
            logBuffer.length = 0;
        }
        renderDiagnostics();

        logClear.addEventListener("click", () => {
            if (logEntriesEl) logEntriesEl.innerHTML = "";
        });
        diagnosticsReset?.addEventListener("click", () => window.TaskbarLyricsDebug.reset());
        diagnosticsDisconnect?.addEventListener("click", () => {
            const simulateLyricAckFailure = window.TaskbarLyricsDebugTransport?.simulateLyricAckFailure;
            if (typeof simulateLyricAckFailure === "function") {
                simulateLyricAckFailure();
            } else {
                window.TaskbarLyricsLog?.("[调试] C++ 调试接口尚未就绪，请稍后再试", "warn");
            }
        });
    }
});
