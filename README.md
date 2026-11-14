# FiveBuys — Tienda de computadores y pasarela de pago

Proyecto desarrollado para la asignatura **Interacción Humano-Computador** (Unidad 2, Universidad Mayor).

## Integrantes
- Juan González
- Manuel Latorre
- Isabel Marín
- Francisco Ocares

## ¿Qué resuelve este prototipo?
FiveBuys es un prototipo web de tienda de computadores pensado para que cualquier persona pueda buscar un equipo, agregarlo al carrito, revisar el total sin sorpresas y pagar en entorno de pruebas con Stripe. Incluye una encuesta breve opcional que otorga un 5 % de descuento, navegación completa por teclado y compatibilidad con el Narrador de Windows.

## Cómo ejecutarlo
1. Copia `env.example` con el nombre `env` en la raíz del proyecto y coloca tu clave `sk_test_` de Stripe.
2. En Windows, haz doble clic en `INICIAR-APP.cmd` (o ejecuta `npm start` dentro de `app/`).
3. Para correr las pruebas automáticas:
   ```bash
   cd app
   npm test
   ```

## Documentación y entregables
- [Acuerdos del equipo y registro del proceso](docs/acuerdos-equipo.md)
- [Guía rápida de uso](README.txt)
- [Informe FiveBuys (Word)](entregables/Informe%20FiveBuys.docx)
