import { $, isTypingTarget } from './core/dom.js';
import { PAGE, OBJECT_TYPES } from './core/constants.js';
import { clamp, debounce } from './core/util.js';
import { createDocument, createObject, contentBox, pageNumber, pageCount } from './document/model.js';
import { DocumentStore } from './document/store.js';
import { AssetLibrary } from './document/assets.js';
import { PageView } from './canvas/pageView.js';
import { TextEditor } from './canvas/textEditor.js';
import { CanvasInteractions } from './canvas/interactions.js';
import { ToolState } from './tools/toolState.js';
import { ImageImporter } from './import/images.js';
import { ProjectService } from './storage/projects.js';
import { supportsFsAccess } from './storage/fileAccess.js';
import { Preferences } from './prefs/preferences.js';
import { ThumbnailService } from './ui/thumbnails.js';
import { mountToolPanel } from './ui/toolPanel.js';
import { mountOutline } from './ui/outline.js';
import { mountProperties } from './ui/properties.js';
import { mountAppearance } from './ui/appearance.js';
import { mountShortcuts } from './ui/shortcuts.js';
import { openExportDialog } from './ui/exportDialog.js';
import { openLibraryDialog, openShortcutsDialog } from './ui/dialogs.js';
import { confirmDialog, promptDialog } from './ui/modal.js';
import { toast, toastError, toastWarn } from './ui/toasts.js';

const timeFormatter = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' });

/**
 * Application controller: owns the services, wires the UI and exposes the
 * commands that menus, dialogs and shortcuts call.
 */
export class App {
  constructor() {
    this.prefs = new Preferences();
    this.prefs.loadSync();

    this.store = new DocumentStore(createDocument());
    this.assets = new AssetLibrary(this.store);
    this.tools = new ToolState();
    this.projects = new ProjectService({ store: this.store });
    this.importer = new ImageImporter({ store: this.store, assets: this.assets });
    this.thumbs = new ThumbnailService({ store: this.store, assets: this.assets });

    this.view = new PageView({
      store: this.store,
      assets: this.assets,
      stage: $('#stage'),
      shell: $('#pageShell'),
      pageCanvas: $('#pageCanvas'),
      overlayCanvas: $('#overlayCanvas'),
    });
    this.textEditor = new TextEditor({ textarea: $('#textEditor'), view: this.view, store: this.store });
    this.interactions = new CanvasInteractions({
      view: this.view,
      store: this.store,
      tools: this.tools,
      textEditor: this.textEditor,
      canvas: $('#overlayCanvas'),
    });

    this.commands = this.#buildCommands();
    this.#mountUi();
    this.#wireDocumentEvents();
    this.#wireStorage();
  }

  /* ── Boot ──────────────────────────────────────────────────────────── */

  async start() {
    await this.prefs.loadAsync();
    this.tools.hydrate(this.prefs.values.toolStyle);

    const recoverable = await this.projects.findRecoverableSession();
    if (recoverable) {
      await this.projects.adoptSession(recoverable.record);
      const when = timeFormatter.format(new Date(recoverable.record.updatedAt));
      toast(`Sesión recuperada · «${recoverable.record.name}» (${when})`, {
        type: 'ok',
        timeout: 7000,
        actions: [{ label: 'Empezar en blanco', onClick: () => this.commands.newProject({ force: true }) }],
      });
    } else {
      await this.projects.adoptNew();
    }

    this.view.zoomToFit();
    this.thumbs.invalidateAll();
    this.#syncAll();
  }

  /* ── Commands ──────────────────────────────────────────────────────── */

  #buildCommands() {
    const { store, projects } = this;

