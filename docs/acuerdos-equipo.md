# Acuerdos del equipo y registro del proceso

**Asignatura:** Interacción Humano-Computador (Unidad 2)  
**Proyecto:** FiveBuys — Tienda de computadores  
**Integrantes:** Juan González, Manuel Latorre, Isabel Marín y Francisco Ocares

## Acuerdos de trabajo
1. **Enfoque en claridad y confianza:** Todo el flujo de compra muestra precios en pesos chilenos (CLP) sin cargos ocultos y el cálculo final siempre se valida en el servidor.
2. **Accesibilidad desde el inicio:** Se priorizó la navegación con teclado (`Tab`, flechas en las estrellas de la encuesta, `Escape` para cerrar modales) y avisos claros para lectores de pantalla como Narrador de Windows.
3. **Encuesta justa:** El 5 % de descuento se entrega por responder la encuesta, sin importar si la puntuación es alta o baja, para no sesgar la opinión del usuario.
4. **Seguridad en pruebas:** Los pagos se prueban únicamente con claves `sk_test_` de Stripe. Las claves reales o de prueba nunca se suben al repositorio.
5. **Versionado ordenado:** Cada avance funcional (datos, servidor, vistas, estilos, encuesta, pruebas e informe) se registra en commits pequeños y descriptivos.

## Estructura del repositorio
- `app/`: Código fuente de la aplicación web en Node.js, Express y EJS, junto con sus pruebas.
- `entregables/`: Informe final de la Unidad 2 (`Informe FiveBuys.docx`).
- `docs/`: Documentación de acuerdos y proceso del equipo.
- `INICIAR-APP.cmd` / `start.bat` / `README.txt`: Archivos para abrir y probar el prototipo sin complicaciones en Windows.
