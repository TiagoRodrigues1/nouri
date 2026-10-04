import { BarcodeDetector, prepareZXingModule } from "barcode-detector/ponyfill";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

// Safari and Firefox have no BarcodeDetector, so every browser reads codes with ZXing's WebAssembly build.
// The wasm is served from Nouri's own assets rather than the library's default CDN, which the page CSP blocks.
prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) } });

// The retail formats printed on food packaging. UPC-E is left out: it must be expanded before a lookup.
export const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a"] });
