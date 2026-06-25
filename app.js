/* ═══════════════════════════════════════════════════════════
   KITA-PORTFOLIO-STUDIO – Applikations-Logik
   Rein clientseitige SPA: Canvas-Gestaltung, JSON-Speicherung,
   PDF-Export. Keine Server-Kommunikation.
   ═══════════════════════════════════════════════════════════ */

// ─── Globale Referenzen ──────────────────────────────────
let fabricCanvas = null;
let activePageId = null; // ID der aktuell geladenen Seite aus dem Archiv
let currentBgColorVal = '#ffffff'; // Aktuelle Hintergrundfarbe oder Verlauf-String

// DIN A4 bei 72 DPI: 595 × 842 Pixel
const CANVAS_WIDTH  = 595;
const CANVAS_HEIGHT = 842;

// ─── DOM Ready ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initCanvas();
  initChildManagement();
  initMediaUpload();
  initClipboardPaste();
  initStickers();
  initTextTools();
  initCanvasToolbar();
  initProjectActions();
  initArchive();
  initBackgroundColor();
  initKeyboardShortcuts();
});


/* ═══════════════════════════════════════════════════════════
   1. CANVAS INITIALISIERUNG
   ═══════════════════════════════════════════════════════════ */

function initCanvas() {
  // Klick-Transparenz global für alle Bilder aktivieren (ignoriert transparente/weggeschnittene Ecken)
  fabric.Image.prototype.perPixelTargetFind = true;

  // containsPoint-Override, damit weggeschnittene Bereiche eines Objekts klick-transparent werden
  fabric.Object.prototype.containsPoint = (function(oldContainsPoint) {
    // Hilfsfunktion zur mathematischen Prüfung, ob ein Klickpunkt wirklich innerhalb der ClipPath-Geometrie liegt
    function isPointInClipPath(object, point) {
      try {
        const clipPath = object.clipPath;
        if (!clipPath) return true;

        let localPoint;
        if (clipPath.absolutePositioned) {
          // Absoluter Pfad (z. B. Lasso): Punkt ist bereits in Canvas-Koordinaten
          localPoint = point;
        } else {
          // Relativer Pfad (Zuschnittformen): Canvas-Punkt in lokale Bildkoordinaten transformieren (Ursprung ist Bildmitte)
          localPoint = object.toLocalPoint(point, 'center', 'center');
        }

        // Punkt in das lokale Koordinatensystem des clipPath transformieren (unter Berücksichtigung von left, top, angle, scale)
        let pt = new fabric.Point(localPoint.x - (clipPath.left || 0), localPoint.y - (clipPath.top || 0));
        if (clipPath.angle) {
          const rad = -fabric.util.degreesToRadians(clipPath.angle);
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const rx = pt.x * cos - pt.y * sin;
          const ry = pt.x * sin + pt.y * cos;
          pt = new fabric.Point(rx, ry);
        }
        pt.x /= (clipPath.scaleX || 1);
        pt.y /= (clipPath.scaleY || 1);

        // Je nach Typ des clipPath die präzise Geometrie prüfen (nicht nur die Bounding Box!)
        if (clipPath.type === 'circle') {
          const dist = Math.sqrt(pt.x * pt.x + pt.y * pt.y);
          return dist <= clipPath.radius;
        } else if (clipPath.type === 'polygon') {
          // Manueller Ray-Casting Algorithmus (Point in Polygon) zur Vermeidung von Inkompatibilitäten in Fabric.js 5.x
          const vs = clipPath.points || [];
          const x = pt.x, y = pt.y;
          let inside = false;
          for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
            const xi = vs[i].x, yi = vs[i].y;
            const xj = vs[j].x, yj = vs[j].y;
            const intersect = ((yi > y) !== (yj > y))
                && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
          }
          return inside;
        } else if (clipPath.type === 'path') {
          // Nutze das native Canvas Path2D für Pfadprüfungen (Herz, Wolke, Lasso)
          const pathString = clipPath.path.map(cmd => cmd.join(' ')).join(' ');
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = 1;
          tempCanvas.height = 1;
          const tempCtx = tempCanvas.getContext('2d');
          const path2d = new Path2D(pathString);
          return tempCtx.isPointInPath(path2d, pt.x, pt.y);
        }

        // Fallback für andere/unbekannte Formen: Bounding Box
        const w2 = (clipPath.width || 0) / 2;
        const h2 = (clipPath.height || 0) / 2;
        return pt.x >= -w2 && pt.x <= w2 && pt.y >= -h2 && pt.y <= h2;
      } catch (err) {
        console.warn('Fehler bei der Klick-Transparenz-Prüfung:', err);
        return true; // Fallback: Klick zulassen statt die Anwendung/das Ziehen zu blockieren
      }
    }

    return function(point, lines, absolute) {
      const isInside = oldContainsPoint.call(this, point, lines, absolute);
      if (!isInside) return false;

      if (this.clipPath) {
        return isPointInClipPath(this, point);
      }
      return true;
    };
  })(fabric.Object.prototype.containsPoint);

  fabricCanvas = new fabric.Canvas('portfolio-canvas', {
    width:  CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: '#ffffff',
    preserveObjectStacking: true, // Objekte behalten ihre Reihenfolge
    selection: true
  });

  // Responsives Skalieren des Canvas-Wrappers
  resizeCanvasToFit();
  window.addEventListener('resize', resizeCanvasToFit);
}

/**
 * Skaliert das Canvas per CSS-Transform, damit es in den
 * verfügbaren Platz passt, ohne die interne Auflösung zu ändern.
 */
function resizeCanvasToFit() {
  const area    = document.getElementById('canvas-area');
  const wrapper = document.getElementById('canvas-wrapper');

  // Verfügbarer Platz (abzüglich Padding & Toolbar)
  const availW = area.clientWidth  - 48;
  const availH = area.clientHeight - 80;

  const scaleW = availW / CANVAS_WIDTH;
  const scaleH = availH / CANVAS_HEIGHT;
  const scale  = Math.min(scaleW, scaleH, 1); // Nie größer als 1:1

  wrapper.style.width  = `${CANVAS_WIDTH}px`;
  wrapper.style.height = `${CANVAS_HEIGHT}px`;
  wrapper.style.transform       = `scale(${scale})`;
  wrapper.style.transformOrigin = 'top center';
  // Wrapper-Platz im Flow korrigieren
  wrapper.style.marginBottom = `${-(CANVAS_HEIGHT * (1 - scale))}px`;
}


/* ═══════════════════════════════════════════════════════════
   2. KINDER-VERWALTUNG (LocalStorage)
   ═══════════════════════════════════════════════════════════ */

const STORAGE_KEY_CHILDREN = 'kita_portfolio_children';
const STORAGE_KEY_SELECTED = 'kita_portfolio_selected_child';

function loadChildren() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_CHILDREN)) || [];
  } catch {
    return [];
  }
}

function saveChildren(children) {
  localStorage.setItem(STORAGE_KEY_CHILDREN, JSON.stringify(children));
}

function initChildManagement() {
  const select     = document.getElementById('child-select');
  const nameInput  = document.getElementById('child-name-input');
  const btnAdd     = document.getElementById('btn-add-child');
  const btnRemove  = document.getElementById('btn-remove-child');

  // Dropdown befüllen
  function renderDropdown() {
    const children = loadChildren();
    const selected = localStorage.getItem(STORAGE_KEY_SELECTED) || '';

    // Alte Optionen entfernen (bis auf Platzhalter)
    select.innerHTML = '<option value="">— Bitte wählen —</option>';
    children.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === selected) opt.selected = true;
      select.appendChild(opt);
    });
  }

  // Auswahl ändern
  select.addEventListener('change', () => {
    localStorage.setItem(STORAGE_KEY_SELECTED, select.value);
    showToast(`Kind gewählt: ${select.value || '(keines)'}`, 'info');
    activePageId = null;
  });

  // Kind hinzufügen
  btnAdd.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { showToast('Bitte einen Namen eingeben.', 'error'); return; }

    const children = loadChildren();
    if (children.includes(name)) { showToast('Dieses Kind existiert bereits.', 'error'); return; }

    children.push(name);
    children.sort((a, b) => a.localeCompare(b, 'de'));
    saveChildren(children);
    localStorage.setItem(STORAGE_KEY_SELECTED, name);
    nameInput.value = '';
    renderDropdown();
    showToast(`„${name}" hinzugefügt ✓`, 'success');
    sendBackupToServer(); // Automatisches Backup auslösen
  });

  // Kind entfernen
  btnRemove.addEventListener('click', () => {
    const name = select.value;
    if (!name) { showToast('Bitte zuerst ein Kind auswählen.', 'error'); return; }
    if (!confirm(`„${name}" wirklich entfernen?\n(Dabei werden auch alle gespeicherten Portfolio-Seiten dieses Kindes gelöscht!)`)) return;

    const children = loadChildren().filter(c => c !== name);
    saveChildren(children);

    // Seiten des gelöschten Kindes ebenfalls entfernen
    const allPages = loadSavedPages();
    const filteredPages = allPages.filter(p => p.child !== name);
    saveSavedPages(filteredPages);

    localStorage.removeItem(STORAGE_KEY_SELECTED);
    renderDropdown();
    showToast(`„${name}" entfernt.`, 'info');
    sendBackupToServer(); // Automatisches Backup auslösen
  });

  // Enter-Taste im Input
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') btnAdd.click();
  });

  renderDropdown();
}


