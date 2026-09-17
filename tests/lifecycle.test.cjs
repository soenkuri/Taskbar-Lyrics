// 运行：node tests/lifecycle.test.cjs；使用真实插件脚本和内存替身，不启动 C++ 或发网络请求。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const response = (body = {}, status = 200) => ({
    ok: status >= 200 && status < 300, status,
    json: async () => body,
    clone: () => response(body, status)
});

async function harness(withSong = false) {
    const callbacks = [], intervals = new Map(), timeouts = new Map(), saved = new Map();
    const listeners = new Map(), events = new Map(), observers = [];
    let timerId = 0, startupToken;
    const h = { launches: 0, closes: 0, actions: [], sent: [], nextStatus: null, nextExec: null, nextElement: null };
    const context = vm.createContext({
        console, AbortController, BETTERNCM_API_PORT: 50000, pluginPath: "C:/plugin", window: {},
        plugin: {
            onLoad: callback => callbacks.push(callback),
            getConfig: (name, fallback) => saved.get(name) ?? fallback,
            setConfig: (name, value) => saved.set(name, value)
        },
        loadedPlugins: { liblyric: {
            getLyricData: async () => ({ lrc: { lyric: "测试歌词" } }),
            parseLyric: () => Array.from({ length: 5 }, (_, i) => ({
                time: i * 2000, duration: 1000, originalLyric: `歌词${i}`
            }))
        } },
        betterncm: {
            app: {
                getDataPath: async () => "C:/data",
                exec: command => {
                    h.launches++;
                    h.actions.push("启动");
                    startupToken = command.split(" ").at(-1);
                    const result = h.nextExec ?? Promise.resolve(true);
                    h.nextExec = null;
                    return result;
                }
            },
            ncm: { getPlayingSong: () => withSong ? { data: { id: 1, name: "测试歌曲", artists: [] } } : null },
            utils: { waitForElement: () => {
                const result = h.nextElement ?? Promise.resolve({});
                h.nextElement = null;
                return result;
            } }
        },
        fetch: async (url, options) => {
            if (url.endsWith("/status")) {
                const result = h.nextStatus ?? response({ startup_token: startupToken, started_at: Date.now() });
                h.nextStatus = null;
                return result;
            }
            if (url.endsWith("/close")) {
                h.closes++;
                h.actions.push("关闭");
                if (h.stallClose) {
                    return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new Error("关闭超时"))));
                }
                return response();
            }
            if (url.endsWith("/lyrics/lyrics")) {
                const body = JSON.parse(options.body);
                h.sent.push(body);
                return h.lyricResponse ?? response(body);
            }
            return response();
        },
        legacyNativeCmder: {
            appendRegisterCall: (name, type, callback) => listeners.set(name, callback),
            removeRegisterCall: name => listeners.delete(name)
        },
        MutationObserver: class {
            constructor(callback) { this.callback = callback; this.active = false; observers.push(this); }
            observe() { this.active = true; }
            disconnect() { this.active = false; }
        },
        addEventListener: (name, callback) => events.set(name, callback),
        setInterval: (callback, delay) => { const id = ++timerId; intervals.set(id, { callback, delay }); return id; },
        clearInterval: id => intervals.delete(id),
        setTimeout: (callback, delay) => { const id = ++timerId; timeouts.set(id, { callback, delay }); return id; },
        clearTimeout: id => timeouts.delete(id)
    });
    for (const name of ["base", "lyric", "func"]) {
        vm.runInContext(read(`src/betterncm-plugin/${name}.js`), context, { filename: `${name}.js` });
        await callbacks.shift()();
    }
    await flush();
    Object.assign(h, { context, intervals, timeouts, listeners, events, observers });
    h.toggle = checked => context.func.lyrics.lyricsSwitch({ target: { checked } });
    h.tick = () => {
        assert.equal(intervals.size, 1, "只有一个心跳定时器");
        const timer = [...intervals.values()][0];
        assert.equal(timer.delay, 5000);
        return timer.callback();
    };
    h.timeout = delay => {
        const entry = [...timeouts].find(([, timer]) => timer.delay === delay);
        assert.ok(entry, `存在 ${delay}ms 超时`);
        timeouts.delete(entry[0]);
        entry[1].callback();
    };
    h.closed = () => {
        assert.equal(intervals.size, 0, "关闭后没有心跳");
        assert.equal(listeners.size, 0, "关闭后没有播放监听");
        assert.equal(observers.filter(observer => observer.active).length, 0, "关闭后没有词栏监听");
    };
    return h;
}

