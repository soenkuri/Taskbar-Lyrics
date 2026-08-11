#include "CreateWindow.hpp"


任务栏窗口类* 任务栏窗口类::任务栏窗口 = nullptr;


任务栏窗口类::任务栏窗口类(
    HINSTANCE   实例句柄,
    int         显示方法
) {
    this->任务栏窗口 = this;
    this->呈现窗口 = new 呈现窗口类(&this->窗口句柄);

    this->注册窗口(实例句柄);
    this->创建窗口(实例句柄, 显示方法);

    this->剩余宽度检测();
    this->监听注册表();
}


任务栏窗口类::~任务栏窗口类()
{
    delete this->呈现窗口;
    this->呈现窗口 = nullptr;

    this->剩余宽度检测_线程->detach();
    delete this->剩余宽度检测_线程;
    this->剩余宽度检测_线程 = nullptr;

    this->监听注册表_线程->detach();
    delete this->监听注册表_线程;
    this->监听注册表_线程 = nullptr;
}


void 任务栏窗口类::注册窗口(
    HINSTANCE hInstance
) {
    WNDCLASSEX wcex = {};
    wcex.cbSize = sizeof(WNDCLASSEX);
    wcex.hInstance = hInstance;
    wcex.lpfnWndProc = this->窗口过程;
    wcex.lpszClassName = this->窗口类名.c_str();
    wcex.style = CS_HREDRAW | CS_VREDRAW;
    wcex.hbrBackground = HBRUSH(GetStockObject(NULL_BRUSH));
    wcex.cbClsExtra = 0;
    wcex.cbWndExtra = 0;
    wcex.hCursor = nullptr;
    wcex.hIcon = nullptr;
    wcex.hIconSm = nullptr;
    wcex.lpszMenuName = nullptr;
    RegisterClassEx(&wcex);
}


void 任务栏窗口类::创建窗口(
    HINSTANCE   实例句柄,
    int         显示方法
) {
    HWND 任务栏_句柄 = FindWindow(L"Shell_TrayWnd", NULL);
    this->窗口句柄 = CreateWindowEx(
        WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_TOPMOST,
        this->窗口类名.c_str(),
        this->窗口名字.c_str(),
        WS_POPUP,
        CW_USEDEFAULT,
        CW_USEDEFAULT,
        CW_USEDEFAULT,
        CW_USEDEFAULT,
        任务栏_句柄,
        NULL,
        实例句柄,
        NULL
    );

    SetParent(this->窗口句柄, 任务栏_句柄);
    ShowWindow(this->窗口句柄, 显示方法);
    PostMessage(this->窗口句柄, WM_PAINT, NULL, NULL);
}


void 任务栏窗口类::剩余宽度检测()
{
    auto 线程函数 = [&] () {
        while (true)
        {
            std::this_thread::sleep_for(std::chrono::seconds(1));

            RECT 任务栏_矩形;
            RECT 开始按钮_矩形;
            RECT 活动区域_矩形;
            RECT 通知区域_矩形;

            GetWindowRect(this->呈现窗口->任务栏_句柄, &任务栏_矩形);
            GetWindowRect(this->呈现窗口->开始按钮_句柄, &开始按钮_矩形);
            GetWindowRect(this->呈现窗口->活动区域_句柄, &活动区域_矩形);
            GetWindowRect(this->呈现窗口->通知区域_句柄, &通知区域_矩形);

            // 只有不一样才会刷新
            if (std::memcmp(&this->呈现窗口->任务栏_矩形, &任务栏_矩形, sizeof(RECT)))
            {
                this->呈现窗口->任务栏_矩形 = 任务栏_矩形;
                PostMessage(this->窗口句柄, WM_PAINT, NULL, NULL);
            }

            if (this->呈现窗口->居中对齐)
            {
                if (std::memcmp(&this->呈现窗口->开始按钮_矩形, &开始按钮_矩形, sizeof(RECT)))
                {
                    this->呈现窗口->开始按钮_矩形 = 开始按钮_矩形;
                    PostMessage(this->窗口句柄, WM_PAINT, NULL, NULL);
                }
            }
            else
            {
                if (std::memcmp(&this->呈现窗口->活动区域_矩形, &活动区域_矩形, sizeof(RECT)))
                {
                    this->呈现窗口->活动区域_矩形 = 活动区域_矩形;
                    PostMessage(this->窗口句柄, WM_PAINT, NULL, NULL);
                }
                if (std::memcmp(&this->呈现窗口->通知区域_矩形, &通知区域_矩形, sizeof(RECT))) {
                    this->呈现窗口->通知区域_矩形 = 通知区域_矩形;
                    PostMessage(this->窗口句柄, WM_PAINT, NULL, NULL);
                }
            }

        }
    };

    this->剩余宽度检测_线程 = new std::thread(线程函数);
}


