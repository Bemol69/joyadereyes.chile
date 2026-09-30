// ===== CONFIGURACIÓN =====
// Datos de la tienda: los inserta scripts/build.mjs desde tienda.config.json y data/ajustes.json
const TIENDA = %%TIENDA_JSON%%;
const WHATSAPP_NUMBER = TIENDA.whatsapp;

// Zonas de entrega en mano (se editan en /admin → Ajustes) + retiro + envío
const ZONAS = (TIENDA.zonas_entrega || []).filter(Boolean);
const PAGOS = {
  transferencia: '🏦 *Pago:* Transferencia',
  efectivo: '💵 *Pago:* Efectivo al recibir',
};

// Buscadores oficiales de sucursales (ninguna de las 3 empresas tiene una API pública sin contrato)
const COURIERS = {
  Starken: 'https://www.starken.cl/sucursales',
  Chilexpress: 'https://centrodeayuda.chilexpress.cl/sucursales',
  'Blue Express': 'https://www.blue.cl/lockers-puntos/encuentra-tu-punto',
};
const EMPRESAS = (TIENDA.empresas_envio || []).filter((e) => COURIERS[e]);

// Productos y categorías se editan desde el panel /admin (data/productos, data/categorias)
// y se publican juntos en data/catalogo.json (lo genera scripts/build.mjs)
let PRODUCTS = [];
let FILTERS = [['todos', 'Todas']];
let REGIONES = [];
let CUPONES = [];

const SORTS = {
  destacados: null,
  'precio-asc': (a, b) => a.price - b.price,
  'precio-desc': (a, b) => b.price - a.price,
};
const MAX_QTY = 20;

// ===== UTILIDADES =====
const clp = (n) => '$' + n.toLocaleString('es-CL');
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const findProduct = (id) => PRODUCTS.find((p) => p.id === id);
const priceText = (p) => (p.price > 0 ? clp(p.price) : 'Consultar');
// Se usa api.whatsapp.com y no wa.me: la redirección de wa.me rompe los emojis (llegan como �)
const waUrl = (text) =>
  `https://api.whatsapp.com/send?phone=${WHATSAPP_NUMBER}${text ? '&text=' + encodeURIComponent(text) : ''}`;
const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
// «el largo», «el color», «la talla»
const elLa = (v) => (/^talla|^medida/i.test(v) ? 'la' : 'el');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('is-on'), 2400);
}

// Destellos tipo diamante al agregar a la bolsa
function sparkle(el) {
  if (!motion || !el) return;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  for (let i = 0; i < 10; i++) {
    const s = document.createElement('span');
    const a = (Math.PI * 2 * i) / 10 + Math.random() * .4;
    const d = 40 + Math.random() * 50;
    s.className = 'spark';
    s.style.left = x + 'px';
    s.style.top = y + 'px';
    s.style.setProperty('--dx', Math.cos(a) * d + 'px');
    s.style.setProperty('--dy', Math.sin(a) * d + 'px');
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 900);
  }
}

// En la ficha, fotos con una proporción muy distinta del marco (flyers, fotos cuadradas) se muestran
// completas, sin recortar, sobre un fondo difuminado de la misma imagen
function fitImage(img) {
  const box = img.closest('.pm__frame');
  if (!box || !img.naturalWidth) return;
  const r = img.naturalHeight / img.naturalWidth;
  const fit = r > 1.9 || r < 1.05;
  box.classList.toggle('is-fit', fit);
  if (fit) box.style.setProperty('--fit-bg', `url("${img.currentSrc || img.src}")`);
}
$('#pmImg').addEventListener('load', (e) => fitImage(e.target));

function lockScroll() {
  const open = ['#productModal', '#bag', '#promoModal'].some((s) => { const el = $(s); return el && el.classList.contains('is-open'); });
  document.body.style.overflow = open ? 'hidden' : '';
}

// ===== CATÁLOGO =====
const grid = $('#productGrid');
const filters = $('#filters');
let currentCat = 'todos';

function renderFilters(active) {
  const count = (k) => (k === 'todos' ? PRODUCTS.length : PRODUCTS.filter((p) => p.tags.includes(k)).length);
  filters.innerHTML = FILTERS
    .filter(([k]) => count(k) > 0) // oculta categorías vacías
    .map(([k, label]) => `<button class="tab ${k === active ? 'is-active' : ''}" role="tab" aria-selected="${k === active}" data-cat="${esc(k)}">${esc(label)}<span class="tab__n">${count(k)}</span></button>`)
    .join('');
}

// Resumen bajo el nombre: las variantes («Largo: 45 cm a 60 cm») o lo que incluye
const resumen = (p) => (p.sizes.length
  ? `${p.varName}: ${p.sizes.length > 2 ? `${p.sizes[0]} a ${p.sizes[p.sizes.length - 1]}` : p.sizes.join(' o ')}`
  : p.incluye.join(' + '));
