#include "RenderWindow.hpp"
#include <utility>
#include <algorithm>

#pragma comment (lib, "d2d1.lib")
#pragma comment (lib, "dwrite.lib")


呈现窗口类::呈现窗口类(
    HWND* 窗口句柄
) {
    this->窗口句柄 = 窗口句柄;

    this->任务栏_句柄 = FindWindow(L"Shell_TrayWnd", NULL);
    this->通知区域_句柄 = FindWindowEx(this->任务栏_句柄, NULL, L"TrayNotifyWnd", NULL);
    this->开始按钮_句柄 = FindWindowEx(this->任务栏_句柄, NULL, L"Start", NULL);
    HWND 最小化区域_句柄 = FindWindowEx(this->任务栏_句柄, NULL, L"ReBarWindow32", NULL);
    this->活动区域_句柄 = FindWindowEx(最小化区域_句柄, NULL, L"MSTaskSwWClass", NULL);

    // 创建D2D工厂
    D2D1CreateFactory(
        D2D1_FACTORY_TYPE_SINGLE_THREADED,
        &this->D2D工厂
    );

    D2D1_RENDER_TARGET_PROPERTIES renderTargetProperties = D2D1::RenderTargetProperties();
    renderTargetProperties.pixelFormat.format = DXGI_FORMAT_B8G8R8A8_UNORM;
    renderTargetProperties.pixelFormat.alphaMode = D2D1_ALPHA_MODE_PREMULTIPLIED;

    // 创建DC渲染目标
    this->D2D工厂->CreateDCRenderTarget(
        &renderTargetProperties,
        &this->D2D呈现目标
    );

    // 主歌词笔刷
    this->D2D呈现目标->CreateSolidColorBrush(
        D2D1::ColorF(0x000000, 1),
        &this->D2D纯色笔刷
    );

    // 创建DWrite工厂
    DWriteCreateFactory(
        DWRITE_FACTORY_TYPE_SHARED,
        __uuidof(IDWriteFactory),
        reinterpret_cast<IUnknown**>(&this->DWrite工厂)
    );
}


呈现窗口类::~呈现窗口类()
{
    if (this->淡入定时器ID)
    {
        KillTimer(*this->窗口句柄, this->淡入定时器ID);
        this->淡入定时器ID = 0;
    }
    if (this->淡出定时器ID)
    {
        KillTimer(*this->窗口句柄, this->淡出定时器ID);
        this->淡出定时器ID = 0;
    }
    if (this->淡入延迟定时器ID)
    {
        KillTimer(*this->窗口句柄, this->淡入延迟定时器ID);
        this->淡入延迟定时器ID = 0;
    }

    this->D2D工厂->Release();
    this->D2D工厂 = nullptr;

    this->D2D呈现目标->Release();
    this->D2D呈现目标 = nullptr;

    this->D2D纯色笔刷->Release();
    this->D2D纯色笔刷 = nullptr;

    this->DWrite工厂->Release();
    this->DWrite工厂 = nullptr;

    this->窗口句柄 = nullptr;
}


bool 呈现窗口类::等待当前显示(
    const std::wstring& 目标主歌词,
    const std::wstring& 目标副歌词,
    bool 目标歌曲信息,
    std::chrono::milliseconds 超时,
    std::wstring& 显示主歌词,
    std::wstring& 显示副歌词,
    bool& 显示歌曲信息
) {
    std::unique_lock<std::mutex> 锁(this->显示状态互斥);
    const bool 已显示 = this->显示状态条件.wait_for(锁, 超时, [&] {
        return this->当前显示主歌词 == 目标主歌词
            && this->当前显示副歌词 == 目标副歌词
            && this->当前显示歌曲信息 == 目标歌曲信息;
    });
    if (已显示)
    {
        显示主歌词 = this->当前显示主歌词;
        显示副歌词 = this->当前显示副歌词;
        显示歌曲信息 = this->当前显示歌曲信息;
    }
    return 已显示;
}


