// An in-memory Postgres for tests (20 Nov): PGlite behind a local socket, so the app's own driver
// (`postgres`, through lib/server/db.ts) and the migrator talk to it as to any Postgres. Nothing is
// written to disk and nothing leaves 127.0.0.1. The socket server's queue is patched as the chat lab's
// is (`.chat-lab/db.mjs`): a transaction's messages from one connection stay together.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import net from "node:net";

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

export async function startDb() {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  /* The roles Supabase provides, which the migrations grant to and revoke from. */
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
    end $$;
  `);
  const port = await freePort();
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 50 });
  const q = server.queryQueue;
  const open = new Set();
  const BATCH = new Set([0x50, 0x42, 0x44, 0x45, 0x43, 0x48]); // P B D E C H
  const clear = q.clearQueueForHandler.bind(q);
  q.clearQueueForHandler = (id) => {
    open.delete(id);
    return clear(id);
  };
  q.processQueue = async function () {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const holder = this.lastHandlerId;
        const sticky = holder !== null && (this.db.isInTransaction() || open.has(holder));
        const idx = sticky ? this.queue.findIndex((m) => m.handlerId === holder) : 0;
        if (idx === -1) break;
        const item = this.queue.splice(idx, 1)[0];
        let bytes = 0;
        try {
          await this.db.runExclusive(() =>
            this.db.execProtocolRawStream(item.message, {
              onRawData: (d) => {
                bytes += d.length;
                item.onData(d);
              },
            }),
          );
        } catch (err) {
          open.delete(item.handlerId);
          item.reject(err);
          continue;
        }
        const type = item.message[0];
        if (type === 0x53 || type === 0x51) open.delete(item.handlerId);
        else if (BATCH.has(type)) open.add(item.handlerId);
        this.lastHandlerId = item.handlerId;
        item.resolve(bytes);
      }
    } finally {
      this.processing = false;
    }
  };
  await server.start();
  return {
    url: `postgres://postgres@127.0.0.1:${port}/postgres?max_pipeline=1`, // PGlite trusts every login: no password
    stop: async () => {
      await server.stop();
      await db.close();
    },
  };
}