const botonTexto = (p) => (p.sizes.length > 1 ? `Elegir ${p.varName.toLowerCase()}` : 'Agregar');

// Misma tarjeta que escribe scripts/build.mjs en el HTML (para Google)
const card = (p, i) => `
    <article class="card${p.agotado ? ' is-soldout' : ''}" style="--i:${i}">
      <button class="card__bag" type="button" data-view="${esc(p.id)}" aria-label="Ver ${esc(p.name)}">
        <span class="card__zip" aria-hidden="true"></span>
        ${p.agotado ? '<span class="badge badge--soldout">Agotado</span>' : p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ''}
        <span class="card__photo">
          <img src="${esc(p.thumb)}" alt="${esc(p.name)}" loading="lazy" decoding="async">
          ${p.thumbs[1] ? `<img class="alt" src="${esc(p.thumbs[1])}" alt="" loading="lazy" decoding="async">` : ''}
        </span>
      </button>
      <div class="card__plate">
        <h3>${esc(p.name)}</h3>
        ${resumen(p) ? `<p class="card__meta">${esc(resumen(p))}</p>` : ''}
        <div class="card__foot">
          <span class="price${p.price > 0 ? '' : ' price--ask'}">${priceText(p)}</span>
          ${p.agotado
            ? `<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="${esc(waUrl(`Hola! ¿Les queda stock de ${p.name}? 💎`))}">Consultar stock</a>`
            : `<button class="btn btn--chrome btn--sm" type="button" data-view="${esc(p.id)}">${esc(botonTexto(p))}</button>`}
        </div>
      </div>
    </article>`;

function renderProducts(cat = currentCat) {
  currentCat = cat;
  let list = cat === 'todos' ? PRODUCTS : PRODUCTS.filter((p) => p.tags.includes(cat));
  const sortKey = $('#sort').value;
  const sort = SORTS[sortKey];
  if (sort) list = [...list].sort(sort);
  $('#count').innerHTML = `Mostrando <strong>${list.length}</strong> ${list.length === 1 ? 'pieza' : 'piezas'}`;
  // la pieza más nueva va en grande solo en «Todas» y con el orden destacado
  grid.classList.toggle('is-featured', cat === 'todos' && !sort && list.length >= 5);
  grid.innerHTML = list.map(card).join('');
}

filters.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cat]');
  if (!btn) return;
  renderFilters(btn.dataset.cat);
  renderProducts(btn.dataset.cat);
});
$('#sort').addEventListener('change', () => renderProducts());

// ===== FICHA DE PRODUCTO =====
const pModal = $('#productModal');
let current = null;
let photo = 0;
let pick = { size: '', qty: 1 };
let lastFocus = null;

function showPhoto(i) {
  const g = current.gallery;
  photo = (i + g.length) % g.length;
  $('#pmImg').src = g[photo];
  $('#pmThumbs').querySelectorAll('button').forEach((b, k) => b.classList.toggle('is-active', k === photo));
}

function renderSizes() {
  $('#pmSizes').innerHTML = current.sizes
    .map((t) => `<button type="button" role="radio" aria-checked="${t === pick.size}" data-size="${esc(t)}">${esc(t)}</button>`)
    .join('');
}

function openProduct(id) {
  const p = findProduct(id);
  if (!p) return;
  lastFocus = document.activeElement;
  current = p;
  pick = { size: p.sizes.length === 1 ? p.sizes[0] : '', qty: 1 };

  $('#pmImg').alt = p.name;
  $('#pmThumbs').innerHTML = p.gallery.length > 1
    ? p.thumbs.map((src, i) => `<button type="button" data-photo="${i}" aria-label="Foto ${i + 1}"><img src="${esc(src)}" alt="" loading="lazy"></button>`).join('')
    : '';
  pModal.classList.toggle('has-gallery', p.gallery.length > 1);
  showPhoto(0);
  $('#pmCat').textContent = FILTERS.filter(([k]) => p.tags.includes(k)).map(([, l]) => l).join(' · ') || 'Joyas JR';
  $('#pmName').textContent = p.name;
  $('#pmPrice').textContent = priceText(p);
  $('#pmDesc').textContent = p.desc;
  $('#pmIncl').innerHTML = p.incluye.map((i) => `<li>${esc(i)}</li>`).join('');
  $('#pmSizesWrap').hidden = !p.sizes.length;
  $('#pmVarLabel').textContent = p.varName ? `${p.varName}` : 'Elige';
  $('#pmSizes').setAttribute('aria-label', p.varName || 'Opciones');
  $('#pmSizeHint').textContent = p.sizes.length === 1 ? '· único disponible' : '';
  renderSizes();
  $('#pmQty').textContent = '1';
  $('#pmError').hidden = true;
  $('#pmAdd').hidden = p.agotado;
  document.querySelector('.pm__qty').hidden = p.agotado;
  $('#pmAsk').href = waUrl(`Hola! Quiero consultar por ${p.name} 💎`);

  pModal.classList.add('is-open');
  pModal.setAttribute('aria-hidden', 'false');
  lockScroll();
  $('#pmAdd').hidden ? $('#pmAsk').focus() : pModal.querySelector('.modal__close').focus();
}

