# Internal Uploader

Sitio simple para subir archivos o carpetas completas y reenviarlas a un servidor interno.

## Configuracion

Variables de entorno:

- `TARGET_URL`: endpoint real de subida del servidor.
- `TARGET_MODE`: `local`, `webdav` o `post`. Por defecto usa `webdav`.
- `UPLOAD_DIR`: carpeta interna donde guardar archivos si `TARGET_MODE=local`.
- `UPLOAD_USER` y `UPLOAD_PASS`: credenciales del formulario de subida.
- `PUBLIC_BASE_PATH`: ruta publica donde abre la app. Para tu caso: `/modules/icewhale_files`.
- `PUBLIC_URL`: URL visible para mostrar en pantalla.
- `MAX_FILE_SIZE_MB`: tamano maximo por archivo. Por defecto `5120`.
- `PORT`: puerto interno. Por defecto `3000`.

El link original:

```text
http://patagonia.serveftp.com/modules/icewhale_files/#/files/HDD-500/UPLOAD%20EXT
```

parece ser una ruta de la interfaz web. La parte despues de `#` no se envia al servidor, por eso conviene reemplazar `TARGET_URL` por el endpoint real de WebDAV/API si IceWhale/ZimaOS lo expone.

Si usas `TARGET_MODE=local`, no hace falta conocer el endpoint de ZimaOS: el contenedor guarda directamente en una carpeta montada del host.

## Docker / Portainer

Build:

```bash
docker build -t internal-uploader .
```

Run:

```bash
docker run -p 3020:3000 \
  -v /opt/upload-data:/uploads \
  -e TARGET_MODE=local \
  -e UPLOAD_DIR=/uploads \
  internal-uploader
```

En Portainer, crear un stack o container con la imagen y mapear el puerto externo `3020` al puerto interno `3000`.

Tambien podes usar directamente el archivo `docker-compose.yml` como Stack. Ajusta `TARGET_URL` al endpoint real antes de desplegarlo.

## Publicarlo en tu subdominio

El contenedor ya queda preparado para abrir en:

```text
http://patagonia.serveftp.com/modules/icewhale_files/#/files/HDD-500/UPLOAD%20EXT
```

Para eso tu reverse proxy debe enviar la ruta `/modules/icewhale_files` hacia el puerto `3020` del host, o directo al puerto `3000` del contenedor si usa la red interna de Docker.

Ejemplo conceptual:

```text
patagonia.serveftp.com/modules/icewhale_files -> host:3020
```

Ojo: si esa ruta ya la usa IceWhale, no pueden responder dos apps distintas en la misma ruta al mismo tiempo. En ese caso conviene usar una ruta nueva, por ejemplo `/upload-ext`, y cambiar:

```yaml
PUBLIC_BASE_PATH: "/upload-ext"
PUBLIC_URL: "http://patagonia.serveftp.com/upload-ext"
```
