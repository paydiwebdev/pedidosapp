/* ==========================================================================
   Hoja de pedido
   1. Configuración y utilidades
   2. Campos del formulario (fecha, tamaño, faldilla)
   3. Imágenes de publicidad (galería / cámara)
   4. Validación
   5. Resumen
   6. Botones de acción (copiar, enviar, imprimir)
   7. Envío al servidor
   ========================================================================== */

// ───────── 1 · CONFIGURACIÓN Y UTILIDADES ─────────

// Atajo para querySelector (por defecto busca en todo el documento)
const getElement = (selector, root = document) => root.querySelector(selector);

const orderForm = getElement('#f');

// Ajustes fáciles de editar
const SIZE_OPTIONS = [21, 22.5, 31.5, 32, 33, 33.5, 43.5, 48.5, 10.5, 16, 22];  // tamaños de la lista
// Qué elementos cuentan como "un dato" al avanzar con Enter / al elegir una opción.
// Se usa el contenedor MÁS CERCANO al campo que coincida con alguno de estos selectores:
// si un grupo de opciones (.opts) está dentro de un .field, avanza al .opts; si no hay .opts, al .field.
// Si prefieres que todo sea ".field", pon aquí solo '.field'.
const STEP_SELECTOR = '.opts, .field, fieldset';
const STEP_SCROLL_MARGIN = '88px';    // hueco por encima, para que se vea el título del dato
const MAX_IMAGES = 10;                       // debe coincidir con 'publicidad' => max:10 en Laravel
const PEDIDOS_PATH = '/api/pedidos';
const REQUEST_TIMEOUT_MS = 30000;            // si el servidor no responde en 30 s, se cancela el envío

// Dentro de la app (Capacitor) no hay servidor Laravel: '/api/pedidos' se resolvería contra la propia
// app y devolvería su index.html. Por eso hay que indicar la URL real del servidor.
// Déjalo vacío para que la app la pregunte la primera vez, o pon p. ej. 'http://192.168.1.50:8000'
const DEFAULT_SERVER_URL = '';
const isNativeApp = () => !!window.Capacitor?.isNativePlatform?.();

// URL completa a la que se envía el pedido
function getPedidosUrl() {
  if (!isNativeApp()) return PEDIDOS_PATH;   // en el navegador: mismo servidor que sirve la página

  let serverUrl = localStorage.getItem('serverUrl') || DEFAULT_SERVER_URL;
  if (!serverUrl) {
    serverUrl = (prompt('URL del servidor Laravel (ej. http://192.168.1.50:8000)') || '').trim().replace(/\/+$/, '');
    if (!serverUrl) throw new Error('Falta la URL del servidor: la app no está conectada al backend.');
    localStorage.setItem('serverUrl', serverUrl);
  }
  return serverUrl + PEDIDOS_PATH;
}

// Botón opcional "⚙ Servidor" (si existe en el HTML) para cambiar la URL guardada
const serverButton = getElement('#cfg');
if (serverButton && isNativeApp()) {
  serverButton.hidden = false;
  serverButton.onclick = () => {
    const newUrl = prompt('URL del servidor', localStorage.getItem('serverUrl') || DEFAULT_SERVER_URL);
    if (newUrl !== null) localStorage.setItem('serverUrl', newUrl.trim().replace(/\/+$/, ''));
  };
}

// Estado de la página
let imageFiles = [];          // imágenes de publicidad elegidas
let thumbnailUrls = [];       // URLs temporales de las miniaturas (hay que liberarlas)
let summaryData = null;       // datos del pedido como objeto (para convertir a JSON)
let summaryDisplay = '';      // los mismos datos en texto legible

// Mensaje emergente que desaparece solo
const showToast = (message, durationMs = 4000) => {
  const toastElement = getElement('#toast');
  if (!toastElement) return console.error('No existe el elemento #toast');

  toastElement.textContent = message;
  setTimeout(() => { toastElement.textContent = ''; }, durationMs);
};

// Devuelve las casillas/radios marcados de un grupo (por su atributo name)
const getCheckedInputs = fieldName =>
  [...orderForm.querySelectorAll(`[name=${fieldName}]:checked`)];

// ───────── 2 · CAMPOS DEL FORMULARIO ─────────