function closeProduct() {
  if (!pModal.classList.contains('is-open')) return;
  pModal.classList.remove('is-open');
  pModal.setAttribute('aria-hidden', 'true');
  lockScroll();
  if (lastFocus && !bagEl.classList.contains('is-open')) lastFocus.focus();
}

pModal.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-close]')) { closeProduct(); return; }
  const thumb = t.closest('[data-photo]');
  if (thumb) showPhoto(Number(thumb.dataset.photo));
  const step = t.closest('[data-step-photo]');
  if (step) showPhoto(photo + Number(step.dataset.stepPhoto));
  const size = t.closest('[data-size]');
  if (size) {
    pick.size = size.dataset.size;
    $('#pmError').hidden = true;
    renderSizes();
  }
  const q = t.closest('[data-qty]');
  if (q) {
    pick.qty = Math.min(MAX_QTY, Math.max(1, pick.qty + Number(q.dataset.qty)));
    $('#pmQty').textContent = pick.qty;
  }
});

// Deslizar la foto con el dedo en el celular
let touchX = null;
$('#pmImg').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
$('#pmImg').addEventListener('touchend', (e) => {
  if (touchX === null || current.gallery.length < 2) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 40) showPhoto(photo + (dx < 0 ? 1 : -1));
  touchX = null;
});

$('#pmAdd').addEventListener('click', () => {
  if (current.sizes.length && !pick.size) {
    const v = current.varName.toLowerCase();
    $('#pmError').textContent = `Elige ${elLa(v)} ${v} para agregarlo a tu bolsa.`;
    $('#pmError').hidden = false;
    return;
  }
  sparkle($('#pmAdd'));
  addToBag(current.id, pick.size, pick.qty);
  closeProduct();
  toast(`${current.name}${pick.size ? ` · ${pick.size}` : ''} va a tu bolsa 💎`);
});

// ===== BOLSA =====
// Se guarda en este navegador para no perderla al recargar la página
const bagEl = $('#bag');
const BAG_KEY = 'jrBag';
let BAG = [];
try { BAG = JSON.parse(localStorage.getItem(BAG_KEY) || '[]'); } catch (e) { BAG = []; }
if (!Array.isArray(BAG)) BAG = [];

function saveBag() {
  try { localStorage.setItem(BAG_KEY, JSON.stringify(BAG)); } catch (e) {}
}

function addToBag(id, size, qty) {
  const line = BAG.find((l) => l.id === id && l.size === size);
  if (line) line.qty = Math.min(MAX_QTY, line.qty + qty);
  else BAG.push({ id, size, qty });
  saveBag();
  renderBag(true);
}

// Productos borrados o agotados desde el panel se descartan solos. Si una variante dejó de existir, se marca.
const bagLines = () => BAG
  .map((l) => ({ ...l, p: findProduct(l.id) }))
  .filter((l) => l.p && !l.p.agotado)
  .map((l) => ({ ...l, sinTalla: !!l.size && !l.p.sizes.includes(l.size) }));
const bagTotal = () => bagLines().reduce((s, l) => s + l.p.price * l.qty, 0);
const aCotizar = () => bagLines().some((l) => !l.p.price);

// ===== CÓDIGOS DE DESCUENTO =====
// Se crean en /admin → Códigos de descuento. El catálogo trae solo su huella SHA-256 (no el código en texto):
// aquí se calcula la huella de lo que escribe el cliente y se compara. CUPON_SAL debe coincidir con scripts/build.mjs.
const CUPON_SAL = 'joyas-jr:';
const CUPON_KEY = 'jrCupon';
let CUPON = null; // { codigo, c } del código aplicado
const normCodigo = (c) => String(c || '').toUpperCase().replace(/\s+/g, '');
const hoyChile = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const fechaCL = (iso) => iso.split('-').reverse().join('-');

