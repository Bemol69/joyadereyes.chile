// Arma la web para publicar. Vercel lo ejecuta en cada cambio (ver vercel.json).
//  1. Lee tienda.config.json (lo define el desarrollador) y data/ajustes.json (lo edita el cliente en /admin)
//     y data/flyer.json, data/franjas.json y data/entregas.json (también desde /admin)
//  2. Junta data/productos/*.json, data/categorias/*.json y data/cupones/*.json en data/catalogo.json
//  3. Copia el sitio a dist/ reemplazando los %%MARCADORES%%, escribe los productos dentro
//     del HTML (para Google) y genera canonical, Open Graph, datos estructurados, robots.txt y sitemap.xml
// Uso local: node scripts/build.mjs  →  servir la carpeta dist/
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = join(ROOT, 'data');
const DIST = join(ROOT, 'dist');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, 'data'), { recursive: true });

// ---------- Fotos livianas ----------
// Las tarjetas, la portada, el flyer y las entregas muestran las fotos en tamaño chico:
// se genera una copia WebP del ancho justo en dist/img/_opt/. El nombre lleva un hash del
// contenido, así el navegador la guarda en caché y una foto reemplazada en /admin se ve al tiro.
// Las originales se mantienen (ficha del producto, Google, redes sociales).
// Si sharp no está instalado, se usan las originales.
let sharp = null;
try { sharp = (await import('sharp')).default; } catch { console.warn('⚠️  sharp no está instalado (npm install): se usan las fotos originales'); }
const OPT = 'img/_opt';
const optimizadas = new Map();
function optimizar(src, ancho) {
  const path = String(src || '').replace(/^\//, '');
  if (!sharp || !/\.(jpe?g|png|webp)$/i.test(path) || !existsSync(join(ROOT, path))) return Promise.resolve(path);
  const key = `${path}@${ancho}`;
  if (!optimizadas.has(key)) {
    optimizadas.set(key, (async () => {
      try {
        const buf = readFileSync(join(ROOT, path));
        const out = `${OPT}/${createHash('sha1').update(buf).digest('hex').slice(0, 12)}-${ancho}.webp`;
        mkdirSync(join(DIST, OPT), { recursive: true });
        await sharp(buf).rotate().resize({ width: ancho, withoutEnlargement: true }).webp({ quality: 78 }).toFile(join(DIST, out));
        return out;
      } catch (e) {
        console.warn(`⚠️  No se pudo optimizar ${path}: ${e.message}`);
        return path;
      }
    })());
  }
  return optimizadas.get(key);
}
const MINI = 640; // ancho de las fotos en las tarjetas del catálogo (≈320 px en pantalla, x2 para pantallas retina)
const config = readJson(join(ROOT, 'tienda.config.json'));
const readData = (file) => {
  if (!existsSync(join(DATA, file))) return {};
  try { return readJson(join(DATA, file)); } catch (e) { console.warn(`⚠️  ${file} está dañado, se usan valores por defecto: ${e.message}`); return {}; }
};
const ajustes = readData('ajustes.json');
const flyer = readData('flyer.json');           // flyer de ofertas (editable en /admin)
const entregasData = readData('entregas.json'); // fotos o videos de «Se fueron» (editable en /admin)
const franjasData = readData('franjas.json');   // frases de las 2 franjas en movimiento (editable en /admin)

// Manda el dominio propio de site_url; si todavía es un .vercel.app, se usa el dominio de producción de Vercel
const propio = config.site_url && !/\.vercel\.app/.test(config.site_url);
const SITE = (!propio && process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : config.site_url || 'http://localhost:5602').replace(/\/$/, '');

// ---------- 1. Datos de la tienda ----------
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const lista = (v, def) => {
  const l = (Array.isArray(v) ? v : []).map(str).filter(Boolean);
  return l.length ? [...new Set(l)] : def;
};
const T = {
  nombre: str(config.nombre),
  marca_a: str(config.marca_a) || str(config.nombre),
  marca_b: str(config.marca_b),
  rubro: str(config.rubro),
  schema_tipo: str(config.schema_tipo) || 'Store',
  whatsapp: str(ajustes.whatsapp).replace(/\D/g, ''),
  instagram: str(ajustes.instagram).replace(/^@/, ''),
  tiktok: str(ajustes.tiktok).replace(/^@/, ''),
  email: str(ajustes.email),
  direccion: str(ajustes.direccion),
  ciudad: str(ajustes.ciudad),
  region: str(ajustes.region),
  envios: str(ajustes.envios) || 'Envíos a todo Chile',
  empresas_envio: lista(ajustes.empresas_envio, ['Starken', 'Chilexpress', 'Blue Express']),
  zonas_entrega: lista(ajustes.zonas_entrega, str(ajustes.ciudad) ? [str(ajustes.ciudad)] : []),
  horario_dias: str(ajustes.horario_dias),
  hora_abre: str(ajustes.hora_abre),
  hora_cierra: str(ajustes.hora_cierra),
  hero_titulo: str(ajustes.hero_titulo),
  hero_destacado: str(ajustes.hero_destacado),
  hero_bajada: str(ajustes.hero_bajada),
  seguidores: str(ajustes.seguidores),
};

// ---------- Flyer de ofertas ----------
const rel = (path) => str(path).replace(/^\//, '');
const F = {
  imagen: flyer.mostrar !== false ? rel(flyer.imagen) : '',
  titulo: str(flyer.titulo) || 'Promo de la semana',
  descripcion: str(flyer.descripcion),
  mensaje: str(flyer.mensaje_whatsapp) || 'Hola! Quiero la promo 💎',
};
F.popup = F.imagen && flyer.popup !== false ? F.imagen : '';

// ---------- «Se fueron»: entregas y envíos reales (3 a 6) ----------
const ENTREGAS_BASE = [
  { archivo: 'img/entregas/envio-concepcion.jpg', titulo: 'Envío a Concepción', texto: 'Despachado por Starken', descripcion: 'Comprobante de envío de un pedido' },
  { archivo: 'img/entregas/entrega-los-andes.jpg', titulo: 'Entrega en Los Andes', texto: 'En mano, en el punto acordado', descripcion: 'Entrega presencial de un pedido' },
  { archivo: 'img/entregas/full-combi.jpg', titulo: 'Full combi se llevó', texto: 'Bolsitas selladas', descripcion: 'Combi de cadenas y pulseras en bolsitas' },
];
const listaEntregas = (Array.isArray(entregasData.entregas) ? entregasData.entregas : []).filter((e) => e && rel(e.archivo));
const entregas = (listaEntregas.length >= 3 ? listaEntregas.slice(0, 6) : ENTREGAS_BASE).map((e) => {
  const archivo = rel(e.archivo);
  return {
    archivo,
    video: /\.(mp4|webm|m4v|mov)$/i.test(archivo),
    titulo: str(e.titulo),
    texto: str(e.texto),
    descripcion: str(e.descripcion) || str(e.titulo) || 'Pedido entregado',
  };
});

// ---------- Franjas de texto en movimiento ----------
const FRANJAS_BASE = {
  franja1: ['Plata nacional ley 925', 'Envíos a todo Chile', 'Por mayor y al detalle', 'Diseños exclusivos'],
  franja2: ['Joyas que brillan como tú', 'Calidad que se ve', 'Confianza que se siente'],
};
const VELOCIDAD = { lenta: 1.6, normal: 1, rapida: 0.6 };
function franja(key) {
  const f = franjasData[key] || {};
  const frases = lista(f.frases, FRANJAS_BASE[key]);
  // la cinta se repite hasta tener ~10 frases por mitad, para que el loop no deje huecos en pantallas anchas
  const vuelta = [];
  while (vuelta.length < 10) vuelta.push(...frases);
  return {
    mostrar: f.mostrar !== false,
    items: vuelta,
    segundos: Math.round(vuelta.length * 5 * (VELOCIDAD[f.velocidad] || 1)),
  };
}
const F1 = franja('franja1');
const F2 = franja('franja2');

const faltan = ['nombre', 'whatsapp', 'ciudad'].filter((k) => !T[k]);
if (faltan.length) throw new Error(`Faltan datos obligatorios: ${faltan.join(', ')} (tienda.config.json / data/ajustes.json)`);
if (!/^\d{10,15}$/.test(T.whatsapp) || (T.whatsapp.startsWith('56') && !/^569\d{8}$/.test(T.whatsapp))) {
  throw new Error(`WhatsApp inválido "${T.whatsapp}": usa formato internacional; en Chile son 11 dígitos, ej 56912345678`);
}

// ---------- 2. Catálogo ----------
function readFolder(folder) {
  const dir = join(DATA, folder);
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const items = [];
  for (const file of files) {
    try {
      items.push({ id: basename(file, '.json'), ...readJson(join(dir, file)) });
    } catch (e) {
      // Un archivo dañado no debe botar todo el catálogo: se omite y se avisa en el log
      console.warn(`⚠️  Se omitió ${folder}/${file}: ${e.message}`);
    }
  }
  return items;
}

const num = (v, def) => (v !== '' && v !== null && Number.isFinite(Number(v)) ? Number(v) : def);
const byOrder = (a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es');
const TIPOS_VARIANTE = ['Largo', 'Color', 'Talla', 'Talla de anillo', 'Medida', 'Modelo'];

const productos = readFolder('productos')
  .filter((p) => p.visible !== false && typeof p.nombre === 'string' && p.nombre.trim())
  .map((p) => {
    // variantes únicas y sin vacíos ("50 cm", "Negro"…); números del CMS se pasan a texto.
    // «tallas» se acepta por compatibilidad con fichas antiguas.
    const variantes = [...new Set((Array.isArray(p.variantes) ? p.variantes : Array.isArray(p.tallas) ? p.tallas : []).map(str).filter(Boolean))];
    const variante = variantes.length ? (TIPOS_VARIANTE.includes(str(p.variante)) ? str(p.variante) : Array.isArray(p.tallas) ? 'Talla' : 'Modelo') : '';
    return {
      id: p.id,
      nombre: p.nombre.trim(),
      precio: Math.max(0, Math.round(num(p.precio, 0))),
      foto: typeof p.foto === 'string' && p.foto ? p.foto.replace(/^\//, '') : 'img/logo.jpg',
      // la demo usa como máximo 1 foto extra por producto; en /admin el cliente puede subir más
      fotos: (Array.isArray(p.fotos) ? p.fotos : []).filter((f) => typeof f === 'string' && f).map((f) => f.replace(/^\//, '')),
      variante,
      variantes,
      descripcion: typeof p.descripcion === 'string' ? p.descripcion.trim() : '',
      incluye: Array.isArray(p.incluye) ? p.incluye.map((i) => String(i).trim()).filter(Boolean) : [],
      etiqueta: typeof p.etiqueta === 'string' ? p.etiqueta.trim() : '',
      agotado: p.agotado === true,
      orden: num(p.orden, 1000),
    };
  })
  .sort(byOrder)
  .map(({ orden, ...p }) => p);

// Versiones chicas para las tarjetas y miniaturas (la ficha del producto usa las originales)
await Promise.all(productos.map(async (p) => {
  p.mini = await optimizar(p.foto, MINI);
  p.minis = await Promise.all(p.fotos.map((f) => optimizar(f, MINI)));
}));

const ids = new Set(productos.map((p) => p.id));

const categorias = readFolder('categorias')
  .filter((c) => c.visible !== false && typeof c.nombre === 'string' && c.nombre.trim())
  .map((c) => ({
    id: c.id,
    nombre: c.nombre.trim(),
    orden: num(c.orden, 1000),
    // se descartan productos borrados u ocultos, y repetidos
    productos: [...new Set(Array.isArray(c.productos) ? c.productos : [])].filter((id) => ids.has(id)),
  }))
  .sort(byOrder)
  .map(({ orden, ...c }) => c);

// ---------- Códigos de descuento (data/cupones, editables en /admin) ----------
// Se publican como huella SHA-256 y no como texto: la web puede comprobar un código que le escriben,
// pero nadie puede sacar la lista de códigos mirando el archivo. La sal debe coincidir con CUPON_SAL en app.js.
const CUPON_SAL = 'joyas-jr:';
const normCodigo = (c) => str(c).toUpperCase().replace(/\s+/g, '');
const huella = (c) => createHash('sha256').update(CUPON_SAL + normCodigo(c)).digest('hex');
const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }); // AAAA-MM-DD
const productosDe = Object.fromEntries(categorias.map((c) => [c.id, c.productos]));
const vistos = new Set();
const cupones = readFolder('cupones')
  .filter((c) => c.activo !== false && normCodigo(c.codigo))
  .map((c) => {
    const tipo = c.tipo === 'monto' ? 'monto' : 'porcentaje';
    const valor = Math.max(0, Math.round(num(c.valor, 0)));
    const vence = /^\d{4}-\d{2}-\d{2}/.test(str(c.vence)) ? str(c.vence).slice(0, 10) : '';
    // sin productos ni categorías elegidos = aplica a toda la tienda
    const cats = Array.isArray(c.categorias) ? c.categorias : [];
    const prods = Array.isArray(c.productos) ? c.productos : [];
    const todos = !cats.length && !prods.length;
    return {
      id: c.id,
      codigo: normCodigo(c.codigo),
      h: huella(c.codigo),
      titulo: str(c.titulo) || normCodigo(c.codigo),
      tipo,
      valor: tipo === 'porcentaje' ? Math.min(100, valor) : valor,
      minimo: Math.max(0, Math.round(num(c.minimo, 0))),
      vence,
      productos: todos ? null : [...new Set([...cats.flatMap((id) => productosDe[id] || []), ...prods])].filter((id) => ids.has(id)),
      aplica: todos ? 'Toda la tienda' : [...categorias.filter((x) => cats.includes(x.id)).map((x) => x.nombre), ...(prods.length ? ['productos seleccionados'] : [])].join(', '),
    };
  })
  .filter((c) => {
    if (!c.valor) return console.warn(`⚠️  Cupón «${c.titulo}» sin valor de descuento: se omitió`), false;
    if (c.vence && c.vence < hoy) return console.warn(`ℹ️  Cupón «${c.titulo}» vencido el ${c.vence}: se omitió`), false;
    if (c.productos && !c.productos.length) return console.warn(`⚠️  Cupón «${c.titulo}» no tiene productos visibles: se omitió`), false;
    if (vistos.has(c.codigo)) return console.warn(`⚠️  Código ${c.codigo} repetido: se usa solo el primero`), false;
    vistos.add(c.codigo);
    return true;
  })
  .map(({ id, codigo, ...c }) => c);

writeFileSync(join(DATA, 'catalogo.json'), JSON.stringify({
  _aviso: 'Archivo generado por scripts/build.mjs. No editar a mano.',
  categorias,
  productos,
  cupones,
}, null, 2) + '\n');
console.log(`✅ catálogo: ${productos.length} productos, ${categorias.length} categorías, ${cupones.length} códigos de descuento activos`);

// ---------- 3. Marcadores %%CLAVE%% ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clp = (n) => '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const abs = (path) => `${SITE}/${String(path).replace(/^\//, '')}`;
const colores = config.colores || {};
const fuentes = config.fuentes || {};
const hero = Array.isArray(config.hero) ? config.hero : [];
const heroFoto = (i) => (hero[i] && hero[i].foto) || (productos[i] && productos[i].foto) || 'img/logo.jpg';
const HERO_OPT = await Promise.all([optimizar(heroFoto(0), 900), optimizar(heroFoto(1), 900), optimizar(heroFoto(2), 900)]);
const FLYER_OPT = F.imagen ? await optimizar(F.imagen, 800) : '';
for (const e of entregas) if (!e.video) e.archivo = await optimizar(e.archivo, 560);
const heroAlt = (i) => (hero[i] && hero[i].alt) || (productos[i] && productos[i].nombre) || T.nombre;
const fuenteParam = (f, pesos) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:${pesos}`;
const FUENTE_TITULOS = fuentes.titulos || 'Bodoni Moda';
const FUENTE_TEXTO = fuentes.texto || 'Manrope';
const FUENTE_MONO = fuentes.mono || 'IBM Plex Mono';

const SEO_TITULO = str(config.seo_titulo) || `${T.nombre} · ${T.rubro} en ${T.ciudad}`;
const SEO_DESCRIPCION = str(config.seo_descripcion) || T.hero_bajada;
const precios = productos.map((p) => p.precio).filter((n) => n > 0);
const waLink = (text) => `https://api.whatsapp.com/send?phone=${T.whatsapp}&text=${encodeURIComponent(text)}`;

// colores del config → %%COLOR_FONDO%%, %%COLOR_HIELO%%…
const COLOR_VARS = Object.fromEntries(Object.entries(colores).map(([k, v]) => [`COLOR_${k.toUpperCase()}`, str(v)]));

const VARS = {
  NOMBRE: T.nombre, MARCA_A: T.marca_a, MARCA_B: T.marca_b, RUBRO: T.rubro,
  SEO_TITULO, SEO_DESCRIPCION,
  CIUDAD: T.ciudad, REGION: T.region, DIRECCION: T.direccion, ENVIOS: T.envios,
  ZONAS: T.zonas_entrega.join(' · '),
  INSTAGRAM: T.instagram, TIKTOK: T.tiktok, EMAIL: T.email,
  HORARIO_DIAS: T.horario_dias, HORA_ABRE: T.hora_abre, HORA_CIERRA: T.hora_cierra,
  HORARIO: T.hora_abre && T.hora_cierra ? `${T.horario_dias ? T.horario_dias + ', ' : ''}${T.hora_abre} a ${T.hora_cierra}` : '',
  HERO_TITULO: T.hero_titulo, HERO_DESTACADO: T.hero_destacado, HERO_BAJADA: T.hero_bajada,
  SEGUIDORES: T.seguidores,
  N_PRODUCTOS: String(productos.length),
  DESDE: precios.length ? clp(Math.min(...precios)) : '',
  HERO_1: HERO_OPT[0], HERO_1_ALT: heroAlt(0), HERO_2: HERO_OPT[1], HERO_2_ALT: heroAlt(1), HERO_3: HERO_OPT[2], HERO_3_ALT: heroAlt(2),
  FUENTES_URL: `https://fonts.googleapis.com/css2?${fuenteParam(FUENTE_TITULOS, 'ital,wght@0,500;0,700;0,800;1,500;1,700')}&${fuenteParam(FUENTE_TEXTO, 'wght@400;500;600;700;800')}&${fuenteParam(FUENTE_MONO, 'wght@400;500;600')}&display=swap`,
  FUENTE_TITULOS, FUENTE_TEXTO, FUENTE_MONO,
  GITHUB_REPO: str(config.github_repo), SITE_URL: `${SITE}/`,
  ...COLOR_VARS,
  FLYER: FLYER_OPT, FLYER_POPUP: F.popup ? FLYER_OPT : '', FLYER_TITULO: F.titulo, FLYER_TEXTO: F.descripcion,
  FLYER_ALT: F.descripcion || F.titulo,
  FLYER_WA: waLink(F.mensaje),
  MAYOR_WA: waLink('Hola! Quiero cotizar joyas por mayor 💎 ¿Me mandan la lista de lotes?'),
  CONSULTA_WA: waLink('Hola! Quiero consultar por una joya 💎'),
  FRANJA2: F2.mostrar ? '1' : '',
  FRANJA1_SEG: String(F1.segundos), FRANJA2_SEG: String(F2.segundos),
  ANIO: String(new Date().getFullYear()),
  // Solo lo que necesita el navegador (app.js)
  TIENDA_JSON: JSON.stringify({
    nombre: T.nombre, whatsapp: T.whatsapp, ciudad: T.ciudad,
    empresas_envio: T.empresas_envio, zonas_entrega: T.zonas_entrega,
  }),
};

// Bloques opcionales: <!-- SI:CLAVE --> ... <!-- /SI:CLAVE --> se eliminan si CLAVE está vacía
function render(text, file, escape) {
  let out = text;
  for (let prev; prev !== out;) { // se repite para resolver bloques anidados
    prev = out;
    out = out.replace(/<!-- SI:([A-Z0-9_]+) -->([\s\S]*?)<!-- \/SI:\1 -->/g, (m, key, body) => (str(VARS[key]) ? body : ''));
  }
  const missing = new Set();
  out = out.replace(/%%([A-Z0-9_]+)%%/g, (m, key) => {
    const v = VARS[key];
    if (v === undefined || v === null || (v === '' && key.startsWith('COLOR_'))) { missing.add(key); return m; }
    return escape && key !== 'TIENDA_JSON' ? esc(v) : String(v);
  });
  if (missing.size) throw new Error(`${file}: faltan valores para ${[...missing].join(', ')}`);
  return out;
}

// ---------- 4. SEO ----------
// Resumen corto bajo el nombre: las variantes («Largo 45–60 cm») o lo que incluye
const resumen = (p) => (p.variantes.length
  ? `${p.variante}: ${p.variantes.length > 2 ? `${p.variantes[0]} a ${p.variantes[p.variantes.length - 1]}` : p.variantes.join(' o ')}`
  : p.incluye.join(' + '));
const botonTexto = (p) => (p.variantes.length > 1 ? `Elegir ${p.variante.toLowerCase()}` : 'Agregar');

const card = (p, i) => `
    <article class="card${p.agotado ? ' is-soldout' : ''}" style="--i:${i}">
      <button class="card__bag" type="button" data-view="${esc(p.id)}" aria-label="Ver ${esc(p.nombre)}">
        <span class="card__zip" aria-hidden="true"></span>
        ${p.agotado ? '<span class="badge badge--soldout">Agotado</span>' : p.etiqueta ? `<span class="badge">${esc(p.etiqueta)}</span>` : ''}
        <span class="card__photo">
          <img src="${esc(p.mini)}" alt="${esc(p.nombre)}" loading="lazy" decoding="async">
          ${p.minis[0] ? `<img class="alt" src="${esc(p.minis[0])}" alt="" loading="lazy" decoding="async">` : ''}
        </span>
      </button>
      <div class="card__plate">
        <h3>${esc(p.nombre)}</h3>
        ${resumen(p) ? `<p class="card__meta">${esc(resumen(p))}</p>` : ''}
        <div class="card__foot">
          <span class="price${p.precio > 0 ? '' : ' price--ask'}">${p.precio > 0 ? clp(p.precio) : 'Consultar'}</span>
          ${p.agotado
            ? `<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="${esc(waLink(`Hola! ¿Les queda stock de ${p.nombre}? 💎`))}">Consultar stock</a>`
            : `<button class="btn btn--chrome btn--sm" type="button" data-view="${esc(p.id)}">${esc(botonTexto(p))}</button>`}
        </div>
      </div>
    </article>`; // misma tarjeta que card() en app.js

const entregaHtml = (e, i) => `
          <figure class="sold" style="--i:${i}">
            <span class="sold__stamp" aria-hidden="true">Se fue ✓</span>
            ${e.video
              ? `<video data-src="${esc(e.archivo)}#t=0.1" muted loop playsinline preload="none" aria-label="${esc(e.descripcion)}"></video>`
              : `<img src="${esc(e.archivo)}" alt="${esc(e.descripcion)}" loading="lazy" decoding="async">`}
            ${e.titulo || e.texto ? `<figcaption>${e.titulo ? `<strong>${esc(e.titulo)}</strong>` : ''}${e.texto ? `<span>${esc(e.texto)}</span>` : ''}</figcaption>` : ''}
          </figure>`;

const OG_IMAGE = abs(heroFoto(0));
const sameAs = [
  T.instagram && `https://www.instagram.com/${T.instagram}/`,
  T.tiktok && `https://www.tiktok.com/@${T.tiktok}`,
].filter(Boolean);

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': T.schema_tipo,
      '@id': `${SITE}/#tienda`,
      name: T.nombre,
      alternateName: 'Joya de Reyes',
      description: SEO_DESCRIPCION,
      url: `${SITE}/`,
      logo: abs('img/logo.jpg'),
      image: [OG_IMAGE, abs('img/logo.jpg')],
      email: T.email || undefined,
      telephone: `+${T.whatsapp}`,
      // zona de entregas presenciales + envíos a todo Chile
      areaServed: [...T.zonas_entrega, 'Chile'].map((name) => ({ '@type': name === 'Chile' ? 'Country' : 'City', name })),
      priceRange: precios.length ? `${clp(Math.min(...precios))} – ${clp(Math.max(...precios))}` : undefined,
      currenciesAccepted: 'CLP',
      address: {
        '@type': 'PostalAddress',
        streetAddress: T.direccion || undefined,
        addressLocality: T.ciudad,
        addressRegion: T.region || undefined,
        addressCountry: 'CL',
      },
      openingHoursSpecification: !(T.hora_abre && T.hora_cierra) ? undefined : [{
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: config.dias_schema || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        opens: T.hora_abre,
        closes: T.hora_cierra,
      }],
      sameAs: sameAs.length ? sameAs : undefined,
    },
    {
      '@type': 'ItemList',
      name: 'Catálogo',
      // Google exige precio en los Product: los "Consultar" quedan fuera de los datos estructurados
      itemListElement: productos.filter((p) => p.precio > 0).map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Product',
          name: p.nombre,
          image: [p.foto, ...p.fotos].map(abs),
          description: p.descripcion || p.incluye.join(', ') || p.nombre,
          brand: { '@type': 'Brand', name: T.nombre },
          offers: {
            '@type': 'Offer',
            url: `${SITE}/#catalogo`,
            price: p.precio,
            priceCurrency: 'CLP',
            availability: `https://schema.org/${p.agotado ? 'OutOfStock' : 'InStock'}`,
            seller: { '@id': `${SITE}/#tienda` },
          },
        },
      })),
    },
  ],
};

