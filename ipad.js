/* ═══════════════════════════════════════════════════════════
   KITA-PORTFOLIO-STUDIO – Tablet & iPad Applikations-Logik
   Reines clientseitiges JavaScript für Touch-Steuerung, Zoom/Pan & Single-Sidebar
   ═══════════════════════════════════════════════════════════ */

// ─── Globale Referenzen ──────────────────────────────────
let fabricCanvas = null;
let activePageId = null; // ID der aktuell geladenen Seite
let currentBgColorVal = '#ffffff'; // Aktueller Hintergrund (Farbe oder Verlauf)

// Zoom & Pan State
let zoomLevel = 1;
const ZOOM_STEP = 0.15;
let isPanning = false;
let panActive = false;
let lastPosX = 0;
let lastPosY = 0;

// DIN A4 bei 72 DPI: 595 × 842 Pixel
const CANVAS_WIDTH  = 595;
const CANVAS_HEIGHT = 842;

// Storage Keys
const STORAGE_KEY_PAGES    = 'kita_portfolio_pages';
const STORAGE_KEY_CHILDREN = 'kita_portfolio_children';
const STORAGE_KEY_SELECTED = 'kita_portfolio_selected_child';

// ─── DOM Ready ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initIpadLayout();
  initCanvas();
  initChildManagement();
  initMediaUpload();
  initStickers();
  initTextTools();
  initCanvasToolbar();
  initProjectActions();
  initArchive();
  initBackgroundColor();
});

/* ═══════════════════════════════════════════════════════════
   1. IPAD-LAYOUT & INTERAKTION (TABS, DRAWER, ZOOM, PAN)
   ═══════════════════════════════════════════════════════════ */

function initIpadLayout() {
  // 1. Sidebar-Drawer-Steuerung (für Portrait-Modus)
  const sidebar = document.getElementById('sidebar-container');
  const toggleBtn = document.getElementById('btn-toggle-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');

  if (toggleBtn && sidebar && backdrop) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      backdrop.style.display = sidebar.classList.contains('open') ? 'block' : 'none';
    });

    backdrop.addEventListener('click', () => {
      sidebar.classList.remove('open');
      backdrop.style.display = 'none';
    });
  }

  // 2. Tab-Umschalter
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      
      // Buttons aktualisieren
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Inhalte umschalten
      tabContents.forEach(content => {
        if (content.id === tabId) {
          content.classList.add('active');
          content.style.display = 'block';
        } else {
          content.classList.remove('active');
          content.style.display = 'none';
        }
      });

      // Beim Tab-Wechsel im Hochformat die Sidebar schließen, um Platz zu machen (außer bei Klick)
      if (window.innerWidth < 1024) {
        // Optionale Verzögerung
      }
    });
  });

  // 3. Zoom-Steuerung
  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    zoomLevel = Math.min(4, zoomLevel + ZOOM_STEP);
    applyZoom();
  });

  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    zoomLevel = Math.max(0.2, zoomLevel - ZOOM_STEP);
    applyZoom();
  });

  document.getElementById('btn-zoom-fit').addEventListener('click', () => {
    zoomLevel = 1;
    applyZoom();
  });

  // 4. Pan-Modus (Verschieben-Modus mit der Hand)
  document.getElementById('btn-pan-mode').addEventListener('click', togglePanMode);
}

function applyZoom() {
  if (!fabricCanvas) return;
  fabricCanvas.setZoom(zoomLevel);
  fabricCanvas.setWidth(CANVAS_WIDTH * zoomLevel);
  fabricCanvas.setHeight(CANVAS_HEIGHT * zoomLevel);
  fabricCanvas.renderAll();
  showToast(`Zoom: ${Math.round(zoomLevel * 100)}%`, 'info');
}

function togglePanMode() {
  panActive = !panActive;
  const btn = document.getElementById('btn-pan-mode');
  
  if (panActive) {
    btn.classList.add('active');
    fabricCanvas.defaultCursor = 'grab';
    // Zeichnen-Modus beenden falls aktiv
    fabricCanvas.isDrawingMode = false;
    // Objekte nicht auswählbar machen, damit man den Hintergrund verschieben kann
    fabricCanvas.forEachObject(obj => {
      obj.selectable = false;
      obj.evented = false;
    });
    showToast('Hand-Modus aktiv: Ziehe zum Verschieben der Seite ✋', 'info');
  } else {
    btn.classList.remove('active');
    fabricCanvas.defaultCursor = 'default';
    fabricCanvas.forEachObject(obj => {
      obj.selectable = true;
      obj.evented = true;
    });
    showToast('Auswahl-Modus aktiv 🎯', 'info');
  }
  fabricCanvas.discardActiveObject();
  fabricCanvas.renderAll();
}

/* ═══════════════════════════════════════════════════════════
   2. CANVAS INITIALISIERUNG & Klick-Transparenz
   ═══════════════════════════════════════════════════════════ */

