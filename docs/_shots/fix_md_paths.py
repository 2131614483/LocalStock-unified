import pathlib, re
p = pathlib.Path(r'D:\pythonpro\LocalStock-unified\docs\项目介绍.md')
s = p.read_text(encoding='utf-8')
# 把 (_shots/xxx.png) 替换为绝对 file:/// 路径
def repl(m):
    name = m.group(1)
    return f'(file:///D:/pythonpro/LocalStock-unified/docs/_shots/{name})'
s2 = re.sub(r'\(_shots/([^)]+\.png)\)', repl, s)
p.write_text(s2, encoding='utf-8')
print('replaced', s.count('(_shots/'), 'occurrences')
