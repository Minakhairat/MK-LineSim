import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[100dvh] w-screen flex-col items-center justify-center gap-3 bg-neutral-950 p-6 text-center text-neutral-100">
          <h1 className="text-lg font-bold text-red-400">MK LineSim — Startup Error</h1>
          <p className="max-w-md rounded border border-neutral-800 bg-neutral-900 p-3 font-mono text-xs text-neutral-300">
            {this.state.message || 'Unexpected rendering error'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700"
          >
            Reload Application
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  try {
    registerSW({
      immediate: true,
      onRegisterError(err) {
        console.warn('PWA service worker registration skipped:', err);
      },
    });
  } catch (err) {
    console.warn('PWA service worker initialization skipped:', err);
  }
}

createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>
);
