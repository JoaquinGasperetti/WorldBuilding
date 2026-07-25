/* ============================================================
   CONFIGURACIÓN — Editá este archivo para adaptar la página.
   Después de cambiarlo, hacé commit y push para que se vea online.
   ============================================================ */
const CONFIG = {
  // Nombre de tu mundo / proyecto (aparece en el encabezado y la pestaña).
  siteName: "Nuestro Mundo",

  // Subtítulo pequeño debajo del nombre (opcional, dejá "" para ocultarlo).
  tagline: "Worldbuilding & guion ramificado",

  // URL de la app web de Google Apps Script (ver README, PASO 3).
  apiUrl: "https://script.google.com/macros/s/AKfycbyMzYJ-jQzlrqLk7VbxXhNXyoBs95Osnb_mFo8zVn0iQK3dn5Wei4LOTrRhZBKkZ9zVZA/exec",

  // Grupos del menú lateral.
  groups: [
    { id: "mundo",    label: "El Mundo" },
    { id: "historia", label: "La Historia" },
  ],

  // Categorías. Podés agregar, quitar o renombrar.
  //   id:        identificador interno (no cambiarlo si ya cargaste datos).
  //   label:     nombre visible · icon: un emoji · group: a qué grupo pertenece.
  //   narrative: true → es una escena del guion (aparece en el diagrama de flujo
  //              y su formulario muestra los campos de decisiones).
  categories: [
    // ---- El Mundo (worldbuilding) ----
    { id: "personajes", label: "Personajes", icon: "👤",  group: "mundo" },
    { id: "lugares",    label: "Lugares",    icon: "🗺️", group: "mundo" },
    { id: "facciones",  label: "Facciones",  icon: "⚔️", group: "mundo" },
    { id: "especies",   label: "Especies",   icon: "🐉", group: "mundo" },
    { id: "objetos",    label: "Objetos",    icon: "💎", group: "mundo" },
    { id: "eventos",    label: "Eventos",    icon: "📜", group: "mundo" },
    { id: "lore",       label: "Lore",       icon: "📖", group: "mundo" },
    { id: "notas",      label: "Notas",      icon: "🗒️", group: "mundo" },

    // ---- La Historia (guion del videojuego) ----
    { id: "escenas",    label: "Escenas",    icon: "🎬", group: "historia", narrative: true },
    { id: "capitulos",  label: "Capítulos",  icon: "📕", group: "historia" },
    { id: "variables",  label: "Variables",  icon: "🎚️", group: "historia" },
  ],

  // Tipos de escena para el diagrama de flujo (podés renombrar los label).
  sceneTypes: [
    { id: "inicio",   label: "Inicio",   icon: "▶",  color: "#6fbf83" },
    { id: "escena",   label: "Escena",   icon: "🎬", color: "#8a7bff" },
    { id: "decision", label: "Decisión", icon: "◆",  color: "#d8b16a" },
    { id: "final",    label: "Final",    icon: "🏁", color: "#c8703a" },
  ],
};
