import { el, clear, icon } from '../core/dom.js';
import { confirmDialog } from './modal.js';

const PAGE_MIME = 'application/x-folio-page';
const SECTION_MIME = 'application/x-folio-section';

const ICONS = {
  chevron: ['m7 10 5 5 5-5'],
  plus: ['M12 6v12M6 12h12'],
  copy: ['M9 9h10v10H9z', 'M5 15V5h10'],
  trash: ['M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12'],
};

/**
 * Sections and pages: rename, add, duplicate, delete, collapse, reorder by
 * drag & drop, live thumbnails and click-to-navigate.
 */
export function mountOutline({ host, store, thumbs }) {
  let dragging = null; // { type: 'page' | 'section', id }

  const iconButton = (paths, { title, onClick, danger = false, disabled = false }) => el(
    `button.btn.icon.sm.ghost${danger ? '.danger' : ''}`,
    {
      type: 'button', title, 'aria-label': title, disabled,
      onclick: (event) => { event.stopPropagation(); onClick(); },
    },
    [icon(paths, 14)],
  );

  const clearDropMarkers = () => {
    for (const node of host.querySelectorAll('.drop-before, .drop-after, .is-drop-target')) {
      node.classList.remove('drop-before', 'drop-after', 'is-drop-target');
    }
  };

  /** Destination index inside `sectionId`, ignoring the page being dragged. */
  const dropIndex = (sectionId, referencePageId, after) => {
    const section = store.sections.find((s) => s.id === sectionId);
    if (!section) return 0;
    const list = section.pages.filter((p) => p.id !== dragging?.id);
    if (!referencePageId) return list.length;
    const index = list.findIndex((p) => p.id === referencePageId);
    if (index < 0) return list.length;
    return after ? index + 1 : index;
  };

  function renderPage(section, page, number) {
    const isActive = page.id === store.activePageId;
    const node = el('div.page-item', {
      draggable: 'true',
      role: 'treeitem',
      tabindex: '0',
      'aria-selected': String(isActive),
      class: isActive ? 'is-active' : '',
      dataset: { pageId: page.id, sectionId: section.id },
      onclick: () => store.setActivePage(page.id),
      onkeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          store.setActivePage(page.id);
        }
      },
      ondragstart: (event) => {
        dragging = { type: 'page', id: page.id };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(PAGE_MIME, page.id);
        event.dataTransfer.setData('text/plain', page.name ?? 'Página');
        node.classList.add('is-dragging');
      },
      ondragend: () => {
        dragging = null;
        node.classList.remove('is-dragging');
        clearDropMarkers();
      },
      ondragover: (event) => {
        if (dragging?.type !== 'page' || dragging.id === page.id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const rect = node.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        clearDropMarkers();
        node.classList.add(after ? 'drop-after' : 'drop-before');
      },
      ondragleave: () => node.classList.remove('drop-before', 'drop-after'),
      ondrop: (event) => {
        if (dragging?.type !== 'page') return;
        event.preventDefault();
        event.stopPropagation();
        const rect = node.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        const index = dropIndex(section.id, page.id, after);
        const movedId = dragging.id;
        clearDropMarkers();
        dragging = null;
        store.movePage(movedId, section.id, index);
      },
    });

    const thumb = el('img.page-thumb', {
      alt: '',
      src: thumbs.get(page.id) ?? TRANSPARENT_PIXEL,
      dataset: { thumbFor: page.id },
    });

    node.append(
      thumb,
      el('div.page-item__meta', {}, [
        el('span.page-item__name', {}, [`Página ${number}`]),
        el('span.page-item__sub', {}, [
          page.objects.length ? `${page.objects.length} objeto${page.objects.length === 1 ? '' : 's'}` : 'Vacía',
        ]),
      ]),
      el('div.page-item__actions', {}, [
        iconButton(ICONS.copy, { title: 'Duplicar página', onClick: () => store.duplicatePage(page.id) }),
        iconButton(ICONS.trash, {
          title: 'Eliminar página',
          danger: true,
          onClick: () => store.removePage(page.id),
        }),
      ]),
    );
    return node;
  }

  function renderSection(section, startNumber) {
    const nameInput = el('input.section__name', {
      type: 'text',
      value: section.name,
      'aria-label': `Nombre de la sección ${section.name}`,
      onchange: (event) => store.renameSection(section.id, event.target.value.trim() || section.name),
      onkeydown: (event) => { if (event.key === 'Enter') event.target.blur(); },
      onclick: (event) => event.stopPropagation(),
    });

    const pagesHost = el('div.section__pages', { role: 'group' });
    section.pages.forEach((page, i) => pagesHost.append(renderPage(section, page, startNumber + i)));

    const node = el('div.section', {
      dataset: { sectionId: section.id },
      role: 'treeitem',
      'aria-expanded': String(!section.collapsed),
      ondragover: (event) => {
        if (!dragging) return;
        event.preventDefault();
        if (dragging.type === 'page') node.classList.add('is-drop-target');
      },
      ondragleave: () => node.classList.remove('is-drop-target'),
      ondrop: (event) => {
        if (!dragging) return;
        event.preventDefault();
        node.classList.remove('is-drop-target');
        if (dragging.type === 'page') {
          const movedId = dragging.id;
          const index = dropIndex(section.id, null, true);
          dragging = null;
          store.movePage(movedId, section.id, index);
        } else if (dragging.type === 'section' && dragging.id !== section.id) {
          const target = store.sections.findIndex((s) => s.id === section.id);
          const movedId = dragging.id;
          dragging = null;
          store.moveSection(movedId, target);
        }
      },
    }, [
      el('div.section__head', {
        draggable: 'true',
        ondragstart: (event) => {
          dragging = { type: 'section', id: section.id };
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(SECTION_MIME, section.id);
        },
        ondragend: () => { dragging = null; clearDropMarkers(); },
      }, [
        el('button.section__toggle', {
          type: 'button',
          'aria-expanded': String(!section.collapsed),
          'aria-label': section.collapsed ? 'Expandir sección' : 'Contraer sección',
          onclick: () => store.toggleSection(section.id),
        }, [icon(ICONS.chevron, 16)]),
        nameInput,
        el('span.section__count', {}, [String(section.pages.length)]),
        iconButton(ICONS.plus, {
          title: 'Añadir página',
          onClick: () => store.addPage(section.id, { afterPageId: section.pages.at(-1)?.id ?? null }),
        }),
        iconButton(ICONS.trash, {
          title: 'Eliminar sección',
          danger: true,
          disabled: store.sections.length <= 1,
          onClick: async () => {
            const ok = section.pages.some((p) => p.objects.length)
              ? await confirmDialog({
                title: 'Eliminar sección',
                message: `«${section.name}» contiene páginas con contenido. Se eliminarán junto con la sección.`,
                confirmLabel: 'Eliminar',
                danger: true,
              })
              : true;
            if (ok) store.removeSection(section.id);
          },
        }),
      ]),
      section.collapsed ? null : pagesHost,
    ]);

    return node;
  }

  function render() {
    const scrollTop = host.scrollTop;
    clear(host);
    let number = 1;
    for (const section of store.sections) {
      host.append(renderSection(section, number));
      number += section.pages.length;
    }
    host.scrollTop = scrollTop;
  }

  function syncActive() {
    for (const node of host.querySelectorAll('.page-item')) {
      const isActive = node.dataset.pageId === store.activePageId;
      node.classList.toggle('is-active', isActive);
      node.setAttribute('aria-selected', String(isActive));
      if (isActive) node.scrollIntoView({ block: 'nearest' });
    }
  }

  /** Keeps the "N objetos" label honest without a full re-render. */
  function syncCounts() {
    const byId = new Map();
    for (const section of store.sections) for (const page of section.pages) byId.set(page.id, page);
    for (const node of host.querySelectorAll('.page-item')) {
      const page = byId.get(node.dataset.pageId);
      const label = node.querySelector('.page-item__sub');
      if (!page || !label) continue;
      label.textContent = page.objects.length
        ? `${page.objects.length} objeto${page.objects.length === 1 ? '' : 's'}`
        : 'Vacía';
    }
  }

  store.on('structure', render);
  store.on('page', syncActive);
  store.on('change', ({ live, structural }) => {
    if (live || structural) return;
    syncCounts();
  });
  thumbs.on('update', ({ pageId, dataUrl }) => {
    const img = host.querySelector(`img[data-thumb-for="${pageId}"]`);
    if (img) img.src = dataUrl;
  });

  render();
  return { render, syncActive };
}

const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
