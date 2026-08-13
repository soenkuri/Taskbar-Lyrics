"use strict";


plugin.onLoad(async () => {
    const TaskbarLyricsPort = BETTERNCM_API_PORT - 2;
    const addLog = (...args) => window.TaskbarLyricsLog?.(...args);
    let simulateLyricAckFailureOnce = false;

    const TaskbarLyricsFetch = async (path, params) => {
        const body = JSON.stringify(params ?? {});
        const endpoint = `POST /taskbar${path}`;

        if (path === "/lyrics/lyrics" && simulateLyricAckFailureOnce) {
            simulateLyricAckFailureOnce = false;
            const error = new Error("调试：模拟 C++ 歌词回执超时");
            window.TaskbarLyricsDebug?.updateLyricAck?.({
                status: "模拟失败",
                statusCode: null,
                detail: "调试工具已触发一次歌词回执失败"
            });
            throw error;
        }

        try {
            const response = await fetch(
                `http://127.0.0.1:${TaskbarLyricsPort}/taskbar${path}`,
                {
                    method: "POST",
                    body,
                    headers: {
                        "Content-Type": "application/json"
                    }
                }
            );
            if (!response.ok) {
                addLog(`[C++请求] ${endpoint} 返回异常：HTTP ${response.status}`, "warn");
            }
            return response;
        } catch (error) {
            addLog(`[C++请求] ${endpoint} 失败：${error?.message ?? error}`, "error");
            throw error;
        }
    };

    const TaskbarLyricsAPI = {
        // 字体设置
        font: {
            font: params => TaskbarLyricsFetch("/font/font", params),
            color: params => TaskbarLyricsFetch("/font/color", params),
            style: params => TaskbarLyricsFetch("/font/style", params),
        },

        // 歌词设置
        lyrics: {
            lyrics: params => TaskbarLyricsFetch("/lyrics/lyrics", params),
            align: params => TaskbarLyricsFetch("/lyrics/align", params),
        },

        // 窗口设置
        window: {
            position: params => TaskbarLyricsFetch("/window/position", params),
            margin: params => TaskbarLyricsFetch("/window/margin", params),
            screen: params => TaskbarLyricsFetch("/window/screen", params),
        },

        // 过渡动画
        animation: params => TaskbarLyricsFetch("/animation", params),

        // 关闭
        close: params => TaskbarLyricsFetch("/close", params)
    };


    // 日志页使用的一次性歌词回执失败模拟；下一次歌词请求会进入真实重连流程。
    window.TaskbarLyricsDebugTransport = {
        simulateLyricAckFailure: () => {
            if (simulateLyricAckFailureOnce) return;
            simulateLyricAckFailureOnce = true;
            addLog("[调试] 已安排一次歌词回执失败，将由下一次歌词请求触发重连", "warn");
        }
    };


    // 对应Windows的枚举
    const WindowsEnum = {
        WindowAlignment: {
            WindowAlignmentAdaptive: 0,
            WindowAlignmentLeft: 1,
            WindowAlignmentCenter: 2,
            WindowAlignmentRight: 3
        },
        DWRITE_TEXT_ALIGNMENT: {
            DWRITE_TEXT_ALIGNMENT_LEADING: 0,
            DWRITE_TEXT_ALIGNMENT_TRAILING: 1,
            DWRITE_TEXT_ALIGNMENT_CENTER: 2,
            DWRITE_TEXT_ALIGNMENT_JUSTIFIED: 3
        },
        DWRITE_FONT_WEIGHT: {
            DWRITE_FONT_WEIGHT_THIN: 100,
            DWRITE_FONT_WEIGHT_EXTRA_LIGHT: 200,
            DWRITE_FONT_WEIGHT_ULTRA_LIGHT: 200,
            DWRITE_FONT_WEIGHT_LIGHT: 300,
            DWRITE_FONT_WEIGHT_SEMI_LIGHT: 350,
            DWRITE_FONT_WEIGHT_NORMAL: 400,
            DWRITE_FONT_WEIGHT_REGULAR: 400,
            DWRITE_FONT_WEIGHT_MEDIUM: 500,
            DWRITE_FONT_WEIGHT_DEMI_BOLD: 600,
            DWRITE_FONT_WEIGHT_SEMI_BOLD: 600,
            DWRITE_FONT_WEIGHT_BOLD: 700,
            DWRITE_FONT_WEIGHT_EXTRA_BOLD: 800,
            DWRITE_FONT_WEIGHT_ULTRA_BOLD: 800,
            DWRITE_FONT_WEIGHT_BLACK: 900,
            DWRITE_FONT_WEIGHT_HEAVY: 900,
            DWRITE_FONT_WEIGHT_EXTRA_BLACK: 950,
            DWRITE_FONT_WEIGHT_ULTRA_BLACK: 950
        },
        DWRITE_FONT_STYLE: {
            DWRITE_FONT_STYLE_NORMAL: 0,
            DWRITE_FONT_STYLE_OBLIQUE: 1,
            DWRITE_FONT_STYLE_ITALIC: 2
        }
    };


    // 默认的配置
    const defaultConfig = {
        "font": {
            "font_family": "Microsoft YaHei UI"
        },
        "color": {
            "basic": {
                "light": {
                    "hex_color": 0x000000,
                    "opacity": 1.0
                },
                "dark": {
                    "hex_color": 0xFFFFFF,
                    "opacity": 1.0
                }
            },
            "extra": {
                "light": {
                    "hex_color": 0x000000,
                    "opacity": 1.0
                },
                "dark": {
                    "hex_color": 0xFFFFFF,
                    "opacity": 1.0
                }
            }
        },
        "style": {
            "basic": {
                "weight": {
                    "value": WindowsEnum.DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_LIGHT,
                    "textContent": "Light (300)"
                },
                "slope": WindowsEnum.DWRITE_FONT_STYLE.DWRITE_FONT_STYLE_NORMAL,
                "underline": false,
                "strikethrough": false
            },
            "extra": {
                "weight": {
                    "value": WindowsEnum.DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_LIGHT,
                    "textContent": "Light (300)"
                },
                "slope": WindowsEnum.DWRITE_FONT_STYLE.DWRITE_FONT_STYLE_NORMAL,
                "underline": false,
                "strikethrough": false
            }
        },
        "lyrics": {
            "retrieval_method": {
                "value": 1,
                "textContent": "使用LibLyric解析获取歌词",
            },
            "request_dynamic_lyrics": true
        },
        "effect": {
            "adjust": 0.0
        },
        "hide": {
            "enabled": false,
            "minimum_gap": 400
        },
        "align": {
            "basic": WindowsEnum.DWRITE_TEXT_ALIGNMENT.DWRITE_TEXT_ALIGNMENT_CENTER,
            "extra": WindowsEnum.DWRITE_TEXT_ALIGNMENT.DWRITE_TEXT_ALIGNMENT_CENTER
        },
        "position": {
            "position": {
                "value": WindowsEnum.WindowAlignment.WindowAlignmentCenter,
                "textContent": "居中，歌词窗口居中显示"
            }
        },
        "margin": {
            "left": 0,
            "right": 0,
            "single_bottom": 0,
            "double_bottom": 0
        },
        "screen": {
            "parent_taskbar": {
                "value": "Shell_TrayWnd",
                "textContent": "主屏幕任务栏"
            }
        },
        "transition": {
            "fade_in": {
                "duration": 250
            },
            "fade_out": {
                "duration": 150
            },
            "frame_rate": 90,
            "overlap": 300,
            "crossfade": false,
            "gap": 10,
            "curve": 3
        }
    };


    // 过渡动画配置迁移（兼容旧版 duration/steps 结构）
    const migrateTransition = saved => {
        if (!saved) return defaultConfig.transition;

        const result = JSON.parse(JSON.stringify(defaultConfig.transition));

        // 旧版扁平结构 { duration, steps }
        if ("duration" in saved && "steps" in saved) {
            const duration = Number(saved.duration) || 400;
            const steps = Number(saved.steps) || 10;
            result.fade_in.duration = duration;
            result.fade_out.duration = duration;
            result.frame_rate = Math.round(1000 * steps / duration) || 60;
            result.overlap = duration;
            if (saved.curve !== undefined) result.curve = saved.curve;
            return result;
        }

        // 新版结构
        if (saved.fade_in?.duration !== undefined) {
            result.fade_in.duration = Number(saved.fade_in.duration);
        }
        if (saved.fade_out?.duration !== undefined) {
            result.fade_out.duration = Number(saved.fade_out.duration);
        }
        if (saved.frame_rate !== undefined) {
            result.frame_rate = Number(saved.frame_rate);
        }
        // 若保存的是旧版 fade_in.steps，用时长反推帧率
        else if (saved.fade_in?.steps !== undefined && saved.fade_in?.duration !== undefined) {
            result.frame_rate = Math.round(1000 * saved.fade_in.steps / saved.fade_in.duration) || 60;
        }
        if (saved.overlap !== undefined) {
            result.overlap = Number(saved.overlap);
        }
        if (saved.crossfade !== undefined) {
            result.crossfade = Boolean(saved.crossfade);
        }
        if (saved.gap !== undefined) {
            const gap = Number(saved.gap);
            result.gap = Number.isFinite(gap) ? Math.min(Math.max(gap, -5000), 5000) : 0;
        }
        if (saved.curve !== undefined) {
            result.curve = Number(saved.curve);
        }

        return result;
    };


    const pluginConfig = {
        get: name => {
            const saved = plugin.getConfig(name, defaultConfig[name]);
            if (name === "transition") return migrateTransition(saved);
            return Object.assign({}, defaultConfig[name], saved);
        },
        set: (name, value) => plugin.setConfig(name, value)
    };


    // 启动、重启和设置页重新开启可能来自不同插件脚本；统一排队，
    // 避免两个命令同时启动 taskbar-lyrics.exe。
    const queueTaskbarLyricsProcessOperation = operation => {
        const previous = this.base?.taskbarLyricsProcessOperation ?? Promise.resolve();
        const current = previous.catch(() => {}).then(operation);
        this.base.taskbarLyricsProcessOperation = current;
        const clearOperation = () => {
            if (this.base.taskbarLyricsProcessOperation === current) {
                this.base.taskbarLyricsProcessOperation = null;
            }
        };
        current.then(clearOperation, clearOperation);
        return current;
    };


    this.base = {
        TaskbarLyricsPort,
        TaskbarLyricsAPI,
        WindowsEnum,
        defaultConfig,
        pluginConfig,
        queueTaskbarLyricsProcessOperation,
        taskbarLyricsProcessOperation: null,
        taskbarLyricsStartingUntil: 0
    };
});
