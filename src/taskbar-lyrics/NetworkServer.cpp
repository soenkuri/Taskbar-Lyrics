#include "NetworkServer.hpp"
#include "CreateWindow.hpp"
#include "nlohmann/json.hpp"
#include <chrono>
#include <d2d1.h>
#include <array>
#include <iomanip>
#include <sstream>


namespace
{
std::wstring 读取字符串(
    const std::wstring& 文件路径,
    const wchar_t* 节,
    const wchar_t* 键,
    const std::wstring& 默认值
) {
    std::array<wchar_t, 1024> 缓冲区 = {};
    GetPrivateProfileStringW(
        节,
        键,
        默认值.c_str(),
        缓冲区.data(),
        static_cast<DWORD>(缓冲区.size()),
        文件路径.c_str()
    );
    return std::wstring(缓冲区.data());
}


int 读取整数(
    const std::wstring& 文件路径,
    const wchar_t* 节,
    const wchar_t* 键,
    int 默认值
) {
    return GetPrivateProfileIntW(节, 键, 默认值, 文件路径.c_str());
}


float 读取浮点数(
    const std::wstring& 文件路径,
    const wchar_t* 节,
    const wchar_t* 键,
    float 默认值
) {
    const auto 文本 = 读取字符串(文件路径, 节, 键, L"");
    if (文本.empty()) return 默认值;

    try
    {
        return std::stof(文本);
    }
    catch (...)
    {
        return 默认值;
    }
}


void 写入字符串(
    const std::wstring& 文件路径,
    const wchar_t* 节,
    const wchar_t* 键,
    const std::wstring& 值
) {
    WritePrivateProfileStringW(节, 键, 值.c_str(), 文件路径.c_str());
}


void 写入整数(
    const std::wstring& 文件路径,
    const wchar_t* 节,
    const wchar_t* 键,
    int 值
) {
    写入字符串(文件路径, 节, 键, std::to_wstring(值));
}


void 写入浮点数(
    const std::wstring& 文件路径,
    const wchar_t* 节,
    const wchar_t* 键,
    float 值
) {
    std::wostringstream 文本;
    文本 << std::setprecision(9) << 值;
    写入字符串(文件路径, 节, 键, 文本.str());
}


void 写入布尔值(
    const std::wstring& 文件路径,
    const wchar_t* 节,
    const wchar_t* 键,
    bool 值
) {
    写入整数(文件路径, 节, 键, 值 ? 1 : 0);
}


unsigned long long 获取Unix毫秒()
{
    FILETIME 文件时间 = {};
    GetSystemTimeAsFileTime(&文件时间);
    ULARGE_INTEGER 数值 = {};
    数值.LowPart = 文件时间.dwLowDateTime;
    数值.HighPart = 文件时间.dwHighDateTime;
    return 数值.QuadPart / 10000ULL - 11644473600000ULL;
}


D2D1::ColorF 读取颜色(
    const std::wstring& 文件路径,
    const wchar_t* 节,
    const D2D1::ColorF& 默认值
) {
    return D2D1::ColorF(
        读取浮点数(文件路径, 节, L"red", 默认值.r),
        读取浮点数(文件路径, 节, L"green", 默认值.g),
        读取浮点数(文件路径, 节, L"blue", 默认值.b),
        读取浮点数(文件路径, 节, L"alpha", 默认值.a)
    );
}


void 写入颜色(
    const std::wstring& 文件路径,
    const wchar_t* 节,
    const D2D1::ColorF& 值
) {
    写入浮点数(文件路径, 节, L"red", 值.r);
    写入浮点数(文件路径, 节, L"green", 值.g);
    写入浮点数(文件路径, 节, L"blue", 值.b);
    写入浮点数(文件路径, 节, L"alpha", 值.a);
}
}


