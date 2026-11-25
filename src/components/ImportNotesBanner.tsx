import { useAppStore } from '../store/useAppStore';
import { generatedInputCodes, importNoteText, isGeneratedInputCode } from '../utils/importNotes';

export function ImportNotesBanner() {
  const allNotes = useAppStore((s) => s.project.importNotes);
  const notes = allNotes?.filter((c) => !isGeneratedInputCode(c));
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
        {isAr ? 'افتراضات أو مدخلات اتعملت تلقائياً (عند فتح الملف أو التشغيل)، راجعها قبل ما تعتمد على النتائج' : 'Assumptions or generated inputs (made when the file was opened or on Run). Review them before relying on results'}
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

// Not dismissable: a run that used generated inputs must always say so next to its results.
export function GeneratedInputsStrip() {
  const project = useAppStore((s) => s.project);
  const language = useAppStore((s) => s.language);
  const codes = generatedInputCodes(project);
  if (codes.length === 0) return null;
  const isAr = language === 'ar';
  return (
    <div
      role="note"
      data-testid="generated-inputs"
      className="w-full max-w-3xl text-start rounded border border-red-300 bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-900"
    >
      <div className="font-semibold">
        {isAr
          ? 'النتائج دي مبنية على مدخلات اتعملت تلقائياً مش من بياناتك'
          : 'These results use inputs that were generated automatically, not entered by you'}
      </div>
      <ul className="list-disc ps-4 mt-1">
        {codes.map((c) => (
          <li key={c}>{importNoteText(c, isAr)}</li>
        ))}
      </ul>
      <div className="mt-1">
        {isAr
          ? 'الملاحظة دي بتفضل لحد ما العناصر المولّدة تتحذف أو تتبدل.'
          : 'This notice stays until the generated items are deleted or replaced.'}
      </div>
    </div>
  );
}