/* ═══════════════════════════════════════════════════════════
   3. MEDIEN-UPLOAD (Bild auf Canvas laden – Dateien & URLs)
   ═══════════════════════════════════════════════════════════ */

function initMediaUpload() {
  const dropZone  = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  // Klick -> Datei-Dialog
  dropZone.addEventListener('click', () => fileInput.click());

  // Verhindert doppeltes Öffnen des Dialogs durch Event-Bubbling
  fileInput.addEventListener('click', (e) => e.stopPropagation());

  // Datei ausgewählt
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleImageFile(fileInput.files[0]);
    fileInput.value = ''; // Reset für erneuten Upload derselben Datei
  });

  // Drag & Drop – Drop-Zone (Sidebar)
  setupDropTarget(dropZone, { highlightClass: 'drag-over' });

  // Drag & Drop – Canvas-Bereich (Mitte)
  const canvasArea = document.getElementById('canvas-area');
  setupDropTarget(canvasArea, { highlightClass: 'canvas-drag-over' });
}

/**
 * Richtet einen Drop-Target-Bereich ein, der sowohl lokale Dateien
 * als auch externe Bild-URLs (aus Browser-Tabs) akzeptiert.
 * @param {HTMLElement} element – Das DOM-Element als Drop-Ziel
 * @param {Object} opts – { highlightClass: CSS-Klasse bei Drag-Over }
 */
function setupDropTarget(element, opts = {}) {
  const cls = opts.highlightClass || 'drag-over';

  // Drag-Over-Zustand hervorheben
  ['dragenter', 'dragover'].forEach(evt =>
    element.addEventListener(evt, e => {
      e.preventDefault();
      e.stopPropagation();
      element.classList.add(cls);
    })
  );

  ['dragleave', 'drop'].forEach(evt =>
    element.addEventListener(evt, e => {
      e.preventDefault();
      e.stopPropagation();
      element.classList.remove(cls);
    })
  );

  // Drop-Event: Dateien ODER URLs verarbeiten
  element.addEventListener('drop', e => {
    const dt = e.dataTransfer;

    // ── Debug: DataTransfer-Inhalt loggen (hilft bei Fehlersuche) ──
    console.group('🖼️ Drop-Event – DataTransfer-Inhalt');
    console.log('Dateien:', dt.files?.length || 0);
    console.log('Items:', dt.items?.length || 0);
    if (dt.items) {
      for (let i = 0; i < dt.items.length; i++) {
        console.log(`  Item ${i}: kind=${dt.items[i].kind}, type=${dt.items[i].type}`);
      }
    }
    try { console.log('text/uri-list:', dt.getData('text/uri-list')); } catch(ex) { /* ignore */ }
    try { console.log('text/plain:', dt.getData('text/plain')); } catch(ex) { /* ignore */ }
    try { console.log('text/html (Auszug):', (dt.getData('text/html') || '').substring(0, 500)); } catch(ex) { /* ignore */ }
    console.groupEnd();

    // ── 1. dataTransfer.items prüfen (zuverlässiger als .files bei
    //       Cross-Origin-Drags – Chrome liefert oft das Bild als Datei) ──
    if (dt.items && dt.items.length > 0) {
      for (const item of dt.items) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file && isImageFile(file)) {
            console.log('✅ Bild als Datei erkannt (items):', file.name, file.type, file.size);
            handleImageFile(file);
            return;
          }
        }
      }
    }

    // ── 2. Fallback: dataTransfer.files ──
    if (dt.files && dt.files.length > 0) {
      const file = dt.files[0];
      if (isImageFile(file)) {
        console.log('✅ Bild als Datei erkannt (files):', file.name, file.type, file.size);
        handleImageFile(file);
        return;
      }
    }

    // ── 3. Externe URL extrahieren (Bild aus einem anderen Tab gezogen) ──
    const url = extractImageUrl(dt);
    if (url) {
      console.log('🔗 Extrahierte Bild-URL:', url);
      handleImageUrl(url);
    } else {
      showToast('Keine Bild-URL erkannt. Tipp: Rechtsklick → Bild kopieren, dann Strg+V.', 'error');
    }
  });
}

/**
 * Prüft ob eine Datei ein Bild ist – per MIME-Type oder Dateiendung.
 * (Manche Browser setzen bei Cross-Origin-Drags keinen MIME-Type.)
 */
function isImageFile(file) {
  if (file.type && file.type.startsWith('image/')) return true;
  if (file.name && /\.(jpe?g|png|gif|webp|svg|bmp|avif|tiff?|ico)$/i.test(file.name)) return true;
  return false;
}

/**
 * Extrahiert eine Bild-URL aus dem DataTransfer-Objekt.
 * Strategie (in Prioritätsreihenfolge):
 *   1) text/html      – <img src>, CSS background-image, data-Attribute
 *   2) text/uri-list  – direkter URI, typisch für Link-Drag
 *   3) text/plain     – einfacher Text, falls URL-artig
 *
 * Hinweis: text/html wird zuerst geprüft, weil z. B. Google Photos
 * als text/uri-list die Seiten-URL liefert, aber im HTML-Fragment
 * den echten Bild-Pfad enthält.
 */
function extractImageUrl(dataTransfer) {
  // --- Strategie 1: text/html – Bild-URL aus HTML extrahieren ---
  const html = dataTransfer.getData('text/html');
  if (html) {
    const urlFromHtml = extractUrlFromHtml(html);
    if (urlFromHtml) {
      console.log('  URL-Quelle: text/html');
      return urlFromHtml;
    }
  }

  // --- Strategie 2: text/uri-list ---
  const uriList = dataTransfer.getData('text/uri-list');
  if (uriList) {
    const firstUrl = uriList.split(/\r?\n/).find(l => l && !l.startsWith('#'));
    if (firstUrl && looksLikeImageUrl(firstUrl)) return firstUrl;
    if (firstUrl && firstUrl.startsWith('http')) return firstUrl;
  }

  // --- Strategie 3: text/plain ---
  const plain = (dataTransfer.getData('text/plain') || '').trim();
  if (plain && plain.startsWith('http') && looksLikeImageUrl(plain)) return plain;
  if (plain && /^https?:\/\/.+/i.test(plain)) return plain;

  return null;
}

/**
 * Extrahiert eine Bild-URL aus einem HTML-Fragment.
 * Sucht in dieser Reihenfolge:
 *   1) <img src="…"> Tags
 *   2) CSS background-image: url(…) – SPAs wie Google Photos
 *   3) data-src, data-url und ähnliche Attribute
 *   4) Jede https-URL im HTML die wie ein Bild aussieht
 */