网络服务器类::网络服务器类(
    任务栏窗口类* 任务栏窗口,
    unsigned short 端口,
    bool 替换已有实例,
    const std::wstring& 启动标识
) {
    this->任务栏窗口 = 任务栏窗口;
    this->替换已有实例 = 替换已有实例;
    this->启动时间 = 获取Unix毫秒();
    this->启动标识 = 启动标识;
    this->初始化配置路径();
    this->加载配置();
    this->保存配置();

    auto handler = [this] (auto func) {
        auto bind = std::bind(func,this,std::placeholders::_1,std::placeholders::_2);
        return httplib::Server::Handler(bind);
    };

    auto 线程函数 = [this, handler, 端口] () {
        this->网络服务器.Post("/taskbar/font/font", handler(&网络服务器类::字体));
        this->网络服务器.Post("/taskbar/font/color", handler(&网络服务器类::颜色));
        this->网络服务器.Post("/taskbar/font/style", handler(&网络服务器类::样式));
        this->网络服务器.Post("/taskbar/lyrics/lyrics", handler(&网络服务器类::歌词));
        this->网络服务器.Post("/taskbar/lyrics/align", handler(&网络服务器类::对齐));
        this->网络服务器.Post("/taskbar/window/position", handler(&网络服务器类::位置));
        this->网络服务器.Post("/taskbar/window/margin", handler(&网络服务器类::边距));
        this->网络服务器.Post("/taskbar/window/screen", handler(&网络服务器类::屏幕));
        this->网络服务器.Post("/taskbar/animation", handler(&网络服务器类::过渡动画));
        this->网络服务器.Post("/taskbar/close", handler(&网络服务器类::关闭));
        this->网络服务器.Post("/taskbar/status", handler(&网络服务器类::状态));
        this->网络服务器.listen("127.0.0.1", 端口);
    };

    this->网络服务器_线程 = new std::thread(线程函数);
}


void 网络服务器类::状态(
    const httplib::Request& req,
    httplib::Response& res
) {
    UNREFERENCED_PARAMETER(req);
    nlohmann::json 状态信息 = {
        {"startup_mode", this->替换已有实例 ? "replaced" : "normal"},
        {"replaced_instance", this->替换已有实例},
        {"pid", GetCurrentProcessId()},
        {"started_at", this->启动时间},
        {"startup_token", this->字符转换.to_bytes(this->启动标识)}
    };
    res.set_content(状态信息.dump(), "application/json; charset=UTF-8");
    res.status = 200;
}


网络服务器类::~网络服务器类()
{
    this->网络服务器.stop();

    this->网络服务器_线程->detach();
    delete this->网络服务器_线程;
    this->网络服务器_线程 = nullptr;

    this->任务栏窗口 = nullptr;
}


void 网络服务器类::字体(
    const httplib::Request& req,
    httplib::Response& res
) {
    auto json = nlohmann::json::parse(req.body);
    std::lock_guard<std::mutex> 锁(this->配置互斥);

    std::wstring 新字体名称 = this->字符转换.from_bytes(
        json["font_family"].get<std::string>()
    );

    if (this->任务栏窗口->呈现窗口->字体名称 != 新字体名称)
    {
        this->任务栏窗口->呈现窗口->字体名称 = 新字体名称;
        PostMessage(this->任务栏窗口->窗口句柄, WM_PAINT, NULL, NULL);
    }

    this->保存配置();
    this->加载配置();

    res.status = 200;
}


