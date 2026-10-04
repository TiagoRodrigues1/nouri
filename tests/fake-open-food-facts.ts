import { readFileSync } from "node:fs";

function fixture(name: string): string {
  return readFileSync(new URL(`../src/food/fixtures/off-${name}.json`, import.meta.url), "utf8");
}

// Stands in for Open Food Facts' product endpoint with recorded response bodies, kept as JSON text. An unknown barcode answers
// 404 with status 0, as the real service does. `down` makes every request fail like a network outage.
export class FakeOpenFoodFacts {
  products = new Map<string, string>([["3017620422003", fixture("nutella")], ["5449000000996", fixture("coca-cola")]]);
  down = false;
  requests: Request[] = [];

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);

    this.requests.push(request);

    if (this.down) throw new TypeError("fetch failed");
    const code = /^\/api\/v2\/product\/(\d+)\.json$/.exec(new URL(request.url).pathname)?.[1] ?? "";
    const product = this.products.get(code);

    return product
      ? new Response(product, { headers: { "Content-Type": "application/json" } })
      : Response.json({ code, status: 0, status_verbose: "product not found" }, { status: 404 });
  };
}
