import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import '../styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const currentPath = router.pathname;
  
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Realtime Crypto Screener</title>
      </Head>
      <Component {...pageProps} />
      
      {/* Mobile Bottom Navigation */}
      <nav className="mobile-nav">
        <a href="/" className={currentPath === '/' ? 'active' : ''}>
          <span className="icon">📊</span>
          Screener
        </a>
        <a href="/alerts" className={currentPath === '/alerts' ? 'active' : ''}>
          <span className="icon">🔔</span>
          Alerts
        </a>
        <a href="/portfolio" className={currentPath === '/portfolio' ? 'active' : ''}>
          <span className="icon">💼</span>
          Portfolio
        </a>
        <a href="/feed" className={currentPath === '/feed' ? 'active' : ''}>
          <span className="icon">📰</span>
          Feed
        </a>
        <a href="/analysis" className={currentPath === '/analysis' ? 'active' : ''}>
          <span className="icon">🔬</span>
          Analysis
        </a>
      </nav>
    </>
  );
}
