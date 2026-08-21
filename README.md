# Caro Control

Sistema personal de gestión profesional y contable — Next.js + Supabase.

## Variables de entorno

Este proyecto no necesita archivo `.env` porque las credenciales de Supabase
(URL y anon/publishable key, ambas seguras de exponer en el cliente) están
directamente en `components/CaroControl.jsx`. No hay ninguna llave secreta
en este repositorio.

## Desarrollo local (opcional)

```bash
npm install
npm run dev
```

## Despliegue

1. Sube esta carpeta a un repositorio de GitHub.
2. En Vercel: "Add New Project" → importa el repositorio → Deploy.
   Vercel detecta Next.js automáticamente, no requiere configuración extra.
