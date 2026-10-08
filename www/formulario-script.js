
  const $ = (s, r = document) => r.querySelector(s);
  const form = $('#f');
  // definición global del toast
  const showToast = (message) => { 
    const toastEl = document.querySelector('#toast'); 
    if (!toastEl) { 
      console.error('No existe el elemento #toast'); 
      return; 
    } 
    toastEl.textContent = message; 
    setTimeout(() => { 
      toastEl.textContent = ''; 
    }, 2500); 
  };
  // ---- Ajustes fáciles de editar ----
  const SIZES = [21, 22.5, 31.5, 32, 33, 33.5, 43.5, 48.5, 10.5,16,22];   // tamaños de la lista
  // -----------------------------------

  // Fecha automática (formato local) y mínimo para la entrega = hoy
  const today = new Date();
  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const setToday = () => {
    $('#fecha').value = today.toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    $('#entrega').min = iso(today);
  };
  setToday();

  // Lista de tamaños
  $('#sizeList').innerHTML = SIZES.map(n =>
    `<label class="opt"><input type="radio" name="size" value="${n}">${n}</label>`).join('');

  // "Otro" tamaño: activa el campo numérico solo si se elige
  const sizeOtroVal = $('#sizeOtroVal');
  form.addEventListener('change', e => {
    if (e.target.name === 'size') {
      const otro = $('#sizeOtro').checked;
      sizeOtroVal.disabled = !otro;
      if (otro) sizeOtroVal.focus();
    }
  });
  // Escribir en "Otro" lo selecciona automáticamente
  sizeOtroVal.addEventListener('focus', () => { $('#sizeOtro').checked = true; sizeOtroVal.disabled = false; });

  // Faldilla solo disponible si "Colocar faldilla" está marcado
  const syncFaldilla = () => {
    const on = $('#tipoFaldilla').checked;
    $('#faldilla').disabled = !on;
    $('#faldillaHint').style.display = on ? 'none' : '';
    if (!on) form.querySelectorAll('[name=faldilla]').forEach(r => r.checked = false);
  };
  $('#tipoFaldilla').addEventListener('change', syncFaldilla);
  syncFaldilla();

  // Vista previa de la imagen
  const prev = $('#preview');
  $('#publicidad').addEventListener('change', e => {
    const f = e.target.files[0];
    if (prev.src) URL.revokeObjectURL(prev.src);
    if (f) { prev.src = URL.createObjectURL(f); prev.style.display = 'block'; }
    else { prev.removeAttribute('src'); prev.style.display = 'none'; }
  });

  // Reset: vuelve a dejar el formulario como al principio
  form.addEventListener('reset', () => setTimeout(() => {
    prev.style.display = 'none'; prev.removeAttribute('src');
    sizeOtroVal.disabled = true; syncFaldilla(); setToday();
    document.querySelectorAll('.err').forEach(p => p.textContent = '');
    $('#summary').style.display = 'none'; $('#out').style.display = 'none';
  }));

  // ---- Validación ----
  const setErr = (name, msg) => {
    const p = $(`.err[data-for="${name}"]`); if (p) p.textContent = msg || '';
    const box = document.getElementById(name);
    if (box) box.classList.toggle('invalid', !!msg);
    return !!msg;
  };
  const checked = n => [...form.querySelectorAll(`[name=${n}]:checked`)];

  function validate() {
    let first = null;
    const bad = (name, msg) => { if (setErr(name, msg) && !first) first = document.getElementById(name); };

    bad('cliente', $('#cliente').value.trim() ? '' : 'Escribe el nombre del cliente.');
    // Solo "cliente" es obligatorio; el resto puede quedar en blanco.
    // Si se rellenan, se comprueba que los valores tengan sentido.
    const c = $('#cantidad').value;
    bad('cantidad', c !== '' && !(parseInt(c, 10) > 0) ? 'La cantidad debe ser mayor que 0.' : '');

    const d = $('#entrega').value;
    bad('entrega', d && d < iso(today) ? 'La fecha no puede ser anterior a hoy.' : '');

    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return !first;
  }

  // ---- Resumen ----


