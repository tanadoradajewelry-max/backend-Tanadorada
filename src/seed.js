// src/seed.js
import "dotenv/config";
import { pool } from "./lib/db.js";

const products = [
  {
    id: "collar-gitana-gold",
    title: "Collar Gitana Gold",
    price: 950.0,
    image: "/img/1.jpeg",
    badge: "Nuevo",
  },
  {
    id: "aretes-oslo-perla",
    title: "Aretes Oslo Perla",
    price: 380.0,
    image: "/img/2.jpeg",
    badge: null,
  },
  {
    id: "anillo-mercedes-chunky",
    title: "Anillo Mercedes Chunky",
    price: 320.0,
    image: "/img/3.jpeg",
    badge: "Popular",
  },
  {
    id: "escapulario-virgin-turquoise",
    title: "Escapulario Virgin Turquoise",
    price: 1100.0,
    image: "/img/4.jpeg",
    badge: null,
  },
];

async function main() {
  console.log("🌱 Iniciando seed...");

  for (const p of products) {
    await pool.query(
      `INSERT INTO Product (id, title, price, image, badge)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         price = VALUES(price),
         image = VALUES(image),
         badge = VALUES(badge)`,
      [p.id, p.title, p.price, p.image, p.badge]
    );
    console.log(`  ✅ ${p.title} (${p.image})`);
  }

  console.log(`\n🎉 Seed listo: ${products.length} productos insertados.`);
  await pool.end();
}

main().catch((err) => {
  console.error("❌ Error en el seed:", err.message);
  process.exit(1);
});