void 网络服务器类::颜色(
    const httplib::Request& req,
    httplib::Response& res
) {
    auto json = nlohmann::json::parse(req.body);
    std::lock_guard<std::mutex> 锁(this->配置互斥);

    D2D1::ColorF 新_浅色_主 = D2D1::ColorF(
        json["basic"]["light"]["hex_color"].get<unsigned int>(),
        json["basic"]["light"]["opacity"].get<float>()
    );
    D2D1::ColorF 新_深色_主 = D2D1::ColorF(
        json["basic"]["dark"]["hex_color"].get<unsigned int>(),
        json["basic"]["dark"]["opacity"].get<float>()
    );
    D2D1::ColorF 新_浅色_副 = D2D1::ColorF(
        json["extra"]["light"]["hex_color"].get<unsigned int>(),
        json["extra"]["light"]["opacity"].get<float>()
    );
    D2D1::ColorF 新_深色_副 = D2D1::ColorF(
        json["extra"]["dark"]["hex_color"].get<unsigned int>(),
        json["extra"]["dark"]["opacity"].get<float>()
    );

    auto& 窗口 = this->任务栏窗口->呈现窗口;
    if (窗口->字体颜色_浅色_主歌词.r != 新_浅色_主.r || 窗口->字体颜色_浅色_主歌词.g != 新_浅色_主.g ||
        窗口->字体颜色_浅色_主歌词.b != 新_浅色_主.b || 窗口->字体颜色_浅色_主歌词.a != 新_浅色_主.a ||
        窗口->字体颜色_深色_主歌词.r != 新_深色_主.r || 窗口->字体颜色_深色_主歌词.g != 新_深色_主.g ||
        窗口->字体颜色_深色_主歌词.b != 新_深色_主.b || 窗口->字体颜色_深色_主歌词.a != 新_深色_主.a ||
        窗口->字体颜色_浅色_副歌词.r != 新_浅色_副.r || 窗口->字体颜色_浅色_副歌词.g != 新_浅色_副.g ||
        窗口->字体颜色_浅色_副歌词.b != 新_浅色_副.b || 窗口->字体颜色_浅色_副歌词.a != 新_浅色_副.a ||
        窗口->字体颜色_深色_副歌词.r != 新_深色_副.r || 窗口->字体颜色_深色_副歌词.g != 新_深色_副.g ||
        窗口->字体颜色_深色_副歌词.b != 新_深色_副.b || 窗口->字体颜色_深色_副歌词.a != 新_深色_副.a)
    {
        窗口->字体颜色_浅色_主歌词 = 新_浅色_主;
        窗口->字体颜色_深色_主歌词 = 新_深色_主;
        窗口->字体颜色_浅色_副歌词 = 新_浅色_副;
        窗口->字体颜色_深色_副歌词 = 新_深色_副;
        PostMessage(this->任务栏窗口->窗口句柄, WM_PAINT, NULL, NULL);
    }

    this->保存配置();
    this->加载配置();

    res.status = 200;
}


void 网络服务器类::样式(
    const httplib::Request& req,
    httplib::Response& res
) {
    auto json = nlohmann::json::parse(req.body);
    std::lock_guard<std::mutex> 锁(this->配置互斥);

    auto& 窗口 = this->任务栏窗口->呈现窗口;
    DWRITE_FONT_WEIGHT 新_主_字重 = json["basic"]["weight"]["value"].get<DWRITE_FONT_WEIGHT>();
    DWRITE_FONT_STYLE 新_主_斜体 = json["basic"]["slope"].get<DWRITE_FONT_STYLE>();
    bool 新_主_下划线 = json["basic"]["underline"].get<bool>();
    bool 新_主_删除线 = json["basic"]["strikethrough"].get<bool>();
    DWRITE_FONT_WEIGHT 新_副_字重 = json["extra"]["weight"]["value"].get<DWRITE_FONT_WEIGHT>();
    DWRITE_FONT_STYLE 新_副_斜体 = json["extra"]["slope"].get<DWRITE_FONT_STYLE>();
    bool 新_副_下划线 = json["extra"]["underline"].get<bool>();
    bool 新_副_删除线 = json["extra"]["strikethrough"].get<bool>();

    if (窗口->字体样式_主歌词_字重 != 新_主_字重 || 窗口->字体样式_主歌词_斜体 != 新_主_斜体 ||
        窗口->字体样式_主歌词_下划线 != 新_主_下划线 || 窗口->字体样式_主歌词_删除线 != 新_主_删除线 ||
        窗口->字体样式_副歌词_字重 != 新_副_字重 || 窗口->字体样式_副歌词_斜体 != 新_副_斜体 ||
        窗口->字体样式_副歌词_下划线 != 新_副_下划线 || 窗口->字体样式_副歌词_删除线 != 新_副_删除线)
    {
        窗口->字体样式_主歌词_字重 = 新_主_字重;
        窗口->字体样式_主歌词_斜体 = 新_主_斜体;
        窗口->字体样式_主歌词_下划线 = 新_主_下划线;
        窗口->字体样式_主歌词_删除线 = 新_主_删除线;
        窗口->字体样式_副歌词_字重 = 新_副_字重;
        窗口->字体样式_副歌词_斜体 = 新_副_斜体;
        窗口->字体样式_副歌词_下划线 = 新_副_下划线;
        窗口->字体样式_副歌词_删除线 = 新_副_删除线;
        PostMessage(this->任务栏窗口->窗口句柄, WM_PAINT, NULL, NULL);
    }

    this->保存配置();
    this->加载配置();

    res.status = 200;
}