function extractUrlFromHtml(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // 1) <img src> – bevorzuge die längste URL (wahrscheinlich hochauflösend)
    const imgs = doc.querySelectorAll('img[src]');
    let bestSrc = null;
    let bestLen = 0;
    imgs.forEach(img => {
      const src = img.getAttribute('src') || '';
      if (src.startsWith('http') && src.length > bestLen) {
        bestSrc = src;
        bestLen = src.length;
      }
    });
    if (bestSrc) { console.log('  Gefunden via: <img src>'); return bestSrc; }

    // 2) CSS background-image – Google Photos nutzt <div style="background-image:url(…)">
    const styledEls = doc.querySelectorAll('[style]');
    for (const el of styledEls) {
      const style = el.getAttribute('style') || '';
      const bgMatch = style.match(/background(?:-image)?\s*:\s*url\(["']?(https?[^"')]+)["']?\)/i);
      if (bgMatch && bgMatch[1]) { console.log('  Gefunden via: background-image'); return bgMatch[1]; }
    }

    // 3) data-Attribute (data-src, data-url, data-image, data-latest-bg usw.)
    const dataAttrs = ['data-latest-bg', 'data-src', 'data-url', 'data-image',
                       'data-original', 'data-hi-res-src', 'data-full-src', 'data-lazy-src'];
    for (const attr of dataAttrs) {
      const el = doc.querySelector(`[${attr}]`);
      if (el) {
        const val = el.getAttribute(attr) || '';
        if (val.startsWith('http')) { console.log(`  Gefunden via: ${attr}`); return val; }
      }
    }
  } catch { /* Fallback auf Regex */ }

  // 4) Regex-Fallback: <img src>
  const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch && imgMatch[1] && imgMatch[1].startsWith('http')) return imgMatch[1];

  // 5) Regex-Fallback: background-image
  const bgMatch = html.match(/background(?:-image)?\s*:\s*url\(["']?(https?[^"')]+)["']?\)/i);
  if (bgMatch && bgMatch[1]) return bgMatch[1];

  // 6) Letzte Chance: jede URL im HTML die nach einem Bild aussieht
  const anyImgUrl = html.match(/https?:\/\/[^\s"'<>]+?\.(jpe?g|png|gif|webp|avif)[^\s"'<>]*/i);
  if (anyImgUrl) return anyImgUrl[0];

  return null;
}

/**
 * Prüft heuristisch, ob eine URL auf ein Bild verweist.
 */
function looksLikeImageUrl(url) {
  return /\.(jpe?g|png|gif|webp|svg|bmp|avif|ico|tiff?)(\?.*)?$/i.test(url)
      || /\/(photo|image|img|media|static|thumb)/i.test(url)
      || /googleusercontent|ggpht|twimg|fbcdn|imgur|unsplash|pexels/i.test(url)
      || /photos\.fife\.usercontent/i.test(url);
}

/**
 * Stuft Google-Foto-URLs von Thumbnail- auf Vollauflösung hoch.
 * Google verwendet URL-Parameter wie =w157-h208-no für die Bildgröße.
 * Wir ersetzen das durch =w2048-h2048 für eine hochauflösende Version.
 *
 * Beispiel:
 *   …/pw/ABC123=w157-h208-no?authuser=0
 *   → …/pw/ABC123=w2048-h2048?authuser=0
 */
function upgradeGooglePhotosUrl(url) {
  if (!/googleusercontent|ggpht|photos\.fife\.usercontent/i.test(url)) {
    return url;
  }

  const original = url;

  // =w{N}-h{N}... → =w2048-h2048  (Thumbnail-Parameter ersetzen)
  url = url.replace(/=w\d+-h\d+[^?&]*/i, '=w2048-h2048');

  // =s{N}... → =s2048  (alternative Größenangabe)
  url = url.replace(/=s\d+[^?&]*/i, '=s2048');

  if (url !== original) {
    console.log('📐 Google-URL hochgestuft:', original.match(/=w\d+-h\d+|=s\d+/)?.[0], '→ Vollauflösung');
  }

  return url;
}

/**
 * Lädt ein Bild von einer URL und platziert es auf dem Canvas.
 * 4-stufiger Fallback (async/await):
 *   1) Direkt mit crossOrigin='anonymous'
 *   2) CORS-Proxy: corsproxy.io
 *   3) Bild-Proxy: wsrv.nl (transformiert und cached Bilder serverseitig)
 *   4) Ohne crossOrigin – Browser schickt Cookies mit, dadurch laden
 *      auch authentifizierte URLs (z. B. Google Photos). Canvas wird
 *      dabei „tainted", was den PDF-Export einschränken kann.
 */
async function handleImageUrl(url) {
  // Google-Fotos-URLs von Thumbnail auf Vollauflösung hochstufen
  url = upgradeGooglePhotosUrl(url);

  showLoading(true);
  showToast('Bild wird geladen…', 'info');
  console.log('🔄 handleImageUrl – Starte Ladekette für:', url);

  const strategies = [
    {
      name: 'Direkt (CORS)',
      load: () => loadImage(url, { cors: true }),
      successMsg: 'Bild von URL hinzugefügt ✓',
      type: 'success'
    },
    {
      name: 'CORS-Proxy (corsproxy.io)',
      load: () => loadImage(`https://corsproxy.io/?${encodeURIComponent(url)}`, { cors: true }),
      successMsg: 'Bild über Proxy geladen ✓',
      type: 'success'
    },
    {
      name: 'Bild-Proxy (wsrv.nl)',
      load: () => loadImage(`https://wsrv.nl/?url=${encodeURIComponent(url)}&default=1`, { cors: true }),
      successMsg: 'Bild über Bild-Proxy geladen ✓',
      type: 'success'
    },
    {
      name: 'Ohne CORS (tainted)',
      load: () => loadImage(url, { cors: false }),
      successMsg: 'Bild hinzugefügt ✓ (PDF-Export evtl. eingeschränkt)',
      type: 'info'
    }
  ];

  for (const strategy of strategies) {
    try {
      console.log(`  ⏳ Versuche: ${strategy.name}`);
      const img = await strategy.load();
      placeImageOnCanvas(img);
      showLoading(false);
      showToast(strategy.successMsg, strategy.type);
      console.log(`  ✅ Erfolg: ${strategy.name}`);
      return;
    } catch (err) {
      console.warn(`  ❌ ${strategy.name} fehlgeschlagen:`, err.message);
    }
  }

  // Alle Strategien fehlgeschlagen
  showLoading(false);
  showToast(
    'Bild konnte nicht geladen werden. Tipp: Rechtsklick auf Bild → „Bild kopieren", dann hier Strg+V drücken.',
    'error'
  );
}

/**
 * Lädt ein Bild und gibt ein Promise<fabric.Image> zurück.
 * @param {string}  url                – Bild-URL
 * @param {Object}  opts
 * @param {boolean} opts.cors           – true = crossOrigin='anonymous' setzen
 * @param {number}  [opts.timeout=12000] – Max. Wartezeit in ms
 */
function loadImage(url, { cors = true, timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const imgEl = new Image();
    if (cors) {
      imgEl.crossOrigin = 'anonymous';
    }
    // Verhindert dass der Referer mitgesendet wird – Google, Facebook usw.
    // blockieren oft Anfragen mit falschem/fremdem Referer
    imgEl.referrerPolicy = 'no-referrer';

    const timer = setTimeout(() => {
      imgEl.src = '';
      reject(new Error('Timeout'));
    }, timeout);

    imgEl.onload = () => {
      clearTimeout(timer);
      // Manche Server liefern bei Auth-Fehlern ein 1×1 Pixel-Placeholder
      if (imgEl.naturalWidth <= 1 && imgEl.naturalHeight <= 1) {
        reject(new Error('Bild zu klein – vermutlich Placeholder'));
        return;
      }
      try {
        const fImg = new fabric.Image(imgEl);
        resolve(fImg);
      } catch (err) {
        reject(err);
      }
    };

    imgEl.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Bild konnte nicht geladen werden'));
    };

    imgEl.src = url;
  });
}

/**
 * Platziert ein fabric.Image-Objekt zentriert und skaliert auf dem Canvas.
 */
function placeImageOnCanvas(img) {
  const maxW = CANVAS_WIDTH  * 0.8;
  const maxH = CANVAS_HEIGHT * 0.8;
  const scale = Math.min(maxW / img.width, maxH / img.height, 1);

  img.set({
    left:    CANVAS_WIDTH  / 2,
    top:     CANVAS_HEIGHT / 2,
    originX: 'center',
    originY: 'center',
    scaleX:  scale,
    scaleY:  scale,
    perPixelTargetFind: true
  });

  fabricCanvas.add(img);
  fabricCanvas.setActiveObject(img);
  fabricCanvas.renderAll();
}

/**
 * Zeigt oder verbirgt das Lade-Overlay über dem Canvas.
 */
function showLoading(show) {
  let overlay = document.getElementById('canvas-loading-overlay');

  if (show && !overlay) {
    overlay = document.createElement('div');
    overlay.id = 'canvas-loading-overlay';
    overlay.innerHTML = `
      <div class="loading-spinner"></div>
      <p class="loading-text">Bild wird geladen…</p>
    `;
    document.getElementById('canvas-wrapper').appendChild(overlay);
  } else if (!show && overlay) {
    overlay.classList.add('loading-out');
    overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
    // Fallback falls kein animationend feuert
    setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 400);
  }
}

/**
 * Liest eine Bilddatei und fügt sie dem Canvas hinzu.
 * Das Bild wird so skaliert, dass es in 80 % der Canvas-Breite passt.
 */
function handleImageFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    fabric.Image.fromURL(e.target.result, (img) => {
      placeImageOnCanvas(img);
      showToast('Bild hinzugefügt ✓', 'success');
    });
  };
  reader.readAsDataURL(file);
}
/* ═══════════════════════════════════════════════════════════
   3b. CLIPBOARD-PASTE (Strg+V / Cmd+V)
   Zuverlässigster Weg für Bilder aus authentifizierten Quellen
   wie Google Photos: Rechtsklick → „Bild kopieren" → Strg+V
   ═══════════════════════════════════════════════════════════ */

function initClipboardPaste() {
  document.addEventListener('paste', (e) => {
    // Nicht abfangen wenn der User in einem Input/Textarea tippt
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const items = e.clipboardData?.items;
    if (!items) return;

    // 1) Bild-Datei im Clipboard?
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          console.log('📋 Bild aus Clipboard eingefügt:', file.type, file.size);
          handleImageFile(file);
          return;
        }
      }
    }

    // 2) Bild-URL als Text im Clipboard?
    const text = e.clipboardData?.getData('text/plain')?.trim();
    if (text && /^https?:\/\/.+/i.test(text) && looksLikeImageUrl(text)) {
      e.preventDefault();
      console.log('📋 Bild-URL aus Clipboard:', text);
      handleImageUrl(text);
    }
  });
}




/* ═══════════════════════════════════════════════════════════
   4. DIGITALE STICKER-KISTE
   ═══════════════════════════════════════════════════════════ */

