# -*- coding: utf-8 -*-
# 把 docs/project-docs/ 的项目文档镜像到本地 Obsidian 仓库
# 用法: python scripts/sync-docs-obsidian.py
# Obsidian 路径可用环境变量 OBSIDIAN_VAULT 覆盖
import os
import sys
import shutil

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(BASE_DIR, 'docs', 'project-docs')
VAULT = os.environ.get('OBSIDIAN_VAULT', 'C:/Users/he/Documents/Obsidian Vault')
DEST_DIR = os.path.join(VAULT, '量化回测平台')


def main():
    if not os.path.isdir(SRC_DIR):
        print('源目录不存在:', SRC_DIR)
        return 1
    os.makedirs(DEST_DIR, exist_ok=True)
    copied = 0
    for f in sorted(os.listdir(SRC_DIR)):
        if f.endswith('.md'):
            shutil.copy2(os.path.join(SRC_DIR, f), os.path.join(DEST_DIR, f))
            copied += 1
    print(f'已同步 {copied} 个文档到 Obsidian: {DEST_DIR}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
