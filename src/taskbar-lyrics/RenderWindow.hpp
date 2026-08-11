#pragma once

#include <Windows.h>
#include <d2d1.h>
#include <dwrite.h>
#include <string>


#define WM_FADE_START (WM_USER + 1)


enum WindowAlignment
{
    WindowAlignmentAdaptive = 0,
    WindowAlignmentLeft = 1,
    WindowAlignmentCenter = 2,
    WindowAlignmentRight = 3
};


class 呈现窗口类
{
    private:
    HWND *窗口句柄 = nullptr;


    public:
    HWND 任务栏_句柄;
    HWND 通知区域_句柄;
    HWND 开始按钮_句柄;
    HWND 活动区域_句柄;

    RECT 任务栏_矩形;
    RECT 通知区域_矩形;
    RECT 开始按钮_矩形;
    RECT 活动区域_矩形;


    public:
    呈现窗口类(HWND*);
    ~呈现窗口类();


    private:
    ID2D1Factory* D2D工厂 = nullptr;
    ID2D1DCRenderTarget* D2D呈现目标 = nullptr;
    ID2D1SolidColorBrush* D2D纯色笔刷 = nullptr;

    IDWriteFactory* DWrite工厂 = nullptr;
    IDWriteTextFormat* DWrite主歌词文本格式 = nullptr;
    IDWriteTextLayout* DWrite主歌词文本布局 = nullptr;
    IDWriteTextFormat* DWrite副歌词文本格式 = nullptr;
    IDWriteTextLayout* DWrite副歌词文本布局 = nullptr;


    public:
    bool 深浅模式 = false;
    bool 组件按钮 = false;
    bool 居中对齐 = true;

    std::wstring 主歌词 = L"Taskbar Lyrics Ready";
    std::wstring 副歌词 = L"Waiting for lyrics...";

    std::wstring 字体名称 = L"Microsoft YaHei UI";

    D2D1::ColorF 字体颜色_浅色_主歌词 = D2D1::ColorF(0x000000, 1);
    D2D1::ColorF 字体颜色_浅色_副歌词 = D2D1::ColorF(0x000000, 1);
    D2D1::ColorF 字体颜色_深色_主歌词 = D2D1::ColorF(0xFFFFFF, 1);
    D2D1::ColorF 字体颜色_深色_副歌词 = D2D1::ColorF(0xFFFFFF, 1);

    DWRITE_FONT_WEIGHT 字体样式_主歌词_字重 = DWRITE_FONT_WEIGHT_LIGHT;
    DWRITE_FONT_WEIGHT 字体样式_副歌词_字重 = DWRITE_FONT_WEIGHT_LIGHT;
    DWRITE_FONT_STYLE 字体样式_主歌词_斜体 = DWRITE_FONT_STYLE_NORMAL;
    DWRITE_FONT_STYLE 字体样式_副歌词_斜体 = DWRITE_FONT_STYLE_NORMAL;
    
    bool 字体样式_主歌词_下划线 = false;
    bool 字体样式_副歌词_下划线 = false;
    bool 字体样式_主歌词_删除线 = false;
    bool 字体样式_副歌词_删除线 = false;

    WindowAlignment 窗口位置 = WindowAlignment::WindowAlignmentCenter;

    int 左边距 = 0;
    int 右边距 = 0;

    DWRITE_TEXT_ALIGNMENT 对齐方式_主歌词 = DWRITE_TEXT_ALIGNMENT::DWRITE_TEXT_ALIGNMENT_CENTER;
    DWRITE_TEXT_ALIGNMENT 对齐方式_副歌词 = DWRITE_TEXT_ALIGNMENT::DWRITE_TEXT_ALIGNMENT_CENTER;

    float 歌词不透明度 = 1.0f;
    UINT_PTR 淡入定时器ID = 0;
    int 淡入动画进度 = 0;
    int 淡入总步数 = 10;
    int 过渡时长 = 400;
    std::wstring 旧主歌词;
    std::wstring 旧副歌词;


	public:
    void 更新窗口();
    void 开始淡入动画();


    private:
	void 绘制窗口(long, long, long, long);
    void 绘制歌词(HDC&, RECT&);


    private:
    float DPI(UINT);
};