function initCanvas() {
  // Klick-Transparenz global für alle Bilder aktivieren
  fabric.Image.prototype.perPixelTargetFind = true;

  // containsPoint-Override für echte Geometrie des clipPath (Klick-Transparenz im abgeschnittenen Bereich)
  fabric.Object.prototype.containsPoint = (function(oldContainsPoint) {
    function isPointInClipPath(object, point) {
      try {
        const clipPath = object.clipPath;
        if (!clipPath) return true;
        let localPoint = clipPath.absolutePositioned ? point : object.toLocalPoint(point, 'center', 'center');
        let pt = new fabric.Point(localPoint.x - (clipPath.left || 0), localPoint.y - (clipPath.top || 0));
        if (clipPath.angle) {
          const rad = -fabric.util.degreesToRadians(clipPath.angle);
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          pt = new fabric.Point(pt.x * cos - pt.y * sin, pt.x * sin + pt.y * cos);
        }
        pt.x /= (clipPath.scaleX || 1);
        pt.y /= (clipPath.scaleY || 1);

        if (clipPath.type === 'circle') {
          return Math.sqrt(pt.x * pt.x + pt.y * pt.y) <= clipPath.radius;
        } else if (clipPath.type === 'polygon') {
          const vs = clipPath.points || [];
          const x = pt.x, y = pt.y;
          let inside = false;
          for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
            const xi = vs[i].x, yi = vs[i].y;
            const xj = vs[j].x, yj = vs[j].y;
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
          }
          return inside;
        } else if (clipPath.type === 'path') {
          const pathString = clipPath.path.map(cmd => cmd.join(' ')).join(' ');
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = 1; tempCanvas.height = 1;
          const tempCtx = tempCanvas.getContext('2d');
          const path2d = new Path2D(pathString);
          return tempCtx.isPointInPath(path2d, pt.x, pt.y);
        }
        const w2 = (clipPath.width || 0) / 2;
        const h2 = (clipPath.height || 0) / 2;
        return pt.x >= -w2 && pt.x <= w2 && pt.y >= -h2 && pt.y <= h2;
      } catch (e) {
        return true;
      }
    }
    return function(point, tBi, useSubTargets) {
      const isInsideBBox = oldContainsPoint.call(this, point, tBi, useSubTargets);
      if (!isInsideBBox) return false;
      return isPointInClipPath(this, point);
    };
  })(fabric.Object.prototype.containsPoint);

  // Canvas erstellen
  fabricCanvas = new fabric.Canvas('portfolio-canvas', {
    width:           CANVAS_WIDTH,
    height:          CANVAS_HEIGHT,
    backgroundColor: '#ffffff',
    selection:       true
  });

  // Pan-Dragging Handler registrieren
  fabricCanvas.on('mouse:down', function(opt) {
    if (panActive) {
      isPanning = true;
      fabricCanvas.defaultCursor = 'grabbing';
      const e = opt.e;
      lastPosX = e.touches ? e.touches[0].clientX : e.clientX;
      lastPosY = e.touches ? e.touches[0].clientY : e.clientY;
    }
  });

  fabricCanvas.on('mouse:move', function(opt) {
    if (isPanning && panActive) {
      const e = opt.e;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      
      const wrapper = document.getElementById('canvas-wrapper');
      wrapper.scrollLeft -= (clientX - lastPosX);
      wrapper.scrollTop -= (clientY - lastPosY);
      
      lastPosX = clientX;
      lastPosY = clientY;
    }
  });

  fabricCanvas.on('mouse:up', function() {
    if (panActive) {
      isPanning = false;
      fabricCanvas.defaultCursor = 'grab';
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   3. KINDER-VERWALTUNG
   ═══════════════════════════════════════════════════════════ */

function initChildManagement() {
  const select = document.getElementById('child-select');
  const input  = document.getElementById('child-name-input');
  const btnAdd = document.getElementById('btn-add-child');
  const btnDel = document.getElementById('btn-remove-child');

  function renderSelect() {
    const children = loadChildren();
    select.innerHTML = '<option value="">— Bitte wählen —</option>';
    children.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      select.appendChild(opt);
    });
    const lastSelected = localStorage.getItem(STORAGE_KEY_SELECTED);
    if (lastSelected && children.includes(lastSelected)) {
      select.value = lastSelected;
    }
  }

  btnAdd.addEventListener('click', () => {
    const name = input.value.trim();
    if (!name) return;
    const children = loadChildren();
    if (children.includes(name)) {
      showToast('Kind existiert bereits.', 'warning');
      return;
    }
    children.push(name);
    children.sort((a, b) => a.localeCompare(b, 'de'));
    saveChildren(children);
    input.value = '';
    renderSelect();
    select.value = name;
    localStorage.setItem(STORAGE_KEY_SELECTED, name);
    showToast(`Kind "${name}" hinzugefügt.`, 'success');
  });

  btnDel.addEventListener('click', () => {
    const name = select.value;
    if (!name) { showToast('Wähle zuerst ein Kind aus.', 'error'); return; }
    if (!confirm(`Kind "${name}" und alle seine archivierten Seiten wirklich löschen?`)) return;

    let children = loadChildren();
    children = children.filter(c => c !== name);
    saveChildren(children);

    let pages = loadSavedPages();
    pages = pages.filter(p => p.child !== name);
    saveSavedPages(pages);

    localStorage.removeItem(STORAGE_KEY_SELECTED);
    renderSelect();
    clearCanvasNoConfirm();
    showToast(`Kind "${name}" gelöscht.`, 'info');
  });

  select.addEventListener('change', () => {
    localStorage.setItem(STORAGE_KEY_SELECTED, select.value);
  });

  renderSelect();
}

function loadChildren() {
  const stored = localStorage.getItem(STORAGE_KEY_CHILDREN);
  return stored ? JSON.parse(stored) : [];
}

function saveChildren(children) {
  localStorage.setItem(STORAGE_KEY_CHILDREN, JSON.stringify(children));
}

/* ═══════════════════════════════════════════════════════════
   4. BILDER HOCHLADEN
   ═══════════════════════════════════════════════════════════ */

function initMediaUpload() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  // Datei ausgewählt
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleImageFile(file);
    fileInput.value = ''; // Reset für erneuten Upload derselben Datei
  });

  // Einfache Klick-Weiterleitung auf mobilen Geräten
  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  // Verhindert doppeltes Öffnen des Dialogs durch Event-Bubbling
  fileInput.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

function handleImageFile(file) {
  if (!file.type.startsWith('image/')) {
    showToast('Nur Bilder sind erlaubt!', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (fEvent) => {
    loadImageToCanvas(fEvent.target.result);
  };
  reader.readAsDataURL(file);
}

function loadImageToCanvas(dataUrl) {
  showToast('Bild wird geladen…', 'info');
  fabric.Image.fromURL(dataUrl, (img) => {
    const maxDim = 320;
    let width = img.width;
    let height = img.height;

    if (width > maxDim || height > maxDim) {
      if (width > height) {
        height = (maxDim / width) * height;
        width = maxDim;
      } else {
        width = (maxDim / height) * width;
        height = maxDim;
      }
    }

    img.set({
      left:               50,
      top:                100,
      width:              img.width,
      height:             img.height,
      scaleX:             width / img.width,
      scaleY:             height / img.height,
      cornerColor:        '#6366f1',
      cornerStrokeColor:  '#ffffff',
      cornerSize:         10,
      transparentCorners: false,
      padding:            5,
      perPixelTargetFind: true
    });

    fabricCanvas.add(img);
    fabricCanvas.setActiveObject(img);
    fabricCanvas.renderAll();
    showToast('Bild hinzugefügt ✓', 'success');
  }, { crossOrigin: 'anonymous' });
}

/* ═══════════════════════════════════════════════════════════
   5. STICKER-KISTE
   ═══════════════════════════════════════════════════════════ */

function initStickers() {
  // Umschaltung der Sticker-Kategorie-Tabs
  const tabBtns = document.querySelectorAll('.sticker-tab-btn');
  const grids = document.querySelectorAll('.sticker-cat-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      grids.forEach(g => {
        if (g.id === targetId) {
          g.classList.add('active');
          g.style.display = 'grid';
        } else {
          g.classList.remove('active');
          g.style.display = 'none';
        }
      });
    });
  });

  // Hinzufügen von Stickern zum Canvas
  document.querySelectorAll('.sticker-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sticker = btn.getAttribute('data-sticker');
      if (!sticker) return;

      const text = new fabric.Text(sticker, {
        fontSize:           60,
        left:               150,
        top:                150,
        originX:            'center',
        originY:            'center',
        cornerColor:        '#6366f1',
        cornerStrokeColor:  '#ffffff',
        cornerSize:         10,
        transparentCorners: false,
        padding:            5
      });

      fabricCanvas.add(text);
      fabricCanvas.setActiveObject(text);
      fabricCanvas.renderAll();
      showToast('Sticker hinzugefügt! ✨', 'success');
    });
  });
}

/* ═══════════════════════════════════════════════════════════
   6. TEXTWERKZEUGE & FORMATIERUNG
   ═══════════════════════════════════════════════════════════ */