// Fecha de hoy, con el desfase horario corregido, en formato 'AAAA-MM-DD'
const today = new Date();
const toLocalIsoDate = date =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// Rellena la fecha (no editable) y no deja elegir una entrega anterior a hoy
const setToday = () => {
  getElement('#fecha').value = today.toLocaleDateString('es-ES', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
  getElement('#entrega').min = toLocalIsoDate(today);
};
setToday();

// Lista de tamaños: un radio por cada valor de SIZE_OPTIONS
getElement('#sizeList').innerHTML = SIZE_OPTIONS.map(size =>
  `<label class="opt"><input type="radio" name="tamaño" value="${size}">${size}</label>`
).join('');

// "Otro" tamaño: el campo numérico solo se activa si se elige esa opción
const otherSizeInput = getElement('#sizeOtroVal');

orderForm.addEventListener('change', event => {
  if (event.target.name !== 'tamaño') return;

  const isOtherSelected = getElement('#sizeOtro').checked;
  otherSizeInput.disabled = !isOtherSelected;
  if (isOtherSelected) otherSizeInput.focus();
});

// Escribir en el campo "Otro" selecciona automáticamente esa opción
otherSizeInput.addEventListener('focus', () => {
  getElement('#sizeOtro').checked = true;
  otherSizeInput.disabled = false;
});

// La faldilla solo se puede elegir si "Colocar faldilla" está marcado
const syncFaldilla = () => {
  const faldillaEnabled = getElement('#tipoFaldilla').checked;

  getElement('#faldilla').disabled = !faldillaEnabled;
  getElement('#faldillaHint').style.display = faldillaEnabled ? 'none' : '';

  // Si se desmarca, se borra la opción que hubiera elegida
  if (!faldillaEnabled) {
    orderForm.querySelectorAll('[name=faldilla]').forEach(radio => { radio.checked = false; });
  }
};
getElement('#tipoFaldilla').addEventListener('change', syncFaldilla);
syncFaldilla();

// ── Navegación entre datos ──
// Lista los "datos" del formulario en orden, sin depender de las clases del HTML.
// Se parte de los propios <input>: los radios/casillas con el mismo name forman UN dato
// (p. ej. todas las opciones de "tamaño" o de "tipo"), y cada campo suelto es otro dato.
// Para desplazar la pantalla se usa el contenedor más cercano según STEP_SELECTOR
// y, si no hay ninguno, el propio campo.
function getFormSections() {
  const sectionsByKey = new Map();

  orderForm.querySelectorAll('input, textarea').forEach(input => {
    // Se ignoran los campos que no se rellenan a mano
    if (input.type === 'hidden' || input.hidden || input.readOnly) return;

    const isOptionGroup = input.type === 'radio' || input.type === 'checkbox';
    const key = isOptionGroup ? 'group:' + input.name : input;

    if (!sectionsByKey.has(key)) {
      sectionsByKey.set(key, {
        element: input.closest(STEP_SELECTOR) ?? input,
        inputs: [],
      });
    }
    sectionsByKey.get(key).inputs.push(input);
  });

  return [...sectionsByKey.values()];
}

// Desplaza la pantalla al siguiente dato que se pueda rellenar
// (se saltan los desactivados, como la faldilla si no está marcada)
function scrollToNextSection(currentInput) {
  const sections = getFormSections();
  const currentIndex = sections.findIndex(section => section.inputs.includes(currentInput));
  if (currentIndex === -1) return;

  const currentElement = sections[currentIndex].element;
  const nextSection = sections.slice(currentIndex + 1).find(section =>
    section.element !== currentElement &&                            // p. ej. el campo "Otro" está dentro del mismo bloque de tamaño
    section.inputs.some(input => !input.matches(':disabled'))        // :disabled tiene en cuenta fieldset desactivados
  );

  if (nextSection) {
    nextSection.element.style.scrollMarginTop = STEP_SCROLL_MARGIN;
    nextSection.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Al elegir una opción exclusiva (radio) se pasa al siguiente dato.
// Las casillas de "Tipo" NO avanzan porque se pueden marcar varias, y "Otro" tampoco
// porque hay que escribir el número.
orderForm.addEventListener('change', event => {
  const input = event.target;
  if (input.type === 'radio' && input.id !== 'sizeOtro') scrollToNextSection(input);
});

// Enter en un campo de texto/número/fecha: ya NO envía el formulario (antes saltaba al resumen,
// al final de la página). Cierra el teclado y pasa al siguiente dato. El envío solo se hace
// con el botón "Ver resumen". En el área de observaciones Enter sigue haciendo salto de línea.
orderForm.addEventListener('keydown', event => {
  const isSingleLineField = event.target.matches('input:not([type=checkbox]):not([type=radio]):not([type=file])');
  if (event.key !== 'Enter' || !isSingleLineField) return;

  event.preventDefault();
  event.target.blur();
  scrollToNextSection(event.target);
});

// En el móvil, la tecla "Siguiente" del teclado NO envía un Enter: el navegador mueve el cursor por su
// cuenta al siguiente campo de texto y se salta las opciones (de cliente iba directo a cantidad).
// Con enterkeyhint="done" la tecla pasa a ser "Hecho" y sí envía Enter, que lo gestiona el código de arriba.
orderForm.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file])')
  .forEach(field => field.setAttribute('enterkeyhint', 'done'));

// ───────── 3 · IMÁGENES DE PUBLICIDAD ─────────
// Se pueden añadir varias, desde la galería o con la cámara (la cámara añade de una en una)

const thumbnailsContainer = getElement('#previews');

// Pinta las miniaturas, cada una con un botón ✕ para quitarla
function renderThumbnails() {
  // Libera las URLs anteriores para no gastar memoria
  thumbnailUrls.forEach(url => URL.revokeObjectURL(url));
  thumbnailUrls = imageFiles.map(file => URL.createObjectURL(file));

  thumbnailsContainer.replaceChildren(...imageFiles.map((file, index) => {
    const image = document.createElement('img');
    image.src = thumbnailUrls[index];
    image.alt = file.name;
    // Tamaño fijo en línea: así la miniatura es pequeña aunque el CSS no tenga las reglas .thumb
    image.style.cssText = 'width:84px;height:84px;object-fit:cover;display:block;border-radius:8px';

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'thumb-x';
    removeButton.textContent = '✕';
    removeButton.setAttribute('aria-label', 'Quitar ' + file.name);
    removeButton.onclick = () => { imageFiles.splice(index, 1); renderThumbnails(); };

    const thumbnailBox = document.createElement('div');
    thumbnailBox.className = 'thumb';
    thumbnailBox.append(image, removeButton);
    return thumbnailBox;
  }));
}

// Añade imágenes nuevas respetando el máximo y descartando lo que no sea imagen
function addImages(fileList) {
  const newImages = [...fileList].filter(file => file.type.startsWith('image/'));

  if (imageFiles.length + newImages.length > MAX_IMAGES) {
    showToast(`Máximo ${MAX_IMAGES} imágenes`);
  }
  imageFiles = imageFiles.concat(newImages).slice(0, MAX_IMAGES);
  renderThumbnails();
}

// value = '' permite volver a elegir la misma foto después de quitarla
getElement('#publicidad').addEventListener('change', event => {
  addImages(event.target.files);
  event.target.value = '';
});
getElement('#publicidadCam').addEventListener('change', event => {
  addImages(event.target.files);
  event.target.value = '';
});
getElement('#btnCam').onclick = () => getElement('#publicidadCam').click();

/**
 * Reduce una foto grande antes de enviarla (las fotos de móvil pesan 5-10 MB y
 * el servidor limita 5 MB por imagen y post_max_size en total).
 * Si la imagen ya es pequeña, se devuelve tal cual.
 */
async function resizeImage(file, maxSide = 1600) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));

    if (scale === 1 && file.size < 1.5e6) return file;   // ya es pequeña

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const jpegBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return jpegBlob
      ? new File([jpegBlob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
      : file;
  } catch {
    return file;   // si algo falla, se envía la original
  }
}

