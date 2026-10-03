// src/seed-content.js
import { pool } from "./lib/db.js";

const content = {
  hero: {
    image: "/img/1.jpg",
    eyebrow: "Nueva Colección",
    headline: "Brilla. Luce. Repite.",
    subtext: "Piezas atemporales en oro, pensadas para el día a día",
    buttonText: "Explorar Colección",
    buttonHref: "#",
  },
  category_strip: [
    { label: "Rings", image: "/img/7.jpeg", href: "/coleccion/anillos" },
    { label: "Necklaces", image: "/img/4.jpg", href: "/coleccion/collares" },
  ],
  category_grid: {
    eyebrow: "Explora",
    title: "Colecciones por Estilo",
    subtitle: "Diseños atemporales para complementar tu día a día",
    items: [
      { title: "Aretes Statement", image: "/img/1.jpg", href: "/coleccion/aretes" },
      { title: "The Beach Edit", image: "/img/2.jpg", href: "/coleccion/collares" },
      { title: "Anillos Chunky", image: "/img/3.jpg", href: "/coleccion/anillos" },
    ],
  },
  about_us: {
    image: "/img/I.jpeg",
    eyebrow: "Sobre Nosotros",
    title: "The story behind TANADORADA",
    paragraphs: [
      "TANADORADA nace del amor por la moda, el buen gusto y la joyería cuidadosamente curada.",
      "Soy Alba Sthella, directora creativa y fundadora de TANADORADA. Cada colección es seleccionada y curada por mí, inspirada en las tendencias y buscando siempre piezas que combinen personalidad, versatilidad y estilo.",
      "El nombre TANADORADA nace de Aitana, el nombre de mi hija, y dorado, mi tono favorito en joyería. Hoy también exploramos los mixed tones, combinando diferentes metales como parte de nuestra visión contemporánea.",
      "A lo largo de los años, hemos colaborado con revistas, figuras públicas, marcas y eventos, construyendo algo que va más allá de la joyería: una comunidad y una experiencia.",
      "Nuestra marca es pionera en crear experiencias como nuestro icónico Charm Bar, llevando la joyería a nuevos espacios de expresión, conexión y celebración.",
    ],
  },
};

async function main() {
  for (const [key, value] of Object.entries(content)) {
    await pool.query(
      `INSERT INTO SiteContent (\`key\`, value)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [key, JSON.stringify(value)]
    );
  }
  console.log(`Contenido sembrado: ${Object.keys(content).length} bloques.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});