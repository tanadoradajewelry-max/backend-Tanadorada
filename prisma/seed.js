import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Mismos IDs y datos que src/data/storeData.js del frontend, para que
// el frontend y el backend hablen de los mismos productos mientras
// migras a manejar el catálogo 100% desde acá.
const products = [
  {
    id: "collar-gitana-gold",
    title: "Collar Gitana Gold",
    price: 950.0,
    image: "/img/1.jpg",
    badge: "Nuevo",
  },
  {
    id: "aretes-oslo-perla",
    title: "Aretes Oslo Perla",
    price: 380.0,
    image: "/img/2.jpg",
    badge: null,
  },
  {
    id: "anillo-mercedes-chunky",
    title: "Anillo Mercedes Chunky",
    price: 320.0,
    image: "/img/3.jpg",
    badge: "Popular",
  },
  {
    id: "escapulario-virgin-turquoise",
    title: "Escapulario Virgin Turquoise",
    price: 1100.0,
    image: "/img/4.jpg",
    badge: null,
  },
];

async function main() {
  for (const product of products) {
    await prisma.product.upsert({
      where: { id: product.id },
      update: product,
      create: product,
    });
  }
  console.log(`Seed listo: ${products.length} productos.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());