# 📖 Enciclopedia del Mundo

Wiki de **worldbuilding** para nuestra novela visual. Página estática (HTML/CSS/JS)
alojada en **GitHub Pages** que guarda y lee los datos desde una **Hoja de cálculo de
Google**, para que tanto vos como tu hermano puedan cargar información desde cualquier lado.

```
Navegador (GitHub Pages)  ──►  Google Apps Script  ──►  Google Sheet
     la página web              (el "puente"/API)        (la base de datos)
```

---

## 🗂️ Estructura del proyecto

| Archivo | Qué es |
|---|---|
| `index.html` | La página |
| `assets/styles.css` | Los estilos (tema grimorio oscuro) |
| `assets/app.js` | Toda la lógica de la app |
| `assets/config.js` | **Configuración** (nombre, categorías, URL del script) |
| `apps-script/Codigo.gs` | Código del backend para pegar en Google Apps Script |

---

## 🚀 Puesta en marcha (una sola vez)

Son 4 pasos. El 1, 2 y 3 se hacen en tu cuenta de Google; el 4 en GitHub.

### PASO 1 — Crear la Hoja de Google
1. Entrá a <https://sheets.new> (crea una hoja nueva).
2. Ponele un nombre, por ejemplo **"WorldBuilding — Datos"**.
3. No hace falta crear columnas ni pestañas: el script arma todo solo la primera vez.

### PASO 2 — Pegar el código del backend
1. En esa misma hoja: menú **Extensiones → Apps Script**.
2. Borrá lo que haya y **pegá todo el contenido de `apps-script/Codigo.gs`**.
3. En la línea de arriba, cambiá la contraseña:
   ```js
   const SECRET = "CAMBIAR_ESTA_CLAVE"; // ← poné acá SU contraseña compartida
   ```
   Elegí una clave que solo sepan ustedes dos. **La van a necesitar en el PASO 5.**
4. Guardá (💾 o `Ctrl+S`).

### PASO 3 — Publicar como "App web"
1. Arriba a la derecha: **Implementar → Nueva implementación**.
2. En el ícono de engranaje ⚙️ (tipo), elegí **Aplicación web**.
3. Configurá así:
   - **Descripción:** lo que quieras (ej: "API worldbuilding").
   - **Ejecutar como:** *Yo* (tu cuenta).
   - **Quién tiene acceso:** **Cualquier usuario** (*Anyone*).
     > Esto es necesario para que la página pueda leer/escribir. La contraseña del
     > PASO 2 es la que evita que un desconocido cargue datos.
4. Clic en **Implementar**. Google te va a pedir **autorizar permisos**:
   *Revisar permisos → elegí tu cuenta → "Configuración avanzada" → "Ir a (nombre) (no seguro)" → Permitir.*
   (Es tu propio script accediendo a tu propia hoja; es normal.)
5. Copiá la **URL de la app web**. Termina en **`/exec`**, así:
   ```
   https://script.google.com/macros/s/AKfy...muy-largo.../exec
   ```

> 🔁 **Cada vez que edites `Codigo.gs`** tenés que volver a **Implementar → Gestionar
> implementaciones → editar (lápiz) → Versión: Nueva → Implementar**, o los cambios no
> se aplican. La URL se mantiene.

### PASO 4 — Activar GitHub Pages
1. En GitHub, entrá al repo **WorldBuilding → Settings → Pages**.
2. En **Source**, elegí **Deploy from a branch**.
3. Branch: **`main`**, carpeta: **`/ (root)`**. Guardá.
4. Esperá ~1 minuto. Tu sitio queda en:
   ```
   https://joaquingasperetti.github.io/WorldBuilding/
   ```

### PASO 5 — Conectar la página con la hoja
Tenés dos opciones:

- **Opción A (recomendada, queda listo para todos):** pegá la URL del PASO 3 en
  `assets/config.js`, en el campo `apiUrl`, y hacé `commit` + `push`. Así nadie más
  tiene que configurar nada.
  ```js
  apiUrl: "https://script.google.com/macros/s/AKfy.../exec",
  ```
- **Opción B (rápida):** dejá `apiUrl: ""` y, al abrir la web, te va a pedir la URL y la
  contraseña la primera vez (se guardan en tu navegador). Tu hermano tendrá que hacer lo
  mismo en el suyo.

En ambos casos, **la contraseña** (la del `SECRET`) se pide una vez por navegador y se
guarda localmente; nunca se sube al repo.

---

## ✍️ Uso diario

- **Buscar:** la barra de arriba busca en nombres, resúmenes, textos y etiquetas.
- **Categorías:** panel izquierdo (Personajes, Lugares, Facciones, etc.).
- **Nueva entrada:** botón ✦ arriba a la derecha.
- **Descripción:** admite Markdown básico → `**negrita**`, `*cursiva*`, `# Título`,
  `- listas`, `> citas`, `[enlace](https://…)`.
- **Etiquetas:** separadas por coma. Sirven para filtrar dentro de una categoría.
- **Conexiones:** escribí nombres de otras entradas (separadas por coma). Si existen,
  quedan como enlaces clickeables entre fichas.
- **Imágenes:** pegá un **link directo** a una imagen (que termine en `.jpg`, `.png`, etc.).

Los datos quedan en la Hoja de Google → los pueden ver, editar a mano o exportar cuando quieran.

---

## 🎨 Personalizar

Todo en `assets/config.js`:
- `siteName` y `tagline`: nombre de tu mundo.
- `categories`: agregá / quitá / renombrá categorías (cada una: `id`, `label`, `icon`).
  > ⚠️ No cambies el `id` de una categoría que ya tenga entradas cargadas.

Después de cualquier cambio: `git add`, `git commit`, `git push`. GitHub Pages se
actualiza solo en ~1 minuto.

---

## 🔒 Sobre la seguridad
La contraseña compartida evita que alguien que encuentre la URL escriba o borre datos.
No es cifrado de nivel bancario (es un proyecto entre dos), pero mantiene a los curiosos
afuera. Si alguna vez se filtra, cambiá el `SECRET` en `Codigo.gs`, reimplementá, y
avisale al otro la nueva clave.