function initStickers() {
  const tabsContainer = document.querySelector('.sticker-tabs');
  if (!tabsContainer) return;
  const stickerSection = tabsContainer.parentElement;

  stickerSection.addEventListener('click', (e) => {
    // 1) Click auf einen Sticker
    const btn = e.target.closest('.sticker-btn');
    if (btn) {
      const emoji = btn.dataset.sticker;
      addStickerToCanvas(emoji);
      return;
    }

    // 2) Click auf einen Tab
    const tabBtn = e.target.closest('.sticker-tab-btn');
    if (tabBtn) {
      const targetId = tabBtn.dataset.target;
      
      // Deaktiviere alle Tabs & Grids
      stickerSection.querySelectorAll('.sticker-tab-btn').forEach(btn => btn.classList.remove('active'));
      stickerSection.querySelectorAll('.sticker-cat-content').forEach(grid => {
        grid.style.display = 'none';
        grid.classList.remove('active');
      });

      // Aktiviere ausgewählten Tab & Grid
      tabBtn.classList.add('active');
      const targetGrid = document.getElementById(targetId);
      if (targetGrid) {
        targetGrid.style.display = 'grid';
        targetGrid.classList.add('active');
      }
    }
  });
}

/**
 * Fügt ein Emoji als skalierbares Textobjekt dem Canvas hinzu.
 */
function addStickerToCanvas(emoji) {
  const sticker = new fabric.Text(emoji, {
    left:     CANVAS_WIDTH  / 2,
    top:      CANVAS_HEIGHT / 2,
    originX:  'center',
    originY:  'center',
    fontSize: 60,
    selectable: true,
    // Emoji-spezifische Einstellungen
    fontFamily: 'Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif'
  });

  fabricCanvas.add(sticker);
  fabricCanvas.setActiveObject(sticker);
  fabricCanvas.renderAll();
  showToast(`Sticker ${emoji} hinzugefügt`, 'success');
}


/* ═══════════════════════════════════════════════════════════
   5. TEXT-WERKZEUGE
   ═══════════════════════════════════════════════════════════ */

// Hilfsfunktionen für Farbverläufe (Regenbogen & Pastell)
function getRainbowGradient(width) {
  return new fabric.Gradient({
    type: 'linear',
    gradientUnits: 'pixels',
    coords: { x1: 0, y1: 0, x2: width || 300, y2: 0 },
    colorStops: [
      { offset: 0, color: '#ef4444' }, // Rot
      { offset: 0.25, color: '#f59e0b' }, // Gelb/Orange
      { offset: 0.5, color: '#10b981' }, // Grün
      { offset: 0.75, color: '#3b82f6' }, // Blau
      { offset: 1, color: '#8b5cf6' } // Violett
    ]
  });
}

function getPastelGradient(width) {
  return new fabric.Gradient({
    type: 'linear',
    gradientUnits: 'pixels',
    coords: { x1: 0, y1: 0, x2: width || 300, y2: 0 },
    colorStops: [
      { offset: 0, color: '#ff758f' }, // Pastel Pink
      { offset: 0.5, color: '#a78bfa' }, // Pastel Violett
      { offset: 1, color: '#4ade80' } // Pastel Mint
    ]
  });
}

function initTextTools() {
  const textInput     = document.getElementById('text-input');
  const fontSelect    = document.getElementById('font-select');
  const fontSize      = document.getElementById('font-size');
  const fontColor     = document.getElementById('font-color');
  const headingStyle  = document.getElementById('heading-style');
  const btnAddText    = document.getElementById('btn-add-text');
  const btnAddHeading = document.getElementById('btn-add-heading');

  // Fließtext hinzufügen
  btnAddText.addEventListener('click', () => {
    const text = textInput.value.trim();
    if (!text) { showToast('Bitte Text eingeben.', 'error'); return; }

    const textbox = new fabric.Textbox(text, {
      left:       40,
      top:        CANVAS_HEIGHT / 2,
      width:      CANVAS_WIDTH - 80,  // 40px Rand links + rechts
      fontSize:   parseInt(fontSize.value, 10) || 18,
      fontFamily: fontSelect.value,
      fill:       fontColor.value,
      editable:   true,
      splitByGrapheme: false,
      lineHeight: 1.4
    });

    fabricCanvas.add(textbox);
    fabricCanvas.setActiveObject(textbox);
    fabricCanvas.renderAll();

    textInput.value = '';
    showToast('Text hinzugefügt ✓', 'success');
  });

  // Überschrift hinzufügen
  btnAddHeading.addEventListener('click', () => {
    let text = textInput.value.trim();
    if (!text) {
      text = 'Neue Überschrift';
    }

    const style = headingStyle.value;
    let textbox;

    if (style === 'curved') {
      // 1) Sichelförmiger Bogen
      const w = CANVAS_WIDTH - 80;
      const pathData = `M 10 80 Q ${w / 2} -20 ${w - 10} 80`;
      const path = new fabric.Path(pathData, {
        fill: 'transparent',
        stroke: 'transparent',
        visible: false
      });

      textbox = new fabric.IText(text, {
        left:       40,
        top:        60,
        fontSize:   36,
        fontWeight: 'bold',
        fontFamily: fontSelect.value,
        fill:       fontColor.value,
        textAlign:  'center',
        path:       path
      });
    } else if (style === 'shadow') {
      // 2) 3D Schatteneffekt
      textbox = new fabric.Textbox(text, {
        left:       40,
        top:        60,
        width:      CANVAS_WIDTH - 80,
        fontSize:   38,
        fontWeight: 'bold',
        fontFamily: fontSelect.value,
        fill:       fontColor.value,
        editable:   true,
        textAlign:  'center',
        shadow: new fabric.Shadow({
          color: '#cbd5e1',
          blur: 0,
          offsetX: 4,
          offsetY: 4
        }),
        splitByGrapheme: false,
        lineHeight: 1.2
      });
    } else if (style === 'rainbow') {
      // 3) Regenbogen-Bunt
      const w = CANVAS_WIDTH - 80;
      textbox = new fabric.Textbox(text, {
        left:       40,
        top:        60,
        width:      w,
        fontSize:   36,
        fontWeight: 'bold',
        fontFamily: fontSelect.value,
        fill:       getRainbowGradient(w),
        editable:   true,
        textAlign:  'center',
        splitByGrapheme: false,
        lineHeight: 1.2
      });
    } else if (style === 'pastel') {
      // 4) Pastell-Verlauf
      const w = CANVAS_WIDTH - 80;
      textbox = new fabric.Textbox(text, {
        left:       40,
        top:        60,
        width:      w,
        fontSize:   36,
        fontWeight: 'bold',
        fontFamily: fontSelect.value,
        fill:       getPastelGradient(w),
        editable:   true,
        textAlign:  'center',
        splitByGrapheme: false,
        lineHeight: 1.2
      });
    } else if (style === 'outline') {
      // 5) Kontur & Schatten (Bubble)
      textbox = new fabric.Textbox(text, {
        left:       40,
        top:        60,
        width:      CANVAS_WIDTH - 80,
        fontSize:   36,
        fontWeight: 'bold',
        fontFamily: fontSelect.value,
        fill:       fontColor.value,
        stroke:     '#ffffff',
        strokeWidth: 3,
        strokeLineJoin: 'round',
        editable:   true,
        textAlign:  'center',
        shadow: new fabric.Shadow({
          color: 'rgba(0, 0, 0, 0.2)',
          blur: 5,
          offsetX: 3,
          offsetY: 3
        }),
        splitByGrapheme: false,
        lineHeight: 1.2
      });
    } else {
      // Klassisch (Gerade)
      textbox = new fabric.Textbox(text, {
        left:       40,
        top:        60,
        width:      CANVAS_WIDTH - 80,
        fontSize:   36,
        fontWeight: 'bold',
        fontFamily: fontSelect.value,
        fill:       fontColor.value,
        editable:   true,
        textAlign:  'center',
        splitByGrapheme: false,
        lineHeight: 1.2
      });
    }

    fabricCanvas.add(textbox);
    fabricCanvas.setActiveObject(textbox);
    fabricCanvas.renderAll();

    textInput.value = '';
    showToast('Überschrift hinzugefügt ✓', 'success');
  });

  // Live-Bearbeitung des ausgewählten Textes (Farbe, Schriftart, Größe)
  fontColor.addEventListener('input', () => {
    const activeObject = fabricCanvas.getActiveObject();
    if (activeObject && (activeObject.type === 'textbox' || activeObject.type === 'text' || activeObject.type === 'i-text')) {
      const style = headingStyle.value;
      if (style === 'rainbow' || style === 'pastel') {
        // Gradienten behalten ihre Farbe bei Farbänderung
      } else if (style === 'outline') {
        activeObject.set({
          fill: fontColor.value,
          stroke: '#ffffff'
        });
      } else {
        activeObject.set({
          fill: fontColor.value,
          strokeWidth: 0
        });
      }
      fabricCanvas.renderAll();
    }
  });

  fontSelect.addEventListener('change', () => {
    const activeObject = fabricCanvas.getActiveObject();
    if (activeObject && (activeObject.type === 'textbox' || activeObject.type === 'text' || activeObject.type === 'i-text')) {
      activeObject.set('fontFamily', fontSelect.value);
      fabricCanvas.renderAll();
    }
  });

  fontSize.addEventListener('input', () => {
    const activeObject = fabricCanvas.getActiveObject();
    if (activeObject && (activeObject.type === 'textbox' || activeObject.type === 'text' || activeObject.type === 'i-text')) {
      activeObject.set('fontSize', parseInt(fontSize.value, 10) || 18);
      fabricCanvas.renderAll();
    }
  });

  // Stil-Änderung auf bestehendes Textobjekt anwenden
  headingStyle.addEventListener('change', () => {
    const activeObject = fabricCanvas.getActiveObject();
    if (activeObject && (activeObject.type === 'textbox' || activeObject.type === 'text' || activeObject.type === 'i-text')) {
      const style = headingStyle.value;
      const w = activeObject.width || CANVAS_WIDTH - 80;

      // Vorherige Spezialeffekte zurücksetzen
      activeObject.set({
        path: null,
        strokeWidth: 0,
        shadow: null
      });

      if (style === 'curved') {
        const pathData = `M 10 80 Q ${w / 2} -20 ${w - 10} 80`;
        const path = new fabric.Path(pathData, {
          fill: 'transparent',
          stroke: 'transparent',
          visible: false
        });
        activeObject.set({
          path: path,
          fill: fontColor.value
        });
      } else if (style === 'shadow') {
        activeObject.set({
          fill: fontColor.value,
          shadow: new fabric.Shadow({
            color: '#cbd5e1',
            blur: 0,
            offsetX: 4,
            offsetY: 4
          })
        });
      } else if (style === 'rainbow') {
        activeObject.set({
          fill: getRainbowGradient(w)
        });
      } else if (style === 'pastel') {
        activeObject.set({
          fill: getPastelGradient(w)
        });
      } else if (style === 'outline') {
        activeObject.set({
          fill: fontColor.value,
          stroke: '#ffffff',
          strokeWidth: 3,
          strokeLineJoin: 'round',
          shadow: new fabric.Shadow({
            color: 'rgba(0, 0, 0, 0.2)',
            blur: 5,
            offsetX: 3,
            offsetY: 3
          })
        });
      } else {
        // normal
        activeObject.set({
          fill: fontColor.value
        });
      }
      fabricCanvas.renderAll();
    }
  });

  // Mausrad zum Ändern der Schriftgröße
  fontSize.addEventListener('wheel', (e) => {
    e.preventDefault();
    let val = parseInt(fontSize.value, 10) || 18;
    if (e.deltaY < 0) {
      val = Math.min(72, val + 1);
    } else {
      val = Math.max(8, val - 1);
    }
    fontSize.value = val;
    fontSize.dispatchEvent(new Event('input'));
  });

  // Mausrad zum Ändern der Schriftart
  fontSelect.addEventListener('wheel', (e) => {
    e.preventDefault();
    const idx = fontSelect.selectedIndex;
    if (e.deltaY < 0) {
      if (idx > 0) {
        fontSelect.selectedIndex = idx - 1;
      }
    } else {
      if (idx < fontSelect.options.length - 1) {
        fontSelect.selectedIndex = idx + 1;
      }
    }
    fontSelect.dispatchEvent(new Event('change'));
  });

  // Mausrad zum Ändern des Überschrift-Stils
  headingStyle.addEventListener('wheel', (e) => {
    e.preventDefault();
    const idx = headingStyle.selectedIndex;
    if (e.deltaY < 0) {
      if (idx > 0) {
        headingStyle.selectedIndex = idx - 1;
      }
    } else {
      if (idx < headingStyle.options.length - 1) {
        headingStyle.selectedIndex = idx + 1;
      }
    }
    headingStyle.dispatchEvent(new Event('change'));
  });

  // Controls mit dem ausgewählten Text-Objekt synchronisieren
  fabricCanvas.on('selection:created', updateTextControlsFromSelection);
  fabricCanvas.on('selection:updated', updateTextControlsFromSelection);

  function updateTextControlsFromSelection(e) {
    const activeObject = e.selected ? e.selected[0] : fabricCanvas.getActiveObject();
    if (activeObject && (activeObject.type === 'textbox' || activeObject.type === 'text' || activeObject.type === 'i-text')) {
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
        if (stops.length === 5) {
          headingStyle.value = 'rainbow';
        } else {
          headingStyle.value = 'pastel';
        }
      } else {
        headingStyle.value = 'normal';
      }
    }
  }
}