void 网络服务器类::歌词(
    const httplib::Request& req,
    httplib::Response& res
) {
    auto json = nlohmann::json::parse(req.body);
    std::unique_lock<std::mutex> 锁(this->配置互斥);

    auto& 窗口 = this->任务栏窗口->呈现窗口;
    const bool 是歌曲信息 = json.value("is_song_info", false);
    const auto 新主歌词 = this->字符转换.from_bytes(
        json["basic"].get<std::string>()
    );
    const auto 新副歌词 = this->字符转换.from_bytes(
        json["extra"].get<std::string>()
    );
    const bool 是真实歌词 = json.value("is_real_lyric", false) && !新主歌词.empty();

    // 歌曲信息显示期间，只接受下一句真实歌词或下一首歌曲信息
    if (窗口->正在显示歌曲信息 && !是歌曲信息 && !是真实歌词)
    {
        res.status = 204;
        return;
    }

    // 先保存旧歌词（用于交叉淡入淡出）
    窗口->旧主歌词 = 窗口->主歌词;
    窗口->旧副歌词 = 窗口->副歌词;
    窗口->旧正在显示歌曲信息 = 窗口->正在显示歌曲信息;

    // 再更新为新歌词
    窗口->主歌词 = 新主歌词;
    窗口->副歌词 = 新副歌词;
    窗口->正在显示歌曲信息 = 是歌曲信息;

    // 等待渲染线程真正绘制到目标歌词后再返回回执。仅启动动画并不代表
    // 任务栏已经显示新歌词，尤其是非交叉淡入淡出的淡出/间隔阶段。
    SendMessage(this->任务栏窗口->窗口句柄, WM_FADE_START, NULL, NULL);
    锁.unlock();

    std::wstring 显示主歌词;
    std::wstring 显示副歌词;
    bool 显示歌曲信息 = false;
    if (!窗口->等待当前显示(
        新主歌词,
        新副歌词,
        是歌曲信息,
        std::chrono::milliseconds(3500),
        显示主歌词,
        显示副歌词,
        显示歌曲信息
    ))
    {
        res.status = 504;
        return;
    }

    nlohmann::json 回执 = {
        {"basic", this->字符转换.to_bytes(显示主歌词)},
        {"extra", this->字符转换.to_bytes(显示副歌词)},
        {"is_song_info", 显示歌曲信息}
    };
    res.set_content(回执.dump(), "application/json; charset=UTF-8");
    res.status = 200;
}


void 网络服务器类::对齐(
    const httplib::Request& req,
    httplib::Response& res
) {
    auto json = nlohmann::json::parse(req.body);
    std::lock_guard<std::mutex> 锁(this->配置互斥);

    auto& 窗口 = this->任务栏窗口->呈现窗口;
    DWRITE_TEXT_ALIGNMENT 新_主 = json["basic"].get<DWRITE_TEXT_ALIGNMENT>();
    DWRITE_TEXT_ALIGNMENT 新_副 = json["extra"].get<DWRITE_TEXT_ALIGNMENT>();

    if (窗口->对齐方式_主歌词 != 新_主 || 窗口->对齐方式_副歌词 != 新_副)
    {
        窗口->对齐方式_主歌词 = 新_主;
        窗口->对齐方式_副歌词 = 新_副;
        PostMessage(this->任务栏窗口->窗口句柄, WM_PAINT, NULL, NULL);
    }

    this->保存配置();
    this->加载配置();

    res.status = 200;
}