function initTextTools() {
  const textInput = document.getElementById('text-input');
  const fontSelect = document.getElementById('font-select');
  const fontSize = document.getElementById('font-size');
  const fontColor = document.getElementById('font-color');
  const headingStyle = document.getElementById('heading-style');

  // Diktierfunktion initialisieren (Sprach-zu-Text)
  const dictateBtn = document.getElementById('btn-dictate');
  if (dictateBtn) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let isListening = false;

    if (SpeechRecognition) {
      try {
        recognition = new SpeechRecognition();
        recognition.lang = 'de-DE';
        recognition.continuous = true;
        recognition.interimResults = false;

        recognition.onstart = () => {
          isListening = true;
          dictateBtn.classList.add('listening');
          showToast('Spracherkennung gestartet. Bitte sprich jetzt... 🎙️', 'success');
        };

        recognition.onresult = (event) => {
          const resultIndex = event.resultIndex;
          const transcript = event.results[resultIndex][0].transcript;
          if (textInput.value) {
            textInput.value += ' ' + transcript;
          } else {
            textInput.value = transcript;
          }
          // Event auslösen, damit Fabric.js den Text übernehmen kann
          textInput.dispatchEvent(new Event('input'));
        };

        recognition.onerror = (event) => {
          console.warn('Speech recognition error:', event.error);
          if (event.error === 'not-allowed') {
            showToast('Mikrofon-Zugriff verweigert. Bitte in den Einstellungen erlauben.', 'error');
          } else if (event.error === 'service-not-allowed') {
            showToast('Hinweis: Apple blockiert Web-Diktate in Homescreen-Apps. Nutze das Mikrofon auf der Tastatur! 🎙️', 'warning');
          } else {
            showToast('Diktierfehler: ' + event.error, 'error');
          }
          stopListening();
        };

        recognition.onend = () => {
          stopListening();
        };
      } catch (e) {
        console.error('SpeechRecognition init failed:', e);
      }

      function stopListening() {
        isListening = false;
        dictateBtn.classList.remove('listening');
        try {
          recognition.stop();
        } catch (e) {}
      }

      dictateBtn.addEventListener('click', () => {
        if (isListening) {
          stopListening();
        } else {
          try {
            recognition.start();
          } catch (err) {
            console.warn('Failed to start speech recognition:', err);
            showFallbackInstruction();
          }
        }
      });
    } else {
      dictateBtn.addEventListener('click', () => {
        showFallbackInstruction();
      });
    }
  }

  function showFallbackInstruction() {
    alert('Natives Diktieren aktivieren:\n\n1. Tippe auf das Mikrofon-Symbol 🎙️ direkt auf deiner iPad-Bildschirmtastatur (neben der Leertaste), um den Text einzusprechen.\n\n2. Falls du eine externe Tastatur verwendest, drücke die Globus-Taste 🌐 (oder Cmd) zweimal hintereinander, um das Diktieren zu starten.');
  }

  // Text-Buttons
  document.getElementById('btn-add-heading').addEventListener('click', () => {
    const raw = textInput.value.trim();
    const txt = raw || 'Überschrift';
    addStyledHeading(txt);
  });

  document.getElementById('btn-add-text').addEventListener('click', () => {
    const raw = textInput.value.trim();
    const txt = raw || 'Dein Text hier...';
    addParagraph(txt);
  });

  // Live-Synchronisation bei Text-Auswahl
  fontSelect.addEventListener('change', () => applyTextStyle('fontFamily', fontSelect.value));
  fontSize.addEventListener('input', () => applyTextStyle('fontSize', parseInt(fontSize.value, 10)));
  fontColor.addEventListener('input', () => applyTextStyle('fill', fontColor.value));
  headingStyle.addEventListener('change', applyHeadingStyleEffect);

  fabricCanvas.on('selection:created', updateTextControlsFromSelection);
  fabricCanvas.on('selection:updated', updateTextControlsFromSelection);

  function applyTextStyle(prop, val) {
    const active = fabricCanvas.getActiveObject();
    if (active && (active.type === 'textbox' || active.type === 'text' || active.type === 'i-text')) {
      active.set(prop, val);
      fabricCanvas.renderAll();
    }
  }

  function applyHeadingStyleEffect() {
    const active = fabricCanvas.getActiveObject();
    if (!active || active.type !== 'text') return;
    
    const val = headingStyle.value;
    
    // Vorherige Effekte zurücksetzen
    active.set({
      path:        null,
      shadow:      null,
      stroke:      null,
      strokeWidth: 0,
      fill:        fontColor.value
    });

    if (val === 'curved') {
      const radius = 240;
      const pathData = `M -180,0 A ${radius},${radius} 0 0,1 180,0`;
      active.set('path', new fabric.Path(pathData, { visible: false }));
    } else if (val === 'shadow') {
      active.set('shadow', new fabric.Shadow({
        color:   '#cbd5e1',
        blur:    0,
        offsetX: 4,
        offsetY: 4
      }));
    } else if (val === 'rainbow') {
      const grad = new fabric.Gradient({
        type:       'linear',
        coords:     { x1: 0, y1: 0, x2: active.width, y2: 0 },
        colorStops: [
          { offset: 0, color: '#ff4b4b' },
          { offset: 0.25, color: '#ffa200' },
          { offset: 0.5, color: '#3cd070' },
          { offset: 0.75, color: '#00c3ff' },
          { offset: 1, color: '#a200ff' }
        ]
      });
      active.set('fill', grad);
    } else if (val === 'pastel') {
      const grad = new fabric.Gradient({
        type:       'linear',
        coords:     { x1: 0, y1: 0, x2: active.width, y2: 0 },
        colorStops: [
          { offset: 0, color: '#ff9a9e' },
          { offset: 1, color: '#fecfef' }
        ]
      });
      active.set('fill', grad);
    } else if (val === 'outline') {
      active.set({
        stroke:      '#ffffff',
        strokeWidth: 3,
        shadow:      new fabric.Shadow({ color: 'rgba(0,0,0,0.15)', blur: 8, offsetX: 3, offsetY: 3 })
      });
    }

    fabricCanvas.renderAll();
  }

  function updateTextControlsFromSelection(e) {
    const activeObject = e.selected ? e.selected[0] : fabricCanvas.getActiveObject();
    const styleSection = document.getElementById('text-styling-section');

    if (activeObject && (activeObject.type === 'textbox' || activeObject.type === 'text' || activeObject.type === 'i-text')) {
      if (styleSection) styleSection.style.display = 'block';

      if (activeObject.fill && typeof activeObject.fill === 'string' && activeObject.fill.startsWith('#')) {
        fontColor.value = activeObject.fill;
      }
      if (activeObject.fontFamily) {
        fontSelect.value = activeObject.fontFamily;
      }
      if (activeObject.fontSize) {
        fontSize.value = activeObject.fontSize;
      }
      
      if (activeObject.path) {
        headingStyle.value = 'curved';
      } else if (activeObject.strokeWidth === 3) {
        headingStyle.value = 'outline';
      } else if (activeObject.shadow && activeObject.shadow.offsetX === 4) {
        headingStyle.value = 'shadow';
      } else if (activeObject.fill && activeObject.fill.colorStops) {
        const stops = activeObject.fill.colorStops;
        headingStyle.value = (stops.length === 5) ? 'rainbow' : 'pastel';
      } else {
        headingStyle.value = 'normal';
      }
    } else {
      // Wenn nichts oder kein Text ausgewählt ist, verstecken wir die Formatierung
      if (styleSection) styleSection.style.display = 'none';
    }
  }
}