void 呈现窗口类::更新窗口()
{
    GetWindowRect(this->任务栏_句柄, &this->任务栏_矩形);
    GetWindowRect(this->通知区域_句柄, &this->通知区域_矩形);
    GetWindowRect(this->开始按钮_句柄, &this->开始按钮_矩形);
    GetWindowRect(this->活动区域_句柄, &this->活动区域_矩形);

    long 左 = 0;
    long 上 = 0;
    long 宽 = 0;
    long 高 = this->任务栏_矩形.bottom - this->任务栏_矩形.top;

    // 通过缩短窗口高度预留底部边距，单行和双行歌词分别使用独立配置。
    const int 底部边距 = this->副歌词.empty() ? this->单行底部边距 : this->双行底部边距;
    高 -= 底部边距;
    if (高 < 1)
    {
        高 = 1;
    }

    switch (this->窗口位置)
    {
        case WindowAlignment::WindowAlignmentAdaptive:
        {
            if (this->居中对齐)
            {
                左 = static_cast<long>(this->组件按钮 ? this->DPI(160) : 0) + this->左边距;
                宽 = this->开始按钮_矩形.left - static_cast<long>(this->组件按钮 ? this->DPI(160) : 0) - this->左边距 - this->右边距;
            }
            else
            {
                左 = this->活动区域_矩形.right + this->左边距;
                宽 = this->通知区域_矩形.left - this->活动区域_矩形.right - this->左边距 - this->右边距;
            }
        }
        break;

        case WindowAlignment::WindowAlignmentLeft:
        {
            if (this->居中对齐)
            {
                左 = static_cast<long>(this->组件按钮 ? this->DPI(160) : 0) + this->左边距;
                宽 = this->开始按钮_矩形.left - static_cast<long>(this->组件按钮 ? this->DPI(160) : 0) - this->左边距 - this->右边距;
            }
            else
            {
                左 = 0 + this->左边距;
                宽 = this->通知区域_矩形.left - 0 - this->左边距 - this->右边距;
            }
        }
        break;

        case WindowAlignment::WindowAlignmentCenter:
        {
            int center = (this->任务栏_矩形.right - this->任务栏_矩形.left) / 2;
            int lw = this->活动区域_矩形.right - this->开始按钮_矩形.left;
            int rw = this->通知区域_矩形.right - this->通知区域_矩形.left;

            if (lw > rw)
            {
                左 = lw + this->左边距;
                宽 = (center - lw) * 2 - this->左边距 - this->右边距;
            }
            else
            {
                左 = center - (center - rw) + this->左边距;
                宽 = (center - rw) * 2 - this->左边距 - this->右边距;
            }
        }
        break;

        case WindowAlignment::WindowAlignmentRight:
        {
            左 = this->活动区域_矩形.right + this->左边距;
            宽 = this->通知区域_矩形.left - this->活动区域_矩形.right - this->左边距 - this->右边距;
        }
        break;
    }

    MoveWindow(*this->窗口句柄, 左, 上, 宽, 高, false);
    this->绘制窗口(左, 上, 宽, 高);
}


void 呈现窗口类::绘制窗口(
    long 左,
    long 上,
    long 宽,
    long 高
) {
    RECT rect = {};
    GetClientRect(*this->窗口句柄, &rect);

    HDC hdc = GetDC(*this->窗口句柄);
    HDC memDC = CreateCompatibleDC(hdc);
    HBITMAP memBitmap = CreateCompatibleBitmap(hdc, 宽, 高);
    HBITMAP oldBitmap = HBITMAP(SelectObject(memDC, memBitmap));

    if (this->淡出定时器ID)
    {
        // 绘制旧歌词淡出
        std::wstring 临时主 = this->主歌词;
        std::wstring 临时副 = this->副歌词;

        this->主歌词 = this->旧主歌词;
        this->副歌词 = this->旧副歌词;
        std::swap(this->淡入不透明度, this->淡出不透明度);
        this->绘制歌词(memDC, rect);
        std::swap(this->淡入不透明度, this->淡出不透明度);

        this->主歌词 = 临时主;
        this->副歌词 = 临时副;
    }

    // 非交叉模式先等待旧歌词淡出完成，再绘制新歌词
    if (this->交叉淡入淡出 || !this->淡出定时器ID)
    {
        this->绘制歌词(memDC, rect);
    }

    BLENDFUNCTION blend = {
        AC_SRC_OVER,
        0,
        255,
        AC_SRC_ALPHA
    };

    POINT 目标位置 = { 左, 上 };
    SIZE 大小 = { 宽, 高 };
    POINT 来源位置 = { 0, 0 };

    UpdateLayeredWindow(*this->窗口句柄, hdc, &目标位置, &大小, memDC, &来源位置, 0, &blend, ULW_ALPHA);

    // 只有当前歌词真正参与了本次可见绘制，才向等待回执的请求报告已显示。
    // 非交叉模式的淡出阶段只绘制旧歌词，因此继续报告旧内容，避免 HTTP
    // 回执先于任务栏上的实际内容更新。
    const bool 当前歌词已绘制 = this->交叉淡入淡出 || !this->淡出定时器ID;
    const bool 当前歌词可见 = 当前歌词已绘制
        && (this->淡入不透明度 > 0.0f
            || ((this->主歌词.empty() && this->副歌词.empty()) && !this->淡出定时器ID));
    std::wstring 已显示主歌词;
    std::wstring 已显示副歌词;
    bool 已显示歌曲信息 = false;
    if (当前歌词可见)
    {
        已显示主歌词 = this->主歌词;
        已显示副歌词 = this->副歌词;
        已显示歌曲信息 = this->正在显示歌曲信息;
    }
    else if (this->淡出定时器ID)
    {
        已显示主歌词 = this->旧主歌词;
        已显示副歌词 = this->旧副歌词;
        已显示歌曲信息 = this->旧正在显示歌曲信息;
    }
    {
        std::lock_guard<std::mutex> 锁(this->显示状态互斥);
        this->当前显示主歌词 = 已显示主歌词;
        this->当前显示副歌词 = 已显示副歌词;
        this->当前显示歌曲信息 = 已显示歌曲信息;
    }
    this->显示状态条件.notify_all();

    SelectObject(memDC, oldBitmap);
    DeleteObject(memBitmap);
    DeleteDC(memDC);
    ReleaseDC(*this->窗口句柄, hdc);
}