void 网络服务器类::位置(
    const httplib::Request& req,
    httplib::Response& res
) {
    auto json = nlohmann::json::parse(req.body);
    std::lock_guard<std::mutex> 锁(this->配置互斥);

    WindowAlignment 新位置 = json["position"]["value"].get<WindowAlignment>();

    if (this->任务栏窗口->呈现窗口->窗口位置 != 新位置)
    {
        this->任务栏窗口->呈现窗口->窗口位置 = 新位置;
        PostMessage(this->任务栏窗口->窗口句柄, WM_PAINT, NULL, NULL);
    }

    this->保存配置();
    this->加载配置();

    res.status = 200;
}


void 网络服务器类::边距(
    const httplib::Request& req,
    httplib::Response& res
) {
    auto json = nlohmann::json::parse(req.body);
    std::lock_guard<std::mutex> 锁(this->配置互斥);

    int 新左 = json["left"].get<int>();
    int 新右 = json["right"].get<int>();
    int 新单行底部 = json.value("single_bottom", 0);
    int 新双行底部 = json.value("double_bottom", 0);

    auto& 窗口 = this->任务栏窗口->呈现窗口;
    if (窗口->左边距 != 新左 || 窗口->右边距 != 新右 ||
        窗口->单行底部边距 != 新单行底部 || 窗口->双行底部边距 != 新双行底部)
    {
        窗口->左边距 = 新左;
        窗口->右边距 = 新右;
        窗口->单行底部边距 = 新单行底部;
        窗口->双行底部边距 = 新双行底部;
        PostMessage(this->任务栏窗口->窗口句柄, WM_PAINT, NULL, NULL);
    }

    this->保存配置();
    this->加载配置();

    res.status = 200;
}


void 网络服务器类::屏幕(
    const httplib::Request& req,
    httplib::Response& res
) {
    auto json = nlohmann::json::parse(req.body);
    std::lock_guard<std::mutex> 锁(this->配置互斥);
    auto parent_taskbar = json["parent_taskbar"]["value"].get<std::string>();

    this->应用屏幕(this->字符转换.from_bytes(parent_taskbar));
    this->保存配置();
    this->加载配置();
    res.status = 200;
}


void 网络服务器类::过渡动画(
    const httplib::Request& req,
    httplib::Response& res
) {
    auto json = nlohmann::json::parse(req.body);
    std::lock_guard<std::mutex> 锁(this->配置互斥);

    auto& 窗口 = this->任务栏窗口->呈现窗口;
    窗口->淡入时长 = json["fade_in"]["duration"].get<int>();
    窗口->淡出时长 = json["fade_out"]["duration"].get<int>();
    窗口->帧率 = json["frame_rate"].get<int>();
    窗口->重叠时间 = json["overlap"].get<int>();
    窗口->交叉淡入淡出 = json.value("crossfade", 窗口->交叉淡入淡出);
    窗口->淡入间隔 = json.value("gap", 窗口->淡入间隔);
    窗口->动画曲线 = json["curve"].get<int>();

    this->保存配置();
    this->加载配置();

    res.status = 200;
}


void 网络服务器类::关闭(
    const httplib::Request& req,
    httplib::Response& res
) {
    this->任务栏窗口->呈现窗口->主歌词 = L"检测到网易云音乐重载页面";
    this->任务栏窗口->呈现窗口->副歌词 = L"正在尝试关闭任务栏歌词...";

    PostMessage(this->任务栏窗口->窗口句柄, WM_PAINT, NULL, NULL);
    PostMessage(this->任务栏窗口->窗口句柄, WM_CLOSE, NULL, NULL);
    res.status = 200;
}


void 网络服务器类::初始化配置路径()
{
    wchar_t 模块路径[MAX_PATH] = {};
    const DWORD 路径长度 = GetModuleFileNameW(
        nullptr,
        模块路径,
        static_cast<DWORD>(_countof(模块路径))
    );

    if (路径长度 == 0)
    {
        this->配置文件路径 = L"taskbar-lyrics.ini";
        return;
    }

    this->配置文件路径.assign(模块路径, 路径长度);
    const auto 分隔符 = this->配置文件路径.find_last_of(L"\\/");
    if (分隔符 == std::wstring::npos)
    {
        this->配置文件路径 = L"taskbar-lyrics.ini";
    }
    else
    {
        this->配置文件路径.erase(分隔符 + 1);
        this->配置文件路径 += L"taskbar-lyrics.ini";
    }
}