async function huella(codigo) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(CUPON_SAL + normCodigo(codigo)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const cuponTexto = (c) => (c.tipo === 'monto' ? `${clp(c.valor)} de descuento` : `${c.valor}% de descuento`);
const aplicaA = (c, id) => !c.productos || c.productos.includes(id);

// Descuento del código aplicado sobre la bolsa actual
function descuento() {
  if (!CUPON) return null;
  const c = CUPON.c;
  const base = bagLines().filter((l) => l.p.price && aplicaA(c, l.id)).reduce((s, l) => s + l.p.price * l.qty, 0);
  if (!base) return { c, monto: 0, motivo: 'no-aplica' };
  if (c.minimo && base < c.minimo) return { c, monto: 0, motivo: 'minimo', falta: c.minimo - base };
  const monto = c.tipo === 'monto' ? Math.min(c.valor, base) : Math.round((base * c.valor) / 100);
  return { c, monto, base };
}
const totalFinal = () => bagTotal() - ((descuento() || {}).monto || 0);

async function aplicarCupon(codigo, silencioso) {
  const code = normCodigo(codigo);
  if (!code) return;
  let c = null;
  try {
    const h = await huella(code);
    c = CUPONES.find((x) => x.h === h && !(x.vence && x.vence < hoyChile())) || null;
  } catch (e) {
    console.error(e); // crypto.subtle solo existe en https o localhost
  }
  CUPON = c ? { codigo: code, c } : null;
  try { c ? localStorage.setItem(CUPON_KEY, code) : localStorage.removeItem(CUPON_KEY); } catch (e) {}
  if (!c && !silencioso) {
    const st = $('#cuponStatus');
    st.hidden = false;
    st.className = 'coupon__status is-bad';
    st.innerHTML = '<strong>Código no válido</strong><small>No existe o ya no está vigente. Revisa que esté bien escrito.</small>';
    return;
  }
  if (c && !silencioso) $('#fCupon').value = '';
  renderBag();
}

function quitarCupon() {
  CUPON = null;
  try { localStorage.removeItem(CUPON_KEY); } catch (e) {}
  $('#cuponStatus').hidden = true;
  renderBag();
}

function renderCupon() {
  const st = $('#cuponStatus');
  const d = descuento();
  $('#cuponForm').hidden = !!CUPON;
  if (!d) { if (!st.classList.contains('is-bad')) st.hidden = true; return; }
  const c = d.c;
  const detalle = [cuponTexto(c), c.aplica !== 'Toda la tienda' ? `en ${c.aplica}` : 'en toda la tienda', c.minimo ? `compra mínima ${clp(c.minimo)}` : '', c.vence ? `válido hasta el ${fechaCL(c.vence)}` : '']
    .filter(Boolean).join(' · ');
  const aviso = d.motivo === 'no-aplica'
    ? '<em>Este código no aplica a las piezas de tu bolsa.</em>'
    : d.motivo === 'minimo' ? `<em>Te faltan ${clp(d.falta)} en piezas de esta promo para usarlo.</em>` : '';
  st.hidden = false;
  st.className = `coupon__status ${d.monto ? 'is-ok' : 'is-warn'}`;
  st.innerHTML = `
    <span class="coupon__badge"><svg class="ic"><use href="#i-check"/></svg>Código válido</span>
    <strong>${esc(CUPON.codigo)} · ${esc(c.titulo)}</strong>
    <small>${esc(detalle)}</small>
    ${aviso}
    <button type="button" class="coupon__rm" data-quitar-cupon>Quitar código</button>`;
}

function renderBag(bump) {
  const lines = bagLines();
  const units = lines.reduce((s, l) => s + l.qty, 0);
  const n = $('#bagCount');
  n.hidden = !units;
  n.textContent = units;
  if (bump) { n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump'); }
  const fab = $('.fab');
  fab.hidden = !units;
  $('#fabLabel').textContent = `Mi bolsa (${units}) · ${clp(totalFinal())}`;

  $('#bagList').innerHTML = lines.map((l, i) => `
    <li class="bag-item">
      <img src="${esc(l.p.thumb || l.p.img)}" alt="">
      <div class="bag-item__main">
        <h4>${esc(l.p.name)}</h4>
        <small>${l.size ? `${esc(l.p.varName)} ${esc(l.size)}${l.sinTalla ? ' <em>(ya no disponible)</em>' : ''} · ` : ''}${l.p.price ? clp(l.p.price) : 'A cotizar'}</small>
        ${CUPON && l.p.price && aplicaA(CUPON.c, l.id) ? `<span class="tag-off">Código ${esc(CUPON.codigo)}</span>` : ''}
        <div class="qty">
          <button type="button" data-line="${i}" data-step="-1" aria-label="Menos">−</button>
          <span>${l.qty}</span>
          <button type="button" data-line="${i}" data-step="1" aria-label="Más">+</button>
        </div>
      </div>
      <div class="bag-item__side">
        <strong>${l.p.price ? clp(l.p.price * l.qty) : '—'}</strong>
        <button type="button" class="bag-item__rm" data-remove="${i}" aria-label="Quitar ${esc(l.p.name)}"><svg class="ic"><use href="#i-trash"/></svg></button>
      </div>
    </li>`).join('');
  $('#bagEmpty').hidden = !!lines.length;
  $('#couponBox').hidden = !lines.length || !CUPONES.length;
  renderCupon();
  $('#bagTitle').textContent = lines.length ? `Tu pedido (${units})` : 'Tu pedido';
  updateOrder();
}

$('#bagList').addEventListener('click', (e) => {
  const lines = bagLines();
  const step = e.target.closest('[data-step]');
  const rm = e.target.closest('[data-remove]');
  const line = step ? lines[step.dataset.line] : rm ? lines[rm.dataset.remove] : null;
  if (!line) return;
  const idx = BAG.findIndex((l) => l.id === line.id && l.size === line.size);
  if (rm || BAG[idx].qty + Number(step.dataset.step) < 1) BAG.splice(idx, 1);
  else BAG[idx].qty = Math.min(MAX_QTY, BAG[idx].qty + Number(step.dataset.step));
  saveBag();
  renderBag();
});

function openBag(encargo) {
  closeProduct();
  renderBag();
  if (encargo) $('#encargoBox').open = true;
  bagEl.classList.add('is-open');
  bagEl.setAttribute('aria-hidden', 'false');
  lockScroll();
  (encargo ? $('#fEncargo') : bagEl.querySelector('.modal__close')).focus();
}
function closeBag() {
  bagEl.classList.remove('is-open');
  bagEl.setAttribute('aria-hidden', 'true');
  lockScroll();
}

// ===== PEDIDO =====
const form = $('#orderForm');
const fRegion = $('#fRegion');
const fComuna = $('#fComuna');
const radio = (name) => (form.querySelector(`input[name="${name}"]:checked`) || {}).value || '';

// Tipos de entrega: una opción por zona de entrega en mano, retiro y envío a todo Chile
const ENTREGAS = {
  ...Object.fromEntries(ZONAS.map((z, i) => [`zona${i}`, `Entrega en mano en ${z}`])),
  retiro: 'Retiro (lo coordinamos por WhatsApp)',
  envio: 'Envío',
};
$('#fEntrega').innerHTML = [
  ...ZONAS.map((z, i) => [`zona${i}`, 'i-pin', z]),
  ['retiro', 'i-store', 'Retiro'],
  ['envio', 'i-truck', 'Envío a Chile'],
].map(([v, ic, label], i) => `<label><input type="radio" name="entrega" value="${v}"${i ? '' : ' checked'}><span><svg class="ic"><use href="#${ic}"/></svg>${esc(label)}</span></label>`).join('');

// Empresas de envío (las elige el dueño en /admin → Ajustes)
$('#fCourier').innerHTML = EMPRESAS
  .map((e, i) => `<label><input type="radio" name="courier" value="${esc(e)}"${i ? '' : ' checked'}><span>${esc(e)}</span></label>`)
  .join('');
$('#fCourier').style.setProperty('--n', Math.max(1, EMPRESAS.length));

function fillRegiones() {
  fRegion.innerHTML = '<option value="">Elige tu región</option>' +
    REGIONES.map((r, i) => `<option value="${i}">${esc(r.region)}</option>`).join('');
}
fRegion.addEventListener('change', () => {
  const r = REGIONES[fRegion.value];
  fComuna.disabled = !r;
  fComuna.innerHTML = r
    ? '<option value="">Elige tu comuna</option>' + r.comunas.map((c) => `<option>${esc(c)}</option>`).join('')
    : '<option value="">Primero la región</option>';
});

function readOrder() {
  const envio = radio('entrega') === 'envio';
  const r = REGIONES[fRegion.value];
  return {
    entrega: radio('entrega'),
    envio,
    nombre: $('#fNombre').value.trim(),
    sector: $('#fSector').value.trim(),
    region: r ? r.region : '',
    comuna: fComuna.value,
    courier: radio('courier'),
    modo: radio('modo'),
    sucursal: $('#fSucursal').value.trim(),
    direccion: $('#fDireccion').value.trim(),
    pago: radio('pago'),
    nota: $('#fNota').value.trim(),
    encargo: $('#fEncargo').value.trim(),
  };
}

// Código corto para identificar el pedido en el chat (ej: JR-4K7Q)
const orderCode = () => 'JR-' + Date.now().toString(36).slice(-4).toUpperCase();
let CODE = orderCode();

// *texto* = negrita y _texto_ = cursiva en WhatsApp
function buildMessage(o) {
  const lines = bagLines();
  const d = descuento();
  const L = [`💎 *PEDIDO ${TIENDA.nombre.toUpperCase()} · ${CODE}* 💎`, '━━━━━━━━━━━━━━━'];
  if (lines.length) {
    L.push('👑 *Piezas*');
    lines.forEach((l, i) => {
      const detalle = [l.size && `${l.p.varName} ${l.size}`, `x${l.qty}`].filter(Boolean).join(' · ');
      const off = d && d.monto && l.p.price && aplicaA(d.c, l.id) ? ' 🏷️' : '';
      L.push(`${i + 1}. *${l.p.name}* · ${detalle} — ${l.p.price ? clp(l.p.price * l.qty) : '_a cotizar_'}${off}`);
    });
  }
  if (o.encargo) L.push(`📝 *Encargo:* _${o.encargo}_`);
  L.push('━━━━━━━━━━━━━━━');
  L.push(`🙋 *Nombre:* ${o.nombre || '_(por completar)_'}`);
  if (o.envio) {
    L.push(`🚚 *Entrega:* Envío por ${o.courier || '_(por definir)_'} · ${o.modo === 'domicilio' ? 'a domicilio' : 'retiro en sucursal'}`);
    L.push(`📍 *Destino:* ${o.comuna ? `${o.comuna}, ${o.region}` : '_(por completar)_'}`);
    if (o.modo === 'domicilio') L.push(`🏠 *Dirección:* ${o.direccion || '_(por completar)_'}`);
    else L.push(`🏢 *Sucursal:* ${o.sucursal || '_(por completar)_'}`);
  } else {
    L.push(`🤝 *Entrega:* ${ENTREGAS[o.entrega] || ENTREGAS.retiro}`);
    if (o.sector && o.entrega !== 'retiro') L.push(`📍 *Punto:* ${o.sector}`);
  }
  L.push(PAGOS[o.pago] || PAGOS.transferencia);
  if (o.nota) L.push(`💬 *Comentario:* _${o.nota}_`);
  L.push('━━━━━━━━━━━━━━━');
  if (lines.length) {
    if (d && d.monto) {
      L.push(`🧾 *Subtotal:* ${clp(bagTotal())}`);
      L.push(`🎟️ *Código ${CUPON.codigo}* _(${d.c.titulo} · ${d.c.tipo === 'monto' ? clp(d.c.valor) : d.c.valor + '%'})_: −${clp(d.monto)}`);
    }
    L.push(`💰 *TOTAL: ${clp(totalFinal())}*`);
    const extras = [aCotizar() && 'piezas a cotizar', o.envio && 'envío a coordinar'].filter(Boolean);
    if (extras.length) L.push(`_(+ ${extras.join(' y ')})_`);
    L.push('');
    L.push('¡Hola! Quiero confirmar stock de este pedido ✨');
  } else {
    L.push('¡Hola! Quiero cotizar este encargo ✨');
  }
  return L.join('\n');
}

// Vista previa con el formato de WhatsApp
const formatPreview = (text) => esc(text)
  .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
  .replace(/(^|\s|\(|—\s)_([^_\n]+)_/g, '$1<em>$2</em>');

function updateOrder() {
  const o = readOrder();
  const lines = bagLines();
  document.querySelectorAll('[data-envio]').forEach((el) => { el.hidden = !o.envio; });
  document.querySelectorAll('[data-local]').forEach((el) => { el.hidden = o.envio; });
  document.querySelectorAll('[data-sector]').forEach((el) => { el.hidden = o.envio || o.entrega === 'retiro'; });
  document.querySelectorAll('[data-modo]').forEach((el) => { el.hidden = el.dataset.modo !== o.modo; });
  // efectivo solo se puede en entregas en mano
  if (o.envio && o.pago === 'efectivo') form.querySelector('input[name="pago"][value="transferencia"]').checked = true;

  const loc = $('#fLocator');
  loc.hidden = o.modo !== 'sucursal' || !COURIERS[o.courier];
  if (COURIERS[o.courier]) {
    loc.href = COURIERS[o.courier];
    loc.innerHTML = `<svg class="ic"><use href="#i-ext"/></svg> Ver sucursales de ${esc(o.courier)}${o.comuna ? ` en ${esc(o.comuna)}` : ''}`;
  }

  $('#bagTotal').textContent = lines.length ? clp(totalFinal()) : '—';
  const d = descuento();
  $('#bagSums').hidden = !(d && d.monto);
  if (d && d.monto) {
    $('#bagSums').innerHTML = `<span>Subtotal</span><span>${clp(bagTotal())}</span><span>Código ${esc(CUPON.codigo)}</span><span class="off">−${clp(d.monto)}</span>`;
  }
  $('#bagTotalLabel').textContent = aCotizar() ? 'Total (sin piezas a cotizar)' : 'Total';
  $('#bagHint').textContent = o.envio
    ? 'El costo del envío se cotiza por WhatsApp según tu comuna y la empresa que elijas.'
    : o.entrega === 'retiro'
      ? 'Coordinamos contigo por WhatsApp el lugar y horario del retiro.'
      : 'Coordinamos contigo por WhatsApp el punto y la hora de la entrega.';
  $('#msgPreview').innerHTML = formatPreview(buildMessage(readOrder()));
}

form.addEventListener('input', updateOrder);
form.addEventListener('change', updateOrder);

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const o = readOrder();
  const missing = [];
  if (!bagLines().length && !o.encargo) missing.push('agrega una pieza o escribe tu encargo');
  if (!o.nombre) missing.push('tu nombre');
  if (o.envio) {
    if (!o.comuna) missing.push('región y comuna');
    if (!o.courier) missing.push('la empresa de envío');
    if (o.modo === 'domicilio' && !o.direccion) missing.push('la dirección');
    if (o.modo === 'sucursal' && !o.sucursal) missing.push('la sucursal donde retiras');
  }
  const err = $('#formError');
  if (missing.length) {
    err.textContent = 'Falta: ' + missing.join(', ') + '.';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  window.open(waUrl(buildMessage(o)), '_blank', 'noopener');
  CODE = orderCode(); // el próximo pedido lleva otro código
  updateOrder();
});

$('#cuponBtn').addEventListener('click', () => aplicarCupon($('#fCupon').value));
$('#fCupon').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); aplicarCupon($('#fCupon').value); } });
$('#fCupon').addEventListener('input', () => { const st = $('#cuponStatus'); if (st.classList.contains('is-bad')) st.hidden = true; });
$('#couponBox').addEventListener('click', (e) => { if (e.target.closest('[data-quitar-cupon]')) quitarCupon(); });

