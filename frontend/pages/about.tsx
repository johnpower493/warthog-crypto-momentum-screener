import { useState } from 'react';

export default function About() {
  const [expandedSection, setExpandedSection] = useState<string | null>('overview');

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <a href="/" className="button">← Back to Screener</a>
        <h1 style={{ margin: 0, flex: 1 }}>About Warthog Crypto Screener</h1>
        <span style={{ fontSize: '12px', color: '#7d8aa5', padding: '4px 8px', background: '#111823', border: '1px solid #1f2a37', borderRadius: 4 }}>v2.0</span>
      </div>
      
      {/* Quick Navigation */}
      <div style={{ marginBottom: '20px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {['overview', 'howto', 'terms', 'indicators', 'orderflow', 'marketdata', 'faq', 'troubleshooting', 'tips', 'technical'].map(section => (
          <button
            key={section}
            onClick={() => setExpandedSection(section)}
            style={{
              padding: '6px 12px',
              background: expandedSection === section ? '#4cc9f0' : 'linear-gradient(180deg, #1b2635, #111826)',
              border: `1px solid ${expandedSection === section ? '#4cc9f0' : '#1f2a37'}`,
              borderRadius: 8,
              color: expandedSection === section ? '#0b0f14' : '#e6edf3',
              fontSize: '12px',
              cursor: 'pointer',
              fontWeight: expandedSection === section ? 600 : 400
            }}
          >
            {section === 'overview' ? '📋 Overview' :
             section === 'howto' ? '🚀 How to Use' :
             section === 'terms' ? '📖 Glossary' :
             section === 'indicators' ? '📊 Indicators' :
             section === 'orderflow' ? '📈 Order Flow' :
             section === 'marketdata' ? '💹 Market Data' :
             section === 'faq' ? '❓ FAQ' :
             section === 'troubleshooting' ? '🔧 Troubleshooting' :
             section === 'tips' ? '💡 Tips' :
             section === 'technical' ? '⚙️ Technical' : section}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gap: '20px' }}>
        {/* Overview Section */}
        <Section title="📋 Overview" expanded={expandedSection === 'overview'} onToggle={() => toggleSection('overview')}>
          <p>
            Warthog is a professional-grade cryptocurrency trading platform that combines real-time market data, 
            advanced technical indicators, and institutional-level order flow analysis. It monitors multiple exchanges 
            (Binance, Bybit) and provides actionable insights for both scalping and swing trading.
          </p>
          
          <h3>🎯 Core Features</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '15px' }}>
            <FeatureCard 
              icon="⚡" 
              title="Real-time Screener" 
              description="Sub-second WebSocket updates for 400+ symbols across Binance & Bybit perpetual futures"
            />
            <FeatureCard 
              icon="📊" 
              title="Order Flow Analysis" 
              description="Footprint charts, bid/ask imbalances, CVD tracking, and real-time order book wall detection"
            />
            <FeatureCard 
              icon="💧" 
              title="Liquidation Heatmap" 
              description="Real-time liquidation tracking with price level clustering to identify potential squeeze zones"
            />
            <FeatureCard 
              icon="📈" 
              title="Long/Short Ratio" 
              description="Live sentiment data showing the balance between long and short positions"
            />
            <FeatureCard 
              icon="🛡️" 
              title="Support/Resistance Walls" 
              description="Automated detection of large resting orders from the live order book"
            />
            <FeatureCard 
              icon="🔔" 
              title="Smart Alerts" 
              description="Telegram/Discord notifications for high-probability Cipher B signals"
            />
            <FeatureCard 
              icon="📝" 
              title="Trade Planning" 
              description="Auto-generated entry, stop-loss, and take-profit levels based on ATR"
            />
            <FeatureCard 
              icon="📰" 
              title="News Integration" 
              description="Real-time crypto news feed with symbol-specific filtering"
            />
            <FeatureCard 
              icon="💼" 
              title="Portfolio Tracking" 
              description="Track your positions with real-time P&L calculations"
            />
          </div>

          <h3 style={{ marginTop: '20px' }}>🏆 What Makes Warthog Different</h3>
          <ul>
            <li><strong>Institutional-level data:</strong> Order flow, liquidations, and order book analysis typically only available in expensive platforms</li>
            <li><strong>Real-time everything:</strong> All data streams via WebSocket - no polling or delays</li>
            <li><strong>Multi-exchange:</strong> Compare the same pairs across Binance and Bybit</li>
            <li><strong>Self-hosted:</strong> Your data, your privacy, no subscription fees</li>
            <li><strong>Fully customizable:</strong> Open source with configurable thresholds and filters</li>
          </ul>
        </Section>

        {/* How to Use Section */}
        <Section title="🚀 How to Use" expanded={expandedSection === 'howto'} onToggle={() => toggleSection('howto')}>
          <h3>📊 Main Screener</h3>
          <ol>
            <li><strong>Quick Filters:</strong> Use preset buttons (Gainers 5m, Losers 5m, Volatile, High Signal, Cipher Buy/Sell, etc.) to quickly narrow down opportunities</li>
            <li><strong>Search:</strong> Type a symbol name to find specific coins (e.g., "BTC", "ETH")</li>
            <li><strong>Sort:</strong> Click any column header to sort - click again to reverse</li>
            <li><strong>Favorites:</strong> Click the star (⭐) to add symbols to your watchlist, then use "Favorites" filter to view only starred symbols</li>
            <li><strong>Exchange Toggle:</strong> Switch between Binance and Bybit, or view both simultaneously</li>
            <li><strong>Columns:</strong> Use the ⚙️ button to customize which metrics are displayed</li>
          </ol>

          <h3>🔍 Symbol Details Modal</h3>
          <p>Click any row to open the detailed analysis modal with five tabs:</p>
          
          <div style={{ marginLeft: '20px', marginBottom: '15px' }}>
            <h4 style={{ color: '#4cc9f0', marginBottom: '8px' }}>Overview Tab</h4>
            <ul>
              <li>Price chart with 15-minute candles and key levels</li>
              <li>Open interest trend chart</li>
              <li>Funding rate with annualized percentage</li>
              <li><strong>Long/Short Ratio:</strong> Visual bar showing market sentiment</li>
              <li><strong>Liquidation Heatmap:</strong> Real-time liquidations at price levels (shows where traders are getting liquidated)</li>
            </ul>
            
            <h4 style={{ color: '#4cc9f0', marginBottom: '8px' }}>Trade Plan Tab</h4>
            <ul>
              <li>Auto-generated entry, stop-loss (SL), and take-profit (TP) levels</li>
              <li><strong>Order Book Walls:</strong> Real-time detection of large resting buy/sell orders</li>
              <li><strong>Swing Trading Zones:</strong> Clustered support/resistance levels within 10% of price</li>
              <li><strong>Order Flow Footprint:</strong> Bid/ask volume at each price level with imbalance highlighting</li>
              <li><strong>CVD (Cumulative Volume Delta):</strong> Running total of buying vs selling pressure</li>
              <li>30-day and 90-day backtesting results</li>
            </ul>
            
            <h4 style={{ color: '#4cc9f0', marginBottom: '8px' }}>News Tab</h4>
            <ul>
              <li>Symbol-specific news from CryptoCompare</li>
              <li>Falls back to general crypto news if no specific articles found</li>
            </ul>
            
            <h4 style={{ color: '#4cc9f0', marginBottom: '8px' }}>Indicators Tab</h4>
            <ul>
              <li>Williams %R trend exhaustion indicator</li>
              <li>Technical analysis overlays</li>
            </ul>
          </div>

          <h3>🧭 Navigation Bar</h3>
          <ul>
            <li><strong>📊 Screener:</strong> Main table view (home page)</li>
            <li><strong>🔔 Alerts:</strong> View all past signal alerts with timestamps</li>
            <li><strong>📈 Feed:</strong> Curated high-quality signals meeting strict criteria</li>
            <li><strong>📉 Analysis:</strong> Strategy performance dashboard and backtesting statistics</li>
            <li><strong>💼 Portfolio:</strong> Track your positions with real-time P&L</li>
            <li><strong>❓ About:</strong> This documentation page</li>
          </ul>

          <h3>⌨️ Keyboard Shortcuts</h3>
          <ul>
            <li><strong>↑ / ↓:</strong> Navigate to previous/next symbol in modal</li>
            <li><strong>Esc:</strong> Close modal</li>
            <li><strong>Click outside modal:</strong> Close modal</li>
          </ul>
          
          <h3>🔄 Status Indicators</h3>
          <ul>
            <li><strong style={{ color: '#16a34a' }}>🟢 Connected:</strong> Real-time data flowing</li>
            <li><strong style={{ color: '#4cc9f0' }}>🟡 Reconnecting:</strong> Temporary connection issue, auto-reconnecting</li>
            <li><strong style={{ color: '#ef4444' }}>🔴 Disconnected:</strong> No connection - check backend status</li>
            <li><strong>LIVE badge:</strong> Indicates real-time WebSocket streaming (not cached data)</li>
          </ul>
        </Section>

        {/* Acronyms & Terminology */}
        <Section title="📖 Glossary & Terminology" expanded={expandedSection === 'terms'} onToggle={() => toggleSection('terms')}>
          <h3>📈 Price & Volume Metrics</h3>
          <div style={{ display: 'grid', gap: '12px', marginBottom: '20px' }}>
            <Term term="ATR (Average True Range)" definition="Measures volatility over 14 periods. Higher ATR = bigger price swings. Used for position sizing and stop-loss placement. Example: ATR of $500 on BTC means typical movement is $500 per candle." />
            <Term term="VWAP (Volume Weighted Average Price)" definition="The average price weighted by volume throughout the session. Institutional benchmark - price above VWAP suggests bullish bias, below suggests bearish. Great for identifying fair value." />
            <Term term="Vol Z / Volume Z-Score" definition="Statistical measure showing how unusual current volume is. Z-score of 2 = volume is 2 standard deviations above normal. Values >2 indicate significant market interest." />
            <Term term="RVOL (Relative Volume)" definition="Current volume compared to average volume. RVOL of 1.5 = 50% more volume than usual. High RVOL confirms price moves are significant." />
            <Term term="Spread" definition="Difference between best bid and best ask price. Tight spread = high liquidity. Wide spread = low liquidity or high volatility." />
          </div>
          
          <h3>📊 Technical Indicators</h3>
          <div style={{ display: 'grid', gap: '12px', marginBottom: '20px' }}>
            <Term term="Cipher B / WaveTrend" definition="Advanced momentum oscillator that identifies overbought/oversold conditions and trend reversals. Uses two lines (WT1, WT2) - crosses indicate potential entries. Overbought >40, Oversold <-40." />
            <Term term="WT1 / WT2" definition="WaveTrend lines used in Cipher B. WT1 is the fast line, WT2 is the slow line. WT1 crossing above WT2 in oversold zone = buy signal. WT1 crossing below WT2 in overbought zone = sell signal." />
            <Term term="Williams %R" definition="Momentum indicator showing where price closed relative to the high-low range. Ranges from 0 to -100. Above -20 = overbought, below -80 = oversold. Used for trend exhaustion detection." />
            <Term term="Signal Score" definition="Composite score (0-100) combining multiple factors: momentum, volume, Cipher B, and open interest. Scores above 70 indicate strong setups worth investigating." />
            <Term term="Impulse Score" definition="Measures sudden bursts of buying/selling pressure. High positive (>80) = strong buying pressure, high negative (<-80) = strong selling pressure. Good for timing entries." />
            <Term term="Momentum Score" definition="Multi-timeframe momentum indicator combining 5m and 15m price action. Positive = uptrend, negative = downtrend. Magnitude indicates strength." />
            <Term term="Breakout 15m" definition="Distance from 15-minute high as a percentage. Positive value = at or near breakout level. Useful for finding coins testing resistance." />
          </div>
          
          <h3>💹 Derivatives & Order Flow</h3>
          <div style={{ display: 'grid', gap: '12px', marginBottom: '20px' }}>
            <Term term="OI (Open Interest)" definition="Total number of outstanding futures/perpetual contracts. Rising OI = new money entering. Falling OI = positions closing. Key for confirming trend strength." />
            <Term term="OI Delta / OI Δ" definition="Change in open interest over a period. Positive delta = positions being opened. Negative delta = positions being closed. Shown as percentage change." />
            <Term term="Funding Rate" definition="Periodic payment between long and short traders in perpetual futures. Positive = longs pay shorts (market bullish). Negative = shorts pay longs (market bearish). Extreme values often precede reversals." />
            <Term term="L/S Ratio (Long/Short Ratio)" definition="Ratio of long positions to short positions. Ratio >1 = more longs than shorts. Extreme ratios (>2 or <0.5) can indicate crowded trades and potential squeeze risk." />
            <Term term="CVD (Cumulative Volume Delta)" definition="Running total of (buy volume - sell volume). Rising CVD = net buying pressure. Falling CVD = net selling pressure. Divergence from price can signal reversals." />
            <Term term="Footprint Chart" definition="Order flow visualization showing bid/ask volume at each price level. Reveals where actual buying and selling occurred, not just price movement." />
            <Term term="Imbalance" definition="When bid or ask volume at a price level is significantly higher than the other (typically 3:1 ratio). Indicates absorption or aggressive buying/selling." />
            <Term term="Liquidation" definition="Forced closure of a leveraged position when margin requirements aren't met. Large liquidations can cascade and accelerate price moves." />
            <Term term="Wall" definition="Large resting order in the order book at a specific price level. Bid walls = support (buying interest). Ask walls = resistance (selling interest). Strength shown as multiple of average (e.g., 2.5x)." />
          </div>
          
          <h3>📐 Trading & Risk Metrics</h3>
          <div style={{ display: 'grid', gap: '12px', marginBottom: '20px' }}>
            <Term term="R (Risk Multiple)" definition="Profit/loss measured in multiples of initial risk. If you risk $100, a 2R winner = $200 profit, -1R = $100 loss (full stop hit). Standard way to compare trades regardless of size." />
            <Term term="MAE (Maximum Adverse Excursion)" definition="The worst drawdown during a trade before it closed. MAE of -1.5R means the trade went against you by 1.5x your risk at its worst point." />
            <Term term="MFE (Maximum Favorable Excursion)" definition="The best profit point during a trade before it closed. MFE of 3R means the trade was up 3x your risk at its peak." />
            <Term term="Win Rate" definition="Percentage of profitable trades. A 60% win rate = 6 out of 10 trades are winners. Must be considered alongside average R to determine profitability." />
            <Term term="Avg R" definition="Average profit/loss per trade in R multiples. Positive Avg R with reasonable win rate = profitable strategy. Example: 0.5R average means you make 0.5x your risk per trade on average." />
            <Term term="SL (Stop Loss)" definition="Price level where you exit a losing trade to limit risk. Typically placed at 1-2x ATR from entry or below key support/resistance." />
            <Term term="TP (Take Profit)" definition="Price level where you exit a winning trade to lock in profits. Usually set at 1.5R, 2.5R, and 4R multiples of risk." />
          </div>
          
          <h3>🏷️ Interface Terms</h3>
          <div style={{ display: 'grid', gap: '12px' }}>
            <Term term="Scalping Walls" definition="Large order book orders within 3% of current price. Used for short-term trading decisions and immediate support/resistance levels." />
            <Term term="Swing Zones" definition="Aggregated/clustered order book walls within 10% of price. Used for swing trading, identifying key levels for multi-day positions." />
            <Term term="Cluster" definition="Multiple nearby orders grouped together into a single zone. Shows total value, order count, and price range. Stronger signal than individual orders." />
            <Term term="Strength (x)" definition="How much larger an order or level is compared to average. 2.5x = 2.5 times the average size. Higher = more significant." />
            <Term term="Distance (%)" definition="How far a price level is from current price as a percentage. 1.5% away = price would need to move 1.5% to reach that level." />
          </div>
        </Section>

        {/* Order Flow Section */}
        <Section title="📈 Order Flow Analysis" expanded={expandedSection === 'orderflow'} onToggle={() => toggleSection('orderflow')}>
          <p>
            Order flow analysis reveals the actual buying and selling activity behind price movements. Unlike traditional 
            indicators that only look at price, order flow shows you <em>who</em> is trading and <em>how aggressively</em>.
          </p>
          
          <h3>🛡️ Order Book Walls</h3>
          <p>
            Walls are large resting limit orders that act as support or resistance. Warthog detects these in real-time 
            from the live order book and displays them in two categories:
          </p>
          <div style={{ marginLeft: '20px', marginBottom: '15px' }}>
            <h4 style={{ color: '#16a34a' }}>Support Walls (Bid Side) 🟢</h4>
            <p>Large buy orders below current price. When price approaches these levels, the wall may absorb selling pressure 
            and cause a bounce. Shown in green.</p>
            
            <h4 style={{ color: '#ef4444' }}>Resistance Walls (Ask Side) 🔴</h4>
            <p>Large sell orders above current price. When price approaches these levels, the wall may absorb buying pressure 
            and cause a rejection. Shown in red.</p>
          </div>
          
          <h4>Wall Metrics:</h4>
          <ul>
            <li><strong>Price:</strong> The price level where the wall exists</li>
            <li><strong>Value ($):</strong> Total USD value of orders at that level</li>
            <li><strong>Strength (x):</strong> How much larger than average (2.5x = 2.5 times bigger than typical level)</li>
            <li><strong>Distance (%):</strong> How far from current price</li>
          </ul>
          
          <h3>📊 Scalping Walls vs Swing Zones</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1f2a37' }}>
                <th style={{ textAlign: 'left', padding: '8px', color: '#7d8aa5' }}>Feature</th>
                <th style={{ textAlign: 'left', padding: '8px', color: '#7d8aa5' }}>Scalping Walls</th>
                <th style={{ textAlign: 'left', padding: '8px', color: '#7d8aa5' }}>Swing Zones</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style={{ padding: '8px' }}>Distance from price</td><td style={{ padding: '8px' }}>Within 3%</td><td style={{ padding: '8px' }}>Within 10%</td></tr>
              <tr><td style={{ padding: '8px' }}>Clustering</td><td style={{ padding: '8px' }}>No</td><td style={{ padding: '8px' }}>Yes (nearby orders grouped)</td></tr>
              <tr><td style={{ padding: '8px' }}>Best for</td><td style={{ padding: '8px' }}>Day trading, quick scalps</td><td style={{ padding: '8px' }}>Swing trades, position entries</td></tr>
              <tr><td style={{ padding: '8px' }}>Use case</td><td style={{ padding: '8px' }}>Immediate S/R levels</td><td style={{ padding: '8px' }}>Key zones, SL/TP placement</td></tr>
            </tbody>
          </table>
          
          <h3>📉 Footprint Chart</h3>
          <p>The footprint chart shows bid and ask volume at each price level for each candle:</p>
          <ul>
            <li><strong>Bid Volume (left/green):</strong> Volume traded at the bid price (selling into bids)</li>
            <li><strong>Ask Volume (right/red):</strong> Volume traded at the ask price (buying from asks)</li>
            <li><strong>Imbalance Highlighting:</strong> Rows turn yellow when bid/ask ratio exceeds 3:1</li>
            <li><strong>Delta:</strong> Difference between ask and bid volume (positive = net buying)</li>
          </ul>
          
          <h3>📈 CVD (Cumulative Volume Delta)</h3>
          <p>
            CVD tracks the running total of buying vs selling volume. It helps identify:
          </p>
          <ul>
            <li><strong>Trend Confirmation:</strong> Rising price + rising CVD = healthy uptrend</li>
            <li><strong>Divergence:</strong> Rising price + falling CVD = potential weakness (buyers exhausted)</li>
            <li><strong>Absorption:</strong> Price stalling while CVD keeps rising = accumulation (bullish)</li>
          </ul>
          
          <h3>⚖️ Order Book Imbalance</h3>
          <p>
            Shows the balance between total bid value and ask value in the order book:
          </p>
          <ul>
            <li><strong style={{ color: '#16a34a' }}>Bid Heavy (&gt;55% bids):</strong> More buy orders than sell orders - bullish bias</li>
            <li><strong style={{ color: '#ef4444' }}>Ask Heavy (&gt;55% asks):</strong> More sell orders than buy orders - bearish bias</li>
            <li><strong>Balanced:</strong> Neither side dominates - watch for breakout direction</li>
          </ul>
        </Section>

        {/* Market Data Section */}
        <Section title="💹 Market Data Features" expanded={expandedSection === 'marketdata'} onToggle={() => toggleSection('marketdata')}>
          <h3>📊 Long/Short Ratio</h3>
          <p>
            Shows the percentage of traders positioned long vs short. Available for both Binance and Bybit.
          </p>
          <ul>
            <li><strong>Visual Bar:</strong> Green portion = longs, red portion = shorts</li>
            <li><strong>Ratio Value:</strong> L/S ratio (e.g., 1.08 = 8% more longs than shorts)</li>
            <li><strong>Sentiment Label:</strong> Very Bullish / Bullish / Neutral / Bearish / Very Bearish</li>
            <li><strong>Contrarian Warning:</strong> Appears when ratio is extreme (&gt;2 or &lt;0.5), indicating potential squeeze risk</li>
          </ul>
          <p><strong>Trading Tip:</strong> Extreme L/S ratios often precede reversals. If everyone is long, who's left to buy?</p>
          
          <h3>💧 Liquidation Heatmap</h3>
          <p>
            Real-time tracking of forced liquidations, aggregated by price level. Helps identify:
          </p>
          <ul>
            <li><strong>Cascade Zones:</strong> Price levels with heavy liquidations can trigger more liquidations</li>
            <li><strong>Squeeze Potential:</strong> Clusters of liquidations above/below price indicate squeeze risk</li>
            <li><strong>Support/Resistance:</strong> Levels where many positions were liquidated often become key levels</li>
          </ul>
          
          <h4>Liquidation Types:</h4>
          <ul>
            <li><strong style={{ color: '#16a34a' }}>Long Liquidations (🟢):</strong> Longs forced to sell - occurs when price drops</li>
            <li><strong style={{ color: '#ef4444' }}>Short Liquidations (🔴):</strong> Shorts forced to buy - occurs when price rises</li>
          </ul>
          
          <h4>Reading the Heatmap:</h4>
          <ul>
            <li><strong>Bar Width:</strong> Proportional to liquidation volume at that level</li>
            <li><strong>Intensity:</strong> Brighter colors = more liquidations</li>
            <li><strong>Current Price Indicator:</strong> Blue highlight shows where current price is relative to liquidation levels</li>
          </ul>
          
          <h3>💰 Funding Rate</h3>
          <p>
            Perpetual futures funding rate and next funding time. Shown in the Overview tab.
          </p>
          <ul>
            <li><strong>Positive Funding:</strong> Longs pay shorts - market is bullish (can be contrarian bearish signal at extremes)</li>
            <li><strong>Negative Funding:</strong> Shorts pay longs - market is bearish (can be contrarian bullish signal at extremes)</li>
            <li><strong>Annualized Rate:</strong> Funding rate × 3 × 365 to show yearly equivalent</li>
          </ul>
          
          <h3>📰 News Integration</h3>
          <p>
            Real-time crypto news from CryptoCompare API, filtered by symbol.
          </p>
          <ul>
            <li>Searches for symbol-specific news in title, tags, and content</li>
            <li>Falls back to general crypto market news if no specific articles found</li>
            <li>Click article titles to open full story in new tab</li>
          </ul>
          
          <h3>📈 Open Interest Tracking</h3>
          <p>
            Monitors changes in open interest (total outstanding contracts) over time.
          </p>
          <ul>
            <li><strong>OI Trend Chart:</strong> Visual history of open interest changes</li>
            <li><strong>OI Delta Column:</strong> Percentage change in OI (in main screener table)</li>
          </ul>
          <p><strong>OI + Price Interpretation:</strong></p>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1f2a37' }}>
                <th style={{ textAlign: 'left', padding: '8px', color: '#7d8aa5' }}>Price</th>
                <th style={{ textAlign: 'left', padding: '8px', color: '#7d8aa5' }}>OI</th>
                <th style={{ textAlign: 'left', padding: '8px', color: '#7d8aa5' }}>Interpretation</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style={{ padding: '8px' }}>↑ Rising</td><td style={{ padding: '8px' }}>↑ Rising</td><td style={{ padding: '8px', color: '#16a34a' }}>Strong uptrend (new longs entering)</td></tr>
              <tr><td style={{ padding: '8px' }}>↓ Falling</td><td style={{ padding: '8px' }}>↑ Rising</td><td style={{ padding: '8px', color: '#ef4444' }}>Strong downtrend (new shorts entering)</td></tr>
              <tr><td style={{ padding: '8px' }}>↑ Rising</td><td style={{ padding: '8px' }}>↓ Falling</td><td style={{ padding: '8px', color: '#7d8aa5' }}>Weak rally (shorts covering)</td></tr>
              <tr><td style={{ padding: '8px' }}>↓ Falling</td><td style={{ padding: '8px' }}>↓ Falling</td><td style={{ padding: '8px', color: '#7d8aa5' }}>Weak decline (longs exiting)</td></tr>
            </tbody>
          </table>
        </Section>

        {/* Indicators Explained */}
        <Section title="📊 Indicators Explained" expanded={expandedSection === 'indicators'} onToggle={() => toggleSection('indicators')}>
          <h3>Signal Score (Composite)</h3>
          <p>
            The Signal Score combines multiple factors into a single 0-100 rating. It weighs:
          </p>
          <ul>
            <li>Cipher B signals (buy/sell crosses)</li>
            <li>Momentum across multiple timeframes</li>
            <li>Volume anomalies (Z-score)</li>
            <li>Open interest changes</li>
            <li>Proximity to breakout levels</li>
          </ul>
          <p><strong>How to use:</strong> Scores above 70 indicate strong setups. Combine with other filters for best results.</p>

          <h3>Cipher B (WaveTrend)</h3>
          <p>
            A sophisticated momentum oscillator that smooths price data to identify trend changes early. 
            It oscillates around zero with overbought (+40) and oversold (-40) zones.
          </p>
          <p><strong>Buy signal:</strong> WT1 crosses above WT2 in oversold territory (below -40)</p>
          <p><strong>Sell signal:</strong> WT1 crosses below WT2 in overbought territory (above +40)</p>
          <p><strong>Pro tip:</strong> Best signals occur when price is also at support/resistance levels.</p>

          <h3>Momentum Score</h3>
          <p>
            Combines 5m and 15m price momentum with volume confirmation. Positive values indicate uptrend, 
            negative indicate downtrend. Magnitude shows strength.
          </p>
          <p><strong>How to use:</strong> Look for momentum &gt; 50 (bullish) or &lt; -50 (bearish) for strong directional moves.</p>

          <h3>Impulse Score</h3>
          <p>
            Measures sudden bursts of buying or selling pressure using recent volume and price action. 
            Useful for catching momentum trades early.
          </p>
          <p><strong>How to use:</strong> Impulse &gt; 80 = strong buying pressure. Impulse &lt; -80 = strong selling pressure.</p>

          <h3>Volume Z-Score</h3>
          <p>
            Statistical measure of how unusual current volume is. Z-score &gt; 2 means volume is 2 standard 
            deviations above normal - indicating significant market interest.
          </p>
          <p><strong>How to use:</strong> High Z-score + price breakout = validated move. High Z-score + small price change = potential breakout coming.</p>

          <h3>Open Interest Changes</h3>
          <p>
            Tracks changes in total open futures contracts. Rising OI confirms trend strength, falling OI 
            suggests profit-taking or uncertainty.
          </p>
          <p><strong>How to use:</strong></p>
          <ul>
            <li>Price ↑ + OI ↑ = Strong uptrend</li>
            <li>Price ↓ + OI ↑ = Strong downtrend</li>
            <li>Price ↑ + OI ↓ = Weak rally (shorts covering)</li>
            <li>Price ↓ + OI ↓ = Weak decline (longs exiting)</li>
          </ul>
        </Section>

        {/* FAQ Section */}
        <Section title="❓ Frequently Asked Questions" expanded={expandedSection === 'faq'} onToggle={() => toggleSection('faq')}>
          <div style={{ display: 'grid', gap: '20px' }}>
            <FAQ
              question="What's the difference between Signal Score and Impulse Score?"
              answer="Signal Score is a comprehensive rating (0-100) that combines multiple timeframes and indicators for identifying high-probability setups. Impulse Score focuses specifically on short-term momentum bursts and buying/selling pressure. Use Signal Score for overall opportunity ranking, and Impulse Score for timing entries on fast-moving setups."
            />
            <FAQ
              question="How often does data update?"
              answer="Price data updates in real-time via WebSocket connections (sub-second). Metrics like ATR, momentum, and Cipher B recalculate every time a 1-minute candle closes. Higher timeframe indicators (15m, 1h) update when those candles close."
            />
            <FAQ
              question="What do the colors mean?"
              answer="Green = positive values (gains, bullish signals). Red = negative values (losses, bearish signals). Yellow/Orange = warning or neutral. The intensity of the color often indicates magnitude - brighter green = stronger bullish signal."
            />
            <FAQ
              question="How do I set up alerts?"
              answer="Alerts are configured on the backend via environment variables. Set ENABLE_ALERTS=true, add your TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (or DISCORD_WEBHOOK_URL). The system will automatically send notifications when high-probability Cipher B signals occur. See backend/readme.md for detailed setup instructions."
            />
            <FAQ
              question="What exchanges are supported?"
              answer="Currently Binance and Bybit perpetual futures markets. The screener monitors the most liquid USDT-margined contracts for optimal data quality."
            />
            <FAQ
              question="Can I trade directly from the screener?"
              answer="No, this is a screening and analysis tool only. It provides signals and trade plans (entry/stop/targets), but you need to execute trades manually through your exchange or trading platform."
            />
            <FAQ
              question="How is the auto-generated trade plan calculated?"
              answer="Trade plans use ATR-based stops and targets. Stop-loss is typically placed at 1-2x ATR from entry. Take-profits are scaled at 1.5R, 2.5R, and 4R (risk multiples). The system also considers recent swing highs/lows and VWAP levels for optimal placement."
            />
            <FAQ
              question="What do the backtest results mean?"
              answer="Backtesting shows how the strategy would have performed historically. Win Rate = % of profitable trades. Avg R = average profit/loss in risk multiples. A positive Avg R with 50%+ win rate indicates a profitable strategy. MAE/MFE show typical drawdown and profit potential."
            />
            <FAQ
              question="Why do some symbols show '—' for certain metrics?"
              answer="'—' means data is not available or not applicable. This can happen for new listings, low-liquidity pairs, or when insufficient historical data exists to calculate the metric (e.g., RVOL needs volume history)."
            />
            <FAQ
              question="What's the 'Feed' page?"
              answer="The Feed page shows only the highest-quality signals that meet strict criteria: strong Signal Score, confirmed by multiple indicators, with favorable backtesting results. It's like a curated shortlist of the best opportunities."
            />
            <FAQ
              question="How do I interpret the sentiment indicators?"
              answer="Sentiment is calculated from current Cipher B signals across all monitored symbols. Green (Bullish) means more buy signals than sell. Red (Bearish) means more sell signals. The score ranges from -100 (extremely bearish) to +100 (extremely bullish). Use it as a market-wide temperature check."
            />
            <FAQ
              question="Can I customize the thresholds for filters?"
              answer="Currently, preset filters use hardcoded thresholds optimized for crypto volatility. For custom filtering, use the search box or combine presets with column sorting. Future versions may include customizable filter parameters."
            />
          </div>
        </Section>

        {/* Troubleshooting Section */}
        <Section title="🔧 Troubleshooting" expanded={expandedSection === 'troubleshooting'} onToggle={() => toggleSection('troubleshooting')}>
          <h3>No data showing / Status shows 'Disconnected'</h3>
          <ul>
            <li>Check that the backend is running (should be on port 8000)</li>
            <li>Verify WebSocket URL is correct in browser console</li>
            <li>Check browser console for connection errors</li>
            <li>Firewall or network may be blocking WebSocket connections</li>
          </ul>

          <h3>Data seems stale / Not updating</h3>
          <ul>
            <li>Click the 🔄 button to force a resync</li>
            <li>Check backend logs for exchange connection errors</li>
            <li>Verify internet connection is stable</li>
            <li>Backend may be rate-limited by exchanges (usually temporary)</li>
          </ul>

          <h3>Modal won't open / Charts not loading</h3>
          <ul>
            <li>Ensure symbol has sufficient data (new listings may lack history)</li>
            <li>Check browser console for JavaScript errors</li>
            <li>Try refreshing the page</li>
            <li>Backend OHLC data may still be backfilling (wait 1-2 minutes)</li>
          </ul>

          <h3>Alerts not working</h3>
          <ul>
            <li>Verify ENABLE_ALERTS=true in backend environment</li>
            <li>Check TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set correctly</li>
            <li>Ensure you've sent a message to your bot first</li>
            <li>Check backend logs for alerting errors</li>
            <li>Thresholds may be too strict - try relaxing CIPHERB_OS_LEVEL and CIPHERB_OB_LEVEL</li>
          </ul>

          <h3>Performance is slow</h3>
          <ul>
            <li>Use column picker (⚙️) to hide unused columns</li>
            <li>Enable 'Mobile Mode' for optimized layout</li>
            <li>Apply filters to reduce visible rows</li>
            <li>Close modal when not in use (rendering charts is CPU-intensive)</li>
            <li>Consider upgrading backend hardware if monitoring many symbols</li>
          </ul>

          <h3>Still having issues?</h3>
          <p>Check the logs:</p>
          <ul>
            <li><strong>Frontend:</strong> Open browser DevTools (F12) → Console tab</li>
            <li><strong>Backend:</strong> Check terminal where backend is running</li>
          </ul>
          <p>Common errors and solutions are documented in the main readme.md file.</p>
        </Section>

        {/* Best Practices Section */}
        <Section title="💡 Best Practices & Tips" expanded={expandedSection === 'tips'} onToggle={() => toggleSection('tips')}>
          <h3>Finding High-Probability Setups</h3>
          <ol>
            <li>Start with Signal Score filter (&gt;70) to narrow down opportunities</li>
            <li>Check volume confirmation - look for Vol Z-Score &gt; 2</li>
            <li>Verify with Cipher B - make sure you're entering in the direction of the signal</li>
            <li>Confirm trend with momentum indicators on multiple timeframes</li>
            <li>Check open interest - rising OI in your direction validates the move</li>
          </ol>

          <h3>Risk Management</h3>
          <ul>
            <li>Always use the auto-generated stop-loss as a starting point</li>
            <li>Consider ATR - wider stops needed for volatile coins</li>
            <li>Scale out at multiple targets (TP1, TP2, TP3) to lock profits</li>
            <li>Move stops to breakeven after TP1 is hit</li>
            <li>Never risk more than 1-2% of your account per trade</li>
          </ul>

          <h3>Using Presets Effectively</h3>
          <ul>
            <li><strong>Gainers/Losers 5m:</strong> Quick momentum plays, fast exits needed</li>
            <li><strong>Volatile 5m:</strong> Day trading opportunities with wider stops</li>
            <li><strong>High OI Delta:</strong> Find coins with strong position building</li>
            <li><strong>Breakout 15m:</strong> Swing trade setups, longer hold times</li>
            <li><strong>Cipher Buy/Sell:</strong> Reversal trades at key levels</li>
            <li><strong>High Signal:</strong> Best overall setups combining all factors</li>
          </ul>

          <h3>Workflow Recommendations</h3>
          <ol>
            <li><strong>Market scan (every 15-30 min):</strong> Use High Signal preset, sort by Signal Score</li>
            <li><strong>Opportunity evaluation:</strong> Click top 3-5 symbols, review charts and trade plans</li>
            <li><strong>Backtesting check:</strong> Look for win rate &gt;50% and avg R &gt;0.5</li>
            <li><strong>Confirmation:</strong> Open TradingView (📊 button), check higher timeframes</li>
            <li><strong>Execution:</strong> Set alerts at entry levels, wait for confirmation</li>
            <li><strong>Monitoring:</strong> Add to favorites (⭐), check regularly for updates</li>
          </ol>

          <h3>Common Mistakes to Avoid</h3>
          <ul>
            <li>❌ Chasing green candles without volume confirmation</li>
            <li>❌ Ignoring the broader market sentiment indicator</li>
            <li>❌ Taking every signal - be selective and wait for convergence</li>
            <li>❌ Using only 1-minute data for entries - always check 15m/1h context</li>
            <li>❌ Not adjusting position size based on ATR volatility</li>
            <li>❌ Revenge trading after stop-outs - stick to your plan</li>
          </ul>
        </Section>

        {/* Technical Details */}
        <Section title="⚙️ Technical Details" expanded={expandedSection === 'technical'} onToggle={() => toggleSection('technical')}>
          <h3>Architecture</h3>
          <p>
            <strong>Frontend:</strong> Next.js (React) with TypeScript, real-time WebSocket updates<br />
            <strong>Backend:</strong> Python FastAPI, asyncio for concurrent exchange connections<br />
            <strong>Data Storage:</strong> SQLite for OHLC history, Redis for real-time state<br />
            <strong>Data Sources:</strong> Binance & Bybit WebSocket APIs (trades, tickers, perpetuals)
          </p>

          <h3>Calculation Periods</h3>
          <ul>
            <li><strong>ATR:</strong> 14-period average on 1-minute bars</li>
            <li><strong>Volume Z-Score:</strong> Rolling 100-period mean and std dev</li>
            <li><strong>RVOL:</strong> Current vs 20-period average</li>
            <li><strong>Cipher B:</strong> 10-period channel length, 21-period average length</li>
            <li><strong>Momentum:</strong> Rate of change over 5 and 15 bars</li>
          </ul>

          <h3>Data Retention</h3>
          <ul>
            <li>Real-time: Last 200 1-minute bars per symbol</li>
            <li>Historical: 90 days of OHLC data in SQLite</li>
            <li>Alerts: Persistent storage, no expiration</li>
          </ul>

          <h3>Performance</h3>
          <ul>
            <li>Monitors 30-50 symbols simultaneously (configurable)</li>
            <li>Sub-second latency for price updates</li>
            <li>Indicator calculations: ~10-50ms per symbol per update</li>
            <li>WebSocket throughput: Handles 100+ messages/second</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}