void 呈现窗口类::绘制歌词(
    HDC& hdc,
    RECT& rect
) {
    this->D2D呈现目标->BindDC(hdc, &rect);
    this->D2D呈现目标->BeginDraw();

    DWRITE_TRIMMING 歌词裁剪 = {
        DWRITE_TRIMMING_GRANULARITY_CHARACTER,
        0,
        0
    };

    if (this->副歌词.empty())
    {
        D2D1_RECT_F 主歌词_矩形 = D2D1::RectF(
            max(0, rect.left + this->DPI(10)),
            max(0, rect.top + this->DPI(10)),
            max(0, rect.right - this->DPI(10)),
            max(0, rect.bottom - this->DPI(10))
        );

        主歌词_矩形.right = max(主歌词_矩形.right, 主歌词_矩形.left);
        主歌词_矩形.bottom = max(主歌词_矩形.bottom, 主歌词_矩形.top);

        // 创建文字格式
        this->DWrite工厂->CreateTextFormat(
            this->字体名称.c_str(),
            nullptr,
            this->字体样式_主歌词_字重,
            this->字体样式_主歌词_斜体,
            DWRITE_FONT_STRETCH_NORMAL,
            this->DPI(20),
            L"zh-CN",
            &this->DWrite主歌词文本格式
        );

        // 创建文字布局
        this->DWrite工厂->CreateTextLayout(
            this->主歌词.c_str(),
            this->主歌词.size(),
            this->DWrite主歌词文本格式,
            (float) (主歌词_矩形.right - 主歌词_矩形.left),
            (float) (主歌词_矩形.bottom - 主歌词_矩形.top),
            &this->DWrite主歌词文本布局
        );

        this->DWrite主歌词文本布局->SetTrimming(&歌词裁剪, nullptr);
        this->DWrite主歌词文本布局->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP);
        this->DWrite主歌词文本布局->SetTextAlignment(this->对齐方式_主歌词);
        this->DWrite主歌词文本布局->SetUnderline(this->字体样式_主歌词_下划线, DWRITE_TEXT_RANGE{0, this->主歌词.size()});
        this->DWrite主歌词文本布局->SetStrikethrough(this->字体样式_主歌词_删除线, DWRITE_TEXT_RANGE{0, this->主歌词.size()});
        D2D1::ColorF 主颜色 = this->深浅模式 ? this->字体颜色_浅色_主歌词 : this->字体颜色_深色_主歌词;
        主颜色.a *= this->淡入不透明度;
        this->D2D纯色笔刷->SetColor(主颜色);

        //绘制文字显示
        this->D2D呈现目标->DrawTextLayout(
            D2D1::Point2F(主歌词_矩形.left, 主歌词_矩形.top),
            this->DWrite主歌词文本布局,
            this->D2D纯色笔刷,
            D2D1_DRAW_TEXT_OPTIONS_NO_SNAP
        );

        this->DWrite主歌词文本格式->Release();
        this->DWrite主歌词文本格式 = nullptr;
        this->DWrite主歌词文本布局->Release();
        this->DWrite主歌词文本布局 = nullptr;
    }
    else
    {
        D2D1_RECT_F 主歌词_矩形 = D2D1::RectF(
            max(0, rect.left + this->DPI(5)),
            max(0, rect.top + this->DPI(5)),
            max(0, rect.right - this->DPI(5)),
            max(0, rect.bottom / 2.0f)
        );

        主歌词_矩形.right = max(主歌词_矩形.right, 主歌词_矩形.left);
        主歌词_矩形.bottom = max(主歌词_矩形.bottom, 主歌词_矩形.top);

        // 创建文字格式
        this->DWrite工厂->CreateTextFormat(
            this->字体名称.c_str(),
            nullptr,
            this->字体样式_主歌词_字重,
            this->字体样式_主歌词_斜体,
            DWRITE_FONT_STRETCH_NORMAL,
            this->DPI(15),
            L"zh-CN",
            &this->DWrite主歌词文本格式
        );

        // 创建文字布局
        this->DWrite工厂->CreateTextLayout(
            this->主歌词.c_str(),
            this->主歌词.size(),
            this->DWrite主歌词文本格式,
            (float) (主歌词_矩形.right - 主歌词_矩形.left),
            (float) (主歌词_矩形.bottom - 主歌词_矩形.top),
            &this->DWrite主歌词文本布局
        );

        this->DWrite主歌词文本布局->SetTrimming(&歌词裁剪, nullptr);
        this->DWrite主歌词文本布局->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP);
        this->DWrite主歌词文本布局->SetTextAlignment(this->对齐方式_主歌词);
        this->DWrite主歌词文本布局->SetUnderline(this->字体样式_主歌词_下划线, DWRITE_TEXT_RANGE{0, this->主歌词.size()});
        this->DWrite主歌词文本布局->SetStrikethrough(this->字体样式_主歌词_删除线, DWRITE_TEXT_RANGE{0, this->主歌词.size()});
        D2D1::ColorF 主颜色 = this->深浅模式 ? this->字体颜色_浅色_主歌词 : this->字体颜色_深色_主歌词;
        主颜色.a *= this->淡入不透明度;
        this->D2D纯色笔刷->SetColor(主颜色);

        //绘制主文字
        this->D2D呈现目标->DrawTextLayout(
            D2D1::Point2F(主歌词_矩形.left, 主歌词_矩形.top),
            this->DWrite主歌词文本布局,
            this->D2D纯色笔刷,
            D2D1_DRAW_TEXT_OPTIONS_NO_SNAP
        );

        /******************************************/

        D2D1_RECT_F 副歌词_矩形 = D2D1::RectF(
            max(0, rect.left + this->DPI(5)),
            max(0, rect.bottom / 2.0f),
            max(0, rect.right - this->DPI(5)),
            max(0, rect.bottom - this->DPI(5))
        );

        副歌词_矩形.right = max(副歌词_矩形.right, 副歌词_矩形.left);
        副歌词_矩形.bottom = max(副歌词_矩形.bottom, 副歌词_矩形.top);

        // 创建文字格式
        this->DWrite工厂->CreateTextFormat(
            this->字体名称.c_str(),
            nullptr,
            this->字体样式_副歌词_字重,
            this->字体样式_副歌词_斜体,
            DWRITE_FONT_STRETCH_NORMAL,
            this->DPI(15),
            L"zh-CN",
            &this->DWrite副歌词文本格式
        );

        // 创建文字布局
        this->DWrite工厂->CreateTextLayout(
            this->副歌词.c_str(),
            this->副歌词.size(),
            this->DWrite副歌词文本格式,
            (float) (副歌词_矩形.right - 副歌词_矩形.left),
            (float) (副歌词_矩形.bottom - 副歌词_矩形.top),
            &this->DWrite副歌词文本布局
        );

        this->DWrite副歌词文本布局->SetTrimming(&歌词裁剪, nullptr);
        this->DWrite副歌词文本布局->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP);
        this->DWrite副歌词文本布局->SetTextAlignment(this->对齐方式_副歌词);
        this->DWrite副歌词文本布局->SetUnderline(this->字体样式_副歌词_下划线, DWRITE_TEXT_RANGE{0, this->副歌词.size()});
        this->DWrite副歌词文本布局->SetStrikethrough(this->字体样式_副歌词_删除线, DWRITE_TEXT_RANGE{0, this->副歌词.size()});
        D2D1::ColorF 副颜色 = this->深浅模式 ? this->字体颜色_浅色_副歌词 : this->字体颜色_深色_副歌词;
        副颜色.a *= this->淡入不透明度;
        this->D2D纯色笔刷->SetColor(副颜色);

        //绘制文字显示
        this->D2D呈现目标->DrawTextLayout(
            D2D1::Point2F(副歌词_矩形.left, 副歌词_矩形.top),
            this->DWrite副歌词文本布局,
            this->D2D纯色笔刷,
            D2D1_DRAW_TEXT_OPTIONS_NO_SNAP
        );

        this->DWrite主歌词文本格式->Release();
        this->DWrite主歌词文本格式 = nullptr;
        this->DWrite主歌词文本布局->Release();
        this->DWrite主歌词文本布局 = nullptr;
        this->DWrite副歌词文本格式->Release();
        this->DWrite副歌词文本格式 = nullptr;
        this->DWrite副歌词文本布局->Release();
        this->DWrite副歌词文本布局 = nullptr;
    }

    this->D2D呈现目标->EndDraw();
}


