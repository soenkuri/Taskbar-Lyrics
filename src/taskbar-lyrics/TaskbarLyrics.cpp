#include "NetworkServer.hpp"
#include "CreateWindow.hpp"
#include "TaskbarLyrics.hpp"

#include <tlhelp32.h>
#include <string>


namespace
{
constexpr wchar_t 任务栏歌词进程名[] = L"taskbar-lyrics.exe";


bool 是任务栏歌词进程(const PROCESSENTRY32W& 进程)
{
    return lstrcmpiW(进程.szExeFile, 任务栏歌词进程名) == 0;
}
}


任务栏歌词类::任务栏歌词类(
    HINSTANCE   实例句柄,
    int         显示方法
) {
    this->获取端口();
    this->替换已有实例 = this->清理已有实例();

    this->任务栏窗口 = new 任务栏窗口类(实例句柄, 显示方法);
    this->网络服务器 = new 网络服务器类(
        this->任务栏窗口,
        this->端口,
        this->替换已有实例,
        this->启动标识
    );

    this->网易云进程检测();
}


任务栏歌词类::~任务栏歌词类()
{
    FreeConsole();
    static_cast<void>(UnregisterWaitEx(this->等待句柄, INVALID_HANDLE_VALUE));

    delete this->网络服务器;
    this->网络服务器 = nullptr;

    delete this->任务栏窗口;
    this->任务栏窗口 = nullptr;
}


void 任务栏歌词类::获取端口()
{
    int argCount = 0;
    LPWSTR* szArgList = CommandLineToArgvW(GetCommandLine(), &argCount);
    if (szArgList == nullptr)
    {
        return;
    }

    if (argCount > 1 && szArgList[1])
    {
        std::wstringstream 宽字符转换流;
        宽字符转换流 << szArgList[1];
        宽字符转换流 >> this->端口;
    }

    if (argCount > 2 && szArgList[2])
    {
        this->启动标识 = szArgList[2];
    }

    LocalFree(szArgList);
}


bool 任务栏歌词类::清理已有实例()
{
    bool 已替换实例 = false;

    // 重复启动时，结束所有旧的同名进程；重复扫描用于等待被终止的进程
    // 从系统进程列表中消失，避免新实例与旧实例同时占用端口。
    for (int 扫描次数 = 0; 扫描次数 < 3; ++扫描次数)
    {
        bool 发现已有实例 = false;
        HANDLE 快照 = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (快照 == INVALID_HANDLE_VALUE)
        {
            break;
        }

        PROCESSENTRY32W 进程 = {};
        进程.dwSize = sizeof(PROCESSENTRY32W);
        if (Process32FirstW(快照, &进程))
        {
            do
            {
                if (
                    进程.th32ProcessID != GetCurrentProcessId()
                    && 是任务栏歌词进程(进程)
                )
                {
                    发现已有实例 = true;
                    HANDLE 进程句柄 = OpenProcess(
                        PROCESS_TERMINATE | SYNCHRONIZE,
                        FALSE,
                        进程.th32ProcessID
                    );
                    if (进程句柄 == nullptr)
                    {
                        continue;
                    }

                    if (TerminateProcess(进程句柄, 0))
                    {
                        已替换实例 = true;
                        WaitForSingleObject(进程句柄, 3000);
                    }
                    CloseHandle(进程句柄);
                }
            } while (Process32NextW(快照, &进程));
        }
        CloseHandle(快照);

        if (!发现已有实例)
        {
            break;
        }
        Sleep(50);
    }

    return 已替换实例;
}


void 任务栏歌词类::网易云进程检测()
{
    auto 关闭窗口 = [] (PVOID lpParameter, BOOLEAN TimerOrWaitFired)
    {
        UNREFERENCED_PARAMETER(TimerOrWaitFired);
        任务栏歌词类* _this = static_cast<任务栏歌词类*>(lpParameter);
        SendMessage(_this->任务栏窗口->窗口句柄, WM_CLOSE, NULL, NULL);
    };

    HWND 网易云句柄 = FindWindow(L"OrpheusBrowserHost", NULL);
    if (网易云句柄)
    {
        DWORD pid;
        GetWindowThreadProcessId(网易云句柄, &pid);
        HANDLE process = OpenProcess(PROCESS_ALL_ACCESS, FALSE, pid); 
        RegisterWaitForSingleObject(&this->等待句柄, process, 关闭窗口, this, INFINITE, WT_EXECUTEONLYONCE);
    }
}


int APIENTRY wWinMain(
    _In_        HINSTANCE   实例句柄,
    _In_opt_    HINSTANCE   前一个实例句柄,
    _In_        LPWSTR      命令行,
    _In_        int         显示方法
) {
    UNREFERENCED_PARAMETER(前一个实例句柄);
    UNREFERENCED_PARAMETER(命令行);

    #ifdef _DEBUG
        AllocConsole();
        SetConsoleOutputCP(65001);
        FILE* stream;
        freopen_s(&stream, "conout$", "w", stdout);
    #endif

    // 串行化多个同时到达的启动命令，避免两个新实例互相结束后又同时启动。
    HANDLE 启动互斥 = CreateMutexW(
        nullptr,
        FALSE,
        L"Local\\TaskbarLyrics.StartupLock"
    );
    if (启动互斥 != nullptr)
    {
        WaitForSingleObject(启动互斥, INFINITE);
    }

    任务栏歌词类 任务栏歌词(实例句柄, 显示方法);

    if (启动互斥 != nullptr)
    {
        ReleaseMutex(启动互斥);
        CloseHandle(启动互斥);
    }

    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    return msg.wParam;
}
