import { el } from '../core/dom.js';
import { openModal, confirmDialog } from './modal.js';
import { TOOLS } from '../tools/registry.js';

const dateFormatter = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

/** Local project library: open a saved project, or import a .folio file. */
export function openLibraryDialog({ projects, onOpen, onDelete, onImportFile, fsAvailable }) {
  return openModal({
    title: 'Abrir proyecto',
    wide: true,
    build: ({ close }) => {
      const list = el('div.field-group');

      const paint = (items) => {
        list.replaceChildren();
        if (!items.length) {
          list.append(el('p.empty-note', {}, ['Todavía no hay proyectos guardados en este navegador.']));
          return;
        }
        for (const project of items) {
          list.append(el('div.page-item', { style: { cursor: 'default' } }, [
            el('div.page-item__meta', {}, [
              el('span.page-item__name', {}, [project.name]),
              el('span.page-item__sub', {}, [
                `${project.pages} pág. · ${project.images} img. · ${dateFormatter.format(new Date(project.updatedAt))}`,
              ]),
            ]),
            el('div.page-item__actions', { style: { opacity: '1' } }, [
              el('button.btn.sm', {
                type: 'button',
                onclick: () => { close(true); onOpen(project.id); },
              }, ['Abrir']),
              el('button.btn.sm.danger', {
                type: 'button',
                onclick: async () => {
                  const ok = await confirmDialog({
                    title: 'Eliminar proyecto',
                    message: `Se eliminará «${project.name}» del almacenamiento local. Los archivos ya exportados o guardados no se ven afectados.`,
                    confirmLabel: 'Eliminar',
                    danger: true,
                  });
                  if (!ok) return;
                  await onDelete(project.id);
                  paint(items.filter((p) => p.id !== project.id));
                },
              }, ['Eliminar']),
            ]),
          ]));
        }
      };

      paint(projects);

      return el('div.modal__body', {}, [
        el('p', {}, [
          fsAvailable
            ? 'Abre un proyecto guardado en este navegador o busca un archivo .folio en tu equipo.'
            : 'Abre un proyecto guardado en este navegador o carga un archivo .folio.',
        ]),
        list,
        el('div.field__row', {}, [
          el('button.btn', {
            type: 'button',
            onclick: () => { close(true); onImportFile(); },
          }, ['Abrir archivo .folio…']),
        ]),
      ]);
    },
    actions: [{ label: 'Cerrar', onClick: ({ close }) => close(false) }],
  });
}

const EXTRA_SHORTCUTS = [
  ['Ctrl/Cmd + V', 'Pegar imagen'],
  ['Ctrl/Cmd + Z', 'Deshacer'],
  ['Ctrl/Cmd + Y', 'Rehacer'],
  ['Ctrl/Cmd + D', 'Duplicar'],
  ['Ctrl/Cmd + S', 'Guardar proyecto'],
  ['Ctrl/Cmd + Shift + S', 'Guardar como…'],
  ['Ctrl/Cmd + O', 'Abrir proyecto'],
  ['Ctrl/Cmd + E', 'Exportar'],
  ['Ctrl/Cmd + A', 'Seleccionar todo'],
  ['Ctrl/Cmd + 0', 'Ajustar zoom'],
  ['Supr / Retroceso', 'Eliminar objeto'],
  ['Esc', 'Quitar selección'],
  ['Flechas', 'Mover selección (Shift = 10 px)'],
  ['Alt + Flechas', 'Página anterior / siguiente'],
  ['Enter', 'Editar texto seleccionado'],
  ['Shift al dibujar', 'Ángulos de 0°, 45° y 90°'],
];

export function openShortcutsDialog() {
  return openModal({
    title: 'Atajos de teclado',
    wide: true,
    build: () => el('div.modal__body', {}, [
      el('div.shortcut-list', {}, [
        ...TOOLS.map((tool) => el('div.shortcut-list__item', {}, [
          el('span', {}, [tool.label]),
          el('kbd', {}, [tool.key]),
        ])),
        ...EXTRA_SHORTCUTS.map(([keys, label]) => el('div.shortcut-list__item', {}, [
          el('span', {}, [label]),
          el('kbd', {}, [keys]),
        ])),
      ]),
    ]),
    actions: [{ label: 'Cerrar', variant: 'primary', onClick: ({ close }) => close(true) }],
  });
}