// ===== EVENTOS GENERALES =====
document.addEventListener('click', (e) => {
  const view = e.target.closest('[data-view]');
  if (view) { openProduct(view.dataset.view); return; }
  if (e.target.closest('[data-encargo]')) { openBag(true); return; }
  if (e.target.closest('[data-open-bag]')) { openBag(); return; }
  if (e.target.closest('[data-close-bag]')) closeBag();
});
document.addEventListener('keydown', (e) => {
  if (pModal.classList.contains('is-open') && current && current.gallery.length > 1) {
    if (e.key === 'ArrowLeft') showPhoto(photo - 1);
    if (e.key === 'ArrowRight') showPhoto(photo + 1);
  }
  if (e.key !== 'Escape') return;
  if (pModal.classList.contains('is-open')) closeProduct();
  else closeBag();
});

// ===== FLYER EN VENTANA EMERGENTE (una vez por visita) =====
const promo = $('#promoModal');
if (promo) {
  const key = 'flyer-visto:' + promo.dataset.flyer; // un flyer nuevo se vuelve a mostrar
  const seen = () => { try { return sessionStorage.getItem(key); } catch { return null; } };
  const closePromo = () => {
    promo.classList.remove('is-open');
    promo.setAttribute('aria-hidden', 'true');
    lockScroll();
  };
  promo.addEventListener('click', (e) => { if (e.target.closest('[data-promo-close]')) closePromo(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && promo.classList.contains('is-open')) closePromo(); });
  if (!seen()) {
    setTimeout(() => {
      if (pModal.classList.contains('is-open') || bagEl.classList.contains('is-open')) return; // no interrumpir una compra en curso
      try { sessionStorage.setItem(key, '1'); } catch {}
      promo.classList.add('is-open');
      promo.setAttribute('aria-hidden', 'false');
      lockScroll();
      promo.querySelector('.modal__close').focus();
    }, 2500);
  }
}

