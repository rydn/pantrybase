import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addToPantry } from "../../src/pantry/pantry.js";
import { saveRecipe } from "../../src/recipes/service.js";
import { startUiServer, type UiServer } from "../../src/web/server.js";
import { bakedRavioli, cosyPotatoes } from "../fixtures/ucook.js";
import { harissaChicken, tempContext } from "../helpers.js";

/** Raw HTTP so tests control the Host/Origin headers exactly (fetch forbids setting Host). */
function req(
  ui: UiServer,
  method: string,
  url: string,
  opts: { body?: unknown; raw?: Buffer; headers?: Record<string, string> } = {},
): Promise<{ status: number; type: string; body: Buffer; json: () => unknown }> {
  return new Promise((resolve, reject) => {
    const payload =
      opts.raw ?? (opts.body !== undefined ? Buffer.from(JSON.stringify(opts.body)) : undefined);
    const r = http.request(
      {
        host: "127.0.0.1",
        port: ui.port,
        method,
        path: url,
        headers: {
          host: `127.0.0.1:${ui.port}`,
          ...(payload ? { "content-length": payload.length } : {}),
          ...opts.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode ?? 0,
            type: String(res.headers["content-type"] ?? ""),
            body,
            json: () => JSON.parse(body.toString("utf8")),
          });
        });
      },
    );
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