    return {
      newProject: async ({ force = false } = {}) => {
        if (!force && projects.dirty) {
          const ok = await confirmDialog({
            title: 'Nuevo proyecto',
            message: 'Hay cambios sin guardar. El proyecto actual queda en la biblioteca local, pero conviene guardarlo en un archivo antes de continuar.',
            confirmLabel: 'Crear nuevo',
          });
          if (!ok) return;
        }
        const name = await promptDialog({
          title: 'Nuevo proyecto',
          label: 'Nombre del proyecto',
          value: 'Proyecto sin título',
          confirmLabel: 'Crear',
        });
        if (name === null) return;
        store.load(createDocument(name));
        await projects.adoptNew();
        this.#syncAll();
        toast('Proyecto nuevo creado', { type: 'ok' });
      },

      open: async () => {
        const list = await projects.list();
        await openLibraryDialog({
          projects: list,
          fsAvailable: supportsFsAccess(),
          onOpen: async (id) => {
            try {
              await projects.openFromLibrary(id);
              this.#syncAll();
              this.view.zoomToFit();
              toast('Proyecto abierto', { type: 'ok' });
            } catch (error) {
              toastError(error.message ?? 'No se pudo abrir el proyecto');
            }
          },
          onDelete: (id) => projects.remove(id),
          onImportFile: async () => {
            try {
              if (supportsFsAccess()) {
                const doc = await projects.openFromFilePicker();
                if (doc) {
                  this.#syncAll();
                  this.view.zoomToFit();
                  toast(`«${doc.name}» abierto`, { type: 'ok' });
                }
              } else {
                $('#fileProject').click();
              }
            } catch (error) {
              if (error?.name !== 'AbortError') toastError(error.message ?? 'No se pudo abrir el archivo');
            }
          },
        });
      },

      openProjectFile: async (file) => {
        try {
          const doc = await projects.openFromFile(file);
          this.#syncAll();
          this.view.zoomToFit();
          toast(`«${doc.name}» abierto`, { type: 'ok' });
        } catch (error) {
          toastError(error.message ?? 'No se pudo leer el archivo');
        }
      },

      save: async ({ saveAs = false } = {}) => {
        try {
          const result = await projects.save({ saveAs });
          if (result?.cancelled) return;
          const where = {
            file: 'Proyecto guardado en el archivo',
            download: 'Proyecto descargado como archivo .folio',
            library: 'Proyecto guardado en la biblioteca local',
          }[result?.target] ?? 'Proyecto guardado';
          toast(where, { type: 'ok' });
        } catch (error) {
          toastError(error.message ?? 'No se pudo guardar el proyecto');
        }
      },

      exportDialog: () => openExportDialog({ store, assets: this.assets }),

      importImages: async (files, { point = null } = {}) => {
        if (!files?.length) return;
        try {
          const result = await this.importer.import(files, { point });
          if (result.inserted) {
            const pages = result.pagesAdded ? ` · ${result.pagesAdded} página(s) nueva(s)` : '';
            toast(`${result.inserted} imagen(es) insertada(s)${pages}`, { type: 'ok' });
          }
          if (result.skipped.length) {
            toastWarn(`No se pudieron insertar: ${result.skipped.join(', ')}`);
          }
        } catch (error) {
          toastError(error.message ?? 'No se pudieron insertar las imágenes');
        }
      },

      insertTextObject: (text, point = null) => {
        const box = contentBox();
        const object = createObject(OBJECT_TYPES.text, {
          x: point?.x ?? box.x,
          y: point?.y ?? box.y,
          w: 280,
          text,
          color: this.tools.style.textColor,
          fontSize: this.tools.style.fontSize,
          border: { ...this.tools.style.textBorder },
        });
        store.addObjects([object], { reason: 'text:paste' });
      },

      fitImageToContent: (ids) => {
        const box = contentBox();
        store.updateObjects(ids, (obj) => {
          if (obj.type !== OBJECT_TYPES.image) return null;
          const scale = box.w / obj.w;
          return { x: box.x, w: box.w, h: obj.h * scale };
        }, { reason: 'image:fit' });
      },

      resetImageScale: (ids) => {
        store.updateObjects(ids, (obj) => {
          if (obj.type !== OBJECT_TYPES.image) return null;
          const w = Math.min(obj.naturalWidth, PAGE.width - PAGE.margin * 2);
          const h = obj.naturalHeight * (w / obj.naturalWidth);
          return { w, h };
        }, { reason: 'image:reset' });
      },

      showShortcuts: () => openShortcutsDialog(),
    };
  }

  /* ── UI wiring ─────────────────────────────────────────────────────── */

  #mountUi() {
    const { store, tools, view, commands } = this;

    mountToolPanel({ host: $('#toolGrid'), tools });
    mountOutline({ host: $('#outline'), store, thumbs: this.thumbs });
    mountProperties({
      host: $('#props'),
      titleEl: $('#propsTitle'),
      scopeEl: $('#propsScope'),
      store, tools, commands,
    });
    mountAppearance({ button: $('#btnAppearance'), prefs: this.prefs });
    mountShortcuts({ store, tools, view, textEditor: this.textEditor, commands });

    $('#btnUndo').addEventListener('click', () => store.undo());
    $('#btnRedo').addEventListener('click', () => store.redo());
    $('#btnNew').addEventListener('click', () => commands.newProject());
    $('#btnOpen').addEventListener('click', () => commands.open());
    $('#btnSave').addEventListener('click', () => commands.save());
    $('#btnExport').addEventListener('click', () => commands.exportDialog());
    $('#btnHelp').addEventListener('click', () => commands.showShortcuts());

    // El inspector se puede plegar: el documento gana toda la mesa.
    const inspectorBtn = $('#btnInspector');
    const syncInspector = () => {
      const visible = this.prefs.values.inspector !== false;
      document.body.dataset.inspector = visible ? 'on' : 'off';
      inspectorBtn.setAttribute('aria-pressed', String(visible));
      inspectorBtn.title = visible ? 'Ocultar inspector' : 'Mostrar inspector';
    };
    inspectorBtn.addEventListener('click', () => {
      this.prefs.set({ inspector: this.prefs.values.inspector === false });
      syncInspector();
    });
    this.prefs.on('change', syncInspector);
    syncInspector();
    $('#btnAddSection').addEventListener('click', () => store.addSection());

    $('#btnImportImages').addEventListener('click', () => $('#fileImages').click());
    $('#fileImages').addEventListener('change', (event) => {
      commands.importImages([...event.target.files]);
      event.target.value = '';
    });
    $('#fileProject').addEventListener('change', (event) => {
      const [file] = event.target.files;
      if (file) commands.openProjectFile(file);
      event.target.value = '';
    });

    const nameInput = $('#projectName');
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') nameInput.blur();   // hand the keyboard back to the canvas
      if (event.key === 'Escape') { nameInput.value = store.doc.name; nameInput.blur(); }
    });
    nameInput.addEventListener('change', () => {
      const name = nameInput.value.trim() || 'Proyecto sin título';
      nameInput.value = name;
      store.rename(name);
    });

    $('#btnZoomIn').addEventListener('click', () => view.zoomStep(1));
    $('#btnZoomOut').addEventListener('click', () => view.zoomStep(-1));
    $('#btnZoomFit').addEventListener('click', () => view.zoomToFit());
    view.on('zoom', ({ zoom, fit }) => {
      $('#btnZoomFit').textContent = `${Math.round(zoom * 100)}%`;
      $('#btnZoomFit').title = fit ? 'Ajustado a la ventana' : 'Ajustar a la ventana';
    });

    // Ctrl + wheel zooms; plain wheel keeps scrolling the stage.
    $('#stage').addEventListener('wheel', (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      view.setZoom(clamp(view.zoom * (event.deltaY < 0 ? 1.12 : 0.89), 0.1, 5));
    }, { passive: false });

    this.#wireClipboard();
    this.#wireDropZone();
    this.tools.on('style', debounce(() => this.prefs.set({ toolStyle: this.tools.style }, { silent: true }), 500));
  }

  #wireClipboard() {
    document.addEventListener('paste', async (event) => {
      if (this.textEditor.isOpen || isTypingTarget(event.target)) return;
      const blobs = ImageImporter.blobsFromClipboard(event);
      if (blobs.length) {
        event.preventDefault();
        await this.commands.importImages(blobs);
        return;
      }
      const text = event.clipboardData?.getData('text/plain')?.trim();
      if (text) {
        event.preventDefault();
        this.commands.insertTextObject(text);
      }
    });
  }

  #wireDropZone() {
    const veil = $('#dropVeil');
    let depth = 0;

    const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');

    window.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return;
      depth += 1;
      veil.hidden = false;
    });
    window.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) veil.hidden = true;
    });
    window.addEventListener('drop', async (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      veil.hidden = true;

      const files = [...event.dataTransfer.files];
      const projectFile = files.find((f) => /\.(folio|json)$/i.test(f.name));
      if (projectFile && files.length === 1) {
        await this.commands.openProjectFile(projectFile);
        return;
      }
      const overCanvas = event.target === $('#overlayCanvas');
      const point = overCanvas ? this.view.toPagePoint(event.clientX, event.clientY) : null;
      await this.commands.importImages(files.filter((f) => ImageImporter.isImageFile(f)), { point });
    });
  }

  /* ── Reactive glue ─────────────────────────────────────────────────── */

  #wireDocumentEvents() {
    const { store } = this;

    store.on('history', ({ canUndo, canRedo }) => {
      $('#btnUndo').disabled = !canUndo;
      $('#btnRedo').disabled = !canRedo;
    });

    const syncStatus = () => this.#syncDocStatus();
    store.on('change', ({ live }) => { if (!live) syncStatus(); });
    store.on('page', syncStatus);
    store.on('selection', syncStatus);

    this.tools.on('tool', () => this.#syncHint());
    this.view.on('zoom', () => this.#syncHint());
  }

  #wireStorage() {
    this.projects.on('status', ({ state, at }) => this.#syncSaveStatus(state, at));
    this.projects.on('error', ({ message }) => {
      toastError(message);
      this.#syncSaveStatus('error');
    });
    this.projects.on('warning', ({ message }) => toastWarn(message));

    window.addEventListener('beforeunload', (event) => {
      if (!this.projects.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  #syncAll() {
    $('#projectName').value = this.store.doc.name;
    this.thumbs.invalidateAll();
    this.#syncDocStatus();
    this.#syncHint();
    $('#btnUndo').disabled = !this.store.canUndo;
    $('#btnRedo').disabled = !this.store.canRedo;
  }

  #syncDocStatus() {
    const { store } = this;
    const page = store.activePage;
    const total = pageCount(store.doc);
    const index = page ? pageNumber(store.doc, page.id) : 0;
    const selected = store.selectionIds.length;
    const section = store.activeSection;

    $('#statusDoc').textContent = [
      section ? section.name : '',
      `Página ${index} de ${total}`,
      page ? `${page.objects.length} objeto${page.objects.length === 1 ? '' : 's'}` : '',
      selected ? `${selected} seleccionado${selected === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' · ');

    const empty = total === 1 && !(page?.objects.length);
    $('#stageHint').hidden = !empty;
  }

  #syncHint() {
    const tool = this.tools.toolDef;
    const hints = {
      select: 'Arrastra para mover · Shift para selección múltiple',
      box: 'Arrastra para dibujar · Shift para cuadrado',
      marker: 'Arrastra horizontalmente sobre el texto a marcar',
      highlight: 'Arrastra para resaltar un área',
      arrow: 'Shift para ángulos de 0°, 45° y 90°',
      line: 'Shift para ángulos de 0°, 45° y 90°',
      ellipse: 'Shift para círculo perfecto',
      text: 'Clic para escribir · doble clic para editar',
      eraser: 'Arrastra sobre las anotaciones para borrarlas',
    };
    $('#statusHint').textContent = `${tool?.label ?? ''} · ${hints[this.tools.tool] ?? ''}`;
  }

  #syncSaveStatus(state, at) {
    const node = $('#statusSave');
    const dot = $('#dirtyDot');
    node.classList.remove('is-error', 'is-ok');

    switch (state) {
      case 'dirty':
        node.textContent = 'Cambios sin guardar';
        dot.hidden = false;
        break;
      case 'saving':
        node.textContent = 'Guardando…';
        dot.hidden = false;
        break;
      case 'autosaved':
        node.textContent = `Autoguardado ${timeFormatter.format(new Date(at ?? Date.now()))}`;
        node.classList.add('is-ok');
        dot.hidden = true;
        break;
      case 'recovered':
        node.textContent = 'Sesión recuperada';
        node.classList.add('is-ok');
        dot.hidden = true;
        break;
      case 'error':
        node.textContent = 'Error de almacenamiento';
        node.classList.add('is-error');
        dot.hidden = false;
        break;
      default:
        node.textContent = `Guardado ${timeFormatter.format(new Date(at ?? Date.now()))}`;
        node.classList.add('is-ok');
        dot.hidden = true;
    }
  }
}