float 呈现窗口类::DPI(
    UINT 像素大小
) {
    auto 屏幕DPI = GetDpiForWindow(*this->窗口句柄);
    auto 新像素大小 = static_cast<float>(像素大小 * 屏幕DPI / 96);
    return 新像素大小;
}


void 呈现窗口类::启动淡入()
{
    if (this->淡入定时器ID)
    {
        KillTimer(*this->窗口句柄, this->淡入定时器ID);
        this->淡入定时器ID = 0;
    }

    if (this->淡入时长 == 0 || this->淡入总步数 == 0)
    {
        this->淡入不透明度 = 1.0f;
        this->淡入定时器ID = 0;
    }
    else
    {
        this->淡入动画进度 = 0;
        this->淡入不透明度 = 0.0f;
        int 定时器间隔 = this->淡入时长 / this->淡入总步数;
        if (定时器间隔 < 1) 定时器间隔 = 1;
        this->淡入定时器ID = SetTimer(*this->窗口句柄, 淡入定时器, 定时器间隔, NULL);
    }

    PostMessage(*this->窗口句柄, WM_PAINT, NULL, NULL);
}


void 呈现窗口类::开始淡入动画()
{
    // 旧歌词已在 NetworkServer::歌词() 中提前保存

    // 统一清理正在运行的动画定时器
    if (this->淡入定时器ID)
    {
        KillTimer(*this->窗口句柄, this->淡入定时器ID);
        this->淡入定时器ID = 0;
    }
    if (this->淡出定时器ID)
    {
        KillTimer(*this->窗口句柄, this->淡出定时器ID);
        this->淡出定时器ID = 0;
    }
    if (this->淡入延迟定时器ID)
    {
        KillTimer(*this->窗口句柄, this->淡入延迟定时器ID);
        this->淡入延迟定时器ID = 0;
    }

    // 根据帧率计算步数
    this->淡入总步数 = (std::max)(1, this->淡入时长 * this->帧率 / 1000);
    this->淡出总步数 = (std::max)(1, this->淡出时长 * this->帧率 / 1000);
    this->淡入不透明度 = 0.0f;

    // 启动淡出（立即开始）
    if (this->淡出时长 == 0 || this->淡出总步数 == 0)
    {
        this->淡出不透明度 = 0.0f;
        this->淡出定时器ID = 0;
    }
    else
    {
        this->淡出动画进度 = 0;
        this->淡出不透明度 = 1.0f;
        int 定时器间隔 = this->淡出时长 / this->淡出总步数;
        if (定时器间隔 < 1) 定时器间隔 = 1;
        this->淡出定时器ID = SetTimer(*this->窗口句柄, 淡出定时器, 定时器间隔, NULL);
    }

    int 淡入延迟 = 0;
    if (this->交叉淡入淡出)
    {
        // 重叠时间越大，淡入越早开始；最大为淡出时长（同时开始）
        int 有效重叠 = (std::min)(this->重叠时间, this->淡出时长);
        淡入延迟 = this->淡出时长 - 有效重叠;
    }
    else
    {
        // 负间隔会提前启动淡入，但新歌词仍会在旧歌词淡出后才绘制
        淡入延迟 = this->淡出时长 + this->淡入间隔;
    }

    if (淡入延迟 <= 0)
    {
        this->启动淡入();
    }
    else
    {
        this->淡入延迟定时器ID = SetTimer(*this->窗口句柄, 淡入延迟定时器, 淡入延迟, NULL);
    }

    PostMessage(*this->窗口句柄, WM_PAINT, NULL, NULL);
}