function addStyledHeading(txt) {
  const fontSelect = document.getElementById('font-select').value;
  const fontSize = parseInt(document.getElementById('font-size').value, 10) * 1.5; // Überschriften sind standardmäßig größer
  const fontColor = document.getElementById('font-color').value;

  const heading = new fabric.Text(txt, {
    fontFamily:         fontSelect,
    fontSize:           fontSize,
    fill:               fontColor,
    left:               CANVAS_WIDTH / 2,
    top:                120,
    originX:            'center',
    originY:            'center',
    cornerColor:        '#6366f1',
    cornerStrokeColor:  '#ffffff',
    cornerSize:         10,
    transparentCorners: false,
    padding:            5
  });

  fabricCanvas.add(heading);
  fabricCanvas.setActiveObject(heading);
  fabricCanvas.renderAll();
  showToast('Überschrift hinzugefügt ✓', 'success');
}

function addParagraph(txt) {
  const fontSelect = document.getElementById('font-select').value;
  const fontSize = parseInt(document.getElementById('font-size').value, 10);
  const fontColor = document.getElementById('font-color').value;

  const paragraph = new fabric.Textbox(txt, {
    fontFamily:         fontSelect,
    fontSize:           fontSize,
    fill:               fontColor,
    width:              400,
    left:               50,
    top:                220,
    cornerColor:        '#6366f1',
    cornerStrokeColor:  '#ffffff',
    cornerSize:         10,
    transparentCorners: false,
    padding:            5
  });

  fabricCanvas.add(paragraph);
  fabricCanvas.setActiveObject(paragraph);
  fabricCanvas.renderAll();
  showToast('Fließtext hinzugefügt ✓', 'success');
}

/* ═══════════════════════════════════════════════════════════
   7. HINTERGRUND-PRESETS & VERLÄUFE
   ═══════════════════════════════════════════════════════════ */

const BG_PRESETS = [
  // 10 Zarte Volltonfarben (Pastelltöne)
  { name: 'Creme', value: '#FFFDF9', isGradient: false },
  { name: 'Puderrosa', value: '#FCECEF', isGradient: false },
  { name: 'Lilablüte', value: '#F6ECF5', isGradient: false },
  { name: 'Eisblau', value: '#ECF4F8', isGradient: false },
  { name: 'Zartmint', value: '#EBF7F5', isGradient: false },
  { name: 'Zitronencreme', value: '#FAF8EB', isGradient: false },
  { name: 'Pfirsich', value: '#FDF3EB', isGradient: false },
  { name: 'Hellgrau', value: '#F5F5F5', isGradient: false },
  { name: 'Lavendelblüte', value: '#FFF0F5', isGradient: false },
  { name: 'Elfenbein', value: '#FFF8DC', isGradient: false },

  // 10 Zarte Farbverläufe (Gradients)
  { name: 'Träumender Pfirsich', value: 'gradient:linear:#FFD1DC:#FFDAC1', isGradient: true, colors: ['#FFD1DC', '#FFDAC1'] },
  { name: 'Frische Minze', value: 'gradient:linear:#E0F7FA:#C8E6C9', isGradient: true, colors: ['#E0F7FA', '#C8E6C9'] },
  { name: 'Lavendelhimmel', value: 'gradient:linear:#E1BEE7:#B3E5FC', isGradient: true, colors: ['#E1BEE7', '#B3E5FC'] },
  { name: 'Warmes Rouge', value: 'gradient:linear:#FFF3E0:#F8BBD0', isGradient: true, colors: ['#FFF3E0', '#F8BBD0'] },
  { name: 'Zitronensorbet', value: 'gradient:linear:#FFF9C4:#FFE0B2', isGradient: true, colors: ['#FFF9C4', '#FFE0B2'] },
  { name: 'Sanfte Morgenröte', value: 'gradient:linear:#FBC8D4:#9796F0', isGradient: true, colors: ['#FBC8D4', '#9796F0'] },
  { name: 'Frische Brise', value: 'gradient:linear:#A1C4FD:#C2E9FB', isGradient: true, colors: ['#A1C4FD', '#C2E9FB'] },
  { name: 'Sternenstaub', value: 'gradient:linear:#E0C3FC:#8EC5FC', isGradient: true, colors: ['#E0C3FC', '#8EC5FC'] },
  { name: 'Kirschblüte', value: 'gradient:linear:#FF9A9E:#FECFEF', isGradient: true, colors: ['#FF9A9E', '#FECFEF'] },
  { name: 'Sanfter Sonnenaufgang', value: 'gradient:linear:#FFF2E6:#E6F2FF', isGradient: true, colors: ['#FFF2E6', '#E6F2FF'] }
];

function setCanvasBackground(colorOrGradient) {
  currentBgColorVal = colorOrGradient;
  const picker = document.getElementById('bg-color-picker');
  
  // Alle Presets auf inaktiv setzen
  const buttons = document.querySelectorAll('.preset-color-btn');
  buttons.forEach(btn => btn.classList.remove('active'));

  if (colorOrGradient.startsWith('gradient:')) {
    const parts = colorOrGradient.split(':');
    const color1 = parts[2];
    const color2 = parts[3];

    if (picker) picker.value = color1;

    const grad = new fabric.Gradient({
      type: 'linear',
      coords: {
        x1: 0,
        y1: 0,
        x2: 0,
        y2: CANVAS_HEIGHT
      },
      colorStops: [
        { offset: 0, color: color1 },
        { offset: 1, color: color2 }
      ]
    });

    fabricCanvas.setBackgroundColor(grad, () => {
      fabricCanvas.renderAll();
    });

    const matchingBtn = Array.from(buttons).find(b => b.title === BG_PRESETS.find(p => p.value === colorOrGradient)?.name);
    if (matchingBtn) matchingBtn.classList.add('active');

  } else {
    // Feste Farbe
    if (picker) picker.value = colorOrGradient;

    fabricCanvas.setBackgroundColor(colorOrGradient, () => {
      fabricCanvas.renderAll();
    });

    const matchingBtn = Array.from(buttons).find(b => b.title === BG_PRESETS.find(p => p.value === colorOrGradient)?.name);
    if (matchingBtn) matchingBtn.classList.add('active');
  }
}

function renderBgPresets() {
  const container = document.getElementById('bg-presets');
  if (!container) return;

  container.innerHTML = '';
  BG_PRESETS.forEach(preset => {
    const btn = document.createElement('button');
    btn.className = 'preset-color-btn';
    btn.title = preset.name;

    if (preset.isGradient) {
      btn.style.background = `linear-gradient(135deg, ${preset.colors[0]}, ${preset.colors[1]})`;
    } else {
      btn.style.background = preset.value;
    }

    btn.addEventListener('click', () => {
      setCanvasBackground(preset.value);
    });

    container.appendChild(btn);
  });
}