/* ═══════════════════════════════════════════════════════════
   6. CANVAS-TOOLBAR (Löschen, Ebenen)
   ═══════════════════════════════════════════════════════════ */

function initCanvasToolbar() {
  const btnDelete = document.getElementById('btn-delete-selected');
  const btnForward = document.getElementById('btn-bring-forward');
  const btnBackward = document.getElementById('btn-send-backward');

  const divider = document.getElementById('image-tools-divider');
  const btnLasso = document.getElementById('btn-crop-lasso');
  const btnCircle = document.getElementById('btn-crop-circle');
  const btnHeart = document.getElementById('btn-crop-heart');
  const btnStar = document.getElementById('btn-crop-star');
  const btnSun = document.getElementById('btn-crop-sun');
  const btnCloud = document.getElementById('btn-crop-cloud');
  const btnDiamond = document.getElementById('btn-crop-diamond');
  const btnBevel = document.getElementById('btn-crop-bevel');
  const btnReset = document.getElementById('btn-crop-reset');

  const cropOffsetControl = document.getElementById('crop-offset-control');
  const cropOffsetX = document.getElementById('crop-offset-x');
  const cropOffsetY = document.getElementById('crop-offset-y');

  btnDelete.addEventListener('click', deleteSelected);
  btnForward.addEventListener('click', () => {
    const obj = fabricCanvas.getActiveObject();
    if (obj) { fabricCanvas.bringForward(obj, true); fabricCanvas.renderAll(); }
  });
  btnBackward.addEventListener('click', () => {
    const obj = fabricCanvas.getActiveObject();
    if (obj) { fabricCanvas.sendBackwards(obj, true); fabricCanvas.renderAll(); }
  });

  // Ausschnitt-Aktionen
  btnLasso.addEventListener('click', startLassoCrop);
  btnCircle.addEventListener('click', () => {
    const active = fabricCanvas.getActiveObject();
    if (active && active.type === 'image') {
      cropImageCircle(active);
    }
  });
  btnHeart.addEventListener('click', () => {
    const active = fabricCanvas.getActiveObject();
    if (active && active.type === 'image') {
      cropImageHeart(active);
    }
  });
  btnStar.addEventListener('click', () => {
    const active = fabricCanvas.getActiveObject();
    if (active && active.type === 'image') {
      cropImageStar(active);
    }
  });
  btnSun.addEventListener('click', () => {
    const active = fabricCanvas.getActiveObject();
    if (active && active.type === 'image') {
      cropImageSun(active);
    }
  });
  btnCloud.addEventListener('click', () => {
    const active = fabricCanvas.getActiveObject();
    if (active && active.type === 'image') {
      cropImageCloud(active);
    }
  });
  btnDiamond.addEventListener('click', () => {
    const active = fabricCanvas.getActiveObject();
    if (active && active.type === 'image') {
      cropImageDiamond(active);
    }
  });
  btnBevel.addEventListener('click', () => {
    const active = fabricCanvas.getActiveObject();
    if (active && active.type === 'image') {
      cropImageBevel(active);
    }
  });
  btnReset.addEventListener('click', () => {
    const active = fabricCanvas.getActiveObject();
    if (active && active.type === 'image') {
      active.set('clipPath', null);
      active.cropOffsetX = 0;
      active.cropOffsetY = 0;
      cropOffsetX.value = 0;
      cropOffsetY.value = 0;
      fabricCanvas.renderAll();
      updateToolbarVisibility();
      showToast('Ausschnitt entfernt.', 'info');
    }
  });

  // Manuelle Verschiebung des Ausschnitts
  function updateCropOffset() {
    const active = fabricCanvas.getActiveObject();
    if (active && active.type === 'image' && active.clipPath) {
      const xPercent = parseFloat(cropOffsetX.value);
      const yPercent = parseFloat(cropOffsetY.value);

      // Save offset on image in pixel units
      active.cropOffsetX = (xPercent / 100) * active.width;
      active.cropOffsetY = (yPercent / 100) * active.height;

      // Only shift relative clipPaths (shape crop)
      if (active.clipPath.absolutePositioned === false) {
        active.clipPath.set({
          left: active.cropOffsetX,
          top: active.cropOffsetY
        });
        active.set('dirty', true); // Force Fabric.js to redraw parent image cache
        fabricCanvas.renderAll();
      }
    }
  }

  cropOffsetX.addEventListener('input', updateCropOffset);
  cropOffsetY.addEventListener('input', updateCropOffset);

  // Steuerung der Button-Sichtbarkeit basierend auf Canvas-Auswahl
  fabricCanvas.on('selection:created', updateToolbarVisibility);
  fabricCanvas.on('selection:updated', updateToolbarVisibility);
  fabricCanvas.on('selection:cleared', updateToolbarVisibility);

  function updateToolbarVisibility() {
    const active = fabricCanvas.getActiveObject();
    if (active && active.type === 'image') {
      divider.style.display = 'inline';
      btnLasso.style.display = 'inline-flex';
      btnCircle.style.display = 'inline-flex';
      btnHeart.style.display = 'inline-flex';
      btnStar.style.display = 'inline-flex';
      btnSun.style.display = 'inline-flex';
      btnCloud.style.display = 'inline-flex';
      btnDiamond.style.display = 'inline-flex';
      btnBevel.style.display = 'inline-flex';
      btnReset.style.display = 'inline-flex';

      // Slider nur für relative Formen (absolutePositioned === false)
      if (active.clipPath && active.clipPath.absolutePositioned === false) {
        cropOffsetControl.style.display = 'inline-flex';
        const xOffset = active.cropOffsetX || 0;
        const yOffset = active.cropOffsetY || 0;
        cropOffsetX.value = Math.round((xOffset / active.width) * 100);
        cropOffsetY.value = Math.round((yOffset / active.height) * 100);
      } else {
        cropOffsetControl.style.display = 'none';
      }
    } else {
      divider.style.display = 'none';
      btnLasso.style.display = 'none';
      btnCircle.style.display = 'none';
      btnHeart.style.display = 'none';
      btnStar.style.display = 'none';
      btnSun.style.display = 'none';
      btnCloud.style.display = 'none';
      btnDiamond.style.display = 'none';
      btnBevel.style.display = 'none';
      btnReset.style.display = 'none';
      cropOffsetControl.style.display = 'none';
    }
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

  // Gruppierte Auswahl (mehrere Objekte)
  if (active.type === 'activeSelection') {
    active.forEachObject(obj => fabricCanvas.remove(obj));
    fabricCanvas.discardActiveObject();
  } else {
    fabricCanvas.remove(active);
  }
  fabricCanvas.renderAll();
  showToast('Element gelöscht.', 'info');
}

/* ═══════════════════════════════════════════════════════════
   BILD-ZUSCHNEIDE-FUNKTIONEN (Lasso & Kreis)
   ═══════════════════════════════════════════════════════════ */

let isLassoCutting = false;
let targetImage = null;

/**
 * Startet den Lasso-Freihand-Ausschnitt für das ausgewählte Bild.
 */
function startLassoCrop() {
  targetImage = fabricCanvas.getActiveObject();
  if (!targetImage || targetImage.type !== 'image') {
    showToast('Bitte wähle zuerst ein Bild aus!', 'error');
    return;
  }

  isLassoCutting = true;
  fabricCanvas.isDrawingMode = true;
  fabricCanvas.freeDrawingBrush.width = 3;
  fabricCanvas.freeDrawingBrush.color = '#ef4444'; // Rote Linie zum Zeichnen

  // Deaktiviere Interaktion mit anderen Objekten
  fabricCanvas.forEachObject(obj => {
    obj.selectable = false;
    obj.evented = false;
  });

  // Event-Handler für das abgeschlossene Zeichnen des Pfads registrieren
  fabricCanvas.once('path:created', (e) => {
    if (isLassoCutting && targetImage) {
      const path = e.path;

      // Die gezeichnete Hilfslinie vom Canvas entfernen
      fabricCanvas.remove(path);

      // Pfad als absolutes Clipping-Mask setzen
      path.absolutePositioned = true;
      targetImage.set('clipPath', path);

      // Zeichenmodus beenden
      fabricCanvas.isDrawingMode = false;
      isLassoCutting = false;

      // Interaktion wiederherstellen
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

  showToast('Zeichne eine Linie um das gewünschte Motiv. Drücke ESC zum Abbrechen. ✂️', 'info');
}

/**
 * Bricht das Lasso-Zeichnen ab.
 */
function cancelLassoCrop() {
  fabricCanvas.isDrawingMode = false;
  isLassoCutting = false;
  fabricCanvas.off('path:created'); // Event-Handler sicher entfernen

  fabricCanvas.forEachObject(obj => {
    obj.selectable = true;
    obj.evented = true;
  });

  if (targetImage) {
    fabricCanvas.setActiveObject(targetImage);
  }
  fabricCanvas.renderAll();
  targetImage = null;
  showToast('Ausschneiden abgebrochen.', 'info');
}

/**
 * Wendet einen Kreisausschnitt mittig auf das Bild an.
 */
function cropImageCircle(image) {
  const radius = Math.min(image.width, image.height) / 2;
  const offsetX = image.cropOffsetX || 0;
  const offsetY = image.cropOffsetY || 0;

  const circle = new fabric.Circle({
    radius: radius,
    originX: 'center',
    originY: 'center',
    left: offsetX,
    top: offsetY
  });

  circle.absolutePositioned = false; // Relativ zum Bild positioniert
  image.set('clipPath', circle);
  fabricCanvas.renderAll();
  fabricCanvas.fire('selection:updated'); // Zeige Schieberegler sofort
  showToast('Kreis-Ausschnitt angewendet ⚪', 'success');
}

/**
 * Wendet einen Herz-Ausschnitt auf das Bild an.
 */
function cropImageHeart(image) {
  const s = Math.min(image.width, image.height);
  const pathData = `M 0 ${-0.35*s} C ${-0.15*s} ${-0.55*s}, ${-0.5*s} ${-0.5*s}, ${-0.5*s} ${-0.15*s} C ${-0.5*s} ${0.15*s}, ${-0.15*s} ${0.35*s}, 0 ${0.45*s} C ${0.15*s} ${0.35*s}, ${0.5*s} ${0.15*s}, ${0.5*s} ${-0.15*s} C ${0.5*s} ${-0.5*s}, ${0.15*s} ${-0.55*s}, 0 ${-0.35*s}`;
  const offsetX = image.cropOffsetX || 0;
  const offsetY = image.cropOffsetY || 0;

  const path = new fabric.Path(pathData, {
    originX: 'center',
    originY: 'center',
    left: offsetX,
    top: offsetY
  });

  path.absolutePositioned = false;
  image.set('clipPath', path);
  fabricCanvas.renderAll();
  fabricCanvas.fire('selection:updated');
  showToast('Herz-Ausschnitt angewendet ❤️', 'success');
}

/**
 * Wendet einen Diamant-Ausschnitt auf das Bild an.
 */
function cropImageDiamond(image) {
  const size = Math.min(image.width, image.height);
  const offsetX = image.cropOffsetX || 0;
  const offsetY = image.cropOffsetY || 0;

  const points = [
    { x: 0, y: -size / 2 },
    { x: size / 2, y: 0 },
    { x: 0, y: size / 2 },
    { x: -size / 2, y: 0 }
  ];

  const polygon = new fabric.Polygon(points, {
    originX: 'center',
    originY: 'center',
    left: offsetX,
    top: offsetY
  });

  polygon.absolutePositioned = false;
  image.set('clipPath', polygon);
  fabricCanvas.renderAll();
  fabricCanvas.fire('selection:updated');
  showToast('Diamant-Ausschnitt angewendet 💎', 'success');
}

/**
 * Schneidet alle vier Ecken schräg ab (Achteck).
 */
function cropImageBevel(image) {
  const w = image.width;
  const h = image.height;
  const c = Math.min(w, h) * 0.15; // 15% der kleineren Dimension abschneiden
  const offsetX = image.cropOffsetX || 0;
  const offsetY = image.cropOffsetY || 0;

  const w2 = w / 2;
  const h2 = h / 2;

  const points = [
    { x: -w2 + c, y: -h2 },
    { x: w2 - c, y: -h2 },
    { x: w2, y: -h2 + c },
    { x: w2, y: h2 - c },
    { x: w2 - c, y: h2 },
    { x: -w2 + c, y: h2 },
    { x: -w2, y: h2 - c },
    { x: -w2, y: -h2 + c }
  ];

  const polygon = new fabric.Polygon(points, {
    originX: 'center',
    originY: 'center',
    left: offsetX,
    top: offsetY
  });

  polygon.absolutePositioned = false;
  image.set('clipPath', polygon);
  fabricCanvas.renderAll();
  fabricCanvas.fire('selection:updated');
  showToast('Ecken schräg abgeschnitten ⬡', 'success');
}

/**
 * Wendet einen Stern-Ausschnitt auf das Bild an.
 */
function cropImageStar(image) {
  const size = Math.min(image.width, image.height);
  const R = size / 2;
  const r = R * 0.4;
  const points = [];
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const radius = i % 2 === 0 ? R : r;
    points.push({
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle)
    });
  }
  const offsetX = image.cropOffsetX || 0;
  const offsetY = image.cropOffsetY || 0;

  const polygon = new fabric.Polygon(points, {
    originX: 'center',
    originY: 'center',
    left: offsetX,
    top: offsetY
  });

  polygon.absolutePositioned = false;
  image.set('clipPath', polygon);
  fabricCanvas.renderAll();
  fabricCanvas.fire('selection:updated');
  showToast('Stern-Ausschnitt angewendet ⭐', 'success');
}

/**
 * Wendet einen Sonnen-Ausschnitt auf das Bild an.
 */
function cropImageSun(image) {
  const size = Math.min(image.width, image.height);
  const R = size / 2;
  const r = R * 0.75;
  const points = [];
  for (let i = 0; i < 32; i++) {
    const angle = (i * Math.PI) / 16;
    const radius = i % 2 === 0 ? R : r;
    points.push({
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle)
    });
  }
  const offsetX = image.cropOffsetX || 0;
  const offsetY = image.cropOffsetY || 0;

  const polygon = new fabric.Polygon(points, {
    originX: 'center',
    originY: 'center',
    left: offsetX,
    top: offsetY
  });

  polygon.absolutePositioned = false;
  image.set('clipPath', polygon);
  fabricCanvas.renderAll();
  fabricCanvas.fire('selection:updated');
  showToast('Sonnen-Ausschnitt angewendet ☀️', 'success');
}

/**
 * Wendet einen Wolken-Ausschnitt auf das Bild an.
 */
function cropImageCloud(image) {
  const s = Math.min(image.width, image.height);
  const pathData = `M ${-0.25*s} ${0.12*s} C ${-0.45*s} ${0.12*s}, ${-0.45*s} ${-0.12*s}, ${-0.25*s} ${-0.12*s} C ${-0.24*s} ${-0.28*s}, ${-0.08*s} ${-0.28*s}, 0 ${-0.15*s} C ${0.08*s} ${-0.28*s}, ${0.24*s} ${-0.28*s}, ${0.25*s} ${-0.12*s} C ${0.45*s} ${-0.12*s}, ${0.45*s} ${0.12*s}, ${0.25*s} ${0.12*s} C ${0.24*s} ${0.28*s}, ${0.08*s} ${0.28*s}, 0 ${0.15*s} C ${-0.08*s} ${0.28*s}, ${-0.24*s} ${0.28*s}, ${-0.25*s} ${0.12*s} Z`;
  const offsetX = image.cropOffsetX || 0;
  const offsetY = image.cropOffsetY || 0;

  const path = new fabric.Path(pathData, {
    originX: 'center',
    originY: 'center',
    left: offsetX,
    top: offsetY
  });

  path.absolutePositioned = false;
  image.set('clipPath', path);
  fabricCanvas.renderAll();
  fabricCanvas.fire('selection:updated');
  showToast('Wolken-Ausschnitt angewendet ☁️', 'success');
}



/* ═══════════════════════════════════════════════════════════
   7. HINTERGRUNDFARBE (SOLIDS & GRADIENTS PRESETS)
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

function initBackgroundColor() {
  const picker = document.getElementById('bg-color-picker');
  
  // Farbvorlagen rendern
  renderBgPresets();

  picker.addEventListener('input', () => {
    setCanvasBackground(picker.value);
  });
}

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

    // Farb-Picker auf die erste Farbe setzen
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

    // Passenden Button markieren
    const matchingBtn = Array.from(buttons).find(b => b.title === BG_PRESETS.find(p => p.value === colorOrGradient)?.name);
    if (matchingBtn) matchingBtn.classList.add('active');

  } else {
    // Feste Farbe
    if (picker) picker.value = colorOrGradient;

    fabricCanvas.setBackgroundColor(colorOrGradient, () => {
      fabricCanvas.renderAll();
    });

    // Passenden Button markieren
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
   8. PROJEKT SPEICHERN / LADEN (JSON)
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

/**
 * Exportiert den Canvas-Zustand + Metadaten als JSON-Datei.
 */
function saveProjectJSON() {
  const childName = document.getElementById('child-select').value || 'Unbenannt';

  const projectData = {
    version:   '1.0.0',
    app:       'Kita-Portfolio-Studio',
    savedAt:   new Date().toISOString(),
    child:     childName,
    canvas:    fabricCanvas.toJSON(['selectable', 'editable', 'perPixelTargetFind', 'cropOffsetX', 'cropOffsetY']),
    bgColor:   currentBgColorVal
  };

  const blob = new Blob([JSON.stringify(projectData, null, 2)], {
    type: 'application/json'
  });

  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = `portfolio_${sanitizeFilename(childName)}_${dateStamp()}.json`;
  link.click();
  URL.revokeObjectURL(url);

  showToast('Projekt gespeichert ✓', 'success');
}

/**
 * Lädt eine gespeicherte JSON-Datei und stellt den Canvas wieder her.
 */
function loadProjectJSON(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);

      if (!data.canvas) {
        showToast('Ungültige Projektdatei.', 'error');
        return;
      }

      // Canvas wiederherstellen
      fabricCanvas.loadFromJSON(data.canvas, () => {
        // Bestehende Bilder mit Klick-Transparenz ausstatten
        fabricCanvas.getObjects('image').forEach(img => {
          img.set('perPixelTargetFind', true);
        });
        fabricCanvas.renderAll();

        // Hintergrundfarbe wiederherstellen
        if (data.bgColor) {
          setCanvasBackground(data.bgColor);
        }

        // Kind-Auswahl setzen (falls vorhanden)
        if (data.child) {
          const select = document.getElementById('child-select');
          // Prüfen ob das Kind existiert, sonst hinzufügen
          const children = loadChildren();
          if (!children.includes(data.child)) {
            children.push(data.child);
            children.sort((a, b) => a.localeCompare(b, 'de'));
            saveChildren(children);
            // Dropdown neu rendern
            const opt = document.createElement('option');
            opt.value = data.child;
            opt.textContent = data.child;
            select.appendChild(opt);
          }
          select.value = data.child;
          localStorage.setItem(STORAGE_KEY_SELECTED, data.child);
        }

        showToast('Projekt geladen ✓', 'success');
      });
    } catch (err) {
      console.error('Fehler beim Laden:', err);
      showToast('Fehler beim Laden der Datei.', 'error');
    }
  };
  reader.readAsText(file);

  // Input zurücksetzen
  event.target.value = '';
}


