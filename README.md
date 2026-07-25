# 📖 Enciclopedia del Mundo

Herramienta de **worldbuilding + guion ramificado** para nuestro videojuego narrativo
(estilo *Detroit: Become Human*, *Life is Strange*, *Heavy Rain*). Página estática
(HTML/CSS/JS) en **GitHub Pages** que guarda todo en una **Hoja de cálculo de Google**.

Tiene dos capas:

- **🌍 El Mundo** — personajes, lugares, facciones, especies, objetos, eventos, lore.
- **🎬 La Historia** — las escenas del juego, sus decisiones y sus finales, *dentro* de ese mundo.

Y tres vistas que se generan **solas** a partir de lo que carguen:

- **🌊 Diagrama de flujo** — el mapa de ramas del guion, dibujado automáticamente.
- **🕸️ Mapa de relaciones** — quién se conecta con quién en el worldbuilding.
- **📊 Panel de control** — estadísticas y avisos de cabos sueltos en la historia.

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
| `assets/app.js` | Lógica de la app (vistas, formularios, datos) |
| `assets/graph.js` | Motor de diagramas (layout y dibujo, sin librerías) |
| `assets/config.js` | **Configuración** (nombre, categorías, URL del script) |
| `apps-script/Codigo.gs` | Código del backend para pegar en Google Apps Script |

---

## ⚠️ Si ya tenías la versión anterior: actualizá el script

La capa narrativa necesita **columnas nuevas** en la hoja. Hay que reemplazar el código del
Apps Script una vez (los datos que ya tengas **no se pierden**: el script detecta las columnas
que faltan y las agrega solo).

1. Hoja de Google → **Extensiones → Apps Script**.
2. Borrá todo y pegá el contenido nuevo de [`apps-script/Codigo.gs`](apps-script/Codigo.gs).
3. Volvé a poner su contraseña en `const SECRET = "…"`.
4. **Implementar → Gestionar implementaciones → ✏️ (editar) → Versión: Nueva → Implementar.**
   La URL no cambia.

Si no lo hacés, la página te lo avisa con un cartel y **no te deja guardar escenas**, para
que no se pierdan las decisiones.

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

- **Buscar:** la barra de arriba busca en todo (nombres, textos, etiquetas, personajes de una escena…).
- **Nueva entrada:** botón ✦ arriba a la derecha.
- **Descripción:** admite Markdown básico → `**negrita**`, `*cursiva*`, `# Título`,
  `- listas`, `> citas`, `[enlace](https://…)`.
- **Etiquetas:** separadas por coma. Sirven para filtrar dentro de una categoría.
- **Conexiones:** escribí nombres de otras entradas (por coma). Si existen, quedan como
  enlaces clickeables **y aparecen en el mapa de relaciones**.
- **Imágenes:** pegá un **link directo** a una imagen (que termine en `.jpg`, `.png`, etc.).

Los datos quedan en la Hoja de Google → los pueden ver, editar a mano o exportar cuando quieran.

---

## 🎬 Escribir el guion ramificado

El flujo de trabajo pensado es: **primero el mundo, después la historia dentro de ese mundo.**

Cada **Escena** tiene, además de los campos normales:

| Campo | Para qué sirve |
|---|---|
| **Tipo** | `Inicio` (por dónde arranca), `Escena`, `Decisión` o `Final`. Define el color en el diagrama. |
| **Capítulo** | Agrupa escenas. El diagrama se puede filtrar por capítulo. |
| **Lugar** | Un lugar del worldbuilding (autocompleta). |
| **Personajes** | Quiénes aparecen (autocompleta). Alimenta el gráfico de presencia del panel. |
| **Decisiones** | **Lo más importante**: las ramas que salen de la escena. |
| **Variables que cambia** | Efectos que la escena deja marcados (ej. `confianza+1`). |
| **Condición para llegar** | Requisito para que esta escena ocurra. |

### Sintaxis de las decisiones

Una opción **por línea**:

```
Texto que ve el jugador -> Nombre de la escena destino
```

Podés agregar efectos y condiciones separando con `|`:

```
Salvar a Alice   -> Huida en el tren  | confianza+1
Dejarla atrás    -> Solo en la noche  | confianza-1
Llamar a Kaeron  -> Encuentro tenso   | si: kaeron_vivo=true
```

- El **destino** se escribe con el **nombre exacto** de otra escena (no importan tildes ni mayúsculas).
- Mientras escribís, debajo del campo aparece una **vista previa** que te avisa en verde si
  la escena destino existe y en amarillo si todavía no la creaste.
- Con eso solo, el **diagrama de flujo se dibuja automáticamente**. No hay que acomodar nada a mano.

### Las tres vistas automáticas

- **🌊 Diagrama de flujo** — arrastrá para moverte, rueda del mouse para acercar, clic en una
  escena para abrirla. Se puede filtrar por capítulo y alternar vertical/horizontal.
- **🕸️ Mapa de relaciones** — el worldbuilding como red: pasá el mouse para resaltar vínculos.
- **📊 Panel de control** — estadísticas (escenas, finales, ramas por decisión) y sobre todo
  **avisos de diseño**:
  - opciones que apuntan a una escena que no existe,
  - escenas sin salida que no están marcadas como final,
  - escenas huérfanas a las que no se llega desde ninguna decisión,
  - si falta marcar por dónde arranca el juego.

> 💡 **Consejo:** nombrá los capítulos con número al principio (`01 — Prólogo`, `02 — Ruta`)
> para que se ordenen solos.

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
