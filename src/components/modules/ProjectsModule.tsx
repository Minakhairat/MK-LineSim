import React, { useRef, useState } from 'react';
import { Check, Copy, Download, FolderOpen, Pencil, Plus, Save, Trash2, Upload, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { createDesertAirCoolerProject } from '../../data/sampleProject';
import { saveProjectToDb } from '../../storage/indexedDb';
import { getT } from '../../i18n/translations';

export const ProjectsModule: React.FC = () => {
  const project = useAppStore((s) => s.project);
  const projectsList = useAppStore((s) => s.projectsList);
  const skippedStoredProjects = useAppStore((s) => s.skippedStoredProjects);
  const language = useAppStore((s) => s.language);
  const createNewProject = useAppStore((s) => s.createNewProject);
  const openProjectById = useAppStore((s) => s.openProjectById);
  const duplicateProjectById = useAppStore((s) => s.duplicateProjectById);
  const deleteProjectById = useAppStore((s) => s.deleteProjectById);
  const renameCurrentProject = useAppStore((s) => s.renameCurrentProject);
  const renameProjectById = useAppStore((s) => s.renameProjectById);
  const saveCurrentProject = useAppStore((s) => s.saveCurrentProject);
  const importProjectJson = useAppStore((s) => s.importProjectJson);
  const setToast = useAppStore((s) => s.setToast);

  const t = getT(language);
  const isAr = language === 'ar';

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [newName, setNewName] = useState('');
  const [newFactory, setNewFactory] = useState('');
  const [newIndustry, setNewIndustry] = useState('Discrete Assembly');
  const [newL, setNewL] = useState(30);
  const [newW, setNewW] = useState(20);
  const [newH, setNewH] = useState(5);
  const [editingProjId, setEditingProjId] = useState<string | null>(null);
  const [editProjName, setEditProjName] = useState('');
  const [editProjFactory, setEditProjFactory] = useState('');

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_linesim.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToast(isAr ? 'تم تصدير ملف المشروع JSON' : 'Exported project JSON', 'success');
  };

  const handleExportSkipped = (idx: number) => {
    const sp = skippedStoredProjects[idx];
    if (!sp) return;
    const blob = new Blob([JSON.stringify(sp.raw, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(sp.id || sp.name).toLowerCase().replace(/[^a-z0-9]+/g, '_')}_original_stored.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToast(isAr ? 'تم تصدير الملف الأصلي المحفوظ' : 'Exported the original stored project JSON', 'success');
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    await importProjectJson(text);
    e.target.value = '';
  };

  const handleRestoreSample = async () => {
    const sample = createDesertAirCoolerProject();
    sample.id = `proj_sample_${Date.now().toString(36)}`;
    sample.name = isAr
      ? 'خط تجميع المبرد الصحراوي (نسخة جديدة)'
      : 'Desert Air Cooler Assembly Line (Fresh Copy)';
    await saveProjectToDb(sample);
    await useAppStore.getState().bootstrap();
    await openProjectById(sample.id);
    setToast(
      isAr ? 'تم إنشاء نسخة جديدة من مشروع الخط النموذجي' : 'Created fresh Desert Air Cooler acceptance project',
      'success'
    );
  };

  return (
    <div className="flex flex-col gap-5 p-4 text-xs">
      {/* Active Project Metadata */}
      <section className="flex flex-col gap-2.5 border-b border-neutral-200 dark:border-neutral-800 pb-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
            {t.projects.activeProject}
          </h3>
          <button
            onClick={() => saveCurrentProject()}
            className="flex items-center gap-1 rounded bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-700"
          >
            <Save className="w-3 h-3" />
            <span>{t.actions.save}</span>
          </button>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-neutral-500">{t.labels.projectName}</span>
          <input
            type="text"
            value={project.name}
            onChange={(e) =>
              renameCurrentProject(e.target.value, project.factoryName, project.industryType, project.description)
            }
            className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-neutral-500">{t.labels.factoryName}</span>
          <input
            type="text"
            value={project.factoryName}
            onChange={(e) =>
              renameCurrentProject(project.name, e.target.value, project.industryType, project.description)
            }
            className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-neutral-500">{t.labels.industry}</span>
          <input
            type="text"
            value={project.industryType}
            onChange={(e) =>
              renameCurrentProject(project.name, project.factoryName, e.target.value, project.description)
            }
            className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-xs"
          />
        </label>

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleExportJson}
            className="flex flex-1 items-center justify-center gap-1.5 rounded border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5 text-[11px] font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t.projects.exportJson}</span>
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5 text-[11px] font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{t.projects.importJson}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportFile}
            className="hidden"
          />
        </div>
      </section>

      {skippedStoredProjects.length > 0 && (
        <section
          data-testid="skipped-stored-projects"
          className="flex flex-col gap-2 rounded border border-amber-400 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          <h3 className="text-xs font-semibold">
            {isAr
              ? `${skippedStoredProjects.length} مشروع محفوظ تعذر فتحه`
              : `${skippedStoredProjects.length} stored project(s) could not be opened`}
          </h3>
          <p className="text-[11px]">
            {isAr
              ? 'لم يُحذف أي شيء. صدّر الملف الأصلي، أضف القيم الناقصة، ثم استورده من جديد.'
              : 'Nothing was deleted. Export the original file, add the missing values, then import it again.'}
          </p>
          {skippedStoredProjects.map((sp, idx) => (
            <div key={`${sp.id}_${idx}`} className="flex flex-col gap-1 border-t border-amber-300 pt-2">
              <span className="font-medium">{sp.name}</span>
              <span className="text-[11px]">{sp.reason}</span>
              <button
                onClick={() => handleExportSkipped(idx)}
                className="flex items-center justify-center gap-1.5 self-start rounded border border-amber-500 px-2.5 py-1 text-[11px] font-medium hover:bg-amber-100 dark:hover:bg-amber-900"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{isAr ? 'تصدير الملف الأصلي' : 'Export original JSON'}</span>
              </button>
            </div>
          ))}
        </section>
      )}

      {/* Create New Project */}
      <section className="flex flex-col gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-4">
        <h3 className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
          {t.projects.createNewFactory}
        </h3>
        <input
          type="text"
          placeholder={t.labels.projectName}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-xs"
        />
        <input
          type="text"
          placeholder={t.labels.factoryName}
          value={newFactory}
          onChange={(e) => setNewFactory(e.target.value)}
          className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-xs"
        />
        <input
          type="text"
          placeholder={t.labels.industry}
          value={newIndustry}
          onChange={(e) => setNewIndustry(e.target.value)}
          className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-xs"
        />
        <div className="grid grid-cols-3 gap-1.5">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-neutral-500">{t.labels.length} (m)</span>
            <input
              type="number"
              min={5}
              value={newL}
              onChange={(e) => setNewL(Number(e.target.value))}
              className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 font-mono-tabular"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-neutral-500">{t.labels.width} (m)</span>
            <input
              type="number"
              min={5}
              value={newW}
              onChange={(e) => setNewW(Number(e.target.value))}
              className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 font-mono-tabular"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-neutral-500">{t.labels.height} (m)</span>
            <input
              type="number"
              min={3}
              value={newH}
              onChange={(e) => setNewH(Number(e.target.value))}
              className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 font-mono-tabular"
            />
          </label>
        </div>
        <div className="flex gap-1.5 pt-1">
          <button
            onClick={async () => {
              await createNewProject(newName, newFactory, newIndustry, newL, newW, newH);
              setNewName('');
              setNewFactory('');
            }}
            className="flex flex-1 items-center justify-center gap-1 rounded bg-neutral-900 dark:bg-neutral-100 px-2.5 py-1.5 text-[11px] font-medium text-white dark:text-neutral-900"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.projects.createBlank}</span>
          </button>
          <button
            onClick={handleRestoreSample}
            className="rounded border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5 text-[11px] font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title={t.projects.sampleLine}
          >
            {t.projects.sampleLine}
          </button>
        </div>
      </section>

      {/* Saved Projects in IndexedDB */}
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
          {t.projects.localProjects} ({projectsList.length})
        </h3>
        <div className="flex flex-col gap-1.5 min-w-0">
          {projectsList.map((p) => {
            const isCurrent = p.id === project.id;
            const isEditing = editingProjId === p.id;
            return (
              <div
                key={p.id}
                className={`rounded border p-2.5 transition-colors min-w-0 ${
                  isCurrent
                    ? 'border-red-600 bg-red-50/40 dark:bg-red-950/20'
                    : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
                }`}
              >
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                      {p.name}
                    </div>
                    <div className="text-[11px] text-neutral-500 font-mono-tabular truncate">
                      {p.factory.lengthM}m × {p.factory.widthM}m · {p.stages.length} {t.projects.stagesLabel}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {!isCurrent && (
                      <button
                        type="button"
                        onClick={() => openProjectById(p.id)}
                        title={t.actions.open}
                        className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (isEditing) {
                          setEditingProjId(null);
                        } else {
                          setEditingProjId(p.id);
                          setEditProjName(p.name);
                          setEditProjFactory(p.factoryName);
                        }
                      }}
                      title={t.actions.edit}
                      className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => duplicateProjectById(p.id)}
                      title={t.actions.duplicate}
                      className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteProjectById(p.id)}
                      title={t.actions.delete}
                      className="p-1 rounded text-red-600 hover:bg-red-100 dark:hover:bg-red-950"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {isEditing && (
                  <div className="mt-2 flex flex-col gap-1.5 rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-2 min-w-0">
                    <input
                      type="text"
                      value={editProjName}
                      onChange={(e) => setEditProjName(e.target.value)}
                      placeholder={t.labels.projectName}
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-0.5 text-[11px]"
                    />
                    <input
                      type="text"
                      value={editProjFactory}
                      onChange={(e) => setEditProjFactory(e.target.value)}
                      placeholder={t.labels.factoryName}
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-0.5 text-[11px]"
                    />
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setEditingProjId(null)}
                        className="p-1 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300"
                      >
                        <X className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await renameProjectById(p.id, editProjName, editProjFactory);
                          setEditingProjId(null);
                        }}
                        className="flex items-center gap-1 rounded bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white"
                      >
                        <Check className="w-3 h-3" />
                        <span>{t.actions.save}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