/* ═══════════════════════════════════════════════════════════
   9. PDF-EXPORT
   ═══════════════════════════════════════════════════════════ */

/**
 * Exportiert das Canvas als DIN-A4-PDF mit jsPDF.
 * Verwendet einen Multiplikator von 2 für bessere Qualität.
 */
function exportPDF() {
  showToast('PDF wird erstellt…', 'info');

  // Auswahl aufheben, damit keine Markierungen im PDF erscheinen
  fabricCanvas.discardActiveObject();
  fabricCanvas.renderAll();

  // Canvas als hochauflösendes PNG exportieren
  let dataURL;
  try {
    dataURL = fabricCanvas.toDataURL({
      format:     'png',
      quality:    1.0,
      multiplier: 2  // 2× Auflösung für scharfen Druck
    });
  } catch (err) {
    // SecurityError bei „tainted canvas" – passiert wenn Bilder ohne
    // CORS-Header geladen wurden (z. B. von Google Photos per Drag & Drop)
    console.warn('Canvas tainted – PDF-Export fehlgeschlagen:', err);
    showToast(
      'PDF-Export fehlgeschlagen: Ein Bild wurde ohne CORS geladen. ' +
      'Bitte das Bild zuerst herunterladen und als lokale Datei hochladen.',
      'error'
    );
    return;
  }

  // jsPDF: A4 Hochformat, Maße in mm
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit:        'mm',
    format:      'a4'
  });

  // Bild auf volle A4-Seite setzen (210 × 297 mm)
  pdf.addImage(dataURL, 'PNG', 0, 0, 210, 297);

  const childName = document.getElementById('child-select').value || 'Portfolio';
  pdf.save(`portfolio_${sanitizeFilename(childName)}_${dateStamp()}.pdf`);

  showToast('PDF exportiert ✓', 'success');
}

