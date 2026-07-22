/* ============================================================
   CONFIGURACIÓN — Editá este archivo para adaptar la página.
   Después de cambiarlo, hacé commit y push para que se vea online.
   ============================================================ */
const CONFIG = {
  // Nombre de tu mundo / proyecto (aparece en el encabezado y la pestaña).
  siteName: "Nuestro Mundo",

  // Subtítulo pequeño debajo del nombre (opcional, dejá "" para ocultarlo).
  tagline: "Enciclopedia del mundo · Novela visual",

  // URL de la app web de Google Apps Script (ver README, PASO 3).
  // Si la dejás vacía (""), la página te la va a pedir la primera vez
  // y la guarda en tu navegador. Lo ideal es pegarla acá y hacer push,
  // así ya queda lista para vos y para tu hermano sin configurar nada.
  apiUrl: "https://script.google.com/macros/s/AKfycbyMzYJ-jQzlrqLk7VbxXhNXyoBs95Osnb_mFo8zVn0iQK3dn5Wei4LOTrRhZBKkZ9zVZA/exec",

  // Categorías del worldbuilding. Podés agregar, quitar o renombrar.
  //   id:    identificador interno, sin espacios ni tildes (no cambiarlo
  //          una vez que ya cargaste datos con ese id).
  //   label: el nombre que se muestra.
  //   icon:  un emoji.
  categories: [
    { id: "personajes", label: "Personajes", icon: "👤" },
    { id: "lugares",    label: "Lugares",    icon: "🗺️" },
    { id: "facciones",  label: "Facciones",  icon: "⚔️" },
    { id: "especies",   label: "Especies",   icon: "🐉" },
    { id: "objetos",    label: "Objetos",    icon: "💎" },
    { id: "eventos",    label: "Eventos",    icon: "📜" },
    { id: "lore",       label: "Lore",       icon: "📖" },
    { id: "notas",      label: "Notas",      icon: "🗒️" },
  ],
};
