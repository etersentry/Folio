import { el } from '../core/dom.js';
import { openModal } from './modal.js';
import { toast, toastError } from './toasts.js';
import { EXPORT_DPI_CHOICES } from '../core/constants.js';
import {
  exportPdf, exportPageImage, exportablePages, saveExport, pixelSizeFor,
} from '../export/exporter.js';
import { supportsLossless } from '../export/pdf.js';
import { sanitizeFileName, formatBytes } from '../core/util.js';

const FORMATS = [
  { id: 'pdf', label: 'PDF', hint: 'Todas las páginas con contenido, tamaño Carta' },
  { id: 'png', label: 'PNG', hint: 'Página actual, sin pérdida' },
  { id: 'jpg', label: 'JPG', hint: 'Página actual, archivo ligero' },
];

/** Export dialog: format, file name and quality, with a live summary. */
export function openExportDialog({ store, assets }) {
  const state = {
    format: 'pdf',
    dpi: 200,
    lossless: false,
    name: sanitizeFileName(store.doc.name, 'documento'),
  };

  const pagesWithContent = exportablePages(store.doc).length;

  return openModal({
    title: 'Exportar',
    wide: true,
    build: ({ close }) => {
      const summary = el('p.empty-note');
      const status = el('p.empty-note');
      let losslessRow;

      const refresh = () => {
        const size = pixelSizeFor(state.dpi);
        summary.textContent = state.format === 'pdf'
          ? `${pagesWithContent} página${pagesWithContent === 1 ? '' : 's'} · ${size.width}×${size.height} px por página`
          : `Página actual · ${size.width}×${size.height} px`;
        if (losslessRow) losslessRow.hidden = state.format !== 'pdf';
      };

      const formatButtons = el('div.radio-cards', {}, FORMATS.map((format) => el('button.radio-card', {
        type: 'button',
        'aria-pressed': String(state.format === format.id),
        title: format.hint,
        onclick: (event) => {
          state.format = format.id;
          for (const node of event.currentTarget.parentElement.children) {
            node.setAttribute('aria-pressed', String(node === event.currentTarget));
          }
          refresh();
        },
      }, [format.label])));

      const nameInput = el('input.input', {
        type: 'text',
        value: state.name,
        'data-autofocus': '',
        'aria-label': 'Nombre del archivo',
        oninput: (event) => { state.name = event.target.value; },
      });

      const dpiSelect = el('select', {
        'aria-label': 'Resolución',
        onchange: (event) => { state.dpi = Number(event.target.value); refresh(); },
      }, EXPORT_DPI_CHOICES.map((choice) => el('option', {
        value: String(choice.dpi),
        selected: choice.dpi === state.dpi,
      }, [choice.label])));

      losslessRow = el('label.switch', {}, [
        el('input', {
          type: 'checkbox',
          disabled: !supportsLossless(),
          onchange: (event) => { state.lossless = event.target.checked; },
        }),
        el('span', {}, [
          supportsLossless()
            ? 'PDF sin pérdida (archivos más grandes)'
            : 'PDF sin pérdida no disponible en este navegador',
        ]),
      ]);

      refresh();

      const body = el('div.modal__body', {}, [
        el('div.field', {}, [el('span.field__label', {}, ['Formato']), formatButtons]),
        el('div.field', {}, [el('span.field__label', {}, ['Nombre del archivo']), nameInput]),
        el('div.field', {}, [el('span.field__label', {}, ['Resolución']), dpiSelect]),
        losslessRow,
        summary,
        status,
      ]);

      body.dataset.exportDialog = 'true';
      body.__run = async () => {
        const name = sanitizeFileName(state.name, 'documento');
        status.textContent = 'Generando…';
        try {
          if (state.format === 'pdf') {
            if (!pagesWithContent) throw new Error('No hay páginas con contenido para exportar');
            const { blob, pages } = await exportPdf(store.doc, {
              assets,
              dpi: state.dpi,
              lossless: state.lossless,
              onProgress: ({ index, total }) => {
                status.textContent = `Generando página ${Math.min(index + 1, total)} de ${total}…`;
              },
            });
            saveExport(blob, name, 'pdf');
            close(true);
            toast(`PDF exportado · ${pages} página${pages === 1 ? '' : 's'} · ${formatBytes(blob.size)}`, { type: 'ok' });
          } else {
            const page = store.activePage;
            if (!page || !page.objects.length) throw new Error('La página actual está vacía');
            const blob = await exportPageImage(page, {
              assets,
              format: state.format,
              dpi: state.dpi,
              quality: state.format === 'jpg' ? 0.94 : 1,
            });
            saveExport(blob, name, state.format === 'jpg' ? 'jpg' : 'png');
            close(true);
            toast(`Imagen exportada · ${formatBytes(blob.size)}`, { type: 'ok' });
          }
        } catch (error) {
          status.textContent = '';
          toastError(error.message ?? 'No se pudo exportar');
        }
      };

      return body;
    },
    actions: [
      { label: 'Cancelar', onClick: ({ close }) => close(false) },
      {
        label: 'Exportar',
        variant: 'primary',
        onClick: () => {
          const body = document.querySelector('[data-export-dialog="true"]');
          body?.__run?.();
        },
      },
    ],
  });
}