async function run() {
    {
        const h = await harness();
        assert.equal(h.launches, 1);
        assert.equal(h.listeners.size, 3);
        await h.tick();
        assert.equal(h.launches, 1, "正常心跳不重启");
        assert.ok(![...h.timeouts.values()].some(timer => timer.delay === 3000), "心跳结束清理超时");
        h.context.func.lyrics.setRetrievalMethod(1, "LibLyric");
        assert.equal(h.intervals.size, 1, "切换歌词来源不停止心跳");
        await h.toggle(false);
        h.context.func.lyrics.setRetrievalMethod(0, "软件内词栏");
        await flush();
        h.closed();
    }
    for (const failure of ["拒绝", "超时", "HTTP错误"]) {
        const h = await harness(), pending = deferred();
        h.nextStatus = pending.promise;
        const heartbeat = h.tick();
        await h.toggle(false);
        if (failure === "超时") h.timeout(3000);
        else if (failure === "HTTP错误") pending.resolve(response({}, 500));
        else pending.reject(new Error("连接关闭"));
        await heartbeat;
        await flush();
        assert.equal(h.launches, 1, `关闭后的心跳${failure}不重启`);
        h.closed();
    }
    {
        const h = await harness(), pending = deferred();
        h.nextStatus = pending.promise;
        const heartbeat = h.tick();
        const closing = h.toggle(false), opening = h.toggle(true);
        await Promise.all([closing, opening]);
        pending.reject(new Error("旧请求迟到"));
        await heartbeat;
        await flush();
        assert.deepEqual(h.actions, ["启动", "关闭", "启动"]);
        assert.equal(h.intervals.size, 1, "旧心跳不影响新一轮运行");
        await h.toggle(false);
    }
    {
        const h = await harness(), blocker = deferred();
        h.context.base.queueTaskbarLyricsProcessOperation(() => blocker.promise);
        const opening = h.toggle(true), closing = h.toggle(false);
        blocker.resolve();
        await Promise.all([opening, closing]);
        assert.equal(h.launches, 1, "关闭前排队但尚未执行的启动被取消");
        h.closed();
    }
    for (const reconnect of [false, true]) {
        const h = await harness(), launch = deferred();
        h.nextExec = launch.promise;
        if (reconnect) {
            h.nextStatus = response({}, 500);
            await h.tick();
        } else {
            void h.toggle(true);
        }
        await flush();
        assert.equal(h.launches, 2);
        const closing = h.toggle(false);
        h.closed();
        launch.resolve(true);
        await closing;
        await flush();
        assert.equal(h.actions.at(-1), "关闭", "已发出的启动完成后再关闭迟到的进程");
        assert.equal(h.launches, 2);
        h.closed();
    }
    {
        const h = await harness(), blocker = deferred();
        h.context.base.queueTaskbarLyricsProcessOperation(() => blocker.promise);
        h.nextStatus = response({}, 500);
        await h.tick();
        const closing = h.toggle(false);
        blocker.resolve();
        await closing;
        await flush();
        assert.equal(h.launches, 1, "排队中的自动重连也可取消");
        h.closed();
    }
    {
        const h = await harness(), launch = deferred();
        h.nextExec = launch.promise;
        const opening = h.toggle(true);
        await flush();
        const closing = h.toggle(false);
        launch.reject(new Error("启动失败"));
        await Promise.all([opening, closing]);
        assert.equal(h.launches, 2, "关闭后的启动失败不重试");
        h.closed();
    }
    for (const timeout of [false, true]) {
        const h = await harness();
        h.nextStatus = timeout ? new Promise(() => {}) : response({}, 503);
        const heartbeat = h.tick();
        if (timeout) h.timeout(3000);
        await heartbeat;
        await flush();
        assert.equal(h.launches, 2, "运行中心跳异常仍立即重连");
        assert.equal(h.intervals.size, 1);
        assert.equal(h.listeners.size, 3);
        await h.toggle(false);
    }
    {
        const h = await harness(), oldElement = deferred();
        h.nextElement = oldElement.promise;
        h.context.func.lyrics.setRetrievalMethod(0, "软件内词栏");
        await h.toggle(false);
        await h.toggle(true);
        await flush();
        const currentObserver = h.observers.at(-1);
        assert.ok(currentObserver.active);
        oldElement.resolve({});
        await flush();
        assert.ok(currentObserver.active, "旧的词栏等待不能覆盖新监听");
        assert.equal(h.observers.length, 1);
        await h.toggle(false);
    }
    {
        const h = await harness();
        h.context.func.lyrics.setRetrievalMethod(0, "软件内词栏");
        await flush();
        h.lyricResponse = new Promise(() => {});
        for (let i = 1; i <= 3; i++) {
            h.observers.at(-1).callback([{ addedNodes: [{ textContent: `歌词${i}` }] }]);
            h.timeout(3000);
            await flush();
            assert.equal(h.launches, i < 3 ? 1 : 2, `连续第 ${i} 次歌词回执超限`);
        }
        await h.toggle(false);
    }
    {
        const h = await harness();
        h.stallClose = true;
        const closing = h.toggle(false), opening = h.toggle(true);
        await flush();
        assert.equal(h.launches, 1, "等待关闭请求期间不启动新实例");
        h.timeout(3000);
        await Promise.all([closing, opening]);
        assert.equal(h.launches, 2, "关闭请求超时后释放启动队列");
        h.stallClose = false;
        await h.toggle(false);
    }
    {
        const h = await harness(true);
        const state = value => h.listeners.get("PlayState")(null, value);
        const progress = value => h.listeners.get("PlayProgress")(null, value);
        await state(true);
        await progress(1.9);
        await flush();
        assert.equal(h.sent.at(-1).basic, "歌词0");
        const beforePause = h.sent.length;
        await state(false);
        const pauseTimer = [...h.timeouts.keys()].at(-1);
        await progress(2.1);
        assert.equal(h.sent.length, beforePause, "暂停防抖中跨句不再切换歌词");
        await state(false);
        assert.ok(h.timeouts.has(pauseTimer), "重复暂停信号不能延后确认");
        h.timeout(500);
        await flush();
        assert.equal(h.sent.at(-1).basic, "");
        await progress(4.1);
        await state(false);
        assert.equal(h.sent.length, beforePause + 1, "暂停后只发送一次空歌词");
        await state(true);
        await flush();
        assert.equal(h.sent.at(-1).basic, "歌词2", "恢复后补发实际进度对应歌词");
        const resumed = h.sent.length;
        await state(true);
        assert.equal(h.sent.length, resumed, "重复播放信号不重复补发");
        await h.toggle(false);
    }
    {
        const h = await harness(true);
        const state = value => h.listeners.get("PlayState")(null, value);
        const progress = value => h.listeners.get("PlayProgress")(null, value);
        await state(true);
        await progress(1.9);
        await flush();
        const beforePause = h.sent.length;
        await state({ playing: "false" });
        await progress(2.1);
        assert.equal(h.sent.length, beforePause, "对象中的字符串暂停状态正确识别");
        await state({ playing: "true" });
        await flush();
        assert.equal(h.sent.at(-1).basic, "歌词1", "取消暂停后补发防抖期间跨过的歌词");
        assert.ok(h.sent.slice(beforePause).every(lyric => lyric.basic), "短暂暂停不发空歌词");
        assert.ok(![...h.timeouts.values()].some(timer => timer.delay === 500));
        await h.toggle(false);
    }
    {
        const h = await harness(true);
        h.context.base.pluginConfig.set("hide", { enabled: true, minimum_gap: 400 });
        const state = value => h.listeners.get("PlayState")(null, value);
        const progress = value => h.listeners.get("PlayProgress")(null, value);
        await state(true);
        await progress(0.5);
        await flush();
        await state(false);
        const beforePause = h.sent.length;
        await progress(1.2);
        assert.ok(![...h.timeouts.values()].some(timer => timer.delay === 100), "暂停防抖中不重新安排句末隐藏");
        h.timeout(500);
        await flush();
        assert.equal(h.sent.length, beforePause + 1);
        await h.toggle(false);
    }
    {
        const h = await harness(true);
        h.context.base.pluginConfig.set("hide", { enabled: true, minimum_gap: 400 });
        await h.listeners.get("PlayState")(null, true);
        await h.listeners.get("PlayProgress")(null, 1.2);
        await flush();
        h.timeout(100);
        await flush();
        assert.equal(h.sent.at(-1).basic, "");
        const hidden = h.sent.length;
        await h.listeners.get("PlayState")(null, false);
        h.timeout(500);
        await flush();
        assert.equal(h.sent.length, hidden, "已在间奏隐藏时暂停不再触发空歌词动画");
        await h.toggle(false);
    }
    // C++ 只检查关键线程路由和防护是否保留；不替代编译及 Win32 运行验证。
    const windowSource = read("src/taskbar-lyrics/CreateWindow.cpp");
    const networkSource = read("src/taskbar-lyrics/NetworkServer.cpp");
    const renderSource = read("src/taskbar-lyrics/RenderWindow.cpp");
    assert.ok(!windowSource.includes("剩余宽度检测_线程"));
    assert.match(windowSource, /SetTimer\(this->窗口句柄, 任务栏检测定时器, 1000, nullptr\)/);
    assert.match(windowSource, /case WM_TASKBAR_CONFIG:/);
    assert.match(windowSource, /if \(字参数 == 任务栏检测定时器\)/);
    assert.match(windowSource, /SetParent[\s\S]*?if \(GetAncestor\(this->窗口句柄, GA_PARENT\) != 任务栏句柄\) return;/);
    assert.ok(!networkSource.includes("SetParent("));
    assert.ok(!networkSource.includes("窗口->任务栏窗口类名"));
    assert.match(networkSource, /SendMessage\(this->任务栏窗口->窗口句柄, WM_TASKBAR_CONFIG/);
    assert.match(renderSource, /GetAncestor\(\*this->窗口句柄, GA_PARENT\) != this->任务栏_句柄/);
    const composition = renderSource.slice(renderSource.indexOf("void 呈现窗口类::绘制窗口("), renderSource.indexOf("void 呈现窗口类::绘制歌词("));
    assert.match(composition, /BindDC\(memDC, &rect\);[\s\S]*?BeginDraw\(\);[\s\S]*?Clear\(D2D1::ColorF\(0, 0\.0f\)\);[\s\S]*?EndDraw\(\);/);
    assert.ok(composition.indexOf("->Clear(") < composition.indexOf("if (this->淡出定时器ID)"), "每帧先清透明底，再叠加旧、新歌词");
    const layerSource = renderSource.slice(renderSource.indexOf("void 呈现窗口类::绘制歌词("));
    assert.ok(!/->(?:BindDC|BeginDraw|Clear|EndDraw)\(/.test(layerSource), "所有歌词层共用一次绘制，保留交叉淡出的叠加结果");
    assert.equal((composition.match(/->BeginDraw\(/g) ?? []).length, 1);
    assert.equal((composition.match(/->EndDraw\(/g) ?? []).length, 1);
    assert.ok(composition.indexOf("->EndDraw(") > composition.lastIndexOf("this->绘制歌词("));
    assert.ok(composition.indexOf("->EndDraw(") < composition.indexOf("UpdateLayeredWindow("));
    console.log("通过：暂停防抖、三次回执兜底、心跳与启动关闭竞态、词栏监听，以及 C++ 绘制和路由检查。");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