/* ═══════════════════════════════════════════════════════════
   8. ACTIVE ELEMENT TOOLBAR (LAYER, CROPPING, CROP SLIDERS)
   ═══════════════════════════════════════════════════════════ */

function initCanvasToolbar() {
  const toolbar = document.getElementById('active-element-toolbar');
  const divider = document.getElementById('image-tools-divider');
  const imageToolsRow = document.querySelector('.image-only-tools');
  const cropOffsetControl = document.getElementById('crop-offset-control');
  const cropOffsetX = document.getElementById('crop-offset-x');
  const cropOffsetY = document.getElementById('crop-offset-y');

  // Layer und Löschen
  document.getElementById('btn-delete-selected').addEventListener('click', deleteSelected);
  document.getElementById('btn-bring-forward').addEventListener('click', bringForward);
  document.getElementById('btn-send-backward').addEventListener('click', sendBackward);

  // Zuschnitte
  document.getElementById('btn-crop-circle').addEventListener('click', () => cropActiveImage('circle'));
  document.getElementById('btn-crop-heart').addEventListener('click', () => cropActiveImage('heart'));
  document.getElementById('btn-crop-star').addEventListener('click', () => cropActiveImage('star'));
  document.getElementById('btn-crop-sun').addEventListener('click', () => cropActiveImage('sun'));
  document.getElementById('btn-crop-cloud').addEventListener('click', () => cropActiveImage('cloud'));
  document.getElementById('btn-crop-diamond').addEventListener('click', () => cropActiveImage('diamond'));
  document.getElementById('btn-crop-bevel').addEventListener('click', () => cropActiveImage('bevel'));
  document.getElementById('btn-crop-lasso').addEventListener('click', startLassoCrop);
  document.getElementById('btn-crop-reset').addEventListener('click', resetCrop);

  // X/Y Slider
  cropOffsetX.addEventListener('input', updateCropOffset);
  cropOffsetY.addEventListener('input', updateCropOffset);

  fabricCanvas.on('selection:created', updateToolbarVisibility);
  fabricCanvas.on('selection:updated', updateToolbarVisibility);
  fabricCanvas.on('selection:cleared', updateToolbarVisibility);

  function updateToolbarVisibility() {
    const active = fabricCanvas.getActiveObject();
    
    if (active) {
      toolbar.style.display = 'flex';

      if (active.type === 'image') {
        if (divider) divider.style.display = 'block';
        if (imageToolsRow) imageToolsRow.style.display = 'flex';

        if (active.clipPath && active.clipPath.absolutePositioned === false) {
          cropOffsetControl.style.display = 'flex';
          const xOffset = active.cropOffsetX || 0;
          const yOffset = active.cropOffsetY || 0;
          cropOffsetX.value = Math.round((xOffset / active.width) * 100);
          cropOffsetY.value = Math.round((yOffset / active.height) * 100);
        } else {
          cropOffsetControl.style.display = 'none';
        }
      } else {
        if (divider) divider.style.display = 'none';
        if (imageToolsRow) imageToolsRow.style.display = 'none';
        cropOffsetControl.style.display = 'none';
      }
    } else {
      toolbar.style.display = 'none';
    }
  }

  function updateCropOffset() {
    const active = fabricCanvas.getActiveObject();
    if (!active || active.type !== 'image' || !active.clipPath) return;

    // Prozentwert in lokale Bildkoordinaten zurückrechnen
    const pctX = parseInt(cropOffsetX.value, 10) / 100;
    const pctY = parseInt(cropOffsetY.value, 10) / 100;

    active.cropOffsetX = pctX * active.width;
    active.cropOffsetY = pctY * active.height;

    // Masken-Position im Bildobjekt updaten
    active.clipPath.set({
      left: active.cropOffsetX,
      top:  active.cropOffsetY
    });

    active.set('dirty', true); // Canvas Cache leeren
    fabricCanvas.renderAll();
  }

  // Keydown-Listener für Abbrechen (Esc)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isLassoCutting) {
      cancelLassoCrop();
    }
  });
}

function deleteSelected() {
  const active = fabricCanvas.getActiveObject();
  if (!active) { showToast('Kein Element ausgewählt.', 'info'); return; }

  if (active.type === 'activeSelection') {
    active.forEachObject(obj => fabricCanvas.remove(obj));
    fabricCanvas.discardActiveObject();
  } else {
    fabricCanvas.remove(active);
  }
  fabricCanvas.renderAll();
  showToast('Element gelöscht.', 'info');
}

function bringForward() {
  const active = fabricCanvas.getActiveObject();
  if (active) {
    fabricCanvas.bringForward(active);
    fabricCanvas.renderAll();
    showToast('Ebene nach vorne geschoben', 'info');
  }
}

function sendBackward() {
  const active = fabricCanvas.getActiveObject();
  if (active) {
    fabricCanvas.sendBackwards(active);
    fabricCanvas.renderAll();
    showToast('Ebene nach hinten geschoben', 'info');
  }
}

/* ═══════════════════════════════════════════════════════════
   9. GEOMETRISCHE BILD-ZUSCHNITTE (CROP MATH)
   ═══════════════════════════════════════════════════════════ */

let isLassoCutting = false;
let targetImage = null;

function cropActiveImage(shape) {
  const active = fabricCanvas.getActiveObject();
  if (!active || active.type !== 'image') {
    showToast('Wähle ein Bild aus!', 'error');
    return;
  }

  // Standardmäßig im Zentrum des Bildes platzieren
  active.cropOffsetX = active.cropOffsetX || 0;
  active.cropOffsetY = active.cropOffsetY || 0;

  if (shape === 'circle') cropImageCircle(active);
  else if (shape === 'heart') cropImageHeart(active);
  else if (shape === 'star') cropImageStar(active);
  else if (shape === 'sun') cropImageSun(active);
  else if (shape === 'cloud') cropImageCloud(active);
  else if (shape === 'diamond') cropImageDiamond(active);
  else if (shape === 'bevel') cropImageBevel(active);
}

function resetCrop() {
  const active = fabricCanvas.getActiveObject();
  if (active && active.type === 'image') {
    active.set('clipPath', null);
    active.cropOffsetX = 0;
    active.cropOffsetY = 0;
    active.set('dirty', true);
    fabricCanvas.renderAll();
    fabricCanvas.fire('selection:updated');
    showToast('Ausschnitt zurückgesetzt', 'info');
  }
}

function cropImageCircle(image) {
  const r = Math.min(image.width, image.height) / 2;
  const path = new fabric.Circle({
    radius:             r,
    originX:            'center',
    originY:            'center',
    left:               image.cropOffsetX || 0,
    top:                image.cropOffsetY || 0,
    absolutePositioned: false
  });
  image.set('clipPath', path);
  image.set('dirty', true);
  fabricCanvas.renderAll();
  fabricCanvas.fire('selection:updated');
  showToast('Kreis-Ausschnitt angewendet ⚪', 'success');
}

