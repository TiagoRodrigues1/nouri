import * as stylex from "@stylexjs/stylex";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Button } from "./components/ui/button";
import { styles as formStyles } from "./form-styles";
import { isBarcode } from "../../src/food/contract";

// Reading a frame takes a few milliseconds; five a second finds a code quickly without heating the phone.
const scanInterval = 200;

// getUserMedia names its failures; anything else is reported as a camera that would not start.
function cameraProblem(name: string): string {
  if (name === "NotAllowedError") return "Camera access is blocked. Allow it in the browser's site settings, or type the barcode.";

  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found. Type the barcode instead.";

  return "The camera could not start. Type the barcode instead.";
}

// Shows the back camera and reports the first code that passes its check digit, then turns the camera off.
export function BarcodeScanner({ onDetected, onCancel }: { onDetected: (barcode: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const detected = useEffectEvent(onDetected);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function start() {
      // Browsers only offer cameras to secure pages: HTTPS, or localhost while developing.
      if (!navigator.mediaDevices?.getUserMedia) {
        setProblem("This page cannot use a camera. Type the barcode instead.");

        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      } catch (failure) {
        if (!stopped) setProblem(cameraProblem(failure instanceof DOMException ? failure.name : ""));

        return;
      }

      const element = video.current;

      // Closed while the browser asked for the camera, after cleanup ran, so the camera is released here.
      if (stopped || !element) {
        stream.getTracks().forEach((track) => track.stop());

        return;
      }

      element.srcObject = stream;
      const loaded = await Promise.all([element.play(), import("./lib/barcode-detector")]).catch(() => null);

      if (!loaded) {
        if (!stopped) setProblem("The scanner could not load. Type the barcode instead.");

        return;
      }

      const { detector } = loaded[1];

      async function scan() {
        if (stopped || !element) return;
        const codes = await detector.detect(element).catch(() => []);
        const code = codes.map((found) => found.rawValue).find(isBarcode);

        if (stopped) return;

        if (code) detected(code);
        else timer = setTimeout(() => void scan(), scanInterval);
      }

      await scan();
    }

    void start();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div {...stylex.props(styles.scanner)}>
      {problem ? (
        <p {...stylex.props(formStyles.searchMessage)} role="alert">{problem}</p>
      ) : (
        <>
          <video ref={video} {...stylex.props(styles.video)} muted playsInline aria-label="Camera view for barcode scanning" />
          <p {...stylex.props(formStyles.fieldHint, styles.hint)}>Hold the barcode inside the frame.</p>
        </>
      )}
      <Button type="button" variant="outline" onClick={onCancel}>
        {problem ? "Close" : "Stop scanning"}
      </Button>
    </div>
  );
}

const styles = stylex.create({
  scanner: { display: "grid", gap: "8px", margin: "8px 0" },
  video: { width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: "8px", backgroundColor: "black" },
  hint: { margin: 0, textAlign: "center" },
});
