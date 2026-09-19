"""Patch factor_research.py to complete the class."""
import os

TARGET = os.path.join('D:', os.sep, 'pythonpro', '聚宽-local', 'scripts', 'factor_research.py')

with open(TARGET, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Keep lines 0-189 (first 190 lines)
prefix = ''.join(lines[:190])

# Read the replacement tail from factor_research_tail.txt (same dir)
tail_path = os.path.join(os.path.dirname(TARGET), 'factor_research_tail.py')
with open(tail_path, 'r', encoding='utf-8') as f:
    tail = f.read()

with open(TARGET, 'w', encoding='utf-8') as f:
    f.write(prefix + tail)

print(f'Patched {TARGET}')
print(f'  Prefix: {len(prefix)} chars, Tail: {len(tail)} chars')
