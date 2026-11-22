import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/usePWAInstall';
import { useAppStore } from '../../store/useAppStore';
import { getT } from '../../i18n/translations';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const language = useAppStore((s) => s.language);
  const t = getT(language);

  if (isOnline) return null;

  return (
    <div className="fixed bottom-14 start-3 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>{t.pwa.offlineBanner}</span>
    </div>
  );
};