void 网络服务器类::保存配置()
{
    if (this->任务栏窗口 == nullptr || this->任务栏窗口->呈现窗口 == nullptr)
    {
        return;
    }

    const auto& 窗口 = this->任务栏窗口->呈现窗口;

    写入字符串(this->配置文件路径, L"Font", L"family", 窗口->字体名称);

    写入颜色(this->配置文件路径, L"Color.Basic.Light", 窗口->字体颜色_浅色_主歌词);
    写入颜色(this->配置文件路径, L"Color.Basic.Dark", 窗口->字体颜色_深色_主歌词);
    写入颜色(this->配置文件路径, L"Color.Extra.Light", 窗口->字体颜色_浅色_副歌词);
    写入颜色(this->配置文件路径, L"Color.Extra.Dark", 窗口->字体颜色_深色_副歌词);

    写入整数(this->配置文件路径, L"Style.Basic", L"weight", static_cast<int>(窗口->字体样式_主歌词_字重));
    写入整数(this->配置文件路径, L"Style.Basic", L"slope", static_cast<int>(窗口->字体样式_主歌词_斜体));
    写入布尔值(this->配置文件路径, L"Style.Basic", L"underline", 窗口->字体样式_主歌词_下划线);
    写入布尔值(this->配置文件路径, L"Style.Basic", L"strikethrough", 窗口->字体样式_主歌词_删除线);
    写入整数(this->配置文件路径, L"Style.Extra", L"weight", static_cast<int>(窗口->字体样式_副歌词_字重));
    写入整数(this->配置文件路径, L"Style.Extra", L"slope", static_cast<int>(窗口->字体样式_副歌词_斜体));
    写入布尔值(this->配置文件路径, L"Style.Extra", L"underline", 窗口->字体样式_副歌词_下划线);
    写入布尔值(this->配置文件路径, L"Style.Extra", L"strikethrough", 窗口->字体样式_副歌词_删除线);

    写入整数(this->配置文件路径, L"Lyrics", L"basic_alignment", static_cast<int>(窗口->对齐方式_主歌词));
    写入整数(this->配置文件路径, L"Lyrics", L"extra_alignment", static_cast<int>(窗口->对齐方式_副歌词));

    写入整数(this->配置文件路径, L"Window", L"position", static_cast<int>(窗口->窗口位置));
    写入整数(this->配置文件路径, L"Window", L"left_margin", 窗口->左边距);
    写入整数(this->配置文件路径, L"Window", L"right_margin", 窗口->右边距);
    写入整数(this->配置文件路径, L"Window", L"single_bottom_margin", 窗口->单行底部边距);
    写入整数(this->配置文件路径, L"Window", L"double_bottom_margin", 窗口->双行底部边距);
    写入字符串(this->配置文件路径, L"Window", L"parent_taskbar", 窗口->任务栏窗口类名);

    写入整数(this->配置文件路径, L"Animation", L"fade_in_duration", 窗口->淡入时长);
    写入整数(this->配置文件路径, L"Animation", L"fade_out_duration", 窗口->淡出时长);
    写入整数(this->配置文件路径, L"Animation", L"frame_rate", 窗口->帧率);
    写入整数(this->配置文件路径, L"Animation", L"overlap", 窗口->重叠时间);
    写入布尔值(this->配置文件路径, L"Animation", L"crossfade", 窗口->交叉淡入淡出);
    写入整数(this->配置文件路径, L"Animation", L"gap", 窗口->淡入间隔);
    写入整数(this->配置文件路径, L"Animation", L"curve", 窗口->动画曲线);

    // 强制刷新 profile 缓存，确保后续重载读取到刚刚写入的值。
    WritePrivateProfileStringW(nullptr, nullptr, nullptr, this->配置文件路径.c_str());
}