void 任务栏窗口类::监听注册表()
{
    auto 读取注册表 = [](
        std::wstring path,
        std::wstring keyName,
        DWORD& value
        ) {
            HKEY key;
            DWORD bufferSize = sizeof(DWORD);
            if (RegOpenKeyEx(HKEY_CURRENT_USER, path.c_str(), NULL, KEY_READ, &key)) return true;
            if (RegQueryValueEx(key, keyName.c_str(), NULL, NULL, (LPBYTE) &value, &bufferSize)) return true;
            RegCloseKey(key);
            return false;
    };

    auto 获取注册表值 = [this, 读取注册表] () {
        {
            DWORD 值;
            std::wstring 路径 = L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
            std::wstring 键 = L"SystemUsesLightTheme";
            if (!读取注册表(路径, 键, 值))
            {
                this->呈现窗口->深浅模式 = static_cast<bool>(值);
            }
        }

        {
            DWORD 值;
            std::wstring 路径 = L"Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced";
            std::wstring 键 = L"TaskbarAl";
            if (!读取注册表(路径, 键, 值))
            {
                this->呈现窗口->居中对齐 = static_cast<bool>(值);
            }
        }

        {
            DWORD 值;
            std::wstring 路径 = L"Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced";
            std::wstring 键 = L"TaskbarDa";
            if (!读取注册表(路径, 键, 值))
            {
                this->呈现窗口->组件按钮 = static_cast<bool>(值);
            }
        }

        PostMessage(this->窗口句柄, WM_PAINT, NULL, NULL);
    };

    获取注册表值();

    auto 线程函数 = [this, 获取注册表值] () {
        // 持续监听注册表
        while (true)
        {
            // 打开注册表
            if (!this->注册表句柄)
            {
                std::wstring path = L"Software\\Microsoft\\Windows\\CurrentVersion";
                RegOpenKeyEx(HKEY_CURRENT_USER, path.c_str(), NULL, KEY_NOTIFY, &this->注册表句柄);
                continue;
            }

            // 监听注册表
            if (RegNotifyChangeKeyValue(this->注册表句柄, true, REG_NOTIFY_CHANGE_LAST_SET, NULL, false))
            {
                continue;
            }

            获取注册表值();
        }
    };

    this->剩余宽度检测_线程 = new std::thread(线程函数);
}


LRESULT CALLBACK 任务栏窗口类::窗口过程(
    HWND    窗口句柄,
    UINT    消息,
    WPARAM  字参数,
    LPARAM  长参数
) {
    switch (消息)
    {
        case WM_PAINT:
        {
            任务栏窗口类::任务栏窗口->呈现窗口->更新窗口();
        };
        break;

        case WM_TIMER:
        {
            auto& 窗口 = 任务栏窗口类::任务栏窗口->呈现窗口;

            // 缓动曲线函数
            auto 缓动 = [](float t, int curve) -> float {
                switch (curve) {
                    case 0: return t;                       // 线性
                    case 1: return t * t;                   // 缓入
                    case 2: return t * (2.0f - t);         // 缓出
                    case 3: return t < 0.5f ? 2*t*t : -1+(4-2*t)*t; // 缓入缓出
                    case 4: { float s = 1.70158f; return t*t*((s+1)*t - s); } // 回弹
                    default: return t;
                }
            };

            switch (字参数)
            {
                case 淡入定时器:
                {
                    if (窗口->淡入动画进度 < 窗口->淡入总步数)
                    {
                        窗口->淡入动画进度++;
                        float t = static_cast<float>(窗口->淡入动画进度) / 窗口->淡入总步数;
                        窗口->淡入不透明度 = 缓动(t, 窗口->动画曲线);
                        PostMessage(窗口句柄, WM_PAINT, NULL, NULL);
                    }
                    else
                    {
                        KillTimer(窗口句柄, 窗口->淡入定时器ID);
                        窗口->淡入定时器ID = 0;
                        窗口->淡入不透明度 = 1.0f;
                    }
                }
                break;

                case 淡出定时器:
                {
                    if (窗口->淡出动画进度 < 窗口->淡出总步数)
                    {
                        窗口->淡出动画进度++;
                        float t = static_cast<float>(窗口->淡出动画进度) / 窗口->淡出总步数;
                        窗口->淡出不透明度 = 1.0f - 缓动(t, 窗口->动画曲线);
                        PostMessage(窗口句柄, WM_PAINT, NULL, NULL);
                    }
                    else
                    {
                        KillTimer(窗口句柄, 窗口->淡出定时器ID);
                        窗口->淡出定时器ID = 0;
                        窗口->淡出不透明度 = 0.0f;
                    }
                }
                break;

                case 淡入延迟定时器:
                {
                    KillTimer(窗口句柄, 窗口->淡入延迟定时器ID);
                    窗口->淡入延迟定时器ID = 0;
                    窗口->启动淡入();
                }
                break;

                case 隐藏定时器:
                {
                    KillTimer(窗口句柄, 窗口->隐藏定时器ID);
                    窗口->隐藏定时器ID = 0;

                    // 保存旧歌词并清空当前歌词，触发淡出隐藏
                    窗口->旧主歌词 = 窗口->主歌词;
                    窗口->旧副歌词 = 窗口->副歌词;
                    窗口->主歌词 = L"";
                    窗口->副歌词 = L"";
                    PostMessage(窗口句柄, WM_FADE_START, NULL, NULL);
                }
                break;
            }
        };
        break;

        case WM_FADE_START:
        {
            任务栏窗口类::任务栏窗口->呈现窗口->开始淡入动画();
        };
        break;

        case WM_ERASEBKGND:
        {
            return 0;
        };
        break;

        case WM_CLOSE:
        {
            DestroyWindow(窗口句柄);
        };
        break;

        case WM_DESTROY:
        {
            PostQuitMessage(0);
        };
        break;

        default:
        {
            return DefWindowProc(窗口句柄, 消息, 字参数, 长参数);
        };
        break;
    }

    return 0;
}
