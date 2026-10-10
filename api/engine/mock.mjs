// api/engine/mock.mjs — the engine every test uses. No network, no GPU, no randomness.
//
// It returns the photo it was handed (so the shape of the response is real end-to-end) and labels
// itself `mock`. A test that asserts pixel change is a test that will lie to you about the GPU path.

export function makeMockEngine() {
  return {
    name: "mock",
    async available() {
      return true;
    },
    async busy() {
      return false;
    },
    async plan({ imageB64, mime }) {
      return { imageB64, mime: mime || "image/jpeg", engine: "mock", gpu_seconds: 0 };
    }
  };
}