void 网络服务器类::加载配置()
{
    if (this->任务栏窗口 == nullptr || this->任务栏窗口->呈现窗口 == nullptr)
    {
        return;
    }

    auto& 窗口 = this->任务栏窗口->呈现窗口;

    窗口->字体名称 = 读取字符串(
        this->配置文件路径,
        L"Font",
        L"family",
        窗口->字体名称
    );
    if (窗口->字体名称.empty())
    {
        窗口->字体名称 = L"Microsoft YaHei UI";
    }

    窗口->字体颜色_浅色_主歌词 = 读取颜色(
        this->配置文件路径,
        L"Color.Basic.Light",
        窗口->字体颜色_浅色_主歌词
    );
    窗口->字体颜色_深色_主歌词 = 读取颜色(
        this->配置文件路径,
        L"Color.Basic.Dark",
        窗口->字体颜色_深色_主歌词
    );
    窗口->字体颜色_浅色_副歌词 = 读取颜色(
        this->配置文件路径,
        L"Color.Extra.Light",
        窗口->字体颜色_浅色_副歌词
    );
    窗口->字体颜色_深色_副歌词 = 读取颜色(
        this->配置文件路径,
        L"Color.Extra.Dark",
        窗口->字体颜色_深色_副歌词
    );

    窗口->字体样式_主歌词_字重 = static_cast<DWRITE_FONT_WEIGHT>(读取整数(
        this->配置文件路径,
        L"Style.Basic",
        L"weight",
        static_cast<int>(窗口->字体样式_主歌词_字重)
    ));
    窗口->字体样式_主歌词_斜体 = static_cast<DWRITE_FONT_STYLE>(读取整数(
        this->配置文件路径,
        L"Style.Basic",
        L"slope",
        static_cast<int>(窗口->字体样式_主歌词_斜体)
    ));
    窗口->字体样式_主歌词_下划线 = 读取整数(
        this->配置文件路径,
        L"Style.Basic",
        L"underline",
        窗口->字体样式_主歌词_下划线 ? 1 : 0
    ) != 0;
    窗口->字体样式_主歌词_删除线 = 读取整数(
        this->配置文件路径,
        L"Style.Basic",
        L"strikethrough",
        窗口->字体样式_主歌词_删除线 ? 1 : 0
    ) != 0;
    窗口->字体样式_副歌词_字重 = static_cast<DWRITE_FONT_WEIGHT>(读取整数(
        this->配置文件路径,
        L"Style.Extra",
        L"weight",
        static_cast<int>(窗口->字体样式_副歌词_字重)
    ));
    窗口->字体样式_副歌词_斜体 = static_cast<DWRITE_FONT_STYLE>(读取整数(
        this->配置文件路径,
        L"Style.Extra",
        L"slope",
        static_cast<int>(窗口->字体样式_副歌词_斜体)
    ));
    窗口->字体样式_副歌词_下划线 = 读取整数(
        this->配置文件路径,
        L"Style.Extra",
        L"underline",
        窗口->字体样式_副歌词_下划线 ? 1 : 0
    ) != 0;
    窗口->字体样式_副歌词_删除线 = 读取整数(
        this->配置文件路径,
        L"Style.Extra",
        L"strikethrough",
        窗口->字体样式_副歌词_删除线 ? 1 : 0
    ) != 0;

    窗口->对齐方式_主歌词 = static_cast<DWRITE_TEXT_ALIGNMENT>(读取整数(
        this->配置文件路径,
        L"Lyrics",
        L"basic_alignment",
        static_cast<int>(窗口->对齐方式_主歌词)
    ));
    窗口->对齐方式_副歌词 = static_cast<DWRITE_TEXT_ALIGNMENT>(读取整数(
        this->配置文件路径,
        L"Lyrics",
        L"extra_alignment",
        static_cast<int>(窗口->对齐方式_副歌词)
    ));

    窗口->窗口位置 = static_cast<WindowAlignment>(读取整数(
        this->配置文件路径,
        L"Window",
        L"position",
        static_cast<int>(窗口->窗口位置)
    ));
    窗口->左边距 = 读取整数(this->配置文件路径, L"Window", L"left_margin", 窗口->左边距);
    窗口->右边距 = 读取整数(this->配置文件路径, L"Window", L"right_margin", 窗口->右边距);
    窗口->单行底部边距 = 读取整数(
        this->配置文件路径,
        L"Window",
        L"single_bottom_margin",
        窗口->单行底部边距
    );
    窗口->双行底部边距 = 读取整数(
        this->配置文件路径,
        L"Window",
        L"double_bottom_margin",
        窗口->双行底部边距
    );

    auto 任务栏类名 = 读取字符串(
        this->配置文件路径,
        L"Window",
        L"parent_taskbar",
        窗口->任务栏窗口类名
    );
    if (任务栏类名.empty())
    {
        任务栏类名 = L"Shell_TrayWnd";
    }
    窗口->任务栏窗口类名 = 任务栏类名;

    窗口->淡入时长 = 读取整数(this->配置文件路径, L"Animation", L"fade_in_duration", 窗口->淡入时长);
    窗口->淡出时长 = 读取整数(this->配置文件路径, L"Animation", L"fade_out_duration", 窗口->淡出时长);
    窗口->帧率 = 读取整数(this->配置文件路径, L"Animation", L"frame_rate", 窗口->帧率);
    窗口->重叠时间 = 读取整数(this->配置文件路径, L"Animation", L"overlap", 窗口->重叠时间);
    窗口->交叉淡入淡出 = 读取整数(
        this->配置文件路径,
        L"Animation",
        L"crossfade",
        窗口->交叉淡入淡出 ? 1 : 0
    ) != 0;
    窗口->淡入间隔 = 读取整数(this->配置文件路径, L"Animation", L"gap", 窗口->淡入间隔);
    窗口->动画曲线 = 读取整数(this->配置文件路径, L"Animation", L"curve", 窗口->动画曲线);

    this->应用屏幕(任务栏类名);
    PostMessage(this->任务栏窗口->窗口句柄, WM_PAINT, NULL, NULL);
}


