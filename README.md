# Glass Recorder Web

Frontend Vercel para grabar video desde celular/navegador, subirlo directo a Cloudinary con unsigned upload preset y redirigir a Glass Reflection en Streamlit.

Este repo no analiza video, no usa OpenAI, no usa MongoDB y no guarda videos en Vercel.

## Variables Vercel

```text
VITE_CLOUDINARY_CLOUD_NAME=...
VITE_CLOUDINARY_UPLOAD_PRESET=...
VITE_STREAMLIT_URL=https://glass-reflection.streamlit.app
```

No pongas `CLOUDINARY_API_SECRET` en el frontend. La subida usa un unsigned upload preset.

## Desarrollo

```powershell
npm install
npm run dev
```

## Build

```powershell
npm run build
```

## Flujo

1. Pedir permiso de cámara.
2. Mostrar preview real.
3. Grabar con `MediaRecorder`.
4. Mostrar cronómetro.
5. Revisar duración, tamaño y preview del video.
6. Bloquear subida si supera 100 MB.
7. Advertir si supera 50 MB.
8. Subir directo a Cloudinary.
9. Redirigir a Streamlit:

```text
https://glass-reflection.streamlit.app/?source=vercel&session_id=...&public_id=...&video_url=...
```

## Calidad

- Liviano: 480p, 12 fps.
- Balanceado: 640x480, 15 fps.
- Mejor calidad: 720p, 24 fps.

## Rol En Glass

Vercel solo graba y sube video. Streamlit analiza y muestra el reflejo.