function cropImageHeart(image) {
  const s = Math.min(image.width, image.height);
  const pathData = `M 0 ${-0.35*s} C ${-0.2*s} ${-0.6*s}, ${-0.55*s} ${-0.45*s}, ${-0.55*s} ${-0.1*s} C ${-0.55*s} ${0.25*s}, ${-0.15*s} ${0.35*s}, 0 ${0.5*s} C ${0.15*s} ${0.35*s}, ${0.55*s} ${0.25*s}, ${0.55*s} ${-0.1*s} C ${0.55*s} ${-0.45*s}, ${0.2*s} ${-0.6*s}, 0 ${-0.35*s} Z`;
  const path = new fabric.Path(pathData, {
    originX:            'center',
    originY:            'center',
    left:               image.cropOffsetX || 0,
    top:                image.cropOffsetY || 0,
    absolutePositioned: false
  });
  image.set('clipPath', path);
  image.set('dirty', true);
  fabricCanvas.renderAll();
  fabricCanvas.fire('selection:updated');
  showToast('Herz-Ausschnitt angewendet ❤️', 'success');
}

function cropImageDiamond(image) {
  const w = image.width / 2;
  const h = image.height / 2;
  const path = new fabric.Polygon([
    { x: 0, y: -h },
    { x: w, y: 0 },
    { x: 0, y: h },
    { x: -w, y: 0 }
  ], {
    originX:            'center',
    originY:            'center',
    left:               image.cropOffsetX || 0,
    top:                image.cropOffsetY || 0,
    absolutePositioned: false
  });
  image.set('clipPath', path);
  image.set('dirty', true);
  fabricCanvas.renderAll();
  fabricCanvas.fire('selection:updated');
  showToast('Diamant-Ausschnitt angewendet 💎', 'success');
}

function cropImageBevel(image) {
  const w = image.width / 2;
  const h = image.height / 2;
  const inset = Math.min(w, h) * 0.25; // 25% Ecken-Einzug
  const path = new fabric.Polygon([
    { x: -w + inset, y: -h },
    { x: w - inset, y: -h },
    { x: w, y: -h + inset },
    { x: w, y: h - inset },
    { x: w - inset, y: h },
    { x: -w + inset, y: h },
    { x: -w, y: h - inset },
    { x: -w, y: -h + inset }
  ], {
    originX:            'center',
    originY:            'center',
    left:               image.cropOffsetX || 0,
    top:                image.cropOffsetY || 0,
    absolutePositioned: false
  });
  image.set('clipPath', path);
  image.set('dirty', true);
  fabricCanvas.renderAll();
  fabricCanvas.fire('selection:updated');
  showToast('Schräg-Ausschnitt angewendet ⬡', 'success');
}

function cropImageStar(image) {
  const s = Math.min(image.width, image.height);
  const cx = 0, cy = 0;
  const spikes = 5;
  const outerRadius = s * 0.48;
  const innerRadius = s * 0.2;
  const rot = Math.PI / 2 * 3;
  let x = cx, y = cy;
  const step = Math.PI / spikes;
  const points = [];

  for (let i = 0; i < spikes; i++) {
    x = cx + Math.cos(rot + i * step * 2) * outerRadius;
    y = cy + Math.sin(rot + i * step * 2) * outerRadius;
    points.push({ x, y });
    x = cx + Math.cos(rot + (i * 2 + 1) * step) * innerRadius;
    y = cy + Math.sin(rot + (i * 2 + 1) * step) * innerRadius;
    points.push({ x, y });
  }

  const path = new fabric.Polygon(points, {
    originX:            'center',
    originY:            'center',
    left:               image.cropOffsetX || 0,
    top:                image.cropOffsetY || 0,
    absolutePositioned: false
  });
  image.set('clipPath', path);
  image.set('dirty', true);
  fabricCanvas.renderAll();
  fabricCanvas.fire('selection:updated');
  showToast('Stern-Ausschnitt angewendet ⭐', 'success');
}

function cropImageSun(image) {
  const s = Math.min(image.width, image.height);
  const cx = 0, cy = 0;
  const spikes = 12;
  const outerRadius = s * 0.48;
  const innerRadius = s * 0.35;
  let x = cx, y = cy;
  const step = Math.PI / spikes;
  const points = [];

  for (let i = 0; i < spikes; i++) {
    x = cx + Math.cos(i * step * 2) * outerRadius;
    y = cy + Math.sin(i * step * 2) * outerRadius;
    points.push({ x, y });
    x = cx + Math.cos((i * 2 + 1) * step) * innerRadius;
    y = cy + Math.sin((i * 2 + 1) * step) * innerRadius;
    points.push({ x, y });
  }

  const path = new fabric.Polygon(points, {
    originX:            'center',
    originY:            'center',
    left:               image.cropOffsetX || 0,
    top:                image.cropOffsetY || 0,
    absolutePositioned: false
  });
  image.set('clipPath', path);
  image.set('dirty', true);
  fabricCanvas.renderAll();
  fabricCanvas.fire('selection:updated');
  showToast('Sonnen-Ausschnitt angewendet ☀️', 'success');
}

// 6-Wölbungen doppelt-symmetrische Wolke
function cropImageCloud(image) {
  const s = Math.min(image.width, image.height);
  const pathData = `M ${-0.25*s} ${0.12*s} C ${-0.45*s} ${0.12*s}, ${-0.45*s} ${-0.12*s}, ${-0.25*s} ${-0.12*s} C ${-0.24*s} ${-0.28*s}, ${-0.08*s} ${-0.28*s}, 0 ${-0.15*s} C ${0.08*s} ${-0.28*s}, ${0.24*s} ${-0.28*s}, ${0.25*s} ${-0.12*s} C ${0.45*s} ${-0.12*s}, ${0.45*s} ${0.12*s}, ${0.25*s} ${0.12*s} C ${0.24*s} ${0.28*s}, ${0.08*s} ${0.28*s}, 0 ${0.15*s} C ${-0.08*s} ${0.28*s}, ${-0.24*s} ${0.28*s}, ${-0.25*s} ${0.12*s} Z`;
  const path = new fabric.Path(pathData, {
    originX:            'center',
    originY:            'center',
    left:               image.cropOffsetX || 0,
    top:                image.cropOffsetY || 0,
    absolutePositioned: false
  });
  image.set('clipPath', path);
  image.set('dirty', true);
  fabricCanvas.renderAll();
  fabricCanvas.fire('selection:updated');
  showToast('Wolken-Ausschnitt angewendet ☁️', 'success');
}

function startLassoCrop() {
  targetImage = fabricCanvas.getActiveObject();
  if (!targetImage || targetImage.type !== 'image') {
    showToast('Wähle zuerst ein Bild aus!', 'error');
    return;
  }

  isLassoCutting = true;
  fabricCanvas.isDrawingMode = true;
  fabricCanvas.freeDrawingBrush.width = 3;
  fabricCanvas.freeDrawingBrush.color = '#ef4444';

  fabricCanvas.forEachObject(obj => {
    obj.selectable = false;
    obj.evented = false;
  });

  fabricCanvas.once('path:created', (e) => {
    if (isLassoCutting && targetImage) {
      const path = e.path;
      fabricCanvas.remove(path);
      path.absolutePositioned = true;
      targetImage.set('clipPath', path);
      targetImage.set('dirty', true);
      fabricCanvas.isDrawingMode = false;
      isLassoCutting = false;
      fabricCanvas.forEachObject(obj => {
        obj.selectable = true;
        obj.evented = true;
      });
      fabricCanvas.setActiveObject(targetImage);
      fabricCanvas.renderAll();
      targetImage = null;
      showToast('Bild erfolgreich ausgeschnitten! ✂️', 'success');
    }
  });

  showToast('Lasso-Modus: Zeichne eine Linie um dein Motiv ✂️', 'info');
}