void 网络服务器类::应用屏幕(const std::wstring& 任务栏类名)
{
    if (this->任务栏窗口 == nullptr || this->任务栏窗口->呈现窗口 == nullptr || 任务栏类名.empty())
    {
        return;
    }

    auto& 窗口 = this->任务栏窗口->呈现窗口;
    窗口->任务栏窗口类名 = 任务栏类名;
    HWND 任务栏句柄 = FindWindow(任务栏类名.c_str(), NULL);
    if (任务栏句柄 == nullptr)
    {
        return;
    }

    窗口->任务栏_句柄 = 任务栏句柄;
    窗口->通知区域_句柄 = FindWindowEx(任务栏句柄, NULL, L"TrayNotifyWnd", NULL);
    窗口->开始按钮_句柄 = FindWindowEx(任务栏句柄, NULL, L"Start", NULL);
    HWND 最小化区域句柄 = FindWindowEx(任务栏句柄, NULL, L"ReBarWindow32", NULL);
    窗口->活动区域_句柄 = FindWindowEx(最小化区域句柄, NULL, L"MSTaskSwWClass", NULL);

    if (窗口->任务栏_句柄 != nullptr)
    {
        GetWindowRect(窗口->任务栏_句柄, &窗口->任务栏_矩形);
    }
    if (窗口->通知区域_句柄 != nullptr)
    {
        GetWindowRect(窗口->通知区域_句柄, &窗口->通知区域_矩形);
    }
    if (窗口->开始按钮_句柄 != nullptr)
    {
        GetWindowRect(窗口->开始按钮_句柄, &窗口->开始按钮_矩形);
    }
    if (窗口->活动区域_句柄 != nullptr)
    {
        GetWindowRect(窗口->活动区域_句柄, &窗口->活动区域_矩形);
    }

    SetParent(this->任务栏窗口->窗口句柄, 任务栏句柄);
    PostMessage(this->任务栏窗口->窗口句柄, WM_PAINT, NULL, NULL);
}
