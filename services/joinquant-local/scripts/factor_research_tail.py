
    # ------------------------------------------------------------------
    # 分析：因子相关性
    # ------------------------------------------------------------------
    def correlation_analysis(self, min_codes=30):
        """计算因子间截面 Spearman 秩相关（每月计算后取均值）。"""
        df = self.panel
        n = len(self.factors)
        cors = pd.DataFrame(np.eye(n), index=self.factors, columns=self.factors, dtype=float)
        for i, f1 in enumerate(self.factors):
            for j, f2 in enumerate(self.factors):
                if i >= j:
                    continue
                vals = []
                for d, g in df.groupby("trade_date"):
                    v = g[[f1, f2]].dropna()
                    if len(v) >= min_codes: