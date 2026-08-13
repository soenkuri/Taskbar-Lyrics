import os
import json
import shutil
import subprocess
import time

REPOSITORY = "soenkuri/Taskbar-Lyrics"
DOWNLOAD_DIR = r"C:\Users\Soenkuri\Downloads"
SOURCE = os.path.join(DOWNLOAD_DIR, "Taskbar-Lyric-dev.plugin")
DEST_DIR = r"C:\betterncm\plugins"
CLOUDMUSIC = r"C:\Program Files (x86)\NetEase\CloudMusic\cloudmusic.exe"


def find_github_cli():
    """查找 GitHub CLI，兼容未刷新当前进程 PATH 的安装环境。"""
    candidates = [
        shutil.which("gh"),
        r"C:\Program Files\GitHub CLI\gh.exe",
        r"C:\Program Files (x86)\GitHub CLI\gh.exe",
    ]
    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return candidate
    raise RuntimeError("找不到 GitHub CLI，请确认 gh.exe 已安装")


def download_latest_plugin():
    """下载仓库最新（包含预发布）release 中的 plugin 资产。"""
    github_cli = find_github_cli()
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)

    release_result = subprocess.run(
        [
            github_cli,
            "release",
            "list",
            "--repo",
            REPOSITORY,
            "--exclude-drafts",
            "--limit",
            "1",
            "--json",
            "tagName",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if release_result.returncode != 0:
        raise RuntimeError(
            f"获取最新 release 失败: {release_result.stderr.strip()}"
        )

    try:
        releases = json.loads(release_result.stdout)
        tag_name = releases[0]["tagName"]
    except (ValueError, IndexError, KeyError, TypeError) as error:
        raise RuntimeError("仓库没有可下载的 release") from error

    download_result = subprocess.run(
        [
            github_cli,
            "release",
            "download",
            tag_name,
            "--repo",
            REPOSITORY,
            "--pattern",
            "*.plugin",
            "--output",
            SOURCE,
            "--clobber",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if download_result.returncode != 0:
        raise RuntimeError(
            f"下载 release {tag_name} 失败: {download_result.stderr.strip()}"
        )
    if not os.path.isfile(SOURCE):
        raise RuntimeError(f"下载完成但找不到 plugin 文件: {SOURCE}")

    print(f"已下载最新 release {tag_name}: {SOURCE}")


def remove_file_with_retry(path, max_attempts=10, initial_delay=0.25):
    """删除可能仍被系统短暂占用的单个文件。"""
    for attempt in range(max_attempts):
        try:
            os.remove(path)
            return
        except FileNotFoundError:
            return
        except OSError as error:
            if attempt == max_attempts - 1:
                raise RuntimeError(f"删除失败，已重试 {max_attempts} 次: {path}") from error

            delay = initial_delay * (2 ** attempt)
            print(f"删除 {path} 失败，{delay:.2f} 秒后重试 ({attempt + 1}/{max_attempts})")
            time.sleep(delay)

download_latest_plugin()

# 复制插件文件
dest = os.path.join(DEST_DIR, os.path.basename(SOURCE))
os.makedirs(DEST_DIR, exist_ok=True)
shutil.copy2(SOURCE, dest)
print(f"已复制 {os.path.basename(SOURCE)} -> {DEST_DIR}")

# 停止进程
for proc in ["cloudmusic.exe", "taskbar-lyrics.exe"]:
    subprocess.run(["taskkill", "/F", "/IM", proc], capture_output=True)
    print(f"已终止 {proc}")

time.sleep(1)

# 清理文件
exe_path = r"C:\betterncm\taskbar-lyrics.exe"
config_path = r"C:\betterncm\taskbar-lyrics.ini"
for path in [exe_path, config_path]:
    if os.path.exists(path):
        remove_file_with_retry(path)
        print(f"已删除 {path}")

runtime_dir = r"C:\betterncm\plugins_runtime\Taskbar-Lyrics"
if os.path.exists(runtime_dir):
    shutil.rmtree(runtime_dir)
    print(f"已删除 {runtime_dir}")

time.sleep(3)

# 重新启动网易云音乐
subprocess.Popen([CLOUDMUSIC])
print(f"已启动网易云音乐")

# 删除下载文件
os.remove(SOURCE)
print(f"已删除 {SOURCE}")