describe("web UI server", () => {
  let t: ReturnType<typeof tempContext>;
  let ui: UiServer;
  const W = { "x-pantrybase": "1", "content-type": "application/json" };

  beforeAll(async () => {
    t = tempContext();
    saveRecipe(t.ctx, cosyPotatoes);
    saveRecipe(t.ctx, bakedRavioli);
    saveRecipe(t.ctx, harissaChicken);
    saveRecipe(t.ctx, {
      title: "Harissa Bean Bake",
      source: { kind: "synthesized" },
      derived_from: ["cosy-potatoes-and-crispy-cannellini-beans"],
      tags: { cuisine: ["north-african"] },
      ingredients: [{ raw: "1 tin cannellini beans", canonical: "cannellini beans" }],
      steps: ["Bake."],
    });
    addToPantry(t.ctx, [{ name: "cannellini beans" }, { name: "spinach" }]);
    ui = await startUiServer(t.ctx, {
      port: 0 + 7600 + Math.floor(Math.random() * 300),
      version: "test",
    });
  });
  afterAll(async () => {
    await ui.close();
    t.dispose();
  });

  it("serves stats, facets and hierarchy-aware search", async () => {
    const stats = (await req(ui, "GET", "/api/stats")).json() as {
      recipes: number;
      pantry: number;
    };
    expect(stats).toMatchObject({ recipes: 4, pantry: 2 });
    const facets = (await req(ui, "GET", "/api/facets")).json() as {
      used: Record<string, Array<{ name: string }>>;
    };
    expect(facets.used.allergen?.map((a) => a.name)).toContain("dairy");
    const tags = encodeURIComponent(JSON.stringify({ cuisine: ["african"] }));
    const res = (
      await req(ui, "GET", `/api/search?tags=${tags}&exclude_allergens=tree-nuts`)
    ).json() as { results: Array<{ slug: string }> };
    expect(res.results.map((r) => r.slug).sort()).toEqual([
      "harissa-bean-bake",
      "harissa-chicken-traybake",
    ]);
  });

  it("returns a recipe with pantry availability, sources and derived recipes", async () => {
    const d = (
      await req(ui, "GET", "/api/recipes/cosy-potatoes-and-crispy-cannellini-beans")
    ).json() as {
      recipe: { title: string };
      pantry_have: string[];
      derived: Array<{ slug: string }>;
    };
    expect(d.recipe.title).toBe("Cosy Potatoes & Crispy Cannellini Beans");
    expect(d.pantry_have.sort()).toEqual(["cannellini beans", "spinach"]);
    expect(d.derived.map((x) => x.slug)).toEqual(["harissa-bean-bake"]);
    const child = (await req(ui, "GET", "/api/recipes/harissa-bean-bake")).json() as {
      sources: Array<{ slug: string }>;
    };
    expect(child.sources.map((s) => s.slug)).toEqual(["cosy-potatoes-and-crispy-cannellini-beans"]);
    expect((await req(ui, "GET", "/api/recipes/nope")).status).toBe(404);
  });

  it("builds the graph with typed nodes, hierarchy and derived edges", async () => {
    const g = (
      await req(ui, "GET", "/api/graph?categories=cuisine,allergen&min_degree=1")
    ).json() as {
      nodes: Array<{ id: string; kind: string }>;
      edges: Array<{ source: string; target: string; kind: string }>;
    };
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(ids.has("r:bubbling-baked-ravioli")).toBe(true);
    expect(ids.has("i:cannellini beans")).toBe(true);
    expect(ids.has("t:allergen:dairy")).toBe(true);
    expect(ids.has("i:salt")).toBe(false); // staples hidden by default
    expect(g.edges).toContainEqual({
      source: "t:cuisine:north-african",
      target: "t:cuisine:african",
      kind: "parent",
    });
    expect(g.edges).toContainEqual({
      source: "r:harissa-bean-bake",
      target: "r:cosy-potatoes-and-crispy-cannellini-beans",
      kind: "derived_from",
    });
  });

  it("manages the pantry and matches recipes", async () => {
    const added = (
      await req(ui, "POST", "/api/pantry", {
        body: { items: [{ name: "Baby Potatoes" }] },
        headers: W,
      })
    ).json() as {
      pantry: Array<{ canonical: string }>;
    };
    expect(added.pantry.map((p) => p.canonical)).toContain("potato");
    const m = (await req(ui, "GET", "/api/pantry/match?min_coverage=0.3")).json() as {
      results: Array<{ slug: string }>;
    };
    // The one-ingredient synthesized bake is fully covered; Cosy Potatoes gains the potatoes.
    expect(m.results[0]?.slug).toBe("harissa-bean-bake");
    expect(m.results.map((r) => r.slug)).toContain("cosy-potatoes-and-crispy-cannellini-beans");
    const removed = (
      await req(ui, "DELETE", "/api/pantry", { body: { names: ["potatoes"] }, headers: W })
    ).json() as {
      pantry: unknown[];
    };
    expect(removed.pantry).toHaveLength(2);
  });

  it("accepts photo uploads into the inbox and serves thumbnails", async () => {
    const jpg = await sharp({
      create: { width: 900, height: 600, channels: 3, background: "#a33" },
    })
      .jpeg()
      .toBuffer();
    const up = await req(ui, "POST", "/api/inbox/upload", {
      raw: jpg,
      headers: {
        "x-pantrybase": "1",
        "x-filename": encodeURIComponent("IMG_20261017_200000000.jpg"),
      },
    });
    expect(up.status).toBe(200);
    const inbox = (await req(ui, "GET", "/api/inbox?status=pending")).json() as {
      items: Array<{ id: number; path: string }>;
    };
    expect(inbox.items).toHaveLength(1);
    const p = inbox.items[0]?.path ?? "";
    const thumb = await req(ui, "GET", `/api/files/${p}?w=200`);
    expect(thumb.type).toBe("image/jpeg");
    expect((await sharp(thumb.body).metadata()).width).toBe(200);

    const id = inbox.items[0]?.id;
    expect((await req(ui, "POST", "/api/inbox/rotate", { body: { id, degrees: 90 } })).status).toBe(
      403,
    );
    expect(
      (await req(ui, "POST", "/api/inbox/rotate", { body: { id, degrees: 45 }, headers: W }))
        .status,
    ).toBe(400);
    const turned = (
      await req(ui, "POST", "/api/inbox/rotate", { body: { id, degrees: 90 }, headers: W })
    ).json() as {
      item: { size: string };
    };
    expect(turned.item.size).toBe("600x900");

    const resolved = await req(ui, "POST", "/api/inbox/resolve", {
      body: { ids: [inbox.items[0]?.id], status: "skipped", reason: "test" },
      headers: W,
    });
    expect(resolved.status).toBe(200);
    expect(
      fs.existsSync(path.join(t.ctx.paths.inbox, "skipped", "IMG_20261017_200000000.jpg")),
    ).toBe(true);
  });

  it("rejects foreign hosts, cross-site writes and path traversal", async () => {
    expect((await req(ui, "GET", "/api/stats", { headers: { host: "evil.example" } })).status).toBe(
      403,
    );
    expect(
      (await req(ui, "GET", "/api/stats", { headers: { origin: "http://evil.example" } })).status,
    ).toBe(403);
    // A write without the custom header (what a cross-site form post would look like).
    expect(
      (await req(ui, "POST", "/api/pantry", { body: { items: [{ name: "x" }] } })).status,
    ).toBe(403);
    expect((await req(ui, "GET", "/api/files/..%2F..%2Fetc%2Fpasswd")).status).toBe(404);
    expect((await req(ui, "GET", "/api/files/recipes%2Fbubbling-baked-ravioli.md")).status).toBe(
      404,
    );
  });

  it("serves the single-page app (or explains how to build it)", async () => {
    const page = await req(ui, "GET", "/pantry");
    expect([200, 503]).toContain(page.status);
    if (page.status === 200) expect(page.body.toString()).toContain('<div id="app">');
  });
});
