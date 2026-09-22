"""
量化回测平台本地回测引擎
实现平台 API 子集（兼容主流量化策略语法），执行用户策略代码，使用本地 CSMAR 真实行情数据

支持的 API:
  - set_benchmark(code)
  - set_slippage(slippage)
  - set_order_cost(cost, type)
  - run_daily(fn, time) / run_weekly / run_monthly
  - attribute_history(stock, count, unit, fields)
  - get_price(security, end_date, count, frequency, fields, panel)
  - order_target_value(stock, value)
  - order_target(stock, amount)
  - order(stock, amount)
  - log.info/warn/error
  - context.portfolio (total_value, available_cash, positions, current_dt)
  - g (全局参数对象)

用法:
  python engine/backtest_engine.py --code <策略代码> --start 2023-01-01 --end 2023-12-29 --capital 1000000
"""
import sys
import os
import json
import sqlite3
import argparse
import traceback
from datetime import datetime, timedelta
from collections import defaultdict

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'stock_data.db')


def _force_utf8_stdio():
    """Windows 下被管道捕获时 stdout/stderr 默认按 locale（GBK）编码，
    导致 Electron 端按 UTF-8 解码出现乱码。这里统一强制为 UTF-8。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8')
        except Exception:
            pass


class Log:
    """平台 log 对象"""
    def __init__(self):
        self.entries = []

    def _log(self, level, msg):
        self.entries.append({
            'level': level,
            'message': str(msg),
        })

    def info(self, msg):
        self._log('info', msg)

    def warn(self, msg):
        self._log('warning', msg)

    def error(self, msg):
        self._log('error', msg)

    def debug(self, msg):
        self._log('debug', msg)


class Position:
    """持仓对象"""
    def __init__(self, stock, avg_cost, amount, price):
        self.stock = stock            # 股票代码
        self.avg_cost = avg_cost      # 持仓均价
        self.amount = amount          # 持仓数量
        self.price = price            # 当前价格
        self.value = amount * price   # 持仓市值
        self.total_amount = amount    # 总持仓量


class Portfolio:
    """投资组合"""
    def __init__(self, capital):
        self.total_value = capital          # 总资产
        self.available_cash = capital       # 可用现金
        self.positions_value = 0            # 持仓总市值
        self.positions = {}                 # {stock_code: Position}
        self.starting_cash = capital        # 初始资金
        self.returns = 0                    # 收益率

    def update_prices(self, prices):
        """根据最新价格更新持仓市值"""
        self.positions_value = 0
        for stock, pos in list(self.positions.items()):
            code = stock.split('.')[0]
            if code in prices:
                pos.price = prices[code]
            pos.value = pos.amount * pos.price
            self.positions_value += pos.value
        self.total_value = self.available_cash + self.positions_value
        self.returns = (self.total_value - self.starting_cash) / self.starting_cash if self.starting_cash > 0 else 0


class Context:
    """回测上下文"""
    def __init__(self, capital, start_date, end_date):
        self.portfolio = Portfolio(capital)
        self.current_dt = datetime.strptime(start_date, '%Y-%m-%d')
        self.previous_date = None
        self.start_date = start_date
        self.end_date = end_date
        self.run_count = 0


class Slippage:
    """滑点"""
    def __init__(self, value=0):
        self.value = value

    def apply(self, price, direction):
        """direction: 'buy' or 'sell'"""
        if direction == 'buy':
            return price * (1 + self.value)
        else:
            return price * (1 - self.value)


class OrderCost:
    """交易成本"""
    def __init__(self, close_tax=0.001, open_commission=0.0003,
                 close_commission=0.0003, min_commission=5):
        self.close_tax = close_tax
        self.open_commission = open_commission
        self.close_commission = close_commission
        self.min_commission = min_commission


class G:
    """全局参数对象（平台的 g）"""
    pass


class BacktestEngine:
    """量化回测平台本地回测引擎"""

    def __init__(self, start_date, end_date, capital=1000000, db_path=None):
        self.start_date = start_date
        self.end_date = end_date
        self.capital = capital
        self.conn = sqlite3.connect(db_path or DB_PATH)
        self.conn.row_factory = sqlite3.Row

        # 引擎状态
        self.log = Log()
        self.context = Context(capital, start_date, end_date)
        self.slippage = Slippage(0)
        self.order_cost = OrderCost()
        self.benchmark_code = '000300'
        self.scheduled_tasks = []  # [(fn, freq, time/weekday/monthday)]
        self.g = G()
        self.trades = []
        self.daily_records = []
        self.positions_snapshots = []
        self.benchmark_records = []
        self._bench_fallback = None
        self._bench_use_index = True
        self._prev_bench_price = None  # 基准前向填充用：缺失日沿用前一有效值

        # 行情缓存：{stock_code: {date: {close, open, ...}}}
        self._price_cache = {}
        # 交易日列表
        self._trade_days = None

        # 平台API环境
        self.env = {}

    # ==================== 行情数据 ====================

    def get_trade_days(self):
        """获取回测区间内的交易日"""
        if self._trade_days is None:
            rows = self.conn.execute(
                'SELECT trade_date FROM trade_calendar '
                'WHERE is_trading_day=1 AND trade_date >= ? AND trade_date <= ? '
                'ORDER BY trade_date', (self.start_date, self.end_date)
            ).fetchall()
            self._trade_days = [r['trade_date'] for r in rows]
        return self._trade_days

    def load_stock_data(self, stock_code, start_date=None, end_date=None):
        """加载单只股票或场内基金的本地日线到缓存"""
        code = stock_code.split('.')[0]
        if code in self._price_cache:
            return self._price_cache[code]

        sd = start_date or self.start_date
        ed = end_date or self.end_date
        data = {}
        if self._is_fund(code):
            rows = self.conn.execute(
                'SELECT trade_date, open, high, low, close, volume, amount '
                'FROM fund_daily WHERE fund_code=? AND trade_date>=? AND trade_date<=? '
                'ORDER BY trade_date', (code, sd, ed)
            ).fetchall()
            previous_close = None
            for r in rows:
                close = float(r['close'] or 0)
                change = close / previous_close - 1 if previous_close and previous_close > 0 else 0.0
                data[r['trade_date']] = {
                    'open': float(r['open'] or close), 'close': close,
                    'pre_close': previous_close or close, 'volume': r['volume'] or 0,
                    'amount': r['amount'] or 0, 'dretwd': change, 'adj_close_wd': close,
                }
                previous_close = close
        else:
            rows = self.conn.execute(
                'SELECT trade_date, open_price, close_price, pre_close_price, '
                'volume, amount, dretwd, adj_close_wd '
                'FROM stock_daily WHERE stock_code=? AND trade_date>=? AND trade_date<=? '
                'ORDER BY trade_date', (code, sd, ed)
            ).fetchall()
            for r in rows:
                data[r['trade_date']] = {
                    'open': r['open_price'], 'close': r['close_price'],
                    'pre_close': r['pre_close_price'], 'volume': r['volume'], 'amount': r['amount'],
                    'dretwd': r['dretwd'], 'adj_close_wd': r['adj_close_wd'],
                }
        self._price_cache[code] = data
        return data

    @staticmethod
    def _is_fund(code):
        return code.isdigit() and len(code) == 6 and code.startswith(('15', '16', '50', '51', '52', '56', '58'))

    def get_price_on_date(self, stock_code, date):
        """获取某只股票某日的价格"""
        code = stock_code.split('.')[0]
        data = self._price_cache.get(code, {})
        if date in data:
            return data[date]['close']
        # 尝试从数据库加载
        if code not in self._price_cache:
            self.load_stock_data(stock_code)
            data = self._price_cache.get(code, {})
            if date in data:
                return data[date]['close']
        return None

    def get_index_price_on_date(self, index_code, date):
        """从 index_daily 表查询指数某日的收盘点数"""
        code = index_code.split('.')[0]
        row = self.conn.execute(
            'SELECT close_index FROM index_daily WHERE index_code=? AND trade_date=?',
            (code, date)
        ).fetchone()
        return float(row['close_index']) if row and row['close_index'] else None

    # ==================== 平台 API 实现 ====================

    def api_set_benchmark(self, code):
        """设置基准"""
        self.benchmark_code = code.split('.')[0]
        self.log.info(f'设置基准: {code}')

    def api_set_slippage(self, slippage):
        """设置滑点"""
        if hasattr(slippage, 'value'):
            self.slippage = slippage
        self.log.info(f'设置滑点: {self.slippage.value}')

    def api_set_order_cost(self, cost, type='stock'):
        """设置交易成本"""
        self.order_cost = cost
        self.log.info(f'设置交易成本: 佣金={cost.open_commission}, 印花税={cost.close_tax}')

    def api_attribute_history(self, stock, count, unit='1d', fields=('close',)):
        """获取历史行情数据"""
        code = stock.split('.')[0]
        if code not in self._price_cache:
            self.load_stock_data(stock)

        data = self._price_cache.get(code, {})
        current_date = self.context.current_dt.strftime('%Y-%m-%d')

        # 获取当前日期及之前的历史数据
        dates_sorted = sorted([d for d in data.keys() if d <= current_date])
        if len(dates_sorted) < count:
            count = len(dates_sorted)
        recent_dates = dates_sorted[-count:] if count > 0 else []

        # 构造返回的 DataFrame-like 对象
        result = {}
        if isinstance(fields, str):
            fields = (fields,)
        for field in fields:
            field_map = {
                'close': 'close', 'open': 'open', 'volume': 'volume',
                'high': 'close', 'low': 'close',  # CSMAR核心字段无高低价映射，用close近似
            }
            db_field = field_map.get(field, field)
            result[field] = [data[d][db_field] for d in recent_dates if d in data]

        # 返回类似DataFrame的对象（支持 [-n:] 和 .mean()）
        return SeriesDict(result)

    def api_get_price(self, security, end_date=None, count=20, frequency='daily',
                      fields=['close'], panel=True):
        """批量获取价格数据"""
        if end_date is None:
            end_date = self.context.current_dt.strftime('%Y-%m-%d')

        if isinstance(security, str):
            security = [security]

        result = {}
        for stock in security:
            code = stock.split('.')[0]
            if code not in self._price_cache:
                self.load_stock_data(stock)
            data = self._price_cache.get(code, {})
            dates_sorted = sorted([d for d in data.keys() if d <= end_date])
            recent_dates = dates_sorted[-count:] if count <= len(dates_sorted) else dates_sorted
            result[stock] = {
                'close': [data[d]['close'] for d in recent_dates if d in data],
                'dates': recent_dates,
            }
        return result

    # ==================== 下单 API ====================

    def api_order_target_value(self, stock, value):
        """按目标金额调仓"""
        code = stock.split('.')[0]
        current_date = self.context.current_dt.strftime('%Y-%m-%d')
        price = self.get_price_on_date(stock, current_date)

        if price is None or price <= 0:
            self.log.warn(f'{stock} 无行情数据，跳过下单')
            return None

        current_pos = self.context.portfolio.positions.get(stock)
        current_value = current_pos.value if current_pos else 0

        # 计算需要的调整量
        diff_value = value - current_value
        if abs(diff_value) < 1:
            return None

        if diff_value > 0:
            # 买入
            buy_price = self.slippage.apply(price, 'buy')
            amount = int(diff_value / buy_price / 100) * 100  # 整百手
            if amount <= 0:
                return None
            cost = buy_price * amount
            commission = max(cost * self.order_cost.open_commission, self.order_cost.min_commission)

            if cost + commission > self.context.portfolio.available_cash:
                # 资金不足，减少买入量
                affordable = int((self.context.portfolio.available_cash - commission) / buy_price / 100) * 100
                if affordable <= 0:
                    self.log.warn(f'{stock} 资金不足，跳过买入')
                    return None
                amount = affordable
                cost = buy_price * amount
                commission = max(cost * self.order_cost.open_commission, self.order_cost.min_commission)

            self.context.portfolio.available_cash -= (cost + commission)

            if current_pos:
                new_total = current_pos.amount + amount
                new_avg = (current_pos.avg_cost * current_pos.amount + buy_price * amount) / new_total
                current_pos.amount = new_total
                current_pos.avg_cost = new_avg
            else:
                self.context.portfolio.positions[stock] = Position(stock, buy_price, amount, price)

            self.trades.append({
                'date': current_date, 'time': '09:30:00',
                'stock': stock, 'stockName': stock,
                'direction': 'buy', 'price': round(buy_price, 3),
                'volume': amount, 'amount': round(cost, 2),
                'commission': round(commission, 2), 'tax': 0,
                'profit': 0,
            })
            return amount

        else:
            # 卖出
            if not current_pos or current_pos.amount <= 0:
                return None
            sell_amount = min(current_pos.amount, int(abs(diff_value) / price / 100) * 100)
            if value == 0:
                sell_amount = current_pos.amount  # 清仓

            sell_price = self.slippage.apply(price, 'sell')
            revenue = sell_price * sell_amount
            commission = max(revenue * self.order_cost.close_commission, self.order_cost.min_commission)
            tax = 0 if self._is_fund(code) else revenue * self.order_cost.close_tax

            self.context.portfolio.available_cash += (revenue - commission - tax)
            profit = (sell_price - current_pos.avg_cost) * sell_amount

            current_pos.amount -= sell_amount
            if current_pos.amount <= 0:
                del self.context.portfolio.positions[stock]

            self.trades.append({
                'date': current_date, 'time': '09:30:00',
                'stock': stock, 'stockName': stock,
                'direction': 'sell', 'price': round(sell_price, 3),
                'volume': sell_amount, 'amount': round(revenue, 2),
                'commission': round(commission, 2), 'tax': round(tax, 2),
                'profit': round(profit, 2),
            })
            return -sell_amount

    def api_order_target(self, stock, target_amount):
        """按目标股数调仓"""
        if target_amount == 0:
            return self.api_order_target_value(stock, 0)
        current_date = self.context.current_dt.strftime('%Y-%m-%d')
        price = self.get_price_on_date(stock, current_date)
        if price:
            return self.api_order_target_value(stock, target_amount * price)
        return None

    def api_order(self, stock, amount):
        """按指定数量下单"""
        if amount > 0:
            current_date = self.context.current_dt.strftime('%Y-%m-%d')
            price = self.get_price_on_date(stock, current_date)
            if price:
                return self.api_order_target_value(stock, amount * price)
        elif amount < 0:
            current_pos = self.context.portfolio.positions.get(stock)
            if current_pos:
                sell_amount = min(current_pos.amount, abs(amount))
                return self.api_order_target(stock, current_pos.amount - sell_amount)
        return None

    # ==================== 调度函数 ====================

    def api_run_daily(self, fn, time='09:30'):
        self.scheduled_tasks.append(('daily', fn, time))

    def api_run_weekly(self, fn, weekday=1, time='09:30'):
        self.scheduled_tasks.append(('weekly', fn, (weekday, time)))

    def api_run_monthly(self, fn, monthday=1, time='09:30'):
        self.scheduled_tasks.append(('monthly', fn, (monthday, time)))

    # ==================== 策略执行 ====================

    def run(self, code_str):
        """执行策略代码"""
        # 构造平台 API 环境
        env = {
            'set_benchmark': self.api_set_benchmark,
            'set_slippage': self.api_set_slippage,
            'set_order_cost': self.api_set_order_cost,
            'attribute_history': self.api_attribute_history,
            'get_price': self.api_get_price,
            'order_target_value': self.api_order_target_value,
            'order_target': self.api_order_target,
            'order': self.api_order,
            'run_daily': self.api_run_daily,
            'run_weekly': self.api_run_weekly,
            'run_monthly': self.api_run_monthly,
            'log': self.log,
            'g': self.g,
            'FixedSlippage': lambda v: Slippage(v),
            'OrderCost': lambda close_tax=0.001, open_commission=0.0003,
                          close_commission=0.0003, min_commission=5: OrderCost(
                              close_tax, open_commission, close_commission, min_commission),
        }

        # 执行策略代码（定义函数）
        exec_env = {'__builtins__': __builtins__}
        exec_env.update(env)
        try:
            exec(code_str, exec_env)
        except Exception as e:
            return self._fail(f'策略代码执行错误: {e}\n{traceback.format_exc()}')

        # 检查必要函数
        if 'initialize' not in exec_env:
            return self._fail('策略代码缺少 initialize 函数')

        # 1. 执行 initialize
        try:
            exec_env['initialize'](self.context)
        except Exception as e:
            return self._fail(f'initialize 执行错误: {e}\n{traceback.format_exc()}')

        # 2. 获取交易日
        trade_days = self.get_trade_days()
        if not trade_days:
            return self._fail(f'回测区间 {self.start_date}~{self.end_date} 无交易日数据')

        # 预加载策略涉及的股票数据
        self._preload_stock_data()

        # 3. 逐日执行
        prev_date = None
        for date_str in trade_days:
            self.context.current_dt = datetime.strptime(date_str, '%Y-%m-%d')
            self.context.previous_date = prev_date
            self.context.run_count += 1

            # 更新持仓价格
            prices = {}
            for stock in list(self.context.portfolio.positions.keys()):
                code = stock.split('.')[0]
                p = self.get_price_on_date(stock, date_str)
                if p:
                    prices[code] = p
            self.context.portfolio.update_prices(prices)

            # 执行调度任务
            for task in self.scheduled_tasks:
                freq, fn, param = task
                should_run = False
                if freq == 'daily':
                    should_run = True
                elif freq == 'weekly':
                    weekday = param[0]
                    should_run = self.context.current_dt.isoweekday() == weekday
                elif freq == 'monthly':
                    monthday = param[0]
                    should_run = self.context.current_dt.day == monthday or (
                        date_str == trade_days[-1]  # 月末

                    )

                if should_run:
                    try:
                        fn(self.context)
                    except Exception as e:
                        self.log.error(f'调度函数执行错误: {e}')
                        self.log.error(traceback.format_exc())

            # 执行 after_trading_end（如果定义了）
            if 'after_trading_end' in exec_env:
                try:
                    exec_env['after_trading_end'](self.context)
                except Exception as e:
                    self.log.error(f'after_trading_end 错误: {e}')

            # 记录每日数据
            daily_return = 0
            if prev_date and self.daily_records:
                prev_total = self.daily_records[-1]['total_assets']
                if prev_total > 0:
                    daily_return = (self.context.portfolio.total_value - prev_total) / prev_total

            cum_return = (self.context.portfolio.total_value - self.capital) / self.capital

            self.daily_records.append({
                'date': date_str,
                'daily_return': round(daily_return, 6),
                'cumulative_return': round(cum_return, 6),
                'total_assets': round(self.context.portfolio.total_value, 2),
                'available_cash': round(self.context.portfolio.available_cash, 2),
                'position_value': round(self.context.portfolio.positions_value, 2),
            })

            # 基准数据：优先查指数表；仅当基准在整个区间都无数据时才回退到其他标的
            # 单日缺失（如尾部数据未更新）用前一有效值前向填充，避免错误切换到个股导致基准突变
            bench_price = self.get_index_price_on_date(self.benchmark_code, date_str)
            if bench_price is None:
                # 指数表当日无数据
                if self._bench_fallback is None and self._prev_bench_price is None:
                    # 区间内尚无任何有效基准数据 → 尝试回退到其他指数/个股（仅初始化一次）
                    bench_price = self.get_price_on_date(f'{self.benchmark_code}.XSHG', date_str)
                    if bench_price is None:
                        bench_price = self.get_price_on_date(f'{self.benchmark_code}.XSHE', date_str)
                    if bench_price is None:
                        # 回退到其他指数
                        for fb in ['000016', '000905']:
                            fb_price = self.get_index_price_on_date(fb, date_str)
                            if fb_price is not None:
                                self._bench_fallback = fb
                                self._bench_use_index = True
                                self.log.warn(f'基准 {self.benchmark_code} 无数据，回退到指数 {fb}')
                                bench_price = fb_price
                                break
                        if bench_price is None and hasattr(self.g, 'stocks') and self.g.stocks:
                            self._bench_fallback = self.g.stocks[0].split('.')[0]
                            self._bench_use_index = False
                            self.log.warn(f'基准 {self.benchmark_code} 无数据，回退到策略股票 {self._bench_fallback}')
                elif self._bench_fallback is not None:
                    # 已确定回退标的，继续用该标的取价
                    if self._bench_use_index:
                        bench_price = self.get_index_price_on_date(self._bench_fallback, date_str)
                    else:
                        bench_price = self.get_price_on_date(f'{self._bench_fallback}.XSHG', date_str)
                        if bench_price is None:
                            bench_price = self.get_price_on_date(f'{self._bench_fallback}.XSHE', date_str)
                # 仍为空则前向填充：沿用上一有效基准价，保证基准序列连续
                if bench_price is None and self._prev_bench_price is not None:
                    bench_price = self._prev_bench_price
            # 记录前值（仅在有有效价格时更新）
            if bench_price is not None:
                self._prev_bench_price = bench_price
            self.benchmark_records.append({
                'date': date_str,
                'bench_price': bench_price,
            })

            # 每日记录持仓快照（无持仓时也记录空状态，便于与交易表对齐）
            for stock, pos in self.context.portfolio.positions.items():
                self.positions_snapshots.append({
                    'date': date_str,
                    'stock': stock,
                    'stockName': stock,
                    'volume': pos.amount,
                    'price': round(pos.price, 3),
                    'cost': round(pos.avg_cost, 3),
                    'marketValue': round(pos.value, 2),
                    'profit': round((pos.price - pos.avg_cost) * pos.amount, 2),
                    'profitRate': round((pos.price - pos.avg_cost) / pos.avg_cost, 6) if pos.avg_cost > 0 else 0,
                    'weight': round(pos.value / self.context.portfolio.total_value, 4) if self.context.portfolio.total_value > 0 else 0,
                })

            prev_date = date_str

        # 4. 计算回测指标
        return self._calculate_metrics()

    def _preload_stock_data(self):
        """预加载策略涉及的股票数据"""
        stocks_to_load = set()
        # 从 g 对象获取股票池
        if hasattr(self.g, 'stocks'):
            for s in self.g.stocks:
                stocks_to_load.add(s)
        # 加载基准
        stocks_to_load.add(f'{self.benchmark_code}.XSHG')
        stocks_to_load.add(f'{self.benchmark_code}.XSHE')
        # 已有持仓
        for s in self.context.portfolio.positions:
            stocks_to_load.add(s)

        self.log.info(f'预加载 {len(stocks_to_load)} 只股票数据')
        for stock in stocks_to_load:
            self.load_stock_data(stock)

    def _calculate_metrics(self):
        """计算回测指标"""
        if not self.daily_records:
            return self._fail('无回测数据')

        # 总收益
        final = self.daily_records[-1]
        total_returns = final['cumulative_return']

        # 年化收益
        N = len(self.daily_records)
        years = N / 252
        if years > 0 and total_returns > -1:
            annual_returns = (1 + total_returns) ** (1 / years) - 1
        else:
            annual_returns = 0

        # 波动率
        returns = [r['daily_return'] for r in self.daily_records if r['daily_return'] != 0]
        if len(returns) > 1:
            mean_ret = sum(returns) / len(returns)
            var = sum((r - mean_ret) ** 2 for r in returns) / (len(returns) - 1)
            volatility = (var * 252) ** 0.5
        else:
            volatility = 0

        # 最大回撤
        peak = 0
        max_dd = 0
        for r in self.daily_records:
            peak = max(peak, r['cumulative_return'])
            dd = r['cumulative_return'] - peak
            max_dd = min(max_dd, dd)

        # 夏普比率
        sharpe = (annual_returns - 0.03) / volatility if volatility > 0 else 0

        # ===== 基准指标 =====
        bench_data = [r for r in self.benchmark_records if r['bench_price'] is not None]
        bench_total = 0
        if len(bench_data) >= 2:
            first_price = bench_data[0]['bench_price']
            last_price = bench_data[-1]['bench_price']
            if first_price > 0:
                bench_total = last_price / first_price - 1

        # 基准日收益：首日补 0，使其与 daily_records 长度对齐（避免尾部超额收益为 0）
        bench_daily_returns = [0.0]
        for i in range(1, len(bench_data)):
            prev_p = bench_data[i - 1]['bench_price']
            curr_p = bench_data[i]['bench_price']
            if prev_p > 0:
                bench_daily_returns.append(curr_p / prev_p - 1)
            else:
                bench_daily_returns.append(0.0)
        # 末尾对齐到策略交易日数
        while len(bench_daily_returns) < N:
            bench_daily_returns.append(0.0)

        # 基准年化收益
        bench_annual = (1 + bench_total) ** (1 / years) - 1 if years > 0 and bench_total > -1 else 0

        # 基准波动率
        if len(bench_daily_returns) > 1:
            bm_mean = sum(bench_daily_returns) / len(bench_daily_returns)
            bm_var = sum((r - bm_mean) ** 2 for r in bench_daily_returns) / (len(bench_daily_returns) - 1)
            bench_vol = (bm_var * 252) ** 0.5
        else:
            bench_vol = 0

        # 基准最大回撤（基于基准累计收益序列）
        bench_cum = 0.0
        bench_peak = 0.0
        bench_max_dd = 0.0
        for br in bench_daily_returns:
            bench_cum = (1 + bench_cum) * (1 + br) - 1
            bench_peak = max(bench_peak, bench_cum)
            bench_max_dd = min(bench_max_dd, bench_cum - bench_peak)

        # ===== 超额收益（按日对齐）=====
        excess_returns = []
        for i, r in enumerate(self.daily_records):
            br = bench_daily_returns[i] if i < len(bench_daily_returns) else 0
            excess_returns.append(round(r['daily_return'] - br, 6))

        # ===== Alpha / Beta（CAPM：策略日收益对基准日收益回归）=====
        strat_rets = [r['daily_return'] for r in self.daily_records]
        n_align = min(len(strat_rets), len(bench_daily_returns))
        if n_align > 2:
            sp = strat_rets[:n_align]
            bp = bench_daily_returns[:n_align]
            mean_s = sum(sp) / n_align
            mean_b = sum(bp) / n_align
            cov = sum((sp[i] - mean_s) * (bp[i] - mean_b) for i in range(n_align)) / (n_align - 1)
            var_b = sum((b - mean_b) ** 2 for b in bp) / (n_align - 1)
            beta = cov / var_b if var_b > 0 else 0
            alpha = (mean_s - beta * mean_b) * 252  # 日 alpha 年化
        else:
            beta = 0
            alpha = 0

        # ===== 信息比率（超额收益均值/标准差 * sqrt(252)）=====
        if len(excess_returns) > 1:
            er = excess_returns
            er_mean = sum(er) / len(er)
            er_var = sum((x - er_mean) ** 2 for x in er) / (len(er) - 1)
            er_std = er_var ** 0.5
            info_ratio = (er_mean / er_std) * (252 ** 0.5) if er_std > 0 else 0
        else:
            info_ratio = 0

        # ===== 胜率（盈利卖出笔数 / 总卖出笔数）=====
        sells = [t for t in self.trades if t.get('direction') == 'sell']
        if sells:
            wins = sum(1 for t in sells if t.get('profit', 0) > 0)
            win_rate = wins / len(sells)
        else:
            win_rate = 0

        return {
            'code': 0,
            'data': {
                'tradingDays': N,
                'totalReturns': round(total_returns, 6),
                'annualReturns': round(annual_returns, 6),
                'maxDrawdown': round(max_dd, 6),
                'sharpe': round(sharpe, 4),
                'volatility': round(volatility, 6),
                'alpha': round(alpha, 4),
                'beta': round(beta, 4),
                'informationRatio': round(info_ratio, 4),
                'winRate': round(win_rate, 4),
                'tradesCount': len(self.trades),
                'positionsCount': len(self.positions_snapshots),
                'benchmarkTotalReturns': round(bench_total, 6),
                'benchmarkAnnualReturns': round(bench_annual, 6),
                'benchmarkMaxDrawdown': round(bench_max_dd, 6),
                'benchmarkVolatility': round(bench_vol, 6),
            },
            'dailyRecords': self.daily_records,
            'trades': self.trades,
            'positions': self.positions_snapshots,
            'logs': self.log.entries,
            'benchmark': {
                'dates': [r['date'] for r in self.benchmark_records],
                'dailyReturns': [round(r, 6) for r in bench_daily_returns],
                'excessReturns': excess_returns,
            },
            'message': '回测完成',
        }

    def _fail(self, msg):
        return {
            'code': -1,
            'message': msg,
            'data': None,
        }


class SeriesDict:
    """模拟 pandas DataFrame 的简单对象，支持 [-n:] 和 .mean()"""

    def __init__(self, data):
        # 统一存储为 Series，确保 hist['close'] 和 hist.close 都返回 Series
        self._data = {}
        for key, val in data.items():
            s = val if isinstance(val, Series) else Series(val)
            self._data[key] = s
            setattr(self, key, s)

    def __getitem__(self, key):
        if isinstance(key, slice):
            return SeriesDict({k: v[key] for k, v in self._data.items()})
        return self._data.get(key, Series([]))

    def __len__(self):
        return len(next(iter(self._data.values()))) if self._data else 0


class Series:
    """模拟 pandas Series"""

    def __init__(self, data):
        self._data = list(data)

    def __getitem__(self, key):
        if isinstance(key, slice):
            return Series(self._data[key])
        return self._data[key]

    def mean(self):
        return sum(self._data) / len(self._data) if self._data else 0

    def __len__(self):
        return len(self._data)

    def __iter__(self):
        return iter(self._data)


def main():
    _force_utf8_stdio()
    parser = argparse.ArgumentParser(description='量化回测平台本地回测引擎')
    parser.add_argument('--code', required=True, help='策略代码')
    parser.add_argument('--start', required=True, help='开始日期 YYYY-MM-DD')
    parser.add_argument('--end', required=True, help='结束日期 YYYY-MM-DD')
    parser.add_argument('--capital', type=float, default=1000000, help='初始资金')
    parser.add_argument('--db', default=None, help='行情数据库路径（默认 data/stock_data.db）')
    args = parser.parse_args()

    engine = BacktestEngine(args.start, args.end, args.capital, args.db)
    result = engine.run(args.code)
    print(json.dumps(result, ensure_ascii=False, default=str))


if __name__ == '__main__':
    main()
