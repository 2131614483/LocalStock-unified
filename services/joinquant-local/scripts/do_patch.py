# Patch factor_research.py to complete the class
# This script reads the file, truncates at _probe, and appends the completed tail.
import os

TARGET = os.path.join(os.path.dirname(__file__), 'factor_research.py')

with open(TARGET, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Keep first 190 lines (0..189)
prefix = ''.join(lines[:190])

# Now build the tail. Using chr() for all quotes to avoid any escaping issues
Q = chr(34)  # double quote "
S = chr(39)  # single quote '

tail_lines = [
'',
'    # ------------------------------------------------------------------',
'    # fenxi: yinzi xiangguanxing',
'    # ------------------------------------------------------------------',
'    def correlation_analysis(self, min_codes=30):',
'        ' + Q*3 + 'jisuan yinzi jian jiemian Spearman zhi xiangguan (meiyue jisuan hou qu junzhi).' + Q*3,
'        df = self.panel',
'        n = len(self.factors)',
'        cors = pd.DataFrame(np.eye(n), index=self.factors, columns=self.factors, dtype=float)',
'        for i, f1 in enumerate(self.factors):',
'            for j, f2 in enumerate(self.factors):',
'                if i >= j:',
'                    continue',
'                vals = []',
'                for d, g in df.groupby(' + Q + 'trade_date' + Q + '):',
'                    v = g[[f1, f2]].dropna()',
'                    if len(v) >= min_codes:',
]

print('Tail part 1: built', len(tail_lines), 'lines')
# Save for inspection
with open(os.path.join(os.path.dirname(__file__), 'tail_p1.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(tail_lines))
print('Done')