const head = `<link rel="canonical" href="${SITE}/">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(T.nombre)}">
  <meta property="og:locale" content="es_CL">
  <meta property="og:url" content="${SITE}/">
  <meta property="og:title" content="${esc(SEO_TITULO)}">
  <meta property="og:description" content="${esc(SEO_DESCRIPCION)}">
  <meta property="og:image" content="${OG_IMAGE}">
  <meta name="twitter:card" content="summary_large_image">${config.google_verificacion
    ? `\n  <meta name="google-site-verification" content="${esc(config.google_verificacion)}">` : ''}
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`;

// ---------- 5. dist/ ----------
let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
for (const marker of ['<!-- SEO:HEAD', '<!-- SEO:PRODUCTOS -->', '<!-- ENTREGAS:LISTA', '<!-- FRANJA1 -->']) {
  if (!html.includes(marker)) throw new Error(`Falta el marcador ${marker} en index.html`);
}
html = render(html, 'index.html', true)
  .replace(/<!-- SEO:HEAD[^>]*-->/, head)
  .replace('<!-- SEO:PRODUCTOS -->', productos.map(card).join(''))
  .replace(/<!-- ENTREGAS:LISTA[^>]*-->/, entregas.map(entregaHtml).join(''))
  // cada franja lleva sus frases 2 veces seguidas: la animación corre la mitad y vuelve a empezar sin salto
  .replace('<!-- FRANJA1 -->', [...F1.items, ...F1.items].map((t) => `<span>${esc(t)}</span>`).join(''))
  .replaceAll('<!-- FRANJA2 -->', [...F2.items, ...F2.items].map((t) => `<span>${esc(t)}</span>`).join(''));

