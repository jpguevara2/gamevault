# 🎮 GameVault — Gestor de Colección de Videojuegos

## Requisitos
- Node.js v18 o superior (cualquier versión moderna)

## Instalación

```cmd
cd gamevault
npm install
npm start
```

Luego abre: **http://localhost:3000**

La base de datos `gamevault.db` se crea automáticamente.

## Tabla `juego`

| Campo           | Tipo    | Descripción                                              |
|-----------------|---------|----------------------------------------------------------|
| id              | INTEGER | PK autoincremental                                       |
| nombre          | TEXT    | Título del juego (obligatorio)                           |
| plataforma      | TEXT    | Consola (PC, SNES, PS5…)                                 |
| desarrolladora  | TEXT    | Compañía que lo desarrolló                               |
| anio            | INTEGER | Año de lanzamiento                                       |
| genero          | TEXT    | Género (Acción, RPG…)                                    |
| clasificacion   | TEXT    | ESRB (E, T, M…)                                         |
| num_jugadores   | TEXT    | 1, 2-4, multijugador…                                    |
| estado          | TEXT    | pendiente / jugando / completado / abandonado            |
| posesion        | TEXT    | `coleccion` (desde Agregar) · `buscado` (Títulos buscados) |
| creado_en       | TEXT    | Fecha/hora de registro                                   |
