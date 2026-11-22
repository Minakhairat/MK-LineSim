import React, { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { useAppStore } from '../../store/useAppStore';
import { getT } from '../../i18n/translations';

export const PWAInstallButton: React.FC = () => {
  const language = useAppStore((s) => s.language);
  const t = getT(language);
  const isAr = language === 'ar';
  const { isInstallable, isInstalled, isIOS, isAndroid, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      const ok = await install();
      if (!ok) return;
      return;
    }
    setShowGuide(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        title={t.pwa.installTitle}
        className="flex items-center gap-1 rounded border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/35 px-2 py-1 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/60 whitespace-nowrap shrink-0 transition-colors"
      >
        {isIOS || isAndroid ? (
          <Smartphone className="w-3.5 h-3.5 text-red-600 shrink-0" />
        ) : (
          <Download className="w-3.5 h-3.5 text-red-600 shrink-0" />
        )}
        <span className="hidden sm:inline">{t.pwa.installBtn}</span>
      </button>

      {showGuide && (
        <div
          dir={isAr ? 'rtl' : 'ltr'}
          onClick={() => setShowGuide(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 shadow-2xl text-start"
          >
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-neutral-200 dark:border-neutral-800">
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src={`${import.meta.env.BASE_URL}pwa-192x192.png`}
                  alt="MK LineSim"
                  className="h-9 w-9 rounded-lg shrink-0"
                />
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-neutral-900 dark:text-white truncate">
                    {t.pwa.installTitle}
                  </h3>
                  <p className="text-[11px] text-neutral-500 truncate" dir="ltr">
                    MK LineSim
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                aria-label={t.pwa.close}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-3.5 flex flex-col gap-2.5 text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">
              {isIOS ? (
                <>
                  <p className="flex items-start gap-2">
                    <span className="font-mono-tabular font-bold text-red-600">1.</span>
                    <span>
                      {t.pwa.installIosStep1}{' '}
                      <Share className="inline w-3.5 h-3.5 text-blue-600 mx-0.5" />
                    </span>
                  </p>
                  <p className="flex items-start gap-2">
                    <span className="font-mono-tabular font-bold text-red-600">2.</span>
                    <span>{t.pwa.installIosStep2}</span>
                  </p>
                </>
              ) : isAndroid ? (
                <p>{t.pwa.installAndroidHint}</p>
              ) : (
                <p>{t.pwa.installDesktopHint}</p>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-4 w-full rounded-lg bg-neutral-900 dark:bg-neutral-100 py-2 text-xs font-semibold text-white dark:text-neutral-900 hover:opacity-90 transition-opacity"
            >
              {t.pwa.close}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