// Helper components
function Section({ title, expanded, onToggle, children }: { title: string; expanded: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div style={{ 
      border: '1px solid #1f2a37', 
      borderRadius: '12px', 
      overflow: 'hidden',
      backgroundColor: '#111823'
    }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          padding: '15px 20px',
          background: 'linear-gradient(180deg, #1b2635, #111826)',
          border: 'none',
          color: '#e6edf3',
          fontSize: '18px',
          fontWeight: 'bold',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        {title}
        <span style={{ fontSize: '20px', color: '#4cc9f0' }}>{expanded ? '−' : '+'}</span>
      </button>
      {expanded && (
        <div style={{ padding: '20px', lineHeight: '1.6' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function Term({ term, definition }: { term: string; definition: string }) {
  return (
    <div>
      <strong style={{ color: '#4cc9f0', fontSize: '16px' }}>{term}</strong>
      <p style={{ margin: '5px 0 0 0', color: '#7d8aa5' }}>{definition}</p>
    </div>
  );
}

function FAQ({ question, answer }: { question: string; answer: string }) {
  return (
    <div>
      <h4 style={{ color: '#4cc9f0', marginBottom: '8px' }}>Q: {question}</h4>
      <p style={{ margin: '0', color: '#7d8aa5', paddingLeft: '20px' }}>A: {answer}</p>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div style={{ 
      background: 'linear-gradient(180deg, #101825, #0c131e)', 
      borderRadius: '12px', 
      padding: '15px',
      border: '1px solid #1f2a37'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <span style={{ fontSize: '24px' }}>{icon}</span>
        <strong style={{ color: '#e6edf3', fontSize: '14px' }}>{title}</strong>
      </div>
      <p style={{ margin: 0, color: '#7d8aa5', fontSize: '13px', lineHeight: '1.5' }}>{description}</p>
    </div>
  );
}
