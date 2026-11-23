import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || String(error) || 'Unexpected runtime error',
    };
  }

  private handleResetAndReload = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((k) => window.caches.delete(k)));
      }
    } catch {
      // Ignore cleanup errors and force reload
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-6 text-neutral-900 dark:text-neutral-100">
          <div className="w-full max-w-md rounded-xl border border-red-200 dark:border-red-900/60 bg-white dark:bg-neutral-900 p-6 shadow-xl">
            <h1 className="text-base font-bold text-red-600 dark:text-red-400">
              MK LineSim — Runtime Recovery
            </h1>
            <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed" dir="rtl">
              حدث خطأ غير متوقع أثناء تحميل مساحة العمل. يمكنك إعادة التحميل أو مسح الكاش المؤقت وإعادة التشغيل.
            </p>
            <pre className="mt-3 max-h-28 overflow-auto rounded bg-neutral-100 dark:bg-neutral-950 p-2 text-[11px] font-mono text-neutral-700 dark:text-neutral-300">
              {this.state.message}
            </pre>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700"
              >
                Reload / إعادة تحميل
              </button>
              <button
                type="button"
                onClick={() => void this.handleResetAndReload()}
                className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-xs font-semibold hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                Clear Cache / مسح الكاش
              </button>
            </div>
          </div>
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
      onRegisterError() {
        // Never block application boot if SW registration fails on subpath/private mode
      },
    });
  } catch {
    // Ignore synchronous SW registration issues
  }
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
