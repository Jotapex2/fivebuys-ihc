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

## Cómo usarlo

1 Descargar y descomprimir

Descarga el archivo ZIP y guárdalo en tu equipo. Haz clic derecho sobre él, selecciona Extraer todo y abre la carpeta que se creó. No abras la aplicación desde dentro del ZIP.

2 Instalar Node.js si no lo tienes

1. Abre https://nodejs.org/en/download.
2. Selecciona LTS, Windows y el instalador .msi. Node.js 24 LTS es compatible con esta entrega.
3. Abre el archivo descargado. Pulsa Next, acepta la licencia y conserva las opciones predeterminadas, incluida npm.
4. Pulsa Install y después Finish. Cierra y vuelve a abrir la carpeta de FiveBuys.

Esto se hace una sola vez por equipo.

3 Configurar Stripe

Si la carpeta ya tiene el archivo env con la clave actual, sigue al paso 4.

Si no lo tiene:

1. Abre el Bloc de notas.
2. Escribe STRIPE_SECRET_KEY= y, a continuación, pega tu clave secreta de Stripe de pruebas, que comienza con sk_test_.
3. Guarda el archivo en la misma carpeta que INICIAR-APP.cmd. En «Tipo», elige Todos los archivos y usa el nombre env, sin .txt.

Debe haber una sola línea STRIPE_SECRET_KEY. No pegues tres claves ni elijas una por su posición: utiliza la clave actual del entorno de pruebas.

La línea STRIPE_PUBLISHABLE_KEY=pk_test_… es opcional para este Checkout. La secreta crea el pago desde el servidor; la publicable se utiliza en integraciones del navegador. Ninguna es una contraseña para entrar a FiveBuys. No incluyas claves en el informe, en capturas ni en un grupo de WhatsApp.

4 Abrir la aplicación

Haz doble clic en INICIAR-APP.cmd. También puedes abrir start.bat: hace lo mismo.

La primera vez, espera mientras se preparan las dependencias. Necesitas Internet. Después se abrirá FiveBuys en el navegador. No escribas comandos ni una dirección: usa esa nueva pestaña. Mantén abierta la ventana del iniciador.

Si Windows muestra las extensiones ocultas, el archivo puede aparecer simplemente como INICIAR-APP.

5 Probar la compra

1. Busca un computador y agrega una unidad con +.
2. Abre el carrito y revisa la cantidad y el total.
3. Usa Ir a pagar para la compra normal, o Obtener 5 % de descuento para responder la encuesta.
4. En la encuesta, elige las estrellas y pulsa Enviar y obtener 5 %. Comprueba el descuento. Puedes Pausar el contador y después Continuar.
5. En Stripe de pruebas, usa 4242 4242 4242 4242, una fecha futura y CVC 123. No uses tu tarjeta personal.
6. Prueba también cancelar y volver al carrito.

Para terminar, vuelve a la ventana del iniciador y pulsa Ctrl+C.

6 Escuchar con Narrador

Con FiveBuys al frente, pulsa Windows + Ctrl + Enter. Si aparece Inicio de Narrador, minimízalo y vuelve a la página.

- Tab avanza entre controles. Mayús + Tab retrocede.
- Enter activa enlaces y botones. Espacio selecciona opciones.
- En las estrellas, usa las flechas para cambiar de puntuación.
- Escape cierra la encuesta y el menú.
- Ctrl interrumpe momentáneamente la voz.
- Bloq Mayús + Espacio alterna el modo de examen. Si las flechas leen texto en lugar de cambiar una estrella, desactiva ese modo antes de probarlas.
- Windows + Ctrl + Enter desactiva Narrador.

El primer Tab ofrece Saltar al contenido. Al abrir la encuesta deben poder reconocerse el título, la pregunta y las cinco opciones. El contador cambia visualmente cada segundo, pero los avisos de voz son puntuales para no interrumpir continuamente.

Si algo no funciona

- No se encuentra Node.js: realiza el paso 2 y vuelve a abrir INICIAR-APP.
- No se pudo preparar la aplicación: comprueba Internet y vuelve a intentarlo.
- Clave no válida o repetida: deja una sola clave sk_test_ actual en env.
- Ves preguntas antiguas: utiliza la nueva pestaña que abrió el iniciador y pulsa Ctrl+F5.