let summaryText = {};

form.addEventListener('submit', e => {
  e.preventDefault();

  if (!validate()) return;

  const dash = null;

  const s = checked('size')[0];
  const size = !s
    ? dash
    : s.value === 'otro'
      ? (sizeOtroVal.value)
      : s.value;

  const dv = $('#entrega').value;
  const fd = dv ? dv.split('-').reverse().join('/') : dash;

  const img = $('#publicidad').files[0];

  const tipos = checked('tipo')
    .map(c => c.value)
    .join(', ');

  const cant = $('#cantidad').value;
  const exact = checked('exactitud')[0]?.value.toLowerCase();
  console.log(cant + exact)
  // Objeto que después se puede convertir directamente a JSON
  summaryText = {
    fecha: $('#fecha').value || dash,
    cliente: $('#cliente').value.trim()|| dash,
    publicidad_path: img ? img.name : null,
    tipo: tipos|| dash,
    tamaño: size|| dash,
    faldilla: checked('faldilla')[0]?.value|| dash,
    idioma: checked('idioma')[0]?.value|| dash,
    cantidad: cant|| dash,
    exactitud: checked('exactitud')[0]?.value.toLowerCase()|| dash,
    produccion: checked('modo')[0]?.value|| dash,
    entrega: fd|| dash
  };
//   {
//   "fecha": "lunes, 05 de octubre de 2026",
//   "cliente": "paydi",
//   "publicidad_path": "fox.png",
//   "tipo": "Colocar varilla, Colocar faldilla",
//   "tamaño": "36",
//   "faldilla": "Bimensual",
//   "idioma": "Gallego",
//   "cantidad": "1325",
//   "exactitud": "aproximada",
//   "produccion": "Hacer todos",
//   "entrega": "30/10/2026"
// }

  // Mostrarlo como JSON
  const box = $('#summary');
  box.textContent = JSON.stringify(summaryText, null, 2);
  box.style.display = 'block';

  $('#out').style.display = 'grid';

  box.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });

  console.log(summaryText);
  console.log(JSON.stringify(summaryText));
});





  $('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(summaryText); showToast('Resumen copiado'); }
    catch { showToast('No se pudo copiar'); }
  };
  // Compartir: en móvil abre el menú nativo; incluye la imagen si el navegador lo permite
  $('#share').onclick = async () => {
    const files = $('#publicidad').files[0] ? [$('#publicidad').files[0]] : [];
    const data = { title: 'Pedido', text: summaryText };
    enviarPedido();
    
  };
  $('#print').onclick = () => window.print();


  const API_URL = '/api/pedidos';   // si el HTML está en otro dominio: 'https://tu-dominio.com/api/pedidos'
  async function enviarPedido() {
    const fd = new FormData();
    fd.append('cliente', document.querySelector('#cliente').value.trim());
  
    const img = document.querySelector('#publicidad').files[0];
    if (img) fd.append('publicidad_path', img);
  
    // Checkboxes -> tipo[]
    document.querySelectorAll('[name=tipo]:checked').forEach(c => fd.append('tipo[]', c.value));
  
    // Tamaño: valor de la lista o el número de "Otro"
    const s = document.querySelector('[name=size]:checked');
    if (s) fd.append('size', s.value === 'otro' ? document.querySelector('#sizeOtroVal').value : s.value);
  
    // Radios y campos simples: solo se envían si tienen valor
    for (const n of ['faldilla', 'idioma', 'exactitud', 'modo']) {
      const r = document.querySelector(`[name=${n}]:checked`);
      if (r) fd.append(n, r.value);
    }
    for (const id of ['cantidad', 'entrega']) {
      const v = document.querySelector('#' + id).value;
      if (v) fd.append(id, v);
    }
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { Accept: 'application/json' }, // sin Content-Type: el navegador pone el boundary
      body: fd,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(Object.values(json.errors || {}).flat().join('\n') || json.message);
    showToast("pedido de "+json.cliente+" guardado");
    return json; // pedido guardado (incluye id y publicidad_url)
  }


