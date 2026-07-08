import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { initSocketServer } from "./lib/socket";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0"; // Escuchar en todas las interfaces (IPv4 e IPv6)
const port = parseInt(process.env.PORT || "3001", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
    const httpServer = createServer((req, res) => {
        const parsedUrl = parse(req.url!, true);
        handle(req, res, parsedUrl);
    });

    // Inicializar Socket.io
    initSocketServer(httpServer);

    httpServer.listen(port, () => {
        console.log(`
    Servidor listo:
   - HTTP:      http://${hostname}:${port}
   - Socket.io: ws://${hostname}:${port}/api/socket
        `);
    });
});