cpSync(join(ROOT, 'img'), join(DIST, 'img'), { recursive: true });
if (existsSync(join(ROOT, 'favicon.ico'))) cpSync(join(ROOT, 'favicon.ico'), join(DIST, 'favicon.ico')); // Google busca el ícono aquí
cpSync(join(ROOT, 'admin'), join(DIST, 'admin'), { recursive: true });
cpSync(join(DATA, 'catalogo.json'), join(DIST, 'data', 'catalogo.json'));
cpSync(join(DATA, 'regiones.json'), join(DIST, 'data', 'regiones.json'));
// styles.css y app.js llevan ?v=hash: se guardan en caché y cada cambio publicado se descarga de nuevo
const css = render(readFileSync(join(ROOT, 'styles.css'), 'utf8'), 'styles.css', false);
const js = render(readFileSync(join(ROOT, 'app.js'), 'utf8'), 'app.js', false);
const version = (text) => createHash('sha1').update(text).digest('hex').slice(0, 10);
html = html
  .replace('href="styles.css"', `href="styles.css?v=${version(css)}"`)
  .replace('src="app.js"', `src="app.js?v=${version(js)}"`);
writeFileSync(join(DIST, 'index.html'), html);
writeFileSync(join(DIST, 'styles.css'), css);
writeFileSync(join(DIST, 'app.js'), js);
writeFileSync(join(DIST, 'admin', 'config.yml'), render(readFileSync(join(ROOT, 'admin', 'config.yml'), 'utf8'), 'admin/config.yml', false));

writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ${SITE}/sitemap.xml\n`);
writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>
</urlset>
`);

if (!existsSync(join(ROOT, 'img', 'logo.jpg'))) console.warn('⚠️  Falta img/logo.jpg (logo de la tienda)');
console.log(`✅ sitio listo en dist/ para ${SITE}`);