function cancelLassoCrop() {
  fabricCanvas.isDrawingMode = false;
  isLassoCutting = false;
  fabricCanvas.off('path:created');
  fabricCanvas.forEachObject(obj => {
    obj.selectable = true;
    obj.evented = true;
  });
  if (targetImage) {
    fabricCanvas.setActiveObject(targetImage);
    targetImage = null;
  }
}

/* ═══════════════════════════════════════════════════════════
   10. PROJEKT ACTIONS (SAVE, LOAD, PDF, PRINT, CLEAR)
   ═══════════════════════════════════════════════════════════ */

function initProjectActions() {
  document.getElementById('btn-save-local').addEventListener('click', savePageToArchive);
  document.getElementById('btn-save-json').addEventListener('click', saveProjectJSON);
  document.getElementById('btn-load-json').addEventListener('click', () => {
    document.getElementById('json-file-input').click();
  });
  document.getElementById('json-file-input').addEventListener('change', loadProjectJSON);
  document.getElementById('btn-export-pdf').addEventListener('click', exportPDF);
  document.getElementById('btn-print-native').addEventListener('click', printPageNative);
  document.getElementById('btn-clear-canvas').addEventListener('click', clearCanvas);
}

function initBackgroundColor() {
  const picker = document.getElementById('bg-color-picker');
  renderBgPresets();
  picker.addEventListener('input', () => {
    setCanvasBackground(picker.value);
  });
}

