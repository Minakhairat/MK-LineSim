import { useAppStore } from '../store/useAppStore';
import { importNoteText } from '../utils/importNotes';

export function ImportNotesBanner() {
  const notes = useAppStore((s) => s.project.importNotes);
  const language = useAppStore((s) => s.language);
  const dismiss = useAppStore((s) => s.dismissImportNotes);
  if (!notes || notes.length === 0) return null;
  const isAr = language === 'ar';
  return (
    <div
      role="note"
      data-testid="import-notes"
      className="w-full max-w-3xl text-start rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <div className="font-semibold">
        {isAr ? 'افتراضات حصلت عند فتح الملف، راجعها قبل ما تعتمد على النتائج' : 'Assumptions made when this file was opened. Review them before relying on results'}
      </div>
      <ul className="list-disc ps-4 mt-1">
        {notes.map((c) => (
          <li key={c}>{importNoteText(c, isAr)}</li>
        ))}
      </ul>
      <button
        type="button"
        onClick={dismiss}
        className="mt-1 rounded border border-amber-400 px-2 py-0.5 text-[11px] hover:bg-amber-100 dark:hover:bg-amber-900/40"
      >
        {isAr ? 'تمام، راجعتها' : 'Reviewed, dismiss'}
      </button>
    </div>
  );
}
