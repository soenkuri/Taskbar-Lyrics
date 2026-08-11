import os
import shutil
import subprocess

SOURCE = r"C:\Users\Soenkuri\Downloads\Taskbar-Lyric-dev.plugin"
DEST_DIR = r"C:\betterncm\plugins"

if not os.path.exists(SOURCE):
    print(f"错误: 找不到 {SOURCE}")
    exit(1)

# 复制插件文件
dest = os.path.join(DEST_DIR, os.path.basename(SOURCE))
os.makedirs(DEST_DIR, exist_ok=True)
shutil.copy2(SOURCE, dest)
print(f"已复制 {os.path.basename(SOURCE)} -> {DEST_DIR}")

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