/**
 * Druckt das aktuelle Canvas über den nativen Druckdialog des Browsers.
 */
function printPageNative() {
  showToast('Bereite Drucken vor…', 'info');

  // Auswahl aufheben, damit keine Markierungen im Druck erscheinen
  fabricCanvas.discardActiveObject();
  fabricCanvas.renderAll();

  // Canvas als hochauflösendes PNG exportieren
  let dataURL;
  try {
    dataURL = fabricCanvas.toDataURL({
      format:     'png',
      quality:    1.0,
      multiplier: 2  // 2× Auflösung für scharfen Druck
    });
  } catch (err) {
    console.warn('Canvas tainted – Drucken fehlgeschlagen:', err);
    showToast(
      'Drucken fehlgeschlagen: Ein Bild wurde ohne CORS geladen. ' +
      'Bitte das Bild zuerst herunterladen und als lokale Datei hochladen.',
      'error'
    );
    return;
  }

  // Neues temporäres Fenster für den Druck öffnen
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    showToast('Drucken fehlgeschlagen: Popups wurden blockiert.', 'error');
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <title>Portfolio-Seite drucken</title>
      <style>
        body {
          margin: 0;
          padding: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          background: #ffffff;
        }
        img {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }
        @page {
          size: A4 portrait;
          margin: 0;
        }
        @media print {
          body {
            margin: 0;
          }
        }
      </style>
    </head>
    <body>
      <img src="${dataURL}" onload="window.print(); window.close();" />
    </body>
    </html>
  `);
  printWindow.document.close();
}


/* ═══════════════════════════════════════════════════════════
   10. CANVAS LEEREN
   ═══════════════════════════════════════════════════════════ */

function clearCanvas() {
  if (!confirm('Canvas wirklich komplett leeren? Alle Elemente gehen verloren.')) return;

  fabricCanvas.clear();
  setCanvasBackground('#ffffff');
  activePageId = null;
  showToast('Canvas geleert.', 'info');
}


/* ═══════════════════════════════════════════════════════════
   11. TASTATUR-SHORTCUTS
   ═══════════════════════════════════════════════════════════ */

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Nicht auslösen, wenn in einem Input/Textarea getippt wird
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Entf / Backspace → Auswahl löschen
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelected();
    }
  });
}


/* ═══════════════════════════════════════════════════════════
   HILFSFUNKTIONEN
   ═══════════════════════════════════════════════════════════ */

/**
 * Zeigt eine kurze Toast-Benachrichtigung an.
 * @param {string} message – Nachrichtentext
 * @param {'success'|'error'|'info'} type – Art der Meldung
 */
function showToast(message, type = 'info') {
  // Container erstellen, falls nicht vorhanden
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ';
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;

  container.appendChild(toast);

  // Nach 3 s ausblenden
  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 3000);
}

/**
 * Erzeugt einen Dateinamen-sicheren String.
 */
function sanitizeFilename(str) {
  return str
    .replace(/[^a-zA-Z0-9äöüÄÖÜß\s-]/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase()
    .substring(0, 40);
}

/**
 * Erzeugt einen kompakten Datumsstempel (YYYY-MM-DD).
 */
function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


/* ═══════════════════════════════════════════════════════════
   PORTFOLIO-ARCHIV DATENBANK (LocalStorage)
   ═══════════════════════════════════════════════════════════ */

const STORAGE_KEY_PAGES = 'kita_portfolio_saved_pages';

function loadSavedPages() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_PAGES)) || [];
  } catch {
    return [];
  }
}

function saveSavedPages(pages) {
  localStorage.setItem(STORAGE_KEY_PAGES, JSON.stringify(pages));
}

/**
 * Speichert den aktuellen Canvas-Zustand unter dem ausgewählten Kind im Studio-Archiv.
 */
function savePageToArchive() {
  const childSelect = document.getElementById('child-select');
  const childName = childSelect.value;
  if (!childName) {
    showToast('Bitte wähle zuerst ein Kind aus!', 'error');
    return;
  }

  const pages = loadSavedPages();
  let existingPage = null;

  if (activePageId) {
    existingPage = pages.find(p => p.id === activePageId);
  }

  if (existingPage) {
    const overwrite = confirm(`Möchtest du die bestehende Seite "${existingPage.title}" überschreiben?\n(Abbrechen speichert als neue Seite)`);
    if (overwrite) {
      existingPage.canvas = fabricCanvas.toJSON(['selectable', 'editable', 'perPixelTargetFind', 'cropOffsetX', 'cropOffsetY']);
      existingPage.bgColor = currentBgColorVal;
      existingPage.updatedAt = new Date().toISOString();
      saveSavedPages(pages);
      showToast('Seite aktualisiert ✓', 'success');
      sendBackupToServer(); // Automatisches Backup auslösen
      return;
    }
  }

  // Als neue Seite speichern
  const title = prompt('Name dieser Portfolio-Seite (z.B. "Mein erster Tag"):', existingPage ? `${existingPage.title} (Kopie)` : '');
  if (title === null) return; // Abgebrochen
  const finalTitle = title.trim() || 'Unbenannte Seite';

  const newPage = {
    id: Date.now().toString(),
    child: childName,
    title: finalTitle,
    createdAt: new Date().toISOString(),
    canvas: fabricCanvas.toJSON(['selectable', 'editable', 'perPixelTargetFind', 'cropOffsetX', 'cropOffsetY']),
    bgColor: currentBgColorVal
  };

  pages.push(newPage);
  saveSavedPages(pages);
  activePageId = newPage.id; // Seite wird als aktiv markiert
  showToast('Seite im Archiv gespeichert ✓', 'success');
  sendBackupToServer(); // Automatisches Backup auslösen
}

/**
 * Initialisiert das Portfolio-Archiv Modal und dessen Interaktion.
 */
function initArchive() {
  const btnOpen = document.getElementById('btn-open-archive');
  const modal = document.getElementById('archive-modal');
  const btnClose = document.getElementById('btn-close-archive');
  const childrenList = document.getElementById('archive-children-list');
  const pagesList = document.getElementById('archive-pages-list');
  const selectedTitle = document.getElementById('archive-selected-child-title');

  let currentSelectedChild = null;

  if (!btnOpen || !modal) return;

  btnOpen.addEventListener('click', () => {
    modal.style.display = 'flex';
    renderArchiveChildren();
  });

  btnClose.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });

  function renderArchiveChildren() {
    childrenList.innerHTML = '';
    const children = loadChildren();
    const pages = loadSavedPages();

    if (children.length === 0) {
      childrenList.innerHTML = '<li class="archive-empty">Keine Kinder angelegt</li>';
      pagesList.innerHTML = '<div class="archive-empty">Lege zuerst ein Kind in der linken Seitenleiste an!</div>';
      selectedTitle.textContent = 'Seiten';
      return;
    }

    if (!currentSelectedChild || !children.includes(currentSelectedChild)) {
      currentSelectedChild = children[0];
    }

    children.forEach(child => {
      const childPages = pages.filter(p => p.child === child);
      const li = document.createElement('li');
      li.className = `archive-list-item ${child === currentSelectedChild ? 'active' : ''}`;
      
      const nameSpan = document.createElement('span');
      nameSpan.textContent = child;
      li.appendChild(nameSpan);

      const countSpan = document.createElement('span');
      countSpan.className = 'archive-page-count';
      countSpan.textContent = `${childPages.length} ${childPages.length === 1 ? 'Seite' : 'Seiten'}`;
      li.appendChild(countSpan);

      li.addEventListener('click', () => {
        currentSelectedChild = child;
        childrenList.querySelectorAll('.archive-list-item').forEach(item => item.classList.remove('active'));
        li.classList.add('active');
        renderArchivePages();
      });

      childrenList.appendChild(li);
    });

    renderArchivePages();
  }

  function renderArchivePages() {
    pagesList.innerHTML = '';
    selectedTitle.textContent = `Seiten von ${currentSelectedChild}`;

    const pages = loadSavedPages();
    const childPages = pages.filter(p => p.child === currentSelectedChild);

    if (childPages.length === 0) {
      pagesList.innerHTML = '<div class="archive-empty">Noch keine Seiten für dieses Kind gespeichert.</div>';
      return;
    }

    // Neueste zuerst
    childPages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    childPages.forEach(page => {
      const card = document.createElement('div');
      card.className = 'archive-page-card';

      const info = document.createElement('div');
      info.className = 'archive-page-info';

      const title = document.createElement('h4');
      title.textContent = page.title;
      info.appendChild(title);

      const date = document.createElement('span');
      const d = new Date(page.createdAt);
      date.textContent = `Erstellt: ${d.toLocaleDateString('de-DE')} ${d.toLocaleTimeString('de-DE', {hour: '2-digit', minute:'2-digit'})}`;
      info.appendChild(date);
      card.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'archive-page-actions';

      const btnLoad = document.createElement('button');
      btnLoad.className = 'btn btn-primary btn-sm';
      btnLoad.innerHTML = '✏️ Bearbeiten';
      btnLoad.addEventListener('click', () => {
        loadPageToCanvas(page);
        modal.style.display = 'none';
      });
      actions.appendChild(btnLoad);

      const btnDelete = document.createElement('button');
      btnDelete.className = 'btn btn-danger btn-sm';
      btnDelete.innerHTML = '🗑';
      btnDelete.title = 'Seite löschen';
      btnDelete.addEventListener('click', () => {
        if (confirm(`Möchtest du die Seite "${page.title}" wirklich löschen?`)) {
          const allPages = loadSavedPages();
          const filtered = allPages.filter(p => p.id !== page.id);
          saveSavedPages(filtered);
          showToast('Seite gelöscht.', 'info');
          if (activePageId === page.id) {
            activePageId = null;
          }
          renderArchiveChildren();
          sendBackupToServer(); // Automatisches Backup auslösen
        }
      });
      actions.appendChild(btnDelete);

      card.appendChild(actions);
      pagesList.appendChild(card);
    });
  }
}

/**
 * Lädt eine Seite aus dem Archiv auf das Canvas.
 */
function loadPageToCanvas(page) {
  showToast(`Lade "${page.title}"…`, 'info');

  const select = document.getElementById('child-select');
  select.value = page.child;
  localStorage.setItem(STORAGE_KEY_SELECTED, page.child);

  fabricCanvas.loadFromJSON(page.canvas, () => {
    // Bestehende Bilder mit Klick-Transparenz ausstatten
    fabricCanvas.getObjects('image').forEach(img => {
      img.set('perPixelTargetFind', true);
    });
    fabricCanvas.renderAll();

    if (page.bgColor) {
      setCanvasBackground(page.bgColor);
    }

    activePageId = page.id;
    showToast(`Seite "${page.title}" geladen ✓`, 'success');
  });
}

/**
 * Sendet ein automatisches Backup des gesamten Archivs an den lokalen Server.
 */
async function sendBackupToServer() {
  const children = loadChildren();
  const pages = loadSavedPages();

  const backupData = {
    timestamp: new Date().toISOString(),
    children: children,
    pages: pages
  };

  try {
    const response = await fetch('http://localhost:3000/api/backup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(backupData)
    });

    if (response.ok) {
      const resData = await response.json();
      console.log('💾 Backup-Sicherungskopie erfolgreich gespeichert:', resData.file);
    } else {
      console.warn('⚠️ Backup-Server antwortete mit Fehler:', response.status);
    }
  } catch (err) {
    // Stilles Logging, falls der Server offline ist
    console.log('ℹ️ Lokaler Backup-Server nicht erreichbar. Sicherungskopie nur im Browser-Speicher abgelegt.');
  }
}
