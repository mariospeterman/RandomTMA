import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: {
      ...serverOptions,
      allowedHosts: true
    },
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "..", "dist", "client");

  if (!fs.existsSync(distPath)) {
    console.warn(`Could not find the build directory: ${distPath}. Make sure to build the client first.`);
    
    // Fallback to serving files from the client directory directly
    const clientPath = path.resolve(import.meta.dirname, "..", "client");
    
    if (fs.existsSync(clientPath)) {
      console.log(`Falling back to serving from client directory: ${clientPath}`);
      app.use(express.static(clientPath));
      
      // Also serve from public for assets
      app.use(express.static(path.resolve(import.meta.dirname, "..", "public")));
      
      // fall through to index.html
      app.use("*", (req, res, next) => {
        if (req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/socket.io/')) {
          next();
          return;
        }
        
        const indexPath = path.resolve(clientPath, "index.html");
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          console.error(`Could not find index.html at ${indexPath}`);
          next(new Error("Could not find index.html"));
        }
      });
    } else {
      throw new Error(`Could not find either build directory or client directory`);
    }
  } else {
    console.log(`Serving static files from: ${distPath}`);
    app.use(express.static(distPath));
    
    // Also serve from public for assets
    app.use(express.static(path.resolve(import.meta.dirname, "..", "public")));
    
    // fall through to index.html if the file doesn't exist
    app.use("*", (req, res, next) => {
      if (req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/socket.io/')) {
        next();
        return;
      }
      res.sendFile(path.resolve(distPath, "index.html"));
    });
  }
}