// ===== VIDEOS DE «SE FUERON»: se descargan al acercarse y solo se reproducen en pantalla =====
const reelVideos = document.querySelectorAll('.sold video');
const loadVideo = (v) => { if (v.dataset.src) { v.src = v.dataset.src; delete v.dataset.src; } };
if (reelVideos.length && 'IntersectionObserver' in window) {
  const near = new IntersectionObserver((entries) => entries.forEach(({ target, isIntersecting }) => {
    if (isIntersecting) { loadVideo(target); near.unobserve(target); }
  }), { rootMargin: '600px 0px' });
  const io = new IntersectionObserver((entries) => entries.forEach(({ target, isIntersecting }) => {
    if (isIntersecting) { loadVideo(target); target.play().catch(() => {}); } else target.pause();
  }), { threshold: 0.25 });
  reelVideos.forEach((v) => { near.observe(v); io.observe(v); });
} else {
  reelVideos.forEach((v) => { loadVideo(v); v.autoplay = true; v.play().catch(() => {}); });
}

// ===== ANIMACIONES =====
// Título de la portada por líneas
requestAnimationFrame(() => document.querySelector('.vault').classList.add('is-ready'));

// Aparición al hacer scroll (secciones, grilla del catálogo y sellos «Se fue»)
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => entries.forEach(({ target, isIntersecting }) => {
    if (!isIntersecting) return;
    target.classList.add('is-in');
    io.unobserve(target);
  }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  document.querySelectorAll('.reveal').forEach((el, i, all) => {
    // escalonado dentro de cada grupo (pasos, beneficios)
    const hermanos = [...el.parentElement.children].filter((c) => c.classList.contains('reveal'));
    el.style.setProperty('--i', hermanos.indexOf(el));
    io.observe(el);
  });
  [grid, document.querySelector('.gone__wall')].forEach((el) => el && io.observe(el));
} else {
  document.querySelectorAll('.reveal, .grid, .gone__wall').forEach((el) => el.classList.add('is-in'));
}

