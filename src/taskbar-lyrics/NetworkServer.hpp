#pragma once

#include "httplib.h"
#include <thread>
#include <string>
#include <codecvt>
#include <mutex>


class 网络服务器类
{
	private:
	httplib::Server 网络服务器;
	class 任务栏窗口类* 任务栏窗口 = nullptr;
	std::thread* 网络服务器_线程 = nullptr;
	std::wstring 配置文件路径;
	std::mutex 配置互斥;


	private:
    std::wstring_convert<std::codecvt_utf8<wchar_t>> 字符转换;


	public:
	网络服务器类(class 任务栏窗口类*, unsigned short);
	~网络服务器类();


	private:
	void 字体(const httplib::Request&, httplib::Response&);
	void 颜色(const httplib::Request&, httplib::Response&);
	void 样式(const httplib::Request&, httplib::Response&);
	void 歌词(const httplib::Request&, httplib::Response&);
	void 对齐(const httplib::Request&, httplib::Response&);
	void 位置(const httplib::Request&, httplib::Response&);
	void 边距(const httplib::Request&, httplib::Response&);
	void 屏幕(const httplib::Request&, httplib::Response&);
	void 过渡动画(const httplib::Request&, httplib::Response&);
	void 关闭(const httplib::Request&, httplib::Response&);

	void 初始化配置路径();
	void 保存配置();
	void 加载配置();
	void 应用屏幕(const std::wstring&);
};
