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
        <button 
          className={currentPath === '/' ? 'active' : ''} 
          onClick={() => router.push('/')}
          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}
        >
          <span className="icon">📊</span>
          Screener
        </button>
        <button 
          className={currentPath === '/alerts' ? 'active' : ''} 
          onClick={() => router.push('/alerts')}
          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}
        >
          <span className="icon">🔔</span>
          Alerts
        </button>
        <button 
          className={currentPath === '/portfolio' ? 'active' : ''} 
          onClick={() => router.push('/portfolio')}
          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}
        >
          <span className="icon">💼</span>
          Portfolio
        </button>
        <button 
          className={currentPath === '/feed' ? 'active' : ''} 
          onClick={() => router.push('/feed')}
          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}
        >
          <span className="icon">📰</span>
          Feed
        </button>
        <button 
          className={currentPath === '/analysis' ? 'active' : ''} 
          onClick={() => router.push('/analysis')}
          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}
        >
          <span className="icon">🔬</span>
          Analysis
        </button>
      </nav>
    </>
  );
}