// Vitrina de la portada: las 3 fotos se turnan
(() => {
  const slides = [...document.querySelectorAll('.case__slide')];
  const dots = [...document.querySelectorAll('.case__dots button')];
  if (slides.length < 2) return;
  let i = 0;
  let timer = null;
  const go = (n) => {
    i = (n + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle('is-on', k === i));
    dots.forEach((d, k) => d.setAttribute('aria-selected', String(k === i)));
    const img = slides[i].querySelector('img');
    if (img.loading === 'lazy') img.loading = 'eager';
  };
  const play = () => { clearInterval(timer); if (motion) timer = setInterval(() => go(i + 1), 4800); };
  dots.forEach((d) => d.addEventListener('click', () => { go(Number(d.dataset.slide)); play(); }));
  document.addEventListener('visibilitychange', () => (document.hidden ? clearInterval(timer) : play()));
  play();
})();

// Contador de seguidores (el HTML ya trae el número final)
document.querySelectorAll('[data-count]').forEach((el) => {
  const fin = parseInt(String(el.dataset.count).replace(/\D/g, ''), 10);
  if (!motion || !fin) return;
  const t0 = performance.now() + 500;
  const tick = (t) => {
    const k = Math.min(1, Math.max(0, (t - t0) / 1400));
    el.textContent = Math.round(fin * (1 - Math.pow(1 - k, 3))).toLocaleString('es-CL');
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

// Cabecera de vidrio al bajar + parallax suave del monograma JR
(() => {
  const top = $('#top');
  const mono = document.querySelector('.vault__mono');
  let pend = false;
  const onScroll = () => {
    if (pend) return;
    pend = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      top.classList.toggle('is-scrolled', y > 20);
      if (motion && mono && y < 1200) mono.style.setProperty('--par', `${y * 0.18}px`);
      pend = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

// Solo con mouse: tarjetas que se inclinan y botón principal magnético
if (motion && finePointer) {
  grid.addEventListener('pointermove', (e) => {
    const c = e.target.closest('.card');
    if (!c) return;
    const r = c.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    c.style.setProperty('--ry', `${x * 7}deg`);
    c.style.setProperty('--rx', `${-y * 7}deg`);
  });
  grid.addEventListener('pointerout', (e) => {
    const c = e.target.closest('.card');
    if (c && !c.contains(e.relatedTarget)) { c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg'); }
  });
  document.querySelectorAll('.magnet').forEach((b) => {
    b.addEventListener('pointermove', (e) => {
      const r = b.getBoundingClientRect();
      b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.18}px, ${(e.clientY - r.top - r.height / 2) * 0.3}px)`;
    });
    b.addEventListener('pointerleave', () => { b.style.transform = ''; });
  });
}

// ===== CARGA DEL CATÁLOGO =====
async function loadProducts() {
  fetch('data/regiones.json')
    .then((r) => r.json())
    .then((d) => { REGIONES = Array.isArray(d.regiones) ? d.regiones : []; fillRegiones(); })
    .catch((e) => console.error(e));
  try {
    const res = await fetch('data/catalogo.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const categorias = Array.isArray(data.categorias) ? data.categorias : [];

    // producto -> categorías a las que pertenece (la categoría es la que dice qué productos tiene)
    const tagsOf = {};
    categorias.forEach((c) => (c.productos || []).forEach((id) => (tagsOf[id] = tagsOf[id] || []).push(c.id)));

    const path = (s) => String(s).replace(/^\//, '');
    FILTERS = [['todos', 'Todas'], ...categorias.map((c) => [c.id, c.nombre])];
    CUPONES = Array.isArray(data.cupones) ? data.cupones : [];
    PRODUCTS = (data.productos || []).map((p) => {
      const img = path(p.foto || 'img/logo.jpg');
      const fotos = Array.isArray(p.fotos) ? p.fotos.map(path) : [];
      // versiones livianas que genera el build (si faltan, se usan las originales)
      const minis = Array.isArray(p.minis) && p.minis.length === fotos.length ? p.minis.map(path) : fotos;
      const thumb = p.mini ? path(p.mini) : img;
      return {
        id: p.id,
        name: p.nombre,
        price: Number(p.precio) || 0,
        img,
        gallery: [img, ...fotos],
        thumb,
        thumbs: [thumb, ...minis],
        desc: p.descripcion || '',
        incluye: Array.isArray(p.incluye) ? p.incluye : [],
        varName: p.variante || '',
        sizes: Array.isArray(p.variantes) ? p.variantes.map(String) : [],
        tags: tagsOf[p.id] || [],
        badge: p.etiqueta || '',
        agotado: !!p.agotado,
      };
    });
  } catch (e) {
    console.error(e);
    return; // conserva el HTML que ya escribió el build
  }
  // sin precios cargados, ordenar por precio no tiene sentido
  if (!PRODUCTS.some((p) => p.price > 0)) document.querySelector('.sort').hidden = true;
  renderFilters('todos');
  renderProducts('todos');
  renderBag();
  // vuelve a validar el código que quedó guardado (pudo vencer o apagarse en /admin)
  let guardado = '';
  try { guardado = localStorage.getItem(CUPON_KEY) || ''; } catch (e) {}
  if (guardado && CUPONES.length) aplicarCupon(guardado, true);
}

updateOrder();
loadProducts();
