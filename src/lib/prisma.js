import { PrismaClient } from "@prisma/client";

// Una sola instancia de PrismaClient para toda la app, importada
// desde cualquier route. Evita abrir demasiadas conexiones a la BD.
export const prisma = new PrismaClient();
