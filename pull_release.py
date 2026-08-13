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


def format_bytes(value):
    units = ["B", "KB", "MB", "GB"]
    size = float(value)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            return f"{size:.1f} {unit}"
        size /= 1024


def print_download_progress(downloaded, total):
    width = 30
    ratio = min(max(downloaded / total, 0), 1) if total > 0 else 0
    filled = int(width * ratio)
    bar = "#" * filled + "-" * (width - filled)
    percent = ratio * 100 if total > 0 else 0
    print(
        f"\r下载进度 [{bar}] {percent:6.2f}% "
        f"({format_bytes(downloaded)} / {format_bytes(total)})",
        end="",
        flush=True,
    )


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

    asset_result = subprocess.run(
        [
            github_cli,
            "release",
            "view",
            tag_name,
            "--repo",
            REPOSITORY,
            "--json",
            "assets",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if asset_result.returncode != 0:
        raise RuntimeError(
            f"读取 release {tag_name} 资产失败: {asset_result.stderr.strip()}"
        )

    try:
        assets = json.loads(asset_result.stdout).get("assets", [])
        plugin_assets = [
            asset for asset in assets
            if str(asset.get("name", "")).lower().endswith(".plugin")
        ]
        if len(plugin_assets) != 1:
            raise RuntimeError(
                f"release {tag_name} 中找到 {len(plugin_assets)} 个 plugin 资产，无法确定下载目标"
            )
        plugin_asset = plugin_assets[0]
        asset_name = plugin_asset["name"]
        asset_size = int(plugin_asset["size"])
    except (ValueError, TypeError, KeyError, AttributeError) as error:
        raise RuntimeError(f"无法解析 release {tag_name} 的 plugin 资产信息") from error

    print(f"正在下载最新 release {tag_name}：{asset_name}")
    if os.path.isfile(SOURCE):
        os.remove(SOURCE)
    download_process = subprocess.Popen(
        [
            github_cli,
            "release",
            "download",
            tag_name,
            "--repo",
            REPOSITORY,
            "--pattern",
            asset_name,
            "--output",
            SOURCE,
            "--clobber",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    while download_process.poll() is None:
        downloaded_size = os.path.getsize(SOURCE) if os.path.isfile(SOURCE) else 0
        print_download_progress(downloaded_size, asset_size)
        time.sleep(0.1)

    stderr = download_process.communicate()[1].strip()
    downloaded_size = os.path.getsize(SOURCE) if os.path.isfile(SOURCE) else 0
    print_download_progress(downloaded_size, asset_size)
    print()
    if download_process.returncode != 0:
        raise RuntimeError(
            f"下载 release {tag_name} 失败: {stderr}"
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
