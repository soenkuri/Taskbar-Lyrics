import requests
import os
import shutil
import subprocess

REPO = "soenkuri/Taskbar-Lyrics"
DEST_DIR = r"C:\betterncm\plugins"

# 获取最新 release
api = f"https://api.github.com/repos/{REPO}/releases/latest"
release = requests.get(api).json()

if "assets" not in release or not release["assets"]:
    print(f"错误: 最新 release 没有可下载的文件")
    print(f"API 返回: {release}")
    exit(1)

asset = next((a for a in release["assets"] if a["name"].endswith(".plugin")), None)
if not asset:
    print(f"错误: release 中没有 .plugin 文件")
    print(f"可用文件: {[a['name'] for a in release['assets']]}")
    exit(1)

print(f"版本: {release['tag_name']}")
print(f"文件: {asset['name']} ({asset['size'] // 1024} KB)")

# 下载
dest = os.path.join(DEST_DIR, asset["name"])
with requests.get(asset["browser_download_url"], stream=True) as r:
    r.raise_for_status()
    with open(dest, "wb") as f:
        for chunk in r.iter_content(chunk_size=8192):
            f.write(chunk)

print(f"已保存到 {dest}")

# 停止进程
for proc in ["cloudmusic.exe", "taskbar-lyrics.exe"]:
    subprocess.run(["taskkill", "/F", "/IM", proc], capture_output=True)
    print(f"已终止 {proc}")

# 清理文件
exe_path = r"C:\betterncm\taskbar-lyrics.exe"
if os.path.exists(exe_path):
    os.remove(exe_path)
    print(f"已删除 {exe_path}")

runtime_dir = r"C:\betterncm\plugins_runtime\Taskbar-Lyrics"
if os.path.exists(runtime_dir):
    shutil.rmtree(runtime_dir)
    print(f"已删除 {runtime_dir}")