function saveProjectJSON() {
  const childName = document.getElementById('child-select').value || 'Unbenannt';
  const projectData = {
    version: '1.0.0',
    app:     'Kita-Portfolio-Studio',
    savedAt: new Date().toISOString(),
    child:   childName,
    canvas:  fabricCanvas.toJSON(['selectable', 'editable', 'perPixelTargetFind', 'cropOffsetX', 'cropOffsetY']),
    bgColor: currentBgColorVal
  };

  const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `portfolio_${sanitizeFilename(childName)}_${dateStamp()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function loadProjectJSON(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.canvas) { showToast('Ungültige Projektdatei.', 'error'); return; }

      fabricCanvas.loadFromJSON(data.canvas, () => {
        fabricCanvas.getObjects('image').forEach(img => {
          img.set('perPixelTargetFind', true);
        });
        fabricCanvas.renderAll();
        if (data.bgColor) setCanvasBackground(data.bgColor);

        if (data.child) {
          const select = document.getElementById('child-select');
          const children = loadChildren();
          if (!children.includes(data.child)) {
            children.push(data.child);
            children.sort((a, b) => a.localeCompare(b, 'de'));
            saveChildren(children);
            const opt = document.createElement('option');
            opt.value = data.child; opt.textContent = data.child;
            select.appendChild(opt);
          }
          select.value = data.child;
          localStorage.setItem(STORAGE_KEY_SELECTED, data.child);
        }
        showToast('Projekt geladen ✓', 'success');
      });
    } catch (err) {
      showToast('Fehler beim Laden der Datei.', 'error');
    }
  };
  reader.readAsText(file);
}

function savePageToArchive() {
  const childSelect = document.getElementById('child-select');
  const childName = childSelect.value;
  if (!childName) { showToast('Wähle zuerst ein Kind aus!', 'error'); return; }

  const pages = loadSavedPages();
  let existingPage = activePageId ? pages.find(p => p.id === activePageId) : null;

  if (existingPage) {
    const overwrite = confirm(`Möchtest du die Seite "${existingPage.title}" überschreiben?\n(Abbrechen speichert als neue Seite)`);
    if (overwrite) {
      existingPage.canvas = fabricCanvas.toJSON(['selectable', 'editable', 'perPixelTargetFind', 'cropOffsetX', 'cropOffsetY']);
      existingPage.bgColor = currentBgColorVal;
      existingPage.updatedAt = new Date().toISOString();
      saveSavedPages(pages);
      showToast('Seite aktualisiert ✓', 'success');
      sendBackupToServer();
      return;
    }
  }

  const title = prompt('Name dieser Portfolio-Seite:', existingPage ? `${existingPage.title} (Kopie)` : '');
  if (title === null) return;
  const finalTitle = title.trim() || 'Unbenannte Seite';

  const newPage = {
    id:        Date.now().toString(),
    child:     childName,
    title:     finalTitle,
    createdAt: new Date().toISOString(),
    canvas:    fabricCanvas.toJSON(['selectable', 'editable', 'perPixelTargetFind', 'cropOffsetX', 'cropOffsetY']),
    bgColor:   currentBgColorVal
  };

  pages.push(newPage);
  saveSavedPages(pages);
  activePageId = newPage.id;
  showToast('Seite im Archiv gespeichert ✓', 'success');
  sendBackupToServer();
}

function loadSavedPages() {
  const stored = localStorage.getItem(STORAGE_KEY_PAGES);
  return stored ? JSON.parse(stored) : [];
}

function saveSavedPages(pages) {
  localStorage.setItem(STORAGE_KEY_PAGES, JSON.stringify(pages));
}

function clearCanvas() {
  if (!confirm('Möchtest du das Blatt wirklich leeren?')) return;
  clearCanvasNoConfirm();
  showToast('Blatt geleert.', 'info');
}

function clearCanvasNoConfirm() {
  fabricCanvas.clear();
  setCanvasBackground('#ffffff');
  activePageId = null;
}

function exportPDF() {
  showToast('PDF wird generiert…', 'info');
  fabricCanvas.discardActiveObject();
  fabricCanvas.renderAll();

  let dataURL;
  try {
    dataURL = fabricCanvas.toDataURL({
      format:     'png',
      quality:    1.0,
      multiplier: 2
    });
  } catch (err) {
    showToast('Export fehlgeschlagen: Bild-Sicherheitsfehler (CORS).', 'error');
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit:        'mm',
    format:      'a4'
  });

  pdf.addImage(dataURL, 'PNG', 0, 0, 210, 297);
  const childName = document.getElementById('child-select').value || 'Portfolio';
  pdf.save(`portfolio_${sanitizeFilename(childName)}_${dateStamp()}.pdf`);
  showToast('PDF erfolgreich gespeichert! 📄', 'success');
}

function printPageNative() {
  showToast('Drucken wird vorbereitet…', 'info');
  fabricCanvas.discardActiveObject();
  fabricCanvas.renderAll();

  let dataURL;
  try {
    dataURL = fabricCanvas.toDataURL({ format: 'png', quality: 1.0 });
  } catch (err) {
    showToast('Drucken fehlgeschlagen: Bild-Sicherheitsfehler.', 'error');
    return;
  }

  const win = window.open();
  if (!win) {
    showToast('Popup-Blocker verhindert das Druckfenster.', 'warning');
    return;
  }

  win.document.write(`
    <html>
      <head>
        <title>Portfolio drucken</title>
        <style>
          body { margin: 0; display: flex; justify-content: center; align-items: center; height: 100vh; background: #fff; }
          img { max-width: 100%; max-height: 100%; object-fit: contain; }
          @media print {
            body { margin: 0; }
            img { width: 100%; height: 100%; }
          }
        </style>
      </head>
      <body>
        <img src="${dataURL}" onload="window.print(); window.close();">
      </body>
    </html>
  `);
  win.document.close();
}

/* ═══════════════════════════════════════════════════════════
   11. PORTFOLIO-ARCHIV MODAL & BACKUP SYNC
   ═══════════════════════════════════════════════════════════ */

function initArchive() {
  const modal = document.getElementById('archive-modal');
  const btnOpen = document.getElementById('btn-open-archive');
  const btnClose = document.getElementById('btn-close-archive');
  const childList = document.getElementById('archive-children-list');
  const pagesList = document.getElementById('archive-pages-list');
  const selectedChildTitle = document.getElementById('archive-selected-child-title');

  btnOpen.addEventListener('click', () => {
    renderArchiveChildren();
    modal.style.display = 'flex';
  });

  btnClose.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  function renderArchiveChildren() {
    const children = loadChildren();
    childList.innerHTML = '';
    
    if (children.length === 0) {
      childList.innerHTML = '<li style="padding: 10px; color: var(--color-text-light);">Keine Kinder</li>';
      pagesList.innerHTML = '<div style="color: var(--color-text-light);">Erstelle zuerst ein Kind.</div>';
      selectedChildTitle.textContent = 'Archivierte Seiten';
      return;
    }

    children.forEach(child => {
      const li = document.createElement('li');
      li.className = 'archive-list-item';
      li.textContent = child;
      li.addEventListener('click', () => {
        document.querySelectorAll('.archive-list-item').forEach(el => el.classList.remove('active'));
        li.classList.add('active');
        renderArchivePages(child);
      });
      childList.appendChild(li);
    });

    // Erstes Kind selektieren
    const firstLi = childList.querySelector('.archive-list-item');
    if (firstLi) firstLi.click();
  }

  function renderArchivePages(childName) {
    selectedChildTitle.textContent = `Seiten für "${childName}"`;
    const pages = loadSavedPages().filter(p => p.child === childName);
    pagesList.innerHTML = '';

    if (pages.length === 0) {
      pagesList.innerHTML = '<div style="color: var(--color-text-light);">Keine Seiten für dieses Kind vorhanden.</div>';
      return;
    }

    pages.forEach(page => {
      const card = document.createElement('div');
      card.className = 'archive-page-card';

      const content = document.createElement('div');
      content.addEventListener('click', () => {
        loadPageToCanvas(page);
        modal.style.display = 'none';
      });

      const title = document.createElement('div');
      title.className = 'archive-page-title';
      title.textContent = page.title;

      const date = document.createElement('div');
      date.className = 'archive-page-date';
      date.textContent = `Erstellt: ${new Date(page.createdAt).toLocaleDateString('de')}`;

      content.appendChild(title);
      content.appendChild(date);
      card.appendChild(content);

      const actions = document.createElement('div');
      actions.className = 'archive-page-actions';

      const btnDelete = document.createElement('button');
      btnDelete.className = 'btn-delete-page';
      btnDelete.innerHTML = '🗑 Löschen';
      btnDelete.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm(`Seite "${page.title}" wirklich unwiderruflich löschen?`)) return;

        let allPages = loadSavedPages();
        allPages = allPages.filter(p => p.id !== page.id);
        saveSavedPages(allPages);
        
        if (activePageId === page.id) activePageId = null;
        renderArchivePages(childName);
        sendBackupToServer();
        showToast('Seite gelöscht.', 'info');
      });

      actions.appendChild(btnDelete);
      card.appendChild(actions);
      pagesList.appendChild(card);
    });
  }
}

function loadPageToCanvas(page) {
  showToast(`Lade "${page.title}"…`, 'info');
  const select = document.getElementById('child-select');
  select.value = page.child;
  localStorage.setItem(STORAGE_KEY_SELECTED, page.child);

  fabricCanvas.loadFromJSON(page.canvas, () => {
    fabricCanvas.getObjects('image').forEach(img => {
      img.set('perPixelTargetFind', true);
    });
    fabricCanvas.renderAll();
    if (page.bgColor) setCanvasBackground(page.bgColor);
    activePageId = page.id;
    showToast(`Seite "${page.title}" geladen ✓`, 'success');
  });
}

// Lokales Backup-Syncing mit dem Node.js Backup-Server
async function sendBackupToServer() {
  const children = loadChildren();
  const pages    = loadSavedPages();

  const backupData = {
    timestamp: new Date().toISOString(),
    children:  children,
    pages:     pages
  };

  try {
    const res = await fetch('http://localhost:3000/api/backup', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(backupData)
    });
    if (res.ok) {
      console.log('Automatisches Backup erfolgreich an Server gesendet ✓');
    }
  } catch (err) {
    console.warn('Backup-Server nicht erreichbar (nicht gestartet?)', err);
  }
}

/* ═══════════════════════════════════════════════════════════
   12. HILFSFUNKTIONEN (TOAST, SANITIZE, STAMPS)
   ═══════════════════════════════════════════════════════════ */

function showToast(msg, type = 'info') {
  // Alten Toast entfernen falls vorhanden
  const oldToast = document.querySelector('.toast-notification');
  if (oldToast) oldToast.remove();

  const toast = document.createElement('div');
  toast.className = `toast-notification toast-${type}`;
  toast.textContent = msg;

  // CSS Styles inline anhängen für einfaches Handling
  Object.assign(toast.style, {
    position:        'fixed',
    top:             '24px',
    left:            '50%',
    transform:       'translateX(-50%)',
    zIndex:          '3000',
    background:      type === 'success' ? 'var(--color-success, #10b981)' : type === 'error' ? 'var(--color-danger, #ef4444)' : 'var(--color-primary, #6366f1)',
    color:           '#ffffff',
    padding:         '12px 24px',
    borderRadius:    '30px',
    fontFamily:      'var(--font-family)',
    fontSize:        '0.9rem',
    fontWeight:      '600',
    boxShadow:       '0 10px 25px rgba(0,0,0,0.15)',
    pointerEvents:   'none',
    textAlign:       'center',
    animation:       'toastSlideIn 300ms ease-out'
  });

  document.body.appendChild(toast);

  // Keyframes für den Toast dynamisch in Stylesheet injizieren falls nicht vorhanden
  if (!document.getElementById('toast-keyframes')) {
    const style = document.createElement('style');
    style.id = 'toast-keyframes';
    style.textContent = `
      @keyframes toastSlideIn {
        from { transform: translate(-50%, -20px); opacity: 0; }
        to { transform: translate(-50%, 0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  setTimeout(() => {
    toast.style.transition = 'opacity 300ms ease';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function sanitizeFilename(str) {
  return str.replace(/[^a-z0-9à-ž]+/gi, '_').toLowerCase();
}

function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
