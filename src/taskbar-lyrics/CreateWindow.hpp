#pragma once

#include "RenderWindow.hpp"
#include <Windows.h>
#include <string>
#include <thread>


constexpr UINT WM_TASKBAR_CONFIG = WM_APP + 1;
constexpr UINT_PTR 任务栏检测定时器 = 4;


class 任务栏窗口类
{
    private:
    static 任务栏窗口类* 任务栏窗口;


    public:
    呈现窗口类* 呈现窗口 = nullptr;


    public:
    HWND 窗口句柄;


    private:
    void 剩余宽度检测(bool 强制挂载 = false);


    private:
    HKEY 注册表句柄 = nullptr;
    std::thread* 监听注册表_线程 = nullptr;
    void 监听注册表();


    private:
    std::wstring 窗口类名 = L"betterncm_taskbar_lyrics";
    std::wstring 窗口名字 = L"BetterNCM 任务栏歌词类";


    public:
    任务栏窗口类(HINSTANCE, int);
    ~任务栏窗口类();


    private:
    void 注册窗口(HINSTANCE);
    void 创建窗口(HINSTANCE, int);


    private:
    static LRESULT CALLBACK 窗口过程(HWND, UINT, WPARAM, LPARAM);
};