// Botón "Borrar todo": deja el formulario como al principio
orderForm.addEventListener('reset', () => setTimeout(() => {
  imageFiles = [];
  renderThumbnails();
  summaryData = null;
  summaryDisplay = '';

  otherSizeInput.disabled = true;
  syncFaldilla();
  setToday();

  document.querySelectorAll('.err').forEach(errorElement => { errorElement.textContent = ''; });
  getElement('#summary').style.display = 'none';
  getElement('#out').style.display = 'none';
}));

// ───────── 4 · VALIDACIÓN (solo "cliente" es obligatorio) ─────────

// Muestra u oculta el error de un campo. Devuelve true si hay error.
const showFieldError = (fieldId, message) => {
  const errorElement = getElement(`.err[data-for="${fieldId}"]`);
  if (errorElement) errorElement.textContent = message || '';

  const fieldElement = document.getElementById(fieldId);
  if (fieldElement) fieldElement.classList.toggle('invalid', !!message);

  return !!message;
};

// Devuelve true si todo está bien; si no, marca los errores y se desplaza al primero
function validate() {
  let firstInvalidField = null;

  const reportError = (fieldId, message) => {
    const hasError = showFieldError(fieldId, message);
    if (hasError && !firstInvalidField) firstInvalidField = document.getElementById(fieldId);
  };

  reportError('cliente', getElement('#cliente').value.trim() ? '' : 'Escribe el nombre del cliente.');

  // Los demás campos son opcionales, pero si se rellenan deben tener sentido
  const quantity = getElement('#cantidad').value;
  reportError('cantidad', quantity !== '' && !(parseInt(quantity, 10) > 0)
    ? 'La cantidad debe ser mayor que 0.' : '');

  const deliveryDate = getElement('#entrega').value;
  reportError('entrega', deliveryDate && deliveryDate < toLocalIsoDate(today)
    ? 'La fecha no puede ser anterior a hoy.' : '');

  if (firstInvalidField) {
    firstInvalidField.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return !firstInvalidField;
}

// ───────── 5 · RESUMEN ─────────

orderForm.addEventListener('submit', event => {
  event.preventDefault();
  if (!validate()) return;

  // Tamaño: el de la lista o el número escrito en "Otro"
  const selectedSize = getCheckedInputs('tamaño')[0];
  const sizeValue = !selectedSize
    ? null
    : selectedSize.value === 'otro' ? (otherSizeInput.value || null) : selectedSize.value;

  // Fecha de entrega en formato dd/mm/aaaa para mostrar
  const deliveryDateValue = getElement('#entrega').value;

  // Objeto con los datos del pedido (los campos vacíos quedan en null)
  summaryData = {
    fecha: getElement('#fecha').value || null,
    cliente: getElement('#cliente').value.trim() || null,
    publicidad: imageFiles.length ? imageFiles.map(file => file.name) : null,
    tipo: getCheckedInputs('tipo').map(checkbox => checkbox.value).join(', ') || null,
    tamaño: sizeValue,
    faldilla: getCheckedInputs('faldilla')[0]?.value || null,
    idioma: getCheckedInputs('idioma')[0]?.value || null,
    cantidad: getElement('#cantidad').value || null,
    exactitud: getCheckedInputs('exactitud')[0]?.value.toLowerCase() || null,
    produccion: getCheckedInputs('produccion')[0]?.value || null,
    entrega: deliveryDateValue ? deliveryDateValue.split('-').reverse().join('/') : null,
    observaciones: getElement('#observaciones').value.trim() || null,
  };

  // Texto legible para revisar el pedido antes de enviarlo
  const formatSummaryValue = value =>
    (value === null || value === undefined || value === '') ? '-' : value;

  const summaryLines = [
    ['Fecha',                 summaryData.fecha],
    ['Cliente',               summaryData.cliente],
    ['Publicidad',            summaryData.publicidad?.join(', ')],
    ['Tipo de trabajo',       summaryData.tipo],
    ['Tamaño',                summaryData.tamaño],
    ['Tipo de faldilla',      summaryData.faldilla],
    ['Idioma',                summaryData.idioma],
    ['Cantidad',              summaryData.cantidad],
    ['Exactitud de cantidad', summaryData.exactitud],
    ['Producción',            summaryData.produccion],
    ['Fecha de entrega',      summaryData.entrega],
    ['Observaciones',         summaryData.observaciones],
  ];
  summaryDisplay = summaryLines
    .map(([label, value]) => `${label}: ${formatSummaryValue(value)}`)
    .join('\n');

  const summaryBox = getElement('#summary');
  summaryBox.textContent = summaryDisplay;
  summaryBox.style.display = 'block';
  getElement('#out').style.display = 'grid';
  summaryBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ───────── 6 · BOTONES DE ACCIÓN ─────────

getElement('#copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(summaryDisplay);
    showToast('Resumen copiado');
  } catch {
    showToast('No se pudo copiar');
  }
};

// Enviar al servidor: el botón se bloquea mientras dura el envío
getElement('#share').onclick = async () => {
  const sendButton = getElement('#share');
  const originalLabel = sendButton.textContent;

  sendButton.disabled = true;
  sendButton.textContent = 'Enviando…';

  try {
    const savedPedido = await sendPedido();
    showToast(`Pedido guardado (nº ${savedPedido.id})`);
  } catch (error) {
    showToast(error.message, 8000);   // los errores se dejan más tiempo para poder leerlos
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = originalLabel;
  }
};

getElement('#print').onclick = () => window.print();

// ───────── 7 · ENVÍO AL SERVIDOR (POST /api/pedidos) ─────────
// Los nombres de campo ('tamaño', 'produccion', 'observaciones'...) deben ser
// los mismos que valida Laravel en StorePedidoRequest.

async function sendPedido() {
  const formData = new FormData();
  formData.append('cliente', getElement('#cliente').value.trim());

  // Una entrada "publicidad[]" por imagen (redimensionada si es grande)
  for (const originalImage of imageFiles) {
    const resizedImage = await resizeImage(originalImage);
    formData.append('publicidad[]', resizedImage, resizedImage.name);
  }

  // Casillas de tipo -> tipo[]
  getCheckedInputs('tipo').forEach(checkbox => formData.append('tipo[]', checkbox.value));

  // Tamaño: valor de la lista o el número de "Otro" (solo si tiene valor)
  const selectedSize = getCheckedInputs('tamaño')[0];
  if (selectedSize) {
    const sizeValue = selectedSize.value === 'otro' ? otherSizeInput.value : selectedSize.value;
    if (sizeValue) formData.append('tamaño', sizeValue);
  }

  // Grupos de radios: solo se envían si hay una opción elegida
  for (const fieldName of ['faldilla', 'idioma', 'exactitud', 'produccion']) {
    const selectedRadio = getCheckedInputs(fieldName)[0];
    if (selectedRadio) formData.append(fieldName, selectedRadio.value);
  }

  // Campos simples: solo si tienen valor
  for (const fieldId of ['cantidad', 'entrega']) {
    const fieldValue = getElement('#' + fieldId).value;
    if (fieldValue) formData.append(fieldId, fieldValue);
  }

  // Las observaciones vacías las convierte Laravel en null
  formData.append('observaciones', getElement('#observaciones').value.trim());

  const pedidosUrl = getPedidosUrl();   // lanza un error claro si la app no tiene servidor configurado

  // AbortController: corta la petición si el servidor no contesta a tiempo
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(pedidosUrl, {
      method: 'POST',
      headers: { Accept: 'application/json' },   // sin Content-Type: el navegador añade el "boundary"
      body: formData,
      signal: abortController.signal,
    });
  } catch (error) {
    throw new Error(error.name === 'AbortError'
      ? 'El servidor no responde (tiempo agotado).'
      : 'No se pudo conectar con el servidor.');
  } finally {
    clearTimeout(timeoutId);
  }

  const responseBody = await response.json().catch(() => null);

  if (!response.ok) {
    // 422: muestra cada error con su campo, p. ej. "The publicidad.0 field must be an image."
    const errorDetails = Object.values(responseBody?.errors || {}).flat().join('\n');
    throw new Error(errorDetails || responseBody?.message || `Error ${response.status}`);
  }

  // Un pedido guardado siempre devuelve su id. Si no llega, la respuesta no es de Laravel
  // (p. ej. la app devolviendo su propio index.html) y NO se debe dar por guardado.
  if (!responseBody || responseBody.id == null) {
    throw new Error('El servidor no devolvió un pedido válido. ¿La URL del servidor es correcta?');
  }
  return responseBody;
}
