# Tail generator - complete
D = chr(34)
lines = []
def add(s):
    lines.append(s)

# ---- correlation_analysis (completed) ----
add("")
add("    # ------------------------------------------------------------------")
add("    # fenxi: yinzi xiangguanxing")
add("    # ------------------------------------------------------------------")
add("    def correlation_analysis(self, min_codes=30):")
doc = D + D + D + "jisuan yinzi jian jiemian Spearman zhi xiangguan" + D + D + D
add("        " + doc)
print("part1 done, writing")
with open("factor_research_tail_p1.py", "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("wrote p1")
