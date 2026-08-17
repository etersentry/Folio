import { el, clear } from '../core/dom.js';

const PAGE_MIME = 'application/x-folio-page';

/**
 * Horizontal page strip: the everyday way to move around the document.
 * Pages are grouped under their section label and the active one is marked
 * with Folio's vertical red rule. Reordering by drag & drop works here too;
 * the full navigator (drawer) keeps the less frequent operations.
 */
export function mountFilmstrip({ host, prevButton, nextButton, store, thumbs, onOpenSection }) {
  let dragId = null;

  const clearMarks = () => {
    for (const node of host.querySelectorAll('.drop-before, .drop-after')) {
      node.classList.remove('drop-before', 'drop-after');
    }
  };

  /** Índice destino dentro de la sección, ya sin la página arrastrada. */
  const dropIndex = (section, referenceId, after) => {
    const list = section.pages.filter((p) => p.id !== dragId);
    if (!referenceId) return list.length;
    const index = list.findIndex((p) => p.id === referenceId);
    if (index < 0) return list.length;
    return after ? index + 1 : index;
  };

  function pageCell(section, page, number) {
    const isActive = page.id === store.activePageId;
    const node = el('button.cell', {
      type: 'button',
      role: 'tab',
      draggable: 'true',
      'aria-selected': String(isActive),
      title: `Página ${number}${page.objects.length ? '' : ' (vacía)'}`,
      class: isActive ? 'is-active' : '',
      dataset: { pageId: page.id },
      onclick: () => store.setActivePage(page.id),
      ondragstart: (event) => {
        dragId = page.id;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(PAGE_MIME, page.id);
        event.dataTransfer.setData('text/plain', `Página ${number}`);
        node.classList.add('is-dragging');
      },
      ondragend: () => { dragId = null; node.classList.remove('is-dragging'); clearMarks(); },
      ondragover: (event) => {
        if (!dragId || dragId === page.id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const rect = node.getBoundingClientRect();
        const after = event.clientX > rect.left + rect.width / 2;
        clearMarks();
        node.classList.add(after ? 'drop-after' : 'drop-before');
      },
      ondragleave: () => node.classList.remove('drop-before', 'drop-after'),
      ondrop: (event) => {
        if (!dragId) return;
        event.preventDefault();
        const rect = node.getBoundingClientRect();
        const after = event.clientX > rect.left + rect.width / 2;
        const index = dropIndex(section, page.id, after);
        const moved = dragId;
        dragId = null;
        clearMarks();
        store.movePage(moved, section.id, index);
      },
    }, [
      el('img.cell__thumb', { alt: '', src: thumbs.get(page.id) ?? BLANK, dataset: { thumbFor: page.id } }),
      el('span.cell__no', {}, [String(number)]),
    ]);
    return node;
  }

  function sectionGroup(section, startNumber) {
    const pages = el('div.group__pages', {
      ondragover: (event) => { if (dragId) event.preventDefault(); },
      ondrop: (event) => {
        if (!dragId) return;
        event.preventDefault();
        const moved = dragId;
        const index = dropIndex(section, null, true);
        dragId = null;
        clearMarks();
        store.movePage(moved, section.id, index);
      },
    }, section.pages.map((page, i) => pageCell(section, page, startNumber + i)));

    return el('div.group', { dataset: { sectionId: section.id } }, [
      el('button.group__label', {
        type: 'button',
        title: 'Abrir el navegador del documento',
        onclick: () => onOpenSection?.(section.id),
      }, [section.name]),
      pages,
    ]);
  }

  function render() {
    const left = host.scrollLeft;
    clear(host);
    let number = 1;
    for (const section of store.sections) {
      host.append(sectionGroup(section, number));
      number += section.pages.length;
    }
    host.scrollLeft = left;
    syncNav();
  }

  function syncActive() {
    for (const node of host.querySelectorAll('.cell')) {
      const active = node.dataset.pageId === store.activePageId;
      node.classList.toggle('is-active', active);
      node.setAttribute('aria-selected', String(active));
      if (active) node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function syncNav() {
    const overflow = host.scrollWidth > host.clientWidth + 2;
    for (const button of [prevButton, nextButton]) button.hidden = !overflow;
    if (!overflow) return;
    prevButton.disabled = host.scrollLeft <= 1;
    nextButton.disabled = host.scrollLeft + host.clientWidth >= host.scrollWidth - 1;
  }

  prevButton.addEventListener('click', () => host.scrollBy({ left: -240, behavior: 'smooth' }));
  nextButton.addEventListener('click', () => host.scrollBy({ left: 240, behavior: 'smooth' }));
  host.addEventListener('scroll', syncNav, { passive: true });
  window.addEventListener('resize', syncNav);

  store.on('structure', render);
  store.on('page', syncActive);
  thumbs.on('update', ({ pageId, dataUrl }) => {
    const img = host.querySelector(`img[data-thumb-for="${pageId}"]`);
    if (img) img.src = dataUrl;
  });

  render();
  return { render, syncActive };
}

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
