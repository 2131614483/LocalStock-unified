# Complete tail generator for factor_research.py
# This script generates the tail content that replaces from _probe to EOF
import os

Q = chr(34)  # double quote
NL = chr(10) # newline
TB = '    '  # 4-space indent

def make_tail():
    L = []
    def A(*args):
        for s in args:
            L.append(str(s))

    # --- correlation_analysis (completed) ---
    A('')
    A('# ------------------------------------------------------------------')
    A('# fenxi: yinzi xiangguanxing')
    A('# ------------------------------------------------------------------')
    A('def correlation_analysis(self, min_codes=30):')
    A(TB, Q*3, 'jisuan yinzi jian jiemian Spearman zhi xiangguan (meiyue jisuan hou qu junzhi).', Q*3)
    A(TB, 'df = self.panel')
    A(TB, 'n = len(self.factors)')
    A(TB, 'cors = pd.DataFrame(np.eye(n), index=self.factors, columns=self.factors, dtype=float)')
    A(TB, 'for i, f1 in enumerate(self.factors):')
    A(TB*2, 'for j, f2 in enumerate(self.factors):')
    A(TB*3, 'if i >= j:')
    A(TB*4, 'continue')
    A(TB*3, 'vals = []')
    A(TB*3, 'for d, g in df.groupby(', Q, 'trade_date', Q, '):')
    A(TB*4, 'v = g[[f1, f2]].dropna()')
    A(TB*4, 'if len(v) >= min_codes:')

    return NL.join(L)

tail = make_tail()
print(tail)
print('---')
print('Total lines:', tail.count(NL) + 1)
