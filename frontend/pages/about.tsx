import { useState } from 'react';

export default function About() {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', alignItems: 'center' }}>
        <a href="/" className="button">← Back to Screener</a>
        <h1 style={{ margin: 0, flex: 1 }}>About Warthog Crypto Screener</h1>
      </div>

      <div style={{ display: 'grid', gap: '20px' }}>
        {/* Overview Section */}
        <Section title="Overview" expanded={expandedSection === 'overview'} onToggle={() => toggleSection('overview')}>
          <p>
            Warthog is a real-time cryptocurrency momentum screener that monitors multiple exchanges (Binance, Bybit) 
            and provides actionable trading signals based on technical indicators, volume analysis, and order flow data.
          </p>
          <h3>Key Features:</h3>
          <ul>
            <li><strong>Real-time data:</strong> WebSocket connections to exchanges for sub-second updates</li>
            <li><strong>Multi-timeframe analysis:</strong> Tracks 1m, 5m, 15m, and 60m price changes</li>
            <li><strong>Advanced indicators:</strong> Cipher B (WaveTrend), momentum, volume analysis</li>
            <li><strong>Order flow tracking:</strong> Open interest changes and footprint charts</li>
            <li><strong>Smart alerts:</strong> Telegram/Discord notifications for high-probability setups</li>
            <li><strong>Trade planning:</strong> Auto-generated entry, stop-loss, and take-profit levels</li>
          </ul>
        </Section>

        {/* How to Use Section */}
        <Section title="How to Use" expanded={expandedSection === 'howto'} onToggle={() => toggleSection('howto')}>
          <h3>Main Screener</h3>
          <ol>
            <li><strong>Quick Filters:</strong> Use preset buttons (Gainers 5m, Losers 5m, Volatile, etc.) to quickly filter the list</li>
            <li><strong>Search:</strong> Type a symbol name to find specific coins</li>
            <li><strong>Sort:</strong> Click column headers to sort by any metric</li>
            <li><strong>Favorites:</strong> Click the star (⭐) next to any symbol to add it to your watchlist</li>
            <li><strong>Details:</strong> Click any row to open a detailed modal with:
              <ul>
                <li>15-minute price chart</li>
                <li>Open interest trend</li>
                <li>Auto-generated trade plan with entry/stop/targets</li>
                <li>Backtesting results (30-day and 90-day)</li>
              </ul>
            </li>
          </ol>

          <h3>Navigation</h3>
          <ul>
            <li><strong>📊 (Table icon):</strong> Main screener (home page)</li>
            <li><strong>🔔 History:</strong> View all past alerts</li>
            <li><strong>📈 Feed:</strong> High-quality signal feed with detailed analysis</li>
            <li><strong>📉 Analysis:</strong> Strategy performance dashboard and backtesting results</li>
            <li><strong>⚙️ Columns:</strong> Customize which columns to display</li>
          </ul>

          <h3>Keyboard Shortcuts (in modal)</h3>
          <ul>
            <li><strong>↑ / ↓:</strong> Navigate to previous/next symbol</li>
            <li><strong>Esc:</strong> Close modal</li>
          </ul>
        </Section>

        {/* Acronyms & Terminology */}
        <Section title="Acronyms & Terminology" expanded={expandedSection === 'terms'} onToggle={() => toggleSection('terms')}>
          <div style={{ display: 'grid', gap: '15px' }}>
            <Term term="ATR" definition="Average True Range - Measures volatility. Higher ATR = bigger price swings. Used for position sizing and stop-loss placement." />
            <Term term="VWAP" definition="Volume Weighted Average Price - The average price weighted by volume. Price above VWAP suggests bullish bias, below suggests bearish." />
            <Term term="OI / Open Interest" definition="Total number of outstanding derivative contracts. Rising OI + rising price = strong trend. Falling OI = trend weakening." />
            <Term term="Vol Z / Volume Z-Score" definition="How many standard deviations current volume is from its average. High Z-score (>2) indicates unusual activity." />
            <Term term="RVOL" definition="Relative Volume - Current volume compared to average. RVOL > 1.5 suggests increased interest." />
            <Term term="Cipher B" definition="Advanced momentum indicator (WaveTrend oscillator) that identifies overbought/oversold conditions and trend reversals. Uses two lines (WT1, WT2) - crosses indicate potential entries." />
            <Term term="WT1 / WT2" definition="WaveTrend lines used in Cipher B. WT1 crossing above WT2 in oversold zone = buy signal. WT1 crossing below WT2 in overbought zone = sell signal." />
            <Term term="Signal Score" definition="Composite score (0-100) combining multiple factors: momentum, volume, Cipher B, and open interest. Higher = stronger signal." />
            <Term term="Impulse Score" definition="Measures short-term momentum bursts. High positive = strong buying pressure, high negative = strong selling pressure." />
            <Term term="Momentum Score" definition="Multi-timeframe momentum indicator. Positive = uptrend, negative = downtrend. Magnitude indicates strength." />
            <Term term="Breakout 15m" definition="Distance from 15-minute high. Positive value = near breakout, negative = far from high." />
            <Term term="R (Risk Multiple)" definition="Profit/loss measured in multiples of initial risk. 2R = 2x your risk, -1R = full stop loss hit." />
            <Term term="MAE / MFE" definition="Maximum Adverse/Favorable Excursion - Worst drawdown and best profit during a trade, measured in R multiples." />
            <Term term="Win Rate" definition="Percentage of profitable trades. 60% win rate = 6 out of 10 trades are winners." />
          </div>
        </Section>

        {/* Indicators Explained */}
        <Section title="Indicators Explained" expanded={expandedSection === 'indicators'} onToggle={() => toggleSection('indicators')}>
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
        <Section title="Frequently Asked Questions" expanded={expandedSection === 'faq'} onToggle={() => toggleSection('faq')}>
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
        <Section title="Troubleshooting" expanded={expandedSection === 'troubleshooting'} onToggle={() => toggleSection('troubleshooting')}>
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
        <Section title="Best Practices & Tips" expanded={expandedSection === 'tips'} onToggle={() => toggleSection('tips')}>
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
        <Section title="Technical Details" expanded={expandedSection === 'technical'} onToggle={() => toggleSection('technical')}>
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
      border: '1px solid #333', 
      borderRadius: '8px', 
      overflow: 'hidden',
      backgroundColor: '#1a1a1a'
    }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          padding: '15px 20px',
          background: '#252525',
          border: 'none',
          color: '#fff',
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
        <span style={{ fontSize: '20px' }}>{expanded ? '−' : '+'}</span>
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
      <strong style={{ color: '#4a9eff', fontSize: '16px' }}>{term}</strong>
      <p style={{ margin: '5px 0 0 0', color: '#ccc' }}>{definition}</p>
    </div>
  );
}

function FAQ({ question, answer }: { question: string; answer: string }) {
  return (
    <div>
      <h4 style={{ color: '#4a9eff', marginBottom: '8px' }}>Q: {question}</h4>
      <p style={{ margin: '0', color: '#ccc', paddingLeft: '20px' }}>A: {answer}</p>
    </div>
  );
}
