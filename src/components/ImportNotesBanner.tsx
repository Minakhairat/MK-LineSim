import { useAppStore } from '../store/useAppStore';
import {
  ResultProvenance,
  generatedInputCodes,
  importNoteText,
  isGeneratedInputCode,
  unknownProvenanceText,
} from '../utils/importNotes';

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
// With `provenance` the notice comes from the result's own stamp, so it outlives deleting the generated items.
// Without it (no result yet) it follows the project's current flags.
export function GeneratedInputsStrip({ provenance, perRow }: { provenance?: ResultProvenance; perRow?: boolean }) {
  const project = useAppStore((s) => s.project);
  const language = useAppStore((s) => s.language);
  const codes = provenance ? provenance.codes : generatedInputCodes(project);
  const unknown = provenance?.unknown ?? false;
  if (codes.length === 0 && !unknown) return null;
  const isAr = language === 'ar';
  return (
    <div
      role="note"
      data-testid="generated-inputs"
      className="w-full max-w-3xl text-start rounded border border-red-300 bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-900"
    >
      {codes.length > 0 && (
        <>
          <div className="font-semibold">
            {perRow
              ? isAr
                ? 'الصفوف الموسومة بس هي المبنية على مدخلات اتعملت تلقائياً مش من بياناتك'
                : 'Only the rows marked below use inputs that were generated automatically, not entered by you'
              : isAr
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
              ? 'الملاحظة دي مربوطة بالنتيجة نفسها، وبتفضل حتى لو المدخلات المولّدة اتحذفت. شغّل من جديد على مدخلاتك الحقيقية عشان نتيجة جديدة.'
              : 'This notice belongs to the result itself and stays even if the generated items are deleted. Re-run on your real inputs for a new result.'}
          </div>
        </>
      )}
      {unknown && (
        <div className="font-semibold mt-1">
          {perRow
            ? isAr
              ? 'الصفوف الموسومة "مصدر غير معروف" نتيجتها محفوظة قبل تسجيل المصدر. ماتفترضش إنها على مدخلاتك. شغّلها من جديد.'
              : 'Rows marked "provenance unknown" were saved before provenance was recorded. Do not assume they used your own inputs. Re-run them.'
            : unknownProvenanceText(isAr)}
        </div>
      )}
    </div>
  );
}
